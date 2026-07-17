import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { BridgeLaunchSpec } from "./OracleJdbcBridgeManager";
import { validateOracleBundleChecksums } from "./OracleBundleChecksums";

/**
 * Resolves how to launch the Oracle JDBC bridge, and whether the Oracle feature is available at all.
 *
 * - **Packaged (production):** a private JRE + bridge jar vendored under
 *   `resources/oracle-jdbc/` (Phase 12 adds checksum/manifest validation on top of this).
 *   Production NEVER silently falls back to a system Java.
 * - **Dev/unpackaged:** a JDK 17 (env `AWKIT_ORACLE_BRIDGE_JDK_HOME` or a known install) + the
 *   dev-built jar under `oracle-jdbc-bridge/target/`. If neither exists, Oracle features are simply
 *   unavailable with a clear reason — non-Oracle workflows are unaffected (lazy availability).
 *
 * Pure/framework-agnostic: the caller passes the resources root + app mode.
 */
export interface OracleRuntimeResolution {
  available: boolean;
  source: "bundled" | "dev" | "none";
  reason?: string;
  launchSpec?: BridgeLaunchSpec;
  /** True when a real Oracle driver is expected (jars vendored); false ⇒ mock executor at runtime. */
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
  /** Force the database-free mock executor (used by verifiers/dev without a driver). */
  forceMock?: boolean;
}

const isWin = process.platform === "win32";
const javaExe = isWin ? "java.exe" : "java";

const DEV_JDK_CANDIDATES = [
  process.env.AWKIT_ORACLE_BRIDGE_JDK_HOME,
  "C:/Program Files/Java/jdk-17",
  "C:/Program Files/Eclipse Adoptium/jdk-17",
  "C:/Program Files/Microsoft/jdk-17",
  "/usr/lib/jvm/java-17-openjdk",
  "/Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home",
  process.env.JAVA_HOME
];

function oracleResourceDir(resourcesRoot: string): string {
  return join(resourcesRoot, "oracle-jdbc");
}

/** Whether the ojdbc/ucp jars are vendored (⇒ a real driver, not the mock). */
export function oracleDriverJarsPresent(resourcesRoot: string): boolean {
  const lib = join(oracleResourceDir(resourcesRoot), "lib");
  if (!existsSync(lib)) return false;
  // Require at least one real .jar — an empty lib/ dir does NOT count as a driver (Phase 12 validates
  // the individual jar names/hashes on top of this).
  try {
    return readdirSync(lib).some((f) => f.toLowerCase().endsWith(".jar"));
  } catch {
    return false;
  }
}

export function resolveOracleRuntime(options: ResolveOracleRuntimeOptions): OracleRuntimeResolution {
  const { resourcesRoot, appMode } = options;
  const oracleDir = oracleResourceDir(resourcesRoot);
  const bundledJava = join(oracleDir, "runtime", "bin", javaExe);
  const bundledJar = join(oracleDir, "bridge", "awkit-oracle-jdbc-bridge.jar");

  // Fail-closed policy: the mock executor may NEVER run in packaged production, and production forces
  // the bridge to require a real driver (`AWKIT_ORACLE_REQUIRE_REAL`). Dev/unpackaged may use the
  // database-free mock so the protocol works without vendored jars.
  const requireRealDriver = appMode === "packaged";
  const mockAllowed = !requireRealDriver;

  const buildEnv = (driverExpected: boolean): Record<string, string> => {
    const env: Record<string, string> = {};
    if (requireRealDriver) {
      env.AWKIT_ORACLE_REQUIRE_REAL = "1";
    } else if (options.forceMock || !driverExpected) {
      // Dev/unpackaged with no vendored driver (or an explicit verifier request): database-free mock.
      env.AWKIT_ORACLE_BRIDGE_MOCK = "1";
    }
    return env;
  };

  const base = { mockAllowed, requireRealDriver };

  // 1) Bundled private runtime (required in production). A checksums.json, if present, MUST
  //    validate — production never launches a corrupted/tampered/incomplete bundle silently.
  if (existsSync(bundledJava) && existsSync(bundledJar)) {
    const checksums = validateOracleBundleChecksums(oracleDir);
    if (!checksums.ok) {
      return {
        ...base,
        available: false,
        source: "none",
        driverExpected: false,
        reason: `The bundled Oracle JDBC runtime failed checksum validation (${checksums.issues[0] ?? "unknown issue"}). Reinstall SpecterStudio with the Oracle feature bundle.`
      };
    }
    const driverExpected = oracleDriverJarsPresent(resourcesRoot);
    // Packaged production with the runtime present but the ojdbc/ucp driver jars missing must FAIL
    // CLOSED for live queries — never fall through to the mock. Snapshot Data Sources still work
    // (they read stored rows and never launch the bridge).
    if (requireRealDriver && !driverExpected) {
      return {
        ...base,
        available: false,
        source: "none",
        driverExpected: false,
        reason:
          "The bundled Oracle JDBC driver (ojdbc/ucp) is missing from this build. Oracle live queries are unavailable; Snapshot Data Sources still work offline. Reinstall SpecterStudio with the Oracle feature bundle."
      };
    }
    return {
      ...base,
      available: true,
      source: "bundled",
      driverExpected,
      launchSpec: { javaPath: bundledJava, jarPath: bundledJar, jvmArgs: options.jvmArgs, env: buildEnv(driverExpected) }
    };
  }

  // 2) Production must NOT fall back to a dev/system JDK.
  if (appMode === "packaged") {
    return {
      ...base,
      available: false,
      source: "none",
      driverExpected: false,
      reason:
        "The bundled Oracle JDBC runtime is missing from this build. Reinstall SpecterStudio with the Oracle feature bundle."
    };
  }

  // 3) Dev/unpackaged: pinned JDK 17 + dev-built jar.
  const repoRoot = options.repoRoot ?? process.cwd();
  const devJar = join(repoRoot, "oracle-jdbc-bridge", "target", "awkit-oracle-jdbc-bridge.jar");
  const devJavaHome = DEV_JDK_CANDIDATES.find((home) => home && existsSync(join(home, "bin", javaExe)));
  if (devJavaHome && existsSync(devJar)) {
    const driverExpected = oracleDriverJarsPresent(resourcesRoot);
    return {
      ...base,
      available: true,
      source: "dev",
      driverExpected,
      launchSpec: {
        javaPath: join(devJavaHome, "bin", javaExe),
        jarPath: devJar,
        jvmArgs: options.jvmArgs,
        env: buildEnv(driverExpected)
      }
    };
  }

  const missing: string[] = [];
  if (!devJavaHome) missing.push("a JDK 17 (set AWKIT_ORACLE_BRIDGE_JDK_HOME)");
  if (!existsSync(devJar)) missing.push("the bridge jar (run `npm run build:oracle-bridge`)");
  return {
    ...base,
    available: false,
    source: "none",
    driverExpected: false,
    reason: `Oracle bridge unavailable in dev — missing ${missing.join(" and ")}.`
  };
}
