/**
 * Owns the lifetime of the Zvec semantic native host.
 *
 * The host runs in an Electron `utilityProcess` — never in the main process. Phase 0D measured both
 * sides of that choice directly: a native abort in main-process placement destroyed the entire
 * application, while the same abort in a utility process was detected in 84.62 ms with the app
 * surviving and still serving IPC. Utility placement also kept ~60 MB of native working set out of
 * the main process (+1.77 MB vs +60.6 MB).
 *
 * Structure follows `src/oracle/OracleJdbcBridgeManager.ts`, which solves the same problem for the
 * Oracle JDBC bridge: correlated request/response with deadlines, bounded restarts inside a window,
 * and every pending call settled on exit rather than left hanging.
 *
 * The semantic subsystem is OPTIONAL. Nothing here may throw into application startup, block quit,
 * or fail a workflow run: an unavailable host degrades semantic features and nothing else.
 */

import { utilityProcess, type UtilityProcess } from "electron";
import { performance } from "node:perf_hooks";

import {
  ZVEC_HOST_PROTOCOL_VERSION,
  ZVEC_HOST_RESTART_POLICY,
  ZVEC_HOST_TIMEOUTS,
  isRetryableAfterHostExit,
  isZvecHostEvent,
  isZvecHostResponse,
  type ZvecHostHello,
  type ZvecHostReasonCode,
  type ZvecHostRequestPayload,
  type ZvecHostRequestType
} from "@src/semantic/contracts/ZvecHostProtocol";
import { ZvecHostRestartPolicy } from "@src/semantic/ZvecHostRestartPolicy";

/** Lifecycle states (plan §6.1). `failedOpen` is terminal for the session. */
export type ZvecHostState =
  | "disabled"
  | "stopped"
  | "starting"
  | "ready"
  | "degraded"
  | "stopping"
  | "failedOpen";

export interface ZvecHostStatus {
  state: ZvecHostState;
  pid: number | null;
  /** Unexpected exits observed inside the current restart window. */
  unexpectedExits: number;
  circuitOpen: boolean;
  lastReason: ZvecHostReasonCode | null;
  hello: ZvecHostHello | null;
  pendingRequests: number;
  startedAt: string | null;
}

export interface ZvecUtilityHostManagerOptions {
  /** Absolute path to the packaged raw host (`resources/native-hosts/zvec/zvec-host.cjs`). */
  hostPath: string;
  /** Runtime root that bounds every collection path; forwarded for diagnostics only. */
  runtimeRoot: string;
  /** Extra env for the forked child. Used by tests to enable the gated abort hook. */
  env?: NodeJS.ProcessEnv;
  logger?: (level: "info" | "warn" | "error", message: string) => void;
  /** Injected for testing so the verifier can drive the policy without spawning Electron. */
  now?: () => number;
}

/** Error carrying a stable, path-free reason code. Raw native text never reaches a caller. */
export class ZvecHostCallError extends Error {
  constructor(
    readonly reason: ZvecHostReasonCode,
    message?: string,
    readonly retryable = false
  ) {
    super(message ?? reason);
    this.name = "ZvecHostCallError";
  }
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  type: ZvecHostRequestType;
  timer: NodeJS.Timeout;
}

interface LiveHost {
  child: UtilityProcess;
  pid: number;
}

export class ZvecUtilityHostManager {
  private readonly opts: Required<Omit<ZvecUtilityHostManagerOptions, "env" | "logger" | "now">> &
    Pick<ZvecUtilityHostManagerOptions, "env" | "logger" | "now">;

  private live: LiveHost | undefined;
  private starting: Promise<LiveHost> | undefined;
  private readonly pending = new Map<string, PendingCall>();
  private sequence = 0;

