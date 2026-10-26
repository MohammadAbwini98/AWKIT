/**
 * Offline OCR availability (Phase N, N7.4 / awkit-vra.9.5): the OC-6 flag, the asset and host locations, and the one
 * lazily constructed `OcrUtilityHostManager`.
 *
 * - `AWKIT_VISUAL_OCR=off|observe`, default off. Off (or any other value) means no manager is constructed and no host
 *   is ever forked. N7 has no enforcing mode (OC-11).
 * - Packaged: the assets and the host are staged by scripts/prepare-ocr-assets.mjs into `resources/ocr`
 *   (`getResourcesRoot()/ocr`). Development: the repository host `native-hosts/ocr/ocr-host.cjs` and the staged
 *   `build/ocr` (`npm run prepare:ocr-assets`). Missing either means OCR is not included in this build.
 * - The host verifies each asset against the SHA-256 pinned in `src/offline/ocr-runtime.json`, compiled into the main
 *   bundle here, so a replaced file and a replaced asset manifest are both refused.
 */

import fs from "node:fs";
import path from "node:path";

import { app } from "electron";

import ocrPin from "@src/offline/ocr-runtime.json";
import { getResourcesRoot } from "../appPaths";
import { OcrUtilityHostManager } from "./OcrUtilityHostManager";

export type OcrMode = "off" | "observe";

/** OC-6: only the exact value `observe` turns OCR on. */
export function ocrModeFromEnv(env: NodeJS.ProcessEnv = process.env): OcrMode {
  return env.AWKIT_VISUAL_OCR === "observe" ? "observe" : "off";
}

/** The pinned SHA-256 of each staged asset, by file name. */
export function expectedOcrAssetHashes(): Record<string, string> {
  return Object.fromEntries(ocrPin.files.map((file) => [file.target, file.sha256]));
}

export function resolveOcrPaths(): { assetDir: string; hostPath: string } | null {
  const assetDir = app.isPackaged ? path.join(getResourcesRoot(), "ocr") : path.join(app.getAppPath(), "build", "ocr");
  const hostPath = app.isPackaged ? path.join(assetDir, "ocr-host.cjs") : path.join(app.getAppPath(), "native-hosts", "ocr", "ocr-host.cjs");
  return fs.existsSync(hostPath) && fs.existsSync(assetDir) ? { assetDir, hostPath } : null;
}

let manager: OcrUtilityHostManager | null = null;

/** The OCR host manager, or null when OCR is off or not included. Constructing it forks nothing. */
export function getOcrHostManager(env: NodeJS.ProcessEnv = process.env): OcrUtilityHostManager | null {
  if (ocrModeFromEnv(env) === "off") return null;
  if (manager) return manager;
  const paths = resolveOcrPaths();
  if (!paths) return null;
  manager = new OcrUtilityHostManager({ ...paths, expected: expectedOcrAssetHashes() });
  return manager;
}

export async function disposeOcrHostManager(): Promise<void> {
  const current = manager;
  manager = null;
  await current?.dispose();
}
