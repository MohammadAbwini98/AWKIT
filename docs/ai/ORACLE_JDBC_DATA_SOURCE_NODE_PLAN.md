# Oracle JDBC Data Source & Oracle Node — Architecture Plan (Phase 01 deliverable)

Status: **living plan** — authored 2026-07-16 (Claude). This is the AWKIT-grounded, corrected
version of the 14-phase source plan under
`AWKIT_ORACLE_JDBC_DATA_SOURCE_NODE_PHASES/`. Where the source plan assumed AWKIT internals that do
not exist, this document records the real integration point (proven from code, `file:line`) and the
adapted approach. Read this before implementing any Oracle phase.

---

## 0. Implementation status (2026-07-16)

| Phase | Status | Evidence |
|---|---|---|
| 01 Audit + plan | ✅ done | this doc + `00_MASTER_OVERVIEW.md` corrections |
| 02 Java bridge + TS manager | ✅ done (core + **real `OracleUcpQueryExecutor` authored** in the gated `src/main/java-oracle/`, continuously stub-compiled against real `java.sql`; links against real jars only once vendored) | `verify:oracle-bridge` 32/32, `verify:oracle-bridge-real-build` 11/11 |
| 03 Profiles + secrets | ✅ done | `verify:oracle-profiles` 22/22 |
| 04 Data Source model + resolver | ✅ done (incl. lazy runtime resolution: single-flight, per-run cache, snapshot = zero DB) | `verify:oracle-data-source` 28/28, `verify:oracle-lazy-resolution` 12/12 |
| 05 Data Source UI | ✅ done | `OracleDataSourceModal` + `DataSourceManager` "Add Oracle Source" flow; GUI-verified live (modal opens, fields bind, client validation blocks submit without a connection profile, zero console errors) |
| 06 Snapshot / offline mode | ✅ done (backend) — `refreshOracleDataSourceSnapshot` executes once, normalizes, atomic-persists via `store.update`; last-good rows kept on error; secret-safe error summary | `verify:oracle-data-source` 28/28 |
| 07 Runtime query service | ✅ done (TS; UCP pooling in the gated Java executor — real pool behavior still unproven) | `verify:oracle-runtime` 36/36 |
| 08 Oracle node model + panel | ✅ done | `OracleNodeSection` + `flowNodeCatalog`/`FlowNodePropertiesPanel`; build |
| 09 Node execution + mapping | ✅ done | `OracleNodeExecution` + `OracleResultMapper`; node runner wired in `execution.ipc` |
| 10 Workflow integration | ✅ done | node runner + DS-side: `resolveWorkflowDataSources` branches Oracle via `DataSourceResolver`; runtime source materialized for loops (`materializeDataSourceRows` in `FlowExecutor`/`StepExecutor`); `verify:runner` 82/82 |
| 11 Security/limits/observability | ✅ done (SQL policy both sides + **hardened**: `WITH FUNCTION`/`WITH PROCEDURE`, dblinks, `UTL_`/`DBMS_`/`OWA_` packages now rejected, TS↔Java parity proven; redaction, telemetry, defensive result limits; least-privilege DB runbook written) | `verify:oracle-runtime` 36/36, `verify:oracle-sql-policy` 30/30 |
| 12 Offline packaging + runtime validation | 🟡 partial (checksum validation + **fail-closed production policy** — packaged never mocks; `prepare:oracle-runtime` staging/verification; `validate:offline` Oracle section; `electron-builder` secret exclusions. **Remaining = the artifacts themselves**: vendoring jars/JRE, then a packaged-EXE walkthrough) | `verify:oracle-packaging` 19/19, `verify:oracle-runtime-prep` 20/20, `verify:oracle-offline-bundle` 8/8 |
| 13 Tests + real-Oracle | 🟡 partial (mock suites green — 218 checks; `verify:oracle-live` harness written + credential-gated; **real-Oracle run = external gate**) | `verify:oracle-live` (skips without config) |
| 14 Migration + docs + report | ✅ done (migration is structural/backward-compatible by construction — see report §5; final report written) | [`ORACLE_JDBC_DATA_SOURCE_NODE_REPORT.md`](ORACLE_JDBC_DATA_SOURCE_NODE_REPORT.md) |

