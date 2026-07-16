# 005 — Position and glide canvas nodes with `transform`, not `left`/`top`

- **Status**: TODO
- **Commit**: 7c4b260
- **Severity**: HIGH
- **Category**: Performance
- **Estimated scope**: 2 files (`FlowCanvas.tsx`, `global.css`), 1 style object + 1 glide rule + dead-CSS removal

## Problem

The in-house canvas positions every node with `left`/`top` and animates the auto-arrange **glide** with
`left`/`top` (and edge `d`). `left`/`top`/`d` trigger **layout + paint** every frame; during an
auto-arrange of a large graph, *every* node re-layouts each frame for the whole glide — exactly the kind
of jank the app must avoid while it is also dispatching a live run. Both reference skills are explicit:
animate **`transform` and `opacity` only**.

```tsx
/* app/renderer/components/canvas/FlowCanvas.tsx:534-540 — current node positioning */
<div
  ref={elementRef}
  data-canvas-node={node.id}
  data-id={node.id}
  className="awkit-flow-node"
  style={{ position: "absolute", left: pos.x, top: pos.y, cursor: draggable ? "grab" : "default" }}
```

```css
/* app/renderer/styles/global.css:9057-9060 — current glide (animates layout props) */
/* Programmatic layout glide (auto-arrange / load) */
.awkit-flow-canvas.flow-animating .awkit-flow-node {
  transition: left 350ms cubic-bezier(0.22, 1, 0.36, 1), top 350ms cubic-bezier(0.22, 1, 0.36, 1);
}
```

```css
/* app/renderer/styles/global.css:8165-8175 — DEAD React-Flow residue (engine removed 2026-07-11) */
.flow-animating .react-flow__node { transition: transform 350ms cubic-bezier(0.22, 1, 0.36, 1); }
.flow-animating .react-flow__edge-path { transition: d 350ms cubic-bezier(0.22, 1, 0.36, 1); }
```

The `.react-flow__*` rules are **dead** — the in-house canvas renders `.awkit-flow-node` /
`.awkit-flow-edge`, never `.react-flow__*` (confirmed: no renderer emits those classes). They also carry
the same off-scale `350ms` (> the 300ms UI ceiling).

## Target

Position nodes with a GPU-composited `transform: translate3d(x, y, 0)` and glide the **transform**.
Edges are unaffected — `EdgeLayer`/`DraggingEdgeLayer` compute paths from `node.position` in JS
(`FlowCanvas.tsx:637-640, 683-687`), not from the DOM, so the visual result is identical while the
per-frame cost drops to compositor-only.

```tsx
/* target — FlowCanvas.tsx:534-540 */
<div
  ref={elementRef}
  data-canvas-node={node.id}
  data-id={node.id}
  className="awkit-flow-node"
  style={{
    position: "absolute",
    top: 0,
    left: 0,
    transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
    cursor: draggable ? "grab" : "default"
  }}
```

```css
/* target — global.css:9057-9060 (assumes plan 002 added --awkit-dur-slow / --awkit-ease-in-out) */
/* Programmatic layout glide (auto-arrange / load) — transform-only, GPU-composited */
.awkit-flow-canvas.flow-animating .awkit-flow-node {
  transition: transform var(--awkit-dur-slow) var(--awkit-ease-in-out);
  will-change: transform;
}
```

Delete the dead `.react-flow__*` glide rules (`global.css:8165-8175`, keeping the surrounding non-dead
rules) and the dead `--xy-*` token block (`global.css:2969-2977`) if nothing references `--xy-` (verify
with a grep first).

> Note: the existing reduced-motion neutralizer (`global.css:8445-8454`) and the explicit
> `.awkit-flow-canvas.flow-animating .awkit-flow-node { transition: none }` at `9062-9066` already zero
> this transition under reduced motion — keep both; the transform-based glide inherits that safety.

## Repo conventions to follow

- The canvas engine lives at `app/renderer/components/canvas/`. Node positioning is done in exactly one
  place — `NodeContainer` (`FlowCanvas.tsx:534`). `pos` = `drag ?? node.position` (`FlowCanvas.tsx:477`),
  so this single style object covers both static and live-drag positioning — no other edit is needed for
  drag to keep working.
- `docs/ai/RULES.md` › Performance and `docs/ui-design-and-motion-direction.md` § 11 both mandate
  transform/opacity-only animation. This change is the headline item of that section.
