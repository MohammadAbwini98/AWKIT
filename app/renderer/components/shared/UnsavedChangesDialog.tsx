import { useEffect, useRef } from "react";
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel]);

  return (
    <div className="modal-overlay" onMouseDown={() => (busy ? undefined : onCancel())}>
      <div
        className="modal-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-title"
        aria-describedby="unsaved-body"
        tabIndex={-1}
        ref={dialogRef}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <span className="modal-icon warn">
            <AlertTriangle size={18} />
          </span>
          <h2 id="unsaved-title">Unsaved changes</h2>
        </div>
        <p className="modal-body" id="unsaved-body">
          You have unsaved changes on this page. Save them before leaving, or discard them to continue.
        </p>
        <div className="modal-actions">
          <button className="toolbar-button" type="button" onClick={onCancel} disabled={busy}>
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
