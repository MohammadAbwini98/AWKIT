/**
 * N6.7 (awkit-vra.15.7): the persisted shape of a run's visual assertions and its sanitizer. IMPORTS NOTHING, so the
 * report types, the engine and the renderer can all use it without reaching `src/visual` or Playwright
 * (`verify:visual-isolation`). Plan: docs/plans/ai-upgrade-v5/N6-visual-assertions.md › Reporting.
 *
 * CODES ONLY. A record says how one `assertVisual` step was decided with fixed codes, the step and flow ids, a flag and
 * a duration. It never holds pixels, digests, commitments, tokens, selectors, URLs or page text: the sanitizer rebuilds
 * every record from an allowlist, on write and again on read, so nothing else can be carried through it.
 *
 * It also never strengthens a result. A `visual-mismatch` survives only on a failed step whose verdict was `failed`
 * (the only way the step decision produces one); any other failed record reads as `visual-unverified`, a passed
 * record carries no failure class, and a passed enforce record without a passed verdict is dropped.
 */

export interface VisualAssertionReportRecord {
  version: 1;
  stepId: string;
  flowId: string;
  mode: "observe" | "enforce";
  flag: "off" | "observe" | "enforce";
  appMode: "packaged" | "dev";
  status: "passed" | "failed";
  failureClass?: "visual-mismatch" | "visual-unverified";
  /** The step decision's fixed reason (a gate code or the policy's verdict code). */
  code: string;
  verdict?: "passed" | "failed" | "inconclusive";
  verdictCode?: string;
  /** A pending baseline was created for approval. */
  candidate: boolean;
  candidateWithheld?: "run-unattributed";
  durationMs: number;
}

/** At most this many records per instance report. */
export const VISUAL_ASSERTION_REPORT_MAX_RECORDS = 64;

/** The only keys a stored record may carry. */
export const VISUAL_ASSERTION_REPORT_KEYS: readonly (keyof VisualAssertionReportRecord)[] = [
  "version",
  "stepId",
  "flowId",
  "mode",
  "flag",
  "appMode",
  "status",
  "failureClass",
  "code",
  "verdict",
  "verdictCode",
  "candidate",
  "candidateWithheld",
  "durationMs"
];

/** A fixed code: lower-case, digits and hyphens, at most 48 characters. */
const CODE = /^[a-z][a-z0-9-]{0,47}$/;
/** A flow or step id: an identifier, never free text. */
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;

const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | null =>
  typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;

/** One record rebuilt from the allowlist, or null when a field it cannot do without is malformed. */
export function sanitizeVisualAssertionReportRecord(value: unknown): VisualAssertionReportRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (input.version !== 1) return null;
  const mode = oneOf(input.mode, ["observe", "enforce"] as const);
  const flag = oneOf(input.flag, ["off", "observe", "enforce"] as const);
  const appMode = oneOf(input.appMode, ["packaged", "dev"] as const);
  const status = oneOf(input.status, ["passed", "failed"] as const);
  if (!mode || !flag || !appMode || !status || typeof input.candidate !== "boolean") return null;
  const durationMs = typeof input.durationMs === "number" && Number.isFinite(input.durationMs) && input.durationMs >= 0 ? Math.min(Math.round(input.durationMs), 600_000) : null;
  if (durationMs === null) return null;
  const verdict = oneOf(input.verdict, ["passed", "failed", "inconclusive"] as const);
  // A passed ENFORCE step means equality was proven, which the runtime only reports with a passed verdict. Anything
  // else claiming it (a tampered or imported report) is dropped rather than shown as proof (N6.8 QC finding 4).
  if (mode === "enforce" && status === "passed" && verdict !== "passed") return null;
  const record: VisualAssertionReportRecord = {
    version: 1,
    stepId: typeof input.stepId === "string" && ID.test(input.stepId) ? input.stepId : "invalid",
    flowId: typeof input.flowId === "string" && ID.test(input.flowId) ? input.flowId : "invalid",
    mode,
    flag,
    appMode,
    status,
    code: typeof input.code === "string" && CODE.test(input.code) ? input.code : "invalid",
    candidate: input.candidate,
    durationMs
  };
  if (status === "failed") {
    // Never strengthen: a mismatch needs a failed verdict; anything else that failed is unverified.
    record.failureClass = input.failureClass === "visual-mismatch" && verdict === "failed" ? "visual-mismatch" : "visual-unverified";
  }
  if (verdict) {
    record.verdict = verdict;
    record.verdictCode = typeof input.verdictCode === "string" && CODE.test(input.verdictCode) ? input.verdictCode : "invalid";
  }
  if (input.candidateWithheld === "run-unattributed") record.candidateWithheld = "run-unattributed";
  return record;
}

/**
 * The stored `visualAssertions` array: each record rebuilt from the allowlist, malformed ones dropped, at most
 * `VISUAL_ASSERTION_REPORT_MAX_RECORDS`. Undefined when nothing survives, so a report without assertions carries no
 * field and older reports read exactly as before.
 */
export function sanitizeVisualAssertionReportRecords(value: unknown): VisualAssertionReportRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const records: VisualAssertionReportRecord[] = [];
  for (const entry of value) {
    if (records.length >= VISUAL_ASSERTION_REPORT_MAX_RECORDS) break;
    const record = sanitizeVisualAssertionReportRecord(entry);
    if (record) records.push(record);
  }
  return records.length > 0 ? records : undefined;
}

export interface VisualAssertionTotals {
  total: number;
  passed: number;
  /** Failed: proven different from the approved baseline. */
  mismatch: number;
  /** Failed: equality was not proven (an enforce step only). */
  unverified: number;
  /** Observe steps whose evaluation was inconclusive (they passed, but proved nothing). */
  observedInconclusive: number;
  /** Observe steps whose evaluation found a difference (they passed; observe never fails a step). */
  observedDifferent: number;
  candidates: number;
}

/** Totals over sanitized records (one instance, or every instance of a run). */
export function visualAssertionTotals(records: readonly VisualAssertionReportRecord[]): VisualAssertionTotals {
  const totals: VisualAssertionTotals = { total: 0, passed: 0, mismatch: 0, unverified: 0, observedInconclusive: 0, observedDifferent: 0, candidates: 0 };
  for (const record of records) {
    totals.total += 1;
    if (record.status === "passed") totals.passed += 1;
    else if (record.failureClass === "visual-mismatch") totals.mismatch += 1;
    else totals.unverified += 1;
    if (record.mode === "observe" && record.verdict === "inconclusive") totals.observedInconclusive += 1;
    if (record.mode === "observe" && record.verdict === "failed") totals.observedDifferent += 1;
    if (record.candidate) totals.candidates += 1;
  }
  return totals;
}

/** Run-level totals: every instance's block sanitized again on read (`reports:create` imports whole reports). */
export function visualAssertionRunTotals(instances: readonly { visualAssertions?: unknown }[]): VisualAssertionTotals | null {
  const records = instances.flatMap((instance) => sanitizeVisualAssertionReportRecords(instance.visualAssertions) ?? []);
  return records.length > 0 ? visualAssertionTotals(records) : null;
}
