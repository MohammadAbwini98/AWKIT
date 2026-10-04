/**
 * Local-AI IPC (Phase L, L1.1 and L1.5).
 *
 * Every channel is authorized in the MAIN process before it touches the subsystem; the renderer's
 * checks only decide what to render. There is deliberately no channel that carries prompt text, names
 * a model file or accepts a filesystem path: an assist job names data that main re-validates and
 * builds its own prompt from, and model and backend-pack import open their dialogs here, in main. The
 * backend-pack checklist is the one view that shows paths (the picked folder and the app-managed
 * destination), for display only.
 *
 * Read channels throw on denial (nothing for the renderer to recover); mutating channels answer with
 * a code, because a stale re-authentication window on `ai.manage` is the ordinary case for an
 * authorized administrator and the UI must be able to prompt and retry (the semantic IPC pattern).
 */

import { BrowserWindow, dialog, ipcMain, webContents, type IpcMainInvokeEvent } from "electron";

import {
  authorizeAiAction,
  sanitizeActionId,
  sanitizeAuditPage,
  sanitizeBackendPreflightToken,
  sanitizeFeatureId,
  sanitizeFlowEditorState,
  sanitizeProfileId,
  sanitizePromotionRequest,
  type AiAdminResponse,
  type AiAuditView,
  type AiBackendPackView,
  type AiBackendPreflightResponse,
  type AiDiagnosticsView,
  type AiJobStatus,
  type AiModelPreflightResponse,
  type AiSettingsView,
  type AiStatusView,
  type AuthoringAssistView,
  type FailureAnalysisView,
  type FlowLocatorUpgradesView,
  type FragmentSummaryView,
  type InspectionAttachView,
  type InspectionLocatorView
} from "@src/ai/contracts/AiApi";
import { recorderService } from "@src/recorder/RecorderService";
import { proveLocatorPlan } from "@src/runner/locatorProof";
import type { FlowStep } from "@src/profiles/FlowProfile";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { countLookAlikes } from "@src/runner/domIntelligence/repairSuggestion";
import { getDomIntelligenceProvider } from "../domIntelligence/domIntelligenceRuntime";
import { Permission } from "@src/security/authz/Permissions";

import { createFlowFragmentStore, createFlowProfileStore, createReportStore } from "../profileStores";
import { assertSenderPermission } from "../security/sessionContext";
import type { AiJobRequest } from "@src/ai/AiService";
import type { LocatorUpgradeProvider } from "@src/ai/locatorUpgradeAttempts";

import {
  abortInspectionLocator,
  analyzeFailure,
  assistJobId,
  attachInspectionProposal,
  cancelAssist,
  deleteFailureAnalysis,
  explainFlowValidation,
  proposeInspectionLocator,
  summarizeFragment,
  type InspectionTarget,
  type AiAssistDeps,
  type FailureReportAccess
} from "../ai/aiAssist";
import {
  acknowledgeAiModelPack,
  aiAuditView,
  aiBackendPackView,
  aiDiagnosticsView,
  aiJobsFor,
  aiPolicyConfig,
  aiSettingsView,
  aiStatusView,
  cancelAiBackendPack,
  cancelAiModelJob,
  checkAiModelPack,
  getAiService,
  importAiBackendPack,
  importAiModelPack,
  preflightAiBackendPack,
  preflightAiModelPack,
  removeAiBackendPack,
  removeAiModelPack,
  restoreAiFeature,
  revertAiActionFromAudit,
  setAiJobPublisher,
  updateAiSettings,
  verifyAiBackendPack
} from "../ai/aiRuntime";
import { clearFlowEditorState, flowLocatorUpgrades, promoteFlowLocatorUpgrade, setFlowEditorState } from "../ai/locatorUpgradeService";

async function authorize(event: IpcMainInvokeEvent, permission: Permission, sensitive: boolean): Promise<AiAdminResponse | null> {
  const auth = await authorizeAiAction(() => assertSenderPermission(event, permission, { sensitive }));
  return auth.ok ? null : { code: auth.code, ok: false, message: auth.message };
}

/**
 * L9.1: an assist job's status goes to the window that asked, under the id that window gave it. The job id
 * `aiAssist` builds is `assistJobId(sender, requestId)`, plus `.a<n>` for each Element Spy attempt (all
 * attempts report under the one request). Main knows the sender here, so nothing is taken from the renderer.
 */
