/**
 * `AiActionRecord`: the audit entry for every AI change that was APPLIED (Phase L, L1.4; shape
 * ratified in docs/ai/DECISIONS.md 2026-09-19). T2 auto-applies and T1 user-approved applies are
 * records; T0 output, `pendingUpgrade` annotations and unapplied suggestions are not.
 *
 * A record holds ids, enums and counts only, never page text, locator values, prompts or model
 * output. `sanitizeAiActionRecord` therefore rebuilds a record from its known fields and drops
 * everything else instead of trusting the caller's object; the store re-runs it on every read.
 *
 * Framework-agnostic: no Electron, no filesystem.
 */

import {
  isAiActionClass,
  isAiFeatureId,
  type AiActionClass,
  type AiFeatureId,
  type AiSelfDemotionFact
} from "../security/authz/AiAutonomyPolicy";

export const AI_ACTION_RECORD_SCHEMA_VERSION = 1;

/** Newest 5,000, at most 90 days old, pruned on write (mirrors the run-report retention). */
export const AI_ACTION_RECORD_RETENTION = Object.freeze({
  maxRecords: 5_000,
  maxAgeMs: 90 * 24 * 60 * 60 * 1000
});

export const AI_MAX_EVIDENCE_IDS = 32;
const MAX_ID_LENGTH = 200;
const MAX_COUNT = 1_000_000;

export type AiActionProofResult = "capture-proven" | "replay-proven" | "repair-proven";
const PROOF_RESULTS: readonly string[] = ["capture-proven", "replay-proven", "repair-proven"];

export interface AiActionTarget {
  kind: "stepLocator";
  flowId: string;
  stepId: string;
}

/** Where the prior value lives. The record never holds it: revert must survive a lost audit log. */
export interface AiRevertHandle {
  kind: "locatorProvenance";
}

export interface AiActionRecord {
  schemaVersion: 1;
  id: string;
  feature: AiFeatureId;
  actionClass: AiActionClass;
  tier: "T1" | "T2";
  target: AiActionTarget;
  evidenceIds: string[];
  proof: { result: AiActionProofResult; replays?: number; dataRows?: number };
  modelId: string;
  createdAt: string;
  revertHandle: AiRevertHandle;
  reverted?: { at: string };
}

export type AiRecordSanitizeResult = { ok: true; record: AiActionRecord } | { ok: false; errors: string[] };

/** An identifier, not text: bounded and free of control characters. */
function identifier(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH && !/\p{Cc}/u.test(value)
    ? value
    : undefined;
}

function timestamp(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value)) ? value : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_COUNT ? value : undefined;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function sanitizeAiActionRecord(input: unknown): AiRecordSanitizeResult {
  const raw = object(input);
  if (!raw) return { ok: false, errors: ["record must be an object"] };
  const errors: string[] = [];

  if (raw.schemaVersion !== AI_ACTION_RECORD_SCHEMA_VERSION) errors.push("schemaVersion must be 1");
  const id = identifier(raw.id);
  if (!id) errors.push("id");
  if (!isAiFeatureId(raw.feature)) errors.push("feature");
  // An interpretation is T0 output and is never applied, so it can never be a record.
  if (!isAiActionClass(raw.actionClass) || raw.actionClass === "interpretation") errors.push("actionClass");
  if (raw.tier !== "T1" && raw.tier !== "T2") errors.push("tier");

  const target = object(raw.target);
  const flowId = identifier(target?.flowId);
  const stepId = identifier(target?.stepId);
  if (target?.kind !== "stepLocator" || !flowId || !stepId) errors.push("target");

  const evidence = Array.isArray(raw.evidenceIds) ? raw.evidenceIds.map(identifier) : undefined;
  if (!evidence || evidence.length > AI_MAX_EVIDENCE_IDS || evidence.some((e) => e === undefined)) errors.push("evidenceIds");

  const proof = object(raw.proof);
  const replays = proof?.replays === undefined ? undefined : count(proof.replays);
  const dataRows = proof?.dataRows === undefined ? undefined : count(proof.dataRows);
  if (
    !proof ||
    !PROOF_RESULTS.includes(proof.result as string) ||
    (proof.replays !== undefined && replays === undefined) ||
    (proof.dataRows !== undefined && dataRows === undefined)
  ) {
    errors.push("proof");
  }

  const modelId = identifier(raw.modelId);
  if (!modelId) errors.push("modelId");
  const createdAt = timestamp(raw.createdAt);
  if (!createdAt) errors.push("createdAt");
  if (object(raw.revertHandle)?.kind !== "locatorProvenance") errors.push("revertHandle");

  let reverted: { at: string } | undefined;
  if (raw.reverted !== undefined) {
    const at = timestamp(object(raw.reverted)?.at);
    if (at) reverted = { at };
    else errors.push("reverted");
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    record: {
      schemaVersion: 1,
      id: id!,
      feature: raw.feature as AiFeatureId,
      actionClass: raw.actionClass as AiActionClass,
      tier: raw.tier as "T1" | "T2",
      target: { kind: "stepLocator", flowId: flowId!, stepId: stepId! },
      evidenceIds: evidence as string[],
      proof: {
        result: proof!.result as AiActionProofResult,
        ...(replays !== undefined ? { replays } : {}),
        ...(dataRows !== undefined ? { dataRows } : {})
      },
      modelId: modelId!,
      createdAt: createdAt!,
      revertHandle: { kind: "locatorProvenance" },
      ...(reverted ? { reverted } : {})
    }
  };
}

/** Newest first, then the age and count bounds. Stable, so equal timestamps keep insertion order. */
export function pruneAiActionRecords(records: readonly AiActionRecord[], nowMs: number): AiActionRecord[] {
  const cutoff = nowMs - AI_ACTION_RECORD_RETENTION.maxAgeMs;
  return records
    .filter((record) => Date.parse(record.createdAt) >= cutoff)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, AI_ACTION_RECORD_RETENTION.maxRecords);
}

export function selfDemotionFacts(records: readonly AiActionRecord[]): AiSelfDemotionFact[] {
  return records.map((record) => ({
    feature: record.feature,
    tier: record.tier,
    createdAt: record.createdAt,
    reverted: record.reverted !== undefined
  }));
}
