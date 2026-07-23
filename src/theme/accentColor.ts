// Pure, framework-agnostic accent-color model.
//
// This is the single source of truth for the user-selectable application accent color. It is
// imported by BOTH the main-process settings validator (app/main/uiSettings.ts) and the renderer
// accent-theme layer (app/renderer/state/accentTheme.ts), and it is exercised directly by
// scripts/verify-accent-theme.mts. It therefore has NO DOM / React / Electron / Node imports so it
// stays safe to load in every process (and offline — no dependency is added).
//
// Design note: the app's entire accent is already centralized behind a handful of CSS custom
// properties in app/renderer/styles/global.css (each with a [data-theme="dark"] override). Choosing
// a custom accent = overriding that small set inline on :root. Everything else (the --awkit-purple*
// aliases, --awkit-node-selected-bg, and every rgba(var(--awkit-accent-rgb), …) focus ring) resolves
// through them, so status colors (success/warning/error) are never affected.

/**
 * Canonical default application accent — the Hologram violet used as `--awkit-accent` in the light
 * theme (app/renderer/styles/global.css). A stored `accent.color === null` means "use this default",
 * so a Reset removes the override rather than duplicating this value.
 */
export const DEFAULT_ACCENT_COLOR = "#7C3AED";

export type ThemeMode = "light" | "dark";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * The accent CSS custom properties this feature overrides. Every other accent surface in the
 * stylesheet resolves through these (or the `--awkit-purple*` / `--awkit-node-selected-bg` aliases
 * that point at them), so overriding this set recolors the whole app. Status tokens are excluded on
 * purpose.
 */
export const ACCENT_TOKEN_NAMES = [
  "--awkit-accent",
  "--awkit-accent-hover",
  "--awkit-accent-contrast",
  "--awkit-accent-soft",
  "--awkit-accent-muted",
  "--awkit-lavender-soft",
  "--awkit-edge",
  "--awkit-edge-strong",
  "--awkit-accent-rgb",
  // Canvas connector colors that are the primary accent (idle/loop lines + the selected emphasis).
  // The semantic connector colors (failure=red, success=green, warning=amber, parallel=teal) are NOT
  // here — they must stay semantically distinct. Only overridden for a CUSTOM accent; on reset the
  // override is removed and the stylesheet's exact default violet returns.
  "--awkit-connector-default",
  "--awkit-connector-loop",
  "--awkit-connector-selected"
] as const;

export type AccentTokenName = (typeof ACCENT_TOKEN_NAMES)[number];
export type AccentTokens = Record<AccentTokenName, string>;

/**
 * Gradient CSS variables set only when a two-color gradient accent is active. They are additive to the
 * solid `ACCENT_TOKEN_NAMES` (which still drive fine controls, focus rings, ports), and are removed when
 * switching back to solid. `--awkit-accent-gradient` is text-safe (readable foreground across all stops);
 * `--awkit-accent-gradient-vivid` is the decorative deep→cyan→deep flow (no text on it).
 */
export const GRADIENT_TOKEN_NAMES = [
  "--awkit-accent-gradient",
  "--awkit-accent-gradient-vivid",
  "--awkit-accent-gradient-soft",
  "--awkit-accent-gradient-glow",
  "--awkit-accent-on-gradient",
  "--awkit-accent-deep",
  "--awkit-accent-bright",
  "--awkit-accent-deep-rgb",
  "--awkit-accent-bright-rgb"
] as const;

export type GradientTokenName = (typeof GRADIENT_TOKEN_NAMES)[number];

/** Every accent CSS variable this feature may set (solid + gradient). */
export const ALL_ACCENT_TOKEN_NAMES: readonly string[] = [...ACCENT_TOKEN_NAMES, ...GRADIENT_TOKEN_NAMES];

export type AccentMode = "solid" | "gradient";
export type AccentPreset = "default-purple" | "specter-blue" | "custom";

/**
 * Persisted accent appearance. `primaryColor === null` (solid) means "use the built-in default purple",
 * so a reset removes the override rather than storing a duplicate. In gradient mode both colors are set.
 */
export interface AccentSettings {
  mode: AccentMode;
  primaryColor: string | null;
  secondaryColor: string | null;
  preset: AccentPreset;
  gradientAngle: number;
}

