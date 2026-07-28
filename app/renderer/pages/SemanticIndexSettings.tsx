import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Database, RotateCcw, Trash2 } from "lucide-react";

import { Permission } from "@src/security/authz/Permissions";
import type { SemanticAdminResponse, SemanticSettingsView, SemanticStatusView } from "@src/semantic/contracts/SemanticApi";

import { ConfirmDialog } from "../components/shared/ConfirmDialog";
import { useSession } from "../security/SessionContext";
import { usePermissions } from "../security/usePermissions";
import { ReauthDialog } from "./admin/ReauthDialog";
import { semanticCapabilityLabel, semanticCapabilityTone } from "../semantic/semanticMessages";
import { useSensitiveSemanticAction } from "../semantic/useSensitiveSemanticAction";

const api = () => window.playwrightFlowStudio.semantic;

/**
 * Settings → Semantic Index. Health, plus the maintenance actions.
 *
 * Health is visible to any role that may search; the maintenance controls need
 * `SEMANTIC_MANAGE_INDEX`, which is in `SENSITIVE_PERMISSIONS` — so rebuild, clear and the settings
 * write all go through `useSensitiveSemanticAction`, which prompts and retries once.
 *
 * `ReauthDialog` is reused rather than reimplemented. It already carries a focus contract, and this
 * repository has shipped the same `aria-modal`-without-focus-management defect three times by
 * building a new modal per surface.
 */
