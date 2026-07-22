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
  type NodeTypes,
  type EdgeTypes,
  type Viewport
} from "../components/canvas";
import { FolderOpen, GitBranch, GitFork, LayoutGrid, Plus, Repeat, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActionFlowNode } from "../components/workflow/ActionFlowNode";
import { ConnectionPropertiesPanel, type FlowConnectionData } from "../components/workflow/ConnectionPropertiesPanel";
import { buildConnectorVisual, hasCustomStyle } from "../components/shared/connectorStyle";
import { positionsNeedLayout, withAutoLayout } from "../components/shared/graphLayout";
import { useFlowGlide, GLIDE_MAX_NODES } from "../lib/motion";
import { SearchableSelect } from "../components/shared/SearchableSelect";
import { FlowNodePropertiesPanel } from "../components/workflow/FlowNodePropertiesPanel";
import { flowNodeCatalog, getFlowNodeCatalogItem } from "../components/workflow/flowNodeCatalog";
import { getNodeDefinition } from "../components/workflow/flowNodeRegistry";
import { DEFAULT_NODE_HEIGHT, DEFAULT_NODE_WIDTH, defaultNodeData, type FlowDesignerNodeData } from "../components/workflow/flowDesignerTypes";
// Model <-> node-data conversion lives in its own module so a verifier can exercise the real
// functions (scripts/verify-flow-step-mapping.mts). Behavior is identical to the previous inline pair.
import {
  fromFlowStep,
  toFlowStep,
  type FlowDesignerEdge as FlowDesignerEdgeAlias,
  type FlowDesignerNode as FlowDesignerNodeAlias
} from "../components/workflow/flowStepMapping";
import { DesignerCanvasLayout } from "../layout/DesignerCanvasLayout";
import { Toast, type ToastState } from "../components/shared/Toast";
import { ConfirmDialog } from "../components/shared/ConfirmDialog";
import { CanvasItemPicker, type CanvasPickerItem } from "../components/shared/CanvasItemPicker";
import { usePageChrome } from "../state/pageChrome";
import { usePermissions } from "../security/usePermissions";
import { Permission } from "@src/security/authz/Permissions";
import type { ConnectorKind, EdgeVisualStyle, FlowEdge, FlowEdgeType, FlowProfile, FlowStep, StepType } from "@src/profiles/FlowProfile";
import { connectorKind } from "@src/profiles/FlowProfile";

const nodeTypes = {
  actionNode: ActionFlowNode
} satisfies NodeTypes;

const edgeTypes = {
  smooth: SmoothEdge,
  loop: LoopEdge
} satisfies EdgeTypes;

type FlowDesignerNode = FlowDesignerNodeAlias;
type FlowDesignerEdge = FlowDesignerEdgeAlias;

const initialNodes: FlowDesignerNode[] = [
  {
    id: "start",
    type: "actionNode",
    position: { x: 280, y: 120 },
    data: defaultNodeData("start", "Start", "Entry point")
  },
  {
    id: "end",
    type: "actionNode",
    position: { x: 280, y: 390 },
    data: defaultNodeData("end", "End", "Flow complete")
  }
];

const initialEdges: FlowDesignerEdge[] = [
  createEdge("start", "end", "always")
];

