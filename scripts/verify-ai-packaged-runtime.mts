/**
 * verify:ai-packaged-runtime — the pinned local-AI runtime exactly as the installer carries it
 * (Phase L, L7 › Packaging: "Installer carries the pinned runtime and integration only").
 *
 * `node-llama-cpp` is a dev dependency, so nothing of it reaches `app.asar`. The host resolves it from
 * its own `node_modules` beside `ai-host.cjs`, which `scripts/prepare-ai-native-host.mjs` stages and
 * electron-builder ships as `resources/native-hosts/ai`. This gate proves that tree is complete and
 * self-sufficient, not merely present:
 *
 *   A0. The staging script's refusals, black-box: a byte-identical copy runs in a scratch repository and
 *       must refuse a runtime pin that is ambiguous, unpinned, malformed or in conflict with package.json,
 *       and a node_modules, runtime package or --out reached through a link or resolving outside the
 *       repository. A control with the real pin draws none of those refusals.
 *   A1. The strict validator's rules, black-box: `validate-offline-bundle.ps1 -RootPath` on scratch roots
 *       must refuse the same pin defects, and must compare the staged inventory to the signed list by
 *       path, so a duplicate or case-variant entry can no longer keep the counts equal over an unlisted file.
 *   A. Staging into a temp directory OUTSIDE the repository, so Node's module lookup can never climb
 *      into the repository's `node_modules` and pass on a runtime the installer does not carry. Every
 *      file is listed in the staged manifest with its size and SHA-256 and every listed file is on
 *      disk; the host and the native addon are byte-identical to their sources; only the CPU prebuilt
 *      is staged; every declared runtime dependency resolves inside the staged tree. Every staged
 *      package's license is one reviewed for redistribution, its license text ships or the notices
 *      reproduce it, and `resources/THIRD_PARTY_NOTICES.md` lists exactly the staged packages.
 *   B. The staged runtime loads (`getLlama`, CPU, never build, never download) from that isolated copy,
 *      and two negative controls prove the probe cannot fall back to anything else: without the CPU
 *      prebuilt, and without one JavaScript dependency, it must fail.
 *   C. The production `AiUtilityHostManager` handshakes with the staged host in a real Electron utility
 *      process and the host reports the pinned build.
 *   D. With the pinned Qwen3.5-0.8B pack in ~/Downloads: the live harness (constrained decoding,
 *      cancellation, crash recovery, shutdown) runs on the staged copy. NOT RUN without the pack.
 *   E. `dist/win-unpacked`, the real packaged artifact: no model file anywhere in it, `app.asar`
 *      included (three controls first prove the scan catches a renamed pack, a `.gguf` and a pack inside
 *      an asar); the AI tree present, intact against its own manifest, the shipped notices listing its
 *      packages, identical to the current source's staging, and B/C on an isolated copy of it. A package
 *      without the runtime, or whose runtime is not the current staging, is STALE and FAILS.
 *   F. Neither packaged AI gate reports success for a gate that did not run: verify:ai-packaged-app with no
 *      model pack, and this gate's own exit path through a self-probe, must both exit 2.
 *   The PE-import check in A and E asks whether every DLL the staged binaries import is staged or ships
 *   with Windows, which is what "self-sufficient" means on a machine with nothing else installed. The
 *   Visual C++ runtime is staged app-local from the Visual Studio redist folder (awkit-i6ot): A proves
 *   the staging refuses without it, and that the manifest and notices record it.
 *   `verify:native-dependencies` covers the whole packaged artifact and lets the loader decide.
 *
 * Exit, the `gateExitCode` convention: 1 on any failure, 2 when a required section did not run (no
 * packaged artifact, no model pack), 0 only when every section ran and passed. NOT RUN is never a pass.
 *
 * Run: npm run verify:ai-packaged-runtime
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { deriveInferenceThreads } from "../src/ai/AiAdmission";
import { AI_MODEL_MANIFEST, AI_RUNTIME_PIN } from "../src/offline/AiModelManifest";
import { HOST_PATH, ROOT, buildAiHarness, measurePack, printSteps, runAiHarness, stageModelRoot } from "./ai-harness/launch.mts";
import { scanForModelFiles } from "./helpers/model-pack-scan.mts";
import { peImports } from "./helpers/pe-image.mts";
import { gateExitCode } from "./lib/failure-capture-gate.mts";

const MANIFEST_NAME = "ai-native-host-manifest.json";
const ADDON = "node_modules/@node-llama-cpp/win-x64/bins/win-x64/llama-addon.node";
const PACK_NAME = "Qwen3.5-0.8B-Q4_K_M.gguf";
/** A dependency `node-llama-cpp`'s entry imports at load time; removing it must break the probe. */
const CONTROL_DEPENDENCY = "lifecycle-utils";
const STAGING_SCRIPT = path.join(ROOT, "scripts", "prepare-ai-native-host.mjs");
const PIN_SOURCE = path.join(ROOT, "src", "offline", "AiModelManifest.ts");
const NOTICES = path.join(ROOT, "resources", "THIRD_PARTY_NOTICES.md");
const INVENTORY_HEADING = "### Staged runtime packages";
const REPRODUCED_HEADING = "### License texts reproduced here";
/**
 * The license identifiers `resources/THIRD_PARTY_NOTICES.md` › "Redistribution review" covers. Anything
 * else, a new copyleft or unknown license included, fails until someone reviews it and extends both.
 */
const REVIEWED_LICENSES = new Set(["MIT", "ISC", "BlueOak-1.0.0", "BSD-2-Clause", "Apache-2.0"]);
/** Code compiled into the staged prebuilt binaries whose own notice no staged file carries. */
const EMBEDDED_NOTICES = ["llama.cpp"];
/** The Visual C++ runtime the staging copies app-local from the Visual Studio redist folder (awkit-i6ot). */
const MSVC_RUNTIME = ["msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll"];
const LICENSE_TEXT = /^(licen[cs]e|copying|notice)(?![a-z])/i;

const asarModule = createRequire(import.meta.url)("@electron/asar") as { createPackage(src: string, dest: string): Promise<unknown> };

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
/** The only exit path, so section F's self-probe exercises exactly what a real run exits with. */
function finish(): never {
  const exitCode = gateExitCode({ passed, failed, inconclusive: 0, gateNotRun: notRun.length > 0 });
  const verdict = exitCode === 0 ? "PASS" : exitCode === 1 ? "FAIL" : "NOT RUN — a required section did not run, which is never a pass";
  console.log(`\n${passed} passed, ${failed} failed${notRun.length > 0 ? `, NOT RUN: ${notRun.join("; ")}` : ""} — ${verdict}`);
  process.exit(exitCode);
}

