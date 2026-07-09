import type { ReactNode } from "react";
import { RightPropertiesPanel } from "./RightPropertiesPanel";

interface DesignerCanvasLayoutProps {
  children: ReactNode;
  propertiesTitle?: string;
  rightPanel?: ReactNode;
  flush?: boolean;
  rightCollapsed?: boolean;
}

export function DesignerCanvasLayout({
  children,
  propertiesTitle = "Properties",
  rightPanel,
  flush = false,
  rightCollapsed = false
}: DesignerCanvasLayoutProps) {
  const className = ["designer-layout", flush ? "flush-layout" : "", rightCollapsed ? "right-collapsed" : ""].filter(Boolean).join(" ");
  return (
    <section className={className}>
      <div className={flush ? "designer-canvas flush" : "designer-canvas"}>{children}</div>
      {/* Template config drawer: floats over the canvas instead of stealing a layout column, so
          the workflow surface keeps its full geometry. The slot is pointer-transparent; only the
          drawer inside it receives events (see .designer-right-drawer-slot in global.css). */}
      <div className="designer-right-drawer-slot">{rightPanel ?? <RightPropertiesPanel title={propertiesTitle} />}</div>
    </section>
  );
}
