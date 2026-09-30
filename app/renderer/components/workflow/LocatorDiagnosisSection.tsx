import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ScanSearch } from "lucide-react";

import type { DomDiagnosisRequest, DomDiagnosisResponse } from "@src/runner/domIntelligence/DomIntelligenceApi";
import type { DomCandidateProof } from "@src/runner/domIntelligence/DomIntelligenceProvider";
import type { DiagnosisElement, LocatorDiagnosis } from "@src/runner/LocatorFactory";

/**
 * L11 "Find current element" (awkit-djnl.19, plan E4): a read-only diagnosis of one step on the Element
 * Spy's live page. It shows what the saved locator resolves to now, whether AWKIT's own identity proof
 * finds the recorded element, and the parser-only DOM-intelligence candidates with AWKIT's verdict on
 * each.
 *
 * It never changes a locator. In the Designer a suggestion can be copied into the editor's locator fields
 * (`onUseSuggestion`), which is the user's own edit: it stays unsaved until they save, exactly like typing
 * it. Only a suggestion the Recorder's generator proved unique on its own is offered; one that needs a
 * container chain says to re-record instead.
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
  "snapshot-failed": "The page could not be read."
};

function describeElement(element: DiagnosisElement | undefined): string {
  if (!element) return "an element";
  const role = element.owner.role || element.owner.tag;
  return element.owner.name ? `${role} “${element.owner.name}”` : role;
}

function usable(suggestion: Suggestion | undefined): suggestion is Suggestion {
  const quality = suggestion?.quality as { isUnique?: boolean; disambiguation?: string } | undefined;
  return Boolean(suggestion && quality?.isUnique === true && quality.disambiguation !== "container" && suggestion.strategy !== "xpath");
}

export function LocatorDiagnosisSection({
  request,
  onUseSuggestion,
  testId = "locator-diagnosis"
}: {
  /** The step to diagnose; null disables the action (nothing selected). */
  request: DomDiagnosisRequest | null;
  /** Designer only: copy a suggestion into the editor's locator fields (unsaved until the user saves). */
  onUseSuggestion?: (suggestion: Suggestion) => void;
  testId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [diagnosis, setDiagnosis] = useState<LocatorDiagnosis | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  const recorded = diagnosis?.recorded;
  return (
    <div className="locator-status" data-testid={testId}>
      <div className="locator-status-head">
        <button className="toolbar-button" type="button" data-testid={`${testId}-run`} disabled={!request || busy} onClick={() => void run()}>
          <ScanSearch size={15} aria-hidden="true" />
          {busy ? "Checking the live page…" : "Find current element"}
        </button>
      </div>

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
            <div className="locator-evidence-row" data-evidence="identity" data-snapshot-outcome={diagnosis.snapshot?.outcome ?? "none"}>
              <dt>Recorded element</dt>
              <dd>
                {!diagnosis.snapshot
                  ? "No recorded identity is available for this step, so AWKIT cannot prove which element it was."
                  : diagnosis.snapshot.outcome === "proven"
                    ? `Found: ${describeElement(diagnosis.snapshot.element)} (similarity ${diagnosis.snapshot.score ?? "?"}).`
                    : `Not proven: ${REFUSAL[diagnosis.snapshot.reason ?? ""] ?? "no unique match"}.`}
                {diagnosis.sensitive ? " This is a sensitive action: a run never recovers it automatically." : ""}
              </dd>
            </div>
            <div className="locator-evidence-row" data-evidence="candidates" data-provider-outcome={diagnosis.provider.outcome}>
              <dt>Other candidates</dt>
              <dd>
                {diagnosis.provider.outcome !== "ok"
                  ? PROVIDER_REASON[diagnosis.provider.reason ?? ""] ?? "Not available."
                  : diagnosis.provider.candidates.length === 0
                    ? "No similar element was found."
                    : `${diagnosis.provider.candidates.length} found by parser-only DOM intelligence, each checked by AWKIT:`}
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
                  {describeElement(candidate.element)} · match {Math.round(candidate.providerScore)}%
                  {candidate.awkitScore !== undefined ? ` · identity ${candidate.awkitScore}` : ""}
                  {onUseSuggestion && usable(suggestion) ? (
                    <button
                      className="toolbar-button"
                      type="button"
                      data-testid={`${testId}-use-${candidate.index}`}
                      onClick={() => onUseSuggestion(suggestion)}
                    >
                      Use this locator
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        {diagnosis ? (
          <span className="locator-status-headline" data-testid={`${testId}-timing`}>
            Checked in {Math.round(diagnosis.timings.totalMs)} ms
            {diagnosis.snapshot ? ` (identity ${Math.round(diagnosis.snapshot.ms)} ms` : " ("}
            {diagnosis.provider.ms !== undefined ? `${diagnosis.snapshot ? ", " : ""}DOM intelligence ${Math.round(diagnosis.provider.ms)} ms)` : ")"}
            {diagnosis.frame === "child" ? " · inside a frame" : ""}. Nothing on the page was changed.
          </span>
        ) : null}
      </div>
    </div>
  );
}
