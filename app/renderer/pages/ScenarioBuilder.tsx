import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
  useEdgesState,
  useNodesState,
  useReactFlow
} from "@xyflow/react";
import { CanvasZoomControl } from "../components/workflow/CanvasZoomControl";
import {
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  FilePlus,
  FolderOpen,
  GripVertical,
  PanelRightClose,
  PanelRightOpen,
  Save,
  Search,
  ShieldCheck,
  Trash2
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScenarioFlowNode } from "../components/scenario/ScenarioFlowNode";
import { Toast, type ToastState } from "../components/shared/Toast";
import {
  branchSourceHandle,
  buildConnectorVisual,
  computePortFlags,
  connectorPortKindFromHandle,
  hasCustomStyle,
  MAX_BRANCH_CONNECTORS,
  portHandlesForKind,
  reconcileBranchConnectors
} from "../components/shared/connectorStyle";
import { SelfLoopEdge } from "../components/shared/SelfLoopEdge";
import { ConnectorStyleEditor } from "../components/shared/ConnectorStyleEditor";
import { usePageChrome } from "../state/pageChrome";
import { useNavigation } from "../state/navigation";
import {
  SCENARIO_NODE_DEFAULT_HEIGHT,
  SCENARIO_NODE_DEFAULT_WIDTH,
  type ScenarioFlowNodeData,
  type ScenarioLinkData
} from "../components/scenario/scenarioDesignerTypes";
import { ScenarioOrchestrator } from "@src/orchestrator/ScenarioOrchestrator";
import type { JsonArrayDataSourceProfile } from "@src/data/DataSourceProfile";
import { connectorKind, type ConnectorKind, type EdgeVisualStyle, type FlowProfile } from "@src/profiles/FlowProfile";
import type { ScenarioFlowReference, ScenarioLink, ScenarioProfile } from "@src/profiles/ScenarioProfile";
import type { WorkflowDataSourceBinding, WorkflowProfile } from "@src/profiles/WorkflowProfile";
import { workflowToScenarioProfile } from "@src/profiles/WorkflowProfile";

type ScenarioNode = Node<ScenarioFlowNodeData, "scenarioFlow">;
type ScenarioEdge = Edge<ScenarioLinkData>;

const nodeTypes = {
  scenarioFlow: ScenarioFlowNode
} satisfies NodeTypes;

const edgeTypes = {
  circular: SelfLoopEdge
} satisfies EdgeTypes;

/** Derive the structured connector kind from a workflow link's legacy `type` (no separate `kind` field yet). */
function scenarioEdgeKind(type: ScenarioLink["type"] | undefined): ConnectorKind {
  return connectorKind({ type: type ?? "success" });
}

/** Fallback library used when no saved flows are found. */
const fallbackFlowLibrary = [
  {
    flowId: "login-flow",
    name: "Login Flow",
    description: "Authenticate user session",
    outputs: ["sessionReady"],
    inputs: []
  },
  {
    flowId: "open-customer-page-flow",
    name: "Open Customer Page",
    description: "Navigate to customer workspace",
    outputs: ["customerPageLoaded"],
    inputs: ["sessionReady"]
  },
  {
    flowId: "create-customer-flow",
    name: "Create Customer Flow",
    description: "Create a customer from current row",
    outputs: ["customerId"],
    inputs: ["currentRow"]
  },
  {
    flowId: "validate-customer-flow",
    name: "Validate Customer Flow",
    description: "Confirm customer creation",
    outputs: ["validationResult"],
    inputs: ["customerId"]
  },
  {
    flowId: "logout-flow",
    name: "Logout Flow",
    description: "End browser session",
    outputs: [],
    inputs: ["sessionReady"]
  }
];

/** Generate a fresh unique workflow ID. */
function generateWorkflowId(): string {
  return `workflow-${Date.now().toString(36)}`;
}

/**
 * Order-independent serialization of the saveable workflow document, used to
 * detect real unsaved changes (vs selection/zoom/panel UI state).
 */
function serializeWorkflowDoc(profile: WorkflowProfile): string {
  return JSON.stringify({
    name: profile.name,
    execution: profile.execution,
    dataSource: profile.dataSource ?? null,
    nodes: [...profile.nodes].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...profile.edges].sort((a, b) => a.id.localeCompare(b.id))
  });
}

// ── Workflow Definition panel width constraints (persisted) ──────────────────
// Persisted key: ui.workflowBuilder.leftPanelWidth
const WORKFLOW_DEF_MIN_WIDTH = 260;
const WORKFLOW_DEF_DEFAULT_WIDTH = 360;
const WORKFLOW_DEF_MAX_WIDTH = 560;

// Saved Flows list: show this many initially, then reveal more via "Load More" (Task 04).
const SAVED_FLOWS_PAGE_SIZE = 10;

/** Clamp a candidate width into the safe Workflow Definition range. */
function clampWorkflowDefWidth(width: number): number {
  return Math.min(WORKFLOW_DEF_MAX_WIDTH, Math.max(WORKFLOW_DEF_MIN_WIDTH, Math.round(width)));
}

