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
 *
 * L12.27 (awkit-djnl.21.27): independent QC's two L12.26 probes are lab pages (rows-qc-link-reject,
 * rows-qc-wrapped-reject) with rows-role-only and rows-row-data-action. A loop selector must name the action; a tag path
 * or a role was offered and then clicked Unapprove, or Reject, in every row. Every StepExecutor scenario now states its
 * exact outcome (judgeScenario): the ordered clicks with action and row, the status, and the error a run-time refusal
 * carries; a refusal scenario proves no loop, no execution and no click. Section G mutation-tests that judge.
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
const PINNED = { pages: 26, refuse: 13 };

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

export interface LoopRun {
  status: string;
  /** Every click the page saw, in order, as `<oracle intent>@<the row's invoice>`. */
  clicked: string[];
  error?: string;
}

/**
 * L12.27: what a scenario must observe. "refuse": no loop is generated, so nothing is executed and nothing is clicked
 * (and similar rows itself succeeded, so the refusal is the identity check, not a crash). Otherwise the exact run: its
 * status, the exact ordered clicks (action and row), and for a failure the error it must fail with.
 */
export type ScenarioExpectation = "refuse" | { status: "passed" | "failed"; clicks: string[]; error?: string };

/** The scenario judge. Pure, so its own failure modes are tested against altered copies of real outcomes. */
export function judgeScenario(expect: ScenarioExpectation, observed: { ok: boolean; loop: string | null }, run: LoopRun): string[] {
  const reasons: string[] = [];
  if (!observed.ok) reasons.push("similar rows failed, so nothing about the loop was proven");
  if (expect === "refuse") {
    if (observed.loop) reasons.push(`a loop was generated: ${observed.loop}`);
    if (run.status !== "no-loop") reasons.push(`the loop was executed (${run.status})`);
    if (run.clicked.length) reasons.push(`clicked ${run.clicked.join(",")}`);
    return reasons;
  }
  if (!observed.loop) reasons.push("no loop was generated");
  if (run.status !== expect.status) reasons.push(`status ${run.status}, expected ${expect.status}${run.error ? ` (${run.error.slice(0, 120)})` : ""}`);
  if (JSON.stringify(run.clicked) !== JSON.stringify(expect.clicks)) reasons.push(`clicked [${run.clicked.join(",")}], expected [${expect.clicks.join(",")}]`);
  if (expect.error && !run.error?.includes(expect.error)) reasons.push(`failed with "${(run.error ?? "no error").slice(0, 120)}", expected ${expect.error}`);
  return reasons;
}

/** `intent@INV-n` for each row number. */
const clicks = (intent: string, ...rows: number[]) => rows.map((row) => `${intent}@INV-${row}`);
const ALL = [3001, 3002, 3003, 3004, 3005, 3006];

/** Record every click the page sees from now on (capture phase), as `<intent>@<row invoice>`. */
async function recordClicks(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as CoverageWindow & { __clicked?: string[] };
    if (!w.__clicked)
      document.addEventListener(
        "click",
        (event) => {
          const element = (event.target as Element).closest("button,a,[role=button]");
          const row = element?.closest("tr");
          w.__clicked!.push(`${w.__awkitCoverage.intentOf(element)}@${row?.cells[0]?.textContent ?? "?"}`);
        },
        true
      );
    w.__clicked = [];
  });
}

const clickedSoFar = async (page: Page) => (await page.evaluate(() => (window as unknown as { __clicked: string[] }).__clicked)) as string[];

