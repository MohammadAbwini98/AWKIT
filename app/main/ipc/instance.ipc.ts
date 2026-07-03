import { ipcMain } from "electron";
import type { InstanceProfile } from "../profileStores";
import { createInstanceProfileStore } from "../profileStores";

export function registerInstanceIpc(): void {
  const store = createInstanceProfileStore();

  ipcMain.handle("instances:list", async () => ensureDefaultInstanceProfile(store));
  ipcMain.handle("instances:get", async (_, id: string) => store.get(id));
  ipcMain.handle("instances:create", async (_, profile: InstanceProfile) => store.create(profile));
  ipcMain.handle("instances:update", async (_, id: string, profile: InstanceProfile) => store.update(id, profile));
  ipcMain.handle("instances:delete", async (_, id: string) => store.delete(id));
  ipcMain.handle("instances:clone", async (_, id: string, nextId?: string) => store.clone(id, nextId));
  ipcMain.handle("instances:export", async (_, id: string) => store.export(id));
  ipcMain.handle("instances:import", async (_, profile: InstanceProfile) => store.import(profile));

  ipcMain.handle("instance:list", async () => ensureDefaultInstanceProfile(store));
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
