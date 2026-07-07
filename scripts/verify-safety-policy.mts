/**
 * Side-effect safety metadata verification (pure — no browsers).
 * Run with: npx tsx scripts/verify-safety-policy.mts
 *
 * Proves: explicit metadata is authoritative (dangerous blocks retries even for harmless names;
 * explicit-retryable overrides the keyword heuristic), node-type defaults classify legacy/
 * recorder steps sensibly, unknown custom types default conservative, idempotency-key
 * requirements block retries, and infra-terminal error classes beat explicit metadata.
 */
import { resolveStepSafety } from "@src/runner/runtime/StepSafetyPolicy";
import { RetryPolicy } from "@src/runner/runtime/RetryPolicy";

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  console.log("Safety-policy verification");

  console.log("\nPart A — resolveStepSafety classification");
  check("goto → read/retryable (typeDefault)", (() => { const s = resolveStepSafety({ type: "goto", name: "Open page" }); return s.sideEffectLevel === "read" && s.retryable && s.source === "typeDefault"; })());
  check("plain click → safeMutation/retryable", (() => { const s = resolveStepSafety({ type: "click", name: "Open reports" }); return s.sideEffectLevel === "safeMutation" && s.retryable; })());
  check("keyword click → dangerousMutation (keywordFallback)", (() => { const s = resolveStepSafety({ type: "click", name: "Click Submit Order" }); return s.sideEffectLevel === "dangerousMutation" && !s.retryable && s.source === "keywordFallback"; })());
  check("reuseSession → none/retryable (local session op)", (() => { const s = resolveStepSafety({ type: "reuseSession", name: "Reuse Session" }); return s.sideEffectLevel === "none" && s.retryable; })());
  check("runFlow container → non-retryable", !resolveStepSafety({ type: "runFlow", name: "Run child" }).retryable);
  check("unknown custom type → unknown + non-retryable (conservativeDefault)", (() => { const s = resolveStepSafety({ type: "customMagicNode", name: "Do things" }); return s.sideEffectLevel === "unknown" && !s.retryable && s.source === "conservativeDefault"; })());
  check("explicit metadata wins over type default", (() => { const s = resolveStepSafety({ type: "goto", name: "Open page", safety: { sideEffectLevel: "externalCommit", retryable: false } }); return s.sideEffectLevel === "externalCommit" && s.source === "explicit"; })());

  console.log("\nPart B — RetryPolicy uses metadata first");
  const policy = new RetryPolicy({ initialDelayMs: 10 });
  const transientError = "Timeout 5000ms exceeded";

  const explicitDangerous = policy.decide({
    step: { type: "click", name: "Open harmless list", retry: { count: 3 }, safety: { sideEffectLevel: "dangerousMutation", retryable: false } },
    error: transientError,
    attempt: 0
  });
  check("explicit dangerousMutation blocks retry (harmless name!)", !explicitDangerous.retry && explicitDangerous.errorClass === "dangerous-side-effect");

  const explicitCommit = policy.decide({
    step: { type: "click", name: "Continue", retry: { count: 3 }, safety: { sideEffectLevel: "externalCommit", retryable: false } },
    error: transientError,
    attempt: 0
  });
  check("explicit externalCommit blocks retry", !explicitCommit.retry);

  const explicitSafeOverridesKeyword = policy.decide({
    step: { type: "click", name: "Click Submit Order", retry: { count: 3 }, safety: { sideEffectLevel: "safeMutation", retryable: true } },
    error: transientError,
    attempt: 0
  });
  check("explicit safeMutation OVERRIDES the dangerous keyword heuristic (retries)", explicitSafeOverridesKeyword.retry, explicitSafeOverridesKeyword.reason);

  const keywordFallback = policy.decide({ step: { type: "click", name: "Confirm payment", retry: { count: 3 } }, error: transientError, attempt: 0 });
  check("keyword heuristic still catches unclassified dangerous steps", !keywordFallback.retry && keywordFallback.errorClass === "dangerous-side-effect");

  const explicitRetryableNonTransient = policy.decide({
    step: { type: "click", name: "Load data", retry: { count: 2 }, safety: { sideEffectLevel: "read", retryable: true } },
    error: "Assertion failed: expected 5 received 4",
    attempt: 0
  });
  check("explicit-retryable retries even non-transient (business-rule) errors", explicitRetryableNonTransient.retry);

  const implicitNonTransient = policy.decide({ step: { type: "click", name: "Load data", retry: { count: 2 } }, error: "Assertion failed: expected 5 received 4", attempt: 0 });
  check("implicit classification still requires a transient error class", !implicitNonTransient.retry);

  const idempotencyMissing = policy.decide({
    step: { type: "click", name: "Send request", retry: { count: 2 }, safety: { sideEffectLevel: "safeMutation", retryable: true, requiresIdempotencyKey: true } },
    error: transientError,
    attempt: 0
  });
  check("requiresIdempotencyKey without an expression blocks retry", !idempotencyMissing.retry && /idempotency/.test(idempotencyMissing.reason));

  const idempotencyPresent = policy.decide({
    step: {
      type: "click",
      name: "Send request",
      retry: { count: 2 },
      safety: { sideEffectLevel: "safeMutation", retryable: true, requiresIdempotencyKey: true, idempotencyKeyExpression: "${runtimeInputs.requestId}" }
    },
    error: transientError,
    attempt: 0
  });
  check("idempotency key expression allows retry", idempotencyPresent.retry);

  const infraBeatsExplicit = policy.decide({
    step: { type: "click", name: "Load data", retry: { count: 2 }, safety: { sideEffectLevel: "read", retryable: true } },
    error: "Target page, context or browser has been closed",
    attempt: 0
  });
  check("infra-terminal (dead browser) beats explicit-retryable metadata", !infraBeatsExplicit.retry);

  const explicitNonRetryable = policy.decide({
    step: { type: "goto", name: "Open page", retry: { count: 2 }, safety: { sideEffectLevel: "read", retryable: false } },
    error: transientError,
    attempt: 0
  });
  check("explicit retryable=false blocks retry on an otherwise-retryable step", !explicitNonRetryable.retry);

  console.log(`\nResult: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("verify-safety-policy crashed:", error);
  process.exit(1);
});
