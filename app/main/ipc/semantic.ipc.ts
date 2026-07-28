/**
 * Semantic index IPC (plan §11.2).
 *
 * Every channel is authorized in the MAIN process before it touches the subsystem — the renderer's
 * permission checks are UI affordances only. Authorization happens before service initialization,
 * collection access, rebuild, or anything that reveals system information (plan §10).
 *
 * Two rules this file exists to hold:
 *   1. **The renderer never supplies a query expression or a path.** Requests are sanitized into
 *      structured fields by `sanitizeSearchRequest`; a raw Zvec filter string cannot be constructed
 *      from anything the renderer sends.
 *   2. **No raw native error crosses IPC.** Handlers return stable reason codes.
 *
 * `semantic:rebuild` and `semantic:clear` additionally require a fresh re-authentication, because
 * `SEMANTIC_MANAGE_INDEX` is in `SENSITIVE_PERMISSIONS`.
 *
 * **Authorization on the mutating channels answers with a code, not a throw** (`authorize` below).
 * The read channels still throw, which is deliberate: a denied read has no recoverable renderer
 * response, whereas a stale re-auth window on rebuild/clear is the ordinary case for an authorized
 * administrator and the UI must be able to prompt and retry. A throw cannot express that difference
 * — it arrives at the renderer as a rejected `invoke` whose only distinguishing feature is the text
 * of its message, and rule 2 exists precisely so the renderer never reads a message.
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";

import { Permission } from "@src/security/authz/Permissions";
import {
  authorizeSemanticAction,
  sanitizeLocatorSuggestionRequest,
  sanitizeSearchRequest,
  sanitizeSettingsPatch,
  sanitizeSimilarFailureRequest,
  type SemanticAdminResponse,
  type SemanticReasonCode,
  type SemanticSearchResponse,
  type SemanticSettingsView,
  type SemanticStatusView
} from "@src/semantic/contracts/SemanticApi";

import { assertSenderPermission } from "../security/sessionContext";
import { updateUiSettings } from "../uiSettings";
import {
  clearSemanticIndex,
  rebuildSemanticIndex,
  searchSemanticIndex,
  semanticSettings,
  semanticStatusView,
  similarSemanticFailures,
  suggestSemanticLocators
} from "../semantic/semanticService";

/**
 * Authorize a mutating semantic call. The rule for translating a failure into a reason code lives in
 * `authorizeSemanticAction` (pure, in the contract) so this handler and `verify:semantic-store` apply
 * the identical version of it — including that a non-`SecurityError` rethrows rather than being
 * reported as a permission problem.
 */
async function authorize(
  event: IpcMainInvokeEvent,
  permission: Permission,
  sensitive: boolean
): Promise<{ ok: true } | { ok: false; code: SemanticReasonCode; message: string }> {
  return authorizeSemanticAction(() => assertSenderPermission(event, permission, { sensitive }));
}

