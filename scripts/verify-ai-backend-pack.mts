/**
 * verify:ai-backend-pack — Phase L L8a.2 GPU backend-pack import, registration and load-time guard.
 *
 * Runs `AiBackendPackStore` against real temporary folders: small synthetic packs with an injected
 * manifest entry and an injected app runtime for the refusal matrix, then the REAL pinned Vulkan pack
 * (the 24 manifest files of the installed @node-llama-cpp/win-x64-vulkan) with the REAL trust chain:
 * the Ed25519-signed dependency manifest and this build's staged Visual C++ runtime.
 *
 * What makes it fail: a missing, modified, resized, renamed, wrong-build or wrong-backend pack, an extra
 * executable or native library, a runtime DLL supplied by the pack, a link or junction, an unsafe
 * manifest path or too many entries being admitted; a refusal, cancellation or failed promotion
 * leaving staging behind or disturbing the installed pack; the runtime beside the backend coming from
 * anywhere but the app; a registry holding an absolute or source path; a write escaping the backends
 * root; a tampered, truncated, deleted, planted or junction-swapped installed pack passing the load
 * guard, or passing again once its bytes are restored (the guard is sticky and never repairs); an
 * identical re-import copying anything; CPU inference depending on the pack.
 *
 * Run: npm run verify:ai-backend-pack
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { appendFile, copyFile, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AI_BACKEND_VC_RUNTIME,
  AiBackendPackStore,
  BACKEND_IMPORT_HEADROOM_BYTES,
  backendTrustSources,
  resolveBackendTrust,
  type AiBackendPackOptions,
  type BackendTrust,
  type VcRuntimeFile
} from "@src/ai/AiBackendPack";
import { AI_BACKEND_MANIFEST, AI_RUNTIME_PIN, type AiBackendManifestEntry } from "@src/offline/AiModelManifest";
import { readSignedDependencyManifest } from "@src/offline/SupplyChainIntegrity";

let passed = 0;
let failed = 0;
const notRun: string[] = [];

function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const BUILD = AI_RUNTIME_PIN.build!;
const VERSION = /^node-llama-cpp@(\d+\.\d+\.\d+)\+/.exec(BUILD)![1];
// A later release's build. Two packs for ONE build are the same pack, so replacement is across builds.
const BUILD_B = "node-llama-cpp@9.9.9+llama.cpp@v9.9.9";
const VERSION_B = "9.9.9";
const BINS = "bins/win-x64-vulkan";
const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const native = (bytes: number): Buffer => Buffer.concat([Buffer.from("MZ"), randomBytes(bytes - 2)]);
const json = (value: unknown): string => JSON.stringify(value);

type Pack = Map<string, Buffer>;

function synthPack(version = VERSION): Pack {
  return new Map<string, Buffer>([
    ["LICENSE", Buffer.from("MIT License\n")],
    ["package.json", Buffer.from(json({ name: "@node-llama-cpp/win-x64-vulkan", version }))],
    ["dist/index.js", Buffer.from("export const binsDir = 'bins';\n")],
    [`${BINS}/llama-addon.node`, native(64 * 1024)],
    [`${BINS}/ggml-vulkan.dll`, native(192 * 1024)],
    [`${BINS}/ggml-base.dll`, native(32 * 1024)]
  ]);
}

function entryOf(pack: Pack, version = VERSION): AiBackendManifestEntry {
  return {
    id: "vulkan",
    package: "@node-llama-cpp/win-x64-vulkan",
    packageVersion: version,
    files: [...pack].map(([path, bytes]) => ({ path, size: bytes.length, sha256: sha(bytes) }))
  };
}

function flipSync(path: string, at = 100): void {
  const bytes = readFileSync(path);
  bytes[at] ^= 0xff;
  writeFileSync(path, bytes);
}

/** Entries under `dir`, relative and POSIX, via lstat (never following a link); directories too unless `filesOnly`. */
async function walk(dir: string, filesOnly: boolean, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const name of await readdir(dir)) {
    const info = await lstat(join(dir, name));
    const rel = prefix ? `${prefix}/${name}` : name;
    if (info.isDirectory()) {
      if (!filesOnly) out.push(rel);
      out.push(...(await walk(join(dir, name), filesOnly, rel)));
    } else {
      out.push(rel);
    }
  }
  return out.sort();
}

const listFiles = (dir: string): Promise<string[]> => walk(dir, true);

