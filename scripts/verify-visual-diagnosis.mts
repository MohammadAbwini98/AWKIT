/**
 * verify:visual-diagnosis — Phase N, N5.2 (awkit-vra.14.2): the pure Visual Failure Diagnosis policy
 * `decideVisualDiagnosis`.
 *
 * No browser, no page, no files beyond reading the policy's own source. Fingerprints are computed by the real
 * `fingerprintVisualImage` over synthetic images, so identity is the real `contentDigest` equality.
 *
 * One suite covers:
 *   - a decision table over the refusals, the three condition states, the examined scope, truncation, the DOM facts and
 *     viewport uniformity;
 *   - the advisory shape on every verdict: no key that could name an element (index, locator, selector, coordinate,
 *     score, effect), only vocabulary codes, at most 8 observations, `identicalOthers` exactly with
 *     `other-examined-identical`, and never a difference, an absence or `equal-proven` (VD-9: every v1 record is
 *     unproven);
 *   - a seeded property run checked against an INDEPENDENT oracle that reads `contentDigest` and the evidence fields
 *     directly, plus order independence of the non-target members and replay determinism;
 *   - pins: the examined cap equals `VISUAL_FANOUT_MAX_CANDIDATES`, and the v1 evidence-key table covers every key a
 *     real `buildVisualEvidence` produces;
 *   - purity: the policy source imports only `src/visual` siblings and uses no I/O, clock or randomness.
 *
 * The same suite is then run against mutants, each of which must make it FAIL.
 *
 * Run: npm run verify:visual-diagnosis
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VISUAL_FANOUT_MAX_CANDIDATES } from "@src/visual/capture";
import {
  VISUAL_DIAGNOSIS_EVIDENCE_KEYS,
  VISUAL_DIAGNOSIS_FRAME_KEYS,
  VISUAL_DIAGNOSIS_MAX_EXAMINED,
  VISUAL_DIAGNOSIS_REFUSALS,
  VISUAL_DIAGNOSIS_VIEWPORT_KEYS,
  decideVisualDiagnosis,
  type VisualDiagnosisCode,
  type VisualDiagnosisEvidenceInput,
  type VisualDiagnosisInput,
  type VisualDiagnosisMember,
  type VisualDiagnosisUnavailable,
  type VisualDiagnosisVerdict
} from "@src/visual/diagnosis/decideVisualDiagnosis";
import type { VisualErrorCode } from "@src/visual/errors";
import { fingerprintVisualImage, type VisualFingerprint } from "@src/visual/fingerprint";
import { VisualImage } from "@src/visual/png";
import { buildVisualEvidence, type VisualEvidence } from "@src/visual/visualEvidence";
import * as visualIndex from "@src/visual";

/** Hardcoded floors. Raising the case count is fine; dropping below these fails the suite. */
const TABLE_FLOOR = 40;
const PROPERTY_RUNS = 4000;
const MIN_TARGET_IDENTICAL = 200;
const MIN_OTHER_IDENTICAL = 200;
const MIN_DIFFERENT = 100;
const MIN_REFUSED = 100;

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

