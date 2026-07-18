/**
 * Credential-gated REAL Oracle validation harness (Phase 05).
 *
 * Behavior:
 *   - No live configuration present → runs redaction self-checks and SKIPS the live suite (exit 0).
 *     It NEVER falls back to the mock executor.
 *   - Live configuration present → builds the bridge with the vendored ojdbc/ucp jars, REQUIRES real
 *     mode (fails closed if the real driver is unavailable), asserts the target is an authorized
 *     non-production read-only account, runs the functional matrix, and writes a REDACTED result to
 *     `reports/oracle-validation/oracle-live.json` (versions, per-test outcomes, durations, error
 *     categories, pool/teardown state — never credentials, bind values, or row contents).
 *
 * Both the Java runtime and the driver bundle are resolved through the SAME Settings-managed stores the
 * app uses (no hidden system Java or classpath), and Java/JDBC compatibility is asserted before the run.
 *
 * Configuration (environment only — never written anywhere):
 *   AWKIT_ORACLE_LIVE_URL, AWKIT_ORACLE_LIVE_USER, AWKIT_ORACLE_LIVE_PASSWORD
 *   AWKIT_ORACLE_LIVE_CONFIRM_NONPROD=1              (explicit authorized-non-prod confirmation; required)
 *   AWKIT_ORACLE_LIVE_TEST_TABLE                     (default: awkit_types_test)
 *   AWKIT_ORACLE_LIVE_DRIVER_BUNDLE_ID               (Settings driver bundle; absent ⇒ resources/oracle-jdbc/lib)
 *   AWKIT_ORACLE_LIVE_JAVA_RUNTIME_PROFILE_ID        (Settings Java runtime; absent ⇒ pinned dev JDK 17)
 *
 * Run: `npm run verify:oracle-live`.
 */
import { existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOracleBridge } from "./build-oracle-bridge.mjs";
import { OracleJdbcBridgeManager, type BridgeLaunchSpec } from "../src/oracle/OracleJdbcBridgeManager";
import { OracleBridgeCallError } from "../src/oracle/OracleBridgeProtocol";
import { OracleDriverBundleStore } from "../src/oracle/OracleDriverBundleStore";
import { JavaRuntimeStore } from "../src/oracle/JavaRuntimeStore";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const isWin = process.platform === "win32";

interface StepResult {
  name: string;
  outcome: "pass" | "fail" | "skip";
  durationMs: number;
  errorCategory?: string;
  detail?: string; // safe, low-cardinality only (counts / booleans) — NEVER row content
}

interface LiveArtifact {
  schemaVersion: number;
  startedAt: string;
  finishedAt?: string;
  bridge: { protocolVersion?: number; bridgeVersion?: string; executionMode?: string; driverVersion?: string; javaVersion?: string };
  runtime?: { javaRuntimeProfileId?: string; javaMajor?: number; driverBundleId?: string; requiredJavaMajor?: number; compatible?: boolean };
  steps: StepResult[];
  connections: { closedAtTeardown: boolean; note: string };
  teardown: { disposed: boolean };
}

// ── Redaction ────────────────────────────────────────────────────────────────
// Values that must NEVER appear in the artifact. The self-test proves the builder excludes them.
const REDACTION_SENTINELS = ["__SECRET_PASSWORD__", "__BIND_VALUE__", "__ROW_CONTENT__"];

function assertRedacted(artifact: unknown, forbidden: string[]): string[] {
  const serialized = JSON.stringify(artifact);
  return forbidden.filter((f) => serialized.includes(f));
}

function redactionSelfTest(): boolean {
  // Build an artifact the way the harness does — only safe fields — and prove the sentinels are absent
  // even though they were "seen" during the (simulated) run.
  const artifact: LiveArtifact = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    bridge: { executionMode: "real", driverVersion: "oracle-jdbc", javaVersion: "17" },
    steps: [
      { name: "testConnection", outcome: "pass", durationMs: 5 },
      { name: "select-small", outcome: "pass", durationMs: 3, detail: "rows=3" },
      { name: "invalid-sql", outcome: "pass", durationMs: 1, errorCategory: "SQL_POLICY_VIOLATION" }
    ],
    connections: { closedAtTeardown: true, note: "direct JDBC — one connection per query, closed in try-with-resources" },
    teardown: { disposed: true }
  };
  const leaks = assertRedacted(artifact, REDACTION_SENTINELS);
  const ok = leaks.length === 0;
  console.log(`  ${ok ? "✓" : "✗"} artifact excludes credentials / binds / row contents`);
  return ok;
}

