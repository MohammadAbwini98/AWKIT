/**
 * UserAdminService — Super-User user management (create/update/enable/disable/archive/reset/revoke) with
 * the trusted invariants: final-active-Super-User protection, protected-Super-User immutability, no
 * privilege escalation, session invalidation on security-sensitive change, and a full audit trail.
 *
 * Authorization is enforced at the IPC boundary (AuthorizationService.requirePermission before these run);
 * every method ALSO re-asserts `USER_MANAGE` on the actor (defense in depth) and performs its domain
 * guards here. Callers pass an already-authorized `AuthorizedActor`. Methods never return password
 * material; the AdminUserView is a non-secret projection.
 *
 * Design: docs/plans/SECURE_LOGIN_AUTHORIZATION_LICENSING_IMPLEMENTATION_PLAN.md §11–§12.
 */
import { randomUUID } from "node:crypto";
import { AuthReason, SecurityError, type AuthReasonCode } from "@src/security/errors/ReasonCodes";
import { hashPassword } from "@src/security/crypto/PasswordHasher";
import { validatePassword } from "@src/security/auth/PasswordPolicy";
import { normalizeUsername, validateUsername } from "@src/security/auth/UsernameRules";
import { Permission, SUPER_USER_ROLE, isRoleId, isSuperUser } from "@src/security/authz/Permissions";
import type { AuthorizationService, AuthorizedActor } from "@src/security/authz/AuthorizationService";
import type { SecurityStore } from "@src/security/store/SecurityStore";
import type { SessionManager } from "@src/security/session/SessionManager";
import type { UserRecord, UserStatus } from "@src/security/store/SecurityStoreSchema";

export interface AdminUserView {
  id: string;
  username: string;
  displayName: string;
  status: UserStatus;
  isProtectedSuperUser: boolean;
  roles: string[];
  permissions: string[];
  mustChangePassword: boolean;
  failedLoginCount: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserInput {
  username: string;
  password: string;
  displayName?: string;
  roles: string[];
}

export interface UpdateUserInput {
  displayName?: string;
  roles?: string[];
}

export type AdminResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; reason: AuthReasonCode; errors?: string[] };

export class UserAdminService {
  constructor(
    private readonly store: SecurityStore,
    private readonly sessions: SessionManager,
    private readonly authz: AuthorizationService,
    private readonly now: () => number = () => Date.now()
  ) {}

  // ── Reads ─────────────────────────────────────────────────────────────────

  listUsers(actor: AuthorizedActor): AdminUserView[] {
    this.assertUserManage(actor);
    return this.store.listUsers().map((u) => this.toView(u));
  }

  // ── Mutations (all reauth-gated at the IPC boundary) ─────────────────────────

  async createUser(actor: AuthorizedActor, input: CreateUserInput): Promise<AdminResult<AdminUserView>> {
    this.assertUserManage(actor);
    const username = validateUsername(input.username);
    if (!username.ok) return { ok: false, reason: AuthReason.USERNAME_INVALID, errors: username.errors };
    const password = validatePassword(input.password, { username: input.username });
    if (!password.ok) return { ok: false, reason: AuthReason.PASSWORD_POLICY, errors: password.errors };
    const roles = this.sanitizeRoles(input.roles);
    if (!roles) return { ok: false, reason: AuthReason.INVALID_ROLE };

    const norm = normalizeUsername(input.username);
    if (this.store.getUserByUsernameNorm(norm)) return { ok: false, reason: AuthReason.USERNAME_TAKEN };

    const nowIso = new Date(this.now()).toISOString();
    const record: UserRecord = {
      id: randomUUID(),
      username: input.username.trim(),
      usernameNorm: norm,
      displayName: (input.displayName ?? input.username).trim(),
      status: "active",
      passwordSecret: hashPassword(input.password),
      passwordAlgo: "scrypt",
      mustChangePassword: true, // admin-set password → force a change on first login
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: null,
      passwordChangedAt: nowIso,
      isProtectedSuperUser: false, // only the first-run bootstrap creates the protected SU
      roles,
      createdAt: nowIso,
      createdBy: actor.user.id,
      updatedAt: nowIso,
      updatedBy: actor.user.id
    };
    await this.store.createUser(record);
    await this.audit(actor, "USER_CREATE", record.id, "success", { username: record.username, roles });
    return { ok: true, value: this.toView(record) };
  }

  async updateUser(actor: AuthorizedActor, userId: string, input: UpdateUserInput): Promise<AdminResult<AdminUserView>> {
    this.assertUserManage(actor);
    const target = this.store.getUserById(userId);
    if (!target) return { ok: false, reason: AuthReason.USER_NOT_FOUND };

    const patch: Partial<UserRecord> = {};
    let rolesChanged = false;

    if (input.displayName !== undefined) patch.displayName = input.displayName.trim();

    if (input.roles !== undefined) {
      const roles = this.sanitizeRoles(input.roles);
      if (!roles) return { ok: false, reason: AuthReason.INVALID_ROLE };
      // The protected Super User must always retain the SuperUser role (cannot be demoted).
      if (target.isProtectedSuperUser && !roles.includes(SUPER_USER_ROLE)) {
        return { ok: false, reason: AuthReason.PROTECTED_SUPER_USER };
      }
      // Removing SuperUser from the final active SU would lock the system out of administration.
      const demotesSuperUser = isSuperUser(target) && !roles.includes(SUPER_USER_ROLE);
      if (demotesSuperUser && this.store.activeSuperUserCount() <= 1) {
        return { ok: false, reason: AuthReason.LAST_ACTIVE_SUPER_USER };
      }
      rolesChanged = JSON.stringify([...roles].sort()) !== JSON.stringify([...target.roles].sort());
      patch.roles = roles;
    }

    if (Object.keys(patch).length === 0) return { ok: true, value: this.toView(target) };

    const nowIso = new Date(this.now()).toISOString();
    patch.updatedAt = nowIso;
    patch.updatedBy = actor.user.id;
    await this.store.updateUser(userId, patch);
    // Security-sensitive permission change → invalidate the target's sessions so new authorization applies.
    if (rolesChanged) await this.sessions.revokeAllForUser(userId);
    await this.audit(actor, "USER_UPDATE", userId, "success", { rolesChanged, roles: patch.roles });
    return { ok: true, value: this.toView(this.store.getUserById(userId)!) };
  }

