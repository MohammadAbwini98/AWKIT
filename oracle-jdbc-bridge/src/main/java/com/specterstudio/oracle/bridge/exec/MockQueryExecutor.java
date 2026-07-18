package com.specterstudio.oracle.bridge.exec;

import com.specterstudio.oracle.bridge.protocol.BridgeException;
import com.specterstudio.oracle.bridge.protocol.Protocol;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Database-free executor for contract tests, offline builds, and CI where no Oracle jar/DB exists.
 * It produces deterministic results and can simulate error categories, slow queries, and
 * cancellation via a {@code __simulate} descriptor in the connection params, so the full protocol
 * (execute / cancel / timeout / error mapping) is exercised without a database.
 *
 * <p>{@code driverAvailable()} is {@code false} — the mock is NOT a real driver. Production wiring
 * uses the mock only when explicitly selected (e.g. {@code AWKIT_ORACLE_BRIDGE_MOCK=1}).
 */
public final class MockQueryExecutor implements QueryExecutor {

    @Override
    public boolean driverAvailable() {
        return false;
    }

    @Override
    public String executionMode() {
        return "mock";
    }

    @Override
    public String driverVersion() {
        return "mock-0.1.0";
    }

    @Override
    public Map<String, Object> testConnection(Map<String, Object> params) {
        simulateIfRequested(params, null);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", true);
        result.put("latencyMs", 1L);
        result.put("databaseProductVersion", "Mock Oracle Database (no driver)");
        result.put("driverVersion", driverVersion());
        return result;
    }

    @Override
    public Map<String, Object> executeQuery(Map<String, Object> params, CancellationToken token) {
        long started = System.nanoTime();
        simulateIfRequested(params, token);

        long maxRows = asLong(params.get("maxRows"), 10_000L);
        long requested = asLong(sim(params).get("rows"), 3L);
        long produce = Math.min(requested, Math.max(0, maxRows));
        boolean truncated = requested > maxRows;

        List<Map<String, Object>> columns = new ArrayList<>();
        columns.add(column("ID", "NUMBER"));
        columns.add(column("NAME", "VARCHAR2"));
        columns.add(column("ACTIVE", "NUMBER"));

        List<Map<String, Object>> rows = new ArrayList<>();
        for (long r = 1; r <= produce; r++) {
            if (token != null && token.isCancelled()) {
                throw new BridgeException(Protocol.ERR_CANCELLED, "Query was cancelled.");
            }
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("ID", r);
            row.put("NAME", "row-" + r);
            row.put("ACTIVE", (r % 2 == 0) ? 1L : 0L);
            rows.add(row);
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("rows", rows);
        result.put("columns", columns);
        result.put("rowCount", (long) rows.size());
        result.put("truncated", truncated);
        result.put("executionMs", (System.nanoTime() - started) / 1_000_000L);
        result.put("source", "mock");
        return result;
    }

    @Override
    public void closePool(Map<String, Object> params) {
        // No pools in the mock.
    }

    @Override
    public void shutdown() {
        // Nothing to release.
    }

    // ── Simulation helpers ────────────────────────────────────────────────────

    @SuppressWarnings("unchecked")
    private static Map<String, Object> sim(Map<String, Object> params) {
        Object s = params == null ? null : params.get("__simulate");
        return (s instanceof Map) ? (Map<String, Object>) s : new LinkedHashMap<>();
    }

    private void simulateIfRequested(Map<String, Object> params, CancellationToken token) {
        Map<String, Object> s = sim(params);
        String error = asString(s.get("error"));
        long delayMs = asLong(s.get("delayMs"), 0L);

        if (delayMs > 0) {
            long deadline = System.currentTimeMillis() + delayMs;
            while (System.currentTimeMillis() < deadline) {
                if (token != null && token.isCancelled()) {
                    throw new BridgeException(Protocol.ERR_CANCELLED, "Query was cancelled.");
                }
                try {
                    Thread.sleep(5);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw new BridgeException(Protocol.ERR_CANCELLED, "Query was interrupted.");
                }
            }
        }

        if (error != null && !error.isEmpty()) {
            throw new BridgeException(error, "Simulated " + error + " (mock).");
        }
    }

    private static Map<String, Object> column(String name, String type) {
        Map<String, Object> c = new LinkedHashMap<>();
        c.put("name", name);
        c.put("jdbcType", type);
        return c;
    }

    private static long asLong(Object v, long fallback) {
        if (v instanceof Number) return ((Number) v).longValue();
        if (v instanceof String) {
            try {
                return Long.parseLong((String) v);
            } catch (NumberFormatException ignored) {
                return fallback;
            }
        }
        return fallback;
    }

    private static String asString(Object v) {
        return v == null ? null : String.valueOf(v);
    }
}
