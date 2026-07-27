import {
  isWorkflowFlowNode,
  type WorkflowNode,
  type WorkflowProfile
} from "./WorkflowProfile";

export type WorkflowValidationResult =
  | { ok: true; profile: WorkflowProfile }
  | { ok: false; errors: string[] };

export const WORKFLOW_IMPORT_ID_CONFLICT = "WORKFLOW_IMPORT_ID_CONFLICT";

const WORKFLOW_NODE_TYPE_MAP = {
  start: true,
  end: true,
  flowRef: true
} satisfies Record<WorkflowNode["type"], true>;

const WORKFLOW_NODE_TYPES = new Set<WorkflowNode["type"]>(
  Object.keys(WORKFLOW_NODE_TYPE_MAP) as WorkflowNode["type"][]
);

export function formatWorkflowConflictMessage(existingName: string, existingId: string): string {
  return (
    `${WORKFLOW_IMPORT_ID_CONFLICT}: A workflow named ${JSON.stringify(existingName)} ` +
    `already uses ID ${JSON.stringify(existingId)}.`
  );
}

export function parseWorkflowConflictName(message: string): string | undefined {
  const match = /A workflow named (".*") already uses ID ".*"\./.exec(message);
  if (!match) return undefined;
  try {
    const name = JSON.parse(match[1]);
    return typeof name === "string" ? name : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validate the persisted WorkflowProfile envelope at an import boundary.
 * Execution-time semantics remain owned by FlowValidator/ScenarioOrchestrator.
 */
export function validateWorkflowProfile(candidate: unknown): WorkflowValidationResult {
  if (!isRecord(candidate)) {
    return { ok: false, errors: ["Workflow JSON must contain an object."] };
  }

  const errors: string[] = [];

  if (!isNonEmptyString(candidate.id)) {
    errors.push("Workflow id must be a non-empty string.");
  }
  if (!isNonEmptyString(candidate.name)) {
    errors.push("Workflow name must be a non-empty string.");
  }
  if (typeof candidate.version !== "number") {
    errors.push("Workflow version must be a number.");
  }

  const nodeIds = new Set<string>();
  if (!Array.isArray(candidate.nodes)) {
    errors.push("Workflow nodes must be an array.");
  } else {
    candidate.nodes.forEach((value, index) => {
      if (!isRecord(value)) {
        errors.push(`Workflow node at index ${index} must be an object.`);
        return;
      }

      if (typeof value.id !== "string") {
        errors.push(`Workflow node at index ${index} must have a string id.`);
      } else {
        nodeIds.add(value.id);
      }

      if (
        typeof value.type !== "string" ||
        !WORKFLOW_NODE_TYPES.has(value.type as WorkflowNode["type"])
      ) {
        errors.push(`Workflow node at index ${index} must have type "start", "end", or "flowRef".`);
        return;
      }

      const node = value as unknown as WorkflowNode;
      if (isWorkflowFlowNode(node) && typeof node.flowId !== "string") {
        errors.push(`Flow reference node "${typeof value.id === "string" ? value.id : index}" must have a string flowId.`);
      }
    });
  }

  if (!Array.isArray(candidate.edges)) {
    errors.push("Workflow edges must be an array.");
  } else {
    candidate.edges.forEach((value, index) => {
      if (!isRecord(value)) {
        errors.push(`Workflow edge at index ${index} must be an object.`);
        return;
      }

      if (typeof value.id !== "string") {
        errors.push(`Workflow edge at index ${index} must have a string id.`);
      }
      if (typeof value.source !== "string") {
        errors.push(`Workflow edge at index ${index} must have a string source.`);
      } else if (!nodeIds.has(value.source)) {
        errors.push(`Workflow edge "${typeof value.id === "string" ? value.id : index}" source "${value.source}" does not match a node id.`);
      }
      if (typeof value.target !== "string") {
        errors.push(`Workflow edge at index ${index} must have a string target.`);
      } else if (!nodeIds.has(value.target)) {
        errors.push(`Workflow edge "${typeof value.id === "string" ? value.id : index}" target "${value.target}" does not match a node id.`);
      }
      if (typeof value.type !== "string") {
        errors.push(`Workflow edge at index ${index} must have a string type.`);
      }
    });
  }

  if (!Array.isArray(candidate.runtimeInputs)) {
    errors.push("Workflow runtimeInputs must be an array.");
  }

  if (!isRecord(candidate.execution)) {
    errors.push("Workflow execution must be an object.");
  } else {
    if (typeof candidate.execution.mode !== "string") {
      errors.push("Workflow execution mode must be a string.");
    }
    if (typeof candidate.execution.maxConcurrentInstances !== "number") {
      errors.push("Workflow execution maxConcurrentInstances must be a number.");
    }
    if (typeof candidate.execution.stopOnRequiredFlowFailure !== "boolean") {
      errors.push("Workflow execution stopOnRequiredFlowFailure must be a boolean.");
    }
  }

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, profile: candidate as unknown as WorkflowProfile };
}
