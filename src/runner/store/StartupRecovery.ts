/**
 * Startup recovery policy (Phase 3G). Applied over the durable store when the app starts:
 * runs that looked active under a PREVIOUS app instance are classified —
 *  - a side-effect node (dangerousMutation / externalCommit / unknown) was in flight →
 *    `failed`, NOT recoverable: the external system must be verified by a human first;
 *  - otherwise → `orphaned`, recoverable: safe to re-run (resume = re-run in AWKIT's model).
 * Verdicts are written back with an explicit note and a watchdog event; nothing is deleted.
 */
import type { RuntimeStore } from "./RuntimeStore";
import type { DurableRunRecord } from "./RuntimeStoreSchema";

export interface RecoveryVerdict {
  run: DurableRunRecord;
  status: string;
  recoverable: boolean;
  recoveryNote: string;
}

const UNSAFE_IN_FLIGHT_LEVELS = new Set(["dangerousMutation", "externalCommit", "unknown"]);

export function runStartupRecovery(store: RuntimeStore, currentAppInstanceId: string): RecoveryVerdict[] {
  const verdicts: RecoveryVerdict[] = [];
  for (const run of store.findInterruptedRuns(currentAppInstanceId)) {
    const attempts = store.listAttempts(run.instanceId);
    const dangerousInFlight = attempts.some(
      (attempt) => attempt.status === "running" && UNSAFE_IN_FLIGHT_LEVELS.has(attempt.sideEffectLevel ?? "unknown")
    );
    const verdict: RecoveryVerdict = dangerousInFlight
      ? {
          run,
          status: "failed",
          recoverable: false,
          recoveryNote:
            "Interrupted while a side-effect node was in flight — NOT auto-resumable; verify the external system, then re-run manually."
        }
      : {
          run,
          status: "orphaned",
          recoverable: true,
          recoveryNote: "Interrupted by app exit with no side-effect node in flight — safe to re-run."
        };
    store.markRunRecovery(run.instanceId, verdict);
    store.recordWatchdogEvent({
      instanceId: run.instanceId,
      kind: "startupRecovery",
      reason: verdict.recoveryNote,
      at: new Date().toISOString()
    });
    verdicts.push(verdict);
  }
  return verdicts;
}