  private state: ZvecHostState = "stopped";
  /** All restart/circuit decisions live in this pure, separately verified policy object. */
  private readonly restartPolicy: ZvecHostRestartPolicy;
  private lastReason: ZvecHostReasonCode | null = null;
  private hello: ZvecHostHello | null = null;
  private startedAt: string | null = null;
  /** Generation currently open, so an unexpected exit can name it for quarantine. */
  private openGeneration: string | undefined;
  private disposed = false;
  /** Set while an intentional shutdown is in flight, so its exit is not counted as a crash. */
  private expectingExit = false;

  constructor(options: ZvecUtilityHostManagerOptions) {
    this.opts = { hostPath: options.hostPath, runtimeRoot: options.runtimeRoot, env: options.env, logger: options.logger, now: options.now };
    this.restartPolicy = new ZvecHostRestartPolicy(options.now ?? (() => Date.now()));
  }

  private log(level: "info" | "warn" | "error", message: string): void {
    this.opts.logger?.(level, message);
  }

  status(): ZvecHostStatus {
    return {
      state: this.state,
      pid: this.live?.pid ?? null,
      unexpectedExits: this.restartPolicy.state().strikes,
      circuitOpen: this.restartPolicy.isCircuitOpen(),
      lastReason: this.lastReason,
      hello: this.hello,
      pendingRequests: this.pending.size,
      startedAt: this.startedAt
    };
  }

  isAvailable(): boolean {
    return !this.disposed && !this.restartPolicy.isCircuitOpen() && this.state !== "failedOpen";
  }

  // ─────────────────────────────── lifecycle ───────────────────────────────

