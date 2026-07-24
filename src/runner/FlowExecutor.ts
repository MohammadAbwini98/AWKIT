import type { FlowEdge, FlowProfile, FlowStep, LoopConnectorConfig } from "@src/profiles/FlowProfile";
import { connectorKind, validateConnectorStructure } from "@src/profiles/FlowProfile";
import { normalizeFlowBounds } from "@src/profiles/FlowValidation";
import { materializeDataSourceRows, type InstanceExecutionContext } from "./InstanceExecutionContext";
import { evaluateBoolean } from "./ExpressionEvaluator";
import { evaluateConnectorCondition, type NodeOutcomeView } from "./ConnectorConditionEvaluator";
import { loadConcurrencyLimits } from "./concurrency/ConcurrencyConfig";
import { RetryPolicy } from "./runtime/RetryPolicy";
import type { RunnerProgressReporter } from "./RunnerProgress";
import type { FlowExecutionResult, RunnerLogger, StepExecutionResult } from "./RunnerResult";
import { StepExecutor } from "./StepExecutor";

/** Hard cap on loop-connector iterations regardless of configured maxIterations. */
const LOOP_CONNECTOR_HARD_CAP = 1000;

/** Max times a flow may auto-restart from Start after an Auto Secure Login capture. */
const MAX_AUTO_LOGIN_RESTART = 1;

/** An isolated executor bound to its own page (used for concurrent parallel branches). */
export interface IsolatedBranchExecutor {
  execute(step: FlowStep): Promise<StepExecutionResult>;
  close(): Promise<void>;
}

/** Creates an isolated branch executor (new page in the shared browser context). */
export type ParallelBranchFactory = () => Promise<IsolatedBranchExecutor>;

export class FlowExecutor {
  /** Classified retry decisions: dangerous mutations and dead-browser failures are never blindly re-run. */
  private readonly retryPolicy = new RetryPolicy();
  /** Host concurrency limits (env-overridable) — bounds isolated parallel branches per flow. */
  private readonly concurrencyLimits = loadConcurrencyLimits();

  constructor(
    private readonly stepExecutor: StepExecutor,
    private readonly logger?: RunnerLogger,
    private readonly progress?: RunnerProgressReporter,
    private readonly branchExecutorFactory?: ParallelBranchFactory,
    /**
     * Artifact-profile default (`resolveArtifactSettings().screenshotOnFailure`) for capturing a
     * failure screenshot on a step with NO explicit `onFailure.screenshot` override — the middle
     * tier of the awkit-5yx precedence contract. Defaults to `true` so direct FlowExecutor users
     * (verify scripts) and the historical always-capture path are unchanged.
     */
    private readonly screenshotOnFailureDefault: boolean = true
  ) {}

  /**
   * Emit a connector-level event to the live report timeline (no step node). Uses a non-"running"
   * status so it always appends; `skipped` → info, `waiting` → warning, `failed` → error. No secrets.
   */
  private emitConnectorEvent(context: InstanceExecutionContext, message: string, level: "info" | "warning" | "error" = "info"): void {
    if (!this.progress) return;
    const status = level === "error" ? "failed" : level === "warning" ? "waiting" : "skipped";
    this.progress.report({
      instanceId: context.instanceId,
      flowId: context.flowId,
      status,
      message,
      timestamp: new Date().toISOString()
    });
  }

