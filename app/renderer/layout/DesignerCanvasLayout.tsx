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
      {rightPanel ?? <RightPropertiesPanel title={propertiesTitle} />}
    </section>
  );
}
