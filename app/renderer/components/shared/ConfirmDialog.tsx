import { useEffect, useId } from "react";
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div
        className={icon === "connect" ? "modal-dialog modal-dialog-connect" : "modal-dialog"}
        role="alertdialog"
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
