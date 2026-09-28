/**
 * GPU backend pack import (Phase L, L8a.2): validation, staged copy, registration and the load-time
 * integrity guard for the user-supplied backend pack that `AI_BACKEND_MANIFEST` pins file by file.
 *
 * The main process picks the folder (the renderer never supplies a path). Nothing in that folder is
 * ever loaded, executed or probed: it is walked with `lstat`, every entry's real path must stay inside
 * the selected root (a link, junction or other reparse point is refused), the file set must be exactly
 * the manifest's (an unlisted executable or native library is named as such), and each file must have
 * its listed size and SHA-256.
 *
 * Import copies into a temporary staging folder beside the installed packs, hashing exactly the bytes
 * it writes, then copies the APPLICATION'S OWN Visual C++ runtime beside the binaries (checked against
 * the Ed25519-signed dependency manifest; a runtime DLL in the selected pack is an unexpected file),
 * re-walks and re-hashes the whole staging, and only then renames it to a new versioned directory and
 * points the registry at it. Any failure before that registry write leaves the previous pack active
 * and removes the staging; an installed pack is never overwritten in place. Stale staging from a
 * crash is removed by `recover`.
 *
 * The registry keeps only the app-managed directory NAME and the pack's status, never a source or an
 * absolute path. `verifyForLoad` is the boundary L8a.3 must call before every backend load: it
 * re-walks and re-hashes the installed pack, and on any missing, altered, extra or replaced file it
 * refuses, marks the pack invalid (sticky until re-import or removal) and answers with a reason and a
 * CPU fallback. It never repairs anything.
 *
 * All of it lives under the runtime data root, never in resources or app.asar.
 * Framework-agnostic: node:fs, node:path and node:crypto only.
 */

import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, realpath as realpathCallback } from "node:fs";
import { lstat, mkdir, open, readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, posix, relative } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

import { isValidAiBackendManifestEntry, type AiBackendFile, type AiBackendManifestEntry, type AiGpuBackend } from "../offline/AiModelManifest";
import { replaceFileAtomically } from "../storage/atomicReplace";
import { runExclusive } from "../storage/folderWriteCoordinator";
import { measureFreeBytes, sha256File } from "./AiModelPack";

/** The Visual C++ runtime every pack binary imports (L8a.0). Always the app's own copies, never the pack's. */
export const AI_BACKEND_VC_RUNTIME: readonly string[] = Object.freeze(["msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll"]);
/** Where the installer's CPU runtime keeps its validated copies, relative to the staged AI host root. */
const CPU_RUNTIME_BINS = "node_modules/@node-llama-cpp/win-x64/bins/win-x64";
/** Free space kept beyond the copy itself: the old pack and the staging coexist until promotion. */
export const BACKEND_IMPORT_HEADROOM_BYTES = 256 * 1024 ** 2;
const MAX_ENTRIES = 512;
const SHA256 = /^[0-9a-f]{64}$/;
const PACK_DIR = /^[a-z0-9]+-\d+\.\d+\.\d+-[a-z0-9]+$/;
const NATIVE_NAME = /\.(dll|node|exe|sys|so|dylib|com|bat|cmd|ps1|vbs|msi|scr|cpl|ocx|drv|efi|js|cjs|mjs|lib|pdb)$/i;
const realpathNative = promisify(realpathCallback.native);

export type AiBackendRefusal =
  | "NOT_IN_MANIFEST"
  | "NOT_A_FOLDER"
  | "REPARSE_POINT"
  | "TOO_MANY_ENTRIES"
  | "WRONG_BACKEND"
  | "WRONG_BUILD"
  | "UNEXPECTED_NATIVE_FILE"
  | "UNEXPECTED_FILE"
  | "MISSING_FILE"
  | "SIZE_MISMATCH"
  | "HASH_MISMATCH"
  | "SIGNED_MANIFEST_UNVERIFIED"
  | "SIGNED_MANIFEST_MISMATCH"
  | "VC_RUNTIME_UNAVAILABLE"
  | "VC_RUNTIME_UNVERIFIED"
  | "INSUFFICIENT_SPACE"
  | "CANCELLED"
  | "COPY_FAILED"
  | "STAGED_MISMATCH"
  | "PROMOTE_FAILED"
  | "NOT_INSTALLED"
  | "INCOMPATIBLE"
  | "REGISTRY_UNREADABLE";

