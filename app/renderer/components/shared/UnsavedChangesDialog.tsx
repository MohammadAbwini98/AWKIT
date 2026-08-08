import { useEffect, useId, useRef } from "react";
import { AlertTriangle } from "lucide-react";

interface UnsavedChangesDialogProps {
  /** Whether a Save action is available on the current page. */
  canSave: boolean;
  busy?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

/**
 * App-styled replacement for the native `window.confirm` unsaved-changes prompt.
 * Keyboard accessible: Escape cancels, focus is moved into the dialog on open.
 */
export function UnsavedChangesDialog({ canSave, busy = false, onSave, onDiscard, onCancel }: UnsavedChangesDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const returnFocusRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? [])];
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
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
  }, [busy, onCancel]);

  return (
    <div className="modal-overlay" onMouseDown={() => (busy ? undefined : onCancel())}>
      <div
        className="modal-dialog unsaved-changes-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        ref={dialogRef}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <span className="modal-icon warn">
            <AlertTriangle size={18} />
          </span>
          <h2 id={titleId}>Unsaved changes</h2>
        </div>
        <p className="modal-body" id={bodyId}>
          You have unsaved changes on this page. Save them before leaving, or discard them to continue.
        </p>
        <div className="modal-actions unsaved-changes-actions">
          <button autoFocus className="toolbar-button" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="toolbar-button modal-danger" type="button" onClick={onDiscard} disabled={busy}>
            Discard Changes
          </button>
          <button
            className="toolbar-button primary"
            type="button"
            onClick={onSave}
            disabled={busy || !canSave}
            title={canSave ? "Save changes and continue" : "This page has no save action"}
          >
            {busy ? "Saving…" : "Save and Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
