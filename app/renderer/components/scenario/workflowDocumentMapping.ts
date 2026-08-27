/**
 * Workflow Builder canvas document → `WorkflowProfile` mapping.
 *
 * Extracted from `pages/ScenarioBuilder.tsx` (AWKIT-WFB-001) so a headless verifier can drive the
 * REAL save-path converter — the same pattern as `workflow/flowProfileMapping.ts`. Round-trip
 * fidelity of a saved workflow document is decided here.
 *
 * The rule is **preserve, don't re-derive**: everything persisted in the loaded document
 * (`original`) survives verbatim; only what a genuinely new node/document needs is derived.
 */
import type { CanvasEdge, CanvasNode } from "../canvas/types";
import { scenarioEdgeKind } from "../shared/branchPairs";
import { hasCustomStyle } from "../shared/connectorStyle";
import type { ScenarioFlowNodeData, ScenarioLinkData } from "./scenarioDesignerTypes";
import type { ScenarioProfile } from "@src/profiles/ScenarioProfile";
import {
  isWorkflowFlowNode,
  type WorkflowDataSourceBinding,
  type WorkflowProfile
} from "@src/profiles/WorkflowProfile";

export type ScenarioNode = CanvasNode<ScenarioFlowNodeData>;
export type ScenarioEdge = CanvasEdge<ScenarioLinkData>;

export function toWorkflowProfile(
  nodes: ScenarioNode[],
  edges: ScenarioEdge[],
  id: string,
  name: string,
  executionMode: ScenarioProfile["executionMode"],
  maxParallelFlows: number,
  failurePolicy: ScenarioProfile["failurePolicy"],
  dataSource?: WorkflowDataSourceBinding,
  original?: WorkflowProfile | null
): WorkflowProfile {
  const orderedNodes = [...nodes].sort((a, b) => a.data.order - b.data.order);
  const originalNodeById = new Map(
    (original?.nodes ?? []).filter(isWorkflowFlowNode).map((node) => [node.id, node])
  );

  return {
    id,
    name,
    description: original ? original.description : "Saved workflow of reusable flow profiles",
    version: original?.version ?? 1,
    // Schema-documented per-workflow security override: preserved untouched (no UI authors it).
    security: original?.security,
    createdAt: original?.createdAt,
    dataSource,
    nodes: orderedNodes.map((node) =>
      node.data.kind === "flowRef"
        ? ({
            ...(originalNodeById.get(node.id) ?? node.data.originalNode ?? {}),
            id: node.id,
            type: "flowRef" as const,
            flowId: node.data.flowId,
            alias: node.data.name,
            order: node.data.order,
            required: node.data.required,
            // Preserve the STORED bindings for a loaded node. Only a brand-new node gets nothing
            // bound yet — never fabricate `{ static: <key name> }` literals again.
            inputBindings: originalNodeById.get(node.id)?.inputBindings ?? {},
            jsonPath: originalNodeById.get(node.id)?.jsonPath,
            runtimeInputKey: originalNodeById.get(node.id)?.runtimeInputKey,
            conditionRules: originalNodeById.get(node.id)?.conditionRules,
            dataSourceId: originalNodeById.get(node.id)?.dataSourceId,
            retryPolicy: originalNodeById.get(node.id)?.retryPolicy,
            failurePolicy:
              originalNodeById.get(node.id)?.failurePolicy ??
              (failurePolicy.stopOnRequiredFlowFailure ? ("stop" as const) : ("continue" as const)),
            position: node.position,
            size: { width: Math.round(node.data.width), height: Math.round(node.data.height) }
          })
        : ({
            id: node.id,
            type: node.data.kind,
            alias: node.data.name,
            order: node.data.order,
            position: node.position,
            size: { width: Math.round(node.data.width), height: Math.round(node.data.height) }
          })
    ),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.data?.linkType ?? "success",
      label: edge.data?.label,
      condition: edge.data?.expression ? { expression: edge.data.expression } : undefined,
      // Preserve an attached opaque Loop payload on legacy `loopBack` edges. The runtime continues
      // to distinguish traversal models by link type.
      loop: scenarioEdgeKind(edge.data?.linkType) === "loop" ? edge.data?.loop : undefined,
      maxLoopCount: edge.data?.linkType === "loopBack" ? edge.data.maxLoopCount : undefined,
      style: hasCustomStyle(edge.data?.style) ? edge.data?.style : undefined
    })),
    // Keep the workflow's own runtime inputs instead of injecting the demo BUSINESS/PERSONAL
    // dropdown into every saved document.
    runtimeInputs: original?.runtimeInputs ?? [],
    execution: {
      mode: executionMode,
      maxConcurrentInstances: maxParallelFlows,
      stopOnRequiredFlowFailure: failurePolicy.stopOnRequiredFlowFailure,
      // Persist the full authored failure policy so the checkboxes actually save.
      continueOnOptionalFlowFailure: failurePolicy.continueOnOptionalFlowFailure,
      takeScreenshotOnFailure: failurePolicy.takeScreenshotOnFailure
    }
  };
}
