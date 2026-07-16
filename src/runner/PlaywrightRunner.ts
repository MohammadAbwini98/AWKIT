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
import { TraceService, type TraceMode } from "./artifacts/TraceService";
import { CancelledError, type CancellationToken } from "./concurrency/CancellationToken";
import type { OriginClaimTracker } from "./concurrency/OriginClaimTracker";
import { ValueResolver } from "./ValueResolver";
import type { SessionCaptureService } from "@src/session/SessionCaptureService";
import type { Browser, BrowserContext, Page } from "playwright";

/** Live automation-browser state that a mid-run restart (Auto Secure Login) can swap. */
interface BrowserHolder {
  runtime: BrowserRuntime;
  page: Page;
  generation: number;
  swapInProgress: boolean;
  /** The StepExecutor currently driving the active flow (re-pointed after a restart). */
  activeExecutor?: StepExecutor;
}

type BrowserCloseReason =
  | "reuse-session-swap-old-runtime"
  | "instance-stop"
  | "execution-failed-cleanup"
  | "user-request"
  | "app-shutdown"
  | "launch-failed-cleanup";

interface RuntimeCandidate {
  runtime: BrowserRuntime;
  page: Page;
  browser?: Browser | null;
  context: BrowserContext;
  generation: number;
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
  /**
   * Called whenever a browser runtime becomes current for this run (initial launch and every
   * mid-run Reuse Session / Auto Secure Login swap). Lets the engine's BrowserWorkerPool track
   * contexts/pages/health of the live runtime without owning its lifecycle.
   */
  onBrowserRuntime?: (info: { runtime: BrowserRuntime; generation: number }) => void;
  /**
   * Called immediately before the runner intentionally closes a browser runtime (end-of-run
   * cleanup, hard cancel, or Reuse Session swap of the old generation). Lets the engine tell its
   * BrowserWorkerPool that the resulting "disconnected" event is an expected teardown, not a crash,
   * so ordinary run completions don't inflate the crash-rate backpressure window.
   */
  onRuntimeClosing?: (info: { runtime: BrowserRuntime; generation: number; reason: BrowserCloseReason }) => void;
  /**
   * Hard-cancellation token (Phase 3). On cancel, the runner closes the CURRENT browser runtime
   * so in-flight Playwright actions reject immediately, and refuses to start further flows/steps.
   */
  cancellation?: CancellationToken;
  /** Dynamic origin-claim tracker for this instance (Phase 3). */
  originClaims?: OriginClaimTracker;
  /**
   * Browser Resource Optimization: effective trace mode from the resolved profile (honours the
   * AWKIT_TRACE_MODE env override). When omitted, TraceService falls back to its own env default —
   * i.e. today's behaviour.
   */
  traceMode?: TraceMode;
}

export class PlaywrightRunner {
  private readonly flows: Map<string, FlowProfile>;
  private readonly browserContextFactory: BrowserContextFactory;
  private readonly manualHandoffController: ManualHandoffController;
  private readonly scenarioOrchestrator: ScenarioOrchestrator;
  /** Per-run failure-trace capture; armed only when the context provides a traces dir. */
  private traceService?: TraceService;

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
    let browserGeneration = 1;
    const runtime = await this.browserContextFactory.create(instanceConfig, context);
    // Mutable holder so Auto Secure Login can close/relaunch the automation browser mid-run
    // and re-point the live StepExecutor + subsequent flows at the new page.
    const holder: BrowserHolder = { runtime, page: await this.resolveLivePage(runtime.context), generation: browserGeneration, swapInProgress: false };
    this.patchRuntimeCloseWithStack(holder.runtime, holder.page, holder.generation);
    this.attachLifecycleHandlers(holder, {
      runtime: holder.runtime,
      page: holder.page,
      browser: holder.runtime.browser ?? holder.runtime.context.browser(),
      context: holder.runtime.context,
      generation: holder.generation
    }, logger, context);
    this.options.onBrowserRuntime?.({ runtime: holder.runtime, generation: holder.generation });
    this.traceService = new TraceService(context.paths.traces, this.options.traceMode);
    await this.traceService.attach(holder.runtime.context);

    // Hard cancellation: close the CURRENT runtime (whichever generation is live) so any
    // in-flight Playwright action rejects immediately instead of running to completion.
    const unsubscribeCancel = this.options.cancellation?.onCancel(async () => {
      logger.log({
        level: "warn",
        message: `[cancel] closing browser runtime g${holder.generation} (${this.options.cancellation?.reason ?? "user request"}).`,
        ...this.logMeta(context)
      });
      await this.closeRuntime(holder.runtime, holder.generation, "user-request", logger, context).catch(() => undefined);
    });

