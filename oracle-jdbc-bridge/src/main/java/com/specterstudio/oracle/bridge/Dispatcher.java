package com.specterstudio.oracle.bridge;

import com.specterstudio.oracle.bridge.exec.CancellationToken;
import com.specterstudio.oracle.bridge.exec.QueryExecutor;
import com.specterstudio.oracle.bridge.json.Json;
import com.specterstudio.oracle.bridge.protocol.BridgeException;
import com.specterstudio.oracle.bridge.protocol.Framing;
import com.specterstudio.oracle.bridge.protocol.Protocol;
import com.specterstudio.oracle.bridge.sql.SqlReadOnlyPolicy;

import java.io.OutputStream;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Routes decoded protocol requests to the {@link QueryExecutor}, tracks in-flight queries for
 * cancellation, and writes framed responses. Long operations run on a bounded worker pool so a
 * {@code cancelQuery} or {@code health} can be processed while a query is still executing.
 */
public final class Dispatcher {
    private final QueryExecutor executor;
    private final OutputStream out;
    private final ExecutorService pool;
    private final ConcurrentHashMap<String, CancellationToken> inFlight = new ConcurrentHashMap<>();
    private volatile Runnable shutdownHook;

    public Dispatcher(QueryExecutor executor, OutputStream out) {
        this.executor = executor;
        this.out = out;
        final AtomicInteger seq = new AtomicInteger();
        this.pool = Executors.newFixedThreadPool(
            Math.max(2, Runtime.getRuntime().availableProcessors()),
            r -> {
                Thread t = new Thread(r, "oracle-bridge-worker-" + seq.incrementAndGet());
                t.setDaemon(true);
                return t;
            });
    }

    public void onShutdown(Runnable hook) {
        this.shutdownHook = hook;
    }

    /** Handle one decoded request. Control ops answer inline; query ops run on the worker pool. */
    public void dispatch(String frame) {
        Map<String, Object> req;
        try {
            req = Json.parseObject(frame);
        } catch (RuntimeException ex) {
            writeError(null, Protocol.ERR_UNKNOWN, "Malformed request frame.", false);
            return;
        }
        final String id = str(req.get("id"));
        final String op = str(req.get("op"));
        final Map<String, Object> params = mapOf(req.get("params"));

        if (op == null) {
            writeError(id, Protocol.ERR_UNSUPPORTED_OPERATION, "Missing operation.", false);
            return;
        }

        switch (op) {
            case Protocol.OP_HELLO:
                writeResult(id, hello());
                return;
            case Protocol.OP_HEALTH:
                writeResult(id, health());
                return;
            case Protocol.OP_DRIVER_PROBE:
                writeResult(id, driverProbe());
                return;
            case Protocol.OP_CANCEL_QUERY: {
                String target = str(params.get("requestId"));
                CancellationToken token = target == null ? null : inFlight.get(target);
                if (token != null) token.cancel();
                Map<String, Object> r = new LinkedHashMap<>();
                r.put("cancelled", token != null);
                writeResult(id, r);
                return;
            }
            case Protocol.OP_SHUTDOWN: {
                Map<String, Object> r = new LinkedHashMap<>();
                r.put("shuttingDown", true);
                writeResult(id, r);
                shutdown();
                return;
            }
            case Protocol.OP_TEST_CONNECTION:
                submit(id, () -> executor.testConnection(params));
                return;
            case Protocol.OP_CLOSE_POOL:
                submit(id, () -> {
                    executor.closePool(params);
                    Map<String, Object> r = new LinkedHashMap<>();
                    r.put("closed", true);
                    return r;
                });
                return;
            case Protocol.OP_EXECUTE_QUERY: {
                if (id == null) {
                    writeError(null, Protocol.ERR_INVALID_CONFIGURATION, "executeQuery requires a request id.", false);
                    return;
                }
                // Authoritative read-only gate — re-validate on the Java side even though the TS
                // layer already checked, so a compromised/racing caller cannot bypass the policy.
                SqlReadOnlyPolicy.Result policy = SqlReadOnlyPolicy.validate(str(params.get("sql")));
                if (!policy.allowed) {
                    writeError(id, Protocol.ERR_SQL_POLICY_VIOLATION, policy.reason, false);
                    return;
                }
                final CancellationToken token = new CancellationToken();
                inFlight.put(id, token);
                pool.execute(() -> {
                    try {
                        writeResult(id, executor.executeQuery(params, token));
                    } catch (BridgeException be) {
                        writeError(id, be.category(), be.getMessage(), be.retriable());
                    } catch (Throwable t) {
                        writeError(id, Protocol.ERR_UNKNOWN, safe(t), false);
                    } finally {
                        inFlight.remove(id);
                    }
                });
                return;
            }
            default:
                writeError(id, Protocol.ERR_UNSUPPORTED_OPERATION, "Unsupported operation '" + op + "'.", false);
        }
    }

