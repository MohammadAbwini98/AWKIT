import { ipcMain } from "electron";
import type { RuntimeInputProfile } from "../profileStores";
import { createRuntimeInputProfileStore } from "../profileStores";
import { assertSenderPermission } from "../security/sessionContext";
import { Permission } from "@src/security/authz/Permissions";

export function registerRuntimeInputIpc(): void {
  const store = createRuntimeInputProfileStore();

  // AWKIT-SEC-002: mutation-capable channels used to be ungated. Reads require workflow-view
  // (runtime input profiles are consumed by workflow runs); mutations require workflow-edit.
  ipcMain.handle("runtimeInputs:list", async (event) => {
    await assertSenderPermission(event, Permission.WORKFLOW_VIEW);
    return store.list();
  });
  ipcMain.handle("runtimeInputs:get", async (event, id: string) => {
    await assertSenderPermission(event, Permission.WORKFLOW_VIEW);
    return store.get(id);
  });
  ipcMain.handle("runtimeInputs:create", async (event, profile: RuntimeInputProfile) => {
    await assertSenderPermission(event, Permission.WORKFLOW_EDIT);
    return store.create(profile);
  });
  ipcMain.handle("runtimeInputs:update", async (event, id: string, profile: RuntimeInputProfile) => {
    await assertSenderPermission(event, Permission.WORKFLOW_EDIT);
    return store.update(id, profile);
  });
  ipcMain.handle("runtimeInputs:delete", async (event, id: string) => {
    await assertSenderPermission(event, Permission.WORKFLOW_EDIT);
    return store.delete(id);
  });
  ipcMain.handle("runtimeInputs:clone", async (event, id: string, nextId?: string) => {
    await assertSenderPermission(event, Permission.WORKFLOW_EDIT);
    return store.clone(id, nextId);
  });
  ipcMain.handle("runtimeInputs:export", async (event, id: string) => {
    await assertSenderPermission(event, Permission.WORKFLOW_VIEW);
    return store.export(id);
  });
  ipcMain.handle("runtimeInputs:import", async (event, profile: RuntimeInputProfile) => {
    await assertSenderPermission(event, Permission.WORKFLOW_EDIT);
    return store.import(profile);
  });
}
