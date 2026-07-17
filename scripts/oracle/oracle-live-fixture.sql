-- AWKIT Oracle live-validation fixture (Phase 05/06).
--
-- Provision ONCE as a privileged/DBA user against an AUTHORIZED, NON-PRODUCTION Oracle database, then
-- GRANT SELECT to the least-privilege read-only account AWKIT connects as (see
-- docs/ai/ORACLE_JDBC_DB_ACCOUNT_RUNBOOK.md). The `verify:oracle-live` harness reads only — it never
-- creates objects. Adjust the schema name to your environment.
--
-- The dataset intentionally exercises: strings, integers, high-precision numbers, dates, timestamps,
-- NULLs, a CLOB, duplicate column aliases, and enough rows to force truncation.

CREATE TABLE awkit_types_test (
  id            NUMBER(10)      NOT NULL,
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

INSERT INTO awkit_types_test VALUES (1, 'alpha',   12345.67890123, 0.3333333333, 1, DATE '2026-01-15', SYSTIMESTAMP, TO_CLOB('short clob'), NULL);
INSERT INTO awkit_types_test VALUES (2, 'beta',    -0.00000001,      1.5,          0, DATE '2026-02-20', SYSTIMESTAMP, TO_CLOB(RPAD('x', 4000, 'x')), 'present');
INSERT INTO awkit_types_test VALUES (3, 'gamma',   99999999999.99999999, 2.0,      1, DATE '2026-03-25', SYSTIMESTAMP, NULL, NULL);
INSERT INTO awkit_types_test VALUES (4, 'δέλτα',   0,                0.0,          0, NULL,               NULL,         TO_CLOB('unicode ✓'), 'x');
-- Enough rows for truncation tests:
INSERT INTO awkit_types_test SELECT LEVEL + 100, 'row-' || LEVEL, LEVEL, LEVEL / 3, MOD(LEVEL, 2), SYSDATE, SYSTIMESTAMP, NULL, NULL
  FROM dual CONNECT BY LEVEL <= 50;
COMMIT;

-- A view that produces DUPLICATE column aliases (both selected as "LABEL") to exercise the mapper.
CREATE OR REPLACE VIEW v_awkit_types_test AS
  SELECT id, name AS label, maybe_null AS label, amount, ratio, is_active, created_date, created_ts, notes
    FROM awkit_types_test;

-- Grant read-only access to the AWKIT account (adjust the account name):
-- GRANT SELECT ON awkit_types_test   TO awkit_ro;
-- GRANT SELECT ON v_awkit_types_test TO awkit_ro;
