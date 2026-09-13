# AWKIT / SpecterStudio — UI surface extraction

**Purpose.** A complete inventory of every page and every UI component in the SpecterStudio
renderer, together with the design-token vocabulary they consume, so a new design system can be
mapped onto the existing surface without re-discovering it.

**Audience.** An external design pass (Claude Design). This document set describes *what exists
today*. It deliberately proposes nothing.

**Extracted at commit** `28fb9fb` · renderer contains **126 `.tsx` files**, **33 routes**,
**~226 `--awkit-*` design tokens** in a single **13,325-line** stylesheet.

---

## Read in this order

| File | Contents |
|---|---|
| [`01-app-shell.md`](01-app-shell.md) | Window chrome, shell grid, navigation model, header/status bar, page-chrome contract |
| [`02-design-tokens.md`](02-design-tokens.md) | Every token: primitives, light, dark, connector, gradient accent + the runtime accent override contract |
| [`03-pages.md`](03-pages.md) | All 33 routes + non-route surfaces, each with layout family, root class, permission gate |
| [`04-components.md`](04-components.md) | Every exported component: path, props, variants, CSS class hooks |
| [`05-patterns.md`](05-patterns.md) | State patterns (loading/empty/error/dirty/disabled/focus), motion spine, accessibility, icon sizing |

## What this product is

An **offline-capable Windows desktop app** (Electron + React + TypeScript) for visually building
and running Playwright web-automation flows. It ships a bundled Chromium and runs with **no
internet, no global Node, no global Playwright and no admin rights**. The UI is a single window
with a custom title bar; there is no browser address bar and no web deployment.

Three broad activities drive the layout:

1. **Build** — canvas designers (Flow Designer, Workflow Designer, Workflow Builder, Form
   Designer) and a Recorder that captures real browser interaction into reusable flows.
2. **Run** — execution monitor, concurrent browser-instance monitor, live status bar.
3. **Analyse** — an eight-page reporting family plus an Administration area (users, roles,
   permissions, audit log, licensing).

---

## Hard constraints a redesign must respect

These are non-negotiable. Each one is enforced somewhere in the repository (lint-by-review, a
verifier, or a runtime contract) and breaking one produces a defect, not a style disagreement.

### 1. Token-only styling — no hardcoded values

All colour, spacing, radius, typography, shadow and motion must flow through the `global.css`
custom properties (`var(--awkit-*)`, `--space-*`, `--radius-*`, `--text-*`, `--dur-*`). No literal
hex, no arbitrary pixel values, no parallel class system, no CSS-in-JS, no utility framework. There
is exactly one stylesheet: `app/renderer/styles/global.css`.

A new design system is applied by **redefining the token values** and, where necessary, restyling
the existing class hooks catalogued in `04-components.md`. Renaming the hooks is a much larger
change: several are matched by end-to-end test helpers and by `data-testid` attributes.

### 2. Offline-first — no remote assets of any kind

No CDN, no webfont download, no remote `@import`, no external image or script. The font stack is
system-resolved (`Inter, system-ui, -apple-system, "Segoe UI", …`) with **no `@font-face`**. Icons
come from the bundled `lucide-react` package; brand marks are inline SVG components. Any new design
system must be expressible with locally available resources.

### 3. Violet is accent-only

The stylesheet carries an explicit warning at the surface-token block: violet must never return as
a canvas, surface or border colour — that is what previously made the whole application read as a
purple wash. Accent is for interactive emphasis, selection and connectors.

### 4. The accent is user-configurable at runtime

Twelve accent tokens and nine gradient tokens are **overwritten as inline custom properties on
`<html>`** by `src/theme/accentColor.ts` whenever the user picks an accent. Never hardcode a
literal in a consumer rule — read the token. See `02-design-tokens.md` § "Runtime accent override".

### 5. Three theme states, all first-class

`light`, `dark` and `system`. The resolved theme is stamped as `<html data-theme="light|dark">`.
Both themes carry a complete, independently authored palette — dark is not a filter over light. A
separate `:root[data-accent-mode="gradient"]` layer adds scoped gradient treatments.

