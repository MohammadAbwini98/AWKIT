/**
 * Oracle private-runtime PREPARATION logic (Phase 02). Exercises `prepareOracleRuntime` against
 * synthetic fixtures (no real jars/JRE — build-time network is blocked), proving it verifies
 * checksums, validates architecture + Java version, requires license notices, fails closed, and is
 * reproducible. The resulting bundle is checked with the same `validateOracleBundleChecksums` the
 * runtime resolver uses in production.
 *
 * Run: `npm run verify:oracle-runtime-prep`.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { readFileSync } from "node:fs";
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

/** A committed-shaped manifest with empty sha256 slots (filled at prepare time). */
function writeManifest(path: string, overrides: Record<string, unknown> = {}): void {
  const manifest = {
    schemaVersion: 1,
    feature: "oracle-jdbc",
    platform: { os: process.platform, arch: process.arch },
    java: { minVersion: 17 },
    artifacts: [
      { id: "jre", kind: "runtime-dir", source: "runtime", stageTo: "runtime", sha256: "" },
      { id: "ojdbc", kind: "jar", filename: "ojdbc11.jar", source: "ojdbc11.jar", stageTo: "lib", sha256: "" },
      { id: "ucp", kind: "jar", filename: "ucp11.jar", source: "ucp11.jar", stageTo: "lib", sha256: "" }
    ],
    licenses: [
      { id: "oracle-otn", file: "ORACLE-LICENSE.txt", appliesTo: ["ojdbc", "ucp"], required: true },
      { id: "temurin", file: "JRE-LICENSE.txt", appliesTo: ["jre"], required: true }
    ],
    ...overrides
  };
  writeFileSync(path, JSON.stringify(manifest, null, 2));
}

/** A staging directory that looks like out-of-band-acquired artifacts. */
function makeSource(root: string): { sourceDir: string; bridgeJarPath: string } {
  const sourceDir = join(root, "src");
  mkdirSync(join(sourceDir, "runtime", "bin"), { recursive: true });
  writeFileSync(join(sourceDir, "runtime", "bin", javaExe), "fake-java");
  writeFileSync(join(sourceDir, "runtime", "release"), 'JAVA_VERSION="17.0.11"\n');
  writeFileSync(join(sourceDir, "ojdbc11.jar"), "fake-ojdbc-contents");
  writeFileSync(join(sourceDir, "ucp11.jar"), "fake-ucp-contents");
  writeFileSync(join(sourceDir, "ORACLE-LICENSE.txt"), "Oracle license notice");
  writeFileSync(join(sourceDir, "JRE-LICENSE.txt"), "JRE license notice");
  const bridgeJarPath = join(root, "awkit-oracle-jdbc-bridge.jar");
  writeFileSync(bridgeJarPath, "fake-bridge-jar");
  return { sourceDir, bridgeJarPath };
}

const good17 = () => 17;

