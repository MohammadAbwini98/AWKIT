import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { BridgeLaunchSpec } from "./OracleJdbcBridgeManager";
import { validateOracleBundleChecksums } from "./OracleBundleChecksums";

/**
 * Resolves how to launch the Oracle JDBC bridge, and whether the Oracle feature is available at all.
 *
 * Specter does **not** bundle a JRE or an Oracle driver. Oracle live queries require the user to select,
 * in Settings → Database Drivers, (1) a Java runtime and (2) an Oracle JDBC driver bundle. This resolver
 * therefore only locates Specter's own **bridge jar** and the **Java executable** — the driver jars are
 * added to the classpath per-query by the caller from the selected bundle.
 *
 * - **Java** comes from the caller's `selectedJavaPath` (the user's Settings selection). There is a
 *   narrow dev/verifier fallback to `AWKIT_ORACLE_BRIDGE_JDK_HOME` — **only** when unpackaged; never a
 *   bundled JRE, `JAVA_HOME`, `PATH`, or a production auto-scan. Missing selection ⇒ `available:false`
 *   with `notConfigured:true` and the `ORACLE_RUNTIME_NOT_CONFIGURED` reason.
 * - **Bridge jar** is Specter's own tiny jar: `resources/oracle-jdbc/bridge/…jar` (packaged) or
 *   `oracle-jdbc-bridge/target/…jar` (dev-built). Packaged production NEVER falls back to a system Java.
 *
 * Pure/framework-agnostic: the caller passes the resources root, app mode, and the selected Java path.
 */
export interface OracleRuntimeResolution {
  available: boolean;
  source: "bundled" | "dev" | "none";
  reason?: string;
  /** True when the runtime is unavailable specifically because no Java runtime is configured. */
  notConfigured?: boolean;
  launchSpec?: BridgeLaunchSpec;
  /** True when a real Oracle driver is expected. Always false at the base — a selected bundle turns it on. */
  driverExpected: boolean;
  /** Whether the database-free mock executor may EVER be used (never in packaged production). */
  mockAllowed: boolean;
  /** Whether the bridge must refuse any mock fallback and require a real driver (packaged production). */
  requireRealDriver: boolean;
}

export interface ResolveOracleRuntimeOptions {
  resourcesRoot: string;
  repoRoot?: string;
  appMode: "dev" | "packaged";
  /** Extra JVM args (e.g. `-Xmx256m`). */
  jvmArgs?: string[];
  /** Force the database-free mock executor (dev only; ignored under packaged production). */
  forceMock?: boolean;
  /** The user-selected Java executable (from Settings). Absent ⇒ only the dev env fallback is tried. */
  selectedJavaPath?: string;
}

const isWin = process.platform === "win32";
const javaExe = isWin ? "java.exe" : "java";

/** The user-facing message shown when no Java/driver is configured (Phase 07). */
export const ORACLE_RUNTIME_NOT_CONFIGURED_REASON =
  "Oracle runtime is not configured.\n\nSelect a Java runtime and Oracle JDBC driver in:\nSettings → Database Drivers";

function oracleResourceDir(resourcesRoot: string): string {
  return join(resourcesRoot, "oracle-jdbc");
}

/**
 * Whether any ojdbc jar is vendored under `resources/oracle-jdbc/lib/`. In the user-selected model
 * drivers come from Settings-managed bundles, not vendored jars, so this is normally false — the
 * bridge-real-build verifier still uses it to decide whether a live compile/handshake is possible.
 */
export function oracleDriverJarsPresent(resourcesRoot: string): boolean {
  const lib = join(oracleResourceDir(resourcesRoot), "lib");
  if (!existsSync(lib)) return false;
  try {
    return readdirSync(lib).some((f) => f.toLowerCase().endsWith(".jar"));
  } catch {
    return false;
  }
}

