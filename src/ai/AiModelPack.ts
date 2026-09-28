/**
 * Local-AI model pack (Phase L, L1.2): import, status, verification and removal.
 *
 * The pack ships separately from the installer and is imported through Settings: the main process
 * picks the file (the renderer never supplies a path), then this module checks the GGUF header,
 * checks the size against the manifest, and makes ONE streaming pass that hashes exactly the bytes it
 * writes to a temporary file under the models directory. The SHA-256 must name an entry in the
 * release-owned manifest, or the copy is deleted and the import refused. Hashing the copied bytes,
 * rather than hashing the source and copying afterwards, means a source swapped mid-import can never
 * be registered under another file's hash.
 *
 * Status is cheap (registry, manifest membership, file size). The full SHA-256 is re-verified once
 * per session before the first load (`verifyForLoad`), so a file altered on disk after import is
 * caught before the runtime maps it, and a failed verification makes the pack invalid for the session.
 *
 * All of it lives under the runtime data root, never in resources or app.asar.
 * Framework-agnostic: node:fs and node:crypto only.
 *
 * L8b.1 (E1, E7): a GGUF the manifest does not list is no longer refused.
 * - It is copied and hashed exactly the same way, stored under its SHA-256, and registered as
 *   `registered` with its size and the source's file name. The name is display only and never a path.
 * - It is not loaded: compatibility is unchecked until the host's static and probe stages (L8b.2,
 *   L8b.3) exist.
 * - Every import first needs free space for the file plus headroom (`preflight` reports it), and fails
 *   closed when the space cannot be measured.
 * - L8b.2: the host's static header verdict is recorded on it (`recordStaticCheck`) with the runtime
 *   build that produced it; a new import registers the model again without one.
 * - L8b.3: the host's probe verdict is recorded the same way (`recordProbeCheck`).
 * - L8b.5 (E7): an administrator's "unverified model" acknowledgement is recorded on that exact file
 *   (`acknowledge`); a new import, even of the same file, needs a new one.
 */

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readdir, readFile, rm, stat, statfs, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { isValidAiModelManifestEntry, type AiModelManifestEntry } from "../offline/AiModelManifest";
import { replaceFileAtomically } from "../storage/atomicReplace";
import { runExclusive } from "../storage/folderWriteCoordinator";
import { isAiProbeCheck, isAiStaticCheck, type AiProbeCheck, type AiStaticCheck } from "./AiModelCompatibility";

/** A model the manifest does not list (L8b.1). `fileName` is the source's own name, shown, never used as a path. */
export interface AiExternalModel {
  sha256: string;
  sizeBytes: number;
  fileName: string;
}

/** The static stage's result (L8b.2), valid only for the runtime build that produced it. */
export interface AiStaticCheckRecord {
  runtimeBuild: string;
  /** Null when every static check passed. */
  failed: AiStaticCheck | null;
  checkedAt: string;
}

/** The probe's result (L8b.3), valid only for the runtime build that produced it. */
export interface AiProbeCheckRecord {
  runtimeBuild: string;
  /** Null when the probe passed. */
  failed: AiProbeCheck | null;
  checkedAt: string;
}

export type AiModelPackStatus =
  | { status: "missing" }
  | { status: "installed"; entry: AiModelManifestEntry; installedAt: string }
  /** Copied and hashed; not loaded until its compatibility stages pass and it is acknowledged (L8b.1–L8b.5). */
  | {
      status: "registered";
      external: AiExternalModel;
      installedAt: string;
      staticCheck: AiStaticCheckRecord | null;
      probeCheck: AiProbeCheckRecord | null;
      /** When an administrator acknowledged this file as an unverified model (E7); null until then. */
      acknowledgedAt: string | null;
    }
  | { status: "invalid"; reason: "FILE_MISSING" | "SIZE_MISMATCH" | "HASH_MISMATCH" | "REGISTRY_UNREADABLE" }
  | { status: "incompatible"; reason: "NOT_IN_MANIFEST" };

