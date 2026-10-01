/**
 * verify:dom-intelligence-acceptance / benchmark:dom-intelligence-acceptance — the L11 old-versus-new
 * acceptance benchmark (awkit-djnl.19, L11.I).
 *
 * Identical fixtures for every engine, through the production code:
 *   A  legacy     LocatorFactory recovery with the pre-L11 per-element loops (`recoveryEngine: "legacy"`);
 *   B  snapshot   LocatorFactory recovery as shipped (one `evaluateAll` per layer, the unchanged gate, the
 *                 L11.F route, page, frame and actionability bindings, the stale-snapshot re-check);
 *   C  scrapling  the parser-only host's top candidate for the same sanitized snapshot and the step's
 *                 bound DOM reference — EVIDENCE ONLY, never executed by the product; its "wrong" count is
 *                 wrong candidates, not actions;
 *   D  proof      C's candidate acted on only when AWKIT's proof (same competitor set, same bindings,
 *                 actionability) proves it — what an executing provider would be allowed to do;
 *   plus `product`: B followed by the non-executing suggestion stage, i.e. the full failure-path cost.
 *
 * Fixtures: the 16 frozen L10.0 drift pairs (scripts/dom-intelligence/fixtures.mts), recorded through the
 * REAL Recorder init script and buildRecordedFlow, every candidate forced to miss so recovery runs; the
 * Feature Test Lab's /dom-context-lab for route mismatch, iframe (drift and gone), popup, virtualized,
 * delayed render and a stale reference; the recorded steps resolving unchanged for the normal-step
 * overhead; and a synthetic DOM-size series. The REAL staged host serves C and D.
 *
 * Judged (verify mode): zero wrong-element results for A, B and D (L10.0's documented residual is the
 * recorded locator itself and is reported apart); no recovery A gets right that B loses; warm B recovery
 * p95 < 500 ms on the accepted representative fixtures (recoverable L10.0 pairs + the iframe drift);
 * every expected refusal refused; all 16 classes covered. Recorded: per-engine outcomes and latencies
 * (p50, p95), serialization, parse and match, proof, snapshot capture, host cold/warm start and memory,
 * DOM-size scaling, and the normal-step overhead with DOM intelligence on versus off.
 *
 * `--write` (benchmark:dom-intelligence-acceptance) writes docs/plans/ai-upgrade-v5/evidence/L11-acceptance-results.json.
 * Exit 2 (NOT RUN) without the pinned runtime inputs.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium, type Browser, type Frame, type Locator, type Page } from "playwright";

import type { FlowStep, LocatorElementFingerprint } from "@src/profiles/FlowProfile";
import { buildRecordedFlow } from "@src/recorder/buildRecordedFlow";
import { getRecorderInitScriptContent } from "@src/recorder/recorderInitScript";
import type { RecordedAction } from "@src/recorder/RecorderTypes";
import { LocatorFactory, type LocatorRecoveryEngine, type LocatorRecoveryEvent } from "@src/runner/LocatorFactory";
import type { LocatorBlueprintStore, PageBlueprint } from "@src/runner/LocatorBlueprintStore";
import { FileLocatorRecoveryStore, stepCandidatesDigest } from "@src/runner/LocatorRecoveryStore";
import { createPageFingerprint, hashFingerprint } from "@src/runner/locatorFingerprint";
import { rankLocalRecovery } from "@src/runner/recoverySnapshot";
import { MemoryDomReferenceStore, type DomReferenceRecord } from "@src/runner/domIntelligence/domReference";
import { captureDomSnapshot } from "@src/runner/domIntelligence/domSnapshot";
import type { ScraplingDomIntelligenceProvider } from "@src/runner/domIntelligence/ScraplingDomIntelligenceProvider";
import { compareRoutes, routeKey } from "@src/runner/routeIdentity";
import { DOM_CASES, fixtureSetHash, type DomCase } from "./dom-intelligence/fixtures.mts";
import { stageHost } from "./dom-intelligence/stagedHost.mts";

const WRITE = process.argv.includes("--write");
const RESULTS = "docs/plans/ai-upgrade-v5/evidence/L11-acceptance-results.json";
const ANCHOR = '[data-l11-anchor="target"]';
const ENGINES = ["legacy", "snapshot", "scrapling", "proof", "product"] as const;
type Engine = (typeof ENGINES)[number];
type Outcome = "correct" | "WRONG" | "unresolved" | "refused" | "error";
interface Result {
  outcome: Outcome;
  ms: number;
  detail?: string;
}
interface Row {
  class: string;
  caseId: string;
  expect: "recover" | "refuse";
  engines: Partial<Record<Engine, Result>>;
  timings: Record<string, number>;
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
const pct = (values: number[], p: number) => {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] * 10) / 10 : NaN;
};
const median = (values: number[]) => pct(values, 50);
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

function workingSetKb(pid: number | undefined): number | undefined {
  if (!pid) return undefined;
  const run = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true });
  const match = /"([\d,.\s]+) K"/.exec(run.stdout ?? "");
  return match ? Number(match[1].replace(/[^\d]/g, "")) : undefined;
}

/** Resolve, then judge the returned locator against `truth` (null: any element is wrong). Never acts. */
async function judge(run: () => Promise<Locator>, truth: ((element: Element) => boolean) | null): Promise<Result> {
  const started = performance.now();
  let locator: Locator;
  try {
    locator = await run();
  } catch (error) {
    const detail = (error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, 160);
    return { outcome: /matched multiple|matches \d+ elements|ambiguous/i.test(detail) ? "refused" : "error", ms: performance.now() - started, detail };
  }
  const ms = performance.now() - started;
  const count = await locator.count().catch(() => 0);
  if (count === 0) return { outcome: "unresolved", ms };
  if (count > 1) return { outcome: "refused", ms };
  if (!truth) return { outcome: "WRONG", ms };
  return { outcome: (await locator.evaluate(truth).catch(() => false)) ? "correct" : "WRONG", ms };
}

