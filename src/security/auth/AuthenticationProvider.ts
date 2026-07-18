/**
 * Authentication-provider abstraction. `LocalVirtualUserProvider` is active; `ActiveDirectoryProvider`
 * is a visible-but-disabled stub — its `isEnabled()` returns false and its `authenticate()` refuses, so
 * the login IPC rejects any attempt to authenticate against it (a DOM-enabled "Coming Soon" tab cannot
 * create an alternate login path). The real AD integration boundary is documented, not implemented.
 *
 * See docs/plans/SECURE_LOGIN_AUTHORIZATION_LICENSING_IMPLEMENTATION_PLAN.md §9 and §30.
 */
import { AuthReason } from "@src/security/errors/ReasonCodes";
import type { CredentialInput, ProviderAuthResult, ProviderId } from "./AuthTypes";

export interface AuthenticationProvider {
  readonly id: ProviderId;
  readonly displayName: string;
  isEnabled(): boolean;
  authenticate(input: CredentialInput): Promise<ProviderAuthResult>;
}

/**
 * Future Active Directory provider — intentionally disabled and inert for this release. No LDAP/SSPI,
 * no mock success, no config. Enabling it is a trusted-layer decision (never renderer-driven).
 */
export class ActiveDirectoryProvider implements AuthenticationProvider {
  readonly id = "activeDirectory" as const;
  readonly displayName = "Active Directory";

  isEnabled(): boolean {
    return false;
  }

  async authenticate(): Promise<ProviderAuthResult> {
    return { ok: false, reason: AuthReason.PROVIDER_DISABLED };
  }
}
