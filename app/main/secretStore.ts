/**
 * Electron binding for the encrypted secret store (audit §15). The pure store lives in
 * `@src/secrets/SecretStore`; here we supply the OS keystore backend (Windows DPAPI via Electron
 * `safeStorage`) and the runtime file location, and expose a process singleton.
 */
import { safeStorage } from "electron";
import { join } from "node:path";
import { getRuntimeDataRoot } from "./appPaths";
import { getSecretStorageCapability } from "./secretStorageCapability";
import { SecretStore, type SecretCrypto } from "@src/secrets/SecretStore";

export type { SecretSummary } from "@src/secrets/SecretStore";
export { SecretStore } from "@src/secrets/SecretStore";

/**
 * Availability is delegated to the injectable capability (see `secretStorageCapability.ts`) so the
 * unavailable branch is reachable from a running app without an env-gated hook in this security path.
 * Encryption itself is NOT injectable: only the availability decision has a legitimate test seam, and
 * a substitutable encrypt/decrypt would be a genuine weakening of the shipped store.
 */
const electronCrypto: SecretCrypto = {
  isAvailable: () => getSecretStorageCapability().isEncryptionAvailable(),
  encrypt: (plain) => safeStorage.encryptString(plain),
  decrypt: (cipher) => safeStorage.decryptString(cipher)
};

let singleton: SecretStore | null = null;

export function getSecretStore(): SecretStore {
  if (!singleton) singleton = new SecretStore(join(getRuntimeDataRoot(), "secrets.json"), electronCrypto);
  return singleton;
}
