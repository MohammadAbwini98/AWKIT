import { useEffect, useState } from "react";
import { CircleSlash, Eye, HelpCircle, ScanText } from "lucide-react";

import type { ConcurrentRunReport } from "@src/reports/ExecutionReport";
import {
  ocrAssertionRunTotals,
  ocrAssertionTotals,
  sanitizeOcrAssertionReportRecords,
  type OcrAssertionReportRecord,
  type OcrAssertionTotals
} from "@src/runner/ocr/ocrAssertionReport";

const api = () => window.playwrightFlowStudio;

/**
 * N7.5 (awkit-vra.9.6): the text-only *Image text* section of the run-detail drawer. Plan:
 * docs/plans/ai-upgrade-v5/N7-ocr-text-in-image.md › Reporting.
 *
 * Read from the stored run report and sanitized again here, so only fixed codes, buckets, a character count, step and
 * flow ids and a duration reach the screen: never the recognized or expected text, pixels or a selector. Every line is
 * a sentence with its exact code, icons are decorative, nothing is focusable and nothing moves. Observe never fails a
 * step, and every line says so where it could be misread.
 *
 * N7 amendment A1.9 (DECISIONS 2026-10-28, copy approved 2026-10-31): the recognizer is not qualified for accuracy
 * (OC-10 NOT MET), so every verdict is worded as unverified OCR evidence: what the recognizer reported, never what the
 * element shows. No success check mark is used for a reported match.
 */
export const UNVERIFIED_OCR_LABEL = "Unverified OCR evidence";
const UNVERIFIED_OCR_PHRASE = "unverified OCR evidence";

/** Why a check did not produce a verdict, by code. Unknown codes fall back to the generic sentence. */
const REASONS: Readonly<Record<string, string>> = {
  disabled: "image text assertions are turned off in this session (AWKIT_VISUAL_OCR is not observe)",
  "ocr-unavailable": "the offline text reader is not available in this build or could not start",
  "assets-missing": "the offline text reader's files are missing from this installation",
  "checksum-mismatch": "the offline text reader's files do not match their pinned checksums, so they were not used",
  "unsupported-cpu": "this computer's processor cannot run the offline text reader",
  "ocr-busy": "the text reader was busy with other checks",
  "budget-exhausted": "the check ran out of time (1.5 seconds)",
  cancelled: "the run was stopped during the check",
  "page-closed": "the page closed during the check",
  "capture-stale": "the element changed while it was being captured",
  "capture-unavailable": "the element could not be captured",
  "handoff-active": "a manual or protected-login handoff was active",
  "protected-surface": "the page is a protected login, payment or verification surface, which is never read",
  "sensitive-step": "the element is inside a password, payment or one-time-code field, which is never read",
  "sensitive-input": "the expected text is a secret, a sensitive value or comes from a sensitive source, which is never compared",
  "expected-invalid": "the step's expected text or match settings are not valid",
  "expected-unavailable": "the expected text could not be resolved",
  "unsupported-text": "the expected text uses characters outside the supported English set",
  "target-not-found": "the element was not found",
  "target-not-unique": "the locator matched more than one element",
  "target-hidden": "the element is hidden",
  "target-offscreen": "the element is outside the page",
  "region-too-small": "the text is too small to read reliably",
  "region-too-large": "the element is too large to read in time",
  "region-clipped": "the element is cut off by its container",
  "near-miss": "the recognizer's reading differs only slightly from the expected text",
  "lookalike-only-difference": "the recognizer's reading differs from the expected text only in look-alike characters (such as O and 0)",
  "ambiguous-match": "the recognizer reported the expected text more than once",
  "low-confidence": "the text reader was not confident enough",
  "lookalike-uncertain": "look-alike characters could not be told apart",
  "no-text-read": "the recognizer reported no text for the element",
  "ocr-output-invalid": "the text reader returned an unusable result",
  "policy-invalid": "the decision settings are not valid",
  "input-invalid": "the captured image was not usable"
};

const DISTANCE: Readonly<Record<string, string>> = {
  exact: "no character edits",
  "one-edit": "one character edit",
  "few-edits": "a few character edits",
  "many-edits": "many character edits"
};
const CONFIDENCE: Readonly<Record<string, string>> = {
  "ge-95": "95% or more",
  "90-to-95": "90 to 95%",
  "80-to-90": "80 to 90%",
  "below-80": "below 80%"
};

