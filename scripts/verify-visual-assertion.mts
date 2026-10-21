/**
 * verify:visual-assertion — Phase N, N6.2 (awkit-vra.15.2): the pure Visual Assertion decision policy
 * `decideVisualAssertion`.
 *
 * No browser, no page, no files beyond reading the policy's own source. Equality commitments are real HMAC-SHA256
 * values over the real `contentDigest` of synthetic images, computed here with a verifier-only key and the plan's
 * length-prefixed encoding, so "identical" and "one pixel differs" are genuine pixel facts, not hand-written strings.
 *
 * One suite covers:
 *   - a decision table: identity, a one-pixel and a near-miss commitment difference, size differences, every
 *     conditions field changed, position, clipping, hover and focus, every baseline status, malformed and missing
 *     commitments, every caller refusal (with an identical capture supplied, so a refusal can never become a pass),
 *     every N0 capture code against the plan's mapping, unknown codes, unsupported versions and malformed input;
 *   - shape invariants on every decision: exactly version, verdict and code, a vocabulary code, and the only verdict
 *     that code may carry;
 *   - a seeded property run checked against an INDEPENDENT oracle written from the plan's precedence, plus determinism
 *     and no input mutation;
 *   - pins: the N0 mapping, the conditions keys and the vocabulary equal the plan's lists; the index exports the policy;
 *   - purity: the policy imports only src/visual siblings and uses no I/O, key, clock or randomness.
 *
 * The same suite is then run against mutants, each of which must make it FAIL.
 *
 * Run: npm run verify:visual-assertion
 */

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  VISUAL_ASSERTION_CAPTURE_CODES,
  VISUAL_ASSERTION_CODES,
  VISUAL_ASSERTION_CONDITION_KEYS,
  VISUAL_ASSERTION_POLICY_VERSION,
  VISUAL_ASSERTION_REFUSALS,
  decideVisualAssertion,
  type VisualAssertionBaseline,
  type VisualAssertionCode,
  type VisualAssertionConditions,
  type VisualAssertionDecision,
  type VisualAssertionGeometry,
  type VisualAssertionInput,
  type VisualAssertionObservation,
  type VisualAssertionVerdictKind
} from "@src/visual/assertion/decideVisualAssertion";
import type { VisualErrorCode } from "@src/visual/errors";
import { VISUAL_FINGERPRINT_VERSION, fingerprintVisualImage } from "@src/visual/fingerprint";
import { VisualImage } from "@src/visual/png";
import * as visualIndex from "@src/visual";

/** Hardcoded floors. Raising the case count is fine; dropping below these fails the suite. */
const TABLE_FLOOR = 80;
const PROPERTY_RUNS = 6000;
const MIN_PASSED = 300;
const MIN_FAILED = 300;
const MIN_INCONCLUSIVE = 1500;
const MIN_REFUSED = 200;

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

type Decider = (input: VisualAssertionInput) => VisualAssertionDecision;
interface Outcome {
  label: string;
  ok: boolean;
  detail?: string;
}
interface Case {
  label: string;
  input: VisualAssertionInput;
  verdict: VisualAssertionVerdictKind;
  code: VisualAssertionCode;
}

// ── The plan's own lists, written out independently of the policy module ──────────────────────────────────────────

const PLAN_VOCABULARY: Record<string, VisualAssertionVerdictKind> = {
  "identical-to-baseline": "passed",
  "differs-from-baseline": "failed",
  "size-differs-from-baseline": "failed",
  "no-baseline": "inconclusive",
  "baseline-other-conditions": "inconclusive",
  "binding-changed": "inconclusive",
  "baseline-unreadable": "inconclusive",
  "integrity-unavailable": "inconclusive",
  "position-changed": "inconclusive",
  "target-clipped": "inconclusive",
  "interaction-state-changed": "inconclusive",
  "target-not-found": "inconclusive",
  "target-not-unique": "inconclusive",
  "target-hidden": "inconclusive",
  "target-offscreen": "inconclusive",
  "protected-surface": "inconclusive",
  "handoff-active": "inconclusive",
  "sensitive-step": "inconclusive",
  "capture-stale": "inconclusive",
  "capture-unavailable": "inconclusive",
  "budget-exhausted": "inconclusive",
  "cancelled": "inconclusive",
  "page-closed": "inconclusive"
};

/** Plan, "N0 mapping (`errors.ts:9-40`)". */
const PLAN_N0_MAPPING: Record<VisualErrorCode, string> = {
  TARGET_STALE: "capture-stale",
  CAPTURE_STALE: "capture-stale",
  TARGET_NOT_UNIQUE: "target-not-unique",
  TARGET_OFFSCREEN: "target-offscreen",
  INVALID_BOUNDS: "target-hidden",
  FRAME_MAPPING_FAILED: "capture-unavailable",
  CAPTURE_UNAVAILABLE: "capture-unavailable",
  FINGERPRINT_FAILED: "capture-unavailable",
  IMAGE_DECODE_FAILED: "capture-unavailable",
  UNSUPPORTED_FINGERPRINT_VERSION: "baseline-unreadable",
  PAGE_CLOSED: "page-closed",
  BUDGET_EXHAUSTED: "budget-exhausted",
  CANCELLED: "cancelled",
  PROTECTED_SURFACE: "protected-surface"
};

