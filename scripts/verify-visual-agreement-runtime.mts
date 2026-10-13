/**
 * verify:visual-agreement-runtime — Phase N3.3 (awkit-vra.4.3): the shadow Visual Locator Recovery observer inside a
 * real LocatorFactory on real Chromium.
 *
 * The lab is a toolbar of solid-fill 48x40 buttons whose words live in a hidden span, so a relabel changes the DOM score
 * and never the pixels. Seed winner memory and the step's visual reference with one passing resolve, mutate, resolve
 * again. The `drift` mutation renames the target's id and relabels it "Store profile": DOM score 0.807, below the 0.86
 * threshold, above the 0.6 floor, margin 0.34 over three distinct-looking neighbours, pixels unchanged.
 *
 *   - J6 A/B: no fusion, the N2 stage alone, agreement `shadow` and agreement `enforce` give identical events, traces and
 *     winner memory apart from `visual` / `visualAgreement`, timings and the agreement's log-line suffix, for every
 *     mutation (drift, restyle, swap, twins, near-tie, crowded, offscreen, ambiguous margin, an id-only rename that
 *     recovers, a hover step) and with a throwing sink, a rejecting observer, a slow reference read and a handed-off page;
 *   - the observation: only a local `below-threshold` refusal reaches it, with the DOM best (the target), its score,
 *     ancestry and margin, competitorCount = other compatible candidates, and those competitors (VR-4);
 *   - the verdicts: no-reference before a reference exists; agreed/identical-unique on the drift with effect none, also
 *     when `enforce` is requested; not-identical for a restyle or a swap; identical-competitor for a same-look twin;
 *     dom-floor for a below-threshold near-tie; competitors-uncaptured over eight; an offscreen competitor unavailable;
 *     an ambiguous margin and a recovered step never observed; a hover step not-eligible;
 *   - J7: no observation refreshes or rewrites the reference; J8: sensitive and ineligible steps are decided before
 *     anything is read or captured; J9: a slow observer is cut at the shared 400 ms budget as budget-exhausted;
 *   - the trace block is codes only, toRecoveryProvenance is unchanged by it (N3.5 deferred), and with agreement off
 *     there is no block and `agree` answers nothing.
 *
 * Mutation contract (each run against this suite before it was committed; the red checks are the ones observed):
 *   M1 the stage asks the policy in the requested mode, not `shadow` — red: the enforce record carries "proceed";
 *   M2 the stage refreshes the reference after an agreement capture — red: every J7 check and each refusal's
 *      "no reference write";
 *   M3 the local layer keeps any refusal, not only `below-threshold` — red: the ambiguous margin is observed;
 *   M4 the stage reads the reference before deciding rows A1-A2 — red: the hover step and the direct ineligible
 *      calls read the store.
 *   M5 (QC finding Q4-a, 2026-10-13) the agreement gets a fresh 400 ms after the N2 observation instead of what it left
 *      — red: the two observation sums (664 and 811 ms) and the one-budget resolve wait (874 vs 49 ms off).
 *
 * QC additions (2026-10-13): a local below-threshold refusal that the blueprint layer then recovers meets BOTH shadow
 * observers in one attempt, and they share the one FD-5 budget (J9); the N2-alone vs N2-plus-agreement A/B there keeps
 * the N2 `visual` block, so J6 is proven with only the agreement block and its log suffix excluded; a sensitive step is
 * asserted to reach the observer zero times rather than with a vacuous `every`.
 *
 * The 400 ms budget is a production constant, and on a loaded host it can cut a seed's or an agreement's capture. Such a
 * run is repeated a bounded number of times (the count is printed); the crowded factory case may end either way and is
 * proven deterministically on an unhurried stage. A case whose every attempt is cut FAILS, it never passes on the cut
 * (QC Q8-c: on a loaded host on 2026-10-13, 9 cuts left the crowded and throwing-sink cases red; the rerun had 4 cuts and
 * passed), so no suite-wide ceiling is added: the per-case bound already turns persistent load into a failure.
 *
 * Run: npm run verify:visual-agreement-runtime
 */

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { VISUAL_EVIDENCE_MAX_BYTES, VISUAL_EVIDENCE_VERSION, type VisualEvidence } from "@src/visual/visualEvidence";
import type { FlowStep } from "@src/profiles/FlowProfile";
import {
  LocatorFactory,
  VISUAL_OBSERVATION_BUDGET_MS,
  type LocatorRecoveryEvent,
  type LocatorRecoveryTrace,
  type LocatorRecoveryVisualAgreement,
  type LocatorVisualAgreementObservation,
  type LocatorVisualFusion,
  type LocatorVisualVerdict
} from "@src/runner/LocatorFactory";
import { computePageKey, type LocatorBlueprintStore, type PageBlueprint } from "@src/runner/LocatorBlueprintStore";
import { captureBlueprintSnapshot } from "@src/runner/recoverySnapshot";
import { toRecoveryProvenance } from "@src/runner/domIntelligence/recoveryProvenance";
import { FileLocatorRecoveryStore } from "@src/runner/LocatorRecoveryStore";
import { VisualFusionStage, type VisualAgreementRecord } from "@src/runner/visualFusion/VisualFusionStage";
import { VisualReferenceStore, type VisualReferenceStoreOptions } from "@src/runner/visualFusion/VisualReferenceStore";

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

const ROOT = await mkdtemp(join(tmpdir(), "awkit-visual-agreement-"));
let browser: Browser | undefined;

