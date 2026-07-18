/**
 * Password policy for local virtual users. Checked in the trusted layer on bootstrap, creation, and
 * change (the renderer may mirror it for UX, but this is the boundary).
 *
 * See docs/plans/SECURE_LOGIN_AUTHORIZATION_LICENSING_IMPLEMENTATION_PLAN.md §10.3.
 */
import { normalizeUsername } from "./UsernameRules";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

/** Small offline denylist of obvious weak passwords (no network, no bundled megafile for this slice). */
const COMMON_DENYLIST = new Set([
  "password",
  "password1",
  "password123",
  "123456789012",
  "qwertyuiop",
  "letmein12345",
  "administrator",
  "changeme1234"
]);

export interface PasswordValidation {
  ok: boolean;
  errors: string[];
}

function classCount(password: string): number {
  let classes = 0;
  if (/[a-z]/.test(password)) classes += 1;
  if (/[A-Z]/.test(password)) classes += 1;
  if (/[0-9]/.test(password)) classes += 1;
  if (/[^A-Za-z0-9]/.test(password)) classes += 1;
  return classes;
}

export function validatePassword(password: string, context: { username?: string } = {}): PasswordValidation {
  const errors: string[] = [];
  const value = password ?? "";
  if (value.length < PASSWORD_MIN_LENGTH) {
    errors.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    errors.push(`Password must be at most ${PASSWORD_MAX_LENGTH} characters.`);
  }
  if (classCount(value) < 3) {
    errors.push("Password must include at least 3 of: lowercase, uppercase, digit, symbol.");
  }
  if (COMMON_DENYLIST.has(value.toLowerCase())) {
    errors.push("Password is too common. Choose a less predictable password.");
  }
  if (context.username) {
    const norm = normalizeUsername(context.username);
    if (norm.length >= 3 && value.toLowerCase().includes(norm)) {
      errors.push("Password must not contain the username.");
    }
  }
  return { ok: errors.length === 0, errors };
}
