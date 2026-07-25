import type { FlowProfile, FlowStep } from "@src/profiles/FlowProfile";
import type { ScenarioProfile } from "@src/profiles/ScenarioProfile";
import type { ConcurrentRunProfile } from "@src/instances/ConcurrentRunProfile";
import type { RuntimeInputDefinition } from "@src/data/RuntimeInputDefinition";
import { validateRuntimeValues } from "@src/data/RuntimeInputDefinition";
import { resolveJsonPath } from "@src/data/JsonPathResolver";
import { FlowDependencyResolver } from "@src/orchestrator/FlowDependencyResolver";
import {
  isExecutionBlocking,
  validateFlowSet,
  type FlowValidationIssue
} from "@src/validation/FlowValidator";
import {
  effectiveVerdict,
  type CompatibilityGrant,
  type FlowContentDigest
} from "@src/validation/LegacyCompatibility";
import { SecurityPolicy, type SecurityPolicyIssue } from "./SecurityPolicy";

export interface PreRunValidationIssue {
  key: string;
  severity: "error" | "warning";
  message: string;
  /**
   * Whether this issue must block the run. Computed here — the gate consumes it via
   * {@link isRunBlocked} and never re-derives policy from severity alone. Scenario/runtime errors
   * (locks, offline browser, runtime inputs, …) always block. Flow-definition errors block per the
   * Stage 2c full gate: active-path and connector-structure errors always; off-path errors too,
   * unless a valid Legacy Compatibility grant tolerates them (see `legacyCompatibility` input).
   * Warnings never block.
   */
  blocking: boolean;
  /** Stable rule code, for engine-sourced flow issues (Stage 2b). */
  code?: string;
  /** Structured location, for engine-sourced flow issues. */
  flowId?: string;
  nodeId?: string;
  edgeId?: string;
  /** Active-path classification, for engine-sourced flow issues. */
  onActivePath?: boolean;
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
  /**
   * Flow ids that exist beyond `flows` (e.g. a caller passing a partial set). Merged into the
   * engine's reference context so a `runFlow` target outside `flows` is not misreported as
   * missing. When `flows` already is the full library this can be omitted.
   */
  referenceableFlowIds?: ReadonlySet<string>;
  /**
   * Legacy Compatibility grants (Stage 2c), keyed by flow id, from the main-process grant store.
   * **Absent means "no grants"** — the strict full gate, where off-path errors block too. A grant
   * only tolerates off-path errors, only while unexpired and only while the flow's executable
   * content still matches the granted hash; active-path and connector-structure errors block
   * regardless. The gate always validates fresh — a grant never substitutes for validation.
   */
  legacyCompatibility?: {
    grants: ReadonlyMap<string, CompatibilityGrant>;
    /**
     * Computes a flow's SHA-256 content digest. Supplied by the trusted boundary
     * (`app/main/validation/contentDigest.ts`) because `src/` cannot import `node:crypto`.
     *
     * **Required for any grant to be honored.** Omitting it fails closed: without a trustworthy
     * digest the gate cannot prove a granted flow is unmodified, so it applies the strict policy.
     */
    digestFor?: FlowContentDigest;
    /** Injectable clock for tests; defaults to the real time. */
    nowIso?: string;
  };
}

/** The run gate's single decision: block iff any issue is blocking. */
export function isRunBlocked(issues: readonly PreRunValidationIssue[]): boolean {
  return issues.some((issue) => issue.blocking);
}

/** The `flowId ?? config.targetFlowId` precedence the runner uses (StepExecutor.ts:955). */
function resolveRunFlowTarget(step: FlowStep): string | undefined {
  const target = step.flowId ?? step.config?.targetFlowId;
  return typeof target === "string" && target.trim() !== "" ? target : undefined;
}

