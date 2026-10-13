/**
 * verify:visual-agreement — Phase N, N3.1 (awkit-vra.4.1): the pure Visual Locator Recovery policy
 * `decideVisualAgreement`.
 *
 * No browser, no page, no files. Fingerprints are computed by the real `fingerprintVisualImage` over synthetic images,
 * so identity is the real `contentDigest` equality and every near miss is a real `compareVisualFingerprints` score.
 *
 * One suite covers:
 *   - an exhaustive decision table over A1-A9, the invalid-input rows and every `VisualErrorCode`, with the offending
 *     competitor at the first, a middle and the last index, and every DOM floor at exactly the bound and one basis
 *     point under it;
 *   - J1 (DOM-chosen only): the verdict has no key that could name an element, and competitor order never changes it;
 *   - J2-J4 as a seeded property run over generated inputs, checked against an INDEPENDENT oracle that reads
 *     `contentDigest` directly: `agreed` needs mode on, an eligible step, a `below-threshold` refusal, every DOM floor,
 *     a best pixel-identical to the reference, every competitor captured (at most 8) and none identical;
 *   - `proceed` exactly when `agreed` in enforce mode (shadow never proceeds);
 *   - determinism: every call is repeated on a clone and the whole property run is replayed from the same seed;
 *   - cardinality floors on the table, the row coverage, the property run and its `agreed` count.
 *
 * The same suite is then run against mutants, each of which must make it FAIL.
 *
 * Run: npm run verify:visual-agreement
 */

import type { VisualErrorCode } from "@src/visual/errors";
import { fingerprintVisualImage, type VisualFingerprint } from "@src/visual/fingerprint";
import {
  AGREEMENT_MAX_COMPETITORS,
  decideVisualAgreement,
  type VisualAgreementEvidenceInput,
  type VisualAgreementInput,
  type VisualAgreementUnavailable,
  type VisualAgreementVerdict
} from "@src/visual/fusion/decideVisualAgreement";
import { VisualImage } from "@src/visual/png";
import { compareVisualFingerprints } from "@src/visual/compare";
import type { VisualEvidence } from "@src/visual/visualEvidence";

/** Hardcoded floors. Raising the case count is fine; dropping below these fails the suite. */
const TABLE_FLOOR = 70;
const PROPERTY_RUNS = 5000;
const MIN_AGREED = 50;
const ROWS = ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "invalid"] as const;

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

