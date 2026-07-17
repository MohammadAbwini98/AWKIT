package com.specterstudio.oracle.bridge.exec;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Cooperative cancellation flag for one in-flight query. The dispatcher registers a token per
 * request id and flips it on {@code cancelQuery}. Executors poll {@link #isCancelled()} at safe
 * points and (for real JDBC) also call {@code Statement.cancel()} out of band.
 */
public final class CancellationToken {
    private final AtomicBoolean cancelled = new AtomicBoolean(false);
    private volatile Runnable onCancel;

    public boolean isCancelled() {
        return cancelled.get();
    }

    /** Register a side effect (e.g. {@code Statement.cancel()}) to run when cancellation is requested. */
    public void onCancel(Runnable action) {
        this.onCancel = action;
        if (cancelled.get() && action != null) {
            safeRun(action);
        }
    }

    public void cancel() {
        if (cancelled.compareAndSet(false, true)) {
            Runnable action = this.onCancel;
            if (action != null) safeRun(action);
        }
    }

    private static void safeRun(Runnable action) {
        try {
            action.run();
        } catch (Throwable ignored) {
            // Cancellation side effects are best-effort.
        }
    }
}
