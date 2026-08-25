/**
 * Offline issuer: generate a new Ed25519 signing key pair.
 *
 * Writes the PRIVATE key (PKCS8 DER, base64) to an external path OUTSIDE the repo and prints the PUBLIC
 * key (SPKI DER, base64) for you to add to `src/licensing/crypto/TrustedKeys.ts`. The private key is never
 * committed, bundled, or placed in application resources.
 *
 * Usage: npx tsx tools/license-issuer/keygen.mts --keyId key2 [--key <privateKeyPath>]
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  DEFAULT_ISSUER_KEY_ID,
  ISSUER_KEY_PATH_ENV,
  nonElectronRuntimeRoot,
  resolveIssuerKeyLocation
} from "../../src/licensing/issuer/IssuerLocations";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const keyId = arg("keyId") ?? DEFAULT_ISSUER_KEY_ID;
// The canonical resolver, so a key is GENERATED exactly where the app, the bridge and the CLI will
// later look for it. This file used to compose its own path with a different variable order and a
// `"."` fallback, which could write a private key into the current working directory.
const keyLocation = resolveIssuerKeyLocation({ runtimeRoot: nonElectronRuntimeRoot(), keyId });
const keyOverride = arg("key");
const keyPath = keyOverride === undefined ? keyLocation.keyPath : resolve(keyOverride);

if (!keyPath) {
  console.error(
    `Cannot determine where to write the key (${keyLocation.problem ?? "UNRESOLVED"}). Set ` +
      `${ISSUER_KEY_PATH_ENV} to an ABSOLUTE path, or pass --key <absolute path>.`
  );
  process.exit(1);
}

if (existsSync(keyPath)) {
  console.error(`Refusing to overwrite existing key at ${keyPath}. Choose a new --keyId or --key path.`);
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const pub = publicKey.export({ type: "spki", format: "der" }).toString("base64");
const priv = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");

mkdirSync(dirname(keyPath), { recursive: true });
writeFileSync(keyPath, priv, { encoding: "utf8", mode: 0o600 });

console.log(`Private key written (keep secret, never commit): ${keyPath}`);
console.log("\nAdd this entry to TRUSTED_KEYS in src/licensing/crypto/TrustedKeys.ts:\n");
console.log(
  JSON.stringify({ keyId, algorithm: "Ed25519", publicKeySpkiB64: pub }, null, 2)
);