export type AiModelImportCode = "NOT_A_FILE" | "NOT_GGUF" | "INSUFFICIENT_SPACE" | "COPY_FAILED";
export type AiModelImportResult =
  | { ok: true; entry: AiModelManifestEntry; external: null }
  | { ok: true; entry: null; external: AiExternalModel }
  | { ok: false; code: AiModelImportCode };

/** Free space an import keeps beyond the file itself, so a full disk never ends with a half-written model. */
export const MODEL_IMPORT_HEADROOM_BYTES = 256 * 1024 ** 2;

/** What an import would need, measured before anything is copied (L8b.1). */
export interface AiModelImportPreflight {
  fileName: string;
  sizeBytes: number;
  /** Null when the free space cannot be measured; the import then refuses. */
  freeBytes: number | null;
  requiredBytes: number;
  spaceOk: boolean;
}

/** A registered model's record. Every field after the name is optional, so older registries load unchanged. */
interface ExternalRecord {
  sizeBytes: number;
  fileName: string;
  staticCheck?: AiStaticCheckRecord;
  probeCheck?: AiProbeCheckRecord;
  acknowledgedAt?: string;
}

interface Registry {
  schemaVersion: 1;
  /** `external` is present only for a model the manifest does not list; its absence is the pre-L8b shape. */
  active: { sha256: string; installedAt: string; external?: ExternalRecord } | null;
}

const GGUF_MAGIC = "GGUF";
const GGUF_VERSIONS = new Set([2, 3]);
const SHA256 = /^[0-9a-f]{64}$/;

async function readHeader(path: string): Promise<Buffer | null> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(8);
    const { bytesRead } = await handle.read(buffer, 0, 8, 0);
    return bytesRead === 8 ? buffer : null;
  } finally {
    await handle.close();
  }
}

function isGgufHeader(header: Buffer | null): boolean {
  return header !== null && header.toString("latin1", 0, 4) === GGUF_MAGIC && GGUF_VERSIONS.has(header.readUInt32LE(4));
}

/** Bytes free to this user on the volume holding `dir`; null when it cannot be measured. */
export async function measureFreeBytes(dir: string): Promise<number | null> {
  try {
    const info = await statfs(dir);
    return Number(info.bavail) * Number(info.bsize);
  } catch {
    return null;
  }
}

/** A display name only: one path segment, no reserved or control characters, bounded. */
function isDisplayFileName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.length >= 1 &&
    name.length <= 255 &&
    name !== "." &&
    name !== ".." &&
    !/[\\/:*?"<>|]/.test(name) &&
    ![...name].some((char) => char.charCodeAt(0) < 32)
  );
}

function isCheckRecord(value: unknown, isCheck: (failed: unknown) => boolean): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const { runtimeBuild, failed, checkedAt } = value as Record<string, unknown>;
  return (
    typeof runtimeBuild === "string" &&
    runtimeBuild.length >= 1 &&
    runtimeBuild.length <= 200 &&
    (failed === null || isCheck(failed)) &&
    isTimestamp(checkedAt)
  );
}

const isTimestamp = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
const isStaticCheckRecord = (value: unknown): value is AiStaticCheckRecord => isCheckRecord(value, isAiStaticCheck);
const isProbeCheckRecord = (value: unknown): value is AiProbeCheckRecord => isCheckRecord(value, isAiProbeCheck);
const copyCheck = <T extends { runtimeBuild: string; failed: unknown; checkedAt: string }>(check: T): T => ({ runtimeBuild: check.runtimeBuild, failed: check.failed, checkedAt: check.checkedAt }) as T;

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), async function* (source: AsyncIterable<Buffer>) {
    for await (const chunk of source) hash.update(chunk);
  });
  return hash.digest("hex");
}

