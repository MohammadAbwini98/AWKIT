/**
 * Branding IPC — the trusted boundary for the custom workspace logo (Settings → Appearance → Branding).
 *
 * `branding:getState` is an open read (every signed-in role renders the sidebar, so every role must be
 * able to fetch the active logo — same treatment as `settings:get` / accent). The two mutating channels
 * are gated by `assertSenderPermission(event, SETTINGS_BRANDING_MANAGE)` — sender-bound authorization
 * (the acting session is derived from `event.sender`, never trusted from the renderer), which is
 * Super-User-only and the REAL boundary: a crafted preload/DevTools call reaches here even if the UI hid
 * the card. Every mutation is audited. The renderer already normalizes uploads to PNG; main re-validates
 * (signature + size + real decode) before anything touches disk and never trusts the renderer alone.
 */
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { assertSenderPermission } from "../security/sessionContext";
import { getSecurityKernel } from "../security/securityKernel";
import { Permission } from "@src/security/authz/Permissions";
import { AuthReason, SecurityError } from "@src/security/errors/ReasonCodes";
import type { AuthorizedActor } from "@src/security/authz/AuthorizationService";
import { getBrandingStore } from "../brandingService";

/** Renderer-facing branding state: the active logo as a self-contained data URL (or none). */
export interface BrandingStateView {
  active: boolean;
  /** `data:image/png;base64,...` for direct use as an `<img src>`, or null to use the default icon. */
  dataUrl: string | null;
  updatedAt: string | null;
}

type MutationResult = { ok: true; state: BrandingStateView } | { ok: false; reason: string };

/** Build the renderer view, reading + base64-encoding the managed PNG server-side. Never throws. */
function toStateView(): BrandingStateView {
  try {
    const store = getBrandingStore();
    const state = store.get();
    if (!state.active || !state.manifest) return { active: false, dataUrl: null, updatedAt: null };
    const bytes = store.readActiveBytes();
    if (!bytes) return { active: false, dataUrl: null, updatedAt: null };
    return { active: true, dataUrl: `data:image/png;base64,${bytes.toString("base64")}`, updatedAt: state.manifest.updatedAt };
  } catch {
    return { active: false, dataUrl: null, updatedAt: null };
  }
}

/** Coerce the structured-cloned upload payload into raw bytes (Uint8Array / ArrayBuffer / typed array). */
function toBytes(payload: unknown): Uint8Array | null {
  if (payload instanceof Uint8Array) return payload;
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  if (ArrayBuffer.isView(payload)) {
    return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
  }
  return null;
}

/** Append a branding event to the shared security audit trail (never throws, never logs image bytes). */
async function auditBranding(
  actor: AuthorizedActor,
  eventType: "BRANDING_LOGO_UPDATED" | "BRANDING_LOGO_RESET" | "BRANDING_LOGO_UPDATE_REJECTED",
  result: "success" | "failure",
  reasonCode: string | null,
  detail: Record<string, unknown>
): Promise<void> {
  try {
    const kernel = await getSecurityKernel();
    await kernel.store
      .appendAudit({
        at: new Date().toISOString(),
        eventType,
        result,
        actorUserId: actor.user.id,
        actorName: actor.user.username,
        targetType: "branding",
        targetId: null,
        sessionId: actor.sessionRef,
        reasonCode,
        detail
      })
      .catch(() => undefined);
  } catch {
    /* audit must never break the mutation */
  }
}

/** Authorize a mutating branding call; returns the actor, or a safe reason to relay to the renderer. */
async function authorize(event: IpcMainInvokeEvent): Promise<{ ok: true; actor: AuthorizedActor } | { ok: false; reason: string }> {
  try {
    const actor = await assertSenderPermission(event, Permission.SETTINGS_BRANDING_MANAGE);
    return { ok: true, actor };
  } catch (error) {
    return { ok: false, reason: error instanceof SecurityError ? error.reason : AuthReason.NOT_AUTHORIZED };
  }
}

export function registerBrandingIpc(): void {
  ipcMain.handle("branding:getState", async () => toStateView());

  ipcMain.handle("branding:uploadLogo", async (event, payload: unknown): Promise<MutationResult> => {
    const auth = await authorize(event);
    if (!auth.ok) return auth;
    const bytes = toBytes(payload);
    if (!bytes) {
      await auditBranding(auth.actor, "BRANDING_LOGO_UPDATE_REJECTED", "failure", "INVALID_PAYLOAD", {});
      return { ok: false, reason: "INVALID_PAYLOAD" };
    }
    const outcome = await getBrandingStore().replace(bytes, { updatedByUserId: auth.actor.user.id });
    if (!outcome.ok) {
      await auditBranding(auth.actor, "BRANDING_LOGO_UPDATE_REJECTED", "failure", outcome.reason, { sizeBytes: bytes.length });
      return { ok: false, reason: outcome.reason };
    }
    await auditBranding(auth.actor, "BRANDING_LOGO_UPDATED", "success", null, {
      width: outcome.manifest.width,
      height: outcome.manifest.height,
      sizeBytes: outcome.manifest.sizeBytes
    });
    return { ok: true, state: toStateView() };
  });

  ipcMain.handle("branding:removeLogo", async (event): Promise<MutationResult> => {
    const auth = await authorize(event);
    if (!auth.ok) return auth;
    getBrandingStore().remove();
    await auditBranding(auth.actor, "BRANDING_LOGO_RESET", "success", null, {});
    return { ok: true, state: toStateView() };
  });
}