  /**
   * Lazily start the host. Startup is never eager: plan §16.1 requires normal AWKIT startup to be
   * independent of Zvec, so the first approved semantic operation is what brings it up.
   */
  private async ensureStarted(): Promise<LiveHost> {
    if (this.disposed) throw new ZvecHostCallError("SEMANTIC_DISPOSED");
    if (this.restartPolicy.isCircuitOpen()) throw new ZvecHostCallError("SEMANTIC_CIRCUIT_OPEN");
    if (this.live) return this.live;
    if (this.starting) return this.starting;

    this.starting = this.start().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private start(): Promise<LiveHost> {
    this.state = "starting";
    this.expectingExit = false;

    return new Promise<LiveHost>((resolve, reject) => {
      let child: UtilityProcess;
      try {
        child = utilityProcess.fork(this.opts.hostPath, [], {
          stdio: "pipe",
          // The host fixes its approved root from this at process start and then confines every
          // request beneath it. Passing the root here (rather than per request) is what keeps a
          // single validation gap from being able to redirect the host, and is also what lets the
          // user's configured runtime data location be honoured instead of a hard-coded path.
          env: { ...(this.opts.env ?? process.env), AWKIT_SEMANTIC_RUNTIME_ROOT: this.opts.runtimeRoot }
        });
      } catch (error) {
        this.state = "degraded";
        this.lastReason = "SEMANTIC_HOST_UNAVAILABLE";
        reject(new ZvecHostCallError("SEMANTIC_HOST_UNAVAILABLE", String((error as Error)?.message ?? error)));
        return;
      }

      const timer = setTimeout(() => {
        this.log("warn", `Zvec host did not signal ready within ${ZVEC_HOST_TIMEOUTS.spawnAndReadyMs} ms.`);
        try {
          child.kill();
        } catch {
          /* the exit handler performs the bookkeeping */
        }
        reject(new ZvecHostCallError("SEMANTIC_HOST_TIMEOUT", "Host did not become ready in time."));
      }, ZVEC_HOST_TIMEOUTS.spawnAndReadyMs);

      child.on("message", (message: unknown) => {
        if (isZvecHostEvent(message)) {
          if (message.type === "ready") {
            clearTimeout(timer);
            const liveHost: LiveHost = { child, pid: message.pid };
            this.live = liveHost;
            this.state = "ready";
            this.startedAt = new Date().toISOString();
            this.log("info", `Zvec host ready (pid ${message.pid}).`);
            resolve(liveHost);
            return;
          }
          // A fatal event means the host has given up on itself.
          this.lastReason = message.reason;
          this.state = "degraded";
          this.log("error", `Zvec host reported fatal: ${message.reason}`);
          return;
        }

        if (isZvecHostResponse(message)) this.settle(message);
      });

      child.on("exit", (code) => {
        clearTimeout(timer);
        this.onExit(code);
        // If the process died before `ready`, the start promise is still outstanding.
        reject(new ZvecHostCallError("SEMANTIC_HOST_EXITED", `Host exited during startup (code ${code}).`));
      });
    });
  }

  /**
   * Bounded restart policy (plan §6.3). The window is a sliding count of *unexpected* exits: an
   * intentional shutdown never counts. Exceeding it opens the circuit for the remainder of the
   * session, because a host that keeps dying will keep dying, and a restart loop is worse than a
   * disabled optional feature.
   */
  private onExit(code: number | null): void {
    const wasLive = Boolean(this.live);
    this.live = undefined;
    this.hello = null;

    const intentional = this.expectingExit;
    this.expectingExit = false;

    // Settle every in-flight request with a stable reason rather than leaving callers hanging.
    this.failAllPending();

    if (intentional || this.disposed) {
      this.restartPolicy.recordIntentionalExit();
      this.state = "stopped";
      this.log("info", `Zvec host exited as requested (code ${code}).`);
      return;
    }

    this.lastReason = "SEMANTIC_HOST_EXITED";
    const decision = this.restartPolicy.recordUnexpectedExit({ generation: this.openGeneration });

    if (decision.action === "openCircuit") {
      this.state = "failedOpen";
      this.log(
        "error",
        `Zvec host exited ${decision.strikes} times within ${ZVEC_HOST_RESTART_POLICY.windowMs} ms (${decision.reason}) — opening the circuit for this session.`
      );
      return;
    }

    this.state = "degraded";
    if (wasLive) {
      this.log(
        "warn",
        `Zvec host exited unexpectedly (code ${code}); strike ${decision.strikes}, restarting on the next operation${
          decision.action === "restart" && decision.delayMs > 0 ? ` after ${decision.delayMs} ms` : ""
        }.`
      );
    }
  }

  private failAllPending(): void {
    for (const [, call] of this.pending) {
      clearTimeout(call.timer);
      call.reject(new ZvecHostCallError("SEMANTIC_HOST_EXITED", "Host exited before the request completed.", isRetryableAfterHostExit(call.type)));
    }
    this.pending.clear();
  }

  private settle(response: ReturnType<typeof JSON.parse> & { id: string; ok: boolean }): void {
    const call = this.pending.get(response.id);
    if (!call) return;
    this.pending.delete(response.id);
    clearTimeout(call.timer);

    if (response.ok) {
      call.resolve((response as { value?: unknown }).value);
      return;
    }
    const failure = response as { reason: ZvecHostReasonCode; retryable?: boolean };
    this.lastReason = failure.reason;
    call.reject(new ZvecHostCallError(failure.reason, undefined, Boolean(failure.retryable)));
  }

  // ─────────────────────────────── requests ───────────────────────────────

  /**
   * Send one request. A timeout rejects the caller but deliberately does NOT kill the host: a slow
   * operation is a different failure from a dead process, and killing on latency would turn a
   * recoverable stall into a restart-policy strike (plan §5.3).
   */
  async call<T = unknown>(request: ZvecHostRequestPayload, timeoutMs: number): Promise<T> {
    if (this.disposed) throw new ZvecHostCallError("SEMANTIC_DISPOSED");
    if (this.restartPolicy.isCircuitOpen()) throw new ZvecHostCallError("SEMANTIC_CIRCUIT_OPEN");

    const host = await this.ensureStarted();
    const id = `z${++this.sequence}`;

    // Remember which generation is open so an unexpected exit can name it for quarantine: a crash
    // while a specific generation is loaded is the signature of corrupt data, not a flaky process.
    if (request.type === "open") this.openGeneration = request.generation;
    else if (request.type === "close") this.openGeneration = undefined;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ZvecHostCallError("SEMANTIC_HOST_TIMEOUT", `Request '${request.type}' timed out after ${timeoutMs} ms.`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        type: request.type,
        timer
      });

      try {
        host.child.postMessage({ version: ZVEC_HOST_PROTOCOL_VERSION, id, ...request });
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new ZvecHostCallError("SEMANTIC_HOST_UNAVAILABLE", String((error as Error)?.message ?? error)));
      }
    });
  }

  /**
   * Handshake and compatibility gate. A mismatch is not a crash — it disables semantic features and
   * leaves AWKIT fully functional (plan §6.2).
   */
  async handshake(): Promise<ZvecHostHello> {
    const hello = await this.call<ZvecHostHello>(
      { type: "hello", expected: { protocolVersion: ZVEC_HOST_PROTOCOL_VERSION, platform: process.platform, arch: process.arch } },
      ZVEC_HOST_TIMEOUTS.helloMs
    );

    if (!hello?.compatible || hello.protocolVersion !== ZVEC_HOST_PROTOCOL_VERSION) {
      this.lastReason = "SEMANTIC_NATIVE_INCOMPATIBLE";
      this.state = "degraded";
      throw new ZvecHostCallError("SEMANTIC_NATIVE_INCOMPATIBLE");
    }
    if (!hello.jiebaDictDir) {
      // Dictionaries must resolve beside the binding; a partial load is not silently accepted.
      this.lastReason = "SEMANTIC_NATIVE_INCOMPATIBLE";
      this.state = "degraded";
      throw new ZvecHostCallError("SEMANTIC_NATIVE_INCOMPATIBLE", "Jieba dictionaries did not resolve beside the binding.");
    }

    this.hello = hello;
    return hello;
  }

  /** Operator action that clears the circuit after the underlying cause has been addressed. */
  resetCircuit(): void {
    if (this.disposed) return;
    this.restartPolicy.reset();
    this.state = "stopped";
    this.lastReason = null;
    this.log("info", "Zvec host circuit reset; the host will start on the next operation.");
  }

  // ─────────────────────────────── shutdown ───────────────────────────────

  /**
   * Staged shutdown (plan §12): ask politely, then terminate. Bounded and non-throwing, because
   * semantic cleanup must never prevent the application from quitting.
   *
   * Returns the elapsed milliseconds so the caller can record whether shutdown was graceful.
   */
  async dispose(): Promise<{ graceful: boolean; elapsedMs: number }> {
    if (this.disposed) return { graceful: true, elapsedMs: 0 };
    this.disposed = true;
    const started = performance.now();

    const host = this.live;
    if (!host) {
      this.state = "stopped";
      return { graceful: true, elapsedMs: 0 };
    }

    this.state = "stopping";
    this.expectingExit = true;

    const exited = new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (value: boolean): void => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      host.child.once("exit", () => done(true));
      setTimeout(() => done(false), ZVEC_HOST_TIMEOUTS.gracefulShutdownMs);
    });

    try {
      host.child.postMessage({ version: ZVEC_HOST_PROTOCOL_VERSION, id: `z${++this.sequence}`, type: "shutdown" });
    } catch {
      /* the process is already gone or unreachable; fall through to the kill below */
    }

    let graceful = await exited;

    if (!graceful) {
      this.log("warn", "Zvec host did not exit gracefully; terminating.");
      try {
        host.child.kill();
      } catch {
        /* nothing further is possible, and quit must not be blocked */
      }
      graceful = await new Promise<boolean>((resolve) => {
        let settled = false;
        const done = (value: boolean): void => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        host.child.once("exit", () => done(false));
        setTimeout(() => done(false), ZVEC_HOST_TIMEOUTS.terminateGraceMs);
      });
    }

    this.failAllPending();
    this.live = undefined;
    this.state = "stopped";
    return { graceful, elapsedMs: performance.now() - started };
  }
}
