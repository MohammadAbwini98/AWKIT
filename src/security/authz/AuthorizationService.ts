/**
 * AuthorizationService — the TRUSTED authorization boundary (main process). Every mutating IPC handler
 * calls `requirePermission(sessionRef, perm)` AFTER session validation; this is the real enforcement
 * point (the UI's `can()` hiding is only a hint). Deny-by-default: a permission the principal does not
 * effectively hold throws a SecurityError with a safe reason code.
 *
 * Design: docs/plans/SECURE_LOGIN_AUTHORIZATION_LICENSING_IMPLEMENTATION_PLAN.md §12.3.
 */
import { AuthReason } from "@src/security/errors/ReasonCodes";
import { SecurityError } from "@src/security/errors/ReasonCodes";
import { effectivePermissions, type Permission } from "./Permissions";
import type { SecurityStore } from "@src/security/store/SecurityStore";
import type { SessionManager } from "@src/security/session/SessionManager";
import type { UserRecord } from "@src/security/store/SecurityStoreSchema";

/** Sensitive operations require a re-authentication no older than this (§11). */
export const DEFAULT_REAUTH_WINDOW_MS = 5 * 60 * 1000;

export interface AuthorizedActor {
  user: UserRecord;
  sessionRef: string;
  permissions: Set<Permission>;
}

export interface AuthorizationOptions {
  reauthWindowMs?: number;
}

export class AuthorizationService {
  private readonly reauthWindowMs: number;

  constructor(
    private readonly store: SecurityStore,
    private readonly sessions: SessionManager,
    options: AuthorizationOptions = {}
  ) {
    this.reauthWindowMs = options.reauthWindowMs ?? DEFAULT_REAUTH_WINDOW_MS;
  }

  /** Effective permission set for a user (union of role permissions; protected SU always full). */
  permissionsFor(user: UserRecord): Set<Permission> {
    return effectivePermissions({ roles: user.roles, isProtectedSuperUser: user.isProtectedSuperUser });
  }

  can(user: UserRecord, permission: Permission): boolean {
    return this.permissionsFor(user).has(permission);
  }

  /**
   * Validate the session and require `permission`. Throws SecurityError (SESSION_EXPIRED / NOT_AUTHORIZED)
   * on failure. Returns the acting user + effective permissions on success. This is the boundary a crafted
   * IPC/DevTools call cannot bypass — the UI never reaches the mutation without passing here.
   */
  async requirePermission(sessionRef: string, permission: Permission): Promise<AuthorizedActor> {
    const resolution = await this.sessions.validate(sessionRef);
    if (!resolution.valid) throw new SecurityError(AuthReason.SESSION_EXPIRED);
    const user = this.store.getUserById(resolution.userId);
    // Deactivated/archived/deleted mid-session fails closed.
    if (!user || user.status !== "active") throw new SecurityError(AuthReason.SESSION_EXPIRED);
    const permissions = this.permissionsFor(user);
    if (!permissions.has(permission)) throw new SecurityError(AuthReason.NOT_AUTHORIZED);
    return { user, sessionRef, permissions };
  }

  /** Throw REAUTH_REQUIRED unless the session was re-authenticated within the reauth window. */
  requireFreshReauth(sessionRef: string): void {
    const ageMs = this.sessions.reauthAgeMs(sessionRef);
    if (ageMs == null || ageMs > this.reauthWindowMs) {
      throw new SecurityError(AuthReason.REAUTH_REQUIRED);
    }
  }
}
