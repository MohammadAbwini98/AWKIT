# Oracle JDBC — External Validation Gates

> **Blocker verification — 2026-07-17.** These gates are not assumed; they were probed on this machine and
> confirmed. Re-run these checks before claiming a gate is still blocked:
>
> | Probe | Command | Result |
> |---|---|---|
> | ojdbc/ucp jars anywhere | `find ~/.m2 ~/Downloads ~/Desktop -iname "ojdbc*.jar" -o -iname "ucp*.jar"` | **none found** |
> | Artifact acquisition | `curl -m 12 https://repo1.maven.org/maven2/com/oracle/database/jdbc/ojdbc11/maven-metadata.xml` | **HTTP 000 (blocked)** |
> | Local Oracle container | `docker --version` | **not available** |
> | Authorized DB credentials | `env | grep AWKIT_ORACLE_LIVE` | **unset** |
> | JDK for the bridge | `java -version` | ✅ 17.0.8 (bridge builds) |
>
> Consequence: every gate below is blocked at its **first** step — acquiring the artifacts. Nothing
> downstream (compile → live suite → pooling → packaging → EXE → soak) can start until that clears. Per the
> governing rule, these are documented as **not run** rather than approximated or claimed.
>
> **Phase-numbering note.** Two plans cover this work with different numbering. Mapping the 2026-07-17
> "pending implementation" plan (01–12) onto this document:
>
> | Pending-plan phase | State |
> |---|---|
> | 01 Confirm committed baseline | ✅ done — `main` @ `b6e473d`, build + 226 Oracle checks green |
> | 02 Lock & stage runtime artifacts | ⛔ **BLOCKED** — no jars/JRE, acquisition network blocked (§Prerequisite) |
> | 03 Compile real JDBC/UCP executor | ⛔ **BLOCKED** by 02 (stub-compile passes; real-jar compile cannot run) |
> | 04 Revalidate fail-closed | 🟡 **4 of 5 rows proven** without jars; only `packaged + valid real bundle → real executor` is blocked by 02 |
> | 05 Authorized Oracle integration suite | ⛔ **BLOCKED** — no authorized DB (§Phase 06 below) |
> | 06 Real UCP pooling & cancellation | ⛔ **BLOCKED** by 02 + 05 |
> | 07 Lazy runtime Data Source behavior | ✅ done — now proven against the **real bridge process** with real `executeQuery` RPC counters (20/20) |
> | 08 Full AWKIT regression | ✅ done — green; one pre-existing `durable-store` failure proven unrelated (fails identically at `dee283e`, pre-Oracle) |
> | 09 Package private Java/JDBC runtime | ⛔ **BLOCKED** by 02 (wiring + validator implemented; the artifacts do not exist) |
> | 10 Validate actual packaged EXE | ⛔ **BLOCKED** by 09 + no clean Windows machine |
> | 11 Real performance & soak | ⛔ **BLOCKED** by 05 |
> | 12 Final report & release status | ✅ done — status stays **INTEGRATION-CANDIDATE** (see the report's §17 summary block) |

Everything in the AWKIT Oracle feature that can be verified **without** a real Oracle database, the
vendored driver jars, or a packaged clean machine is implemented and automated (see the `verify:oracle-*`
scripts). The three phases below are **external gates**: they need infrastructure this development
environment does not have (no authorized Oracle DB, no build-time network to vendor jars, no clean
Windows box). This runbook is the exact procedure to clear them when that infrastructure is available.

Release status stays **INTEGRATION-CANDIDATE** until Phase 06 passes (→ PRODUCTION-CANDIDATE), and does
not reach **PRODUCTION-READY** until Phases 09 + 10 also pass.

---

## Prerequisite: vendor the runtime (unblocks everything below)

1. Acquire out-of-band (no runtime/build downloads in AWKIT): a private JRE (Temurin 17), `ojdbc11.jar`,
   `ucp11.jar`, and the required license notices. See
   [`ORACLE_JDBC_RUNTIME_MATRIX.md`](ORACLE_JDBC_RUNTIME_MATRIX.md).
2. Fill the real versions + sha256 hashes into
   [`scripts/oracle/oracle-runtime.manifest.json`](../../scripts/oracle/oracle-runtime.manifest.json).
3. Stage the artifacts and run `npm run prepare:oracle-runtime` → stages `resources/oracle-jdbc/`,
   builds the bridge (compiling `OracleUcpQueryExecutor`), and writes `checksums.json`.
4. `npm run verify:oracle-bridge-real-build` — now runs the **live** branch: clean real build, real-mode
   handshake, safe error mapping, clean shutdown.

---

## Phase 06 — Authorized Oracle functional validation → PRODUCTION-CANDIDATE

1. Provision [`scripts/oracle/oracle-live-fixture.sql`](../../scripts/oracle/oracle-live-fixture.sql) on
   an **authorized, non-production** database; `GRANT SELECT` to the least-privilege account from
   [`ORACLE_JDBC_DB_ACCOUNT_RUNBOOK.md`](ORACLE_JDBC_DB_ACCOUNT_RUNBOOK.md).
2. Export `AWKIT_ORACLE_LIVE_URL`, `AWKIT_ORACLE_LIVE_USER`, `AWKIT_ORACLE_LIVE_PASSWORD`,
   `AWKIT_ORACLE_LIVE_CONFIRM_NONPROD=1`.
3. `npm run verify:oracle-live` → runs the functional matrix (connect, prepared binds, empty/one/many
   rows, truncation, type conversion, invalid SQL, permission failure, cancellation, connection loss,
   result-size limits) and writes a redacted `reports/oracle-validation/oracle-live.json`.
4. Validate UCP behavior: pool creation, reuse, max-size enforcement, wait under saturation, invalid-
   connection replacement, idle retirement, profile separation, pool close, **zero borrowed at teardown**.
   Record query + pool-wait P50/P95.
5. Confirm the cancellation chain: `AbortSignal → cancelQuery RPC → Statement.cancel() → request ends →
   connection safely returned/discarded → no late result`.

**Done when** real driver, real UCP behavior, real Oracle error mapping, cancellation, and type
conversions are all proven. Move status to PRODUCTION-CANDIDATE.

---

## Phase 09 — Packaged EXE offline + clean-machine walkthrough → (toward) PRODUCTION-READY

Use a clean Windows x64 machine: **no** system Java, **no** project dependencies, **no** dev env vars,
**no** external Oracle jars. Build portable + NSIS installer (`npm run build` then the packaging step)
after `prepare:oracle-runtime`.

Scenarios:
- **Oracle unused** → app starts, bridge stays lazy (never spawned).
- **Snapshot offline** → stored rows resolve with no DB connectivity.
- **Runtime unavailable** (remove `lib/` jars) → clear error, **no mock results** (fail closed).
- **Runtime available** → real query + all four Oracle node output types work.
- **Migration/restart** → profiles, snapshots, history, secret refs persist.
- **Explicit mock attempt** in packaged mode → rejected (set `AWKIT_ORACLE_BRIDGE_MOCK=1`; the app must
  ignore it and require real).

Shutdown invariants: `pending bridge requests = 0`, `active JDBC requests = 0`, `borrowed connections = 0`,
`open pools = 0`, `orphan Java processes = 0`.

Evidence → save hashes, screenshots, runtime summaries, offline results, and shutdown checks under the
gitignored `reports/oracle-validation/`. `npm run validate:offline` must pass (its Oracle section
verifies the bundle checksums, layout, real driver, and absence of secrets/wallets).

---

## Phase 10 — Real performance, soak, final report → PRODUCTION-READY

Measure: bridge cold start; first vs. pooled query; query P50/P95; pool-wait P50/P95; cancellation
latency; recovery; Java RSS; pool counts; snapshot capture time/size; truncation; CLOB conversion.

Soak: a sustained run (target ≥ 30 min) tracking queries, failures, cancellations, latency, pool wait,
bridge restarts, Java RSS, borrowed connections, pending requests, workflow failures, snapshot refreshes,
telemetry errors.

Teardown invariants: `active JDBC requests = 0`, `borrowed connections = 0`, `pending bridge requests = 0`,
`open pools = 0`, `orphan Java processes = 0`, `pending workflow runs = 0`.

**Done when** performance is characterized and the soak is clean. Update
[`ORACLE_JDBC_DATA_SOURCE_NODE_REPORT.md`](ORACLE_JDBC_DATA_SOURCE_NODE_REPORT.md) with the measured
numbers and set the final status per the transition rules.
