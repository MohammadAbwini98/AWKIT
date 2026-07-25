-- AWKIT Oracle mock-UI fixture — LOCAL Oracle 19c (CDB SID ORCL, PDB ORCLPDB).
--
-- Provisions the SPECTER_MOCKUI schema and SPECTER_MOCKUI.MOCK_FORM_CASES: a dataset whose columns map
-- 1:1 onto the Feature Test Lab form at http://localhost:4321/form, so an Oracle Data Source node can
-- drive a real UI workflow end to end (SELECT -> fill form -> assert /success).
--
-- This is deliberately NOT a second copy of SPECTER_FIXTURE.AWKIT_TYPES_TEST. That fixture proves JDBC
-- *type conversion*; this one proves the Oracle node can *drive the UI*, including the awkward mappings:
-- NULL -> leave the input blank, NUMBER(1) -> checkbox state, DATE -> a `type=date` value, and a
-- comma-separated list -> a multi-select.
--
-- Every value is a literal — no SYSDATE/SYSTIMESTAMP — so the rows are byte-identical on every run and
-- identical to the database-free fixture served by MockQueryExecutor. `verify:oracle-mock-ui` asserts
-- that parity, so a workflow behaves the same with or without a database.
--
-- Identities (least privilege, matching the existing local-19c fixture):
--   SPECTER_MOCKUI  — schema-only owner of the mock-UI objects (cannot log in).
--   SPECTER_READER  — the account AWKIT connects as; granted SELECT on this fixture only.
--
-- Idempotent: the table is dropped/recreated, the user is reused, the grant and synonym are repeatable.
-- Contains NO credentials — the SPECTER_READER password is set out-of-band.
--
-- Run (from a shell whose ORACLE_HOME points at the 19c home; PowerShell, not Git Bash — Bash mangles
-- the `/ as sysdba` argument):
--   sqlplus -S -L "/ as sysdba" @scripts/oracle/local-19c-mock-ui-fixture.sql

WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK
WHENEVER OSERROR EXIT 9
SET ECHO OFF VERIFY OFF FEEDBACK OFF SERVEROUTPUT ON

-- `/ as sysdba` lands in CDB$ROOT; switch into the pluggable database.
ALTER SESSION SET CONTAINER = ORCLPDB;

-- Keep the read-only account usable across re-runs (a prior validation cleanup may have locked it;
-- its password is (re)set out-of-band, never in this file).
ALTER USER SPECTER_READER ACCOUNT UNLOCK;

-- 1) Schema-only owner. NO AUTHENTICATION means the schema can own objects but nobody can log in as it.
DECLARE
  n NUMBER;
BEGIN
  SELECT COUNT(*) INTO n FROM dba_users WHERE username = 'SPECTER_MOCKUI';
  IF n = 0 THEN
    EXECUTE IMMEDIATE 'CREATE USER SPECTER_MOCKUI NO AUTHENTICATION';
  END IF;
END;
/
ALTER USER SPECTER_MOCKUI QUOTA UNLIMITED ON USERS;

-- 2) Fixture table — idempotent drop (ignore ORA-00942 "does not exist") then recreate.
BEGIN
  EXECUTE IMMEDIATE 'DROP TABLE SPECTER_MOCKUI.MOCK_FORM_CASES PURGE';
EXCEPTION WHEN OTHERS THEN
  IF SQLCODE <> -942 THEN RAISE; END IF;
END;
/

-- Column -> /form control mapping (the whole point of this fixture):
--   FIRST_NAME           -> #firstName            (text, required by the page)
--   LAST_NAME            -> #lastName             (text, nullable -> leave blank)
--   EMAIL                -> #email                (email, nullable -> leave blank)
--   AGE                  -> #age                  (number)
--   SALARY               -> #salary               (number, step 0.01)
--   BIRTH_DATE           -> #birthDate            (date, nullable -> leave blank)
--   COUNTRY              -> #country              (select: JO | SA | AE | US)
--   ACCOUNT_TYPE         -> #accountType          (select: PERSONAL | BUSINESS | CORPORATE)
--   SKILLS               -> #skills               (MULTI-select, comma-separated: playwright|typescript|testing)
--   DESCRIPTION          -> #description          (textarea)
--   GENDER               -> #genderMale/#genderFemale (radio: MALE | FEMALE; NULL -> select neither)
--   INTEREST_AUTOMATION  -> #interestAutomation   (checkbox; 1 = checked)
--   INTEREST_TESTING     -> #interestTesting      (checkbox; 1 = checked)
--   ACCEPT_TERMS         -> #acceptTerms          (checkbox; 1 = checked)
--   EXPECTED_OUTCOME     -> the assertion the workflow should make after submit
CREATE TABLE SPECTER_MOCKUI.MOCK_FORM_CASES (
  case_id              NUMBER(10)    NOT NULL,
  case_label           VARCHAR2(60)  NOT NULL,
  first_name           VARCHAR2(60)  NOT NULL,
  last_name            VARCHAR2(60),
  email                VARCHAR2(120),
  age                  NUMBER(3),
  salary               NUMBER(12, 2),
  birth_date           DATE,
  country              VARCHAR2(2),
  account_type         VARCHAR2(20),
  skills               VARCHAR2(100),
  description          VARCHAR2(400),
  gender               VARCHAR2(10),
  interest_automation  NUMBER(1),
  interest_testing     NUMBER(1),
  accept_terms         NUMBER(1),
  expected_outcome     VARCHAR2(20)  NOT NULL,
  CONSTRAINT mock_form_cases_pk PRIMARY KEY (case_id)
);

