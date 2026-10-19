import { Ban, Eye, Info } from "lucide-react";

import { exposedVisualDiagnosisObservations, type VisualDiagnosisRecord } from "@src/runner/visualDiagnosis/visualDiagnosisRecord";

/**
 * N5.5 (awkit-vra.14.5): the text-only *Visual diagnosis* section of the run-detail drawer. Plan:
 * docs/plans/ai-upgrade-v5/N5-visual-failure-diagnosis.md › Accessibility and UI (VD-6, VD-10).
 *
 * The records arrive already sanitized on read (`sanitizeVisualDiagnosisRecords`), and every code is shown through
 * `exposedVisualDiagnosisObservations`, so a code N5.6 pruned reads as `inconclusive`. Fixed sentences only: no
 * thumbnail, crop, digest, index, selector or highlight, and an identity result is always worded over the examined
 * scope, never as "only", "unique" or "the element".
 */

const BASIS: Record<VisualDiagnosisRecord["referenceSource"], string> = {
  runtime: "Compared with the reference from the last passing run.",
  recorded: "Compared with the reference the Recorder captured.",
  none: "No reference was available, so nothing was compared with one."
};

const REFUSALS: Record<string, string> = {
  "not-eligible": "Not diagnosed: the visual check does not look at this kind of failure.",
  sensitive: "Not diagnosed: the step acts on a sensitive or committing control, so nothing was captured.",
  "handoff-active": "Not diagnosed: the step is a manual handoff, so nothing was captured.",
  "protected-surface": "Not diagnosed: the page was a protected or handed-off surface, so nothing was captured.",
  "page-closed": "Not diagnosed: the page had already closed.",
  coalesced: "Not diagnosed: this step already failed the same way many times in this run, so it was not checked again.",
  "budget-exhausted": "Not diagnosed: the check ran out of time and recorded nothing.",
  "capture-failed": "Not diagnosed: the capture did not complete, so nothing was recorded."
};

const OBSERVATIONS: Record<string, string> = {
  "reference-unavailable": "No usable reference was found for this step.",
  "conditions-changed": "The reference was captured under different conditions (display scale, viewport or frame), so no comparison is reported.",
  "conditions-unproven": "The reference does not record how it was rendered, so a difference is never reported here; exact pixel matches still are.",
  "target-not-in-dom": "The step's locator matched no element on the page.",
  "target-multiple-matches": "The step's locator matched more than one element.",
  "target-offscreen": "The step's target was outside the visible part of the page.",
  "target-zero-size": "The step's target had no visible size.",
  "target-occluded": "Another element was on top of the step's target.",
  inconclusive: "The check ran, but nothing it can report applies."
};

/** Codes that are worded together, over the examined scope, rather than one sentence each. */
const IDENTITY = new Set(["target-identical-to-reference", "target-differs-from-reference", "other-examined-identical", "no-examined-identical"]);

const UNREADABLE = "An observation in this report could not be read.";

/** The examined-scope paragraph: what was pixel-identical among the elements the run examined, and what was not compared. */
function scopeSentences(record: VisualDiagnosisRecord, codes: string[]): string[] {
  const identity = codes.filter((code) => IDENTITY.has(code));
  if (identity.length === 0 && !record.truncated) return [];
  const sentences: string[] = [];
  if (identity.length > 0) {
    const parts: string[] = [];
    if (identity.includes("target-identical-to-reference")) parts.push("the step's target is pixel-identical to the reference");
    if (identity.includes("target-differs-from-reference")) parts.push("the step's target is not pixel-identical to the reference");
    if (identity.includes("other-examined-identical")) {
      parts.push(record.identicalOthers === "2+" ? "2 or more others are pixel-identical to the reference" : "1 other is pixel-identical to the reference");
    }
    if (identity.includes("no-examined-identical")) parts.push("none is pixel-identical to the reference");
    sentences.push(`Of the ${record.examined} ${record.examined === 1 ? "element" : "elements"} the run examined, ${parts.join(", and ")}.`);
  }
  if (record.truncated) sentences.push(`The run stopped after examining the first ${record.examined} of the elements it found.`);
  sentences.push("Elements the run did not examine were not compared.");
  return sentences;
}

function RecordView({ record, labelled }: { record: VisualDiagnosisRecord; labelled: boolean }) {
  const codes = exposedVisualDiagnosisObservations(record);
  const refused = record.outcome === "refused";
  const lines = refused
    ? codes.map((code) => ({ code, text: REFUSALS[code] ?? UNREADABLE }))
    : codes.filter((code) => !IDENTITY.has(code)).map((code) => ({ code, text: OBSERVATIONS[code] ?? UNREADABLE }));
  const scope = refused ? [] : scopeSentences(record, codes);
  return (
    <div className="visual-diagnosis-record" data-testid="visual-diagnosis-record" data-outcome={record.outcome}>
      {labelled ? (
        <p className="visual-diagnosis-step">
          Step <code>{record.stepId}</code>, attempt {record.attempt}
        </p>
      ) : null}
      {refused ? null : (
        <p className="awkit-muted" data-testid="visual-diagnosis-basis">
          {BASIS[record.referenceSource]}
        </p>
      )}
      <ul className="visual-diagnosis-list">
        {lines.map((line) => (
          <li key={line.code} data-testid="visual-diagnosis-observation" data-code={line.code}>
            {refused ? <Ban size={13} aria-hidden="true" /> : <Info size={13} aria-hidden="true" />}
            <span>{line.text}</span>
          </li>
        ))}
        {scope.length ? (
          <li data-testid="visual-diagnosis-scope">
            <Eye size={13} aria-hidden="true" />
            <span>{scope.join(" ")}</span>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

export function VisualDiagnosisSection({ records }: { records: VisualDiagnosisRecord[] }) {
  return (
    <section className="awkit-detail-section" data-testid="visual-diagnosis-section" aria-labelledby="visual-diagnosis-heading">
      <h3 id="visual-diagnosis-heading">Visual diagnosis</h3>
      <p className="visual-diagnosis-caveat" data-testid="visual-diagnosis-caveat">
        Advisory. This does not identify an element to use, and it does not change the run.
      </p>
      {records.map((record, index) => (
        <RecordView key={`${record.stepId}-${record.attempt}-${index}`} record={record} labelled={records.length > 1} />
      ))}
    </section>
  );
}
