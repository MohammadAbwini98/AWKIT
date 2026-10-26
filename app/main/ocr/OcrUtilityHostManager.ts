/**
 * Owns the lifetime of the optional offline OCR utility host (Phase N, N7.4 / awkit-vra.9.5).
 *
 * Patterned on `AiUtilityHostManager`: the engine runs in an Electron `utilityProcess`, a separate crash domain;
 * requests are correlated; every pending call settles on exit; restarts are bounded by `ZvecHostRestartPolicy`
 * (OCR_HOST_RESTART_POLICY); nothing here throws into a caller, blocks startup or quit, or touches a run.
 *
 * The N7.1a engine recognizes synchronously on the host thread, so a deadline or an abort is enforced by KILLING the
 * host: an intentional exit (no restart strike), after which the next request forks a fresh host. A result that still
 * arrives for an abandoned job is dropped and counted, never delivered. One job runs at a time; at most
 * `queueBound` wait (more are `ocr-busy`). An idle host is shut down; a host whose resident set passed the ceiling is
 * recycled. Missing or altered assets and a CPU without WebAssembly SIMD are permanent for the session.
 *
 * The host is never forked before the first `recognize`, so disabled or unused OCR costs nothing. Callers receive
 * words or a stable reason; recognized text is never logged.
 */

import { utilityProcess, type UtilityProcess } from "electron";

import {
  OCR_HOST_LIMITS,
  OCR_HOST_PROTOCOL_VERSION,
  OCR_HOST_RESTART_POLICY,
  OCR_PERMANENT_REASONS,
  isOcrHostEvent,
  isOcrHostResponse,
  isValidOcrHostImage,
  type OcrHostImage,
  type OcrHostOutcome,
  type OcrHostReason
} from "@src/ocr/OcrHostProtocol";
import { ZvecHostRestartPolicy } from "@src/semantic/ZvecHostRestartPolicy";

export type OcrHostState = "stopped" | "starting" | "ready" | "busy" | "stopping" | "failedOpen" | "disposed";

export interface OcrHostStatus {
  state: OcrHostState;
  pid: number | null;
  unexpectedExits: number;
  circuitOpen: boolean;
  permanentReason: OcrHostReason | null;
  /** Results that arrived for a job already settled (deadline, abort or kill) and were dropped. */
  lateResultsDropped: number;
  /** Hosts stopped because their resident set passed the ceiling. */
  recycles: number;
  /** Resident set the host reported with its last result, in bytes. */
  lastRss: number | null;
  waiting: number;
}

export interface OcrHostManagerOptions {
  hostPath: string;
  assetDir: string;
  /** Expected SHA-256 of each asset file, from the pin; the host refuses any other bytes. */
  expected: Readonly<Record<string, string>>;
  limits?: Partial<typeof OCR_HOST_LIMITS>;
  log?: (level: "info" | "warn" | "error", message: string) => void;
}

interface Job {
  id: string;
  image: OcrHostImage;
  resolve: (outcome: OcrHostOutcome) => void;
  settled: boolean;
  timer?: NodeJS.Timeout;
  signal?: AbortSignal;
  onAbort?: () => void;
  /** The host the job was posted to; only that host's exit can settle it. */
  host?: Host;
}

/**
 * One forked host. A host that is killed or asked to stop leaves `live` at once, so no new job is ever posted to a
 * process that is going away; its own exit is then classified by its own `expectingExit`.
 */
type Host = { child: UtilityProcess; pid: number; expectingExit: boolean };

const failure = (reason: OcrHostReason): OcrHostOutcome => ({ ok: false, reason });

export class OcrUtilityHostManager {
  private readonly limits: typeof OCR_HOST_LIMITS;
  private readonly restartPolicy = new ZvecHostRestartPolicy(() => Date.now(), OCR_HOST_RESTART_POLICY);
  private live: Host | undefined;
  private starting: Promise<Host | null> | undefined;
  private running: Job | undefined;
  private readonly queue: Job[] = [];
  private sequence = 0;
  private state: OcrHostState = "stopped";
  private permanentReason: OcrHostReason | null = null;
  private idleTimer: NodeJS.Timeout | undefined;
  private lateResultsDropped = 0;
  private recycles = 0;
  private lastRss: number | null = null;
  private disposed = false;

  constructor(private readonly options: OcrHostManagerOptions) {
    this.limits = { ...OCR_HOST_LIMITS, ...(options.limits ?? {}) };
  }