  async executeFlow(flow: FlowProfile, context: InstanceExecutionContext): Promise<FlowExecutionResult> {
    const startedAt = new Date().toISOString();
    const steps: StepExecutionResult[] = [];
    const outputs: Record<string, unknown> = {};

    const startStep = flow.nodes.find((node) => node.type === "start") ?? flow.nodes[0];
    if (!startStep) {
      throw new Error(`Flow ${flow.id} does not contain any nodes.`);
    }

    // Runtime safeguard (Points 2–4): refuse to execute a structurally invalid connector
    // graph even if it somehow bypassed the Flow Designer's save-time validation.
    const structuralIssues = validateConnectorStructure(flow.edges);
    if (structuralIssues.length) {
      return this.finish(flow.id, startedAt, steps, outputs, "failed", structuralIssues[0]);
    }

    // Runtime bounds normalization (audit F-03): clamp DoS-prone timeouts / iteration counts /
    // oversized arrays from manipulated flow JSON before executing. Lenient — never rejects the run.
    const boundsWarnings = normalizeFlowBounds(flow);
    if (boundsWarnings.length) {
      console.warn(`[flow ${flow.id}] normalized ${boundsWarnings.length} out-of-bounds field(s): ${boundsWarnings.slice(0, 5).join(" ")}`);
    }

    const byId = new Map(flow.nodes.map((node) => [node.id, node]));
    let currentStep: FlowStep | undefined = startStep;
    const visited = new Set<string>();
    // Enhanced Connectors: how many times each loopBack edge has been traversed.
    const loopBackCounts = new Map<string, number>();
    // Auto Secure Login: how many times the flow has restarted from Start after a capture.
    let autoLoginRestartCount = 0;

    this.log("info", context, `Starting flow ${flow.name}`);

    while (currentStep) {
      // A node may only be revisited when a loopBack edge cleared `visited` for this
      // iteration (see resolveNext). Any other re-entry is a genuine runtime cycle.
      if (visited.has(currentStep.id)) {
        throw new Error(`Flow ${flow.id} contains a runtime cycle at step ${currentStep.id}.`);
      }
      visited.add(currentStep.id);

      // Loop connectors are self-loops (Point 4): a node with one repeats itself per the
      // loop config instead of a single execution, then continues via its own (Conditional,
      // per Point 3) exit edge. `executeLoopConnector` already pushes every iteration's
      // result into `steps`/`outputs`.
      const selfLoopEdge = flow.edges.find(
        (edge) => edge.source === currentStep!.id && edge.target === currentStep!.id && connectorKind(edge) === "loop" && edge.loop
      );
      let stepResult: StepExecutionResult;
      if (selfLoopEdge) {
        const loopOutcome = await this.executeLoopConnector(flow, selfLoopEdge.loop!, currentStep, steps, outputs, context);
        // A loop source with zero resolved values (e.g. an empty data source) never runs an
        // iteration — treat it as a no-op pass so the flow still proceeds via the exit edge.
        stepResult = loopOutcome.lastResult ?? { stepId: currentStep.id, status: "passed", startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), durationMs: 0, outputs: {} };
      } else {
        stepResult = await this.executeWithRetry(currentStep, context);
        steps.push(stepResult);
        Object.entries(stepResult.outputs).forEach(([key, value]) => {
          outputs[`${flow.id}.${key}`] = value;
        });
      }

      if (stepResult.status === "manualHandoff") {
        return this.finish(flow.id, startedAt, steps, outputs, "manualHandoff", undefined, stepResult.manualHandoff);
      }

      if (stepResult.status === "failed") {
        const failureResult = await this.handleFailure(currentStep, stepResult, flow, byId);
        if (failureResult.stop) {
          return this.finish(flow.id, startedAt, steps, outputs, "failed", stepResult.error);
        }
        currentStep = failureResult.nextStep;
        continue;
      }

      // Auto Secure Login restart: after a fresh capture, re-run the flow from Start so the
      // node now finds the saved session and skips itself. Guarded to prevent infinite restarts.
      if (stepResult.restartRequired) {
        if (autoLoginRestartCount >= MAX_AUTO_LOGIN_RESTART) {
          return this.finish(
            flow.id,
            startedAt,
            steps,
            outputs,
            "failed",
            "Auto secure login captured a session, but the flow could not reuse it after restart."
          );
        }
        autoLoginRestartCount += 1;
        this.log("info", context, `Auto Secure Login restart ${autoLoginRestartCount}/${MAX_AUTO_LOGIN_RESTART} — restarting flow from Start.`);
        this.emitConnectorEvent(context, `Auto Secure Login: session captured — restarting flow (${autoLoginRestartCount}/${MAX_AUTO_LOGIN_RESTART}).`, "warning");
        visited.clear();
        loopBackCounts.clear();
        currentStep = startStep;
        continue;
      }

      // Parallel connectors: fan out to every parallel target (sequential fan-out) and
      // converge per the join/fail mode before following the primary (success/always) edge.
      const parallelEdges = flow.edges.filter((edge) => edge.source === currentStep!.id && connectorKind(edge) === "parallel");
      if (parallelEdges.length) {
        const pcfg = parallelEdges.find((edge) => edge.parallel)?.parallel;
        this.emitConnectorEvent(context, `Parallel fan-out: ${parallelEdges.length} branch(es) (${pcfg?.joinMode ?? "waitAll"}/${pcfg?.failMode ?? "failFast"}).`);
        const parallel = await this.executeParallelTargets(flow, parallelEdges, steps, outputs, context, visited, byId);
        if (!parallel.success) {
          return this.finish(flow.id, startedAt, steps, outputs, "failed", parallel.error);
        }
      }

      if (currentStep.type === "end") {
        return this.finish(flow.id, startedAt, steps, outputs, "passed");
      }

      const next = this.resolveNext(flow, currentStep, stepResult, outputs, context, loopBackCounts);
      // A loopBack re-opens the loop body for another pass.
      if (next.viaLoopBack) visited.clear();
      currentStep = next.nextStepId ? byId.get(next.nextStepId) : undefined;
    }

