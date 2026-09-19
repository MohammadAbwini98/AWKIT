/**
 * Run-lifetime failure evidence collector (Phase L, L5a): the new evidence owner.
 *
 * It attaches through the same per-generation lifecycle `PassiveCdpTrace` uses
 * (`ExecutionEngine` → `onBrowserRuntime` / `onRuntimeClosing`), so it adds no second browser owner.
 * `NetworkDiagnosticsObserver` keeps its per-action role and `captureFailureEvidence` its
 * point-in-time screenshot/DOM role. This collector owns page and popup attach, the UI init script,
 * listeners, step-window correlation, bounded buffering, teardown and the report handoff.
 *
 * Signals: HTTP errors (metadata only: method, path template, status, resource type), transport
 * failures, uncaught page errors, `console.error` text, main-frame error documents (status, title,
 * heading), UI alerts, toasts and field validation from the init script, and the runner's own
 * failure. Response bodies, request bodies, headers and cookies are never read.
 *
 * Protected-login surfaces are excluded entirely (docs/ai/DECISIONS.md, Phase L privacy policy):
 * nothing page-derived is kept from a document carrying a password or one-time-code field (the init
 * script reports it, and whatever was already collected from that document is retracted), from a
 * page the runner handed off as a protected login, or while a protected-login, secure-login,
 * session-reuse or manual-handoff step is in progress. Only the runner's own failure survives.
 *
 * Everything is best-effort. A listener or binding that fails degrades the collector and never
 * touches the run.
 */

import { randomBytes } from "node:crypto";

import type { BrowserContext, ConsoleMessage, Frame, Page, Request, Response } from "playwright";

import { classifyError } from "../runtime/ErrorClassifier";
import type { RunnerProgressEvent } from "../RunnerProgress";
import {
  EvidenceBuffer,
  EvidenceRunBudget,
  type EvidenceInput,
  type EvidenceLimits,
  type EvidenceSeverity,
  type EvidenceSummary,
  type ExecutionEvidenceEvent
} from "./ExecutionEvidence";
import { deriveFailureCause, type FailureCauseBaseline, type RunnerFailure, type RunnerFailureKind } from "./FailureCauseBaseline";
import { buildUiEvidenceFlush, buildUiEvidenceScript, type UiEvidenceKind } from "./uiEvidenceScript";

export const INSTANCE_DIAGNOSTICS_SCHEMA_VERSION = 1;

/** The optional `diagnostics` extension on an instance report. Old reports simply lack it. */
export interface InstanceDiagnostics {
  schemaVersion: typeof INSTANCE_DIAGNOSTICS_SCHEMA_VERSION;
  evidence: ExecutionEvidenceEvent[];
  summary: EvidenceSummary;
  /** Present for a failed or cancelled instance. */
  cause?: FailureCauseBaseline;
  /** Attach or listener failures, as counts. The run itself was never affected. */
  degraded?: number;
}

export interface FailureEvidenceCollectorOptions {
  executionId: string;
  instanceId: string;
  budget: EvidenceRunBudget;
  limits?: Partial<EvidenceLimits>;
  /** `console.error` capture. Default on (bounded). */
  captureConsole?: boolean;
  now?: () => number;
}

/** Resource types whose failure can explain a run. Images, fonts and media are also what lean routing blocks. */
const RELEVANT_RESOURCES = new Set(["document", "xhr", "fetch", "script", "eventsource", "websocket"]);
const UI_KINDS: ReadonlySet<UiEvidenceKind> = new Set(["alert", "status", "toast", "fieldInvalid"]);
/** Steps that act on a protected-login surface: nothing page-derived is kept while one runs. */
const PROTECTED_STEP_TYPES: ReadonlySet<string> = new Set(["protectedLoginHandoff", "autoSecureLogin", "reuseSession"]);
const ERROR_DOCUMENT_EXPRESSION = `(() => ({
  title: document.title || "",
  heading: ((document.querySelector("h1") || {}).innerText || "").slice(0, 200),
  guarded: Boolean(document.querySelector('input[type="password"],input[autocomplete="one-time-code"],input[autocomplete="current-password"],input[autocomplete="new-password"]'))
}))()`;

let livePages = 0;
let liveGenerations = 0;

