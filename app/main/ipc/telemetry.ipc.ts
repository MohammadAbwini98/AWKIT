/**
 * Read-only reporting/telemetry query channels (UI-reports refactor Phase 4). All queries are
 * windowed by a range preset and paginated; aggregation happens in the durable store, not here or
 * in the renderer. Additive — the existing `reports:*` and `execution:*` channels are untouched.
 * See docs/ai/ui-reports-refactor/04_*.md.
 */
import { ipcMain } from "electron";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { executionEngine } from "@src/runner/ExecutionEngine";
import type { MachineFilter, RunHistoryFilter, ServerReport, StorageUsage, TelemetryPage, TelemetryRange, TelemetryRangePreset } from "@src/reports/TelemetryContracts";
import { getConfiguredPaths } from "../storagePaths";

const RANGE_MS: Record<Exclude<TelemetryRangePreset, "all">, number> = {
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000
};

/** Convert a UI preset to a `since` window; `all` (or anything unknown) = all-time. */
function resolveRange(preset: TelemetryRangePreset | undefined): TelemetryRange {
  if (!preset || preset === "all" || !(preset in RANGE_MS)) return {};
  return { sinceIso: new Date(Date.now() - RANGE_MS[preset as Exclude<TelemetryRangePreset, "all">]).toISOString() };
}

/** Bucket size for time-series charts, matched to the range so a chart stays ≤~60 points. */
function bucketMsForPreset(preset: TelemetryRangePreset | undefined): number {
  switch (preset) {
    case "15m":
      return 30_000;
    case "1h":
      return 2 * 60_000;
    case "24h":
      return 30 * 60_000;
    case "7d":
      return 3 * 60 * 60_000;
    default:
      return 60 * 60_000;
  }
}

/** Trend bucket count per preset — a handful of points for a sparkline, more for wider windows. */
function trendBucketsForPreset(preset: TelemetryRangePreset | undefined): number {
  switch (preset) {
    case "15m":
    case "1h":
      return 6;
    case "24h":
      return 12;
    case "7d":
      return 14;
    default:
      return 10;
  }
}

export function registerTelemetryIpc(): void {
  ipcMain.handle("telemetry:overview", async (_, preset?: TelemetryRangePreset) => executionEngine.getTelemetryOverview(resolveRange(preset)));

  ipcMain.handle("telemetry:workflows", async (_, preset?: TelemetryRangePreset) => executionEngine.getTelemetryWorkflows(resolveRange(preset)));

  ipcMain.handle("telemetry:workflowComparison", async (_, preset?: TelemetryRangePreset, machineFilter?: MachineFilter) =>
    executionEngine.getTelemetryWorkflowComparison(resolveRange(preset), machineFilter)
  );

  ipcMain.handle("telemetry:workflowTrend", async (_, scenarioId: string | undefined, preset?: TelemetryRangePreset, machineFilter?: MachineFilter) =>
    executionEngine.getTelemetryWorkflowTrend(scenarioId, resolveRange(preset), trendBucketsForPreset(preset), machineFilter)
  );

  ipcMain.handle("telemetry:machines", async (_, preset?: TelemetryRangePreset) => executionEngine.getTelemetryMachines(resolveRange(preset)));

  ipcMain.handle("telemetry:runHistory", async (_, preset?: TelemetryRangePreset, page?: TelemetryPage, filter?: RunHistoryFilter) =>
    executionEngine.getTelemetryRunHistory(resolveRange(preset), page ?? {}, filter)
  );

  ipcMain.handle("telemetry:runDetail", async (_, instanceId: string) => executionEngine.getTelemetryRunDetail(instanceId));

  ipcMain.handle("telemetry:failures", async (_, preset?: TelemetryRangePreset) => executionEngine.getTelemetryFailures(resolveRange(preset)));

  ipcMain.handle("telemetry:runtimeSeries", async (_, preset?: TelemetryRangePreset) =>
    executionEngine.getTelemetryRuntimeSeries(resolveRange(preset), bucketMsForPreset(preset))
  );

  ipcMain.handle("telemetry:processHistory", async (_, preset?: TelemetryRangePreset, limit?: number) => {
    const range = resolveRange(preset);
    return executionEngine.getTelemetryProcessHistory(range.sinceIso, limit);
  });

  ipcMain.handle("telemetry:server", async (): Promise<ServerReport> => {
    const status = await executionEngine.getRuntimeStatus();
    const storage = await computeStorageCached(status.environment?.sqlitePath);
    return {
      storage,
      systemMemoryPercent: status.capacity.systemMemoryPercent,
      cpuPercent: status.capacity.cpuPercent,
      processRssMb: status.capacity.processRssMb,
      processCpuPercent: status.capacity.processCpuPercent,
      chromiumMemoryMb: status.processes?.chromiumMemoryMb,
      electronMainMemoryMb: status.processes?.electronMainMemoryMb,
      backpressureBlocked: status.capacity.dispatchBlocked,
      backpressureReason: status.capacity.blockedReason,
      processAvailability: status.processes?.availability
    };
  });
}

// ── Storage sizing (cached; disk walks are bounded and best-effort) ──────────

let storageCache: { at: number; value: StorageUsage } | undefined;
const STORAGE_TTL_MS = 60_000;

async function computeStorageCached(sqlitePath: string | undefined): Promise<StorageUsage> {
  if (storageCache && Date.now() - storageCache.at < STORAGE_TTL_MS) return storageCache.value;
  const paths = getConfiguredPaths();
  const [reportsMb, screenshotsMb, logsMb, downloadsMb, runtimeDbMb] = await Promise.all([
    dirSizeMb(paths.reports),
    dirSizeMb(paths.screenshots),
    dirSizeMb(paths.logs),
    dirSizeMb(paths.downloads),
    sqlitePath ? fileSizeMb(sqlitePath) : Promise.resolve(0)
  ]);
  const totalMb = Math.round((reportsMb + screenshotsMb + logsMb + downloadsMb + runtimeDbMb) * 10) / 10;
  const value: StorageUsage = { reportsMb, screenshotsMb, logsMb, downloadsMb, runtimeDbMb, totalMb };
  storageCache = { at: Date.now(), value };
  return value;
}

async function fileSizeMb(path: string): Promise<number> {
  try {
    const info = await stat(path);
    return Math.round((info.size / (1024 * 1024)) * 10) / 10;
  } catch {
    return 0;
  }
}

/** Sum file sizes under a directory. Bounded (≤20k entries), never throws. */
async function dirSizeMb(root: string): Promise<number> {
  let bytes = 0;
  let visited = 0;
  const stack = [root];
  while (stack.length > 0 && visited < 20_000) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      visited += 1;
      if (visited >= 20_000) break;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else {
        try {
          bytes += (await stat(full)).size;
        } catch {
          /* skip unreadable file */
        }
      }
    }
  }
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}
