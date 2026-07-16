/**
 * Navigation protocol policy for the runner's automation navigation sinks (`page.goto`).
 *
 * AWKIT legitimately automates arbitrary http(s) targets — including internal/localhost
 * applications — so the policy does NOT block private networks. It rejects the schemes that
 * let a manipulated workflow leave the intended model — chiefly `file:` (reads local files into
 * the automation browser), plus browser-internal surfaces (`chrome:`, `chrome-extension:`,
 * `devtools:`) and `javascript:`. `data:`/`about:` are inline-content targets with no local
 * filesystem access and are allowed (also used by protected-login test fixtures).
 */
const ALLOWED_NAVIGATION_PROTOCOLS = new Set(["http:", "https:", "about:", "data:"]);

/** Whether `raw` is an allowed navigation target. Scheme-less (relative) URLs are allowed
 *  (Playwright resolves/validates them against the current page). */
export function isNavigableUrl(raw: string): boolean {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return false;
  // No scheme → relative navigation; let Playwright handle it.
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return true;
  try {
    return ALLOWED_NAVIGATION_PROTOCOLS.has(new URL(trimmed).protocol.toLowerCase());
  } catch {
    return false;
  }
}

/** Throws a friendly error when `url` is not an allowed navigation target; returns it otherwise. */
export function assertNavigableUrl(url: string): string {
  if (!isNavigableUrl(url)) {
    const scheme = (url ?? "").trim().split(":")[0];
    throw new Error(
      `Navigation to "${scheme}:" URLs is not allowed by WebFlow Studio. Only http(s) automation targets are permitted.`
    );
  }
  return url;
}
