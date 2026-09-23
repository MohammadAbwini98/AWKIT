/**
 * verify:ai-locator-sweep — Phase L L3 §9, the idle flow health sweep. Pure: no browser, no Electron,
 * no model, no filesystem.
 *
 * §9 has two answers with different costs, and the point of the suite is that they stay separate:
 * the durability report is free and must be complete for every scanned step regardless of the job
 * cap, while the QUEUE is what would cost a model call and is therefore gated on idleness and capped.
 *
 * What makes it fail: a sweep running while a run is active or queued; a T3 step queued, or counted as
 * merely "not weak"; a step queued that already has a proposal in flight or an applied upgrade; a
 * strong locator queued; the cap exceeded, or the cap silently truncating the report; a deferred count
 * that does not account for what the cap left behind; a sweep whose skip reasons do not account for
 * every scanned step; or a report that carries a locator value, page text or a typed value.
 *
 * Run: npm run verify:ai-locator-sweep
 */
import {
  LOCATOR_SWEEP_MAX_JOBS,
  buildLocatorDurabilityReport,
  planFlowHealthSweep,
  type LocatorSweepResult
} from "@src/ai/locatorSweep";
import type { AiAdmissionOptions, AiAdmissionView } from "@src/ai/AiAdmission";
import { createLocatorApprovalBinding } from "@src/profiles/locatorApproval";
import type { FlowProfile, FlowStep, StepLocator } from "@src/profiles/FlowProfile";
import { classifyLocatorQuality, type LocatorQualityClass } from "@src/recorder/LocatorQualityClass";
import { decideAiAction } from "@src/security/authz/AiAutonomyPolicy";

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

const IDLE: AiAdmissionView = {
  activeRuns: 0,
  queuedRuns: 0,
  pressureState: "healthy",
  dispatchBlocked: false,
  activeWeight: 0,
  weightedBudget: 4,
  freeMemoryMb: 8_000
};
const OPTIONS: AiAdmissionOptions = { yieldDuringRuns: true, minFreeMemoryMb: 512 };
const POLICY = { enabled: true, featureTiers: {} } as const;

// ── Locator fixtures, each asserted to really be the class it is named for ──────────────────────
const STRONG: StepLocator = { strategy: "testId", value: "save-order", quality: { strategy: "testId", isUnique: true, matchCount: 1, confidence: "high" } };
const GUARDED: StepLocator = {
  strategy: "css",
  value: ".row > button",
  quality: { strategy: "fallback", isUnique: false, matchCount: 3, confidence: "low", disambiguation: "positional" },
  guard: {
    container: [],
    candidateSelector: ".row > button",
    siblingCount: 3,
    index: 1,
    confidence: "high",
    fingerprint: { tag: "button", role: "button", name: "aaaa", text: "bbbb", attributes: {}, ancestry: ["cccc"] }
  }
};
const REVIEW: StepLocator = { strategy: "css", value: "div > div > span", resolution: "needs-review", reviewReason: "No stable attribute was found.", quality: { strategy: "fallback", isUnique: false, matchCount: 4, confidence: "low" } };

/** Names used for steps that must be ORDINARY, and names that must be T3. Both are audited in §0. */
const ORDINARY_NAMES = ["Open row detail", "Pick the label", "Save order", "Select row", "Download", "Open panel"] as const;
const SENSITIVE_NAMES = ["Delete the account", "Submit the claim"] as const;

let stepCounter = 0;
function step(name: string, locator: StepLocator | undefined, extra: Partial<FlowStep> = {}): FlowStep {
  stepCounter += 1;
  return { id: `s${stepCounter}`, type: "click", name, ...(locator ? { locator } : {}), ...extra } as FlowStep;
}

const flow = (id: string, name: string, nodes: FlowStep[]): FlowProfile => ({ id, name, version: 1, nodes, edges: [] });

