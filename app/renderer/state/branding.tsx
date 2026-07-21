import { createContext, useContext } from "react";

/**
 * Active custom-workspace-logo state, shared across the renderer (the sidebar consumes it; the Branding
 * settings card mutates it and calls `refresh`). Kept as its own tiny context rather than folded into
 * `ThemeContext` — its async refresh-after-mutation shape doesn't fit Theme's callback interface, and
 * branding is an independent concern.
 *
 * `dataUrl` is a self-contained `data:image/png;base64,...` string (already validated in the main
 * process), so consumers just render `<img src={dataUrl}>`. When `active` is false the caller shows the
 * built-in default icon; this is a plain presence check, never an `<img onError>` — that is what
 * guarantees the sidebar never shows a broken-image icon even mid-swap or on a corrupt asset.
 */
export interface BrandingState {
  active: boolean;
  dataUrl: string | null;
  updatedAt: string | null;
}

export interface BrandingContextValue extends BrandingState {
  /** Re-fetch the active logo from the main process (after Apply / Remove elsewhere). */
  refresh: () => Promise<void>;
}

export const DEFAULT_BRANDING_STATE: BrandingState = { active: false, dataUrl: null, updatedAt: null };

export const BrandingContext = createContext<BrandingContextValue | null>(null);

/**
 * Read branding state. Returns a safe inert default when no provider is mounted (e.g. isolated tests),
 * so a missing provider degrades to the built-in icon rather than throwing inside the app shell.
 */
export function useBranding(): BrandingContextValue {
  return useContext(BrandingContext) ?? { ...DEFAULT_BRANDING_STATE, refresh: async () => {} };
}
