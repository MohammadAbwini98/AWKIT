/**
 * verify:native-dependencies — every native binary the installer ships finds its DLLs on a Windows machine
 * with nothing else installed (Phase L, L7 › Packaging, `awkit-i6ot`).
 *
 * `verify:ai-packaged-runtime` checks the local-AI tree's imports against a fixed list of Windows DLLs.
 * This gate covers the whole packaged artifact (Electron, the bundled Chromium, the Zvec binding and the
 * AI runtime) and decides "ships with Windows" from the file's own signature, never from its presence:
 * a developer machine with the Visual C++ runtime installed globally has `msvcp140.dll` in System32 too.
 *
 *   A. Controls on the rule: the parser reads this Node's own imports; kernel32.dll is classified as
 *      Windows; and when this host has a Visual C++ runtime DLL in System32, it is NOT (it is signed
 *      "Microsoft Corporation", a separately installed redistributable, not "Microsoft Windows").
 *   B. Static resolution over every PE image in dist/win-unpacked, static and delay-load imports. An
 *      import resolves when it is an API set, sits beside its importer, is `node.exe` for a Node addon
 *      (the host process supplies it), or is a System32 file validly signed "Microsoft Windows".
 *      Anything else is unresolved, and every one is listed.
 *   C. The loader decides, for each shipped Node native module (the AI runtime through getLlama, the
 *      reflink addon in the AI tree, the Zvec binding). In a scratch copy of its tree, every imported name
 *      this host could satisfy from OUTSIDE the tree (System32 other than Windows' own files, the Windows
 *      directory, PATH, the probe's Electron directory) is rewritten, same length, to a decoy no directory
 *      holds, and a file of that name inside the tree is renamed to match. The module must then load, which
 *      only the tree itself can make happen. The unpatched copy must load first, so a failure is the
 *      tree's and not the probe's.
 *
 * Exit, the `gateExitCode` convention: 1 on any failure, 2 when dist/win-unpacked is absent (NOT RUN),
 * 0 only when every section ran and passed.
 *
 * Run: npm run verify:native-dependencies
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readPeImage, type PeImage } from "./helpers/pe-image.mts";
import { gateExitCode } from "./lib/failure-capture-gate.mts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const UNPACKED = path.join(ROOT, "dist", "win-unpacked");
const SYSTEM_ROOT = process.env.SystemRoot ?? "C:\\Windows";
const SYSTEM32 = path.join(SYSTEM_ROOT, "System32");
const API_SET = /^(api|ext)-ms-/i;
const HOST_PROCESS = /^node\.(exe|dll)$/i;
/** The signer of Windows' own files. The Visual C++ redistributable is signed "Microsoft Corporation". */
const WINDOWS_SIGNER = /^CN=Microsoft Windows,/;

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

// ── Signatures: which System32 files are Windows' own ──────────────────────────────────────────────

const signatureCache = new Map<string, { status: string; subject: string }>();

/** Authenticode status and signer of each file (catalog signatures included), read in one PowerShell call. */
function readSignatures(files: string[]): void {
  const todo = [...new Set(files.map((f) => f.toLowerCase()))].filter((f) => !signatureCache.has(f));
  if (todo.length === 0) return;
  const list = path.join(os.tmpdir(), `awkit-native-deps-${process.pid}.txt`);
  fs.writeFileSync(list, todo.join("\n"), "utf8");
  const script =
    "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; " +
    `foreach ($p in Get-Content -LiteralPath '${list}') { $s = Get-AuthenticodeSignature -LiteralPath $p; ` +
    "$subject = if ($s.SignerCertificate) { $s.SignerCertificate.Subject } else { '' }; " +
    "Write-Output ('{0}|{1}|{2}' -f $p, $s.Status, $subject) }";
  const run = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 600_000, windowsHide: true, maxBuffer: 64 << 20 });
  fs.rmSync(list, { force: true });
  for (const line of `${run.stdout ?? ""}`.split(/\r?\n/)) {
    const [file, status, ...subject] = line.split("|");
    if (file && status) signatureCache.set(file.trim().toLowerCase(), { status: status.trim(), subject: subject.join("|").trim() });
  }
  for (const file of todo) if (!signatureCache.has(file)) signatureCache.set(file, { status: "Unread", subject: "" });
}

