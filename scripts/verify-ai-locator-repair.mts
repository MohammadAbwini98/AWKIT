/**
 * verify:ai-locator-repair — Phase L L3 §8, runtime locator repair, against real Chromium on the
 * Feature Test Lab page /recorder-lab/locator-upgrade (the `lu-repair` section).
 *
 * §8 differs from §7 in exactly two places, and both are what this suite exists to hold:
 *
 *   1. **Gate E.** A repair may act only while the saved locator is OBSERVED failing. A "repair" of a
 *      locator that still resolves uniquely is an unproven replacement of working behavior, so it is
 *      refused `BASELINE_HEALTHY` — and that refusal is measured on the page, never claimed by a caller.
 *   2. **Gate C.** There is no live baseline to compare against, so identity is the step's own SAVED
 *      fingerprint, through `LocatorFactory`'s own pipeline and its own 0.9 threshold. A unique,
 *      buildable, plausibly-named look-alike must still be refused `WRONG_ELEMENT`.
 *
 * Real layers: the real `AiService` (queue, admission, `AiPromptBuilder` redaction, `AiOutputContract`
 * parsing) over `FakeAiHostTransport`, the trusted compiler and intent guard, the real
 * `proveRepairPlan` browser gates, the real `FileLocatorRecoveryStore` (whose fingerprint is written
 * by a REAL run, not seeded), the real `JsonProfileStore` single-writer lane, the real
 * `promoteLocatorUpgrade` and `revertAiLocatorChange`, and `StepExecutor` + `LocatorFactory` for the
 * runs that must stay unaffected. The only fake is the provider TRANSPORT.
 *
 * What makes it fail: a repair accepted while the saved locator still works; a look-alike accepted as
 * the original element; a repair stored unproven; a repair promoted without a person; a repair
 * promoted as T2 or recorded as a semantic upgrade; a repair proposed on a protected-login surface or
 * a sensitive step; a repair proposed with no recorded identity to prove against; a promoted repair
 * that cannot be reverted; or any run whose outcome changes because a repair exists.
 *
 * Run: npm run verify:ai-locator-repair
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

import type { AiAdmissionView } from "@src/ai/AiAdmission";
import { AiService, type AiServiceSettings } from "@src/ai/AiService";
import { FakeAiHostTransport, type FakeInferStep } from "@src/ai/FakeAiHostTransport";
import {
  isLocatorRepairEligible,
  isLocatorUpgradeEligible,
  runLocatorUpgradeAttempts,
  type LocatorAttemptResult,
  type LocatorUpgradeAttemptInput
} from "@src/ai/locatorUpgradeAttempts";
import { describeFlowLocatorUpgrades, promoteLocatorUpgrade } from "@src/ai/locatorPromotion";
import { pendingEvidence, resolveLocatorStatus } from "@src/ai/locatorStatus";
import { annotatePendingUpgrade } from "@src/ai/pendingUpgrade";
import { revertAiLocatorChange } from "@src/ai/AiRevert";
import type { FlowProfile, FlowStep } from "@src/profiles/FlowProfile";
import { classifyLocatorQuality } from "@src/recorder/LocatorQualityClass";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { proveRepairPlan, resolveRepairAnchor } from "@src/runner/locatorProof";
import { FileLocatorRecoveryStore } from "@src/runner/LocatorRecoveryStore";
import { StepExecutor } from "@src/runner/StepExecutor";
import { ValueResolver } from "@src/runner/ValueResolver";
import { JsonProfileStore } from "@src/storage/ProfileStore";

let passed = 0;
let failed = 0;
/**
 * The promotion and revert sections live inside `if (promotion.ok)`, so a defect that refuses the
 * promotion would SKIP them and report a smaller total — 64/69 rather than a failure, which reads as
 * "mostly fine". These flags turn a skipped block into its own explicit failure.
 */
