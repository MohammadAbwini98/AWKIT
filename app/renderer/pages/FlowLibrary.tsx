import { Copy, Download, FilePlus2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { usePageChrome } from "../state/pageChrome";
import { useNavigation } from "../state/navigation";
import { usePermissions } from "../security/usePermissions";
import { Permission } from "@src/security/authz/Permissions";
import { PromptDialog } from "../components/shared/PromptDialog";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import { applyTable, useTableState, type RowAdapter } from "../components/table/tableState";
import { AdvancedTableFilters, DataTablePagination, SortableHeaderCell, TableEmptyState, type FilterFieldDef } from "../components/table/TableUI";

const flowAdapter: RowAdapter<FlowProfile> = {
  id: (f) => f.id,
  name: (f) => f.name,
  // A flow is "active" once it has actionable nodes beyond the Start/End scaffold.
  status: (f) => ((f.nodes?.length ?? 0) > 2 ? "active" : "inactive"),
  version: (f) => f.version,
  nodes: (f) => f.nodes?.length ?? 0,
  connectors: (f) => f.edges?.length ?? 0,
  createdAt: (f) => f.createdAt,
  updatedAt: (f) => f.updatedAt
};

const flowFilterFields: FilterFieldDef[] = [
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
  { key: "version", label: "Version", type: "number" },
  { key: "createdFrom", label: "Created from", type: "date" },
  { key: "createdTo", label: "Created to", type: "date" },
  { key: "updatedFrom", label: "Updated from", type: "date" },
  { key: "updatedTo", label: "Updated to", type: "date" },
  { key: "nodesMin", label: "Min nodes", type: "number" },
  { key: "nodesMax", label: "Max nodes", type: "number" },
  { key: "connectorsMin", label: "Min connectors", type: "number" },
  { key: "connectorsMax", label: "Max connectors", type: "number" }
];

export function FlowLibrary() {
  const { navigateTo } = useNavigation();
  const { can } = usePermissions();
  const canCreate = can(Permission.WORKFLOW_CREATE);
  const canDelete = can(Permission.WORKFLOW_DELETE);
  const [flows, setFlows] = useState<FlowProfile[]>([]);
  const [status, setStatus] = useState("Loading saved flows");
  const [namingFlow, setNamingFlow] = useState(false);
  const table = useTableState("flows");

  // Open a flow in the Flow Designer (persist the selection so the designer loads it).
  const openFlow = async (flow: FlowProfile) => {
    await window.playwrightFlowStudio.settings.update({ selections: { lastSelectedFlowId: flow.id } }).catch(() => undefined);
    navigateTo("flowChart");
  };

  useEffect(() => {
    refreshFlows();
  }, []);

  usePageChrome(
    {
      actions: [
        {
          id: "new",
          label: "New Flow",
          variant: "primary",
          onClick: () => setNamingFlow(true),
          title: canCreate ? "Create a new flow" : "Requires the Create Flows permission",
          disabled: !canCreate
        }
      ],
      dirty: false
    },
    [canCreate]
  );

  const refreshFlows = () => {
    window.playwrightFlowStudio.flows
      .list()
      .then((profiles) => {
        setFlows(profiles);
        setStatus(`${profiles.length} saved flow${profiles.length === 1 ? "" : "s"}`);
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : "Unable to load flows"));
  };

  // Create a start/end-only flow with the chosen name, then open it in the Flow Designer.
  const createFlow = async (name: string) => {
    const id = `flow-${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    const profile = await window.playwrightFlowStudio.flows.create({
      id,
      name,
      description: "New reusable Playwright automation flow.",
      version: 1,
      createdAt: now,
      updatedAt: now,
      nodes: [
        { id: "start", type: "start", name: "Start", position: { x: 250, y: 80 }, next: "end" },
        { id: "end", type: "end", name: "End", position: { x: 250, y: 220 } }
      ],
      edges: [{ id: "edge-start-end", source: "start", target: "end", type: "always" }]
    });
    setNamingFlow(false);
    await openFlow(profile);
  };

  const cloneFlow = async (flow: FlowProfile) => {
    await window.playwrightFlowStudio.flows.clone(flow.id, `${flow.id}-copy-${Date.now().toString(36)}`);
    refreshFlows();
  };

  const deleteFlow = async (flow: FlowProfile) => {
    await window.playwrightFlowStudio.flows.delete(flow.id);
    refreshFlows();
  };

  const exportFlow = async (flow: FlowProfile) => {
    const profile = await window.playwrightFlowStudio.flows.export(flow.id);
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `${profile.id}.json`;
    link.click();
    URL.revokeObjectURL(href);
  };

  const { paged, total, totalPages, page } = applyTable(flows, table.state, flowAdapter);

  return (
    <section className="page">
      <section className="work-panel">
        <div className="section-heading">
          <h1>Flows</h1>
          <span>{status}</span>
        </div>

        <div className="library-toolbar">
          <button
            className="toolbar-button primary"
            onClick={() => setNamingFlow(true)}
            disabled={!canCreate}
            title={canCreate ? undefined : "Requires the Create Flows permission"}
            type="button"
          >
            <FilePlus2 size={15} />
            New Flow
          </button>
          <button className="toolbar-button" disabled title="Import from disk will use the import channel after file picker support is added." type="button">
            Import Flow
          </button>
        </div>

        <AdvancedTableFilters
          searchText={table.state.searchText}
          onSearch={table.setSearch}
          fields={flowFilterFields}
          applied={table.state.filters}
          onApply={table.applyFilters}
          onClear={table.clearAll}
          searchPlaceholder="Search flows by name or ID…"
        />

        {flows.length === 0 ? (
          <TableEmptyState
            filtered={false}
            title="No flows created yet."
            hint="Create your first flow using the Flow Designer or Recorder."
            action={
              <button
                className="toolbar-button primary"
                onClick={() => setNamingFlow(true)}
                disabled={!canCreate}
                title={canCreate ? undefined : "Requires the Create Flows permission"}
                type="button"
              >
                <FilePlus2 size={15} />
                Create Flow
              </button>
            }
          />
        ) : total === 0 ? (
          <TableEmptyState filtered title="No matching flows found." hint="Adjust your search criteria." />
        ) : (
          <>
            <div className="wl-table-wrapper">
              <table className="wl-table">
                <colgroup>
                  <col style={{ width: "26%" }} />
                  <col style={{ width: "20%" }} />
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "11%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "15%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <SortableHeaderCell label="Name" columnKey="name" sortBy={table.state.sortBy} sortDirection={table.state.sortDirection} onSort={table.toggleSort} />
                    <SortableHeaderCell label="ID" columnKey="id" sortBy={table.state.sortBy} sortDirection={table.state.sortDirection} onSort={table.toggleSort} />
                    <SortableHeaderCell label="Version" columnKey="version" sortBy={table.state.sortBy} sortDirection={table.state.sortDirection} onSort={table.toggleSort} align="center" />
                    <SortableHeaderCell label="Nodes" columnKey="nodes" sortBy={table.state.sortBy} sortDirection={table.state.sortDirection} onSort={table.toggleSort} align="center" />
                    <SortableHeaderCell label="Connectors" columnKey="connectors" sortBy={table.state.sortBy} sortDirection={table.state.sortDirection} onSort={table.toggleSort} align="center" />
                    <SortableHeaderCell label="Status" columnKey="status" sortBy={table.state.sortBy} sortDirection={table.state.sortDirection} onSort={table.toggleSort} />
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((flow) => (
                    <tr
                      key={flow.id}
                      className="wl-row-clickable"
                      role="button"
                      tabIndex={0}
                      title="Open this flow in the Flow Designer"
                      onClick={() => void openFlow(flow)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          void openFlow(flow);
                        }
                      }}
                    >
                      <td>{flow.name}</td>
                      <td>{flow.id}</td>
                      <td style={{ textAlign: "center" }}>{flow.version}</td>
                      <td style={{ textAlign: "center" }}>{flow.nodes.length}</td>
                      <td style={{ textAlign: "center" }}>{flow.edges.length}</td>
                      <td>
                        <span className={`state-pill ${flowAdapter.status(flow) === "active" ? "pill-active" : "pill-inactive"}`}>
                          {flowAdapter.status(flow)}
                        </span>
                      </td>
                      <td>
                        <div className="table-actions" onClick={(event) => event.stopPropagation()}>
                          <button onClick={() => cloneFlow(flow)} disabled={!canCreate} title={canCreate ? "Clone flow" : "Requires the Create Flows permission"} type="button">
                            <Copy size={14} />
                          </button>
                          <button onClick={() => exportFlow(flow)} title="Export flow JSON" type="button">
                            <Download size={14} />
                          </button>
                          <button onClick={() => deleteFlow(flow)} disabled={!canDelete} title={canDelete ? "Delete flow" : "Requires the Delete Flows permission"} type="button">
                            <Trash2 size={14} />
                          </button>
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

      {namingFlow ? (
        <PromptDialog
          title="New Flow"
          message="Name your flow. It opens in the Flow Designer with a Start and End step ready to build on."
          label="Flow name"
          placeholder="e.g. Login and export report"
          initialValue="New Flow"
          confirmLabel="Create Flow"
          onConfirm={(name) => void createFlow(name)}
          onCancel={() => setNamingFlow(false)}
        />
      ) : null}
    </section>
  );
}