/** "windows" for a System32 file validly signed as part of Windows; otherwise why not. */
function windowsStanding(name: string): { windows: true } | { windows: false; why: string } {
  const file = path.join(SYSTEM32, name);
  if (!fs.existsSync(file)) return { windows: false, why: "not beside it and not in System32" };
  readSignatures([file]);
  const sig = signatureCache.get(file.toLowerCase())!;
  if (sig.status === "Valid" && WINDOWS_SIGNER.test(sig.subject)) return { windows: true };
  return { windows: false, why: `in System32 only as a separately installed file (${sig.status}, "${sig.subject.split(",")[0] || "unsigned"}"), not part of Windows` };
}

// ── The PE images of a tree ────────────────────────────────────────────────────────────────────────

interface Binary {
  file: string;
  rel: string;
  image: PeImage;
}

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function isMz(file: string): boolean {
  const fd = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(2);
    return fs.readSync(fd, head, 0, 2, 0) === 2 && head.toString("latin1") === "MZ";
  } finally {
    fs.closeSync(fd);
  }
}

function binariesUnder(root: string): Binary[] {
  const out: Binary[] = [];
  for (const file of listFiles(root)) {
    if (!isMz(file)) continue;
    const image = readPeImage(fs.readFileSync(file));
    if (image) out.push({ file, rel: path.relative(root, file).split(path.sep).join("/"), image });
  }
  return out;
}

const dirEntries = new Map<string, Set<string>>();
const entriesOf = (dir: string): Set<string> => {
  if (!dirEntries.has(dir)) dirEntries.set(dir, new Set(fs.readdirSync(dir).map((entry) => entry.toLowerCase())));
  return dirEntries.get(dir)!;
};

/** Why `name`, imported by `importer`, does not resolve; null when it does. */
function unresolvedReason(importer: string, name: string): string | null {
  if (API_SET.test(name)) return null;
  if (HOST_PROCESS.test(name) && /\.node$/i.test(importer)) return null;
  if (entriesOf(path.dirname(importer)).has(name.toLowerCase())) return null;
  const standing = windowsStanding(name);
  return standing.windows ? null : standing.why;
}

// ── C: the loader decides ──────────────────────────────────────────────────────────────────────────

const electronPath = createRequire(import.meta.url)("electron") as unknown as string;
const OUTSIDE_DIRS = [...new Set([SYSTEM32, SYSTEM_ROOT, path.dirname(electronPath), ...(process.env.PATH ?? "").split(path.delimiter)].filter(Boolean))];

const existsOutside = (name: string): boolean => OUTSIDE_DIRS.some((dir) => fs.existsSync(path.join(dir, name)));

function decoyFor(name: string): string {
  for (const prefix of ["zq", "qz", "zx", "xz", "qx"]) {
    const decoy = `${prefix}${name.slice(2)}`;
    if (!existsOutside(decoy)) return decoy;
  }
  throw new Error(`no free decoy for ${name}`);
}

/**
 * Rewrites, in `tree`, every import this host could satisfy from outside the tree to a same-length decoy
 * and renames a file of that name inside the tree to match. Returns what it changed.
 */
function isolateFromHost(tree: string): { decoys: Map<string, string>; patched: number; renamed: string[]; leftover: string[] } {
  const binaries = binariesUnder(tree);
  const decoys = new Map<string, string>();
  for (const { image } of binaries) {
    for (const { name } of image.imports) {
      const key = name.toLowerCase();
      if (decoys.has(key) || API_SET.test(name) || HOST_PROCESS.test(name)) continue;
      if (!existsOutside(name)) continue;
      if (windowsStanding(name).windows) continue;
      decoys.set(key, decoyFor(name));
    }
  }
  let patched = 0;
  for (const { file, image } of binaries) {
    const bytes = fs.readFileSync(file);
    let changed = false;
    for (const imp of image.imports) {
      const decoy = decoys.get(imp.name.toLowerCase());
      if (!decoy) continue;
      bytes.write(decoy, imp.offset, "latin1");
      changed = true;
      patched += 1;
    }
    if (changed) fs.writeFileSync(file, bytes);
  }
  const renamed: string[] = [];
  for (const file of listFiles(tree)) {
    const decoy = decoys.get(path.basename(file).toLowerCase());
    if (!decoy) continue;
    fs.renameSync(file, path.join(path.dirname(file), decoy));
    renamed.push(path.relative(tree, file).split(path.sep).join("/"));
  }
  const leftover = binariesUnder(tree).flatMap((b) => b.image.imports.filter((i) => decoys.has(i.name.toLowerCase())).map((i) => `${b.rel} → ${i.name}`));
  return { decoys, patched, renamed, leftover };
}

