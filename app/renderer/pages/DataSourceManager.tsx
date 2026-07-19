import { Copy, Database, Download, Eye, FilePlus2, Pencil, RefreshCw, ShieldCheck, Table2, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { usePageChrome } from "../state/pageChrome";
import { useNavigation } from "../state/navigation";
import { usePermissions } from "../security/usePermissions";
import { Permission } from "@src/security/authz/Permissions";
import type { JsonArrayDataSourceProfile, OracleDataSourceProfile } from "@src/data/DataSourceProfile";
import { OracleDataSourceModal } from "./OracleDataSourceModal";

type RowStatus = "unknown" | "valid" | "invalid";

interface PreviewState {
  id: string;
  name: string;
  rows: unknown[];
}

export function DataSourceManager() {
  const { navigateTo } = useNavigation();
  const { can } = usePermissions();
  const canManage = can(Permission.DATASOURCE_MANAGE);
  const manageHint = canManage ? undefined : "Requires the Manage Data Sources permission";
  const [dataSources, setDataSources] = useState<JsonArrayDataSourceProfile[]>([]);
  const [oracleSources, setOracleSources] = useState<OracleDataSourceProfile[]>([]);
  const [statusById, setStatusById] = useState<Record<string, RowStatus>>({});
  const [recordsById, setRecordsById] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  // null = closed; { profile } = open (profile null → create, set → edit).
  const [oracleModal, setOracleModal] = useState<{ profile: OracleDataSourceProfile | null } | null>(null);
  const [message, setMessage] = useState("Loading data sources…");

  useEffect(() => {
    void init();
  }, []);

  const loadOracle = async (): Promise<void> => {
    try {
      setOracleSources(await window.playwrightFlowStudio.oracle.listDataSources());
    } catch {
      /* Oracle services unavailable — leave the Oracle section empty (non-fatal). */
    }
  };

  const load = async (): Promise<JsonArrayDataSourceProfile[]> => {
    try {
      const profiles = await window.playwrightFlowStudio.dataSources.list();
      setDataSources(profiles);
      setMessage(`${profiles.length} JSON data source${profiles.length === 1 ? "" : "s"}`);
      return profiles;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load data sources");
      return [];
    }
  };

  // Restore the last selected data source if it still exists; otherwise clear it safely.
  const init = async () => {
    void loadOracle();
    const profiles = await load();
    try {
      const settings = await window.playwrightFlowStudio.settings.get();
      const lastId = settings.selections.lastSelectedDataSourceId;
      if (!lastId) return;
      const match = profiles.find((profile) => profile.id === lastId);
      if (match) void openPreview(match);
      else void window.playwrightFlowStudio.settings.update({ selections: { lastSelectedDataSourceId: null } });
    } catch {
      /* settings unavailable — non-fatal */
    }
  };

  const refresh = () => {
    void load();
    void loadOracle();
  };

  // ── Oracle Data Source actions ────────────────────────────────────────────
  const onOracleSaved = (profile: OracleDataSourceProfile) => {
    setOracleModal(null);
    setMessage(`Saved Oracle Data Source ${profile.name}`);
    void loadOracle();
  };

  const refreshOracleSnapshot = async (profile: OracleDataSourceProfile) => {
    setMessage(`Refreshing snapshot for ${profile.name}…`);
    try {
      const updated = await window.playwrightFlowStudio.oracle.refreshSnapshot(profile.id);
      const snap = updated.snapshot;
      setMessage(
        snap?.status === "error"
          ? `${profile.name}: ${snap.error ?? "snapshot refresh failed"}`
          : `${profile.name} snapshot updated (${snap?.rowCount ?? 0} row(s)).`
      );
      void loadOracle();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Snapshot refresh failed");
    }
  };

  const removeOracle = async (profile: OracleDataSourceProfile) => {
    await window.playwrightFlowStudio.oracle.deleteDataSource(profile.id).catch(() => undefined);
    setMessage(`Deleted ${profile.name}`);
    void loadOracle();
  };

  const addJson = async () => {
    try {
      const result = (await window.playwrightFlowStudio.dataSources.browseJson()) as
        | { canceled: true }
        | { canceled: false; profile: JsonArrayDataSourceProfile };
      if (result.canceled) return;
      setMessage(`Added ${result.profile.name}`);
      refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Invalid JSON file");
    }
  };

  const validate = async (profile: JsonArrayDataSourceProfile) => {
    try {
      const result = (await window.playwrightFlowStudio.dataSources.preview(profile.id, profile.path)) as {
        selected?: unknown;
        rows?: unknown[];
      };
      const rows = Array.isArray(result.selected) ? result.selected : result.rows ?? [];
      setStatusById((current) => ({ ...current, [profile.id]: "valid" }));
      setRecordsById((current) => ({ ...current, [profile.id]: rows.length }));
      setMessage(`${profile.name} is valid (${rows.length} record(s)).`);
    } catch (error) {
      setStatusById((current) => ({ ...current, [profile.id]: "invalid" }));
      setMessage(error instanceof Error ? `${profile.name}: ${error.message}` : `${profile.name} is invalid`);
    }
  };

  const openPreview = async (profile: JsonArrayDataSourceProfile) => {
    // Persist the user's data source selection so it restores on next launch.
    void window.playwrightFlowStudio.settings.update({ selections: { lastSelectedDataSourceId: profile.id } });
    try {
      const result = (await window.playwrightFlowStudio.dataSources.preview(profile.id, profile.path)) as {
        selected?: unknown;
        rows?: unknown[];
      };
      const rows = Array.isArray(result.selected) ? result.selected : result.rows ?? [];
      setPreview({ id: profile.id, name: profile.name, rows });
      setRecordsById((current) => ({ ...current, [profile.id]: rows.length }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to preview data source");
    }
  };

  const updateRootPath = async (profile: JsonArrayDataSourceProfile, path: string) => {
    const next = { ...profile, path, updatedAt: new Date().toISOString() };
    setDataSources((current) => current.map((item) => (item.id === profile.id ? next : item)));
    await window.playwrightFlowStudio.dataSources.update(profile.id, next).catch(() => undefined);
  };

  const remove = async (profile: JsonArrayDataSourceProfile) => {
    await window.playwrightFlowStudio.dataSources.delete(profile.id).catch(() => undefined);
    if (preview?.id === profile.id) setPreview(null);
    // Clear the persisted selection if the deleted source was the selected one.
    void window.playwrightFlowStudio.settings.get().then((settings) => {
      if (settings.selections.lastSelectedDataSourceId === profile.id) {
        void window.playwrightFlowStudio.settings.update({ selections: { lastSelectedDataSourceId: null } });
      }
    });
    refresh();
  };

  const editTable = async (profile: JsonArrayDataSourceProfile) => {
    await window.playwrightFlowStudio.settings.update({ selections: { lastSelectedDataSourceId: profile.id } }).catch(() => undefined);
    navigateTo("dataSourceEditor");
  };

  const duplicate = async (profile: JsonArrayDataSourceProfile) => {
    try {
      await window.playwrightFlowStudio.dataSources.clone(profile.id);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to duplicate data source");
    }
  };

  const exportData = async (profile: JsonArrayDataSourceProfile) => {
    try {
      const { rows } = await window.playwrightFlowStudio.dataSources.readJson(profile.id);
      const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `${profile.id}.json`;
      link.click();
      URL.revokeObjectURL(href);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to export data source");
    }
  };

  const createDataSource = async (name: string, fileName: string, columns: string[]) => {
    const seedRow = columns.length
      ? [Object.fromEntries(columns.map((c) => [c, c === "id" ? 1 : ""]))]
      : [];
    const profile = await window.playwrightFlowStudio.dataSources.createFromScratch({ name, fileName, rows: seedRow });
    setCreateOpen(false);
    await window.playwrightFlowStudio.settings.update({ selections: { lastSelectedDataSourceId: profile.id } }).catch(() => undefined);
    navigateTo("dataSourceEditor");
  };

  usePageChrome(
    {
      actions: [
        { id: "create", label: "Create", variant: "primary", onClick: () => setCreateOpen(true), title: canManage ? "Create a new data source" : manageHint, disabled: !canManage },
        { id: "add", label: "Add JSON", onClick: () => void addJson(), title: canManage ? "Add a JSON data source from disk" : manageHint, disabled: !canManage }
      ],
      dirty: false
    },
    [canManage]
  );

  const previewText = useMemo(() => (preview ? JSON.stringify(preview.rows.slice(0, 5), null, 2) : ""), [preview]);

  return (
    <section className="page">
      <section className="work-panel">
        <div className="section-heading">
          <h1>Data Source Manager</h1>
          <span>{message}</span>
        </div>

        <div className="library-toolbar">
          <button className="toolbar-button primary" onClick={() => setCreateOpen(true)} disabled={!canManage} title={manageHint} type="button">
            <FilePlus2 size={15} />
            Create Data Source
          </button>
          <button className="toolbar-button" onClick={() => void addJson()} disabled={!canManage} type="button" title={canManage ? "Add a JSON data source from disk" : manageHint}>
            <Upload size={15} />
            Add JSON
          </button>
          <button
            className="toolbar-button"
            onClick={() => setOracleModal({ profile: null })}
            disabled={!canManage}
            type="button"
            title={canManage ? "Create an Oracle-backed data source" : manageHint}
          >
            <Database size={15} />
            Add Oracle Source
          </button>
        </div>

        {dataSources.length ? (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>File Path</th>
                <th>Root Array Path</th>
                <th>Records</th>
                <th>Status</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {dataSources.map((source) => {
                const status = statusById[source.id] ?? "unknown";
                const records = recordsById[source.id] ?? source.rowCount;
                return (
                  <tr
                    key={source.id}
                    className={`ds-row${preview?.id === source.id ? " ds-row-selected" : ""}`}
                    onClick={() => void openPreview(source)}
                    title="Click to preview this data source"
                  >
                    <td>{source.name}</td>
                    <td title={source.file}>{source.file}</td>
                    <td>
                      <input
                        value={source.path}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => updateRootPath(source, event.target.value)}
                        disabled={!canManage}
                        title={manageHint}
                        aria-label={`Root array path for ${source.name}`}
                      />
                    </td>
                    <td>{records ?? "—"}</td>
                    <td>
                      <span className={`status-chip ${status === "valid" ? "ok" : status === "invalid" ? "warn" : "neutral"}`}>
                        {status === "valid" ? "Valid" : status === "invalid" ? "Invalid" : "Unchecked"}
                      </span>
                    </td>
                    <td>{source.updatedAt ? source.updatedAt.slice(0, 10) : "—"}</td>
                    <td>
                      <div className="table-actions" onClick={(event) => event.stopPropagation()}>
                        <button onClick={() => void editTable(source)} disabled={!canManage} title={canManage ? "Edit as table" : manageHint} type="button">
                          <Table2 size={14} />
                        </button>
                        <button onClick={() => void validate(source)} title="Validate JSON" type="button">
                          <ShieldCheck size={14} />
                        </button>
                        <button onClick={() => void openPreview(source)} title="Preview records" type="button">
                          <Eye size={14} />
                        </button>
                        <button onClick={() => void duplicate(source)} disabled={!canManage} title={canManage ? "Duplicate data source" : manageHint} type="button">
                          <Copy size={14} />
                        </button>
                        <button onClick={() => void exportData(source)} title="Export JSON" type="button">
                          <Download size={14} />
                        </button>
                        <button onClick={() => void remove(source)} disabled={!canManage} title={canManage ? "Delete data source" : manageHint} type="button">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <section className="empty-state">
            <strong>No JSON data sources yet.</strong>
            <span>Create one from scratch, or add a JSON file from disk.</span>
            <button className="toolbar-button primary" onClick={() => setCreateOpen(true)} disabled={!canManage} title={manageHint} type="button">
              <FilePlus2 size={15} />
              Create Data Source
            </button>
          </section>
        )}

        {oracleSources.length ? (
          <div className="report-section">
            <div className="section-heading compact">
              <h2>Oracle Data Sources</h2>
              <span>{oracleSources.length} Oracle source{oracleSources.length === 1 ? "" : "s"}</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Connection</th>
                  <th>Mode</th>
                  <th>Records</th>
                  <th>Snapshot</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {oracleSources.map((source) => {
                  const snap = source.snapshot;
                  const snapClass = snap?.status === "ready" ? "ok" : snap?.status === "error" ? "warn" : "neutral";
                  return (
                    <tr key={source.id}>
                      <td title={source.description ?? undefined}>{source.name}</td>
                      <td>{source.connectionProfileId}</td>
                      <td>{source.mode === "snapshot" ? "Snapshot" : "Runtime"}</td>
                      <td>{source.mode === "snapshot" ? snap?.rowCount ?? "—" : "live"}</td>
                      <td>
                        {source.mode === "snapshot" ? (
                          <span className={`status-chip ${snapClass}`}>{snap ? snap.status : "none"}</span>
                        ) : (
                          <span className="status-chip neutral">—</span>
                        )}
                      </td>
                      <td>{source.updatedAt ? source.updatedAt.slice(0, 10) : "—"}</td>
                      <td>
                        <div className="table-actions">
                          <button onClick={() => setOracleModal({ profile: source })} disabled={!canManage} title={canManage ? "Edit Oracle Data Source" : manageHint} type="button">
                            <Pencil size={14} />
                          </button>
                          {source.mode === "snapshot" ? (
                            <button onClick={() => void refreshOracleSnapshot(source)} disabled={!canManage} title={canManage ? "Refresh offline snapshot" : manageHint} type="button">
                              <RefreshCw size={14} />
                            </button>
                          ) : null}
                          <button onClick={() => void removeOracle(source)} disabled={!canManage} title={canManage ? "Delete Oracle Data Source" : manageHint} type="button">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {preview ? (
          <div className="report-section">
            <div className="section-heading compact">
              <h2>Preview — {preview.name}</h2>
              <span>{preview.rows.length} record(s), showing first 5</span>
            </div>
            <pre className="json-preview">{previewText}</pre>
          </div>
        ) : null}
      </section>

      {createOpen ? (
        <CreateDataSourceModal
          onCancel={() => setCreateOpen(false)}
          onCreate={createDataSource}
        />
      ) : null}

      {oracleModal ? (
        <OracleDataSourceModal
          initial={oracleModal.profile}
          onClose={() => setOracleModal(null)}
          onSaved={onOracleSaved}
        />
      ) : null}
    </section>
  );
}

// ── Create Data Source modal ──────────────────────────────────────────────────
function CreateDataSourceModal({
  onCreate,
  onCancel
}: {
  onCreate: (name: string, fileName: string, columns: string[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [fileName, setFileName] = useState("");
  const [columns, setColumns] = useState<string[]>(["id", "name"]);
  const [newCol, setNewCol] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const addCol = () => {
    const col = newCol.trim();
    if (!col) return;
    if (columns.includes(col)) { setError(`Column "${col}" already exists.`); return; }
    setColumns((prev) => [...prev, col]);
    setNewCol("");
    setError(null);
  };

  const submit = async () => {
    if (!name.trim()) { setError("Name is required."); return; }
    setBusy(true);
    setError(null);
    try {
      await onCreate(name.trim(), (fileName.trim() || name.trim()), columns);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create data source.");
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div className="modal-dialog" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2>Create data source</h2></div>
        <div className="settings-grid">
          <label>
            Name
            <input autoFocus value={name} onChange={(e) => { setName(e.target.value); setError(null); }} placeholder="Customers" />
          </label>
          <label>
            File name
            <input value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="customers.json (.json appended if omitted)" />
          </label>
        </div>
        <div className="property-section">
          <span className="form-message">Columns</span>
          <div className="ds-create-cols">
            {columns.map((col) => (
              <span className="state-pill" key={col} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                {col}
                <button type="button" className="ds-col-del" onClick={() => setColumns((prev) => prev.filter((c) => c !== col))} title={`Remove ${col}`}>
                  <Trash2 size={11} />
                </button>
              </span>
            ))}
          </div>
          <div className="settings-path-row">
            <input value={newCol} placeholder="Add column…" onChange={(e) => setNewCol(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addCol(); }} />
            <button type="button" className="toolbar-button" onClick={addCol}>Add Column</button>
          </div>
        </div>
        {error ? <div className="settings-banner error">{error}</div> : null}
        <div className="modal-actions">
          <button className="toolbar-button" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="toolbar-button primary" type="button" onClick={() => void submit()} disabled={busy}>
            {busy ? "Creating…" : "Create & Edit"}
          </button>
        </div>
      </div>
    </div>
  );
}
