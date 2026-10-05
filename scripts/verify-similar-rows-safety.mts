/**
 * verify:similar-rows-safety — L12.24 (awkit-djnl.21.24) wrong-target safety of Element Spy similar rows.
 *
 * The defect: the parser-only provider's `find_similar` is structural, so a row's Approve and Reject were one set
 * and the proven loop clicked both in every row. Picking one control must yield a loop over that action only,
 * or no loop at all.
 *
 * Corpus: SIMILAR_ROW_LAB in mock-site/dom-coverage-corpus.mjs (served at /dom-coverage-lab/<id>): Approve vs
 * Reject, Approve vs Delete, same text told apart by data-action, icon-only actions, disabled and hidden
 * siblings, reordered actions, nested controls, rows holding a subset of the actions, and two deliberately
 * ambiguous pages (two indistinguishable Approve buttons per row; unlabelled icons) that must refuse. Each
 * control carries a verifier-only `data-oracle-intent`, read and stripped before anything else sees the page.
 *
 * The gate is a pure function over three runs: every loop matches only the picked control's intent and includes
 * it, covers the expected rows, ambiguous pages get no loop, runs are identical. Its failure modes are
 * mutation-tested in-process, a live red control proves a structural (L12.19-shaped) selector is judged MIXED,
 * and two loops are executed by the real StepExecutor, before and after the page reorders its actions.
 * Exit 2 (NOT RUN) without the pinned runtime inputs.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium, type Browser, type Page } from "playwright";

import { buildRecordedFlow } from "@src/recorder/buildRecordedFlow";
import { similarRowsLoopAction } from "@src/recorder/RecorderService";
import { DOM_INTELLIGENCE_LIMITS } from "@src/runner/domIntelligence/DomIntelligenceProvider";
import type { ScraplingDomIntelligenceProvider } from "@src/runner/domIntelligence/ScraplingDomIntelligenceProvider";
import { extractSimilarRows } from "@src/runner/domIntelligence/similarRows";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { StepExecutor } from "@src/runner/StepExecutor";
import { ValueResolver } from "@src/runner/ValueResolver";
import { COVERAGE_RUNTIME, SIMILAR_ROW_LAB, coveragePage, type SimilarRowPage } from "../mock-site/dom-coverage-corpus.mjs";
import { stageHost } from "./dom-intelligence/stagedHost.mts";

const RUNS = 3;
/** Pinned so a dropped page, or a dropped ambiguous page, fails the gate instead of shrinking it. */
const PINNED = { pages: 15, refuse: 5 };

export interface LoopObservation {
  id: string;
  ok: boolean;
  total: number;
  loop: string | null;
  /** L12.25: how far above each looped element its row is, recorded with the loop for the run-time row check. */
  rowDepth?: number;
  /** The oracle intent of the picked control, and of every element the loop selector matches. */
  picked: string;
  intents: string[];
  pickedInLoop: boolean;
}

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
}

/** The L12.24 gate. Pure, so its own failure modes are tested against altered copies of the real results. */
export function similarRowsGate(lab: SimilarRowPage[], runs: LoopObservation[][]): string[] {
  const reasons: string[] = [];
  if (lab.length !== PINNED.pages) reasons.push(`page count ${lab.length}, pinned ${PINNED.pages}`);
  const refuse = lab.filter((c) => c.expect === "refuse").length;
  if (refuse !== PINNED.refuse) reasons.push(`ambiguous (refuse) page count ${refuse}, pinned ${PINNED.refuse}`);
  if (runs.length !== RUNS) reasons.push(`${runs.length} runs, expected ${RUNS}`);
  runs.forEach((rows, r) => {
    if (rows.map((o) => o.id).join("|") !== lab.map((c) => c.id).join("|")) reasons.push(`run ${r + 1}: the result set differs from the lab (${rows.length} rows for ${lab.length} pages)`);
    const byId = new Map(rows.map((o) => [o.id, o]));
    for (const c of lab) {
      const o = byId.get(c.id);
      if (!o) continue;
      const at = `run ${r + 1} ${c.id}`;
      if (!o.ok) reasons.push(`${at}: similar rows failed`);
      if (!o.picked) reasons.push(`${at}: the picked control has no oracle intent`);
      if (o.loop && o.intents.some((intent) => intent !== o.picked)) reasons.push(`${at}: MIXED loop: ${[...new Set(o.intents)].join("+")} for a picked ${o.picked}`);
      if (o.loop && !o.pickedInLoop) reasons.push(`${at}: the loop does not include the picked control`);
      if (c.expect === "refuse" && o.loop) reasons.push(`${at}: a loop was offered where the action is ambiguous`);
      if (typeof c.expect === "number") {
        if (!o.loop) reasons.push(`${at}: expected a loop over ${c.expect} rows, none offered`);
        else if (o.intents.length !== c.expect) reasons.push(`${at}: the loop covers ${o.intents.length} rows, expected ${c.expect}`);
        if (o.total !== c.expect) reasons.push(`${at}: ${o.total} similar rows listed, expected ${c.expect}`);
      }
    }
  });
  runs.forEach((rows, r) => {
    if (r > 0 && JSON.stringify(rows) !== JSON.stringify(runs[0])) reasons.push(`run ${r + 1} differs from run 1`);
  });
  return reasons;
}