const MESSAGES: Record<AiBackendRefusal, string> = {
  NOT_IN_MANIFEST: "This version of SpecterStudio accepts no GPU backend pack",
  NOT_A_FOLDER: "The selected item is not a folder",
  REPARSE_POINT: "The pack contains a link, junction or other reparse point, or a file that resolves outside it",
  TOO_MANY_ENTRIES: "The selected folder holds far more files than a backend pack",
  WRONG_BACKEND: "This pack is for a different GPU backend",
  WRONG_BUILD: "This pack is for a different runtime build",
  UNEXPECTED_NATIVE_FILE: "The pack contains an executable or native library the manifest does not list",
  UNEXPECTED_FILE: "The pack contains a file the manifest does not list",
  MISSING_FILE: "A required file is missing",
  SIZE_MISMATCH: "A file does not have its listed size",
  HASH_MISMATCH: "A file failed its SHA-256 check",
  SIGNED_MANIFEST_UNVERIFIED: "The app's signed dependency manifest could not be verified, so nothing can be imported",
  SIGNED_MANIFEST_MISMATCH: "The built-in backend manifest does not match the signed dependency manifest",
  VC_RUNTIME_UNAVAILABLE: "This build's own Visual C++ runtime is not available",
  VC_RUNTIME_UNVERIFIED: "This build's own Visual C++ runtime failed verification",
  // Never end a main-process string with the word "import" before its quote: electron-vite's ESM shim
  // regex reads `import",…"` as an import statement and splices its shim into the literal.
  INSUFFICIENT_SPACE: "There is not enough free disk space to copy the pack",
  CANCELLED: "The import was cancelled and nothing was changed",
  COPY_FAILED: "The pack could not be copied into the app's data folder",
  STAGED_MISMATCH: "The copied files failed re-verification, so nothing was installed",
  PROMOTE_FAILED: "The verified copy could not be activated, so the previous state was kept",
  NOT_INSTALLED: "No GPU backend pack is installed",
  INCOMPATIBLE: "The installed pack is for another runtime build; import the pack for this version",
  REGISTRY_UNREADABLE: "The backend pack registry is unreadable"
};

/** One short, safe sentence; the only path it may name is a file inside the pack. */
export function backendRefusalMessage(code: AiBackendRefusal, path?: string | null): string {
  return path ? `${MESSAGES[code]}: ${path}.` : `${MESSAGES[code]}.`;
}

// ── Trust: the signed manifest and the application's own Visual C++ runtime ─────────────────────

export interface VcRuntimeFile {
  name: string;
  size: number;
  sha256: string;
  /** Absolute path of the app's own copy. Main-process only; never persisted or sent to a renderer. */
  source: string;
}

export type BackendTrust =
  | { ok: true; vcRuntime: readonly VcRuntimeFile[] }
  | { ok: false; code: "SIGNED_MANIFEST_UNVERIFIED" | "SIGNED_MANIFEST_MISMATCH" | "VC_RUNTIME_UNAVAILABLE" | "VC_RUNTIME_UNVERIFIED"; detail: string };

/** Where the trust inputs live: the packaged `resources`, or the repository and its staged host in development. */
export function backendTrustSources(layout: { packaged: boolean; resourcesPath: string; appPath: string }): { resourcesRoot: string; hostRoot: string } {
  return layout.packaged
    ? { resourcesRoot: join(layout.resourcesPath, "resources"), hostRoot: join(layout.resourcesPath, "native-hosts", "ai") }
    : { resourcesRoot: join(layout.appPath, "resources"), hostRoot: join(layout.appPath, "build", "native-hosts", "ai") };
}

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

function sameFiles(a: readonly AiBackendFile[], b: unknown): boolean {
  if (!Array.isArray(b) || a.length !== b.length) return false;
  const byPath = new Map(a.map((file) => [file.path, file]));
  return b.every((item) => {
    const file = record(item);
    const want = typeof file?.path === "string" ? byPath.get(file.path) : undefined;
    return want !== undefined && file?.size === want.size && file?.sha256 === want.sha256;
  });
}

/**
 * What the import may trust, from a manifest the caller has ALREADY signature-verified
 * (`readSignedDependencyManifest`). The built-in backend entry must equal the signed `aiGpuBackends`
 * copy, and the Visual C++ runtime is the app's own set beside the CPU runtime, each file matching the
 * signed `aiRuntime` size and SHA-256.
 */
export async function resolveBackendTrust(input: {
  signed: { ok: true; manifest: unknown } | { ok: false; issues: string[] };
  hostRoot: string;
  entry: AiBackendManifestEntry;
  runtimeBuild: string;
}): Promise<BackendTrust> {
  if (!input.signed.ok) return { ok: false, code: "SIGNED_MANIFEST_UNVERIFIED", detail: input.signed.issues[0] ?? "unverified" };
  const manifest = record(input.signed.manifest);
  const gpu = record(manifest?.aiGpuBackends);
  const signedEntry = Array.isArray(gpu?.backends) ? gpu.backends.map(record).find((b) => b?.id === input.entry.id) : undefined;
  if (
    gpu?.runtimeBuild !== input.runtimeBuild ||
    !signedEntry ||
    signedEntry.package !== input.entry.package ||
    signedEntry.packageVersion !== input.entry.packageVersion ||
    !sameFiles(input.entry.files, signedEntry.files)
  ) {
    return { ok: false, code: "SIGNED_MANIFEST_MISMATCH", detail: `backend ${input.entry.id}` };
  }
  const runtime = record(manifest?.aiRuntime);
  if (runtime?.runtimeBuild !== input.runtimeBuild || !Array.isArray(runtime.assets)) {
    return { ok: false, code: "SIGNED_MANIFEST_MISMATCH", detail: "aiRuntime" };
  }
  const assets = runtime.assets.map(record);
  const files: VcRuntimeFile[] = [];
  for (const name of AI_BACKEND_VC_RUNTIME) {
    const asset = assets.find((a) => a?.relativePath === `native-hosts/ai/${CPU_RUNTIME_BINS}/${name}`);
    if (!asset || !Number.isInteger(asset.size) || typeof asset.sha256 !== "string" || !SHA256.test(asset.sha256)) {
      return { ok: false, code: "VC_RUNTIME_UNAVAILABLE", detail: `${name} is not in the signed manifest` };
    }
    const source = join(input.hostRoot, ...CPU_RUNTIME_BINS.split("/"), name);
    const info = await stat(source).catch(() => null);
    if (!info?.isFile()) return { ok: false, code: "VC_RUNTIME_UNAVAILABLE", detail: `${name} is not in this build` };
    if (info.size !== asset.size || (await sha256File(source).catch(() => "")) !== asset.sha256) {
      return { ok: false, code: "VC_RUNTIME_UNVERIFIED", detail: name };
    }
    files.push({ name, size: asset.size as number, sha256: asset.sha256, source });
  }
  return { ok: true, vcRuntime: Object.freeze(files) };
}

