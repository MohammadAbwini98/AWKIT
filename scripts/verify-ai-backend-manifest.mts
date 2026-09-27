/**
 * verify:ai-backend-manifest — Phase L, L8a.1: the release-owned GPU backend manifest (`awkit-djnl.11`).
 *
 *   A. The source and the pin: `src/offline/ai-backend-manifest.json` resolves to exactly the Vulkan entry
 *      for `AI_RUNTIME_PIN.build`, and `AI_RUNTIME_PIN.backends` is `cpu` plus every manifest backend. The
 *      structural check and the fail-closed resolver refuse each negative control.
 *   B. Measured, not guessed: the manifest equals the installed `@node-llama-cpp/win-x64-vulkan` prebuilt in
 *      both directions (the file set, with the staging script's exclusions) and file by file (size, SHA-256).
 *   C. The strict validator's new rules, black-box through `-RootPath` on scratch roots: a consistent root
 *      draws no backend error, and each broken one (signed copy absent, different or bundled; source build,
 *      path, duplicate or addon wrong; pin backend set wrong; a pinned binary shipped under another name)
 *      draws its own message.
 *   D. The committed `resources/dependency-manifest.json`: its Ed25519 signature verifies and its
 *      `aiGpuBackends` section equals the source.
 *
 * Exit, the `gateExitCode` convention: 1 on any failure, 2 when B or C's shipped-binary case cannot run
 * (no installed Vulkan prebuilt), 0 only when every section ran and passed.
 *
 * Run: npm run verify:ai-backend-manifest
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AI_BACKEND_MANIFEST, AI_RUNTIME_PIN, isValidAiBackendManifestEntry, resolveAiBackendManifest } from "../src/offline/AiModelManifest";
import { gateExitCode } from "./lib/failure-capture-gate.mts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCE = path.join(ROOT, "src", "offline", "ai-backend-manifest.json");
const PIN_SOURCE = path.join(ROOT, "src", "offline", "AiModelManifest.ts");
const SIGNED = path.join(ROOT, "resources", "dependency-manifest.json");
const VALIDATOR = path.join(ROOT, "scripts", "validate-offline-bundle.ps1");
const PACK_DIR = path.join(ROOT, "node_modules", "@node-llama-cpp", "win-x64-vulkan");
/** Same exclusions as scripts/prepare-ai-native-host.mjs: never needed to load or run the runtime. */
const EXCLUDED_FILE = [/\.d\.[cm]?ts$/i, /\.map$/i, /\.lib$/i, /^(readme|changelog|history)(\.[a-z]+)?$/i];
const PREFIX = "Local-AI GPU backend manifest:";

let passed = 0;
let failed = 0;
const notRun: string[] = [];
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function skip(label: string, reason: string): void {
  notRun.push(label);
  console.log(`  - NOT RUN: ${label} — ${reason}`);
}

const sha256 = (file: string): string => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

function listFiles(dir: string, base = dir, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") listFiles(full, base, out);
    } else if (entry.isFile()) {
      out.push(path.relative(base, full).split(path.sep).join("/"));
    }
  }
  return out;
}

/** The canonical form the validator compares, so this gate agrees with it on what "equal" means. */
function canonical(section: Json): string {
  const lines = [`runtimeBuild=${section.runtimeBuild}`];
  for (const backend of [...(section.backends ?? [])].sort((a: Json, b: Json) => String(a.id).localeCompare(String(b.id)))) {
    lines.push(`backend=${backend.id}|${backend.package}|${backend.packageVersion}`);
    for (const file of [...(backend.files ?? [])].sort((a: Json, b: Json) => String(a.path).localeCompare(String(b.path)))) {
      lines.push(`file=${backend.id}|${file.path}|${file.size}|${file.sha256}`);
    }
  }
  return lines.join("\n");
}

console.log("verify:ai-backend-manifest — L8a.1, the release-owned GPU backend manifest\n");

const source = JSON.parse(fs.readFileSync(SOURCE, "utf8")) as Json;
const vulkan = AI_BACKEND_MANIFEST.find((entry) => entry.id === "vulkan");

// ── A ──
console.log("A. The source and the pin");
check(
  `the source resolves to exactly one backend, vulkan, for ${AI_RUNTIME_PIN.build} (${vulkan?.files.length ?? 0} files)`,
  AI_BACKEND_MANIFEST.length === 1 && vulkan !== undefined && source.runtimeBuild === AI_RUNTIME_PIN.build && (source.backends ?? []).length === 1
);
check(
  `AI_RUNTIME_PIN.backends is cpu plus every manifest backend (${JSON.stringify(AI_RUNTIME_PIN.backends)})`,
  JSON.stringify([...AI_RUNTIME_PIN.backends].sort()) === JSON.stringify(["cpu", ...AI_BACKEND_MANIFEST.map((e) => e.id)].sort())
);
check("the resolved entry is frozen, so no caller can widen it", vulkan !== undefined && Object.isFrozen(vulkan) && Object.isFrozen(vulkan.files) && Object.isFrozen(vulkan.files[0]));

