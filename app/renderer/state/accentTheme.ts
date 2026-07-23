// Renderer DOM layer for the user-selectable accent (solid or two-color gradient). Thin wrapper over the
// pure model in @src/theme/accentColor — it owns the two side effects: writing inline CSS custom
// properties (+ a `data-accent-mode` attribute) on an element, and caching the derived tokens in
// localStorage for the pre-mount bootstrap script in index.html (no default-accent flash on startup).

import {
  ALL_ACCENT_TOKEN_NAMES,
  DEFAULT_ACCENT_SETTINGS,
  deriveAccentSettingsThemeTokens,
  deriveAccentTokensFor,
  isDefaultAccent,
  normalizeAccentSettings,
  type AccentSettings,
  type ThemeMode
} from "@src/theme/accentColor";

/**
 * localStorage key holding the derived light+dark accent tokens (+ mode) for a custom accent. Read by the
 * inline bootstrap script in app/renderer/index.html BEFORE React mounts to prevent an accent flash.
 * Absent (or removed) means "default accent" — the stylesheet's built-in purple stands.
 */
export const ACCENT_CACHE_KEY = "awkit-accent-tokens";

interface CachedAccent {
  accent: AccentSettings;
  mode: AccentSettings["mode"];
  light: Record<string, string>;
  dark: Record<string, string>;
}

/**
 * Apply an accent to `el` for the given theme. Inline custom properties win over the stylesheet's
 * `:root`/`[data-theme]` rules, so this recolors the whole app when applied to `document.documentElement`.
 * The `data-accent-mode` attribute drives the `[data-accent-mode="gradient"]` CSS that layers the gradient
 * onto high-value surfaces. The default accent clears every override and returns to solid.
 */
export function applyAccent(el: HTMLElement, accent: AccentSettings, theme: ThemeMode): void {
  if (isDefaultAccent(accent)) {
    clearAccentOverrides(el);
    return;
  }
  const tokens = deriveAccentTokensFor(accent, theme);
  // Remove any stale tokens (e.g. gradient vars left over when switching to a solid accent) then set.
  for (const name of ALL_ACCENT_TOKEN_NAMES) {
    if (!(name in tokens)) el.style.removeProperty(name);
  }
  for (const [name, value] of Object.entries(tokens)) {
    el.style.setProperty(name, value);
  }
  el.dataset.accentMode = accent.mode;
}

/** Remove every inline accent override so the stylesheet default (solid purple) applies again. */
export function clearAccentOverrides(el: HTMLElement): void {
  for (const name of ALL_ACCENT_TOKEN_NAMES) {
    el.style.removeProperty(name);
  }
  el.dataset.accentMode = "solid";
}

/** Persist (or clear) the derived-token cache used by the pre-mount bootstrap script. Never throws. */
export function writeAccentCache(accent: AccentSettings): void {
  try {
    if (isDefaultAccent(accent)) {
      window.localStorage.removeItem(ACCENT_CACHE_KEY);
      return;
    }
    const { light, dark } = deriveAccentSettingsThemeTokens(accent);
    const payload: CachedAccent = { accent, mode: accent.mode, light, dark };
    window.localStorage.setItem(ACCENT_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Storage unavailable — non-fatal. The authoritative store still applies on the next load.
  }
}

/** Read the cached accent, used to seed renderer state before the settings load resolves. */
export function readCachedAccent(): AccentSettings {
  try {
    const raw = window.localStorage.getItem(ACCENT_CACHE_KEY);
    if (!raw) return DEFAULT_ACCENT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<CachedAccent>;
    return normalizeAccentSettings(parsed.accent);
  } catch {
    return DEFAULT_ACCENT_SETTINGS;
  }
}