async function writePack(dir: string, pack: Pack): Promise<string> {
  await rm(dir, { recursive: true, force: true });
  for (const [path, bytes] of pack) {
    const target = join(dir, ...path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  return dir;
}

async function flip(path: string, at = 100): Promise<void> {
  const bytes = await readFile(path);
  bytes[at] ^= 0xff;
  await writeFile(path, bytes);
}

/** Every entry under `dir`, relative, recursively. */
async function listAll(dir: string): Promise<string[]> {
  return existsSync(dir) ? walk(dir, false) : [];
}

const work = await mkdtemp(join(tmpdir(), "awkit-ai-backend-"));
const outside = join(work, "outside");
await mkdir(outside);

// The app's own runtime, as the trust resolver would hand it over: separate bytes from any pack file.
const appHost = join(work, "app-host");
await mkdir(appHost);
const vcFiles: VcRuntimeFile[] = [];
for (const name of AI_BACKEND_VC_RUNTIME) {
  const bytes = native(24 * 1024);
  await writeFile(join(appHost, name), bytes);
  vcFiles.push({ name, size: bytes.length, sha256: sha(bytes), source: join(appHost, name) });
}
const TRUST: BackendTrust = { ok: true, vcRuntime: vcFiles };

const packA = synthPack();
const entryA = entryOf(packA);
const packB = synthPack(VERSION_B); // a later release's pack: same layout, another build
const entryB = entryOf(packB, VERSION_B);
const packBytes = (entry: AiBackendManifestEntry): number => entry.files.reduce((s, f) => s + f.size, 0);
const vcBytes = vcFiles.reduce((s, f) => s + f.size, 0);

function store(root: string, over: Partial<AiBackendPackOptions> = {}): AiBackendPackStore {
  return new AiBackendPackStore({ root, entry: entryA, runtimeBuild: BUILD, trust: async () => TRUST, freeBytes: async () => 50 * 1024 ** 3, ...over });
}

/** The store of the later release, whose manifest pins pack B. */
const storeB = (root: string, over: Partial<AiBackendPackOptions> = {}): AiBackendPackStore => store(root, { entry: entryB, runtimeBuild: BUILD_B, ...over });

let rootSeq = 0;
const freshRoot = (): string => join(work, `backends-${(rootSeq += 1)}`);

try {
  // ── A. The selected folder ────────────────────────────────────────────────────────────────────
  console.log("A. Validating a selected folder (nothing loaded, nothing written on refusal):\n");
  {
    const root = freshRoot();
    const s = store(root);
    const src = await writePack(join(work, "src-valid"), packA);
    const ok = await s.preflight(src);
    check("a complete pack is ready", ok.ready && ok.code === null, json(ok.checks));
    check("every check passed", ok.checks.length === 9 && ok.checks.every((c) => c.state === "pass"), json(ok.checks.map((c) => `${c.id}:${c.state}`)));
    check("all files were hashed and counted", ok.filesValidated === entryA.files.length && ok.fileCount === entryA.files.length);
    check("the size needed includes the app's runtime", ok.requiredBytes === packBytes(entryA) + vcBytes, `${ok.requiredBytes}`);
    check("headroom is reported", ok.headroomBytes === BACKEND_IMPORT_HEADROOM_BYTES);
    check("the destination is inside the backends root", ok.destination.startsWith(root));
    check("no identical pack is installed yet", ok.identicalInstalled === false);

    const cases: Array<[string, (dir: string) => Promise<void>, string, string | null]> = [
      ["a missing file", (d) => rm(join(d, "dist", "index.js")), "MISSING_FILE", "dist/index.js"],
      ["a same-size modification", (d) => flip(join(d, ...`${BINS}/ggml-vulkan.dll`.split("/"))), "HASH_MISMATCH", `${BINS}/ggml-vulkan.dll`],
      ["a resized file", (d) => appendFile(join(d, "LICENSE"), "x"), "SIZE_MISMATCH", "LICENSE"],
      ["a renamed file", (d) => rename(join(d, ...`${BINS}/ggml-base.dll`.split("/")), join(d, ...`${BINS}/ggml-base2.dll`.split("/"))), "UNEXPECTED_NATIVE_FILE", `${BINS}/ggml-base2.dll`],
      ["a pack for another build", (d) => writeFile(join(d, "package.json"), json({ name: "@node-llama-cpp/win-x64-vulkan", version: "3.20.0" })), "WRONG_BUILD", "package.json"],
      ["a pack for another backend", (d) => writeFile(join(d, "package.json"), json({ name: "@node-llama-cpp/win-x64-cuda", version: VERSION })), "WRONG_BACKEND", "package.json"],
      ["an extra DLL", (d) => writeFile(join(d, ...`${BINS}/evil.dll`.split("/")), native(4096)), "UNEXPECTED_NATIVE_FILE", `${BINS}/evil.dll`],
      ["a native image disguised as text", (d) => writeFile(join(d, "notes.txt"), native(4096)), "UNEXPECTED_NATIVE_FILE", "notes.txt"],
      ["a runtime DLL supplied by the pack", (d) => writeFile(join(d, ...`${BINS}/msvcp140.dll`.split("/")), native(4096)), "UNEXPECTED_NATIVE_FILE", `${BINS}/msvcp140.dll`],
      ["an extra script", (d) => writeFile(join(d, "dist", "hook.mjs"), "export {}"), "UNEXPECTED_NATIVE_FILE", "dist/hook.mjs"],
      ["an extra plain file", (d) => writeFile(join(d, "README.md"), "# readme"), "UNEXPECTED_FILE", "README.md"],
      ["an extra empty folder", (d) => mkdir(join(d, "extra")), "UNEXPECTED_FILE", "extra"],
      [
        "a junction inside the pack",
        async (d) => {
          const real = join(outside, `bins-${randomBytes(3).toString("hex")}`);
          await rename(join(d, "bins"), real);
          await symlink(real, join(d, "bins"), "junction");
        },
        "REPARSE_POINT",
        "bins"
      ],
      [
        "too many entries",
        async (d) => {
          await mkdir(join(d, "flood"));
          for (let i = 0; i < 520; i += 1) await writeFile(join(d, "flood", `${i}.txt`), "x");
        },
        "TOO_MANY_ENTRIES",
        null
      ]
    ];
    for (const [label, mutate, code, path] of cases) {
      const dir = await writePack(join(work, `src-${label.replace(/\W+/g, "-")}`), packA);
      await mutate(dir);
      const pre = await s.preflight(dir);
      check(`${label}: the checklist refuses it as ${code}`, !pre.ready && pre.code === code && pre.path === path, `${pre.code} ${pre.path}`);
      const result = await s.import(dir);
      check(`${label}: import refuses it too`, !result.ok && result.code === code, json(result));
    }

    // A file symlink needs a privilege this account may not hold; a junction covers the same rule above.
    const fileLink = await writePack(join(work, "src-file-symlink"), packA);
    await rm(join(fileLink, "LICENSE"));
    await writeFile(join(outside, "LICENSE"), packA.get("LICENSE")!);
    const linked = await symlink(join(outside, "LICENSE"), join(fileLink, "LICENSE"), "file").then(
      () => true,
      () => false
    );
    if (linked) {
      const pre = await s.preflight(fileLink);
      check("a file symlink to identical bytes outside is refused (REPARSE_POINT)", pre.code === "REPARSE_POINT" && pre.path === "LICENSE", `${pre.code}`);
    } else {
      notRun.push("file symlink case: this account cannot create symbolic links (the junction case covers the rule)");
    }

    const junctionRoot = join(work, "src-root-junction");
    await symlink(src, junctionRoot, "junction");
    check("a selected folder that is itself a junction is refused", (await s.preflight(junctionRoot)).code === "REPARSE_POINT");
    check("a file is not a folder", (await s.preflight(join(src, "LICENSE"))).code === "NOT_A_FOLDER");
    check("a missing folder is not a folder", (await s.preflight(join(work, "nope"))).code === "NOT_A_FOLDER");

    const traversal = { ...entryA, files: [...entryA.files, { path: "../evil.dll", size: 10, sha256: "0".repeat(64) }] };
    const absolute = { ...entryA, files: [...entryA.files, { path: "C:/evil.dll", size: 10, sha256: "0".repeat(64) }] };
    for (const [label, entry] of [["a traversal path", traversal], ["an absolute path", absolute]] as const) {
      const bad = store(root, { entry });
      check(`a manifest entry with ${label} admits nothing (preflight)`, (await bad.preflight(src)).code === "NOT_IN_MANIFEST");
      check(`a manifest entry with ${label} admits nothing (import)`, !(await bad.import(src)).ok);
    }
    check("after every refusal the backends root holds no pack, staging or registry", (await listAll(root)).length === 0, (await listAll(root)).join(","));
  }

  // ── B. What the app itself supplies ───────────────────────────────────────────────────────────
  console.log("\nB. Trust inputs and disk space:\n");
  {
    const root = freshRoot();
    const src = await writePack(join(work, "src-b"), packA);
    const unsigned = store(root, { trust: async () => ({ ok: false, code: "SIGNED_MANIFEST_UNVERIFIED", detail: "test" }) });
    const pre = await unsigned.preflight(src);
    check("an unverified signed manifest fails the checklist", !pre.ready && pre.code === "SIGNED_MANIFEST_UNVERIFIED" && pre.checks.find((c) => c.id === "signed")?.state === "fail");
    check("...and the import", (await unsigned.import(src)).ok === false);
    const noRuntime = store(root, { trust: async () => ({ ok: false, code: "VC_RUNTIME_UNVERIFIED", detail: "msvcp140.dll" }) });
    const pre2 = await noRuntime.preflight(src);
    check("an unverified app runtime fails the checklist", pre2.code === "VC_RUNTIME_UNVERIFIED" && pre2.checks.find((c) => c.id === "runtime")?.state === "fail");

    // The runtime's bytes are re-hashed while copied: a declared hash the source does not have is refused.
    const lying: BackendTrust = { ok: true, vcRuntime: vcFiles.map((f, i) => (i === 1 ? { ...f, sha256: "1".repeat(64) } : f)) };
    const lied = await store(root, { trust: async () => lying }).import(src);
    check("an app runtime file whose bytes differ from its trusted hash is refused while copying", !lied.ok && lied.code === "VC_RUNTIME_UNVERIFIED", json(lied));

    const need = packBytes(entryA) + vcBytes + BACKEND_IMPORT_HEADROOM_BYTES;
    const tight = store(root, { freeBytes: async () => need - 1 });
    const pre3 = await tight.preflight(src);
    check("one byte short of pack + runtime + headroom fails the space check", !pre3.ready && pre3.code === "INSUFFICIENT_SPACE" && pre3.availableBytes === need - 1);
    check("...and the import refuses before copying", (await tight.import(src)).ok === false);
    check("exactly enough space passes", (await store(root, { freeBytes: async () => need }).preflight(src)).ready);
    check("unmeasurable free space is refused, not assumed", (await store(root, { freeBytes: async () => null }).import(src)).ok === false);
    check("no staging was ever created for these refusals", !(await listAll(root)).some((p) => p.startsWith(".staging-")), (await listAll(root)).join(","));
  }

  // ── C. A valid import ─────────────────────────────────────────────────────────────────────────
  console.log("\nC. Import, registration and confinement:\n");
  const rootC = freshRoot();
  const srcA = await writePack(join(work, "src-a"), packA);
  {
    const s = store(rootC);
    const result = await s.import(srcA);
    check("a validated pack imports", result.ok && !result.unchanged, json(result));
    const dir = result.ok ? result.dir : "";
    check("into a versioned directory", /^vulkan-\d+\.\d+\.\d+-[a-z0-9]+$/.test(dir) && dir.startsWith(`vulkan-${VERSION}-`), dir);
    const status = await s.status();
    check("status reads installed", status.status === "installed", json(status));
    const rec = status.status === "installed" ? status.record : null;
    check("the record counts the pack and the app runtime", rec?.fileCount === entryA.files.length + 3 && rec?.sizeBytes === packBytes(entryA) + vcBytes);
    const differing: string[] = [];
    for (const [path, bytes] of packA) {
      if (!(await readFile(join(rootC, dir, ...path.split("/")))).equals(bytes)) differing.push(path);
    }
    check(`every one of the ${packA.size} pack files was copied byte for byte`, packA.size > 0 && differing.length === 0, differing.join(","));
    for (const vc of vcFiles) {
      const copied = await readFile(join(rootC, dir, ...BINS.split("/"), vc.name));
      check(`${vc.name} beside the backend is the app's own copy`, copied.equals(await readFile(vc.source)));
    }
    const registryText = await readFile(join(rootC, "registry.json"), "utf8");
    check("the registry holds no absolute path", !/[A-Za-z]:[\\/]|\\\\|^\//m.test(registryText) && !registryText.includes(work.replace(/\\/g, "\\\\")), registryText.slice(0, 200));
    check("the registry never names the source folder", !registryText.includes("src-a"));
    check("the registry names the directory, not a path", JSON.parse(registryText).active.dir === dir);
    const everything = await listAll(rootC);
    check("everything written stays inside the backends root", everything.every((p) => !relative(rootC, join(rootC, p)).startsWith("..") && !isAbsolute(p)));
    check("nothing but the registry and the pack is there", everything.filter((p) => !p.startsWith(`${dir}`)).join() === "registry.json", everything.filter((p) => !p.startsWith(dir)).join());
    check("the source folder is untouched", (await readFile(join(srcA, "LICENSE"))).equals(packA.get("LICENSE")!) && (await listAll(srcA)).length === (await listAll(await writePack(join(work, "src-a-ref"), packA))).length);
    const verdict = await s.verifyForLoad();
    check("the load guard admits it, naming the app-managed directory", verdict.ok && verdict.dir === join(rootC, dir), json(verdict));
    check("no progress is reported once finished", s.importProgress() === null);

    const again = await s.import(srcA);
    check("an identical re-import is idempotent", again.ok && again.unchanged && again.dir === dir, json(again));
    check("...and copies nothing", (await listAll(rootC)).join() === everything.join());
    check("the checklist then reports the identical pack", (await s.preflight(srcA)).identicalInstalled);

    // Path confinement against the app's own inputs: a runtime name that would leave the staging.
    const escapeRoot = freshRoot();
    const escaping: BackendTrust = { ok: true, vcRuntime: vcFiles.map((f, i) => (i === 0 ? { ...f, name: "../../../../escaped.dll" } : f)) };
    const escaped = await store(escapeRoot, { trust: async () => escaping }).import(srcA);
    check("a runtime file name escaping the staging is refused", !escaped.ok && escaped.code === "REPARSE_POINT", json(escaped));
    check("...and nothing was written outside the backends root", !existsSync(join(escapeRoot, "..", "escaped.dll")) && !existsSync(join(work, "escaped.dll")));
  }

  // ── D. Cancellation and crash recovery ────────────────────────────────────────────────────────
  console.log("\nD. Cancellation and interrupted staging:\n");
  {
    const root = freshRoot();
    const controller = new AbortController();
    const s = store(root, { hooks: { afterFile: () => controller.abort() } });
    const cancelled = await s.import(srcA, { signal: controller.signal });
    check("an import cancelled mid-copy reports CANCELLED", !cancelled.ok && cancelled.code === "CANCELLED", json(cancelled));
    check("...leaves no staging and no registry", (await listAll(root)).length === 0, (await listAll(root)).join(","));
    check("...and nothing is installed", (await store(root).status()).status === "not-installed");

    // A valid pack stays active while a replacement is cancelled.
    const withPack = freshRoot();
    const installed = await store(withPack).import(srcA);
    const srcB = await writePack(join(work, "src-b-release"), packB);
    const c2 = new AbortController();
    const r2 = await storeB(withPack, { hooks: { afterFile: () => c2.abort() } }).import(srcB, { signal: c2.signal });
    check("a cancelled replacement is refused", !r2.ok && r2.code === "CANCELLED");
    const kept = await store(withPack).verifyForLoad();
    check("...and the previous pack is still active and verifies", kept.ok && installed.ok && kept.dir.endsWith(installed.dir), json(kept));

    // What a crash leaves behind: a staging folder, an unreferenced pack, a registry temp file.
    await mkdir(join(withPack, ".staging-999-abc-000000", "bins"), { recursive: true });
    await writeFile(join(withPack, ".staging-999-abc-000000", "bins", "half.dll"), native(1024));
    await mkdir(join(withPack, `vulkan-${VERSION}-orphan`));
    await writeFile(join(withPack, "registry.json.1.2.tmp"), "{");
    const sentinel = join(outside, "sentinel-dir");
    await mkdir(sentinel);
    await writeFile(join(sentinel, "keep.txt"), "must survive");
    await symlink(sentinel, join(withPack, ".staging-998-link-000000"), "junction");
    await store(withPack).recover();
    const left = (await readdir(withPack)).sort();
    check("recovery removes staging, orphans and temp files, keeping the active pack", installed.ok && left.join() === [installed.dir, "registry.json"].sort().join(), left.join());
    check("recovery removes a junction without following it", existsSync(join(sentinel, "keep.txt")));
    check("the active pack still verifies after recovery", (await store(withPack).verifyForLoad()).ok);

    await writeFile(join(withPack, "registry.json"), "{ not json");
    await mkdir(join(withPack, ".staging-1-x-000000"));
    await store(withPack).recover();
    const afterCorrupt = (await readdir(withPack)).sort();
    check("with an unreadable registry, recovery removes only staging and keeps every pack", installed.ok && afterCorrupt.includes(installed.dir) && !afterCorrupt.some((n) => n.startsWith(".staging-")), afterCorrupt.join());
  }

  // ── E. Replacement and rollback ───────────────────────────────────────────────────────────────
  console.log("\nE. Replacement and rollback:\n");
  {
    const setup = async (): Promise<{ root: string; dir: string }> => {
      const root = freshRoot();
      const r = await store(root).import(srcA);
      return { root, dir: r.ok ? r.dir : "" };
    };
    const intact = async (root: string, dir: string): Promise<boolean> => {
      const v = await store(root).verifyForLoad();
      const names = await readdir(root);
      return v.ok && v.dir.endsWith(dir) && !names.some((n) => n.startsWith(".staging-")) && names.filter((n) => n.startsWith("vulkan-")).length === 1;
    };
    const srcB = await writePack(join(work, "src-b-release2"), packB);

    {
      const { root, dir } = await setup();
      const badB = await writePack(join(work, "src-b-bad"), packB);
      const s = storeB(root, { hooks: { afterFile: (p) => (p === "LICENSE" ? flipSync(join(badB, ...`${BINS}/ggml-vulkan.dll`.split("/"))) : undefined) } });
      const r = await s.import(badB);
      check("a source changed after its structure check is refused while copying (HASH_MISMATCH)", !r.ok && r.code === "HASH_MISMATCH", json(r));
      check("...and the previous pack is untouched", await intact(root, dir));
    }
    {
      const { root, dir } = await setup();
      const s = storeB(root, { hooks: { afterStage: (staging) => flip(join(staging, ...`${BINS}/llama-addon.node`.split("/"))) } });
      const r = await s.import(srcB);
      check("a staged file altered before promotion fails revalidation (STAGED_MISMATCH)", !r.ok && r.code === "STAGED_MISMATCH" && r.path === `${BINS}/llama-addon.node`, json(r));
      check("...and the previous pack is untouched", await intact(root, dir));
    }
    {
      const { root, dir } = await setup();
      const s = storeB(root, { hooks: { afterStage: (staging) => writeFile(join(staging, ...`${BINS}/planted.dll`.split("/")), native(2048)) } });
      const r = await s.import(srcB);
      check("a DLL planted in the staging fails revalidation", !r.ok && r.code === "STAGED_MISMATCH" && r.path === `${BINS}/planted.dll`, json(r));
      check("...and the previous pack is untouched", await intact(root, dir));
    }
    {
      const { root, dir } = await setup();
      const s = storeB(root, {
        hooks: {
          beforePromote: async () => {
            throw new Error("simulated rename failure");
          }
        }
      });
      const r = await s.import(srcB);
      check("a failed promotion is refused (PROMOTE_FAILED)", !r.ok && r.code === "PROMOTE_FAILED", json(r));
      check("...and rolls back to the previous pack", await intact(root, dir));
    }
    {
      const { root, dir } = await setup();
      check("before replacing, the installed pack reads as another build's", (await storeB(root).status()).status === "invalid");
      const r = await storeB(root).import(srcB);
      check("a valid replacement imports", r.ok && !r.unchanged, json(r));
      check("...into a new directory, never over the active one", r.ok && r.dir !== dir && r.dir.startsWith(`vulkan-${VERSION_B}-`));
      check("...the previous pack's directory is removed", !existsSync(join(root, dir)));
      check("...and the registry points at the replacement", (await storeB(root).verifyForLoad()).ok);
      const old = await store(root).verifyForLoad();
      check("the old release's guard refuses the new build as INCOMPATIBLE", !old.ok && old.reason === "INCOMPATIBLE", json(old));
    }
  }

  // ── F. Tampering after import ─────────────────────────────────────────────────────────────────
  console.log("\nF. The load-time integrity guard:\n");
  {
    const installFresh = async (): Promise<{ root: string; dir: string; s: AiBackendPackStore }> => {
      const root = freshRoot();
      const s = store(root);
      const r = await s.import(srcA);
      return { root, dir: r.ok ? r.dir : "", s };
    };
    const at = (root: string, dir: string, path: string): string => join(root, dir, ...path.split("/"));

    {
      const { root, dir, s } = await installFresh();
      const target = at(root, dir, `${BINS}/ggml-vulkan.dll`);
      await flip(target);
      check("a same-size edit still passes the cheap status", (await s.status()).status === "installed");
      const v = await s.verifyForLoad();
      check("the guard refuses an altered file", !v.ok && v.reason === "HASH_MISMATCH" && v.path === `${BINS}/ggml-vulkan.dll`, json(v));
      check("the refusal keeps CPU inference as the fallback", !v.ok && v.fallback === "cpu" && v.message.length > 0 && v.message.length < 200);
      const st = await s.status();
      check("the pack is marked invalid with its reason", st.status === "invalid" && st.reason === "HASH_MISMATCH", json(st));
      check("nothing was repaired: the altered bytes are still on disk", !(await readFile(target)).equals(packA.get(`${BINS}/ggml-vulkan.dll`)!));
      await flip(target);
      check("restoring the bytes does not revive it (sticky until re-import)", !(await store(root).verifyForLoad()).ok);
      const again = await s.import(srcA);
      check("re-importing replaces the invalid pack", again.ok && !again.unchanged && again.dir !== dir, json(again));
      check("...which then verifies", (await s.verifyForLoad()).ok);
    }
    const tamper: Array<[string, (root: string, dir: string) => Promise<void>, string, string | null]> = [
      ["a deleted file", (r, d) => rm(at(r, d, "dist/index.js")), "MISSING_FILE", "dist/index.js"],
      ["a DLL planted beside the backend", (r, d) => writeFile(at(r, d, `${BINS}/vulkan-1.dll`), native(4096)), "UNEXPECTED_NATIVE_FILE", `${BINS}/vulkan-1.dll`],
      ["a replaced runtime DLL", (r, d) => writeFile(at(r, d, `${BINS}/vcruntime140.dll`), native(24 * 1024)), "HASH_MISMATCH", `${BINS}/vcruntime140.dll`],
      ["a truncated file", (r, d) => writeFile(at(r, d, "LICENSE"), "x"), "SIZE_MISMATCH", "LICENSE"],
      [
        "the pack directory swapped for a junction to an identical copy",
        async (r, d) => {
          const copy = join(outside, `pack-${randomBytes(3).toString("hex")}`);
          await rename(join(r, d), copy);
          await symlink(copy, join(r, d), "junction");
        },
        "REPARSE_POINT",
        null
      ],
      [
        "a registry pointing outside the backends root",
        async (r) => {
          const reg = JSON.parse(await readFile(join(r, "registry.json"), "utf8"));
          reg.active.dir = "../escape";
          await writeFile(join(r, "registry.json"), JSON.stringify(reg));
        },
        "REGISTRY_UNREADABLE",
        null
      ],
      ["a deleted registry", (r) => rm(join(r, "registry.json")), "NOT_INSTALLED", null]
    ];
    for (const [label, mutate, code, path] of tamper) {
      const { root, dir, s } = await installFresh();
      await mutate(root, dir);
      const v = await s.verifyForLoad();
      check(`${label} is refused (${code})`, !v.ok && v.reason === code && v.path === path && v.fallback === "cpu", json(v));
    }
    const { root: truncRoot, dir: truncDir, s: truncStore } = await installFresh();
    await writeFile(at(truncRoot, truncDir, "LICENSE"), "x");
    const cheap = await truncStore.status();
    check("the cheap status already reports a resized file", cheap.status === "invalid" && cheap.reason === "SIZE_MISMATCH" && cheap.path === "LICENSE", json(cheap));
  }

  // ── G. Removal, CPU independence, path handling ──────────────────────────────────────────────
  console.log("\nG. Removal, CPU fallback and packaged/development paths:\n");
  {
    const root = freshRoot();
    const s = store(root);
    const noPack = await s.verifyForLoad();
    check("with no pack the guard answers NOT_INSTALLED with a CPU fallback", !noPack.ok && noPack.reason === "NOT_INSTALLED" && noPack.fallback === "cpu");
    await s.import(srcA);
    await s.remove();
    check("remove unregisters the pack", (await s.status()).status === "not-installed");
    check("remove deletes its files", (await listAll(root)).join() === "registry.json", (await listAll(root)).join());
    await s.remove();
    check("remove is idempotent", (await s.status()).status === "not-installed");
    check("a store with no pinned entry is unavailable", (await store(root, { entry: null }).status()).status === "unavailable");

    check("the pin still ships the CPU backend", AI_RUNTIME_PIN.backends.includes("cpu"));
    const runtime = await readFile(join(ROOT, "app", "main", "ai", "aiRuntime.ts"), "utf8");
    const serviceBlock = /export function getAiService\([^]*?\n\}/.exec(runtime)?.[0] ?? "";
    check("the AI service (CPU inference) is built without the backend pack", serviceBlock.length > 0 && !/backend/i.test(serviceBlock));

    const packaged = backendTrustSources({ packaged: true, resourcesPath: "C:\\App\\resources", appPath: "C:\\App\\resources\\app.asar" });
    check("packaged: trust comes from resources\\resources and resources\\native-hosts\\ai", packaged.resourcesRoot === join("C:\\App\\resources", "resources") && packaged.hostRoot === join("C:\\App\\resources", "native-hosts", "ai"), json(packaged));
    const dev = backendTrustSources({ packaged: false, resourcesPath: "ignored", appPath: ROOT });
    check("development: trust comes from the repository and its staged host", dev.resourcesRoot === join(ROOT, "resources") && dev.hostRoot === join(ROOT, "build", "native-hosts", "ai"), json(dev));
  }

  // ── H. The real trust chain ───────────────────────────────────────────────────────────────────
  console.log("\nH. The signed dependency manifest and this build's runtime:\n");
  const production = AI_BACKEND_MANIFEST.find((e) => e.id === "vulkan") ?? null;
  check("the production manifest pins a Vulkan pack", production !== null && production.files.length === 24);
  const signed = await readSignedDependencyManifest(join(ROOT, "resources"));
  check("the committed dependency manifest's signature verifies", signed.ok, signed.ok ? undefined : signed.issues.join("; "));
  {
    const copy = join(work, "resources-tampered");
    await mkdir(join(copy, "trust"), { recursive: true });
    const bytes = await readFile(join(ROOT, "resources", "dependency-manifest.json"));
    bytes[bytes.length - 3] ^= 0x01;
    await writeFile(join(copy, "dependency-manifest.json"), bytes);
    await copyFile(join(ROOT, "resources", "dependency-manifest.sig"), join(copy, "dependency-manifest.sig"));
    await copyFile(join(ROOT, "resources", "trust", "offline-manifest-public.pem"), join(copy, "trust", "offline-manifest-public.pem"));
    const tampered = await readSignedDependencyManifest(copy);
    check("a one-byte change to the manifest is not trusted", !tampered.ok);
  }
  if (production && signed.ok) {
    const devSources = backendTrustSources({ packaged: false, resourcesPath: "", appPath: ROOT });
    const base = { signed, hostRoot: devSources.hostRoot, entry: production, runtimeBuild: BUILD };
    const altered = JSON.parse(JSON.stringify(signed.manifest));
    altered.aiGpuBackends.backends[0].files[3].sha256 = "0".repeat(64);
    check("a built-in entry that disagrees with the signed copy is refused", (await resolveBackendTrust({ ...base, signed: { ok: true, manifest: altered } })).ok === false);
    const noAsset = JSON.parse(JSON.stringify(signed.manifest));
    noAsset.aiRuntime.assets = noAsset.aiRuntime.assets.filter((a: { relativePath: string }) => !a.relativePath.endsWith("/win-x64/msvcp140.dll"));
    const missing = await resolveBackendTrust({ ...base, signed: { ok: true, manifest: noAsset } });
    check("a runtime DLL the signed manifest does not list is unavailable", !missing.ok && missing.code === "VC_RUNTIME_UNAVAILABLE", json(missing));
    check("an unverified signature trusts nothing", (await resolveBackendTrust({ ...base, signed: { ok: false, issues: ["x"] } })).ok === false);

    if (existsSync(devSources.hostRoot)) {
      const wrongHash = JSON.parse(JSON.stringify(signed.manifest));
      const asset = wrongHash.aiRuntime.assets.find((a: { relativePath: string }) => a.relativePath.endsWith("/win-x64/vcruntime140.dll"));
      asset.sha256 = "0".repeat(64);
      const unverified = await resolveBackendTrust({ ...base, signed: { ok: true, manifest: wrongHash } });
      check("a staged runtime DLL that differs from its signed hash is unverified", !unverified.ok && unverified.code === "VC_RUNTIME_UNVERIFIED", json(unverified));
      const devTrust = await resolveBackendTrust(base);
      check("development: this build's staged runtime verifies against the signed manifest", devTrust.ok && devTrust.vcRuntime.map((v) => v.name).join() === AI_BACKEND_VC_RUNTIME.join(), json(devTrust));

      // ── I. The real pinned pack, end to end ──────────────────────────────────────────────────
      console.log("\nI. The real pinned Vulkan pack:\n");
      const installedPkg = join(ROOT, "node_modules", "@node-llama-cpp", "win-x64-vulkan");
      if (existsSync(installedPkg) && devTrust.ok) {
        const real = join(work, "real-pack");
        for (const file of production.files) {
          const target = join(real, ...file.path.split("/"));
          await mkdir(dirname(target), { recursive: true });
          await copyFile(join(installedPkg, ...file.path.split("/")), target);
        }
        const root = freshRoot();
        const s = new AiBackendPackStore({ root, entry: production, runtimeBuild: BUILD, trust: () => resolveBackendTrust(base) });
        const pre = await s.preflight(real);
        check("the real 24-file pack is ready", pre.ready && pre.filesValidated === 24, json(pre.checks.filter((c) => c.state !== "pass")));
        const r = await s.import(real);
        check("it imports", r.ok, json(r));
        const v = await s.verifyForLoad();
        check("the load guard admits it", v.ok, json(v));
        const files = r.ok ? await listFiles(join(root, r.dir)) : [];
        const expectedFiles = [...production.files.map((f) => f.path), ...AI_BACKEND_VC_RUNTIME.map((n) => `bins/win-x64-vulkan/${n}`)].sort();
        check("the installed pack holds exactly its 24 files plus the app's 3 runtime DLLs", files.join() === expectedFiles.join(), `${files.length} files`);
        for (const vc of devTrust.vcRuntime) {
          const copied = await readFile(join(root, r.ok ? r.dir : "x", "bins", "win-x64-vulkan", vc.name));
          check(`${vc.name} is byte-identical to this build's staged copy`, copied.equals(await readFile(vc.source)));
        }
        const raw = await s.preflight(installedPkg);
        check("the raw npm package folder (README and import library) is refused", !raw.ready && (raw.code === "UNEXPECTED_FILE" || raw.code === "UNEXPECTED_NATIVE_FILE"), `${raw.code} ${raw.path}`);
      } else {
        notRun.push(`real pack end to end: ${installedPkg} is not installed`);
      }
    } else {
      notRun.push(`development trust and real pack: ${devSources.hostRoot} is not staged (run package:portable or prepare-ai-native-host)`);
    }

    const unpacked = join(ROOT, "dist", "win-unpacked", "resources");
    if (existsSync(join(unpacked, "resources", "dependency-manifest.json"))) {
      const pkgSources = backendTrustSources({ packaged: true, resourcesPath: unpacked, appPath: join(unpacked, "app.asar") });
      const pkgTrust = await resolveBackendTrust({
        signed: await readSignedDependencyManifest(pkgSources.resourcesRoot),
        hostRoot: pkgSources.hostRoot,
        entry: production,
        runtimeBuild: BUILD
      });
      check("packaged layout (dist/win-unpacked): the shipped runtime verifies against the shipped signed manifest", pkgTrust.ok, json(pkgTrust));
    } else {
      notRun.push("packaged layout: dist/win-unpacked is not present");
    }
  }
} finally {
  await rm(work, { recursive: true, force: true }).catch(() => undefined);
}

for (const item of notRun) console.log(`  · NOT RUN: ${item}`);
console.log(`\n${passed} passed, ${failed} failed${notRun.length ? `, ${notRun.length} not run` : ""}`);
process.exit(failed === 0 ? 0 : 1);
