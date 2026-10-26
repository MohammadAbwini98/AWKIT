/**
 * N7.5 (awkit-vra.9.6): the persisted shape of a run's OCR assertions and its sanitizer. IMPORTS NOTHING, so the report
 * types, the engine and the renderer can all use it without reaching `src/visual` or Playwright
 * (`verify:visual-isolation`). Plan: docs/plans/ai-upgrade-v5/N7-ocr-text-in-image.md › Persistence.
 *
 * CODES ONLY. A record says how one `assertImageText` step was observed: fixed codes, buckets, a character count, the
 * step and flow ids and a duration. It never holds recognized or expected text, pixels, boxes, selectors, URLs, secret
 * references or engine internals.
 *
 * STRICT. Every record is rebuilt from the allowlist on write and again on read; a record carrying ANY other key, a
 * malformed field it cannot do without, or an inconsistent verdict is dropped, never repaired into a stronger claim:
 * `matched` stands only with `text-matched`, `differs` only with `text-differs`. At most 64 records per instance.
 */

export interface OcrAssertionReportRecord {
  version: 1;
  stepId: string;
  flowId: string;
  mode: "observe";
  /** Observe never fails a step. */
  status: "passed";
  verdict?: "matched" | "differs" | "inconclusive";
  code: string;
  distanceBucket?: "exact" | "one-edit" | "few-edits" | "many-edits";
  confidenceBucket?: "ge-95" | "90-to-95" | "80-to-90" | "below-80";
  /** Length of the normalized recognized text; never the text. */
  charCount?: number;
  durationMs: number;
}

/** At most this many records per instance report. */
export const OCR_ASSERTION_REPORT_MAX_RECORDS = 64;

/** The only keys a stored record may carry. */
export const OCR_ASSERTION_REPORT_KEYS: readonly (keyof OcrAssertionReportRecord)[] = [
  "version",
  "stepId",
  "flowId",
  "mode",
  "status",
  "verdict",
  "code",
  "distanceBucket",
  "confidenceBucket",
  "charCount",
  "durationMs"
];

/** A fixed code: lower-case, digits and hyphens, at most 48 characters. */
const CODE = /^[a-z][a-z0-9-]{0,47}$/;
/** A flow or step id: an identifier, never free text. */
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const DISTANCE = ["exact", "one-edit", "few-edits", "many-edits"] as const;
const CONFIDENCE = ["ge-95", "90-to-95", "80-to-90", "below-80"] as const;
const MAX_CHARS = 100_000;

const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined =>
  typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;

/** One record rebuilt from the allowlist, or null when it carries anything else or is malformed. */
export function sanitizeOcrAssertionReportRecord(value: unknown): OcrAssertionReportRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !(OCR_ASSERTION_REPORT_KEYS as readonly string[]).includes(key))) return null;
  if (input.version !== 1 || input.mode !== "observe" || input.status !== "passed") return null;
  if (typeof input.stepId !== "string" || !ID.test(input.stepId)) return null;
  if (typeof input.flowId !== "string" || !(input.flowId === "" || ID.test(input.flowId))) return null;
  if (typeof input.code !== "string" || !CODE.test(input.code)) return null;
  if (typeof input.durationMs !== "number" || !Number.isFinite(input.durationMs) || input.durationMs < 0 || input.durationMs > 600_000) return null;
  const verdict = oneOf(input.verdict, ["matched", "differs", "inconclusive"] as const);
  if (input.verdict !== undefined && !verdict) return null;
  // Never strengthen: only the decision's own codes may carry a definite verdict.
  if (verdict === "matched" && input.code !== "text-matched") return null;
  if (verdict === "differs" && input.code !== "text-differs") return null;
  if (verdict !== "matched" && input.code === "text-matched") return null;
  if (verdict !== "differs" && input.code === "text-differs") return null;
  const distanceBucket = oneOf(input.distanceBucket, DISTANCE);
  const confidenceBucket = oneOf(input.confidenceBucket, CONFIDENCE);
  if ((input.distanceBucket !== undefined && !distanceBucket) || (input.confidenceBucket !== undefined && !confidenceBucket)) return null;
  if (input.charCount !== undefined && (typeof input.charCount !== "number" || !Number.isInteger(input.charCount) || input.charCount < 0 || input.charCount > MAX_CHARS)) return null;
  const record: OcrAssertionReportRecord = {
    version: 1,
    stepId: input.stepId,
    flowId: input.flowId,
    mode: "observe",
    status: "passed",
    code: input.code,
    durationMs: Math.round(input.durationMs)
  };
  if (verdict) record.verdict = verdict;
  if (distanceBucket) record.distanceBucket = distanceBucket;
  if (confidenceBucket) record.confidenceBucket = confidenceBucket;
  if (typeof input.charCount === "number") record.charCount = input.charCount;
  return record;
}

/**
 * The stored `ocrAssertions` array: each record rebuilt from the allowlist, anything else dropped, at most
 * `OCR_ASSERTION_REPORT_MAX_RECORDS`. Undefined when nothing survives, so a report without OCR assertions carries no
 * field and older reports read exactly as before.
 */
export function sanitizeOcrAssertionReportRecords(value: unknown): OcrAssertionReportRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const records: OcrAssertionReportRecord[] = [];
  for (const entry of value) {
    if (records.length >= OCR_ASSERTION_REPORT_MAX_RECORDS) break;
    const record = sanitizeOcrAssertionReportRecord(entry);
    if (record) records.push(record);
  }
  return records.length > 0 ? records : undefined;
}

/**
 * An imported instance (`reports:create`) with its `ocrAssertions` block rebuilt by the sanitizer, or removed when
 * nothing survives. Every other field is left exactly as it was.
 */
export function withSanitizedOcrAssertions<T extends object>(instance: T): T {
  if (!instance || typeof instance !== "object" || !Object.prototype.hasOwnProperty.call(instance, "ocrAssertions")) return instance;
  const { ocrAssertions, ...rest } = instance as T & { ocrAssertions?: unknown };
  const sanitized = sanitizeOcrAssertionReportRecords(ocrAssertions);
  return (sanitized ? { ...rest, ocrAssertions: sanitized } : rest) as T;
}

export interface OcrAssertionTotals {
  total: number;
  matched: number;
  differs: number;
  inconclusive: number;
  /** OCR was off, or nothing was evaluated. */
  notEvaluated: number;
}

/** Totals over sanitized records (one instance, or every instance of a run). */
export function ocrAssertionTotals(records: readonly OcrAssertionReportRecord[]): OcrAssertionTotals {
  const totals: OcrAssertionTotals = { total: 0, matched: 0, differs: 0, inconclusive: 0, notEvaluated: 0 };
  for (const record of records) {
    totals.total += 1;
    if (record.verdict === "matched") totals.matched += 1;
    else if (record.verdict === "differs") totals.differs += 1;
    else if (record.verdict === "inconclusive") totals.inconclusive += 1;
    else totals.notEvaluated += 1;
  }
  return totals;
}

/** Run-level totals: every instance's block sanitized again on read (`reports:create` imports whole reports). */
export function ocrAssertionRunTotals(instances: readonly { ocrAssertions?: unknown }[]): OcrAssertionTotals | null {
  const records = instances.flatMap((instance) => sanitizeOcrAssertionReportRecords(instance.ocrAssertions) ?? []);
  return records.length > 0 ? ocrAssertionTotals(records) : null;
}
