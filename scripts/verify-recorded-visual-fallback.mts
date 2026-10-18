/**
 * verify:recorded-visual-fallback — Phase N4.6 (awkit-vra.13.6): the N2 shadow stage's read-only fallback to the
 * Recorder-seeded visual reference (docs/plans/ai-upgrade-v5/N4-recorder-visual-intelligence.md, Data flow step 7).
 *
 * Real Chromium, the real `LocatorFactory`, `VisualFusionStage` and `VisualReferenceStore`. The recorded reference is
 * written exactly as N4.3 writes it: `VisualReferenceStore.refresh(recordedVisualReferenceKey(flow, step,
 * stepCandidatesDigest(locator)), evidence)` with evidence the stage itself captured of the target.
 *
 *   1  runtime missing + recorded found: read once, compared, traced `recorded`, effect none, the resolve identical;
 *   2  runtime + recorded: the runtime one wins and the recorded key is never read;
 *   3  neither: `none` / no-reference, the resolve identical;
 *   4  binding changed (an alternative added): the old record is ignored;
 *   5  corrupt and version-mismatch records: ignored, the resolve identical;
 *   6  never refreshed: no refresh call ever names the recorded key, its bytes, `updatedAt` and digest are unchanged;
 *   7  never overwritten or copied: the runtime refresh writes the step's own scope key only, and the next run is `runtime`;
 *   8  the recorded-source boundary: `effectForReferenceSource` turns "veto" / "proceed" into "none" for `recorded`
 *      only, and `LocatorFactory` drops an observer's "veto" whose source is `recorded`;
 *   9  runner A/B: recorded present vs absent vs fusion off give the same events, traces, winner memory and target;
 *   10 N3: agreement (shadow and enforce) on a below-threshold refusal compares against the recorded reference with
 *      effect none, the step stays unresolved, nothing is written;
 *   11 enablement: without `recordedFallback` (AWKIT_VISUAL_RECORDER unset) no recorded key is read; the engine sets it
 *      only from `AWKIT_VISUAL_RECORDER === "manual"` and the runner passes it only when true;
 *   12 the runtime refresh rule is unchanged: the same refresh calls with or without a recorded reference beside it.
 *
 * Mutation contract (run 2026-10-18, each observed red): M1 `effectForReferenceSource` passes the effect through for
 * `recorded`; M2 the replay refreshes the recorded key; M3 the recorded reference is preferred over the runtime one;
 * M4 the binding digest ignores everything but the primary candidate; M5 the `recordedFallback` gate is removed.
 *
 * The 400 ms FD-5 budget is a production constant and is not relaxed: a run whose capture the budget cut is repeated a
 * bounded number of times (the count is printed); a case whose every attempt is cut FAILS.
 *
 * Run: npm run verify:recorded-visual-fallback
 */

import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { chromium, type Browser, type Page } from "playwright";
import { VISUAL_EVIDENCE_MAX_BYTES, VISUAL_EVIDENCE_VERSION, type VisualEvidence } from "@src/visual/visualEvidence";
import type { FlowStep } from "@src/profiles/FlowProfile";
import {
  LocatorFactory,
  type LocatorRecoveryEvent,
  type LocatorRecoveryTrace,
  type LocatorRecoveryVisual,
  type LocatorRecoveryVisualAgreement,
  type LocatorVisualFusion
} from "@src/runner/LocatorFactory";
import { FileLocatorRecoveryStore, stepCandidatesDigest } from "@src/runner/LocatorRecoveryStore";
import {
  VisualFusionStage,
  effectForReferenceSource,
  type VisualAgreementRecord,
  type VisualFusionVerdictRecord
} from "@src/runner/visualFusion/VisualFusionStage";
import { VisualReferenceStore, type VisualReferenceStoreOptions } from "@src/runner/visualFusion/VisualReferenceStore";
import { recordedVisualReferenceKey } from "@src/runner/visualFusion/recordedVisualReferenceKey";

let passed = 0;
let failed = 0;

function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const ROOT = await mkdtemp(join(tmpdir(), "awkit-recorded-fallback-"));
let browser: Browser | undefined;

