/**
 * verify:audit-session-digest — AWKIT-SEC-007: no security audit record persists a raw session reference.
 *
 * A session reference is the session id (256 random bits) and, while live, a bearer value on the explicit-ref
 * `security:admin:*` channels. Audit rows must hold only the one-way correlation digest (`sref1:` + 32 hex) or null.
 *
 *  A. Real writers on a real temp security store (PassthroughColumnCrypto, as verify:auth): bootstrap, login, failed
 *     login, re-authentication, password change, user administration, session revocation, logout, plus the direct
 *     `appendAudit` shape every IPC-side writer uses (N6, licensing, issuer, branding, DOM intelligence, denials). The
 *     persisted file is then read back with sql.js independently of the store: every audit sessionId is a digest or
 *     null, no audit column holds any live reference, rows of one session correlate, different sessions do not.
 *  B. Migration v6 on a legacy database (raw references planted, v6 unrecorded): every raw reference becomes its
 *     digest, every other column and the row count are byte-identical, v6 is recorded once, reopening is idempotent.
 *  C. Boundary: the only `INSERT INTO security_audit` is the store's sink and it digests; listAudit still never
 *     projects the column.
 *  D. Mutants of the persisted rows (raw kept, a truncated raw, an unprefixed hash, a leak into detail) must be caught.
 *
 * Run: npm run verify:audit-session-digest
 */
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { auditSessionDigest, isAuditSessionDigest } from "../src/security/audit/auditSessionRef";
import { PassthroughColumnCrypto } from "../src/security/crypto/ColumnCrypto";
import { SecurityKernel } from "../src/security/SecurityKernel";
import { SecurityStore } from "../src/security/store/SecurityStore";
import { SECURITY_DB_FILENAME } from "../src/security/store/SecurityStoreSchema";
import { loadSqlJs } from "../src/runner/store/SqlJsLoader";

type Row = Record<string, string | number | null>;

let passed = 0;
let failed = 0;
const check = (label: string, ok: unknown, detail?: string): void => {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

const SU_PASSWORD = "Sup3rSecret!42";
const NEW_PASSWORD = "N3wSecret!Pass77";

async function auditRows(dbPath: string): Promise<Row[]> {
  const SQL = await loadSqlJs();
  const db = new SQL.Database(readFileSync(dbPath));
  try {
    const result = db.exec("SELECT seq, at, actorUserId, actorName, eventType, targetType, targetId, result, reasonCode, sessionId, detailJson FROM security_audit ORDER BY seq");
    if (!result.length) return [];
    const { columns, values } = result[0];
    return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i] as string | number | null])));
  } finally {
    db.close();
  }
}

/** Every violation of the SEC-007 rule in a set of persisted audit rows. */
function violations(rows: Row[], liveRefs: string[]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    if (row.sessionId !== null && !isAuditSessionDigest(row.sessionId)) out.push(`seq ${row.seq}: sessionId is not a digest`);
    const text = JSON.stringify(row);
    for (const ref of liveRefs) {
      // Any 16-character window of a live reference counts: a truncated bearer is still a leak.
      for (let i = 0; i + 16 <= ref.length; i += 8) {
        if (text.includes(ref.slice(i, i + 16))) {
          out.push(`seq ${row.seq}: holds part of a live session reference`);
          break;
        }
      }
    }
  }
  return out;
}

