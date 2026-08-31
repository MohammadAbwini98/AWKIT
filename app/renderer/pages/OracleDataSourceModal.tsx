import { useEffect, useMemo, useState } from "react";
import { useModalFocusContract } from "../components/shared/useModalFocusContract";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { useNavigation } from "../state/navigation";
import { usePermissions } from "../security/usePermissions";
import { Permission } from "@src/security/authz/Permissions";
import type { OracleBindDefinition, OracleDataSourceProfile } from "@src/data/DataSourceProfile";

/** Bind source kinds a Data Source query may use — only those resolvable at data-source resolution
 *  time. Per-row / previous-output binds belong on the Oracle node and are intentionally omitted. */
type DsBindKind = "static" | "env" | "workflowInput";

interface OracleDataSourceModalProps {
  /** Existing profile when editing; null/undefined when creating. */
  initial?: OracleDataSourceProfile | null;
  onClose: () => void;
  onSaved: (profile: OracleDataSourceProfile) => void;
}

const JDBC_TYPES: OracleBindDefinition["jdbcType"][] = ["STRING", "NUMBER", "INTEGER", "DECIMAL", "BOOLEAN", "DATE", "TIMESTAMP", "NULL"];

function bindKind(bind: OracleBindDefinition): DsBindKind {
  const kind = bind.source?.kind;
  return kind === "env" || kind === "workflowInput" ? kind : "static";
}

function bindText(bind: OracleBindDefinition): string {
  return bind.source?.value ?? bind.source?.key ?? "";
}

function makeBindSource(kind: DsBindKind, text: string): OracleBindDefinition["source"] {
  return kind === "static" ? { kind: "static", value: text } : { kind, key: text };
}

function newBind(): OracleBindDefinition {
  return { name: "", jdbcType: "STRING", source: { kind: "static", value: "" } };
}

/**
 * Create / edit an Oracle Data Source (Phase 05). Credentials never live here — only a reference to a
 * saved Oracle connection profile. Snapshot mode captures normalized rows for offline use via the
 * `oracle:dataSources:refreshSnapshot` IPC; runtime mode executes lazily at run time. Token-only
 * styling reuses the panel/modal classes already in `global.css`.
 */