const SCENARIO_ID = "n4-6";
const FLOW_ID = "recorded-flow";
const STEP_ID = "save-profile";
const SCOPE_KEY = `${SCENARIO_ID}\u0000${FLOW_ID}\u0000${STEP_ID}`;
const PRIMARY = { strategy: "css", value: "#save-profile" };
const RECORDED_KEY = recordedVisualReferenceKey(FLOW_ID, STEP_ID, stepCandidatesDigest(PRIMARY));
const fileFor = (folder: string, scopeKey: string): string => join(folder, `${createHash("sha256").update(scopeKey).digest("hex")}.json`);

const LAB = `<!doctype html><html><head><style>
body{margin:24px;background:#fff}
.bar{display:flex;gap:16px}
.tool{display:block;width:48px;height:40px;margin:0;padding:0;border:0;border-radius:0;outline:none}
.blue{background:#1d4ed8}.gray{background:#9ca3af}.amber{background:#f59e0b}.green{background:#16a34a}
</style></head><body><main><section id="profile"><div class="bar" id="bar">
<button id="save-profile" class="tool blue" type="button" aria-label="Save profile"><span hidden>save</span></button>
<button id="cancel-profile" class="tool gray" type="button" aria-label="Cancel"><span hidden>cancel</span></button>
<button id="reset-profile" class="tool amber" type="button" aria-label="Reset form"><span hidden>reset</span></button>
<button id="export-profile" class="tool green" type="button" aria-label="Export"><span hidden>export</span></button>
</div></section></main></body></html>`;

/** `idOnly`: every saved candidate misses and the local layer recovers the target. `drift`: it refuses below-threshold. */
const MUTATIONS = {
  idOnly: { id: "profile-save" },
  drift: { id: "profile-save", label: "Store profile" }
} as const;
type MutationName = keyof typeof MUTATIONS;

const AGREEMENT_SUFFIX = / Visual agreement \(shadow, no effect\): [a-z-]+\([a-z-]+\)\./g;
const stable = (key: string, value: unknown): unknown => {
  if (/(^ms|Ms|At)$/.test(key) || key === "visual" || key === "visualAgreement") return undefined;
  return typeof value === "string" ? value.replace(AGREEMENT_SUFFIX, "").replace(/\d+ ?ms\b/g, "#ms") : value;
};

interface ScenarioRun {
  seeded: boolean;
  recovered: boolean;
  isTarget: boolean;
  resolvedText: string | null;
  events: string;
  memory: string;
  traces: LocatorRecoveryTrace[];
  visuals: (LocatorRecoveryVisual | null)[];
  agreements: (LocatorRecoveryVisualAgreement | null)[];
}

const jsonFiles = async (folder: string): Promise<string[]> => (await readdir(folder).catch(() => [] as string[])).filter((n) => n.endsWith(".json"));

