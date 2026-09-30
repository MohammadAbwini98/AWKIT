import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ScanSearch } from "lucide-react";

import { isApplicableSuggestion, type DomDiagnosisRequest, type DomDiagnosisResponse } from "@src/runner/domIntelligence/DomIntelligenceApi";
import type { DomCandidateProof } from "@src/runner/domIntelligence/DomIntelligenceProvider";
import type { DiagnosisElement, LocatorDiagnosis } from "@src/runner/LocatorFactory";
import { Permission } from "@src/security/authz/Permissions";

import { usePermissions } from "../../security/usePermissions";

/**
 * L11 "Find current element" (awkit-djnl.19, plan E4): a read-only diagnosis of one step on the Element
 * Spy's live page. It shows what the saved locator resolves to now, whether AWKIT's own identity proof
 * finds the recorded element, and the parser-only DOM-intelligence candidates with AWKIT's verdict on
 * each.
 *
 * It never changes a locator. In the Designer a suggestion can be copied into the editor's locator fields
 * (`onUseSuggestion`), which is the user's own edit: it stays unsaved until they save, exactly like typing
 * it. A suggestion is offered only for an element AWKIT's identity proof picked, on a page that is not a
 * protected surface, with a locator the Recorder's generator proved unique on its own and the editor can
 * hold; anything else (a container chain, an unproven candidate) stays evidence only.
 */

type Suggestion = DiagnosisElement["locator"];

const PROOF_LABEL: Readonly<Record<DomCandidateProof, { label: string; tone: "ok" | "warn" | "danger" | "info" | "muted" }>> = {
  proven: { label: "Proven", tone: "ok" },
  "below-threshold": { label: "Too different", tone: "warn" },
  "ambiguous-margin": { label: "Ambiguous", tone: "danger" },
  "ancestry-veto": { label: "Different place", tone: "warn" },
  incompatible: { label: "Wrong kind", tone: "muted" },
  "not-visible": { label: "Not visible", tone: "muted" },
  "no-recorded-identity": { label: "No recorded identity", tone: "info" }
};

const REFUSAL: Readonly<Record<string, string>> = {
  "no-candidate": "no visible element of the recorded kind is on the page",
  "below-threshold": "no element is similar enough to the recorded one",
  "ambiguous-margin": "two or more elements are equally similar, so none is chosen",
  "ancestry-veto": "the closest match sits in a different part of the page",
  "snapshot-truncated": "the page is too large to prove a unique match",
  "snapshot-failed": "the page could not be read",
  "stale-snapshot": "the page changed while it was being read"
};

const PROVIDER_REASON: Readonly<Record<string, string>> = {
  "provider-unavailable": "DOM intelligence is not available in this build or is turned off.",
  "provider-timeout": "DOM intelligence did not answer in time.",
  "provider-error": "DOM intelligence could not analyse this page.",
  "no-reference": "No DOM reference was recorded for this step. Record it again, or run it once successfully.",
  "protected-surface": "This page has a protected sign-in field, so it is not analysed.",
  "snapshot-failed": "The page could not be read.",
  "route-mismatch": "This page is on a different route than the one the step was recorded on, so its reference is not used."
};

function describeElement(element: DiagnosisElement | undefined): string {
  if (!element) return "an element";
  const role = element.owner.role || element.owner.tag;
  return element.owner.name ? `${role} “${element.owner.name}”` : role;
}

const usable = isApplicableSuggestion;

