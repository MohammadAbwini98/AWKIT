# 02 — Design tokens

Single source: `app/renderer/styles/global.css` (13,325 lines). Runtime accent override:
`src/theme/accentColor.ts`.

This is the mapping surface. **A new design system is applied primarily by supplying new values for
these token names.** Consumers read tokens; they never carry literals.

---

## Document base — `:root` (lines 1–12)

```css
color: var(--awkit-text);
background: var(--awkit-bg);
color-scheme: light;
font-family: var(--font-sans);
font-synthesis: none;
text-rendering: optimizeLegibility;
font-optical-sizing: auto;
```

Stylesheet comment: *"Inter-first stack per the approved design system … there is no `@font-face`,
no webfont download and no remote `@import`, so this stays offline-safe."*

```css
* { box-sizing: border-box }
html, body, #root { height: 100%; overflow: hidden }
body { margin: 0; min-width: 0 }
```

---

## 1. Primitives (lines 30–101) — theme-independent

### Spacing

```css
--space-1: 4px;  --space-2: 8px;  --space-3: 12px;
--space-4: 16px; --space-4h: 20px; --space-5: 24px;
```

Plus back-compat aliases `--awkit-space-1 … --awkit-space-6`, mapped **by value, not by index**
(`--awkit-space-5 = 20px`, `--awkit-space-6 = 24px`). The stylesheet says: *do not add new uses.*

### Radius

```css
--radius-2xs: 6px;  --radius-xs: 8px;  --radius-sm: 8px;  --radius-md: 12px;
--radius-lg: 16px;  --radius-xl: 16px; --radius-pill: 999px;
```

**No radius above 16px** except the pill. This is a stated ceiling, not an accident.

### Typography

```css
--font-sans: Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
--font-mono: ui-monospace, "Cascadia Mono", "Segoe UI Mono", Consolas, Menlo, monospace;

--weight-regular: 400;  --weight-medium: 500;  --weight-semibold: 600;
```

| Step | Size | Line height | Tracking |
|---|---|---|---|
| `--text-2xs` | `.625rem` (10px) | `--leading-2xs: 1.4` | `--tracking-2xs: .02em` |
| `--text-xs` | `.75rem` (12px) | `--leading-xs: 1.45` | `--tracking-xs: .01em` |
| `--text-sm` | `.8125rem` (13px) | `--leading-sm: 1.5` | `--tracking-sm: 0` |
| `--text-base` | `.875rem` (14px) | `--leading-base: 1.5` | `--tracking-base: 0` |
| `--text-md` | `.9375rem` (15px) | `--leading-md: 1.45` | `--tracking-md: 0` |
| `--text-lg` | `1.0625rem` (17px) | `--leading-lg: 1.35` | `--tracking-lg: -.01em` |
| `--text-xl` | `1.375rem` (22px) | `--leading-xl: 1.25` | `--tracking-xl: -.015em` |
| `--text-2xl` | `1.75rem` (28px) | `--leading-2xl: 1.15` | `--tracking-2xl: -.02em` |

Note there is **no weight above 600** and the base body size is **14px** — this is a dense desktop
tool, not a web page. Only three weights exist; a redesign that needs a fourth must add it as a token.

### Shell metrics

```css
--titlebar-height: 36px;
--header-height:   64px;
--status-height:   32px;
--shell-chrome: calc(var(--titlebar-height) + var(--header-height) + var(--status-height));
```

---

## 2. Light theme — `:root, [data-theme="light"]` (lines 108–286)

### Brand ramp

```
--brand-50:#f5f3ff  …  --brand-600:#7c3aed  …  --brand-900:#4c1d95
```

### Surfaces

```css
--awkit-bg:            #f4f5f7;
--awkit-surface:       #ffffff;
--awkit-surface-soft:  #f9fafb;
--awkit-surface-raised:#ffffff;
--awkit-surface-inset: #f3f4f6;
--awkit-border:        #e5e7eb;
--awkit-border-strong: #d1d5db;
--awkit-divider:       #f3f4f6;
--awkit-hover-surface: #f9fafb;
```

