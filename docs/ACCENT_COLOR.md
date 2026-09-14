# Accent Color (Appearance → Accent Color)

User-selectable application accent (brand) color. The built-in solid default is the reference blue
`#1D4ED8`; users can choose another **solid** color or a **two-color gradient**, including the built-in
**Specter Blue** preset. It is applied live, persisted per user, and restored on startup with no
default-blue flash.

## Setting

Stored under `accent` in `ui-settings.json` (runtime data root); legacy `{ color }` values migrate
automatically:

```jsonc
"accent": {
  "mode": "solid" | "gradient",
  "primaryColor": "#RRGGBB" | null,   // null (solid) = built-in default blue
  "secondaryColor": "#RRGGBB" | null, // gradient second stop
  "preset": "default-purple" | "specter-blue" | "custom",
  "gradientAngle": 0..359
}
```

- **Default Blue** = `#1D4ED8` in both light and dark themes. `Reset to Default Blue` restores it
  exactly. The persisted `default-purple` preset identifier is retained solely for settings-file
  compatibility; it is not presented to users.
- **Specter Blue** = `#1D4ED8 → #38BDF8` at 135° — an optional gradient whose primary stop matches the
  default accent. The shipped `specter-logo.svg` is left untouched.
- Accent is per-user UI state via the generic `settings.update` deep-partial channel — **no new IPC**
  and not `SETTINGS_EDIT`-gated.

## How it is applied

The accent is already centralized behind CSS custom properties, so this is a **runtime token override**,
never a hunt-and-replace:

- Pure, framework-free core: [`src/theme/accentColor.ts`](../src/theme/accentColor.ts) — validate /
  normalize / migrate, derive the light+dark token maps, WCAG-aware foreground pick, visibility rescue.
- Renderer: `app/renderer/state/accentTheme.ts` applies/clears inline `<html>` vars and caches the
  derived maps in `localStorage` (`awkit-accent-tokens`); `state/theme.tsx` carries `accent`/`setAccent`;
  `App.tsx` re-applies on accent or resolved-theme change; `index.html` has a **pre-mount bootstrap** that
  applies the cached accent before React renders (no flash), including on the login screen.
- Card: `app/renderer/pages/AccentColorSettings.tsx` (Apply-gated draft + scoped live preview).

In dark mode, the neutral `--awkit-text`, `--awkit-text-secondary`, and `--awkit-text-muted` tokens
resolve to white so labels and static copy remain clearly readable. Status, error, disabled, and focus
semantics retain their dedicated tokens.

**Gradient scope:** gradient mode sets `document.documentElement.dataset.accentMode = "gradient"`, and CSS
gates gradient backgrounds behind `:root[data-accent-mode="gradient"]` on **high-value surfaces only**
(primary buttons, active nav, selected canvas nodes). Fine controls, ports, focus rings, and connectors
stay **solid**. Semantic status colors (success/warning/danger/info) and the avatar palette are never
touched.

## Verification

```bash
npm run build                # tsc + bundles
npm run verify:accent-theme  # pure model, 71/71
npm run verify:accent-gui    # real Electron end-to-end, 33/33
```

The GUI verifier asserts the inherited `--awkit-accent` custom property on controls rather than
`getComputedStyle().backgroundColor` (which reads a mid-transition color right after Apply).

## Optional follow-up (non-blocking)

The `app/renderer/security/SecurityGate.tsx` accent hunk from the original mixed source — a refinement
that re-applies the accent on a **live OS light↔dark switch while signed out** — was intentionally not
ported. The `index.html` pre-mount bootstrap already applies the accent on the login screen, and the GUI
verifier's login checks pass without it. This is optional polish, safe to add later.
