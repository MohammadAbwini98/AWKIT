/**
 * SQLite-backed security store (users, sessions, provisioning, audit) on the pure-WASM `sql.js` driver,
 * mirroring `src/runner/store/SqliteRuntimeStore`: in-memory database persisted to a real `.sqlite`
 * file with atomic-rename writes, single-writer. The `passwordSecret` column is wrapped by the injected
 * {@link ColumnCrypto} (Windows DPAPI in production; a reversible fake in tsx verifiers) so a copied
 * database file does not expose the scrypt records for offline cracking.
 *
 * See docs/plans/SECURE_LOGIN_AUTHORIZATION_LICENSING_IMPLEMENTATION_PLAN.md §17–§18.
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Database, SqlValue } from "sql.js";
import { loadSqlJs } from "@src/runner/store/SqlJsLoader";
import type { ColumnCrypto } from "@src/security/crypto/ColumnCrypto";
import {
  SECURITY_STORE_MIGRATIONS,
  type AuditEvent,
  type SessionRecord,
  type UserRecord,
  type UserStatus
} from "./SecurityStoreSchema";

/** Columns a caller may update via {@link SecurityStore.updateUser}. */
const UPDATABLE_USER_COLUMNS = new Set<keyof UserRecord>([
  "displayName",
  "status",
  "passwordSecret",
  "passwordAlgo",
  "mustChangePassword",
  "failedLoginCount",
  "lockedUntil",
  "lastLoginAt",
  "passwordChangedAt",
  "updatedAt",
  "updatedBy"
]);

export class SecurityStore {
  private persistChain: Promise<void> = Promise.resolve();

  private constructor(
    private readonly db: Database,
    private readonly dbPath: string,
    private readonly crypto: ColumnCrypto
  ) {}

  /** Open (or create) the database file, apply pending migrations, and persist. */
  static async open(dbPath: string, crypto: ColumnCrypto): Promise<SecurityStore> {
    if (!crypto.isAvailable()) {
      throw new Error("Secure storage is unavailable; refusing to open the security store in plaintext.");
    }
    const SQL = await loadSqlJs();
    let db: Database;
    try {
      const bytes = await readFile(dbPath);
      db = new SQL.Database(bytes);
    } catch {
      db = new SQL.Database();
    }
    const store = new SecurityStore(db, dbPath, crypto);
    store.migrate();
    await store.persist();
    return store;
  }

  /** Apply every migration not yet recorded in security_migrations (idempotent). */
  private migrate(): void {
    this.db.run(
      `CREATE TABLE IF NOT EXISTS security_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, appliedAt TEXT NOT NULL)`
    );
    const applied = new Set<number>();
    const result = this.db.exec("SELECT version FROM security_migrations");
    if (result.length) for (const row of result[0].values) applied.add(Number(row[0]));

    for (const migration of SECURITY_STORE_MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      for (const statement of migration.statements) this.db.run(statement);
      this.db.run("INSERT INTO security_migrations (version, name, appliedAt) VALUES (?, ?, ?)", [
        migration.version,
        migration.name,
        new Date().toISOString()
      ]);
    }
  }

  appliedMigrations(): Array<{ version: number; name: string }> {
    const result = this.db.exec("SELECT version, name FROM security_migrations ORDER BY version");
    if (!result.length) return [];
    return result[0].values.map((row) => ({ version: Number(row[0]), name: String(row[1]) }));
  }

  // ── Provisioning ────────────────────────────────────────────────────────────

  isProvisioned(): boolean {
    const result = this.db.exec("SELECT provisioned FROM security_provisioning WHERE id = 1");
    if (result.length && result[0].values.length) return Number(result[0].values[0][0]) === 1;
    return false;
  }

  async setProvisioned(at: string): Promise<void> {
    this.db.run(
      `INSERT INTO security_provisioning (id, provisioned, provisionedAt) VALUES (1, 1, ?)
       ON CONFLICT(id) DO UPDATE SET provisioned = 1, provisionedAt = excluded.provisionedAt`,
      [at]
    );
    await this.persist();
  }

  userCount(): number {
    const result = this.db.exec("SELECT COUNT(*) FROM security_users");
    return result.length ? Number(result[0].values[0][0]) : 0;
  }

  // ── Users ─────────────────────────────────────────────────────────────────

  getUserById(id: string): UserRecord | null {
    return this.queryOneUser("SELECT * FROM security_users WHERE id = ?", [id]);
  }

  getUserByUsernameNorm(usernameNorm: string): UserRecord | null {
    return this.queryOneUser("SELECT * FROM security_users WHERE usernameNorm = ?", [usernameNorm]);
  }