- Existing correct exemplar: the viewport layer already uses `transform: translate(x,y) scale(z)` with
  `transformOrigin: "0 0"` (`FlowCanvas.tsx:391`) — mirror that approach for nodes.
- `will-change: transform` is applied **only** during `.flow-animating` (a bounded ~350ms window), never
  globally — do not add it to the base `.awkit-flow-node` rule (it would cost a layer per node forever).

## Steps

1. `FlowCanvas.tsx:540` — replace `left: pos.x, top: pos.y` with `top: 0, left: 0, transform:
   \`translate3d(${pos.x}px, ${pos.y}px, 0)\``. Leave `position: "absolute"` and `cursor` as-is.
2. `global.css:9058-9060` — change the glide transition from `left …, top …` to
   `transform var(--awkit-dur-slow) var(--awkit-ease-in-out)`; add `will-change: transform`.
   (If plan 002 has not run, use `260ms cubic-bezier(0.77, 0, 0.175, 1)` literally and note it for later
   tokenization.)
3. `global.css:8165-8175` — delete the dead `.flow-animating .react-flow__node` and
   `.flow-animating .react-flow__edge-path` rules (and the stale comment block above them referencing
   React Flow). First confirm they are dead: `rg -n "react-flow__" app/renderer` must show only CSS
   (no `.tsx` emitting those classes).
4. `global.css:2969-2977` — if `rg -n "\-\-xy-" app/renderer` shows only these definitions (no
   consumers), delete the `--xy-*` block. If anything consumes them, leave them and note it.
5. Update the stale comment in `app/renderer/lib/motion.ts:150` that references
   "`.flow-animating .react-flow__node` rules" → "`.awkit-flow-canvas.flow-animating .awkit-flow-node`
   rule" (comment only; the `useFlowGlide` logic and `GLIDE_MAX_NODES = 120` guard are correct — keep them).

## Boundaries

- Do NOT change drag math, pointer handlers, measurement (`ResizeObserver`), edge path computation, the
  memoization of `NodeContainer`/`EdgeLayer`, or `GLIDE_MAX_NODES`.
- Do NOT add `will-change` to the base node rule or globally.
- Do NOT introduce a spring/JS animation for the glide in this plan (a future plan may make it
  interruptible; here it stays a CSS transition, just transform-based).
- Do NOT touch node markup beyond the `style` object, and do NOT change `ActionFlowNode`/`ScenarioFlowNode`
  (they render *inside* the container and do not set their own position — verify: `rg -n "left:|top:"
  app/renderer/components/workflow app/renderer/components/scenario app/renderer/components/canvas/nodes`
  should show no node self-positioning; if it does, STOP and report).
- If `FlowCanvas.tsx:540` no longer matches the excerpt (drift since `7c4b260`), STOP and report.

## Verification

- **Mechanical**:
  - `npm run build` → passes.
  - `npm run verify:canvas-perf` → passes (this guard exists specifically for canvas render/perf
    regressions; it must stay green).
  - `npm run verify:flow-designer` and `npm run verify:workflow-builder` → pass (real Electron; node
    drag, arrange, and inspector geometry unregressed; no console errors).
  - `rg -n "react-flow__|\-\-xy-" app/renderer` → no matches (dead code gone) or only intentional leftovers
    you documented.
- **Feel check**: run the app, open the **Flow Designer** with a multi-node flow:
  - **Drag** a node — it still tracks the pointer 1:1 at every zoom level (transform positioning must not
    change drag feel).
  - **Auto-arrange** — nodes glide to their new positions; open DevTools → Performance, record the glide,
    and confirm the frames show **Composite** work but little/no **Layout** (before this change, Layout
    fired every frame). Connectors still follow the nodes during the glide.
  - Load a **large** flow (> `GLIDE_MAX_NODES` = 120 nodes) — nodes snap (no glide) as before; no jank.
  - Toggle prefers-reduced-motion → arrange snaps instantly (no glide). Good.
- **Done when**: nodes are positioned via `translate3d`, the glide animates `transform`, the Performance
  trace shows no per-frame Layout during a glide, dead `.react-flow__*`/`--xy-*` code is gone, and
  `verify:canvas-perf` + `verify:flow-designer` + `verify:workflow-builder` all pass.