export function OracleDataSourceModal({ initial, onClose, onSaved }: OracleDataSourceModalProps) {
  const editing = Boolean(initial);
  const { navigateTo } = useNavigation();
  const { can } = usePermissions();
  // AWKIT-A11Y-001: the modal focus contract (focus in / Tab trap / Escape / focus return).
  const { dialogRef } = useModalFocusContract(onClose);
  const [profiles, setProfiles] = useState<{ id: string; name: string }[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [availability, setAvailability] = useState<{ available: boolean; reason?: string; driverExpected: boolean } | null>(null);

  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [connectionProfileId, setConnectionProfileId] = useState(initial?.connectionProfileId ?? "");
  const [mode, setMode] = useState<"runtime" | "snapshot">(initial?.mode ?? "runtime");
  const [sql, setSql] = useState(initial?.query.sql ?? "");
  const [binds, setBinds] = useState<OracleBindDefinition[]>(initial?.query.binds ?? []);
  const [timeoutMs, setTimeoutMs] = useState(initial?.query.timeoutMs ?? 30000);
  const [maxRows, setMaxRows] = useState(initial?.query.maxRows ?? 10000);
  const [fetchSize, setFetchSize] = useState(initial?.query.fetchSize ?? 200);

  const [snapshot, setSnapshot] = useState(initial?.snapshot ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const api = window.playwrightFlowStudio;
    api.oracle.availability().then((a) => !cancelled && setAvailability(a)).catch(() => {
      if (!cancelled) setAvailability({ available: false, driverExpected: false, reason: "Could not check the Oracle runtime. Check Settings → Database Drivers." });
    });
    api.oracle
      .listProfiles()
      .then((list) => !cancelled && setProfiles(list.map((p) => ({ id: p.id, name: p.name }))))
      .catch(() => { if (!cancelled) setProfilesError("Could not load Oracle connection profiles. Close and reopen this dialog to retry."); })
      .finally(() => { if (!cancelled) setProfilesLoading(false); });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateBind = (index: number, patch: Partial<OracleBindDefinition>) =>
    setBinds((prev) => prev.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  const removeBind = (index: number) => setBinds((prev) => prev.filter((_, i) => i !== index));
  const profileSelected = profiles.some((profile) => profile.id === connectionProfileId);
  const profileUnavailable = profilesLoading || Boolean(profilesError) || !profiles.length;
  const profileHint = profilesLoading
    ? "Loading Oracle connection profiles…"
    : profilesError ?? (!profiles.length
      ? "No Oracle connection profiles configured. A saved profile supplies the database address and credentials; it is separate from the Java runtime and JDBC driver."
      : connectionProfileId && !profileSelected
        ? "The saved connection profile is no longer available. Choose another profile before saving."
        : "Choose the saved database connection to use. Credentials stay in the connection profile, outside this data source.");

  const buildInput = () => ({
    id: initial?.id,
    name: name.trim(),
    description: description.trim() || undefined,
    connectionProfileId,
    mode,
    query: { sql, binds, timeoutMs, maxRows, fetchSize }
  });

  const save = async (): Promise<OracleDataSourceProfile | null> => {
    if (!name.trim()) {
      setError("A Data Source name is required.");
      return null;
    }
    if (!profileSelected) {
      setError("Select an Oracle connection profile.");
      return null;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await window.playwrightFlowStudio.oracle.saveDataSource(buildInput());
      setBusy(false);
      return saved;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the Oracle Data Source.");
      setBusy(false);
      return null;
    }
  };

  const saveAndClose = async () => {
    const saved = await save();
    if (saved) onSaved(saved);
  };

  // Snapshot refresh requires a persisted source (needs a stored id + query), so save first.
  const refreshSnapshot = async () => {
    setRefreshing(true);
    setError(null);
    const saved = await save();
    if (!saved) {
      setRefreshing(false);
      return;
    }
    try {
      const updated = await window.playwrightFlowStudio.oracle.refreshSnapshot(saved.id);
      setSnapshot(updated.snapshot ?? null);
      if (updated.snapshot?.status === "error") {
        setError(updated.snapshot.error ?? "Snapshot refresh failed.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Snapshot refresh failed.");
    } finally {
      setRefreshing(false);
    }
  };

  const snapshotStatus = useMemo(() => {
    if (!snapshot) return null;
    const cls = snapshot.status === "ready" ? "ok" : snapshot.status === "error" ? "warn" : "neutral";
    const label =
      snapshot.status === "ready"
        ? `${snapshot.rowCount} row(s)`
        : snapshot.status === "empty"
          ? "empty"
          : snapshot.status === "error"
            ? "error"
            : snapshot.status;
    return { cls, label, capturedAt: snapshot.capturedAt };
  }, [snapshot]);

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div ref={dialogRef} tabIndex={-1} className="modal-dialog oracle-data-source-dialog" role="dialog" aria-modal="true" aria-labelledby="oracle-data-source-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="oracle-data-source-title">{editing ? "Edit Oracle Data Source" : "Create Oracle Data Source"}</h2>
        </div>

        <div className="oracle-data-source-body">
          <section className="property-section">
            <div className="two-column-fields">
              <label>
                Name
                <input autoFocus value={name} onChange={(e) => { setName(e.target.value); setError(null); }} placeholder="Orders" />
              </label>
              <label>
                Mode
                <select value={mode} onChange={(e) => setMode(e.target.value as "runtime" | "snapshot")}>
                  <option value="runtime">Runtime (live, lazy per run)</option>
                  <option value="snapshot">Snapshot (offline stored rows)</option>
                </select>
              </label>
            </div>

            <label>
              Description (optional)
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this data source returns" />
            </label>

            <div className="oracle-connection-section">
            <label htmlFor="oracle-connection-profile">Connection Profile</label>
              <select
                id="oracle-connection-profile"
                aria-label="Oracle connection profile"
                aria-describedby="oracle-profile-hint oracle-runtime-hint"
                value={connectionProfileId}
                disabled={profileUnavailable || busy || refreshing}
                onChange={(event) => setConnectionProfileId(event.target.value)}
              >
                <option value="">{profilesLoading ? "Loading profiles…" : profilesError ? "Profiles unavailable" : profiles.length ? "Select a connection profile…" : "No Oracle connection profiles configured"}</option>
                {connectionProfileId && !profileSelected ? <option value={connectionProfileId}>Unavailable profile ({connectionProfileId})</option> : null}
                {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
              <p className="form-message" id="oracle-profile-hint" role="status">{profileHint}</p>
              <p className="form-message" id="oracle-runtime-hint" role="status">
                {!availability ? "Checking Oracle runtime…" : !availability.available
                  ? `Oracle queries are unavailable: ${availability.reason ?? "runtime not configured"}. Configure Java and a JDBC driver in Settings → Database Drivers. Existing profile configuration can still be saved; snapshot refresh is unavailable.`
                  : !availability.driverExpected
                    ? "Development mock runtime only — no real Oracle driver selected. Configure Java and a JDBC driver in Settings → Database Drivers for real queries."
                    : "Oracle runtime is available. Saving configures the source; it does not run the query."}
              </p>
              {can(Permission.PAGE_SETTINGS) && (!availability?.available || !availability.driverExpected) ? (
                <div>
                  <button type="button" className="toolbar-button" disabled={busy || refreshing} onClick={() => { onClose(); navigateTo("settings"); }}>Close and open Settings</button>
                  <p className="form-message">In Settings, find Database Drivers. Unsaved changes in this dialog will be discarded. Driver setup does not create a connection profile.</p>
                </div>
              ) : null}
            </div>

            <label>
              SQL Query (read-only SELECT)
              <textarea rows={4} value={sql} onChange={(e) => setSql(e.target.value)} placeholder="SELECT ... FROM ... WHERE col = :name" />
            </label>

            {/* ── Bind parameters (resolution-time sources only) ─────────────── */}
            <div className="smart-wait-list">
              <div className="smart-wait-list-heading">
                <strong>Bind Parameters</strong>
                <button className="toolbar-button" type="button" onClick={() => setBinds((prev) => [...prev, newBind()])}>
                  <Plus size={14} /> Add
                </button>
              </div>
              {binds.length === 0 ? (
                <span className="form-message">No binds. Add a bind to pass values into `:name` placeholders safely.</span>
              ) : (
                binds.map((bind, index) => (
                  <div className="smart-wait-card" key={`ds-bind-${index}`}>
                    <div className="two-column-fields">
                      <label>
                        Name / :placeholder
                        <input value={bind.name ?? ""} placeholder="name" onChange={(e) => updateBind(index, { name: e.target.value })} />
                      </label>
                      <label>
                        JDBC Type
                        <select value={bind.jdbcType} onChange={(e) => updateBind(index, { jdbcType: e.target.value as OracleBindDefinition["jdbcType"] })}>
                          {JDBC_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="two-column-fields">
                      <label>
                        Value Source
                        <select
                          value={bindKind(bind)}
                          onChange={(e) => updateBind(index, { source: makeBindSource(e.target.value as DsBindKind, bindText(bind)) })}
                        >
                          <option value="static">Static value</option>
                          <option value="env">Environment variable</option>
                          <option value="workflowInput">Workflow input</option>
                        </select>
                      </label>
                      <label>
                        {bindKind(bind) === "static" ? "Value" : "Key"}
                        <input
                          value={bindText(bind)}
                          onChange={(e) => updateBind(index, { source: makeBindSource(bindKind(bind), e.target.value) })}
                        />
                      </label>
                    </div>
                    <div className="smart-wait-card-head">
                      <label className="inline-check">
                        <input type="checkbox" checked={bind.required ?? false} onChange={(e) => updateBind(index, { required: e.target.checked })} />
                        Required
                      </label>
                      <button className="toolbar-button" type="button" onClick={() => removeBind(index)} title="Remove bind">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* ── Limits ─────────────────────────────────────────────────────── */}
            <div className="two-column-fields">
              <label>
                Query Timeout (ms)
                <input type="number" min={0} value={timeoutMs} onChange={(e) => setTimeoutMs(Number(e.target.value))} />
              </label>
              <label>
                Max Rows
                <input type="number" min={1} value={maxRows} onChange={(e) => setMaxRows(Number(e.target.value))} />
              </label>
            </div>
            <label>
              Fetch Size
              <input type="number" min={1} value={fetchSize} onChange={(e) => setFetchSize(Number(e.target.value))} />
            </label>

            {/* ── Snapshot capture (snapshot mode) ───────────────────────────── */}
            {mode === "snapshot" ? (
              <div className="smart-wait-list">
                <div className="smart-wait-list-heading">
                  <strong>Offline Snapshot</strong>
                  <button className="toolbar-button" type="button" onClick={() => void refreshSnapshot()} disabled={refreshing || busy || !profileSelected || !availability?.available} title={!availability?.available ? "Configure the Oracle runtime before refreshing a snapshot" : undefined}>
                    <RefreshCw size={14} /> {refreshing ? "Refreshing…" : "Refresh snapshot"}
                  </button>
                </div>
                {snapshotStatus ? (
                  <span className="form-message">
                    <span className={`status-chip ${snapshotStatus.cls}`}>{snapshotStatus.label}</span>{" "}
                    captured {snapshotStatus.capturedAt.slice(0, 19).replace("T", " ")}
                  </span>
                ) : (
                  <span className="form-message">No snapshot captured yet. Refresh to execute the query once and store its rows for offline use.</span>
                )}
              </div>
            ) : null}
          </section>
        </div>

        {error ? <div className="settings-banner error">{error}</div> : null}
        <div className="modal-actions">
          <button className="toolbar-button" type="button" onClick={onClose} disabled={busy || refreshing}>
            Cancel
          </button>
          <button className="toolbar-button primary" type="button" onClick={() => void saveAndClose()} disabled={busy || refreshing || profilesLoading || Boolean(profilesError) || !profileSelected}>
            {busy ? "Saving…" : editing ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
