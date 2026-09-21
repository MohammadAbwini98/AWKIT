import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Sparkles, Trash2, X } from "lucide-react";

import { storedFailureAnalysisFor, type FailureAnalysisView } from "@src/ai/contracts/AiApi";
import type { ConcurrentRunReport, StoredFailureAnalysis } from "@src/reports/ExecutionReport";
import type { InstanceDiagnostics } from "@src/runner/evidence/FailureEvidenceCollector";

import { aiUnavailableSentence, useAiAssistJob } from "../shared/useAiAssistJob";

const api = () => window.playwrightFlowStudio;

/** The instance's L5a diagnostics and any saved L5b analysis covering it, from its stored run report. */
async function loadRun(executionId: string, instanceId: string): Promise<{ diagnostics: InstanceDiagnostics | null; stored: StoredFailureAnalysis | null }> {
  const direct = (await api().reports.get(executionId)) as ConcurrentRunReport | null;
  const report =
    direct ?? ((await api().reports.list()) as ConcurrentRunReport[]).find((candidate) => candidate.executionId === executionId) ?? null;
  return {
    diagnostics: report?.instances.find((instance) => instance.instanceId === instanceId)?.diagnostics ?? null,
    stored: storedFailureAnalysisFor(report, instanceId)
  };
}

/**
 * L5 reports UX in the run-detail drawer: three separate sections, never merged.
 *
 *  - **Deterministic cause** — L5a's own conclusion. Always shown, needs no AI.
 *  - **Captured evidence** — the redacted, id-stripped events it rests on, exactly as persisted.
 *  - **AI analysis** — on demand, T0, labelled. It covers every failed instance in the run with the same
 *    signature (the count is shown) and cites evidence by id; cited rows are marked in the list above so a
 *    citation can be checked rather than believed. It changes nothing about the run. An answer is saved
 *    with the run's report and shown again on reopening, with AI off too, until it is deleted.
 */
export function FailureEvidenceSection({ executionId, instanceId }: { executionId: string; instanceId: string }) {
  const [diagnostics, setDiagnostics] = useState<InstanceDiagnostics | null | undefined>(undefined);
  const [stored, setStored] = useState<StoredFailureAnalysis | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const job = useAiAssistJob<FailureAnalysisView>(`${executionId}/${instanceId}`);

  const reload = useCallback(() => {
    let live = true;
    loadRun(executionId, instanceId)
      .then((run) => {
        if (!live) return;
        setDiagnostics(run.diagnostics);
        setStored(run.stored);
      })
      .catch(() => {
        if (live) setDiagnostics(null);
      });
    return () => {
      live = false;
    };
  }, [executionId, instanceId]);

  useEffect(() => {
    setDiagnostics(undefined);
    setStored(null);
    setNote(null);
    return reload();
  }, [reload]);

  // A fresh answer was saved: re-read the report, so what the drawer offers to delete is what is on disk.
  const answered = job.phase.kind === "done" ? job.phase : null;
  useEffect(() => (answered?.view.stored ? reload() : undefined), [answered, reload]);

  const remove = () => {
    setDeleting(true);
    setNote(null);
    api()
      .ai.deleteFailureAnalysis({ executionId, instanceId })
      .then(
        (response) => {
          if (response.ok) {
            // The focused Delete button is about to unmount; keep focus in this section, not on <body>.
            headingRef.current?.focus();
            setStored(null);
            job.clear();
          }
          setNote(response.ok ? "The saved analysis was deleted." : (response.message ?? "The saved analysis could not be deleted."));
        },
        () => setNote("The saved analysis could not be deleted.")
      )
      .finally(() => {
        setDeleting(false);
        reload();
      });
  };

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
  // On screen: the fresh answer, else the saved one. Citations are marked only when they are THIS
  // instance's evidence ids; a coalesced member's saved analysis cites the instance it was made for.
  const shown = done?.analysis ? { analysis: done.analysis, own: true } : stored ? { analysis: stored.analysis, own: stored.instanceId === instanceId } : null;
  const primary = new Set(shown?.own ? shown.analysis.primaryEvidenceIds : []);
  const secondary = new Set(shown?.own ? shown.analysis.secondaryEvidenceIds : []);
  const citedByCause = new Set(cause.evidenceIds);

  const unavailable = aiUnavailableSentence(job.status, "The deterministic cause above does not need it.");
  const refused = phase.kind === "failed" && phase.view.code !== "CANCELLED";
  const state = unavailable ? "unavailable" : phase.kind === "failed" && !refused ? "cancelled" : phase.kind === "idle" && stored ? "stored" : phase.kind;
  const message =
    note ??
    unavailable ??
    (phase.kind === "loading"
      ? "Asking local AI to interpret this failure…"
      : phase.kind === "failed"
        ? (phase.view.message ?? "Local AI could not answer this request.")
        : done
          ? `${
              done.coalescedCount > 1
                ? `This interpretation covers ${done.coalescedCount} failed instances in this run that failed the same way.`
                : "An interpretation of this failure's captured evidence. The deterministic cause above is unchanged."
            } ${done.stored ? "Saved with this run's report." : "It could not be saved, so it is shown only here."}`
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
          <h3 ref={headingRef} tabIndex={-1}>
            AI analysis
          </h3>
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
                onClick={() => {
                  setNote(null);
                  job.start("l5b", instanceId, (requestId) => api().ai.analyzeFailure({ requestId, executionId, instanceId }));
                }}
                type="button"
              >
                {shown ? "Analyze again" : "Analyze with AI"}
              </button>
            )}
            {stored && phase.kind !== "loading" ? (
              <button className="toolbar-button" data-testid="failure-ai-delete" disabled={deleting} onClick={remove} type="button">
                <Trash2 size={13} aria-hidden="true" />
                Delete saved analysis
              </button>
            ) : null}
            <span className={`ai-assist-message${refused ? " error" : ""}`} role="status" data-testid="failure-ai-message">
              {refused ? <AlertTriangle size={12} aria-hidden="true" /> : null} {message}
            </span>
          </div>
          {shown ? (
            <div className="ai-explanation" data-testid="failure-ai-result" data-insufficient={shown.analysis.insufficient ? "true" : "false"}>
              <span className="ai-explanation-label">AI interpretation</span>{" "}
              {shown.analysis.insufficient ? (
                "The captured evidence is not enough to say why this failed."
              ) : (
                <>
                  {shown.analysis.category ? <strong>{shown.analysis.category}: </strong> : null}
                  {shown.analysis.explanation}
                </>
              )}
              {shown.analysis.investigationSteps.length ? (
                <ol className="failure-ai-steps">
                  {shown.analysis.investigationSteps.map((step, index) => (
                    <li key={index}>{step}</li>
                  ))}
                </ol>
              ) : null}
              {!done?.analysis && stored ? (
                <p className="awkit-muted" data-testid="failure-ai-stored">
                  Saved {new Date(stored.createdAt).toLocaleString()}
                  {stored.instanceIds.length > 1 ? `, covering ${stored.instanceIds.length} failed instances that failed the same way` : ""}.
                  {shown.own ? "" : ` It was made for instance ${stored.instanceId}, so its citations refer to that instance's evidence.`}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
