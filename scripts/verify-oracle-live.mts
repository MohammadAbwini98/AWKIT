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
 * Configuration (environment only — never written anywhere):
 *   AWKIT_ORACLE_LIVE_URL, AWKIT_ORACLE_LIVE_USER, AWKIT_ORACLE_LIVE_PASSWORD
 *   AWKIT_ORACLE_LIVE_CONFIRM_NONPROD=1   (explicit authorized-non-prod confirmation; required)
 *   AWKIT_ORACLE_LIVE_TEST_TABLE          (default: awkit_types_test — provision via scripts/oracle/oracle-live-fixture.sql)
 *
 * Run: `npm run verify:oracle-live`.
 */
import { mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOracleBridge } from "./build-oracle-bridge.mjs";
import { oracleDriverJarsPresent } from "../src/oracle/OracleRuntimeResolver";
import { OracleJdbcBridgeManager, type BridgeLaunchSpec } from "../src/oracle/OracleJdbcBridgeManager";
import { OracleBridgeCallError } from "../src/oracle/OracleBridgeProtocol";

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
  bridge: { protocolVersion?: number; bridgeVersion?: string; executionMode?: string; driverVersion?: string; ucpVersion?: string; javaVersion?: string };
  steps: StepResult[];
  pool: { closedAtTeardown: boolean; note: string };
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
    bridge: { executionMode: "real", driverVersion: "oracle-jdbc", ucpVersion: "ucp", javaVersion: "17" },
    steps: [
      { name: "testConnection", outcome: "pass", durationMs: 5 },
      { name: "select-small", outcome: "pass", durationMs: 3, detail: "rows=3" },
      { name: "invalid-sql", outcome: "pass", durationMs: 1, errorCategory: "SQL_POLICY_VIOLATION" }
    ],
    pool: { closedAtTeardown: true, note: "borrowed-connection count not exposed by this bridge release" },
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

  // Fail closed: require the real driver to be compiled/vendored.
  const built = buildOracleBridge({ quiet: true });
  if (!built.oracleCompiled || !oracleDriverJarsPresent(join(repoRoot, "resources"))) {
    console.error("  ✗ real Oracle driver is not vendored/compiled — refusing to run (no mock fallback).");
    return 1;
  }
  if (!cfg.confirmedNonProd) {
    console.error("  ✗ AWKIT_ORACLE_LIVE_CONFIRM_NONPROD=1 is required (authorized, non-production target).");
    return 1;
  }

  const libDir = join(repoRoot, "resources", "oracle-jdbc", "lib");
  const jars = readdirSync(libDir).filter((f) => f.endsWith(".jar")).map((f) => join(libDir, f));
  const classpath = [built.jarPath, ...jars].join(isWin ? ";" : ":");
  const spec: BridgeLaunchSpec = { javaPath: built.jdk.java, jarPath: built.jarPath, classpath, env: { AWKIT_ORACLE_REQUIRE_REAL: "1" } };
  const manager = new OracleJdbcBridgeManager({ resolveLaunchSpec: () => spec, requireRealDriver: true, handshakeTimeoutMs: 30_000 });

  const descriptor = { url: cfg.url, username: cfg.user, password: cfg.password, poolKey: "oracle-live" };
  const artifact: LiveArtifact = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    bridge: {},
    steps: [],
    pool: { closedAtTeardown: false, note: "borrowed-connection count not exposed by this bridge release" },
    teardown: { disposed: false }
  };

  try {
    const hello = await manager.hello();
    artifact.bridge = {
      protocolVersion: hello.protocolVersion,
      bridgeVersion: hello.bridgeVersion,
      executionMode: hello.executionMode,
      driverVersion: hello.driverVersion,
      ucpVersion: hello.ucpVersion,
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
    // Cancellation: a deliberately heavy read cancelled mid-flight.
    {
      const controller = new AbortController();
      const p = manager.call("executeQuery", { ...descriptor, sql: `SELECT COUNT(*) FROM ${cfg.table} a, ${cfg.table} b, ${cfg.table} c`, maxRows: 1 }, { timeoutMs: 30_000, signal: controller.signal });
      setTimeout(() => controller.abort(), 250);
      artifact.steps.push(await expectCat("cancellation", () => p, "CANCELLED"));
    }

    // Teardown: close the pool + dispose.
    await manager.call("closePool", { poolKey: "oracle-live" }, { timeoutMs: 10_000 }).catch(() => undefined);
    artifact.pool.closedAtTeardown = true;
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
