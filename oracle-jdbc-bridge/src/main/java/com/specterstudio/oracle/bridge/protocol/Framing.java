package com.specterstudio.oracle.bridge.protocol;

import java.io.DataInputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Length-prefixed message framing: a 4-byte big-endian unsigned length followed by that many UTF-8
 * bytes of JSON. Oversize frames are rejected without desynchronizing the stream (the payload bytes
 * are still drained on read so the next frame stays aligned).
 */
public final class Framing {
    private Framing() {}

    /** Read one frame. Returns {@code null} on clean end-of-stream (peer closed stdin). */
    public static String readFrame(DataInputStream in) throws IOException {
        int length;
        try {
            length = in.readInt();
        } catch (EOFException eof) {
            return null;
        }
        if (length < 0) {
            throw new IOException("Negative frame length " + length);
        }
        if (length > Protocol.MAX_MESSAGE_BYTES) {
            // Drain and discard so the stream stays aligned, then signal oversize to the caller.
            skipFully(in, length);
            throw new OversizeFrameException(length);
        }
        byte[] buf = new byte[length];
        in.readFully(buf);
        return new String(buf, StandardCharsets.UTF_8);
    }

    /** Write one frame. Throws if the payload would exceed the protocol maximum. */
    public static void writeFrame(OutputStream out, String json) throws IOException {
        byte[] payload = json.getBytes(StandardCharsets.UTF_8);
        if (payload.length > Protocol.MAX_MESSAGE_BYTES) {
            throw new IOException("Outbound frame exceeds max message size (" + payload.length + " bytes)");
        }
        byte[] header = new byte[4];
        int len = payload.length;
        header[0] = (byte) ((len >>> 24) & 0xFF);
        header[1] = (byte) ((len >>> 16) & 0xFF);
        header[2] = (byte) ((len >>> 8) & 0xFF);
        header[3] = (byte) (len & 0xFF);
        synchronized (out) {
            out.write(header);
            out.write(payload);
            out.flush();
        }
    }

    private static void skipFully(DataInputStream in, long n) throws IOException {
        long remaining = n;
        byte[] scratch = new byte[8192];
        while (remaining > 0) {
            int chunk = (int) Math.min(scratch.length, remaining);
            int read = in.read(scratch, 0, chunk);
            if (read < 0) throw new EOFException("Stream ended while draining oversize frame");
            remaining -= read;
        }
    }

    /** Thrown when an inbound frame's declared length exceeds {@link Protocol#MAX_MESSAGE_BYTES}. */
    public static final class OversizeFrameException extends IOException {
        private static final long serialVersionUID = 1L;
        private final long declaredLength;

        OversizeFrameException(long declaredLength) {
            super("Inbound frame length " + declaredLength + " exceeds max " + Protocol.MAX_MESSAGE_BYTES);
            this.declaredLength = declaredLength;
        }

        public long declaredLength() {
            return declaredLength;
        }
    }
}
