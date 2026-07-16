import { useEffect, useRef, useState } from "react";
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

/** Exit-transition length — must match the `.app-toast[data-phase="leave"]` CSS (--awkit-dur-fast, 120ms). */
const EXIT_MS = 150;

type Phase = "enter" | "shown" | "leave";

/**
 * Lightweight, app-styled save/status toast. Renders nothing when idle, auto-dismisses after
 * `duration`, and never uses a native browser alert.
 *
 * It owns a small enter → shown → leave state machine so the toast animates OUT along the same bottom
 * edge it entered from (docs/ui-design-and-motion-direction.md §8, spatial continuity) instead of
 * teleporting away when the parent clears it. The rendered content is held locally through the exit so
 * the message stays visible while it fades.
 */
export function Toast({ toast, onDismiss, duration = 4000 }: ToastProps) {
  // Content currently mounted (kept through the exit even after the `toast` prop goes null).
  const [current, setCurrent] = useState<ToastState | null>(toast);
  const [phase, setPhase] = useState<Phase>("enter");
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (toast) {
      // New/updated toast: cancel any pending exit, mount off-edge, then flip to "shown" next frame
      // so the transition runs from the enter state.
      if (exitTimer.current) {
        clearTimeout(exitTimer.current);
        exitTimer.current = null;
      }
      setCurrent(toast);
      setPhase("enter");
      const raf = requestAnimationFrame(() => setPhase("shown"));
      return () => cancelAnimationFrame(raf);
    }
    // Parent cleared the toast: play the exit, then unmount once the transition has finished.
    setPhase("leave");
    exitTimer.current = setTimeout(() => setCurrent(null), EXIT_MS);
    return () => {
      if (exitTimer.current) {
        clearTimeout(exitTimer.current);
        exitTimer.current = null;
      }
    };
  }, [toast]);

  // Auto-dismiss: ask the parent to clear, which drives the exit above.
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(timer);
  }, [toast, duration, onDismiss]);

  if (!current) return null;

  return (
    <div
      className={`app-toast app-toast-${current.tone}`}
      data-phase={phase}
      role="status"
      aria-live="polite"
    >
      {current.tone === "success" ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
      <span>{current.message}</span>
      <button className="app-toast-close" onClick={onDismiss} title="Dismiss" type="button">
        <X size={14} />
      </button>
    </div>
  );
}
