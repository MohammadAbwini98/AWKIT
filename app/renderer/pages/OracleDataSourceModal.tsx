import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { SearchableSelect } from "../components/shared/SearchableSelect";
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
  const [profiles, setProfiles] = useState<{ id: string; name: string }[]>([]);
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
    api.oracle.availability().then((a) => !cancelled && setAvailability(a)).catch(() => undefined);
    api.oracle
      .listProfiles()
      .then((list) => !cancelled && setProfiles(list.map((p) => ({ id: p.id, name: p.name }))))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const updateBind = (index: number, patch: Partial<OracleBindDefinition>) =>
    setBinds((prev) => prev.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  const removeBind = (index: number) => setBinds((prev) => prev.filter((_, i) => i !== index));

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
    if (!connectionProfileId) {
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
      <div className="modal-dialog" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{editing ? "Edit Oracle Data Source" : "Create Oracle Data Source"}</h2>
        </div>

        <div style={{ maxHeight: "68vh", overflowY: "auto" }}>
          <section className="property-section">
            {availability && !availability.available ? (
              <span className="form-message" role="alert">
                Oracle is unavailable in this build: {availability.reason ?? "runtime not found"}. You can configure the Data
                Source now; it will run once the Oracle runtime is present.
              </span>
            ) : null}
            {availability?.available && !availability.driverExpected ? (
              <span className="form-message">
                No Oracle JDBC driver is selected — running with the database-free mock (queries return sample data). Import and
                select a driver in Settings → Database Drivers to run real queries.
              </span>
            ) : null}

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

            <label>
              Connection Profile
              <SearchableSelect
                ariaLabel="Oracle connection profile"
                value={connectionProfileId}
                placeholder={profiles.length ? "Select a connection profile…" : "No Oracle profiles yet"}
                options={profiles.map((p) => ({ value: p.id, label: p.name }))}
                onChange={setConnectionProfileId}
              />
            </label>

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
                  <button className="toolbar-button" type="button" onClick={() => void refreshSnapshot()} disabled={refreshing || busy}>
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
          <button className="toolbar-button primary" type="button" onClick={() => void saveAndClose()} disabled={busy || refreshing}>
            {busy ? "Saving…" : editing ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
