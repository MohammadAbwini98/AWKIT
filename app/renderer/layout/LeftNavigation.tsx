import { ChevronDown, HelpCircle, Moon, PanelLeftClose, PanelLeftOpen, Settings as SettingsIcon, Sun, Workflow } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { routes, type RouteId } from "../routes";
import { useTheme } from "../state/theme";
import { usePermissions } from "../security/usePermissions";
import { RoutePermissions } from "../security/routePermissions";
import { Permission } from "@src/security/authz/Permissions";

/**
 * The SpecterStudio application mark (concept "1c" — spectral edge): a near-black continuous-corner
 * squircle with an off-white brick-form "S" whose trailing brick catches a subtle spectrum accent.
 * Matches resources/icon.* so the in-app brand and the OS/taskbar icon are the same identity.
 */
function SpecterAppIcon({ size = 32 }: { size?: number }) {
  const rid = useId().replace(/:/g, "");
  const grad = `sp-${rid}`;
  const clip = `sq-${rid}`;
  return (
    <svg className="brand-app-icon" width={size} height={size} viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7cc7ff" />
          <stop offset="50%" stopColor="#b98cff" />
          <stop offset="100%" stopColor="#ff8fa3" />
        </linearGradient>
        <clipPath id={clip}>
          <path d="M512 0 C880 0 1024 144 1024 512 C1024 880 880 1024 512 1024 C144 1024 0 880 0 512 C0 144 144 0 512 0 Z" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect x="0" y="0" width="1024" height="1024" fill="#0f0f0f" />
        <g transform="translate(302,272) scale(1.4)">
          <rect x="0" y="0" width="130" height="150" rx="20" fill="#f6f6f6" />
          <path d="M160 0 H225 Q300 0 300 75 Q300 150 225 150 H160 Z" fill="#f6f6f6" />
          <path d="M75 190 H140 V340 H75 Q0 340 0 265 Q0 190 75 190 Z" fill={`url(#${grad})`} />
          <rect x="170" y="190" width="130" height="150" rx="20" fill="#f6f6f6" />
        </g>
      </g>
    </svg>
  );
}

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
    // Settings + Help Center (projectContract) are surfaced in the pinned footer utility area, not here.
    label: "System",
    routes: ["roadmap", "offlineRuntime"] satisfies RouteId[]
  },
  {
    // Super User Administration — hidden entirely for users without the relevant permissions.
    label: "Administration",
    routes: ["userManagement", "roles", "permissionsMatrix", "auditLog", "licensing"] satisfies RouteId[]
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
  const { can } = usePermissions();
  const isDark = resolvedTheme === "dark";
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => Object.fromEntries(routeGroups.map((group) => [group.label, true])));
  // Filter each group's routes by the signed-in principal's permissions; drop empty groups (UI hint only —
  // the real boundary is the main-process IPC permission check).
  const visibleGroups = useMemo(
    () =>
      routeGroups
        .map((group) => ({ ...group, routes: group.routes.filter((id) => { const perm = RoutePermissions[id]; return !perm || can(perm); }) }))
        .filter((group) => group.routes.length > 0),
    [can]
  );
  return (
    <nav className={collapsed ? "left-navigation collapsed" : "left-navigation"} aria-label="Primary">
      <div className="brand-block">
        <div className="brand-tile">
          <SpecterAppIcon size={32} />
          {!collapsed ? (
            <span className="brand-name">
              <span>SpecterStudio</span>
            </span>
          ) : null}
        </div>
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
        {visibleGroups.map((group) => (
          <section className="nav-group" key={group.label}>
            {!collapsed ? (
              <button
                type="button"
                className="nav-group-toggle"
                aria-expanded={openGroups[group.label]}
                onClick={() => setOpenGroups((current) => ({ ...current, [group.label]: !current[group.label] }))}
              >
                <span>{group.label}</span>
                <span>{group.routes.length}</span>
                <ChevronDown size={14} className={openGroups[group.label] ? "" : "collapsed"} />
              </button>
            ) : null}
            <div className={collapsed || openGroups[group.label] ? "nav-group-items open" : "nav-group-items"}>
              <div className="nav-group-items-inner">{group.routes.map((routeId) => {
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
              })}</div>
            </div>
          </section>
        ))}
      </div>
      <div className="nav-footer">
        {can(Permission.PAGE_SETTINGS) ? (
          <button
            className={activeRouteId === "settings" ? "nav-item active" : "nav-item"}
            onClick={() => onRouteChange("settings")}
            title={collapsed ? "Settings" : undefined}
            type="button"
          >
            <SettingsIcon size={17} />
            {!collapsed ? <span>Settings</span> : null}
          </button>
        ) : null}
        <button className="nav-item" onClick={() => onRouteChange("projectContract")} title={collapsed ? "Help Center" : undefined} type="button">
          <HelpCircle size={17} />
          {!collapsed ? <span>Help Center</span> : null}
        </button>
        <button
          className="nav-item nav-theme-toggle"
          aria-pressed={isDark}
          onClick={() => setAppearance(isDark ? "light" : "dark")}
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          type="button"
        >
          {isDark ? <Moon size={17} /> : <Sun size={17} />}
          {!collapsed ? (
            <>
              <span>Dark Mode</span>
              <span className={isDark ? "theme-switch on" : "theme-switch"} aria-hidden="true">
                <span className="theme-switch-thumb" />
              </span>
            </>
          ) : null}
        </button>
        {!collapsed ? (
          <div className="nav-workspace" aria-hidden="true">
            <span className="nav-workspace-mark"><Workflow size={15} /></span>
            <span className="nav-workspace-name">
              <span>SpecterStudio</span>
              <small>Offline workspace</small>
            </span>
          </div>
        ) : null}
      </div>
    </nav>
  );
}