/** Run a saved similar-rows loop through the real StepExecutor and return the oracle intents it clicked, with their rows. */
async function runLoop(page: Page, proven: Pick<LoopObservation, "loop" | "rowDepth" | "intents">, root: string, timeoutMs?: number): Promise<LoopRun> {
  await recordClicks(page);
  const step = buildRecordedFlow("Similar rows", [similarRowsLoopAction(proven.loop ?? "", proven.intents.length, "main", proven.rowDepth)]).nodes.find((node) => node.type === "loop");
  if (step && timeoutMs) step.timeoutMs = timeoutMs;
  const ctx: InstanceExecutionContext = {
    executionId: "exec-l12-24", instanceId: "inst-l12-24", scenarioId: "scen-l12-24", flowId: "flow-l12-24", instanceOrderNumber: 1, totalInstances: 1,
    runtimeInputs: {}, instanceInputs: {}, flowOutputs: {},
    paths: { downloads: join(root, "d"), screenshots: join(root, "s"), logs: join(root, "l"), reports: join(root, "r"), sessions: join(root, "x") }
  };
  const ran = step ? await new StepExecutor(page, new LocatorFactory(page), new ValueResolver(ctx), ctx).execute(step) : undefined;
  return { status: ran?.status ?? "no-step", clicked: await clickedSoFar(page), ...(ran?.error ? { error: ran.error } : {}) };
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

    // ── E/F. The loops at run time, through the real StepExecutor ────────────────────────────────────
    // L12.27: every scenario states its exact outcome (judgeScenario): the ordered clicks with action AND row, the
    // status, and the error a refusal at run time must carry. A refusal scenario proves no loop was generated and
    // nothing was executed or clicked; if a loop WAS generated it is still executed, so the report shows what it did.
    console.log("E/F. Loops executed by the real StepExecutor, as made and after the page changed since");
    const wrapEach = (selector: string) =>
      `document.querySelectorAll(${JSON.stringify(selector)}).forEach(function (b) { var s = document.createElement("span"); s.className = "wrap"; b.replaceWith(s); s.appendChild(b); })`;
    const scenarios: Array<{ id: string; title: string; change?: string; timeoutMs?: number; expect: ScenarioExpectation }> = [
      // E (L12.24): two loops as made, then with every row's actions reversed.
      { id: "rows-subset", title: "the loop as made: Approve in each of its 4 rows", expect: { status: "passed", clicks: clicks("approve", 3001, 3003, 3004, 3006) } },
      {
        id: "rows-subset",
        title: "after the actions swap places: the same 4 Approves",
        change: `document.querySelectorAll("#lab-body td:last-child").forEach(function (c) { Array.prototype.slice.call(c.children).reverse().forEach(function (k) { c.appendChild(k); }); })`,
        expect: { status: "passed", clicks: clicks("approve", 3001, 3003, 3004, 3006) }
      },
      { id: "rows-approve-reject", title: "the loop as made: Approve in all 6 rows", expect: { status: "passed", clicks: clicks("approve", ...ALL) } },
      {
        id: "rows-approve-reject",
        title: "after the actions swap places: the same 6 Approves",
        change: `document.querySelectorAll("#lab-body td:last-child").forEach(function (c) { Array.prototype.slice.call(c.children).reverse().forEach(function (k) { c.appendChild(k); }); })`,
        expect: { status: "passed", clicks: clicks("approve", ...ALL) }
      },
      // F (L12.25 and L12.27): the page changes between generation and execution.
      {
        id: "rows-state-only",
        title: "L12.25 QC repro: Reject told apart only by being disabled, enabled before the run: no loop, nothing clicked",
        change: `document.querySelectorAll("#lab-body button[disabled]").forEach(function (b) { b.disabled = false; })`,
        expect: "refuse"
      },
      {
        id: "rows-unavailable-siblings",
        title: "Reject enabled, Delete shown and the order reversed: Approve in all 6 rows, nothing else",
        change:
          `document.querySelectorAll("#lab-body button").forEach(function (b) { b.disabled = false; b.hidden = false; });` +
          `document.querySelectorAll("#lab-body td:last-child").forEach(function (c) { Array.prototype.slice.call(c.children).reverse().forEach(function (k) { c.appendChild(k); }); })`,
        expect: { status: "passed", clicks: clicks("approve", ...ALL) }
      },
      {
        id: "rows-disabled-hidden",
        title: "the disabled Approve and every Reject enabled, Delete shown: the 6 Approves (INV-3005's now available), no Reject or Delete",
        change: `document.querySelectorAll("#lab-body tr:not([hidden]) button").forEach(function (b) { b.disabled = false; b.hidden = false; })`,
        expect: { status: "passed", clicks: [...clicks("approve", 3001, 3002, 3003, 3004), ...clicks("approve-unavailable", 3005), ...clicks("approve", 3006)] }
      },
      {
        id: "rows-approve-reject",
        title: "a Delete added to every row after generation is never clicked: Approve in all 6 rows",
        change: `document.querySelectorAll("#lab-body td:last-child").forEach(function (c) { var d = document.createElement("button"); d.type = "button"; d.textContent = "Delete"; window.__awkitCoverage.intents.set(d, "delete-new"); c.prepend(d); })`,
        expect: { status: "passed", clicks: clicks("approve", ...ALL) }
      },
      {
        id: "rows-approve-reject",
        title: "a second Approve in one row after generation: refused before any click, SIMILAR_ROWS_LOOP_BROADENED",
        change: `(function () { var c = document.querySelector("#lab-body tr td:last-child"); var d = document.createElement("button"); d.type = "button"; d.textContent = "Approve"; window.__awkitCoverage.intents.set(d, "approve-new"); c.appendChild(d); })()`,
        expect: { status: "failed", clicks: [], error: "SIMILAR_ROWS_LOOP_BROADENED" }
      },
      {
        id: "rows-approve-reject",
        title: "INV-3002's Approve removed before the run: the other 5 Approves",
        change: `document.querySelectorAll("#lab-body tr")[1].querySelector("button").remove()`,
        expect: { status: "passed", clicks: clicks("approve", 3001, 3003, 3004, 3005, 3006) }
      },
      {
        id: "rows-approve-reject",
        title: "INV-3002's Approve disabled before the run: INV-3001 clicked, then the loop stops (timeout), nothing else",
        change: `document.querySelectorAll("#lab-body tr")[1].querySelector("button").disabled = true`,
        timeoutMs: 1_500,
        expect: { status: "failed", clicks: clicks("approve", 3001), error: "Timeout" }
      },
      {
        id: "rows-approve-reject",
        title: "Approve → Unapprove in INV-3001 and INV-3002 before the run: the 4 remaining Approves, never an Unapprove",
        change: `Array.prototype.slice.call(document.querySelectorAll("#lab-body tr"), 0, 2).forEach(function (r) { var b = r.querySelector("button"); b.textContent = "Unapprove"; window.__awkitCoverage.intents.set(b, "unapprove"); })`,
        expect: { status: "passed", clicks: clicks("approve", 3003, 3004, 3005, 3006) }
      },
      // L12.27 P1 (independent QC's L12.26 probes): no stable action identity, so no loop, whatever the page does next.
      {
        id: "rows-qc-link-reject",
        title: "L12.26 QC probe 1: Approve becomes Unapprove in every row: no loop, nothing clicked",
        change: `document.querySelectorAll("#lab-body button").forEach(function (b) { b.textContent = b.textContent.replace("Approve", "Unapprove"); window.__awkitCoverage.intents.set(b, "unapprove"); })`,
        expect: "refuse"
      },
      {
        id: "rows-qc-wrapped-reject",
        title: "L12.26 QC probe 2: the wrappers flip and Reject is enabled: no loop, nothing clicked",
        change:
          `document.querySelectorAll("#lab-body span.wrap > button").forEach(function (b) { b.disabled = false; b.parentElement.replaceWith(b); });` +
          wrapEach("#lab-body td:last-child > button:first-child"),
        expect: "refuse"
      },
      {
        id: "rows-role-only",
        title: "a role-only Approve: Reject becomes a span with role=button: no loop, nothing clicked",
        change: `document.querySelectorAll("#lab-body td:last-child > button").forEach(function (b) { var s = document.createElement("span"); s.setAttribute("role", "button"); s.tabIndex = 0; s.textContent = "Reject"; window.__awkitCoverage.intents.set(s, "reject"); b.replaceWith(s); })`,
        expect: "refuse"
      },
      // L12.28 QC: a form name the actions share is not the action's name.
      {
        id: "rows-name-decision",
        title: "L12.28 QC probe: a shared form name only, Approve becomes Unapprove: no loop, nothing clicked",
        change: `document.querySelectorAll("#lab-body button").forEach(function (b) { b.textContent = b.textContent.replace("Approve", "Unapprove"); b.value = "unapprove"; window.__awkitCoverage.intents.set(b, "unapprove"); })`,
        expect: "refuse"
      },
      // A title that is a textless control's accessible name still names it.
      { id: "rows-title-icons", title: "title-named icons, as made: Approve in all 6 rows", expect: { status: "passed", clicks: clicks("approve", ...ALL) } },
      {
        id: "rows-title-icons",
        title: "title-named icons: an Escalate icon added to every row and the actions reversed: Approve in all 6 rows",
        change:
          `document.querySelectorAll("#lab-body td:last-child").forEach(function (c) { var d = document.createElement("button"); d.type = "button"; d.title = "Escalate"; window.__awkitCoverage.intents.set(d, "escalate-new"); c.prepend(d); Array.prototype.slice.call(c.children).reverse().forEach(function (k) { c.appendChild(k); }); })`,
        expect: { status: "passed", clicks: clicks("approve", ...ALL) }
      },
      // A stable identity (data-action) with row data in the names: the loop is offered and survives the same changes.
      { id: "rows-row-data-action", title: "data-action identity, as made: Approve in all 6 rows", expect: { status: "passed", clicks: clicks("approve", ...ALL) } },
      {
        id: "rows-row-data-action",
        title: "data-action identity: Approve → Unapprove (name and data-action) in INV-3001 and INV-3002: the other 4 Approves",
        change: `Array.prototype.slice.call(document.querySelectorAll("#lab-body tr"), 0, 2).forEach(function (r) { var b = r.querySelector("button[data-action=approve]"); b.textContent = b.textContent.replace("Approve", "Unapprove"); b.setAttribute("data-action", "unapprove"); window.__awkitCoverage.intents.set(b, "unapprove"); })`,
        expect: { status: "passed", clicks: clicks("approve", 3003, 3004, 3005, 3006) }
      },
      {
        id: "rows-row-data-action",
        title: "data-action identity: an Escalate added to every row and the actions reversed: Approve in all 6 rows",
        change:
          `document.querySelectorAll("#lab-body td:last-child").forEach(function (c) { var d = document.createElement("button"); d.type = "button"; d.setAttribute("data-action", "escalate"); d.textContent = "Escalate"; window.__awkitCoverage.intents.set(d, "escalate-new"); c.prepend(d); Array.prototype.slice.call(c.children).reverse().forEach(function (k) { c.appendChild(k); }); })`,
        expect: { status: "passed", clicks: clicks("approve", ...ALL) }
      },
      {
        id: "rows-row-data-action",
        title: "data-action identity: every Approve wrapped and Reject left bare: nothing matches, nothing clicked (never Reject)",
        change: wrapEach("#lab-body button[data-action=approve]"),
        expect: { status: "passed", clicks: [] }
      },
      // L12.30 (L12.29 re-QC N4/N5): a generic aria-label, data-action or title every row action carries is not the action's
      // name. Before L12.30 each of these loops was offered and the real StepExecutor clicked the action stated in brackets.
      {
        id: "rows-generic-aria",
        title: "N4 generic aria-label: Approve → Unapprove in every row, label kept: no loop, nothing clicked (was unapprove x6)",
        change: `document.querySelectorAll("#lab-body button").forEach(function (b) { b.textContent = b.textContent.replace("Approve", "Unapprove"); window.__awkitCoverage.intents.set(b, "unapprove"); })`,
        expect: "refuse"
      },
      {
        id: "rows-generic-aria",
        title: "N4 generic aria-label: Approve → Reject, a Reject button with the same label replaces Approve and the link: no loop, nothing clicked (was reject x6)",
        change: `document.querySelectorAll("#lab-body td:last-child").forEach(function (c) { var r = document.createElement("button"); r.type = "button"; r.setAttribute("aria-label", "Row action"); r.textContent = "Reject"; window.__awkitCoverage.intents.set(r, "reject"); c.replaceChildren(r); })`,
        expect: "refuse"
      },
      {
        id: "rows-generic-data-action",
        title: "N4 generic data-action: the wrappers flip and Reject is enabled: no loop, nothing clicked (was reject x6)",
        change:
          `document.querySelectorAll("#lab-body span.wrap > button").forEach(function (b) { b.disabled = false; b.parentElement.replaceWith(b); });` +
          wrapEach("#lab-body td:last-child > button:first-child"),
        expect: "refuse"
      },
      {
        id: "rows-generic-title",
        title: "N5 generic title: each Approve icon becomes a Reject icon, title kept: no loop, nothing clicked (was reject x6)",
        change: `document.querySelectorAll("#lab-body button").forEach(function (b) { window.__awkitCoverage.intents.set(b, "reject"); b.querySelector("path").setAttribute("d", "M3 3l10 10M13 3L3 13"); })`,
        expect: "refuse"
      },
      {
        id: "rows-generic-lone",
        title: "N4 lone generic label: Approve → Reject in every row, label kept: no loop, nothing clicked (was reject x6)",
        change: `document.querySelectorAll("#lab-body button").forEach(function (b) { b.textContent = b.textContent.replace("Approve", "Reject"); window.__awkitCoverage.intents.set(b, "reject"); })`,
        expect: "refuse"
      },
      {
        id: "rows-generic-lone",
        title: "N4 lone generic label: a Reject with the same label added to every row after generation: no loop, nothing clicked",
        change: `document.querySelectorAll("#lab-body td:last-child").forEach(function (c) { var r = document.createElement("button"); r.type = "button"; r.setAttribute("aria-label", "Row action"); r.textContent = "Reject"; window.__awkitCoverage.intents.set(r, "reject"); c.prepend(r); })`,
        expect: "refuse"
      },
      // Positive control: a data-action that names what the control's own text says still loops, and survives the page.
      { id: "rows-lone-action", title: "lone data-action identity, as made: Approve in all 6 rows", expect: { status: "passed", clicks: clicks("approve", ...ALL) } },
      {
        id: "rows-lone-action",
        title: "lone data-action identity: a Reject (data-action=reject) added to every row after generation, actions reversed: Approve in all 6 rows",
        change:
          `document.querySelectorAll("#lab-body td:last-child").forEach(function (c) { var r = document.createElement("button"); r.type = "button"; r.setAttribute("data-action", "reject"); r.textContent = "Reject"; window.__awkitCoverage.intents.set(r, "reject"); c.prepend(r); Array.prototype.slice.call(c.children).reverse().forEach(function (k) { c.appendChild(k); }); })`,
        expect: { status: "passed", clicks: clicks("approve", ...ALL) }
      },
      {
        id: "rows-lone-action",
        title: "lone data-action identity: Approve → Unapprove (text and data-action) in INV-3001 and INV-3002: the other 4 Approves",
        change: `Array.prototype.slice.call(document.querySelectorAll("#lab-body tr"), 0, 2).forEach(function (r) { var b = r.querySelector("button"); b.textContent = b.textContent.replace("Approve", "Unapprove"); b.setAttribute("data-action", "unapprove"); window.__awkitCoverage.intents.set(b, "unapprove"); })`,
        expect: { status: "passed", clicks: clicks("approve", 3003, 3004, 3005, 3006) }
      },
      {
        id: "rows-lone-action",
        title: "lone data-action identity: every Approve wrapped: nothing matches, nothing clicked",
        change: wrapEach("#lab-body button[data-action=approve]"),
        expect: { status: "passed", clicks: [] }
      },
      // F3 (P2, bounded): a state-filtered loop re-resolves every iteration, so an Approve that disables itself when
      // clicked shifts the rest. Its exact, deterministic outcome is pinned: INV-3001, 3003, 3006, then a stop.
      {
        id: "rows-disabled-hidden",
        title: "F3: each Approve disables itself when clicked: INV-3001, 3003 and 3006 clicked, then the loop stops, never another action",
        change: `document.querySelectorAll("#lab-body button").forEach(function (b) { b.addEventListener("click", function () { b.disabled = true; }); })`,
        timeoutMs: 1_500,
        expect: { status: "failed", clicks: clicks("approve", 3001, 3003, 3006) }
      }
    ];
    const outcomes: Array<{ scenario: (typeof scenarios)[number]; observed: { ok: boolean; loop: string | null }; run: LoopRun }> = [];
    for (const scenario of scenarios) {
      const proven = runs[0].find((o) => o.id === scenario.id);
      const page = await browser.newPage();
      await page.goto(urlOf(scenario.id));
      await page.evaluate(runtime("arm(null)"));
      await recordClicks(page);
      if (scenario.change) await page.evaluate(scenario.change);
      // Without a loop nothing is executed; the page's own click record still proves nothing was clicked.
      const run: LoopRun = proven?.loop ? await runLoop(page, proven, root, scenario.timeoutMs) : { status: "no-loop", clicked: await clickedSoFar(page) };
      const observed = { ok: proven?.ok === true, loop: proven?.loop ?? null };
      outcomes.push({ scenario, observed, run });
      const reasons = judgeScenario(scenario.expect, observed, run);
      check(`${scenario.id}: ${scenario.title}`, reasons.length === 0, { reasons, run });
      await page.close();
    }

    // ── G. L12.27: the scenario judge's own failure modes, on altered copies of real outcomes ──────────
    console.log("G. Mutation controls: the scenario judge fails for each defect it exists to catch");
    {
      const find = (id: string, title: string) => outcomes.find((o) => o.scenario.id === id && o.scenario.title.startsWith(title))!;
      const judge = (o: (typeof outcomes)[number], run: Partial<LoopRun>, observed: Partial<{ ok: boolean; loop: string | null }> = {}) =>
        judgeScenario(o.scenario.expect, { ...o.observed, ...observed }, { ...o.run, ...run });
      const full = find("rows-approve-reject", "the loop as made");
      check("a sibling action clicked alongside the picked one fails", judge(full, { clicked: [...full.run.clicked.slice(0, 5), "reject@INV-3006"] }).length > 0);
      check("one click fewer fails", judge(full, { clicked: full.run.clicked.slice(1) }).length > 0);
      check("one extra Approve click fails", judge(full, { clicked: [...full.run.clicked, "approve@INV-3006"] }).length > 0);
      check("the right action in the wrong row fails", judge(full, { clicked: full.run.clicked.map((c, i) => (i === 0 ? "approve@INV-3009" : c)) }).length > 0);
      check("a failed run where a pass is expected fails", judge(full, { status: "failed" }).length > 0);
      const refuse = find("rows-qc-link-reject", "L12.26 QC probe 1");
      check("a refusal scenario with a generated loop fails, even when nothing was clicked", judge(refuse, {}, { loop: "tbody > tr > td > button" }).length > 0);
      check("a refusal scenario whose loop was executed fails", judge(refuse, { status: "passed" }).length > 0);
      check("a refusal scenario with any click fails", judge(refuse, { clicked: ["unapprove@INV-3001"] }).length > 0);
      check("a refusal that comes from a failed similar-rows call (a crash) fails", judge(refuse, {}, { ok: false }).length > 0);
      const broadened = find("rows-approve-reject", "a second Approve in one row");
      check("a broadening scenario that fails for another reason fails", judge(broadened, { error: "Timeout 1500ms exceeded" }).length > 0);
      check("a broadening scenario that passes fails", judge(broadened, { status: "passed", error: undefined }).length > 0);
      check("a broadening scenario that clicked before refusing fails", judge(broadened, { clicked: ["approve@INV-3001"] }).length > 0);
      const f3 = find("rows-disabled-hidden", "F3");
      check("F3: a different number of rows clicked fails", judge(f3, { clicked: f3.run.clicked.slice(0, 2) }).length > 0);
      check("F3: completing where the loop must stop fails", judge(f3, { status: "passed" }).length > 0);
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
