/**
 * Stages the raw, unbundled Zvec utility-host tree for packaging.
 *
 * Implements docs/AWKIT_ZVEC_BLOCKER_RESOLUTION_IMPLEMENTATION_PLAN.md §8.3. Output goes to
 * build/native-hosts/zvec/ and is shipped verbatim by electron-builder `extraResources`, so the
 * host and its native dependencies are versioned and validated as one unit and can never be
 * pulled into an electron-vite chunk (Phase 0B Finding A — a bundled caller hard-crashes).
 *
 * This script NEVER downloads anything. It copies from the already-installed node_modules tree
 * and fails loudly rather than silently producing a partial or source-built package.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const NODE_MODULES = path.join(ROOT, "node_modules");
const HOST_SOURCE = path.join(ROOT, "native-hosts", "zvec", "zvec-host.cjs");
const OUT_DIR = path.join(ROOT, "build", "native-hosts", "zvec");
const OUT_MODULES = path.join(OUT_DIR, "node_modules");

const REQUIRED_PLATFORM = "win32";
const REQUIRED_ARCH = "x64";
const BINDING_PKG = "@zvec/bindings-win32-x64";

const failures = [];
function fail(message) {
  failures.push(message);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/**
 * Copy a single file, refusing symlinks and any path that escapes the staging root. A symlinked
 * `.node` would package a link rather than the binary, and a path escape would let a malformed
 * package name write outside build/.
 */
