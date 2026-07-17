import { createHash } from "node:crypto";

/**
 * Reusable Oracle connection profile. Credentials NEVER live in this object: the password and any
 * trust-store secret are held in AWKIT's encrypted secret store and referenced here by NAME
 * (`passwordSecretName` / `trustStoreSecretName`) — the source plan's `passwordSecretRef` maps onto
 * an existing by-name secret. Pure/framework-agnostic (no Electron/React).
 */
export interface OraclePoolSettings {
  minSize: number;
  initialSize: number;
  maxSize: number;
  inactiveTimeoutSeconds: number;
}

export type OracleConnectionMode = "basic" | "jdbc-url" | "wallet";
export type OracleNetworkProtocol = "TCP" | "TCPS";

export interface OracleConnectionProfile {
  id: string;
  name: string;
  provider: "oracle-jdbc";
  connectionMode: OracleConnectionMode;
  host?: string;
  port?: number;
  serviceName?: string;
  sid?: string;
  jdbcUrl?: string;
  username?: string;
  /** Name of the stored password secret (never the value). */
  passwordSecretName?: string;
  walletDirectory?: string;
  trustStorePath?: string;
  /** Name of the stored trust-store password secret (never the value). */
  trustStoreSecretName?: string;
  networkProtocol: OracleNetworkProtocol;
  connectTimeoutMs: number;
  queryTimeoutMs: number;
  pool: OraclePoolSettings;
  readOnly: true;
  createdAt?: string;
  updatedAt?: string;
}

/** Renderer-safe projection: no secret material, only presence flags. */
export interface OracleConnectionProfileView extends Omit<OracleConnectionProfile, "passwordSecretName" | "trustStoreSecretName"> {
  hasPassword: boolean;
  hasTrustStoreSecret: boolean;
}

export const DEFAULT_ORACLE_POOL: OraclePoolSettings = {
  minSize: 0,
  initialSize: 0,
  maxSize: 4,
  inactiveTimeoutSeconds: 60
};

export function secretNameForProfile(profileId: string, kind: "password" | "truststore"): string {
  return `oracle.${profileId}.${kind}`;
}

/** Default a partial profile into a complete, valid-shaped one. */
export function normalizeOracleProfile(input: Partial<OracleConnectionProfile> & { id: string; name: string }): OracleConnectionProfile {
  return {
    provider: "oracle-jdbc",
    connectionMode: input.connectionMode ?? "basic",
    networkProtocol: input.networkProtocol ?? "TCP",
    connectTimeoutMs: input.connectTimeoutMs ?? 15_000,
    queryTimeoutMs: input.queryTimeoutMs ?? 30_000,
    pool: { ...DEFAULT_ORACLE_POOL, ...(input.pool ?? {}) },
    readOnly: true,
    ...input,
    // force-invariant fields last so a partial input cannot override them
    id: input.id,
    name: input.name
  } as OracleConnectionProfile;
}

/** Validate a profile. Returns human-readable messages ([] = valid). */
export function validateOracleProfile(p: OracleConnectionProfile): string[] {
  const errors: string[] = [];
  if (!p.name?.trim()) errors.push("Profile name is required.");
  if (p.connectionMode === "jdbc-url") {
    if (!p.jdbcUrl?.trim()) errors.push("A JDBC URL is required for the advanced connection mode.");
    else if (!/^jdbc:oracle:thin:@/i.test(p.jdbcUrl.trim())) errors.push("JDBC URL must start with 'jdbc:oracle:thin:@'.");
  } else {
    if (!p.host?.trim()) errors.push("Host is required.");
    if (!p.port || p.port <= 0 || p.port > 65535) errors.push("Port must be between 1 and 65535.");
    if (!p.serviceName?.trim() && !p.sid?.trim()) errors.push("A service name (or SID) is required.");
  }
  if (p.connectionMode === "wallet" && !p.walletDirectory?.trim()) {
    errors.push("A wallet directory is required for wallet connection mode.");
  }
  if (p.networkProtocol === "TCPS" && p.connectionMode !== "wallet" && !p.trustStorePath?.trim() && !p.walletDirectory?.trim()) {
    errors.push("TCPS requires a wallet directory or a trust store.");
  }
  if (p.pool.maxSize < 1) errors.push("Pool max size must be at least 1.");
  if (p.pool.minSize < 0 || p.pool.minSize > p.pool.maxSize) errors.push("Pool min size must be between 0 and max size.");
  if (p.queryTimeoutMs <= 0) errors.push("Query timeout must be positive.");
  return errors;
}

/** Build the JDBC Thin URL + connection properties (no password). */
export function buildJdbcUrl(p: OracleConnectionProfile): { url: string; properties: Record<string, string> } {
  const properties: Record<string, string> = {};
  if (p.connectionMode === "jdbc-url") {
    return { url: (p.jdbcUrl ?? "").trim(), properties };
  }
  const protocol = p.networkProtocol === "TCPS" ? "tcps" : "tcp";
  const host = (p.host ?? "").trim();
  const port = p.port ?? (p.networkProtocol === "TCPS" ? 2484 : 1521);

  let url: string;
  if (p.serviceName?.trim()) {
    url = `jdbc:oracle:thin:@(DESCRIPTION=(ADDRESS=(PROTOCOL=${protocol})(HOST=${host})(PORT=${port}))(CONNECT_DATA=(SERVICE_NAME=${p.serviceName.trim()})))`;
  } else {
    // SID form
    url = `jdbc:oracle:thin:@(DESCRIPTION=(ADDRESS=(PROTOCOL=${protocol})(HOST=${host})(PORT=${port}))(CONNECT_DATA=(SID=${(p.sid ?? "").trim()})))`;
  }

  if (p.walletDirectory?.trim()) {
    // Wallet/TNS admin dir is passed as a connection property, not embedded in the URL.
    properties["oracle.net.wallet_location"] = p.walletDirectory.trim();
    properties["oracle.net.tns_admin"] = p.walletDirectory.trim();
  }
  if (p.trustStorePath?.trim()) {
    properties["javax.net.ssl.trustStore"] = p.trustStorePath.trim();
    properties["oracle.net.ssl_server_dn_match"] = "true";
  }
  return { url, properties };
}

/** Redact any embedded `user/password@` credentials from a JDBC URL for logging. */
export function redactJdbcUrl(url: string): string {
  // jdbc:oracle:thin:user/password@host:port:sid  →  jdbc:oracle:thin:***@…
  return url.replace(/(jdbc:oracle:thin:)[^@/\s]+\/[^@\s]+@/i, "$1***@");
}

/**
 * Stable pool-compatibility fingerprint: URL + username + wallet/trust settings + protocol.
 * NEVER includes the password. Connections/pools are keyed by this so incompatible connections do
 * not share a pool.
 */
export function connectionFingerprint(p: OracleConnectionProfile): string {
  const { url, properties } = buildJdbcUrl(p);
  const material = JSON.stringify({
    url,
    user: (p.username ?? "").toLowerCase(),
    protocol: p.networkProtocol,
    wallet: p.walletDirectory ?? "",
    trust: p.trustStorePath ?? "",
    props: properties
  });
  return createHash("sha256").update(material).digest("hex").slice(0, 32);
}

/** Renderer-safe projection — strips secret names, exposes presence flags only. */
export function toProfileView(p: OracleConnectionProfile): OracleConnectionProfileView {
  const { passwordSecretName, trustStoreSecretName, ...rest } = p;
  return {
    ...rest,
    hasPassword: !!passwordSecretName,
    hasTrustStoreSecret: !!trustStoreSecretName
  };
}
