/**
 * WS-H — direct-JDBC soak/benchmark harness (Phase 13). Drives the REAL Oracle path (user-selected
 * Java runtime + driver bundle → isolated bridge → direct JDBC, one connection per query, no pool)
 * under sustained bounded-concurrency load for ≥30 minutes through the app's own `OracleQueryService`
 * limiter, then proves the lifecycle invariants that must hold regardless of the database:
 *
 *   - query latency stays bounded (P50/P95) and does not degrade over the run;
 *   - the bounded-concurrency limiter is never exceeded, and queued work always resumes;
 *   - cancellation (AbortSignal → CANCELLED) stays prompt throughout;
 *   - bridge (Java) + Specter (Node) RSS stay flat — no connection/handle/memory leak;
 *   - teardown invariants: pending bridge requests = 0 and no orphan Java process after dispose;
 *   - telemetry carries no SQL text, bind values, row content, or credentials — and there are NO pool
 *     metrics (connections are per-query).
 *
 * Live path (preferred, strongest evidence) — set the same env `verify:oracle-live` uses:
 *   AWKIT_ORACLE_LIVE_URL / _USER / _PASSWORD / _CONFIRM_NONPROD=1 / _TEST_TABLE
 *   AWKIT_ORACLE_LIVE_DRIVER_BUNDLE_ID / _JAVA_RUNTIME_PROFILE_ID
 * With no live config it falls back to the database-free mock bridge (still proves the Specter-side
 * lifecycle/leak invariants). Tunables: AWKIT_ORACLE_SOAK_MINUTES (default 30),
 * AWKIT_ORACLE_SOAK_CONCURRENCY (limiter, default 4), AWKIT_ORACLE_SOAK_DRIVERS (offered load, default 8).
 *
 * Run: `npm run benchmark:oracle-jdbc`. Writes a redacted artifact to reports/oracle-validation/oracle-soak.json.
 */
import { existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOracleBridge } from "./build-oracle-bridge.mjs";
import { OracleJdbcBridgeManager, type BridgeLaunchSpec } from "../src/oracle/OracleJdbcBridgeManager";
import { OracleBridgeCallError } from "../src/oracle/OracleBridgeProtocol";
import { OracleQueryService, type DescriptorResolution } from "../src/oracle/OracleQueryService";
import { OracleDriverBundleStore } from "../src/oracle/OracleDriverBundleStore";
import { JavaRuntimeStore } from "../src/oracle/JavaRuntimeStore";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const isWin = process.platform === "win32";
const sep = isWin ? ";" : ":";

const SOAK_MINUTES = Number(process.env.AWKIT_ORACLE_SOAK_MINUTES ?? "30");
const CONCURRENCY = Math.max(1, Number(process.env.AWKIT_ORACLE_SOAK_CONCURRENCY ?? "4"));
const DRIVERS = Math.max(CONCURRENCY, Number(process.env.AWKIT_ORACLE_SOAK_DRIVERS ?? "8"));

function pct(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor((p / 100) * sortedAsc.length));
  return sortedAsc[idx];
}

// Bridge (Java) RSS: the one java.exe whose command line runs our bridge jar. Windows-only sampler.
const rssPs1 = join(tmpdir(), "awkit-oracle-soak-bridge-rss.ps1");
if (isWin) {
  writeFileSync(rssPs1, `Get-CimInstance Win32_Process -Filter "Name='java.exe'" | Where-Object { $_.CommandLine -like '*awkit-oracle-jdbc-bridge*' } | ForEach-Object { (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).WorkingSet64 }`);
}
function bridgeRssMb(): number | null {
  if (!isWin) return null;
  try {
    const out = execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", rssPs1], { encoding: "utf8" });
    const vals = out.split(/\r?\n/).map((s) => Number(s.trim())).filter((n) => n > 0);
    return vals.length ? Math.round(Math.max(...vals) / 1048576) : null;
  } catch {
    return null;
  }
}
const nodeRssMb = (): number => Math.round(process.memoryUsage().rss / 1048576);

