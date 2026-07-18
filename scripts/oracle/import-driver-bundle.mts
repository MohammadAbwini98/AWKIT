/**
 * DEV helper: import an Oracle JDBC driver jar into the SAME Specter-managed driver-bundle store the
 * Settings UI writes to (`%LOCALAPPDATA%/SpecterStudio/oracle-drivers/`), load-testing it in a real
 * isolated bridge. Mirrors the app's `importOracleDriverBundle` so live validation (Phase 08/09) can
 * resolve the bundle by id without launching the GUI. The GUI import path is exercised in Phase 11.
 *
 *   npx tsx scripts/oracle/import-driver-bundle.mts "<name>" "<path-to-ojdbc.jar>" [more.jar ...]
 *
 * Prints the resulting bundle id for AWKIT_ORACLE_LIVE_DRIVER_BUNDLE_ID.
 */
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OracleDriverBundleStore, type DriverProbeResult } from "../../src/oracle/OracleDriverBundleStore";
import { resolveOracleRuntime } from "../../src/oracle/OracleRuntimeResolver";
import { OracleJdbcBridgeManager } from "../../src/oracle/OracleJdbcBridgeManager";
import { buildOracleBridge } from "../build-oracle-bridge.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function realProbe(classpathJars: string[]): Promise<DriverProbeResult> {
  const resolution = resolveOracleRuntime({ resourcesRoot: join(repoRoot, "resources"), appMode: "dev", repoRoot });
  if (!resolution.available || !resolution.launchSpec) return { probed: false, driverAvailable: false, reason: "bridge runtime unavailable" };
  const base = resolution.launchSpec;
  const sep = process.platform === "win32" ? ";" : ":";
  const env: Record<string, string | undefined> = { ...base.env };
  delete env.AWKIT_ORACLE_BRIDGE_MOCK;
  const mgr = new OracleJdbcBridgeManager({
    resolveLaunchSpec: () => ({ ...base, classpath: [base.jarPath, ...classpathJars].join(sep), mainClass: "com.specterstudio.oracle.bridge.Main", env })
  });
  try {
    const p = await mgr.call("driverProbe", {}, { timeoutMs: 25_000 });
    return { probed: true, driverAvailable: p.driverAvailable === true, driverVersion: String(p.driverVersion), javaVersion: String(p.javaVersion) };
  } catch {
    return { probed: false, driverAvailable: false, reason: "bridge probe failed" };
  } finally {
    await mgr.dispose().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const [name, ...jars] = process.argv.slice(2);
  if (!name || jars.length === 0) {
    console.error('Usage: npx tsx scripts/oracle/import-driver-bundle.mts "<name>" "<ojdbc.jar>" [more.jar ...]');
    process.exit(1);
  }
  // Build the bridge jar first (also advertises the JDK to the resolver's dev-only java fallback via
  // AWKIT_ORACLE_BRIDGE_JDK_HOME — the resolver no longer auto-scans for Java).
  buildOracleBridge({ quiet: true });
  const folder = join(process.env.LOCALAPPDATA ?? process.env.APPDATA ?? repoRoot, "SpecterStudio", "oracle-drivers");
  const store = new OracleDriverBundleStore({ folder, probe: realProbe });
  const bundle = await store.import({ name, sourceFiles: jars });
  if (!store.getDefaultId()) store.setDefault(bundle.id);
  console.log(`Imported bundle: id=${bundle.id} status=${bundle.validationStatus} jdbc=${bundle.jdbcVersion ?? "?"}`);
  console.log(`Managed dir: ${bundle.managedDirectory}`);
  console.log(`\n$env:AWKIT_ORACLE_LIVE_DRIVER_BUNDLE_ID = '${bundle.id}'`);
}

void main();