export class AiModelPackStore {
  private readonly manifest: readonly AiModelManifestEntry[];
  /** sha256 -> verified (true) or failed (false) this session. */
  private readonly verified = new Map<string, { ok: boolean; size: number; mtimeMs: number }>();

  constructor(
    private readonly modelsDir: string,
    manifest: readonly AiModelManifestEntry[],
    private readonly now: () => number = () => Date.now(),
    private readonly freeBytes: (dir: string) => Promise<number | null> = measureFreeBytes
  ) {
    // A malformed entry can never admit a pack, whatever the manifest file says.
    this.manifest = manifest.filter(isValidAiModelManifestEntry);
  }

  modelPath(sha256: string): string {
    return join(this.modelsDir, `${sha256}.gguf`);
  }

  private registryPath(): string {
    return join(this.modelsDir, "registry.json");
  }

  private async readRegistry(): Promise<Registry | "unreadable"> {
    let raw: string;
    try {
      raw = await readFile(this.registryPath(), "utf8");
    } catch {
      return { schemaVersion: 1, active: null };
    }
    try {
      const parsed = JSON.parse(raw) as Partial<Registry>;
      const active = parsed.active;
      if (active === null || active === undefined) return { schemaVersion: 1, active: null };
      if (typeof active.sha256 !== "string" || !SHA256.test(active.sha256) || typeof active.installedAt !== "string") return "unreadable";
      const external: unknown = (active as { external?: unknown }).external;
      if (external === undefined) return { schemaVersion: 1, active: { sha256: active.sha256, installedAt: active.installedAt } };
      if (typeof external !== "object" || external === null) return "unreadable";
      const { sizeBytes, fileName, staticCheck, probeCheck, acknowledgedAt } = external as Record<string, unknown>;
      if (typeof sizeBytes !== "number" || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || !isDisplayFileName(fileName)) return "unreadable";
      // Each is optional (L8b.2, L8b.3, L8b.5): an older registry has none. A malformed one is a forged or damaged registry.
      if (staticCheck !== undefined && !isStaticCheckRecord(staticCheck)) return "unreadable";
      if (probeCheck !== undefined && !isProbeCheckRecord(probeCheck)) return "unreadable";
      if (acknowledgedAt !== undefined && !isTimestamp(acknowledgedAt)) return "unreadable";
      const record: ExternalRecord = {
        sizeBytes,
        fileName,
        ...(staticCheck === undefined ? {} : { staticCheck: copyCheck(staticCheck) }),
        ...(probeCheck === undefined ? {} : { probeCheck: copyCheck(probeCheck) }),
        ...(acknowledgedAt === undefined ? {} : { acknowledgedAt })
      };
      return { schemaVersion: 1, active: { sha256: active.sha256, installedAt: active.installedAt, external: record } };
    } catch {
      return "unreadable";
    }
  }

  private async writeRegistry(registry: Registry): Promise<void> {
    const target = this.registryPath();
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
    await replaceFileAtomically(tmp, target);
  }

  async status(): Promise<AiModelPackStatus> {
    const registry = await this.readRegistry();
    if (registry === "unreadable") return { status: "invalid", reason: "REGISTRY_UNREADABLE" };
    const active = registry.active;
    if (!active) return { status: "missing" };
    const entry = this.manifest.find((candidate) => candidate.sha256 === active.sha256);
    // A later app release may retire a curated entry; that file then no longer qualifies.
    if (!entry && !active.external) return { status: "incompatible", reason: "NOT_IN_MANIFEST" };
    const expectedSize = entry ? entry.sizeBytes : active.external!.sizeBytes;
    let size: number;
    try {
      size = (await stat(this.modelPath(active.sha256))).size;
    } catch {
      return { status: "invalid", reason: "FILE_MISSING" };
    }
    if (size !== expectedSize) return { status: "invalid", reason: "SIZE_MISMATCH" };
    if (this.verified.get(active.sha256)?.ok === false) return { status: "invalid", reason: "HASH_MISMATCH" };
    // A model registered before a release listed it reads as that curated entry from then on.
    if (entry) return { status: "installed", entry, installedAt: active.installedAt };
    const { sizeBytes, fileName, staticCheck, probeCheck, acknowledgedAt } = active.external!;
    return {
      status: "registered",
      external: { sha256: active.sha256, sizeBytes, fileName },
      installedAt: active.installedAt,
      staticCheck: staticCheck ?? null,
      probeCheck: probeCheck ?? null,
      acknowledgedAt: acknowledgedAt ?? null
    };
  }