type Decider = (input: VisualDiagnosisInput) => VisualDiagnosisVerdict;
interface Outcome {
  label: string;
  ok: boolean;
  detail?: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Synthetic evidence

const W = 48;
const H = 40;

function paint(fn: (x: number, y: number) => number, w = W, h = H): VisualImage {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.max(0, Math.min(255, Math.round(fn(x, y))));
      const i = (y * w + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return new VisualImage(w, h, data);
}

const inBox = (x: number, y: number, bx: number, by: number, bw: number, bh: number): boolean => x >= bx && x < bx + bw && y >= by && y < by + bh;

function fingerprint(image: VisualImage): VisualFingerprint {
  const result = fingerprintVisualImage(image);
  if (!result.ok) throw new Error(`synthetic fingerprint failed: ${result.code}`);
  return result.value;
}

const icon = (x: number, y: number): number => (inBox(x, y, 14, 12, 18, 16) ? 20 : 60 + 2 * x);
const FP = {
  ref: fingerprint(paint(icon)),
  same: fingerprint(paint(icon)),
  near: fingerprint(paint((x, y) => (inBox(x, y, 15, 12, 18, 16) ? 24 : 60 + 2 * x))),
  far: fingerprint(paint((x, y) => (inBox(x, y, 6, 4, 30, 30) ? 230 : 200 - 4 * y))),
  blank: fingerprint(paint(() => 255, 160, 120)),
  busy: fingerprint(paint((x, y) => (inBox(x, y, 20, 20, 60, 40) ? 30 : 120 + ((x * 7 + y * 3) % 90)), 160, 120))
};

interface EvidenceOptions {
  dpr?: number;
  vw?: number;
  vh?: number;
  depth?: number;
  mainFrame?: boolean;
  fpVersion?: number;
  kind?: "element" | "viewport";
}

function evidence(fp: VisualFingerprint, o: EvidenceOptions = {}): VisualEvidence {
  const dpr = o.dpr ?? 1;
  const vw = o.vw ?? 1280;
  const vh = o.vh ?? 720;
  const depth = o.depth ?? 0;
  const rect = { x: 10, y: 10, width: W, height: H };
  const viewport = { cssWidth: vw, cssHeight: vh, devicePixelRatio: dpr, scaleX: dpr, scaleY: dpr, imageWidth: Math.round(vw * dpr), imageHeight: Math.round(vh * dpr) };
  const fingerprintValue = o.fpVersion === undefined ? fp : ({ ...fp, version: o.fpVersion } as unknown as VisualFingerprint);
  if (o.kind === "viewport") return { version: 1, kind: "viewport", capturedAt: "2026-10-19T00:00:00.000Z", viewport, fingerprint: fingerprintValue };
  return {
    version: 1,
    kind: "element",
    capturedAt: "2026-10-19T00:00:00.000Z",
    viewport,
    frame: { isMainFrame: o.mainFrame ?? depth === 0, depth },
    bounds: { requested: { ...rect }, actual: { x: rect.x * dpr, y: rect.y * dpr, width: rect.width * dpr, height: rect.height * dpr }, actualCss: { ...rect }, wasClipped: false },
    fingerprint: fingerprintValue
  };
}

const un = (code: VisualErrorCode): VisualDiagnosisUnavailable => ({ available: false, code });
const member = (isTarget: boolean, ev: VisualDiagnosisEvidenceInput): VisualDiagnosisMember => ({ isTarget, evidence: ev });
const T = (fp: VisualFingerprint, o: EvidenceOptions = {}): VisualDiagnosisMember => member(true, evidence(fp, o));
const O = (fp: VisualFingerprint, o: EvidenceOptions = {}): VisualDiagnosisMember => member(false, evidence(fp, o));
const GEO = { inViewport: true, zeroSize: false, occluded: false };

function input(o: Partial<VisualDiagnosisInput> & { matches?: number; domNamed?: number; dropped?: boolean; geometry?: typeof GEO } = {}): VisualDiagnosisInput {
  const matches = o.matches ?? 1;
  const members = o.members ?? [T(FP.same)];
  return {
    ...(o.refusal !== undefined ? { refusal: o.refusal } : {}),
    referenceSource: o.referenceSource ?? "runtime",
    reference: o.reference === undefined ? evidence(FP.ref) : o.reference,
    dom: {
      targetMatches: matches,
      ...(matches === 1 ? { target: o.geometry ?? GEO } : {}),
      domNamed: o.domNamed ?? Math.max(members.length, matches),
      contendersDropped: o.dropped ?? false
    },
    members,
    viewport: o.viewport === undefined ? FP.busy : o.viewport
  };
}

interface Expect {
  outcome: VisualDiagnosisVerdict["outcome"];
  conditions?: VisualDiagnosisVerdict["conditions"];
  observations: VisualDiagnosisCode[];
  examined?: number;
  truncated?: boolean;
  identicalOthers?: "1" | "2+";
}
interface Case {
  name: string;
  input: VisualDiagnosisInput;
  expect: Expect;
}

function buildCases(): Case[] {
  const cases: Case[] = [];
  const add = (name: string, i: VisualDiagnosisInput, expect: Expect): void => void cases.push({ name, input: i, expect });

  // Refusals: nothing compared, the code is the only observation.
  for (const refusal of VISUAL_DIAGNOSIS_REFUSALS) add(`caller refusal ${refusal}`, input({ refusal }), { outcome: "refused", observations: [refusal] });
  add("an unknown caller refusal is capture-failed, never an observation", input({ refusal: "bogus" as never }), { outcome: "refused", observations: ["capture-failed"] });
  add("a null input is capture-failed", null as unknown as VisualDiagnosisInput, { outcome: "refused", observations: ["capture-failed"] });
  add("a protected member capture refuses the whole diagnosis", input({ members: [T(FP.same), member(false, un("PROTECTED_SURFACE"))] }), { outcome: "refused", observations: ["protected-surface"] });
  add("a protected viewport capture refuses the whole diagnosis", input({ viewport: un("PROTECTED_SURFACE") }), { outcome: "refused", observations: ["protected-surface"] });
  add("a budget-exhausted capture refuses", input({ members: [member(true, un("BUDGET_EXHAUSTED"))] }), { outcome: "refused", observations: ["budget-exhausted"] });
  add("a cancelled capture refuses as budget-exhausted", input({ viewport: un("CANCELLED") }), { outcome: "refused", observations: ["budget-exhausted"] });
  add("a page-closed capture refuses", input({ members: [member(true, un("PAGE_CLOSED"))] }), { outcome: "refused", observations: ["page-closed"] });
  add("more members than the examined cap is invalid", input({ matches: 0, domNamed: 64, members: Array.from({ length: 33 }, () => O(FP.far)) }), { outcome: "refused", observations: ["capture-failed"] });
  add("more members than DOM-named is invalid", input({ domNamed: 1, members: [T(FP.same), O(FP.far)] }), { outcome: "refused", observations: ["capture-failed"] });
  add("two target members is invalid", input({ members: [T(FP.same), T(FP.same)], domNamed: 2 }), { outcome: "refused", observations: ["capture-failed"] });
  add("a target member without a single match is invalid", input({ matches: 2, members: [T(FP.same)] }), { outcome: "refused", observations: ["capture-failed"] });
  add("one match without target geometry is invalid", { ...input(), dom: { targetMatches: 1, domNamed: 1, contendersDropped: false } }, { outcome: "refused", observations: ["capture-failed"] });

  // Reference states.
  add("no reference", input({ reference: null, referenceSource: "none" }), { outcome: "observed", conditions: "none", observations: ["reference-unavailable"], examined: 1 });
  add("an unreadable reference", input({ reference: un("FINGERPRINT_FAILED") }), { outcome: "observed", conditions: "none", observations: ["reference-unavailable"] });
  add("a viewport-kind reference is not element evidence", input({ reference: evidence(FP.ref, { kind: "viewport" }) }), { outcome: "observed", conditions: "none", observations: ["reference-unavailable"] });

  // Conditions: every provable field, both directions.
  add("DPR differs", input({ members: [T(FP.same, { dpr: 2 })] }), { outcome: "observed", conditions: "different", observations: ["conditions-changed"] });
  add("CSS width differs", input({ members: [T(FP.same, { vw: 1024 })] }), { outcome: "observed", conditions: "different", observations: ["conditions-changed"] });
  add("CSS height differs", input({ members: [T(FP.same, { vh: 600 })] }), { outcome: "observed", conditions: "different", observations: ["conditions-changed"] });
  add("frame depth differs", input({ members: [T(FP.same, { depth: 1 })] }), { outcome: "observed", conditions: "different", observations: ["conditions-changed"] });
  add("main-frame flag differs", input({ members: [T(FP.same, { mainFrame: false })] }), { outcome: "observed", conditions: "different", observations: ["conditions-changed"] });
  add("fingerprint version differs", input({ members: [T(FP.same, { fpVersion: 99 })] }), { outcome: "observed", conditions: "different", observations: ["conditions-changed"] });
  add("a differing contender blocks every identity code", input({ members: [T(FP.same), O(FP.same, { dpr: 1.25 })], domNamed: 2 }), { outcome: "observed", conditions: "different", observations: ["conditions-changed"] });

  // Unproven: only self-evidencing positives.
  add("the target is byte-identical", input(), { outcome: "observed", conditions: "unproven", observations: ["conditions-unproven", "target-identical-to-reference"], examined: 1 });
  add("a recorded reference is still unproven", input({ referenceSource: "recorded" }), { outcome: "observed", conditions: "unproven", observations: ["conditions-unproven", "target-identical-to-reference"] });
  add("a near-miss target reports no difference", input({ members: [T(FP.near)] }), { outcome: "observed", conditions: "unproven", observations: ["conditions-unproven", "inconclusive"] });
  add("a far target reports no difference", input({ members: [T(FP.far)] }), { outcome: "observed", conditions: "unproven", observations: ["conditions-unproven", "inconclusive"] });
  add("one other examined member is identical", input({ matches: 0, members: [O(FP.far), O(FP.same), O(FP.near)], domNamed: 3 }), { outcome: "observed", conditions: "unproven", observations: ["conditions-unproven", "target-not-in-dom", "other-examined-identical"], examined: 3, identicalOthers: "1" });
  add("two other examined members are identical (a count, not uniqueness)", input({ matches: 0, members: [O(FP.same), O(FP.same)], domNamed: 2 }), { outcome: "observed", conditions: "unproven", observations: ["conditions-unproven", "target-not-in-dom", "other-examined-identical"], identicalOthers: "2+" });
  add("target and a twin both identical", input({ members: [T(FP.same), O(FP.same)], domNamed: 2 }), { outcome: "observed", conditions: "unproven", observations: ["conditions-unproven", "target-identical-to-reference", "other-examined-identical"], identicalOthers: "1" });
  add("no member identical stays inconclusive, never no-examined-identical", input({ matches: 0, members: [O(FP.far), O(FP.near)], domNamed: 2 }), { outcome: "observed", conditions: "unproven", observations: ["conditions-unproven", "target-not-in-dom", "inconclusive"] });
  add("an unexaminable member is left out of examined", input({ members: [T(FP.same), member(false, un("TARGET_OFFSCREEN")), member(false, un("TARGET_STALE"))], domNamed: 3 }), { outcome: "observed", conditions: "unproven", observations: ["conditions-unproven", "target-identical-to-reference"], examined: 1 });
  add("no examined member means no comparison", input({ matches: 0, members: [], domNamed: 0 }), { outcome: "observed", conditions: "none", observations: ["target-not-in-dom"], examined: 0 });

  // Scope and truncation.
  add("domNamed above the cap is truncated", input({ matches: 40, members: Array.from({ length: 32 }, () => O(FP.far)), domNamed: 40 }), { outcome: "observed", conditions: "unproven", observations: ["conditions-unproven", "target-multiple-matches", "inconclusive"], examined: 32, truncated: true });
  add("recovery-dropped contenders are truncated", input({ members: [T(FP.same), O(FP.far)], domNamed: 2, dropped: true }), { outcome: "observed", conditions: "unproven", observations: ["conditions-unproven", "target-identical-to-reference"], truncated: true });
  add("domNamed exactly at the cap is not truncated", input({ matches: 32, members: Array.from({ length: 32 }, () => O(FP.far)), domNamed: 32 }), { outcome: "observed", observations: ["conditions-unproven", "target-multiple-matches", "inconclusive"], truncated: false });
  add("an identical element the caller never examined is not counted (omitted contender)", input({ members: [T(FP.far)], domNamed: 1 }), { outcome: "observed", observations: ["conditions-unproven", "inconclusive"], examined: 1 });

  // DOM facts.
  add("target offscreen", input({ members: [], domNamed: 1, geometry: { inViewport: false, zeroSize: false, occluded: false } }), { outcome: "observed", conditions: "none", observations: ["target-offscreen"], examined: 0 });
  add("target zero-size and occluded", input({ members: [T(FP.same)], geometry: { inViewport: true, zeroSize: true, occluded: true } }), { outcome: "observed", observations: ["conditions-unproven", "target-zero-size", "target-occluded", "target-identical-to-reference"] });
  add("target matches several", input({ matches: 3, members: [O(FP.same), O(FP.far)], domNamed: 3 }), { outcome: "observed", observations: ["conditions-unproven", "target-multiple-matches", "other-examined-identical"], identicalOthers: "1" });

  // Viewport uniformity, with or without a target (finding 4).
  add("a blank viewport with no target", input({ matches: 0, members: [], domNamed: 0, viewport: FP.blank, reference: null, referenceSource: "none" }), { outcome: "observed", conditions: "none", observations: ["reference-unavailable", "target-not-in-dom", "viewport-uniform"] });
  add("a busy viewport is not uniform", input({ matches: 0, members: [], domNamed: 0, viewport: FP.busy }), { outcome: "observed", observations: ["target-not-in-dom"] });
  add("no frame means no uniformity", input({ matches: 0, members: [], domNamed: 0, viewport: null }), { outcome: "observed", observations: ["target-not-in-dom"] });
  add("an unreadable viewport fingerprint is ignored", input({ viewport: un("FINGERPRINT_FAILED") }), { outcome: "observed", observations: ["conditions-unproven", "target-identical-to-reference"] });
  add("nothing reportable is inconclusive, never an empty record", input({ members: [], domNamed: 1 }), { outcome: "observed", conditions: "none", observations: ["inconclusive"], examined: 0 });
  return cases;
}

// ---------------------------------------------------------------------------------------------------------------
// Invariants and the independent oracle

const VOCABULARY: ReadonlySet<string> = new Set([
  ...VISUAL_DIAGNOSIS_REFUSALS,
  "reference-unavailable",
  "conditions-changed",
  "conditions-unproven",
  "target-not-in-dom",
  "target-multiple-matches",
  "target-offscreen",
  "target-zero-size",
  "target-occluded",
  "target-identical-to-reference",
  "target-differs-from-reference",
  "other-examined-identical",
  "no-examined-identical",
  "viewport-uniform",
  "inconclusive"
]);
const ALLOWED_KEYS: ReadonlySet<string> = new Set(["version", "outcome", "conditions", "observations", "referenceSource", "examined", "domNamed", "truncated", "identicalOthers"]);
const NEVER_IN_V1 = ["target-differs-from-reference", "no-examined-identical"];

function shapeProblem(v: VisualDiagnosisVerdict): string | null {
  if (!v || typeof v !== "object") return "not an object";
  const extra = Object.keys(v).filter((key) => !ALLOWED_KEYS.has(key));
  if (extra.length) return `unexpected keys ${extra.join(",")}`;
  if (v.version !== 1) return "version";
  if (!Array.isArray(v.observations) || v.observations.length === 0 || v.observations.length > 8) return `observation count ${v.observations?.length}`;
  const unknown = v.observations.filter((code) => !VOCABULARY.has(code));
  if (unknown.length) return `unknown codes ${unknown.join(",")}`;
  if (new Set(v.observations).size !== v.observations.length) return "duplicate codes";
  if (v.conditions === "equal-proven") return "equal-proven reached without provenance";
  const banned = v.observations.filter((code) => NEVER_IN_V1.includes(code));
  if (banned.length) return `difference or absence in v1: ${banned.join(",")}`;
  if ((v.identicalOthers !== undefined) !== v.observations.includes("other-examined-identical")) return "identicalOthers without other-examined-identical, or the reverse";
  if (v.identicalOthers !== undefined && v.identicalOthers !== "1" && v.identicalOthers !== "2+") return `identicalOthers ${String(v.identicalOthers)}`;
  const identity = v.observations.some((code) => code === "target-identical-to-reference" || code === "other-examined-identical");
  if (identity && v.conditions !== "unproven") return `identity code under ${v.conditions}`;
  if (v.outcome === "refused" && (v.observations.length !== 1 || !(VISUAL_DIAGNOSIS_REFUSALS as readonly string[]).includes(v.observations[0]))) return "refused verdict with observations";
  if (v.outcome === "observed" && v.observations.some((code) => (VISUAL_DIAGNOSIS_REFUSALS as readonly string[]).includes(code))) return "observed verdict with a refusal code";
  if (!Number.isInteger(v.examined) || v.examined < 0 || v.examined > 32) return `examined ${v.examined}`;
  return null;
}

const isEvidence = (e: unknown): e is VisualEvidence => !!e && typeof e === "object" && (e as { available?: boolean }).available !== false && (e as VisualEvidence).kind === "element" && !!(e as VisualEvidence).bounds;
const unavailableCode = (e: unknown): VisualErrorCode | null => (e && typeof e === "object" && (e as { available?: boolean }).available === false ? (e as VisualDiagnosisUnavailable).code : null);

/** An independent reading of the plan's rules, from the evidence fields and `contentDigest` directly. */
function oracleViolation(i: VisualDiagnosisInput, v: VisualDiagnosisVerdict): string | null {
  if (i.refusal) return v.outcome === "refused" ? null : "a caller refusal was not refused";
  const terminal = [i.viewport, ...i.members.map((m) => m.evidence)].map(unavailableCode).some((code) => code === "PROTECTED_SURFACE" || code === "BUDGET_EXHAUSTED" || code === "CANCELLED" || code === "PAGE_CLOSED");
  if (terminal) return v.outcome === "refused" ? null : "a protected, budget or page-closed capture was not refused";
  if (v.outcome !== "observed") return `refused ${v.observations.join(",")} without cause`;
  const examined = i.members.filter((m) => isEvidence(m.evidence) && (m.evidence as VisualEvidence).bounds!.actualCss.width > 0);
  if (v.examined !== examined.length) return `examined ${v.examined}, oracle ${examined.length}`;
  const truncated = i.dom.contendersDropped || i.dom.domNamed > 32;
  if (v.truncated !== truncated) return `truncated ${v.truncated}, oracle ${truncated}`;
  const ref = isEvidence(i.reference) ? i.reference : null;
  if (!ref || examined.length === 0) {
    if (v.conditions !== "none") return `conditions ${v.conditions} without a comparison`;
    return null;
  }
  const differs = examined.some((m) => {
    const e = m.evidence as VisualEvidence;
    return (
      e.viewport.devicePixelRatio !== ref.viewport.devicePixelRatio ||
      e.viewport.cssWidth !== ref.viewport.cssWidth ||
      e.viewport.cssHeight !== ref.viewport.cssHeight ||
      e.frame!.depth !== ref.frame!.depth ||
      e.frame!.isMainFrame !== ref.frame!.isMainFrame ||
      e.fingerprint.version !== ref.fingerprint.version
    );
  });
  if (differs) return v.conditions === "different" ? null : `conditions ${v.conditions}, oracle different`;
  if (v.conditions !== "unproven") return `conditions ${v.conditions}, oracle unproven`;
  const digest = ref.fingerprint.contentDigest;
  const targetIdentical = examined.some((m) => m.isTarget && (m.evidence as VisualEvidence).fingerprint.contentDigest === digest);
  const others = examined.filter((m) => !m.isTarget && (m.evidence as VisualEvidence).fingerprint.contentDigest === digest).length;
  if (v.observations.includes("target-identical-to-reference") !== targetIdentical) return `target identity ${!targetIdentical}, oracle ${targetIdentical}`;
  const bucket = others === 0 ? undefined : others === 1 ? "1" : "2+";
  if (v.identicalOthers !== bucket) return `identicalOthers ${String(v.identicalOthers)}, oracle ${String(bucket)}`;
  return null;
}

// Seeded generator (mulberry32), so a run replays exactly.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generate(next: () => number): VisualDiagnosisInput {
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)];
  const memberEvidence = (): VisualDiagnosisEvidenceInput => {
    const r = next();
    if (r < 0.03) return un(pick(["PROTECTED_SURFACE", "BUDGET_EXHAUSTED", "PAGE_CLOSED", "CANCELLED"] as const));
    if (r < 0.1) return un(pick(["TARGET_OFFSCREEN", "TARGET_STALE", "FRAME_MAPPING_FAILED", "CAPTURE_STALE"] as const));
    const fp = pick([FP.same, FP.same, FP.near, FP.far]);
    const cond = next();
    if (cond < 0.05) return evidence(fp, { dpr: 2 });
    if (cond < 0.08) return evidence(fp, { depth: 1 });
    return evidence(fp);
  };
  const matches = pick([0, 1, 1, 1, 2, 3]);
  const others = Math.floor(next() * 5);
  const members: VisualDiagnosisMember[] = [];
  if (matches === 1 && next() < 0.85) members.push(member(true, memberEvidence()));
  for (let k = 0; k < others; k++) members.push(member(false, memberEvidence()));
  const refRoll = next();
  const reference = refRoll < 0.1 ? null : refRoll < 0.15 ? un("FINGERPRINT_FAILED") : evidence(FP.ref);
  return {
    ...(next() < 0.04 ? { refusal: pick(VISUAL_DIAGNOSIS_REFUSALS) } : {}),
    referenceSource: reference === null ? "none" : pick(["runtime", "recorded"] as const),
    reference,
    dom: {
      targetMatches: matches,
      ...(matches === 1 ? { target: { inViewport: next() < 0.9, zeroSize: next() < 0.05, occluded: next() < 0.15 } } : {}),
      domNamed: members.length + (next() < 0.15 ? 40 : Math.floor(next() * 3)),
      contendersDropped: next() < 0.1
    },
    members,
    viewport: pick([FP.busy, FP.busy, FP.blank, null])
  };
}

