import { useEffect, useRef, useState } from "react";
import type { RuntimeStatusSnapshot } from "@src/runner/concurrency/RuntimeStatus";

interface RuntimeStatusState {
  status: RuntimeStatusSnapshot | undefined;
  loading: boolean;
  error: string | undefined;
}

/**
 * Polls `executions.runtimeStatus()` every `intervalMs` (default 2s), cleaned up on unmount.
 * Keeps the last good snapshot on a transient IPC failure so the dashboard doesn't flicker.
 */
export function useRuntimeStatus(intervalMs = 2000): RuntimeStatusState {
  const [state, setState] = useState<RuntimeStatusState>({ status: undefined, loading: true, error: undefined });
  const timer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const status = await window.playwrightFlowStudio.executions.runtimeStatus();
        if (active) setState({ status, loading: false, error: undefined });
      } catch (err) {
        if (active) setState((prev) => ({ status: prev.status, loading: false, error: err instanceof Error ? err.message : String(err) }));
      }
    };
    void tick();
    timer.current = setInterval(() => void tick(), intervalMs);
    return () => {
      active = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, [intervalMs]);

  return state;
}