    const restartBrowser: BrowserRestarter = async (opts) => {
      if (holder.swapInProgress) {
        throw new Error("Browser session swap is already in progress for this instance.");
      }

      if (opts?.closeOnly) {
        await this.closeRuntime(holder.runtime, holder.generation, "reuse-session-swap-old-runtime", logger, context);
        return;
      }

      holder.swapInProgress = true;
      const oldRuntime = holder.runtime;
      const oldGeneration = holder.generation;
      const newGeneration = ++browserGeneration;
      const customConfig: InstanceConfig = { ...instanceConfig };
      if (opts?.newUserDataDir) {
        customConfig.isolationMode = "persistentContext";
        customConfig.userDataDir = opts.newUserDataDir;
      }

      logger.log({ level: "info", message: `[swap:g${newGeneration}] launch started (userDataDir=${opts?.newUserDataDir ?? "default"}).`, ...this.logMeta(context) });
      let candidate: RuntimeCandidate | undefined;
      try {
        const newRuntime = await this.browserContextFactory.create(customConfig, context);
        const newPage = await this.resolveLivePage(newRuntime.context);
        candidate = {
          runtime: newRuntime,
          page: newPage,
          browser: newRuntime.browser ?? newRuntime.context.browser(),
          context: newRuntime.context,
          generation: newGeneration
        };
        this.patchRuntimeCloseWithStack(candidate.runtime, candidate.page, newGeneration);
        this.attachLifecycleHandlers(holder, candidate, logger, context);
        logger.log({ level: "info", message: `[swap:g${newGeneration}] persistent context created; active page selected.`, ...this.logMeta(context) });

        await this.assertRuntimeAlive(candidate, "after launch", 750);

        holder.runtime = candidate.runtime;
        holder.page = candidate.page;
        holder.generation = newGeneration;
        holder.activeExecutor?.setActivePage(candidate.page);
        this.options.onBrowserRuntime?.({ runtime: candidate.runtime, generation: newGeneration });
        await this.traceService?.attach(candidate.runtime.context);
        logger.log({ level: "info", message: `[swap:g${newGeneration}] published as current runtime.`, ...this.logMeta(context) });

        await this.closeRuntime(oldRuntime, oldGeneration, "reuse-session-swap-old-runtime", logger, context);
        await this.assertRuntimeAlive(candidate, "after old runtime close", 2_000);

        logger.log({ level: "info", message: `[swap:g${newGeneration}] Reuse Session ready.`, ...this.logMeta(context) });
      } catch (error) {
        logger.log({ level: "error", message: `[swap:g${newGeneration}] Reuse Session failed: ${error instanceof Error ? error.message : String(error)}`, ...this.logMeta(context) });
        if (candidate) await this.closeRuntime(candidate.runtime, newGeneration, "launch-failed-cleanup", logger, context).catch(() => undefined);
        throw error;
      } finally {
        holder.swapInProgress = false;
      }
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
        // Stop dispatching flows the moment cancellation is requested.
        if (this.options.cancellation?.cancelled) throw new CancelledError(this.options.cancellation.reason);
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
      unsubscribeCancel?.();
      await this.closeRuntime(holder.runtime, holder.generation, "execution-failed-cleanup", logger, context).catch(() => undefined);
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

  /** Common structured-log fields for browser-swap diagnostics. */
  private logMeta(context: InstanceExecutionContext): {
    timestamp: string;
    executionId: string;
    instanceId?: string;
    scenarioId?: string;
    flowId?: string;
  } {
    return {
      timestamp: new Date().toISOString(),
      executionId: context.executionId,
      instanceId: context.instanceId,
      scenarioId: context.scenarioId,
      flowId: context.flowId
    };
  }

  private nextInOrder(order: string[], current: string): string | undefined {
    const index = order.indexOf(current);
    return index >= 0 ? order[index + 1] : undefined;
  }

  private async resolveLivePage(context: BrowserContext): Promise<Page> {
    const existing = context.pages().find((page) => !page.isClosed());
    return existing ?? context.newPage();
  }

  private attachLifecycleHandlers(
    holder: BrowserHolder,
    candidate: RuntimeCandidate,
    logger: MemoryRunnerLogger,
    context: InstanceExecutionContext
  ): void {
    const bornAt = Date.now();
    const stale = (event: string): boolean => {
      if (candidate.generation === holder.generation) return false;
      logger.log({
        level: "info",
        message: `[browser:g${candidate.generation}] stale ${event} ignored (current g${holder.generation}, +${Date.now() - bornAt}ms).`,
        ...this.logMeta(context)
      });
      return true;
    };

    candidate.context.on("close", () => {
      if (stale("context close")) return;
      logger.log({ level: "warn", message: `[browser:g${candidate.generation}] current context closed (+${Date.now() - bornAt}ms).`, ...this.logMeta(context) });
    });
    candidate.page.on("close", () => {
      if (stale("active page close")) return;
      logger.log({ level: "warn", message: `[browser:g${candidate.generation}] current active page closed (+${Date.now() - bornAt}ms).`, ...this.logMeta(context) });
    });
    candidate.page.on("crash", () => {
      if (stale("active page crash")) return;
      logger.log({ level: "warn", message: `[browser:g${candidate.generation}] current active page crashed (+${Date.now() - bornAt}ms).`, ...this.logMeta(context) });
    });
    candidate.browser?.on("disconnected", () => {
      if (stale("browser disconnected")) return;
      logger.log({ level: "warn", message: `[browser:g${candidate.generation}] current browser disconnected (+${Date.now() - bornAt}ms).`, ...this.logMeta(context) });
    });
  }

  private async assertRuntimeAlive(candidate: RuntimeCandidate, label: string, stableForMs = 0): Promise<void> {
    const assertOnce = async (): Promise<void> => {
      if (candidate.browser && !candidate.browser.isConnected()) {
        throw new Error(`[swap:g${candidate.generation}] browser is disconnected (${label}).`);
      }
      if (candidate.page.isClosed()) {
        throw new Error(`[swap:g${candidate.generation}] active page is closed (${label}).`);
      }
      await candidate.page.evaluate(() => 1);
    };

    await assertOnce();
    if (stableForMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, stableForMs));
      await assertOnce();
    }
  }

  private async closeRuntime(
    runtime: BrowserRuntime,
    generation: number,
    reason: BrowserCloseReason,
    logger: MemoryRunnerLogger,
    context: InstanceExecutionContext
  ): Promise<void> {
    // Announce the intentional teardown BEFORE closing so the pool doesn't score the resulting
    // browser "disconnected" as a crash (which would falsely trip the crash-rate backpressure).
    this.options.onRuntimeClosing?.({ runtime, generation, reason });
    logger.log({ level: "info", message: `[browser:g${generation}] closing runtime (${reason}).`, ...this.logMeta(context) });
    await runtime.close();
    logger.log({ level: "info", message: `[browser:g${generation}] runtime closed (${reason}).`, ...this.logMeta(context) });
  }

  private patchRuntimeCloseWithStack(runtime: BrowserRuntime, page: Page, generation: number): void {
    if (process.env.AWKIT_BROWSER_LIFECYCLE_DEBUG !== "1") return;
    this.patchCloseWithStack(runtime.context, `[browser:g${generation}] context`);
    this.patchCloseWithStack(page, `[browser:g${generation}] activePage`);
    if (runtime.browser) this.patchCloseWithStack(runtime.browser, `[browser:g${generation}] browser`);
  }

  private patchCloseWithStack<T extends { close: (...args: any[]) => Promise<unknown> }>(target: T, label: string): void {
    const closeTarget = target as T & { __awkitCloseTracePatched?: boolean };
    if (closeTarget.__awkitCloseTracePatched) return;
    const originalClose = closeTarget.close.bind(closeTarget);
    closeTarget.close = (async (...args: any[]) => {
      console.warn(`[close-trace] ${label}.close() called`);
      console.warn(new Error(`[close-trace] ${label}`).stack);
      return originalClose(...args);
    }) as T["close"];
    closeTarget.__awkitCloseTracePatched = true;
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
      this.options.sessionService,
      (label: string) =>
        this.assertRuntimeAlive(
          {
            runtime: holder.runtime,
            page: holder.page,
            browser: holder.runtime.browser ?? holder.runtime.context.browser(),
            context: holder.runtime.context,
            generation: holder.generation
          },
          label
        ),
      this.traceService,
      this.options.cancellation,
      this.options.originClaims,
      this.options.operationLimiters
    );

    // ── Popup registry wiring ───────────────────────────────────────────────
    // Any popup/new-window opened by the browser during this flow run is automatically
    // registered in the StepExecutor's PageRegistry under an alias that matches the
    // alias the recorder assigned (popup-1, popup-2, …). The alias is derived from the
    // `popupExpectation.popupAlias` on the last executed `click` step (if any), falling
    // back to a sequential counter so every popup gets a stable key regardless.
    let runnerPopupCounter = 0;
    const pageHandler = (newPage: import("playwright").Page): void => {
      // Try to find the most recently registered click step that opened a popup.
      // For simplicity we increment a counter and rely on the flow's recorded aliases.
      runnerPopupCounter += 1;
      const alias = `popup-${runnerPopupCounter}`;
      stepExecutor.registerPopupPage(alias, newPage);
    };
    holder.runtime.context.on("page", pageHandler);

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
        this.options.sessionService,
        (label: string) =>
          this.assertRuntimeAlive(
            {
              runtime: holder.runtime,
              page: branchPage,
              browser: holder.runtime.browser ?? holder.runtime.context.browser(),
              context: holder.runtime.context,
              generation: holder.generation
            },
            label
          ),
        this.traceService,
        this.options.cancellation,
        this.options.originClaims,
        this.options.operationLimiters
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
      holder.runtime.context.off("page", pageHandler);
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