/** Plan, "Conditions key". */
const PLAN_CONDITION_KEYS = [
  "renderMode",
  "browserVersion",
  "appVersion",
  "osBuild",
  "devicePixelRatio",
  "cssWidth",
  "cssHeight",
  "colorScheme",
  "forcedColors",
  "reducedMotion",
  "locale",
  "timeZone",
  "frameDepth",
  "isMainFrame",
  "capturePolicy",
  "fingerprintVersion",
  "assertionPolicyVersion"
] as const;
type ConditionKey = (typeof PLAN_CONDITION_KEYS)[number];
const VERSION_KEYS: readonly ConditionKey[] = ["fingerprintVersion", "assertionPolicyVersion"];
const COMPARED_KEYS = PLAN_CONDITION_KEYS.filter((key) => !VERSION_KEYS.includes(key));
const PLAN_REFUSALS = ["protected-surface", "handoff-active", "sensitive-step", "target-not-found", "target-not-unique", "target-hidden", "target-offscreen"];
const N0_CODES = Object.keys(PLAN_N0_MAPPING) as VisualErrorCode[];

// ── Real pixel facts ─────────────────────────────────────────────────────────────────────────────────────────────

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
function digestOf(image: VisualImage): { digest: string; width: number; height: number } {
  const result = fingerprintVisualImage(image);
  if (!result.ok) throw new Error(`synthetic fingerprint failed: ${result.code}`);
  return { digest: result.value.contentDigest, width: result.value.width, height: result.value.height };
}
const button = (x: number, y: number): number => (x >= 8 && x < 40 && y >= 10 && y < 30 ? 30 : 200 - x);
const PIXELS = {
  baseline: digestOf(paint(button)),
  same: digestOf(paint(button)),
  onePixel: digestOf(paint((x, y) => (x === 20 && y === 20 ? 31 : button(x, y)))),
  wider: digestOf(paint(button, W + 2, H))
};

/** Verifier-only stand-in for the N6.3 keyed layer: the plan's commitment over a synthetic key. Never a product key. */
const TEST_KEY = Buffer.from("verify-visual-assertion synthetic key, not a product secret");
function commitment(pixels: { digest: string; width: number; height: number }): string {
  const fields = ["awkit-n6-commit-v1", "flow-va", "step-1", "step-content", "conditions-key", "epoch-1", String(pixels.width), String(pixels.height), pixels.digest];
  const mac = createHmac("sha256", TEST_KEY);
  for (const field of fields) {
    const bytes = Buffer.from(field, "utf8");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    mac.update(length);
    mac.update(bytes);
  }
  return mac.digest("hex");
}
const COMMIT = {
  baseline: commitment(PIXELS.baseline),
  same: commitment(PIXELS.same),
  onePixel: commitment(PIXELS.onePixel),
  wider: commitment(PIXELS.wider)
};
/** Equal except in the last hex character: catches any prefix or early-exit comparison. */
const NEAR_MISS = COMMIT.baseline.slice(0, 63) + (COMMIT.baseline.endsWith("0") ? "1" : "0");

// ── Input builders ───────────────────────────────────────────────────────────────────────────────────────────────

function conditions(): VisualAssertionConditions {
  return {
    renderMode: "headless",
    browserVersion: "Chromium 140.0.7339.16",
    appVersion: "0.1.53",
    osBuild: "10.0.26300",
    devicePixelRatio: 1,
    cssWidth: 1280,
    cssHeight: 720,
    colorScheme: "light",
    forcedColors: "none",
    reducedMotion: "no-preference",
    locale: "en-US",
    timeZone: "UTC",
    frameDepth: 0,
    isMainFrame: true,
    capturePolicy: "awkit-va15-v1",
    fingerprintVersion: VISUAL_FINGERPRINT_VERSION,
    assertionPolicyVersion: VISUAL_ASSERTION_POLICY_VERSION
  };
}
function geometry(): VisualAssertionGeometry {
  return { x: 40, y: 64, width: W, height: H, clipped: false, hover: false, focus: false };
}
function observation(commit = COMMIT.same): VisualAssertionObservation {
  return { conditions: conditions(), geometry: geometry(), commitment: commit };
}
/** An identical, passing input: present baseline, equal conditions, geometry, state and pixels. */
function base(): VisualAssertionInput {
  return {
    version: 1,
    capture: { ok: true, observation: observation() },
    baseline: { status: "present", ...observation(COMMIT.baseline) }
  };
}
const clone = <T,>(value: T): T => structuredClone(value);
function current(input: VisualAssertionInput): VisualAssertionObservation {
  if (!input.capture || input.capture.ok !== true) throw new Error("no current observation");
  return input.capture.observation;
}
function present(input: VisualAssertionInput): VisualAssertionObservation {
  if (!input.baseline || input.baseline.status !== "present") throw new Error("no present baseline");
  return input.baseline;
}
function edit(fn: (input: VisualAssertionInput) => void): VisualAssertionInput {
  const input = base();
  fn(input);
  return input;
}
/** A different, still valid value of the same kind. */
function alter(key: ConditionKey, value: unknown): unknown {
  switch (key) {
    case "renderMode":
      return value === "headless" ? "headed" : "headless";
    case "colorScheme":
      return value === "light" ? "dark" : "light";
    case "forcedColors":
      return value === "none" ? "active" : "none";
    case "reducedMotion":
      return value === "reduce" ? "no-preference" : "reduce";
    case "isMainFrame":
      return !value;
    case "devicePixelRatio":
      return (value as number) + 0.25;
    case "cssWidth":
    case "cssHeight":
    case "frameDepth":
    case "assertionPolicyVersion":
      return (value as number) + 1;
    default:
      return `${value as string}-x`;
  }
}
function setCondition(target: VisualAssertionObservation, key: ConditionKey): void {
  (target.conditions as unknown as Record<string, unknown>)[key] = alter(key, target.conditions[key]);
}

