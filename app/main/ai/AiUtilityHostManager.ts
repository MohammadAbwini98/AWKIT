/**
 * Owns the lifetime of the local-AI utility host (Phase L, L1.1).
 *
 * Patterned on `ZvecUtilityHostManager`, for the same reasons: the runtime runs in an Electron
 * `utilityProcess`, a separate crash domain, so a native abort cannot take the application down;
 * requests are correlated and carry deadlines; restarts are bounded by the same pure
 * `ZvecHostRestartPolicy` (with the AI host's window); and every pending call settles on exit. There
 * is no TCP listener: the channel is the utility process's MessagePort.
 *
 * The model root is fixed at fork time (`AWKIT_AI_MODEL_ROOT`), and the host refuses any model path
 * outside it. Raw runtime text never escapes: callers receive stable `AiHostReason` codes, and
 * details go to a log with the model root masked. Optional throughout: nothing here throws into
 * startup, blocks quit, or touches a run.
 */

import { utilityProcess, type UtilityProcess } from "electron";

import {
  AI_HOST_PROTOCOL_VERSION,
  AI_HOST_RESTART_POLICY,
  AI_HOST_TIMEOUTS,
  AiHostCallError,
  isAiHostEvent,
  isAiHostResponse,
  type AiHostReason,
  type AiHostRequestPayload,
  type AiHostTransport
} from "@src/ai/contracts/AiHostProtocol";
import { ZvecHostRestartPolicy } from "@src/semantic/ZvecHostRestartPolicy";

export type AiHostState = "stopped" | "starting" | "ready" | "degraded" | "stopping" | "failedOpen";

