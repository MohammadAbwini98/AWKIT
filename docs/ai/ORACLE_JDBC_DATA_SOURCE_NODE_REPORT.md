# Oracle JDBC Data Source & Node — Final Report (Phase 14)

Status date: 2026-07-17. Governing plan: [`ORACLE_JDBC_DATA_SOURCE_NODE_PLAN.md`](ORACLE_JDBC_DATA_SOURCE_NODE_PLAN.md)
(the AWKIT-grounded, corrected version of the source 14-phase spec). **Merged to `main`** on 2026-07-17
via PR #11 (`476dc29`), together with the SpecterStudio rename it depends on. Release status remains
**INTEGRATION-CANDIDATE** — merging shipped the code, not the external validation (see §13 and §17).

## 1. Executive Summary

AWKIT gained first-class, offline-first Oracle Database support: Oracle-backed Data Sources (Runtime
or Snapshot mode) and a read-only `Oracle` query node, both reachable from the existing Data Source
Manager and Flow Designer UIs. Every query runs through a **bundled private Java bridge** — a
zero-dependency JDK core process talking framed JSON-RPC over stdio, with no public port and no
system Java/Playwright/Chromium-style global dependency. Phases 01–11 are implemented and verified
against a **database-free mock executor** (integration mode), and the Phase 12 runtime-resolution +
checksum-validation logic is implemented — but the private JRE, the Oracle JDBC/UCP jars, the real
`OracleUcpQueryExecutor` compile+run, and packaged validation remain incomplete. A **fail-closed
production policy** (this increment) guarantees a packaged build can never silently serve mock rows:
packaged mode forces `AWKIT_ORACLE_REQUIRE_REAL`, refuses the mock flag, and treats a missing/failed
driver as *feature unavailable* (Snapshot Data Sources still work offline). The real-Oracle validation,
the jar/JRE vendoring, and the packaged-EXE walkthrough are **external gates**: this development machine
has no Docker, no authorized Oracle instance, and build-time network access is blocked. Release status
is **INTEGRATION-CANDIDATE** (corrected down from an earlier over-stated PRODUCTION-CANDIDATE).

## 2. Architecture Findings

- AWKIT's pre-existing Data Source system was **simpler** than the source plan assumed: one profile
  type (`JsonArrayDataSourceProfile`), no discriminated union, no `DataSourceResolver` class, and data
  sources were resolved eagerly inline in `app/main/ipc/execution.ipc.ts`. The plan was corrected in
  place (`ORACLE_JDBC_DATA_SOURCE_NODE_PLAN.md` §2) rather than implemented against the source spec's
  assumptions.
- A "node" in AWKIT is a `FlowStep` with a `StepType` discriminator — Oracle became `StepType: "oracle"`,
  following the same pattern as every other step type rather than inventing a parallel concept.
- The runner executes in the Electron **main** process (no worker threads), so `OracleQueryService`
  owns the Java bridge child process directly — no IPC hop to a separate runner process was needed.
- `passwordSecretRef` reuses the existing by-name DPAPI `SecretStore` (`oracle.<profileId>.password`),
  not a new secret-storage mechanism.

## 3. JDBC Bridge

`oracle-jdbc-bridge/` is a **zero-dependency, pure-JDK** Maven module (`Main`, `Dispatcher`, `Framing`,
`Protocol`, `BridgeException`, `Json`, `SqlReadOnlyPolicy`, `QueryExecutor` + its three implementations
— `MockQueryExecutor` (database-free, dev/test only), `DriverUnavailableExecutor` (fail-closed: rejects
every query with `DRIVER_UNAVAILABLE` when a real driver is required but absent), and the gated
`OracleUcpQueryExecutor` (real Oracle JDBC Thin + UCP, in the separate `src/main/java-oracle/` source set
compiled only when the jars are vendored) — and `CancellationToken`) built with a **pinned JDK 17** (`scripts/build-oracle-bridge.mjs` never trusts
`JAVA_HOME`/`PATH`, which are inconsistent on this machine — JDK 8/17/11 all present under different
names). Framing is 4-byte big-endian length-prefixed JSON over stdin/stdout with a `Protocol.MAX_MESSAGE_BYTES`
ceiling enforced on both read and write (oversize inbound frames are drained-and-rejected without
desyncing the stream). `Main` reflectively loads a real Oracle UCP executor when driver jars are
vendored under `resources/oracle-jdbc/lib/`; when absent it falls back to `MockQueryExecutor`
(`driverAvailable() == false`), exactly like a dev checkout without bundled Chromium. The TypeScript
client (`OracleJdbcBridgeManager`) lazily spawns the process, performs a `hello` handshake with a
protocol-version check, correlates requests by id, enforces a per-request timeout, propagates
`AbortSignal` → a `cancelQuery` RPC, restarts after a crash (bounded), and disposes the child orphan-free
on app `before-quit`.

