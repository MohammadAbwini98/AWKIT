# Oracle Least-Privilege Read-Only Account — Runbook (Phase 04)

AWKIT's SQL tokenizer (mirrored in TypeScript and Java) is **defense in depth**, not the security
boundary. The **primary** protection when connecting AWKIT to a real Oracle Database is a dedicated,
least-privilege, **read-only** database account. This runbook specifies that account. Do not rely on
`Connection.setReadOnly(true)` — it is a hint, not an enforcement mechanism.

## Principles

- Grant **only** `CREATE SESSION` plus read (`SELECT`) on the specific tables/views AWKIT needs.
- **No DML** (INSERT/UPDATE/DELETE/MERGE), **no DDL** (CREATE/ALTER/DROP/TRUNCATE), **no transaction
  control**, **no locking**.
- **No `EXECUTE`** on procedures or packages — especially the network/file/exec packages
  (`UTL_HTTP`, `UTL_TCP`, `UTL_SMTP`, `UTL_FILE`, `UTL_INADDR`, `DBMS_LOB`, `DBMS_SQL`,
  `DBMS_SCHEDULER`, `DBMS_XMLGEN`, `OWA_*`). AWKIT's policy also rejects these by name, but the account
  must not hold the privilege regardless.
- **No `CREATE DATABASE LINK`** and no access to existing links. AWKIT rejects `@dblink` syntax; the
  account should also lack the capability.
- Restrict outbound network ACLs (`DBMS_NETWORK_ACL_ADMIN`) so the account cannot reach the network
  even if a package call slipped through.
- Apply a resource **profile** (session/CPU/idle limits) and enable **auditing** on the account.
- Prefer granting read access via **views** that expose only the needed columns/rows, not base tables.

## Provisioning (adapt to your environment; run as a DBA)

```sql
-- 1) Dedicated account, password managed by your secrets process (never stored in AWKIT config).
CREATE USER awkit_ro IDENTIFIED BY "<managed-secret>"
  DEFAULT TABLESPACE users
  TEMPORARY TABLESPACE temp
  PROFILE awkit_ro_profile
  ACCOUNT UNLOCK;

-- 2) The ONLY system privilege required.
GRANT CREATE SESSION TO awkit_ro;

-- 3) Read access to the approved objects ONLY (prefer purpose-built views).
GRANT SELECT ON reporting.v_orders_readonly   TO awkit_ro;
GRANT SELECT ON reporting.v_customers_readonly TO awkit_ro;
-- (repeat per approved view; do NOT grant ANY-table privileges)

-- 4) Resource limits.
CREATE PROFILE awkit_ro_profile LIMIT
  SESSIONS_PER_USER      5
  CPU_PER_CALL           60000     -- 1e-2s units; tune to your workload
  IDLE_TIME              15
  CONNECT_TIME           120
  FAILED_LOGIN_ATTEMPTS  5
  PASSWORD_LIFE_TIME     90;

-- 5) Audit the account.
AUDIT ALL STATEMENTS BY awkit_ro;   -- or a unified audit policy scoped to awkit_ro
```

## Explicitly NOT granted

`DBA`, `RESOURCE`, `SELECT ANY TABLE`, `EXECUTE ANY PROCEDURE`, `CREATE PROCEDURE`,
`CREATE DATABASE LINK`, `ALTER SYSTEM/SESSION`, any `EXECUTE` on `UTL_*`/`DBMS_*`/`OWA_*`, and any
network ACL that would let the account originate connections.

## Verification checklist (run as the `awkit_ro` account)

- [ ] `SELECT` on an approved view returns rows.
- [ ] `SELECT` on a non-approved table raises `ORA-00942` (table or view does not exist).
- [ ] `INSERT`/`UPDATE`/`DELETE` on any object raises `ORA-01031`/`ORA-00942` (no privilege).
- [ ] `BEGIN NULL; END;` / `EXEC` any package raises a privilege/identifier error.
- [ ] `SELECT UTL_HTTP.REQUEST('http://…') FROM dual` fails at the **database** (no EXECUTE), in
      addition to being rejected by AWKIT's SQL policy.
- [ ] A `@dblink` query fails at the database (no link/privilege), in addition to AWKIT's rejection.
- [ ] The resource profile caps sessions and idle time.

## How AWKIT enforces the matching application-layer policy

`src/oracle/OracleSqlPolicy.ts` (renderer/main pre-check) and
`oracle-jdbc-bridge/.../sql/SqlReadOnlyPolicy.java` (authoritative, re-validated in the bridge) reject
non-SELECT statements, multiple statements, `SELECT … FOR UPDATE`, PL/SQL (`BEGIN`/`DECLARE`/`CALL`/
`EXEC`), inline PL/SQL (`WITH FUNCTION`/`WITH PROCEDURE`), database links (`@remote`), and calls into
`UTL_*`/`DBMS_*`/`OWA_*` packages. `npm run verify:oracle-sql-policy` proves the two engines reach
identical decisions across an adversarial corpus. This is layered **on top of** — never instead of —
the least-privilege account above.
