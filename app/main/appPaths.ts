import { app } from "electron";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createRuntimePaths, runtimeFolderNames, type RuntimePaths } from "@src/offline/PortablePathResolver";

/** Stable runtime-data folder name under %LOCALAPPDATA% (matches the product name). */
export const RUNTIME_DATA_FOLDER = "WebFlow Studio";

export function getRuntimeDataRoot(): string {
  return join(process.env.LOCALAPPDATA ?? app.getPath("appData"), RUNTIME_DATA_FOLDER);
}

/** Electron's per-user writable data directory (alias for callers that prefer it). */
export function getUserDataPath(): string {
  return app.getPath("userData");
}

/**
 * Single source of truth for whether the app should behave as a packaged,
 * offline-production build: launch the bundled Chromium and never download
 * browsers at runtime.
 *
 * - PRODUCTION_OFFLINE=true  → force on (useful for testing a dev build).
 * - PRODUCTION_OFFLINE=false → force off.
 * - otherwise                → on when the app is packaged, off in dev.
 */
export function isProductionOffline(): boolean {
  if (process.env.PRODUCTION_OFFLINE === "true") return true;
  if (process.env.PRODUCTION_OFFLINE === "false") return false;
  return app.isPackaged;
}

export function getRuntimePaths(): RuntimePaths {
  return createRuntimePaths(getRuntimeDataRoot());
}

export async function ensureRuntimeFolders(paths = getRuntimePaths()): Promise<RuntimePaths> {
  await mkdir(paths.root, { recursive: true });

  await Promise.all(runtimeFolderNames.map((folder) => mkdir(paths.folders[folder], { recursive: true })));

  return paths;
}

/**
 * "dev" | "packaged" for runtime diagnostics. Guarded so callers loaded outside a real
 * Electron process (tsx verify scripts import the engine, where `app` is undefined)
 * safely report "dev" instead of throwing.
 */
export function getAppMode(): "dev" | "packaged" {
  try {
    return app?.isPackaged ? "packaged" : "dev";
  } catch {
    return "dev";
  }
}

export function getResourcesRoot(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "resources");
  }

  return join(process.cwd(), "resources");
}
