import type { Page } from "playwright";
import { checkProtectedSurface } from "@src/security/ProtectedSurfaceGuard";

/** Upper bound for one page's protected-surface scan; an overrun counts as protected. */
export const PROTECTED_SURFACE_SCAN_BUDGET_MS = 5_000;

/**
 * awkit trace/observation capture gate: true unless the shared protected-surface guard proves `page` clean within the
 * budget. A guard error or overrun is protected (absence was not proven). A closed page can no longer be proven clean,
 * so it counts as protected when `closedIsProtected` is set (a recording that already saw it) and as clean otherwise
 * (nothing more can be recorded from it).
 */
export async function pageIsProtected(page: Page, options: { closedIsProtected?: boolean } = {}): Promise<boolean> {
  if (page.isClosed()) return options.closedIsProtected === true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const overrun = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(true), PROTECTED_SURFACE_SCAN_BUDGET_MS);
  });
  const scan = checkProtectedSurface(page).then(
    (verdict) => verdict.protected || (options.closedIsProtected === true && page.isClosed()),
    () => true
  );
  return Promise.race([scan, overrun]).finally(() => clearTimeout(timer));
}