type FlowPickerState =
  | { mode: "blank"; x: number; y: number; position: { x: number; y: number } }
  | { mode: "edge"; x: number; y: number; edgeId: string }
  | { mode: "append"; x: number; y: number; sourceId: string };

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
  return {
    id: `edge-${source}-${target}`,
    source,
    target,
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
 * Branch-connector reconciliation was tied to the old two-port node model (slotting a node's
 * conditional/parallel pair to distinct ports). The custom engine routes every connector
 * bottom→top, so there are no ports to slot and this is now a pass-through kept only so call
 * sites read unchanged. Connector *kind* + config still live on `edge.data` and drive validation.
 */
function reconcileFlowBranches(edges: FlowDesignerEdge[], _revertSources?: Set<string>): FlowDesignerEdge[] {
  return edges;
}

/** Node size is measured from the rendered card by the engine, so this is now an identity pass. */
function styledNode(node: FlowDesignerNode): FlowDesignerNode {
  return node;
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
  const [nodes, setNodes] = useNodesState<FlowDesignerNodeData>(initialNodes.map(styledNode));
  const defaultNodeSize = useRef({ width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT });
  const [edges, setEdges] = useEdgesState<FlowConnectionData>(initialEdges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [savedFlows, setSavedFlows] = useState<FlowProfile[]>([]);
  const [flowId, setFlowId] = useState("login-flow");
  const [flowName, setFlowName] = useState("Login Flow");
  const [saveState, setSaveState] = useState("Loading…");
  const [dataSources, setDataSources] = useState<{ id: string; name: string }[]>([]);
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(false);
  const [picker, setPicker] = useState<FlowPickerState | null>(null);
  const [connectPrompt, setConnectPrompt] = useState<{ source: string; target: string; sourceName: string; targetName: string } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<FlowCanvasHandle>(null);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const pendingSnapshot = useRef(true);
  const [toast, setToast] = useState<ToastState | null>(null);
  const { animating: layoutGliding, arm: armLayoutGlide } = useFlowGlide();

  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId) ?? null, [nodes, selectedNodeId]);
  const selectedEdge = useMemo(() => edges.find((edge) => edge.id === selectedEdgeId) ?? null, [edges, selectedEdgeId]);

  // The properties inspector owns a layout column. If that narrower viewport clips the selected
  // item, pan only far enough to reveal it and restore that exact accommodation on close.
  const inspectorPanRef = useRef(0);
  const drawerOpen = Boolean((selectedNode || selectedEdge) && !propertiesCollapsed);
  useLayoutEffect(() => {
    const engine = engineRef.current;
    const canvas = canvasRef.current;
    if (!engine || !canvas) return;
    if (!drawerOpen) {
      if (inspectorPanRef.current !== 0) {
        engine.panBy(-inspectorPanRef.current, 0, { duration: 260 });
        inspectorPanRef.current = 0;
      }
      return;
    }

    const selectedId = selectedNodeId ?? selectedEdgeId;
    if (!selectedId) return;
    const escapedId = CSS.escape(selectedId);
    const selectedElement = selectedNodeId
      ? canvas.querySelector<HTMLElement>(`[data-canvas-node="${escapedId}"]`)
      : canvas.querySelector<SVGGElement>(`g.awkit-flow-edge[data-id="${escapedId}"]`);
    if (!selectedElement) return;

    const canvasRect = canvas.getBoundingClientRect();
    const selectedRect = selectedElement.getBoundingClientRect();
    const style = getComputedStyle(document.documentElement);
    const clearance = Number.parseFloat(style.getPropertyValue("--space-3")) || 0;
    const panX = Math.min(0, canvasRect.right - clearance - selectedRect.right);
    if (panX < 0) {
      inspectorPanRef.current += panX;
      engine.panBy(panX, 0, { duration: 260 });
    }
  }, [drawerOpen, selectedEdgeId, selectedNodeId]);
  const validationMessages = useMemo(() => validateFlow(nodes, edges), [nodes, edges]);
  const flowProfile = useMemo(() => toFlowProfile(nodes, edges, flowId, flowName), [edges, flowId, flowName, nodes]);
  // Points 2–4: connector-structure issues block Save until fixed (subset of validationMessages).
  const connectorIssues = useMemo(
    () => connectorStructureIssues(edges, (id) => nodes.find((node) => node.id === id)?.data.name ?? id),
    [edges, nodes]
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

  // Reference "Logic" group: branch-creating operations that map to AWKIT's real conditional /
  // parallel / loop connector semantics (handled in `applyLogic`). Listed first so "Logic" is the
  // top group in the picker. The plain `condition`/`loop` node types are folded into these logic
  // operations so there is no confusing duplicate lone-node entry.
  const pickerItems = useMemo<CanvasPickerItem<string>[]>(
    () => [
      { id: "logic-condition", label: "Condition", description: "Branch with If / Else conditional connectors", category: "Logic", icon: GitBranch },
      { id: "logic-parallel", label: "Parallel", description: "Run two branches at the same time", category: "Logic", icon: GitFork },
      { id: "logic-loop", label: "Loop", description: "Repeat a step with a self-loop connector", category: "Logic", icon: Repeat },
      ...flowNodeCatalog
        .filter((item) => item.type !== "start" && item.type !== "end" && item.type !== "condition" && item.type !== "loop")
        .map((item) => ({ ...item, id: item.type as string, category: getNodeDefinition(item.type).category }))
    ],
    []
  );

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
        defaultNodeSize.current = {
          width: settings.designerDefaults.defaultNodeWidth || DEFAULT_NODE_WIDTH,
          height: settings.designerDefaults.defaultNodeHeight || DEFAULT_NODE_HEIGHT
        };
        const zoomPercent = settings.flowDesignerZoomPercent > 0 ? settings.flowDesignerZoomPercent : settings.designerDefaults.defaultZoomPercent;
        engineRef.current?.zoomTo(zoomPercent / 100);

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

  const persistFlowZoom = useCallback((percent: number) => {
    window.playwrightFlowStudio.settings.update({ flowDesignerZoomPercent: percent }).catch(() => undefined);
  }, []);

  // Stable canvas callbacks: passing inline arrows to <FlowCanvas> gave every node a new
  // callback reference on each page render (e.g. typing the Flow Name, save-state changes),
  // which defeated the memoized node subtree and re-rendered every card per keystroke.
  const handleNodePositionChange = useCallback(
    (id: string, position: { x: number; y: number }) => {
      setNodes((current) => current.map((node) => (node.id === id ? { ...node, position } : node)));
      setSaveState("Unsaved changes");
    },
    [setNodes]
  );
  const handleMoveEnd = useCallback((viewport: Viewport) => persistFlowZoom(Math.round(viewport.zoom * 100)), [persistFlowZoom]);

  // Issue 4 (flowforge parity): drag one node onto another to connect them, with a confirm step so an
  // accidental overlap doesn't silently rewire the flow. Skips already-linked pairs; orients top→bottom.
  // Reads live nodes/edges from refs so the callback stays STABLE (else it re-creates every edit and,
  // via the engine's drag-stop handler, re-renders every node wrapper — a perf regression).
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
    if (tgt.id === "start" || src.id === "end") return; // never point into Start / out of End
    setConnectPrompt({ source: src.id, target: tgt.id, sourceName: src.data.name, targetName: tgt.data.name });
  }, []);
  const confirmConnect = useCallback(() => {
    if (!connectPrompt) return;
    const linkType: FlowEdgeType = connectPrompt.source === "start" ? "always" : "success";
    setEdges((current) => reconcileFlowBranches([...current, createEdge(connectPrompt.source, connectPrompt.target, linkType)]));
    setSaveState("Unsaved changes");
    setToast({ tone: "success", message: `Connected "${connectPrompt.sourceName}" → "${connectPrompt.targetName}".` });
    setConnectPrompt(null);
  }, [connectPrompt, setEdges]);

  const updateNode = useCallback(
    (nodeId: string, data: Partial<FlowDesignerNodeData>) => {
      setNodes((currentNodes) =>
        currentNodes.map((node) => {
          if (node.id !== nodeId) return node;
          return { ...node, data: { ...node.data, ...data } };
        })
      );
      setSaveState("Unsaved changes");
    },
    [setNodes]
  );

  // Add or remove a node's self-loop connector (from the node kebab menu). Replaces the old
  // in-node loop button that mutated edges via useReactFlow.
  const toggleNodeLoop = useCallback(
    (nodeId: string) => {
      setEdges((currentEdges) => {
        const hasLoop = currentEdges.some((edge) => edge.source === nodeId && edge.target === nodeId && (edge.data?.kind === "loop" || edge.data?.linkType === "loop"));
        if (hasLoop) {
          return currentEdges.filter((edge) => !(edge.source === nodeId && edge.target === nodeId && (edge.data?.kind === "loop" || edge.data?.linkType === "loop")));
        }
        return [
          ...currentEdges,
          createEdge(nodeId, nodeId, "loop", "Loop", undefined, { shape: "circular" }, undefined, {
            kind: "loop",
            loop: { mode: "count", maxIterations: 3, parameterName: "" }
          })
        ];
      });
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

  const handlePaneClick = useCallback(() => {
    clearSelection();
    setPicker(null);
  }, [clearSelection]);

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

  const { can } = usePermissions();
  const canSaveFlow = can(Permission.WORKFLOW_EDIT);

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

      // Point 1c: flows saved without node positions collapse onto one coordinate. Auto-arrange
      // (top-to-bottom) only when the positions are missing/stacked; manual layouts are preserved.
      // Only reframe when we actually rearranged, so normal loads keep the persisted zoom.
      const needsLayout = positionsNeedLayout(nextNodes);
      const arrangedNodes = needsLayout ? withAutoLayout(nextNodes, nextEdges, { direction: "TB", force: true }) : nextNodes;
      if (needsLayout && arrangedNodes.length <= GLIDE_MAX_NODES) armLayoutGlide();
      setNodes(arrangedNodes);
      setEdges(reconcileFlowBranches(nextEdges));
      if (needsLayout) window.requestAnimationFrame(() => engineRef.current?.fitView({ padding: 0.2, duration: 200 }));
      setSelectedNodeId(arrangedNodes[0]?.id ?? null);
      setSelectedEdgeId(null);
      setFlowId(profile.id);
      setFlowName(profile.name);
      setSaveState("Loaded profile");
      pendingSnapshot.current = true; // recapture the dirty baseline once the loaded doc settles
      window.playwrightFlowStudio.settings.update({ selections: { lastSelectedFlowId: profile.id } }).catch(() => undefined);
    },
    [setEdges, setNodes, armLayoutGlide]
  );

  // Point 1c: manual "Auto-arrange" — re-run the layered layout (top-to-bottom) on the current
  // graph on demand, then frame it. Marks the document dirty; positions stay user-editable after.
  const autoArrange = useCallback(() => {
    if (nodes.length <= GLIDE_MAX_NODES) armLayoutGlide();
    setNodes((currentNodes) => withAutoLayout(currentNodes, edges, { direction: "TB", force: true }));
    setSaveState("Unsaved changes");
    window.requestAnimationFrame(() => engineRef.current?.fitView({ padding: 0.2, duration: 200 }));
  }, [edges, nodes, setNodes, armLayoutGlide]);

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

  // Template connector "+" affordance: split a straight (non-self-loop) connector by inserting a
  // real Click node at its midpoint. The original edge is replaced by source→new and new→target,
  // preserving the source edge's routing/kind so branch invariants stay intact. Purely a canvas
  // edit — nothing here is serialized until Save.
  const insertNodeOnEdge = useCallback(
    (edgeId: string, stepType: StepType) => {
      const edge = edges.find((item) => item.id === edgeId);
      if (!edge || edge.source === edge.target) return;

      const sourceNode = nodes.find((node) => node.id === edge.source);
      const targetNode = nodes.find((node) => node.id === edge.target);
      const catalogItem = getFlowNodeCatalogItem(stepType);
      const id = `${stepType}-${Date.now().toString(36)}`;
      const position = {
        x: ((sourceNode?.position.x ?? 280) + (targetNode?.position.x ?? 280)) / 2,
        y: ((sourceNode?.position.y ?? 160) + (targetNode?.position.y ?? 320)) / 2
      };

      const node: FlowDesignerNode = styledNode({
        id,
        type: "actionNode",
        position,
        data: { ...defaultNodeData(stepType, catalogItem.label, catalogItem.description), ...defaultNodeSize.current }
      });

      setNodes((currentNodes) => [...currentNodes, node]);
      setEdges((currentEdges) => {
        const targetEdge = currentEdges.find((item) => item.id === edgeId);
        if (!targetEdge) return currentEdges;
        const remaining = currentEdges.filter((item) => item.id !== edgeId);
        return reconcileFlowBranches([
          ...remaining,
          createEdge(
            targetEdge.source,
            id,
            targetEdge.data?.linkType ?? "success",
            targetEdge.data?.label,
            targetEdge.data?.expression,
            targetEdge.data?.style,
            targetEdge.data?.maxLoopCount,
            {
              kind: targetEdge.data?.kind ?? "normal",
              conditional: targetEdge.data?.conditional,
              parallel: targetEdge.data?.parallel,
              loop: targetEdge.data?.loop
            }
          ),
          createEdge(id, targetEdge.target, "success", "success")
        ]);
      });
      setSelectedNodeId(id);
      setSelectedEdgeId(null);
      setSaveState("Unsaved changes");
    },
    [edges, nodes, setEdges, setNodes]
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

  const appendNode = useCallback((sourceId: string, stepType: StepType) => {
    const source = nodes.find((node) => node.id === sourceId);
    if (!source) return;
    const catalogItem = getFlowNodeCatalogItem(stepType);
    const id = `${stepType}-${Date.now().toString(36)}`;
    const node = styledNode({
      id,
      type: "actionNode",
      position: { x: source.position.x, y: source.position.y + 180 },
      data: { ...defaultNodeData(stepType, catalogItem.label, catalogItem.description), ...defaultNodeSize.current }
    });
    setNodes((current) => [...current, node]);
    setEdges((current) => [...current, createEdge(sourceId, id, source.data.stepType === "start" ? "always" : "success")]);
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
    setSaveState("Unsaved changes");
  }, [nodes, setEdges, setNodes]);

  const openBlankPicker = useCallback((event: MouseEvent | React.MouseEvent) => {
    event.preventDefault();
    const canvas = canvasRef.current?.getBoundingClientRect();
    if (!canvas) return;
    const x = Math.max(12, Math.min(event.clientX - canvas.left, canvas.width - 352));
    const y = Math.max(12, Math.min(event.clientY - canvas.top, canvas.height - 536));
    setPicker({
      mode: "blank",
      x,
      y,
      position: engineRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) ?? { x: 360, y: 200 }
    });
  }, []);

  const openToolbarPicker = useCallback(() => {
    const canvas = canvasRef.current?.getBoundingClientRect();
    if (!canvas) return;
    const client = { x: canvas.left + canvas.width / 2, y: canvas.top + canvas.height / 2 };
    setPicker({
      mode: "blank",
      x: Math.max(12, canvas.width / 2 - 170),
      y: Math.max(12, Math.min(72, canvas.height - 536)),
      position: engineRef.current?.screenToFlowPosition(client) ?? { x: 360, y: 200 }
    });
  }, []);

  // Reference-style logic operations (auto-create the branch), mapped to AWKIT connector kinds:
  // Condition → a branch node with two conditional (If true / If false) connectors; Parallel → a
  // two-way parallel fan-out; Loop → a step carrying a self-loop connector. Produces valid AWKIT
  // edges (kind + config) that the runtime and validator accept.
  const applyLogic = useCallback(
    (logic: "condition" | "parallel" | "loop", state: FlowPickerState) => {
      const ROW = 190;
      const DX = 210;
      const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const make = (stepType: StepType, position: { x: number; y: number }): FlowDesignerNode => {
        const item = getFlowNodeCatalogItem(stepType);
        return styledNode({
          id: uid(stepType),
          type: "actionNode",
          position,
          data: { ...defaultNodeData(stepType, item.label, item.description), ...defaultNodeSize.current }
        });
      };
      const conditional = (priority: number): Partial<FlowConnectionData> => ({
        kind: "conditional",
        conditional: { sourceField: "outcome", operator: "equals", expectedValue: "", priority }
      });
      const parallel = (): Partial<FlowConnectionData> => ({ kind: "parallel", parallel: { joinMode: "waitAll", failMode: "failFast" } });
      const loop = (): Partial<FlowConnectionData> => ({ kind: "loop", loop: { mode: "count", maxIterations: 3, parameterName: "" } });

      // Resolve an anchor position + optional (source, target) the operation splices around.
      const sourceId = state.mode === "append" ? state.sourceId : state.mode === "edge" ? edges.find((e) => e.id === state.edgeId)?.source : undefined;
      const targetId = state.mode === "edge" ? edges.find((e) => e.id === state.edgeId)?.target : undefined;
      const sourceNode = sourceId ? nodes.find((n) => n.id === sourceId) : undefined;
      const anchor = sourceNode ? { x: sourceNode.position.x, y: sourceNode.position.y + ROW } : state.mode === "blank" ? state.position : { x: 360, y: 200 };
      const startEdgeType = sourceNode?.data.stepType === "start" ? "always" : "success";

      let addNodes: FlowDesignerNode[] = [];
      let addEdges: FlowDesignerEdge[] = [];
      let removeEdgeId: string | undefined;
      let selectId: string | undefined;

      if (logic === "condition") {
        const cond = make("condition", anchor);
        const yes = make("click", { x: anchor.x - DX, y: anchor.y + ROW });
        addNodes = [cond, yes];
        addEdges = [createEdge(cond.id, yes.id, "conditional", "If true", undefined, undefined, undefined, conditional(0))];
        if (sourceId) addEdges.push(createEdge(sourceId, cond.id, startEdgeType));
        if (state.mode === "edge" && targetId) {
          removeEdgeId = state.edgeId;
          addEdges.push(createEdge(cond.id, targetId, "conditional", "If false", undefined, undefined, undefined, conditional(1)));
        } else {
          const no = make("click", { x: anchor.x + DX, y: anchor.y + ROW });
          addNodes.push(no);
          addEdges.push(createEdge(cond.id, no.id, "conditional", "If false", undefined, undefined, undefined, conditional(1)));
        }
        selectId = cond.id;
      } else if (logic === "parallel") {
        const a = make("click", { x: anchor.x - DX, y: anchor.y });
        const b = make("click", { x: anchor.x + DX, y: anchor.y });
        addNodes = [a, b];
        if (sourceId) {
          addEdges = [createEdge(sourceId, a.id, "parallel", "Branch A", undefined, undefined, undefined, parallel()), createEdge(sourceId, b.id, "parallel", "Branch B", undefined, undefined, undefined, parallel())];
          if (state.mode === "edge" && targetId) {
            // Re-home the original downstream node under the first parallel branch so nothing is lost.
            removeEdgeId = state.edgeId;
            addEdges.push(createEdge(a.id, targetId, "success"));
          }
        }
        selectId = a.id;
      } else {
        // loop: a step that carries a self-loop connector.
        const node = make("click", anchor);
        addNodes = [node];
        addEdges = [createEdge(node.id, node.id, "loop", "Loop", undefined, { shape: "circular" }, undefined, loop())];
        if (sourceId) addEdges.push(createEdge(sourceId, node.id, startEdgeType));
        if (state.mode === "edge" && targetId) {
          removeEdgeId = state.edgeId;
          addEdges.push(createEdge(node.id, targetId, "success"));
        }
        selectId = node.id;
      }

      setNodes((current) => [...current, ...addNodes]);
      setEdges((current) => reconcileFlowBranches([...current.filter((e) => e.id !== removeEdgeId), ...addEdges]));
      if (selectId) {
        setSelectedNodeId(selectId);
        setSelectedEdgeId(null);
      }
      setSaveState("Unsaved changes");
    },
    [edges, nodes, setEdges, setNodes]
  );

  const handlePickerPick = useCallback((id: string) => {
    if (!picker) return;
    if (id === "logic-condition" || id === "logic-parallel" || id === "logic-loop") {
      applyLogic(id.slice("logic-".length) as "condition" | "parallel" | "loop", picker);
    } else {
      const stepType = id as StepType;
      if (picker.mode === "edge") insertNodeOnEdge(picker.edgeId, stepType);
      else if (picker.mode === "append") appendNode(picker.sourceId, stepType);
      else addNode(stepType, picker.position);
    }
    setPicker(null);
  }, [addNode, appendNode, applyLogic, insertNodeOnEdge, picker]);

  // Display-only edges: attach the label pill + insert affordance to what the canvas renders,
  // without ever mutating the saved `edges` (callbacks/flags must not be serialized). Only
  // straight edges (source ≠ target) get an add button; self-loops render via SelfLoopEdge.
  const edgesForCanvas = useMemo<FlowDesignerEdge[]>(
    () =>
      edges.map((edge) => {
        const base = edge.data ?? ({ linkType: "success" } as FlowConnectionData);
        return {
          ...edge,
          // Reflect connector selection on the canvas (the `.is-selected` highlight).
          selected: edge.id === selectedEdgeId,
          data: {
            ...base,
            label: base.label ?? (typeof edge.label === "string" ? edge.label : undefined),
            showAddButton: edge.source !== edge.target,
            onInsertNode: openEdgePicker
          }
        };
      }),
    [edges, openEdgePicker, selectedEdgeId]
  );

  // Delete an arbitrary node by id (used by the per-node kebab menu). Start/End are structural
  // and never removable. Reverts any branch pair orphaned on a surviving source node.
  const removeNodeById = useCallback(
    (nodeId: string) => {
      if (nodeId === "start" || nodeId === "end") return;
      setNodes((currentNodes) => currentNodes.filter((node) => node.id !== nodeId));
      setEdges((currentEdges) => {
        const affectedSources = new Set(currentEdges.filter((edge) => edge.target === nodeId).map((edge) => edge.source));
        return reconcileFlowBranches(currentEdges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId), affectedSources);
      });
      setSelectedNodeId((current) => (current === nodeId ? null : current));
      setSaveState("Unsaved changes");
    },
    [setEdges, setNodes]
  );

  // Identity-preserving so editing / dragging one node rebuilds only that node's wrapper —
  // unchanged nodes keep object identity and the memoized NodeContainer skips them.
  const interactiveNodesStore = useRef(createIdentityStore<FlowDesignerNode, FlowDesignerNode>()).current;
  const interactiveNodesForCanvas = useMemo(() => {
    const sources = new Set(edges.filter((edge) => edge.source !== edge.target).map((edge) => edge.source));
    const loopSources = new Set(edges.filter((edge) => edge.source === edge.target && (edge.data?.kind === "loop" || edge.data?.linkType === "loop")).map((edge) => edge.source));
    return mapWithIdentity(
      interactiveNodesStore,
      nodes,
      [openAppendPicker, selectNode, removeNodeById, toggleNodeLoop],
      (node) => `${sources.has(node.id) ? 1 : 0}${loopSources.has(node.id) ? 1 : 0}${node.id === selectedNodeId ? "S" : ""}`,
      (node) => ({
        ...node,
        selected: node.id === selectedNodeId,
        data: {
          ...node.data,
          isLeaf: !sources.has(node.id),
          hasLoop: loopSources.has(node.id),
          onAppendNode: openAppendPicker,
          onConfigure: selectNode,
          onDeleteNode: removeNodeById,
          onToggleLoop: toggleNodeLoop
        }
      })
    );
  }, [edges, nodes, selectedNodeId, openAppendPicker, selectNode, removeNodeById, toggleNodeLoop, interactiveNodesStore]);

  usePageChrome(
    {
      actions: [
        { id: "save", label: "Save", variant: "primary", onClick: () => saveFlow(), title: canSaveFlow ? "Save this flow profile" : "Requires the Edit Flows permission", disabled: !canSaveFlow },
        { id: "export", label: "Export", onClick: exportFlow, title: "Export flow as JSON" }
      ],
      dirty: isDirty
    },
    [saveFlow, exportFlow, isDirty, canSaveFlow]
  );

  return (
    <DesignerCanvasLayout
      flush
      rightCollapsed={propertiesCollapsed}
      rightPanel={
        selectedEdge ? (
          <ConnectionPropertiesPanel
            edge={selectedEdge}
            onUpdate={updateEdgeData}
            onDelete={deleteEdge}
            dataSources={dataSources}
            sourceHasLoop={loopControlledSources.has(selectedEdge.source) && selectedEdge.source !== selectedEdge.target}
          />
        ) : selectedNode ? (
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
            onDelete={deleteSelectedNode}
          />
        ) : null
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
          <button className="toolbar-button" onClick={openToolbarPicker} type="button">
            <Plus size={15} />
            Add Node
          </button>
          <button className="toolbar-button" onClick={loadFlow} type="button">
            <FolderOpen size={15} />
            Load
          </button>
          <button className="toolbar-button" onClick={autoArrange} type="button" title="Auto-arrange nodes (top-to-bottom)">
            <LayoutGrid size={15} />
            Auto-arrange
          </button>
          <span className={validationMessages.length ? "validation-chip warn" : "validation-chip ok"}>
            <ShieldCheck size={14} />
            {validationMessages.length ? `${validationMessages.length} issues` : "Valid"}
          </span>
        </div>

        <div className="flow-designer-body">
          <div ref={canvasRef} className="react-flow-shell">
            <FlowCanvas
              ref={engineRef}
              className={layoutGliding ? "flow-animating" : undefined}
              edges={edgesForCanvas}
              edgeTypes={edgeTypes}
              nodeTypes={nodeTypes}
              nodes={interactiveNodesForCanvas}
              onNodePositionChange={handleNodePositionChange}
              onNodeConnect={handleNodeConnect}
              onEdgeClick={selectEdge}
              onNodeClick={selectNode}
              onPaneClick={handlePaneClick}
              onPaneContextMenu={openBlankPicker}
              onMoveEnd={handleMoveEnd}
            >
              {/* Reference-parity canvas chrome: only the dotted grid + bottom-center glass toolbar.
                  No React Flow Controls / MiniMap (the Workflow reference has neither). */}
              <Background gap={22} size={2} color="var(--awkit-canvas-dot)" />
              <CanvasZoomControl onPersist={persistFlowZoom} />
            </FlowCanvas>
            <CanvasItemPicker
              open={Boolean(picker)}
              title="Node Palette"
              searchPlaceholder="Search nodes..."
              items={pickerItems}
              x={picker?.x ?? 0}
              y={picker?.y ?? 0}
              onPick={handlePickerPick}
              onClose={() => setPicker(null)}
            />
          </div>
        </div>
      </div>
      <Toast toast={toast} onDismiss={() => setToast(null)} />
      {connectPrompt ? (
        <ConfirmDialog
          title="Connect these steps?"
          message={`Link “${connectPrompt.sourceName}” to “${connectPrompt.targetName}” so they run as one connected flow.`}
          confirmLabel="Connect"
          icon="connect"
          onConfirm={confirmConnect}
          onCancel={() => setConnectPrompt(null)}
        />
      ) : null}
    </DesignerCanvasLayout>
  );
}

export function FlowChartDesigner() {
  return <FlowChartDesignerContent />;
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