    private void submit(String id, ThrowingSupplier body) {
        pool.execute(() -> {
            try {
                writeResult(id, body.get());
            } catch (BridgeException be) {
                writeError(id, be.category(), be.getMessage(), be.retriable());
            } catch (Throwable t) {
                writeError(id, Protocol.ERR_UNKNOWN, safe(t), false);
            }
        });
    }

    private Map<String, Object> hello() {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("protocolVersion", Protocol.VERSION);
        r.put("bridgeVersion", Protocol.BRIDGE_VERSION);
        r.put("executionMode", executor.executionMode());
        r.put("driverAvailable", executor.driverAvailable());
        r.put("driverVersion", executor.driverVersion());
        r.put("javaVersion", System.getProperty("java.version", "unknown"));
        r.put("maxMessageBytes", Protocol.MAX_MESSAGE_BYTES);
        return r;
    }

    private Map<String, Object> health() {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("status", "ok");
        r.put("inFlight", inFlight.size());
        r.put("uptimeMs", java.lang.management.ManagementFactory.getRuntimeMXBean().getUptime());
        return r;
    }

    /**
     * Reflective driver-load probe used to validate an imported driver bundle: attempts to load the
     * Oracle driver class from THIS process's classpath and reports its version. Runs in the core with
     * no executor and no database, so it validates a candidate jar regardless of whether the real
     * query executor was compiled into this bridge build.
     */
    private Map<String, Object> driverProbe() {
        boolean driver = classPresent("oracle.jdbc.OracleDriver");
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("driverAvailable", driver);
        r.put("driverVersion", driver ? nn(versionOf("oracle.jdbc.OracleDriver")) : "unavailable");
        r.put("javaVersion", System.getProperty("java.version", "unknown"));
        return r;
    }

    private static boolean classPresent(String className) {
        try {
            Class.forName(className);
            return true;
        } catch (Throwable notPresent) {
            return false;
        }
    }

    private static String versionOf(String className) {
        try {
            Package pkg = Class.forName(className).getPackage();
            return pkg == null ? null : pkg.getImplementationVersion();
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static String nn(String s) {
        return (s == null || s.isEmpty()) ? "unknown" : s;
    }

    public void shutdown() {
        try {
            inFlight.values().forEach(CancellationToken::cancel);
            executor.shutdown();
        } catch (Throwable ignored) {
            // best-effort
        }
        pool.shutdown();
        try {
            pool.awaitTermination(2, TimeUnit.SECONDS);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
        }
        Runnable hook = shutdownHook;
        if (hook != null) hook.run();
    }

    // ── Response helpers ──────────────────────────────────────────────────────

    private void writeResult(String id, Map<String, Object> result) {
        Map<String, Object> env = new LinkedHashMap<>();
        env.put("v", Protocol.VERSION);
        env.put("id", id);
        env.put("ok", true);
        env.put("result", result);
        send(env);
    }

    private void writeError(String id, String category, String message, boolean retriable) {
        Map<String, Object> error = new LinkedHashMap<>();
        error.put("category", category);
        error.put("message", message);
        error.put("retriable", retriable);
        Map<String, Object> env = new LinkedHashMap<>();
        env.put("v", Protocol.VERSION);
        env.put("id", id);
        env.put("ok", false);
        env.put("error", error);
        send(env);
    }

    private void send(Map<String, Object> env) {
        try {
            Framing.writeFrame(out, Json.write(env));
        } catch (Exception ex) {
            System.err.println("[oracle-bridge] failed to write frame: " + ex.getClass().getSimpleName());
        }
    }

    /** Redact throwable text — never surface a raw driver/connection message across the wire. */
    private static String safe(Throwable t) {
        return "Bridge error (" + t.getClass().getSimpleName() + ").";
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> mapOf(Object v) {
        return (v instanceof Map) ? (Map<String, Object>) v : new LinkedHashMap<>();
    }

    private static String str(Object v) {
        return v == null ? null : String.valueOf(v);
    }

    @FunctionalInterface
    private interface ThrowingSupplier {
        Map<String, Object> get() throws Exception;
    }
}