/** Seed winner memory with one passing resolve, mutate, resolve again. `seed` / `recover` are the factories' fusion. */
async function scenario(
  mutation: MutationName,
  fusion: { seed?: LocatorVisualFusion; recover?: LocatorVisualFusion } = {},
  locator: Record<string, unknown> = PRIMARY
): Promise<ScenarioRun> {
  const page: Page = await browser!.newPage({ viewport: { width: 800, height: 600 } });
  try {
    await page.setContent(LAB);
    const folder = await mkdtemp(join(ROOT, "recovery-"));
    const recoveryStore = new FileLocatorRecoveryStore(folder);
    const events: LocatorRecoveryEvent[] = [];
    const step = { id: STEP_ID, name: "Save profile", type: "click", locator } as unknown as FlowStep;
    const factory = (visualFusion?: LocatorVisualFusion) =>
      new LocatorFactory(page, {
        recoveryStore,
        scope: { scenarioId: SCENARIO_ID, flowId: FLOW_ID },
        recoveryGraceMs: 0,
        onRecoveryEvent: (event) => events.push(event),
        ...(visualFusion ? { visualFusion } : {})
      });
    await page.evaluate(() => {
      (window as unknown as { __target: Element }).__target = document.getElementById("save-profile")!;
    });
    const seededLocator = await factory(fusion.seed)
      .resolve(step)
      .catch(() => null);
    const seeded = seededLocator
      ? await seededLocator.evaluate((element) => element === (window as unknown as { __target: Element }).__target, undefined, { timeout: 2_000 }).catch(() => false)
      : false;
    await page.evaluate((spec: { id?: string; label?: string }) => {
      const target = document.getElementById("save-profile")!;
      if (spec.label) target.setAttribute("aria-label", spec.label);
      if (spec.id) target.id = spec.id;
    }, MUTATIONS[mutation] as { id?: string; label?: string });
    let isTarget = false;
    let resolvedText: string | null = null;
    try {
      const resolved = await factory(fusion.recover).resolve(step);
      if ((await resolved.count()) === 1) {
        isTarget = await resolved.evaluate((element) => element === (window as unknown as { __target: Element }).__target, undefined, { timeout: 2_000 });
        resolvedText = await resolved.getAttribute("aria-label", { timeout: 2_000 });
      }
    } catch {
      resolvedText = null;
    }
    const memory = await Promise.all((await jsonFiles(folder)).sort().map(async (name) => JSON.parse(await readFile(join(folder, name), "utf8")) as unknown));
    const traceEvents = events.filter((event) => event.type === "recovery-trace");
    return {
      seeded,
      recovered: events.some((event) => event.type === "local-recovery"),
      isTarget,
      resolvedText,
      events: JSON.stringify(events, stable),
      memory: JSON.stringify(memory, stable),
      traces: traceEvents.map((event) => event.trace!).filter(Boolean),
      visuals: traceEvents.map((event) => event.trace?.visual ?? null),
      agreements: traceEvents.map((event) => event.trace?.visualAgreement ?? null)
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

const sameRun = (a: ScenarioRun, b: ScenarioRun): boolean =>
  JSON.stringify([a.seeded, a.recovered, a.isTarget, a.resolvedText, a.events, a.memory]) === JSON.stringify([b.seeded, b.recovered, b.isTarget, b.resolvedText, b.events, b.memory]);

const digestOf = (value: unknown): string | null => (value as VisualEvidence | null)?.fingerprint?.contentDigest ?? null;
const storeOptions = (folder: string): VisualReferenceStoreOptions => ({ folder, evidenceVersion: VISUAL_EVIDENCE_VERSION, maxEvidenceBytes: VISUAL_EVIDENCE_MAX_BYTES, digestOf });

/** Every key the stage read or refreshed, in order. */
class KeyedStore extends VisualReferenceStore {
  readonly gets: string[] = [];
  readonly refreshes: string[] = [];
  override async get(scopeKey: string): ReturnType<VisualReferenceStore["get"]> {
    this.gets.push(scopeKey);
    return super.get(scopeKey);
  }
  override async refresh(scopeKey: string, evidence: unknown): ReturnType<VisualReferenceStore["refresh"]> {
    this.refreshes.push(scopeKey);
    return super.refresh(scopeKey, evidence);
  }
}

interface Staged {
  fusion: LocatorVisualFusion;
  store: KeyedStore;
  folder: string;
  verdicts: VisualFusionVerdictRecord[];
  agreements: VisualAgreementRecord[];
}

/** A real stage on `folder` (a fresh one by default). */
async function staged(options: { recordedFallback?: boolean; agreement?: "shadow" | "enforce"; folder?: string } = {}): Promise<Staged> {
  const folder = options.folder ?? (await mkdtemp(join(ROOT, "visual-")));
  const store = new KeyedStore(storeOptions(folder));
  const out: Staged = { fusion: undefined as unknown as LocatorVisualFusion, store, folder, verdicts: [], agreements: [] };
  const stage = new VisualFusionStage({
    folder,
    store,
    handedOff: () => false,
    ...(options.agreement ? { agreement: options.agreement } : {}),
    ...(options.recordedFallback ? { recordedFallback: true } : {}),
    onVerdict: (record) => out.verdicts.push(record),
    onAgreement: (record) => out.agreements.push(record)
  });
  out.fusion = {
    observeRecovery: (observation) => stage.observeRecovery(observation),
    observePass: (observation) => stage.observePass(observation),
    ...(options.agreement ? { agree: (observation: Parameters<NonNullable<LocatorVisualFusion["agree"]>>[0]) => stage.agree(observation) } : {})
  };
  return out;
}

/** The evidence a real stage captured of the unmutated target, as the Recorder's capture would hold it. */
let baseline: VisualEvidence | undefined;
async function captureBaseline(): Promise<VisualEvidence> {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const s = await staged();
    await scenario("idOnly", { seed: s.fusion });
    const read = await new VisualReferenceStore(storeOptions(s.folder)).get(SCOPE_KEY);
    if (read.status === "found") return read.evidence as VisualEvidence;
    budgetRetries += 1;
  }
  throw new Error("could not capture the baseline in 5 attempts under the 400 ms budget");
}

/** N4.3's write: the unchanged store under the recorded namespace key. */
async function writeRecorded(folder: string, key = RECORDED_KEY, evidence: VisualEvidence = baseline!): Promise<string> {
  const result = await new VisualReferenceStore(storeOptions(folder)).refresh(key, evidence);
  if (result.status !== "written") throw new Error(`recorded write ${result.status}`);
  return readFile(fileFor(folder, key), "utf8");
}

/** Runs cut by the 400 ms budget on a loaded host and run again; reported, never hidden. */
let budgetRetries = 0;
const BUDGET_ATTEMPTS = 5;
const CUT = new Set(["budget-exhausted"]);

/** `prepare` builds a fresh folder and stage per attempt; a run whose verdict the budget cut is repeated. */
async function attempted<T extends { verdict?: { reason: string } }>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const result = await run();
    if (result.verdict && CUT.has(result.verdict.reason) && attempt < BUDGET_ATTEMPTS) {
      budgetRetries += 1;
      continue;
    }
    return result;
  }
}