> Stylesheet comment: *"Violet is ACCENT ONLY and must never come back as a canvas, surface or
> border color … which is what made the whole app read as a purple wash."*

### Text

```css
--awkit-text:        #111827;   /* primary   */
--awkit-text-muted:  #4b5563;   /* secondary */
--awkit-text-subtle: #6b7280;   /* tertiary  */
```

### Accent (runtime-overridable — see § 6)

```css
--awkit-accent:          #7c3aed;
--awkit-accent-hover:    #6d28d9;
--awkit-accent-contrast: #ffffff;
--awkit-accent-soft:     #f5f3ff;
--awkit-accent-muted:    #c4b5fd;
--awkit-lavender-soft:   #f5f3ff;
```

> Comment: *"runtime-overridden by `src/theme/accentColor.ts` … Never hardcode a literal in a
> CONSUMER."*

### Data-viz base

```css
--awkit-blue:      #3b82f6;
--awkit-blue-deep: #2563eb;
```

### Status — base / text / soft / muted

| Status | base | text-safe | soft | muted |
|---|---|---|---|---|
| success | `#14a46c` | `--awkit-success-text: #15803d` | `#e7f7ef` | `#a9e7ce` |
| warning | `#c47a08` | — | `#fcf1e2` | `#f5cf9b` |
| danger | `#dc3b3b` | — | `#fdeeec` | `#f5b5ae` |
| info | `#3b82f6` | — | `#eaf1fe` | `#bfdbfe` |
| neutral | — | — | `--awkit-neutral-soft: #f3f4f6` | — |

> **Accessibility note carried in the source:** `--awkit-success` is **3.20:1** on white, below the
> WCAG AA 4.5:1 threshold for text — which is exactly why `--awkit-success-text` exists. Keep both.

Gauge bands exist for `normal` / `warning` / `high`.

### Canvas

```css
--awkit-bg-canvas:         #f4f5f7;
--awkit-canvas-dot:        #c4c9d2;              /* SRS-CANVAS-UX-001 §3.4 */
--awkit-node-surface:      …
--awkit-node-border:       …
--awkit-node-selected-bg:  var(--awkit-lavender-soft);
--awkit-edge:              #c9b8f5;
--awkit-edge-strong:       var(--awkit-accent);
```

### Chart series — `--awkit-chart-1 … --awkit-chart-14`

Order matches `CATEGORY_COLORS` in `pages/ReportsFailures.tsx`. **Series tokens are assigned by
DATA category, never by state** — a category keeps its colour across every chart in the product.

| # | Colour | Category |
|---|---|---|
| 1 | `#3563f8` | navigation |
| 2 | `#5b3e91` | selector |
| 3 | `#b97a1a` | timeout |
| 4 | `#0b1ee6` | assertion |
| 5 | `#c03434` | browser-crash |
| 6 | `#c85a54` | context-closed |
| 7 | `#69587e` | profile-lock |
| 8 | `#8a6d3b` | session-expired |
| 9 | `#1f8a4c` | auth-handoff-required |
| 10 | `#2a9d8f` | network |
| 11 | `#457b9d` | download-upload |
| 12 | `#7048a8` | data-binding |
| 13 | `#8a8a8a` | cancelled |
| 14 | `#b0b0b0` | unknown |

### RGB triples (for `rgba()` composition)

```css
--awkit-accent-rgb:  124, 58, 237;
--awkit-success-rgb: 20, 164, 108;
--awkit-danger-rgb:  220, 59, 59;
--awkit-shadow-rgb:  16, 24, 40;
```

### Material / translucency

```css
--awkit-glass:      rgba(255,255,255,0.72);
--awkit-glass-blur: blur(20px) saturate(180%);
--awkit-overlay:    …
--awkit-scrim:      rgba(16,24,40,0.4);
```

An accessibility fallback block for glass surfaces exists at line ~10161.

### Radius aliases

`--awkit-radius-sm`, `-md`, `-card`, `-panel`, `-pill`.

### Elevation

`--awkit-shadow-soft`, `-card`, `-float`, `-hover`, `-node`, `-node-hover`, `-panel`, `-lg`.

### Focus