## 4. Secure Credentials

`OracleConnectionProfile` builds the JDBC URL, computes a pool fingerprint, and redacts credentials
for logs. `OracleProfileService` is a pure CRUD service; inline passwords are routed into the existing
DPAPI `SecretStore` under `oracle.<id>.password` — never stored in profile JSON. `app/main/oracleService.ts`
+ `app/main/ipc/oracle.ipc.ts` (mutation channels sender-guarded) + a `preload.ts` `oracle` domain expose
only `hasPassword: boolean` to the renderer, never a secret value. `testConnection` round-trips through
the bridge and maps bridge error categories to safe user-facing messages.

## 5. Data Source Modes

`DataSourceProfile` is now a backward-compatible discriminated union: `JsonArrayDataSourceProfile |
OracleDataSourceProfile`. `isJsonArrayDataSource`/`isOracleDataSource` treat a missing `type` field as
`jsonArray` — old, pre-Oracle profile JSON files on disk have no `type` field at all and continue to
load unchanged. This is the entire "migration" story for this feature: additive-only, no data
transformation, no explicit migration script needed. `src/data/DataSourceResolver.ts` is the single authority that normalizes
every Data Source type to one `ResolvedDataSource` array-of-objects contract:
- **Runtime/Live** — a single-flight, per-run-cached lazy loader (`loadRows()`); a failed attempt is
  evicted from the cache so a retry can re-execute; concurrent consumers (parallel branches, loops)
  share one in-flight promise.
- **Snapshot/Offline** — pre-captured rows returned with zero database connection, safe for fully
  offline runs.

`resolveWorkflowDataSources` (`app/main/ipc/execution.ipc.ts`) branches the union: JSON keeps its
original eager file-read path unchanged; Oracle resolves through `DataSourceResolver`, and a
workflow-bound Oracle source is materialized eagerly (via a new `materializeDataSourceRows` helper in
`FlowExecutor`/`StepExecutor`) so `dataRows` loops get a real row count.

## 6. Snapshot Storage

`refreshOracleDataSourceSnapshot(id)` executes the query once, normalizes rows to the
`OracleJsonScalar` contract, and **atomically persists** via the existing `JsonProfileStore.update`
(temp-file + rename) — a crash mid-write cannot corrupt the stored snapshot. On error, the **last-good
rows are kept** and a secret-safe, category-only error summary is recorded (never raw driver exception
text, which could contain a connection string or bind value). `isSnapshotStale` compares a query hash
(SQL + binds + limits) and a connection fingerprint against the snapshot's recorded values, so an
edited query or changed connection profile automatically marks the snapshot stale without a background
watcher.

## 7. Runtime Pooling / Cancellation

`OracleQueryService` is **the single query authority** — node executors and the Data Source resolver
call it, never the bridge directly. Per call: read-only SQL gate → descriptor/secret resolution →
typed-bind conversion → bridge `executeQuery` → result normalization + defensive limits → outer
timeout / `AbortSignal` cancellation / transient-only retry (bounded, only for categories the bridge
marks retriable) / bounded concurrency (a simple acquire/release waiter queue, default 4 concurrent
Oracle operations) / low-cardinality telemetry. Real connection pooling (Oracle UCP) lives in the
gated Java executor that only compiles/loads once `ucp*.jar` is vendored; the mock executor has no
pool to exercise, so pooling behavior itself is part of the Phase 13 external gate, not something this
environment can prove end-to-end. Cancellation and outer-timeout behavior ARE proven against the real
mock bridge process (`verify:oracle-runtime`: abort fires in <3s against an artificially slow query,
outer timeout fires at the configured threshold).

## 8. Oracle Node

