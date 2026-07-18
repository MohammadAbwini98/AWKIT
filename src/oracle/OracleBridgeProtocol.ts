/**
 * Wire-protocol definitions for the Oracle JDBC bridge. Mirrors the Java constants in
 * `oracle-jdbc-bridge/.../protocol/Protocol.java` — keep the two in sync.
 *
 * Transport: a child process's stdio. Framing: a 4-byte big-endian unsigned length prefix followed
 * by that many UTF-8 bytes of JSON. `stderr` is a redacted diagnostic channel and never carries
 * results. Framework-agnostic (no Electron/React imports).
 */

export const ORACLE_BRIDGE_PROTOCOL_VERSION = 1;

/** Max frame size on read and write (16 MiB) — matches the Java side. */
export const ORACLE_BRIDGE_MAX_MESSAGE_BYTES = 16 * 1024 * 1024;

export type OracleBridgeOp =
  | "hello"
  | "health"
  | "driverProbe"
  | "testConnection"
  | "executeQuery"
  | "cancelQuery"
  | "closePool"
  | "shutdown";

/** Result of the reflective `driverProbe` op — used to validate an imported driver bundle. */
export interface OracleBridgeDriverProbe {
  driverAvailable: boolean;
  driverVersion: string;
  javaVersion: string;
}

/** Safe, low-cardinality error categories. Oracle `ORA-` codes are kept internal to the bridge. */
export type OracleBridgeErrorCategory =
  | "AUTHENTICATION_FAILED"
  | "NETWORK_UNREACHABLE"
  | "SERVICE_NOT_FOUND"
  | "TLS_ERROR"
  | "WALLET_ERROR"
  | "TIMEOUT"
  | "DRIVER_ERROR"
  | "DRIVER_UNAVAILABLE"
  | "ORACLE_RUNTIME_NOT_CONFIGURED"
  | "SQL_POLICY_VIOLATION"
  | "RESULT_LIMIT_EXCEEDED"
  | "INVALID_CONFIGURATION"
  | "MESSAGE_TOO_LARGE"
  | "UNSUPPORTED_OPERATION"
  | "CANCELLED"
  | "UNKNOWN";

export interface OracleBridgeRequest {
  v: number;
  id: string;
  op: OracleBridgeOp;
  params?: Record<string, unknown>;
}

export interface OracleBridgeError {
  category: OracleBridgeErrorCategory;
  message: string;
  retriable: boolean;
}

export interface OracleBridgeResponse {
  v: number;
  id: string | null;
  ok: boolean;
  result?: Record<string, unknown>;
  error?: OracleBridgeError;
}

/** How the bridge is executing: real Oracle JDBC, database-free mock, or fail-closed unavailable. */
export type OracleBridgeExecutionMode = "real" | "mock" | "unavailable";

export interface OracleBridgeHello {
  protocolVersion: number;
  bridgeVersion: string;
  /**
   * Execution mode. Packaged production requires `"real"`; the bridge manager rejects a `"mock"` or
   * `"unavailable"` handshake when a real driver is required, so a build can never serve mock rows.
   * Optional for forward/backward tolerance across a protocol bump.
   */
  executionMode?: OracleBridgeExecutionMode;
  driverAvailable: boolean;
  driverVersion: string;
  /** JRE version reported by the (user-selected) bridge process runtime. */
  javaVersion?: string;
  maxMessageBytes: number;
}

/** An error carrying a bridge category, thrown by the client/service for callers to map. */
export class OracleBridgeCallError extends Error {
  constructor(
    readonly category: OracleBridgeErrorCategory,
    message: string,
    readonly retriable = false
  ) {
    super(message);
    this.name = "OracleBridgeCallError";
  }
}

/** Encode one frame: 4-byte BE length prefix + UTF-8 JSON body. */
export function encodeFrame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  if (body.length > ORACLE_BRIDGE_MAX_MESSAGE_BYTES) {
    throw new OracleBridgeCallError("MESSAGE_TOO_LARGE", "Outbound bridge frame exceeds the maximum message size.");
  }
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

/**
 * Incremental frame decoder. Feed it stdout chunks; it yields complete decoded messages. Rejects
 * frames whose declared length exceeds the protocol maximum (defensive against a corrupt stream).
 */
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): OracleBridgeResponse[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const out: OracleBridgeResponse[] = [];
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0);
      if (length > ORACLE_BRIDGE_MAX_MESSAGE_BYTES) {
        throw new OracleBridgeCallError("MESSAGE_TOO_LARGE", "Inbound bridge frame exceeds the maximum message size.");
      }
      if (this.buffer.length < 4 + length) break;
      const body = this.buffer.subarray(4, 4 + length);
      this.buffer = this.buffer.subarray(4 + length);
      out.push(JSON.parse(body.toString("utf8")) as OracleBridgeResponse);
    }
    return out;
  }
}
