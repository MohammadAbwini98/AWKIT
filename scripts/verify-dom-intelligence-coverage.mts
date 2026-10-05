/**
 * verify:dom-intelligence-coverage — L12.23 (awkit-djnl.21.23) deterministic DOM-intelligence coverage.
 *
 * Proves the `Scrapling → candidate → AWKIT identity proof → act/refuse` pipeline across the DOM Coverage Lab
 * corpus (mock-site/dom-coverage-corpus.mjs): the frozen L10.0 orders page (Layer 2), Test Lab fixtures
 * (Layer 1) and enterprise stand-ins (Layer 4), one target each, one in-place mutation per case.
 *
 * Per case: the target is recorded through the REAL Recorder init script and buildRecordedFlow, then the step's
 * locator is forced to miss (as the L11 acceptance benchmark does), so recovery runs. The winner memory is
 * seeded on the unmutated page, the case's mutation is applied in place, and two engines resolve the step:
 *   snapshot  LocatorFactory recovery as shipped, no provider;
 *   product   the same plus the REAL staged parser-only host (suggestion stage and the L12 agreement rule).
 * Each answer is judged against a verifier-only oracle (`data-testid="oracle-target"`, read then stripped
 * before the Recorder or any engine sees the page): correct, WRONG (any other element), unresolved/refused.
 *
 * The gate, a pure function: 0 WRONG and 0 error for both engines; a removed target stays empty; the product
 * answer equals each case's explicit expectation; every mutation changed the DOM and every memory was seeded;
 * three runs give identical decisions; the case and protected-case counts match the pins. The gate's own
 * failure modes are mutation-tested in-process (a wrong element accepted, a protected case removed, a run that
 * differs), and a live red control proves the browser oracle reports WRONG for a wrong element.
 *
 * Layer 3, the paths the L12 benchmark does not measure: Element Spy similar rows and loop selectors, Recorder
 * protected-login detection (Turnstile, Arkose, data-sitekey, reCAPTCHA, hCaptcha, OTP) and its per-navigation
 * cost, and the Super-User read-time challenge check in the serializer.
 *
 * Latency is a guardrail only: warm snapshot recovery p95 < 500 ms (L11) and the product path p95 < 800 ms
 * (the suggestion budget). `--write` saves docs/plans/ai-upgrade-v5/evidence/L12.23-coverage-results.json.
 * Exit 2 (NOT RUN) without the pinned runtime inputs.
 */
import { writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium, type Browser, type Locator, type Page } from "playwright";

import type { FlowStep } from "@src/profiles/FlowProfile";
import { buildRecordedFlow } from "@src/recorder/buildRecordedFlow";
import { getRecorderInitScriptContent } from "@src/recorder/recorderInitScript";
import type { RecordedAction } from "@src/recorder/RecorderTypes";
import { LocatorFactory, type LocatorRecoveryEvent } from "@src/runner/LocatorFactory";
import type { LocatorBlueprintStore, PageBlueprint } from "@src/runner/LocatorBlueprintStore";
import { FileLocatorRecoveryStore, stepCandidatesDigest } from "@src/runner/LocatorRecoveryStore";
import { MemoryDomReferenceStore, type DomReferenceRecord } from "@src/runner/domIntelligence/domReference";
import { DOM_INTELLIGENCE_LIMITS } from "@src/runner/domIntelligence/DomIntelligenceProvider";
import { captureDomSnapshot } from "@src/runner/domIntelligence/domSnapshot";
import type { ScraplingDomIntelligenceProvider } from "@src/runner/domIntelligence/ScraplingDomIntelligenceProvider";
import { extractSimilarRows } from "@src/runner/domIntelligence/similarRows";
import { detectRecorderProtectedLogin } from "@src/security/ProtectedLoginDetector";
import { CHALLENGE_PAGES, COVERAGE_FIXTURES, COVERAGE_RUNTIME, coveragePage, type CoverageExpectation, type CoverageFixture } from "../mock-site/dom-coverage-corpus.mjs";
import { DOM_CASES } from "./dom-intelligence/fixtures.mts";
import { stageHost } from "./dom-intelligence/stagedHost.mts";