function evaluateSuite(decide: Decider, cases: Case[], runs: number): Outcome[] {
  const outcomes: Outcome[] = [];
  const record = (label: string, ok: boolean, detail?: string): void => void outcomes.push({ label, ok, detail });

  record(`the decision table holds at least ${TABLE_FLOOR} cases`, cases.length >= TABLE_FLOOR, `${cases.length}`);
  for (const c of cases) {
    let v: VisualDiagnosisVerdict;
    try {
      v = decide(c.input);
    } catch (error) {
      record(`[table] ${c.name}`, false, `threw ${String(error)}`);
      continue;
    }
    const e = c.expect;
    const mismatch: string[] = [];
    if (v.outcome !== e.outcome) mismatch.push(`outcome ${v.outcome}`);
    if (e.conditions !== undefined && v.conditions !== e.conditions) mismatch.push(`conditions ${v.conditions}`);
    if (JSON.stringify(v.observations) !== JSON.stringify(e.observations)) mismatch.push(`observations ${JSON.stringify(v.observations)}`);
    if (e.examined !== undefined && v.examined !== e.examined) mismatch.push(`examined ${v.examined}`);
    if (e.truncated !== undefined && v.truncated !== e.truncated) mismatch.push(`truncated ${v.truncated}`);
    if (v.identicalOthers !== e.identicalOthers) mismatch.push(`identicalOthers ${String(v.identicalOthers)}`);
    const shape = shapeProblem(v);
    if (shape) mismatch.push(`shape: ${shape}`);
    record(`[table] ${c.name}`, mismatch.length === 0, mismatch.join("; "));
  }

  const run = (): { log: string[]; violations: string[]; counts: Record<string, number> } => {
    const next = rng(0x5d1a9);
    const log: string[] = [];
    const violations: string[] = [];
    const counts: Record<string, number> = {};
    for (let i = 0; i < runs; i++) {
      const generated = generate(next);
      let v: VisualDiagnosisVerdict;
      try {
        v = decide(generated);
      } catch (error) {
        violations.push(`#${i} threw ${String(error)}`);
        continue;
      }
      log.push(JSON.stringify(v));
      for (const code of v.observations) counts[code] = (counts[code] ?? 0) + 1;
      counts[`conditions:${v.conditions}`] = (counts[`conditions:${v.conditions}`] ?? 0) + 1;
      counts[`outcome:${v.outcome}`] = (counts[`outcome:${v.outcome}`] ?? 0) + 1;
      const shape = shapeProblem(v);
      if (shape) violations.push(`#${i} ${shape}`);
      const oracle = oracleViolation(generated, v);
      if (oracle) violations.push(`#${i} ${oracle}`);
      // Order independence: non-target members in reverse order give the same verdict.
      const targets = generated.members.filter((m) => m.isTarget);
      const reversed = decide({ ...generated, members: [...targets, ...generated.members.filter((m) => !m.isTarget).reverse()] });
      const sameDecision = generated.members.some((m) => unavailableCode(m.evidence) !== null) || JSON.stringify(reversed) === JSON.stringify(decide({ ...generated, members: [...targets, ...generated.members.filter((m) => !m.isTarget)] }));
      if (!sameDecision) violations.push(`#${i} member order changed the verdict`);
    }
    return { log, violations, counts };
  };
  const first = run();
  const second = run();
  record(`the property run generated exactly ${runs} verdicts`, runs > 0 && first.log.length === runs, `${first.log.length}`);
  record("every generated verdict has the advisory shape and agrees with the independent oracle", first.violations.length === 0, `${first.violations.length} violations, first: ${first.violations.slice(0, 3).join("; ")}`);
  record(
    "the property run is non-vacuous (identity, conditions-changed and refusals all occur often)",
    (first.counts["target-identical-to-reference"] ?? 0) >= MIN_TARGET_IDENTICAL &&
      (first.counts["other-examined-identical"] ?? 0) >= MIN_OTHER_IDENTICAL &&
      (first.counts["conditions:different"] ?? 0) >= MIN_DIFFERENT &&
      (first.counts["outcome:refused"] ?? 0) >= MIN_REFUSED,
    JSON.stringify(first.counts)
  );
  record("the property run replays identically from its seed", first.log.length > 0 && first.log.join("\n") === second.log.join("\n"));
  return outcomes;
}