    return this.finish(flow.id, startedAt, steps, outputs, "passed");
  }

  /**
   * Execute parallel edges as sequential fan-out honoring the connector's join/fail mode:
   * - joinMode `waitAll` runs every branch; `waitAny` stops after the first success.
   * - failMode `failFast` fails the group on the first failure; `collectErrors` runs all
   *   and reports every failure.
   * Sequential execution IS the shared-page safety guard (no concurrent UI mutation). The
   * config defaults (waitAll + failFast) reproduce the legacy behavior for edges with no config.
   */
  private async executeParallelTargets(
    flow: FlowProfile,
    parallelEdges: FlowEdge[],
    steps: StepExecutionResult[],
    outputs: Record<string, unknown>,
    context: InstanceExecutionContext,
    visited: Set<string>,
    byId: Map<string, FlowStep>
  ): Promise<{ success: boolean; error?: string }> {
    const cfg = parallelEdges.find((edge) => edge.parallel)?.parallel;
    const joinMode = cfg?.joinMode ?? "waitAll";
    const failMode = cfg?.failMode ?? "failFast";

    // Opt-in concurrent execution: each branch runs on its own page (isolated DOM, shared
    // session) when isolation is `isolatedPage` and a branch factory is available.
    if (cfg?.isolation === "isolatedPage" && this.branchExecutorFactory) {
      return this.executeParallelIsolated(flow, parallelEdges, steps, outputs, context, visited, byId, cfg);
    }

    const errors: string[] = [];
    let anySucceeded = false;

    for (const edge of parallelEdges) {
      const targetStep = byId.get(edge.target);
      if (!targetStep) continue;
      // Parallel targets are still subject to the cycle guard.
      if (visited.has(targetStep.id)) continue;
      visited.add(targetStep.id);

      const result = await this.executeWithRetry(targetStep, context);
      steps.push(result);
      Object.entries(result.outputs).forEach(([key, value]) => {
        outputs[`${flow.id}.${key}`] = value;
      });
      this.log("info", context, `Parallel branch (${joinMode}/${failMode}) → ${targetStep.name} (${result.status}).`);

      if (result.status === "failed") {
        errors.push(result.error ?? `Parallel branch ${targetStep.name} failed.`);
        if (failMode === "failFast") return { success: false, error: errors.join("; ") };
      } else {
        anySucceeded = true;
        if (joinMode === "waitAny") return { success: true };
      }
    }

    if (joinMode === "waitAny" && !anySucceeded) {
      return { success: false, error: errors.length ? errors.join("; ") : "No parallel branch succeeded (waitAny)." };
    }
    if (errors.length) return { success: false, error: errors.join("; ") };
    return { success: true };
  }

  /**
   * Concurrent parallel execution: each branch target runs on its own isolated page (shared
   * browser context → shared cookies/session, independent DOM/navigation), bounded by
   * `maxConcurrency`. Branches run to completion, then the join/fail mode is applied to the
   * collected results (waitAll = all must pass; waitAny = at least one passed). Note: because
   * branches are truly concurrent, `failFast` reports failure after they settle rather than
   * hard-aborting in-flight branches.
   */
  private async executeParallelIsolated(
    flow: FlowProfile,
    parallelEdges: FlowEdge[],
    steps: StepExecutionResult[],
    outputs: Record<string, unknown>,
    context: InstanceExecutionContext,
    visited: Set<string>,
    byId: Map<string, FlowStep>,
    cfg: NonNullable<FlowEdge["parallel"]>
  ): Promise<{ success: boolean; error?: string }> {
    const targets: FlowStep[] = [];
    for (const edge of parallelEdges) {
      const targetStep = byId.get(edge.target);
      if (!targetStep || visited.has(targetStep.id)) continue;
      visited.add(targetStep.id);
      targets.push(targetStep);
    }
    if (!targets.length) return { success: true };

    // Bounded node parallelism: the connector's maxConcurrency is additionally clamped by the
    // host limit (maxActiveNodesPerFlow, env-overridable) so one flow can't open unbounded pages.
    const requested = Math.max(1, cfg.maxConcurrency ?? targets.length);
    const maxConcurrency = Math.min(requested, this.concurrencyLimits.maxActiveNodesPerFlow);
    if (maxConcurrency < requested) {
      this.emitConnectorEvent(context, `Parallel concurrency clamped ${requested} → ${maxConcurrency} (host limit maxActiveNodesPerFlow).`, "warning");
    }
    this.log("info", context, `Parallel (isolatedPage, concurrency ${maxConcurrency}) → ${targets.map((t) => t.name).join(", ")}.`);

    const runBranch = async (target: FlowStep): Promise<StepExecutionResult> => {
      const branch = await this.branchExecutorFactory!();
      try {
        return await branch.execute(target);
      } catch (error) {
        return {
          stepId: target.id,
          status: "failed",
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          durationMs: 0,
          outputs: {},
          error: error instanceof Error ? error.message : String(error)
        };
      } finally {
        await branch.close().catch(() => undefined);
      }
    };

    // Bounded concurrency: run targets in chunks of maxConcurrency, preserving target order.
    const results: StepExecutionResult[] = [];
    for (let i = 0; i < targets.length; i += maxConcurrency) {
      const chunk = targets.slice(i, i + maxConcurrency);
      const chunkResults = await Promise.all(chunk.map((target) => runBranch(target)));
      results.push(...chunkResults);
    }

    const errors: string[] = [];
    let anySucceeded = false;
    results.forEach((result, index) => {
      steps.push(result);
      Object.entries(result.outputs).forEach(([key, value]) => {
        outputs[`${flow.id}.${key}`] = value;
      });
      if (result.status === "failed") errors.push(result.error ?? `Parallel branch ${targets[index].name} failed.`);
      else anySucceeded = true;
    });

    if (cfg.joinMode === "waitAny") {
      return anySucceeded ? { success: true } : { success: false, error: errors.join("; ") || "No parallel branch succeeded (waitAny)." };
    }
    // waitAll: every branch must have succeeded.
    if (errors.length) return { success: false, error: errors.join("; ") };
    return { success: true };
  }

  /**
   * Execute a loop connector: run `target` (the loop-controlled node itself — loop connectors
   * are self-loops, Point 4) repeatedly per the loop config, injecting the loop value under
   * `parameterName` (readable via a runtimeInput value source). Bounded by maxIterations and
   * a hard cap; stops (and fails) on a failed iteration.
   */
  private async executeLoopConnector(
    flow: FlowProfile,
    cfg: LoopConnectorConfig,
    target: FlowStep,
    steps: StepExecutionResult[],
    outputs: Record<string, unknown>,
    context: InstanceExecutionContext
  ): Promise<{ success: boolean; error?: string; lastResult?: StepExecutionResult }> {
    const maxIterations = Math.max(1, Math.min(cfg.maxIterations || 1, LOOP_CONNECTOR_HARD_CAP));
    const values = await this.resolveLoopValues(cfg, context, maxIterations);
    const paramKey = cfg.parameterName?.trim();
    const previous = paramKey ? context.runtimeInputs[paramKey] : undefined;
    let lastResult: StepExecutionResult | undefined;
    let iteration = 0;

    try {
      for (const value of values) {
        if (iteration >= maxIterations) break;
        // whileCondition: after the first pass, keep looping only while the condition holds.
        if (cfg.mode === "whileCondition" && cfg.condition && lastResult) {
          const view: NodeOutcomeView = {
            status: lastResult.status,
            outcome: lastResult.outcome,
            outputs: lastResult.outputs,
            errorCode: lastResult.errorCode
          };
          if (!evaluateConnectorCondition(cfg.condition, view, this.makeScope(outputs, context))) break;
        }

        if (paramKey) context.runtimeInputs[paramKey] = value as never;
        const result = await this.executeWithRetry(target, context);
        steps.push(result);
        Object.entries(result.outputs).forEach(([key, val]) => {
          outputs[`${flow.id}.${key}`] = val;
        });
        lastResult = result;
        iteration += 1;
        this.log("info", context, `Loop iteration ${iteration}/${maxIterations} → ${target.name} (${result.status}).`);
        this.emitConnectorEvent(context, `Loop iteration ${iteration}/${maxIterations} → ${target.name}.`);

        if (result.status === "manualHandoff") {
          return { success: false, error: "Loop connector target requested a manual handoff (unsupported in a loop).", lastResult };
        }
        if (result.status === "failed") {
          return { success: false, error: result.error ?? `Loop iteration ${iteration} failed.`, lastResult };
        }
        if (cfg.delayMs && cfg.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, cfg.delayMs));
      }
    } finally {
      if (paramKey) context.runtimeInputs[paramKey] = previous as never;
    }

    return { success: true, lastResult };
  }

  /** Build the ordered list of loop values for a loop connector. */
  private async resolveLoopValues(cfg: LoopConnectorConfig, context: InstanceExecutionContext, maxIterations: number): Promise<unknown[]> {
    switch (cfg.mode) {
      case "staticList":
        return (cfg.staticValues ?? []).slice(0, maxIterations);
      case "dataSource": {
        const dataSource = cfg.dataSourceId ? context.dataSources?.[cfg.dataSourceId] : context.workflowDataSource;
        const rows = dataSource ? await materializeDataSourceRows(dataSource) : [];
        const binding = cfg.dataSourceBinding?.trim();
        const values = binding ? rows.map((row) => (row && typeof row === "object" ? (row as Record<string, unknown>)[binding] : undefined)) : rows;
        return values.slice(0, maxIterations);
      }
      case "count":
      case "whileCondition":
      default:
        return Array.from({ length: maxIterations }, (_, index) => index + 1);
    }
  }

  /**
   * Execute a step with classified retries. The step's configured `retry.count` is still the
   * upper bound, but each retry is gated by the RetryPolicy: only transient error classes
   * (navigation/timeout/locator/download) are re-run, with exponential backoff; steps whose
   * name/value looks like a non-idempotent business action (submit/approve/delete/send/pay/
   * confirm) and dead browser/context/page failures are never blindly retried.
   */
  private async executeWithRetry(step: FlowStep, context?: InstanceExecutionContext): Promise<StepExecutionResult> {
    const retryCount = step.retry?.count ?? 0;
    let lastResult: StepExecutionResult | undefined;

    const logRetry = (level: "info" | "warn", message: string): void => {
      this.logger?.log({
        timestamp: new Date().toISOString(),
        level,
        executionId: context?.executionId ?? "",
        instanceId: context?.instanceId,
        scenarioId: context?.scenarioId,
        flowId: context?.flowId,
        stepId: step.id,
        message
      });
    };

    for (let attempt = 0; ; attempt += 1) {
      const result = await this.stepExecutor.execute(step);
      if (result.status !== "failed") return result;
      lastResult = result;

      const decision = this.retryPolicy.decide({ step, error: result.error, attempt });
      if (!decision.retry) {
        // Only log a "retry blocked" line when a retry was actually configured but denied.
        if (attempt < retryCount) {
          logRetry("warn", `Retry blocked for step "${step.name ?? step.id}": ${decision.reason} (error class: ${decision.errorClass}).`);
        }
        break;
      }

      logRetry("info", `Retrying step "${step.name ?? step.id}" in ${decision.delayMs}ms — ${decision.reason}.`);
      if (decision.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, decision.delayMs));
    }

    // Failure-screenshot precedence (awkit-5yx): an explicit per-step override
    // (`step.onFailure.screenshot`) wins; otherwise the resolved artifact-profile default governs;
    // the constructor default (true) is the safe system fallback. Best-effort — never let a
    // screenshot problem (e.g. dead page) mask the original step error.
    if ((step.onFailure?.screenshot ?? this.screenshotOnFailureDefault) && lastResult && !lastResult.screenshotPath) {
      lastResult.screenshotPath = await this.stepExecutor.captureFailureScreenshot(step).catch(() => undefined);
    }

    return lastResult!;
  }

  private async handleFailure(
    step: FlowStep,
    stepResult: StepExecutionResult,
    flow: FlowProfile,
    byId: Map<string, FlowStep>
  ): Promise<{ stop: boolean; nextStep?: FlowStep }> {
    const action = step.onFailure?.action ?? "stop";

    if (action === "continue") {
      const nextStepId = step.next ?? this.resolveEdgeTarget(flow.edges, step.id, "success");
      return { stop: false, nextStep: nextStepId ? byId.get(nextStepId) : undefined };
    }

    if (action === "goToFailureEdge") {
      const nextStepId = this.resolveEdgeTarget(flow.edges, step.id, "failure");
      return { stop: !nextStepId, nextStep: nextStepId ? byId.get(nextStepId) : undefined };
    }

    if (action === "manualHandoff") {
      return { stop: true };
    }

    return { stop: true };
  }

  private resolveEdgeTarget(edges: FlowEdge[], source: string, type: FlowEdge["type"]): string | undefined {
    return edges.find((edge) => edge.source === source && edge.type === type)?.target ?? edges.find((edge) => edge.source === source && edge.type === "always")?.target;
  }

  /**
   * Connector-aware next-step routing (Enhanced Connectors).
   *
   * Precedence: condition-node branch → outcome edges (step's own result) →
   * conditional edges (flow scope) → conditional loopBack → success → always →
   * unconditional loopBack (last resort) → legacy `next`.
   *
   * Returns `viaLoopBack` so the caller can re-open the loop body for another pass.
   * loopBack traversals are gated by each edge's `maxLoopCount` (default 2); once
   * exhausted, routing falls through to success/always so the loop terminates cleanly
   * instead of raising a runtime-cycle error.
   */
  private resolveNext(
    flow: FlowProfile,
    step: FlowStep,
    stepResult: StepExecutionResult,
    outputs: Record<string, unknown>,
    context: InstanceExecutionContext,
    loopBackCounts: Map<string, number>
  ): { nextStepId?: string; viaLoopBack: boolean } {
    if (stepResult.nextStepId) return { nextStepId: stepResult.nextStepId, viaLoopBack: false };

    const outgoing = flow.edges.filter((edge) => edge.source === step.id);
    if (!outgoing.length) return { nextStepId: step.next, viaLoopBack: false };

    const getValue = this.makeScope(outputs, context);
    // Enhanced scope: expose the step's own result outputs as `${stepResult.xxx}`.
    const getValueWithStepResult = (path: string): unknown => {
      if (path.startsWith("stepResult.")) return stepResult.outputs[path.slice("stepResult.".length)];
      return getValue(path);
    };
    const pick = (type: FlowEdge["type"]) => outgoing.find((edge) => edge.type === type)?.target;

    // Condition node: branch on its own expression (existing behavior).
    if (step.type === "condition") {
      const passed = evaluateBoolean(step.value ?? "", getValueWithStepResult);
      const target = passed
        ? pick("conditional") ?? pick("success") ?? pick("always")
        : pick("failure") ?? pick("always");
      return { nextStepId: target ?? step.next, viaLoopBack: false };
    }

    // 0. Structured conditional connectors (Checkpoint B) — evaluate by config; highest
    //    priority match wins. If structured conditionals exist but none match, we fall
    //    through to success/always/next (a "stop safely" default), skipping legacy
    //    expression evaluation for those same edges.
    const structuredConditionals = outgoing.filter((e) => connectorKind(e) === "conditional" && e.conditional);
    if (structuredConditionals.length) {
      const nodeView: NodeOutcomeView = {
        status: stepResult.status,
        outcome: stepResult.outcome,
        outputs: stepResult.outputs,
        errorCode: stepResult.errorCode
      };
      const matched = structuredConditionals
        .filter((edge) => evaluateConnectorCondition(edge.conditional!, nodeView, getValueWithStepResult))
        .sort((a, b) => (b.conditional!.priority ?? 0) - (a.conditional!.priority ?? 0));
      if (matched.length) {
        const c = matched[0].conditional!;
        this.emitConnectorEvent(context, `Conditional connector matched (${c.sourceField} ${c.operator}${c.expectedValue !== undefined ? ` ${c.expectedValue}` : ""}) → ${matched[0].target}.`);
        return { nextStepId: matched[0].target, viaLoopBack: false };
      }
    }

    // 1. Legacy outcome edges — route by the step's own output values (skip structured ones).
    for (const edge of outgoing.filter((e) => e.type === "outcome" && !e.conditional)) {
      if (evaluateBoolean(edge.condition?.expression ?? "", getValueWithStepResult)) {
        return { nextStepId: edge.target, viaLoopBack: false };
      }
    }

    // 2. Legacy conditional edges — route by flow-level outputs (skip structured ones).
    for (const edge of outgoing.filter((e) => e.type === "conditional" && !e.conditional)) {
      if (evaluateBoolean(edge.condition?.expression ?? "", getValueWithStepResult)) {
        return { nextStepId: edge.target, viaLoopBack: false };
      }
    }

    const loopBack = outgoing.find((e) => e.type === "loopBack");
    const loopBackAvailable = (edge: FlowEdge): boolean => (loopBackCounts.get(edge.id) ?? 0) < (edge.maxLoopCount ?? 2);
    const takeLoopBack = (edge: FlowEdge): { nextStepId?: string; viaLoopBack: boolean } => {
      const count = (loopBackCounts.get(edge.id) ?? 0) + 1;
      loopBackCounts.set(edge.id, count);
      this.log("info", context, `Loop-back via edge ${edge.id} (iteration ${count}/${edge.maxLoopCount ?? 2}).`);
      return { nextStepId: edge.target, viaLoopBack: true };
    };

    // 3. Conditional loopBack — fires when its expression passes and it isn't exhausted.
    if (loopBack?.condition?.expression && loopBackAvailable(loopBack)) {
      if (evaluateBoolean(loopBack.condition.expression, getValueWithStepResult)) return takeLoopBack(loopBack);
    }

    // 4. Standard fallbacks: success → always.
    const fallback = pick("success") ?? pick("always");
    if (fallback) return { nextStepId: fallback, viaLoopBack: false };

    // 5. Unconditional loopBack — last resort when nothing else matched.
    if (loopBack && !loopBack.condition?.expression && loopBackAvailable(loopBack)) return takeLoopBack(loopBack);

    return { nextStepId: step.next, viaLoopBack: false };
  }

  private makeScope(outputs: Record<string, unknown>, context: InstanceExecutionContext): (path: string) => unknown {
    const scope: Record<string, unknown> = { ...context.flowOutputs, ...outputs };
    return (path: string) => {
      if (path.startsWith("outputs.")) return scope[path.slice("outputs.".length)];
      if (path.startsWith("runtimeInputs.")) return context.runtimeInputs[path.slice("runtimeInputs.".length)];
      if (path.startsWith("instanceInputs.")) return context.instanceInputs[path.slice("instanceInputs.".length)];
      return scope[path];
    };
  }

  private finish(
    flowId: string,
    startedAt: string,
    steps: StepExecutionResult[],
    outputs: Record<string, unknown>,
    status: FlowExecutionResult["status"],
    error?: string,
    manualHandoff?: FlowExecutionResult["manualHandoff"]
  ): FlowExecutionResult {
    const endedAt = new Date().toISOString();
    return {
      flowId,
      status,
      startedAt,
      endedAt,
      durationMs: Date.parse(endedAt) - Date.parse(startedAt),
      steps,
      outputs,
      error,
      manualHandoff
    };
  }

  private log(level: "info" | "error", context: InstanceExecutionContext, message: string): void {
    this.logger?.log({
      timestamp: new Date().toISOString(),
      level,
      executionId: context.executionId,
      instanceId: context.instanceId,
      scenarioId: context.scenarioId,
      flowId: context.flowId,
      message
    });
  }
}
