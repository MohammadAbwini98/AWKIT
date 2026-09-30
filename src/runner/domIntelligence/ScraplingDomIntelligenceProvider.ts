import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import {
  DOM_INTELLIGENCE_LIMITS,
  DOM_INTELLIGENCE_PROTOCOL_VERSION,
  type DomIntelligenceFailure,
  type DomIntelligenceFailureCode,
  type DomIntelligenceProvider,
  type DomIntelligenceStatus,
  type DomNormalizationRequest,
  type DomNormalizationResult,
  type DomRecoveryCandidate,
  type DomRecoveryRequest,
  type DomRecoveryResult,
  type DomReferenceResult,
  type RawDomNormalization
} from "./DomIntelligenceProvider";
import { validateDomReference, type DomReferenceRecord } from "./domReference";

/**
 * The parser-only Scrapling provider (L11, plan E5): a child process owned by the Electron main process
 * (an Electron `utilityProcess` runs only Node), speaking one JSON object per line over stdio.
 *
 * Trust runs one way. The host is treated as untrusted output: every response line is size-bounded,
 * must parse, must answer the request id that is actually pending, and must match its operation's exact
 * shape, or the host is killed and the request fails MALFORMED/OVERSIZED. A request that outlives its
 * deadline kills the host too (a wedged parse must not queue work behind it). Repeated crashes open a
 * circuit so a broken runtime is not respawned on every step.
 *
 * The host is started lazily on the first request, never at application start, and never by a normal
 * successful step (only the recovery-failure path, the Spy/Designer and AI normalization call it).
 */

export interface ScraplingHostLaunch {
  /** The runtime's python.exe. */
  command: string;
  /** Interpreter flags then the host script; built by `scraplingHostLaunch`. */
  args: string[];
  cwd?: string;
}

export interface ScraplingProviderOptions {
  /** Resolved lazily so a missing runtime is a status, not a constructor failure. */
  launch: () => Promise<ScraplingHostLaunch | undefined> | ScraplingHostLaunch | undefined;
  startTimeoutMs?: number;
  /** Crashes inside `crashWindowMs` before the circuit opens for `crashWindowMs`. */
  maxCrashes?: number;
  crashWindowMs?: number;
  /** An idle host is stopped after this long (default 10 minutes) and restarted on the next request. */
  idleShutdownMs?: number;
}

interface HelloInfo {
  protocol: number;
  mode: string;
  python: string;
  scrapling: string;
  lxml: string;
  auditHook: boolean;
  network: boolean;
  browser: boolean;
  forbiddenModulesLoaded: string[];
}