// ── The decision table ───────────────────────────────────────────────────────────────────────────────────────────

function buildCases(): Case[] {
  const cases: Case[] = [];
  const add = (label: string, input: VisualAssertionInput, code: VisualAssertionCode): void => {
    cases.push({ label, input, code, verdict: PLAN_VOCABULARY[code] });
  };

  // 1-3: the only pass, and the proven differences.
  add("identical pixels under equal conditions pass", base(), "identical-to-baseline");
  add("one pixel differs", edit((i) => (current(i).commitment = COMMIT.onePixel)), "differs-from-baseline");
  add("near-miss commitment (last character)", edit((i) => (current(i).commitment = NEAR_MISS)), "differs-from-baseline");
  add(
    "width differs at the same position",
    edit((i) => {
      current(i).geometry.width = W + 2;
      current(i).commitment = COMMIT.wider;
    }),
    "size-differs-from-baseline"
  );
  add("height differs at the same position", edit((i) => (current(i).geometry.height = H + 3)), "size-differs-from-baseline");
  add("size differs with identical commitments is still a size failure", edit((i) => (present(i).geometry.width = W - 1)), "size-differs-from-baseline");

  // 4-6: every compared conditions field, on either side, is never a guessed mismatch.
  const named: Partial<Record<ConditionKey, string>> = {
    browserVersion: "browser version differs",
    appVersion: "app version differs",
    osBuild: "OS build differs",
    devicePixelRatio: "DPR differs",
    cssWidth: "viewport width differs",
    cssHeight: "viewport height differs",
    locale: "locale differs",
    timeZone: "time zone differs"
  };
  for (const key of COMPARED_KEYS) {
    add(named[key] ?? `${key} differs`, edit((i) => setCondition(current(i), key)), "baseline-other-conditions");
    add(`${key} differs on the baseline side`, edit((i) => setCondition(present(i), key)), "baseline-other-conditions");
    add(`${key} differs with a one-pixel difference too`, edit((i) => {
      setCondition(current(i), key);
      current(i).commitment = COMMIT.onePixel;
    }), "baseline-other-conditions");
  }
  // 17: unsupported versions.
  add("current fingerprint version unsupported", edit((i) => setCondition(current(i), "fingerprintVersion")), "capture-unavailable");
  add("current assertion policy version unsupported", edit((i) => setCondition(current(i), "assertionPolicyVersion")), "capture-unavailable");
  add("baseline fingerprint version unsupported", edit((i) => setCondition(present(i), "fingerprintVersion")), "baseline-unreadable");
  add("baseline assertion policy version unsupported", edit((i) => setCondition(present(i), "assertionPolicyVersion")), "baseline-unreadable");
  add("input version unsupported", { ...base(), version: 2 as 1 }, "capture-unavailable");

  // 7-9: geometry and state are never a guessed mismatch.
  add("position x changed", edit((i) => (current(i).geometry.x += 1)), "position-changed");
  add("position y changed", edit((i) => (current(i).geometry.y -= 0.5)), "position-changed");
  add("position and size changed", edit((i) => {
    current(i).geometry.x += 10;
    current(i).geometry.width += 2;
    current(i).commitment = COMMIT.wider;
  }), "position-changed");
  add("position changed with a one-pixel difference", edit((i) => {
    current(i).geometry.y += 4;
    current(i).commitment = COMMIT.onePixel;
  }), "position-changed");
  add("clipped target", edit((i) => (current(i).geometry.clipped = true)), "target-clipped");
  add("clipped target with a one-pixel difference", edit((i) => {
    current(i).geometry.clipped = true;
    current(i).commitment = COMMIT.onePixel;
  }), "target-clipped");
  add("clipped target with no baseline never becomes no-baseline", edit((i) => {
    current(i).geometry.clipped = true;
    i.baseline = { status: "absent" };
  }), "target-clipped");
  add("clipped baseline is not readable", edit((i) => (present(i).geometry.clipped = true)), "baseline-unreadable");
  add("hover changed", edit((i) => (current(i).geometry.hover = true)), "interaction-state-changed");
  add("focus changed", edit((i) => (current(i).geometry.focus = true)), "interaction-state-changed");
  add("hover changed with a one-pixel difference", edit((i) => {
    present(i).geometry.hover = true;
    current(i).commitment = COMMIT.onePixel;
  }), "interaction-state-changed");
  add("focus changed with a size difference", edit((i) => {
    current(i).geometry.focus = true;
    current(i).geometry.height += 1;
  }), "interaction-state-changed");

  // 10-12: baseline evidence.
  add("missing baseline", edit((i) => (i.baseline = { status: "absent" })), "no-baseline");
  add("baseline for other conditions only", edit((i) => (i.baseline = { status: "other-conditions" })), "baseline-other-conditions");
  add("binding changed", edit((i) => (i.baseline = { status: "binding-changed" })), "binding-changed");
  add("baseline unreadable", edit((i) => (i.baseline = { status: "unreadable" })), "baseline-unreadable");
  add("integrity unavailable", edit((i) => (i.baseline = { status: "integrity-unavailable" })), "integrity-unavailable");
  add("unknown baseline status", edit((i) => (i.baseline = { status: "restored" } as unknown as VisualAssertionBaseline)), "baseline-unreadable");
  add("baseline omitted", edit((i) => delete i.baseline), "baseline-unreadable");
  add("baseline null", edit((i) => (i.baseline = null as unknown as VisualAssertionBaseline)), "baseline-unreadable");
  add("baseline record without conditions", edit((i) => delete (present(i) as Partial<VisualAssertionObservation>).conditions), "baseline-unreadable");
  add("baseline record with a malformed conditions field", edit((i) => ((present(i).conditions as unknown as Record<string, unknown>).locale = "")), "baseline-unreadable");
  add("baseline record with zero width", edit((i) => (present(i).geometry.width = 0)), "baseline-unreadable");
  add("baseline commitment missing", edit((i) => delete (present(i) as Partial<VisualAssertionObservation>).commitment), "baseline-unreadable");
  add("baseline commitment truncated", edit((i) => (present(i).commitment = COMMIT.baseline.slice(0, 63))), "baseline-unreadable");
  add("current commitment missing", edit((i) => delete (current(i) as Partial<VisualAssertionObservation>).commitment), "capture-unavailable");
  add("current commitment upper-case", edit((i) => (current(i).commitment = COMMIT.same.toUpperCase())), "capture-unavailable");
  add("current commitment not a string", edit((i) => (current(i).commitment = 42 as unknown as string)), "capture-unavailable");

  // 13: refusals never compare, even with an identical capture supplied.
  for (const refusal of PLAN_REFUSALS) {
    add(`${refusal} refusal with an identical capture`, { ...base(), refusal: refusal as VisualAssertionInput["refusal"] }, refusal as VisualAssertionCode);
    add(`${refusal} refusal with no capture`, { version: 1, refusal: refusal as VisualAssertionInput["refusal"] }, refusal as VisualAssertionCode);
  }
  add("an unknown caller refusal", { ...base(), refusal: "allowed" as VisualAssertionInput["refusal"] }, "capture-unavailable");

  // 13-17: every N0 capture code against the plan's mapping, then unknown and malformed captures.
  for (const code of N0_CODES) add(`N0 ${code}`, edit((i) => (i.capture = { ok: false, code })), PLAN_N0_MAPPING[code] as VisualAssertionCode);
  add("N0 PROTECTED_SURFACE with no baseline", { version: 1, capture: { ok: false, code: "PROTECTED_SURFACE" } }, "protected-surface");
  add("unknown capture code", edit((i) => (i.capture = { ok: false, code: "SCREENSHOT_TIMEOUT" as VisualErrorCode })), "capture-unavailable");
  add("capture without ok", edit((i) => (i.capture = { observation: observation() } as unknown as VisualAssertionInput["capture"])), "capture-unavailable");
  add("capture omitted", edit((i) => delete i.capture), "capture-unavailable");
  add("capture with a NaN x", edit((i) => (current(i).geometry.x = Number.NaN)), "capture-unavailable");
  add("capture with an infinite height", edit((i) => (current(i).geometry.height = Number.POSITIVE_INFINITY)), "capture-unavailable");
  add("capture with a non-boolean hover", edit((i) => ((current(i).geometry as unknown as Record<string, unknown>).hover = "no")), "capture-unavailable");
  add("capture with an over-long condition", edit((i) => (current(i).conditions.browserVersion = "x".repeat(257))), "capture-unavailable");
  add("capture with an unknown render mode", edit((i) => ((current(i).conditions as unknown as Record<string, unknown>).renderMode = "offscreen")), "capture-unavailable");
  add("capture with a missing conditions field", edit((i) => delete (current(i).conditions as Partial<VisualAssertionConditions>).timeZone), "capture-unavailable");
  add("null input", null as unknown as VisualAssertionInput, "capture-unavailable");
  add("string input", "passed" as unknown as VisualAssertionInput, "capture-unavailable");
  add("input whose getter throws", Object.defineProperty({ version: 1 }, "capture", { get() { throw new Error("boom"); }, enumerable: true }) as VisualAssertionInput, "capture-unavailable");
  return cases;
}