function ScenarioBuilderContent() {
  const [nodes, setNodes, onNodesChange] = useNodesState<ScenarioNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<ScenarioEdge>([]);
  const [flowLibrary, setFlowLibrary] = useState<typeof fallbackFlowLibrary>([]);
  const [workflows, setWorkflows] = useState<WorkflowProfile[]>([]);
  const [workflowId, setWorkflowId] = useState(() => generateWorkflowId());
  const [workflowName, setWorkflowName] = useState("New Workflow");
  const [executionMode, setExecutionMode] = useState<ScenarioProfile["executionMode"]>("sequential");
  const [maxParallelFlows, setMaxParallelFlows] = useState(1);
  const [dataSources, setDataSources] = useState<JsonArrayDataSourceProfile[]>([]);
  const [workflowDataSourceId, setWorkflowDataSourceId] = useState("");
  const [workflowRootArrayPath, setWorkflowRootArrayPath] = useState("$.customers");
  const [dataSourceRecordCount, setDataSourceRecordCount] = useState<number | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [draggedFlowId, setDraggedFlowId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState("New — unsaved");
  const [failurePolicy, setFailurePolicy] = useState({
    stopOnRequiredFlowFailure: true,
    continueOnOptionalFlowFailure: true,
    takeScreenshotOnFailure: true
  });

  // ── Phase 01: Collapsible right panel (Selected Connector) ─────────────────
  // ── Phase 03: Collapsible left data source section ─────────────────────────
  // Both states loaded from persisted settings on mount.
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [dataSourceCollapsed, setDataSourceCollapsed] = useState(false);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(WORKFLOW_DEF_DEFAULT_WIDTH);

  // Track whether we have done the initial load to avoid re-loading on re-render
  const initialLoadDone = useRef(false);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const pendingSnapshot = useRef(true);
  const reactFlow = useReactFlow();
  const navigation = useNavigation();

  // Task 07: save success/failure toast
  const [toast, setToast] = useState<ToastState | null>(null);
  // Task 03/04: Saved Flows search + incremental "Load More"
  const [flowSearch, setFlowSearch] = useState("");
  const [flowVisibleCount, setFlowVisibleCount] = useState(SAVED_FLOWS_PAGE_SIZE);

  const persistBuilderZoom = useCallback((percent: number) => {
    window.playwrightFlowStudio.settings.update({ workflowBuilderZoomPercent: percent }).catch(() => undefined);
  }, []);

  const workflowDataSource = useMemo<WorkflowDataSourceBinding | undefined>(
    () => (workflowDataSourceId ? { dataSourceId: workflowDataSourceId, rootArrayPath: workflowRootArrayPath } : undefined),
    [workflowDataSourceId, workflowRootArrayPath]
  );

  const workflowProfile = useMemo(
    () => toWorkflowProfile(nodes, edges, workflowId, workflowName, executionMode, maxParallelFlows, failurePolicy, workflowDataSource),
    [edges, executionMode, failurePolicy, maxParallelFlows, nodes, workflowDataSource, workflowId, workflowName]
  );
  // Dirty only when the saveable workflow document differs from the saved/loaded snapshot.
  const docSnapshot = useMemo(() => serializeWorkflowDoc(workflowProfile), [workflowProfile]);
  useEffect(() => {
    if (pendingSnapshot.current) {
      pendingSnapshot.current = false;
      setSavedSnapshot(docSnapshot);
    }
  }, [docSnapshot]);

  const scenarioProfile = useMemo(() => workflowToScenarioProfile(workflowProfile), [workflowProfile]);
  const executionPlan = useMemo(() => new ScenarioOrchestrator().createExecutionPlan(scenarioProfile), [scenarioProfile]);
  const selectedEdge = useMemo(() => edges.find((edge) => edge.id === selectedEdgeId) ?? null, [edges, selectedEdgeId]);
  const orderedNodes = useMemo(() => [...nodes].sort((a, b) => a.data.order - b.data.order), [nodes]);

  // Points 2–4: connector-structure issues (blocks Save until fixed).
  const connectorIssues = useMemo(
    () => scenarioConnectorStructureIssues(edges, (id) => nodes.find((node) => node.id === id)?.data.name ?? id),
    [edges, nodes]
  );
  // Point 1: extra ports render only on nodes actually touched by a conditional/parallel connector.
  const portFlagsByNode = useMemo(
    () => computePortFlags(edges.map((edge) => ({ source: edge.source, target: edge.target, kind: scenarioEdgeKind(edge.data?.linkType) }))),
    [edges]
  );
  const nodesForCanvas = useMemo(
    () => nodes.map((node) => ({ ...node, data: { ...node.data, portFlags: portFlagsByNode.get(node.id) } })),
    [nodes, portFlagsByNode]
  );
  // Point 3: a node with a self-loop connector forces any other outgoing connector to Conditional.
  const loopControlledSources = useMemo(() => {
    const set = new Set<string>();
    edges.forEach((edge) => {
      if (edge.source === edge.target && scenarioEdgeKind(edge.data?.linkType) === "loop") set.add(edge.source);
    });
    return set;
  }, [edges]);
  const selectedEdgeIsSelf = Boolean(selectedEdge && selectedEdge.source === selectedEdge.target);
  const selectedEdgeKind = selectedEdge ? scenarioEdgeKind(selectedEdge.data?.linkType) : "normal";
  const selectedEdgeIsBranch = selectedEdgeKind === "conditional" || selectedEdgeKind === "parallel";
  // Rule 3/4: a conditional/parallel connector's type is locked (part of a pair) until removed.
  // Rule 1: loop is button-managed. Also keep the loop-controlled-source lock.
  const selectedEdgeKindLocked = Boolean(
    selectedEdge && (selectedEdgeIsBranch || selectedEdgeKind === "loop" || loopControlledSources.has(selectedEdge.source))
  );
  const availableFlows = flowLibrary.filter((flow) => !nodes.some((node) => node.data.flowId === flow.flowId));
  // Task 03: case-insensitive search by flow name. Task 04: cap to flowVisibleCount.
  const filteredFlows = useMemo(() => {
    const query = flowSearch.trim().toLowerCase();
    if (!query) return availableFlows;
    return availableFlows.filter((flow) => flow.name.toLowerCase().includes(query));
  }, [availableFlows, flowSearch]);
  const visibleFlows = filteredFlows.slice(0, flowVisibleCount);
  const selectedDataSourceName = dataSources.find((ds) => ds.id === workflowDataSourceId)?.name ?? null;

  // ── Load on mount ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;

    void (async () => {
      try {
        const [savedFlows, savedWorkflows, savedDataSources, settings] = await Promise.all([
          window.playwrightFlowStudio.flows.list(),
          window.playwrightFlowStudio.workflows.list(),
          window.playwrightFlowStudio.dataSources.list(),
          window.playwrightFlowStudio.settings.get()
        ]);

        const library = toFlowLibraryItems(savedFlows);
        setFlowLibrary(library);
        setWorkflows(savedWorkflows);
        setDataSources(savedDataSources);

        // Restore persisted panel states (Phase 01 + Phase 03)
        setRightPanelCollapsed(settings.workflowBuilder?.selectedConnectorCollapsed ?? false);
        setDataSourceCollapsed(settings.workflowBuilder?.workflowDataSourceCollapsed ?? false);
        setLeftPanelCollapsed(settings.workflowBuilder?.leftPanelCollapsed ?? false);
        setLeftPanelWidth(clampWorkflowDefWidth(settings.workflowBuilder?.leftPanelWidth ?? WORKFLOW_DEF_DEFAULT_WIDTH));
        const zoomPercent = settings.workflowBuilderZoomPercent > 0 ? settings.workflowBuilderZoomPercent : settings.designerDefaults.defaultZoomPercent;
        reactFlow.zoomTo(zoomPercent / 100);

        // Task 4: restore the last opened Workflow Builder workflow. If that saved reference is
        // stale (the workflow was deleted), clear it so we don't keep pointing at a missing
        // workflow, then fall back to the empty "New" state (current app behavior).
        const targetId = settings.selectedBuilderWorkflowId;
        if (targetId && !savedWorkflows.some((w) => w.id === targetId)) {
          window.playwrightFlowStudio.settings
            .update({ selectedBuilderWorkflowId: "", selections: { lastSelectedWorkflowId: null } })
            .catch(() => undefined);
        }
        const targetWorkflow =
          savedWorkflows.find((w) => w.id === targetId) ??
          (targetId ? null : savedWorkflows[0] ?? null);

        if (targetWorkflow) {
          loadWorkflowProfile(targetWorkflow, library);
        } else {
          setSaveState("New — unsaved");
        }
      } catch {
        setSaveState("Unable to load saved profiles");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist panel collapse states when they change (Phase 01 + Phase 03)
  const persistRightPanel = useCallback((collapsed: boolean) => {
    setRightPanelCollapsed(collapsed);
    window.playwrightFlowStudio.settings
      .update({ workflowBuilder: { selectedConnectorCollapsed: collapsed, workflowDataSourceCollapsed: dataSourceCollapsed, leftPanelCollapsed, leftPanelWidth } })
      .catch(() => undefined);
  }, [dataSourceCollapsed, leftPanelCollapsed, leftPanelWidth]);

  const persistDataSource = useCallback((collapsed: boolean) => {
    setDataSourceCollapsed(collapsed);
    window.playwrightFlowStudio.settings
      .update({ workflowBuilder: { selectedConnectorCollapsed: rightPanelCollapsed, workflowDataSourceCollapsed: collapsed, leftPanelCollapsed, leftPanelWidth } })
      .catch(() => undefined);
  }, [rightPanelCollapsed, leftPanelCollapsed, leftPanelWidth]);

  const persistLeftPanel = useCallback((collapsed: boolean, width: number) => {
    setLeftPanelCollapsed(collapsed);
    setLeftPanelWidth(width);
    window.playwrightFlowStudio.settings
      .update({ workflowBuilder: { selectedConnectorCollapsed: rightPanelCollapsed, workflowDataSourceCollapsed: dataSourceCollapsed, leftPanelCollapsed: collapsed, leftPanelWidth: width } })
      .catch(() => undefined);
  }, [rightPanelCollapsed, dataSourceCollapsed]);

  // ── Workflow Definition smooth resize ───────────────────────────────────────
  // Delta-based drag (start width + pointer delta) avoids the "jump" caused by
  // measuring against an assumed panel origin. Updates are batched through
  // requestAnimationFrame so the canvas reflows smoothly while dragging, and the
  // width is persisted once on release.
  const startLeftResize = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = leftPanelWidth;
      let latest = startWidth;
      let frame = 0;

      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";

      const onMove = (moveEvent: PointerEvent) => {
        latest = clampWorkflowDefWidth(startWidth + (moveEvent.clientX - startX));
        if (!frame) {
          frame = window.requestAnimationFrame(() => {
            frame = 0;
            setLeftPanelWidth(latest);
          });
        }
      };

      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        if (frame) window.cancelAnimationFrame(frame);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        setLeftPanelWidth(latest);
        persistLeftPanel(leftPanelCollapsed, latest);
      };

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    },
    [leftPanelWidth, leftPanelCollapsed, persistLeftPanel]
  );

  // Double-click the handle to reset to the default width.
  const resetLeftWidth = useCallback(() => {
    setLeftPanelWidth(WORKFLOW_DEF_DEFAULT_WIDTH);
    persistLeftPanel(leftPanelCollapsed, WORKFLOW_DEF_DEFAULT_WIDTH);
  }, [leftPanelCollapsed, persistLeftPanel]);

  useEffect(() => {
    if (!workflowDataSourceId) {
      setDataSourceRecordCount(null);
      return;
    }
    window.playwrightFlowStudio.dataSources
      .preview(workflowDataSourceId, workflowRootArrayPath)
      .then((preview) => {
        const result = preview as { selected?: unknown; rows?: unknown[] };
        const rows = Array.isArray(result.selected) ? result.selected : result.rows ?? [];
        setDataSourceRecordCount(rows.length);
      })
      .catch(() => setDataSourceRecordCount(null));
  }, [workflowDataSourceId, workflowRootArrayPath]);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      // Point 1/2: a drag started from a conditional/parallel port creates a connector of
      // that kind (previously every new connector was forced to "success", so the extra
      // ports rendered but had no effect).
      // Point 3: a node that already has a self-loop forces every additional outgoing
      // connector to Conditional (so the workflow can decide when to exit the loop).
      const kind = loopControlledSources.has(connection.source)
        ? "conditional"
        : connectorPortKindFromHandle(connection.sourceHandle ?? connection.targetHandle);
      // Rule 3/4: conditional/parallel branch connectors are a two-port pair — cap at 2 per node.
      if (kind === "conditional" || kind === "parallel") {
        const existing = edges.filter((edge) => edge.source === connection.source && edge.source !== edge.target && scenarioEdgeKind(edge.data?.linkType) === kind).length;
        if (existing >= MAX_BRANCH_CONNECTORS) return;
      }
      const linkType: ScenarioLink["type"] = kind === "conditional" ? "conditional" : kind === "parallel" ? "parallel" : "success";
      setEdges((currentEdges) => reconcileScenarioBranches(addEdge(createScenarioEdge(connection.source!, connection.target!, linkType), currentEdges)));
      setSaveState("Unsaved changes");
    },
    [setEdges, loopControlledSources, edges]
  );

  const updateNodeData = useCallback(
    (flowId: string, data: Partial<ScenarioFlowNodeData>) => {
      setNodes((currentNodes) => currentNodes.map((node) => (node.id === flowId ? { ...node, data: { ...node.data, ...data } } : node)));
      setSaveState("Unsaved changes");
    },
    [setNodes]
  );

  const updateEdgeData = useCallback(
    (edgeId: string, data: Partial<ScenarioLinkData>) => {
      setEdges((currentEdges) =>
        reconcileScenarioBranches(
          currentEdges.map((edge) => {
            if (edge.id !== edgeId) return edge;
            const nextData = { ...edge.data, ...data } as ScenarioLinkData;
            // Loop is button-managed and never selected from the panel (Rule 1); guard anyway:
            // a loop connector may only connect a node to itself.
            if (scenarioEdgeKind(nextData.linkType) === "loop" && edge.source !== edge.target) {
              nextData.linkType = edge.data?.linkType ?? "success";
            }
            const label = nextData.label && nextData.label.trim() ? nextData.label : nextData.linkType;
            const { sourceHandle, targetHandle } = portHandlesForKind(scenarioEdgeKind(nextData.linkType));
            return {
              ...edge,
              sourceHandle,
              targetHandle,
              ...buildConnectorVisual(nextData.linkType, nextData.style),
              data: { ...nextData, label },
              label
            };
          })
        )
      );
      setSaveState("Unsaved changes");
    },
    [setEdges]
  );

  // Delete-key / programmatic edge removals trigger the branch-pair revert (Rule 3/4): a lone
  // surviving conditional/parallel connector collapses back to a normal connector.
  const handleEdgesChange = useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => {
      const removedSources = new Set<string>();
      changes.forEach((change) => {
        if (change.type === "remove") {
          const removed = edges.find((edge) => edge.id === change.id);
          if (removed) removedSources.add(removed.source);
        }
      });
      onEdgesChange(changes);
      if (removedSources.size) setEdges((currentEdges) => reconcileScenarioBranches(currentEdges, removedSources));
    },
    [edges, onEdgesChange, setEdges]
  );

  const addFlow = useCallback(
    (flowId: string) => {
      const nextOrder = nodes.length + 1;
      const x = 140 + nodes.length * 320;
      const y = 180;
      const node = createScenarioNode(flowId, nextOrder, { x, y }, true, undefined, flowLibrary);
      setNodes((currentNodes) => [...currentNodes, node]);
      setSaveState("Unsaved changes");
    },
    [nodes.length, setNodes, flowLibrary]
  );

  const removeFlow = useCallback(
    (flowId: string) => {
      setNodes((currentNodes) => normalizeOrders(currentNodes.filter((node) => node.id !== flowId)));
      setEdges((currentEdges) => {
        // Removing a flow may orphan one half of a branch pair on another node — revert survivors.
        const affectedSources = new Set(currentEdges.filter((edge) => edge.target === flowId).map((edge) => edge.source));
        return reconcileScenarioBranches(
          currentEdges.filter((edge) => edge.source !== flowId && edge.target !== flowId),
          affectedSources
        );
      });
      setSaveState("Unsaved changes");
    },
    [setEdges, setNodes]
  );

  const reorderFlow = useCallback(
    (flowId: string, targetOrder: number) => {
      setNodes((currentNodes) => {
        const sorted = [...currentNodes].sort((a, b) => a.data.order - b.data.order);
        const fromIndex = sorted.findIndex((node) => node.id === flowId);
        const toIndex = Math.max(0, Math.min(sorted.length - 1, targetOrder - 1));
        const [moved] = sorted.splice(fromIndex, 1);
        sorted.splice(toIndex, 0, moved);
        return normalizeOrders(sorted).map((node, index) => ({
          ...node,
          position: { ...node.position, x: 140 + index * 320 }
        }));
      });
      setSaveState("Unsaved changes");
    },
    [setNodes]
  );

  const saveScenario = useCallback(async () => {
    if (connectorIssues.length) {
      setToast({ tone: "error", message: `Cannot save: ${connectorIssues[0]}` });
      return;
    }
    const now = new Date().toISOString();
    const profileToSave: WorkflowProfile = {
      ...workflowProfile,
      updatedAt: now,
      createdAt: workflowProfile.createdAt ?? now
    };
    try {
      const existing = await window.playwrightFlowStudio.workflows.get(profileToSave.id);
      if (existing) {
        await window.playwrightFlowStudio.workflows.update(profileToSave.id, profileToSave);
      } else {
        await window.playwrightFlowStudio.workflows.create(profileToSave);
      }
      const updated = await window.playwrightFlowStudio.workflows.list();
      setWorkflows(updated);
      setSaveState("Saved");
      setSavedSnapshot(serializeWorkflowDoc(profileToSave)); // current document is now the saved baseline
      // Persist the active workflow so navigating away and back restores it.
      window.playwrightFlowStudio.settings
        .update({ selectedBuilderWorkflowId: profileToSave.id, selections: { lastSelectedWorkflowId: profileToSave.id } })
        .catch(() => undefined);
      setToast({ tone: "success", message: `Workflow saved successfully: ${profileToSave.name}` });
    } catch (error) {
      setSaveState("Save failed");
      setToast({ tone: "error", message: `Failed to save changes. ${error instanceof Error ? error.message : ""}`.trim() });
    }
  }, [workflowProfile, connectorIssues]);

  /**
   * Task 01: double-clicking a workflow flow node opens that flow in the Flow Designer.
   * We persist which flow to open and the workflow to return to, then navigate (which
   * routes through the unsaved-changes guard). The header Back button returns here.
   */
  const openFlowInDesigner = useCallback(
    async (flowId: string) => {
      await window.playwrightFlowStudio.settings
        .update({ selectedBuilderWorkflowId: workflowId, selections: { lastSelectedFlowId: flowId } })
        .catch(() => undefined);
      navigation.navigateTo("flowChart");
    },
    [navigation, workflowId]
  );

  const loadWorkflowProfile = useCallback(
    (profile: WorkflowProfile, library = flowLibrary) => {
      setWorkflowId(profile.id);
      setWorkflowName(profile.name);
      setExecutionMode(profile.execution.mode);
      setMaxParallelFlows(profile.execution.maxConcurrentInstances);
      setWorkflowDataSourceId(profile.dataSource?.dataSourceId ?? "");
      setWorkflowRootArrayPath(profile.dataSource?.rootArrayPath ?? "$.customers");
      setFailurePolicy((current) => ({ ...current, stopOnRequiredFlowFailure: profile.execution.stopOnRequiredFlowFailure }));
      setNodes(
        profile.nodes.map((node, index) =>
          createScenarioNode(node.flowId, node.order, node.position ?? { x: 140 + index * 320, y: 180 }, node.required, undefined, library, node.alias, node.size)
        )
      );
      setEdges(reconcileScenarioBranches(profile.edges.map((link) => createScenarioEdge(link.source, link.target, link.type, link))));
      setSaveState("Loaded");
      pendingSnapshot.current = true; // recapture the dirty baseline once the loaded workflow settles
      window.playwrightFlowStudio.settings
        .update({ selectedBuilderWorkflowId: profile.id, selections: { lastSelectedWorkflowId: profile.id } })
        .catch(() => undefined);
    },
    [flowLibrary, setEdges, setNodes]
  );

  const createNewWorkflow = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setWorkflowId(generateWorkflowId());
    setWorkflowName("New Workflow");
    setExecutionMode("sequential");
    setMaxParallelFlows(1);
    setWorkflowDataSourceId("");
    setWorkflowRootArrayPath("$.customers");
    setSelectedEdgeId(null);
    setSaveState("New — unsaved");
    pendingSnapshot.current = true; // a brand-new empty workflow is the clean baseline (not dirty)
  }, [setEdges, setNodes]);

  const loadScenario = useCallback(async () => {
    const profile = await window.playwrightFlowStudio.workflows.get(workflowId);
    if (!profile) {
      setSaveState("No saved workflow with this ID");
      return;
    }
    loadWorkflowProfile(profile);
  }, [loadWorkflowProfile, workflowId]);

  const exportScenario = useCallback(() => {
    const blob = new Blob([JSON.stringify(workflowProfile, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `${workflowProfile.id}.json`;
    link.click();
    URL.revokeObjectURL(href);
  }, [workflowProfile]);

  const runWorkflow = useCallback(async () => {
    await saveScenario();
    const result = await window.playwrightFlowStudio.executions.runWorkflow({ workflowId: workflowProfile.id, dryRun: true });
    setSaveState(typeof result === "object" && result !== null && "status" in result ? `Run ${String(result.status)}` : "Run requested");
  }, [saveScenario, workflowProfile.id]);

  const isDirty = savedSnapshot !== "" && docSnapshot !== savedSnapshot;

  // Task 3: clicking empty canvas clears the connector selection and collapses the surrounding
  // panels (app side menu, Workflow Definition, Selected Connector) to give the canvas more room.
  // Clicking a connector re-opens the right panel (see onEdgeClick). Only collapse (never expand)
  // so repeated pane clicks are idempotent.
  const handlePaneClick = useCallback(() => {
    setSelectedEdgeId(null);
    if (!leftPanelCollapsed) persistLeftPanel(true, leftPanelWidth);
    if (!rightPanelCollapsed) persistRightPanel(true);
    navigation.collapseSidebar();
  }, [leftPanelCollapsed, rightPanelCollapsed, leftPanelWidth, persistLeftPanel, persistRightPanel, navigation]);

  // Phase 02: Top header only has Save + Run (no duplicates inside page toolbar)
  usePageChrome(
    {
      actions: [
        { id: "new", label: "New", onClick: createNewWorkflow, title: "Create a new empty workflow" },
        { id: "save", label: "Save", variant: "primary", onClick: () => saveScenario(), title: "Save this workflow" },
        { id: "run", label: "Run", onClick: () => void runWorkflow(), title: "Save and dry-run" }
      ],
      dirty: isDirty
    },
    [saveScenario, runWorkflow, isDirty, createNewWorkflow]
  );

  // Phase 02: Build dynamic grid template based on right-panel collapse state
  const builderGridStyle = {
    gridTemplateColumns: `${leftPanelCollapsed ? "44px" : `${leftPanelWidth}px`} minmax(0, 1fr) ${rightPanelCollapsed ? "44px" : "300px"}`
  } as React.CSSProperties;

  return (
    <section className="page scenario-builder-page">
      {/* Phase 02: Compact single-row toolbar. Save/Run live in the top app header. */}
      <section className="scenario-toolbar scenario-toolbar-compact">
        {/* Workflow selector + name — compact inline */}
        <label className="sb-toolbar-field">
          <span>Workflow</span>
          <select
            value={workflowId}
            onChange={(event) => {
              const profile = workflows.find((workflow) => workflow.id === event.target.value);
              if (profile) loadWorkflowProfile(profile);
            }}
          >
            <option value={workflowId}>{workflowName}</option>
            {workflows
              .filter((w) => w.id !== workflowId)
              .map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name}
                </option>
              ))}
          </select>
        </label>

        <label className="sb-toolbar-field">
          <span>Name</span>
          <input
            value={workflowName}
            onChange={(event) => {
              setWorkflowName(event.target.value);
              setSaveState("Unsaved changes");
            }}
            style={{ minWidth: "140px" }}
          />
        </label>

        <label className="sb-toolbar-field">
          <span>Mode</span>
          <select value={executionMode} onChange={(event) => setExecutionMode(event.target.value as ScenarioProfile["executionMode"])}>
            <option value="sequential">Sequential</option>
            <option value="conditional">Conditional</option>
            <option value="parallel">Parallel</option>
            <option value="loop">Loop</option>
            <option value="manual">Manual</option>
          </select>
        </label>

        <label className="sb-toolbar-field">
          <span>Parallel</span>
          <input
            min="1"
            style={{ width: "58px" }}
            type="number"
            value={maxParallelFlows}
            onChange={(event) => setMaxParallelFlows(Number(event.target.value))}
          />
        </label>

        {/* Secondary actions — NOT Save/Run (those are in top header) */}
        <div className="sb-toolbar-actions">
          <button className="toolbar-button" id="sb-new" onClick={createNewWorkflow} title="Create a new empty workflow" type="button">
            <FilePlus size={14} />
            New
          </button>
          <button className="toolbar-button" id="sb-reload" onClick={() => void loadScenario()} title="Reload from saved" type="button">
            <FolderOpen size={14} />
            Reload
          </button>
          <button className="toolbar-button" id="sb-export" onClick={exportScenario} title="Export workflow JSON" type="button">
            <Download size={14} />
            Export
          </button>
          <span className={executionPlan.validationIssues.length || connectorIssues.length ? "validation-chip warn" : "validation-chip ok"} title={
            executionPlan.validationIssues.length || connectorIssues.length
              ? [...connectorIssues, ...executionPlan.validationIssues.map((i) => i.message)].join("; ")
              : "Workflow is valid"
          }>
            <ShieldCheck size={13} />
            {executionPlan.validationIssues.length || connectorIssues.length
              ? `${executionPlan.validationIssues.length + connectorIssues.length} issues`
              : "Valid"}
          </span>
          <span className="sb-save-state" title={saveState}>{saveState}</span>
        </div>
      </section>

      {/* Phase 01+03: Dynamic 3-column grid responding to collapse state */}
      <div className="scenario-builder-grid" style={builderGridStyle}>

        {/* LEFT PANEL */}
        {leftPanelCollapsed ? (
          <aside className="scenario-side-panel scenario-side-rail" aria-label="Expand side panel">
            <button
              className="sb-collapse-btn sb-rail-expand"
              id="sb-left-panel-expand"
              title="Show Workflow Definition"
              type="button"
              onClick={() => persistLeftPanel(false, leftPanelWidth)}
            >
              <PanelRightOpen size={16} style={{ transform: "rotate(180deg)" }} />
            </button>
            <span className="panel-rail-label">Workflow Definition</span>
          </aside>
        ) : (
          <div style={{ display: "flex", width: "100%", height: "100%" }}>
            <aside className="scenario-side-panel" style={{ flex: 1, minWidth: 0, paddingRight: 4 }}>
              <div className="sb-section-header" style={{ marginBottom: 0, paddingBottom: 4 }}>
                <h2 style={{ margin: 0, flex: 1 }}>Workflow Definition</h2>
                <button
                  className="sb-collapse-btn"
                  id="sb-left-panel-collapse"
                  title="Collapse side panel"
                  type="button"
                  onClick={() => persistLeftPanel(true, leftPanelWidth)}
                >
                  <PanelRightClose size={16} style={{ transform: "rotate(180deg)" }} />
                </button>
              </div>

              {/* Phase 03: Collapsible Workflow Data Source */}
          <section className="sb-collapsible-section">
            <div className="sb-section-header">
              <Database size={14} />
              <strong>
                {dataSourceCollapsed && selectedDataSourceName
                  ? `Data Source: ${selectedDataSourceName}`
                  : dataSourceCollapsed
                    ? "Data Source: None"
                    : "Workflow Data Source"}
              </strong>
              <button
                className="sb-collapse-btn"
                id="sb-datasource-toggle"
                title={dataSourceCollapsed ? "Expand data source settings" : "Collapse data source settings"}
                type="button"
                onClick={() => persistDataSource(!dataSourceCollapsed)}
              >
                {dataSourceCollapsed ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
              </button>
            </div>

            {!dataSourceCollapsed && (
              <div className="sb-section-content">
                <label>
                  Data Source
                  <select
                    value={workflowDataSourceId}
                    onChange={(event) => {
                      const id = event.target.value;
                      setWorkflowDataSourceId(id);
                      if (id) window.playwrightFlowStudio.settings.update({ selections: { lastSelectedDataSourceId: id } }).catch(() => undefined);
                    }}
                  >
                    <option value="">None</option>
                    {dataSources.map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Root Array Path
                  <input
                    placeholder="$.customers"
                    value={workflowRootArrayPath}
                    onChange={(event) => setWorkflowRootArrayPath(event.target.value)}
                  />
                </label>
                <span className="form-message">
                  {workflowDataSourceId
                    ? dataSourceRecordCount === null
                      ? "Resolving records…"
                      : `${dataSourceRecordCount} record(s) found`
                    : "Dynamic nodes set to 'workflow data source' will use this."}
                </span>
              </div>
            )}
          </section>

          {/* Saved Flows */}
          <section>
            <h2>Saved Flows</h2>
            {/* Task 03: search by flow name */}
            <div className="sb-flow-search">
              <Search size={14} />
              <input
                placeholder="Search saved flows by name…"
                value={flowSearch}
                onChange={(event) => {
                  setFlowSearch(event.target.value);
                  setFlowVisibleCount(SAVED_FLOWS_PAGE_SIZE); // reset paging when the query changes
                }}
              />
            </div>
            <div className="scenario-flow-library">
              {visibleFlows.length ? (
                visibleFlows.map((flow) => (
                  <button key={flow.flowId} onClick={() => addFlow(flow.flowId)} type="button">
                    <strong>{flow.name}</strong>
                    <span>{flow.description}</span>
                  </button>
                ))
              ) : flowLibrary.length === 0 ? (
                <p>No saved flows yet. Create flows in the Flow Designer, then add them to this workflow.</p>
              ) : flowSearch.trim() ? (
                <p>No matching flows found.</p>
              ) : (
                <p>All saved flows are already in the workflow.</p>
              )}
            </div>
            {/* Task 04: pagination footer — always show the count so it's clear the list
                is capped at 10, with a Load More button while more flows remain. */}
            {filteredFlows.length > 0 ? (
              <div className="sb-saved-flows-footer">
                <span className="form-message">
                  Showing {visibleFlows.length} of {filteredFlows.length} flow{filteredFlows.length === 1 ? "" : "s"}
                </span>
                {filteredFlows.length > flowVisibleCount ? (
                  <button
                    className="toolbar-button sb-load-more"
                    type="button"
                    onClick={() => setFlowVisibleCount((count) => count + SAVED_FLOWS_PAGE_SIZE)}
                  >
                    Load More ({filteredFlows.length - flowVisibleCount} more)
                  </button>
                ) : filteredFlows.length > SAVED_FLOWS_PAGE_SIZE ? (
                  <span className="form-message">All flows loaded.</span>
                ) : null}
              </div>
            ) : null}
          </section>

          {/* Flow Order */}
          <section>
            <h2>Flow Order</h2>
            <div className="flow-order-list">
              {orderedNodes.map((node) => (
                <article
                  draggable
                  key={node.id}
                  className="flow-order-item"
                  onDragOver={(event) => event.preventDefault()}
                  onDragStart={() => setDraggedFlowId(node.id)}
                  onDrop={() => {
                    if (draggedFlowId) reorderFlow(draggedFlowId, node.data.order);
                    setDraggedFlowId(null);
                  }}
                >
                  <div className="flow-order-item-top">
                    <GripVertical size={15} className="drag-handle" />
                    <div className="flow-order-item-name">
                      <strong>{node.data.name}</strong>
                    </div>
                  </div>
                  <div className="flow-order-item-bottom">
                    <input min="1" type="number" value={node.data.order} onChange={(event) => reorderFlow(node.id, Number(event.target.value))} title="Execution order" />
                    <label className="inline-check">
                      <input
                        checked={node.data.required}
                        type="checkbox"
                        onChange={(event) => updateNodeData(node.id, { required: event.target.checked })}
                      />
                      Req
                    </label>
                    <button className="icon-button" onClick={() => removeFlow(node.id)} type="button" title="Remove flow">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </aside>
        <div
          className="sb-resize-handle"
          onPointerDown={startLeftResize}
          onDoubleClick={resetLeftWidth}
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize Workflow Definition (double-click to reset)"
        />
        </div>
        )}

        {/* CANVAS */}
        <section className="scenario-canvas-panel">
          {nodes.length === 0 ? (
            <div className="scenario-canvas-empty">
              <strong>No flows added to this workflow yet.</strong>
              <span>Select saved flows from the left panel to build your workflow.</span>
            </div>
          ) : null}
          <ReactFlow
            edges={edges}
            edgeTypes={edgeTypes}
            nodeTypes={nodeTypes}
            nodes={nodesForCanvas}
            onConnect={onConnect}
            onEdgeClick={(_, edge) => {
              setSelectedEdgeId(edge.id);
              // Task 3: selecting a connector opens the connector-details panel if it was collapsed.
              if (rightPanelCollapsed) persistRightPanel(false);
              window.playwrightFlowStudio.settings.update({ selections: { lastSelectedConnectorId: edge.id } }).catch(() => undefined);
            }}
            onPaneClick={handlePaneClick}
            onEdgesChange={handleEdgesChange}
            onNodesChange={onNodesChange}
            onNodeDoubleClick={(_, node) => void openFlowInDesigner((node.data as ScenarioFlowNodeData).flowId)}
            onMoveEnd={(_, viewport) => persistBuilderZoom(Math.round(viewport.zoom * 100))}
          >
            <Background color="#dfe7f3" gap={24} size={1} variant={BackgroundVariant.Lines} />
            <Controls position="top-right" showZoom={false} />
            <CanvasZoomControl onPersist={persistBuilderZoom} />
            <MiniMap pannable position="bottom-right" zoomable />
          </ReactFlow>
        </section>

        {/* RIGHT PANEL — Phase 01: Collapsible */}
        {rightPanelCollapsed ? (
          /* Collapsed: narrow icon rail */
          <aside className="scenario-properties-panel scenario-properties-rail" aria-label="Expand connector panel">
            <button
              className="sb-collapse-btn sb-rail-expand"
              id="sb-right-panel-expand"
              title="Show Selected Connector"
              type="button"
              onClick={() => persistRightPanel(false)}
            >
              <PanelRightOpen size={16} />
            </button>
            <span className="panel-rail-label">Selected Connector</span>
          </aside>
        ) : (
          <aside className="scenario-properties-panel">
            {/* Phase 01: Collapse button in panel header */}
            <section>
              <div className="sb-section-header">
                <h2 style={{ margin: 0, flex: 1 }}>Selected Connector</h2>
                <button
                  className="sb-collapse-btn"
                  id="sb-right-panel-collapse"
                  title="Collapse connector panel"
                  type="button"
                  onClick={() => persistRightPanel(true)}
                >
                  <PanelRightClose size={16} />
                </button>
              </div>
              {selectedEdge ? (
                <>
                  <label>
                    Link Type
                    <select
                      disabled={selectedEdgeKindLocked}
                      value={selectedEdge.data?.linkType ?? "success"}
                      onChange={(event) =>
                        updateEdgeData(selectedEdge.id, { linkType: event.target.value as ScenarioLink["type"], label: event.target.value })
                      }
                    >
                      <option disabled={selectedEdgeKindLocked} value="success">
                        Success
                      </option>
                      <option disabled={selectedEdgeKindLocked} value="failure">
                        Failure
                      </option>
                      <option disabled={selectedEdgeKindLocked} value="always">
                        Always
                      </option>
                      <option value="conditional">Conditional</option>
                      <option value="outcome">Outcome-based</option>
                      <option disabled={selectedEdgeKindLocked} value="manualApproval">
                        Manual Approval
                      </option>
                      {/* Loop is created only by the node's loop button (Rule 1); shown disabled so an
                          existing loop connector still displays, but it can never be selected here. */}
                      <option disabled value="loop">
                        Loop
                      </option>
                      <option disabled={selectedEdgeKindLocked} value="loopBack">
                        Loop Back
                      </option>
                      <option disabled={selectedEdgeKindLocked} value="parallel">
                        Parallel
                      </option>
                    </select>
                    {selectedEdgeIsBranch ? (
                      <small>
                        {selectedEdgeKind === "conditional" ? "Conditional" : "Parallel"} connectors come in a locked pair. Remove one
                        connector to change the type — the remaining connector reverts to Normal automatically.
                      </small>
                    ) : selectedEdgeKind === "loop" ? (
                      <small>Loop connectors are managed by the node&apos;s loop button. Remove the loop to change this connector.</small>
                    ) : selectedEdgeKindLocked ? (
                      <small>
                        This node has a loop connector. Additional outgoing connectors must be Conditional. Remove the loop connector
                        to choose another link type.
                      </small>
                    ) : null}
                  </label>
                  <label>
                    Label
                    <input value={selectedEdge.data?.label ?? ""} onChange={(event) => updateEdgeData(selectedEdge.id, { label: event.target.value })} />
                  </label>
                  <label>
                    Condition
                    <input
                      placeholder="${outputs.flow.customerId} !== ''"
                      value={selectedEdge.data?.expression ?? ""}
                      onChange={(event) => updateEdgeData(selectedEdge.id, { expression: event.target.value })}
                    />
                  </label>
                  <ConnectorStyleEditor
                    style={selectedEdge.data?.style}
                    onChange={(patch) => updateEdgeData(selectedEdge.id, { style: { ...selectedEdge.data?.style, ...patch } })}
                    onReset={() => updateEdgeData(selectedEdge.id, { style: undefined })}
                  />
                </>
              ) : (
                <p>Select a connector on the canvas to edit link type and condition.</p>
              )}
            </section>

            <section>
              <h2>Failure Policy</h2>
              <label className="inline-check">
                <input
                  checked={failurePolicy.stopOnRequiredFlowFailure}
                  type="checkbox"
                  onChange={(event) => setFailurePolicy((current) => ({ ...current, stopOnRequiredFlowFailure: event.target.checked }))}
                />
                Stop on required flow failure
              </label>
              <label className="inline-check">
                <input
                  checked={failurePolicy.continueOnOptionalFlowFailure}
                  type="checkbox"
                  onChange={(event) => setFailurePolicy((current) => ({ ...current, continueOnOptionalFlowFailure: event.target.checked }))}
                />
                Continue optional failures
              </label>
              <label className="inline-check">
                <input
                  checked={failurePolicy.takeScreenshotOnFailure}
                  type="checkbox"
                  onChange={(event) => setFailurePolicy((current) => ({ ...current, takeScreenshotOnFailure: event.target.checked }))}
                />
                Screenshot on failure
              </label>
            </section>

            <section>
              <h2>Validation</h2>
              <div className="validation-list">
                {connectorIssues.length || executionPlan.validationIssues.length ? (
                  <>
                    {connectorIssues.map((message, index) => (
                      <span key={`connector-${index}`}>{message}</span>
                    ))}
                    {executionPlan.validationIssues.map((issue) => (
                      <span key={issue.id}>{issue.message}</span>
                    ))}
                  </>
                ) : (
                  <strong>Workflow profile is valid.</strong>
                )}
              </div>
            </section>
          </aside>
        )}
      </div>
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </section>
  );
}

export function ScenarioBuilder() {
  return (
    <ReactFlowProvider>
      <ScenarioBuilderContent />
    </ReactFlowProvider>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function createScenarioNode(
  flowId: string,
  order: number,
  position: { x: number; y: number },
  required: boolean,
  flowReference?: ScenarioFlowReference,
  library = fallbackFlowLibrary,
  alias?: string,
  size?: { width: number; height: number }
): ScenarioNode {
  const libraryItem = library.find((flow) => flow.flowId === flowId) ?? {
    flowId,
    name: flowId,
    description: "Imported flow",
    outputs: [],
    inputs: []
  };

  const width = size?.width ?? SCENARIO_NODE_DEFAULT_WIDTH;
  const height = size?.height ?? SCENARIO_NODE_DEFAULT_HEIGHT;

  return {
    id: flowId,
    type: "scenarioFlow",
    position,
    style: { width, height },
    data: {
      flowId,
      name: alias ?? libraryItem.name,
      description: libraryItem.description,
      order,
      required,
      mode: "sequential",
      width,
      height,
      outputs: flowReference?.outputs ? Object.keys(flowReference.outputs) : libraryItem.outputs,
      inputs: flowReference?.inputs ? Object.keys(flowReference.inputs) : libraryItem.inputs
    }
  };
}

function createScenarioEdge(
  source: string,
  target: string,
  linkType: ScenarioLink["type"],
  link?: { id?: string; label?: string; condition?: { expression: string }; style?: EdgeVisualStyle }
): ScenarioEdge {
  const label = link?.label ?? linkType;
  const style = link?.style;
  const { sourceHandle, targetHandle } = portHandlesForKind(scenarioEdgeKind(linkType));
  return {
    id: link?.id ?? `edge-${source}-${target}`,
    source,
    target,
    sourceHandle,
    targetHandle,
    ...buildConnectorVisual(linkType, style),
    label,
    data: {
      linkType,
      label,
      expression: link?.condition?.expression ?? "",
      style
    }
  };
}

/**
 * Enforce the branch-connector invariants on the Workflow Builder edges: slot each node's
 * conditional/parallel pair to distinct right-side ports, and (for `revertSources`) collapse a
 * lone surviving branch connector back to a normal (`success`) connector. See
 * `reconcileBranchConnectors`.
 */
function reconcileScenarioBranches(edges: ScenarioEdge[], revertSources?: Set<string>): ScenarioEdge[] {
  const keepLabel = (edge: ScenarioEdge) => {
    const l = edge.data?.label?.trim();
    return l && l !== "conditional" && l !== "parallel" ? l : "success";
  };
  return reconcileBranchConnectors(edges, {
    kindOf: (edge) => scenarioEdgeKind(edge.data?.linkType),
    slotAssign: (edge, kind, slot) => ({ ...edge, sourceHandle: branchSourceHandle(kind, slot), targetHandle: `${kind}-in` }),
    toNormal: (edge) => ({
      ...edge,
      sourceHandle: "normal-out",
      targetHandle: "normal-in",
      ...buildConnectorVisual("success", edge.data?.style),
      data: { ...edge.data, linkType: "success", label: keepLabel(edge), expression: edge.data?.expression ?? "" },
      label: keepLabel(edge)
    }),
    revertSources
  });
}

/**
 * Connector-structure rules (Points 2–4) for the Workflow Builder canvas, mirroring the
 * Flow Designer's `connectorStructureIssues`: at most one standard (non-conditional/
 * non-parallel) outgoing connector per node, loop connectors must return to the same
 * node, and additional connectors from a loop-controlled node must be Conditional.
 */
function scenarioConnectorStructureIssues(edges: ScenarioEdge[], nodeName: (id: string) => string): string[] {
  const messages: string[] = [];
  const kindOf = (edge: ScenarioEdge) => scenarioEdgeKind(edge.data?.linkType);

  // The legacy `loopBack` link type is an intentional cross-node back-edge and is exempt —
  // only the new structured `loop` type is self-only.
  edges.forEach((edge) => {
    if (edge.data?.linkType === "loop" && edge.source !== edge.target) {
      messages.push(`Loop connector from ${nodeName(edge.source)} is invalid — it must return to the same node.`);
    }
  });

  const outgoingBySource = new Map<string, ScenarioEdge[]>();
  edges.forEach((edge) => {
    const list = outgoingBySource.get(edge.source) ?? [];
    list.push(edge);
    outgoingBySource.set(edge.source, list);
  });
  outgoingBySource.forEach((sourceEdges, source) => {
    const standard = sourceEdges.filter((edge) => kindOf(edge) !== "conditional" && kindOf(edge) !== "parallel");
    if (standard.length > 1) {
      messages.push(
        `Node "${nodeName(source)}" has multiple standard outgoing connectors. Use a Conditional or Parallel connector for additional outgoing paths, or remove the extra connector.`
      );
    }
  });

  const loopSources = new Set(edges.filter((edge) => edge.source === edge.target && kindOf(edge) === "loop").map((edge) => edge.source));
  edges.forEach((edge) => {
    if (!loopSources.has(edge.source) || edge.source === edge.target) return;
    if (kindOf(edge) !== "conditional") {
      messages.push(`Node "${nodeName(edge.source)}" has a loop connector. Additional outgoing connectors from a loop node must be Conditional.`);
    }
  });

  return messages;
}

function normalizeOrders(nodes: ScenarioNode[]): ScenarioNode[] {
  return [...nodes].sort((a, b) => a.data.order - b.data.order).map((node, index) => ({ ...node, data: { ...node.data, order: index + 1 } }));
}

function toWorkflowProfile(
  nodes: ScenarioNode[],
  edges: ScenarioEdge[],
  id: string,
  name: string,
  executionMode: ScenarioProfile["executionMode"],
  maxParallelFlows: number,
  failurePolicy: ScenarioProfile["failurePolicy"],
  dataSource?: WorkflowDataSourceBinding
): WorkflowProfile {
  const orderedNodes = [...nodes].sort((a, b) => a.data.order - b.data.order);

  return {
    id,
    name,
    description: "Saved workflow of reusable flow profiles",
    version: 1,
    dataSource,
    nodes: orderedNodes.map((node) => ({
      id: node.id,
      type: "flowRef",
      flowId: node.data.flowId,
      alias: node.data.name,
      order: node.data.order,
      required: node.data.required,
      inputBindings: Object.fromEntries(
        node.data.inputs.map((input) => [
          input,
          input === "currentRow"
            ? { type: "currentRow", path: "$" }
            : input === "selectedAccountType"
              ? { type: "runtimeInput", key: "selectedAccountType" }
              : { type: "static", value: input }
        ])
      ),
      retryPolicy: { count: 0, delayMs: 1000 },
      failurePolicy: failurePolicy.stopOnRequiredFlowFailure ? "stop" : "continue",
      position: node.position,
      size: { width: Math.round(node.data.width), height: Math.round(node.data.height) }
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.data?.linkType ?? "success",
      label: edge.data?.label,
      condition: edge.data?.expression ? { expression: edge.data.expression } : undefined,
      style: hasCustomStyle(edge.data?.style) ? edge.data?.style : undefined
    })),
    runtimeInputs: [
      {
        key: "selectedAccountType",
        label: "Account Type",
        type: "dropdown",
        required: true,
        options: ["BUSINESS", "PERSONAL"]
      }
    ],
    execution: {
      mode: executionMode,
      maxConcurrentInstances: maxParallelFlows,
      stopOnRequiredFlowFailure: failurePolicy.stopOnRequiredFlowFailure
    }
  };
}

function toFlowLibraryItems(flows: FlowProfile[]): typeof fallbackFlowLibrary {
  // No demo data: an empty library shows the "create flows first" empty state.
  if (!flows.length) return [];

  return flows.map((flow) => ({
    flowId: flow.id,
    name: flow.name,
    description: flow.description ?? "Saved flow profile",
    outputs: flow.nodes.flatMap((node) => (node.outputs ? Object.keys(node.outputs) : [])),
    inputs: flow.nodes.flatMap((node) => {
      if (node.valueSource?.type === "runtimeInput" && node.valueSource.key) return [node.valueSource.key];
      if (node.valueSource?.type === "currentRow") return ["currentRow"];
      return [];
    })
  }));
}
