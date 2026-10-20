/**
 * Protected-surface refusal for Visual Intelligence (Phase N, N0).
 *
 * The implementation moved to `src/security/ProtectedSurfaceGuard.ts` (awkit-4b5y) so the runner's B2 failure capture
 * shares the exact same guard without importing `src/visual`. This module re-exports it unchanged for N0's callers,
 * including the strict capture-window watch B2 and the screenshot paths use (awkit-3gtj).
 */
export {
  checkProtectedSurface,
  protectedCallerVerdict,
  watchProtectedWindow,
  PROTECTED_FRAME_SCAN_TIMEOUT_MS,
  type ProtectedCallerContext,
  type ProtectedGuardReason,
  type ProtectedGuardVerdict,
  type ProtectedWindowWatch
} from "../security/ProtectedSurfaceGuard";
