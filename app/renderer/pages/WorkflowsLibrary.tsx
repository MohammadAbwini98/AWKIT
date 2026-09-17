import { CircleCheck, CircleDashed, Copy, Download, FolderOpen, LayoutGrid, MoreVertical, Network, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createBlankWorkflowProfile, type WorkflowProfile } from "@src/profiles/WorkflowProfile";
import { usePageChrome } from "../state/pageChrome";
import { useNavigation } from "../state/navigation";
import { usePermissions } from "../security/usePermissions";
import { Permission } from "@src/security/authz/Permissions";
import { PromptDialog } from "../components/shared/PromptDialog";
import { ConfirmDialog } from "../components/shared/ConfirmDialog";
import { NodeOptionsMenu, type NodeMenuItem } from "../components/shared/NodeOptionsMenu";
import { applyTable, useTableState, type RowAdapter } from "../components/table/tableState";
import { AdvancedTableFilters, DataTablePagination, SortableHeaderCell, TableEmptyState, type FilterFieldDef } from "../components/table/TableUI";
import {
  parseWorkflowConflictName,
  validateWorkflowProfile,
  WORKFLOW_IMPORT_ID_CONFLICT
} from "@src/profiles/workflowProfileValidation";

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
  mode: (w) => w.execution?.mode ?? "sequential"
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
  { key: "connectorsMax", label: "Max connectors", type: "number" }
];