### 0b. Validation & release track (2026-07-17)

A second, 10-phase **validation/release** track was supplied on 2026-07-17 (distinct numbering from the
14 implementation phases above). It corrected the release status **down** to `INTEGRATION-CANDIDATE` and
added the fail-closed + real-driver + packaging requirements. Status:

| Phase | Status |
|---|---|
| 01 Correct status + production fail-closed | ✅ done — closed a **live mock leak** in `oracleService`; policy enforced in the resolver, the bridge manager, and the Java bridge |
| 02 Versions/licensing/reproducible inputs | ✅ done — `ORACLE_JDBC_RUNTIME_MATRIX.md`, locked manifest, `prepare:oracle-runtime` (hashes/versions = external gate) |
| 03 Compile the real JDBC/UCP executor | 🟡 authored + stub-compiled; **real-jar compile = external gate** |
| 04 Harden read-only SQL + DB privileges | ✅ done — parity corpus + `ORACLE_JDBC_DB_ACCOUNT_RUNBOOK.md` |
| 05 Real Oracle integration harness | ✅ done — `verify:oracle-live`, credential-gated, fail-closed, redacted artifact |
| 06 Authorized Oracle functional validation | ⛔ **external gate** (no authorized DB) — procedure in [`ORACLE_JDBC_VALIDATION_GATES.md`](ORACLE_JDBC_VALIDATION_GATES.md) |
| 07 Lazy resolution + full regression | ✅ done — `verify:oracle-lazy-resolution` 12/12; build + runner/security/secrets/IPC green |
| 08 Package the private Java/JDBC runtime | 🟡 wiring + validator done; **bundling the artifacts = external gate** |
| 09 Packaged EXE clean-machine walkthrough | ⛔ **external gate** (needs vendored jars + a clean box) |
| 10 Real performance, soak, final report | 🟡 report updated; **perf/soak = external gate** |

**External gates (cannot clear in this environment):** vendored ojdbc/ucp jars + private JRE (network
blocked at build time), an authorized real Oracle DB (no Docker), and a packaged-EXE rebuild.

## 1. Goal (unchanged from source plan)

Add first-class Oracle Database support through JDBC while preserving AWKIT's offline Electron
architecture, secure credential handling, packaging rules, and existing Data Source / node systems.

Two capabilities:

1. **Oracle-backed Data Sources** — connect via JDBC, run a parameterized `SELECT`, in either
   **Runtime/Live** (lazy, per-run cache) or **Snapshot/Offline** (execute once, store normalized
   array-of-objects) mode.
2. **Oracle node/step** — a new `oracle` step type using a Data Source, a connection profile, or
   secure inline settings; runs a read-only query and returns `string | number | boolean | list`.

Initial release is **read-only** (`SELECT` / `WITH … SELECT` only), prepared-statement binds,
credentials only ever via the secure store.

---

## 2. Codebase audit — proven integration points

Every claim here is from the current tree.

### 2.1 Data Source system (SIMPLER than the source plan assumed)

- **One profile type only.** `src/data/DataSourceProfile.ts` defines a single
  `JsonArrayDataSourceProfile { type: "jsonArray"; file; path; … }`. There is **no** discriminated
  union and **no** `type: "oracle"`.
- **No `DataSourceResolver` class exists.** The source plan (Phase 04) says "extend one resolver
  `DataSourceResolver.resolve(dataSourceId, executionContext)`". Reality:
  - Data sources are resolved **eagerly** at run start in
    `app/main/ipc/execution.ipc.ts` → `resolveWorkflowDataSources(workflow)` (line ~262), which
    reads every profile's JSON file and produces `ResolvedDataSource` objects.
  - The normalized runtime contract is `ResolvedDataSource { id; name; file; rootArrayPath; rows }`
    (`src/runner/InstanceExecutionContext.ts:1`).
  - Value binding at run time is `src/runner/ValueResolver.ts` (dynamic value → row lookup by `id`).
- **Storage** is generic JSON via `JsonProfileStore` / `createDataSourceProfileStore()`
  (`app/main/profileStores.ts`), so it already persists arbitrary profile shapes — no schema engine.
