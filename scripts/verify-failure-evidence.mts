/**
 * Regression verifier — immediate per-attempt failure evidence (SRS-BAO-001 FR-B2).
 *
 * Verifier class: **Unit test** (no browser, no I/O; drives the real production method with a stub).
 *
 * What realistic regression would make this test fail?
 *   Moving failure-evidence capture back OUT of `FlowExecutor.executeWithRetry`'s loop to a single
 *   post-loop capture (the original ordering defect), so intermediate failing attempts get no
 *   evidence; overwriting attempt n's evidence with n+1; letting an evidence-capture throw mask the
 *   step's real automation error; or dropping the `screenshotPath` back-compat. This drives the REAL
 *   `FlowExecutor.executeWithRetry` with a stub `StepExecutor` and asserts:
 *
 *     B2.1/B2.2 — one evidence set per failing attempt, tagged with a distinct attempt index, in order
 *     B2.4/B2.5 — the original error stays primary; a capture that throws becomes a secondary
 *                 diagnostic and never replaces the error or throws out of executeWithRetry
 *     precedence — capture is gated by (step override → profile default → safe default), unchanged
 *     back-compat — `screenshotPath` stays populated with the last screenshot capture
 *
 * Run: npx tsx scripts/verify-failure-evidence.mts
 */
import { FlowExecutor } from "@src/runner/FlowExecutor";
import type { StepExecutor } from "@src/runner/StepExecutor";
import type { StepEvidenceRef, StepExecutionResult } from "@src/runner/RunnerResult";
import type { FlowStep } from "@src/profiles/FlowProfile";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const ORIGINAL_ERROR = "Timeout 30000ms exceeded"; // classifies as retryable "timeout"

interface RunOutcome {
  result: StepExecutionResult;
  executeCalls: number;
  evidenceAttempts: number[];
  threw: boolean;
}

/**
 * Drive the REAL `executeWithRetry` for one failing step. `capture` chooses how the stub's
 * `captureFailureEvidence` behaves: return a screenshot ref, or throw (to prove B2.5).
 */
async function runFailing(opts: {
  profileDefault: boolean;
  override?: boolean;
  retryCount?: number;
  capture?: "ok" | "throws";
}): Promise<RunOutcome> {
  const capture = opts.capture ?? "ok";
  let executeCalls = 0;
  const evidenceAttempts: number[] = [];

  const stub = {
    async execute(step: FlowStep): Promise<StepExecutionResult> {
      executeCalls += 1;
      const now = new Date().toISOString();
      return { stepId: step.id, status: "failed", startedAt: now, endedAt: now, durationMs: 0, outputs: {}, error: ORIGINAL_ERROR };
    },
    async captureFailureEvidence(_step: FlowStep, o: { attempt: number }): Promise<StepEvidenceRef[]> {
      evidenceAttempts.push(o.attempt);
      if (capture === "throws") throw new Error("dead page: cannot photograph");
      const now = new Date().toISOString();
      return [{ kind: "screenshot", path: `/artifacts/s1-a${o.attempt}.png`, attempt: o.attempt, pageId: "main", capturedAt: now }];
    }
  } as unknown as StepExecutor;

  const flowExecutor = new FlowExecutor(stub, undefined, undefined, undefined, opts.profileDefault);
  const step = {
    id: "s1",
    type: "click",
    name: "Retry me",
    retry: opts.retryCount ? { count: opts.retryCount, delayMs: 0 } : undefined,
    onFailure: opts.override === undefined ? undefined : { screenshot: opts.override }
  } as unknown as FlowStep;

  let threw = false;
  let result: StepExecutionResult;
  try {
    result = await (flowExecutor as unknown as { executeWithRetry(s: FlowStep): Promise<StepExecutionResult> }).executeWithRetry(step);
  } catch {
    threw = true;
    result = { stepId: "s1", status: "failed", startedAt: "", endedAt: "", durationMs: 0, outputs: {} };
  }
  return { result, executeCalls, evidenceAttempts, threw };
}

async function main(): Promise<void> {
  console.log("Immediate per-attempt failure evidence (FR-B2)\n");

  // B2.1 / B2.2 — one evidence set per failing attempt, distinct attempt index, in order, none lost.
  const multi = await runFailing({ profileDefault: true, retryCount: 2 });
  check("retryable failure with retry.count=2 runs 3 attempts", multi.executeCalls === 3, `executeCalls=${multi.executeCalls}`);
  check("captureFailureEvidence is called once per failing attempt (B2.1)", multi.evidenceAttempts.length === 3, `calls=${JSON.stringify(multi.evidenceAttempts)}`);
  check("each attempt is captured under its own distinct index [0,1,2] (B2.2)", JSON.stringify(multi.evidenceAttempts) === "[0,1,2]");
  const evi = multi.result.evidence ?? [];
  check("result carries all 3 attempts' evidence, in order (B2.2)", evi.length === 3 && JSON.stringify(evi.map((e) => e.attempt)) === "[0,1,2]", `evidence=${JSON.stringify(evi.map((e) => e.attempt))}`);
  check("no attempt's evidence is overwritten by a later attempt (B2.2)", new Set(evi.map((e) => e.path)).size === 3);
  check("the original automation error stays primary and unchanged (B2.4)", multi.result.error === ORIGINAL_ERROR);
  check("screenshotPath is populated with the last screenshot capture (back-compat)", multi.result.screenshotPath === "/artifacts/s1-a2.png", `got=${multi.result.screenshotPath}`);

  // Single attempt — one failing attempt yields exactly one evidence set.
  const single = await runFailing({ profileDefault: true, retryCount: 0 });
  check("single failing attempt captures exactly one evidence set", (single.result.evidence ?? []).length === 1 && single.evidenceAttempts.length === 1);

  // Precedence — the awkit-5yx gate still governs whether evidence is captured at all.
  const gateOff = await runFailing({ profileDefault: false, retryCount: 0 });
  check("profile default FALSE + no override → NO evidence captured (precedence tier 2)", gateOff.evidenceAttempts.length === 0 && (gateOff.result.evidence ?? []).length === 0);
  const overrideOn = await runFailing({ profileDefault: false, override: true, retryCount: 0 });
  check("explicit onFailure.screenshot=true wins even when profile default is false", overrideOn.evidenceAttempts.length === 1);
  const overrideOff = await runFailing({ profileDefault: true, override: false, retryCount: 0 });
  check("explicit onFailure.screenshot=false wins even when profile default is true (opt-out preserved)", overrideOff.evidenceAttempts.length === 0);

  // B2.5 — an evidence-capture failure is a secondary diagnostic; it never throws out of the retry
  // loop and never replaces the step's real error.
  const capThrows = await runFailing({ profileDefault: true, retryCount: 0, capture: "throws" });
  check("a capture that throws does NOT propagate out of executeWithRetry (B2.6/B2.5)", capThrows.threw === false);
  check("a failed capture still reports the step's real error as primary (B2.5)", capThrows.result.error === ORIGINAL_ERROR);
  const secondary = capThrows.result.evidence ?? [];
  check("a failed capture is recorded as a secondary-diagnostic note, not a screenshot (B2.5)", secondary.length === 1 && secondary[0].kind === "meta" && /evidence capture failed/i.test(secondary[0].note ?? ""));
  check("a failed capture leaves screenshotPath unset (no false evidence)", capThrows.result.screenshotPath === undefined);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
