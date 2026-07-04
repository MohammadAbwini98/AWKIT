import { access, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Locator, Page } from "playwright";
import type { FlowStep, NodeConfig } from "@src/profiles/FlowProfile";
import { detectProtectedLogin } from "@src/security/ProtectedLoginDetector";
import type { HandoffInfo, ProtectedLoginHandoffAction } from "@src/security/ProtectedLoginHandoff";
import type { InstanceExecutionContext } from "./InstanceExecutionContext";
import { LocatorFactory } from "./LocatorFactory";
import { ManualHandoffController, type ManualHandoffResumeAction } from "./ManualHandoffController";
import type { LiveStepStatus, RunnerProgressReporter } from "./RunnerProgress";
import type { FlowExecutionResult, RunnerLogger, StepExecutionResult } from "./RunnerResult";
import { ValueResolver } from "./ValueResolver";
import type { SessionCaptureService } from "@src/session/SessionCaptureService";
import type { SessionProfile } from "@src/session/SessionProfile";
import { findBestSessionForUrl, normalizeOrigin } from "@src/session/sessionMatch";

/** Step types after which the runner auto-checks for a protected-login page. */
const PROTECTED_LOGIN_AUTODETECT_STEPS = new Set(["goto", "click", "routeChange", "wait"]);

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

export class StepExecutor {
  /** Currently-active page. Route Change can switch this to another tab/page. */
  private activePage: Page;

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
    private readonly sessionService?: SessionCaptureService
  ) {
    this.activePage = page;
  }

  /**
   * Switch the active page and keep the locator factory pointed at it. Public so the
   * browser restarter (Auto Secure Login / Reuse Session) can re-point this executor
   * at a freshly launched page after the browser is relaunched mid-run.
   */
  setActivePage(page: Page): void {
    this.activePage = page;
    this.locatorFactory.setPage(page);
  }

  /** Emit a live progress event (no-op when no reporter is wired). */
  private emitProgress(
    step: FlowStep,
    status: LiveStepStatus,
    extra: { message?: string; manualHandoff?: HandoffInfo; error?: string; durationMs?: number; timestamp?: string } = {}
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
      timestamp: extra.timestamp ?? new Date().toISOString()
    });
  }

  async execute(step: FlowStep): Promise<StepExecutionResult> {
    const startedAt = new Date().toISOString();
    const outputs: Record<string, unknown> = {};

    this.log("info", step, `Executing step ${step.name}`);
    this.emitProgress(step, "running", { message: `Running: ${step.name}`, timestamp: startedAt });

    try {
      this.guardLocatorQuality(step);
      const result = await this.executeStep(step, outputs);

      // Auto protected-login detection after navigation-type steps (never bypasses — only pauses).
      if (result.status === "passed" && PROTECTED_LOGIN_AUTODETECT_STEPS.has(step.type)) {
        const detection = await detectProtectedLogin(this.activePage).catch(() => null);
        if (detection && detection.detected) {
          const info: HandoffInfo = {
            kind: "protectedLogin",
            message: detection.message,
            provider: detection.provider,
            reason: detection.reason,
            url: detection.url,
            allowedActions: ["cancel", "retry", "continue"]
          };
          this.log("info", step, `Protected login detected (${detection.provider}/${detection.reason}) — pausing for handoff.`);
          await this.waitForHandoffAction(step, info);
        }
      }

      const endedAt = new Date().toISOString();
      const durationMs = Date.parse(endedAt) - Date.parse(startedAt);
      const liveStatus: LiveStepStatus = result.status === "passed" ? "succeeded" : result.status === "failed" ? "failed" : result.status === "manualHandoff" ? "waitingForManualAction" : "skipped";
      this.emitProgress(step, liveStatus, {
        message: liveStatus === "succeeded" ? `Completed: ${step.name}` : liveStatus === "waitingForManualAction" ? (result.manualHandoff?.message ?? `Waiting: ${step.name}`) : `Step ${step.name} ${liveStatus}`,
        durationMs,
        timestamp: endedAt
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
        manualHandoff: result.manualHandoff,
        outcome: result.outcome,
        restartRequired: result.restartRequired
      };
    } catch (error) {
      const endedAt = new Date().toISOString();
      const message = error instanceof Error ? error.message : String(error);
      // Keep the full technical error in the structured logs...
      this.log("error", step, message);
      // ...but surface a cleaner message to the end user when the locator was ambiguous.
      const userMessage = StepExecutor.friendlyLocatorError(message);
      this.emitProgress(step, "failed", { message: `Failed: ${step.name}`, error: userMessage, durationMs: Date.parse(endedAt) - Date.parse(startedAt), timestamp: endedAt });
      return {
        stepId: step.id,
        status: "failed",
        startedAt,
        endedAt,
        durationMs: Date.parse(endedAt) - Date.parse(startedAt),
        outputs,
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
        await this.activePage.goto(url, { timeout: step.timeoutMs ?? 30_000 });
        return { status: "passed" };
      }

      case "click":
        await (await this.locatorFactory.resolve(step)).click({ timeout: step.timeoutMs ?? 10_000 });
        return { status: "passed" };

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
        await (await this.locatorFactory.resolve(step)).setInputFiles(filePath);
        this.mapOutputs(step, outputs, { uploadedFileName: basename(filePath), uploadedFilePath: filePath });
        return { status: "passed" };
      }

      case "downloadFile": {
        const downloadPromise = this.activePage.waitForEvent("download", { timeout: step.timeoutMs ?? 30_000 });
        await (await this.locatorFactory.resolve(step)).click();
        const download = await downloadPromise;
        await mkdir(this.context.paths.downloads, { recursive: true });
        const filePath = join(this.context.paths.downloads, download.suggestedFilename());
        await download.saveAs(filePath);
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
        await this.waitForHandoffAction(step, info);
        return { status: "passed", outcome: "manualContinued" };
      }

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
        await this.activePage.goto(urlValue, { timeout });
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

    const baseDir =
      cfg.sessionFolder && cfg.sessionFolder.trim()
        ? cfg.sessionFolder.trim()
        : this.context.paths.sessions ?? join(dirname(this.context.paths.reports), "sessions");
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
    await this.browserRestarter({ newUserDataDir: finalProfile.profileDir });

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
    await this.browserRestarter({ newUserDataDir: profile.profileDir });
    await this.sessionService.markUsed(profile.id);

    Object.assign(outputs, { sessionLoaded: true, sessionId: profile.id, outcome: "sessionLoaded" });
    return { status: "passed", outcome: "sessionLoaded" };
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
      "Protected login handoff: complete authentication using a supported, approved method. WebFlow Studio will not bypass login protections.";

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
      count = this.context.workflowDataSource?.rows.length ?? 0;
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
      await options.element.screenshot({ path: screenshotPath });
    } else {
      await this.activePage.screenshot({ path: screenshotPath, fullPage: options?.fullPage ?? true });
    }
    return screenshotPath;
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
