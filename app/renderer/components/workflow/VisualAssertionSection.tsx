import { useCallback, useEffect, useState } from "react";
import { Check, Eye, RefreshCw, RotateCcw, X } from "lucide-react";

import { Permission } from "@src/security/authz/Permissions";
import type { ConcurrentRunReport } from "@src/reports/ExecutionReport";
import type { VisualCandidateView } from "@src/runner/visualAssertion/visualAssertionApproval";
import { sanitizeVisualAssertionReportRecords, type VisualAssertionReportRecord } from "@src/runner/visualAssertion/visualAssertionReport";

import { visualAssertionSentence } from "../reports/VisualAssertionReportSection";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { ReauthDialog } from "../../pages/admin/ReauthDialog";
import { useSession } from "../../security/SessionContext";
import { usePermissions } from "../../security/usePermissions";
import { useSensitiveSemanticAction, type SensitiveAdminResponse } from "../../semantic/useSensitiveSemanticAction";

/**
 * N6.5 (awkit-vra.15.5): the Designer's Visual assertion section for an `assertVisual` node.
 *
 *  - MODE: observe or enforce. The packaged build offers observe only; an enforce step that arrives there (imported,
 *    hand-edited) is shown as unavailable, and it fails closed at run time (`enforce-unavailable-in-production`).
 *  - PENDING BASELINES: the step's memory-only candidates from earlier runs. Preview, approve and reject each need
 *    WORKFLOW_EDIT and a fresh re-authentication (`ReauthDialog`, retried once); the main process audits them. The
 *    preview is a transient image of the captured element only; nothing here ever holds a digest, key or token.
 *  - RESET removes every visual baseline and grant of this build (confirmed, re-authenticated, audited).
 *
 * Text first: every state is a sentence, never colour alone, and nothing animates.
 */

const api = () => window.playwrightFlowStudio.visualAssertions;

const MESSAGES: Readonly<Record<string, string>> = {
  NOT_AUTHORIZED: "You need permission to edit workflows for this action.",
  "candidate-unavailable": "This pending baseline is no longer available: it expired, was already approved or rejected, or baselines were reset.",
  "preview-too-large": "This capture is too large to preview.",
  "preview-unavailable": "This capture cannot be previewed.",
  "stale-epoch": "The flow was imported, replaced or re-created after this capture. Run it again to capture a new pending baseline.",
  "stale-content": "This step changed after the capture. Save, run it again and approve the new capture.",
  "stale-key-generation": "Visual baselines were reset after this capture. Run the flow again.",
  "flow-missing": "The flow no longer exists.",
  "step-missing": "The step no longer exists in the saved flow.",
  "integrity-unavailable": "The visual baseline key is unavailable: the system keystore is locked or the key was lost. Reset visual baselines to create a new key.",
  "coordination-unavailable": "This flows folder cannot hold visual baselines (it does not support the cross-process lock).",
  "invalid-request": "The capture could not be approved.",
  "approval-failed": "The approval could not be written.",
  "reset-unavailable": "Visual baselines could not be reset: the system keystore is unavailable."
};
const describe = (response: SensitiveAdminResponse) => MESSAGES[response.code] ?? "The action did not complete.";

const REASONS: Readonly<Record<string, string>> = {
  "no-baseline": "No approved baseline yet",
  "binding-changed": "The step changed since its baseline",
  "baseline-other-conditions": "Captured under other conditions (browser, size, scale, theme…)",
  "baseline-unreadable": "The stored baseline is unreadable; approving replaces it"
};

