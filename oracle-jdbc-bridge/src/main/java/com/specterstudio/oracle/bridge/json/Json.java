package com.specterstudio.oracle.bridge.json;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Minimal, dependency-free JSON codec (RFC 8259 subset) for the Oracle JDBC bridge protocol.
 *
 * <p>The bridge intentionally has ZERO external dependencies so its protocol/policy core compiles
 * and runs with a plain offline JDK (no Maven download, no bundled JSON library). Only the values
 * that cross the bridge boundary are supported: object ({@link Map}), array ({@link List}),
 * {@link String}, {@link Long}/{@link Double} (numbers), {@link Boolean}, and {@code null}.
 *
 * <p>Parsing is strict enough for machine-generated input and never executes anything. Serialization
 * emits compact JSON with correct string escaping.
 */
public final class Json {
    private Json() {}

    // ── Serialize ────────────────────────────────────────────────────────────

    public static String write(Object value) {
        StringBuilder sb = new StringBuilder();
        writeValue(sb, value);
        return sb.toString();
    }

    private static void writeValue(StringBuilder sb, Object value) {
        if (value == null) {
            sb.append("null");
        } else if (value instanceof String) {
            writeString(sb, (String) value);
        } else if (value instanceof Boolean) {
            sb.append(((Boolean) value) ? "true" : "false");
        } else if (value instanceof Double || value instanceof Float) {
            double d = ((Number) value).doubleValue();
            if (Double.isNaN(d) || Double.isInfinite(d)) {
                sb.append("null");
            } else {
                sb.append(value.toString());
            }
        } else if (value instanceof Number) {
            sb.append(value.toString());
        } else if (value instanceof Map) {
            writeObject(sb, (Map<?, ?>) value);
        } else if (value instanceof List) {
            writeArray(sb, (List<?>) value);
        } else {
            // Unknown types are stringified defensively — the bridge never puts raw objects on the wire.
            writeString(sb, String.valueOf(value));
        }
    }

    private static void writeObject(StringBuilder sb, Map<?, ?> map) {
        sb.append('{');
        boolean first = true;
        for (Map.Entry<?, ?> entry : map.entrySet()) {
            if (!first) sb.append(',');
            first = false;
            writeString(sb, String.valueOf(entry.getKey()));
            sb.append(':');
            writeValue(sb, entry.getValue());
        }
        sb.append('}');
    }

    private static void writeArray(StringBuilder sb, List<?> list) {
        sb.append('[');
        for (int i = 0; i < list.size(); i++) {
            if (i > 0) sb.append(',');
            writeValue(sb, list.get(i));
        }
        sb.append(']');
    }

    private static void writeString(StringBuilder sb, String s) {
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                case '\b': sb.append("\\b"); break;
                case '\f': sb.append("\\f"); break;
                default:
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        sb.append('"');
    }

    // ── Parse ────────────────────────────────────────────────────────────────