const base = clone(source.backends[0]) as Json;
const mutate = (fn: (e: Json) => void): Json => {
  const e = clone(base);
  fn(e);
  return e;
};
const file = (rel: string): Json => ({ path: rel, size: 10, sha256: "a".repeat(64) });
check("control — the source's own entry passes the structural check", isValidAiBackendManifestEntry(base, AI_RUNTIME_PIN.build));
const refusals: [string, Json | null][] = [
  ["a traversal path", mutate((e) => e.files.push(file("../evil.dll")))],
  ["a backslash path", mutate((e) => e.files.push(file("bins\\evil.dll")))],
  ["an absolute path", mutate((e) => e.files.push(file("/evil.dll")))],
  ["a drive-letter path", mutate((e) => e.files.push(file("C:/evil.dll")))],
  ["a model file", mutate((e) => e.files.push(file("bins/x.gguf")))],
  ["an uppercase hash", mutate((e) => (e.files[0].sha256 = e.files[0].sha256.toUpperCase()))],
  ["a 63-character hash", mutate((e) => (e.files[0].sha256 = e.files[0].sha256.slice(1)))],
  ["a zero size", mutate((e) => (e.files[0].size = 0))],
  ["a fractional size", mutate((e) => (e.files[0].size = 1.5))],
  ["a case-variant duplicate path", mutate((e) => e.files.push({ ...e.files[0], path: e.files[0].path.toUpperCase() }))],
  ["no addon", mutate((e) => (e.files = e.files.filter((f: Json) => !f.path.endsWith("llama-addon.node"))))],
  ["no files", mutate((e) => (e.files = []))],
  ["another package", mutate((e) => (e.package = "@node-llama-cpp/win-x64-cuda"))],
  ["another version", mutate((e) => (e.packageVersion = "3.21.0"))],
  ["an unknown backend", mutate((e) => (e.id = "cuda"))]
];
for (const [label, entry] of refusals) check(`the structural check refuses ${label}`, !isValidAiBackendManifestEntry(entry, AI_RUNTIME_PIN.build));
check("the structural check refuses any entry when the pin has no build", !isValidAiBackendManifestEntry(base, null));
const resolveCases: [string, Json, Readonly<{ build: string | null; backends: readonly string[] }>][] = [
  ["a source for another build", { ...clone(source), runtimeBuild: "node-llama-cpp@3.21.0+llama.cpp@v0.3.9" }, AI_RUNTIME_PIN],
  ["another schema version", { ...clone(source), schema: { name: "awkit-ai-backend-manifest", version: 2 } }, AI_RUNTIME_PIN],
  ["a backend listed twice", { ...clone(source), backends: [clone(base), clone(base)] }, AI_RUNTIME_PIN],
  ["a backend the pin does not list", clone(source), { build: AI_RUNTIME_PIN.build, backends: ["cpu"] }],
  ["an unpinned build", clone(source), { build: null, backends: ["cpu", "vulkan"] }]
];
check("control — the resolver admits the source under the real pin", resolveAiBackendManifest(clone(source), AI_RUNTIME_PIN).length === 1);
for (const [label, candidate, pin] of resolveCases) check(`the resolver admits nothing for ${label}`, resolveAiBackendManifest(candidate, pin).length === 0);

// ── B ──
console.log("\nB. The manifest against the installed prebuilt");
const packInstalled = fs.existsSync(path.join(PACK_DIR, "package.json"));
if (!packInstalled || !vulkan) {
  skip("B", `${vulkan ? "@node-llama-cpp/win-x64-vulkan is not installed" : "no vulkan entry"}; nothing to measure against`);
} else {
  const installed = listFiles(PACK_DIR).filter((rel) => !EXCLUDED_FILE.some((p) => p.test(path.posix.basename(rel))) && !path.posix.basename(rel).startsWith("."));
  const listed = vulkan.files.map((f) => f.path);
  const unlisted = installed.filter((rel) => !listed.includes(rel));
  const missing = listed.filter((rel) => !installed.includes(rel));
  check(`the installed runtime files and the manifest are the same set (${installed.length} installed, ${listed.length} pinned)`, installed.length > 0 && unlisted.length === 0 && missing.length === 0, `unlisted ${unlisted.join(", ")}; missing ${missing.join(", ")}`);
  const wrong = vulkan.files.filter((f) => fs.existsSync(path.join(PACK_DIR, f.path)) && (fs.statSync(path.join(PACK_DIR, f.path)).size !== f.size || sha256(path.join(PACK_DIR, f.path)) !== f.sha256));
  check(`every pinned file's size and SHA-256 equal the installed file's (${vulkan.files.length - wrong.length}/${vulkan.files.length})`, wrong.length === 0 && missing.length === 0, wrong.map((f) => f.path).join(", "));
}