const WRITE = process.argv.includes("--write");
const RESULTS = "docs/plans/ai-upgrade-v5/evidence/L12.23-coverage-results.json";
const RUNS = 3;
const ANCHOR = '[data-l11-anchor="target"]';
/** Pinned so a dropped fixture or protected case fails the gate instead of shrinking it. */
const PINNED = { fixtures: 25, cases: 97, refuse: 49 };
const BUDGET = { snapshotRecoveredP95Ms: 500, productP95Ms: 800, detectorP95Ms: 100 };

type Outcome = "correct" | "WRONG" | "unresolved" | "refused" | "error";
interface ManifestCase {
  id: string;
  fixture: string;
  layer: string;
  op: string;
  expect: CoverageExpectation;
  /** Why a target that still exists is refused (sensitive step, safe miss, hidden). */
  why?: string;
}
interface CaseRow {
  id: string;
  armed: number;
  leaks: number;
  seeded: boolean;
  changed: boolean;
  present: boolean;
  snapshot: Outcome;
  product: Outcome;
  snapshotMs: number;
  productMs: number;
  detail?: string;
  /** Seed outcomes and the product attempt's recovery stages, for diagnosis only. */
  trace?: string;
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
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] * 10) / 10 : NaN;
};
const EMPTY: readonly Outcome[] = ["unresolved", "refused"];

export const MANIFEST: ManifestCase[] = COVERAGE_FIXTURES.flatMap((fixture) =>
  fixture.cases.map(([op, expect, why]) => ({ id: `${fixture.id}/${op}`, fixture: fixture.id, layer: fixture.layer, op, expect, ...(why ? { why } : {}) }))
);

/**
 * The L12.23 gate over every run. Pure, so its own failure modes are tested against altered copies of the
 * real results. Returns the reasons it fails; empty means pass.
 */
export function coverageGate(manifest: ManifestCase[], runs: CaseRow[][]): string[] {
  const reasons: string[] = [];
  const fixtures = new Set(manifest.map((c) => c.fixture)).size;
  if (fixtures !== PINNED.fixtures) reasons.push(`fixture count ${fixtures}, pinned ${PINNED.fixtures}`);
  if (manifest.length !== PINNED.cases) reasons.push(`case count ${manifest.length}, pinned ${PINNED.cases}`);
  const refuse = manifest.filter((c) => c.expect === "refuse").length;
  if (refuse !== PINNED.refuse) reasons.push(`protected (refuse) case count ${refuse}, pinned ${PINNED.refuse}`);
  if (runs.length !== RUNS) reasons.push(`${runs.length} runs, expected ${RUNS}`);
  runs.forEach((rows, r) => {
    const ids = rows.map((row) => row.id).join("|");
    if (ids !== manifest.map((c) => c.id).join("|")) reasons.push(`run ${r + 1}: the result set differs from the manifest (${rows.length} rows for ${manifest.length} cases)`);
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const c of manifest) {
      const row = byId.get(c.id);
      if (!row) continue;
      if (row.armed !== 1) reasons.push(`run ${r + 1} ${c.id}: the oracle armed ${row.armed} elements, not 1`);
      if (row.leaks !== 0) reasons.push(`run ${r + 1} ${c.id}: ${row.leaks} oracle attributes reached the page`);
      if (!row.seeded) reasons.push(`run ${r + 1} ${c.id}: the winner memory was not seeded on the target`);
      if (!row.changed) reasons.push(`run ${r + 1} ${c.id}: the mutation changed nothing`);
      for (const engine of ["snapshot", "product"] as const) {
        const outcome = row[engine];
        if (outcome === "WRONG") reasons.push(`run ${r + 1} ${c.id}: ${engine} returned a WRONG element`);
        if (outcome === "error") reasons.push(`run ${r + 1} ${c.id}: ${engine} errored (${row.detail ?? ""})`);
        if (!row.present && !EMPTY.includes(outcome)) reasons.push(`run ${r + 1} ${c.id}: target removed but ${engine} returned ${outcome}`);
      }
      if (c.expect === "recover" && !row.present) reasons.push(`run ${r + 1} ${c.id}: expected recover but the mutation removed the target`);
      if (c.expect === "refuse" && row.present && !c.why) reasons.push(`run ${r + 1} ${c.id}: a refusal of a target that still exists must state why`);
      const met = c.expect === "recover" ? row.product === "correct" : EMPTY.includes(row.product);
      if (!met) reasons.push(`run ${r + 1} ${c.id}: expected ${c.expect}, product ${row.product}`);
    }
  });
  const decisions = runs.map((rows) => rows.map((row) => `${row.id}=${row.snapshot}/${row.product}`).join("|"));
  decisions.forEach((d, r) => {
    if (r > 0 && d !== decisions[0]) {
      const first = runs[0].find((row, i) => runs[r][i] && `${row.snapshot}/${row.product}` !== `${runs[r][i].snapshot}/${runs[r][i].product}`);
      reasons.push(`run ${r + 1} decisions differ from run 1${first ? ` (first at ${first.id})` : ""}`);
    }
  });
  return reasons;
}

