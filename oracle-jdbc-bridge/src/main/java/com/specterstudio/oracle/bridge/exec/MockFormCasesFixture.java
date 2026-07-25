package com.specterstudio.oracle.bridge.exec;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Database-free twin of {@code SPECTER_MOCKUI.MOCK_FORM_CASES}
 * (see {@code scripts/oracle/local-19c-mock-ui-fixture.sql}).
 *
 * <p>Its reason to exist: the mock-UI workflow — Oracle SELECT → fill the Feature Test Lab form at
 * {@code /form} → assert {@code /success} — must be runnable on a machine with no Oracle database and
 * no JDBC driver (CI, offline builds, a clean dev box). Serving the same 8 rows here means one
 * workflow and one SQL statement work in both modes; only the executor changes.
 *
 * <p><b>Parity is the contract.</b> The rows, the column names, and the JSON value shapes must match
 * what {@code OracleJdbcQueryExecutor} produces for the same table, because {@code verify:oracle-mock-ui}
 * asserts it. Two conversions are subtle and are mirrored deliberately rather than hardcoded:
 * <ul>
 *   <li>{@code NUMBER(12,2)} → the real path returns {@code BigDecimal.toPlainString()} for any scale
 *       above zero, i.e. a <b>String</b> like {@code "82500.50"} — not a JSON number.</li>
 *   <li>{@code DATE} → the real path returns {@code Timestamp.toInstant().toString()}, which reads the
 *       timestamp in the <b>JVM default zone</b>. Hardcoding {@code "1992-04-17T00:00:00Z"} would
 *       disagree with a real database on any host that is not UTC, so the same
 *       {@code Timestamp}→{@code Instant} conversion is applied here instead.</li>
 * </ul>
 *
 * <p>This fixture is data only — it is NOT a driver. {@link MockQueryExecutor#driverAvailable()} stays
 * {@code false} and packaged production still refuses mock mode outright.
 */
public final class MockFormCasesFixture {
    private MockFormCasesFixture() {}

    /** Table this fixture stands in for; also the token that selects it. */
    public static final String TABLE = "MOCK_FORM_CASES";

    /**
     * Whether a statement targets the mock-UI fixture. Deliberately a plain name match: the fixture is
     * reached qualified ({@code SPECTER_MOCKUI.MOCK_FORM_CASES}), unqualified (via the reader's private
     * synonym), and with any projection/ordering a workflow cares to write.
     */
    public static boolean matches(String sql) {
        return sql != null && sql.toUpperCase().contains(TABLE);
    }

    /** Column descriptors in table order — names uppercase, {@code jdbcType} as Oracle reports it. */
    public static List<Map<String, Object>> columns() {
        List<Map<String, Object>> columns = new ArrayList<>();
        for (Column c : COLUMNS) {
            Map<String, Object> col = new LinkedHashMap<>();
            col.put("name", c.name);
            col.put("jdbcType", c.jdbcType);
            columns.add(col);
        }
        return columns;
    }

    /** The 8 fixture rows, in {@code case_id} order, converted the way real JDBC would convert them. */
    public static List<Map<String, Object>> rows() {
        List<Map<String, Object>> out = new ArrayList<>(RAW.size());
        for (Object[] raw : RAW) {
            Map<String, Object> row = new LinkedHashMap<>();
            for (int i = 0; i < COLUMNS.length; i++) {
                row.put(COLUMNS[i].name, convert(COLUMNS[i], raw[i]));
            }
            out.add(row);
        }
        return out;
    }

    // ── Conversion mirror ─────────────────────────────────────────────────────
    // Mirrors OracleJdbcQueryExecutor.convert() for the three types this fixture uses.

    private static Object convert(Column column, Object raw) {
        if (raw == null) return null;
        switch (column.jdbcType) {
            case "NUMBER":
                // scale 0 → long; scale > 0 → plain string (BigDecimal.toPlainString on the real path).
                return column.scale == 0
                    ? (Object) ((Number) raw).longValue()
                    : new BigDecimal(String.valueOf(raw)).setScale(column.scale).toPlainString();
            case "DATE":
                // Same Timestamp → Instant conversion the real executor performs, so the rendered
                // instant tracks the JVM default zone identically on whatever host runs the check.
                return Timestamp.valueOf(((LocalDate) raw).atStartOfDay()).toInstant().toString();
            default:
                return String.valueOf(raw);
        }
    }

    private static final class Column {
        final String name;
        final String jdbcType;
        final int scale;

        Column(String name, String jdbcType, int scale) {
            this.name = name;
            this.jdbcType = jdbcType;
            this.scale = scale;
        }
    }

    private static final Column[] COLUMNS = {
        new Column("CASE_ID", "NUMBER", 0),
        new Column("CASE_LABEL", "VARCHAR2", 0),
        new Column("FIRST_NAME", "VARCHAR2", 0),
        new Column("LAST_NAME", "VARCHAR2", 0),
        new Column("EMAIL", "VARCHAR2", 0),
        new Column("AGE", "NUMBER", 0),
        new Column("SALARY", "NUMBER", 2),
        new Column("BIRTH_DATE", "DATE", 0),
        new Column("COUNTRY", "VARCHAR2", 0),
        new Column("ACCOUNT_TYPE", "VARCHAR2", 0),
        new Column("SKILLS", "VARCHAR2", 0),
        new Column("DESCRIPTION", "VARCHAR2", 0),
        new Column("GENDER", "VARCHAR2", 0),
        new Column("INTEREST_AUTOMATION", "NUMBER", 0),
        new Column("INTEREST_TESTING", "NUMBER", 0),
        new Column("ACCEPT_TERMS", "NUMBER", 0),
        new Column("EXPECTED_OUTCOME", "VARCHAR2", 0)
    };

    /** Row literals, byte-identical to the INSERTs in local-19c-mock-ui-fixture.sql. */
    private static final List<Object[]> RAW = Collections.unmodifiableList(Arrays.asList(
        new Object[] {1L, "happy-path-all-fields", "Amina", "Haddad", "amina.haddad@example.test", 34L,
            "82500.50", LocalDate.of(1992, 4, 17), "JO", "BUSINESS", "playwright,typescript,testing",
            "Every control populated; the baseline data-driven case.", "FEMALE", 1L, 1L, 1L, "SUCCESS"},
        new Object[] {2L, "null-optional-text", "Omar", null, null, 41L,
            "64000.00", LocalDate.of(1985, 11, 2), "AE", "PERSONAL", "typescript",
            "Optional text is NULL and must leave the input empty.", "MALE", 0L, 1L, 1L, "SUCCESS"},
        new Object[] {3L, "decimal-and-age-boundary", "Lina", "Nasser", "lina.nasser@example.test", 18L,
            "1234.56", LocalDate.of(2008, 1, 1), "SA", "PERSONAL", "testing",
            "Two-decimal salary and the lower age boundary.", "FEMALE", 1L, 0L, 1L, "SUCCESS"},
        new Object[] {4L, "null-date-and-gender", "Yousef", "Khalil", "yousef.khalil@example.test", 29L,
            "55000.00", null, "US", "CORPORATE", "playwright,testing",
            "NULL date and NULL gender: no date typed, no radio selected.", null, 1L, 1L, 1L, "SUCCESS"},
        new Object[] {5L, "unicode-and-apostrophe", "Zaid", "O'Brien-Saleh", "zaid.obrien@example.test", 37L,
            "71250.75", LocalDate.of(1989, 6, 30), "JO", "BUSINESS", "playwright",
            "Apostrophe and hyphen in the surname must survive the bridge.", "MALE", 0L, 0L, 1L, "SUCCESS"},
        new Object[] {6L, "single-skill-multiselect", "Rana", "Darwish", "rana.darwish@example.test", 26L,
            "48900.25", LocalDate.of(2000, 9, 12), "SA", "PERSONAL", "testing",
            "Exactly one option chosen in a multi-select.", "FEMALE", 0L, 1L, 1L, "SUCCESS"},
        new Object[] {7L, "interests-unchecked", "Faris", "Mansour", "faris.mansour@example.test", 52L,
            "98000.00", LocalDate.of(1974, 2, 8), "AE", "CORPORATE", "typescript,testing",
            "Both interests are 0 and must end UNCHECKED on a reused page.", "MALE", 0L, 0L, 1L, "SUCCESS"},
        new Object[] {8L, "terms-declined-negative", "Huda", "Barakat", "huda.barakat@example.test", 31L,
            "60500.00", LocalDate.of(1995, 3, 21), "US", "PERSONAL", "playwright,typescript",
            "Terms declined: the negative path, submit must not reach /success.", "FEMALE", 1L, 1L, 0L, "BLOCKED"}
    ));
}
