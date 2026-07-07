import type { ReactNode } from "react";
import type { AppRoute, RouteId } from "../routes";
import type { PageAction } from "../state/pageChrome";
import { LeftNavigation } from "./LeftNavigation";
import { StatusBar } from "./StatusBar";
import { TopHeader } from "./TopHeader";

interface AppShellProps {
  activeRoute: AppRoute;
  activeRouteId: RouteId;
  canGoBack: boolean;
  children: ReactNode;
  headerActions: PageAction[];
  sidebarCollapsed: boolean;
  onBack: () => void;
  onRouteChange: (routeId: RouteId) => void;
  onToggleSidebar: () => void;
}

/**
 * Canvas/designer routes are excluded from the route-content fade: a mount transform on the
 * container can perturb React Flow's coordinate measurement, and those surfaces have their own
 * carefully-preserved geometry (see Phase 10 / 03_ENHANCED_WORKFLOW_BUILDER_CANVAS_NODES.md).
 */
const CANVAS_ROUTES: ReadonlySet<RouteId> = new Set(["flowChart", "scenarioBuilder", "workflow", "formDesigner"]);

export function AppShell({
  activeRoute,
  activeRouteId,
  canGoBack,
  children,
  headerActions,
  sidebarCollapsed,
  onBack,
  onRouteChange,
  onToggleSidebar
}: AppShellProps) {
  const animateContent = !CANVAS_ROUTES.has(activeRouteId);
  return (
    <div className={sidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"}>
      <TopHeader activeRoute={activeRoute} actions={headerActions} canGoBack={canGoBack} onBack={onBack} />
      <div className={sidebarCollapsed ? "app-body collapsed" : "app-body"}>
        <LeftNavigation activeRouteId={activeRouteId} collapsed={sidebarCollapsed} onRouteChange={onRouteChange} onToggle={onToggleSidebar} />
        {/* keyed by route so the fade re-triggers on each navigation (not on in-page updates) */}
        <main key={activeRouteId} className={animateContent ? "main-surface main-surface-animated" : "main-surface"}>
          {children}
        </main>
      </div>
      <StatusBar />
    </div>
  );
}
