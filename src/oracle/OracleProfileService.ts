import {
  buildJdbcUrl,
  connectionFingerprint,
  normalizeOracleProfile,
  redactJdbcUrl,
  secretNameForProfile,
  toProfileView,
  validateOracleProfile,
  type OracleConnectionProfile,
  type OracleConnectionProfileView
} from "./OracleConnectionProfile";
import { OracleBridgeCallError, type OracleBridgeErrorCategory } from "./OracleBridgeProtocol";
import { safeMessageForCategory } from "./OracleErrors";

/** The subset of a profile store the service needs (structural — testable with an in-memory fake). */
export interface OracleProfileStore {
  list(): Promise<OracleConnectionProfile[]>;
  get(id: string): Promise<OracleConnectionProfile | null>;
  create(profile: OracleConnectionProfile): Promise<OracleConnectionProfile>;
  update(id: string, profile: OracleConnectionProfile): Promise<OracleConnectionProfile>;
  delete(id: string): Promise<void>;
}

/** By-name secret vault (structural subset of {@link SecretStore}). */
export interface OracleSecretVault {
  set(name: string, value: string): void;
  get(name: string): string | undefined;
  has(name: string): boolean;
  delete(name: string): void;
}

/** Minimal bridge surface the service calls. */
export interface OracleBridgeLike {
  call(op: "testConnection", params: Record<string, unknown>, options?: { timeoutMs?: number }): Promise<Record<string, unknown>>;
}

export interface OracleProfileInput extends Partial<OracleConnectionProfile> {
  id: string;
  name: string;
  /** Inline password to (re)store as a secret; omit to keep any existing password. */
  password?: string;
  /** Remove the stored password. */
  clearPassword?: boolean;
  /** Inline trust-store password to store as a secret. */
  trustStorePassword?: string;
}

export interface TestConnectionResult {
  ok: boolean;
  latencyMs?: number;
  databaseProductVersion?: string;
  driverVersion?: string;
  errorCategory?: OracleBridgeErrorCategory;
  message?: string;
}

/**
 * CRUD + test-connection for Oracle connection profiles. Passwords/trust-store secrets are written
 * to the injected secret vault by NAME; the persisted profile stores only the secret names. Renderer
 * projections expose `hasPassword`, never a value. Deleting a profile deletes its secrets.
 *
 * Pure/framework-agnostic: the main process injects the real JsonProfileStore + SecretStore + bridge
 * manager; tests inject in-memory fakes + the mock bridge.
 */
export class OracleProfileService {
  constructor(
    private readonly store: OracleProfileStore,
    private readonly secrets: OracleSecretVault,
    private readonly bridge: OracleBridgeLike,
    private readonly log?: (level: "info" | "warn" | "error", message: string) => void
  ) {}

  async list(): Promise<OracleConnectionProfileView[]> {
    const profiles = await this.store.list();
    return profiles.map(toProfileView);
  }

  async get(id: string): Promise<OracleConnectionProfileView | null> {
    const p = await this.store.get(id);
    return p ? toProfileView(p) : null;
  }

