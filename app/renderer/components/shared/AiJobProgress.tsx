import { useEffect, useRef, useState } from "react";

import type { AiJobStatus } from "@src/ai/contracts/AiApi";

/**
 * L9.3: the one progress view for every long local-AI job, fed by the job-status contract.
 *
 * Honest by construction: the bar is determinate ONLY when the status carries a known denominator (bytes
 * copied, the runtime's own load fraction), and then carries `aria-valuenow`; otherwise it is an
 * indeterminate bar with no value at all. Nothing here computes a percentage or an ETA from elapsed time:
 * the ETA shown is main's measured range, counted down between updates, and a job past its longest
 * measured run says so rather than stretching the estimate. Stage changes are announced politely, at most
 * once per `ANNOUNCE_MIN_MS`; elapsed time is shown, never announced. Hologram tokens only; the
 * indeterminate sweep stops under reduced motion (global.css).
 */

const ANNOUNCE_MIN_MS = 5_000;

const HOLD_LABELS: Record<string, string> = {
  RUNS_ACTIVE: "waiting for runs to finish",
  DISPATCH_BLOCKED: "waiting while run dispatch is throttled",
  HOST_PRESSURE: "waiting while the machine is under load",
  LOW_MEMORY: "waiting for free memory",
  WEIGHTED_BUDGET: "waiting for run capacity"
};

function stageLabel(status: AiJobStatus): string {
  switch (status.stage) {
    case "queued":
      return status.queuePosition ? `Queued (${ordinal(status.queuePosition)} in line)` : "Queued";
    case "compatibility-check":
      return "Checking compatibility";
    case "copy-hash":
      return status.kind === "modelImport" || status.kind === "backendImport" ? "Copying and checksumming" : "Verifying the model file";
    case "backend-probe":
      return "Checking the GPU";
    case "model-load":
      return "Loading the model";
    case "prompt-preparation":
      return "Preparing the request";
    case "prompt-evaluation":
      return "Reading the request";
    case "generation":
      return "Writing the answer";
    case "validation":
      return "Checking the answer";
    case "finalization":
      return "Finishing";
  }
}

