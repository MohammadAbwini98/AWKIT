# 15 — Missing Design Implementation Review (Phase 1 baseline)

> **Phase 1 of the "Missing Template Design" prompt pack.** Template audit + current-app baseline,
> no production UI changes. Produced by inspecting the authoritative static template
> (`UI Samples/sample_01.png`), extracted motion frames from the three mp4s, the current renderer
> shell/CSS, and live "before" screenshots of the built app.

## 1. Design-direction reconciliation (important)

There are **two** conflicting design directions recorded in this repo. This review — and the 01–05
prompt pack it belongs to — follows the **first** one:

- **✅ ACTIVE — Light "Hologram" template.** `UI Samples/sample_01.png` + the three mp4s. Off-white
  shell, **white** full-height sidebar and cards, violet `#6d28d9` accent, 16–22px card radius,
  dotted canvas, floating right drawer, bottom-center zoom pill, purple primary buttons. This is what
  the app's applied token re-skin (2026-07-07, see `CURRENT_STATE.md`) already targets, and what
  prompts `01`–`05` describe.
- **⚠️ STALE — Dark SaaS direction** described in `00_TEMPLATE_REVIEW_FINDINGS.md` /
  `02_SPECIFIC_SYSTEM_DESIGN.md` / `03_DESIGN_TOKENS_AND_GLOBAL_CSS_PLAN.md` (near-black `#0a0c14`,
  violet→blue gradients, glass). Those docs were written from the *written brief* + Dribbble genre
  because the four Dribbble URLs were never reachable (`00` says so explicitly). The static
  `sample_01.png` the user later supplied is **light**, and the shipped re-skin is light. Treat the
  dark-direction docs as historical; do not implement them.

## 2. Template assets reviewed

| Asset | How reviewed | Result |
|---|---|---|
| `UI Samples/sample_01.png` | `Read` (image) | **Authoritative static reference** — full Hologram workflow-editor screen. |
| `UI Samples/Sample02.mp4` (7.3s) | 4 frames via system Chrome | Motion demo of the same editor (drawer edit, node select). |
| `UI Samples/sample_03.mp4` (12.1s) | 4 frames via system Chrome | Same shell + an **"AI Builder"** bottom panel and Slack/condition nodes. |
| `UI Samples/sample_04.mp4` (7.3s) | 4 frames via system Chrome | Motion demo, same template. |
| 4 Dribbble URLs | Not reachable | Client-rendered shells; empty on fetch. Superseded by `sample_01.png`. |

**H.264 note:** Playwright's bundled Chromium cannot decode the mp4s (`err 4`). System Chrome can
(`canPlayType → "probably"`) but only over **HTTP with Range support**, not `file://` (the
`UI Samples` space + `file://` gives `MEDIA_ERR_SRC_NOT_SUPPORTED`). Extractor served the folder from
a tiny local Node HTTP server and drove `chromium.launch({ channel: "chrome" })`. Frames saved to
`docs/ai/ui-reskin-template-plan/mockups/screenshots/template-frames/{sample02,sample03,sample04}-f{1..4}.png`.

### Template observations (from `sample_01.png` + frames)

- **Shell layout:** **full-height white sidebar on the left**; the top header sits **only over the
  canvas/content area** (it starts to the right of the sidebar, NOT above it). No global bottom status bar.
- **Sidebar:** brand row `▣ Hologram ⌄` (workspace switcher, chevron) in a rounded tile at top; simple
  line-icon nav (Home, Reports, Team, Workflows); a contextual **"In Progress · 3"** collapsible group
  and **"Active · 2"** group listing runs with small state dots; bottom utility stack **Settings /
  Help Center / Dark Mode (toggle) / user footer (`● Luke Goatee ⌄`)**.
- **Top header:** page title `New User Sign Up` + inline **status chip** (`● In Progress`) +
  muted `· Updated 30m ago`; right cluster = **avatar stack**, two **icon-square** buttons (filters,
  share), a **`▷ Run Once`** button, and a filled **purple `Publish`** button.
- **Canvas:** light off-white with a faint **dot grid**, large open workspace (no boxed panel frame).
- **Node cards:** white, ~18px radius, soft shadow; **icon tile** + small integration/type label
  (`Airtable · 1`) + **main title** + right **kebab (⋯)**; a small numeric **index badge**. Insert
  **`⊕`** buttons sit on the connectors. **Selected node = lavender fill + purple border/ring.**
- **Connectors:** thin (~1.5–2px) smooth curved lines, violet/neutral; **branch labels `If true` /
  `If false`**; small purple dot at branch points. Delay/condition pills (`⏱ Open in 24 hours`,
  `◇ User = Company`) sit inline on the path.
- **Right drawer:** **floating** rounded white panel with shadow; header `icon · Title · 🗑 ✕`;
  **Setup / Test** tabs; **uppercase** section labels (`CONFIGURATION`, `ACTION`); template inputs/
  selects; **sticky bottom** action row (`Run Test` ghost + `Save` purple).
- **Bottom zoom pill:** floating **bottom-center** capsule — undo/redo, `–` `100%` `+`, `✦ Ask AI`.
- **Motion (from frames):** node select ring, drawer open, connector insert affordance; the mp4s show
  the "AI Builder" panel building nodes. All subtle, transform/opacity-based.

