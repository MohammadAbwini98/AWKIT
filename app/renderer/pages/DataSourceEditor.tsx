import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Columns3,
  Copy,
  Download,
  ListPlus,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { usePageChrome } from "../state/pageChrome";
import { useNavigation } from "../state/navigation";
import { usePermissions } from "../security/usePermissions";
import { Permission } from "@src/security/authz/Permissions";
import { ConfirmDialog } from "../components/shared/ConfirmDialog";
import { coerceCellValue, deriveColumns, displayCellValue, normalizeRows } from "@src/data/TableEditing";
import type { JsonArrayDataSourceProfile } from "@src/data/DataSourceProfile";

type Row = Record<string, unknown>;
type Banner = { type: "success" | "error"; text: string } | null;

const PAGE_SIZES = [25, 50, 100, 0] as const; // 0 = All

export function DataSourceEditor() {
  const { navigateTo } = useNavigation();
  const { can } = usePermissions();
  const canManage = can(Permission.DATASOURCE_MANAGE);
  const [profile, setProfile] = useState<JsonArrayDataSourceProfile | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [writable, setWritable] = useState(true);
  const [loadMessage, setLoadMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [version, setVersion] = useState(0); // bump to re-mount uncontrolled cell inputs

  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const [renaming, setRenaming] = useState<{ col: string; value: string } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const targetId = useRef<string>("");

  const markDirty = useCallback(() => {
    setDirty(true);
    setBanner(null);
  }, []);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const applyData = useCallback((nextRows: Row[]) => {
    const cols = deriveColumns(nextRows);
    setColumns(cols);
    setRows(normalizeRows(nextRows, cols));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadMessage(null);
    try {
      const settings = await window.playwrightFlowStudio.settings.get();
      const id = settings.selections.lastSelectedDataSourceId;
      if (!id) {
        setLoadMessage("No data source selected. Open one from the Data Source Manager.");
        setLoading(false);
        return;
      }
      targetId.current = id;
      const result = await window.playwrightFlowStudio.dataSources.readJson(id);
      setProfile(result.profile);
      setWritable(result.writable ?? true);
      if (!result.editable) {
        setLoadMessage(result.message ?? "This data source cannot be edited visually.");
        setRows([]);
        setColumns([]);
      } else {
        applyData(result.rows as Row[]);
      }
      setSelected(new Set());
      setSearch("");
      setPage(1);
      setDirty(false);
      bump();
    } catch (error) {
      setLoadMessage(error instanceof Error ? error.message : "Unable to read data source file.");
    } finally {
      setLoading(false);
    }
  }, [applyData, bump]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── Cell / row / column operations ─────────────────────────────────────────
  const setCell = useCallback(
    (absIndex: number, col: string, text: string) => {
      setRows((prev) => {
        const next = [...prev];
        next[absIndex] = { ...next[absIndex], [col]: coerceCellValue(text) };
        return next;
      });
      markDirty();
    },
    [markDirty]
  );

  const nextId = useCallback((): number => {
    if (!columns.includes("id")) return rows.length + 1;
    const max = rows.reduce((m, r) => (typeof r.id === "number" && r.id > m ? r.id : m), 0);
    return max + 1;
  }, [columns, rows]);

  const addRow = useCallback(() => {
    const row: Row = {};
    for (const col of columns) row[col] = col === "id" ? nextId() : "";
    setRows((prev) => [...prev, row]);
    setSelected(new Set());
    markDirty();
    bump();
  }, [columns, nextId, markDirty, bump]);

  const duplicateRow = useCallback(
    (absIndex: number) => {
      setRows((prev) => {
        const copy = { ...prev[absIndex] };
        if ("id" in copy) {
          const max = prev.reduce((m, r) => (typeof r.id === "number" && r.id > m ? r.id : m), 0);
          copy.id = max + 1;
        }
        const next = [...prev];
        next.splice(absIndex + 1, 0, copy);
        return next;
      });
      setSelected(new Set());
      markDirty();
      bump();
    },
    [markDirty, bump]
  );

  const deleteRows = useCallback(
    (indices: number[]) => {
      const drop = new Set(indices);
      setRows((prev) => prev.filter((_, i) => !drop.has(i)));
      setSelected(new Set());
      markDirty();
      bump();
    },
    [markDirty, bump]
  );

  const addColumn = useCallback(
    (name: string, defaultValue: unknown) => {
      const col = name.trim();
      if (!col) return "Column name cannot be empty.";
      if (columns.includes(col)) return `Column "${col}" already exists.`;
      setColumns((prev) => [...prev, col]);
      setRows((prev) => prev.map((r) => ({ ...r, [col]: defaultValue })));
      markDirty();
      bump();
      return null;
    },
    [columns, markDirty, bump]
  );

  const renameColumn = useCallback(
    (from: string, to: string): string | null => {
      const target = to.trim();
      if (!target) return "Column name cannot be empty.";
      if (target === from) return null;
      if (columns.includes(target)) return `Column "${target}" already exists.`;
      setColumns((prev) => prev.map((c) => (c === from ? target : c)));
      setRows((prev) =>
        prev.map((r) => {
          const next: Row = {};
          for (const [k, v] of Object.entries(r)) next[k === from ? target : k] = v;
          return next;
        })
      );
      markDirty();
      bump();
      return null;
    },
    [columns, markDirty, bump]
  );

  const deleteColumn = useCallback(
    (col: string) => {
      setColumns((prev) => prev.filter((c) => c !== col));
      setRows((prev) =>
        prev.map((r) => {
          const next = { ...r };
          delete next[col];
          return next;
        })
      );
      markDirty();
      bump();
    },
    [markDirty, bump]
  );

  // ── Save / revert / import / export ────────────────────────────────────────
  const save = useCallback(async () => {
    if (!profile) return;
    if (columns.some((c) => !c.trim())) {
      setBanner({ type: "error", text: "Column names cannot be empty." });
      return;
    }
    try {
      const payload = rows.map((row) => {
        const ordered: Row = {};
        for (const col of columns) ordered[col] = row[col];
        return ordered;
      });
      const updated = await window.playwrightFlowStudio.dataSources.writeJson(targetId.current, payload);
      setProfile(updated);
      setWritable(true);
      setDirty(false);
      setBanner({ type: "success", text: `Saved ${payload.length} record(s) to ${updated.file}.` });
    } catch (error) {
      setBanner({ type: "error", text: error instanceof Error ? error.message : "Failed to save." });
    }
  }, [profile, columns, rows]);

  const revert = useCallback(() => {
    setConfirm({
      title: "Revert changes",
      message: "Discard all unsaved edits and reload the data source from disk?",
      onConfirm: () => {
        setConfirm(null);
        void load();
      }
    });
  }, [load]);

  const exportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c]]))), null, 2)], {
      type: "application/json"
    });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = profile ? `${profile.id}.json` : "data-source.json";
    link.click();
    URL.revokeObjectURL(href);
  }, [rows, columns, profile]);

  const importJson = useCallback(
    async (file: File) => {
      try {
        const parsed = JSON.parse(await file.text());
        if (!Array.isArray(parsed) || parsed.some((i) => !i || typeof i !== "object" || Array.isArray(i))) {
          setBanner({ type: "error", text: "Imported file must be a root array of objects." });
          return;
        }
        applyData(parsed as Row[]);
        setSelected(new Set());
        setPage(1);
        markDirty();
        bump();
        setBanner({ type: "success", text: `Imported ${parsed.length} record(s). Review and Save to persist.` });
      } catch {
        setBanner({ type: "error", text: "Could not parse the imported JSON file." });
      }
    },
    [applyData, markDirty, bump]
  );

  // Register the Save action so the unsaved-changes dialog's "Save and Continue" works.
  usePageChrome(
    {
      actions:
        profile && !loadMessage
          ? [{ id: "save", label: "Save", variant: "primary", onClick: () => save(), title: canManage ? "Save data source" : "Requires the Manage Data Sources permission", disabled: !canManage }]
          : [],
      dirty
    },
    [profile, loadMessage, dirty, save, canManage]
  );

  // ── Derived: filter + paginate ─────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const withIndex = rows.map((row, index) => ({ row, index }));
    if (!q) return withIndex;
    return withIndex.filter(({ row }) => columns.some((c) => displayCellValue(row[c]).toLowerCase().includes(q)));
  }, [rows, columns, search]);

  const total = filtered.length;
  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visible = pageSize === 0 ? filtered : filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // ── id warnings (dynamic-binding compatibility) ────────────────────────────
  const idWarning = useMemo(() => {
    if (!columns.includes("id")) return "No `id` column — dynamic instance-order binding may not work as expected.";
    const ids = rows.map((r) => r.id).filter((v) => v !== "" && v !== undefined);
    if (new Set(ids.map(String)).size !== ids.length) return "Duplicate `id` values found — dynamic binding by id may be ambiguous.";
    return null;
  }, [columns, rows]);

  if (loading) {
    return (
      <section className="page">
        <section className="work-panel"><div className="empty-state"><strong>Loading data source…</strong></div></section>
      </section>
    );
  }

  if (loadMessage) {
    return (
      <section className="page">
        <section className="work-panel">
          <div className="section-heading">
            <h1>Data Source Editor</h1>
            <span>{profile?.name ?? ""}</span>
          </div>
          <div className="empty-state">
            <strong>{loadMessage}</strong>
            <span>Only root arrays of JSON objects can be edited as a table.</span>
            <button className="toolbar-button" type="button" onClick={() => navigateTo("dataSources")}>
              <ArrowLeft size={15} /> Back to Data Sources
            </button>
          </div>
        </section>
      </section>
    );
  }

  return (
    <section className="page">
      <section className="work-panel">
        <div className="section-heading">
          <div className="properties-heading-text">
            <h1>Data Source Editor</h1>
            <span>
              {profile?.name} · {profile?.file} · {rows.length} record(s) · {columns.length} column(s)
              {dirty ? " · unsaved changes" : ""}
            </span>
          </div>
          <button className="toolbar-button" type="button" onClick={() => navigateTo("dataSources")} title="Back to Data Sources">
            <ArrowLeft size={15} /> Back
          </button>
        </div>

        {!writable ? (
          <div className="settings-banner">This is a bundled sample. Saving will copy it to your editable data-sources folder.</div>
        ) : null}
        {idWarning ? <div className="settings-banner">{idWarning}</div> : null}
        {banner ? <div className={`settings-banner ${banner.type}`}>{banner.text}</div> : null}

        <div className="library-toolbar">
          <button className="toolbar-button primary" type="button" onClick={() => void save()} disabled={!dirty || !canManage} title={canManage ? undefined : "Requires the Manage Data Sources permission"}>
            <Save size={15} /> Save
          </button>
          <button className="toolbar-button" type="button" onClick={addRow}>
            <ListPlus size={15} /> Add Row
          </button>
          <button className="toolbar-button" type="button" onClick={() => setAddColumnOpen(true)}>
            <Columns3 size={15} /> Add Column
          </button>
          <button
            className="toolbar-button"
            type="button"
            disabled={selected.size === 0}
            onClick={() =>
              setConfirm({
                title: "Delete selected rows",
                message: `Delete ${selected.size} selected record(s)? This cannot be undone until you reload.`,
                onConfirm: () => {
                  setConfirm(null);
                  deleteRows([...selected]);
                }
              })
            }
          >
            <Trash2 size={15} /> Delete Selected{selected.size ? ` (${selected.size})` : ""}
          </button>
          <button className="toolbar-button" type="button" onClick={() => importRef.current?.click()}>
            <Upload size={15} /> Import JSON
          </button>
          <button className="toolbar-button" type="button" onClick={exportJson}>
            <Download size={15} /> Export JSON
          </button>
          <button
            className="toolbar-button"
            type="button"
            onClick={() =>
              setBanner(
                columns.some((c) => !c.trim())
                  ? { type: "error", text: "Empty column name found." }
                  : { type: "success", text: "Valid: root array of objects with unique, non-empty columns." }
              )
            }
          >
            <ShieldCheck size={15} /> Validate
          </button>
          <button className="toolbar-button" type="button" onClick={revert} disabled={!dirty}>
            <RotateCcw size={15} /> Revert
          </button>
          <input
            accept=".json,application/json"
            ref={importRef}
            style={{ display: "none" }}
            type="file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importJson(file);
              e.target.value = "";
            }}
          />
        </div>

        <div className="table-filters-bar">
          <div className="table-search">
            <Search size={15} />
            <input value={search} placeholder="Search records…" onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            {search ? (
              <button type="button" title="Clear" onClick={() => setSearch("")}><X size={14} /></button>
            ) : null}
          </div>
        </div>

        {columns.length === 0 && rows.length === 0 ? (
          <div className="empty-state">
            <strong>No records yet.</strong>
            <span>Add columns and records to build this data source.</span>
            <button className="toolbar-button primary" type="button" onClick={() => setAddColumnOpen(true)}>
              <Columns3 size={15} /> Add Column
            </button>
          </div>
        ) : (
          <>
            <div className="wl-table-wrapper">
              <table className="wl-table ds-editor-table">
                <thead>
                  <tr>
                    <th className="ds-select-col">
                      <input
                        type="checkbox"
                        checked={visible.length > 0 && visible.every(({ index }) => selected.has(index))}
                        onChange={(e) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            visible.forEach(({ index }) => (e.target.checked ? next.add(index) : next.delete(index)));
                            return next;
                          })
                        }
                      />
                    </th>
                    {columns.map((col) => (
                      <th key={col}>
                        <div className="ds-col-head">
                          {renaming?.col === col ? (
                            <input
                              autoFocus
                              value={renaming.value}
                              onChange={(e) => setRenaming({ col, value: e.target.value })}
                              onBlur={() => {
                                const err = renameColumn(col, renaming.value);
                                if (err) setBanner({ type: "error", text: err });
                                setRenaming(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                if (e.key === "Escape") setRenaming(null);
                              }}
                            />
                          ) : (
                            <button type="button" className="ds-col-name" title="Rename column" onClick={() => setRenaming({ col, value: col })}>
                              {col}
                            </button>
                          )}
                          <button
                            type="button"
                            className="ds-col-del"
                            title="Delete column"
                            onClick={() =>
                              setConfirm({
                                title: "Delete column",
                                message: `Delete column "${col}" from every record?`,
                                onConfirm: () => { setConfirm(null); deleteColumn(col); }
                              })
                            }
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </th>
                    ))}
                    <th className="ds-actions-col">Row</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(({ row, index }) => (
                    <tr key={index} className={selected.has(index) ? "ds-row-selected" : ""}>
                      <td className="ds-select-col">
                        <input
                          type="checkbox"
                          checked={selected.has(index)}
                          onChange={(e) =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(index);
                              else next.delete(index);
                              return next;
                            })
                          }
                        />
                      </td>
                      {columns.map((col) => (
                        <td key={col} className={`ds-cell ds-type-${typeof row[col] === "object" ? "json" : row[col] === null ? "null" : typeof row[col]}`}>
                          <input
                            key={`${version}-${index}-${col}`}
                            defaultValue={displayCellValue(row[col])}
                            onBlur={(e) => setCell(index, col, e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                          />
                        </td>
                      ))}
                      <td className="ds-actions-col">
                        <div className="table-actions">
                          <button type="button" title="Duplicate row" onClick={() => duplicateRow(index)}><Copy size={13} /></button>
                          <button
                            type="button"
                            title="Delete row"
                            onClick={() =>
                              setConfirm({
                                title: "Delete row",
                                message: "Delete this record?",
                                onConfirm: () => { setConfirm(null); deleteRows([index]); }
                              })
                            }
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="table-pagination">
              <span className="table-total">{total} record(s){total !== rows.length ? ` of ${rows.length}` : ""}</span>
              <label className="table-pagesize">
                Rows per page
                <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
                  {PAGE_SIZES.map((n) => <option key={n} value={n}>{n === 0 ? "All" : n}</option>)}
                </select>
              </label>
              <div className="table-page-controls">
                <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</button>
                <span className="table-page-indicator">Page {currentPage} of {totalPages}</span>
                <button type="button" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>Next</button>
              </div>
            </div>
          </>
        )}
      </section>

      {addColumnOpen ? (
        <AddColumnModal
          existing={columns}
          onCancel={() => setAddColumnOpen(false)}
          onAdd={(name, value) => {
            const err = addColumn(name, value);
            if (err) return err;
            setAddColumnOpen(false);
            return null;
          }}
        />
      ) : null}

      {confirm ? (
        <ConfirmDialog title={confirm.title} message={confirm.message} confirmLabel="Delete" danger onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />
      ) : null}
    </section>
  );
}