`StepType: "oracle"` is registered in `flowNodeCatalog`/`flowNodeRegistry`/`flowDesignerTypes`
(`defaultOracleNodeConfig()`), with `OracleNodeSection.tsx` as its property-panel section: connection
source toggle (Oracle Data Source vs. Connection Profile + inline SQL), a bind-parameter editor (name,
JDBC type, value source — static/current-row/workflow-input/instance-variable/env — mirroring AWKIT's
existing dynamic-value conventions), and timeout/max-rows/fetch-size limit fields. The node runner
(`getOracleNodeRunner()` in `app/main/oracleService.ts`) is wired into the runner via
`executionEngine.setOracleNodeRunner(...)` in `execution.ipc.ts`.

## 9. Output Mapping

`OracleResultMapper` + `OracleNodeExecution` convert a normalized `OracleQueryResult` into the node's
declared return type — `string | number | boolean | list` — deterministically: scalar returns take a
configured column (or the sole column of a single-row result); list returns the full row array. Column
JSON-type inference (`OracleColumnMetadata.jsonType`) happens once in the bridge/type-conversion layer
so scalar coercion is consistent between node output and Data Source rows.

## 10. SQL Security

`OracleSqlPolicy.validateReadOnlySql` (TypeScript) and `SqlReadOnlyPolicy` (Java, `src/main/…/sql/`) are
independent, kept-in-sync implementations of the same policy — the TS gate runs BEFORE the bridge is
even spawned (fast rejection, no process cost), and the Java side re-validates authoritatively so a
racing or compromised caller cannot bypass the gate by talking to the bridge directly. The policy is a
real tokenizer (strips comments and single/double-quoted literals first, then tokenizes on
non-identifier boundaries), not a first-character check: it rejects multiple statements (a bare `;`
with trailing content), a fixed forbidden-keyword set covering DML/DDL/PL-SQL/transaction-control/lock
statements, and `SELECT … FOR UPDATE`.

Hardened in this increment (Phase 04), on both sides identically: **inline PL/SQL** in the `WITH` clause
(`WITH FUNCTION`/`WITH PROCEDURE`, 12c+) previously slipped through — `WITH` is a legal leading keyword
and `FUNCTION`/`PROCEDURE` were not forbidden — and is now rejected; **database links** (`table@remote`)
are rejected (the `@` cannot survive literal/identifier stripping except as a link operator, so an email
inside a literal is correctly still allowed); and calls into **dangerous packages** (`UTL_*` — SSRF/file,
`DBMS_*`, `OWA_*`) are rejected, since a read-only `SELECT` can still invoke a stored function.
`verify:oracle-sql-policy` runs one adversarial corpus (30 cases) through the TS mirror **and** the
authoritative Java gate via the real Dispatcher and requires identical decisions.

The tokenizer is **defense in depth only**. The primary boundary is a dedicated least-privilege Oracle
account — specified, with provisioning SQL and a verification checklist, in
[`ORACLE_JDBC_DB_ACCOUNT_RUNBOOK.md`](ORACLE_JDBC_DB_ACCOUNT_RUNBOOK.md). `Connection.setReadOnly(true)`
is set but is explicitly NOT treated as a security control.

All bind values use prepared-statement binding — never string
interpolation. Result limits (rows, columns, per-cell bytes, total serialized bytes) are enforced
defensively at the TypeScript boundary with built-in defaults (`DEFAULT_MAX_COLUMNS = 200`,
`DEFAULT_MAX_CELL_BYTES = 1_000_000`, `DEFAULT_MAX_SERIALIZED_BYTES = 25_000_000`) that apply even when
a node/Data Source doesn't set its own — this was a gap closed in this increment (`maxCellBytes` was
declared in the limits interface but never actually checked or defaulted; see `TASK_LOG.md`). Message
size is capped at the framing layer (`Protocol.MAX_MESSAGE_BYTES`) independent of row/cell limits.

## 11. Packaging

`OracleRuntimeResolver.resolveOracleRuntime` resolves, in order: (1) a bundled private runtime under
`resources/oracle-jdbc/{runtime,bridge,lib}/` (production) — **now checksum-validated**: if
`resources/oracle-jdbc/checksums.json` is present, every listed file's SHA-256 must match or the bundle
is treated as unavailable with a clear "reinstall" reason (production never silently launches a
corrupted/tampered/incomplete bundle); (2) in dev/unpackaged builds only, a pinned-JDK-17 + the
locally-built jar under `oracle-jdbc-bridge/target/`. Production (`appMode: "packaged"`) never falls
back to a dev/system JDK. `OracleBundleChecksums.validateOracleBundleChecksums` is the checksum engine
(pure, synchronous, tested against synthetic fixtures — see §12).

