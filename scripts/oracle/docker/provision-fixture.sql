-- Specter Oracle live-validation provisioning (Phase 04) — DOCKER dev database only.
--
-- Fed to `sqlplus -S -L sys/<admin>@//localhost:1521/FREEPDB1 as sysdba` by
-- scripts/oracle/docker/oracle-docker.mjs (the `fixture` subcommand). The read-only account password
-- placeholder __RO_PASSWORD__ is substituted from $env:SPECTER_ORACLE_RO_PASSWORD at run time — this
-- file contains NO real secret and must never have one committed.
--
-- Two identities (least privilege):
--   SPECTER_FIXTURE  — schema-only owner of the controlled test objects (cannot log in).
--   SPECTER_RO       — the account Specter connects as: CREATE SESSION + SELECT on the fixtures ONLY.
--
-- Idempotent: safe to re-run (objects are dropped/recreated; users are reused).

SET DEFINE OFF
SET SERVEROUTPUT ON
WHENEVER SQLERROR CONTINUE

-- 1) Fixture owner — schema-only account (23ai NO AUTHENTICATION), owns the test objects.
DECLARE
  n NUMBER;
BEGIN
  SELECT COUNT(*) INTO n FROM dba_users WHERE username = 'SPECTER_FIXTURE';
  IF n = 0 THEN
    EXECUTE IMMEDIATE 'CREATE USER SPECTER_FIXTURE NO AUTHENTICATION';
  END IF;
END;
/
ALTER USER SPECTER_FIXTURE QUOTA UNLIMITED ON USERS;

-- 2) Controlled dataset — strings, integers, high-precision NUMBER, BINARY_DOUBLE, boolean-like,
--    DATE, TIMESTAMP, TIMESTAMP WITH TIME ZONE, NULLs, CLOB, unicode, and 50+ rows for truncation.
BEGIN EXECUTE IMMEDIATE 'DROP TABLE SPECTER_FIXTURE.awkit_types_test PURGE'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
CREATE TABLE SPECTER_FIXTURE.awkit_types_test (
  id            NUMBER(10)      NOT NULL,
  name          VARCHAR2(100),
  amount        NUMBER(20, 8),
  ratio         BINARY_DOUBLE,
  is_active     NUMBER(1),
  created_date  DATE,
  created_ts    TIMESTAMP(6),
  created_tstz  TIMESTAMP(6) WITH TIME ZONE,
  notes         CLOB,
  maybe_null    VARCHAR2(50),
  CONSTRAINT awkit_types_test_pk PRIMARY KEY (id)
);

INSERT INTO SPECTER_FIXTURE.awkit_types_test VALUES (1, 'alpha', 12345.67890123, 0.3333333333, 1, DATE '2026-01-15', SYSTIMESTAMP, SYSTIMESTAMP, TO_CLOB('short clob'), NULL);
INSERT INTO SPECTER_FIXTURE.awkit_types_test VALUES (2, 'beta', -0.00000001, 1.5, 0, DATE '2026-02-20', SYSTIMESTAMP, SYSTIMESTAMP, TO_CLOB(RPAD('x', 4000, 'x')), 'present');
INSERT INTO SPECTER_FIXTURE.awkit_types_test VALUES (3, 'gamma', 99999999999.99999999, 2.0, 1, DATE '2026-03-25', SYSTIMESTAMP, SYSTIMESTAMP, NULL, NULL);
INSERT INTO SPECTER_FIXTURE.awkit_types_test VALUES (4, 'delta-unicode-check', 0, 0.0, 0, NULL, NULL, NULL, TO_CLOB('unicode ok'), 'x');
INSERT INTO SPECTER_FIXTURE.awkit_types_test
  SELECT LEVEL + 100, 'row-' || LEVEL, LEVEL, LEVEL / 3, MOD(LEVEL, 2), SYSDATE, SYSTIMESTAMP, SYSTIMESTAMP, NULL, NULL
    FROM dual CONNECT BY LEVEL <= 50;
COMMIT;

-- Valid view with DISTINCT column names (a view may not have duplicate columns — duplicate *aliases*
-- are exercised by a direct query in the live harness, not here).
CREATE OR REPLACE VIEW SPECTER_FIXTURE.v_awkit_types_test AS
  SELECT id, name AS label_name, maybe_null AS label_null, amount, ratio, is_active,
         created_date, created_ts, created_tstz, notes
    FROM SPECTER_FIXTURE.awkit_types_test;

-- 3) Read-only Specter account — least privilege. CREATE SESSION + SELECT on the fixtures only.
DECLARE
  n NUMBER;
BEGIN
  SELECT COUNT(*) INTO n FROM dba_users WHERE username = 'SPECTER_RO';
  IF n = 0 THEN
    EXECUTE IMMEDIATE 'CREATE USER SPECTER_RO IDENTIFIED BY "__RO_PASSWORD__"';
  ELSE
    EXECUTE IMMEDIATE 'ALTER USER SPECTER_RO IDENTIFIED BY "__RO_PASSWORD__"';
  END IF;
END;
/
GRANT CREATE SESSION TO SPECTER_RO;
GRANT SELECT ON SPECTER_FIXTURE.awkit_types_test TO SPECTER_RO;
GRANT SELECT ON SPECTER_FIXTURE.v_awkit_types_test TO SPECTER_RO;

-- Unqualified access for the harness (default table name awkit_types_test).
CREATE OR REPLACE SYNONYM SPECTER_RO.awkit_types_test FOR SPECTER_FIXTURE.awkit_types_test;
CREATE OR REPLACE SYNONYM SPECTER_RO.v_awkit_types_test FOR SPECTER_FIXTURE.v_awkit_types_test;

-- 4) Prove the account is read-only and least-privilege (report only — non-fatal).
PROMPT ---- SPECTER_RO system privileges (expect only CREATE SESSION) ----
SELECT privilege FROM dba_sys_privs WHERE grantee = 'SPECTER_RO' ORDER BY privilege;
PROMPT ---- SPECTER_RO object privileges (expect only SELECT on the two fixtures) ----
SELECT privilege, owner, table_name FROM dba_tab_privs WHERE grantee = 'SPECTER_RO' ORDER BY table_name;
PROMPT ---- Row count (expect 54) ----
SELECT COUNT(*) AS fixture_rows FROM SPECTER_FIXTURE.awkit_types_test;

EXIT
