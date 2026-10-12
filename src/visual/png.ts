import { inflateSync } from "node:zlib";

import type { PixelRect } from "./geometry";

/**
 * A minimal, pure PNG decoder for Visual Intelligence (Phase N, N0): 8-bit RGB or RGBA, non-interlaced, filter types
 * 0-4 — exactly what Chromium's screenshot encoder emits. Anything else is refused rather than guessed at. No native
 * dependency, no disk access, no network.
 *
 * Decoded pixels live only in memory. `VisualImage` serialises to a size summary (never its bytes), so a capture
 * that ends up in a log or a JSON report cannot leak the image.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Upper bound on decoded pixels (about 64 MP, 256 MB RGBA), so a hostile or corrupt header cannot exhaust memory. */
export const VISUAL_MAX_PIXELS = 64 * 1024 * 1024;

const INSPECT = Symbol.for("nodejs.util.inspect.custom");

/** RGBA pixels, row-major, 4 bytes per pixel. */
export class VisualImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;

  constructor(width: number, height: number, data: Uint8Array) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || data.length !== width * height * 4) {
      throw new Error("VisualImage dimensions do not match its data");
    }
    this.width = width;
    this.height = height;
    this.data = data;
  }

  /** Bytes are never serialised. */
  toJSON(): { width: number; height: number; bytes: "[omitted]" } {
    return { width: this.width, height: this.height, bytes: "[omitted]" };
  }

  [INSPECT](): string {
    return `VisualImage(${this.width}x${this.height}, bytes omitted)`;
  }
}

export class PngDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PngDecodeError";
  }
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

/** Decode a PNG to RGBA. Throws `PngDecodeError` for anything outside the supported subset or any truncation. */
export function decodePng(input: Uint8Array): VisualImage {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < PNG_SIGNATURE.length + 12) throw new PngDecodeError("too short to be a PNG");
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new PngDecodeError("missing PNG signature");
  }

  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let sawHeader = false;
  let sawEnd = false;
  const idat: Uint8Array[] = [];
  let idatLength = 0;

  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) throw new PngDecodeError("truncated chunk");

    if (type === "IHDR") {
      if (length !== 13 || sawHeader) throw new PngDecodeError("bad IHDR");
      width = readUint32(bytes, dataStart);
      height = readUint32(bytes, dataStart + 4);
      const bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      const compression = bytes[dataStart + 10];
      const filterMethod = bytes[dataStart + 11];
      const interlace = bytes[dataStart + 12];
      if (bitDepth !== 8) throw new PngDecodeError("unsupported bit depth");
      if (colorType !== 2 && colorType !== 6) throw new PngDecodeError("unsupported colour type");
      if (compression !== 0 || filterMethod !== 0) throw new PngDecodeError("unsupported compression or filter method");
      if (interlace !== 0) throw new PngDecodeError("interlaced PNG is unsupported");
      if (width === 0 || height === 0 || width * height > VISUAL_MAX_PIXELS) throw new PngDecodeError("unsupported image size");
      sawHeader = true;
    } else if (type === "IDAT") {
      if (!sawHeader) throw new PngDecodeError("IDAT before IHDR");
      idat.push(bytes.subarray(dataStart, dataEnd));
      idatLength += length;
    } else if (type === "IEND") {
      sawEnd = true;
      break;
    }
    offset = dataEnd + 4; // Skip the CRC.
  }

  if (!sawHeader || !sawEnd || idat.length === 0) throw new PngDecodeError("missing IHDR, IDAT or IEND");

  const compressed = new Uint8Array(idatLength);
  let at = 0;
  for (const part of idat) {
    compressed.set(part, at);
    at += part.length;
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const expected = (stride + 1) * height;
  let raw: Uint8Array;
  try {
    raw = inflateSync(compressed, { maxOutputLength: expected + 1 });
  } catch {
    throw new PngDecodeError("image data does not inflate");
  }
  if (raw.length !== expected) throw new PngDecodeError("image data has the wrong length");

  const out = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  let current = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart];
    for (let x = 0; x < stride; x++) {
      const value = raw[rowStart + 1 + x];
      const left = x >= channels ? current[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      let decoded: number;
      switch (filter) {
        case 0:
          decoded = value;
          break;
        case 1:
          decoded = value + left;
          break;
        case 2:
          decoded = value + up;
          break;
        case 3:
          decoded = value + ((left + up) >> 1);
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          decoded = value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
          break;
        }
        default:
          throw new PngDecodeError("unknown row filter");
      }
      current[x] = decoded & 0xff;
    }
    const outRow = y * width * 4;
    for (let x = 0; x < width; x++) {
      const src = x * channels;
      const dst = outRow + x * 4;
      out[dst] = current[src];
      out[dst + 1] = current[src + 1];
      out[dst + 2] = current[src + 2];
      out[dst + 3] = channels === 4 ? current[src + 3] : 255;
    }
    const swap = previous;
    previous = current;
    current = swap;
  }
  return new VisualImage(width, height, out);
}

/** Copy a region of an image. The rectangle must already be clamped to the image. */
export function cropImage(image: VisualImage, rect: PixelRect): VisualImage {
  if (
    !Number.isInteger(rect.x) ||
    !Number.isInteger(rect.y) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.x + rect.width > image.width ||
    rect.y + rect.height > image.height
  ) {
    throw new RangeError("crop rectangle is outside the image");
  }
  const out = new Uint8Array(rect.width * rect.height * 4);
  for (let row = 0; row < rect.height; row++) {
    const start = ((rect.y + row) * image.width + rect.x) * 4;
    out.set(image.data.subarray(start, start + rect.width * 4), row * rect.width * 4);
  }
  return new VisualImage(rect.width, rect.height, out);
}
