package com.specterstudio.oracle.bridge.sql;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/**
 * Conservative read-only SQL gate. The initial Oracle release permits ONLY a single
 * {@code SELECT} or {@code WITH … SELECT} statement with no data/definition side effects.
 *
 * <p>Enforcement strategy (does not rely on checking the first raw characters):
 * <ol>
 *   <li>Strip block/line comments and single-quoted string literals, and neutralize double-quoted
 *       identifiers, so keywords inside literals/identifiers cannot trip or evade the gate.</li>
 *   <li>Reject multiple statements (a {@code ;} that is not a lone trailing terminator).</li>
 *   <li>Require the first significant keyword to be {@code SELECT} or {@code WITH}.</li>
 *   <li>Reject any forbidden keyword token anywhere (DML/DDL/PL-SQL/locking/transaction control).</li>
 * </ol>
 *
 * <p>This is defense in depth. Production must ALSO use a least-privilege, read-only Oracle account;
 * the connection is opened read-only where supported. The TypeScript mirror in
 * {@code src/oracle/OracleSqlPolicy.ts} rejects violations before the bridge is even spawned.
 */
public final class SqlReadOnlyPolicy {
    private SqlReadOnlyPolicy() {}

    private static final Set<String> FORBIDDEN = new HashSet<>(Arrays.asList(
        "INSERT", "UPDATE", "DELETE", "MERGE", "UPSERT",
        "CREATE", "ALTER", "DROP", "TRUNCATE", "RENAME", "COMMENT",
        "GRANT", "REVOKE", "AUDIT", "NOAUDIT",
        "BEGIN", "DECLARE", "CALL", "EXEC", "EXECUTE",
        "COMMIT", "ROLLBACK", "SAVEPOINT", "SET",
        "LOCK", "INTO", "FLASHBACK", "PURGE", "ANALYZE", "EXPLAIN",
        // Inline PL/SQL in the WITH clause (`WITH FUNCTION`/`WITH PROCEDURE`, 12c+). Both are reserved
        // words, so they cannot be legitimate unquoted identifiers in a plain SELECT.
        "FUNCTION", "PROCEDURE"
    ));

    /** Dangerous package prefixes (network/file/exec). Defense in depth on top of a no-EXECUTE account. */
    private static final String[] DANGEROUS_PACKAGE_PREFIXES = {"UTL_", "DBMS_", "OWA_"};

    private static boolean isDangerousPackage(String token) {
        for (String p : DANGEROUS_PACKAGE_PREFIXES) {
            if (token.startsWith(p)) return true;
        }
        return false;
    }

    /** Result of validation: either allowed, or a safe reason string. */
    public static final class Result {
        public final boolean allowed;
        public final String reason;

        private Result(boolean allowed, String reason) {
            this.allowed = allowed;
            this.reason = reason;
        }

        static Result ok() {
            return new Result(true, null);
        }

        static Result deny(String reason) {
            return new Result(false, reason);
        }
    }

    public static Result validate(String rawSql) {
        if (rawSql == null || rawSql.trim().isEmpty()) {
            return Result.deny("SQL is empty.");
        }
        String stripped = stripLiteralsAndComments(rawSql).trim();
        if (stripped.isEmpty()) {
            return Result.deny("SQL contains no executable statement.");
        }

        // A single trailing ';' is allowed; anything after it (another statement) is not.
        int semi = stripped.indexOf(';');
        if (semi >= 0) {
            String tail = stripped.substring(semi + 1).trim();
            if (!tail.isEmpty()) {
                return Result.deny("Only a single SELECT statement is allowed; multiple statements were found.");
            }
            stripped = stripped.substring(0, semi).trim();
        }

        String[] tokens = stripped.split("[^A-Za-z0-9_$#]+");
        String firstKeyword = null;
        for (String t : tokens) {
            if (!t.isEmpty()) {
                firstKeyword = t.toUpperCase();
                break;
            }
        }
        if (firstKeyword == null) {
            return Result.deny("SQL contains no executable statement.");
        }
        if (!firstKeyword.equals("SELECT") && !firstKeyword.equals("WITH")) {
            return Result.deny("Only SELECT or WITH … SELECT queries are allowed (found '" + firstKeyword + "').");
        }

        // Database links (`table@remote_db`) reach another database; disallow them. `@` cannot survive
        // stripping except as a link operator (string literals + quoted identifiers were removed).
        if (stripped.indexOf('@') >= 0) {
            return Result.deny("Database links (@remote) are not allowed in read-only mode.");
        }

        boolean sawSelect = false;
        for (String t : tokens) {
            if (t.isEmpty()) continue;
            String up = t.toUpperCase();
            if (up.equals("SELECT")) sawSelect = true;
            if (FORBIDDEN.contains(up)) {
                return Result.deny("The keyword '" + up + "' is not allowed in read-only mode.");
            }
            if (isDangerousPackage(up)) {
                return Result.deny("Calls into the '" + up + "' package are not allowed in read-only mode.");
            }
        }
        if (!sawSelect) {
            return Result.deny("A read-only query must contain a SELECT.");
        }
        // Reject row-locking read (`SELECT … FOR UPDATE`). FOR and UPDATE are separate tokens; UPDATE
        // is already forbidden above, so this is covered — but keep an explicit check for clarity.
        String upper = " " + stripped.toUpperCase().replaceAll("\\s+", " ") + " ";
        if (upper.contains(" FOR UPDATE ")) {
            return Result.deny("SELECT … FOR UPDATE is not allowed in read-only mode.");
        }
        return Result.ok();
    }

    /**
     * Remove single-quoted literals and comments, and blank out double-quoted identifiers, replacing
     * each with a space so token boundaries are preserved and no embedded keyword survives.
     */
    static String stripLiteralsAndComments(String sql) {
        StringBuilder out = new StringBuilder(sql.length());
        int i = 0;
        int n = sql.length();
        while (i < n) {
            char c = sql.charAt(i);
            // Line comment
            if (c == '-' && i + 1 < n && sql.charAt(i + 1) == '-') {
                i += 2;
                while (i < n && sql.charAt(i) != '\n') i++;
                out.append(' ');
                continue;
            }
            // Block comment (covers optimizer hints /*+ ... */ too — validation only)
            if (c == '/' && i + 1 < n && sql.charAt(i + 1) == '*') {
                i += 2;
                while (i + 1 < n && !(sql.charAt(i) == '*' && sql.charAt(i + 1) == '/')) i++;
                i += 2;
                out.append(' ');
                continue;
            }
            // Single-quoted string literal (with '' escape)
            if (c == '\'') {
                i++;
                while (i < n) {
                    if (sql.charAt(i) == '\'') {
                        if (i + 1 < n && sql.charAt(i + 1) == '\'') {
                            i += 2;
                            continue;
                        }
                        i++;
                        break;
                    }
                    i++;
                }
                out.append(" 'x' "); // neutral placeholder token
                continue;
            }
            // Double-quoted identifier
            if (c == '"') {
                i++;
                while (i < n && sql.charAt(i) != '"') i++;
                i++;
                out.append(" id "); // neutral identifier token
                continue;
            }
            out.append(c);
            i++;
        }
        return out.toString();
    }
}
