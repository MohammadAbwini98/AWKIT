import { ipcMain } from "electron";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import { createFlowProfileStore } from "../profileStores";
import { assertSenderPermission } from "../security/sessionContext";
import { Permission } from "@src/security/authz/Permissions";

export function registerFlowIpc(): void {
  const store = createFlowProfileStore();

  ipcMain.handle("flows:list", async () => store.list());
  ipcMain.handle("flows:get", async (_, id: string) => store.get(id));
  ipcMain.handle("flows:create", async (event, profile: FlowProfile) => {
    await assertSenderPermission(event, Permission.WORKFLOW_CREATE);
    return store.create(profile);
  });
  ipcMain.handle("flows:update", async (event, id: string, profile: FlowProfile) => {
    await assertSenderPermission(event, Permission.WORKFLOW_EDIT);
    return store.update(id, profile);
  });
  ipcMain.handle("flows:delete", async (event, id: string) => {
    await assertSenderPermission(event, Permission.WORKFLOW_DELETE);
    return store.delete(id);
  });
  ipcMain.handle("flows:clone", async (event, id: string, nextId?: string) => {
    await assertSenderPermission(event, Permission.WORKFLOW_CREATE);
    return store.clone(id, nextId);
  });
  ipcMain.handle("flows:export", async (_, id: string) => store.export(id));
  ipcMain.handle("flows:import", async (event, profile: FlowProfile) => {
    await assertSenderPermission(event, Permission.WORKFLOW_CREATE);
    return store.import(profile);
  });

  ipcMain.handle("flow:list", async () => store.list());
}
