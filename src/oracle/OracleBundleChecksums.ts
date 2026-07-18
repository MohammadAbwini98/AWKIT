import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Checksum validation for the packaged Oracle bundle (`resources/oracle-jdbc/`) — Phase 12. In the
 * user-selected-Java model the bundle contains only Specter's own bridge jar (+ manifest); the Java
 * runtime and Oracle driver are user-selected and never bundled. It ships a flat `checksums.json`
 * mapping each file's bundle-relative path to `sha256:<hex>`. Absence of `checksums.json` is not itself
 * a failure — a dev checkout or a build that hasn't staged the bridge yet has nothing to validate (lazy
 * availability); but once packaging writes one, every listed file MUST exist and match, and production
 * must not silently continue on a corrupted/tampered/incomplete bundle.
 */
export interface ChecksumValidationResult {
  ok: boolean;
  /** True when a checksums.json was found and actually checked (vs. nothing-to-validate). */
  checked: boolean;
  issues: string[];
}

export function computeSha256(filePath: string): string {
  const buf = readFileSync(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

function parseChecksumsJson(raw: string): Record<string, string> | null {
  try {
    const parsed = JSON.parse(raw.replace(/^﻿/, ""));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, string>;
  } catch {
    return null;
  }
}

/**
 * Validate every entry in `<oracleDir>/checksums.json` against the actual files on disk. Returns
 * `{ ok: true, checked: false }` when no checksums.json exists — nothing declared, nothing to fail.
 */
export function validateOracleBundleChecksums(oracleDir: string): ChecksumValidationResult {
  const checksumsPath = join(oracleDir, "checksums.json");
  if (!existsSync(checksumsPath)) {
    return { ok: true, checked: false, issues: [] };
  }

  const issues: string[] = [];
  let entries: Record<string, string> | null;
  try {
    entries = parseChecksumsJson(readFileSync(checksumsPath, "utf8"));
  } catch (err) {
    return { ok: false, checked: true, issues: [`Unable to read checksums.json: ${err instanceof Error ? err.message : String(err)}`] };
  }
  if (!entries) {
    return { ok: false, checked: true, issues: ["checksums.json is not a valid JSON object."] };
  }

  const relativePaths = Object.keys(entries);
  if (relativePaths.length === 0) {
    return { ok: false, checked: true, issues: ["checksums.json declares no files."] };
  }

  for (const relativePath of relativePaths) {
    const expected = entries[relativePath];
    const expectedHex = expected?.startsWith("sha256:") ? expected.slice("sha256:".length) : expected;
    if (!expectedHex) {
      issues.push(`${relativePath}: checksums.json entry is empty or malformed.`);
      continue;
    }
    const absolutePath = join(oracleDir, relativePath);
    if (!existsSync(absolutePath)) {
      issues.push(`${relativePath}: file declared in checksums.json is missing.`);
      continue;
    }
    const actualHex = computeSha256(absolutePath);
    if (actualHex.toLowerCase() !== expectedHex.toLowerCase()) {
      issues.push(`${relativePath}: checksum mismatch (bundle may be corrupted or tampered).`);
    }
  }

  return { ok: issues.length === 0, checked: true, issues };
}
