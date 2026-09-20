import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Sparkles, Undo2 } from "lucide-react";

import type { AiStatusView, FlowLocatorUpgradesView } from "@src/ai/contracts/AiApi";
import {
  appliedEvidence,
  describeCandidate,
  pendingEvidence,
  qualityEvidence,
  resolveLocatorStatus,
  type LocatorEvidenceRow
} from "@src/ai/locatorStatus";
import type { LocatorQualityClassification } from "@src/recorder/LocatorQualityClass";
import { Permission } from "@src/security/authz/Permissions";

import { usePermissions } from "../../security/usePermissions";

const api = () => window.playwrightFlowStudio.ai;

/**
 * The Intelligent Locator surface for one step (Phase L, L3 §10).
 *
 * One badge states what the step's locator IS — its L2 quality class when no AI is involved, and the
 * upgrade lifecycle state when a proposal or an applied upgrade exists — and one disclosure holds the
 * evidence behind it. The badge, its tone and its sentence all come from `resolveLocatorStatus`, so
 * this component decides nothing about the lifecycle; it renders what that table says.
 *
 * Four things this panel deliberately does NOT do:
 *
 *  - It does not decide whether an apply is allowed. `promotable`/`blockedReason` come from a dry run
 *    of the same promotion operation that performs the write, so a disabled button is a consequence
 *    of the trusted answer, never what makes the promotion safe. Main re-derives everything at the
 *    write; a renderer calling the IPC directly is refused for the same reasons.
 *  - It does not re-prove anything. Every evidence row is read from a record the trusted pipeline
 *    already wrote, and a record that does not exist renders as *unavailable* — opening the
 *    disclosure triggers no navigation, no AI call and no run.
 *  - It does not fold AI runtime availability into the locator badge. A missing model is its own
 *    line: the locator's quality, and the whole Flow Designer, are unchanged by it.
 *  - It does not reconstruct locator state. The saved locator, the proposal and the provenance are
 *    all read from main; only this editor's unsaved-changes flag is local, because it changes faster
 *    than a fetched view can be refreshed.
 */