/**
 * Pre-run validation — the run gate's issue source.
 *
 * Since Stage 2b this is a **thin adapter over the shared `FlowValidator` engine** for everything
 * flow-definition-shaped: it owns no flow rules of its own (the hardcoded locator-type list that
 * drifted — `awkit-acw` — is gone). What remains here is the run-*context* validation the engine
 * cannot know: scenario structure, runtime inputs, JSON bindings, concurrency, locks, offline
 * readiness and the security text policy.
 *
 * Scoping: flow-definition validation covers only the flows the scenario actually executes — the
 * scenario's flow refs plus the transitive `runFlow` closure. `input.flows` is typically the whole
 * library (execution.ipc passes `flowStore.list()`), and before Stage 2b every flow in it was
 * validated and could block the run; an unrelated broken draft in the library must not stop an
 * unrelated workflow.
 *
 * Stateless: every call validates from scratch; nothing is cached between calls, so the gate can
 * never trust a stale verdict.
 */
export class PreRunValidator {
  private readonly dependencyResolver = new FlowDependencyResolver();
  private readonly securityPolicy = new SecurityPolicy();

  validate(input: PreRunValidationInput): PreRunValidationIssue[] {
    const issues: PreRunValidationIssue[] = [];
    const flowIds = new Set(input.flows.map((flow) => flow.id));

    if (!input.scenario) {
      issues.push({ key: "scenario", severity: "error", blocking: true, message: "Scenario exists." });
      return issues;
    }

    this.dependencyResolver
      .validate(input.scenario)
      .forEach((issue) => issues.push({ key: issue.id, severity: issue.severity, blocking: issue.severity === "error", message: issue.message }));

    input.scenario.flows.forEach((flowRef) => {
      if (!flowIds.has(flowRef.flowId)) {
        issues.push({ key: `flow.${flowRef.flowId}`, severity: "error", blocking: true, message: `Referenced flow is missing: ${flowRef.flowId}.` });
      }
    });

    const relevantFlows = this.resolveRelevantFlows(input.scenario, input.flows);

    // ── Flow definitions: delegated to the shared engine ─────────────────────
    const referenceable = new Set<string>(flowIds);
    for (const id of input.referenceableFlowIds ?? []) referenceable.add(id);
    const flowSetReport = validateFlowSet(relevantFlows, { referenceableFlowIds: referenceable });

    // Stage 2c blocking policy, one flow at a time: `effectiveVerdict` decides which errors block,
    // honouring a valid Legacy Compatibility grant (off-path errors only, unexpired, content
    // unchanged). Without a grant the full gate applies and off-path errors block too.
    const nowIso = input.legacyCompatibility?.nowIso ?? new Date().toISOString();
    const flowsById = new Map(relevantFlows.map((flow) => [flow.id, flow]));
    let issueIndex = 0;
    const digestFor = input.legacyCompatibility?.digestFor;
    for (const report of flowSetReport.reports) {
      const flow = flowsById.get(report.flowId);
      const grant = input.legacyCompatibility?.grants.get(report.flowId);
      // No digest function, or no flow → empty digest → `compatibilityStanding` fails closed.
      const digest = flow && digestFor ? digestFor(flow) : "";
      const verdict = effectiveVerdict(report, grant, digest, nowIso);
      const blocking = new Set(verdict.blockingIssues);
      for (const issue of report.issues) {
        issues.push(this.toPreRunIssue(issue, issueIndex, blocking.has(issue)));
        issueIndex += 1;
      }
      // "Never silent": a run tolerated by a grant announces itself as a warning the UI and run
      // report can show, carrying the flow id so the caller can audit the run against the grant.
      if (verdict.underCompatibility && grant) {
        issues.push({
          key: `legacyCompatibility.${report.flowId}`,
          severity: "warning",
          blocking: false,
          flowId: report.flowId,
          message: `Flow ${flow?.name ?? report.flowId} runs under Legacy Compatibility until ${grant.expiresAt.slice(0, 10)} — ${verdict.toleratedIssues.length} off-path error(s) tolerated. Fix or migrate it before the deadline.`
        });
      }
    }
    // Set-level issues (duplicate flow ids, runFlow cycles) are never grant-tolerable.
    for (const issue of flowSetReport.issues) {
      issues.push(this.toPreRunIssue(issue, issueIndex, isExecutionBlocking(issue)));
      issueIndex += 1;
    }

    // ── Run context: rules the engine cannot know ────────────────────────────
    relevantFlows.forEach((flow) => {
      flow.nodes.forEach((step) => {
        const text = `${step.name} ${step.description ?? ""} ${step.message ?? ""}`;
        this.securityPolicy.validateText(text).forEach((issue) => issues.push(this.toSecurityIssue(`security.${step.id}`, issue)));

        if (step.valueSource?.type === "json" && input.jsonData && step.valueSource.file && step.valueSource.path) {
          try {
            resolveJsonPath(input.jsonData[step.valueSource.file], step.valueSource.path);
          } catch (error) {
            issues.push({
              key: `json.${step.id}`,
              severity: "error",
              blocking: true,
              message: error instanceof Error ? error.message : `JSON path failed for ${step.name}.`
            });
          }
        }
      });
    });

    validateRuntimeValues(input.runtimeInputDefinitions ?? [], input.runtimeInputs ?? {}).forEach((issue) =>
      issues.push({ key: `runtime.${issue.key}`, severity: "error", blocking: true, message: issue.message })
    );

    if (input.runProfile && input.runProfile.maxConcurrentInstances < 1) {
      issues.push({ key: "concurrency", severity: "error", blocking: true, message: "Concurrency settings must allow at least one instance." });
    }

    (input.lockConflicts ?? []).forEach((conflict) => {
      issues.push({ key: `lock.${conflict}`, severity: "error", blocking: true, message: `Resource lock conflict: ${conflict}.` });
    });

    if (input.productionOffline && !input.bundledBrowserExists) {
      issues.push({ key: "offline.browser", severity: "error", blocking: true, message: "Bundled browser exists in production offline mode." });
    }

    if (input.runtimeFoldersWritable === false) {
      issues.push({ key: "folders", severity: "error", blocking: true, message: "Runtime folders are writable." });
    }

    return issues;
  }