const PROBE = `
"use strict";
(async () => {
  const spec = JSON.parse(process.argv[process.argv.length - 1]);
  let out;
  try {
    if (spec.kind === "llama") {
      const rt = await import("node-llama-cpp");
      const llama = await rt.getLlama({ gpu: false, build: "never", skipDownload: true, progressLogs: false, logLevel: rt.LlamaLogLevel.disabled, logger: () => undefined });
      out = { ok: llama.gpu === false, detail: "gpu " + llama.gpu };
      await llama.dispose();
    } else {
      const mod = { exports: {} };
      process.dlopen(mod, require("node:path").join(__dirname, spec.addon));
      out = { ok: Object.keys(mod.exports).length > 0, detail: Object.keys(mod.exports).length + " exports" };
    }
  } catch (error) {
    out = { ok: false, detail: String((error && error.message) || error).replace(/\\s+/g, " ").slice(0, 300) };
  }
  console.log("AWKIT_PROBE " + JSON.stringify(out));
})();
`;

function probe(tree: string, spec: { kind: "llama" } | { kind: "addon"; addon: string }): { ok: boolean; detail: string } {
  const file = path.join(tree, "awkit-native-probe.cjs");
  fs.writeFileSync(file, PROBE);
  const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
  delete env.NODE_PATH;
  const run = spawnSync(electronPath, [file, JSON.stringify(spec)], { cwd: tree, env, encoding: "utf8", timeout: 180_000, windowsHide: true });
  fs.rmSync(file, { force: true });
  const line = `${run.stdout ?? ""}`.split(/\r?\n/).find((l) => l.startsWith("AWKIT_PROBE "));
  if (!line) return { ok: false, detail: `no probe output (status ${run.status}, ${run.error ? run.error.message : `${run.stderr ?? ""}`.trim().slice(0, 200)})` };
  return JSON.parse(line.slice("AWKIT_PROBE ".length)) as { ok: boolean; detail: string };
}

// ── Run ──────────────────────────────────────────────────────────────────────────────────────────

