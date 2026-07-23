# Custom Brand Logo (Settings → Appearance → Workspace Logo)

A **Super User** can upload a custom workspace logo that overrides the shipped SpecterStudio mark on
the **login screen** and the **sidebar / application chrome**. Removing it restores the shipped default.
The shipped logo, application icons, splash assets, and packaged resources are never modified.

## User model

- The shipped SpecterStudio logo is always the default; a custom logo is an explicit override.
- Uploading, previewing, applying, and removing happen in the Branding card (Super-User-only; hidden for
  other roles, and enforced in the main process — not just the UI).
- Removing / resetting the custom logo restores the shipped default immediately.

## Security model

The trusted boundary is the main process. `src/branding/*` is the single source of truth.

- **Content-signature validation, not extension.** `BrandingValidation.ts` checks the PNG magic bytes,
  reads the IHDR dimensions, and the store additionally runs a real pixel re-decode (`nativeImage`) — a
  valid-looking header over corrupt data is rejected. Bounds: ≤ 5 MB, 32–2048 px.
- **SVG is rasterized, never executed.** SVG uploads are accepted but rasterized to PNG in the browser's
  secure image-decoding mode (scripts never run, external resources never load); the SVG markup is never
  stored and never injected into the DOM. Storage is therefore always PNG.
- **App-managed, atomic storage.** `BrandingLogoStore` writes to a dedicated `branding/active/` folder
  under `%LOCALAPPDATA%\SpecterStudio\` (never `resources/` or `app.asar`) using a stage-then-atomic-
  publish with rollback. A `sha256` is re-verified on every read.
- **No arbitrary file reads.** The upload IPC accepts image **bytes** (a structured-clone `Uint8Array`),
  never a file path, so path traversal / arbitrary-path reads are not possible. The original source path
  is never referenced — deleting the source file after import does not affect the stored logo.
- **Fail-safe fallback.** `BrandingLogoStore.get()` never throws; any inconsistency
  (missing / corrupt / tampered / hash-mismatch / out-of-range / undecodable) resolves to
  `{ active: false }`, and every consumer renders the default via a **presence check, never
  `<img onError>`**, so a broken image can never appear — even mid-swap.
- **Authorization + audit.** `branding:getState` is an open read (every role renders the sidebar);
  `branding:uploadLogo` / `branding:removeLogo` are gated by
  `assertSenderPermission(event, SETTINGS_BRANDING_MANAGE)` (sender-bound, Super-User-only) and every
  mutation is written to the security audit trail. The renderer only ever receives a self-contained
  `data:image/png;base64,…` URL — no absolute filesystem path is exposed.
- **No settings coupling / migration.** Branding state lives on disk, deliberately **not** in
  `ui-settings.json`, so a settings file written before this feature needs no branding field and no
  migration.

## Display

- **Login screen** (`LoginScreen.tsx`) and **sidebar** (`LeftNavigation.tsx`) resolve the active logo
  through the same open `branding.getState()` read, so both always show the same resolved logo.
- Rendering is aspect-preserved and overflow-bounded (`object-fit: contain` + max bounds) and remains
  usable in both light and dark themes.

## Verification

```bash
npm run build                    # tsc + bundles
npm run verify:custom-brand-logo # focused, 31/31 — maps 1:1 to the 15 acceptance cases
npm run verify:branding          # domain model, 47/47
npm run verify:branding-gui      # real Electron end-to-end, 30/30
```

`verify:custom-brand-logo` covers: default fallback, import, restart persistence, login/sidebar parity,
reset, source-file independence, unsupported-format / corrupt / oversized rejection, path-traversal +
unauthorized-IPC gating, missing-asset fallback, light/dark usability, legacy-profile compatibility, and
a guard that this branch leaves `ui-settings.json` and `.beads` untouched.
