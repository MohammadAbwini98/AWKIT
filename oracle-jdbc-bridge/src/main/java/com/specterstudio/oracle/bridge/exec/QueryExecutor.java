package com.specterstudio.oracle.bridge.exec;

import java.util.Map;

/**
 * Abstraction over the JDBC layer so the bridge core (protocol, framing, dispatch, SQL policy)
 * compiles and is fully testable with a plain offline JDK. Two implementations:
 * <ul>
 *   <li>{@code MockQueryExecutor} — no database; deterministic results for contract tests.</li>
 *   <li>{@code OracleUcpQueryExecutor} — real Oracle JDBC Thin + UCP, compiled only when the ojdbc
 *       and ucp jars are vendored (network-blocked environments build the core alone).</li>
 * </ul>
 *
 * <p>All params/results are plain JSON structures ({@link Map}/{@code List}/String/Long/Double/
 * Boolean/null) so no protocol types leak into the JDBC layer. Implementations MUST never place a
 * password, wallet secret, bind value, or returned row into an exception message.
 */
public interface QueryExecutor {

    /** Whether a real JDBC driver is available in this build. Reported in {@code hello}. */
    boolean driverAvailable();

    /**
     * Execution mode for the {@code hello} handshake: {@code "real"} (Oracle JDBC/UCP),
     * {@code "mock"} (database-free), or {@code "unavailable"} (real required but driver absent —
     * every query fails closed). The TypeScript side rejects a non-{@code "real"} mode in packaged
     * production so a build can never silently serve mock rows.
     */
    String executionMode();

    /** Driver version string for diagnostics (or {@code "unavailable"}). */
    String driverVersion();

    /** Oracle UCP version string for diagnostics (or {@code "unavailable"}). */
    String ucpVersion();

    /**
     * Open a connection, validate it, and return safe metadata:
     * {@code { ok, latencyMs, databaseProductVersion?, driverVersion? }}.
     */
    Map<String, Object> testConnection(Map<String, Object> params);

    /**
     * Execute a read-only query. {@code params} carries the connection descriptor, {@code sql},
     * ordered {@code binds}, and limits ({@code timeoutMs}, {@code maxRows}, {@code fetchSize}, …).
     * Returns {@code { rows, columns, rowCount, truncated, executionMs }}.
     */
    Map<String, Object> executeQuery(Map<String, Object> params, CancellationToken token);

    /** Drain and close the pool identified by the compatibility key in {@code params} (best-effort). */
    void closePool(Map<String, Object> params);

    /** Drain all pools and release driver resources on bridge shutdown. */
    void shutdown();
}