## 3. Current AWKIT baseline (before screenshots)

Captured from the **built, running** app (`scripts/capture-ui-screenshots.mjs before`, mock fixtures
seeded) to `docs/ai/ui-reskin-template-plan/mockups/screenshots/before/`:

| File | Route |
|---|---|
| `01-dashboard.png` | Dashboard |
| `02-flow-designer.png` | ⚠️ actually captured the **Workflows library** — `:has-text("Flows")` matched "Workflows" first (fix: exact nav match). Flow Designer proper still needs a clean shot. |
| `04-workflow-builder.png` | Workflow Builder |
| `05-workflow-designer.png` | Workflow Designer |
| `06-recorder.png` | Recorder |
| `07-instances.png` | Instances |
| `08-reports-overview.png` | Reports Overview |
| `09-settings.png` | Settings |

**Human-capture gaps** (states the automated pass did not stage): Flow Designer *populated* +
*selected-node* + *running/error*, Recorder *recording*, Instances *running/cancelled*, Instance
Monitor *live report modal*, each individual Reports tab, a modal, an empty state, a loading/skeleton
state. List these for a human or a follow-up scripted pass.

### What the token re-skin already did (confirmed in the shots)

Off-white shell, white cards with soft borders/shadow + rounded corners, **purple active nav pill**,
**purple primary buttons**, themed tables, Dark Mode toggle pinned in the sidebar footer, light/dark
token system. Colors and surfaces already read as "Hologram".

## 4. Top missing visual gaps (drives phases 2–5)

| # | Gap | Evidence | Phase |
|---|---|---|---|
| G1 | **Header spans above the sidebar.** `AppShell.tsx:40-50` renders `<TopHeader>` then `<div.app-body>`; `.app-shell` is `grid-template-rows: 60px 1fr 32px` (`global.css:190`). Template = full-height sidebar, header over content only. | `01-dashboard.png`; `sample_01.png` | **2** |
| G2 | **Global bottom StatusBar** with placeholder chips (`Active Instances: 0`, `Queue: 0`, `Last Error: None`) — `StatusBar.tsx`, `.app-shell` row 3. Template has **no** global status bar. | `01-dashboard.png`; `sample_01.png` | 2/3 |
| G3 | **Sidebar brand** is `WFS / WebFlow Studio / Automation workbench` (`LeftNavigation.tsx:40-58`), not a workspace-switcher tile with chevron. No **user/workspace footer**; no **Help Center** entry. | `01-dashboard.png` | **3** |
| G4 | **Header lacks** status chip, "Updated …" muted text, avatar cluster, and icon-square button treatment; page actions are plain toolbar buttons (`TopHeader.tsx`). | `sample_01.png` | **3** |
| G5 | **Nav grouping** is static Build/Data/Run/Reports/System vs. the template's contextual run groups (acceptable to keep groups; align spacing/labels/active dot). | `01-dashboard.png` | 3 |
| G6 | **Shared surfaces** (cards/tables/forms/tabs/modals/toasts/empty/loading) are re-tokened but not yet fully aligned to template radius/spacing/hover-lift. | before shots | **4** |
| G7 | **Canvas / nodes / connectors / drawer / zoom pill / motion** partially done (dotted bg, 16px nodes, bottom-center pill per `CURRENT_STATE`) — verify against template: floating drawer with Setup/Test tabs + sticky footer, node icon-tile + type label + kebab + index badge, `If true/false` branch labels, active-only connector animation, reduced-motion. | `sample_01.png`, frames | **5** |

## 5. Bindings / invariants to NOT touch (carry into every phase)

- Do not rename `window.playwrightFlowStudio` (preload contract).
- Preserve React Flow geometry: handle IDs (`normal-in`/`*-out-*`/`loop-*`), edge `data` schema,
  branch-port reconciliation, `NodeResizer`, and the **canvas-route no-mount-transform rule**
  (`AppShell.tsx` `CANVAS_ROUTES`).
- Keep routing (`routes.tsx`), `pageChrome` header-action wiring, sidebar collapse, and the
  unsaved-changes dirty guard.
- Offline-first: plain CSS in `global.css`, **no** new UI framework / CSS-in-JS / remote fonts, tokens
  via `var(--awkit-*)`. No fake/no-op controls; no demo data as real records.
- `ReportsFailures.tsx` keeps its literal category-hue palette (deliberate distinct chart hues).

## 6. Files created / updated in Phase 1

- **Created:** this file; `scripts/capture-ui-screenshots.mjs` (reusable before/after helper);
  `docs/ai/ui-reskin-template-plan/mockups/screenshots/before/*.png` (8);
  `docs/ai/ui-reskin-template-plan/mockups/screenshots/template-frames/*.png` (12).
- **No production UI / source / token changes.** `npm run build` verified green.

## 7. Next recommended phase

**Phase 2 — Shell layout correction.** Restructure `AppShell` so the sidebar is full-height on the
left and the header renders only over the main content (`app-shell` → columns `sidebar | app-main`,
`app-main` → rows `header | main-surface [| status]`), preserving routing, page actions, collapse,
status behavior, and React Flow canvas measurement. Then verify:
`npm run build`, `verify:flow-designer`, `verify:workflow-builder`, `verify:reports`.
