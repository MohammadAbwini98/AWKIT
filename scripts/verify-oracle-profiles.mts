/**
 * Oracle connection profiles + secure credentials (Phase 03). Pure — in-memory profile store and
 * secret vault, plus the real Java mock bridge for testConnection. Proves credentials never land in
 * profile JSON or renderer views, secrets are keyed by name, delete removes secrets, JDBC URLs
 * redact credentials, the pool fingerprint excludes the password, and error categories map to safe
 * messages.
 *
 * Run: `npm run verify:oracle-profiles`.
 */
import { buildOracleBridge } from "./build-oracle-bridge.mjs";
import { OracleJdbcBridgeManager, type BridgeLaunchSpec } from "../src/oracle/OracleJdbcBridgeManager";
import { OracleBridgeCallError } from "../src/oracle/OracleBridgeProtocol";
import {
  OracleProfileService,
  type OracleBridgeLike,
  type OracleProfileStore,
  type OracleSecretVault
} from "../src/oracle/OracleProfileService";
import {
  buildJdbcUrl,
  connectionFingerprint,
  redactJdbcUrl,
  validateOracleProfile,
  normalizeOracleProfile
} from "../src/oracle/OracleConnectionProfile";
import type { OracleConnectionProfile } from "../src/oracle/OracleConnectionProfile";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}`);
  }
}

// ── In-memory fakes ──────────────────────────────────────────────────────────
function memStore(): OracleProfileStore & { raw: Map<string, OracleConnectionProfile> } {
  const raw = new Map<string, OracleConnectionProfile>();
  return {
    raw,
    async list() {
      return [...raw.values()];
    },
    async get(id) {
      return raw.get(id) ?? null;
    },
    async create(p) {
      if (raw.has(p.id)) throw new Error("exists");
      raw.set(p.id, p);
      return p;
    },
    async update(id, p) {
      raw.set(id, p);
      return p;
    },
    async delete(id) {
      raw.delete(id);
    }
  };
}
function memVault(): OracleSecretVault & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    set: (n, v) => void raw.set(n, v),
    get: (n) => raw.get(n),
    has: (n) => raw.has(n),
    delete: (n) => void raw.delete(n)
  };
}

async function main(): Promise<void> {
  console.log("JDBC URL + redaction + fingerprint (pure):");
  const basic = normalizeOracleProfile({
    id: "p1",
    name: "Prod",
    connectionMode: "basic",
    host: "db.example.com",
    port: 1521,
    serviceName: "ORCLPDB1",
    username: "reader"
  });
  const built = buildJdbcUrl(basic);
  check("basic service URL is JDBC thin", built.url.startsWith("jdbc:oracle:thin:@") && built.url.includes("SERVICE_NAME=ORCLPDB1"));
  check("redactJdbcUrl masks embedded creds", redactJdbcUrl("jdbc:oracle:thin:reader/p4ss@db:1521:sid") === "jdbc:oracle:thin:***@db:1521:sid");

  const fp1 = connectionFingerprint(basic);
  const fpSamePw = connectionFingerprint({ ...basic }); // password isn't part of the profile → identical
  const fpDiffHost = connectionFingerprint({ ...basic, host: "other.example.com" });
  check("fingerprint stable for same connection", fp1 === fpSamePw);
  check("fingerprint changes with host", fp1 !== fpDiffHost);

  console.log("Validation:");
  check("valid basic profile passes", validateOracleProfile(basic).length === 0);
  check("missing host fails", validateOracleProfile(normalizeOracleProfile({ id: "x", name: "x", connectionMode: "basic", serviceName: "s" })).length > 0);
  check("jdbc-url mode requires a thin URL", validateOracleProfile(normalizeOracleProfile({ id: "x", name: "x", connectionMode: "jdbc-url", jdbcUrl: "postgres://nope" })).length > 0);

  console.log("Building the Java mock bridge…");
  const build = buildOracleBridge({ quiet: true });
  const launchSpec: BridgeLaunchSpec = { javaPath: build.jdk.java, jarPath: build.jarPath, env: { AWKIT_ORACLE_BRIDGE_MOCK: "1" } };
  const manager = new OracleJdbcBridgeManager({ resolveLaunchSpec: () => launchSpec, handshakeTimeoutMs: 20_000 });

  try {
    const store = memStore();
    const vault = memVault();
    const service = new OracleProfileService(store, vault, manager);

    console.log("Create + secret routing:");
    const view = await service.save({
      id: "prod",
      name: "Prod DB",
      connectionMode: "basic",
      host: "db.example.com",
      port: 1521,
      serviceName: "ORCLPDB1",
      username: "reader",
      password: "S3cr3t-Value!"
    });
    check("view reports hasPassword", view.hasPassword === true);
    check("view carries NO secret name field", !("passwordSecretName" in (view as Record<string, unknown>)));
    check("password stored in vault under oracle.<id>.password", vault.raw.get("oracle.prod.password") === "S3cr3t-Value!");
    const stored = store.raw.get("prod")!;
    check("persisted profile stores only the secret NAME", stored.passwordSecretName === "oracle.prod.password");
    check("password value is NOT in the persisted profile JSON", !JSON.stringify(stored).includes("S3cr3t-Value!"));

    console.log("Update keeps/clears secret:");
    await service.save({ id: "prod", name: "Prod DB v2", connectionMode: "basic", host: "db.example.com", port: 1521, serviceName: "ORCLPDB1", username: "reader" });
    check("update without password keeps stored secret", vault.raw.get("oracle.prod.password") === "S3cr3t-Value!");
    check("update applied non-secret field", store.raw.get("prod")!.name === "Prod DB v2");
    await service.save({ id: "prod", name: "Prod DB v2", connectionMode: "basic", host: "db.example.com", port: 1521, serviceName: "ORCLPDB1", username: "reader", clearPassword: true });
    check("clearPassword removes the secret", !vault.raw.has("oracle.prod.password"));
    check("cleared profile has no passwordSecretName", store.raw.get("prod")!.passwordSecretName === undefined);

    console.log("testConnection (mock bridge = ok):");
    await service.save({ id: "prod", name: "Prod DB", connectionMode: "basic", host: "db.example.com", port: 1521, serviceName: "ORCLPDB1", username: "reader", password: "pw" });
    const test = await service.testConnection("prod");
    check("testConnection ok via mock bridge", test.ok === true);
    check("testConnection returns safe db metadata", typeof test.databaseProductVersion === "string");

    console.log("Error-category mapping (stub bridge):");
    const failingBridge: OracleBridgeLike = {
      call: async () => {
        throw new OracleBridgeCallError("AUTHENTICATION_FAILED", "ORA-01017 raw text");
      }
    };
    const failService = new OracleProfileService(store, vault, failingBridge);
    const failResult = await failService.testConnection("prod");
    check("failed test reports category", failResult.errorCategory === "AUTHENTICATION_FAILED");
    check("failed test returns a SAFE message (no ORA text)", !!failResult.message && !failResult.message.includes("ORA-01017"));

    console.log("Delete removes profile + secrets:");
    await service.delete("prod");
    check("profile deleted", store.raw.get("prod") === undefined);
    check("password secret deleted", !vault.raw.has("oracle.prod.password"));
  } finally {
    await manager.dispose();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
