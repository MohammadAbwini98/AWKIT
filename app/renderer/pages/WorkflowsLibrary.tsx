import { Copy, Download, FolderOpen, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkflowProfile } from "@src/profiles/WorkflowProfile";
import { useNavigation } from "../state/navigation";
import { applyTable, useTableState, type RowAdapter } from "../components/table/tableState";
import { AdvancedTableFilters, DataTablePagination, SortableHeaderCell, TableEmptyState, type FilterFieldDef } from "../components/table/TableUI";

const workflowAdapter: RowAdapter<WorkflowProfile> = {
  id: (w) => w.id,
  name: (w) => w.name,
  status: (w) => ((w.nodes?.length ?? 0) > 0 ? "active" : "inactive"),
  version: (w) => w.version,
  nodes: (w) => w.nodes?.length ?? 0,
  connectors: (w) => w.edges?.length ?? 0,
  createdAt: (w) => w.createdAt,
  updatedAt: (w) => w.updatedAt,
  flows: (w) => w.nodes?.length ?? 0,
  dataSource: (w) => w.dataSource?.dataSourceId ?? "",
  mode: (w) => w.execution?.mode ?? "sequential",
  maxParallel: (w) => w.execution?.maxConcurrentInstances ?? 1
};

const workflowFilterFields: FilterFieldDef[] = [
  { key: "name", label: "Name", type: "text" },
  { key: "id", label: "ID", type: "text" },
  {
    key: "status",
    label: "Status",
    type: "select",
    options: [
      { value: "all", label: "All" },
      { value: "active", label: "Active" },
      { value: "inactive", label: "Inactive (empty)" }
    ]
  },
  {
    key: "mode",
    label: "Execution mode",
    type: "select",
    options: [
      { value: "all", label: "All" },
      { value: "sequential", label: "Sequential" },
      { value: "conditional", label: "Conditional" },
      { value: "parallel", label: "Parallel" },
      { value: "loop", label: "Loop" },
      { value: "manual", label: "Manual" }
    ]
  },
  { key: "dataSource", label: "Data source", type: "text" },
  { key: "version", label: "Version", type: "number" },
  { key: "createdFrom", label: "Created from", type: "date" },
  { key: "createdTo", label: "Created to", type: "date" },
  { key: "updatedFrom", label: "Updated from", type: "date" },
  { key: "updatedTo", label: "Updated to", type: "date" },
  { key: "flowsMin", label: "Min flows", type: "number" },
  { key: "flowsMax", label: "Max flows", type: "number" },
  { key: "nodesMin", label: "Min nodes", type: "number" },
  { key: "nodesMax", label: "Max nodes", type: "number" },
  { key: "connectorsMin", label: "Min connectors", type: "number" },
  { key: "connectorsMax", label: "Max connectors", type: "number" },
  { key: "maxParallelMin", label: "Min max-parallel", type: "number" },
  { key: "maxParallelMax", label: "Max max-parallel", type: "number" }
];

