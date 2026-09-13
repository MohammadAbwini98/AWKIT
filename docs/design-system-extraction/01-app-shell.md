# 01 — Application shell

Every page renders inside this chrome. Restyling the shell restyles the whole product.

## DOM anatomy

```
div.app-window
├── header.app-frame                        ← custom OS title bar (drag region)
│   ├── .app-frame-identity
│   │   ├── .app-frame-mark                 ← AwkitLightBrandMark / AwkitDarkBrandMark, size 16
│   │   └── .app-frame-wordmark             ← "SpecterStudio"
│   ├── .app-frame-divider
│   ├── .app-frame-context                  ← active area label
│   ├── .app-frame-spacer
│   ├── AccountMenu                         ← .awkit-account*
│   └── WindowControls                      ← .app-frame-controls > .win-control ×3
│
└── div.app-shell[.sidebar-collapsed]       ← CSS grid: nav column + main column
    ├── LeftNavigation                      ← aside .left-navigation[.collapsed]
    └── div.app-main                        ← CSS grid: header / surface / status
        ├── TopHeader                       ← header.top-header
        ├── main.main-surface[.main-surface-animated]
        │   └── ErrorBoundary → <ActivePage /> | <NotAuthorized />
        └── StatusBar                       ← footer.status-bar
```

Outside the shell, mounted as siblings by `App.tsx`: `UnsavedChangesDialog` (when a route change is
blocked by unsaved work) and the toast host.

Above the shell entirely: `SecurityGate` → `LockedShell` renders the sign-in stage before the
application shell exists at all (see `03-pages.md` § Security surfaces).

`.app-shell` and `.app-main` are the two structural grids. **Do not change them without explicit
permission** — that rule is stated by name in the repository conventions.

## Height budget

```css
--titlebar-height: 36px;
--header-height:   64px;
--status-height:   32px;
--shell-chrome: calc(var(--titlebar-height) + var(--header-height) + var(--status-height));
```

`html, body, #root { height: 100%; overflow: hidden }` — the application never scrolls as a whole.
Each page owns its own scroll container. `--shell-chrome` (132px) is what page layouts subtract.

---

## `AppFrame` — custom title bar

`app/renderer/layout/AppFrame.tsx` (58 lines)

- The whole bar is an OS drag region; **double-click toggles maximize**.
- `roleLabelFor(principal)` → `"Super User"` when `isProtectedSuperUser`, otherwise
  `principal.roles[0] ?? "User"`. This is a **display hint only** and never an authorisation decision.
- Brand mark switches with the resolved theme (`AwkitDarkBrandMark` / `AwkitLightBrandMark`, 16px).

### `WindowControls`

`app/renderer/layout/WindowControls.tsx` (102 lines)

`.app-frame-controls` containing three `.win-control` buttons; the last also carries
`.win-control-close`. The glyphs are **inline SVG with a 10px stroke box** — deliberately not an
icon-library dependency, so they can match Windows metrics exactly. `useWindowMaximized()` seeds
from `appWindow().isMaximized()` and subscribes to `onMaximizedChange`. Double-click is
`stopPropagation`'d so pressing a control does not also toggle maximize.

---

## `LeftNavigation` — primary navigation

`app/renderer/layout/LeftNavigation.tsx` (231 lines)

Collapsible sidebar. Collapsed rows are icon-only with explicit `aria-label`; expanded rows are
named by their own visible text and **must not be relabelled** (end-to-end helpers match on it).

### Navigation groups (order is the source order)

| Group | Routes |
|---|---|
| **Build** | `dashboard`, `workflowsLibrary`, `scenarioBuilder`, `flowLibrary`, `semanticSearch`, `flowChart`, `formDesigner`, `recorder` |
| **Data** | `dataSources`, `runtimeInputs`, `sessions` |
| **Run** | `executionMonitor`, `instanceMonitor` |
| **Reports** | `reportsOverview`, `reportsWorkflows`, `reportsInstances`, `reportsChrome`, `reportsRuntime`, `reportsFailures`, `reportsServer`, `reports` |
| **System** | `roadmap`, `offlineRuntime` |
| **Administration** | `userManagement`, `roles`, `permissionsMatrix`, `auditLog`, `licensing`, `licenseIssuer` |
| *(pinned footer)* | Settings, Help Center (`projectContract`), theme toggle, workspace block |

Groups filter by `RoutePermissions[id]` / `RouteExclusiveRoles[id]`; **an empty group disappears
entirely** rather than rendering an empty header. Two routes are reachable only by navigation from
another page and appear in no group: `dataSourceEditor` and `workflow`.

### Brand handling

An inline `SpecterAppIcon({ size = 32 })` SVG is defined in the file — concept "1c": a near-black
squircle, an off-white brick "S", and a trailing brick with a `#7cc7ff → #b98cff → #ff8fa3` gradient.
It matches `resources/icon.*`.

When custom branding is configured, the logo replaces the **entire workspace block**
(`.nav-workspace.has-custom-logo` → `.nav-workspace-logo-full`, `height: 44px; object-fit: contain`).
Presence is checked against validated context state — **never via `<img onError>`**.

### Class hooks

