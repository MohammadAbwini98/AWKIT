/**
 * Stages the raw, unbundled local-AI utility-host tree for packaging (Phase L, L7 › Packaging:
 * "Installer carries the pinned runtime and integration only").
 *
 * Output goes to build/native-hosts/ai/ (or `--out <dir>`) and is shipped verbatim by electron-builder
 * `extraResources` as resources/native-hosts/ai. `native-hosts/ai/ai-host.cjs` resolves node-llama-cpp
 * from its own module paths, so the runtime is staged beside it: node-llama-cpp, the CPU-only
 * `@node-llama-cpp/win-x64` prebuilt, and node-llama-cpp's declared runtime dependency closure, each at
 * the same relative place it has under the repository's node_modules, so resolution in the staged tree
 * is the resolution that was tested. Mirrors scripts/prepare-zvec-native-host.mjs.
 *
 * This script NEVER downloads or builds anything. It copies from the already-installed node_modules
 * tree and fails loudly rather than producing a partial, source-built or GPU-enabled package. The
 * runtime build it stages must equal AI_RUNTIME_PIN.build in src/offline/AiModelManifest.ts, which the
 * host re-checks in its handshake. No model pack is ever staged: the pack is imported in Settings.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const NODE_MODULES = path.join(ROOT, "node_modules");
const HOST_SOURCE = path.join(ROOT, "native-hosts", "ai", "ai-host.cjs");
const PIN_SOURCE = path.join(ROOT, "src", "offline", "AiModelManifest.ts");
const DEFAULT_OUT = path.join(ROOT, "build", "native-hosts", "ai");
const MANIFEST_NAME = "ai-native-host-manifest.json";

const REQUIRED_PLATFORM = "win32";
const REQUIRED_ARCH = "x64";
const RUNTIME_PACKAGE = "node-llama-cpp";
const BINARY_PACKAGE = "@node-llama-cpp/win-x64";
const ADDON_REL = path.join("bins", "win-x64", "llama-addon.node");

/**
 * Never needed to load or run the runtime: type declarations, source maps, import libraries, docs.
 * LICENSE and NOTICE files are always kept.
 */
const EXCLUDED_FILE = [/\.d\.[cm]?ts$/i, /\.map$/i, /\.lib$/i, /\.tsbuildinfo$/i, /^(readme|changelog|history)(\.[a-z]+)?$/i];
/** Per-package subpaths that are build inputs or CLI scaffolding, never runtime code. */
const EXCLUDED_SUBPATH = {
  [RUNTIME_PACKAGE]: ["llama/gitRelease.bundle", "templates"]
};

const failures = [];
const fail = (message) => failures.push(message);