    public static Object parse(String text) {
        Parser p = new Parser(text);
        p.skipWs();
        Object v = p.parseValue();
        p.skipWs();
        if (!p.atEnd()) {
            throw new JsonException("Trailing content after JSON value at index " + p.pos);
        }
        return v;
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> parseObject(String text) {
        Object v = parse(text);
        if (!(v instanceof Map)) {
            throw new JsonException("Expected a JSON object");
        }
        return (Map<String, Object>) v;
    }

    public static final class JsonException extends RuntimeException {
        private static final long serialVersionUID = 1L;

        public JsonException(String message) {
            super(message);
        }
    }

    private static final class Parser {
        private final String s;
        private int pos;

        Parser(String s) {
            this.s = s;
        }

        boolean atEnd() {
            return pos >= s.length();
        }

        void skipWs() {
            while (pos < s.length()) {
                char c = s.charAt(pos);
                if (c == ' ' || c == '\t' || c == '\n' || c == '\r') pos++;
                else break;
            }
        }

        Object parseValue() {
            skipWs();
            if (atEnd()) throw new JsonException("Unexpected end of JSON");
            char c = s.charAt(pos);
            switch (c) {
                case '{': return parseObj();
                case '[': return parseArr();
                case '"': return parseStr();
                case 't': case 'f': return parseBool();
                case 'n': return parseNull();
                default: return parseNumber();
            }
        }

        private Map<String, Object> parseObj() {
            expect('{');
            Map<String, Object> map = new LinkedHashMap<>();
            skipWs();
            if (peek() == '}') { pos++; return map; }
            while (true) {
                skipWs();
                if (peek() != '"') throw new JsonException("Expected string key at index " + pos);
                String key = parseStr();
                skipWs();
                expect(':');
                Object value = parseValue();
                map.put(key, value);
                skipWs();
                char n = next();
                if (n == '}') break;
                if (n != ',') throw new JsonException("Expected ',' or '}' at index " + (pos - 1));
            }
            return map;
        }

        private List<Object> parseArr() {
            expect('[');
            List<Object> list = new ArrayList<>();
            skipWs();
            if (peek() == ']') { pos++; return list; }
            while (true) {
                list.add(parseValue());
                skipWs();
                char n = next();
                if (n == ']') break;
                if (n != ',') throw new JsonException("Expected ',' or ']' at index " + (pos - 1));
            }
            return list;
        }

        private String parseStr() {
            expect('"');
            StringBuilder sb = new StringBuilder();
            while (true) {
                if (atEnd()) throw new JsonException("Unterminated string");
                char c = s.charAt(pos++);
                if (c == '"') break;
                if (c == '\\') {
                    char e = s.charAt(pos++);
                    switch (e) {
                        case '"': sb.append('"'); break;
                        case '\\': sb.append('\\'); break;
                        case '/': sb.append('/'); break;
                        case 'n': sb.append('\n'); break;
                        case 'r': sb.append('\r'); break;
                        case 't': sb.append('\t'); break;
                        case 'b': sb.append('\b'); break;
                        case 'f': sb.append('\f'); break;
                        case 'u':
                            String hex = s.substring(pos, pos + 4);
                            sb.append((char) Integer.parseInt(hex, 16));
                            pos += 4;
                            break;
                        default: throw new JsonException("Invalid escape \\" + e);
                    }
                } else {
                    sb.append(c);
                }
            }
            return sb.toString();
        }

        private Object parseBool() {
            if (s.startsWith("true", pos)) { pos += 4; return Boolean.TRUE; }
            if (s.startsWith("false", pos)) { pos += 5; return Boolean.FALSE; }
            throw new JsonException("Invalid literal at index " + pos);
        }

        private Object parseNull() {
            if (s.startsWith("null", pos)) { pos += 4; return null; }
            throw new JsonException("Invalid literal at index " + pos);
        }

        private Object parseNumber() {
            int start = pos;
            boolean isDouble = false;
            while (pos < s.length()) {
                char c = s.charAt(pos);
                if ((c >= '0' && c <= '9') || c == '-' || c == '+') {
                    pos++;
                } else if (c == '.' || c == 'e' || c == 'E') {
                    isDouble = true;
                    pos++;
                } else {
                    break;
                }
            }
            String num = s.substring(start, pos);
            if (num.isEmpty()) throw new JsonException("Invalid number at index " + start);
            if (isDouble) return Double.parseDouble(num);
            try {
                return Long.parseLong(num);
            } catch (NumberFormatException ex) {
                return Double.parseDouble(num);
            }
        }

        private char peek() {
            if (atEnd()) throw new JsonException("Unexpected end of JSON");
            return s.charAt(pos);
        }

        private char next() {
            if (atEnd()) throw new JsonException("Unexpected end of JSON");
            return s.charAt(pos++);
        }

        private void expect(char c) {
            char actual = next();
            if (actual != c) throw new JsonException("Expected '" + c + "' but found '" + actual + "' at index " + (pos - 1));
        }
    }
}
