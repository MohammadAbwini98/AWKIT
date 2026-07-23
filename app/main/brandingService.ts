import { nativeImage } from "electron";
import { getRuntimePaths } from "./appPaths";
import { BrandingLogoStore } from "@src/branding/BrandingLogoStore";

/**
 * Main-process wiring for the custom workspace logo (lazy singleton, mirroring `oracleService.ts`).
 * The framework-agnostic {@link BrandingLogoStore} owns the on-disk asset under the dedicated
 * `%LOCALAPPDATA%/SpecterStudio/branding/` runtime folder; here we inject the Electron-only real-pixel
 * decode used to reject corrupt images that merely carry a valid-looking PNG header.
 */

let store: BrandingLogoStore | null = null;

/** Electron `nativeImage` decode gate: the buffer is already verified to be PNG by the store. */
function decodeAndVerify(bytes: Uint8Array): { width: number; height: number } | null {
  try {
    const image = nativeImage.createFromBuffer(Buffer.from(bytes));
    // createFromBuffer does NOT reliably throw on malformed input — it returns an empty image instead,
    // so the emptiness check (not just try/catch) is what enforces "fall back on any corrupt state".
    if (image.isEmpty()) return null;
    const size = image.getSize();
    if (!size || size.width <= 0 || size.height <= 0) return null;
    return { width: size.width, height: size.height };
  } catch {
    return null;
  }
}

export function getBrandingStore(): BrandingLogoStore {
  if (!store) {
    store = new BrandingLogoStore({ folder: getRuntimePaths().folders.branding, decodeAndVerify });
  }
  return store;
}
