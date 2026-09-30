/**
 * awkit-epbe: LocatorFactory must refuse, never act on another element, in the three wrong-element
 * drift shapes the L10.0 benchmark found — on the SAME frozen fixtures (scripts/dom-intelligence/fixtures.mts).
 *
 * Run with: npm run verify:locator-wrong-element
 *
 *   1. viewport tiebreak      duplicate-text-decoy               production must refuse (ambiguity)
 *   2. positional alternative list-item-link                     production must refuse (ambiguity)
 *   3. same-label recovery    other-region-decoy-target-removed  local and local+blueprint recovery must refuse
 *
 * Every case runs the three benchmark configurations through the REAL recorder capture and the production
 * LocatorFactory (recorded step; every candidate forced to miss with local recovery; forced miss with local
 * plus blueprint recovery). Beyond the three shapes: no configuration may resolve a wrong element (one
 * documented residual, below), and every outcome that was correct in the committed L10.0 results must stay
 * correct, so a fix that simply refuses more cannot pass. The recording helpers duplicate
 * scripts/benchmark-dom-intelligence.mts on purpose: that script is frozen pre-registered evidence tooling.
 */
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Locator } from "playwright";
import { buildRecordedFlow } from "@src/recorder/buildRecordedFlow";
import { getRecorderInitScriptContent } from "@src/recorder/recorderInitScript";
import type { RecordedAction } from "@src/recorder/RecorderTypes";
import type { FlowStep } from "@src/profiles/FlowProfile";
import { LocatorFactory, type LocatorRecoveryEvent } from "@src/runner/LocatorFactory";
import type { LocatorBlueprintStore, PageBlueprint } from "@src/runner/LocatorBlueprintStore";
import { FileLocatorRecoveryStore } from "@src/runner/LocatorRecoveryStore";
import { DOM_CASES, fixtureSetHash, type DomCase } from "./dom-intelligence/fixtures.mts";

const PORT = 4433;
const BASE = `http://127.0.0.1:${PORT}`;
const ANCHOR = '[data-l10-anchor="target"]';
const RESULTS = "docs/plans/ai-upgrade-v5/evidence/L10.0-dom-intelligence-results.json";
const CONFIGS = ["production", "localOnly", "localAndBlueprint"] as const;
type Config = (typeof CONFIGS)[number];
type Status = "correct" | "WRONG" | "unresolved" | "ambiguous" | "error";

/**
 * Residual outside LocatorFactory recovery (docs/ai/KNOWN_ISSUES.md): with the form gone, the recorded
 * role=button [Save changes] itself matches the notifications-panel button uniquely, so it wins as an
 * ordinary recorded candidate. Asserted here only as "recovery did not act".
 */
