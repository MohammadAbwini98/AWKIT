import { useEffect, useState } from "react";

export function StatusBar() {
  const [offlineReady, setOfflineReady] = useState("Checking");
  const [offlineTone, setOfflineTone] = useState<"ok" | "warn" | "neutral">("neutral");

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

  return (
    <footer className="status-bar">
      <span className={`status-chip ${offlineTone}`}>Offline Runtime: {offlineReady}</span>
      <span className="status-chip neutral">Active Instances: 0</span>
      <span className="status-chip neutral">Queue: 0</span>
      <span className="status-chip ok">Last Error: None</span>
    </footer>
  );
}