const runtime = (call: string) => `${COVERAGE_RUNTIME} && window.__awkitCoverage.${call}`;
type CoverageWindow = { __awkitCoverage: { target: Element | null; intentOf(element: Element | null): string } };

/** The intents a selector matches on the live page, and whether the picked control is among them. */
async function judgeLoop(page: Page, selector: string): Promise<{ intents: string[]; pickedInLoop: boolean }> {
  return page.locator(selector).evaluateAll((elements) => {
    const cov = (window as unknown as CoverageWindow).__awkitCoverage;
    return { intents: elements.map((element) => cov.intentOf(element)), pickedInLoop: elements.includes(cov.target as HTMLElement) };
  });
}

/** Load a lab page, strip its oracle, then ask for the picked control's similar rows as Element Spy does. */
async function observe(browser: Browser, url: string, provider: ScraplingDomIntelligenceProvider, id: string): Promise<LoopObservation & { ms: number }> {
  const page = await browser.newPage();
  try {
    await page.goto(url);
    const armed = (await page.evaluate(runtime("arm(null)"))) as number;
    const leaks = (await page.evaluate(runtime("leaks()"))) as number;
    if (armed !== 1 || leaks !== 0) throw new Error(`${id}: oracle armed ${armed}, ${leaks} oracle attributes left`);
    const index = await page.evaluate(() => Array.prototype.indexOf.call(document.body.querySelectorAll("*"), (window as unknown as CoverageWindow).__awkitCoverage.target) as number);
    const picked = (await page.evaluate(() => {
      const cov = (window as unknown as CoverageWindow).__awkitCoverage;
      return cov.intentOf(cov.target);
    })) as string;
    const started = performance.now();
    const result = await extractSimilarRows(page.mainFrame(), page.locator("body *").nth(index), provider, (text) => text);
    const ms = performance.now() - started;
    const loop = result.ok ? (result.loop ?? null) : null;
    const judged = loop ? await judgeLoop(page, loop) : { intents: [], pickedInLoop: false };
    const rowDepth = result.ok ? (result as { loopRowDepth?: number }).loopRowDepth : undefined;
    return { id, ok: result.ok, total: result.ok ? result.total : 0, loop, ...(rowDepth !== undefined ? { rowDepth } : {}), picked, ...judged, ms };
  } finally {
    await page.close();
  }
}

/** Run a saved similar-rows loop through the real StepExecutor and return the oracle intents it clicked. */
async function runLoop(page: Page, proven: Pick<LoopObservation, "loop" | "rowDepth" | "intents">, root: string, timeoutMs?: number): Promise<{ status: string; clicked: string[] }> {
  await page.evaluate(() => {
    const w = window as unknown as CoverageWindow & { __clicked?: string[] };
    if (!w.__clicked) document.addEventListener("click", (event) => w.__clicked!.push(w.__awkitCoverage.intentOf((event.target as Element).closest("button"))), true);
    w.__clicked = [];
  });
  const step = buildRecordedFlow("Similar rows", [similarRowsLoopAction(proven.loop ?? "", proven.intents.length, "main", proven.rowDepth)]).nodes.find((node) => node.type === "loop");
  if (step && timeoutMs) step.timeoutMs = timeoutMs;
  const ctx: InstanceExecutionContext = {
    executionId: "exec-l12-24", instanceId: "inst-l12-24", scenarioId: "scen-l12-24", flowId: "flow-l12-24", instanceOrderNumber: 1, totalInstances: 1,
    runtimeInputs: {}, instanceInputs: {}, flowOutputs: {},
    paths: { downloads: join(root, "d"), screenshots: join(root, "s"), logs: join(root, "l"), reports: join(root, "r"), sessions: join(root, "x") }
  };
  const ran = step ? await new StepExecutor(page, new LocatorFactory(page), new ValueResolver(ctx), ctx).execute(step) : undefined;
  const clicked = (await page.evaluate(() => (window as unknown as { __clicked: string[] }).__clicked)) as string[];
  return { status: ran?.status ?? "no-step", clicked };
}

