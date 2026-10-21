import type { VisualErrorCode } from "../errors";
import { VISUAL_FINGERPRINT_VERSION } from "../fingerprint";

/**
 * Visual Assertion decision policy (Phase N, N6.2 / awkit-vra.15.2). PURE: no I/O, no clock, no randomness, no page, no
 * key, no model. Plan: docs/plans/ai-upgrade-v5/N6-visual-assertions.md, owner decisions VA-0 to VA-16 as ratified
 * (DECISIONS 2026-10-22).
 *
 * A VERDICT, NOT A STEP STATUS. `passed`, `failed` and `inconclusive` describe what the facts prove. The future runner
 * (N6.4) maps them, together with the build mode, the step mode, the flag and the grant, into a step status and the
 * `visual-mismatch` / `visual-unverified` failure classes. Nothing here captures, retries, approves, replaces a locator
 * or touches the page.
 *
 * FACTS ONLY. The caller supplies validated facts: its own refusals, the N0 capture outcome, the baseline store's
 * status, both conditions envelopes, both CSS boxes with clipping and hover/focus state, and the two equality
 * commitments already computed by the layer that holds the key. The policy never sees a key, a digest or an image.
 *
 * FAIL CLOSED. `passed` needs a valid baseline, equal conditions, equal geometry and state and exactly equal
 * commitments. `failed` needs equal conditions and a proven size or commitment difference at an unchanged position
 * and state. Every other input, including an unknown code, an unsupported version and a malformed shape, is
 * `inconclusive`. There is no score, threshold or tolerance.
 */

export const VISUAL_ASSERTION_POLICY_VERSION = 1;
export const VISUAL_ASSERTION_INPUT_VERSION = 1;
/** Equality commitments are HMAC-SHA256 values in lowercase hex (VA-6). */
export const VISUAL_ASSERTION_COMMITMENT_PATTERN = /^[0-9a-f]{64}$/;
/** Longest accepted string condition; anything longer is malformed, never truncated. */
export const VISUAL_ASSERTION_MAX_CONDITION_LENGTH = 256;

export type VisualAssertionVerdictKind = "passed" | "failed" | "inconclusive";

/** Refusals the caller decides before anything is captured (eligibility and DOM resolution). */
export type VisualAssertionRefusal =
  | "protected-surface"
  | "handoff-active"
  | "sensitive-step"
  | "target-not-found"
  | "target-not-unique"
  | "target-hidden"
  | "target-offscreen";

export const VISUAL_ASSERTION_REFUSALS: readonly VisualAssertionRefusal[] = [
  "protected-surface",
  "handoff-active",
  "sensitive-step",
  "target-not-found",
  "target-not-unique",
  "target-hidden",
  "target-offscreen"
];

export type VisualAssertionCode =
  | "identical-to-baseline"
  | "differs-from-baseline"
  | "size-differs-from-baseline"
  | "no-baseline"
  | "baseline-other-conditions"
  | "binding-changed"
  | "baseline-unreadable"
  | "integrity-unavailable"
  | "position-changed"
  | "target-clipped"
  | "interaction-state-changed"
  | VisualAssertionRefusal
  | "capture-stale"
  | "capture-unavailable"
  | "budget-exhausted"
  | "cancelled"
  | "page-closed";

/** The closed vocabulary, each code pinned to the only verdict it may carry. */
export const VISUAL_ASSERTION_CODES: Readonly<Record<VisualAssertionCode, VisualAssertionVerdictKind>> = {
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
  "protected-surface": "inconclusive",
  "handoff-active": "inconclusive",
  "sensitive-step": "inconclusive",
  "target-not-found": "inconclusive",
  "target-not-unique": "inconclusive",
  "target-hidden": "inconclusive",
  "target-offscreen": "inconclusive",
  "capture-stale": "inconclusive",
  "capture-unavailable": "inconclusive",
  "budget-exhausted": "inconclusive",
  "cancelled": "inconclusive",
  "page-closed": "inconclusive"
};

