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
import { AuthReason } from "@src/security/errors/ReasonCodes";
import { parseBootstrap, parseChangePassword, parseLoginRequest, parseSessionRef } from "@src/security/ipc/SecurityIpcSchema";

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
}