function withOwner(job: AiJobRequest, senderId: number): AiJobRequest {
  const prefix = assistJobId(senderId, "");
  if (!job.requestId.startsWith(prefix)) return job;
  const requestId = job.requestId.slice(prefix.length).replace(/\.a\d+$/, "");
  return requestId ? { ...job, owner: { window: senderId, requestId } } : job;
}

/** The one service, submitting as `senderId`'s jobs. */
function ownedService(senderId: number): LocatorUpgradeProvider {
  return { submit: (job) => getAiService().submit(withOwner(job, senderId)), cancel: (id) => getAiService().cancel(id) };
}

function assistDeps(senderId: number): AiAssistDeps {
  return {
    submit: ownedService(senderId).submit,
    policy: aiPolicyConfig,
    savedFlowIds: async () => (await createFlowProfileStore().list()).map((flow) => flow.id)
  };
}

/** Element Spy's live inspection and page, proven on with the product's own capture-time proof. */
function inspectionTarget(): InspectionTarget | null {
  const live = recorderService.getInspectionTarget();
  if (!live) return null;
  const { inspection, page, boundValues } = live;
  return {
    inspection,
    boundValues,
    prove: (step, plan) => proveLocatorPlan(page, step, plan, { boundValues, ...(inspection.upgradeContext ? { upgradeContext: inspection.upgradeContext } : {}) }),
    // L12.14: the inspected element's look-alikes on the Spy's live page, a count for the AI request.
    lookAlikes: async () => {
      const factory = new LocatorFactory(page);
      const located = await factory.resolve({ id: "element-spy", type: "click", name: inspection.owner.name, locator: inspection.locator } as FlowStep);
      if ((await located.count()) !== 1) return undefined;
      const frame = await located.elementHandle().then((handle) => handle?.ownerFrame());
      return frame ? countLookAlikes(frame, located, getDomIntelligenceProvider()) : undefined;
    }
  };
}

/** A run report by execution id: the report's own id, else the stored report carrying that execution id. */
function reportAccess(): FailureReportAccess {
  const reports = createReportStore();
  const storedId = async (executionId: string) =>
    (await reports.get(executionId))?.id ?? (await reports.list()).find((stored) => stored.executionId === executionId)?.id ?? null;
  return {
    report: async (executionId) => {
      const id = await storedId(executionId);
      return id ? reports.get(id) : null;
    },
    updateReport: async (executionId, change) => {
      const id = await storedId(executionId);
      if (!id) return change(null);
      return reports.updateWith(id, (current) => {
        const next = change(current);
        return next && { ...next, id };
      });
    }
  };
}

