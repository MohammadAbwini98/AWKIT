import { ipcMain } from "electron";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import { executionBlockingErrorsOf, errorsOf, validateFlowDefinition, warningsOf } from "@src/validation/FlowValidator";
import { createFlowProfileStore } from "../profileStores";
import { assertSenderPermission } from "../security/sessionContext";
import { Permission } from "@src/security/authz/Permissions";

/** Import-time validation summary (Stage 2b). Plain arrays/counts so it survives IPC cleanly. */
export interface FlowImportValidation {
  issues: ReturnType<typeof validateFlowDefinition>["issues"];
  errorCount: number;
  warningCount: number;
  blockingCount: number;
  /** Derived, never persisted: whether the imported flow could run right now. */
  runnable: boolean;
}

export function registerFlowIpc(): void {
  const store = createFlowProfileStore();

  ipcMain.handle("flows:list", async (event) => {
    await assertSenderPermission(event, Permission.PAGE_FLOWS);
    return store.list();
  });
  ipcMain.handle("flows:get", async (event, id: string) => {
    await assertSenderPermission(event, Permission.PAGE_FLOWS);
    return store.get(id);
  });
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
  ipcMain.handle("flows:export", async (event, id: string) => {
    await assertSenderPermission(event, Permission.PAGE_FLOWS);
    return store.export(id);
  });
  ipcMain.handle("flows:import", async (event, profile: FlowProfile) => {
    await assertSenderPermission(event, Permission.WORKFLOW_CREATE);
    // Stage 2b: a parseable flow ALWAYS imports (as a Draft when invalid) — validation informs, it
    // does not gate. Unparseable/corrupt JSON still fails inside `store.import` as before, which is
    // a document failure, not a flow-validation failure. Nothing is auto-fixed and the stored
    // document is exactly what the caller supplied.
    const imported = await store.import(profile);
    const library = await store.list();
    const report = validateFlowDefinition(imported, { referenceableFlowIds: new Set(library.map((flow) => flow.id)) });
    const validation: FlowImportValidation = {
      issues: report.issues,
      errorCount: errorsOf(report).length,
      warningCount: warningsOf(report).length,
      blockingCount: executionBlockingErrorsOf(report).length,
      runnable: executionBlockingErrorsOf(report).length === 0
    };
    return { profile: imported, validation };
  });

  ipcMain.handle("flow:list", async (event) => {
    await assertSenderPermission(event, Permission.PAGE_FLOWS);
    return store.list();
  });
}
