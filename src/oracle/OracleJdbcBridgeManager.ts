import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  FrameDecoder,
  ORACLE_BRIDGE_PROTOCOL_VERSION,
  OracleBridgeCallError,
  encodeFrame,
  type OracleBridgeHello,
  type OracleBridgeOp,
  type OracleBridgeResponse
} from "./OracleBridgeProtocol";

/** How to launch the bridge process. Provided by the runtime resolver (prod) or the verifier (dev). */
export interface BridgeLaunchSpec {
  javaPath: string;
  jarPath: string;
  /** Extra JVM args placed before `-jar`/`-cp` (e.g. `-Xmx`, `--enable-native-access`). */
  jvmArgs?: string[];
  /**
   * Optional explicit classpath. When set, the bridge is launched with `-cp <classpath> <mainClass>`
   * (so vendored ojdbc/ucp jars can be added) instead of `-jar <jarPath>`. Include the bridge jar in
   * the classpath yourself.
   */
  classpath?: string;
  /** Main class to launch under `-cp` mode. Defaults to the bridge entry point. */
  mainClass?: string;
  env?: Record<string, string | undefined>;
  cwd?: string;
}

const BRIDGE_MAIN_CLASS = "com.specterstudio.oracle.bridge.Main";

export interface OracleBridgeManagerOptions {
  resolveLaunchSpec: () => BridgeLaunchSpec | Promise<BridgeLaunchSpec>;
  /** Called with each redacted stderr line for diagnostics. */
  onStderr?: (line: string) => void;
  logger?: (level: "info" | "warn" | "error", message: string) => void;
  /** Max automatic restarts within `restartWindowMs` before giving up. Default 3. */
  maxRestarts?: number;
  restartWindowMs?: number;
  /** Handshake (`hello`) timeout. Default 15000. */
  handshakeTimeoutMs?: number;
  /** Default per-request timeout when a call does not specify one. Default 60000. */
  defaultRequestTimeoutMs?: number;
  /**
   * Fail closed: when true (packaged production), a handshake that is not `executionMode: "real"`
   * with an available driver is rejected — the process is killed and startup throws
   * `DRIVER_UNAVAILABLE`, so the app never runs queries against the mock/unavailable executor.
   */
  requireRealDriver?: boolean;
}

interface PendingCall {
  resolve: (result: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
  op: OracleBridgeOp;
}

interface LiveProcess {
  child: ChildProcessWithoutNullStreams;
  decoder: FrameDecoder;
  hello: OracleBridgeHello;
}

/**
 * Owns the single Oracle JDBC bridge child process for the AWKIT runtime: lazy startup, version
 * handshake, request/response correlation with timeouts, cancellation propagation, bounded restart
 * after a crash, and clean shutdown with no orphaned Java process.
 *
 * Framework-agnostic (no Electron). The main process constructs one instance and disposes it on quit.
 */
export class OracleJdbcBridgeManager {
  private readonly opts: Required<Omit<OracleBridgeManagerOptions, "onStderr" | "logger" | "resolveLaunchSpec">> &
    Pick<OracleBridgeManagerOptions, "onStderr" | "logger" | "resolveLaunchSpec">;
  private starting: Promise<LiveProcess> | undefined;
  private live: LiveProcess | undefined;
  private readonly pending = new Map<string, PendingCall>();
  private disposed = false;
  private restartTimestamps: number[] = [];
  private stderrTail = "";

  constructor(options: OracleBridgeManagerOptions) {
    this.opts = {
      resolveLaunchSpec: options.resolveLaunchSpec,
      onStderr: options.onStderr,
      logger: options.logger,
      maxRestarts: options.maxRestarts ?? 3,
      restartWindowMs: options.restartWindowMs ?? 60_000,
      handshakeTimeoutMs: options.handshakeTimeoutMs ?? 15_000,
      defaultRequestTimeoutMs: options.defaultRequestTimeoutMs ?? 60_000,
      requireRealDriver: options.requireRealDriver ?? false
    };
  }

  /** Whether a bridge process is currently running (post-handshake). */
  isRunning(): boolean {
    return !!this.live;
  }

  /** In-flight bridge calls awaiting a response — a teardown invariant (0 when idle). */
  pendingCount(): number {
    return this.pending.size;
  }

  /** The handshake info from the running (or last-started) process, if any. */
  helloInfo(): OracleBridgeHello | undefined {
    return this.live?.hello;
  }

  private log(level: "info" | "warn" | "error", message: string): void {
    this.opts.logger?.(level, `[oracle-bridge] ${message}`);
  }

  /** Ensure the process is started and handshaken. Restarts are bounded. */
  private async ensureStarted(): Promise<LiveProcess> {
    if (this.disposed) throw new OracleBridgeCallError("UNKNOWN", "Oracle bridge manager has been disposed.");
    if (this.live) return this.live;
    if (this.starting) return this.starting;

    this.starting = this.start().then(
      (live) => {
        this.live = live;
        this.starting = undefined;
        return live;
      },
      (err) => {
        this.starting = undefined;
        throw err;
      }
    );
    return this.starting;
  }