  status(): OcrHostStatus {
    return {
      state: this.state,
      pid: this.live?.pid ?? null,
      unexpectedExits: this.restartPolicy.state().strikes,
      circuitOpen: this.restartPolicy.isCircuitOpen(),
      permanentReason: this.permanentReason,
      lateResultsDropped: this.lateResultsDropped,
      recycles: this.recycles,
      lastRss: this.lastRss,
      waiting: this.queue.length
    };
  }

  /** Recognize one preprocessed plane. Never rejects: every outcome is words or a reason. */
  recognize(image: OcrHostImage, options: { deadlineMs?: number; signal?: AbortSignal } = {}): Promise<OcrHostOutcome> {
    return new Promise((resolve) => {
      if (this.disposed) return resolve(failure("ocr-unavailable"));
      if (this.permanentReason) return resolve(failure(this.permanentReason));
      if (this.restartPolicy.isCircuitOpen()) return resolve(failure("ocr-unavailable"));
      if (!isValidOcrHostImage(image)) return resolve(failure("image-invalid"));
      if (options.signal?.aborted) return resolve(failure("cancelled"));
      if (this.queue.length >= this.limits.queueBound) return resolve(failure("ocr-busy"));
      const job: Job = { id: `o${++this.sequence}`, image, resolve, settled: false };
      job.timer = setTimeout(() => this.abandon(job, "budget-exhausted"), options.deadlineMs ?? this.limits.deadlineMs);
      if (options.signal) {
        job.signal = options.signal;
        job.onAbort = () => this.abandon(job, "cancelled");
        options.signal.addEventListener("abort", job.onAbort, { once: true });
      }
      this.queue.push(job);
      this.clearIdle();
      void this.pump();
    });
  }

  private settle(job: Job, outcome: OcrHostOutcome): void {
    if (job.settled) return;
    job.settled = true;
    clearTimeout(job.timer);
    if (job.signal && job.onAbort) job.signal.removeEventListener("abort", job.onAbort);
    job.resolve(outcome);
  }

  /** A deadline or an abort. A waiting job is simply dropped; the running one cannot be interrupted, so its host dies. */
  private abandon(job: Job, reason: OcrHostReason): void {
    if (job.settled) return;
    const waiting = this.queue.indexOf(job);
    if (waiting >= 0) this.queue.splice(waiting, 1);
    this.settle(job, failure(reason));
    if (this.running === job) {
      this.running = undefined;
      this.log("info", `ocr host killed: a ${reason === "cancelled" ? "cancelled" : "timed-out"} recognition was still running`);
      if (job.host) this.kill(job.host);
      if (this.queue.length > 0) void this.pump();
    }
  }

  private async pump(): Promise<void> {
    if (this.running || this.queue.length === 0 || this.disposed) return;
    const host = await this.ensureStarted();
    if (!host) {
      const reason = this.permanentReason ?? "ocr-unavailable";
      for (const job of this.queue.splice(0)) this.settle(job, failure(reason));
      return;
    }
    if (this.running || this.queue.length === 0 || this.live !== host) return;
    const job = this.queue.shift() as Job;
    job.host = host;
    this.running = job;
    this.state = "busy";
    try {
      host.child.postMessage({ version: OCR_HOST_PROTOCOL_VERSION, type: "recognize", id: job.id, width: job.image.width, height: job.image.height, gray: job.image.gray, psm: job.image.psm ?? 6 });
    } catch {
      this.running = undefined;
      this.settle(job, failure("ocr-unavailable"));
      void this.pump();
    }
  }

