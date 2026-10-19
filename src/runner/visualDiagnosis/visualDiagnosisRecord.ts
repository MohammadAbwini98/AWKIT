/**
 * N5.4 (awkit-vra.14.4): the persisted shape of a Visual Failure Diagnosis and its sanitizer. IMPORTS NOTHING, so the
 * report types, the main process and (N5.5) the renderer can all use it without reaching `src/visual` or Playwright
 * (`verify:visual-isolation`). Plan: docs/plans/ai-upgrade-v5/N5-visual-failure-diagnosis.md › Persistence (VD-5).
 *
 * CODES ONLY. A record says what was observed with fixed codes, small counts and a duration. It never holds pixels,
 * fingerprints, digests, selectors, URLs, coordinates or page text, and the sanitizer below rebuilds every record from
 * an allowlist, so nothing else can be carried through it, whatever the input held.
 */

export interface VisualDiagnosisRecord {
  version: 1;
  stepId: string;
  attempt: number;
  failureKind: "locator" | "timeout" | "assertion" | "other" | "none";
  outcome: "refused" | "observed";
  conditions: "none" | "different" | "unproven" | "equal-proven";
  observations: string[];
  referenceSource: "runtime" | "recorded" | "none";
  examined: number;
  domNamed: number;
  truncated: boolean;
  identicalOthers?: "1" | "2+";
  ms: number;
}

/** At most this many records per instance report (the per-signature cap of 20 already bounds repeats). */
export const VISUAL_DIAGNOSIS_MAX_RECORDS = 64;
/** At most this many observations per record. */
export const VISUAL_DIAGNOSIS_RECORD_MAX_OBSERVATIONS = 8;
/** The only keys a stored record may carry. */
export const VISUAL_DIAGNOSIS_RECORD_KEYS: readonly (keyof VisualDiagnosisRecord)[] = [
  "version",
  "stepId",
  "attempt",
  "failureKind",
  "outcome",
  "conditions",
  "observations",
  "referenceSource",
  "examined",
  "domNamed",
  "truncated",
  "identicalOthers",
  "ms"
];

/** A fixed code: lower-case, digits and hyphens, at most 40 characters (the recovery-provenance pattern). */
const CODE = /^[a-z][a-z0-9-]{0,39}$/;
/** A flow step id: an identifier, never free text. */
const STEP_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const FAILURE_KINDS = new Set(["locator", "timeout", "assertion", "other", "none"]);
const OUTCOMES = new Set(["refused", "observed"]);
const CONDITIONS = new Set(["none", "different", "unproven", "equal-proven"]);
const SOURCES = new Set(["runtime", "recorded", "none"]);

const count = (value: unknown, max: number): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? Math.min(value, max) : null;

/** One record rebuilt from the allowlist, or null when a field it cannot do without is malformed. */
export function sanitizeVisualDiagnosisRecord(value: unknown): VisualDiagnosisRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (input.version !== 1) return null;
  if (typeof input.outcome !== "string" || !OUTCOMES.has(input.outcome)) return null;
  if (typeof input.conditions !== "string" || !CONDITIONS.has(input.conditions)) return null;
  if (typeof input.referenceSource !== "string" || !SOURCES.has(input.referenceSource)) return null;
  if (typeof input.failureKind !== "string" || !FAILURE_KINDS.has(input.failureKind)) return null;
  if (typeof input.truncated !== "boolean" || !Array.isArray(input.observations) || input.observations.length === 0) return null;
  const attempt = count(input.attempt, 1000);
  const examined = count(input.examined, 64);
  const domNamed = count(input.domNamed, 64);
  const ms = count(input.ms, 600_000);
  if (attempt === null || examined === null || domNamed === null || ms === null) return null;
  const observations = input.observations
    .slice(0, VISUAL_DIAGNOSIS_RECORD_MAX_OBSERVATIONS)
    .map((code) => (typeof code === "string" && CODE.test(code) ? code : "invalid"));
  const record: VisualDiagnosisRecord = {
    version: 1,
    stepId: typeof input.stepId === "string" && STEP_ID.test(input.stepId) ? input.stepId : "invalid",
    attempt,
    failureKind: input.failureKind as VisualDiagnosisRecord["failureKind"],
    outcome: input.outcome as VisualDiagnosisRecord["outcome"],
    conditions: input.conditions as VisualDiagnosisRecord["conditions"],
    observations,
    referenceSource: input.referenceSource as VisualDiagnosisRecord["referenceSource"],
    examined,
    domNamed,
    truncated: input.truncated,
    ms
  };
  if (input.identicalOthers === "1" || input.identicalOthers === "2+") record.identicalOthers = input.identicalOthers;
  return record;
}

/**
 * The stored `visualDiagnosis` array: each record rebuilt from the allowlist, malformed ones dropped, at most
 * `VISUAL_DIAGNOSIS_MAX_RECORDS`. Undefined when nothing survives, so a report without diagnoses carries no field.
 */
export function sanitizeVisualDiagnosisRecords(value: unknown): VisualDiagnosisRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const records: VisualDiagnosisRecord[] = [];
  for (const entry of value) {
    if (records.length >= VISUAL_DIAGNOSIS_MAX_RECORDS) break;
    const record = sanitizeVisualDiagnosisRecord(entry);
    if (record) records.push(record);
  }
  return records.length > 0 ? records : undefined;
}
