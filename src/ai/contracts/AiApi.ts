/**
 * Renderer-facing local-AI contract (Phase L, L1.1 and L1.5).
 *
 * Everything that crosses IPC is defined and sanitized here, in one pure module, so the main-process
 * handlers and their verifiers apply identical rules (the `SemanticApi.ts` pattern: unknown
 * properties are dropped, present-but-malformed values are errors, codes not messages).
 *
 * The renderer gets status, settings, the model pack, diagnostics, the audit log and revert, plus
 * named assist jobs (L4b). It never gets a channel that carries prompt text, names a model file,
 * starts a process or returns a path: an assist request names data main re-validates and builds the
 * prompt from itself, and model import picks its file in the main process.
 *
 * Framework-agnostic and renderer-safe: types and pure functions only.
 */

import { authorizeSemanticAction } from "../../semantic/contracts/SemanticApi";
import type { FlowProfile, LocatorCandidate, LocatorContext, PendingProofEvidence } from "../../profiles/FlowProfile";
import type { LocatorQualityClass } from "../../recorder/LocatorQualityClass";
import type { RecordedAction } from "../../recorder/RecorderTypes";
import type { FailureAnalysisBody, StoredFailureAnalysis } from "../../reports/ExecutionReport";
import { isAiFeatureId, type AiFeatureId, type AiTier } from "../../security/authz/AiAutonomyPolicy";
import type { FlowValidationIssue } from "../../validation/FlowValidator";
import type { AiActionRecord } from "../AiActionRecord";
import type { AiLoadStage } from "../AiExecutionProfile";
import type { AiEtaEstimate, AiJobKind, AiJobStatus } from "../AiJobStatus";
import type { AiQualificationView } from "../AiQualification";
import type { AiBudgetId } from "../AiTimeBudgets";

/** L9.1: the one job-status contract, as the owning window receives it on `ai:jobStatus`. */
export type { AiEtaEstimate, AiJobStatus, AiJobKind } from "../AiJobStatus";
import type { ExplanationWithholdReason } from "../authoringClaimScreen";
import type { LocatorPromotionRefusal } from "../locatorPromotion";
import type { PendingUpgradeState } from "../pendingUpgrade";

export type AiReasonCode =
  | "OK"
  | "NOT_AVAILABLE"
  | "INVALID_REQUEST"
  | "SETTINGS_REJECTED"
  | "IMPORT_REFUSED"
  | "IMPORT_CANCELLED"
  | "VERIFY_FAILED"
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
  /** `registered` (L8b.1): a model the manifest does not list, copied, not loaded until its compatibility stages pass. */
  status: "missing" | "installed" | "registered" | "invalid" | "incompatible";
  /**
   * For `registered`: `COMPATIBLE` (both stages passed), `STATIC_PASSED` (the header passed, the probe has
   * not run for this runtime), the failed check (L8b.2, L8b.3), or null when not checked for this runtime.
   */
  reason: string | null;
  modelId: string | null;
  displayName: string | null;
  /** For `registered` (L8b.5, E7): whether an administrator acknowledged it as unverified. Null otherwise. */
  acknowledged: boolean | null;
  /** L8b.4 labels for the configuration the model runs in; null with no usable model file. */
  qualification: AiQualificationView | null;
}

/**
 * What importing the model file the main process just picked would need (L8b.5, E1), shown before any
 * copy. The file's own name only, never its folder. Import names it by `token`.
 */
export interface AiModelPreflightView {
  /** One-time token for `importModelPack`; empty when the file cannot be imported. */
  token: string;
  fileName: string;
  sizeBytes: number;
  /** Free space in the app's model folder; null when it cannot be measured (the import then refuses). */
  freeBytes: number | null;
  requiredBytes: number;
  headroomBytes: number;
  spaceOk: boolean;
}

export interface AiModelPreflightResponse extends AiAdminResponse {
  preflight: AiModelPreflightView | null;
}

/**
 * Where the model runs (L8a.3): the configured mode, the backend actually used, the layers on the GPU,
 * and why a GPU mode fell back to CPU or refused. Numbers are bytes; nothing names a path or a device.
 */
