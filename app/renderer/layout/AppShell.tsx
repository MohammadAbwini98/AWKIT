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
  return (
    <div className={sidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"}>
      <TopHeader activeRoute={activeRoute} actions={headerActions} canGoBack={canGoBack} onBack={onBack} />
      <div className={sidebarCollapsed ? "app-body collapsed" : "app-body"}>
        <LeftNavigation activeRouteId={activeRouteId} collapsed={sidebarCollapsed} onRouteChange={onRouteChange} onToggle={onToggleSidebar} />
        <main className="main-surface">{children}</main>
      </div>
      <StatusBar />
    </div>
  );
}
