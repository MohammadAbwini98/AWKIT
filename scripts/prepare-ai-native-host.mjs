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
 * The one input from outside the repository is the Visual C++ runtime, copied from the Visual Studio
 * redist folder beside the native binaries (see "App-local Microsoft Visual C++ runtime" below).
 */

import { spawnSync } from "node:child_process";
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

// ── Repository boundary ──────────────────────────────────────────────────────────────────────────

const REAL_ROOT = fs.realpathSync(ROOT);
const samePath = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
const isInside = (base, candidate) => {
  const rel = path.relative(base, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/** The real path of `p`, resolving its nearest existing ancestor so a path still to be created is covered. */
function realPathOf(p) {
  const rest = [];
  let probe = p;
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) {
    rest.unshift(path.basename(probe));
    probe = path.dirname(probe);
  }
  return path.join(fs.realpathSync(probe), ...rest);
}

/**
 * A source path must resolve to exactly its own place inside the repository. A junction or symlink
 * anywhere on the way (a linked node_modules, an `npm link`ed package, a linked scope folder) would stage
 * files from outside the tree that was installed and tested, and nothing downstream could tell: the entry's
 * own lstat looks ordinary when the link sits on a parent.
 */
function confined(p, label) {
  const expected = path.join(REAL_ROOT, path.relative(ROOT, p));
  let real;
  try {
    real = fs.realpathSync(p);
  } catch (error) {
    fail(`Boundary: ${label} cannot be resolved (${error?.code ?? error}).`);
    return false;
  }
  if (!isInside(ROOT, p) || !samePath(real, expected)) {
    fail(`Boundary: ${label} resolves to ${real}, not ${expected}: it is reached through a link or lies outside the repository, and staging copies only real paths inside it.`);
    return false;
  }
  return true;
}

// ── Output directory ─────────────────────────────────────────────────────────────────────────────

const outFlag = process.argv.indexOf("--out");
const OUT_DIR = outFlag >= 0 ? path.resolve(process.argv[outFlag + 1] ?? "") : DEFAULT_OUT;
const insideRoot = isInside(ROOT, OUT_DIR);
if (OUT_DIR !== DEFAULT_OUT && insideRoot) {
  fail(`--out must be the default ${posix(path.relative(ROOT, DEFAULT_OUT))} or a directory outside the repository (got ${OUT_DIR}).`);
}
// The directory is removed and rewritten, so where it RESOLVES decides what is at risk: an --out that
// leads back into the repository through a junction, or a default whose parents are linked elsewhere.
const realOut = realPathOf(OUT_DIR);
if (OUT_DIR === DEFAULT_OUT) {
  if (!samePath(realOut, path.join(REAL_ROOT, path.relative(ROOT, DEFAULT_OUT)))) {
    fail(`Boundary: ${posix(path.relative(ROOT, DEFAULT_OUT))} resolves to ${realOut} through a link; the default output must be a real directory in the repository.`);
  }
} else if (!insideRoot && isInside(REAL_ROOT, realOut)) {
  fail(`Boundary: --out ${OUT_DIR} resolves to ${realOut}, inside the repository through a link; it must be the default or a directory outside the repository.`);
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
else confined(HOST_SOURCE, "native-hosts/ai/ai-host.cjs");

// Exactly one declaration, at an exact version: a second one with another range is a conflict, not a fallback.
const rootPkg = readJson(path.join(ROOT, "package.json"));
const declaredPins = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]
  .filter((section) => rootPkg[section]?.[RUNTIME_PACKAGE] !== undefined)
  .map((section) => `${section} ${rootPkg[section][RUNTIME_PACKAGE]}`);
const pinnedVersion = declaredPins.length === 1 ? (/^\S+ (\d+\.\d+\.\d+)$/.exec(declaredPins[0])?.[1] ?? null) : null;
if (!pinnedVersion) {
  fail(`package.json: ${RUNTIME_PACKAGE} must be declared exactly once, at an exact x.y.z version (found: ${declaredPins.join(", ") || "none"}).`);
}

/**
 * AI_RUNTIME_PIN, read strictly. A lazy match from the first mention of the name used to take the first
 * `build: "..."` anywhere after it, so an unpinned `build: null` followed by any other object's build read
 * as pinned, and a second declaration was never noticed. The source must declare it once, frozen, with one
 * `name` and one `build`, and the build must be a `node-llama-cpp@<x.y.z>+llama.cpp@<release>` string.
 */
function readRuntimePin(source) {
  const declared = [...source.matchAll(/^[ \t]*(?:export[ \t]+)?(?:const|let|var)[ \t]+AI_RUNTIME_PIN\b/gm)].length;
  const frozen = [...source.matchAll(/^export const AI_RUNTIME_PIN\b[^=\r\n]*=\s*Object\.freeze\(\{([^{}]*)\}\);/gm)];
  if (declared !== 1 || frozen.length !== 1) {
    return { problem: `src/offline/AiModelManifest.ts must declare it exactly once as \`export const AI_RUNTIME_PIN ... = Object.freeze({ ... });\` (found ${declared} declaration(s), ${frozen.length} in that form).` };
  }
  const builds = [...frozen[0][1].matchAll(/^\s*build\s*:\s*(.+?)\s*,?\s*$/gm)];
  const names = [...frozen[0][1].matchAll(/^\s*name\s*:\s*"llama\.cpp"\s*,?\s*$/gm)];
  if (builds.length !== 1 || names.length !== 1) {
    return { problem: `its declaration must set name: "llama.cpp" and exactly one build (found ${names.length} name, ${builds.length} build).` };
  }
  const value = builds[0][1];
  if (!/^"[^"]*"$/.test(value)) return { problem: `build is ${value}, not a pinned string; an unpinned runtime is never staged.` };
  const form = /^"(node-llama-cpp@(\d+\.\d+\.\d+)\+llama\.cpp@[A-Za-z0-9][A-Za-z0-9._-]*)"$/.exec(value);
  if (!form) return { problem: `build ${value} is not of the form node-llama-cpp@<x.y.z>+llama.cpp@<release>.` };
  return { build: form[1], npmVersion: form[2] };
}

let pinnedBuild = null;
if (!fs.existsSync(PIN_SOURCE)) {
  fail("AI_RUNTIME_PIN: src/offline/AiModelManifest.ts is missing; an unpinned runtime is never staged.");
} else if (confined(PIN_SOURCE, "src/offline/AiModelManifest.ts")) {
  const pin = readRuntimePin(fs.readFileSync(PIN_SOURCE, "utf8"));
  if (pin.problem) fail(`AI_RUNTIME_PIN: ${pin.problem}`);
  else if (pinnedVersion && pin.npmVersion !== pinnedVersion) {
    fail(`AI_RUNTIME_PIN: build names ${RUNTIME_PACKAGE} ${pin.npmVersion} but package.json pins ${pinnedVersion}; the two must agree.`);
  } else pinnedBuild = pin.build;
}

const hostProtocol = /const PROTOCOL_VERSION = (\d+);/.exec(fs.existsSync(HOST_SOURCE) ? fs.readFileSync(HOST_SOURCE, "utf8") : "");
if (!hostProtocol) fail("The host's PROTOCOL_VERSION could not be read.");

const runtimeDir = path.join(NODE_MODULES, RUNTIME_PACKAGE);
const binaryDir = path.join(NODE_MODULES, ...BINARY_PACKAGE.split("/"));
if (fs.existsSync(NODE_MODULES)) confined(NODE_MODULES, "node_modules");
if (!fs.existsSync(path.join(runtimeDir, "package.json"))) fail(`${RUNTIME_PACKAGE} is not installed.`);
else confined(runtimeDir, `node_modules/${RUNTIME_PACKAGE}`);
// The Windows CPU prebuilt is an OPTIONAL dependency: npm silently omits it under --no-optional or a
// platform mismatch, which would otherwise yield a package that stages fine and fails at runtime.
if (!fs.existsSync(path.join(binaryDir, "package.json"))) {
  fail(`${BINARY_PACKAGE} is not installed. Install with optional dependencies enabled; the CPU prebuilt is mandatory.`);
} else confined(binaryDir, `node_modules/${BINARY_PACKAGE}`);
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
    // The package's own entry AND every parent on its way must be real: a linked parent looks ordinary to lstat.
    if (!confined(found, posix(path.relative(ROOT, found)))) continue;
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
      // electron-builder drops some dotfiles from extraResources by its own default exclusions (measured:
      // of 13 staged, the packaged tree lacked chmodrp/.gitkeep), so a staged dotfile can be listed in the
      // signed manifest yet not shipped. None is runtime code (the runtime loads and infers without them),
      // so all are excluded and the staged tree is exactly what ships.
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

// ── App-local Microsoft Visual C++ runtime (awkit-i6ot) ─────────────────────────────────────────────

/**
 * The prebuilt llama/ggml binaries and the reflink addon import the Visual C++ 2015-2022 runtime, which
 * Windows does not ship, so without it local AI cannot load on a machine that never installed it. The
 * owner authorized (2026-09-25) app-local deployment from the Visual Studio redist folder, Microsoft's
 * documented source for these files, so every staged directory holding a native binary gets them beside
 * it. They come only from the Visual Studio installation vswhere reports (never System32), and each must
 * be a validly Microsoft-signed x64 image at least as new as the newest linker that built a staged
 * binary. Without that installation nothing is staged: a runtime that loads only where Visual C++ happens
 * to be installed is not shipped. `npm run verify:native-dependencies` proves the result.
 */
const MSVC_RUNTIME = ["msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll"];

function findVcRedist() {
  const vswhere = path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Microsoft Visual Studio", "Installer", "vswhere.exe");
  if (!fs.existsSync(vswhere)) return { problem: "no Visual Studio installation: vswhere.exe is absent" };
  // Both components: the tools write Microsoft.VCRedistVersion.default.txt, the redist component the CRT folder.
  const components = ["Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "Microsoft.VisualStudio.Component.VC.Redist.14.Latest"];
  const run = spawnSync(vswhere, ["-latest", "-products", "*", "-requires", ...components, "-property", "installationPath", "-utf8"], { encoding: "utf8", windowsHide: true, timeout: 60_000 });
  const install = `${run.stdout ?? ""}`.trim().split(/\r?\n/)[0];
  if (run.status !== 0 || !install) return { problem: `vswhere reports no released Visual Studio installation with ${components.join(" and ")}` };
  const versionFile = path.join(install, "VC", "Auxiliary", "Build", "Microsoft.VCRedistVersion.default.txt");
  const version = fs.existsSync(versionFile) ? fs.readFileSync(versionFile, "utf8").trim() : "";
  if (!/^14\.\d+\.\d+$/.test(version)) return { problem: `${versionFile} is missing or holds no 14.x.y redist version` };
  const archDir = path.join(install, "VC", "Redist", "MSVC", version, "x64");
  const crt = fs.existsSync(archDir) ? fs.readdirSync(archDir).filter((name) => /^Microsoft\.VC14\d\.CRT$/i.test(name)) : [];
  if (crt.length !== 1) return { problem: `expected one Microsoft.VC14x.CRT folder in ${archDir}, found ${crt.length}` };
  return { install, version, dir: path.join(archDir, crt[0]) };
}

/** Machine and linker version of a PE image, or null. */
function peHeader(file) {
  const b = fs.readFileSync(file);
  if (b.length < 0x40 || b.readUInt16LE(0) !== 0x5a4d) return null;
  const pe = b.readUInt32LE(0x3c);
  if (pe + 28 > b.length || b.readUInt32LE(pe) !== 0x4550) return null;
  return { machine: b.readUInt16LE(pe + 4), linker: [b.readUInt8(pe + 26), b.readUInt8(pe + 27)] };
}

/** Authenticode status, signer subject and file version of each file, in one PowerShell call. */
function signaturesOf(files) {
  const list = files.map((f) => `'${f.replace(/'/g, "''")}'`).join(",");
  const script =
    "$ErrorActionPreference='Stop'; " +
    `foreach ($p in @(${list})) { $s = Get-AuthenticodeSignature -LiteralPath $p; $v = (Get-Item -LiteralPath $p).VersionInfo; ` +
    "$subject = if ($s.SignerCertificate) { $s.SignerCertificate.Subject } else { '' }; " +
    "Write-Output ('{0}|{1}|{2}.{3}.{4}' -f $s.Status, $subject, $v.FileMajorPart, $v.FileMinorPart, $v.FileBuildPart) }";
  const run = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true, timeout: 120_000 });
  const lines = `${run.stdout ?? ""}`.split(/\r?\n/).filter(Boolean);
  return files.map((_, i) => {
    const [status = "Unread", subject = "", version = "0.0.0"] = (lines[i] ?? "").split("|");
    return { status, subject, version: version.split(".").map(Number) };
  });
}

