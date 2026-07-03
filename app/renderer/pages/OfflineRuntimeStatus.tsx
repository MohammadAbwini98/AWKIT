import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, FolderCheck, Globe2, PackageCheck } from "lucide-react";

interface OfflineRuntimeCheck {
  key: string;
  label: string;
  ok: boolean;
  detail?: string;
}

interface OfflineRuntimeStatusView {
  productionOffline: boolean;
  internetRequired: boolean;
  runtimeDownloadsAllowed: boolean;
  bundledBrowserPath: string;
  bundledBrowserExists: boolean;
  resourcesRoot: string;
  runtimeDataRoot: string;
  checks: OfflineRuntimeCheck[];
}

export function OfflineRuntimeStatus() {
  const [status, setStatus] = useState<OfflineRuntimeStatusView | null>(null);

  useEffect(() => {
    window.playwrightFlowStudio.offlineRuntime.getStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  const failedChecks = status?.checks.filter((check) => !check.ok).length ?? 0;
  const browserCheck = status?.checks.find((check) => check.key === "bundledBrowser");
  const manifestCheck = status?.checks.find((check) => check.key === "manifest");
  const offlineManifestCheck = status?.checks.find((check) => check.key === "offlineManifest");
  const writableCheck = status?.checks.find((check) => check.key === "runtimeRoot");

  return (
    <section className="page">
      <section className="work-panel">
        <div className="section-heading">
          <h1>Offline Runtime Status</h1>
          <span>{status?.productionOffline ? "Production offline" : "Development mode"}</span>
        </div>
        <div className="offline-summary-grid">
          <article>
            <Globe2 size={19} />
            <span>Internet required</span>
            <strong>{status?.internetRequired ? "Yes" : "No"}</strong>
          </article>
          <article>
            <PackageCheck size={19} />
            <span>Production offline mode</span>
            <strong>{status?.productionOffline ? "Enabled" : "Disabled"}</strong>
          </article>
          <article>
            {browserCheck?.ok ? <CheckCircle2 size={19} /> : <CircleAlert size={19} />}
            <span>Bundled browser</span>
            <strong>{browserCheck?.ok ? "Found" : "Missing"}</strong>
          </article>
          <article>
            <FolderCheck size={19} />
            <span>Writable user data folder</span>
            <strong>{writableCheck?.ok ? "Yes" : "No"}</strong>
          </article>
          <article>
            <PackageCheck size={19} />
            <span>Dependency manifest</span>
            <strong>{manifestCheck?.ok ? "Valid" : "Invalid"}</strong>
          </article>
          <article>
            {offlineManifestCheck?.ok ? <CheckCircle2 size={19} /> : <CircleAlert size={19} />}
            <span>Offline runtime manifest</span>
            <strong>{offlineManifestCheck?.ok ? "Found" : "Missing"}</strong>
          </article>
          <article>
            {failedChecks === 0 ? <CheckCircle2 size={19} /> : <CircleAlert size={19} />}
            <span>Runtime downloads</span>
            <strong>{status?.runtimeDownloadsAllowed ? "Allowed" : "Disabled"}</strong>
          </article>
        </div>
        <div className="readiness-list offline-paths">
          <span>Bundled browser path</span>
          <strong>{status?.bundledBrowserPath ?? "Checking"}</strong>
          <span>Bundled browser exists</span>
          <strong>{status ? (status.bundledBrowserExists ? "Yes" : "No") : "Checking"}</strong>
          <span>Resources root</span>
          <strong>{status?.resourcesRoot ?? "Checking"}</strong>
          <span>Runtime data root</span>
          <strong>{status?.runtimeDataRoot ?? "Checking"}</strong>
        </div>
        <div className="check-list">
          {(status?.checks ?? []).map((check) => (
            <article className={check.ok ? "check-row ok" : "check-row fail"} key={check.key}>
              <strong>{check.label}</strong>
              <span>{check.ok ? "OK" : "Needs attention"}</span>
              {check.detail ? <small>{check.detail}</small> : null}
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