async function main(): Promise<void> {
  const staged = stageHost("awkit-l12-24-rows-");
  if (!staged) {
    console.log("NOT RUN: the pinned runtime inputs are absent (npm run benchmark:dom-intelligence-runtime-setup).");
    process.exit(2);
  }
  const provider = staged.provider();
  const root = await mkdtemp(join(tmpdir(), "awkit-l12-24-"));
  const server: Server = createServer((request, response) => {
    const match = /^\/dom-coverage-lab\/([a-z0-9-]+)$/.exec(new URL(request.url ?? "/", "http://x").pathname);
    const body = match ? coveragePage(match[1]) : undefined;
    if (!body) return void response.writeHead(404).end();
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);
  });
  const base = await new Promise<string>((done) => server.listen(0, "127.0.0.1", () => done(`http://127.0.0.1:${(server.address() as { port: number }).port}`)));
  const urlOf = (id: string) => `${base}/dom-coverage-lab/${id}`;
  let browser: Browser | undefined;
  const runs: LoopObservation[][] = [];
  try {
    const status = await provider.getStatus();
    check("the staged parser-only host is available (parser-only, no browser, no network)", status.available && !status.browserAccess && !status.networkAccess, status);
    browser = await chromium.launch();

    // ── A. Red-first: the oracle must be able to call a loop MIXED ──────────────────────────────────
    console.log("A. The intent oracle reports a mixed selector as MIXED (red control) and strips itself");
    {
      const page = await browser.newPage();
      await page.goto(urlOf("rows-approve-reject"));
      check("the oracle arms exactly one picked control", (await page.evaluate(runtime("arm(null)"))) === 1);
      check("...and no oracle attribute or intent remains for any engine to read", (await page.evaluate(runtime("leaks()"))) === 0);
      // The L12.19 selector shape for this page: anchored container plus tag path, nothing about the action.
      const structural = await judgeLoop(page, 'tbody[id="lab-body"] > tr > td > button');
      check("the structural selector covers both actions, so the oracle sees approve+reject", structural.intents.includes("approve") && structural.intents.includes("reject"), structural.intents);
      const mixed = similarRowsGate(SIMILAR_ROW_LAB, [0, 1, 2].map(() => SIMILAR_ROW_LAB.map((c) => ({ id: c.id, ok: true, total: 12, loop: "x", picked: "approve", intents: structural.intents, pickedInLoop: true }))));
      check("...and the gate fails it as a MIXED loop", mixed.some((reason) => reason.includes("MIXED loop")), mixed.slice(0, 2));
      await page.close();
    }

    // ── B. Every lab page, three runs ────────────────────────────────────────────────────────────────
    const ms: number[] = [];
    for (let run = 1; run <= RUNS; run += 1) {
      console.log(`B. Run ${run}/${RUNS}: ${SIMILAR_ROW_LAB.length} similar-rows pages`);
      const rows: LoopObservation[] = [];
      for (const c of SIMILAR_ROW_LAB) {
        const { ms: took, ...observation } = await observe(browser, urlOf(c.id), provider, c.id);
        rows.push(observation);
        ms.push(took);
        if (run === 1) console.log(`    ${c.id.padEnd(24)} expect=${String(c.expect).padEnd(6)} rows=${observation.total} loop=${observation.loop ? `${observation.intents.length} [${[...new Set(observation.intents)].join("+")}] ${observation.loop}` : "none"}`);
      }
      runs.push(rows);
    }
    check(`every similar-rows call stays within the diagnosis budget (${DOM_INTELLIGENCE_LIMITS.diagnosisTimeoutMs} ms)`, Math.max(...ms) < DOM_INTELLIGENCE_LIMITS.diagnosisTimeoutMs, Math.round(Math.max(...ms)));

    // ── C. The gate, then its own failure modes ─────────────────────────────────────────────────────
    console.log("C. The L12.24 gate");
    const reasons = similarRowsGate(SIMILAR_ROW_LAB, runs);
    check(`every page met the gate in all ${RUNS} runs`, reasons.length === 0, reasons.slice(0, 12));
    const loops = runs[0].filter((o) => o.loop);
    check("no loop anywhere matches an action other than the picked one", runs.flat().every((o) => !o.loop || o.intents.every((intent) => intent === o.picked)));
    check(`loops are offered on the ${PINNED.pages - PINNED.refuse} unambiguous pages and refused on the ${PINNED.refuse} ambiguous ones`, loops.length === PINNED.pages - PINNED.refuse, loops.map((o) => o.id));

    console.log("D. Mutation controls: the gate fails for each defect it exists to catch");
    const copy = () => structuredClone(runs);
    const firstLoop = SIMILAR_ROW_LAB.findIndex((c) => typeof c.expect === "number");
    const firstRefuse = SIMILAR_ROW_LAB.findIndex((c) => c.expect === "refuse");
    const fails = (altered: LoopObservation[][], lab: SimilarRowPage[], needle: string) => similarRowsGate(lab, altered).some((reason) => reason.includes(needle));
    let altered = copy();
    altered[0][firstLoop].intents[altered[0][firstLoop].intents.length - 1] = "reject";
    check("a loop that also matches one Reject fails the gate", fails(altered, SIMILAR_ROW_LAB, "MIXED loop"));
    altered = copy();
    altered[1][firstRefuse] = { ...altered[1][firstRefuse], loop: "x", intents: ["approve", "approve"], picked: "approve", pickedInLoop: true };
    check("a loop offered on an ambiguous page fails the gate, even when every match carries the picked intent", fails(altered, SIMILAR_ROW_LAB, "action is ambiguous"));
    altered = copy();
    altered[2][firstLoop].pickedInLoop = false;
    check("a loop that leaves out the picked control fails the gate", fails(altered, SIMILAR_ROW_LAB, "does not include the picked"));
    altered = copy();
    altered[0][firstLoop].intents = altered[0][firstLoop].intents.slice(1);
    check("a loop that drops a row fails the gate", fails(altered, SIMILAR_ROW_LAB, "expected 6"));
    altered = copy();
    altered[0][firstLoop].total += 6;
    check("a similar-rows list that counts the other action's rows fails the gate", fails(altered, SIMILAR_ROW_LAB, "similar rows listed"));
    altered = copy();
    altered[2][firstLoop] = { ...altered[2][firstLoop], loop: `${altered[2][firstLoop].loop} ` };
    check("a run whose answer differs fails the gate", fails(altered, SIMILAR_ROW_LAB, "differs from run 1"));
    const droppedId = SIMILAR_ROW_LAB[firstRefuse].id;
    check(
      "an ambiguous page removed from the lab fails the gate",
      fails(runs.map((rows) => rows.filter((o) => o.id !== droppedId)), SIMILAR_ROW_LAB.filter((c) => c.id !== droppedId), "ambiguous (refuse) page count")
    );

    // ── E. The loops at run time: the real StepExecutor clicks only the picked action ───────────────
    console.log("E. Two proven loops executed by the real StepExecutor, before and after the actions reorder");
    for (const id of ["rows-subset", "rows-approve-reject"]) {
      const proven = runs[0].find((o) => o.id === id);
      if (!proven?.loop) {
        check(`${id}: a proven loop to execute`, false);
        continue;
      }
      const page = await browser.newPage();
      await page.goto(urlOf(id));
      await page.evaluate(runtime("arm(null)"));
      const before = await runLoop(page, proven, root);
      check(`${id}: the loop passes and clicks ${proven.intents.length} times, every click ${proven.picked}`, before.status === "passed" && before.clicked.length === proven.intents.length && before.clicked.every((intent) => intent === proven.picked), before);
      // The page now reverses every row's actions: a positional selector would click the other action.
      await page.evaluate(() => document.querySelectorAll("#lab-body td:last-child").forEach((cell) => Array.from(cell.children).reverse().forEach((child) => cell.appendChild(child))));
      const after = await runLoop(page, proven, root);
      check(`${id}: after the actions swap places the same loop still clicks only ${proven.picked}`, after.status === "passed" && after.clicked.length === proven.intents.length && after.clicked.every((intent) => intent === proven.picked), after);
      await page.close();
    }

    // ── F. L12.25: the page changes between generation and execution ────────────────────────────────
    console.log("F. L12.25: loops executed after the page changed since they were made");
    /** `change` runs in the page after the oracle is armed; `expect` judges the run. Intents are the oracle's. */
    const scenarios: Array<{ id: string; title: string; change: string; timeoutMs?: number; expect: (run: { status: string; clicked: string[] }, rows: number) => boolean }> = [
      {
        id: "rows-state-only",
        title: "QC repro: Reject enabled after generation never joins an Approve loop",
        change: `document.querySelectorAll("#lab-body button[disabled]").forEach(function (b) { b.disabled = false; })`,
        expect: (run) => run.clicked.every((intent) => intent === "approve")
      },
      {
        id: "rows-unavailable-siblings",
        title: "Reject enabled, Delete shown and the order reversed: still only Approve, every row",
        change:
          `document.querySelectorAll("#lab-body button").forEach(function (b) { b.disabled = false; b.hidden = false; });` +
          `document.querySelectorAll("#lab-body td:last-child").forEach(function (c) { Array.prototype.slice.call(c.children).reverse().forEach(function (k) { c.appendChild(k); }); })`,
        expect: (run, rows) => run.status === "passed" && run.clicked.length === rows && run.clicked.every((intent) => intent === "approve")
      },
      {
        id: "rows-disabled-hidden",
        title: "The disabled Approve and every Reject enabled, Delete shown: the Approves only",
        change: `document.querySelectorAll("#lab-body tr:not([hidden]) button").forEach(function (b) { b.disabled = false; b.hidden = false; })`,
        expect: (run) => run.status === "passed" && run.clicked.length === 6 && run.clicked.every((intent) => intent === "approve" || intent === "approve-unavailable")
      },
      {
        id: "rows-approve-reject",
        title: "A Delete added to every row after generation is never clicked",
        change: `document.querySelectorAll("#lab-body td:last-child").forEach(function (c) { var d = document.createElement("button"); d.type = "button"; d.textContent = "Delete"; window.__awkitCoverage.intents.set(d, "delete-new"); c.prepend(d); })`,
        expect: (run, rows) => run.status === "passed" && run.clicked.length === rows && run.clicked.every((intent) => intent === "approve")
      },
      {
        id: "rows-approve-reject",
        title: "A second Approve appearing in one row after generation: the loop refuses, it is never clicked",
        change: `(function () { var c = document.querySelector("#lab-body tr td:last-child"); var d = document.createElement("button"); d.type = "button"; d.textContent = "Approve"; window.__awkitCoverage.intents.set(d, "approve-new"); c.appendChild(d); })()`,
        expect: (run) => run.status !== "passed" && !run.clicked.includes("approve-new")
      },
      {
        id: "rows-approve-reject",
        title: "One row's Approve removed before the run: the others, Approve only",
        change: `document.querySelectorAll("#lab-body tr")[1].querySelector("button").remove()`,
        expect: (run, rows) => run.status === "passed" && run.clicked.length === rows - 1 && run.clicked.every((intent) => intent === "approve")
      },
      {
        id: "rows-approve-reject",
        title: "One row's Approve disabled before the run: the loop stops there, nothing else clicked",
        change: `document.querySelectorAll("#lab-body tr")[1].querySelector("button").disabled = true`,
        timeoutMs: 1_500,
        expect: (run) => run.status !== "passed" && run.clicked.every((intent) => intent === "approve")
      }
    ];
    for (const scenario of scenarios) {
      const proven = runs[0].find((o) => o.id === scenario.id);
      const page = await browser.newPage();
      await page.goto(urlOf(scenario.id));
      await page.evaluate(runtime("arm(null)"));
      await page.evaluate(scenario.change);
      // No loop offered is the outcome on an ambiguous page, judged by the gate; there is then nothing to execute.
      const run = proven?.loop ? await runLoop(page, proven, root, scenario.timeoutMs) : { status: "no-loop", clicked: [] };
      check(`${scenario.id}: ${scenario.title}`, (proven?.loop ? scenario.expect(run, proven.intents.length) : SIMILAR_ROW_LAB.find((c) => c.id === scenario.id)?.expect === "refuse"), run);
      await page.close();
    }

    // F3 (P2, observed not gated): a loop whose selector needs a state filter re-resolves its matches every iteration,
    // so an Approve that disables itself when clicked shifts the rest. Safety is gated; the skip is only reported.
    {
      const proven = runs[0].find((o) => o.id === "rows-disabled-hidden");
      if (proven?.loop) {
        const page = await browser.newPage();
        await page.goto(urlOf(proven.id));
        await page.evaluate(runtime("arm(null)"));
        await page.evaluate(`document.querySelectorAll("#lab-body button").forEach(function (b) { b.addEventListener("click", function () { b.disabled = true; }); })`);
        const run = await runLoop(page, proven, root, 1_500);
        check("F3: an Approve that disables itself on click never makes the loop click another action", run.clicked.every((intent) => intent === "approve"), run);
        console.log(`    F3 observed: ${run.status}, ${run.clicked.length} of ${proven.intents.length} rows clicked (state-filtered selector: ${proven.loop})`);
        await page.close();
      }
    }
  } finally {
    await browser?.close().catch(() => undefined);
    server.close();
    await provider.shutdown().catch(() => undefined);
    staged.cleanup();
    await rm(root, { recursive: true, force: true });
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
