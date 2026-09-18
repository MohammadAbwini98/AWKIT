import {
  CheckCircle2,
  CircleDashed,
  Copy,
  Database,
  Download,
  Eye,
  FilePlus2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Table2,
  Trash2,
  Upload,
  X,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { usePageChrome } from "../state/pageChrome";
import { useNavigation } from "../state/navigation";
import { usePermissions } from "../security/usePermissions";
import { Permission } from "@src/security/authz/Permissions";
import type { JsonArrayDataSourceProfile, OracleDataSourceProfile } from "@src/data/DataSourceProfile";
import type { WorkflowProfile } from "@src/profiles/WorkflowProfile";
import { NodeOptionsMenu, type NodeMenuItem } from "../components/shared/NodeOptionsMenu";
import {
  SysBadge,
  SysBanner,
  SysButton,
  SysCellActions,
  SysCellText,
  SysChips,
  SysField,
  SysFilters,
  SysFormError,
  SysIconButton,
  SysMainCell,
  SysModal,
  SysModalFields,
  SysPage,
  SysPagination,
  SysPanel,
  SysPanels,
  SysTable,
  SysTableCard,
  SysTableEmpty,
  SysTdCheck,
  SysTh,
  SysThCheck,
  sortRows,
  useSysFilters,
  useSysPaging,
  useSysSelection,
  useSysSort,
  type SysFilterField,
  type SysTone
} from "../components/system/SystemUI";
import { OracleDataSourceModal } from "./OracleDataSourceModal";

type RowStatus = "unknown" | "valid" | "invalid";

interface PreviewState {
  id: string;
  name: string;
  rows: unknown[];
}

/** One table row over either store; `key` is unique across both kinds. */
type SourceRow =
  | { key: string; kind: "json"; name: string; profile: JsonArrayDataSourceProfile }
  | { key: string; kind: "oracle"; name: string; profile: OracleDataSourceProfile };

const FILTER_FIELDS: SysFilterField[] = [
  {
    key: "type",
    label: "Type",
    type: "select",
    options: [
      { value: "all", label: "Any" },
      { value: "json", label: "JSON file" },
      { value: "oracle", label: "Oracle" }
    ]
  },
  { key: "rows", label: "Min rows", type: "number", placeholder: "0" }
];

type Notice = { tone: SysTone; text: string } | null;

export function DataSourceManager() {
  const { navigateTo } = useNavigation();
  const { can } = usePermissions();
  const canManage = can(Permission.DATASOURCE_MANAGE);
  const manageHint = canManage ? undefined : "Requires the Manage Data Sources permission";
  const [dataSources, setDataSources] = useState<JsonArrayDataSourceProfile[]>([]);
  const [oracleSources, setOracleSources] = useState<OracleDataSourceProfile[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowProfile[]>([]);
  const [statusById, setStatusById] = useState<Record<string, RowStatus>>({});
  const [recordsById, setRecordsById] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  // null = closed; { profile } = open (profile null → create, set → edit).
  const [oracleModal, setOracleModal] = useState<{ profile: OracleDataSourceProfile | null } | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [loaded, setLoaded] = useState(false);
  const [menu, setMenu] = useState<{ row: SourceRow; anchor: HTMLElement } | null>(null);
  const [deleting, setDeleting] = useState<SourceRow[] | null>(null);
  const filters = useSysFilters();
  const { sort, toggle: toggleSort } = useSysSort("name");

  useEffect(() => {
    void init();
  }, []);

  const loadOracle = async (): Promise<void> => {
    try {
      setOracleSources(await window.playwrightFlowStudio.oracle.listDataSources());
    } catch {
      /* Oracle services unavailable — leave the Oracle rows empty (non-fatal). */
    }
  };

  const load = async (): Promise<JsonArrayDataSourceProfile[]> => {
    try {
      const profiles = await window.playwrightFlowStudio.dataSources.list();
      setDataSources(profiles);
      return profiles;
    } catch (error) {
      setNotice({ tone: "danger", text: error instanceof Error ? error.message : "Unable to load data sources" });
      return [];
    } finally {
      setLoaded(true);
    }
  };

  // "Bound to" is read from the workflows that reference each source; a role without the Workflows
  // read simply sees "—" rather than an error.
  const loadWorkflows = async () => {
    try {
      setWorkflows(await window.playwrightFlowStudio.workflows.list());
    } catch {
      setWorkflows([]);
    }
  };

  // Restore the last selected data source if it still exists; otherwise clear it safely.
  const init = async () => {
    void loadOracle();
    void loadWorkflows();
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
    void loadWorkflows();
  };

  // ── Oracle Data Source actions ────────────────────────────────────────────
  const onOracleSaved = (profile: OracleDataSourceProfile) => {
    setOracleModal(null);
    setNotice({ tone: "success", text: `Saved Oracle Data Source ${profile.name}` });
    void loadOracle();
  };

  const refreshOracleSnapshot = async (profile: OracleDataSourceProfile) => {
    setNotice({ tone: "info", text: `Refreshing snapshot for ${profile.name}…` });
    try {
      const updated = await window.playwrightFlowStudio.oracle.refreshSnapshot(profile.id);
      const snap = updated.snapshot;
      setNotice(
        snap?.status === "error"
          ? { tone: "danger", text: `${profile.name}: ${snap.error ?? "snapshot refresh failed"}` }
          : { tone: "success", text: `${profile.name} snapshot updated (${snap?.rowCount ?? 0} row(s)).` }
      );
      void loadOracle();
    } catch (error) {
      setNotice({ tone: "danger", text: error instanceof Error ? error.message : "Snapshot refresh failed" });
    }
  };

  const addJson = async () => {
    try {
      const result = (await window.playwrightFlowStudio.dataSources.browseJson()) as
        | { canceled: true }
        | { canceled: false; profile: JsonArrayDataSourceProfile };
      if (result.canceled) return;
      setNotice({ tone: "success", text: `Added ${result.profile.name}` });
      refresh();
    } catch (error) {
      setNotice({ tone: "danger", text: error instanceof Error ? error.message : "Invalid JSON file" });
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
      setNotice({ tone: "success", text: `${profile.name} is valid (${rows.length} record(s)).` });
    } catch (error) {
      setStatusById((current) => ({ ...current, [profile.id]: "invalid" }));
      setNotice({ tone: "danger", text: error instanceof Error ? `${profile.name}: ${error.message}` : `${profile.name} is invalid` });
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
      setNotice({ tone: "danger", text: error instanceof Error ? error.message : "Unable to preview data source" });
    }
  };

  const updateRootPath = async (profile: JsonArrayDataSourceProfile, path: string) => {
    const next = { ...profile, path, updatedAt: new Date().toISOString() };
    setDataSources((current) => current.map((item) => (item.id === profile.id ? next : item)));
    await window.playwrightFlowStudio.dataSources.update(profile.id, next).catch(() => undefined);
  };

  const removeJson = async (profile: JsonArrayDataSourceProfile) => {
    await window.playwrightFlowStudio.dataSources.delete(profile.id).catch(() => undefined);
    if (preview?.id === profile.id) setPreview(null);
    // Clear the persisted selection if the deleted source was the selected one.
    void window.playwrightFlowStudio.settings.get().then((settings) => {
      if (settings.selections.lastSelectedDataSourceId === profile.id) {
        void window.playwrightFlowStudio.settings.update({ selections: { lastSelectedDataSourceId: null } });
      }
    });
  };

  const removeRows = async (rows: SourceRow[]) => {
    for (const row of rows) {
      if (row.kind === "json") await removeJson(row.profile);
      else await window.playwrightFlowStudio.oracle.deleteDataSource(row.profile.id).catch(() => undefined);
    }
    setNotice({ tone: "success", text: rows.length === 1 ? `Deleted ${rows[0].name}` : `Deleted ${rows.length} data sources` });
    selection.clear();
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
      setNotice({ tone: "success", text: `Duplicated ${profile.name}` });
    } catch (error) {
      setNotice({ tone: "danger", text: error instanceof Error ? error.message : "Unable to duplicate data source" });
    }
  };

  const exportData = async (profile: JsonArrayDataSourceProfile) => {
    try {
      const { rows } = await window.playwrightFlowStudio.dataSources.readJson(profile.id);
      const href = URL.createObjectURL(new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = href;
      link.download = `${profile.id}.json`;
      link.click();
      URL.revokeObjectURL(href);
    } catch (error) {
      setNotice({ tone: "danger", text: error instanceof Error ? error.message : "Unable to export data source" });
    }
  };

  const createDataSource = async (name: string, fileName: string, columns: string[]) => {
    const seedRow = columns.length ? [Object.fromEntries(columns.map((c) => [c, c === "id" ? 1 : ""]))] : [];
    const profile = await window.playwrightFlowStudio.dataSources.createFromScratch({ name, fileName, rows: seedRow });
    setCreateOpen(false);
    await window.playwrightFlowStudio.settings.update({ selections: { lastSelectedDataSourceId: profile.id } }).catch(() => undefined);
    navigateTo("dataSourceEditor");
  };

  usePageChrome(
    {
      actions: [
        { id: "create", label: "New data source", icon: <Plus size={15} aria-hidden="true" />, variant: "primary", onClick: () => setCreateOpen(true), title: canManage ? "Create a new data source" : manageHint, disabled: !canManage },
        { id: "oracle", label: "Oracle connection", icon: <Database size={15} aria-hidden="true" />, onClick: () => setOracleModal({ profile: null }), title: canManage ? "Create an Oracle-backed data source" : manageHint, disabled: !canManage }
      ],
      dirty: false
    },
    [canManage, manageHint]
  );

  // Which workflows reference each data source id (workflow-level binding or a node binding).
  const boundTo = useMemo(() => {
    const map = new Map<string, string[]>();
    const add = (id: string | undefined, name: string) => {
      if (!id) return;
      const list = map.get(id) ?? [];
      if (!list.includes(name)) map.set(id, [...list, name]);
    };
    for (const workflow of workflows) {
      add(workflow.dataSource?.dataSourceId, workflow.name);
      for (const node of workflow.nodes ?? []) add((node as { dataSourceId?: string }).dataSourceId, workflow.name);
    }
    return map;
  }, [workflows]);

  const allRows = useMemo<SourceRow[]>(
    () => [
      ...dataSources.map((profile): SourceRow => ({ key: `json:${profile.id}`, kind: "json", name: profile.name, profile })),
      ...oracleSources.map((profile): SourceRow => ({ key: `oracle:${profile.id}`, kind: "oracle", name: profile.name, profile }))
    ],
    [dataSources, oracleSources]
  );

  const rowCount = (row: SourceRow): number | null =>
    row.kind === "json"
      ? recordsById[row.profile.id] ?? row.profile.rowCount ?? null
      : row.profile.mode === "snapshot"
        ? row.profile.snapshot?.rowCount ?? null
        : null;

  const statusOf = (row: SourceRow): { label: string; tone: SysTone; icon: typeof CheckCircle2 } => {
    if (row.kind === "json") {
      const status = statusById[row.profile.id] ?? "unknown";
      return status === "valid"
        ? { label: "Valid", tone: "success", icon: CheckCircle2 }
        : status === "invalid"
          ? { label: "Invalid", tone: "danger", icon: XCircle }
          : { label: "Unchecked", tone: "neutral", icon: CircleDashed };
    }
    if (row.profile.mode !== "snapshot") return { label: "Runtime query", tone: "info", icon: Database };
    const snap = row.profile.snapshot;
    return snap?.status === "ready"
      ? { label: "Snapshot ready", tone: "success", icon: CheckCircle2 }
      : snap?.status === "error"
        ? { label: "Snapshot error", tone: "danger", icon: XCircle }
        : { label: snap ? `Snapshot ${snap.status}` : "No snapshot", tone: "neutral", icon: CircleDashed };
  };

  const filtered = useMemo(() => {
    const query = filters.search.trim().toLocaleLowerCase();
    const { type, rows } = filters.applied;
    const minRows = rows ? Number(rows) : Number.NaN;
    return allRows.filter((row) => {
      if (type && row.kind !== type) return false;
      if (!Number.isNaN(minRows) && (rowCount(row) ?? 0) < minRows) return false;
      if (!query) return true;
      const haystack = row.kind === "json"
        ? `${row.name} ${row.profile.file} ${row.profile.path}`
        : `${row.name} ${row.profile.connectionProfileId} ${row.profile.description ?? ""}`;
      return haystack.toLocaleLowerCase().includes(query);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, filters.applied, filters.search, recordsById]);

  const sorted = sortRows(filtered, sort, {
    name: (row) => row.name.toLocaleLowerCase(),
    type: (row) => row.kind,
    rows: (row) => rowCount(row) ?? -1,
    status: (row) => statusOf(row).label
  });
  const paging = useSysPaging(sorted.length);
  const pageRows = paging.slice(sorted);
  const selection = useSysSelection(pageRows.map((row) => row.key));
  const selectedRows = allRows.filter((row) => selection.selected.includes(row.key));
  const selectedJson = selectedRows.filter((row): row is Extract<SourceRow, { kind: "json" }> => row.kind === "json");

  const menuItems = (row: SourceRow): NodeMenuItem[] =>
    row.kind === "json"
      ? [
          { id: "duplicate", label: "Duplicate", icon: Copy, disabled: !canManage, title: manageHint, onSelect: () => void duplicate(row.profile) },
          { id: "export", label: "Export JSON", icon: Download, onSelect: () => void exportData(row.profile) },
          { id: "delete", label: "Delete", icon: Trash2, tone: "danger", disabled: !canManage, title: manageHint, onSelect: () => setDeleting([row]) }
        ]
      : [{ id: "delete", label: "Delete", icon: Trash2, tone: "danger", disabled: !canManage, title: manageHint, onSelect: () => setDeleting([row]) }];

  const previewProfile = preview ? dataSources.find((source) => source.id === preview.id) : undefined;
  const previewText = useMemo(() => (preview ? JSON.stringify(preview.rows.slice(0, 5), null, 2) : ""), [preview]);

  return (
    <SysPage className="data-sources-page">
      <h1 className="sr-only">Data Sources</h1>
      {notice ? (
        <SysBanner tone={notice.tone} actionLabel="Dismiss" onAction={() => setNotice(null)}>
          {notice.text}
        </SysBanner>
      ) : null}

      <SysFilters label="Data source filters" searchPlaceholder="Search data sources by name or path…" fields={FILTER_FIELDS} state={filters} />

      <SysTableCard
        title="Data sources"
        selectionCount={selection.selected.length}
        actions={
          <>
            <SysButton kind="small" icon={Upload} disabled={!canManage} title={canManage ? "Add a JSON data source from disk" : manageHint} onClick={() => void addJson()}>
              Add JSON file
            </SysButton>
            <SysButton kind="small" icon={RefreshCw} onClick={refresh} title="Reload saved data sources">
              Refresh
            </SysButton>
            <SysButton
              kind="small"
              icon={Pencil}
              disabled={!canManage || selectedJson.length !== 1 || selectedRows.length !== 1}
              title={canManage ? "Edit the selected JSON source as a table" : manageHint}
              onClick={() => selectedJson[0] && void editTable(selectedJson[0].profile)}
            >
              Edit rows
            </SysButton>
            <SysButton
              kind="smallDanger"
              icon={Trash2}
              disabled={!canManage || selectedRows.length === 0}
              title={canManage ? "Delete the selected data sources" : manageHint}
              onClick={() => setDeleting(selectedRows)}
            >
              Delete
            </SysButton>
          </>
        }
      >
        {!loaded ? (
          <SysTableEmpty icon={Database} title="Loading data sources…" />
        ) : allRows.length === 0 ? (
          <SysTableEmpty
            icon={Database}
            title="No data sources yet"
            hint="Create one from scratch, add a JSON file from disk, or connect an Oracle source."
            actionLabel={canManage ? "Create data source" : undefined}
            onAction={canManage ? () => setCreateOpen(true) : undefined}
          />
        ) : sorted.length === 0 ? (
          <SysTableEmpty
            icon={Database}
            title="No rows match your filters"
            hint="Clear the applied filters to see all rows again."
            actionLabel="Clear filters"
            onAction={filters.clear}
          />
        ) : (
          <SysTable minWidth={900} caption="Data sources">
            <thead>
              <tr>
                <SysThCheck checked={selection.allSelected} onChange={selection.toggleAll} />
                <SysTh label="Source" sortKey="name" sort={sort} onSort={toggleSort} />
                <SysTh label="Type" sortKey="type" sort={sort} onSort={toggleSort} width={130} />
                <SysTh label="Rows" sortKey="rows" sort={sort} onSort={toggleSort} align="right" width={90} />
                <SysTh label="Bound to" width={200} />
                <SysTh label="Status" sortKey="status" sort={sort} onSort={toggleSort} width={160} />
                <SysTh label="" width={150} />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => {
                const status = statusOf(row);
                const count = rowCount(row);
                const bound = boundTo.get(row.profile.id) ?? [];
                const selected = selection.isSelected(row.key);
                const isPreviewed = row.kind === "json" && preview?.id === row.profile.id;
                return (
                  <tr
                    key={row.key}
                    className={`${row.kind === "json" ? "is-clickable" : ""}${selected || isPreviewed ? " is-selected" : ""}`}
                    title={row.kind === "json" ? "Click to preview this data source" : undefined}
                    onClick={() => (row.kind === "json" ? void openPreview(row.profile) : undefined)}
                  >
                    <SysTdCheck checked={selected} onChange={() => selection.toggle(row.key)} label={`Select ${row.name}`} />
                    <td>
                      <SysMainCell
                        tone={status.tone === "danger" ? "danger" : "running"}
                        icon={Database}
                        text={row.name}
                        sub={row.kind === "json" ? `${row.profile.file} · ${row.profile.path}` : row.profile.description ?? row.profile.connectionProfileId}
                        textTitle={row.kind === "json" ? row.profile.file : row.profile.connectionProfileId}
                      />
                    </td>
                    <td>
                      <SysChips items={[row.kind === "json" ? "JSON file" : "Oracle"]} />
                    </td>
                    <td className="sys-td-actions">
                      <SysCellText num strong={count !== null} muted={count === null}>
                        {count === null ? (row.kind === "oracle" && row.profile.mode !== "snapshot" ? "live" : "—") : count.toLocaleString()}
                      </SysCellText>
                    </td>
                    <td>
                      <SysCellText muted title={bound.join(", ") || undefined}>
                        {bound.length ? (bound.length > 2 ? `${bound.slice(0, 2).join(", ")} +${bound.length - 2}` : bound.join(", ")) : "—"}
                      </SysCellText>
                    </td>
                    <td>
                      <SysBadge tone={status.tone} icon={status.icon}>
                        {status.label}
                      </SysBadge>
                    </td>
                    <td className="sys-td-actions">
                      <SysCellActions>
                        {row.kind === "json" ? (
                          <>
                            <SysIconButton icon={Table2} label={`Edit rows of ${row.name}`} title={canManage ? "Edit as table" : manageHint} disabled={!canManage} onClick={() => void editTable(row.profile)} />
                            <SysIconButton icon={ShieldCheck} label={`Validate ${row.name}`} title="Validate JSON" onClick={() => void validate(row.profile)} />
                            <SysIconButton icon={Eye} label={`Preview ${row.name}`} title="Preview records" onClick={() => void openPreview(row.profile)} />
                          </>
                        ) : (
                          <>
                            <SysIconButton icon={Pencil} label={`Edit ${row.name}`} title={canManage ? "Edit Oracle Data Source" : manageHint} disabled={!canManage} onClick={() => setOracleModal({ profile: row.profile })} />
                            {row.profile.mode === "snapshot" ? (
                              <SysIconButton icon={RefreshCw} label={`Refresh snapshot of ${row.name}`} title={canManage ? "Refresh offline snapshot" : manageHint} disabled={!canManage} onClick={() => void refreshOracleSnapshot(row.profile)} />
                            ) : null}
                          </>
                        )}
                        <button
                          type="button"
                          className="sys-icon-btn"
                          aria-label={`${row.name} actions`}
                          aria-haspopup="menu"
                          title="More actions"
                          onClick={(event) => setMenu({ row, anchor: event.currentTarget })}
                        >
                          <MoreHorizontal size={16} aria-hidden="true" />
                        </button>
                      </SysCellActions>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </SysTable>
        )}
        <SysPagination
          total={sorted.length}
          noun="sources"
          page={paging.page}
          pageSize={paging.pageSize}
          totalPages={paging.totalPages}
          onPage={paging.setPage}
          onPageSize={paging.setPageSize}
        />
      </SysTableCard>

      {preview ? (
        <SysPanels min={640}>
          <SysPanel
            wide
            icon={Eye}
            title={`Preview — ${preview.name}`}
            meta={`${preview.rows.length} record(s), showing the first 5.`}
            actions={
              <>
                {previewProfile ? (
                  <SysButton kind="small" icon={Table2} disabled={!canManage} title={canManage ? "Edit as table" : manageHint} onClick={() => void editTable(previewProfile)}>
                    Edit rows
                  </SysButton>
                ) : null}
                <SysButton kind="small" icon={X} onClick={() => setPreview(null)}>
                  Close
                </SysButton>
              </>
            }
          >
            {previewProfile ? (
              <div className="data-sources-preview-path">
                <SysField label="Root array path" hint="JSON path selecting the row array. Saved as you type.">
                  <input
                    className="sys-control is-mono"
                    value={previewProfile.path}
                    disabled={!canManage}
                    title={manageHint}
                    aria-label={`Root array path for ${previewProfile.name}`}
                    onChange={(event) => void updateRootPath(previewProfile, event.target.value)}
                  />
                </SysField>
              </div>
            ) : null}
            <pre className="sys-code">{previewText}</pre>
          </SysPanel>
        </SysPanels>
      ) : null}

      <NodeOptionsMenu open={Boolean(menu)} anchor={menu?.anchor ?? null} onClose={() => setMenu(null)} items={menu ? menuItems(menu.row) : []} />

      {deleting ? (
        <SysModal
          role="alertdialog"
          tone="danger"
          icon={Trash2}
          width={420}
          title={deleting.length === 1 ? `Delete “${deleting[0].name}”?` : `Delete ${deleting.length} data sources?`}
          message="Workflows bound to a deleted source can no longer resolve their rows. This cannot be undone."
          onClose={() => setDeleting(null)}
          actions={
            <>
              <SysButton kind="secondary" onClick={() => setDeleting(null)}>Cancel</SysButton>
              <SysButton
                kind="danger"
                onClick={() => {
                  const rows = deleting;
                  setDeleting(null);
                  void removeRows(rows);
                }}
              >
                {deleting.length === 1 ? "Delete data source" : "Delete data sources"}
              </SysButton>
            </>
          }
        />
      ) : null}

      {createOpen ? <CreateDataSourceModal onCancel={() => setCreateOpen(false)} onCreate={createDataSource} /> : null}

      {oracleModal ? (
        <OracleDataSourceModal initial={oracleModal.profile} onClose={() => setOracleModal(null)} onSaved={onOracleSaved} />
      ) : null}
    </SysPage>
  );
}

// ── Create Data Source dialog ─────────────────────────────────────────────────
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
    if (columns.includes(col)) {
      setError(`Column "${col}" already exists.`);
      return;
    }
    setColumns((prev) => [...prev, col]);
    setNewCol("");
    setError(null);
  };

  const submit = async () => {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate(name.trim(), fileName.trim() || name.trim(), columns);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create data source.");
      setBusy(false);
    }
  };

  return (
    <SysModal
      icon={FilePlus2}
      title="New data source"
      message="Create an empty JSON data source on this machine, then edit its rows as a table and bind them to runtime inputs."
      onClose={onCancel}
      closeDisabled={busy}
      onSubmit={() => void submit()}
      actions={
        <>
          <SysButton kind="secondary" onClick={onCancel} disabled={busy}>Cancel</SysButton>
          <SysButton kind="primary" type="submit" disabled={busy}>{busy ? "Creating…" : "Create & Edit"}</SysButton>
        </>
      }
    >
      <SysModalFields>
        <SysField label="Name">
          <input className="sys-control" autoFocus value={name} onChange={(e) => { setName(e.target.value); setError(null); }} placeholder="Customers" />
        </SysField>
        <SysField label="File name" hint=".json is appended if omitted">
          <input className="sys-control is-mono" value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="customers.json" />
        </SysField>
        <SysField label="Columns" group wide hint="Each column becomes a field in the seed row.">
          <span className="sys-check-pills">
            {columns.map((col) => (
              <span className="data-sources-column-pill" key={col}>
                <code>{col}</code>
                <button type="button" onClick={() => setColumns((prev) => prev.filter((c) => c !== col))} aria-label={`Remove column ${col}`} title={`Remove ${col}`}>
                  <X size={10} strokeWidth={3} aria-hidden="true" />
                </button>
              </span>
            ))}
          </span>
          <span className="data-sources-add-column">
            <input
              className="sys-control is-mono"
              value={newCol}
              placeholder="Add column…"
              aria-label="New column name"
              onChange={(e) => setNewCol(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCol();
                }
              }}
            />
            <SysButton kind="small" icon={Plus} onClick={addCol}>Add column</SysButton>
          </span>
        </SysField>
        {error ? (
          <div className="sys-field is-wide">
            <SysFormError>{error}</SysFormError>
          </div>
        ) : null}
      </SysModalFields>
    </SysModal>
  );
}