const sweep = (flows: FlowProfile[], overrides: Partial<Parameters<typeof planFlowHealthSweep>[0]> = {}): LocatorSweepResult =>
  planFlowHealthSweep({ flows, policy: POLICY, admission: IDLE, admissionOptions: OPTIONS, ...overrides });

/** Narrow to the ran-branch, failing loudly rather than silently skipping a section. */
function ran(result: LocatorSweepResult, label: string): Extract<LocatorSweepResult, { ran: true }> {
  if (!result.ran) {
    failed += 1;
    console.error(`  ✗ ${label} — the sweep did not run (${result.reason})`);
    throw new Error(`sweep did not run for ${label}`);
  }
  return result;
}

// ── 0. The fixtures really are what they are named ──────────────────────────────────────────────
console.log("\n0 — the fixtures are audited, not assumed");
const classOf = (locator: StepLocator): LocatorQualityClass | undefined => classifyLocatorQuality(locator)?.class;
check("the strong fixture classifies strong-semantic", classOf(STRONG) === "strong-semantic", classOf(STRONG));
check("the guarded fixture classifies guarded-positional", classOf(GUARDED) === "guarded-positional", classOf(GUARDED));
check("the review fixture classifies review-required", classOf(REVIEW) === "review-required", classOf(REVIEW));
check("the documented per-sweep cap is 5", LOCATOR_SWEEP_MAX_JOBS === 5);
// The ordinary step names must NOT be sensitive, or every "this weak step is queued" assertion below
// passes vacuously against a step the policy forbids for an unrelated reason. This caught a real
// fixture defect: `resolveStepSafety`'s keyword fallback treats "approve" as a dangerous mutation, so
// a step innocently named "Approve row" was T3 and five sections were silently testing nothing.
const notSensitive = (name: string): boolean =>
  decideAiAction("locatorSemanticUpgrade", "locatorChange", { step: step(name, GUARDED) }, { enabled: true }).decision !== "forbidden";
for (const name of ORDINARY_NAMES) check(`the ordinary fixture name "${name}" is not itself T3`, notSensitive(name));
check("...while the sensitive fixture names ARE", SENSITIVE_NAMES.every((name) => !notSensitive(name)), SENSITIVE_NAMES.join(", "));

// ── 1. Idle-only, by the same rule one inference obeys ──────────────────────────────────────────
console.log("\n1 — the sweep is idle-only, and yields to runs");
const busy = sweep([flow("f1", "Orders", [step("Approve", GUARDED)])], { admission: { ...IDLE, activeRuns: 1 } });
check("an ACTIVE run holds the sweep", !busy.ran && busy.reason === "RUNS_ACTIVE", JSON.stringify(busy));
const queuedRun = sweep([flow("f1", "Orders", [step("Approve", GUARDED)])], { admission: { ...IDLE, queuedRuns: 2 } });
check("a QUEUED run holds it too — the sweep never races a run about to start", !queuedRun.ran && queuedRun.reason === "RUNS_ACTIVE");
const pressured = sweep([flow("f1", "Orders", [step("Approve", GUARDED)])], { admission: { ...IDLE, pressureState: "critical" } });
check("host pressure holds it", !pressured.ran && pressured.reason === "HOST_PRESSURE");
const blocked = sweep([flow("f1", "Orders", [step("Approve", GUARDED)])], { admission: { ...IDLE, dispatchBlocked: true } });
check("a dispatch refusal holds it", !blocked.ran && blocked.reason === "DISPATCH_BLOCKED");
const lowMemory = sweep([flow("f1", "Orders", [step("Approve", GUARDED)])], { admission: { ...IDLE, freeMemoryMb: 10 } });
check("low free memory holds it", !lowMemory.ran && lowMemory.reason === "LOW_MEMORY");
const noBudget = sweep([flow("f1", "Orders", [step("Approve", GUARDED)])], { admission: { ...IDLE, activeWeight: 4, weightedBudget: 4 } });
check("no weighted headroom holds it", !noBudget.ran && noBudget.reason === "WEIGHTED_BUDGET");
check("a held sweep scans nothing and queues nothing", !("report" in busy) && !("queued" in busy));

