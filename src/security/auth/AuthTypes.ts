/**
 * Shared authentication types. The `PrincipalSnapshot` is the read-only, non-sensitive view returned
 * to the renderer after a successful login — it carries NO password material and is a UI hint only;
 * authorization is always re-checked in the trusted layer per request (a later phase).
 *
 * See docs/plans/SECURE_LOGIN_AUTHORIZATION_LICENSING_IMPLEMENTATION_PLAN.md §9–§10.
 */
import type { AuthReasonCode } from "@src/security/errors/ReasonCodes";

export type ProviderId = "local" | "activeDirectory";

export interface CredentialInput {
  username: string;
  password: string;
}

export interface LoginRequest {
  providerId: ProviderId;
  username: string;
  password: string;
}

/** Result of a provider's credential check. `subjectId` is set whenever the subject resolved. */
export type ProviderAuthResult =
  | { ok: true; subjectId: string; displayName?: string }
  | { ok: false; reason: AuthReasonCode; subjectId?: string };

export interface PrincipalSnapshot {
  userId: string;
  username: string;
  displayName: string;
  isProtectedSuperUser: boolean;
  mustChangePassword: boolean;
  sessionRef: string;
  /** Assigned built-in role ids. UI hint only — authorization is re-checked in the trusted layer. */
  roles: string[];
  /** Effective permission strings (union of role permissions). UI hint only; IPC re-checks each call. */
  permissions: string[];
}

export type LoginResult =
  | { ok: true; principal: PrincipalSnapshot }
  | { ok: false; reason: AuthReasonCode };

export type SessionValidationResult =
  | { valid: true; principal: PrincipalSnapshot }
  | { valid: false; reason: AuthReasonCode };

export interface LoginOption {
  id: ProviderId;
  displayName: string;
  enabled: boolean;
}