const LAB = `<!doctype html><html><head><style>
body{margin:24px;background:#fff}
.bar{display:flex;gap:16px}
.tool{display:block;width:48px;height:40px;margin:0;padding:0;border:0;border-radius:0;outline:none}
.blue{background:#1d4ed8}.gray{background:#9ca3af}.amber{background:#f59e0b}.green{background:#16a34a}.red{background:#dc2626}
.purple{background:#7c3aed}.pink{background:#db2777}.teal{background:#0d9488}.slate{background:#334155}.orange{background:#ea580c}.lime{background:#65a30d}
</style></head><body><main><section id="profile"><div class="bar" id="bar">
<button id="save-profile" class="tool blue" type="button" aria-label="Save profile"><span hidden>save</span></button>
<button id="cancel-profile" class="tool gray" type="button" aria-label="Cancel"><span hidden>cancel</span></button>
<button id="reset-profile" class="tool amber" type="button" aria-label="Reset form"><span hidden>reset</span></button>
<button id="export-profile" class="tool green" type="button" aria-label="Export"><span hidden>export</span></button>
</div></section></main></body></html>`;

const button = (id: string, color: string, label: string, word: string, style = ""): string =>
  `<button id="${id}" class="tool ${color}" type="button" aria-label="${label}"${style ? ` style="${style}"` : ""}><span hidden>${word}</span></button>`;

interface Mutation {
  id?: string;
  label?: string;
  className?: string;
  append?: string;
}

const DRIFT: Mutation = { id: "profile-save", label: "Store profile" };
const MUTATIONS = {
  /** Every saved candidate misses; the relabel drops the DOM score to 0.807 with the pixels unchanged. */
  drift: DRIFT,
  restyle: { ...DRIFT, className: "tool red" },
  /** The target now looks like its gray neighbour. */
  swap: { ...DRIFT, className: "tool gray" },
  /** A new button that looks exactly like the target and scores 0.467 against it. */
  twins: { ...DRIFT, append: button("remove-item", "blue", "Remove item", "remove") },
  /** A second element scoring exactly what the drifted target scores, and looking exactly like it. */
  nearTie: { ...DRIFT, append: button("profile-store", "blue", "Store profile", "save") },
  /** Nine competitors, one over AGREEMENT_MAX_COMPETITORS. */
  crowded: {
    ...DRIFT,
    append: ["red", "purple", "pink", "teal", "slate", "orange"].map((color, index) => button(`extra-${index}`, color, `Extra ${index}`, `extra${index}`)).join("")
  },
  offscreen: { ...DRIFT, append: button("far-away", "purple", "Far away", "far", "position:absolute;left:24px;top:2400px") },
  /** Only the id renamed: 0.983 for the target and for a same-label copy, so the local layer refuses on margin. */
  ambiguous: { id: "profile-save", append: button("profile-save-2", "lime", "Save profile", "save") },
  /** Only the id renamed: the local layer recovers the target. */
  idOnly: { id: "profile-save" }
} satisfies Record<string, Mutation>;
type MutationName = keyof typeof MUTATIONS;

const AGREEMENT_SUFFIX = / Visual agreement \(shadow, no effect\): [a-z-]+\([a-z-]+\)\./g;
/** Timings differ between any two runs; `visual`, `visualAgreement` and the agreement's log suffix exist only with them on. */
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
  messages: string[];
  agreements: (LocatorRecoveryVisualAgreement | null)[];
  recoverMs: number;
}

interface ScenarioOptions {
  type?: string;
  extra?: Partial<FlowStep>;
  /** Runs after seeding, before the mutation. */
  beforeRecover?: () => void;
  /** Runs after the second resolve, while the page is still open. */
  afterRecover?: () => Promise<unknown>;
  /**
   * Give the step a blueprint of the target as it looks AFTER the mutation: the local layer still refuses against
   * winner memory, then the blueprint layer recovers the target, so one attempt meets both observers (J9).
   */
  blueprint?: boolean;
}

const BLUEPRINT_ID = "bp-save-profile";

/** A page blueprint of the marked target as the page is now, captured with the factory's own snapshot. */
async function blueprintOfTarget(page: Page): Promise<PageBlueprint> {
  const order = await page.evaluate(() => Array.from(document.body.querySelectorAll("*")).indexOf((window as unknown as { __target: Element }).__target));
  const snapshot = await captureBlueprintSnapshot(page.locator("body *"), { documentOrder: order });
  const own = snapshot.window.find((entry) => entry.index === order);
  if (!own) throw new Error(`the target (document order ${order}) is not in its own blueprint window`);
  return {
    schemaVersion: 1,
    pageKey: computePageKey(page.url(), await page.title()),
    canonicalUrl: page.url(),
    capturedAtUtc: new Date().toISOString(),
    documentFingerprint: snapshot.documentFingerprint,
    elements: [
      {
        blueprintId: BLUEPRINT_ID,
        documentOrder: order,
        siblingIndex: own.siblingIndex,
        sameTagIndex: own.sameTagIndex,
        tag: "button",
        ancestry: [...own.fingerprint.ancestry],
        fingerprint: own.fingerprint,
        primaryLocatorDigest: "n3-qc",
        alternativeCount: 0,
        visible: true,
        boundingRegion: own.boundingRegion
      }
    ]
  };
}

