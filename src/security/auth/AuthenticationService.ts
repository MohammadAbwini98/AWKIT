/**
 * AuthenticationService — the trusted orchestrator for local virtual-user login. Owns account-state
 * policy (lockout, failed-login counting), session creation, forced-password-change, and audit. All
 * privileged decisions happen here in the main process; the renderer only ever receives a
 * PrincipalSnapshot (UI hint) or a safe reason code.
 *
 * See docs/plans/SECURE_LOGIN_AUTHORIZATION_LICENSING_IMPLEMENTATION_PLAN.md §10–§13.
 */
import { randomUUID } from "node:crypto";
import { AuthReason, type AuthReasonCode } from "@src/security/errors/ReasonCodes";
import { hashPassword, needsRehash, verifyPassword } from "@src/security/crypto/PasswordHasher";
import { validatePassword } from "./PasswordPolicy";
import { normalizeUsername, validateUsername } from "./UsernameRules";
import type { SecurityStore } from "@src/security/store/SecurityStore";
import type { UserRecord } from "@src/security/store/SecurityStoreSchema";
import type { SessionManager } from "@src/security/session/SessionManager";
import type { AuthenticationProvider } from "./AuthenticationProvider";
import type {
  LoginOption,
  LoginRequest,
  LoginResult,
  PrincipalSnapshot,
  ProviderId,
  SessionValidationResult
} from "./AuthTypes";

export interface LockoutPolicy {
  /** Consecutive failures before a temporary lock. */
  maxFailedAttempts: number;
  /** Lock duration once the threshold is reached. */
  lockMs: number;
}

export const DEFAULT_LOCKOUT_POLICY: LockoutPolicy = {
  maxFailedAttempts: 5,
  lockMs: 15 * 60 * 1000 // 15 minutes
};

export interface BootstrapInput {
  username: string;
  password: string;
  displayName?: string;
}

export interface AuthServiceDeps {
  store: SecurityStore;
  providers: Map<ProviderId, AuthenticationProvider>;
  sessions: SessionManager;
  lockout?: LockoutPolicy;
  now?: () => number;
}

export class AuthenticationService {
  private readonly store: SecurityStore;
  private readonly providers: Map<ProviderId, AuthenticationProvider>;
  private readonly sessions: SessionManager;
  private readonly lockout: LockoutPolicy;
  private readonly now: () => number;

  constructor(deps: AuthServiceDeps) {
    this.store = deps.store;
    this.providers = deps.providers;
    this.sessions = deps.sessions;
    this.lockout = deps.lockout ?? DEFAULT_LOCKOUT_POLICY;
    this.now = deps.now ?? (() => Date.now());
  }

  getLoginOptions(): LoginOption[] {
    return [...this.providers.values()].map((provider) => ({
      id: provider.id,
      displayName: provider.displayName,
      enabled: provider.isEnabled()
    }));
  }

  isProvisioned(): boolean {
    return this.store.isProvisioned();
  }

  // ── First-run bootstrap (one-time, irreversible) ─────────────────────────────

  async bootstrapSuperUser(input: BootstrapInput): Promise<{ ok: true; userId: string } | { ok: false; reason: AuthReasonCode; errors?: string[] }> {
    // One-time invariant: refuse once provisioned OR any user exists (defense in depth).
    if (this.store.isProvisioned() || this.store.userCount() > 0) {
      await this.audit({ eventType: "PROVISIONING", result: "failure", reasonCode: AuthReason.ALREADY_PROVISIONED });
      return { ok: false, reason: AuthReason.ALREADY_PROVISIONED };
    }
    const usernameCheck = validateUsername(input.username);
    if (!usernameCheck.ok) return { ok: false, reason: AuthReason.USERNAME_INVALID, errors: usernameCheck.errors };
    const passwordCheck = validatePassword(input.password, { username: input.username });
    if (!passwordCheck.ok) return { ok: false, reason: AuthReason.PASSWORD_POLICY, errors: passwordCheck.errors };

    const nowIso = new Date(this.now()).toISOString();
    const norm = normalizeUsername(input.username);
    const record: UserRecord = {
      id: randomUUID(),
      username: input.username.trim(),
      usernameNorm: norm,
      displayName: (input.displayName ?? input.username).trim(),
      status: "active",
      passwordSecret: hashPassword(input.password),
      passwordAlgo: "scrypt",
      mustChangePassword: false,
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: null,
      passwordChangedAt: nowIso,
      isProtectedSuperUser: true,
      createdAt: nowIso,
      createdBy: "bootstrap",
      updatedAt: nowIso,
      updatedBy: "bootstrap"
    };
    await this.store.createUser(record);
    await this.store.setProvisioned(nowIso);
    await this.audit({ eventType: "PROVISIONING", result: "success", actorUserId: record.id, actorName: record.username, targetType: "user", targetId: record.id });
    return { ok: true, userId: record.id };
  }