- **IPC**: `app/main/ipc/dataSource.ipc.ts` (`dataSources:list|get|create|update|delete|clone|
  export|import|browseJson|preview|getJsonPaths|readJson|writeJson|createFromScratch`); mutations
  guarded by `assertTrustedSender`; reads confined by `readJsonFileGuarded` (25 MB cap + path
  confinement). Preload domain `dataSources` in `app/main/preload.ts:153`.
- **UI**: `app/renderer/pages/DataSourceManager.tsx` + `DataSourceEditor.tsx`.

**Correction adopted:** introduce a real, pure `DataSourceResolver` in `src/data/` that returns the
existing `ResolvedDataSource` contract for **all** types, and wire it at the
`resolveWorkflowDataSources` seam. To support runtime (lazy) Oracle sources without eagerly opening
connections, extend `ResolvedDataSource` with an **optional lazy loader** (`loadRows?()`), leaving
the JSON path (eager `rows`) untouched and backward compatible. `ValueResolver.loadRows` already
prefers `dataSource.rows` when present — it gains a fallback to `loadRows()` for Oracle-runtime.

### 2.2 Node / step model (FlowStep-based, not a class registry)

Adding a "node" = extending the step system in five places:

1. `src/profiles/FlowProfile.ts` — add `"oracle"` to the `StepType` union; add Oracle fields to
   `NodeConfig` (and reuse `ValueSource` for binds).
2. `app/renderer/components/workflow/flowNodeCatalog.ts` — palette entry (label/description/icon).
3. `app/renderer/components/workflow/flowNodeRegistry.ts` — `META.oracle` (category/sections/
   `executable`/`validate`).
4. `app/renderer/components/workflow/FlowNodePropertiesPanel.tsx` — an `"oracle"` property section.
5. `src/runner/StepExecutor.ts` — a `case "oracle"` in `executeStep` (the switch at line ~679).

There is **no** separate node-serialization/migration system: backward compatibility is by
**optional fields + defaults on read** (RULES.md › Storage/schema). Reporting labels derive from the
catalog. This maps the source plan's Phase 08 "registry/serialization/migration/executor dispatch"
onto the real files above.

### 2.3 Runner executes in the Electron MAIN process

There is **no** `worker_threads` / `utilityProcess` in `src/` or `app/main/` (verified by search).
`ExecutionEngine → PlaywrightRunner → StepExecutor` all run in the main process.

**Consequence (major simplification):** an `OracleQueryService` living in the main process can own
the Java bridge child process directly via `node:child_process` and be called in-process by both the
node executor and the Data Source resolver. The source plan's rule "node executors and renderer IPC
must not call the bridge directly" is a **code-layering** rule (everything funnels through
`OracleQueryService`), **not** a process-boundary requirement. Renderer-initiated actions
(test-connection, preview, snapshot refresh) reach the service through IPC; node execution reaches it
by direct function call.

### 2.4 Secure store is by-NAME (maps cleanly to `passwordSecretRef`)

- `src/secrets/SecretStore.ts` — encrypted-at-rest values keyed by a **name**
  (`^[A-Za-z0-9._-]{1,64}$`), DPAPI via Electron `safeStorage` (`app/main/secretStore.ts`).
- `app/main/ipc/secrets.ipc.ts` manages **by name only** — no channel returns a value.
- Steps already reference secrets by name: `ValueSource { type: "secret"; secretName }`, resolved in
  main at run start into `InstanceExecutionContext.secrets` and masked in logs/reports.

**Correction adopted:** the source plan's `passwordSecretRef: string` **is a secret name**. Naming
convention: `oracle.<profileId>.password`, `oracle.<profileId>.truststore`. Renderer sees only
`hasPassword` (from `secrets.has`). Deleting a profile deletes its secrets. `SecretMasker`
(`src/reports/SecretMasker.ts`) already redacts registered secret values in reports.

### 2.5 Offline packaging precedent (mirror it exactly)

- Bundled Chromium is resolved by `src/offline/BundledBrowserResolver.ts` from
  `getResourcesRoot()/browsers/chromium/chrome.exe`; **not committed to git** (bundled at package
  time). `resources/browsers` exists locally but is untracked — the exact precedent for a vendored
  JRE + Oracle jars.
