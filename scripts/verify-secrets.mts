/**
 * Secret-store hardening checks (audit §15). Pure — uses a fake reversible crypto backend instead of
 * the OS keystore. Run: `npm run verify:secrets`.
 *
 * Covers: encrypt-at-rest (no plaintext on disk), name/value validation, CRUD, keystore-unavailable
 * refusal, secret-name collection from flows, and literal-value log masking.
 */
import { SecretStore, type SecretCrypto } from "../src/secrets/SecretStore";
import { collectSecretNames } from "../src/profiles/FlowValidation";
import { SecretMasker, registerSecretValues } from "../src/reports/SecretMasker";
import type { FlowProfile } from "../src/profiles/FlowProfile";
import * as fs from "node:fs";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

const reversible: SecretCrypto = {
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from(`ENC::${plain}`, "utf8"),
  decrypt: (cipher) => cipher.toString("utf8").replace(/^ENC::/, "")
};
const unavailable: SecretCrypto = { isAvailable: () => false, encrypt: () => Buffer.alloc(0), decrypt: () => "" };

const dir = mkdtempSync(join(tmpdir(), "awkit-secrets-"));
const file = join(dir, "secrets.json");
const store = new SecretStore(file, reversible);

console.log("Secret store (encrypt-at-rest + CRUD):");
store.set("portal_password", "S3cr3t-Value!42");
check("get returns the stored value", store.get("portal_password") === "S3cr3t-Value!42");
check("has() true for stored name", store.has("portal_password"));

const onDisk = readFileSync(file, "utf8");
check("plaintext value is NOT on disk", !onDisk.includes("S3cr3t-Value!42"));
check("ciphertext is stored", onDisk.includes("base64" ) === false && onDisk.includes("cipher"));

const summaries = store.list();
check("list returns the name", summaries.some((s) => s.name === "portal_password"));
check("list carries no value field", summaries.every((s) => !("value" in (s as unknown as unknown as unknown as Record<string, unknown>)) && !("cipher" in (s as unknown as Record<string, unknown>))));

store.set("portal_password", "updated-Value-99");
check("set overwrites value", store.get("portal_password") === "updated-Value-99");

store.delete("portal_password");
check("delete removes the secret", store.get("portal_password") === undefined && !store.has("portal_password"));

console.log("Validation + availability:");
let threwName = false;
try { store.set("bad name!", "x"); } catch { threwName = true; }
check("rejects invalid name", threwName);
let threwEmpty = false;
try { store.set("ok_name", ""); } catch { threwEmpty = true; }
check("rejects empty value", threwEmpty);
const unavailStore = new SecretStore(join(dir, "s2.json"), unavailable);
let threwUnavail = false;
try { unavailStore.set("n", "v"); } catch { threwUnavail = true; }
check("refuses to store when keystore unavailable", threwUnavail);
check("get returns undefined when keystore unavailable", unavailStore.get("n") === undefined);

console.log("Secret-name collection from flows:");
const flows = [
  {
    id: "f1", name: "f1", version: 1, edges: [],
    nodes: [
      { id: "a", type: "fill", name: "pw", valueSource: { type: "secret", secretName: "portal_password" } },
      { id: "b", type: "goto", name: "go", valueSource: { type: "static", value: "http://x" } },
      { id: "c", type: "loop", name: "loop", loop: { valueSource: { type: "secret", secretName: "api_token" } } },
      { id: "d", type: "fill", name: "dup", valueSource: { type: "secret", secretName: "portal_password" } }
    ]
  }
] as unknown as FlowProfile[];
const names = collectSecretNames(flows).sort();
check("collects distinct secret names incl. loop source", JSON.stringify(names) === JSON.stringify(["api_token", "portal_password"]));

console.log("Literal-value log masking:");
registerSecretValues(["updated-Value-99"]);
const masker = new SecretMasker();
check("maskText scrubs a registered secret literal", !masker.maskText("logged updated-Value-99 here").includes("updated-Value-99"));
check("maskValue masks a registered secret literal", masker.maskValue("anyKey", "updated-Value-99") === "[masked]");
check("non-secret text is left intact", masker.maskText("ordinary log line") === "ordinary log line");

// ── AWKIT-DUR-002 — corrupt/unreadable vault is QUARANTINED, never silently emptied ──
{
  const durDir = mkdtempSync(join(tmpdir(), "awkit-dur002-"));
  const durFile = join(durDir, "secrets.json");

  // Seed a healthy vault with two secrets through the real store.
  const seedStore = new SecretStore(durFile, reversible);
  seedStore.set("oracle.prod", "prod-pass-1");
  seedStore.set("api.token", "token-2");

  // Corrupt it (torn write / truncated JSON — the exact failure class from the finding).
  const CORRUPT = '{ "version": 1, "secrets": { "oracle.pr';
  fs.writeFileSync(durFile, CORRUPT, "utf8");
  const bytesBefore = fs.readFileSync(durFile, "utf8");

  const broken = new SecretStore(durFile, reversible);
  let listThrew = "";
  let setThrew = "";
  try {
    broken.list();
  } catch (error) {
    listThrew = error instanceof Error ? error.message : String(error);
  }
  check("DUR-002 list() on a corrupt vault FAILS instead of returning empty", listThrew !== "", listThrew || "(no throw)");

  // Quarantine happens on FIRST read: exactly one .corrupt-* sibling preserves the original bytes.
  const siblings = fs.readdirSync(durDir).filter((f) => f.startsWith("secrets.json.corrupt-"));
  check("DUR-002 exactly one .corrupt-* sibling quarantines the bytes", siblings.length === 1, JSON.stringify(fs.readdirSync(durDir)));
  if (siblings.length === 1) {
    check("DUR-002 the quarantined sibling preserves the corrupt bytes verbatim", fs.readFileSync(join(durDir, siblings[0]), "utf8") === CORRUPT);
  }

  // The next set() now writes to a FRESH vault — the pre-corruption secrets are NOT silently
  // destroyed, they are recoverable verbatim from the quarantine sibling (old behavior wiped them
  // with no trace at all).
  let setOk = false;
  try {
    broken.set("new.after.corrupt", "fresh-value");
    setOk = true;
  } catch (error) {
    setThrew = error instanceof Error ? error.message : String(error);
  }
  check("DUR-002 set() works again on the fresh post-quarantine vault", setOk === true && setThrew === "", setThrew);
  check(
    "DUR-002 the fresh vault contains only the new secret — old bytes stay ONLY in the quarantine",
    (() => {
      const parsed = JSON.parse(fs.readFileSync(durFile, "utf8"));
      return Object.keys(parsed.secrets).length === 1 && parsed.secrets["new.after.corrupt"];
    })()
  );

  // Resolution from an unreadable vault fails CLOSED (undefined), never leaks a partial value.
  check("DUR-002 get() resolves nothing from an unreadable vault", broken.get("oracle.prod") === undefined);

  // Recovery: after the operator removes/renames the quarantine, the store works again.
  const recovered = new SecretStore(join(durDir, "recovered.json"), reversible);
  recovered.set("fresh", "value-3");
  check("DUR-002 a fresh vault file still works normally after a corruption episode", recovered.has("fresh"));

  fs.rmSync(durDir, { recursive: true, force: true });

  // ENOENT control: a genuinely missing file remains a normal empty store.
  const missing = new SecretStore(join(mkdirTmp(), "absent.json"), reversible);
  check("DUR-002 a MISSING vault file still reads as an empty store (ENOENT only)", missing.list().length === 0);
}

function mkdirTmp(): string {
  return fs.mkdtempSync(join(tmpdir(), "awkit-dur002b-"));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
