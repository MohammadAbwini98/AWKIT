import { ipcMain, shell, app } from "electron";
import { existsSync } from "node:fs";
import { access, constants } from "node:fs/promises";
import {
  clearUiState,
  getDefaultPaths,
  getUiSettings,
  replaceUiSettings,
  resetUiSettings,
  updateUiSettings,
  validateSettings,
  type DeepPartial,
  type UiSettings
} from "../uiSettings";
import { getRuntimeDataRoot, isProductionOffline } from "../appPaths";
import { applyRuntimeConcurrencyFromSettings } from "./execution.ipc";
import {
  createDataSourceProfileStore,
  createFlowProfileStore,
  createReportStore,
  createWorkflowProfileStore
} from "../profileStores";

async function countSafe(list: () => Promise<unknown[]>): Promise<number> {
  try {
    return (await list()).length;
  } catch {
    return 0;
  }
}

async function checkPath(path: string): Promise<{ path: string; exists: boolean; writable: boolean }> {
  const exists = !!path && existsSync(path);
  let writable = false;
  if (exists) {
    try {
      await access(path, constants.W_OK);
      writable = true;
    } catch {
      writable = false;
    }
  }
  return { path, exists, writable };
}

export function registerSettingsIpc(): void {
  ipcMain.handle("settings:get", async () => getUiSettings());
  // After any mutation that can change the runtime caps, push them into the engine so the idle Chrome
  // Consumption gauges + admission reflect the new values immediately (best-effort, never blocks).
  const applyConcurrency = () => void applyRuntimeConcurrencyFromSettings();
  ipcMain.handle("settings:update", async (_, patch: DeepPartial<UiSettings>) => {
    const next = await updateUiSettings(patch);
    applyConcurrency();
    return next;
  });
  ipcMain.handle("settings:reset", async () => {
    const next = await resetUiSettings();
    applyConcurrency();
    return next;
  });
  ipcMain.handle("settings:clearUiState", async () => clearUiState());
  ipcMain.handle("settings:export", async () => getUiSettings());
  ipcMain.handle("settings:import", async (_, incoming: unknown) => {
    const next = await replaceUiSettings(incoming);
    applyConcurrency();
    return next;
  });
  ipcMain.handle("settings:validate", async () => validateSettings(await getUiSettings()));

  ipcMain.handle("settings:getDefaultPaths", async () => getDefaultPaths());
  ipcMain.handle("settings:openRuntimeFolder", async () => shell.openPath(getRuntimeDataRoot()));

  ipcMain.handle("settings:getStorageStats", async () => {
    const [flows, workflows, dataSources, reports] = await Promise.all([
      countSafe(() => createFlowProfileStore().list()),
      countSafe(() => createWorkflowProfileStore().list()),
      countSafe(() => createDataSourceProfileStore().list()),
      countSafe(() => createReportStore().list())
    ]);
    return {
      appVersion: app.getVersion(),
      runtimeDataRoot: getRuntimeDataRoot(),
      productionOffline: isProductionOffline(),
      flows,
      workflows,
      dataSources,
      reports
    };
  });

  ipcMain.handle("settings:validatePaths", async () => {
    const { paths } = await getUiSettings();
    const entries = await Promise.all(
      Object.entries(paths).map(async ([key, value]) => [key, await checkPath(value)] as const)
    );
    return Object.fromEntries(entries) as Record<keyof UiSettings["paths"], Awaited<ReturnType<typeof checkPath>>>;
  });
}
