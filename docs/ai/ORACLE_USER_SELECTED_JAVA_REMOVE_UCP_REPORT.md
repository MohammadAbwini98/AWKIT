# Oracle: User-Selected Java Runtime + Direct JDBC (remove UCP) — Final Report

**Epic:** `awkit-kzo` · **Branch:** `feature/oracle-jdbc-driver-settings` · **Date:** 2026-07-18
**Status:** **PRODUCTION-CANDIDATE** (external gates: packaged-EXE build + clean-machine walkthrough; sustained real-world soak)

---

## 1. Executive summary

Specter's Oracle integration no longer assumes a bundled Java runtime or a Universal Connection Pool. The
Java runtime and the Oracle JDBC driver are now **user-selected in Settings → Database Drivers**; Oracle
runs through Specter's isolated bridge via **direct JDBC** — one connection opened and closed per query, no
pool. **UCP is removed entirely.** Specter stays fully usable with no Java configured (non-Oracle workflows,
JSON sources, and Oracle Snapshot Data Sources need no Java). All locally-runnable gates pass, including a
real Oracle 19c functional matrix (7/7), a real-Electron Settings walkthrough (30/30), and a ≥30-minute
direct-JDBC soak. Only the packaged-EXE build (the dev host OOMs on `electron-builder`) and a days-long soak
remain external.

## 2. Scope & motivation