const UNCOMPARED = new Set(["protected-surface", "budget-exhausted", "cancelled", "target-stale", "target-offscreen", "frame-mapping-failed", "version-mismatch", "capture-failed", "fusion-off", "step-ineligible", "no-reference", "invalid-input"]);

async function main(): Promise<void> {
  browser = await chromium.launch();
  // Warm-up, discarded: the first screenshot of a fresh browser process can exceed the 400 ms budget on its own.
  const warm = await staged();
  await scenario("idOnly", { seed: warm.fusion, recover: warm.fusion });
  baseline = await captureBaseline();

  console.log("\nThe lab (non-vacuous):\n");
  const off = await scenario("idOnly");
  check("fusion off: the target seeds, then is recovered locally after its id is renamed", off.seeded && off.recovered && off.isTarget && off.resolvedText === "Save profile", JSON.stringify(off).slice(0, 240));
  check("the baseline is real captured evidence with a content digest", typeof digestOf(baseline) === "string");

  console.log("\n1 / 6 / 7: no runtime reference, a valid recorded one:\n");
  const one = await attempted(async () => {
    const s = await staged({ recordedFallback: true });
    const before = await writeRecorded(s.folder);
    const beforeRead = await new VisualReferenceStore(storeOptions(s.folder)).get(RECORDED_KEY);
    const run = await scenario("idOnly", { recover: s.fusion });
    return { s, run, before, beforeRead, verdict: s.verdicts[0] };
  });
  const v1 = one.verdict;
  check("exactly one verdict, traced referenceSource recorded", one.s.verdicts.length === 1 && v1?.referenceSource === "recorded", JSON.stringify(one.s.verdicts));
  check(
    "the verdict is a visual comparison against the recorded reference (a winner score, not R1/R2)",
    typeof v1?.evidence.winnerScore === "number" && !UNCOMPARED.has(v1.reason) && v1.outcome !== "unchecked",
    `${v1?.outcome} (${v1?.reason}) ${JSON.stringify(v1?.evidence)}`
  );
  check("its effect is none", v1?.effect === "none");
  const [visual1] = one.run.visuals;
  check("the trace's visual block says recorded, effect none, and holds codes only", visual1?.referenceSource === "recorded" && visual1.effect === "none" && !/sha256|digest|bounds|base64|recorded-visual-reference|"x":/i.test(JSON.stringify(visual1)), JSON.stringify(visual1));
  check("execution unchanged: the same target, events, traces and winner memory as fusion off", sameRun(one.run, off) && one.run.isTarget);
  check("the recorded key was read exactly once (one lookup per eligible step)", one.s.store.gets.filter((k) => k === RECORDED_KEY).length === 1, JSON.stringify(one.s.store.gets.map((k) => (k === RECORDED_KEY ? "recorded" : k === SCOPE_KEY ? "runtime" : "other"))));
  check("6: no refresh call ever named the recorded key", one.s.store.refreshes.length >= 1 && one.s.store.refreshes.every((k) => k === SCOPE_KEY), JSON.stringify(one.s.store.refreshes.map((k) => (k === RECORDED_KEY ? "recorded" : k === SCOPE_KEY ? "runtime" : "other"))));
  const after1 = await readFile(fileFor(one.s.folder, RECORDED_KEY), "utf8");
  const afterRead = await new VisualReferenceStore(storeOptions(one.s.folder)).get(RECORDED_KEY);
  check("6: the recorded record's bytes are unchanged", after1 === one.before);
  check(
    "6: its updatedAt and content digest are unchanged",
    one.beforeRead.status === "found" && afterRead.status === "found" && afterRead.updatedAt === one.beforeRead.updatedAt && afterRead.contentDigest === one.beforeRead.contentDigest
  );
  check("7: the runtime refresh wrote the step's own scope key, beside the untouched recorded file", (await jsonFiles(one.s.folder)).length === 2 && (await new VisualReferenceStore(storeOptions(one.s.folder)).get(SCOPE_KEY)).status === "found");
  const next = await attempted(async () => {
    const s = await staged({ recordedFallback: true, folder: one.s.folder });
    const run = await scenario("idOnly", { recover: s.fusion });
    return { s, run, verdict: s.verdicts[0] };
  });
  check("7: the next run compares against the runtime reference and never reads the recorded key", next.verdict?.referenceSource === "runtime" && !next.s.store.gets.includes(RECORDED_KEY), JSON.stringify(next.s.verdicts));
  check("7: the recorded record is still byte-identical after that run", (await readFile(fileFor(one.s.folder, RECORDED_KEY), "utf8")) === one.before);

  console.log("\n2 / 12: a runtime reference and a recorded one:\n");
  const runtimeOnly = await attempted(async () => {
    const s = await staged({ recordedFallback: true });
    const run = await scenario("idOnly", { seed: s.fusion, recover: s.fusion });
    return { s, run, verdict: s.verdicts[0] };
  });
  const both = await attempted(async () => {
    const s = await staged({ recordedFallback: true });
    // A recorded reference that would not corroborate the target: if it were preferred, the verdict would change.
    const before = await writeRecorded(s.folder, RECORDED_KEY, { ...baseline!, fingerprint: { ...baseline!.fingerprint, contentDigest: `sha256:${"0".repeat(64)}` } } as VisualEvidence);
    const run = await scenario("idOnly", { seed: s.fusion, recover: s.fusion });
    return { s, run, before, verdict: s.verdicts[0] };
  });
  check("non-vacuous: the runtime-only run compared against its own reference", runtimeOnly.verdict?.referenceSource === "runtime" && runtimeOnly.verdict.reason !== "no-reference", JSON.stringify(runtimeOnly.s.verdicts));
  check("the runtime reference wins: the verdict says runtime", both.verdict?.referenceSource === "runtime", JSON.stringify(both.s.verdicts));
  check("the recorded key is never read while a runtime reference exists", !both.s.store.gets.includes(RECORDED_KEY));
  check("the same verdict as with no recorded reference at all", both.verdict?.outcome === runtimeOnly.verdict?.outcome && both.verdict?.reason === runtimeOnly.verdict?.reason);
  check("12: the same refresh calls, all on the runtime key, as without the recorded reference", JSON.stringify(both.s.store.refreshes) === JSON.stringify(runtimeOnly.s.store.refreshes) && both.s.store.refreshes.every((k) => k === SCOPE_KEY));
  check("the recorded record is untouched", (await readFile(fileFor(both.s.folder, RECORDED_KEY), "utf8")) === both.before);
  check("execution unchanged in both", sameRun(both.run, off) && sameRun(runtimeOnly.run, off));

  console.log("\n3: neither reference:\n");
  const none = await attempted(async () => {
    const s = await staged({ recordedFallback: true });
    const run = await scenario("idOnly", { recover: s.fusion });
    return { s, run, verdict: s.verdicts[0] };
  });
  check("referenceSource none, R1 no-reference, effect none", none.verdict?.referenceSource === "none" && none.verdict.reason === "no-reference" && none.verdict.effect === "none", JSON.stringify(none.s.verdicts));
  check("the trace says none", none.run.visuals[0]?.referenceSource === "none");
  check("execution unchanged", sameRun(none.run, off));

  console.log("\n4: the step's binding changed after the capture:\n");
  const retargeted = { ...PRIMARY, alternatives: [{ strategy: "css", value: "#never-rendered" }] };
  check("an added alternative changes the binding digest", stepCandidatesDigest(retargeted) !== stepCandidatesDigest(PRIMARY));
  const offRetargeted = await scenario("idOnly", {}, retargeted);
  const stale = await attempted(async () => {
    const s = await staged({ recordedFallback: true });
    const before = await writeRecorded(s.folder);
    const run = await scenario("idOnly", { recover: s.fusion }, retargeted);
    return { s, run, before, verdict: s.verdicts[0] };
  });
  check("non-vacuous: the re-targeted step still recovers with fusion off", offRetargeted.recovered && offRetargeted.isTarget);
  check("the old record is ignored: none, no-reference", stale.verdict?.referenceSource === "none" && stale.verdict.reason === "no-reference", JSON.stringify(stale.s.verdicts));
  check("the old record's key was never read; the current binding's key was", !stale.s.store.gets.includes(RECORDED_KEY) && stale.s.store.gets.includes(recordedVisualReferenceKey(FLOW_ID, STEP_ID, stepCandidatesDigest(retargeted))));
  check("the old record is untouched and execution is unchanged", (await readFile(fileFor(stale.s.folder, RECORDED_KEY), "utf8")) === stale.before && sameRun(stale.run, offRetargeted));

  console.log("\n5: a corrupt and a version-mismatched recorded record:\n");
  for (const [label, rewrite] of [
    ["corrupt (truncated JSON)", (text: string) => text.slice(0, Math.floor(text.length / 2))],
    ["version mismatch", (text: string) => {
      const record = JSON.parse(text) as { evidenceVersion: number; evidence: { version: number } };
      record.evidenceVersion = VISUAL_EVIDENCE_VERSION + 1;
      record.evidence.version = VISUAL_EVIDENCE_VERSION + 1;
      return JSON.stringify(record);
    }]
  ] as const) {
    const bad = await attempted(async () => {
      const s = await staged({ recordedFallback: true });
      const text = rewrite(await writeRecorded(s.folder));
      await writeFile(fileFor(s.folder, RECORDED_KEY), text, "utf8");
      const status = (await new VisualReferenceStore(storeOptions(s.folder)).get(RECORDED_KEY)).status;
      const run = await scenario("idOnly", { recover: s.fusion });
      return { s, run, text, status, verdict: s.verdicts[0] };
    });
    check(`${label}: the store reads it as ${label.startsWith("corrupt") ? "corrupt" : "version-mismatch"} (non-vacuous)`, bad.status === (label.startsWith("corrupt") ? "corrupt" : "version-mismatch"), bad.status);
    check(`${label}: ignored — none, no-reference, effect none`, bad.verdict?.referenceSource === "none" && bad.verdict.reason === "no-reference" && bad.verdict.effect === "none", JSON.stringify(bad.s.verdicts));
    check(`${label}: left as it was and execution unchanged`, (await readFile(fileFor(bad.s.folder, RECORDED_KEY), "utf8")) === bad.text && sameRun(bad.run, off));
  }

  console.log("\n8: the recorded-source boundary holds under any effect a policy could answer:\n");
  check("recorded + veto is none", effectForReferenceSource("recorded", "veto") === "none");
  check("recorded + proceed (an enforce effect) is none", effectForReferenceSource("recorded", "proceed") === "none");
  check("control: runtime keeps veto and proceed, none keeps none", effectForReferenceSource("runtime", "veto") === "veto" && effectForReferenceSource("runtime", "proceed") === "proceed" && effectForReferenceSource("none", "none") === "none");
  const vetoing = (referenceSource: string): LocatorVisualFusion => ({
    observeRecovery: async () => ({ mode: "shadow", outcome: "contradicted", reason: "visual-contradiction", effect: "veto", evidence: { winnerScore: 0.1 }, referenceSource }),
    observePass: async () => undefined
  });
  const vetoRecorded = await scenario("idOnly", { recover: vetoing("recorded") });
  const vetoRuntime = await scenario("idOnly", { recover: vetoing("runtime") });
  check("control: an observer's runtime veto is carried into the trace as veto", vetoRuntime.visuals[0]?.effect === "veto", JSON.stringify(vetoRuntime.visuals));
  check("the factory drops an observer's veto whose source is recorded: effect none, source kept", vetoRecorded.visuals[0]?.effect === "none" && vetoRecorded.visuals[0]?.referenceSource === "recorded", JSON.stringify(vetoRecorded.visuals));
  check("neither observer changed the resolve", sameRun(vetoRecorded, off) && sameRun(vetoRuntime, off));

  console.log("\n9: runner A/B — recorded present, recorded absent, fusion off:\n");
  check("present vs absent: same target, events, traces and winner memory", sameRun(one.run, none.run) && one.run.isTarget === none.run.isTarget);
  check("present vs off: identical as well", sameRun(one.run, off));
  check("only the observational visual block differs (recorded vs none)", visual1?.referenceSource === "recorded" && none.run.visuals[0]?.referenceSource === "none" && off.visuals[0] === null);

  console.log("\n10: N3 agreement compares against the recorded reference with no authority:\n");
  const offDrift = await scenario("drift");
  check("non-vacuous: fusion off, the drifted target is refused below-threshold and left unresolved", offDrift.traces[0]?.stages.some((stage) => stage.stage === "local" && stage.outcome === "refused" && stage.reason === "below-threshold") === true && !offDrift.isTarget);
  for (const agreement of ["shadow", "enforce"] as const) {
    const drift = await attempted(async () => {
      const s = await staged({ recordedFallback: true, agreement });
      const before = await writeRecorded(s.folder);
      const run = await scenario("drift", { recover: s.fusion });
      return { s, run, before, verdict: s.agreements[0] };
    });
    const record = drift.verdict;
    check(`${agreement}: one agreement verdict, compared against the recorded reference`, drift.s.agreements.length === 1 && record?.referenceSource === "recorded" && record.reason !== "no-reference", JSON.stringify(drift.s.agreements));
    check(`${agreement}: requested ${agreement}, effect none in the record and the trace`, record?.requested === agreement && record.effect === "none" && drift.run.agreements[0]?.effect === "none" && drift.run.agreements[0]?.referenceSource === "recorded", JSON.stringify({ record, block: drift.run.agreements[0] }));
    check(`${agreement}: the step stays unresolved, identical to fusion off`, sameRun(drift.run, offDrift) && !drift.run.isTarget && drift.run.traces[0]?.result === "unresolved");
    check(`${agreement}: agreement wrote nothing and the recorded record is untouched`, drift.s.store.refreshes.length === 0 && (await readFile(fileFor(drift.s.folder, RECORDED_KEY), "utf8")) === drift.before);
  }

  console.log("\n11: enablement — AWKIT_VISUAL_RECORDER unset means no recorded read:\n");
  const disabled = await attempted(async () => {
    const s = await staged();
    const before = await writeRecorded(s.folder);
    const run = await scenario("idOnly", { recover: s.fusion });
    return { s, run, before, verdict: s.verdicts[0] };
  });
  check("without recordedFallback no recorded key is read", !disabled.s.store.gets.includes(RECORDED_KEY) && disabled.s.store.gets.length >= 1, JSON.stringify(disabled.s.store.gets.length));
  check("the verdict is exactly the pre-N4 one: none, no-reference", disabled.verdict?.referenceSource === "none" && disabled.verdict.reason === "no-reference", JSON.stringify(disabled.s.verdicts));
  check("execution and the recorded record unchanged", sameRun(disabled.run, off) && (await readFile(fileFor(disabled.s.folder, RECORDED_KEY), "utf8")) === disabled.before);
  const engine = await readFile("src/runner/ExecutionEngine.ts", "utf8");
  const runner = await readFile("src/runner/PlaywrightRunner.ts", "utf8");
  check("the engine sets the fallback only from AWKIT_VISUAL_RECORDER === \"manual\"", /visualRecordedFallback: process\.env\.AWKIT_VISUAL_RECORDER === "manual",/.test(engine) && (engine.match(/visualRecordedFallback/g) ?? []).length === 1);
  check("the runner passes recordedFallback to the stage only when it is exactly true", /\.\.\.\(this\.options\.visualRecordedFallback === true \? \{ recordedFallback: true \} : \{\}\)/.test(runner));

  console.log(`\nBudget-cut runs repeated: ${budgetRetries}`);
}

try {
  await main();
} catch (error) {
  failed += 1;
  console.error(`  ✗ the verifier crashed — ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
} finally {
  await browser?.close().catch(() => undefined);
  await rm(ROOT, { recursive: true, force: true }).catch(() => undefined);
}

console.log(`\n${passed}/${passed + failed} recorded visual fallback checks passed`);
if (failed > 0) process.exitCode = 1;