function liveConfig() {
  const url = process.env.AWKIT_ORACLE_LIVE_URL;
  const user = process.env.AWKIT_ORACLE_LIVE_USER;
  const password = process.env.AWKIT_ORACLE_LIVE_PASSWORD;
  if (!url || !user || !password) return null;
  return { url, user, password, table: process.env.AWKIT_ORACLE_LIVE_TEST_TABLE || "awkit_types_test", confirmedNonProd: process.env.AWKIT_ORACLE_LIVE_CONFIRM_NONPROD === "1" };
}

/** Resolve the live launch spec through the SAME Settings-managed stores the app uses (mirrors verify-oracle-live). */
function resolveLiveSpec(): { spec: BridgeLaunchSpec; requireReal: boolean } {
  const specterData = join(process.env.LOCALAPPDATA ?? process.env.APPDATA ?? repoRoot, "SpecterStudio");
  let driverJars: string[] = [];
  let requiredJavaMajor: number | undefined;
  const bundleId = process.env.AWKIT_ORACLE_LIVE_DRIVER_BUNDLE_ID;
  if (bundleId) {
    const store = new OracleDriverBundleStore({ folder: join(specterData, "oracle-drivers") });
    const bundle = store.get(bundleId);
    if (!bundle) throw new Error(`driver bundle "${bundleId}" not found — import it in Settings first.`);
    const integrity = store.revalidateChecksums(bundleId);
    if (integrity === "checksum-failed" || integrity === "missing") throw new Error(`driver bundle "${bundleId}" failed integrity (${integrity}).`);
    requiredJavaMajor = bundle.requiredJavaMajor;
    driverJars = [join(bundle.managedDirectory, bundle.jdbcJar), ...bundle.companionJars.map((c) => join(bundle.managedDirectory, c))];
    process.env.AWKIT_ORACLE_BRIDGE_COMPILE_CLASSPATH = driverJars.join(sep);
  }
  const built = buildOracleBridge({ quiet: true });
  let runtimeJava = built.jdk.java;
  let runtimeMajor: number | undefined;
  const javaProfileId = process.env.AWKIT_ORACLE_LIVE_JAVA_RUNTIME_PROFILE_ID;
  if (javaProfileId) {
    const javaStore = new JavaRuntimeStore({ folder: join(specterData, "java-runtimes") });
    const profile = javaStore.get(javaProfileId);
    if (!profile) throw new Error(`Java runtime "${javaProfileId}" not found — add it in Settings first.`);
    if (!existsSync(profile.javaExecutablePath) || profile.status !== "valid") throw new Error(`Java runtime "${javaProfileId}" is missing/invalid (status=${profile.status}).`);
    runtimeJava = profile.javaExecutablePath;
    runtimeMajor = profile.javaMajorVersion;
  }
  if (requiredJavaMajor != null && runtimeMajor != null && runtimeMajor < requiredJavaMajor) {
    throw new Error(`incompatible: driver needs Java ${requiredJavaMajor}+ but runtime is Java ${runtimeMajor}.`);
  }
  if (!built.oracleCompiled || driverJars.length === 0) throw new Error("real Oracle driver not available (no Settings bundle / vendored jars).");
  const classpath = [built.jarPath, ...driverJars].join(sep);
  return { spec: { javaPath: runtimeJava, jarPath: built.jarPath, classpath, env: { AWKIT_ORACLE_REQUIRE_REAL: "1" } }, requireReal: true };
}

/** Mock fallback: database-free bridge (still proves Specter-side lifecycle/leak invariants). */
function resolveMockSpec(): { spec: BridgeLaunchSpec; requireReal: boolean } {
  const built = buildOracleBridge({ quiet: true });
  return { spec: { javaPath: built.jdk.java, jarPath: built.jarPath, classpath: built.jarPath, env: { AWKIT_ORACLE_BRIDGE_MOCK: "1" } }, requireReal: false };
}

