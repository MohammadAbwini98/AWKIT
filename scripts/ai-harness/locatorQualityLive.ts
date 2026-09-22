/**
 * `verify:ai-locator-quality-live`: the real Qwen3.5-0.8B's locator plans, judged on real pages (Phase L,
 * the L1.8 live quality gate over L3's labelled quality set). Runs inside the AI harness
 * (scripts/ai-harness/harnessMain.ts).
 *
 * `verify:ai-locator-upgrade-live` shows the product's request is answered in time and its plans decode,
 * compile and pass the intent guard, with the browser proof stubbed as page-unavailable. This mode removes
 * the stub. Each scenario is a real Recorder capture on /recorder-lab/locator-upgrade, sent through
 * `runLocatorUpgradeAttempts`, the production `AiService` and the real `ai-host.cjs`, and every plan that
 * compiles is proven by the product's own `proveLocatorPlan` / `proveRepairPlan` in real Chromium.
 *
 * An accepted candidate is then judged by the PAGE, not by the product's gates: on a fresh page it must
 * match exactly one element, that element's `data-lu` must be the one the Recorder clicked, the product's
 * replay proof (or repair proof) must pass again, and clicking it must make the page report that element.
 *
 * The acceptance rule is L3's: false-target = 0 (applied here to every accepted candidate, not only a
 * promoted one), the impossible case stays honestly guarded, nothing refused is stored and a pending
 * candidate never executes. Upgrade and proof rates, rejection reasons and latency are recorded, not
 * judged, because no plan sets a threshold for them. At least one real plan must be browser-proven, or
 * the gate has judged nothing.
 *
 * Before any model call, scripted controls show the judge is not vacuous: a correct plan must pass it,
 * and a wrong element and an ambiguous match let through by a proof with gate C or B bypassed, a stubbed
 * proof, and a second attempt that does not carry the first attempt's real refusal must each be caught.
 *
 * Counts, codes, fixture names and timings only, never model text.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Page } from "playwright";

import { buildAiPrompt } from "@src/ai/AiPromptBuilder";
import type { AiJobOutcome, AiJobRequest } from "@src/ai/AiService";
import { evaluateLocatorPlan, planFromCandidate } from "@src/ai/locatorPlan";
import {
  LOCATOR_ATTEMPT_LIMITS,
  buildAttemptFeedback,
  locatorAttemptJob,
  runLocatorUpgradeAttempts,
  type LocatorAttemptResult,
  type LocatorUpgradeAttemptDeps,
  type LocatorUpgradeAttemptInput,
  type LocatorUpgradeProvider
} from "@src/ai/locatorUpgradeAttempts";
import { annotatePendingUpgrade, locatorCandidateDigest } from "@src/ai/pendingUpgrade";
import type { FlowProfile, FlowStep } from "@src/profiles/FlowProfile";
import { buildRecordedFlow } from "@src/recorder/buildRecordedFlow";
import { classifyLocatorQuality } from "@src/recorder/LocatorQualityClass";
import { getRecorderInitScriptContent } from "@src/recorder/recorderInitScript";
import type { RecordedAction } from "@src/recorder/RecorderTypes";
import { markBoundValues, sanitizeUpgradeContext, takeUpgradeContext, type UpgradeContext } from "@src/recorder/upgradeContext";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { FileLocatorRecoveryStore } from "@src/runner/LocatorRecoveryStore";
import { proveLocatorPlan, proveRepairPlan, replayPendingUpgrade, resolveRepairAnchor, type LocatorProofResult, type RepairIdentityAnchor } from "@src/runner/locatorProof";
import { SemanticRedactor } from "@src/semantic/SemanticRedactor";
import { JsonProfileStore } from "@src/storage/ProfileStore";

import { answeredInTime, hello, measured, observed, type FeatureLiveApi } from "./featureLive";
import { BOUND_VALUES, PROMPT_NONCE, planShape } from "./locatorUpgradePacket";

interface Scenario {
  id: string;
  /** Which requested situation it is. */
  covers: string;
  name: string;
  mode: "upgrade" | "repair";
  /** Asked for from Element Spy (L3 §1), so a strong baseline is still eligible. */
  userRequested?: boolean;
  /** `data-lu` of the element the step acts on. The page writes it into `lu-result` when that element is clicked. */
  intended: string;
  click: (page: Page) => Promise<unknown>;
  /** Puts a fresh page into the state the proof and the re-check run in. */
  prepare?: (page: Page) => Promise<unknown>;
  /** No locator the plan language can express isolates this element, so nothing may be accepted. */
  impossible?: boolean;
  /** The list re-renders as new elements while the job holds a plan; the proof waits on the page's own status. */
  dynamic?: boolean;
}

