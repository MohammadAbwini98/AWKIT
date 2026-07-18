package com.specterstudio.oracle.bridge.exec;

import com.specterstudio.oracle.bridge.protocol.BridgeException;
import com.specterstudio.oracle.bridge.protocol.Protocol;

import java.math.BigDecimal;
import java.sql.Clob;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.SQLTimeoutException;
import java.sql.Timestamp;
import java.sql.Types;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;

/**
 * The real Oracle executor: the Oracle JDBC Thin driver via {@link DriverManager}, one fresh
 * connection opened and closed per query (no pooling). Compiled when the ojdbc jar is available —
 * vendored under {@code resources/oracle-jdbc/lib/} or selected via a Settings driver bundle (see
 * {@code scripts/build-oracle-bridge.mjs}). This is the ONLY real executor; Specter no longer
 * supports UCP connection pooling.
 *
 * <p>Reports {@code executionMode "real"}. Bounded concurrency is enforced by the TypeScript
 * {@code OracleQueryService} limiter, not by a connection pool.
 *
 * <p>Security invariants: {@code Connection.setReadOnly(true)} (defense in depth — the least-privilege
 * account is the real boundary), all values bound via {@link PreparedStatement}, and NO password /
 * bind value / ORA-text / returned row ever placed in an exception message (every {@link SQLException}
 * maps to a safe, low-cardinality category).
 */
public final class OracleJdbcQueryExecutor implements QueryExecutor {

    /** Absolute ceiling on characters read from a single CLOB cell (defense against OOM). */
    private static final long MAX_CLOB_CHARS = 4_000_000L;

    public OracleJdbcQueryExecutor() {
        // Ensure the driver class is loaded/registered even on JDKs without the service auto-load.
        try {
            Class.forName("oracle.jdbc.OracleDriver");
        } catch (Throwable t) {
            throw new IllegalStateException("Oracle JDBC driver class could not be loaded.");
        }
    }

    @Override
    public boolean driverAvailable() {
        return true;
    }

    @Override
    public String executionMode() {
        return "real";
    }

    @Override
    public String driverVersion() {
        String v = versionOf("oracle.jdbc.OracleDriver");
        return v != null ? v : "oracle-jdbc";
    }

    @Override
    public Map<String, Object> testConnection(Map<String, Object> params) {
        long started = System.nanoTime();
        try (Connection conn = open(params)) {
            applyConnectionDefaults(conn);
            boolean ok = conn.isValid(5);
            DatabaseMetaData md = conn.getMetaData();
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("ok", ok);
            result.put("latencyMs", (System.nanoTime() - started) / 1_000_000L);
            result.put("databaseProductVersion", safeProductVersion(md));
            result.put("driverVersion", nullToUnknown(md.getDriverVersion()));
            result.put("pooled", false);
            return result;
        } catch (SQLException ex) {
            throw mapSqlException(ex);
        }
    }

    @Override
    public Map<String, Object> executeQuery(Map<String, Object> params, CancellationToken token) {
        long started = System.nanoTime();
        final String sql = str(params.get("sql"));
        final long maxRows = asLong(params.get("maxRows"), 10_000L);
        final int fetchSize = (int) asLong(params.get("fetchSize"), 200L);
        final long timeoutMs = asLong(params.get("timeoutMs"), 60_000L);
        final List<Object> binds = asList(params.get("binds"));

        Connection conn = null;
        PreparedStatement ps = null;
        ResultSet rs = null;
        try {
            conn = open(params);
            applyConnectionDefaults(conn);

            ps = conn.prepareStatement(sql, ResultSet.TYPE_FORWARD_ONLY, ResultSet.CONCUR_READ_ONLY);
            // Query timeout is in whole seconds; round up so a sub-second budget still arms it.
            ps.setQueryTimeout((int) Math.max(1, Math.ceil(timeoutMs / 1000.0)));
            ps.setFetchSize(Math.max(1, fetchSize));
            bindAll(ps, binds);

            // Out-of-band cancellation: flip → Statement.cancel(). Runs immediately if already cancelled.
            final PreparedStatement cancelTarget = ps;
            token.onCancel(() -> {
                try {
                    cancelTarget.cancel();
                } catch (SQLException ignored) {
                    // best-effort
                }
            });
            if (token.isCancelled()) {
                throw new BridgeException(Protocol.ERR_CANCELLED, "Query was cancelled.");
            }

            rs = ps.executeQuery();
            ResultSetMetaData meta = rs.getMetaData();
            List<Map<String, Object>> columns = describeColumns(meta);

            List<Map<String, Object>> rows = new ArrayList<>();
            boolean truncated = false;
            int colCount = meta.getColumnCount();
            while (rs.next()) {
                if (token.isCancelled()) {
                    throw new BridgeException(Protocol.ERR_CANCELLED, "Query was cancelled.");
                }
                if (rows.size() >= maxRows) {
                    truncated = true; // one row beyond the cap proves there was more
                    break;
                }
                Map<String, Object> row = new LinkedHashMap<>();
                for (int c = 1; c <= colCount; c++) {
                    row.put(columnName(columns, c - 1), convert(rs, c, meta.getColumnType(c)));
                }
                rows.add(row);
            }

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("rows", rows);
            result.put("columns", columns);
            result.put("rowCount", (long) rows.size());
            result.put("truncated", truncated);
            result.put("executionMs", (System.nanoTime() - started) / 1_000_000L);
            result.put("source", "oracle");
            return result;
        } catch (SQLException ex) {
            throw mapSqlException(ex);
        } finally {
            closeQuietly(rs);
            closeQuietly(ps);
            closeQuietly(conn);
        }
    }

