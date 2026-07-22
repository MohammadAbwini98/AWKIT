import { access, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Locator, Page } from "playwright";
import type { AsyncCompletionMode, FlowStep, NodeConfig, StepLocator, WaitCondition } from "@src/profiles/FlowProfile";
import { detectProtectedLogin } from "@src/security/ProtectedLoginDetector";
import type { HandoffInfo, ProtectedLoginHandoffAction } from "@src/security/ProtectedLoginHandoff";
import { materializeDataSourceRows, type InstanceExecutionContext } from "./InstanceExecutionContext";
import { LocatorFactory } from "./LocatorFactory";
import { ManualHandoffController, type ManualHandoffResumeAction } from "./ManualHandoffController";
import type { LiveStepStatus, RunnerProgressReporter } from "./RunnerProgress";
import type { FlowExecutionResult, RunnerLogger, StepExecutionResult } from "./RunnerResult";
import { ValueResolver } from "./ValueResolver";
import { assertNavigableUrl } from "./urlPolicy";
import { isPathInside } from "@src/utils/pathSafety";
import type { SessionCaptureService } from "@src/session/SessionCaptureService";
import type { SessionProfile } from "@src/session/SessionProfile";
import { findBestSessionForUrl, normalizeOrigin } from "@src/session/sessionMatch";
import type { TraceService } from "./artifacts/TraceService";
import { CancelledError, type CancellationToken } from "./concurrency/CancellationToken";
import type { OriginClaimTracker } from "./concurrency/OriginClaimTracker";
import type { OperationLimiters, OperationKind } from "./concurrency/OperationLimiters";
import { resolveStepSafety } from "./runtime/StepSafetyPolicy";
import { runOracleNode, type OracleNodeRunner } from "@src/oracle/OracleNodeExecution";
import { safeMessageForCategory } from "@src/oracle/OracleErrors";
import { OracleBridgeCallError } from "@src/oracle/OracleBridgeProtocol";

/** Step types after which the runner auto-checks for a protected-login page. */
const PROTECTED_LOGIN_AUTODETECT_STEPS = new Set(["goto", "click", "routeChange", "wait"]);

/**
 * A `response` wait matched its endpoint but the response status fell outside the expected range.
 * This is distinct from a timeout (the response DID arrive) — so an immediate HTTP 500 is reported
 * as an HTTP-500 failure instead of a misleading "timed out waiting for response". Its message is
 * already user-facing and must NOT be re-wrapped by the timeout-oriented wait-failure formatter.
 */
class ResponseStatusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResponseStatusError";
  }
}

/** A response wait armed before the action; its promise resolves to the matched response. */
interface ArmedResponse {
  wait: Extract<WaitCondition, { type: "response" }>;
  promise: Promise<import("playwright").Response>;
  timeout: number;
}

/** A loader-lifecycle wait whose appearance watch was armed before the action. */
interface ArmedLoader {
  wait: Extract<WaitCondition, { type: "loaderHidden" }>;
  /** Resolves once the loader appears within the grace window, or (never rejecting) after it. */
  appearance: Promise<{ appeared: boolean }>;
  grace: number;
}

/** Tracks the timestamp of the most recent request start (for `quietPeriod` completion). */
interface NetworkQuietObserver {
  lastRequestAt: () => number;
  dispose: () => void;
}

/** Runs a saved flow by id as a child of the current flow (used by Run Another Flow). */
export type ChildFlowRunner = (flowId: string) => Promise<FlowExecutionResult>;

/**
 * Restarts (or closes) the automation browser mid-run so a step can suspend automation,
 * let the user log in manually, and resume against a new session profile.
 * `closeOnly` closes the current browser without reopening; `newUserDataDir` relaunches a
 * persistent context bound to that profile directory. Implemented by PlaywrightRunner, which
 * also re-points the active StepExecutor at the new page.
 */
export type BrowserRestarter = (options?: { closeOnly?: boolean; newUserDataDir?: string }) => Promise<void>;
export type BrowserRuntimeLivenessCheck = (label: string) => Promise<void>;

/**
 * Reduce a site-suggested download filename to a safe, path-free base name (audit F-08).
 * Splits on both separators and takes the final segment so `..\..\evil.exe` cannot traverse,
 * strips characters illegal on Windows, and never returns an empty name.
 */