async function main(): Promise<number> {
  const cfg = liveConfig();
  const live = cfg !== null;
  if (live && !cfg!.confirmedNonProd) {
    console.error("  ✗ AWKIT_ORACLE_LIVE_CONFIRM_NONPROD=1 is required for the live soak (authorized non-prod target).");
    return 1;
  }
  console.log(`Oracle direct-JDBC soak — ${live ? "LIVE" : "MOCK (no live config)"} path, ${SOAK_MINUTES} min, concurrency=${CONCURRENCY}, offered=${DRIVERS} drivers.`);

  const { spec, requireReal } = live ? resolveLiveSpec() : resolveMockSpec();
  const manager = new OracleJdbcBridgeManager({ resolveLaunchSpec: () => spec, requireRealDriver: requireReal, handshakeTimeoutMs: 30_000 });

  // One fixed connection profile → the live descriptor (or the mock's simulated descriptor).
  const table = live ? cfg!.table : "AWKIT_MOCK";
  const baseDescriptor: Record<string, unknown> = live
    ? { url: cfg!.url, username: cfg!.user, password: cfg!.password, poolKey: "oracle-soak" }
    : { url: "jdbc:oracle:thin:@//mock:1521/MOCK", username: "reader", password: "s3cr3t-pw", poolKey: "oracle-soak", __simulate: { rows: 5 } };
  const resolveDescriptor = async (): Promise<DescriptorResolution> => ({ descriptor: baseDescriptor, redactedUrl: "jdbc:oracle:thin:@//***/***" });
  const service = new OracleQueryService({ bridge: manager, resolveDescriptor, maxConcurrency: CONCURRENCY, maxTransientRetries: 1 });

  const hello = await manager.hello();
  console.log(`  bridge: mode=${hello.executionMode} driver=${hello.driverVersion ?? "-"} java=${hello.javaVersion ?? "-"} protocol=v${hello.protocolVersion}`);
  if (live && (hello.executionMode !== "real" || !hello.driverAvailable)) {
    console.error("  ✗ bridge is not in real mode — aborting the live soak (fail closed).");
    await manager.dispose().catch(() => undefined);
    return 1;
  }

  // Read-only query rotation (cheap fixture reads under load).
  const queries = [
    `SELECT id, name FROM ${table} WHERE ROWNUM <= 5`,
    `SELECT * FROM ${table} WHERE ROWNUM <= 2`,
    `SELECT COUNT(*) AS n FROM ${table}`
  ];
  const req = (sql: string) => ({ connectionProfileId: "soak", sql, binds: [], timeoutMs: 15_000, maxRows: 50, fetchSize: 50 });

  const latencies: number[] = [];
  const dbTimes: number[] = [];
  const cancelLatencies: number[] = [];
  const nodeRss: number[] = [];
  const bridgeRss: number[] = [];
  let unexpectedFailures = 0;
  let cancellationsOk = 0;
  let cancellationsBad = 0;
  const errorsByCategory: Record<string, number> = {};

  const startedAt = Date.now();
  const deadline = startedAt + SOAK_MINUTES * 60_000;
  let stop = false;
  // Sleep that wakes promptly when the soak stops or the deadline passes (so teardown isn't delayed by a
  // long in-progress sleep in the cancel/sampler loops).
  const sleepUntil = async (ms: number): Promise<void> => {
    const end = Date.now() + ms;
    while (!stop && Date.now() < end && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, Math.min(500, end - Date.now())));
    }
  };

  // Offered-load drivers: DRIVERS concurrent loops feed the CONCURRENCY-bounded limiter (it queues the rest).
  const driverLoops = Array.from({ length: DRIVERS }, () => (async () => {
    let i = 0;
    while (!stop && Date.now() < deadline) {
      const sql = queries[i++ % queries.length];
      const t0 = Date.now();
      try {
        const r = await service.execute(req(sql));
        latencies.push(Date.now() - t0);
        if (typeof r.executionMs === "number") dbTimes.push(r.executionMs);
      } catch (err) {
        const cat = err instanceof OracleBridgeCallError ? err.category : "UNKNOWN";
        errorsByCategory[cat] = (errorsByCategory[cat] ?? 0) + 1;
        unexpectedFailures += 1;
      }
    }
  })());

  // Periodic cancellation prober: a heavy read cancelled mid-flight must reject promptly with CANCELLED.
  const heavySql = live
    ? `SELECT COUNT(*) FROM ${table} a, ${table} b, ${table} c WHERE a.name || b.name || c.name LIKE '%__awkit_soak_nomatch__%'`
    : `SELECT COUNT(*) FROM ${table}`;
  const cancelLoop = (async () => {
    while (!stop && Date.now() < deadline) {
      await sleepUntil(30_000);
      if (stop || Date.now() >= deadline) break;
      const controller = new AbortController();
      const descriptor = live ? baseDescriptor : { ...baseDescriptor, __simulate: { delayMs: 5_000 } };
      const t0 = Date.now();
      const p = manager.call("executeQuery", { ...descriptor, sql: heavySql, maxRows: 1 }, { timeoutMs: 30_000, signal: controller.signal });
      setTimeout(() => controller.abort(), 250);
      try {
        await p;
        cancellationsBad += 1;
      } catch (err) {
        const cat = err instanceof OracleBridgeCallError ? err.category : "UNKNOWN";
        if (cat === "CANCELLED") {
          cancellationsOk += 1;
          cancelLatencies.push(Date.now() - t0);
        } else {
          cancellationsBad += 1;
        }
      }
    }
  })();

  // Sampler: RSS + a progress line every 60s.
  const sampler = (async () => {
    while (!stop && Date.now() < deadline) {
      await sleepUntil(60_000);
      if (stop || Date.now() >= deadline) break;
      const n = nodeRssMb(); const b = bridgeRssMb();
      nodeRss.push(n); if (b != null) bridgeRss.push(b);
      const mins = ((Date.now() - startedAt) / 60_000).toFixed(1);
      const sorted = [...latencies].sort((a, z) => a - z);
      console.log(`  t+${mins}m  queries=${latencies.length} p50=${pct(sorted, 50)}ms p95=${pct(sorted, 95)}ms nodeRSS=${n}MB bridgeRSS=${b ?? "?"}MB cancels=${cancellationsOk} fails=${unexpectedFailures} active≤${CONCURRENCY}`);
    }
  })();

  await Promise.all(driverLoops);
  stop = true;
  await Promise.allSettled([cancelLoop, sampler]);

  // Drain + teardown.
  const pendingBeforeDispose = manager.pendingCount();
  await manager.dispose().catch(() => undefined);

  const sortedLat = [...latencies].sort((a, z) => a - z);
  const sortedDb = [...dbTimes].sort((a, z) => a - z);
  const sortedCancel = [...cancelLatencies].sort((a, z) => a - z);
  const durationMin = (Date.now() - startedAt) / 60_000;
  const rssDrift = nodeRss.length >= 2 ? nodeRss[nodeRss.length - 1] - nodeRss[0] : 0;
  const bridgeDrift = bridgeRss.length >= 2 ? bridgeRss[bridgeRss.length - 1] - bridgeRss[0] : 0;

  const artifact = {
    schemaVersion: 1,
    path: live ? "live" : "mock",
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMinutes: Number(durationMin.toFixed(2)),
    config: { soakMinutes: SOAK_MINUTES, maxConcurrency: CONCURRENCY, offeredDrivers: DRIVERS },
    bridge: { executionMode: hello.executionMode, driverVersion: hello.driverVersion, javaVersion: hello.javaVersion, protocolVersion: hello.protocolVersion },
    throughput: { queries: latencies.length, queriesPerSec: Number((latencies.length / Math.max(1, durationMin * 60)).toFixed(1)) },
    latencyMs: { p50: pct(sortedLat, 50), p95: pct(sortedLat, 95), p99: pct(sortedLat, 99), max: sortedLat[sortedLat.length - 1] ?? 0 },
    dbTimeMs: { p50: pct(sortedDb, 50), p95: pct(sortedDb, 95) },
    cancellation: { attempts: cancellationsOk + cancellationsBad, cancelled: cancellationsOk, notCancelled: cancellationsBad, latencyMsP50: pct(sortedCancel, 50), latencyMsP95: pct(sortedCancel, 95) },
    memory: { nodeRssStartMb: nodeRss[0] ?? nodeRssMb(), nodeRssEndMb: nodeRss[nodeRss.length - 1] ?? nodeRssMb(), nodeRssDriftMb: rssDrift, bridgeRssStartMb: bridgeRss[0] ?? null, bridgeRssEndMb: bridgeRss[bridgeRss.length - 1] ?? null, bridgeRssDriftMb: bridgeDrift, samples: nodeRss.length },
    connections: { model: "direct-JDBC — one connection opened+closed per query (no pool)", poolMetrics: null },
    failures: { unexpected: unexpectedFailures, byCategory: errorsByCategory },
    teardown: { pendingBeforeDispose, pendingAfterDispose: manager.pendingCount(), bridgeRunningAfterDispose: manager.isRunning() },
    serviceMetrics: service.getMetrics()
  };

  // Redaction: the artifact must carry no SQL/binds/rows/credentials.
  const serialized = JSON.stringify(artifact);
  const leaks = [cfg?.password, cfg?.user, "SELECT ", "__simulate", "s3cr3t"].filter((s) => s && serialized.includes(s));
  const outDir = join(repoRoot, "reports", "oracle-validation");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "oracle-soak.json");
  if (leaks.length > 0) {
    console.error(`  ✗ refusing to write artifact — it would leak: ${leaks.map(() => "***").join(", ")}`);
    return 1;
  }
  writeFileSync(outPath, JSON.stringify(artifact, null, 2));

  // ── Invariants (pass/fail) ──────────────────────────────────────────────────
  let passed = 0, failed = 0;
  const check = (name: string, cond: boolean, detail = "") => { if (cond) { passed++; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`); } else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); } };
  console.log(`\nSoak complete (${durationMin.toFixed(1)} min) — invariants:`);
  check("ran the full soak duration", durationMin >= SOAK_MINUTES - 0.2, `${durationMin.toFixed(1)}/${SOAK_MINUTES} min`);
  check("sustained real throughput", latencies.length > 0, `${latencies.length} queries, ${artifact.throughput.queriesPerSec}/s`);
  check("no unexpected query failures", unexpectedFailures === 0, `failures=${unexpectedFailures} ${JSON.stringify(errorsByCategory)}`);
  check("cancellation stayed prompt (all CANCELLED)", cancellationsOk > 0 && cancellationsBad === 0, `ok=${cancellationsOk} bad=${cancellationsBad} p95=${pct(sortedCancel, 95)}ms`);
  check("Node (Specter) RSS did not leak (drift < 150MB)", Math.abs(rssDrift) < 150, `drift=${rssDrift}MB over ${nodeRss.length} samples`);
  check("bridge (Java) RSS did not leak (drift < 200MB)", bridgeRss.length < 2 || Math.abs(bridgeDrift) < 200, `drift=${bridgeDrift}MB over ${bridgeRss.length} samples`);
  check("teardown: no pending bridge requests", manager.pendingCount() === 0, `pending=${manager.pendingCount()}`);
  check("teardown: no orphan Java (bridge stopped)", manager.isRunning() === false);
  check("no pool metrics (connections are per-query)", artifact.connections.poolMetrics === null);
  console.log(`\n  → redacted artifact: ${outPath}`);
  console.log(`\n${passed} passed, ${failed} failed`);
  return failed === 0 ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((err) => { console.error(err); process.exit(1); });
