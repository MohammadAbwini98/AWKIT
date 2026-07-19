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
import { BUILTIN_ROLES, Permission, effectivePermissions } from "../src/security/authz/Permissions";
import type { Permission as Perm } from "../src/security/authz/Permissions";

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
  return kernel;
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

  const clock = makeClock(Date.parse("2026-07-19T00:00:00.000Z"));
  const kernel = await freshKernel(clock);
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

  await kernel.close();

  console.log(`\nverify:authz — ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
