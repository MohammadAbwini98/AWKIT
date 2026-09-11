// Design-system token verifier (static CSS contract + real-Electron theme proof).
//
// What regression makes this fail?
//   • STATIC — a CSS rule body references an undefined custom property (the --space-6 class of bug
//     where a declaration silently drops), paints a color literal outside the token blocks instead
//     of resolving through a token (drift back to hardcoded colors), or the categorical chart
//     palette loses a step / duplicates a value inside one theme.
//   • LIVE — the real app boots and the token spine this verifier pins is absent or unresolved at
//     runtime in EITHER theme (the --awkit-shadow-lg / status-rgb / --font-mono class of bug where
//     the token exists in the file but never reaches the document), the Sessions status pill loses
//     its background/border to an invalid var() concatenation (the `var(--x)1a` bug), or the chart
//     tokens do not switch values between light and dark.
//
// Run: node scripts/verify-design-tokens.mjs   (GUI half requires `npm run build`)
import { _electron as electron } from "playwright";
import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isolatedLaunchEnv, resolveMainWindow, signInFirstRun } from "./lib/gui-verify-harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail: detail ? String(detail) : "" });
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Part A — static contract on app/renderer/styles/global.css
// ─────────────────────────────────────────────────────────────────────────────
const css = readFileSync(path.join(root, "app/renderer/styles/global.css"), "utf8");
const lines = css.split(/\r?\n/);

// A1. Every var(--x) referenced must be defined in this file, unless runtime-provided.
// Runtime-provided names are set inline by src/theme/accentColor.ts (gradient mode),
// DesignerCanvasLayout.tsx, or per-element canvas positioning — never by this stylesheet.
const RUNTIME_PROVIDED = new Set([
  "--tx",
  "--ty",
  "--awkit-action-bar-h",
  "--awkit-accent-gradient",
  "--awkit-accent-gradient-vivid",
  "--awkit-accent-gradient-soft",
  "--awkit-accent-gradient-glow",
  "--awkit-accent-on-gradient",
  "--awkit-accent-deep",
  "--awkit-accent-bright",
  "--awkit-accent-deep-rgb",
  "--awkit-accent-bright-rgb"
]);
const defined = new Set();
for (const m of css.matchAll(/(^|\s)(--[a-zA-Z0-9-]+)\s*:/g)) defined.add(m[2]);
const referenced = new Map(); // name -> first referencing line number
for (let i = 0; i < lines.length; i++) {
  for (const m of lines[i].matchAll(/var\((--[a-zA-Z0-9-]+)/g)) {
    if (!referenced.has(m[1])) referenced.set(m[1], i + 1);
  }
}
const unresolved = [...referenced.entries()]
  .filter(([name]) => !defined.has(name) && !RUNTIME_PROVIDED.has(name))
  .map(([name, line]) => `${name} (line ${line})`);
check(
  "static: every referenced custom property is defined or runtime-provided",
  unresolved.length === 0,
  unresolved.join(", ")
);

// A2. No color literals in rule bodies — every painted color must resolve through a token.
// Custom-property definition lines (the token blocks themselves) are excluded by construction.
// Bounded, documented exceptions: the avatar identity-art palette (design-system.md allows
// gradient decoration only for AI affordances and the existing profile avatar).
// Block comments are stripped first (they legitimately cite old hex values), and rgba(var(--x), a)
// forms count as token-resolved, not literals.
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
const scanLines = cssNoComments.split(/\r?\n/);
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(/;
const DECLARATION = /^\s*[a-zA-Z-]+\s*:/;

// Precompute the line ranges of the bounded identity-art rule (.awkit-avatar / .awkit-avatar.tone-N):
// from each selector occurrence to the matching closing brace. Declarations inside those ranges are
// the documented exception (design-system.md permits the existing profile avatar's gradient art).
const exempt = new Set();
{
  const flat = scanLines.join("\n");
  for (const m of flat.matchAll(/\.awkit-avatar(\.tone-[0-9]+)?/g)) {
    const open = flat.indexOf("{", m.index);
    if (open < 0) continue;
    let depth = 0;
    let close = -1;
    for (let i = open; i < flat.length; i++) {
      if (flat[i] === "{") depth++;
      else if (flat[i] === "}") {
        depth--;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close < 0) continue;
    const startLine = flat.slice(0, m.index).split("\n").length - 1;
    const endLine = flat.slice(0, close).split("\n").length - 1;
    for (let l = startLine; l <= endLine; l++) exempt.add(l);
  }
}

const literalOffenders = [];
for (let i = 0; i < scanLines.length; i++) {
  const line = scanLines[i];
  if (!DECLARATION.test(line)) continue; // selectors, blank lines, @media preludes
  if (/^\s*--/.test(line)) continue; // token definitions (the token blocks themselves)
  if (exempt.has(i)) continue;
  if (!COLOR_LITERAL.test(line)) continue;
  // rgba(var(--token), a) resolves through a token — drop those spans before judging the line.
  const stripped = line.replace(/rgba?\(\s*var\([^)]*\)[^)]*\)/g, "");
  if (!COLOR_LITERAL.test(stripped)) continue;
  // Only declarations that actually paint color; a bare multi-line selector does not.
  if (!/(color|background|border|shadow|stroke|fill|outline|scrollbar|tint|scrim|overlay|palette|gradient|ink)/i.test(line)) continue;
  literalOffenders.push(`line ${i + 1}: ${line.trim().slice(0, 80)}`);
}
check(
  "static: no color literals in rule bodies (tokens only; avatar identity art bounded)",
  literalOffenders.length === 0,
  literalOffenders.slice(0, 5).join(" | ")
);

// A3. Categorical chart palette: 14 steps, defined in BOTH theme blocks, distinct within a theme.
// NOTE: the marker is brace-anchored — the bare attribute selector also appears in explanatory
// comments before the token blocks, and an unanchored indexOf() resolves the WRONG block.
function themeBlock(marker) {
  const start = cssNoComments.indexOf(`${marker} {`);
  if (start < 0) return "";
  const open = cssNoComments.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < cssNoComments.length; i++) {
    if (cssNoComments[i] === "{") depth++;
    else if (cssNoComments[i] === "}") {
      depth--;
      if (depth === 0) return cssNoComments.slice(open, i);
    }
  }
  return "";
}
function chartValues(block) {
  const out = new Map();
  for (let n = 1; n <= 14; n++) {
    const m = block.match(new RegExp(`--awkit-chart-${n}:\\s*([^;]+);`));
    if (m) out.set(n, m[1].trim());
  }
  return out;
}
const lightChart = chartValues(themeBlock('[data-theme="light"]'));
const darkChart = chartValues(themeBlock('[data-theme="dark"]'));
check("static: chart series 1-14 defined in light theme", lightChart.size === 14, `${lightChart.size}/14`);
check("static: chart series 1-14 defined in dark theme", darkChart.size === 14, `${darkChart.size}/14`);
const dupLight = new Set([...lightChart.values()].filter((v, _, a) => a.indexOf(v) !== a.lastIndexOf(v)));
const dupDark = new Set([...darkChart.values()].filter((v, _, a) => a.indexOf(v) !== a.lastIndexOf(v)));
check("static: chart series values distinct within light theme", dupLight.size === 0, [...dupLight].join(","));
check("static: chart series values distinct within dark theme", dupDark.size === 0, [...dupDark].join(","));
check(
  "static: chart series values differ between themes (theme-adaptive palette)",
  lightChart.size === 14 && darkChart.size === 14 && [...lightChart.keys()].every((n) => lightChart.get(n) !== darkChart.get(n))
);