function stop(stage) {
  if (failures.length === 0) return;
  console.error(`prepare-ai-native-host FAILED${stage ? ` ${stage}` : ""}:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const posix = (p) => p.split(path.sep).join("/");

// ── Output directory ─────────────────────────────────────────────────────────────────────────────

const outFlag = process.argv.indexOf("--out");
const OUT_DIR = outFlag >= 0 ? path.resolve(process.argv[outFlag + 1] ?? "") : DEFAULT_OUT;
const relToRoot = path.relative(ROOT, OUT_DIR);
const insideRoot = relToRoot === "" || (!relToRoot.startsWith("..") && !path.isAbsolute(relToRoot));
if (OUT_DIR !== DEFAULT_OUT && insideRoot) {
  fail(`--out must be the default ${posix(path.relative(ROOT, DEFAULT_OUT))} or a directory outside the repository (got ${OUT_DIR}).`);
}
// The directory is replaced, so it must be empty, absent, or an earlier staging of this script.
if (fs.existsSync(OUT_DIR) && fs.readdirSync(OUT_DIR).length > 0 && !fs.existsSync(path.join(OUT_DIR, MANIFEST_NAME))) {
  fail(`Refusing to replace ${OUT_DIR}: it is not empty and holds no ${MANIFEST_NAME}.`);
}

// ── Preconditions ────────────────────────────────────────────────────────────────────────────────

if (process.platform !== REQUIRED_PLATFORM || process.arch !== REQUIRED_ARCH) {
  fail(`Staging must run on ${REQUIRED_PLATFORM}-${REQUIRED_ARCH} (got ${process.platform}-${process.arch}).`);
}
if (!fs.existsSync(HOST_SOURCE)) fail(`Missing raw host source: ${posix(path.relative(ROOT, HOST_SOURCE))}`);

const rootPkg = readJson(path.join(ROOT, "package.json"));
const pinnedVersion = rootPkg.devDependencies?.[RUNTIME_PACKAGE] ?? rootPkg.dependencies?.[RUNTIME_PACKAGE];
if (!pinnedVersion || !/^\d+\.\d+\.\d+$/.test(pinnedVersion)) {
  fail(`${RUNTIME_PACKAGE} must be pinned to an exact version in package.json (found "${pinnedVersion}").`);
}

const pinMatch = /AI_RUNTIME_PIN[\s\S]*?build:\s*"([^"]+)"/.exec(fs.readFileSync(PIN_SOURCE, "utf8"));
const pinnedBuild = pinMatch?.[1] ?? null;
if (!pinnedBuild) fail("AI_RUNTIME_PIN.build is not set in src/offline/AiModelManifest.ts; an unpinned runtime is never staged.");

const hostProtocol = /const PROTOCOL_VERSION = (\d+);/.exec(fs.existsSync(HOST_SOURCE) ? fs.readFileSync(HOST_SOURCE, "utf8") : "");
if (!hostProtocol) fail("The host's PROTOCOL_VERSION could not be read.");

const runtimeDir = path.join(NODE_MODULES, RUNTIME_PACKAGE);
const binaryDir = path.join(NODE_MODULES, ...BINARY_PACKAGE.split("/"));
if (!fs.existsSync(path.join(runtimeDir, "package.json"))) fail(`${RUNTIME_PACKAGE} is not installed.`);
// The Windows CPU prebuilt is an OPTIONAL dependency: npm silently omits it under --no-optional or a
// platform mismatch, which would otherwise yield a package that stages fine and fails at runtime.
if (!fs.existsSync(path.join(binaryDir, "package.json"))) {
  fail(`${BINARY_PACKAGE} is not installed. Install with optional dependencies enabled; the CPU prebuilt is mandatory.`);
}
stop("(preconditions)");

const runtimePkg = readJson(path.join(runtimeDir, "package.json"));
const binaryPkg = readJson(path.join(binaryDir, "package.json"));
const release = readJson(path.join(runtimeDir, "llama", "binariesGithubRelease.json"));
const runtimeBuild = `${RUNTIME_PACKAGE}@${runtimePkg.version}+llama.cpp@${release.release}`;

if (runtimePkg.version !== pinnedVersion) fail(`Installed ${RUNTIME_PACKAGE} ${runtimePkg.version} does not match the pinned ${pinnedVersion}.`);
if (binaryPkg.version !== runtimePkg.version) fail(`${BINARY_PACKAGE} ${binaryPkg.version} does not match ${RUNTIME_PACKAGE} ${runtimePkg.version}.`);
if (!binaryPkg.os?.includes(REQUIRED_PLATFORM) || !binaryPkg.cpu?.includes(REQUIRED_ARCH)) {
  fail(`${BINARY_PACKAGE} does not declare ${REQUIRED_PLATFORM}/${REQUIRED_ARCH}.`);
}
if (runtimeBuild !== pinnedBuild) fail(`Installed runtime ${runtimeBuild} is not the pinned ${pinnedBuild}.`);
if (!fs.existsSync(path.join(binaryDir, ADDON_REL))) fail(`The prebuilt llama-addon.node is missing from ${BINARY_PACKAGE}.`);
// A binary compiled on this machine is never shipped; only the published prebuilt is.
if (fs.existsSync(path.join(runtimeDir, "llama", "localBuilds"))) {
  fail(`${RUNTIME_PACKAGE}/llama/localBuilds exists: a locally built binary must never be staged.`);
}
stop("(runtime identity)");

// ── Runtime dependency closure ───────────────────────────────────────────────────────────────────

/** Node's lookup order for `name` from a package directory, confined to the repository. */
function lookup(fromDir, name) {
  let dir = fromDir;
  for (;;) {
    if (path.basename(dir) !== "node_modules") {
      const candidate = path.join(dir, "node_modules", ...name.split("/"));
      if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    }
    if (dir === ROOT) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const closure = new Map([[runtimeDir, RUNTIME_PACKAGE]]);
const queue = [runtimeDir];
while (queue.length > 0) {
  const dir = queue.shift();
  const pkg = readJson(path.join(dir, "package.json"));
  const optional = new Set(Object.keys(pkg.optionalDependencies ?? {}));
  const names = [...new Set([...Object.keys(pkg.dependencies ?? {}), ...optional])];
  for (const name of names) {
    // Only the CPU prebuilt of node-llama-cpp's platform binaries; GPU and other platforms never ship.
    if (name.startsWith("@node-llama-cpp/") && name !== BINARY_PACKAGE) continue;
    const found = lookup(dir, name);
    if (!found) {
      if (!optional.has(name) || name === BINARY_PACKAGE) fail(`Declared runtime dependency ${name} of ${pkg.name} is not installed.`);
      continue;
    }
    if (fs.lstatSync(found).isSymbolicLink()) {
      fail(`Refusing to stage a symlinked package: ${posix(path.relative(ROOT, found))}`);
      continue;
    }
    if (!closure.has(found)) {
      closure.set(found, name);
      queue.push(found);
    }
  }
}
stop("(dependency closure)");

// ── Stage ────────────────────────────────────────────────────────────────────────────────────────

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });
const staged = [];

/** Copy one file, refusing symlinks and any path that escapes the staging root. */
function copyFile(from, toRel) {
  if (fs.lstatSync(from).isSymbolicLink()) {
    fail(`Refusing to stage a symlink: ${posix(path.relative(ROOT, from))}`);
    return;
  }
  const to = path.resolve(OUT_DIR, toRel);
  if (!to.startsWith(OUT_DIR + path.sep)) {
    fail(`Refusing to stage outside the staging root: ${toRel}`);
    return;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  staged.push(posix(toRel));
}

/**
 * Copy a package directory without its nested node_modules: a nested package in the closure is staged
 * as its own entry at its own relative path, and one outside the closure is not a runtime dependency.
 */
function copyPackage(pkgDir, name) {
  const excluded = (EXCLUDED_SUBPATH[name] ?? []).map((sub) => path.join(pkgDir, ...sub.split("/")));
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const from = path.join(dir, entry.name);
      if (excluded.some((ex) => from === ex || from.startsWith(ex + path.sep))) continue;
      // electron-builder's extraResources filter ("**/*") never ships a dotfile or dot-directory, so
      // staging one would make the signed manifest list a file the installer does not carry (measured:
      // the packaged tree lacked chmodrp/.gitkeep). None is runtime code; the staged tree is what ships.
      if (entry.name.startsWith(".")) continue;
      if (entry.isSymbolicLink()) {
        fail(`Refusing to stage a symlink: ${posix(path.relative(ROOT, from))}`);
      } else if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(from);
      } else if (entry.isFile()) {
        if (!EXCLUDED_FILE.some((pattern) => pattern.test(entry.name))) copyFile(from, path.relative(ROOT, from));
      }
    }
  };
  walk(pkgDir);
}

copyFile(HOST_SOURCE, "ai-host.cjs");
for (const [dir, name] of closure) copyPackage(dir, name);
stop("during staging");

// Verify what was staged rather than trusting the copy loop.
const stagedAddon = path.join(OUT_DIR, "node_modules", ...BINARY_PACKAGE.split("/"), ADDON_REL);
if (!fs.existsSync(stagedAddon) || sha256(stagedAddon) !== sha256(path.join(binaryDir, ADDON_REL))) {
  fail("The staged llama-addon.node is missing or differs from the installed prebuilt.");
}
if (sha256(path.join(OUT_DIR, "ai-host.cjs")) !== sha256(HOST_SOURCE)) fail("The staged host differs from native-hosts/ai/ai-host.cjs.");
stop("verifying the staged tree");

// ── Manifest ─────────────────────────────────────────────────────────────────────────────────────

const assets = staged.sort().map((rel) => {
  const abs = path.join(OUT_DIR, ...rel.split("/"));
  return { relativePath: rel, size: fs.statSync(abs).size, sha256: sha256(abs) };
});

const manifest = {
  schema: { name: "awkit-ai-native-host-manifest", version: 1 },
  enabled: true,
  // The AI subsystem is optional: a missing or broken runtime disables AI features and changes
  // nothing else (ROADMAP stability guarantee: no model / error / busy / disabled ⇒ behavior as today).
  requiredForAppStartup: false,
  hostProtocolVersion: Number(hostProtocol[1]),
  hostEntry: "ai-host.cjs",
  runtimeBuild,
  runtimeVersion: runtimePkg.version,
  binaryPackage: BINARY_PACKAGE,
  binaryVersion: binaryPkg.version,
  gpu: false,
  platform: REQUIRED_PLATFORM,
  arch: REQUIRED_ARCH,
  packages: closure.size,
  fileCount: assets.length,
  totalBytes: assets.reduce((sum, a) => sum + a.size, 0),
  builtAt: new Date().toISOString(),
  assets
};

fs.writeFileSync(path.join(OUT_DIR, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`Staged local-AI native host -> ${insideRoot ? posix(path.relative(ROOT, OUT_DIR)) : OUT_DIR}`);
console.log(`  ${runtimeBuild} / ${BINARY_PACKAGE} ${binaryPkg.version} (${REQUIRED_PLATFORM}-${REQUIRED_ARCH}, CPU only)`);
console.log(`  ${closure.size} packages, ${assets.length} files, ${(manifest.totalBytes / 1024 / 1024).toFixed(1)} MB`);
