/**
 * Authorization / RBAC + Super-User administration checks — trusted core, headless (no Electron).
 * Run: `npm run verify:authz`.
 *
 * Proves the REAL security boundary (main-process authorization), not UI hiding: permission enforcement,
 * privilege-escalation denial, final-active-Super-User protection, disabled-user + session revocation,
 * reauth-gated sensitive ops, and that a direct (UI-bypassing) admin call is denied. Uses a temp DB +
 * passthrough crypto + an injectable clock so reauth/idle windows are deterministic.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecurityKernel } from "../src/security/SecurityKernel";
import { PassthroughColumnCrypto } from "../src/security/crypto/ColumnCrypto";
import { AuthReason, SecurityError } from "../src/security/errors/ReasonCodes";
import { SECURITY_DB_FILENAME } from "../src/security/store/SecurityStoreSchema";
import { BUILTIN_ROLES, Permission, SENSITIVE_PERMISSIONS, effectivePermissions } from "../src/security/authz/Permissions";
import type { Permission as Perm } from "../src/security/authz/Permissions";
// Type-only import of `RouteId` inside this module, so no React component is pulled in.
import { RoutePermissions } from "../app/renderer/security/routePermissions";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean): void {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.log(`  ✗ ${name}`); }
}

function makeClock(start: number) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const SU_PASSWORD = "Sup3rSecret!42";
const OP_PASSWORD = "Oper8tor!Pass9";
const NEW_PASSWORD = "N3wStr0ng!Pass";

async function freshKernel(clock: { now: () => number }) {
  const dir = mkdtempSync(join(tmpdir(), "awkit-authz-"));
  const dbPath = join(dir, SECURITY_DB_FILENAME);
  const kernel = await SecurityKernel.open(dbPath, new PassthroughColumnCrypto(), { now: clock.now });
  return { kernel, dbPath };
}

/** Log a user in and return the opaque sessionRef (throws if the login fails). */
async function loginSession(kernel: SecurityKernel, username: string, password: string): Promise<string> {
  const res = await kernel.auth.login({ providerId: "local", username, password });
  if (!res.ok) throw new Error(`login failed for ${username}: ${res.reason}`);
  return res.principal.sessionRef;
}

/** Mirror the IPC `adminCall` boundary exactly: requirePermission (+ optional fresh reauth) then run. */
async function adminCall<T>(
  kernel: SecurityKernel,
  sessionRef: string,
  permission: Perm,
  sensitive: boolean,
  fn: (actor: Awaited<ReturnType<SecurityKernel["authz"]["requirePermission"]>>) => Promise<T> | T
): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
  try {
    const actor = await kernel.authz.requirePermission(sessionRef, permission);
    if (sensitive) kernel.authz.requireFreshReauth(sessionRef);
    return { ok: true, value: await fn(actor) };
  } catch (error) {
    return { ok: false, reason: error instanceof SecurityError ? error.reason : AuthReason.UNKNOWN };
  }
}