Two production problems in the previous design were removed:
1. **Java was assumed bundled** (a private jlink'd JRE under `resources/oracle-jdbc/runtime/`) or auto-detected
   from hardcoded JDK paths / `JAVA_HOME` / `PATH`. That JRE was never vendored, packaging OOMs, and
   auto-detection is brittle and unsafe in production.
2. **UCP was a first-class but unusable path** — the real pooled executor existed, but no `ucp*.jar` was
   vendored, its APIs were unverified, and it complicated the classpath/telemetry.

Target model: `Settings → selected java.exe → isolated bridge → imported ojdbc*.jar → Oracle`.

## 3. Design decisions (D1–D10)

- **D1 — Remove UCP completely.** Delete `OracleUcpQueryExecutor.java`, the UCP selection branch, the pom
  dep, and UCP compile wiring. Importing a `ucp*.jar` is rejected. Companion jars (oraclepki, osdt_*, ons,
  simplefan) stay for wallet/TCPS. No dormant UCP path remains.
- **D2 — Single direct-JDBC executor.** `Main.selectExecutor()`: `forceMock→Mock`;
  `driverPresent→OracleJdbcQueryExecutor`; `requireReal→DriverUnavailableExecutor`; else `Mock`.
- **D3 — Strip UCP telemetry from the wire** (`ucpVersion` from hello/probe/bundle/UI). `closePool` kept as a
  documented no-op for protocol compatibility (connections are already per-query).
- **D4 — New `JavaRuntimeProfile` + `JavaRuntimeStore`** under `<runtime>/java-runtimes/`. Validation spawns
  the selected `java -version` directly (no shell) and load-tests a real bridge handshake.
- **D5 — Resolver uses selection, never bundling/scan.** Java comes from the Settings selection (dev-only
  `AWKIT_ORACLE_BRIDGE_JDK_HOME` fallback, unpackaged only). No bundled JRE, no `JAVA_HOME`/`PATH`, no
  production auto-scan. Missing selection ⇒ `available:false`, `ORACLE_RUNTIME_NOT_CONFIGURED`.
- **D6 — Profile schema migration.** Drop `pool`/`OraclePoolSettings`; add `javaRuntimeProfileId`.
  `normalizeOracleProfile` drops legacy `pool`; deterministic default resolution.
- **D7 — Compatibility key gains Java identity** (`{javaRuntimeProfileId, driverBundleId, protocolVersion,
  walletMode}`) so different Java/JDBC combos get separate bridge processes.
- **D8 — `ORACLE_RUNTIME_NOT_CONFIGURED`** category (Java + TS) with a "Settings → Database Drivers" message.
- **D9 — Manual Java selection only** (`java.exe` or a JRE/JDK dir → resolve `bin/java.exe`).
- **D10 — Settings grouped under "Database Drivers"**: "Java Runtime for Database Drivers" + "Oracle JDBC Drivers".

## 4. Architecture (selection model)

`Settings (JavaRuntimeStore + OracleDriverBundleStore) → OracleRuntimeResolver → OracleJdbcBridgeManager
(spawns selected java.exe with bridge jar + selected ojdbc on the classpath) → OracleQueryService (read-only
policy, bounded limiter, per-query connection) → Oracle`. The only bundled Oracle artifact is Specter's own
bridge jar. IPC namespaces: `oracle:java:*` (runtime store) + `oracle:drivers:*` (driver store).

## 5. WS-A — Remove UCP + direct-JDBC lifecycle

Deleted `OracleUcpQueryExecutor.java`; `Main`/`Dispatcher`/`QueryExecutor`/`Protocol` drop UCP; `pom.xml` +
`build-oracle-bridge.mjs` drop the ucp dep/classpath (bridge compiles **pure JDK — "0 optional compile
jar(s)"**). TS: `OracleDriverBundle`/`OracleDriverBundleStore` reject ucp jars and drop
`ucpJar`/`ucpVersion`/`supportsPooling`; `OracleConnectionProfile` drops `pool`; `OracleBridgeProtocol`
drops `ucpVersion`; `oracleService` + `OracleDriverSettings.tsx` cleaned. **Done + verified.**

## 6. WS-B — Java Runtime Settings + bundles + compatibility

New `src/oracle/JavaRuntimeProfile.ts` + `JavaRuntimeStore.ts` (managed store, default selection, usage
count) under a new `java-runtimes/` runtime folder. `java -version` parse (version/major/vendor/arch).
Java⇄JDBC compatibility (required major from ojdbc filename + class-file version + bridge load test). IPC
`oracle:java:*` + preload `oracle.java` + `JavaRuntimeSettings.tsx`, grouped under "Database Drivers".
`verify:oracle-java-runtime` **48/48**. **Done + verified.**

## 7. WS-C — Resolver + profile integration + safe-unavailable

`OracleRuntimeResolver` rewritten to selection-only (D5). Compatibility key folds `javaRuntimeProfileId`
(D7). `ORACLE_RUNTIME_NOT_CONFIGURED` (D8) with the Settings message. Non-Oracle workflows + JSON + Oracle
Snapshot sources work with no Java; Runtime sources fail safe (no crash, no mock fallback in packaged).
`verify:oracle-packaging` **23/23**. **Done + verified.**

## 8. WS-D — Live verifier + direct-JDBC concurrency/cancellation

`verify-oracle-live.mts` resolves BOTH the Java runtime profile and the driver bundle through the
Settings-managed stores, asserts real mode + compatibility before running, UCP references removed. New
`verify-oracle-direct-jdbc.mts` proves the lifecycle invariants on the mock bridge: limiter never exceeds
max, every outcome (success/fail/timeout/cancel/reject) releases the slot, prompt cancellation with no late
result, teardown invariants (pending = 0, orphan Java = 0), no secrets/SQL/rows in telemetry —
**23/23**. Live run **7/7** (see §14). Cancellation on the live DB uses a per-row concat+LIKE over a ~8.5M-row
3-way cross join so Oracle cannot cardinality-shortcut it (deterministic `CANCELLED`). **Done + verified.**

## 9. WS-E — Settings GUI walkthrough (real Electron)

New `scripts/verify-oracle-drivers-gui.mjs` (`verify:oracle-drivers-gui`) drives the real app via Playwright's
`_electron` launcher (non-destructive; resolves the main window past the branding splash). **30/30**: both
cards render (headings, hints, security warnings, badges); Java runtime (`Local JDK 17`, Valid, 17.0.8, x64,
Default) + bundle (`Oracle ojdbc17 (local 19c validation)`, Valid, JDBC 23.26.2.0.0, Default) metadata
correct; `validate` valid; `availability` available; **`testBridge` launches the isolated bridge with the
selected Java and loads the REAL ojdbc 23.26.2.0.0** (+ `drivers.testLoad`); deletion guard (referencing
profile ⇒ usage +1 + disabled remove, drop ⇒ restored); no secrets in projections/DOM; no horizontal
overflow; reduced-motion; **0 console errors**. Screenshots: `reports/oracle-validation/database-drivers-*.png`.
**Done + verified.**

## 10. WS-F — Packaging cleanup

Selection model: only the bridge jar is bundled. `oracle-runtime.manifest.json` + `prepare-oracle-runtime.mjs`
stage the bridge jar only (no JRE/driver/license/out-of-band source dir). `OracleOfflineBundle.ts` +
`validate-offline-bundle.ps1` now **reject** a bundled private JRE or driver jar (the inverse of the old
"driver required" gate) and enforce checksums. `.gitignore` consolidated to ignore the whole generated
`resources/oracle-jdbc/`. Real `prepare:oracle-runtime → validate:offline` loop green (bridge-only, "0
optional compile jar(s)"). `verify:oracle-runtime-prep` **14/14**, `verify:oracle-offline-bundle` **11/11**
(incl. the real staged bundle), `verify:oracle-packaging` **23/23**. `electron-builder.json` unchanged (its
generic `resources/**` copy carries the bridge jar; the private JRE simply no longer exists). **Done + verified.**

## 11. WS-G — Regression

Build clean (tsc + bundles). Oracle suite (13 non-GUI verifiers): **350/350, 0 failed** — bridge 32,
bridge-real-build 16, sql-policy 30, driver-bundle 47, profiles 22, data-source 28, runtime 36, runtime-prep
14, lazy-resolution 20, offline-bundle 11, packaging 23, java-runtime 48, direct-jdbc 23 (+ live 7 + GUI 30).
Cross-cutting: ipc-contract 4/4, settings-persistence 3/3, profile-store 13/13, secrets 16/16, data-editor
27/27, concurrency 78/78, cancellation 12/12. One failure found — `verify:settings-persistence` — was a
**pre-existing branding-splash regression** (`app.firstWindow()` grabs the splash, which has no preload
bridge), **not** an Oracle defect; fixed at its `launch()` helper and filed as a bd bug for the other
`firstWindow()`-based GUI verifiers. **Done + verified.**

## 12. WS-H — Soak (≥30 min)

New `scripts/benchmark-oracle-jdbc.mts` (`benchmark:oracle-jdbc`) drives the **live** Java-runtime+bundle
direct-JDBC path (real ojdbc 23.26.2.0.0 + Java 17.0.8 against Oracle 19c) through the app's
`OracleQueryService` limiter for a full **30.01 minutes** and asserts the lifecycle invariants. Result:
**9/9 invariants passed, 0 failed** (`reports/oracle-validation/oracle-soak.json`).

| Metric | Value |
|---|---|
| Throughput | **61,259 queries**, ~34/s (limiter=4, offered load=8 drivers) |
| Query latency (end-to-end incl. queue+connect) | P50 **239 ms**, P95 309 ms, P99 437 ms, max 2926 ms |
| DB query time (bridge-reported) | P50 117 ms, P95 152 ms |
| Cancellation | **58/58 CANCELLED** (0 not-cancelled), latency P50 256 ms / P95 264 ms |
| Node (Specter) RSS | 49 → 23 MB, **drift −26 MB** over 29 samples (sawtooths with GC — no leak) |
| Bridge (Java) RSS | 244 → 175 MB, **drift −69 MB** over 29 samples (no leak) |
| Unexpected failures | **0** (service metrics: 61,259 successes / 0 failures / 0 timeouts / 0 retries) |
| Teardown | pending bridge requests **0**, orphan Java **0** (bridge stopped) |
| Pool metrics | **none** (connections are per-query) |

Both RSS drifts are **negative** — memory ended lower than it started, confirming no connection/handle/memory
leak under sustained load. Latency stayed flat across the whole run (P50 held at ~232–239 ms from minute 1 to
minute 30).

## 13. WS-I — Docs

Updated `CURRENT_STATE.md`, `TASK_LOG.md`, `COMMANDS.md`, `ORACLE_JDBC_RUNTIME_MATRIX.md` (now the
selection-model compatibility/setup doc), `ORACLE_JDBC_VALIDATION_GATES.md` (cleared gates), and this report.
Deleted the obsolete `ORACLE_LIVE_VALIDATION_RESUME.md` (Docker path, superseded). Every doc states plainly:
**Specter does not bundle Java or UCP.**

## 14. Live validation results (real Oracle 19c)

`verify:oracle-live` **7/7 real mode** via the Settings path — Java runtime `Local-JDK-17` (Java 17.0.8, x64)
+ bundle `Oracle-ojdbc17-local-19c-validation` (ojdbc17 23.26.2.0.0, direct JDBC, no UCP) against
`jdbc:oracle:thin:@//localhost:1521/ORCLPDB` as least-privilege `SPECTER_READER`:
`testConnection`, `select-small [rows=3]`, `truncation [truncated=true]`, `type-conversion [columns=9]`,
`policy-blocks-dml (SQL_POLICY_VIOLATION)`, `permission-or-missing-object (DRIVER_ERROR)`,
`cancellation (CANCELLED)`. Bridge `executionMode=real`. Redacted artifact
`reports/oracle-validation/oracle-live.json` (no credentials/binds/rows). The ephemeral `SPECTER_READER`
credential was provisioned out-of-band (never printed) and retired (rotate + `ACCOUNT LOCK`) afterward.

## 15. Verification summary

| Command | Result |
|---|---|
| `npm run build` (tsc + bundles) | clean |
| `verify:oracle-{bridge,bridge-real-build,sql-policy,driver-bundle,profiles,data-source,runtime,runtime-prep,lazy-resolution,offline-bundle,packaging,java-runtime,direct-jdbc}` | **350/350** |
| `verify:oracle-live` (real 19c) | **7/7** |
| `verify:oracle-drivers-gui` (real Electron) | **30/30** |
| `benchmark:oracle-jdbc` (≥30 min live soak) | see §12 |
| `validate:offline` | clean (bridge-only bundle) |
| cross-cutting regression | all green (see §11) |

## 16. Security & redaction posture

External Java runs with the user's own permissions (Settings shows the warning). The renderer never loads
Java classes or JAR bytes — the main process copies/hashes/load-tests. Live + soak artifacts are redacted
(no credentials, binds, row content, or SQL text; only counts/durations/categories). Read-only SQL policy
enforced in TS and re-validated in Java. Wallets/secrets never bundled; the offline validator flags any
`.env/.pem/.p12/.sso/.jks/.key`, `tnsnames.ora`, or `sqlnet.ora` in the bundle.

## 17. Files changed (high level)

Java bridge: `OracleUcpQueryExecutor.java` (deleted), `Main`, `Dispatcher`, `QueryExecutor`,
`DriverUnavailableExecutor`, `MockQueryExecutor`, `Protocol`, `pom.xml`. TS core: `OracleRuntimeResolver`,
`OracleConnectionProfile`, `OracleDriverBundle(+Store)`, `OracleBridgeProtocol`, `OracleProfileService`,
`OracleOfflineBundle`, `OracleBundleChecksums`, `JavaRuntimeProfile` + `JavaRuntimeStore` (new),
`PortablePathResolver`. Main/IPC/renderer: `oracle.ipc.ts`, `preload.ts`, `JavaRuntimeSettings.tsx` (new),
`OracleDriverSettings.tsx`, `Settings.tsx`, `OracleNodeSection.tsx`, `global.css`. Scripts: new
`verify-oracle-direct-jdbc.mts`, `verify-oracle-java-runtime.mts`, `verify-oracle-drivers-gui.mjs`,
`benchmark-oracle-jdbc.mts`, `oracle/add-java-runtime.mts`, `oracle/import-driver-bundle.mts`; rewritten
`prepare-oracle-runtime.mjs`, `oracle-runtime.manifest.json`, `verify-oracle-runtime-prep.mts`,
`verify-oracle-offline-bundle.mts`, `verify-oracle-packaging.mts`, `verify-oracle-live.mts`,
`validate-offline-bundle.ps1`; fixed `verify-settings-persistence.mjs`. `package.json`, `.gitignore`, docs.

## 18. Residual risks & external gates

- **Packaged EXE build + clean-machine walkthrough** — `electron-builder` OOMs on this 16 GB dev host;
  code lands, the packaged build + clean-machine scenarios remain external (procedure in the gates doc).
- **Sustained real-world soak** beyond the 30-minute harness.
- Profile schema migration (drop `pool`, add `javaRuntimeProfileId`) must not break saved profiles —
  covered by `verify:oracle-profiles`.
- **No dormant UCP path**: import rejects ucp jars; selection no longer probes UCP; the executor is gone.
- Wallet/TCPS companion-jar support retained.

## 19. Release status & sign-off

**PRODUCTION-CANDIDATE.** Java + JDBC selection, compatibility validation, live Oracle validation,
direct-JDBC concurrency/cancellation, real-Electron GUI, selection-model packaging, full regression, and the
≥30-minute soak all pass. **PRODUCTION-READY** remains blocked only on the packaged-EXE build (dev-host OOM)
+ clean-machine validation and a sustained real-world soak. Nothing committed — reported for review under the
conservative git profile on this ephemeral branch.