const truthOf = (selector: string | null) => (selector ? (new Function("el", `return el === el.ownerDocument.querySelector(${JSON.stringify(selector)});`) as (el: Element) => boolean) : null);

/**
 * C and D on one frame: the sanitized snapshot, the host's top candidate, and AWKIT's proof of it over the
 * same competitor set. `bound` carries the product's bindings that precede any proof (route, reference).
 */
async function providerEngines(
  frame: Frame,
  provider: ScraplingDomIntelligenceProvider,
  step: FlowStep,
  expected: LocatorElementFingerprint,
  reference: DomReferenceRecord | undefined,
  truth: ((element: Element) => boolean) | null
): Promise<{ scrapling: Result; proof: Result; timings: Record<string, number> }> {
  const timings: Record<string, number> = {};
  const started = performance.now();
  if (!reference) {
    // No bound reference (stale or none): the product's suggestion stage skips, so neither engine has a candidate.
    const skipped = { outcome: "unresolved" as const, ms: performance.now() - started, detail: "no bound reference" };
    return { scrapling: skipped, proof: skipped, timings };
  }
  const snapshot = await captureDomSnapshot(frame, { mode: "recover", expected });
  timings.serializeMs = performance.now() - started;
  if (snapshot.refused) {
    const refused = { outcome: "unresolved" as const, ms: performance.now() - started, detail: "protected surface" };
    return { scrapling: refused, proof: refused, timings };
  }
  timings.htmlBytes = Buffer.byteLength(snapshot.html);
  const asked = performance.now();
  const result = await provider.findRecoveryCandidates({ html: snapshot.html, reference, maxCandidates: 5 });
  timings.providerRoundTripMs = performance.now() - asked;
  if (!result.ok) {
    const failure = { outcome: "unresolved" as const, ms: performance.now() - started, detail: result.code };
    return { scrapling: failure, proof: failure, timings };
  }
  timings.parseMs = result.parseMs;
  timings.matchMs = result.matchMs;
  const top = result.candidates[0];
  const allElements = frame.locator("body *");
  const scraplingMs = performance.now() - started;
  const scrapling: Result = !top
    ? { outcome: "unresolved", ms: scraplingMs }
    : !truth
      ? { outcome: "WRONG", ms: scraplingMs, detail: `candidate ${top.index} at ${top.score}%` }
      : { outcome: (await allElements.nth(top.index).evaluate(truth).catch(() => false)) ? "correct" : "WRONG", ms: scraplingMs, detail: `${top.score}%` };
  // D: the candidate acts only when AWKIT's proof over the same competitor set picks it, and it can act.
  const proofStarted = performance.now();
  const decision = snapshot.candidatesTruncated ? undefined : rankLocalRecovery(step, expected, snapshot.candidates);
  let proof: Result;
  if (!top || !decision?.winner || decision.winner.index !== top.index) {
    proof = { outcome: "unresolved", ms: 0, detail: decision?.refusal ?? (top ? "not AWKIT's winner" : "no candidate") };
  } else {
    const element = allElements.nth(top.index);
    const enabled = step.type === "click" || step.type === "fill" ? await element.isEnabled().catch(() => false) : true;
    proof = !enabled
      ? { outcome: "unresolved", ms: 0, detail: "not-actionable" }
      : !truth
        ? { outcome: "WRONG", ms: 0 }
        : { outcome: (await element.evaluate(truth).catch(() => false)) ? "correct" : "WRONG", ms: 0 };
  }
  timings.proofMs = performance.now() - proofStarted;
  proof.ms = scraplingMs + timings.proofMs;
  return { scrapling, proof, timings };
}

