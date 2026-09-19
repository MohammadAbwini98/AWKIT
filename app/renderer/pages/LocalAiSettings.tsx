import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Cpu, PackagePlus, RotateCcw, Trash2, Undo2 } from "lucide-react";

import type { AiActionRecord } from "@src/ai/AiActionRecord";
import type { AiDiagnosticsView, AiSettingsView, AiStatusView } from "@src/ai/contracts/AiApi";
import type { AiFeatureId, AiTier } from "@src/security/authz/AiAutonomyPolicy";
import { Permission } from "@src/security/authz/Permissions";

import { ConfirmDialog } from "../components/shared/ConfirmDialog";
import { useSession } from "../security/SessionContext";
import { usePermissions } from "../security/usePermissions";
import { ReauthDialog } from "./admin/ReauthDialog";
import { useSensitiveSemanticAction, type SensitiveAdminResponse } from "../semantic/useSensitiveSemanticAction";

const api = () => window.playwrightFlowStudio.ai;

const FEATURE_LABELS: Record<AiFeatureId, string> = {
  locatorSemanticUpgrade: "Semantic locator upgrade",
  locatorRepair: "Saved-locator repair",
  safeFixRanking: "Safe-fix ranking",
  fragmentParameterMapping: "Fragment parameter mapping",
  failureAnalysis: "Failure analysis",
  validationExplanation: "Validation explanation",
  fragmentSummary: "Fragment summary"
};

const TIERS: AiTier[] = ["T0", "T1", "T2"];
const TIER_LABELS: Record<AiTier, string> = { T0: "Observe", T1: "Suggest", T2: "Auto-apply with proof" };

const STATE_LABELS: Record<string, string> = {
  available: "Available",
  loading: "Loading the model",
  busy: "Working",
  error: "Error",
  DISABLED: "Turned off",
  RUNTIME_MISSING: "The AI runtime is not included in this build",
  RUNTIME_INCOMPATIBLE: "The AI runtime version is not supported",
  CIRCUIT_OPEN: "Stopped after repeated runtime crashes",
  MODEL_MISSING: "No model pack imported",
  MODEL_INVALID: "The model pack failed verification",
  SHUTDOWN: "Shutting down"
};

const HOLD_LABELS: Record<string, string> = {
  RUNS_ACTIVE: "Waiting for runs to finish",
  DISPATCH_BLOCKED: "Waiting while run dispatch is throttled",
  HOST_PRESSURE: "Waiting while the machine is under load",
  LOW_MEMORY: "Waiting for free memory",
  WEIGHTED_BUDGET: "Waiting for run capacity"
};

const PACK_LABELS: Record<string, string> = {
  missing: "Not imported",
  installed: "Installed",
  invalid: "Invalid",
  incompatible: "Not accepted by this version",
  FILE_MISSING: "the model file is missing",
  SIZE_MISMATCH: "the model file changed size",
  HASH_MISMATCH: "the model file failed its checksum",
  REGISTRY_UNREADABLE: "the model registry is unreadable",
  NOT_IN_MANIFEST: "this version no longer lists the pack"
};

/** Every AI failure carries a safe sentence; this only covers the codes that arrive without one. */
function describeAi(response: SensitiveAdminResponse): string {
  if (response.message) return response.message;
  return response.code === "NOT_AUTHORIZED" ? "You don't have permission to do that." : "That action could not be completed.";
}

function stateLabel(status: AiStatusView): string {
  return STATE_LABELS[status.reason ?? status.state] ?? STATE_LABELS[status.state] ?? status.state;
}

function packLabel(pack: AiStatusView["modelPack"]): string {
  if (pack.status === "installed") return pack.displayName ?? "Installed";
  const base = PACK_LABELS[pack.status] ?? pack.status;
  return pack.reason ? `${base}: ${PACK_LABELS[pack.reason] ?? pack.reason}` : base;
}

function proofLabel(record: AiActionRecord): string {
  const parts: string[] = [record.proof.result];
  if (record.proof.replays !== undefined) parts.push(`${record.proof.replays} replays`);
  if (record.proof.dataRows !== undefined) parts.push(`${record.proof.dataRows} data rows`);
  return parts.join(" · ");
}

/**
 * Settings → Local AI (Phase L, L1.5).
 *
 * Status is visible with `ai.use`; the master switch, model pack, per-feature tiers and restore need
 * `ai.manage`, which re-authenticates, so those writes go through the shared sensitive-action runner
 * (prompt, retry once). Diagnostics and the audit log need `ai.audit.view`; reverting also needs
 * `workflow.edit`, because it restores a saved flow. Every rule is enforced again in main.
 *
 * The tier selector offers only tiers up to each feature's ceiling; the policy cannot be configured
 * above it, and the main process refuses a patch that tries.
 */