interface Pending {
  op: string;
  child: ChildProcessWithoutNullStreams;
  resolve: (value: { ok: true; result: unknown } | DomIntelligenceFailure) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Interpreter flags every launch uses: isolated, no bytecode writes, UTF-8, no user site, no env. */
export const SCRAPLING_PYTHON_FLAGS = Object.freeze(["-I", "-B", "-s", "-E", "-X", "utf8"]);

export function scraplingHostLaunch(python: string, hostScript: string, cwd?: string): ScraplingHostLaunch {
  return { command: python, args: [...SCRAPLING_PYTHON_FLAGS, hostScript], ...(cwd ? { cwd } : {}) };
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isString = (value: unknown, max = 200): value is string => typeof value === "string" && value.length <= max;
const stringArray = (value: unknown, maxItems: number, maxLength: number): string[] | undefined =>
  Array.isArray(value) && value.length <= maxItems && value.every((item) => isString(item, maxLength)) ? (value as string[]) : undefined;

/** Exact-shape validators: the host's answer is data from another process, never trusted as typed. */
export const SCRAPLING_RESULT_VALIDATORS = {
  hello(value: unknown): HelloInfo | undefined {
    const v = value as Partial<HelloInfo> | null;
    if (!v || typeof v !== "object") return undefined;
    if (v.protocol !== DOM_INTELLIGENCE_PROTOCOL_VERSION || v.mode !== "parser-only") return undefined;
    if (!isString(v.python, 40) || !isString(v.scrapling, 40) || !isString(v.lxml, 40)) return undefined;
    if (v.auditHook !== true || v.network !== false || v.browser !== false) return undefined;
    const forbidden = stringArray(v.forbiddenModulesLoaded, 100, 200);
    if (!forbidden) return undefined;
    return v as HelloInfo;
  },
  find(value: unknown, maxCandidates: number): { candidates: DomRecoveryCandidate[]; elements: number; parseMs: number; matchMs: number } | undefined {
    const v = value as { candidates?: unknown; elements?: unknown; parseMs?: unknown; matchMs?: unknown } | null;
    if (!v || typeof v !== "object" || !Array.isArray(v.candidates) || v.candidates.length > maxCandidates) return undefined;
    if (!isNumber(v.elements) || !isNumber(v.parseMs) || !isNumber(v.matchMs)) return undefined;
    const candidates: DomRecoveryCandidate[] = [];
    for (const raw of v.candidates) {
      const c = raw as { index?: unknown; score?: unknown } | null;
      if (!c || !Number.isInteger(c.index) || (c.index as number) < 0 || !isNumber(c.score) || c.score < 0 || c.score > 100) return undefined;
      if (Object.keys(c).some((key) => key !== "index" && key !== "score")) return undefined;
      candidates.push({ index: c.index as number, score: c.score });
    }
    return { candidates, elements: v.elements, parseMs: v.parseMs, matchMs: v.matchMs };
  },
  reference(value: unknown): DomReferenceResult | undefined {
    const v = value as { fields?: unknown } | null;
    const fields = v && typeof v === "object" ? stringArray(v.fields, 20, 40) : undefined;
    return fields ? { ok: true, fields } : undefined;
  },
  normalize(value: unknown): { normalization: RawDomNormalization; ms: number } | undefined {
    const v = value as { normalization?: Partial<RawDomNormalization>; ms?: unknown } | null;
    const n = v?.normalization;
    if (!v || !n || typeof n !== "object" || !isNumber(v.ms) || typeof n.truncated !== "boolean") return undefined;
    const arrays = [n.landmarks, n.headings, n.interactive, n.alerts, n.forms, n.tables, n.text];
    if (!arrays.every((entry) => Array.isArray(entry) && entry.length <= 400)) return undefined;
    if (n.title !== undefined && !isString(n.title, 400)) return undefined;
    return { normalization: n as RawDomNormalization, ms: v.ms };
  }
};

export class ScraplingDomIntelligenceProvider implements DomIntelligenceProvider {
  private child: ChildProcessWithoutNullStreams | undefined;
  private starting: Promise<HelloInfo | DomIntelligenceFailure> | undefined;
  private hello: HelloInfo | undefined;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private buffer = "";
  private stderrTail = "";
  private crashes: number[] = [];
  private circuitOpenUntil = 0;
  private lastFailure: DomIntelligenceFailure | undefined;
  private stopped = false;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  /** Children stopped on purpose (idle): their exit is not a crash. */
  private readonly retired = new WeakSet<ChildProcessWithoutNullStreams>();

  constructor(private readonly options: ScraplingProviderOptions) {}

  async getStatus(): Promise<DomIntelligenceStatus> {
    const started = await this.ensureStarted();
    const base = { provider: "scrapling" as const, mode: "parser-only" as const, browserAccess: false as const, networkAccess: false as const };
    if ("ok" in started) return { ...base, available: false, reason: started.code, detail: started.message };
    this.armIdleStop();
    return {
      ...base,
      available: true,
      protocolVersion: started.protocol,
      version: started.scrapling,
      runtime: `CPython ${started.python}, lxml ${started.lxml}`
    };
  }

  async saveReference(reference: DomReferenceRecord): Promise<DomReferenceResult | DomIntelligenceFailure> {
    const valid = validateDomReference(reference);
    if (!valid) return { ok: false, code: "REJECTED", message: "The reference is not in its bounded, redacted form." };
    const response = await this.request("save_reference", { reference: valid }, DOM_INTELLIGENCE_LIMITS.defaultTimeoutMs);
    if (!response.ok) return response;
    return SCRAPLING_RESULT_VALIDATORS.reference(response.result) ?? this.malformed("save_reference");
  }

  async findRecoveryCandidates(request: DomRecoveryRequest): Promise<DomRecoveryResult> {
    const reference = validateDomReference(request.reference);
    if (!reference) return { ok: false, code: "REJECTED", message: "The reference is not in its bounded, redacted form." };
    if (typeof request.html !== "string" || Buffer.byteLength(request.html) > DOM_INTELLIGENCE_LIMITS.maxHtmlBytes) {
      return { ok: false, code: "OVERSIZED", message: "The DOM snapshot exceeds the request bound." };
    }
    const maxCandidates = Math.max(1, Math.min(request.maxCandidates ?? 5, DOM_INTELLIGENCE_LIMITS.maxCandidates));
    const minScore = Math.max(0, Math.min(request.minScore ?? 40, 100));
    const response = await this.request(
      "find_candidates",
      { html: request.html, reference, maxCandidates, minScore },
      this.timeout(request.timeoutMs)
    );
    if (!response.ok) return response;
    const result = SCRAPLING_RESULT_VALIDATORS.find(response.result, maxCandidates);
    return result ? { ok: true, ...result } : this.malformed("find_candidates");
  }

  async normalizeForAi(request: DomNormalizationRequest): Promise<DomNormalizationResult> {
    if (typeof request.html !== "string" || Buffer.byteLength(request.html) > DOM_INTELLIGENCE_LIMITS.maxHtmlBytes) {
      return { ok: false, code: "OVERSIZED", message: "The DOM snapshot exceeds the request bound." };
    }
    const response = await this.request("normalize_dom", { html: request.html }, this.timeout(request.timeoutMs));
    if (!response.ok) return response;
    const result = SCRAPLING_RESULT_VALIDATORS.normalize(response.result);
    return result ? { ok: true, ...result } : this.malformed("normalize_dom");
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const child = this.child;
    if (!child) return;
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    try {
      child.stdin.write(`${JSON.stringify({ id: this.nextId++, op: "shutdown" })}\n`);
      child.stdin.end();
    } catch {
      // Already gone.
    }
    const timer = setTimeout(() => child.kill(), 1_500);
    await exited;
    clearTimeout(timer);
  }

  /** Test seam: the live child's pid (undefined when not running). */
  get pid(): number | undefined {
    return this.child?.pid;
  }

  private timeout(requested: number | undefined): number {
    return Math.max(50, Math.min(requested ?? DOM_INTELLIGENCE_LIMITS.defaultTimeoutMs, DOM_INTELLIGENCE_LIMITS.maxTimeoutMs));
  }

  private malformed(op: string): DomIntelligenceFailure {
    this.kill(`malformed ${op} result`);
    return { ok: false, code: "MALFORMED", message: `The DOM-intelligence host answered ${op} with an unexpected shape.` };
  }

  private async ensureStarted(): Promise<HelloInfo | DomIntelligenceFailure> {
    if (this.stopped) return { ok: false, code: "DISABLED", message: "The DOM-intelligence provider was shut down." };
    if (this.child && this.hello) return this.hello;
    if (Date.now() < this.circuitOpenUntil) {
      return this.lastFailure ?? { ok: false, code: "UNAVAILABLE", message: "The DOM-intelligence host failed repeatedly and is paused." };
    }
    this.starting ??= this.start().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private async start(): Promise<HelloInfo | DomIntelligenceFailure> {
    let launch: ScraplingHostLaunch | undefined;
    try {
      launch = await this.options.launch();
    } catch {
      launch = undefined;
    }
    if (!launch) return this.remember({ ok: false, code: "UNAVAILABLE", message: "The DOM-intelligence runtime is not installed." });

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(launch.command, launch.args, {
        cwd: launch.cwd,
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        // A deliberately minimal environment: nothing from the app's environment (proxies, PYTHON*,
        // credentials) reaches the host. SystemRoot is required for the Windows CRT to initialize.
        env: {
          SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
          PYTHONIOENCODING: "utf-8",
          PYTHONDONTWRITEBYTECODE: "1",
          PYTHONNOUSERSITE: "1"
        }
      });
    } catch (error) {
      return this.remember({ ok: false, code: "UNAVAILABLE", message: `The DOM-intelligence host could not start (${(error as NodeJS.ErrnoException).code ?? "error"}).` });
    }
    this.child = child;
    this.buffer = "";
    this.stderrTail = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.onStdout(child, chunk));
    child.stderr.on("data", (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-4_096);
    });
    child.on("error", () => this.onExit(child));
    child.on("exit", () => this.onExit(child));
    child.stdin.on("error", () => undefined);

    const response = await this.send(child, "hello", { protocol: DOM_INTELLIGENCE_PROTOCOL_VERSION }, this.options.startTimeoutMs ?? DOM_INTELLIGENCE_LIMITS.startTimeoutMs);
    if (!response.ok) return this.remember(response);
    const hello = SCRAPLING_RESULT_VALIDATORS.hello(response.result);
    if (!hello) {
      this.kill("incompatible hello");
      return this.remember({ ok: false, code: "INCOMPATIBLE", message: "The DOM-intelligence host is not the expected parser-only protocol." });
    }
    if (hello.forbiddenModulesLoaded.length > 0) {
      this.kill("forbidden module loaded");
      return this.remember({ ok: false, code: "INCOMPATIBLE", message: "The DOM-intelligence host loaded a forbidden module." });
    }
    this.hello = hello;
    this.lastFailure = undefined;
    return hello;
  }

