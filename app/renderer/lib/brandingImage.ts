import {
  BRANDING_ACCEPTED_INPUT_EXTENSIONS,
  BRANDING_ACCEPTED_INPUT_MIME,
  BRANDING_MAX_BYTES,
  BRANDING_MAX_DIMENSION,
  BRANDING_MIN_DIMENSION
} from "@src/branding/BrandingValidation";

/**
 * Client-side logo pre-processing for the Branding settings card. The renderer is a full Chromium page,
 * so it owns the decode: an `<img>` element (secure image-decoding mode) handles PNG/JPG/JPEG/WEBP AND
 * SVG, and drawing to a canvas caps the size, preserves aspect ratio + transparency, and NORMALIZES
 * every accepted input to a single PNG. The resulting bytes are re-validated independently in the main
 * process — this is a UX/normalization step, never the security boundary.
 *
 * SVG is accepted because it is RASTERIZED here, not stored or rendered as markup: an image loaded via
 * `<img>`/canvas runs in the browser's secure static image mode — scripts never execute, event handlers
 * never fire, and external resources never load — and the source SVG is discarded after we read the
 * canvas back as PNG. A tainted canvas (any cross-origin pixel) makes `toBlob` throw, which we treat as a
 * rejection, so nothing unsafe can ever be stored. Animated GIF/WEBP collapse to a single static frame
 * by construction (we draw one frame), satisfying "reject animated content".
 */

/** Crisp raster size (longest side) for a vector (SVG) logo so a small viewBox still stores sharply. */
const SVG_RASTER_TARGET = 512;

/** `accept` attribute for the file input. */
export const BRANDING_FILE_ACCEPT = [...BRANDING_ACCEPTED_INPUT_MIME, ...BRANDING_ACCEPTED_INPUT_EXTENSIONS].join(",");

/** Human-readable format/size guidance shown under the control. */
export const BRANDING_GUIDANCE = `PNG, JPG, WEBP or SVG · up to 5 MB · ${BRANDING_MIN_DIMENSION}×${BRANDING_MIN_DIMENSION} to ${BRANDING_MAX_DIMENSION}×${BRANDING_MAX_DIMENSION}px`;

export interface NormalizedLogo {
  /** Normalized PNG bytes to send to the main process. */
  bytes: Uint8Array;
  /** `data:image/png;base64,...` preview (no object URL, so nothing to revoke). */
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Validate + normalize a user-selected file to capped PNG bytes. Throws an `Error` with a
 * user-presentable message on any rejection (unsupported/animated/too-big/too-small/corrupt/unsafe).
 */
export async function normalizeLogoFile(file: File): Promise<NormalizedLogo> {
  const type = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();
  const isSvg = type === "image/svg+xml" || name.endsWith(".svg");

  const typeOk = BRANDING_ACCEPTED_INPUT_MIME.includes(type);
  const extOk = BRANDING_ACCEPTED_INPUT_EXTENSIONS.some((ext) => name.endsWith(ext));
  if (!typeOk && !extOk) {
    throw new Error("Unsupported format. Choose a PNG, JPG, WEBP, or SVG image.");
  }
  if (file.size === 0) throw new Error("That file is empty.");
  if (file.size > BRANDING_MAX_BYTES) throw new Error("Image is larger than 5 MB. Choose a smaller file.");

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    // Decodes in the browser's secure image mode (no script execution, no external resource loads) — this
    // is what makes accepting SVG safe. We rasterize to PNG below and discard the source markup.
    try {
      await img.decode();
    } catch {
      throw new Error("This image couldn't be read. It may be corrupted or an unsupported format.");
    }

    let iw = img.naturalWidth;
    let ih = img.naturalHeight;
    if (!iw || !ih) {
      // A dimensionless SVG: rasterize onto a square target so it still stores at a usable size.
      iw = ih = SVG_RASTER_TARGET;
    }
    // Raster inputs must already meet the minimum; vector inputs are scaled to a crisp target below.
    if (!isSvg && (iw < BRANDING_MIN_DIMENSION || ih < BRANDING_MIN_DIMENSION)) {
      throw new Error(`Image is too small. The minimum size is ${BRANDING_MIN_DIMENSION}×${BRANDING_MIN_DIMENSION}px.`);
    }

    const longest = Math.max(iw, ih);
    // Raster: only ever scale DOWN to fit the max box. SVG (vector): render the longest side up to a
    // crisp target (or down to the max), preserving aspect ratio.
    const scale = isSvg
      ? Math.min(BRANDING_MAX_DIMENSION, Math.max(SVG_RASTER_TARGET, longest)) / longest
      : Math.min(1, BRANDING_MAX_DIMENSION / longest);
    const dw = Math.max(1, Math.min(BRANDING_MAX_DIMENSION, Math.round(iw * scale)));
    const dh = Math.max(1, Math.min(BRANDING_MAX_DIMENSION, Math.round(ih * scale)));
    if (dw < BRANDING_MIN_DIMENSION || dh < BRANDING_MIN_DIMENSION) {
      throw new Error(`Image is too small (or too extreme an aspect ratio). The minimum is ${BRANDING_MIN_DIMENSION}×${BRANDING_MIN_DIMENSION}px.`);
    }

    const canvas = document.createElement("canvas");
    canvas.width = dw;
    canvas.height = dh;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't process the image on this system.");
    ctx.clearRect(0, 0, dw, dh); // transparent base — PNG keeps the alpha channel
    ctx.drawImage(img, 0, 0, dw, dh);

    let blob: Blob | null;
    try {
      // A tainted canvas (e.g. an SVG that pulled a cross-origin resource) makes this throw — reject it.
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    } catch {
      throw new Error("This image couldn't be processed securely. Try a different file.");
    }
    if (!blob) throw new Error("Couldn't encode the image.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length > BRANDING_MAX_BYTES) {
      throw new Error("The processed image is larger than 5 MB. Choose a simpler image.");
    }
    const dataUrl = await blobToDataUrl(blob);
    return { bytes, dataUrl, width: dw, height: dh };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Couldn't read the processed image."));
    reader.readAsDataURL(blob);
  });
}
