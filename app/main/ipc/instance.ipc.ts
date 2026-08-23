import { ipcMain } from "electron";
import type { InstanceProfile } from "../profileStores";
import { createInstanceProfileStore } from "../profileStores";
import { assertSenderPermission } from "../security/sessionContext";
import { Permission } from "@src/security/authz/Permissions";

export function registerInstanceIpc(): void {
  const store = createInstanceProfileStore();

  // AWKIT-SEC-002: the full CRUD surface used to be ungated. Reads require the Instances page;
  // mutations are run-configuration changes and require workflow-edit capability.
  ipcMain.handle("instances:list", async (event) => {
    await assertSenderPermission(event, Permission.PAGE_INSTANCES);
    return ensureDefaultInstanceProfile(store);
  });
  ipcMain.handle("instances:get", async (event, id: string) => {
    await assertSenderPermission(event, Permission.PAGE_INSTANCES);
    return store.get(id);
  });
  ipcMain.handle("instances:create", async (event, profile: InstanceProfile) => {
    await assertSenderPermission(event, Permission.WORKFLOW_EDIT);
    return store.create(profile);
  });
  ipcMain.handle("instances:update", async (event, id: string, profile: InstanceProfile) => {
    await assertSenderPermission(event, Permission.WORKFLOW_EDIT);
    return store.update(id, profile);
  });
  ipcMain.handle("instances:delete", async (event, id: string) => {
    await assertSenderPermission(event, Permission.WORKFLOW_EDIT);
    return store.delete(id);
  });
  ipcMain.handle("instances:clone", async (event, id: string, nextId?: string) => {
    await assertSenderPermission(event, Permission.WORKFLOW_EDIT);
    return store.clone(id, nextId);
  });
  ipcMain.handle("instances:export", async (event, id: string) => {
    await assertSenderPermission(event, Permission.PAGE_INSTANCES);
    return store.export(id);
  });
  ipcMain.handle("instances:import", async (event, profile: InstanceProfile) => {
    await assertSenderPermission(event, Permission.WORKFLOW_EDIT);
    return store.import(profile);
  });

  ipcMain.handle("instance:list", async (event) => {
    await assertSenderPermission(event, Permission.PAGE_INSTANCES); // legacy singular alias
    return ensureDefaultInstanceProfile(store);
  });
}

async function ensureDefaultInstanceProfile(store: ReturnType<typeof createInstanceProfileStore>): Promise<InstanceProfile[]> {
  const existing = await store.list();
  if (existing.length > 0) return existing;

  await store.import({
    id: "default-concurrent-profile",
    name: "Default Concurrent Profile",
    maxConcurrentInstances: 5,
    headless: false
  });

  return store.list();
}
