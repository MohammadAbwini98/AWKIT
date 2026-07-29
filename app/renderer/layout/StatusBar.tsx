import { useEffect, useState } from "react";
import type { RuntimeStatusSnapshot } from "@src/runner/concurrency/RuntimeStatus";
import {
  LICENSE_REVALIDATE_INTERVAL_MS,
  licenseAttentionFor,
  type LicenseAttention
} from "@src/licensing/LicenseAttention";
import { Permission } from "@src/security/authz/Permissions";
import { useSession } from "../security/SessionContext";

interface StatusBarProps {
  readonly onOpenLicensing: () => void;
}

export function StatusBar({ onOpenLicensing }: StatusBarProps) {
  const session = useSession();
  const [offlineReady, setOfflineReady] = useState("Checking");
  const [offlineTone, setOfflineTone] = useState<"ok" | "warn" | "neutral">("neutral");
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatusSnapshot | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [licenseAttention, setLicenseAttention] = useState<(LicenseAttention & { detail: string }) | null>(null);

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
    const sessionRef = session?.principal.sessionRef;
    const mayViewLicense = session?.principal.permissions.includes(Permission.LICENSE_VIEW);
    if (!sessionRef || !mayViewLicense) {
      setLicenseAttention(null);
      return;
    }

    let active = true;
    let busy = false;
    const refresh = async (revalidate: boolean) => {
      if (busy) return;
      busy = true;
      try {
        const response = revalidate
          ? await window.playwrightFlowStudio.licensing.revalidate(sessionRef)
          : await window.playwrightFlowStudio.licensing.getStatus(sessionRef);
        if (!active) return;
        if (!response.ok || !response.value) {
          setLicenseAttention(null);
          return;
        }
        const attention = licenseAttentionFor(response.value.status);
        setLicenseAttention(
          attention ? { ...attention, detail: response.value.userAction } : null
        );
      } catch {
        if (active) setLicenseAttention(null);
      } finally {
        busy = false;
      }
    };
    const revalidate = () => void refresh(true);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") revalidate();
    };

    void refresh(false);
    const timer = window.setInterval(revalidate, LICENSE_REVALIDATE_INTERVAL_MS);
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [session?.principal.permissions, session?.principal.sessionRef]);

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
      {licenseAttention ? (
        <button
          type="button"
          className={`status-chip status-chip-action ${licenseAttention.tone === "danger" ? "danger" : "warn"}`}
          title={`${licenseAttention.detail} Open Licensing for details.`}
          aria-label={`License attention: ${licenseAttention.label}. Open Licensing.`}
          onClick={onOpenLicensing}
        >
          License: {licenseAttention.label}
        </button>
      ) : null}
    </footer>
  );
}
