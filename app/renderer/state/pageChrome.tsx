import { createContext, useContext, useEffect } from "react";

export interface PageAction {
  id: string;
  label: string;
  /** May return a promise — the unsaved-changes "Save and Continue" flow awaits it. */
  onClick: () => void | Promise<void>;
  variant?: "default" | "primary";
  disabled?: boolean;
  title?: string;
}

export interface PageChrome {
  actions: PageAction[];
  dirty: boolean;
}

interface PageChromeContextValue {
  setChrome: (chrome: PageChrome) => void;
  resetChrome: () => void;
}

export const PageChromeContext = createContext<PageChromeContextValue | null>(null);

/**
 * Lets a page publish header actions (Save / Validate / Run …) and report whether
 * it has unsaved changes. The chrome is cleared automatically when the page unmounts.
 *
 * Pass a dependency array so the published actions stay in sync with the page's
 * latest handlers and disabled/dirty state without re-registering on every render.
 */
export function usePageChrome(chrome: PageChrome, deps: unknown[]): void {
  const context = useContext(PageChromeContext);

  useEffect(() => {
    context?.setChrome(chrome);
    return () => context?.resetChrome();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