  // ── Login ────────────────────────────────────────────────────────────────────

  async login(request: LoginRequest): Promise<LoginResult> {
    const provider = this.providers.get(request.providerId);
    if (!provider || !provider.isEnabled()) {
      await this.audit({ eventType: "LOGIN_FAILURE", result: "failure", reasonCode: AuthReason.PROVIDER_DISABLED, detail: { providerId: request.providerId } });
      return { ok: false, reason: AuthReason.PROVIDER_DISABLED };
    }

    // Service-level lockout pre-check (local accounts). Fails fast without verifying the password.
    const preUser = this.store.getUserByUsernameNorm(normalizeUsername(request.username));
    if (preUser && this.isLocked(preUser)) {
      await this.audit({ eventType: "LOGIN_FAILURE", result: "failure", reasonCode: AuthReason.ACCOUNT_LOCKED, targetType: "user", targetId: preUser.id });
      return { ok: false, reason: AuthReason.ACCOUNT_LOCKED };
    }

    const result = await provider.authenticate({ username: request.username, password: request.password });

    if (!result.ok) {
      // Disabled account: audit precisely, do NOT count as a failed attempt; external = INVALID.
      if (result.reason === AuthReason.ACCOUNT_DISABLED) {
        await this.audit({ eventType: "LOGIN_FAILURE", result: "failure", reasonCode: AuthReason.ACCOUNT_DISABLED, targetType: "user", targetId: result.subjectId });
        return { ok: false, reason: AuthReason.INVALID_CREDENTIALS };
      }
      // Wrong password on a known account → count the failure, maybe lock.
      if (result.subjectId) {
        const locked = await this.registerFailedAttempt(result.subjectId);
        return { ok: false, reason: locked ? AuthReason.ACCOUNT_LOCKED : AuthReason.INVALID_CREDENTIALS };
      }
      // Unknown user → uniform failure, nothing to increment.
      await this.audit({ eventType: "LOGIN_FAILURE", result: "failure", reasonCode: AuthReason.INVALID_CREDENTIALS });
      return { ok: false, reason: AuthReason.INVALID_CREDENTIALS };
    }

    const user = this.store.getUserById(result.subjectId);
    if (!user) {
      await this.audit({ eventType: "LOGIN_FAILURE", result: "failure", reasonCode: AuthReason.UNKNOWN });
      return { ok: false, reason: AuthReason.INVALID_CREDENTIALS };
    }

    const nowIso = new Date(this.now()).toISOString();
    const patch: Partial<UserRecord> = {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: nowIso,
      updatedAt: nowIso,
      updatedBy: user.id
    };
    // Opportunistic rehash if the stored cost is below the current target (we have the plaintext here).
    if (needsRehash(user.passwordSecret)) {
      patch.passwordSecret = hashPassword(request.password);
      patch.passwordAlgo = "scrypt";
      patch.passwordChangedAt = user.passwordChangedAt; // credential unchanged; only cost upgraded
    }
    await this.store.updateUser(user.id, patch);

    const sessionRef = await this.sessions.create(user.id);
    await this.audit({ eventType: "LOGIN_SUCCESS", result: "success", actorUserId: user.id, actorName: user.username, sessionId: sessionRef });
    return { ok: true, principal: this.snapshot(user, sessionRef) };
  }

  // ── Session validation / logout ──────────────────────────────────────────────

  async validateSession(sessionRef: string): Promise<SessionValidationResult> {
    const resolution = await this.sessions.validate(sessionRef);
    if (!resolution.valid) return { valid: false, reason: AuthReason.SESSION_EXPIRED };
    const user = this.store.getUserById(resolution.userId);
    // Deactivation (or deletion) mid-session fails closed: revoke and bounce to login.
    if (!user || user.status !== "active") {
      await this.sessions.revoke(sessionRef);
      return { valid: false, reason: AuthReason.SESSION_EXPIRED };
    }
    return { valid: true, principal: this.snapshot(user, sessionRef) };
  }

