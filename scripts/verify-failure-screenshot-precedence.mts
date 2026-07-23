/**
 * Regression verifier — failure-screenshot precedence contract (awkit-5yx).
 *
 * Verifier class: **Unit test** (no browser, no I/O; drives the real production method with a stub).
 *
 * What realistic regression would make this test fail?
 *   Reverting `FlowExecutor.executeWithRetry`'s failure-screenshot gate to the hardcoded `?? true`
 *   (the awkit-5yx defect), so the resolved artifact-profile default is ignored again. This test
 *   drives the REAL `FlowExecutor.executeWithRetry` with a stub `StepExecutor` and asserts the
 *   three-tier precedence:
 *
 *     explicit per-step override (step.onFailure.screenshot)
 *       → artifact-profile default (FlowExecutor's screenshotOnFailureDefault ctor arg)
 *         → safe system default (capture)
 *
 *   The `(profile default = false, no override)` case captures ZERO screenshots here and would
 *   capture one under the old `?? true`, so a regression turns this red. The explicit-opt-out and
 *   explicit-opt-in cases prove tier 1 still wins over tier 2 in both directions.
 *
 * Run: npx tsx scripts/verify-failure-screenshot-precedence.mts
 */
import { FlowExecutor } from "@src/runner/FlowExecutor";
import type { StepExecutor } from "@src/runner/StepExecutor";
import type { StepExecutionResult } from "@src/runner/RunnerResult";
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

function failingResult(stepId: string): StepExecutionResult {
  const now = new Date().toISOString();
  // A non-retryable synthetic failure with no screenshot yet, so the capture gate is reachable.
  return { stepId, status: "failed", startedAt: now, endedAt: now, durationMs: 0, outputs: {}, error: "synthetic failure" };
}

/**
 * Run the REAL `executeWithRetry` for one failing step and report how many failure screenshots were
 * captured (0 or 1). `profileDefault` is the artifact-profile tier; `override` is the per-step tier.
 */
async function captureCountFor(profileDefault: boolean, override: boolean | undefined): Promise<number> {
  let captured = 0;
  const stub = {
    async execute(step: FlowStep): Promise<StepExecutionResult> {
      return failingResult(step.id);
    },
    async captureFailureScreenshot(_step: FlowStep): Promise<string> {
      captured += 1;
      return "/artifacts/failure.png";
    }
  } as unknown as StepExecutor;

  const flowExecutor = new FlowExecutor(stub, undefined, undefined, undefined, profileDefault);
  const step = {
    id: "s1",
    type: "click",
    name: "Click",
    onFailure: override === undefined ? undefined : { screenshot: override }
  } as unknown as FlowStep;

  // executeWithRetry is the exact private method carrying the awkit-5yx gate. `retry.count` is
  // unset (0) so RetryPolicy resolves to a single attempt (attempt 0 >= 0 retries → no retry).
  await (flowExecutor as unknown as { executeWithRetry(step: FlowStep): Promise<StepExecutionResult> }).executeWithRetry(step);
  return captured;
}

async function main(): Promise<void> {
  console.log("Failure-screenshot precedence (awkit-5yx)\n");

  // Tier 2 — the artifact-profile default governs a step with NO explicit override.
  check("profile default true + no override → captures (safe default preserved)", (await captureCountFor(true, undefined)) === 1);
  check(
    "profile default FALSE + no override → does NOT capture (the awkit-5yx fix; old `?? true` would capture)",
    (await captureCountFor(false, undefined)) === 0
  );

  // Tier 1 — an explicit per-step override always wins over the profile default, both directions.
  check("explicit screenshot:true wins even when the profile default is false", (await captureCountFor(false, true)) === 1);
  check("explicit screenshot:false wins even when the profile default is true (opt-out preserved)", (await captureCountFor(true, false)) === 0);

  // Consistency corners.
  check("profile default false + explicit false → no capture", (await captureCountFor(false, false)) === 0);
  check("profile default true + explicit true → capture", (await captureCountFor(true, true)) === 1);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
