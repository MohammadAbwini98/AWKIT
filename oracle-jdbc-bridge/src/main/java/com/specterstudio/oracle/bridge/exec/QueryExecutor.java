package com.specterstudio.oracle.bridge.exec;

import java.util.Map;

/**
 * Abstraction over the JDBC layer so the bridge core (protocol, framing, dispatch, SQL policy)
 * compiles and is fully testable with a plain offline JDK. Two implementations:
 * <ul>
 *   <li>{@code MockQueryExecutor} — no database; deterministic results for contract tests.</li>
 *   <li>{@code OracleJdbcQueryExecutor} — real Oracle JDBC Thin via {@code DriverManager} (one
 *       connection per query, no pooling), compiled only when the ojdbc jar is vendored/selected
 *       (network-blocked environments build the core alone).</li>
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
     * Execution mode for the {@code hello} handshake: {@code "real"} (Oracle JDBC),
     * {@code "mock"} (database-free), or {@code "unavailable"} (real required but driver absent —
     * every query fails closed). The TypeScript side rejects a non-{@code "real"} mode in packaged
     * production so a build can never silently serve mock rows.
     */
    String executionMode();

    /** Driver version string for diagnostics (or {@code "unavailable"}). */
    String driverVersion();

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

    /**
     * Release any resources associated with the key in {@code params}. Connections are opened and
     * closed per query (no pooling), so this is a best-effort no-op retained for protocol
     * compatibility (e.g. validation-harness teardown).
     */
    void closePool(Map<String, Object> params);

    /** Release any driver resources on bridge shutdown. */
    void shutdown();
}
