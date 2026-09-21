/**
 * Local-AI IPC (Phase L, L1.1 and L1.5).
 *
 * Every channel is authorized in the MAIN process before it touches the subsystem; the renderer's
 * checks only decide what to render. There is deliberately no channel that carries prompt text, names
 * a model file or returns a filesystem path: an assist job names data that main re-validates and
 * builds its own prompt from, and model import opens its file dialog here, in main.
 *
 * Read channels throw on denial (nothing for the renderer to recover); mutating channels answer with
 * a code, because a stale re-authentication window on `ai.manage` is the ordinary case for an
 * authorized administrator and the UI must be able to prompt and retry (the semantic IPC pattern).
 */

import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";

import {
  authorizeAiAction,
  sanitizeActionId,
  sanitizeAuditPage,
  sanitizeFeatureId,
  sanitizeFlowEditorState,
  sanitizeProfileId,
  sanitizePromotionRequest,
  type AiAdminResponse,
  type AiAuditView,
  type AiDiagnosticsView,
  type AiSettingsView,
  type AiStatusView,
  type AuthoringAssistView,
  type FailureAnalysisView,
  type FlowLocatorUpgradesView,
  type FragmentSummaryView
} from "@src/ai/contracts/AiApi";
import { Permission } from "@src/security/authz/Permissions";

import { createFlowFragmentStore, createFlowProfileStore, createReportStore } from "../profileStores";
import { assertSenderPermission } from "../security/sessionContext";
import { analyzeFailure, cancelAssist, explainFlowValidation, summarizeFragment, type AiAssistDeps } from "../ai/aiAssist";
import {
  aiAuditView,
  aiDiagnosticsView,
  aiPolicyConfig,
  aiSettingsView,
  aiStatusView,
  getAiService,
  importAiModelPack,
  removeAiModelPack,
  restoreAiFeature,
  revertAiActionFromAudit,
  updateAiSettings
} from "../ai/aiRuntime";
import { clearFlowEditorState, flowLocatorUpgrades, promoteFlowLocatorUpgrade, setFlowEditorState } from "../ai/locatorUpgradeService";

async function authorize(event: IpcMainInvokeEvent, permission: Permission, sensitive: boolean): Promise<AiAdminResponse | null> {
  const auth = await authorizeAiAction(() => assertSenderPermission(event, permission, { sensitive }));
  return auth.ok ? null : { code: auth.code, ok: false, message: auth.message };
}

function assistDeps(): AiAssistDeps {
  return {
    submit: (job) => getAiService().submit(job),
    policy: aiPolicyConfig,
    savedFlowIds: async () => (await createFlowProfileStore().list()).map((flow) => flow.id)
  };
}

