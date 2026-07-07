/**
 * Structured JSONL run logger. Appends one JSON object per line to the instance's allocated
 * log file (`InstanceRuntimePaths.logs` — previously allocated but never written). Lines are
 * buffered and flushed sequentially so concurrent events never interleave mid-line. Secrets
 * are masked with the shared SecretMasker before anything reaches disk.
 */
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { SecretMasker } from "@src/reports/SecretMasker";

export interface RunLogEvent {
  timestamp?: string;
  runId: string;
  flowId?: string;
  workflowId?: string;
  nodeId?: string;
  attemptId?: string;
  workerId?: string;
  browserWorkerId?: string;
  event: string;
  /** Origin + path only — callers sanitize URLs before logging. */
  currentUrl?: string;
  message?: string;
  errorStack?: string;
  data?: Record<string, unknown>;
}

export class RunLogger {
  private readonly masker = new SecretMasker();
  private queue: Promise<void> = Promise.resolve();
  private dirReady = false;
  private failed = false;

  constructor(private readonly filePath: string) {}

  /** Fire-and-forget append; write failures disable the logger (never fail the run). */
  log(event: RunLogEvent): void {
    if (this.failed) return;
    const line = JSON.stringify({
      timestamp: event.timestamp ?? new Date().toISOString(),
      ...event,
      message: event.message ? this.masker.maskText(event.message) : undefined,
      errorStack: event.errorStack ? this.masker.maskText(event.errorStack) : undefined,
      data: event.data ? this.masker.maskRecord(event.data) : undefined
    });

    this.queue = this.queue
      .then(async () => {
        if (this.failed) return;
        if (!this.dirReady) {
          await mkdir(dirname(this.filePath), { recursive: true });
          this.dirReady = true;
        }
        await appendFile(this.filePath, line + "\n", "utf8");
      })
      .catch(() => {
        // Artifact/save failure: disable quietly — the watchdog/report path surfaces run errors.
        this.failed = true;
      });
  }

  /** Wait for all queued lines to hit disk (end-of-run). */
  async flush(): Promise<void> {
    await this.queue.catch(() => undefined);
  }
}
