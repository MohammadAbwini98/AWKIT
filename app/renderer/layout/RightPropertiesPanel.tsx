interface RightPropertiesPanelProps {
  title: string;
}

export function RightPropertiesPanel({ title }: RightPropertiesPanelProps) {
  return (
    <aside className="properties-panel">
      <div className="properties-heading">
        <h2>{title}</h2>
        <span>No element selected</span>
      </div>
      <div className="empty-properties">
        Select an element on the canvas to edit its properties here.
      </div>
    </aside>
  );
}
