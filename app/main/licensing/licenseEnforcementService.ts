/** Main-process owner of license enforcement against queued execution work. */
import { app } from "electron";
import { executionEngine } from "@src/runner/ExecutionEngine";
import type { DispatchGate } from "@src/runner/DispatchGate";
import { LICENSE_REVALIDATE_INTERVAL_MS } from "@src/licensing/LicenseAttention";
import {
  CLEARED_ENFORCEMENT_STATE,
  isEnforcementStateStale,
  nextEnforcementState,
  type EnforcementLatchState,
  type EnforcementTrigger
} from "@src/licensing/RunGateEnforcement";
import { getSecurityKernel } from "../security/securityKernel";
import { evaluateRunGate, type RunGateDecision } from "./licenseRuntime";

const FOCUS_THROTTLE_MS = 2_000;
let enforcementState: EnforcementLatchState = CLEARED_ENFORCEMENT_STATE;
let watcherTimer: ReturnType<typeof setInterval> | undefined;
let lastFocusEvaluationAtMs = 0;

export interface EnforcementApplication {
  readonly decision: RunGateDecision;
  readonly state: EnforcementLatchState;
  readonly cancelledPending: readonly string[];
}

function auditEnforcementTransition(
  eventType: "LICENSE_ENFORCEMENT_ENGAGED" | "LICENSE_ENFORCEMENT_CLEARED",
  trigger: EnforcementTrigger,
  decision: RunGateDecision
): void {
  void getSecurityKernel()
    .then((kernel) =>
      kernel.store.appendAudit({
        at: new Date().toISOString(),
        eventType,
        result: eventType === "LICENSE_ENFORCEMENT_CLEARED" ? "success" : "failure",
        actorUserId: null,
        actorName: null,
        targetType: "license",
        targetId: null,
        sessionId: null,
        reasonCode: decision.reason,
        detail: {
          trigger,
          status: decision.status.status,
          activeRunDisposition: decision.activeRunDisposition
        }
      })
    )
    .catch(() => undefined);
}

export function applyRunGateEnforcement(trigger: EnforcementTrigger): EnforcementApplication {
  const decision = evaluateRunGate();
  const transition = nextEnforcementState(
    enforcementState,
    {
      activeRunDisposition: decision.activeRunDisposition,
      reason: decision.reason,
      status: decision.status.status
    },
    Date.now()
  );
  enforcementState = transition.next;

  let cancelledPending: string[] = [];
  if (transition.shouldCancelPending) {
    const reason = `license integrity failure: ${decision.reason}`;
    try {
      cancelledPending = executionEngine.cancelPendingInstances(reason);
      if (cancelledPending.length > 0) {
        console.warn(
          `[license] cancelled ${cancelledPending.length} instance(s) that had not started: ${decision.reason}`
        );
      }
    } catch (error) {
      console.warn(
        `[license] could not cancel pending work: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (transition.shouldAudit && transition.auditEvent) {
    auditEnforcementTransition(transition.auditEvent, trigger, decision);
  }

  return { decision, state: enforcementState, cancelledPending };
}

export function currentEnforcementState(): EnforcementLatchState {
  return enforcementState;
}

export const licenseDispatchGate: DispatchGate = () => {
  if (isEnforcementStateStale(enforcementState, Date.now())) {
    // AWKIT-LIC-002 (fold-in): the full evaluation does synchronous disk + registry fingerprint
    // work. Inside the dispatch loop that cost used to be paid per stale check; a 5-second
    // decision cache amortizes it while keeping enforcement latency far below the latch TTL.
    const nowMs = Date.now();
    if (!cachedDecision || nowMs - cachedDecision.atMs >= DISPATCH_DECISION_CACHE_MS) {
      cachedDecision = { atMs: nowMs, decision: applyRunGateEnforcement("pre-run").decision };
    }
  }
  return {
    admit: !enforcementState.blocking,
    reason: enforcementState.reason ?? "LICENSE_GATE_ALLOWED"
  };
};

const DISPATCH_DECISION_CACHE_MS = 5_000;
let cachedDecision: { atMs: number; decision: RunGateDecision } | null = null;

/**
 * AWKIT-LIC-002 (fold-in): parked manual-handoff / retry work must consult the enforcement latch
 * before resuming, exactly like a new run. Integrity failures and missing entitlements block the
 * resume; ordinary "not licensed" states keep the allow-to-finish disposition for work already
 * dispatched. Returns the user-facing blocker, or null when the resume may proceed.
 */
export function parkedResumeBlocker(): string | null {
  const application = applyRunGateEnforcement("pre-run");
  if (application.decision.allowed) return null;
  if (application.decision.activeRunDisposition === "cancel-pending") {
    return application.decision.status.userAction;
  }
  return null;
}

function onWindowFocus(): void {
  const now = Date.now();
  if (now - lastFocusEvaluationAtMs < FOCUS_THROTTLE_MS) return;
  lastFocusEvaluationAtMs = now;
  applyRunGateEnforcement("window-focus");
}

export function startLicenseEnforcementWatcher(): void {
  if (watcherTimer) return;
  applyRunGateEnforcement("startup");
  watcherTimer = setInterval(() => applyRunGateEnforcement("interval"), LICENSE_REVALIDATE_INTERVAL_MS);
  watcherTimer.unref();
  app.on("browser-window-focus", onWindowFocus);
}

export function stopLicenseEnforcementWatcher(): void {
  if (watcherTimer) clearInterval(watcherTimer);
  watcherTimer = undefined;
  app.removeListener("browser-window-focus", onWindowFocus);
}
