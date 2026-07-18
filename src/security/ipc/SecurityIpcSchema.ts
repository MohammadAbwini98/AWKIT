/**
 * Hand-written schema validators for security IPC payloads (no new dependency; matches the repo style).
 * Every renderer→main security call is validated here BEFORE any service runs, so malformed or crafted
 * payloads are rejected at the boundary. Bounds are generous but finite to blunt trivial abuse.
 *
 * See docs/plans/SECURE_LOGIN_AUTHORIZATION_LICENSING_IMPLEMENTATION_PLAN.md §20.
 */
import type { LoginRequest, ProviderId } from "@src/security/auth/AuthTypes";

const MAX_USERNAME = 64;
const MAX_PASSWORD = 400; // policy caps at 200; allow slack so over-long input is rejected, not truncated
const MAX_DISPLAY_NAME = 128;
const MAX_SESSION_REF = 256;
const PROVIDER_IDS: ProviderId[] = ["local", "activeDirectory"];

export class InvalidPayloadError extends Error {
  constructor(message = "Invalid request payload.") {
    super(message);
    this.name = "InvalidPayloadError";
  }
}

function str(value: unknown, max: number, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new InvalidPayloadError(`Invalid "${field}".`);
  }
  return value;
}

function optStr(value: unknown, max: number, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return str(value, max, field);
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidPayloadError();
  }
  return value as Record<string, unknown>;
}

export function parseLoginRequest(input: unknown): LoginRequest {
  const obj = record(input);
  const providerId = obj.providerId;
  if (typeof providerId !== "string" || !PROVIDER_IDS.includes(providerId as ProviderId)) {
    throw new InvalidPayloadError('Invalid "providerId".');
  }
  return {
    providerId: providerId as ProviderId,
    username: str(obj.username, MAX_USERNAME, "username"),
    password: str(obj.password, MAX_PASSWORD, "password")
  };
}

export interface BootstrapPayload {
  username: string;
  password: string;
  displayName?: string;
}

export function parseBootstrap(input: unknown): BootstrapPayload {
  const obj = record(input);
  return {
    username: str(obj.username, MAX_USERNAME, "username"),
    password: str(obj.password, MAX_PASSWORD, "password"),
    displayName: optStr(obj.displayName, MAX_DISPLAY_NAME, "displayName")
  };
}

export function parseSessionRef(input: unknown): string {
  return str(input, MAX_SESSION_REF, "sessionRef");
}

export interface ChangePasswordPayload {
  sessionRef: string;
  currentPassword: string;
  newPassword: string;
}

export function parseChangePassword(input: unknown): ChangePasswordPayload {
  const obj = record(input);
  return {
    sessionRef: str(obj.sessionRef, MAX_SESSION_REF, "sessionRef"),
    currentPassword: str(obj.currentPassword, MAX_PASSWORD, "currentPassword"),
    newPassword: str(obj.newPassword, MAX_PASSWORD, "newPassword")
  };
}
