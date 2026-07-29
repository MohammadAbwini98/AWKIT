import { randomUUID } from "node:crypto";
import { AuthReason, SecurityError, type AuthReasonCode } from "@src/security/errors/ReasonCodes";
import {
  BUILTIN_ROLES,
  Permission,
  ROLE_IDS,
  isPermission,
  isRoleId
} from "@src/security/authz/Permissions";
import type { AuthorizationService, AuthorizedActor } from "@src/security/authz/AuthorizationService";
import type { SecurityStore } from "@src/security/store/SecurityStore";
import type { SessionManager } from "@src/security/session/SessionManager";
import type { CustomRoleRecord } from "@src/security/store/SecurityStoreSchema";

export interface AdminRoleView {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  permissions: string[];
}

export interface CustomRoleInput {
  name: string;
  description?: string;
  permissions: string[];
}

export type RoleAdminResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; reason: AuthReasonCode; errors?: string[] };

export class RoleAdminService {
  constructor(
    private readonly store: SecurityStore,
    private readonly sessions: SessionManager,
    private readonly authz: AuthorizationService,
    private readonly now: () => number = () => Date.now()
  ) {}

  listRoles(actor: AuthorizedActor): AdminRoleView[] {
    this.assertRoleView(actor);
    const builtIn = ROLE_IDS.map((id) => ({
      id,
      name: BUILTIN_ROLES[id].name,
      description: BUILTIN_ROLES[id].description,
      builtIn: true,
      permissions: [...BUILTIN_ROLES[id].permissions]
    }));
    const custom = this.store.listCustomRoles().map((role) => this.toView(role));
    return [...builtIn, ...custom];
  }

  async createRole(actor: AuthorizedActor, input: CustomRoleInput): Promise<RoleAdminResult<AdminRoleView>> {
    this.assertUserManage(actor);
    const validated = this.validateInput(input);
    if (!validated.ok) return validated;
    if (this.nameTaken(validated.nameNorm)) return { ok: false, reason: AuthReason.ROLE_NAME_TAKEN };
    const nowIso = new Date(this.now()).toISOString();
    const role: CustomRoleRecord = {
      id: `custom:${randomUUID()}`,
      name: validated.name,
      nameNorm: validated.nameNorm,
      description: validated.description,
      permissions: validated.permissions,
      createdAt: nowIso,
      createdBy: actor.user.id,
      updatedAt: nowIso,
      updatedBy: actor.user.id
    };
    await this.store.createCustomRole(role);
    await this.audit(actor, "ROLE_CREATE", role.id, { name: role.name, permissions: role.permissions });
    return { ok: true, value: this.toView(role) };
  }

  async updateRole(
    actor: AuthorizedActor,
    roleId: string,
    input: CustomRoleInput
  ): Promise<RoleAdminResult<AdminRoleView>> {
    this.assertUserManage(actor);
    if (isRoleId(roleId)) return { ok: false, reason: AuthReason.BUILT_IN_ROLE };
    const current = this.store.getCustomRole(roleId);
    if (!current) return { ok: false, reason: AuthReason.ROLE_NOT_FOUND };
    const validated = this.validateInput(input);
    if (!validated.ok) return validated;
    if (this.nameTaken(validated.nameNorm, roleId)) return { ok: false, reason: AuthReason.ROLE_NAME_TAKEN };
    const permissionsChanged =
      JSON.stringify([...current.permissions].sort()) !== JSON.stringify([...validated.permissions].sort());
    const next: CustomRoleRecord = {
      ...current,
      name: validated.name,
      nameNorm: validated.nameNorm,
      description: validated.description,
      permissions: validated.permissions,
      updatedAt: new Date(this.now()).toISOString(),
      updatedBy: actor.user.id
    };
    await this.store.updateCustomRole(roleId, next);
    if (permissionsChanged) await this.revokeAssignedSessions(roleId);
    await this.audit(actor, "ROLE_UPDATE", roleId, {
      name: next.name,
      permissions: next.permissions,
      permissionsChanged
    });
    return { ok: true, value: this.toView(next) };
  }

  async deleteRole(actor: AuthorizedActor, roleId: string): Promise<RoleAdminResult> {
    this.assertUserManage(actor);
    if (isRoleId(roleId)) return { ok: false, reason: AuthReason.BUILT_IN_ROLE };
    const role = this.store.getCustomRole(roleId);
    if (!role) return { ok: false, reason: AuthReason.ROLE_NOT_FOUND };
    const assigned = this.store.listUsers().filter((user) => user.roles.includes(roleId));
    for (const user of assigned) {
      await this.store.updateUser(user.id, {
        roles: user.roles.filter((id) => id !== roleId),
        updatedAt: new Date(this.now()).toISOString(),
        updatedBy: actor.user.id
      });
      await this.sessions.revokeAllForUser(user.id);
    }
    await this.store.deleteCustomRole(roleId);
    await this.audit(actor, "ROLE_DELETE", roleId, { name: role.name, affectedUsers: assigned.length });
    return { ok: true, value: undefined };
  }

  private validateInput(
    input: CustomRoleInput
  ):
    | { ok: true; name: string; nameNorm: string; description: string; permissions: string[] }
    | { ok: false; reason: AuthReasonCode; errors?: string[] } {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 64) {
      return { ok: false, reason: AuthReason.INVALID_ROLE, errors: ["Role name must be 2–64 characters."] };
    }
    if (!Array.isArray(input.permissions)) return { ok: false, reason: AuthReason.INVALID_PERMISSION };
    const permissions: string[] = [];
    for (const permission of input.permissions) {
      if (!isPermission(permission)) return { ok: false, reason: AuthReason.INVALID_PERMISSION };
      if (!permissions.includes(permission)) permissions.push(permission);
    }
    return {
      ok: true,
      name,
      nameNorm: name.toLowerCase(),
      description: (input.description ?? "").trim(),
      permissions
    };
  }

  private nameTaken(nameNorm: string, exceptId?: string): boolean {
    const builtInTaken = ROLE_IDS.some(
      (id) => id.toLowerCase() === nameNorm || BUILTIN_ROLES[id].name.toLowerCase() === nameNorm
    );
    return builtInTaken || this.store.customRoleNameTaken(nameNorm, exceptId);
  }

  private async revokeAssignedSessions(roleId: string): Promise<void> {
    for (const user of this.store.listUsers()) {
      if (user.roles.includes(roleId)) await this.sessions.revokeAllForUser(user.id);
    }
  }

  private assertRoleView(actor: AuthorizedActor): void {
    if (!actor.permissions.has(Permission.ROLE_VIEW)) throw new SecurityError(AuthReason.NOT_AUTHORIZED);
  }

  private assertUserManage(actor: AuthorizedActor): void {
    if (!this.authz.can(actor.user, Permission.USER_MANAGE)) {
      throw new SecurityError(AuthReason.NOT_AUTHORIZED);
    }
  }

  private toView(role: CustomRoleRecord): AdminRoleView {
    return {
      id: role.id,
      name: role.name,
      description: role.description,
      builtIn: false,
      permissions: [...role.permissions]
    };
  }

  private async audit(
    actor: AuthorizedActor,
    eventType: string,
    targetId: string,
    detail: Record<string, unknown>
  ): Promise<void> {
    await this.store.appendAudit({
      at: new Date(this.now()).toISOString(),
      eventType,
      result: "success",
      actorUserId: actor.user.id,
      actorName: actor.user.username,
      targetType: "role",
      targetId,
      sessionId: actor.sessionRef,
      detail
    }).catch(() => undefined);
  }
}
