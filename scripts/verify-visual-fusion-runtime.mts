/**
 * verify:visual-fusion-runtime — Phase N2 runtime: the runner-owned visual reference store (N2.4b, awkit-vra.12.4b).
 *
 * No browser. Every case runs the real `VisualReferenceStore` against a fresh temporary folder:
 *   - round trip, and a record never answers for another `scopeKey` (mutation contract item 7);
 *   - corruption never throws and reads as missing/corrupt (fusion R1): truncated JSON, garbage, null, an array, a
 *     foreign record copied to another step's file, a wrong record version, a digest that does not match the evidence,
 *     evidence of the wrong inner version, and an oversized file;
 *   - another evidence version reads as `version-mismatch` (fusion R2), never as found;
 *   - writes are bounded: oversized or digest-less evidence is refused and nothing is written;
 *   - rate limiting: at most one write per `refreshMs`, and only when the content digest changed;
 *   - atomic replacement: transient EPERM/EBUSY renames are retried, a persistent or non-transient failure is reported
 *     (not thrown), the previous record is untouched and no temp file is left;
 *   - concurrent instances on one folder: distinct steps never cross, one step from two instances writes once, a burst
 *     of writes to one step leaves a whole record and no temp files;
 *   - the refresh table stays bounded, and an unwritable folder fails without throwing.
 *
 * N2.5 (awkit-vra.12.5), on real Chromium: the shadow `VisualFusionStage` injected into a real `LocatorFactory`.
 *   - I3 A/B: seed, break, recover with fusion off and with the stage on — recovered element, events, traces (timings
 *     excluded) and winner memory are identical, for an eligible, an ineligible and a sensitive step, and with a
 *     throwing verdict sink or a rejecting/throwing fusion option;
 *   - the observation carries the local winner and up to three distinct gated-out competitors; one verdict per
 *     recovery, R1 `no-reference` before a reference exists, a visual verdict after a passing resolve seeded one;
 *   - I9: the verdict record is eight fields with rounded scores and no digest, bounds or pixels;
 *   - ineligible steps get no verdict and sensitive steps never refresh; effect is always none.
 *
 * N2.7 (awkit-vra.12.7): the verdict reaches the `recovery-trace` as its `visual` block — absent with fusion off, for
 * ineligible steps and for a failing observer, the A/B otherwise identical — and `toRecoveryProvenance` keeps a
 * sanitized copy (codes or `invalid`, effect none or veto, integer ms, 3-decimal unit scores) the report's
 * SecretMasker leaves intact and that names no element, URL, digest or pixels.
 *
 * Run: npm run verify:visual-fusion-runtime
 */

import { mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { chromium, type Browser, type Page } from "playwright";
import { VISUAL_EVIDENCE_MAX_BYTES, VISUAL_EVIDENCE_VERSION, type VisualEvidence } from "@src/visual/visualEvidence";
import { MEASURED_FUSION_POLICY } from "@src/visual/fusion/decideFusion";
import type { FlowStep } from "@src/profiles/FlowProfile";
import {
  LocatorFactory,
  type LocatorRecoveryEvent,
  type LocatorRecoveryTrace,
  type LocatorRecoveryVisual,
  type LocatorVisualFusion,
  type LocatorVisualRecoveryObservation
} from "@src/runner/LocatorFactory";
import { toRecoveryProvenance } from "@src/runner/domIntelligence/recoveryProvenance";
import { SecretMasker } from "@src/reports/SecretMasker";
import { FileLocatorRecoveryStore } from "@src/runner/LocatorRecoveryStore";
import { VisualFusionStage, visualFusionEligibility, type VisualFusionVerdictRecord } from "@src/runner/visualFusion/VisualFusionStage";
import {
  VISUAL_REFERENCE_REFRESH_ENTRIES,
  VisualReferenceStore,
  visualReferenceRefreshEntries,
  type VisualReferenceStoreOptions
} from "@src/runner/visualFusion/VisualReferenceStore";

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

const ROOT = await mkdtemp(join(tmpdir(), "awkit-visual-references-"));
let folders = 0;
const freshFolder = (): string => join(ROOT, `store-${++folders}`);
const fileFor = (folder: string, scopeKey: string): string => join(folder, `${createHash("sha256").update(scopeKey).digest("hex")}.json`);

function evidence(seed: string, extra: Partial<VisualEvidence> = {}): VisualEvidence {
  return {
    version: VISUAL_EVIDENCE_VERSION,
    kind: "element",
    capturedAt: "2026-10-13T00:00:00.000Z",
    viewport: { cssWidth: 1280, cssHeight: 720, devicePixelRatio: 1 },
    frame: { depth: 0 },
    bounds: {
      requested: { x: 10, y: 20, width: 120, height: 32 },
      actual: { x: 10, y: 20, width: 120, height: 32 },
      actualCss: { x: 10, y: 20, width: 120, height: 32 },
      wasClipped: false
    },
    fingerprint: {
      version: 1,
      contentDigest: `sha256:${createHash("sha256").update(seed).digest("hex")}`,
      width: 120,
      height: 32
    },
    ...extra
  } as unknown as VisualEvidence;
}

const digestOf = (value: unknown): string | null => (value as VisualEvidence | null)?.fingerprint?.contentDigest ?? null;

function store(folder: string, extra: Partial<VisualReferenceStoreOptions> = {}): VisualReferenceStore {
  return new VisualReferenceStore({
    folder,
    evidenceVersion: VISUAL_EVIDENCE_VERSION,
    maxEvidenceBytes: VISUAL_EVIDENCE_MAX_BYTES,
    digestOf,
    ...extra
  });
}

/** A clock the cases advance by hand. */
function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let at = start;
  return { now: () => at, advance: (ms) => (at += ms) };
}