export const DEFAULT_GRADIENT_ANGLE = 135;

/**
 * Built-in "Specter Blue" gradient preset. There is no blue logo asset in the repo to sample (the
 * shipped `specter-logo.svg` is the purple "5b" mark), so these are derived from the brand description:
 * a royal-blue primary flowing through a bright cyan-sky highlight. See docs/ai/DECISIONS.md.
 */
export const SPECTER_BLUE = { primary: "#1D4ED8", secondary: "#38BDF8" } as const;

export const DEFAULT_ACCENT_SETTINGS: AccentSettings = {
  mode: "solid",
  primaryColor: null,
  secondaryColor: null,
  preset: "default-purple",
  gradientAngle: DEFAULT_GRADIENT_ANGLE
};

export const SPECTER_BLUE_SETTINGS: AccentSettings = {
  mode: "gradient",
  primaryColor: SPECTER_BLUE.primary,
  secondaryColor: SPECTER_BLUE.secondary,
  preset: "specter-blue",
  gradientAngle: DEFAULT_GRADIENT_ANGLE
};

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const HEX3 = /^#[0-9a-fA-F]{3}$/;

/** Foreground used on light accents; matches the app's darkest text family (not pure black). */
const NEAR_BLACK = "#1A1420";
const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

/**
 * Normalize any accepted input to canonical `#RRGGBB` uppercase, or `null` when malformed. Accepts
 * `#rgb`, `rgb`, `#rrggbb`, `rrggbb` (case-insensitive, optional leading `#`). Rejects empty /
 * transparent / partial / non-hex values so a bad value can never corrupt the stored setting or a
 * CSS variable.
 */
export function normalizeAccentColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let v = value.trim();
  if (!v) return null;
  if (v[0] !== "#") v = `#${v}`;
  if (HEX3.test(v)) {
    v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  }
  if (!HEX6.test(v)) return null;
  return v.toUpperCase();
}

/** True when `value` is a hex color we can safely store (`#RGB` or `#RRGGBB`). */
export function isValidAccentColor(value: unknown): value is string {
  return normalizeAccentColor(value) !== null;
}

export function hexToRgb(hex: string): Rgb {
  const h = normalizeAccentColor(hex) ?? "#000000";
  return {
    r: parseInt(h.slice(1, 3), 16),
    g: parseInt(h.slice(3, 5), 16),
    b: parseInt(h.slice(5, 7), 16)
  };
}

function clampChannel(x: number): number {
  return Math.max(0, Math.min(255, Math.round(x)));
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const hex = (c: number) => clampChannel(c).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
}

function mix(a: Rgb, b: Rgb, weightB: number): Rgb {
  const w = Math.max(0, Math.min(1, weightB));
  return {
    r: a.r + (b.r - a.r) * w,
    g: a.g + (b.g - a.g) * w,
    b: a.b + (b.b - a.b) * w
  };
}

/** Lighten toward white by `amount` (0..1). */
export function lighten(hex: string, amount: number): string {
  return rgbToHex(mix(hexToRgb(hex), WHITE, amount));
}

/** Darken toward black by `amount` (0..1). */
export function darken(hex: string, amount: number): string {
  return rgbToHex(mix(hexToRgb(hex), BLACK, amount));
}

function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance (0..1). */
export function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * channelLuminance(rgb.r) + 0.7152 * channelLuminance(rgb.g) + 0.0722 * channelLuminance(rgb.b);
}

/** WCAG contrast ratio between two colors (1..21). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lightest = Math.max(la, lb);
  const darkest = Math.min(la, lb);
  return (lightest + 0.05) / (darkest + 0.05);
}

/**
 * Choose the readable foreground (white or near-black) for text/icons drawn on `background`,
 * maximizing WCAG contrast. Guarantees the higher-contrast choice, which meets AA for typical
 * saturated accents and never renders unreadable text on very light or very dark picks.
 */
export function pickAccentForeground(background: string): string {
  const bg = hexToRgb(background);
  const onWhite = contrastRatio(bg, WHITE);
  const onBlack = contrastRatio(bg, hexToRgb(NEAR_BLACK));
  return onWhite >= onBlack ? "#FFFFFF" : NEAR_BLACK;
}

