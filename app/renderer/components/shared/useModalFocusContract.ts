import { useEffect, useRef } from "react";

/**
 * The modal focus contract every `aria-modal="true"` surface must implement
 * (`ConfirmDialog.tsx` is the reference):
 *   1. focus moves INTO the dialog on open,
 *   2. Tab / Shift+Tab cycle within it,
 *   3. Escape dismisses it,
 *   4. focus RETURNS to the opener on close.
 *
 * AWKIT-A11Y-001: this contract has been re-implemented per modal four times, and each time a new
 * surface shipped without it while a sibling claimed otherwise. This hook makes the contract a
 * one-liner; use it instead of copying markup from a dialog that happens to have it today.
 */
export function useModalFocusContract<T extends HTMLElement = HTMLDivElement>(onCancel: () => void, active = true) {
  const dialogRef = useRef<T | null>(null);
  const cancelRef = useRef(onCancel);
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  );

  useEffect(() => {
    cancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    if (!active) return;
    // Capture the opener at OPEN time, not hook-creation time, so a long-lived host component
    // (e.g. a designer page rendering a conditional dialog) returns focus to the right element.
    returnFocusRef.current =
      typeof document !== "undefined" && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? [])].filter((element) => !element.hasAttribute("hidden"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    };
  }, [active]);

  return { dialogRef };
}
