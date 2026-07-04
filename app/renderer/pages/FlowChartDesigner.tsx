import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  reconnectEdge,
  type Connection,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
  useEdgesState,
  useNodesState,
  useReactFlow
} from "@xyflow/react";
import { FolderOpen, PanelLeftClose, PanelLeftOpen, Search, ShieldCheck, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionFlowNode } from "../components/workflow/ActionFlowNode";
import { CanvasZoomControl } from "../components/workflow/CanvasZoomControl";
import { ConnectionPropertiesPanel, type FlowConnectionData } from "../components/workflow/ConnectionPropertiesPanel";
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
import { SearchableSelect } from "../components/shared/SearchableSelect";
import { FlowNodePropertiesPanel } from "../components/workflow/FlowNodePropertiesPanel";
import { flowNodeCatalog, getFlowNodeCatalogItem } from "../components/workflow/flowNodeCatalog";
import { getNodeDefinition } from "../components/workflow/flowNodeRegistry";
import { DEFAULT_NODE_HEIGHT, DEFAULT_NODE_WIDTH, defaultNodeData, type FlowDesignerNodeData } from "../components/workflow/flowDesignerTypes";
import { DesignerCanvasLayout } from "../layout/DesignerCanvasLayout";
import { Toast, type ToastState } from "../components/shared/Toast";
import { usePageChrome } from "../state/pageChrome";
import { useNavigation } from "../state/navigation";
import type { ConnectorKind, EdgeVisualStyle, FlowEdge, FlowEdgeType, FlowProfile, FlowStep, NodeConfig, StepType, ValueSource } from "@src/profiles/FlowProfile";
import { connectorKind } from "@src/profiles/FlowProfile";

const nodeTypes = {
  actionNode: ActionFlowNode
} satisfies NodeTypes;

const edgeTypes = {
  circular: SelfLoopEdge
} satisfies EdgeTypes;

type FlowDesignerNode = Node<FlowDesignerNodeData, "actionNode">;
type FlowDesignerEdge = Edge<FlowConnectionData>;

const initialNodes: FlowDesignerNode[] = [
  {
    id: "start",
    type: "actionNode",
    position: { x: 280, y: 70 },
    data: defaultNodeData("start", "Start", "Entry point")
  },
  {
    id: "open-login",
    type: "actionNode",
    position: { x: 280, y: 190 },
    data: {
      ...defaultNodeData("goto", "Open Login Page", "Navigate to the login screen"),
      value: "${BASE_URL}/login"
    }
  },
  {
    id: "fill-username",
    type: "actionNode",
    position: { x: 280, y: 310 },
    data: {
      ...defaultNodeData("fill", "Fill Username", "Use environment username"),
      locatorStrategy: "id",
      locatorValue: "username",
      valueSourceType: "env",
      value: "USERNAME"
    }
  },
  {
    id: "click-login",
    type: "actionNode",
    position: { x: 280, y: 430 },
    data: {
      ...defaultNodeData("click", "Click Login", "Submit the login form"),
      locatorStrategy: "role",
      locatorValue: "button",
      locatorName: "Login"
    }
  },
  {
    id: "end",
    type: "actionNode",
    position: { x: 280, y: 550 },
    data: defaultNodeData("end", "End", "Flow complete")
  }
];

const initialEdges: FlowDesignerEdge[] = [
  createEdge("start", "open-login", "always"),
  createEdge("open-login", "fill-username", "success"),
  createEdge("fill-username", "click-login", "success"),
  createEdge("click-login", "end", "success")
];

function createEdge(
  source: string,
  target: string,
  linkType: FlowEdgeType,
  label?: string,
  expression?: string,
  style?: EdgeVisualStyle,
  maxLoopCount?: number,
  extra?: Partial<FlowConnectionData>
): FlowDesignerEdge {
  const resolvedLabel = label ?? linkType;
  const kind = extra?.kind ?? connectorKind({ type: linkType });
  const { sourceHandle, targetHandle } = portHandlesForKind(kind);
  return {
    id: `edge-${source}-${target}`,
    source,
    target,
    sourceHandle,
    targetHandle,
    reconnectable: true,
    ...buildConnectorVisual(linkType, style),
    data: { linkType, label: resolvedLabel, expression: expression ?? "", style, maxLoopCount, ...extra },
    label: resolvedLabel
  };
}

/** Structured kind of a Flow Designer edge (data.kind, or derived from its legacy linkType). */
function flowEdgeKind(edge: FlowDesignerEdge): string {
  return edge.data?.kind ?? connectorKind({ type: edge.data?.linkType ?? "success" });
}

/**
 * Enforce the branch-connector invariants on the Flow Designer edges: slot each node's
 * conditional/parallel pair to distinct right-side ports, and (for `revertSources`) collapse a
 * lone surviving branch connector back to a normal connector. See `reconcileBranchConnectors`.
 */
function reconcileFlowBranches(edges: FlowDesignerEdge[], revertSources?: Set<string>): FlowDesignerEdge[] {
  return reconcileBranchConnectors(edges, {
    kindOf: flowEdgeKind,
    slotAssign: (edge, kind, slot) => ({ ...edge, sourceHandle: branchSourceHandle(kind, slot), targetHandle: `${kind}-in` }),
    toNormal: (edge) => ({
      ...edge,
      sourceHandle: "normal-out",
      targetHandle: "normal-in",
      ...buildConnectorVisual("success", edge.data?.style),
      data: { ...edge.data, linkType: "success", kind: "normal", conditional: undefined, parallel: undefined },
      label: edge.data?.label?.trim() ? edge.data.label : "success"
    }),
    revertSources
  });
}

/** Apply the node's stored width/height to its React Flow style so it renders at that size. */
function styledNode(node: FlowDesignerNode): FlowDesignerNode {
  return { ...node, style: { ...node.style, width: node.data.width, height: node.data.height } };
}