// ── Folder inspection (read-only: lstat, realpath and hashing, nothing else) ─────────────────────

interface Problem {
  code: AiBackendRefusal;
  path: string | null;
}

interface Scan {
  files: Map<string, number>;
  dirs: Set<string>;
  problem: Problem | null;
}

const samePath = (a: string, b: string): boolean => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);

function inside(base: string, candidate: string): boolean {
  const rel = relative(base, candidate);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** A pack-relative POSIX path as an absolute path under `base`, or null if it would leave `base`. */
function confined(base: string, rel: string): string | null {
  const target = join(base, ...rel.split("/"));
  return inside(base, target) ? target : null;
}

/**
 * Walk a folder with `lstat`. Any link, junction or non-regular entry is a problem, and so is any entry
 * whose OS-resolved real path is not exactly its lexical place under the root's real path: that is how
 * a reparse point Node does not report as a link still cannot alias a file from elsewhere.
 */
async function scanFolder(root: string): Promise<Scan> {
  const scan: Scan = { files: new Map(), dirs: new Set(), problem: null };
  let realRoot: string;
  try {
    const info = await lstat(root);
    if (info.isSymbolicLink()) return { ...scan, problem: { code: "REPARSE_POINT", path: null } };
    if (!info.isDirectory()) return { ...scan, problem: { code: "NOT_A_FOLDER", path: null } };
    realRoot = await realpathNative(root);
  } catch {
    return { ...scan, problem: { code: "NOT_A_FOLDER", path: null } };
  }
  const pending: string[] = [""];
  let entries = 0;
  let rel = "";
  try {
    while (pending.length > 0) {
      const dir = pending.pop()!;
      const names = await readdir(dir ? join(root, ...dir.split("/")) : root);
      for (const name of names.sort()) {
        if ((entries += 1) > MAX_ENTRIES) return { ...scan, problem: { code: "TOO_MANY_ENTRIES", path: null } };
        rel = dir ? `${dir}/${name}` : name;
        const abs = join(root, ...rel.split("/"));
        const info = await lstat(abs);
        if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) return { ...scan, problem: { code: "REPARSE_POINT", path: rel } };
        const real = await realpathNative(abs).catch(() => "");
        if (!samePath(real, join(realRoot, ...rel.split("/")))) return { ...scan, problem: { code: "REPARSE_POINT", path: rel } };
        if (info.isDirectory()) {
          scan.dirs.add(rel);
          pending.push(rel);
        } else {
          scan.files.set(rel, info.size);
        }
      }
    }
  } catch {
    // An entry that cannot be listed or examined is, for every caller, a file that is not there.
    return { ...scan, problem: { code: "MISSING_FILE", path: rel || null } };
  }
  return scan;
}

