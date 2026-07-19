/**
 * Security IPC — local virtual-user authentication (trusted core). Every handler is sender-guarded
 * (also covered by the global guard in `ipc/index.ts`) and schema-validates its payload before any
 * service runs. Handlers return only PrincipalSnapshots (UI hints) or safe reason codes — never
 * password material, hashes, or internal validation detail (audit §20/§22).
 *
 * Namespaces are deliberately `security:*` (NOT the pre-existing automation `auth:*`/`session:*`).
 */
import { ipcMain } from "electron";
import { assertTrustedSender } from "./senderGuard";
import { getSecurityKernel, isSecureStorageAvailable } from "../security/securityKernel";
import { AuthReason, SecurityError } from "@src/security/errors/ReasonCodes";
import { parseBootstrap, parseChangePassword, parseLoginRequest, parseSessionRef } from "@src/security/ipc/SecurityIpcSchema";
import {
  parseAdminCreateUser,
  parseAdminListAudit,
  parseAdminReauth,
  parseAdminResetPassword,
  parseAdminSetStatus,
  parseAdminUpdateUser,
  parseAdminUserId,
  parseSessionField
} from "@src/security/ipc/SecurityAdminIpcSchema";
import { BUILTIN_ROLES, Permission, ROLE_IDS, type Permission as PermissionType } from "@src/security/authz/Permissions";
import type { AuthorizedActor } from "@src/security/authz/AuthorizationService";
import type { SecurityKernel } from "@src/security/SecurityKernel";

/**
 * Run an admin operation behind the trusted authorization boundary: validate the session + require
 * `permission` (deny-by-default), optionally require a fresh re-auth for sensitive ops, then run `fn`.
 * A SecurityError (session expired / not authorized / reauth required / domain guard) is mapped to a safe
 * reason code; any other failure collapses to UNKNOWN. This is the real boundary — a crafted IPC or
 * DevTools call reaches here even if the UI button was forced.
 */
async function adminCall(
  sessionRef: string,
  permission: PermissionType,
  sensitive: boolean,
  fn: (actor: AuthorizedActor, kernel: SecurityKernel) => Promise<unknown> | unknown
): Promise<unknown> {
  try {
    const kernel = await getSecurityKernel();
    const actor = await kernel.authz.requirePermission(sessionRef, permission);
    if (sensitive) kernel.authz.requireFreshReauth(sessionRef);
    return await fn(actor, kernel);
  } catch (error) {
    return { ok: false, reason: error instanceof SecurityError ? error.reason : AuthReason.UNKNOWN };
  }
}

/** Uniform mapping for malformed payloads or unexpected failures — never leak internals to the renderer. */
function safeFailure(): { ok: false; reason: string } {
  return { ok: false, reason: AuthReason.UNKNOWN };
}