function copyFile(from, toRel) {
  const stat = fs.lstatSync(from);
  if (stat.isSymbolicLink()) {
    fail(`Refusing to stage a symlink: ${path.relative(ROOT, from)}`);
    return null;
  }
  const to = path.resolve(OUT_DIR, toRel);
  if (!to.startsWith(OUT_DIR + path.sep)) {
    fail(`Refusing to stage outside the staging root: ${toRel}`);
    return null;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return to;
}

function copyTree(fromDir, toRel, staged) {
  for (const entry of fs.readdirSync(fromDir, { withFileTypes: true })) {
    const from = path.join(fromDir, entry.name);
    const rel = `${toRel}/${entry.name}`;
    if (entry.isDirectory()) {
      copyTree(from, rel, staged);
    } else if (entry.isFile()) {
      if (copyFile(from, rel)) staged.push(rel);
    } else if (entry.isSymbolicLink()) {
      fail(`Refusing to stage a symlink: ${path.relative(ROOT, from)}`);
    }
  }
}

// ── Preconditions ────────────────────────────────────────────────────────────────────────────

if (process.platform !== REQUIRED_PLATFORM || process.arch !== REQUIRED_ARCH) {
  fail(`Staging must run on ${REQUIRED_PLATFORM}-${REQUIRED_ARCH} (got ${process.platform}-${process.arch}).`);
}

if (!fs.existsSync(HOST_SOURCE)) {
  fail(`Missing raw host source: ${path.relative(ROOT, HOST_SOURCE)}`);
}

const rootPkg = readJson(path.join(ROOT, "package.json"));
const pinnedZvec = rootPkg.dependencies?.["@zvec/zvec"];
if (!pinnedZvec) {
  fail("@zvec/zvec must be a pinned production dependency in package.json.");
} else if (!/^\d+\.\d+\.\d+$/.test(pinnedZvec)) {
  fail(`@zvec/zvec must be pinned to an exact version (found "${pinnedZvec}").`);
}

const zvecDir = path.join(NODE_MODULES, "@zvec", "zvec");
const bindingDir = path.join(NODE_MODULES, BINDING_PKG.replace("/", path.sep));
const bindingsHelperDir = path.join(NODE_MODULES, "bindings");

if (!fs.existsSync(zvecDir)) fail("@zvec/zvec is not installed.");
// The Windows binding is an OPTIONAL dependency: npm silently omits it under --no-optional or a
// platform mismatch, which would otherwise yield a package that builds fine and fails at runtime.
if (!fs.existsSync(bindingDir)) {
  fail(`${BINDING_PKG} is not installed. Install with optional dependencies enabled; the prebuilt Windows binding is mandatory.`);
}

let zvecPkg = null;
let bindingPkg = null;
if (fs.existsSync(zvecDir)) zvecPkg = readJson(path.join(zvecDir, "package.json"));
if (fs.existsSync(bindingDir)) bindingPkg = readJson(path.join(bindingDir, "package.json"));

if (zvecPkg && pinnedZvec && zvecPkg.version !== pinnedZvec) {
  fail(`Installed @zvec/zvec ${zvecPkg.version} does not match the pinned ${pinnedZvec}.`);
}
if (zvecPkg && bindingPkg && zvecPkg.version !== bindingPkg.version) {
  fail(`Binding version ${bindingPkg.version} does not match @zvec/zvec ${zvecPkg.version}.`);
}
if (bindingPkg) {
  if (!bindingPkg.os?.includes(REQUIRED_PLATFORM) || !bindingPkg.cpu?.includes(REQUIRED_ARCH)) {
    fail(`${BINDING_PKG} does not declare ${REQUIRED_PLATFORM}/${REQUIRED_ARCH}.`);
  }
}

// A prebuilt package must ship a .node and no compiler inputs. binding.gyp / build/Release output
// means the binary was compiled on this machine, which the plan forbids shipping (§8.2).
for (const dir of [zvecDir, bindingDir]) {
  if (!fs.existsSync(dir)) continue;
  if (fs.existsSync(path.join(dir, "binding.gyp"))) {
    fail(`Unexpected source-build input (binding.gyp) in ${path.relative(ROOT, dir)}; a prebuilt binding is required.`);
  }
  if (fs.existsSync(path.join(dir, "build", "Release"))) {
    fail(`Unexpected source-build output (build/Release) in ${path.relative(ROOT, dir)}; a prebuilt binding is required.`);
  }
}

const nativeBinary = path.join(bindingDir, "zvec_node_binding.node");
const dictFiles = [
  path.join(bindingDir, "jieba_dict", "jieba.dict.utf8"),
  path.join(bindingDir, "jieba_dict", "hmm_model.utf8")
];
if (fs.existsSync(bindingDir)) {
  if (!fs.existsSync(nativeBinary)) fail("Prebuilt zvec_node_binding.node is missing from the binding package.");
  for (const d of dictFiles) {
    if (!fs.existsSync(d)) fail(`Jieba dictionary missing: ${path.relative(ROOT, d)}`);
  }
}

if (failures.length > 0) {
  console.error("prepare-zvec-native-host FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

// ── Stage ────────────────────────────────────────────────────────────────────────────────────

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_MODULES, { recursive: true });

const staged = [];
if (copyFile(HOST_SOURCE, "zvec-host.cjs")) staged.push("zvec-host.cjs");

// @zvec/zvec ships a pure-JS loader; only its runtime entry points and license are needed.
for (const rel of ["src/index.js", "src/index.mjs", "src/index.d.ts", "src/index.d.mts", "package.json", "LICENSE"]) {
  const from = path.join(zvecDir, rel);
  if (!fs.existsSync(from)) continue;
  const to = `node_modules/@zvec/zvec/${rel}`;
  if (copyFile(from, to)) staged.push(to);
}

// The whole binding package is copied as one unit: the vendor loader auto-registers the jieba
// dictionary ONLY when jieba_dict/ sits directly beside the loaded .node file, so adjacency is a
// correctness requirement, not a convenience (confirmed from the loader source and the built package).
copyTree(bindingDir, `node_modules/${BINDING_PKG}`, staged);

// `bindings` is a declared runtime dependency of @zvec/zvec; stage it so the host's own module
// root resolves without ever reaching into app.asar.
if (fs.existsSync(bindingsHelperDir)) {
  copyTree(bindingsHelperDir, "node_modules/bindings", staged);
}

if (failures.length > 0) {
  console.error("prepare-zvec-native-host FAILED during staging:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

// Verify adjacency actually survived staging, rather than trusting the copy loop.
const stagedBinary = path.join(OUT_MODULES, BINDING_PKG.replace("/", path.sep), "zvec_node_binding.node");
const stagedDictDir = path.join(path.dirname(stagedBinary), "jieba_dict");
if (!fs.existsSync(stagedBinary)) {
  console.error("prepare-zvec-native-host FAILED: staged native binary is missing.");
  process.exit(1);
}
for (const name of ["jieba.dict.utf8", "hmm_model.utf8"]) {
  if (!fs.existsSync(path.join(stagedDictDir, name))) {
    console.error(`prepare-zvec-native-host FAILED: ${name} is not adjacent to the staged binary.`);
    process.exit(1);
  }
}
if (sha256(stagedBinary) !== sha256(nativeBinary)) {
  console.error("prepare-zvec-native-host FAILED: staged native binary differs from the source binary.");
  process.exit(1);
}

// ── Manifest ─────────────────────────────────────────────────────────────────────────────────

const assets = staged
  .sort()
  .map((rel) => {
    const abs = path.join(OUT_DIR, rel);
    return { relativePath: rel, size: fs.statSync(abs).size, sha256: sha256(abs) };
  });

const manifest = {
  schema: { name: "awkit-zvec-native-host-manifest", version: 1 },
  enabled: true,
  requiredForAppStartup: false,
  hostProtocolVersion: 1,
  hostEntry: "zvec-host.cjs",
  zvecVersion: zvecPkg.version,
  bindingVersion: bindingPkg.version,
  platform: REQUIRED_PLATFORM,
  arch: REQUIRED_ARCH,
  builtAt: new Date().toISOString(),
  totalBytes: assets.reduce((sum, a) => sum + a.size, 0),
  assets
};

fs.writeFileSync(
  path.join(OUT_DIR, "zvec-native-host-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8"
);

console.log(`Staged Zvec native host -> ${path.relative(ROOT, OUT_DIR)}`);
console.log(`  zvec ${manifest.zvecVersion} / binding ${manifest.bindingVersion} (${REQUIRED_PLATFORM}-${REQUIRED_ARCH})`);
console.log(`  ${assets.length} files, ${(manifest.totalBytes / 1024 / 1024).toFixed(1)} MB`);
