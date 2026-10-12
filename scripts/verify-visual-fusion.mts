/**
 * verify:visual-fusion — Phase N, N2.2 (awkit-vra.12.2): the pure veto-only fusion policy `decideFusion`.
 *
 * No browser, no page, no files. Fingerprints are computed by the real `fingerprintVisualImage` over synthetic images,
 * so every visual score is a real `compareVisualFingerprints` score; the policy margins are then DERIVED from those
 * measured scores so each `>=` boundary is exercised at exactly the margin and one basis point past it.
 *
 * One suite covers:
 *   - an exhaustive decision table over R1-R8, the invalid-input rows and every `VisualErrorCode`, with the leading
 *     competitor at index 0, 1 and 2;
 *   - I1 (no identification): every verdict's keys and evidence keys are on an allow-list, scores are rounded to
 *     basis points, and no fingerprint digest leaks;
 *   - I2 (monotone safety): a seeded property run over generated inputs, where the actions taken with fusion must be a
 *     subset of those taken without it, a veto needs enforce-veto + eligible + contradicted + a calibrated, enabled
 *     policy, and every other verdict has effect none;
 *   - I7 (determinism): every call is repeated and the whole property run is replayed from the same seed;
 *   - cardinality floors on the table, the row coverage and the property run, so it cannot pass by checking nothing.
 *
 * The same suite is then run against mutants, each of which must make it FAIL:
 *   - a policy that always corroborates;
 *   - R8 disabled (a veto is never produced);
 *   - an unavailable input that vetoes instead of degrading to dom-only;
 *   - corroboration that lets a candidate act (an "act" effect);
 *   - an absolute-score veto (a low winner score vetoes regardless of the competitors);
 *   - competitor comparison capped at the first competitor (the `.first()` trap);
 *   - veto in shadow mode;
 *   - an empty case set, a case set one short of its floor, and an empty property run.
 *
 * Run: npm run verify:visual-fusion
 */

import type { VisualErrorCode } from "@src/visual/errors";
import { fingerprintVisualImage, type VisualFingerprint } from "@src/visual/fingerprint";
import {
  FUSION_MAX_COMPETITORS,
  UNCALIBRATED_FUSION_POLICY,
  decideFusion,
  type FusionEvidenceInput,
  type FusionInput,
  type FusionPolicy,
  type FusionUnavailable,
  type FusionVerdict
} from "@src/visual/fusion/decideFusion";
import { VisualImage } from "@src/visual/png";
import { compareVisualFingerprints } from "@src/visual/compare";
import type { VisualEvidence } from "@src/visual/visualEvidence";

/** Hardcoded floors. Raising the case count is fine; dropping below these fails the suite. */
const TABLE_FLOOR = 80;
const PROPERTY_RUNS = 4000;
const ROWS = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "invalid", "uncalibrated"] as const;

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

