import type { FlowProfile } from "@src/profiles/FlowProfile";
import type { ScenarioProfile } from "@src/profiles/ScenarioProfile";
import type { ConcurrentRunProfile } from "@src/instances/ConcurrentRunProfile";
import type { RuntimeInputDefinition } from "@src/data/RuntimeInputDefinition";
import { validateRuntimeValues } from "@src/data/RuntimeInputDefinition";
import { resolveJsonPath } from "@src/data/JsonPathResolver";
import { FlowDependencyResolver } from "@src/orchestrator/FlowDependencyResolver";
import { SecurityPolicy, type SecurityPolicyIssue } from "./SecurityPolicy";

export interface PreRunValidationIssue {
  key: string;
  severity: "error" | "warning";
  message: string;
}

export interface PreRunValidationInput {
  scenario?: ScenarioProfile;
  flows: FlowProfile[];
  runProfile?: ConcurrentRunProfile;
  runtimeInputDefinitions?: RuntimeInputDefinition[];
  runtimeInputs?: Record<string, unknown>;
  jsonData?: Record<string, unknown>;
  productionOffline?: boolean;
  bundledBrowserExists?: boolean;
  runtimeFoldersWritable?: boolean;
  lockConflicts?: string[];
}

export class PreRunValidator {
  private readonly dependencyResolver = new FlowDependencyResolver();
  private readonly securityPolicy = new SecurityPolicy();

  validate(input: PreRunValidationInput): PreRunValidationIssue[] {
    const issues: PreRunValidationIssue[] = [];
    const flowIds = new Set(input.flows.map((flow) => flow.id));

    if (!input.scenario) {
      issues.push({ key: "scenario", severity: "error", message: "Scenario exists." });
      return issues;
    }

    this.dependencyResolver.validate(input.scenario).forEach((issue) => issues.push({ key: issue.id, severity: issue.severity, message: issue.message }));

    input.scenario.flows.forEach((flowRef) => {
      if (!flowIds.has(flowRef.flowId)) {
        issues.push({ key: `flow.${flowRef.flowId}`, severity: "error", message: `Referenced flow is missing: ${flowRef.flowId}.` });
      }
    });

    input.flows.forEach((flow) => {
      flow.nodes.forEach((step) => {
        const text = `${step.name} ${step.description ?? ""} ${step.message ?? ""}`;
        this.securityPolicy.validateText(text).forEach((issue) => issues.push(this.toPreRunIssue(`security.${step.id}`, issue)));

        if (["click", "fill", "select", "check", "uncheck", "uploadFile", "downloadFile", "readText", "assertText", "assertVisible"].includes(step.type) && !step.locator) {
          issues.push({ key: `locator.${step.id}`, severity: "error", message: `Step ${step.name} requires a locator.` });
        }

        if (step.valueSource?.type === "json" && input.jsonData && step.valueSource.file && step.valueSource.path) {
          try {
            resolveJsonPath(input.jsonData[step.valueSource.file], step.valueSource.path);
          } catch (error) {
            issues.push({
              key: `json.${step.id}`,
              severity: "error",
              message: error instanceof Error ? error.message : `JSON path failed for ${step.name}.`
            });
          }
        }
      });
    });

    validateRuntimeValues(input.runtimeInputDefinitions ?? [], input.runtimeInputs ?? {}).forEach((issue) =>
      issues.push({ key: `runtime.${issue.key}`, severity: "error", message: issue.message })
    );

    if (input.runProfile && input.runProfile.maxConcurrentInstances < 1) {
      issues.push({ key: "concurrency", severity: "error", message: "Concurrency settings must allow at least one instance." });
    }

    (input.lockConflicts ?? []).forEach((conflict) => {
      issues.push({ key: `lock.${conflict}`, severity: "error", message: `Resource lock conflict: ${conflict}.` });
    });

    if (input.productionOffline && !input.bundledBrowserExists) {
      issues.push({ key: "offline.browser", severity: "error", message: "Bundled browser exists in production offline mode." });
    }

    if (input.runtimeFoldersWritable === false) {
      issues.push({ key: "folders", severity: "error", message: "Runtime folders are writable." });
    }

    return issues;
  }

  private toPreRunIssue(key: string, issue: SecurityPolicyIssue): PreRunValidationIssue {
    return { key, severity: issue.severity, message: issue.message };
  }
}
