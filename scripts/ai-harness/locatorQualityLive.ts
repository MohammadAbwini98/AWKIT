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
 * D1 (owner decision A+B, 2026-09-24) has its own labelled set on /recorder-lab/element-spy, run and reported
 * apart (`verify:ai-locator-quality-live-d1`) so the set above and its evidence are unchanged: a duplicate Call
 * told apart only by its list item's stable test id (A) or authored name (B), and two controls with no approved
 * identity — a record-keyed test id with an email name, and the INV-2002 row named only by its cells — which
 * must never reach a request, so nothing may be accepted for them. Each call is recorded (contract, strategy,
 * a bounded scope category, refusal, proof, matches) and each case classed success, refused, inconclusive or
 * fail. No D1 acceptance rate is approved, so none is applied: a run that proves no D1 candidate is
 * INCONCLUSIVE. D1 controls first show each fixture is what its label says, a scripted offered scope is proven
 * and judged the inspected element, a sibling's, an absent, a withheld and a row-content scope are each refused
 * as not offered before the browser, a misattributed container through a bypassed gate is caught, and nothing
 * unproven or unanswered is classed a success. `verify:ai-locator-quality-controls` runs every control, no model.
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
  unofferedScopeField,
  type LocatorAttemptResult,
  type LocatorUpgradeAttemptDeps,
  type LocatorUpgradeAttemptInput,
  type LocatorUpgradeProvider
} from "@src/ai/locatorUpgradeAttempts";
import { annotatePendingUpgrade, locatorCandidateDigest } from "@src/ai/pendingUpgrade";
import { locatorContainerChain, type FlowProfile, type FlowStep } from "@src/profiles/FlowProfile";
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
  /** Served page: the locator-upgrade lab unless `spy` (/recorder-lab/element-spy, whose controls report `data-spy` into `spy-last`). */
  lab?: "spy";
  d1?: D1Label;
}

