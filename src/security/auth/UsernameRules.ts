/**
 * Username validation + normalization for local virtual users. Enforced in the trusted layer, not just
 * the form. Uniqueness is checked against the normalized (lowercase) form so `Admin` and `admin` cannot
 * both exist.
 *
 * See docs/plans/SECURE_LOGIN_AUTHORIZATION_LICENSING_IMPLEMENTATION_PLAN.md §10.2.
 */
const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

/** Lowercase + trim; the canonical form used for uniqueness and lookup. */
export function normalizeUsername(username: string): string {
  return (username ?? "").trim().toLowerCase();
}

export interface UsernameValidation {
  ok: boolean;
  errors: string[];
}

export function validateUsername(username: string): UsernameValidation {
  const errors: string[] = [];
  const norm = normalizeUsername(username);
  if (!USERNAME_PATTERN.test(norm)) {
    errors.push("Username must be 3–32 characters using letters, numbers, dot, dash or underscore.");
  }
  if (/^[.\-]/.test(norm) || /[.\-]$/.test(norm)) {
    errors.push("Username cannot start or end with a dot or dash.");
  }
  return { ok: errors.length === 0, errors };
}