**Fail-closed production policy (Phase 01).** A packaged build can never serve mock Oracle rows. The
resolver owns the decision and bakes it into the launch spec: packaged ⇒ `AWKIT_ORACLE_REQUIRE_REAL=1`
and never `AWKIT_ORACLE_BRIDGE_MOCK`; dev/unpackaged ⇒ the database-free mock is allowed so the protocol
works without jars. Packaged + missing driver jars ⇒ the feature reports **unavailable** (Snapshot Data
Sources keep working — they read stored rows and never launch the bridge). The Java bridge honors
`AWKIT_ORACLE_REQUIRE_REAL` by ignoring any mock flag and, when the real executor cannot load, selecting
`DriverUnavailableExecutor` (every query fails `DRIVER_UNAVAILABLE`) instead of the mock. The bridge
manager independently rejects a non-`real` handshake at startup. This closed a **live leak**:
`oracleService.resolveLaunchSpec` previously forced `AWKIT_ORACLE_BRIDGE_MOCK=1` whenever the driver was
absent, with no packaged guard.

**Preparation + validation (Phases 02/08).** `npm run prepare:oracle-runtime` reproducibly stages the
bundle from out-of-band artifacts: verifies each SHA-256 against the locked
`scripts/oracle/oracle-runtime.manifest.json`, validates architecture + Java version (never trusting
`JAVA_HOME`/`PATH`), requires license notices, builds the bridge, and regenerates `checksums.json` — all
offline, failing closed with no partial bundle. `electron-builder.json` already copies `resources/**`
(so the bundle ships once staged) and now excludes any `.env`/wallet/key artifact under `oracle-jdbc/`.
`validate:offline` gained an Oracle section (checksums, required layout, a real driver required, no
secrets/wallets, size report), backed by the shared `auditOracleOfflineBundle`.

**Still external-gated:** no real `resources/oracle-jdbc/` bundle exists here (build-time network is
blocked), so the *artifacts* remain unproduced even though every code path that stages and validates
them is implemented and unit-verified against synthetic fixtures.

## 12. Tests

**218 automated checks across 10 verifiers**, all green, all driving the **real Java mock bridge**
process (not a TS-side stub) except where noted pure:

| Verifier | Checks | Covers |
|---|---|---|
| `verify:oracle-bridge` | 32/32 | Framing/protocol codec, handshake, health, query execution, SQL policy (Java side), error mapping, cancellation, oversized/malformed frames, crash/restart, clean shutdown, redaction |
| `verify:oracle-bridge-real-build` | 11/11 | Static contract checks on the gated `OracleUcpQueryExecutor` + a real **stub-compile** against JDK `java.sql` + UCP stubs (live real build skips until jars vendored) |
| `verify:oracle-profiles` | 22/22 | Profile CRUD, secret routing/deletion, connection testing, error-category mapping |
| `verify:oracle-data-source` | 28/28 | Snapshot staleness, resolver normalization (JSON/snapshot/runtime), DS-side bind resolution, loop materialization |
| `verify:oracle-runtime` | 36/36 | Bind/type conversion, defensive result limits, SQL gate, cancellation, timeout, concurrency, telemetry, **expanded hello handshake**, and **fail-closed production policy** (require-real bridge rejects mock, DRIVER_UNAVAILABLE, mock-flag override) |
| `verify:oracle-runtime-prep` | 20/20 | `prepare:oracle-runtime` logic: checksum verify, arch + Java-version validation, license notices, fail-closed on missing/mismatched/wrong-arch/unsupported-java, reproducibility (synthetic fixtures) |
| `verify:oracle-sql-policy` | 30/30 | **TS/Java parity** across an adversarial corpus (comments, literals, Unicode whitespace, multi-statement, `WITH FUNCTION`/`WITH PROCEDURE`, `UTL_`/`DBMS_`/`OWA_` packages, dblinks) — identical decisions |
| `verify:oracle-packaging` | 19/19 | Checksum validation + runtime resolution, plus the **fail-closed policy** (packaged + missing driver → unavailable, forceMock ignored, dev-only mock) against synthetic fixtures |
| `verify:oracle-lazy-resolution` | 12/12 | Runtime source executes only when consumed, single-flight across parallel consumers, per-run cache scope, snapshot = zero bridge/DB, failed attempt not cached |
| `verify:oracle-offline-bundle` | 8/8 | Packaged-bundle audit: checksum-valid, complete layout, real driver required, no secrets/wallets, size report (synthetic fixtures + skip-if-absent real dir) |

