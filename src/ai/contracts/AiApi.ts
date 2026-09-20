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
import type { LocatorCandidate, LocatorContext, PendingProofEvidence } from "../../profiles/FlowProfile";
import type { LocatorQualityClass } from "../../recorder/LocatorQualityClass";
import { isAiFeatureId, type AiFeatureId, type AiTier } from "../../security/authz/AiAutonomyPolicy";
import type { AiActionRecord } from "../AiActionRecord";
import type { LocatorPromotionRefusal } from "../locatorPromotion";
import type { PendingUpgradeState } from "../pendingUpgrade";

export type AiReasonCode =
  | "OK"
  | "NOT_AVAILABLE"
  | "INVALID_REQUEST"
  | "SETTINGS_REJECTED"
  | "IMPORT_REFUSED"
  | "IMPORT_CANCELLED"
  | "REVERT_REFUSED"
  | "PROMOTION_REFUSED"
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

/**
 * One step's unpromoted AI locator candidate, as the Flow Designer may show it (Phase L, L3 §6).
 *
 * It carries the two locators being compared and the verification counts, never a prompt, model
 * text, page text or a typed value: the candidate is a compiler-validated locator that the intent
 * guard already proved is not a bound data value, and it is already stored in the saved flow.
 * `promotable` and `blockedReason` are the main process's own answer, recomputed on every read —
 * the renderer decides what to render with them, never whether the write is allowed. They answer
 * "is this candidate itself ready", NOT "may it be applied this instant": unsaved editor changes are
 * reported separately on {@link FlowLocatorUpgradesView} because they change faster than this view
 * can be fetched and cached, and the renderer knows its own dirty state without asking.
 */
export interface PendingLocatorUpgradeView {
  stepId: string;
  stepName: string;
  state: PendingUpgradeState;
  /** `repair-proven` is L3 §8: proven against a saved identity while the baseline was failing. */
  proof: "unprovable-now" | "capture-proven" | "repair-proven";
  meaningChange: boolean;
  replays: number;
  dataRows: number;
  minReplays: number;
  minDataRows: number;
  createdAt: string;
  modelId: string;
  /** The saved locator this would replace. */
  current: LocatorCandidate;
  /** The proposed replacement. */
  proposed: LocatorCandidate;
  /**
   * The scope the candidate was compiled and proven under (L3 §10 "proposed scope" and "proof
   * location"). Containers, frame chain and shadow boundary only — the same structure the runner
   * resolves, carrying no page text beyond the container `hasText` the compiler already validated.
   */
  proposedContext?: LocatorContext;
  /**
   * What the capture-time proof established. Optional by design: absent means the fact was never
   * recorded, which the UI must render as unavailable rather than as a gate that passed.
   */
  proofEvidence?: PendingProofEvidence;
  promotable: boolean;
  blockedReason: LocatorPromotionRefusal | null;
}

/** A promotion that was applied to this step, and whether its one-click revert would still be accepted. */
export interface AppliedLocatorUpgradeView {
  stepId: string;
  stepName: string;
  actionId: string;
  tier: "T1" | "T2";
  appliedAt: string;
  /** False once the promoted locator was edited: revert is refused rather than overwriting that edit. */
  revertable: boolean;
  previous: LocatorCandidate;
  /**
   * The retained locator's L2 class and whether it kept a positional identity guard (L3 §10 names the
   * revert target as "the retained guarded locator"). Classified in the main process, which holds the
   * whole previous locator; only the class and the flag cross, never its identity or capture evidence.
   */
  previousQualityClass?: LocatorQualityClass;
  previousGuarded: boolean;
  /** Provenance of the applied change. Codes and ids only; no prompt and no model output. */
  source: "ai-semantic-upgrade" | "ai-repair";
  proof: "capture-proven" | "replay-proven" | "repair-proven";
  modelId: string;
}

export interface FlowLocatorUpgradesView {
  flowId: string;
  pending: PendingLocatorUpgradeView[];
  applied: AppliedLocatorUpgradeView[];
  /**
   * Main's own view of whether some renderer has unsaved changes for this flow. Informational for a
   * renderer (which knows its own state sooner); authoritative for anything driven from main.
   */
  editorDirty: boolean;
}

export interface LocatorPromotionRequest {
  flowId: string;
  stepId: string;
  /** The exact pending candidate the user reviewed; a newer one is refused rather than applied. */
  createdAt: string;
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

/** A profile/step identifier: bounded, no control characters, no path separators. */
export function sanitizeProfileId(input: unknown): string | null {
  return typeof input === "string" && ACTION_ID.test(input) && !/[/\\]/.test(input) ? input : null;
}

/**
 * Rebuild a promotion request from its known fields, dropping everything else (the `SemanticApi`
 * rule). Nothing here authorizes anything: the flow, the step and the candidate's `createdAt` only
 * NAME what the main process then re-reads and re-proves for itself.
 */
export function sanitizePromotionRequest(input: unknown): LocatorPromotionRequest | null {
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : null;
  if (!raw) return null;
  const flowId = sanitizeProfileId(raw.flowId);
  const stepId = sanitizeProfileId(raw.stepId);
  const createdAt =
    typeof raw.createdAt === "string" && raw.createdAt.length <= 40 && !Number.isNaN(Date.parse(raw.createdAt)) ? raw.createdAt : null;
  return flowId && stepId && createdAt ? { flowId, stepId, createdAt } : null;
}

/** The renderer's report that it has a flow open, and whether that editor has unsaved changes. */
export function sanitizeFlowEditorState(input: unknown): { flowId: string; dirty: boolean } | null {
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : null;
  const flowId = raw ? sanitizeProfileId(raw.flowId) : null;
  return flowId && typeof raw?.dirty === "boolean" ? { flowId, dirty: raw.dirty } : null;
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