export function registerSecurityIpc(): void {
  ipcMain.handle("security:getBootState", async (event) => {
    assertTrustedSender(event);
    if (!isSecureStorageAvailable()) {
      return { provisioned: false, secureStorageAvailable: false };
    }
    try {
      const kernel = await getSecurityKernel();
      return { ...kernel.getBootState(), secureStorageAvailable: true };
    } catch {
      // Store/keystore failure → fail closed so the gate shows the "unavailable" surface, not a raw error.
      return { provisioned: false, secureStorageAvailable: false };
    }
  });

  ipcMain.handle("security:getLoginOptions", async (event) => {
    assertTrustedSender(event);
    try {
      const kernel = await getSecurityKernel();
      return kernel.auth.getLoginOptions();
    } catch {
      return [];
    }
  });

  ipcMain.handle("security:bootstrapSuperUser", async (event, input: unknown) => {
    assertTrustedSender(event);
    if (!isSecureStorageAvailable()) return { ok: false, reason: AuthReason.STORAGE_UNAVAILABLE };
    try {
      const payload = parseBootstrap(input);
      const kernel = await getSecurityKernel();
      return await kernel.auth.bootstrapSuperUser(payload);
    } catch {
      return safeFailure();
    }
  });

  ipcMain.handle("security:login", async (event, request: unknown) => {
    assertTrustedSender(event);
    if (!isSecureStorageAvailable()) return { ok: false, reason: AuthReason.STORAGE_UNAVAILABLE };
    try {
      const payload = parseLoginRequest(request);
      const kernel = await getSecurityKernel();
      return await kernel.auth.login(payload);
    } catch {
      return safeFailure();
    }
  });

  ipcMain.handle("security:validateSession", async (event, sessionRef: unknown) => {
    assertTrustedSender(event);
    try {
      const ref = parseSessionRef(sessionRef);
      const kernel = await getSecurityKernel();
      return await kernel.auth.validateSession(ref);
    } catch {
      return { valid: false, reason: AuthReason.SESSION_EXPIRED };
    }
  });

  ipcMain.handle("security:logout", async (event, sessionRef: unknown) => {
    assertTrustedSender(event);
    try {
      const ref = parseSessionRef(sessionRef);
      const kernel = await getSecurityKernel();
      await kernel.auth.logout(ref);
    } catch {
      /* logout is best-effort; never surface internals */
    }
  });

  ipcMain.handle("security:changePassword", async (event, input: unknown) => {
    assertTrustedSender(event);
    try {
      const payload = parseChangePassword(input);
      const kernel = await getSecurityKernel();
      return await kernel.auth.changePassword(payload.sessionRef, payload.currentPassword, payload.newPassword);
    } catch {
      return safeFailure();
    }
  });

  // ── Re-authentication (confirm current password to unlock sensitive admin ops for 5 min) ────────────
  ipcMain.handle("security:reauth", async (event, input: unknown) => {
    assertTrustedSender(event);
    try {
      const payload = parseAdminReauth(input);
      const kernel = await getSecurityKernel();
      return await kernel.auth.reauthenticate(payload.sessionRef, payload.password);
    } catch {
      return safeFailure();
    }
  });

  // ── Super-User administration (Phase 3). Every handler is authorization-enforced via adminCall. ─────
  ipcMain.handle("security:admin:listUsers", async (event, input: unknown) => {
    assertTrustedSender(event);
    try {
      const { sessionRef } = parseSessionField(input);
      return await adminCall(sessionRef, Permission.USER_MANAGE, false, (actor, kernel) => ({
        ok: true,
        value: kernel.userAdmin.listUsers(actor)
      }));
    } catch {
      return safeFailure();
    }
  });

  ipcMain.handle("security:admin:createUser", async (event, input: unknown) => {
    assertTrustedSender(event);
    try {
      const p = parseAdminCreateUser(input);
      return await adminCall(p.sessionRef, Permission.USER_MANAGE, true, (actor, kernel) =>
        kernel.userAdmin.createUser(actor, { username: p.username, password: p.password, displayName: p.displayName, roles: p.roles })
      );
    } catch {
      return safeFailure();
    }
  });

  ipcMain.handle("security:admin:updateUser", async (event, input: unknown) => {
    assertTrustedSender(event);
    try {
      const p = parseAdminUpdateUser(input);
      return await adminCall(p.sessionRef, Permission.USER_MANAGE, true, (actor, kernel) =>
        kernel.userAdmin.updateUser(actor, p.userId, { displayName: p.displayName, roles: p.roles })
      );
    } catch {
      return safeFailure();
    }
  });

  ipcMain.handle("security:admin:setStatus", async (event, input: unknown) => {
    assertTrustedSender(event);
    try {
      const p = parseAdminSetStatus(input);
      return await adminCall(p.sessionRef, Permission.USER_MANAGE, true, (actor, kernel) =>
        kernel.userAdmin.setStatus(actor, p.userId, p.status)
      );
    } catch {
      return safeFailure();
    }
  });

  ipcMain.handle("security:admin:resetPassword", async (event, input: unknown) => {
    assertTrustedSender(event);
    try {
      const p = parseAdminResetPassword(input);
      return await adminCall(p.sessionRef, Permission.USER_MANAGE, true, (actor, kernel) =>
        kernel.userAdmin.resetPassword(actor, p.userId, p.newPassword)
      );
    } catch {
      return safeFailure();
    }
  });

  ipcMain.handle("security:admin:revokeSessions", async (event, input: unknown) => {
    assertTrustedSender(event);
    try {
      const p = parseAdminUserId(input);
      return await adminCall(p.sessionRef, Permission.USER_MANAGE, true, (actor, kernel) =>
        kernel.userAdmin.revokeSessions(actor, p.userId)
      );
    } catch {
      return safeFailure();
    }
  });

  ipcMain.handle("security:admin:listRoles", async (event, input: unknown) => {
    assertTrustedSender(event);
    try {
      const { sessionRef } = parseSessionField(input);
      return await adminCall(sessionRef, Permission.ROLE_VIEW, false, () => ({
        ok: true,
        value: ROLE_IDS.map((id) => ({
          id,
          name: BUILTIN_ROLES[id].name,
          description: BUILTIN_ROLES[id].description,
          builtIn: true,
          permissions: [...BUILTIN_ROLES[id].permissions]
        }))
      }));
    } catch {
      return safeFailure();
    }
  });

  ipcMain.handle("security:admin:listAudit", async (event, input: unknown) => {
    assertTrustedSender(event);
    try {
      const p = parseAdminListAudit(input);
      return await adminCall(p.sessionRef, Permission.AUDIT_VIEW, false, (_actor, kernel) => ({
        ok: true,
        value: kernel.store.listAudit(p.limit ?? 200, p.offset ?? 0)
      }));
    } catch {
      return safeFailure();
    }
  });
}