  /**
   * Record the static stage's result (L8b.2) on the registered model it was run on. False, and nothing
   * written, when that model is no longer the active registered one: a verdict never moves to a replacement.
   */
  recordStaticCheck(sha256: string, check: AiStaticCheckRecord): Promise<boolean> {
    return isStaticCheckRecord(check) ? this.updateExternal(sha256, (external) => ({ ...external, staticCheck: copyCheck(check) })) : Promise.resolve(false);
  }

  /** Record the probe's result (L8b.3), under the same rule as `recordStaticCheck`. */
  recordProbeCheck(sha256: string, check: AiProbeCheckRecord): Promise<boolean> {
    return isProbeCheckRecord(check) ? this.updateExternal(sha256, (external) => ({ ...external, probeCheck: copyCheck(check) })) : Promise.resolve(false);
  }

  /**
   * Record an administrator's "unverified model" acknowledgement (L8b.5, E7) on the active registered
   * model named by its checksum. It admits nothing by itself: the model is used only when its
   * compatibility stages passed too. False when that model is no longer the active registered one.
   */
  acknowledge(sha256: string): Promise<boolean> {
    return this.updateExternal(sha256, (external) => ({ ...external, acknowledgedAt: new Date(this.now()).toISOString() }));
  }

  private updateExternal(sha256: string, change: (external: ExternalRecord) => ExternalRecord): Promise<boolean> {
    return runExclusive(this.modelsDir, async () => {
      const registry = await this.readRegistry();
      if (registry === "unreadable" || registry.active?.sha256 !== sha256 || !registry.active.external) return false;
      await this.writeRegistry({ schemaVersion: 1, active: { ...registry.active, external: change(registry.active.external) } });
      return true;
    });
  }

  /** What importing `sourcePath` would need, measured before anything is copied (L8b.1). */
  async preflight(sourcePath: string): Promise<{ ok: true; preflight: AiModelImportPreflight } | { ok: false; code: "NOT_A_FILE" | "NOT_GGUF" }> {
    const checked = await this.checkSource(sourcePath);
    if (!checked.ok) return checked;
    const freeBytes = await this.measureModelsFree();
    const requiredBytes = checked.sizeBytes + MODEL_IMPORT_HEADROOM_BYTES;
    return {
      ok: true,
      preflight: { fileName: checked.fileName, sizeBytes: checked.sizeBytes, freeBytes, requiredBytes, spaceOk: freeBytes !== null && freeBytes >= requiredBytes }
    };
  }

  private async checkSource(sourcePath: string): Promise<{ ok: true; sizeBytes: number; fileName: string } | { ok: false; code: "NOT_A_FILE" | "NOT_GGUF" }> {
    let sizeBytes: number;
    try {
      const info = await stat(sourcePath);
      if (!info.isFile()) return { ok: false, code: "NOT_A_FILE" };
      sizeBytes = info.size;
    } catch {
      return { ok: false, code: "NOT_A_FILE" };
    }
    if (!isGgufHeader(await readHeader(sourcePath).catch(() => null))) return { ok: false, code: "NOT_GGUF" };
    const name = basename(sourcePath);
    return { ok: true, sizeBytes, fileName: isDisplayFileName(name) ? name : "model.gguf" };
  }

