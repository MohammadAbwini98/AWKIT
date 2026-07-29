/**
 * Trusted Active Directory provider. It performs a direct user bind over LDAPS or LDAP upgraded with
 * StartTLS, and maps the authenticated identity to an existing AWKIT account. Directory authentication
 * never creates users or changes roles: administrators keep ownership of local authorization state.
 */
import { Client } from "ldapts";
import type { ConnectionOptions } from "node:tls";
import { AuthReason } from "@src/security/errors/ReasonCodes";
import type { SecurityStore } from "@src/security/store/SecurityStore";
import type { AuthenticationProvider } from "./AuthenticationProvider";
import type { CredentialInput, ProviderAuthResult } from "./AuthTypes";
import { normalizeUsername } from "./UsernameRules";

export interface ActiveDirectoryConfig {
  url: string;
  domain: string;
  startTls: boolean;
  connectTimeoutMs: number;
  operationTimeoutMs: number;
  ca?: string;
}

export interface DirectoryClient {
  startTLS(options?: ConnectionOptions): Promise<void>;
  bind(identity: string, password: string): Promise<void>;
  unbind(): Promise<void>;
}

export type DirectoryClientFactory = (config: ActiveDirectoryConfig) => DirectoryClient;

export function validateActiveDirectoryConfig(config: ActiveDirectoryConfig | undefined): ActiveDirectoryConfig | null {
  if (!config) return null;
  const domain = config.domain.trim().toLowerCase();
  if (!domain || !/^[a-z0-9.-]+$/.test(domain) || domain.startsWith(".") || domain.endsWith(".")) return null;
  let url: URL;
  try {
    url = new URL(config.url);
  } catch {
    return null;
  }
  if (!url.hostname || url.username || url.password || (url.pathname !== "" && url.pathname !== "/") || url.search || url.hash) return null;
  if (url.protocol === "ldaps:") {
    if (config.startTls) return null;
  } else if (url.protocol === "ldap:") {
    if (!config.startTls) return null;
  } else {
    return null;
  }
  if (!Number.isInteger(config.connectTimeoutMs) || config.connectTimeoutMs < 250 || config.connectTimeoutMs > 60_000) return null;
  if (!Number.isInteger(config.operationTimeoutMs) || config.operationTimeoutMs < 250 || config.operationTimeoutMs > 60_000) return null;
  return { ...config, url: url.toString(), domain };
}

function createLdapClient(config: ActiveDirectoryConfig): DirectoryClient {
  const tlsOptions: ConnectionOptions = {
    minVersion: "TLSv1.2",
    rejectUnauthorized: true,
    ...(config.ca ? { ca: [config.ca] } : {})
  };
  const client = new Client({
    url: config.url,
    connectTimeout: config.connectTimeoutMs,
    timeout: config.operationTimeoutMs,
    tlsOptions
  });
  return {
    startTLS: (options) => client.startTLS(options),
    bind: (identity, password) => client.bind(identity, password),
    unbind: () => client.unbind()
  };
}

function isInvalidCredentials(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; name?: unknown };
  return candidate.code === 49 || candidate.code === "49" || candidate.name === "InvalidCredentialsError";
}

export class ActiveDirectoryProvider implements AuthenticationProvider {
  readonly id = "activeDirectory" as const;
  readonly displayName = "Active Directory";
  private readonly config: ActiveDirectoryConfig | null;

  constructor(
    private readonly store: SecurityStore,
    config?: ActiveDirectoryConfig,
    private readonly clientFactory: DirectoryClientFactory = createLdapClient
  ) {
    this.config = validateActiveDirectoryConfig(config);
  }

  isEnabled(): boolean {
    return this.config !== null;
  }

  async authenticate(input: CredentialInput): Promise<ProviderAuthResult> {
    if (!this.config) return { ok: false, reason: AuthReason.PROVIDER_DISABLED };
    const user = this.store.getUserByUsernameNorm(normalizeUsername(input.username));
    if (!user) return { ok: false, reason: AuthReason.INVALID_CREDENTIALS };
    if (user.status !== "active") {
      return { ok: false, reason: AuthReason.ACCOUNT_DISABLED, subjectId: user.id };
    }
    if (!input.password) {
      return { ok: false, reason: AuthReason.INVALID_CREDENTIALS, subjectId: user.id };
    }

    let client: DirectoryClient | null = null;
    try {
      client = this.clientFactory(this.config);
      if (this.config.startTls) {
        await client.startTLS({
          minVersion: "TLSv1.2",
          rejectUnauthorized: true,
          ...(this.config.ca ? { ca: [this.config.ca] } : {})
        });
      }
      await client.bind(`${normalizeUsername(input.username)}@${this.config.domain}`, input.password);
      return { ok: true, subjectId: user.id, displayName: user.displayName };
    } catch (error) {
      return {
        ok: false,
        reason: isInvalidCredentials(error) ? AuthReason.INVALID_CREDENTIALS : AuthReason.PROVIDER_UNAVAILABLE,
        subjectId: user.id
      };
    } finally {
      await client?.unbind().catch(() => undefined);
    }
  }
}