Plus `verify:oracle-live` (credential-gated) runs its redaction self-test and skips cleanly with no
config. `npm run build` (tsc + electron-vite bundles) is clean, and `verify:runner` 82/82,
`verify:security` 39/39, `verify:secrets` 16/16, `verify:ipc-contract` 4/4 show no regression. A prior
**live Electron-GUI walkthrough** confirmed the Data Source Manager modal renders and client validation
blocks Create without a connection profile (zero console errors).

**Not run here:** tests against a real Oracle Database or the real UCP pool (no driver jars, no DB — §13).

## 13. Real Oracle Validation

**Not performed — external gate**, but now fully scaffolded. This environment has no Docker, no build-
time network to vendor `ojdbc11.jar`/`ucp.jar`, and no authorized Oracle credentials. What changed this
increment: the real `OracleUcpQueryExecutor` is now **authored** (gated `src/main/java-oracle/`) and
**continuously stub-compiled** against the JDK's real `java.sql` on every `verify:oracle-bridge-real-build`
run, so its JDBC usage is validated even without the jars; and `verify:oracle-live` is the credential-
gated harness that runs the functional matrix against a real DB and writes a redacted artifact. The
exact procedure to clear this gate is in
[`ORACLE_JDBC_VALIDATION_GATES.md`](ORACLE_JDBC_VALIDATION_GATES.md) (Phase 06). Fail-closed guarantees
mean the mock can never stand in for the real driver in a packaged build.

## 14. Performance

No load/performance testing against a real Oracle instance (external gate, §13). Against the mock bridge,
latency is dominated by process IPC (sub-10ms), not representative of real network+DB latency. The
`verify:oracle-live` harness records per-step durations and pool/teardown state into the redacted
artifact; the full performance + soak procedure and invariants are specified in
[`ORACLE_JDBC_VALIDATION_GATES.md`](ORACLE_JDBC_VALIDATION_GATES.md) (Phase 10).

## 15. Changed Files

**New:**
`oracle-jdbc-bridge/` (Java bridge module — `Main`, `Dispatcher`, `Framing`, `Protocol`,
`BridgeException`, `Json`, `SqlReadOnlyPolicy`, `MockQueryExecutor`, `QueryExecutor`,
`CancellationToken`), `src/oracle/` (`OracleBridgeProtocol`, `OracleBundleChecksums`,
`OracleConnectionProfile`, `OracleDataSourceBinds`, `OracleErrors`, `OracleJdbcBridgeManager`,
`OracleNodeExecution`, `OracleProfileService`, `OracleQueryService`, `OracleResultMapper`,
`OracleRuntimeResolver`, `OracleSqlPolicy`, `OracleTypeConversion`), `src/data/DataSourceResolver.ts`,
`app/main/oracleService.ts`, `app/main/ipc/oracle.ipc.ts`,
`app/renderer/components/workflow/OracleNodeSection.tsx`, `app/renderer/pages/OracleDataSourceModal.tsx`,
`scripts/build-oracle-bridge.mjs`, `scripts/verify-oracle-{bridge,profiles,data-source,runtime,packaging}.mts`,
`docs/ai/ORACLE_JDBC_DATA_SOURCE_NODE_PLAN.md`, this report.

**Modified:** `src/data/DataSourceProfile.ts` (union type), `app/main/ipc/{execution,index}.ts`,
`app/main/{main,preload}.ts`, `app/renderer/components/workflow/{FlowNodePropertiesPanel,
flowDesignerTypes,flowNodeCatalog,flowNodeRegistry}.tsx`, `app/renderer/pages/{DataSourceManager,
FlowChartDesigner}.tsx`, `src/runner/{ExecutionEngine,InstanceExecutionContext,PlaywrightRunner,
StepExecutor,ValueResolver}.ts`, `src/profiles/FlowProfile.ts`, `src/offline/PortablePathResolver.ts`,
`package.json`, `.gitignore` (excludes vendored `resources/oracle-jdbc/{runtime,bridge,lib}`).