/** The fixed sentence for one observation; shared with the Designer's latest-result line. Never holds text. */
export function imageTextSentence(record: OcrAssertionReportRecord): string {
  if (record.verdict === "matched") {
    return `${UNVERIFIED_OCR_LABEL}: the text recognizer reported a match with the expected text. This is not a confirmed check of the element's text. Observe never fails a step.`;
  }
  if (record.verdict === "differs") {
    return `${UNVERIFIED_OCR_LABEL}: the text recognizer reported different text. This does not prove the element is wrong. Observe never fails a step.`;
  }
  const reason = REASONS[record.code];
  if (!record.verdict) return `Not evaluated${reason ? `: ${reason}` : ""}.`;
  return `${UNVERIFIED_OCR_LABEL}: no verdict${reason ? ` (${reason})` : ""}. Observe never fails a step.`;
}

/** Buckets, character count and duration as a sentence; empty when the record has none of them. */
export function imageTextFacts(record: OcrAssertionReportRecord): string {
  const facts: string[] = [];
  if (record.distanceBucket) facts.push(`difference: ${DISTANCE[record.distanceBucket]}`);
  if (record.confidenceBucket) facts.push(`reader confidence: ${CONFIDENCE[record.confidenceBucket]}`);
  if (record.charCount !== undefined) facts.push(`${record.charCount} ${record.charCount === 1 ? "character" : "characters"} read`);
  facts.push(`took ${record.durationMs} ms`);
  return `${facts.join("; ")}.`;
}

function totalsSentence(totals: OcrAssertionTotals, scope: string): string {
  const parts = [`${totals.matched} reported matched`, `${totals.differs} reported different`, `${totals.inconclusive} without a verdict`];
  if (totals.notEvaluated) parts.push(`${totals.notEvaluated} not evaluated`);
  return `${scope}: ${totals.total} image text ${totals.total === 1 ? "assertion" : "assertions"} (observe only, ${UNVERIFIED_OCR_PHRASE}) — ${parts.join(", ")}.`;
}

async function loadRun(executionId: string, instanceId: string): Promise<{ records: OcrAssertionReportRecord[]; run: OcrAssertionTotals | null } | null> {
  const direct = (await api().reports.get(executionId)) as ConcurrentRunReport | null;
  const report = direct ?? ((await api().reports.list()) as ConcurrentRunReport[]).find((candidate) => candidate.executionId === executionId) ?? null;
  if (!report) return null;
  const instance = report.instances.find((candidate) => candidate.instanceId === instanceId);
  const records = sanitizeOcrAssertionReportRecords(instance?.ocrAssertions);
  return records ? { records, run: ocrAssertionRunTotals(report.instances) } : null;
}

export function ImageTextReportSection({ executionId, instanceId }: { executionId: string; instanceId: string }) {
  const [data, setData] = useState<{ records: OcrAssertionReportRecord[]; run: OcrAssertionTotals | null } | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    loadRun(executionId, instanceId).then(
      (loaded) => live && setData(loaded),
      () => live && setData(null)
    );
    return () => {
      live = false;
    };
  }, [executionId, instanceId]);

  if (!data) return null;
  const instanceTotals = ocrAssertionTotals(data.records);
  return (
    <section className="awkit-detail-section" data-testid="image-text-report-section" aria-labelledby="image-text-report-heading">
      <h3 id="image-text-report-heading">Image text ({UNVERIFIED_OCR_PHRASE})</h3>
      <p data-testid="image-text-instance-totals">{totalsSentence(instanceTotals, "This instance")}</p>
      {data.run && data.run.total !== instanceTotals.total ? (
        <p className="awkit-muted" data-testid="image-text-run-totals">
          {totalsSentence(data.run, "This run")}
        </p>
      ) : null}
      <ul className="visual-diagnosis-list">
        {data.records.map((record, index) => (
          <li
            key={`${record.flowId}-${record.stepId}-${index}`}
            data-testid="image-text-record"
            data-verdict={record.verdict ?? "none"}
            data-code={record.code}
          >
            {record.verdict === "matched" ? (
              <ScanText size={13} aria-hidden="true" />
            ) : record.verdict === "differs" ? (
              <Eye size={13} aria-hidden="true" />
            ) : record.verdict === "inconclusive" ? (
              <HelpCircle size={13} aria-hidden="true" />
            ) : (
              <CircleSlash size={13} aria-hidden="true" />
            )}
            <span>
              Step <code>{record.stepId}</code>: {imageTextSentence(record)} {imageTextFacts(record)} Reason code <code>{record.code}</code>.
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
