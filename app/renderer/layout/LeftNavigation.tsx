import { ChevronDown, HelpCircle, Moon, PanelLeftClose, PanelLeftOpen, Settings as SettingsIcon, Sun, Workflow } from "lucide-react";
import { useMemo, useState } from "react";
import { AwkitDarkBrandMark } from "../assets/brand/AwkitBrandMarks";
import { routes, type RouteId } from "../routes";
import { useTheme } from "../state/theme";
import { useBranding } from "../state/branding";
import { usePermissions } from "../security/usePermissions";
import { RouteExclusiveRoles, RoutePermissions } from "../security/routePermissions";
import { Permission } from "@src/security/authz/Permissions";

const routeGroups = [
  {
    label: "Build",
    routes: ["dashboard", "workflowsLibrary", "scenarioBuilder", "flowLibrary", "semanticSearch", "flowChart", "formDesigner", "recorder"] satisfies RouteId[]
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
    routes: ["userManagement", "roles", "permissionsMatrix", "auditLog", "licensing", "licenseIssuer"] satisfies RouteId[]
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
  const branding = useBranding();
  const { can, isIssuer } = usePermissions();
  const isDark = resolvedTheme === "dark";
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => Object.fromEntries(routeGroups.map((group) => [group.label, true])));
  // Filter each group's routes by the signed-in principal's permissions; drop empty groups (UI hint only —
  // the real boundary is the main-process IPC permission check).
  const visibleGroups = useMemo(
    () =>
      routeGroups
        .map((group) => ({
          ...group,
          routes: group.routes.filter((id) => {
            const permission = RoutePermissions[id];
            const exclusiveRole = RouteExclusiveRoles[id];
            return (!permission || can(permission)) && (!exclusiveRole || isIssuer);
          })
        }))
        .filter((group) => group.routes.length > 0),
    [can, isIssuer]
  );
  return (
    <nav className={collapsed ? "left-navigation collapsed" : "left-navigation"} aria-label="Primary">
      <div className="brand-block">
        <div className="brand-tile">
          {/* Dark finish in both themes: the sidebar mark matches the OS icon (resources/icon.*). */}
          <AwkitDarkBrandMark size={32} className="brand-app-icon" />
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
                const isActive = route.id === activeRouteId;
                return (
                  <button
                    // Collapsed rows are icon-only, so they carry an explicit name; expanded rows are
                    // named by their own text (which e2e helpers match on) and must not be relabelled.
                    aria-label={collapsed ? route.label : undefined}
                    aria-current={isActive ? "page" : undefined}
                    className={isActive ? "nav-item active" : "nav-item"}
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
            aria-label={collapsed ? "Settings" : undefined}
            aria-current={activeRouteId === "settings" ? "page" : undefined}
            className={activeRouteId === "settings" ? "nav-item active" : "nav-item"}
            onClick={() => onRouteChange("settings")}
            title={collapsed ? "Settings" : undefined}
            type="button"
          >
            <SettingsIcon size={17} />
            {!collapsed ? <span>Settings</span> : null}
          </button>
        ) : null}
        <button
          aria-label={collapsed ? "Help Center" : undefined}
          className="nav-item"
          onClick={() => onRouteChange("projectContract")}
          title={collapsed ? "Help Center" : undefined}
          type="button"
        >
          <HelpCircle size={17} />
          {!collapsed ? <span>Help Center</span> : null}
        </button>
        <button
          className="nav-item nav-theme-toggle"
          aria-label={collapsed ? "Dark Mode" : undefined}
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
          <div className={branding.active && branding.dataUrl ? "nav-workspace has-custom-logo" : "nav-workspace"} aria-hidden="true">
            {branding.active && branding.dataUrl ? (
              // A custom logo replaces the ENTIRE workspace block (icon + name + subtitle). Presence check
              // on already-validated context state (never <img onError>), so a corrupt/mid-swap asset
              // degrades to active:false and the default block returns — never a broken image.
              <img src={branding.dataUrl} alt="" className="nav-workspace-logo-full" />
            ) : (
              <>
                <span className="nav-workspace-mark"><Workflow size={15} /></span>
                <span className="nav-workspace-name">
                  <span>SpecterStudio</span>
                  <small>Offline workspace</small>
                </span>
              </>
            )}
          </div>
        ) : null}
      </div>
    </nav>
  );
}