async function partA(): Promise<{ rows: Row[]; refs: string[] }> {
  console.log("A. Real audit writers on a real store");
  const dir = mkdtempSync(join(tmpdir(), "awkit-sec007-"));
  const dbPath = join(dir, SECURITY_DB_FILENAME);
  const kernel = await SecurityKernel.open(dbPath, new PassthroughColumnCrypto());
  const refs: string[] = [];
  await kernel.auth.bootstrapSuperUser({ username: "superuser", password: SU_PASSWORD, displayName: "Super User" });
  const first = await kernel.auth.login({ providerId: "local", username: "superuser", password: SU_PASSWORD });
  if (!first.ok) throw new Error("login failed");
  const ref1 = first.principal.sessionRef;
  refs.push(ref1);
  await kernel.auth.login({ providerId: "local", username: "superuser", password: "Wrong!Password9" });
  await kernel.auth.reauthenticate(ref1, SU_PASSWORD);
  await kernel.auth.changePassword(ref1, SU_PASSWORD, NEW_PASSWORD);
  const second = await kernel.auth.login({ providerId: "local", username: "superuser", password: NEW_PASSWORD });
  if (!second.ok) throw new Error("second login failed");
  const ref2 = second.principal.sessionRef;
  refs.push(ref2);
  const actor = await kernel.authz.resolveActor(ref2);
  const created = await kernel.userAdmin.createUser(actor, { username: "operator1", password: "Oper8tor!Pass9", roles: ["Viewer"] });
  check("the admin writer ran (user created)", created.ok, JSON.stringify(created).slice(0, 200));
  if (created.ok) await kernel.userAdmin.revokeSessions(actor, created.value.id);
  // The direct sink shape every IPC-side writer uses (they pass the raw actor.sessionRef).
  await kernel.store.appendAudit({ at: new Date().toISOString(), eventType: "VISUAL_CANDIDATE_APPROVED", result: "success", actorUserId: actor.user.id, actorName: actor.user.username, sessionId: ref2, targetType: "visual-assertion", targetId: "flow/step", detail: { mode: "observe" } });
  await kernel.store.appendAudit({ at: new Date().toISOString(), eventType: "REPORT_READ_DENIED", result: "failure", reasonCode: "NOT_AUTHORIZED", sessionId: ref2, targetType: "ipc-channel", targetId: "reports:get", detail: { requiredPermission: "PAGE_REPORTS" } });
  await kernel.store.appendAudit({ at: new Date().toISOString(), eventType: "LICENSE_CHECK", result: "success", sessionId: null, detail: {} });
  await kernel.auth.logout(ref2);
  await kernel.close();

  const rows = await auditRows(dbPath);
  check("the run wrote audit rows from every writer", rows.length >= 9 && new Set(rows.map((r) => r.eventType)).size >= 7, `${rows.length} rows`);
  const v = violations(rows, refs);
  check("every persisted audit sessionId is a one-way digest or null; no audit column holds a live reference", v.length === 0, v.slice(0, 5).join("; "));
  const d1 = auditSessionDigest(ref1);
  const d2 = auditSessionDigest(ref2) as string;
  const of2 = rows.filter((r) => r.sessionId === d2).map((r) => r.eventType);
  check("rows of one session correlate through its digest (login, direct writers and logout)", of2.includes("LOGIN_SUCCESS") && of2.includes("VISUAL_CANDIDATE_APPROVED") && of2.includes("REPORT_READ_DENIED") && of2.includes("LOGOUT"), JSON.stringify(of2));
  check("two sessions never share a digest", d1 !== d2 && rows.some((r) => r.sessionId === d1));
  check("a writer passing null stays null", rows.some((r) => r.eventType === "LICENSE_CHECK" && r.sessionId === null));
  check("the digest is deterministic and carries no 8-character window of the reference", auditSessionDigest(ref2) === d2 && ![...Array(ref2.length - 7).keys()].some((i) => d2.includes(ref2.slice(i, i + 8))));
  return { rows, refs };
}

