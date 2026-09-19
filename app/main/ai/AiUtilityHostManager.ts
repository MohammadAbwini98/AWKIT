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
    this.live = undefined;
    for (const [, call] of this.pending) {
      clearTimeout(call.timer);
      call.reject(new AiHostCallError("AI_HOST_EXITED", true));
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

  /** A timeout rejects the caller but does not kill the host: slow is not dead. */
  async call<T = unknown>(request: AiHostRequestPayload, timeoutMs: number): Promise<T> {
    const host = await this.ensureStarted();
    const id = `a${++this.sequence}`;
    return new Promise<T>((resolve, reject) => {
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
      }
    });
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
