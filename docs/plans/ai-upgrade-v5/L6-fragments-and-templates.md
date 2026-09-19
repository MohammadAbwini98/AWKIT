# L6 — Reusable Fragments & Shared Action Templates

Shared rules, architecture and decisions: `ROADMAP.md`. Depends on L2 and L4. Core behavior is deterministic.

## Audit first (blocking)

Matrix — existing capability / reusable owner / real gap / proposed change / verifier — for: semantic indexing of
flows/workflows, flow clone/import/export, unknown-field preservation, canvas insertion + auto-arrange + history,
shared node/action configuration, data-binding placeholders, dependency/reference validation. No implementation from
assumptions.

## Deterministic features

1. **Fragments** — save a valid subgraph preserving node config, connectors, locator metadata (incl. provenance),
   waits, failure policies, binding placeholders, unknown compatible fields; never resolved secrets or
   environment-specific secret values.
2. **Action templates** — parameterized sequences with explicit required inputs; no protected-login templates.
3. **Insertion** — existing canvas/history/auto-arrange path, then binding resolution and immediate validation; undo/redo,
   save/reload, import/export.

## Intelligence

- Discovery: semantic index retrieves candidate fragments/templates first (extend Zvec projections if needed).
- AI: summary (T0) and parameter-mapping suggestion (T1). Never auto-insert or auto-bind.
- Optional automation: while editing, show a passive "similar fragment exists" hint from semantic retrieval (no model).

## Verifiers

`verify:flow-fragments` (only if no existing verifier owns it), `verify:ai-fragment-assist` (fake provider); existing
semantic, profile-store, designer/builder, history and validation gates; `npm run build`.

## Acceptance

Works with AI disabled; retrieval precedes the model; AI only summarizes/maps; fragments are validated first-class content.