  /** Enable / disable / archive a user. Disable + archive revoke the target's sessions. */
  async setStatus(actor: AuthorizedActor, userId: string, status: UserStatus): Promise<AdminResult<AdminUserView>> {
    this.assertUserManage(actor);
    const target = this.store.getUserById(userId);
    if (!target) return { ok: false, reason: AuthReason.USER_NOT_FOUND };

    if (status !== "active") {
      // The protected Super User can never be disabled or archived.
      if (target.isProtectedSuperUser) return { ok: false, reason: AuthReason.PROTECTED_SUPER_USER };
      // Never remove the final active Super User.
      if (target.status === "active" && isSuperUser(target) && this.store.activeSuperUserCount() <= 1) {
        return { ok: false, reason: AuthReason.LAST_ACTIVE_SUPER_USER };
      }
    }
    if (target.status === status) return { ok: true, value: this.toView(target) };

    const nowIso = new Date(this.now()).toISOString();
    await this.store.updateUser(userId, { status, updatedAt: nowIso, updatedBy: actor.user.id });
    if (status !== "active") await this.sessions.revokeAllForUser(userId);
    await this.audit(actor, "USER_STATUS", userId, "success", { status });
    return { ok: true, value: this.toView(this.store.getUserById(userId)!) };
  }

  /** Admin password reset — forces a change on next login and revokes all of the target's sessions. */
  async resetPassword(actor: AuthorizedActor, userId: string, newPassword: string): Promise<AdminResult> {
    this.assertUserManage(actor);
    const target = this.store.getUserById(userId);
    if (!target) return { ok: false, reason: AuthReason.USER_NOT_FOUND };
    const password = validatePassword(newPassword, { username: target.username });
    if (!password.ok) return { ok: false, reason: AuthReason.PASSWORD_POLICY, errors: password.errors };

    const nowIso = new Date(this.now()).toISOString();
    await this.store.updateUser(userId, {
      passwordSecret: hashPassword(newPassword),
      passwordAlgo: "scrypt",
      passwordChangedAt: nowIso,
      mustChangePassword: true,
      failedLoginCount: 0,
      lockedUntil: null,
      updatedAt: nowIso,
      updatedBy: actor.user.id
    });
    await this.sessions.revokeAllForUser(userId); // force re-login with the new credential
    await this.audit(actor, "USER_PASSWORD_RESET", userId, "success", {});
    return { ok: true, value: undefined };
  }

  /** Revoke every active session for a user (force sign-out) without other changes. */
  async revokeSessions(actor: AuthorizedActor, userId: string): Promise<AdminResult> {
    this.assertUserManage(actor);
    const target = this.store.getUserById(userId);
    if (!target) return { ok: false, reason: AuthReason.USER_NOT_FOUND };
    await this.sessions.revokeAllForUser(userId);
    await this.audit(actor, "USER_REVOKE_SESSIONS", userId, "success", {});
    return { ok: true, value: undefined };
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private assertUserManage(actor: AuthorizedActor): void {
    if (!actor.permissions.has(Permission.USER_MANAGE)) throw new SecurityError(AuthReason.NOT_AUTHORIZED);
  }

  /** Return a de-duplicated, known-only role list, or null if any role id is invalid. */
  private sanitizeRoles(roles: string[]): string[] | null {
    if (!Array.isArray(roles)) return null;
    const out: string[] = [];
    for (const r of roles) {
      if (!isRoleId(r)) return null;
      if (!out.includes(r)) out.push(r);
    }
    return out;
  }

  private toView(user: UserRecord): AdminUserView {
    const roles = user.isProtectedSuperUser && !user.roles.includes(SUPER_USER_ROLE) ? [...user.roles, SUPER_USER_ROLE] : user.roles;
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      status: user.status,
      isProtectedSuperUser: user.isProtectedSuperUser,
      roles,
      permissions: [...this.authz.permissionsFor(user)],
      mustChangePassword: user.mustChangePassword,
      failedLoginCount: user.failedLoginCount,
      lockedUntil: user.lockedUntil,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };
  }

  private async audit(
    actor: AuthorizedActor,
    eventType: string,
    targetId: string,
    result: "success" | "failure",
    detail: Record<string, unknown>
  ): Promise<void> {
    await this.store
      .appendAudit({
        at: new Date(this.now()).toISOString(),
        eventType,
        result,
        actorUserId: actor.user.id,
        actorName: actor.user.username,
        targetType: "user",
        targetId,
        sessionId: actor.sessionRef,
        detail
      })
      .catch(() => undefined);
  }
}
