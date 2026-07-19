/**
 * Electron binding for the security subsystem. The pure kernel lives in `@src/security/SecurityKernel`;
 * here we supply the OS keystore backend (Windows DPAPI via Electron `safeStorage`) for wrapping the
 * `passwordSecret` column, the runtime DB location, and a process singleton. Mirrors
 * `app/main/secretStore.ts`.
 */
import { safeStorage } from "electron";
import { join } from "node:path";
import { getRuntimeDataRoot } from "../appPaths";
import { SecurityKernel, type SecurityKernelOptions } from "@src/security/SecurityKernel";
import { DEFAULT_SESSION_POLICY } from "@src/security/session/SessionManager";
import type { ColumnCrypto } from "@src/security/crypto/ColumnCrypto";
import { SECURITY_DB_FILENAME } from "@src/security/store/SecurityStoreSchema";

/**
 * Optional test/dev overrides, each honored only as a positive finite number so a malformed value can
 * never weaken production defaults:
 *   - AWKIT_SESSION_IDLE_MS  — session idle timeout (ms), so the proactive idle-lock can be exercised
 *     without a 30-minute wait (absolute timeout untouched; production uses DEFAULT_SESSION_POLICY).
 *   - AWKIT_REAUTH_WINDOW_MS — the sensitive-op re-auth window (ms), so the ReauthDialog path can be
 *     exercised without waiting out the 5-minute default.
 */
function resolveKernelOptions(): SecurityKernelOptions {
  const options: SecurityKernelOptions = {};

  const idleRaw = process.env.AWKIT_SESSION_IDLE_MS;
  const idleMs = idleRaw ? Number(idleRaw) : NaN;
  if (Number.isFinite(idleMs) && idleMs > 0) {
    options.sessionPolicy = { ...DEFAULT_SESSION_POLICY, idleMs };
  }

  const reauthRaw = process.env.AWKIT_REAUTH_WINDOW_MS;
  const reauthMs = reauthRaw ? Number(reauthRaw) : NaN;
  if (Number.isFinite(reauthMs) && reauthMs > 0) {
    options.reauthWindowMs = reauthMs;
  }

  return options;
}

const electronColumnCrypto: ColumnCrypto = {
  isAvailable: () => {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  },
  wrap: (plain) => safeStorage.encryptString(plain).toString("base64"),
  unwrap: (token) => safeStorage.decryptString(Buffer.from(token, "base64"))
};

let kernelPromise: Promise<SecurityKernel> | null = null;

/** Open (once) the security kernel with the DPAPI-backed column crypto under %LOCALAPPDATA%. */
export function getSecurityKernel(): Promise<SecurityKernel> {
  if (!kernelPromise) {
    const dbPath = join(getRuntimeDataRoot(), "security", SECURITY_DB_FILENAME);
    kernelPromise = SecurityKernel.open(dbPath, electronColumnCrypto, resolveKernelOptions()).catch((error) => {
      kernelPromise = null; // allow a retry on the next call instead of caching the rejection
      throw error;
    });
  }
  return kernelPromise;
}

/** Whether the OS keystore is available (used for a clear STORAGE_UNAVAILABLE surface). */
export function isSecureStorageAvailable(): boolean {
  return electronColumnCrypto.isAvailable();
}

/** Flush + release the kernel on shutdown. */
export async function disposeSecurityKernel(): Promise<void> {
  if (!kernelPromise) return;
  try {
    const kernel = await kernelPromise;
    await kernel.close();
  } catch {
    /* best-effort */
  } finally {
    kernelPromise = null;
  }
}