    @Override
    public void closePool(Map<String, Object> params) {
        // No pool to close — connections are per-query and closed in the finally block.
    }

    @Override
    public void shutdown() {
        // Nothing pooled to drain.
    }

    // ── Connection ──────────────────────────────────────────────────────────────

    private Connection open(Map<String, Object> params) throws SQLException {
        final String url = str(params.get("url"));
        if (url == null || url.isEmpty()) {
            throw new BridgeException(Protocol.ERR_INVALID_CONFIGURATION, "A JDBC URL is required.");
        }
        Properties props = new Properties();
        String user = str(params.get("username"));
        if (user != null) props.setProperty("user", user);
        Object pw = params.get("password");
        if (pw != null) props.setProperty("password", String.valueOf(pw));
        // Arm a login timeout so an unreachable host fails fast rather than hanging the worker.
        long connectMs = asLong(params.get("connectTimeoutMs"), 15_000L);
        DriverManager.setLoginTimeout((int) Math.max(1, Math.ceil(connectMs / 1000.0)));
        return DriverManager.getConnection(url, props);
    }

    private void applyConnectionDefaults(Connection conn) throws SQLException {
        // Defense in depth only — the least-privilege account is the real read-only boundary.
        conn.setReadOnly(true);
        conn.setAutoCommit(true);
    }

    // ── Binding ───────────────────────────────────────────────────────────────

    private void bindAll(PreparedStatement ps, List<Object> binds) throws SQLException {
        for (int i = 0; i < binds.size(); i++) {
            Object v = binds.get(i);
            int idx = i + 1;
            if (v == null) {
                ps.setNull(idx, Types.VARCHAR);
            } else if (v instanceof Boolean) {
                ps.setInt(idx, ((Boolean) v) ? 1 : 0);
            } else if (v instanceof Integer || v instanceof Long) {
                ps.setLong(idx, ((Number) v).longValue());
            } else if (v instanceof Double || v instanceof Float) {
                ps.setDouble(idx, ((Number) v).doubleValue());
            } else if (v instanceof Number) {
                ps.setBigDecimal(idx, new BigDecimal(v.toString()));
            } else {
                ps.setString(idx, v.toString());
            }
        }
    }

    // ── Result conversion ─────────────────────────────────────────────────────

    private List<Map<String, Object>> describeColumns(ResultSetMetaData meta) throws SQLException {
        List<Map<String, Object>> columns = new ArrayList<>();
        int count = meta.getColumnCount();
        for (int c = 1; c <= count; c++) {
            Map<String, Object> col = new LinkedHashMap<>();
            String label = meta.getColumnLabel(c);
            col.put("name", (label == null || label.isEmpty()) ? meta.getColumnName(c) : label);
            col.put("jdbcType", meta.getColumnTypeName(c));
            columns.add(col);
        }
        return columns;
    }

    private static String columnName(List<Map<String, Object>> columns, int index) {
        return String.valueOf(columns.get(index).get("name"));
    }