let promotionChecked = false;
let revertChecked = false;
function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Model output TEXT, parsed by the real output contract inside `AiService`. */
const PLANS = {
  /** The same button, by its accessible name: the repair that must be PROVEN. */
  sameElement: '{"version":1,"target":{"strategy":"role","value":"button","name":"Save draft","exact":true},"scopes":[]}',
  /** Unique and buildable — and the look-alike beside it. Only gate C can tell. */
  lookAlike: '{"version":1,"target":{"strategy":"testId","value":"lu-repair-other"},"scopes":[]}',
  /** Two "Remove" twins in the guarded section. */
  notUnique: '{"version":1,"target":{"strategy":"role","value":"button","name":"Remove"},"scopes":[]}',
  /** Refused by the compiler before the page is touched. */
  positional: '{"version":1,"target":{"strategy":"css","value":"button:nth-child(2)"},"scopes":[]}',
  /** Scoped by a row's data: refused by the intent guard, never proven. */
  dataBound: '{"version":1,"target":{"strategy":"role","value":"button","name":"Delete"},"scopes":[{"kind":"tableRow","strategy":"role","value":"row","hasText":"Alice Smith"}]}'
} as const;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("no port"))));
    });
  });
}

let BASE = "";
let LAB = "";
let browser: Browser | undefined;
const liveBrowser = (): Browser => {
  if (!browser) throw new Error("browser not launched");
  return browser;
};
const work = await mkdtemp(join(tmpdir(), "awkit-l3-repair-"));
const MODEL_ROOT = resolvePath(join(work, "models"));
const FLOW_ID = "flow-repair";
const SCENARIO_ID = "scen-repair";
const STEP_ID = "step-save-draft";

async function freshPage(url = LAB): Promise<Page> {
  const context = await liveBrowser().newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(3_000);
  await page.goto(url);
  return page;
}

/** Strip the target's `id` and `data-testid`: the saved locator breaks, the button does not. */
const breakTarget = (page: Page): Promise<void> => page.getByTestId("lu-repair-break").click();

const IDLE: AiAdmissionView = {
  activeRuns: 0,
  queuedRuns: 0,
  pressureState: "healthy",
  dispatchBlocked: false,
  activeWeight: 0,
  weightedBudget: 4,
  freeMemoryMb: 8_000
};

interface Harness {
  fake: FakeAiHostTransport;
  service: AiService;
  calls: () => number;
}

function harness(script: Array<FakeInferStep | string>, options: { settings?: Partial<AiServiceSettings>; noRuntime?: boolean } = {}): Harness {
  let served = 0;
  const fake = new FakeAiHostTransport({
    modelRoot: MODEL_ROOT,
    respond: (_request, index) => {
      served += 1;
      return script[Math.min(index, script.length - 1)] ?? PLANS.sameElement;
    }
  });
  const service = new AiService({
    transport: () => (options.noRuntime ? null : fake),
    model: async () => ({ ok: true, modelId: "fake-l3-model", modelPath: join(MODEL_ROOT, "model.gguf"), contextTokens: 8192 }),
    settings: async () => ({ enabled: true, yieldDuringRuns: true, idleUnloadMs: 0, minFreeMemoryMb: 0, ...options.settings }),
    admission: () => IDLE,
    threads: 2,
    limits: { yieldCheckMs: 5, admissionRetryMs: 10 },
    nonce: () => "0123456789abcdef"
  });
  return { fake, service, calls: () => served };
}

/**
 * The saved step a repair acts on.
 *
 * Deliberately NOT Recorder output. The Recorder records a whole ranked candidate list, so stripping
 * two attributes leaves its role and text alternatives resolving and there is nothing broken to
 * repair — which is correct product behavior and the wrong fixture for §8. A single-candidate
 * locator is what a hand-edited or imported flow carries, and it is the shape a repair really meets.
 * Everything claimed about it is asserted against the page below, not assumed.
 */
const savedStep = (): FlowStep => ({
  id: STEP_ID,
  type: "click",
  name: "Save the draft",
  locator: {
    strategy: "testId",
    value: "lu-repair-save",
    resolution: "resolved",
    resolvedBy: "user",
    quality: { strategy: "testId", isUnique: true, matchCount: 1, confidence: "high" }
  }
});

