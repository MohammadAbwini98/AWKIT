/**
 * Injectable OS-keystore capability (owner decision 2026-07-29, bd `awkit-8ri` / case SET-013).
 *
 * The Secrets card must be provable in the GUI when the OS keystore is unavailable. The pure
 * `SecretStore` already accepts an injected backend, but `getSecretStore()` hard-wired the Electron
 * one, so the unavailable branch had no seam above the domain layer and only the "available" half was
 * reachable from a running app.
 *
 * The rejected alternative was an env-gated override inside `secretStore.ts`. That would put a
 * runtime security bypass in the shipped secret path — the same class of thing deliberately removed
 * from the Zvec host (`__testAbort`). This is dependency injection instead: production composes the
 * real capability at its composition root, and a SEPARATE test composition root
 * (`app/main/testing/unavailableSecretStorageRoot.ts`, built only to `out/test-main/` and excluded
 * from packaging) composes an unavailable one.
 *
 * There is deliberately NO environment variable, command-line flag, setting, IPC channel, or
 * persisted preference that can change this. `configureSecretStorageCapability` throws in a packaged
 * build, so the substitution is structurally impossible in a shipped application rather than merely
 * undocumented.
 */
import { app, safeStorage } from "electron";

export interface SecretStorageCapability {
  isEncryptionAvailable(): boolean;
}

/** Production capability: Windows DPAPI via Electron `safeStorage`. */
export class ElectronSecretStorageCapability implements SecretStorageCapability {
  isEncryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      // An unavailable keystore must read as "unavailable", never as a throw that a caller could
      // mistake for a transient fault and retry past.
      return false;
    }
  }
}

/**
 * True for a real packaged application. Reads `app.isPackaged` directly rather than
 * `isProductionOffline()`, because that helper honours the `PRODUCTION_OFFLINE` environment
 * variable — precisely what must not be able to unlock a substitution.
 */
function isPackagedBuild(): boolean {
  try {
    return app.isPackaged === true;
  } catch {
    return false; // not inside a real Electron app (tsx tooling) — development context
  }
}

const productionCapability = new ElectronSecretStorageCapability();
let configured: SecretStorageCapability | null = null;

/**
 * Install a capability. Only a non-packaged composition root may call this, and only once — a second
 * call would mean two roots are fighting over the same seam, which is a wiring bug, not a fallback.
 *
 * @throws in a packaged build, or if a capability is already installed.
 */
export function configureSecretStorageCapability(capability: SecretStorageCapability): void {
  if (isPackagedBuild()) {
    throw new Error(
      "Secret-storage capability substitution is not available in a packaged application."
    );
  }
  if (configured) {
    throw new Error("A secret-storage capability is already configured for this process.");
  }
  configured = capability;
}

/** The active capability. Defaults to the real one, so an unconfigured process is never weakened. */
export function getSecretStorageCapability(): SecretStorageCapability {
  return configured ?? productionCapability;
}

/** Test-support only: drop the installed capability so a suite can install a different one. */
export function resetSecretStorageCapability(): void {
  configured = null;
}
