/**
 * Run-lifetime failure evidence collector (Phase L, L5a): the new evidence owner.
 *
 * It attaches through the runner's per-generation lifecycle (`ExecutionEngine` → `onBrowserContext`,
 * before the first page, / `onRuntimeClosing`), so it adds no second browser owner.
 * `NetworkDiagnosticsObserver` keeps its per-action role and `captureFailureEvidence` its
 * point-in-time screenshot/DOM role. This collector owns page and popup attach, the UI init script,
 * listeners, step-window correlation, bounded buffering, teardown and the report handoff.
 *
 * Signals: HTTP errors (metadata only: method, path template, status, resource type), transport
 * failures, uncaught page errors, `console.error` text, main-frame error documents (status, title,
 * heading), UI alerts, toasts and field validation from the init script, and the runner's own
 * failure. Response bodies, request bodies, headers and cookies are never read.
 *
 * Request provenance (2026-09-22): each network event carries its request's stable id, the step it was
 * issued in (from the context's `request` event), its frame, and a link when the runner itself holds the
 * request for a step (`RunnerProgressReporter.observe`). The failure record carries the page and frame
 * the failed step acted on. `requestRelations` reads these; nothing is inferred from co-occurrence.
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

import { PROTECTED_LOGIN_STEP_TYPES } from "../../profiles/FlowProfile";
import { classifyError } from "../runtime/ErrorClassifier";
import type { RunnerProgressEvent, StepProvenanceObservation } from "../RunnerProgress";
import {
  EvidenceBuffer,
  EvidenceRunBudget,
  type EvidenceInput,
  type EvidenceLimits,
  type EvidenceSeverity,
  type EvidenceSummary,
  type ExecutionEvidenceEvent,
  type RequestProvenance
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
  /**
   * Raw-UI-text suppression (privacy policy, default off): keep role, source, codes, counts and field
   * identity, drop visible page text. The page script never sends the text at all.
   */
  suppressUiText?: boolean;
  now?: () => number;
}

/** Resource types whose failure can explain a run. Images, fonts and media are also what lean routing blocks. */
const RELEVANT_RESOURCES = new Set(["document", "xhr", "fetch", "script", "eventsource", "websocket"]);
const UI_KINDS: ReadonlySet<UiEvidenceKind> = new Set(["alert", "status", "toast", "fieldInvalid"]);
/**
 * Steps that act on a protected-login surface: nothing page-derived is kept while one runs. The
 * membership comes from `FlowProfile`, beside the `StepType` union that defines those names — this
 * module used to restate it under a different name, so a type added to the surface could have gone on
 * being collected here while the vocabulary already called it protected. Only the STATIC type is
 * widened: a runner event's `stepType` is an arbitrary string, and asserting it into `StepType` to
 * satisfy the lookup would claim something about the value that nothing has checked.
 */
const PROTECTED_STEP_TYPES: ReadonlySet<string> = PROTECTED_LOGIN_STEP_TYPES;
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

/** The page a request belongs to; undefined for service-worker requests, which have no frame. */
function pageOfRequest(request: Request): Page | undefined {
  try {
    return request.frame().page();
  } catch {
    return undefined;
  }
}

/** Which frame of its page issued a request; undefined when Playwright cannot say. */
function frameOfRequest(request: Request, page: Page): "main" | "child" | undefined {
  try {
    return request.frame() === page.mainFrame() ? "main" : "child";
  } catch {
    return undefined;
  }
}

