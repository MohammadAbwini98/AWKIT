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
import { mkdtempSync, readFileSync } from "node:fs";
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
check("list carries no value field", summaries.every((s) => !("value" in (s as Record<string, unknown>)) && !("cipher" in (s as Record<string, unknown>))));

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