// ── 2. The durability report ────────────────────────────────────────────────────────────────────
console.log("\n2 — the durability report covers every scanned step");
const mixed = ran(
  sweep([
    flow("f1", "Orders", [
      step("Open orders", undefined),
      step("Save order", STRONG),
      step("Open row detail", GUARDED),
      step("Pick the label", REVIEW)
    ]),
    flow("f2", "Invoices", [step("Download", STRONG), step("Select row", GUARDED)])
  ]),
  "the mixed report"
);
check("both flows are counted", mixed.report.flows === 2);
check("only steps with a locator are counted as steps", mixed.report.steps === 5, String(mixed.report.steps));
check("...and the one without is counted separately, not dropped", mixed.report.stepsWithoutLocator === 1);
check("the class histogram sums to the step count", Object.values(mixed.report.byClass).reduce((a, b) => a + b, 0) === mixed.report.steps, JSON.stringify(mixed.report.byClass));
check("...with 2 strong, 2 guarded and 1 review-required", mixed.report.byClass["strong-semantic"] === 2 && mixed.report.byClass["guarded-positional"] === 2 && mixed.report.byClass["review-required"] === 1, JSON.stringify(mixed.report.byClass));
check("weak is guarded-positional plus review-required", mixed.report.weak === 3, String(mixed.report.weak));
check("the per-flow breakdown names both flows", mixed.report.perFlow.length === 2 && mixed.report.perFlow[0].flowId === "f1" && mixed.report.perFlow[1].flowId === "f2");
check("...and its step counts sum to the total", mixed.report.perFlow.reduce((a, f) => a + f.steps, 0) === mixed.report.steps);
check("...and its weak counts sum to the total", mixed.report.perFlow.reduce((a, f) => a + f.weak, 0) === mixed.report.weak);
check("every scanned step is either queued or has a skip reason", mixed.queued.length + mixed.skipped.length === mixed.report.steps + mixed.report.stepsWithoutLocator, `${mixed.queued.length}+${mixed.skipped.length}`);
check("the report carries no locator value, page text or typed value", !/save-order|\.row|div > div|needs-review/.test(JSON.stringify(mixed.report)), JSON.stringify(mixed.report));

// ── 3. What gets queued ─────────────────────────────────────────────────────────────────────────
console.log("\n3 — only a weak, untouched, permitted locator is queued");
check("the three weak steps are queued", mixed.queued.length === 3, JSON.stringify(mixed.queued.map((c) => c.stepName)));
check("...and no strong one is", mixed.queued.every((c) => c.quality !== "strong-semantic"));
check("a strong locator is skipped as NOT_WEAK", mixed.skipped.some((s) => s.reason === "NOT_WEAK" && s.quality === "strong-semantic"));
check("a step with no locator is skipped as NO_LOCATOR", mixed.skipped.some((s) => s.reason === "NO_LOCATOR"));
check("each queued candidate names its flow and step for the job to use", mixed.queued.every((c) => c.flowId && c.stepId && c.stepName && c.quality));