export function SemanticIndexSettings() {
  const { can } = usePermissions();
  const session = useSession();
  const sessionRef = session?.principal.sessionRef ?? "";
  const canManage = can(Permission.SEMANTIC_MANAGE_INDEX);

  const [status, setStatus] = useState<SemanticStatusView | null>(null);
  const [settings, setSettings] = useState<SemanticSettingsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const action = useSensitiveSemanticAction();

  const load = useCallback(async () => {
    try {
      const [nextStatus, nextSettings] = await Promise.all([api().getStatus(), api().getSettings()]);
      setStatus(nextStatus);
      setSettings(nextSettings);
      setLoadError(null);
    } catch {
      // The read channels still reject on denial; there is no reason code to switch on.
      setLoadError("The semantic index status could not be read.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Re-read after any mutation so the panel never shows a stale generation or pending count. */
  const runThenReload = useCallback(
    async (call: () => Promise<SemanticAdminResponse>, notice: string) => {
      await action.run(call, notice);
      await load();
    },
    [action, load]
  );

  const health = status?.health;

  return (
    <section className="work-panel settings-card">
      <div className="settings-card-head">
        <Database size={16} />
        <h2>Semantic Index</h2>
      </div>

      <p className="settings-card-hint">
        The semantic index powers Semantic Search, similar-failure lookup and locator suggestions. It is
        built from your flows, workflows, run history and locator memory, and never leaves this machine.
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

      {health ? (
        <div className="readiness-list">
          <span>Status</span>
          <strong>
            <span className={`semantic-health-dot semantic-health-${semanticCapabilityTone(health.capability)}`} />
            {semanticCapabilityLabel(health.capability)}
          </strong>
          <span>Summary</span>
          <strong>{health.summary}</strong>
          <span>Active generation</span>
          <strong>{status?.index.activeGeneration ?? "None"}</strong>
          <span>Writable</span>
          <strong>{status?.index.writable ? "Yes" : "No"}</strong>
          <span>Rebuild required</span>
          <strong>{status?.index.rebuildRequired ? "Yes" : "No"}</strong>
          <span>Pending mutations</span>
          <strong>{status?.index.pendingMutations ?? 0}</strong>
          <span>Reconciliation required</span>
          <strong>{status?.index.reconciliationRequired ? "Yes" : "No"}</strong>
          <span>Previous shutdown</span>
          <strong>{health.previousShutdownClean ? "Clean" : "Unclean — reconciliation ran"}</strong>
          <span>Last indexed</span>
          <strong>
            {status?.index.lastIndexedAt ? new Date(status.index.lastIndexedAt).toLocaleString() : "Not since this app started"}
          </strong>
          {status?.index.lastIndexError ? (
            <>
              <span>Last indexing error</span>
              <strong>{status.index.lastIndexError}</strong>
            </>
          ) : null}
        </div>
      ) : (
        !loadError && <p className="form-message">Reading index status…</p>
      )}

      {/* `inline-check` is the app's checkbox convention (label wraps input + text). Without it a
          bare checkbox in `settings-grid` stretches to the grid cell and renders oversized. */}
      {settings && canManage ? (
        <div className="settings-grid">
          <label className="inline-check">
            <input
              checked={settings.enabled}
              disabled={action.busy}
              type="checkbox"
              onChange={(ev) => {
                const enabled = ev.target.checked;
                void runThenReload(() => api().updateSettings({ enabled }), enabled ? "Semantic features enabled." : "Semantic features disabled.");
              }}
            />
            Enable semantic features
          </label>
          <label className="inline-check">
            <input
              checked={settings.autoIndex}
              disabled={action.busy || !settings.enabled}
              type="checkbox"
              onChange={(ev) => {
                const autoIndex = ev.target.checked;
                void runThenReload(
                  () => api().updateSettings({ autoIndex }),
                  autoIndex ? "The index will stay fresh automatically." : "Automatic indexing turned off."
                );
              }}
            />
            Keep the index fresh automatically
          </label>
          <label>
            <span>Default results per query</span>
            <input
              defaultValue={settings.defaultTopK}
              disabled={action.busy}
              max={settings.maxTopK}
              min={1}
              type="number"
              onBlur={(ev) => {
                const defaultTopK = Number(ev.target.value);
                if (!Number.isFinite(defaultTopK) || defaultTopK === settings.defaultTopK) return;
                void runThenReload(() => api().updateSettings({ defaultTopK }), "Default result count saved.");
              }}
            />
          </label>
        </div>
      ) : null}

      {canManage ? (
        <div className="settings-actions">
          <button
            className="toolbar-button"
            disabled={action.busy}
            type="button"
            onClick={() => void runThenReload(() => api().rebuild(), "Index rebuilt.")}
          >
            <RotateCcw size={15} />
            {action.busy ? "Working…" : "Rebuild Index"}
          </button>
          <button className="toolbar-button modal-danger" disabled={action.busy} type="button" onClick={() => setConfirmClear(true)}>
            <Trash2 size={15} />
            Clear Index
          </button>
          <button className="toolbar-button" type="button" onClick={() => void load()}>
            Refresh Status
          </button>
        </div>
      ) : null}

      {canManage ? (
        <p className="settings-card-hint">
          {settings?.autoIndex
            ? "Each run is indexed as it finishes. Rebuild regenerates the whole index from your flows, workflows, run history and locator memory — use it after turning automatic indexing back on, or to recover from an indexing error."
            : "Automatic indexing is off, so results are only as fresh as the last rebuild. Nothing is lost meanwhile: runs and locator memory are still recorded and a rebuild picks them all up."}
          {" A rebuild in progress cannot be cancelled yet."}
        </p>
      ) : null}

      {confirmClear ? (
        <ConfirmDialog
          danger
          cancelLabel="Cancel"
          confirmLabel="Clear index"
          title="Clear the semantic index?"
          message={
            "Clearing removes every indexed document. Semantic Search, similar-failure lookup and locator suggestions will return nothing until the index is rebuilt.\n\n" +
            "Your flows, workflows, runs and reports are not affected.\n\nContinue?"
          }
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            setConfirmClear(false);
            void runThenReload(() => api().clear(), "Index cleared.");
          }}
        />
      ) : null}

      {action.needsReauth ? (
        <ReauthDialog sessionRef={sessionRef} onCancel={action.onReauthCancelled} onConfirmed={action.onReauthConfirmed} />
      ) : null}
    </section>
  );
}
