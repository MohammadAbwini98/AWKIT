/**
 * Oracle JDBC bridge packaging + runtime resolution (Phases 11–12, user-selected-Java model).
 *
 * Specter no longer bundles a JRE or Oracle driver jars — it ships only its own tiny bridge jar. The
 * user selects a Java runtime + an Oracle JDBC driver in Settings. This verifier exercises the
 * checksum-validation and runtime-resolution LOGIC against synthetic fixtures in a temp dir: the bridge
 * jar must be present; a Java runtime must be selected (or, in dev only, `AWKIT_ORACLE_BRIDGE_JDK_HOME`);
 * packaged production fails closed with a clear "not configured" message and never uses the mock.
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

const isWin = process.platform === "win32";

/** Create a packaged-style resources tree with ONLY Specter's bridge jar (no JRE, no driver jars). */
function makeBridge(root: string): { oracleDir: string; jarPath: string } {
  const oracleDir = join(root, "oracle-jdbc");
  const bridgeDir = join(oracleDir, "bridge");
  mkdirSync(bridgeDir, { recursive: true });
  const jarPath = join(bridgeDir, "awkit-oracle-jdbc-bridge.jar");
  writeFileSync(jarPath, "fake-bridge-jar");
  return { oracleDir, jarPath };
}

/** A fake, existing java(.exe) the resolver can accept as a user selection. */
function makeFakeJava(root: string): string {
  const p = join(root, isWin ? "java.exe" : "java");
  writeFileSync(p, "fake-java-binary");
  return p;
}

