# File Spec — `app/renderer/components/workflow/FlowNodePropertiesPanel.tsx`

## Goal

Make node properties look and behave like the template right configuration drawer.

## Existing behavior to preserve

- Collapsed rail.
- All existing fields.
- `onUpdateNode` behavior.
- Data sources and saved sessions loading.
- Validation messages.
- Smart waits.
- Details sections.
- Required fields visibility.

## Required markup structure

Current panel begins with:

```tsx
<aside className="properties-panel">
  <div className="properties-heading with-action">...</div>
  {data && selectedNode && definition ? (
    <>
      <details ...>
```

Replace the top-level structure with:

```tsx
<aside className="properties-panel template-config-drawer">
  <div className="properties-heading with-action template-drawer-header">
    <div className="drawer-title-row">
      <div className="drawer-node-icon" aria-hidden="true">
        {definition ? <definition.icon size={18} /> : null}
      </div>
      <div className="properties-heading-text">
        <h2>{data?.name ?? "Node Properties"}</h2>
        <span>
          {selectedNode ? selectedNode.id : "No node selected"}
          {definition ? ` · ${definition.category}` : ""}
        </span>
      </div>
    </div>
    <button className="icon-button" onClick={onToggleCollapsed} title="Collapse properties" type="button">
      <PanelRightClose size={18} />
    </button>
  </div>

  <div className="properties-tabs" role="tablist" aria-label="Node configuration tabs">
    <button className="properties-tab active" type="button">Setup</button>
    <button className="properties-tab" type="button" disabled>Test</button>
  </div>

  <div className="properties-body">
    ...existing field sections...
  </div>

  <div className="properties-footer">
    <button className="toolbar-button" type="button" onClick={onToggleCollapsed}>Close</button>
    <button className="toolbar-button primary" type="button" disabled={!selectedNode}>Save</button>
  </div>
</aside>
```

## Important

- The Save button may be visually present but should not fake behavior. If all node changes are already live-bound, label it `Done` or hide it. Preferred: `Done` button collapses drawer.
- If using `<definition.icon />` is invalid because icons are not stored there, use the catalog item or a generic icon.
- Keep every existing `details.property-group` section inside `.properties-body`.
- Do not remove validation messages.

## Section style

Add class names where useful:

```tsx
<details className="property-group template-property-section" open>
```

## Overflow requirement

The only scrollable area should be `.properties-body`. Header/tabs/footer stay visible.

## Collapsed state

Keep current collapsed markup but ensure CSS makes it a slim floating rail.

## Verify

```bash
npm run build
npm run verify:flow-designer
```
