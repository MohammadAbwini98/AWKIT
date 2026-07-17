/**
 * Reproducible, offline preparation of the private Oracle JDBC runtime bundle (Phase 02).
 *
 * Consumes the locked manifest (`scripts/oracle/oracle-runtime.manifest.json`) and a local STAGING
 * directory of out-of-band-acquired artifacts (a private JRE tree, the ojdbc/ucp jars, and license
 * notices), then:
 *   1. validates architecture + Java version (never trusting JAVA_HOME/PATH),
 *   2. verifies each artifact's SHA-256 against the manifest (when recorded),
 *   3. stages everything under `resources/oracle-jdbc/{runtime,bridge,lib,LICENSES}`,
 *   4. copies the reproducibly-built bridge jar,
 *   5. writes the resolved `manifest.json` and regenerates `checksums.json`.
 *
 * It NEVER touches the network and FAILS CLOSED: a missing artifact, checksum mismatch, wrong
 * architecture, unsupported Java, or missing license notice aborts before any checksums.json is
 * written (so a partial/tampered bundle can never validate). With no staging directory present the
 * CLI skips cleanly — an documented external gate, not a failure.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const isWin = process.platform === "win32";
const javaExeName = isWin ? "java.exe" : "java";

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

/** Default Java-version probe: runs `<runtimeDir>/bin/java -version` and parses the feature version. */
function defaultProbeJavaMajor(runtimeDir) {
  try {
    const javaBin = join(runtimeDir, "bin", javaExeName);
    // `java -version` prints to stderr; execFileSync throws on nonzero but we capture both streams.
    const out = execFileSync(javaBin, ["-version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return parseJavaMajor(out);
  } catch (err) {
    const text = `${err?.stdout ?? ""}${err?.stderr ?? ""}`;
    const major = parseJavaMajor(text);
    return major || null;
  }
}

function parseJavaMajor(text) {
  const m = String(text).match(/version "(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  const major = Number(m[1]);
  // Legacy "1.8" scheme → feature version is the minor.
  if (major === 1 && m[2]) return Number(m[2]);
  return major;
}

/**
 * Pure preparation routine (injectable for tests). Returns `{ ok, staged, issues, checksumsPath, manifestPath }`.
 * Does not exit the process.
 */
export function prepareOracleRuntime(options) {
  const {
    manifestPath,
    sourceDir,
    resourcesRoot,
    bridgeJarPath,
    probeJavaMajor = defaultProbeJavaMajor,
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
  const libDir = join(oracleDir, "lib");
  const licensesDir = join(oracleDir, "LICENSES");
  const runtimeDir = join(oracleDir, "runtime");
  const bridgeDir = join(oracleDir, "bridge");

  // Fresh staging (leave nothing stale behind); only proceed to copies if platform is ok so far.
  if (issues.length === 0) {
    rmSync(oracleDir, { recursive: true, force: true });
    mkdirSync(libDir, { recursive: true });
    mkdirSync(licensesDir, { recursive: true });
  }

  // 2) Artifacts (jars + the private JRE tree).
  for (const artifact of manifest.artifacts ?? []) {
    if (issues.length && issues.some((i) => i.includes("mismatch"))) break; // platform already failed
    if (artifact.kind === "jar") {
      const src = join(sourceDir, artifact.source ?? artifact.filename);
      if (!existsSync(src)) {
        issues.push(`Missing artifact: ${artifact.filename} (expected at ${src}).`);
        continue;
      }
      const actual = sha256(src);
      if (artifact.sha256 && artifact.sha256.toLowerCase() !== actual.toLowerCase()) {
        issues.push(`Checksum mismatch: ${artifact.filename} (manifest ${artifact.sha256}, actual sha256:${actual}).`);
        continue;
      }
      cpSync(src, join(libDir, artifact.filename));
      artifact.sha256 = `sha256:${actual}`;
      staged.push(`lib/${artifact.filename}`);
    } else if (artifact.kind === "runtime-dir") {
      const srcRuntime = join(sourceDir, artifact.source ?? "runtime");
      if (!existsSync(srcRuntime) || !statSync(srcRuntime).isDirectory()) {
        issues.push(`Missing private JRE directory (expected at ${srcRuntime}).`);
        continue;
      }
      const javaBin = join(srcRuntime, "bin", javaExeName);
      if (!existsSync(javaBin)) {
        issues.push(`Private JRE is missing bin/${javaExeName}.`);
        continue;
      }
      const major = probeJavaMajor(srcRuntime);
      const minVersion = manifest.java?.minVersion ?? 17;
      if (!major) {
        issues.push("Could not determine the bundled Java version.");
      } else if (major < minVersion) {
        issues.push(`Unsupported Java version: ${major} (need >= ${minVersion}).`);
      }
      if (issues.length === 0) {
        cpSync(srcRuntime, runtimeDir, { recursive: true });
        staged.push("runtime/");
      }
    }
  }

  // 3) License notices (required for redistribution).
  for (const license of manifest.licenses ?? []) {
    if (license.required === false) continue;
    const src = join(sourceDir, license.file);
    if (!existsSync(src)) {
      issues.push(`Missing license notice: ${license.file} (required for ${license.appliesTo?.join(", ")}).`);
      continue;
    }
    if (issues.length === 0) {
      cpSync(src, join(licensesDir, license.file));
      staged.push(`LICENSES/${license.file}`);
    }
  }

  // 4) The reproducibly-built bridge jar.
  if (issues.length === 0) {
    if (!bridgeJarPath || !existsSync(bridgeJarPath)) {
      issues.push("Bridge jar not built (run scripts/build-oracle-bridge.mjs first).");
    } else {
      mkdirSync(bridgeDir, { recursive: true });
      cpSync(bridgeJarPath, join(bridgeDir, "awkit-oracle-jdbc-bridge.jar"));
      staged.push("bridge/awkit-oracle-jdbc-bridge.jar");
    }
  }

  if (issues.length > 0) {
    // Fail closed: never leave a checksums.json behind that could validate a partial/tampered bundle.
    rmSync(join(oracleDir, "checksums.json"), { force: true });
    return fail(issues);
  }

  // 5) Resolved manifest + checksums over the whole staged tree. The resolved manifest is written
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
  log(`[prepare:oracle-runtime] staged ${staged.length} artifact group(s); wrote ${Object.keys(checksums).length} checksums.`);

  return { ok: true, staged, issues: [], checksumsPath, manifestPath: resolvedManifestPath };

  function fail(list) {
    return { ok: false, staged, issues: list, checksumsPath: undefined, manifestPath: undefined };
  }
}

// ── CLI ────────────────────────────────────────────────────────────────────
async function cli() {
  const manifestPath = join(repoRoot, "scripts", "oracle", "oracle-runtime.manifest.json");
  const sourceDir = process.env.AWKIT_ORACLE_RUNTIME_SRC
    ? resolve(process.env.AWKIT_ORACLE_RUNTIME_SRC)
    : join(repoRoot, "oracle-runtime-src");
  const resourcesRoot = join(repoRoot, "resources");

  if (!existsSync(sourceDir)) {
    console.log(
      `[prepare:oracle-runtime] SKIPPED — no staged artifacts at ${sourceDir}.\n` +
        "  This is the documented external gate: acquire the private JRE + ojdbc/ucp jars + license\n" +
        "  notices out-of-band (build-time network is blocked), stage them there (or set\n" +
        "  AWKIT_ORACLE_RUNTIME_SRC), then re-run. See docs/ai/ORACLE_JDBC_RUNTIME_MATRIX.md."
    );
    process.exit(0);
  }

  // Build the bridge reproducibly (pinned JDK 17) so its jar can be staged + checksummed.
  const { buildOracleBridge } = await import("./build-oracle-bridge.mjs");
  const built = buildOracleBridge({ quiet: false });

  const result = prepareOracleRuntime({ manifestPath, sourceDir, resourcesRoot, bridgeJarPath: built.jarPath });
  if (!result.ok) {
    console.error("[prepare:oracle-runtime] FAILED (fail-closed):");
    for (const issue of result.issues) console.error(`  ✗ ${issue}`);
    process.exit(1);
  }
  console.log("[prepare:oracle-runtime] OK — bundle staged and checksummed.");
}

if (process.argv[1]?.endsWith("prepare-oracle-runtime.mjs")) {
  cli().catch((err) => {
    console.error(`[prepare:oracle-runtime] ERROR: ${err.message}`);
    process.exit(1);
  });
}
