/**
 * The production protector for the N6 visual-baseline master key (Phase N, N6.3; C1, VA-14).
 *
 * Electron `safeStorage` (DPAPI on Windows) behind the same availability capability as the general
 * secret store, but the protected key is written to the PRIVATE N6 key file by `VisualBaselineStore`,
 * never to `secrets.json`: neither `secrets:*` nor a flow's secret-name resolution can reach it. There
 * is no plaintext fallback and no override; when the capability reports encryption unavailable, the
 * store refuses every keyed operation (`integrity-unavailable`).
 *
 * Not wired to any IPC channel or runtime caller in N6.3: the runner adapter (N6.4) and the approval
 * surface (N6.5) construct the store with it.
 */
import { safeStorage } from "electron";

import type { VisualKeyProtector } from "@src/runner/visualAssertion/VisualBaselineStore";
import { getSecretStorageCapability } from "../secretStorageCapability";

export const safeStorageVisualKeyProtector: VisualKeyProtector = {
  isAvailable: () => getSecretStorageCapability().isEncryptionAvailable(),
  protect: (plain) => safeStorage.encryptString(plain.toString("base64")),
  unprotect: (cipher) => Buffer.from(safeStorage.decryptString(cipher), "base64")
};