  private async measureModelsFree(): Promise<number | null> {
    await mkdir(this.modelsDir, { recursive: true });
    return this.freeBytes(this.modelsDir).catch(() => null);
  }

  /**
   * Full SHA-256 of the installed file, once per session (re-run if the file's size or mtime moved).
   * A mismatch is sticky for the session: the pack reads as invalid until it is re-imported.
   */
  async verifyForLoad(sha256: string): Promise<boolean> {
    const path = this.modelPath(sha256);
    let info;
    try {
      info = await stat(path);
    } catch {
      return false;
    }
    const cached = this.verified.get(sha256);
    if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) return cached.ok;
    const ok = (await sha256File(path).catch(() => "")) === sha256;
    this.verified.set(sha256, { ok, size: info.size, mtimeMs: info.mtimeMs });
    return ok;
  }

  import(sourcePath: string): Promise<AiModelImportResult> {
    return runExclusive(this.modelsDir, async () => {
      const checked = await this.checkSource(sourcePath);
      if (!checked.ok) return checked;
      // Measured again here, not trusted from a preflight: the disk may have filled since.
      const free = await this.measureModelsFree();
      if (free === null || free < checked.sizeBytes + MODEL_IMPORT_HEADROOM_BYTES) return { ok: false, code: "INSUFFICIENT_SPACE" };

      const tmp = join(this.modelsDir, `.import-${process.pid}-${this.now()}.tmp`);
      const hash = createHash("sha256");
      let written = 0;
      try {
        await pipeline(
          createReadStream(sourcePath),
          new Transform({
            transform(chunk: Buffer, _encoding, callback) {
              hash.update(chunk);
              written += chunk.length;
              callback(null, chunk);
            }
          }),
          createWriteStream(tmp, { flags: "wx" })
        );
      } catch {
        await rm(tmp, { force: true });
        return { ok: false, code: "COPY_FAILED" };
      }

      const sha256 = hash.digest("hex");
      const entry = this.manifest.find((candidate) => candidate.sha256 === sha256 && candidate.sizeBytes === written) ?? null;
      try {
        await replaceFileAtomically(tmp, this.modelPath(sha256));
      } catch {
        await rm(tmp, { force: true });
        return { ok: false, code: "COPY_FAILED" };
      }

      // Not listed: registered with the bytes actually written, compatibility unchecked (L8b.1).
      const external = entry ? null : { sizeBytes: written, fileName: checked.fileName };
      const installedAt = new Date(this.now()).toISOString();
      await this.writeRegistry({ schemaVersion: 1, active: external ? { sha256, installedAt, external } : { sha256, installedAt } });
      // The bytes on disk are the ones just hashed, so this session starts verified.
      const info = await stat(this.modelPath(sha256));
      this.verified.set(sha256, { ok: true, size: info.size, mtimeMs: info.mtimeMs });
      await this.sweep(`${sha256}.gguf`);
      return entry ? { ok: true, entry, external: null } : { ok: true, entry: null, external: { sha256, ...external! } };
    });
  }

  /** Unregister the pack and delete its file. Idempotent. */
  remove(): Promise<void> {
    return runExclusive(this.modelsDir, async () => {
      await mkdir(this.modelsDir, { recursive: true });
      await this.writeRegistry({ schemaVersion: 1, active: null });
      await this.sweep(null);
    });
  }

  /**
   * Best-effort removal of every pack file except `keep`, and of temp files a crashed import left.
   * Windows cannot delete a file the runtime still has mapped; whatever survives here is retried by
   * the next import or removal, and is never registered, so it can never be loaded.
   */
  private async sweep(keep: string | null): Promise<void> {
    const names = await readdir(this.modelsDir).catch(() => [] as string[]);
    for (const name of names) {
      if (name === keep || !(name.endsWith(".gguf") || (name.startsWith(".import-") && name.endsWith(".tmp")))) continue;
      await rm(join(this.modelsDir, name), { force: true }).catch(() => undefined);
    }
  }
}
