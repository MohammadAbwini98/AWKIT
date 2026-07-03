import type { EdgeVisualStyle } from "@src/profiles/FlowProfile";
import { connectorColorPresets, hasCustomStyle } from "./connectorStyle";

interface ConnectorStyleEditorProps {
  style: EdgeVisualStyle | undefined;
  onChange: (patch: Partial<EdgeVisualStyle>) => void;
  onReset: () => void;
}

/**
 * Shared "Connector Style" editor used by both the Flow Designer and Workflow Builder
 * Connection Properties panels (Task 06). Edits color / line style / thickness / shape /
 * arrowhead, with a reset to the default (by-type) style.
 */
export function ConnectorStyleEditor({ style, onChange, onReset }: ConnectorStyleEditorProps) {
  const s = style ?? {};
  return (
    <section className="property-section">
      <h3>Connector Style</h3>
      <label>
        Line color
        <select value={s.color ?? ""} onChange={(event) => onChange({ color: event.target.value || undefined })}>
          {connectorColorPresets.map((preset) => (
            <option key={preset.value || "default"} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Line style
        <select value={s.lineStyle ?? "solid"} onChange={(event) => onChange({ lineStyle: event.target.value as EdgeVisualStyle["lineStyle"] })}>
          <option value="solid">Solid</option>
          <option value="dashed">Dashed</option>
          <option value="dotted">Dotted</option>
        </select>
      </label>
      <label>
        Thickness
        <select value={String(s.thickness ?? 2)} onChange={(event) => onChange({ thickness: Number(event.target.value) })}>
          <option value="1">Thin (1px)</option>
          <option value="2">Normal (2px)</option>
          <option value="3">Medium (3px)</option>
          <option value="4">Thick (4px)</option>
          <option value="5">Heavy (5px)</option>
        </select>
      </label>
      <label>
        Connector shape
        <select value={s.shape ?? "smoothstep"} onChange={(event) => onChange({ shape: event.target.value as EdgeVisualStyle["shape"] })}>
          <option value="smoothstep">Smooth Step</option>
          <option value="bezier">Curved (Bezier)</option>
          <option value="straight">Straight</option>
          <option value="step">Step</option>
          <option value="circular">Circular / Self-loop</option>
        </select>
        <small>Use curved or circular connectors for loops and complex routing paths.</small>
      </label>
      <label>
        Arrowhead
        <select value={s.arrowHead ?? "closed"} onChange={(event) => onChange({ arrowHead: event.target.value as EdgeVisualStyle["arrowHead"] })}>
          <option value="closed">Closed arrow</option>
          <option value="default">Default arrow</option>
          <option value="none">None</option>
        </select>
      </label>
      <button className="toolbar-button" type="button" onClick={onReset} disabled={!hasCustomStyle(style)} title="Remove custom style (use the default for this connector type)">
        Reset to default style
      </button>
    </section>
  );
}
