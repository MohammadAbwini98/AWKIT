import { useEffect, useState } from "react";
import { AlertTriangle, Sparkles, X } from "lucide-react";

import type { FailureAnalysisView } from "@src/ai/contracts/AiApi";
import type { ConcurrentRunReport } from "@src/reports/ExecutionReport";
import type { InstanceDiagnostics } from "@src/runner/evidence/FailureEvidenceCollector";

import { aiUnavailableSentence, useAiAssistJob } from "../shared/useAiAssistJob";

const api = () => window.playwrightFlowStudio;

/** The instance's L5a diagnostics from its stored run report. Null when none were captured. */
async function loadDiagnostics(executionId: string, instanceId: string): Promise<InstanceDiagnostics | null> {
  const direct = (await api().reports.get(executionId)) as ConcurrentRunReport | null;
  const report =
    direct ?? ((await api().reports.list()) as ConcurrentRunReport[]).find((candidate) => candidate.executionId === executionId) ?? null;
  return report?.instances.find((instance) => instance.instanceId === instanceId)?.diagnostics ?? null;
}

/**
 * L5 reports UX in the run-detail drawer: three separate sections, never merged.
 *
 *  - **Deterministic cause** — L5a's own conclusion. Always shown, needs no AI.
 *  - **Captured evidence** — the redacted, id-stripped events it rests on, exactly as persisted.
 *  - **AI analysis** — on demand, T0, labelled. It covers every failed instance in the run with the same
 *    signature (the count is shown) and cites evidence by id; cited rows are marked in the list above so a
 *    citation can be checked rather than believed. It changes nothing about the run.
 */
export function FailureEvidenceSection({ executionId, instanceId }: { executionId: string; instanceId: string }) {
  const [diagnostics, setDiagnostics] = useState<InstanceDiagnostics | null | undefined>(undefined);
  const job = useAiAssistJob<FailureAnalysisView>(`${executionId}/${instanceId}`);

  useEffect(() => {
    let live = true;
    setDiagnostics(undefined);
    loadDiagnostics(executionId, instanceId)
      .then((value) => {
        if (live) setDiagnostics(value);
      })
      .catch(() => {
        if (live) setDiagnostics(null);
      });
    return () => {
      live = false;
    };
  }, [executionId, instanceId]);

  if (diagnostics === undefined) return null;
  if (diagnostics === null || !diagnostics.cause) {
    return (
      <section className="awkit-detail-section" data-testid="failure-evidence-section" data-evidence-state="none">
        <h3>Failure evidence</h3>
        <p className="awkit-muted">No failure evidence was captured for this run (an older report, a passing run, or capture turned off).</p>
      </section>
    );
  }

  const { cause, evidence } = diagnostics;
  const { phase } = job;
  const done = phase.kind === "done" ? phase.view : null;
  const primary = new Set(done?.analysis?.primaryEvidenceIds ?? []);
  const secondary = new Set(done?.analysis?.secondaryEvidenceIds ?? []);
  const citedByCause = new Set(cause.evidenceIds);

  const unavailable = aiUnavailableSentence(job.status, "The deterministic cause above does not need it.");
  const refused = phase.kind === "failed" && phase.view.code !== "CANCELLED";
  const state = unavailable ? "unavailable" : phase.kind === "failed" && !refused ? "cancelled" : phase.kind;
  const message =
    unavailable ??
    (phase.kind === "loading"
      ? "Asking local AI to interpret this failure…"
      : phase.kind === "failed"
        ? (phase.view.message ?? "Local AI could not answer this request.")
        : done
          ? done.coalescedCount > 1
            ? `This interpretation covers ${done.coalescedCount} failed instances in this run that failed the same way.`
            : "An interpretation of this failure's captured evidence. The deterministic cause above is unchanged."
          : null);

  return (
    <>
      <section className="awkit-detail-section" data-testid="failure-evidence-section" data-evidence-state="captured">
        <h3>Deterministic cause</h3>
        <p className="failure-cause" data-testid="failure-cause" data-cause={cause.cause}>
          <strong>{cause.cause}</strong> — {cause.reason}
        </p>
      </section>

      <section className="awkit-detail-section">
        <h3>Captured evidence ({evidence.length})</h3>
        <ul className="failure-evidence-list">
          {evidence.map((event) => (
            <li
              key={event.id}
              className={`failure-evidence-row severity-${event.severity}`}
              data-testid="failure-evidence-event"
              data-evidence-id={event.id}
              data-ai-cited={primary.has(event.id) ? "primary" : secondary.has(event.id) ? "secondary" : undefined}
            >
              <code>{event.id}</code>
              <span className="failure-evidence-source">{event.source}</span>
              <span className="awkit-muted">
                +{event.offsetMs} ms{event.repeatCount > 1 ? ` ×${event.repeatCount}` : ""}
              </span>
              <span className="failure-evidence-fields">
                {Object.entries(event.payload)
                  .map(([key, value]) => `${key}=${String(value)}`)
                  .join(" ")}
              </span>
              {citedByCause.has(event.id) ? <span className="failure-evidence-tag">cause</span> : null}
              {primary.has(event.id) || secondary.has(event.id) ? <span className="failure-evidence-tag ai">cited by AI</span> : null}
            </li>
          ))}
        </ul>
      </section>

      {job.visible ? (
        <section className="awkit-detail-section" data-testid="failure-ai-analysis" data-assist-state={state}>
          <h3>AI analysis</h3>
          <div className="ai-assist-bar">
            <span className="ai-assist-label">
              <Sparkles size={13} aria-hidden="true" />
              Local AI
            </span>
            {phase.kind === "loading" ? (
              <button className="toolbar-button" data-testid="failure-ai-cancel" onClick={job.cancel} type="button">
                <X size={13} aria-hidden="true" />
                Cancel
              </button>
            ) : (
              <button
                className="toolbar-button"
                data-testid="failure-ai-analyze"
                disabled={Boolean(unavailable)}
                onClick={() => job.start("l5b", instanceId, (requestId) => api().ai.analyzeFailure({ requestId, executionId, instanceId }))}
                type="button"
              >
                {done ? "Analyze again" : "Analyze with AI"}
              </button>
            )}
            <span className={`ai-assist-message${refused ? " error" : ""}`} role="status" data-testid="failure-ai-message">
              {refused ? <AlertTriangle size={12} aria-hidden="true" /> : null} {message}
            </span>
          </div>
          {done?.analysis ? (
            <div className="ai-explanation" data-testid="failure-ai-result" data-insufficient={done.analysis.insufficient ? "true" : "false"}>
              <span className="ai-explanation-label">AI interpretation</span>{" "}
              {done.analysis.insufficient ? (
                "The captured evidence is not enough to say why this failed."
              ) : (
                <>
                  {done.analysis.category ? <strong>{done.analysis.category}: </strong> : null}
                  {done.analysis.explanation}
                </>
              )}
              {done.analysis.investigationSteps.length ? (
                <ol className="failure-ai-steps">
                  {done.analysis.investigationSteps.map((step, index) => (
                    <li key={index}>{step}</li>
                  ))}
                </ol>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
