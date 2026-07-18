/**
 * Security store schema — users, sessions, provisioning, and audit for the local virtual-user
 * authentication subsystem. Real SQLite file via the pure-WASM `sql.js` driver (no native ABI; runs in
 * the Node tsx verifiers AND Electron's main process), mirroring `src/runner/store/SqliteRuntimeStore`.
 *
 * Versioned migrations: each entry runs once, recorded in `security_migrations`. Forward-only.
 * `passwordSecret` holds the scrypt record wrapped by the injected ColumnCrypto (DPAPI in production).
 *
 * See docs/plans/SECURE_LOGIN_AUTHORIZATION_LICENSING_IMPLEMENTATION_PLAN.md §18.
 */
export const SECURITY_DB_FILENAME = "security.sqlite";

export interface SecurityStoreMigration {
  version: number;
  name: string;
  statements: string[];
}

export const SECURITY_STORE_MIGRATIONS: SecurityStoreMigration[] = [
  {
    version: 1,
    name: "initial-auth-schema",
    statements: [
      `CREATE TABLE IF NOT EXISTS security_migrations (
         version INTEGER PRIMARY KEY,
         name TEXT NOT NULL,
         appliedAt TEXT NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS security_users (
         id TEXT PRIMARY KEY,
         username TEXT NOT NULL UNIQUE,
         usernameNorm TEXT NOT NULL UNIQUE,
         displayName TEXT NOT NULL,
         status TEXT NOT NULL,
         passwordSecret TEXT NOT NULL,
         passwordAlgo TEXT NOT NULL,
         mustChangePassword INTEGER NOT NULL DEFAULT 0,
         failedLoginCount INTEGER NOT NULL DEFAULT 0,
         lockedUntil TEXT,
         lastLoginAt TEXT,
         passwordChangedAt TEXT NOT NULL,
         isProtectedSuperUser INTEGER NOT NULL DEFAULT 0,
         createdAt TEXT NOT NULL,
         createdBy TEXT NOT NULL,
         updatedAt TEXT NOT NULL,
         updatedBy TEXT NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS security_sessions (
         id TEXT PRIMARY KEY,
         userId TEXT NOT NULL,
         createdAt TEXT NOT NULL,
         lastActivityAt TEXT NOT NULL,
         absoluteExpiresAt TEXT NOT NULL,
         lastReauthAt TEXT,
         revokedAt TEXT
       )`,
      `CREATE TABLE IF NOT EXISTS security_provisioning (
         id INTEGER PRIMARY KEY CHECK (id = 1),
         provisioned INTEGER NOT NULL,
         provisionedAt TEXT
       )`,
      `CREATE TABLE IF NOT EXISTS security_audit (
         seq INTEGER PRIMARY KEY AUTOINCREMENT,
         at TEXT NOT NULL,
         actorUserId TEXT,
         actorName TEXT,
         eventType TEXT NOT NULL,
         targetType TEXT,
         targetId TEXT,
         result TEXT NOT NULL,
         reasonCode TEXT,
         sessionId TEXT,
         detailJson TEXT
       )`,
      `CREATE INDEX IF NOT EXISTS idx_security_sessions_user ON security_sessions (userId)`,
      `CREATE INDEX IF NOT EXISTS idx_security_audit_at ON security_audit (at)`
    ]
  }
];

// ── Row/record shapes ────────────────────────────────────────────────────────

export type UserStatus = "active" | "disabled";

/** A user record as used in the trusted layer. `passwordSecret` is the UNWRAPPED scrypt record. */
export interface UserRecord {
  id: string;
  username: string;
  usernameNorm: string;
  displayName: string;
  status: UserStatus;
  passwordSecret: string;
  passwordAlgo: string;
  mustChangePassword: boolean;
  failedLoginCount: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  passwordChangedAt: string;
  isProtectedSuperUser: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface SessionRecord {
  id: string;
  userId: string;
  createdAt: string;
  lastActivityAt: string;
  absoluteExpiresAt: string;
  lastReauthAt: string | null;
  revokedAt: string | null;
}

export interface AuditEvent {
  at: string;
  actorUserId?: string | null;
  actorName?: string | null;
  eventType: string;
  targetType?: string | null;
  targetId?: string | null;
  result: "success" | "failure";
  reasonCode?: string | null;
  sessionId?: string | null;
  detail?: Record<string, unknown> | null;
}