`.left-navigation`, `.left-navigation.collapsed`, `.brand-block`, `.brand-tile`, `.brand-name`,
`.nav-collapse-button`, `.navigation-list`, `.nav-group`, `.nav-group-toggle`, `.nav-group-items`,
`.nav-group-items.open`, `.nav-group-items-inner`, `.nav-item`, `.nav-item.active`, `.nav-footer`,
`.nav-theme-toggle`, `.theme-switch`, `.theme-switch.on`, `.theme-switch-thumb`, `.nav-workspace`,
`.nav-workspace.has-custom-logo`, `.nav-workspace-logo-full`, `.nav-workspace-mark`,
`.nav-workspace-name`.

Icon sizes: **17px** nav rows · **16px** collapse button · **14px** group chevron · **15px**
workspace mark.

---

## `TopHeader` — per-page header

`app/renderer/layout/TopHeader.tsx` (50 lines)

```
header.top-header
├── button.icon-button[aria-label="Back"]        ← ArrowLeft, 18px; rendered only when canGoBack
├── .header-title
│   ├── <strong>{route.label}</strong>
│   └── <span>{route.description}</span>          ← the route description IS the page subtitle
├── .header-status-chip                           ← "Unsaved changes", only when dirty
└── .header-actions
    └── button.toolbar-button[.primary][data-testid="page-action-{id}"]  ← 0..n
```

The label/description pair comes straight from the route table (`03-pages.md`), so every page has a
title and a one-line description with no per-page code.

### Page-chrome contract

Pages publish their header actions through `PageChromeContext`:

```ts
type PageChrome = { actions: PageAction[]; dirty: boolean };
```

The save action is identified by `id === "save"`. When `dirty` is true and the user navigates away,
`App.tsx` intercepts and shows `UnsavedChangesDialog` (Save / Discard / Cancel), with `canSave`
derived from whether a save action is published.

---

## `StatusBar` — persistent runtime telemetry

`app/renderer/layout/StatusBar.tsx` (141 lines)

`footer.status-bar` of `.status-chip` pills:

| Chip | Values | Tone |
|---|---|---|
| Offline Runtime | `Ready` / `N checks` / `Unavailable` / `Checking` | ok / warn / neutral |
| Active flows | `N` | neutral |
| Active browsers | `N` | neutral |
| Queue | `N` | warn when > 0 |
| Runtime | `Runtime nominal` / `Runtime backpressure` / `Runtime status unavailable` | tone-driven |
| License | action chip, `.status-chip.status-chip-action`, navigates to Licensing | danger / warn |

Polls `executions.runtimeStatus()` every **2000 ms**. License revalidation fires on
`LICENSE_REVALIDATE_INTERVAL_MS`, on window focus, and on `visibilitychange`.

This bar is always visible and always changing — it is the product's ambient "is it healthy" signal
and deserves deliberate treatment in any redesign.

---

## `DesignerCanvasLayout` — the canvas page frame

`app/renderer/layout/DesignerCanvasLayout.tsx` (58 lines)

```ts
{ children, propertiesTitle = "Properties", rightPanel, flush = false, rightCollapsed = false }
```

Classes: `designer-layout` + `flush-layout` + `has-right-panel` + `right-collapsed`.
Inner: `.designer-canvas[.flush]` and `.designer-right-drawer-slot`.

Two behaviours matter for design:

1. It measures `.flow-action-bar` height with a `ResizeObserver` and publishes it as
   `--awkit-action-bar-h`, so the canvas viewport can subtract a toolbar whose height is not known
   statically.
2. The right slot is a **real layout column**, not an overlay. Opening the properties panel shrinks
   the canvas viewport rather than covering nodes. `--awkit-drawer-width: 440px`.

### `RightPropertiesPanel`

`app/renderer/layout/RightPropertiesPanel.tsx` (18 lines) —
`aside.properties-panel > .properties-heading (h2 + span "No element selected") + .empty-properties`.

---

## `AppShell` — composition and the canvas exception

`app/renderer/layout/AppShell.tsx` (60 lines)

```ts
const CANVAS_ROUTES = new Set(["flowChart", "scenarioBuilder", "workflow", "formDesigner"]);
```

Every other route gets `.main-surface-animated`, a mount cross-fade on route change. Canvas routes
are **excluded**: a mount transform perturbs canvas coordinate measurement. Any new page-transition
design must preserve this exclusion.

`ErrorBoundary` is keyed by `activeRouteId`, so a crashed page resets when the user navigates away
rather than staying broken.

---

## Theming pipeline

`app/renderer/App.tsx` (257 lines)

```
PageChromeContext → NavigationContext → ThemeContext → BrandingContext → AppShell
```

- Appearance mode is `light | dark | system`, persisted in `localStorage["awkit-appearance"]`
  **and** through `settings.update({ appearance })`.
- `document.documentElement.dataset.theme = resolveAppearance(appearance)`.
- Accent is applied with `applyAccent(document.documentElement, accent, resolvedTheme)` — inline
  custom properties on `<html>`, layered over the stylesheet defaults.
- Routes are gated by `RoutePermissions` / `RouteExclusiveRoles`; unauthorised mounts render
  `NotAuthorized` instead of the page. Issuer accounts are redirected to `licenseIssuer` on sign-in.