    private Object convert(ResultSet rs, int col, int sqlType) throws SQLException {
        switch (sqlType) {
            case Types.NULL:
                return null;
            case Types.NUMERIC:
            case Types.DECIMAL: {
                BigDecimal bd = rs.getBigDecimal(col);
                if (bd == null) return null;
                if (bd.scale() <= 0) {
                    try {
                        return bd.longValueExact();
                    } catch (ArithmeticException overflow) {
                        return bd.toPlainString();
                    }
                }
                return bd.toPlainString();
            }
            case Types.TINYINT:
            case Types.SMALLINT:
            case Types.INTEGER:
            case Types.BIGINT: {
                long l = rs.getLong(col);
                return rs.wasNull() ? null : l;
            }
            case Types.FLOAT:
            case Types.REAL:
            case Types.DOUBLE: {
                double d = rs.getDouble(col);
                return rs.wasNull() ? null : d;
            }
            case Types.BOOLEAN:
            case Types.BIT: {
                boolean b = rs.getBoolean(col);
                return rs.wasNull() ? null : b;
            }
            case Types.DATE:
            case Types.TIMESTAMP:
            case Types.TIMESTAMP_WITH_TIMEZONE: {
                Timestamp ts = rs.getTimestamp(col);
                return ts == null ? null : ts.toInstant().toString();
            }
            case Types.CLOB: {
                Clob clob = rs.getClob(col);
                if (clob == null) return null;
                long len = Math.min(clob.length(), MAX_CLOB_CHARS);
                return clob.getSubString(1, (int) len);
            }
            default: {
                Object o = rs.getObject(col);
                if (o == null) return null;
                if (o instanceof Number || o instanceof Boolean || o instanceof String) return o;
                return o.toString();
            }
        }
    }

    // ── Error mapping (safe, low-cardinality; never leaks ORA text / SQL / values) ────────────────

    private BridgeException mapSqlException(SQLException ex) {
        if (ex instanceof SQLTimeoutException) {
            return new BridgeException(Protocol.ERR_TIMEOUT, "The query exceeded its time budget.", true);
        }
        int code = ex.getErrorCode(); // ORA-xxxxx
        switch (code) {
            case 1017:
            case 1005:
            case 28000:
                return new BridgeException(Protocol.ERR_AUTHENTICATION_FAILED, "Authentication failed.", false);
            case 12514:
            case 12505:
            case 12528:
                return new BridgeException(Protocol.ERR_SERVICE_NOT_FOUND, "The database service was not found.", false);
            case 12541:
            case 12170:
            case 17002:
                return new BridgeException(Protocol.ERR_NETWORK_UNREACHABLE, "The database was unreachable.", true);
            case 1013:
                return new BridgeException(Protocol.ERR_CANCELLED, "Query was cancelled.", false);
            case 28759:
            case 28750:
                return new BridgeException(Protocol.ERR_WALLET_ERROR, "Wallet/credential store error.", false);
            default:
                break;
        }
        String state = ex.getSQLState();
        if (state != null && state.startsWith("08")) {
            return new BridgeException(Protocol.ERR_NETWORK_UNREACHABLE, "The database connection failed.", true);
        }
        if (state != null && state.startsWith("28")) {
            return new BridgeException(Protocol.ERR_AUTHENTICATION_FAILED, "Authentication failed.", false);
        }
        return new BridgeException(Protocol.ERR_DRIVER_ERROR, "The database rejected the query.", false);
    }

    // ── Small helpers ─────────────────────────────────────────────────────────

    private static String safeProductVersion(DatabaseMetaData md) {
        try {
            return nullToUnknown(md.getDatabaseProductVersion());
        } catch (SQLException ex) {
            return "unknown";
        }
    }

    private static String versionOf(String className) {
        try {
            Class<?> cls = Class.forName(className);
            Package pkg = cls.getPackage();
            return pkg == null ? null : pkg.getImplementationVersion();
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static String nullToUnknown(String s) {
        return (s == null || s.isEmpty()) ? "unknown" : s;
    }

    private static void closeQuietly(AutoCloseable c) {
        if (c != null) {
            try {
                c.close();
            } catch (Exception ignored) {
                // best-effort
            }
        }
    }

    private static String str(Object v) {
        return v == null ? null : String.valueOf(v);
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

    @SuppressWarnings("unchecked")
    private static List<Object> asList(Object v) {
        return (v instanceof List) ? (List<Object>) v : new ArrayList<>();
    }
}
