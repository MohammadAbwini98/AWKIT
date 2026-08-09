import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Redo2, Undo2 } from "lucide-react";

export function EditorCommandBar({
  ariaLabel,
  className = "",
  children
}: {
  ariaLabel: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`editor-command-bar ${className}`.trim()} aria-label={ariaLabel}>
      {children}
    </section>
  );
}

export function EditorCommandGroup({
  label,
  className = "",
  children
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`editor-command-group ${className}`.trim()} role="group" aria-label={label}>
      <span className="editor-command-group-label" aria-hidden="true">{label}</span>
      <div className="editor-command-controls">{children}</div>
    </div>
  );
}

export function EditorIdentityField({
  label,
  className = "",
  children
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`editor-identity-field ${className}`.trim()}>
      <span>{label}</span>
      {children}
    </label>
  );
}

type HistoryButtonProps = {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  undoId?: string;
  redoId?: string;
  undoTestId?: string;
  redoTestId?: string;
};

export function EditorHistoryControls({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  undoId,
  redoId,
  undoTestId,
  redoTestId
}: HistoryButtonProps) {
  return (
    <div className="editor-history-controls" role="group" aria-label="Edit history">
      <EditorIconButton
        id={undoId}
        data-testid={undoTestId}
        aria-label="Undo"
        title="Undo (Ctrl+Z)"
        disabled={!canUndo}
        onClick={onUndo}
      >
        <Undo2 size={15} aria-hidden="true" />
      </EditorIconButton>
      <EditorIconButton
        id={redoId}
        data-testid={redoTestId}
        aria-label="Redo"
        title="Redo (Ctrl+Y or Ctrl+Shift+Z)"
        disabled={!canRedo}
        onClick={onRedo}
      >
        <Redo2 size={15} aria-hidden="true" />
      </EditorIconButton>
    </div>
  );
}

function EditorIconButton({ className = "", type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`editor-command-icon-button ${className}`.trim()} type={type} {...props} />;
}