// Approximate surface colors per theme (from global.css --awkit-surface) used to keep the accent
// visible against the background it sits on.
const LIGHT_SURFACE: Rgb = { r: 255, g: 255, b: 255 };
const DARK_SURFACE: Rgb = { r: 18, g: 20, b: 27 };
const MIN_SURFACE_CONTRAST = 1.9;

/**
 * Keep the fill accent visible against the theme's surface: very light picks are darkened for light
 * mode, very dark picks are lightened for dark mode, in bounded steps. Typical mid-tone accents are
 * returned unchanged (they already clear the threshold), so this only rescues pathological choices.
 */
function ensureVisibleAccent(hex: string, theme: ThemeMode): string {
  let out = normalizeAccentColor(hex) ?? DEFAULT_ACCENT_COLOR;
  const surface = theme === "dark" ? DARK_SURFACE : LIGHT_SURFACE;
  for (let i = 0; i < 8 && contrastRatio(hexToRgb(out), surface) < MIN_SURFACE_CONTRAST; i++) {
    out = theme === "dark" ? lighten(out, 0.12) : darken(out, 0.12);
  }
  return out;
}

function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Produce the accent CSS-variable overrides for `base` in a given theme. Derivations mirror the
 * hand-tuned defaults' visual hierarchy: a strong accent for primary actions, softer tints for
 * selected backgrounds, a restrained edge color, and a contrast-checked foreground. Light and dark
 * are derived independently (dark uses a brighter step and translucent soft/muted tints, matching the
 * existing [data-theme="dark"] block).
 */
export function deriveAccentTokens(base: string, theme: ThemeMode): AccentTokens {
  const normalized = normalizeAccentColor(base) ?? DEFAULT_ACCENT_COLOR;

  if (theme === "dark") {
    const accent = ensureVisibleAccent(lighten(normalized, 0.1), "dark");
    const hover = lighten(accent, 0.14);
    const { r, g, b } = hexToRgb(accent);
    return {
      "--awkit-accent": accent,
      "--awkit-accent-hover": hover,
      "--awkit-accent-contrast": pickAccentForeground(accent),
      "--awkit-accent-soft": rgba(accent, 0.15),
      "--awkit-accent-muted": rgba(accent, 0.4),
      "--awkit-lavender-soft": rgba(accent, 0.15),
      "--awkit-edge": darken(normalized, 0.4),
      "--awkit-edge-strong": hover,
      "--awkit-accent-rgb": `${r}, ${g}, ${b}`,
      // Dark surfaces: idle/loop connectors match the brighter hover step; selected reads brighter still.
      "--awkit-connector-default": hover,
      "--awkit-connector-loop": hover,
      "--awkit-connector-selected": lighten(accent, 0.3)
    };
  }

  const accent = ensureVisibleAccent(normalized, "light");
  const { r, g, b } = hexToRgb(accent);
  return {
    "--awkit-accent": accent,
    "--awkit-accent-hover": darken(accent, 0.14),
    "--awkit-accent-contrast": pickAccentForeground(accent),
    "--awkit-accent-soft": lighten(accent, 0.92),
    "--awkit-accent-muted": lighten(accent, 0.55),
    "--awkit-lavender-soft": lighten(accent, 0.94),
    "--awkit-edge": lighten(accent, 0.5),
    "--awkit-edge-strong": accent,
    "--awkit-accent-rgb": `${r}, ${g}, ${b}`,
    // Light surfaces: idle/loop connectors use the base accent; selected reads a touch deeper.
    "--awkit-connector-default": accent,
    "--awkit-connector-loop": accent,
    "--awkit-connector-selected": darken(accent, 0.2)
  };
}

/** Derive both theme variants at once (used to cache tokens for the pre-mount bootstrap script). */
export function deriveAccentThemeTokens(base: string): { light: AccentTokens; dark: AccentTokens } {
  return { light: deriveAccentTokens(base, "light"), dark: deriveAccentTokens(base, "dark") };
}

// ── Gradient accent ──────────────────────────────────────────────────────────

