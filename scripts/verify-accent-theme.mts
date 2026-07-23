// Deterministic unit checks for the accent-color model (src/theme/accentColor.ts) that backs the
// user-selectable application accent. No Electron / DOM — pure color math + validation.
//
// Run: npx tsx scripts/verify-accent-theme.mts
import {
  ACCENT_TOKEN_NAMES,
  DEFAULT_ACCENT_COLOR,
  DEFAULT_ACCENT_SETTINGS,
  GRADIENT_TOKEN_NAMES,
  SPECTER_BLUE,
  SPECTER_BLUE_SETTINGS,
  buildAccentGradient,
  contrastRatio,
  deriveAccentThemeTokens,
  deriveAccentTokens,
  deriveAccentTokensFor,
  gradientReadability,
  hexToRgb,
  isDefaultAccent,
  isValidAccentColor,
  normalizeAccentColor,
  normalizeAccentSettings,
  pickAccentForeground,
  relativeLuminance
} from "../src/theme/accentColor";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// ── 1. Validation & normalization ────────────────────────────────────────────
check("default constant is #7C3AED", DEFAULT_ACCENT_COLOR === "#7C3AED", DEFAULT_ACCENT_COLOR);
check("accepts #RRGGBB", isValidAccentColor("#7C3AED"));
check("accepts bare RRGGBB", isValidAccentColor("7c3aed"));
check("accepts #RGB shorthand", isValidAccentColor("#abc"));
check("rejects empty string", !isValidAccentColor(""));
check("rejects whitespace only", !isValidAccentColor("   "));
check("rejects partial hex", !isValidAccentColor("#12345"));
check("rejects non-hex chars", !isValidAccentColor("#GGGGGG"));
check("rejects rgb() form (hex-only core)", !isValidAccentColor("rgb(1,2,3)"));
check("rejects transparent keyword", !isValidAccentColor("transparent"));
check("rejects null", !isValidAccentColor(null));
check("rejects number", !isValidAccentColor(0xffffff as unknown));

check("normalizes to uppercase #RRGGBB", normalizeAccentColor("#7c3aed") === "#7C3AED");
check("normalizes bare + trims", normalizeAccentColor("  ff00aa ") === "#FF00AA");
check("expands #RGB → #RRGGBB", normalizeAccentColor("#abc") === "#AABBCC");
check("malformed → null (corrupted-value fallback)", normalizeAccentColor("not-a-color") === null);
check("null → null", normalizeAccentColor(null) === null);

// ── 2. Derived token generation ──────────────────────────────────────────────
for (const theme of ["light", "dark"] as const) {
  const tokens = deriveAccentTokens("#3366CC", theme);
  const keys = Object.keys(tokens);
  check(
    `${theme}: emits exactly the ${ACCENT_TOKEN_NAMES.length} accent tokens`,
    keys.length === ACCENT_TOKEN_NAMES.length && ACCENT_TOKEN_NAMES.every((n) => n in tokens),
    keys.join(",")
  );
  check(
    `${theme}: no token is empty`,
    Object.values(tokens).every((v) => typeof v === "string" && v.trim().length > 0)
  );
  check(
    `${theme}: --awkit-accent-rgb is an "r, g, b" triplet`,
    /^\d{1,3}, \d{1,3}, \d{1,3}$/.test(tokens["--awkit-accent-rgb"])
  );
}

// Light keeps the base as the accent (mid-tone → no visibility rescue needed).
{
  const t = deriveAccentTokens("#7C3AED", "light");
  check("light: accent equals base for a mid-tone", t["--awkit-accent"] === "#7C3AED", t["--awkit-accent"]);
  check("light: soft/muted/edge are opaque hex tints", t["--awkit-accent-soft"].startsWith("#"));
}

// Dark uses a brighter step and translucent soft/muted tints.
{
  const base = "#7C3AED";
  const t = deriveAccentTokens(base, "dark");
  const brighter = relativeLuminance(hexToRgb(t["--awkit-accent"])) > relativeLuminance(hexToRgb(base));
  check("dark: accent is brighter than the base", brighter, t["--awkit-accent"]);
  check("dark: soft is an rgba() tint", t["--awkit-accent-soft"].startsWith("rgba("));
  check("dark: muted is an rgba() tint", t["--awkit-accent-muted"].startsWith("rgba("));
}

