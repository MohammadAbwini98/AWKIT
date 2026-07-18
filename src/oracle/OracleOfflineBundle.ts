import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { validateOracleBundleChecksums } from "./OracleBundleChecksums";

/**
 * Audit a packaged Oracle JDBC bundle (`resources/oracle-jdbc/`) for offline integrity — Phase 08,
 * user-selected-Java model. The only Oracle artifact Specter bundles is its own tiny **bridge jar**;
 * the Java runtime and Oracle JDBC driver are **user-selected in Settings** and are never bundled.
 * Shared by the offline validator and packaging verifier. The bundle is OPTIONAL: when it is absent,
 * the audit is a clean pass with `present: false` (Oracle is simply un-bundled). When present, it must
 * be checksum-valid, structurally complete (bridge jar + manifest + checksums), carry NO private JRE
 * and NO driver jars, and contain NO secrets/wallets.
 */
export interface OracleBundleAudit {
  ok: boolean;
  present: boolean;
  issues: string[];
  sizeBytes: number;
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
    return { ok: true, present: false, issues: [], sizeBytes: 0 };
  }

  const issues: string[] = [];

  // Integrity: every checksums.json entry must exist and match.
  const checksums = validateOracleBundleChecksums(oracleDir);
  if (!checksums.ok) {
    issues.push(...checksums.issues.map((i) => `checksums: ${i}`));
  } else if (!checksums.checked) {
    issues.push("checksums.json is missing — bundle integrity cannot be verified.");
  }

  // Structure: only Specter's own bridge jar (+ manifest + checksums) is bundled.
  for (const rel of REQUIRED_FILES) {
    if (!existsSync(join(oracleDir, rel))) issues.push(`missing required file: ${rel.replace(/\\/g, "/")}`);
  }

  // Selection model: Specter must NOT bundle a private JRE or an Oracle driver — those are chosen by
  // the user in Settings → Database Drivers. Flag any that slipped into the packaged bundle.
  const javaExe = platform === "win32" ? "java.exe" : "java";
  if (existsSync(join(oracleDir, "runtime", "bin", javaExe))) {
    issues.push(`bundle must not ship a private JRE (found runtime/bin/${javaExe}); Java is user-selected.`);
  }
  const libDir = join(oracleDir, "lib");
  if (existsSync(libDir) && readdirSync(libDir).some((f) => f.toLowerCase().endsWith(".jar"))) {
    issues.push("bundle must not ship Oracle driver jars (found lib/*.jar); drivers are user-selected.");
  }

  // No secrets/wallets may ship.
  let sizeBytes = 0;
  for (const file of walkFiles(oracleDir)) {
    sizeBytes += statSync(file).size;
    const name = file.split(/[\\/]/).pop() ?? "";
    if (FORBIDDEN_RE.test(name) || FORBIDDEN_NAMES.has(name.toLowerCase())) {
      issues.push(`forbidden secret/wallet artifact present: ${name}`);
    }
  }

  return { ok: issues.length === 0, present: true, issues, sizeBytes };
}
