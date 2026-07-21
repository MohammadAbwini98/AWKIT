import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BRANDING_MAX_BYTES,
  checkPngBytes,
  hasPngSignature,
  isDimensionInRange,
  readPngDimensions,
  type BrandingRejectReason
} from "./BrandingValidation";

/**
 * Managed on-disk storage for the Super-User custom workspace logo. Framework-agnostic (no Electron /
 * React) — the same stage-then-atomic-publish pattern used by {@link OracleDriverBundleStore}, but for a
 * SINGLE active asset instead of a named collection.
 *
 * Layout under `<folder>` (a dedicated runtime folder — never `resources/` / `app.asar`):
 *   active/logo.png        the normalized PNG (renderer already collapsed every format to PNG)
 *   active/manifest.json   { mimeType, width, height, sizeBytes, sha256, updatedAt, updatedByUserId }
 *
 * The managed folder is the SOLE source of truth (deliberately NOT mirrored into ui-settings.json), so
 * "is a custom logo active?" can never drift from the actual file. {@link get} never throws and returns
 * `active: false` on ANY inconsistency (missing file, bad JSON, hash mismatch, out-of-range or
 * undecodable image) so the sidebar always falls back to the built-in icon and never shows a broken
 * image. The original source file is never referenced — only the copied, hashed PNG is kept.
 */

export interface BrandingManifest {
  mimeType: "image/png";
  width: number;
  height: number;
  sizeBytes: number;
  /** sha256 of the stored PNG, re-verified on every read (tamper/corruption detection). */
  sha256: string;
  updatedAt: string;
  /** Authorized Super User who set it (audit correlation). Never a source path. */
  updatedByUserId?: string | null;
}

export interface BrandingState {
  active: boolean;
  manifest?: BrandingManifest;
  /** Absolute path to the managed PNG. Main-process read only — never surfaced to the renderer. */
  logoPath?: string;
}

/** Injected real-pixel decode (main process supplies `nativeImage`). Returns null when undecodable. */
export type DecodeVerifyFn = (bytes: Uint8Array) => { width: number; height: number } | null;

export type BrandingReplaceResult =
  | { ok: true; manifest: BrandingManifest }
  | { ok: false; reason: BrandingRejectReason | "write-failed" };

const ACTIVE_DIR = "active";
const LOGO_FILE = "logo.png";
const MANIFEST_FILE = "manifest.json";

export class BrandingLogoStore {
  constructor(private readonly options: { folder: string; decodeAndVerify?: DecodeVerifyFn }) {}

  private get root(): string {
    return this.options.folder;
  }
  private get activeDir(): string {
    return join(this.root, ACTIVE_DIR);
  }
  private get logoPath(): string {
    return join(this.activeDir, LOGO_FILE);
  }
  private get manifestPath(): string {
    return join(this.activeDir, MANIFEST_FILE);
  }

  /**
   * Resolve the current branding state. NEVER throws: any missing/corrupt/tampered/out-of-range state
   * collapses to `{ active: false }` so the caller falls back to the default icon.
   */
  get(): BrandingState {
    try {
      if (!existsSync(this.manifestPath) || !existsSync(this.logoPath)) return { active: false };
      const manifest = JSON.parse(readFileSync(this.manifestPath, "utf8").replace(/^﻿/, "")) as BrandingManifest;
      const bytes = readFileSync(this.logoPath);
      if (!hasPngSignature(bytes)) return { active: false };
      if (bytes.length !== manifest.sizeBytes || bytes.length > BRANDING_MAX_BYTES) return { active: false };
      if (sha256(bytes) !== manifest.sha256) return { active: false };
      const dims = readPngDimensions(bytes);
      if (!dims || !isDimensionInRange(dims.width) || !isDimensionInRange(dims.height)) return { active: false };
      // Strong gate (main process): the header may claim a valid size over corrupt pixels — require a
      // real decode when a verifier is available.
      if (this.options.decodeAndVerify && !this.options.decodeAndVerify(bytes)) return { active: false };
      return { active: true, manifest, logoPath: this.logoPath };
    } catch {
      return { active: false };
    }
  }

  /** Raw active PNG bytes for display encoding (main only), or null when no valid logo is active. */
  readActiveBytes(): Buffer | null {
    const state = this.get();
    if (!state.active || !state.logoPath) return null;
    try {
      return readFileSync(state.logoPath);
    } catch {
      return null;
    }
  }

  /**
   * Validate + atomically publish a new logo. Validation failure or a mid-swap error leaves the
   * PREVIOUS logo untouched (the old asset is moved aside and restored on failure). `bytes` must
   * already be normalized PNG (the renderer guarantees this; we re-validate, never trust it).
   */
  async replace(bytes: Uint8Array, meta: { updatedByUserId?: string | null } = {}): Promise<BrandingReplaceResult> {
    const structural = checkPngBytes(bytes);
    if (!structural.ok) return { ok: false, reason: structural.reason };
    const dims = readPngDimensions(bytes)!; // checkPngBytes already proved this is present + in range.
    if (this.options.decodeAndVerify) {
      const decoded = this.options.decodeAndVerify(bytes);
      if (!decoded) return { ok: false, reason: "decode-failed" };
      if (!isDimensionInRange(decoded.width) || !isDimensionInRange(decoded.height)) {
        return { ok: false, reason: "dimensions-out-of-range" };
      }
    }

    mkdirSync(this.root, { recursive: true });
    const stamp = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const staging = join(this.root, `.staging-${stamp}`);
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    try {
      const manifest: BrandingManifest = {
        mimeType: "image/png",
        width: dims.width,
        height: dims.height,
        sizeBytes: bytes.length,
        sha256: sha256(bytes),
        updatedAt: new Date().toISOString(),
        updatedByUserId: meta.updatedByUserId ?? null
      };
      writeFileSync(join(staging, LOGO_FILE), bytes);
      writeFileSync(join(staging, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + "\n", "utf8");
      this.publish(staging, stamp);
      return { ok: true, manifest };
    } catch (err) {
      rmSync(staging, { recursive: true, force: true });
      return { ok: false, reason: "write-failed" };
    }
  }

  /** Remove the custom logo (restore the built-in default). Idempotent. */
  remove(): void {
    rmSync(this.activeDir, { recursive: true, force: true });
  }

  /**
   * Swap a fully-written staging dir into `active/`. Directory renames over an existing target are not
   * reliably atomic on Windows, so move the current `active/` aside first and restore it if the publish
   * fails — a failed replace therefore always preserves the previously-active logo.
   */
  private publish(staging: string, stamp: string): void {
    const backup = join(this.root, `.old-${stamp}`);
    const hadActive = existsSync(this.activeDir);
    if (hadActive) renameSync(this.activeDir, backup);
    try {
      renameSync(staging, this.activeDir);
    } catch (err) {
      if (hadActive && existsSync(backup) && !existsSync(this.activeDir)) {
        try {
          renameSync(backup, this.activeDir);
        } catch {
          /* leave the backup dir in place for manual recovery rather than losing the old logo */
        }
      }
      throw err;
    }
    if (hadActive) rmSync(backup, { recursive: true, force: true });
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
