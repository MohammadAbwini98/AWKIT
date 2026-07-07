import { createContext, useContext } from "react";

/** Mirrors AppearanceMode in app/main/uiSettings.ts (renderer cannot import main types at runtime). */
export type AppearanceMode = "light" | "dark" | "system";

export const APPEARANCE_MODES: AppearanceMode[] = ["light", "dark", "system"];

interface ThemeContextValue {
  appearance: AppearanceMode;
  /** The theme actually applied to the document ("system" resolved against the OS). */
  resolvedTheme: "light" | "dark";
  setAppearance: (mode: AppearanceMode) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeContext.Provider");
  return ctx;
}

/** Resolve an appearance preference to the concrete theme for the current OS setting. */
export function resolveAppearance(mode: AppearanceMode): "light" | "dark" {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return mode;
}
