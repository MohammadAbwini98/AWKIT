import { Moon, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { routes, type RouteId } from "../routes";
import { useTheme } from "../state/theme";

const routeGroups = [
  {
    label: "Build",
    routes: ["dashboard", "workflowsLibrary", "scenarioBuilder", "flowLibrary", "flowChart", "formDesigner", "recorder"] satisfies RouteId[]
  },
  {
    label: "Data",
    routes: ["dataSources", "runtimeInputs", "sessions"] satisfies RouteId[]
  },
  {
    label: "Run",
    routes: ["executionMonitor", "instanceMonitor"] satisfies RouteId[]
  },
  {
    label: "Reports",
    routes: ["reportsOverview", "reportsWorkflows", "reportsInstances", "reportsChrome", "reportsRuntime", "reportsFailures", "reportsServer", "reports"] satisfies RouteId[]
  },
  {
    label: "System",
    routes: ["roadmap", "projectContract", "offlineRuntime", "settings"] satisfies RouteId[]
  }
];

interface LeftNavigationProps {
  activeRouteId: RouteId;
  collapsed: boolean;
  onRouteChange: (routeId: RouteId) => void;
  onToggle: () => void;
}

export function LeftNavigation({ activeRouteId, collapsed, onRouteChange, onToggle }: LeftNavigationProps) {
  const { resolvedTheme, setAppearance } = useTheme();
  const isDark = resolvedTheme === "dark";
  return (
    <nav className={collapsed ? "left-navigation collapsed" : "left-navigation"} aria-label="Primary">
      <div className="brand-block">
        <span className="brand-mark">WFS</span>
        {!collapsed ? (
          <span className="brand-name">
            <span>WebFlow Studio</span>
            <small>Automation workbench</small>
          </span>
        ) : null}
        <button
          className="nav-collapse-button"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={onToggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          type="button"
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>
      <div className="navigation-list">
        {routeGroups.map((group) => (
          <section className="nav-group" key={group.label}>
            {!collapsed ? <span className="nav-group-label">{group.label}</span> : null}
            {group.routes.map((routeId) => {
              const route = routes.find((item) => item.id === routeId);
              if (!route) return null;

              const Icon = route.icon;
              return (
                <button
                  className={route.id === activeRouteId ? "nav-item active" : "nav-item"}
                  key={route.id}
                  onClick={() => onRouteChange(route.id)}
                  title={collapsed ? route.label : route.description}
                  type="button"
                >
                  <Icon size={17} />
                  {!collapsed ? <span>{route.label}</span> : null}
                </button>
              );
            })}
          </section>
        ))}
      </div>
      <div className="nav-footer">
        <button
          className="nav-item nav-theme-toggle"
          aria-pressed={isDark}
          onClick={() => setAppearance(isDark ? "light" : "dark")}
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          type="button"
        >
          <Moon size={17} />
          {!collapsed ? (
            <>
              <span>Dark Mode</span>
              <span className={isDark ? "theme-switch on" : "theme-switch"} aria-hidden="true">
                <span className="theme-switch-thumb" />
              </span>
            </>
          ) : null}
        </button>
      </div>
    </nav>
  );
}
