import { ScenarioOrchestrator } from "@src/orchestrator/ScenarioOrchestrator";
import type { FlowProfile, FlowStep } from "@src/profiles/FlowProfile";
import type { ScenarioLink, ScenarioProfile } from "@src/profiles/ScenarioProfile";
import { evaluateBoolean } from "./ExpressionEvaluator";
import type { InstanceConfig } from "@src/instances/InstanceConfig";
import { BrowserContextFactory, type BrowserContextFactoryOptions, type BrowserRuntime } from "./BrowserContextFactory";
import { FlowExecutor } from "./FlowExecutor";
import type { InstanceExecutionContext } from "./InstanceExecutionContext";
import { LocatorFactory } from "./LocatorFactory";
import { ManualHandoffController } from "./ManualHandoffController";
import type { RunnerProgressReporter } from "./RunnerProgress";
import { MemoryRunnerLogger, type FlowExecutionResult, type ScenarioExecutionResult } from "./RunnerResult";
import { StepExecutor, type BrowserRestarter, type ChildFlowRunner } from "./StepExecutor";
import { ValueResolver } from "./ValueResolver";
import type { SessionCaptureService } from "@src/session/SessionCaptureService";
import type { Page } from "playwright";

/** Live automation-browser state that a mid-run restart (Auto Secure Login) can swap. */
interface BrowserHolder {
  runtime: BrowserRuntime;
  page: Page;
  /** The StepExecutor currently driving the active flow (re-pointed after a restart). */
  activeExecutor?: StepExecutor;
}

/** Guards Run Another Flow against runaway/recursive nesting. */
const MAX_NESTED_FLOW_DEPTH = 5;

export interface PlaywrightRunnerOptions extends BrowserContextFactoryOptions {
  flows: FlowProfile[];
  manualHandoffController?: ManualHandoffController;
  scenarioOrchestrator?: ScenarioOrchestrator;
  /** Optional live-progress sink so the engine can surface per-step progress in real time. */
  progress?: RunnerProgressReporter;
  /** Session capture service (Main process only) — enables Auto Secure Login / Reuse Session nodes. */
  sessionService?: SessionCaptureService;
}

export class PlaywrightRunner {
  private readonly flows: Map<string, FlowProfile>;
  private readonly browserContextFactory: BrowserContextFactory;
  private readonly manualHandoffController: ManualHandoffController;
  private readonly scenarioOrchestrator: ScenarioOrchestrator;

  constructor(private readonly options: PlaywrightRunnerOptions) {
    this.flows = new Map(options.flows.map((flow) => [flow.id, flow]));
    this.browserContextFactory = new BrowserContextFactory(options);
    this.manualHandoffController = options.manualHandoffController ?? new ManualHandoffController();
    this.scenarioOrchestrator = options.scenarioOrchestrator ?? new ScenarioOrchestrator();
  }

