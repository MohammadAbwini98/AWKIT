/**
 * N6.5 (awkit-vra.15.5) visual assertion candidate channels. Authorization happens here, in the main process, from the
 * sender-bound session; the renderer's permission checks are affordances only.
 *
 *   visualAssertion:capabilities      any signed-in session  — the build mode, so the Designer offers observe only
 *                                                              in the packaged build
 *   visualAssertion:listCandidates    WORKFLOW_EDIT          — summaries only (no digest, token, key or pixels)
 *   visualAssertion:previewCandidate  WORKFLOW_EDIT + fresh re-authentication, audited
 *   visualAssertion:approveCandidate  WORKFLOW_EDIT + fresh re-authentication, audited
 *   visualAssertion:rejectCandidate   WORKFLOW_EDIT + fresh re-authentication, audited
 *   visualAssertion:resetBaselines    WORKFLOW_EDIT + fresh re-authentication, audited
 *
 * The re-authenticated channels answer `REAUTH_REQUIRED` / `NOT_AUTHORIZED` as a code (never a throw), so the renderer
 * can prompt and retry once. No grant issuance, unchecked store method or key is reachable from here.
 */
import { app, ipcMain, type IpcMainInvokeEvent } from "electron";

import { Permission } from "@src/security/authz/Permissions";
import { AuthReason, SecurityError } from "@src/security/errors/ReasonCodes";
import { visualAssertionCandidates } from "@src/runner/visualAssertion/visualAssertionCandidates";
import {
  approveVisualCandidate,
  listVisualCandidates,
  previewVisualCandidate,
  rejectVisualCandidate,
  resetVisualBaselines,
  type VisualApprovalActor,
  type VisualApprovalDeps
} from "@src/runner/visualAssertion/visualAssertionApproval";
import { getAppMode } from "../appPaths";
import { assertSenderPermission } from "../security/sessionContext";
import { currentVisualBaselineStore } from "../visualAssertion/visualAssertionServices";

type Authorized = { ok: true; actor: VisualApprovalActor; sessionRef: string } | { ok: false; code: "REAUTH_REQUIRED" | "NOT_AUTHORIZED" };

/** WORKFLOW_EDIT, plus fresh re-authentication when `sensitive`; a denial is audited and answered as a code. */
async function authorize(event: IpcMainInvokeEvent, channel: string, sensitive: boolean): Promise<Authorized> {
  try {
    const actor = await assertSenderPermission(event, Permission.WORKFLOW_EDIT, {
      sensitive,
      audit: { eventType: "VISUAL_ASSERTION_DENIED", channel }
    });
    return { ok: true, actor: { userId: actor.user.id, username: actor.user.username }, sessionRef: actor.sessionRef };
  } catch (error) {
    if (!(error instanceof SecurityError)) throw error;
    return { ok: false, code: error.reason === AuthReason.REAUTH_REQUIRED ? "REAUTH_REQUIRED" : "NOT_AUTHORIZED" };
  }
}

function deps(sessionRef: string): VisualApprovalDeps {
  return {
    store: currentVisualBaselineStore(),
    candidates: visualAssertionCandidates,
    appVersion: app.getVersion(),
    audit: async (entry) => {
      const { getSecurityKernel } = await import("../security/securityKernel");
      const kernel = await getSecurityKernel();
      await kernel.store.appendAudit({
        at: new Date().toISOString(),
        eventType: entry.eventType,
        result: entry.result,
        reasonCode: entry.reasonCode,
        actorUserId: entry.actor.userId,
        actorName: entry.actor.username,
        sessionId: sessionRef,
        targetType: "visual-assertion",
        targetId: typeof entry.detail.flowId === "string" ? `${entry.detail.flowId}/${String(entry.detail.stepId ?? "")}` : "visual-baselines",
        detail: entry.detail
      });
    }
  };
}

const filterOf = (raw: unknown): { flowId?: string; stepId?: string } => {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const id = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 200 ? v : undefined);
  return { ...(id(value.flowId) ? { flowId: id(value.flowId) } : {}), ...(id(value.stepId) ? { stepId: id(value.stepId) } : {}) };
};

export function registerVisualAssertionIpc(): void {
  ipcMain.handle("visualAssertion:capabilities", async (event) => {
    await assertSenderPermission(event, Permission.PAGE_FLOWS);
    const appMode = getAppMode();
    return { appMode, enforceAvailable: appMode === "dev" };
  });

  ipcMain.handle("visualAssertion:listCandidates", async (event, raw: unknown) => {
    const auth = await authorize(event, "visualAssertion:listCandidates", false);
    if (!auth.ok) return { ok: false, code: auth.code, candidates: [] };
    return { ok: true, code: "listed", candidates: listVisualCandidates(deps(auth.sessionRef), filterOf(raw)) };
  });

  ipcMain.handle("visualAssertion:previewCandidate", async (event, candidateId: unknown) => {
    const auth = await authorize(event, "visualAssertion:previewCandidate", true);
    if (!auth.ok) return { ok: false, code: auth.code };
    return previewVisualCandidate(deps(auth.sessionRef), auth.actor, candidateId);
  });

  ipcMain.handle("visualAssertion:approveCandidate", async (event, candidateId: unknown) => {
    const auth = await authorize(event, "visualAssertion:approveCandidate", true);
    if (!auth.ok) return { ok: false, code: auth.code };
    return approveVisualCandidate(deps(auth.sessionRef), auth.actor, candidateId);
  });

  ipcMain.handle("visualAssertion:rejectCandidate", async (event, candidateId: unknown) => {
    const auth = await authorize(event, "visualAssertion:rejectCandidate", true);
    if (!auth.ok) return { ok: false, code: auth.code };
    return rejectVisualCandidate(deps(auth.sessionRef), auth.actor, candidateId);
  });

  ipcMain.handle("visualAssertion:resetBaselines", async (event) => {
    const auth = await authorize(event, "visualAssertion:resetBaselines", true);
    if (!auth.ok) return { ok: false, code: auth.code };
    return resetVisualBaselines(deps(auth.sessionRef), auth.actor);
  });
}
