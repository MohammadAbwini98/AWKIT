import { useEffect } from "react";
import { CheckCircle2, XCircle, X } from "lucide-react";

export interface ToastState {
  tone: "success" | "error";
  message: string;
}

interface ToastProps {
  toast: ToastState | null;
  onDismiss: () => void;
  /** Auto-dismiss delay in ms (default 4000). */
  duration?: number;
}

/**
 * Lightweight, app-styled save/status toast. Renders nothing when `toast` is null,
 * auto-dismisses after `duration`, and never uses a native browser alert.
 */
export function Toast({ toast, onDismiss, duration = 4000 }: ToastProps) {
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(timer);
  }, [toast, duration, onDismiss]);

  if (!toast) return null;

  return (
    <div className={`app-toast app-toast-${toast.tone}`} role="status" aria-live="polite">
      {toast.tone === "success" ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
      <span>{toast.message}</span>
      <button className="app-toast-close" onClick={onDismiss} title="Dismiss" type="button">
        <X size={14} />
      </button>
    </div>
  );
}
