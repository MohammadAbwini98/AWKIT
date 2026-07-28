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
 *   2. **No raw native error crosses IPC.** Handlers return stable reason codes. The one exception is
 *      an authorization failure, which throws so the existing `SecurityError` path can reject the
 *      renderer call the same way every other gated channel does.
 *
 * `semantic:rebuild` and `semantic:clear` additionally require a fresh re-authentication, because
 * `SEMANTIC_MANAGE_INDEX` is in `SENSITIVE_PERMISSIONS`.
 */

import { ipcMain } from "electron";

import { Permission } from "@src/security/authz/Permissions";
import {
  sanitizeSearchRequest,
  sanitizeSettingsPatch,
  type SemanticAdminResponse,
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
  semanticStatusView
} from "../semantic/semanticService";

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

  ipcMain.handle("semantic:rebuild", async (event): Promise<SemanticAdminResponse> => {
    await assertSenderPermission(event, Permission.SEMANTIC_MANAGE_INDEX, { sensitive: true });
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
    await assertSenderPermission(event, Permission.SEMANTIC_MANAGE_INDEX, { sensitive: true });
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
    await assertSenderPermission(event, Permission.SEMANTIC_MANAGE_INDEX, { sensitive: true });
    return clearSemanticIndex();
  });

  ipcMain.handle("semantic:getSettings", async (event): Promise<SemanticSettingsView> => {
    await assertSenderPermission(event, Permission.SEMANTIC_SEARCH);
    return semanticSettings();
  });

  ipcMain.handle("semantic:updateSettings", async (event, patch: unknown): Promise<SemanticAdminResponse> => {
    // Changing whether the index runs at all is index management, not a display preference.
    await assertSenderPermission(event, Permission.SEMANTIC_MANAGE_INDEX, { sensitive: true });
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
