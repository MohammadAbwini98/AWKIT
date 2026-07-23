import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "./layout/AppShell";
import { ErrorBoundary } from "./components/shared/ErrorBoundary";
import { UnsavedChangesDialog } from "./components/shared/UnsavedChangesDialog";
import { routes, type RouteId } from "./routes";
import { PageChromeContext, type PageChrome } from "./state/pageChrome";
import { NavigationContext } from "./state/navigation";
import { ThemeContext, resolveAppearance, type AppearanceMode } from "./state/theme";
import { applyAccent, readCachedAccent, writeAccentCache } from "./state/accentTheme";
import { normalizeAccentSettings, type AccentSettings } from "@src/theme/accentColor";
import { BrandingContext, DEFAULT_BRANDING_STATE, type BrandingState } from "./state/branding";
import { usePermissions } from "./security/usePermissions";
import { RoutePermissions } from "./security/routePermissions";
import { NotAuthorized } from "./security/NotAuthorized";

const emptyChrome: PageChrome = { actions: [], dirty: false };

export function App() {
  const [activeRouteId, setActiveRouteId] = useState<RouteId>("dashboard");
  const [routeHistory, setRouteHistory] = useState<RouteId[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [appearance, setAppearanceState] = useState<AppearanceMode>(() => {
    const saved = window.localStorage.getItem("awkit-appearance");
    return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
  });
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() => document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  const [accent, setAccentState] = useState<AccentSettings>(() => readCachedAccent());
  const [branding, setBrandingState] = useState<BrandingState>(DEFAULT_BRANDING_STATE);
  const [chrome, setChromeState] = useState<PageChrome>(emptyChrome);
  const [unsavedOpen, setUnsavedOpen] = useState(false);
  const [savingBeforeLeave, setSavingBeforeLeave] = useState(false);
  const leaveResolverRef = useRef<((choice: "save" | "discard" | "cancel") => void) | null>(null);

  useEffect(() => {
    window.playwrightFlowStudio.settings
      .get()
      .then((settings) => {
        if (routes.some((route) => route.id === settings.lastRouteId)) {
          setActiveRouteId(settings.lastRouteId as RouteId);
        }
        setSidebarCollapsed(settings.sidebarCollapsed);
        if (settings.appearance === "light" || settings.appearance === "dark" || settings.appearance === "system") {
          setAppearanceState(settings.appearance);
          window.localStorage.setItem("awkit-appearance", settings.appearance);
        }
        // Authoritative accent from the settings store; keep the bootstrap cache in sync.
        const savedAccent = normalizeAccentSettings(settings.accent);
        setAccentState(savedAccent);
        writeAccentCache(savedAccent);
      })
      .catch(() => undefined);
  }, []);

  // Apply the theme to <html data-theme="…">; in system mode follow OS changes live.
  useEffect(() => {
    const apply = () => {
      const resolved = resolveAppearance(appearance);
      document.documentElement.dataset.theme = resolved;
      setResolvedTheme(resolved);
    };
    apply();
    if (appearance !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [appearance]);

  // Apply the accent (or clear it) whenever the accent or the resolved theme changes, so a light↔dark
  // switch re-derives the shade/gradient set. Inline vars on <html> beat the stylesheet defaults.
  useEffect(() => {
    applyAccent(document.documentElement, accent, resolvedTheme);
  }, [accent, resolvedTheme]);

  const setAppearance = useCallback((mode: AppearanceMode) => {
    setAppearanceState(mode);
    window.localStorage.setItem("awkit-appearance", mode);
    window.playwrightFlowStudio.settings.update({ appearance: mode }).catch(() => undefined);
  }, []);

  // Persist + apply an accent app-wide. The default settings restore the default purple (override removed).
  const setAccent = useCallback((next: AccentSettings) => {
    const normalized = normalizeAccentSettings(next);
    setAccentState(normalized);
    writeAccentCache(normalized);
    window.playwrightFlowStudio.settings.update({ accent: normalized }).catch(() => undefined);
  }, []);

  const themeApi = useMemo(
    () => ({ appearance, resolvedTheme, setAppearance, accent, setAccent }),
    [appearance, resolvedTheme, setAppearance, accent, setAccent]
  );

  // Custom workspace logo: fetch once on mount, and expose a refresh the Branding settings card calls
  // after Apply/Remove so all open renderer surfaces (the sidebar) update immediately. A failure or an
  // absent logo resolves to the inert default so the sidebar keeps its built-in icon.
  const refreshBranding = useCallback(async () => {
    try {
      setBrandingState(await window.playwrightFlowStudio.branding.getState());
    } catch {
      setBrandingState(DEFAULT_BRANDING_STATE);
    }
  }, []);
  useEffect(() => {
    void refreshBranding();
  }, [refreshBranding]);
  const brandingApi = useMemo(() => ({ ...branding, refresh: refreshBranding }), [branding, refreshBranding]);

  const chromeApi = useMemo(
    () => ({
      setChrome: (next: PageChrome) => setChromeState(next),
      resetChrome: () => setChromeState(emptyChrome)
    }),
    []
  );

  const activeRoute = useMemo(
    () => routes.find((route) => route.id === activeRouteId) ?? routes[0],
    [activeRouteId]
  );
  const ActivePage = activeRoute.component;
  const { can } = usePermissions();
  const routeRequires = RoutePermissions[activeRouteId];
  const routeAuthorized = !routeRequires || can(routeRequires);

  // Resolve the unsaved-changes dialog with the user's choice. "save" awaits the
  // page's registered Save action before allowing navigation to proceed.
  const settleLeave = useCallback(
    async (choice: "save" | "discard" | "cancel") => {
      if (choice === "save") {
        const saveAction = chrome.actions.find((action) => action.id === "save");
        if (saveAction) {
          setSavingBeforeLeave(true);
          try {
            await saveAction.onClick();
          } catch {
            // Surface nothing here; the page reports its own save errors. Treat as
            // handled so the user isn't trapped, matching Discard semantics.
          } finally {
            setSavingBeforeLeave(false);
          }
        }
      }
      setUnsavedOpen(false);
      const resolver = leaveResolverRef.current;
      leaveResolverRef.current = null;
      resolver?.(choice);
    },
    [chrome.actions]
  );

  // Returns true when navigation may proceed (no changes, discarded, or saved).
  const confirmLeaveIfDirty = useCallback((): Promise<boolean> => {
    if (!chrome.dirty) return Promise.resolve(true);
    setUnsavedOpen(true);
    return new Promise<boolean>((resolve) => {
      leaveResolverRef.current = (choice) => resolve(choice !== "cancel");
    });
  }, [chrome.dirty]);

  const navigateTo = useCallback(
    (routeId: RouteId, recordHistory: boolean = true) => {
      setChromeState(emptyChrome);
      if (recordHistory) {
        setRouteHistory((history) => [...history, activeRouteId]);
      }
      setActiveRouteId(routeId);
      window.playwrightFlowStudio.settings.update({ lastRouteId: routeId }).catch(() => undefined);
    },
    [activeRouteId]
  );

  const changeRoute = useCallback(
    async (routeId: RouteId) => {
      if (routeId === activeRouteId) return;
      if (!(await confirmLeaveIfDirty())) return;
      navigateTo(routeId, true);
    },
    [activeRouteId, confirmLeaveIfDirty, navigateTo]
  );

  const goBack = useCallback(async () => {
    if (!(await confirmLeaveIfDirty())) return;
    setRouteHistory((history) => {
      const nextHistory = [...history];
      const previousRoute = nextHistory.pop() ?? "dashboard";
      setChromeState(emptyChrome);
      setActiveRouteId(previousRoute);
      window.playwrightFlowStudio.settings.update({ lastRouteId: previousRoute }).catch(() => undefined);
      return nextHistory;
    });
  }, [confirmLeaveIfDirty]);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((current) => {
      const next = !current;
      window.playwrightFlowStudio.settings.update({ sidebarCollapsed: next }).catch(() => undefined);
      return next;
    });
  }, []);

  // Collapse (never expand) the side menu — used by designer canvases to reclaim space on empty
  // canvas clicks. Idempotent so repeated pane clicks don't thrash settings writes.
  const collapseSidebar = useCallback(() => {
    setSidebarCollapsed((current) => {
      if (current) return current;
      window.playwrightFlowStudio.settings.update({ sidebarCollapsed: true }).catch(() => undefined);
      return true;
    });
  }, []);

  const navigationApi = useMemo(() => ({ navigateTo: changeRoute, collapseSidebar }), [changeRoute, collapseSidebar]);

  return (
    <PageChromeContext.Provider value={chromeApi}>
      <NavigationContext.Provider value={navigationApi}>
      <ThemeContext.Provider value={themeApi}>
        <BrandingContext.Provider value={brandingApi}>
        <AppShell
          activeRoute={activeRoute}
          activeRouteId={activeRouteId}
          canGoBack={routeHistory.length > 0}
          dirty={chrome.dirty}
          headerActions={chrome.actions}
          sidebarCollapsed={sidebarCollapsed}
          onBack={goBack}
          onRouteChange={changeRoute}
          onToggleSidebar={toggleSidebar}
        >
          <ErrorBoundary key={activeRouteId} area={activeRoute.label}>
            {routeAuthorized ? <ActivePage /> : <NotAuthorized onGoHome={() => changeRoute("dashboard")} />}
          </ErrorBoundary>
        </AppShell>
        {unsavedOpen ? (
          <UnsavedChangesDialog
            canSave={chrome.actions.some((action) => action.id === "save")}
            busy={savingBeforeLeave}
            onSave={() => void settleLeave("save")}
            onDiscard={() => void settleLeave("discard")}
            onCancel={() => void settleLeave("cancel")}
          />
        ) : null}
        </BrandingContext.Provider>
      </ThemeContext.Provider>
      </NavigationContext.Provider>
    </PageChromeContext.Provider>
  );
}