/** Seed winner memory (and, with a stage, the reference) with one passing resolve, mutate, resolve again. */
async function scenario(mutation: MutationName, fusion: { seed?: LocatorVisualFusion; recover?: LocatorVisualFusion } = {}, options: ScenarioOptions = {}): Promise<ScenarioRun> {
  const page: Page = await browser!.newPage({ viewport: { width: 800, height: 600 } });
  try {
    await page.setContent(LAB);
    const folder = await mkdtemp(join(ROOT, "recovery-"));
    const recoveryStore = new FileLocatorRecoveryStore(folder);
    const events: LocatorRecoveryEvent[] = [];
    const step = {
      id: "save-profile",
      name: "Save profile",
      type: options.type ?? "click",
      locator: { strategy: "css", value: "#save-profile", ...(options.blueprint ? { blueprintId: BLUEPRINT_ID } : {}) },
      ...options.extra
    } as unknown as FlowStep;
    let blueprint: PageBlueprint | undefined;
    const blueprintStore: LocatorBlueprintStore = { get: async (pageKey) => (blueprint?.pageKey === pageKey ? blueprint : undefined), put: async () => undefined, list: async () => (blueprint ? [blueprint] : []) };
    const factory = (visualFusion?: LocatorVisualFusion) =>
      new LocatorFactory(page, {
        recoveryStore,
        scope: { scenarioId: "n3-3", flowId: "agreement" },
        recoveryGraceMs: 0,
        onRecoveryEvent: (event) => events.push(event),
        ...(options.blueprint ? { blueprintStore } : {}),
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
    options.beforeRecover?.();
    await page.evaluate((spec: Mutation) => {
      const target = document.getElementById("save-profile")!;
      if (spec.label) target.setAttribute("aria-label", spec.label);
      if (spec.className) target.className = spec.className;
      if (spec.append) document.getElementById("bar")!.insertAdjacentHTML("beforeend", spec.append);
      if (spec.id) target.id = spec.id;
    }, MUTATIONS[mutation] as Mutation);
    if (options.blueprint) blueprint = await blueprintOfTarget(page);
    let isTarget = false;
    let resolvedText: string | null = null;
    let recoverMs = 0;
    const recoverStarted = performance.now();
    try {
      const locator = await factory(fusion.recover)
        .resolve(step)
        .finally(() => (recoverMs = performance.now() - recoverStarted));
      // A refused recovery hands back the primary so the action can auto-wait (legacy path): it matches nothing, so
      // count it instead of waiting out the action timeout on it.
      if ((await locator.count()) === 1) {
        isTarget = await locator.evaluate((element) => element === (window as unknown as { __target: Element }).__target, undefined, { timeout: 2_000 });
        resolvedText = await locator.getAttribute("aria-label", { timeout: 2_000 });
      }
    } catch {
      resolvedText = null;
    }
    await options.afterRecover?.();
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
      messages: traceEvents.map((event) => event.message ?? ""),
      agreements: traceEvents.map((event) => event.trace?.visualAgreement ?? null),
      recoverMs
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

const sameRun = (a: ScenarioRun, b: ScenarioRun): boolean =>
  JSON.stringify([a.seeded, a.recovered, a.isTarget, a.resolvedText, a.events, a.memory]) === JSON.stringify([b.seeded, b.recovered, b.isTarget, b.resolvedText, b.events, b.memory]);

const jsonFiles = async (folder: string): Promise<string[]> => (await readdir(folder).catch(() => [] as string[])).filter((n) => n.endsWith(".json"));
const folderText = async (folder: string): Promise<string> =>
  (await Promise.all((await jsonFiles(folder)).sort().map(async (name) => `${name}:${await readFile(join(folder, name), "utf8")}`))).join("\n");
const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const digestOf = (value: unknown): string | null => (value as VisualEvidence | null)?.fingerprint?.contentDigest ?? null;

class CountingStore extends VisualReferenceStore {
  refreshes = 0;
  gets = 0;
  delayMs = 0;
  override async refresh(...args: Parameters<VisualReferenceStore["refresh"]>): ReturnType<VisualReferenceStore["refresh"]> {
    this.refreshes += 1;
    return super.refresh(...args);
  }
  override async get(...args: Parameters<VisualReferenceStore["get"]>): ReturnType<VisualReferenceStore["get"]> {
    this.gets += 1;
    if (this.delayMs > 0) await settle(this.delayMs);
    return super.get(...args);
  }
}

interface Agreeing {
  fusion: LocatorVisualFusion;
  stage: VisualFusionStage;
  store: CountingStore;
  folder: string;
  records: VisualAgreementRecord[];
  observations: LocatorVisualAgreementObservation[];
  bestIsTarget: boolean[];
  /** The ids of each observation's competitors, read while the page is open. */
  competitorIds: (string | null)[][];
  /** The harness's own reads, awaited once the scenario is over. */
  pending: Promise<void>[];
  /** Store refreshes and reference-file changes that happened while `agree` ran (J7). */
  refreshesDuringAgree: number;
  referenceChanged: boolean;
  /** Reference reads `agree` made. */
  getsDuringAgree: number;
}

interface AgreeingOptions {
  handedOff?: () => boolean;
  slowGetMs?: number;
  sink?: (record: VisualAgreementRecord) => void;
  rejectAgree?: boolean;
}

/** A real VisualFusionStage on its own folder; `agreement` undefined is the N2 stage with agreement off. */
async function agreeing(agreement: "shadow" | "enforce" | undefined, options: AgreeingOptions = {}): Promise<Agreeing> {
  const folder = await mkdtemp(join(ROOT, "visual-"));
  const storeOptions: VisualReferenceStoreOptions = { folder, evidenceVersion: VISUAL_EVIDENCE_VERSION, maxEvidenceBytes: VISUAL_EVIDENCE_MAX_BYTES, digestOf };
  const store = new CountingStore(storeOptions);
  const out = { folder, store, records: [], observations: [], bestIsTarget: [], competitorIds: [], pending: [], refreshesDuringAgree: 0, referenceChanged: false, getsDuringAgree: 0 } as unknown as Agreeing;
  out.stage = new VisualFusionStage({
    folder,
    store,
    handedOff: options.handedOff ?? (() => false),
    ...(agreement ? { agreement } : {}),
    onAgreement: (record) => {
      out.records.push(record);
      options.sink?.(record);
    }
  });
  out.fusion = {
    observeRecovery: (observation) => out.stage.observeRecovery(observation),
    observePass: (observation) => out.stage.observePass(observation),
    ...(agreement
      ? {
          agree: async (observation: LocatorVisualAgreementObservation) => {
            // The harness's own reads run beside the stage, never ahead of it: the factory's budget covers this whole call.
            const index = out.observations.push(observation) - 1;
            out.pending.push(
              observation.locator
                .evaluate((element) => element === (window as unknown as { __target: Element }).__target, undefined, { timeout: 2_000 })
                .catch(() => false)
                .then((isTarget) => void (out.bestIsTarget[index] = isTarget)),
              Promise.all(observation.competitors.map((competitor) => competitor.getAttribute("id", { timeout: 2_000 }).catch(() => null))).then((ids) => void (out.competitorIds[index] = ids))
            );
            if (options.rejectAgree) throw new Error("observer failed");
            const refreshes = store.refreshes;
            const gets = store.gets;
            const before = await folderText(folder);
            if (options.slowGetMs !== undefined) store.delayMs = options.slowGetMs;
            const verdict = await out.stage.agree(observation);
            out.refreshesDuringAgree += store.refreshes - refreshes;
            out.getsDuringAgree += store.gets - gets;
            out.pending.push(folderText(folder).then((after) => void (after !== before && (out.referenceChanged = true))));
            return verdict;
          }
        }
      : {})
  };
  return out;
}

/** Runs cut by the 400 ms budget on a loaded host and run again; reported, never hidden. */
let budgetRetries = 0;
const BUDGET_ATTEMPTS = 5;

/**
 * A run with a seeded stage: the run, the stage, and its one verdict. The shared budget can cut the agreement capture
 * (budget-exhausted) or the seed's own reference capture (no-reference after a seed); both are legitimate J9 outcomes but
 * not the case under test, so such a run is repeated on a fresh stage at most BUDGET_ATTEMPTS times. The slow-read case
 * expects the agreement cut, so it is repeated only when its seed wrote no reference.
 */
async function agreed(mutation: MutationName, agreement: "shadow" | "enforce" = "shadow", options: AgreeingOptions = {}, scenarioOptions: ScenarioOptions = {}) {
  for (let attempt = 1; ; attempt += 1) {
    const a = await agreeing(agreement, options);
    const run = await scenario(mutation, { seed: a.fusion, recover: a.fusion }, { ...scenarioOptions, afterRecover: () => Promise.all(a.pending) });
    await Promise.all(a.pending);
    const block = run.agreements.find(Boolean) ?? null;
    const cut =
      block?.reason === "no-reference" || (block?.reason === "budget-exhausted" && (options.slowGetMs === undefined || a.store.refreshes === 0));
    if (cut && attempt < BUDGET_ATTEMPTS) {
      budgetRetries += 1;
      continue;
    }
    return { a, run, record: a.records[0], block };
  }
}

async function main(): Promise<void> {
  browser = await chromium.launch();
  // Warm-up, discarded: the first screenshot of a fresh browser process can exceed the 400 ms budget on its own.
  const warm = await agreeing("shadow");
  await scenario("drift", { seed: warm.fusion, recover: warm.fusion });

  console.log("\nThe lab: a below-threshold refusal of the drifted target, identical in pixels:\n");
  const off = await scenario("drift");
  check("the off run seeds the target (non-vacuous)", off.seeded);
  const [offTrace] = off.traces;
  const offLocal = offTrace?.stages.find((stage) => stage.stage === "local");
  check("the local layer refuses below-threshold", offLocal?.outcome === "refused" && offLocal.reason === "below-threshold", JSON.stringify(offTrace?.stages));
  check("off: no trace carries a visualAgreement block or the agreement log suffix", off.agreements.every((block) => block === null) && off.messages.every((m) => !m.includes("Visual agreement")));

  console.log("\nJ6: agreement off, N2 stage, shadow and enforce give the same resolve (A/B):\n");
  const n2 = await agreeing(undefined);
  const n2Run = await scenario("drift", { seed: n2.fusion, recover: n2.fusion });
  check("the N2 stage alone: identical to off, and no visualAgreement block", sameRun(n2Run, off) && n2Run.agreements.every((block) => block === null));
  check("agreement off: the stage's agree answers nothing", (await n2.stage.agree({} as LocatorVisualAgreementObservation)) === undefined && n2.records.length === 0);
  const shadow = await agreed("drift");
  check("shadow: identical events, traces and winner memory (timings, visual blocks and suffix excluded)", sameRun(shadow.run, off), `${shadow.run.events.slice(0, 240)} vs ${off.events.slice(0, 240)}`);
  const enforce = await agreed("drift", "enforce");
  check("enforce requested: identical to off as well", sameRun(enforce.run, off));

  console.log("\nVR-4: what the observer is shown:\n");
  const [observation] = shadow.a.observations;
  check("exactly one observation for the one refused recovery", shadow.a.observations.length === 1, `${shadow.a.observations.length}`);
  check("the refusal is below-threshold and the DOM best is the drifted target", observation?.refusal === "below-threshold" && shadow.a.bestIsTarget[0] === true);
  check(
    "the best's DOM score is under 0.86 and over the 0.6 floor, full ancestry, margin over 0.08",
    !!observation && observation.best.score < 0.86 && observation.best.score >= 0.6 && observation.best.ancestry === 1 && observation.margin >= 0.08,
    JSON.stringify(observation && { best: observation.best, margin: observation.margin })
  );
  const competitorIds = [...(shadow.a.competitorIds[0] ?? [])];
  check(
    "competitorCount is the three other buttons, and exactly those three are shown",
    observation?.competitorCount === 3 && JSON.stringify(competitorIds.sort()) === JSON.stringify(["cancel-profile", "export-profile", "reset-profile"]),
    `${observation?.competitorCount} / ${JSON.stringify(competitorIds)}`
  );
  check("the observation carries the step's scopeKey and is not sensitive", !!observation?.scopeKey && observation.sensitive === false);

  console.log("\nThe verdict on the drift:\n");
  check("the stage verdict: agreed / identical-unique, effect none, requested shadow", shadow.record?.outcome === "agreed" && shadow.record.reason === "identical-unique" && shadow.record.effect === "none" && shadow.record.requested === "shadow", JSON.stringify(shadow.a.records));
  check("exactly one verdict", shadow.a.records.length === 1);
  check(
    "the trace block: shadow, kind agreement, the same codes, effect none, a duration",
    shadow.block?.mode === "shadow" && shadow.block.kind === "agreement" && shadow.block.outcome === "agreed" && shadow.block.reason === "identical-unique" && shadow.block.effect === "none" && typeof shadow.block.ms === "number",
    JSON.stringify(shadow.block)
  );
  check(
    "the trace block holds codes only: exactly its six fields",
    JSON.stringify(Object.keys(shadow.block ?? {}).sort()) === JSON.stringify(["effect", "kind", "mode", "ms", "outcome", "reason"]) && !/sha256|digest|bounds|base64|#save|profile-save|"x":/i.test(JSON.stringify(shadow.block))
  );
  check("the log line says it had no effect", shadow.run.messages.some((m) => m.endsWith(" Visual agreement (shadow, no effect): agreed(identical-unique).")), shadow.run.messages.join(" | "));
  check("the step result is unchanged: the drifted target was NOT resolved", !shadow.run.isTarget && shadow.run.resolvedText === null && shadow.run.traces[0]?.result === "unresolved");
  check("enforce requested: still agreed, recorded as requested enforce, effect none in the record and the trace", enforce.record?.outcome === "agreed" && enforce.record.requested === "enforce" && enforce.record.effect === "none" && enforce.block?.effect === "none", JSON.stringify({ record: enforce.record, block: enforce.block }));
  check("enforce: the step result is unchanged too", !enforce.run.isTarget && enforce.run.resolvedText === null);

  console.log("\nJ7: an agreement observation never writes the reference:\n");
  check("the passing seed refreshed the reference once (non-vacuous)", shadow.a.store.refreshes === 1 && (await jsonFiles(shadow.a.folder)).length === 1, `${shadow.a.store.refreshes}`);
  check("no refresh call during agree, and the reference file unchanged", shadow.a.refreshesDuringAgree === 0 && !shadow.a.referenceChanged);
  check("enforce: no refresh during agree either", enforce.a.refreshesDuringAgree === 0 && !enforce.a.referenceChanged);

  console.log("\nN3.5 deferred: provenance is unchanged by the block:\n");
  const shadowTrace = shadow.run.traces[0];
  const { visualAgreement: _block, ...withoutBlock } = shadowTrace ?? ({} as LocatorRecoveryTrace);
  check("toRecoveryProvenance of the trace equals that of the same trace without the block", !!shadowTrace && JSON.stringify(toRecoveryProvenance(shadowTrace)) === JSON.stringify(toRecoveryProvenance(withoutBlock as LocatorRecoveryTrace)));
  check("...and equals the off run's provenance (timings excluded)", !!offTrace && JSON.stringify(toRecoveryProvenance(shadowTrace), stable) === JSON.stringify(toRecoveryProvenance(offTrace), stable));
  check("the provenance names no agreement", !/agreement|identical-unique/.test(JSON.stringify(toRecoveryProvenance(shadowTrace))));

  console.log("\nRefusals (each A/B-identical to off):\n");
  const refusals: [MutationName, string, string][] = [
    ["restyle", "refused", "not-identical"],
    ["swap", "refused", "not-identical"],
    ["twins", "refused", "identical-competitor"],
    ["nearTie", "refused", "dom-floor"],
    ["offscreen", "unavailable", "target-offscreen"]
  ];
  for (const [mutation, outcome, reason] of refusals) {
    const offRun = await scenario(mutation);
    const on = await agreed(mutation);
    check(`${mutation}: ${outcome} / ${reason}, effect none`, on.record?.outcome === outcome && on.record.reason === reason && on.record.effect === "none" && on.block?.reason === reason, JSON.stringify(on.a.records));
    check(`${mutation}: identical to off, the step unchanged, no reference write`, sameRun(on.run, offRun) && on.a.refreshesDuringAgree === 0 && !on.a.referenceChanged);
  }
  // Nine captures in one screenshot sit near the 400 ms budget on a loaded host, so the factory run may be cut (J9);
  // either way it never agrees. The A6 refusal itself is proven with an unhurried stage below.
  const crowdedOff = await scenario("crowded");
  const crowded = await agreed("crowded");
  console.log(`    (crowded through the factory: ${crowded.block?.outcome}/${crowded.block?.reason})`);
  check(
    "crowded: refused competitors-uncaptured or cut by the budget, never agreed, effect none",
    (crowded.block?.reason === "competitors-uncaptured" || crowded.block?.reason === "budget-exhausted") && crowded.block.effect === "none" && crowded.a.records.every((r) => r.outcome !== "agreed"),
    JSON.stringify({ block: crowded.block, records: crowded.a.records })
  );
  check("crowded: identical to off, the step unchanged, no reference write", sameRun(crowded.run, crowdedOff) && crowded.a.refreshesDuringAgree === 0 && !crowded.a.referenceChanged);
  check("crowded: competitorCount counts all nine, capture is capped at eight", crowded.a.observations[0]?.competitorCount === 9 && crowded.a.observations[0].competitors.length === 8, `${crowded.a.observations[0]?.competitorCount} / ${crowded.a.observations[0]?.competitors.length}`);
  const twins = await agreed("twins");
  check("twins: the twin is among the competitors shown (non-vacuous)", twins.a.observations[0]?.competitorCount === 4 && twins.a.observations[0].competitors.length === 4);

  console.log("\nNever observed: an ambiguous margin, a recovered step:\n");
  const ambiguousOff = await scenario("ambiguous");
  const ambiguous = await agreed("ambiguous");
  check("ambiguous: the local layer refuses on margin (non-vacuous)", ambiguousOff.traces[0]?.stages.some((stage) => stage.stage === "local" && stage.reason === "ambiguous-margin"), JSON.stringify(ambiguousOff.traces[0]?.stages));
  check("ambiguous: agree is never called and no block is recorded; identical to off", ambiguous.a.observations.length === 0 && ambiguous.block === null && sameRun(ambiguous.run, ambiguousOff));
  const idOff = await scenario("idOnly");
  const idOn = await agreed("idOnly");
  check("id-only rename: recovered locally to the target (non-vacuous)", idOff.recovered && idOff.isTarget);
  check("id-only rename: agree is never called; identical to off", idOn.a.observations.length === 0 && idOn.block === null && sameRun(idOn.run, idOff));

  console.log("\nJ8: ineligible and sensitive steps are decided before anything is read or captured:\n");
  const hoverOff = await scenario("drift", {}, { type: "hover" });
  const hover = await agreed("drift", "shadow", {}, { type: "hover" });
  check("hover: not-eligible / ineligible-step, no reference read", hover.record?.outcome === "not-eligible" && hover.record.reason === "ineligible-step" && hover.a.getsDuringAgree === 0, JSON.stringify(hover.a.records));
  check("hover: identical to off", sameRun(hover.run, hoverOff));
  const sensitiveExtra = { safety: { sideEffectLevel: "dangerousMutation", retryable: false } } as unknown as Partial<FlowStep>;
  const sensitiveOff = await scenario("drift", {}, { extra: sensitiveExtra });
  const sensitive = await agreed("drift", "shadow", {}, { extra: sensitiveExtra });
  check("sensitive: identical to off", sameRun(sensitive.run, sensitiveOff));
  // The factory refuses a sensitive step's recovery before any layer scores, so nothing reaches the observer; the
  // stage's own sensitive refusal is proven by the direct calls below.
  check(
    "sensitive: never observed, so never agreed, captured or read (zero observations, verdicts and reads; no block)",
    sensitive.a.observations.length === 0 && sensitive.a.records.length === 0 && sensitive.a.getsDuringAgree === 0 && sensitive.block === null,
    JSON.stringify({ observations: sensitive.a.observations.length, records: sensitive.a.records, block: sensitive.block })
  );
  // The same observation the drift produced, replayed straight into the seeded stage with one field changed.
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  try {
    await page.setContent(LAB);
    await page.evaluate((spec: Mutation) => {
      const target = document.getElementById("save-profile")!;
      target.setAttribute("aria-label", spec.label!);
      target.id = spec.id!;
    }, DRIFT);
    const direct = (overrides: Partial<LocatorVisualAgreementObservation>): LocatorVisualAgreementObservation => ({
      ...observation!,
      page,
      locator: page.locator("#profile-save"),
      competitors: ["#cancel-profile", "#reset-profile", "#export-profile"].map((selector) => page.locator(selector)),
      signal: new AbortController().signal,
      ...overrides
    });
    // The seeded store behind an unhurried stage: these calls test decisions, not the budget (J9 is tested on its own).
    const roomy = new VisualFusionStage({ folder: shadow.a.folder, store: shadow.a.store, handedOff: () => false, agreement: "shadow", budgetMs: 10_000 });
    const gets = shadow.a.store.gets;
    const replay = await roomy.agree(direct({}));
    check("direct replay of the drift observation agrees (the harness is live)", replay?.outcome === "agreed" && replay.reason === "identical-unique", JSON.stringify(replay));
    const readsForReplay = shadow.a.store.gets - gets;
    const sensitiveVerdict = await roomy.agree(direct({ sensitive: true }));
    const hoverVerdict = await roomy.agree(direct({ step: { ...observation!.step, type: "hover" } as FlowStep }));
    const marginVerdict = await roomy.agree(direct({ refusal: "ambiguous-margin" }));
    check("direct, sensitive: not-eligible / ineligible-step", sensitiveVerdict?.outcome === "not-eligible" && sensitiveVerdict.reason === "ineligible-step");
    check("direct, hover: not-eligible / ineligible-step", hoverVerdict?.outcome === "not-eligible" && hoverVerdict.reason === "ineligible-step");
    check("direct, an ambiguous-margin refusal: not-eligible / refusal-not-eligible", marginVerdict?.outcome === "not-eligible" && marginVerdict.reason === "refusal-not-eligible");
    check("those three read the reference zero times (the replay read it once)", readsForReplay === 1 && shadow.a.store.gets - gets === 1, `${shadow.a.store.gets - gets}`);
    const handed = new VisualFusionStage({ folder: shadow.a.folder, store: shadow.a.store, handedOff: () => true, agreement: "shadow" });
    const handedVerdict = await handed.agree(direct({}));
    check("direct, a handed-off page: unavailable, never agreed", handedVerdict?.outcome === "unavailable", JSON.stringify(handedVerdict));
    const throwing = new VisualFusionStage({ folder: shadow.a.folder, store: shadow.a.store, handedOff: () => { throw new Error("guard failed"); }, agreement: "shadow" });
    check("direct, a throwing handoff check fails closed: unavailable", (await throwing.agree(direct({})))?.outcome === "unavailable");
    await page.evaluate((html: string) => document.getElementById("bar")!.insertAdjacentHTML("beforeend", html), MUTATIONS.crowded.append);
    const crowdedIds = ["#cancel-profile", "#reset-profile", "#export-profile", ...[0, 1, 2, 3, 4, 5].map((index) => `#extra-${index}`)];
    const crowdedVerdict = await roomy.agree(direct({ competitorCount: 9, competitors: crowdedIds.map((selector) => page.locator(selector)) }));
    check("direct, nine competitors with eight captured: refused / competitors-uncaptured", crowdedVerdict?.outcome === "refused" && crowdedVerdict.reason === "competitors-uncaptured", JSON.stringify(crowdedVerdict));
    const eightVerdict = await roomy.agree(direct({ competitorCount: 8, competitors: crowdedIds.slice(0, 8).map((selector) => page.locator(selector)) }));
    check("direct, the same page with eight competitors all captured: agreed (the cap is the cause)", eightVerdict?.outcome === "agreed" && eightVerdict.reason === "identical-unique", JSON.stringify(eightVerdict));
    check("no refresh from any direct call", shadow.a.store.refreshes === 1);
  } finally {
    await page.close().catch(() => undefined);
  }

  console.log("\nR1 without a reference; a handed-off page in the factory:\n");
  const noRef = await agreeing("shadow");
  const noRefRun = await scenario("drift", { recover: noRef.fusion });
  check("no reference yet: unavailable / no-reference, identical to off", noRef.records[0]?.outcome === "unavailable" && noRef.records[0].reason === "no-reference" && sameRun(noRefRun, off), JSON.stringify(noRef.records));
  check("...and the agreement observation did not create one (J7)", noRef.store.refreshes === 0 && (await jsonFiles(noRef.folder)).length === 0);
  let handedOff = false;
  const handedRun = await agreed("drift", "shadow", { handedOff: () => handedOff }, { beforeRecover: () => (handedOff = true) });
  check("handed off after seeding: unavailable, never agreed; identical to off", handedRun.record?.outcome === "unavailable" && sameRun(handedRun.run, off), JSON.stringify(handedRun.a.records));

  console.log("\nFailing observers change nothing:\n");
  const sinkThrows = await agreed("drift", "shadow", {
    sink: () => {
      throw new Error("sink failed");
    }
  });
  check("a throwing sink: the verdict still reaches the trace; identical to off", sinkThrows.block?.outcome === "agreed" && sameRun(sinkThrows.run, off));
  const rejecting = await agreed("drift", "shadow", { rejectAgree: true });
  check("a rejecting observer: observed once, no block; identical to off", rejecting.a.observations.length === 1 && rejecting.block === null && sameRun(rejecting.run, off));

  console.log("\nJ9: a slow observer is cut at the shared budget:\n");
  const slow = await agreed("drift", "shadow", { slowGetMs: VISUAL_OBSERVATION_BUDGET_MS + 600 });
  check("the trace says unavailable / budget-exhausted with effect none", slow.block?.outcome === "unavailable" && slow.block.reason === "budget-exhausted" && slow.block.effect === "none", JSON.stringify(slow.block));
  check("identical to off", sameRun(slow.run, off));
  check(
    "the resolve waited about the budget, not the slow read",
    slow.run.recoverMs < off.recoverMs + VISUAL_OBSERVATION_BUDGET_MS + 450,
    `${slow.run.recoverMs.toFixed(0)} ms vs off ${off.recoverMs.toFixed(0)} ms`
  );
  await settle(VISUAL_OBSERVATION_BUDGET_MS + 900);
  check("the late stage wrote nothing", slow.a.store.refreshes === 1 && !slow.a.referenceChanged, `${slow.a.store.refreshes}`);

  console.log("\nJ9: a local refusal a later layer recovers meets both observers, inside ONE budget:\n");
  const bpOff = await scenario("drift", {}, { blueprint: true });
  const bpStages = bpOff.traces[0]?.stages ?? [];
  check(
    "off: the local layer refuses below-threshold, then the blueprint layer proves the drifted target (non-vacuous)",
    bpOff.recovered && bpOff.isTarget && bpStages.some((s) => s.stage === "local" && s.outcome === "refused" && s.reason === "below-threshold") && bpStages.some((s) => s.stage === "blueprint" && s.outcome === "proven"),
    JSON.stringify(bpStages)
  );
  // Stub observers that ignore the abort signal: only the factory's bound can stop the step waiting for them.
  const stubbed = (recoveryMs: number, agreeMs: number) => {
    const calls = { recoveries: 0, agreements: 0 };
    const fusion: LocatorVisualFusion = {
      observePass: async () => undefined,
      observeRecovery: async (): Promise<LocatorVisualVerdict> => {
        calls.recoveries += 1;
        await settle(recoveryMs);
        return { mode: "shadow", outcome: "dom-only", reason: "stub", effect: "none", evidence: {} };
      },
      agree: async () => {
        calls.agreements += 1;
        await settle(agreeMs);
        return { outcome: "refused", reason: "stub", effect: "none" };
      }
    };
    return { fusion, calls };
  };
  const quick = stubbed(0, 0);
  const quickRun = await scenario("drift", { seed: quick.fusion, recover: quick.fusion }, { blueprint: true });
  const quickTrace = quickRun.traces[0];
  check(
    "quick observers: both are asked once and both blocks are recorded (the shared-budget path is live)",
    quick.calls.recoveries === 1 && quick.calls.agreements === 1 && quickTrace?.visual?.reason === "stub" && quickTrace.visualAgreement?.reason === "stub",
    JSON.stringify({ calls: quick.calls, visual: quickTrace?.visual, agreement: quickTrace?.visualAgreement })
  );
  check("quick observers: identical to off", sameRun(quickRun, bpOff));
  const SLACK_MS = 120;
  const partial = stubbed(250, VISUAL_OBSERVATION_BUDGET_MS + 600);
  const partialRun = await scenario("drift", { seed: partial.fusion, recover: partial.fusion }, { blueprint: true });
  const partialTrace = partialRun.traces[0];
  const partialSum = (partialTrace?.visual?.ms ?? Infinity) + (partialTrace?.visualAgreement?.ms ?? Infinity);
  check(
    "N2 takes 250 ms: the agreement gets only the remainder and is cut there (budget-exhausted)",
    partialTrace?.visual?.reason === "stub" && partialTrace.visualAgreement?.reason === "budget-exhausted" && partialTrace.visualAgreement.effect === "none",
    JSON.stringify({ visual: partialTrace?.visual, agreement: partialTrace?.visualAgreement })
  );
  check(`...the two observations together stay within the ${VISUAL_OBSERVATION_BUDGET_MS} ms budget`, partialSum < VISUAL_OBSERVATION_BUDGET_MS + SLACK_MS, `${partialSum.toFixed(0)} ms`);
  check("...identical to off", sameRun(partialRun, bpOff));
  const spent = stubbed(VISUAL_OBSERVATION_BUDGET_MS + 600, VISUAL_OBSERVATION_BUDGET_MS + 600);
  const spentRun = await scenario("drift", { seed: spent.fusion, recover: spent.fusion }, { blueprint: true });
  const spentTrace = spentRun.traces[0];
  const spentSum = (spentTrace?.visual?.ms ?? Infinity) + (spentTrace?.visualAgreement?.ms ?? Infinity);
  check(
    "both slow: N2 is cut at the budget and the agreement records budget-exhausted, effect none",
    spentTrace?.visual?.reason === "budget-exhausted" && spentTrace.visualAgreement?.outcome === "unavailable" && spentTrace.visualAgreement.reason === "budget-exhausted" && spentTrace.visualAgreement.effect === "none",
    JSON.stringify({ visual: spentTrace?.visual, agreement: spentTrace?.visualAgreement })
  );
  check(`...together within the ${VISUAL_OBSERVATION_BUDGET_MS} ms budget, not two of them`, spentSum < VISUAL_OBSERVATION_BUDGET_MS + SLACK_MS, `${spentSum.toFixed(0)} ms`);
  check(
    "...and the resolve waited about one budget, not two",
    spentRun.recoverMs < bpOff.recoverMs + VISUAL_OBSERVATION_BUDGET_MS + 250,
    `${spentRun.recoverMs.toFixed(0)} ms vs off ${bpOff.recoverMs.toFixed(0)} ms`
  );
  check("...identical to off", sameRun(spentRun, bpOff));

  console.log("\nJ6 with the N2 block kept: the N2 stage alone and N2 plus agreement differ only by the agreement:\n");
  /** As `stable`, but the N2 `visual` block stays (its codes and scores; only its duration goes). */
  const keepVisual = (key: string, value: unknown): unknown => {
    if (/(^ms|Ms|At)$/.test(key) || key === "visualAgreement") return undefined;
    return typeof value === "string" ? value.replace(AGREEMENT_SUFFIX, "").replace(/\d+ ?ms\b/g, "#ms") : value;
  };
  const visualOf = (run: ScenarioRun) => run.traces[0]?.visual;
  const cutVisual = (run: ScenarioRun) => !visualOf(run) || ["budget-exhausted", "no-reference"].includes(visualOf(run)!.reason);
  let n2Only: ScenarioRun | undefined;
  let n2Plus: ScenarioRun | undefined;
  let n2PlusAgreement: (LocatorRecoveryVisualAgreement | null) | undefined;
  for (let attempt = 1; attempt <= BUDGET_ATTEMPTS; attempt += 1) {
    const alone = await agreeing(undefined);
    n2Only = await scenario("drift", { seed: alone.fusion, recover: alone.fusion }, { blueprint: true });
    const both = await agreeing("shadow");
    n2Plus = await scenario("drift", { seed: both.fusion, recover: both.fusion }, { blueprint: true, afterRecover: () => Promise.all(both.pending) });
    await Promise.all(both.pending);
    n2PlusAgreement = n2Plus.agreements.find(Boolean) ?? null;
    if (!cutVisual(n2Only) && !cutVisual(n2Plus)) break;
    if (attempt < BUDGET_ATTEMPTS) budgetRetries += 1;
  }
  check(
    "both runs recovered via the blueprint and carry a real N2 visual block (non-vacuous)",
    !!n2Only && !!n2Plus && n2Only.isTarget && n2Plus.isTarget && !cutVisual(n2Only) && !cutVisual(n2Plus),
    JSON.stringify({ alone: n2Only && visualOf(n2Only), plus: n2Plus && visualOf(n2Plus) })
  );
  check("N2 plus agreement carries an agreement block; the N2 stage alone carries none", !!n2PlusAgreement && !!n2Only && n2Only.agreements.every((block) => block === null), JSON.stringify(n2PlusAgreement));
  check(
    "events, traces including the N2 visual block, and winner memory identical apart from the agreement block and its log suffix",
    !!n2Only &&
      !!n2Plus &&
      JSON.stringify([n2Only.traces, n2Only.messages], keepVisual) === JSON.stringify([n2Plus.traces, n2Plus.messages], keepVisual) &&
      sameRun(n2Only, n2Plus),
    n2Only && n2Plus ? `${JSON.stringify(visualOf(n2Only))} vs ${JSON.stringify(visualOf(n2Plus))}` : "missing run"
  );
}

try {
  await main();
} catch (error) {
  failed += 1;
  console.error(`  ✗ the suite threw — ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
} finally {
  await browser?.close().catch(() => undefined);
  await rm(ROOT, { recursive: true, force: true }).catch(() => undefined);
}

// Non-vacuity: every case above must have run.
const FLOOR = 50;
check(`at least ${FLOOR} checks ran`, passed + failed >= FLOOR + 1, `${passed + failed}`);
console.log(`\n${passed} passed, ${failed} failed (${budgetRetries} run(s) cut by the ${VISUAL_OBSERVATION_BUDGET_MS} ms budget and repeated)`);
process.exit(failed === 0 ? 0 : 1);
