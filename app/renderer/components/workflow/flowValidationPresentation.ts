import type { FlowValidationIssue, FlowValidationReport } from "@src/validation/FlowValidator";
import { createInteractionDecisionBinding, isValidInteractionExecutionDecision, supportsAutomaticPrerequisiteTrial } from "@src/profiles/interactionPrerequisiteDecision";
import { toFlowStep, type FlowDesignerNode } from "./flowProfileMapping";
import type { FlowDesignerNodeData } from "./flowDesignerTypes";

export interface DesignerValidationAdvisory {
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface DesignerValidationFinding extends DesignerValidationAdvisory {
  key: string;
  severity: "error" | "warning";
  blocking: boolean;
  actionLabel: string;
}

const LOCATOR_CODES = new Set(["missingRequiredLocator", "locatorNeedsReview", "locatorQuality"]);

/** Presentation only: the complete engine report remains the authority for execution. */
export function presentFlowValidation(
  report: FlowValidationReport,
  advisories: readonly DesignerValidationAdvisory[] = []
): DesignerValidationFinding[] {
  const findings = new Map<string, DesignerValidationFinding>();
  const add = (issue: DesignerValidationAdvisory, severity: "error" | "warning", blocking: boolean) => {
    // Quality, unresolved review and a missing target describe one locator repair. Other codes
    // retain their message in the key: two invalid waits on one step may need separate repairs.
    const root = LOCATOR_CODES.has(issue.code) ? "locator" : `${issue.code}:${issue.message}`;
    const key = `${issue.nodeId ?? issue.edgeId ?? "flow"}:${root}`;
    if (findings.has(key)) return;
    findings.set(key, {
      ...issue,
      message: issue.code === "interactionPrerequisiteBlocked"
        ? issue.message.replace("Choose Try direct action, confirm no prerequisite, or re-record it.", "Review direct-action eligibility for this exact target.")
        : issue.message,
      key,
      severity,
      blocking,
      actionLabel: LOCATOR_CODES.has(issue.code)
        ? "Review locator"
        : issue.code === "interactionPrerequisiteBlocked"
          ? "Review direct action"
          : issue.edgeId ? "Review connection" : issue.nodeId ? "Review step" : "Review flow"
    });
  };
  for (const issue of report.issues) {
    add(issue, issue.severity, issue.severity === "error" && (issue.onActivePath || issue.code === "connectorStructure"));
  }
  for (const advisory of advisories) add(advisory, "warning", false);
  return [...findings.values()];
}

export function findingsForNode(findings: readonly DesignerValidationFinding[], nodeId: string): DesignerValidationFinding[] {
  return findings.filter((finding) => finding.nodeId === nodeId);
}

/** Use the exact persistence projection, including frame/container context and stale decisions. */
export function interactionReviewForNode(node: FlowDesignerNode) {
  const step = toFlowStep(node, []);
  return {
    step,
    trialSupported: supportsAutomaticPrerequisiteTrial(step),
    decisionValid: isValidInteractionExecutionDecision(step)
  };
}

/** A real, reason-bound policy change; Playwright still proves actionability when the flow runs. */
export function confirmDirectActionPatch(node: FlowDesignerNode, reason: string): Partial<FlowDesignerNodeData> | undefined {
  const { step, trialSupported } = interactionReviewForNode(node);
  const trimmedReason = reason.trim();
  if (!trialSupported || !step.locator?.identity || step.locator.prerequisite?.status !== "unknown" || trimmedReason.length < 8) return undefined;
  return {
    locatorExecutionDecision: {
      schemaVersion: 1,
      status: "user-confirmed",
      reason: trimmedReason,
      binding: createInteractionDecisionBinding(step)
    }
  };
}

export type ValidationLocation = Pick<FlowValidationIssue, "nodeId" | "edgeId">;
