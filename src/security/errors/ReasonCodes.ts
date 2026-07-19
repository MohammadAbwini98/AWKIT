/**
 * Safe, non-revealing reason codes for the security subsystem (authentication / provisioning /
 * sessions). These are the ONLY failure information allowed to cross the IPC bridge to the untrusted
 * renderer — detailed context (which check failed, which account, timings) is written to the audit log
 * instead (see AuthenticationService). Never add a code that discloses whether a username exists,
 * password-hash material, or internal validation logic.
 *
 * See docs/plans/SECURE_LOGIN_AUTHORIZATION_LICENSING_IMPLEMENTATION_PLAN.md §22.
 */
export const AuthReason = {
  /** Uniform credential failure — unknown user OR wrong password OR disabled account all map here. */
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  /**
   * INTERNAL ONLY — the account exists but is deactivated. Used so the service can audit precisely and
   * skip failed-attempt counting; it is ALWAYS mapped to INVALID_CREDENTIALS before crossing the bridge
   * so account existence is never disclosed to the renderer.
   */
  ACCOUNT_DISABLED: "ACCOUNT_DISABLED",
  /** Account is temporarily locked after too many failed attempts (time-based; safe to surface). */
  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  /** The user must set a new password before the session can be used. */
  MUST_CHANGE_PASSWORD: "MUST_CHANGE_PASSWORD",
  /** No session / expired / revoked session for the requested operation. */
  SESSION_EXPIRED: "SESSION_EXPIRED",
  /** App has no users yet — first-run bootstrap required before any login. */
  NOT_PROVISIONED: "NOT_PROVISIONED",
  /** First-run bootstrap attempted after the app was already provisioned (one-time invariant). */
  ALREADY_PROVISIONED: "ALREADY_PROVISIONED",
  /** Chosen password does not satisfy the password policy. */
  PASSWORD_POLICY: "PASSWORD_POLICY",
  /** Chosen username does not satisfy the username rules. */
  USERNAME_INVALID: "USERNAME_INVALID",
  /** The selected authentication provider is disabled (e.g., Active Directory — coming soon). */
  PROVIDER_DISABLED: "PROVIDER_DISABLED",
  /** Secure OS storage is unavailable, so credentials cannot be read/written safely. */
  STORAGE_UNAVAILABLE: "STORAGE_UNAVAILABLE",
  // ── Authorization / administration (Phase 3) ─────────────────────────────────
  /** The principal lacks the permission required for the requested operation (deny-by-default). */
  NOT_AUTHORIZED: "NOT_AUTHORIZED",
  /** A sensitive operation requires a fresh password re-confirmation (within the reauth window). */
  REAUTH_REQUIRED: "REAUTH_REQUIRED",
  /** Operation refused because it would remove/disable/demote the final active Super User. */
  LAST_ACTIVE_SUPER_USER: "LAST_ACTIVE_SUPER_USER",
  /** The protected Super User cannot be deleted, disabled, demoted, or have its protection removed. */
  PROTECTED_SUPER_USER: "PROTECTED_SUPER_USER",
  /** The requested username is already taken. */
  USERNAME_TAKEN: "USERNAME_TAKEN",
  /** The target user does not exist. */
  USER_NOT_FOUND: "USER_NOT_FOUND",
  /** A supplied role id is not a known built-in role. */
  INVALID_ROLE: "INVALID_ROLE",
  /** Generic catch-all; details only in the audit log. */
  UNKNOWN: "UNKNOWN"
} as const;

export type AuthReasonCode = (typeof AuthReason)[keyof typeof AuthReason];

/** Thrown by trusted services; carries only a safe reason code (never free-text secrets). */
export class SecurityError extends Error {
  constructor(public readonly reason: AuthReasonCode, message?: string) {
    super(message ?? reason);
    this.name = "SecurityError";
  }
}
