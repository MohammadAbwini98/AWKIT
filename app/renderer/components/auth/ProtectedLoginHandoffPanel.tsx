import { ExternalLink, Play, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import type { InstanceRuntimeState } from "@src/instances/InstanceRuntimeState";

export interface ProtectedLoginCapabilities {
  oauthConfigured: boolean;
  loadSessionSupported: boolean;
  testSessionSupported: boolean;
  reasons: { oauth: string; savedSession: string; testSession: string };
}

interface ProtectedLoginHandoffPanelProps {
  instances: InstanceRuntimeState[];
  capabilities: ProtectedLoginCapabilities | null;
  workflowName: (scenarioId: string) => string;
  onCancel: (instanceId: string) => void;
  onContinue: (instanceId: string) => void;
  onRetry: (instanceId: string) => void;
  onOpenOAuth: (provider: string) => void;
}

/**
 * Shows protected-login handoff cards for instances paused (waitingForManualAction). Surfaces the
 * provider/reason/url and only the approved actions: Cancel + Retry always; saved-session / OAuth /
 * test-session are shown disabled-with-reason unless the capability actually exists. No secrets.
 */
export function ProtectedLoginHandoffPanel({ instances, capabilities, workflowName, onCancel, onContinue, onRetry, onOpenOAuth }: ProtectedLoginHandoffPanelProps) {
  const waiting = instances.filter((instance) => instance.status === "waitingForManualAction" && instance.manualHandoff);
  if (!waiting.length) return null;

  return (
    <div className="protected-login-handoff">
      {waiting.map((instance) => {
        const detail = instance.manualHandoff?.detail;
        const allowed = new Set(detail?.allowedActions ?? ["cancel", "retry"]);
        const provider = detail?.provider ?? "unknown";
        return (
          <section className="plh-card" key={instance.instanceId}>
            <header className="plh-head">
              <ShieldAlert size={18} />
              <strong>Protected login — action required</strong>
              <span className="plh-instance">
                {workflowName(instance.scenarioId)} · {instance.config.name}
              </span>
            </header>

            <p className="plh-message">{instance.manualHandoff?.message}</p>

            <dl className="plh-meta">
              <div>
                <dt>Provider</dt>
                <dd>{provider}</dd>
              </div>
              <div>
                <dt>Reason</dt>
                <dd>{detail?.reason ?? "unknown"}</dd>
              </div>
              <div>
                <dt>URL</dt>
                <dd className="plh-url" title={detail?.url}>{detail?.url ?? "—"}</dd>
              </div>
            </dl>

            <div className="plh-actions">
              <button className="toolbar-button primary" type="button" onClick={() => onCancel(instance.instanceId)}>
                <XCircle size={14} /> Cancel Run
              </button>
              {allowed.has("continue") ? (
                <button className="toolbar-button" type="button" onClick={() => onContinue(instance.instanceId)}>
                  <Play size={14} /> Continue
                </button>
              ) : null}
              {allowed.has("retry") ? (
                <button className="toolbar-button" type="button" onClick={() => onRetry(instance.instanceId)}>
                  <RefreshCw size={14} /> Retry Detection
                </button>
              ) : null}

              {allowed.has("openSystemBrowser") || allowed.has("useOAuth") ? (
                <button
                  className="toolbar-button"
                  type="button"
                  disabled={!capabilities?.oauthConfigured}
                  title={capabilities?.oauthConfigured ? "Open the provider OAuth flow in your system browser" : capabilities?.reasons.oauth ?? "OAuth is not configured."}
                  onClick={() => onOpenOAuth(provider)}
                >
                  <ExternalLink size={14} /> Open OAuth in System Browser
                </button>
              ) : null}

              {allowed.has("useSavedSession") ? (
                <button className="toolbar-button" type="button" disabled title={capabilities?.reasons.savedSession ?? "Load Session is not implemented yet."}>
                  Use Saved Session
                </button>
              ) : null}

              {allowed.has("useTestSession") ? (
                <button className="toolbar-button" type="button" disabled title={capabilities?.reasons.testSession ?? "No configured test session."}>
                  Use Test Session
                </button>
              ) : null}
            </div>

            <p className="plh-note">
              SpecterStudio will not bypass CAPTCHA, MFA, or bot-detection. OAuth (when configured) is for
              provider-approved API auth in your system browser — it does not transfer UI cookies into the automation browser.
            </p>
          </section>
        );
      })}
    </div>
  );
}
