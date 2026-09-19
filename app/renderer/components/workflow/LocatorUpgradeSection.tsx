import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Sparkles, Undo2 } from "lucide-react";

import type { FlowLocatorUpgradesView, PendingLocatorUpgradeView } from "@src/ai/contracts/AiApi";
import type { LocatorCandidate } from "@src/profiles/FlowProfile";
import { Permission } from "@src/security/authz/Permissions";

import { usePermissions } from "../../security/usePermissions";

const api = () => window.playwrightFlowStudio.ai;

/**
 * The locator-upgrade surface for one step (Phase L, L3 §6).
 *
 * It shows what local AI has suggested for this step, how far the suggestion has been verified on
 * real runs, whether it may be applied, and — once applied — the one-click revert. It renders only
 * facts the main process computed: `promotable` and `blockedReason` come from a dry run of the same
 * promotion operation that performs the write, so this panel can never offer a button the trusted
 * boundary would refuse, and disabling one is never what makes a promotion safe.
 *
 * The full badge vocabulary (L3 §10) is deliberately not here yet; this is the minimum that makes an
 * approved promotion reachable and an applied one reversible.
 */
export function LocatorUpgradeSection({
  flowId,
  stepId,
  editorDirty,
  onApplied
}: {
  flowId: string;
  stepId: string;
  /** The editor has unsaved changes; a promotion would be undone by the next save, so it is deferred. */
  editorDirty: boolean;
  /** The saved flow changed on disk: the designer must reload it rather than keep its stale copy. */
  onApplied: () => void;
}) {
  const { can } = usePermissions();
  const canUseAi = can(Permission.AI_USE);
  const canEditFlow = can(Permission.WORKFLOW_EDIT);
  const [view, setView] = useState<FlowLocatorUpgradesView | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; message: string } | null>(null);

  const load = useCallback(async () => {
    if (!canUseAi || !flowId) {
      setView(null);
      return;
    }
    try {
      setView(await api().listUpgrades(flowId));
    } catch {
      setView(null);
    }
  }, [canUseAi, flowId]);

  useEffect(() => {
    void load();
  }, [load, editorDirty]);

  const pending = view?.pending.find((entry) => entry.stepId === stepId);
  const applied = view?.applied.find((entry) => entry.stepId === stepId);
  if (!pending && !applied) return null;

  const run = async (call: () => Promise<{ ok: boolean; message?: string }>, success: string): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      const response = await call();
      setNotice(response.ok ? { tone: "ok", message: response.message ?? success } : { tone: "error", message: response.message ?? "That could not be done." });
      if (response.ok) onApplied();
    } catch {
      setNotice({ tone: "error", message: "That could not be done." });
    } finally {
      setBusy(false);
      await load();
    }
  };

  return (
    <div className="locator-review-state" data-testid="locator-upgrade-section" role="status">
      <strong>AI locator upgrade</strong>
      {pending ? (
        <>
          <span data-testid="locator-upgrade-state" data-upgrade-state={upgradeStateId(pending, editorDirty)}>{describePending(pending, editorDirty)}</span>
          <span>
            Now: {describeCandidate(pending.current)} · Proposed: {describeCandidate(pending.proposed)}
          </span>
          <span>
            Proven on {pending.replays} of {pending.minReplays} runs across {pending.dataRows} of {pending.minDataRows} data rows
            {pending.meaningChange ? " · changes what the step targets by meaning" : ""}
          </span>
          {canEditFlow ? (
            <button
              className="toolbar-button primary"
              data-testid="apply-locator-upgrade"
              disabled={busy || !pending.promotable || editorDirty}
              type="button"
              onClick={() =>
                void run(() => api().promoteUpgrade({ flowId, stepId, createdAt: pending.createdAt }), "Upgrade applied. You can revert it here or from Settings.")
              }
            >
              <Sparkles size={15} aria-hidden="true" />
              Apply upgrade
            </button>
          ) : null}
        </>
      ) : null}
      {applied ? (
        <>
          <span data-testid="locator-upgrade-applied">
            Applied {new Date(applied.appliedAt).toLocaleString()} ({applied.tier === "T2" ? "automatically, with proof" : "after your approval"}).
            Previous locator kept for revert: {describeCandidate(applied.previous)}.
          </span>
          {canEditFlow ? (
            <button
              className="toolbar-button"
              data-testid="revert-locator-upgrade"
              disabled={busy || !applied.revertable}
              type="button"
              onClick={() => void run(() => api().revert(applied.actionId), "Previous locator restored.")}
            >
              <Undo2 size={15} aria-hidden="true" />
              Revert to the previous locator
            </button>
          ) : null}
          {applied.revertable ? null : <span>The locator was edited after this change, so it is no longer reverted automatically.</span>}
        </>
      ) : null}
      {notice ? (
        <span className={notice.tone === "error" ? "form-message error" : "form-message"} role="alert">
          {notice.tone === "error" ? <AlertTriangle size={13} style={{ verticalAlign: "-2px" }} /> : <CheckCircle2 size={13} style={{ verticalAlign: "-2px" }} />}{" "}
          {notice.message}
        </span>
      ) : null}
    </div>
  );
}

function describeCandidate(candidate: LocatorCandidate): string {
  const name = candidate.name ? ` "${candidate.name}"` : "";
  return `${candidate.strategy} ${candidate.value}${name}${candidate.exact ? " (exact)" : ""}`;
}

/**
 * A stable id for the lifecycle state, so a verifier (and a screen reader's user, via the sentence
 * beside it) reads the state rather than parsing prose. `eligible` means only that the evidence is
 * in; whether the candidate itself may be applied is `promotable`, which the main process decided.
 * Unsaved changes are read from this editor's own state rather than the fetched view, which can
 * only ever be as fresh as its last fetch.
 */
function upgradeStateId(pending: PendingLocatorUpgradeView, editorDirty: boolean): string {
  if (pending.state !== "eligible") return pending.state;
  if (editorDirty) return "deferred-editor-dirty";
  return pending.promotable ? "eligible" : "blocked";
}

function describePending(pending: PendingLocatorUpgradeView, editorDirty: boolean): string {
  if (pending.state === "stale") return "This suggestion was made for an earlier version of the step and no longer applies.";
  if (pending.state === "replay-rejected") return "A run refused this suggestion, so it will never be applied.";
  if (pending.state !== "eligible") {
    return pending.proof === "capture-proven"
      ? "Suggested and proven once on the page. It is not applied, and runs keep using the saved locator until it is proven on more runs."
      : "Suggested but not yet proven on the page. It is not applied and is never executed.";
  }
  if (editorDirty) return "Verified and ready, but this flow has unsaved changes. Save the flow, then apply it.";
  if (pending.promotable) return "Verified on enough runs and ready to apply.";
  switch (pending.blockedReason) {
    case "EDITOR_DIRTY":
      return "Verified and ready, but this flow has unsaved changes. Save the flow, then apply it.";
    case "POLICY_REFUSED":
      return "Verified, but local AI is not permitted to change locators with the current settings.";
    case "BASELINE_NOT_PROMOTABLE":
      return "Verified, but this locator still needs review, so an AI upgrade cannot replace it.";
    case "T3_SENSITIVE_STEP":
    case "T3_PROTECTED_LOGIN":
    case "T3_STEP_UNKNOWN":
      return "AI never changes the locator of this kind of step.";
    default:
      return "Verified, but it cannot be applied right now.";
  }
}
