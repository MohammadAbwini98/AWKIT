/**
 * Phase N, N4.2 (awkit-vra.13.2): the Recorder visual-capture contract. PURE: no Playwright, no `src/visual`, no I/O,
 * so the N4.4 IPC channel, the preload typings and the renderer can share it without reaching `src/visual` (RV-1).
 * Plan: docs/plans/ai-upgrade-v5/N4-recorder-visual-intelligence.md.
 *
 * A capture result is a status code and fixed text only (RV-8): never pixels, a thumbnail, a fingerprint, a digest,
 * a locator or a page URL.
 */

/** RV-6: `AWKIT_VISUAL_RECORDER=manual` turns the manual capture on; anything else, or nothing, is off. */
export type RecorderVisualCaptureMode = "manual" | "off";

export function recorderVisualCaptureMode(env: Readonly<Record<string, string | undefined>> = process.env): RecorderVisualCaptureMode {
  return env.AWKIT_VISUAL_RECORDER === "manual" ? "manual" : "off";
}

/** RV-2: the element steps a reference may be captured for. Fill and select are excluded (their pixels show typed values). */
export const RECORDER_VISUAL_ELIGIBLE_STEPS: ReadonlySet<string> = new Set(["click", "dblclick", "contextMenu", "clickAndHold", "check", "uncheck", "radio"]);

/** The capture's deadline: the screenshot, the crop and the evidence build share it. */
export const RECORDER_VISUAL_CAPTURE_TIMEOUT_MS = 1500;

/** Each protected-login detector pass is bounded too; an unfinished scan refuses (fail closed). */
export const RECORDER_VISUAL_DETECTOR_TIMEOUT_MS = 1500;

/** Re-proving the step's own locator on the live page is bounded the same way. */
export const RECORDER_VISUAL_PROOF_TIMEOUT_MS = 1500;

export type RecorderVisualCaptureCode =
  | "disabled"
  | "not-recording"
  | "handoff-active"
  | "action-not-found"
  | "not-eligible"
  | "sensitive"
  | "protected-surface"
  | "no-live-page"
  | "not-unique"
  | "not-found"
  | "offscreen"
  | "frame-mapping-failed"
  | "page-closed"
  | "timeout"
  | "stale"
  | "capture-unavailable"
  | "capture-failed";

/** The fixed text for each code. Nothing from the page or the step is ever interpolated. */
export const RECORDER_VISUAL_CAPTURE_MESSAGES: Readonly<Record<RecorderVisualCaptureCode, string>> = {
  disabled: "Visual reference capture is turned off.",
  "not-recording": "Visual references can be captured only while recording.",
  "handoff-active": "Recording is paused for a protected sign-in.",
  "action-not-found": "That recorded step no longer exists.",
  "not-eligible": "Visual references are captured for click, check and radio steps only.",
  sensitive: "This step is sensitive, so no visual reference is captured.",
  "protected-surface": "A protected sign-in surface is on the page, so nothing was captured.",
  "no-live-page": "The page this step was recorded on is not open.",
  "not-unique": "The step's locator does not match exactly one element on the page.",
  "not-found": "The step's element is not on the page.",
  offscreen: "The step's element is outside the visible area. Scroll it into view yourself and try again.",
  "frame-mapping-failed": "The step's element could not be located inside its frame.",
  "page-closed": "The page closed during the capture.",
  timeout: "The capture did not finish in time.",
  stale: "The page or the step changed during the capture.",
  "capture-unavailable": "A visual reference cannot be captured on this page.",
  "capture-failed": "The visual reference could not be built."
};

export type RecorderVisualCaptureResult =
  | { ok: true; status: "captured" }
  | { ok: false; code: RecorderVisualCaptureCode; message: string };

/** Memory-only status of one recorded step's pending reference (N4.3 persists it at save; N4.4 shows it). */
export type RecorderVisualReferenceStatus = "none" | "captured" | "stale";

/** N4.4: the per-step statuses the Recorder status read carries, by action id. A step with no reference is absent. */
export type RecorderVisualReferenceStatuses = Readonly<Record<string, Exclude<RecorderVisualReferenceStatus, "none">>>;

export function recorderVisualRefusal(code: RecorderVisualCaptureCode): RecorderVisualCaptureResult {
  return { ok: false, code, message: RECORDER_VISUAL_CAPTURE_MESSAGES[code] };
}

/** N4.4: the longest recorded action id the capture channel accepts. Recorded ids are far shorter. */
export const RECORDER_VISUAL_ACTION_ID_MAX_LENGTH = 256;

/** N4.4: the capture channel's request, sanitized to one recorded action id, or null when it is not one. */
export function recorderVisualActionId(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim() || raw.length > RECORDER_VISUAL_ACTION_ID_MAX_LENGTH) return null;
  return raw;
}

/**
 * N4.4 (RV-8): the capture channel's answer, rebuilt field by field so nothing but a status code and its fixed text
 * crosses IPC, whatever else a result object might carry. An unknown refusal code answers `capture-failed`.
 */
export function recorderVisualCaptureResponse(result: RecorderVisualCaptureResult): RecorderVisualCaptureResult {
  if (result.ok === true) return { ok: true, status: "captured" };
  const code: RecorderVisualCaptureCode = Object.prototype.hasOwnProperty.call(RECORDER_VISUAL_CAPTURE_MESSAGES, result.code) ? result.code : "capture-failed";
  return recorderVisualRefusal(code);
}

/**
 * The N0 capture error codes (`VisualErrorCode`, kept as a plain string here so this file never imports `src/visual`)
 * mapped onto the Recorder's codes. An unknown code is a build failure, never a success. The service proves the target
 * present and unique before it captures, so a `TARGET_STALE` from the capture means the element went or moved since.
 */
export function recorderVisualCodeFor(visualErrorCode: string): RecorderVisualCaptureCode {
  switch (visualErrorCode) {
    case "TARGET_NOT_UNIQUE":
      return "not-unique";
    case "TARGET_STALE":
      return "stale";
    case "TARGET_OFFSCREEN":
      return "offscreen";
    case "PROTECTED_SURFACE":
      return "protected-surface";
    case "FRAME_MAPPING_FAILED":
      return "frame-mapping-failed";
    case "PAGE_CLOSED":
      return "page-closed";
    case "BUDGET_EXHAUSTED":
    case "CANCELLED":
      return "timeout";
    case "CAPTURE_STALE":
      return "stale";
    case "CAPTURE_UNAVAILABLE":
    case "INVALID_BOUNDS":
      return "capture-unavailable";
    default:
      return "capture-failed";
  }
}