// deriveAccentThemeTokens returns both variants.
{
  const both = deriveAccentThemeTokens("#22AA55");
  check("both-themes helper returns light + dark", "light" in both && "dark" in both);
}

// ── 3. Readable foreground / contrast safeguards ─────────────────────────────
check("foreground on a very light accent is near-black", pickAccentForeground("#FFEE88") !== "#FFFFFF");
check("foreground on a very dark accent is white", pickAccentForeground("#101033") === "#FFFFFF");
{
  // Default purple must meet WCAG AA (>= 4.5) for its chosen foreground in both themes.
  for (const theme of ["light", "dark"] as const) {
    const t = deriveAccentTokens(DEFAULT_ACCENT_COLOR, theme);
    const ratio = contrastRatio(hexToRgb(t["--awkit-accent"]), hexToRgb(t["--awkit-accent-contrast"]));
    check(`${theme}: default purple foreground meets AA (${ratio.toFixed(2)}:1)`, ratio >= 4.5);
  }
  // The picked foreground is always the higher-contrast of the two options (never unreadable).
  for (const c of ["#7C3AED", "#FF0000", "#00FF00", "#808080", "#123456", "#EEEEEE"]) {
    const fg = pickAccentForeground(c);
    const withPick = contrastRatio(hexToRgb(c), hexToRgb(fg));
    const alt = fg === "#FFFFFF" ? contrastRatio(hexToRgb(c), hexToRgb("#1A1420")) : contrastRatio(hexToRgb(c), hexToRgb("#FFFFFF"));
    check(`foreground for ${c} maximizes contrast (${withPick.toFixed(2)} ≥ ${alt.toFixed(2)})`, withPick >= alt);
  }
}

// ── 4. Visibility rescue for pathological picks ──────────────────────────────
{
  // Near-white accent in light mode gets darkened so it stays visible on a white surface.
  const light = deriveAccentTokens("#FFFFFF", "light");
  const lum = relativeLuminance(hexToRgb(light["--awkit-accent"]));
  check("light: near-white accent is darkened for visibility", lum < 0.9, light["--awkit-accent"]);
  // Near-black accent in dark mode gets lightened so it stays visible on a dark surface.
  const dark = deriveAccentTokens("#000000", "dark");
  const lumD = relativeLuminance(hexToRgb(dark["--awkit-accent"]));
  check("dark: near-black accent is lightened for visibility", lumD > 0.02, dark["--awkit-accent"]);
}

// ── 5. Invalid base falls back to default (never throws) ─────────────────────
{
  const t = deriveAccentTokens("garbage", "light");
  check("invalid base derives from default purple", t["--awkit-accent"] === "#7C3AED", t["--awkit-accent"]);
}

