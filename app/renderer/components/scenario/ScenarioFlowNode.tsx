import { useEffect } from "react";
import { NodeResizer, useReactFlow, useUpdateNodeInternals, type Node, type NodeProps } from "@xyflow/react";
import { GitBranch, Lock, RotateCw, Unlock } from "lucide-react";
import type { ScenarioFlowNodeData } from "./scenarioDesignerTypes";
import type { ScenarioLinkData } from "./scenarioDesignerTypes";
import { ConnectorLoopPort, ConnectorSourcePorts, ConnectorTargetPorts } from "../shared/ConnectorPorts";
import { buildConnectorVisual, portHandlesForKind } from "../shared/connectorStyle";

type ScenarioFlowNodeModel = Node<ScenarioFlowNodeData, "scenarioFlow">;

export function ScenarioFlowNode({ id, data, selected }: NodeProps<ScenarioFlowNodeModel>) {
  const { setNodes, setEdges } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const hasLoop = Boolean(data.portFlags?.loop);

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, data.portFlags?.conditionalIn, data.portFlags?.loop, data.portFlags?.parallelIn, data.portFlags?.sourceKind, updateNodeInternals]);

  // Point 3/4: loop connectors are created via this button (source/target = this flow node),
  // not by dragging — self-drag connections are unreliable, so the button is the supported path.
  const addLoop = () => {
    const { sourceHandle, targetHandle } = portHandlesForKind("loop");
    setEdges((currentEdges) => {
      if (currentEdges.some((edge) => edge.source === id && edge.target === id && edge.data?.linkType === "loop")) {
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
          data: { linkType: "loop", label: "Loop", expression: "", style: { shape: "circular" } } satisfies ScenarioLinkData,
          label: "Loop"
        }
      ];
    });
  };

  const removeLoop = () => {
    setEdges((currentEdges) => currentEdges.filter((edge) => !(edge.source === id && edge.target === id && edge.data?.linkType === "loop")));
  };

  return (
    <>
      {/* Resize handles show only on the selected node (matches Flow Designer). */}
      <NodeResizer
        isVisible={selected}
        minWidth={180}
        minHeight={80}
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
      <article className={`scenario-flow-node ${selected ? "selected" : ""} ${data.mode}`}>
        <button
          className={`node-loop-button${hasLoop ? " active" : ""}`}
          onClick={hasLoop ? removeLoop : addLoop}
          title={hasLoop ? "Remove loop connector" : "Add loop connector"}
          type="button"
        >
          <RotateCw size={11} />
        </button>
        <div className="scenario-node-order">{data.order}</div>
        <div className="scenario-node-copy">
          <strong>{data.name}</strong>
          <span>{data.description}</span>
        </div>
        <div className="scenario-node-meta">
          {data.required ? <Lock size={14} /> : <Unlock size={14} />}
          <GitBranch size={14} />
        </div>
      </article>
      {/* Handles render as siblings of the card (which has overflow: hidden) so React Flow
          positions them against the un-clipped node wrapper. */}
      <ConnectorTargetPorts flags={data.portFlags} />
      <ConnectorSourcePorts flags={data.portFlags} />
      <ConnectorLoopPort flags={data.portFlags} />
    </>
  );
}