  private remember(failure: DomIntelligenceFailure): DomIntelligenceFailure {
    this.lastFailure = failure;
    return failure;
  }

  private async request(op: string, payload: Record<string, unknown>, timeoutMs: number): Promise<{ ok: true; result: unknown } | DomIntelligenceFailure> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const started = await this.ensureStarted();
    if ("ok" in started) return started;
    const child = this.child;
    if (!child) return { ok: false, code: "CRASHED", message: "The DOM-intelligence host exited." };
    const response = await this.send(child, op, payload, timeoutMs);
    this.armIdleStop();
    return response;
  }

  /** Stop a host nobody has used for `idleShutdownMs`; the next request starts a fresh one. */
  private armIdleStop(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      const child = this.child;
      if (!child || this.pending.size > 0) return;
      this.retired.add(child);
      this.child = undefined;
      this.hello = undefined;
      try {
        child.stdin.end(`${JSON.stringify({ id: this.nextId++, op: "shutdown" })}\n`);
      } catch {
        child.kill();
      }
    }, this.options.idleShutdownMs ?? 10 * 60_000);
    this.idleTimer.unref?.();
  }

  private send(child: ChildProcessWithoutNullStreams, op: string, payload: Record<string, unknown>, timeoutMs: number): Promise<{ ok: true; result: unknown } | DomIntelligenceFailure> {
    const id = this.nextId++;
    const line = `${JSON.stringify({ id, op, ...payload })}\n`;
    if (Buffer.byteLength(line) > DOM_INTELLIGENCE_LIMITS.maxRequestBytes) {
      return Promise.resolve({ ok: false, code: "OVERSIZED", message: "The request exceeds the protocol bound." });
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // A wedged parse must not queue later work behind it: the host is replaced on the next call.
        this.kill(`${op} timed out`);
        resolve({ ok: false, code: "TIMEOUT", message: `The DOM-intelligence host did not answer ${op} within ${timeoutMs} ms.` });
      }, timeoutMs);
      this.pending.set(id, { op, child, resolve, timer });
      try {
        child.stdin.write(line);
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve({ ok: false, code: "CRASHED", message: "The DOM-intelligence host is not accepting requests." });
      }
    });
  }

  private onStdout(child: ChildProcessWithoutNullStreams, chunk: string): void {
    if (child !== this.child) return;
    this.buffer += chunk;
    if (this.buffer.length > DOM_INTELLIGENCE_LIMITS.maxResponseBytes && !this.buffer.includes("\n")) {
      this.failAll(child, "OVERSIZED", "The DOM-intelligence host sent a response larger than the protocol bound.");
      this.kill("oversized response");
      return;
    }
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (Buffer.byteLength(line) > DOM_INTELLIGENCE_LIMITS.maxResponseBytes) {
        this.failAll(child, "OVERSIZED", "The DOM-intelligence host sent a response larger than the protocol bound.");
        this.kill("oversized response");
        return;
      }
      if (!this.onLine(line)) {
        this.failAll(child, "MALFORMED", "The DOM-intelligence host sent a malformed response.");
        this.kill("malformed response");
        return;
      }
    }
  }

  /** One response line; false when it cannot be a valid answer to a pending request. */
  private onLine(line: string): boolean {
    let message: { id?: unknown; ok?: unknown; result?: unknown; error?: { code?: unknown; message?: unknown } };
    try {
      message = JSON.parse(line);
    } catch {
      return false;
    }
    if (!message || typeof message !== "object" || !Number.isInteger(message.id) || typeof message.ok !== "boolean") return false;
    const pending = this.pending.get(message.id as number);
    if (!pending) return false;
    this.pending.delete(message.id as number);
    clearTimeout(pending.timer);
    if (message.ok) {
      pending.resolve({ ok: true, result: message.result });
      return true;
    }
    const code = message.error?.code === "PROTECTED_SURFACE" ? "PROTECTED_SURFACE" : "REJECTED";
    const text = typeof message.error?.message === "string" ? message.error.message.slice(0, 200) : "The request was rejected.";
    pending.resolve({ ok: false, code, message: text });
    return true;
  }

  private failAll(child: ChildProcessWithoutNullStreams, code: DomIntelligenceFailureCode, message: string): void {
    for (const [id, pending] of this.pending) {
      if (pending.child !== child) continue;
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, code, message });
      this.pending.delete(id);
    }
  }

  private kill(_reason: string): void {
    const child = this.child;
    this.child = undefined;
    this.hello = undefined;
    if (child && child.exitCode === null) child.kill();
  }

  private readonly exited = new WeakSet<ChildProcessWithoutNullStreams>();

  private onExit(child: ChildProcessWithoutNullStreams): void {
    // `error` and `exit` can both fire for one child; count it once.
    if (this.exited.has(child)) return;
    this.exited.add(child);
    if (child === this.child) {
      this.child = undefined;
      this.hello = undefined;
    }
    this.failAll(child, "CRASHED", "The DOM-intelligence host exited.");
    if (this.stopped || this.retired.has(child)) return;
    const now = Date.now();
    const window = this.options.crashWindowMs ?? 60_000;
    this.crashes = [...this.crashes.filter((at) => now - at < window), now];
    if (this.crashes.length >= (this.options.maxCrashes ?? 3)) {
      this.circuitOpenUntil = now + window;
      this.lastFailure = { ok: false, code: "CRASHED", message: "The DOM-intelligence host exited repeatedly; it is paused for a minute." };
      this.crashes = [];
    }
  }

  /** Diagnostics for verifiers: the host's last stderr, bounded. Never page content. */
  get lastStderr(): string {
    return this.stderrTail;
  }
}