// A4. Status rgb triplets + shared spine tokens exist in both themes (undefined-token regression).
for (const token of ["--awkit-danger-rgb", "--awkit-success-rgb", "--awkit-accent-rgb", "--awkit-shadow-lg", "--awkit-shadow-soft", "--awkit-focus-ring"]) {
  const inLight = new RegExp(String.raw`${token}\s*:`).test(themeBlock('[data-theme="light"]'));
  const inDark = new RegExp(String.raw`${token}\s*:`).test(themeBlock('[data-theme="dark"]'));
  check(`static: ${token} defined in both themes`, inLight && inDark, `light=${inLight} dark=${inDark}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Part B — real-Electron proof (light AND dark)
// ─────────────────────────────────────────────────────────────────────────────
const { env, dataRoot, cleanup } = isolatedLaunchEnv("awkit-design-tokens");
const userDataDir = path.join(dataRoot, "Roaming", "SpecterStudio");

// Seed one READY session profile so the Sessions page renders a real status pill. The profile
// directory must exist or SessionCaptureService flips the status to "error" on list().
const profilesRoot = path.join(dataRoot, "SpecterStudio", "profiles");
const profileDir = path.join(profilesRoot, "verify-seed-profile");
mkdirSync(path.join(profileDir, "Default"), { recursive: true });
writeFileSync(
  path.join(profilesRoot, "session-profiles.json"),
  JSON.stringify([
    {
      id: "verify-seed-profile",
      name: "Design Token Verifier Session",
      profileDir,
      targetUrl: "https://example.test/login",
      origin: "https://example.test",
      source: "manual",
      createdAt: new Date().toISOString(),
      status: "ready"
    }
  ], null, 2),
  "utf8"
);

let app;
try {
  app = await electron.launch({ args: [root, `--user-data-dir=${userDataDir}`], cwd: root, env });
  const win = await resolveMainWindow(app);
  const consoleErrors = [];
  win.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  await win.waitForLoadState("domcontentloaded");
  await signInFirstRun(win);
  await win.waitForTimeout(300);

  const readVar = (name) =>
    win.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
  const dataTheme = () => win.evaluate(() => document.documentElement.dataset.theme || "");

  async function navTo(label) {
    await win.evaluate((lbl) => {
      const items = [...document.querySelectorAll("button.nav-item")];
      const target = items.find((b) => (b.textContent || "").trim() === lbl || b.getAttribute("title") === lbl);
      target?.click();
    }, label);
    await win.waitForTimeout(500);
  }

  // B1. Live light theme: the spine resolves on the real document.
  check("live: light theme active after sign-in", (await dataTheme()) === "light", await dataTheme());
  for (const [token, expected] of [
    ["--awkit-danger-rgb", "220, 59, 59"],
    ["--awkit-success-rgb", "20, 164, 108"],
    ["--awkit-shadow-lg", "0 20px 60px rgba(16, 24, 40, 0.35)"],
    ["--font-mono", "ui-monospace"]
  ]) {
    const v = await readVar(token);
    check(`live: ${token} resolves in light theme`, v.startsWith(expected), v);
  }
  const lightChart1 = await readVar("--awkit-chart-1");
  check("live: chart series token reaches the document (light)", lightChart1 === "#3563f8", lightChart1);

  // B2. Sessions page — the seeded ready profile renders a real status pill whose background and
  // border survive. The `var(--x)1a` regression dropped BOTH declarations silently; a resolved,
  // non-transparent background proves the pill paints the soft status fill.
  await navTo("Sessions");
  await win.waitForSelector(".sessions-table .state-pill", { timeout: 15000 });
  const pill = win.locator(".sessions-table .state-pill").first();
  const pillPaint = await pill.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, border: cs.borderTopColor, text: (el.textContent || "").trim() };
  });
  const bgAlphaMatch = /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*([\d.]+))?\)/.exec(pillPaint.bg);
  const bgAlpha = bgAlphaMatch ? (bgAlphaMatch[1] === undefined ? 1 : parseFloat(bgAlphaMatch[1])) : 0;
  check("live: session status pill text renders", pillPaint.text === "Ready", pillPaint.text);
  check("live: session status pill background paints (soft status fill)", bgAlpha > 0, pillPaint.bg);
  check("live: session status pill border paints (muted status border)", !/rgba\(0, 0, 0, 0\)/.test(pillPaint.border), pillPaint.border);

  // B3. Switch appearance to dark via the real Settings control, then re-prove the same spine.
  await navTo("Settings");
  await win.waitForSelector(".settings-appearance-row select", { timeout: 15000 });
  await win.locator(".settings-appearance-row select").selectOption("dark");
  await win.waitForTimeout(500);
  check("live: dark theme applied via Settings appearance control", (await dataTheme()) === "dark", await dataTheme());
  for (const [token, expected] of [
    ["--awkit-danger-rgb", "248, 113, 113"],
    ["--awkit-success-rgb", "52, 211, 153"],
    ["--awkit-shadow-lg", "0 20px 60px rgba(0, 0, 0, 0.55)"]
  ]) {
    const v = await readVar(token);
    check(`live: ${token} resolves in dark theme`, v.startsWith(expected), v);
  }
  const darkChart1 = await readVar("--awkit-chart-1");
  check("live: chart series switches with theme", darkChart1 === "#7d9bff" && darkChart1 !== lightChart1, `${lightChart1} → ${darkChart1}`);

  // B4. The pill must still paint in dark mode (dark soft fill is translucent — alpha must be > 0).
  await navTo("Sessions");
  await win.waitForSelector(".sessions-table .state-pill", { timeout: 15000 });
  const pillDark = await win.locator(".sessions-table .state-pill").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  const darkAlphaMatch = /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*([\d.]+))?\)/.exec(pillDark);
  const darkAlpha = darkAlphaMatch ? (darkAlphaMatch[1] === undefined ? 1 : parseFloat(darkAlphaMatch[1])) : 0;
  check("live: session status pill background paints in dark theme", darkAlpha > 0, pillDark);

  check("live: no renderer console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

  // Restore appearance to light so nothing persisted by the verifier leaks into later suites.
  await navTo("Settings");
  await win.locator(".settings-appearance-row select").selectOption("light").catch(() => {});
  await win.waitForTimeout(300);
} finally {
  try {
    await app?.close();
  } catch {
    /* already closed */
  }
  cleanup();
}

const pass = results.filter((r) => r.pass).length;
const fail = results.length - pass;
console.log(`\nDesign-system tokens: ${pass}/${results.length} checks passed${fail ? ` — ${fail} FAILED` : ""}`);
const evidenceDir = path.join(root, "test-artifacts", "design-tokens");
mkdirSync(evidenceDir, { recursive: true });
writeFileSync(path.join(evidenceDir, "results.json"), JSON.stringify({ pass, fail, results }, null, 2));
if (fail) process.exit(1);
