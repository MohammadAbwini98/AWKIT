import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { routes, type RouteId } from "../routes";

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
    routes: ["executionMonitor", "instanceMonitor", "reports"] satisfies RouteId[]
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
    </nav>
  );
}
