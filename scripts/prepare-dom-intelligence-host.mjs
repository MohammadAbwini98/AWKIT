/**
 * Stages the parser-only DOM-intelligence runtime for packaging (L11, awkit-djnl.19, plan E5).
 *
 * Output goes to build/native-hosts/dom-intelligence/ (or `--out <dir>` outside the repository) and is
 * shipped verbatim by electron-builder `extraResources` as resources/native-hosts/dom-intelligence:
 *
 *   python/          the python.org embeddable CPython, trimmed: no network, TLS, FFI, async or other
 *                    unneeded extension modules, and a stdlib archive without network, process, mail or UI
 *                    packages; a `python312._pth` that pins sys.path to this tree and never imports `site`
 *   site-packages/   the six pinned parser-only wheels, extracted; Scrapling's fetchers, spiders, engines,
 *                    integrations, AI, shell and CLI code stripped; no `tld`
 *   host/            native-hosts/dom-intelligence/dom_intelligence_host.py, byte-identical
 *   dom-intelligence-host-manifest.json   every staged file with its size and SHA-256
 *
 * Inputs come ONLY from `.cache/dom-intelligence/` (npm run benchmark:dom-intelligence-runtime-setup) and
 * each must match src/offline/dom-intelligence-runtime.json; this script never downloads anything. It
 * fails loudly rather than staging a partial tree, and it smoke-tests the staged host (hello must report
 * the parser-only protocol with network and browser access refused) before writing the manifest.
 */

import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PIN_PATH = path.join(ROOT, "src", "offline", "dom-intelligence-runtime.json");
const HOST_SOURCE = path.join(ROOT, "native-hosts", "dom-intelligence", "dom_intelligence_host.py");
const INPUT_ROOT = path.join(ROOT, ".cache", "dom-intelligence");
const DEFAULT_OUT = path.join(ROOT, "build", "native-hosts", "dom-intelligence");
const MANIFEST_NAME = "dom-intelligence-host-manifest.json";
const SEVEN_ZIP = path.join(ROOT, "node_modules", "7zip-bin", "win", "x64", "7za.exe");

const failures = [];
const fail = (message) => failures.push(message);
/** The work directory, removed on every exit path (success, failure or stop). */
let WORK;
function stop(stage) {
  if (failures.length === 0) return;
  console.error(`prepare-dom-intelligence-host FAILED${stage ? ` ${stage}` : ""}:`);
  for (const f of failures) console.error(`  - ${f}`);
  if (WORK) fs.rmSync(WORK, { recursive: true, force: true });
  process.exit(1);
}

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const posix = (p) => p.split(path.sep).join("/");
const isInside = (base, candidate) => {
  const rel = path.relative(base, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

// ── Output boundary (same rules as the AI and Zvec staging scripts) ─────────────────────────────────

const outFlag = process.argv.indexOf("--out");
const OUT_DIR = outFlag >= 0 ? path.resolve(process.argv[outFlag + 1] ?? "") : DEFAULT_OUT;
const insideRoot = isInside(ROOT, OUT_DIR);
if (OUT_DIR !== DEFAULT_OUT && insideRoot) fail(`--out must be the default build/native-hosts/dom-intelligence or a directory outside the repository (got ${OUT_DIR}).`);
if (fs.existsSync(OUT_DIR) && fs.readdirSync(OUT_DIR).length > 0 && !fs.existsSync(path.join(OUT_DIR, MANIFEST_NAME))) {
  fail(`Refusing to replace ${OUT_DIR}: it is not empty and holds no ${MANIFEST_NAME}.`);
}
if (process.platform !== "win32" || process.arch !== "x64") fail(`Staging must run on win32-x64 (got ${process.platform}-${process.arch}).`);
if (!fs.existsSync(SEVEN_ZIP)) fail("node_modules/7zip-bin is not installed (the pinned devDependency extracts the archives).");
if (!fs.existsSync(HOST_SOURCE)) fail("Missing host source native-hosts/dom-intelligence/dom_intelligence_host.py.");
stop("(preconditions)");

// ── Inputs, each against the pin ────────────────────────────────────────────────────────────────────

const PIN = JSON.parse(fs.readFileSync(PIN_PATH, "utf8"));
if (PIN.schema?.name !== "awkit-dom-intelligence-runtime-pin" || PIN.schema?.version !== 1) fail("src/offline/dom-intelligence-runtime.json is not a version-1 runtime pin.");
const hostProtocol = /^PROTOCOL_VERSION = (\d+)$/m.exec(fs.readFileSync(HOST_SOURCE, "utf8"));
const hostScrapling = /^EXPECTED_SCRAPLING = "([^"]+)"$/m.exec(fs.readFileSync(HOST_SOURCE, "utf8"));
if (!hostProtocol || Number(hostProtocol[1]) !== PIN.hostProtocolVersion) fail("The host's PROTOCOL_VERSION does not equal the pin's hostProtocolVersion.");
if (!hostScrapling || hostScrapling[1] !== PIN.scrapling) fail("The host's EXPECTED_SCRAPLING does not equal the pin's scrapling release.");
const archive = path.join(INPUT_ROOT, PIN.python.archive);
if (!fs.existsSync(archive)) fail(`${PIN.python.archive} is missing: run npm run benchmark:dom-intelligence-runtime-setup.`);
else if (sha256(archive) !== PIN.python.sha256) fail(`${PIN.python.archive} does not match the pinned SHA-256.`);
for (const wheel of PIN.wheels) {
  const file = path.join(INPUT_ROOT, "wheels", wheel.file);
  if (!fs.existsSync(file)) fail(`${wheel.file} is missing: run npm run benchmark:dom-intelligence-runtime-setup.`);
  else if (sha256(file) !== wheel.sha256) fail(`${wheel.file} does not match the pinned SHA-256.`);
}
if (PIN.wheels.some((wheel) => /^tld-/i.test(wheel.file))) fail("The pin lists tld, which is excluded by design.");
stop("(pinned inputs)");