type Decider = (input: FusionInput, policy: FusionPolicy) => FusionVerdict;
type Row = (typeof ROWS)[number];
interface Expectation {
  outcome: FusionVerdict["outcome"];
  reason: FusionVerdict["reason"];
  effect: FusionVerdict["effect"];
}
interface Case {
  row: Row;
  name: string;
  input: FusionInput;
  policy: FusionPolicy;
  expect: Expectation;
}
interface Outcome {
  label: string;
  ok: boolean;
  detail?: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Synthetic evidence

const W = 64;
const H = 32;

function paint(fn: (x: number, y: number) => number): VisualImage {
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = Math.max(0, Math.min(255, Math.round(fn(x, y))));
      const i = (y * W + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return new VisualImage(W, H, data);
}

const inBox = (x: number, y: number, bx: number, by: number, bw: number, bh: number): boolean => x >= bx && x < bx + bw && y >= by && y < by + bh;

function fingerprint(image: VisualImage): VisualFingerprint {
  const result = fingerprintVisualImage(image);
  if (!result.ok) throw new Error(`synthetic fingerprint failed: ${result.code}`);
  return result.value;
}

const FP = {
  ref: fingerprint(paint((x, y) => (inBox(x, y, 8, 8, 16, 16) ? 20 : 60 + 2 * x))),
  refCopy: fingerprint(paint((x, y) => (inBox(x, y, 8, 8, 16, 16) ? 20 : 60 + 2 * x))),
  near: fingerprint(paint((x, y) => (inBox(x, y, 9, 8, 16, 16) ? 24 : 60 + 2 * x))),
  mid: fingerprint(paint((x, y) => (inBox(x, y, 30, 6, 16, 18) ? 20 : 60 + 2 * x))),
  far: fingerprint(paint((x, y) => (inBox(x, y, 40, 4, 20, 24) ? 230 : 200 - 4 * y))),
  farTwin: fingerprint(paint((x, y) => (inBox(x, y, 40, 4, 20, 24) ? 230 : 200 - 4 * y)))
};

function scoreBp(a: VisualFingerprint, b: VisualFingerprint): number {
  const result = compareVisualFingerprints(a, b);
  if (!result.ok) throw new Error(`synthetic compare failed: ${result.code}`);
  return Math.round(result.value.score * 10000);
}

const S = { near: scoreBp(FP.ref, FP.near), mid: scoreBp(FP.ref, FP.mid), far: scoreBp(FP.ref, FP.far), identical: scoreBp(FP.ref, FP.refCopy) };
const GAP = S.near - S.far;

interface EvidenceOptions {
  dpr?: number;
  vw?: number;
  vh?: number;
  depth?: number;
  w?: number;
  h?: number;
  kind?: "element" | "viewport";
  noBounds?: boolean;
}

function evidence(fp: VisualFingerprint, o: EvidenceOptions = {}): VisualEvidence {
  const dpr = o.dpr ?? 1;
  const vw = o.vw ?? 1280;
  const vh = o.vh ?? 720;
  const rect = { x: 10, y: 10, width: o.w ?? W, height: o.h ?? H };
  const viewport = { cssWidth: vw, cssHeight: vh, devicePixelRatio: dpr, scaleX: dpr, scaleY: dpr, imageWidth: Math.round(vw * dpr), imageHeight: Math.round(vh * dpr) };
  if (o.kind === "viewport") return { version: 1, kind: "viewport", capturedAt: "2026-10-12T00:00:00.000Z", viewport, fingerprint: fp };
  const ev: VisualEvidence = {
    version: 1,
    kind: "element",
    capturedAt: "2026-10-12T00:00:00.000Z",
    viewport,
    frame: { isMainFrame: (o.depth ?? 0) === 0, depth: o.depth ?? 0 },
    bounds: {
      requested: { ...rect },
      actual: { x: rect.x * dpr, y: rect.y * dpr, width: rect.width * dpr, height: rect.height * dpr },
      actualCss: { ...rect },
      wasClipped: false
    },
    fingerprint: fp
  };
  if (o.noBounds) delete ev.bounds;
  return ev;
}

const E = {
  ref: evidence(FP.ref),
  refCopy: evidence(FP.refCopy),
  near: evidence(FP.near),
  mid: evidence(FP.mid),
  far: evidence(FP.far),
  farTwin: evidence(FP.farTwin)
};

const un = (code: VisualErrorCode): FusionUnavailable => ({ available: false, code });

const POLICY: FusionPolicy = {
  calibrated: true,
  corroborateMarginBp: GAP,
  contradictMarginBp: GAP,
  domDecisiveMarginBp: 500,
  minSizeRatioBp: 5000,
  contradictionEnabled: true
};

function mk(winner: FusionEvidenceInput, competitors: FusionEvidenceInput[], over: Partial<FusionInput> = {}, domMargin = 0.01): FusionInput {
  return {
    mode: "enforce-veto",
    eligibility: "eligible",
    dom: { layer: "local", winner: { score: 0.82 }, competitors: competitors.map(() => ({ score: 0.81 })), margin: domMargin },
    reference: E.ref,
    winner,
    competitors,
    ...over
  };
}

const NONE = (outcome: Expectation["outcome"], reason: Expectation["reason"]): Expectation => ({ outcome, reason, effect: "none" });
const VETO: Expectation = { outcome: "contradicted", reason: "visual-contradiction", effect: "veto" };

/** The canonical contradiction: far winner, the leading look-alike at index 2, a non-decisive DOM margin. */
const vetoInput = (over: Partial<FusionInput> = {}, margin = 0.01): FusionInput => mk(E.far, [E.mid, E.farTwin, E.near], over, margin);

function buildCases(): Case[] {
  const cases: Case[] = [];
  const add = (row: Row, name: string, input: FusionInput, expect: Expectation, policy: FusionPolicy = POLICY): void => {
    cases.push({ row, name, input, policy, expect });
  };

  // R1
  add("R1", "mode off on an otherwise vetoing input", vetoInput({ mode: "off" }), NONE("unchecked", "fusion-off"));
  add("R1", "an unknown mode is off", vetoInput({ mode: "on" as never }), NONE("unchecked", "fusion-off"));
  add("R1", "an ineligible step", vetoInput({ eligibility: "ineligible" }), NONE("unchecked", "step-ineligible"));
  add("R1", "an unknown eligibility is ineligible", vetoInput({ eligibility: "yes" as never }), NONE("unchecked", "step-ineligible"));
  add("R1", "no reference", vetoInput({ reference: null }), NONE("unchecked", "no-reference"));

  // R2 — every error code, as the reference of an input that would otherwise veto.
  const codeReasons: Array<[VisualErrorCode, Expectation["reason"]]> = [
    ["CAPTURE_UNAVAILABLE", "capture-failed"],
    ["INVALID_BOUNDS", "capture-failed"],
    ["TARGET_OFFSCREEN", "target-offscreen"],
    ["TARGET_STALE", "target-stale"],
    ["TARGET_NOT_UNIQUE", "capture-failed"],
    ["FRAME_MAPPING_FAILED", "frame-mapping-failed"],
    ["PROTECTED_SURFACE", "protected-surface"],
    ["IMAGE_DECODE_FAILED", "capture-failed"],
    ["FINGERPRINT_FAILED", "capture-failed"],
    ["UNSUPPORTED_FINGERPRINT_VERSION", "version-mismatch"],
    ["PAGE_CLOSED", "target-stale"],
    ["BUDGET_EXHAUSTED", "budget-exhausted"],
    ["CANCELLED", "cancelled"]
  ];
  for (const [code, reason] of codeReasons) add("R2", `reference unavailable: ${code}`, vetoInput({ reference: un(code) }), NONE("dom-only", reason));
  add("R2", "winner unavailable (protected)", mk(un("PROTECTED_SURFACE"), [E.mid, E.farTwin, E.near]), NONE("dom-only", "protected-surface"));
  add("R2", "winner unavailable (offscreen)", mk(un("TARGET_OFFSCREEN"), [E.near]), NONE("dom-only", "target-offscreen"));
  add("R2", "competitor 2 unavailable (budget) beside a leading look-alike", mk(E.far, [E.near, E.mid, un("BUDGET_EXHAUSTED")]), NONE("dom-only", "budget-exhausted"));
  add("R2", "competitor 1 unavailable (stale)", mk(E.far, [E.near, un("TARGET_STALE")]), NONE("dom-only", "target-stale"));
  add("R2", "winner fingerprint of another version", mk(evidence({ ...FP.far, version: "awkit-vfp-0" as never }), [E.near]), NONE("dom-only", "version-mismatch"));
  add("R2", "reference fingerprint of another version", vetoInput({ reference: evidence({ ...FP.ref, version: "awkit-vfp-0" as never }) }), NONE("dom-only", "version-mismatch"));
  add("R2", "competitor 2 fingerprint malformed", mk(E.far, [E.mid, E.farTwin, evidence({ ...FP.near, grid: "AAAA" })]), NONE("dom-only", "capture-failed"));

  // invalid input
  const mismatched = vetoInput();
  mismatched.dom = { ...mismatched.dom, competitors: mismatched.dom.competitors.slice(0, 2) };
  add("invalid", "DOM competitor count differs from the captured count", mismatched, NONE("dom-only", "invalid-input"));
  add("invalid", `more than ${FUSION_MAX_COMPETITORS} competitors`, mk(E.far, [E.mid, E.farTwin, E.mid, E.near]), NONE("dom-only", "invalid-input"));
  add("invalid", "a viewport-kind winner", mk(evidence(FP.far, { kind: "viewport" }), [E.near]), NONE("dom-only", "invalid-input"));
  add("invalid", "a reference with no bounds", vetoInput({ reference: evidence(FP.ref, { noBounds: true }) }), NONE("dom-only", "invalid-input"));
  add("invalid", "a zero-area competitor", mk(E.far, [evidence(FP.near, { w: 0 })]), NONE("dom-only", "invalid-input"));
  add("invalid", "DOM margin NaN", vetoInput({}, Number.NaN), NONE("dom-only", "invalid-input"));
  const overScore = vetoInput();
  overScore.dom = { ...overScore.dom, winner: { score: 1.5 } };
  add("invalid", "DOM winner score 1.5", overScore, NONE("dom-only", "invalid-input"));
  const negScore = vetoInput();
  negScore.dom = { ...negScore.dom, competitors: [{ score: 0.5 }, { score: -0.1 }, { score: 0.5 }] };
  add("invalid", "a negative DOM competitor score", negScore, NONE("dom-only", "invalid-input"));
  add("invalid", "a null competitor", mk(E.far, [E.near, null as never]), NONE("dom-only", "invalid-input"));
  add("invalid", "competitors not an array", vetoInput({ competitors: "x" as never }), NONE("dom-only", "invalid-input"));
  add("invalid", "a negative policy margin", vetoInput(), NONE("dom-only", "invalid-input"), { ...POLICY, corroborateMarginBp: -1 });
  add("invalid", "a fractional policy margin", vetoInput(), NONE("dom-only", "invalid-input"), { ...POLICY, contradictMarginBp: GAP + 0.5 });
  add("invalid", "a calibrated policy with a zero contradiction margin", vetoInput(), NONE("dom-only", "invalid-input"), { ...POLICY, contradictMarginBp: 0 });
  add("invalid", "a calibrated policy with a zero corroboration margin", mk(E.near, [E.near]), NONE("dom-only", "invalid-input"), { ...POLICY, corroborateMarginBp: 0 });

  // R3 — derived from the evidence, never from the caller.
  add("R3", "winner at DPR 2 against a DPR 1 reference", mk(evidence(FP.far, { dpr: 2 }), [E.mid, E.farTwin, E.near]), NONE("dom-only", "conditions-changed"));
  add("R3", "competitor 2 at DPR 1.25", mk(E.far, [E.mid, E.farTwin, evidence(FP.near, { dpr: 1.25 })]), NONE("dom-only", "conditions-changed"));
  add("R3", "winner viewport one CSS px taller", mk(evidence(FP.far, { vh: 721 }), [E.near]), NONE("dom-only", "conditions-changed"));
  add("R3", "competitor 1 one frame deeper", mk(E.far, [E.mid, evidence(FP.near, { depth: 1 })]), NONE("dom-only", "conditions-changed"));
  add("R3", "reference in a frame, winner in the main frame", vetoInput({ reference: evidence(FP.ref, { depth: 1 }) }), NONE("dom-only", "conditions-changed"));
  add("R3", "identical winner but a changed viewport is still conditions-changed", mk(evidence(FP.refCopy, { vw: 1366 }), []), NONE("dom-only", "conditions-changed"));

  // R4
  add("R4", "identical winner, a look-alike competitor", mk(E.refCopy, [E.near]), NONE("corroborated", "identical"));
  add("R4", "identical winner under the uncalibrated policy", mk(E.refCopy, [E.near]), NONE("corroborated", "identical"), UNCALIBRATED_FUSION_POLICY);
  add("R4", "identical winner with no competitors (R4 precedes R5)", mk(E.refCopy, []), NONE("corroborated", "identical"));

  // R5
  add("R5", "a near winner with no competitors", mk(E.near, []), NONE("dom-only", "no-competitors"));
  add("R5", "a far winner with no competitors is not a veto", mk(E.far, []), NONE("dom-only", "no-competitors"));
  add("R5", "no competitors under the uncalibrated policy", mk(E.far, []), NONE("dom-only", "no-competitors"), UNCALIBRATED_FUSION_POLICY);

  // uncalibrated — FD-9: nothing past R5 until N2.3 sets the margins.
  add("uncalibrated", "the canonical contradiction under the uncalibrated policy", vetoInput(), NONE("dom-only", "uncalibrated"), UNCALIBRATED_FUSION_POLICY);
  add("uncalibrated", "a clear visual leader under the uncalibrated policy", mk(E.near, [E.far]), NONE("dom-only", "uncalibrated"), UNCALIBRATED_FUSION_POLICY);

  // R6
  add("R6", "winner leads by exactly the corroboration margin", mk(E.near, [E.far]), NONE("corroborated", "visual-leader"));
  add("R6", "winner leads two competitors", mk(E.near, [E.far, E.farTwin]), NONE("corroborated", "visual-leader"));
  add("R6", "one basis point short of the corroboration margin", mk(E.near, [E.far]), NONE("contested", "mixed"), { ...POLICY, corroborateMarginBp: GAP + 1 });
  add("R6", "corroboration in shadow mode has no effect either", mk(E.near, [E.far], { mode: "shadow" }), NONE("corroborated", "visual-leader"));
  add("R6", "a lead over competitor 0 does not hide a closer competitor 2", mk(E.near, [E.far, E.farTwin, E.mid]), NONE("contested", "mixed"));

  // R7
  add("R7", "near winner, mid competitor", mk(E.near, [E.mid]), NONE("contested", "mixed"));
  add("R7", "mid winner, near competitor below the contradiction margin", mk(E.mid, [E.near]), NONE("contested", "mixed"));
  add("R7", "page-wide restyle: winner and competitor equally far", mk(E.far, [E.farTwin]), NONE("contested", "mixed"));
  add("R7", "page-wide restyle with the pair swapped", mk(E.farTwin, [E.far]), NONE("contested", "mixed"));
  add("R7", "far winner, mid and far competitors",mk(E.far, [E.mid, E.farTwin]), NONE("contested", "mixed"));
  add("R7", "contradiction disabled by FD-9", vetoInput(), NONE("contested", "mixed"), { ...POLICY, contradictionEnabled: false });
  add("R7", "one basis point short of the contradiction margin", vetoInput(), NONE("contested", "mixed"), { ...POLICY, contradictMarginBp: GAP + 1 });
  add("R7", "a DOM margin exactly at the decisive margin", vetoInput({}, 0.05), NONE("contested", "dom-decisive"));
  add("R7", "a decisive DOM margin", vetoInput({}, 0.9), NONE("contested", "dom-decisive"));
  add("R7", "a winner whose size ratio is below bounds", mk(evidence(FP.far, { w: 31 }), [E.mid, E.farTwin, E.near]), NONE("contested", "size-out-of-bounds"));
  add("R7", "a leading competitor whose size ratio is below bounds", mk(E.far, [E.mid, E.farTwin, evidence(FP.near, { w: 31 })]), NONE("contested", "size-out-of-bounds"));
  add("R7", "a leading competitor twice the reference size", mk(E.far, [evidence(FP.near, { w: 129 })]), NONE("contested", "size-out-of-bounds"));

  // R8
  add("R8", "leading look-alike at index 2", vetoInput(), VETO);
  add("R8", "leading look-alike at index 1", mk(E.far, [E.mid, E.near, E.farTwin]), VETO);
  add("R8", "leading look-alike at index 0", mk(E.far, [E.near]), VETO);
  add("R8", "one basis point under the decisive DOM margin", vetoInput({}, 0.0499), VETO);
  add("R8", "a zero DOM margin", vetoInput({}, 0), VETO);
  add("R8", "a winner exactly at the size-ratio bound", mk(evidence(FP.far, { w: 32 }), [E.mid, E.farTwin, E.near]), VETO);
  add("R8", "a small NON-leading competitor does not block the veto", mk(E.far, [evidence(FP.mid, { w: 8, h: 8 }), E.near]), VETO);
  add("R8", "provider-agreed layer", (() => {
    const input = vetoInput();
    input.dom = { ...input.dom, layer: "provider-agreed" };
    return input;
  })(), VETO);
  add("R8", "shadow mode reports the contradiction without effect", vetoInput({ mode: "shadow" }), NONE("contradicted", "visual-contradiction"));
  add("R8", "a shadow-only step reports the contradiction without effect", vetoInput({ eligibility: "shadow-only" }), NONE("contradicted", "visual-contradiction"));

  return cases;
}

// ---------------------------------------------------------------------------------------------------------------
// The suite

const VERDICT_KEYS = new Set(["version", "outcome", "effect", "reason", "evidence"]);
const EVIDENCE_KEYS = new Set(["winnerScore", "bestCompetitorScore", "visualMargin", "identical"]);
const EFFECTS = new Set(["none", "veto"]);
const OUTCOMES = ["unchecked", "dom-only", "corroborated", "contested", "contradicted"] as const;

/** I1 and I9: nothing in a verdict can name an element, and scores are rounded basis points. */
function shapeProblem(verdict: FusionVerdict): string | null {
  for (const key of Object.keys(verdict)) if (!VERDICT_KEYS.has(key)) return `unexpected verdict key "${key}"`;
  if (verdict.version !== 1) return "version is not 1";
  if (!EFFECTS.has(verdict.effect)) return `effect "${String(verdict.effect)}"`;
  if (verdict.effect === "veto" && verdict.outcome !== "contradicted") return "a veto outside R8";
  for (const [key, value] of Object.entries(verdict.evidence ?? {})) {
    if (!EVIDENCE_KEYS.has(key)) return `unexpected evidence key "${key}"`;
    if (typeof value === "number" && (!Number.isFinite(value) || Math.abs(Math.round(value * 10000) - value * 10000) > 1e-6)) return `evidence ${key}=${value} is not a rounded score`;
  }
  if (/sha256:|selector|locator|"x"|"y"/.test(JSON.stringify(verdict))) return "the verdict leaks identifying content";
  return null;
}

/** The consumer contract the property assumes: a veto removes the action, "none" leaves the DOM decision, anything else is treated as executing. */
const acts = (domActs: boolean, verdict: { effect: string }): boolean => (verdict.effect === "veto" ? false : verdict.effect === "none" ? domActs : true);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CODES: VisualErrorCode[] = ["CAPTURE_UNAVAILABLE", "TARGET_OFFSCREEN", "TARGET_STALE", "FRAME_MAPPING_FAILED", "PROTECTED_SURFACE", "BUDGET_EXHAUSTED", "CANCELLED", "UNSUPPORTED_FINGERPRINT_VERSION"];

function generate(random: () => number): { input: FusionInput; policy: FusionPolicy } {
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  const fps = [FP.refCopy, FP.near, FP.mid, FP.far, FP.farTwin, FP.near, FP.far];
  const candidate = (): FusionEvidenceInput => {
    if (random() < 0.06) return un(pick(CODES));
    return evidence(pick(fps), { dpr: random() < 0.04 ? 2 : 1, w: random() < 0.08 ? pick([8, 31, 32, 129]) : W });
  };
  const competitors = Array.from({ length: Math.floor(random() * (FUSION_MAX_COMPETITORS + 1)) }, candidate);
  const input: FusionInput = {
    mode: pick(["off", "shadow", "enforce-veto", "enforce-veto", "enforce-veto"] as const),
    eligibility: pick(["eligible", "eligible", "eligible", "shadow-only", "ineligible"] as const),
    dom: {
      layer: pick(["local", "blueprint", "provider-agreed"] as const),
      winner: { score: Math.round(random() * 10000) / 10000 },
      competitors: competitors.map(() => ({ score: Math.round(random() * 10000) / 10000 })),
      margin: pick([0, 0.01, 0.0499, 0.05, 0.2, Math.round(random() * 10000) / 10000])
    },
    reference: random() < 0.06 ? null : random() < 0.06 ? un(pick(CODES)) : E.ref,
    winner: candidate(),
    competitors
  };
  const policy = pick([POLICY, POLICY, POLICY, { ...POLICY, contradictMarginBp: Math.max(1, GAP - 200) }, { ...POLICY, contradictionEnabled: false }, UNCALIBRATED_FUSION_POLICY]);
  return { input, policy };
}

function evaluateSuite(decide: Decider, cases: Case[], propertyRuns: number): Outcome[] {
  const outcomes: Outcome[] = [];
  const record = (label: string, ok: boolean, detail?: string): void => {
    outcomes.push({ label, ok, detail });
  };

  // Cardinality first, so an empty or short case set fails by name.
  record(`the decision table holds at least ${TABLE_FLOOR} cases`, cases.length >= TABLE_FLOOR, `${cases.length} cases`);
  const rowsSeen = new Set(cases.map((c) => c.row));
  record("the decision table covers every row R1-R8, invalid input and uncalibrated", ROWS.every((row) => rowsSeen.has(row)), `missing: ${ROWS.filter((row) => !rowsSeen.has(row)).join(", ")}`);
  record("the decision table contains at least three vetoing cases", cases.filter((c) => c.expect.effect === "veto").length >= 3);

  // The exhaustive table, with I1 and I7 on every case.
  for (const c of cases) {
    const before = JSON.stringify(c.input);
    let verdict: FusionVerdict;
    try {
      verdict = decide(c.input, c.policy);
    } catch (error) {
      record(`[${c.row}] ${c.name}`, false, `threw ${String(error)}`);
      continue;
    }
    const got = `${verdict.outcome}/${verdict.reason}/${verdict.effect}`;
    const want = `${c.expect.outcome}/${c.expect.reason}/${c.expect.effect}`;
    record(`[${c.row}] ${c.name} → ${want}`, got === want, `got ${got}`);
    const problem = shapeProblem(verdict);
    record(`[${c.row}] ${c.name}: verdict shape (I1, I9)`, problem === null, problem ?? undefined);
    const again = decide(structuredClone(c.input), structuredClone(c.policy));
    record(`[${c.row}] ${c.name}: deterministic, input untouched (I7)`, JSON.stringify(again) === JSON.stringify(verdict) && JSON.stringify(c.input) === before);
  }

  // Evidence of the canonical contradiction is the measured scores, rounded.
  const canonical = decide(vetoInput(), POLICY);
  record(
    "the canonical contradiction reports the measured scores",
    canonical.evidence.winnerScore === S.far / 10000 && canonical.evidence.bestCompetitorScore === S.near / 10000 && canonical.evidence.visualMargin === (S.far - S.near) / 10000 && canonical.evidence.identical === false,
    JSON.stringify(canonical.evidence)
  );

  // Competitor order must not change the verdict.
  const orders: FusionEvidenceInput[][] = [
    [E.mid, E.farTwin, E.near],
    [E.near, E.mid, E.farTwin],
    [E.farTwin, E.near, E.mid]
  ];
  const ordered = orders.map((competitors) => JSON.stringify(decide(mk(E.far, competitors), POLICY)));
  record("the verdict does not depend on competitor order", ordered.every((v) => v === ordered[0]), ordered.join(" | "));

  // I2 property run, replayed for I7.
  const run = (): { log: string[]; counts: Record<string, number>; vetoes: number; violations: string[] } => {
    const random = mulberry32(0x5eed2);
    const log: string[] = [];
    const counts: Record<string, number> = {};
    const violations: string[] = [];
    let vetoes = 0;
    for (let i = 0; i < propertyRuns; i++) {
      const { input, policy } = generate(random);
      let verdict: FusionVerdict;
      try {
        verdict = decide(input, policy);
      } catch (error) {
        violations.push(`#${i} threw ${String(error)}`);
        continue;
      }
      log.push(JSON.stringify(verdict));
      counts[verdict.outcome] = (counts[verdict.outcome] ?? 0) + 1;
      if (verdict.effect === "veto") vetoes += 1;
      const problem = shapeProblem(verdict);
      if (problem) violations.push(`#${i} ${problem}`);
      for (const domActs of [true, false]) {
        if (acts(domActs, verdict) && !domActs) violations.push(`#${i} acted where the DOM refused (${verdict.outcome}/${verdict.effect})`);
      }
      if (verdict.effect === "veto" && !(input.mode === "enforce-veto" && input.eligibility === "eligible" && policy.calibrated && policy.contradictionEnabled)) {
        violations.push(`#${i} vetoed with mode=${input.mode} eligibility=${input.eligibility} calibrated=${policy.calibrated} enabled=${policy.contradictionEnabled}`);
      }
      if (input.mode === "off" && verdict.outcome !== "unchecked") violations.push(`#${i} mode off gave ${verdict.outcome}`);
    }
    return { log, counts, vetoes, violations };
  };
  const first = run();
  const second = run();
  record(`the property run generated exactly ${PROPERTY_RUNS} verdicts`, first.log.length === PROPERTY_RUNS && propertyRuns === PROPERTY_RUNS, `${first.log.length} verdicts`);
  record("I2: with fusion, actions are a subset of those without it; vetoes need enforce-veto + eligible + calibrated + enabled", first.violations.length === 0, `${first.violations.length} violations, first: ${first.violations.slice(0, 3).join("; ")}`);
  record("the property run produced every outcome", OUTCOMES.every((o) => (first.counts[o] ?? 0) > 0), JSON.stringify(first.counts));
  record("the property run produced vetoes (non-vacuous I2)", first.vetoes > 0, `${first.vetoes} vetoes`);
  record("I7: the property run replays identically from its seed", first.log.length > 0 && first.log.join("\n") === second.log.join("\n"));

  return outcomes;
}

// ---------------------------------------------------------------------------------------------------------------
// Main

console.log("verify:visual-fusion — pure veto-only fusion policy (N2.2)\n");
console.log(`  measured scores against the reference (bp): identical ${S.identical}, near ${S.near}, mid ${S.mid}, far ${S.far}; derived margin ${GAP}\n`);

// Preconditions the derived policy depends on: assert them before the checks they gate.
check("precondition: only the pixel-identical copy scores 10000", S.identical === 10000 && S.near < 10000);
check("precondition: synthetic scores are strictly ordered near > mid > far", S.near > S.mid && S.mid > S.far, JSON.stringify(S));
check("precondition: the mid gap is below the derived margin on both sides", S.near - S.mid < GAP && S.mid - S.far < GAP);

const cases = buildCases();
for (const outcome of evaluateSuite(decideFusion, cases, PROPERTY_RUNS)) check(outcome.label, outcome.ok, outcome.detail);

console.log("\n  mutants (each must FAIL the suite)");
const UNAVAILABLE = new Set(["protected-surface", "budget-exhausted", "cancelled", "target-stale", "target-offscreen", "frame-mapping-failed", "version-mismatch", "capture-failed"]);
const alwaysCorroborated: Decider = () => ({ version: 1, outcome: "corroborated", effect: "none", reason: "visual-leader", evidence: {} });
const r8Disabled: Decider = (input, policy) => {
  const v = decideFusion(input, policy);
  return v.outcome === "contradicted" ? { ...v, outcome: "contested", reason: "mixed", effect: "none" } : v;
};
const unavailableVetoes: Decider = (input, policy) => {
  const v = decideFusion(input, policy);
  return v.outcome === "dom-only" && UNAVAILABLE.has(v.reason) ? { ...v, outcome: "contradicted", effect: "veto" } : v;
};
const corroborationActs: Decider = (input, policy) => {
  const v = decideFusion(input, policy);
  return v.outcome === "corroborated" ? { ...v, effect: "act" as never } : v;
};
const absoluteVeto: Decider = (input, policy) => {
  const v = decideFusion(input, policy);
  return v.evidence.winnerScore !== undefined && v.evidence.winnerScore < S.mid / 10000 && input.mode === "enforce-veto"
    ? { ...v, outcome: "contradicted", reason: "visual-contradiction", effect: "veto" }
    : v;
};
const firstCompetitorOnly: Decider = (input, policy) =>
  decideFusion({ ...input, competitors: input.competitors.slice(0, 1), dom: { ...input.dom, competitors: input.dom.competitors.slice(0, 1) } }, policy);
const shadowVetoes: Decider = (input, policy) => {
  const v = decideFusion(input, policy);
  return v.outcome === "contradicted" ? { ...v, effect: "veto" } : v;
};

// The optional third entry names the check that must be among the failures, so a floor mutant is caught by its floor.
const mutants: Array<[string, Outcome[], string?]> = [
  ["a policy that always corroborates", evaluateSuite(alwaysCorroborated, cases, PROPERTY_RUNS)],
  ["R8 disabled", evaluateSuite(r8Disabled, cases, PROPERTY_RUNS), "the property run produced vetoes"],
  ["an unavailable input that vetoes", evaluateSuite(unavailableVetoes, cases, PROPERTY_RUNS), "[R2]"],
  ["corroboration that lets a candidate act", evaluateSuite(corroborationActs, cases, PROPERTY_RUNS), "I2:"],
  ["an absolute-score veto", evaluateSuite(absoluteVeto, cases, PROPERTY_RUNS), "[R7] page-wide restyle"],
  ["competitor comparison capped at the first competitor", evaluateSuite(firstCompetitorOnly, cases, PROPERTY_RUNS), "[R8] leading look-alike at index 2"],
  ["a veto in shadow mode", evaluateSuite(shadowVetoes, cases, PROPERTY_RUNS), "I2:"],
  ["an empty case set", evaluateSuite(decideFusion, [], PROPERTY_RUNS), "the decision table holds"],
  ["a case set one short of the floor", evaluateSuite(decideFusion, cases.slice(0, TABLE_FLOOR - 1), PROPERTY_RUNS), "the decision table holds"],
  ["an empty property run", evaluateSuite(decideFusion, cases, 0), "the property run generated"]
];
for (const [name, outcomes, mustFail] of mutants) {
  const failing = outcomes.filter((o) => !o.ok).map((o) => o.label);
  const caughtBy = mustFail === undefined || failing.some((label) => label.startsWith(mustFail));
  check(`MUTATION: ${name} fails the suite (${failing.length} checks${mustFail ? `, including "${mustFail}"` : ""})`, failing.length > 0 && caughtBy, `the suite passed a mutant: ${failing.join("; ") || "nothing failed"}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
