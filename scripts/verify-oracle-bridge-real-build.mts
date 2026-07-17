/**
 * Real Oracle JDBC/UCP executor build + load (Phase 03).
 *
 * When the ojdbc/ucp jars are vendored under `resources/oracle-jdbc/lib/`, this compiles the whole
 * Java module from clean (INCLUDING `OracleUcpQueryExecutor`), launches the bridge on a classpath with
 * those jars, and proves the handshake reports REAL mode with a real driver — no mock selection — then
 * shuts down cleanly. A deliberately bad connection must map to a safe error category, never mock rows.
 *
 * When the jars are absent (this environment — build-time network is blocked), the live build cannot
 * run, so it performs STATIC contract checks on the executor source + build wiring and SKIPS the live
 * portion cleanly. This keeps the verifier green while the jar vendoring stays an external gate.
 *
 * Run: `npm run verify:oracle-bridge-real-build`.
 */
import { existsSync, readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOracleBridge } from "./build-oracle-bridge.mjs";
import { oracleDriverJarsPresent } from "../src/oracle/OracleRuntimeResolver";
import { OracleJdbcBridgeManager, type BridgeLaunchSpec } from "../src/oracle/OracleJdbcBridgeManager";
import { OracleBridgeCallError } from "../src/oracle/OracleBridgeProtocol";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const isWin = process.platform === "win32";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}`);
  }
}

const EXECUTOR_SRC = join(
  repoRoot,
  "oracle-jdbc-bridge",
  "src",
  "main",
  "java-oracle",
  "com",
  "specterstudio",
  "oracle",
  "bridge",
  "exec",
  "OracleUcpQueryExecutor.java"
);

function staticContractChecks(): void {
  console.log("Static contract checks (executor source + build wiring):");
  check("real executor source exists at the gated java-oracle path", existsSync(EXECUTOR_SRC));
  const src = existsSync(EXECUTOR_SRC) ? readFileSync(EXECUTOR_SRC, "utf8") : "";
  check("implements QueryExecutor", /implements\s+QueryExecutor/.test(src));
  check("reports executionMode 'real'", /return\s+"real"/.test(src));
  check("uses UCP PoolDataSource(Factory)", /PoolDataSourceFactory/.test(src) && /PoolDataSource/.test(src));
  check("binds via PreparedStatement (no string-built SQL)", /PreparedStatement/.test(src) && !/createStatement\s*\(\s*\)/.test(src));
  check("sets read-only in depth", /setReadOnly\(true\)/.test(src));
  check("arms query timeout + cancellation", /setQueryTimeout/.test(src) && /\.cancel\(\)/.test(src));
  check("maps SQLException to safe categories", /mapSqlException/.test(src) && /ERR_AUTHENTICATION_FAILED|AUTHENTICATION_FAILED/.test(src));
  check("never concatenates SQL literals", !/"SELECT\s/.test(src.replace(/\/\/.*$/gm, "")));

  // Build wiring: the build script compiles java-oracle only when jars are vendored.
  const buildScript = readFileSync(join(repoRoot, "scripts", "build-oracle-bridge.mjs"), "utf8");
  check("build script gates java-oracle behind vendored jars", /java-oracle/.test(buildScript) && /vendoredJars\.length\s*>\s*0/.test(buildScript));
}

/**
 * Compile the gated executor against minimal UCP API stubs + the real JDK `java.sql`. This validates
 * ALL of the executor's JDBC usage and internal signatures for real (only the `oracle.ucp.*` calls are
 * stub-shaped), so the gated source can't silently rot while the jars remain an external gate.
 */
function stubCompileExecutor(): void {
  console.log("Stub compilation (real java.sql + UCP stubs):");
  let built: { jdk: { javac: string }; classesDir: string };
  try {
    built = buildOracleBridge({ quiet: true }) as typeof built;
  } catch (err) {
    check(`core build available for stub compile (${(err as Error).message})`, false);
    return;
  }
  const tmp = mkdtempSync(join(tmpdir(), "awkit-oracle-stubcompile-"));
  try {
    const stubDir = join(tmp, "oracle", "ucp", "jdbc");
    mkdirSync(stubDir, { recursive: true });
    writeFileSync(
      join(stubDir, "PoolDataSource.java"),
      [
        "package oracle.ucp.jdbc;",
        "import java.sql.Connection;",
        "import java.sql.SQLException;",
        "public interface PoolDataSource {",
        "  Connection getConnection() throws SQLException;",
        "  void setConnectionFactoryClassName(String s) throws SQLException;",
        "  void setURL(String s) throws SQLException;",
        "  void setUser(String s) throws SQLException;",
        "  void setPassword(String s) throws SQLException;",
        "  void setConnectionPoolName(String s) throws SQLException;",
        "  void setInitialPoolSize(int n) throws SQLException;",
        "  void setMinPoolSize(int n) throws SQLException;",
        "  void setMaxPoolSize(int n) throws SQLException;",
        "  void setValidateConnectionOnBorrow(boolean b) throws SQLException;",
        "  void setInactiveConnectionTimeout(int n) throws SQLException;",
        "  void setConnectionWaitTimeout(int n) throws SQLException;",
        "}"
      ].join("\n")
    );
    writeFileSync(
      join(stubDir, "PoolDataSourceFactory.java"),
      ["package oracle.ucp.jdbc;", "public final class PoolDataSourceFactory {", "  public static PoolDataSource getPoolDataSource() { return null; }", "}"].join("\n")
    );

    const stubOut = join(tmp, "stub-classes");
    mkdirSync(stubOut, { recursive: true });
    execFileSync(built.jdk.javac, ["-d", stubOut, join(stubDir, "PoolDataSource.java"), join(stubDir, "PoolDataSourceFactory.java")], { stdio: "pipe" });

    const execOut = join(tmp, "exec-classes");
    mkdirSync(execOut, { recursive: true });
    const sep = isWin ? ";" : ":";
    execFileSync(
      built.jdk.javac,
      ["-encoding", "UTF-8", "-cp", [stubOut, built.classesDir].join(sep), "-d", execOut, EXECUTOR_SRC],
      { stdio: "pipe" }
    );
    check("gated executor compiles clean against java.sql + UCP stubs", true);
  } catch (err) {
    const msg = (err as { stderr?: Buffer; message?: string }).stderr?.toString() ?? (err as Error).message;
    console.log(`    javac output:\n${msg}`);
    check("gated executor compiles clean against java.sql + UCP stubs", false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function liveBuildAndHandshake(): Promise<void> {
  console.log("Live real build + handshake (vendored jars present):");
  const built = buildOracleBridge({ quiet: true });
  check("clean build compiled the real executor", built.oracleCompiled === true);

  const libDir = join(repoRoot, "resources", "oracle-jdbc", "lib");
  const jars = readdirSync(libDir).filter((f) => f.endsWith(".jar")).map((f) => join(libDir, f));
  const sep = isWin ? ";" : ":";
  const classpath = [built.jarPath, ...jars].join(sep);

  // Require real: the bridge must NOT fall back to mock. A real driver is present, so this should succeed.
  const spec: BridgeLaunchSpec = {
    javaPath: built.jdk.java,
    jarPath: built.jarPath,
    classpath,
    env: { AWKIT_ORACLE_REQUIRE_REAL: "1" }
  };
  const manager = new OracleJdbcBridgeManager({ resolveLaunchSpec: () => spec, requireRealDriver: true, handshakeTimeoutMs: 30_000 });
  try {
    const hello = await manager.hello();
    check("handshake reports executionMode 'real'", hello.executionMode === "real");
    check("driver available", hello.driverAvailable === true);
    check("reports a real driver version (not the mock)", typeof hello.driverVersion === "string" && hello.driverVersion !== "mock-0.1.0");
    check("reports a UCP version", typeof hello.ucpVersion === "string" && hello.ucpVersion !== "unavailable");

    // A deliberately unreachable target must map to a safe category — never mock rows.
    let category = "";
    try {
      await manager.call(
        "testConnection",
        { url: "jdbc:oracle:thin:@//127.0.0.1:1/DOES_NOT_EXIST", username: "nobody", password: "x", poolKey: "rb-test" },
        { timeoutMs: 15_000 }
      );
    } catch (err) {
      category = err instanceof OracleBridgeCallError ? err.category : "UNKNOWN";
    }
    check("bad connection → safe error category (not mock success)", ["NETWORK_UNREACHABLE", "SERVICE_NOT_FOUND", "DRIVER_ERROR", "TIMEOUT", "INVALID_CONFIGURATION"].includes(category));
  } finally {
    await manager.dispose();
    check("clean shutdown (no throw)", true);
  }
}

async function main(): Promise<void> {
  staticContractChecks();

  if (oracleDriverJarsPresent(join(repoRoot, "resources"))) {
    await liveBuildAndHandshake();
  } else {
    stubCompileExecutor();
    console.log("Live real build: SKIPPED — ojdbc/ucp jars not vendored (external gate).");
    console.log("  Vendor the jars via `npm run prepare:oracle-runtime`, then re-run for the live handshake.");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