/** The plan's N0 mapping (`errors.ts`). Exhaustive at compile time; an unknown runtime code is `capture-unavailable`. */
export const VISUAL_ASSERTION_CAPTURE_CODES: Readonly<Record<VisualErrorCode, VisualAssertionCode>> = {
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

/** The conditions key (VA-4). Two envelopes are equal only when every field is valid and identical. */
export interface VisualAssertionConditions {
  renderMode: "headed" | "headless";
  browserVersion: string;
  appVersion: string;
  osBuild: string;
  devicePixelRatio: number;
  cssWidth: number;
  cssHeight: number;
  colorScheme: "light" | "dark";
  forcedColors: "none" | "active";
  reducedMotion: "no-preference" | "reduce";
  locale: string;
  timeZone: string;
  frameDepth: number;
  isMainFrame: boolean;
  capturePolicy: string;
  /** The N1 fingerprint version identifier (`awkit-vfp-1`); only the supported one is comparable. */
  fingerprintVersion: string;
  assertionPolicyVersion: number;
}

/**
 * Every conditions field, pinned at compile time: adding a field to `VisualAssertionConditions` fails the build until it
 * is classified here, so no field can be left out of the equality gate.
 */
export const VISUAL_ASSERTION_CONDITION_KEYS: Readonly<Record<keyof VisualAssertionConditions, "string" | "positive" | "count" | "boolean" | "enum" | "version">> = {
  renderMode: "enum",
  browserVersion: "string",
  appVersion: "string",
  osBuild: "string",
  devicePixelRatio: "positive",
  cssWidth: "positive",
  cssHeight: "positive",
  colorScheme: "enum",
  forcedColors: "enum",
  reducedMotion: "enum",
  locale: "string",
  timeZone: "string",
  frameDepth: "count",
  isMainFrame: "boolean",
  capturePolicy: "string",
  fingerprintVersion: "string",
  assertionPolicyVersion: "version"
};

const CONDITION_ENUMS: Readonly<Partial<Record<keyof VisualAssertionConditions, readonly string[]>>> = {
  renderMode: ["headed", "headless"],
  colorScheme: ["light", "dark"],
  forcedColors: ["none", "active"],
  reducedMotion: ["no-preference", "reduce"]
};

/** The target's exact CSS box and read-only state at capture time. */
export interface VisualAssertionGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  /** The capture clipped the target (N0 `wasClipped`). */
  clipped: boolean;
  hover: boolean;
  focus: boolean;
}

export interface VisualAssertionObservation {
  conditions: VisualAssertionConditions;
  geometry: VisualAssertionGeometry;
  /** The equality commitment the keyed layer computed over this capture. */
  commitment: string;
}

export type VisualAssertionCapture = { ok: true; observation: VisualAssertionObservation } | { ok: false; code: VisualErrorCode };

/** What the baseline store found for this step and conditions key. Only `present` carries a record. */
export type VisualAssertionBaseline =
  | { status: "absent" }
  | { status: "other-conditions" }
  | { status: "binding-changed" }
  | { status: "unreadable" }
  | { status: "integrity-unavailable" }
  | ({ status: "present" } & VisualAssertionObservation);

export interface VisualAssertionInput {
  version: typeof VISUAL_ASSERTION_INPUT_VERSION;
  /** Set when nothing may be captured or compared. Takes precedence over everything else. */
  refusal?: VisualAssertionRefusal;
  capture?: VisualAssertionCapture;
  baseline?: VisualAssertionBaseline;
}

export interface VisualAssertionDecision {
  version: typeof VISUAL_ASSERTION_POLICY_VERSION;
  verdict: VisualAssertionVerdictKind;
  code: VisualAssertionCode;
}

const BASELINE_STATUS_CODES: Readonly<Record<Exclude<VisualAssertionBaseline["status"], "present">, VisualAssertionCode>> = {
  absent: "no-baseline",
  "other-conditions": "baseline-other-conditions",
  "binding-changed": "binding-changed",
  unreadable: "baseline-unreadable",
  "integrity-unavailable": "integrity-unavailable"
};

const REFUSAL_SET: ReadonlySet<string> = new Set(VISUAL_ASSERTION_REFUSALS);
const own = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

function decide(code: VisualAssertionCode): VisualAssertionDecision {
  return { version: VISUAL_ASSERTION_POLICY_VERSION, verdict: VISUAL_ASSERTION_CODES[code], code };
}

function validConditions(value: unknown): value is VisualAssertionConditions {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  for (const [key, kind] of Object.entries(VISUAL_ASSERTION_CONDITION_KEYS)) {
    const field = record[key];
    switch (kind) {
      case "string":
        if (typeof field !== "string" || field.length === 0 || field.length > VISUAL_ASSERTION_MAX_CONDITION_LENGTH) return false;
        break;
      case "positive":
        if (typeof field !== "number" || !Number.isFinite(field) || field <= 0) return false;
        break;
      case "count":
        if (typeof field !== "number" || !Number.isInteger(field) || field < 0) return false;
        break;
      case "boolean":
        if (typeof field !== "boolean") return false;
        break;
      case "enum":
        if (typeof field !== "string" || !CONDITION_ENUMS[key as keyof VisualAssertionConditions]!.includes(field)) return false;
        break;
      case "version":
        if (typeof field !== "number" || !Number.isInteger(field) || field < 1) return false;
        break;
    }
  }
  return true;
}

