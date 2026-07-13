# AWKIT Visual Parity Plan — adopt FlowForge/Hologram style

**Goal:** Make AWKIT's UI (canvas, nodes, edges, chrome, theming, motion) match the
Workflow/FlowForge reference, while preserving AWKIT's `[data-theme]` theming,
persisted appearance settings, and its many existing pages.

## Context — the two projects are siblings
Workflow (aka *FlowForge*, sidebar branded "Hologram") and AWKIT both use
React + `@xyflow/react` + `lucide-react`. AWKIT's own design-token file already calls
itself *"Hologram-style light theme."* The accent violet is identical (`#7c3aed`).
AWKIT already has: a full `--awkit-*` token system, light/dark/system theming via
`[data-theme]` on `<html>`, 17 keyframe animations, and React-Flow canvas overrides.

So this is a **parity uplift**, not a greenfield port.

| Concern | Workflow (FlowForge) | AWKIT (target) |
|---|---|---|
| Styling | Tailwind utility classes | Semantic CSS + `--awkit-*` tokens (~7.7k lines) |
| Animation | `framer-motion` | CSS transitions/keyframes only |
| Theme switch | `.dark` class + `prefers-color-scheme` | `[data-theme]` attribute, persisted, has `system` mode |
| Nodes/edges | 320px service card, insertable `+` edges, append button, trigger badge | `action-flow-node` semantic classes, own edges |

## Decisions (locked)
- **Add framer-motion** as a real dependency (and to the offline manifest).
- Target **full visual parity** with Workflow.

## Ground rules
- **No Tailwind** in AWKIT. Port Workflow's Tailwind classes into semantic CSS + tokens.
- Everything resolves through tokens so light/dark/system keep working via `[data-theme]`.
- **Never** reintroduce Workflow's `.dark` class model.
- Work on a branch; verify per phase with existing `verify:*` scripts + mock site.
- Copying Workflow JSX verbatim renders unstyled (no Tailwind) — every port is a manual
  CSS translation. This is the highest-frequency mistake; flag it in every PR.

---

## Phase 0 — Foundation (deps, tokens, motion primitives)
1. `npm i framer-motion`. Update the offline manifest
   (`scripts/generate-dependency-manifest.ps1` / `prepare-offline-deps.ps1`) and
   `electron-builder.json` allowlist so packaged/offline builds resolve it.
2. Reconcile tokens in `app/renderer/styles/global.css` vs Workflow's `tailwind.config.js`
   + `index.css`. Add missing tokens (edge colors, shadow aliases); **do not rename**
   existing tokens.
3. Create `app/renderer/lib/motion.ts` — shared framer-motion variants/transitions
   mirroring Workflow (node spring `stiffness:380 damping:30`, `fade-in` 150ms,
   hover/tap presets) plus a reduced-motion guard.
4. Port Workflow's `@media (prefers-reduced-motion: reduce)` block into `global.css`.

## Phase 1 — Canvas parity (React Flow)
Files: `pages/WorkflowDesigner.tsx`, `FlowChartDesigner.tsx`, `ScenarioBuilder.tsx`,
`layout/DesignerCanvasLayout.tsx`, shared edges.
1. `BackgroundVariant.Dots` with `--awkit-canvas-dot`; match gap/size.
2. Port `.react-flow` overrides: hidden-but-connectable handles, `--xy-edge-stroke-*`
   from edge tokens, edge hover/selected highlight, hide attribution.
3. Auto-layout **glide**: `.flow-animating` transitions `transform` on nodes / `d` on
   edges (`350ms cubic-bezier(0.22,1,0.36,1)`).
4. `fitViewOptions={{ padding:0.25, maxZoom:1 }}`; restyle zoom control to floating look.

## Phase 2 — Node & edge visual parity
1. Service/Action node ← Workflow `ServiceNode.jsx`: 320px card, icon tile, service+title
   stack, hover menu, `Zap` trigger badge, selected ring; `motion.div` `layout` + spring
   mount + `whileHover={{ y:-1 }}`.
2. Port `ConditionNode`, `DelayNode`, `LoopNode`.
3. Port `AppendButton` (leaf `+`), `InsertableEdge` (mid-edge `+`), `LoopBackEdge`.
4. Convert every Tailwind utility to AWKIT CSS classes; verify both themes.

## Phase 3 — Chrome parity (shell, sidebar, header, panels)
1. Sidebar ← `Sidebar.jsx`: section groups, active violet pill, animated collapse.
   Theme toggle reuses AWKIT `ThemeContext` (light/dark/**system**), not `.dark`.
2. Top header: breadcrumb + status pill, avatars, icon buttons, Publish button with
   hover/tap; fold into AWKIT `PageChrome` actions.
3. Config/properties panel ← `ConfigPanel.jsx`: float shadow, slide-in.
4. Node picker / floating toolbar / menus / confirm dialog → AWKIT shared components.

## Phase 4 — Motion pass across pages
Page-enter transitions, list stagger (Dashboard/Reports/Library), `AnimatePresence` for
modals/drawers/toasts, button micro-interactions — all via the Phase 0 motion module +
reduced-motion guard.

## Phase 5 — Verification & cleanup
1. Theme sweep light/dark/system on every touched page; grep for hard-coded hex leaks.
2. Run `verify:workflow-builder`, `verify:flow-designer`, `verify:instance-monitor`,
   `verify:reports`; mock-site walkthrough.
3. `npm run build` + packaged/offline smoke test (framer-motion bundles offline).
4. Reduced-motion + a11y: focus rings, keyboard nav.
5. Update `docs/` + AI memory.

## Risk register
- **Tailwind trap** — verbatim Workflow JSX renders unstyled. Manual CSS translation only.
- **Token collisions** — adding tokens is safe; renaming/removing is not.
- **Regression surface** — Phase 3 chrome touches every page; land Phases 1–2 first.
- **Offline packaging** — framer-motion must be in the offline manifest.
- **Two theming models** — never reintroduce `.dark`; flow through `[data-theme]`.

## Sequencing
`0 → 1 → 2` first (isolated, high payoff, low blast radius), then `3 → 4`, then `5`
throughout. Each phase is a reviewable PR.