```css
--awkit-focus-ring: 0 0 0 2px var(--awkit-surface),
                    0 0 0 4px rgba(var(--awkit-accent-rgb), 0.7);
```

Two rings: an inner surface-coloured spacer so the outer ring reads on any background. It **must**
resolve through `--awkit-accent-rgb` so a user-chosen accent keeps a visible focus ring.

### Motion

```css
--awkit-dur-press:  90ms;    --awkit-dur-fast:  120ms;   --awkit-dur-med:   180ms;
--awkit-dur-panel: 240ms;    --awkit-dur-slow:  260ms;   --awkit-dur-modal: 300ms;
--awkit-dur-layout:350ms;    --awkit-delay-toolbar: 150ms;

--awkit-ease-out:     cubic-bezier(.22, 1, .36, 1);
--awkit-ease-in-out:  cubic-bezier(.77, 0, .175, 1);
--awkit-ease-drawer:  cubic-bezier(.32, .72, 0, 1);
--awkit-ease-spring:  cubic-bezier(.34, 1.4, .64, 1);
```

`--awkit-ease-spring` approximates the node spring (380/30) and menu spring (420/32). The source
notes it *"must still be neutralised under reduced motion."*

Aliases: `--awkit-motion-fast`, `-base`, `-slow`, `-ease`.

### Z-layers

```
panel 20 · toolbar 30 · drawer 40 · modal 50 · toast 60
```

---

## 3. Dark theme — `[data-theme="dark"]` (lines 288–389)

`color-scheme: dark`. A complete independent palette, not a filter.

```css
--awkit-bg:             #0e1016;
--awkit-surface:        #12141b;
--awkit-surface-soft:   #171a22;
--awkit-surface-raised: #1b1f29;
--awkit-surface-inset:  #100f15;

--awkit-border:         rgba(255,255,255,.10);
--awkit-border-strong:  rgba(255,255,255,.16);
--awkit-divider:        rgba(255,255,255,.05);
--awkit-hover-surface:  rgba(255,255,255,.05);

--awkit-text:           #f3f4f6;
--awkit-text-muted:     #d1d5db;
--awkit-text-subtle:    #9ca3af;

--awkit-accent:          #8b5cf6;
--awkit-accent-hover:    #a78bfa;
--awkit-accent-contrast: #ffffff;
--awkit-accent-soft:     rgba(139,92,246,.15);
--awkit-lavender-soft:   rgba(139,92,246,.15);
--awkit-accent-muted:    rgba(139,92,246,.40);

--awkit-blue: #60a5fa;   --awkit-blue-deep: #3b82f6;
--awkit-success: #34d399;  --awkit-success-text: #86efac;
--awkit-warning: #fbbf24;
--awkit-danger:  #f87171;
--awkit-info:    #60a5fa;
--awkit-neutral-soft: rgba(255,255,255,.06);

--awkit-bg-canvas:   #0e1016;
--awkit-canvas-dot:  #2c3140;
--awkit-edge:        #4c3a80;
--awkit-edge-strong: #a78bfa;

--awkit-glass:   rgba(22,21,28,.62);
--awkit-overlay: rgba(0,0,0,.6);
--awkit-scrim:   rgba(0,0,0,.6);
```

Dark carries its **own 14-step chart ramp** (same category order):

```
#7d9bff  #a88ce0  #e0a548  #6f8cff  #ef8080  #f0a09a  #a998c4
#cfa86e  #57c78d  #5fc4b4  #7fa9c9  #a07fe0  #9a9aa0  #b8b8bd
```

Elevation is a **black-ink ladder** rather than the light theme's soft grey. Focus-ring formula is
identical.

---

## 4. Connector + canvas motion tokens (lines 9543–9571)

| Token | Light | Dark |
|---|---|---|
| `--awkit-connector-default` | `#7c3aed` | `#a78bfa` |
| `--awkit-connector-selected` | `#6b21c8` | `#c4b5fd` |
| `--awkit-connector-failure` | `#d93f45` | `#f87171` |
| `--awkit-connector-success` | `#35b85f` | `#34d399` |
| `--awkit-connector-warning` | `#d99017` | `#fbbf24` |
| `--awkit-connector-loop` | `#7c3aed` | `#a78bfa` |
| `--awkit-connector-parallel` | `#0ea5a4` | `#2dd4bf` |

