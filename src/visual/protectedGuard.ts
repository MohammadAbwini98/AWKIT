/**
 * Protected-surface refusal for Visual Intelligence (Phase N, N0).
 *
 * The implementation moved to `src/security/ProtectedSurfaceGuard.ts` (awkit-4b5y) so the runner's B2 failure capture
 * shares the exact same guard without importing `src/visual`. This module re-exports it unchanged for N0's callers.
 */
export {
  checkProtectedSurface,
  protectedCallerVerdict,
  PROTECTED_FRAME_SCAN_TIMEOUT_MS,
  type ProtectedCallerContext,
  type ProtectedGuardReason,
  type ProtectedGuardVerdict
} from "../security/ProtectedSurfaceGuard";