-- 8 deterministic cases. Each one exists to break a *different* naive mapping.
--  1 happy path: every control set, all three skills, both interests.
--  2 nullable text: LAST_NAME/EMAIL NULL must leave the inputs blank, not type "null".
--  3 decimals + boundary age: salary must keep 2dp; age 18 is the lower boundary.
--  4 NULL date + NULL gender: no date typed, neither radio selected.
--  5 unicode + apostrophe: proves escaping through the bridge and into the DOM.
--  6 single skill: a multi-select must end up with exactly one option chosen, not all.
--  7 unchecked interests: 0 must UNCHECK, not "leave as-is" (the trap when reusing a dirty page).
--  8 terms declined: ACCEPT_TERMS = 0 is the negative path — submit must NOT reach /success.
INSERT INTO SPECTER_MOCKUI.MOCK_FORM_CASES VALUES (1, 'happy-path-all-fields', 'Amina', 'Haddad', 'amina.haddad@example.test', 34, 82500.50, DATE '1992-04-17', 'JO', 'BUSINESS', 'playwright,typescript,testing', 'Every control populated; the baseline data-driven case.', 'FEMALE', 1, 1, 1, 'SUCCESS');
INSERT INTO SPECTER_MOCKUI.MOCK_FORM_CASES VALUES (2, 'null-optional-text', 'Omar', NULL, NULL, 41, 64000.00, DATE '1985-11-02', 'AE', 'PERSONAL', 'typescript', 'Optional text is NULL and must leave the input empty.', 'MALE', 0, 1, 1, 'SUCCESS');
INSERT INTO SPECTER_MOCKUI.MOCK_FORM_CASES VALUES (3, 'decimal-and-age-boundary', 'Lina', 'Nasser', 'lina.nasser@example.test', 18, 1234.56, DATE '2008-01-01', 'SA', 'PERSONAL', 'testing', 'Two-decimal salary and the lower age boundary.', 'FEMALE', 1, 0, 1, 'SUCCESS');
INSERT INTO SPECTER_MOCKUI.MOCK_FORM_CASES VALUES (4, 'null-date-and-gender', 'Yousef', 'Khalil', 'yousef.khalil@example.test', 29, 55000.00, NULL, 'US', 'CORPORATE', 'playwright,testing', 'NULL date and NULL gender: no date typed, no radio selected.', NULL, 1, 1, 1, 'SUCCESS');
INSERT INTO SPECTER_MOCKUI.MOCK_FORM_CASES VALUES (5, 'unicode-and-apostrophe', 'Zaid', 'O''Brien-Saleh', 'zaid.obrien@example.test', 37, 71250.75, DATE '1989-06-30', 'JO', 'BUSINESS', 'playwright', 'Apostrophe and hyphen in the surname must survive the bridge.', 'MALE', 0, 0, 1, 'SUCCESS');
INSERT INTO SPECTER_MOCKUI.MOCK_FORM_CASES VALUES (6, 'single-skill-multiselect', 'Rana', 'Darwish', 'rana.darwish@example.test', 26, 48900.25, DATE '2000-09-12', 'SA', 'PERSONAL', 'testing', 'Exactly one option chosen in a multi-select.', 'FEMALE', 0, 1, 1, 'SUCCESS');
INSERT INTO SPECTER_MOCKUI.MOCK_FORM_CASES VALUES (7, 'interests-unchecked', 'Faris', 'Mansour', 'faris.mansour@example.test', 52, 98000.00, DATE '1974-02-08', 'AE', 'CORPORATE', 'typescript,testing', 'Both interests are 0 and must end UNCHECKED on a reused page.', 'MALE', 0, 0, 1, 'SUCCESS');
INSERT INTO SPECTER_MOCKUI.MOCK_FORM_CASES VALUES (8, 'terms-declined-negative', 'Huda', 'Barakat', 'huda.barakat@example.test', 31, 60500.00, DATE '1995-03-21', 'US', 'PERSONAL', 'playwright,typescript', 'Terms declined: the negative path, submit must not reach /success.', 'FEMALE', 1, 1, 0, 'BLOCKED');
COMMIT;

-- 3) Least privilege: SELECT only, on this fixture only.
GRANT SELECT ON SPECTER_MOCKUI.MOCK_FORM_CASES TO SPECTER_READER;

-- Private synonym in the reader's own schema so a workflow can also use the UNQUALIFIED name.
-- Created by SYS/SYSDBA — the reader is NOT granted CREATE SYNONYM.
CREATE OR REPLACE SYNONYM SPECTER_READER.MOCK_FORM_CASES FOR SPECTER_MOCKUI.MOCK_FORM_CASES;

-- 4) Report (safe; no secrets): expect 8 rows, 7 SUCCESS + 1 BLOCKED, and one SELECT grant.
SET FEEDBACK ON
SELECT COUNT(*) AS mock_form_rows FROM SPECTER_MOCKUI.MOCK_FORM_CASES;
SELECT expected_outcome, COUNT(*) AS cases
  FROM SPECTER_MOCKUI.MOCK_FORM_CASES
 GROUP BY expected_outcome
 ORDER BY expected_outcome;
SELECT privilege, table_name
  FROM dba_tab_privs
 WHERE grantee = 'SPECTER_READER' AND owner = 'SPECTER_MOCKUI' AND table_name = 'MOCK_FORM_CASES'
 ORDER BY privilege;

EXIT 0