const runtime = (call: string) => `${COVERAGE_RUNTIME} && window.__awkitCoverage.${call}`;
type CoverageWindow = { __awkitCoverage: { target: Element | null } };

/** Resolve, then judge the locator against the oracle target in its own top window. Never acts. */
async function judge(run: () => Promise<Locator>): Promise<{ outcome: Outcome; ms: number; detail?: string }> {
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
  const isTarget = await locator.evaluate((el) => el === (el.ownerDocument.defaultView!.top as unknown as CoverageWindow).__awkitCoverage.target).catch(() => false);
  return { outcome: isTarget ? "correct" : "WRONG", ms };
}

async function record(browser: Browser, url: string, fixture: CoverageFixture): Promise<{ step: FlowStep; blueprint?: PageBlueprint; reference?: DomReferenceRecord }> {
  const context = await browser.newContext();
  const actions: RecordedAction[] = [];
  try {
    await context.addInitScript({ content: getRecorderInitScriptContent() });
    await context.exposeBinding("__awtkit_recordAction", (_source, action) => actions.push(action as RecordedAction));
    await context.exposeBinding("__awtkit_recordSignal", () => undefined);
    const page = await context.newPage();
    await page.goto(url);
    const armed = (await page.evaluate(runtime(`arm(${JSON.stringify(fixture.target ?? null)})`))) as number;
    if (armed !== 1) throw new Error(`${fixture.id}: the oracle matched ${armed} elements`);
    // The handle must come from the frame that owns the element, or a click inside an iframe lands on the top page.
    let target = null;
    for (const frame of page.frames()) {
      target ??= (
        await frame.evaluateHandle(() => {
          const element = (window.top as unknown as CoverageWindow).__awkitCoverage.target;
          return element && element.ownerDocument === document ? element : null;
        })
      ).asElement();
    }
    if (!target) throw new Error(`${fixture.id}: no oracle target`);
    if (fixture.action === "fill") {
      await target.fill("Leave at the door");
      await page.keyboard.press("Tab");
    } else {
      await target.click();
    }
    for (let attempt = 0; attempt < 60 && !actions.some((a) => a.type === fixture.action); attempt += 1) await page.waitForTimeout(50);
    const blueprints: PageBlueprint[] = [];
    const references: DomReferenceRecord[] = [];
    const flow = buildRecordedFlow(`l12.23 ${fixture.id}`, actions.filter((a) => a.type === fixture.action).slice(0, 1), blueprints, { domReferencesOut: references });
    const step = flow.nodes.find((node) => node.type === fixture.action) as FlowStep | undefined;
    if (!step?.locator) throw new Error(`${fixture.id}: the recorder captured no ${fixture.action} step`);
    return { step, blueprint: blueprints[0], reference: references[0] };
  } finally {
    await context.close();
  }
}