  private async start(): Promise<LiveProcess> {
    const spec = await this.opts.resolveLaunchSpec();
    const args = spec.classpath
      ? [...(spec.jvmArgs ?? []), "-cp", spec.classpath, spec.mainClass ?? BRIDGE_MAIN_CLASS]
      : [...(spec.jvmArgs ?? []), "-jar", spec.jarPath];
    this.log("info", `spawning ${spec.javaPath} ${args.join(" ")}`);
    const child = spawn(spec.javaPath, args, {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      stdio: ["pipe", "pipe", "pipe"]
    }) as ChildProcessWithoutNullStreams;

    const decoder = new FrameDecoder();
    const live: Partial<LiveProcess> = { child, decoder };

    child.stdout.on("data", (chunk: Buffer) => this.onStdout(chunk, decoder));
    child.stderr.on("data", (chunk: Buffer) => this.onStderr(chunk));
    child.on("exit", (code, signal) => this.onExit(code, signal));
    child.on("error", (err) => {
      this.log("error", `spawn error: ${err.message}`);
      this.failAllPending(new OracleBridgeCallError("UNKNOWN", `Oracle bridge failed to start: ${err.message}`));
    });

    // Handshake before returning the process as usable.
    const hello = (await this.rawCall(child, decoder, "hello", {}, this.opts.handshakeTimeoutMs)) as unknown as OracleBridgeHello;
    if (hello.protocolVersion !== ORACLE_BRIDGE_PROTOCOL_VERSION) {
      child.kill("SIGKILL");
      throw new OracleBridgeCallError(
        "INVALID_CONFIGURATION",
        `Oracle bridge protocol mismatch (bridge v${hello.protocolVersion}, expected v${ORACLE_BRIDGE_PROTOCOL_VERSION}).`
      );
    }
    // Fail closed in packaged production: refuse a mock / driver-unavailable bridge so live queries
    // never run against synthetic results. `executionMode` may be absent on an older bridge — in that
    // case fall back to the `driverAvailable` flag.
    if (this.opts.requireRealDriver) {
      const isReal = hello.executionMode ? hello.executionMode === "real" : hello.driverAvailable;
      if (!isReal || !hello.driverAvailable) {
        child.kill("SIGKILL");
        throw new OracleBridgeCallError(
          "DRIVER_UNAVAILABLE",
          "The Oracle JDBC driver is unavailable in this build; Oracle live queries are disabled. " +
            "Snapshot Data Sources still work offline."
        );
      }
    }
    live.hello = hello;
    this.log("info", `handshake ok — bridge ${hello.bridgeVersion}, driver ${hello.driverAvailable ? hello.driverVersion : "unavailable"}`);
    return live as LiveProcess;
  }

  private onStdout(chunk: Buffer, decoder: FrameDecoder): void {
    let responses: OracleBridgeResponse[];
    try {
      responses = decoder.push(chunk);
    } catch (err) {
      this.log("error", `frame decode error: ${(err as Error).message}`);
      return;
    }
    for (const res of responses) this.settle(res);
  }