interface Proof {
  attempt: number;
  /** What the job was handed. */
  result: LocatorProofResult;
  /** A negative control's bypass changed the real answer; this is what the product said. */
  untampered?: string;
  /** Dynamic only: the same plan proven while the page said `loading`. */
  unsynchronized?: { outcome: string; code: string; whileLoading: boolean };
}

interface Call {
  request: AiJobRequest;
  outcome: AiJobOutcome;
}

interface Verdict {
  accepted: boolean;
  proof: string | null;
  /** A real browser proof of the accepting attempt said proven, and the page agreed. */
  browserProven: boolean;
  matches: number | null;
  selected: string | null;
  recheck: string | null;
  clicked: string | null;
  /** Accepted, and not exactly the intended element. */
  falseTarget: boolean;
  problems: string[];
}

/** The page's own signal, never a clock. A synchronous predicate: an async one is a truthy Promise at once. */
const reportsReady = (page: Page) =>
  page.waitForFunction(() => document.querySelector('[data-testid="lu-dynamic-status"]')?.textContent === "ready", undefined, { timeout: 10_000 });
const reportsStatus = (page: Page) => page.getByTestId("lu-dynamic-status").textContent();

const SCENARIOS: readonly Scenario[] = [
  { id: "unique", covers: "a uniquely identifiable element", name: "Open Gamma", mode: "upgrade", userRequested: true, intended: "open-gamma", click: (p) => p.getByTestId("lu-open-gamma").click() },
  { id: "multiple-matches", covers: "the initial locator matches more than one element", name: "Archive item", mode: "upgrade", intended: "archive", click: (p) => p.getByRole("button", { name: "Archive" }).click() },
  {
    id: "scope",
    covers: "a locator that needs a container scope",
    name: "Edit shipping address",
    mode: "upgrade",
    userRequested: true,
    intended: "edit-shipping",
    click: (p) => p.getByRole("region", { name: "Shipping address", exact: true }).getByRole("button", { name: "Edit address" }).click()
  },
  {
    id: "stale",
    covers: "a stale original locator, through the repair path",
    name: "Save the draft",
    mode: "repair",
    intended: "repair-save",
    click: (p) => p.getByTestId("lu-repair-save").click(),
    prepare: (p) => p.getByTestId("lu-repair-break").click()
  },
  {
    id: "dynamic",
    covers: "dynamic content that needs observable synchronization",
    name: "Download summary",
    mode: "upgrade",
    userRequested: true,
    intended: "download-summary",
    dynamic: true,
    click: (p) => p.getByRole("button", { name: "Download summary", exact: true }).click(),
    prepare: reportsReady
  },
  {
    id: "impossible",
    covers: "an element that cannot be uniquely identified, which forces the second attempt",
    name: "Remove item",
    mode: "upgrade",
    intended: "twin-first",
    impossible: true,
    click: (p) => p.locator('[data-lu="twin-first"]').click()
  }
];
const scenario = (id: string): Scenario => SCENARIOS.find((s) => s.id === id)!;

/**
 * The step a repair acts on: a single test-id candidate, as a hand-edited or imported flow carries. A
 * Recorder capture keeps role and text alternatives that survive the break, so there would be nothing
 * broken to repair (`verify:ai-locator-repair` makes the same choice).
 */
const REPAIR_STEP: FlowStep = {
  id: "s-repair-save",
  type: "click",
  name: "Save the draft",
  locator: { strategy: "testId", value: "lu-repair-save", resolution: "resolved", resolvedBy: "user", quality: { strategy: "testId", isUnique: true, matchCount: 1, confidence: "high" } }
};

/** Scripted plans for the controls only. */
const PLAN = {
  archive: { version: 1, target: { strategy: "role", value: "button", name: "Archive", exact: true }, scopes: [] },
  gamma: { version: 1, target: { strategy: "testId", value: "lu-open-gamma" }, scopes: [] },
  remove: { version: 1, target: { strategy: "role", value: "button", name: "Remove" }, scopes: [] },
  removeExact: { version: 1, target: { strategy: "role", value: "button", name: "Remove", exact: true }, scopes: [] }
};

/** Outcomes that end a job after a refusal, so no next attempt is owed. */
const ENDS_JOB = new Set(["forbidden", "context-expired", "not-eligible", "cancelled"]);

const allPass = (proof: LocatorProofResult) => Object.values(proof.gates).every((gate) => gate === "pass");