export function VisualAssertionSection({
  flowId,
  stepId,
  mode,
  editorDirty,
  onModeChange
}: {
  flowId: string;
  stepId: string;
  /** The step's authored mode (absent means observe). */
  mode: "observe" | "enforce" | undefined;
  editorDirty: boolean;
  onModeChange: (mode: "observe" | "enforce") => void;
}) {
  const { can } = usePermissions();
  const session = useSession();
  const sessionRef = session?.principal.sessionRef ?? "";
  const canEdit = can(Permission.WORKFLOW_EDIT);
  const action = useSensitiveSemanticAction(describe);
  const [enforceAvailable, setEnforceAvailable] = useState<boolean | null>(null);
  const [candidates, setCandidates] = useState<VisualCandidateView[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ candidateId: string; src: string; width: number; height: number } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api()
      .capabilities()
      .then((c) => !cancelled && setEnforceAvailable(c.enforceAvailable))
      .catch(() => !cancelled && setEnforceAvailable(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    if (!canEdit || !flowId) return;
    try {
      const result = await api().listCandidates({ flowId, stepId });
      setCandidates(result.ok ? result.candidates : []);
      setListError(result.ok ? null : describe(result));
    } catch {
      setListError("Pending baselines could not be read.");
    }
  }, [canEdit, flowId, stepId]);

  useEffect(() => {
    setPreview(null);
    void load();
  }, [load]);

  // N6.7: the step's latest decision from the stored run reports (codes only, sanitized on read).
  const [latest, setLatest] = useState<{ record: VisualAssertionReportRecord; at: string } | null>(null);
  useEffect(() => {
    let live = true;
    setLatest(null);
    window.playwrightFlowStudio.reports
      .list()
      .then((reports) => {
        if (!live) return;
        const runs = [...(reports as ConcurrentRunReport[])].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
        // The newest run that recorded this step; within it, its last instance's last record (a concurrent run can
        // hold the step in several instances).
        for (const run of runs) {
          const record = (run.instances ?? [])
            .flatMap((instance) => sanitizeVisualAssertionReportRecords(instance.visualAssertions) ?? [])
            .filter((r) => r.flowId === flowId && r.stepId === stepId)
            .at(-1);
          if (record) return setLatest({ record, at: run.startedAt });
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [flowId, stepId]);

  const effectiveMode = mode ?? "observe";
  const enforceUnavailable = enforceAvailable === false && effectiveMode === "enforce";

  const runThenReload = (call: () => Promise<SensitiveAdminResponse>, notice: string) =>
    void action.run(call, notice).then(() => load());

  return (
    <details className="property-group" open data-testid="visual-assertion-section">
      <summary>Visual assertion</summary>
      <section className="property-section">
        <label>
          Mode
          <select
            data-testid="visual-assertion-mode"
            value={effectiveMode}
            onChange={(e) => onModeChange(e.target.value === "enforce" ? "enforce" : "observe")}
          >
            <option value="observe">Observe — record the result, never fail the step</option>
            {enforceAvailable || effectiveMode === "enforce" ? (
              <option value="enforce" disabled={!enforceAvailable}>
                Enforce — fail the step unless equality is proven{enforceAvailable ? "" : " (unavailable in this build)"}
              </option>
            ) : null}
          </select>
        </label>
        {enforceUnavailable ? (
          <p className="form-message warn" role="status" data-testid="visual-assertion-enforce-unavailable">
            Enforce is unavailable in this build. This step will fail as visual-unverified (enforce-unavailable-in-production)
            until it is switched to observe.
          </p>
        ) : (
          <span className="form-message">
            {effectiveMode === "enforce"
              ? "Enforce runs only in the acceptance build with AWKIT_VISUAL_ASSERTIONS=enforce and a qualified, unexpired calibration grant; otherwise the step fails as visual-unverified."
              : "Observe records whether the element matches its approved baseline and never fails the step."}
          </span>
        )}
        <span className="form-message" data-testid="visual-assertion-latest" data-code={latest?.record.code ?? "none"}>
          {latest
            ? `Latest run (${new Date(latest.at).toLocaleString()}): ${visualAssertionSentence(latest.record)} Reason code ${latest.record.code}.`
            : "No run report records this step yet."}
        </span>
      </section>

      {canEdit ? (
        <section className="property-section" aria-labelledby={`visual-pending-${stepId}`}>
          <h4 id={`visual-pending-${stepId}`}>Pending baselines</h4>
          {editorDirty ? <span className="form-message">Approvals check the saved flow. Save your edits first.</span> : null}
          {listError ? <p className="form-message error">{listError}</p> : null}
          {candidates.length === 0 && !listError ? (
            <span className="form-message" data-testid="visual-pending-empty">
              No pending baseline. Run the flow with visual assertions on to capture one; it stays available for 30 minutes.
            </span>
          ) : null}
          <ul className="visual-candidate-list" data-testid="visual-pending-list">
            {candidates.map((c) => (
              <li key={c.candidateId} data-testid="visual-pending-item">
                <p>
                  <strong>{REASONS[c.reason] ?? c.reason}</strong>
                  <br />
                  Captured {new Date(c.createdAt).toLocaleTimeString()} in a run started by {c.runUsername || "an unknown user"}; expires{" "}
                  {new Date(c.expiresAt).toLocaleTimeString()}.
                </p>
                <div className="settings-actions">
                  <button
                    className="toolbar-button"
                    type="button"
                    disabled={action.busy}
                    onClick={() =>
                      runThenReload(async () => {
                        const r = await api().previewCandidate(c.candidateId);
                        if (r.ok) setPreview({ candidateId: c.candidateId, src: `data:image/png;base64,${r.pngBase64}`, width: r.width, height: r.height });
                        return r;
                      }, "Preview shown.")
                    }
                  >
                    <Eye size={15} aria-hidden="true" /> Preview
                  </button>
                  <button
                    className="toolbar-button"
                    type="button"
                    disabled={action.busy || editorDirty}
                    onClick={() => runThenReload(() => api().approveCandidate(c.candidateId), "Baseline approved.")}
                  >
                    <Check size={15} aria-hidden="true" /> Approve
                  </button>
                  <button
                    className="toolbar-button"
                    type="button"
                    disabled={action.busy}
                    onClick={() =>
                      runThenReload(async () => {
                        const r = await api().rejectCandidate(c.candidateId);
                        if (r.ok && preview?.candidateId === c.candidateId) setPreview(null);
                        return r;
                      }, "Pending baseline rejected.")
                    }
                  >
                    <X size={15} aria-hidden="true" /> Reject
                  </button>
                </div>
                {preview?.candidateId === c.candidateId ? (
                  <figure className="visual-candidate-preview" data-testid="visual-pending-preview">
                    <img src={preview.src} alt={`Captured element for this step, ${preview.width} by ${preview.height} pixels`} />
                    <figcaption>The captured element only; this preview is not stored.</figcaption>
                  </figure>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="settings-actions">
            <button className="toolbar-button" type="button" onClick={() => void load()} disabled={action.busy}>
              <RefreshCw size={15} aria-hidden="true" /> Refresh
            </button>
            <button className="toolbar-button modal-danger" type="button" onClick={() => setConfirmReset(true)} disabled={action.busy}>
              <RotateCcw size={15} aria-hidden="true" /> Reset visual baselines
            </button>
          </div>
          <p role="status" aria-live="polite" className="form-message" data-testid="visual-pending-status">
            {action.error ?? action.notice ?? ""}
          </p>
        </section>
      ) : null}

      {confirmReset ? (
        <ConfirmDialog
          danger
          title="Reset visual baselines?"
          confirmLabel="Reset baselines"
          message={
            "Every approved visual baseline and calibration grant of this build is removed and a new key is created. Pending baselines are discarded.\n\n" +
            "Flows and run reports are not affected. Continue?"
          }
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            setConfirmReset(false);
            setPreview(null);
            runThenReload(() => api().resetBaselines(), "Visual baselines reset.");
          }}
        />
      ) : null}

      {action.needsReauth ? <ReauthDialog sessionRef={sessionRef} onCancel={action.onReauthCancelled} onConfirmed={action.onReauthConfirmed} /> : null}
    </details>
  );
}
