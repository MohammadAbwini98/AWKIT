package com.specterstudio.oracle.bridge.protocol;

/**
 * A failure that carries a safe {@link Protocol} error category. The message is already redacted and
 * safe to send across the wire; the original cause (which may reference an Oracle {@code ORA-} code
 * or connection detail) is kept only for local, redacted stderr diagnostics.
 */
public class BridgeException extends RuntimeException {
    private static final long serialVersionUID = 1L;
    private final String category;
    private final boolean retriable;

    public BridgeException(String category, String safeMessage) {
        this(category, safeMessage, false, null);
    }

    public BridgeException(String category, String safeMessage, boolean retriable) {
        this(category, safeMessage, retriable, null);
    }

    public BridgeException(String category, String safeMessage, boolean retriable, Throwable cause) {
        super(safeMessage, cause);
        this.category = category;
        this.retriable = retriable;
    }

    public String category() {
        return category;
    }

    public boolean retriable() {
        return retriable;
    }
}
