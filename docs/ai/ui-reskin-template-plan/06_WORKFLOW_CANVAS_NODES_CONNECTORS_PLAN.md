# 06 — Workflow Canvas, Nodes & Connectors Plan

**Hard constraint:** re-skin only. Do **not** remove node types, config fields, ports, resize/loop
behavior, or change React Flow geometry/coordinate handling. Keep the AppShell canvas no-transform
rule. Style via classes + the shared `connectorStyle.ts` color map → tokens.

## Canvas
- **Background:** `--awkit-surface-inset` + faint **dot grid** (`radial-gradient` 1px dots at ~8% white, 22px pitch). Optionally use React Flow `<Background variant="dots">` recolored via CSS `.react-flow__background`.
- **Grid/dots:** low-contrast so nodes/edges dominate.
- **Pan:** unchanged.
- **Zoom controls:** restyle `CanvasZoomControl` as a glass vertical cluster (bottom-right): +, −, fit. Keep handlers.
- **Minimap:** if `<MiniMap>` present, glass frame, node dots in accent; else leave absent (don't add new feature).
- **Floating add-node toolbar:** glass, top-left; keep existing add logic.

## Node Palette (`.flow-node-palette`)
- Dark panel, searchable list; each item = icon tile + name + desc; hover soft surface; **draggable ghost** styled. Keep drag-to-canvas behavior + all catalog items (`flowNodeCatalog.ts`).

## Node Properties (`FlowNodePropertiesPanel.tsx`)
- Tokened form; group advanced fields under collapsible "Advanced" (all fields retained). Save button = primary. Keep binding to node data.

## Connector Properties (`ConnectionPropertiesPanel.tsx`)
- Tokened form; color presets (`connectorColorPresets`) restyled as swatches mapped to connector tokens; shape/line/thickness/arrow controls unchanged in behavior.

## Node visual spec (`.action-flow-node`, `.scenario-flow-node`)
- **Shape:** radius `--awkit-node-radius` (14px), surface + hairline, soft shadow, grid `icon | copy | tag`.
- **Header/icon:** icon tile `--awkit-node-icon-bg` (accent-soft) + `--awkit-node-icon-fg` glyph.
- **Body:** title (`strong`), subtitle (muted); type tag = pill (`em`) tokened (replace `#eef5ff/#0d5dc2`).
- **Ports/handles (`.react-flow-handle`, `.connector-port-*`):** surface fill + accent ring; conditional=warning, parallel=violet, loop=teal — all via connector tokens (replace `#1769e0/#d68a00/#8b5cf6/#0d9488`).
- **Start/End:** start = success-tinted icon; end = neutral/danger-tinted per existing semantics.

## Node states
| State | Style |
|-------|-------|
| default | surface + hairline |
| hover | `translateY(-2px)` + float shadow |
| selected | accent border + 3px purple ring (keep resize handles visible-on-select) |
| running | pulsing accent/info outline (`runpulse`) |
| success/completed | success border + success icon tile |
| error | danger border-left + danger icon tile (retune existing `.warning/.error`) |
| disabled | reduced opacity, no glow |

## Connector visual spec (`connectorStyle.ts` + edge CSS)
- **Line:** bezier/smoothstep as configured; stroke = per-type token or custom color; width from style.
- **Gradient option:** default edges may use a violet→blue SVG gradient stroke (`<linearGradient>` def once); custom-colored edges keep solid color.
- **Arrow:** keep `MarkerType`; recolor to match stroke.
- **Hover:** slightly thicker + brighter.
- **Selected:** accent halo (drop-shadow) + thicker.
- **Running animation:** `stroke-dasharray` + animated `stroke-dashoffset` ("flowing" dashes) gated on run state.
- **Success/failure:** recolor to success/danger tokens on completion.
- **Move the hardcoded map** (`connectorTypeColor`, `connectorColorPresets`) to read token values (or keep hex but align them to the token palette; document either way). Preserve `normalizeEdgeStyle`/`resolveConnectorColor` logic.

## Motion in canvas
- Drag/drop: ghost + drop settle (`--awkit-dur-med`). Panel collapse/expand: width/opacity transition. All gated by reduced-motion. Never animate React Flow's transform container.

## Do-not-touch list
Coordinate math, `updateNodeInternals`, handle IDs/`portHandlesForKind`, resize `onResizeEnd` writes, loop
edge creation/dedup, `useReactFlow` state writes, edge `data` schema, and canvas route transform exclusion.
