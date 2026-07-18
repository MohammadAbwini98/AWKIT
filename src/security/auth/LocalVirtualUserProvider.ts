/**
 * Local virtual-user provider: verifies a username/password against the security store (scrypt).
 * Returns a structured result with `subjectId` when the account resolved, so the AuthenticationService
 * can apply account-state policy (lockout, failed-login counting, audit) at the service level. Lockout
 * itself is NOT decided here — this is a pure credential check.
 *
 * Failure reasons are deliberately coarse: unknown-user and wrong-password both surface
 * INVALID_CREDENTIALS so the provider never reveals whether an account exists.
 *
 * See docs/plans/SECURE_LOGIN_AUTHORIZATION_LICENSING_IMPLEMENTATION_PLAN.md §10.
 */
import { AuthReason } from "@src/security/errors/ReasonCodes";
import { verifyPassword } from "@src/security/crypto/PasswordHasher";
import type { SecurityStore } from "@src/security/store/SecurityStore";
import type { AuthenticationProvider } from "./AuthenticationProvider";
import { normalizeUsername } from "./UsernameRules";
import type { CredentialInput, ProviderAuthResult } from "./AuthTypes";

export class LocalVirtualUserProvider implements AuthenticationProvider {
  readonly id = "local" as const;
  readonly displayName = "Virtual User";

  constructor(private readonly store: SecurityStore) {}

  isEnabled(): boolean {
    return true;
  }

  async authenticate(input: CredentialInput): Promise<ProviderAuthResult> {
    const user = this.store.getUserByUsernameNorm(normalizeUsername(input.username));
    if (!user) {
      return { ok: false, reason: AuthReason.INVALID_CREDENTIALS };
    }
    if (user.status !== "active") {
      // Internal ACCOUNT_DISABLED — the service maps it to INVALID_CREDENTIALS externally, but uses it
      // to audit precisely and to skip failed-attempt counting for a disabled account.
      return { ok: false, reason: AuthReason.ACCOUNT_DISABLED, subjectId: user.id };
    }
    if (!verifyPassword(input.password, user.passwordSecret)) {
      return { ok: false, reason: AuthReason.INVALID_CREDENTIALS, subjectId: user.id };
    }
    return { ok: true, subjectId: user.id, displayName: user.displayName };
  }
}