type Decider = (input: VisualAgreementInput) => VisualAgreementVerdict;
type Row = (typeof ROWS)[number];
interface Expectation {
  outcome: VisualAgreementVerdict["outcome"];
  reason: VisualAgreementVerdict["reason"];
  effect: VisualAgreementVerdict["effect"];
}
interface Case {
  row: Row;
  name: string;
  input: VisualAgreementInput;
  expect: Expectation;
}
interface Outcome {
  label: string;
  ok: boolean;
  detail?: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Synthetic evidence

const W = 48;
const H = 40;

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

const icon = (x: number, y: number): number => (inBox(x, y, 14, 12, 18, 16) ? 20 : 60 + 2 * x);
const FP = {
  /** The remembered appearance, and two independent paints of the same pixels (the live best, an F3 twin). */
  ref: fingerprint(paint(icon)),
  same: fingerprint(paint(icon)),
  twin: fingerprint(paint(icon)),
  /** One pixel-column shift and a slightly lighter glyph: very similar, NOT identical. */
  near: fingerprint(paint((x, y) => (inBox(x, y, 15, 12, 18, 16) ? 24 : 60 + 2 * x))),
  mid: fingerprint(paint((x, y) => (inBox(x, y, 26, 6, 16, 18) ? 20 : 60 + 2 * x))),
  far: fingerprint(paint((x, y) => (inBox(x, y, 6, 4, 30, 30) ? 230 : 200 - 4 * y)))
};

function scoreBp(a: VisualFingerprint, b: VisualFingerprint): number {
  const result = compareVisualFingerprints(a, b);
  if (!result.ok) throw new Error(`synthetic compare failed: ${result.code}`);
  return Math.round(result.value.score * 10000);
}

const S = { same: scoreBp(FP.ref, FP.same), near: scoreBp(FP.ref, FP.near), mid: scoreBp(FP.ref, FP.mid), far: scoreBp(FP.ref, FP.far) };

interface EvidenceOptions {
  dpr?: number;
  vw?: number;
  vh?: number;
  depth?: number;
  w?: number;
  kind?: "element" | "viewport";
  noBounds?: boolean;
}

function evidence(fp: VisualFingerprint, o: EvidenceOptions = {}): VisualEvidence {
  const dpr = o.dpr ?? 1;
  const vw = o.vw ?? 1280;
  const vh = o.vh ?? 720;
  const rect = { x: 10, y: 10, width: o.w ?? W, height: H };
  const viewport = { cssWidth: vw, cssHeight: vh, devicePixelRatio: dpr, scaleX: dpr, scaleY: dpr, imageWidth: Math.round(vw * dpr), imageHeight: Math.round(vh * dpr) };
  if (o.kind === "viewport") return { version: 1, kind: "viewport", capturedAt: "2026-10-13T00:00:00.000Z", viewport, fingerprint: fp };
  const ev: VisualEvidence = {
    version: 1,
    kind: "element",
    capturedAt: "2026-10-13T00:00:00.000Z",
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
  same: evidence(FP.same),
  twin: evidence(FP.twin),
  near: evidence(FP.near),
  mid: evidence(FP.mid),
  far: evidence(FP.far)
};

const un = (code: VisualErrorCode): VisualAgreementUnavailable => ({ available: false, code });

interface DomOptions {
  refusal?: string;
  score?: number;
  ancestry?: number;
  margin?: number;
  count?: number;
}

function mk(best: VisualAgreementEvidenceInput, competitors: VisualAgreementEvidenceInput[], over: Partial<VisualAgreementInput> = {}, d: DomOptions = {}): VisualAgreementInput {
  return {
    mode: "enforce",
    eligibility: "eligible",
    dom: { refusal: d.refusal ?? "below-threshold", best: { score: d.score ?? 0.78, ancestry: d.ancestry ?? 0.9 }, margin: d.margin ?? 0.2, competitorCount: d.count ?? competitors.length },
    reference: E.ref,
    best,
    competitors,
    ...over
  };
}

const NONE = (outcome: Expectation["outcome"], reason: Expectation["reason"]): Expectation => ({ outcome, reason, effect: "none" });
const PROCEED: Expectation = { outcome: "agreed", reason: "identical-unique", effect: "proceed" };

/** The canonical agreement: an identical best and three dissimilar competitors. */
const agreeInput = (over: Partial<VisualAgreementInput> = {}, d: DomOptions = {}): VisualAgreementInput => mk(E.same, [E.near, E.mid, E.far], over, d);

function buildCases(): Case[] {
  const cases: Case[] = [];
  const add = (row: Row, name: string, input: VisualAgreementInput, expect: Expectation): void => {
    cases.push({ row, name, input, expect });
  };

  // A1
  add("A1", "mode off on an otherwise agreeing input", agreeInput({ mode: "off" }), NONE("not-eligible", "mode-off"));
  add("A1", "an unknown mode is off", agreeInput({ mode: "on" as never }), NONE("not-eligible", "mode-off"));
  add("A1", "an ineligible step (sensitive, protected or handed off)", agreeInput({ eligibility: "ineligible" }), NONE("not-eligible", "ineligible-step"));
  add("A1", "an unknown eligibility is ineligible", agreeInput({ eligibility: "shadow-only" as never }), NONE("not-eligible", "ineligible-step"));
  for (const refusal of ["ambiguous-margin", "ancestry-veto", "no-candidate", "snapshot-truncated", "snapshot-failed", "stale-snapshot", "blueprint-unavailable", ""]) {
    add("A1", `refusal "${refusal}" is never rescued`, agreeInput({}, { refusal }), NONE("not-eligible", "refusal-not-eligible"));
  }

  // A2 — each floor at the bound and one basis point under it.
  add("A2", "best score exactly 0.6 is eligible", agreeInput({}, { score: 0.6 }), PROCEED);
  add("A2", "best score 0.5999", agreeInput({}, { score: 0.5999 }), NONE("refused", "dom-floor"));
  add("A2", "best score 0", agreeInput({}, { score: 0 }), NONE("refused", "dom-floor"));
  add("A2", "ancestry exactly 0.5 is eligible", agreeInput({}, { ancestry: 0.5 }), PROCEED);
  add("A2", "ancestry 0.4999", agreeInput({}, { ancestry: 0.4999 }), NONE("refused", "dom-floor"));
  add("A2", "DOM margin exactly 0.08 is eligible", agreeInput({}, { margin: 0.08 }), PROCEED);
  add("A2", "DOM margin 0.0799", agreeInput({}, { margin: 0.0799 }), NONE("refused", "dom-floor"));
  add("A2", "a zero DOM margin (a DOM tie) is never rescued", agreeInput({}, { margin: 0 }), NONE("refused", "dom-floor"));
  add("A2", "the floor precedes a missing reference", agreeInput({ reference: null }, { margin: 0.01 }), NONE("refused", "dom-floor"));

  // A3
  add("A3", "no reference", agreeInput({ reference: null }), NONE("unavailable", "no-reference"));
  add("A3", "a corrupt reference (R1)", agreeInput({ reference: un("IMAGE_DECODE_FAILED") }), NONE("unavailable", "reference-invalid"));
  add("A3", "a reference of another version (R2)", agreeInput({ reference: un("UNSUPPORTED_FINGERPRINT_VERSION") }), NONE("unavailable", "reference-invalid"));
  add("A3", "a reference with no bounds", agreeInput({ reference: evidence(FP.ref, { noBounds: true }) }), NONE("unavailable", "reference-invalid"));
  add("A3", "a viewport-kind reference", agreeInput({ reference: evidence(FP.ref, { kind: "viewport" }) }), NONE("unavailable", "reference-invalid"));

  // A4 — every error code on the best, plus competitors at each position.
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
    ["CAPTURE_STALE", "capture-failed"],
    ["PAGE_CLOSED", "target-stale"],
    ["BUDGET_EXHAUSTED", "budget-exhausted"],
    ["CANCELLED", "cancelled"]
  ];
  for (const [code, reason] of codeReasons) add("A4", `best unavailable: ${code}`, mk(un(code), [E.near]), NONE("unavailable", reason));
  add("A4", "competitor 0 offscreen", mk(E.same, [un("TARGET_OFFSCREEN"), E.near, E.far]), NONE("unavailable", "target-offscreen"));
  add("A4", "competitor 1 budget-exhausted", mk(E.same, [E.near, un("BUDGET_EXHAUSTED"), E.far]), NONE("unavailable", "budget-exhausted"));
  add("A4", "the last competitor protected", mk(E.same, [E.near, E.mid, un("PROTECTED_SURFACE")]), NONE("unavailable", "protected-surface"));
  add("A4", "a best fingerprint of another version", mk(evidence({ ...FP.same, version: "awkit-vfp-0" as never }), [E.near]), NONE("unavailable", "version-mismatch"));
  add("A4", "a malformed competitor fingerprint", mk(E.same, [E.near, evidence({ ...FP.mid, grid: "AAAA" })]), NONE("unavailable", "capture-failed"));

  // invalid input
  add("invalid", "a NaN DOM margin", agreeInput({}, { margin: Number.NaN }), NONE("unavailable", "invalid-input"));
  add("invalid", "a DOM score of 1.5", agreeInput({}, { score: 1.5 }), NONE("unavailable", "invalid-input"));
  add("invalid", "a negative ancestry", agreeInput({}, { ancestry: -0.1 }), NONE("unavailable", "invalid-input"));
  add("invalid", "a fractional competitor count", agreeInput({}, { count: 2.5 }), NONE("unavailable", "invalid-input"));
  add("invalid", "more captures than DOM competitors", agreeInput({}, { count: 2 }), NONE("unavailable", "invalid-input"));
  add("invalid", "a null competitor", mk(E.same, [E.near, null as never]), NONE("unavailable", "invalid-input"));
  add("invalid", "competitors not an array", agreeInput({ competitors: "x" as never }), NONE("unavailable", "invalid-input"));
  add("invalid", "a missing best", agreeInput({ best: null as never }), NONE("unavailable", "invalid-input"));
  add("invalid", "a viewport-kind best", mk(evidence(FP.same, { kind: "viewport" }), [E.near]), NONE("unavailable", "invalid-input"));
  add("invalid", "a zero-area competitor", mk(E.same, [evidence(FP.near, { w: 0 })]), NONE("unavailable", "invalid-input"));

  // A5 — derived from the evidence, never from the caller.
  add("A5", "best at DPR 2 against a DPR 1 reference", mk(evidence(FP.same, { dpr: 2 }), [E.near]), NONE("unavailable", "conditions-changed"));
  add("A5", "the last competitor at DPR 1.25", mk(E.same, [E.near, E.mid, evidence(FP.far, { dpr: 1.25 })]), NONE("unavailable", "conditions-changed"));
  add("A5", "best viewport one CSS px wider", mk(evidence(FP.same, { vw: 1281 }), []), NONE("unavailable", "conditions-changed"));
  add("A5", "competitor 0 one frame deeper", mk(E.same, [evidence(FP.near, { depth: 1 }), E.far]), NONE("unavailable", "conditions-changed"));
  add("A5", "a reference in a frame, the best in the main frame", agreeInput({ reference: evidence(FP.ref, { depth: 1 }) }), NONE("unavailable", "conditions-changed"));

  // A6 — VR-4.
  add("A6", "one DOM competitor was not captured", agreeInput({}, { count: 4 }), NONE("refused", "competitors-uncaptured"));
  add("A6", "no captures for two DOM competitors", mk(E.same, [], {}, { count: 2 }), NONE("refused", "competitors-uncaptured"));
  const nine = Array.from({ length: AGREEMENT_MAX_COMPETITORS + 1 }, (_, i) => [E.near, E.mid, E.far][i % 3]);
  add("A6", `${AGREEMENT_MAX_COMPETITORS + 1} competitors, all captured, exceed VR-4`, mk(E.same, nine), NONE("refused", "competitors-uncaptured"));
  add("A6", "an uncaptured competitor refuses even with a non-identical best (A6 precedes A7)", mk(E.near, [E.far], {}, { count: 2 }), NONE("refused", "competitors-uncaptured"));

  // A7 — identity, never similarity.
  add("A7", "a very similar best is not identical", mk(E.near, [E.far]), NONE("refused", "not-identical"));
  add("A7", "a restyled best (far)", mk(E.far, [E.near]), NONE("refused", "not-identical"));
  add("A7", "F2 swap: the remembered icon is on a competitor, not the best", mk(E.mid, [E.same, E.far]), NONE("refused", "not-identical"));
  add("A7", "a similar best with no competitors", mk(E.near, []), NONE("refused", "not-identical"));

  // A8 — uniqueness, with the twin at each position.
  add("A8", "F3 twin at competitor 0", mk(E.same, [E.twin, E.near, E.far]), NONE("refused", "identical-competitor"));
  add("A8", "F3 twin at competitor 1", mk(E.same, [E.near, E.twin, E.far]), NONE("refused", "identical-competitor"));
  add("A8", "F3 twin at the last of eight competitors", mk(E.same, [E.near, E.mid, E.far, E.near, E.mid, E.far, E.near, E.twin]), NONE("refused", "identical-competitor"));
  add("A8", "a twin in shadow mode is still refused", mk(E.same, [E.twin], { mode: "shadow" }), NONE("refused", "identical-competitor"));

  // A9
  add("A9", "an identical best and three dissimilar competitors", agreeInput(), PROCEED);
  add("A9", "an identical best and no competitors", mk(E.same, []), PROCEED);
  add("A9", "an identical best and exactly eight dissimilar competitors", mk(E.same, [E.near, E.mid, E.far, E.near, E.mid, E.far, E.near, E.mid]), PROCEED);
  add("A9", "the reference object itself as the best", mk(E.ref, [E.near]), PROCEED);
  add("A9", "shadow mode reports agreement without effect", agreeInput({ mode: "shadow" }), NONE("agreed", "identical-unique"));
  add("A9", "a near-floor DOM decision still agrees", agreeInput({}, { score: 0.6, ancestry: 0.5, margin: 0.08 }), PROCEED);

  return cases;
}

// ---------------------------------------------------------------------------------------------------------------
// The suite

const VERDICT_KEYS = new Set(["version", "outcome", "effect", "reason"]);
const OUTCOMES = ["not-eligible", "unavailable", "refused", "agreed"] as const;

/** J1: nothing in a verdict can name an element. */
function shapeProblem(verdict: VisualAgreementVerdict): string | null {
  for (const key of Object.keys(verdict)) if (!VERDICT_KEYS.has(key)) return `unexpected verdict key "${key}"`;
  if (verdict.version !== 1) return "version is not 1";
  if (verdict.effect !== "none" && verdict.effect !== "proceed") return `effect "${String(verdict.effect)}"`;
  if (verdict.effect === "proceed" && verdict.outcome !== "agreed") return "proceed outside A9";
  if (/sha256:|selector|locator|index|"x"|"y"|\d/.test(JSON.stringify({ outcome: verdict.outcome, reason: verdict.reason, effect: verdict.effect }))) {
    return "the verdict leaks identifying content";
  }
  return null;
}

const available = (e: VisualAgreementEvidenceInput | null | undefined): e is VisualEvidence => !!e && (e as VisualAgreementUnavailable).available !== false;
const conditions = (e: VisualEvidence): string => `${e.viewport.devicePixelRatio}/${e.viewport.cssWidth}/${e.viewport.cssHeight}/${e.frame?.depth}`;

/**
 * The independent oracle for J2-J4. It reads `contentDigest` directly instead of calling the comparator, so a policy
 * that grants agreement on similarity cannot satisfy it by the same code path.
 */
function agreementViolation(input: VisualAgreementInput): string | null {
  if (input.mode !== "shadow" && input.mode !== "enforce") return "agreed with recovery off";
  if (input.eligibility !== "eligible") return "agreed on an ineligible step";
  if (input.dom.refusal !== "below-threshold") return `J2: agreed after "${input.dom.refusal}"`;
  const bp = (v: number): number => Math.round(v * 10000);
  if (bp(input.dom.best.score) < 6000 || bp(input.dom.best.ancestry) < 5000 || bp(input.dom.margin) < 800) return "J2: agreed under a DOM floor";
  if (!available(input.reference) || !available(input.best)) return "agreed without a reference or a captured best";
  if (input.best.fingerprint.contentDigest !== input.reference.fingerprint.contentDigest) return "J3: agreed on a best that is not pixel-identical";
  if (!input.competitors.every(available)) return "J4: agreed with an unavailable competitor";
  if (input.competitors.length !== input.dom.competitorCount || input.competitors.length > AGREEMENT_MAX_COMPETITORS) return "J4: agreed with an uncaptured competitor";
  const ref = input.reference.fingerprint.contentDigest;
  const best = input.best.fingerprint.contentDigest;
  for (const c of input.competitors as VisualEvidence[]) {
    if (c.fingerprint.contentDigest === ref || c.fingerprint.contentDigest === best) return "J4: agreed with an identical competitor";
  }
  const want = conditions(input.reference);
  if (conditions(input.best) !== want || !(input.competitors as VisualEvidence[]).every((c) => conditions(c) === want)) return "agreed across changed conditions";
  return null;
}

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
const REFUSALS = ["below-threshold", "below-threshold", "below-threshold", "below-threshold", "ambiguous-margin", "ancestry-veto", "no-candidate"];

function generate(random: () => number): VisualAgreementInput {
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  const capture = (fps: VisualFingerprint[]): VisualAgreementEvidenceInput => {
    if (random() < 0.04) return un(pick(CODES));
    return evidence(pick(fps), { dpr: random() < 0.03 ? 2 : 1, depth: random() < 0.02 ? 1 : 0 });
  };
  const competitors = Array.from({ length: Math.floor(random() * (AGREEMENT_MAX_COMPETITORS + 3)) }, () =>
    capture(random() < 0.08 ? [FP.twin] : [FP.near, FP.mid, FP.far])
  );
  const countDelta = random() < 0.1 ? pick([1, 2, -1]) : 0;
  return {
    mode: pick(["off", "shadow", "enforce", "enforce"] as const),
    eligibility: random() < 0.85 ? "eligible" : "ineligible",
    dom: {
      refusal: pick(REFUSALS),
      best: { score: pick([0.5999, 0.6, 0.7, 0.85, Math.round(random() * 10000) / 10000]), ancestry: pick([0.4999, 0.5, 0.9, 1]) },
      margin: pick([0, 0.0799, 0.08, 0.2, 1, Math.round(random() * 10000) / 10000]),
      competitorCount: Math.max(0, competitors.length + countDelta)
    },
    reference: random() < 0.05 ? null : random() < 0.04 ? un(pick(CODES)) : E.ref,
    best: capture(random() < 0.7 ? [FP.same] : [FP.near, FP.mid, FP.far, FP.twin]),
    competitors
  };
}

function evaluateSuite(decide: Decider, cases: Case[], propertyRuns: number): Outcome[] {
  const outcomes: Outcome[] = [];
  const record = (label: string, ok: boolean, detail?: string): void => {
    outcomes.push({ label, ok, detail });
  };

  // Cardinality first, so an empty or short case set fails by name.
  record(`the decision table holds at least ${TABLE_FLOOR} cases`, cases.length >= TABLE_FLOOR, `${cases.length} cases`);
  const rowsSeen = new Set(cases.map((c) => c.row));
  record("the decision table covers every row A1-A9 and invalid input", ROWS.every((row) => rowsSeen.has(row)), `missing: ${ROWS.filter((row) => !rowsSeen.has(row)).join(", ")}`);
  record("the decision table contains at least five proceeding cases", cases.filter((c) => c.expect.effect === "proceed").length >= 5);

  for (const c of cases) {
    const before = JSON.stringify(c.input);
    let verdict: VisualAgreementVerdict;
    try {
      verdict = decide(c.input);
    } catch (error) {
      record(`[${c.row}] ${c.name}`, false, `threw ${String(error)}`);
      continue;
    }
    const got = `${verdict.outcome}/${verdict.reason}/${verdict.effect}`;
    const want = `${c.expect.outcome}/${c.expect.reason}/${c.expect.effect}`;
    record(`[${c.row}] ${c.name} → ${want}`, got === want, `got ${got}`);
    const problem = shapeProblem(verdict);
    record(`[${c.row}] ${c.name}: verdict shape (J1)`, problem === null, problem ?? undefined);
    const again = decide(structuredClone(c.input));
    record(`[${c.row}] ${c.name}: deterministic, input untouched`, JSON.stringify(again) === JSON.stringify(verdict) && JSON.stringify(c.input) === before);
  }

  // J1: competitor order never changes the verdict, including where the twin sits.
  const orders: VisualAgreementEvidenceInput[][] = [
    [E.near, E.mid, E.twin],
    [E.twin, E.near, E.mid],
    [E.mid, E.twin, E.near]
  ];
  const ordered = orders.map((competitors) => JSON.stringify(decide(mk(E.same, competitors))));
  record("J1: the verdict does not depend on competitor order", ordered.every((v) => v === ordered[0]) && ordered[0].includes("identical-competitor"), ordered.join(" | "));

  // J2-J4 property run, replayed for determinism.
  const run = (): { log: string[]; counts: Record<string, number>; agreed: number; proceeds: number; violations: string[] } => {
    const random = mulberry32(0xa9ee);
    const log: string[] = [];
    const counts: Record<string, number> = {};
    const violations: string[] = [];
    let agreed = 0;
    let proceeds = 0;
    for (let i = 0; i < propertyRuns; i++) {
      const input = generate(random);
      let verdict: VisualAgreementVerdict;
      try {
        verdict = decide(input);
      } catch (error) {
        violations.push(`#${i} threw ${String(error)}`);
        continue;
      }
      log.push(JSON.stringify(verdict));
      counts[verdict.outcome] = (counts[verdict.outcome] ?? 0) + 1;
      const problem = shapeProblem(verdict);
      if (problem) violations.push(`#${i} ${problem}`);
      if (verdict.outcome === "agreed") {
        agreed += 1;
        const violation = agreementViolation(input);
        if (violation) violations.push(`#${i} ${violation}`);
      }
      if (verdict.effect === "proceed") proceeds += 1;
      const shouldProceed = verdict.outcome === "agreed" && input.mode === "enforce";
      if ((verdict.effect === "proceed") !== shouldProceed) violations.push(`#${i} effect ${verdict.effect} with ${verdict.outcome} in ${input.mode}`);
      if (input.mode === "off" && verdict.outcome !== "not-eligible") violations.push(`#${i} mode off gave ${verdict.outcome}`);
      // With several unavailable competitors the reported capture code is the first one met; only that may differ.
      const reversed = decide({ ...input, competitors: [...input.competitors].reverse() });
      const sameDecision = reversed.outcome === verdict.outcome && reversed.effect === verdict.effect && (verdict.outcome === "unavailable" || reversed.reason === verdict.reason);
      if (!sameDecision) violations.push(`#${i} J1: reversing competitors changed ${verdict.outcome}/${verdict.reason} to ${reversed.outcome}/${reversed.reason}`);
    }
    return { log, counts, agreed, proceeds, violations };
  };
  const first = run();
  const second = run();
  record(`the property run generated exactly ${PROPERTY_RUNS} verdicts`, first.log.length === PROPERTY_RUNS && propertyRuns === PROPERTY_RUNS, `${first.log.length} verdicts`);
  record("J1-J4: every agreed verdict satisfies the independent oracle, and proceed means agreed in enforce", first.violations.length === 0, `${first.violations.length} violations, first: ${first.violations.slice(0, 3).join("; ")}`);
  record("the property run produced every outcome", OUTCOMES.every((o) => (first.counts[o] ?? 0) > 0), JSON.stringify(first.counts));
  record(`the property run agreed at least ${MIN_AGREED} times and proceeded (non-vacuous oracle)`, first.agreed >= MIN_AGREED && first.proceeds > 0 && first.proceeds < first.agreed, `${first.agreed} agreed, ${first.proceeds} proceeded`);
  record("the property run replays identically from its seed", first.log.length > 0 && first.log.join("\n") === second.log.join("\n"));

  return outcomes;
}

// ---------------------------------------------------------------------------------------------------------------
// Main

console.log("verify:visual-agreement — pure Visual Locator Recovery policy (N3.1)\n");
console.log(`  measured scores against the reference (bp): same ${S.same}, near ${S.near}, mid ${S.mid}, far ${S.far}\n`);

// Preconditions the table depends on: assert them before the checks they gate.
check("precondition: independent paints of the same pixels share a contentDigest", FP.same.contentDigest === FP.ref.contentDigest && FP.twin.contentDigest === FP.ref.contentDigest);
check("precondition: only the identical paint scores 10000", S.same === 10000 && S.near < 10000 && S.mid < 10000 && S.far < 10000, JSON.stringify(S));
check("precondition: the near paint is a high-similarity near miss (>= 9000 bp)", S.near >= 9000, `${S.near} bp`);

const cases = buildCases();
for (const outcome of evaluateSuite(decideVisualAgreement, cases, PROPERTY_RUNS)) check(outcome.label, outcome.ok, outcome.detail);

console.log("\n  mutants (each must FAIL the suite)");
const agreedVerdict = (input: VisualAgreementInput): VisualAgreementVerdict => ({
  version: 1,
  outcome: "agreed",
  reason: "identical-unique",
  effect: input.mode === "enforce" ? "proceed" : "none"
});
const isIdentical = (a: VisualFingerprint, b: VisualFingerprint): boolean => {
  const result = compareVisualFingerprints(a, b);
  return result.ok && result.value.identical;
};

const similarityAgrees: Decider = (input) => {
  const v = decideVisualAgreement(input);
  if (v.reason !== "not-identical" || !available(input.reference) || !available(input.best)) return v;
  return scoreBp(input.reference.fingerprint, input.best.fingerprint) >= 9000 ? agreedVerdict(input) : v;
};
const ambiguousRescued: Decider = (input) =>
  input?.dom?.refusal === "ambiguous-margin" ? decideVisualAgreement({ ...input, dom: { ...input.dom, refusal: "below-threshold" } }) : decideVisualAgreement(input);
const floorRemoved: Decider = (input) => {
  const v = decideVisualAgreement(input);
  return v.reason === "dom-floor" ? decideVisualAgreement({ ...input, dom: { ...input.dom, best: { score: 0.85, ancestry: 1 }, margin: 1 } }) : v;
};
const uncapturedIgnored: Decider = (input) => {
  const v = decideVisualAgreement(input);
  return v.reason === "competitors-uncaptured" && Array.isArray(input.competitors)
    ? decideVisualAgreement({ ...input, competitors: input.competitors.slice(0, AGREEMENT_MAX_COMPETITORS), dom: { ...input.dom, competitorCount: Math.min(input.competitors.length, AGREEMENT_MAX_COMPETITORS) } })
    : v;
};
const twinIgnored: Decider = (input) => {
  const v = decideVisualAgreement(input);
  return v.reason === "identical-competitor" ? agreedVerdict(input) : v;
};
const firstCompetitorOnly: Decider = (input) => {
  const v = decideVisualAgreement(input);
  if (v.reason !== "identical-competitor" || !available(input.reference)) return v;
  const c0 = input.competitors[0];
  return available(c0) && isIdentical(input.reference.fingerprint, c0.fingerprint) ? v : agreedVerdict(input);
};
const shadowProceeds: Decider = (input) => {
  const v = decideVisualAgreement(input);
  return v.outcome === "agreed" ? { ...v, effect: "proceed" } : v;
};
const unavailableAgrees: Decider = (input) => {
  const v = decideVisualAgreement(input);
  return v.outcome === "unavailable" && v.reason !== "invalid-input" ? agreedVerdict(input) : v;
};
const leaksIndex: Decider = (input) => {
  const v = decideVisualAgreement(input);
  return v.outcome === "agreed" ? ({ ...v, index: 0 } as never) : v;
};

// The optional third entry names the check that must be among the failures, so a floor mutant is caught by its floor.
const mutants: Array<[string, Outcome[], string?]> = [
  ["similarity (>= 9000 bp) grants agreement", evaluateSuite(similarityAgrees, cases, PROPERTY_RUNS), "[A7] a very similar best"],
  ["ambiguous-margin is rescued", evaluateSuite(ambiguousRescued, cases, PROPERTY_RUNS), "[A1] refusal \"ambiguous-margin\""],
  ["the DOM floor is removed", evaluateSuite(floorRemoved, cases, PROPERTY_RUNS), "[A2]"],
  ["an uncaptured competitor is ignored", evaluateSuite(uncapturedIgnored, cases, PROPERTY_RUNS), "[A6]"],
  ["an identical competitor is ignored", evaluateSuite(twinIgnored, cases, PROPERTY_RUNS), "[A8]"],
  ["the twin check is capped at competitor 0", evaluateSuite(firstCompetitorOnly, cases, PROPERTY_RUNS), "[A8] F3 twin at competitor 1"],
  ["shadow mode proceeds", evaluateSuite(shadowProceeds, cases, PROPERTY_RUNS), "[A9] shadow mode"],
  ["an unavailable capture agrees", evaluateSuite(unavailableAgrees, cases, PROPERTY_RUNS), "[A4]"],
  ["the verdict names an index", evaluateSuite(leaksIndex, cases, PROPERTY_RUNS), "[A9] an identical best and three dissimilar competitors: verdict shape"],
  ["an empty case set", evaluateSuite(decideVisualAgreement, [], PROPERTY_RUNS), "the decision table holds"],
  ["a case set one short of the floor", evaluateSuite(decideVisualAgreement, cases.slice(0, TABLE_FLOOR - 1), PROPERTY_RUNS), "the decision table holds"],
  ["an empty property run", evaluateSuite(decideVisualAgreement, cases, 0), "the property run generated"]
];
for (const [name, outcomes, mustFail] of mutants) {
  const failing = outcomes.filter((o) => !o.ok).map((o) => o.label);
  const caughtBy = mustFail === undefined || failing.some((label) => label.startsWith(mustFail));
  check(`MUTATION: ${name} fails the suite (${failing.length} checks${mustFail ? `, including "${mustFail}"` : ""})`, failing.length > 0 && caughtBy, `the suite passed a mutant: ${failing.join("; ") || "nothing failed"}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
