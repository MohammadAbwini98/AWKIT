import { ipcMain } from "electron";
import { join } from "node:path";
import { SessionCaptureService } from "@src/session/SessionCaptureService";
import { getRuntimeDataRoot } from "../appPaths";
import { assertSenderPermission } from "../security/sessionContext";
import { assertTrustedSender } from "./senderGuard";
import { Permission } from "@src/security/authz/Permissions";

let service: SessionCaptureService | null = null;

function getService(): SessionCaptureService {
  if (!service) {
    const profilesRoot = join(getRuntimeDataRoot(), "profiles");
    service = new SessionCaptureService(profilesRoot);
  }
  return service;
}

export function registerSessionIpc(): void {
  // AWKIT-SEC-002: every session channel is authorization-gated. Captured login-session profiles
  // are security-sensitive data (and `delete` recursively removes a profile directory), so the
  // whole surface requires Recorder-page capability; `startCapture` additionally keeps its
  // trusted-sender check.
  ipcMain.handle("session:list", async (event) => {
    await assertSenderPermission(event, Permission.PAGE_RECORDER);
    return getService().list();
  });

  ipcMain.handle("session:startCapture", async (event, args: { name: string; targetUrl: string }) => {
    assertTrustedSender(event);
    await assertSenderPermission(event, Permission.PAGE_RECORDER);
    return getService().startCapture(args.name, args.targetUrl);
  });

  ipcMain.handle("session:getStatus", async (event) => {
    await assertSenderPermission(event, Permission.PAGE_RECORDER);
    return getService().getStatus();
  });

  ipcMain.handle("session:delete", async (event, id: string) => {
    await assertSenderPermission(event, Permission.PAGE_RECORDER);
    await getService().deleteProfile(id);
  });

  ipcMain.handle("session:rename", async (event, args: { id: string; newName: string }) => {
    await assertSenderPermission(event, Permission.PAGE_RECORDER);
    return getService().rename(args.id, args.newName);
  });

  ipcMain.handle("session:detectBrowser", async (event) => {
    await assertSenderPermission(event, Permission.PAGE_RECORDER);
    return getService().detectBrowser();
  });

  ipcMain.handle("session:stopCapture", async (event) => {
    await assertSenderPermission(event, Permission.PAGE_RECORDER);
    getService().stopCapture();
  });

  ipcMain.handle("session:getById", async (event, id: string) => {
    await assertSenderPermission(event, Permission.PAGE_RECORDER);
    return getService().getById(id);
  });

  ipcMain.handle("session:markUsed", async (event, id: string) => {
    await assertSenderPermission(event, Permission.PAGE_RECORDER);
    await getService().markUsed(id);
  });
}

/** Expose the singleton for execution.ipc to resolve session profiles at run time. */
export function getSessionService(): SessionCaptureService {
  return getService();
}