async function main(): Promise<void> {
  console.log("Checksum validation (pure, synthetic fixtures):");
  {
    const root = mkdtempSync(join(tmpdir(), "awkit-oracle-checksums-"));
    try {
      const { oracleDir, jarPath } = makeBridge(root);

      const noManifest = validateOracleBundleChecksums(oracleDir);
      check("no checksums.json → ok, not checked (lazy availability)", noManifest.ok === true && noManifest.checked === false);

      const goodHash = computeSha256(jarPath);
      writeFileSync(join(oracleDir, "checksums.json"), JSON.stringify({ "bridge/awkit-oracle-jdbc-bridge.jar": `sha256:${goodHash}` }));
      const valid = validateOracleBundleChecksums(oracleDir);
      check("matching checksum → ok", valid.ok === true && valid.checked === true && valid.issues.length === 0);

      writeFileSync(join(oracleDir, "checksums.json"), JSON.stringify({ "bridge/awkit-oracle-jdbc-bridge.jar": "sha256:deadbeef00000000000000000000000000000000000000000000000000000000" }));
      const mismatched = validateOracleBundleChecksums(oracleDir);
      check("wrong checksum → rejected", mismatched.ok === false && /mismatch/.test(mismatched.issues[0] ?? ""));

      writeFileSync(join(oracleDir, "checksums.json"), JSON.stringify({ "lib/ojdbc11.jar": "sha256:abc123" }));
      const missingFile = validateOracleBundleChecksums(oracleDir);
      check("declared-but-missing file → rejected", missingFile.ok === false && /missing/.test(missingFile.issues[0] ?? ""));

      writeFileSync(join(oracleDir, "checksums.json"), "not json");
      const malformed = validateOracleBundleChecksums(oracleDir);
      check("malformed checksums.json → rejected, not a crash", malformed.ok === false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  console.log("Runtime resolution — user-selected Java (pure, synthetic fixtures):");
  {
    const root = mkdtempSync(join(tmpdir(), "awkit-oracle-resolve-"));
    const savedEnv = process.env.AWKIT_ORACLE_BRIDGE_JDK_HOME;
    delete process.env.AWKIT_ORACLE_BRIDGE_JDK_HOME; // isolate from the dev fallback
    try {
      makeBridge(root);
      const fakeJava = makeFakeJava(root);

      // Packaged, bridge jar missing entirely.
      const noBridge = resolveOracleRuntime({ resourcesRoot: join(root, "nope"), appMode: "packaged", selectedJavaPath: fakeJava });
      check("packaged + no bridge jar → unavailable, does not fall back", noBridge.available === false && noBridge.source === "none");
      check("packaged + no bridge jar → clear reinstall reason", /reinstall/i.test(noBridge.reason ?? ""));

      // Packaged, bridge present but NO Java configured → fail closed with the not-configured message.
      const packagedNoJava = resolveOracleRuntime({ resourcesRoot: root, appMode: "packaged" });
      check("packaged + no Java → unavailable, notConfigured", packagedNoJava.available === false && packagedNoJava.notConfigured === true);
      check("packaged + no Java → message points to Settings → Database Drivers", /Settings\s*→\s*Database Drivers/.test(packagedNoJava.reason ?? ""));
      check("packaged + no Java → mock forbidden", packagedNoJava.mockAllowed === false && packagedNoJava.requireRealDriver === true);

      // Packaged, bridge + selected Java → available, real required, mock never set.
      const packagedOk = resolveOracleRuntime({ resourcesRoot: root, appMode: "packaged", selectedJavaPath: fakeJava });
      check("packaged + bridge + selected Java → available, source bundled", packagedOk.available === true && packagedOk.source === "bundled");
      check("packaged → requireRealDriver, mock forbidden, driverExpected false at base", packagedOk.requireRealDriver === true && packagedOk.mockAllowed === false && packagedOk.driverExpected === false);
      check("packaged launch spec forces REQUIRE_REAL and never sets mock", packagedOk.launchSpec?.env?.AWKIT_ORACLE_REQUIRE_REAL === "1" && packagedOk.launchSpec?.env?.AWKIT_ORACLE_BRIDGE_MOCK === undefined);
      check("packaged launch spec uses the selected java", packagedOk.launchSpec?.javaPath === fakeJava);

      // Bundled checksum gate still fails closed on tamper.
      const goodHash = computeSha256(join(root, "oracle-jdbc", "bridge", "awkit-oracle-jdbc-bridge.jar"));
      writeFileSync(join(root, "oracle-jdbc", "checksums.json"), JSON.stringify({ "bridge/awkit-oracle-jdbc-bridge.jar": `sha256:${goodHash}` }));
      const validChecksum = resolveOracleRuntime({ resourcesRoot: root, appMode: "packaged", selectedJavaPath: fakeJava });
      check("packaged + matching checksums.json → available", validChecksum.available === true);

      writeFileSync(join(root, "oracle-jdbc", "checksums.json"), JSON.stringify({ "bridge/awkit-oracle-jdbc-bridge.jar": "sha256:deadbeef00000000000000000000000000000000000000000000000000000000" }));
      const badChecksum = resolveOracleRuntime({ resourcesRoot: root, appMode: "packaged", selectedJavaPath: fakeJava });
      check("packaged + failing checksum → unavailable (fails closed)", badChecksum.available === false);
      check("packaged + failing checksum → reason mentions checksum", /checksum/i.test(badChecksum.reason ?? ""));
    } finally {
      if (savedEnv !== undefined) process.env.AWKIT_ORACLE_BRIDGE_JDK_HOME = savedEnv;
      rmSync(root, { recursive: true, force: true });
    }
  }

  console.log("Fail-closed production + dev fallback:");
  {
    const root = mkdtempSync(join(tmpdir(), "awkit-oracle-failclosed-"));
    const savedEnv = process.env.AWKIT_ORACLE_BRIDGE_JDK_HOME;
    delete process.env.AWKIT_ORACLE_BRIDGE_JDK_HOME;
    try {
      makeBridge(root); // (packaged resources tree — unused in dev, but harmless)
      const fakeJava = makeFakeJava(root);
      // Dev looks for the dev-built jar under repoRoot/oracle-jdbc-bridge/target.
      const devJar = join(root, "oracle-jdbc-bridge", "target", "awkit-oracle-jdbc-bridge.jar");
      mkdirSync(join(root, "oracle-jdbc-bridge", "target"), { recursive: true });
      writeFileSync(devJar, "fake-dev-bridge-jar");

      // Dev, bridge present, Java selected → available via the database-free mock (dev only).
      const devSelected = resolveOracleRuntime({ resourcesRoot: root, appMode: "dev", repoRoot: root, selectedJavaPath: fakeJava });
      check("dev + selected Java → available, source dev, mock allowed", devSelected.available === true && devSelected.source === "dev" && devSelected.mockAllowed === true);
      check("dev base spec sets the mock flag, never REQUIRE_REAL", devSelected.launchSpec?.env?.AWKIT_ORACLE_BRIDGE_MOCK === "1" && devSelected.launchSpec?.env?.AWKIT_ORACLE_REQUIRE_REAL === undefined);

      // Dev, NO selection but AWKIT_ORACLE_BRIDGE_JDK_HOME set → available via the dev env fallback.
      const fakeHome = join(root, "fake-jdk");
      mkdirSync(join(fakeHome, "bin"), { recursive: true });
      writeFileSync(join(fakeHome, "bin", isWin ? "java.exe" : "java"), "fake-java-binary");
      process.env.AWKIT_ORACLE_BRIDGE_JDK_HOME = fakeHome;
      const devEnvFallback = resolveOracleRuntime({ resourcesRoot: root, appMode: "dev", repoRoot: root });
      check("dev + AWKIT_ORACLE_BRIDGE_JDK_HOME → available via env fallback", devEnvFallback.available === true && devEnvFallback.launchSpec?.javaPath === join(fakeHome, "bin", isWin ? "java.exe" : "java"));

      // Packaged NEVER honors the env fallback (production must not auto-use an env JDK).
      const packagedNoEnv = resolveOracleRuntime({ resourcesRoot: root, appMode: "packaged" });
      check("packaged ignores AWKIT_ORACLE_BRIDGE_JDK_HOME → not configured", packagedNoEnv.available === false && packagedNoEnv.notConfigured === true);
      delete process.env.AWKIT_ORACLE_BRIDGE_JDK_HOME;

      // Dev, NO Java and NO env fallback → not configured (no auto-scan of hardcoded paths).
      const devNoJava = resolveOracleRuntime({ resourcesRoot: root, appMode: "dev", repoRoot: root });
      check("dev + no Java + no env → not configured (no auto-scan)", devNoJava.available === false && devNoJava.notConfigured === true);

      // A forceMock request must be ignored under packaged production (still require-real).
      const packagedForceMock = resolveOracleRuntime({ resourcesRoot: root, appMode: "packaged", forceMock: true, selectedJavaPath: fakeJava });
      check("packaged + forceMock → mock flag not honored (require-real)", packagedForceMock.launchSpec?.env?.AWKIT_ORACLE_BRIDGE_MOCK === undefined && packagedForceMock.launchSpec?.env?.AWKIT_ORACLE_REQUIRE_REAL === "1");
    } finally {
      if (savedEnv !== undefined) process.env.AWKIT_ORACLE_BRIDGE_JDK_HOME = savedEnv;
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