// ── Stage into a work directory first; the output is replaced only after every check passed ─────────

WORK = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-dom-intelligence-stage-"));
const STAGE = path.join(WORK, "stage");
const extract = (zip, to) => {
  fs.mkdirSync(to, { recursive: true });
  const run = spawnSync(SEVEN_ZIP, ["x", "-y", "-bso0", "-bsp0", `-o${to}`, zip], { encoding: "utf8", windowsHide: true });
  if (run.status !== 0) fail(`7za could not extract ${path.basename(zip)}: ${(run.stderr || run.stdout || "").trim().slice(0, 300)}`);
};
const remove = (target) => fs.rmSync(target, { recursive: true, force: true });

try {
  // Runtime.
  const pythonDir = path.join(STAGE, "python");
  extract(archive, pythonDir);
  stop("(runtime extraction)");
  const removedRuntime = [];
  for (const name of PIN.removedRuntimeFiles) {
    const file = path.join(pythonDir, name);
    if (fs.existsSync(file)) {
      remove(file);
      removedRuntime.push(name);
    }
  }
  for (const name of fs.readdirSync(pythonDir)) if (name.endsWith("._pth")) remove(path.join(pythonDir, name));

  // Stdlib archive: extract, drop the pinned packages and modules, re-archive.
  const stdlibZip = path.join(pythonDir, "python312.zip");
  if (!fs.existsSync(stdlibZip)) fail("The embeddable archive has no python312.zip.");
  stop("(runtime layout)");
  const stdlibDir = path.join(WORK, "stdlib");
  extract(stdlibZip, stdlibDir);
  stop("(stdlib extraction)");
  const removedStdlib = [];
  for (const name of PIN.removedStdlibTopLevel) {
    for (const candidate of [name, `${name}.pyc`]) {
      const target = path.join(stdlibDir, candidate);
      if (fs.existsSync(target)) {
        remove(target);
        removedStdlib.push(candidate);
      }
    }
  }
  for (const name of PIN.removedStdlibModules) {
    for (const candidate of [name, `${name}.pyc`]) {
      const target = path.join(stdlibDir, ...candidate.split("/"));
      if (fs.existsSync(target)) {
        remove(target);
        removedStdlib.push(candidate);
      }
    }
  }
  remove(stdlibZip);
  const zip = spawnSync(SEVEN_ZIP, ["a", "-tzip", "-mx=9", "-bso0", "-bsp0", stdlibZip, ".\\*"], { cwd: stdlibDir, encoding: "utf8", windowsHide: true });
  if (zip.status !== 0) fail(`7za could not rebuild python312.zip: ${(zip.stderr || zip.stdout || "").trim().slice(0, 300)}`);
  // sys.path is exactly this tree; `site` is never imported, so no user or environment path can join it.
  fs.writeFileSync(path.join(pythonDir, "python312._pth"), ["python312.zip", ".", "..\\site-packages", "..\\host", ""].join("\r\n"), "ascii");
  stop("(stdlib archive)");

  // Parser-only site-packages.
  const sitePackages = path.join(STAGE, "site-packages");
  for (const wheel of PIN.wheels) extract(path.join(INPUT_ROOT, "wheels", wheel.file), sitePackages);
  stop("(wheel extraction)");
  const stripped = [];
  for (const rel of PIN.strippedScraplingPaths) {
    const target = path.join(sitePackages, ...rel.split("/"));
    if (fs.existsSync(target)) {
      remove(target);
      stripped.push(rel);
    }
  }
  // Build inputs never ship: C headers and Cython sources. Wheel-provided bytecode caches are dropped
  // (the tree is compiled below, once, with a known invalidation mode).
  const walk = (dir, visit) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) fail(`Refusing to stage a link: ${posix(path.relative(STAGE, full))}`);
      else if (entry.isDirectory()) {
        if (visit(full, true) !== false) walk(full, visit);
      } else visit(full, false);
    }
  };
  walk(sitePackages, (full, isDir) => {
    const name = path.basename(full);
    if (isDir && (name === "__pycache__" || (name === "includes" && path.basename(path.dirname(full)) === "lxml"))) {
      remove(full);
      return false;
    }
    if (!isDir && /\.(pyx|pxd|pxi|h|c|pyi)$/i.test(name)) remove(full);
    return true;
  });
  if (fs.readdirSync(sitePackages).some((name) => /^tld([-_.]|$)/i.test(name))) fail("tld reached site-packages.");
  for (const rel of PIN.strippedScraplingPaths) {
    if (fs.existsSync(path.join(sitePackages, ...rel.split("/")))) fail(`${rel} survived stripping.`);
  }

  // Host.
  fs.mkdirSync(path.join(STAGE, "host"), { recursive: true });
  fs.copyFileSync(HOST_SOURCE, path.join(STAGE, "host", "dom_intelligence_host.py"));
  stop("(site-packages)");

  // Bytecode is compiled HERE, at staging time, with unchecked-hash headers: the runtime (-B) never writes
  // a cache, and an unchecked-hash .pyc is used without comparing source mtimes, which packaging and
  // extraction rewrite. Without it every start recompiles the parser (measured ~1.7 s cold).
  const python = path.join(pythonDir, "python.exe");
  const compile = spawnSync(python, ["-I", "-s", "-E", "-X", "utf8", "-m", "compileall", "-q", "--invalidation-mode", "unchecked-hash", sitePackages], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 180_000,
    env: { SystemRoot: process.env.SystemRoot ?? "C:\\Windows" }
  });
  if (compile.status !== 0) fail(`compileall failed: ${(compile.stderr || compile.stdout || "").trim().slice(-400)}`);
  stop("(bytecode)");

  // Smoke test the staged host exactly as the product launches it.
  const hello = await new Promise((resolve) => {
    const child = spawn(python, ["-I", "-B", "-s", "-E", "-X", "utf8", path.join(STAGE, "host", "dom_intelligence_host.py")], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { SystemRoot: process.env.SystemRoot ?? "C:\\Windows", PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" }
    });
    let out = "";
    let err = "";
    let answer;
    // Resolve only once the process has EXITED: a running python.exe keeps its image locked, and the
    // staged tree is copied and the work directory removed right after this.
    const timer = setTimeout(() => {
      answer ??= { error: `no hello within 20 s (${err.trim().slice(-300)})` };
      child.kill();
    }, 20_000);
    child.stdout.on("data", (chunk) => {
      out += chunk;
      if (answer === undefined && out.includes("\n")) {
        try {
          answer = JSON.parse(out.split("\n")[0]);
        } catch {
          answer = { error: `unparseable hello: ${out.slice(0, 200)}` };
        }
        child.stdin.end(`${JSON.stringify({ id: 2, op: "shutdown" })}\n`);
      }
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    child.on("error", (error) => {
      answer ??= { error: String(error) };
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(answer ?? { error: `the host exited ${code} before hello (${err.trim().slice(-300)})` });
    });
    child.stdin.write(`${JSON.stringify({ id: 1, op: "hello", protocol: PIN.hostProtocolVersion })}\n`);
  });
  const result = hello?.result;
  if (hello?.error || hello?.ok !== true) fail(`The staged host did not answer hello: ${hello?.error ?? JSON.stringify(hello?.error ?? hello).slice(0, 300)}`);
  else {
    if (result.mode !== "parser-only" || result.protocol !== PIN.hostProtocolVersion) fail("The staged host is not the pinned parser-only protocol.");
    if (result.python !== PIN.python.version) fail(`The staged host runs CPython ${result.python}, not ${PIN.python.version}.`);
    if (result.scrapling !== PIN.scrapling) fail(`The staged host loads Scrapling ${result.scrapling}, not ${PIN.scrapling}.`);
    if (result.network !== false || result.browser !== false) fail("The staged host reports network or browser access.");
    if (result.forbiddenModulesLoaded?.length) fail(`The staged host loaded forbidden modules: ${result.forbiddenModulesLoaded.join(", ")}`);
  }
  stop("(staged host smoke test)");

  // Manifest over the staged tree, then replace the output.
  const assets = [];
  walk(STAGE, (full, isDir) => {
    if (!isDir) assets.push({ relativePath: posix(path.relative(STAGE, full)), size: fs.statSync(full).size, sha256: sha256(full) });
    return true;
  });
  stop("(manifest)");
  assets.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const manifest = {
    schema: { name: "awkit-dom-intelligence-host-manifest", version: 1 },
    enabled: true,
    // Optional capability: a missing or broken runtime disables DOM intelligence and changes nothing else.
    requiredForAppStartup: false,
    hostProtocolVersion: PIN.hostProtocolVersion,
    hostEntry: "host/dom_intelligence_host.py",
    pythonEntry: "python/python.exe",
    python: PIN.python.version,
    pythonArchiveSha256: PIN.python.sha256,
    scrapling: PIN.scrapling,
    lxml: result.lxml,
    wheels: PIN.wheels.map((wheel) => ({ file: wheel.file, sha256: wheel.sha256, license: wheel.license })),
    excludedPackages: PIN.excludedPackages.map((entry) => entry.name),
    strippedScraplingPaths: stripped,
    removedRuntimeFiles: removedRuntime,
    removedStdlib,
    platform: "win32",
    arch: "x64",
    fileCount: assets.length,
    totalBytes: assets.reduce((sum, a) => sum + a.size, 0),
    builtAt: new Date().toISOString(),
    assets
  };
  fs.writeFileSync(path.join(STAGE, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  remove(OUT_DIR);
  fs.mkdirSync(path.dirname(OUT_DIR), { recursive: true });
  fs.cpSync(STAGE, OUT_DIR, { recursive: true });
  console.log(`Staged DOM-intelligence host -> ${insideRoot ? posix(path.relative(ROOT, OUT_DIR)) : OUT_DIR}`);
  console.log(`  CPython ${PIN.python.version} (embeddable, trimmed), Scrapling ${PIN.scrapling} parser-only, lxml ${result.lxml}`);
  console.log(`  ${assets.length} files, ${(manifest.totalBytes / 1024 / 1024).toFixed(1)} MB; removed ${removedRuntime.length} runtime files, ${removedStdlib.length} stdlib entries, ${stripped.length} Scrapling paths`);
} finally {
  remove(WORK);
}
