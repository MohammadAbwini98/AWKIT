# 03 — Design Tokens & global.css Plan

**Principle:** keep the existing `--awkit-*` token *names* (so already-tokenized rules upgrade for
free) and **swap their values** to the dark set. Add a few new tokens for gradient/glow/node/connector.
Introduce `[data-theme="dark"]` as the applied theme; keep the light values available under
`[data-theme="light"]` for rollback. All additive — no class renames.

## Proposed `:root` / theme block (target)
```css
:root, [data-theme="dark"] {
  /* backdrop + surfaces */
  --awkit-bg:            #0a0c14;
  --awkit-bg-grad:       radial-gradient(1200px 700px at 78% -10%, rgba(124,92,255,.18), transparent 60%),
                         radial-gradient(1000px 620px at -8% 8%, rgba(59,130,246,.14), transparent 55%),
                         #0a0c14;
  --awkit-surface:       #12141f;
  --awkit-surface-soft:  #171a27;
  --awkit-surface-inset: #0e1019;
  --awkit-glass:         rgba(23,26,39,.72);
  --awkit-border:        rgba(255,255,255,.08);
  --awkit-border-strong: rgba(255,255,255,.14);

  /* text */
  --awkit-text:          #f5f6fb;
  --awkit-text-secondary:#aab1c9;
  --awkit-text-muted:    #6c7391;

  /* accents */
  --awkit-purple:        #7c5cff;
  --awkit-purple-deep:   #5b3fd6;
  --awkit-blue:          #3b82f6;
  --awkit-blue-deep:     #2563eb;
  --awkit-accent-grad:      linear-gradient(135deg,#7c5cff 0%,#3b82f6 100%);
  --awkit-accent-grad-soft: linear-gradient(135deg,rgba(124,92,255,.16),rgba(59,130,246,.12));

  /* status (+ soft bg) */
  --awkit-success:#34d399; --awkit-success-soft:rgba(52,211,153,.14);
  --awkit-warning:#fbbf24; --awkit-warning-soft:rgba(251,191,36,.14);
  --awkit-danger: #f87171; --awkit-danger-soft: rgba(248,113,113,.14);
  --awkit-info:   #60a5fa; --awkit-info-soft:   rgba(96,165,250,.14);
  --awkit-neutral-soft: rgba(255,255,255,.06);

  /* gauge / pressure bands */
  --awkit-band-normal: var(--awkit-success);
  --awkit-band-warning:var(--awkit-warning);
  --awkit-band-high:   var(--awkit-danger);

  /* radius */
  --awkit-radius-card:16px; --awkit-radius-panel:20px;

  /* depth + glow */
  --awkit-shadow-card:  0 2px 4px rgba(0,0,0,.30), 0 12px 32px rgba(0,0,0,.36);
  --awkit-shadow-float: 0 8px 24px rgba(0,0,0,.40), 0 24px 60px rgba(0,0,0,.45);
  --awkit-glow-accent:  0 0 0 1px rgba(124,92,255,.35), 0 8px 30px rgba(124,92,255,.28);

  /* motion (unchanged names) */
  --awkit-ease-out: cubic-bezier(.22,1,.36,1);
  --awkit-dur-fast:120ms; --awkit-dur-med:220ms; --awkit-dur-slow:360ms;

  /* z-layers (unchanged) */
  --awkit-z-panel:20; --awkit-z-toolbar:30; --awkit-z-drawer:40; --awkit-z-modal:50; --awkit-z-toast:60;

  /* NEW: workflow node + connector tokens (move hardcoded values here) */
  --awkit-node-surface: var(--awkit-surface);
  --awkit-node-border:  var(--awkit-border);
  --awkit-node-radius:  14px;
  --awkit-node-icon-bg: var(--awkit-accent-grad-soft);
  --awkit-node-icon-fg: var(--awkit-purple);
  --awkit-handle:       var(--awkit-purple);
  --awkit-conn-success:#34d399; --awkit-conn-failure:#f87171; --awkit-conn-always:#60a5fa;
  --awkit-conn-conditional:#fbbf24; --awkit-conn-outcome:#fb923c; --awkit-conn-manual:#a78bfa;
  --awkit-conn-loop:#2dd4bf; --awkit-conn-loopback:#22d3ee; --awkit-conn-parallel:#8b5cf6;
  --awkit-conn-default:#8b93ad;
  --awkit-chart-1:#7c5cff; --awkit-chart-2:#3b82f6; --awkit-chart-3:#34d399;
  --awkit-chart-4:#fbbf24; --awkit-chart-5:#f87171; --awkit-chart-6:#22d3ee;
}
[data-theme="light"] { /* keep prior light values here for rollback / future toggle */ }
```

## Token groups covered
Colors, backgrounds, surfaces, text, borders, shadows, glow, radius, spacing (reuse existing `--space-*`,
`--radius-*`), typography (keep Inter stack), motion, z-index, status, chart colors, node tokens, connector
tokens, backward-compatible aliases.

## Backward-compatible aliases
Keep old names pointing at new intent so untouched rules still read: `--awkit-info: var(--awkit-blue)`,
`--awkit-success-soft` etc. retained. Old page code referencing `--awkit-surface`/`--awkit-text` upgrades
automatically once values flip.

## Hardcoded color replacement plan (ordered)
1. **Base backdrop:** set `:root{background:var(--awkit-bg-grad)}`; replace `:root{background:#f4f6f9}` and `color:#172033`.
2. **Shell:** `.top-header`, `.left-navigation`, `.status-bar`, brand → tokens (kills `#ffffff`, `#dde3ed`).
3. **Cards/panels:** already mostly tokenized — verify, add gradient top-line.
4. **Text greys:** map `#617089/#8492a8/#5a6b85/#506078/#41506a` → `--awkit-text-secondary/-muted` via find-and-group.
5. **Node/connector:** `.action-flow-node`, handles, tags, `connectorStyle.ts` map → node/connector tokens.
6. **Status greys/tints:** map `#eef5ff/#ecfdf3/#fef3f2/#fff5df` → `*-soft` tokens.
7. **Charts/inline styles:** replace per-series hex in `.tsx` with `--awkit-chart-*` (read via `getComputedStyle` or CSS where possible).

Do this **incrementally by surface** (see 11), rebuilding after each so regressions localize.

## CSS specificity strategy
- Prefer editing existing selectors in place (same specificity) over adding overrides.
- No `!important` except the reduced-motion kill-switch.
- `[data-theme="dark"]` on `:root`/`<html>` (attribute) has the same specificity as `:root` — set it once at app mount; keep base values under `:root` so unthemed still renders dark.
- React Flow internals (`.react-flow__*`) styled by class only; never inline-override the library's transforms.
