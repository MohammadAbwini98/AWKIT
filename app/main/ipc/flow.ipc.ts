import { ipcMain } from "electron";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import { createFlowProfileStore } from "../profileStores";

export function registerFlowIpc(): void {
  const store = createFlowProfileStore();

  ipcMain.handle("flows:list", async () => store.list());
  ipcMain.handle("flows:get", async (_, id: string) => store.get(id));
  ipcMain.handle("flows:create", async (_, profile: FlowProfile) => store.create(profile));
  ipcMain.handle("flows:update", async (_, id: string, profile: FlowProfile) => store.update(id, profile));
  ipcMain.handle("flows:delete", async (_, id: string) => store.delete(id));
  ipcMain.handle("flows:clone", async (_, id: string, nextId?: string) => store.clone(id, nextId));
  ipcMain.handle("flows:export", async (_, id: string) => store.export(id));
  ipcMain.handle("flows:import", async (_, profile: FlowProfile) => store.import(profile));

  ipcMain.handle("flow:list", async () => store.list());
}