async function main(): Promise<void> {
  const staged = stageHost("awkit-l11-acceptance-");
  if (!staged) {
    console.log("NOT RUN: the pinned runtime inputs are absent (npm run benchmark:dom-intelligence-runtime-setup).");
    process.exit(2);
  }
  const root = await mkdtemp(join(tmpdir(), "awkit-l11-acceptance-"));
  const rows: Row[] = [];
  const overhead: { offMs: number[]; onMs: number[]; firstOnMs: number[] } = { offMs: [], onMs: [], firstOnMs: [] };
  const scaling: Array<Record<string, number>> = [];
  let browser: Browser | undefined;
  let fixtureServer: Server | undefined;
  let mockSite: ChildProcess | undefined;
  const provider = staged.provider();
  const host: Record<string, number | undefined> = {};
  try {
    const cold = performance.now();
    const status = await provider.getStatus();
    host.coldStartMs = Math.round(performance.now() - cold);
    host.workingSetKbAfterStart = workingSetKb(provider.pid);
    check("the staged parser-only host is available (parser-only, no browser, no network)", status.available && !status.browserAccess && !status.networkAccess, status);

    // ── Fixture server: the frozen L10.0 pairs and the DOM-size series ───────────────────────────
    const scalePage = (rows: number): string => {
      const base = DOM_CASES[0].baseline;
      const filler = Array.from({ length: rows }, (_, i) => `<tr><td>#${9000 + i}</td><td>Filler ${i}</td><td>$${i}.00</td><td><span class="badge">Paid</span></td><td><a class="row-link" href="/orders/${9000 + i}">View</a> <button type="button" class="btn btn-small">Refund</button></td></tr>`).join("");
      return base.replace('<section class="order-form"', `<table class="archive"><tbody>${filler}</tbody></table><section class="order-form"`);
    };
    const byId = new Map(DOM_CASES.map((c) => [c.id, c]));
    fixtureServer = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://x");
      const caseMatch = /^\/case\/([a-z0-9-]+)$/.exec(url.pathname);
      const scaleMatch = /^\/scale\/(\d+)$/.exec(url.pathname);
      const html = caseMatch ? (url.searchParams.get("v") === "mutated" ? byId.get(caseMatch[1])?.mutated : byId.get(caseMatch[1])?.baseline) : scaleMatch ? scalePage(Number(scaleMatch[1])) : undefined;
      if (!html) return void response.writeHead(404).end();
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
    });
    const base = await new Promise<string>((done) => fixtureServer!.listen(0, "127.0.0.1", () => done(`http://127.0.0.1:${(fixtureServer!.address() as { port: number }).port}`)));
    browser = await chromium.launch();

    // ── Part 1: the 16 frozen L10.0 drift pairs (classes 2-10 and the rest of the set) ──────────
    console.log("Part 1: the frozen L10.0 drift pairs, every recorded candidate forced to miss");
    const classOf: Record<string, string> = {
      "wrapper-insertion": "2 wrapper insertion",
      "moved-within-region": "3 element moved",
      "id-changed": "4 id change",
      "id-removed": "4 id removal",
      "class-changed": "5 class change",
      "text-drift": "6 text drift",
      "sibling-reorder": "7 sibling reordering",
      "duplicate-text-decoy": "8 duplicate visible text",
      "same-tag-decoy-target-removed": "9 same-tag decoy",
      "other-region-decoy-target-removed": "10 cross-region same-label decoy",
      "list-item-link": "8 duplicate visible text (list rows)",
      "aria-retained": "L10.0 aria retained",
      "page-variant-same-url": "L10.0 page variant (no match)",
      "combined-drift": "L10.0 combined drift",
      "large-dom-shift": "L10.0 large DOM shift",
      "field-relabel": "L10.0 field relabel"
    };
    for (const fixture of DOM_CASES) {
      const { step, blueprint, reference } = await recordStep(browser, base, fixture);
      const blueprintStore: LocatorBlueprintStore = {
        get: async (pageKey) => (blueprint && pageKey === blueprint.pageKey ? blueprint : undefined),
        put: async () => undefined,
        list: async () => (blueprint ? [blueprint] : [])
      };
      const store = new FileLocatorRecoveryStore(join(root, fixture.id));
      const forced = structuredClone(step);
      forced.id = `${step.id}-forced`;
      forced.locator = { ...forced.locator!, strategy: "css", value: ANCHOR, name: undefined, exact: undefined, alternatives: [], guard: undefined };
      const references = new MemoryDomReferenceStore();
      // The forced step's candidates differ from the recorded ones, so the recorded reference is re-bound to
      // them (a harness step: the element description is unchanged).
      const bound = reference ? { ...reference, bindingDigest: stepCandidatesDigest(forced.locator!) } : undefined;
      if (bound) await references.put(bound);
      // The normal-step overhead runs the RECORDED step, whose reference refresh would rebind the same id to
      // the recorded candidates: it gets its own store, so the forced step keeps its bound reference.
      const overheadReferences = new MemoryDomReferenceStore();
      const factory = (page: Page, engine: LocatorRecoveryEngine, scope: string, withProvider = false, events?: LocatorRecoveryEvent[]) =>
        new LocatorFactory(page, {
          recoveryStore: store,
          blueprintStore,
          scope: { scenarioId: `l11-${fixture.id}-${scope}`, flowId: "l11" },
          recoveryGraceMs: 0,
          recoveryEngine: engine,
          ...(withProvider ? { domIntelligence: { provider, references: scope === "first-on" ? overheadReferences : references, budgetMs: 800 } } : {}),
          onRecoveryEvent: (event) => events?.push(event)
        });

      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`${base}/case/${fixture.id}?v=baseline`);
      const target = page.locator(fixture.targetSelector);
      const expected = hashFingerprint(await target.evaluate(createPageFingerprint));
      await target.evaluate((element) => element.setAttribute("data-l11-anchor", "target"));
      for (const scope of ["legacy", "snapshot", "product"] as const) await factory(page, scope === "legacy" ? "legacy" : "snapshot", scope).resolve(forced);
      // Class 1: the recorded locator resolves unchanged, DOM intelligence off versus on.
      await factory(page, "snapshot", "plain").resolve(step);
      const t0 = performance.now();
      await factory(page, "snapshot", "first-on", true).resolve(step);
      overhead.firstOnMs.push(performance.now() - t0);
      for (let i = 0; i < 6; i += 1) {
        let started = performance.now();
        await factory(page, "snapshot", "plain").resolve(step);
        overhead.offMs.push(performance.now() - started);
        started = performance.now();
        await factory(page, "snapshot", "first-on", true).resolve(step);
        overhead.onMs.push(performance.now() - started);
      }

      await page.goto(`${base}/case/${fixture.id}?v=mutated`);
      const truth = truthOf(fixture.truthSelector);
      const row: Row = { class: classOf[fixture.id] ?? fixture.id, caseId: fixture.id, expect: fixture.expectation === "recoverable" ? "recover" : "refuse", engines: {}, timings: {} };
      row.engines.legacy = await judge(() => factory(page, "legacy", "legacy").resolve(forced), truth);
      const events: LocatorRecoveryEvent[] = [];
      row.engines.snapshot = await judge(() => factory(page, "snapshot", "snapshot", false, events).resolve(forced), truth);
      const trace = events.find((event) => event.trace)?.trace;
      for (const stage of trace?.stages ?? []) row.timings[`${stage.stage}StageMs`] = Math.round(stage.ms * 10) / 10;
      const productEvents: LocatorRecoveryEvent[] = [];
      row.engines.product = await judge(() => factory(page, "snapshot", "product", true, productEvents).resolve(forced), truth);
      const engines = await providerEngines(page.mainFrame(), provider, forced, expected, bound, truth);
      row.engines.scrapling = engines.scrapling;
      row.engines.proof = engines.proof;
      Object.assign(row.timings, engines.timings);
      rows.push(row);
      console.log(`    ${fixture.id.padEnd(34)} ${ENGINES.map((e) => `${e}=${row.engines[e]?.outcome}`).join("  ")}${reference ? "" : "  (no recorded reference)"}  [${row.engines.scrapling?.detail ?? ""}]`);
      await context.close();
    }

    // ── Part 2: dynamic contexts on /dom-context-lab (classes 11-16) ─────────────────────────────
    console.log("Part 2: dynamic contexts (route, iframe, popup, virtualized, delayed, stale reference)");
    const port = 4400 + Math.floor(Math.random() * 500);
    const lab = `http://127.0.0.1:${port}`;
    mockSite = spawn(process.execPath, ["mock-site/server.mjs"], { env: { ...process.env, MOCK_SITE_PORT: String(port) }, stdio: ["ignore", "ignore", "inherit"], windowsHide: true });
    for (let i = 0; i < 80 && !(await fetch(`${lab}/dom-context-lab`).then((r) => r.ok, () => false)); i += 1) await sleep(100);
    let counter = 0;
    const dynamic = async (
      cls: string,
      expect: Row["expect"],
      setup: (page: Page) => Promise<{
        step: FlowStep;
        frame: () => Promise<Frame>;
        mutate: () => Promise<void>;
        truth: ((el: Element) => boolean) | null;
        editLocator?: boolean;
        resolvePage?: () => Page;
        /** Time-dependent pages (delayed render): re-apply the mutation before each engine, so each starts alike. */
        remutate?: boolean;
      }>
    ) => {
      counter += 1;
      const store = new FileLocatorRecoveryStore(join(root, `dyn-${counter}`));
      const references = new MemoryDomReferenceStore();
      const context = await browser!.newContext();
      const page = await context.newPage();
      const plan = await setup(page);
      const on = () => plan.resolvePage?.() ?? page;
      const factory = (engine: LocatorRecoveryEngine, scope: string, withProvider = true, events?: LocatorRecoveryEvent[]) =>
        new LocatorFactory(on(), {
          recoveryStore: store,
          scope: { scenarioId: `l11-dyn-${counter}-${scope}`, flowId: "l11" },
          recoveryGraceMs: 0,
          recoveryEngine: engine,
          ...(withProvider ? { domIntelligence: { provider, references, budgetMs: 800 } } : {}),
          onRecoveryEvent: (event) => events?.push(event)
        });
      const targetFrame = await plan.frame();
      const expected = hashFingerprint(await targetFrame.locator(`[data-testid="${plan.step.locator!.value}"]`).evaluate(createPageFingerprint));
      // Seed each engine's winner memory and the step's bound reference, as a first successful run would.
      for (const scope of ["legacy", "snapshot", "product"]) await factory(scope === "legacy" ? "legacy" : "snapshot", scope).resolve(plan.step);
      let step = plan.step;
      if (plan.editLocator) {
        // The user edited the locator afterwards (to one that no longer matches): memory and the reference
        // stay bound to the old candidates, so neither may drive a recovery for the new ones.
        step = { ...plan.step, locator: { ...plan.step.locator!, alternatives: [{ strategy: "testId", value: "dcl-route-export-v2" }] } };
      }
      await plan.mutate();
      const row: Row = { class: cls, caseId: cls, expect, engines: {}, timings: {} };
      const again = async () => {
        if (plan.remutate) await plan.mutate();
      };
      row.engines.legacy = await judge(() => factory("legacy", "legacy", false).resolve(step), plan.truth);
      await again();
      row.engines.snapshot = await judge(() => factory("snapshot", "snapshot", false).resolve(step), plan.truth);
      await again();
      row.engines.product = await judge(() => factory("snapshot", "product").resolve(step), plan.truth);
      await again();
      const frame = await plan.frame();
      const reference = step.locator?.blueprintId ? await references.get(step.locator.blueprintId, stepCandidatesDigest(step.locator)) : undefined;
      // The product's binding that precedes any proof: a reference from another route is never used.
      const routeOk = !reference || compareRoutes(reference.route, routeKey(frame.url())) !== "mismatch";
      const engines = routeOk
        ? await providerEngines(frame, provider, step, expected, reference, plan.truth)
        : await (async () => {
            const scrapling = (await providerEngines(frame, provider, step, expected, reference, plan.truth)).scrapling;
            return { scrapling, proof: { outcome: "unresolved" as const, ms: 0, detail: "route-mismatch" }, timings: {} };
          })();
      row.engines.scrapling = engines.scrapling;
      row.engines.proof = engines.proof;
      Object.assign(row.timings, engines.timings);
      rows.push(row);
      console.log(`    ${cls.padEnd(34)} ${ENGINES.map((e) => `${e}=${row.engines[e]?.outcome}`).join("  ")}`);
      await context.close();
    };
    const lbl = (id: number): FlowStep => ({ id: `dyn-step-${id}`, name: `Dynamic ${id}`, type: "click", locator: { strategy: "testId", value: "", blueprintId: `dyn-ref-${id}` } }) as FlowStep;
    const withTestId = (step: FlowStep, value: string, extra: Partial<FlowStep["locator"]> = {}): FlowStep => ({ ...step, locator: { ...step.locator!, value, ...extra } as FlowStep["locator"] });
    const frameOf = async (page: Page) => {
      const frame = await (await page.locator('[data-testid="dcl-frame"]').elementHandle())?.contentFrame();
      if (!frame) throw new Error("no frame");
      // The frame's document, not its target: a case may have removed the target on purpose.
      await frame.waitForSelector('[data-testid="dcl-frame-result"]', { state: "attached" });
      return frame;
    };

    await dynamic("11 route mismatch", "refuse", async (page) => {
      await page.goto(`${lab}/dom-context-lab/route/orders`);
      return { step: withTestId(lbl(1), "dcl-route-export"), frame: async () => page.mainFrame(), mutate: async () => void (await page.getByTestId("dcl-go-archive").click()), truth: null };
    });
    await dynamic("12 iframe (drift)", "recover", async (page) => {
      await page.goto(`${lab}/dom-context-lab`);
      await frameOf(page);
      return {
        step: withTestId(lbl(2), "dcl-frame-save", { context: { frameChain: [{ selector: '[data-testid="dcl-frame"]' }] } }),
        frame: () => frameOf(page),
        mutate: async () => void (await (await frameOf(page)).evaluate(() => (window as unknown as { __dclFrame: { dropTestId: () => void } }).__dclFrame.dropTestId())),
        truth: (el: Element) => el.ownerDocument.defaultView !== el.ownerDocument.defaultView?.top && el.textContent === "Save settings"
      };
    });
    await dynamic("12 iframe (target gone)", "refuse", async (page) => {
      await page.goto(`${lab}/dom-context-lab`);
      await frameOf(page);
      return {
        step: withTestId(lbl(3), "dcl-frame-save", { context: { frameChain: [{ selector: '[data-testid="dcl-frame"]' }] } }),
        frame: () => frameOf(page),
        mutate: async () => void (await (await frameOf(page)).evaluate(() => (window as unknown as { __dclFrame: { removeTarget: () => void } }).__dclFrame.removeTarget())),
        truth: null
      };
    });
    await dynamic("13 popup (parent target gone)", "refuse", async (page) => {
      await page.goto(`${lab}/dom-context-lab`);
      return {
        step: withTestId(lbl(4), "dcl-parent-confirm"),
        frame: async () => page.mainFrame(),
        mutate: async () => {
          await Promise.all([page.waitForEvent("popup"), page.getByTestId("dcl-open-popup").click()]);
          await page.evaluate(() => (window as unknown as { __dcl: { removeParentTarget: () => void } }).__dcl.removeParentTarget());
        },
        truth: null
      };
    });
    await dynamic("14 virtualized (row unmounted)", "refuse", async (page) => {
      await page.goto(`${lab}/dom-context-lab`);
      return {
        step: withTestId(lbl(5), "dcl-view-ORD-1003"),
        frame: async () => page.mainFrame(),
        mutate: async () => void (await page.evaluate(() => (window as unknown as { __dcl: { virtual: { scrollTo: (n: number) => void } } }).__dcl.virtual.scrollTo(6_000))),
        truth: null
      };
    });
    await dynamic("15 delayed render (skeleton)", "refuse", async (page) => {
      await page.goto(`${lab}/dom-context-lab`);
      await page.getByTestId("dcl-delayed-load").click();
      await page.getByTestId("dcl-delayed-download").waitFor();
      return { step: withTestId(lbl(6), "dcl-delayed-download"), frame: async () => page.mainFrame(), mutate: async () => void (await page.getByTestId("dcl-delayed-load").click()), truth: null, remutate: true };
    });
    await dynamic("16 stale reference", "refuse", async (page) => {
      await page.goto(`${lab}/dom-context-lab/route/orders`);
      return {
        step: withTestId(lbl(7), "dcl-route-export"),
        frame: async () => page.mainFrame(),
        mutate: async () => void (await page.evaluate(() => (window as unknown as { __dcl: { dropRouteTestId: () => void } }).__dcl.dropRouteTestId())),
        truth: null,
        editLocator: true
      };
    });

    // ── Part 3: DOM-size scaling ─────────────────────────────────────────────────────────────────
    console.log("Part 3: DOM-size scaling (forced miss, the target unchanged, filler rows before it)");
    for (const fillerRows of [20, 90, 360, 900]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`${base}/scale/${fillerRows}`);
      const elements = await page.locator("body *").count();
      const store = new FileLocatorRecoveryStore(join(root, `scale-${fillerRows}`));
      const step: FlowStep = { id: `scale-${fillerRows}`, name: "Save changes", type: "click", locator: { strategy: "css", value: ANCHOR } } as FlowStep;
      const target = page.locator("#save-order");
      const expected = hashFingerprint(await target.evaluate(createPageFingerprint));
      const make = (engine: LocatorRecoveryEngine) => new LocatorFactory(page, { recoveryStore: store, scope: { scenarioId: `scale-${engine}`, flowId: "l11" }, recoveryGraceMs: 0, recoveryEngine: engine });
      const runs: Record<string, number[]> = { legacy: [], snapshot: [], serialize: [], find: [] };
      for (let rep = 0; rep < 3; rep += 1) {
        await target.evaluate((el) => el.setAttribute("data-l11-anchor", "target"));
        await make("legacy").resolve(step);
        await make("snapshot").resolve(step);
        await target.evaluate((el) => el.removeAttribute("data-l11-anchor"));
        for (const engine of ["legacy", "snapshot"] as const) {
          const result = await judge(() => make(engine).resolve(step), (el) => el.id === "save-order");
          if (result.outcome === "correct") runs[engine].push(result.ms);
        }
        const started = performance.now();
        const snapshot = await captureDomSnapshot(page.mainFrame(), { mode: "recover", expected });
        runs.serialize.push(performance.now() - started);
        if (!snapshot.refused) {
          const ref = { schemaVersion: 1, referenceId: "scale", bindingDigest: "0".repeat(64), source: "recorder", capturedAt: new Date().toISOString(), element: { tag: "button", attributes: { id: "save-order", type: "button", class: "btn btn-primary save-order" }, text: "Save changes", path: ["html", "body", "div", "main", "section", "form", "div", "button"], parent: { tag: "div", attributes: { class: "form-actions" }, text: "" }, siblings: ["button", "button"], children: [] } } as DomReferenceRecord;
          const found = await provider.findRecoveryCandidates({ html: snapshot.html, reference: ref, maxCandidates: 5 });
          if (found.ok) runs.find.push(found.parseMs + found.matchMs);
        }
      }
      scaling.push({ fillerRows, elements, legacyMs: median(runs.legacy), snapshotMs: median(runs.snapshot), serializeMs: median(runs.serialize), hostParseMatchMs: median(runs.find), legacyCorrect: runs.legacy.length, snapshotCorrect: runs.snapshot.length });
      console.log(
        `    ${String(elements).padStart(6)} elements  legacy ${runs.legacy.length}/3 recovered${runs.legacy.length ? ` ${median(runs.legacy)} ms` : ""}  snapshot ${runs.snapshot.length}/3 recovered ${median(runs.snapshot)} ms  serialize ${median(runs.serialize)} ms  host parse+match ${median(runs.find)} ms`
      );
      await context.close();
    }
    host.workingSetKbAfterRun = workingSetKb(provider.pid);
  } finally {
    await browser?.close().catch(() => undefined);
    fixtureServer?.close();
    mockSite?.kill();
    await provider.shutdown().catch(() => undefined);
    staged.cleanup();
    await rm(root, { recursive: true, force: true });
  }

  // ── Judgement ──────────────────────────────────────────────────────────────────────────────────
  console.log("Acceptance");
  const RESIDUAL = "other-region-decoy-target-removed";
  const count = (engine: Engine, outcome: Outcome) => rows.filter((r) => r.engines[engine]?.outcome === outcome).length;
  const classes = new Set(rows.map((r) => r.class.split(" ")[0]).filter((c) => /^\d+$/.test(c)));
  classes.add("1"); // the normal-step overhead row set below
  check("all 16 fixture classes are covered", [...Array(16)].every((_, i) => classes.has(String(i + 1))), [...classes].sort((a, b) => Number(a) - Number(b)));
  check("snapshot recovery (B): zero wrong-element results", count("snapshot", "WRONG") === 0, rows.filter((r) => r.engines.snapshot?.outcome === "WRONG").map((r) => r.caseId));
  check("the product failure path (B + suggestion): zero wrong-element results", count("product", "WRONG") === 0, rows.filter((r) => r.engines.product?.outcome === "WRONG").map((r) => r.caseId));
  check("Scrapling + AWKIT proof (D): zero wrong-element results", count("proof", "WRONG") === 0, rows.filter((r) => r.engines.proof?.outcome === "WRONG").map((r) => r.caseId));
  // A stays operator-selectable (AWKIT_LOCATOR_RECOVERY_ENGINE=legacy), so it is held to the same bar; it must
  // have run on every row, or zero wrong would be vacuous.
  check(
    "legacy recovery (A): ran on every row with zero wrong-element results",
    rows.length > 0 && rows.every((r) => r.engines.legacy) && count("legacy", "WRONG") === 0,
    { rows: rows.length, ran: rows.filter((r) => r.engines.legacy).length, wrong: rows.filter((r) => r.engines.legacy?.outcome === "WRONG").map((r) => r.caseId) }
  );
  check("no engine errored outside a refusal", ENGINES.every((engine) => count(engine, "error") === 0), rows.flatMap((r) => ENGINES.filter((e) => r.engines[e]?.outcome === "error").map((e) => `${r.caseId}/${e}: ${r.engines[e]?.detail}`)));
  const lost = rows.filter((r) => r.engines.legacy?.outcome === "correct" && r.engines.snapshot?.outcome !== "correct").map((r) => r.caseId);
  check("no recovery the legacy engine gets right is lost by the snapshot engine", lost.length === 0, lost);
  const refusals = rows.filter((r) => r.expect === "refuse");
  check("every expected refusal is refused or unresolved by B, the product path and D", refusals.every((r) => ["refused", "unresolved"].includes(r.engines.snapshot!.outcome) && ["refused", "unresolved"].includes(r.engines.product!.outcome) && ["refused", "unresolved"].includes(r.engines.proof!.outcome)), refusals.map((r) => `${r.caseId}:${r.engines.snapshot?.outcome}/${r.engines.product?.outcome}/${r.engines.proof?.outcome}`));
  const accepted = rows.filter((r) => r.expect === "recover" && r.engines.snapshot?.outcome === "correct");
  const snapshotMs = accepted.map((r) => r.engines.snapshot!.ms);
  check(`warm snapshot recovery p95 < 500 ms on the ${accepted.length} accepted representative fixtures`, accepted.length >= 8 && pct(snapshotMs, 95) < 500, { n: accepted.length, p50: pct(snapshotMs, 50), p95: pct(snapshotMs, 95) });
  const overheadDelta = median(overhead.onMs) - median(overhead.offMs);
  check("normal steps: DOM intelligence adds no measurable cost once a step's reference is bound (median delta < 5 ms)", Math.abs(overheadDelta) < 5, { offMedian: median(overhead.offMs), onMedian: median(overhead.onMs) });

  const summary = {
    fixtureSetHash: fixtureSetHash(),
    host,
    outcomes: Object.fromEntries(ENGINES.map((engine) => [engine, { correct: count(engine, "correct"), WRONG: count(engine, "WRONG"), unresolved: count(engine, "unresolved"), refused: count(engine, "refused"), error: count(engine, "error") }])),
    latencyMs: Object.fromEntries(
      ENGINES.map((engine) => {
        const ms = rows.map((r) => r.engines[engine]?.ms).filter((v): v is number => typeof v === "number");
        return [engine, { p50: pct(ms, 50), p95: pct(ms, 95), n: ms.length }];
      })
    ),
    acceptedSnapshotRecovery: { n: accepted.length, p50: pct(snapshotMs, 50), p95: pct(snapshotMs, 95) },
    stagesMs: Object.fromEntries(["localStageMs", "blueprintStageMs", "providerStageMs", "serializeMs", "providerRoundTripMs", "parseMs", "matchMs", "proofMs", "htmlBytes"].map((key) => [key, { p50: pct(rows.map((r) => r.timings[key]), 50), p95: pct(rows.map((r) => r.timings[key]), 95) }])),
    normalStep: { offMedianMs: median(overhead.offMs), onMedianMs: median(overhead.onMs), firstOnMedianMs: median(overhead.firstOnMs), samples: overhead.onMs.length },
    residual: `${RESIDUAL}: the recorded role=button locator itself matches the notifications-panel button once the form is gone (production config, not recovery; KNOWN_ISSUES)`,
    scaling
  };
  console.log(`  (info) ${JSON.stringify({ outcomes: summary.outcomes, latencyMs: summary.latencyMs, accepted: summary.acceptedSnapshotRecovery, normalStep: summary.normalStep, host })}`);
  if (WRITE) {
    writeFileSync(RESULTS, `${JSON.stringify({ generatedBy: "benchmark:dom-intelligence-acceptance", generatedAt: new Date().toISOString(), environment: { platform: process.platform, node: process.version }, summary, rows }, null, 2)}\n`);
    console.log(`  wrote ${RESULTS}`);
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

async function recordStep(browser: Browser, base: string, fixture: DomCase): Promise<{ step: FlowStep; blueprint: PageBlueprint | undefined; reference: DomReferenceRecord | undefined }> {
  const context = await browser.newContext();
  const actions: RecordedAction[] = [];
  const actionType = fixture.action ?? "click";
  try {
    await context.addInitScript({ content: getRecorderInitScriptContent() });
    await context.exposeBinding("__awtkit_recordAction", (_source, action) => actions.push(action as RecordedAction));
    await context.exposeBinding("__awtkit_recordSignal", () => undefined);
    const page = await context.newPage();
    await page.goto(`${base}/case/${fixture.id}?v=baseline`);
    if (actionType === "fill") {
      await page.locator(fixture.targetSelector).fill("Leave at the door");
      await page.keyboard.press("Tab");
    } else {
      await page.locator(fixture.targetSelector).click();
    }
    for (let attempt = 0; attempt < 60 && !actions.some((a) => a.type === actionType); attempt += 1) await page.waitForTimeout(50);
    const blueprints: PageBlueprint[] = [];
    const references: DomReferenceRecord[] = [];
    const flow = buildRecordedFlow(`l11 ${fixture.id}`, actions.filter((a) => a.type === actionType).slice(0, 1), blueprints, { domReferencesOut: references });
    const step = flow.nodes.find((node) => node.type === actionType) as FlowStep | undefined;
    if (!step?.locator) throw new Error(`${fixture.id}: the recorder captured no ${actionType} step`);
    return { step, blueprint: blueprints[0], reference: references[0] };
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