/**
 * Order-independent serialization of the saveable flow document. Used to detect
 * real unsaved changes (vs transient UI state like selection, zoom, or React
 * Flow node-measurement/elevation reordering).
 */
function serializeFlowDoc(profile: FlowProfile): string {
  return JSON.stringify({
    name: profile.name,
    nodes: [...profile.nodes].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...profile.edges].sort((a, b) => a.id.localeCompare(b.id))
  });
}

function FlowChartDesignerContent() {
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowDesignerNode>(initialNodes.map(styledNode));
  const defaultNodeSize = useRef({ width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT });
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowDesignerEdge>(initialEdges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>("open-login");
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [savedFlows, setSavedFlows] = useState<FlowProfile[]>([]);
  const [flowId, setFlowId] = useState("login-flow");
  const [flowName, setFlowName] = useState("Login Flow");
  const [saveState, setSaveState] = useState("Loading…");
  const [dataSources, setDataSources] = useState<{ id: string; name: string }[]>([]);
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(false);
  const [paletteWidth, setPaletteWidth] = useState(224);
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const [paletteSearch, setPaletteSearch] = useState("");
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const pendingSnapshot = useRef(true);
  const [toast, setToast] = useState<ToastState | null>(null);
  const reactFlow = useReactFlow<FlowDesignerNode, FlowDesignerEdge>();
  const navigation = useNavigation();

  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId) ?? null, [nodes, selectedNodeId]);
  const selectedEdge = useMemo(() => edges.find((edge) => edge.id === selectedEdgeId) ?? null, [edges, selectedEdgeId]);
  const validationMessages = useMemo(() => validateFlow(nodes, edges), [nodes, edges]);
  const flowProfile = useMemo(() => toFlowProfile(nodes, edges, flowId, flowName), [edges, flowId, flowName, nodes]);
  // Points 2–4: connector-structure issues block Save until fixed (subset of validationMessages).
  const connectorIssues = useMemo(
    () => connectorStructureIssues(edges, (id) => nodes.find((node) => node.id === id)?.data.name ?? id),
    [edges, nodes]
  );

  // Point 1: extra ports render only on nodes actually touched by a conditional/parallel connector.
  const portFlagsByNode = useMemo(
    () => computePortFlags(edges.map((edge) => ({ source: edge.source, target: edge.target, kind: edge.data?.kind ?? connectorKind({ type: edge.data?.linkType ?? "success" }) }))),
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
      if (edge.source === edge.target && (edge.data?.kind ?? connectorKind({ type: edge.data?.linkType ?? "success" })) === "loop") {
        set.add(edge.source);
      }
    });
    return set;
  }, [edges]);

  // Node Palette search: filter by label / type / description / category (Task 04).
  const filteredCatalog = useMemo(() => {
    const query = paletteSearch.trim().toLowerCase();
    if (!query) return flowNodeCatalog;
    return flowNodeCatalog.filter((item) => {
      const category = getNodeDefinition(item.type).category;
      return (
        item.label.toLowerCase().includes(query) ||
        item.type.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query) ||
        category.toLowerCase().includes(query)
      );
    });
  }, [paletteSearch]);

  // Dirty only when the saveable document differs from the last saved/loaded snapshot.
  const docSnapshot = useMemo(() => serializeFlowDoc(flowProfile), [flowProfile]);
  const isDirty = savedSnapshot !== "" && docSnapshot !== savedSnapshot;
  useEffect(() => {
    if (pendingSnapshot.current) {
      pendingSnapshot.current = false;
      setSavedSnapshot(docSnapshot);
    }
  }, [docSnapshot]);

  useEffect(() => {
    // Load flows + settings together so we can honor the persisted/last-opened flow
    // (e.g. when the Workflow Builder double-clicks a node to open it here — Task 01).
    void (async () => {
      try {
        const [profiles, settings] = await Promise.all([
          window.playwrightFlowStudio.flows.list(),
          window.playwrightFlowStudio.settings.get()
        ]);
        setSavedFlows(profiles);

        setPropertiesCollapsed(settings.flowDesignerPropertiesCollapsed);
        setPaletteWidth(settings.flowDesignerPaletteWidth);
        setPaletteCollapsed(settings.flowDesignerPaletteCollapsed);
        defaultNodeSize.current = {
          width: settings.designerDefaults.defaultNodeWidth || DEFAULT_NODE_WIDTH,
          height: settings.designerDefaults.defaultNodeHeight || DEFAULT_NODE_HEIGHT
        };
        const zoomPercent = settings.flowDesignerZoomPercent > 0 ? settings.flowDesignerZoomPercent : settings.designerDefaults.defaultZoomPercent;
        reactFlow.zoomTo(zoomPercent / 100);

        // Task 4: restore the last opened Flow Designer flow. If that saved reference is stale
        // (the flow was deleted), clear it so we don't keep pointing at a missing flow, then fall
        // back to the first available flow (or the empty state when none exist).
        const requestedId = settings.selections.lastSelectedFlowId;
        if (requestedId && !profiles.some((profile) => profile.id === requestedId)) {
          window.playwrightFlowStudio.settings.update({ selections: { lastSelectedFlowId: null } }).catch(() => undefined);
        }
        const active =
          profiles.find((profile) => profile.id === requestedId) ??
          profiles.find((profile) => profile.id === flowId) ??
          profiles[0];
        if (active) loadProfile(active);
        else setSaveState("No saved flows");
      } catch {
        setSaveState("Unable to load saved flows");
      }
    })();

    window.playwrightFlowStudio.dataSources
      .list()
      .then((sources) => setDataSources(sources.map((source) => ({ id: source.id, name: source.name }))))
      .catch(() => undefined);
  }, []);

  const togglePropertiesCollapsed = useCallback(() => {
    setPropertiesCollapsed((current) => {
      const next = !current;
      window.playwrightFlowStudio.settings.update({ flowDesignerPropertiesCollapsed: next }).catch(() => undefined);
      return next;
    });
  }, []);

  const startPaletteResize = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = paletteWidth;
      const onMove = (moveEvent: MouseEvent) => {
        const next = Math.min(480, Math.max(220, startWidth + (moveEvent.clientX - startX)));
        setPaletteWidth(next);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        setPaletteWidth((width) => {
          window.playwrightFlowStudio.settings.update({ flowDesignerPaletteWidth: width }).catch(() => undefined);
          return width;
        });
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [paletteWidth]
  );

  const resetPaletteWidth = useCallback(() => {
    setPaletteWidth(224);
    window.playwrightFlowStudio.settings.update({ flowDesignerPaletteWidth: 224 }).catch(() => undefined);
  }, []);

  const persistFlowZoom = useCallback((percent: number) => {
    window.playwrightFlowStudio.settings.update({ flowDesignerZoomPercent: percent }).catch(() => undefined);
  }, []);

  const togglePaletteCollapsed = useCallback(() => {
    setPaletteCollapsed((current) => {
      const next = !current;
      window.playwrightFlowStudio.settings.update({ flowDesignerPaletteCollapsed: next }).catch(() => undefined);
      return next;
    });
  }, []);

  const updateNode = useCallback(
    (nodeId: string, data: Partial<FlowDesignerNodeData>) => {
      setNodes((currentNodes) =>
        currentNodes.map((node) => {
          if (node.id !== nodeId) return node;
          const nextData = { ...node.data, ...data };
          // Keep the React Flow style size in sync when width/height change (e.g. Reset size).
          const style = data.width != null || data.height != null ? { ...node.style, width: nextData.width, height: nextData.height } : node.style;
          return { ...node, data: nextData, style };
        })
      );
      setSaveState("Unsaved changes");
    },
    [setNodes]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      // Point 1/2: a drag started from a conditional/parallel port creates a connector of
      // that kind (previously every new connector was forced to "normal", so the extra
      // ports rendered but had no effect).
      // Point 3: a node that already has a self-loop forces every additional outgoing
      // connector to Conditional (so the workflow can decide when to exit the loop).
      const kind: ConnectorKind = loopControlledSources.has(connection.source)
        ? "conditional"
        : connectorPortKindFromHandle(connection.sourceHandle ?? connection.targetHandle);
      // Rule 3/4: a conditional/parallel node is a two-port pair — never more than 2 same-kind
      // outgoing branch connectors.
      if (kind === "conditional" || kind === "parallel") {
        const existing = edges.filter((edge) => edge.source === connection.source && edge.source !== edge.target && flowEdgeKind(edge) === kind).length;
        if (existing >= MAX_BRANCH_CONNECTORS) return;
      }
      const linkType: FlowEdgeType = kind === "conditional" ? "conditional" : kind === "parallel" ? "parallel" : "success";
      const extra: Partial<FlowConnectionData> =
        kind === "conditional"
          ? { kind, conditional: { sourceField: "outcome", operator: "equals", expectedValue: "", priority: 0 } }
          : kind === "parallel"
            ? { kind, parallel: { joinMode: "waitAll", failMode: "failFast" } }
            : { kind };
      setEdges((currentEdges) => reconcileFlowBranches(addEdge(createEdge(connection.source!, connection.target!, linkType, undefined, undefined, undefined, undefined, extra), currentEdges)));
      setSaveState("Unsaved changes");
    },
    [setEdges, loopControlledSources, edges]
  );

  const onReconnect = useCallback(
    (oldEdge: FlowDesignerEdge, newConnection: Connection) => {
      setEdges((currentEdges) => reconnectEdge(oldEdge, newConnection, currentEdges));
      setSaveState("Unsaved changes");
    },
    [setEdges]
  );

  const updateEdgeData = useCallback(
    (edgeId: string, patch: Partial<FlowConnectionData>) => {
      setEdges((currentEdges) =>
        reconcileFlowBranches(
          currentEdges.map((edge) => {
            if (edge.id !== edgeId) return edge;
            const nextData: FlowConnectionData = { ...edge.data, ...patch } as FlowConnectionData;
            const label = nextData.label && nextData.label.trim() ? nextData.label : nextData.linkType;
            // Loop is never selectable from the panel (Rule 1); guard programmatic updates too:
            // a loop connector may only connect a node to itself.
            if (nextData.kind === "loop" && edge.source !== edge.target) {
              nextData.kind = "normal";
              delete nextData.loop;
            }
            const { sourceHandle, targetHandle } = portHandlesForKind(nextData.kind);
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

  const deleteEdge = useCallback(
    (edgeId: string) => {
      // Rule 3/4: deleting one connector of a branch pair reverts the surviving partner to a
      // normal connector (single centered port) — handled by reconcile's `revertSources`.
      setEdges((currentEdges) => {
        const source = currentEdges.find((edge) => edge.id === edgeId)?.source;
        return reconcileFlowBranches(currentEdges.filter((edge) => edge.id !== edgeId), source ? new Set([source]) : undefined);
      });
      setSelectedEdgeId(null);
      setSaveState("Unsaved changes");
    },
    [setEdges]
  );

  // Delete-key / programmatic edge removals also trigger the branch-pair revert (Rule 3/4).
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
      if (removedSources.size) setEdges((currentEdges) => reconcileFlowBranches(currentEdges, removedSources));
    },
    [edges, onEdgesChange, setEdges]
  );

  const selectNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
    window.playwrightFlowStudio.settings.update({ selections: { lastSelectedNodeId: nodeId } }).catch(() => undefined);
    // Auto-expand the properties panel when a node is selected (Phase 6E).
    setPropertiesCollapsed((collapsed) => {
      if (collapsed) {
        window.playwrightFlowStudio.settings.update({ flowDesignerPropertiesCollapsed: false }).catch(() => undefined);
        return false;
      }
      return collapsed;
    });
  }, []);

  const selectEdge = useCallback((edgeId: string) => {
    setSelectedEdgeId(edgeId);
    setSelectedNodeId(null);
    window.playwrightFlowStudio.settings.update({ selections: { lastSelectedConnectorId: edgeId } }).catch(() => undefined);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, []);

  // Task 3: clicking empty canvas clears the selection and collapses the surrounding panels
  // (app side menu, Node Palette, Node Properties) to give the canvas more room. Clicking a node
  // or connector re-opens the relevant panel via selectNode/selectEdge. Only collapse (never
  // expand) so repeated pane clicks are idempotent and don't thrash persisted settings.
  const handlePaneClick = useCallback(() => {
    clearSelection();
    setPaletteCollapsed((collapsed) => {
      if (!collapsed) window.playwrightFlowStudio.settings.update({ flowDesignerPaletteCollapsed: true }).catch(() => undefined);
      return true;
    });
    setPropertiesCollapsed((collapsed) => {
      if (!collapsed) window.playwrightFlowStudio.settings.update({ flowDesignerPropertiesCollapsed: true }).catch(() => undefined);
      return true;
    });
    navigation.collapseSidebar();
  }, [clearSelection, navigation]);

  const addNode = useCallback(
    (stepType: StepType, position = { x: 640, y: 180 }) => {
      const catalogItem = getFlowNodeCatalogItem(stepType);
      const id = `${stepType}-${Date.now().toString(36)}`;
      const node: FlowDesignerNode = styledNode({
        id,
        type: "actionNode",
        position,
        data: { ...defaultNodeData(stepType, catalogItem.label, catalogItem.description), ...defaultNodeSize.current }
      });

      setNodes((currentNodes) => [...currentNodes, node]);
      setSelectedNodeId(id);
      setSaveState("Unsaved changes");
    },
    [setNodes]
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const stepType = event.dataTransfer.getData("application/playwright-flow-node") as StepType;
      if (!stepType) return;

      const position = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addNode(stepType, position);
    },
    [addNode, reactFlow]
  );

  const saveFlow = useCallback(async () => {
    if (connectorIssues.length) {
      setToast({ tone: "error", message: `Cannot save: ${connectorIssues[0]}` });
      return;
    }
    const now = new Date().toISOString();
    try {
      const existing = await window.playwrightFlowStudio.flows.get(flowProfile.id);
      const toSave = { ...flowProfile, createdAt: existing?.createdAt ?? now, updatedAt: now };
      if (existing) {
        await window.playwrightFlowStudio.flows.update(flowProfile.id, toSave);
      } else {
        await window.playwrightFlowStudio.flows.create(toSave);
      }
      const profiles = await window.playwrightFlowStudio.flows.list();
      setSavedFlows(profiles);
      setSaveState("Saved profile");
      setSavedSnapshot(serializeFlowDoc(toSave)); // clear dirty: current document is now the saved baseline
      setToast({ tone: "success", message: `Flow saved successfully: ${toSave.name}` });
    } catch (error) {
      setSaveState("Save failed");
      setToast({ tone: "error", message: `Failed to save changes. ${error instanceof Error ? error.message : ""}`.trim() });
    }
  }, [flowProfile, connectorIssues]);

  const loadProfile = useCallback(
    (profile: FlowProfile) => {
    const nextNodes = profile.nodes.map<FlowDesignerNode>((step) =>
      styledNode({
        id: step.id,
        type: "actionNode",
        position: step.position ?? { x: 280, y: 120 },
        data: fromFlowStep(step)
      })
    );
    const nextEdges = profile.edges.map<FlowDesignerEdge>((edge) =>
      createEdge(edge.source, edge.target, edge.type, edge.label, edge.condition?.expression, edge.style, edge.maxLoopCount, {
        kind: edge.kind,
        conditional: edge.conditional,
        parallel: edge.parallel,
        loop: edge.loop
      })
    );

    setNodes(nextNodes);
    setEdges(reconcileFlowBranches(nextEdges));
    setSelectedNodeId(nextNodes[0]?.id ?? null);
    setSelectedEdgeId(null);
      setFlowId(profile.id);
      setFlowName(profile.name);
      setSaveState("Loaded profile");
      pendingSnapshot.current = true; // recapture the dirty baseline once the loaded doc settles
      window.playwrightFlowStudio.settings.update({ selections: { lastSelectedFlowId: profile.id } }).catch(() => undefined);
    },
    [setEdges, setNodes]
  );

  const loadFlow = useCallback(async () => {
    const profile = await window.playwrightFlowStudio.flows.get(flowId);
    if (!profile) {
      setSaveState("No saved profile");
      return;
    }
    loadProfile(profile);
  }, [flowId, loadProfile]);

  const deleteSelectedNode = useCallback(() => {
    if (!selectedNodeId || selectedNodeId === "start" || selectedNodeId === "end") return;

    setNodes((currentNodes) => currentNodes.filter((node) => node.id !== selectedNodeId));
    setEdges((currentEdges) => {
      // A deleted node may orphan one half of a branch pair on another node — revert survivors.
      const affectedSources = new Set(currentEdges.filter((edge) => edge.target === selectedNodeId).map((edge) => edge.source));
      return reconcileFlowBranches(
        currentEdges.filter((edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId),
        affectedSources
      );
    });
    setSelectedNodeId(null);
    setSaveState("Unsaved changes");
  }, [selectedNodeId, setEdges, setNodes]);

  const exportFlow = useCallback(() => {
    const blob = new Blob([JSON.stringify(flowProfile, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `${flowProfile.id}.json`;
    link.click();
    URL.revokeObjectURL(href);
  }, [flowProfile]);

  usePageChrome(
    {
      actions: [
        { id: "save", label: "Save", variant: "primary", onClick: () => saveFlow(), title: "Save this flow profile" },
        { id: "export", label: "Export", onClick: exportFlow, title: "Export flow as JSON" }
      ],
      dirty: isDirty
    },
    [saveFlow, exportFlow, isDirty]
  );

  return (
    <DesignerCanvasLayout
      flush
      rightCollapsed={propertiesCollapsed && !selectedEdge}
      rightPanel={
        selectedEdge ? (
          <ConnectionPropertiesPanel
            edge={selectedEdge}
            onUpdate={updateEdgeData}
            onDelete={deleteEdge}
            dataSources={dataSources}
            sourceHasLoop={loopControlledSources.has(selectedEdge.source) && selectedEdge.source !== selectedEdge.target}
          />
        ) : (
          <FlowNodePropertiesPanel
            selectedNode={selectedNode}
            validationMessages={validationMessages}
            dataSources={dataSources}
            flows={savedFlows
              .filter((flow) => flow.id !== flowId && flow.nodes.length > 2)
              .map((flow) => ({ id: flow.id, name: flow.name }))}
            collapsed={propertiesCollapsed}
            onToggleCollapsed={togglePropertiesCollapsed}
            onUpdateNode={updateNode}
          />
        )
      }
    >
      <div className="flow-designer-shell">
        <div className="flow-action-bar">
          <div className="flow-action-title">
            <strong>{flowName}</strong>
            <span>{saveState}</span>
          </div>
          <label>
            Saved Flow
            <SearchableSelect
              ariaLabel="Saved flow"
              value={flowId}
              placeholder="Select a flow…"
              options={savedFlows.map((profile) => ({ value: profile.id, label: profile.name, description: profile.id }))}
              onChange={(next) => {
                const profile = savedFlows.find((item) => item.id === next);
                if (profile) loadProfile(profile);
              }}
            />
          </label>
          <label>
            Flow Name
            <input value={flowName} onChange={(event) => setFlowName(event.target.value)} />
          </label>
          {/* Save and Export live in the top header (usePageChrome) — not duplicated here. */}
          <button className="toolbar-button" onClick={loadFlow} type="button">
            <FolderOpen size={15} />
            Load
          </button>
          <button className="toolbar-button" onClick={deleteSelectedNode} type="button">
            <Trash2 size={15} />
            Delete
          </button>
          <span className={validationMessages.length ? "validation-chip warn" : "validation-chip ok"}>
            <ShieldCheck size={14} />
            {validationMessages.length ? `${validationMessages.length} issues` : "Valid"}
          </span>
        </div>

        <div
          className="flow-designer-body"
          style={{ gridTemplateColumns: paletteCollapsed ? "44px minmax(0, 1fr)" : `${paletteWidth}px 6px minmax(0, 1fr)` }}
        >
          {paletteCollapsed ? (
            <aside className="flow-node-palette flow-node-palette-rail" aria-label="Node Palette (collapsed)">
              <button
                className="palette-collapse-btn palette-rail-expand"
                onClick={togglePaletteCollapsed}
                title="Show Node Palette"
                type="button"
              >
                <PanelLeftOpen size={16} />
              </button>
              <span className="panel-rail-label">Node Palette</span>
            </aside>
          ) : (
            <>
              <aside className="flow-node-palette">
                <div className="flow-node-palette-head">
                  <div className="palette-head-row">
                    <h2>Node Palette</h2>
                    <button
                      className="palette-collapse-btn"
                      onClick={togglePaletteCollapsed}
                      title="Collapse Node Palette"
                      type="button"
                    >
                      <PanelLeftClose size={16} />
                    </button>
                  </div>
                  <span>{filteredCatalog.length} of {flowNodeCatalog.length} step types</span>
                </div>
                <div className="palette-search">
                  <Search size={14} />
                  <input
                    value={paletteSearch}
                    placeholder="Search nodes..."
                    onChange={(event) => setPaletteSearch(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setPaletteSearch("");
                    }}
                  />
                  {paletteSearch ? (
                    <button className="palette-search-clear" type="button" title="Clear search" onClick={() => setPaletteSearch("")}>
                      <X size={13} />
                    </button>
                  ) : null}
                </div>
                <div className="palette-scroll">
                  {filteredCatalog.length === 0 ? (
                    <p className="palette-empty">No matching nodes found.</p>
                  ) : (
                    filteredCatalog.map((item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          draggable
                          key={item.type}
                          onClick={() => addNode(item.type)}
                          onDragStart={(event) => {
                            event.dataTransfer.setData("application/playwright-flow-node", item.type);
                            event.dataTransfer.effectAllowed = "move";
                          }}
                          type="button"
                        >
                          <Icon size={15} />
                          <span>
                            <strong>{item.label}</strong>
                            <small>{item.description}</small>
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </aside>

              <div
                className="palette-resize-handle"
                onMouseDown={startPaletteResize}
                onDoubleClick={resetPaletteWidth}
                title="Resize node palette (double-click to reset)"
                role="separator"
                aria-orientation="vertical"
              />
            </>
          )}

          <div className="react-flow-shell" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
            <ReactFlow
              edges={edges}
              edgeTypes={edgeTypes}
              nodeTypes={nodeTypes}
              nodes={nodesForCanvas}
              onConnect={onConnect}
              onReconnect={onReconnect}
              onEdgeClick={(_, edge) => selectEdge(edge.id)}
              onEdgesChange={handleEdgesChange}
              onNodeClick={(_, node) => selectNode(node.id)}
              onNodesChange={onNodesChange}
              onPaneClick={handlePaneClick}
              onMoveEnd={(_, viewport) => persistFlowZoom(Math.round(viewport.zoom * 100))}
            >
              <Background color="#dfe7f3" gap={24} size={1} variant={BackgroundVariant.Lines} />
              <Controls position="top-right" showZoom={false} />
              <CanvasZoomControl onPersist={persistFlowZoom} />
              <MiniMap nodeColor={(node) => nodeColor((node.data as FlowDesignerNodeData).validationState)} pannable position="bottom-right" zoomable />
            </ReactFlow>
          </div>
        </div>
      </div>
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </DesignerCanvasLayout>
  );
}

export function FlowChartDesigner() {
  return (
    <ReactFlowProvider>
      <FlowChartDesignerContent />
    </ReactFlowProvider>
  );
}

function nodeColor(validationState: FlowDesignerNodeData["validationState"]): string {
  if (validationState === "error") return "#d64545";
  if (validationState === "warning") return "#d68a00";
  return "#1769e0";
}

function validateFlow(nodes: FlowDesignerNode[], edges: FlowDesignerEdge[]): string[] {
  const messages: string[] = [];
  const startCount = nodes.filter((node) => node.data.stepType === "start").length;
  const endCount = nodes.filter((node) => node.data.stepType === "end").length;

  if (startCount !== 1) messages.push("Flow requires exactly one Start node.");
  if (endCount < 1) messages.push("Flow requires at least one End node.");

  const incoming = new Set(edges.map((edge) => edge.target));
  const outgoing = new Set(edges.map((edge) => edge.source));

  nodes.forEach((node) => {
    const catalogItem = getFlowNodeCatalogItem(node.data.stepType);
    if (node.data.stepType !== "start" && !incoming.has(node.id)) messages.push(`${node.data.name} has no incoming connector.`);
    if (node.data.stepType !== "end" && !outgoing.has(node.id)) messages.push(`${node.data.name} has no outgoing connector.`);
    if (catalogItem.requiresLocator && !node.data.locatorValue.trim()) messages.push(`${node.data.name} requires a locator value.`);
    if (node.data.locatorQuality && node.data.locatorQuality.isUnique === false) {
      messages.push(`${node.data.name} has a non-unique locator (matches ${node.data.locatorQuality.matchCount} elements) — it may fail in Playwright strict mode.`);
    }
    if (catalogItem.requiresValue && !node.data.value.trim()) messages.push(`${node.data.name} requires a value source or value.`);
  });

  // ── Connector validation (Checkpoint B) ────────────────────────────────────
  const nodeName = (id: string) => nodes.find((n) => n.id === id)?.data.name ?? id;
  edges.forEach((edge) => {
    const data = edge.data;
    if (!edge.target) {
      messages.push(`A connector from ${nodeName(edge.source)} has no target.`);
      return;
    }
    const edgeKind = data?.kind ?? (data?.linkType === "conditional" || data?.linkType === "outcome" ? "conditional" : data?.linkType === "parallel" ? "parallel" : data?.linkType === "loop" || data?.linkType === "loopBack" ? "loop" : "normal");
    if (edgeKind === "conditional" && data?.conditional) {
      const c = data.conditional;
      const needsValue = !["always", "exists", "notExists", "truthy", "falsy"].includes(c.operator);
      if (needsValue && (c.expectedValue === undefined || String(c.expectedValue).trim() === "")) {
        messages.push(`Conditional connector from ${nodeName(edge.source)} needs an expected value for operator "${c.operator}".`);
      }
      if ((c.sourceField === "variable" || c.sourceField === "dataSourceValue") && !c.variableName?.trim()) {
        messages.push(`Conditional connector from ${nodeName(edge.source)} needs a variable/path.`);
      }
    }
    if (edgeKind === "loop" && data?.loop) {
      const l = data.loop;
      if (!l.maxIterations || l.maxIterations < 1) messages.push(`Loop connector from ${nodeName(edge.source)} needs a max iterations ≥ 1.`);
      if (l.maxIterations > 1000) messages.push(`Loop connector from ${nodeName(edge.source)} max iterations is too high (limit 1000).`);
      if (l.mode === "staticList" && !(l.staticValues && l.staticValues.length)) messages.push(`Loop connector from ${nodeName(edge.source)} (static list) needs at least one value.`);
    }
  });

  // Ambiguous conditional connectors: same source + same priority + >1 match-capable.
  const condBySource = new Map<string, number[]>();
  edges.forEach((edge) => {
    if ((edge.data?.kind ?? "") === "conditional" && edge.data?.conditional) {
      const list = condBySource.get(edge.source) ?? [];
      list.push(edge.data.conditional.priority ?? 0);
      condBySource.set(edge.source, list);
    }
  });
  condBySource.forEach((priorities, source) => {
    const dupes = priorities.filter((p, i) => priorities.indexOf(p) !== i);
    if (dupes.length) messages.push(`${nodeName(source)} has multiple conditional connectors with the same priority — routing may be ambiguous.`);
  });

  messages.push(...connectorStructureIssues(edges, nodeName));

  return messages;
}

/**
 * Connector-structure rules (Points 2–4) that block Save until fixed: at most one
 * standard (non-conditional/non-parallel) outgoing connector per node, loop connectors
 * must return to the same node, and additional connectors from a loop-controlled node
 * must be Conditional. Exposed separately from `validateFlow` so `saveFlow` can gate on
 * just these structural issues without also blocking on cosmetic/locator warnings.
 */
function connectorStructureIssues(edges: FlowDesignerEdge[], nodeName: (id: string) => string): string[] {
  const messages: string[] = [];
  const kindOf = (edge: FlowDesignerEdge) => edge.data?.kind ?? connectorKind({ type: edge.data?.linkType ?? "success" });

  // Point 4: loop connectors must connect a node to itself only. The legacy `loopBack`
  // edge type (Enhanced Connectors, Phase 1) is an intentional cross-node back-edge and
  // is exempt — only the new structured `loop` kind is self-only.
  edges.forEach((edge) => {
    const isStructuredLoop = edge.data?.kind === "loop" || edge.data?.linkType === "loop";
    if (isStructuredLoop && edge.source !== edge.target) {
      messages.push(`Loop connector from ${nodeName(edge.source)} is invalid — it must return to the same node.`);
    }
  });

  // Point 2: a node cannot have more than one non-conditional/non-parallel outgoing connector.
  const outgoingBySource = new Map<string, FlowDesignerEdge[]>();
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

  // Point 3: a node with a self-loop connector must route any other outgoing connector as Conditional.
  const loopSources = new Set(edges.filter((edge) => edge.source === edge.target && kindOf(edge) === "loop").map((edge) => edge.source));
  edges.forEach((edge) => {
    if (!loopSources.has(edge.source) || edge.source === edge.target) return;
    if (kindOf(edge) !== "conditional") {
      messages.push(`Node "${nodeName(edge.source)}" has a loop connector. Additional outgoing connectors from a loop node must be Conditional.`);
    }
  });

  return messages;
}

function toFlowProfile(nodes: FlowDesignerNode[], edges: FlowDesignerEdge[], id: string, name: string): FlowProfile {
  return {
    id,
    name,
    description: "Editable reusable flow",
    version: 1,
    nodes: nodes.map((node) => toFlowStep(node, edges)),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.data?.linkType ?? "success",
      kind: edge.data?.kind,
      conditional: edge.data?.kind === "conditional" ? edge.data?.conditional : undefined,
      parallel: edge.data?.kind === "parallel" ? edge.data?.parallel : undefined,
      loop: edge.data?.kind === "loop" ? edge.data?.loop : undefined,
      label: edge.data?.label,
      condition: edge.data?.expression ? { expression: edge.data.expression } : undefined,
      style: hasCustomStyle(edge.data?.style) ? edge.data?.style : undefined,
      maxLoopCount: edge.data?.linkType === "loopBack" ? edge.data?.maxLoopCount ?? 2 : undefined
    }))
  };
}

function toFlowStep(node: FlowDesignerNode, edges: FlowDesignerEdge[]): FlowStep {
  const data = node.data;
  const catalogItem = getFlowNodeCatalogItem(data.stepType);
  const next = edges.find((edge) => edge.source === node.id)?.target;
  const valueSource = createValueSource(data);

  return {
    id: node.id,
    type: data.stepType,
    name: data.name,
    description: data.description,
    position: node.position,
    next,
    locator: catalogItem.requiresLocator
      ? {
          strategy: data.locatorStrategy,
          value: data.locatorValue,
          name: data.locatorName || undefined,
          exact: data.locatorExact || undefined,
          quality: data.locatorQuality
        }
      : undefined,
    value: data.value || undefined,
    valueSource,
    url: data.stepType === "goto" ? data.value : undefined,
    timeoutMs: data.timeoutMs,
    beforeWaits: data.beforeWaits?.length ? data.beforeWaits : undefined,
    afterWaits: data.afterWaits?.length ? data.afterWaits : undefined,
    retry: {
      count: data.retryCount,
      delayMs: data.retryDelayMs
    },
    onFailure: {
      action: data.failureAction,
      screenshot: data.screenshotOnFailure
    },
    outputs: data.outputKey ? { [data.outputKey]: { type: "text" } } : undefined,
    selectionMode: data.stepType === "select" ? data.selectionMode : undefined,
    flowId: data.stepType === "runFlow" ? data.targetFlowId || undefined : undefined,
    size: { width: Math.round(data.width), height: Math.round(data.height) },
    config: toNodeConfig(data)
  };
}

function toNodeConfig(data: FlowDesignerNodeData): NodeConfig {
  return {
    clearBeforeFill: data.clearBeforeFill,
    selectMultiple: data.selectMultiple,
    waitType: data.waitType,
    assertionType: data.assertionType,
    comparisonOperator: data.comparisonOperator,
    expectedValue: data.expectedValue || undefined,
    screenshotName: data.screenshotName || undefined,
    fullPage: data.fullPage,
    scrollTarget: data.scrollTarget,
    scrollDirection: data.scrollDirection,
    scrollAmount: data.scrollAmount,
    loopType: data.loopType,
    iterationCount: data.iterationCount,
    loopActionType: data.loopActionType,
    loopStopOnFailure: data.loopStopOnFailure,
    maxIterations: data.maxIterations,
    targetFlowId: data.targetFlowId || undefined,
    stopParentOnChildFailure: data.stopParentOnChildFailure,
    routeMode: data.stepType === "routeChange" ? data.routeMode : undefined,
    urlMatch: data.stepType === "routeChange" ? data.urlMatch : undefined,
    routeWaitUntil: data.stepType === "routeChange" ? data.routeWaitUntil : undefined,
    sessionName: data.stepType === "saveSession" ? data.sessionName || undefined : undefined,
    sessionFolder: data.stepType === "saveSession" ? data.sessionFolder || undefined : undefined,
    overwriteSession: data.stepType === "saveSession" ? data.overwriteSession : undefined,
    captureScope: data.stepType === "saveSession" ? data.captureScope : undefined,
    maskSession: data.stepType === "saveSession" ? data.maskSession : undefined,
    loginProvider: data.stepType === "protectedLoginHandoff" ? data.loginProvider : undefined,
    handoffMode: data.stepType === "protectedLoginHandoff" ? data.handoffMode : undefined,
    handoffInstructions: data.stepType === "protectedLoginHandoff" ? data.handoffInstructions || undefined : undefined,
    allowRetry: data.stepType === "protectedLoginHandoff" ? data.allowRetry : undefined,
    handoffTimeoutMs: data.stepType === "protectedLoginHandoff" ? data.handoffTimeoutMs : undefined,
    detectBeforeHandoff: data.stepType === "protectedLoginHandoff" ? data.detectBeforeHandoff : undefined,
    reuseSessionMode: data.stepType === "reuseSession" ? data.reuseSessionMode : undefined,
    reuseSessionId: data.stepType === "reuseSession" && data.reuseSessionMode === "selected" ? data.reuseSessionId || undefined : undefined
  };
}

function createValueSource(data: FlowDesignerNodeData): ValueSource | undefined {
  if (data.valueSourceType === "dynamic") {
    return {
      type: "dynamic",
      dataSourceScope: data.dataSourceScope,
      dataSourceId: data.dataSourceScope === "specific" ? data.dataSourceId || undefined : undefined,
      idMode: data.idMode,
      objectId: data.idMode === "explicit" ? data.objectId || undefined : undefined,
      keyName: data.keyName || undefined
    };
  }

  if (!data.value) return undefined;

  if (data.valueSourceType === "env") return { type: "env", envKey: data.value };
  if (data.valueSourceType === "runtimeInput") return { type: "runtimeInput", key: data.value };
  if (data.valueSourceType === "json") return { type: "json", path: data.value };
  if (data.valueSourceType === "flowOutput") return { type: "flowOutput", outputKey: data.value };
  if (data.valueSourceType === "generated") return { type: "generated", generator: data.value as ValueSource["generator"] };
  if (data.valueSourceType === "currentRow") return { type: "currentRow", path: data.value };
  if (data.valueSourceType === "instanceVariable") return { type: "instanceVariable", key: data.value };

  return { type: "static", value: data.value };
}

function fromFlowStep(step: FlowStep): FlowDesignerNodeData {
  const catalogItem = getFlowNodeCatalogItem(step.type);
  const valueSource = step.valueSource;

  return {
    ...defaultNodeData(step.type, step.name, step.description ?? catalogItem.description),
    locatorStrategy: step.locator?.strategy ?? "role",
    locatorValue: step.locator?.value ?? "",
    locatorName: step.locator?.name ?? "",
    locatorExact: step.locator?.exact ?? false,
    locatorQuality: step.locator?.quality,
    valueSourceType: valueSource?.type ?? "static",
    value: step.url ?? valueSource?.value ?? valueSource?.key ?? valueSource?.envKey ?? valueSource?.path ?? valueSource?.outputKey ?? "",
    dataSourceScope: valueSource?.dataSourceScope ?? "workflow",
    dataSourceId: valueSource?.dataSourceId ?? "",
    idMode: valueSource?.idMode ?? "instanceOrder",
    objectId: valueSource?.objectId ?? "",
    keyName: valueSource?.keyName ?? "",
    timeoutMs: step.timeoutMs ?? 10000,
    beforeWaits: step.beforeWaits ?? [],
    afterWaits: step.afterWaits ?? [],
    retryCount: step.retry?.count ?? 0,
    retryDelayMs: step.retry?.delayMs ?? 1000,
    failureAction: step.onFailure?.action ?? "stop",
    screenshotOnFailure: step.onFailure?.screenshot ?? true,
    outputKey: step.outputs ? Object.keys(step.outputs)[0] ?? "" : "",
    width: step.size?.width ?? DEFAULT_NODE_WIDTH,
    height: step.size?.height ?? DEFAULT_NODE_HEIGHT,
    clearBeforeFill: step.config?.clearBeforeFill ?? false,
    selectionMode: step.selectionMode ?? "value",
    selectMultiple: step.config?.selectMultiple ?? false,
    waitType: step.config?.waitType ?? (step.type === "wait" ? "time" : "selector"),
    assertionType: step.config?.assertionType ?? (step.type === "assertVisible" ? "visible" : "text"),
    comparisonOperator: step.config?.comparisonOperator ?? "equals",
    expectedValue: step.config?.expectedValue ?? "",
    screenshotName: step.config?.screenshotName ?? "",
    fullPage: step.config?.fullPage ?? false,
    scrollTarget: step.config?.scrollTarget ?? "page",
    scrollDirection: step.config?.scrollDirection ?? "down",
    scrollAmount: step.config?.scrollAmount ?? 500,
    loopType: step.config?.loopType ?? "fixedCount",
    iterationCount: step.config?.iterationCount ?? 3,
    loopActionType: step.config?.loopActionType ?? "click",
    loopStopOnFailure: step.config?.loopStopOnFailure ?? true,
    maxIterations: step.config?.maxIterations ?? 100,
    targetFlowId: step.flowId ?? step.config?.targetFlowId ?? "",
    stopParentOnChildFailure: step.config?.stopParentOnChildFailure ?? true,
    routeMode: step.config?.routeMode ?? "switchToLatestTab",
    urlMatch: step.config?.urlMatch ?? "contains",
    routeWaitUntil: step.config?.routeWaitUntil ?? "load",
    sessionName: step.config?.sessionName ?? "",
    sessionFolder: step.config?.sessionFolder ?? "",
    overwriteSession: step.config?.overwriteSession ?? false,
    captureScope: step.config?.captureScope ?? "context",
    maskSession: step.config?.maskSession ?? true,
    loginProvider: step.config?.loginProvider ?? "auto",
    handoffMode: step.config?.handoffMode ?? "pauseAndAsk",
    handoffInstructions: step.config?.handoffInstructions ?? "",
    allowRetry: step.config?.allowRetry ?? true,
    handoffTimeoutMs: step.config?.handoffTimeoutMs ?? 0,
    detectBeforeHandoff: step.config?.detectBeforeHandoff ?? true,
    reuseSessionMode: step.config?.reuseSessionMode ?? (step.config?.reuseSessionId ? "selected" : "autoDetect"),
    reuseSessionId: step.config?.reuseSessionId ?? ""
  };
}