const tempFiles = async (folder: string): Promise<string[]> => (await readdir(folder).catch(() => [] as string[])).filter((n) => n.endsWith(".tmp"));
const jsonFiles = async (folder: string): Promise<string[]> => (await readdir(folder).catch(() => [] as string[])).filter((n) => n.endsWith(".json"));

// ── N2.5: the shadow stage inside a real LocatorFactory on real Chromium ──────────────────────────────────────────
let browser: Browser | undefined;

const LAB = `<!doctype html><html><body style="font:16px sans-serif;margin:24px;background:#fff">
<main><section id="profile"><h2>Profile</h2><div class="actions" style="display:flex;gap:12px">
<button id="save-profile" type="button" style="background:#1d4ed8;color:#fff;border:0;padding:8px 16px">Save profile</button>
<button id="cancel-profile" type="button" style="background:#e5e7eb;border:0;padding:8px 16px">Cancel</button>
<button id="reset-profile" type="button" style="background:#fde68a;border:0;padding:8px 16px">Reset form</button>
<button id="export-profile" type="button" style="background:#bbf7d0;border:0;padding:8px 16px">Export</button>
</div></section></main></body></html>`;

/**
 * Timestamps and durations differ between any two runs, also inside trace messages; everything else must not. N2.7: the
 * trace's `visual` block exists only with fusion on, so the A/B compares without it and `visuals` is asserted on its own.
 */
const stable = (key: string, value: unknown): unknown => {
  if (/(^ms|Ms|At)$/.test(key) || key === "visual") return undefined;
  return typeof value === "string" ? value.replace(/\d+ ?ms\b/g, "#ms") : value;
};

interface ScenarioRun {
  seeded: boolean;
  recovered: boolean;
  isTarget: boolean;
  resolvedText: string | null;
  events: string;
  memory: string;
  /** N2.7: each recovery trace's `visual` block, in order (`null` when the trace had none); excluded from the A/B. */
  visuals: (LocatorRecoveryVisual | null)[];
}

/**
 * Seed winner memory with one passing resolve, rename the target's id so every saved candidate misses, resolve again.
 * `seed` / `recover` are the visual-fusion options of the two factories; absent is fusion off.
 */
