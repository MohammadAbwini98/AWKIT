import { useEffect, useState } from "react";

/**
 * Tracks the OS "reduce motion" preference. JS-driven animations (count-ups, gauge sweeps) must
 * check this and render final values immediately when it is true. CSS animations are separately
 * neutralized by the global `prefers-reduced-motion` block in global.css.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
