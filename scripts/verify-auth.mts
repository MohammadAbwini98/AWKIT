/**
 * Local virtual-user authentication checks — trusted core, headless (no Electron/Chromium).
 * Run: `npm run verify:auth`.
 *
 * Uses a temp DB + a reversible passthrough ColumnCrypto (no OS keystore) and an injectable clock so
 * lockout / idle / absolute timeouts are deterministic. Covers first-run bootstrap (one-time), login
 * success/failure, uniform errors, lockout, disabled accounts, sessions + logout invalidation, idle +
 * absolute expiry, password policy/username rules, self-service + forced password change, migrations,
 * persistence, and the no-plaintext-password-on-disk invariant.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { SecurityKernel } from "../src/security/SecurityKernel";
import { SecurityStore } from "../src/security/store/SecurityStore";
import { PassthroughColumnCrypto } from "../src/security/crypto/ColumnCrypto";
import { hashPassword, verifyPassword, needsRehash, DEFAULT_SCRYPT } from "../src/security/crypto/PasswordHasher";
import { AuthReason } from "../src/security/errors/ReasonCodes";
import { SECURITY_DB_FILENAME } from "../src/security/store/SecurityStoreSchema";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}`);
  }
}

/** Controllable clock so timeouts are deterministic. */
function makeClock(start: number) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms), set: (ms: number) => (t = ms) };
}

const SU_PASSWORD = "Sup3rSecret!42";
const OP_PASSWORD = "Oper8tor!Pass9";

async function freshKernel(clockStart = Date.parse("2026-07-18T00:00:00.000Z")) {
  const dir = mkdtempSync(join(tmpdir(), "awkit-auth-"));
  const dbPath = join(dir, SECURITY_DB_FILENAME);
  const clock = makeClock(clockStart);
  const kernel = await SecurityKernel.open(dbPath, new PassthroughColumnCrypto(), { now: clock.now });
  return { kernel, dbPath, dir, clock };
}

async function addUser(
  store: SecurityStore,
  clockNow: () => number,
  opts: { username: string; password: string; status?: "active" | "disabled"; mustChange?: boolean }
): Promise<string> {
  const id = randomUUID();
  const nowIso = new Date(clockNow()).toISOString();
  await store.createUser({
    id,
    username: opts.username,
    usernameNorm: opts.username.toLowerCase(),
    displayName: opts.username,
    status: opts.status ?? "active",
    passwordSecret: hashPassword(opts.password),
    passwordAlgo: "scrypt",
    mustChangePassword: opts.mustChange ?? false,
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null,
    passwordChangedAt: nowIso,
    isProtectedSuperUser: false,
    createdAt: nowIso,
    createdBy: "test",
    updatedAt: nowIso,
    updatedBy: "test"
  });
  return id;
}

