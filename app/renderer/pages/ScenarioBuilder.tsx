import {
  FlowCanvas,
  Background,
  CanvasZoomControl,
  SmoothEdge,
  LoopEdge,
  useNodesState,
  useEdgesState,
  createIdentityStore,
  mapWithIdentity,
  type FlowCanvasHandle,
  type CanvasNode,
  type CanvasEdge,
  type NodeTypes,
  type EdgeTypes,
  type Viewport
} from "../components/canvas";
import {
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  FilePlus,
  FolderOpen,
  GitBranch,
  GitFork,
  GripVertical,
  LayoutGrid,
  Network,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Repeat,
  Save,
  Search,
  ShieldCheck,
  Trash2
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScenarioFlowNode } from "../components/scenario/ScenarioFlowNode";
import { Toast, type ToastState } from "../components/shared/Toast";
import { ConfirmDialog } from "../components/shared/ConfirmDialog";
import { PromptDialog } from "../components/shared/PromptDialog";
import { CanvasItemPicker, type CanvasPickerItem } from "../components/shared/CanvasItemPicker";
import { buildConnectorVisual, hasCustomStyle } from "../components/shared/connectorStyle";
import {
  incompleteBranchPairMessage,
  incompleteBranchPairs,
  revertLoneBranchConnectors,
  scenarioEdgeKind,
  scenarioEdgeToNormal
} from "../components/shared/branchPairs";
import { ConnectorStyleEditor } from "../components/shared/ConnectorStyleEditor";
import { positionsNeedLayout, withAutoLayout } from "../components/shared/graphLayout";
import { useFlowGlide, GLIDE_MAX_NODES } from "../lib/motion";
import { usePageChrome } from "../state/pageChrome";
import { useNavigation } from "../state/navigation";
import { usePermissions } from "../security/usePermissions";
import { Permission } from "@src/security/authz/Permissions";
import {
  SCENARIO_NODE_DEFAULT_HEIGHT,
  SCENARIO_NODE_DEFAULT_WIDTH,
  type ScenarioFlowNodeData,
  type ScenarioLinkData
} from "../components/scenario/scenarioDesignerTypes";
import { ScenarioOrchestrator } from "@src/orchestrator/ScenarioOrchestrator";
import type { JsonArrayDataSourceProfile } from "@src/data/DataSourceProfile";
import type { EdgeVisualStyle, FlowProfile } from "@src/profiles/FlowProfile";
import type { ScenarioFlowReference, ScenarioLink, ScenarioProfile } from "@src/profiles/ScenarioProfile";
import type { WorkflowDataSourceBinding, WorkflowProfile } from "@src/profiles/WorkflowProfile";
import { createBlankWorkflowProfile, workflowToScenarioProfile } from "@src/profiles/WorkflowProfile";

type ScenarioNode = CanvasNode<ScenarioFlowNodeData>;
type ScenarioEdge = CanvasEdge<ScenarioLinkData>;

const nodeTypes = {
  scenarioFlow: ScenarioFlowNode
} satisfies NodeTypes;

const edgeTypes = {
  smooth: SmoothEdge,
  loop: LoopEdge
} satisfies EdgeTypes;

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

function createWorkflowScaffold(): { nodes: ScenarioNode[]; edges: ScenarioEdge[] } {
  const start = createScenarioNode("start", 0, { x: 280, y: 100 }, true, undefined, [], "Start", undefined, "start");
  const end = createScenarioNode("end", 999, { x: 280, y: 420 }, true, undefined, [], "End", undefined, "end");
  return { nodes: [start, end], edges: [createScenarioEdge("start", "end", "always")] };
}

type WorkflowPickerState =
  | { mode: "blank"; x: number; y: number; position: { x: number; y: number } }
  | { mode: "edge"; x: number; y: number; edgeId: string }
  | { mode: "append"; x: number; y: number; sourceId: string };

