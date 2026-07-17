/**
 * Oracle JDBC bundle packaging + runtime resolution (Phase 12). No real Oracle jars/JRE are vendored
 * in this environment (network is blocked at build time — an external gate), so this exercises the
 * checksum-validation and runtime-resolution LOGIC against synthetic fixture files in a temp dir,
 * proving the mechanism is correct and ready for when packaging actually vendors the bundle.
 *
 * Run: `npm run verify:oracle-packaging`.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeSha256, validateOracleBundleChecksums } from "../src/oracle/OracleBundleChecksums";
import { resolveOracleRuntime } from "../src/oracle/OracleRuntimeResolver";

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

function makeBundle(root: string, opts: { withDriver?: boolean } = {}): { oracleDir: string; javaExe: string; jarPath: string; driverJar?: string } {
  const oracleDir = join(root, "oracle-jdbc");
  const runtimeBin = join(oracleDir, "runtime", "bin");
  const bridgeDir = join(oracleDir, "bridge");
  mkdirSync(runtimeBin, { recursive: true });
  mkdirSync(bridgeDir, { recursive: true });
  const javaExe = join(runtimeBin, process.platform === "win32" ? "java.exe" : "java");
  const jarPath = join(bridgeDir, "awkit-oracle-jdbc-bridge.jar");
  writeFileSync(javaExe, "fake-java-binary");
  writeFileSync(jarPath, "fake-bridge-jar");
  let driverJar: string | undefined;
  if (opts.withDriver) {
    const libDir = join(oracleDir, "lib");
    mkdirSync(libDir, { recursive: true });
    driverJar = join(libDir, "ojdbc11.jar");
    writeFileSync(driverJar, "fake-ojdbc-jar");
  }
  return { oracleDir, javaExe, jarPath, driverJar };
}

async function main(): Promise<void> {
  console.log("Checksum validation (pure, synthetic fixtures):");
  {
    const root = mkdtempSync(join(tmpdir(), "awkit-oracle-checksums-"));
    try {
      const { oracleDir, javaExe, jarPath } = makeBundle(root);

      const noManifest = validateOracleBundleChecksums(oracleDir);
      check("no checksums.json → ok, not checked (lazy availability)", noManifest.ok === true && noManifest.checked === false);

      const goodHash = computeSha256(javaExe);
      writeFileSync(join(oracleDir, "checksums.json"), JSON.stringify({ "runtime/bin/java.exe": `sha256:${goodHash}` }));
      const valid = validateOracleBundleChecksums(oracleDir);
      check("matching checksum → ok", valid.ok === true && valid.checked === true && valid.issues.length === 0);

      writeFileSync(join(oracleDir, "checksums.json"), JSON.stringify({ "runtime/bin/java.exe": "sha256:deadbeef00000000000000000000000000000000000000000000000000000000" }));
      const mismatched = validateOracleBundleChecksums(oracleDir);
      check("wrong checksum → rejected", mismatched.ok === false && /mismatch/.test(mismatched.issues[0] ?? ""));

      writeFileSync(join(oracleDir, "checksums.json"), JSON.stringify({ "lib/ojdbc11.jar": "sha256:abc123" }));
      const missingFile = validateOracleBundleChecksums(oracleDir);
      check("declared-but-missing file → rejected", missingFile.ok === false && /missing/.test(missingFile.issues[0] ?? ""));

      writeFileSync(join(oracleDir, "checksums.json"), "not json");
      const malformed = validateOracleBundleChecksums(oracleDir);
      check("malformed checksums.json → rejected, not a crash", malformed.ok === false);

      void jarPath;
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  console.log("Runtime resolution (pure, synthetic fixtures):");
  {
    const root = mkdtempSync(join(tmpdir(), "awkit-oracle-resolve-"));
    try {
      const { oracleDir } = makeBundle(root, { withDriver: true });

      const noBundle = resolveOracleRuntime({ resourcesRoot: join(root, "nope"), appMode: "packaged" });
      check("packaged + no bundle → unavailable, does not fall back", noBundle.available === false && noBundle.source === "none");
      check("packaged + no bundle → clear reinstall reason", /reinstall/i.test(noBundle.reason ?? ""));

      const bundledOk = resolveOracleRuntime({ resourcesRoot: root, appMode: "packaged" });
      check("packaged + valid bundle + driver jar → available", bundledOk.available === true && bundledOk.source === "bundled");
      check("packaged + valid bundle → driverExpected + requireRealDriver, mock forbidden", bundledOk.driverExpected === true && bundledOk.requireRealDriver === true && bundledOk.mockAllowed === false);
      check("packaged launch spec forces AWKIT_ORACLE_REQUIRE_REAL and never sets mock", bundledOk.launchSpec?.env?.AWKIT_ORACLE_REQUIRE_REAL === "1" && bundledOk.launchSpec?.env?.AWKIT_ORACLE_BRIDGE_MOCK === undefined);

      const goodHash = computeSha256(join(oracleDir, "bridge", "awkit-oracle-jdbc-bridge.jar"));
      writeFileSync(join(oracleDir, "checksums.json"), JSON.stringify({ "bridge/awkit-oracle-jdbc-bridge.jar": `sha256:${goodHash}` }));
      const bundledValidChecksum = resolveOracleRuntime({ resourcesRoot: root, appMode: "packaged" });
      check("packaged + matching checksums.json → available", bundledValidChecksum.available === true);

      writeFileSync(join(oracleDir, "checksums.json"), JSON.stringify({ "bridge/awkit-oracle-jdbc-bridge.jar": "sha256:deadbeef00000000000000000000000000000000000000000000000000000000" }));
      const bundledBadChecksum = resolveOracleRuntime({ resourcesRoot: root, appMode: "packaged" });
      check("packaged + failing checksum → unavailable (fails closed, no silent launch)", bundledBadChecksum.available === false);
      check("packaged + failing checksum → reason mentions checksum", /checksum/i.test(bundledBadChecksum.reason ?? ""));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  console.log("Fail-closed production policy (Phase 01):");
  {
    const root = mkdtempSync(join(tmpdir(), "awkit-oracle-failclosed-"));
    try {
      // Runtime + bridge present, but NO ojdbc/ucp driver jars vendored.
      makeBundle(root, { withDriver: false });

      const packagedNoDriver = resolveOracleRuntime({ resourcesRoot: root, appMode: "packaged" });
      check("packaged + bundle but missing driver jars → unavailable (never mock)", packagedNoDriver.available === false && packagedNoDriver.source === "none");
      check("packaged + missing driver → reason names the driver, notes Snapshot still works", /driver/i.test(packagedNoDriver.reason ?? "") && /snapshot/i.test(packagedNoDriver.reason ?? ""));
      check("packaged + missing driver → mock is forbidden", packagedNoDriver.mockAllowed === false && packagedNoDriver.requireRealDriver === true);

      // The same bundle in DEV is allowed to use the database-free mock so the protocol works offline.
      const devNoDriver = resolveOracleRuntime({ resourcesRoot: root, appMode: "dev" });
      check("dev + bundle, no driver → available via mock (dev only)", devNoDriver.available === true && devNoDriver.mockAllowed === true);
      check("dev launch spec sets AWKIT_ORACLE_BRIDGE_MOCK, never AWKIT_ORACLE_REQUIRE_REAL", devNoDriver.launchSpec?.env?.AWKIT_ORACLE_BRIDGE_MOCK === "1" && devNoDriver.launchSpec?.env?.AWKIT_ORACLE_REQUIRE_REAL === undefined);

      // A forceMock request must be ignored under packaged production.
      const packagedForceMock = resolveOracleRuntime({ resourcesRoot: root, appMode: "packaged", forceMock: true });
      check("packaged + forceMock → still fails closed, mock flag not honored", packagedForceMock.available === false && packagedForceMock.launchSpec === undefined);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