async function partB(): Promise<void> {
  console.log("B. Migration v6 rewrites legacy rows");
  const dir = mkdtempSync(join(tmpdir(), "awkit-sec007-legacy-"));
  const dbPath = join(dir, SECURITY_DB_FILENAME);
  const store = await SecurityStore.open(dbPath, new PassthroughColumnCrypto());
  const legacyRefs = ["LegacyRefA_" + "x".repeat(32), "LegacyRefB_" + "y".repeat(32)];
  await store.appendAudit({ at: "2026-01-01T00:00:00.000Z", eventType: "LOGIN_SUCCESS", result: "success", actorUserId: "u1", actorName: "a", sessionId: null, detail: { providerId: "local" } });
  await store.appendAudit({ at: "2026-01-01T00:01:00.000Z", eventType: "REAUTH", result: "success", actorUserId: "u1", sessionId: null });
  await store.appendAudit({ at: "2026-01-01T00:02:00.000Z", eventType: "LOGOUT", result: "success", sessionId: null });
  await store.close();

  // Make it a pre-v6 database: plant raw references and forget that v6 ran.
  const SQL = await loadSqlJs();
  const db = new SQL.Database(readFileSync(dbPath));
  db.run("UPDATE security_audit SET sessionId = ? WHERE eventType IN ('LOGIN_SUCCESS', 'REAUTH')", [legacyRefs[0]]);
  db.run("UPDATE security_audit SET sessionId = ? WHERE eventType = 'LOGOUT'", [legacyRefs[1]]);
  db.run("DELETE FROM security_migrations WHERE version = 6");
  writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();
  const before = await auditRows(dbPath);
  check("the legacy fixture holds raw references", before.filter((r) => legacyRefs.includes(String(r.sessionId))).length === 3);

  const migrated = await SecurityStore.open(dbPath, new PassthroughColumnCrypto());
  const applied = migrated.appliedMigrations().filter((m) => m.version === 6);
  await migrated.close();
  const after = await auditRows(dbPath);
  check("v6 is recorded exactly once", applied.length === 1 && applied[0].name === "audit-session-reference-digest", JSON.stringify(applied));
  check(
    "every legacy raw reference became its digest",
    after.every((r) => r.sessionId === null || isAuditSessionDigest(r.sessionId)) && after.find((r) => r.eventType === "LOGOUT")?.sessionId === auditSessionDigest(legacyRefs[1])
  );
  check("legacy rows of one session still correlate", after.filter((r) => r.sessionId === auditSessionDigest(legacyRefs[0])).length === 2);
  const strip = (rows: Row[]) => JSON.stringify(rows.map(({ sessionId: _s, ...rest }) => rest));
  check("every other column and the row count are unchanged", after.length === before.length && strip(after) === strip(before));
  check("no legacy reference survives anywhere in the audit table", violations(after, legacyRefs).length === 0);

  const again = await SecurityStore.open(dbPath, new PassthroughColumnCrypto());
  await again.close();
  check("reopening is idempotent (a digest is never re-hashed)", JSON.stringify(await auditRows(dbPath)) === JSON.stringify(after));
}

function partC(): void {
  console.log("C. The sink is the only audit writer path");
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry)) files.push(path);
    }
  };
  walk(join(process.cwd(), "src"));
  walk(join(process.cwd(), "app"));
  const inserters = files.filter((f) => /INSERT INTO security_audit/.test(readFileSync(f, "utf8")));
  check(
    "exactly one source inserts into security_audit (the store)",
    inserters.length === 1 && inserters[0].replace(/\\/g, "/").endsWith("src/security/store/SecurityStore.ts"),
    inserters.join(", ")
  );
  const store = readFileSync(join(process.cwd(), "src/security/store/SecurityStore.ts"), "utf8");
  check("the sink writes auditSessionDigest(event.sessionId), never the raw value", /auditSessionDigest\(event\.sessionId\)/.test(store) && !/event\.sessionId \?\? null/.test(store));
  check("listAudit still never projects sessionId", /SELECT seq, at, actorName, eventType, targetType, targetId, result, reasonCode FROM security_audit/.test(store));
}

function partD(rows: Row[], refs: string[]): void {
  console.log("D. Mutants (each must be caught)");
  const raw = refs[1];
  const mutate = (fn: (r: Row) => Row) => rows.map((r) => (r.sessionId ? fn(r) : r));
  const mutants: [string, Row[]][] = [
    ["the raw reference is kept", mutate((r) => ({ ...r, sessionId: raw }))],
    ["a truncated raw reference is kept", mutate((r) => ({ ...r, sessionId: raw.slice(0, 24) }))],
    ["an unprefixed hash is stored", mutate((r) => ({ ...r, sessionId: String(r.sessionId).replace("sref1:", "") }))],
    ["the reference leaks into detailJson", rows.map((r, i) => (i === 0 ? { ...r, detailJson: JSON.stringify({ sessionRef: raw }) } : r))]
  ];
  for (const [name, mutated] of mutants) check(`mutant "${name}" is caught`, violations(mutated, refs).length > 0);
}

async function main(): Promise<void> {
  const { rows, refs } = await partA();
  await partB();
  partC();
  partD(rows, refs);
  console.log(`\nverify:audit-session-digest: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