function ScenarioBuilderContent() {
  const scaffold = useMemo(createWorkflowScaffold, []);
  const [nodes, setNodes] = useNodesState<ScenarioFlowNodeData>(scaffold.nodes);
  const [edges, setEdges] = useEdgesState<ScenarioLinkData>(scaffold.edges);
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
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [picker, setPicker] = useState<WorkflowPickerState | null>(null);
  const [connectPrompt, setConnectPrompt] = useState<{ source: string; target: string; sourceName: string; targetName: string } | null>(null);
  const [workflowSettingsOpen, setWorkflowSettingsOpen] = useState(false);
  const canvasRef = useRef<HTMLElement>(null);
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
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(true);
  const [dataSourceCollapsed, setDataSourceCollapsed] = useState(false);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(WORKFLOW_DEF_DEFAULT_WIDTH);

  // Track whether we have done the initial load to avoid re-loading on re-render
  const initialLoadDone = useRef(false);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const pendingSnapshot = useRef(true);
  const engineRef = useRef<FlowCanvasHandle>(null);
  const { animating: layoutGliding, arm: armLayoutGlide } = useFlowGlide();
  const navigation = useNavigation();
  const { can } = usePermissions();
  const canSaveWorkflow = can(Permission.WORKFLOW_EDIT);

  // Task 07: save success/failure toast
  const [toast, setToast] = useState<ToastState | null>(null);
  // Task 03/04: Saved Flows search + incremental "Load More"
  const [flowSearch, setFlowSearch] = useState("");
  const [flowVisibleCount, setFlowVisibleCount] = useState(SAVED_FLOWS_PAGE_SIZE);
  // Points 6/7: "New" prompts for a workflow name, then creates + loads that workflow.
  const [namingWorkflow, setNamingWorkflow] = useState(false);

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
  const orderedNodes = useMemo(() => nodes.filter((node) => node.data.kind === "flowRef").sort((a, b) => a.data.order - b.data.order), [nodes]);
  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId) ?? null, [nodes, selectedNodeId]);

  // Points 2–4: connector-structure issues (blocks Save until fixed).
  const connectorIssues = useMemo(
    () => scenarioConnectorStructureIssues(edges, (id) => nodes.find((node) => node.id === id)?.data.name ?? id),
    [edges, nodes]
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
  const availableFlows = flowLibrary.filter((flow) => !nodes.some((node) => node.data.kind === "flowRef" && node.data.flowId === flow.flowId));
  const filteredFlows = useMemo(() => {
    const query = flowSearch.trim().toLowerCase();
    return query ? availableFlows.filter((flow) => flow.name.toLowerCase().includes(query)) : availableFlows;
  }, [availableFlows, flowSearch]);
  const visibleFlows = filteredFlows.slice(0, flowVisibleCount);
  // Add menu (contextual picker) contents. The "Flow Logic" section is listed first so the
  // conditional / parallel / loop branch actions are discoverable; they map onto AWKIT's existing
  // connector kinds and operate on the resolved source flow node (see `applyWorkflowLogic`). The
  // "Saved Flows" section below inserts a real saved flow node.
  const pickerItems = useMemo<CanvasPickerItem<string>[]>(
    () => [
      { id: "logic-condition", label: "Conditional Branch", description: "Route the selected flow to two flows via If / Else conditional connectors", category: "Flow Logic", icon: GitBranch },
      { id: "logic-parallel", label: "Parallel Branch", description: "Run two flows at the same time from the selected flow (parallel connectors)", category: "Flow Logic", icon: GitFork },
      { id: "logic-loop", label: "Loop", description: "Repeat the selected flow with a self-loop connector", category: "Flow Logic", icon: Repeat },
      ...visibleFlows.map((flow) => ({ id: flow.flowId, label: flow.name, description: flow.description, category: "Saved Flows", icon: Network }))
    ],
    [visibleFlows]
  );
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
        setRightPanelCollapsed(true);
        setDataSourceCollapsed(settings.workflowBuilder?.workflowDataSourceCollapsed ?? false);
        setLeftPanelCollapsed(settings.workflowBuilder?.leftPanelCollapsed ?? false);
        setLeftPanelWidth(clampWorkflowDefWidth(settings.workflowBuilder?.leftPanelWidth ?? WORKFLOW_DEF_DEFAULT_WIDTH));
        const zoomPercent = settings.workflowBuilderZoomPercent > 0 ? settings.workflowBuilderZoomPercent : settings.designerDefaults.defaultZoomPercent;
        engineRef.current?.zoomTo(zoomPercent / 100);

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

  // Add or remove a flow node's self-loop connector (from the node kebab menu). Replaces the old
  // in-node loop button that mutated edges via useReactFlow.
  const toggleNodeLoop = useCallback(
    (nodeId: string) => {
      setEdges((currentEdges) => {
        const hasLoop = currentEdges.some((edge) => edge.source === nodeId && edge.target === nodeId && edge.data?.linkType === "loop");
        if (hasLoop) {
          return currentEdges.filter((edge) => !(edge.source === nodeId && edge.target === nodeId && edge.data?.linkType === "loop"));
        }
        return [...currentEdges, createScenarioEdge(nodeId, nodeId, "loop", { style: { shape: "circular" } })];
      });
      setSaveState("Unsaved changes");
    },
    [setEdges]
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
            return {
              ...edge,
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

  // Point 1a: connector "+" affordance. A workflow node *is* a saved flow, so inserting on an
  // edge splices the first not-yet-used saved flow between source and target at the edge midpoint,
  // preserving the source edge's kind/routing (reconcile keeps branch invariants intact). Purely a
  // canvas edit — nothing is serialized until Save. If every saved flow is already used, we toast.
  const insertFlowOnEdge = useCallback(
    (edgeId: string, flowId: string) => {
      const edge = edges.find((item) => item.id === edgeId);
      if (!edge || edge.source === edge.target) return;
      const flow = flowLibrary.find((item) => item.flowId === flowId && !nodes.some((node) => node.data.kind === "flowRef" && node.data.flowId === item.flowId));
      if (!flow) {
        setToast({ tone: "error", message: "All saved flows are already in this workflow. Create a new flow in the Flow Designer to insert one here." });
        return;
      }
      const sourceNode = nodes.find((node) => node.id === edge.source);
      const targetNode = nodes.find((node) => node.id === edge.target);
      const position = {
        x: ((sourceNode?.position.x ?? 140) + (targetNode?.position.x ?? 460)) / 2,
        y: ((sourceNode?.position.y ?? 180) + (targetNode?.position.y ?? 180)) / 2
      };
      // Order between the source flow and its successor; normalizeOrders re-sequences to integers.
      const insertOrder = sourceNode?.data.kind === "flowRef" ? sourceNode.data.order + 0.5 : 1;
      const node = createScenarioNode(flow.flowId, insertOrder, position, true, undefined, flowLibrary);

      setNodes((currentNodes) => normalizeOrders([...currentNodes, node]));
      setEdges((currentEdges) => {
        const targetEdge = currentEdges.find((item) => item.id === edgeId);
        if (!targetEdge) return currentEdges;
        const remaining = currentEdges.filter((item) => item.id !== edgeId);
        return reconcileScenarioBranches([
          ...remaining,
          createScenarioEdge(targetEdge.source, flow.flowId, targetEdge.data?.linkType ?? "success", {
            label: targetEdge.data?.label,
            condition: targetEdge.data?.expression ? { expression: targetEdge.data.expression } : undefined,
            style: targetEdge.data?.style
          }),
          createScenarioEdge(flow.flowId, targetEdge.target, "success")
        ]);
      });
      setSelectedEdgeId(null);
      setSaveState("Unsaved changes");
      setToast({ tone: "success", message: `Inserted "${flow.name}" into the workflow.` });
    },
    [edges, nodes, flowLibrary, setEdges, setNodes]
  );

  const pickerCoordinates = useCallback((anchor: HTMLElement) => {
    const canvas = canvasRef.current?.getBoundingClientRect();
    const target = anchor.getBoundingClientRect();
    if (!canvas) return { x: 16, y: 16 };
    return {
      x: Math.max(12, Math.min(target.left - canvas.left + target.width / 2 - 28, canvas.width - 352)),
      y: Math.max(12, Math.min(target.bottom - canvas.top + 8, canvas.height - 536))
    };
  }, []);

  const openEdgePicker = useCallback((edgeId: string, anchor: HTMLElement) => {
    setPicker({ mode: "edge", edgeId, ...pickerCoordinates(anchor) });
  }, [pickerCoordinates]);

  const openAppendPicker = useCallback((sourceId: string, anchor: HTMLElement) => {
    setPicker({ mode: "append", sourceId, ...pickerCoordinates(anchor) });
  }, [pickerCoordinates]);

  const appendFlow = useCallback((sourceId: string, flowId: string) => {
    const source = nodes.find((node) => node.id === sourceId);
    const flow = flowLibrary.find((item) => item.flowId === flowId);
    if (!source || !flow) return;
    const node = createScenarioNode(flowId, source.data.kind === "flowRef" ? source.data.order + 1 : 1, { x: source.position.x, y: source.position.y + 190 }, true, undefined, flowLibrary);
    setNodes((current) => normalizeOrders([...current, node]));
    setEdges((current) => [...current, createScenarioEdge(sourceId, flowId, source.data.kind === "start" ? "always" : "success")]);
    setSelectedNodeId(flowId);
    setSelectedEdgeId(null);
    setSaveState("Unsaved changes");
  }, [flowLibrary, nodes, setEdges, setNodes]);

  const openBlankPicker = useCallback((event: MouseEvent | React.MouseEvent) => {
    event.preventDefault();
    const canvas = canvasRef.current?.getBoundingClientRect();
    if (!canvas) return;
    setPicker({
      mode: "blank",
      x: Math.max(12, Math.min(event.clientX - canvas.left, canvas.width - 352)),
      y: Math.max(12, Math.min(event.clientY - canvas.top, canvas.height - 536)),
      position: engineRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) ?? { x: 280, y: 160 }
    });
  }, []);

  const openToolbarPicker = useCallback(() => {
    const canvas = canvasRef.current?.getBoundingClientRect();
    if (!canvas) return;
    const client = { x: canvas.left + canvas.width / 2, y: canvas.top + canvas.height / 2 };
    setPicker({ mode: "blank", x: Math.max(12, canvas.width / 2 - 170), y: 72, position: engineRef.current?.screenToFlowPosition(client) ?? { x: 280, y: 160 } });
  }, []);

  // Display-only edges: attach the inline "+" affordance to what the canvas renders without ever
  // mutating the saved `edges` (callbacks must not be serialized). Only straight edges (source ≠
  // target) get an add button; self-loops render via SelfLoopEdge.
  const edgesForCanvas = useMemo<ScenarioEdge[]>(
    () =>
      edges.map((edge) => ({
        ...edge,
        // Reflect connector selection on the canvas (the `.is-selected` highlight) — previously the
        // properties drawer opened but the connector itself was never visibly highlighted.
        selected: edge.id === selectedEdgeId,
        data: {
          ...(edge.data ?? { linkType: "success", label: "success", expression: "" }),
          showAddButton: edge.source !== edge.target,
          onInsertNode: openEdgePicker
        } as ScenarioLinkData
      })),
    [edges, openEdgePicker, selectedEdgeId]
  );

  // Select a flow node from its kebab "Configure" action — opens the right properties drawer
  // (mirrors onNodeClick). removeFlow is referenced lazily below so it isn't read before its
  // declaration.
  const selectFlowNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
    setWorkflowSettingsOpen(false);
    setRightPanelCollapsed(false);
  }, []);

  // Identity-preserving so editing / dragging one flow node rebuilds only that node's wrapper —
  // unchanged nodes keep object identity and the memoized NodeContainer skips them.
  const interactiveNodesStore = useRef(createIdentityStore<ScenarioNode, ScenarioNode>()).current;
  const interactiveNodesForCanvas = useMemo(() => {
    const sources = new Set(edges.filter((edge) => edge.source !== edge.target).map((edge) => edge.source));
    const loopSources = new Set(edges.filter((edge) => edge.source === edge.target && edge.data?.linkType === "loop").map((edge) => edge.source));
    return mapWithIdentity(
      interactiveNodesStore,
      nodes,
      [openAppendPicker, selectFlowNode, toggleNodeLoop],
      // Fold selection into the identity signature so selecting/deselecting a node rebuilds only the
      // affected cards (and their `.selected` highlight) — not the whole graph.
      (node) => `${sources.has(node.id) ? 1 : 0}${loopSources.has(node.id) ? 1 : 0}${node.id === selectedNodeId ? "S" : ""}`,
      (node) => ({
        ...node,
        selected: node.id === selectedNodeId,
        data: {
          ...node.data,
          isLeaf: !sources.has(node.id),
          hasLoop: loopSources.has(node.id),
          onAppendFlow: openAppendPicker,
          onConfigure: selectFlowNode,
          onDeleteFlow: (nodeId: string) => removeFlow(nodeId),
          onToggleLoop: toggleNodeLoop
        }
      })
    );
  }, [edges, nodes, selectedNodeId, openAppendPicker, selectFlowNode, toggleNodeLoop, interactiveNodesStore]);

  const addFlow = useCallback(
    (flowId: string, position?: { x: number; y: number }) => {
      const flowCount = nodes.filter((node) => node.data.kind === "flowRef").length;
      const nextOrder = flowCount + 1;
      const node = createScenarioNode(flowId, nextOrder, position ?? { x: 280, y: 160 + flowCount * 190 }, true, undefined, flowLibrary);
      setNodes((currentNodes) => [...currentNodes, node]);
      setSaveState("Unsaved changes");
    },
    [nodes, setNodes, flowLibrary]
  );

  // Flow Logic actions (Add menu › Flow Logic). These map onto AWKIT's existing connector kinds
  // rather than inventing a new model: Conditional/Parallel branch the *selected* flow to up to two
  // available saved flows via conditional/parallel connectors; Loop toggles the node's self-loop
  // connector (the same edit as the kebab). A valid source flow node is required — otherwise the
  // user is guided with a toast and no invalid/disconnected graph is created.
  const applyWorkflowLogic = useCallback(
    (logic: "condition" | "parallel" | "loop", state: WorkflowPickerState | null) => {
      const sourceId =
        state?.mode === "append"
          ? state.sourceId
          : state?.mode === "edge"
            ? edges.find((edge) => edge.id === state.edgeId)?.source ?? null
            : selectedNodeId;
      const source = sourceId ? nodes.find((node) => node.id === sourceId) : null;
      if (!source) {
        setToast({ tone: "error", message: "Select a flow node on the canvas first, then choose a Flow Logic action." });
        return;
      }
      if (logic === "loop") {
        if (source.data.kind !== "flowRef") {
          setToast({ tone: "error", message: "Loop connectors attach to a flow. Select a flow node (not Start/End) first." });
          return;
        }
        toggleNodeLoop(source.id);
        setSelectedNodeId(source.id);
        setSelectedEdgeId(null);
        setToast({ tone: "success", message: `Loop connector toggled on "${source.data.name}".` });
        return;
      }
      const targets = availableFlows.slice(0, 2);
      if (targets.length === 0) {
        setToast({
          tone: "error",
          message: "Add more saved flows to this workflow first — a branch connects the selected flow to other flows."
        });
        return;
      }
      const linkType: ScenarioLink["type"] = logic === "condition" ? "conditional" : "parallel";
      const labels = logic === "condition" ? ["If true", "If false"] : ["Branch A", "Branch B"];
      const baseOrder = source.data.kind === "flowRef" ? source.data.order : 0;
      const newNodes = targets.map((flow, index) =>
        createScenarioNode(
          flow.flowId,
          baseOrder + index + 1,
          {
            x: source.position.x + (index - (targets.length - 1) / 2) * 260,
            y: source.position.y + 200
          },
          true,
          undefined,
          flowLibrary
        )
      );
      const newEdges = targets.map((flow, index) => createScenarioEdge(source.id, flow.flowId, linkType, { label: labels[index] }));
      setNodes((current) => normalizeOrders([...current, ...newNodes]));
      setEdges((current) => reconcileScenarioBranches([...current, ...newEdges]));
      setSelectedNodeId(null);
      setSelectedEdgeId(newEdges[0].id);
      if (rightPanelCollapsed) persistRightPanel(false);
      setSaveState("Unsaved changes");
      setToast({
        tone: "success",
        message: `${logic === "condition" ? "Conditional" : "Parallel"} branch added from "${source.data.name}" (${targets.length} path${targets.length === 1 ? "" : "s"}). Edit the connectors in the drawer.`
      });
    },
    [edges, nodes, selectedNodeId, availableFlows, flowLibrary, toggleNodeLoop, setNodes, setEdges, rightPanelCollapsed, persistRightPanel]
  );

  const handlePickerPick = useCallback((id: string) => {
    if (id === "logic-condition" || id === "logic-parallel" || id === "logic-loop") {
      applyWorkflowLogic(id === "logic-condition" ? "condition" : id === "logic-parallel" ? "parallel" : "loop", picker);
      setPicker(null);
      return;
    }
    if (!picker) return;
    if (picker.mode === "edge") insertFlowOnEdge(picker.edgeId, id);
    else if (picker.mode === "append") appendFlow(picker.sourceId, id);
    else addFlow(id, picker.position);
    setPicker(null);
  }, [addFlow, appendFlow, insertFlowOnEdge, picker, applyWorkflowLogic]);

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
          position: { x: 280, y: 120 + index * 190 }
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
      // Point 1c: workflows saved without node positions collapse/stack. Auto-arrange
      // (top-to-bottom) only when positions are missing/stacked; manual layouts are preserved.
      const builtNodes = profile.nodes.map((node, index) =>
        createScenarioNode(
          node.type === "flowRef" ? node.flowId : node.id,
          node.order,
          node.position ?? { x: 280, y: 120 + index * 190 },
          node.type === "flowRef" ? node.required : true,
          undefined,
          library,
          node.alias,
          node.size,
          node.type
        )
      );
      // Only reframe when we actually rearranged, so normal loads keep the persisted zoom.
      const needsLayout = positionsNeedLayout(builtNodes);
      if (needsLayout && builtNodes.length <= GLIDE_MAX_NODES) armLayoutGlide();
      setNodes(needsLayout ? withAutoLayout(builtNodes, profile.edges, { direction: "TB", force: true }) : builtNodes);
      setEdges(reconcileScenarioBranches(profile.edges.map((link) => createScenarioEdge(link.source, link.target, link.type, link))));
      if (needsLayout) window.requestAnimationFrame(() => engineRef.current?.fitView({ padding: 0.2, duration: 200 }));
      setSaveState("Loaded");
      pendingSnapshot.current = true; // recapture the dirty baseline once the loaded workflow settles
      window.playwrightFlowStudio.settings
        .update({ selectedBuilderWorkflowId: profile.id, selections: { lastSelectedWorkflowId: profile.id } })
        .catch(() => undefined);
    },
    [flowLibrary, setEdges, setNodes, armLayoutGlide]
  );

  // Point 1c: manual "Auto-arrange" — re-run the layered layout (top-to-bottom) on demand, then
  // frame it. Marks the document dirty; positions stay user-editable after.
  const autoArrange = useCallback(() => {
    if (nodes.length <= GLIDE_MAX_NODES) armLayoutGlide();
    setNodes((currentNodes) => withAutoLayout(currentNodes, edges.map((edge) => ({ source: edge.source, target: edge.target })), { direction: "TB", force: true }));
    setSaveState("Unsaved changes");
    window.requestAnimationFrame(() => engineRef.current?.fitView({ padding: 0.2, duration: 200 }));
  }, [edges, nodes, setNodes, armLayoutGlide]);

  // Points 6/7: create a named workflow from the "New" prompt, persist it, then load it into the
  // builder — the same flow the Workflows library uses (createBlankWorkflowProfile), so both entry
  // points produce and land on an identical saved workflow.
  const createNamedWorkflow = useCallback(
    async (name: string) => {
      setNamingWorkflow(false);
      const profile = createBlankWorkflowProfile(name);
      try {
        await window.playwrightFlowStudio.workflows.create(profile);
        setWorkflows(await window.playwrightFlowStudio.workflows.list());
        loadWorkflowProfile(profile);
        setSaveState("Saved");
        setToast({ tone: "success", message: `Workflow created: ${name}` });
      } catch (error) {
        setToast({ tone: "error", message: `Failed to create workflow. ${error instanceof Error ? error.message : ""}`.trim() });
      }
    },
    [loadWorkflowProfile]
  );

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

  const isDirty = savedSnapshot !== "" && docSnapshot !== savedSnapshot;

  const handlePaneClick = useCallback(() => {
    setSelectedEdgeId(null);
    setSelectedNodeId(null);
    setPicker(null);
    setWorkflowSettingsOpen(false);
    setRightPanelCollapsed(true);
  }, []);

  // Stable canvas callbacks: inline arrows gave every node a fresh callback reference on each
  // page render (save-state text, selection, panel toggles), re-rendering the whole memoized
  // node subtree unnecessarily. These bail the memo on unrelated re-renders.
  const handleNodePositionChange = useCallback(
    (id: string, position: { x: number; y: number }) => {
      setNodes((current) => current.map((node) => (node.id === id ? { ...node, position } : node)));
      setSaveState("Unsaved changes");
    },
    [setNodes]
  );
  // Issue 4 (flowforge parity): dragging one flow onto another proposes connecting them. We confirm
  // first (so an accidental overlap doesn't silently rewire the graph), skip pairs already linked,
  // and orient the new connector top→bottom for a tidy downward flow. Reads live nodes/edges from
  // refs so the callback stays STABLE — otherwise it re-creates every edit and (via the engine's
  // drag-stop handler) re-renders every node wrapper (perf regression).
  const nodesLiveRef = useRef(nodes);
  nodesLiveRef.current = nodes;
  const edgesLiveRef = useRef(edges);
  edgesLiveRef.current = edges;
  const handleNodeConnect = useCallback((aId: string, bId: string) => {
    const a = nodesLiveRef.current.find((node) => node.id === aId);
    const b = nodesLiveRef.current.find((node) => node.id === bId);
    if (!a || !b) return;
    if (edgesLiveRef.current.some((edge) => (edge.source === aId && edge.target === bId) || (edge.source === bId && edge.target === aId))) return;
    const [src, tgt] = a.position.y <= b.position.y ? [a, b] : [b, a];
    if (tgt.data.kind === "start" || src.data.kind === "end") return; // don't point into Start / out of End
    setConnectPrompt({ source: src.id, target: tgt.id, sourceName: src.data.name, targetName: tgt.data.name });
  }, []);
  const confirmConnect = useCallback(() => {
    if (!connectPrompt) return;
    const linkType: ScenarioLink["type"] = connectPrompt.source === "start" ? "always" : "success";
    setEdges((current) => reconcileScenarioBranches([...current, createScenarioEdge(connectPrompt.source, connectPrompt.target, linkType)]));
    setSaveState("Unsaved changes");
    setToast({ tone: "success", message: `Connected "${connectPrompt.sourceName}" → "${connectPrompt.targetName}".` });
    setConnectPrompt(null);
  }, [connectPrompt, setEdges]);
  const handleEdgeClick = useCallback(
    (id: string) => {
      setSelectedEdgeId(id);
      setSelectedNodeId(null);
      setWorkflowSettingsOpen(false);
      if (rightPanelCollapsed) persistRightPanel(false);
      window.playwrightFlowStudio.settings.update({ selections: { lastSelectedConnectorId: id } }).catch(() => undefined);
    },
    [rightPanelCollapsed, persistRightPanel]
  );
  const handleNodeClick = useCallback((id: string) => {
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
    setWorkflowSettingsOpen(false);
    setRightPanelCollapsed(false);
  }, []);
  const handleNodeDoubleClick = useCallback(
    (id: string) => {
      const node = nodes.find((item) => item.id === id);
      if (node?.data.kind === "flowRef") void openFlowInDesigner(node.data.flowId);
    },
    [nodes, openFlowInDesigner]
  );
  const handleBuilderMoveEnd = useCallback(
    (viewport: Viewport) => persistBuilderZoom(Math.round(viewport.zoom * 100)),
    [persistBuilderZoom]
  );

  // Top header exposes only Save (New moved to the toolbar with a name prompt; Run removed).
  usePageChrome(
    {
      actions: [
        { id: "save", label: "Save", variant: "primary", onClick: () => saveScenario(), title: canSaveWorkflow ? "Save this workflow" : "Requires the Edit Workflows permission", disabled: !canSaveWorkflow }
      ],
      dirty: isDirty
    },
    [saveScenario, isDirty, canSaveWorkflow]
  );

  return (
    <section className="page scenario-builder-page">
      {/* Phase 02 + UI-repair pass: grouped single-row toolbar. Save/Run live in the top app header;
          zoom/fit live in the canvas zoom pill. Controls are organized into labeled groups
          (Workflow · Add · Execution · Layout) with separators, then a right-aligned status area. */}
      <section className="scenario-toolbar scenario-toolbar-compact">
        {/* Group 1 — Workflow: select / name / new / reload / settings / export */}
        <div className="sb-toolbar-group" role="group" aria-label="Workflow">
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

          <button className="toolbar-button" id="sb-new" onClick={() => setNamingWorkflow(true)} title="Create a new named workflow" type="button">
            <FilePlus size={14} />
            New
          </button>
          <button className="toolbar-button" id="sb-reload" disabled onClick={() => void loadScenario()} title="Reload this workflow from the last saved copy" type="button">
            <FolderOpen size={14} />
            Reload
          </button>
          <button
            className="toolbar-button"
            id="sb-workflow-settings"
            title="Edit workflow data source & failure policy"
            onClick={() => {
              setWorkflowSettingsOpen(true);
              setSelectedNodeId(null);
              setSelectedEdgeId(null);
              setRightPanelCollapsed(false);
            }}
            type="button"
          >
            <Database size={14} />
            Settings
          </button>
          <button className="toolbar-button" id="sb-export" onClick={exportScenario} title="Export this workflow as JSON" type="button">
            <Download size={14} />
            Export
          </button>
        </div>

        <span className="sb-toolbar-sep" aria-hidden="true" />

        {/* Group 2 — Add: single Add Flow entry (its menu also hosts the Flow Logic section) */}
        <div className="sb-toolbar-group" role="group" aria-label="Add">
          <button className="toolbar-button primary" id="sb-add-flow" onClick={openToolbarPicker} title="Add a flow or a conditional / parallel / loop branch" type="button">
            <Plus size={14} />
            Add
          </button>
        </div>

        <span className="sb-toolbar-sep" aria-hidden="true" />

        {/* Group 3 — Execution: run mode + parallelism */}
        <div className="sb-toolbar-group" role="group" aria-label="Execution">
          <label className="sb-toolbar-field">
            <span>Mode</span>
            <select disabled value={executionMode} onChange={(event) => setExecutionMode(event.target.value as ScenarioProfile["executionMode"])}>
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
              disabled
              min="1"
              style={{ width: "58px" }}
              type="number"
              value={maxParallelFlows}
              onChange={(event) => setMaxParallelFlows(Number(event.target.value))}
            />
          </label>
        </div>

        <span className="sb-toolbar-sep" aria-hidden="true" />

        {/* Group 4 — Layout */}
        <div className="sb-toolbar-group" role="group" aria-label="Layout">
          <button className="toolbar-button" id="sb-auto-arrange" onClick={autoArrange} title="Auto-arrange flows (top-to-bottom)" type="button">
            <LayoutGrid size={14} />
            Auto-arrange
          </button>
        </div>

        {/* Right-aligned status: validation summary + save state */}
        <div className="sb-toolbar-actions" role="status">
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
      <div className="scenario-builder-grid">

        {/* LEFT PANEL */}
        {false && (leftPanelCollapsed ? (
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
        ))}

        {/* CANVAS */}
        <section ref={canvasRef} className="scenario-canvas-panel">
          {nodes.length === 0 ? (
            <div className="scenario-canvas-empty">
              <strong>No flows added to this workflow yet.</strong>
              <span>Select saved flows from the left panel to build your workflow.</span>
            </div>
          ) : null}
          <FlowCanvas
            ref={engineRef}
            className={layoutGliding ? "flow-animating" : undefined}
            edges={edgesForCanvas}
            edgeTypes={edgeTypes}
            nodeTypes={nodeTypes}
            nodes={interactiveNodesForCanvas}
            onNodePositionChange={handleNodePositionChange}
            onNodeConnect={handleNodeConnect}
            onEdgeClick={handleEdgeClick}
            onPaneClick={handlePaneClick}
            onPaneContextMenu={openBlankPicker}
            onNodeClick={handleNodeClick}
            onNodeDoubleClick={handleNodeDoubleClick}
            onMoveEnd={handleBuilderMoveEnd}
          >
            {/* Reference-parity canvas chrome: dotted grid + bottom-center glass toolbar only
                (no React Flow Controls / MiniMap, matching the Workflow reference). */}
            <Background gap={22} size={2} color="var(--awkit-canvas-dot)" />
            <CanvasZoomControl onPersist={persistBuilderZoom} />
          </FlowCanvas>
          <CanvasItemPicker
            open={Boolean(picker)}
            title="Workflow Definition"
            searchPlaceholder="Search saved flows..."
            items={pickerItems}
            x={picker?.x ?? 0}
            y={picker?.y ?? 0}
            onPick={handlePickerPick}
            onClose={() => setPicker(null)}
            footer={
              availableFlows.length > flowVisibleCount ? (
                <button className="toolbar-button" type="button" onClick={() => setFlowVisibleCount((count) => count + SAVED_FLOWS_PAGE_SIZE)}>
                  Load More ({availableFlows.length - flowVisibleCount} remaining)
                </button>
              ) : <span>{availableFlows.length ? `${availableFlows.length} saved flows available` : "Create a flow in Flow Designer first."}</span>
            }
          />
        </section>

        {/* RIGHT PANEL — Phase 01: Collapsible */}
        {rightPanelCollapsed ? (false &&
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
                <h2 style={{ margin: 0, flex: 1 }}>
                  {selectedNode?.data.kind === "flowRef" ? "Flow Configuration" : workflowSettingsOpen ? "Workflow Settings" : "Connector Configuration"}
                </h2>
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
              {selectedNode?.data.kind === "flowRef" ? (
                <>
                  <label>
                    Flow
                    <input value={selectedNode.data.name} onChange={(event) => updateNodeData(selectedNode.id, { name: event.target.value })} />
                  </label>
                  <label>
                    Execution order
                    <input min="1" type="number" value={selectedNode.data.order} onChange={(event) => reorderFlow(selectedNode.id, Number(event.target.value))} />
                  </label>
                  <label className="inline-check">
                    <input checked={selectedNode.data.required} type="checkbox" onChange={(event) => updateNodeData(selectedNode.id, { required: event.target.checked })} />
                    Required flow
                  </label>
                  <button className="toolbar-button danger" type="button" onClick={() => removeFlow(selectedNode.id)}>
                    <Trash2 size={14} /> Remove flow
                  </button>
                </>
              ) : workflowSettingsOpen ? (
                <>
                  <label>
                    Data Source
                    <select value={workflowDataSourceId} onChange={(event) => setWorkflowDataSourceId(event.target.value)}>
                      <option value="">None</option>
                      {dataSources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
                    </select>
                  </label>
                  <label>
                    Root Array Path
                    <input value={workflowRootArrayPath} onChange={(event) => setWorkflowRootArrayPath(event.target.value)} placeholder="$.customers" />
                  </label>
                  <label className="inline-check">
                    <input checked={failurePolicy.stopOnRequiredFlowFailure} type="checkbox" onChange={(event) => setFailurePolicy((current) => ({ ...current, stopOnRequiredFlowFailure: event.target.checked }))} />
                    Stop on required flow failure
                  </label>
                  <label className="inline-check">
                    <input checked={failurePolicy.continueOnOptionalFlowFailure} type="checkbox" onChange={(event) => setFailurePolicy((current) => ({ ...current, continueOnOptionalFlowFailure: event.target.checked }))} />
                    Continue optional failures
                  </label>
                  <label className="inline-check">
                    <input checked={failurePolicy.takeScreenshotOnFailure} type="checkbox" onChange={(event) => setFailurePolicy((current) => ({ ...current, takeScreenshotOnFailure: event.target.checked }))} />
                    Screenshot on failure
                  </label>
                </>
              ) : selectedEdge ? (
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

            {selectedEdge ? <section>
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
            </section> : null}

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
      {namingWorkflow ? (
        <PromptDialog
          title="New Workflow"
          message="Name your workflow. It opens in the Workflow Builder with a Start and End ready to link flows."
          label="Workflow name"
          placeholder="e.g. Customer onboarding"
          initialValue="New Workflow"
          confirmLabel="Create Workflow"
          onConfirm={(name) => void createNamedWorkflow(name)}
          onCancel={() => setNamingWorkflow(false)}
        />
      ) : null}
      {connectPrompt ? (
        <ConfirmDialog
          title="Connect these flows?"
          message={`Link “${connectPrompt.sourceName}” to “${connectPrompt.targetName}” so they run as one connected flow.`}
          confirmLabel="Connect"
          icon="connect"
          onConfirm={confirmConnect}
          onCancel={() => setConnectPrompt(null)}
        />
      ) : null}
    </section>
  );
}

export function ScenarioBuilder() {
  return <ScenarioBuilderContent />;
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
  size?: { width: number; height: number },
  kind: ScenarioFlowNodeData["kind"] = "flowRef"
): ScenarioNode {
  const libraryItem = library.find((flow) => flow.flowId === flowId) ?? {
    flowId,
    name: flowId,
    description: kind === "start" ? "Workflow entry point" : kind === "end" ? "Workflow complete" : "Imported flow",
    outputs: [],
    inputs: []
  };

  const width = size?.width ?? SCENARIO_NODE_DEFAULT_WIDTH;
  const height = size?.height ?? SCENARIO_NODE_DEFAULT_HEIGHT;

  return {
    id: flowId,
    type: "scenarioFlow",
    position,
    data: {
      kind,
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
  return {
    id: link?.id ?? `edge-${source}-${target}`,
    source,
    target,
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
 * Branch-pair invariant (FR-2.6), identical to the Flow Designer's `reconcileFlowBranches`: when a
 * node named in `revertSources` is left holding exactly one conditional/parallel connector — the
 * flow it paired with was just removed — the survivor collapses back to a normal connector. The
 * port-slotting this function also used to do died with the two-port node model; the semantics live
 * in `components/shared/branchPairs.ts` so both editors and a verifier share one implementation.
 */
function reconcileScenarioBranches(edges: ScenarioEdge[], revertSources?: Set<string>): ScenarioEdge[] {
  return revertLoneBranchConnectors(edges, {
    kindOf: (edge) => scenarioEdgeKind(edge.data?.linkType),
    toNormal: scenarioEdgeToNormal,
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
  const kindOf = (edge: ScenarioEdge): string => scenarioEdgeKind(edge.data?.linkType);

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

  // FR-2.6: a lone conditional/parallel connector with no fallback (mirrors the Flow Designer).
  incompleteBranchPairs(edges, kindOf).forEach(({ source, kind }) => {
    messages.push(incompleteBranchPairMessage(nodeName(source), kind));
  });

  return messages;
}

function normalizeOrders(nodes: ScenarioNode[]): ScenarioNode[] {
  const flows = nodes.filter((node) => node.data.kind === "flowRef").sort((a, b) => a.data.order - b.data.order);
  const flowOrder = new Map(flows.map((node, index) => [node.id, index + 1]));
  return nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      order: node.data.kind === "start" ? 0 : node.data.kind === "end" ? flows.length + 1 : flowOrder.get(node.id) ?? node.data.order
    }
  }));
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
    nodes: orderedNodes.map((node) => node.data.kind === "flowRef" ? ({
        id: node.id,
        type: "flowRef" as const,
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
        failurePolicy: failurePolicy.stopOnRequiredFlowFailure ? "stop" as const : "continue" as const,
        position: node.position,
        size: { width: Math.round(node.data.width), height: Math.round(node.data.height) }
      }) : ({
        id: node.id,
        type: node.data.kind,
        alias: node.data.name,
        order: node.data.order,
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
