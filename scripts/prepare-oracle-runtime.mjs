/**
 * Reproducible, offline preparation of Specter's Oracle JDBC **bridge** bundle (Phase 02,
 * user-selected-Java model).
 *
 * Specter bundles ONLY its own tiny bridge jar. It does NOT bundle a JRE or Oracle driver jars — the
 * Java runtime and Oracle JDBC driver are selected by the user in Settings → Database Drivers and are
 * never vendored. This step therefore just:
 *   1. validates architecture + OS against the locked manifest (`oracle-runtime.manifest.json`),
 *   2. stages the reproducibly-built bridge jar under `resources/oracle-jdbc/bridge/`,
 *   3. records the jar's SHA-256 in the resolved `manifest.json` and regenerates `checksums.json`.
 *
 * It NEVER touches the network and FAILS CLOSED: a wrong architecture or a missing bridge jar aborts
 * before any checksums.json is written (so a partial/tampered bundle can never validate).
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

/** Recursively list files under `dir`, returned as forward-slash paths relative to `dir`. */
function listFilesRel(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(relative(dir, full).replace(/\\/g, "/"));
    }
  };
  walk(dir);
  return out;
}

/**
 * Pure preparation routine (injectable for tests). Returns `{ ok, staged, issues, checksumsPath, manifestPath }`.
 * Does not exit the process. Stages only Specter's own bridge jar (no JRE, no driver jars).
 */
export function prepareOracleRuntime(options) {
  const {
    manifestPath,
    resourcesRoot,
    bridgeJarPath,
    platformOs = process.platform,
    platformArch = process.arch,
    quiet = false
  } = options;
  const log = (...a) => (quiet ? undefined : console.log(...a));
  const issues = [];
  const staged = [];

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1) {
    return fail([`Unsupported manifest schemaVersion ${manifest.schemaVersion} (expected 1).`]);
  }

  // 1) Architecture + OS must match the locked platform.
  const expectedOs = manifest.platform?.os;
  const expectedArch = manifest.platform?.arch;
  if (expectedOs && platformOs !== expectedOs) {
    issues.push(`OS mismatch: manifest requires ${expectedOs}, got ${platformOs}.`);
  }
  if (expectedArch && platformArch !== expectedArch) {
    issues.push(`Architecture mismatch: manifest requires ${expectedArch}, got ${platformArch}.`);
  }

  const oracleDir = join(resourcesRoot, "oracle-jdbc");
  const bridgeDir = join(oracleDir, "bridge");

  // Fresh staging (leave nothing stale behind); only proceed to copies if the platform is ok.
  if (issues.length === 0) {
    rmSync(oracleDir, { recursive: true, force: true });
    mkdirSync(bridgeDir, { recursive: true });
  }

  // 2) The reproducibly-built bridge jar — the ONLY Oracle artifact Specter bundles.
  if (issues.length === 0) {
    if (!bridgeJarPath || !existsSync(bridgeJarPath)) {
      issues.push("Bridge jar not built (run scripts/build-oracle-bridge.mjs first).");
    } else {
      cpSync(bridgeJarPath, join(bridgeDir, "awkit-oracle-jdbc-bridge.jar"));
      staged.push("bridge/awkit-oracle-jdbc-bridge.jar");
      // Record the jar's hash in the manifest's bridge artifact (informational; checksums.json is authoritative).
      const bridgeArtifact = (manifest.artifacts ?? []).find((a) => a.id === "bridge");
      if (bridgeArtifact) bridgeArtifact.sha256 = `sha256:${sha256(bridgeJarPath)}`;
    }
  }

  if (issues.length > 0) {
    // Fail closed: never leave a checksums.json behind that could validate a partial/tampered bundle.
    rmSync(join(oracleDir, "checksums.json"), { force: true });
    return fail(issues);
  }

  // 3) Resolved manifest + checksums over the whole staged tree. The resolved manifest is written
  //    WITHOUT a timestamp so the bundle (and its checksums.json) is byte-for-byte reproducible.
  const resolvedManifestPath = join(oracleDir, "manifest.json");
  writeFileSync(resolvedManifestPath, JSON.stringify(manifest, null, 2));
  const checksums = {};
  for (const rel of listFilesRel(oracleDir)) {
    if (rel === "checksums.json") continue;
    checksums[rel] = `sha256:${sha256(join(oracleDir, rel))}`;
  }
  const checksumsPath = join(oracleDir, "checksums.json");
  writeFileSync(checksumsPath, JSON.stringify(checksums, null, 2));
  log(`[prepare:oracle-runtime] staged ${staged.length} artifact(s); wrote ${Object.keys(checksums).length} checksums.`);

  return { ok: true, staged, issues: [], checksumsPath, manifestPath: resolvedManifestPath };

  function fail(list) {
    return { ok: false, staged, issues: list, checksumsPath: undefined, manifestPath: undefined };
  }
}

// ── CLI ────────────────────────────────────────────────────────────────────
async function cli() {
  const manifestPath = join(repoRoot, "scripts", "oracle", "oracle-runtime.manifest.json");
  const resourcesRoot = join(repoRoot, "resources");

  // Build the bridge reproducibly (pinned JDK 17) so its jar can be staged + checksummed.
  const { buildOracleBridge } = await import("./build-oracle-bridge.mjs");
  const built = buildOracleBridge({ quiet: false });

  const result = prepareOracleRuntime({ manifestPath, resourcesRoot, bridgeJarPath: built.jarPath });
  if (!result.ok) {
    console.error("[prepare:oracle-runtime] FAILED (fail-closed):");
    for (const issue of result.issues) console.error(`  ✗ ${issue}`);
    process.exit(1);
  }
  console.log("[prepare:oracle-runtime] OK — bridge bundle staged and checksummed (no JRE/driver bundled; both are user-selected).");
}

if (process.argv[1]?.endsWith("prepare-oracle-runtime.mjs")) {
  cli().catch((err) => {
    console.error(`[prepare:oracle-runtime] ERROR: ${err.message}`);
    process.exit(1);
  });
}
