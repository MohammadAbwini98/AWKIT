/**
 * OCR utility host protocol (Phase N, N7.4 / awkit-vra.9.5). PURE: types, limits and message guards shared by
 * `app/main/ocr/OcrUtilityHostManager.ts` and `native-hosts/ocr/ocr-host.cjs`. Plan:
 * docs/plans/ai-upgrade-v5/N7-ocr-text-in-image.md; engine decision DECISIONS 2026-10-26 (N7.1a GO, direct
 * tesseract.js-core, SIMD LSTM only, recognition synchronous on the host thread, so cancellation and deadlines are
 * enforced by killing the host).
 *
 * Not part of `src/visual`: the host and its manager never import Visual Intelligence, and Visual Intelligence never
 * reaches them except through the injected service of the approved N7.5 adapter.
 */

export const OCR_HOST_PROTOCOL_VERSION = 1;

/** OC-9 targets, enforced here as limits. Figures are targets until N7.6 measures them. */
export const OCR_HOST_LIMITS = Object.freeze({
  /** Default per-request deadline, covering queue wait, spawn and recognition (capture is the caller's). */
  deadlineMs: 1500,
  /** A host that has not finished starting and loading the engine by then is killed. */
  spawnAndReadyMs: 15_000,
  /** Requests waiting behind the running one; more are refused as `ocr-busy`. */
  queueBound: 4,
  /** Idle hosts are shut down after this long. */
  idleShutdownMs: 60_000,
  /** A host whose resident set exceeds this after a job is recycled. */
  rssCeilingBytes: 400 * 1024 * 1024,
  /** Largest image the host accepts, in pixels (the preprocessing refuses larger crops first). */
  maxPixels: 1_000_000,
  /** Words and characters a reply may carry. */
  maxWords: 600,
  maxWordLength: 256,
  gracefulShutdownMs: 1_000,
  terminateGraceMs: 2_000
});

/** At most 3 unexpected exits in 5 minutes; the next one opens the circuit for the session. */
export const OCR_HOST_RESTART_POLICY = Object.freeze({ maxRestartsInWindow: 3, windowMs: 5 * 60_000, restartDelayMs: 500 });

/**
 * Why OCR produced no words. `unsupported-cpu`, `assets-missing` and `checksum-mismatch` are permanent for the
 * session: the host is not retried.
 */
export type OcrHostReason =
  | "ocr-unavailable"
  | "ocr-busy"
  | "budget-exhausted"
  | "cancelled"
  | "assets-missing"
  | "checksum-mismatch"
  | "unsupported-cpu"
  | "host-failed"
  | "image-invalid"
  | "output-invalid";

export const OCR_HOST_REASONS: readonly OcrHostReason[] = [
  "ocr-unavailable",
  "ocr-busy",
  "budget-exhausted",
  "cancelled",
  "assets-missing",
  "checksum-mismatch",
  "unsupported-cpu",
  "host-failed",
  "image-invalid",
  "output-invalid"
];

/** Failures that will not change on a retry within this session. */
export const OCR_PERMANENT_REASONS: readonly OcrHostReason[] = ["assets-missing", "checksum-mismatch", "unsupported-cpu"];

/** Tesseract page-segmentation modes the host accepts: 6 single block (default), 7 single line. */
export type OcrPageSegmentation = 6 | 7;

export interface OcrHostWord {
  text: string;
  /** Engine confidence, 0–100. */
  confidence: number;
}

/** A preprocessed grayscale plane, row-major, one byte per pixel. */
export interface OcrHostImage {
  width: number;
  height: number;
  gray: Uint8Array;
  psm?: OcrPageSegmentation;
}

export type OcrHostOutcome = { ok: true; words: OcrHostWord[]; recognizeMs: number } | { ok: false; reason: OcrHostReason };

// ── Wire messages ───────────────────────────────────────────────────────────────────────────────────────────────

export type OcrHostRequest =
  | { version: 1; type: "recognize"; id: string; width: number; height: number; gray: Uint8Array; psm: OcrPageSegmentation }
  | { version: 1; type: "shutdown"; id: string };

export type OcrHostEvent =
  | { type: "ready"; version: 1; pid: number; flavor: string; initMs: number }
  | { type: "failed"; version: 1; reason: OcrHostReason };

export type OcrHostResponse =
  | { type: "result"; version: 1; id: string; ok: true; words: OcrHostWord[]; recognizeMs: number; rss: number }
  | { type: "result"; version: 1; id: string; ok: false; reason: OcrHostReason; rss: number };

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export function isOcrHostEvent(message: unknown): message is OcrHostEvent {
  if (!isRecord(message) || message.version !== OCR_HOST_PROTOCOL_VERSION) return false;
  if (message.type === "ready") return Number.isInteger(message.pid) && typeof message.flavor === "string" && typeof message.initMs === "number";
  if (message.type === "failed") return OCR_HOST_REASONS.includes(message.reason as OcrHostReason);
  return false;
}

/** A well-formed result. Words are re-validated against the limits, so a host can never hand over more. */
export function isOcrHostResponse(message: unknown): message is OcrHostResponse {
  if (!isRecord(message) || message.version !== OCR_HOST_PROTOCOL_VERSION || message.type !== "result" || typeof message.id !== "string") return false;
  if (typeof message.rss !== "number" || !Number.isFinite(message.rss)) return false;
  if (message.ok === false) return OCR_HOST_REASONS.includes(message.reason as OcrHostReason);
  if (message.ok !== true || typeof message.recognizeMs !== "number" || !Array.isArray(message.words) || message.words.length > OCR_HOST_LIMITS.maxWords) return false;
  return message.words.every(
    (word) =>
      isRecord(word) &&
      typeof word.text === "string" &&
      word.text.length <= OCR_HOST_LIMITS.maxWordLength &&
      typeof word.confidence === "number" &&
      Number.isFinite(word.confidence) &&
      word.confidence >= 0 &&
      word.confidence <= 100
  );
}

/** Validate an image before it is posted: exact plane size, within the pixel limit. */
export function isValidOcrHostImage(image: unknown): image is OcrHostImage {
  if (!isRecord(image)) return false;
  const { width, height, gray, psm } = image;
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    (width as number) > 0 &&
    (height as number) > 0 &&
    (width as number) * (height as number) <= OCR_HOST_LIMITS.maxPixels &&
    gray instanceof Uint8Array &&
    gray.length === (width as number) * (height as number) &&
    (psm === undefined || psm === 6 || psm === 7)
  );
}