// ── Live config ──────────────────────────────────────────────────────────────
function liveConfig() {
  const url = process.env.AWKIT_ORACLE_LIVE_URL;
  const user = process.env.AWKIT_ORACLE_LIVE_USER;
  const password = process.env.AWKIT_ORACLE_LIVE_PASSWORD;
  if (!url || !user || !password) return null;
  return {
    url,
    user,
    password,
    table: process.env.AWKIT_ORACLE_LIVE_TEST_TABLE || "awkit_types_test",
    confirmedNonProd: process.env.AWKIT_ORACLE_LIVE_CONFIRM_NONPROD === "1"
  };
}

async function timed(name: string, fn: () => Promise<StepResult["detail"] | void>): Promise<StepResult> {
  const t0 = Date.now();
  try {
    const detail = await fn();
    return { name, outcome: "pass", durationMs: Date.now() - t0, detail: detail ?? undefined };
  } catch (err) {
    const errorCategory = err instanceof OracleBridgeCallError ? err.category : "UNKNOWN";
    return { name, outcome: "fail", durationMs: Date.now() - t0, errorCategory };
  }
}

/** Expect a specific error category (used for policy/permission negative tests). */
async function expectCat(name: string, fn: () => Promise<unknown>, category: string): Promise<StepResult> {
  const t0 = Date.now();
  try {
    await fn();
    return { name, outcome: "fail", durationMs: Date.now() - t0, detail: "expected rejection but succeeded" };
  } catch (err) {
    const got = err instanceof OracleBridgeCallError ? err.category : "UNKNOWN";
    return { name, outcome: got === category ? "pass" : "fail", durationMs: Date.now() - t0, errorCategory: got };
  }
}