const sha256 = (file: string): string => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const posix = (p: string): string => p.split(path.sep).join("/");

function listFiles(dir: string, base = dir, out: { rel: string; symlink: boolean }[] = []): { rel: string; symlink: boolean }[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) out.push({ rel: posix(path.relative(base, full)), symlink: true });
    else if (entry.isDirectory()) listFiles(full, base, out);
    else if (entry.isFile()) out.push({ rel: posix(path.relative(base, full)), symlink: false });
  }
  return out;
}

interface StagedManifest {
  schema?: { name?: string; version?: number };
  runtimeBuild?: string;
  gpu?: boolean;
  platform?: string;
  arch?: string;
  hostEntry?: string;
  assets?: { relativePath: string; size: number; sha256: string }[];
}

function readManifest(dir: string): StagedManifest | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_NAME), "utf8")) as StagedManifest;
  } catch {
    return null;
  }
}

/** Node's lookup order for `name` from a package directory, confined to `root`. */
function lookupWithin(root: string, fromDir: string, name: string): string | null {
  let dir = fromDir;
  for (;;) {
    if (path.basename(dir) !== "node_modules") {
      const candidate = path.join(dir, "node_modules", ...name.split("/"));
      if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    }
    if (path.resolve(dir) === path.resolve(root)) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Package roots: `…/node_modules/<name>` or `…/node_modules/@scope/<name>` holding a package.json. */
function packageDirs(root: string, files: string[]): string[] {
  return files
    .filter((rel) => /(^|\/)node_modules\/(@[^/]+\/)?[^/@][^/]*\/package\.json$/.test(rel))
    .map((rel) => path.join(root, path.dirname(rel)));
}

// ── License inventory (the notices table's own row form) ────────────────────────────────────────────

interface PackageJsonLicense {
  name?: string;
  version?: string;
  license?: string | { type?: string };
  licenses?: (string | { type?: string })[];
}

function declaredLicense(pkg: PackageJsonLicense): string {
  if (typeof pkg.license === "string") return pkg.license.trim();
  if (typeof pkg.license?.type === "string") return pkg.license.type.trim();
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => (typeof l === "string" ? l : l?.type ?? "")).filter(Boolean).join(" OR ");
  return "";
}

/** `(MIT OR CC0-1.0)` → MIT, CC0-1.0. An empty declaration yields one empty identifier, never none. */
const licenseIds = (expression: string): string[] =>
  expression.split(/\s+(?:OR|AND|WITH)\s+|[()]/).map((id) => id.trim()).filter((id, index, all) => id.length > 0 || all.length === 1);

interface InventoryRow {
  row: string;
  key: string;
  license: string;
  reproduced: boolean;
}

function inventory(dir: string, listed: string[]): InventoryRow[] {
  const rows = new Map<string, InventoryRow>();
  for (const pkgDir of packageDirs(dir, listed)) {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")) as PackageJsonLicense;
    const texts = fs.readdirSync(pkgDir, { withFileTypes: true }).filter((e) => e.isFile() && LICENSE_TEXT.test(e.name)).map((e) => e.name).sort();
    const license = declaredLicense(pkg);
    const row = `| \`${pkg.name}\` | ${pkg.version} | ${license || "NONE"} | ${texts.length > 0 ? texts.map((t) => `\`${t}\``).join(", ") : "reproduced below"} |`;
    rows.set(row, { row, key: `${pkg.name}@${pkg.version}`, license, reproduced: texts.length === 0 });
  }
  return [...rows.values()].sort((a, b) => a.row.localeCompare(b.row));
}

/** The rows under the inventory heading, and the `#### \`name@version\`` headings of reproduced texts. */
function readNotices(file: string): { rows: string[]; reproduced: Set<string> } | null {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const section = (heading: string): string => {
    const start = text.indexOf(`\n${heading}\n`);
    if (start < 0) return "";
    const rest = text.slice(start + heading.length + 2);
    const end = rest.search(/^#{1,3} /m);
    return end < 0 ? rest : rest.slice(0, end);
  };
  const rows = section(INVENTORY_HEADING).split("\n").filter((line) => line.startsWith("| `")).map((line) => line.trim());
  const reproduced = new Set([...section(REPRODUCED_HEADING).matchAll(/^#### `([^`]+)`$/gm)].map((m) => m[1]));
  return { rows, reproduced };
}

function assertLicenses(dir: string, label: string, listed: string[], noticesFile: string): void {
  const rows = inventory(dir, listed);
  const unreviewed = rows.filter((r) => licenseIds(r.license).some((id) => !REVIEWED_LICENSES.has(id)));
  check(
    `${label}: every staged package declares a license reviewed for redistribution (${rows.length} distinct packages)`,
    rows.length > 0 && unreviewed.length === 0,
    unreviewed.length > 0 ? unreviewed.slice(0, 5).map((r) => `${r.key} "${r.license || "none declared"}"`).join("; ") : "no package was read"
  );
  const notices = readNotices(noticesFile);
  if (!notices) {
    check(`${label}: the third-party notices are present (${posix(path.relative(ROOT, noticesFile))})`, false);
    return;
  }
  const missingText = [...rows.filter((r) => r.reproduced).map((r) => r.key), ...EMBEDDED_NOTICES].filter((key) => !notices.reproduced.has(key));
  check(
    `${label}: every package that ships no license text, and ${EMBEDDED_NOTICES.join(", ")} inside the prebuilt binaries, is reproduced in the notices (${rows.filter((r) => r.reproduced).length + EMBEDDED_NOTICES.length} such)`,
    missingText.length === 0,
    missingText.join(", ")
  );
  const listedRows = new Set(notices.rows);
  const expected = new Set(rows.map((r) => r.row));
  const missing = rows.map((r) => r.row).filter((row) => !listedRows.has(row));
  const extra = notices.rows.filter((row) => !expected.has(row));
  check(
    `${label}: the notices inventory lists exactly the staged packages (${expected.size} expected, ${notices.rows.length} listed)`,
    expected.size > 0 && missing.length === 0 && extra.length === 0 && notices.rows.length === expected.size,
    `${missing.length} missing, ${extra.length} not staged${extra.length > 0 ? `: ${extra.slice(0, 3).join(" ")}` : ""}`
  );
  const text = fs.readFileSync(noticesFile, "utf8").replace(/\r\n/g, "\n");
  const crtHeading = text.indexOf("\n### Microsoft Visual C++ runtime\n");
  const crtRest = crtHeading < 0 ? "" : text.slice(crtHeading + 1).replace(/^[^\n]*\n/, "");
  const crtSection = crtRest.slice(0, Math.max(0, crtRest.search(/^#{1,3} /m)) || crtRest.length);
  check(
    `${label}: the notices' Microsoft Visual C++ runtime section names each of its files`,
    crtHeading >= 0 && MSVC_RUNTIME.every((file) => crtSection.includes(`\`${file}\``)),
    "no \"### Microsoft Visual C++ runtime\" section naming msvcp140.dll, vcruntime140.dll and vcruntime140_1.dll inside it"
  );
  if (missing.length > 0 || extra.length > 0) {
    const expectedTable = path.join(os.tmpdir(), `awkit-ai-runtime-inventory-${label}.md`);
    fs.writeFileSync(expectedTable, `${INVENTORY_HEADING}\n\n| Package | Version | License | License text |\n|---|---|---|---|\n${rows.map((r) => r.row).join("\n")}\n`);
    console.log(`    the inventory these packages need was written to ${expectedTable} (${missing.length} missing: ${missing.slice(0, 3).join(" ")})`);
  }
}

/** Windows ships these (or resolves them itself); every other DLL a staged binary imports must be staged. */
const WINDOWS_DLL = /^(api-ms-win-.*|ext-ms-.*|kernel32|kernelbase|ntdll|user32|gdi32|advapi32|shell32|shlwapi|ole32|oleaut32|ws2_32|bcrypt|bcryptprimitives|crypt32|secur32|version|psapi|dbghelp|iphlpapi|winmm|comdlg32|setupapi|powrprof|userenv|node)\.(dll|exe)$/i;

function assertNativeImports(dir: string, label: string, listed: string[]): void {
  const binaries = listed.filter((rel) => /\.(dll|node)$/i.test(rel));
  const unmet: string[] = [];
  let imports = 0;
  for (const rel of binaries) {
    const beside = new Set(listed.filter((other) => path.posix.dirname(other) === path.posix.dirname(rel)).map((other) => path.posix.basename(other).toLowerCase()));
    for (const name of peImports(path.join(dir, ...rel.split("/")))) {
      imports += 1;
      if (!WINDOWS_DLL.test(name) && !beside.has(name.toLowerCase())) unmet.push(`${rel} → ${name}`);
    }
  }
  check(
    `${label}: every DLL the staged native binaries import is staged beside them or ships with Windows (${binaries.length} binaries, ${imports} imports)`,
    binaries.length > 0 && imports > 0 && unmet.length === 0,
    unmet.length > 0 ? unmet.join("; ") : "no import was read"
  );
  // A Visual C++ runtime DLL ships only where a binary beside it loads it, directly or through another runtime
  // DLL. One that nothing loads is an image whose own imports need not resolve: verify:native-dependencies
  // (2026-09-25) found msvcp140.dll beside the reflink addon, which imports only vcruntime140.dll, needing a
  // vcruntime140_1.dll that nothing in that folder loads.
  const isRuntime = (rel: string) => MSVC_RUNTIME.includes(path.posix.basename(rel).toLowerCase());
  const importsOf = (rel: string) => peImports(path.join(dir, ...rel.split("/"))).map((name) => name.toLowerCase());
  const orphans: string[] = [];
  for (const folder of new Set(binaries.map((rel) => path.posix.dirname(rel)))) {
    const inFolder = binaries.filter((rel) => path.posix.dirname(rel) === folder);
    const loaded = new Set<string>();
    const pending = inFolder.filter((rel) => !isRuntime(rel)).flatMap(importsOf);
    for (const name of pending) {
      if (loaded.has(name)) continue;
      loaded.add(name);
      const runtime = inFolder.find((rel) => isRuntime(rel) && path.posix.basename(rel).toLowerCase() === name);
      if (runtime) pending.push(...importsOf(runtime));
    }
    orphans.push(...inFolder.filter((rel) => isRuntime(rel) && !loaded.has(path.posix.basename(rel).toLowerCase())));
  }
  const runtimeCount = binaries.filter(isRuntime).length;
  check(
    `${label}: every Visual C++ runtime DLL is staged only where a binary beside it loads it (${runtimeCount} staged)`,
    runtimeCount > 0 && orphans.length === 0,
    orphans.length > 0 ? `nothing beside them loads: ${orphans.join("; ")}` : "no runtime DLL is staged"
  );
}

/** Section A's assertions, for any tree that claims to be the staged runtime. */
function assertStagedTree(dir: string, label: string, noticesFile: string): StagedManifest | null {
  const manifest = readManifest(dir);
  check(`${label}: ${MANIFEST_NAME} is present and parses`, manifest !== null);
  if (!manifest) return null;
  const assets = manifest.assets ?? [];
  check(`${label}: the manifest is the AI host's (awkit-ai-native-host-manifest v1)`, manifest.schema?.name === "awkit-ai-native-host-manifest" && manifest.schema?.version === 1, JSON.stringify(manifest.schema));
  check(`${label}: it records the pinned runtime build`, manifest.runtimeBuild === AI_RUNTIME_PIN.build, `${manifest.runtimeBuild} vs pin ${AI_RUNTIME_PIN.build}`);
  check(`${label}: CPU only, win32/x64`, manifest.gpu === false && manifest.platform === "win32" && manifest.arch === "x64", `${manifest.gpu}/${manifest.platform}/${manifest.arch}`);

  const onDisk = listFiles(dir).filter((f) => f.rel !== MANIFEST_NAME);
  const listed = new Map(assets.map((a) => [a.relativePath, a]));
  const bad = assets.filter((a) => {
    const file = path.join(dir, ...a.relativePath.split("/"));
    return !fs.existsSync(file) || fs.statSync(file).size !== a.size || sha256(file) !== a.sha256;
  });
  check(`${label}: every listed asset is on disk with its size and SHA-256 (${assets.length - bad.length}/${assets.length})`, assets.length > 0 && bad.length === 0, bad.slice(0, 3).map((a) => a.relativePath).join(", "));
  const unlisted = onDisk.filter((f) => !listed.has(f.rel));
  check(`${label}: no file on disk is missing from the manifest (${onDisk.length} files)`, onDisk.length === assets.length && unlisted.length === 0, unlisted.slice(0, 3).map((f) => f.rel).join(", "));
  check(`${label}: no symlink or junction is staged`, onDisk.every((f) => !f.symlink));
  // electron-builder drops some dotfiles from extraResources (measured: chmodrp/.gitkeep), so a listed
  // dotfile may be a file the installer does not carry. The staging excludes them all.
  const dotted = [...listed.keys()].filter((rel) => rel.split("/").some((part) => part.startsWith(".")));
  check(`${label}: no dotfile or dot-directory is listed (the installer may drop it)`, dotted.length === 0, dotted.slice(0, 3).join(", "));

  for (const required of ["ai-host.cjs", "node_modules/node-llama-cpp/package.json", "node_modules/node-llama-cpp/llama/binariesGithubRelease.json", ADDON]) {
    check(`${label}: carries ${required}`, listed.has(required));
  }
  if (fs.existsSync(path.join(dir, "ai-host.cjs"))) {
    check(`${label}: the host is byte-identical to native-hosts/ai/ai-host.cjs`, sha256(path.join(dir, "ai-host.cjs")) === sha256(HOST_PATH));
  }
  const sourceAddon = path.join(ROOT, ...ADDON.split("/"));
  if (fs.existsSync(path.join(dir, ...ADDON.split("/"))) && fs.existsSync(sourceAddon)) {
    check(`${label}: the native addon is byte-identical to the installed CPU prebuilt`, sha256(path.join(dir, ...ADDON.split("/"))) === sha256(sourceAddon));
  }
  const gpuOrForeign = [...listed.keys()].filter((rel) => /^node_modules\/@node-llama-cpp\//.test(rel) && !rel.startsWith("node_modules/@node-llama-cpp/win-x64/"));
  check(`${label}: no GPU or foreign-platform prebuilt is staged`, gpuOrForeign.length === 0, gpuOrForeign.slice(0, 3).join(", "));
  const pruned = [...listed.keys()].filter((rel) => /gitRelease\.bundle$|\.d\.[cm]?ts$|\.map$/.test(rel));
  check(`${label}: no llama.cpp source bundle, type declarations or source maps are staged`, pruned.length === 0, pruned.slice(0, 3).join(", "));

  const packages = packageDirs(dir, [...listed.keys()]);
  const unresolved: string[] = [];
  for (const pkgDir of packages) {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      if (!lookupWithin(dir, pkgDir, dep)) unresolved.push(`${posix(path.relative(dir, pkgDir))} → ${dep}`);
    }
  }
  const directDeps = Object.keys(
    (JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules", "node-llama-cpp", "package.json"), "utf8")) as { dependencies?: Record<string, string> }).dependencies ?? {}
  );
  check(
    `${label}: every declared runtime dependency resolves inside the staged tree (${packages.length} packages)`,
    packages.length > directDeps.length && unresolved.length === 0,
    unresolved.length > 0 ? unresolved.slice(0, 5).join("; ") : `only ${packages.length} packages for ${directDeps.length} direct dependencies`
  );
  assertNativeImports(dir, label, [...listed.keys()]);
  const msvc = (manifest as StagedManifest & { msvcRuntime?: { redistVersion?: string; files?: string[] } | null }).msvcRuntime;
  check(
    `${label}: the manifest records where the Visual C++ runtime came from (Visual Studio redist ${msvc?.redistVersion ?? "none"})`,
    /^14\.\d+\.\d+$/.test(msvc?.redistVersion ?? "") && JSON.stringify(msvc?.files) === JSON.stringify(MSVC_RUNTIME),
    JSON.stringify(msvc ?? null)
  );
  assertLicenses(dir, label, [...listed.keys()], noticesFile);
  return manifest;
}

function copyTree(from: string, to: string): void {
  fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true });
}

const electronPath = createRequire(import.meta.url)("electron") as unknown as string;

const PROBE = `
"use strict";
(async () => {
  let resolved = null;
  try {
    resolved = require.resolve("node-llama-cpp");
    const rt = await import("node-llama-cpp");
    const llama = await rt.getLlama({ gpu: false, build: "never", skipDownload: true, progressLogs: false, logLevel: rt.LlamaLogLevel.disabled, logger: () => undefined });
    // gpu is "?? false" over a null that means NO backend loaded; a CPU line in the system info means a
    // ggml-cpu backend variant really registered.
    const cpu = /(^|\\|)\\s*CPU\\s*:/.test(llama.systemInfo);
    const out = cpu ? { ok: true, resolved, gpu: llama.gpu } : { ok: false, resolved, error: "no CPU backend registered: " + String(llama.systemInfo).slice(0, 160) };
    await llama.dispose();
    console.log("AWKIT_PROBE " + JSON.stringify(out));
  } catch (error) {
    console.log("AWKIT_PROBE " + JSON.stringify({ ok: false, resolved, error: String((error && error.message) || error).slice(0, 240) }));
  }
})();
`;

/** Load the runtime from `dir` exactly as the host does (a bare import from a file beside it), in Electron's Node. */
function probe(dir: string): { ok: boolean; resolved?: string | null; gpu?: unknown; error?: string } {
  const file = path.join(dir, "awkit-runtime-probe.cjs");
  fs.writeFileSync(file, PROBE);
  const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
  delete env.NODE_PATH;
  const run = spawnSync(electronPath, [file], { cwd: dir, env, encoding: "utf8", timeout: 180_000, windowsHide: true });
  fs.rmSync(file, { force: true });
  const line = `${run.stdout ?? ""}`.split(/\r?\n/).find((l) => l.startsWith("AWKIT_PROBE "));
  if (!line) return { ok: false, error: `no probe output (status ${run.status}, ${run.error ? run.error.message : "no spawn error"})` };
  return JSON.parse(line.slice("AWKIT_PROBE ".length));
}

function isInside(root: string, candidate: string | null | undefined): boolean {
  if (!candidate) return false;
  const rel = path.relative(fs.realpathSync(root), fs.realpathSync(candidate));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Sections B and C on one isolated tree. */
async function assertRuntimeRuns(dir: string, label: string, harnessDir: string, withControls: boolean): Promise<void> {
  const result = probe(dir);
  check(`${label}: the runtime loads from the isolated tree (getLlama, CPU, never build, never download)`, result.ok === true, result.error);
  check(`${label}: node-llama-cpp resolved inside that tree`, isInside(dir, result.resolved ?? null), String(result.resolved));
  check(`${label}: the loaded runtime is CPU-only`, result.gpu === false, String(result.gpu));

  if (withControls) {
    const noBinary = `${dir}-control-no-prebuilt`;
    copyTree(dir, noBinary);
    fs.rmSync(path.join(noBinary, "node_modules", "@node-llama-cpp", "win-x64"), { recursive: true, force: true });
    const control1 = probe(noBinary);
    check(`${label}: control — without the CPU prebuilt the probe FAILS (it cannot fall back to the repository)`, control1.ok === false, JSON.stringify(control1));
    fs.rmSync(noBinary, { recursive: true, force: true });

    const noDependency = `${dir}-control-no-${CONTROL_DEPENDENCY}`;
    copyTree(dir, noDependency);
    const depDir = path.join(noDependency, "node_modules", CONTROL_DEPENDENCY);
    const existed = fs.existsSync(depDir);
    fs.rmSync(depDir, { recursive: true, force: true });
    const control2 = probe(noDependency);
    check(`${label}: control — without the staged ${CONTROL_DEPENDENCY} the probe FAILS`, existed && control2.ok === false, existed ? JSON.stringify(control2) : `${CONTROL_DEPENDENCY} was never staged`);
    fs.rmSync(noDependency, { recursive: true, force: true });
  }

  const modelRoot = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-ai-staged-models-"));
  try {
    const report = await runAiHarness(
      harnessDir,
      { AWKIT_HARNESS_MODE: "protocol", AWKIT_HARNESS_HOST_PATH: path.join(dir, "ai-host.cjs"), AWKIT_HARNESS_MODEL_ROOT: modelRoot, AWKIT_HARNESS_EXPECT_RUNTIME: "1" },
      { timeoutMs: 240_000 }
    );
    if (!report) {
      check(`${label}: the protocol harness wrote a report`, false, "Electron never reached app.whenReady() or timed out");
      return;
    }
    const hello = report.hello as { compatible?: boolean; runtime?: { build?: string } } | null | undefined;
    check(`${label}: the production manager's handshake reports the staged host compatible`, hello?.compatible === true, JSON.stringify(hello));
    check(`${label}: the staged host reports the pinned build`, hello?.runtime?.build === AI_RUNTIME_PIN.build, `${hello?.runtime?.build} vs ${AI_RUNTIME_PIN.build}`);
    const failedSteps = report.steps.filter((s) => !s.ok);
    check(`${label}: every protocol step passed on the staged host (${report.steps.length - failedSteps.length}/${report.steps.length})`, report.steps.length >= 15 && failedSteps.length === 0 && report.complete !== false, failedSteps.map((s) => `${s.label}: ${s.error}`).join("; "));
  } finally {
    fs.rmSync(modelRoot, { recursive: true, force: true });
  }
}

// ── A0: the staging script's refusals, on a byte-identical copy ─────────────────────────────────────

interface ScratchCase {
  pin?: (source: string) => string;
  pkg?: (pkg: Record<string, any>) => Record<string, any>;
  /** How the scratch repository's node_modules is made. Absent by default. */
  nodeModules?: "linked-root" | "linked-runtime";
  /** Pass --out through a junction that leads back into the scratch repository. */
  outThroughLink?: boolean;
}

/**
 * Runs a byte-identical copy of the staging script whose own ROOT is a scratch repository, so each refusal
 * is the real script's. Every junction made here is unlinked before anything is removed: a recursive
 * removal must never be able to walk into the repository's own node_modules.
 */
function stageInScratch(base: string, name: string, spec: ScratchCase, links: string[]): { status: number | null; output: string; staged: boolean } {
  const root = path.join(base, name);
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.copyFileSync(STAGING_SCRIPT, path.join(root, "scripts", "prepare-ai-native-host.mjs"));
  fs.mkdirSync(path.join(root, "src", "offline"), { recursive: true });
  const pin = fs.readFileSync(PIN_SOURCE, "utf8");
  fs.writeFileSync(path.join(root, "src", "offline", "AiModelManifest.ts"), spec.pin ? spec.pin(pin) : pin);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as Record<string, any>;
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(spec.pkg ? spec.pkg(pkg) : pkg, null, 2));
  fs.mkdirSync(path.join(root, "native-hosts", "ai"), { recursive: true });
  fs.copyFileSync(HOST_PATH, path.join(root, "native-hosts", "ai", "ai-host.cjs"));
  const link = (target: string, at: string): void => {
    fs.symlinkSync(target, at, "junction");
    links.push(at);
  };
  if (spec.nodeModules === "linked-root") link(path.join(ROOT, "node_modules"), path.join(root, "node_modules"));
  if (spec.nodeModules === "linked-runtime") {
    fs.mkdirSync(path.join(root, "node_modules"));
    link(path.join(ROOT, "node_modules", "node-llama-cpp"), path.join(root, "node_modules", "node-llama-cpp"));
  }
  let out = path.join(base, `${name}-out`);
  if (spec.outThroughLink) {
    link(path.join(root, "src"), path.join(base, `${name}-out-link`));
    out = path.join(base, `${name}-out-link`, "staged");
  }
  const run = spawnSync(process.execPath, [path.join(root, "scripts", "prepare-ai-native-host.mjs"), "--out", out], { cwd: root, encoding: "utf8", timeout: 300_000 });
  return { status: run.status, output: `${run.stdout ?? ""}\n${run.stderr ?? ""}`, staged: fs.existsSync(path.join(out, MANIFEST_NAME)) };
}

/** Returns false when a junction it made could not be removed; the caller must then leave the scratch tree alone. */
function assertStagingRefusals(base: string): boolean {
  const links: string[] = [];
  const pinnedLine = `build: "${AI_RUNTIME_PIN.build}"`;
  const npmVersion = /^node-llama-cpp@(\d+\.\d+\.\d+)\+/.exec(AI_RUNTIME_PIN.build ?? "")?.[1] ?? "";
  const tagged = /^\s*- (AI_RUNTIME_PIN|package\.json|Boundary):/m;
  try {
    fs.mkdirSync(base, { recursive: true });
    const source = fs.readFileSync(PIN_SOURCE, "utf8");
    check("precondition: the pin source carries the pinned build line exactly once", source.split(pinnedLine).length === 2, pinnedLine);
    const cases: { label: string; spec: ScratchCase; expect: RegExp | null }[] = [
      { label: "control — the real pin and package.json draw no pin, package or boundary refusal", spec: {}, expect: null },
      {
        label: "an unpinned build is refused even when another object's build follows it (the lazy-match decoy)",
        spec: { pin: (s) => `${s.replace(pinnedLine, "build: null")}\nexport const DECOY_RECORD = Object.freeze({\n  ${pinnedLine}\n});\n` },
        expect: /- AI_RUNTIME_PIN: build is null/
      },
      {
        label: "a second AI_RUNTIME_PIN declaration is refused",
        spec: { pin: (s) => `${s}\nexport const AI_RUNTIME_PIN = Object.freeze({\n  name: "llama.cpp",\n  build: "node-llama-cpp@9.9.9+llama.cpp@b1"\n});\n` },
        expect: /- AI_RUNTIME_PIN: .*exactly once/
      },
      {
        label: "a malformed build value is refused",
        spec: { pin: (s) => s.replace(pinnedLine, `build: "node-llama-cpp@${npmVersion.split(".").slice(0, 2).join(".")}+llama.cpp@v0.4.0"`) },
        expect: /- AI_RUNTIME_PIN: build ".*" is not of the form/
      },
      {
        label: "a build naming a node-llama-cpp version other than package.json's pin is refused as a conflict",
        spec: { pin: (s) => s.replace(pinnedLine, pinnedLine.replace(`node-llama-cpp@${npmVersion}+`, "node-llama-cpp@0.0.1+")) },
        expect: /- AI_RUNTIME_PIN: .*but package\.json pins/
      },
      {
        label: "package.json declaring node-llama-cpp twice with different versions is refused",
        spec: { pkg: (p) => ({ ...p, dependencies: { ...(p.dependencies ?? {}), "node-llama-cpp": `^${npmVersion}` } }) },
        expect: /- package\.json: node-llama-cpp must be declared exactly once/
      },
      {
        label: "a node_modules that resolves outside the repository (a junction) is refused and nothing is staged",
        spec: { nodeModules: "linked-root" },
        expect: /- Boundary: node_modules /
      },
      {
        label: "a runtime package reached through a junction is refused",
        spec: { nodeModules: "linked-runtime" },
        expect: /- Boundary: node_modules\/node-llama-cpp /
      },
      {
        label: "an --out that resolves back into the repository through a junction is refused",
        spec: { outThroughLink: true },
        expect: /- Boundary: --out /
      }
    ];
    cases.forEach((c, index) => {
      const run = stageInScratch(base, `case-${index}`, c.spec, links);
      if (c.expect === null) {
        // node_modules is absent, so the copy must stop at its own preconditions and name nothing else.
        check(c.label, run.status !== 0 && /is not installed/.test(run.output) && !tagged.test(run.output), run.output.trim().slice(0, 400));
      } else {
        check(c.label, run.status !== 0 && !run.staged && c.expect.test(run.output), `exit ${run.status}, staged ${run.staged}: ${run.output.trim().slice(0, 400)}`);
      }
    });
    const copy = path.join(base, "case-0", "scripts", "prepare-ai-native-host.mjs");
    check("the script that ran is byte-identical to scripts/prepare-ai-native-host.mjs", sha256(copy) === sha256(STAGING_SCRIPT));
  } finally {
    for (const at of links) {
      try {
        fs.unlinkSync(at);
      } catch {
        // Checked below. Never fall back to a recursive removal of a link.
      }
    }
  }
  const remaining = links.filter((at) => {
    try {
      fs.lstatSync(at);
      return true;
    } catch {
      return false;
    }
  });
  if (remaining.length > 0) console.error(`  ! junctions left in place, so the scratch tree is NOT removed: ${remaining.join(", ")}`);
  return remaining.length === 0;
}

// ── A1: the strict validator's pin and inventory rules, on scratch roots ────────────────────────────

const VALIDATOR = path.join(ROOT, "scripts", "validate-offline-bundle.ps1");

interface ValidatorCase {
  pin?: (source: string) => string;
  pkg?: (pkg: Record<string, any>) => Record<string, any>;
  /** Files of the scratch staged tree, relative to build/native-hosts/ai. */
  files: string[];
  /** The manifest's asset list, relative to native-hosts/ai. Each asset carries its file's real size and hash. */
  listed: string[];
}

/** Runs the real validator (development mode) with -RootPath on a scratch root and returns its output. */
function validateInScratch(base: string, name: string, spec: ValidatorCase): string {
  const root = path.join(base, name);
  const stagedRoot = path.join(root, "build", "native-hosts", "ai");
  fs.mkdirSync(path.join(root, "resources"), { recursive: true });
  fs.mkdirSync(path.join(root, "src", "offline"), { recursive: true });
  fs.mkdirSync(stagedRoot, { recursive: true });
  fs.copyFileSync(path.join(ROOT, "resources", "offline-browser-policy.json"), path.join(root, "resources", "offline-browser-policy.json"));
  const pin = fs.readFileSync(PIN_SOURCE, "utf8");
  fs.writeFileSync(path.join(root, "src", "offline", "AiModelManifest.ts"), spec.pin ? spec.pin(pin) : pin);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as Record<string, any>;
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(spec.pkg ? spec.pkg(pkg) : pkg, null, 2));
  fs.writeFileSync(path.join(stagedRoot, MANIFEST_NAME), "{}\n");
  for (const rel of spec.files) {
    const file = path.join(stagedRoot, ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `content of ${rel}\n`);
  }
  const asset = (rel: string) => {
    const file = path.join(stagedRoot, ...rel.split("/"));
    return { relativePath: `native-hosts/ai/${rel}`, size: fs.statSync(file).size, sha256: sha256(file) };
  };
  const npm = /^node-llama-cpp@(\d+\.\d+\.\d+)\+/.exec(AI_RUNTIME_PIN.build ?? "")?.[1];
  const aiRuntime = { enabled: true, requiredForAppStartup: false, modelPackBundled: false, gpu: false, platform: "win32", arch: "x64", runtimeBuild: AI_RUNTIME_PIN.build, runtimeVersion: npm, assets: spec.listed.map(asset) };
  // The validator runs under strict mode and reads the other sections directly, so the scratch manifest is
  // the real one with only aiRuntime replaced. Its signature no longer verifies, which it reports and moves on.
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "resources", "dependency-manifest.json"), "utf8")) as Record<string, unknown>;
  fs.writeFileSync(path.join(root, "resources", "dependency-manifest.json"), JSON.stringify({ ...manifest, aiRuntime }, null, 2));
  const run = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", VALIDATOR, "-RootPath", root], { encoding: "utf8", timeout: 120_000, windowsHide: true });
  return `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
}

/** The validator's AI lines, or its last lines when it never reached the AI section. */
function validatorDetail(output: string): string {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const relevant = lines.filter((line) => /Local-AI|AI_RUNTIME_PIN/.test(line));
  return (relevant.length > 0 ? relevant.join(" | ") : `no Local-AI line, the validator ended with: ${lines.slice(-4).join(" | ")}`).slice(0, 500);
}

function assertValidatorRules(base: string): void {
  const pinnedLine = `build: "${AI_RUNTIME_PIN.build}"`;
  const npmVersion = /^node-llama-cpp@(\d+\.\d+\.\d+)\+/.exec(AI_RUNTIME_PIN.build ?? "")?.[1] ?? "";
  const pinError = /ERROR: Local-AI runtime pin:/;
  const inventoryError = /the signed manifest does not list|the staged tree does not hold|lists a path more than once/;
  const tree = ["ai-host.cjs", "node_modules/a/index.js"];
  fs.mkdirSync(base, { recursive: true });

  const control = validateInScratch(base, "control", { files: tree, listed: tree });
  check(
    "control — a consistent tree and the real pin draw no pin or inventory error, and the inventory is compared by path",
    /Local-AI runtime inventory: 2 staged files compared by path with 2 signed entries \(0 unlisted, 0 missing\)/.test(control) && !pinError.test(control) && !inventoryError.test(control),
    validatorDetail(control)
  );
  const cases: { label: string; spec: ValidatorCase; expect: RegExp[] }[] = [
    {
      label: "a duplicate entry that keeps the counts equal no longer hides an unlisted staged file",
      spec: { files: [...tree, "node_modules/a/extra.js"], listed: [tree[0], tree[0], tree[1]] },
      expect: [/lists a path more than once/, /holds 1 file\(s\) the signed manifest does not list/]
    },
    {
      label: "a case-variant entry that keeps the counts equal no longer hides an unlisted staged file",
      spec: { files: [...tree, "node_modules/a/extra.js"], listed: [tree[0], "AI-HOST.cjs", tree[1]] },
      expect: [/lists a path more than once \(compared case-insensitively\)/, /holds 1 file\(s\) the signed manifest does not list/]
    },
    {
      label: "an unpinned build followed by another object's build is refused (the lazy-match decoy)",
      spec: { files: tree, listed: tree, pin: (s) => `${s.replace(pinnedLine, "build: null")}\nexport const DECOY_RECORD = Object.freeze({\n  ${pinnedLine}\n});\n` },
      expect: [/Local-AI runtime pin: AI_RUNTIME_PIN: build is null/]
    },
    {
      label: "a second AI_RUNTIME_PIN declaration is refused",
      spec: { files: tree, listed: tree, pin: (s) => `${s}\nexport const AI_RUNTIME_PIN = Object.freeze({\n  name: "llama.cpp",\n  build: "node-llama-cpp@9.9.9+llama.cpp@b1"\n});\n` },
      expect: [/Local-AI runtime pin: AI_RUNTIME_PIN: .*exactly once/]
    },
    {
      label: "a pin naming a node-llama-cpp version other than package.json's is refused as a conflict",
      spec: { files: tree, listed: tree, pin: (s) => s.replace(pinnedLine, pinnedLine.replace(`node-llama-cpp@${npmVersion}+`, "node-llama-cpp@0.0.1+")) },
      expect: [/Local-AI runtime pin: AI_RUNTIME_PIN: .*but package\.json pins/]
    },
    {
      label: "package.json declaring node-llama-cpp twice is refused",
      spec: { files: tree, listed: tree, pkg: (p) => ({ ...p, dependencies: { ...(p.dependencies ?? {}), "node-llama-cpp": `^${npmVersion}` } }) },
      expect: [/Local-AI runtime pin: package\.json: node-llama-cpp must be declared exactly once/]
    }
  ];
  cases.forEach((c, index) => {
    const output = validateInScratch(base, `case-${index}`, c.spec);
    check(c.label, c.expect.every((pattern) => pattern.test(output)), validatorDetail(output));
  });
}

// ── E0: the model scan catches what it exists for ─────────────────────────────────────────────────────

async function assertModelScanControls(base: string): Promise<void> {
  const tree = path.join(base, "tree");
  fs.mkdirSync(path.join(tree, "resources"), { recursive: true });
  const gguf = Buffer.concat([Buffer.from("GGUF", "latin1"), Buffer.alloc(60)]);
  fs.writeFileSync(path.join(tree, "resources", "weights.bin"), gguf);
  fs.writeFileSync(path.join(tree, "resources", "model.gguf"), "not a real pack");
  fs.writeFileSync(path.join(tree, "resources", "clean.txt"), "plain text");
  const asarSource = path.join(base, "asar-source");
  fs.mkdirSync(path.join(asarSource, "lib"), { recursive: true });
  fs.writeFileSync(path.join(asarSource, "lib", "clean.js"), "module.exports = 1;\n");
  fs.writeFileSync(path.join(asarSource, "lib", "data.dat"), gguf);
  await asarModule.createPackage(asarSource, path.join(tree, "resources", "app.asar"));
  const scan = scanForModelFiles(tree);
  const flagged = (rel: string, signal: string): boolean => scan.found.includes(`${rel} (${signal})`);
  check(
    "control — the scan flags a renamed pack by its magic, a .gguf by name and a pack packed inside app.asar, and nothing else",
    flagged("resources/weights.bin", "GGUF magic") && flagged("resources/model.gguf", "model extension") && flagged("resources/app.asar/lib/data.dat", "GGUF magic") && scan.found.length === 3 && scan.asarEntries === 2,
    JSON.stringify(scan)
  );
}

// ── Run ──────────────────────────────────────────────────────────────────────────────────────────

console.log("verify:ai-packaged-runtime — the pinned local-AI runtime as the installer carries it\n");
if (process.argv.includes("--exit-status-probe")) {
  // Section F's probe: one passing check and one section not run, through the real exit path.
  check("exit-status probe: a check that passed", true);
  skip("exit-status probe: a required section", "section F's self-probe");
  finish();
}
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-ai-staged-"));
const staged = path.join(scratch, "ai");
const cleanup: string[] = [scratch];
let harnessDir: string | null = null;

try {
  console.log("A0. The staging script's refusals (a byte-identical copy in a scratch repository)");
  if (!assertStagingRefusals(path.join(scratch, "refusals"))) cleanup.splice(cleanup.indexOf(scratch), 1);

  console.log("\nA1. The strict validator's pin and inventory rules (scratch roots through -RootPath)");
  assertValidatorRules(path.join(scratch, "validator"));

  console.log("\nA. Staging into an isolated directory");
  const ancestors: string[] = [];
  for (let dir = scratch; path.dirname(dir) !== dir; dir = path.dirname(dir)) ancestors.push(path.dirname(dir));
  const leaks = ancestors.filter((dir) => fs.existsSync(path.join(dir, "node_modules", "node-llama-cpp")));
  check("precondition: no directory above the staging root can supply node-llama-cpp", leaks.length === 0, leaks.join(", "));

  // awkit-i6ot: with no Visual Studio redist reachable, the real script must refuse rather than stage a
  // runtime that loads only where Visual C++ happens to be installed.
  // The refusal must come before the output is replaced (QC F3): an earlier staging stays exactly as it was.
  const noRedistOut = path.join(scratch, "ai-without-vs-redist");
  const earlierStaging = '{"marker":"an earlier staging"}\n';
  fs.mkdirSync(noRedistOut, { recursive: true });
  fs.writeFileSync(path.join(noRedistOut, MANIFEST_NAME), earlierStaging);
  const noRedistRun = spawnSync(process.execPath, [STAGING_SCRIPT, "--out", noRedistOut], {
    cwd: ROOT,
    env: { ...process.env, "ProgramFiles(x86)": path.join(scratch, "no-visual-studio") },
    encoding: "utf8",
    timeout: 300_000
  });
  const left = fs.readdirSync(noRedistOut);
  check(
    "without a Visual Studio redist the staging refuses the Visual C++ runtime and leaves an earlier staging untouched",
    noRedistRun.status === 1 &&
      /MSVC runtime: no Visual Studio installation/.test(noRedistRun.stderr ?? "") &&
      left.length === 1 &&
      fs.readFileSync(path.join(noRedistOut, MANIFEST_NAME), "utf8") === earlierStaging,
    `exit ${noRedistRun.status}, ${left.length} entr${left.length === 1 ? "y" : "ies"} left: ${`${noRedistRun.stderr ?? ""}`.trim().slice(0, 300)}`
  );

  const stageRun = spawnSync(process.execPath, [STAGING_SCRIPT, "--out", staged], { cwd: ROOT, encoding: "utf8", timeout: 300_000 });
  check("scripts/prepare-ai-native-host.mjs stages the runtime (exit 0)", stageRun.status === 0, `${stageRun.status}: ${`${stageRun.stderr ?? ""}${stageRun.error?.message ?? ""}`.trim().slice(0, 400)}`);
  const stagedManifest = stageRun.status === 0 ? assertStagedTree(staged, "staged", NOTICES) : null;

  if (stagedManifest) {
    harnessDir = await buildAiHarness();
    cleanup.push(harnessDir);
    console.log("\nB–C. The staged runtime runs, in isolation");
    await assertRuntimeRuns(staged, "staged", harnessDir, true);

    console.log("\nD. Real inference on the staged copy (pinned Qwen3.5-0.8B)");
    const pack = path.join(os.homedir(), "Downloads", PACK_NAME);
    if (!fs.existsSync(pack)) {
      skip("live harness on the staged copy", `no pack at ~/Downloads/${PACK_NAME}`);
    } else {
      const measured = await measurePack(pack);
      const entry = AI_MODEL_MANIFEST.find((item) => item.sha256 === measured.sha256 && item.sizeBytes === measured.sizeBytes);
      check("the pack is a pinned manifest entry", Boolean(entry), `sha256 ${measured.sha256}`);
      if (entry) {
        const model = stageModelRoot(pack, measured.sha256);
        cleanup.push(model.root);
        const report = await runAiHarness(
          harnessDir,
          {
            AWKIT_HARNESS_MODE: "live",
            AWKIT_HARNESS_HOST_PATH: path.join(staged, "ai-host.cjs"),
            AWKIT_HARNESS_MODEL_ROOT: model.modelRoot,
            AWKIT_HARNESS_MODEL_PATH: model.modelPath,
            AWKIT_HARNESS_MODEL_ID: entry.id,
            AWKIT_HARNESS_THREADS: String(deriveInferenceThreads(os.cpus().length)),
            AWKIT_HARNESS_EXPECT_BUILD: AI_RUNTIME_PIN.build ?? ""
          },
          { timeoutMs: 480_000 }
        );
        if (!report) check("the live harness wrote a report", false, "Electron never reached app.whenReady() or timed out");
        else {
          printSteps(report, check);
          check("the live harness ran every step on the staged host", report.steps.length === 13, `${report.steps.length} steps`);
        }
      }
    }
  }

  console.log("\nE. The packaged artifact (dist/win-unpacked)");
  await assertModelScanControls(path.join(scratch, "model-scan-controls"));
  const unpacked = path.join(ROOT, "dist", "win-unpacked");
  const packaged = path.join(unpacked, "resources", "native-hosts", "ai");
  if (!fs.existsSync(unpacked)) {
    skip("packaged artifact", "there is no dist/win-unpacked — run `npm run package:portable`");
  } else {
    const scan = scanForModelFiles(unpacked);
    check(
      `packaged: no model file anywhere in the artifact, app.asar included (${scan.files} files and ${scan.asarEntries} asar entries read)`,
      scan.files > 0 && scan.asarEntries > 0 && scan.found.length === 0,
      scan.found.length > 0 ? scan.found.slice(0, 5).join("; ") : "nothing was read"
    );
    check("packaged: the artifact carries the local-AI runtime (resources/native-hosts/ai)", fs.existsSync(packaged), "a package without it predates L7 packaging and is stale — re-run `npm run package:portable`");
    if (fs.existsSync(packaged)) {
      const packagedManifest = assertStagedTree(packaged, "packaged", path.join(unpacked, "resources", "resources", "THIRD_PARTY_NOTICES.md"));
      const identity = (m: StagedManifest | null) => JSON.stringify((m?.assets ?? []).map((a) => [a.relativePath, a.size, a.sha256]).sort());
      const current = Boolean(packagedManifest && stagedManifest && identity(packagedManifest) === identity(stagedManifest));
      check(
        "packaged: the tree is exactly the current source's staging",
        current,
        stagedManifest ? "STALE: the packaged tree is not the current source's staging — re-run `npm run package:portable`" : "the current staging failed, so there is nothing to compare against"
      );
      if (current) {
        const isolated = path.join(scratch, "packaged-ai");
        copyTree(packaged, isolated);
        if (!harnessDir) {
          harnessDir = await buildAiHarness();
          cleanup.push(harnessDir);
        }
        await assertRuntimeRuns(isolated, "packaged", harnessDir, false);
      }
    }
  }

  console.log("\nF. Neither packaged AI gate reports success for a gate that did not run");
  const tsxCli = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const homeWithoutPack = path.join(scratch, "home-without-pack");
  fs.mkdirSync(homeWithoutPack, { recursive: true });
  const app = spawnSync(process.execPath, [tsxCli, path.join(ROOT, "scripts", "verify-ai-packaged-app.mts")], { cwd: ROOT, env: { ...process.env, USERPROFILE: homeWithoutPack, HOME: homeWithoutPack }, encoding: "utf8", timeout: 180_000 });
  check(
    "verify:ai-packaged-app exits 2, never 0, when it cannot run (no model pack in ~/Downloads)",
    app.status === 2 && /NOT RUN/.test(app.stdout ?? ""),
    `exit ${app.status}: ${`${app.stdout ?? ""}`.trim().split(/\r?\n/).slice(-2).join(" | ")}`
  );
  const self = spawnSync(process.execPath, [tsxCli, path.join(ROOT, "scripts", "verify-ai-packaged-runtime.mts"), "--exit-status-probe"], { cwd: ROOT, encoding: "utf8", timeout: 180_000 });
  check(
    "verify:ai-packaged-runtime exits 2, never 0, when a check passed and a required section did not run",
    self.status === 2 && /NOT RUN/.test(self.stdout ?? ""),
    `exit ${self.status}: ${`${self.stdout ?? ""}`.trim().split(/\r?\n/).slice(-1).join("")}`
  );
} finally {
  // A scratch file a just-exited child still holds can make removal fail (measured: ENOTEMPTY under
  // Node 18). Leftover scratch is harmless; losing the verdict to a cleanup crash is not.
  for (const dir of cleanup) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (error) {
      console.error(`  ! scratch left in place: ${dir} (${(error as NodeJS.ErrnoException).code ?? error})`);
    }
  }
}

finish();
