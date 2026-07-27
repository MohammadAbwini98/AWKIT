import { ipcMain } from "electron";
import type { WorkflowProfile } from "@src/profiles/WorkflowProfile";
import { scenarioToWorkflowProfile, workflowToScenarioProfile } from "@src/profiles/WorkflowProfile";
import type { ScenarioProfile } from "@src/profiles/ScenarioProfile";
import { createWorkflowProfileStore } from "../profileStores";
import { assertSenderPermission } from "../security/sessionContext";
import { Permission } from "@src/security/authz/Permissions";
import {
  formatWorkflowConflictMessage,
  validateWorkflowProfile,
  WORKFLOW_IMPORT_ID_CONFLICT
} from "@src/profiles/workflowProfileValidation";

interface WorkflowImportOptions {
  allowOverwrite?: boolean;
}

export function registerScenarioIpc(): void {
  const store = createWorkflowProfileStore();
  const importWorkflow = async (profile: WorkflowProfile, options?: WorkflowImportOptions): Promise<WorkflowProfile> => {
    const validation = validateWorkflowProfile(profile);
    if (!validation.ok) {
      throw new Error(`Workflow import rejected: ${validation.errors.join(" ")}`);
    }

    const existing = await store.get(validation.profile.id);
    if (existing && options?.allowOverwrite !== true) {
      throw Object.assign(
        new Error(formatWorkflowConflictMessage(existing.name, existing.id)),
        { code: WORKFLOW_IMPORT_ID_CONFLICT, existingName: existing.name }
      );
    }

    return store.import(validation.profile);
  };

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
  ipcMain.handle("workflows:import", async (event, profile: WorkflowProfile, options?: WorkflowImportOptions) => {
    await assertSenderPermission(event, Permission.WORKFLOW_CREATE);
    return importWorkflow(profile, options);
  });

  ipcMain.handle("scenario:list", async () => (await store.list()).map(workflowToScenarioProfile));
  ipcMain.handle("scenario:get", async (_, id: string) => {
    const workflow = await store.get(id);
    return workflow ? workflowToScenarioProfile(workflow) : null;
  });
  ipcMain.handle("scenario:save", async (event, profile: ScenarioProfile) => {
    await assertSenderPermission(event, Permission.WORKFLOW_CREATE);
    return importWorkflow(scenarioToWorkflowProfile(profile), { allowOverwrite: true });
  });
}
