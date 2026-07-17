import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { validateOracleBundleChecksums } from "./OracleBundleChecksums";

/**
 * Audit a packaged Oracle JDBC bundle (`resources/oracle-jdbc/`) for offline integrity — Phase 08.
 * Shared by the offline validator and packaging verifier. The bundle is OPTIONAL: when it is absent,
 * the audit is a clean pass with `present: false` (Oracle is simply un-bundled). When present, it must
 * be checksum-valid, structurally complete, carry a real driver, and contain NO secrets/wallets.
 */
export interface OracleBundleAudit {
  ok: boolean;
  present: boolean;
  issues: string[];
  sizeBytes: number;
  driverPresent: boolean;
}

const REQUIRED_FILES = ["manifest.json", "checksums.json", join("bridge", "awkit-oracle-jdbc-bridge.jar")];
const FORBIDDEN_RE = /\.(env|pem|p12|sso|jks|key)$/i;
const FORBIDDEN_NAMES = new Set(["tnsnames.ora", "sqlnet.ora", "cwallet.sso", "ewallet.p12"]);

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(dir);
  return out;
}

export function auditOracleOfflineBundle(oracleDir: string, platform: NodeJS.Platform = process.platform): OracleBundleAudit {
  if (!existsSync(oracleDir)) {
    return { ok: true, present: false, issues: [], sizeBytes: 0, driverPresent: false };
  }

  const issues: string[] = [];

  // Integrity: every checksums.json entry must exist and match.
  const checksums = validateOracleBundleChecksums(oracleDir);
  if (!checksums.ok) {
    issues.push(...checksums.issues.map((i) => `checksums: ${i}`));
  } else if (!checksums.checked) {
    issues.push("checksums.json is missing — bundle integrity cannot be verified.");
  }

  // Structure.
  for (const rel of REQUIRED_FILES) {
    if (!existsSync(join(oracleDir, rel))) issues.push(`missing required file: ${rel.replace(/\\/g, "/")}`);
  }
  const javaExe = platform === "win32" ? "java.exe" : "java";
  if (!existsSync(join(oracleDir, "runtime", "bin", javaExe))) {
    issues.push(`missing private JRE (runtime/bin/${javaExe}).`);
  }

  // A real driver is mandatory in a packaged bundle (the app fails closed without one).
  const libDir = join(oracleDir, "lib");
  const driverPresent = existsSync(libDir) && readdirSync(libDir).some((f) => f.toLowerCase().endsWith(".jar"));
  if (!driverPresent) issues.push("no ojdbc/ucp jars in lib/ — packaged builds require a real driver.");

  // No secrets/wallets may ship.
  let sizeBytes = 0;
  for (const file of walkFiles(oracleDir)) {
    sizeBytes += statSync(file).size;
    const name = file.split(/[\\/]/).pop() ?? "";
    if (FORBIDDEN_RE.test(name) || FORBIDDEN_NAMES.has(name.toLowerCase())) {
      issues.push(`forbidden secret/wallet artifact present: ${name}`);
    }
  }

  return { ok: issues.length === 0, present: true, issues, sizeBytes, driverPresent };
}