// ── Add Column modal ──────────────────────────────────────────────────────────
function AddColumnModal({ existing, onAdd, onCancel }: { existing: string[]; onAdd: (name: string, value: unknown) => string | null; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"string" | "number" | "boolean" | "null">("string");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    let defaultValue: unknown = value;
    if (type === "number") defaultValue = value.trim() === "" ? 0 : Number(value);
    else if (type === "boolean") defaultValue = value === "true";
    else if (type === "null") defaultValue = null;
    const err = onAdd(name, defaultValue);
    if (err) setError(err);
  };

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div className="modal-dialog" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2>Add column</h2></div>
        <div className="settings-grid">
          <label>
            Column name
            <input autoFocus value={name} onChange={(e) => { setName(e.target.value); setError(null); }} placeholder="e.g. email" />
          </label>
          <label>
            Default type
            <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="string">String</option>
              <option value="number">Number</option>
              <option value="boolean">Boolean</option>
              <option value="null">Null</option>
            </select>
          </label>
          {type === "boolean" ? (
            <label>
              Default value
              <select value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="false">false</option>
                <option value="true">true</option>
              </select>
            </label>
          ) : type !== "null" ? (
            <label>
              Default value
              <input value={value} onChange={(e) => setValue(e.target.value)} type={type === "number" ? "number" : "text"} />
            </label>
          ) : null}
        </div>
        {existing.includes(name.trim()) ? <div className="settings-banner error">Column already exists.</div> : null}
        {error ? <div className="settings-banner error">{error}</div> : null}
        <div className="modal-actions">
          <button className="toolbar-button" type="button" onClick={onCancel}>Cancel</button>
          <button className="toolbar-button primary" type="button" onClick={submit}>Add Column</button>
        </div>
      </div>
    </div>
  );
}