// ── 4. T3 is excluded for what it is, and counted ───────────────────────────────────────────────
console.log("\n4 — T3 steps are never queued, and never hidden in the totals");
const t3 = ran(
  sweep([
    flow("f1", "Checkout", [
      step("Sign in", GUARDED, { type: "protectedLoginHandoff" }),
      step("Delete the account", GUARDED),
      step("Open row detail", GUARDED)
    ])
  ]),
  "the T3 report"
);
check("a protected-login step is not queued", !t3.queued.some((c) => c.stepName === "Sign in"));
check("a sensitive action is not queued", !t3.queued.some((c) => c.stepName === "Delete the account"));
check("...only the ordinary weak step is", t3.queued.length === 1 && t3.queued[0].stepName === "Open row detail", JSON.stringify(t3.queued));
check("both are skipped as FORBIDDEN, not as NOT_WEAK", t3.skipped.filter((s) => s.reason === "FORBIDDEN").length === 2, JSON.stringify(t3.skipped));
check("the report counts them as forbidden", t3.report.forbidden === 2);
// A forbidden step is still weak. Counting it only as forbidden would understate the flow's fragility;
// counting it only as weak would imply AI will eventually get to it. The report says both.
check("...and STILL as weak, because they are", t3.report.weak === 3, String(t3.report.weak));
check("the per-flow breakdown reports its forbidden count too", t3.report.perFlow[0].forbidden === 2);

// ── 5. A step already in the upgrade lifecycle is left alone ────────────────────────────────────
console.log("\n5 — a step already proposed or already upgraded is not swept again");
const withPending = step("Open row detail", GUARDED);
const binding = createLocatorApprovalBinding(withPending)!;
const pendingStep: FlowStep = {
  ...withPending,
  locator: {
    ...GUARDED,
    pendingUpgrade: {
      schemaVersion: 1,
      candidate: { strategy: "role", value: "button", name: "Open detail" },
      proof: "capture-proven",
      meaningChange: false,
      binding,
      modelId: "m",
      createdAt: new Date().toISOString()
    }
  }
};
const appliedStep = step("Save order", { ...GUARDED, locatorProvenance: { schemaVersion: 1, source: "ai-semantic-upgrade", tier: "T1", actionId: "a1", modelId: "m", proof: "replay-proven", appliedAt: new Date().toISOString(), binding, previous: STRONG } });
const lifecycle = ran(sweep([flow("f1", "Orders", [pendingStep, appliedStep, step("Pick the label", REVIEW)])]), "the lifecycle report");
check("a step with a proposal in flight is skipped as UPGRADE_PENDING", lifecycle.skipped.some((s) => s.stepId === pendingStep.id && s.reason === "UPGRADE_PENDING"), JSON.stringify(lifecycle.skipped));
check("a step with an applied upgrade is skipped as ALREADY_UPGRADED", lifecycle.skipped.some((s) => s.stepId === appliedStep.id && s.reason === "ALREADY_UPGRADED"));
check("...so only the untouched weak step is queued", lifecycle.queued.length === 1 && lifecycle.queued[0].stepName === "Pick the label", JSON.stringify(lifecycle.queued));
check("the report counts both lifecycle states", lifecycle.report.upgradePending === 1 && lifecycle.report.alreadyUpgraded === 1);

// A pending candidate the save boundary would drop is not a proposal in flight: the step is genuinely
// unproposed, so shielding it would leave it permanently unswept behind a candidate that never applies.
const staleStep: FlowStep = { ...pendingStep, name: "Open row detail (renamed since the proposal)" };
const stale = ran(sweep([flow("f1", "Orders", [staleStep])]), "the stale-pending report");
check("a pending candidate whose binding no longer matches does NOT shield the step", stale.queued.length === 1, JSON.stringify(stale.skipped));
check("...and is not counted as a proposal in flight", stale.report.upgradePending === 0);

