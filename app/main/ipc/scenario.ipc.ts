import { ipcMain } from "electron";
import type { WorkflowProfile } from "@src/profiles/WorkflowProfile";
import { scenarioToWorkflowProfile, workflowToScenarioProfile } from "@src/profiles/WorkflowProfile";
import type { ScenarioProfile } from "@src/profiles/ScenarioProfile";
import { createWorkflowProfileStore } from "../profileStores";

export function registerScenarioIpc(): void {
  const store = createWorkflowProfileStore();

  ipcMain.handle("workflows:list", async () => store.list());
  ipcMain.handle("workflows:get", async (_, id: string) => store.get(id));
  ipcMain.handle("workflows:create", async (_, profile: WorkflowProfile) => store.create(profile));
  ipcMain.handle("workflows:update", async (_, id: string, profile: WorkflowProfile) => store.update(id, profile));
  ipcMain.handle("workflows:delete", async (_, id: string) => store.delete(id));
  ipcMain.handle("workflows:clone", async (_, id: string, nextId?: string) => store.clone(id, nextId));
  ipcMain.handle("workflows:export", async (_, id: string) => store.export(id));
  ipcMain.handle("workflows:import", async (_, profile: WorkflowProfile) => store.import(profile));

  ipcMain.handle("scenario:list", async () => (await store.list()).map(workflowToScenarioProfile));
  ipcMain.handle("scenario:get", async (_, id: string) => {
    const workflow = await store.get(id);
    return workflow ? workflowToScenarioProfile(workflow) : null;
  });
  ipcMain.handle("scenario:save", async (_, profile: ScenarioProfile) => store.import(scenarioToWorkflowProfile(profile)));
}