/** Locate Specter's own bridge jar (bundled in packaged, dev-built in dev). */
function resolveBridgeJar(options: ResolveOracleRuntimeOptions): string {
  if (options.appMode === "packaged") {
    return join(oracleResourceDir(options.resourcesRoot), "bridge", "awkit-oracle-jdbc-bridge.jar");
  }
  const repoRoot = options.repoRoot ?? process.cwd();
  return join(repoRoot, "oracle-jdbc-bridge", "target", "awkit-oracle-jdbc-bridge.jar");
}

/**
 * Resolve the Java executable: the user's Settings selection first, then — only when unpackaged — an
 * explicit `AWKIT_ORACLE_BRIDGE_JDK_HOME` for tests/dev. Never a bundled JRE, `JAVA_HOME`, `PATH`, or a
 * production auto-scan.
 */
function resolveJavaExecutable(options: ResolveOracleRuntimeOptions): string | undefined {
  if (options.selectedJavaPath && existsSync(options.selectedJavaPath)) {
    return options.selectedJavaPath;
  }
  if (options.appMode === "dev") {
    const home = process.env.AWKIT_ORACLE_BRIDGE_JDK_HOME;
    if (home && existsSync(join(home, "bin", javaExe))) return join(home, "bin", javaExe);
  }
  return undefined;
}

export function resolveOracleRuntime(options: ResolveOracleRuntimeOptions): OracleRuntimeResolution {
  const { appMode } = options;

  // Fail-closed policy: the mock executor may NEVER run in packaged production, which forces the bridge
  // to require a real driver (`AWKIT_ORACLE_REQUIRE_REAL`). Dev/unpackaged may use the database-free
  // mock so the protocol works without a selected driver.
  const requireRealDriver = appMode === "packaged";
  const mockAllowed = !requireRealDriver;
  const base = { mockAllowed, requireRealDriver, driverExpected: false as const };

  // 1) Specter's own bridge jar must be present. (Java + drivers are user-selected, not bundled.)
  const bridgeJar = resolveBridgeJar(options);
  if (!existsSync(bridgeJar)) {
    return {
      ...base,
      available: false,
      source: "none",
      reason:
        appMode === "packaged"
          ? "The Oracle JDBC bridge is missing from this build. Reinstall SpecterStudio."
          : "Oracle bridge unavailable in dev — build it with `npm run build:oracle-bridge`."
    };
  }

  // 1a) If a bundled checksums.json is present (packaged), it MUST validate — production never launches
  //     a corrupted/tampered bridge silently.
  if (appMode === "packaged") {
    const checksums = validateOracleBundleChecksums(oracleResourceDir(options.resourcesRoot));
    if (!checksums.ok) {
      return {
        ...base,
        available: false,
        source: "none",
        reason: `The bundled Oracle JDBC bridge failed checksum validation (${checksums.issues[0] ?? "unknown issue"}). Reinstall SpecterStudio.`
      };
    }
  }

  // 2) Resolve the Java executable from the user's selection (or the dev-only env fallback).
  const javaPath = resolveJavaExecutable(options);
  if (!javaPath) {
    return {
      ...base,
      available: false,
      source: "none",
      notConfigured: true,
      reason: ORACLE_RUNTIME_NOT_CONFIGURED_REASON
    };
  }

  // 3) Available. Drivers are supplied per-query from the selected bundle's classpath — the base spec
  //    runs the database-free mock in dev, and require-real in packaged (a bundle flips dev to real).
  const env: Record<string, string> = {};
  if (requireRealDriver) {
    env.AWKIT_ORACLE_REQUIRE_REAL = "1";
  } else {
    env.AWKIT_ORACLE_BRIDGE_MOCK = "1";
  }

  return {
    ...base,
    available: true,
    source: appMode === "packaged" ? "bundled" : "dev",
    launchSpec: { javaPath, jarPath: bridgeJar, jvmArgs: options.jvmArgs, env }
  };
}