  async logout(sessionRef: string): Promise<void> {
    const resolution = await this.sessions.validate(sessionRef).catch(() => ({ valid: false as const }));
    await this.sessions.revoke(sessionRef);
    await this.audit({
      eventType: "LOGOUT",
      result: "success",
      sessionId: sessionRef,
      actorUserId: resolution.valid ? resolution.userId : undefined
    });
  }

  // ── Password change (self-service / forced) ──────────────────────────────────

  async changePassword(sessionRef: string, currentPassword: string, newPassword: string): Promise<{ ok: true } | { ok: false; reason: AuthReasonCode; errors?: string[] }> {
    const resolution = await this.sessions.validate(sessionRef);
    if (!resolution.valid) return { ok: false, reason: AuthReason.SESSION_EXPIRED };
    const user = this.store.getUserById(resolution.userId);
    if (!user || user.status !== "active") return { ok: false, reason: AuthReason.SESSION_EXPIRED };

    if (!verifyPassword(currentPassword, user.passwordSecret)) {
      await this.audit({ eventType: "PASSWORD_CHANGE", result: "failure", reasonCode: AuthReason.INVALID_CREDENTIALS, actorUserId: user.id, sessionId: sessionRef });
      return { ok: false, reason: AuthReason.INVALID_CREDENTIALS };
    }
    const policy = validatePassword(newPassword, { username: user.username });
    if (!policy.ok) return { ok: false, reason: AuthReason.PASSWORD_POLICY, errors: policy.errors };

    const nowIso = new Date(this.now()).toISOString();
    await this.store.updateUser(user.id, {
      passwordSecret: hashPassword(newPassword),
      passwordAlgo: "scrypt",
      passwordChangedAt: nowIso,
      mustChangePassword: false,
      updatedAt: nowIso,
      updatedBy: user.id
    });
    await this.audit({ eventType: "PASSWORD_CHANGE", result: "success", actorUserId: user.id, sessionId: sessionRef });
    return { ok: true };
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private isLocked(user: UserRecord): boolean {
    return user.lockedUntil != null && Date.parse(user.lockedUntil) > this.now();
  }

  /** Increment failed-attempt count; lock when the threshold is reached. Returns true if now locked. */
  private async registerFailedAttempt(userId: string): Promise<boolean> {
    const user = this.store.getUserById(userId);
    if (!user) return false;
    const nowIso = new Date(this.now()).toISOString();
    const nextCount = user.failedLoginCount + 1;
    if (nextCount >= this.lockout.maxFailedAttempts) {
      const lockedUntil = new Date(this.now() + this.lockout.lockMs).toISOString();
      await this.store.updateUser(userId, { failedLoginCount: 0, lockedUntil, updatedAt: nowIso, updatedBy: userId });
      await this.audit({ eventType: "ACCOUNT_LOCKOUT", result: "failure", reasonCode: AuthReason.ACCOUNT_LOCKED, targetType: "user", targetId: userId });
      return true;
    }
    await this.store.updateUser(userId, { failedLoginCount: nextCount, updatedAt: nowIso, updatedBy: userId });
    await this.audit({ eventType: "LOGIN_FAILURE", result: "failure", reasonCode: AuthReason.INVALID_CREDENTIALS, targetType: "user", targetId: userId });
    return false;
  }

  private snapshot(user: UserRecord, sessionRef: string): PrincipalSnapshot {
    return {
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      isProtectedSuperUser: user.isProtectedSuperUser,
      mustChangePassword: user.mustChangePassword,
      sessionRef
    };
  }

  private async audit(event: {
    eventType: string;
    result: "success" | "failure";
    reasonCode?: AuthReasonCode;
    actorUserId?: string;
    actorName?: string;
    targetType?: string;
    targetId?: string;
    sessionId?: string;
    detail?: Record<string, unknown>;
  }): Promise<void> {
    await this.store
      .appendAudit({
        at: new Date(this.now()).toISOString(),
        eventType: event.eventType,
        result: event.result,
        reasonCode: event.reasonCode ?? null,
        actorUserId: event.actorUserId ?? null,
        actorName: event.actorName ?? null,
        targetType: event.targetType ?? null,
        targetId: event.targetId ?? null,
        sessionId: event.sessionId ?? null,
        detail: event.detail ?? null
      })
      .catch(() => undefined);
  }
}
