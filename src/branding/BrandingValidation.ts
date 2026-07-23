/**
 * Pure validation for the custom workspace-logo feature (Settings → Appearance → Branding). No
 * Electron / DOM — shared by the framework-agnostic {@link BrandingLogoStore} (main process, on-disk
 * asset) and the renderer pre-checks, and unit-tested by `scripts/verify-branding.mts`.
 *
 * The active custom logo is ALWAYS stored as PNG: the renderer normalizes every accepted upload
 * (PNG/JPG/JPEG/WEBP/SVG) to PNG via a canvas before it ever reaches the main process, so on-disk
 * storage, re-validation, and re-display only ever deal with one format. These helpers therefore
 * validate PNG bytes; input-format gating (the accept list) lives in the renderer helper.
 */

/** Hard cap on the stored logo (also enforced on the raw upload before normalization). */
export const BRANDING_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
/** Minimum accepted square dimension (px). */
export const BRANDING_MIN_DIMENSION = 32;
/** Maximum accepted dimension (px). Larger uploads are scaled down (aspect-preserved) in the renderer. */
export const BRANDING_MAX_DIMENSION = 2048;

/**
 * Accepted upload MIME types (input side). SVG is accepted and safely RASTERIZED to PNG at import in the
 * browser's secure image-decoding mode (scripts never run, external resources never load); the SVG markup
 * is never stored and never injected into the DOM, so no separate SVG sanitizer is required.
 */
export const BRANDING_ACCEPTED_INPUT_MIME: readonly string[] = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
/** Accepted upload file extensions (input side), used as a fallback when a browser reports no MIME. */
export const BRANDING_ACCEPTED_INPUT_EXTENSIONS: readonly string[] = [".png", ".jpg", ".jpeg", ".webp", ".svg"];

/** The 8-byte PNG file signature. */
export const PNG_SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Structured rejection reasons (kept stable — surfaced in the audit trail + UI messages). */
export type BrandingRejectReason =
  | "empty"
  | "too-large"
  | "not-png"
  | "decode-failed"
  | "dimensions-out-of-range";

/** True when the buffer begins with the exact PNG magic bytes (a real signature check, not extension). */
export function hasPngSignature(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

/**
 * Read a PNG's pixel dimensions from its IHDR chunk (the first chunk, immediately after the signature).
 * Returns null for anything that is not a well-formed PNG header. This is a structural read of the
 * declared size — the main process additionally re-decodes the pixels via `nativeImage` to prove the
 * image is not merely a valid-looking header over corrupt data.
 */
export function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  // signature(8) + length(4) + "IHDR"(4) + width(4) + height(4) = need at least 24 bytes.
  if (!hasPngSignature(bytes) || bytes.length < 24) return null;
  // Bytes 12–15 must spell "IHDR".
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

/** True when a dimension is an integer within the accepted [MIN, MAX] range. */
export function isDimensionInRange(value: number): boolean {
  return Number.isInteger(value) && value >= BRANDING_MIN_DIMENSION && value <= BRANDING_MAX_DIMENSION;
}

export type PngBytesCheck = { ok: true } | { ok: false; reason: BrandingRejectReason };

/**
 * Validate normalized PNG bytes by structure alone (signature + size + IHDR dimensions). The main
 * process runs this first, then layers a real pixel decode on top. Deterministic and Electron-free so
 * the same rules are exercised by the pure verifier.
 */
export function checkPngBytes(bytes: Uint8Array): PngBytesCheck {
  if (!bytes || bytes.length === 0) return { ok: false, reason: "empty" };
  if (bytes.length > BRANDING_MAX_BYTES) return { ok: false, reason: "too-large" };
  if (!hasPngSignature(bytes)) return { ok: false, reason: "not-png" };
  const dims = readPngDimensions(bytes);
  if (!dims) return { ok: false, reason: "not-png" };
  if (!isDimensionInRange(dims.width) || !isDimensionInRange(dims.height)) {
    return { ok: false, reason: "dimensions-out-of-range" };
  }
  return { ok: true };
}