### 15b. This increment (INTEGRATION-CANDIDATE correction + validation scaffolding)

**New:**
- `oracle-jdbc-bridge/src/main/java-oracle/.../OracleUcpQueryExecutor.java` — the **real** Oracle
  JDBC/UCP executor (gated: compiles only when jars are vendored; stub-compiled continuously).
- `oracle-jdbc-bridge/src/main/java/.../exec/DriverUnavailableExecutor.java` — fail-closed executor used
  when a real driver is required but absent (rejects every query with `DRIVER_UNAVAILABLE`, never mocks).
- `src/oracle/OracleOfflineBundle.ts` — packaged-bundle integrity audit (shared with the offline validator).
- `scripts/prepare-oracle-runtime.mjs` + `scripts/oracle/oracle-runtime.manifest.json` — reproducible,
  offline, fail-closed runtime preparation and its locked manifest.
- `scripts/oracle/oracle-live-fixture.sql` — read-only test fixture for live validation.
- `scripts/verify-oracle-{bridge-real-build,runtime-prep,sql-policy,live,lazy-resolution,offline-bundle}.mts`.
- `docs/ai/ORACLE_JDBC_{RUNTIME_MATRIX,DB_ACCOUNT_RUNBOOK,VALIDATION_GATES}.md`.

**Modified:**
- `src/oracle/OracleRuntimeResolver.ts` — owns the fail-closed policy: `mockAllowed`/`requireRealDriver`,
  bakes `AWKIT_ORACLE_REQUIRE_REAL` (packaged) vs. `AWKIT_ORACLE_BRIDGE_MOCK` (dev-only) into the launch
  spec, packaged + missing driver ⇒ unavailable, and `oracleDriverJarsPresent` now requires a real `.jar`.
- `app/main/oracleService.ts` — **removed the mock leak** (it previously forced
  `AWKIT_ORACLE_BRIDGE_MOCK=1` whenever the driver was absent, with no packaged guard); now passes
  `requireRealDriver` to the manager.
- `src/oracle/OracleJdbcBridgeManager.ts` — `requireRealDriver` handshake guard (kills a mock/unavailable
  bridge with `DRIVER_UNAVAILABLE`) + optional `classpath`/`mainClass` launch mode for vendored jars.
- `src/oracle/OracleBridgeProtocol.ts` — hello gains `executionMode`/`ucpVersion`/`javaVersion`.
- `oracle-jdbc-bridge/.../{Main,Dispatcher,QueryExecutor,MockQueryExecutor,BridgeException}.java` —
  `AWKIT_ORACLE_REQUIRE_REAL` refuses mock fallback and ignores the mock flag; expanded hello;
  `executionMode()`/`ucpVersion()`; added the `(category, message, retriable)` constructor.
- `src/oracle/OracleSqlPolicy.ts` + `oracle-jdbc-bridge/.../SqlReadOnlyPolicy.java` — reject
  `WITH FUNCTION`/`WITH PROCEDURE`, database links (`@`), and `UTL_`/`DBMS_`/`OWA_` package calls (kept
  byte-for-byte equivalent; proven by `verify:oracle-sql-policy`).
- `scripts/validate-offline-bundle.ps1` — new Oracle section (checksums, layout, real driver required,
  no secrets/wallets, size report).
- `electron-builder.json` — excludes any `.env`/wallet/key artifact under `oracle-jdbc/`.
- `scripts/verify-oracle-{runtime,packaging}.mts`, `package.json`, this report and the plan.

## 16. Remaining Risks

- **Vendored jars/JRE absent.** `resources/oracle-jdbc/` does not exist in this environment. The
  preparation path (`prepare:oracle-runtime`), `extraResources` wiring, and the `validate:offline`
  Oracle section are all implemented and unit-verified against synthetic fixtures, but no real bundle
  has been produced (§11, and `ORACLE_JDBC_VALIDATION_GATES.md` › Prerequisite).
- **No real-Oracle validation.** Real driver behavior, real UCP pooling under load, and real Oracle
  error-code mapping are unproven (§13). `verify:oracle-live` is written and credential-gated, awaiting
  an authorized DB.