console.log("verify:native-dependencies — the shipped native binaries on a machine with nothing else installed\n");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-native-deps-"));
try {
  console.log("A. Controls on the rule");
  const own = readPeImage(fs.readFileSync(process.execPath));
  check(`the parser reads this Node's own imports (${own?.imports.length ?? 0}, KERNEL32.dll among them)`, Boolean(own && own.imports.some((i) => /^kernel32\.dll$/i.test(i.name))));
  check("kernel32.dll is classified as part of Windows (valid, signed \"Microsoft Windows\")", windowsStanding("kernel32.dll").windows);
  const redistOnHost = ["vcruntime140.dll", "msvcp140.dll"].filter((name) => fs.existsSync(path.join(SYSTEM32, name)));
  if (redistOnHost.length === 0) {
    console.log("  - this host has no Visual C++ runtime in System32, so no binary can resolve one from there");
  } else {
    const misread = redistOnHost.filter((name) => windowsStanding(name).windows);
    check(`the Visual C++ runtime this host installed globally (${redistOnHost.join(", ")}) is NOT classified as part of Windows`, misread.length === 0, misread.join(", "));
  }
  const ancestors: string[] = [];
  for (let dir = scratch; path.dirname(dir) !== dir; dir = path.dirname(dir)) ancestors.push(path.dirname(dir));
  const leaks = ancestors.filter((dir) => fs.existsSync(path.join(dir, "node_modules", "node-llama-cpp")));
  check("precondition: no directory above the scratch root can supply node-llama-cpp to the probe", leaks.length === 0, leaks.join(", "));

  if (!fs.existsSync(UNPACKED)) {
    notRun.push("dist/win-unpacked");
    console.log("\n  - NOT RUN: B and C — there is no dist/win-unpacked; run `npm run package:portable`");
  } else {
    console.log("\nB. Static resolution over every PE image in dist/win-unpacked");
    const binaries = binariesUnder(UNPACKED);
    const imports = binaries.reduce((n, b) => n + b.image.imports.length, 0);
    const system32Names = [...new Set(binaries.flatMap((b) => b.image.imports.map((i) => i.name.toLowerCase())))].map((n) => path.join(SYSTEM32, n)).filter((f) => fs.existsSync(f));
    readSignatures(system32Names);
    const unresolved = new Map<string, { why: string; importers: string[]; linkers: Set<string> }>();
    for (const binary of binaries) {
      for (const imp of binary.image.imports) {
        const why = unresolvedReason(binary.file, imp.name);
        if (why === null) continue;
        const key = imp.name.toLowerCase();
        const entry = unresolved.get(key) ?? { why, importers: [], linkers: new Set<string>() };
        entry.importers.push(`${binary.rel}${imp.delay ? " (delay-load)" : ""}`);
        entry.linkers.add(binary.image.linker);
        unresolved.set(key, entry);
      }
    }
    const areas = new Map<string, number>();
    for (const b of binaries) {
      const area = /^resources\/native-hosts\/([^/]+)\//.exec(b.rel)?.[1] ?? (b.rel.startsWith("resources/resources/browsers/") ? "chromium" : "electron");
      areas.set(area, (areas.get(area) ?? 0) + 1);
    }
    console.log(`  ${binaries.length} PE images (${[...areas].map(([a, n]) => `${a} ${n}`).join(", ")}), ${imports} imports, ${system32Names.length} distinct System32 names signature-checked`);
    for (const [name, entry] of unresolved) console.error(`    ${name}: ${entry.why}\n      imported by (linker ${[...entry.linkers].sort().join(", ")}) ${entry.importers.join(", ")}`);
    check(
      `every import of every shipped PE image resolves beside it, as an API set, from the host process or from Windows itself (${unresolved.size} unresolved DLL name(s))`,
      binaries.length > 0 && imports > 0 && unresolved.size === 0,
      binaries.length === 0 ? "no PE image was read" : [...unresolved.keys()].join(", ")
    );

    console.log("\nC. The loader decides (each module's tree copied, every name the host could supply from outside it made unreachable)");
    const modules = [
      { label: "the local-AI runtime (getLlama, CPU)", tree: "resources/native-hosts/ai", spec: { kind: "llama" as const } },
      { label: "the reflink addon in the AI tree", tree: "resources/native-hosts/ai", spec: { kind: "addon" as const, addon: "node_modules/@reflink/reflink-win32-x64-msvc/reflink.win32-x64-msvc.node" } },
      { label: "the Zvec binding", tree: "resources/native-hosts/zvec", spec: { kind: "addon" as const, addon: "node_modules/@zvec/bindings-win32-x64/zvec_node_binding.node" } }
    ];
    modules.forEach((m, index) => {
      const source = path.join(UNPACKED, ...m.tree.split("/"));
      if (m.spec.kind === "addon" && !fs.existsSync(path.join(source, ...m.spec.addon.split("/")))) {
        check(`${m.label}: shipped at ${m.tree}/${m.spec.addon}`, false);
        return;
      }
      const plain = path.join(scratch, `m${index}-plain`);
      fs.cpSync(source, plain, { recursive: true });
      const control = probe(plain, m.spec);
      check(`${m.label}: the unpatched copy loads on this host (the probe works)`, control.ok, control.detail);
      const isolated = path.join(scratch, `m${index}-isolated`);
      fs.cpSync(source, isolated, { recursive: true });
      const iso = isolateFromHost(isolated);
      const names = [...iso.decoys.keys()];
      console.log(`    made unreachable from outside the tree: ${names.length > 0 ? names.join(", ") : "nothing (no import this host could supply from outside)"}; ${iso.patched} import(s) rewritten, ${iso.renamed.length} file(s) inside the tree renamed${iso.renamed.length > 0 ? ` (${iso.renamed.join(", ")})` : ""}`);
      check(`${m.label}: the rewrite left no import of those names`, iso.leftover.length === 0 && (names.length === 0 || iso.patched > 0), iso.leftover.slice(0, 4).join("; "));
      const result = probe(isolated, m.spec);
      check(`${m.label}: loads with only its own tree to satisfy ${names.length > 0 ? names.join(", ") : "its imports"}`, result.ok, result.detail);
    });
  }
} finally {
  try {
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    console.error(`  ! scratch left in place: ${scratch} (${(error as NodeJS.ErrnoException).code ?? error})`);
  }
}

const exitCode = gateExitCode({ passed, failed, inconclusive: 0, gateNotRun: notRun.length > 0 });
console.log(`\n${passed} passed, ${failed} failed${notRun.length > 0 ? `, NOT RUN: ${notRun.join("; ")}` : ""} — ${exitCode === 0 ? "PASS" : exitCode === 1 ? "FAIL" : "NOT RUN, which is never a pass"}`);
process.exit(exitCode);