export function sanitizeDownloadFileName(name: string): string {
  const segments = (name ?? "").split(/[\\/]+/);
  const last = segments[segments.length - 1] ?? "";
  // eslint-disable-next-line no-control-regex
  const cleaned = last.replace(/[<>:"|?*]+/g, "_").replace(/[\x00-\x1f]+/g, "_").replace(/^\.+/, "").trim();
  return cleaned || `download-${Date.now()}`;
}

export class StepExecutor {
  /** Currently-active page (the page actions run on when no alias overrides). */
  private activePage: Page;
  /** Page registry: alias → Page. `'main'` is always present; popups are added by registerPopupPage. */
  private pageRegistry: Map<string, Page>;

  constructor(
    page: Page,
    private readonly locatorFactory: LocatorFactory,
    private readonly valueResolver: ValueResolver,
    private readonly context: InstanceExecutionContext,
    private readonly manualHandoffController = new ManualHandoffController(),
    private readonly logger?: RunnerLogger,
    private readonly runChildFlow?: ChildFlowRunner,
    private readonly progress?: RunnerProgressReporter,
    private readonly browserRestarter?: BrowserRestarter,
    private readonly sessionService?: SessionCaptureService,
    private readonly assertBrowserRuntimeAlive?: BrowserRuntimeLivenessCheck,
    /** Optional failure-trace capture (armed only when the engine provides a traces dir). */
    private readonly traceService?: TraceService,
    /** Cancellation token: checked before every step; a cancel closes the browser mid-action. */
    private readonly cancellation?: CancellationToken,
    /** Dynamic origin-claim re-evaluation after navigation (Phase 3). */
    private readonly originClaims?: OriginClaimTracker,
    /** Phase A6: staggers simultaneous navigations / downloads / screenshots across instances. */
    private readonly operationLimiters?: OperationLimiters,
    /** Runs Oracle query nodes through the main-process OracleQueryService (undefined = unavailable). */
    private readonly oracleNodeRunner?: OracleNodeRunner
  ) {
    this.activePage = page;
    this.pageRegistry = new Map([["main", page]]);
  }

  /** Run an expensive Playwright op under its operation limiter (A6), or directly when none is wired. */
  private limitOp<T>(kind: OperationKind, fn: () => Promise<T>): Promise<T> {
    return this.operationLimiters ? this.operationLimiters.run(kind, fn) : fn();
  }

  /**
   * Switch the active page and keep the locator factory pointed at it. Public so the
   * browser restarter (Auto Secure Login / Reuse Session) can re-point this executor
   * at a freshly launched page after the browser is relaunched mid-run.
   */
  setActivePage(page: Page): void {
    this.activePage = page;
    this.pageRegistry.set("main", page);
    this.locatorFactory.setPage(page);
  }

  /**
   * Register a newly-opened popup page under its alias so subsequent steps can target it.
   * Called by PlaywrightRunner's context-level 'page' event handler.
   */
  registerPopupPage(alias: string, page: Page): void {
    this.pageRegistry.set(alias, page);
    // Remove from registry when the popup closes so stale aliases don't linger.
    page.on("close", () => {
      this.pageRegistry.delete(alias);
    });
  }

  /** Unregister a popup (called from PlaywrightRunner if needed, or from the close handler). */
  unregisterPopupPage(alias: string): void {
    this.pageRegistry.delete(alias);
  }

  /**
   * Resolve the Playwright Page for a given step.
   * Returns the popup page when `step.pageAlias` is set, falls back to `activePage`.
   */
  private resolveStepPage(step: FlowStep): Page {
    const alias = step.pageAlias;
    if (!alias || alias === "main") return this.activePage;
    const page = this.pageRegistry.get(alias);
    if (!page) {
      throw new Error(
        `Popup page "${alias}" is not available. Open pages: [${[...this.pageRegistry.keys()].join(", ")}]. ` +
        `Ensure a switchToPopup step or an opener click with opensPopup runs before this step.`
      );
    }
    return page;
  }

  /** Emit a live progress event (no-op when no reporter is wired). */
  private emitProgress(
    step: FlowStep,
    status: LiveStepStatus,
    extra: { message?: string; manualHandoff?: HandoffInfo; error?: string; durationMs?: number; timestamp?: string; tracePath?: string; sideEffectLevel?: string } = {}
  ): void {
    this.progress?.report({
      instanceId: this.context.instanceId,
      flowId: this.context.flowId,
      stepId: step.id,
      stepLabel: step.name,
      stepType: step.type,
      status,
      message: extra.message,
      manualHandoff: extra.manualHandoff,
      error: extra.error,
      durationMs: extra.durationMs,
      timestamp: extra.timestamp ?? new Date().toISOString(),
      tracePath: extra.tracePath,
      sideEffectLevel: extra.sideEffectLevel,
      // Failure diagnostics only; sanitized to origin + path (never query/fragment).
      currentUrl: status === "failed" ? this.failureUrl() : undefined
    });
  }

  /** Hostname of the active page, or undefined for blank/unparseable URLs. */
  private currentHostname(): string | undefined {
    try {
      const raw = this.activePage.url();
      if (!raw || raw === "about:blank") return undefined;
      return new URL(raw).hostname.toLowerCase() || undefined;
    } catch {
      return undefined;
    }
  }

  /** Sanitized active-page URL for failed-event diagnostics; undefined when unavailable. */
  private failureUrl(): string | undefined {
    const url = this.safeCurrentUrl();
    return url === "unknown" ? undefined : url;
  }

  async execute(step: FlowStep): Promise<StepExecutionResult> {
    const startedAt = new Date().toISOString();
    const outputs: Record<string, unknown> = {};

    this.log("info", step, `Executing step ${step.name}`);
    this.emitProgress(step, "running", { message: `Running: ${step.name}`, timestamp: startedAt, sideEffectLevel: resolveStepSafety(step).sideEffectLevel });
    // Arm a per-step trace chunk (no-op unless the engine provided a traces dir). Saved only on
    // failure; success discards it so passing runs write nothing.
    const traceArmed = (await this.traceService?.beginStep()) ?? false;

    try {
      // Hard cancellation: never start (or continue past) a step after cancel was requested.
      this.cancellation?.throwIfCancelled();
      await this.assertBrowserRuntimeAlive?.(`before step ${step.name}`);
      await this.assertActivePageAlive(`before step ${step.name}`);
      this.guardLocatorQuality(step);
      const result = await this.runStepWithWaits(step, outputs);

      // Auto protected-login detection after navigation-type steps (never bypasses — only pauses).
      if (result.status === "passed" && PROTECTED_LOGIN_AUTODETECT_STEPS.has(step.type)) {
        const detection = await detectProtectedLogin(this.activePage).catch(() => null);
        // Only auto-pause on a genuine protected surface. Low-confidence signals (e.g. a page that
        // merely contains "single sign-on" text) recommend `continue` and must not pause the run.
        if (detection && detection.detected && detection.recommendedAction === "pause") {
          const info: HandoffInfo = {
            kind: "protectedLogin",
            message: detection.message,
            provider: detection.provider,
            reason: detection.reason,
            url: detection.url,
            allowedActions: ["cancel", "retry", "continue"]
          };
          this.log("info", step, `Protected login detected (${detection.provider}/${detection.reason}) — pausing for handoff.`);
          const captured = await this.captureProtectedLoginSession(step, info, outputs);
          if (captured) result.outcome = "sessionCaptured";
          else await this.waitForHandoffAction(step, info);
        }
      }

      // Dynamic origin claims (Phase 3): if the page ended up on a different origin, secure its
      // semaphore before the flow continues. Same-origin is a fast no-op; a saturated new origin
      // times out into a clear, retryable step failure instead of deadlocking.
      if (result.status === "passed" && this.originClaims) {
        await this.originClaims.ensureOrigin(this.currentHostname());
      }

      const endedAt = new Date().toISOString();
      const durationMs = Date.parse(endedAt) - Date.parse(startedAt);
      const liveStatus: LiveStepStatus = result.status === "passed" ? "succeeded" : result.status === "failed" ? "failed" : result.status === "manualHandoff" ? "waitingForManualAction" : "skipped";
      // Save the trace only for a failed result; success/handoff/skip discards the chunk.
      const tracePath = traceArmed ? await this.traceService?.endStep(step.id, result.status === "failed") : undefined;
      this.emitProgress(step, liveStatus, {
        message: liveStatus === "succeeded" ? `Completed: ${step.name}` : liveStatus === "waitingForManualAction" ? (result.manualHandoff?.message ?? `Waiting: ${step.name}`) : `Step ${step.name} ${liveStatus}`,
        durationMs,
        timestamp: endedAt,
        tracePath
      });
      return {
        stepId: step.id,
        status: result.status,
        startedAt,
        endedAt,
        durationMs,
        outputs,
        nextStepId: result.nextStepId,
        screenshotPath: result.screenshotPath,
        downloadedFilePath: result.downloadedFilePath,
        tracePath,
        manualHandoff: result.manualHandoff,
        outcome: result.outcome,
        restartRequired: result.restartRequired
      };
    } catch (error) {
      const endedAt = new Date().toISOString();
      const message = error instanceof Error ? error.message : String(error);
      // Save the failure trace BEFORE any cleanup can close the context; never masks the error.
      const tracePath = traceArmed ? await this.traceService?.endStep(step.id, true) : undefined;
      // Keep the full technical error in the structured logs...
      this.log("error", step, message);
      // ...but surface a cleaner message to the end user when the locator was ambiguous.
      const userMessage = StepExecutor.friendlyLocatorError(message);
      this.emitProgress(step, "failed", { message: `Failed: ${step.name}`, error: userMessage, durationMs: Date.parse(endedAt) - Date.parse(startedAt), timestamp: endedAt, tracePath });
      return {
        stepId: step.id,
        status: "failed",
        startedAt,
        endedAt,
        durationMs: Date.parse(endedAt) - Date.parse(startedAt),
        outputs,
        tracePath,
        error: userMessage
      };
    }
  }

  /** Step types that legitimately target more than one element (skip the uniqueness guard). */
  private static readonly MULTI_MATCH_STEP_TYPES = new Set(["loop"]);

  /**
   * Fail fast, with a friendly message, when a step's saved locator was recorded as
   * non-unique — instead of letting Playwright raise a raw strict-mode violation later.
   * Only fires when the recorder attached quality metadata that says `isUnique === false`;
   * legacy/hand-authored steps (no metadata) are unaffected.
   */
  private guardLocatorQuality(step: FlowStep): void {
    const quality = step.locator?.quality;

    // Integrity hardening (audit §16, "wrong privileged action"): a step that performs a sensitive
    // mutation must not rely on a fragile positional/index locator — it could target the wrong
    // Submit/Delete/Approve control. Fail early and ask for a stable locator, even when the resolver
    // could otherwise recover a match. Non-dangerous steps keep the lenient fallback behavior.
    const positional = quality?.strategy === "fallback" || quality?.disambiguation === "positional";
    if (positional) {
      const sideEffectLevel = resolveStepSafety(step).sideEffectLevel;
      if (sideEffectLevel === "dangerousMutation" || sideEffectLevel === "externalCommit") {
        throw new Error(
          `This step performs a sensitive action (${sideEffectLevel}) but its locator is a fragile ` +
            `positional/index fallback that could target the wrong element. Re-record it or add a stable ` +
            `data-testid or unique accessible name before running. (locator: ${step.locator?.strategy}=${step.locator?.value})`
        );
      }
    }

    if (!quality || quality.isUnique !== false) return;
    if (StepExecutor.MULTI_MATCH_STEP_TYPES.has(step.type)) return;
    if (step.type === "assertText" && step.config?.assertionType === "count") return;
    // The runtime resolver can now recover a non-unique primary via container/frame scoping,
    // visibility disambiguation, or a ranked alternative. When any of those are present, defer
    // to `LocatorFactory.resolve` (which fails with its own diagnostic if it truly can't).
    if (step.locator?.context || (step.locator?.alternatives && step.locator.alternatives.length > 0)) return;
    throw new Error(
      `This step cannot continue because the saved locator matches ${quality.matchCount} elements. ` +
        `Re-record the step or edit the locator so it targets a single element. ` +
        `(locator: ${step.locator?.strategy}=${step.locator?.value})`
    );
  }

  /** Translate Playwright strict-mode / ambiguity errors into an end-user-friendly message. */
  private static friendlyLocatorError(message: string): string {
    if (/strict mode violation|resolved to \d+ elements/i.test(message)) {
      return "This step could not run because its locator matched multiple elements on the page. Re-record the step or refine the locator so it targets exactly one element.";
    }
    return message;
  }

  // ── Smart Wait Engine (Phase 1: runner execution) ──────────────────────────────────────────
  //
  // A step's action is wrapped in its condition-based waits:
  //   beforeWaits → (arm action-triggered response waits) → action → await armed → afterWaits.
  // Steps without beforeWaits/afterWaits behave exactly as before, so old flows and the legacy
  // `wait` step node (executeWait: time/selector/navigation/networkIdle/textVisible) are unaffected.

  private async assertActivePageAlive(label: string): Promise<void> {
    if (this.activePage.isClosed()) {
      throw new Error(`Browser runtime is not alive ${label}: active page is closed.`);
    }
    await this.activePage.evaluate(() => 1);
  }

  /** Default max wait (ms) for a {@link WaitCondition} that omits `timeoutMs`. */
  private static readonly DEFAULT_WAIT_TIMEOUT_MS = 30_000;
  /** Default grace (ms) to wait for a lifecycle loader to APPEAR before deciding it never did. */
  private static readonly DEFAULT_APPEARANCE_GRACE_MS = 1_500;
  /** Quiet window (ms) with no new request start that ends a `quietPeriod` completion. */
  private static readonly QUIET_PERIOD_MS = 750;

  /** A `loaderHidden` wait that opts into the two-phase appearance→completion lifecycle. */
  private static isLoaderLifecycle(wait: WaitCondition): wait is Extract<WaitCondition, { type: "loaderHidden" }> {
    return (
      wait.type === "loaderHidden" &&
      (wait.appearanceGraceMs !== undefined || wait.mustAppear !== undefined || wait.completion !== undefined)
    );
  }

  private async runStepWithWaits(step: FlowStep, outputs: Record<string, unknown>) {
    const originalActivePage = this.activePage;
    const stepPage = this.resolveStepPage(step);

    // Temporarily bind execution to the target page for this step
    this.activePage = stepPage;
    this.locatorFactory.setPage(stepPage);

    try {
      for (const wait of step.beforeWaits ?? []) {
        await this.executeWaitCondition(step, wait, "before action");
      }

      // Partition the afterWaits and ARM observers that must be listening BEFORE the action, so a
      // fast response or a late-appearing loader is never missed. Everything else is deferred until
      // after the action. The completion policy (`completionMode`) decides how they combine.
      const afterWaits = step.afterWaits ?? [];
      const mode: AsyncCompletionMode = step.completionMode ?? "allRequired";
      const armedResponses: ArmedResponse[] = [];
      const armedLoaders: ArmedLoader[] = [];
      const deferred: WaitCondition[] = [];
      const quiet = mode === "quietPeriod" ? this.armNetworkQuietObserver() : undefined;
      for (const wait of afterWaits) {
        if (wait.type === "response" && wait.armBeforeAction) {
          const timeout = wait.timeoutMs ?? StepExecutor.DEFAULT_WAIT_TIMEOUT_MS;
          const promise = this.buildResponseWait(wait, timeout);
          promise.catch(() => undefined); // prevent an unhandled rejection if the action itself throws
          armedResponses.push({ wait, promise, timeout });
        } else if (wait.type === "loaderHidden" && StepExecutor.isLoaderLifecycle(wait)) {
          // Two-phase loader lifecycle: arm the appearance watch before the action.
          const grace = wait.appearanceGraceMs ?? StepExecutor.DEFAULT_APPEARANCE_GRACE_MS;
          armedLoaders.push({ wait, appearance: this.armLoaderAppearance(wait, grace), grace });
        } else {
          deferred.push(wait);
        }
      }

      const result = await this.executeStep(step, outputs);

      try {
        await this.resolveAfterWaits(step, mode, armedResponses, armedLoaders, deferred, quiet);
      } finally {
        quiet?.dispose();
      }

      return result;
    } finally {
      // Restore the active page unless this step explicitly and permanently changed it.
      // Reuse Session / Auto Secure Login swap the underlying browser runtime; restoring the
      // pre-swap page here would point the next step back at a closed old context.
      if (!["switchToPopup", "switchToMainPage", "closePopup", "routeChange", "autoSecureLogin", "reuseSession"].includes(step.type)) {
        this.activePage = originalActivePage;
        this.locatorFactory.setPage(originalActivePage);
      }
    }
  }

  /** Execute a single wait condition, translating any failure into a clear diagnostic. */
  private async executeWaitCondition(step: FlowStep, wait: WaitCondition, phase = "wait"): Promise<void> {
    const timeout = wait.timeoutMs ?? StepExecutor.DEFAULT_WAIT_TIMEOUT_MS;
    try {
      switch (wait.type) {
        case "loaderHidden":
        case "elementHidden":
          await this.waitLocator(wait.locator).waitFor({ state: "hidden", timeout });
          return;
        case "elementVisible":
          await this.waitLocator(wait.locator).waitFor({ state: "visible", timeout });
          return;
        case "elementEnabled": {
          const locator = this.waitLocator(wait.locator);
          await this.waitForPredicate(
            () => locator.isEnabled().catch(() => false),
            timeout,
            async () => `enabled=${await locator.isEnabled().catch(() => "n/a")}`
          );
          return;
        }
        case "textVisible":
          await this.activePage
            .getByText(wait.text, wait.exact ? { exact: true } : undefined)
            .first()
            .waitFor({ state: "visible", timeout });
          return;
        case "toastVisible": {
          const target = wait.locator
            ? this.waitLocator(wait.locator)
            : wait.text
              ? this.activePage.getByText(wait.text).first()
              : this.activePage.getByRole("alert").first();
          await target.waitFor({ state: "visible", timeout });
          return;
        }
        case "response": {
          const response = await this.buildResponseWait(wait, timeout);
          this.validateResponseStatus(wait, response);
          return;
        }
        case "tableHasRows": {
          const table = this.waitLocator(wait.tableLocator);
          const rows = wait.rowLocator ? this.waitLocator(wait.rowLocator) : table.locator("tbody tr, [role=row]");
          await this.waitForPredicate(
            async () => (await rows.count()) >= wait.minRows,
            timeout,
            async () => `rows=${await rows.count().catch(() => "n/a")}`
          );
          return;
        }
        case "listHasItems": {
          const list = this.waitLocator(wait.listLocator);
          const items = wait.itemLocator ? this.waitLocator(wait.itemLocator) : list.locator("li, [role=listitem]");
          await this.waitForPredicate(
            async () => (await items.count()) >= wait.minItems,
            timeout,
            async () => `items=${await items.count().catch(() => "n/a")}`
          );
          return;
        }
        case "urlChanged":
          await this.waitForPredicate(
            () => {
              const url = this.activePage.url();
              if (wait.urlContains) return url.includes(wait.urlContains);
              if (wait.fromUrl) return url !== wait.fromUrl;
              return true;
            },
            timeout,
            () => this.activePage.url()
          );
          return;
        case "domStable":
          await this.waitForDomStable(wait.stableForMs ?? 500, timeout);
          return;
        case "fixedDelay":
          await this.activePage.waitForTimeout(Math.max(0, wait.delayMs));
          return;
        case "apiPolling":
          // 202 → poll to terminal (awkit-4km C1). Observes the page's own status responses.
          await this.resolveApiPolling(wait, timeout);
          return;
        case "anyOf": {
          // OR-group (awkit-y24): pass as soon as ANY child passes; fail only when every child fails.
          // Children reuse this same resolver, so any non-armed wait type nests. As one required
          // condition in `allRequired`, the group lets `A AND (B OR C)` gate a step correctly.
          // Cancellation is owned by the `withCancellation` wrapper in `resolveDeferredWait`; the outer
          // catch below turns an all-branches-failed AggregateError into a formatted diagnostic.
          const children = wait.conditions ?? [];
          if (children.length === 0) return; // an empty group is vacuously satisfied
          await Promise.any(children.map((child) => this.executeWaitCondition(step, child, phase))).catch(() => {
            const branches = children.map((child) => StepExecutor.describeWaitCondition(child)).join(" OR ");
            throw new Error(`none of the OR-group branches were satisfied: ${branches}`);
          });
          return;
        }
        default: {
          const unknown = wait as { type?: string };
          throw new Error(`Unsupported wait condition type: ${String(unknown.type)}`);
        }
      }
    } catch (error) {
      if (error instanceof ResponseStatusError) {
        throw new Error(this.formatResponseStatusFailure(step, wait as Extract<WaitCondition, { type: "response" }>, error));
      }
      throw new Error(this.formatWaitFailure(step, wait, timeout, error, phase));
    }
  }

  /**
   * Build (register) a `waitForResponse` matcher. It matches on the ENDPOINT only (method +
   * urlContains) — never on status. Matching on status here would make an immediate HTTP 500 fail to
   * match and time out (the document's "bad behavior"). Status is validated separately by
   * {@link validateResponseStatus} so an unexpected status is reported as a status error, not a
   * timeout. The returned promise resolves to the matched Playwright `Response`.
   */
  private buildResponseWait(wait: Extract<WaitCondition, { type: "response" }>, timeout: number): Promise<import("playwright").Response> {
    const method = wait.method;
    const urlContains = wait.urlContains ?? "";
    return this.activePage.waitForResponse((response) => {
      if (method && response.request().method().toUpperCase() !== method) return false;
      if (urlContains && !response.url().includes(urlContains)) return false;
      return true;
    }, { timeout });
  }

  /**
   * Validate a matched response's status against the wait's expected range. Throws a
   * {@link ResponseStatusError} with a clear, status-specific message when it falls outside — so the
   * runner distinguishes "the API returned HTTP 500" from "the response never arrived (timeout)".
   */
  private validateResponseStatus(wait: Extract<WaitCondition, { type: "response" }>, response: import("playwright").Response): void {
    const [lo, hi] = wait.statusRange ?? [200, 399];
    const status = response.status();
    if (status < lo || status > hi) {
      const method = response.request().method().toUpperCase();
      const path = StepExecutor.safeUrlPath(response.url());
      throw new ResponseStatusError(
        `API returned HTTP ${status} for ${method} ${path} (expected ${lo}–${hi}). The response arrived — this is a status error, not a timeout.`
      );
    }
  }

  /**
   * Poll-to-terminal for the 202-Accepted pattern (awkit-4km C1). Observes the page's repeated status
   * responses to `urlContains` and completes when one is terminal: its status is in
   * `terminalStatusRange` (and not `pollingStatus`), or a JSON `responseField` equals a `terminalValue`.
   * A `pollingStatus` response means "still processing → keep observing". Bounded by `maxAttempts` and
   * the overall `timeout`. Issues no requests itself; a status outside every expected shape fails fast.
   */
  private async resolveApiPolling(wait: Extract<WaitCondition, { type: "apiPolling" }>, timeout: number): Promise<void> {
    const method = wait.method;
    const urlContains = wait.urlContains ?? "";
    const maxAttempts = Math.max(1, wait.maxAttempts ?? 30);
    const pollingStatus = wait.pollingStatus ?? 202;
    const [lo, hi] = wait.terminalStatusRange ?? [200, 299];
    const byField = !!(wait.responseField && wait.terminalValues?.length);
    const start = Date.now();
    let lastStatus = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const remaining = timeout - (Date.now() - start);
      if (remaining <= 0) break;
      let response: import("playwright").Response;
      try {
        response = await this.activePage.waitForResponse((r) => {
          if (method && r.request().method().toUpperCase() !== method) return false;
          return urlContains ? r.url().includes(urlContains) : true;
        }, { timeout: remaining });
      } catch {
        break; // no further matching status response arrived within the remaining budget
      }
      lastStatus = response.status();
      if (lastStatus === pollingStatus) continue; // still processing
      if (byField) {
        const value = await this.readResponseField(response, wait.responseField as string);
        if (value !== undefined && (wait.terminalValues as string[]).includes(String(value))) return;
        continue; // matched the endpoint but not a terminal value yet
      }
      if (lastStatus >= lo && lastStatus <= hi) return; // terminal success by status
      throw new Error(
        `API polling for ${method ?? "ANY"} ~"${urlContains}" returned HTTP ${lastStatus} (expected ${lo}-${hi} terminal, or ${pollingStatus} while processing).`
      );
    }
    throw new Error(
      `API polling did not reach a terminal state (last status ${lastStatus || "none"}) after ${maxAttempts} attempts / ${timeout}ms.`
    );
  }

  /** Read a dot-path value from a response's JSON body; undefined if the body isn't JSON or the path is absent. */
  private async readResponseField(response: import("playwright").Response, path: string): Promise<unknown> {
    try {
      const body = await response.json();
      return path.split(".").reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), body);
    } catch {
      return undefined;
    }
  }

  /** Origin + path of a URL (query/hash stripped) for safe, secret-free diagnostics. */
  private static safeUrlPath(raw: string): string {
    try {
      const parsed = new URL(raw);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return raw.split("?")[0] || "unknown";
    }
  }

  // ── Async completion policies + loader lifecycle (awkit-62o) ─────────────────────────────────
  //
  // The pre-armed responses/loaders + deferred waits are combined into one completion decision per
  // `step.completionMode`. Every await is cancellation-aware so Stop interrupts immediately.

  /** Race a promise against cancellation so Stop interrupts a wait without waiting out its timeout. */
  private withCancellation<T>(promise: Promise<T>): Promise<T> {
    const token = this.cancellation;
    if (!token) return promise;
    if (token.cancelled) return Promise.reject(new CancelledError(token.reason));
    let unsubscribe: () => void = () => undefined;
    const cancelled = new Promise<never>((_, reject) => {
      unsubscribe = token.onCancel(() => reject(new CancelledError(token.reason)));
    });
    return Promise.race([promise, cancelled]).finally(() => unsubscribe());
  }

  /** Arm (before the action) a watch for a loader to become visible within its grace window. */
  private armLoaderAppearance(wait: Extract<WaitCondition, { type: "loaderHidden" }>, grace: number): Promise<{ appeared: boolean }> {
    const locator = this.waitLocator(wait.locator).first();
    return locator
      .waitFor({ state: "visible", timeout: grace })
      .then(() => ({ appeared: true }))
      .catch(() => ({ appeared: false }));
  }

  /** Dispatch the step's after-waits through its completion policy. */
  private async resolveAfterWaits(
    step: FlowStep,
    mode: AsyncCompletionMode,
    armedResponses: ArmedResponse[],
    armedLoaders: ArmedLoader[],
    deferred: WaitCondition[],
    quiet?: NetworkQuietObserver
  ): Promise<void> {
    switch (mode) {
      case "anyRequired":
        return this.resolveAnyRequired(step, armedResponses, armedLoaders, deferred);
      case "networkThenUi":
        return this.resolveNetworkThenUi(step, armedResponses, armedLoaders, deferred);
      case "quietPeriod":
        return this.resolveQuietPeriod(step, armedResponses, armedLoaders, deferred, quiet);
      case "allRequired":
      default:
        return this.resolveAllRequired(step, armedResponses, armedLoaders, deferred);
    }
  }

  /** Every required condition must pass; optional ones are best-effort. (Legacy behavior.) */
  private async resolveAllRequired(step: FlowStep, armedResponses: ArmedResponse[], armedLoaders: ArmedLoader[], deferred: WaitCondition[]): Promise<void> {
    for (const entry of armedResponses) {
      await this.runRequiredOrOptional(step, entry.wait, "network", () => this.resolveArmedResponse(step, entry));
    }
    for (const entry of armedLoaders) {
      await this.runRequiredOrOptional(step, entry.wait, "loader", () => this.resolveLoaderLifecycle(step, entry));
    }
    for (const wait of deferred) {
      await this.runRequiredOrOptional(step, wait, "after action", () => this.resolveDeferredWait(step, wait));
    }
  }

  /** Succeed as soon as ANY required condition passes; fail only if every required one fails. */
  private async resolveAnyRequired(step: FlowStep, armedResponses: ArmedResponse[], armedLoaders: ArmedLoader[], deferred: WaitCondition[]): Promise<void> {
    const tasks: Array<() => Promise<void>> = [];
    for (const entry of armedResponses) if (!entry.wait.optional) tasks.push(() => this.resolveArmedResponse(step, entry));
    for (const entry of armedLoaders) if (!entry.wait.optional) tasks.push(() => this.resolveLoaderLifecycle(step, entry));
    for (const wait of deferred) if (!wait.optional) tasks.push(() => this.resolveDeferredWait(step, wait));
    // Optional conditions never gate success; run them best-effort so their progress still shows.
    for (const entry of armedResponses) if (entry.wait.optional) void this.runRequiredOrOptional(step, entry.wait, "network", () => this.resolveArmedResponse(step, entry));
    if (tasks.length === 0) return;
    try {
      await Promise.any(tasks.map((task) => task()));
    } catch (error) {
      const errors = error instanceof AggregateError ? error.errors : [error];
      const cancelled = errors.find((e) => e instanceof CancelledError);
      if (cancelled) throw cancelled;
      throw new Error(this.formatAnyRequiredFailure(step, errors));
    }
  }

  /** Required responses → required loaders → required UI outcomes, with API↔UI consistency checks. */
  private async resolveNetworkThenUi(step: FlowStep, armedResponses: ArmedResponse[], armedLoaders: ArmedLoader[], deferred: WaitCondition[]): Promise<void> {
    // Phase 1 — network.
    for (const entry of armedResponses) {
      if (entry.wait.optional) {
        await this.runRequiredOrOptional(step, entry.wait, "network", () => this.resolveArmedResponse(step, entry));
        continue;
      }
      try {
        await this.resolveArmedResponse(step, entry);
      } catch (error) {
        if (error instanceof CancelledError) throw error;
        const detail = error instanceof Error ? error.message : String(error);
        if (await this.anyUiOutcomeSatisfied(deferred)) {
          throw new Error(this.formatConsistencyFailure(step, "requiredApiFailedUiChanged", detail));
        }
        throw error; // already a precise status/timeout failure
      }
    }
    // Phase 2 — blocking loaders must complete.
    for (const entry of armedLoaders) {
      if (entry.wait.optional) {
        await this.runRequiredOrOptional(step, entry.wait, "loader", () => this.resolveLoaderLifecycle(step, entry));
        continue;
      }
      try {
        await this.resolveLoaderLifecycle(step, entry);
      } catch (error) {
        if (error instanceof CancelledError) throw error;
        throw new Error(this.formatConsistencyFailure(step, "loaderStillBlocking", error instanceof Error ? error.message : String(error)));
      }
    }
    // Phase 3 — required UI outcomes (consistency: API ok but UI missing).
    for (const wait of deferred) {
      if (wait.optional) {
        await this.runRequiredOrOptional(step, wait, "ui outcome", () => this.resolveDeferredWait(step, wait));
        continue;
      }
      try {
        await this.resolveDeferredWait(step, wait);
      } catch (error) {
        if (error instanceof CancelledError) throw error;
        throw new Error(this.formatConsistencyFailure(step, "apiOkUiMissing", error instanceof Error ? error.message : String(error)));
      }
    }
  }

  /** Complete once the network is quiet for a window and no blocking loader remains. */
  private async resolveQuietPeriod(step: FlowStep, armedResponses: ArmedResponse[], armedLoaders: ArmedLoader[], deferred: WaitCondition[], quiet?: NetworkQuietObserver): Promise<void> {
    for (const entry of armedResponses) {
      if (entry.wait.optional) {
        await this.runRequiredOrOptional(step, entry.wait, "network", () => this.resolveArmedResponse(step, entry));
        continue;
      }
      await this.resolveArmedResponse(step, entry);
    }
    const timeout = this.maxAfterWaitTimeout([...armedResponses.map((r) => r.wait), ...armedLoaders.map((l) => l.wait), ...deferred]);
    await this.waitForNetworkQuiet(step, quiet, StepExecutor.QUIET_PERIOD_MS, timeout, [...armedLoaders.map((l) => l.wait), ...deferred]);
    for (const wait of deferred) {
      await this.runRequiredOrOptional(step, wait, "ui outcome", () => this.resolveDeferredWait(step, wait));
    }
  }

  /** Await an armed response and validate its status; preserves the stale-nav skip + status-vs-timeout split. */
  private async resolveArmedResponse(step: FlowStep, entry: ArmedResponse): Promise<void> {
    this.emitWaiting(step, entry.wait, entry.timeout, "network");
    try {
      const response = await this.withCancellation(entry.promise);
      this.validateResponseStatus(entry.wait, response);
    } catch (error) {
      if (error instanceof CancelledError) throw error;
      if (error instanceof ResponseStatusError) {
        throw new Error(this.formatResponseStatusFailure(step, entry.wait, error));
      }
      if (await this.canSkipStaleRecordedNavigationResponseWait(step, entry.wait, error)) {
        this.log("info", step, `Skipping stale recorded navigation response wait after successful goto: ${StepExecutor.describeWaitCondition(entry.wait)}`);
        return;
      }
      throw new Error(this.formatWaitFailure(step, entry.wait, entry.timeout, error, "after action (armed before action)"));
    }
  }

  /** Two-phase loader lifecycle: appearance (armed before the action) → completion signal. */
  private async resolveLoaderLifecycle(step: FlowStep, entry: ArmedLoader): Promise<void> {
    const { wait, grace } = entry;
    const timeout = wait.timeoutMs ?? StepExecutor.DEFAULT_WAIT_TIMEOUT_MS;
    this.emitWaiting(step, wait, grace, "loader appearance");
    const { appeared } = await this.withCancellation(entry.appearance);
    if (!appeared) {
      if (wait.mustAppear) {
        throw new Error(this.formatLoaderLifecycleFailure(step, wait, `the required loader never appeared within ${grace}ms after the action`));
      }
      this.log("info", step, `Optional loader never appeared within ${grace}ms (nothing to wait for): ${StepExecutor.describeWaitCondition(wait)}`);
      return;
    }
    this.emitWaiting(step, wait, timeout, "loader completion");
    try {
      await this.withCancellation(this.waitLoaderCompletion(wait, timeout));
    } catch (error) {
      if (error instanceof CancelledError) throw error;
      throw new Error(this.formatLoaderLifecycleFailure(step, wait, `the loader appeared but did not reach '${wait.completion ?? "hidden"}' within ${timeout}ms`));
    }
  }

  /** Wait for a visible loader's configured completion signal (hidden / detached / aria-busy=false). */
  private async waitLoaderCompletion(wait: Extract<WaitCondition, { type: "loaderHidden" }>, timeout: number): Promise<void> {
    const completion = wait.completion ?? "hidden";
    const locator = this.waitLocator(wait.locator).first();
    if (completion === "detached") {
      await locator.waitFor({ state: "detached", timeout });
      return;
    }
    if (completion === "ariaBusyFalse") {
      await this.waitForPredicate(
        async () => {
          const busy = await locator.getAttribute("aria-busy").catch(() => "false");
          return busy === null || busy === "false";
        },
        timeout,
        async () => `aria-busy=${await locator.getAttribute("aria-busy").catch(() => "n/a")}`
      );
      return;
    }
    await locator.waitFor({ state: "hidden", timeout });
  }

  /** Run one deferred (post-action) wait, cancellation-aware. */
  private async resolveDeferredWait(step: FlowStep, wait: WaitCondition): Promise<void> {
    this.emitWaiting(step, wait, wait.timeoutMs ?? StepExecutor.DEFAULT_WAIT_TIMEOUT_MS, "after action");
    await this.withCancellation(this.executeWaitCondition(step, wait, "after action"));
  }

  /** Wrap a required/optional condition: optional failures are logged and swallowed; cancellation always propagates. */
  private async runRequiredOrOptional(step: FlowStep, wait: WaitCondition, phase: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      if (error instanceof CancelledError) throw error;
      if (wait.optional) {
        this.log("info", step, `Optional ${phase} condition not satisfied (ignored): ${StepExecutor.describeWaitCondition(wait)}`);
        return;
      }
      throw error;
    }
  }

  /** Attach a request-start observer to the active page (for `quietPeriod`). */
  private armNetworkQuietObserver(): NetworkQuietObserver {
    let last = Date.now();
    const page = this.activePage;
    const onRequest = () => {
      last = Date.now();
    };
    page.on("request", onRequest);
    return {
      lastRequestAt: () => last,
      dispose: () => {
        try {
          page.off("request", onRequest);
        } catch {
          /* page may be closed */
        }
      }
    };
  }

  /** Wait until no new request has started for `quietMs` and no blocking loader is visible. */
  private async waitForNetworkQuiet(step: FlowStep, quiet: NetworkQuietObserver | undefined, quietMs: number, timeout: number, loaderWaits: WaitCondition[]): Promise<void> {
    const start = Date.now();
    this.emitProgress(step, "waiting", { message: `Waiting for network to settle (quiet ${quietMs}ms · timeout ${Math.round(timeout / 1000)}s)` });
    for (;;) {
      this.cancellation?.throwIfCancelled();
      const sinceLast = Date.now() - (quiet?.lastRequestAt() ?? start);
      const blocking = await this.anyBlockingLoaderVisible(loaderWaits);
      if (sinceLast >= quietMs && !blocking) return;
      if (Date.now() - start > timeout) {
        throw new Error(this.formatQuietPeriodFailure(step, quietMs, timeout, sinceLast, blocking));
      }
      await this.withCancellation(this.activePage.waitForTimeout(100));
    }
  }

  /** True if any loader locator among the given waits is currently visible. */
  private async anyBlockingLoaderVisible(waits: WaitCondition[]): Promise<boolean> {
    for (const wait of waits) {
      if (wait.type === "loaderHidden") {
        const visible = await this.waitLocator(wait.locator).first().isVisible().catch(() => false);
        if (visible) return true;
      }
    }
    return false;
  }

  /** Best-effort snapshot: is any UI-outcome wait already satisfied right now? (Consistency messaging.) */
  private async anyUiOutcomeSatisfied(waits: WaitCondition[]): Promise<boolean> {
    for (const wait of waits) {
      try {
        if (wait.type === "textVisible") {
          if (await this.activePage.getByText(wait.text, wait.exact ? { exact: true } : undefined).first().isVisible().catch(() => false)) return true;
        } else if (wait.type === "elementVisible" || wait.type === "toastVisible") {
          const target = wait.type === "toastVisible" && !wait.locator ? this.activePage.getByRole("alert").first() : this.waitLocator((wait as { locator: StepLocator }).locator).first();
          if (await target.isVisible().catch(() => false)) return true;
        } else if (wait.type === "urlChanged" && wait.urlContains) {
          if (this.activePage.url().includes(wait.urlContains)) return true;
        }
      } catch {
        /* best-effort only */
      }
    }
    return false;
  }

  /** Largest timeout among a set of waits, falling back to the default. */
  private maxAfterWaitTimeout(waits: WaitCondition[]): number {
    return waits.reduce((max, wait) => Math.max(max, wait.timeoutMs ?? 0), StepExecutor.DEFAULT_WAIT_TIMEOUT_MS);
  }

  /** Progress event describing exactly what is being awaited (endpoint/loader/ui, timeout, required/optional). */
  private emitWaiting(step: FlowStep, wait: WaitCondition, timeout: number, phase: string): void {
    const req = wait.optional ? "optional" : "required";
    this.emitProgress(step, "waiting", {
      message: `Waiting (${phase}) for ${req} ${StepExecutor.describeWaitCondition(wait)} · timeout ${Math.round(timeout / 1000)}s`
    });
  }

  private formatLoaderLifecycleFailure(step: FlowStep, wait: Extract<WaitCondition, { type: "loaderHidden" }>, detail: string): string {
    const lines = [
      `Loader lifecycle failed on step "${step.name}"${step.id ? ` (id ${step.id})` : ""}.`,
      `Loader: ${StepExecutor.describeWaitCondition(wait)}`,
      `Completion: ${wait.completion ?? "hidden"}`,
      `Current URL: ${this.safeCurrentUrl()}`
    ];
    if (wait.reason) lines.push(`Recorded reason: ${wait.reason}`);
    lines.push(`Detail: ${detail}`);
    return lines.join("\n");
  }

  private formatConsistencyFailure(step: FlowStep, kind: "requiredApiFailedUiChanged" | "loaderStillBlocking" | "apiOkUiMissing", detail: string): string {
    const reasons: Record<typeof kind, string> = {
      requiredApiFailedUiChanged: "A required API request failed, but the UI changed anyway — inconsistent completion.",
      loaderStillBlocking: "The API completed, but a required loader is still blocking after it.",
      apiOkUiMissing: "The API completed successfully, but the required UI outcome did not appear."
    };
    return [
      `Async completion inconsistency on step "${step.name}"${step.id ? ` (id ${step.id})` : ""}.`,
      `Reason: ${reasons[kind]}`,
      `Current URL: ${this.safeCurrentUrl()}`,
      `Detail: ${detail}`
    ].join("\n");
  }

  private formatAnyRequiredFailure(step: FlowStep, errors: unknown[]): string {
    const details = errors.map((e) => (e instanceof Error ? e.message.split("\n")[0] : String(e)));
    return [
      `None of the alternative completion conditions were met on step "${step.name}"${step.id ? ` (id ${step.id})` : ""}.`,
      `Current URL: ${this.safeCurrentUrl()}`,
      `Tried: ${details.join(" | ")}`
    ].join("\n");
  }

  private formatQuietPeriodFailure(step: FlowStep, quietMs: number, timeout: number, sinceLast: number, blocking: boolean): string {
    return [
      `Quiet-period completion timed out on step "${step.name}"${step.id ? ` (id ${step.id})` : ""}.`,
      `Needed: no new request for ${quietMs}ms and no blocking loader, within ${timeout}ms.`,
      `Last observed: ${sinceLast}ms since the last request${blocking ? ", a loader is still visible" : ""}.`,
      `Current URL: ${this.safeCurrentUrl()}`
    ].join("\n");
  }

  /**
   * Recorder-generated response waits on a navigation are useful hints, not a stronger signal than
   * a completed Playwright goto. Session reuse can legitimately change which bootstrap endpoints fire
   * (or redirect to a canonical host), so keep the step moving when only that stale recorded hint timed out.
   */
  private async canSkipStaleRecordedNavigationResponseWait(
    step: FlowStep,
    wait: Extract<WaitCondition, { type: "response" }>,
    error: unknown
  ): Promise<boolean> {
    if (step.type !== "goto" || !wait.armBeforeAction || !wait.reason) return false;

    const message = error instanceof Error ? error.message : String(error);
    if (!/timeout/i.test(message)) return false;
    if (this.activePage.isClosed()) return false;

    try {
      await this.activePage.evaluate(() => 1);
    } catch {
      return false;
    }

    const currentUrl = this.activePage.url();
    return Boolean(currentUrl && currentUrl !== "about:blank");
  }

  /** Build a Playwright locator from a structured locator for wait purposes (tolerant `.first()`). */
  private waitLocator(locator: StepLocator): Locator {
    return this.locatorFactory.create(locator).first();
  }

  /** Poll `predicate` until true or `timeout`; on timeout throw with the last observed value. */
  private async waitForPredicate(
    predicate: () => boolean | Promise<boolean>,
    timeout: number,
    describe: () => unknown | Promise<unknown>
  ): Promise<void> {
    const start = Date.now();
    for (;;) {
      let satisfied = false;
      try {
        satisfied = await predicate();
      } catch {
        satisfied = false;
      }
      if (satisfied) return;
      if (Date.now() - start >= timeout) {
        let last: unknown = "";
        try {
          last = await describe();
        } catch {
          /* ignore */
        }
        throw new Error(`condition not met within ${timeout}ms (last observed: ${String(last)})`);
      }
      await this.activePage.waitForTimeout(100);
    }
  }

  /** Wait until the page DOM stops changing for `stableForMs` (cheap size/child-count signature). */
  private async waitForDomStable(stableForMs: number, timeout: number): Promise<void> {
    const start = Date.now();
    let signature = "";
    let stableSince = Date.now();
    for (;;) {
      let current = signature;
      try {
        current = String(
          await this.activePage.evaluate(() =>
            document.body ? `${document.body.childElementCount}:${document.body.innerHTML.length}` : "0"
          )
        );
      } catch {
        current = signature;
      }
      const now = Date.now();
      if (current !== signature) {
        signature = current;
        stableSince = now;
      }
      if (now - stableSince >= stableForMs) return;
      if (now - start >= timeout) throw new Error(`DOM did not stay stable for ${stableForMs}ms within ${timeout}ms`);
      await this.activePage.waitForTimeout(100);
    }
  }

  private formatWaitFailure(step: FlowStep, wait: WaitCondition, timeout: number, error: unknown, phase: string): string {
    const detail = error instanceof Error ? error.message : String(error);
    const lines = [
      `Smart wait failed on step "${step.name}"${step.id ? ` (id ${step.id})` : ""}.`,
      `Phase: ${phase}`,
      `Wait type: ${wait.type}`,
      `Condition: ${StepExecutor.describeWaitCondition(wait)}`,
      `Timeout: ${timeout}ms`,
      `Current URL: ${this.safeCurrentUrl()}`
    ];
    if (wait.reason) lines.push(`Recorded reason: ${wait.reason}`);
    lines.push(`Suggestion: ${StepExecutor.waitSuggestion(wait)}`);
    lines.push(`Detail: ${detail}`);
    return lines.join("\n");
  }

  /**
   * Diagnostic for a `response` wait whose endpoint matched but returned an unexpected status. Framed
   * as a status failure (NOT a timeout) so reports say exactly what happened, per the async-awareness
   * requirement that "an immediate HTTP 500 must not be reported as a generic timeout".
   */
  private formatResponseStatusFailure(step: FlowStep, wait: Extract<WaitCondition, { type: "response" }>, error: ResponseStatusError): string {
    const [lo, hi] = wait.statusRange ?? [200, 399];
    const lines = [
      `Unexpected API status on step "${step.name}"${step.id ? ` (id ${step.id})` : ""}.`,
      `Wait type: response`,
      `Condition: ${StepExecutor.describeWaitCondition(wait)}`,
      `Expected status: ${lo}–${hi}`,
      `Current URL: ${this.safeCurrentUrl()}`
    ];
    if (wait.reason) lines.push(`Recorded reason: ${wait.reason}`);
    lines.push(`Detail: ${error.message}`);
    return lines.join("\n");
  }

  /** URL for diagnostics only: origin + path, with query/hash stripped to avoid leaking tokens. */
  private safeCurrentUrl(): string {
    try {
      const raw = this.activePage.url();
      if (!raw || raw === "about:blank") return raw || "unknown";
      const parsed = new URL(raw);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return "unknown";
    }
  }

  private static describeWaitCondition(wait: WaitCondition): string {
    switch (wait.type) {
      case "loaderHidden":
      case "elementVisible":
      case "elementHidden":
      case "elementEnabled":
        return `${wait.type} ${wait.locator.strategy}=${wait.locator.value}`;
      case "textVisible":
        return `text "${wait.text}"${wait.exact ? " (exact)" : ""}`;
      case "toastVisible":
        return wait.locator
          ? `toast ${wait.locator.strategy}=${wait.locator.value}`
          : wait.text
            ? `toast text "${wait.text}"`
            : "toast [role=alert]";
      case "response":
        return `${wait.method ?? "ANY"} response url~"${wait.urlContains ?? ""}" status ${(wait.statusRange ?? [200, 399]).join("-")}${wait.armBeforeAction ? " (armed before action)" : ""}`;
      case "tableHasRows":
        return `table ${wait.tableLocator.strategy}=${wait.tableLocator.value} rows >= ${wait.minRows}`;
      case "listHasItems":
        return `list ${wait.listLocator.strategy}=${wait.listLocator.value} items >= ${wait.minItems}`;
      case "urlChanged":
        return wait.urlContains ? `url contains "${wait.urlContains}"` : `url changes from "${wait.fromUrl ?? ""}"`;
      case "domStable":
        return `DOM stable for ${wait.stableForMs ?? 500}ms`;
      case "fixedDelay":
        return `fixed delay ${wait.delayMs}ms`;
      case "anyOf":
        return `any of [${(wait.conditions ?? []).map((c) => StepExecutor.describeWaitCondition(c)).join(" | ")}]`;
      case "apiPolling":
        return `poll ${wait.method ?? "ANY"} ~"${wait.urlContains}" until terminal${wait.responseField ? ` (${wait.responseField} in ${(wait.terminalValues ?? []).join("/")})` : ` (${(wait.terminalStatusRange ?? [200, 299]).join("-")})`}, ≤${wait.maxAttempts ?? 30} polls`;
      default:
        return "unknown";
    }
  }

  private static waitSuggestion(wait: WaitCondition): string {
    switch (wait.type) {
      case "loaderHidden":
        return "Confirm the loader/spinner locator is correct and actually disappears; increase timeoutMs if the backend is slow.";
      case "elementVisible":
      case "toastVisible":
      case "textVisible":
        return "Confirm the target renders after the action; update the locator/text or increase timeoutMs.";
      case "elementHidden":
        return "Confirm the element is removed/hidden after the action; update the locator or increase timeoutMs.";
      case "elementEnabled":
        return "Confirm the control becomes enabled after the action; update the locator or increase timeoutMs.";
      case "response":
        return "Confirm method/urlContains/statusRange match the real request; set armBeforeAction for responses this step triggers; increase timeoutMs.";
      case "tableHasRows":
      case "listHasItems":
        return "Confirm the result container/row locator is correct and data loads; lower minRows/minItems or increase timeoutMs.";
      case "urlChanged":
        return "Confirm the action navigates or changes the URL; adjust urlContains or increase timeoutMs.";
      case "domStable":
        return "The page kept mutating (polling/animations); lower stableForMs or use a specific content wait instead.";
      case "fixedDelay":
        return "Fixed delays are a fallback; prefer a condition-based wait when a reliable signal exists.";
      case "anyOf":
        return "None of the OR-group branches were satisfied; confirm at least one alternative outcome actually occurs, or adjust the branches.";
      case "apiPolling":
        return "The job never reached a terminal state; confirm the page polls the status endpoint and that terminalStatusRange/responseField match the real 'done' signal; raise maxAttempts or timeoutMs.";
      default:
        return "Review the wait condition.";
    }
  }

  async captureFailureScreenshot(step: FlowStep): Promise<string> {
    return this.takeScreenshot(step, "failure");
  }

  private async executeStep(
    step: FlowStep,
    outputs: Record<string, unknown>
  ): Promise<Pick<StepExecutionResult, "status" | "nextStepId" | "screenshotPath" | "downloadedFilePath" | "manualHandoff" | "outcome" | "restartRequired">> {
    switch (step.type) {
      case "start":
      case "end":
        return { status: "passed" };

      case "goto": {
        const url = await this.resolveStepValue(step, step.url);
        if (!url) throw new Error(`Step ${step.id} is missing a URL.`);
        assertNavigableUrl(url);
        await this.limitOp("navigation", () => this.activePage.goto(url, { timeout: step.timeoutMs ?? 30_000 }));
        return { status: "passed" };
      }

      case "click": {
        // Arm popup capture BEFORE the click so a fast popup isn't missed.
        if (step.opensPopup && step.popupExpectation) {
          const expectation = step.popupExpectation;
          const alias = expectation.popupAlias;
          const timeout = expectation.timeoutMs ?? 15_000;
          const popupPromise = this.activePage.context().waitForEvent("page", { timeout });
          // Keep the armed listener from becoming an UNHANDLED rejection if the click (or a mid-flight
          // cancellation closing the context/page) fails before we await it below. The awaited value/throw
          // is still handled in-context; this extra no-op handler only marks the rejection as observed.
          popupPromise.catch(() => undefined);
          await (await this.locatorFactory.resolve(step)).click({ timeout: step.timeoutMs ?? 10_000 });
          const popupPage = await popupPromise;
          // Wait for initial load state.
          await popupPage.waitForLoadState(expectation.waitUntil ?? "domcontentloaded", { timeout }).catch(() => undefined);
          // Validate URL/title hints if provided.
          if (expectation.urlContains) {
            const popupUrl = popupPage.url();
            if (!popupUrl.includes(expectation.urlContains)) {
              this.log("info", step, `Popup URL "${popupUrl}" does not contain expected "${expectation.urlContains}" — continuing anyway.`);
            }
          }
          if (expectation.titleContains) {
            const title = await popupPage.title().catch(() => "");
            if (!title.includes(expectation.titleContains)) {
              this.log("info", step, `Popup title "${title}" does not contain expected "${expectation.titleContains}" — continuing anyway.`);
            }
          }
          // Register popup in the registry.
          this.registerPopupPage(alias, popupPage);
          // Auto-return to main when popup closes (unless configured otherwise).
          if ((expectation.closeBehavior ?? "returnToMain") === "returnToMain") {
            popupPage.on("close", () => {
              this.activePage = this.pageRegistry.get("main") ?? this.activePage;
              this.locatorFactory.setPage(this.activePage);
            });
          }
          return { status: "passed" };
        }
        await (await this.locatorFactory.resolve(step)).click({ timeout: step.timeoutMs ?? 10_000 });
        return { status: "passed" };
      }

      case "switchToPopup": {
        // Arm a popup listener, then wait for the new window to appear (used when no prior click
        // opener was available or the popup opens from a script/timer).
        const expectation = step.popupExpectation;
        if (!expectation) throw new Error(`switchToPopup step ${step.id} requires a popupExpectation config.`);
        const alias = expectation.popupAlias;
        const timeout = expectation.timeoutMs ?? 15_000;
        // Check if the popup is already open (it may have opened before this step ran).
        const existing = this.pageRegistry.get(alias);
        const popupPage = existing ?? await this.activePage.context().waitForEvent("page", { timeout });
        await popupPage.waitForLoadState(expectation.waitUntil ?? "domcontentloaded", { timeout }).catch(() => undefined);
        if (!existing) this.registerPopupPage(alias, popupPage);
        // Switch the active context to the popup.
        this.activePage = popupPage;
        this.locatorFactory.setPage(popupPage);
        await popupPage.bringToFront().catch(() => undefined);
        // Auto-return to main when popup closes.
        if ((expectation.closeBehavior ?? "returnToMain") === "returnToMain") {
          popupPage.on("close", () => {
            this.activePage = this.pageRegistry.get("main") ?? this.activePage;
            this.locatorFactory.setPage(this.activePage);
          });
        }
        // Run protected-login detection on the popup page. Only a genuine (pause-recommended)
        // protected surface pauses — low-confidence text signals let the run continue.
        const detection = await detectProtectedLogin(popupPage).catch(() => null);
        if (detection?.detected && detection.recommendedAction === "pause") {
          const info: HandoffInfo = {
            kind: "protectedLogin",
            message: detection.message,
            provider: detection.provider,
            reason: detection.reason,
            url: detection.url,
            allowedActions: ["cancel", "retry", "continue"]
          };
          this.log("info", step, `Protected login detected in popup (${detection.provider}/${detection.reason}) — pausing for handoff.`);
          await this.waitForHandoffAction(step, info);
        }
        return { status: "passed" };
      }

      case "closePopup": {
        const alias = step.config?.popupAlias ?? step.pageAlias;
        if (!alias) throw new Error(`closePopup step ${step.id} requires a popupAlias in config or pageAlias.`);
        const popupPage = this.pageRegistry.get(alias);
        if (!popupPage) {
          this.log("info", step, `closePopup: popup "${alias}" is already closed or was never opened — skipping.`);
          return { status: "passed" };
        }
        const timeout = step.timeoutMs ?? 15_000;
        // If the page is still open, wait for it to close (e.g. user clicked Accept).
        try {
          if (!popupPage.isClosed()) {
            await popupPage.waitForEvent("close", { timeout });
          }
        } catch {
          // Timeout: the popup didn't close on its own — close it programmatically.
          await popupPage.close().catch(() => undefined);
        }
        this.pageRegistry.delete(alias);
        // Return focus to the main page.
        const mainPage = this.pageRegistry.get("main") ?? this.activePage;
        this.activePage = mainPage;
        this.locatorFactory.setPage(mainPage);
        await mainPage.bringToFront().catch(() => undefined);
        return { status: "passed" };
      }

      case "switchToMainPage": {
        const mainPage = this.pageRegistry.get("main");
        if (!mainPage) throw new Error("switchToMainPage: main page is not registered in the page registry.");
        this.activePage = mainPage;
        this.locatorFactory.setPage(mainPage);
        await mainPage.bringToFront().catch(() => undefined);
        return { status: "passed" };
      }

      case "fill": {
        const value = await this.resolveStepValue(step);
        const locator = await this.locatorFactory.resolve(step);
        if (step.config?.clearBeforeFill) await locator.clear({ timeout: step.timeoutMs ?? 10_000 });
        await locator.fill(value, { timeout: step.timeoutMs ?? 10_000 });
        return { status: "passed" };
      }

      case "select": {
        const value = await this.resolveStepValue(step);
        const locator = await this.locatorFactory.resolve(step);
        const multiple = step.config?.selectMultiple;
        if (step.selectionMode === "label") {
          await locator.selectOption(multiple ? value.split(",").map((v) => ({ label: v.trim() })) : { label: value });
        } else if (step.selectionMode === "index") {
          await locator.selectOption(multiple ? value.split(",").map((v) => ({ index: Number(v.trim()) })) : { index: Number(value) });
        } else {
          await locator.selectOption(multiple ? value.split(",").map((v) => v.trim()) : value);
        }
        return { status: "passed" };
      }

      case "check":
        await (await this.locatorFactory.resolve(step)).check({ timeout: step.timeoutMs ?? 10_000 });
        return { status: "passed" };

      case "uncheck":
        await (await this.locatorFactory.resolve(step)).uncheck({ timeout: step.timeoutMs ?? 10_000 });
        return { status: "passed" };

      case "radio": {
        const value = await this.resolveStepValue(step);
        if (step.locator) await (await this.locatorFactory.resolve(step)).check({ timeout: step.timeoutMs ?? 10_000 });
        else await this.activePage.locator(`input[type="radio"][value="${value}"]`).check({ timeout: step.timeoutMs ?? 10_000 });
        return { status: "passed" };
      }

      case "scroll": {
        const cfg = step.config ?? {};
        const amount = cfg.scrollAmount ?? Number((await this.resolveStepValue(step, step.value)) || 500);
        if (cfg.scrollTarget === "element" && step.locator) {
          await (await this.locatorFactory.resolve(step)).scrollIntoViewIfNeeded({ timeout: step.timeoutMs ?? 10_000 });
        } else {
          const direction = cfg.scrollDirection ?? "down";
          const dx = direction === "left" ? -amount : direction === "right" ? amount : 0;
          const dy = direction === "up" ? -amount : direction === "down" ? amount : 0;
          await this.activePage.mouse.wheel(dx, dy);
        }
        return { status: "passed" };
      }

      case "wait":
        await this.executeWait(step);
        return { status: "passed" };

      case "uploadFile": {
        const filePath = await this.resolveStepValue(step, step.value);
        if (!filePath) throw new Error(`Upload step ${step.id} requires a file path.`);
        this.assertUploadAllowed(step, filePath);
        await (await this.locatorFactory.resolve(step)).setInputFiles(filePath);
        this.mapOutputs(step, outputs, { uploadedFileName: basename(filePath), uploadedFilePath: filePath });
        return { status: "passed" };
      }

      case "downloadFile": {
        const downloadPromise = this.activePage.waitForEvent("download", { timeout: step.timeoutMs ?? 30_000 });
        // Prevent an UNHANDLED rejection if the click (or a mid-flight cancellation) closes the page before
        // the download fires; the awaited value/throw below is still handled in-context.
        downloadPromise.catch(() => undefined);
        await (await this.locatorFactory.resolve(step)).click();
        const download = await downloadPromise;
        await mkdir(this.context.paths.downloads, { recursive: true });
        // The suggested filename comes from the (untrusted) target site's Content-Disposition.
        // Strip any path components / traversal so the download can only land inside the
        // downloads folder (audit F-08). Downloads are saved only, never opened/executed.
        const filePath = join(this.context.paths.downloads, sanitizeDownloadFileName(download.suggestedFilename()));
        await this.limitOp("download", () => download.saveAs(filePath));
        this.mapOutputs(step, outputs, { downloadedFilePath: filePath });
        return { status: "passed", downloadedFilePath: filePath };
      }

      case "readText": {
        const text = await (await this.locatorFactory.resolve(step)).innerText({ timeout: step.timeoutMs ?? 10_000 });
        this.mapOutputs(step, outputs, { text });
        return { status: "passed" };
      }

      case "assertText": {
        await this.executeAssertion(step);
        this.mapOutputs(step, outputs, { assertionResult: true });
        return { status: "passed" };
      }

      case "assertVisible": {
        const visible = await (await this.locatorFactory.resolve(step)).isVisible({ timeout: step.timeoutMs ?? 10_000 });
        if (!visible) throw new Error(`Element for step ${step.id} is not visible.`);
        this.mapOutputs(step, outputs, { assertionResult: true });
        return { status: "passed" };
      }

      case "screenshot": {
        const element = step.locator ? await this.locatorFactory.resolve(step) : undefined;
        const screenshotPath = await this.takeScreenshot(step, step.config?.screenshotName?.trim() || "step", {
          fullPage: step.config?.fullPage ?? false,
          element
        });
        this.mapOutputs(step, outputs, { screenshotPath });
        return { status: "passed", screenshotPath };
      }

      case "manualHandoff": {
        const message = step.message ?? "Manual action is required before this flow can continue.";
        await this.waitForHandoffAction(step, { kind: "manual", message, allowedActions: ["cancel", "retry", "continue"] });
        return { status: "passed", outcome: "manualContinued" };
      }

      case "protectedLoginHandoff": {
        const info = await this.executeProtectedLoginHandoff(step, outputs);
        const captured = await this.captureProtectedLoginSession(step, info, outputs);
        if (captured) return { status: "passed", outcome: "sessionCaptured" };
        await this.waitForHandoffAction(step, info);
        return { status: "passed", outcome: "manualContinued" };
      }

      case "oracle":
        return this.executeOracle(step, outputs);

      case "condition":
        // Routing for condition nodes is decided by FlowExecutor, which has the
        // full flow/instance output scope needed to evaluate the expression.
        return { status: "passed" };

      case "loop": {
        const iterations = await this.executeLoop(step);
        this.mapOutputs(step, outputs, { iterations });
        return { status: "passed" };
      }

      case "runFlow": {
        const targetFlowId = step.flowId ?? step.config?.targetFlowId;
        if (!targetFlowId) throw new Error(`Run Another Flow step ${step.id} has no target flow.`);
        if (!this.runChildFlow) throw new Error("Sub-flow execution is not available in this context.");
        const result = await this.runChildFlow(targetFlowId);
        this.mapOutputs(step, outputs, { childFlowId: targetFlowId, childFlowStatus: result.status, ...result.outputs });
        if (result.status === "manualHandoff") return { status: "manualHandoff" };
        if (result.status === "failed" && (step.config?.stopParentOnChildFailure ?? true)) {
          throw new Error(`Child flow ${targetFlowId} failed: ${result.error ?? "unknown error"}`);
        }
        return { status: "passed" };
      }

      case "routeChange": {
        await this.executeRouteChange(step, outputs);
        return { status: "passed" };
      }

      case "saveSession": {
        await this.saveSession(step, outputs);
        return { status: "passed" };
      }

      case "autoSecureLogin":
        return this.executeAutoSecureLogin(step, outputs);

      case "reuseSession":
        return this.executeReuseSession(step, outputs);

      default:
        throw new Error(`Unsupported step type: ${(step as FlowStep).type}`);
    }
  }

  /**
   * Switch the active automation context to another page/tab/URL so that later
   * steps target the new page. Supports switching to an existing page by URL,
   * the latest opened tab, waiting for a brand-new tab, or navigating in place.
   */
  private async executeRouteChange(step: FlowStep, outputs: Record<string, unknown>): Promise<void> {
    const cfg = step.config ?? {};
    const mode = cfg.routeMode ?? "switchToLatestTab";
    const timeout = step.timeoutMs ?? 30_000;
    const context = this.activePage.context();
    const urlValue = await this.resolveStepValue(step, step.url ?? step.value);

    const matches = (pageUrl: string): boolean => {
      if (!urlValue) return true;
      switch (cfg.urlMatch ?? "contains") {
        case "exact":
          return pageUrl === urlValue;
        case "regex":
          return new RegExp(urlValue).test(pageUrl);
        case "contains":
        default:
          return pageUrl.includes(urlValue);
      }
    };

    let target: Page | undefined;
    switch (mode) {
      case "switchToUrl": {
        if (!urlValue) throw new Error(`Route Change step ${step.id} requires a URL value.`);
        target = context.pages().find((candidate) => matches(candidate.url()));
        if (!target) throw new Error(`Route Change: no open page/tab matched "${urlValue}".`);
        break;
      }
      case "waitForNewTab": {
        // The new tab may already be open (the click that triggered it ran in a
        // previous step), so accept an existing extra page before waiting.
        target = context.pages().filter((candidate) => candidate !== this.activePage).pop();
        if (!target) target = await context.waitForEvent("page", { timeout });
        break;
      }
      case "navigateCurrentPage": {
        if (!urlValue) throw new Error(`Route Change step ${step.id} requires a URL value.`);
        assertNavigableUrl(urlValue);
        await this.limitOp("navigation", () => this.activePage.goto(urlValue, { timeout }));
        target = this.activePage;
        break;
      }
      case "switchToLatestTab":
      default: {
        // Wait briefly for a popup/new tab opened by a prior step to register.
        const deadline = Date.now() + Math.min(timeout, 10_000);
        let candidate = context.pages().filter((page) => page !== this.activePage).pop();
        while (!candidate && Date.now() < deadline) {
          await this.activePage.waitForTimeout(100);
          candidate = context.pages().filter((page) => page !== this.activePage).pop();
        }
        target = candidate ?? context.pages().pop();
        if (!target) throw new Error("Route Change: no open page/tab to switch to.");
        break;
      }
    }

    if (target && target !== this.activePage) {
      await target.bringToFront().catch(() => undefined);
      this.setActivePage(target);
    }

    const waitUntil = cfg.routeWaitUntil ?? "load";
    await this.activePage.waitForLoadState(waitUntil, { timeout }).catch(() => undefined);
    this.mapOutputs(step, outputs, { activePageUrl: this.activePage.url() });
  }

  private sanitizeSessionName(name: string): string {
    return name.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  }

  /**
   * Block uploads that would exfiltrate AWKIT's own credential/artifact material (audit F-01).
   * A manipulated workflow can set an arbitrary upload path via `step.value`; refuse the app's
   * saved sessions, run logs, reports, screenshots, and traces (and any `..` traversal into them).
   * General user files remain allowed — desktop automation legitimately uploads them.
   */
  private assertUploadAllowed(step: FlowStep, filePath: string): void {
    const p = this.context.paths;
    const blockedRoots = [p.sessions, p.logs, p.reports, p.screenshots, p.traces, ...(p.protectedUploadRoots ?? [])].filter(
      Boolean
    ) as string[];
    for (const root of blockedRoots) {
      if (isPathInside(root, filePath)) {
        throw new Error(
          `Upload step ${step.id} was blocked: "${filePath}" is inside a SpecterStudio data folder ` +
            `(saved sessions/logs/reports/screenshots/traces). Uploading application credential or artifact data is not allowed.`
        );
      }
    }
  }

  /**
   * Save the current browser context's storage state (cookies + localStorage/origins) to a
   * JSON file under the runtime sessions folder so a later run can reuse the login. Never logs
   * cookie/token/localStorage values — only the artifact path (and only when masking is off).
   */
  private async saveSession(step: FlowStep, outputs: Record<string, unknown>): Promise<void> {
    const cfg = step.config ?? {};
    const rawName = (cfg.sessionName ?? "").trim();
    if (!rawName) throw new Error(`Save Session step ${step.id} requires a session name.`);
    const safeName = this.sanitizeSessionName(rawName);
    if (!safeName) throw new Error(`Save Session step ${step.id} has an invalid (non file-safe) session name.`);

    const sessionsRoot = this.context.paths.sessions ?? join(dirname(this.context.paths.reports), "sessions");
    const baseDir = cfg.sessionFolder && cfg.sessionFolder.trim() ? cfg.sessionFolder.trim() : sessionsRoot;
    // Session state contains cookies/tokens; confine writes to the sessions directory so a
    // manipulated workflow can't drop credential material into an arbitrary/synced folder (audit F-04).
    if (!isPathInside(sessionsRoot, baseDir)) {
      throw new Error(`Save Session folder must be inside the sessions directory (${sessionsRoot}).`);
    }
    const filePath = join(baseDir, `${safeName}.json`);

    try {
      await mkdir(baseDir, { recursive: true });
    } catch (error) {
      throw new Error(`Save Session target folder is not writable: ${baseDir} (${error instanceof Error ? error.message : String(error)})`);
    }

    if (!cfg.overwriteSession) {
      const exists = await access(filePath).then(() => true).catch(() => false);
      if (exists) {
        throw new Error(`Session "${safeName}" already exists. Enable "Overwrite existing session" to replace it.`);
      }
    }

    const browserContext = this.activePage.context();
    if (cfg.captureScope === "origin") {
      // Origin-only: keep just the active page's origin storage + cookies on its host.
      const state = await browserContext.storageState();
      const activeUrl = new URL(this.activePage.url());
      const filtered = {
        cookies: state.cookies.filter((cookie) => activeUrl.hostname.endsWith(cookie.domain.replace(/^\./, ""))),
        origins: state.origins.filter((entry) => entry.origin === activeUrl.origin)
      };
      await writeFile(filePath, JSON.stringify(filtered, null, 2), "utf8");
    } else {
      await browserContext.storageState({ path: filePath });
    }

    this.mapOutputs(step, outputs, { sessionPath: filePath, sessionName: safeName });
    this.log("info", step, `Saved browser session "${safeName}"${cfg.maskSession === false ? ` → ${filePath}` : ""}`);
  }

  /**
   * Auto Secure Login: reuse a saved session if one exists for the target URL; otherwise
   * suspend automation, launch the user's real Chrome for a manual login, wait for it to
   * close, then relaunch the automation browser bound to the captured profile. Pairs with a
   * Phase 1 `outcome` edge (`${stepResult.sessionCaptured} === true`) that loops back to Start
   * so the flow re-runs against the authenticated browser state.
   */
  private async executeAutoSecureLogin(
    step: FlowStep,
    outputs: Record<string, unknown>
  ): Promise<Pick<StepExecutionResult, "status" | "outcome" | "restartRequired">> {
    if (!this.sessionService) throw new Error("Auto Secure Login is not available in this run context.");
    if (!this.browserRestarter) throw new Error("Auto Secure Login requires browser lifecycle control.");
    const targetUrl = (await this.resolveStepValue(step, step.value)).trim();
    if (!targetUrl) throw new Error("Auto Secure Login requires a target URL.");

    // 1. Reuse an existing ready session for this URL (matched by normalized origin).
    const profiles = await this.sessionService.list();
    const existing = findBestSessionForUrl(profiles, targetUrl);
    if (existing) {
      this.log("info", step, "Valid session found for target origin — skipping manual capture.");
      Object.assign(outputs, { sessionSkipped: true, sessionAlreadyExists: true, sessionId: existing.id, outcome: "sessionAlreadyExists" });
      return { status: "passed", outcome: "sessionAlreadyExists" };
    }

    // 2. Suspend automation (free the Playwright browser) and 3. launch real Chrome.
    this.log("info", step, "No saved session — closing automation browser and launching real Chrome for manual login.");
    await this.browserRestarter({ closeOnly: true });

    const captureName = `AutoLogin-${new Date().toISOString().slice(0, 10)}`;
    const capture = await this.sessionService.startCapture(captureName, targetUrl, "autoSecureLogin");
    const sessionId = capture.sessionId;
    if (!sessionId) throw new Error("Session capture did not return a session id.");

    // 4. Poll until the user finishes and closes the browser.
    const timeoutMs = step.timeoutMs && step.timeoutMs > 0 ? step.timeoutMs : 10 * 60_000;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const status = this.sessionService.getStatus();
      if (status.status === "error") throw new Error(`Session capture failed: ${status.error ?? "unknown error"}`);
      if (!status.active || status.status === "closed") break;
      if (Date.now() > deadline) throw new Error("Auto Secure Login timed out waiting for the manual login to complete.");
    }

    // 5. Race-condition mitigation: wait for the async profile file write, then verify.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const finalProfile = await this.sessionService.getById(sessionId);
    if (!finalProfile || finalProfile.status !== "ready") {
      throw new Error("Captured session did not reach a 'ready' state.");
    }

    // 6. Resume automation against the newly captured profile directory.
    this.log("info", step, "Session captured — resuming automation with the new profile.");
    try {
      await this.browserRestarter({ newUserDataDir: finalProfile.profileDir });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("currently in use by another browser process") ||
          error.message.includes("Browser session swap is already in progress"))
      ) {
        throw error;
      }
      throw new Error(this.sessionProfileOpenError(finalProfile.name));
    }
    await this.assertSwappedBrowserAlive(finalProfile.name);

    // Signal both mechanisms: outputs for outcome-edge routing, and restartRequired for the
    // engine-level restart guard so the flow re-runs from Start and reuses the new session.
    Object.assign(outputs, { sessionCaptured: true, sessionId, restartRequired: true, outcome: "sessionCaptured" });
    return { status: "passed", outcome: "sessionCaptured", restartRequired: true };
  }

  /**
   * Reuse Session: relaunch the automation browser bound to a specific previously-captured
   * session profile (chosen in Node Properties). Swaps the browser context in place — no
   * manual-login wait like Auto Secure Login.
   */
  private async executeReuseSession(
    step: FlowStep,
    outputs: Record<string, unknown>
  ): Promise<Pick<StepExecutionResult, "status" | "outcome">> {
    if (!this.sessionService) throw new Error("Reuse Session is not available in this run context.");
    if (!this.browserRestarter) throw new Error("Reuse Session requires browser lifecycle control.");

    const mode = step.config?.reuseSessionMode ?? (step.config?.reuseSessionId ? "selected" : "autoDetect");
    let profile: SessionProfile | null = null;

    if (mode === "selected") {
      const sessionId = step.config?.reuseSessionId;
      if (!sessionId) throw new Error("Reuse Session (selected mode) requires a saved session to be selected.");
      profile = await this.sessionService.getById(sessionId);
      if (!profile) throw new Error(`Saved session ${sessionId} was not found.`);
    } else {
      // Auto-detect by normalized origin: use the node's optional URL, else the current page.
      const explicit = (await this.resolveStepValue(step, step.value)).trim();
      const targetUrl = explicit || this.activePage.url();
      if (!targetUrl || targetUrl === "about:blank") {
        throw new Error("Reuse Session (auto-detect) could not determine a target URL.");
      }
      const profiles = await this.sessionService.list();
      profile = findBestSessionForUrl(profiles, targetUrl) ?? null;
      if (!profile) {
        Object.assign(outputs, { sessionNotFound: true, outcome: "sessionNotFound" });
        throw new Error(`No saved session matches ${normalizeOrigin(targetUrl) ?? targetUrl}.`);
      }
    }

    if (profile.status !== "ready") {
      throw new Error(`Saved session "${profile.name}" is not ready (status: ${profile.status}).`);
    }

    this.log("info", step, `Loading saved session "${profile.name}" (${mode}).`);
    try {
      await this.browserRestarter({ newUserDataDir: profile.profileDir });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("currently in use by another browser process") ||
          error.message.includes("Browser session swap is already in progress"))
      ) {
        throw error;
      }
      throw new Error(this.sessionProfileOpenError(profile.name));
    }
    await this.assertSwappedBrowserAlive(profile.name);
    await this.sessionService.markUsed(profile.id);

    Object.assign(outputs, { sessionLoaded: true, sessionId: profile.id, outcome: "sessionLoaded" });
    return { status: "passed", outcome: "sessionLoaded" };
  }

  /** Actionable message when a captured session profile can't be opened by the automation browser. */
  private sessionProfileOpenError(profileName: string): string {
    return (
      `The saved session profile "${profileName}" could not be opened or did not stay alive. ` +
      `Chrome or Edge may still be holding the profile, or the automation browser exited while opening it. ` +
      `Close all Chrome/Edge windows that use this session and retry, or recapture the session if the problem persists.`
    );
  }

  /**
   * Confirm the browser relaunched by a session swap (Reuse Session / Auto Secure Login) is actually
   * usable. A profile that is still locked/in-use or fails during launch can close immediately,
   * which would otherwise surface one step later as a cryptic "Target page … has been closed" on the
   * next action. `title()` round-trips to the browser and throws if the target is already gone.
   */
  private async assertSwappedBrowserAlive(profileName: string): Promise<void> {
    if (this.activePage.isClosed()) throw new Error(this.sessionProfileOpenError(profileName));
    try {
      await this.activePage.title();
    } catch {
      throw new Error(this.sessionProfileOpenError(profileName));
    }
  }

  /** Pause the live flow until the UI resolves the handoff. The browser remains open. */
  private async waitForHandoffAction(step: FlowStep, initialInfo: HandoffInfo): Promise<ManualHandoffResumeAction> {
    let info = initialInfo;
    for (;;) {
      this.pauseForHandoff(step, info.message);
      this.emitProgress(step, "waitingForManualAction", { message: info.message, manualHandoff: info });
      const action = await this.manualHandoffController.waitForAction(this.context.executionId, this.context.instanceId);

      if (action === "cancel") {
        throw new Error("Manual handoff was cancelled.");
      }

      if (action === "retry" && info.kind === "protectedLogin") {
        const detection = await detectProtectedLogin(this.activePage, { deepScan: true }).catch(() => null);
        if (detection?.detected) {
          info = {
            kind: "protectedLogin",
            message: detection.message,
            provider: detection.provider,
            reason: detection.reason,
            url: detection.url,
            allowedActions: Array.from(new Set([...(info.allowedActions ?? []), "continue", "retry", "cancel"]))
          };
          this.log("info", step, `Protected login still detected (${detection.provider}/${detection.reason}) after retry.`);
          continue;
        }
      }

      this.log("info", step, `Manual handoff resolved with action: ${action}.`);
      return action;
    }
  }

  /**
   * Workflow-runner protected-login handoff: close the automation browser, launch the user's
   * normal Chrome/Edge on the detected login URL, wait for the user to close it, then resume
   * automation on the captured session profile. This mirrors the recorder's secure-login
   * handoff and never automates or scrapes the protected page.
   */
  private async captureProtectedLoginSession(
    step: FlowStep,
    info: HandoffInfo,
    outputs: Record<string, unknown>
  ): Promise<boolean> {
    if (info.kind !== "protectedLogin") return false;
    if (!this.sessionService || !this.browserRestarter) return false;

    const configuredUrl = await this.resolveStepValue(step, step.url ?? step.value);
    const targetUrl = (info.url || configuredUrl || this.activePage.url()).trim();
    if (!targetUrl || targetUrl === "about:blank") return false;

    let paused = false;
    try {
      this.pauseForHandoff(step, "Complete the protected login in the normal browser window, then close that browser to resume automation.");
      paused = true;
      this.emitProgress(step, "waitingForManualAction", {
        message: "Opening normal browser for protected login. Complete login, then close that browser to resume.",
        manualHandoff: {
          ...info,
          url: targetUrl,
          allowedActions: ["cancel"]
        }
      });

      this.log("info", step, "Protected login detected — closing automation browser and launching normal browser for session capture.");
      await this.browserRestarter({ closeOnly: true });

      const safeProvider = info.provider && info.provider !== "unknown" ? info.provider : "ProtectedLogin";
      const captureName = `${safeProvider}-Login-${new Date().toISOString().slice(0, 10)}`;
      const capture = await this.sessionService.startCapture(captureName, targetUrl, "manualChromeHandoff");
      const sessionId = capture.sessionId;
      if (!sessionId) throw new Error("Protected login session capture did not return a session id.");

      const timeoutMs = this.protectedLoginCaptureTimeoutMs(step);
      const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : Number.POSITIVE_INFINITY;
      const actionPromise = this.manualHandoffController.waitForAction(this.context.executionId, this.context.instanceId);
      for (;;) {
        const action = await Promise.race([
          actionPromise.then((value) => ({ type: "action" as const, value })),
          new Promise<{ type: "tick" }>((resolve) => setTimeout(() => resolve({ type: "tick" }), 1000))
        ]);
        if (action.type === "action" && action.value === "cancel") {
          this.sessionService.stopCapture();
          throw new Error("Protected login session capture was cancelled.");
        }

        const status = this.sessionService.getStatus();
        if (status.status === "error") throw new Error(`Protected login session capture failed: ${status.error ?? "unknown error"}`);
        if (!status.active || status.status === "closed") break;
        if (timeoutMs > 0 && Date.now() > deadline) {
          this.sessionService.stopCapture();
          throw new Error(
            `Protected login session capture timed out after ${Math.round(timeoutMs / 1000)}s waiting for the normal browser to close. Increase the Protected Login Handoff timeout or set it to 0 to disable.`
          );
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
      if (!this.sessionService.hasCapturedData(sessionId)) {
        throw new Error("Protected login session did not contain captured browser data. Complete login in the normal browser, then close it before retrying.");
      }

      const profile = await this.sessionService.getById(sessionId);
      if (!profile || profile.status !== "ready") {
        throw new Error("Protected login session did not reach a ready state.");
      }

      try {
        await this.browserRestarter({ newUserDataDir: profile.profileDir });
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes("currently in use by another browser process") ||
            error.message.includes("Browser session swap is already in progress"))
        ) {
          throw error;
        }
        throw new Error(this.sessionProfileOpenError(profile.name));
      }
      await this.assertSwappedBrowserAlive(profile.name);
      await this.sessionService.markUsed(profile.id);
      this.manualHandoffController.resume(this.context.executionId, this.context.instanceId);

      this.mapOutputs(step, outputs, {
        protectedLoginSessionCaptured: true,
        sessionCaptured: true,
        sessionId: profile.id,
        outcome: "sessionCaptured"
      });
      this.log("info", step, `Protected login session captured and loaded (${profile.id}).`);
      return true;
    } catch (error) {
      if (paused) this.manualHandoffController.cancel(this.context.executionId, this.context.instanceId);
      throw error;
    }
  }

  private protectedLoginCaptureTimeoutMs(step: FlowStep): number {
    const configured = step.config?.handoffTimeoutMs;
    if (typeof configured === "number" && Number.isFinite(configured)) {
      return Math.max(0, configured);
    }
    return 10 * 60_000;
  }

  /** Register the instance as paused for a manual / protected-login handoff. */
  private pauseForHandoff(step: FlowStep, message: string): void {
    this.manualHandoffController.pause({
      executionId: this.context.executionId,
      instanceId: this.context.instanceId,
      scenarioId: this.context.scenarioId,
      flowId: this.context.flowId,
      stepId: step.id,
      message
    });
  }

  /**
   * Protected Login Handoff node: optionally detect the protected page, then PAUSE the instance and
   * surface approved handoff options. Never bypasses protections; never logs secrets.
   */
  private async executeProtectedLoginHandoff(step: FlowStep, outputs: Record<string, unknown>): Promise<HandoffInfo> {
    const cfg = step.config ?? {};
    const mode = cfg.handoffMode ?? "pauseAndAsk";

    let provider: HandoffInfo["provider"];
    let reason: HandoffInfo["reason"];
    let url: string | undefined;
    let detectedMessage: string | undefined;
    if (cfg.detectBeforeHandoff !== false) {
      const detection = await detectProtectedLogin(this.activePage, { deepScan: true }).catch(() => null);
      if (detection) {
        provider = detection.provider;
        reason = detection.reason;
        url = detection.url;
        if (detection.detected) detectedMessage = detection.message;
      }
    }
    if (cfg.loginProvider && cfg.loginProvider !== "auto" && cfg.loginProvider !== "other") {
      provider = cfg.loginProvider as HandoffInfo["provider"];
    }

    const instructions = (cfg.handoffInstructions ?? "").trim();
    const message =
      instructions ||
      detectedMessage ||
      "Protected login handoff: complete authentication using a supported, approved method. SpecterStudio will not bypass login protections.";

    const allowed: ProtectedLoginHandoffAction[] = ["cancel", "continue"];
    if (cfg.allowRetry !== false) allowed.push("retry");
    if (mode === "openSystemBrowserOAuth" || mode === "pauseAndAsk") allowed.push("openSystemBrowser", "useOAuth");
    if (mode === "useSavedSession" || mode === "pauseAndAsk") allowed.push("useSavedSession");
    if (mode === "useTestSession" || mode === "pauseAndAsk") allowed.push("useTestSession");

    const info: HandoffInfo = { kind: "protectedLogin", message, provider, reason, url, allowedActions: Array.from(new Set(allowed)) };
    this.mapOutputs(step, outputs, { protectedLoginProvider: provider ?? "unknown", protectedLoginReason: reason ?? "unknown", protectedLoginMode: mode });
    this.log("info", step, `Protected login handoff requested (mode=${mode}, provider=${provider ?? "auto"}).`);
    return info;
  }

  private async resolveStepValue(step: FlowStep, fallback?: string): Promise<string> {
    if (step.valueSource) return this.valueResolver.resolve(step.valueSource);
    return fallback ?? step.value ?? "";
  }

  private async executeWait(step: FlowStep): Promise<void> {
    const waitType = step.config?.waitType ?? "time";
    const timeout = step.timeoutMs ?? 30_000;
    switch (waitType) {
      case "selector":
        await this.locatorFactory.create(step.locator).waitFor({ state: "visible", timeout });
        return;
      case "textVisible": {
        const text = await this.resolveStepValue(step, step.value);
        await this.activePage.getByText(text).first().waitFor({ state: "visible", timeout });
        return;
      }
      case "navigation":
        await this.activePage.waitForLoadState("load", { timeout });
        return;
      case "networkIdle":
        await this.activePage.waitForLoadState("networkidle", { timeout });
        return;
      case "time":
      default:
        await this.activePage.waitForTimeout(Number((await this.resolveStepValue(step, step.value)) || step.timeoutMs || 1000));
    }
  }

  private async executeAssertion(step: FlowStep): Promise<void> {
    const cfg = step.config ?? {};
    const assertionType = cfg.assertionType ?? "text";
    const operator = cfg.comparisonOperator ?? "contains";
    const expected = await this.resolveStepValue(step, cfg.expectedValue ?? step.value);
    const timeout = step.timeoutMs ?? 10_000;

    let actual: string;
    if (assertionType === "url") {
      actual = this.activePage.url();
    } else if (assertionType === "count") {
      // Count assertions legitimately target many elements — no single-match resolution.
      actual = String(await this.locatorFactory.create(step.locator).count());
    } else if (assertionType === "value") {
      actual = await (await this.locatorFactory.resolve(step)).inputValue({ timeout });
    } else {
      actual = await (await this.locatorFactory.resolve(step)).innerText({ timeout });
    }

    if (!this.compareValues(actual, expected, operator)) {
      throw new Error(`Assertion failed: "${actual}" ${operator} "${expected}".`);
    }
  }

  private compareValues(actual: string, expected: string, operator: NonNullable<NodeConfig["comparisonOperator"]>): boolean {
    switch (operator) {
      case "equals":
        return actual.trim() === expected.trim();
      case "greaterThan":
        return Number(actual) > Number(expected);
      case "lessThan":
        return Number(actual) < Number(expected);
      case "contains":
      default:
        return actual.includes(expected);
    }
  }

  private async executeLoop(step: FlowStep): Promise<number> {
    const cfg = step.config ?? {};
    const loopType = cfg.loopType ?? "fixedCount";
    const maxIterations = Math.max(1, cfg.maxIterations ?? 100);
    const stopOnFailure = cfg.loopStopOnFailure ?? true;
    const actionType = cfg.loopActionType ?? "click";

    let count: number;
    if (loopType === "elements") {
      count = step.locator ? await this.locatorFactory.create(step.locator).count() : 0;
    } else if (loopType === "dataRows") {
      const ds = this.context.workflowDataSource;
      count = ds ? (await materializeDataSourceRows(ds)).length : 0;
    } else {
      count = cfg.iterationCount ?? 1;
    }
    count = Math.min(count, maxIterations);

    let completed = 0;
    for (let index = 0; index < count; index += 1) {
      try {
        await this.performLoopAction(step, actionType, loopType, index);
        completed += 1;
      } catch (error) {
        this.log("error", step, `Loop iteration ${index + 1} failed: ${error instanceof Error ? error.message : String(error)}`);
        if (stopOnFailure) throw error;
      }
    }
    return completed;
  }

  private async performLoopAction(
    step: FlowStep,
    actionType: NonNullable<NodeConfig["loopActionType"]>,
    loopType: NonNullable<NodeConfig["loopType"]>,
    index: number
  ): Promise<void> {
    const timeout = step.timeoutMs ?? 10_000;
    const base = step.locator ? this.locatorFactory.create(step.locator) : null;
    // For element loops, target the nth element; for "delete" always target the first
    // remaining match because the list shrinks as items are removed.
    const target: Locator | null =
      base && loopType === "elements" ? base.nth(actionType === "delete" ? 0 : index) : base;

    switch (actionType) {
      case "click":
      case "delete":
        if (target) await target.click({ timeout });
        return;
      case "fill":
        if (target) await target.fill(await this.resolveStepValue(step), { timeout });
        return;
      case "scroll":
        await this.activePage.mouse.wheel(0, step.config?.scrollAmount ?? 500);
        return;
      case "customFlow": {
        const targetFlowId = step.config?.targetFlowId;
        if (targetFlowId && this.runChildFlow) {
          const result = await this.runChildFlow(targetFlowId);
          if (result.status === "failed") throw new Error(`Loop child flow ${targetFlowId} failed.`);
        }
        return;
      }
    }
  }

  private async takeScreenshot(step: FlowStep, suffix: string, options?: { fullPage?: boolean; element?: Locator }): Promise<string> {
    const flowId = this.context.flowId ?? "flow";
    const screenshotDir = join(this.context.paths.screenshots, this.context.executionId, this.context.instanceId, flowId);
    await mkdir(screenshotDir, { recursive: true });
    const screenshotPath = join(screenshotDir, `${step.id}-${suffix}.png`);
    if (options?.element) {
      const element = options.element;
      await this.limitOp("screenshot", () => element.screenshot({ path: screenshotPath }));
    } else {
      await this.limitOp("screenshot", () => this.activePage.screenshot({ path: screenshotPath, fullPage: options?.fullPage ?? true }));
    }
    return screenshotPath;
  }

  /**
   * Execute an Oracle query node: resolve binds via the ValueResolver, run the query through the
   * injected main-process runner (OracleQueryService), map the result to the node's typed value, and
   * store it in outputs + an optional instance variable. Bridges the run's CancellationToken to an
   * AbortSignal so a cancelled run promptly cancels the in-flight query.
   */
  private async executeOracle(
    step: FlowStep,
    outputs: Record<string, unknown>
  ): Promise<Pick<StepExecutionResult, "status">> {
    const cfg = step.config?.oracle;
    if (!cfg) throw new Error(`Oracle step ${step.id} is not configured.`);
    if (!this.oracleNodeRunner) {
      throw new Error("Oracle is not available in this runtime (the bundled Oracle JDBC runtime is missing).");
    }

    const controller = new AbortController();
    const unsubscribe = this.cancellation?.onCancel(() => controller.abort());
    try {
      const mapped = await runOracleNode(cfg, {
        resolveValue: (vs) => this.valueResolver.resolve(vs),
        runner: this.oracleNodeRunner,
        signal: controller.signal
      });
      this.mapOutputs(step, outputs, {
        value: mapped.value,
        rowCount: mapped.rowCount,
        truncated: mapped.truncated,
        source: mapped.source
      });
      const outputVariable = cfg.outputVariable?.trim();
      if (outputVariable) {
        this.context.instanceInputs[outputVariable] = mapped.value;
      }
      this.log(
        "info",
        step,
        `Oracle query ${mapped.source} → ${mapped.rowCount} row(s)${mapped.truncated ? " (truncated)" : ""}, returnType=${cfg.returnType}`
      );
      return { status: "passed" };
    } catch (err) {
      // Map bridge categories to safe messages; never surface raw ORA text / secrets.
      if (err instanceof OracleBridgeCallError) {
        throw new Error(`Oracle query failed (${err.category}): ${safeMessageForCategory(err.category)}`);
      }
      throw err;
    } finally {
      unsubscribe?.();
    }
  }

  private mapOutputs(step: FlowStep, outputs: Record<string, unknown>, produced: Record<string, unknown>): void {
    if (!step.outputs) {
      Object.assign(outputs, produced);
      return;
    }

    Object.keys(step.outputs).forEach((key) => {
      outputs[key] = produced[key] ?? produced.text ?? produced.downloadedFilePath ?? produced.screenshotPath ?? Object.values(produced)[0];
    });
  }

  private log(level: "info" | "error", step: FlowStep, message: string): void {
    this.logger?.log({
      timestamp: new Date().toISOString(),
      level,
      executionId: this.context.executionId,
      instanceId: this.context.instanceId,
      scenarioId: this.context.scenarioId,
      flowId: this.context.flowId,
      stepId: step.id,
      message,
      data: {
        stepType: step.type,
        valueSourceType: step.valueSource?.type,
        locatorStrategy: step.locator?.strategy
      }
    });
  }
}
