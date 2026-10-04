import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ListChecks } from "lucide-react";

import type { DomDriftResponse, DomDriftStatus, DomDriftStep } from "@src/runner/domIntelligence/DomIntelligenceApi";
import { Permission } from "@src/security/authz/Permissions";

import { usePermissions } from "../../security/usePermissions";

/**
 * L12.9 "Check all steps" (awkit-djnl.21.9): every element step of the saved flow, checked read-only against
 * the Element Spy's live page before a run. It never changes a locator and never acts on the page.
 */

const STATUS: Readonly<Record<DomDriftStatus, { label: string; tone: "ok" | "warn" | "danger" | "muted" }>> = {
  ok: { label: "Finds its element", tone: "ok" },
  recoverable: { label: "Changed, recoverable", tone: "warn" },
  ambiguous: { label: "Matches several", tone: "danger" },
  drifted: { label: "Will fail here", tone: "danger" },
  "not-here": { label: "Not on this page", tone: "muted" }
};

export function DriftCheckSection({ flowId, testId = "drift-check" }: { flowId: string | undefined; testId?: string }) {
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<DomDriftStep[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { can } = usePermissions();
  const token = useRef(0);

  useEffect(() => {
    token.current += 1;
    setSteps(null);
    setError(null);
    setBusy(false);
  }, [flowId]);

  if (!can(Permission.PAGE_RECORDER) || !can(Permission.PAGE_FLOWS)) return null;

  const run = async (): Promise<void> => {
    if (!flowId) return;
    const mine = (token.current += 1);
    setBusy(true);
    setError(null);
    let response: DomDriftResponse;
    try {
      response = await window.playwrightFlowStudio.domIntelligence.checkDrift({ flowId });
    } catch {
      response = { ok: false, code: "FAILED", message: "The check could not be completed on the current page." };
    }
    if (mine !== token.current) return;
    setBusy(false);
    if (response.ok) setSteps(response.steps);
    else {
      setSteps(null);
      setError(response.message);
    }
  };

  const failing = steps?.filter((step) => step.status === "drifted" || step.status === "ambiguous").length ?? 0;
  return (
    <div className="locator-status" data-testid={testId}>
      <div className="locator-status-head">
        <button className="toolbar-button" type="button" data-testid={`${testId}-run`} disabled={!flowId || busy} onClick={() => void run()}>
          <ListChecks size={15} aria-hidden="true" />
          {busy ? "Checking every step…" : "Check all steps on the live page"}
        </button>
      </div>
      <div role="status" aria-live="polite" data-testid={`${testId}-result`}>
        {error ? (
          <span className="form-message error">
            <AlertTriangle size={13} style={{ verticalAlign: "-2px" }} aria-hidden="true" /> {error}
          </span>
        ) : null}
        {steps ? (
          <>
            <span className="locator-status-headline" data-testid={`${testId}-summary`} data-failing={failing}>
              {failing === 0 ? "No step on this page is expected to fail." : `${failing} step${failing === 1 ? "" : "s"} would fail on this page.`} Nothing was changed.
            </span>
            <ul className="locator-evidence-list" aria-label="Steps">
              {steps.map((step) => (
                <li key={step.stepId} className="locator-evidence-row" data-drift={step.status}>
                  <span className={`locator-status-badge tone-${STATUS[step.status].tone}`}>{STATUS[step.status].label}</span> {step.name}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}