const nativeBinaries = staged.filter((rel) => /\.(dll|node)$/i.test(rel));
const runtimeDirs = [...new Set(nativeBinaries.map((rel) => path.posix.dirname(rel)))].sort();
let msvcRuntime = null;
const redist = findVcRedist();
if (redist.problem) {
  fail(`MSVC runtime: ${redist.problem}. The staged native binaries import ${MSVC_RUNTIME.join(", ")}, which Windows does not ship; install Visual Studio 2022 (Build Tools or an edition whose license covers redistributing its Distributable Code) with "MSVC v143 - VS 2022 C++ x64/x86 build tools" and "C++ 2022 Redistributable Update" (awkit-i6ot).`);
} else {
  const sources = MSVC_RUNTIME.map((name) => path.join(redist.dir, name));
  const systemRoot = fs.realpathSync(process.env.SystemRoot ?? "C:\\Windows");
  const realInstall = fs.realpathSync(redist.install);
  for (const source of sources) {
    if (!fs.existsSync(source)) {
      fail(`MSVC runtime: ${source} is missing from the Visual Studio redist folder.`);
      continue;
    }
    const real = fs.realpathSync(source);
    if (!isInside(realInstall, real) || isInside(systemRoot, real)) fail(`MSVC runtime: ${source} resolves to ${real}, outside the Visual Studio installation.`);
    if (peHeader(source)?.machine !== 0x8664) fail(`MSVC runtime: ${source} is not an x64 image.`);
  }
  stop("(MSVC runtime source)");
  const newestLinker = nativeBinaries
    .map((rel) => peHeader(path.join(OUT_DIR, ...rel.split("/")))?.linker ?? [0, 0])
    .reduce((a, b) => (b[0] > a[0] || (b[0] === a[0] && b[1] > a[1]) ? b : a), [0, 0]);
  signaturesOf(sources).forEach((sig, i) => {
    if (sig.status !== "Valid" || !/(^|,\s*)O=Microsoft Corporation(,|$)/.test(sig.subject)) {
      fail(`MSVC runtime: ${MSVC_RUNTIME[i]} is not validly signed by Microsoft (${sig.status}, "${sig.subject}").`);
    }
    if (sig.version[0] < newestLinker[0] || (sig.version[0] === newestLinker[0] && sig.version[1] < newestLinker[1])) {
      fail(`MSVC runtime: ${MSVC_RUNTIME[i]} ${sig.version.join(".")} is older than linker ${newestLinker.join(".")} that built a staged binary; the runtime must be at least as new.`);
    }
  });
  for (const dir of runtimeDirs) {
    for (const [i, name] of MSVC_RUNTIME.entries()) {
      const rel = `${dir}/${name}`;
      if (staged.some((s) => s.toLowerCase() === rel.toLowerCase())) fail(`MSVC runtime: ${rel} is already staged by a package.`);
      else copyFile(sources[i], rel);
    }
  }
  msvcRuntime = { source: "Visual Studio redist (Microsoft.VC14x.CRT), app-local", redistVersion: redist.version, newestLinker: newestLinker.join("."), files: MSVC_RUNTIME, directories: runtimeDirs };
}
stop("staging the MSVC runtime");

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
  msvcRuntime,
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
console.log(`  MSVC runtime ${msvcRuntime.redistVersion} (app-local, Visual Studio redist) beside ${msvcRuntime.directories.length} native director${msvcRuntime.directories.length === 1 ? "y" : "ies"}`);
