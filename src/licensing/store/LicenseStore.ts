/**
 * Adaptive, per-machine license storage. Kept free of Electron so it is unit-verifiable; the main process
 * injects the resolved directories.
 *
 * Storage decision (see docs/security + AI memory `licensing-storage-decision`):
 * - PRIMARY  %LOCALAPPDATA%\SpecterStudio\Licensing\license.dat — per-user, so activation/update/run never
 *   need administrator rights. All normal writes go here.
 * - OPTIONAL %PROGRAMDATA%\SpecterStudio\Licensing\license.dat — machine-wide, READ-ONLY here. Used only
 *   when an admin/corporate deployment has already provisioned it. Never elevate, never create/overwrite it.
 * - Read order: valid ProgramData license first, else LocalAppData. If BOTH are valid, prefer the
 *   provisioned (ProgramData) one and flag a conflict for the UI. Machine binding is enforced by the SIGNED
 *   fingerprint in the payload — NOT by which directory holds the file — so a copied file fails MACHINE_MISMATCH.
 *
 * The file is treated as untrusted input: envelopes are checksum-verified (corruption detection) and every
 * license is re-verified (signature + fingerprint) by the validator on every load. Writes are atomic.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LicenseDocument } from "../LicenseTypes";

export const LICENSE_STORE_VERSION = 1 as const;
export const LICENSE_FILE_NAME = "license.dat";

export interface LicenseMeta {
  importedAtUtc: string;
  lastValidatedUtc?: string;
  /** Highest wall-clock time observed by this store, for rollback detection. */
  clockHighWaterUtc: string;
  locallyRevoked: boolean;
}

export interface LicenseEnvelope {
  storeVersion: number;
  license: LicenseDocument;
  meta: LicenseMeta;
  /** SHA-256 over the canonical {license, meta}; mismatch ⇒ corruption/tampering. */
  checksum: string;
}

export type LicenseSource = "shared" | "local";

export interface LoadResult {
  envelope: LicenseEnvelope | null;
  source: LicenseSource | null;
  /** True when a file existed but failed to parse or its checksum did not match. */
  corrupted: boolean;
  /** True when BOTH locations hold a readable license (precedence applied: shared wins). */
  conflict: boolean;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

export function computeChecksum(license: LicenseDocument, meta: LicenseMeta): string {
  return createHash("sha256").update(stableStringify({ license, meta })).digest("hex");
}

export function buildEnvelope(license: LicenseDocument, meta: LicenseMeta): LicenseEnvelope {
  return { storeVersion: LICENSE_STORE_VERSION, license, meta, checksum: computeChecksum(license, meta) };
}

/** Parse + integrity-check a raw file body. Returns null on any corruption (never throws). */
function readEnvelope(path: string): { envelope: LicenseEnvelope | null; corrupted: boolean } {
  if (!existsSync(path)) return { envelope: null, corrupted: false };
  try {
    const raw = readFileSync(path, "utf8").replace(/^﻿/, "");
    const parsed = JSON.parse(raw) as LicenseEnvelope;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.storeVersion !== LICENSE_STORE_VERSION ||
      !parsed.license ||
      !parsed.meta ||
      typeof parsed.checksum !== "string"
    ) {
      return { envelope: null, corrupted: true };
    }
    if (computeChecksum(parsed.license, parsed.meta) !== parsed.checksum) {
      return { envelope: null, corrupted: true };
    }
    return { envelope: parsed, corrupted: false };
  } catch {
    return { envelope: null, corrupted: true };
  }
}

export class LicenseStore {
  private readonly localFile: string;
  private readonly sharedFile: string | null;

  constructor(localDir: string, sharedDir?: string | null) {
    this.localFile = join(localDir, LICENSE_FILE_NAME);
    this.sharedFile = sharedDir ? join(sharedDir, LICENSE_FILE_NAME) : null;
  }

  get localPath(): string {
    return this.localFile;
  }

  get sharedPath(): string | null {
    return this.sharedFile;
  }

  /**
   * Resolve the active envelope with the documented precedence: a readable provisioned (shared) license
   * wins over a local one; if both are readable, flag a conflict. Corruption of the CHOSEN source is
   * surfaced via `corrupted` so the caller can report LICENSE_FILE_CORRUPTED.
   */
  load(): LoadResult {
    const shared = this.sharedFile ? readEnvelope(this.sharedFile) : { envelope: null, corrupted: false };
    const local = readEnvelope(this.localFile);
    const conflict = shared.envelope != null && local.envelope != null;

    if (shared.envelope) return { envelope: shared.envelope, source: "shared", corrupted: false, conflict };
    if (local.envelope) return { envelope: local.envelope, source: "local", corrupted: false, conflict };

    // No readable envelope — report corruption if a file existed but failed integrity (prefer shared).
    if (shared.corrupted) return { envelope: null, source: "shared", corrupted: true, conflict: false };
    if (local.corrupted) return { envelope: null, source: "local", corrupted: true, conflict: false };
    return { envelope: null, source: null, corrupted: false, conflict: false };
  }

  /** Atomically write the envelope to the per-user LocalAppData location (never to ProgramData). */
  saveLocal(envelope: LicenseEnvelope): void {
    const dir = join(this.localFile, "..");
    mkdirSync(dir, { recursive: true });
    const tmp = `${this.localFile}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, JSON.stringify(envelope), { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, this.localFile); // atomic replace on the same filesystem
  }

  /** Remove ONLY the local license. The shared/provisioned license is never modified here. */
  removeLocal(): void {
    try {
      rmSync(this.localFile, { force: true });
    } catch {
      // best-effort; a missing file is success
    }
  }
}
