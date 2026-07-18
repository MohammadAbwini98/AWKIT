-- AWKIT Oracle live-validation fixture — LOCAL Oracle 19c (CDB SID ORCL, PDB ORCLPDB).
--
-- Provisions SPECTER_FIXTURE.AWKIT_TYPES_TEST (the canonical id/name typed dataset the
-- `verify:oracle-live` harness expects) ADDITIVELY, grants read-only SELECT to SPECTER_READER, and
-- creates a private synonym SPECTER_READER.AWKIT_TYPES_TEST *as SYS* (the reader is never granted
-- CREATE SYNONYM). Idempotent (drop+recreate the table; CREATE OR REPLACE the synonym; grant is
-- repeatable). Contains NO credentials — the SPECTER_READER password is set out-of-band.
--
-- Preserves the existing SPECTER_FIXTURE.CUSTOMERS / TYPE_SAMPLES / V_ACTIVE_CUSTOMERS objects
-- (this script never references or drops them).
--
-- Run (from a shell whose ORACLE_HOME points at the 19c home):
--   sqlplus -S -L "/ as sysdba" @scripts/oracle/local-19c-awkit-types-fixture.sql

WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK
WHENEVER OSERROR EXIT 9
SET ECHO OFF VERIFY OFF FEEDBACK OFF SERVEROUTPUT ON

-- `/ as sysdba` lands in CDB$ROOT; switch into the pluggable database.
ALTER SESSION SET CONTAINER = ORCLPDB;

-- Keep the read-only account usable across re-runs (a prior validation cleanup may have locked it;
-- its password is (re)set out-of-band, never in this file).
ALTER USER SPECTER_READER ACCOUNT UNLOCK;

-- Fixture table — idempotent drop (ignore ORA-00942 "does not exist") then recreate.
BEGIN
  EXECUTE IMMEDIATE 'DROP TABLE SPECTER_FIXTURE.AWKIT_TYPES_TEST PURGE';
EXCEPTION WHEN OTHERS THEN
  IF SQLCODE <> -942 THEN RAISE; END IF;
END;
/

CREATE TABLE SPECTER_FIXTURE.AWKIT_TYPES_TEST (
  id            NUMBER(10)   NOT NULL,
  name          VARCHAR2(100),
  amount        NUMBER(20, 8),          -- high-precision numeric
  ratio         BINARY_DOUBLE,
  is_active     NUMBER(1),
  created_date  DATE,
  created_ts    TIMESTAMP(6),
  notes         CLOB,
  maybe_null    VARCHAR2(50),
  CONSTRAINT awkit_types_test_pk PRIMARY KEY (id)
);

-- Four explicit rows exercise strings, high-precision NUMBER, BINARY_DOUBLE, DATE, TIMESTAMP, NULLs,
-- a 4000-char CLOB, and a short CLOB. Then 200 generated rows so the harness truncation test
-- (maxRows=1) and the cancellation test (heavy self-cross-join a,b,c) have ample data.
INSERT INTO SPECTER_FIXTURE.AWKIT_TYPES_TEST VALUES (1, 'alpha', 12345.67890123, 0.3333333333, 1, DATE '2026-01-15', SYSTIMESTAMP, TO_CLOB('short clob'), NULL);
INSERT INTO SPECTER_FIXTURE.AWKIT_TYPES_TEST VALUES (2, 'beta', -0.00000001, 1.5, 0, DATE '2026-02-20', SYSTIMESTAMP, TO_CLOB(RPAD('x', 4000, 'x')), 'present');
INSERT INTO SPECTER_FIXTURE.AWKIT_TYPES_TEST VALUES (3, 'gamma', 99999999999.99999999, 2.0, 1, DATE '2026-03-25', SYSTIMESTAMP, NULL, NULL);
INSERT INTO SPECTER_FIXTURE.AWKIT_TYPES_TEST VALUES (4, 'delta-unicode', 0, 0.0, 0, NULL, NULL, TO_CLOB('unicode ok'), 'x');
INSERT INTO SPECTER_FIXTURE.AWKIT_TYPES_TEST
  SELECT LEVEL + 100, 'row-' || LEVEL, LEVEL, LEVEL / 3, MOD(LEVEL, 2), SYSDATE, SYSTIMESTAMP, NULL, NULL
    FROM dual CONNECT BY LEVEL <= 200;
COMMIT;

-- Least-privilege: SELECT only, on this fixture only.
GRANT SELECT ON SPECTER_FIXTURE.AWKIT_TYPES_TEST TO SPECTER_READER;

-- Private synonym in the reader's own schema so the harness can also resolve an UNQUALIFIED name.
-- Created by SYS/SYSDBA — the reader is NOT granted CREATE SYNONYM.
CREATE OR REPLACE SYNONYM SPECTER_READER.AWKIT_TYPES_TEST FOR SPECTER_FIXTURE.AWKIT_TYPES_TEST;

-- Report (safe; no secrets): expect 204 rows and exactly one SELECT grant on this fixture.
SET FEEDBACK ON
SELECT COUNT(*) AS awkit_types_rows FROM SPECTER_FIXTURE.AWKIT_TYPES_TEST;
SELECT privilege, table_name
  FROM dba_tab_privs
 WHERE grantee = 'SPECTER_READER' AND owner = 'SPECTER_FIXTURE' AND table_name = 'AWKIT_TYPES_TEST'
 ORDER BY privilege;

EXIT 0
