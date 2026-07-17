package com.specterstudio.oracle.bridge.exec;

import com.specterstudio.oracle.bridge.protocol.BridgeException;
import com.specterstudio.oracle.bridge.protocol.Protocol;

import oracle.ucp.jdbc.PoolDataSource;
import oracle.ucp.jdbc.PoolDataSourceFactory;

import java.math.BigDecimal;
import java.sql.Clob;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
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
import java.util.concurrent.ConcurrentHashMap;

/**
 * Real Oracle executor: Oracle JDBC Thin driver behind a Universal Connection Pool (UCP), one pool
 * per connection compatibility key. Compiled ONLY when the ojdbc/ucp jars are vendored under
 * {@code resources/oracle-jdbc/lib/} (see {@code scripts/build-oracle-bridge.mjs}); the network-blocked
 * dev checkout builds the core alone and runs {@link MockQueryExecutor}.
 *
 * <p>Security invariants:
 * <ul>
 *   <li>Read-only in depth: {@code Connection.setReadOnly(true)} is set, but it is NOT the security
 *       boundary — the dedicated least-privilege Oracle account is (see the SQL policy + runbook).</li>
 *   <li>All values are bound via {@link PreparedStatement} — never string-concatenated.</li>
 *   <li>No password, wallet secret, bind value, ORA-text, or returned row ever appears in an exception
 *       message; every {@link SQLException} is mapped to a safe, low-cardinality category.</li>
 * </ul>
 */
public final class OracleUcpQueryExecutor implements QueryExecutor {

    /** Absolute ceiling on characters read from a single CLOB cell (defense against OOM). */
    private static final long MAX_CLOB_CHARS = 4_000_000L;

    private final ConcurrentHashMap<String, PoolDataSource> pools = new ConcurrentHashMap<>();

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
    public String ucpVersion() {
        String v = versionOf("oracle.ucp.jdbc.PoolDataSource");
        return v != null ? v : "ucp";
    }

    @Override
    public Map<String, Object> testConnection(Map<String, Object> params) {
        long started = System.nanoTime();
        PoolDataSource pds = poolFor(params);
        try (Connection conn = pds.getConnection()) {
            applyConnectionDefaults(conn);
            boolean ok = conn.isValid(5);
            DatabaseMetaData md = conn.getMetaData();
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("ok", ok);
            result.put("latencyMs", (System.nanoTime() - started) / 1_000_000L);
            result.put("databaseProductVersion", safeProductVersion(md));
            result.put("driverVersion", nullToUnknown(md.getDriverVersion()));
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

        PoolDataSource pds = poolFor(params);
        Connection conn = null;
        PreparedStatement ps = null;
        ResultSet rs = null;
        try {
            conn = pds.getConnection();
            applyConnectionDefaults(conn);

            ps = conn.prepareStatement(sql, ResultSet.TYPE_FORWARD_ONLY, ResultSet.CONCUR_READ_ONLY);
            // Query timeout is in whole seconds; round up so a sub-second budget still arms it.
            ps.setQueryTimeout((int) Math.max(1, Math.ceil(timeoutMs / 1000.0)));
            ps.setFetchSize(Math.max(1, fetchSize));
            bindAll(ps, binds);

            // Out-of-band cancellation: flip → Statement.cancel(). onCancel runs immediately if already cancelled.
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
            closeQuietly(conn); // returns the connection to the pool
        }
    }

    @Override
    public void closePool(Map<String, Object> params) {
        String key = poolKey(params);
        PoolDataSource removed = pools.remove(key);
        // UCP pools are managed by the pool manager; dropping our reference releases it. A pooled
        // datasource has no public close(), so we rely on GC + the manager's idle retirement.
        if (removed != null) {
            // no-op: reference dropped
        }
    }

    @Override
    public void shutdown() {
        pools.clear();
    }

    // ── Pool management ───────────────────────────────────────────────────────

    private PoolDataSource poolFor(Map<String, Object> params) {
        final String key = poolKey(params);
        return pools.computeIfAbsent(key, k -> buildPool(params, k));
    }

    private PoolDataSource buildPool(Map<String, Object> params, String key) {
        try {
            PoolDataSource pds = PoolDataSourceFactory.getPoolDataSource();
            pds.setConnectionFactoryClassName("oracle.jdbc.pool.OracleDataSource");
            pds.setURL(str(params.get("url")));
            String user = str(params.get("username"));
            if (user != null) pds.setUser(user);
            Object pw = params.get("password");
            if (pw != null) pds.setPassword(String.valueOf(pw));
            pds.setConnectionPoolName("awkit-oracle-" + Integer.toHexString(key.hashCode()));
            pds.setInitialPoolSize(0);
            pds.setMinPoolSize(0);
            pds.setMaxPoolSize((int) asLong(params.get("maxPoolSize"), 4L));
            pds.setValidateConnectionOnBorrow(true);
            pds.setInactiveConnectionTimeout(60);
            pds.setConnectionWaitTimeout((int) Math.max(1, asLong(params.get("poolWaitMs"), 10_000L) / 1000));
            return pds;
        } catch (SQLException ex) {
            throw mapSqlException(ex);
        }
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
                // Strings (incl. high-precision numerics + ISO dates the TS side normalized) bind as-is;
                // Oracle applies implicit conversion for the target column.
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
                    // Integer-valued NUMBER: keep as Long when it fits, else a precise String.
                    try {
                        return bd.longValueExact();
                    } catch (ArithmeticException overflow) {
                        return bd.toPlainString();
                    }
                }
                // Fractional: preserve precision as a String (JSON doubles would round).
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
            case 1017: // invalid username/password
            case 1005:
            case 28000: // account locked
                return new BridgeException(Protocol.ERR_AUTHENTICATION_FAILED, "Authentication failed.", false);
            case 12514: // service not known to listener
            case 12505:
            case 12528:
                return new BridgeException(Protocol.ERR_SERVICE_NOT_FOUND, "The database service was not found.", false);
            case 12541: // no listener
            case 12170: // connect timeout
            case 17002: // IO error
                return new BridgeException(Protocol.ERR_NETWORK_UNREACHABLE, "The database was unreachable.", true);
            case 1013: // user requested cancel of current operation
                return new BridgeException(Protocol.ERR_CANCELLED, "Query was cancelled.", false);
            case 28759: // failure to open file (wallet)
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

    private static String poolKey(Map<String, Object> params) {
        Object key = params.get("poolKey");
        if (key != null) return String.valueOf(key);
        // Fall back to a coarse key from url+user (never includes the password).
        return String.valueOf(params.get("url")) + "|" + String.valueOf(params.get("username"));
    }

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
            String v = pkg == null ? null : pkg.getImplementationVersion();
            return v;
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