export function LocalAiSettings() {
  const { can } = usePermissions();
  const session = useSession();
  const sessionRef = session?.principal.sessionRef ?? "";
  const canUse = can(Permission.AI_USE);
  const canManage = can(Permission.AI_MANAGE);
  const canAudit = can(Permission.AI_AUDIT_VIEW);
  const canRevert = canAudit && can(Permission.WORKFLOW_EDIT);

  const [status, setStatus] = useState<AiStatusView | null>(null);
  const [settings, setSettings] = useState<AiSettingsView | null>(null);
  const [diagnostics, setDiagnostics] = useState<AiDiagnosticsView | null>(null);
  const [audit, setAudit] = useState<{ records: AiActionRecord[]; total: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState<AiActionRecord | null>(null);

  const action = useSensitiveSemanticAction(describeAi);

  const load = useCallback(async () => {
    try {
      const [nextStatus, nextSettings, nextDiagnostics, nextAudit] = await Promise.all([
        canUse ? api().getStatus() : Promise.resolve(null),
        canManage ? api().getSettings() : Promise.resolve(null),
        canAudit ? api().getDiagnostics() : Promise.resolve(null),
        canAudit ? api().listAudit({ limit: 50 }) : Promise.resolve(null)
      ]);
      setStatus(nextStatus);
      setSettings(nextSettings);
      setDiagnostics(nextDiagnostics);
      setAudit(nextAudit);
      setLoadError(null);
    } catch {
      setLoadError("The local AI status could not be read.");
    }
  }, [canUse, canManage, canAudit]);

  useEffect(() => {
    void load();
  }, [load]);

  const runThenReload = useCallback(
    async (call: () => Promise<SensitiveAdminResponse>, notice: string) => {
      await action.run(call, notice);
      await load();
    },
    [action, load]
  );

  const importPack = useCallback(async () => {
    let cancelled = false;
    await action.run(async () => {
      const response = await api().importModelPack();
      if (response.code !== "IMPORT_CANCELLED") return response;
      cancelled = true;
      return { code: "OK", ok: true };
    }, "Model pack imported and verified.");
    // A closed file dialog is not a success worth announcing.
    if (cancelled) action.dismiss();
    await load();
  }, [action, load]);

  const saveTier = (feature: AiFeatureId, tier: AiTier): void => {
    if (!settings) return;
    const featureTiers: Partial<Record<AiFeatureId, AiTier>> = {};
    for (const view of settings.features) if (view.configured) featureTiers[view.id] = view.configured;
    featureTiers[feature] = tier;
    void runThenReload(() => api().updateSettings({ featureTiers }), `${FEATURE_LABELS[feature]} set to ${TIER_LABELS[tier]}.`);
  };

  const installed = status?.modelPack.status === "installed";

  return (
    <section className="work-panel settings-card" aria-labelledby="settings-local-ai-title">
      <div className="settings-card-head">
        <Cpu size={16} aria-hidden="true" />
        <h2 id="settings-local-ai-title">Local AI</h2>
      </div>

      <p className="settings-card-hint">
        An optional model that runs on this machine only. It suggests, explains and ranks; SpecterStudio proves
        and applies. It never sends anything online, waits while runs are active, and is off until a model pack is
        imported and it is turned on.
      </p>

      {loadError ? (
        <p className="form-message error" role="alert">
          <AlertTriangle size={13} style={{ verticalAlign: "-2px" }} /> {loadError}
        </p>
      ) : null}
      {action.error ? (
        <p className="form-message error" role="alert">
          <AlertTriangle size={13} style={{ verticalAlign: "-2px" }} /> {action.error}
        </p>
      ) : null}
      {action.notice ? (
        <p className="form-message" role="status">
          <CheckCircle2 size={13} style={{ verticalAlign: "-2px" }} /> {action.notice}
        </p>
      ) : null}

      {status ? (
        <div className="readiness-list">
          <span>Status</span>
          <strong>{stateLabel(status)}</strong>
          <span>Model pack</span>
          <strong>{packLabel(status.modelPack)}</strong>
          {status.holdReason ? (
            <>
              <span>Queue</span>
              <strong>
                {status.queueDepth} waiting — {HOLD_LABELS[status.holdReason] ?? status.holdReason}
              </strong>
            </>
          ) : null}
        </div>
      ) : (
        canUse && !loadError && <p className="form-message">Reading local AI status…</p>
      )}

      {canManage && settings ? (
        <>
          <div className="settings-grid">
            <label className="inline-check">
              <input
                checked={settings.enabled}
                disabled={action.busy}
                type="checkbox"
                onChange={(ev) => {
                  const enabled = ev.target.checked;
                  void runThenReload(() => api().updateSettings({ enabled }), enabled ? "Local AI turned on." : "Local AI turned off.");
                }}
              />
              Enable local AI
            </label>
            <label className="inline-check">
              <input
                checked={settings.yieldDuringRuns}
                disabled={action.busy}
                type="checkbox"
                onChange={(ev) => {
                  const yieldDuringRuns = ev.target.checked;
                  void runThenReload(
                    () => api().updateSettings({ yieldDuringRuns }),
                    yieldDuringRuns ? "AI work now waits for runs to finish." : "AI work may run beside runs when capacity allows."
                  );
                }}
              />
              Pause AI work while runs are active
            </label>
            <label>
              <span>Unload the model after idle (minutes, 0 keeps it loaded)</span>
              <input
                defaultValue={settings.idleUnloadMinutes}
                disabled={action.busy}
                max={settings.maxIdleUnloadMinutes}
                min={0}
                step={1}
                type="number"
                onBlur={(ev) => {
                  const idleUnloadMinutes = Number(ev.target.value);
                  if (!Number.isInteger(idleUnloadMinutes) || idleUnloadMinutes === settings.idleUnloadMinutes) return;
                  void runThenReload(() => api().updateSettings({ idleUnloadMinutes }), "Idle unload saved.");
                }}
              />
            </label>
          </div>

          <div className="settings-actions">
            <button className="toolbar-button" disabled={action.busy} type="button" onClick={() => void importPack()}>
              <PackagePlus size={15} aria-hidden="true" />
              {installed ? "Replace Model Pack…" : "Import Model Pack…"}
            </button>
            {installed ? (
              <button className="toolbar-button modal-danger" disabled={action.busy} type="button" onClick={() => setConfirmRemove(true)}>
                <Trash2 size={15} aria-hidden="true" />
                Remove Model Pack
              </button>
            ) : null}
            <button className="toolbar-button" type="button" onClick={() => void load()}>
              <RotateCcw size={15} aria-hidden="true" />
              Refresh
            </button>
          </div>

          <div className="sys-table-scroll">
            <table className="sys-table" aria-label="Local AI features and their autonomy tiers">
              <thead>
                <tr>
                  <th scope="col" className="sys-th"><span className="sys-th-button">Feature</span></th>
                  <th scope="col" className="sys-th"><span className="sys-th-button">Tier</span></th>
                  <th scope="col" className="sys-th"><span className="sys-th-button">In effect</span></th>
                  <th scope="col" className="sys-th"><span className="sys-th-button">Self-demotion</span></th>
                </tr>
              </thead>
              <tbody>
                {settings.features.map((feature) => (
                  <tr key={feature.id}>
                    <td>{FEATURE_LABELS[feature.id]}</td>
                    <td>
                      <select
                        aria-label={`${FEATURE_LABELS[feature.id]} tier`}
                        disabled={action.busy}
                        value={feature.configured ?? feature.ceiling}
                        onChange={(ev) => saveTier(feature.id, ev.target.value as AiTier)}
                      >
                        {TIERS.slice(0, TIERS.indexOf(feature.ceiling) + 1).map((tier) => (
                          <option key={tier} value={tier}>
                            {TIER_LABELS[tier]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{TIER_LABELS[feature.effective]}</td>
                    <td>
                      {feature.demotion ? (
                        <>
                          Demoted: {Math.round(feature.demotion.revertRate * 100)}% of {feature.demotion.applied} changes reverted.{" "}
                          <button
                            className="toolbar-button"
                            disabled={action.busy}
                            type="button"
                            onClick={() => void runThenReload(() => api().restoreFeature(feature.id), `${FEATURE_LABELS[feature.id]} restored.`)}
                          >
                            Restore
                          </button>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="settings-card-hint">
            Observe keeps a labelled interpretation, Suggest asks you to approve, and Auto-apply applies a change only
            after it is proven, records it in the audit log, and keeps a one-click revert. A feature that is reverted
            too often drops to Suggest until you restore it. Protected sign-in pages, sensitive actions and run control
            are never touched by AI.
          </p>
        </>
      ) : null}

      {canAudit && diagnostics ? (
        <div className="readiness-list">
          <span>Runtime</span>
          <strong>
            {diagnostics.runtime.included ? "Included" : "Not included in this build"}
            {diagnostics.runtime.pinnedBuild ? ` (llama.cpp ${diagnostics.runtime.pinnedBuild})` : " (no pinned build)"}
          </strong>
          <span>Runtime process</span>
          <strong>
            {diagnostics.runtime.circuitOpen ? "Stopped after repeated crashes" : diagnostics.runtime.hostState}
            {diagnostics.runtime.lastReason ? ` — ${diagnostics.runtime.lastReason}` : ""}
          </strong>
          <span>Model checksum</span>
          <strong>{diagnostics.modelPack.sha256 ? `${diagnostics.modelPack.sha256.slice(0, 16)}…` : "—"}</strong>
          <span>Accepted model packs</span>
          <strong>{diagnostics.modelPack.manifestEntries}</strong>
          <span>Inference threads</span>
          <strong>{diagnostics.threads}</strong>
          <span>Jobs</span>
          <strong>
            {diagnostics.counters.completed} completed, {diagnostics.counters.failed} failed, {diagnostics.counters.cancelled} cancelled,{" "}
            {diagnostics.counters.yielded} yielded to runs
          </strong>
        </div>
      ) : null}

      {canAudit && audit ? (
        audit.records.length === 0 ? (
          <p className="form-message">No AI change has been applied yet. Every applied change will be listed here with a revert.</p>
        ) : (
          <div className="sys-table-scroll">
            <table className="sys-table" aria-label="AI audit log">
              <thead>
                <tr>
                  <th scope="col" className="sys-th"><span className="sys-th-button">When</span></th>
                  <th scope="col" className="sys-th"><span className="sys-th-button">Feature</span></th>
                  <th scope="col" className="sys-th"><span className="sys-th-button">Tier</span></th>
                  <th scope="col" className="sys-th"><span className="sys-th-button">Flow / step</span></th>
                  <th scope="col" className="sys-th"><span className="sys-th-button">Proof</span></th>
                  <th scope="col" className="sys-th"><span className="sys-th-button">Status</span></th>
                </tr>
              </thead>
              <tbody>
                {audit.records.map((record) => (
                  <tr key={record.id}>
                    <td>{new Date(record.createdAt).toLocaleString()}</td>
                    <td>{FEATURE_LABELS[record.feature]}</td>
                    <td>{TIER_LABELS[record.tier]}</td>
                    <td>
                      {record.target.flowId} / {record.target.stepId}
                    </td>
                    <td>{proofLabel(record)}</td>
                    <td className="sys-td-actions">
                      {record.reverted ? (
                        `Reverted ${new Date(record.reverted.at).toLocaleString()}`
                      ) : canRevert ? (
                        <button className="toolbar-button" disabled={action.busy} type="button" onClick={() => setConfirmRevert(record)}>
                          <Undo2 size={15} aria-hidden="true" />
                          Revert
                        </button>
                      ) : (
                        "Applied"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {audit.total > audit.records.length ? (
              <p className="form-message">
                Showing the newest {audit.records.length} of {audit.total}.
              </p>
            ) : null}
          </div>
        )
      ) : null}

      {confirmRemove ? (
        <ConfirmDialog
          danger
          cancelLabel="Cancel"
          confirmLabel="Remove model pack"
          title="Remove the local AI model pack?"
          message={
            "Removing the pack deletes the model file from this machine. AI features stop until a pack is imported again.\n\n" +
            "Flows, runs, reports and the AI audit log are not affected.\n\nContinue?"
          }
          onCancel={() => setConfirmRemove(false)}
          onConfirm={() => {
            setConfirmRemove(false);
            void runThenReload(() => api().removeModelPack(), "Model pack removed.");
          }}
        />
      ) : null}

      {confirmRevert ? (
        <ConfirmDialog
          cancelLabel="Cancel"
          confirmLabel="Revert change"
          title="Revert this AI change?"
          message={
            `The step's previous locator will be restored in flow ${confirmRevert.target.flowId}. ` +
            "If the locator was edited after the AI change, nothing is overwritten and the revert is refused.\n\nContinue?"
          }
          onCancel={() => setConfirmRevert(null)}
          onConfirm={() => {
            const record = confirmRevert;
            setConfirmRevert(null);
            void runThenReload(() => api().revert(record.id), "Change reverted.");
          }}
        />
      ) : null}

      {action.needsReauth ? (
        <ReauthDialog sessionRef={sessionRef} onCancel={action.onReauthCancelled} onConfirmed={action.onReauthConfirmed} />
      ) : null}
    </section>
  );
}
