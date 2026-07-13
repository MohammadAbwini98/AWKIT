import { useLayoutEffect, useRef, type ReactNode } from "react";
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
  const resolvedRightPanel = rightPanel === undefined ? <RightPropertiesPanel title={propertiesTitle} /> : rightPanel;
  const hasRightPanel = resolvedRightPanel !== null;
  const sectionRef = useRef<HTMLElement>(null);

  // Flush designer pages render an in-canvas action bar in the first shell row; the right drawer is a
  // sibling column that spans the whole layout height, so it must start below that bar to avoid covering
  // it. The bar wraps at narrow widths, so a fixed offset lets the drawer overflow up into the toolbar —
  // measure the real bar height and expose it as a CSS var the drawer's padding-top reads.
  useLayoutEffect(() => {
    const section = sectionRef.current;
    if (!section || !flush) return;
    const actionBar = section.querySelector<HTMLElement>(".flow-action-bar");
    if (!actionBar) return;
    const apply = () => {
      section.style.setProperty("--awkit-action-bar-h", `${actionBar.offsetHeight}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(actionBar);
    return () => observer.disconnect();
  }, [flush, children]);

  const className = [
    "designer-layout",
    flush ? "flush-layout" : "",
    hasRightPanel ? "has-right-panel" : "",
    hasRightPanel && rightCollapsed ? "right-collapsed" : ""
  ].filter(Boolean).join(" ");
  return (
    <section ref={sectionRef} className={className}>
      <div className={flush ? "designer-canvas flush" : "designer-canvas"}>{children}</div>
      {/* The slot is a real layout column while populated, so opening the inspector reduces the
          canvas viewport instead of covering nodes and connectors. */}
      {hasRightPanel ? <div className="designer-right-drawer-slot">{resolvedRightPanel}</div> : null}
    </section>
  );
}
