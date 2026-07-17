/**
 * Read-only SQL gate (TypeScript mirror of the authoritative Java
 * `SqlReadOnlyPolicy`). Rejects non-SELECT SQL in the renderer/main BEFORE the bridge is ever
 * spawned; the Java side re-validates independently so a racing/compromised caller cannot bypass it.
 *
 * The initial Oracle release permits ONLY a single `SELECT` or `WITH … SELECT` statement with no
 * data/definition side effects. Keep this list and the Java `FORBIDDEN` set in sync.
 */

const FORBIDDEN = new Set([
  "INSERT", "UPDATE", "DELETE", "MERGE", "UPSERT",
  "CREATE", "ALTER", "DROP", "TRUNCATE", "RENAME", "COMMENT",
  "GRANT", "REVOKE", "AUDIT", "NOAUDIT",
  "BEGIN", "DECLARE", "CALL", "EXEC", "EXECUTE",
  "COMMIT", "ROLLBACK", "SAVEPOINT", "SET",
  "LOCK", "INTO", "FLASHBACK", "PURGE", "ANALYZE", "EXPLAIN",
  // Inline PL/SQL in the WITH clause (`WITH FUNCTION`/`WITH PROCEDURE`, 12c+) — both are Oracle
  // reserved words, so they cannot be legitimate unquoted identifiers in a plain SELECT.
  "FUNCTION", "PROCEDURE"
]);

/**
 * Dangerous package prefixes. A read-only SELECT can still invoke a stored function, so calls into
 * network/file/exec packages (SSRF, file access, arbitrary SQL) are rejected as defense in depth. The
 * PRIMARY control remains a least-privilege account with no EXECUTE on these packages (see the runbook).
 */
const DANGEROUS_PACKAGE_PREFIXES = ["UTL_", "DBMS_", "OWA_"];

function isDangerousPackage(token: string): boolean {
  return DANGEROUS_PACKAGE_PREFIXES.some((p) => token.startsWith(p));
}

export interface SqlPolicyResult {
  allowed: boolean;
  reason?: string;
}

/** Strip comments + single-quoted literals and neutralize double-quoted identifiers. */
export function stripLiteralsAndComments(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (c === "-" && sql[i + 1] === "-") {
      i += 2;
      while (i < n && sql[i] !== "\n") i++;
      out += " ";
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i + 1 < n && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      out += " ";
      continue;
    }
    if (c === "'") {
      i++;
      while (i < n) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      out += " 'x' ";
      continue;
    }
    if (c === '"') {
      i++;
      while (i < n && sql[i] !== '"') i++;
      i++;
      out += " id ";
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export function validateReadOnlySql(rawSql: string | undefined | null): SqlPolicyResult {
  if (!rawSql || !rawSql.trim()) return { allowed: false, reason: "SQL is empty." };

  let stripped = stripLiteralsAndComments(rawSql).trim();
  if (!stripped) return { allowed: false, reason: "SQL contains no executable statement." };

  const semi = stripped.indexOf(";");
  if (semi >= 0) {
    const tail = stripped.slice(semi + 1).trim();
    if (tail) return { allowed: false, reason: "Only a single SELECT statement is allowed; multiple statements were found." };
    stripped = stripped.slice(0, semi).trim();
  }

  const tokens = stripped.split(/[^A-Za-z0-9_$#]+/).filter(Boolean);
  const firstKeyword = tokens[0]?.toUpperCase();
  if (!firstKeyword) return { allowed: false, reason: "SQL contains no executable statement." };
  if (firstKeyword !== "SELECT" && firstKeyword !== "WITH") {
    return { allowed: false, reason: `Only SELECT or WITH … SELECT queries are allowed (found '${firstKeyword}').` };
  }

  // Database links (`table@remote_db`) reach another database; disallow them (the least-privilege
  // account should also lack CREATE DATABASE LINK). `@` cannot survive here except as a link operator
  // because string literals and quoted identifiers were already stripped.
  if (stripped.includes("@")) {
    return { allowed: false, reason: "Database links (@remote) are not allowed in read-only mode." };
  }

  let sawSelect = false;
  for (const t of tokens) {
    const up = t.toUpperCase();
    if (up === "SELECT") sawSelect = true;
    if (FORBIDDEN.has(up)) return { allowed: false, reason: `The keyword '${up}' is not allowed in read-only mode.` };
    if (isDangerousPackage(up)) {
      return { allowed: false, reason: `Calls into the '${up}' package are not allowed in read-only mode.` };
    }
  }
  if (!sawSelect) return { allowed: false, reason: "A read-only query must contain a SELECT." };

  const upper = ` ${stripped.toUpperCase().replace(/\s+/g, " ")} `;
  if (upper.includes(" FOR UPDATE ")) {
    return { allowed: false, reason: "SELECT … FOR UPDATE is not allowed in read-only mode." };
  }
  return { allowed: true };
}