```css
--awkit-loop-flow-duration:   1800ms;
--awkit-orbit-duration:       2000ms;
--awkit-exit-halo-duration:   2200ms;
--awkit-exit-control-size:    calc(var(--space-5) + var(--space-2));   /* 32px */
--awkit-exit-control-label-offset: …;
--awkit-drawer-width:         440px;
--awkit-motion-panel:         var(--awkit-dur-panel);
```

These animate continuously on the canvas while a flow runs, so they carry a real perceptual and
performance cost. Treat them as first-class in a redesign, and confirm they are neutralised under
`prefers-reduced-motion`.

---

## 5. Gradient accent mode (lines 12952–12973)

Scoped under `:root[data-accent-mode="gradient"]`. Deliberately **narrow** — fine controls stay
solid; only high-emphasis surfaces take a gradient.

```css
.toolbar-button.primary:not(:disabled) {
  background: var(--awkit-accent-gradient,
              linear-gradient(135deg, var(--awkit-accent-hover), var(--awkit-accent)));
  border-color: transparent;
  color: var(--awkit-accent-on-gradient, var(--awkit-accent-contrast));
}
.toolbar-button.primary:not(:disabled):hover  { filter: brightness(1.06) }
.toolbar-button.primary:not(:disabled):active { filter: brightness(0.95) }

.nav-item.active {
  background: var(--awkit-accent-gradient-soft, var(--awkit-lavender-soft));
}

.action-flow-node.selected,
.scenario-flow-node.selected,
.awkit-step-node.is-selected {
  box-shadow: 0 0 0 2px var(--awkit-accent-bright, var(--awkit-accent)),
              0 0 18px 2px rgba(var(--awkit-accent-deep-rgb, var(--awkit-accent-rgb)), 0.4);
}
```

Same block also carries the custom-logo layout:

```css
.nav-workspace.has-custom-logo {
  gap: 0; justify-content: center;
  padding: var(--space-2) var(--space-2) var(--space-1);
}
.nav-workspace-logo-full { display: block; height: 44px; object-fit: contain }
```

---

## 6. Runtime accent override — `src/theme/accentColor.ts`

This file is the **authority for accent tokens** and lives outside the renderer. It writes inline
custom properties onto `<html>`, layered over the stylesheet defaults, whenever the user changes the
accent in Settings › Appearance.

```ts
export const DEFAULT_ACCENT_COLOR = "#7C3AED";
export const DEFAULT_GRADIENT_ANGLE = 135;
export const SPECTER_BLUE = { primary: "#1D4ED8", secondary: "#38BDF8" } as const;

export type AccentMode   = "solid" | "gradient";
export type AccentPreset = "default-purple" | "specter-blue" | "custom";
```

### Tokens overwritten at runtime

`ACCENT_TOKEN_NAMES` (12):

```
--awkit-accent            --awkit-accent-hover      --awkit-accent-contrast
--awkit-accent-soft       --awkit-accent-muted      --awkit-lavender-soft
--awkit-edge              --awkit-edge-strong       --awkit-accent-rgb
--awkit-connector-default --awkit-connector-loop    --awkit-connector-selected
```

`GRADIENT_TOKEN_NAMES` (9):

```
--awkit-accent-gradient        --awkit-accent-gradient-vivid  --awkit-accent-gradient-soft
--awkit-accent-gradient-glow   --awkit-accent-on-gradient     --awkit-accent-deep
--awkit-accent-bright          --awkit-accent-deep-rgb        --awkit-accent-bright-rgb
```

> `--awkit-accent-gradient` is **text-safe**. `--awkit-accent-gradient-vivid` is **decorative only —
> never place text on it.**

### Derivation rules

**Dark** (from the chosen accent): `soft = rgba(accent, .15)` · `muted = rgba(accent, .4)` ·
`edge = darken(.4)` · `connector-selected = lighten(.3)`.