const ordinal = (n: number): string => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, "0")} s`;
}

const bytes = (value: number): string => {
  const mb = value / 1024 ** 2;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
};

/** The ETA sentence: main's measured range counted down since `sinceMs`, or why there is none. */
function etaSentence(status: AiJobStatus, sinceMs: number): string | null {
  if (status.state === "queued") return status.holdReason ? `Waiting: ${HOLD_LABELS[status.holdReason] ?? status.holdReason}.` : null;
  const eta = status.eta;
  if (!eta) {
    if (!status.noHistory) return null;
    return "No time estimate yet: this is the first run of this kind measured on this machine for where it runs.";
  }
  const from = `from ${eta.samples} earlier ${eta.warmth} run${eta.samples === 1 ? "" : "s"} here`;
  const min = eta.remainingMinMs - sinceMs;
  const max = eta.remainingMaxMs - sinceMs;
  if (eta.overrun || max < 0) {
    const limit = status.budgetMs ? ` It stops at its ${formatDuration(status.budgetMs)} limit.` : "";
    // "The range", not "the longest": from ten runs the range leaves out the slowest tenth.
    return `Taking longer than the measured range of ${eta.samples} earlier ${eta.warmth} run${eta.samples === 1 ? "" : "s"} here.${limit}`;
  }
  const low = formatDuration(Math.max(0, min));
  const high = formatDuration(max);
  return low === high ? `About ${high} left (${from}).` : `About ${low} to ${high} left (${from}).`;
}

/**
 * The newest status of one job, pushed by main. `since` drops statuses from before this watch began, so a
 * fixed-name job (a model import) never shows the previous run's result.
 */
export function useAiJobStatus(jobId: string | null, since = 0): { status: AiJobStatus | null; receivedAt: number } {
  const [latest, setLatest] = useState<{ status: AiJobStatus | null; receivedAt: number }>({ status: null, receivedAt: 0 });
  useEffect(() => {
    setLatest({ status: null, receivedAt: 0 });
    if (!jobId) return undefined;
    const bridge = window.playwrightFlowStudio.ai;
    let live = true;
    const accept = (status: AiJobStatus) => {
      if (!live || status.jobId !== jobId || status.at < since) return;
      setLatest((current) => (current.status && current.status.at > status.at ? current : { status, receivedAt: Date.now() }));
    };
    const unsubscribe = bridge.onJobStatus(accept);
    void bridge
      .listJobs()
      .then((jobs) => jobs.filter((job) => job.jobId === jobId).forEach(accept))
      .catch(() => undefined);
    return () => {
      live = false;
      unsubscribe();
    };
  }, [jobId, since]);
  return latest;
}

export function AiJobProgress({
  status,
  receivedAt,
  label,
  testId = "ai-job-progress"
}: {
  status: AiJobStatus | null;
  receivedAt: number;
  /** The progress bar's accessible name. */
  label: string;
  testId?: string;
}) {
  const [, tick] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const lastAnnounced = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const terminal = status !== null && ["completed", "failed", "timed-out", "cancelled"].includes(status.state);
  const stage = status ? stageLabel(status) : "Starting";

  // Elapsed and the ETA count on between updates; nothing is announced for it.
  useEffect(() => {
    if (terminal) return undefined;
    const timer = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [terminal]);

  // Polite, throttled: a burst of stage changes is announced once, with the newest stage.
  useEffect(() => {
    if (terminal) return undefined;
    const announce = () => {
      lastAnnounced.current = Date.now();
      pending.current = null;
      setAnnouncement(stage);
    };
    const wait = lastAnnounced.current + ANNOUNCE_MIN_MS - Date.now();
    if (pending.current) clearTimeout(pending.current);
    if (wait <= 0) announce();
    else pending.current = setTimeout(announce, wait);
    return () => {
      if (pending.current) clearTimeout(pending.current);
    };
  }, [stage, terminal]);

  if (terminal) return null;
  const sinceMs = status ? Math.max(0, Date.now() - receivedAt) : 0;
  const elapsed = status ? formatDuration(status.elapsedMs + sinceMs) : null;
  const progress = status?.progress ?? null;
  const percent = progress ? Math.min(100, Math.floor((progress.done / progress.total) * 100)) : null;
  const eta = status ? etaSentence(status, sinceMs) : null;
  const detail = progress?.unit === "bytes" ? `${bytes(progress.done)} of ${bytes(progress.total)}` : percent !== null ? `${percent}%` : null;
  // Stage and measured progress only: elapsed time changes every second, and a screen reader reporting the
  // bar would read it out each time. It is shown in the text below, never announced.
  const valueText = [stage, detail].filter(Boolean).join(", ");

  return (
    <div className="ai-job-progress" data-testid={testId} data-job-state={status?.state ?? "starting"} data-job-stage={status?.stage ?? "starting"}>
      <div
        aria-label={label}
        aria-valuemax={percent === null ? undefined : 100}
        aria-valuemin={percent === null ? undefined : 0}
        aria-valuenow={percent ?? undefined}
        aria-valuetext={valueText}
        className={`ai-job-progress-track${percent === null ? " indeterminate" : ""}`}
        data-testid={`${testId}-bar`}
        role="progressbar"
      >
        <div className="ai-job-progress-fill" style={percent === null ? undefined : { width: `${percent}%` }} />
      </div>
      <p className="ai-job-progress-text" data-testid={`${testId}-text`}>
        <span className="ai-job-progress-stage">{stage}</span>
        {detail ? <span> · {detail}</span> : null}
        {elapsed ? <span> · {elapsed} elapsed</span> : null}
        {status?.profile ? <span> · on {status.profile.device === "gpu" ? "the GPU" : status.profile.fallbackReason ? "CPU & RAM (GPU fallback)" : "CPU & RAM"}</span> : null}
      </p>
      {eta ? (
        <p className="ai-job-progress-eta" data-testid={`${testId}-eta`}>
          {eta}
        </p>
      ) : null}
      <span aria-live="polite" className="sr-only" data-testid={`${testId}-announce`}>
        {announcement}
      </span>
    </div>
  );
}
