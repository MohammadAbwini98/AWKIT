import { useEffect, useId, useRef } from "react";
import { AlertTriangle, GitBranch } from "lucide-react";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  icon?: "warning" | "connect";
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** App-styled confirmation modal (matches the unsaved-changes dialog design). */
export function ConfirmDialog({ title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", icon = "warning", danger, onConfirm, onCancel }: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCancelRef = useRef(onCancel);
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  );

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancelRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? [])].filter((element) => !element.hasAttribute("hidden"));
      if (focusable.length === 0) {
        e.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    };
  }, []);

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div
        ref={dialogRef}
        className={icon === "connect" ? "modal-dialog modal-dialog-connect" : "modal-dialog"}
        role="alertdialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span className={icon === "connect" ? "modal-icon connect" : "modal-icon warn"}>
            {icon === "connect" ? <GitBranch size={28} /> : <AlertTriangle size={18} />}
          </span>
          <h2 id={titleId}>{title}</h2>
        </div>
        <p className="modal-body" id={descriptionId}>{message}</p>
        <div className="modal-actions">
          <button autoFocus className="toolbar-button" type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className={danger ? "toolbar-button modal-danger" : "toolbar-button primary"} type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