// ── 6. The cap bounds the queue, never the report ───────────────────────────────────────────────
console.log("\n6 — the cap bounds the jobs, not the audit");
const many = flow("big", "Big flow", Array.from({ length: 12 }, (_, i) => step(`Weak ${i}`, GUARDED)));
const capped = ran(sweep([many]), "the capped report");
check("the queue stops at the cap", capped.queued.length === LOCATOR_SWEEP_MAX_JOBS, String(capped.queued.length));
check("...but the report still audits every step", capped.report.steps === 12 && capped.report.weak === 12, JSON.stringify({ steps: capped.report.steps, weak: capped.report.weak }));
check("...and deferred says exactly what the cap left behind", capped.deferred === 12 - LOCATOR_SWEEP_MAX_JOBS, String(capped.deferred));
check("...each of which carries the CAP_REACHED reason", capped.skipped.filter((s) => s.reason === "CAP_REACHED").length === capped.deferred);
check("the queue is the first steps in scan order, so a sweep is deterministic", capped.queued.map((c) => c.stepName).join(",") === "Weak 0,Weak 1,Weak 2,Weak 3,Weak 4");
check("a second identical sweep queues the same steps", JSON.stringify(ran(sweep([many]), "repeat").queued) === JSON.stringify(capped.queued));
const lowered = ran(sweep([many], { cap: 2 }), "the lowered cap");
check("a caller may lower the cap", lowered.queued.length === 2 && lowered.deferred === 10);
const raised = ran(sweep([many], { cap: 100 }), "the raised cap");
check("...but never raise it above the documented maximum", raised.queued.length === LOCATOR_SWEEP_MAX_JOBS && raised.cap === LOCATOR_SWEEP_MAX_JOBS, String(raised.queued.length));
const zero = ran(sweep([many], { cap: 0 }), "the zero cap");
check("a cap of zero still produces the full audit and queues nothing", zero.queued.length === 0 && zero.report.weak === 12 && zero.deferred === 12);

// ── 7. The master switch, and nothing to sweep ──────────────────────────────────────────────────
console.log("\n7 — edge cases");
const empty = ran(sweep([]), "the empty report");
check("no flows is an empty report, not a failure", empty.report.flows === 0 && empty.report.steps === 0 && empty.queued.length === 0);
const noTargets = ran(sweep([flow("f1", "Data only", [step("Wait", undefined), step("Navigate", undefined)])]), "the no-target report");
check("a flow of non-targeting steps queues nothing", noTargets.queued.length === 0 && noTargets.report.stepsWithoutLocator === 2);
// The master switch is the job's gate, not the audit's: a durability report costs nothing and answers a
// question a user has whether or not local AI is enabled on the machine.
const switchedOff = ran(sweep([flow("f1", "Orders", [step("Open panel", GUARDED)])], { policy: { enabled: false, featureTiers: {} } }), "the switched-off report");
check("with AI off the audit still runs, because it needs no model", switchedOff.report.weak === 1);
check("...and the step is still queueable, since the job's own gate refuses it downstream", switchedOff.queued.length === 1);

// ── 8. The report on its own, with no admission gate ────────────────────────────────────────────
// The Flow Library renders the report whether or not a run is active, so it must not share the
// queue's idleness gate, and it must be the SAME report the sweep produces rather than a second count.
console.log("\n8 — the durability report on its own needs no idle host");
const mixedFlows = [
  flow("f1", "Orders", [step("Open orders", undefined), step("Save order", STRONG), step("Open row detail", GUARDED), step("Pick the label", REVIEW)]),
  flow("f2", "Invoices", [step("Download", STRONG), step("Select row", GUARDED)])
];
const standalone = buildLocatorDurabilityReport(mixedFlows);
check("the standalone report equals the sweep's own report", JSON.stringify(standalone) === JSON.stringify(ran(sweep(mixedFlows), "the comparison sweep").report), JSON.stringify(standalone));
const heldSweep = sweep(mixedFlows, { admission: { ...IDLE, activeRuns: 1 } });
check("...and exists while an active run holds the sweep", !heldSweep.ran && standalone.steps === 5 && standalone.weak === 3, JSON.stringify(standalone));
check("...and is not bounded by the job cap", buildLocatorDurabilityReport([many]).weak === 12);
check("...and carries no locator value, page text or typed value", !/save-order|\.row|div > div|needs-review/.test(JSON.stringify(standalone)));

console.log(`\nL3 §9 flow health sweep: ${passed}/${passed + failed} checks passed.`);
process.exit(failed === 0 ? 0 : 1);