/** Nudge `color` until it reads against `foreground` (white → darken, near-black → lighten). Bounded. */
function makeReadable(color: string, foreground: string, minContrast: number): string {
  const towardDark = foreground === "#FFFFFF";
  let out = normalizeAccentColor(color) ?? DEFAULT_ACCENT_COLOR;
  for (let i = 0; i < 10 && contrastRatio(hexToRgb(out), hexToRgb(foreground)) < minContrast; i++) {
    out = towardDark ? darken(out, 0.1) : lighten(out, 0.1);
  }
  return out;
}

export interface GradientTokens {
  gradient: string;
  vivid: string;
  soft: string;
  glow: string;
  onGradient: string;
  deep: string;
  bright: string;
  deepRgb: string;
  brightRgb: string;
}

/**
 * Build the gradient CSS values from a primary + secondary base for a theme. The vivid variant carries the
 * full deep→primary→bright-cyan→secondary→deep flow (decorative surfaces, no text). The text-safe
 * `gradient` clamps every stop so `onGradient` (white or near-black, chosen on the worst stop) meets a
 * usable contrast — so button labels never become unreadable no matter which pair the user picks.
 */
export function buildAccentGradient(primary: string, secondary: string, theme: ThemeMode, angle: number): GradientTokens {
  const p = normalizeAccentColor(primary) ?? DEFAULT_ACCENT_COLOR;
  const s = normalizeAccentColor(secondary) ?? lighten(p, 0.25);
  const a = Number.isFinite(angle) ? (((angle % 360) + 360) % 360) : DEFAULT_GRADIENT_ANGLE;

  const deep = darken(p, 0.45);
  const brightVivid = lighten(s, theme === "dark" ? 0.12 : 0.06);
  const primaryDeep = darken(p, 0.15);

  const vivid =
    `linear-gradient(${a}deg, ${deep} 0%, ${p} 20%, ${brightVivid} 42%, ${s} 62%, ${primaryDeep} 82%, ${deep} 100%)`;

  // Text-safe: the dominant (primary) color decides white vs near-black, then every stop is nudged until
  // it clears the threshold for that foreground — so a royal-blue→cyan pair stays a blue button with white
  // text (the bright stop auto-darkens) instead of flipping the whole gradient to dark text. Target ≈ 3.4:1.
  const foreground = pickAccentForeground(p);
  const MIN = 3.4;
  const t0 = makeReadable(deep, foreground, MIN);
  const t1 = makeReadable(p, foreground, MIN);
  const t2 = makeReadable(brightVivid, foreground, MIN);
  const t3 = makeReadable(s, foreground, MIN);
  const gradient = `linear-gradient(${a}deg, ${t0} 0%, ${t1} 26%, ${t2} 50%, ${t3} 74%, ${t0} 100%)`;

  const soft = `linear-gradient(${a}deg, ${rgba(p, 0.16)} 0%, ${rgba(s, 0.16)} 100%)`;
  const glow = rgba(brightVivid, theme === "dark" ? 0.5 : 0.4);
  const deepC = hexToRgb(deep);
  const brightC = hexToRgb(brightVivid);

  return {
    gradient,
    vivid,
    soft,
    glow,
    onGradient: foreground,
    deep,
    bright: brightVivid,
    deepRgb: `${deepC.r}, ${deepC.g}, ${deepC.b}`,
    brightRgb: `${brightC.r}, ${brightC.g}, ${brightC.b}`
  };
}

/** Deterministic preset for a color pair, so the Settings UI can highlight the active preset. */
function derivePreset(mode: AccentMode, primaryColor: string | null, secondaryColor: string | null): AccentPreset {
  if (!primaryColor) return "default-purple";
  if (
    mode === "gradient" &&
    primaryColor === SPECTER_BLUE.primary &&
    secondaryColor === SPECTER_BLUE.secondary
  ) {
    return "specter-blue";
  }
  return "custom";
}

/**
 * Sanitize/normalize any stored or partial accent value into a valid `AccentSettings`. Handles the
 * legacy single-color shape (`{ color }`) by migrating it to `{ mode:"solid", primaryColor: color }`.
 * Invalid colors → null, unknown mode/preset → defaults, angle clamped to [0,360). A null primary always
 * collapses to the default-purple solid state (so a corrupt/missing value falls back safely).
 */