/**
 * Whether every attempt after the first was built from the REAL outcome of the one before it. The refusal
 * the job recorded must be what that attempt's own answer and real proof came to, re-derived here rather
 * than read back from the job, and the next request must carry it. Empty when it holds.
 */
export function attemptViolations(input: LocatorUpgradeAttemptInput, result: LocatorAttemptResult, calls: readonly Call[], proofs: readonly Proof[]): string[] {
  const violations: string[] = [];
  const seen = new Set<string>();
  const baseline = input.step.locator!;
  const actual = (attempt: number): { stage: string; code: string; field?: string } | undefined => {
    const outcome = calls[attempt - 1]?.outcome;
    if (outcome?.status === "failed") return { stage: "provider", code: outcome.code };
    if (outcome?.status !== "ok") return undefined;
    const evaluated = evaluateLocatorPlan(outcome.value, { boundValues: input.boundValues, baseline, captured: baseline.context, policy: input.policy });
    if (!evaluated.ok) return { stage: evaluated.code === "INTENT_BOUND_VALUE" ? "intent" : "compiler", code: evaluated.code, field: evaluated.field };
    const digest = locatorCandidateDigest(evaluated.candidate, evaluated.context);
    if (seen.has(digest)) return { stage: "duplicate", code: "DUPLICATE_CANDIDATE" };
    seen.add(digest);
    const proof = proofs.find((p) => p.attempt === attempt)?.result;
    if (!proof) return { stage: "none", code: "NEVER_PROVEN" };
    return proof.outcome === "rejected" ? { stage: "proof", code: proof.code, ...(proof.field ? { field: proof.field } : {}) } : { stage: "accepted", code: proof.code };
  };
  for (let attempt = 1; attempt <= calls.length; attempt += 1) {
    const truth = actual(attempt);
    const record = result.attempts.find((r) => r.attempt === attempt);
    if (truth?.stage === "none") violations.push(`ATTEMPT_${attempt}_PLAN_NEVER_REACHED_THE_BROWSER`);
    if (!truth || truth.stage === "accepted" || truth.stage === "none") {
      if (record) violations.push(`ATTEMPT_${attempt}_RECORDED_BUT_NOT_REFUSED`);
      if (attempt < calls.length) violations.push(`ATTEMPT_${attempt}_NOT_REFUSED_YET_ASKED_AGAIN`);
      continue;
    }
    if (!record || record.stage !== truth.stage || record.code !== truth.code || record.field !== truth.field) violations.push(`ATTEMPT_${attempt}_RECORD_IS_NOT_ITS_OUTCOME`);
    const next = calls[attempt];
    if (next) {
      const lines = next.request.prompt.fields.flatMap((field) => (field.text ?? "").split("\n"));
      if (!record || !lines.includes(`refused ${buildAttemptFeedback([record])}`)) violations.push(`ATTEMPT_${attempt + 1}_DOES_NOT_CARRY_THE_REFUSAL`);
    } else if (attempt < LOCATOR_ATTEMPT_LIMITS.maxAttempts && !ENDS_JOB.has(result.outcome)) {
      violations.push(`ATTEMPT_${attempt + 1}_MISSING`);
    }
  }
  if (calls.length > LOCATOR_ATTEMPT_LIMITS.maxAttempts) violations.push("OVER_BUDGET");
  return violations;
}