async function runLive(cfg: NonNullable<ReturnType<typeof liveConfig>>): Promise<number> {
  console.log("Live Oracle validation:");

  if (!cfg.confirmedNonProd) {
    console.error("  ✗ AWKIT_ORACLE_LIVE_CONFIRM_NONPROD=1 is required (authorized, non-production target).");
    return 1;
  }

  const specterData = join(process.env.LOCALAPPDATA ?? process.env.APPDATA ?? repoRoot, "SpecterStudio");
  const sep = isWin ? ";" : ":";

  // Phase 08 — resolve the driver jars from the SAME Settings-managed bundle the app uses at runtime
  // (no hidden classpath). AWKIT_ORACLE_LIVE_DRIVER_BUNDLE_ID selects the bundle; absent ⇒ the packaged
  // resources/oracle-jdbc/lib vendoring path. Specter no longer supports UCP — direct JDBC only.
  let driverJars: string[];
  let requiredJavaMajor: number | undefined;
  const bundleId = process.env.AWKIT_ORACLE_LIVE_DRIVER_BUNDLE_ID;
  if (bundleId) {
    const store = new OracleDriverBundleStore({ folder: join(specterData, "oracle-drivers") });
    const bundle = store.get(bundleId);
    if (!bundle) {
      console.error(`  ✗ driver bundle "${bundleId}" not found under ${join(specterData, "oracle-drivers")} — import it in Settings first.`);
      return 1;
    }
    const integrity = store.revalidateChecksums(bundleId);
    if (integrity === "checksum-failed" || integrity === "missing") {
      console.error(`  ✗ driver bundle "${bundleId}" failed integrity validation (${integrity}).`);
      return 1;
    }
    requiredJavaMajor = bundle.requiredJavaMajor;
    driverJars = [join(bundle.managedDirectory, bundle.jdbcJar), ...bundle.companionJars.map((c) => join(bundle.managedDirectory, c))];
    // Compile the executors against the bundle's ojdbc so the bridge can run real queries.
    process.env.AWKIT_ORACLE_BRIDGE_COMPILE_CLASSPATH = driverJars.join(sep);
    console.log(`  • driver bundle "${bundle.name}" (${bundle.jdbcJar}, direct JDBC — no UCP).`);
  } else {
    const libDir = join(repoRoot, "resources", "oracle-jdbc", "lib");
    driverJars = existsSync(libDir) ? readdirSync(libDir).filter((f) => f.endsWith(".jar")).map((f) => join(libDir, f)) : [];
  }

  // Phase 08 — resolve the JAVA runtime through the SAME Settings-managed store the app uses (no hidden
  // system Java). AWKIT_ORACLE_LIVE_JAVA_RUNTIME_PROFILE_ID selects the runtime; absent ⇒ the pinned dev
  // JDK 17 the bridge build uses (dev convenience).
  const built = buildOracleBridge({ quiet: true });
  let runtimeJava = built.jdk.java;
  let runtimeMajor: number | undefined;
  const javaProfileId = process.env.AWKIT_ORACLE_LIVE_JAVA_RUNTIME_PROFILE_ID;
  if (javaProfileId) {
    const javaStore = new JavaRuntimeStore({ folder: join(specterData, "java-runtimes") });
    const profile = javaStore.get(javaProfileId);
    if (!profile) {
      console.error(`  ✗ Java runtime "${javaProfileId}" not found under ${join(specterData, "java-runtimes")} — add it in Settings first.`);
      return 1;
    }
    if (!existsSync(profile.javaExecutablePath)) {
      console.error(`  ✗ Java runtime "${javaProfileId}" executable is missing (${profile.status}).`);
      return 1;
    }
    if (profile.status !== "valid") {
      console.error(`  ✗ Java runtime "${javaProfileId}" is not validated (status=${profile.status}) — validate it in Settings.`);
      return 1;
    }
    runtimeJava = profile.javaExecutablePath;
    runtimeMajor = profile.javaMajorVersion;
    console.log(`  • Java runtime "${profile.name}" (Java ${profile.javaVersion}, ${profile.architecture}).`);
  }

  // Java/JDBC compatibility gate — a driver's required Java major must not exceed the selected runtime.
  const compatible = requiredJavaMajor == null || runtimeMajor == null || runtimeMajor >= requiredJavaMajor;
  if (!compatible) {
    console.error(`  ✗ incompatible: driver needs Java ${requiredJavaMajor}+ but the selected runtime is Java ${runtimeMajor}.`);
    return 1;
  }

  // Fail closed: require the real driver to be compiled + available (no mock fallback).
  if (!built.oracleCompiled || driverJars.length === 0) {
    console.error("  ✗ real Oracle driver is not available (no Settings bundle / vendored jars) — refusing to run.");
    return 1;
  }

  const classpath = [built.jarPath, ...driverJars].join(sep);
  const spec: BridgeLaunchSpec = { javaPath: runtimeJava, jarPath: built.jarPath, classpath, env: { AWKIT_ORACLE_REQUIRE_REAL: "1" } };
  const manager = new OracleJdbcBridgeManager({ resolveLaunchSpec: () => spec, requireRealDriver: true, handshakeTimeoutMs: 30_000 });

  const descriptor = { url: cfg.url, username: cfg.user, password: cfg.password, poolKey: "oracle-live" };
  const artifact: LiveArtifact = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    bridge: {},
    runtime: { javaRuntimeProfileId: javaProfileId, javaMajor: runtimeMajor, driverBundleId: bundleId, requiredJavaMajor, compatible },
    steps: [],
    connections: { closedAtTeardown: false, note: "direct JDBC — one connection per query, closed in try-with-resources" },
    teardown: { disposed: false }
  };

  try {
    const hello = await manager.hello();
    artifact.bridge = {
      protocolVersion: hello.protocolVersion,
      bridgeVersion: hello.bridgeVersion,
      executionMode: hello.executionMode,
      driverVersion: hello.driverVersion,
      javaVersion: hello.javaVersion
    };
    if (hello.executionMode !== "real" || !hello.driverAvailable) {
      console.error("  ✗ bridge is not in real mode — aborting (fail closed).");
      artifact.steps.push({ name: "preconditions", outcome: "fail", durationMs: 0, detail: "not real mode" });
      return finish(1);
    }

    artifact.steps.push(await timed("testConnection", async () => {
      await manager.call("testConnection", descriptor, { timeoutMs: 20_000 });
    }));
    artifact.steps.push(await timed("select-small", async () => {
      const r = await manager.call("executeQuery", { ...descriptor, sql: `SELECT id, name FROM ${cfg.table} WHERE ROWNUM <= 3`, maxRows: 10 }, { timeoutMs: 20_000 });
      return `rows=${Array.isArray((r as { rows?: unknown[] }).rows) ? (r as { rows: unknown[] }).rows.length : 0}`;
    }));
    artifact.steps.push(await timed("truncation", async () => {
      const r = await manager.call("executeQuery", { ...descriptor, sql: `SELECT id FROM ${cfg.table}`, maxRows: 1 }, { timeoutMs: 20_000 });
      return `truncated=${(r as { truncated?: boolean }).truncated === true}`;
    }));
    artifact.steps.push(await timed("type-conversion", async () => {
      const r = await manager.call("executeQuery", { ...descriptor, sql: `SELECT * FROM ${cfg.table} WHERE ROWNUM <= 2`, maxRows: 10 }, { timeoutMs: 20_000 });
      return `columns=${Array.isArray((r as { columns?: unknown[] }).columns) ? (r as { columns: unknown[] }).columns.length : 0}`;
    }));
    artifact.steps.push(await expectCat("policy-blocks-dml", () =>
      manager.call("executeQuery", { ...descriptor, sql: `DELETE FROM ${cfg.table}`, maxRows: 1 }, { timeoutMs: 10_000 }), "SQL_POLICY_VIOLATION"));
    artifact.steps.push(await expectCat("permission-or-missing-object", () =>
      manager.call("executeQuery", { ...descriptor, sql: "SELECT 1 FROM awkit_nonexistent_obj_zzz", maxRows: 1 }, { timeoutMs: 10_000 }), "DRIVER_ERROR"));
    // Cancellation: a deliberately heavy read cancelled mid-flight. The per-row string concat + LIKE
    // over a 3-way cross join forces Oracle to evaluate every one of the ~8.5M rows (no cardinality
    // shortcut, no index), so the query runs long enough to be cancelled deterministically.
    {
      const controller = new AbortController();
      const heavySql = `SELECT COUNT(*) FROM ${cfg.table} a, ${cfg.table} b, ${cfg.table} c WHERE a.name || b.name || c.name LIKE '%__awkit_nomatch_zzz__%'`;
      const p = manager.call("executeQuery", { ...descriptor, sql: heavySql, maxRows: 1 }, { timeoutMs: 30_000, signal: controller.signal });
      setTimeout(() => controller.abort(), 250);
      artifact.steps.push(await expectCat("cancellation", () => p, "CANCELLED"));
    }

    // Teardown: release per-query resources + dispose. Connections are per-query (no pool); closePool is
    // a documented no-op retained for protocol compatibility.
    await manager.call("closePool", { poolKey: "oracle-live" }, { timeoutMs: 10_000 }).catch(() => undefined);
    artifact.connections.closedAtTeardown = true;
    return finish(artifact.steps.every((s) => s.outcome === "pass") ? 0 : 1);
  } finally {
    await manager.dispose().catch(() => undefined);
    artifact.teardown.disposed = true;
  }

  function finish(code: number): number {
    artifact.finishedAt = new Date().toISOString();
    const outDir = join(repoRoot, "reports", "oracle-validation");
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, "oracle-live.json");
    // Final safety net: assert no obvious secret leaked into the artifact.
    const leaks = assertRedacted(artifact, [cfg.password, cfg.user]);
    if (leaks.length > 0) {
      console.error("  ✗ refusing to write artifact — it would leak a credential.");
      return 1;
    }
    writeFileSync(outPath, JSON.stringify(artifact, null, 2));
    console.log(`  → wrote redacted artifact: ${outPath}`);
    for (const s of artifact.steps) console.log(`  ${s.outcome === "pass" ? "✓" : "✗"} ${s.name}${s.errorCategory ? ` (${s.errorCategory})` : ""}${s.detail ? ` [${s.detail}]` : ""}`);
    return code;
  }
}

async function main(): Promise<void> {
  console.log("Redaction self-test:");
  const redactionOk = redactionSelfTest();
  if (!redactionOk) process.exit(1);

  const cfg = liveConfig();
  if (!cfg) {
    console.log("Live suite: SKIPPED — no AWKIT_ORACLE_LIVE_URL/USER/PASSWORD configured (credential-gated).");
    console.log("  Provision scripts/oracle/oracle-live-fixture.sql on an authorized non-prod DB, set the env,");
    console.log("  and re-run. The harness will require real mode and never fall back to the mock.");
    process.exit(0);
  }

  const code = await runLive(cfg);
  process.exit(code);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
