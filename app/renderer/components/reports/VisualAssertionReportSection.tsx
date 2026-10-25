import { useEffect, useState } from "react";
import { Ban, CheckCircle2, Eye, XCircle } from "lucide-react";

import type { ConcurrentRunReport } from "@src/reports/ExecutionReport";
import {
  sanitizeVisualAssertionReportRecords,
  visualAssertionRunTotals,
  visualAssertionTotals,
  type VisualAssertionReportRecord,
  type VisualAssertionTotals
} from "@src/runner/visualAssertion/visualAssertionReport";

const api = () => window.playwrightFlowStudio;

/**
 * N6.7 (awkit-vra.15.7): the text-only *Visual assertions* section of the run-detail drawer. Plan:
 * docs/plans/ai-upgrade-v5/N6-visual-assertions.md › Reporting.
 *
 * Read from the stored run report and sanitized again here (`reports:create` imports whole reports), so only fixed
 * codes, step and flow ids reach the screen: no image, digest, commitment, token, selector or URL. A visual mismatch
 * (proven different) and visual unverified (not proven equal) are always worded apart, every line is a sentence with
 * its exact code, icons are decorative, nothing is focusable and nothing moves.
 */

const UNVERIFIED: Record<string, string> = {
  "enforce-unavailable-in-production": "this build does not enforce visual assertions; switch the step to observe",
  "enforce-not-enabled": "visual assertions run in observe mode in this session",
  disabled: "visual assertions are turned off",
  "cell-not-qualified": "this browser mode and display scale have no valid calibration grant",
  "grant-invalidated": "the calibration grant no longer matches this environment",
  "grant-expired": "the calibration grant has expired",
  "evaluation-unavailable": "the check could not run",
  "budget-exhausted": "the check ran out of time",
  "capture-unavailable": "the element could not be captured"
};

/** The fixed sentence for one decision; shared with the Designer's latest-result line. */
export function visualAssertionSentence(record: VisualAssertionReportRecord): string {
  if (record.status === "failed") {
    return record.failureClass === "visual-mismatch"
      ? "Failed — visual mismatch: the element differs from its approved baseline."
      : `Failed — visual unverified: equality with the approved baseline was not proven${UNVERIFIED[record.code] ? ` (${UNVERIFIED[record.code]})` : ""}.`;
  }
  if (record.mode === "enforce") return "Passed — equality with the approved baseline was proven.";
  if (!record.verdict) return record.code === "disabled" ? "Not evaluated: visual assertions are turned off." : "Observed: the check could not run. Observe never fails a step.";
  if (record.verdict === "passed") return "Observed: the element matches its approved baseline.";
  if (record.verdict === "failed") return "Observed: the element differs from its approved baseline. Observe never fails a step.";
  return "Observed: equality was not proven. Observe never fails a step.";
}

function totalsSentence(totals: VisualAssertionTotals, scope: string): string {
  const parts = [`${totals.passed} passed`, `${totals.mismatch} visual mismatch`, `${totals.unverified} visual unverified`];
  const observed: string[] = [];
  if (totals.observedDifferent) observed.push(`${totals.observedDifferent} observed with a difference`);
  if (totals.observedInconclusive) observed.push(`${totals.observedInconclusive} observed without proof`);
  return `${scope}: ${totals.total} visual ${totals.total === 1 ? "assertion" : "assertions"} — ${parts.join(", ")}${observed.length ? `; ${observed.join(", ")}` : ""}${
    totals.candidates ? `. ${totals.candidates} pending ${totals.candidates === 1 ? "baseline" : "baselines"} captured for approval in the Flow Designer` : ""
  }.`;
}

async function loadRun(executionId: string, instanceId: string): Promise<{ records: VisualAssertionReportRecord[]; run: VisualAssertionTotals | null } | null> {
  const direct = (await api().reports.get(executionId)) as ConcurrentRunReport | null;
  const report = direct ?? ((await api().reports.list()) as ConcurrentRunReport[]).find((candidate) => candidate.executionId === executionId) ?? null;
  if (!report) return null;
  const instance = report.instances.find((candidate) => candidate.instanceId === instanceId);
  const records = sanitizeVisualAssertionReportRecords(instance?.visualAssertions);
  return records ? { records, run: visualAssertionRunTotals(report.instances) } : null;
}

export function VisualAssertionReportSection({ executionId, instanceId }: { executionId: string; instanceId: string }) {
  const [data, setData] = useState<{ records: VisualAssertionReportRecord[]; run: VisualAssertionTotals | null } | null>(null);

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
  const instanceTotals = visualAssertionTotals(data.records);
  return (
    <section className="awkit-detail-section" data-testid="visual-assertion-report-section" aria-labelledby="visual-assertion-report-heading">
      <h3 id="visual-assertion-report-heading">Visual assertions</h3>
      <p data-testid="visual-assertion-instance-totals">{totalsSentence(instanceTotals, "This instance")}</p>
      {data.run && data.run.total !== instanceTotals.total ? (
        <p className="awkit-muted" data-testid="visual-assertion-run-totals">
          {totalsSentence(data.run, "This run")}
        </p>
      ) : null}
      <ul className="visual-diagnosis-list">
        {data.records.map((record, index) => (
          <li
            key={`${record.flowId}-${record.stepId}-${index}`}
            data-testid="visual-assertion-record"
            data-status={record.status}
            data-failure-class={record.failureClass ?? "none"}
            data-code={record.code}
          >
            {record.status === "passed" ? (
              record.mode === "observe" ? (
                <Eye size={13} aria-hidden="true" />
              ) : (
                <CheckCircle2 size={13} aria-hidden="true" />
              )
            ) : record.failureClass === "visual-mismatch" ? (
              <XCircle size={13} aria-hidden="true" />
            ) : (
              <Ban size={13} aria-hidden="true" />
            )}
            <span>
              Step <code>{record.stepId}</code> ({record.mode}): {visualAssertionSentence(record)} Reason code <code>{record.code}</code>.
              {record.candidate ? " A pending baseline was captured for approval in the Flow Designer." : ""}
              {record.candidateWithheld === "run-unattributed" ? " No pending baseline was kept: the run had no signed-in user." : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