  async createUser(record: UserRecord): Promise<UserRecord> {
    this.db.run(
      `INSERT INTO security_users
         (id, username, usernameNorm, displayName, status, passwordSecret, passwordAlgo, mustChangePassword,
          failedLoginCount, lockedUntil, lastLoginAt, passwordChangedAt, isProtectedSuperUser,
          createdAt, createdBy, updatedAt, updatedBy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.username,
        record.usernameNorm,
        record.displayName,
        record.status,
        this.crypto.wrap(record.passwordSecret),
        record.passwordAlgo,
        record.mustChangePassword ? 1 : 0,
        record.failedLoginCount,
        record.lockedUntil,
        record.lastLoginAt,
        record.passwordChangedAt,
        record.isProtectedSuperUser ? 1 : 0,
        record.createdAt,
        record.createdBy,
        record.updatedAt,
        record.updatedBy
      ]
    );
    await this.persist();
    return record;
  }

  async updateUser(id: string, patch: Partial<UserRecord>): Promise<void> {
    const assignments: string[] = [];
    const params: SqlValue[] = [];
    for (const [key, value] of Object.entries(patch)) {
      if (!UPDATABLE_USER_COLUMNS.has(key as keyof UserRecord)) continue;
      if (key === "passwordSecret") {
        assignments.push("passwordSecret = ?");
        params.push(this.crypto.wrap(String(value)));
      } else if (key === "mustChangePassword") {
        assignments.push("mustChangePassword = ?");
        params.push(value ? 1 : 0);
      } else {
        assignments.push(`${key} = ?`);
        params.push(value as SqlValue);
      }
    }
    if (!assignments.length) return;
    params.push(id);
    this.db.run(`UPDATE security_users SET ${assignments.join(", ")} WHERE id = ?`, params);
    await this.persist();
  }

  // ── Sessions ────────────────────────────────────────────────────────────────

  async insertSession(record: SessionRecord): Promise<SessionRecord> {
    this.db.run(
      `INSERT INTO security_sessions (id, userId, createdAt, lastActivityAt, absoluteExpiresAt, lastReauthAt, revokedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [record.id, record.userId, record.createdAt, record.lastActivityAt, record.absoluteExpiresAt, record.lastReauthAt, record.revokedAt]
    );
    await this.persist();
    return record;
  }

  getSession(id: string): SessionRecord | null {
    const stmt = this.db.prepare("SELECT * FROM security_sessions WHERE id = ?");
    try {
      stmt.bind([id]);
      if (!stmt.step()) return null;
      const row = stmt.getAsObject();
      return {
        id: String(row.id),
        userId: String(row.userId),
        createdAt: String(row.createdAt),
        lastActivityAt: String(row.lastActivityAt),
        absoluteExpiresAt: String(row.absoluteExpiresAt),
        lastReauthAt: row.lastReauthAt == null ? null : String(row.lastReauthAt),
        revokedAt: row.revokedAt == null ? null : String(row.revokedAt)
      };
    } finally {
      stmt.free();
    }
  }

  async touchSession(id: string, lastActivityAt: string): Promise<void> {
    this.db.run("UPDATE security_sessions SET lastActivityAt = ? WHERE id = ?", [lastActivityAt, id]);
    await this.persist();
  }

  async revokeSession(id: string, revokedAt: string): Promise<void> {
    this.db.run("UPDATE security_sessions SET revokedAt = ? WHERE id = ? AND revokedAt IS NULL", [revokedAt, id]);
    await this.persist();
  }

  async revokeSessionsForUser(userId: string, revokedAt: string): Promise<void> {
    this.db.run("UPDATE security_sessions SET revokedAt = ? WHERE userId = ? AND revokedAt IS NULL", [revokedAt, userId]);
    await this.persist();
  }

  // ── Audit ─────────────────────────────────────────────────────────────────

  async appendAudit(event: AuditEvent): Promise<void> {
    this.db.run(
      `INSERT INTO security_audit (at, actorUserId, actorName, eventType, targetType, targetId, result, reasonCode, sessionId, detailJson)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.at,
        event.actorUserId ?? null,
        event.actorName ?? null,
        event.eventType,
        event.targetType ?? null,
        event.targetId ?? null,
        event.result,
        event.reasonCode ?? null,
        event.sessionId ?? null,
        event.detail ? JSON.stringify(event.detail) : null
      ]
    );
    await this.persist();
  }

  auditCount(): number {
    const result = this.db.exec("SELECT COUNT(*) FROM security_audit");
    return result.length ? Number(result[0].values[0][0]) : 0;
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private queryOneUser(sql: string, params: SqlValue[]): UserRecord | null {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      if (!stmt.step()) return null;
      const row = stmt.getAsObject();
      return {
        id: String(row.id),
        username: String(row.username),
        usernameNorm: String(row.usernameNorm),
        displayName: String(row.displayName),
        status: String(row.status) as UserStatus,
        passwordSecret: this.crypto.unwrap(String(row.passwordSecret)),
        passwordAlgo: String(row.passwordAlgo),
        mustChangePassword: Number(row.mustChangePassword) === 1,
        failedLoginCount: Number(row.failedLoginCount),
        lockedUntil: row.lockedUntil == null ? null : String(row.lockedUntil),
        lastLoginAt: row.lastLoginAt == null ? null : String(row.lastLoginAt),
        passwordChangedAt: String(row.passwordChangedAt),
        isProtectedSuperUser: Number(row.isProtectedSuperUser) === 1,
        createdAt: String(row.createdAt),
        createdBy: String(row.createdBy),
        updatedAt: String(row.updatedAt),
        updatedBy: String(row.updatedBy)
      };
    } finally {
      stmt.free();
    }
  }

  /** Serialize persistence so overlapping writes never interleave; atomic-rename the exported bytes. */
  private persist(): Promise<void> {
    this.persistChain = this.persistChain.then(() => this.persistNow(), () => this.persistNow());
    return this.persistChain;
  }

  private async persistNow(): Promise<void> {
    const data = Buffer.from(this.db.export());
    await mkdir(dirname(this.dbPath), { recursive: true });
    const tmp = `${this.dbPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, data);
    try {
      await rename(tmp, this.dbPath);
    } catch (error) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  /** Flush and release the database. */
  async close(): Promise<void> {
    await this.persistChain.catch(() => undefined);
    this.db.close();
  }
}