/** Both envelopes this policy version can compare: the supported fingerprint and assertion policy versions. */
function supportedVersions(conditions: VisualAssertionConditions): boolean {
  return conditions.fingerprintVersion === VISUAL_FINGERPRINT_VERSION && conditions.assertionPolicyVersion === VISUAL_ASSERTION_POLICY_VERSION;
}

function validGeometry(value: unknown): value is VisualAssertionGeometry {
  if (!value || typeof value !== "object") return false;
  const g = value as VisualAssertionGeometry;
  return (
    typeof g.x === "number" &&
    Number.isFinite(g.x) &&
    typeof g.y === "number" &&
    Number.isFinite(g.y) &&
    typeof g.width === "number" &&
    Number.isFinite(g.width) &&
    g.width > 0 &&
    typeof g.height === "number" &&
    Number.isFinite(g.height) &&
    g.height > 0 &&
    typeof g.clipped === "boolean" &&
    typeof g.hover === "boolean" &&
    typeof g.focus === "boolean"
  );
}

function validObservation(value: unknown): value is VisualAssertionObservation {
  if (!value || typeof value !== "object") return false;
  const o = value as VisualAssertionObservation;
  return (
    validConditions(o.conditions) &&
    supportedVersions(o.conditions) &&
    validGeometry(o.geometry) &&
    typeof o.commitment === "string" &&
    VISUAL_ASSERTION_COMMITMENT_PATTERN.test(o.commitment)
  );
}

function sameConditions(a: VisualAssertionConditions, b: VisualAssertionConditions): boolean {
  for (const key of Object.keys(VISUAL_ASSERTION_CONDITION_KEYS) as Array<keyof VisualAssertionConditions>) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

/** Exact equality without an early exit on the first differing character. */
function sameCommitment(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

function captureCode(code: unknown): VisualAssertionCode {
  return typeof code === "string" && own(VISUAL_ASSERTION_CAPTURE_CODES, code) ? VISUAL_ASSERTION_CAPTURE_CODES[code as VisualErrorCode] : "capture-unavailable";
}

/** Decide one visual assertion from validated facts. Never throws: malformed input is `inconclusive`. */
export function decideVisualAssertion(input: VisualAssertionInput): VisualAssertionDecision {
  try {
    return decideUnchecked(input);
  } catch {
    return decide("capture-unavailable");
  }
}

function decideUnchecked(input: VisualAssertionInput): VisualAssertionDecision {
  if (!input || typeof input !== "object" || input.version !== VISUAL_ASSERTION_INPUT_VERSION) return decide("capture-unavailable");

  // Caller refusals: nothing may be compared, whatever else was supplied. An unknown refusal is never a comparison.
  if (input.refusal !== undefined) {
    return decide(typeof input.refusal === "string" && REFUSAL_SET.has(input.refusal) ? input.refusal : "capture-unavailable");
  }

  const capture = input.capture;
  if (!capture || typeof capture !== "object") return decide("capture-unavailable");
  if (capture.ok !== true) return decide(capture.ok === false ? captureCode(capture.code) : "capture-unavailable");
  const current = capture.observation;
  if (!validObservation(current)) return decide("capture-unavailable");
  // A clipped capture is never compared and never becomes a candidate, so it outranks every baseline fact.
  if (current.geometry.clipped) return decide("target-clipped");

  const baseline = input.baseline;
  if (!baseline || typeof baseline !== "object" || typeof baseline.status !== "string") return decide("baseline-unreadable");
  if (baseline.status !== "present") {
    return decide(own(BASELINE_STATUS_CODES, baseline.status) ? BASELINE_STATUS_CODES[baseline.status as keyof typeof BASELINE_STATUS_CODES] : "baseline-unreadable");
  }
  // An approval never records a clipped target, so a clipped baseline is not a readable one.
  if (!validObservation(baseline) || baseline.geometry.clipped) return decide("baseline-unreadable");

  if (!sameConditions(current.conditions, baseline.conditions)) return decide("baseline-other-conditions");

  const now = current.geometry;
  const then = baseline.geometry;
  if (now.hover !== then.hover || now.focus !== then.focus) return decide("interaction-state-changed");
  if (now.x !== then.x || now.y !== then.y) return decide("position-changed");
  if (now.width !== then.width || now.height !== then.height) return decide("size-differs-from-baseline");
  return decide(sameCommitment(current.commitment, baseline.commitment) ? "identical-to-baseline" : "differs-from-baseline");
}