/** Pages and browser generations still attached, across every collector in this process. 0 when idle. */
export function liveEvidenceAttachments(): { pages: number; generations: number } {
  return { pages: livePages, generations: liveGenerations };
}

/** `ErrorClassifier` classes → the baseline's runner failure kinds. */
export function runnerFailureKind(error: string | undefined, stepType?: string): RunnerFailureKind {
  // A wait step that ran out of time timed out, although Playwright words it "locator.waitFor: Timeout".
  if (stepType === "wait" && /\btimeout \d+\s*ms exceeded|\btimed out\b/i.test(error ?? "")) return "timeout";
  switch (classifyError(error, stepType)) {
    case "cancelled":
      return "cancelled";
    case "timeout":
      return "timeout";
    case "locator":
      return "locator";
    case "navigation":
      return "navigation";
    case "business-rule":
      return "assertion";
    default:
      return "other";
  }
}

/**
 * The runner's message without Playwright's terminal colour codes and "Call log": the log quotes
 * matched elements' HTML (page content, attribute values), which is not a runner diagnosis.
 */
export function runnerFailureMessage(error: string | undefined): string {
  const plain = String(error ?? "").replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");
  return plain.split(/\r?\n\s*Call log:/)[0].trim();
}

/** Origin + path: the identity of a document, never its query or fragment. */
function documentKey(raw: string | undefined): string | undefined {
  try {
    const url = new URL(raw ?? "");
    return `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
}

interface GenerationBinding {
  context: BrowserContext;
  onPage: (page: Page) => void;
  pages: Set<Page>;
}

type ErrorDocumentDetails = { title: string; heading: string; guarded: boolean };

export class FailureEvidenceCollector {
  private readonly buffer: EvidenceBuffer;
  private readonly bindingName = `__awkitEvidence${randomBytes(6).toString("hex")}`;
  private readonly generations = new Map<number, GenerationBinding>();
  private readonly detachers = new Map<Page, () => void>();
  private readonly pageIds = new WeakMap<Page, string>();
  /** Frames whose current document is a protected-login surface, per page. */
  private readonly guardedFrames = new Map<Page, Set<Frame>>();
  /** Offset of each page's latest main-frame navigation: where its current document's evidence starts. */
  private readonly navMarks = new WeakMap<Page, number>();
  /** Error-document captures still waiting for title and heading; flushed without them at finish. */
  private readonly pendingDocuments = new Set<() => void>();
  private readonly captureConsole: boolean;
  private pageSequence = 0;
  private stepStartOffsetMs: number | undefined;
  private stepType: string | undefined;
  /** A protected-login step or a manual handoff is in progress. */
  private suppressed = false;
  private failure: RunnerFailure | undefined;
  private degraded = 0;
  private stopped = false;

  constructor(private readonly options: FailureEvidenceCollectorOptions) {
    this.buffer = new EvidenceBuffer({ executionId: options.executionId, instanceId: options.instanceId }, options.budget, {
      limits: options.limits,
      now: options.now
    });
    this.captureConsole = options.captureConsole ?? true;
  }

  /**
   * Awaited on the instance's start-up path, so it holds only what must precede the first
   * navigation: the init script (one round trip). Exposing the binding takes several sequential
   * round trips (~330 ms median under start-up contention, measured by verify:failure-capture-overhead),
   * so it completes in the background; until it does, the script queues its messages and each frame
   * is flushed once it lands.
   */
  async startGeneration(runtime: { context: BrowserContext }, generation: number): Promise<void> {
    if (this.stopped) return;
    const { context } = runtime;
    try {
      await context.addInitScript({ content: buildUiEvidenceScript(this.bindingName) });
    } catch {
      this.degraded += 1;
      return;
    }
    const binding: GenerationBinding = { context, onPage: (page) => this.attachPage(page, binding), pages: new Set() };
    this.generations.set(generation, binding);
    liveGenerations += 1;
    context.on("page", binding.onPage);
    for (const page of context.pages()) this.attachPage(page, binding);
    context
      .exposeBinding(this.bindingName, (source: { page: Page; frame: Frame }, payload: unknown) => this.onUi(source.page, source.frame, payload))
      .then(
        () => {
          const flush = buildUiEvidenceFlush(this.bindingName);
          for (const page of binding.pages) for (const frame of page.frames()) void frame.evaluate(flush).catch(() => undefined);
        },
        () => {
          if (!this.stopped) this.degraded += 1;
        }
      );
  }

  async stopGeneration(generation: number): Promise<void> {
    const binding = this.generations.get(generation);
    if (!binding) return;
    binding.context.off("page", binding.onPage);
    for (const page of [...binding.pages]) this.detach(page);
    this.generations.delete(generation);
    liveGenerations -= 1;
  }

  /** Step correlation, fed from the runner's progress events. Never throws into the progress path. */
  onProgress(event: RunnerProgressEvent): void {
    this.guard(() => this.correlate(event));
  }

  private correlate(event: RunnerProgressEvent): void {
    if (event.status === "waitingForManualAction") {
      // A human is acting in the page (possibly signing in). Nothing page-derived is kept meanwhile,
      // and a page handed off as a protected login stays excluded until it loads another document.
      this.suppressed = true;
      if (event.manualHandoff?.kind === "protectedLogin") this.guardPagesAt(event.manualHandoff.url);
      return;
    }
    if (!event.stepId) return;
    if (event.status === "running") {
      this.stepStartOffsetMs = this.buffer.offsetNow();
      this.stepType = event.stepType;
      this.buffer.setStep({ flowId: event.flowId, nodeId: event.stepId });
      this.suppressed = PROTECTED_STEP_TYPES.has(event.stepType ?? "");
      // The step's page is a login surface: what its current document produced goes too.
      if (this.suppressed) for (const page of this.detachers.keys()) this.retractDocument(page);
      return;
    }
    if (event.status !== "failed" && event.status !== "cancelled") return;
    const kind = event.status === "cancelled" ? "cancelled" : runnerFailureKind(event.error, event.stepType ?? this.stepType);
    const recorded = this.add({
      source: "runner.failure",
      severity: "error",
      payload: { kind, stepType: event.stepType ?? this.stepType ?? "", message: runnerFailureMessage(event.error) },
      dedupeFields: ["kind", "stepType", "message"],
      context: { flowId: event.flowId, nodeId: event.stepId }
    });
    this.failure = {
      kind,
      stepStartOffsetMs: this.stepStartOffsetMs,
      failedAtOffsetMs: this.buffer.offsetNow(),
      evidenceId: recorded?.id
    };
  }

  /**
   * Stop collecting and hand over the report extension. Undefined for a passed instance that
   * produced no evidence, so a clean run's report does not grow.
   */
  finish(status: string): InstanceDiagnostics | undefined {
    for (const flush of [...this.pendingDocuments]) flush();
    this.stop();
    const events = [...this.buffer.list()];
    // A manual handoff is a pause, not a failure: it keeps its evidence but gets no cause.
    const failed = status === "failed" || status === "cancelled" || status === "crashed";
    const summary = this.buffer.summary();
    if (!failed && events.length === 0 && this.degraded === 0 && summary.dropped.protected === 0) return undefined;
    const diagnostics: InstanceDiagnostics = { schemaVersion: INSTANCE_DIAGNOSTICS_SCHEMA_VERSION, evidence: events, summary };
    if (failed) {
      const failure: RunnerFailure = this.failure ?? { kind: "other", failedAtOffsetMs: this.buffer.offsetNow() };
      // A hard cancel closes the browser, so the step in flight fails with a closed-context error.
      diagnostics.cause = deriveFailureCause(events, status === "cancelled" ? { ...failure, kind: "cancelled" } : failure);
    }
    if (this.degraded > 0) diagnostics.degraded = this.degraded;
    return diagnostics;
  }

  /** Detach everything. Idempotent; the engine calls it on every instance exit path. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const generation of [...this.generations.keys()]) void this.stopGeneration(generation);
  }

  // ── Pages ────────────────────────────────────────────────────────────────────────────────────

  private attachPage(page: Page, binding: GenerationBinding): void {
    if (this.stopped || this.detachers.has(page)) return;
    this.pageSequence += 1;
    this.pageIds.set(page, `p${this.pageSequence}`);
    this.navMarks.set(page, this.buffer.offsetNow());
    binding.pages.add(page);
    const onResponse = (response: Response) => this.guard(() => this.onResponse(page, response));
    const onRequestFailed = (request: Request) => this.guard(() => this.onRequestFailed(page, request));
    const onPageError = (error: Error) => this.guard(() => this.onPageError(page, error));
    const onConsole = (message: ConsoleMessage) => this.guard(() => this.onConsole(page, message));
    const onNavigated = (frame: Frame) => {
      if (frame === page.mainFrame()) this.navMarks.set(page, this.buffer.offsetNow());
    };
    const onClose = () => this.detach(page);
    page.on("response", onResponse);
    page.on("requestfailed", onRequestFailed);
    page.on("pageerror", onPageError);
    page.on("console", onConsole);
    page.on("framenavigated", onNavigated);
    page.once("close", onClose);
    livePages += 1;
    this.detachers.set(page, () => {
      page.off("response", onResponse);
      page.off("requestfailed", onRequestFailed);
      page.off("pageerror", onPageError);
      page.off("console", onConsole);
      page.off("framenavigated", onNavigated);
      page.off("close", onClose);
      binding.pages.delete(page);
      this.guardedFrames.delete(page);
      livePages -= 1;
    });
    // A page that loaded before the init script was registered gets the script once; every later
    // document in it gets the script from `addInitScript`. A fresh Playwright page starts at
    // `about:blank`, where injecting the large script is redundant: its first real document will
    // receive the init script, and the extra protocol command otherwise contends with navigation
    // when several instances start together.
    if (page.url() !== "about:blank") void page.evaluate(buildUiEvidenceScript(this.bindingName)).catch(() => undefined);
  }

  private detach(page: Page): void {
    this.detachers.get(page)?.();
    this.detachers.delete(page);
  }

  private guard(fn: () => void): void {
    if (this.stopped) return;
    try {
      fn();
    } catch {
      this.degraded += 1;
    }
  }

  private isProtected(page: Page | undefined): boolean {
    if (this.suppressed) return true;
    const frames = page ? this.guardedFrames.get(page) : undefined;
    return frames !== undefined && [...frames].some((frame) => !frame.isDetached());
  }

  /** Mark a frame's current document protected (or clear it when it loads an ordinary one). */
  private setGuard(page: Page, frame: Frame, guarded: boolean): void {
    let frames = this.guardedFrames.get(page);
    if (!guarded) {
      frames?.delete(frame);
      return;
    }
    if (!frames) this.guardedFrames.set(page, (frames = new Set()));
    frames.add(frame);
    this.retractDocument(page);
  }

  /** Remove what the page's current document already produced. The runner's own failure stays. */
  private retractDocument(page: Page): void {
    const pageId = this.pageIds.get(page);
    const since = this.navMarks.get(page) ?? 0;
    this.buffer.retract((event) => event.source !== "runner.failure" && event.context.pageId === pageId && event.offsetMs >= since);
  }

  /** The runner handed off a protected login at `url`: exclude every page showing that document. */
  private guardPagesAt(url: string | undefined): void {
    const target = documentKey(url);
    for (const page of this.detachers.keys()) {
      if (target === undefined || documentKey(page.url()) === target) this.setGuard(page, page.mainFrame(), true);
    }
  }

  private add(input: EvidenceInput & { page?: Page }): ExecutionEvidenceEvent | null {
    if (input.source !== "runner.failure" && this.isProtected(input.page)) {
      this.buffer.dropProtected();
      return null;
    }
    const pageId = input.page ? this.pageIds.get(input.page) : undefined;
    return this.buffer.add(pageId ? { ...input, context: { ...input.context, pageId } } : input);
  }

  // ── Signals ──────────────────────────────────────────────────────────────────────────────────

  private onResponse(page: Page, response: Response): void {
    const status = response.status();
    if (status < 400) return;
    const request = response.request();
    let isDocument = false;
    try {
      isDocument = request.isNavigationRequest() && request.frame() === page.mainFrame();
    } catch {
      isDocument = false;
    }
    if (isDocument) {
      this.captureErrorDocument(page, status, response.url());
      return;
    }
    const resourceType = request.resourceType();
    if (!RELEVANT_RESOURCES.has(resourceType)) return;
    this.add({
      page,
      source: "http.error",
      severity: resourceType === "script" && status < 500 ? "warning" : "error",
      payload: { method: request.method(), url: response.url(), status, resourceType },
      dedupeFields: ["method", "url", "status"]
    });
  }

  /**
   * Status and URL at once; title and heading once the document parses, still at the response's
   * offset. A capture still pending when the instance finishes is recorded without them.
   */
  private captureErrorDocument(page: Page, status: number, url: string): void {
    const atOffsetMs = this.buffer.offsetNow();
    let settled = false;
    const record = (details?: ErrorDocumentDetails) => {
      if (settled) return;
      settled = true;
      this.pendingDocuments.delete(flush);
      if (details?.guarded) {
        this.buffer.dropProtected();
        return;
      }
      this.add({
        page,
        source: "page.errorDocument",
        severity: "error",
        payload: details ? { status, url, title: details.title, heading: details.heading } : { status, url },
        dedupeFields: ["status", "url"],
        atOffsetMs
      });
    };
    const flush = () => record();
    this.pendingDocuments.add(flush);
    // The response arrives before its document commits, so the page still shows the previous one:
    // wait for the next DOMContentLoaded (this document's), never the current load state.
    page
      .waitForEvent("domcontentloaded", { timeout: 3_000 })
      .then(() => page.evaluate(ERROR_DOCUMENT_EXPRESSION) as Promise<ErrorDocumentDetails>)
      .then(
        (details) => this.guard(() => record(details)),
        () => this.guard(() => record())
      );
  }

  private onRequestFailed(page: Page, request: Request): void {
    const failure = request.failure()?.errorText ?? "unknown";
    // A navigation replaced mid-flight or a request the page itself cancelled is not a failure.
    if (/ERR_ABORTED/i.test(failure)) return;
    const resourceType = request.resourceType();
    if (!RELEVANT_RESOURCES.has(resourceType)) return;
    this.add({
      page,
      source: "network.failed",
      severity: "error",
      payload: { method: request.method(), url: request.url(), failure, resourceType },
      dedupeFields: ["method", "url", "failure"]
    });
  }

  private onPageError(page: Page, error: Error): void {
    const frame = (error.stack ?? "").split("\n").find((line) => line.trim().startsWith("at ")) ?? "";
    this.add({ page, source: "page.error", severity: "error", payload: { name: error.name || "Error", message: error.message ?? "", frame: frame.trim() }, dedupeFields: ["name", "message"] });
  }

  private onConsole(page: Page, message: ConsoleMessage): void {
    if (!this.captureConsole || message.type() !== "error") return;
    this.add({ page, source: "console.error", severity: "warning", payload: { text: message.text() } });
  }

  /** From the page: untrusted. Only the documented shapes are accepted, and the buffer still masks and caps them. */
  private onUi(page: Page, frame: Frame, raw: unknown): void {
    if (this.stopped || typeof raw !== "object" || raw === null) return;
    const payload = raw as Record<string, unknown>;
    if (payload.kind === "document") {
      this.guard(() => this.setGuard(page, frame, payload.guarded === true));
      return;
    }
    const kind = payload.kind as UiEvidenceKind;
    if (!UI_KINDS.has(kind)) return;
    const tone = payload.tone === "error" || payload.tone === "success" ? payload.tone : "neutral";
    const text = typeof payload.text === "string" ? payload.text : "";
    // A message that waited in the page's queue happened `ageMs` ago (bounded; the page is untrusted).
    const age = typeof payload.ageMs === "number" && Number.isFinite(payload.ageMs) ? Math.min(Math.max(payload.ageMs, 0), 10_000) : 0;
    this.guard(() => {
      const atOffsetMs = age > 0 ? Math.max(0, this.buffer.offsetNow() - age) : undefined;
      if (kind === "fieldInvalid") {
        this.add({
          page,
          source: "ui.fieldInvalid",
          severity: "error",
          payload: {
            field: typeof payload.field === "string" ? payload.field : "",
            validity: typeof payload.validity === "string" ? payload.validity : "",
            message: text,
            describedBy: typeof payload.describedBy === "string" ? payload.describedBy : ""
          },
          dedupeFields: ["field", "validity"],
          atOffsetMs
        });
        return;
      }
      const severity: EvidenceSeverity = tone === "error" ? (kind === "status" ? "warning" : "error") : tone === "success" ? "info" : kind === "status" ? "info" : "warning";
      this.add({
        page,
        source: kind === "alert" ? "ui.alert" : kind === "toast" ? "ui.toast" : "ui.status",
        severity,
        payload: { role: typeof payload.role === "string" ? payload.role : "", text, tone },
        atOffsetMs
      });
    });
  }
}