- **No packaged-EXE rebuild/walkthrough.** The full offline packaging → install → clean-machine GUI
  walkthrough for the Oracle feature specifically has not been run (broader app icon/splash work has
  used this walkthrough before; Oracle wasn't in scope for those runs).
- **Real UCP pool behavior is unproven** (highest-residual-risk item). The executor now **compiles**
  against the JDK's real `java.sql` on every `verify:oracle-bridge-real-build` run (UCP APIs are
  stub-shaped), so its JDBC usage and internal signatures are validated — but it has never linked
  against the actual `ojdbc`/`ucp` jars or opened a real connection. Specifically unvalidated: whether
  the real UCP method signatures match (e.g. `setConnectionWaitTimeout` vs. newer Duration-based
  setters), real pool lifecycle/teardown semantics, and real ORA-code→category mappings.
- **Performance/telemetry percentiles unvalidated** against real network+database latency (§14).
- **Snapshot capture at scale** (very large result sets, CLOB-heavy tables) is only exercised against
  the small, fixed mock dataset — the new cell/serialized-byte limits are unit-tested but not proven
  against a real large payload.

## 16b. Pending-phase execution (2026-07-17, post-merge)

A 12-phase "pending implementation" plan was run against the merged baseline. Two of its assumptions were
corrected rather than obeyed: it targets "the committed Oracle feature branch" (merged and deleted — the
baseline is `main` @ `b6e473d`) and expects "rebrand/splash work is absent" (present **by design** — the
rename is a dependency of the Oracle work, so reverting it would have been wrong). It also names an
`ORACLE_RUNTIME_UNAVAILABLE` token; the code's existing `DRIVER_UNAVAILABLE` wire category + resolver
`available:false` carry that meaning and were not renamed for cosmetics.

**Executed (5 of 12):**

- **01 Baseline** — `main` @ `b6e473d`, tree clean apart from docs; build PASS; Oracle 137/137 on the
  five originally-listed verifiers; all three fail-closed layers present; docs read INTEGRATION-CANDIDATE.
- **04 Fail-closed revalidation** — 4 of the 5 truth-table rows proven without real jars
  (`packaged + missing driver`, `packaged + corrupt checksum`, `packaged + mock flag`, `dev + mock flag`),
  across all three layers. Plus the plan's **Required Product Behavior**, now explicitly tested: with the
  Oracle runtime unavailable, JSON sources keep working, Snapshot sources keep working offline, Runtime
  sources fail safely with `DRIVER_UNAVAILABLE` (no mock rows, no crash), and a failed Oracle source does
  not poison subsequent resolution. Row 5 (`packaged + valid real bundle → real executor`) is blocked on jars.
- **07 Lazy behavior — a real gap the plan caught.** The lazy suite previously counted an *injected stub*.
  It now drives the **real Java bridge process** and counts actual `executeQuery` **RPCs at the wire**
  (20/20). The load-bearing proofs are negative: a Snapshot source and an unreferenced Runtime source leave
  the Java process **never started** (`manager.isRunning() === false`). Also proven: late node → 1 RPC when
  reached; 3 parallel consumers → exactly 1 RPC (single-flight); two runs → exactly 2 RPCs; failed attempt
  evicted from cache → retry re-executes.
- **08 Full regression** — green. Build PASS; Oracle **226/226** across 10 verifiers; runner 82, concurrency
  78, observability 65, recorder 72, telemetry 61/61, security 39, data-editor 27, browser-isolation 27/27,
  waits 21, recorder-draft 17/17, safety-policy 17, secrets 16, protected-login 16, locks 15, runtime-status
  15, artifacts 13, chromium-hardening 13, recorder-flow 13/13, profile-store 13/13, cancellation 12,
  startup-recovery 10, write-queue 7/7, ipc-contract 4/4, workflow-sentinels 4/4; `validate:offline` passes
  and correctly warns the Oracle runtime is not bundled. **One failure — `verify:durable-store` 9/2
  (SQLite migration checks) — is PRE-EXISTING, not an Oracle regression:** it fails identically at
  `dee283e`, the commit before any Oracle work (verified in an isolated worktree), and this session never
  touched the durable store. Left alone per the plan's "fix only actual regressions" rule.
- **12 Final report** — this section + the summary block below.

