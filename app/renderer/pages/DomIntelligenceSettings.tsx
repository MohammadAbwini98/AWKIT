import { useEffect, useState } from "react";
import { ScanSearch } from "lucide-react";

import type { DomIntelligenceStatusView } from "@src/runner/domIntelligence/DomIntelligenceApi";

/**
 * L11 DOM intelligence status (awkit-djnl.19). Read-only: there is no setting to change here; the operator
 * kill switch is `AWKIT_DOM_INTELLIGENCE=off`. Browser and network access are shown from the provider's own
 * status, which is always false by contract (asserted by `verify:dom-intelligence-host`).
 */
export function DomIntelligenceSettings() {
  const [status, setStatus] = useState<DomIntelligenceStatusView | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    window.playwrightFlowStudio.domIntelligence
      .getStatus()
      .then((next) => !cancelled && setStatus(next))
      .catch(() => !cancelled && setStatus(null));
    return () => {
      cancelled = true;
    };
  }, []);

  const state = status === undefined ? "Checking…" : !status ? "Unavailable" : status.available ? "Available" : status.reason === "DISABLED" ? "Disabled" : "Unavailable";
  return (
    <section className="work-panel settings-card" data-testid="dom-intelligence-status" data-state={state}>
      <div className="settings-card-head">
        <ScanSearch size={16} />
        <h2>DOM Intelligence</h2>
      </div>
      <div className="readiness-list">
        <span>Status</span>
        <strong data-testid="dom-intelligence-state">{state}</strong>
        <span>Provider</span>
        {/* The one integrated provider; Status and the detail line say whether this build can run it. */}
        <strong>Scrapling</strong>
        <span>Mode</span>
        <strong>Parser only</strong>
        <span>Version</span>
        <strong data-testid="dom-intelligence-version">{status?.version ?? "—"}</strong>
        <span>Browser access</span>
        <strong>{status?.browserAccess ? "Enabled" : "Disabled"}</strong>
        <span>Network access</span>
        <strong>{status?.networkAccess ? "Enabled" : "Disabled"}</strong>
        <span>Locator recovery</span>
        <strong>{status ? (status.recoveryEngine === "legacy" ? "Legacy (per element)" : "Single snapshot") : "—"}</strong>
      </div>
      {status && !status.available && status.detail ? <p className="settings-card-hint">{status.detail}</p> : null}
    </section>
  );
}
