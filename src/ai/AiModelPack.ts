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
 */

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { isValidAiModelManifestEntry, type AiModelManifestEntry } from "../offline/AiModelManifest";
import { replaceFileAtomically } from "../storage/atomicReplace";
import { runExclusive } from "../storage/folderWriteCoordinator";

export type AiModelPackStatus =
  | { status: "missing" }
  | { status: "installed"; entry: AiModelManifestEntry; installedAt: string }
  | { status: "invalid"; reason: "FILE_MISSING" | "SIZE_MISMATCH" | "HASH_MISMATCH" | "REGISTRY_UNREADABLE" }
  | { status: "incompatible"; reason: "NOT_IN_MANIFEST" };

export type AiModelImportCode = "NOT_A_FILE" | "NOT_GGUF" | "SIZE_NOT_IN_MANIFEST" | "NOT_IN_MANIFEST" | "COPY_FAILED";
export type AiModelImportResult = { ok: true; entry: AiModelManifestEntry } | { ok: false; code: AiModelImportCode };

interface Registry {
  schemaVersion: 1;
  active: { sha256: string; installedAt: string } | null;
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
    private readonly now: () => number = () => Date.now()
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
      return { schemaVersion: 1, active: { sha256: active.sha256, installedAt: active.installedAt } };
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
    if (!registry.active) return { status: "missing" };
    const entry = this.manifest.find((candidate) => candidate.sha256 === registry.active!.sha256);
    // A later app release may retire an entry; the installed file then no longer qualifies.
    if (!entry) return { status: "incompatible", reason: "NOT_IN_MANIFEST" };
    let size: number;
    try {
      size = (await stat(this.modelPath(entry.sha256))).size;
    } catch {
      return { status: "invalid", reason: "FILE_MISSING" };
    }
    if (size !== entry.sizeBytes) return { status: "invalid", reason: "SIZE_MISMATCH" };
    if (this.verified.get(entry.sha256)?.ok === false) return { status: "invalid", reason: "HASH_MISMATCH" };
    return { status: "installed", entry, installedAt: registry.active.installedAt };
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
      let size: number;
      try {
        const info = await stat(sourcePath);
        if (!info.isFile()) return { ok: false, code: "NOT_A_FILE" };
        size = info.size;
      } catch {
        return { ok: false, code: "NOT_A_FILE" };
      }
      if (!isGgufHeader(await readHeader(sourcePath).catch(() => null))) return { ok: false, code: "NOT_GGUF" };
      // Cheap rejection before reading gigabytes: no manifest entry has this size.
      if (!this.manifest.some((entry) => entry.sizeBytes === size)) return { ok: false, code: "SIZE_NOT_IN_MANIFEST" };

      await mkdir(this.modelsDir, { recursive: true });
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
      const entry = this.manifest.find((candidate) => candidate.sha256 === sha256 && candidate.sizeBytes === written);
      if (!entry) {
        await rm(tmp, { force: true });
        return { ok: false, code: "NOT_IN_MANIFEST" };
      }
      try {
        await replaceFileAtomically(tmp, this.modelPath(sha256));
      } catch {
        await rm(tmp, { force: true });
        return { ok: false, code: "COPY_FAILED" };
      }

      await this.writeRegistry({ schemaVersion: 1, active: { sha256, installedAt: new Date(this.now()).toISOString() } });
      // The bytes on disk are the ones just hashed, so this session starts verified.
      const info = await stat(this.modelPath(sha256));
      this.verified.set(sha256, { ok: true, size: info.size, mtimeMs: info.mtimeMs });
      await this.sweep(`${sha256}.gguf`);
      return { ok: true, entry };
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
