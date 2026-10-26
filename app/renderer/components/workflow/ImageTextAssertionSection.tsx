import { useEffect, useState } from "react";

import type { ConcurrentRunReport } from "@src/reports/ExecutionReport";
import { OCR_EXPECTED_MAX_LENGTH } from "@src/ocr/ocrExpectedText";
import { sanitizeOcrAssertionReportRecords, type OcrAssertionReportRecord } from "@src/runner/ocr/ocrAssertionReport";

import { imageTextFacts, imageTextSentence } from "../reports/ImageTextReportSection";
import type { FlowDesignerNodeData } from "./flowDesignerTypes";
import { imageTextDesignerProblems } from "./imageTextDesigner";

/**
 * N7.5 (awkit-vra.9.6): the Designer's Image text section for an `assertImageText` node. The expected text itself is
 * edited in the shared Value Source section (a static text or a dynamic binding); this section holds the match mode and
 * case sensitivity, says what observe means, shows the contract's validation and OC-8 messages (never quoting the
 * expected text) and the step's latest observation from the stored run reports (codes only, sanitized on read).
 *
 * Observe only: there is no enforce option. Text first: every state is a sentence, never colour alone, and nothing
 * animates.
 */

const MATCH_LABELS = {
  normalized: "Normalized — ignore spacing and typographic punctuation (default)",
  exact: "Exact — the whole text, character for character",
  contains: "Contains — the expected text appears within the element"
} as const;

export function ImageTextAssertionSection({
  flowId,
  stepId,
  data,
  onChange
}: {
  flowId: string;
  stepId: string;
  data: FlowDesignerNodeData;
  onChange: (patch: Partial<FlowDesignerNodeData>) => void;
}) {
  const savedMatch = data.configOriginal?.ocrMatch;
  const unsupportedSavedMatch = data.ocrMatch === undefined && savedMatch !== undefined;
  const match = data.ocrMatch ?? "normalized";
  const caseSensitive = data.ocrCaseSensitive ?? match === "exact";
  const problems = imageTextDesignerProblems(data);
  const literalLength = data.valueSourceType === "static" ? data.value.length : 0;

  const [latest, setLatest] = useState<{ record: OcrAssertionReportRecord; at: string } | null>(null);
  useEffect(() => {
    let live = true;
    setLatest(null);
    window.playwrightFlowStudio.reports
      .list()
      .then((reports) => {
        if (!live) return;
        const runs = [...(reports as ConcurrentRunReport[])].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
        // The newest run that recorded this step; within it, its last instance's last record.
        for (const run of runs) {
          const record = (run.instances ?? [])
            .flatMap((instance) => sanitizeOcrAssertionReportRecords(instance.ocrAssertions) ?? [])
            .filter((r) => r.flowId === flowId && r.stepId === stepId)
            .at(-1);
          if (record) return setLatest({ record, at: run.startedAt });
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [flowId, stepId]);

  return (
    <details className="property-group" open data-testid="image-text-section">
      <summary>Image text</summary>
      <section className="property-section">
        <label>
          Match
          <select
            data-testid="image-text-match"
            value={unsupportedSavedMatch ? "" : match}
            onChange={(e) => onChange({ ocrMatch: e.target.value as FlowDesignerNodeData["ocrMatch"] })}
          >
            {unsupportedSavedMatch ? (
              <option value="" disabled>
                Unsupported saved match mode — choose one
              </option>
            ) : null}
            <option value="normalized">{MATCH_LABELS.normalized}</option>
            <option value="exact">{MATCH_LABELS.exact}</option>
            <option value="contains">{MATCH_LABELS.contains}</option>
          </select>
        </label>
        <label className="inline-check">
          <input
            type="checkbox"
            data-testid="image-text-case"
            checked={caseSensitive}
            onChange={(e) => onChange({ ocrCaseSensitive: e.target.checked })}
          />
          Case sensitive
        </label>
        <span className="form-message" data-testid="image-text-observe">
          Observe only: the element's rendered text is read offline on this computer and compared with the expected text
          from Value Source ({literalLength}/{OCR_EXPECTED_MAX_LENGTH} characters). The result is recorded in the run report
          and never fails, retries or changes the run. It runs only when image text assertions are turned on
          (AWKIT_VISUAL_OCR=observe) and the offline reader is installed; otherwise the step is recorded as not evaluated.
          Passwords, one-time codes, card numbers, secrets and protected pages are never read.
        </span>
        {problems.length ? (
          <ul className="form-message error" data-testid="image-text-problems" aria-live="polite">
            {problems.map((problem) => (
              <li key={problem.code} data-code={problem.code}>
                This step {problem.message}.
              </li>
            ))}
          </ul>
        ) : null}
        <span className="form-message" data-testid="image-text-latest" data-code={latest?.record.code ?? "none"}>
          {latest
            ? `Latest run (${new Date(latest.at).toLocaleString()}): ${imageTextSentence(latest.record)} ${imageTextFacts(latest.record)} Reason code ${latest.record.code}.`
            : "No run report records this step yet."}
        </span>
      </section>
    </details>
  );
}
