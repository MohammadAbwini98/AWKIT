import type { CredentialInput, ProviderAuthResult, ProviderId } from "./AuthTypes";

export interface AuthenticationProvider {
  readonly id: ProviderId;
  readonly displayName: string;
  isEnabled(): boolean;
  authenticate(input: CredentialInput): Promise<ProviderAuthResult>;
}