**Blocked (7 of 12) — verified, not assumed.** `ojdbc*/ucp*.jar` exist nowhere on this machine
(`~/.m2`, Downloads, Desktop); Maven Central is unreachable (**HTTP 000**); Docker is unavailable; no
`AWKIT_ORACLE_LIVE_*` credentials are configured; no clean Windows machine. Every blocked phase (02, 03,
05, 06, 09, 10, 11) fails at the same first step — **acquiring the artifacts** — and each is recorded with
its precise unblock step in [`ORACLE_JDBC_VALIDATION_GATES.md`](ORACLE_JDBC_VALIDATION_GATES.md).

### Required final summary

```text
Real executor compile:      NOT RUN — blocked: no ojdbc/ucp jars (Maven Central HTTP 000).
                            Stub-compiled against the real JDK java.sql every verifier run; the
                            UCP API shape itself remains unverified.
Live Oracle suite:          NOT RUN — blocked: no authorized non-production Oracle database and no
                            AWKIT_ORACLE_LIVE_* credentials. Harness (verify:oracle-live) is written,
                            credential-gated, fail-closed, and skips cleanly.
UCP pooling:                NOT RUN — blocked by the above (real pool behavior unproven).
Cancellation:               PASS against the real bridge process (mock executor): abort → cancelQuery
                            RPC → request ends < 3s vs an 8s query. Statement.cancel() against a real
                            Oracle statement is NOT proven.
Lazy execution:             PASS — 20/20 against the real bridge with real executeQuery RPC counters;
                            snapshot/unreferenced never start the Java process.
Full regression:            PASS — Oracle 226/226; all impacted suites green; build clean.
                            (durable-store 9/2 fails pre-existing, proven unrelated at dee283e.)
Portable package:           NOT RUN — blocked: no staged runtime to package.
Installer package:          NOT RUN — blocked: same.
Clean-machine validation:   NOT RUN — blocked: no clean Windows machine and no packaged artifact.
Soak:                       NOT RUN — blocked: no authorized database.
Final status:               INTEGRATION-CANDIDATE
Remaining blockers:         (1) vendor ojdbc11.jar + ucp11.jar + a private JRE and fill their exact
                                versions/SHA-256 into scripts/oracle/oracle-runtime.manifest.json;
                            (2) an authorized, non-production, read-only Oracle database;
                            (3) a clean Windows x64 machine for the packaged-EXE walkthrough.
                            (1) gates (2) and (3). None are solvable in this environment.
```

## 17. Production Recommendation

**INTEGRATION-CANDIDATE** (corrected from an earlier over-stated `PRODUCTION-CANDIDATE`). Phases 01–11
are implemented and verified in **mock-backed integration mode**; the Phase 12 runtime-resolution and
checksum-validation logic is implemented, but the private JRE, the Oracle JDBC/UCP jars, the real
`OracleUcpQueryExecutor` compile+run, the package wiring, and packaged validation remain incomplete.
The architecture and security boundaries (read-only SQL gate on both sides, prepared-statement binding,
DPAPI-backed secrets, redaction, defensive result limits, checksum-gated bundle loading, and — new in
this increment — a **fail-closed production policy** that guarantees a packaged build can never serve
mock Oracle rows) are implemented and verified against everything reachable without a real driver.

Status may advance only through the documented transitions:

```text
INTEGRATION-CANDIDATE
    ↓ real OracleUcpQueryExecutor compiles + an authorized read-only Oracle suite passes
PRODUCTION-CANDIDATE
    ↓ bundled private runtime + packaged EXE + offline/clean-machine validation pass
PRODUCTION-READY
```

External gates, in order (none require further architecture): (1) vendor `ojdbc11.jar`/`ucp.jar` + a
private JRE into `resources/oracle-jdbc/`, generate their `checksums.json`, and confirm
`electron-builder.json` `extraResources`; (2) compile the real `OracleUcpQueryExecutor` and run the
credential-gated `verify:oracle-live` matrix against an authorized, read-only Oracle account
(`AWKIT_ORACLE_BRIDGE_MOCK` unset); (3) rebuild the packaged EXE and run the clean-machine offline
walkthrough with Oracle included; (4) validate performance/telemetry and a soak against real latency.
Until (1)–(2) pass, the feature stays **INTEGRATION-CANDIDATE**; until (3)–(4) also pass, it does not
reach **PRODUCTION-READY**.
