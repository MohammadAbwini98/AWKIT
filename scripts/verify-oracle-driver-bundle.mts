/**
 * Managed Oracle JDBC driver-bundle store + isolation verification (Phases 05–07). Exercises
 * {@link OracleDriverBundleStore} with a STUB isolated-bridge probe (import/copy/hash/manifest,
 * checksum-tamper rejection, validation states, single-version enforcement, default selection) and the
 * pure model helpers (jar classification, Java-major inference, compatibility key, compatibility label).
 *
 * A REAL section runs only when an actual `ojdbc17.jar` is available (env `AWKIT_ORACLE_DRIVER_JAR`, or
 * the supplied Downloads copy): it launches a real isolated Java bridge and asserts the driver loads
 * and reports version `23.x` (direct JDBC — Specter no longer supports UCP) — the first real-driver check.
 *
 * Run: `npm run verify:oracle-driver-bundle`.
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OracleDriverBundleStore,
  type DriverProbeFn,
  type DriverProbeResult
} from "../src/oracle/OracleDriverBundleStore";
import {
  classifyDriverJar,
  compatibilityLabelFor,
  driverBundleCompatibilityKey,
  isUcpJar,
  requiredJavaMajorFromOjdbcName
} from "../src/oracle/OracleDriverBundle";
import { resolveOracleRuntime } from "../src/oracle/OracleRuntimeResolver";
import { OracleJdbcBridgeManager } from "../src/oracle/OracleJdbcBridgeManager";
import { buildOracleBridge } from "./build-oracle-bridge.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

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

async function expectReject(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    check(name, false);
  } catch {
    check(name, true);
  }
}

const okProbe: DriverProbeFn = async () => ({
  probed: true,
  driverAvailable: true,
  driverVersion: "23.26.2.0.0",
  javaVersion: "17.0.8"
});
const badProbe: DriverProbeFn = async () => ({ probed: true, driverAvailable: false, reason: "not a real driver" });

/** Write a dummy jar with unique bytes so its hash is stable and distinct. */
function fakeJar(dir: string, name: string): string {
  const p = join(dir, name);
  writeFileSync(p, `dummy-${name}-${Math.random()}`);
  return p;
}