export function normalizeAccentSettings(input: unknown): AccentSettings {
  const src: Record<string, unknown> = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const legacyColor = "color" in src && !("primaryColor" in src) ? src.color : undefined;
  const rawPrimary = "primaryColor" in src ? src.primaryColor : legacyColor;
  const primaryColor = typeof rawPrimary === "string" ? normalizeAccentColor(rawPrimary) : null;
  const secondaryColor = typeof src.secondaryColor === "string" ? normalizeAccentColor(src.secondaryColor) : null;
  const gradientAngle =
    typeof src.gradientAngle === "number" && Number.isFinite(src.gradientAngle)
      ? (((src.gradientAngle % 360) + 360) % 360)
      : DEFAULT_GRADIENT_ANGLE;

  if (!primaryColor) {
    return { ...DEFAULT_ACCENT_SETTINGS, gradientAngle };
  }
  // Gradient needs a valid second color; otherwise fall back to a solid accent of the primary.
  let mode: AccentMode = src.mode === "gradient" && secondaryColor ? "gradient" : "solid";
  const preset = derivePreset(mode, primaryColor, secondaryColor);
  return { mode, primaryColor, secondaryColor, preset, gradientAngle };
}

/** True when the accent is the built-in default (no override should be applied). */
export function isDefaultAccent(accent: AccentSettings): boolean {
  return accent.mode === "solid" && !accent.primaryColor;
}

/**
 * The complete set of accent CSS variables to apply for `accent` in a theme. Always includes the solid
 * tokens (from `primaryColor`, or the default purple) so fine controls stay solid; in gradient mode it
 * also includes the gradient tokens. For the default accent this returns the solid default tokens; the
 * DOM layer clears overrides entirely in that case (see `isDefaultAccent`).
 */
export function deriveAccentTokensFor(accent: AccentSettings, theme: ThemeMode): Record<string, string> {
  const primaryBase = accent.primaryColor ?? DEFAULT_ACCENT_COLOR;
  const tokens: Record<string, string> = { ...deriveAccentTokens(primaryBase, theme) };
  if (accent.mode === "gradient") {
    const g = buildAccentGradient(primaryBase, accent.secondaryColor ?? lighten(primaryBase, 0.25), theme, accent.gradientAngle);
    tokens["--awkit-accent-gradient"] = g.gradient;
    tokens["--awkit-accent-gradient-vivid"] = g.vivid;
    tokens["--awkit-accent-gradient-soft"] = g.soft;
    tokens["--awkit-accent-gradient-glow"] = g.glow;
    tokens["--awkit-accent-on-gradient"] = g.onGradient;
    tokens["--awkit-accent-deep"] = g.deep;
    tokens["--awkit-accent-bright"] = g.bright;
    tokens["--awkit-accent-deep-rgb"] = g.deepRgb;
    tokens["--awkit-accent-bright-rgb"] = g.brightRgb;
  }
  return tokens;
}

/** Derive both theme variants of the full accent token set (used for the bootstrap cache). */
export function deriveAccentSettingsThemeTokens(accent: AccentSettings): {
  light: Record<string, string>;
  dark: Record<string, string>;
} {
  return { light: deriveAccentTokensFor(accent, "light"), dark: deriveAccentTokensFor(accent, "dark") };
}

/**
 * Readability check for a gradient pair, surfaced as a UI warning. `ok=false` when the derived text-safe
 * gradient had to shift stops substantially to stay legible (i.e. the raw pair is low-contrast).
 */
export function gradientReadability(primary: string, secondary: string, _theme: ThemeMode): { ok: boolean; foreground: string } {
  const p = normalizeAccentColor(primary) ?? DEFAULT_ACCENT_COLOR;
  const s = normalizeAccentColor(secondary) ?? lighten(p, 0.25);
  const foreground = pickAccentForeground(p);
  // Warn when the two colors are nearly indistinguishable (the gradient reads as a flat fill). Text
  // legibility itself is always guaranteed by the text-safe stop clamping in buildAccentGradient.
  const ok = contrastRatio(hexToRgb(p), hexToRgb(s)) >= 1.2;
  return { ok, foreground };
}