// ── Independent oracle for the property run ──────────────────────────────────────────────────────────────────────

interface Facts {
  refusal: string | null;
  captureCode: string | null;
  clipped: boolean;
  status: string;
  conditionChange: { key: ConditionKey; side: "current" | "baseline" } | null;
  hover: boolean;
  focus: boolean;
  moved: boolean;
  resized: boolean;
  pixels: "same" | "onePixel" | "nearMiss";
}

function oracle(f: Facts): string {
  if (f.refusal !== null) return PLAN_REFUSALS.includes(f.refusal) ? f.refusal : "capture-unavailable";
  if (f.captureCode !== null) return (PLAN_N0_MAPPING as Record<string, string>)[f.captureCode] ?? "capture-unavailable";
  if (f.clipped) return "target-clipped";
  if (f.status !== "present") {
    return { absent: "no-baseline", "other-conditions": "baseline-other-conditions", "binding-changed": "binding-changed", unreadable: "baseline-unreadable", "integrity-unavailable": "integrity-unavailable" }[f.status] ?? "baseline-unreadable";
  }
  if (f.conditionChange) return "baseline-other-conditions";
  if (f.hover || f.focus) return "interaction-state-changed";
  if (f.moved) return "position-changed";
  if (f.resized) return "size-differs-from-baseline";
  return f.pixels === "same" ? "identical-to-baseline" : "differs-from-baseline";
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

function generate(random: () => number): { facts: Facts; input: VisualAssertionInput } {
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  const facts: Facts = {
    refusal: random() < 0.12 ? pick([...PLAN_REFUSALS, "unknown-refusal"]) : null,
    captureCode: random() < 0.12 ? pick([...N0_CODES, "UNKNOWN_CODE"]) : null,
    clipped: random() < 0.08,
    status: random() < 0.75 ? "present" : pick(["absent", "other-conditions", "binding-changed", "unreadable", "integrity-unavailable", "bogus"]),
    conditionChange: random() < 0.25 ? { key: pick(COMPARED_KEYS), side: random() < 0.5 ? "current" : "baseline" } : null,
    hover: random() < 0.08,
    focus: random() < 0.08,
    moved: random() < 0.12,
    resized: random() < 0.15,
    pixels: pick(["same", "same", "onePixel", "nearMiss"] as const)
  };
  const input = base();
  const now = current(input);
  const then = present(input);
  now.commitment = facts.pixels === "same" ? COMMIT.same : facts.pixels === "onePixel" ? COMMIT.onePixel : NEAR_MISS;
  if (facts.clipped) now.geometry.clipped = true;
  if (facts.conditionChange) setCondition(facts.conditionChange.side === "current" ? now : then, facts.conditionChange.key);
  if (facts.hover) now.geometry.hover = true;
  if (facts.focus) then.geometry.focus = true;
  if (facts.moved) now.geometry.x += 1 + Math.floor(random() * 30);
  if (facts.resized) now.geometry.height += 1 + Math.floor(random() * 5);
  if (facts.status !== "present") input.baseline = { status: facts.status } as VisualAssertionBaseline;
  if (facts.captureCode !== null) input.capture = { ok: false, code: facts.captureCode as VisualErrorCode };
  if (facts.refusal !== null) input.refusal = facts.refusal as VisualAssertionInput["refusal"];
  return { facts, input };
}

// ── The suite ────────────────────────────────────────────────────────────────────────────────────────────────────

function shapeProblem(decision: unknown): string | null {
  if (!decision || typeof decision !== "object") return "not an object";
  const keys = Object.keys(decision).sort().join(",");
  if (keys !== "code,verdict,version") return `keys ${keys}`;
  const d = decision as VisualAssertionDecision;
  if (d.version !== 1) return `version ${String(d.version)}`;
  if (!Object.prototype.hasOwnProperty.call(PLAN_VOCABULARY, d.code)) return `code ${String(d.code)} outside the vocabulary`;
  if (PLAN_VOCABULARY[d.code] !== d.verdict) return `${d.code} carries ${String(d.verdict)}`;
  return null;
}

function safely(decider: Decider, input: VisualAssertionInput): VisualAssertionDecision | { threw: string } {
  try {
    return decider(input);
  } catch (error) {
    return { threw: (error as Error).message };
  }
}

function evaluateSuite(decider: Decider, cases: Case[], runs: number): Outcome[] {
  const outcomes: Outcome[] = [];
  outcomes.push({ label: "the decision table holds the floor", ok: cases.length >= TABLE_FLOOR, detail: `${cases.length} < ${TABLE_FLOOR}` });
  for (const c of cases) {
    // An input with an accessor (the throwing-getter case) is passed as-is; every other input is decided on a copy
    // whose serialization is compared before and after, so a mutating policy is caught.
    const accessor = !!c.input && typeof c.input === "object" && Object.values(Object.getOwnPropertyDescriptors(c.input)).some((d) => d.get);
    const input = accessor ? c.input : clone(c.input);
    const before = accessor ? null : JSON.stringify(input);
    const decision = safely(decider, input);
    const problem = "threw" in decision ? `threw ${decision.threw}` : shapeProblem(decision);
    const ok = problem === null && (decision as VisualAssertionDecision).code === c.code && (decision as VisualAssertionDecision).verdict === c.verdict;
    outcomes.push({ label: `[table] ${c.label}`, ok, detail: problem ?? `got ${(decision as VisualAssertionDecision).verdict}/${(decision as VisualAssertionDecision).code}, want ${c.verdict}/${c.code}` });
    if (before !== null) outcomes.push({ label: `[table] ${c.label} leaves its input unchanged`, ok: JSON.stringify(input) === before });
  }

  const random = mulberry32(0x5eed_0622);
  const counts = { passed: 0, failed: 0, inconclusive: 0, refused: 0 };
  const disagreements: string[] = [];
  const shapes: string[] = [];
  const unstable: string[] = [];
  for (let run = 0; run < runs; run += 1) {
    const { facts, input } = generate(random);
    const first = safely(decider, clone(input));
    const second = safely(decider, clone(input));
    const want = oracle(facts);
    if ("threw" in first) {
      disagreements.push(`run ${run} threw`);
      continue;
    }
    const problem = shapeProblem(first);
    if (problem) shapes.push(`run ${run}: ${problem}`);
    if (first.code !== want) disagreements.push(`run ${run}: got ${first.code}, oracle ${want} (${JSON.stringify(facts)})`);
    if (JSON.stringify(first) !== JSON.stringify(second)) unstable.push(`run ${run}`);
    counts[first.verdict] += 1;
    if (facts.refusal !== null) counts.refused += 1;
  }
  outcomes.push({ label: "the property run generated", ok: runs > 0 && counts.passed + counts.failed + counts.inconclusive === runs, detail: `${runs} runs` });
  outcomes.push({ label: "[property] every decision matches the independent oracle", ok: runs > 0 && disagreements.length === 0, detail: disagreements.slice(0, 3).join("; ") });
  outcomes.push({ label: "[property] every decision has the closed shape", ok: shapes.length === 0, detail: shapes.slice(0, 3).join("; ") });
  outcomes.push({ label: "[property] replay is deterministic", ok: unstable.length === 0, detail: unstable.slice(0, 3).join("; ") });
  outcomes.push({ label: `[property] at least ${MIN_PASSED} passed`, ok: counts.passed >= MIN_PASSED, detail: String(counts.passed) });
  outcomes.push({ label: `[property] at least ${MIN_FAILED} failed`, ok: counts.failed >= MIN_FAILED, detail: String(counts.failed) });
  outcomes.push({ label: `[property] at least ${MIN_INCONCLUSIVE} inconclusive`, ok: counts.inconclusive >= MIN_INCONCLUSIVE, detail: String(counts.inconclusive) });
  outcomes.push({ label: `[property] at least ${MIN_REFUSED} refused runs`, ok: counts.refused >= MIN_REFUSED, detail: String(counts.refused) });
  return outcomes;
}

// ── Preconditions, pins and purity ───────────────────────────────────────────────────────────────────────────────

console.log("verify:visual-assertion — N6.2 pure visual assertion policy\n");

check("precondition: independent paints of the same pixels share a contentDigest and a commitment", PIXELS.same.digest === PIXELS.baseline.digest && COMMIT.same === COMMIT.baseline);
check("precondition: one changed pixel changes the digest and the commitment", PIXELS.onePixel.digest !== PIXELS.baseline.digest && COMMIT.onePixel !== COMMIT.baseline);
check("precondition: the near miss differs only in its last character", NEAR_MISS !== COMMIT.baseline && NEAR_MISS.slice(0, 63) === COMMIT.baseline.slice(0, 63));
check("precondition: every commitment is lowercase 64-hex", [COMMIT.baseline, COMMIT.onePixel, COMMIT.wider, NEAR_MISS].every((c) => /^[0-9a-f]{64}$/.test(c)));

const vocabulary = Object.entries(VISUAL_ASSERTION_CODES).sort().map(([code, verdict]) => `${code}:${verdict}`).join(",");
const planVocabulary = Object.entries(PLAN_VOCABULARY).sort().map(([code, verdict]) => `${code}:${verdict}`).join(",");
check("pin: the vocabulary and its verdicts equal the plan's", vocabulary === planVocabulary, vocabulary);
check("pin: only identical-to-baseline can pass", Object.entries(VISUAL_ASSERTION_CODES).filter(([, v]) => v === "passed").map(([c]) => c).join() === "identical-to-baseline");
check("pin: the refusals equal the plan's", [...VISUAL_ASSERTION_REFUSALS].sort().join() === [...PLAN_REFUSALS].sort().join());
const mapping = Object.entries(VISUAL_ASSERTION_CAPTURE_CODES).sort().map(([k, v]) => `${k}:${v}`).join(",");
const planMapping = Object.entries(PLAN_N0_MAPPING).sort().map(([k, v]) => `${k}:${v}`).join(",");
check("pin: the N0 capture mapping equals the plan's (all 14 codes)", mapping === planMapping && N0_CODES.length === 14, mapping);
check("pin: the conditions keys equal the plan's 17", Object.keys(VISUAL_ASSERTION_CONDITION_KEYS).sort().join() === [...PLAN_CONDITION_KEYS].sort().join(), Object.keys(VISUAL_ASSERTION_CONDITION_KEYS).join());
check("the policy is exported through the src/visual index", visualIndex.decideVisualAssertion === decideVisualAssertion);

const source = readFileSync(join(process.cwd(), "src", "visual", "assertion", "decideVisualAssertion.ts"), "utf8");
const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
check("purity: the policy imports only ../errors (types) and ../fingerprint", imports.length === 2 && imports.every((spec) => ["../errors", "../fingerprint"].includes(spec)), imports.join(", "));
check("purity: the errors import is type-only", /import type \{[^}]*\} from "\.\.\/errors"/.test(source));
check("purity: no I/O, key, clock, randomness or dynamic import", !/\b(node:|require\(|import\(|Date\.|new Date|Math\.random|performance\.|process\.|setTimeout|fetch\(|createHmac|crypto|readFile|writeFile)/.test(source));
check("purity: nothing that can capture, retry or act", !/\b(capture(Element|Viewport|Candidates|VisualFrame)|captureCore|protectedGuard|click|fill|locator|retry|approve)\s*\(/.test(source));
check("purity: no score, threshold or tolerance", !/\b(score|threshold|tolerance|similarity|distance)\b/i.test(source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")));

const cases = buildCases();
for (const outcome of evaluateSuite(decideVisualAssertion, cases, PROPERTY_RUNS)) check(outcome.label, outcome.ok, outcome.ok ? undefined : outcome.detail);

// ── Mutants ──────────────────────────────────────────────────────────────────────────────────────────────────────

console.log("\n  mutants (each must FAIL the suite)");

const hasBoth = (i: VisualAssertionInput): boolean =>
  !!i && typeof i === "object" && i.capture?.ok === true && !!i.capture.observation?.conditions && i.baseline?.status === "present" && !!i.baseline.conditions;
const decision = (code: VisualAssertionCode): VisualAssertionDecision => ({ version: 1, verdict: VISUAL_ASSERTION_CODES[code], code });

const conditionsGateBroken: Decider = (i) => {
  if (!hasBoth(i)) return decideVisualAssertion(i);
  const copy = clone(i);
  const versions = { fingerprintVersion: present(copy).conditions.fingerprintVersion, assertionPolicyVersion: present(copy).conditions.assertionPolicyVersion };
  present(copy).conditions = { ...current(copy).conditions, ...versions };
  return decideVisualAssertion(copy);
};
const positionIgnored: Decider = (i) => {
  if (!hasBoth(i) || !current(i).geometry || !present(i).geometry) return decideVisualAssertion(i);
  const copy = clone(i);
  present(copy).geometry.x = current(copy).geometry.x;
  present(copy).geometry.y = current(copy).geometry.y;
  return decideVisualAssertion(copy);
};
const clippingIgnored: Decider = (i) => {
  if (!i || typeof i !== "object" || i.capture?.ok !== true || !i.capture.observation?.geometry) return decideVisualAssertion(i);
  const copy = clone(i);
  current(copy).geometry.clipped = false;
  return decideVisualAssertion(copy);
};
const interactionIgnored: Decider = (i) => {
  if (!hasBoth(i) || !current(i).geometry || !present(i).geometry) return decideVisualAssertion(i);
  const copy = clone(i);
  present(copy).geometry.hover = current(copy).geometry.hover;
  present(copy).geometry.focus = current(copy).geometry.focus;
  return decideVisualAssertion(copy);
};
const sizeRuleIgnored: Decider = (i) => {
  if (!hasBoth(i) || !current(i).geometry || !present(i).geometry) return decideVisualAssertion(i);
  const copy = clone(i);
  present(copy).geometry.width = current(copy).geometry.width;
  present(copy).geometry.height = current(copy).geometry.height;
  return decideVisualAssertion(copy);
};
const prefixCommitment: Decider = (i) => {
  if (!hasBoth(i) || typeof current(i).commitment !== "string" || typeof present(i).commitment !== "string") return decideVisualAssertion(i);
  const copy = clone(i);
  if (current(copy).commitment.slice(0, 16) === present(copy).commitment.slice(0, 16)) current(copy).commitment = present(copy).commitment;
  return decideVisualAssertion(copy);
};
const commitmentIgnored: Decider = (i) => {
  if (!hasBoth(i) || typeof present(i).commitment !== "string") return decideVisualAssertion(i);
  const copy = clone(i);
  current(copy).commitment = present(copy).commitment;
  return decideVisualAssertion(copy);
};
const protectedRefusalDropped: Decider = (i) => {
  if (!i || typeof i !== "object" || i.refusal !== "protected-surface") return decideVisualAssertion(i);
  const copy = clone(i);
  delete copy.refusal;
  return decideVisualAssertion(copy);
};
const protectedCaptureAsStale: Decider = (i) => {
  if (!i || typeof i !== "object" || i.capture?.ok !== false || i.capture.code !== "PROTECTED_SURFACE") return decideVisualAssertion(i);
  return decideVisualAssertion({ ...i, capture: { ok: false, code: "CAPTURE_STALE" } });
};
const integrityGateBroken: Decider = (i) => {
  if (!i || typeof i !== "object" || i.capture?.ok !== true || !i.baseline || !["unreadable", "integrity-unavailable"].includes(i.baseline.status)) return decideVisualAssertion(i);
  const copy = clone(i);
  copy.baseline = { status: "present", ...clone(current(copy)), commitment: current(copy).commitment };
  return decideVisualAssertion(copy);
};
const fallbackBroken: Decider = (i) => {
  const d = decideVisualAssertion(i);
  return d.code === "capture-unavailable" ? decision("differs-from-baseline") : d;
};
const unsupportedVersionAccepted: Decider = (i) => {
  if (!hasBoth(i)) return decideVisualAssertion(i);
  const copy = clone(i);
  present(copy).conditions.fingerprintVersion = current(copy).conditions.fingerprintVersion;
  present(copy).conditions.assertionPolicyVersion = current(copy).conditions.assertionPolicyVersion;
  return decideVisualAssertion(copy);
};
const throwsOnMalformed: Decider = (i) => {
  if (!i || typeof i !== "object") throw new Error("malformed input");
  return decideVisualAssertion(i);
};
const leaksCommitment: Decider = (i) => {
  const d = decideVisualAssertion(i);
  return d.verdict === "passed" ? ({ ...d, commitment: COMMIT.baseline } as VisualAssertionDecision) : d;
};
const unknownCodeAsStale: Decider = (i) => {
  const d = decideVisualAssertion(i);
  return i && typeof i === "object" && i.capture?.ok === false && !N0_CODES.includes(i.capture.code) ? decision("capture-stale") : d;
};

const mutants: Array<[string, Outcome[], string]> = [
  ["the conditions equality gate is broken", evaluateSuite(conditionsGateBroken, cases, PROPERTY_RUNS), "[table] browser version differs"],
  ["the position gate is ignored", evaluateSuite(positionIgnored, cases, PROPERTY_RUNS), "[table] position x changed"],
  ["clipping is ignored", evaluateSuite(clippingIgnored, cases, PROPERTY_RUNS), "[table] clipped target"],
  ["hover and focus are ignored", evaluateSuite(interactionIgnored, cases, PROPERTY_RUNS), "[table] hover changed"],
  ["the size rule is ignored", evaluateSuite(sizeRuleIgnored, cases, PROPERTY_RUNS), "[table] width differs at the same position"],
  ["commitments compared by prefix", evaluateSuite(prefixCommitment, cases, PROPERTY_RUNS), "[table] near-miss commitment (last character)"],
  ["commitments not compared", evaluateSuite(commitmentIgnored, cases, PROPERTY_RUNS), "[table] one pixel differs"],
  ["the protected-surface refusal is dropped", evaluateSuite(protectedRefusalDropped, cases, PROPERTY_RUNS), "[table] protected-surface refusal with an identical capture"],
  ["a protected capture is read as stale", evaluateSuite(protectedCaptureAsStale, cases, PROPERTY_RUNS), "[table] N0 PROTECTED_SURFACE"],
  ["the baseline integrity gate is broken", evaluateSuite(integrityGateBroken, cases, PROPERTY_RUNS), "[table] baseline unreadable"],
  ["the inconclusive fallback reports a mismatch", evaluateSuite(fallbackBroken, cases, PROPERTY_RUNS), "[table] unknown capture code"],
  ["an unknown capture code is guessed", evaluateSuite(unknownCodeAsStale, cases, PROPERTY_RUNS), "[table] unknown capture code"],
  ["an unsupported baseline version is accepted", evaluateSuite(unsupportedVersionAccepted, cases, PROPERTY_RUNS), "[table] baseline fingerprint version unsupported"],
  ["malformed input throws", evaluateSuite(throwsOnMalformed, cases, PROPERTY_RUNS), "[table] null input"],
  ["a decision carries the commitment", evaluateSuite(leaksCommitment, cases, PROPERTY_RUNS), "[table] identical pixels under equal conditions pass"],
  ["an empty case set", evaluateSuite(decideVisualAssertion, [], PROPERTY_RUNS), "the decision table holds the floor"],
  ["a case set one short of the floor", evaluateSuite(decideVisualAssertion, cases.slice(0, TABLE_FLOOR - 1), PROPERTY_RUNS), "the decision table holds the floor"],
  ["an empty property run", evaluateSuite(decideVisualAssertion, cases, 0), "the property run generated"]
];

for (const [name, outcomes, mustFail] of mutants) {
  const failing = outcomes.filter((o) => !o.ok).map((o) => o.label);
  const caughtBy = failing.some((label) => label.startsWith(mustFail));
  check(`MUTATION: ${name} fails the suite (${failing.length} checks, including "${mustFail}")`, failing.length > 0 && caughtBy, `the suite passed a mutant: ${failing.slice(0, 5).join("; ") || "nothing failed"}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
