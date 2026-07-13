# File Spec — `app/renderer/components/workflow/ConnectionPropertiesPanel.tsx`

## Goal

Make connector properties match the same floating right drawer design as node properties.

## Existing behavior to preserve

- Connector kind and locking rules.
- Conditional config.
- Parallel config.
- Loop config.
- Style editor.
- Delete behavior.
- Data source options.
- Backward compatibility.

## Required markup structure

Current top-level structure starts:

```tsx
<aside className="properties-panel">
  <div className="properties-heading">
    <h2>Connection Properties</h2>
    <span>{edge ? `${edge.source} → ${edge.target}` : "No connection selected"}</span>
  </div>
  {edge ? ( ... ) : ...}
</aside>
```

Change to:

```tsx
<aside className="properties-panel template-config-drawer connection-config-drawer">
  <div className="properties-heading template-drawer-header">
    <div className="drawer-title-row">
      <div className="drawer-node-icon connector-icon" aria-hidden="true">↗</div>
      <div className="properties-heading-text">
        <h2>Connection</h2>
        <span>{edge ? `${edge.source} → ${edge.target}` : "No connection selected"}</span>
      </div>
    </div>
    {edge ? (
      <button className="icon-button danger" onClick={() => onDelete(edge.id)} title="Delete connection" type="button">
        <Trash2 size={17} />
      </button>
    ) : null}
  </div>

  <div className="properties-tabs" role="tablist" aria-label="Connection configuration tabs">
    <button className="properties-tab active" type="button">Setup</button>
    <button className="properties-tab" type="button" disabled>Test</button>
  </div>

  <div className="properties-body">
    ...existing connection sections...
  </div>

  <div className="properties-footer">
    <button className="toolbar-button" type="button" disabled={!edge}>Run Test</button>
    <button className="toolbar-button primary" type="button" disabled={!edge}>Done</button>
  </div>
</aside>
```

## Important

- If `Run Test` has no real behavior, either omit it or render disabled with title `Not available yet`. Do not fake execution.
- Move the existing delete button out of lower content into the header if currently duplicated.
- Keep all fields in `.properties-body`.

## Section labels

Use template section labels:

```tsx
<section className="property-section template-property-section">
  <h3>Configuration</h3>
  ...
</section>
```

## Overflow

- `.properties-body` scrolls.
- Header and footer are sticky/fixed through grid rows.
- Long conditional/parallel forms must not overflow the drawer.

## Verify

```bash
npm run build
npm run verify:flow-designer
```
