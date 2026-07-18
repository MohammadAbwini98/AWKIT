/**
 * Packaged Oracle bundle offline-integrity audit (Phase 08, user-selected-Java model). Exercises
 * `auditOracleOfflineBundle` (the shared logic behind the offline validator's Oracle section) against
 * synthetic fixtures — a valid bridge-only bundle, a bundle that wrongly ships a private JRE, a bundle
 * that wrongly ships a driver jar, a secret-leaking bundle, a checksum-mismatched bundle, and an absent
 * (optional) bundle — plus a skip-if-absent pass over the real `resources/oracle-jdbc`.
 *
 * Specter bundles ONLY its own bridge jar; the Java runtime + Oracle driver are user-selected in
 * Settings and must never appear in the packaged bundle.
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

/**
 * Build a valid synthetic bundle (bridge jar + manifest + checksums) with a correct checksums.json.
 * Optionally inject the artifacts the selection model forbids (a private JRE or a driver jar) or a
 * secret file, to prove the audit rejects them.
 */
function makeBundle(root: string, opts: { withJre?: boolean; withDriver?: boolean; secretFile?: string } = {}): string {
  const dir = join(root, "oracle-jdbc");
  mkdirSync(join(dir, "bridge"), { recursive: true });
  writeFileSync(join(dir, "bridge", "awkit-oracle-jdbc-bridge.jar"), "bridge");
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ schemaVersion: 1, runtimeModel: "user-selected" }));

  const rels = ["bridge/awkit-oracle-jdbc-bridge.jar", "manifest.json"];
  if (opts.withJre) {
    mkdirSync(join(dir, "runtime", "bin"), { recursive: true });
    writeFileSync(join(dir, "runtime", "bin", javaExe), "java");
    rels.push("runtime/bin/" + javaExe);
  }
  if (opts.withDriver) {
    mkdirSync(join(dir, "lib"), { recursive: true });
    writeFileSync(join(dir, "lib", "ojdbc11.jar"), "ojdbc");
    rels.push("lib/ojdbc11.jar");
  }
  if (opts.secretFile) {
    writeFileSync(join(dir, opts.secretFile), "SECRET");
    rels.push(opts.secretFile);
  }

  // Correct checksums over everything except checksums.json itself.
  const sums: Record<string, string> = {};
  for (const rel of rels) sums[rel] = `sha256:${computeSha256(join(dir, rel))}`;
  writeFileSync(join(dir, "checksums.json"), JSON.stringify(sums, null, 2));
  return dir;
}

function main(): void {
  console.log("Bundle audit (synthetic fixtures, selection model):");

  // 1) Valid bridge-only bundle → ok.
  {
    const root = mkdtempSync(join(tmpdir(), "awkit-oracle-bundle-ok-"));
    try {
      const dir = makeBundle(root);
      const audit = auditOracleOfflineBundle(dir);
      check("valid bridge-only bundle → ok", audit.ok === true && audit.present === true && audit.issues.length === 0);
      check("valid bundle → non-zero size", audit.sizeBytes > 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // 2) Bundle that ships a private JRE → fail (Java is user-selected, never bundled).
  {
    const root = mkdtempSync(join(tmpdir(), "awkit-oracle-bundle-jre-"));
    try {
      const dir = makeBundle(root, { withJre: true });
      const audit = auditOracleOfflineBundle(dir);
      check("bundled private JRE → not ok", audit.ok === false);
      check("bundled private JRE → flagged as forbidden", audit.issues.some((i) => /private JRE/i.test(i)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // 3) Bundle that ships a driver jar → fail (drivers are user-selected, never bundled).
  {
    const root = mkdtempSync(join(tmpdir(), "awkit-oracle-bundle-drv-"));
    try {
      const dir = makeBundle(root, { withDriver: true });
      const audit = auditOracleOfflineBundle(dir);
      check("bundled driver jar → not ok", audit.ok === false);
      check("bundled driver jar → flagged as forbidden", audit.issues.some((i) => /driver jars/i.test(i)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // 4) Secret/wallet leak → fail.
  {
    const root = mkdtempSync(join(tmpdir(), "awkit-oracle-bundle-secret-"));
    try {
      const dir = makeBundle(root, { secretFile: "cwallet.sso" });
      const audit = auditOracleOfflineBundle(dir);
      check("secret/wallet present → not ok", audit.ok === false);
      check("secret/wallet → flagged by name", audit.issues.some((i) => /forbidden secret\/wallet/i.test(i)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // 5) Checksum mismatch → fail.
  {
    const root = mkdtempSync(join(tmpdir(), "awkit-oracle-bundle-badsum-"));
    try {
      const dir = makeBundle(root);
      writeFileSync(join(dir, "manifest.json"), JSON.stringify({ schemaVersion: 1, tampered: true }));
      const audit = auditOracleOfflineBundle(dir);
      check("tampered file → checksum mismatch → not ok", audit.ok === false && audit.issues.some((i) => /checksum|mismatch/i.test(i)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // 6) Absent bundle → clean pass (optional feature).
  {
    const root = mkdtempSync(join(tmpdir(), "awkit-oracle-bundle-absent-"));
    try {
      const audit = auditOracleOfflineBundle(join(root, "oracle-jdbc"));
      check("absent bundle → ok + present:false (optional feature)", audit.ok === true && audit.present === false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // 7) Real resources dir — skip-if-absent snapshot of current state.
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
