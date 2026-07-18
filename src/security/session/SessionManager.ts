/**
 * Main-owned application sessions. The renderer only ever holds an opaque `sessionRef` (the session id)
 * — the authoritative record lives here + in the security store. Sessions expire on idle timeout and an
 * absolute timeout; logout revokes immediately so a reused ref fails closed. The clock is injectable so
 * timeouts are deterministically testable.
 *
 * See docs/plans/SECURE_LOGIN_AUTHORIZATION_LICENSING_IMPLEMENTATION_PLAN.md §13.
 */
import { randomBytes } from "node:crypto";
import type { SecurityStore } from "@src/security/store/SecurityStore";

export interface SessionPolicy {
  /** Idle timeout: revoke if inactive longer than this. */
  idleMs: number;
  /** Absolute timeout: revoke this long after creation regardless of activity. */
  absoluteMs: number;
}

export const DEFAULT_SESSION_POLICY: SessionPolicy = {
  idleMs: 30 * 60 * 1000, // 30 minutes
  absoluteMs: 12 * 60 * 60 * 1000 // 12 hours
};

export type SessionResolution =
  | { valid: true; userId: string }
  | { valid: false };

export class SessionManager {
  constructor(
    private readonly store: SecurityStore,
    private readonly policy: SessionPolicy = DEFAULT_SESSION_POLICY,
    private readonly now: () => number = () => Date.now()
  ) {}

  /** Create a new session bound to a user; returns the opaque session id. */
  async create(userId: string): Promise<string> {
    const id = randomBytes(32).toString("base64url");
    const nowMs = this.now();
    await this.store.insertSession({
      id,
      userId,
      createdAt: new Date(nowMs).toISOString(),
      lastActivityAt: new Date(nowMs).toISOString(),
      absoluteExpiresAt: new Date(nowMs + this.policy.absoluteMs).toISOString(),
      lastReauthAt: new Date(nowMs).toISOString(),
      revokedAt: null
    });
    return id;
  }

  /**
   * Validate a session id. Sliding idle window on success; revokes (fail-closed) on idle/absolute
   * expiry so an expired ref cannot be reused.
   */
  async validate(sessionId: string): Promise<SessionResolution> {
    const session = this.store.getSession(sessionId);
    if (!session || session.revokedAt) return { valid: false };
    const nowMs = this.now();
    const absolute = Date.parse(session.absoluteExpiresAt);
    const lastActivity = Date.parse(session.lastActivityAt);
    if (nowMs >= absolute || nowMs - lastActivity >= this.policy.idleMs) {
      await this.store.revokeSession(sessionId, new Date(nowMs).toISOString());
      return { valid: false };
    }
    await this.store.touchSession(sessionId, new Date(nowMs).toISOString());
    return { valid: true, userId: session.userId };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.store.revokeSession(sessionId, new Date(this.now()).toISOString());
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.store.revokeSessionsForUser(userId, new Date(this.now()).toISOString());
  }

  /** Revoke all of a user's sessions except the one supplied — session rotation on password change. */
  async revokeOthersForUser(userId: string, keepSessionId: string): Promise<void> {
    await this.store.revokeSessionsForUserExcept(userId, keepSessionId, new Date(this.now()).toISOString());
  }
}
