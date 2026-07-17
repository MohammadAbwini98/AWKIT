/**
 * Packaged Oracle bundle offline-integrity audit (Phase 08). Exercises `auditOracleOfflineBundle`
 * (the shared logic behind the offline validator's Oracle section) against synthetic fixtures — a
 * valid bundle, a driver-less bundle, a secret-leaking bundle, a checksum-mismatched bundle, and an
 * absent (optional) bundle — plus a skip-if-absent pass over the real `resources/oracle-jdbc`.
 *
 * Run: `npm run verify:oracle-offline-bundle`.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditOracleOfflineBundle } from "../src/oracle/OracleOfflineBundle";
import { computeSha256 } from "../src/oracle/OracleBundleChecksums";

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

const javaExe = process.platform === "win32" ? "java.exe" : "java";

/** Build a complete, valid synthetic bundle with a correct checksums.json. */
function makeValidBundle(root: string, opts: { withDriver?: boolean; secretFile?: string } = {}): string {
  const dir = join(root, "oracle-jdbc");
  mkdirSync(join(dir, "runtime", "bin"), { recursive: true });
  mkdirSync(join(dir, "bridge"), { recursive: true });
  mkdirSync(join(dir, "lib"), { recursive: true });
  mkdirSync(join(dir, "LICENSES"), { recursive: true });
  writeFileSync(join(dir, "runtime", "bin", javaExe), "java");
  writeFileSync(join(dir, "bridge", "awkit-oracle-jdbc-bridge.jar"), "bridge");
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ schemaVersion: 1 }));
  writeFileSync(join(dir, "LICENSES", "ORACLE-LICENSE.txt"), "license");
  if (opts.withDriver !== false) writeFileSync(join(dir, "lib", "ojdbc11.jar"), "ojdbc");
  if (opts.secretFile) writeFileSync(join(dir, opts.secretFile), "SECRET");

  // Correct checksums over everything except checksums.json itself.
  const rels = ["runtime/bin/" + javaExe, "bridge/awkit-oracle-jdbc-bridge.jar", "manifest.json", "LICENSES/ORACLE-LICENSE.txt"];
  if (opts.withDriver !== false) rels.push("lib/ojdbc11.jar");
  if (opts.secretFile) rels.push(opts.secretFile);
  const sums: Record<string, string> = {};
  for (const rel of rels) sums[rel] = `sha256:${computeSha256(join(dir, rel.replace(/\//g, "/")))}`;
  writeFileSync(join(dir, "checksums.json"), JSON.stringify(sums, null, 2));
  return dir;
}

function main(): void {
  console.log("Bundle audit (synthetic fixtures):");

  // 1) Valid complete bundle → ok.
  {
    const root = mkdtempSync(join(tmpdir(), "awkit-oracle-bundle-ok-"));
    try {
      const dir = makeValidBundle(root);
      const audit = auditOracleOfflineBundle(dir);
      check("valid bundle → ok", audit.ok === true && audit.present === true && audit.issues.length === 0);
      check("valid bundle → driver present + non-zero size", audit.driverPresent === true && audit.sizeBytes > 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // 2) Driver-less bundle → fail closed.
  {
    const root = mkdtempSync(join(tmpdir(), "awkit-oracle-bundle-nodrv-"));
    try {
      const dir = makeValidBundle(root, { withDriver: false });
      const audit = auditOracleOfflineBundle(dir);
      check("driver-less bundle → not ok", audit.ok === false && audit.driverPresent === false);
      check("driver-less bundle → names the missing driver", audit.issues.some((i) => /ojdbc\/ucp|driver/i.test(i)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // 3) Secret/wallet leak → fail.
  {
    const root = mkdtempSync(join(tmpdir(), "awkit-oracle-bundle-secret-"));
    try {
      const dir = makeValidBundle(root, { secretFile: "cwallet.sso" });
      const audit = auditOracleOfflineBundle(dir);
      check("secret/wallet present → not ok", audit.ok === false);
      check("secret/wallet → flagged by name", audit.issues.some((i) => /forbidden secret\/wallet/i.test(i)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // 4) Checksum mismatch → fail.
  {
    const root = mkdtempSync(join(tmpdir(), "awkit-oracle-bundle-badsum-"));
    try {
      const dir = makeValidBundle(root);
      writeFileSync(join(dir, "manifest.json"), JSON.stringify({ schemaVersion: 1, tampered: true }));
      const audit = auditOracleOfflineBundle(dir);
      check("tampered file → checksum mismatch → not ok", audit.ok === false && audit.issues.some((i) => /checksum|mismatch/i.test(i)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // 5) Absent bundle → clean pass (optional feature).
  {
    const root = mkdtempSync(join(tmpdir(), "awkit-oracle-bundle-absent-"));
    try {
      const audit = auditOracleOfflineBundle(join(root, "oracle-jdbc"));
      check("absent bundle → ok + present:false (optional feature)", audit.ok === true && audit.present === false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // 6) Real resources dir — skip-if-absent snapshot of current state.
  {
    const real = auditOracleOfflineBundle(join(repoRoot, "resources", "oracle-jdbc"));
    if (real.present) {
      check("real resources/oracle-jdbc audit passes", real.ok === true);
      console.log(`    (real bundle size: ${(real.sizeBytes / 1024 / 1024).toFixed(1)} MB)`);
    } else {
      console.log("  • real resources/oracle-jdbc not present (external gate: run prepare:oracle-runtime).");
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