- `getResourcesRoot()` (`app/main/appPaths.ts`) → `process.resourcesPath/resources` when packaged,
  else `<cwd>/resources`. Mutable data lives under `%LOCALAPPDATA%/SpecterStudio/`
  (`RUNTIME_DATA_FOLDER`). **Never** write into `resources/`.
- `electron-builder.json` ships `resources/**` (minus a few) + `vendor/**` via `extraResources`.
- Offline validation: `src/offline/OfflineRuntimeValidator.ts`,
  `src/offline/DependencyManifest.ts`, `resources/dependency-manifest.json`,
  `scripts/validate-offline-bundle.ps1`, `scripts/generate-dependency-manifest.ps1`.

**Correction adopted:** package under `resources/oracle-jdbc/` (JRE + bridge jar + ojdbc/ucp jars +
`manifest.json` + `checksums.json` + `LICENSES/`), **untracked** and vendored at package time exactly
like Chromium. Add an `OracleRuntimeResolver` + validator mirroring `BundledBrowserResolver` +
`OfflineRuntimeValidator`, and extend `extraResources` + `validate-offline-bundle.ps1`.

### 2.6 IPC / preload / verify conventions

- Register a new `oracle.ipc.ts` in `app/main/ipc/index.ts`; expose an `oracle` domain in
  `app/main/preload.ts`. The global sender guard wraps **every** handler; add `assertTrustedSender`
  to write/execute channels too.
- Verifiers: `tsx scripts/verify-*.mts` for logic, `node scripts/verify-*-gui.mjs` for GUI. The
  build gate is `npm run build` (`tsc --noEmit` + `electron-vite build`). No lint/test scripts.

---

## 3. Environment constraints discovered (this machine / session)

These materially shape what is buildable-and-verifiable here vs. what is an external gate.

| Constraint | Evidence | Impact |
|---|---|---|
| **Build-time network blocked** | `repo1.maven.org` unreachable; no `com.oracle`/`jackson` in `~/.m2` | Cannot fetch `ojdbc`/`ucp`/`jackson` at build time → the bridge **core** must be **zero-dependency (pure JDK)**; Oracle driver integration is compiled/run only when jars are vendored. |
| **Inconsistent JDK on PATH** | `JAVA_HOME=jdk1.8.0_251`, PATH `java/javac`=17 (`C:\Program Files\Java\jdk-17`), `jlink`=11 | Build scripts must **pin JDK 17 explicitly** (`C:\Program Files\Java\jdk-17`), never trust `JAVA_HOME`/PATH; do not use Maven's default `JAVA_HOME` (it is JDK 8). |
| **No Docker / no local Oracle** | `docker` not found | **Phase 13 real-Oracle validation is an external gate.** Provide a mock-JDBC path + an env-gated `verify:oracle-live` runbook. |
| JDK 17 compiles+runs offline | `javac 17.0.8` compiled/ran a test class | The bridge **core** (protocol/policy/handshake/health/cancel) is fully buildable & testable here. |

**Design consequence — two-tier bridge build:**

