package com.specterstudio.oracle.bridge;

import com.specterstudio.oracle.bridge.exec.DriverUnavailableExecutor;
import com.specterstudio.oracle.bridge.exec.MockQueryExecutor;
import com.specterstudio.oracle.bridge.exec.QueryExecutor;
import com.specterstudio.oracle.bridge.json.Json;
import com.specterstudio.oracle.bridge.protocol.Framing;
import com.specterstudio.oracle.bridge.protocol.Protocol;

import java.io.BufferedOutputStream;
import java.io.DataInputStream;
import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.io.PrintStream;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Bridge entry point. Owns the framed stdin/stdout JSON-RPC loop.
 *
 * <p>stdout is reserved exclusively for framed protocol bytes; {@link System#out} is redirected to
 * {@link System#err} so any stray library print cannot corrupt the stream. stderr is a redacted
 * diagnostic channel and never carries results.
 *
 * <p>The executor is chosen at startup: the real Oracle UCP executor is loaded reflectively when its
 * class (and the ojdbc/ucp jars) are present; otherwise — or when {@code AWKIT_ORACLE_BRIDGE_MOCK=1}
 * — the database-free {@link MockQueryExecutor} is used so the protocol still runs offline.
 *
 * <p><b>Fail-closed in production.</b> When {@code AWKIT_ORACLE_REQUIRE_REAL=1} (set by the packaged
 * app), the bridge MUST NOT fall back to the mock: an explicit {@code AWKIT_ORACLE_BRIDGE_MOCK} flag
 * is ignored, and if the real executor cannot be loaded the {@link DriverUnavailableExecutor} is used
 * so every query fails with {@code DRIVER_UNAVAILABLE} instead of returning synthetic rows.
 */
public final class Main {

    private static final String ORACLE_EXECUTOR_CLASS =
        "com.specterstudio.oracle.bridge.exec.OracleUcpQueryExecutor";

    public static void main(String[] args) {
        // Capture the true stdout for framing BEFORE redirecting System.out.
        OutputStream rawStdout = new BufferedOutputStream(new FileOutputStream(FileDescriptor.out));
        System.setOut(new PrintStream(new FileOutputStream(FileDescriptor.err), true));

        QueryExecutor executor = selectExecutor();
        Dispatcher dispatcher = new Dispatcher(executor, rawStdout);

        final Object done = new Object();
        final boolean[] finished = {false};
        dispatcher.onShutdown(() -> {
            synchronized (done) {
                finished[0] = true;
                done.notifyAll();
            }
        });

        DataInputStream in = new DataInputStream(new java.io.BufferedInputStream(System.in));
        Thread reader = new Thread(() -> readLoop(in, dispatcher, rawStdout), "oracle-bridge-reader");
        reader.setDaemon(true);
        reader.start();

        synchronized (done) {
            while (!finished[0] && reader.isAlive()) {
                try {
                    done.wait(250);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }
        // Reader ended (EOF) without an explicit shutdown → drain cleanly.
        if (!finished[0]) {
            dispatcher.shutdown();
        }
        System.exit(0);
    }

    private static void readLoop(DataInputStream in, Dispatcher dispatcher, OutputStream rawStdout) {
        while (true) {
            String frame;
            try {
                frame = Framing.readFrame(in);
            } catch (Framing.OversizeFrameException oversize) {
                writeOversizeError(rawStdout);
                continue;
            } catch (Exception ex) {
                System.err.println("[oracle-bridge] read error: " + ex.getClass().getSimpleName());
                break;
            }
            if (frame == null) {
                break; // clean EOF: parent closed stdin
            }
            try {
                dispatcher.dispatch(frame);
            } catch (Throwable t) {
                System.err.println("[oracle-bridge] dispatch error: " + t.getClass().getSimpleName());
            }
        }
    }

    private static void writeOversizeError(OutputStream out) {
        Map<String, Object> error = new LinkedHashMap<>();
        error.put("category", Protocol.ERR_MESSAGE_TOO_LARGE);
        error.put("message", "Request frame exceeds the maximum message size.");
        error.put("retriable", false);
        Map<String, Object> env = new LinkedHashMap<>();
        env.put("v", Protocol.VERSION);
        env.put("id", null);
        env.put("ok", false);
        env.put("error", error);
        try {
            Framing.writeFrame(out, Json.write(env));
        } catch (Exception ignored) {
            // best-effort
        }
    }

    private static QueryExecutor selectExecutor() {
        boolean requireReal = "1".equals(System.getenv("AWKIT_ORACLE_REQUIRE_REAL"));
        boolean forceMock = "1".equals(System.getenv("AWKIT_ORACLE_BRIDGE_MOCK"));

        // Fail closed: an explicit mock flag is NEVER honored when a real driver is required.
        if (forceMock && requireReal) {
            System.err.println(
                "[oracle-bridge] AWKIT_ORACLE_BRIDGE_MOCK ignored — AWKIT_ORACLE_REQUIRE_REAL forbids the mock executor.");
            forceMock = false;
        }
        if (forceMock) {
            System.err.println("[oracle-bridge] using MockQueryExecutor (forced by AWKIT_ORACLE_BRIDGE_MOCK).");
            return new MockQueryExecutor();
        }
        try {
            Class<?> cls = Class.forName(ORACLE_EXECUTOR_CLASS);
            Object instance = cls.getDeclaredConstructor().newInstance();
            if (instance instanceof QueryExecutor) {
                System.err.println("[oracle-bridge] using OracleUcpQueryExecutor.");
                return (QueryExecutor) instance;
            }
        } catch (Throwable notPresent) {
            // Oracle jars/executor absent (offline/dev checkout, or a corrupt/incompatible bundle).
        }
        if (requireReal) {
            // Production requires a real driver and none loaded — refuse the mock and fail closed.
            System.err.println(
                "[oracle-bridge] Oracle driver unavailable and AWKIT_ORACLE_REQUIRE_REAL is set — "
                    + "refusing mock fallback; Oracle live queries are disabled.");
            return new DriverUnavailableExecutor();
        }
        System.err.println("[oracle-bridge] Oracle driver unavailable — using MockQueryExecutor.");
        return new MockQueryExecutor();
    }
}
