# Loop Visual Contract

Status: **authoritative visual acceptance contract** for structured Loop self-edges in Flow Designer and Workflow Builder.

This decision supersedes the structured-Loop visual topology described in the 2026-08-13 entry of `DECISIONS.md`. It does **not** supersede the persisted self-edge model, Loop configuration/runtime semantics, Conditional-exit rules, or legacy cross-node `loopBack` behavior.

## Approved reference

The immutable visual baseline is the central capsule-and-ring implementation represented by commit `7282178` and the historical evidence `reports/loop-connector-fix/flow-central-control.png`.

Do not reinterpret later screenshots or verifier output as authorization to replace this topology. Any future visual replacement requires an explicit owner decision and corresponding update to this file before product code or visual tests change.

## Structured self-loop topology

A structured Loop remains one persisted self-edge owned by its real source node. Its design-time renderer must present:

- one horizontal capsule lane attached directly to the selected side of the real node;
- capsule dimensions of 160 × 20 graph units with a 10-unit end radius;
- one dominant concentric circular control centered halfway along the capsule;
- a 40-unit outer ring, 30-unit main ring, and 44-unit interaction radius;
- the configured `LoopConnectorConfig.maxIterations` value centered inside the dominant ring;
- one circular sweep segment rotating around the main ring;
- the mode-aware design-time summary (`Count × N`, `While · …`, `For Each`, etc.) outside the ring;
- the existing connector identity, selection, keyboard, persistence, and configuration behavior.

The value in the ring is configuration, **not runtime progress**. Normal design mode must never invent `current / total`, current iteration, or execution-progress state.

## Motion

Only the circular sweep rotates. The capsule path, dominant rings, configured value, and label remain stationary.

The sweep uses transform-based continuous motion with no per-frame React state updates. Under `prefers-reduced-motion: reduce`, the sweep becomes a fixed visible segment; the capsule, ring, value, and label stay readable.

## Rejected topology

The following structured-self-loop design is explicitly rejected and must fail GUI verification:

- bottom-center → outside-node → top-center U-shaped routing around the entire node;
- a small hollow side marker without the dominant capsule/ring mechanism;
- absence of the capsule lane;
- absence of the configured value;
- absence of the circular sweep;
- animation placed on a duplicate full return path;
- simultaneous dotted base stroke plus differently dashed animated overlay;
- a separate self-loop arrow/directional overlay used to substitute for the rotating ring sweep.

A structured self-loop must therefore have no `.awkit-loop-direction-path` or self-loop arrow overlay. Legacy cross-node `loopBack` connectors are separate and retain their existing bounded runtime and directional return-path renderer.

## Attachment and lifecycle invariants

The capsule must remain tied to the real node through pan, zoom, drag, save/reload, selection, and reconfiguration. Its route attaches at the same side of the card, remains compact around the capsule height, and must not wrap above and below the whole node.

Multiple Loops must retain independent edge identities, configuration values, labels, selection, and motion. No synthetic graph node or separately persisted visual object may be introduced.

Functional Loop behavior already established by the product remains binding: edit/reopen, save/reload round trip, configuration defaults, Conditional-exit promotion, keyboard access, undo/redo, validation, and runtime/design-time separation must not regress for a visual repair.

## Verification authority

`scripts/verify-flow-designer-gui.mjs` and `scripts/verify-workflow-builder-gui.mjs` must validate this contract through the shared capsule visual oracle. Passing criteria include the capsule, dominant ring/backplate, configured value, rotating sweep, same-side attachment geometry, reduced-motion behavior, and explicit rejection of the full-node U-route hybrid.

A generic pixel-delta assertion is not sufficient visual acceptance by itself. Pixel evidence may prove that the sweep moves, but structural SVG/DOM geometry is the authoritative machine-readable oracle.
