/**
 * Renderer-facing local-AI contract (Phase L, L1.1 and L1.5).
 *
 * Everything that crosses IPC is defined and sanitized here, in one pure module, so the main-process
 * handlers and their verifiers apply identical rules (the `SemanticApi.ts` pattern: unknown
 * properties are dropped, present-but-malformed values are errors, codes not messages).
 *
 * The renderer gets status, settings, the model pack, diagnostics, the audit log and revert. It never
 * gets a channel that runs a prompt, names a model file, starts a process or returns a path: model
 * import picks its file in the main process.
 *
 * Framework-agnostic and renderer-safe: types and pure functions only.
 */

import { authorizeSemanticAction } from "../../semantic/contracts/SemanticApi";
import { isAiFeatureId, type AiFeatureId, type AiTier } from "../../security/authz/AiAutonomyPolicy";
import type { AiActionRecord } from "../AiActionRecord";

export type AiReasonCode =
  | "OK"
  | "NOT_AVAILABLE"
  | "INVALID_REQUEST"
  | "SETTINGS_REJECTED"
  | "IMPORT_REFUSED"
  | "IMPORT_CANCELLED"
  | "REVERT_REFUSED"
  | "NOT_FOUND"
  | "REAUTH_REQUIRED"
  | "NOT_AUTHORIZED";

export interface AiAdminResponse {
  code: AiReasonCode;
  ok: boolean;
  /** Short, safe sentence; never a runtime or filesystem message. */
  message?: string;
  /** Stable detail code (for example the import refusal or revert refusal). */
  detail?: string;
}

export interface AiModelPackView {
  status: "missing" | "installed" | "invalid" | "incompatible";
  reason: string | null;
  modelId: string | null;
  displayName: string | null;
}

export interface AiStatusView {
  enabled: boolean;
  state: "available" | "unavailable" | "loading" | "busy" | "error";
  /** Stable code explaining an unavailable or error state. */
  reason: string | null;
  holdReason: string | null;
  queueDepth: number;
  modelPack: AiModelPackView;
}

export interface AiFeatureView {
  id: AiFeatureId;
  ceiling: AiTier;
  /** Null when not configured, which means the ceiling. */
  configured: AiTier | null;
  effective: AiTier;
  demotion: { at: string; applied: number; reverted: number; revertRate: number } | null;
}

export interface AiSettingsView {
  enabled: boolean;
  yieldDuringRuns: boolean;
  idleUnloadMinutes: number;
  maxIdleUnloadMinutes: number;
  features: AiFeatureView[];
}

export interface AiDiagnosticsView {
  runtime: { included: boolean; pinnedBuild: string | null; hostState: string; circuitOpen: boolean; lastReason: string | null };
  modelPack: AiModelPackView & { sha256: string | null; sizeBytes: number | null; manifestEntries: number };
  threads: number;
  counters: { completed: number; failed: number; cancelled: number; rejected: number; yielded: number };
}

export interface AiAuditView {
  records: AiActionRecord[];
  total: number;
}

export const AI_AUDIT_PAGE_MAX = 200;
const ACTION_ID = /^[^\p{Cc}]{1,200}$/u;

export function sanitizeAuditPage(input: unknown): { limit: number; offset: number } {
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const int = (value: unknown, fallback: number, max: number): number =>
    typeof value === "number" && Number.isInteger(value) && value >= 0 ? Math.min(value, max) : fallback;
  return { limit: Math.max(1, int(raw.limit, 50, AI_AUDIT_PAGE_MAX)), offset: int(raw.offset, 0, Number.MAX_SAFE_INTEGER) };
}

export function sanitizeActionId(input: unknown): string | null {
  return typeof input === "string" && ACTION_ID.test(input) ? input : null;
}

export function sanitizeFeatureId(input: unknown): AiFeatureId | null {
  return isAiFeatureId(input) ? input : null;
}

/**
 * Authorize an AI management call and turn its failure into a code. Reuses the semantic contract's
 * rule (only `SecurityError` is translated; anything else rethrows) with an AI-specific sentence.
 */
export async function authorizeAiAction(
  assert: () => Promise<unknown>
): Promise<{ ok: true } | { ok: false; code: "REAUTH_REQUIRED" | "NOT_AUTHORIZED"; message: string }> {
  const auth = await authorizeSemanticAction(assert);
  if (auth.ok) return auth;
  return auth.code === "REAUTH_REQUIRED"
    ? { ok: false, code: "REAUTH_REQUIRED", message: auth.message }
    : { ok: false, code: "NOT_AUTHORIZED", message: "You are not authorized to manage local AI." };
}
