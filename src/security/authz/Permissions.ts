/**
 * Authorization permission registry — the SINGLE source of truth for permissions and the built-in roles.
 * Pure and dependency-free so both the trusted main process (enforcement) and the renderer (UI hints)
 * import the same constants. No permission string is ever hardcoded in a component; import `Permission.*`.
 *
 * Design: docs/plans/SECURE_LOGIN_AUTHORIZATION_LICENSING_IMPLEMENTATION_PLAN.md §12. v1 ships immutable
 * built-in roles only (O-2); per-user permission overrides are deferred to v2 (O-4) but the effective-
 * permission computation is written so they can be layered in without changing callers.
 */

/** Every permission the app understands. Page permissions gate route access; the rest gate actions. */
export const Permission = {
  // ── Page access (route-level) ──────────────────────────────────────────────
  PAGE_DASHBOARD: "page.dashboard",
  PAGE_WORKFLOWS: "page.workflows",
  PAGE_FLOWS: "page.flows",
  PAGE_DATA_SOURCES: "page.dataSources",
  PAGE_INSTANCES: "page.instances",
  PAGE_REPORTS: "page.reports",
  PAGE_RECORDER: "page.recorder",
  PAGE_SETTINGS: "page.settings",
  PAGE_ADMIN: "page.admin", // Super User Administration area
  PAGE_LICENSE: "page.license",
  // ── Workflow / flow actions ────────────────────────────────────────────────
  WORKFLOW_VIEW: "workflow.view",
  WORKFLOW_CREATE: "workflow.create",
  WORKFLOW_EDIT: "workflow.edit",
  WORKFLOW_DELETE: "workflow.delete",
  WORKFLOW_EXECUTE: "workflow.execute",
  WORKFLOW_STOP: "workflow.stop",
  // ── Data / reports ─────────────────────────────────────────────────────────
  DATASOURCE_MANAGE: "datasource.manage",
  REPORT_EXPORT: "report.export",
  // ── System configuration ───────────────────────────────────────────────────
  SETTINGS_EDIT: "settings.edit",
  /** Manage the custom workspace logo (Settings → Appearance → Branding). Super-User only. */
  SETTINGS_BRANDING_MANAGE: "settings.appearance.branding.manage",
  CONFIG_VIEW_SENSITIVE: "config.viewSensitive",
  // ── Administration ─────────────────────────────────────────────────────────
  USER_MANAGE: "user.manage",
  ROLE_VIEW: "role.view",
  AUDIT_VIEW: "audit.view",
  // ── Licensing (granular; independent of authentication/RBAC data) ───────────
  LICENSE_MANAGE: "license.manage", // umbrella (kept for compatibility)
  LICENSE_VIEW: "license.view",
  LICENSE_EXPORT_REQUEST: "license.export_request",
  LICENSE_IMPORT: "license.import",
  LICENSE_REPLACE: "license.replace",
  LICENSE_REVOKE: "license.revoke",
  LICENSE_AUDIT_VIEW: "license.audit.view"
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

/** All permission values (used to grant the SuperUser role everything). */
export const ALL_PERMISSIONS: readonly Permission[] = Object.freeze(Object.values(Permission));

/** Sensitive actions that additionally require a fresh re-authentication (§11). */
export const SENSITIVE_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  Permission.USER_MANAGE,
  Permission.LICENSE_MANAGE,
  Permission.LICENSE_IMPORT,
  Permission.LICENSE_REPLACE,
  Permission.LICENSE_REVOKE,
  Permission.SETTINGS_EDIT,
  Permission.SETTINGS_BRANDING_MANAGE
]);

export type RoleId = "SuperUser" | "Administrator" | "Operator" | "Viewer";

export interface RoleDefinition {
  id: RoleId;
  name: string;
  description: string;
  /** Built-in roles are immutable in v1 (no custom-role creation). */
  builtIn: true;
  permissions: readonly Permission[];
}