async function looksNative(path: string): Promise<boolean> {
  try {
    const handle = await open(path, "r");
    try {
      const head = Buffer.alloc(4);
      const { bytesRead } = await handle.read(head, 0, 4, 0);
      // PE ("MZ"), ELF and Mach-O images are native code whatever the file is called.
      return (
        (bytesRead >= 2 && head.toString("latin1", 0, 2) === "MZ") ||
        (bytesRead === 4 && (head.toString("latin1", 1, 4) === "ELF" || [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe].includes(head.readUInt32BE(0))))
      );
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

/** The file set must be exactly `expected`: no extra file or directory, nothing missing, every size listed. */
async function compareSet(root: string, scan: Scan, expected: readonly AiBackendFile[]): Promise<Problem | null> {
  const listed = new Map(expected.map((file) => [file.path, file]));
  const ancestors = new Set(expected.flatMap((file) => file.path.split("/").slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join("/"))));
  for (const rel of scan.files.keys()) {
    if (listed.has(rel)) continue;
    const native = NATIVE_NAME.test(rel) || (await looksNative(join(root, ...rel.split("/"))));
    return { code: native ? "UNEXPECTED_NATIVE_FILE" : "UNEXPECTED_FILE", path: rel };
  }
  for (const rel of scan.dirs) if (!ancestors.has(rel)) return { code: "UNEXPECTED_FILE", path: rel };
  for (const file of expected) if (!scan.files.has(file.path)) return { code: "MISSING_FILE", path: file.path };
  for (const file of expected) if (scan.files.get(file.path) !== file.size) return { code: "SIZE_MISMATCH", path: file.path };
  return null;
}

async function compareHashes(root: string, expected: readonly AiBackendFile[], onValidated?: () => void): Promise<Problem | null> {
  for (const file of expected) {
    if ((await sha256File(join(root, ...file.path.split("/"))).catch(() => "")) !== file.sha256) return { code: "HASH_MISMATCH", path: file.path };
    onValidated?.();
  }
  return null;
}

/** Backend and build identity from the pack's own package.json (read as data, at most 64 KB). */
async function identityProblem(root: string, entry: AiBackendManifestEntry, scan: Scan): Promise<Problem | null> {
  const size = scan.files.get("package.json");
  if (size === undefined || size > 64 * 1024) return null;
  let pkg: Record<string, unknown> | null;
  try {
    pkg = record(JSON.parse(await readFile(join(root, "package.json"), "utf8")));
  } catch {
    return null;
  }
  if (typeof pkg?.name === "string" && pkg.name !== entry.package) return { code: "WRONG_BACKEND", path: "package.json" };
  if (typeof pkg?.version === "string" && pkg.version !== entry.packageVersion) return { code: "WRONG_BUILD", path: "package.json" };
  return null;
}

// ── Registry ────────────────────────────────────────────────────────────────────────────────────

export interface AiBackendPackRecord {
  backend: AiGpuBackend;
  runtimeBuild: string;
  packageVersion: string;
  /** The app-managed directory NAME under the backends root. Never a path. */
  dir: string;
  vcRuntime: Array<{ name: string; size: number; sha256: string }>;
  sizeBytes: number;
  fileCount: number;
  installedAt: string;
  lastVerifiedAt: string;
  invalid: { reason: AiBackendRefusal; path: string | null; at: string } | null;
}

interface Registry {
  schemaVersion: 1;
  active: AiBackendPackRecord | null;
}

function parseRecord(value: unknown): AiBackendPackRecord | null {
  const r = record(value);
  if (!r) return null;
  const vc = Array.isArray(r.vcRuntime) ? r.vcRuntime.map(record) : [];
  const invalid = r.invalid === null ? null : record(r.invalid);
  const ok =
    typeof r.backend === "string" &&
    typeof r.runtimeBuild === "string" &&
    typeof r.packageVersion === "string" &&
    typeof r.dir === "string" &&
    PACK_DIR.test(r.dir) &&
    r.dir.startsWith(`${r.backend}-`) &&
    vc.length === AI_BACKEND_VC_RUNTIME.length &&
    AI_BACKEND_VC_RUNTIME.every((name) => vc.some((f) => f?.name === name && Number.isInteger(f.size) && (f.size as number) > 0 && typeof f.sha256 === "string" && SHA256.test(f.sha256))) &&
    Number.isInteger(r.sizeBytes) &&
    Number.isInteger(r.fileCount) &&
    typeof r.installedAt === "string" &&
    typeof r.lastVerifiedAt === "string" &&
    (r.invalid === null || (typeof invalid?.reason === "string" && invalid.reason in MESSAGES && typeof invalid.at === "string"));
  if (!ok) return null;
  return {
    backend: r.backend as AiGpuBackend,
    runtimeBuild: r.runtimeBuild as string,
    packageVersion: r.packageVersion as string,
    dir: r.dir as string,
    vcRuntime: vc.map((f) => ({ name: f!.name as string, size: f!.size as number, sha256: f!.sha256 as string })),
    sizeBytes: r.sizeBytes as number,
    fileCount: r.fileCount as number,
    installedAt: r.installedAt as string,
    lastVerifiedAt: r.lastVerifiedAt as string,
    invalid: invalid ? { reason: invalid.reason as AiBackendRefusal, path: typeof invalid.path === "string" ? invalid.path : null, at: invalid.at as string } : null
  };
}

// ── Store ───────────────────────────────────────────────────────────────────────────────────────

export type AiBackendPackStatus =
  | { status: "unavailable"; reason: "NOT_IN_MANIFEST" }
  | { status: "not-installed" }
  | { status: "invalid"; reason: AiBackendRefusal; path: string | null; record: AiBackendPackRecord | null }
  | { status: "installed"; record: AiBackendPackRecord };

export type BackendCheckId = "folder" | "links" | "identity" | "files" | "sizes" | "hashes" | "signed" | "runtime" | "space";
export interface BackendCheck {
  id: BackendCheckId;
  state: "pass" | "fail" | "skipped";
  detail: string;
}

export interface BackendPreflight {
  ready: boolean;
  code: AiBackendRefusal | null;
  path: string | null;
  backend: AiGpuBackend | null;
  runtimeBuild: string | null;
  packageVersion: string | null;
  /** The app-managed destination, for display. */
  destination: string;
  requiredBytes: number;
  headroomBytes: number;
  availableBytes: number | null;
  identicalInstalled: boolean;
  filesValidated: number;
  fileCount: number;
  checks: BackendCheck[];
}

export type BackendImportResult = { ok: true; unchanged: boolean; dir: string } | { ok: false; code: AiBackendRefusal; path: string | null };

export type BackendLoadVerdict =
  | { ok: true; backend: AiGpuBackend; runtimeBuild: string; dir: string }
  | { ok: false; reason: AiBackendRefusal; path: string | null; message: string; fallback: "cpu" };

export interface BackendImportProgress {
  phase: "copying" | "verifying" | "promoting";
  doneBytes: number;
  totalBytes: number;
}

export interface AiBackendPackOptions {
  /** `<runtime data>/ai/backends`. */
  root: string;
  entry: AiBackendManifestEntry | null;
  runtimeBuild: string | null;
  trust: () => Promise<BackendTrust>;
  freeBytes?: (dir: string) => Promise<number | null>;
  now?: () => number;
  /** Test seams only; production never passes them. */
  hooks?: {
    afterFile?: (path: string) => void;
    afterStage?: (staging: string) => Promise<void>;
    beforePromote?: () => Promise<void>;
  };
}

/** Remove one entry of ours without ever following a link or junction out of the backends root. */
async function removeEntry(path: string): Promise<void> {
  const info = await lstat(path).catch(() => null);
  if (!info) return;
  if (info.isSymbolicLink()) await unlink(path).catch(() => rm(path, { force: true }));
  else await rm(path, { recursive: true, force: true });
}

export class AiBackendPackStore {
  private readonly root: string;
  private readonly entry: AiBackendManifestEntry | null;
  private readonly runtimeBuild: string | null;
  private readonly opts: AiBackendPackOptions;
  private progress: BackendImportProgress | null = null;

  constructor(options: AiBackendPackOptions) {
    this.opts = options;
    this.root = options.root;
    this.runtimeBuild = options.runtimeBuild;
    // A malformed entry can never admit a pack, whatever the manifest file says.
    this.entry = options.entry && isValidAiBackendManifestEntry(options.entry, options.runtimeBuild) ? options.entry : null;
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  importProgress(): BackendImportProgress | null {
    return this.progress ? { ...this.progress } : null;
  }

  /** The app-managed folder a pack is promoted into (display only). */
  destinationLabel(): string {
    return join(this.root, this.entry ? `${this.entry.id}-${this.entry.packageVersion}-…` : "…");
  }

  private registryPath(): string {
    return join(this.root, "registry.json");
  }

  private async readRegistry(): Promise<Registry | "unreadable"> {
    let raw: string;
    try {
      raw = await readFile(this.registryPath(), "utf8");
    } catch {
      return { schemaVersion: 1, active: null };
    }
    try {
      const parsed = record(JSON.parse(raw));
      if (parsed?.active === null || parsed?.active === undefined) return { schemaVersion: 1, active: null };
      const active = parseRecord(parsed.active);
      return active ? { schemaVersion: 1, active } : "unreadable";
    } catch {
      return "unreadable";
    }
  }

  private async writeRegistry(registry: Registry): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const target = this.registryPath();
    const tmp = `${target}.${process.pid}.${this.now()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
    await replaceFileAtomically(tmp, target);
  }

  /** The files an installed pack must hold: the manifest's, plus the app's runtime beside the addon. */
  private installedFiles(active: AiBackendPackRecord): AiBackendFile[] {
    const entry = this.entry!;
    const bins = posix.dirname(entry.files.find((f) => f.path.endsWith("/llama-addon.node"))!.path);
    return [...entry.files, ...active.vcRuntime.map((vc) => ({ path: `${bins}/${vc.name}`, size: vc.size, sha256: vc.sha256 }))];
  }

  private matchesEntry(active: AiBackendPackRecord): boolean {
    return !!this.entry && active.backend === this.entry.id && active.runtimeBuild === this.runtimeBuild && active.packageVersion === this.entry.packageVersion;
  }

  /** Cheap status: registry, manifest agreement and file sizes. Full hashing is `verifyForLoad`. */
  async status(): Promise<AiBackendPackStatus> {
    if (!this.entry) return { status: "unavailable", reason: "NOT_IN_MANIFEST" };
    const registry = await this.readRegistry();
    if (registry === "unreadable") return { status: "invalid", reason: "REGISTRY_UNREADABLE", path: null, record: null };
    const active = registry.active;
    if (!active) return { status: "not-installed" };
    if (active.invalid) return { status: "invalid", reason: active.invalid.reason, path: active.invalid.path, record: active };
    if (!this.matchesEntry(active)) return { status: "invalid", reason: "INCOMPATIBLE", path: null, record: active };
    const dir = join(this.root, active.dir);
    const info = await lstat(dir).catch(() => null);
    if (!info) return { status: "invalid", reason: "MISSING_FILE", path: null, record: active };
    if (info.isSymbolicLink() || !info.isDirectory()) return { status: "invalid", reason: "REPARSE_POINT", path: null, record: active };
    for (const file of this.installedFiles(active)) {
      const size = (await stat(join(dir, ...file.path.split("/"))).catch(() => null))?.size;
      if (size === undefined) return { status: "invalid", reason: "MISSING_FILE", path: file.path, record: active };
      if (size !== file.size) return { status: "invalid", reason: "SIZE_MISMATCH", path: file.path, record: active };
    }
    return { status: "installed", record: active };
  }

  /** Validate a selected folder without changing anything. Hashes every file; loads nothing. */
  async preflight(source: string): Promise<BackendPreflight> {
    const entry = this.entry;
    const pack = entry?.files ?? [];
    const result: BackendPreflight = {
      ready: false,
      code: null,
      path: null,
      backend: entry?.id ?? null,
      runtimeBuild: this.runtimeBuild,
      packageVersion: entry?.packageVersion ?? null,
      destination: this.destinationLabel(),
      requiredBytes: pack.reduce((sum, f) => sum + f.size, 0),
      headroomBytes: BACKEND_IMPORT_HEADROOM_BYTES,
      availableBytes: null,
      identicalInstalled: false,
      filesValidated: 0,
      fileCount: pack.length,
      checks: []
    };
    const add = (id: BackendCheckId, state: BackendCheck["state"], detail: string): void => {
      result.checks.push({ id, state, detail });
    };
    const fail = (problem: Problem): void => {
      if (result.code === null) {
        result.code = problem.code;
        result.path = problem.path;
      }
    };
    if (!entry) {
      fail({ code: "NOT_IN_MANIFEST", path: null });
      return result;
    }

    // The selected folder, source checks in order; after the first failure the rest are skipped.
    const scan = await scanFolder(source).catch((): Scan => ({ files: new Map(), dirs: new Set(), problem: { code: "NOT_A_FOLDER", path: null } }));
    const steps: Array<[BackendCheckId, string, () => Promise<Problem | null>]> = [
      ["folder", "The selection is a folder", async () => (scan.problem?.code === "NOT_A_FOLDER" ? scan.problem : null)],
      ["links", "No link, junction or reparse point; nothing resolves outside the folder", async () => scan.problem],
      ["identity", `Backend ${entry.id}, ${entry.package} ${entry.packageVersion} (${this.runtimeBuild})`, () => identityProblem(source, entry, scan)],
      ["files", `Exactly the ${pack.length} listed files; no unexpected executable or native library`, async () => {
        const problem = await compareSet(source, scan, pack);
        return problem?.code === "SIZE_MISMATCH" ? null : problem;
      }],
      ["sizes", "Every file has its listed size", () => compareSet(source, scan, pack)],
      ["hashes", `SHA-256 of all ${pack.length} files`, () => compareHashes(source, pack, () => (result.filesValidated += 1))]
    ];
    let failed = false;
    for (const [id, label, run] of steps) {
      if (failed) {
        add(id, "skipped", label);
        continue;
      }
      const problem = await run().catch((): Problem => ({ code: "COPY_FAILED", path: null }));
      if (problem) {
        failed = true;
        fail(problem);
        add(id, "fail", backendRefusalMessage(problem.code, problem.path));
      } else {
        add(id, "pass", id === "hashes" ? `SHA-256 matches for ${result.filesValidated} of ${pack.length} files` : label);
      }
    }

    // What the app itself supplies, checked whatever the folder held.
    const trust = await this.opts.trust().catch((): BackendTrust => ({ ok: false, code: "SIGNED_MANIFEST_UNVERIFIED", detail: "unreadable" }));
    const signedFailed = !trust.ok && trust.code.startsWith("SIGNED_");
    add("signed", signedFailed ? "fail" : "pass", signedFailed ? backendRefusalMessage((trust as { code: AiBackendRefusal }).code) : "The built-in backend manifest matches the signed dependency manifest");
    if (trust.ok) {
      result.requiredBytes += trust.vcRuntime.reduce((sum, f) => sum + f.size, 0);
      add("runtime", "pass", `This build's own Visual C++ runtime (${trust.vcRuntime.length} files) verified against the signed manifest`);
    } else {
      fail({ code: trust.code, path: null });
      add("runtime", signedFailed ? "skipped" : "fail", signedFailed ? "This build's own Visual C++ runtime" : backendRefusalMessage(trust.code, trust.detail));
    }

    const status = await this.status();
    result.identicalInstalled =
      status.status === "installed" && trust.ok && trust.vcRuntime.every((vc) => status.record.vcRuntime.some((r) => r.name === vc.name && r.sha256 === vc.sha256));
    await mkdir(this.root, { recursive: true }).catch(() => undefined);
    result.availableBytes = await (this.opts.freeBytes ?? measureFreeBytes)(this.root);
    const needed = result.requiredBytes + result.headroomBytes;
    const spaceOk = result.identicalInstalled || (result.availableBytes !== null && result.availableBytes >= needed);
    if (!spaceOk) fail({ code: "INSUFFICIENT_SPACE", path: null });
    add("space", spaceOk ? "pass" : "fail", result.availableBytes === null ? "Free disk space could not be measured" : `${result.availableBytes} bytes free; ${needed} needed including ${result.headroomBytes} headroom`);

    result.ready = result.code === null;
    return result;
  }

  /** Copy one file, hashing exactly the bytes written. */
  private async copyHashed(from: string, to: string, signal: AbortSignal | undefined, progress: BackendImportProgress): Promise<{ size: number; sha256: string }> {
    await mkdir(dirname(to), { recursive: true });
    const hash = createHash("sha256");
    let size = 0;
    await pipeline(
      createReadStream(from),
      new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          hash.update(chunk);
          size += chunk.length;
          progress.doneBytes += chunk.length;
          callback(null, chunk);
        }
      }),
      createWriteStream(to, { flags: "wx" }),
      { signal }
    );
    return { size, sha256: hash.digest("hex") };
  }

  /**
   * Import a validated folder: stage, copy the app's own VC++ runtime, revalidate, promote, register.
   * Idempotent: a verified identical pack is kept as it is.
   */
  import(source: string, options: { signal?: AbortSignal } = {}): Promise<BackendImportResult> {
    return runExclusive(this.root, async () => {
      const entry = this.entry;
      if (!entry) return { ok: false, code: "NOT_IN_MANIFEST", path: null };
      await mkdir(this.root, { recursive: true });
      await this.recoverUnlocked();

      // The folder may have changed since the preflight: structure again here, bytes while copying.
      const scan = await scanFolder(source).catch((): Scan => ({ files: new Map(), dirs: new Set(), problem: { code: "NOT_A_FOLDER", path: null } }));
      const structural = scan.problem ?? (await identityProblem(source, entry, scan)) ?? (await compareSet(source, scan, entry.files));
      if (structural) return { ok: false, ...structural };
      const trust = await this.opts.trust().catch((): BackendTrust => ({ ok: false, code: "SIGNED_MANIFEST_UNVERIFIED", detail: "unreadable" }));
      if (!trust.ok) return { ok: false, code: trust.code, path: null };

      const registry = await this.readRegistry();
      const current = registry === "unreadable" ? null : registry.active;
      if (
        current &&
        !current.invalid &&
        this.matchesEntry(current) &&
        trust.vcRuntime.every((vc) => current.vcRuntime.some((r) => r.name === vc.name && r.sha256 === vc.sha256)) &&
        (await this.verifyUnlocked()).ok
      ) {
        return { ok: true, unchanged: true, dir: current.dir };
      }

      const vcBytes = trust.vcRuntime.reduce((sum, f) => sum + f.size, 0);
      const total = entry.files.reduce((sum, f) => sum + f.size, 0) + vcBytes;
      const free = await (this.opts.freeBytes ?? measureFreeBytes)(this.root);
      if (free === null || free < total + BACKEND_IMPORT_HEADROOM_BYTES) return { ok: false, code: "INSUFFICIENT_SPACE", path: null };

      const staging = join(this.root, `.staging-${process.pid}-${this.now().toString(36)}-${randomBytes(3).toString("hex")}`);
      const fail = async (code: AiBackendRefusal, path: string | null = null): Promise<BackendImportResult> => {
        await removeEntry(staging).catch(() => undefined);
        return { ok: false, code, path };
      };
      const progress: BackendImportProgress = { phase: "copying", doneBytes: 0, totalBytes: total };
      this.progress = progress;
      try {
        await mkdir(staging);
        for (const file of entry.files) {
          const from = confined(source, file.path);
          const to = confined(staging, file.path);
          if (!from || !to) return await fail("REPARSE_POINT", file.path);
          const copied = await this.copyHashed(from, to, options.signal, progress);
          if (copied.size !== file.size) return await fail("SIZE_MISMATCH", file.path);
          if (copied.sha256 !== file.sha256) return await fail("HASH_MISMATCH", file.path);
          this.opts.hooks?.afterFile?.(file.path);
        }
        const installed: AiBackendPackRecord = {
          backend: entry.id,
          runtimeBuild: this.runtimeBuild!,
          packageVersion: entry.packageVersion,
          dir: "",
          vcRuntime: trust.vcRuntime.map(({ name, size, sha256 }) => ({ name, size, sha256 })),
          sizeBytes: total,
          fileCount: entry.files.length + trust.vcRuntime.length,
          installedAt: "",
          lastVerifiedAt: "",
          invalid: null
        };
        const expected = this.installedFiles(installed);
        for (const vc of trust.vcRuntime) {
          const target = expected.find((f) => f.path.endsWith(`/${vc.name}`))!;
          const to = confined(staging, target.path);
          if (!to) return await fail("REPARSE_POINT", target.path);
          const copied = await this.copyHashed(vc.source, to, options.signal, progress);
          if (copied.size !== vc.size || copied.sha256 !== vc.sha256) return await fail("VC_RUNTIME_UNVERIFIED", target.path);
        }
        await this.opts.hooks?.afterStage?.(staging);

        // Revalidate the staging as a whole before anything points at it.
        progress.phase = "verifying";
        const staged = await scanFolder(staging);
        const stagedProblem = staged.problem ?? (await compareSet(staging, staged, expected)) ?? (await compareHashes(staging, expected));
        if (stagedProblem) return await fail("STAGED_MISMATCH", stagedProblem.path);
        if (options.signal?.aborted) return await fail("CANCELLED");

        // Past this point the import is not cancellable: promotion is one rename and one registry write.
        progress.phase = "promoting";
        const name = `${entry.id}-${entry.packageVersion}-${this.now().toString(36)}${randomBytes(2).toString("hex")}`;
        const final = join(this.root, name);
        try {
          await this.opts.hooks?.beforePromote?.();
          await replaceFileAtomically(staging, final);
        } catch {
          return await fail("PROMOTE_FAILED");
        }
        const at = new Date(this.now()).toISOString();
        try {
          await this.writeRegistry({ schemaVersion: 1, active: { ...installed, dir: name, installedAt: at, lastVerifiedAt: at } });
        } catch {
          await removeEntry(final);
          return { ok: false, code: "PROMOTE_FAILED", path: null };
        }
        await this.sweep(name);
        return { ok: true, unchanged: false, dir: name };
      } catch {
        return await fail(options.signal?.aborted ? "CANCELLED" : "COPY_FAILED");
      } finally {
        this.progress = null;
      }
    });
  }

  /**
   * The load-time integrity boundary (L8a.3 calls it before EVERY backend load). Re-walks and re-hashes
   * the installed pack; any missing, altered, extra or replaced file refuses the backend and marks the
   * pack invalid until it is re-imported or removed. The answer always leaves CPU inference available.
   */
  verifyForLoad(): Promise<BackendLoadVerdict> {
    return runExclusive(this.root, () => this.verifyUnlocked());
  }

  private async verifyUnlocked(): Promise<BackendLoadVerdict> {
    const refuse = (reason: AiBackendRefusal, path: string | null = null): BackendLoadVerdict => ({
      ok: false,
      reason,
      path,
      message: backendRefusalMessage(reason, path),
      fallback: "cpu"
    });
    if (!this.entry) return refuse("NOT_IN_MANIFEST");
    const registry = await this.readRegistry();
    if (registry === "unreadable") return refuse("REGISTRY_UNREADABLE");
    const active = registry.active;
    if (!active) return refuse("NOT_INSTALLED");
    if (active.invalid) return refuse(active.invalid.reason, active.invalid.path);
    if (!this.matchesEntry(active)) return refuse("INCOMPATIBLE");

    const problem = await this.inspectInstalled(active);
    if (problem) {
      // Sticky: the pack stays refused until it is re-imported or removed, even if the bytes come back.
      await this.writeRegistry({ schemaVersion: 1, active: { ...active, invalid: { reason: problem.code, path: problem.path, at: new Date(this.now()).toISOString() } } }).catch(() => undefined);
      return refuse(problem.code, problem.path);
    }
    await this.writeRegistry({ schemaVersion: 1, active: { ...active, lastVerifiedAt: new Date(this.now()).toISOString() } }).catch(() => undefined);
    return { ok: true, backend: active.backend, runtimeBuild: active.runtimeBuild, dir: join(this.root, active.dir) };
  }

  private async inspectInstalled(active: AiBackendPackRecord): Promise<Problem | null> {
    const dir = confined(this.root, active.dir);
    if (!dir) return { code: "REPARSE_POINT", path: null };
    const info = await lstat(dir).catch(() => null);
    if (!info) return { code: "MISSING_FILE", path: null };
    if (info.isSymbolicLink() || !info.isDirectory()) return { code: "REPARSE_POINT", path: null };
    const [realRoot, realDir] = await Promise.all([realpathNative(this.root).catch(() => ""), realpathNative(dir).catch(() => "")]);
    if (!realRoot || !samePath(realDir, join(realRoot, active.dir))) return { code: "REPARSE_POINT", path: null };
    const expected = this.installedFiles(active);
    const scan = await scanFolder(dir);
    return scan.problem ?? (await compareSet(dir, scan, expected)) ?? (await compareHashes(dir, expected));
  }

  /** Unregister the pack and delete it. Idempotent. */
  remove(): Promise<void> {
    return runExclusive(this.root, async () => {
      await this.writeRegistry({ schemaVersion: 1, active: null });
      await this.sweep(null);
    });
  }

  /** Remove staging a cancelled, failed or crashed import left, and packs nothing points at. */
  recover(): Promise<void> {
    return runExclusive(this.root, () => this.recoverUnlocked());
  }

  private async recoverUnlocked(): Promise<void> {
    const registry = await this.readRegistry();
    // An unreadable registry might still name a pack: only staging is safe to remove then.
    await this.sweep(registry === "unreadable" ? undefined : registry.active?.dir ?? null);
  }

  /**
   * Best-effort removal of staging, registry temp files and every pack directory except `keep`
   * (`undefined` keeps all packs). Windows cannot delete a DLL a process still has loaded; whatever
   * survives is retried later and, being unregistered, can never pass `verifyForLoad`.
   */
  private async sweep(keep: string | null | undefined): Promise<void> {
    const names = await readdir(this.root).catch(() => [] as string[]);
    for (const name of names) {
      const stale =
        name.startsWith(".staging-") ||
        (name.startsWith("registry.json.") && name.endsWith(".tmp")) ||
        (keep !== undefined && name !== keep && PACK_DIR.test(name));
      if (stale) await removeEntry(join(this.root, name)).catch(() => undefined);
    }
  }
}