  async executeScenario(
    profile: ScenarioProfile,
    context: InstanceExecutionContext,
    instanceConfig: InstanceConfig
  ): Promise<ScenarioExecutionResult> {
    if (!context.executionId || !context.instanceId) {
      throw new Error("Runner requires an isolated instance execution context.");
    }

    if (!profile.flows.length) {
      throw new Error(`Scenario ${profile.id} does not contain any flows.`);
    }

    const startedAt = new Date().toISOString();
    const logger = new MemoryRunnerLogger();
    const runtime = await this.browserContextFactory.create(instanceConfig, context);
    // Mutable holder so Auto Secure Login can close/relaunch the automation browser mid-run
    // and re-point the live StepExecutor + subsequent flows at the new page.
    const holder: BrowserHolder = { runtime, page: await runtime.context.newPage() };

    const restartBrowser: BrowserRestarter = async (opts) => {
      await holder.runtime.close().catch(() => undefined);
      if (opts?.closeOnly) return;
      const customConfig: InstanceConfig = opts?.newUserDataDir
        ? { ...instanceConfig, isolationMode: "persistentContext", userDataDir: opts.newUserDataDir }
        : instanceConfig;
      holder.runtime = await this.browserContextFactory.create(customConfig, context);
      holder.page = await holder.runtime.context.newPage();
      holder.activeExecutor?.setActivePage(holder.page);
    };

    const flowResults: FlowExecutionResult[] = [];

    try {
      const executionPlan = this.scenarioOrchestrator.createExecutionPlan(profile);
      if (executionPlan.validationIssues.some((issue) => issue.severity === "error")) {
        throw new Error(executionPlan.validationIssues.map((issue) => issue.message).join(" "));
      }

      // Workflow-level connector routing: traverse the workflow graph by link type
      // (success / failure / conditional / always / loop), falling back to the next
      // flow in dependency order when a flow has no matching outgoing link.
      const order = executionPlan.steps.map((step) => step.flowId);
      const planByFlow = new Map(executionPlan.steps.map((step) => [step.flowId, step]));
      const linksBySource = new Map<string, ScenarioLink[]>();
      for (const link of profile.links) {
        (linksBySource.get(link.sourceFlowId) ?? linksBySource.set(link.sourceFlowId, []).get(link.sourceFlowId)!).push(link);
      }
      // When the workflow declares links, routing is strict (a flow with no matching
      // outgoing link ends that path). With no links at all we run flows in order.
      const hasLinks = profile.links.length > 0;
      const accumulatedOutputs: Record<string, unknown> = { ...context.flowOutputs };
      const maxSteps = Math.max(order.length * 4, 8);
      let currentFlowId: string | undefined = order[0];
      let stepCount = 0;

      while (currentFlowId && stepCount < maxSteps) {
        stepCount += 1;
        const planStep = planByFlow.get(currentFlowId);
        const flow = this.flows.get(currentFlowId);
        if (!flow) {
          if (planStep?.required) throw new Error(`Required flow profile is missing: ${currentFlowId}`);
          currentFlowId = this.nextInOrder(order, currentFlowId);
          continue;
        }

        const flowContext: InstanceExecutionContext = {
          ...context,
          flowId: flow.id,
          flowOutputs: { ...accumulatedOutputs }
        };

        const result = await this.runFlowWithChildren(flow, flowContext, holder, restartBrowser, logger, [flow.id]);
        flowResults.push(result);
        Object.assign(accumulatedOutputs, result.outputs);

        if (result.status === "manualHandoff") {
          return this.finish(profile.id, context, startedAt, flowResults, logger, "manualHandoff", result.error, result.manualHandoff);
        }

        const links = linksBySource.get(currentFlowId) ?? [];
        const orderFallback = hasLinks ? undefined : this.nextInOrder(order, currentFlowId);

        if (result.status === "failed") {
          const failureLink = links.find((link) => link.type === "failure");
          if (failureLink) {
            currentFlowId = failureLink.targetFlowId; // recovery branch
            continue;
          }
          if (planStep?.required || profile.failurePolicy.stopOnRequiredFlowFailure) {
            return this.finish(profile.id, context, startedAt, flowResults, logger, "failed", result.error);
          }
          // Optional flow failed with no failure link → only an explicit "always" link continues.
          currentFlowId = links.find((link) => link.type === "always")?.targetFlowId ?? orderFallback;
          continue;
        }

        currentFlowId = this.chooseNextFlow(links, accumulatedOutputs, context) ?? orderFallback;
      }

      return this.finish(profile.id, context, startedAt, flowResults, logger, "passed");
    } catch (error) {
      return this.finish(profile.id, context, startedAt, flowResults, logger, "failed", error instanceof Error ? error.message : String(error));
    } finally {
      await holder.runtime.close().catch(() => undefined);
    }
  }

  /** Pick the next flow on a successful (or optional-failed) result, honoring link types. */
  private chooseNextFlow(
    links: ScenarioLink[],
    outputs: Record<string, unknown>,
    context: InstanceExecutionContext
  ): string | undefined {
    const getValue = (path: string): unknown => {
      if (path.startsWith("outputs.")) return outputs[path.slice("outputs.".length)];
      if (path.startsWith("runtimeInputs.")) return context.runtimeInputs[path.slice("runtimeInputs.".length)];
      if (path.startsWith("instanceInputs.")) return context.instanceInputs[path.slice("instanceInputs.".length)];
      return outputs[path];
    };

    // Outcome links first (most specific), then conditional.
    for (const link of links.filter((l) => l.type === "outcome")) {
      if (evaluateBoolean(link.condition?.expression ?? "", getValue)) return link.targetFlowId;
    }
    for (const link of links.filter((l) => l.type === "conditional")) {
      if (evaluateBoolean(link.condition?.expression ?? "", getValue)) return link.targetFlowId;
    }
    const successOrLoop = links.find((l) => l.type === "success" || l.type === "loop" || l.type === "manualApproval");
    if (successOrLoop) return successOrLoop.targetFlowId;
    const always = links.find((l) => l.type === "always");
    return always?.targetFlowId;
  }

