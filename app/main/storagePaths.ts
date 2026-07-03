import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getRuntimePaths } from "./appPaths";

export interface ConfiguredPaths {
  screenshots: string;
  flows: string;
  workflows: string;
  dataSources: string;
  reports: string;
  logs: string;
  downloads: string;
}

/** Read just the `paths` object from the persisted settings file (sync, best-effort). */
function readSettingsPaths(): Record<string, string> {
  try {
    const settingsFile = join(getRuntimePaths().folders.storage, "ui-settings.json");
    const parsed = JSON.parse(readFileSync(settingsFile, "utf8").replace(/^﻿/, "")) as { paths?: Record<string, string> };
    return parsed.paths ?? {};
  } catch {
    return {};
  }
}

/**
 * Use a configured path if it is set and creatable; otherwise fall back to the
 * default runtime folder. Never throws — writers always get a usable directory.
 */
function ensureOrFallback(configured: string | undefined, fallback: string): string {
  const target = configured && configured.trim() ? configured : fallback;
  try {
    mkdirSync(target, { recursive: true });
    return target;
  } catch {
    if (target !== fallback) {
      console.warn(`[paths] Configured path "${target}" is not writable; falling back to "${fallback}".`);
    }
    try {
      mkdirSync(fallback, { recursive: true });
    } catch {
      // The default runtime folder should always be writable; if not, the
      // startup writability checks will have already surfaced the problem.
    }
    return fallback;
  }
}

/**
 * Resolves the effective storage directories, honoring the user's custom paths
 * from Settings and falling back to the runtime-data folders when unset/invalid.
 */
export function getConfiguredPaths(): ConfiguredPaths {
  const folders = getRuntimePaths().folders;
  const p = readSettingsPaths();
  return {
    screenshots: ensureOrFallback(p.screenshotsPath, folders.screenshots),
    flows: ensureOrFallback(p.flowsPath, folders.flows),
    workflows: ensureOrFallback(p.workflowsPath, folders.workflows),
    dataSources: ensureOrFallback(p.dataSourcesPath, folders.data),
    reports: ensureOrFallback(p.reportsPath, folders.reports),
    logs: ensureOrFallback(p.logsPath, folders.logs),
    downloads: ensureOrFallback(p.downloadsPath, folders.downloads)
  };
}