  private ensureStarted(): Promise<Host | null> {
    if (this.live) return Promise.resolve(this.live);
    if (this.disposed || this.permanentReason || this.restartPolicy.isCircuitOpen()) return Promise.resolve(null);
    this.starting ??= this.start().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private start(): Promise<Host | null> {
    this.state = "starting";
    return new Promise((resolve) => {
      let child: UtilityProcess;
      try {
        child = utilityProcess.fork(this.options.hostPath, [], {
          stdio: "pipe",
          serviceName: "SpecterStudio OCR",
          // Fixed for the host's life: it loads only these files, and only with these bytes.
          env: { ...process.env, AWKIT_OCR_ASSET_DIR: this.options.assetDir, AWKIT_OCR_EXPECTED: JSON.stringify(this.options.expected) }
        });
      } catch {
        this.state = "stopped";
        this.log("error", "ocr host fork failed");
        resolve(null);
        return;
      }
      const host: Host = { child, pid: 0, expectingExit: false };
      let ready = false;
      const timer = setTimeout(() => {
        this.log("warn", "ocr host did not become ready in time");
        try {
          child.kill();
        } catch {
          /* the exit handler does the bookkeeping */
        }
      }, this.limits.spawnAndReadyMs);

      child.on("message", (message: unknown) => {
        if (isOcrHostEvent(message)) {
          if (message.type === "ready") {
            clearTimeout(timer);
            ready = true;
            host.pid = message.pid;
            this.live = host;
            this.state = "ready";
            resolve(host);
          } else if (OCR_PERMANENT_REASONS.includes(message.reason)) {
            clearTimeout(timer);
            this.permanentReason = message.reason;
            host.expectingExit = true;
            this.state = "failedOpen";
            this.log("warn", `ocr unavailable for this session: ${message.reason}`);
            resolve(null);
          }
          return;
        }
        if (!isOcrHostResponse(message)) return;
        this.lastRss = message.rss;
        const job = this.running;
        if (!job || job.id !== message.id || job.host !== host) {
          this.lateResultsDropped += 1;
          return;
        }
        this.running = undefined;
        this.state = "ready";
        this.settle(job, message.ok ? { ok: true, words: message.words, recognizeMs: message.recognizeMs } : failure(message.reason));
        if (message.rss > this.limits.rssCeilingBytes) {
          this.recycles += 1;
          this.log("info", "ocr host recycled: its resident set passed the ceiling");
          void this.stopHost();
          if (this.queue.length > 0) void this.pump();
          return;
        }
        if (this.queue.length > 0) void this.pump();
        else this.scheduleIdle();
      });

      child.on("exit", (code) => {
        clearTimeout(timer);
        this.onExit(host, code);
        if (!ready) resolve(null);
      });
    });
  }

  private onExit(host: Host, code: number | null): void {
    if (this.live === host) this.live = undefined;
    const job = this.running;
    if (job && job.host === host) {
      this.running = undefined;
      this.settle(job, failure("ocr-unavailable"));
    }
    if (this.permanentReason) return;
    if (host.expectingExit || this.disposed) {
      this.restartPolicy.recordIntentionalExit();
      if (!this.live && !this.running) this.state = this.disposed ? "disposed" : "stopped";
    } else {
      const decision = this.restartPolicy.recordUnexpectedExit();
      if (decision.action === "openCircuit") this.state = "failedOpen";
      else if (!this.live && !this.running) this.state = "stopped";
      this.log("warn", `ocr host exited unexpectedly (code ${code}); strike ${decision.strikes}${decision.action === "openCircuit" ? ", circuit open" : ""}`);
    }
    if (this.queue.length > 0) void this.pump();
  }

  private kill(host: Host): void {
    host.expectingExit = true;
    if (this.live === host) this.live = undefined;
    try {
      host.child.kill();
    } catch {
      /* the exit handler does the bookkeeping */
    }
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private scheduleIdle(): void {
    this.clearIdle();
    this.idleTimer = setTimeout(() => {
      if (!this.running && this.queue.length === 0) void this.stopHost();
    }, this.limits.idleShutdownMs);
    this.idleTimer.unref?.();
  }

  /** Ask, then terminate; an intentional exit (no strike). Never throws. */
  private async stopHost(): Promise<void> {
    this.clearIdle();
    await this.starting?.catch(() => undefined);
    const host = this.live;
    if (!host) return;
    this.state = "stopping";
    host.expectingExit = true;
    // Leave `live` now: a request arriving while this host shuts down starts a fresh one.
    this.live = undefined;
    const exited = (budgetMs: number) =>
      new Promise<boolean>((resolve) => {
        host.child.once("exit", () => resolve(true));
        setTimeout(() => resolve(false), budgetMs).unref?.();
      });
    try {
      host.child.postMessage({ version: OCR_HOST_PROTOCOL_VERSION, type: "shutdown", id: `o${++this.sequence}` });
    } catch {
      /* already gone */
    }
    if (!(await exited(this.limits.gracefulShutdownMs))) {
      try {
        host.child.kill();
      } catch {
        /* nothing further is possible */
      }
      await exited(this.limits.terminateGraceMs);
    }
  }

  /** Settle everything as unavailable and stop the host. Never throws; quit must not wait on OCR. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const job of this.queue.splice(0)) this.settle(job, failure("ocr-unavailable"));
    if (this.running) this.settle(this.running, failure("ocr-unavailable"));
    this.running = undefined;
    await this.stopHost();
    this.state = "disposed";
  }

  private log(level: "info" | "warn" | "error", message: string): void {
    this.options.log?.(level, message.split(this.options.assetDir).join("<ocr-assets>"));
  }
}
