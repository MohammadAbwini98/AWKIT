import { Network } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DesignerCanvasLayout } from "../layout/DesignerCanvasLayout";
import { Background, CanvasZoomControl, FlowCanvas, SmoothEdge, StepNode, type CanvasEdge, type CanvasNode, type EdgeTypes, type NodeTypes } from "../components/canvas";
import type { StepNodeData } from "../components/canvas";
import { isWorkflowFlowNode, type WorkflowProfile } from "@src/profiles/WorkflowProfile";

const nodeTypes = { step: StepNode } satisfies NodeTypes;
const edgeTypes = { smooth: SmoothEdge } satisfies EdgeTypes;

function WorkflowDesignerContent() {
  const [workflows, setWorkflows] = useState<WorkflowProfile[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("");
  const [status, setStatus] = useState("Loading saved workflows…");

  useEffect(() => {
    window.playwrightFlowStudio.workflows
      .list()
      .then((profiles) => {
        setWorkflows(profiles);
        setSelectedWorkflowId(profiles[0]?.id ?? "");
        setStatus(profiles.length ? `${profiles.length} saved workflow${profiles.length === 1 ? "" : "s"}` : "No saved workflows yet");
      })
      .catch(() => setStatus("Unable to load saved workflows"));
  }, []);

  const selectedWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? null,
    [workflows, selectedWorkflowId]
  );

  const nodes = useMemo<CanvasNode<StepNodeData>[]>(() => {
    if (!selectedWorkflow) return [];
    const ordered = [...selectedWorkflow.nodes].sort((a, b) => a.order - b.order);
    return ordered.map((node, index) => {
      const optional = isWorkflowFlowNode(node) && !node.required;
      return {
        id: node.id,
        type: "step",
        position: node.position ?? { x: 120, y: 60 + index * 150 },
        draggable: false,
        data: {
          icon: Network,
          label: node.type === "flowRef" ? `Flow ${node.order}${optional ? " · optional" : ""}` : "Node",
          title: node.alias,
          accent: optional ? "muted" : "default"
        }
      };
    });
  }, [selectedWorkflow]);

  const edges = useMemo<CanvasEdge[]>(() => {
    if (!selectedWorkflow) return [];
    return selectedWorkflow.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "smooth",
      label: edge.label ?? (edge.type === "success" ? undefined : edge.type)
    }));
  }, [selectedWorkflow]);

  return (
    <DesignerCanvasLayout
      flush
      rightPanel={
        <aside className="properties-panel">
          <div className="properties-heading">
            <h2>Workflow Overview</h2>
            <span>{status}</span>
          </div>
          {selectedWorkflow ? (
            <section className="property-section">
              <h3>Summary</h3>
              <div className="readiness-list">
                <span>Name</span>
                <strong>{selectedWorkflow.name}</strong>
                <span>Flows</span>
                <strong>{selectedWorkflow.nodes.length}</strong>
                <span>Connectors</span>
                <strong>{selectedWorkflow.edges.length}</strong>
                <span>Execution mode</span>
                <strong>{selectedWorkflow.execution.mode}</strong>
                <span>Max concurrency</span>
                <strong>{selectedWorkflow.execution.maxConcurrentInstances}</strong>
              </div>
              <p className="form-message">Edit workflows in the Workflow Builder. This page is a read-only overview.</p>
            </section>
          ) : (
            <div className="empty-properties">Create a workflow in the Workflow Builder to see it here.</div>
          )}
        </aside>
      }
    >
      <div className="flow-designer-shell">
        <div className="flow-action-bar">
          <div className="flow-action-title">
            <strong>Workflow Overview</strong>
            <span>Read-only graph of saved workflows</span>
          </div>
          <label>
            Workflow
            <select value={selectedWorkflowId} onChange={(event) => setSelectedWorkflowId(event.target.value)}>
              {workflows.length ? (
                workflows.map((workflow) => (
                  <option key={workflow.id} value={workflow.id}>
                    {workflow.name}
                  </option>
                ))
              ) : (
                <option value="">No workflows</option>
              )}
            </select>
          </label>
        </div>

        <div className="react-flow-shell">
          <FlowCanvas edges={edges} edgeTypes={edgeTypes} nodes={nodes} nodeTypes={nodeTypes} nodesDraggable={false}>
            <Background gap={22} size={2} color="var(--awkit-canvas-dot)" />
            <CanvasZoomControl />
          </FlowCanvas>
        </div>
      </div>
    </DesignerCanvasLayout>
  );
}

export function WorkflowDesigner() {
  return <WorkflowDesignerContent />;
}