async function main(): Promise<void> {
  // ── scrypt hashing unit ──────────────────────────────────────────────────
  console.log("Password hashing (scrypt):");
  const rec = hashPassword("Correct!Horse12");
  check("verify accepts correct password", verifyPassword("Correct!Horse12", rec));
  check("verify rejects wrong password", !verifyPassword("wrong", rec));
  check("record is self-describing (scrypt$...)", rec.startsWith("scrypt$"));
  check("record does not contain the plaintext", !rec.includes("Correct!Horse12"));
  check("needsRehash true for weaker params", needsRehash("scrypt$1024$8$1$64$AAAA$BBBB", DEFAULT_SCRYPT));
  check("needsRehash false for current params", !needsRehash(rec, DEFAULT_SCRYPT));

  // ── Bootstrap (one-time) ───────────────────────────────────────────────────
  console.log("First-run bootstrap:");
  {
    const { kernel, dbPath } = await freshKernel();
    check("migrations applied (v1)", kernel.store.appliedMigrations().some((m) => m.version === 1));
    check("boot state: not provisioned", kernel.getBootState().provisioned === false);

    const weak = await kernel.auth.bootstrapSuperUser({ username: "superuser", password: "weak" });
    check("weak password rejected (PASSWORD_POLICY)", !weak.ok && weak.reason === AuthReason.PASSWORD_POLICY);

    const badName = await kernel.auth.bootstrapSuperUser({ username: "a", password: SU_PASSWORD });
    check("invalid username rejected (USERNAME_INVALID)", !badName.ok && badName.reason === AuthReason.USERNAME_INVALID);

    const ok = await kernel.auth.bootstrapSuperUser({ username: "superuser", password: SU_PASSWORD, displayName: "Super User" });
    check("bootstrap succeeds", ok.ok === true);
    check("boot state: provisioned after bootstrap", kernel.getBootState().provisioned === true);

    const again = await kernel.auth.bootstrapSuperUser({ username: "intruder", password: SU_PASSWORD });
    check("second bootstrap refused (ALREADY_PROVISIONED)", !again.ok && again.reason === AuthReason.ALREADY_PROVISIONED);

    // No-plaintext-on-disk invariant.
    const bytes = readFileSync(dbPath);
    check("password plaintext absent from DB file", bytes.indexOf(Buffer.from(SU_PASSWORD)) === -1);

    await kernel.close();
  }

  // ── Login success / uniform failure ────────────────────────────────────────
  console.log("Login:");
  {
    const { kernel } = await freshKernel();
    await kernel.auth.bootstrapSuperUser({ username: "superuser", password: SU_PASSWORD });

    const good = await kernel.auth.login({ providerId: "local", username: "SuperUser", password: SU_PASSWORD });
    check("valid login succeeds (case-insensitive username)", good.ok === true);
    check("principal carries username + sessionRef", good.ok === true && good.principal.username === "superuser" && !!good.principal.sessionRef);

    const badUser = await kernel.auth.login({ providerId: "local", username: "nobody", password: SU_PASSWORD });
    check("unknown user → INVALID_CREDENTIALS", !badUser.ok && badUser.reason === AuthReason.INVALID_CREDENTIALS);

    const badPass = await kernel.auth.login({ providerId: "local", username: "superuser", password: "Wrong!Password9" });
    check("wrong password → INVALID_CREDENTIALS (uniform)", !badPass.ok && badPass.reason === AuthReason.INVALID_CREDENTIALS);

    const ad = await kernel.auth.login({ providerId: "activeDirectory", username: "superuser", password: SU_PASSWORD });
    check("disabled AD provider → PROVIDER_DISABLED", !ad.ok && ad.reason === AuthReason.PROVIDER_DISABLED);

    const options = kernel.auth.getLoginOptions();
    check("login options expose AD as disabled", options.some((o) => o.id === "activeDirectory" && o.enabled === false));
    check("login options expose Local as enabled", options.some((o) => o.id === "local" && o.enabled === true));

    await kernel.close();
  }

  // ── Lockout ────────────────────────────────────────────────────────────────
  console.log("Lockout:");
  {
    const { kernel, clock } = await freshKernel();
    await kernel.auth.bootstrapSuperUser({ username: "superuser", password: SU_PASSWORD });
    const opId = await addUser(kernel.store, clock.now, { username: "operator", password: OP_PASSWORD });

    let lastReason = "";
    for (let i = 0; i < 5; i++) {
      const r = await kernel.auth.login({ providerId: "local", username: "operator", password: "Nope!Nope!99" });
      lastReason = r.ok ? "ok" : r.reason;
    }
    check("5th failed attempt → ACCOUNT_LOCKED", lastReason === AuthReason.ACCOUNT_LOCKED);

    const whileLocked = await kernel.auth.login({ providerId: "local", username: "operator", password: OP_PASSWORD });
    check("correct password while locked still → ACCOUNT_LOCKED", !whileLocked.ok && whileLocked.reason === AuthReason.ACCOUNT_LOCKED);

    clock.advance(15 * 60 * 1000 + 1000); // lock window elapses
    const afterUnlock = await kernel.auth.login({ providerId: "local", username: "operator", password: OP_PASSWORD });
    check("login succeeds after lock expires", afterUnlock.ok === true);

    check("operator user id was created", typeof opId === "string");
    await kernel.close();
  }

  // ── Disabled account ────────────────────────────────────────────────────────
  console.log("Disabled account:");
  {
    const { kernel, clock } = await freshKernel();
    await kernel.auth.bootstrapSuperUser({ username: "superuser", password: SU_PASSWORD });
    const id = await addUser(kernel.store, clock.now, { username: "ghost", password: OP_PASSWORD, status: "disabled" });

    const r = await kernel.auth.login({ providerId: "local", username: "ghost", password: OP_PASSWORD });
    check("disabled account → INVALID_CREDENTIALS (uniform, no disclosure)", !r.ok && r.reason === AuthReason.INVALID_CREDENTIALS);
    const after = kernel.store.getUserById(id);
    check("disabled login does NOT increment failed count", after?.failedLoginCount === 0);
    await kernel.close();
  }

  // ── Sessions: validate, logout, idle, absolute ──────────────────────────────
  console.log("Sessions:");
  {
    const { kernel, clock } = await freshKernel();
    await kernel.auth.bootstrapSuperUser({ username: "superuser", password: SU_PASSWORD });
    const login = await kernel.auth.login({ providerId: "local", username: "superuser", password: SU_PASSWORD });
    const ref = login.ok ? login.principal.sessionRef : "";

    const v1 = await kernel.auth.validateSession(ref);
    check("fresh session validates", v1.valid === true);

    await kernel.auth.logout(ref);
    const afterLogout = await kernel.auth.validateSession(ref);
    check("session invalid after logout (no reuse)", afterLogout.valid === false && afterLogout.reason === AuthReason.SESSION_EXPIRED);

    // Idle timeout.
    const l2 = await kernel.auth.login({ providerId: "local", username: "superuser", password: SU_PASSWORD });
    const ref2 = l2.ok ? l2.principal.sessionRef : "";
    clock.advance(31 * 60 * 1000); // > 30 min idle
    const idle = await kernel.auth.validateSession(ref2);
    check("session invalid after idle timeout", idle.valid === false);

    // Absolute timeout (active but too old).
    const l3 = await kernel.auth.login({ providerId: "local", username: "superuser", password: SU_PASSWORD });
    const ref3 = l3.ok ? l3.principal.sessionRef : "";
    // keep it "active" by validating every 20 min, but push past the 12h absolute cap
    for (let i = 0; i < 40; i++) {
      clock.advance(20 * 60 * 1000);
      await kernel.auth.validateSession(ref3);
    }
    const absolute = await kernel.auth.validateSession(ref3);
    check("session invalid after absolute timeout", absolute.valid === false);

    await kernel.close();
  }

  // ── Password change (self-service + forced) ─────────────────────────────────
  console.log("Password change:");
  {
    const { kernel, clock } = await freshKernel();
    await kernel.auth.bootstrapSuperUser({ username: "superuser", password: SU_PASSWORD });
    await addUser(kernel.store, clock.now, { username: "changer", password: OP_PASSWORD, mustChange: true });

    const login = await kernel.auth.login({ providerId: "local", username: "changer", password: OP_PASSWORD });
    check("forced-change user logs in with mustChangePassword flag", login.ok === true && login.principal.mustChangePassword === true);
    const ref = login.ok ? login.principal.sessionRef : "";

    const wrongCurrent = await kernel.auth.changePassword(ref, "not-the-current", "Brand!NewPass22");
    check("change rejects wrong current password", !wrongCurrent.ok && wrongCurrent.reason === AuthReason.INVALID_CREDENTIALS);

    const weakNew = await kernel.auth.changePassword(ref, OP_PASSWORD, "weak");
    check("change rejects weak new password (PASSWORD_POLICY)", !weakNew.ok && weakNew.reason === AuthReason.PASSWORD_POLICY);

    const ok = await kernel.auth.changePassword(ref, OP_PASSWORD, "Brand!NewPass22");
    check("password change succeeds", ok.ok === true);

    const oldFails = await kernel.auth.login({ providerId: "local", username: "changer", password: OP_PASSWORD });
    check("old password no longer works", !oldFails.ok);
    const newLogin = await kernel.auth.login({ providerId: "local", username: "changer", password: "Brand!NewPass22" });
    check("new password works and clears mustChangePassword", newLogin.ok === true && newLogin.principal.mustChangePassword === false);

    await kernel.close();
  }

  // ── Session rotation on password change (awkit-ekd.7) ────────────────────────
  console.log("Session rotation:");
  {
    const { kernel, clock } = await freshKernel();
    await kernel.auth.bootstrapSuperUser({ username: "superuser", password: SU_PASSWORD });
    await addUser(kernel.store, clock.now, { username: "rotator", password: OP_PASSWORD });

    const a = await kernel.auth.login({ providerId: "local", username: "rotator", password: OP_PASSWORD });
    const b = await kernel.auth.login({ providerId: "local", username: "rotator", password: OP_PASSWORD });
    const refA = a.ok ? a.principal.sessionRef : "";
    const refB = b.ok ? b.principal.sessionRef : "";
    const bothValid = (await kernel.auth.validateSession(refA)).valid === true && (await kernel.auth.validateSession(refB)).valid === true;
    check("two concurrent sessions both validate before change", bothValid);

    const changed = await kernel.auth.changePassword(refA, OP_PASSWORD, "Zephyr!Vault42");
    check("password change (from session A) succeeds", changed.ok === true);

    const stillA = await kernel.auth.validateSession(refA);
    check("current session stays valid after its own password change", stillA.valid === true);
    const revokedB = await kernel.auth.validateSession(refB);
    check("other sessions are revoked on password change", revokedB.valid === false && revokedB.reason === AuthReason.SESSION_EXPIRED);

    await kernel.close();
  }

  // ── Persistence across reopen ────────────────────────────────────────────────
  console.log("Persistence:");
  {
    const { kernel, dbPath } = await freshKernel();
    await kernel.auth.bootstrapSuperUser({ username: "superuser", password: SU_PASSWORD });
    await kernel.close();

    const reopened = await SecurityStore.open(dbPath, new PassthroughColumnCrypto());
    check("provisioning persists across reopen", reopened.isProvisioned() === true);
    const user = reopened.getUserByUsernameNorm("superuser");
    check("user persists across reopen", !!user && user.username === "superuser");
    check("stored password verifies after reopen", !!user && verifyPassword(SU_PASSWORD, user.passwordSecret));
    check("audit rows were written", reopened.auditCount() > 0);
    await reopened.close();
  }

  console.log(`\nverify:auth — ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
