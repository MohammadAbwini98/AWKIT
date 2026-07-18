package com.specterstudio.oracle.bridge.exec;

import com.specterstudio.oracle.bridge.protocol.BridgeException;
import com.specterstudio.oracle.bridge.protocol.Protocol;

import java.util.Map;

/**
 * Fail-closed executor selected when a real Oracle driver is REQUIRED (packaged production, via
 * {@code AWKIT_ORACLE_REQUIRE_REAL=1}) but the {@code OracleJdbcQueryExecutor} class and/or the
 * ojdbc jar are not present. It keeps the protocol alive so {@code hello}/{@code health} answer
 * cleanly and the TypeScript manager can detect the condition and report a precise
 * {@code DRIVER_UNAVAILABLE} error — but it NEVER returns query rows.
 *
 * <p>This is the guardrail that makes "packaged production + missing/failed driver" resolve to
 * "Oracle feature unavailable", never to synthetic/mock results. It is deliberately distinct from
 * {@link MockQueryExecutor}, which is a real (database-free) result generator for dev/tests.
 */
public final class DriverUnavailableExecutor implements QueryExecutor {

    @Override
    public boolean driverAvailable() {
        return false;
    }

    @Override
    public String executionMode() {
        return "unavailable";
    }

    @Override
    public String driverVersion() {
        return "unavailable";
    }

    @Override
    public Map<String, Object> testConnection(Map<String, Object> params) {
        throw new BridgeException(
            Protocol.ERR_DRIVER_UNAVAILABLE,
            "The Oracle JDBC driver is not available in this build; Oracle live queries are disabled.");
    }

    @Override
    public Map<String, Object> executeQuery(Map<String, Object> params, CancellationToken token) {
        throw new BridgeException(
            Protocol.ERR_DRIVER_UNAVAILABLE,
            "The Oracle JDBC driver is not available in this build; Oracle live queries are disabled.");
    }

    @Override
    public void closePool(Map<String, Object> params) {
        // No pools.
    }

    @Override
    public void shutdown() {
        // Nothing to release.
    }
}
