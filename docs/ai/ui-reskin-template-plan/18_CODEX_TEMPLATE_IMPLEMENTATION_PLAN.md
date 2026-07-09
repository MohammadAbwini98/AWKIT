# Codex Template Implementation Plan

**Date:** 2026-07-08  
**Agent:** Codex  
**Scope:** renderer visual/UI completion pass only; no runner, IPC, route contract, or automation behavior changes planned.

## Asset Reviewed

- `UI Samples/sample_01.png` reviewed directly. It shows the Hologram workflow builder target: full-height white sidebar, compact white header, pale dotted workflow canvas, rounded white node cards, violet connectors with inline add buttons, bottom zoom pill, and a floating right configuration drawer with Setup/Test tabs.
- Attached `image-1.png` reviewed directly; it matches `UI Samples/sample_01.png`.
- `UI Samples/Sample02.mp4`, `UI Samples/sample_03.mp4`, and `UI Samples/sample_04.mp4` were present locally. `ffmpeg`/`ffprobe` were unavailable. A local Chrome + Playwright seek/screenshot attempt timed out before producing new frames, so no new fresh mp4 frames were created in this pass. The prior extraction evidence remains available under `docs/ai/ui-reskin-template-plan/mockups/screenshots/template-frames/`.
- The four Dribbble URLs were reachable as text pages. They confirmed the Hologram source, creator metadata, palette chips, and action/integration/workflow/dashboard design intent, but local image/video assets remain the primary visual source for implementation.

## Main Visual Observations

- The UI is light-first, quiet, and high-density: off-white app background, white surfaces, thin low-opacity borders, restrained shadows, compact text, and a single violet accent.
- The shell has a full-height sidebar and a header only over the main content, not above the sidebar.
- The canvas is the dominant surface: pale dotted background, no heavy framed card around React Flow, floating overlays only where needed.
- Node cards are short, rounded, white cards with an icon tile, small muted metadata, bold title, optional badge/index, and kebab affordance.
- The right drawer floats over the canvas with a large radius, shadow, sticky header, tab strip, scroll body, and sticky footer.

## Motion Observations

- Template motion is subtle and transform/opacity based: drawer slide/fade, hover lift, selected-state glow, connector flow dash, toast/dialog pop, and skeleton shimmer.
- Reduced-motion must neutralize all CSS transitions and animations.

## Color Observations

- Primary target is a Hologram-like light palette:
  - background `#f6f4f9`
  - canvas `#f3f0f8`
  - surface `#ffffff`
  - text `#20172f`
  - muted text `#91899f`
  - accent `#7c3aed`
- Semantic green/red/amber should be reserved for runtime state, warnings, errors, and validation rather than the resting connector graph.

## Spacing/Padding Observations

- Controls are compact: 34-40px heights, 10-14px radii, 12-20px panel padding.
- Cards/panels use soft radius and gentle depth, not heavy frames.
- Canvas overlays must scroll internally and not create body-level overflow.

## Panel/Drawer Observations

- Drawers should float and never steal grid width from the canvas.
- Long forms need one internal scroll body; header/tabs/footer remain visible.
- Test tabs/buttons stay disabled where AWKIT has no real per-node test runner.

## Canvas Observations

- Canvas pages need full available height below the app header and above the status bar.
- React Flow parent containers must not receive mount transforms because that can break measurement.
- Palette, drawer, minimap, and zoom pill need predictable z-index layering.

## Node Observations

- Flow nodes should use template anatomy already implemented in `ActionFlowNode`.
- Scenario/workflow nodes can preserve their existing semantics but need the same tokenized card polish and connector styling.
- Port/handle placement, NodeResizer, loop button, dynamic branch handles, and saved node sizes must remain unchanged.

## Connector Observations

- Default connectors should be violet, thin, curved, and softly highlighted on hover/selection.
- Label pills should sit on connectors with readable white backgrounds.
- Inline add affordance should be display-only and never persist to saved flow JSON.

## Loader/Empty-State Observations

- Loading and empty states should look like first-class template surfaces: shimmer skeletons, compact dashed empty panels, spinning loaders, and pulse dots.
- Busy states should avoid layout jump and honor reduced motion.

## Implementation Mapping To AWKIT Files

- `app/renderer/layout/StatusBar.tsx`: replace static status text with real runtime status polling.
- `app/renderer/styles/global.css`: align light tokens to the requested palette, add missing muted status tokens, add spinner/loader/skeleton utility classes, tighten canvas/sidebar/header/palette/drawer/card polish, and keep reduced-motion last.
- `app/renderer/components/instances/RecoverableRunsPanel.tsx`: token-convert remaining inline border.
- `app/renderer/pages/Recorder.tsx`: token-convert remaining inline legacy borders.
- `app/renderer/pages/SessionsManager.tsx`: token-convert remaining inline legacy borders.
- `docs/ai/ui-reskin-template-plan/19_CODEX_TEMPLATE_COMPLETION_REPORT.md`: document implementation, screenshots, verification, remaining gaps.
- `docs/ai/CURRENT_STATE.md` and `docs/ai/TASK_LOG.md`: record the completed UI pass.
