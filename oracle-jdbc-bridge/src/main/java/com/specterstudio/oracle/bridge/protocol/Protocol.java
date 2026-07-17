package com.specterstudio.oracle.bridge.protocol;

/**
 * Wire-protocol constants shared by the bridge. The TypeScript side mirrors these in
 * {@code src/oracle/OracleBridgeProtocol.ts} — keep the two in sync.
 */
public final class Protocol {
    private Protocol() {}

    /** Protocol version. Bumped on any breaking envelope/framing change. */
    public static final int VERSION = 1;

    /** Bridge implementation version (independent of protocol version). */
    public static final String BRIDGE_VERSION = "0.1.0";

    /** Max frame size accepted on read AND emitted on write (16 MiB). */
    public static final int MAX_MESSAGE_BYTES = 16 * 1024 * 1024;

    // ── Operations ───────────────────────────────────────────────────────────
    public static final String OP_HELLO = "hello";
    public static final String OP_HEALTH = "health";
    public static final String OP_TEST_CONNECTION = "testConnection";
    public static final String OP_EXECUTE_QUERY = "executeQuery";
    public static final String OP_CANCEL_QUERY = "cancelQuery";
    public static final String OP_CLOSE_POOL = "closePool";
    public static final String OP_SHUTDOWN = "shutdown";

    // ── Error categories (safe, low-cardinality) ─────────────────────────────
    public static final String ERR_AUTHENTICATION_FAILED = "AUTHENTICATION_FAILED";
    public static final String ERR_NETWORK_UNREACHABLE = "NETWORK_UNREACHABLE";
    public static final String ERR_SERVICE_NOT_FOUND = "SERVICE_NOT_FOUND";
    public static final String ERR_TLS_ERROR = "TLS_ERROR";
    public static final String ERR_WALLET_ERROR = "WALLET_ERROR";
    public static final String ERR_TIMEOUT = "TIMEOUT";
    public static final String ERR_DRIVER_ERROR = "DRIVER_ERROR";
    public static final String ERR_DRIVER_UNAVAILABLE = "DRIVER_UNAVAILABLE";
    public static final String ERR_SQL_POLICY_VIOLATION = "SQL_POLICY_VIOLATION";
    public static final String ERR_RESULT_LIMIT_EXCEEDED = "RESULT_LIMIT_EXCEEDED";
    public static final String ERR_INVALID_CONFIGURATION = "INVALID_CONFIGURATION";
    public static final String ERR_MESSAGE_TOO_LARGE = "MESSAGE_TOO_LARGE";
    public static final String ERR_UNSUPPORTED_OPERATION = "UNSUPPORTED_OPERATION";
    public static final String ERR_CANCELLED = "CANCELLED";
    public static final String ERR_UNKNOWN = "UNKNOWN";
}