export function registerAiIpc(): void {
  ipcMain.handle("ai:getStatus", async (event): Promise<AiStatusView> => {
    await assertSenderPermission(event, Permission.AI_USE);
    return aiStatusView();
  });

  ipcMain.handle("ai:getSettings", async (event): Promise<AiSettingsView> => {
    await assertSenderPermission(event, Permission.AI_MANAGE);
    return aiSettingsView();
  });

  ipcMain.handle("ai:updateSettings", async (event, patch: unknown): Promise<AiAdminResponse> => {
    return (await authorize(event, Permission.AI_MANAGE, true)) ?? updateAiSettings(patch);
  });

  ipcMain.handle("ai:restoreFeature", async (event, feature: unknown): Promise<AiAdminResponse> => {
    const denied = await authorize(event, Permission.AI_MANAGE, true);
    if (denied) return denied;
    const id = sanitizeFeatureId(feature);
    return id ? restoreAiFeature(id) : { code: "INVALID_REQUEST", ok: false, message: "Unknown AI feature." };
  });

  ipcMain.handle("ai:getDiagnostics", async (event): Promise<AiDiagnosticsView> => {
    await assertSenderPermission(event, Permission.AI_AUDIT_VIEW);
    return aiDiagnosticsView();
  });

  ipcMain.handle("ai:listAudit", async (event, page: unknown): Promise<AiAuditView> => {
    await assertSenderPermission(event, Permission.AI_AUDIT_VIEW);
    return aiAuditView(sanitizeAuditPage(page));
  });

  // Reverting restores a saved flow, so it needs the flow-edit permission as well as the audit view.
  ipcMain.handle("ai:revert", async (event, actionId: unknown): Promise<AiAdminResponse> => {
    const denied = (await authorize(event, Permission.AI_AUDIT_VIEW, false)) ?? (await authorize(event, Permission.WORKFLOW_EDIT, false));
    if (denied) return denied;
    const id = sanitizeActionId(actionId);
    return id ? revertAiActionFromAudit(id) : { code: "INVALID_REQUEST", ok: false, message: "Unknown AI action." };
  });

  // L3 §6. Reading a flow's AI locator state needs both the AI surface and permission to see the
  // flow; applying one is a write to a saved flow, so it needs the flow-edit permission as well.
  ipcMain.handle("ai:listUpgrades", async (event, flowId: unknown): Promise<FlowLocatorUpgradesView> => {
    await assertSenderPermission(event, Permission.AI_USE);
    await assertSenderPermission(event, Permission.WORKFLOW_VIEW);
    const id = sanitizeProfileId(flowId);
    return id ? flowLocatorUpgrades(id) : { flowId: "", pending: [], applied: [], editorDirty: false };
  });

  ipcMain.handle("ai:promoteUpgrade", async (event, request: unknown): Promise<AiAdminResponse> => {
    const denied = (await authorize(event, Permission.AI_USE, false)) ?? (await authorize(event, Permission.WORKFLOW_EDIT, false));
    if (denied) return denied;
    const parsed = sanitizePromotionRequest(request);
    return parsed ? promoteFlowLocatorUpgrade(parsed) : { code: "INVALID_REQUEST", ok: false, message: "Unknown flow or step." };
  });

  // A renderer declaring what it has open. It grants nothing — it can only make promotion stricter —
  // so it is gated on the flow-edit permission an editor already needs and nothing else.
  ipcMain.handle("ai:setEditorState", async (event, state: unknown): Promise<AiAdminResponse> => {
    await assertSenderPermission(event, Permission.WORKFLOW_EDIT);
    const parsed = sanitizeFlowEditorState(state);
    const sender = event.sender;
    setFlowEditorState(sender.id, parsed);
    // A window that closes while it still claims a dirty flow would block promotion for ever.
    if (parsed) sender.once("destroyed", () => clearFlowEditorState(sender.id));
    return { code: "OK", ok: true };
  });

  // L4b. The renderer sends the flow it has open (saved or not); main re-validates it and builds the
  // prompt itself, so no renderer string becomes prompt text. It reads, never writes: AI_USE plus
  // WORKFLOW_VIEW, the same pair as listing upgrades. Applying a ranked fix stays validation IPC.
  ipcMain.handle("ai:explainValidation", async (event, request: unknown): Promise<AuthoringAssistView> => {
    const denied = (await authorize(event, Permission.AI_USE, false)) ?? (await authorize(event, Permission.WORKFLOW_VIEW, false));
    if (denied) {
      const code = denied.code === "REAUTH_REQUIRED" ? "REAUTH_REQUIRED" : "NOT_AUTHORIZED";
      return { code, ok: false, message: denied.message, explanations: [], ranking: [], truncated: 0 };
    }
    return explainFlowValidation(event.sender.id, request, assistDeps());
  });

  // L6 T0. Names a stored fragment; main reads it from the store. The library needs PAGE_FLOWS.
  ipcMain.handle("ai:summarizeFragment", async (event, request: unknown): Promise<FragmentSummaryView> => {
    const denied = (await authorize(event, Permission.AI_USE, false)) ?? (await authorize(event, Permission.PAGE_FLOWS, false));
    if (denied) {
      const code = denied.code === "REAUTH_REQUIRED" ? "REAUTH_REQUIRED" : "NOT_AUTHORIZED";
      return { code, ok: false, message: denied.message, fragmentId: "", summary: null };
    }
    const fragments = createFlowFragmentStore();
    return summarizeFragment(event.sender.id, request, { ...assistDeps(), fragment: (id) => fragments.get(id) });
  });

  // L5b T0 on demand. Names a stored run and one of its instances; main reads the report's own L5a
  // evidence. Run reports are behind PAGE_REPORTS.
  ipcMain.handle("ai:analyzeFailure", async (event, request: unknown): Promise<FailureAnalysisView> => {
    const denied = (await authorize(event, Permission.AI_USE, false)) ?? (await authorize(event, Permission.PAGE_REPORTS, false));
    if (denied) {
      const code = denied.code === "REAUTH_REQUIRED" ? "REAUTH_REQUIRED" : "NOT_AUTHORIZED";
      return { code, ok: false, message: denied.message, instanceId: "", coalescedCount: 0, analysis: null };
    }
    const reports = createReportStore();
    const report = async (executionId: string) =>
      (await reports.get(executionId)) ?? (await reports.list()).find((stored) => stored.executionId === executionId) ?? null;
    return analyzeFailure(event.sender.id, request, { ...assistDeps(), report });
  });

  // Cancels only the asking window's own job: main prefixes the id with the sender's id.
  ipcMain.handle("ai:cancelAssist", async (event, requestId: unknown): Promise<AiAdminResponse> => {
    await assertSenderPermission(event, Permission.AI_USE);
    return cancelAssist(event.sender.id, requestId, (jobId) => getAiService().cancel(jobId));
  });

  ipcMain.handle("ai:importModelPack", async (event): Promise<AiAdminResponse> => {
    const denied = await authorize(event, Permission.AI_MANAGE, true);
    if (denied) return denied;
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: "Import AI model pack",
      properties: ["openFile"],
      filters: [{ name: "GGUF model pack", extensions: ["gguf"] }]
    };
    const picked = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    if (picked.canceled || !picked.filePaths[0]) return { code: "IMPORT_CANCELLED", ok: false };
    return importAiModelPack(picked.filePaths[0]);
  });

  ipcMain.handle("ai:removeModelPack", async (event): Promise<AiAdminResponse> => {
    return (await authorize(event, Permission.AI_MANAGE, true)) ?? removeAiModelPack();
  });
}