export function WorkflowsLibrary() {
  const { navigateTo } = useNavigation();
  const { can } = usePermissions();
  const canCreate = can(Permission.WORKFLOW_CREATE);
  const canDelete = can(Permission.WORKFLOW_DELETE);
  const [workflows, setWorkflows] = useState<WorkflowProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // One dialog serves the single-row delete and the bulk delete: the confirmation names the exact
  // set it will remove, so a bulk action can never look like a single-row one.
  const [deleteTargetIds, setDeleteTargetIds] = useState<string[]>([]);
  const [namingWorkflow, setNamingWorkflow] = useState(false);
  const [importConflict, setImportConflict] = useState<{ profile: WorkflowProfile; existingName: string } | null>(null);
  // Point 5: a single "…" kebab per row opens a context menu of the row's actions.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  // Selection is held by id and always re-derived against the loaded list, so ids left over from a
  // deleted or re-imported workflow simply stop resolving instead of acting on the wrong row.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
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

  // Point 6: name the workflow in a modal, persist it, then open it in the Workflow Builder.
  const createWorkflow = useCallback(
    async (name: string) => {
      setNamingWorkflow(false);
      try {
        const profile = createBlankWorkflowProfile(name);
        await window.playwrightFlowStudio.workflows.create(profile);
        await window.playwrightFlowStudio.settings.update({ selectedBuilderWorkflowId: profile.id }).catch(() => undefined);
        navigateTo("scenarioBuilder");
      } catch {
        setError("Failed to create workflow.");
      }
    },
    [navigateTo]
  );

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

  /**
   * A bulk delete is N independent deletions, so one failure must not strand the other N-1.
   * Each id is caught on its own and the dialog, the selection, and the list are reconciled from
   * what actually succeeded — otherwise a failure at id 3 of 5 leaves two workflows gone from disk
   * while the table still lists all five and the open dialog invites a second Delete that re-issues
   * the two already-removed ids.
   */
  const deleteWorkflows = useCallback(
    async (ids: string[]) => {
      const deleted: string[] = [];
      const failed: string[] = [];
      for (const id of ids) {
        try {
          await window.playwrightFlowStudio.workflows.delete(id);
          deleted.push(id);
        } catch {
          failed.push(id);
        }
      }
      setDeleteTargetIds([]);
      setSelectedIds((prev) => prev.filter((id) => !deleted.includes(id)));
      // The reload must come FIRST. `load` clears the error synchronously, before its own first
      // await, so a message written above this line would be queued in the same batch and silently
      // overwritten — the failure would vanish instead of being reported. The only lossy case left
      // is a delete failure AND a reload failure together, where the delete message wins: it is the
      // more actionable of the two, and a list that did not refresh is visible on its own.
      await load();
      if (failed.length > 0) {
        setError(
          failed.length === ids.length
            ? ids.length > 1
              ? "Failed to delete the selected workflows."
              : "Failed to delete workflow."
            : `Deleted ${deleted.length} of ${ids.length} workflows. ${failed.length} could not be deleted.`
        );
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

  const persistImportedWorkflow = useCallback(
    async (profile: WorkflowProfile, allowOverwrite = false, precheckedName?: string) => {
      try {
        await window.playwrightFlowStudio.workflows.import(
          profile,
          allowOverwrite ? { allowOverwrite: true } : undefined
        );
        setImportConflict(null);
        setError("");
        await load();
      } catch (importError) {
        const message = importError instanceof Error ? importError.message : String(importError);
        if (!allowOverwrite && message.includes(WORKFLOW_IMPORT_ID_CONFLICT)) {
          setImportConflict({
            profile,
            existingName: parseWorkflowConflictName(message) ?? precheckedName ?? "the saved workflow"
          });
          return;
        }
        setError(`Failed to import workflow. ${message}`.trim());
      }
    },
    [load]
  );

  const importWorkflow = useCallback(
    async (file: File) => {
      let candidate: unknown;
      try {
        candidate = JSON.parse(await file.text());
      } catch {
        setError("Failed to import workflow: the selected file is not valid JSON.");
        return;
      }

      const validation = validateWorkflowProfile(candidate);
      if (!validation.ok) {
        setError(`Failed to import workflow: ${validation.errors.join(" ")}`);
        return;
      }

      try {
        const existing = await window.playwrightFlowStudio.workflows.get(validation.profile.id);
        await persistImportedWorkflow(validation.profile, false, existing?.name);
      } catch (importError) {
        const message = importError instanceof Error ? importError.message : String(importError);
        setError(`Failed to import workflow. ${message}`.trim());
      }
    },
    [persistImportedWorkflow]
  );

  const { paged, total, totalPages, page } = applyTable(workflows, table.state, workflowAdapter);

  // The primary and secondary page actions live in the top header, matching every other
  // system-UI page — they are not duplicated in a page-local toolbar.
  usePageChrome(
    {
      actions: [
        {
          id: "new",
          label: "New Workflow",
          variant: "primary",
          disabled: !canCreate,
          title: canCreate ? "Create a new workflow" : "Requires the Create Workflows permission",
          onClick: () => setNamingWorkflow(true)
        },
        {
          id: "import",
          label: "Import",
          icon: <Upload size={15} aria-hidden="true" />,
          disabled: !canCreate,
          title: canCreate ? "Import a workflow JSON file" : "Requires the Create Workflows permission",
          onClick: () => importInputRef.current?.click()
        },
        {
          id: "refresh",
          label: "Refresh",
          title: "Reload the saved workflow list",
          onClick: () => void load()
        }
      ],
      dirty: false
    },
    [canCreate, load]
  );

  const selectedWorkflows = useMemo(
    () => workflows.filter((workflow) => selectedIds.includes(workflow.id)),
    [workflows, selectedIds]
  );
  const pageIds = paged.map((workflow) => workflow.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));

  const togglePageSelection = () =>
    setSelectedIds((prev) =>
      allPageSelected ? prev.filter((id) => !pageIds.includes(id)) : [...new Set([...prev, ...pageIds])]
    );

  const toggleRowSelection = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id]));

  const exportSelected = async () => {
    for (const workflow of selectedWorkflows) {
      await exportWorkflow(workflow.id, workflow.name);
    }
  };

  const duplicateSelected = async () => {
    for (const workflow of selectedWorkflows) {
      await cloneWorkflow(workflow.id);
    }
    setSelectedIds([]);
  };

  const menuWorkflow = menuFor ? workflows.find((w) => w.id === menuFor) ?? null : null;
  const deleteTargets = workflows.filter((workflow) => deleteTargetIds.includes(workflow.id));
  const workflowMenuItems: NodeMenuItem[] = menuWorkflow
    ? [
        { id: "open", label: "Open in Builder", icon: FolderOpen, onSelect: () => void openInBuilder(menuWorkflow.id) },
        { id: "clone", label: "Clone", icon: Copy, disabled: !canCreate, title: canCreate ? undefined : "Requires the Create Workflows permission", onSelect: () => void cloneWorkflow(menuWorkflow.id) },
        { id: "export", label: "Export JSON", icon: Download, onSelect: () => void exportWorkflow(menuWorkflow.id, menuWorkflow.name) },
        { id: "delete", label: "Delete", icon: Trash2, tone: "danger", disabled: !canDelete, title: canDelete ? undefined : "Requires the Delete Workflows permission", onSelect: () => setDeleteTargetIds([menuWorkflow.id]) }
      ]
    : [];

  return (
    <section className="page">
      <section className="work-panel" data-testid="workflows-library-surface">
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

        {error ? (
          <div className="settings-banner error" role="alert" aria-live="assertive">
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
          searchPlaceholder="Search workflows by name, flow or tag…"
          collapsible
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
              <button className="toolbar-button primary" id="wl-empty-create" onClick={() => setNamingWorkflow(true)} disabled={!canCreate} title={canCreate ? undefined : "Requires the Create Workflows permission"} type="button">
                Create Workflow
              </button>
            }
          />
        ) : (
          <div className="table-surface">
            <div className="table-surface-head">
              <h2>Saved workflows</h2>
              <span className="table-surface-count">
                {selectedIds.length > 0
                  ? `${selectedWorkflows.length} selected`
                  : `${total} workflow${total !== 1 ? "s" : ""}`}
              </span>
              <div className="table-surface-actions">
                <button className="toolbar-button" disabled={selectedWorkflows.length === 0} onClick={() => void exportSelected()} title="Export every selected workflow as JSON" type="button">
                  <Download size={14} />
                  Export selected
                </button>
                <button className="toolbar-button" disabled={selectedWorkflows.length === 0 || !canCreate} onClick={() => void duplicateSelected()} title={canCreate ? "Clone every selected workflow" : "Requires the Create Workflows permission"} type="button">
                  <Copy size={14} />
                  Duplicate
                </button>
                <button className="toolbar-button danger" disabled={selectedWorkflows.length === 0 || !canDelete} onClick={() => setDeleteTargetIds(selectedWorkflows.map((workflow) => workflow.id))} title={canDelete ? "Delete every selected workflow" : "Requires the Delete Workflows permission"} type="button">
                  <Trash2 size={14} />
                  Delete
                </button>
              </div>
            </div>

            {total === 0 ? (
              <TableEmptyState filtered title="No matching workflows found." hint="Adjust your search criteria." />
            ) : (
              <>
                <div className="wl-table-wrapper">
                  <table className="wl-table wl-table-workflows">
                    <colgroup>
                      <col className="wl-col-select" />
                      <col className="wl-col-name" />
                      <col className="wl-col-status" />
                      <col className="wl-col-flows" />
                      <col className="wl-col-data" />
                      <col className="wl-col-mode" />
                      <col className="wl-col-updated" />
                      <col className="wl-col-actions" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th className="wl-select-cell">
                          <input
                            type="checkbox"
                            aria-label={allPageSelected ? "Clear selection on this page" : "Select every workflow on this page"}
                            checked={allPageSelected}
                            onChange={togglePageSelection}
                          />
                        </th>
                        <SortableHeaderCell label="Workflow" columnKey="name" sortBy={table.state.sortBy} sortDirection={table.state.sortDirection} onSort={table.toggleSort} />
                        <SortableHeaderCell label="Status" columnKey="status" sortBy={table.state.sortBy} sortDirection={table.state.sortDirection} onSort={table.toggleSort} />
                        <SortableHeaderCell label="Flows" columnKey="flows" sortBy={table.state.sortBy} sortDirection={table.state.sortDirection} onSort={table.toggleSort} align="center" />
                        <SortableHeaderCell label="Data source" columnKey="dataSource" sortBy={table.state.sortBy} sortDirection={table.state.sortDirection} onSort={table.toggleSort} />
                        <SortableHeaderCell label="Mode" columnKey="mode" sortBy={table.state.sortBy} sortDirection={table.state.sortDirection} onSort={table.toggleSort} />
                        <SortableHeaderCell label="Updated" columnKey="updatedAt" sortBy={table.state.sortBy} sortDirection={table.state.sortDirection} onSort={table.toggleSort} />
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {paged.map((workflow) => {
                        const active = workflowAdapter.status(workflow) === "active";
                        const selected = selectedIds.includes(workflow.id);
                        return (
                          <tr key={workflow.id} className={selected ? "is-selected" : undefined}>
                            <td className="wl-select-cell">
                              <input
                                type="checkbox"
                                aria-label={`Select ${workflow.name}`}
                                checked={selected}
                                onChange={() => toggleRowSelection(workflow.id)}
                              />
                            </td>
                            <td className="wl-name-cell">
                              <span className="wl-main-cell">
                                <span className="wl-main-icon" aria-hidden="true">
                                  <LayoutGrid size={15} />
                                </span>
                                <span className="wl-main-text">
                                  <button className="wl-name-link" title={workflow.name} type="button" onClick={() => void openInBuilder(workflow.id)}>
                                    {workflow.name}
                                  </button>
                                  <small title={workflow.description ?? undefined}>{workflow.description ?? "No description"}</small>
                                </span>
                              </span>
                            </td>
                            <td>
                              <span className={`state-pill ${active ? "pill-active" : "pill-inactive"}`}>
                                <span aria-hidden="true" className="wl-pill-glyph">
                                  {active ? <CircleCheck size={11} strokeWidth={2.4} /> : <CircleDashed size={11} strokeWidth={2.4} />}
                                </span>
                                {workflowAdapter.status(workflow)}
                              </span>
                            </td>
                            <td className="wl-num-cell">
                              <span className="wl-flow-count">
                                <Network size={14} aria-hidden="true" />
                                {workflow.nodes?.length ?? 0}
                              </span>
                            </td>
                            <td className="wl-mono-cell" title={workflow.dataSource?.dataSourceId ?? "None"}>
                              {workflow.dataSource?.dataSourceId ?? <span className="wl-cell-muted">None</span>}
                            </td>
                            <td>
                              <span className="state-pill pill-mode">{workflow.execution?.mode ?? "sequential"}</span>
                            </td>
                            <td className="wl-date-cell">{workflow.updatedAt ? new Date(workflow.updatedAt).toLocaleDateString() : "—"}</td>
                            <td>
                              <div className="table-actions wl-row-actions">
                                <button
                                  className="icon-button"
                                  title="Open in Workflow Builder"
                                  aria-label={`Open ${workflow.name} in Workflow Builder`}
                                  type="button"
                                  onClick={() => void openInBuilder(workflow.id)}
                                >
                                  <FolderOpen size={15} />
                                </button>
                                <button
                                  className="icon-button wl-kebab"
                                  title="Workflow actions"
                                  aria-label={`${workflow.name} actions`}
                                  type="button"
                                  aria-haspopup="menu"
                                  aria-expanded={menuFor === workflow.id}
                                  onClick={(event) => {
                                    setMenuAnchor(event.currentTarget);
                                    setMenuFor(workflow.id);
                                  }}
                                >
                                  <MoreVertical size={16} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <DataTablePagination page={page} totalPages={totalPages} total={total} pageSize={table.state.pageSize} onPage={table.setPage} onPageSize={table.setPageSize} />
              </>
            )}
          </div>
        )}
      </section>

      <NodeOptionsMenu open={Boolean(menuFor)} anchor={menuAnchor} items={workflowMenuItems} onClose={() => setMenuFor(null)} />

      {namingWorkflow ? (
        <PromptDialog
          title="New Workflow"
          message="Name your workflow. It opens in the Workflow Builder with a Start and End ready to link flows."
          label="Workflow name"
          placeholder="e.g. Customer onboarding"
          initialValue="New Workflow"
          confirmLabel="Create Workflow"
          onConfirm={(name) => void createWorkflow(name)}
          onCancel={() => setNamingWorkflow(false)}
        />
      ) : null}

      {deleteTargets.length > 0 ? (
        <ConfirmDialog
          title={deleteTargets.length > 1 ? `Delete ${deleteTargets.length} workflows?` : "Delete workflow?"}
          message={
            deleteTargets.length > 1
              ? `Permanently delete ${deleteTargets.map((workflow) => `"${workflow.name}"`).join(", ")}? This cannot be undone.`
              : `Permanently delete "${deleteTargets[0].name}"? This cannot be undone.`
          }
          confirmLabel="Delete"
          danger
          onConfirm={() => void deleteWorkflows(deleteTargets.map((workflow) => workflow.id))}
          onCancel={() => setDeleteTargetIds([])}
        />
      ) : null}

      {importConflict ? (
        <ConfirmDialog
          title="Replace existing workflow?"
          message={`A workflow named "${importConflict.existingName}" already uses ID "${importConflict.profile.id}". Importing "${importConflict.profile.name}" will permanently replace the saved workflow. Continue?`}
          confirmLabel="Replace workflow"
          danger
          onConfirm={() => void persistImportedWorkflow(importConflict.profile, true, importConflict.existingName)}
          onCancel={() => setImportConflict(null)}
        />
      ) : null}
    </section>
  );
}