export function registerAiIpc(): void {
  // L9.1: a job's status goes to the window that started it, and nowhere else. It carries codes, stage
  // names and numbers only; a window that went away simply receives nothing.
  setAiJobPublisher((owner, status) => {
    const target = webContents.fromId(owner);
    if (target && !target.isDestroyed()) target.send("ai:jobStatus", status);
  });

  ipcMain.handle("ai:listJobs", async (event): Promise<AiJobStatus[]> => {
    await assertSenderPermission(event, Permission.AI_USE);
    return aiJobsFor(event.sender.id);
  });

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
    return explainFlowValidation(event.sender.id, request, assistDeps(event.sender.id));
  });

  // L6 T0. Names a stored fragment; main reads it from the store. The library needs PAGE_FLOWS.
  ipcMain.handle("ai:summarizeFragment", async (event, request: unknown): Promise<FragmentSummaryView> => {
    const denied = (await authorize(event, Permission.AI_USE, false)) ?? (await authorize(event, Permission.PAGE_FLOWS, false));
    if (denied) {
      const code = denied.code === "REAUTH_REQUIRED" ? "REAUTH_REQUIRED" : "NOT_AUTHORIZED";
      return { code, ok: false, message: denied.message, fragmentId: "", summary: null };
    }
    const fragments = createFlowFragmentStore();
    return summarizeFragment(event.sender.id, request, { ...assistDeps(event.sender.id), fragment: (id) => fragments.get(id) });
  });

  // L5b T0 on demand. Names a stored run and one of its instances; main reads the report's own L5a
  // evidence. Run reports are behind PAGE_REPORTS.
  ipcMain.handle("ai:analyzeFailure", async (event, request: unknown): Promise<FailureAnalysisView> => {
    const denied = (await authorize(event, Permission.AI_USE, false)) ?? (await authorize(event, Permission.PAGE_REPORTS, false));
    if (denied) {
      const code = denied.code === "REAUTH_REQUIRED" ? "REAUTH_REQUIRED" : "NOT_AUTHORIZED";
      return { code, ok: false, message: denied.message, instanceId: "", coalescedCount: 0, analysis: null };
    }
    return analyzeFailure(event.sender.id, request, { ...assistDeps(event.sender.id), ...reportAccess() });
  });

  // L5b. Deletes the stored analysis covering one instance: the same pair that can create one. No
  // policy check, so a stored AI answer can be removed with local AI switched off.
  ipcMain.handle("ai:deleteFailureAnalysis", async (event, target: unknown): Promise<AiAdminResponse> => {
    const denied = (await authorize(event, Permission.AI_USE, false)) ?? (await authorize(event, Permission.PAGE_REPORTS, false));
    return denied ?? deleteFailureAnalysis(target, reportAccess());
  });

  // L3 §1, Element Spy on demand (owner's limited L1 GO). It names nothing: main reads its own live
  // inspection. It reads a page the user is inspecting and writes nothing, so it takes the Spy's own
  // permission pair plus AI_USE.
  ipcMain.handle("ai:proposeInspectionLocator", async (event, request: unknown): Promise<InspectionLocatorView> => {
    const denied =
      (await authorize(event, Permission.AI_USE, false)) ??
      (await authorize(event, Permission.PAGE_RECORDER, false)) ??
      (await authorize(event, Permission.RECORDER_ELEMENT_SPY, false));
    if (denied) {
      const code = denied.code === "REAUTH_REQUIRED" ? "REAUTH_REQUIRED" : "NOT_AUTHORIZED";
      return { code, ok: false, message: denied.message, inspectedAt: null, proposal: null, attemptsUsed: 0 };
    }
    return proposeInspectionLocator(event.sender.id, request, { policy: aiPolicyConfig, ai: ownedService(event.sender.id), target: inspectionTarget });
  });

  // L3 U1 (owner decision D2): attach that window's proven proposal to one recorded draft step as a
  // pending candidate. Ids only; main holds the proposal and its own draft, and proves it again against
  // the step. It writes the Recorder draft, as "Use in action" does, so the same pair plus AI_USE.
  ipcMain.handle("ai:attachInspectionProposal", async (event, request: unknown): Promise<InspectionAttachView> => {
    const denied =
      (await authorize(event, Permission.AI_USE, false)) ??
      (await authorize(event, Permission.PAGE_RECORDER, false)) ??
      (await authorize(event, Permission.RECORDER_ELEMENT_SPY, false));
    if (denied) {
      const code = denied.code === "REAUTH_REQUIRED" ? "REAUTH_REQUIRED" : "NOT_AUTHORIZED";
      return { code, ok: false, message: denied.message, actions: null };
    }
    return attachInspectionProposal(event.sender.id, request, {
      policy: aiPolicyConfig,
      target: inspectionTarget,
      draftAction: (actionId) => recorderService.getDraftAction(actionId),
      attach: (actionId, pending) => recorderService.attachPendingUpgrade(actionId, pending)
    });
  });

  // Cancels only the asking window's own job: main prefixes the id with the sender's id.
  ipcMain.handle("ai:cancelAssist", async (event, requestId: unknown): Promise<AiAdminResponse> => {
    await assertSenderPermission(event, Permission.AI_USE);
    return cancelAssist(event.sender.id, requestId, (jobId) => abortInspectionLocator(jobId) || getAiService().cancel(jobId));
  });

  // L8b.5 (E1): model import is two steps. The file dialog opens here, in main, and the renderer gets the
  // disk-space preflight and a one-time token; the copy names the checked file only by that token.
  ipcMain.handle("ai:preflightModelPack", async (event): Promise<AiModelPreflightResponse> => {
    const denied = await authorize(event, Permission.AI_MANAGE, true);
    if (denied) return { ...denied, preflight: null };
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: "Import AI model pack",
      properties: ["openFile"],
      filters: [{ name: "GGUF model pack", extensions: ["gguf"] }]
    };
    const picked = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    if (picked.canceled || !picked.filePaths[0]) return { code: "IMPORT_CANCELLED", ok: false, preflight: null };
    return preflightAiModelPack(event.sender.id, picked.filePaths[0]);
  });

  ipcMain.handle("ai:importModelPack", async (event, token: unknown): Promise<AiAdminResponse> => {
    const denied = await authorize(event, Permission.AI_MANAGE, true);
    if (denied) return denied;
    const id = sanitizeBackendPreflightToken(token);
    return id ? importAiModelPack(event.sender.id, id) : { code: "INVALID_REQUEST", ok: false, message: "Choose the model file again before importing." };
  });

  // L8b.3 and L8b.5: re-run a registered model's compatibility stages, and acknowledge a compatible one as
  // unverified (E7). Both can admit a model to use, so both re-authenticate.
  ipcMain.handle("ai:checkModelPack", async (event): Promise<AiAdminResponse> => {
    return (await authorize(event, Permission.AI_MANAGE, true)) ?? checkAiModelPack(event.sender.id);
  });

  // L9.1: stops only the asking window's own model copy or compatibility check. Stopping can only narrow
  // what happens (nothing is kept), so it needs no re-authentication, like cancelBackendPack.
  ipcMain.handle("ai:cancelModelJob", async (event): Promise<AiAdminResponse> => {
    await assertSenderPermission(event, Permission.AI_MANAGE);
    return cancelAiModelJob(event.sender.id);
  });

  ipcMain.handle("ai:acknowledgeModelPack", async (event): Promise<AiAdminResponse> => {
    return (await authorize(event, Permission.AI_MANAGE, true)) ?? acknowledgeAiModelPack();
  });

  ipcMain.handle("ai:removeModelPack", async (event): Promise<AiAdminResponse> => {
    return (await authorize(event, Permission.AI_MANAGE, true)) ?? removeAiModelPack();
  });

  // L8a.2 GPU backend pack. No new permission: AI_MANAGE throughout, with re-authentication for every
  // step that picks, copies or deletes. The folder dialog opens here, in main; the renderer receives a
  // checklist and a one-time token and can only name the checked folder by that token.
  ipcMain.handle("ai:getBackendPack", async (event): Promise<AiBackendPackView> => {
    await assertSenderPermission(event, Permission.AI_MANAGE);
    return aiBackendPackView();
  });

  ipcMain.handle("ai:preflightBackendPack", async (event): Promise<AiBackendPreflightResponse> => {
    const denied = await authorize(event, Permission.AI_MANAGE, true);
    if (denied) return { ...denied, preflight: null };
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = { title: "Select the GPU backend pack folder", properties: ["openDirectory"] };
    const picked = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    if (picked.canceled || !picked.filePaths[0]) return { code: "IMPORT_CANCELLED", ok: false, preflight: null };
    return preflightAiBackendPack(event.sender.id, picked.filePaths[0]);
  });

  ipcMain.handle("ai:importBackendPack", async (event, token: unknown): Promise<AiAdminResponse> => {
    const denied = await authorize(event, Permission.AI_MANAGE, true);
    if (denied) return denied;
    const id = sanitizeBackendPreflightToken(token);
    return id ? importAiBackendPack(event.sender.id, id) : { code: "INVALID_REQUEST", ok: false, message: "Check the pack folder again before importing." };
  });

  // Cancels only the asking window's own import or checklist, so it needs no re-authentication.
  ipcMain.handle("ai:cancelBackendPack", async (event): Promise<AiAdminResponse> => {
    await assertSenderPermission(event, Permission.AI_MANAGE);
    return cancelAiBackendPack(event.sender.id);
  });

  // Runs the load-time integrity guard. It can only narrow what loads (mark a pack invalid), never widen it.
  ipcMain.handle("ai:verifyBackendPack", async (event): Promise<AiAdminResponse> => {
    return (await authorize(event, Permission.AI_MANAGE, false)) ?? verifyAiBackendPack();
  });

  ipcMain.handle("ai:removeBackendPack", async (event): Promise<AiAdminResponse> => {
    return (await authorize(event, Permission.AI_MANAGE, true)) ?? removeAiBackendPack();
  });
}
