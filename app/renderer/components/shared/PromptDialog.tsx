import { useEffect, useId, useRef, useState } from "react";
import { FilePlus2 } from "lucide-react";

interface PromptDialogProps {
  title: string;
  label: string;
  message?: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Called with the trimmed value when the user confirms a non-empty entry. */
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

/**
 * App-styled single-field prompt modal (matches ConfirmDialog's shell). Used for
 * naming a new resource before it is created. Autofocuses and selects the field so
 * the user can type immediately; Enter confirms, Escape cancels, and the confirm
 * button stays disabled until the entry has non-whitespace content.
 */
export function PromptDialog({
  title,
  label,
  message,
  placeholder,
  initialValue = "",
  confirmLabel = "Create",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel
}: PromptDialogProps) {
  const titleId = useId();
  const labelId = useId();
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmed = value.trim();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  useEffect(() => {
    // Respond instantly: focus and pre-select so the user can type or overwrite at once.
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    if (trimmed) onConfirm(trimmed);
  };

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <form
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="modal-header">
          <span className="modal-icon create">
            <FilePlus2 size={18} />
          </span>
          <h2 id={titleId}>{title}</h2>
        </div>
        {message ? <p className="modal-body">{message}</p> : null}
        <label className="modal-field">
          <span id={labelId}>{label}</span>
          <input
            ref={inputRef}
            type="text"
            value={value}
            placeholder={placeholder}
            aria-labelledby={labelId}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <div className="modal-actions">
          <button className="toolbar-button" type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className="toolbar-button primary" type="submit" disabled={!trimmed}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
