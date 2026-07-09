# File Spec — `app/renderer/layout/LeftNavigation.tsx`

## Goal

Make AWKIT sidebar visually match the template without deleting existing routes.

## Required design behavior

- Full-height sidebar.
- Brand row at top.
- Main route list with simple line icons.
- Grouped route sections stay, but spacing/typography should be template-like.
- Bottom utility zone: Settings and Dark Mode toggle.
- Workspace/user row at bottom if using safe static existing app identity.
- Collapsed state must remain usable.

## Current structure to preserve

The current component already has:

- `routeGroups`
- `routes`
- `useTheme`
- collapse toggle
- dark mode toggle

Preserve all routes.

## Required TypeScript changes

### 1. Keep `routeGroups`, but rename labels for visual fit if desired

Allowed visual mapping:

```ts
const routeGroups = [
  { label: "Build", routes: [...] },
  { label: "Data", routes: [...] },
  { label: "Run", routes: [...] },
  { label: "Reports", routes: [...] },
  { label: "System", routes: [...] }
];
```

Do not remove any route IDs.

### 2. Brand text

Update brand display to AWKIT or current product name, but keep it professional:

```tsx
<span className="brand-name">
  <span>AWKIT</span>
  <small>Automation workbench</small>
</span>
```

Do not use Hologram name/logo in production.

### 3. Footer utility layout

Add footer grouping:

```tsx
<div className="nav-footer">
  <button className="nav-item nav-footer-item" onClick={() => onRouteChange("settings")} type="button">
    <SettingsIcon size={17} />
    {!collapsed ? <span>Settings</span> : null}
  </button>

  <button className="nav-item nav-theme-toggle" ...>
    ...
  </button>

  {!collapsed ? (
    <div className="nav-user-row">
      <span className="nav-user-avatar">A</span>
      <span>
        <strong>AWKIT</strong>
        <small>Local workspace</small>
      </span>
    </div>
  ) : null}
</div>
```

If Settings already appears under System, avoid duplicate route confusion by either:

- keep Settings in main route group but also allow footer shortcut, or
- render Settings only in footer while preserving route availability.

Do not remove the route from `routes.tsx`.

## CSS handles

Make sure these classes are styled in `global.css`:

```text
.nav-footer-item
.nav-user-row
.nav-user-avatar
.nav-theme-toggle
.theme-switch
.theme-switch-thumb
```

## Verify

```bash
npm run build
npm run verify:flow-designer
npm run verify:workflow-builder
```