interface GenerationBinding {
  context: BrowserContext;
  /** False once the generation stopped: its context-level listeners are inert from then on. */
  active: boolean;
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
  private readonly suppressUiText: boolean;
  private readonly uiScript: string;
  private pageSequence = 0;
  /**
   * Request provenance, per Playwright `Request` (the same object across its `request`, `response` and
   * `requestfailed` events, so it is the identity). Plain data only: nothing here keeps a Request alive.
   */
  private readonly requests = new WeakMap<Request, RequestProvenance>();
  private requestSequence = 0;
  /** Each step's latest execution index, for the runner's links (parallel branches run several steps). */
  private readonly stepIndexes = new Map<string, number>();
  /** The page and frame the current step acts on, once the runner has resolved them. */
  private stepTarget: { pageId?: string; frame?: "main" | "child" } | undefined;
  private stepIndex = 0;
  private stepId: string | undefined;
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
    this.suppressUiText = options.suppressUiText ?? false;
    this.uiScript = buildUiEvidenceScript(this.bindingName, { keepText: !this.suppressUiText });
  }

  /**
   * Called as soon as the generation's context exists, before its first page (`onBrowserContext`),
   * so the init script and binding join each page's own initialization. Only the init script is
   * awaited. Exposing the binding is never awaited on the start-up path (against a live page it takes
   * several sequential round trips, ~330 ms median under start-up contention, measured by
   * verify:failure-capture-overhead); until it lands, the script queues its messages and each frame is
   * flushed once it does.
   *
   * Network and console listeners are context-level: every Playwright subscription change is a
   * protocol call that captures a stack trace, so one subscription per generation replaces three per
   * page plus three more at each page's close.
   */
  async startGeneration(runtime: { context: BrowserContext }, generation: number): Promise<void> {
    if (this.stopped) return;
    const { context } = runtime;
    try {
      await context.addInitScript({ content: this.uiScript });
    } catch {
      this.degraded += 1;
      return;
    }
    const binding: GenerationBinding = { context, active: true, onPage: (page) => this.attachPage(page, binding), pages: new Set() };
    this.generations.set(generation, binding);
    liveGenerations += 1;
    context.on("page", binding.onPage);
    /** Route a context event to its page, attaching a page the `page` event has not delivered yet. */
    const route = (page: Page | null | undefined, handle: (page: Page) => void) =>
      this.guard(() => {
        if (!binding.active || !page || page.isClosed()) return;
        if (!this.detachers.has(page)) this.attachPage(page, binding);
        if (this.detachers.has(page)) handle(page);
      });
    // Only when a request is issued is its step known: its response may come steps later.
    context.on("request", (request: Request) => this.guard(() => binding.active && this.onRequest(request)));
    context.on("response", (response: Response) => route(pageOfRequest(response.request()), (page) => this.onResponse(page, response)));
    context.on("requestfailed", (request: Request) => route(pageOfRequest(request), (page) => this.onRequestFailed(page, request)));
    if (this.captureConsole) context.on("console", (message: ConsoleMessage) => route(message.page(), (page) => this.onConsole(page, message)));
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

  /**
   * A generation stops because its context is closing (`onRuntimeClosing`) or already closed. The
   * context-level network and console listeners are made inert, not removed: removing them is one
   * more protocol call each, against a context about to be discarded, and they go with it.
   */
  async stopGeneration(generation: number): Promise<void> {
    const binding = this.generations.get(generation);
    if (!binding) return;
    binding.active = false;
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
      // The Nth step execution in this instance, so each loop iteration of one node is its own window.
      // A retry of the step already running keeps its index.
      if (!(event.retryCount && event.stepId === this.stepId)) this.stepIndex += 1;
      this.stepId = event.stepId;
      this.stepIndexes.set(event.stepId, this.stepIndex);
      this.stepTarget = undefined;
      this.stepStartOffsetMs = this.buffer.offsetNow();
      this.stepType = event.stepType;
      this.buffer.setStep({ flowId: event.flowId, nodeId: event.stepId, stepIndex: this.stepIndex });
      this.suppressed = PROTECTED_STEP_TYPES.has(event.stepType ?? "");
      // The step's page is a login surface: what its current document produced goes too.
      if (this.suppressed) for (const page of this.detachers.keys()) this.retractDocument(page);
      return;
    }
    if (event.status !== "failed" && event.status !== "cancelled") return;
    const kind = event.status === "cancelled" ? "cancelled" : runnerFailureKind(event.error, event.stepType ?? this.stepType);
    // An assertion message quotes the page's actual text ("…" equals "…"): hidden with the rest.
    const message = runnerFailureMessage(event.error);
    const recorded = this.add({
      source: "runner.failure",
      severity: "error",
      payload: { kind, stepType: event.stepType ?? this.stepType ?? "", message: this.suppressUiText ? message.replace(/"[^"]*"/g, '"[hidden]"') : message },
      dedupeFields: ["kind", "stepType", "message"],
      context: {
        flowId: event.flowId,
        nodeId: event.stepId,
        stepIndex: event.stepId === this.stepId ? this.stepIndex : undefined,
        // The page and frame the failed step acted on, when the runner had resolved them.
        ...(event.stepId === this.stepId ? this.stepTarget : undefined)
      }
    });
    this.failure = {
      kind,
      stepStartOffsetMs: this.stepStartOffsetMs,
      failedAtOffsetMs: this.buffer.offsetNow(),
      evidenceId: recorded?.id
    };
  }

  /**
   * Request provenance from the runner (`RunnerProgressReporter.observe`): the page and frame the
   * current step acts on, and a request a step holds. Never throws into the step.
   */
  observe(observation: StepProvenanceObservation): void {
    this.guard(() => {
      if (observation.kind === "target") {
        if (observation.stepId !== this.stepId) return;
        const pageId = this.pageIds.get(observation.page);
        this.stepTarget = { ...(pageId ? { pageId } : {}), ...(observation.frame ? { frame: observation.frame } : {}) };
        return;
      }
      const facts = this.requestFacts(observation.request);
      const at = this.stepIndexes.get(observation.stepId);
      // A link whose step execution is unknown is not recorded: it would be a link to nothing.
      if (at === undefined) return;
      facts.link = observation.link;
      facts.linkStepIndex = at;
    });
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
    // Only events Playwright delivers without a subscription are per page, so attaching and detaching
    // a page costs no protocol call. Network and console arrive through the context (startGeneration).
    const onPageError = (error: Error) => this.guard(() => this.onPageError(page, error));
    const onNavigated = (frame: Frame) => {
      if (frame === page.mainFrame()) this.navMarks.set(page, this.buffer.offsetNow());
    };
    const onClose = () => this.detach(page);
    page.on("pageerror", onPageError);
    page.on("framenavigated", onNavigated);
    page.once("close", onClose);
    livePages += 1;
    this.detachers.set(page, () => {
      page.off("pageerror", onPageError);
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
    if (page.url() !== "about:blank") void page.evaluate(this.uiScript).catch(() => undefined);
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

  /** A request was issued: record its step and time. Only resource types whose failure is ever kept. */
  private onRequest(request: Request): void {
    if (this.requests.has(request) || !RELEVANT_RESOURCES.has(request.resourceType())) return;
    this.requestFacts(request, true);
  }

  /**
   * The provenance object for a request, created on first sight. A redirect hop keeps its chain's id and
   * issue; a request first seen after it was issued (a page that was loading before the collector
   * attached) gets an id and no issue, so its relation to any step stays unknown.
   */
  private requestFacts(request: Request, issuedNow = false): RequestProvenance {
    const known = this.requests.get(request);
    if (known) return known;
    const from = request.redirectedFrom();
    const root = from ? this.requestFacts(from) : undefined;
    const facts: RequestProvenance = root
      ? { id: root.id, redirects: root.redirects + 1, issuedAtOffsetMs: root.issuedAtOffsetMs, issuedStepIndex: root.issuedStepIndex }
      : issuedNow
        ? { id: `rq${++this.requestSequence}`, redirects: 0, issuedAtOffsetMs: this.buffer.offsetNow(), issuedStepIndex: this.stepIndex }
        : { id: `rq${++this.requestSequence}`, redirects: 0 };
    this.requests.set(request, facts);
    return facts;
  }

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
      this.captureErrorDocument(page, status, response.url(), this.requestFacts(request));
      return;
    }
    const resourceType = request.resourceType();
    if (!RELEVANT_RESOURCES.has(resourceType)) return;
    this.add({
      page,
      source: "http.error",
      severity: resourceType === "script" && status < 500 ? "warning" : "error",
      payload: { method: request.method(), url: response.url(), status, resourceType },
      dedupeFields: ["method", "url", "status"],
      context: { frame: frameOfRequest(request, page) },
      request: this.requestFacts(request)
    });
  }

  /**
   * Status and URL at once; title and heading once the document parses, still at the response's
   * offset. A capture still pending when the instance finishes is recorded without them.
   */
  private captureErrorDocument(page: Page, status: number, url: string, request: RequestProvenance): void {
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
        payload: details && !this.suppressUiText ? { status, url, title: details.title, heading: details.heading } : { status, url },
        dedupeFields: ["status", "url"],
        atOffsetMs,
        context: { frame: "main" },
        request
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
      dedupeFields: ["method", "url", "failure"],
      context: { frame: frameOfRequest(request, page) },
      request: this.requestFacts(request)
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
    // Suppression is enforced here too: the page is untrusted and may call the binding itself.
    const visible = (value: unknown) => (!this.suppressUiText && typeof value === "string" ? value : "");
    const text = visible(payload.text);
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
            describedBy: visible(payload.describedBy)
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
