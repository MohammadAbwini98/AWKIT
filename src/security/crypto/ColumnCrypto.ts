/**
 * Pluggable at-rest wrapping for sensitive DB columns (password records), mirroring the pattern in
 * `src/secrets/SecretStore.ts`. In production the Electron main process injects a Windows-DPAPI backend
 * (`safeStorage`); tsx verifiers inject a reversible fake. Wrapping a copied `security.sqlite` with
 * DPAPI means the file is not usable on another Windows user/machine — the scrypt hash is never exposed
 * for offline cracking straight from the file.
 *
 * See docs/plans/SECURE_LOGIN_AUTHORIZATION_LICENSING_IMPLEMENTATION_PLAN.md §17.
 */
export interface ColumnCrypto {
  /** Whether secure wrapping is available; when false the store refuses to persist secrets. */
  isAvailable(): boolean;
  /** Wrap a plaintext string into a storable (base64) token. */
  wrap(plain: string): string;
  /** Reverse {@link wrap}. Throws if the token cannot be unwrapped. */
  unwrap(token: string): string;
}

/**
 * Test/verifier backend: NOT encryption — a reversible base64 transform so the pure store is testable
 * without an Electron keystore. Never use in production (guarded by `isAvailable` wiring in main).
 */
export class PassthroughColumnCrypto implements ColumnCrypto {
  isAvailable(): boolean {
    return true;
  }
  wrap(plain: string): string {
    return Buffer.from(plain, "utf8").toString("base64");
  }
  unwrap(token: string): string {
    return Buffer.from(token, "base64").toString("utf8");
  }
}