const RESIDUAL = "other-region-decoy-target-removed/production";

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail !== undefined ? ` — ${detail}` : ""}`);
  }
}

function startServer(): Promise<Server> {
  const byId = new Map(DOM_CASES.map((c) => [c.id, c]));
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", BASE);
    const fixture = byId.get(/^\/case\/([a-z0-9-]+)$/.exec(url.pathname)?.[1] ?? "");
    if (!fixture) {
      response.writeHead(404).end();
      return;
    }
    response
      .writeHead(200, { "content-type": "text/html; charset=utf-8" })
      .end(url.searchParams.get("v") === "mutated" ? fixture.mutated : fixture.baseline);
  });
  return new Promise((done) => server.listen(PORT, "127.0.0.1", () => done(server)));
}

async function recordStep(browser: Browser, fixture: DomCase): Promise<{ step: FlowStep; blueprint: PageBlueprint | undefined }> {
  const context = await browser.newContext();
  const actions: RecordedAction[] = [];
  const actionType = fixture.action ?? "click";
  try {
    await context.addInitScript({ content: getRecorderInitScriptContent() });
    await context.exposeBinding("__awtkit_recordAction", (_source, action) => actions.push(action as RecordedAction));
    await context.exposeBinding("__awtkit_recordSignal", () => undefined);
    const page = await context.newPage();
    await page.goto(`${BASE}/case/${fixture.id}?v=baseline`);
    if (actionType === "fill") {
      await page.locator(fixture.targetSelector).fill("Leave at the door");
      await page.keyboard.press("Tab");
    } else {
      await page.locator(fixture.targetSelector).click();
    }
    for (let attempt = 0; attempt < 60 && !actions.some((a) => a.type === actionType); attempt += 1) {
      await page.waitForTimeout(50);
    }
    const blueprints: PageBlueprint[] = [];
    const flow = buildRecordedFlow(`epbe ${fixture.id}`, actions.filter((a) => a.type === actionType).slice(0, 1), blueprints);
    const step = flow.nodes.find((node) => node.type === actionType) as FlowStep | undefined;
    if (!step?.locator) throw new Error(`${fixture.id}: the recorder captured no ${actionType} step`);
    return { step, blueprint: blueprints[0] };
  } finally {
    await context.close();
  }
}

interface Outcome {
  status: Status;
  recovered: boolean;
  ms: number;
  detail?: string;
}

async function outcome(run: (events: LocatorRecoveryEvent[]) => Promise<Locator>, truth: string | null): Promise<Outcome> {
  const events: LocatorRecoveryEvent[] = [];
  const started = performance.now();
  let locator: Locator;
  try {
    locator = await run(events);
  } catch (error) {
    const detail = (error instanceof Error ? error.message : String(error)).split("\n")[0];
    const recovered = events.some((event) => event.type === "local-recovery");
    return { status: /matched multiple|matches \d+ elements/i.test(detail) ? "ambiguous" : "error", recovered, ms: performance.now() - started, detail };
  }
  const ms = performance.now() - started;
  const recovered = events.some((event) => event.type === "local-recovery");
  const count = await locator.count().catch(() => 0);
  if (count !== 1) return { status: count === 0 ? "unresolved" : "ambiguous", recovered, ms };
  const correct = truth ? await locator.evaluate((element, selector) => element === document.querySelector(selector), truth) : false;
  return { status: correct ? "correct" : "WRONG", recovered, ms };
}

async function runCase(browser: Browser, fixture: DomCase, recoveryRoot: string): Promise<Record<Config, Outcome>> {
  const { step, blueprint } = await recordStep(browser, fixture);
  const blueprintStore: LocatorBlueprintStore = {
    get: async (pageKey) => (blueprint && pageKey === blueprint.pageKey ? blueprint : undefined),
    put: async () => undefined,
    list: async () => (blueprint ? [blueprint] : [])
  };
  const recoveryStore = new FileLocatorRecoveryStore(join(recoveryRoot, fixture.id));
  const scope = (suffix: string) => ({ scenarioId: `epbe-${fixture.id}-${suffix}`, flowId: "epbe" });
  const forced = structuredClone(step);
  forced.id = `${step.id}-forced`;
  forced.locator = { ...forced.locator!, strategy: "css", value: ANCHOR, name: undefined, exact: undefined, alternatives: [], guard: undefined };

  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`${BASE}/case/${fixture.id}?v=baseline`);
    // Seed winner memory exactly as a first successful run would, then the forced-miss variants.
    const seeded = await new LocatorFactory(page, { recoveryStore, scope: scope("production"), recoveryGraceMs: 0 }).resolve(step);
    if (!(await seeded.evaluate((el, s) => el === document.querySelector(s), fixture.targetSelector))) {
      throw new Error(`${fixture.id}: the recorded step does not resolve to the target on the baseline`);
    }
    await page.locator(fixture.targetSelector).evaluate((element) => element.setAttribute("data-l10-anchor", "target"));
    for (const suffix of ["local", "blueprint"]) {
      await new LocatorFactory(page, { recoveryStore, scope: scope(suffix), recoveryGraceMs: 0 }).resolve(forced);
    }

    await page.goto(`${BASE}/case/${fixture.id}?v=mutated`);
    const factory = (suffix: string, withBlueprint: boolean, events: LocatorRecoveryEvent[]) =>
      new LocatorFactory(page, {
        recoveryStore,
        blueprintStore: withBlueprint ? blueprintStore : undefined,
        scope: scope(suffix),
        recoveryGraceMs: 0,
        onRecoveryEvent: (event) => events.push(event)
      });
    return {
      production: await outcome((events) => factory("production", true, events).resolve(step), fixture.truthSelector),
      localOnly: await outcome((events) => factory("local", false, events).resolve(forced), fixture.truthSelector),
      localAndBlueprint: await outcome((events) => factory("blueprint", true, events).resolve(forced), fixture.truthSelector)
    };
  } finally {
    await context.close();
  }
}

interface CommittedCase {
  id: string;
  production: { status: string; correct: boolean | null };
  localOnly: { status: string; correct: boolean | null };
  localAndBlueprint: { status: string; correct: boolean | null };
}

async function main(): Promise<void> {
  const committed = JSON.parse(readFileSync(RESULTS, "utf8")) as { fixtureSetHash: string; cases: CommittedCase[] };
  const before = new Map(committed.cases.map((c) => [c.id, c]));
  const wasWrong = (id: string, config: Config) => before.get(id)?.[config].status === "resolved" && before.get(id)?.[config].correct === false;

  console.log("Preconditions — the same fixtures, and they reproduced the defects");
  check("fixture set hash equals the committed L10.0 results", fixtureSetHash() === committed.fixtureSetHash, fixtureSetHash());
  check("committed results cover every fixture case", DOM_CASES.every((c) => before.has(c.id)) && committed.cases.length === DOM_CASES.length);
  check("shape 1 was WRONG before (duplicate-text-decoy, production)", wasWrong("duplicate-text-decoy", "production"));
  check("shape 2 was WRONG before (list-item-link, production)", wasWrong("list-item-link", "production"));
  check(
    "shape 3 was WRONG before (other-region-decoy-target-removed, both recovery configs)",
    wasWrong("other-region-decoy-target-removed", "localOnly") && wasWrong("other-region-decoy-target-removed", "localAndBlueprint")
  );

  const recoveryRoot = await mkdtemp(join(tmpdir(), "awkit-epbe-"));
  const server = await startServer();
  const browser = await chromium.launch();
  const results = new Map<string, Record<Config, Outcome>>();
  try {
    for (const fixture of DOM_CASES) {
      const run = await runCase(browser, fixture, recoveryRoot);
      results.set(fixture.id, run);
      console.log(`    ${fixture.id.padEnd(34)} ${CONFIGS.map((c) => `${c}=${run[c].status}${run[c].recovered ? "(recovered)" : ""}`).join("  ")}`);
    }
  } finally {
    await browser.close().catch(() => undefined);
    server.close();
    await rm(recoveryRoot, { recursive: true, force: true });
  }
  const at = (id: string, config: Config): Outcome => results.get(id)![config];

  console.log("The three wrong-element shapes refuse");
  const dup = at("duplicate-text-decoy", "production");
  check("1. viewport tiebreak: duplicate-text-decoy refuses with an explicit ambiguity", dup.status === "ambiguous", `${dup.status} ${dup.detail ?? ""}`);
  const list = at("list-item-link", "production");
  check("2. positional alternatives: list-item-link refuses with an explicit ambiguity", list.status === "ambiguous", `${list.status} ${list.detail ?? ""}`);
  for (const config of ["localOnly", "localAndBlueprint"] as const) {
    const other = at("other-region-decoy-target-removed", config);
    check(`3. same-label recovery (${config}): other-region decoy is refused, unresolved`, other.status === "unresolved" && !other.recovered, `${other.status} recovered=${other.recovered}`);
  }

  console.log("No wrong element anywhere, no lost recovery");
  const outcomes = DOM_CASES.flatMap((fixture) => CONFIGS.map((config) => ({ key: `${fixture.id}/${config}`, id: fixture.id, config, o: at(fixture.id, config) })));
  check("every case ran in all three configurations", outcomes.length === DOM_CASES.length * CONFIGS.length && DOM_CASES.length === 16, String(outcomes.length));
  const wrong = outcomes.filter(({ key, o }) => o.status === "WRONG" && key !== RESIDUAL).map(({ key }) => key);
  check("no configuration resolves a wrong element (outside the documented residual)", wrong.length === 0, wrong.join(", "));
  const residual = outcomes.find(({ key }) => key === RESIDUAL)!.o;
  check(`residual ${RESIDUAL}: recovery did not act (recorded candidate path only)`, !residual.recovered, residual.status);
  const errors = outcomes.filter(({ o }) => o.status === "error").map(({ key, o }) => `${key}: ${o.detail}`);
  check("no configuration errors outside a locator refusal", errors.length === 0, errors.join(" | "));
  const expectedCorrect = outcomes.filter(({ id, config }) => before.get(id)?.[config].correct === true);
  const lost = expectedCorrect.filter(({ o }) => o.status !== "correct").map(({ key, o }) => `${key}=${o.status}`);
  check(`all ${expectedCorrect.length} outcomes correct in the committed L10.0 run stay correct`, expectedCorrect.length === 21 && lost.length === 0, lost.join(", ") || String(expectedCorrect.length));

  const forcedMs = outcomes.filter(({ config }) => config !== "production").map(({ o }) => o.ms).sort((a, b) => a - b);
  const pct = (p: number) => forcedMs[Math.min(forcedMs.length - 1, Math.floor((p / 100) * forcedMs.length))].toFixed(0);
  console.log(`  (info) forced-miss resolve: p50 ${pct(50)} ms, p95 ${pct(95)} ms, max ${pct(100)} ms over ${forcedMs.length}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