- **Core** (`no external jars`): JSON codec, stdio length-prefixed framing, request dispatch,
  request lifecycle + cancellation registry, SQL read-only policy, a `MockQueryExecutor`. Compiles
  with pinned `javac 17`, runs under pinned `java 17`. Fully exercised by `verify:oracle-bridge`
  **without a database** (this is exactly Phase 02's completion criterion).
- **Oracle executor** (`needs ojdbc + ucp`): `OracleUcpQueryExecutor` implementing the same
  `QueryExecutor` interface, loaded reflectively / compiled in a separate source set only when the
  jars are present. Absent jars ⇒ the bridge still starts, handshakes, health-checks, and validates
  SQL; `testConnection`/`executeQuery` return a structured `DRIVER_UNAVAILABLE` error. This mirrors
  Chromium being absent from a dev checkout.

---

## 4. Final architecture (adopted)

```text
Renderer (DataSourceManager / FlowNodePropertiesPanel)
  │  window.playwrightFlowStudio.oracle.*  (validated IPC, sender-guarded)
  ▼
Electron Main
  ├─ oracle.ipc.ts ─────────────┐
  │                             ▼
  │                     OracleProfileStore (JsonProfileStore)  ──► SecretStore (DPAPI)
  │                             │
  └─ ExecutionEngine ──► StepExecutor(case "oracle")           │
        │                       │                              │
        └─ DataSourceResolver ──┴──►  OracleQueryService  ◄────┘   (single authority: policy,
                                          │                          bind typing, timeout, cancel,
                                          │                          error mapping, telemetry)
                                          ▼
                                 OracleJdbcBridgeClient / Manager  (owns child process)
                                          │  length-prefixed JSON-RPC over stdin/stdout
                                          ▼
                        Bundled private Java runtime + awkit-oracle-jdbc-bridge.jar
                                          │  JDBC Thin + UCP  (vendored jars)
                                          ▼
                                    Oracle Database
```

Rejected (per source plan, confirmed against AWKIT reality): renderer→DB access; a public
localhost HTTP service; shell-built commands; plaintext temp credential files; a second Data Source
framework; a second secret store; a worker-thread bridge IPC hop (unneeded — runner is in main).

---

## 5. Bridge protocol (v1)

- **Transport:** child process stdio. **Framing:** 4-byte big-endian unsigned length prefix + UTF-8
  JSON body. `stderr` is a separate redacted diagnostic channel (never carries results).
- **Envelope:** `{ "v": 1, "id": "<uuid>", "op": "<operation>", "params": { … } }` →
  `{ "v": 1, "id": "<same>", "ok": true, "result": { … } }` or
  `{ "v": 1, "id": "<same>", "ok": false, "error": { "category": "<ENUM>", "message": "<safe>",
  "retriable": <bool> } }`.
- **Operations:** `hello` (handshake: protocol/bridge/driver versions, `driverAvailable`),
  `health`, `testConnection`, `executeQuery`, `cancelQuery`, `closePool`, `shutdown`.
- **Limits:** `maxMessageBytes` (default 16 MiB) enforced on both read and write; oversize ⇒
  `MESSAGE_TOO_LARGE` and the frame is drained/rejected, connection stays alive.
- **Error categories:** `AUTHENTICATION_FAILED | NETWORK_UNREACHABLE | SERVICE_NOT_FOUND |
  TLS_ERROR | WALLET_ERROR | TIMEOUT | DRIVER_ERROR | DRIVER_UNAVAILABLE | SQL_POLICY_VIOLATION |
  RESULT_LIMIT_EXCEEDED | INVALID_CONFIGURATION | CANCELLED | UNKNOWN`. Oracle `ORA-` codes kept
  internal; only safe messages cross the boundary.
- **Redaction:** the bridge never logs passwords, wallet secrets, bind values, credential-bearing
  URLs, or returned rows.
- **Lifecycle (TS `OracleJdbcBridgeManager`):** lazy start; one bridge per AWKIT runtime; version
  handshake on start; bounded restart on crash (cap + cooldown); per-request timeout + cleanup;
  cancellation propagation; graceful `shutdown`; **no orphan Java process** (kill tree on quit).

---

## 6. Module inventory (what each phase adds)

TypeScript / repo:

- `oracle-jdbc-bridge/` — Java module (Maven POM with pinned versions; `src/main/java` core +
  oracle source set; `src/test/java`; `README`, `LICENSES`). Core builds offline; oracle set gated.
- `src/oracle/OracleBridgeProtocol.ts` — envelope/opcodes/error types/framing constants (shared).
- `src/oracle/OracleJdbcBridgeManager.ts`, `OracleJdbcBridgeClient.ts` — process + RPC client.
- `src/oracle/OracleSqlPolicy.ts` — read-only tokenizer (TS mirror of the Java policy).
- `src/oracle/OracleTypeConversion.ts` — deterministic Oracle→JSON conversion + limits (TS side).
- `src/oracle/OracleQueryService.ts` — the single query authority (main process).
- `src/oracle/OracleConnectionProfile.ts`, `src/oracle/OracleDataSource.ts` — models.
- `src/data/DataSourceProfile.ts` — widen to a discriminated union (`jsonArray | oracle`).
- `src/data/DataSourceResolver.ts` — new pure resolver → `ResolvedDataSource` for all types.
- `src/oracle/OracleRuntimeResolver.ts` — bundled runtime/jar/checksum/health validator.
- `app/main/ipc/oracle.ipc.ts` (+ preload `oracle` domain) — profiles/data-source/test/preview/
  snapshot-refresh channels.
- `app/main/oracleService.ts` — main-process wiring (store + secrets + service singleton).
- Renderer: Oracle branch in `DataSourceManager`/`DataSourceEditor`; `oracle` section in
  `FlowNodePropertiesPanel`; catalog/registry entries.
- `scripts/verify-oracle-*.mts` (+ `oracle-live` env-gated) and `scripts/build-oracle-bridge.*`.

---

## 7. Corrections applied to the source phase docs (summary)

1. Phase 04 "extend `DataSourceResolver.resolve(...)`" → **no such resolver exists**; create one and
   wire it at `resolveWorkflowDataSources` (execution.ipc.ts). Keep the `ResolvedDataSource`
   array-of-objects contract; add an optional lazy `loadRows()` for runtime mode.
2. Phase 03 `passwordSecretRef` → **a secret NAME** in the existing by-name `SecretStore`
   (`oracle.<id>.password`). No new ref format, no new store.
3. Phase 08 "node type registry / serialization / migration / executor dispatch" → the five
   FlowStep touch-points in §2.2; backward compat via optional fields, not a migration engine.
4. Phase 02/07 "bridge from the runner" → runner is in **main**; `OracleQueryService` owns the
   process directly. No worker→main IPC hop.
5. Phase 02 versions/runtime → **pin JDK 17** (`C:\Program Files\Java\jdk-17`), do not trust
   `JAVA_HOME`/PATH; bridge **core is zero-dependency** so it builds offline; ojdbc/ucp/JRE are
   vendored at package time like Chromium (not committed).
6. Phase 12 layout → mirror the Chromium precedent (`BundledBrowserResolver` +
   `OfflineRuntimeValidator` + `dependency-manifest.json` + `validate-offline-bundle.ps1`).
7. Phase 13 real-Oracle + Phase 12 packaged-EXE rebuild → **external gates** (no Docker here; and
   CURRENT_STATE notes the packaged rebuild currently OOMs). Mock-JDBC + env-gated `verify:oracle-live`.
8. Add a TS mirror of the read-only SQL policy so the renderer/main reject non-SELECT **before**
   ever spawning the bridge (defense in depth; the Java side re-validates authoritatively).

---

## 8. Risks

- **Vendored-binary gate:** without ojdbc/ucp/JRE (network-blocked here), the live JDBC path cannot
  be exercised in this session — only the mock path. Mitigated by the two-tier bridge + a documented
  vendoring/build runbook, and by the fact that this exactly mirrors how Chromium is handled.
- **Type fidelity:** Oracle `NUMBER` → JS number loses precision beyond 2^53; policy = emit
  high-precision numbers as strings and flag precision loss (never silently truncate).
- **Cancellation races:** late bridge results must not update a cancelled run — enforce via a
  per-request "settled/cancelled" guard in `OracleQueryService`.
- **Orphan Java process:** must kill the bridge tree on app quit and on manager disposal.
- **Runtime-mode lazy contract:** `resolveWorkflowDataSources` is eager today; the lazy loader must
  not break JSON sources or the parallel-branch single-flight cache.

---

## 9. Revised phase order & done criteria

Order is unchanged (01→14) but with the corrections above. A phase is "done" when it **builds green
(`npm run build`)** and its focused `verify:oracle-*` passes. Live-DB, jar/JRE vendoring, and
packaged-EXE items are explicitly tracked as **external gates**, surfaced in the final report's
blockers rather than silently skipped.

Release status is **INTEGRATION-CANDIDATE** (corrected 2026-07-17 — an earlier `PRODUCTION-CANDIDATE`
claim was over-stated: the real executor had never compiled and no authorized Oracle had been used).
Transitions:

```text
INTEGRATION-CANDIDATE
    ↓ real OracleUcpQueryExecutor compiles against real jars + authorized Oracle suite passes (Phase 06)
PRODUCTION-CANDIDATE
    ↓ bundled private runtime + packaged EXE + offline/clean-machine validation pass (Phases 08/09/10)
PRODUCTION-READY
```