  private nextInOrder(order: string[], current: string): string | undefined {
    const index = order.indexOf(current);
    return index >= 0 ? order[index + 1] : undefined;
  }

  /** Build a StepExecutor/FlowExecutor for a flow and execute it, wiring child-flow calls. */
  private async runFlowWithChildren(
    flow: FlowProfile,
    context: InstanceExecutionContext,
    holder: BrowserHolder,
    restartBrowser: BrowserRestarter,
    logger: MemoryRunnerLogger,
    stack: string[]
  ): Promise<FlowExecutionResult> {
    const runChild: ChildFlowRunner = (childId) => this.executeChildFlow(childId, holder, restartBrowser, context, logger, stack);
    const stepExecutor = new StepExecutor(
      holder.page,
      new LocatorFactory(holder.page),
      new ValueResolver(context),
      context,
      this.manualHandoffController,
      logger,
      runChild,
      this.options.progress,
      restartBrowser,
      this.options.sessionService
    );
    // Isolated-page parallel branches: each gets a fresh page in the shared context + its own
    // StepExecutor, and the page is closed when the branch finishes.
    const branchFactory = async () => {
      const branchPage = await holder.runtime.context.newPage();
      const branchExecutor = new StepExecutor(
        branchPage,
        new LocatorFactory(branchPage),
        new ValueResolver(context),
        context,
        this.manualHandoffController,
        logger,
        runChild,
        this.options.progress,
        restartBrowser,
        this.options.sessionService
      );
      return { execute: (step: FlowStep) => branchExecutor.execute(step), close: () => branchPage.close() };
    };

    // Restarts (Auto Secure Login) re-point this executor at the freshly launched page.
    // Save/restore around nested child flows so the parent's executor is active again afterwards.
    const previousExecutor = holder.activeExecutor;
    holder.activeExecutor = stepExecutor;
    const flowExecutor = new FlowExecutor(stepExecutor, logger, this.options.progress, branchFactory);
    try {
      return await flowExecutor.executeFlow(flow, context);
    } finally {
      holder.activeExecutor = previousExecutor ?? stepExecutor;
    }
  }

  /** Execute a saved flow as a child, enforcing the recursion/depth guards. */
  private async executeChildFlow(
    flowId: string,
    holder: BrowserHolder,
    restartBrowser: BrowserRestarter,
    baseContext: InstanceExecutionContext,
    logger: MemoryRunnerLogger,
    stack: string[]
  ): Promise<FlowExecutionResult> {
    if (stack.includes(flowId)) {
      throw new Error(`Recursive flow call detected: ${[...stack, flowId].join(" → ")}`);
    }
    if (stack.length >= MAX_NESTED_FLOW_DEPTH) {
      throw new Error(`Maximum nested flow depth (${MAX_NESTED_FLOW_DEPTH}) exceeded.`);
    }
    const flow = this.flows.get(flowId);
    if (!flow) {
      throw new Error(`Run Another Flow target not found: ${flowId}`);
    }
    const childContext: InstanceExecutionContext = { ...baseContext, flowId };
    return this.runFlowWithChildren(flow, childContext, holder, restartBrowser, logger, [...stack, flowId]);
  }

  private finish(
    scenarioId: string,
    context: InstanceExecutionContext,
    startedAt: string,
    flows: FlowExecutionResult[],
    logger: MemoryRunnerLogger,
    status: ScenarioExecutionResult["status"],
    error?: string,
    manualHandoff?: ScenarioExecutionResult["manualHandoff"]
  ): ScenarioExecutionResult {
    const endedAt = new Date().toISOString();

    return {
      scenarioId,
      executionId: context.executionId,
      instanceId: context.instanceId,
      status,
      startedAt,
      endedAt,
      durationMs: Date.parse(endedAt) - Date.parse(startedAt),
      flows,
      logs: logger.entries,
      error,
      manualHandoff
    };
  }
}
