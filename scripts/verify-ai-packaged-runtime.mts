/**
 * verify:ai-packaged-runtime — the pinned local-AI runtime exactly as the installer carries it
 * (Phase L, L7 › Packaging: "Installer carries the pinned runtime and integration only").
 *
 * `node-llama-cpp` is a dev dependency, so nothing of it reaches `app.asar`. The host resolves it from
 * its own `node_modules` beside `ai-host.cjs`, which `scripts/prepare-ai-native-host.mjs` stages and
 * electron-builder ships as `resources/native-hosts/ai`. This gate proves that tree is complete and
 * self-sufficient, not merely present:
 *
 *   A. Staging into a temp directory OUTSIDE the repository, so Node's module lookup can never climb
 *      into the repository's `node_modules` and pass on a runtime the installer does not carry. Every
 *      file is listed in the staged manifest with its size and SHA-256 and every listed file is on
 *      disk; the host and the native addon are byte-identical to their sources; only the CPU prebuilt
 *      is staged; every declared runtime dependency resolves inside the staged tree.
 *   B. The staged runtime loads (`getLlama`, CPU, never build, never download) from that isolated copy,
 *      and two negative controls prove the probe cannot fall back to anything else: without the CPU
 *      prebuilt, and without one JavaScript dependency, it must fail.
 *   C. The production `AiUtilityHostManager` handshakes with the staged host in a real Electron utility
 *      process and the host reports the pinned build.
 *   D. With the pinned Qwen3.5-0.8B pack in ~/Downloads: the live harness (constrained decoding,
 *      cancellation, crash recovery, shutdown) runs on the staged copy. NOT RUN without the pack.
 *   E. `dist/win-unpacked/resources/native-hosts/ai`: integrity against its own manifest, identity with
 *      the current source's staging, and B/C on an isolated copy of it. NOT RUN when no packaged tree
 *      carries the runtime; stale when it is not the current source's staging.
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

const MANIFEST_NAME = "ai-native-host-manifest.json";
const ADDON = "node_modules/@node-llama-cpp/win-x64/bins/win-x64/llama-addon.node";
const PACK_NAME = "Qwen3.5-0.8B-Q4_K_M.gguf";
/** A dependency `node-llama-cpp`'s entry imports at load time; removing it must break the probe. */
const CONTROL_DEPENDENCY = "lifecycle-utils";

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

/** Section A's assertions, for any tree that claims to be the staged runtime. */
function assertStagedTree(dir: string, label: string): StagedManifest | null {
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
    const out = { ok: true, resolved, gpu: llama.gpu };
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

// ── Run ──────────────────────────────────────────────────────────────────────────────────────────

console.log("verify:ai-packaged-runtime — the pinned local-AI runtime as the installer carries it\n");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-ai-staged-"));
const staged = path.join(scratch, "ai");
const cleanup: string[] = [scratch];
let harnessDir: string | null = null;

try {
  console.log("A. Staging into an isolated directory");
  const ancestors: string[] = [];
  for (let dir = scratch; path.dirname(dir) !== dir; dir = path.dirname(dir)) ancestors.push(path.dirname(dir));
  const leaks = ancestors.filter((dir) => fs.existsSync(path.join(dir, "node_modules", "node-llama-cpp")));
  check("precondition: no directory above the staging root can supply node-llama-cpp", leaks.length === 0, leaks.join(", "));

  const stageRun = spawnSync(process.execPath, [path.join(ROOT, "scripts", "prepare-ai-native-host.mjs"), "--out", staged], { cwd: ROOT, encoding: "utf8", timeout: 300_000 });
  check("scripts/prepare-ai-native-host.mjs stages the runtime (exit 0)", stageRun.status === 0, `${stageRun.status}: ${`${stageRun.stderr ?? ""}${stageRun.error?.message ?? ""}`.trim().slice(0, 400)}`);
  const stagedManifest = stageRun.status === 0 ? assertStagedTree(staged, "staged") : null;

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

  console.log("\nE. The packaged tree (dist/win-unpacked)");
  const packaged = path.join(ROOT, "dist", "win-unpacked", "resources", "native-hosts", "ai");
  if (!fs.existsSync(packaged)) {
    skip("packaged runtime", "dist/win-unpacked carries no native-hosts/ai — run `npm run package:portable`");
  } else {
    const packagedManifest = assertStagedTree(packaged, "packaged");
    const identity = (m: StagedManifest | null) => JSON.stringify((m?.assets ?? []).map((a) => [a.relativePath, a.size, a.sha256]).sort());
    const current = Boolean(packagedManifest && stagedManifest && identity(packagedManifest) === identity(stagedManifest));
    if (!current) {
      skip("packaged runtime on an isolated copy", "STALE: the packaged tree is not the current source's staging — re-run `npm run package:portable`");
    } else {
      check("packaged: the tree is exactly the current source's staging", true);
      const isolated = path.join(scratch, "packaged-ai");
      copyTree(packaged, isolated);
      if (!harnessDir) {
        harnessDir = await buildAiHarness();
        cleanup.push(harnessDir);
      }
      await assertRuntimeRuns(isolated, "packaged", harnessDir, false);
    }
  }
} finally {
  for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed${notRun.length > 0 ? `, NOT RUN: ${notRun.join("; ")}` : ""}`);
process.exit(failed === 0 && passed > 0 ? 0 : 1);