export function LocatorUpgradeSection({
  flowId,
  stepId,
  quality,
  editorDirty,
  onApplied
}: {
  flowId: string;
  stepId: string;
  /** L2 classification of the locator as this editor currently holds it. */
  quality: LocatorQualityClassification | undefined;
  /** The editor has unsaved changes; a promotion would be undone by the next save, so it is deferred. */
  editorDirty: boolean;
  /** The saved flow changed on disk: the designer must reload it rather than keep its stale copy. */
  onApplied: () => void;
}) {
  const { can } = usePermissions();
  const canUseAi = can(Permission.AI_USE);
  const canEditFlow = can(Permission.WORKFLOW_EDIT);
  const [view, setView] = useState<FlowLocatorUpgradesView | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatusView | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; message: string } | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  /**
   * Monotonic request token. Every fetch captures the value it started with and writes its result
   * only if it is still the newest — so a slow answer for the flow the user just left can never
   * replace a fast answer for the one they are looking at now, and a failed or superseded request
   * never leaves the panel loading forever.
   */
  const request = useRef(0);

  const load = useCallback(async () => {
    const token = (request.current += 1);
    if (!canUseAi || !flowId) {
      setView(null);
      setAiStatus(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    // Settled, not raced: one slow call must not hold the other's result back, and either may fail
    // on its own — an unreadable AI status is not a reason to hide the locator's own evidence.
    const [upgrades, status] = await Promise.allSettled([api().listUpgrades(flowId), api().getStatus()]);
    if (token !== request.current) return;
    setView(upgrades.status === "fulfilled" ? upgrades.value : null);
    setAiStatus(status.status === "fulfilled" ? status.value : null);
    setLoading(false);
  }, [canUseAi, flowId]);

  /*
   * Two separate resets, because the two identities have different scopes and conflating them is a
   * real defect: the fetched view is per FLOW, and `load` only re-runs when the flow changes.
   *
   *  - Flow change: discard the answer AND any response still in flight for the old flow, so the
   *    panel can never paint one flow's proposal under another flow's step. `load` refetches.
   *  - Step change WITHIN a flow: the view is still valid — the per-step lookup below is what
   *    isolates the steps — so only the transient UI is reset. Clearing the view here instead would
   *    leave it null forever, because nothing would refetch it.
   */
  useEffect(() => {
    request.current += 1;
    setView(null);
  }, [flowId]);

  useEffect(() => {
    setNotice(null);
    setEvidenceOpen(false);
  }, [flowId, stepId]);

  useEffect(() => {
    void load();
  }, [load, editorDirty]);

  const pending = view?.pending.find((entry) => entry.stepId === stepId);
  const applied = view?.applied.find((entry) => entry.stepId === stepId);
  const status = resolveLocatorStatus({ quality, pending, applied, editorDirty });

  const evidence: LocatorEvidenceRow[] = [
    ...qualityEvidence(quality),
    ...(pending ? pendingEvidence(pending) : []),
    ...(applied ? appliedEvidence(applied) : [])
  ];

  const run = async (call: () => Promise<{ ok: boolean; message?: string }>, success: string): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      const response = await call();
      // Success is claimed only for what the main process actually accepted. A refused or failed
      // write reports its own reason and leaves the badge on whatever the next load reads back.
      setNotice(
        response.ok
          ? { tone: "ok", message: response.message ?? success }
          : { tone: "error", message: response.message ?? "That could not be done." }
      );
      if (response.ok) onApplied();
    } catch {
      setNotice({ tone: "error", message: "That could not be done." });
    } finally {
      setBusy(false);
      await load();
    }
  };

  const aiUnavailable = canUseAi && aiStatus !== null && (!aiStatus.enabled || aiStatus.state === "unavailable" || aiStatus.state === "error");

  return (
    <div className="locator-status" data-testid="locator-upgrade-section">
      <div className="locator-status-head">
        <span
          className={`locator-status-badge tone-${status.tone}`}
          data-testid="locator-quality-class"
          data-locator-badge={status.badge}
          data-quality-class={quality?.class ?? ""}
        >
          {status.label}
        </span>
        {loading ? (
          <span className="locator-status-loading" data-testid="locator-status-loading">
            Checking…
          </span>
        ) : null}
      </div>

      {/*
        One live region for the whole panel. The badge label is inside it, so a state change is
        announced as a sentence ("AI semantic (replay-proven). Verified on enough runs…") rather than
        as a colour change, and nothing here depends on colour to be understood.
      */}
      <span
        className="locator-status-headline"
        data-testid="locator-upgrade-state"
        data-upgrade-state={status.state}
        role="status"
      >
        {status.headline}
      </span>

      {/*
        The two locators being compared stay in the compact view rather than behind the disclosure:
        they are the decision itself, not evidence supporting it, and "which locator runs right now"
        must be answerable without opening anything. The gates, counts and provenance are on demand.
      */}
      {pending ? (
        <span className="locator-status-compare">
          Now: {describeCandidate(pending.current)} · Proposed: {describeCandidate(pending.proposed)}
        </span>
      ) : null}

      {aiUnavailable ? (
        <span className="locator-status-ai" data-testid="locator-ai-availability" data-ai-state={aiStatus?.state ?? "unknown"}>
          Local AI is {aiStatus?.enabled === false ? "turned off" : "unavailable"}, so no new locator suggestions are made. Recording and
          running this flow are unaffected.
        </span>
      ) : null}

      <details
        className="locator-status-evidence"
        data-testid="locator-evidence"
        open={evidenceOpen}
        onToggle={(event) => setEvidenceOpen((event.currentTarget as HTMLDetailsElement).open)}
      >
        <summary data-testid="locator-evidence-toggle">Why this status</summary>
        <dl className="locator-evidence-list">
          {evidence.map((row) => (
            <div key={row.id} className="locator-evidence-row" data-evidence={row.id} data-unavailable={row.unavailable ? "true" : undefined}>
              <dt>{row.label}</dt>
              <dd>
                {row.value}
                {row.unavailable ? <span className="locator-evidence-missing"> (not available)</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      </details>

      {canEditFlow && pending && status.applyVisible ? (
        <button
          className="toolbar-button primary"
          data-testid="apply-locator-upgrade"
          // Disabled is a consequence of main's answer, never the thing that makes a promotion safe:
          // `promoteUpgrade` re-derives every precondition and refuses a renderer that calls it anyway.
          disabled={busy || !status.applyOffered}
          type="button"
          onClick={() => void run(() => api().promoteUpgrade({ flowId, stepId, createdAt: pending.createdAt }), "Upgrade applied. You can revert it here or from Settings.")}
        >
          <Sparkles size={15} aria-hidden="true" />
          Apply upgrade
        </button>
      ) : null}

      {applied ? (
        <span data-testid="locator-upgrade-applied" className="locator-status-applied">
          Previous locator kept for revert. Open “Why this status” for the full record.
        </span>
      ) : null}

      {canEditFlow && applied ? (
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

      {notice ? (
        <span className={notice.tone === "error" ? "form-message error" : "form-message"} role="alert">
          {notice.tone === "error" ? <AlertTriangle size={13} style={{ verticalAlign: "-2px" }} /> : <CheckCircle2 size={13} style={{ verticalAlign: "-2px" }} />}{" "}
          {notice.message}
        </span>
      ) : null}
    </div>
  );
}