async function storeTests(): Promise<void> {
  console.log("Driver-bundle store (stub probe):");
  const root = mkdtempSync(join(tmpdir(), "awkit-drv-store-"));
  const src = join(root, "src");
  mkdirSync(src, { recursive: true });
  const ojdbc = fakeJar(src, "ojdbc11.jar");
  const ojdbc2 = fakeJar(src, "ojdbc8.jar");
  const ucp = fakeJar(src, "ucp11.jar");
  const pki = fakeJar(src, "oraclepki.jar");
  const bad = fakeJar(src, "totally-random.jar");

  try {
    const store = new OracleDriverBundleStore({ folder: join(root, "oracle-drivers"), probe: okProbe });

    const bundle = await store.import({ name: "Oracle 23ai", sourceFiles: [ojdbc, pki] });
    check("valid import → status valid", bundle.validationStatus === "valid");
    check("import copies driver jar to managed dir", existsSync(join(bundle.managedDirectory, "ojdbc11.jar")));
    check("import copies companion jar", existsSync(join(bundle.managedDirectory, "oraclepki.jar")));
    check("import does NOT keep any ucp jar", !existsSync(join(bundle.managedDirectory, "ucp11.jar")));
    check("import records a checksum per file", Object.keys(bundle.checksums).length === 2);
    check("import writes manifest.json + checksums.json", existsSync(join(bundle.managedDirectory, "manifest.json")) && existsSync(join(bundle.managedDirectory, "checksums.json")));
    check("import infers required Java major (ojdbc11 → 11)", bundle.requiredJavaMajor === 11);
    check("import records reported JDBC version", bundle.jdbcVersion === "23.26.2.0.0");
    check("list returns the imported bundle", store.list().length === 1 && store.get(bundle.id)?.name === "Oracle 23ai");
    check("manifest does not persist the absolute managed dir", !readFileSync(join(bundle.managedDirectory, "manifest.json"), "utf8").includes("managedDirectory"));

    // Single-version + recognized-jar enforcement (UCP is no longer supported → rejected on import).
    await expectReject("reject: ucp jar (UCP no longer supported)", () => store.import({ name: "x", sourceFiles: [ojdbc, ucp] }));
    await expectReject("reject: ucp jar alone", () => store.import({ name: "x", sourceFiles: [ucp] }));
    await expectReject("reject: no ojdbc jar (companion only)", () => store.import({ name: "x", sourceFiles: [pki] }));
    await expectReject("reject: two ojdbc jars (mixed versions)", () => store.import({ name: "x", sourceFiles: [ojdbc, ojdbc2] }));
    await expectReject("reject: unrecognized jar", () => store.import({ name: "x", sourceFiles: [ojdbc, bad] }));
    check("rejected imports leave no partial bundle", store.list().length === 1);

    // Default selection.
    store.setDefault(bundle.id);
    check("setDefault → getDefaultId", store.getDefaultId() === bundle.id);

    // Checksum tamper + missing detection.
    writeFileSync(join(bundle.managedDirectory, "ojdbc11.jar"), "TAMPERED");
    check("tampered managed jar → checksum-failed", store.revalidateChecksums(bundle.id) === "checksum-failed");

    // Driver that fails to load → import rejected, nothing kept.
    const store2 = new OracleDriverBundleStore({ folder: join(root, "oracle-drivers-2"), probe: badProbe });
    await expectReject("driver fails to load → import rejected", () => store2.import({ name: "bad", sourceFiles: [ojdbc] }));
    check("rejected load leaves no bundle + no staging", store2.list().length === 0);

    // Missing file detection on a fresh bundle.
    const store3 = new OracleDriverBundleStore({ folder: join(root, "oracle-drivers-3"), probe: okProbe });
    const b3 = await store3.import({ name: "missing-test", sourceFiles: [ojdbc] });
    rmSync(join(b3.managedDirectory, "ojdbc11.jar"));
    check("deleted managed jar → missing", store3.revalidateChecksums(b3.id) === "missing");

    // No probe injected → unverified (couldn't load-test).
    const store4 = new OracleDriverBundleStore({ folder: join(root, "oracle-drivers-4") });
    const b4 = await store4.import({ name: "no-probe", sourceFiles: [ojdbc] });
    check("no probe available → unverified", b4.validationStatus === "unverified");

    // Remove clears the bundle + default pointer.
    store.remove(bundle.id);
    check("remove deletes the managed bundle", store.get(bundle.id) === null);
    check("remove clears the default pointer", store.getDefaultId() === undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function modelTests(): void {
  console.log("\nModel helpers:");
  check("classify ojdbc17 → jdbc", classifyDriverJar("ojdbc17.jar") === "jdbc");
  check("classify ucp11 → unknown (UCP unsupported)", classifyDriverJar("ucp11.jar") === "unknown");
  check("isUcpJar detects ucp11.jar", isUcpJar("ucp11.jar") === true);
  check("isUcpJar false for ojdbc17.jar", isUcpJar("ojdbc17.jar") === false);
  check("classify oraclepki → companion", classifyDriverJar("oraclepki.jar") === "companion");
  check("classify simplefan → companion", classifyDriverJar("simplefan.jar") === "companion");
  check("classify random → unknown", classifyDriverJar("random.jar") === "unknown");
  check("Java major ojdbc17 → 17", requiredJavaMajorFromOjdbcName("ojdbc17.jar") === 17);
  check("Java major ojdbc8 → 8", requiredJavaMajorFromOjdbcName("ojdbc8.jar") === 8);
  check("Java major non-ojdbc → undefined", requiredJavaMajorFromOjdbcName("ucp.jar") === undefined);

  const kA = driverBundleCompatibilityKey({ driverBundleId: "a", javaIdentity: "j17", protocolVersion: 1 });
  const kB = driverBundleCompatibilityKey({ driverBundleId: "b", javaIdentity: "j17", protocolVersion: 1 });
  const kA2 = driverBundleCompatibilityKey({ driverBundleId: "a", javaIdentity: "j17", protocolVersion: 1 });
  const kAj = driverBundleCompatibilityKey({ driverBundleId: "a", javaIdentity: "j21", protocolVersion: 1 });
  check("different bundles → different isolation keys", kA !== kB);
  check("same inputs → identical key (one bridge)", kA === kA2);
  check("different Java identity → different key", kA !== kAj);

  check("label: valid → Compatible but unverified", compatibilityLabelFor({ validationStatus: "valid", requiredJavaMajor: 17 }) === "Compatible but unverified");
  check("label: invalid → Unsupported", compatibilityLabelFor({ validationStatus: "invalid" }) === "Unsupported");
  check("label: checksum-failed → Unsupported", compatibilityLabelFor({ validationStatus: "checksum-failed" }) === "Unsupported");
  check("label: unverified → Unknown", compatibilityLabelFor({ validationStatus: "unverified" }) === "Unknown");
  check("label: valid but running JDK too old → Unsupported", compatibilityLabelFor({ validationStatus: "valid", requiredJavaMajor: 17 }, 11) === "Unsupported");
}

/** Launch a REAL isolated bridge with a candidate classpath and run the reflective driverProbe. */
async function realProbe(classpathJars: string[]): Promise<DriverProbeResult> {
  const resolution = resolveOracleRuntime({ resourcesRoot: join(repoRoot, "resources"), appMode: "dev", repoRoot });
  if (!resolution.available || !resolution.launchSpec) {
    return { probed: false, driverAvailable: false, reason: "bridge runtime unavailable" };
  }
  const base = resolution.launchSpec;
  const sep = process.platform === "win32" ? ";" : ":";
  const env: Record<string, string | undefined> = { ...base.env };
  delete env.AWKIT_ORACLE_BRIDGE_MOCK;
  const mgr = new OracleJdbcBridgeManager({
    resolveLaunchSpec: () => ({
      ...base,
      classpath: [base.jarPath, ...classpathJars].join(sep),
      mainClass: "com.specterstudio.oracle.bridge.Main",
      env
    })
  });
  try {
    const p = await mgr.call("driverProbe", {}, { timeoutMs: 25_000 });
    return {
      probed: true,
      driverAvailable: p.driverAvailable === true,
      driverVersion: String(p.driverVersion),
      javaVersion: String(p.javaVersion)
    };
  } catch {
    return { probed: false, driverAvailable: false, reason: "bridge probe failed" };
  } finally {
    await mgr.dispose().catch(() => undefined);
  }
}

async function realDriverTests(): Promise<void> {
  const ojdbc = process.env.AWKIT_ORACLE_DRIVER_JAR || "C:/Users/moham/Downloads/ojdbc17.jar";
  console.log("\nReal driver load (isolated bridge):");
  if (!existsSync(ojdbc)) {
    console.log(`  • ojdbc jar absent — skipping (external gate). jar=${existsSync(ojdbc)}`);
    return;
  }
  // Build the bridge jar (also advertises the JDK to the resolver's dev-only java fallback via
  // AWKIT_ORACLE_BRIDGE_JDK_HOME — the resolver no longer auto-scans for Java).
  let bridgeJar: string;
  try {
    bridgeJar = buildOracleBridge({ quiet: true }).jarPath;
  } catch (err) {
    console.log(`  • could not build the dev bridge jar — skipping (external gate): ${(err as Error).message}`);
    return;
  }
  if (!existsSync(bridgeJar)) {
    console.log("  • dev bridge jar absent after build — skipping (external gate).");
    return;
  }
  const probe = await realProbe([ojdbc]);
  check("real ojdbc → driver class loads in isolated bridge", probe.probed && probe.driverAvailable);
  check("real ojdbc → reports version 23.x", (probe.driverVersion ?? "").startsWith("23."));

  // End-to-end import through the store with the REAL probe.
  const root = mkdtempSync(join(tmpdir(), "awkit-drv-real-"));
  try {
    const store = new OracleDriverBundleStore({ folder: join(root, "oracle-drivers"), probe: realProbe });
    const bundle = await store.import({ name: "Real ojdbc17", sourceFiles: [ojdbc] });
    check("real import → status valid", bundle.validationStatus === "valid");
    check("real import → JDBC version 23.x recorded", (bundle.jdbcVersion ?? "").startsWith("23."));
    check("real import → companionJars empty (direct JDBC only)", bundle.companionJars.length === 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  await storeTests();
  modelTests();
  await realDriverTests();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