  /** Create or update a profile, routing inline secrets into the vault by name. */
  async save(input: OracleProfileInput): Promise<OracleConnectionProfileView> {
    const existing = await this.store.get(input.id);
    const { password, clearPassword, trustStorePassword, ...profileFields } = input;

    let profile = normalizeOracleProfile({ ...existing, ...profileFields, id: input.id, name: input.name });
    // Never trust an inbound secret-name field; derive it from stored state below.
    profile.passwordSecretName = existing?.passwordSecretName;
    profile.trustStoreSecretName = existing?.trustStoreSecretName;

    const errors = validateOracleProfile(profile);
    if (errors.length) throw new Error(errors.join(" "));

    // Password secret handling.
    if (clearPassword) {
      if (profile.passwordSecretName) this.secrets.delete(profile.passwordSecretName);
      profile.passwordSecretName = undefined;
    } else if (typeof password === "string" && password.length > 0) {
      const name = secretNameForProfile(profile.id, "password");
      this.secrets.set(name, password);
      profile.passwordSecretName = name;
    }

    // Trust-store password secret handling.
    if (typeof trustStorePassword === "string" && trustStorePassword.length > 0) {
      const name = secretNameForProfile(profile.id, "truststore");
      this.secrets.set(name, trustStorePassword);
      profile.trustStoreSecretName = name;
    }

    profile = {
      ...profile,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const saved = existing ? await this.store.update(profile.id, profile) : await this.store.create(profile);
    return toProfileView(saved);
  }

  /** Delete a profile and every secret it owns. */
  async delete(id: string): Promise<void> {
    const existing = await this.store.get(id);
    if (existing?.passwordSecretName) this.secrets.delete(existing.passwordSecretName);
    if (existing?.trustStoreSecretName) this.secrets.delete(existing.trustStoreSecretName);
    // Belt-and-braces: also delete by convention in case names drifted.
    this.secrets.delete(secretNameForProfile(id, "password"));
    this.secrets.delete(secretNameForProfile(id, "truststore"));
    await this.store.delete(id);
  }

  /**
   * Build the connection descriptor sent to the bridge. Includes the resolved password (from the
   * vault) — callers MUST NOT log the return value. The redacted URL is safe for diagnostics.
   */
  buildDescriptor(profile: OracleConnectionProfile): { descriptor: Record<string, unknown>; redactedUrl: string } {
    const { url, properties } = buildJdbcUrl(profile);
    const password = profile.passwordSecretName ? this.secrets.get(profile.passwordSecretName) : undefined;
    const trustStorePassword = profile.trustStoreSecretName ? this.secrets.get(profile.trustStoreSecretName) : undefined;
    const descriptor: Record<string, unknown> = {
      url,
      username: profile.username,
      password,
      properties,
      trustStorePassword,
      connectTimeoutMs: profile.connectTimeoutMs,
      queryTimeoutMs: profile.queryTimeoutMs,
      readOnly: true,
      poolKey: connectionFingerprint(profile),
      pool: profile.pool,
      // Routes to the isolated Java bridge for this profile's driver bundle (Phase 07). Not a secret.
      driverBundleId: profile.driverBundleId
    };
    return { descriptor, redactedUrl: redactJdbcUrl(url) };
  }

  /** Resolve a stored profile id to a bridge descriptor (profile + secrets), or null if unknown. */
  async resolveDescriptorForId(id: string): Promise<{ descriptor: Record<string, unknown>; redactedUrl: string } | null> {
    const profile = await this.store.get(id);
    if (!profile) return null;
    return this.buildDescriptor(profile);
  }

  /**
   * Stable, secret-free connection fingerprint for a stored profile (URL + user + wallet/protocol).
   * Used to detect when a snapshot Data Source is stale because its connection profile changed.
   * Returns null for an unknown profile id.
   */
  async connectionFingerprintForId(id: string): Promise<string | null> {
    const profile = await this.store.get(id);
    return profile ? connectionFingerprint(profile) : null;
  }

  /** Test a stored profile. */
  async testConnection(id: string): Promise<TestConnectionResult> {
    const profile = await this.store.get(id);
    if (!profile) return { ok: false, errorCategory: "INVALID_CONFIGURATION", message: "Profile not found." };
    return this.testProfile(profile);
  }

  /** Test an unsaved profile (used by the editor before saving). Inline password not persisted. */
  async testProfileDraft(input: OracleProfileInput): Promise<TestConnectionResult> {
    const { password, ...fields } = input;
    const draft = normalizeOracleProfile({ ...fields, id: input.id, name: input.name });
    const errors = validateOracleProfile(draft);
    if (errors.length) return { ok: false, errorCategory: "INVALID_CONFIGURATION", message: errors.join(" ") };
    // Resolve password: inline override, else stored secret.
    const resolved = typeof password === "string" && password.length > 0
      ? password
      : draft.passwordSecretName
        ? this.secrets.get(draft.passwordSecretName)
        : undefined;
    return this.testProfile(draft, resolved);
  }

  private async testProfile(profile: OracleConnectionProfile, passwordOverride?: string): Promise<TestConnectionResult> {
    const { descriptor, redactedUrl } = this.buildDescriptor(profile);
    if (passwordOverride !== undefined) descriptor.password = passwordOverride;
    this.log?.("info", `[oracle] testConnection ${profile.id} → ${redactedUrl}`);
    try {
      const result = await this.bridge.call("testConnection", descriptor, { timeoutMs: profile.connectTimeoutMs + 5_000 });
      return {
        ok: result.ok === true,
        latencyMs: typeof result.latencyMs === "number" ? result.latencyMs : undefined,
        databaseProductVersion: typeof result.databaseProductVersion === "string" ? result.databaseProductVersion : undefined,
        driverVersion: typeof result.driverVersion === "string" ? result.driverVersion : undefined
      };
    } catch (err) {
      const category: OracleBridgeErrorCategory = err instanceof OracleBridgeCallError ? err.category : "UNKNOWN";
      this.log?.("warn", `[oracle] testConnection ${profile.id} failed: ${category}`);
      return { ok: false, errorCategory: category, message: safeMessageForCategory(category) };
    }
  }
}
