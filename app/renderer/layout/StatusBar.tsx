import { useEffect, useState } from "react";
import type { RuntimeStatusSnapshot } from "@src/runner/concurrency/RuntimeStatus";

export function StatusBar() {
  const [offlineReady, setOfflineReady] = useState("Checking");
  const [offlineTone, setOfflineTone] = useState<"ok" | "warn" | "neutral">("neutral");
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatusSnapshot | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  useEffect(() => {
    window.playwrightFlowStudio.offlineRuntime
      .getStatus()
      .then((status) => {
        const failed = status.checks.filter((check) => !check.ok).length;
        setOfflineReady(failed === 0 ? "Ready" : `${failed} checks`);
        setOfflineTone(failed === 0 ? "ok" : "warn");
      })
      .catch(() => {
        setOfflineReady("Unavailable");
        setOfflineTone("warn");
      });
  }, []);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;

    const tick = async () => {
      try {
        const status = await window.playwrightFlowStudio.executions.runtimeStatus();
        if (!active) return;
        setRuntimeStatus(status);
        setRuntimeError(null);
      } catch (error) {
        if (!active) return;
        setRuntimeError(error instanceof Error ? error.message : String(error));
      }
    };

    void tick();
    timer = window.setInterval(() => void tick(), 2000);
    return () => {
      active = false;
      if (timer) window.clearInterval(timer);
    };
  }, []);

  const capacity = runtimeStatus?.capacity;
  const queueDepth = capacity?.queueDepth ?? 0;
  const activeFlows = capacity?.activeFlows ?? 0;
  const activeBrowsers = capacity?.activeBrowsers ?? 0;
  const blocked = Boolean(capacity?.dispatchBlocked);
  const runtimeTone = runtimeError || blocked ? "warn" : "ok";
  const runtimeLabel = runtimeError ? "Runtime status unavailable" : blocked ? "Runtime backpressure" : "Runtime nominal";

  return (
    <footer className="status-bar">
      <span className={`status-chip ${offlineTone}`}>Offline Runtime: {offlineReady}</span>
      <span className="status-chip neutral">Active flows: {activeFlows}</span>
      <span className="status-chip neutral">Active browsers: {activeBrowsers}</span>
      <span className={queueDepth > 0 ? "status-chip warn" : "status-chip neutral"}>Queue: {queueDepth}</span>
      <span className={`status-chip ${runtimeTone}`} title={runtimeError ?? capacity?.blockedReason ?? runtimeStatus?.timestamp ?? undefined}>
        {runtimeLabel}
      </span>
    </footer>
  );
}