export interface AiExecutionView {
  /** The CONFIGURED mode; "auto" ran as GPU-Offload or CPU & RAM only, as `ranAs` says. */
  mode: "auto" | "cpu" | "gpu-offload" | "gpu-only";
  /** The mode the load RAN as, which Automatic resolves to at each load; never "auto". */
  ranAs: "cpu" | "gpu-offload" | "gpu-only";
  backend: "cpu" | "vulkan";
  gpuLayers: number;
  totalLayers: number | null;
  requestedLayers: number | null;
  /** Null unless `applied`: a reason found under another mode or reserve is not reported. */
  fallbackReason: string | null;
  refusal: { reason: string; requiredBytes: number | null; availableBytes: number | null } | null;
  /** Short, safe sentence for the fallback or refusal reason. */
  message: string | null;
  /** The runtime's own VRAM figures at this load's plan; null when no GPU plan ran. */
  vram: { totalBytes: number; freeBytes: number; reserveBytes: number; fullRequiredBytes: number } | null;
  /** (L8a.4) The fields above come from a load made under the configured mode and reserve. */
  applied: boolean;
  modelLoaded: boolean;
  /** What a model load is doing now; null when none is in progress. */
  stage: AiLoadStage | null;
  /** GPU readiness right now (backend pack, then E2 adapters), as the next GPU load would decide it. */
  gpuReadiness: { ok: boolean; nvidiaAdapters: number; reason: string | null; message: string | null };
}

/**
 * L9.4: how long a kind of job has taken ON THIS MACHINE for the configuration AI runs in now (the latency
 * class, E6), from the ETA history: running time only, cold (it loaded the model) and warm apart. A
 * measurement, never a qualification or a promise.
 */
export interface AiMeasuredSpeed {
  kind: AiJobKind;
  cold: AiEtaEstimate | null;
  warm: AiEtaEstimate | null;
}

export interface AiStatusView {
  enabled: boolean;
  state: "available" | "unavailable" | "loading" | "busy" | "error";
  /** Stable code explaining an unavailable or error state. */
  reason: string | null;
  holdReason: string | null;
  queueDepth: number;
  modelPack: AiModelPackView;
  execution: AiExecutionView;
  /** Measured locally; empty when nothing has been measured for this configuration yet. */
  measuredSpeed: AiMeasuredSpeed[];
}

/** L9.2: one time budget as Settings shows it, in seconds, with its committed bounds. */
export interface AiBudgetView {
  id: AiBudgetId;
  label: string;
  seconds: number;
  defaultSeconds: number;
  minSeconds: number;
  maxSeconds: number;
  /** An administrator set it; false is the committed default. */
  configured: boolean;
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
  executionMode: "auto" | "cpu" | "gpu-offload" | "gpu-only";
  /** Null is the runtime's own system-derived padding. */
  vramReserveMb: number | null;
  minVramReserveMb: number;
  maxVramReserveMb: number;
  budgets: AiBudgetView[];
}

export interface AiDiagnosticsView {
  runtime: { included: boolean; pinnedBuild: string | null; hostState: string; circuitOpen: boolean; lastReason: string | null };
  /** The GPU host's process state (L8a.3); stopped whenever no GPU mode is in use. */
  gpuHost: { state: string; circuitOpen: boolean; lastReason: string | null };
  modelPack: AiModelPackView & { sha256: string | null; sizeBytes: number | null; manifestEntries: number };
  execution: AiExecutionView;
  /** Display adapters by PCI vendor ID (E2); null when they cannot be read. Never a device name. */
  adapters: Array<{ vendorId: string; nvidia: boolean; software: boolean }> | null;
  threads: number;
  counters: { completed: number; failed: number; cancelled: number; rejected: number; yielded: number };
}

export interface AiAuditView {
  records: AiActionRecord[];
  total: number;
}

/**
 * The GPU backend pack (L8a.2). Installed means validated and copied into the app-managed folder; it
 * says nothing about a GPU being used, which is L8a.3's execution mode.
 */
export interface AiBackendPackView {
  backend: string | null;
  pinnedBuild: string | null;
  packageVersion: string | null;
  status: "unavailable" | "not-installed" | "installed" | "invalid";
  /** Stable refusal code for an invalid or unavailable pack. */
  reason: string | null;
  /** Short, safe sentence for that code; the only path it may name is a file inside the pack. */
  message: string | null;
  sizeBytes: number | null;
  fileCount: number | null;
  installedAt: string | null;
  lastVerifiedAt: string | null;
  importing: { phase: "copying" | "verifying" | "promoting"; doneBytes: number; totalBytes: number } | null;
}

/**
 * The checklist shown before any copy. The ONE local-AI view that carries paths, because the owner
 * requires the user to see what is copied from where: the folder the user just picked in main's own
 * dialog, and the app-managed destination. They are display strings only. The import names the
 * checked folder by `token`, so no renderer-supplied path is ever acted on.
 */
export interface AiBackendPreflightView {
  /** One-time token for `importBackendPack`; empty when the folder is not ready to import. */
  token: string;
  ready: boolean;
  backend: string | null;
  pinnedBuild: string | null;
  packageVersion: string | null;
  source: string;
  destination: string;
  requiredBytes: number;
  headroomBytes: number;
  availableBytes: number | null;
  identicalInstalled: boolean;
  filesValidated: number;
  fileCount: number;
  checks: Array<{ id: string; state: "pass" | "fail" | "skipped"; detail: string }>;
}