const VIEWER_PERMISSIONS: readonly Permission[] = [
  Permission.PAGE_DASHBOARD,
  Permission.PAGE_WORKFLOWS,
  Permission.PAGE_FLOWS,
  Permission.PAGE_DATA_SOURCES,
  Permission.PAGE_INSTANCES,
  Permission.PAGE_REPORTS,
  Permission.WORKFLOW_VIEW
];

const OPERATOR_PERMISSIONS: readonly Permission[] = [
  ...VIEWER_PERMISSIONS,
  Permission.PAGE_RECORDER,
  Permission.WORKFLOW_CREATE,
  Permission.WORKFLOW_EDIT,
  Permission.WORKFLOW_EXECUTE,
  Permission.WORKFLOW_STOP,
  Permission.DATASOURCE_MANAGE,
  Permission.REPORT_EXPORT
];

// Administrator = everything except user administration, licensing, and workspace branding (those stay
// Super-User-only). Every licensing permission (page.license + license.*) is withheld here so only the
// Super User manages licenses — matching "Built-in Super User receives the required licensing
// permissions" — and the custom-logo permission is withheld the same way (branding is Super-User-only).
const ADMINISTRATOR_PERMISSIONS: readonly Permission[] = ALL_PERMISSIONS.filter(
  (p) =>
    p !== Permission.USER_MANAGE &&
    p !== Permission.PAGE_LICENSE &&
    p !== Permission.SETTINGS_BRANDING_MANAGE &&
    !p.startsWith("license.")
);

/** Immutable built-in roles. Order = privilege rank (index 0 = highest). */
export const BUILTIN_ROLES: Readonly<Record<RoleId, RoleDefinition>> = Object.freeze({
  SuperUser: {
    id: "SuperUser",
    name: "Super User",
    description: "Full control of every system component, users, roles, and licensing.",
    builtIn: true,
    permissions: ALL_PERMISSIONS
  },
  Administrator: {
    id: "Administrator",
    name: "Administrator",
    description: "Full operational control except user administration and licensing.",
    builtIn: true,
    permissions: ADMINISTRATOR_PERMISSIONS
  },
  Operator: {
    id: "Operator",
    name: "Operator",
    description: "Build, run, and stop workflows; manage data sources; export reports.",
    builtIn: true,
    permissions: OPERATOR_PERMISSIONS
  },
  Viewer: {
    id: "Viewer",
    name: "Viewer",
    description: "Read-only access to the main workspaces.",
    builtIn: true,
    permissions: VIEWER_PERMISSIONS
  }
});

export const ROLE_IDS: readonly RoleId[] = Object.freeze(Object.keys(BUILTIN_ROLES) as RoleId[]);

/** Only the SuperUser role may manage users and licensing — used for privilege-escalation guards. */
export const SUPER_USER_ROLE: RoleId = "SuperUser";

export function isRoleId(value: unknown): value is RoleId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(BUILTIN_ROLES, value);
}

export function roleDefinition(id: RoleId): RoleDefinition {
  return BUILTIN_ROLES[id];
}

/**
 * Effective permission set for a set of assigned role ids: the union of each role's permissions.
 * A protected Super User is always treated as holding the SuperUser role even if its stored roles drift.
 * Unknown role ids are ignored (deny-by-default). Overrides (v2) would be applied here.
 */
export function effectivePermissions(input: { roles: readonly string[]; isProtectedSuperUser?: boolean }): Set<Permission> {
  const out = new Set<Permission>();
  const roles = input.isProtectedSuperUser ? [...input.roles, SUPER_USER_ROLE] : input.roles;
  for (const roleId of roles) {
    if (!isRoleId(roleId)) continue;
    for (const permission of BUILTIN_ROLES[roleId].permissions) out.add(permission);
  }
  return out;
}

/** True if the assigned roles include the Super User role (or the protected flag is set). */
export function isSuperUser(input: { roles: readonly string[]; isProtectedSuperUser?: boolean }): boolean {
  return Boolean(input.isProtectedSuperUser) || input.roles.includes(SUPER_USER_ROLE);
}