export interface AiHostStatus {
  state: AiHostState;
  pid: number | null;
  unexpectedExits: number;
  circuitOpen: boolean;
  lastReason: AiHostReason | null;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class AiUtilityHostManager implements AiHostTransport {
  private live: { child: UtilityProcess; pid: number } | undefined;
  private starting: Promise<{ child: UtilityProcess; pid: number }> | undefined;
  private readonly pending = new Map<string, PendingCall>();
  /** Host job id → call id, until the HOST answers: a caller's timeout does not free the host. */
  private readonly inFlight = new Map<string, string>();
  /** The call id of an inference whose host this manager killed to honour a cancel (awkit-g555). */
  private killedOnCancel: string | undefined;
  /** Cancels waiting for their inference to leave the host; told whether a kill was needed. */
  private readonly freeWaiters = new Map<string, Array<(killed: boolean) => void>>();
  private readonly restartPolicy = new ZvecHostRestartPolicy(() => Date.now(), AI_HOST_RESTART_POLICY);
  private sequence = 0;
  private state: AiHostState = "stopped";
  private lastReason: AiHostReason | null = null;
  private disposed = false;
  private expectingExit = false;

  constructor(
    private readonly options: {
      hostPath: string;
      modelRoot: string;
      log?: (level: "info" | "warn" | "error", message: string) => void;
    }
  ) {}

  status(): AiHostStatus {
    return {
      state: this.state,
      pid: this.live?.pid ?? null,
      unexpectedExits: this.restartPolicy.state().strikes,
      circuitOpen: this.restartPolicy.isCircuitOpen(),
      lastReason: this.lastReason
    };
  }

  isAvailable(): boolean {
    return !this.disposed && !this.restartPolicy.isCircuitOpen() && this.state !== "failedOpen";
  }

  private log(level: "info" | "warn" | "error", message: string): void {
    this.options.log?.(level, message.split(this.options.modelRoot).join("<model-root>"));
  }

  private ensureStarted(): Promise<{ child: UtilityProcess; pid: number }> {
    if (this.disposed) return Promise.reject(new AiHostCallError("AI_DISPOSED"));
    if (this.restartPolicy.isCircuitOpen()) return Promise.reject(new AiHostCallError("AI_CIRCUIT_OPEN"));
    if (this.live) return Promise.resolve(this.live);
    this.starting ??= this.start().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private start(): Promise<{ child: UtilityProcess; pid: number }> {
    this.state = "starting";
    this.expectingExit = false;
    return new Promise((resolve, reject) => {
      let child: UtilityProcess;
      try {
        child = utilityProcess.fork(this.options.hostPath, [], {
          stdio: "pipe",
          // Fixed once at process start: the host confines every model path beneath it.
          env: { ...process.env, AWKIT_AI_MODEL_ROOT: this.options.modelRoot }
        });
      } catch (error) {
        this.state = "degraded";
        this.lastReason = "AI_HOST_UNAVAILABLE";
        this.log("error", `ai host fork failed: ${String((error as Error)?.message ?? error)}`);
        reject(new AiHostCallError("AI_HOST_UNAVAILABLE"));
        return;
      }
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* the exit handler does the bookkeeping */
        }
        reject(new AiHostCallError("AI_HOST_TIMEOUT"));
      }, AI_HOST_TIMEOUTS.spawnAndReadyMs);

      child.on("message", (message: unknown) => {
        if (isAiHostEvent(message)) {
          if (message.type === "ready") {
            clearTimeout(timer);
            this.live = { child, pid: message.pid };
            this.state = "ready";
            resolve(this.live);
          } else {
            this.lastReason = message.reason;
            this.state = "degraded";
          }
          return;
        }
        if (isAiHostResponse(message)) {
          for (const [jobId, callId] of this.inFlight) if (callId === message.id) this.release(jobId, false);
          const call = this.pending.get(message.id);
          if (!call) return;
          this.pending.delete(message.id);
          clearTimeout(call.timer);
          if (message.ok) call.resolve(message.value);
          else {
            this.lastReason = message.reason;
            call.reject(new AiHostCallError(message.reason, message.retryable));
          }
        }
      });

      child.on("exit", (code) => {
        clearTimeout(timer);
        this.onExit(code);
        reject(new AiHostCallError("AI_HOST_EXITED"));
      });
    });
  }

  private onExit(code: number | null): void {
    // `live` is cleared BEFORE any caller hears of the exit, so its next call starts a fresh host
    // instead of reaching the one that is going away.
    this.live = undefined;
    const killed = this.killedOnCancel;
    this.killedOnCancel = undefined;
    for (const [jobId, callId] of [...this.inFlight]) this.release(jobId, callId === killed);
    for (const [id, call] of this.pending) {
      clearTimeout(call.timer);
      call.reject(id === killed ? new AiHostCallError("AI_HOST_KILLED_ON_CANCEL") : new AiHostCallError("AI_HOST_EXITED", true));
    }
    this.pending.clear();
    if (this.expectingExit || this.disposed) {
      this.restartPolicy.recordIntentionalExit();
      this.state = "stopped";
      return;
    }
    this.lastReason = "AI_HOST_EXITED";
    const decision = this.restartPolicy.recordUnexpectedExit();
    this.state = decision.action === "openCircuit" ? "failedOpen" : "degraded";
    this.log("warn", `ai host exited unexpectedly (code ${code}); strike ${decision.strikes}${decision.action === "openCircuit" ? ", circuit open" : ""}`);
  }

  /**
   * A timeout rejects the caller but does not kill the host: slow is not dead. A `cancel` returns only
   * once its inference has left the host, answered or killed (bounded by `timeoutMs` more), and
   * rejects with AI_HOST_KILLED_ON_CANCEL when a kill was needed, so the caller knows the model went.
   */
  async call<T = unknown>(request: AiHostRequestPayload, timeoutMs: number): Promise<T> {
    const host = await this.ensureStarted();
    const id = `a${++this.sequence}`;
    const answer = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AiHostCallError("AI_HOST_TIMEOUT"));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      try {
        host.child.postMessage({ version: AI_HOST_PROTOCOL_VERSION, id, ...request });
      } catch {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new AiHostCallError("AI_HOST_UNAVAILABLE"));
        return;
      }
      if (request.type === "infer") this.inFlight.set(request.jobId, id);
      if (request.type === "cancel") this.killIfStillBusy(host, request.jobId);
    });
    if (request.type !== "cancel") return answer;
    const freed = this.whenFree(request.jobId);
    return answer.then(async (value) => {
      const killed = await Promise.race([freed, new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs).unref?.())]);
      if (killed) throw new AiHostCallError("AI_HOST_KILLED_ON_CANCEL");
      return value;
    });
  }

  private whenFree(jobId: string): Promise<boolean> {
    if (!this.inFlight.has(jobId)) return Promise.resolve(false);
    return new Promise((resolve) => this.freeWaiters.set(jobId, [...(this.freeWaiters.get(jobId) ?? []), resolve]));
  }

  private release(jobId: string, killed: boolean): void {
    this.inFlight.delete(jobId);
    for (const resolve of this.freeWaiters.get(jobId) ?? []) resolve(killed);
    this.freeWaiters.delete(jobId);
  }

  /**
   * awkit-g555: the runtime does not observe an abort during prompt evaluation, so a cancel alone can
   * leave the CPUs busy for minutes. If the host has not answered the cancelled inference within the
   * grace period, kill it. That is an intentional exit, so it records no restart strike, and the next
   * call starts a fresh host. The inference is rejected with AI_HOST_KILLED_ON_CANCEL on exit.
   */
  private killIfStillBusy(host: { child: UtilityProcess; pid: number }, jobId: string): void {
    const timer = setTimeout(() => {
      const callId = this.inFlight.get(jobId);
      if (callId === undefined || this.disposed || this.live !== host) return;
      this.killedOnCancel = callId;
      this.expectingExit = true;
      this.log("info", `ai host killed: a cancelled inference was still running after ${AI_HOST_TIMEOUTS.cancelGraceMs} ms`);
      try {
        host.child.kill();
      } catch {
        /* the exit handler does the bookkeeping */
      }
    }, AI_HOST_TIMEOUTS.cancelGraceMs);
    timer.unref?.();
  }

  /** Staged and bounded: ask, then terminate. Never throws; quit must not wait on the runtime. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const host = this.live;
    if (!host) {
      this.state = "stopped";
      return;
    }
    this.state = "stopping";
    this.expectingExit = true;
    const exited = (budgetMs: number) =>
      new Promise<boolean>((resolve) => {
        host.child.once("exit", () => resolve(true));
        setTimeout(() => resolve(false), budgetMs);
      });
    try {
      host.child.postMessage({ version: AI_HOST_PROTOCOL_VERSION, id: `a${++this.sequence}`, type: "shutdown" });
    } catch {
      /* already gone */
    }
    if (!(await exited(AI_HOST_TIMEOUTS.gracefulShutdownMs))) {
      try {
        host.child.kill();
      } catch {
        /* nothing further is possible */
      }
      await exited(AI_HOST_TIMEOUTS.terminateGraceMs);
    }
    this.live = undefined;
    this.state = "stopped";
  }
}