export interface AiBackendPreflightResponse extends AiAdminResponse {
  preflight: AiBackendPreflightView | null;
}

/** A one-time checklist token: the backend pack's (L8a.2) and the model file's (L8b.5). */
export function sanitizeBackendPreflightToken(input: unknown): string | null {
  return typeof input === "string" && /^[0-9a-f]{32}$/.test(input) ? input : null;
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
 * Outcome of one user-requested AI assist job (L4b now; L5b and L6 reuse it). Codes only: when the
 * model's answer is refused the renderer learns `OUTPUT_REJECTED`, never what the answer said.
 */
export type AiAssistCode =
  | "OK"
  /** The validator found nothing, so there is nothing to ask. */
  | "NOTHING_TO_ASK"
  /** The feature's policy forbids it (a tier or a demotion), with the master switch on. */
  | "FORBIDDEN"
  | "DISABLED"
  | "UNAVAILABLE"
  /** The queue is full, or active runs kept the job waiting past its yield limit. */
  | "BUSY"
  | "CANCELLED"
  | "TIMEOUT"
  | "FAILED"
  | "OUTPUT_REJECTED"
  | "INVALID_REQUEST"
  /** The named subject (a fragment) no longer exists. */
  | "NOT_FOUND"
  | "REAUTH_REQUIRED"
  | "NOT_AUTHORIZED"
  /** L3 T3: a sensitive or sign-in element. No proposal is ever asked for. */
  | "PROTECTED"
  /** L3: no proposal was proven on the page (refused, exhausted, or the page changed meanwhile). */
  | "NOT_PROVEN"
  /** L3 U1: the chosen step cannot take this proposal (another page, frame or element; not an element step). */
  | "NOT_APPLICABLE";

export interface AiAssistStatus {
  code: AiAssistCode;
  ok: boolean;
  /** Short, product-authored sentence; never model or runtime text. */
  message?: string;
  modelId?: string;
}

/** L4b: explain the validation report of the flow the renderer has open, saved or not. */
export interface AuthoringAssistRequest {
  /** The renderer's cancellation key. Main scopes it to the asking window. */
  requestId: string;
  /** Validated again in main; it only NAMES what to validate, it is never prompt text. */
  profile: FlowProfile;
}

export interface AuthoringAssistView extends AiAssistStatus {
  /**
   * T0 prose, each attached to the validator's own issue. Always shown labelled as AI. `step` is the
   * product's corrective step for the issue, never model text, and is shown labelled as the rule's.
   * `text` is `null` when the display gate withheld it (R4); `withheld` then says why, and the issue and
   * its step are shown without it.
   */
  explanations: Array<{ issue: FlowValidationIssue; text: string | null; step: string; withheld?: ExplanationWithholdReason[] }>;
  /** T1: validator-emitted safe-fix issues in the suggested order. Empty unless the tier permits suggesting. */
  ranking: FlowValidationIssue[];
  /** Issues beyond the per-request cap that were not sent, so the UI never implies completeness. */
  truncated: number;
}

/** L6: describe a saved fragment. It names the fragment; main reads it from the store. */
export interface FragmentSummaryAssistRequest {
  requestId: string;
  fragmentId: string;
}

export interface FragmentSummaryView extends AiAssistStatus {
  fragmentId: string;
  /** T0 prose, always shown labelled as AI. Null unless `ok`. */
  summary: string | null;
}

export function sanitizeFragmentSummaryRequest(input: unknown): FragmentSummaryAssistRequest | null {
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : null;
  const requestId = raw ? sanitizeAssistRequestId(raw.requestId) : null;
  const fragmentId = raw ? sanitizeProfileId(raw.fragmentId) : null;
  return requestId && fragmentId ? { requestId, fragmentId } : null;
}

/**
 * L3 §1, Element Spy: propose a stronger locator for the element inspected right now. The request
 * carries only its cancel key; main reads the live inspection, its page and its context itself.
 */
export interface InspectionLocatorRequest {
  requestId: string;
}

export interface InspectionLocatorView extends AiAssistStatus {
  /** The inspection this answers, so the renderer drops it once a newer element is inspected. */
  inspectedAt: string | null;
  /**
   * Only a candidate proven on the live page right now: it builds, matches one element, and that
   * element IS the inspected one. Compiler-validated, labelled AI, shown only, and never stored or applied.
   */
  proposal: { candidate: LocatorCandidate; context?: LocatorContext; meaningChange: boolean } | null;
  attemptsUsed: number;
}

export function sanitizeInspectionLocatorRequest(input: unknown): InspectionLocatorRequest | null {
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : null;
  const requestId = raw ? sanitizeAssistRequestId(raw.requestId) : null;
  return requestId ? { requestId } : null;
}

/**
 * L3 U1 (owner decision D2, 2026-09-24): attach the proven proposal answered to `requestId` to one
 * recorded draft step as a pending candidate. Ids only: main holds the proposal, the inspection and the
 * draft, proves the candidate again against that step, and never takes a candidate, a proof or a
 * provenance from the renderer. The step's own locator is not changed.
 */
export interface InspectionAttachRequest {
  requestId: string;
  actionId: string;
}

export interface InspectionAttachView extends AiAssistStatus {
  /** Main's draft after the attach; null unless `ok`. */
  actions: RecordedAction[] | null;
}

export function sanitizeInspectionAttachRequest(input: unknown): InspectionAttachRequest | null {
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : null;
  const requestId = raw ? sanitizeAssistRequestId(raw.requestId) : null;
  const actionId = raw && typeof raw.actionId === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(raw.actionId) ? raw.actionId : null;
  return requestId && actionId ? { requestId, actionId } : null;
}

/** L5b: interpret one failed instance of a stored run. It names the run and the instance; main reads the report. */
export interface FailureAnalysisAssistRequest {
  requestId: string;
  executionId: string;
  instanceId: string;
}

export interface FailureAnalysisView extends AiAssistStatus {
  instanceId: string;
  /** Failed instances in this run sharing the failure's signature. The interpretation applies to all of them. */
  coalescedCount: number;
  /** T0. Evidence ids refer to the named instance's own captured evidence. Null unless `ok`. */
  analysis: FailureAnalysisBody | null;
  /** True when the answer was saved with the run's report; false when it could only be shown. */
  stored?: boolean;
}

/** The stored analysis to delete: the one covering this instance of this run. */
export type FailureAnalysisTarget = Omit<FailureAnalysisAssistRequest, "requestId">;

export function sanitizeFailureAnalysisTarget(input: unknown): FailureAnalysisTarget | null {
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : null;
  const executionId = raw ? sanitizeProfileId(raw.executionId) : null;
  const instanceId = raw ? sanitizeProfileId(raw.instanceId) : null;
  return executionId && instanceId ? { executionId, instanceId } : null;
}

export function sanitizeFailureAnalysisRequest(input: unknown): FailureAnalysisAssistRequest | null {
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : null;
  const requestId = raw ? sanitizeAssistRequestId(raw.requestId) : null;
  const target = sanitizeFailureAnalysisTarget(input);
  return requestId && target ? { requestId, ...target } : null;
}

const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

/**
 * The stored L5b analysis covering `instanceId` — its own, or a coalesced member's — from a run report
 * read back from disk. Shape-checked, because a report file is data: a malformed entry reads as none.
 */
export function storedFailureAnalysisFor(report: unknown, instanceId: string): StoredFailureAnalysis | null {
  const analyses = (report as { diagnostics?: { analyses?: unknown } } | null)?.diagnostics?.analyses;
  if (!Array.isArray(analyses)) return null;
  const entry = analyses.find((item) => isStringList(item?.instanceIds) && item.instanceIds.includes(instanceId)) as Record<string, unknown> | undefined;
  const body = entry?.analysis as Record<string, unknown> | undefined;
  const valid =
    entry?.version === 1 &&
    typeof entry.signature === "string" &&
    typeof entry.instanceId === "string" &&
    typeof entry.createdAt === "string" &&
    typeof body?.insufficient === "boolean" &&
    typeof body.category === "string" &&
    typeof body.explanation === "string" &&
    isStringList(body.primaryEvidenceIds) &&
    isStringList(body.secondaryEvidenceIds) &&
    isStringList(body.investigationSteps);
  return valid ? (entry as unknown as StoredFailureAnalysis) : null;
}

export const AI_ASSIST_MAX_NODES = 2_000;
const ASSIST_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

export function sanitizeAssistRequestId(input: unknown): string | null {
  return typeof input === "string" && ASSIST_REQUEST_ID.test(input) ? input : null;
}

/**
 * Rebuild an L4b request from its known fields. Shape only: nothing here trusts the profile, which
 * main validates with the real `FlowValidator` and never persists.
 */
export function sanitizeAuthoringAssistRequest(input: unknown): AuthoringAssistRequest | null {
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : null;
  const requestId = raw ? sanitizeAssistRequestId(raw.requestId) : null;
  const profile = raw && typeof raw.profile === "object" && raw.profile !== null ? (raw.profile as Record<string, unknown>) : null;
  if (!requestId || !profile) return null;
  const id = sanitizeProfileId(profile.id);
  const nodes = profile.nodes;
  const edges = profile.edges ?? [];
  if (!id || !Array.isArray(nodes) || !Array.isArray(edges)) return null;
  if (nodes.length > AI_ASSIST_MAX_NODES || edges.length > AI_ASSIST_MAX_NODES * 2) return null;
  return { requestId, profile: { ...(profile as unknown as FlowProfile), id, nodes, edges } };
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