async function runCase(
  browser: Browser,
  url: string,
  fixture: CoverageFixture,
  recorded: Awaited<ReturnType<typeof record>>,
  c: ManifestCase,
  provider: ScraplingDomIntelligenceProvider,
  root: string,
  run: number
): Promise<CaseRow> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(url);
    const armed = (await page.evaluate(runtime(`arm(${JSON.stringify(fixture.target ?? null)})`))) as number;
    const leaks = (await page.evaluate(runtime("leaks()"))) as number;
    const forced = structuredClone(recorded.step);
    forced.id = `${recorded.step.id}-forced`;
    forced.locator = { ...forced.locator!, strategy: "css", value: ANCHOR, name: undefined, exact: undefined, alternatives: [], guard: undefined };
    const references = new MemoryDomReferenceStore();
    if (recorded.reference) await references.put({ ...recorded.reference, bindingDigest: stepCandidatesDigest(forced.locator!) });
    const blueprint = recorded.blueprint;
    const blueprintStore: LocatorBlueprintStore = {
      get: async (pageKey) => (blueprint && pageKey === blueprint.pageKey ? blueprint : undefined),
      put: async () => undefined,
      list: async () => (blueprint ? [blueprint] : [])
    };
    const store = new FileLocatorRecoveryStore(join(root, `r${run}`, c.id.replace(/[^a-z0-9-]+/gi, "_")));
    const events: LocatorRecoveryEvent[] = [];
    const factory = (scope: string, withProvider: boolean) =>
      new LocatorFactory(page, {
        recoveryStore: store,
        blueprintStore,
        scope: { scenarioId: `cov-${c.id}-${scope}`, flowId: "l12-23" },
        recoveryGraceMs: 0,
        recoveryEngine: "snapshot",
        ...(withProvider ? { domIntelligence: { provider, references, budgetMs: 800 } } : {}),
        onRecoveryEvent: (event) => events.push(event)
      });
    // Seed each scope's winner memory on the unmutated page, as a first successful run would.
    await page.evaluate(() => (window as unknown as CoverageWindow).__awkitCoverage.target?.setAttribute("data-l11-anchor", "target"));
    const seeds = [await judge(() => factory("snapshot", false).resolve(forced)), await judge(() => factory("product", false).resolve(forced))];
    await page.evaluate(runtime("clearAnchor()"));
    const mutation = (await page.evaluate(runtime(`mutate(${JSON.stringify(c.op)})`))) as { changed: boolean; present: boolean };
    const snapshot = await judge(() => factory("snapshot", false).resolve(forced));
    events.length = 0;
    const product = await judge(() => factory("product", true).resolve(forced));
    const stages = events
      .flatMap((event) => event.trace?.stages ?? [])
      .map((s) => `${s.stage}:${s.outcome}${s.reason ? `(${s.reason})` : ""}${s.score !== undefined ? ` ${s.score.toFixed(3)}` : ""}${s.runnerUpScore !== undefined ? `/${s.runnerUpScore.toFixed(3)}` : ""}`)
      .join(" ");
    return {
      trace: `${seeds.map((s) => s.outcome).join(",")} | ${stages || events.map((e) => e.message).join(";").slice(0, 120)}`,
      id: c.id,
      armed,
      leaks,
      seeded: seeds.every((s) => s.outcome === "correct"),
      changed: mutation.changed,
      present: mutation.present,
      snapshot: snapshot.outcome,
      product: product.outcome,
      snapshotMs: Math.round(snapshot.ms * 10) / 10,
      productMs: Math.round(product.ms * 10) / 10,
      ...(snapshot.detail || product.detail ? { detail: snapshot.detail ?? product.detail } : {})
    };
  } finally {
    await context.close();
  }
}

/** Similar-rows pins: picked target → rows found, and whether one loop selector is proven for them. */
// L12.24: the provider calls a row's 15 Approve AND 15 Reject "similar" (and erp-grid's Simulate, Park and Post);
// only the picked action is kept, so table-actions loops over the 15 Approve and erp-grid has nothing to loop.
// transaction-ledger: 400 rows exceed the 50-row cap, so no loop. verify:similar-rows-safety covers the rest.
const SIMILAR_PINS: Record<string, { total: number; loop: boolean }> = {
  "table-actions": { total: 15, loop: true },
  "card-grid": { total: 12, loop: true },
  "reordered-rows": { total: 10, loop: true },
  "notification-list": { total: 6, loop: true },
  "transaction-ledger": { total: 400, loop: false },
  "erp-grid": { total: 1, loop: false }
};

