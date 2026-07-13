# File Spec — `app/renderer/layout/TopHeader.tsx`

## Goal

Make the top header match the template: title + real status chip + muted subtitle + compact action cluster.

## Required changes

### 1. Update props

Change interface:

```ts
interface TopHeaderProps {
  activeRoute: AppRoute;
  actions: PageAction[];
  canGoBack: boolean;
  dirty: boolean;
  onBack: () => void;
}
```

### 2. Update function signature

```ts
export function TopHeader({ activeRoute, actions, canGoBack, dirty, onBack }: TopHeaderProps) {
```

### 3. Replace header title block

Replace current `.header-title` content with:

```tsx
<div className="header-title">
  <strong>{activeRoute.label}</strong>
  {dirty ? <span className="header-dirty-chip">Unsaved changes</span> : null}
  <span className="header-subtitle">{activeRoute.description}</span>
</div>
```

Do not display fake updated timestamps. Only show data that exists.

### 4. Improve action button classes

Change action button className computation:

```tsx
className={[
  action.variant === "primary" ? "toolbar-button primary header-primary-action" : "toolbar-button header-secondary-action",
  action.disabled ? "is-disabled" : ""
].filter(Boolean).join(" ")}
```

### 5. Keep back button

Keep the existing back button, but it will be styled by CSS as a compact icon square.

## Expected visual result

- Title is 18px, left aligned.
- Dirty chip appears beside title only when real dirty state is true.
- Actions look like template header controls.
- Primary action is violet.

## Verify

```bash
npm run build
```
