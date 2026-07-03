import { ipcMain } from "electron";
import type { RuntimeInputProfile } from "../profileStores";
import { createRuntimeInputProfileStore } from "../profileStores";

export function registerRuntimeInputIpc(): void {
  const store = createRuntimeInputProfileStore();

  ipcMain.handle("runtimeInputs:list", async () => ensureDefaultRuntimeInputs(store));
  ipcMain.handle("runtimeInputs:get", async (_, id: string) => store.get(id));
  ipcMain.handle("runtimeInputs:create", async (_, profile: RuntimeInputProfile) => store.create(profile));
  ipcMain.handle("runtimeInputs:update", async (_, id: string, profile: RuntimeInputProfile) => store.update(id, profile));
  ipcMain.handle("runtimeInputs:delete", async (_, id: string) => store.delete(id));
  ipcMain.handle("runtimeInputs:clone", async (_, id: string, nextId?: string) => store.clone(id, nextId));
  ipcMain.handle("runtimeInputs:export", async (_, id: string) => store.export(id));
  ipcMain.handle("runtimeInputs:import", async (_, profile: RuntimeInputProfile) => store.import(profile));
}

async function ensureDefaultRuntimeInputs(store: ReturnType<typeof createRuntimeInputProfileStore>): Promise<RuntimeInputProfile[]> {
  const existing = await store.list();
  if (existing.length > 0) return existing;

  await store.import({
    id: "customer-onboarding-inputs",
    name: "Customer Onboarding Inputs",
    definitions: [
      {
        key: "selectedAccountType",
        label: "Account Type",
        type: "dropdown",
        required: true,
        defaultValue: "BUSINESS",
        options: [
          { label: "Business", value: "BUSINESS" },
          { label: "Personal", value: "PERSONAL" }
        ]
      }
    ]
  });

  return store.list();
}
