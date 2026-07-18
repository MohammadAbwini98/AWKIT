import { AlertTriangle, RotateCcw } from "lucide-react";
import { GENERIC_MESSAGE } from "../reasonMessages";

interface SecurityUnavailableProps {
  onRetry: () => void;
}

/**
 * Fail-closed surface shown when the security subsystem cannot initialize (e.g., OS secure storage is
 * unavailable). Exposes only safe actions — retry and exit — and never a path into the protected app.
 * No implementation detail is shown; the specifics live only in the main-process diagnostic log.
 */
export function SecurityUnavailable({ onRetry }: SecurityUnavailableProps) {
  return (
    <div className="awkit-login-form awkit-login-failure" role="alert" aria-labelledby="awkit-failure-title">
      <header className="awkit-login-brand">
        <span className="awkit-login-mark awkit-login-mark-warn" aria-hidden="true">
          <AlertTriangle size={22} strokeWidth={2.2} />
        </span>
        <h1 id="awkit-failure-title">Application access unavailable</h1>
        <p className="awkit-login-subtitle">{GENERIC_MESSAGE}</p>
      </header>

      <div className="awkit-login-actions">
        <button className="toolbar-button" type="button" onClick={() => window.playwrightFlowStudio.appWindow.close()}>
          Exit
        </button>
        <button className="toolbar-button primary awkit-login-submit" type="button" onClick={onRetry}>
          <RotateCcw size={16} aria-hidden="true" />
          Retry
        </button>
      </div>
    </div>
  );
}