let server: ChildProcess | undefined;
try {
  const port = await freePort();
  BASE = `http://127.0.0.1:${port}`;
  LAB = `${BASE}/recorder-lab/locator-upgrade`;
  server = spawn(process.execPath, ["mock-site/server.mjs"], { env: { ...process.env, MOCK_SITE_PORT: String(port) }, stdio: ["ignore", "ignore", "inherit"], windowsHide: true });
  for (let i = 0; i < 100; i += 1) {
    if (await fetch(LAB).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  check("the real mock site serves /recorder-lab/locator-upgrade", await fetch(LAB).then((r) => r.ok, () => false));
  browser = await chromium.launch({ headless: true });

  const flows = new JsonProfileStore<FlowProfile>({ folder: join(work, "flows") });
  const recovery = new FileLocatorRecoveryStore(join(work, "recovery"));
  const step = savedStep();
  const scopeKey = `${SCENARIO_ID}${String.fromCharCode(0)}${FLOW_ID}${String.fromCharCode(0)}${STEP_ID}`;

  const runContext: InstanceExecutionContext = {
    executionId: "exec-repair",
    instanceId: "inst-repair",
    scenarioId: SCENARIO_ID,
    flowId: FLOW_ID,
    instanceOrderNumber: 1,
    totalInstances: 1,
    runtimeInputs: {},
    instanceInputs: {},
    flowOutputs: {},
    paths: { downloads: join(work, "d"), screenshots: join(work, "s"), logs: join(work, "l"), reports: join(work, "r") }
  };
  const runStep = async (target: FlowStep, on: Page, withMemory = true) =>
    new StepExecutor(
      on,
      new LocatorFactory(on, withMemory ? { recoveryStore: recovery, scope: { scenarioId: SCENARIO_ID, flowId: FLOW_ID } } : {}),
      new ValueResolver(runContext),
      runContext
    ).execute(target);

  const seedFlow = async (id = FLOW_ID, node: FlowStep = step): Promise<void> => {
    await flows.delete(id).catch(() => undefined);
    await flows.create({ id, name: "Repair", version: 1, nodes: [node], edges: [] });
  };
  const savedPending = async (id = FLOW_ID, stepId = STEP_ID) => (await flows.get(id))!.nodes.find((n) => n.id === stepId)!.locator?.pendingUpgrade;
  const savedLocator = async (id = FLOW_ID, stepId = STEP_ID) => (await flows.get(id))!.nodes.find((n) => n.id === stepId)!.locator;

  // ── 0. The fixture is audited, not assumed ──────────────────────────────────────────────────────
  console.log("\n0 — the fixture really is a working locator over a real element");
  let page = await freshPage();
  check("the saved locator is a strong semantic locator", classifyLocatorQuality(step.locator)?.class === "strong-semantic", JSON.stringify(classifyLocatorQuality(step.locator)));
  check("...that matches exactly one element before anything breaks", (await page.getByTestId("lu-repair-save").count()) === 1);
  check("...and the look-alike beside it is a DIFFERENT element", (await page.getByTestId("lu-repair-other").count()) === 1);
  const firstRun = await runStep(step, page);
  check("a real run passes and records the element's identity in locator memory", firstRun.status === "passed", firstRun.error);
  check("...acting on the repair target itself", (await page.getByTestId("lu-result").textContent()) === "repair-save");
  const memory = await recovery.get(scopeKey);
  check("...so the recovery store now holds a REAL fingerprint, not a seeded one", memory?.fingerprint !== undefined, JSON.stringify(memory));

  // ── 1. The identity anchor ──────────────────────────────────────────────────────────────────────
  console.log("\n1 — the saved identity a repair proves against");
  const anchor = resolveRepairAnchor(step, { recovery: memory });
  check("a step with no guard falls back to the identity of the element that last resolved", anchor?.source === "recovery-memory", JSON.stringify(anchor?.source));
  check("...at the tolerant confidence, since it is a runtime observation and not a capture guard", anchor?.confidence === "high");
  check("a step with a positional guard uses the guard's own recorded identity first",
    resolveRepairAnchor({ ...step, locator: { ...step.locator!, guard: { container: [], candidateSelector: "button", siblingCount: 2, index: 0, confidence: "exact", fingerprint: memory!.fingerprint! } } }, { recovery: memory })?.source === "guard");
  check("a caller-supplied blueprint element outranks runtime memory",
    resolveRepairAnchor(step, { blueprint: { fingerprint: memory!.fingerprint! }, recovery: memory })?.source === "blueprint");
  check("with nothing recorded at all there is no anchor, and none is invented", resolveRepairAnchor(step) === undefined);

  // ── 2. Eligibility (§8 is NOT §1's weakness gate) ───────────────────────────────────────────────
  console.log("\n2 — eligibility");
  check("a STRONG semantic locator is eligible for repair", isLocatorRepairEligible(step).eligible, JSON.stringify(isLocatorRepairEligible(step)));
  check("...while §7 refuses the same step, because it is not weak", !isLocatorUpgradeEligible(step).eligible);
  const sensitive = isLocatorRepairEligible({ ...step, type: "protectedLoginHandoff" } as FlowStep);
  check("a protected-login step is refused as T3", !sensitive.eligible && sensitive.code === "T3_PROTECTED_LOGIN", JSON.stringify(sensitive));
  const dangerous = isLocatorRepairEligible({ ...step, name: "Delete the account", config: { sideEffectLevel: "dangerousMutation" } } as FlowStep);
  check("a sensitive action is refused as T3", !dangerous.eligible && dangerous.code === "T3_SENSITIVE_STEP", JSON.stringify(dangerous));
  const unreviewed = isLocatorRepairEligible({ ...step, locator: { ...step.locator!, resolution: "needs-review" } });
  check("a locator the user has not accepted is not repaired into place", !unreviewed.eligible && unreviewed.code === "BASELINE_NOT_PROMOTABLE", JSON.stringify(unreviewed));
  check("a step with no locator has nothing to repair", !isLocatorRepairEligible({ ...step, locator: undefined }).eligible);

  // ── The job runner ──────────────────────────────────────────────────────────────────────────────
  let proofs = 0;
  async function job(
    on: Page | undefined,
    script: Array<FakeInferStep | string>,
    options: Partial<LocatorUpgradeAttemptInput> & { step?: FlowStep; harness?: Harness; anchor?: ReturnType<typeof resolveRepairAnchor> } = {}
  ): Promise<{ result: LocatorAttemptResult; harness: Harness }> {
    const h = options.harness ?? harness(script);
    const target = options.step ?? step;
    const useAnchor = "anchor" in options ? options.anchor : anchor;
    const result = await runLocatorUpgradeAttempts(
      {
        requestId: `req-${Math.random().toString(16).slice(2, 10)}`,
        mode: "repair",
        step: target,
        boundValues: ["Alice Smith", "Bob Jones"],
        ...options
      },
      {
        ai: h.service,
        prove: async (plan) => {
          proofs += 1;
          if (!on) throw new Error("no page for proof");
          return proveRepairPlan(on, target, plan, { boundValues: ["Alice Smith", "Bob Jones"], anchor: useAnchor });
        },
        annotate: (pending) => annotatePendingUpgrade(flows, FLOW_ID, target.id, pending)
      }
    );
    await h.service.shutdown();
    return { result, harness: h };
  }

  // ── 3. Gate E: a healthy locator is never "repaired" ────────────────────────────────────────────
  console.log("\n3 — a locator that still works is not repaired (gate E)");
  await seedFlow();
  const healthy = await job(page, [PLANS.sameElement, PLANS.sameElement]);
  check("a repair on a resolving locator is refused BASELINE_HEALTHY", healthy.result.code === "BASELINE_HEALTHY", JSON.stringify(healthy.result));
  check("...and the job ends there rather than proposing again", healthy.result.outcome === "not-eligible" && healthy.result.calls === 1, JSON.stringify(healthy.result));
  check("...with nothing stored", (await savedPending()) === undefined);
  await page.close();

  // ── 4. The repair itself ────────────────────────────────────────────────────────────────────────
  console.log("\n4 — the saved locator breaks, and the same element is proven by its recorded identity");
  await seedFlow();
  page = await freshPage();
  await breakTarget(page);
  check("the break really breaks the saved locator", (await page.getByTestId("lu-repair-save").count()) === 0);
  check("...while the button is still on the page", (await page.getByRole("button", { name: "Save draft", exact: true }).count()) === 1);
  const broken = await runStep(step, page, false);
  check("...so an ordinary run of the step now FAILS", broken.status !== "passed", broken.status);

  const repaired = await job(page, [PLANS.sameElement]);
  check("the repair is accepted on the first attempt", repaired.result.outcome === "accepted" && repaired.result.code === "REPAIR_PROVEN", JSON.stringify(repaired.result));
  check("...spending no attempt, because nothing was refused", repaired.result.attemptsUsed === 0 && repaired.result.calls === 1);
  const pending = await savedPending();
  check("...and it is stored as repair-proven", pending?.proof === "repair-proven", JSON.stringify(pending?.proof));
  check("...naming which recorded identity proved it", pending?.proofEvidence?.identityAnchor === "recovery-memory", JSON.stringify(pending?.proofEvidence));
  check("...with the measured similarity, not a bare boolean", typeof pending?.proofEvidence?.identityScore === "number" && pending.proofEvidence.identityScore >= 0.9, JSON.stringify(pending?.proofEvidence?.identityScore));
  check("...and gate C recorded as passed", pending?.proofEvidence?.sameElement === "pass");
  check("...and the SAVED locator is untouched: a repair never promotes itself", (await savedLocator())?.value === "lu-repair-save");
  check("...and nothing was added to alternatives, where LocatorFactory would execute it", ((await savedLocator())?.alternatives ?? []).length === 0);
  check("no proposal carries page text, a model prompt or a fingerprint", !/Save draft|Discard|fingerprint/i.test(JSON.stringify(pending?.proofEvidence ?? {})));

  // ── 5. Gate C: the look-alike is refused ────────────────────────────────────────────────────────
  console.log("\n5 — a unique, buildable look-alike is still the wrong element (gate C)");
  await seedFlow();
  const wrong = await job(page, [PLANS.lookAlike, PLANS.notUnique]);
  check("a different element is rejected by gate C", wrong.result.attempts[0]?.stage === "proof" && wrong.result.attempts[0]?.code === "WRONG_ELEMENT", JSON.stringify(wrong.result.attempts));
  check("a candidate matching two elements is rejected by gate B", wrong.result.attempts[1]?.code === "CANDIDATE_NOT_UNIQUE", JSON.stringify(wrong.result.attempts));
  check("...the budget is spent and the job ends", wrong.result.outcome === "attempts-exhausted" && wrong.result.attemptsUsed === 2);
  check("...and neither was stored", (await savedPending()) === undefined);

  // ── 6. No anchor means nothing to prove against ─────────────────────────────────────────────────
  console.log("\n6 — with no recorded identity, a repair is refused rather than guessed");
  await seedFlow();
  const anchorless = await job(page, [PLANS.sameElement, PLANS.sameElement], { anchor: undefined });
  check("a repair with no identity anchor is refused NO_IDENTITY_ANCHOR", anchorless.result.code === "NO_IDENTITY_ANCHOR", JSON.stringify(anchorless.result));
  check("...and ends the job rather than asking again", anchorless.result.outcome === "not-eligible" && anchorless.result.calls === 1);
  check("...with nothing stored", (await savedPending()) === undefined);

  // ── 6b. An unprovable repair is not stored, because replay could never settle it ────────────────
  console.log("\n6b — an unprovable repair is discarded, not parked for a replay that cannot happen");
  await seedFlow();
  const closing = await freshPage();
  await closing.close();
  const unprovable = await job(closing, [PLANS.sameElement, PLANS.sameElement]);
  check("a closed page yields PAGE_UNAVAILABLE", unprovable.result.code === "PAGE_UNAVAILABLE", JSON.stringify(unprovable.result));
  check("...ending the job as unprovable rather than as a rejection", unprovable.result.outcome === "unprovable" && unprovable.result.attemptsUsed === 0, JSON.stringify(unprovable.result));
  // §7 would STORE this as `unprovable-now` and let replay settle it later. §8 must not: replay
  // proves a candidate against the element the saved locator resolves to, and a repair exists
  // precisely because it resolves to nothing, so a parked repair could never be confirmed or retired.
  check("...and nothing is stored, unlike a §7 upgrade in the same situation", (await savedPending()) === undefined, JSON.stringify(await savedPending()));

  // ── 7. The trusted pipeline still applies ───────────────────────────────────────────────────────
  console.log("\n7 — the compiler and intent guard run before the page, exactly as in §7");
  await seedFlow();
  const refusedBefore = proofs;
  const positional = await job(page, [PLANS.positional, PLANS.positional]);
  check("a positional CSS selector is refused by the compiler", positional.result.code === "POSITIONAL", JSON.stringify(positional.result));
  check("...without reaching the browser", proofs === refusedBefore, `${proofs - refusedBefore} proofs ran`);
  const bound = await job(page, [PLANS.dataBound, PLANS.dataBound]);
  check("a scope that is a bound data value is refused by the intent guard", bound.result.code === "INTENT_BOUND_VALUE", JSON.stringify(bound.result));
  check("nothing refused was stored", (await savedPending()) === undefined);

  // ── 8. A protected-login surface is never repaired ──────────────────────────────────────────────
  console.log("\n8 — a protected sign-in surface ends the job");
  await seedFlow();
  const login = await freshPage(`${BASE}/login`);
  const guarded = await job(login, [PLANS.sameElement, PLANS.sameElement]);
  check("the repair proof refuses a protected-login page", guarded.result.code === "T3_PROTECTED_LOGIN", JSON.stringify(guarded.result));
  check("...and the job ends rather than proposing again", guarded.result.outcome === "forbidden" && guarded.result.calls === 1);
  check("...with nothing stored", (await savedPending()) === undefined);
  await login.close();

  // ── 9. Provider absence changes nothing ─────────────────────────────────────────────────────────
  console.log("\n9 — no provider, no change");
  await seedFlow();
  const off = await job(page, [PLANS.sameElement], { harness: harness([PLANS.sameElement], { settings: { enabled: false } }) });
  check("AI switched off refuses the repair at submit", off.result.outcome === "provider-unavailable" && off.result.code === "DISABLED", JSON.stringify(off.result));
  const noRuntime = await job(page, [PLANS.sameElement], { harness: harness([PLANS.sameElement], { noRuntime: true }) });
  check("no local runtime refuses the repair", noRuntime.result.outcome === "provider-unavailable" && noRuntime.result.code === "UNAVAILABLE");
  check("neither stored anything", (await savedPending()) === undefined);

  // ── 10. Promotion is T1, on the repair's own proof ──────────────────────────────────────────────
  console.log("\n10 — promotion: a person applies a repair, and no replay tally is asked for");
  await seedFlow();
  const toPromote = await job(page, [PLANS.sameElement]);
  check("a repair is pending", toPromote.result.outcome === "accepted");
  const profile = (await flows.get(FLOW_ID))!;
  const proposal = profile.nodes[0].locator!.pendingUpgrade!;
  const policy = { enabled: true, featureTiers: {} } as const;

  const autoPromotion = promoteLocatorUpgrade(profile, STEP_ID, {
    createdAt: proposal.createdAt,
    mode: "auto",
    actionId: "act-auto",
    nowIso: new Date().toISOString(),
    replayProofs: [],
    policy,
    editorDirty: false
  });
  check("an unattended apply is refused: locatorRepair's ceiling is T1", !autoPromotion.ok && autoPromotion.code === "POLICY_REFUSED", JSON.stringify(autoPromotion));

  const dirty = promoteLocatorUpgrade(profile, STEP_ID, {
    createdAt: proposal.createdAt,
    mode: "user-approved",
    actionId: "act-dirty",
    nowIso: new Date().toISOString(),
    replayProofs: [],
    policy,
    editorDirty: true
  });
  check("an unsaved editor still defers the write", !dirty.ok && dirty.code === "EDITOR_DIRTY");

  const appliedAt = new Date().toISOString();
  const promotion = promoteLocatorUpgrade(profile, STEP_ID, {
    createdAt: proposal.createdAt,
    mode: "user-approved",
    actionId: "act-repair",
    nowIso: appliedAt,
    // Deliberately EMPTY: a repair must not need a replay tally, because a baseline that does not
    // resolve can never produce one. Passing tallies here would hide it if the requirement returned.
    replayProofs: [],
    policy,
    editorDirty: false
  });
  check("a user-approved repair is promoted with no replay evidence at all", promotion.ok, promotion.ok ? "" : promotion.code);
  if (promotion.ok) {
    const locator = promotion.profile.nodes[0].locator!;
    check("...the saved locator is now the proven candidate", locator.strategy === "role" && locator.name === "Save draft", JSON.stringify({ strategy: locator.strategy, name: locator.name }));
    check("...recorded as an AI repair, not a semantic upgrade", locator.locatorProvenance?.source === "ai-repair", locator.locatorProvenance?.source);
    check("...with the repair proof named", locator.locatorProvenance?.proof === "repair-proven");
    check("...at T1, because a person authorized it", locator.locatorProvenance?.tier === "T1" && promotion.record.tier === "T1");
    check("...and the audit record attributes it to locatorRepair", promotion.record.feature === "locatorRepair" && promotion.record.proof.result === "repair-proven", JSON.stringify(promotion.record.proof));
    check("...reporting no replay counts rather than zeroes", promotion.record.proof.replays === undefined && promotion.record.proof.dataRows === undefined);
    check("...the whole previous locator is kept as the revert target", locator.locatorProvenance?.previous.value === "lu-repair-save");
    check("...and never in alternatives, where the runner would execute it", (locator.alternatives ?? []).length === 0);
    check("...the pending candidate is consumed", locator.pendingUpgrade === undefined);

    // The promoted locator must actually work on the broken page — otherwise the repair repaired nothing.
    await flows.update(FLOW_ID, promotion.profile);
    const afterRepair = await runStep(promotion.profile.nodes[0], page, false);
    check("a run of the repaired step now PASSES on the page that broke it", afterRepair.status === "passed", afterRepair.error);
    check("...acting on the original element", (await page.getByTestId("lu-result").textContent()) === "repair-save");

    // ── 11. Revert ────────────────────────────────────────────────────────────────────────────────
    console.log("\n11 — one click restores the locator the repair replaced");
    const reverted = revertAiLocatorChange((await flows.get(FLOW_ID))!, STEP_ID, "act-repair", new Date().toISOString());
    check("the repair is revertable", reverted.ok, reverted.ok ? "" : reverted.code);
    if (reverted.ok) {
      await flows.update(FLOW_ID, reverted.profile);
      const restored = await savedLocator();
      check("...restoring the exact previous locator", restored?.strategy === "testId" && restored.value === "lu-repair-save", JSON.stringify(restored));
      check("...and dropping the provenance", restored?.locatorProvenance === undefined);
      revertChecked = true;
    }
    promotionChecked = true;
  }

  // ── 12. §10 says "repair-proven", never "replay-proven" ─────────────────────────────────────────
  console.log("\n12 — the status vocabulary reports what actually happened");
  await seedFlow();
  await job(page, [PLANS.sameElement]);
  const view = describeFlowLocatorUpgrades({ profile: (await flows.get(FLOW_ID))!, replayProofs: [], policy, editorDirty: false });
  const pendingView = view.pending[0];
  check("the view reports the repair as eligible without any replay tally", pendingView?.state === "eligible", JSON.stringify(pendingView?.state));
  check("...and promotable", pendingView?.promotable === true, JSON.stringify(pendingView?.blockedReason));
  const status = resolveLocatorStatus({ quality: classifyLocatorQuality(step.locator), pending: pendingView, applied: undefined, editorDirty: false });
  check("the badge says repair-proven, not replay-proven", status.label === "AI semantic (repair-proven)", status.label);
  // The claim being guarded is replay verification, not the word "runs": the honest sentence ends
  // "...the one that runs until you apply it", which is about the SAVED locator and must stay.
  check("...and the sentence never claims replays that never happened", !/enough runs|some runs|distinct data rows/.test(status.headline), status.headline);
  check("...saying instead what was actually established", status.headline.startsWith("The saved locator was found broken"), status.headline);
  check("...and Apply is offered", status.applyOffered && status.applyVisible);
  const rows = pendingEvidence(pendingView!);
  const replayRow = rows.find((row) => row.id === "replay");
  check("the replay row says the threshold does not apply, rather than showing 0 of 3", replayRow?.value.startsWith("Not applicable"), replayRow?.value);
  const identityRow = rows.find((row) => row.id === "identity");
  check("the identity row names the recorded identity it matched", identityRow?.value.includes("identity of the element that last resolved"), identityRow?.value);
  check("...and no evidence row carries a fingerprint, a prompt or model text", !/fingerprint|prompt|token/i.test(JSON.stringify(rows)));

  // ── 13. A pending repair is inert ───────────────────────────────────────────────────────────────
  console.log("\n13 — a stored repair changes no run until a person applies it");
  const withPending = (await flows.get(FLOW_ID))!.nodes[0];
  check("the repair is stored", withPending.locator?.pendingUpgrade !== undefined);
  const healthyPage = await freshPage();
  const untouched = await runStep(withPending, healthyPage, false);
  check("...and on an unbroken page the step still uses the SAVED locator", untouched.status === "passed", untouched.error);
  check("...acting on the original element", (await healthyPage.getByTestId("lu-result").textContent()) === "repair-save");
  await healthyPage.close();
  await page.close();
  console.log("\nevery conditional section actually ran");
  check("the promotion section was reached, not skipped by a refused promotion", promotionChecked);
  check("the revert section was reached, not skipped by a refused revert", revertChecked);
} finally {
  await browser?.close().catch(() => undefined);
  server?.kill();
}

console.log(`\nL3 §8 runtime repair: ${passed}/${passed + failed} checks passed.`);
process.exit(failed === 0 ? 0 : 1);