// ── 6. Accent settings: migration, presets, validation ───────────────────────
{
  // Legacy single-color shape migrates to a solid accent.
  const migrated = normalizeAccentSettings({ color: "#FF0000" });
  check("legacy {color} → solid custom", migrated.mode === "solid" && migrated.primaryColor === "#FF0000" && migrated.preset === "custom", JSON.stringify(migrated));
  check("legacy {color:null} → default settings", JSON.stringify(normalizeAccentSettings({ color: null })) === JSON.stringify(DEFAULT_ACCENT_SETTINGS));
  check("garbage input → default settings", JSON.stringify(normalizeAccentSettings("nope")) === JSON.stringify(DEFAULT_ACCENT_SETTINGS));
  check("undefined → default settings", JSON.stringify(normalizeAccentSettings(undefined)) === JSON.stringify(DEFAULT_ACCENT_SETTINGS));

  // Gradient shape + preset detection.
  const grad = normalizeAccentSettings({ mode: "gradient", primaryColor: SPECTER_BLUE.primary, secondaryColor: SPECTER_BLUE.secondary });
  check("gradient pair matching Specter Blue → preset specter-blue", grad.mode === "gradient" && grad.preset === "specter-blue", grad.preset);
  const grad2 = normalizeAccentSettings({ mode: "gradient", primaryColor: "#123456", secondaryColor: "#abcdef" });
  check("custom gradient → preset custom", grad2.preset === "custom");

  // Gradient with a missing/invalid secondary falls back to solid.
  const noSecond = normalizeAccentSettings({ mode: "gradient", primaryColor: "#123456" });
  check("gradient without secondary → solid", noSecond.mode === "solid");

  // Angle clamp to [0,360).
  check("gradient angle 720 → 0", normalizeAccentSettings({ primaryColor: "#123456", gradientAngle: 720 }).gradientAngle === 0);
  check("gradient angle -45 → 315", normalizeAccentSettings({ primaryColor: "#123456", gradientAngle: -45 }).gradientAngle === 315);

  // Invalid primary hex → default.
  check("invalid primary hex → default settings", JSON.stringify(normalizeAccentSettings({ primaryColor: "zzz" })) === JSON.stringify(DEFAULT_ACCENT_SETTINGS));

  check("isDefaultAccent true for default", isDefaultAccent(DEFAULT_ACCENT_SETTINGS));
  check("isDefaultAccent false for custom solid", !isDefaultAccent({ mode: "solid", primaryColor: "#123456", secondaryColor: null, preset: "custom", gradientAngle: 135 }));

  check("Specter Blue preset values", SPECTER_BLUE.primary === "#1D4ED8" && SPECTER_BLUE.secondary === "#38BDF8");
  check("Specter Blue settings are a gradient", SPECTER_BLUE_SETTINGS.mode === "gradient" && SPECTER_BLUE_SETTINGS.preset === "specter-blue");
}

// ── 7. Token sets: solid vs gradient ─────────────────────────────────────────
{
  const solid = deriveAccentTokensFor({ mode: "solid", primaryColor: "#3366CC", secondaryColor: null, preset: "custom", gradientAngle: 135 }, "light");
  check("solid mode emits NO gradient tokens", GRADIENT_TOKEN_NAMES.every((n) => !(n in solid)));
  check("solid mode still emits the solid accent", solid["--awkit-accent"] === "#3366CC");

  for (const theme of ["light", "dark"] as const) {
    const grad = deriveAccentTokensFor(SPECTER_BLUE_SETTINGS, theme);
    check(`${theme}: gradient mode emits every gradient token`, GRADIENT_TOKEN_NAMES.every((n) => typeof grad[n] === "string" && grad[n].length > 0));
    check(`${theme}: gradient mode keeps the solid tokens too (fine controls)`, typeof grad["--awkit-accent"] === "string");
    check(`${theme}: --awkit-accent-gradient is a linear-gradient`, grad["--awkit-accent-gradient"].startsWith("linear-gradient("));
  }
}

// ── 8. Gradient derivation + contrast ────────────────────────────────────────
{
  const g = buildAccentGradient(SPECTER_BLUE.primary, SPECTER_BLUE.secondary, "light", 135);
  check("gradient (text-safe) differs from vivid", g.gradient !== g.vivid);
  check("vivid gradient contains the angle", g.vivid.includes("135deg"));
  check("deep stop is darker than primary", relativeLuminance(hexToRgb(g.deep)) < relativeLuminance(hexToRgb(SPECTER_BLUE.primary)));
  check("Specter Blue on-gradient is white (blue primary)", g.onGradient === "#FFFFFF", g.onGradient);
  check("deep-rgb is a triplet", /^\d{1,3}, \d{1,3}, \d{1,3}$/.test(g.deepRgb));

  // Readability warning: identical colors are flagged; the Specter pair is fine.
  check("Specter Blue pair reads as ok", gradientReadability(SPECTER_BLUE.primary, SPECTER_BLUE.secondary, "light").ok);
  check("near-identical pair warns", !gradientReadability("#3366CC", "#3467CD", "light").ok);
}

const failed = results.filter((r) => !r.pass);
console.log(`\naccent-theme: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.error(`FAILED: ${failed.map((f) => f.name).join("; ")}`);
  process.exit(1);
}
