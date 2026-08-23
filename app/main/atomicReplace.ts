/**
 * Canonical location: `src/storage/atomicReplace.ts`.
 *
 * AWKIT-SES-001: this module was the second (and then a third fork in
 * `src/session/atomicWrite.ts`) implementation of the temp+rename+EPERM/EBUSY-retry pattern, with
 * retry defaults that had drifted from the session copy. There is now exactly ONE implementation,
 * living in the framework-agnostic core so `src/session` can use it without importing Electron.
 * This file re-exports it unchanged so every existing `app/main` caller keeps working.
 */
export {
  DEFAULT_REPLACE_ATTEMPTS,
  DEFAULT_REPLACE_BACKOFF_MS,
  TRANSIENT_REPLACE_CODES,
  isTransientReplaceError,
  replaceFileAtomically,
  type AtomicReplaceOptions
} from "../../src/storage/atomicReplace";
