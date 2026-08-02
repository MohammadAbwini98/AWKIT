/** Trusted IPC boundary for the singleton Issuer account and external signing key. */
import { ipcMain, shell } from "electron";
import { mkdir } from "node:fs/promises";
import { AuthReason, SecurityError } from "@src/security/errors/ReasonCodes";
import { Permission, isIssuer } from "@src/security/authz/Permissions";
import type { AuthorizedActor } from "@src/security/authz/AuthorizationService";
import type { SecurityKernel } from "@src/security/SecurityKernel";
import {
  LicenseIssuerError
} from "@src/licensing/issuer/LicenseIssuerService";
import type { IssueLicenseInput } from "@src/licensing/issuer/LicenseIssuerContracts";
import { assertTrustedSender } from "./senderGuard";
import { getSecurityKernel } from "../security/securityKernel";
import { getIssuerOutputDirectory, getLicenseIssuerService } from "../licensing/issuerRuntime";

type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

async function issuerCall<T>(
  sessionRef: unknown,
  sensitive: boolean,
  fn: (actor: AuthorizedActor, kernel: SecurityKernel) => Promise<T> | T
): Promise<Result<T>> {
  try {
    if (typeof sessionRef !== "string" || sessionRef.length === 0) {
      return { ok: false, reason: AuthReason.UNKNOWN };
    }
    const kernel = await getSecurityKernel();
    const actor = await kernel.authz.requirePermission(sessionRef, Permission.LICENSE_ISSUE);
    // Permission alone is insufficient: direct grants and Super User's broad permission set must not
    // cross the private-key boundary. Only the dedicated exclusive role may invoke issuer operations.
    if (!isIssuer(actor.user)) throw new SecurityError(AuthReason.NOT_AUTHORIZED);
    if (sensitive) kernel.authz.requireFreshReauth(sessionRef);
    return { ok: true, value: await fn(actor, kernel) };
  } catch (error) {
    if (error instanceof SecurityError) return { ok: false, reason: error.reason };
    if (error instanceof LicenseIssuerError) return { ok: false, reason: error.reason };
    return { ok: false, reason: AuthReason.UNKNOWN };
  }
}

async function auditIssuance(
  kernel: SecurityKernel,
  actor: AuthorizedActor,
  result: "success" | "failure",
  reasonCode: string | null,
  detail: Record<string, unknown>
): Promise<void> {
  await kernel.store.appendAudit({
    at: new Date().toISOString(),
    eventType: "LICENSE_ISSUE",
    result,
    actorUserId: actor.user.id,
    actorName: actor.user.username,
    targetType: "license",
    targetId: typeof detail.licenseId === "string" ? detail.licenseId : null,
    sessionId: actor.sessionRef,
    reasonCode,
    detail
  }).catch(() => undefined);
}

export function registerIssuerIpc(): void {
  ipcMain.handle("issuer:getReadiness", async (event, sessionRef: unknown) => {
    assertTrustedSender(event);
    return issuerCall(sessionRef, false, () => getLicenseIssuerService().readiness());
  });

  ipcMain.handle("issuer:issue", async (event, input: unknown) => {
    assertTrustedSender(event);
    const { sessionRef, request } = (input ?? {}) as { sessionRef?: unknown; request?: unknown };
    return issuerCall(sessionRef, true, async (actor, kernel) => {
      try {
        const issued = await getLicenseIssuerService().issue(request as IssueLicenseInput);
        await auditIssuance(kernel, actor, "success", null, {
          licenseId: issued.licenseId,
          requestId: (request as IssueLicenseInput | undefined)?.activationRequest?.requestId,
          machineFingerprintHash: issued.machineFingerprintHash,
          expiresAtUtc: issued.expiresAtUtc,
          entitlements: issued.entitlements,
          outputFile: issued.fileName
        });
        return issued;
      } catch (error) {
        const reason = error instanceof LicenseIssuerError ? error.reason : AuthReason.UNKNOWN;
        await auditIssuance(kernel, actor, "failure", reason, {});
        throw error;
      }
    });
  });

  ipcMain.handle("issuer:openOutputFolder", async (event, sessionRef: unknown) => {
    assertTrustedSender(event);
    return issuerCall(sessionRef, false, async () => {
      const outputDirectory = getIssuerOutputDirectory();
      await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
      const error = await shell.openPath(outputDirectory);
      if (error) throw new Error(error);
      return outputDirectory;
    });
  });
}
