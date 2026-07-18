# Oracle JDBC — Validation Gates (user-selected Java + direct JDBC, no UCP)

**Model:** Specter does **not** bundle Java or UCP. The user selects a Java runtime and imports an Oracle
JDBC driver in **Settings → Database Drivers**; Oracle runs through the isolated bridge via **direct JDBC**
(one connection per query, no pool). This document tracks the validation gates for that model.

**Release status: PRODUCTION-CANDIDATE.** All locally-runnable gates pass. The only remaining gates are the
packaged-EXE build + clean-machine walkthrough (the dev host OOMs on `electron-builder`) and sustained
real-world soak beyond the 30-minute harness — both **external**, documented below, not run here.

## Gate status

| Gate | What it proves | Status |
|---|---|---|
| **Build + full verifier suite** | tsc + bundles clean; every `verify:oracle-*` green, no weakened assertions | ✅ **Cleared** — build clean; 13 non-GUI Oracle verifiers **350/350** |
| **Direct-JDBC concurrency/cancellation** | limiter bound, slot release on all outcomes, prompt cancellation, teardown invariants, no secrets in telemetry | ✅ **Cleared** — `verify:oracle-direct-jdbc` **23/23** (mock bridge) |
| **Java runtime Settings** | add/validate/set-default/bridge-test/remove; `java -version` parse; compatibility | ✅ **Cleared** — `verify:oracle-java-runtime` **48/48** |
| **Authorized real Oracle functional matrix** | connect, prepared binds, truncation, type conversion, read-only policy block, permission error, **cancellation** — all via the Settings Java+driver path | ✅ **Cleared** — `verify:oracle-live` **7/7** real mode vs local Oracle 19c |
| **Settings GUI walkthrough** | both Database Drivers cards render; metadata; validate; **real bridge launch + real ojdbc load**; deletion guard; no secrets; reduced-motion; 0 console errors | ✅ **Cleared** — `verify:oracle-drivers-gui` **30/30** (real Electron) |
| **Packaging (offline, selection model)** | only the bridge jar is bundled; JRE/driver rejected if present; checksums enforced; app starts without Java | ✅ **Cleared** — `verify:oracle-packaging` **23/23**, `verify:oracle-offline-bundle` **11/11**, `verify:oracle-runtime-prep` **14/14**, `validate:offline` clean |
| **Regression (cross-cutting)** | IPC surface, settings schema, profile store, secrets, data sources, concurrency, cancellation unaffected | ✅ **Cleared** — ipc-contract 4/4, settings-persistence 3/3, profile-store 13/13, secrets 16/16, data-editor 27/27, concurrency 78/78, cancellation 12/12 |
| **Performance / soak (≥30 min)** | sustained bounded-concurrency load; query P50/P95; cancellation latency; bridge+Node RSS flat (no leak); teardown invariants; **no pool metrics** | ✅ **Cleared** — `benchmark:oracle-jdbc` 30-min live run; artifact `reports/oracle-validation/oracle-soak.json` (see the epic report) |
| **Packaged EXE + clean-machine walkthrough** | portable/NSIS build; app starts without Java; user configures Java+driver → real query; migration/restart persistence | ⛔ **External** — `electron-builder` OOMs on this 16 GB dev host |
| **Sustained real-world soak** | days-long production-style load | ⛔ **External** — beyond the 30-min harness |

## Live functional matrix — how to reproduce

1. Provision the fixture on an **authorized, non-production** DB and grant least-privilege SELECT to the
   reader (see [`ORACLE_JDBC_DB_ACCOUNT_RUNBOOK.md`](ORACLE_JDBC_DB_ACCOUNT_RUNBOOK.md);
   [`scripts/oracle/local-19c-awkit-types-fixture.sql`](../../scripts/oracle/local-19c-awkit-types-fixture.sql)
   provisions `SPECTER_FIXTURE.AWKIT_TYPES_TEST`, 204 rows, + a private synonym for the reader).
2. Add the Java runtime + import the ojdbc driver in Settings (dev tools:
   [`scripts/oracle/add-java-runtime.mts`](../../scripts/oracle/add-java-runtime.mts),
   [`scripts/oracle/import-driver-bundle.mts`](../../scripts/oracle/import-driver-bundle.mts)).
3. Export the live env and run the harness through the **Settings-managed** stores:

   ```text
   AWKIT_ORACLE_LIVE_URL / _USER / _PASSWORD
   AWKIT_ORACLE_LIVE_CONFIRM_NONPROD=1
   AWKIT_ORACLE_LIVE_TEST_TABLE=SPECTER_FIXTURE.AWKIT_TYPES_TEST
   AWKIT_ORACLE_LIVE_DRIVER_BUNDLE_ID=<Settings bundle id>
   AWKIT_ORACLE_LIVE_JAVA_RUNTIME_PROFILE_ID=<Settings Java runtime id>
   npm run verify:oracle-live      # 7/7; redacted reports/oracle-validation/oracle-live.json
   ```

The password is supplied out-of-band (never printed). Retire the credential afterward (rotate + `ACCOUNT
LOCK`). The harness **requires real mode** and never falls back to the mock.

## Soak — how to reproduce

Same env as the live matrix, then `npm run benchmark:oracle-jdbc` (defaults: 30 min, limiter=4, offered
load=8 drivers; tunable via `AWKIT_ORACLE_SOAK_MINUTES` / `_CONCURRENCY` / `_DRIVERS`). With no live config
it falls back to the database-free mock bridge (still proves the Specter-side lifecycle/leak invariants).
Redacted artifact: `reports/oracle-validation/oracle-soak.json`.

## Packaged EXE + clean-machine walkthrough (external gate)

On a clean Windows x64 box (no system Java, no dev deps, no dev env vars): build portable + NSIS after
`prepare:oracle-runtime`, then verify:
- **Oracle unused / non-Oracle workflow** → app starts, bridge never spawned, no Java required.
- **Snapshot offline** → stored rows resolve with no DB connectivity and no Java.
- **Runtime not configured** → Oracle live queries show the "Settings → Database Drivers" config error; no
  mock results (fail closed). Setting `AWKIT_ORACLE_BRIDGE_MOCK=1` is ignored in packaged mode.
- **User configures Java + driver** → real handshake + real query succeed; all Oracle node outputs work.
- **Migration/restart** → profiles, snapshots, history, secret refs, Java/driver selections persist.

Shutdown invariants: `pending bridge requests = 0`, `active JDBC requests = 0`, `orphan Java processes = 0`
(no pool/borrowed-connection invariants — there is no pool).
