import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import { DesignerCanvasLayout } from "../layout/DesignerCanvasLayout";
import type { WorkflowProfile } from "@src/profiles/WorkflowProfile";

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

  const nodes = useMemo<Node[]>(() => {
    if (!selectedWorkflow) return [];
    const ordered = [...selectedWorkflow.nodes].sort((a, b) => a.order - b.order);
    return ordered.map((node, index) => ({
      id: node.id,
      position: node.position ?? { x: 80 + index * 280, y: 120 },
      data: { label: `${node.order}. ${node.alias}${node.required ? "" : " (optional)"}` },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      style: {
        background: "#ffffff",
        border: "1px solid #bdd4f6",
        borderLeft: `5px solid ${node.required ? "#1769e0" : "#7a879a"}`,
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        padding: 10,
        width: 220
      }
    }));
  }, [selectedWorkflow]);

  const edges = useMemo<Edge[]>(() => {
    if (!selectedWorkflow) return [];
    return selectedWorkflow.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "smoothstep",
      label: edge.label ?? edge.type,
      markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 }
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
          <ReactFlow fitView edges={edges} nodes={nodes} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}>
            <Background color="#dfe7f3" gap={24} size={1} variant={BackgroundVariant.Lines} />
            <Controls position="top-right" showInteractive={false} />
            <MiniMap pannable position="bottom-right" zoomable />
          </ReactFlow>
        </div>
      </div>
    </DesignerCanvasLayout>
  );
}

export function WorkflowDesigner() {
  return (
    <ReactFlowProvider>
      <WorkflowDesignerContent />
    </ReactFlowProvider>
  );
}
