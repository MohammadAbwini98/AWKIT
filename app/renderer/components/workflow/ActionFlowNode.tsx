import { useEffect } from "react";
import { NodeResizer, useReactFlow, useUpdateNodeInternals, type Node, type NodeProps } from "@xyflow/react";
import { MoreHorizontal, RotateCw } from "lucide-react";
import { getFlowNodeCatalogItem } from "./flowNodeCatalog";
import type { FlowDesignerNodeData } from "./flowDesignerTypes";
import { ConnectorLoopPort, ConnectorSourcePorts, ConnectorTargetPorts } from "../shared/ConnectorPorts";
import { buildConnectorVisual, portHandlesForKind } from "../shared/connectorStyle";
import type { FlowConnectionData } from "./ConnectionPropertiesPanel";

type ActionFlowNodeModel = Node<FlowDesignerNodeData, "actionNode">;

/** A node can host a self-loop connector once it has both a target and a source port. */
function canHaveLoop(stepType: FlowDesignerNodeData["stepType"]): boolean {
  return stepType !== "start" && stepType !== "end";
}

export function ActionFlowNode({ id, data, selected }: NodeProps<ActionFlowNodeModel>) {
  const nodeData = data;
  const catalogItem = getFlowNodeCatalogItem(nodeData.stepType);
  const Icon = catalogItem.icon;
  const { setNodes, setEdges } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const hasLoop = Boolean(nodeData.portFlags?.loop);

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, nodeData.portFlags?.conditionalIn, nodeData.portFlags?.loop, nodeData.portFlags?.parallelIn, nodeData.portFlags?.sourceKind, updateNodeInternals]);

  // Point 3/4: loop connectors are created via this button (source/target = this node),
  // not by dragging — self-drag connections are unreliable, so the button is the supported path.
  const addLoop = () => {
    const { sourceHandle, targetHandle } = portHandlesForKind("loop");
    setEdges((currentEdges) => {
      // Never create a second self-loop on the same node (Point: no duplicates).
      if (currentEdges.some((edge) => edge.source === id && edge.target === id && (edge.data?.kind === "loop" || edge.data?.linkType === "loop"))) {
        return currentEdges;
      }
      return [
        ...currentEdges,
        {
          id: `edge-${id}-${id}-loop`,
          source: id,
          target: id,
          sourceHandle,
          targetHandle,
          reconnectable: true,
          ...buildConnectorVisual("loop", { shape: "circular" }),
          data: {
            linkType: "loop",
            label: "Loop",
            expression: "",
            kind: "loop",
            loop: { mode: "count", maxIterations: 3, parameterName: "" },
            style: { shape: "circular" }
          } satisfies FlowConnectionData,
          label: "Loop"
        }
      ];
    });
  };

  // Point 3: removing the loop clears the loop-specific constraints on this node (the
  // conditional-only lock derives from the presence of this edge).
  const removeLoop = () => {
    setEdges((currentEdges) =>
      currentEdges.filter((edge) => !(edge.source === id && edge.target === id && (edge.data?.kind === "loop" || edge.data?.linkType === "loop")))
    );
  };

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={150}
        minHeight={70}
        onResizeEnd={(_, params) =>
          setNodes((nodes) =>
            nodes.map((node) =>
              node.id === id
                ? {
                    ...node,
                    style: { ...node.style, width: params.width, height: params.height },
                    data: { ...node.data, width: params.width, height: params.height }
                  }
                : node
            )
          )
        }
      />
      <article className={`action-flow-node ${selected ? "selected" : ""} ${nodeData.validationState}`}>
        {canHaveLoop(nodeData.stepType) ? (
          <button
            className={`node-loop-button${hasLoop ? " active" : ""}`}
            onClick={hasLoop ? removeLoop : addLoop}
            title={hasLoop ? "Remove loop connector" : "Add loop connector"}
            type="button"
          >
            <RotateCw size={11} />
          </button>
        ) : null}
        <div className="action-node-icon" aria-hidden="true">
          <Icon size={18} />
        </div>
        <div className="action-node-content">
          <div className="action-node-meta">
            <span>{catalogItem.label}</span>
            <span className="action-node-index">{nodeData.stepType}</span>
          </div>
          <strong className="action-node-title">{nodeData.name}</strong>
          {nodeData.description ? <span className="action-node-description">{nodeData.description}</span> : null}
        </div>
        {/* Kebab affordance: non-destructive for now; stops pointer/click so it never breaks
            node drag/selection. Real per-node actions can hang off it later. */}
        <button
          className="action-node-menu"
          type="button"
          title="Node actions"
          aria-label="Node actions"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal size={16} />
        </button>
      </article>
      {/* Handles render as siblings of the card so React Flow positions them against the
          un-clipped node wrapper (the card has overflow: hidden). */}
      {nodeData.stepType !== "start" ? <ConnectorTargetPorts flags={nodeData.portFlags} /> : null}
      {nodeData.stepType !== "end" ? <ConnectorSourcePorts flags={nodeData.portFlags} /> : null}
      {canHaveLoop(nodeData.stepType) ? <ConnectorLoopPort flags={nodeData.portFlags} /> : null}
    </>
  );
}