  private onStderr(chunk: Buffer): void {
    this.stderrTail = (this.stderrTail + chunk.toString("utf8")).slice(-4096);
    const text = chunk.toString("utf8");
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) this.opts.onStderr?.(line.trim());
    }
  }

  private onExit(code: number | null, signal: NodeJS.Signals | null): void {
    const wasLive = !!this.live;
    this.live = undefined;
    this.starting = undefined;
    this.failAllPending(
      new OracleBridgeCallError(
        "UNKNOWN",
        `Oracle bridge process exited (code ${code ?? "null"}, signal ${signal ?? "null"}).`,
        true
      )
    );
    if (wasLive && !this.disposed) {
      this.log("warn", `bridge exited unexpectedly (code ${code ?? "null"}, signal ${signal ?? "null"}).`);
    }
  }

  private failAllPending(error: Error): void {
    for (const [, call] of this.pending) {
      if (call.timer) clearTimeout(call.timer);
      call.reject(error);
    }
    this.pending.clear();
  }

  private settle(res: OracleBridgeResponse): void {
    if (res.id == null) {
      // An id-less error (e.g. MESSAGE_TOO_LARGE for an unparseable frame) — log, no pending call.
      if (res.error) this.log("warn", `bridge error (no id): ${res.error.category}`);
      return;
    }
    const call = this.pending.get(res.id);
    if (!call) return;
    this.pending.delete(res.id);
    if (call.timer) clearTimeout(call.timer);
    if (res.ok) {
      call.resolve(res.result ?? {});
    } else {
      const err = res.error;
      call.reject(new OracleBridgeCallError(err?.category ?? "UNKNOWN", err?.message ?? "Unknown bridge error.", err?.retriable ?? false));
    }
  }

  /** Low-level call bound to a specific child (used during handshake before `this.live` is set). */
  private rawCall(
    child: ChildProcessWithoutNullStreams,
    _decoder: FrameDecoder,
    op: OracleBridgeOp,
    params: Record<string, unknown>,
    timeoutMs: number
  ): Promise<Record<string, unknown>> {
    const id = randomUUID();
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new OracleBridgeCallError("TIMEOUT", `Bridge '${op}' timed out after ${timeoutMs} ms.`));
        }
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, op });
      try {
        child.stdin.write(encodeFrame({ v: ORACLE_BRIDGE_PROTOCOL_VERSION, id, op, params }));
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new OracleBridgeCallError("UNKNOWN", `Failed to write to bridge: ${(err as Error).message}`));
      }
    });
  }

  /** Send a request and await the correlated response. Starts the bridge lazily. */
  async call(
    op: OracleBridgeOp,
    params: Record<string, unknown> = {},
    options: { timeoutMs?: number; signal?: AbortSignal } = {}
  ): Promise<Record<string, unknown>> {
    const live = await this.ensureStarted();
    const timeoutMs = options.timeoutMs ?? this.opts.defaultRequestTimeoutMs;
    const id = randomUUID();

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new OracleBridgeCallError("CANCELLED", "Operation was cancelled before it started."));
        return;
      }

      const cleanupAbort = () => options.signal?.removeEventListener("abort", onAbort);
      const onAbort = () => {
        // Propagate cancellation to the bridge, then reject locally. A late result is ignored.
        if (this.pending.delete(id)) {
          if (timer) clearTimeout(timer);
          cleanupAbort();
          this.call("cancelQuery", { requestId: id }, { timeoutMs: 5_000 }).catch(() => undefined);
          reject(new OracleBridgeCallError("CANCELLED", "Operation was cancelled."));
        }
      };

      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          cleanupAbort();
          // Best-effort cancel of the server-side work on timeout.
          if (op === "executeQuery") this.call("cancelQuery", { requestId: id }, { timeoutMs: 5_000 }).catch(() => undefined);
          reject(new OracleBridgeCallError("TIMEOUT", `Bridge '${op}' timed out after ${timeoutMs} ms.`));
        }
      }, timeoutMs);

      this.pending.set(id, {
        op,
        timer,
        resolve: (r) => {
          cleanupAbort();
          resolve(r);
        },
        reject: (e) => {
          cleanupAbort();
          reject(e);
        }
      });

      options.signal?.addEventListener("abort", onAbort, { once: true });

      try {
        live.child.stdin.write(encodeFrame({ v: ORACLE_BRIDGE_PROTOCOL_VERSION, id, op, params }));
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        cleanupAbort();
        reject(new OracleBridgeCallError("UNKNOWN", `Failed to write to bridge: ${(err as Error).message}`));
      }
    });
  }

  async hello(): Promise<OracleBridgeHello> {
    await this.ensureStarted();
    return this.live!.hello;
  }

  async health(): Promise<Record<string, unknown>> {
    return this.call("health", {}, { timeoutMs: 5_000 });
  }

  /** Restart guard: too many restarts in the window → refuse to keep flapping. */
  private canRestart(): boolean {
    const now = Date.now();
    this.restartTimestamps = this.restartTimestamps.filter((t) => now - t < this.opts.restartWindowMs);
    if (this.restartTimestamps.length >= this.opts.maxRestarts) return false;
    this.restartTimestamps.push(now);
    return true;
  }

  /** Ensure a running bridge, restarting once if it recently crashed (bounded). */
  async ensureHealthy(): Promise<void> {
    if (this.live) return;
    if (!this.canRestart()) {
      throw new OracleBridgeCallError(
        "UNKNOWN",
        `Oracle bridge restarted too many times; last diagnostics: ${this.stderrTail.slice(-200)}`
      );
    }
    await this.ensureStarted();
  }

  /** Graceful shutdown + guaranteed process termination (no orphan Java). */
  async dispose(): Promise<void> {
    this.disposed = true;
    const child = this.live?.child;
    this.live = undefined;
    this.starting = undefined;
    if (!child) return;
    try {
      await this.rawCall(child, new FrameDecoder(), "shutdown", {}, 2_000).catch(() => undefined);
    } finally {
      const killed = child.killed || child.exitCode != null;
      if (!killed) {
        child.kill("SIGTERM");
        setTimeout(() => {
          if (child.exitCode == null) child.kill("SIGKILL");
        }, 1_500);
      }
      this.failAllPending(new OracleBridgeCallError("UNKNOWN", "Oracle bridge shut down."));
    }
  }
}
