/**
 * Hand-written validators for the Super-User administration IPC payloads (Phase 3). Every admin
 * renderer→main call is validated here BEFORE authorization + service logic runs, so malformed or
 * crafted payloads are rejected at the boundary. No new dependency; matches SecurityIpcSchema style.
 */
import type { UserStatus } from "@src/security/store/SecurityStoreSchema";

const MAX_USERNAME = 64;
const MAX_PASSWORD = 400;
const MAX_DISPLAY_NAME = 128;
const MAX_SESSION_REF = 256;
const MAX_USER_ID = 64;
const MAX_ROLE_ID = 32;
const MAX_ROLES = 8;

export class InvalidAdminPayloadError extends Error {
  constructor(message = "Invalid request payload.") {
    super(message);
    this.name = "InvalidAdminPayloadError";
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new InvalidAdminPayloadError();
  return value as Record<string, unknown>;
}

function str(value: unknown, max: number, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new InvalidAdminPayloadError(`Invalid "${field}".`);
  }
  return value;
}

function optStr(value: unknown, max: number, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return str(value, max, field);
}

function roleArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_ROLES) throw new InvalidAdminPayloadError(`Invalid "${field}".`);
  return value.map((r) => str(r, MAX_ROLE_ID, `${field}[]`));
}

export function parseSessionField(input: unknown): { sessionRef: string } {
  return { sessionRef: str(record(input).sessionRef, MAX_SESSION_REF, "sessionRef") };
}

export interface AdminCreateUserPayload {
  sessionRef: string;
  username: string;
  password: string;
  displayName?: string;
  roles: string[];
}

export function parseAdminCreateUser(input: unknown): AdminCreateUserPayload {
  const obj = record(input);
  return {
    sessionRef: str(obj.sessionRef, MAX_SESSION_REF, "sessionRef"),
    username: str(obj.username, MAX_USERNAME, "username"),
    password: str(obj.password, MAX_PASSWORD, "password"),
    displayName: optStr(obj.displayName, MAX_DISPLAY_NAME, "displayName"),
    roles: roleArray(obj.roles ?? [], "roles")
  };
}

export interface AdminUpdateUserPayload {
  sessionRef: string;
  userId: string;
  displayName?: string;
  roles?: string[];
}

export function parseAdminUpdateUser(input: unknown): AdminUpdateUserPayload {
  const obj = record(input);
  return {
    sessionRef: str(obj.sessionRef, MAX_SESSION_REF, "sessionRef"),
    userId: str(obj.userId, MAX_USER_ID, "userId"),
    displayName: optStr(obj.displayName, MAX_DISPLAY_NAME, "displayName"),
    roles: obj.roles === undefined ? undefined : roleArray(obj.roles, "roles")
  };
}

const STATUSES: UserStatus[] = ["active", "disabled", "archived"];

export interface AdminSetStatusPayload {
  sessionRef: string;
  userId: string;
  status: UserStatus;
}

export function parseAdminSetStatus(input: unknown): AdminSetStatusPayload {
  const obj = record(input);
  const status = obj.status;
  if (typeof status !== "string" || !STATUSES.includes(status as UserStatus)) {
    throw new InvalidAdminPayloadError('Invalid "status".');
  }
  return {
    sessionRef: str(obj.sessionRef, MAX_SESSION_REF, "sessionRef"),
    userId: str(obj.userId, MAX_USER_ID, "userId"),
    status: status as UserStatus
  };
}

export interface AdminResetPasswordPayload {
  sessionRef: string;
  userId: string;
  newPassword: string;
}

export function parseAdminResetPassword(input: unknown): AdminResetPasswordPayload {
  const obj = record(input);
  return {
    sessionRef: str(obj.sessionRef, MAX_SESSION_REF, "sessionRef"),
    userId: str(obj.userId, MAX_USER_ID, "userId"),
    newPassword: str(obj.newPassword, MAX_PASSWORD, "newPassword")
  };
}

export interface AdminUserIdPayload {
  sessionRef: string;
  userId: string;
}

export function parseAdminUserId(input: unknown): AdminUserIdPayload {
  const obj = record(input);
  return {
    sessionRef: str(obj.sessionRef, MAX_SESSION_REF, "sessionRef"),
    userId: str(obj.userId, MAX_USER_ID, "userId")
  };
}

export interface AdminReauthPayload {
  sessionRef: string;
  password: string;
}

export function parseAdminReauth(input: unknown): AdminReauthPayload {
  const obj = record(input);
  return {
    sessionRef: str(obj.sessionRef, MAX_SESSION_REF, "sessionRef"),
    password: str(obj.password, MAX_PASSWORD, "password")
  };
}

export interface AdminListAuditPayload {
  sessionRef: string;
  limit?: number;
  offset?: number;
}

function optInt(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new InvalidAdminPayloadError(`Invalid "${field}".`);
  return Math.floor(value);
}

export function parseAdminListAudit(input: unknown): AdminListAuditPayload {
  const obj = record(input);
  return {
    sessionRef: str(obj.sessionRef, MAX_SESSION_REF, "sessionRef"),
    limit: optInt(obj.limit, "limit"),
    offset: optInt(obj.offset, "offset")
  };
}
