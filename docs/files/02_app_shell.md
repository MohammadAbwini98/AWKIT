# File Spec — `app/renderer/layout/AppShell.tsx`

## Current issue

The current shell renders the header before the body/sidebar. That does not match the template. The template has a full-height sidebar on the left and the header only over the main content.

## Current code pattern to replace

Current return body resembles:

```tsx
<div className={sidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"}>
  <TopHeader activeRoute={activeRoute} actions={headerActions} canGoBack={canGoBack} onBack={onBack} />
  <div className={sidebarCollapsed ? "app-body collapsed" : "app-body"}>
    <LeftNavigation activeRouteId={activeRouteId} collapsed={sidebarCollapsed} onRouteChange={onRouteChange} onToggle={onToggleSidebar} />
    <main key={activeRouteId} className={animateContent ? "main-surface main-surface-animated" : "main-surface"}>
      {children}
    </main>
  </div>
  <StatusBar />
</div>
```

## Required TypeScript changes

### 1. Add `dirty` to props

Add to `AppShellProps`:

```ts
dirty: boolean;
```

### 2. Accept `dirty` in function args

```ts
export function AppShell({
  activeRoute,
  activeRouteId,
  canGoBack,
  children,
  dirty,
  headerActions,
  sidebarCollapsed,
  onBack,
  onRouteChange,
  onToggleSidebar
}: AppShellProps) {
```

### 3. Replace return structure

Replace the return with this structure:

```tsx
return (
  <div className={sidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"}>
    <LeftNavigation
      activeRouteId={activeRouteId}
      collapsed={sidebarCollapsed}
      onRouteChange={onRouteChange}
      onToggle={onToggleSidebar}
    />

    <div className="app-main">
      <TopHeader
        activeRoute={activeRoute}
        actions={headerActions}
        canGoBack={canGoBack}
        dirty={dirty}
        onBack={onBack}
      />

      <main key={activeRouteId} className={animateContent ? "main-surface main-surface-animated" : "main-surface"}>
        {children}
      </main>

      <StatusBar />
    </div>
  </div>
);
```

## Do not change

- `CANVAS_ROUTES` exclusion logic.
- `key={activeRouteId}` behavior.
- Navigation callbacks.
- Children rendering.

## Expected result

- Sidebar starts at the very top of the window.
- Header starts to the right of the sidebar.
- Canvas pages still avoid route-content fade.

## Verify

```bash
npm run build
npm run verify:flow-designer
npm run verify:workflow-builder
```