/** A D1 case's label, checked on the page and in the request the product builds before any model call. */
interface D1Label {
  /** The duplicated control, unscoped: the page must hold two or more, and the product's proof must refuse it as not unique. */
  target: { strategy: "role"; value: "button"; name: string; exact: true };
  /** The approved scope the request must offer, as the ready object it shows; none when the element has no approved identity. */
  offers?: { kind: string; strategy: string; value: string };
  /** Fixture constants no request may carry: a record key, a sensitive name, the record's own text. Checked, never recorded. */
  withheld: readonly string[];
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

const CALL = { strategy: "role", value: "button", name: "Call", exact: true } as const;
/**
 * D1's labelled set, asked for from Element Spy (L3 §1). The four Call buttons are identical; only the list
 * item says which is which. The two cases with no approved identity end refused, as INV-2002 did live.
 */
const D1_SCENARIOS: readonly Scenario[] = [
  {
    id: "d1-test-id",
    covers: "D1 A: a duplicate Call told apart only by its list item's stable test id",
    name: "Call primary contact",
    mode: "upgrade",
    userRequested: true,
    lab: "spy",
    intended: "call-primary",
    click: (p) => p.getByTestId("slot-primary").getByRole("button", { name: "Call" }).click(),
    d1: { target: CALL, offers: { kind: "listItem", strategy: "testId", value: "slot-primary" }, withheld: ["Alice Smith"] }
  },
  {
    id: "d1-authored-name",
    covers: "D1 B: a duplicate Call told apart only by its list item's authored name",
    name: "Call night shift contact",
    mode: "upgrade",
    userRequested: true,
    lab: "spy",
    intended: "call-night",
    click: (p) => p.getByRole("listitem", { name: "Night shift" }).getByRole("button", { name: "Call" }).click(),
    d1: { target: CALL, offers: { kind: "listItem", strategy: "label", value: "Night shift" }, withheld: ["contact-carol-white", "Carol White"] }
  },
  {
    id: "d1-record-key",
    covers: "D1 excluded: a duplicate Call whose item's only identities are a record-keyed test id and an email name",
    name: "Call listed contact",
    mode: "upgrade",
    userRequested: true,
    lab: "spy",
    intended: "call-dan",
    impossible: true,
    click: (p) => p.getByTestId("contact-2004").getByRole("button", { name: "Call" }).click(),
    d1: { target: CALL, withheld: ["contact-2004", "dan@example.com", "Dan Brown"] }
  },
  {
    id: "d1-computed-row",
    covers: "D1 excluded: the INV-2002 Edit, whose row is named only by its cells",
    name: "Edit invoice row",
    mode: "upgrade",
    userRequested: true,
    lab: "spy",
    intended: "edit-2002",
    impossible: true,
    click: (p) => p.getByRole("row", { name: /INV-2002/ }).getByRole("button", { name: "Edit" }).click(),
    d1: { target: { ...CALL, name: "Edit" }, withheld: ["INV-2002"] }
  }
];
const d1Case = (id: string): Scenario & { d1: D1Label } => D1_SCENARIOS.find((s) => s.id === id) as Scenario & { d1: D1Label };

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
    // D1: an upgrade scope the request did not offer is refused before the browser, and before the duplicate check.
    const unoffered = (input.mode ?? "upgrade") === "upgrade" ? unofferedScopeField(evaluated.context, input.upgradeContext) : undefined;
    if (unoffered) return { stage: "intent", code: "SCOPE_NOT_OFFERED", field: unoffered };
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
    if (truth && truth.stage !== "proof" && truth.stage !== "accepted" && proofs.some((p) => p.attempt === attempt)) violations.push(`ATTEMPT_${attempt}_REFUSED_BEFORE_THE_BROWSER_YET_PROVEN`);
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

/** A proof that claims PROVEN without any browser having run: what a stubbed proof hands the job. */
const CLAIMED_PROOF: LocatorProofResult = { schemaVersion: 1, outcome: "proven", code: "PROVEN", compiled: true, intent: "passed", gates: { policy: "pass", buildable: "pass", unique: "pass", sameElement: "pass" }, scope: "compatible", candidateMatchCount: 1, baselineMatchCount: 1, pendingEligible: true };

const requestText = (request: AiJobRequest): string => request.prompt.fields.map((field) => field.text ?? "").join("\n");

export type D1Class = "success" | "refused" | "inconclusive" | "fail";

/** One model call of a D1 case: codes, enums, a bounded category and counts, never model or page text. */
interface D1Call {
  contract: string;
  strategy: unknown;
  scope: string | null;
  refusal: string | null;
  proof: string | null;
  matches: number | null;
}

/** Requests, replies, attempts spent and accepted candidates are counted apart: none is assumed to equal another. */
interface D1Result {
  id: string;
  covers: string;
  expected: "success" | "refused";
  modelIds: string[];
  requests: number;
  responses: number;
  attemptsUsed: number;
  consumedRefusals: number;
  acceptedCandidates: number;
  perCall: D1Call[];
  matches: number | null;
  matchedIntended: boolean;
  falseTargetProposed: boolean;
  falseTargetAccepted: boolean;
  leaked: boolean;
  class: D1Class;
}

/**
 * One D1 case's class. Only a candidate browser-proven and confirmed by the page is a success. A request the
 * model never answered is inconclusive, never a refusal or a success, and so is an accepted candidate the
 * browser did not prove. A false target, a withheld identity in a request, or anything accepted where no
 * approved identity exists fails the case.
 */
export function classifyD1Case(c: { impossible: boolean; requests: number; answered: number; accepted: boolean; browserProven: boolean; falseTarget: boolean; leaked: boolean }): D1Class {
  if (c.leaked || c.falseTarget || (c.impossible && c.accepted)) return "fail";
  if (c.requests === 0 || c.answered < c.requests) return "inconclusive";
  if (!c.accepted) return "refused";
  return c.browserProven ? "success" : "inconclusive";
}

const PAGE_PLACES: Readonly<Record<string, string>> = { WRONG_ELEMENT: "sibling", CANDIDATE_NO_MATCH: "absent", CANDIDATE_NOT_UNIQUE: "ambiguous", PROVEN: "withheld-own" };

/**
 * A plan's container scopes as one bounded category, never a value: `none`, `structural` (nameless roles
 * only), `offered` (every named scope one the request offered), `row-content` (a `hasText`, D1 option C), or
 * `not-offered:<where>`, placed by the product's own proof asked directly (`page`): the scope finds a
 * sibling, nothing, several, or the element itself through an identity D1 withholds.
 */
export async function scopeCategory(value: unknown, input: LocatorUpgradeAttemptInput, page: (plan: unknown) => Promise<string>): Promise<string> {
  const baseline = input.step.locator!;
  const evaluated = evaluateLocatorPlan(value, { boundValues: input.boundValues, baseline, captured: baseline.context, policy: input.policy });
  if (!evaluated.ok) return "not-compiled";
  const chain = locatorContainerChain(evaluated.context);
  if (chain.length === 0) return "none";
  if (chain.some((scope) => scope.hasText)) return "row-content";
  if (!unofferedScopeField(evaluated.context, input.upgradeContext)) return chain.every((scope) => scope.strategy === "role" && scope.name === undefined) ? "structural" : "offered";
  const code = await page(value);
  return `not-offered:${PAGE_PLACES[code] ?? code}`;
}

/**
 * `controlsOnly` (`verify:ai-locator-quality-controls`): the scripted controls alone, under plain tsx. No
 * runtime, pack, host or model call: they show the judge and the fixtures are sound, never model quality.
 */
export async function runLocatorQualityLive(api: FeatureLiveApi, options: { lab?: string; controlsOnly?: boolean } = {}): Promise<void> {
  const lab = options.lab ?? process.env.AWKIT_HARNESS_LAB_URL;
  if (!lab) throw new Error("AWKIT_HARNESS_LAB_URL is not set");
  const ctx = options.controlsOnly ? undefined : observed(api);
  api.record("deadlineMs", LOCATOR_ATTEMPT_LIMITS.timeoutMs);
  if (ctx) await hello(api, ctx);
  // The labelled set a live run judges (`AWKIT_HARNESS_SET`, `--set d1`); the controls alone run every control.
  const set = options.controlsOnly ? "controls" : process.env.AWKIT_HARNESS_SET === "d1" ? "d1" : "original";

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-l1-quality-"));
  const flows = new JsonProfileStore<FlowProfile>({ folder: path.join(work, "flows") });
  const recovery = new FileLocatorRecoveryStore(path.join(work, "recovery"));
  const browser = await chromium.launch({ headless: true });

  /** A scenario's page, and how that page says which element was acted on. */
  const identity = (sc: Scenario) =>
    sc.lab === "spy" ? { url: new URL("/recorder-lab/element-spy", lab).href, attribute: "data-spy", result: "spy-last" } : { url: lab, attribute: "data-lu", result: "lu-result" };
  const freshPage = async (url = lab): Promise<Page> => {
    const page = await (await browser.newContext()).newPage();
    page.setDefaultTimeout(3_000);
    await page.goto(url);
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
      await page.goto(identity(sc).url);
      if (!sc.lab) await reportsReady(page);
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

  const inputOf = (sc: Scenario, step: FlowStep, requestId: string, context?: UpgradeContext): LocatorUpgradeAttemptInput => ({
    requestId,
    mode: sc.mode,
    step,
    boundValues: BOUND_VALUES,
    ...(context ? { upgradeContext: context } : {}),
    ...(sc.userRequested ? { userRequested: true } : {})
  });

  const runJob = async (sc: Scenario, step: FlowStep, flowId: string, ai: LocatorUpgradeProvider, prove: LocatorUpgradeAttemptDeps["prove"], context?: UpgradeContext) => {
    await flows.delete(flowId).catch(() => undefined);
    await flows.create({ id: flowId, name: sc.name, version: 1, nodes: [step], edges: [] });
    const input = inputOf(sc, step, `quality-${flowId}`, context);
    const result = await runLocatorUpgradeAttempts(input, { ai, prove, annotate: (pending) => annotatePendingUpgrade(flows, flowId, step.id, pending) });
    return { input, result };
  };

  /** What the product's own proof says of a plan on a fresh page, whatever the loop's rules would do with it. Never acts. */
  const pageSays = async (sc: Scenario, step: FlowStep, context: UpgradeContext | undefined, plan: unknown): Promise<string> => {
    const page = await freshPage(identity(sc).url);
    try {
      return (await proveLocatorPlan(page, step, plan, { boundValues: BOUND_VALUES, upgradeContext: context })).code;
    } finally {
      await closePage(page);
    }
  };

  /**
   * Why a D1 case is not the fixture its label says, measured on the page and in the request the product
   * builds for it; empty when it is. Every check runs, so a broken fixture names each thing it broke.
   */
  const d1Preconditions = async (sc: Scenario, page: Page, step: FlowStep, context: UpgradeContext): Promise<string[]> => {
    const d1 = sc.d1!;
    const problems: string[] = [];
    // Two or more identical controls, the intended element one of them: a count alone passes a renamed target.
    const twins = page.getByRole("button", { name: d1.target.name, exact: true });
    const { attribute } = identity(sc);
    const intendedAmong = await twins.evaluateAll((elements, [attr, id]) => elements.filter((el) => el.getAttribute(attr) === id).length, [attribute, sc.intended] as const);
    if ((await twins.count()) < 2 || intendedAmong !== 1) problems.push("NOT_DUPLICATE");
    const unscoped = await proveLocatorPlan(page, step, { version: 1, target: d1.target, scopes: [] }, { boundValues: BOUND_VALUES, upgradeContext: context });
    if (unscoped.code !== "CANDIDATE_NOT_UNIQUE") problems.push(`UNSCOPED_NOT_AMBIGUOUS:${unscoped.code}`);
    const request = requestText(locatorAttemptJob(inputOf(sc, step, "d1-precondition", context), [], "d1-precondition.a1"));
    if (d1.offers && !request.split("\n").some((line) => line.startsWith("container: ") && line.includes(` scope ${JSON.stringify(d1.offers)}`))) problems.push("SCOPE_NOT_IN_REQUEST");
    if (d1.withheld.some((text) => request.includes(text))) problems.push("WITHHELD_IN_REQUEST");
    return problems;
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

    const { url, attribute, result: reported } = identity(sc);
    const page = await freshPage(url);
    let matches: number | null = null;
    let selected: string | null = null;
    let recheck: string | null = null;
    let clicked: string | null = null;
    try {
      await sc.prepare?.(page);
      const locator = await new LocatorFactory(page).locateCandidate(pending.candidate, pending.context).catch(() => null);
      matches = locator ? await locator.count().catch(() => 0) : null;
      if (locator && matches === 1) selected = await locator.getAttribute(attribute).catch(() => null);
      if (saved) {
        recheck = (
          sc.mode === "repair"
            ? await proveRepairPlan(page, saved, planFromCandidate(pending.candidate, pending.context), { boundValues: BOUND_VALUES, anchor })
            : await replayPendingUpgrade(page, saved, { boundValues: BOUND_VALUES })
        ).code;
      }
      // Proof never acts; the verifier does, on its own page, so the page itself says which element it was.
      if (locator && matches === 1 && (await locator.click().then(() => true, () => false))) clicked = await page.getByTestId(reported).textContent();
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

  /**
   * A control job over a scripted provider, on a fresh lab page. A D1 job carries its capture, as Element Spy's
   * does (the loop's offered-scope rule reads it); `forge` hands it a tampered one instead.
   */
  const control = async (
    sc: Scenario,
    plans: unknown[],
    prove: (page: Page, step: FlowStep, proofs: Proof[], context?: UpgradeContext) => LocatorUpgradeAttemptDeps["prove"],
    forge: (captured: UpgradeContext) => UpgradeContext = (captured) => captured
  ) => {
    const captured = await capture(sc);
    const { step } = captured;
    const context = sc.d1 ? forge(captured.context) : undefined;
    const flowId = `control-${sc.id}-${Math.random().toString(16).slice(2, 8)}`;
    const page = await freshPage(identity(sc).url);
    const calls: Call[] = [];
    const proofs: Proof[] = [];
    try {
      const run = await runJob(sc, step, flowId, scripted(plans, calls), prove(page, step, proofs, context), context);
      return { ...run, calls, proofs, step, context, verdict: await judge(sc, run.result, proofs, flowId, step.id) };
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
    // A live run takes its own set's controls; the controls alone run both groups.
    const controlStep = async <T>(label: string, fn: () => Promise<T>, group: "original" | "d1" = "original"): Promise<T | undefined> => {
      if (set !== "controls" && set !== group) return undefined;
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
      const claimed = CLAIMED_PROOF;
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

    // ── D1 controls: the fixtures are what their labels say, and each broken behavior is caught ─────
    const primary = d1Case("d1-test-id");
    const night = d1Case("d1-authored-name");
    const dan = d1Case("d1-record-key");
    const invoice = d1Case("d1-computed-row");
    const EDIT = invoice.d1.target;
    const plan = (target: object, scopes: object[] = []) => ({ version: 1, target, scopes });
    const listItem = (value: string) => ({ kind: "listItem", strategy: "testId", value });
    const withContainer = (context: UpgradeContext, match: (c: UpgradeContext["containers"][number]) => boolean, change: (c: UpgradeContext["containers"][number]) => UpgradeContext["containers"][number]): UpgradeContext => ({
      ...context,
      containers: context.containers.map((c) => (match(c) ? change(c) : c))
    });

    await controlStep(
      "D1 control: each case's fixture is what its label says, and each way of breaking one is caught by the check it targets alone",
      async () => {
        const check = async (sc: Scenario, forge: (c: UpgradeContext) => UpgradeContext = (c) => c, alterPage?: (page: Page) => Promise<unknown>) => {
          const { step, context } = await capture(sc);
          const page = await freshPage(identity(sc).url);
          try {
            await alterPage?.(page);
            return await d1Preconditions(sc, page, step, forge(context));
          } finally {
            await closePage(page);
          }
        };
        const valid: Record<string, string[]> = {};
        for (const sc of D1_SCENARIOS) valid[sc.id] = await check(sc);
        if (Object.values(valid).some((problems) => problems.length > 0)) throw new Error(`a D1 fixture is not what its label says: ${JSON.stringify(valid)}`);
        // Exactly the targeted problem, so a mutation is never caught by some unrelated fixture error instead.
        const mutations = {
          siblingsRemoved: await check(primary, undefined, (page) =>
            page.evaluate(() => document.querySelectorAll('[data-testid="spy-contacts"] li:not([data-testid="slot-primary"])').forEach((item) => item.remove()))
          ),
          // Three identical Calls remain; only the inspected one is no longer among them.
          targetRenamed: await check(primary, undefined, (page) =>
            page.evaluate(() => {
              const button = document.querySelector('[data-spy="call-primary"]');
              if (button) button.textContent = "Call primary";
            })
          ),
          offeredScopeDropped: await check(primary, (c) => withContainer(c, (k) => k.testId === "slot-primary", ({ testId: _dropped, ...k }) => k)),
          recordKeyOffered: await check(dan, (c) => withContainer(c, (k) => k.kind === "listItem", (k) => ({ ...k, testId: "contact-2004" }))),
          computedRowNameAuthored: await check(invoice, (c) => withContainer(c, (k) => k.kind === "row", (k) => ({ ...k, authoredName: true })))
        };
        const expected = {
          siblingsRemoved: ["NOT_DUPLICATE", "UNSCOPED_NOT_AMBIGUOUS:PROVEN"],
          // The unscoped proof fires only because the recorded baseline loses the renamed element; NOT_DUPLICATE
          // names the defect itself, and would still fire with a baseline that does not encode the name.
          targetRenamed: ["NOT_DUPLICATE", "UNSCOPED_NOT_AMBIGUOUS:TARGET_MISSING"],
          offeredScopeDropped: ["SCOPE_NOT_IN_REQUEST"],
          recordKeyOffered: ["WITHHELD_IN_REQUEST"],
          computedRowNameAuthored: ["WITHHELD_IN_REQUEST"]
        };
        if (JSON.stringify(mutations) !== JSON.stringify(expected)) throw new Error(`a broken fixture was not caught by its own check: ${JSON.stringify(mutations)}`);
        return { valid, mutations };
      },
      "d1"
    );

    await controlStep(
      "D1 control: the offered scope, proposed by a scripted provider, is proven in real Chromium and judged the inspected element",
      async () => {
        const out: Record<string, unknown> = {};
        for (const sc of [primary, night]) {
          const proposal = plan(sc.d1.target, [sc.d1.offers!]);
          const run = await control(sc, [proposal], (page, step, proofs, context) => realProof(sc, page, step, proofs, { context }));
          const violations = attemptViolations(run.input, run.result, run.calls, run.proofs);
          const scope = await scopeCategory(proposal, run.input, (p) => pageSays(sc, run.step, run.context, p));
          const ok =
            run.result.outcome === "accepted" && run.calls.length === 1 && run.proofs.length === 1 && run.verdict.browserProven && run.verdict.problems.length === 0 &&
            run.verdict.selected === sc.intended && run.verdict.clicked === sc.intended && violations.length === 0 && scope === "offered";
          if (!ok) throw new Error(`${sc.id}: ${JSON.stringify({ outcome: run.result.outcome, calls: run.calls.length, proofs: run.proofs.map((p) => p.result.code), verdict: run.verdict, violations, scope })}`);
          out[sc.id] = { proof: run.proofs[0].result.code, scope, verdict: run.verdict };
        }
        return out;
      },
      "d1"
    );

    await controlStep(
      "D1 control: a sibling's, an absent, a withheld own and a row-content scope are each refused as not offered before the browser, and the page tells them apart",
      async () => {
        // Per case: the scripted plans (the last repeats), the field each refusal names, what the product's proof
        // says when asked directly, and the category the report would give each plan.
        const cases = [
          { sc: primary, plans: [plan(CALL, [listItem("slot-backup")]), plan(CALL, [listItem("slot-tertiary")])], fields: ["scopes.0.value", "scopes.0.value"], page: ["WRONG_ELEMENT", "CANDIDATE_NO_MATCH"], scope: ["not-offered:sibling", "not-offered:absent"] },
          { sc: night, plans: [plan(CALL, [listItem("contact-carol-white")]), plan(CALL, [listItem("slot-primary")])], fields: ["scopes.0.value", "scopes.0.value"], page: ["PROVEN", "WRONG_ELEMENT"], scope: ["not-offered:withheld-own", "not-offered:sibling"] },
          { sc: dan, plans: [plan(CALL, [listItem("contact-2004")])], fields: ["scopes.0.value", "scopes.0.value"], page: ["PROVEN", "PROVEN"], scope: ["not-offered:withheld-own", "not-offered:withheld-own"] },
          {
            sc: invoice,
            plans: [plan(EDIT, [{ kind: "tableRow", strategy: "role", value: "row", hasText: "INV-2002" }]), plan(EDIT, [{ kind: "tableRow", strategy: "role", value: "row", name: "Invoice INV-2002" }])],
            fields: ["scopes.0.hasText", "scopes.0.name"],
            page: ["PROVEN", "PROVEN"],
            scope: ["row-content", "not-offered:withheld-own"]
          }
        ];
        const out: Record<string, unknown> = {};
        let primaryRun: Awaited<ReturnType<typeof control>> | undefined;
        for (const c of cases) {
          const run = await control(c.sc, c.plans, (page, step, proofs, context) => realProof(c.sc, page, step, proofs, { context }));
          const asked = [0, 1].map((i) => c.plans[Math.min(i, c.plans.length - 1)]);
          const pageCodes: string[] = [];
          const scopes: string[] = [];
          for (const p of asked) {
            pageCodes.push(await pageSays(c.sc, run.step, run.context, p));
            scopes.push(await scopeCategory(p, run.input, (q) => pageSays(c.sc, run.step, run.context, q)));
          }
          const refusals = run.result.attempts.map((a) => `${a.stage}:${a.code}@${a.field ?? ""}`);
          const detail = { outcome: run.result.outcome, calls: run.calls.length, proofs: run.proofs.length, refusals, violations: attemptViolations(run.input, run.result, run.calls, run.proofs), page: pageCodes, scope: scopes, stored: run.verdict.problems };
          const ok =
            run.result.outcome === "attempts-exhausted" && run.calls.length === 2 && run.proofs.length === 0 &&
            JSON.stringify(refusals) === JSON.stringify(c.fields.map((f) => `intent:SCOPE_NOT_OFFERED@${f}`)) &&
            detail.violations.length === 0 && !run.verdict.accepted && run.verdict.problems.length === 0 &&
            JSON.stringify(pageCodes) === JSON.stringify(c.page) && JSON.stringify(scopes) === JSON.stringify(c.scope);
          if (!ok) throw new Error(`${c.sc.id}: ${JSON.stringify(detail)}`);
          out[c.sc.id] = detail;
          if (c.sc === primary) primaryRun = run;
        }
        // The accounting check itself: a refused plan that reached the browser anyway, and a record that is not
        // the refusal the plan earned, are each caught.
        const run = primaryRun!;
        const mutations = {
          provenAnyway: attemptViolations(run.input, run.result, run.calls, [{ attempt: 1, result: { ...CLAIMED_PROOF, outcome: "rejected", code: "WRONG_ELEMENT" } }]),
          misrecorded: attemptViolations(run.input, { ...run.result, attempts: run.result.attempts.map((a, i) => (i === 0 ? { ...a, stage: "proof" as const, code: "WRONG_ELEMENT" } : a)) }, run.calls, run.proofs)
        };
        if (!mutations.provenAnyway.includes("ATTEMPT_1_REFUSED_BEFORE_THE_BROWSER_YET_PROVEN") || !mutations.misrecorded.includes("ATTEMPT_1_RECORD_IS_NOT_ITS_OUTCOME")) throw new Error(JSON.stringify(mutations));
        return { ...out, mutations };
      },
      "d1"
    );

    await controlStep(
      "D1 control: a sibling's or an invented container, offered as if it were the item's own and let through a bypassed gate, is caught by the judge",
      async () => {
        // As if the capture had misattributed the item's container: the request offers that id, so the loop admits it.
        const misattributed = (value: string) => (c: UpgradeContext) => withContainer(c, (k) => k.testId === "slot-primary", (k) => ({ ...k, testId: value }));
        const sibling = await control(primary, [plan(CALL, [listItem("slot-backup")])], (page, step, proofs, context) => realProof(primary, page, step, proofs, { context, tamper: forceProven("WRONG_ELEMENT") }), misattributed("slot-backup"));
        const invented = await control(primary, [plan(CALL, [listItem("slot-tertiary")])], (page, step, proofs, context) => realProof(primary, page, step, proofs, { context, tamper: forceProven("CANDIDATE_NO_MATCH") }), misattributed("slot-tertiary"));
        const detail = { sibling: { untampered: sibling.proofs[0]?.untampered, verdict: sibling.verdict }, invented: { untampered: invented.proofs[0]?.untampered, verdict: invented.verdict } };
        if (detail.sibling.untampered !== "WRONG_ELEMENT" || detail.invented.untampered !== "CANDIDATE_NO_MATCH") throw new Error(`the real proof did not refuse them, so the bypass was never needed: ${JSON.stringify(detail)}`);
        const siblingCaught = sibling.result.outcome === "accepted" && sibling.verdict.falseTarget && !sibling.verdict.browserProven && sibling.verdict.selected === "call-backup" && sibling.verdict.problems.includes("WRONG_ELEMENT");
        const inventedCaught = invented.result.outcome === "accepted" && invented.verdict.falseTarget && !invented.verdict.browserProven && invented.verdict.matches === 0 && invented.verdict.problems.includes("NOT_UNIQUE");
        if (!siblingCaught || !inventedCaught) throw new Error(JSON.stringify(detail));
        return detail;
      },
      "d1"
    );

    await controlStep(
      "D1 control: a case is a success only when its candidate was browser-proven — never an unproven one, an unanswered request, a false target, a leak or an accepted no-identity case",
      async () => {
        const base = { impossible: false, requests: 1, answered: 1, accepted: true, browserProven: true, falseTarget: false, leaked: false };
        const table = {
          proven: classifyD1Case(base),
          acceptedUnproven: classifyD1Case({ ...base, browserProven: false }),
          unanswered: classifyD1Case({ ...base, requests: 2, answered: 1, accepted: false, browserProven: false }),
          noRequest: classifyD1Case({ ...base, requests: 0, answered: 0, accepted: false, browserProven: false }),
          refused: classifyD1Case({ ...base, accepted: false, browserProven: false }),
          falseTarget: classifyD1Case({ ...base, falseTarget: true }),
          leaked: classifyD1Case({ ...base, leaked: true }),
          noIdentityAccepted: classifyD1Case({ ...base, impossible: true }),
          noIdentityRefused: classifyD1Case({ ...base, impossible: true, accepted: false, browserProven: false })
        };
        const expected = { proven: "success", acceptedUnproven: "inconclusive", unanswered: "inconclusive", noRequest: "inconclusive", refused: "refused", falseTarget: "fail", leaked: "fail", noIdentityAccepted: "fail", noIdentityRefused: "refused" };
        if (JSON.stringify(table) !== JSON.stringify(expected)) throw new Error(JSON.stringify(table));
        // The same rule over real jobs: a stubbed proof that claims PROVEN, and a request that timed out.
        const stubbed = await control(primary, [plan(CALL, [primary.d1.offers!])], () => async () => CLAIMED_PROOF);
        const { step, context } = await capture(primary);
        const timedOutCalls: Call[] = [];
        const timingOut: LocatorUpgradeProvider = {
          submit: async (request) => {
            const outcome: AiJobOutcome = { status: "failed", code: "TIMEOUT", yields: 0 };
            timedOutCalls.push({ request, outcome });
            return outcome;
          },
          cancel: () => false
        };
        const timedOut = await runJob(primary, step, `control-timeout-${Math.random().toString(16).slice(2, 8)}`, timingOut, async () => {
          throw new Error("an unanswered request reached the proof");
        }, context);
        const answered = (calls: readonly Call[]) => calls.filter((call) => answeredInTime(call.outcome)).length;
        const real = {
          stubbedProof: classifyD1Case({ impossible: false, requests: stubbed.calls.length, answered: answered(stubbed.calls), accepted: stubbed.verdict.accepted, browserProven: stubbed.verdict.browserProven, falseTarget: stubbed.verdict.falseTarget, leaked: false }),
          timedOut: classifyD1Case({ impossible: false, requests: timedOutCalls.length, answered: answered(timedOutCalls), accepted: timedOut.result.outcome === "accepted", browserProven: false, falseTarget: false, leaked: false })
        };
        const ok = stubbed.result.outcome === "accepted" && stubbed.verdict.problems.includes("NO_REAL_PROOF") && real.stubbedProof !== "success" && timedOut.result.outcome === "provider-unavailable" && timedOutCalls.length === 1 && real.timedOut === "inconclusive";
        if (!ok) throw new Error(JSON.stringify({ real, stubbed: stubbed.verdict, timedOut: timedOut.result.outcome }));
        return { table, real };
      },
      "d1"
    );

    if (controlsFailed > 0) {
      await api.step("the real model is not judged, because a control failed", () => {
        throw new Error(`${controlsFailed} control(s) failed`);
      });
      return;
    }
    if (!ctx) return;

    // ── The real model over the labelled set ────────────────────────────────────────────────────────
    const results: Array<{ sc: Scenario; verdict: Verdict; calls: number; refusals: string[]; inferMs: number[] }> = [];
    const d1Results: D1Result[] = [];
    for (const sc of set === "d1" ? D1_SCENARIOS : SCENARIOS) {
      await api.step(`${sc.id}: ${sc.covers}`, async () => {
        const captured = await capture(sc);
        const step = sc.mode === "repair" ? REPAIR_STEP : captured.step;
        const flowId = `flow-${sc.id}`;
        const page = await freshPage(identity(sc).url);
        try {
          // The fixture is what the scenario says it is, measured on the page rather than assumed.
          const quality = classifyLocatorQuality(step.locator)?.class ?? null;
          let anchor: RepairIdentityAnchor | undefined;
          if (sc.id === "multiple-matches" && quality !== "guarded-positional") throw new Error(`Archive was captured as ${quality}, not a guarded position`);
          if (sc.id === "impossible" && ((await page.getByRole("button", { name: "Remove", exact: true }).count()) !== 2 || quality !== "guarded-positional")) throw new Error(`the twins are not two identical, positionally guarded controls (${quality})`);
          if (sc.id === "scope" && (await page.getByRole("button", { name: "Edit address", exact: true }).count()) !== 2) throw new Error("Edit address is not ambiguous without its region");
          const invalid = sc.d1 ? await d1Preconditions(sc, page, step, captured.context) : [];
          if (invalid.length > 0) throw new Error(`the ${sc.id} fixture is not what its label says: ${invalid.join(", ")}`);
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
          // D1: each call as codes, enums and a bounded scope category, and the case's class. Recorded, not thresholded.
          let d1: D1Result | undefined;
          if (sc.d1) {
            const withheld = sc.d1.withheld;
            const perCall: D1Call[] = [];
            for (const [index, call] of calls.entries()) {
              const record = run.result.attempts.find((a) => a.attempt === index + 1);
              const proof = proofs.find((p) => p.attempt === index + 1)?.result;
              perCall.push({
                contract: call.outcome.status === "ok" ? "pass" : "code" in call.outcome ? call.outcome.code : call.outcome.status,
                strategy: models[index].shape?.strategy ?? null,
                scope: call.outcome.status === "ok" ? await scopeCategory(call.outcome.value, run.input, (plan) => pageSays(sc, step, captured.context, plan)) : null,
                refusal: record ? `${record.stage}:${record.code}` : null,
                proof: proof?.code ?? null,
                matches: proof?.candidateMatchCount ?? null
              });
            }
            const leaked = calls.some((call) => withheld.some((text) => requestText(call.request).includes(text)));
            const responses = calls.filter((call) => answeredInTime(call.outcome)).length;
            d1 = {
              id: sc.id,
              covers: sc.covers,
              expected: sc.impossible ? "refused" : "success",
              modelIds: [...new Set(calls.flatMap((call) => (call.outcome.status === "ok" ? [call.outcome.modelId] : [])))],
              requests: calls.length,
              responses,
              attemptsUsed: run.result.attemptsUsed,
              consumedRefusals: run.result.attempts.filter((a) => a.consumed).length,
              acceptedCandidates: run.result.outcome === "accepted" ? 1 : 0,
              perCall,
              matches: verdict.matches,
              matchedIntended: verdict.selected === sc.intended,
              falseTargetProposed: perCall.some((c) => c.proof === "WRONG_ELEMENT" || c.scope === "not-offered:sibling"),
              falseTargetAccepted: verdict.falseTarget,
              leaked,
              class: classifyD1Case({ impossible: Boolean(sc.impossible), requests: calls.length, answered: responses, accepted: verdict.accepted, browserProven: verdict.browserProven, falseTarget: verdict.falseTarget, leaked })
            };
          }
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
            models,
            ...(d1 ? { d1 } : {})
          };

          if (calls.length === 0 || !calls.every((call) => answeredInTime(call.outcome))) throw new Error(`not every attempt was answered in time: ${JSON.stringify(summary)}`);
          if (deadlines.length !== calls.length || !deadlines.every((ms) => ms === LOCATOR_ATTEMPT_LIMITS.timeoutMs)) throw new Error(`the inferences were not each given ${LOCATOR_ATTEMPT_LIMITS.timeoutMs} ms: ${JSON.stringify(summary)}`);
          if (!sameRequest) throw new Error(`the product sent a request other than locatorAttemptJob's: ${JSON.stringify(summary)}`);
          if (violations.length > 0 || !untouched || verdict.problems.length > 0 || verdict.falseTarget || d1?.class === "fail") throw new Error(JSON.stringify(summary));
          if (sc.impossible && (run.result.outcome === "accepted" || calls.length !== 2)) throw new Error(`the impossible case must end refused after its second attempt: ${JSON.stringify(summary)}`);
          if (sc.dynamic && proofs.some((p) => !p.unsynchronized?.whileLoading || p.unsynchronized.outcome === "proven")) throw new Error(`a proof taken mid-render was proven, or was not taken mid-render: ${JSON.stringify(summary)}`);
          if (d1) {
            d1Results.push(d1);
            return summary;
          }
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

    if (set === "d1") {
      await api.step("D1: the container-scoped cases, measured apart from the labelled set — false-target 0, nothing withheld in any request, the no-identity cases refused", () => {
        const tally = (values: ReadonlyArray<string | null>) => values.reduce<Record<string, number>>((acc, v) => (v === null ? acc : { ...acc, [v]: (acc[v] ?? 0) + 1 }), {});
        const sum = (pick: (r: D1Result) => number) => d1Results.reduce((total, r) => total + pick(r), 0);
        const perCall = d1Results.flatMap((r) => r.perCall);
        const browserProven = d1Results.filter((r) => r.class === "success").map((r) => r.id);
        const d1Quality = {
          cases: d1Results.length,
          perCase: Object.fromEntries(d1Results.map((r) => [r.id, `${r.class} (expected ${r.expected})`])),
          browserProven,
          positivesProven: `${browserProven.length}/${D1_SCENARIOS.filter((s) => !s.impossible).length}`,
          requests: sum((r) => r.requests),
          responses: sum((r) => r.responses),
          attemptsUsed: sum((r) => r.attemptsUsed),
          consumedRefusals: sum((r) => r.consumedRefusals),
          acceptedCandidates: sum((r) => r.acceptedCandidates),
          falseTargetsProposed: d1Results.filter((r) => r.falseTargetProposed).length,
          falseTargetsAccepted: d1Results.filter((r) => r.falseTargetAccepted).length,
          scopes: tally(perCall.map((c) => c.scope)),
          refusals: tally(perCall.map((c) => c.refusal)),
          // No D1 acceptance rate is approved, so none is applied; a run that proved no D1 candidate judged nothing.
          inconclusive: browserProven.length === 0
        };
        api.record("d1Quality", d1Quality);
        if (d1Results.length !== D1_SCENARIOS.length) throw new Error(`${d1Results.length} of ${D1_SCENARIOS.length} D1 cases completed`);
        if (d1Quality.falseTargetsAccepted !== 0 || d1Results.some((r) => r.class === "fail")) throw new Error(JSON.stringify(d1Quality));
        return d1Quality;
      });
      return;
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
    if (ctx) {
      await ctx.service.shutdown();
      api.record("counters", (await ctx.service.status()).counters);
    }
    await browser.close().catch(() => undefined);
    fs.rmSync(work, { recursive: true, force: true });
  }
}
