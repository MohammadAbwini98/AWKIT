import { ipcMain } from "electron";
import type { WorkflowProfile } from "@src/profiles/WorkflowProfile";
import { scenarioToWorkflowProfile, workflowToScenarioProfile } from "@src/profiles/WorkflowProfile";
import type { ScenarioProfile } from "@src/profiles/ScenarioProfile";
import { createWorkflowProfileStore } from "../profileStores";
import { assertSenderPermission } from "../security/sessionContext";
import { Permission } from "@src/security/authz/Permissions";

export function registerScenarioIpc(): void {
  const store = createWorkflowProfileStore();

  ipcMain.handle("workflows:list", async () => store.list());
  ipcMain.handle("workflows:get", async (_, id: string) => store.get(id));
  ipcMain.handle("workflows:create", async (event, profile: WorkflowProfile) => {
    await assertSenderPermission(event, Permission.WORKFLOW_CREATE);
    return store.create(profile);
  });
  ipcMain.handle("workflows:update", async (event, id: string, profile: WorkflowProfile) => {
    await assertSenderPermission(event, Permission.WORKFLOW_EDIT);
    return store.update(id, profile);
  });
  ipcMain.handle("workflows:delete", async (event, id: string) => {
    await assertSenderPermission(event, Permission.WORKFLOW_DELETE);
    return store.delete(id);
  });
  ipcMain.handle("workflows:clone", async (event, id: string, nextId?: string) => {
    await assertSenderPermission(event, Permission.WORKFLOW_CREATE);
    return store.clone(id, nextId);
  });
  ipcMain.handle("workflows:export", async (_, id: string) => store.export(id));
  ipcMain.handle("workflows:import", async (event, profile: WorkflowProfile) => {
    await assertSenderPermission(event, Permission.WORKFLOW_CREATE);
    return store.import(profile);
  });

  ipcMain.handle("scenario:list", async () => (await store.list()).map(workflowToScenarioProfile));
  ipcMain.handle("scenario:get", async (_, id: string) => {
    const workflow = await store.get(id);
    return workflow ? workflowToScenarioProfile(workflow) : null;
  });
  ipcMain.handle("scenario:save", async (event, profile: ScenarioProfile) => {
    await assertSenderPermission(event, Permission.WORKFLOW_CREATE);
    return store.import(scenarioToWorkflowProfile(profile));
  });
}