// ── C ──
console.log("\nC. The strict validator's backend rules, on scratch roots (-RootPath)");

interface Scratch {
  /** Mutates the source manifest written to the scratch root; the signed copy follows it unless `signed` says otherwise. */
  source?: (s: Json) => void;
  /** The scratch signed copy: undefined = equal to the scratch source, null = absent, or a mutation of that copy. */
  signed?: null | ((s: Json) => void);
  pin?: (text: string) => string;
  /** Extra staged files, relative to build/native-hosts/ai, copied from real files. */
  staged?: Record<string, string>;
}

function validate(scratchRoot: string, name: string, spec: Scratch): string {
  const root = path.join(scratchRoot, name);
  const staged = path.join(root, "build", "native-hosts", "ai");
  fs.mkdirSync(path.join(root, "resources"), { recursive: true });
  fs.mkdirSync(path.join(root, "src", "offline"), { recursive: true });
  fs.mkdirSync(staged, { recursive: true });
  fs.copyFileSync(path.join(ROOT, "resources", "offline-browser-policy.json"), path.join(root, "resources", "offline-browser-policy.json"));
  fs.copyFileSync(path.join(ROOT, "package.json"), path.join(root, "package.json"));
  const pinText = fs.readFileSync(PIN_SOURCE, "utf8");
  fs.writeFileSync(path.join(root, "src", "offline", "AiModelManifest.ts"), spec.pin ? spec.pin(pinText) : pinText);
  const scratchSource = clone(source);
  spec.source?.(scratchSource);
  fs.writeFileSync(path.join(root, "src", "offline", "ai-backend-manifest.json"), JSON.stringify(scratchSource, null, 2));

  fs.writeFileSync(path.join(staged, "ai-native-host-manifest.json"), "{}\n");
  const files: Record<string, string | null> = { "ai-host.cjs": null, ...(spec.staged ?? {}) };
  for (const [rel, from] of Object.entries(files)) {
    const to = path.join(staged, ...rel.split("/"));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (from) fs.copyFileSync(from, to);
    else fs.writeFileSync(to, `content of ${rel}\n`);
  }
  const npm = /^node-llama-cpp@(\d+\.\d+\.\d+)\+/.exec(AI_RUNTIME_PIN.build ?? "")?.[1];
  const aiRuntime = {
    enabled: true,
    requiredForAppStartup: false,
    modelPackBundled: false,
    gpu: false,
    platform: "win32",
    arch: "x64",
    runtimeBuild: AI_RUNTIME_PIN.build,
    runtimeVersion: npm,
    assets: Object.keys(files).map((rel) => {
      const abs = path.join(staged, ...rel.split("/"));
      return { relativePath: `native-hosts/ai/${rel}`, size: fs.statSync(abs).size, sha256: sha256(abs) };
    })
  };
  // The real manifest with aiRuntime and aiGpuBackends replaced. Its signature no longer verifies, which the
  // validator reports and moves past; every rule under test is checked after that.
  const manifest = JSON.parse(fs.readFileSync(SIGNED, "utf8")) as Json;
  delete manifest.aiGpuBackends;
  if (spec.signed !== null) {
    const signed: Json = { bundled: false, source: "src/offline/ai-backend-manifest.json", runtimeBuild: scratchSource.runtimeBuild, backends: clone(scratchSource.backends) };
    if (typeof spec.signed === "function") spec.signed(signed);
    manifest.aiGpuBackends = signed;
  }
  fs.writeFileSync(path.join(root, "resources", "dependency-manifest.json"), JSON.stringify({ ...manifest, aiRuntime }, null, 2));
  const run = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", VALIDATOR, "-RootPath", root], { encoding: "utf8", timeout: 180_000, windowsHide: true });
  return `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
}

/** The validator's backend lines, or its last lines when it never reached the backend section. */
function detail(output: string): string {
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const relevant = lines.filter((l) => l.includes(PREFIX));
  return (relevant.length > 0 ? relevant.join(" | ") : `no backend line; the validator ended with: ${lines.slice(-4).join(" | ")}`).slice(0, 600);
}
const backendProblem = (output: string): boolean => output.split(/\r?\n/).some((l) => /^(ERROR|WARNING):/.test(l.trim()) && l.includes(PREFIX));

const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-backend-manifest-"));
try {
  const addon = (s: Json): Json => s.backends[0].files.find((f: Json) => String(f.path).endsWith("llama-addon.node"));
  const pinnedLine = /^(\s*)backends: Object\.freeze\(\["cpu", "vulkan"\] as const\)/m;
  const control = validate(scratchRoot, "control", {});
  check(
    "control — a consistent root draws no backend problem, matches the signed copy and finds no pinned binary shipped",
    !backendProblem(control) && /1 backend\(s\), \d+ files pinned for .*; the signed copy matches the source\./.test(control) && /none of its [1-9]\d* pinned binaries is among the 1 shipped local-AI files/.test(control),
    detail(control)
  );
  const cases: [string, Scratch, RegExp][] = [
    ["a signed manifest without aiGpuBackends is reported (a strict release FAILS)", { signed: null }, /has no aiGpuBackends section/],
    ["a signed copy that differs by one hash is refused", { signed: (s) => (s.backends[0].files[0].sha256 = "0".repeat(64)) }, /the signed aiGpuBackends differs from src\/offline\/ai-backend-manifest\.json/],
    ["a signed copy declaring bundled is refused", { signed: (s) => (s.bundled = true) }, /must declare bundled=false/],
    ["a source for another runtime build is refused", { source: (s) => (s.runtimeBuild = "node-llama-cpp@3.21.1+llama.cpp@v0.3.9") }, /runtimeBuild 'node-llama-cpp@3\.21\.1\+llama\.cpp@v0\.3\.9' is not AI_RUNTIME_PIN\.build/],
    ["a source with a traversal path is refused", { source: (s) => s.backends[0].files.push({ path: "../evil.dll", size: 1, sha256: "b".repeat(64) }) }, /pins an unsafe path: '\.\.\/evil\.dll'/],
    ["a source with a case-variant duplicate is refused", { source: (s) => s.backends[0].files.push({ ...addon(s), path: String(addon(s).path).toUpperCase() }) }, /pins a path more than once/],
    ["a source without the addon is refused", { source: (s) => (s.backends[0].files = s.backends[0].files.filter((f: Json) => f !== addon(s))) }, /does not pin its addon bins\/win-x64-vulkan\/llama-addon\.node/],
    ["a pin whose backend set omits vulkan is refused", { pin: (t) => t.replace(pinnedLine, '$1backends: Object.freeze(["cpu"] as const)') }, /AI_RUNTIME_PIN\.backends \[cpu\] is not cpu plus the manifest's backends \[cpu, vulkan\]/]
  ];
  cases.forEach(([label, spec, expected], index) => {
    const output = validate(scratchRoot, `case-${index}`, spec);
    check(label, expected.test(output), detail(output));
  });
  const pinned = vulkan?.files.find((f) => f.path.endsWith("ggml.vulkan.v0.4.0.dll"));
  if (!packInstalled || !pinned) {
    skip("the shipped-binary case", "no installed Vulkan prebuilt to take a pinned binary from");
  } else {
    const output = validate(scratchRoot, "shipped", { staged: { "node_modules/x/renamed.dll": path.join(PACK_DIR, pinned.path) } });
    check("a pinned GPU binary shipped under another name is refused by its hash", /ships 1 pinned GPU backend binary\(ies\), which may only ever be user-supplied: native-hosts\/ai\/node_modules\/x\/renamed\.dll/.test(output), detail(output));
  }
} finally {
  fs.rmSync(scratchRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

// ── D ──
console.log("\nD. The committed signed dependency manifest");
const signature = spawnSync(process.execPath, [path.join(ROOT, "scripts", "offline-manifest-signature.mjs"), "verify"], { encoding: "utf8", timeout: 60_000, windowsHide: true });
check("resources/dependency-manifest.json verifies against its Ed25519 signature", signature.status === 0, `${signature.stdout ?? ""}${signature.stderr ?? ""}`.trim().slice(0, 300));
const committed = JSON.parse(fs.readFileSync(SIGNED, "utf8")) as Json;
check(
  "its aiGpuBackends is declared unbundled and equals the source",
  committed.aiGpuBackends?.bundled === false && canonical(committed.aiGpuBackends ?? {}) === canonical(source),
  committed.aiGpuBackends ? "differs from src/offline/ai-backend-manifest.json" : "no aiGpuBackends section: regenerate with npm run package:portable"
);

const exitCode = gateExitCode({ passed, failed, inconclusive: 0, gateNotRun: notRun.length > 0 });
console.log(`\n${passed} passed, ${failed} failed${notRun.length > 0 ? `, NOT RUN: ${notRun.join("; ")}` : ""} — ${exitCode === 0 ? "PASS" : exitCode === 1 ? "FAIL" : "NOT RUN, which is never a pass"}`);
process.exit(exitCode);
