/**
 * TEST COMPOSITION ROOT — an Electron entry point that boots the real application with the OS
 * keystore reported as UNAVAILABLE (bd `awkit-8ri`, validation case SET-013).
 *
 * This is the only way the Secrets card's unavailable branch can be exercised in a running app.
 * `safeStorage.isEncryptionAvailable()` cannot be made to return false on a healthy Windows
 * developer machine, and the owner's decision was explicit: add a dependency seam, never an
 * environment override inside the shipped secret path.
 *
 * **This file is never part of the application.** It is:
 *   - not imported by `app/main/main.ts` or anything it reaches;
 *   - built only by `npm run build:test-roots`, to `out/test-main/` — a directory
 *     `electron-builder.json` explicitly excludes (`!out/test-main/**`);
 *   - self-disabling anyway, because `configureSecretStorageCapability` throws in a packaged build.
 *
 * `verify:secret-storage-seam` asserts all four of those independently, so removing any one of them
 * fails a check rather than silently shipping a test hook.
 *
 * Launch: `electron <repo>/out/test-main` with `cwd` set to the repo root (resources resolve from
 * `process.cwd()` in development). `__dirname` is `out/test-main`, a sibling of `out/preload` and
 * `out/renderer`, so the real window manager's relative preload/renderer paths resolve unchanged.
 */
import { configureSecretStorageCapability, type SecretStorageCapability } from "../secretStorageCapability";

const unavailableSecretStorage: SecretStorageCapability = {
  isEncryptionAvailable: () => false
};

// Must happen BEFORE the application module is evaluated: `secretStore.ts` builds its singleton on
// first use, and any earlier read would capture the production capability instead.
configureSecretStorageCapability(unavailableSecretStorage);

// Boot the real application. Importing rather than duplicating any of it is the point — the suite
// must exercise the same IPC, the same store and the same UI a user gets, differing only in the one
// injected decision.
await import("../main");