async function scenario(
  type: string,
  fusion: { seed?: LocatorVisualFusion; recover?: LocatorVisualFusion } = {},
  extra: Partial<FlowStep> = {}
): Promise<ScenarioRun> {
  const page: Page = await browser!.newPage({ viewport: { width: 800, height: 600 } });
  try {
    await page.setContent(LAB);
    const folder = await mkdtemp(join(ROOT, "recovery-"));
    const recoveryStore = new FileLocatorRecoveryStore(folder);
    const events: LocatorRecoveryEvent[] = [];
    const step = { id: "save-profile", name: "Save profile", type, locator: { strategy: "css", value: "#save-profile" }, ...extra } as unknown as FlowStep;
    const factory = (visualFusion?: LocatorVisualFusion) =>
      new LocatorFactory(page, {
        recoveryStore,
        scope: { scenarioId: "n2-5", flowId: "shadow" },
        recoveryGraceMs: 0,
        onRecoveryEvent: (event) => events.push(event),
        ...(visualFusion ? { visualFusion } : {})
      });
    await page.evaluate(() => {
      (window as unknown as { __target: Element }).__target = document.getElementById("save-profile")!;
    });
    const seeded = await factory(fusion.seed)
      .resolve(step)
      .then((locator) => locator.evaluate((element) => element === (window as unknown as { __target: Element }).__target))
      .catch(() => false);
    await page.evaluate(() => {
      document.getElementById("save-profile")!.id = "profile-save";
    });
    let isTarget = false;
    let resolvedText: string | null = null;
    try {
      const locator = await factory(fusion.recover).resolve(step);
      isTarget = await locator.evaluate((element) => element === (window as unknown as { __target: Element }).__target);
      resolvedText = await locator.textContent();
    } catch {
      resolvedText = null;
    }
    const memory = await Promise.all((await jsonFiles(folder)).sort().map(async (name) => JSON.parse(await readFile(join(folder, name), "utf8")) as unknown));
    return {
      seeded,
      recovered: events.some((event) => event.type === "local-recovery"),
      isTarget,
      resolvedText,
      events: JSON.stringify(events, stable),
      memory: JSON.stringify(memory, stable),
      visuals: events.filter((event) => event.type === "recovery-trace").map((event) => event.trace?.visual ?? null)
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

class CountingStore extends VisualReferenceStore {
  refreshes = 0;
  override async refresh(...args: Parameters<VisualReferenceStore["refresh"]>): ReturnType<VisualReferenceStore["refresh"]> {
    this.refreshes += 1;
    return super.refresh(...args);
  }
}

interface Shadow {
  fusion: LocatorVisualFusion;
  folder: string;
  store: CountingStore;
  verdicts: VisualFusionVerdictRecord[];
  observed: LocatorVisualRecoveryObservation[];
  competitorTexts: (string | null)[][];
  passes: number;
}

/** A real VisualFusionStage on its own folder, wrapped to record what LocatorFactory handed it. */
async function shadow(onVerdict?: (record: VisualFusionVerdictRecord) => void): Promise<Shadow> {
  const folder = await mkdtemp(join(ROOT, "visual-"));
  const s = new CountingStore({ folder, evidenceVersion: VISUAL_EVIDENCE_VERSION, maxEvidenceBytes: VISUAL_EVIDENCE_MAX_BYTES, digestOf });
  const out: Shadow = { fusion: undefined as unknown as LocatorVisualFusion, folder, store: s, verdicts: [], observed: [], competitorTexts: [], passes: 0 };
  const stage = new VisualFusionStage({
    folder,
    store: s,
    onVerdict: (record) => {
      out.verdicts.push(record);
      onVerdict?.(record);
    }
  });
  out.fusion = {
    observeRecovery: async (observation) => {
      out.observed.push(observation);
      out.competitorTexts.push(await Promise.all(observation.competitors.map((c) => c.locator.textContent().catch(() => null))));
      return stage.observeRecovery(observation);
    },
    observePass: async (observation) => {
      out.passes += 1;
      await stage.observePass(observation);
    }
  };
  return out;
}

const sameRun = (a: ScenarioRun, b: ScenarioRun): boolean => JSON.stringify({ ...a, visuals: undefined }) === JSON.stringify({ ...b, visuals: undefined });
const threeDecimals = (value: unknown): boolean => typeof value === "number" && Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-9;

async function shadowStageCases(): Promise<void> {
  browser = await chromium.launch();

  console.log("\nN2.5 I3: shadow fusion leaves the resolve byte-identical to fusion off (A/B):\n");
  const off = await scenario("click");
  check("the off run seeds, then recovers the renamed target locally (non-vacuous)", off.seeded && off.recovered && off.isTarget && off.resolvedText === "Save profile", JSON.stringify(off).slice(0, 300));
  const a = await shadow();
  const on = await scenario("click", { seed: a.fusion, recover: a.fusion });
  check("shadow run: same seed, same recovered element, same text", on.seeded && on.recovered && on.isTarget && on.resolvedText === off.resolvedText);
  check("shadow run: identical recovery events and traces (timings excluded)", on.events === off.events, `${on.events.slice(0, 200)} vs ${off.events.slice(0, 200)}`);
  check("shadow run: identical winner memory", on.memory === off.memory);
  check("the A/B pair is identical as a whole", sameRun(on, off));
  check("the stage saw the passing resolve and exactly one recovery", a.passes >= 1 && a.observed.length === 1, `${a.passes} passes, ${a.observed.length} recoveries`);

  console.log("\nN2.5: the recovery observation and its verdict:\n");
  const [observation] = a.observed;
  check("the observation is the local layer's winner with its DOM score and margin", observation?.layer === "local" && observation.score > 0 && observation.margin >= 0, JSON.stringify({ layer: observation?.layer, score: observation?.score, margin: observation?.margin }));
  const texts = a.competitorTexts[0] ?? [];
  check(
    "up to three gated-out DOM competitors, each a distinct element other than the winner",
    texts.length === 3 && new Set(texts).size === 3 && !texts.includes("Save profile") && texts.every((t) => t !== null),
    JSON.stringify(texts)
  );
  const [verdict] = a.verdicts;
  check("exactly one verdict, shadow mode, local layer, eligible", a.verdicts.length === 1 && verdict.mode === "shadow" && verdict.layer === "local" && verdict.eligibility === "eligible", JSON.stringify(a.verdicts));
  check("the passing resolve seeded the reference, so the verdict is not R1 no-reference", verdict?.reason !== "no-reference", `${verdict?.outcome} (${verdict?.reason})`);
  check("the verdict is a visual comparison against the reference", verdict?.outcome === "corroborated" || verdict?.outcome === "dom-only" || verdict?.outcome === "contradicted", `${verdict?.outcome} (${verdict?.reason})`);
  check("effect is none (shadow, contradiction disabled)", verdict?.effect === "none");
  const evidenceKeys = Object.keys(verdict?.evidence ?? {});
  check(
    "I9: evidence is the four allowed fields only, scores rounded to 3 decimals",
    evidenceKeys.length > 0 &&
      evidenceKeys.every((k) => ["winnerScore", "bestCompetitorScore", "visualMargin", "identical"].includes(k)) &&
      ["winnerScore", "bestCompetitorScore", "visualMargin"].every((k) => !(k in verdict.evidence) || threeDecimals((verdict.evidence as Record<string, unknown>)[k])),
    JSON.stringify(verdict?.evidence)
  );
  check(
    "I9: the record has exactly its eight fields and no digest, bounds, pixels or selector",
    JSON.stringify(Object.keys(verdict ?? {}).sort()) === JSON.stringify(["effect", "eligibility", "evidence", "layer", "mode", "outcome", "reason", "stepId"]) &&
      !/sha256|digest|bounds|base64|#save-profile|"x":/i.test(JSON.stringify(verdict)),
    JSON.stringify(verdict)
  );
  const referenceFiles = await jsonFiles(a.folder);
  const referenceText = referenceFiles.length === 1 ? await readFile(join(a.folder, referenceFiles[0]), "utf8") : "";
  check("one reference record for the one step, holding no image bytes", referenceFiles.length === 1 && !/data:image|base64|"bytes"/.test(referenceText), referenceFiles.join(", "));
  check("the reference is keyed by the step's scopeKey", referenceFiles[0] === `${createHash("sha256").update(observation?.scopeKey ?? "").digest("hex")}.json`);

  console.log("\nN2.5: R1 without a reference, then a refresh:\n");
  const b = await shadow();
  const noRef = await scenario("click", { recover: b.fusion });
  check("recovery with fusion only on the recovering factory is still identical to off", sameRun(noRef, off));
  check("no reference yet: the verdict is R1 no-reference", b.verdicts.length === 1 && b.verdicts[0].reason === "no-reference", JSON.stringify(b.verdicts));
  check("...and the eligible winner then becomes the reference", (await jsonFiles(b.folder)).length === 1 && b.store.refreshes === 1, `${b.store.refreshes} refreshes`);

  console.log("\nN2.5: ineligible and sensitive steps:\n");
  check("FD-6 eligibility table", visualFusionEligibility({ type: "click" }, false) === "eligible" && visualFusionEligibility({ type: "fill" }, false) === "eligible" && visualFusionEligibility({ type: "click" }, true) === "shadow-only" && visualFusionEligibility({ type: "hover" }, false) === "ineligible");
  const hoverOff = await scenario("hover");
  const c = await shadow();
  const hoverOn = await scenario("hover", { seed: c.fusion, recover: c.fusion });
  check("an ineligible step recovers (non-vacuous) and its A/B pair is identical", hoverOff.recovered && hoverOff.isTarget && sameRun(hoverOn, hoverOff));
  check("an ineligible step is observed but gets no verdict, no capture and no reference", c.observed.length === 1 && c.verdicts.length === 0 && c.store.refreshes === 0 && (await jsonFiles(c.folder)).length === 0, `${c.observed.length} observed, ${c.verdicts.length} verdicts, ${c.store.refreshes} refreshes`);
  const sensitive = { safety: { sideEffectLevel: "dangerousMutation", retryable: false } } as unknown as Partial<FlowStep>;
  const sensitiveOff = await scenario("click", {}, sensitive);
  const d = await shadow();
  const sensitiveOn = await scenario("click", { seed: d.fusion, recover: d.fusion }, sensitive);
  check("a sensitive step seeds, never recovers, and its A/B pair is identical", sensitiveOff.seeded && !sensitiveOff.recovered && sensitiveOff.resolvedText === null && sameRun(sensitiveOn, sensitiveOff));
  check("a sensitive pass is observed but never refreshes the reference (shadow-only)", d.passes >= 1 && d.store.refreshes === 0 && (await jsonFiles(d.folder)).length === 0, `${d.passes} passes, ${d.store.refreshes} refreshes`);

  console.log("\nN2.5: a failing observer cannot change the resolve:\n");
  const e = await shadow(() => {
    throw new Error("sink exploded");
  });
  const throwingSink = await scenario("click", { seed: e.fusion, recover: e.fusion });
  check("a throwing verdict sink: the verdict was produced, the resolve is identical to off", e.verdicts.length === 1 && sameRun(throwingSink, off));
  check("...and the reference refresh still ran after the sink threw", e.store.refreshes >= 1);
  const broken: LocatorVisualFusion = {
    observeRecovery: async () => {
      throw new Error("observer rejected");
    },
    observePass: () => {
      throw new Error("observer threw synchronously");
    }
  };
  const brokenRun = await scenario("click", { seed: broken, recover: broken });
  check("a rejecting / synchronously throwing fusion option: the resolve is identical to off", sameRun(brokenRun, off));

  console.log("\nN2.5 shadow-only invariants:\n");
  check("MEASURED_FUSION_POLICY.contradictionEnabled is still false", MEASURED_FUSION_POLICY.contradictionEnabled === false);
  check("the stage's mode is fixed to shadow", new VisualFusionStage({ folder: ROOT }).mode === "shadow");
  const all = [a, b, c, d, e].flatMap((x) => x.verdicts);
  check("no verdict of any case had an effect", all.length >= 3 && all.every((v) => v.effect === "none"), String(all.length));

  console.log("\nN2.7: the recovery trace carries the shadow verdict as its `visual` block:\n");
  check("fusion off: one recovery trace, and it has no visual block", off.visuals.length === 1 && off.visuals[0] === null, JSON.stringify(off.visuals));
  const [visual] = on.visuals;
  check("fusion on: one recovery trace, and it has a visual block", on.visuals.length === 1 && visual !== null, JSON.stringify(on.visuals));
  check(
    "the block is the allowlisted fields only",
    visual !== null && Object.keys(visual).every((k) => ["mode", "outcome", "reason", "effect", "ms", "winnerScore", "competitorScore"].includes(k)),
    JSON.stringify(visual)
  );
  check("it is the stage's verdict: shadow mode, same outcome, reason and effect none", visual?.mode === "shadow" && visual.outcome === verdict?.outcome && visual.reason === verdict?.reason && visual.effect === "none", JSON.stringify(visual));
  check(
    "its scores are the verdict's rounded scores, under the trace's names",
    visual?.winnerScore === verdict?.evidence.winnerScore && visual?.competitorScore === verdict?.evidence.bestCompetitorScore && (visual?.winnerScore === undefined || threeDecimals(visual.winnerScore)),
    `${JSON.stringify(visual)} vs ${JSON.stringify(verdict?.evidence)}`
  );
  check("its observation time is a finite, non-negative number", typeof visual?.ms === "number" && Number.isFinite(visual.ms) && visual.ms >= 0);
  check("before a reference exists the block says R1 no-reference", noRef.visuals.length === 1 && noRef.visuals[0]?.reason === "no-reference", JSON.stringify(noRef.visuals));
  check("an ineligible step's trace has no visual block", hoverOn.visuals.length === 1 && hoverOn.visuals[0] === null, JSON.stringify(hoverOn.visuals));
  check("a sensitive step never recovers, so it has no trace to carry one", sensitiveOn.visuals.length === 0, JSON.stringify(sensitiveOn.visuals));
  check("a throwing verdict sink still yields the block (the sink is a recorder)", throwingSink.visuals.length === 1 && throwingSink.visuals[0]?.mode === "shadow", JSON.stringify(throwingSink.visuals));
  check("a rejecting observer yields no block, and the run is otherwise identical", brokenRun.visuals.length === 1 && brokenRun.visuals[0] === null, JSON.stringify(brokenRun.visuals));
  const verdictOnly: LocatorVisualFusion = {
    observeRecovery: async () => ({ mode: "shadow", outcome: "corroborated", reason: "visual-leader", effect: "none", evidence: { winnerScore: 0.9, bestCompetitorScore: 0.2 } }),
    observePass: async () => undefined
  };
  const injected = await scenario("click", { recover: verdictOnly });
  check(
    "the factory copies only the codes and scores it is given (no evidence object, no extra fields)",
    JSON.stringify({ ...injected.visuals[0], ms: 0 }) === JSON.stringify({ mode: "shadow", outcome: "corroborated", reason: "visual-leader", effect: "none", ms: 0, winnerScore: 0.9, competitorScore: 0.2 }),
    JSON.stringify(injected.visuals)
  );
  check("...and the injected verdict changes nothing else", sameRun(injected, off));

  console.log("\nN2.7: the report's provenance record keeps a sanitized copy:\n");
  const trace = (extra: Partial<LocatorRecoveryTrace>): LocatorRecoveryTrace =>
    ({
      engine: "snapshot",
      result: "recovered",
      totalMs: 12.4,
      stages: [{ stage: "local", outcome: "proven", ms: 3.2, candidates: 4, score: 0.9 }],
      context: { page: "main", frame: "main", frameDepth: 0, route: "match" },
      candidatesTried: 1,
      ...extra
    }) as LocatorRecoveryTrace;
  const plain = toRecoveryProvenance(trace({}));
  check("a trace without a block gives a record without the key (fusion-off reports unchanged)", !("visual" in plain) && plain.schemaVersion === 1);
  const real = toRecoveryProvenance(trace({ visual: visual ?? undefined })).visual;
  check(
    "the real block survives intact, ms rounded to an integer",
    real !== undefined && real.outcome === visual?.outcome && real.reason === visual?.reason && real.effect === "none" && Number.isInteger(real.ms) && real.winnerScore === visual?.winnerScore,
    JSON.stringify(real)
  );
  const forged = toRecoveryProvenance(
    trace({ visual: { mode: "shadow", outcome: "<img src=x onerror=alert(1)>", reason: "https://example.test/?token=abc", effect: "veto-all" as "none", ms: 12.6789, winnerScore: 0.123456, competitorScore: 7 } })
  ).visual;
  check(
    "forged codes become invalid, an unknown effect becomes none, scores are rounded or dropped",
    JSON.stringify(forged) === JSON.stringify({ mode: "shadow", outcome: "invalid", reason: "invalid", effect: "none", ms: 13, winnerScore: 0.123 }),
    JSON.stringify(forged)
  );
  check("a non-shadow block is dropped", !("visual" in toRecoveryProvenance(trace({ visual: { ...(visual as LocatorRecoveryVisual), mode: "enforce" as "shadow" } }))));
  check("an unresolved record never carries a block", !("visual" in toRecoveryProvenance(trace({ result: "unresolved", visual: visual ?? undefined }))));
  const logged = { locatorRecovery: toRecoveryProvenance(trace({ visual: visual ?? undefined })) };
  check("the report's SecretMasker leaves the block intact (no field read as a secret)", JSON.stringify(new SecretMasker().maskRecord(logged)) === JSON.stringify(logged), JSON.stringify(logged));
  const recordText = JSON.stringify(logged);
  check("I9: the record names no element, URL, digest or pixels", !/save-profile|profile-save|http|sha256|digest|base64|bounds|[0-9a-f]{16}/i.test(recordText), recordText);
}

try {
  console.log("\nRound trip and scope binding:\n");
  {
    const folder = freshFolder();
    const s = store(folder, { now: clock().now });
    check("an unknown step reads as missing", (await s.get("scenario:a|step:1")).status === "missing");
    const written = await s.refresh("scenario:a|step:1", evidence("one"));
    check("a first refresh writes", written.status === "written", JSON.stringify(written));
    const read = await s.get("scenario:a|step:1");
    check(
      "the record reads back as found, evidence and digest intact",
      read.status === "found" && JSON.stringify(read.evidence) === JSON.stringify(evidence("one")) && read.contentDigest === digestOf(evidence("one")),
      JSON.stringify(read).slice(0, 200)
    );
    check("another step does not read this step's record", (await s.get("scenario:a|step:2")).status === "missing");
    await s.refresh("scenario:a|step:2", evidence("two"));
    const second = await s.get("scenario:a|step:2");
    const first = await s.get("scenario:a|step:1");
    check(
      "two steps keep their own evidence",
      second.status === "found" && first.status === "found" && second.contentDigest !== first.contentDigest && second.contentDigest === digestOf(evidence("two"))
    );
    // Mutation contract item 7: a record placed under another step's file name must not answer for that step.
    await writeFile(fileFor(folder, "scenario:a|step:3"), await readFile(fileFor(folder, "scenario:a|step:1"), "utf8"), "utf8");
    check("a record copied under another step's name reads as corrupt, never as found", (await s.get("scenario:a|step:3")).status === "corrupt");
    const stored = await readFile(fileFor(folder, "scenario:a|step:1"), "utf8");
    check(
      "the stored file is bounded and carries no image data",
      stored.length <= VISUAL_EVIDENCE_MAX_BYTES + 2048 && !/data:image|base64|"image"|"bytes"/.test(stored),
      `${stored.length} bytes`
    );
  }

  console.log("\nCorruption reads as R1 and never throws:\n");
  {
    const folder = freshFolder();
    const s = store(folder, { now: clock().now });
    await s.refresh("k", evidence("base"));
    const valid = JSON.parse(await readFile(fileFor(folder, "k"), "utf8")) as Record<string, unknown>;
    const cases: Array<[string, string, string]> = [
      ["truncated JSON", JSON.stringify(valid).slice(0, 40), "corrupt"],
      ["garbage bytes", "\u0000\u0001not json at all", "corrupt"],
      ["empty file", "", "corrupt"],
      ["JSON null", "null", "corrupt"],
      ["a JSON array", "[1,2,3]", "corrupt"],
      ["a wrong record version", JSON.stringify({ ...valid, version: 2 }), "corrupt"],
      ["a malformed digest", JSON.stringify({ ...valid, contentDigest: "md5:abc" }), "corrupt"],
      ["a digest that does not match the evidence", JSON.stringify({ ...valid, contentDigest: digestOf(evidence("other")) }), "corrupt"],
      ["evidence of a different inner version", JSON.stringify({ ...valid, evidence: { ...(valid.evidence as object), version: 99 } }), "corrupt"],
      ["no evidence", JSON.stringify({ ...valid, evidence: null }), "corrupt"],
      ["a missing timestamp", JSON.stringify({ ...valid, updatedAt: undefined }), "corrupt"],
      ["an oversized file", JSON.stringify({ ...valid, pad: "x".repeat(VISUAL_EVIDENCE_MAX_BYTES + 4096) }), "corrupt"],
      [
        "oversized evidence inside a small-enough envelope",
        JSON.stringify({ ...valid, evidence: { ...(valid.evidence as object), pad: "x".repeat(VISUAL_EVIDENCE_MAX_BYTES - 200) } }),
        "corrupt"
      ],
      ["another evidence version", JSON.stringify({ ...valid, evidenceVersion: VISUAL_EVIDENCE_VERSION + 1 }), "version-mismatch"],
      [
        "a self-consistent record of another evidence version",
        JSON.stringify({ ...valid, evidenceVersion: VISUAL_EVIDENCE_VERSION + 1, evidence: { ...(valid.evidence as object), version: VISUAL_EVIDENCE_VERSION + 1 } }),
        "version-mismatch"
      ]
    ];
    let threw = 0;
    for (const [label, text, want] of cases) {
      await writeFile(fileFor(folder, "k"), text, "utf8");
      try {
        const read = await s.get("k");
        check(`${label} reads as ${want}`, read.status === want, read.status);
      } catch (error) {
        threw += 1;
        check(`${label} reads as ${want}`, false, `threw ${String(error)}`);
      }
    }
    check("the corruption table is non-vacuous", cases.length >= 14, String(cases.length));
    check("no corrupt record threw", threw === 0, String(threw));
    await writeFile(fileFor(folder, "k"), JSON.stringify({ ...valid, evidenceVersion: VISUAL_EVIDENCE_VERSION + 1 }), "utf8");
    const mismatch = await s.get("k");
    check("a version mismatch names the stored version", mismatch.status === "version-mismatch" && mismatch.evidenceVersion === VISUAL_EVIDENCE_VERSION + 1);
    await writeFile(fileFor(folder, "k"), "{", "utf8");
    const t = clock(5_000_000);
    const healed = await store(folder, { now: t.now }).refresh("k", evidence("healed"));
    const after = await s.get("k");
    check("a corrupt record is replaced by the next refresh", healed.status === "written" && after.status === "found" && after.contentDigest === digestOf(evidence("healed")));
  }

  console.log("\nWrites are bounded and validated:\n");
  {
    const folder = freshFolder();
    const s = store(folder, { now: clock().now });
    const oversized = await s.refresh("big", evidence("big", { pad: "x".repeat(VISUAL_EVIDENCE_MAX_BYTES) } as Partial<VisualEvidence>));
    check("oversized evidence is refused", oversized.status === "refused" && oversized.reason === "oversized", JSON.stringify(oversized));
    check("nothing is written for refused evidence", (await s.get("big")).status === "missing");
    const noDigest = await s.refresh("nodigest", { ...evidence("x"), fingerprint: { version: 1 } });
    check("evidence without a content digest is refused", noDigest.status === "refused" && noDigest.reason === "invalid", JSON.stringify(noDigest));
    const wrongVersion = await s.refresh("wrongversion", { ...evidence("x"), version: VISUAL_EVIDENCE_VERSION + 1 });
    check("evidence of another version is refused", wrongVersion.status === "refused" && wrongVersion.reason === "invalid", JSON.stringify(wrongVersion));
    for (const bad of [null, undefined, "evidence", 42]) {
      const result = await s.refresh("bad", bad);
      check(`non-object evidence (${String(bad)}) is refused`, result.status === "refused", JSON.stringify(result));
    }
    const throwing = store(folder, { now: clock().now, digestOf: () => { throw new Error("boom"); } });
    const thrown = await throwing.refresh("throwing", evidence("t"));
    check("a throwing digest reader refuses instead of throwing", thrown.status === "refused", JSON.stringify(thrown));
    check("refusals never touch the rate limit", s.dueForRefresh("big") && s.dueForRefresh("nodigest"));
  }

  console.log("\nRate limiting and digest change:\n");
  {
    const folder = freshFolder();
    const t = clock();
    const s = store(folder, { now: t.now, refreshMs: 60_000 });
    check("a fresh step is due", s.dueForRefresh("loop"));
    check("the first refresh writes", (await s.refresh("loop", evidence("v1"))).status === "written");
    check("the step is not due right after a write", !s.dueForRefresh("loop"));
    t.advance(59_999);
    const early = await s.refresh("loop", evidence("v2"));
    check("a changed reference inside the interval is rate-limited", early.status === "rate-limited", JSON.stringify(early));
    const kept = await s.get("loop");
    check("the rate-limited write left the old reference", kept.status === "found" && kept.contentDigest === digestOf(evidence("v1")));
    t.advance(1);
    check("the step is due again at exactly the interval", s.dueForRefresh("loop"));
    const same = await s.refresh("loop", evidence("v1"));
    check("an unchanged digest after the interval is not rewritten", same.status === "unchanged", JSON.stringify(same));
    t.advance(60_000);
    const changed = await s.refresh("loop", evidence("v2"));
    const now = await s.get("loop");
    check("a changed digest after the interval is written", changed.status === "written" && now.status === "found" && now.contentDigest === digestOf(evidence("v2")));
  }

  console.log("\nAtomic replacement with bounded EPERM/EBUSY retry:\n");
  {
    const folder = freshFolder();
    const t = clock();
    let attempts = 0;
    const retries: string[] = [];
    const flaky = store(folder, {
      now: t.now,
      refreshMs: 0,
      replace: {
        sleep: async () => undefined,
        onRetry: (_attempt, code) => retries.push(code),
        renameImpl: async (from, to) => {
          attempts += 1;
          if (attempts <= 2) throw Object.assign(new Error("held by a scanner"), { code: attempts === 1 ? "EPERM" : "EBUSY" });
          await rename(from, to);
        }
      }
    });
    const written = await flaky.refresh("retry", evidence("retry"));
    check("transient EPERM then EBUSY renames are retried and the write lands", written.status === "written" && attempts === 3, `${JSON.stringify(written)} after ${attempts}`);
    check("both transient codes were retried", retries.join(",") === "EPERM,EBUSY", retries.join(","));
    check("the retried record reads back", (await flaky.get("retry")).status === "found");

    let permanentAttempts = 0;
    const stuck = store(folder, {
      now: t.now,
      refreshMs: 0,
      replace: {
        attempts: 4,
        sleep: async () => undefined,
        renameImpl: async () => {
          permanentAttempts += 1;
          throw Object.assign(new Error("locked"), { code: "EPERM" });
        }
      }
    });
    const before = await readFile(fileFor(folder, "retry"), "utf8").catch(() => null);
    const failedWrite = await stuck.refresh("retry", evidence("never"));
    check("a persistent EPERM is reported, not thrown", failedWrite.status === "failed" && failedWrite.code === "EPERM", JSON.stringify(failedWrite));
    check("a persistent EPERM is retried a bounded number of times", permanentAttempts === 4, String(permanentAttempts));
    check("the previous record is untouched", before !== null && (await readFile(fileFor(folder, "retry"), "utf8").catch(() => null)) === before);
    check("no temp file is left behind", (await tempFiles(folder)).length === 0, (await tempFiles(folder)).join(", "));

    let accessAttempts = 0;
    const denied = store(folder, {
      now: t.now,
      refreshMs: 0,
      replace: {
        sleep: async () => undefined,
        renameImpl: async () => {
          accessAttempts += 1;
          throw Object.assign(new Error("denied"), { code: "EACCES" });
        }
      }
    });
    const deniedWrite = await denied.refresh("retry", evidence("denied"));
    check("a non-transient failure is not retried", deniedWrite.status === "failed" && deniedWrite.code === "EACCES" && accessAttempts === 1, `${JSON.stringify(deniedWrite)} after ${accessAttempts}`);
    check("still no temp file", (await tempFiles(folder)).length === 0);
  }

  console.log("\nConcurrent instances on one folder:\n");
  {
    const folder = freshFolder();
    const t = clock();
    const a = store(folder, { now: t.now });
    const b = store(folder, { now: t.now });
    const steps = Array.from({ length: 12 }, (_, i) => `scenario:c|step:${i}`);
    const results = await Promise.all(steps.map((key, i) => (i % 2 ? a : b).refresh(key, evidence(key))));
    check("distinct steps written from two instances all land", results.every((r) => r.status === "written"), JSON.stringify(results.map((r) => r.status)));
    const reads = await Promise.all(steps.map((key, i) => (i % 2 ? b : a).get(key)));
    check(
      "each step reads back its own evidence from the other instance",
      reads.every((r, i) => r.status === "found" && r.contentDigest === digestOf(evidence(steps[i])))
    );

    const race = await Promise.all([a.refresh("shared", evidence("from-a")), b.refresh("shared", evidence("from-b"))]);
    const statuses = race.map((r) => r.status).sort();
    check("one step refreshed by two instances at once writes exactly once", JSON.stringify(statuses) === JSON.stringify(["rate-limited", "written"]), JSON.stringify(statuses));
    const winner = await a.get("shared");
    check(
      "the shared record is the writer's whole evidence",
      winner.status === "found" && winner.contentDigest === digestOf(evidence(race[0].status === "written" ? "from-a" : "from-b"))
    );

    const burstA = store(folder, { now: t.now, refreshMs: 0 });
    const burstB = store(folder, { now: t.now, refreshMs: 0 });
    const burst = await Promise.all(Array.from({ length: 24 }, (_, i) => (i % 2 ? burstA : burstB).refresh("burst", evidence(`burst-${i}`))));
    check("a burst of 24 writes to one step never throws or fails", burst.every((r) => r.status === "written" || r.status === "unchanged"), JSON.stringify(burst.map((r) => r.status)));
    const last = await burstA.get("burst");
    const candidates = new Set(Array.from({ length: 24 }, (_, i) => digestOf(evidence(`burst-${i}`))));
    check("the burst leaves one whole record of one writer", last.status === "found" && candidates.has(last.contentDigest));
    check("the burst leaves no temp file", (await tempFiles(folder)).length === 0);
  }

  console.log("\nBounded refresh table and unwritable storage:\n");
  {
    const blocker = join(ROOT, "not-a-folder");
    await writeFile(blocker, "a file where the folder should be", "utf8");
    const t = clock();
    const s = store(join(blocker, "visual-references"), { now: t.now });
    const first = await s.refresh("unwritable", evidence("u"));
    check("an unwritable folder fails without throwing", first.status === "failed", JSON.stringify(first));
    check("an unreadable record location reads as missing or corrupt", ["missing", "corrupt"].includes((await s.get("unwritable")).status));
    const extra = 64;
    for (let i = 0; i < VISUAL_REFERENCE_REFRESH_ENTRIES + extra; i++) await s.refresh(`bound-${i}`, evidence("b"));
    check(
      "the refresh table never exceeds its cap",
      visualReferenceRefreshEntries() <= VISUAL_REFERENCE_REFRESH_ENTRIES && visualReferenceRefreshEntries() >= VISUAL_REFERENCE_REFRESH_ENTRIES - 1,
      String(visualReferenceRefreshEntries())
    );
    check("the oldest step was forgotten first and is due again", s.dueForRefresh("bound-0") && !s.dueForRefresh(`bound-${VISUAL_REFERENCE_REFRESH_ENTRIES + extra - 1}`));
  }

  await shadowStageCases();
} catch (error) {
  // A thrown case is a failure with its message, not a dump of the bundled source.
  check("the suite ran to completion", false, (error instanceof Error ? (error.stack ?? error.message) : String(error)).slice(0, 800));
} finally {
  await browser?.close().catch(() => undefined);
  await rm(ROOT, { recursive: true, force: true }).catch(() => undefined);
}

check("the suite is non-vacuous", passed >= 110, String(passed));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