async function main(): Promise<void> {
  const staged = stageHost("awkit-l12-23-coverage-");
  if (!staged) {
    console.log("NOT RUN: the pinned runtime inputs are absent (npm run benchmark:dom-intelligence-runtime-setup).");
    process.exit(2);
  }
  const provider = staged.provider();
  const root = await mkdtemp(join(tmpdir(), "awkit-l12-23-"));
  const pages = new Map<string, string>();
  const html = (key: string) => {
    if (!pages.has(key)) {
      const body = key === "l10-orders" ? DOM_CASES[0].baseline : coveragePage(key);
      if (body) pages.set(key, body);
    }
    return pages.get(key);
  };
  const server: Server = createServer((request, response) => {
    const match = /^\/dom-coverage-lab\/([a-z0-9-]+)(?:\/[a-z0-9-]*)?$/.exec(new URL(request.url ?? "/", "http://x").pathname);
    const body = match ? html(match[1]) : undefined;
    if (!body) return void response.writeHead(404).end();
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);
  });
  const base = await new Promise<string>((done) => server.listen(0, "127.0.0.1", () => done(`http://127.0.0.1:${(server.address() as { port: number }).port}`)));
  const urlOf = (fixture: CoverageFixture) => `${base}${fixture.path ?? `/dom-coverage-lab/${fixture.page}`}`;
  let browser: Browser | undefined;
  const runs: CaseRow[][] = [];
  const layer3: Record<string, unknown> = {};
  const recordings: Record<string, { strategy: string; value: string; context: string[]; guarded: boolean }> = {};
  try {
    const status = await provider.getStatus();
    check("the staged parser-only host is available (parser-only, no browser, no network)", status.available && !status.browserAccess && !status.networkAccess, status);
    browser = await chromium.launch();

    // ── A. Red-first: the oracle must be able to fail ───────────────────────────────────────────────
    console.log("A. The oracle reports a wrong element as WRONG (red control) and strips itself");
    {
      const page = await browser.newPage();
      await page.goto(`${base}/dom-coverage-lab/table-actions`);
      check("the oracle arms exactly one target", (await page.evaluate(runtime("arm(null)"))) === 1);
      check("...and no oracle attribute remains for the Recorder or an engine to read", (await page.evaluate(runtime("leaks()"))) === 0);
      const approve = page.locator("button.approve");
      check("precondition: the page has 15 identical Approve buttons", (await approve.count()) === 15);
      check("a different row's Approve button is judged WRONG", (await judge(async () => approve.nth(0))).outcome === "WRONG");
      check("the target row's Approve button is judged correct", (await judge(async () => page.locator("tr", { hasText: "INV-2042" }).locator("button.approve"))).outcome === "correct");
      check("a locator matching several elements is judged refused", (await judge(async () => approve)).outcome === "refused");
      await page.evaluate(runtime('mutate("remove")'));
      check("after the target is removed, any element is judged WRONG", (await judge(async () => approve.nth(10))).outcome === "WRONG");
      check("...and an empty answer is judged unresolved", (await judge(async () => page.locator("tr", { hasText: "INV-2042" }).locator("button.approve"))).outcome === "unresolved");
      await page.close();
    }

    // ── B. Corpus: record once per fixture and run, then every case ───────────────────────────────
    for (let run = 1; run <= RUNS; run += 1) {
      console.log(`B. Corpus run ${run}/${RUNS}: ${MANIFEST.length} cases on ${COVERAGE_FIXTURES.length} fixtures`);
      const rows: CaseRow[] = [];
      for (const fixture of COVERAGE_FIXTURES) {
        const recorded = await record(browser, urlOf(fixture), fixture);
        if (run === 1) {
          const { strategy, value, context } = recorded.step.locator!;
          recordings[fixture.id] = { strategy, value: String(value).slice(0, 80), context: context ? Object.keys(context) : [], guarded: Boolean(recorded.step.locator!.guard) };
        }
        for (const c of MANIFEST.filter((m) => m.fixture === fixture.id)) {
          const row = await runCase(browser, urlOf(fixture), fixture, recorded, c, provider, root, run);
          rows.push(row);
          if (run === 1) {
            const ok = row.product === "WRONG" || row.snapshot === "WRONG" ? "!!" : (c.expect === "recover" ? row.product === "correct" : EMPTY.includes(row.product)) ? "  " : "≠ ";
            console.log(`    ${ok}${c.id.padEnd(42)} expect=${c.expect.padEnd(7)} snapshot=${row.snapshot.padEnd(10)} product=${row.product.padEnd(10)} ${row.productMs} ms${row.present ? "" : " (target removed)"}${row.detail ? ` [${row.detail}]` : ""}`);
            if (ok !== "  ") console.log(`        trace ${row.trace}`);
          }
        }
      }
      runs.push(rows);
    }

    // ── C. The gate, then its own failure modes ─────────────────────────────────────────────────────
    console.log("C. The L12.23 gate");
    const reasons = coverageGate(MANIFEST, runs);
    check(`every case met the gate in all ${RUNS} runs`, reasons.length === 0, reasons.slice(0, 12));
    const all = runs.flat();
    const wrong = all.filter((r) => r.snapshot === "WRONG" || r.product === "WRONG").length;
    check("zero wrong-element results across both engines and every run", wrong === 0, wrong);
    const removed = runs[0].filter((r) => !r.present);
    check(`every removed target stays empty (${removed.length} cases)`, removed.length > 0 && removed.every((r) => EMPTY.includes(r.product) && EMPTY.includes(r.snapshot)));
    check(`the corpus holds ${PINNED.cases} cases on ${PINNED.fixtures} fixtures, within the 50-100 / 15-25 gate`, MANIFEST.length >= 50 && MANIFEST.length <= 100 && PINNED.fixtures >= 15 && PINNED.fixtures <= 25);

    console.log("D. Mutation controls: the gate fails for each defect it exists to catch");
    check(`the controls run on ${RUNS} runs (three are needed)`, RUNS >= 3);
    if (RUNS >= 3) {
    const copy = () => structuredClone(runs);
    const firstRecover = MANIFEST.findIndex((c) => c.expect === "recover");
    const firstRefuse = MANIFEST.findIndex((c) => c.expect === "refuse");
    const fails = (altered: CaseRow[][], manifest: ManifestCase[], needle: string) => coverageGate(manifest, altered).some((reason) => reason.includes(needle));
    let altered = copy();
    altered[0][firstRecover].product = "WRONG";
    check("a wrong element accepted on a recover case fails the gate", fails(altered, MANIFEST, "WRONG element"));
    altered = copy();
    altered[1][firstRefuse].snapshot = "WRONG";
    check("a wrong element accepted on a protected case fails the gate", fails(altered, MANIFEST, "WRONG element"));
    const droppedId = MANIFEST[firstRefuse].id;
    check(
      "a protected case removed from the corpus fails the gate",
      fails(runs.map((rows) => rows.filter((r) => r.id !== droppedId)), MANIFEST.filter((c) => c.id !== droppedId), "protected (refuse) case count")
    );
    altered = copy();
    altered[2] = altered[2].filter((r) => r.id !== droppedId);
    check("a case missing from one run fails the gate", fails(altered, MANIFEST, "differs from the manifest"));
    altered = copy();
    const flip = altered[2].findIndex((r) => EMPTY.includes(r.product));
    altered[2][flip].product = altered[2][flip].product === "unresolved" ? "refused" : "unresolved";
    check("a run whose decisions differ fails the gate, even between two acceptable outcomes", fails(altered, MANIFEST, "decisions differ"));
    altered = copy();
    altered[0][firstRecover].changed = false;
    check("a mutation that changed nothing fails the gate", fails(altered, MANIFEST, "changed nothing"));
    altered = copy();
    altered[0][firstRecover].seeded = false;
    check("an unseeded winner memory fails the gate", fails(altered, MANIFEST, "not seeded"));
    altered = copy();
    altered[0][firstRecover].leaks = 1;
    check("an oracle attribute left in the page fails the gate", fails(altered, MANIFEST, "oracle attributes"));
    const explained = MANIFEST.findIndex((c) => c.why);
    check(
      "a refusal of a present target with no stated reason fails the gate",
      fails(runs, MANIFEST.map((c, i) => (i === explained ? { ...c, why: undefined } : c)), "must state why")
    );
    }

    // ── E. Layer 3: the paths the L12 benchmark does not measure ────────────────────────────────────
    console.log("E. Layer 3: Element Spy similar rows and loop selectors (real host)");
    const similar: Record<string, { total: number; loop: boolean; ms: number }> = {};
    for (const id of ["table-actions", "card-grid", "reordered-rows", "notification-list", "transaction-ledger", "erp-grid"]) {
      const fixture = COVERAGE_FIXTURES.find((f) => f.id === id)!;
      const page = await browser.newPage();
      await page.goto(urlOf(fixture));
      await page.evaluate(runtime("arm(null)"));
      const index = await page.evaluate(() => {
        const target = (window as unknown as CoverageWindow).__awkitCoverage.target;
        return Array.prototype.indexOf.call(document.body.querySelectorAll("*"), target) as number;
      });
      const picked = page.locator("body *").nth(index);
      const started = performance.now();
      const first = await extractSimilarRows(page.mainFrame(), picked, provider, (text) => text);
      const ms = performance.now() - started;
      const second = await extractSimilarRows(page.mainFrame(), picked, provider, (text) => text);
      const pin = SIMILAR_PINS[id];
      check(`${id}: similar rows found`, first.ok, first);
      if (!first.ok) {
        await page.close();
        continue;
      }
      similar[id] = { total: first.total, loop: Boolean(first.loop), ms: Math.round(ms) };
      check(`${id}: the same answer twice (deterministic)`, JSON.stringify(first) === JSON.stringify(second));
      check(`${id}: ${first.total} rows, loop ${first.loop ? "proven" : "none"}, as pinned`, pin !== undefined && pin.total === first.total && pin.loop === Boolean(first.loop), { measured: similar[id], pin });
      if (first.loop) {
        const matched = page.locator(first.loop);
        const includesTarget = await matched.evaluateAll((elements) => (elements as Element[]).includes((window as unknown as CoverageWindow).__awkitCoverage.target as Element));
        check(`${id}: the loop selector matches exactly the ${first.total} rows, the picked one among them`, (await matched.count()) === first.total && includesTarget, first.loop);
        // The page's own classes are the verifier's oracle here; production never reads classes.
        if (id === "table-actions") check("table-actions: the loop covers no Reject, only the picked Approve action", (await matched.evaluateAll((elements) => elements.every((element) => element.classList.contains("approve")))) === true, first.loop);
      }
      check(`${id}: within the diagnosis budget (${DOM_INTELLIGENCE_LIMITS.diagnosisTimeoutMs} ms)`, ms < DOM_INTELLIGENCE_LIMITS.diagnosisTimeoutMs, Math.round(ms));
      await page.close();
    }
    layer3.similarRows = similar;

    console.log("F. Layer 3: Recorder protected-login detection, and its cost per navigation");
    const detectorMs: number[] = [];
    const detectPage = await browser.newPage();
    const plainPages = [...new Set(COVERAGE_FIXTURES.map((f) => f.path ?? `/dom-coverage-lab/${f.page}`))];
    const falsePositives: string[] = [];
    for (const path of plainPages) {
      await detectPage.goto(`${base}${path}`);
      for (let i = 0; i < 5; i += 1) {
        const started = performance.now();
        const view = await detectRecorderProtectedLogin(detectPage);
        detectorMs.push(performance.now() - started);
        if (view.detected && i === 0) falsePositives.push(`${path}: ${view.reason}`);
      }
    }
    check(`no corpus page is mistaken for a protected login (${plainPages.length} pages)`, falsePositives.length === 0, falsePositives);
    for (const challenge of CHALLENGE_PAGES) {
      await detectPage.goto(`${base}/dom-coverage-lab/${challenge.id}`);
      const view = await detectRecorderProtectedLogin(detectPage);
      check(`${challenge.id}: detected as ${challenge.detect}`, view.detected && view.reason === challenge.detect, { detected: view.detected, reason: view.reason, signals: view.signals });
    }
    const detectorP95 = pct(detectorMs, 95);
    check(`detection on navigation stays under ${BUDGET.detectorP95Ms} ms p95 (${detectorMs.length} samples)`, detectorP95 < BUDGET.detectorP95Ms, { p50: pct(detectorMs, 50), p95: detectorP95 });
    layer3.detector = { samples: detectorMs.length, p50: pct(detectorMs, 50), p95: detectorP95 };

    console.log("G. Layer 3: the Super-User read-time challenge check in the serializer");
    for (const challenge of CHALLENGE_PAGES) {
      await detectPage.goto(`${base}/dom-coverage-lab/${challenge.id}`);
      const read = await captureDomSnapshot(detectPage.mainFrame(), { mode: "recover", allowProtectedDocument: true });
      check(`${challenge.id}: ${challenge.read ? "read under the override" : "refused at read time"}`, challenge.read ? !read.refused : read.refused === "protected-login", read.refused ?? "read");
    }
    const overhead: Array<{ page: string; plainMs: number; checkedMs: number }> = [];
    for (const path of plainPages) {
      await detectPage.goto(`${base}${path}`);
      const time = async (allowProtectedDocument: boolean) => {
        const samples: number[] = [];
        for (let i = 0; i < 3; i += 1) {
          const started = performance.now();
          const snapshot = await captureDomSnapshot(detectPage.mainFrame(), { mode: "recover", allowProtectedDocument });
          samples.push(performance.now() - started);
          if (snapshot.refused) return NaN;
        }
        return pct(samples, 50);
      };
      overhead.push({ page: path, plainMs: await time(false), checkedMs: await time(true) });
    }
    check("no corpus page is refused by the read-time check", overhead.every((o) => Number.isFinite(o.plainMs) && Number.isFinite(o.checkedMs)), overhead.filter((o) => !Number.isFinite(o.checkedMs)));
    const worst = overhead.reduce((a, b) => (b.checkedMs > a.checkedMs ? b : a));
    check(`the checked read stays inside the 800 ms suggestion budget on every page (worst ${worst.page})`, worst.checkedMs < 800, worst);
    layer3.readTimeCheck = overhead;
    await detectPage.close();
  } finally {
    await browser?.close().catch(() => undefined);
    server.close();
    await provider.shutdown().catch(() => undefined);
    staged.cleanup();
    await rm(root, { recursive: true, force: true });
  }

  // ── H. Latency guardrails and the existing benchmark's bar ──────────────────────────────────────
  console.log("H. Latency guardrails (not targets)");
  const all = runs.flat();
  const recoveredSnapshot = all.filter((r) => r.snapshot === "correct").map((r) => r.snapshotMs);
  check(`warm snapshot recovery p95 < ${BUDGET.snapshotRecoveredP95Ms} ms (${recoveredSnapshot.length} recoveries)`, recoveredSnapshot.length > 0 && pct(recoveredSnapshot, 95) < BUDGET.snapshotRecoveredP95Ms, { p50: pct(recoveredSnapshot, 50), p95: pct(recoveredSnapshot, 95) });
  const productMs = all.map((r) => r.productMs);
  check(`product path p95 < ${BUDGET.productP95Ms} ms (${productMs.length} resolutions)`, pct(productMs, 95) < BUDGET.productP95Ms, { p50: pct(productMs, 50), p95: pct(productMs, 95), max: Math.max(...productMs) });

  const first = runs[0] ?? [];
  const summary = {
    fixtures: new Set(MANIFEST.map((c) => c.fixture)).size,
    cases: MANIFEST.length,
    byLayer: Object.fromEntries(["existing", "lab", "enterprise"].map((layer) => [layer, MANIFEST.filter((c) => c.layer === layer).length])),
    expected: {
      recover: MANIFEST.filter((c) => c.expect === "recover").length,
      refuse: MANIFEST.filter((c) => c.expect === "refuse").length,
      refuseWhy: Object.fromEntries([...new Set(MANIFEST.map((c) => c.why).filter(Boolean))].map((why) => [why, MANIFEST.filter((c) => c.why === why).length]))
    },
    product: { correct: first.filter((r) => r.product === "correct").length, empty: first.filter((r) => EMPTY.includes(r.product)).length, WRONG: all.filter((r) => r.product === "WRONG").length },
    snapshot: { correct: first.filter((r) => r.snapshot === "correct").length, empty: first.filter((r) => EMPTY.includes(r.snapshot)).length, WRONG: all.filter((r) => r.snapshot === "WRONG").length },
    targetRemoved: first.filter((r) => !r.present).length,
    identicalRuns: runs.length === RUNS && coverageGate(MANIFEST, runs).every((reason) => !reason.includes("decisions differ")),
    latencyMs: { snapshotRecovered: { p50: pct(recoveredSnapshot, 50), p95: pct(recoveredSnapshot, 95) }, product: { p50: pct(productMs, 50), p95: pct(productMs, 95) } }
  };
  console.log(`  (info) ${JSON.stringify(summary)}`);
  if (WRITE) {
    writeFileSync(
      RESULTS,
      `${JSON.stringify({ generatedBy: "verify:dom-intelligence-coverage --write", generatedAt: new Date().toISOString(), environment: { platform: process.platform, node: process.version }, summary, layer3, recordings, cases: MANIFEST.map((c, i) => ({ ...c, runs: runs.map((rows) => ({ snapshot: rows[i]?.snapshot, product: rows[i]?.product, productMs: rows[i]?.productMs, trace: rows[i]?.trace })) })) }, null, 2)}\n`
    );
    console.log(`  wrote ${RESULTS}`);
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
