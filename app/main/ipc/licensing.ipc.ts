/**
 * Licensing IPC — the trusted boundary for viewing and changing the per-machine license. Every handler
 * is sender-guarded, RBAC-checked (deny-by-default), and audited. Sensitive changes (import/replace/
 * revoke/remove) additionally require a fresh re-authentication. Licensing is INDEPENDENT of the user's
 * identity/roles for its *validity*, but *managing* it is a privileged Super-User action — so these
 * handlers authorize the acting user without coupling license state to authentication.
 *
 * A crafted IPC / DevTools call reaches here even if the UI hid a button; this is the real enforcement.
 */
import { ipcMain } from "electron";
import { assertTrustedSender } from "./senderGuard";
import { getSecurityKernel } from "../security/securityKernel";
import { AuthReason, SecurityError } from "@src/security/errors/ReasonCodes";
import { Permission } from "@src/security/authz/Permissions";
import type { AuthorizedActor } from "@src/security/authz/AuthorizationService";
import type { SecurityKernel } from "@src/security/SecurityKernel";
import { getLicenseService } from "../licensing/licenseRuntime";
import type { LicenseDocument } from "@src/licensing/LicenseTypes";

type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

/** Run a licensing operation behind the authorization boundary (mirrors the admin call pattern). */
async function licensingCall<T>(
  sessionRef: unknown,
  permission: Permission,
  sensitive: boolean,
  fn: (actor: AuthorizedActor, kernel: SecurityKernel) => Promise<T> | T
): Promise<Result<T>> {
  try {
    if (typeof sessionRef !== "string" || sessionRef.length === 0) {
      return { ok: false, reason: AuthReason.UNKNOWN };
    }
    const kernel = await getSecurityKernel();
    const actor = await kernel.authz.requirePermission(sessionRef, permission);
    if (sensitive) kernel.authz.requireFreshReauth(sessionRef);
    const value = await fn(actor, kernel);
    return { ok: true, value };
  } catch (error) {
    return { ok: false, reason: error instanceof SecurityError ? error.reason : AuthReason.UNKNOWN };
  }
}

/** Append a licensing event to the shared security audit trail (never logs secrets/keys/raw hardware). */
async function auditLicense(
  kernel: SecurityKernel,
  actor: AuthorizedActor,
  eventType: string,
  result: "success" | "failure",
  reasonCode: string | null,
  detail: Record<string, unknown>
): Promise<void> {
  await kernel.store
    .appendAudit({
      at: new Date().toISOString(),
      eventType,
      result,
      actorUserId: actor.user.id,
      actorName: actor.user.username,
      targetType: "license",
      targetId: null,
      sessionId: actor.sessionRef,
      reasonCode,
      detail
    })
    .catch(() => undefined);
}

/** Light structural guard for an imported license (untrusted renderer input). The domain re-validates. */
function asLicenseDocument(value: unknown): LicenseDocument | null {
  return value && typeof value === "object" ? (value as LicenseDocument) : null;
}

export function registerLicensingIpc(): void {
  ipcMain.handle("licensing:getStatus", async (event, sessionRef: unknown) => {
    assertTrustedSender(event);
    return licensingCall(sessionRef, Permission.LICENSE_VIEW, false, () => getLicenseService().getStatus());
  });

  ipcMain.handle("licensing:revalidate", async (event, sessionRef: unknown) => {
    assertTrustedSender(event);
    return licensingCall(sessionRef, Permission.LICENSE_VIEW, false, async (actor, kernel) => {
      const status = getLicenseService().getStatus();
      await auditLicense(kernel, actor, "LICENSE_VALIDATE", "success", status.reasonCode, { status: status.status });
      return status;
    });
  });

  ipcMain.handle("licensing:exportRequest", async (event, sessionRef: unknown) => {
    assertTrustedSender(event);
    return licensingCall(sessionRef, Permission.LICENSE_EXPORT_REQUEST, false, async (actor, kernel) => {
      const request = getLicenseService().exportActivationRequest();
      await auditLicense(kernel, actor, "LICENSE_ACTIVATION_REQUEST_EXPORT", "success", null, {
        requestId: request.requestId,
        fingerprintHash: request.fingerprintHash
      });
      return request;
    });
  });

  ipcMain.handle("licensing:import", async (event, input: unknown) => {
    assertTrustedSender(event);
    const { sessionRef, license } = (input ?? {}) as { sessionRef?: unknown; license?: unknown };
    return licensingCall(sessionRef, Permission.LICENSE_IMPORT, true, async (actor, kernel) => {
      const doc = asLicenseDocument(license);
      if (!doc) {
        await auditLicense(kernel, actor, "LICENSE_IMPORT", "failure", "LICENSE_FILE_CORRUPTED", {});
        return { ok: false, rejectedReason: "CORRUPTED" as const, status: getLicenseService().getStatus() };
      }
      const outcome = getLicenseService().importLicense(doc);
      await auditLicense(
        kernel,
        actor,
        "LICENSE_IMPORT",
        outcome.ok ? "success" : "failure",
        outcome.ok ? outcome.status.reasonCode : outcome.rejectedReason ?? null,
        { status: outcome.status.status }
      );
      return outcome;
    });
  });

  // Replace = import with intent to overwrite an existing license (same validation + atomic write).
  ipcMain.handle("licensing:replace", async (event, input: unknown) => {
    assertTrustedSender(event);
    const { sessionRef, license } = (input ?? {}) as { sessionRef?: unknown; license?: unknown };
    return licensingCall(sessionRef, Permission.LICENSE_REPLACE, true, async (actor, kernel) => {
      const doc = asLicenseDocument(license);
      if (!doc) {
        await auditLicense(kernel, actor, "LICENSE_REPLACE", "failure", "LICENSE_FILE_CORRUPTED", {});
        return { ok: false, rejectedReason: "CORRUPTED" as const, status: getLicenseService().getStatus() };
      }
      const outcome = getLicenseService().importLicense(doc);
      await auditLicense(
        kernel,
        actor,
        "LICENSE_REPLACE",
        outcome.ok ? "success" : "failure",
        outcome.ok ? outcome.status.reasonCode : outcome.rejectedReason ?? null,
        { status: outcome.status.status }
      );
      return outcome;
    });
  });

  ipcMain.handle("licensing:revoke", async (event, sessionRef: unknown) => {
    assertTrustedSender(event);
    return licensingCall(sessionRef, Permission.LICENSE_REVOKE, true, async (actor, kernel) => {
      const outcome = getLicenseService().revokeLocal();
      await auditLicense(kernel, actor, "LICENSE_REVOKE", outcome.ok ? "success" : "failure", outcome.reason ?? null, {});
      return outcome;
    });
  });

  ipcMain.handle("licensing:remove", async (event, sessionRef: unknown) => {
    assertTrustedSender(event);
    return licensingCall(sessionRef, Permission.LICENSE_REVOKE, true, async (actor, kernel) => {
      const outcome = getLicenseService().removeLocal();
      await auditLicense(kernel, actor, "LICENSE_REMOVE", "success", outcome.status.reasonCode, {});
      return outcome;
    });
  });
}
