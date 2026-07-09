# Actual Hologram Template Design Extraction

Source assets reviewed:

- `sample_01.png` — full static workflow builder screenshot.
- `Sample02.mp4_sheet.jpg` — frames show node selection, right drawer, test state, close/drawer behavior.
- `sample_03.mp4_sheet.jpg` — frames show canvas view, centered popover/modal, creation/explanation overlay, and fade/slide behavior.
- `sample_04.mp4_sheet.jpg` — frames repeat node selection + configuration/test drawer states.

## 1. Overall layout

The template is a light SaaS workflow-builder UI.

Observed static proportions from `sample_01.png`:

- Window: wide desktop layout.
- Sidebar: fixed, full-height, about 275px wide.
- Header: starts to the right of the sidebar; it does not span above the sidebar.
- Header height: about 80px.
- Canvas: fills the center from under the header to the bottom.
- Right drawer: floating over the canvas, about 440px wide, with 18–24px margins from top/right/bottom.
- Bottom zoom pill: centered near bottom of canvas.

Required AWKIT mapping:

- `AppShell` must be `sidebar | app-main`, not `header / body / status`.
- Canvas builder pages must use overlayed/floating panels instead of boxed grid panels.
- The right properties area must not reduce canvas geometry by default; it should float on top.

## 2. Color palette

Approximate palette from template:

```css
--template-app-bg: #f6f5f7;
--template-sidebar-bg: #f7f7f8;
--template-header-bg: #ffffff;
--template-canvas-bg: #f3f2f4;
--template-card-bg: #ffffff;
--template-drawer-bg: #ffffff;
--template-border: #e8e6ea;
--template-border-strong: #dad7df;
--template-text: #141116;
--template-text-muted: #77737e;
--template-text-soft: #9c98a3;
--template-violet: #6b21c8;
--template-violet-hover: #5818ad;
--template-violet-soft: #f3ecff;
--template-violet-ring: #8b4ad8;
--template-blue-chip: #d9efff;
--template-blue-chip-text: #2874a6;
--template-green: #35b85f;
--template-danger: #d93f45;
```

Design implication:

- Light theme is the primary target.
- Dark mode may remain, but the template target is light.
- Violet is the only strong brand color; avoid overusing semantic green/red/amber outside runtime status.

## 3. Sidebar design

Observed:

- Brand row at top with small black square logo and `Hologram` name.
- Simple line-icon primary nav: Home, Reports, Team, Workflows.
- Sections: `In Progress` and `Active`, each with small count pill.
- Workflow list rows: small connector/arrow icon, text, tiny status dot.
- Active workflow row is darker/bolder with blue dot.
- Bottom utility links: Settings, Help Center, Dark Mode toggle.
- User/workspace row at the bottom.
- Sidebar background is slightly off-white and separated by one vertical border.

AWKIT implementation:

- Keep all existing routes, but present them with template spacing/icon treatment.
- Add visual grouping. Do not delete existing navigation.
- If real workflow status data is not available, do not fake live lists; use existing routes/group labels and optional placeholder only if clearly non-functional.

## 4. Header design

Observed:

- Title: `New User Sign Up`.
- Status chip next to title: `In Progress` in blue pill with dot.
- Muted updated text: `Updated 30m ago`.
- Right cluster: avatars, square icon buttons, Run Once button, violet Publish button.
- Header buttons are compact with large rounded corners.

AWKIT implementation:

- Support page title + optional dirty/status chip from real state.
- Primary actions render as violet CTA.
- Secondary actions render as white/gray pill or icon-square.
- Do not add fake avatars or fake updated timestamps unless backed by real data.

## 5. Canvas design

Observed:

- Canvas is the product center, not a card inside a card.
- Background is very light gray/off-white.
- Fine dotted grid, about 16–20px spacing, tiny gray dots.
- Left edge can show partially off-screen nodes, confirming pan/scroll canvas behavior.
- Right drawer overlays canvas.
- Bottom zoom pill overlays canvas.

AWKIT implementation:

- All React Flow surfaces must share the same canvas class and CSS variables.
- Remove old internal margins like `margin-left: 236px` if they make the canvas boxed or misaligned.
- Palette and drawer should float over the canvas with z-index management.

## 6. Node card design

Observed:

- Node cards are white, rounded, soft shadowed.
- Main action node size roughly 360×84.
- Selected node has lavender fill and purple border/ring.
- Left icon tile is small, rounded, and app-colored.
- Top metadata line: integration name + small index badge.
- Main title line is bold.
- Kebab menu on right.
- Condition/wait node is smaller pill-like card.
- Add buttons are small violet circles below nodes/at connector junctions.

AWKIT implementation:

- `ActionFlowNode` must render metadata/title/actions, not only generic icon/copy/type badge.
- Start/End nodes should use the same card anatomy.
- Validation colors must not overpower the selected state.

## 7. Connector design

Observed:

- Default connectors are violet.
- Lines are thin, smooth, and mostly orthogonal/curved.
- Plus buttons appear on vertical connector segments.
- Conditional split has small labels `If true` and `If false`.
- Branch connector paths are readable and do not overlap nodes.
- Connectors animate only in interaction/running/test states, not constantly.

AWKIT implementation:

- Default connector = violet.
- Runtime semantic colors only when displaying runtime outcome.
- Add a custom React Flow edge for label pill + optional add button.
- Preserve saved connector custom styles.

## 8. Right configuration drawer

Observed:

- Drawer is floating, rounded, and shadowed.
- Header: icon + title + index badge + delete + close.
- Tabs: Setup/Test with underline active tab.
- Section labels: uppercase, muted, small icon.
- Form controls: 42–46px high rounded selects/inputs.
- Message input is a larger rounded text area.
- Bottom action bar sticks to bottom: Run Test + Save.
- Internal content scrolls, not the whole page.

AWKIT implementation:

- `FlowNodePropertiesPanel` and `ConnectionPropertiesPanel` must become drawer-style panels.
- Keep all fields; use internal scroll and sticky footer/header.
- Existing `details` groups may stay functionally, but their visual style should match template sections.

## 9. Bottom zoom pill

Observed:

- Bottom-center floating pill.
- Contains undo/redo-like controls, minus, percent, plus, and Ask AI segment.
- White surface, soft shadow, rounded corners.
- It does not touch page edges.

AWKIT implementation:

- Keep existing zoom control functionality.
- Only show controls backed by real behavior.
- Do not add fake Ask AI unless existing functionality exists.
- Style must match the pill.

## 10. Motion from video frames

Observed in `Sample02.mp4` and `sample_04.mp4`:

- Node selection changes card fill/border quickly and smoothly.
- Drawer appears/disappears with a slide/fade from the right.
- Setup/Test tab content swaps with underline animation.
- Test state shows a compact progress/result visualization in the drawer.
- Drawer close returns to full canvas without layout jump.

Observed in `sample_03.mp4`:

- Center popover/modal enters above canvas with fade/scale.
- Background canvas remains visible and stable.
- Popover content has dark overlay/tooltip blocks in one frame.
- Motion feels 120–260ms, not slow.

Required animation tokens:

```css
--awkit-motion-fast: 120ms;
--awkit-motion-base: 180ms;
--awkit-motion-panel: 240ms;
--awkit-motion-ease: cubic-bezier(.2, .8, .2, 1);
```

Required transitions:

- sidebar hover/active
- header button hover
- panel slide/fade
- node hover lift
- node selected state
- connector running flow
- cards hover lift
- modal/dialog pop
- skeleton shimmer

Reduced-motion must disable all non-essential motion.