async function main(): Promise<void> {
  // ── Role → permission model ─────────────────────────────────────────────────
  console.log("Role permissions:");
  const su = effectivePermissions({ roles: ["SuperUser"] });
  const admin = effectivePermissions({ roles: ["Administrator"] });
  const op = effectivePermissions({ roles: ["Operator"] });
  const viewer = effectivePermissions({ roles: ["Viewer"] });
  check("SuperUser holds USER_MANAGE + LICENSE_MANAGE", su.has(Permission.USER_MANAGE) && su.has(Permission.LICENSE_MANAGE));
  check("Administrator lacks USER_MANAGE + LICENSE_MANAGE", !admin.has(Permission.USER_MANAGE) && !admin.has(Permission.LICENSE_MANAGE));
  check("Administrator can edit settings + manage data sources", admin.has(Permission.SETTINGS_EDIT) && admin.has(Permission.DATASOURCE_MANAGE));
  check("Operator can execute but not delete workflows", op.has(Permission.WORKFLOW_EXECUTE) && !op.has(Permission.WORKFLOW_DELETE));
  check("Operator has no admin page access", !op.has(Permission.PAGE_ADMIN) && !op.has(Permission.USER_MANAGE));
  check("Viewer is view-only (no create)", viewer.has(Permission.WORKFLOW_VIEW) && !viewer.has(Permission.WORKFLOW_CREATE));
  check("unknown role ids contribute nothing (deny-by-default)", effectivePermissions({ roles: ["Nonsense"] }).size === 0);
  check("protected flag grants SuperUser even with empty roles", effectivePermissions({ roles: [], isProtectedSuperUser: true }).has(Permission.USER_MANAGE));
  const customPermissions = effectivePermissions({
    roles: ["custom:test"],
    customRoles: new Map([["custom:test", [Permission.WORKFLOW_EXECUTE, "unknown.permission"]]]),
    grants: [Permission.SETTINGS_EDIT],
    denies: [Permission.WORKFLOW_EXECUTE]
  });
  check("custom roles contribute only registered permissions", customPermissions.has(Permission.SETTINGS_EDIT) && customPermissions.size === 1);
  check("direct deny overrides role grants", !customPermissions.has(Permission.WORKFLOW_EXECUTE));

  const clock = makeClock(Date.parse("2026-07-19T00:00:00.000Z"));
  const { kernel, dbPath } = await freshKernel(clock);
  await kernel.auth.bootstrapSuperUser({ username: "superuser", password: SU_PASSWORD, displayName: "Super User" });
  const suSession = await loginSession(kernel, "superuser", SU_PASSWORD);

  // ── Super User has admin capability; snapshot carries roles + permissions ────
  console.log("Super User:");
  const suUser = kernel.store.getUserByUsernameNorm("superuser")!;
  check("bootstrapped SU has the SuperUser role", suUser.roles.includes("SuperUser") && suUser.isProtectedSuperUser);
  const suList = await adminCall(kernel, suSession, Permission.USER_MANAGE, false, (a) => kernel.userAdmin.listUsers(a));
  check("SU can list users", suList.ok === true && suList.value.length === 1);

  // ── Create + manage users (SU) ───────────────────────────────────────────────
  console.log("User management:");
  const created = await adminCall(kernel, suSession, Permission.USER_MANAGE, true, (a) =>
    kernel.userAdmin.createUser(a, { username: "operator", password: OP_PASSWORD, displayName: "Op", roles: ["Operator"] })
  );
  check("SU creates an Operator user", created.ok === true && created.value.ok === true);
  const opUser = kernel.store.getUserByUsernameNorm("operator")!;
  check("new user is forced to change password", opUser.mustChangePassword === true);
  check("new user is not a protected SU", opUser.isProtectedSuperUser === false && opUser.roles.join() === "Operator");
  const dupe = await adminCall(kernel, suSession, Permission.USER_MANAGE, true, (a) =>
    kernel.userAdmin.createUser(a, { username: "operator", password: OP_PASSWORD, roles: ["Operator"] })
  );
  check("duplicate username is rejected", dupe.ok === true && dupe.value.ok === false && dupe.value.reason === AuthReason.USERNAME_TAKEN);
  const badRole = await adminCall(kernel, suSession, Permission.USER_MANAGE, true, (a) =>
    kernel.userAdmin.createUser(a, { username: "x_user", password: OP_PASSWORD, roles: ["Wizard"] })
  );
  check("unknown role is rejected", badRole.ok === true && badRole.value.ok === false && badRole.value.reason === AuthReason.INVALID_ROLE);

  console.log("RBAC v2 custom roles + user overrides:");
  const roleCreated = await adminCall(kernel, suSession, Permission.USER_MANAGE, true, (a) =>
    kernel.roleAdmin.createRole(a, {
      name: "Report Runner",
      description: "Runs workflows and exports reports.",
      permissions: [Permission.WORKFLOW_EXECUTE, Permission.REPORT_EXPORT]
    })
  );
  const customRoleId = roleCreated.ok && roleCreated.value.ok ? roleCreated.value.value.id : "";
  check("Super User creates an admin-defined custom role", customRoleId.startsWith("custom:"));
  const duplicateRole = await adminCall(kernel, suSession, Permission.USER_MANAGE, true, (a) =>
    kernel.roleAdmin.createRole(a, { name: "report runner", permissions: [] })
  );
  check("custom-role names are unique case-insensitively", duplicateRole.ok && !duplicateRole.value.ok && duplicateRole.value.reason === AuthReason.ROLE_NAME_TAKEN);

  const customUserCreated = await adminCall(kernel, suSession, Permission.USER_MANAGE, true, (a) =>
    kernel.userAdmin.createUser(a, {
      username: "customuser",
      password: OP_PASSWORD,
      roles: [customRoleId]
    })
  );
  check("custom roles can be assigned through the existing user boundary", customUserCreated.ok && customUserCreated.value.ok);
  const customUser = kernel.store.getUserByUsernameNorm("customuser")!;
  await kernel.store.updateUser(customUser.id, { mustChangePassword: false });
  const customSession = await loginSession(kernel, "customuser", OP_PASSWORD);
  const customActor = await kernel.authz.resolveActor(customSession);
  check("custom-role permissions are enforced by AuthorizationService", customActor.permissions.has(Permission.WORKFLOW_EXECUTE));

  const overrides = await adminCall(kernel, suSession, Permission.USER_MANAGE, true, (a) =>
    kernel.userAdmin.updateUser(a, customUser.id, {
      permissionGrants: [Permission.SETTINGS_EDIT],
      permissionDenies: [Permission.WORKFLOW_EXECUTE]
    })
  );
  check("per-user grant/deny overrides are accepted", overrides.ok && overrides.value.ok);
  check("override changes revoke the target session", !(await kernel.auth.validateSession(customSession)).valid);
  const overriddenLogin = await kernel.auth.login({ providerId: "local", username: "customuser", password: OP_PASSWORD });
  check(
    "deny wins and direct grant reaches the principal snapshot",
    overriddenLogin.ok &&
      overriddenLogin.principal.permissions.includes(Permission.SETTINGS_EDIT) &&
      !overriddenLogin.principal.permissions.includes(Permission.WORKFLOW_EXECUTE)
  );
  const invalidOverride = await adminCall(kernel, suSession, Permission.USER_MANAGE, true, (a) =>
    kernel.userAdmin.updateUser(a, customUser.id, { permissionGrants: ["invented.permission"] })
  );
  check("unknown direct permissions fail closed", invalidOverride.ok && !invalidOverride.value.ok && invalidOverride.value.reason === AuthReason.INVALID_PERMISSION);

  const activeCustomRef = overriddenLogin.ok ? overriddenLogin.principal.sessionRef : "";
  const roleUpdated = await adminCall(kernel, suSession, Permission.USER_MANAGE, true, (a) =>
    kernel.roleAdmin.updateRole(a, customRoleId, {
      name: "Report Runner",
      description: "Updated role.",
      permissions: [Permission.WORKFLOW_EXECUTE, Permission.REPORT_EXPORT, Permission.WORKFLOW_STOP]
    })
  );
  check("custom-role definitions can be updated", roleUpdated.ok && roleUpdated.value.ok);
  check("role permission changes revoke every assigned user's session", !(await kernel.auth.validateSession(activeCustomRef)).valid);
  const builtInEdit = await adminCall(kernel, suSession, Permission.USER_MANAGE, true, (a) =>
    kernel.roleAdmin.updateRole(a, "Viewer", { name: "Changed", permissions: [] })
  );
  check("built-in roles remain immutable", builtInEdit.ok && !builtInEdit.value.ok && builtInEdit.value.reason === AuthReason.BUILT_IN_ROLE);
  const deletedRole = await adminCall(kernel, suSession, Permission.USER_MANAGE, true, (a) =>
    kernel.roleAdmin.deleteRole(a, customRoleId)
  );
  check("custom roles can be deleted", deletedRole.ok && deletedRole.value.ok && !kernel.store.getCustomRole(customRoleId));
  check("deleting a custom role removes stale user assignments", !kernel.store.getUserById(customUser.id)!.roles.includes(customRoleId));

  // Clear mustChangePassword so the operator can hold a session for the enforcement tests.
  await kernel.store.updateUser(opUser.id, { mustChangePassword: false });
  const opSession = await loginSession(kernel, "operator", OP_PASSWORD);

  // ── Deny-by-default: a non-SU cannot reach user management (the REAL boundary) ─
  console.log("Authorization enforcement (deny-by-default):");
  const opListDenied = await adminCall(kernel, opSession, Permission.USER_MANAGE, false, (a) => kernel.userAdmin.listUsers(a));
  check("Operator IPC call to list users is denied (NOT_AUTHORIZED)", opListDenied.ok === false && opListDenied.reason === AuthReason.NOT_AUTHORIZED);
  const opCreateDenied = await adminCall(kernel, opSession, Permission.USER_MANAGE, true, (a) =>
    kernel.userAdmin.createUser(a, { username: "sneaky", password: OP_PASSWORD, roles: ["Viewer"] })
  );
  check("Operator IPC call to create a user is denied", opCreateDenied.ok === false && opCreateDenied.reason === AuthReason.NOT_AUTHORIZED);
  // Privilege escalation: even calling the service directly with a non-SU actor is refused (defense in depth).
  let escalationBlocked = false;
  try {
    const opActor = { user: opUser, sessionRef: opSession, permissions: op };
    await kernel.userAdmin.updateUser(opActor, opUser.id, { roles: ["SuperUser"] });
  } catch (e) {
    escalationBlocked = e instanceof SecurityError && e.reason === AuthReason.NOT_AUTHORIZED;
  }
  check("direct service call by a non-SU is blocked (privilege escalation)", escalationBlocked);

  // ── Final-active-Super-User protection ───────────────────────────────────────
  console.log("Final Super User protection:");
  const disableSelf = await adminCall(kernel, suSession, Permission.USER_MANAGE, true, (a) =>
    kernel.userAdmin.setStatus(a, suUser.id, "disabled")
  );
  check("protected SU cannot be disabled", disableSelf.ok === true && disableSelf.value.ok === false && disableSelf.value.reason === AuthReason.PROTECTED_SUPER_USER);
  const archiveSelf = await adminCall(kernel, suSession, Permission.USER_MANAGE, true, (a) =>
    kernel.userAdmin.setStatus(a, suUser.id, "archived")
  );
  check("protected SU cannot be archived", archiveSelf.ok === true && archiveSelf.value.ok === false && archiveSelf.value.reason === AuthReason.PROTECTED_SUPER_USER);
  const demoteSelf = await adminCall(kernel, suSession, Permission.USER_MANAGE, true, (a) =>
    kernel.userAdmin.updateUser(a, suUser.id, { roles: ["Viewer"] })
  );
  check("protected SU cannot be demoted", demoteSelf.ok === true && demoteSelf.value.ok === false && demoteSelf.value.reason === AuthReason.PROTECTED_SUPER_USER);
  const denyProtected = await adminCall(kernel, suSession, Permission.USER_MANAGE, true, (a) =>
    kernel.userAdmin.updateUser(a, suUser.id, { permissionDenies: [Permission.USER_MANAGE] })
  );
  check("protected SU cannot receive a direct deny override", denyProtected.ok && !denyProtected.value.ok && denyProtected.value.reason === AuthReason.PROTECTED_SUPER_USER);
  // A SECOND (non-protected) Super User CAN be demoted while the protected SU remains.
  await adminCall(kernel, suSession, Permission.USER_MANAGE, true, (a) =>
    kernel.userAdmin.createUser(a, { username: "admin2", password: OP_PASSWORD, roles: ["SuperUser"] })
  );
  const admin2 = kernel.store.getUserByUsernameNorm("admin2")!;
  check("active Super User count reflects two SUs", kernel.store.activeSuperUserCount() === 2);
  const demote2 = await adminCall(kernel, suSession, Permission.USER_MANAGE, true, (a) =>
    kernel.userAdmin.updateUser(a, admin2.id, { roles: ["Operator"] })
  );
  check("a secondary SU can be demoted (protected SU remains)", demote2.ok === true && demote2.value.ok === true);
  check("active Super User count back to one", kernel.store.activeSuperUserCount() === 1);

  // ── Disable → session invalidation + login refusal ───────────────────────────
  console.log("Disable + session revocation:");
  const disableOp = await adminCall(kernel, suSession, Permission.USER_MANAGE, true, (a) =>
    kernel.userAdmin.setStatus(a, opUser.id, "disabled")
  );
  check("SU disables the Operator", disableOp.ok === true && disableOp.value.ok === true);
  const opValidation = await kernel.auth.validateSession(opSession);
  check("disabled user's live session is invalidated", opValidation.valid === false);
  const disabledLogin = await kernel.auth.login({ providerId: "local", username: "operator", password: OP_PASSWORD });
  check("disabled user cannot log in (uniform INVALID_CREDENTIALS)", disabledLogin.ok === false && disabledLogin.reason === AuthReason.INVALID_CREDENTIALS);
  await adminCall(kernel, suSession, Permission.USER_MANAGE, true, (a) => kernel.userAdmin.setStatus(a, opUser.id, "active"));
  const reLogin = await kernel.auth.login({ providerId: "local", username: "operator", password: OP_PASSWORD });
  check("re-enabled user can log in again", reLogin.ok === true);

  // ── Role change revokes sessions; password reset revokes + rotates ───────────
  console.log("Session invalidation on security change:");
  const opSession2 = reLogin.ok ? reLogin.principal.sessionRef : "";
  await adminCall(kernel, suSession, Permission.USER_MANAGE, true, (a) => kernel.userAdmin.updateUser(a, opUser.id, { roles: ["Viewer"] }));
  const afterRoleChange = await kernel.auth.validateSession(opSession2);
  check("changing a user's roles revokes their sessions", afterRoleChange.valid === false);
  const opSession3 = (await kernel.auth.login({ providerId: "local", username: "operator", password: OP_PASSWORD }) as { ok: true; principal: { sessionRef: string } }).principal.sessionRef;
  const reset = await adminCall(kernel, suSession, Permission.USER_MANAGE, true, (a) => kernel.userAdmin.resetPassword(a, opUser.id, NEW_PASSWORD));
  check("SU resets the user's password", reset.ok === true && reset.value.ok === true);
  const afterReset = await kernel.auth.validateSession(opSession3);
  check("password reset revokes the user's sessions", afterReset.valid === false);
  const oldPw = await kernel.auth.login({ providerId: "local", username: "operator", password: OP_PASSWORD });
  check("old password no longer works after reset", oldPw.ok === false);
  const newPw = await kernel.auth.login({ providerId: "local", username: "operator", password: NEW_PASSWORD });
  check("new password works after reset (must change)", newPw.ok === true && newPw.ok && newPw.principal.mustChangePassword === true);

  // ── Reauth gating for sensitive operations (5-minute window) ─────────────────
  console.log("Reauth gating:");
  clock.advance(6 * 60 * 1000); // age the SU session past the 5-min reauth window
  const staleSensitive = await adminCall(kernel, suSession, Permission.USER_MANAGE, true, (a) =>
    kernel.userAdmin.createUser(a, { username: "afterstale", password: OP_PASSWORD, roles: ["Viewer"] })
  );
  check("sensitive op requires fresh reauth after 5 min", staleSensitive.ok === false && staleSensitive.reason === AuthReason.REAUTH_REQUIRED);
  const nonSensitiveOk = await adminCall(kernel, suSession, Permission.USER_MANAGE, false, (a) => kernel.userAdmin.listUsers(a));
  check("non-sensitive op still allowed (permission only)", nonSensitiveOk.ok === true);
  const wrongReauth = await kernel.auth.reauthenticate(suSession, "not-my-password");
  check("reauth with a wrong password fails", wrongReauth.ok === false);
  const goodReauth = await kernel.auth.reauthenticate(suSession, SU_PASSWORD);
  check("reauth with the correct password succeeds", goodReauth.ok === true);
  const afterReauth = await adminCall(kernel, suSession, Permission.USER_MANAGE, true, (a) =>
    kernel.userAdmin.createUser(a, { username: "afterreauth", password: OP_PASSWORD, roles: ["Viewer"] })
  );
  check("sensitive op allowed again after fresh reauth", afterReauth.ok === true && afterReauth.value.ok === true);

  // ── Audit trail records privileged actions ───────────────────────────────────
  console.log("Audit:");
  const auditView = await adminCall(kernel, suSession, Permission.AUDIT_VIEW, false, () => kernel.store.listAudit(500, 0));
  check("privileged actions are audited (USER_CREATE present)", auditView.ok === true && auditView.value.some((r) => r.eventType === "USER_CREATE"));
  check("audit view carries no secret fields", auditView.ok === true && JSON.stringify(auditView.value).match(/passwordSecret|IDENTIFIED BY/i) === null);

  // ── Semantic index permissions (Zvec plan §10) ───────────────────────────────
  //
  // Asserted per ROLE rather than "the permission exists", because the defect that matters is a role
  // silently gaining or losing access. `ADMINISTRATOR_PERMISSIONS` is a denylist over
  // `ALL_PERMISSIONS`, so an omission there grants privilege rather than withholding it.
  console.log("Semantic permissions:");
  const permsOf = (role: "SuperUser" | "Administrator" | "Operator" | "Viewer") =>
    new Set<Perm>(BUILTIN_ROLES[role].permissions);
  const viewerPerms = permsOf("Viewer");
  const operatorPerms = permsOf("Operator");
  const adminPerms = permsOf("Administrator");
  const superUserPerms = permsOf("SuperUser");

  check("Viewer cannot search (owner decision: deny by default)", !viewerPerms.has(Permission.SEMANTIC_SEARCH));
  check("Viewer cannot manage the index", !viewerPerms.has(Permission.SEMANTIC_MANAGE_INDEX));
  check("Operator can search", operatorPerms.has(Permission.SEMANTIC_SEARCH));
  check("Operator can view failure similarity", operatorPerms.has(Permission.SEMANTIC_VIEW_FAILURE_SIMILARITY));
  check("Operator canNOT manage the index", !operatorPerms.has(Permission.SEMANTIC_MANAGE_INDEX));
  check("Operator canNOT manage embeddings", !operatorPerms.has(Permission.SEMANTIC_MANAGE_EMBEDDINGS));
  check("Administrator can manage the index", adminPerms.has(Permission.SEMANTIC_MANAGE_INDEX));
  check("Administrator can manage embeddings", adminPerms.has(Permission.SEMANTIC_MANAGE_EMBEDDINGS));
  check("Administrator can search", adminPerms.has(Permission.SEMANTIC_SEARCH));
  check("SuperUser holds every semantic permission", [
    Permission.SEMANTIC_SEARCH,
    Permission.SEMANTIC_VIEW_FAILURE_SIMILARITY,
    Permission.SEMANTIC_MANAGE_INDEX,
    Permission.SEMANTIC_MANAGE_EMBEDDINGS,
    Permission.SEMANTIC_EXPORT_DIAGNOSTICS
  ].every((p) => superUserPerms.has(p)));

  // The owner decision that plan §10 required to be explicit rather than silent.
  check("index management requires fresh re-auth", SENSITIVE_PERMISSIONS.has(Permission.SEMANTIC_MANAGE_INDEX));
  check("embedding management requires fresh re-auth", SENSITIVE_PERMISSIONS.has(Permission.SEMANTIC_MANAGE_EMBEDDINGS));
  check("search does NOT require re-auth (it would prompt on every query)", !SENSITIVE_PERMISSIONS.has(Permission.SEMANTIC_SEARCH));

  // The Semantic Search route (awkit-0jp). `RoutePermissions` treats an ABSENT route as visible to
  // every signed-in user, so an unregistered route is not a locked door — it is an open one. That is
  // why the first check asserts presence before the second asserts which permission it names.
  console.log("\nSemantic Search route gating:");
  const routePermission = RoutePermissions.semanticSearch;
  check("the semanticSearch route is registered as gated at all (absent = visible to everyone)", routePermission !== undefined);
  check("it is gated on SEMANTIC_SEARCH", routePermission === Permission.SEMANTIC_SEARCH);

  // Both directions. A one-sided assertion passes while the grant is wrong.
  const routeVisibleTo = (perms: Set<Perm>) => routePermission === undefined || perms.has(routePermission);
  check("Viewer cannot reach Semantic Search", !routeVisibleTo(viewerPerms));
  check("Operator can reach Semantic Search", routeVisibleTo(operatorPerms));
  check("Administrator can reach Semantic Search", routeVisibleTo(adminPerms));
  check("SuperUser can reach Semantic Search", routeVisibleTo(superUserPerms));

  console.log("\nRBAC v2 persistence:");
  const persistedRole = await adminCall(kernel, suSession, Permission.USER_MANAGE, true, (a) =>
    kernel.roleAdmin.createRole(a, {
      name: "Persistent Runner",
      permissions: [Permission.WORKFLOW_EXECUTE]
    })
  );
  const persistedRoleId = persistedRole.ok && persistedRole.value.ok ? persistedRole.value.value.id : "";
  await adminCall(kernel, suSession, Permission.USER_MANAGE, true, (a) =>
    kernel.userAdmin.updateUser(a, opUser.id, {
      roles: [persistedRoleId],
      permissionGrants: [Permission.REPORT_EXPORT],
      permissionDenies: [Permission.WORKFLOW_EXECUTE]
    })
  );
  await kernel.close();

  const reopened = await SecurityKernel.open(dbPath, new PassthroughColumnCrypto(), { now: clock.now });
  const reopenedUser = reopened.store.getUserById(opUser.id)!;
  const reopenedPermissions = reopened.authz.permissionsFor(reopenedUser);
  check("custom roles persist across security-store reopen", reopened.store.getCustomRole(persistedRoleId)?.name === "Persistent Runner");
  check(
    "user grant/deny overrides persist and remain authoritative after reopen",
    reopenedPermissions.has(Permission.REPORT_EXPORT) && !reopenedPermissions.has(Permission.WORKFLOW_EXECUTE)
  );
  await reopened.close();

  console.log(`\nverify:authz — ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
