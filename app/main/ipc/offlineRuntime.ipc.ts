import { ipcMain } from "electron";
import { getOfflineRuntimeStatus } from "../offlineRuntimeValidator";

export function registerOfflineRuntimeIpc(): void {
  ipcMain.handle("offlineRuntime:getStatus", async () => getOfflineRuntimeStatus());
}
