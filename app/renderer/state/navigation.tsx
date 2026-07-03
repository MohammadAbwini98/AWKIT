import { createContext, useContext } from "react";
import type { RouteId } from "../routes";

interface NavigationContextValue {
  navigateTo: (routeId: RouteId) => void;
  /** Collapse the app side menu (used when a designer canvas needs more room). */
  collapseSidebar: () => void;
}

export const NavigationContext = createContext<NavigationContextValue | null>(null);

/** Returns the app-level navigate function so any page can navigate programmatically. */
export function useNavigation(): NavigationContextValue {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error("useNavigation must be used inside NavigationContext.Provider");
  return ctx;
}
