/**
 * Session matching helpers shared by the runner (Auto Secure Login / Reuse Session)
 * and the session registry. Matching is by **normalized origin** (protocol + hostname +
 * port) so that different paths on the same site reuse the same saved login.
 *
 * No secrets are handled here — only URLs.
 */
import type { SessionProfile } from "./SessionProfile";

/**
 * Normalize a URL to its origin (`protocol//host:port`). Accepts bare hosts
 * (e.g. `example.com`) by assuming `https://`. Returns `undefined` when the input
 * cannot be parsed into a URL.
 */
export function normalizeOrigin(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  const withProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withProtocol).origin;
  } catch {
    return undefined;
  }
}

/** The best origin for a saved profile: its stored `origin`, else derived from `targetUrl`. */
export function profileOrigin(profile: Pick<SessionProfile, "origin" | "targetUrl">): string | undefined {
  return profile.origin ?? normalizeOrigin(profile.targetUrl);
}

/** Whether a saved profile matches a target URL by normalized origin. */
export function sessionMatchesUrl(profile: Pick<SessionProfile, "origin" | "targetUrl">, targetUrl: string): boolean {
  const target = normalizeOrigin(targetUrl);
  if (!target) return false;
  return profileOrigin(profile) === target;
}

/**
 * Pick the best matching ready session for a target URL: same normalized origin,
 * preferring the most recently used, then most recently created.
 */
export function findBestSessionForUrl(profiles: SessionProfile[], targetUrl: string): SessionProfile | undefined {
  const target = normalizeOrigin(targetUrl);
  if (!target) return undefined;
  return profiles
    .filter((p) => p.status === "ready" && profileOrigin(p) === target)
    .sort((a, b) => {
      const aTime = Date.parse(a.lastUsedAt ?? a.createdAt ?? "") || 0;
      const bTime = Date.parse(b.lastUsedAt ?? b.createdAt ?? "") || 0;
      return bTime - aTime;
    })[0];
}