export function WorkflowsLibrary() {
  const { navigateTo } = useNavigation();
  const [workflows, setWorkflows] = useState<WorkflowProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const table = useTableState("workflows");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setWorkflows(await window.playwrightFlowStudio.workflows.list());
    } catch {
      setError("Failed to load workflows.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openInBuilder = useCallback(
    async (workflowId: string) => {
      await window.playwrightFlowStudio.settings.update({ selectedBuilderWorkflowId: workflowId }).catch(() => undefined);
      navigateTo("scenarioBuilder");
    },
    [navigateTo]
  );

  const createNew = useCallback(async () => {
    await window.playwrightFlowStudio.settings.update({ selectedBuilderWorkflowId: "" }).catch(() => undefined);
    navigateTo("scenarioBuilder");
  }, [navigateTo]);

  const cloneWorkflow = useCallback(
    async (id: string) => {
      try {
        await window.playwrightFlowStudio.workflows.clone(id);
        await load();
      } catch {
        setError("Failed to clone workflow.");
      }
    },
    [load]
  );

  const deleteWorkflow = useCallback(
    async (id: string) => {
      try {
        await window.playwrightFlowStudio.workflows.delete(id);
        setDeleteConfirmId(null);
        await load();
      } catch {
        setError("Failed to delete workflow.");
      }
    },
    [load]
  );

  const exportWorkflow = useCallback(async (id: string, name: string) => {
    try {
      const profile = await window.playwrightFlowStudio.workflows.export(id);
      const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `${id}.json`;
      link.click();
      URL.revokeObjectURL(href);
    } catch {
      setError(`Failed to export workflow "${name}".`);
    }
  }, []);

  const importWorkflow = useCallback(
    async (file: File) => {
      try {
        const profile = JSON.parse(await file.text()) as WorkflowProfile;
        await window.playwrightFlowStudio.workflows.import(profile);
        await load();
      } catch {
        setError("Failed to import workflow. Make sure the file is a valid workflow JSON.");
      }
    },
    [load]
  );

  const { paged, total, totalPages, page } = applyTable(workflows, table.state, workflowAdapter);

  return (
    <section className="page">
      <section className="work-panel">
        <div className="section-heading">
          <h1>Workflows</h1>
          <span>{loading ? "Loading…" : `${workflows.length} saved workflow${workflows.length !== 1 ? "s" : ""}`}</span>
        </div>

        <div className="library-toolbar">
          <button className="toolbar-button primary" id="wl-create-new" onClick={() => void createNew()} type="button">
            <Plus size={15} />
            Create Workflow
          </button>
          <button className="toolbar-button" id="wl-import" onClick={() => importInputRef.current?.click()} title="Import a workflow JSON file" type="button">
            <Upload size={15} />
            Import
          </button>
          <button className="toolbar-button" id="wl-refresh" onClick={() => void load()} title="Refresh list" type="button">
            <RefreshCw size={15} />
            Refresh
          </button>
          <input
            accept=".json,application/json"
            ref={importInputRef}
            style={{ display: "none" }}
            type="file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importWorkflow(file);
              e.target.value = "";
            }}
          />
        </div>

        {error ? (
          <div className="validation-list">
            <span>{error}</span>
          </div>
        ) : null}

        <AdvancedTableFilters
          searchText={table.state.searchText}
          onSearch={table.setSearch}
          fields={workflowFilterFields}
          applied={table.state.filters}
          onApply={table.applyFilters}
          onClear={table.clearAll}
          searchPlaceholder="Search workflows by name or ID…"
        />

        {loading ? (
          <div className="empty-state">
            <strong>Loading workflows…</strong>
          </div>
        ) : workflows.length === 0 ? (
          <TableEmptyState
            filtered={false}
            title="No workflows created yet."
            hint="Create your first workflow by linking saved flows."
            action={
              <button className="toolbar-button primary" id="wl-empty-create" onClick={() => void createNew()} type="button">
                <Plus size={14} />
                Create Workflow
              </button>
            }
          />
        ) : total === 0 ? (
          <TableEmptyState filtered title="No matching workflows found." hint="Adjust your search criteria." />
        ) : (
          <>
            <div className="wl-table-wrapper">
              <table className="wl-table">
                <colgroup>
                  <col style={{ width: "190px" }} />
                  <col style={{ minWidth: "140px" }} />
                  <col style={{ width: "70px" }} />
                  <col style={{ minWidth: "120px" }} />
                  <col style={{ width: "110px" }} />
                  <col style={{ width: "90px" }} />
                  <col style={{ width: "100px" }} />
                  <col style={{ width: "90px" }} />
                  <col style={{ width: "200px" }} />
                </colgroup>
                <thead>
                  <tr>
                    <SortableHeaderCell label="Name" columnKey="name" sortBy={table.state.sortBy} sortDirection={table.state.sortDirection} onSort={table.toggleSort} />
                    <th>Description</th>
                    <SortableHeaderCell label="Flows" columnKey="flows" sortBy={table.state.sortBy} sortDirection={table.state.sortDirection} onSort={table.toggleSort} align="center" />
                    <SortableHeaderCell label="Data Source" columnKey="dataSource" sortBy={table.state.sortBy} sortDirection={table.state.sortDirection} onSort={table.toggleSort} />
                    <SortableHeaderCell label="Mode" columnKey="mode" sortBy={table.state.sortBy} sortDirection={table.state.sortDirection} onSort={table.toggleSort} />
                    <SortableHeaderCell label="Max Parallel" columnKey="maxParallel" sortBy={table.state.sortBy} sortDirection={table.state.sortDirection} onSort={table.toggleSort} align="center" />
                    <SortableHeaderCell label="Updated" columnKey="updatedAt" sortBy={table.state.sortBy} sortDirection={table.state.sortDirection} onSort={table.toggleSort} />
                    <SortableHeaderCell label="Status" columnKey="status" sortBy={table.state.sortBy} sortDirection={table.state.sortDirection} onSort={table.toggleSort} />
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((workflow) => (
                    <tr key={workflow.id}>
                      <td className="wl-name-cell">
                        <button className="wl-name-link" title={`Open "${workflow.name}" in Workflow Builder`} type="button" onClick={() => void openInBuilder(workflow.id)}>
                          {workflow.name}
                        </button>
                        <small>{workflow.id}</small>
                      </td>
                      <td className="wl-desc-cell">{workflow.description ?? "—"}</td>
                      <td style={{ textAlign: "center" }}>{workflow.nodes?.length ?? 0}</td>
                      <td>{workflow.dataSource?.dataSourceId ?? <span style={{ color: "#9fafc4" }}>None</span>}</td>
                      <td>
                        <span className="state-pill" style={{ textTransform: "capitalize", background: "#eef5ff", color: "#0d5dc2" }}>
                          {workflow.execution?.mode ?? "sequential"}
                        </span>
                      </td>
                      <td style={{ textAlign: "center" }}>{workflow.execution?.maxConcurrentInstances ?? 1}</td>
                      <td className="wl-date-cell">{workflow.updatedAt ? new Date(workflow.updatedAt).toLocaleDateString() : "—"}</td>
                      <td>
                        <span className={`state-pill ${workflowAdapter.status(workflow) === "active" ? "pill-active" : "pill-inactive"}`}>
                          {workflowAdapter.status(workflow)}
                        </span>
                      </td>
                      <td>
                        <div className="table-actions" style={{ flexWrap: "wrap" }}>
                          <button title="Open in Workflow Builder" type="button" onClick={() => void openInBuilder(workflow.id)}>
                            <FolderOpen size={13} />
                          </button>
                          <button title="Clone this workflow" type="button" onClick={() => void cloneWorkflow(workflow.id)}>
                            <Copy size={13} />
                          </button>
                          <button title="Export as JSON" type="button" onClick={() => void exportWorkflow(workflow.id, workflow.name)}>
                            <Download size={13} />
                          </button>
                          {deleteConfirmId === workflow.id ? (
                            <>
                              <button
                                className="wl-delete-confirm"
                                style={{ background: "#fef2f2", borderColor: "#fca5a5", color: "#b91c1c" }}
                                title="Confirm delete"
                                type="button"
                                onClick={() => void deleteWorkflow(workflow.id)}
                              >
                                Confirm
                              </button>
                              <button title="Cancel" type="button" onClick={() => setDeleteConfirmId(null)}>
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button title="Delete this workflow" type="button" onClick={() => setDeleteConfirmId(workflow.id)}>
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <DataTablePagination page={page} totalPages={totalPages} total={total} pageSize={table.state.pageSize} onPage={table.setPage} onPageSize={table.setPageSize} />
          </>
        )}
      </section>
    </section>
  );
}