export function LocatorDiagnosisSection({
  request,
  onUseSuggestion,
  note,
  testId = "locator-diagnosis"
}: {
  /** The step to diagnose; null disables the action (nothing selected). */
  request: DomDiagnosisRequest | null;
  /** Designer only: copy a suggestion into the editor's locator fields (unsaved until the user saves). */
  onUseSuggestion?: (suggestion: Suggestion) => void;
  /** A hint under the action (e.g. the Designer's unsaved-edits note). */
  note?: string;
  testId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [diagnosis, setDiagnosis] = useState<LocatorDiagnosis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { can } = usePermissions();
  const token = useRef(0);
  const key = request ? JSON.stringify(request) : "";

  useEffect(() => {
    token.current += 1;
    setDiagnosis(null);
    setError(null);
    setBusy(false);
  }, [key]);

  const run = async (): Promise<void> => {
    if (!request) return;
    const mine = (token.current += 1);
    setBusy(true);
    setError(null);
    let response: DomDiagnosisResponse;
    try {
      response = await window.playwrightFlowStudio.domIntelligence.diagnoseStep(request);
    } catch {
      response = { ok: false, code: "FAILED", message: "The diagnosis could not be completed on the current page." };
    }
    if (mine !== token.current) return;
    setBusy(false);
    if (response.ok) setDiagnosis(response.diagnosis);
    else {
      setDiagnosis(null);
      setError(response.message);
    }
  };

  if (!can(Permission.PAGE_RECORDER)) return null;

  const recorded = diagnosis?.recorded;
  // A protected surface, or a page on another route than the step's reference (L11.F), offers nothing.
  const protectedSurface = diagnosis?.provider.reason === "protected-surface" || diagnosis?.route === "mismatch";
  const snapshot = diagnosis?.snapshot;
  const proofSuggestion = snapshot?.element?.locator;
  const useButton = (suggestion: Suggestion, id: string) => (
    <button className="toolbar-button" type="button" data-testid={`${testId}-use-${id}`} onClick={() => onUseSuggestion?.(suggestion)}>
      Use this locator
    </button>
  );
  return (
    <div className="locator-status" data-testid={testId}>
      <div className="locator-status-head">
        <button className="toolbar-button" type="button" data-testid={`${testId}-run`} disabled={!request || busy} onClick={() => void run()}>
          <ScanSearch size={15} aria-hidden="true" />
          {busy ? "Checking the live page…" : "Find current element"}
        </button>
      </div>
      {note ? <p className="form-message">{note}</p> : null}

      <div role="status" aria-live="polite" data-testid={`${testId}-result`}>
        {error ? (
          <span className="form-message error">
            <AlertTriangle size={13} style={{ verticalAlign: "-2px" }} aria-hidden="true" /> {error}
          </span>
        ) : null}
        {diagnosis ? (
          <dl className="locator-evidence-list">
            <div className="locator-evidence-row" data-evidence="recorded" data-recorded-status={recorded?.status}>
              <dt>Saved locator</dt>
              <dd>
                {recorded?.status === "resolved"
                  ? "Finds exactly one element on this page."
                  : recorded?.status === "ambiguous"
                    ? `Matches ${recorded.matches ?? "several"} elements, so it cannot run safely.`
                    : recorded?.status === "error"
                      ? `Cannot be checked here: ${recorded.detail ?? "the page or frame changed"}.`
                      : "Finds nothing on this page."}
              </dd>
            </div>
            <div className="locator-evidence-row" data-evidence="identity" data-snapshot-outcome={snapshot?.outcome ?? "none"}>
              <dt>Recorded element</dt>
              <dd>
                {!snapshot
                  ? "No recorded identity is available for this step, so AWKIT cannot prove which element it was."
                  : snapshot.outcome === "proven"
                    ? `Found by AWKIT identity proof: ${describeElement(snapshot.element)} (similarity ${snapshot.score ?? "?"}` +
                      `${snapshot.runnerUpScore !== undefined ? `, next closest ${snapshot.runnerUpScore}` : ""}).`
                    : `Not proven: ${REFUSAL[snapshot.reason ?? ""] ?? "no unique match"}` +
                      `${snapshot.score !== undefined ? ` (closest ${snapshot.score}${snapshot.runnerUpScore !== undefined ? `, next ${snapshot.runnerUpScore}` : ""})` : ""}.`}
                {diagnosis.sensitive ? " This is a sensitive action: a run never recovers it automatically." : ""}
                {onUseSuggestion && usable(proofSuggestion, snapshot?.outcome === "proven", protectedSurface) ? useButton(proofSuggestion, "proof") : null}
              </dd>
            </div>
            <div className="locator-evidence-row" data-evidence="candidates" data-provider-outcome={diagnosis.provider.outcome}>
              <dt>Other candidates</dt>
              <dd>
                {diagnosis.provider.outcome !== "ok"
                  ? PROVIDER_REASON[diagnosis.provider.reason ?? ""] ?? "Not available."
                  : diagnosis.provider.candidates.length === 0
                    ? "No similar element was found."
                    : `${diagnosis.provider.candidates.length} found by parser-only DOM intelligence (evidence only), each checked by AWKIT:`}
              </dd>
            </div>
            <div className="locator-evidence-row" data-evidence="context" data-frame={diagnosis.frame ?? "unknown"}>
              <dt>Checked on</dt>
              <dd data-testid={`${testId}-context`}>
                Page “{diagnosis.page ?? "main"}” · {diagnosis.frame === "child" ? "inside a frame" : "top document"}
                {diagnosis.route === "mismatch" ? " · a different route from the recording" : ""}
              </dd>
            </div>
          </dl>
        ) : null}
        {diagnosis?.provider.outcome === "ok" && diagnosis.provider.candidates.length > 0 ? (
          <ul className="locator-evidence-list" data-testid={`${testId}-candidates`} aria-label="Candidates">
            {diagnosis.provider.candidates.map((candidate) => {
              const proof = PROOF_LABEL[candidate.proof];
              const suggestion = candidate.element?.locator;
              return (
                <li key={candidate.index} className="locator-evidence-row" data-proof={candidate.proof}>
                  <span className={`locator-status-badge tone-${proof.tone}`}>{proof.label}</span>{" "}
                  {describeElement(candidate.element)} · DOM intelligence match {Math.round(candidate.providerScore)}%
                  {candidate.awkitScore !== undefined ? ` · AWKIT identity ${candidate.awkitScore}` : ""}
                  {onUseSuggestion && usable(suggestion, candidate.proof === "proven", protectedSurface) ? useButton(suggestion, String(candidate.index)) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        {diagnosis ? (
          <span className="locator-status-headline" data-testid={`${testId}-timing`}>
            Checked in {Math.round(diagnosis.timings.totalMs)} ms
            {snapshot ? ` (identity ${Math.round(snapshot.ms)} ms` : " ("}
            {diagnosis.provider.ms !== undefined ? `${snapshot ? ", " : ""}DOM intelligence ${Math.round(diagnosis.provider.ms)} ms)` : ")"}.
            Nothing on the page was changed.
          </span>
        ) : null}
      </div>
    </div>
  );
}
