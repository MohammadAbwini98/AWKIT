/**
 * One-click revert of an applied AI change (Phase L, L1.4; docs/ai/DECISIONS.md 2026-09-19).
 *
 * Revert is compare-and-swap: `locatorProvenance.previous` is restored only while the step still
 * matches `locatorProvenance.binding`, so an edit a user made after the change is never
 * overwritten. The prior value lives on the step, never in the `AiActionRecord`, so revert keeps
 * working if the audit log is lost; the record is only marked afterwards.
 *
 * Revert never needs the model or the AI service. Framework-agnostic: stores are injected.
 */

import type { FlowProfile, StepLocator } from "../profiles/FlowProfile";
import { locatorBindingMatches } from "../profiles/locatorApproval";
import type { AiActionRecord } from "./AiActionRecord";

export type AiLocatorRevertRefusal = "STEP_NOT_FOUND" | "NO_AI_PROVENANCE" | "ACTION_MISMATCH" | "STALE";

export type AiLocatorRevertResult = { ok: true; profile: FlowProfile } | { ok: false; code: AiLocatorRevertRefusal };

/** Pure. Run it inside the flow store's folder lane (`JsonProfileStore.updateWith`). */
export function revertAiLocatorChange(
  profile: FlowProfile,
  stepId: string,
  actionId: string,
  nowIso: string
): AiLocatorRevertResult {
  const index = profile.nodes.findIndex((node) => node.id === stepId);
  if (index < 0) return { ok: false, code: "STEP_NOT_FOUND" };
  const step = profile.nodes[index];
  const provenance = step.locator?.locatorProvenance;
  if (!provenance) return { ok: false, code: "NO_AI_PROVENANCE" };
  if (provenance.actionId !== actionId) return { ok: false, code: "ACTION_MISMATCH" };
  if (!locatorBindingMatches(provenance.binding, step)) return { ok: false, code: "STALE" };

  // One level only: a `previous` that somehow carries AI fields of its own must not resurrect them.
  const {
    locatorProvenance: _provenance,
    pendingUpgrade: _pending,
    ...previous
  } = provenance.previous as StepLocator & { pendingUpgrade?: unknown };
  const nodes = profile.nodes.slice();
  nodes[index] = { ...step, locator: previous };
  return { ok: true, profile: { ...profile, nodes, updatedAt: nowIso } };
}

export type AiRevertCode = "OK" | "NOT_FOUND" | "ALREADY_REVERTED" | "FLOW_NOT_FOUND" | "WRITE_FAILED" | AiLocatorRevertRefusal;

export interface AiRevertDeps {
  audit: {
    get(id: string): Promise<AiActionRecord | null>;
    markReverted(id: string, atIso: string): Promise<"marked" | "not-found" | "already-reverted">;
  };
  flows: {
    updateWith(id: string, change: (current: FlowProfile | null) => FlowProfile | undefined): Promise<FlowProfile | undefined>;
  };
  now?: () => number;
}

export interface AiRevertResponse {
  code: AiRevertCode;
  /** False when the flow was restored but the record could not be marked; the revert still stands. */
  auditMarked?: boolean;
}

export async function revertAiAction(actionId: string, deps: AiRevertDeps): Promise<AiRevertResponse> {
  const record = await deps.audit.get(actionId);
  if (!record) return { code: "NOT_FOUND" };
  if (record.reverted) return { code: "ALREADY_REVERTED" };

  const nowIso = new Date((deps.now ?? Date.now)()).toISOString();
  // Asserted, not annotated: the callback assigns it, and TS would otherwise keep the literal narrowing.
  let code = "FLOW_NOT_FOUND" as AiRevertCode;
  try {
    await deps.flows.updateWith(record.target.flowId, (current) => {
      if (!current) return undefined;
      const result = revertAiLocatorChange(current, record.target.stepId, record.id, nowIso);
      code = result.ok ? "OK" : result.code;
      return result.ok ? result.profile : undefined;
    });
  } catch {
    return { code: "WRITE_FAILED" };
  }
  if (code !== "OK") return { code };

  const marked = await deps.audit.markReverted(record.id, nowIso).catch(() => "failed" as const);
  return { code: "OK", auditMarked: marked === "marked" };
}