export function registerSemanticIpc(): void {
  ipcMain.handle("semantic:getStatus", async (event): Promise<SemanticStatusView> => {
    await assertSenderPermission(event, Permission.SEMANTIC_SEARCH);
    // `includePaths` stays false: the index path is a filesystem location reserved for an
    // administrator surface (plan §21.1), and this channel is reachable by every searching role.
    return semanticStatusView();
  });

  ipcMain.handle("semantic:search", async (event, request: unknown): Promise<SemanticSearchResponse> => {
    await assertSenderPermission(event, Permission.SEMANTIC_SEARCH);
    const sanitized = sanitizeSearchRequest(request);
    if (!sanitized.ok) {
      return { code: "INVALID_REQUEST", hits: [], degraded: false, message: sanitized.errors.join(" ") };
    }
    return searchSemanticIndex(sanitized.value);
  });

  ipcMain.handle("semantic:similarFailures", async (event, request: unknown): Promise<SemanticSearchResponse> => {
    // A distinct permission: failure similarity exposes cross-run diagnostic patterns, which is a
    // different disclosure from searching the automation the user authored.
    await assertSenderPermission(event, Permission.SEMANTIC_VIEW_FAILURE_SIMILARITY);
    const sanitized = sanitizeSimilarFailureRequest(request);
    if (!sanitized.ok) {
      return { code: "INVALID_REQUEST", hits: [], degraded: false, message: sanitized.errors.join(" ") };
    }
    return similarSemanticFailures(sanitized.value);
  });

  ipcMain.handle("semantic:suggestLocators", async (event, request: unknown): Promise<SemanticSearchResponse> => {
    await assertSenderPermission(event, Permission.SEMANTIC_SEARCH);
    const sanitized = sanitizeLocatorSuggestionRequest(request);
    if (!sanitized.ok) {
      return { code: "INVALID_REQUEST", hits: [], degraded: false, message: sanitized.errors.join(" ") };
    }
    return suggestSemanticLocators(sanitized.value);
  });

  ipcMain.handle("semantic:rebuild", async (event): Promise<SemanticAdminResponse> => {
    const auth = await authorize(event, Permission.SEMANTIC_MANAGE_INDEX, true);
    if (!auth.ok) return { code: auth.code, ok: false, message: auth.message };
    const report = await rebuildSemanticIndex();
    if (!report) {
      return { code: "NOT_AVAILABLE", ok: false, message: "The semantic index is not included in this build." };
    }
    if (!report.ok) {
      // `refusal` is already a bounded enum from the orchestrator, so it is safe to surface verbatim.
      return {
        code: "REBUILD_REFUSED",
        ok: false,
        message: report.refusal ?? "The rebuild did not complete.",
        populated: report.populated
      };
    }
    return { code: "OK", ok: true, generation: report.generation, populated: report.populated };
  });

  ipcMain.handle("semantic:cancelRebuild", async (event): Promise<SemanticAdminResponse> => {
    const auth = await authorize(event, Permission.SEMANTIC_MANAGE_INDEX, true);
    if (!auth.ok) return { code: auth.code, ok: false, message: auth.message };
    // Deliberately NOT implemented as a no-op that reports success. `SemanticRebuildOrchestrator` has
    // no cancellation token, and the pointer swap is an irreversible commit point, so "cancelled"
    // would be a claim this process cannot make. Tracked as awkit-9xh's sibling work; the channel
    // exists so the contract and the UI can be written against a truthful answer.
    return {
      code: "NOT_SUPPORTED",
      ok: false,
      message: "A rebuild in progress cannot be cancelled yet."
    };
  });

  ipcMain.handle("semantic:clear", async (event): Promise<SemanticAdminResponse> => {
    const auth = await authorize(event, Permission.SEMANTIC_MANAGE_INDEX, true);
    if (!auth.ok) return { code: auth.code, ok: false, message: auth.message };
    return clearSemanticIndex();
  });

  ipcMain.handle("semantic:getSettings", async (event): Promise<SemanticSettingsView> => {
    await assertSenderPermission(event, Permission.SEMANTIC_SEARCH);
    return semanticSettings();
  });

  ipcMain.handle("semantic:updateSettings", async (event, patch: unknown): Promise<SemanticAdminResponse> => {
    // Changing whether the index runs at all is index management, not a display preference.
    const auth = await authorize(event, Permission.SEMANTIC_MANAGE_INDEX, true);
    if (!auth.ok) return { code: auth.code, ok: false, message: auth.message };
    const sanitized = sanitizeSettingsPatch(patch);
    if (!sanitized.ok) {
      return { code: "SETTINGS_REJECTED", ok: false, message: sanitized.errors.join(" ") };
    }
    try {
      await updateUiSettings({ semantic: sanitized.value });
      return { code: "OK", ok: true };
    } catch {
      // `updateUiSettings` throws with the aggregated validation text; that text is ours, not a
      // native message, but the reason code is what the renderer switches on.
      return { code: "SETTINGS_REJECTED", ok: false, message: "The semantic settings could not be saved." };
    }
  });
}