### 6. Do not change the shell grids without explicit permission

`.app-shell` and `.app-main` are the two CSS grids that hold the whole application together. The
repository rules call these out by name.

### 7. Canvas geometry is measured, not styled

The four canvas routes (`flowChart`, `scenarioBuilder`, `workflow`, `formDesigner`) are excluded
from the route-mount fade transition because a mount transform perturbs canvas coordinate
measurement. `DesignerCanvasLayout` measures the action bar with a `ResizeObserver` and publishes
`--awkit-action-bar-h`. Transforms, scale animations and layout shifts on canvas ancestors break
node hit-testing. The canvas engine is **in-house** (`components/canvas/*`), not React Flow.

### 8. Status never relies on colour alone

Every status badge pairs an icon with text. The Administration kit states this in its header
comment; the reporting family follows the same rule. A redesign may change the pairing's
appearance, not remove the icon or the label.

### 9. Reduced motion must neutralise the spring easings

`--awkit-ease-spring` approximates physical springs (node 380/30, menu 420/32). The stylesheet
notes these must still be neutralised under `prefers-reduced-motion`.

### 10. Accessibility floors already in the code

- Focus is a two-ring token: `--awkit-focus-ring: 0 0 0 2px var(--awkit-surface), 0 0 0 4px rgba(var(--awkit-accent-rgb), 0.7)`. It **must** resolve through `--awkit-accent-rgb` so a custom accent keeps a visible ring.
- `--awkit-success` at `#14a46c` is 3.20:1 on white — below WCAG AA 4.5:1 for text. A separate `--awkit-success-text: #15803d` exists for that reason. Do not collapse the two.
- Collapsed navigation rows are icon-only and carry explicit `aria-label`s; expanded rows are named by their own visible text, which end-to-end helpers match on.
- Chart series tokens are assigned **by data category**, never by state, so a category keeps its colour across every chart.

### 11. Never rename `window.playwrightFlowStudio`

The preload API identifier is an internal contract. The renderer reaches the main process only
through it — never `fetch`, never a direct import from `app/main`.

### 12. Permission filtering is a UI hint, not a boundary

`RoutePermissions` / `RouteExclusiveRoles` hide navigation entries and block route mounts. The real
authorisation boundary is the main-process IPC permission check. A redesign must keep the hiding
behaviour (an empty navigation group disappears entirely) but must not treat it as security.

---

## How to use this set for a redesign

1. Read `02-design-tokens.md` and produce a **token mapping** — new value per existing token name.
   This alone re-skins most of the application.
2. Use `01-app-shell.md` to decide the chrome, navigation and header treatment. These are the
   surfaces every page inherits.
3. Walk `03-pages.md` by **layout family** (there are seven), not page by page. Six families cover
   all 33 routes; restyling a family restyles every page in it.
4. Use `04-components.md` for the component-level detail — props tell you which variants must
   survive; class hooks tell you exactly what selector to target.
5. Check every proposal against `05-patterns.md` so loading, empty, error, disabled and focus
   states stay consistent across families.

## Source map

| Area | Path |
|---|---|
| Route table | `app/renderer/routes.tsx` |
| Root + theming | `app/renderer/App.tsx` |
| Shell | `app/renderer/layout/` (8 files) |
| Pages | `app/renderer/pages/`, `app/renderer/pages/admin/` |
| Components | `app/renderer/components/{shared,canvas,workflow,scenario,reports,instances,data-binding,table,auth}/` |
| Auth screens | `app/renderer/security/` |
| Semantic search | `app/renderer/semantic/` |
| Brand marks | `app/renderer/assets/brand/AwkitBrandMarks.tsx` |
| Stylesheet | `app/renderer/styles/global.css` (13,325 lines) |
| Accent runtime | `src/theme/accentColor.ts` |
| Route permissions | `app/renderer/security/routePermissions.ts` |
| Design/motion direction | `docs/ui-design-and-motion-direction.md` |