  /**
   * The flows this scenario actually executes: its flow refs plus the transitive `runFlow`
   * closure, resolved within the supplied set. Order-stable (input order) so reports are
   * deterministic.
   */
  private resolveRelevantFlows(scenario: ScenarioProfile, flows: FlowProfile[]): FlowProfile[] {
    const byId = new Map(flows.map((flow) => [flow.id, flow]));
    const relevant = new Set<string>();
    const queue = scenario.flows.map((flowRef) => flowRef.flowId);

    while (queue.length > 0) {
      const id = queue.shift() as string;
      if (relevant.has(id)) continue;
      const flow = byId.get(id);
      if (!flow) continue; // Reported above as a missing scenario reference.
      relevant.add(id);
      for (const step of Array.isArray(flow.nodes) ? flow.nodes : []) {
        if (step.type !== "runFlow") continue;
        const target = resolveRunFlowTarget(step);
        if (target !== undefined && !relevant.has(target)) queue.push(target);
      }
    }

    return flows.filter((flow) => relevant.has(flow.id));
  }

  private toPreRunIssue(issue: FlowValidationIssue, index: number, blocking: boolean): PreRunValidationIssue {
    const anchor = issue.nodeId ?? issue.edgeId ?? "flow";
    const result: PreRunValidationIssue = {
      key: `validation.${issue.flowId}.${issue.code}.${anchor}.${index}`,
      severity: issue.severity,
      blocking,
      message: issue.message,
      code: issue.code,
      flowId: issue.flowId,
      onActivePath: issue.onActivePath
    };
    if (issue.nodeId !== undefined) result.nodeId = issue.nodeId;
    if (issue.edgeId !== undefined) result.edgeId = issue.edgeId;
    return result;
  }

  private toSecurityIssue(key: string, issue: SecurityPolicyIssue): PreRunValidationIssue {
    return { key, severity: issue.severity, blocking: issue.severity === "error", message: issue.message };
  }
}
