import { ipcMain } from "electron";
import { join } from "node:path";
import { SessionCaptureService } from "@src/session/SessionCaptureService";
import { getRuntimeDataRoot } from "../appPaths";

let service: SessionCaptureService | null = null;

function getService(): SessionCaptureService {
  if (!service) {
    const profilesRoot = join(getRuntimeDataRoot(), "profiles");
    service = new SessionCaptureService(profilesRoot);
  }
  return service;
}

export function registerSessionIpc(): void {
  ipcMain.handle("session:list", async () => {
    return getService().list();
  });

  ipcMain.handle("session:startCapture", async (_, args: { name: string; targetUrl: string }) => {
    return getService().startCapture(args.name, args.targetUrl);
  });

  ipcMain.handle("session:getStatus", async () => {
    return getService().getStatus();
  });

  ipcMain.handle("session:delete", async (_, id: string) => {
    await getService().deleteProfile(id);
  });

  ipcMain.handle("session:rename", async (_, args: { id: string; newName: string }) => {
    return getService().rename(args.id, args.newName);
  });

  ipcMain.handle("session:detectBrowser", async () => {
    return getService().detectBrowser();
  });

  ipcMain.handle("session:stopCapture", async () => {
    getService().stopCapture();
  });

  ipcMain.handle("session:getById", async (_, id: string) => {
    return getService().getById(id);
  });

  ipcMain.handle("session:markUsed", async (_, id: string) => {
    await getService().markUsed(id);
  });
}

/** Expose the singleton for execution.ipc to resolve session profiles at run time. */
export function getSessionService(): SessionCaptureService {
  return getService();
}