/** The v1 evidence-key pin covers every key a real `buildVisualEvidence` produces, for evidence, viewport and frame. */
function pinOutcomes(evidenceKeys: Record<string, unknown>): Outcome[] {
  const image = paint(icon);
  const crop = { image, requestedBounds: { x: 10, y: 10, width: W, height: H }, actualBounds: { x: 10, y: 10, width: W, height: H }, actualCssBounds: { x: 10, y: 10, width: W, height: H }, wasClipped: false };
  const built = buildVisualEvidence({
    kind: "element",
    viewport: { cssWidth: 1280, cssHeight: 720, devicePixelRatio: 1, scaleX: 1, scaleY: 1, imageWidth: 1280, imageHeight: 720 },
    frame: { isMainFrame: true, depth: 0 },
    element: crop,
    context: crop,
    capturedAt: "2026-10-19T00:00:00.000Z",
    durationMs: 1
  });
  if (!built.ok) return [{ label: "a real element evidence with context can be built for the pin", ok: false, detail: built.code }];
  const missing = (keys: string[], pin: Record<string, unknown>): string[] => keys.filter((key) => !(key in pin));
  const evidenceMissing = missing(Object.keys(built.value), evidenceKeys);
  const viewportMissing = missing(Object.keys(built.value.viewport), VISUAL_DIAGNOSIS_VIEWPORT_KEYS);
  const frameMissing = missing(Object.keys(built.value.frame ?? {}), VISUAL_DIAGNOSIS_FRAME_KEYS);
  return [
    { label: "the evidence-key pin classifies every key of a real VisualEvidence v1", ok: evidenceMissing.length === 0 && Object.keys(built.value).length >= 7, detail: `unpinned: ${evidenceMissing.join(",")}` },
    { label: "the viewport-key pin classifies every key of VisualViewportInfo", ok: viewportMissing.length === 0 && Object.keys(built.value.viewport).length === 7, detail: `unpinned: ${viewportMissing.join(",")}` },
    { label: "the frame-key pin classifies every key of VisualFrameInfo", ok: frameMissing.length === 0 && Object.keys(built.value.frame ?? {}).length === 2, detail: `unpinned: ${frameMissing.join(",")}` }
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Main

console.log("verify:visual-diagnosis — pure Visual Failure Diagnosis policy (N5.2)\n");

check("precondition: independent paints of the same pixels share a contentDigest", FP.same.contentDigest === FP.ref.contentDigest);
check("precondition: the near and far paints are not identical", FP.near.contentDigest !== FP.ref.contentDigest && FP.far.contentDigest !== FP.ref.contentDigest);
check("precondition: the blank viewport is under the provisional uniform floors", FP.blank.lumaVariance <= 4 && FP.blank.meanEdge <= 1, `${FP.blank.lumaVariance}/${FP.blank.meanEdge}`);
check("precondition: the busy viewport is above them", FP.busy.lumaVariance > 4 || FP.busy.meanEdge > 1, `${FP.busy.lumaVariance}/${FP.busy.meanEdge}`);

check("pin: the examined cap equals VISUAL_FANOUT_MAX_CANDIDATES", VISUAL_DIAGNOSIS_MAX_EXAMINED === VISUAL_FANOUT_MAX_CANDIDATES, `${VISUAL_DIAGNOSIS_MAX_EXAMINED} vs ${VISUAL_FANOUT_MAX_CANDIDATES}`);
for (const outcome of pinOutcomes(VISUAL_DIAGNOSIS_EVIDENCE_KEYS)) check(outcome.label, outcome.ok, outcome.detail);
check("the policy is exported through the src/visual index", visualIndex.decideVisualDiagnosis === decideVisualDiagnosis);

const source = readFileSync(join(process.cwd(), "src", "visual", "diagnosis", "decideVisualDiagnosis.ts"), "utf8");
const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
check(
  "purity: the policy imports only src/visual siblings",
  imports.length > 0 && imports.every((spec) => ["../compare", "../errors", "../fingerprint", "../capture", "../visualEvidence"].includes(spec)),
  imports.join(", ")
);
check("purity: the capture import is type-only", /import type \{[^}]*\} from "\.\.\/capture"/.test(source) && !/^import \{[^}]*\} from "\.\.\/capture"/m.test(source));
check("purity: no I/O, clock, randomness or dynamic import", !/\b(node:|require\(|import\(|Date\.|new Date|Math\.random|performance\.|process\.|setTimeout|fetch\()/.test(source));

const cases = buildCases();
for (const outcome of evaluateSuite(decideVisualDiagnosis, cases, PROPERTY_RUNS)) check(outcome.label, outcome.ok, outcome.detail);

console.log("\n  mutants (each must FAIL the suite)");
const withObservation = (v: VisualDiagnosisVerdict, code: VisualDiagnosisCode): VisualDiagnosisVerdict => ({ ...v, observations: [...v.observations, code] });

const differenceUnderUnproven: Decider = (i) => {
  const v = decideVisualDiagnosis(i);
  return v.conditions === "unproven" && !v.observations.includes("target-identical-to-reference") && i.members.some((m) => m.isTarget) ? withObservation(v, "target-differs-from-reference") : v;
};
const recordedInferredHeaded: Decider = (i) => {
  const v = decideVisualDiagnosis(i);
  return i.referenceSource === "recorded" && v.conditions === "unproven" ? { ...v, conditions: "equal-proven" } : v;
};
const truncationIgnored: Decider = (i) => ({ ...decideVisualDiagnosis(i), truncated: false });
const countAsUniqueness: Decider = (i) => {
  const v = decideVisualDiagnosis(i);
  return v.identicalOthers === "2+" ? { ...v, identicalOthers: "1" } : v;
};
const leaksIndex: Decider = (i) => {
  const v = decideVisualDiagnosis(i);
  return v.observations.includes("other-examined-identical") ? ({ ...v, index: 1 } as never) : v;
};
const unknownRefusalObserved: Decider = (i) =>
  i && i.refusal !== undefined && !(VISUAL_DIAGNOSIS_REFUSALS as readonly string[]).includes(i.refusal)
    ? { version: 1, outcome: "observed", conditions: "none", observations: [i.refusal as VisualDiagnosisCode], referenceSource: "none", examined: 0, domNamed: 0, truncated: false }
    : decideVisualDiagnosis(i);
const protectedIgnored: Decider = (i) =>
  i && Array.isArray(i.members)
    ? decideVisualDiagnosis({
        ...i,
        viewport: unavailableCode(i.viewport) === "PROTECTED_SURFACE" ? null : i.viewport,
        members: i.members.map((m) => (unavailableCode(m.evidence) === "PROTECTED_SURFACE" ? { ...m, evidence: un("TARGET_STALE") } : m))
      })
    : decideVisualDiagnosis(i);
const conditionsIgnored: Decider = (i) =>
  i && Array.isArray(i.members) && isEvidence(i.reference)
    ? decideVisualDiagnosis({
        ...i,
        members: i.members.map((m) => (isEvidence(m.evidence) ? { ...m, evidence: { ...m.evidence, viewport: { ...(i.reference as VisualEvidence).viewport }, frame: { ...(i.reference as VisualEvidence).frame! } } } : m))
      })
    : decideVisualDiagnosis(i);
const absenceUnderUnproven: Decider = (i) => {
  const v = decideVisualDiagnosis(i);
  return v.observations.includes("inconclusive") ? { ...v, observations: v.observations.map((code) => (code === "inconclusive" ? "no-examined-identical" : code)) } : v;
};

const mutants: Array<[string, Outcome[], string?]> = [
  ["a difference is reported under unproven", evaluateSuite(differenceUnderUnproven, cases, PROPERTY_RUNS), "[table] a near-miss target reports no difference"],
  ["a recorded reference is inferred as proven", evaluateSuite(recordedInferredHeaded, cases, PROPERTY_RUNS), "[table] a recorded reference is still unproven"],
  ["truncation is ignored", evaluateSuite(truncationIgnored, cases, PROPERTY_RUNS), "[table] domNamed above the cap is truncated"],
  ["a count is read as uniqueness", evaluateSuite(countAsUniqueness, cases, PROPERTY_RUNS), "[table] two other examined members are identical"],
  ["the verdict names an index", evaluateSuite(leaksIndex, cases, PROPERTY_RUNS), "[table] one other examined member is identical"],
  ["an unknown refusal becomes an observation", evaluateSuite(unknownRefusalObserved, cases, PROPERTY_RUNS), "[table] an unknown caller refusal"],
  ["a protected capture is skipped instead of refusing", evaluateSuite(protectedIgnored, cases, PROPERTY_RUNS), "[table] a protected member capture refuses"],
  ["the provable conditions are not compared", evaluateSuite(conditionsIgnored, cases, PROPERTY_RUNS), "[table] DPR differs"],
  ["an absence is reported under unproven", evaluateSuite(absenceUnderUnproven, cases, PROPERTY_RUNS), "[table] no member identical stays inconclusive"],
  ["an empty case set", evaluateSuite(decideVisualDiagnosis, [], PROPERTY_RUNS), "the decision table holds"],
  ["a case set one short of the floor", evaluateSuite(decideVisualDiagnosis, cases.slice(0, TABLE_FLOOR - 1), PROPERTY_RUNS), "the decision table holds"],
  ["an empty property run", evaluateSuite(decideVisualDiagnosis, cases, 0), "the property run generated"]
];
const pinWithout = { ...VISUAL_DIAGNOSIS_EVIDENCE_KEYS } as Record<string, unknown>;
delete pinWithout.contextFingerprint;
mutants.push(["the evidence pin misses a field", pinOutcomes(pinWithout), "the evidence-key pin classifies"]);

for (const [name, outcomes, mustFail] of mutants) {
  const failing = outcomes.filter((o) => !o.ok).map((o) => o.label);
  const caughtBy = mustFail === undefined || failing.some((label) => label.startsWith(mustFail));
  check(`MUTATION: ${name} fails the suite (${failing.length} checks${mustFail ? `, including "${mustFail}"` : ""})`, failing.length > 0 && caughtBy, `the suite passed a mutant: ${failing.join("; ") || "nothing failed"}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