export async function runLocatorQualityLive(api: FeatureLiveApi): Promise<void> {
  const lab = process.env.AWKIT_HARNESS_LAB_URL;
  if (!lab) throw new Error("AWKIT_HARNESS_LAB_URL is not set");
  const ctx = observed(api);
  api.record("deadlineMs", LOCATOR_ATTEMPT_LIMITS.timeoutMs);
  await hello(api, ctx);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-l1-quality-"));
  const flows = new JsonProfileStore<FlowProfile>({ folder: path.join(work, "flows") });
  const recovery = new FileLocatorRecoveryStore(path.join(work, "recovery"));
  const browser = await chromium.launch({ headless: true });

  const freshPage = async (): Promise<Page> => {
    const page = await (await browser.newContext()).newPage();
    page.setDefaultTimeout(3_000);
    await page.goto(lab);
    return page;
  };
  const closePage = (page: Page) => page.context().close().catch(() => undefined);

  /** A real Recorder capture, taken the way `RecorderService` takes it: context off the action first, then sanitized and marked. */
  const capture = async (sc: Scenario): Promise<{ step: FlowStep; context: UpgradeContext }> => {
    const context = await browser.newContext();
    const actions: RecordedAction[] = [];
    try {
      await context.addInitScript({ content: getRecorderInitScriptContent() });
      const page = await context.newPage();
      page.setDefaultTimeout(5_000);
      await page.exposeBinding("__awtkit_recordAction", (_source, action) => actions.push(action as RecordedAction));
      await page.exposeBinding("__awtkit_recordSignal", () => undefined);
      await page.goto(lab);
      await reportsReady(page);
      // As the Recorder verifiers do: the init script settles before its first capture.
      await page.waitForTimeout(400);
      await sc.click(page);
      for (let i = 0; i < 100 && !actions.some((a) => a.type === "click"); i += 1) await page.waitForTimeout(50);
    } finally {
      await context.close();
    }
    const raw = actions.find((a) => a.type === "click");
    if (!raw) throw new Error(`the Recorder captured no click for ${sc.id}`);
    const rawContext = takeUpgradeContext(raw);
    const step = buildRecordedFlow("L1 quality", [{ ...raw, name: sc.name }]).nodes.find((node) => node.type === "click");
    const sanitized = sanitizeUpgradeContext(rawContext, { pageAlias: "main", frameDepth: 0 });
    if (!step || !sanitized) throw new Error(`no step or no capture context for ${sc.id}`);
    return { step, context: markBoundValues(sanitized, BOUND_VALUES.map((value) => value.toLowerCase())) };
  };

  const runJob = async (sc: Scenario, step: FlowStep, flowId: string, ai: LocatorUpgradeProvider, prove: LocatorUpgradeAttemptDeps["prove"], context?: UpgradeContext) => {
    await flows.delete(flowId).catch(() => undefined);
    await flows.create({ id: flowId, name: sc.name, version: 1, nodes: [step], edges: [] });
    const input: LocatorUpgradeAttemptInput = {
      requestId: `quality-${flowId}`,
      mode: sc.mode,
      step,
      boundValues: BOUND_VALUES,
      ...(context ? { upgradeContext: context } : {}),
      ...(sc.userRequested ? { userRequested: true } : {})
    };
    const result = await runLocatorUpgradeAttempts(input, { ai, prove, annotate: (pending) => annotatePendingUpgrade(flows, flowId, step.id, pending) });
    return { input, result };
  };

  /** The product's own proof, recorded. `tamper` is a control's broken gate, applied before the job sees the answer. */
  const realProof = (sc: Scenario, page: Page, step: FlowStep, proofs: Proof[], extra: { context?: UpgradeContext; anchor?: RepairIdentityAnchor; tamper?: (r: LocatorProofResult) => LocatorProofResult } = {}): LocatorUpgradeAttemptDeps["prove"] => {
    const once = (plan: unknown) =>
      sc.mode === "repair"
        ? proveRepairPlan(page, step, plan, { boundValues: BOUND_VALUES, anchor: extra.anchor })
        : proveLocatorPlan(page, step, plan, { boundValues: BOUND_VALUES, upgradeContext: extra.context });
    return async (plan, attempt) => {
      let unsynchronized: Proof["unsynchronized"];
      if (sc.dynamic) {
        // The list re-renders as NEW elements while the job holds a plan. Proven at once, the page is
        // mid-render; the proof the job gets waits until the page says it is ready.
        await page.getByTestId("lu-dynamic-reload").click();
        const before = await reportsStatus(page);
        const early = await once(plan);
        unsynchronized = { outcome: early.outcome, code: early.code, whileLoading: before === "loading" && (await reportsStatus(page)) === "loading" };
        await reportsReady(page);
      }
      const real = await once(plan);
      const result = extra.tamper ? extra.tamper(real) : real;
      proofs.push({ attempt, result, ...(result !== real ? { untampered: real.code } : {}), ...(unsynchronized ? { unsynchronized } : {}) });
      return result;
    };
  };

  /** Answers every call with the next scripted plan, as the output contract would hand it over. */
  const scripted = (plans: unknown[], calls: Call[]): LocatorUpgradeProvider => ({
    submit: async (request) => {
      const outcome: AiJobOutcome = {
        status: "ok",
        value: structuredClone(plans[Math.min(calls.length, plans.length - 1)]),
        modelId: "scripted-control",
        usage: { promptTokens: 0, outputTokens: 0, firstTokenMs: 0, generationMs: 0 },
        yields: 0
      };
      calls.push({ request, outcome });
      return outcome;
    },
    cancel: () => false
  });

  /** The page's verdict on what the job did, on a fresh page, never the product's own gates. */
  const judge = async (sc: Scenario, result: LocatorAttemptResult, proofs: readonly Proof[], flowId: string, stepId: string, anchor?: RepairIdentityAnchor): Promise<Verdict> => {
    const saved = (await flows.get(flowId))?.nodes.find((node) => node.id === stepId);
    const stored = saved?.locator?.pendingUpgrade;
    const problems: string[] = [];
    if (result.outcome !== "accepted" || !result.pending) {
      if (stored) problems.push("REFUSED_BUT_STORED");
      return { accepted: false, proof: null, browserProven: false, matches: null, selected: null, recheck: null, clicked: null, falseTarget: false, problems };
    }
    const pending = result.pending;
    if (!saved || stored?.createdAt !== pending.createdAt) problems.push("ACCEPTED_BUT_NOT_STORED");
    // The accepting attempt is the last call, and its proof must really have run in the browser.
    const real = proofs.find((p) => p.attempt === result.calls)?.result;
    const provenNow = real?.outcome === "proven" && allPass(real) && real.candidateMatchCount === 1;
    if (!real) problems.push("NO_REAL_PROOF");
    else if (real.outcome === "rejected") problems.push("ACCEPTED_AFTER_A_REJECTED_PROOF");
    const expected = sc.mode === "repair" ? "repair-proven" : provenNow ? "capture-proven" : "unprovable-now";
    if (pending.proof !== expected) problems.push("PROOF_MISREPORTED");

    const page = await freshPage();
    let matches: number | null = null;
    let selected: string | null = null;
    let recheck: string | null = null;
    let clicked: string | null = null;
    try {
      await sc.prepare?.(page);
      const locator = await new LocatorFactory(page).locateCandidate(pending.candidate, pending.context).catch(() => null);
      matches = locator ? await locator.count().catch(() => 0) : null;
      if (locator && matches === 1) selected = await locator.getAttribute("data-lu").catch(() => null);
      if (saved) {
        recheck = (
          sc.mode === "repair"
            ? await proveRepairPlan(page, saved, planFromCandidate(pending.candidate, pending.context), { boundValues: BOUND_VALUES, anchor })
            : await replayPendingUpgrade(page, saved, { boundValues: BOUND_VALUES })
        ).code;
      }
      // Proof never acts; the verifier does, on its own page, so the page itself says which element it was.
      if (locator && matches === 1 && (await locator.click().then(() => true, () => false))) clicked = await page.getByTestId("lu-result").textContent();
    } finally {
      await closePage(page);
    }
    if (matches !== 1) problems.push("NOT_UNIQUE");
    if (selected !== sc.intended) problems.push("WRONG_ELEMENT");
    if (clicked !== sc.intended) problems.push("CLICK_REACHED_ANOTHER_ELEMENT");
    if (recheck !== (sc.mode === "repair" ? "REPAIR_PROVEN" : "PROVEN")) problems.push("RECHECK_NOT_PROVEN");
    const falseTarget = matches !== 1 || selected !== sc.intended || clicked !== sc.intended;
    return { accepted: true, proof: pending.proof, browserProven: provenNow && problems.length === 0, matches, selected, recheck, clicked, falseTarget, problems };
  };

  /** A control job over a scripted provider, on a fresh lab page. */
  const control = async (sc: Scenario, plans: unknown[], prove: (page: Page, step: FlowStep, proofs: Proof[]) => LocatorUpgradeAttemptDeps["prove"]) => {
    const { step } = await capture(sc);
    const flowId = `control-${sc.id}-${Math.random().toString(16).slice(2, 8)}`;
    const page = await freshPage();
    const calls: Call[] = [];
    const proofs: Proof[] = [];
    try {
      const run = await runJob(sc, step, flowId, scripted(plans, calls), prove(page, step, proofs));
      return { ...run, calls, proofs, step, verdict: await judge(sc, run.result, proofs, flowId, step.id) };
    } finally {
      await closePage(page);
    }
  };
  const forceProven = (code: string) => (r: LocatorProofResult): LocatorProofResult =>
    r.code !== code ? r : { ...r, outcome: "proven", code: "PROVEN", pendingEligible: true, candidateMatchCount: 1, gates: { policy: "pass", buildable: "pass", unique: "pass", sameElement: "pass" } };

  try {
    const archive = scenario("multiple-matches");
    const twins = scenario("impossible");

    // ── Controls: the judge is not vacuous, and each broken behavior is caught ──────────────────────
    // A judge whose controls fail cannot judge the model, so a failed control ends the run before any model call.
    let controlsFailed = 0;
    const controlStep = async <T>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
      const value = await api.step(label, fn);
      if (value === undefined) controlsFailed += 1;
      return value;
    };
    await controlStep("control: a correct plan through the real proof is judged proven, and the intended element", async () => {
      const run = await control(archive, [PLAN.archive], (page, step, proofs) => realProof(archive, page, step, proofs));
      if (run.result.outcome !== "accepted" || !run.verdict.browserProven || run.verdict.problems.length > 0) throw new Error(JSON.stringify(run.verdict));
      return run.verdict;
    });
    await controlStep("control: a wrong element let through by a bypassed gate C is caught as a false target", async () => {
      const run = await control(archive, [PLAN.gamma], (page, step, proofs) => realProof(archive, page, step, proofs, { tamper: forceProven("WRONG_ELEMENT") }));
      const untampered = run.proofs[0]?.untampered;
      if (untampered !== "WRONG_ELEMENT") throw new Error(`the real proof said ${untampered ?? "nothing"}, so the bypass was never needed`);
      if (run.result.outcome !== "accepted" || !run.verdict.falseTarget || !run.verdict.problems.includes("WRONG_ELEMENT") || run.verdict.browserProven) throw new Error(JSON.stringify(run.verdict));
      return { untampered, verdict: run.verdict };
    });
    await controlStep("control: an ambiguous match let through by a bypassed gate B is caught as a false target", async () => {
      const run = await control(twins, [PLAN.removeExact], (page, step, proofs) => realProof(twins, page, step, proofs, { tamper: forceProven("CANDIDATE_NOT_UNIQUE") }));
      const untampered = run.proofs[0]?.untampered;
      if (untampered !== "CANDIDATE_NOT_UNIQUE") throw new Error(`the real proof said ${untampered ?? "nothing"}, so the bypass was never needed`);
      if (run.result.outcome !== "accepted" || !run.verdict.falseTarget || !run.verdict.problems.includes("NOT_UNIQUE") || run.verdict.browserProven) throw new Error(JSON.stringify(run.verdict));
      return { untampered, verdict: run.verdict };
    });
    await controlStep("control: a stubbed proof is never counted as a browser proof, even for a correct plan", async () => {
      const claimed: LocatorProofResult = { schemaVersion: 1, outcome: "proven", code: "PROVEN", compiled: true, intent: "passed", gates: { policy: "pass", buildable: "pass", unique: "pass", sameElement: "pass" }, scope: "compatible", candidateMatchCount: 1, baselineMatchCount: 1, pendingEligible: true };
      // The stub `verify:ai-locator-upgrade-live` uses: stored for replay, proven by nothing.
      const unavailable: LocatorProofResult = { schemaVersion: 1, outcome: "unprovable-now", code: "PAGE_UNAVAILABLE", compiled: true, intent: "passed", gates: { policy: "not-run", buildable: "not-run", unique: "not-run", sameElement: "not-run" }, scope: "compatible", pendingEligible: true };
      const verdicts = [];
      for (const stub of [claimed, unavailable]) {
        const run = await control(archive, [PLAN.archive], () => async () => stub);
        if (run.result.outcome !== "accepted" || run.verdict.browserProven || !run.verdict.problems.includes("NO_REAL_PROOF")) throw new Error(`${stub.code}: ${JSON.stringify(run.verdict)}`);
        verdicts.push({ stub: stub.code, verdict: run.verdict });
      }
      return verdicts;
    });
    await controlStep("control: a second attempt that does not carry the first attempt's real refusal is caught", async () => {
      const run = await control(twins, [PLAN.remove, PLAN.removeExact], (page, step, proofs) => realProof(twins, page, step, proofs));
      const genuine = attemptViolations(run.input, run.result, run.calls, run.proofs);
      if (run.result.outcome !== "attempts-exhausted" || run.calls.length !== 2 || genuine.length > 0) throw new Error(`the genuine job: ${JSON.stringify({ result: run.result, genuine })}`);
      const refusal = `refused ${buildAttemptFeedback([run.result.attempts[0]])}`;
      const withoutRefusal = run.calls.map((call, index) =>
        index === 0 ? call : { ...call, request: { ...call.request, prompt: { ...call.request.prompt, fields: call.request.prompt.fields.map((f) => ({ ...f, text: (f.text ?? "").split("\n").filter((line) => line !== refusal).join("\n") })) } } }
      );
      const misrecorded = { ...run.result, attempts: run.result.attempts.map((a, i) => (i === 0 ? { ...a, code: "WRONG_ELEMENT" } : a)) };
      const mutations = {
        feedbackDropped: attemptViolations(run.input, run.result, withoutRefusal, run.proofs),
        feedbackNotTheRealOutcome: attemptViolations(run.input, misrecorded, run.calls, run.proofs),
        secondAttemptSkipped: attemptViolations(run.input, run.result, run.calls.slice(0, 1), run.proofs)
      };
      if (!mutations.feedbackDropped.includes("ATTEMPT_2_DOES_NOT_CARRY_THE_REFUSAL")) throw new Error(JSON.stringify(mutations));
      if (!mutations.feedbackNotTheRealOutcome.includes("ATTEMPT_1_RECORD_IS_NOT_ITS_OUTCOME")) throw new Error(JSON.stringify(mutations));
      if (!mutations.secondAttemptSkipped.includes("ATTEMPT_2_MISSING")) throw new Error(JSON.stringify(mutations));
      return { refusals: run.result.attempts.map((a) => `${a.stage}:${a.code}`), mutations };
    });

    if (controlsFailed > 0) {
      await api.step("the real model is not judged, because a control failed", () => {
        throw new Error(`${controlsFailed} control(s) failed`);
      });
      return;
    }

    // ── The real model over the labelled set ────────────────────────────────────────────────────────
    const results: Array<{ sc: Scenario; verdict: Verdict; calls: number; refusals: string[]; inferMs: number[] }> = [];
    for (const sc of SCENARIOS) {
      await api.step(`${sc.id}: ${sc.covers}`, async () => {
        const captured = await capture(sc);
        const step = sc.mode === "repair" ? REPAIR_STEP : captured.step;
        const flowId = `flow-${sc.id}`;
        const page = await freshPage();
        try {
          // The fixture is what the scenario says it is, measured on the page rather than assumed.
          const quality = classifyLocatorQuality(step.locator)?.class ?? null;
          let anchor: RepairIdentityAnchor | undefined;
          if (sc.id === "multiple-matches" && quality !== "guarded-positional") throw new Error(`Archive was captured as ${quality}, not a guarded position`);
          if (sc.id === "impossible" && ((await page.getByRole("button", { name: "Remove", exact: true }).count()) !== 2 || quality !== "guarded-positional")) throw new Error(`the twins are not two identical, positionally guarded controls (${quality})`);
          if (sc.id === "scope" && (await page.getByRole("button", { name: "Edit address", exact: true }).count()) !== 2) throw new Error("Edit address is not ambiguous without its region");
          if (sc.mode === "repair") {
            // The identity a repair proves against is what a REAL resolve recorded, before the break.
            const factory = new LocatorFactory(page, { recoveryStore: recovery, scope: { scenarioId: "quality", flowId } });
            if ((await (await factory.resolve(step)).count()) !== 1) throw new Error("the saved locator does not resolve before the break");
            const scopeKey = factory.replayProofMemory(step)?.scopeKey;
            anchor = resolveRepairAnchor(step, { recovery: scopeKey ? await recovery.get(scopeKey) : undefined });
            if (anchor?.source !== "recovery-memory") throw new Error(`no recorded identity to repair against: ${anchor?.source ?? "none"}`);
          }
          await sc.prepare?.(page);
          if (sc.mode === "repair" && ((await page.getByTestId("lu-repair-save").count()) !== 0 || (await page.getByRole("button", { name: "Save draft", exact: true }).count()) !== 1)) {
            throw new Error("the break did not leave the saved locator dead and the element present");
          }

          const before = ctx.jobs.length;
          const deadlinesBefore = ctx.deadlines.length;
          const proofs: Proof[] = [];
          const started = Date.now();
          const run = await runJob(sc, step, flowId, { submit: ctx.submit, cancel: (id) => ctx.service.cancel(id) }, realProof(sc, page, step, proofs, { context: captured.context, anchor }), captured.context);
          const elapsedMs = Date.now() - started;
          const calls: Call[] = ctx.jobs.slice(before);
          const deadlines = ctx.deadlines.slice(deadlinesBefore);
          const rebuilt = calls.map((call, index) => locatorAttemptJob(run.input, run.result.attempts.slice(0, index), call.request.requestId));
          const sameRequest = calls.every((call, index) => JSON.stringify([call.request.prompt, call.request.schema, call.request.maxOutputTokens]) === JSON.stringify([rebuilt[index].prompt, rebuilt[index].schema, rebuilt[index].maxOutputTokens]));
          const violations = attemptViolations(run.input, run.result, calls, proofs);
          const verdict = await judge(sc, run.result, proofs, flowId, step.id, anchor);
          const savedLocator = (await flows.get(flowId))?.nodes.find((node) => node.id === step.id)?.locator;
          // A pending candidate never executes: the saved locator and its alternatives are what the step had.
          const untouched =
            savedLocator?.strategy === step.locator?.strategy &&
            savedLocator?.value === step.locator?.value &&
            JSON.stringify(savedLocator?.alternatives ?? []) === JSON.stringify(step.locator?.alternatives ?? []);
          const prompts = calls.map((call) => buildAiPrompt(call.request.prompt, new SemanticRedactor(), PROMPT_NONCE));
          const models = calls.map((call, index) => {
            const prompt = prompts[index];
            return { ...measured(call.outcome, call.request.maxOutputTokens), shape: call.outcome.status === "ok" && prompt.ok ? planShape(call.outcome.value, prompt.user) : null };
          });
          const summary = {
            baselineClass: quality,
            outcome: run.result.outcome,
            code: run.result.code,
            attemptsUsed: run.result.attemptsUsed,
            calls: calls.length,
            refusals: run.result.attempts.map((a) => `${a.stage}:${a.code}${a.field ? `@${a.field}` : ""}`),
            proofs: proofs.map((p) => ({ attempt: p.attempt, code: p.result.code, gates: p.result.gates, candidateMatchCount: p.result.candidateMatchCount, ...(p.unsynchronized ? { unsynchronized: p.unsynchronized } : {}) })),
            verdict,
            violations,
            sameRequest,
            untouched,
            hostDeadlinesMs: deadlines,
            elapsedMs,
            models
          };

          if (calls.length === 0 || !calls.every((call) => answeredInTime(call.outcome))) throw new Error(`not every attempt was answered in time: ${JSON.stringify(summary)}`);
          if (deadlines.length !== calls.length || !deadlines.every((ms) => ms === LOCATOR_ATTEMPT_LIMITS.timeoutMs)) throw new Error(`the inferences were not each given ${LOCATOR_ATTEMPT_LIMITS.timeoutMs} ms: ${JSON.stringify(summary)}`);
          if (!sameRequest) throw new Error(`the product sent a request other than locatorAttemptJob's: ${JSON.stringify(summary)}`);
          if (violations.length > 0 || !untouched || verdict.problems.length > 0 || verdict.falseTarget) throw new Error(JSON.stringify(summary));
          if (sc.impossible && (run.result.outcome === "accepted" || calls.length !== 2)) throw new Error(`the impossible case must end refused after its second attempt: ${JSON.stringify(summary)}`);
          if (sc.dynamic && proofs.some((p) => !p.unsynchronized?.whileLoading || p.unsynchronized.outcome === "proven")) throw new Error(`a proof taken mid-render was proven, or was not taken mid-render: ${JSON.stringify(summary)}`);
          results.push({
            sc,
            verdict,
            calls: calls.length,
            refusals: summary.refusals,
            inferMs: models.map((m) => ("inferMs" in m ? m.inferMs : undefined)).filter((ms): ms is number => typeof ms === "number")
          });
          return summary;
        } finally {
          await closePage(page);
        }
      });
    }

    await api.step("the labelled set: false-target = 0, the impossible case guarded, and at least one real plan browser-proven", () => {
      const solvable = SCENARIOS.filter((s) => !s.impossible).length;
      const reasons: Record<string, number> = {};
      for (const r of results) for (const refusal of r.refusals) reasons[refusal.split("@")[0]] = (reasons[refusal.split("@")[0]] ?? 0) + 1;
      const inferMs = results.flatMap((r) => r.inferMs);
      const quality = {
        scenarios: results.length,
        acceptedOfSolvable: `${results.filter((r) => !r.sc.impossible && r.verdict.accepted).length}/${solvable}`,
        browserProven: results.filter((r) => r.verdict.browserProven).map((r) => r.sc.id),
        falseTargets: results.filter((r) => r.verdict.falseTarget).length,
        impossibleAccepted: results.filter((r) => r.sc.impossible && r.verdict.accepted).length,
        jobsWithASecondAttempt: results.filter((r) => r.calls > 1).map((r) => r.sc.id),
        rejectionReasons: reasons,
        modelCalls: inferMs.length,
        inferMs: { min: Math.min(...inferMs), max: Math.max(...inferMs), total: inferMs.reduce((a, b) => a + b, 0) },
        perScenario: Object.fromEntries(results.map((r) => [r.sc.id, r.verdict.accepted ? `accepted:${r.verdict.proof}` : "refused"]))
      };
      api.record("quality", quality);
      if (results.length !== SCENARIOS.length) throw new Error(`${results.length} of ${SCENARIOS.length} scenarios completed`);
      if (quality.falseTargets !== 0 || quality.impossibleAccepted !== 0 || quality.browserProven.length === 0) throw new Error(JSON.stringify(quality));
      return quality;
    });
  } finally {
    await ctx.service.shutdown();
    api.record("counters", (await ctx.service.status()).counters);
    await browser.close().catch(() => undefined);
    fs.rmSync(work, { recursive: true, force: true });
  }
}