function main(): void {
  console.log("Preparation logic (synthetic fixtures):");

  // 1) Happy path.
  {
    const root = mkdtempSync(join(tmpdir(), "awkit-oracle-prep-ok-"));
    try {
      const manifestPath = join(root, "manifest.json");
      writeManifest(manifestPath);
      const { sourceDir, bridgeJarPath } = makeSource(root);
      const resourcesRoot = join(root, "resources");
      const res = prepareOracleRuntime({ manifestPath, sourceDir, resourcesRoot, bridgeJarPath, probeJavaMajor: good17, quiet: true });

      check("happy path → ok", res.ok === true && res.issues.length === 0);
      const oracleDir = join(resourcesRoot, "oracle-jdbc");
      check("stages the ojdbc/ucp jars", existsSync(join(oracleDir, "lib", "ojdbc11.jar")) && existsSync(join(oracleDir, "lib", "ucp11.jar")));
      check("stages the private JRE tree", existsSync(join(oracleDir, "runtime", "bin", javaExe)));
      check("stages the bridge jar", existsSync(join(oracleDir, "bridge", "awkit-oracle-jdbc-bridge.jar")));
      check("stages both license notices", existsSync(join(oracleDir, "LICENSES", "ORACLE-LICENSE.txt")) && existsSync(join(oracleDir, "LICENSES", "JRE-LICENSE.txt")));
      check("writes checksums.json + manifest.json", existsSync(join(oracleDir, "checksums.json")) && existsSync(join(oracleDir, "manifest.json")));

      const validation = validateOracleBundleChecksums(oracleDir);
      check("generated checksums.json validates with the production validator", validation.ok === true && validation.checked === true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // 2) Missing artifact → fail closed.
  {
    const root = mkdtempSync(join(tmpdir(), "awkit-oracle-prep-missing-"));
    try {
      const manifestPath = join(root, "manifest.json");
      writeManifest(manifestPath);
      const { sourceDir, bridgeJarPath } = makeSource(root);
      rmSync(join(sourceDir, "ucp11.jar"));
      const resourcesRoot = join(root, "resources");
      const res = prepareOracleRuntime({ manifestPath, sourceDir, resourcesRoot, bridgeJarPath, probeJavaMajor: good17, quiet: true });
      check("missing jar → not ok", res.ok === false);
      check("missing jar → names the file", res.issues.some((i: string) => /ucp11\.jar/.test(i) && /missing/i.test(i)));
      check("missing jar → no checksums.json written (fail closed)", !existsSync(join(resourcesRoot, "oracle-jdbc", "checksums.json")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // 3) Checksum mismatch → fail closed.
  {
    const root = mkdtempSync(join(tmpdir(), "awkit-oracle-prep-badsum-"));
    try {
      const manifestPath = join(root, "manifest.json");
      writeManifest(manifestPath, {
        artifacts: [
          { id: "jre", kind: "runtime-dir", source: "runtime", stageTo: "runtime", sha256: "" },
          { id: "ojdbc", kind: "jar", filename: "ojdbc11.jar", source: "ojdbc11.jar", stageTo: "lib", sha256: "sha256:deadbeef" },
          { id: "ucp", kind: "jar", filename: "ucp11.jar", source: "ucp11.jar", stageTo: "lib", sha256: "" }
        ]
      });
      const { sourceDir, bridgeJarPath } = makeSource(root);
      const resourcesRoot = join(root, "resources");
      const res = prepareOracleRuntime({ manifestPath, sourceDir, resourcesRoot, bridgeJarPath, probeJavaMajor: good17, quiet: true });
      check("checksum mismatch → not ok", res.ok === false);
      check("checksum mismatch → names it", res.issues.some((i: string) => /checksum mismatch/i.test(i) && /ojdbc11/.test(i)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // 4) Wrong architecture → fail closed.
  {
    const root = mkdtempSync(join(tmpdir(), "awkit-oracle-prep-arch-"));
    try {
      const manifestPath = join(root, "manifest.json");
      writeManifest(manifestPath, { platform: { os: process.platform, arch: "x64" } });
      const { sourceDir, bridgeJarPath } = makeSource(root);
      const resourcesRoot = join(root, "resources");
      const res = prepareOracleRuntime({ manifestPath, sourceDir, resourcesRoot, bridgeJarPath, probeJavaMajor: good17, platformArch: "arm64", quiet: true });
      check("wrong arch → not ok", res.ok === false);
      check("wrong arch → clear reason", res.issues.some((i: string) => /architecture mismatch/i.test(i)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // 5) Unsupported Java → fail closed.
  {
    const root = mkdtempSync(join(tmpdir(), "awkit-oracle-prep-java-"));
    try {
      const manifestPath = join(root, "manifest.json");
      writeManifest(manifestPath);
      const { sourceDir, bridgeJarPath } = makeSource(root);
      const resourcesRoot = join(root, "resources");
      const res = prepareOracleRuntime({ manifestPath, sourceDir, resourcesRoot, bridgeJarPath, probeJavaMajor: () => 8, quiet: true });
      check("unsupported Java → not ok", res.ok === false);
      check("unsupported Java → names version", res.issues.some((i: string) => /unsupported java version/i.test(i)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // 6) Missing license notice → fail closed.
  {
    const root = mkdtempSync(join(tmpdir(), "awkit-oracle-prep-lic-"));
    try {
      const manifestPath = join(root, "manifest.json");
      writeManifest(manifestPath);
      const { sourceDir, bridgeJarPath } = makeSource(root);
      rmSync(join(sourceDir, "JRE-LICENSE.txt"));
      const resourcesRoot = join(root, "resources");
      const res = prepareOracleRuntime({ manifestPath, sourceDir, resourcesRoot, bridgeJarPath, probeJavaMajor: good17, quiet: true });
      check("missing notice → not ok", res.ok === false);
      check("missing notice → names it", res.issues.some((i: string) => /license notice/i.test(i) && /JRE-LICENSE/.test(i)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // 7) Repeatable preparation → identical checksums.json.
  {
    const root = mkdtempSync(join(tmpdir(), "awkit-oracle-prep-repeat-"));
    try {
      const manifestPath = join(root, "manifest.json");
      writeManifest(manifestPath);
      const { sourceDir, bridgeJarPath } = makeSource(root);
      const rootsA = join(root, "a");
      const rootsB = join(root, "b");
      const a = prepareOracleRuntime({ manifestPath, sourceDir, resourcesRoot: rootsA, bridgeJarPath, probeJavaMajor: good17, quiet: true });
      const b = prepareOracleRuntime({ manifestPath, sourceDir, resourcesRoot: rootsB, bridgeJarPath, probeJavaMajor: good17, quiet: true });
      const sumsA = JSON.parse(readFileSync(join(rootsA, "oracle-jdbc", "checksums.json"), "utf8"));
      const sumsB = JSON.parse(readFileSync(join(rootsB, "oracle-jdbc", "checksums.json"), "utf8"));
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