**Light**: `hover = darken(.14)` · `soft = lighten(.92)` · `muted = lighten(.55)` ·
`lavender-soft = lighten(.94)` · `edge = lighten(.5)` · `connector-selected = darken(.2)`.

### Exported helpers

`normalizeAccentColor`, `isValidAccentColor`, `hexToRgb`, `rgbToHex`, `lighten`, `darken`,
`relativeLuminance`, `contrastRatio`, `pickAccentForeground`, `deriveAccentTokens`,
`deriveAccentThemeTokens`, `buildAccentGradient`, `normalizeAccentSettings`, `isDefaultAccent`,
`deriveAccentTokensFor`, `deriveAccentSettingsThemeTokens`, `gradientReadability`.

`pickAccentForeground` and `gradientReadability` are the contrast guards: foreground on accent is
**computed**, not fixed. A redesign that hardcodes a foreground on the accent will break for
user-chosen accents.

---

## 7. Base element rules (lines 391–420)

```css
button, input, select { font: inherit }
button { cursor: pointer }
button:disabled { cursor: not-allowed; opacity: 0.4 }   /* documented pairing */

button, [role="button"] { transition: translate var(--awkit-dur-press) var(--awkit-ease-out) }

button:not(:disabled):not([role="switch"]):active,
[role="button"]:not([aria-disabled="true"]):not([role="switch"]):active {
  translate: 0 1px;
}
```

Two product-wide behaviours to preserve:

- **Disabled = `opacity: 0.4` + `not-allowed`**, together. The stylesheet calls this a documented
  pairing; a redesign should re-specify both, not one.
- **Press = 1px downward translate** on every button, excluding switches. This is the product's
  universal tactile feedback.

---

## 8. Stylesheet region map

`global.css` is organised by ~200 section comments. The major regions, for locating rules:

| Lines | Region |
|---|---|
| 422–638 | app frame · app-main · top-header |
| 638 | chip tier |
| 734–999 | sidebar |
| 999, 13132 | Settings › Appearance |
| 1020 | main content surface |
| 1151 | right properties drawer |
| 1422–1572 | Flow Designer validation chip / issue list / banner |
| 1638–1724 | node selection · ports · loop ports |
| 1724 | per-node kebab menu |
| 1832 | Recorder locator quality |
| 2037 | OR-group wait cards |
| 2055 | Recorder review modal |
| 3294–3306 | status bar |
| 3315–3459 | responsive grids |
| 3459–3537 | collapsible Advanced / Node Properties |
| 3537 | palette resize handle |
| 3557–3709 | node palette |
| 3837–3971 | workflows table |
| 4037–4122 | compact toolbars |
| 4122 | shared editor command rail |
| 4403–4519 | section headers · collapsed rails |
| 4650 | prompt dialog |
| 4825 | secrets card |
| 5051 | path fields |
| 5285–5303 | library badges · legacy compatibility |
| 5496–5503 | toast enter/exit |
| 5592 | load-more scroller |
| 5738–5774 | card cross-fade |
| 6412 | dropdown entrance |
| 6506 | CDP browser observation modal |
| 6671 | execution report banner |
| 6726 | process flow |
| 7032 | stats |
| 7064 | timeline |
| 7269 | Recorder |
| 7790 | protected-login notice |
| 8319 | URL rows |
| 8359–8618 | shared components |
| 8618 | route-content mount transition |
| 8633–9430 | reports family |
| 9430–10011 | canvas + connector tokens · config inspector · drawer shell · node-card anatomy · connectors · zoom pill · palette float |
| 10161 | glass accessibility fallbacks |
| 10245 | connection confirmation modal |
| 10517–10530 | group counter · accordion |
| 10575 | deleted-node exit |
| 10598–10992 | edges · structured loop connector · edge label overlay · node card · layout glide |
| 11665–11754 | auth form messages |
| 12148 | avatar palette `tone-0 … tone-5` |
| 12338–12500 | Administration cards · metrics · destructive action · state block |
| 12670–12975 | accent colour settings · segmented control · gradient mode |
| 12975–13154 | custom logo |
| 13272 | semantic reasons list |
| 13311 | Super-User diagnostics |
