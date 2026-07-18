/**
 * Oracle bridge-bundle PREPARATION logic (Phase 02, user-selected-Java model). Exercises
 * `prepareOracleRuntime` against synthetic fixtures, proving it stages ONLY Specter's own bridge jar
 * (no JRE, no driver jars), validates architecture, fails closed on a missing jar, is reproducible,
 * and produces a bundle the production `validateOracleBundleChecksums` accepts.
 *
 * Run: `npm run verify:oracle-runtime-prep`.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain ESM helper, no type declarations.
import { prepareOracleRuntime } from "./prepare-oracle-runtime.mjs";
import { validateOracleBundleChecksums } from "../src/oracle/OracleBundleChecksums";

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
const javaExe = isWin ? "java.exe" : "java";

/** A committed-shaped manifest with an empty sha256 slot (filled at prepare time). */
function writeManifest(path: string, overrides: Record<string, unknown> = {}): void {
  const manifest = {
    schemaVersion: 1,
    feature: "oracle-jdbc",
    platform: { os: process.platform, arch: process.arch },
    runtimeModel: "user-selected",
    java: { model: "user-selected", minVersion: 8 },
    driver: { model: "user-selected" },
    artifacts: [
      { id: "bridge", kind: "jar", filename: "awkit-oracle-jdbc-bridge.jar", source: "awkit-oracle-jdbc-bridge.jar", stageTo: "bridge", sha256: "" }
    ],
    licenses: [],
    ...overrides
  };
  writeFileSync(path, JSON.stringify(manifest, null, 2));
}

/** A reproducibly-built bridge jar (the only input the prepare step needs). */
function makeBridgeJar(root: string): string {
  const bridgeJarPath = join(root, "awkit-oracle-jdbc-bridge.jar");
  writeFileSync(bridgeJarPath, "fake-bridge-jar");
  return bridgeJarPath;
}

function main(): void {
  console.log("Bridge-bundle preparation logic (synthetic fixtures, selection model):");

  // 1) Happy path — stages ONLY the bridge jar.
  {
    const root = mkdtempSync(join(tmpdir(), "awkit-oracle-prep-ok-"));
    try {
      const manifestPath = join(root, "manifest.json");
      writeManifest(manifestPath);
      const bridgeJarPath = makeBridgeJar(root);
      const resourcesRoot = join(root, "resources");
      const res = prepareOracleRuntime({ manifestPath, resourcesRoot, bridgeJarPath, quiet: true });

      check("happy path → ok", res.ok === true && res.issues.length === 0);
      const oracleDir = join(resourcesRoot, "oracle-jdbc");
      check("stages the bridge jar", existsSync(join(oracleDir, "bridge", "awkit-oracle-jdbc-bridge.jar")));
      check("writes checksums.json + manifest.json", existsSync(join(oracleDir, "checksums.json")) && existsSync(join(oracleDir, "manifest.json")));
      check("does NOT bundle a private JRE", !existsSync(join(oracleDir, "runtime", "bin", javaExe)));
      check("does NOT bundle any driver jars (no lib/)", !existsSync(join(oracleDir, "lib")));
      const manifest = JSON.parse(readFileSync(join(oracleDir, "manifest.json"), "utf8"));
      check("resolved manifest records the bridge jar sha256", /^sha256:[0-9a-f]{64}$/.test(manifest.artifacts?.[0]?.sha256 ?? ""));

      const validation = validateOracleBundleChecksums(oracleDir);
      check("generated checksums.json validates with the production validator", validation.ok === true && validation.checked === true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // 2) Missing bridge jar → fail closed.
  {
    const root = mkdtempSync(join(tmpdir(), "awkit-oracle-prep-missing-"));
    try {
      const manifestPath = join(root, "manifest.json");
      writeManifest(manifestPath);
      const resourcesRoot = join(root, "resources");
      const res = prepareOracleRuntime({ manifestPath, resourcesRoot, bridgeJarPath: join(root, "nope.jar"), quiet: true });
      check("missing bridge jar → not ok", res.ok === false);
      check("missing bridge jar → names it", res.issues.some((i: string) => /bridge jar/i.test(i)));
      check("missing bridge jar → no checksums.json written (fail closed)", !existsSync(join(resourcesRoot, "oracle-jdbc", "checksums.json")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // 3) Wrong architecture → fail closed.
  {
    const root = mkdtempSync(join(tmpdir(), "awkit-oracle-prep-arch-"));
    try {
      const manifestPath = join(root, "manifest.json");
      writeManifest(manifestPath, { platform: { os: process.platform, arch: "x64" } });
      const bridgeJarPath = makeBridgeJar(root);
      const resourcesRoot = join(root, "resources");
      const res = prepareOracleRuntime({ manifestPath, resourcesRoot, bridgeJarPath, platformArch: "arm64", quiet: true });
      check("wrong arch → not ok", res.ok === false);
      check("wrong arch → clear reason", res.issues.some((i: string) => /architecture mismatch/i.test(i)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // 4) Repeatable preparation → identical checksums.json.
  {
    const root = mkdtempSync(join(tmpdir(), "awkit-oracle-prep-repeat-"));
    try {
      const manifestPath = join(root, "manifest.json");
      writeManifest(manifestPath);
      const bridgeJarPath = makeBridgeJar(root);
      const a = prepareOracleRuntime({ manifestPath, resourcesRoot: join(root, "a"), bridgeJarPath, quiet: true });
      const b = prepareOracleRuntime({ manifestPath, resourcesRoot: join(root, "b"), bridgeJarPath, quiet: true });
      const sumsA = JSON.parse(readFileSync(join(root, "a", "oracle-jdbc", "checksums.json"), "utf8"));
      const sumsB = JSON.parse(readFileSync(join(root, "b", "oracle-jdbc", "checksums.json"), "utf8"));
      check("both runs succeed", a.ok === true && b.ok === true);
      check("repeatable → identical checksums (order-independent)", JSON.stringify(Object.entries(sumsA).sort()) === JSON.stringify(Object.entries(sumsB).sort()));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
