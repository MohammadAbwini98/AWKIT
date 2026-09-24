/**
 * verify:ai-locator-attempts — Phase L L3 §7, the bounded synthesis attempt loop, against real
 * Chromium on the Feature Test Lab page /recorder-lab/locator-upgrade.
 *
 * Real layers: the Recorder and `buildRecordedFlow` for a genuine guarded-positional baseline, the
 * real `AiService` (queue, admission, `AiPromptBuilder` redaction, `AiOutputContract` parsing) over
 * `FakeAiHostTransport`, the trusted compiler and intent guard, the real `proveLocatorPlan` browser
 * gates, the real `JsonProfileStore` single-writer lane for the pending-upgrade compare-and-swap, and
 * `StepExecutor` + `LocatorFactory` for the runs that must stay unaffected. The only fake is the
 * provider TRANSPORT: a scripted table of model output text.
 *
 * What makes it fail: a third provider call after two real rejections; a repeated candidate buying a
 * fresh attempt or a second browser proof; a candidate that matches the wrong element, more than one
 * element, a bound data value, a positional selector or an invented frame reaching `pendingUpgrade`; a
 * protected-login refusal followed by another proposal; an expired capture context triggering a call;
 * a cancelled or superseded request storing a late answer; a provider timeout, crash or absence
 * changing a run's outcome; a pending candidate promoting itself. And (§17, L1.8) an attempt grammar
 * looser than the plan schema, a second scope or a cut candidate value decodable, a captured candidate
 * that cannot be written whole, a context line cut rather than dropped, a Recorder fallback shown, a
 * refusal carrying page text, or a benchmark packet that is not the job the product submits.
 *
 * Run: npm run verify:ai-locator-attempts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

import type { AiAdmissionView } from "@src/ai/AiAdmission";
import { isBoundedSchema, validateAiOutput, type AiOutputSchema } from "@src/ai/AiOutputContract";
import { buildAiPrompt } from "@src/ai/AiPromptBuilder";
import { AiService, type AiJobRequest, type AiServiceSettings } from "@src/ai/AiService";
import { FakeAiHostTransport, type FakeInferStep } from "@src/ai/FakeAiHostTransport";
import {
  LOCATOR_ATTEMPT_LIMITS,
  LOCATOR_ATTEMPT_SCHEMA,
  buildAttemptFeedback,
  isLocatorUpgradeEligible,
  locatorAttemptJob,
  offeredContainerScopes,
  runLocatorUpgradeAttempts,
  unofferedScopeField,
  upgradeContextUsable,
  type LocatorAttemptResult,
  type LocatorUpgradeAttemptInput
} from "@src/ai/locatorUpgradeAttempts";
import { LOCATOR_PLAN_SCHEMA, compileLocatorPlan } from "@src/ai/locatorPlan";
import { annotatePendingUpgrade } from "@src/ai/pendingUpgrade";
import type { FlowProfile, FlowStep } from "@src/profiles/FlowProfile";
import { hasPositionalIdentityGuard } from "@src/profiles/locatorApproval";
import { buildRecordedFlow } from "@src/recorder/buildRecordedFlow";
import { classifyLocatorQuality } from "@src/recorder/LocatorQualityClass";
import { getRecorderInitScriptContent } from "@src/recorder/recorderInitScript";
import type { RecordedAction } from "@src/recorder/RecorderTypes";
import { UPGRADE_CONTEXT_TTL_MS, markBoundValues, sanitizeUpgradeContext, type UpgradeContext } from "@src/recorder/upgradeContext";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { proveLocatorPlan } from "@src/runner/locatorProof";
import { StepExecutor } from "@src/runner/StepExecutor";
import { ValueResolver } from "@src/runner/ValueResolver";
import { SemanticRedactor } from "@src/semantic/SemanticRedactor";
import { JsonProfileStore } from "@src/storage/ProfileStore";

import { LARGEST_CONTEXT, LONGEST_REFUSAL, locatorInput, locatorUpgradePacket, productLocatorRequest } from "./ai-harness/locatorUpgradePacket";
import { SPY_LAB, askAccounting, classifyAttempts, judge, type AttemptRecord, type HostAttempt, type HostTraffic } from "./lib/recorder-spy-harness.mts";

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

/** Model output TEXT, parsed by the real output contract inside `AiService`. */
const PLANS = {
  /** Proves: the Archive button the guarded baseline resolves to. */
  good: '{"version":1,"target":{"strategy":"role","value":"button","name":"Archive","exact":true},"scopes":[]}',
  /** Unique, buildable — and a DIFFERENT element. Only gate C can tell. */
  wrongElement: '{"version":1,"target":{"strategy":"testId","value":"lu-open-gamma"},"scopes":[]}',
  /** Three "Open" buttons on the page. */
  notUnique: '{"version":1,"target":{"strategy":"role","value":"button","name":"Open"},"scopes":[]}',
  /** Refused by the compiler before the page is touched. */
  positional: '{"version":1,"target":{"strategy":"css","value":"button:nth-child(2)"},"scopes":[]}',
  unstableId: '{"version":1,"target":{"strategy":"id","value":"ember1234567"},"scopes":[]}',
  xpath: '{"version":1,"target":{"strategy":"xpath","value":"/html/body/main/button"},"scopes":[]}',
  inventedFrame: '{"version":1,"frame":"lu-frame","target":{"strategy":"role","value":"button","name":"Archive"},"scopes":[]}',
  /** Scoped by a row's data: refused by the intent guard, never proven. */
  dataBound: '{"version":1,"target":{"strategy":"role","value":"button","name":"Delete"},"scopes":[{"kind":"tableRow","strategy":"role","value":"row","hasText":"Alice Smith"}]}',
  notJson: "here is the locator you asked for",
  outOfSchema: '{"version":1,"target":{"strategy":"internal","value":"x"},"scopes":[]}'
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
const work = await mkdtemp(join(tmpdir(), "awkit-l3-attempts-"));
const MODEL_ROOT = resolvePath(join(work, "models"));
const FLOW_ID = "flow-attempts";
const SCENARIO_ID = "scen-attempts";

async function freshPage(url = LAB): Promise<Page> {
  const context = await liveBrowser().newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(3_000);
  await page.goto(url);
  return page;
}

async function capture(click: (page: Page) => Promise<void>, name: string): Promise<FlowStep> {
  const context = await liveBrowser().newContext();
  await context.addInitScript({ content: getRecorderInitScriptContent() });
  const page = await context.newPage();
  const actions: RecordedAction[] = [];
  await page.exposeBinding("__awtkit_recordAction", (_source, action) => actions.push(action as RecordedAction));
  await page.exposeBinding("__awtkit_recordSignal", () => undefined);
  await page.goto(LAB);
  await page.waitForTimeout(400);
  await click(page);
  await page.waitForTimeout(300);
  await context.close();
  const raw = actions.find((action) => action.type === "click");
  if (!raw) throw new Error(`no click captured for ${name}`);
  const built = buildRecordedFlow("L3", [{ ...raw, name }]).nodes.find((node) => node.type === "click");
  if (!built) throw new Error(`no click step built for ${name}`);
  return built;
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

interface Harness {
  fake: FakeAiHostTransport;
  service: AiService;
  /** Provider calls the fake actually served. */
  calls: () => number;
}

/** One `AiService` over the fake transport, answering the scripted steps in order. */
function harness(script: Array<FakeInferStep | string>, options: { settings?: Partial<AiServiceSettings>; noRuntime?: boolean } = {}): Harness {
  let served = 0;
  const fake = new FakeAiHostTransport({
    modelRoot: MODEL_ROOT,
    respond: (_request, index) => {
      served += 1;
      return script[Math.min(index, script.length - 1)] ?? PLANS.notJson;
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

  // ── The baseline a job exists for ───────────────────────────────────────────────────────────────
  console.log("\nA Recorder-captured guarded baseline is what L3 §7 tries to upgrade");
  const archive = await capture((page) => page.getByRole("button", { name: "Archive" }).click(), "Archive item");
  check("Archive (hidden duplicate) is captured as a guarded position", hasPositionalIdentityGuard(archive), JSON.stringify(archive.locator));
  check("...and its L2 class is guarded-positional", classifyLocatorQuality(archive.locator)?.class === "guarded-positional");

  const gamma = await capture((page) => page.getByTestId("lu-open-gamma").click(), "Open Gamma");
  check("Open Gamma is captured as a strong semantic locator (nothing to upgrade)", classifyLocatorQuality(gamma.locator)?.class === "strong-semantic");

  // ── §1 eligibility: who gets a job at all ───────────────────────────────────────────────────────
  console.log("\nEligibility (L3 §1)");
  check("a guarded-positional locator is eligible", isLocatorUpgradeEligible(archive).eligible);
  const strong = isLocatorUpgradeEligible(gamma);
  check("a strong semantic locator is NOT eligible", !strong.eligible && strong.code === "LOCATOR_NOT_WEAK", JSON.stringify(strong));
  check("...but an explicit user request (Element Spy) is its own trigger", isLocatorUpgradeEligible(gamma, { userRequested: true }).eligible);
  const sensitive = isLocatorUpgradeEligible({ ...archive, type: "protectedLoginHandoff" } as FlowStep);
  check("a protected-login step is refused as T3, user request or not", !sensitive.eligible && sensitive.code === "T3_PROTECTED_LOGIN", JSON.stringify(sensitive));
  const sensitiveRequested = isLocatorUpgradeEligible({ ...archive, type: "protectedLoginHandoff" } as FlowStep, { userRequested: true });
  check("...and a user request cannot lift T3", !sensitiveRequested.eligible && sensitiveRequested.code === "T3_PROTECTED_LOGIN");
  const noLocator = isLocatorUpgradeEligible({ ...archive, locator: undefined } as FlowStep);
  check("a step with no locator has no baseline to prove against", !noLocator.eligible && noLocator.code === "NO_BASELINE");

  // ── The capture-time context ────────────────────────────────────────────────────────────────────
  const capturedAt = new Date();
  const rawContext = sanitizeUpgradeContext(
    {
      target: { tag: "button", role: "button", name: "Archive", type: "" },
      candidates: [{ strategy: "role", value: "button", name: "Archive", count: 2, fallback: false }],
      containers: [{ kind: "card", tag: "section", role: "region", name: "Guarded baselines" }],
      heading: "Locator Upgrade Lab",
      siblingActions: ["Remove", "Swap twins"],
      pageKey: "/recorder-lab/locator-upgrade"
    },
    { pageAlias: "lab", frameDepth: 0 },
    capturedAt
  );
  if (!rawContext) throw new Error("upgrade context fixture did not sanitize");
  const context: UpgradeContext = markBoundValues(rawContext, ["swap twins"], undefined);
  check("the L2 marker pass flagged the sibling that carries a bound value", context.boundValues.some((m) => m.field === "siblingActions.1"), JSON.stringify(context.boundValues));
  check("a fresh capture context is usable", upgradeContextUsable(context, capturedAt));
  const expired: UpgradeContext = { ...context, capturedAt: new Date(capturedAt.getTime() - UPGRADE_CONTEXT_TTL_MS - 1_000).toISOString() };
  check("a context past its TTL is not", !upgradeContextUsable(expired, capturedAt));

  // ── The job runner ──────────────────────────────────────────────────────────────────────────────
  const flows = new JsonProfileStore<FlowProfile>({ folder: join(work, "flows") });
  let proofs = 0;

  /** One bounded job, wired exactly as a production caller would wire it. */
  async function job(
    page: Page | undefined,
    script: Array<FakeInferStep | string>,
    options: Partial<LocatorUpgradeAttemptInput> & { step?: FlowStep; harness?: Harness; flowId?: string; onProve?: () => void } = {}
  ): Promise<{ result: LocatorAttemptResult; harness: Harness }> {
    const h = options.harness ?? harness(script);
    const step = options.step ?? archive;
    const flowId = options.flowId ?? FLOW_ID;
    const result = await runLocatorUpgradeAttempts(
      {
        requestId: `req-${Math.random().toString(16).slice(2, 10)}`,
        step,
        boundValues: ["Alice Smith", "Bob Jones"],
        upgradeContext: context,
        ...options
      },
      {
        ai: h.service,
        prove: async (plan) => {
          proofs += 1;
          // Lets a test cancel DURING the proof, which is the window this module owns rather than
          // `AiService` — the only place a late answer could still reach the profile.
          options.onProve?.();
          if (!page) throw new Error("no page for proof");
          return proveLocatorPlan(page, step, plan, { boundValues: ["Alice Smith", "Bob Jones"] });
        },
        annotate: (pending) => annotatePendingUpgrade(flows, flowId, step.id, pending)
      }
    );
    await h.service.shutdown();
    return { result, harness: h };
  }

  const seedFlow = async (id: string, step: FlowStep = archive): Promise<void> => {
    await flows.delete(id).catch(() => undefined);
    await flows.create({ id, name: "Attempts", version: 1, nodes: [step], edges: [] });
  };
  const savedPending = async (id = FLOW_ID, stepId = archive.id) => (await flows.get(id))!.nodes.find((n) => n.id === stepId)!.locator?.pendingUpgrade;
  const savedLocator = async (id = FLOW_ID, stepId = archive.id) => (await flows.get(id))!.nodes.find((n) => n.id === stepId)!.locator;

  // ── 1. A valid proposal enters the pending lifecycle ────────────────────────────────────────────
  console.log("\n1 — a proven proposal becomes a pending candidate, and nothing more");
  await seedFlow(FLOW_ID);
  let page = await freshPage();
  let accepted = await job(page, [PLANS.good]);
  check("a proven plan is accepted", accepted.result.outcome === "accepted" && accepted.result.code === "PROVEN", JSON.stringify(accepted.result));
  check("...on the first attempt, spending nothing", accepted.result.attemptsUsed === 0 && accepted.result.calls === 1, JSON.stringify(accepted.result));
  let pending = await savedPending();
  check("...and it is stored as capture-proven in pendingUpgrade", pending?.proof === "capture-proven" && pending.candidate.strategy === "role", JSON.stringify(pending?.candidate));
  check("...and the SAVED locator is untouched: a pending candidate never promotes itself", (await savedLocator())?.strategy === archive.locator?.strategy);
  // The Recorder itself already captured a role/name alternative for this element, so "the candidate
  // does not appear in alternatives" would be false for a reason that has nothing to do with §7. The
  // invariant that IS §7's is that the write adds nothing there: `alternatives` is what the Recorder
  // left, unchanged, so nothing the model proposed became executable.
  check(
    "...and the write added nothing to alternatives, where LocatorFactory would execute it",
    JSON.stringify((await savedLocator())?.alternatives ?? []) === JSON.stringify(archive.locator?.alternatives ?? []),
    JSON.stringify((await savedLocator())?.alternatives)
  );
  await page.close();

  // ── 2. Invalid output is refused by the trusted parser and compiler ─────────────────────────────
  console.log("\n2 — invalid provider output never reaches the page");
  await seedFlow(FLOW_ID);
  const invalidCases: Array<[string, string, string]> = [
    ["output that is not JSON", PLANS.notJson, "MALFORMED_OUTPUT"],
    // The plan schema is a CLOSED object, so `AiOutputContract` refuses an unoffered strategy and a
    // top-level frame key before the compiler is reached. The compiler's own guards are asserted
    // directly below, so neither layer can go silently dead behind the other.
    ["a strategy the schema does not offer", PLANS.outOfSchema, "SCHEMA_REJECTED"],
    ["an invented frame reference", PLANS.inventedFrame, "SCHEMA_REJECTED"],
    ["a positional CSS selector", PLANS.positional, "POSITIONAL"],
    ["a generated id", PLANS.unstableId, "UNSTABLE_ID"],
    ["XPath without the policy flag", PLANS.xpath, "XPATH_NOT_ALLOWED"],
    ["a scope that is a bound data value", PLANS.dataBound, "INTENT_BOUND_VALUE"]
  ];
  for (const [label, plan, code] of invalidCases) {
    const before = proofs;
    const run = await job(undefined, [plan, plan]);
    check(`${label} is refused (${code}) and exhausts the budget`, run.result.outcome === "attempts-exhausted" && run.result.code === code, JSON.stringify(run.result));
    check(`...and ${label} never reached the browser`, proofs === before, `${proofs - before} proofs ran`);
  }
  check("no refused proposal was stored", (await savedPending()) === undefined);
  // The compiler is the second line of defence, reached whenever a plan does not arrive through
  // `AiService` — replay re-enters it through `planFromCandidate`. Asserted here so the outer
  // schema refusal above cannot hide it having stopped working.
  const framed = compileLocatorPlan(JSON.parse(PLANS.inventedFrame), archive.locator?.context);
  check("the trusted compiler independently refuses an invented frame key", !framed.ok && framed.code === "INVENTED_FRAME", JSON.stringify(framed));

  // ── 3 & 4. The budget is finite, and a repeat does not refresh it ───────────────────────────────
  console.log("\n3, 4 — the attempt budget");
  check("the documented budget is 2 synthesis attempts", LOCATOR_ATTEMPT_LIMITS.maxAttempts === 2);
  await seedFlow(FLOW_ID);
  page = await freshPage();
  const exhausted = await job(page, [PLANS.wrongElement, PLANS.notUnique, PLANS.good]);
  check("two real rejections end the job", exhausted.result.outcome === "attempts-exhausted", JSON.stringify(exhausted.result));
  check("...having spent exactly 2 attempts on 2 provider calls", exhausted.result.attemptsUsed === 2 && exhausted.result.calls === 2);
  check("...and the third scripted answer was never requested", exhausted.harness.calls() === 2, `${exhausted.harness.calls()} calls served`);
  check("...so the plan that WOULD have been accepted was never stored", (await savedPending()) === undefined);

  let before = proofs;
  page = await freshPage();
  const repeated = await job(page, [PLANS.wrongElement, PLANS.wrongElement, PLANS.good]);
  check("the same rejected plan proposed again does not buy a fresh attempt", repeated.result.outcome === "attempts-exhausted" && repeated.result.code === "DUPLICATE_CANDIDATE", JSON.stringify(repeated.result));
  check("...and the repeat is not re-proven in the browser", proofs - before === 1, `${proofs - before} proofs ran`);
  check("...and the third answer was still never requested", repeated.harness.calls() === 2);
  await page.close();

  // ── 5 & 6. The browser is what decides identity ─────────────────────────────────────────────────
  console.log("\n5, 6 — a unique, buildable candidate can still be the wrong element");
  await seedFlow(FLOW_ID);
  page = await freshPage();
  const wrong = await job(page, [PLANS.wrongElement, PLANS.notUnique]);
  const wrongRecord = wrong.result.attempts[0];
  check("a unique candidate on a DIFFERENT element is rejected by gate C", wrongRecord?.stage === "proof" && wrongRecord.code === "WRONG_ELEMENT", JSON.stringify(wrong.result.attempts));
  check("a candidate matching three elements is rejected by gate B", wrong.result.attempts[1]?.code === "CANDIDATE_NOT_UNIQUE", JSON.stringify(wrong.result.attempts));
  check("neither was stored", (await savedPending()) === undefined);
  check("no attempt record carries candidate or page text", !JSON.stringify(wrong.result.attempts).includes("Gamma") && !JSON.stringify(wrong.result.attempts).includes("lu-open"));

  console.log("\nthe feedback between attempts is structured and deterministic");
  const feedback = buildAttemptFeedback(wrong.result.attempts);
  check("feedback names the stage, code and field only", feedback.includes("WRONG_ELEMENT") && feedback.includes("CANDIDATE_NOT_UNIQUE"), feedback);
  check("...and carries no candidate value, page text or typed value", !/Gamma|lu-open|Alice|Bob/.test(feedback), feedback);
  check("...and is a pure function of the records", buildAttemptFeedback(wrong.result.attempts) === feedback);
  await page.close();

  // What `verify:ai-spy-live` failed on (32/1, 2026-09-23): its precondition took `attemptsUsed` for the
  // number of model replies, but only a refusal spends it. Replayed here on the real loop and the real proof.
  console.log("\na proof refusal, then a proven answer: replies, refusals and the record stay distinct");
  await seedFlow(FLOW_ID);
  page = await freshPage();
  const answers = [PLANS.wrongElement, PLANS.good];
  const recovered = await job(page, answers);
  check("the second answer is accepted after the first is refused, and stored capture-proven", recovered.result.outcome === "accepted" && (await savedPending())?.proof === "capture-proven", JSON.stringify(recovered.result));
  check("...on 2 provider calls with 1 attempt spent: the accepted answer spends nothing", recovered.result.calls === 2 && recovered.result.attemptsUsed === 1, JSON.stringify(recovered.result));
  const kept = recovered.result.attempts;
  check(
    "...and the acceptance does not erase the refusal from the record",
    kept.length === 1 && kept[0]?.attempt === 1 && kept[0].consumed && kept[0].stage === "proof" && kept[0].code === "WRONG_ELEMENT",
    JSON.stringify(kept)
  );
  // The same ask at the host boundary, as the live verifier captures it: every infer answered as scripted.
  const sent = recovered.harness.fake.inferRequests();
  const traffic: HostTraffic = {
    requests: sent.map((request, i) => ({ child: 0, id: `m${i}`, jobId: request.jobId, user: request.user })),
    replies: sent.map((_, i) => ({ child: 0, id: `m${i}`, ok: true, text: answers[i] }))
  };
  const counted = askAccounting(traffic, recovered.result.attemptsUsed, true);
  check(
    "verify:ai-spy-live's accounting accepts the shown proposal: 2 requests, 2 replies, 1 refused",
    counted.consistent && counted.requests === 2 && counted.replies === 2 && counted.refused === 1,
    JSON.stringify({ ...counted, attempts: counted.attempts.map((a) => a.attempt) })
  );
  check(
    "...and its diagnostic keeps the refused reply before the proven one",
    counted.attempts.map((a) => `${a.attempt}:${a.text === PLANS.wrongElement ? "refused" : a.text === PLANS.good ? "proven" : "?"}`).join(" ") === "1:refused 2:proven",
    JSON.stringify(counted.attempts.map((a) => a.attempt))
  );
  check("...an accepted answer shown as NOT_PROVEN (unprovable-now in the Spy) is one unspent reply too", askAccounting(traffic, 1, false).consistent);
  check(
    "...and it is not vacuous: a shown proposal with every reply refused, or 2 replies with none refused, is inconsistent",
    !askAccounting(traffic, 2, true).consistent && !askAccounting(traffic, 0, true).consistent && !askAccounting(traffic, 0, false).consistent
  );
  await page.close();

  // ── 7. A protected-login refusal terminates ─────────────────────────────────────────────────────
  console.log("\n7 — a protected-login surface ends the job, it does not earn a retry");
  await seedFlow(FLOW_ID);
  const login = await freshPage(`${BASE}/login`);
  const guarded = await job(login, [PLANS.good, PLANS.good]);
  check("the proof refuses a protected-login page", guarded.result.code === "T3_PROTECTED_LOGIN", JSON.stringify(guarded.result));
  check("...and the job ends there rather than proposing again", guarded.result.outcome === "forbidden" && guarded.result.calls === 1, JSON.stringify(guarded.result));
  check("...with nothing stored", (await savedPending()) === undefined);
  await login.close();

  // ── 8. An expired capture context is never regenerated ──────────────────────────────────────────
  console.log("\n8 — an expired capture context ends the job before the provider is asked");
  const stale = await job(undefined, [PLANS.good], { upgradeContext: expired });
  check("an expired L2 context refuses the job", stale.result.outcome === "context-expired" && stale.result.code === "CONTEXT_EXPIRED", JSON.stringify(stale.result));
  check("...without a single provider call", stale.result.calls === 0 && stale.harness.calls() === 0);

  // ── 9. A cancelled request cannot store a late answer ───────────────────────────────────────────
  console.log("\n9 — cancellation");
  await seedFlow(FLOW_ID);
  page = await freshPage();
  const controller = new AbortController();
  const slow = harness([{ text: PLANS.good, delayMs: 5_000 }]);
  const pendingJob = job(page, [], { harness: slow, signal: controller.signal });
  await new Promise((r) => setTimeout(r, 150));
  controller.abort();
  const cancelled = await pendingJob;
  check("aborting the request cancels the job", cancelled.result.outcome === "cancelled" && cancelled.result.code === "CANCELLED", JSON.stringify(cancelled.result));
  check("...by cancelling on the HOST, not merely discarding the answer", slow.fake.requestTypes().includes("cancel"), slow.fake.requestTypes().join(","));
  check("...and the late answer is not stored", (await savedPending()) === undefined);
  const preAborted = await job(page, [PLANS.good], { signal: AbortSignal.abort() });
  check("a request already cancelled never calls the provider", preAborted.result.outcome === "cancelled" && preAborted.result.calls === 0);

  // Cancelling DURING the browser proof: the provider already answered and the proof already proved,
  // so only this module's own re-check stands between a stale answer and the profile.
  await seedFlow(FLOW_ID);
  const lateController = new AbortController();
  const late = await job(page, [PLANS.good], { signal: lateController.signal, onProve: () => lateController.abort() });
  check("a request cancelled while its proof runs is cancelled, not accepted", late.result.outcome === "cancelled" && late.result.code === "CANCELLED", JSON.stringify(late.result));
  check("...and the proven candidate it was about to store is discarded", (await savedPending()) === undefined, JSON.stringify(await savedPending()));
  await page.close();

  // ── 10 & 13. Superseded and concurrent proposals ────────────────────────────────────────────────
  console.log("\n10, 13 — a superseded proposal cannot replace a newer candidate");
  await seedFlow(FLOW_ID);
  page = await freshPage();
  const future = new Date(Date.now() + 60_000);
  await job(page, [PLANS.good], { now: () => future });
  const newest = await savedPending();
  check("the newer candidate is stored", newest?.createdAt === future.toISOString());
  const older = await job(page, [PLANS.good], { now: () => new Date(future.getTime() - 30_000) });
  check("an older proposal landing afterwards is refused as superseded", older.result.outcome === "superseded" && older.result.code === "SUPERSEDED", JSON.stringify(older.result));
  check("...and the newer candidate is still the one on disk", (await savedPending())?.createdAt === newest?.createdAt);

  await seedFlow(FLOW_ID);
  const raceA = new Date(Date.now() + 10_000);
  const raceB = new Date(Date.now() + 20_000);
  const [first, second] = await Promise.all([job(page, [PLANS.good], { now: () => raceA }), job(page, [PLANS.good], { now: () => raceB })]);
  const afterRace = await savedPending();
  check("two concurrent jobs both settle", ["accepted", "superseded"].includes(first.result.outcome) && ["accepted", "superseded"].includes(second.result.outcome), `${first.result.outcome}/${second.result.outcome}`);
  check("...and exactly one candidate survives, the newer one", afterRace?.createdAt === raceB.toISOString(), JSON.stringify(afterRace?.createdAt));
  const saved = await savedLocator();
  check("...with the step's own locator untouched by either", saved?.strategy === archive.locator?.strategy && saved?.value === archive.locator?.value);

  // The binding is step type, step name and the locator's strategy/value, so the edit has to be one
  // of those: changing `value` alone is deliberately NOT a rebinding.
  const edited: FlowStep = { ...archive, name: "Archive item (renamed since the proposal)" };
  await seedFlow("flow-edited", edited);
  const stepChanged = await job(page, [PLANS.good], { flowId: "flow-edited", step: archive });
  check("a proposal for a step that has since been edited is refused as stale", stepChanged.result.outcome === "superseded" && stepChanged.result.code === "STALE", JSON.stringify(stepChanged.result));
  await page.close();

  // ── 11. Browser closure and navigation invalidate proof work ────────────────────────────────────
  console.log("\n11 — a closed or navigated page is unprovable now, not a rejection");
  await seedFlow(FLOW_ID);
  const closing = await freshPage();
  await closing.close();
  const closed = await job(closing, [PLANS.good]);
  check("a closed page yields PAGE_UNAVAILABLE", closed.result.code === "PAGE_UNAVAILABLE", JSON.stringify(closed.result));
  check("...which is accepted for replay, not counted as a rejection", closed.result.outcome === "accepted" && closed.result.attemptsUsed === 0);
  check("...and stored as unprovable-now, never as capture-proven", (await savedPending())?.proof === "unprovable-now");

  await seedFlow(FLOW_ID);
  const navigated = await freshPage();
  await navigated.goto(`${BASE}/recorder-lab/locator-upgrade/frame`);
  const away = await job(navigated, [PLANS.good]);
  check("a page navigated away from the target is unprovable now", away.result.outcome === "accepted" && away.result.attemptsUsed === 0, JSON.stringify(away.result));
  check("...and is likewise stored as unprovable-now", (await savedPending())?.proof === "unprovable-now", JSON.stringify(await savedPending()));
  await navigated.close();

  // ── 12. Provider timeout, crash and refusal all terminate safely ────────────────────────────────
  console.log("\n12 — provider failure terminates without spending synthesis attempts");
  await seedFlow(FLOW_ID);
  // The transport reports the manager's deadline at once: waiting out the real 185 s here would add
  // minutes and prove nothing more. That the deadline fires at exactly 185 s is verify:ai-deadlines.
  const timedOut = await job(undefined, [{ fail: "AI_HOST_TIMEOUT" }], { maxAttempts: 2 });
  check("a provider call that times out ends the job", timedOut.result.outcome === "provider-unavailable" && timedOut.result.code === "TIMEOUT", JSON.stringify(timedOut.result));
  check("...spending no synthesis attempt, because nothing was synthesized", timedOut.result.attemptsUsed === 0 && timedOut.result.calls === 1);

  const crashed = await job(undefined, [{ crash: true }]);
  check("a host that dies mid-inference ends the job", crashed.result.outcome === "provider-unavailable" && crashed.result.code === "HOST_ERROR", JSON.stringify(crashed.result));

  const disabled = await job(undefined, [PLANS.good], { harness: harness([PLANS.good], { settings: { enabled: false } }) });
  check("AI switched off refuses the job at submit", disabled.result.outcome === "provider-unavailable" && disabled.result.code === "DISABLED", JSON.stringify(disabled.result));

  const noRuntime = await job(undefined, [PLANS.good], { harness: harness([PLANS.good], { noRuntime: true }) });
  check("no local runtime in the build refuses the job", noRuntime.result.outcome === "provider-unavailable" && noRuntime.result.code === "UNAVAILABLE", JSON.stringify(noRuntime.result));
  check("no provider failure stored anything", (await savedPending()) === undefined);

  // ── 14 & 16. Ordinary execution is unaffected, with or without a provider ───────────────────────
  console.log("\n14, 16 — the Runner is untouched by the AI path");
  const runContext: InstanceExecutionContext = {
    executionId: "exec-attempts",
    instanceId: "inst-attempts",
    scenarioId: SCENARIO_ID,
    flowId: FLOW_ID,
    instanceOrderNumber: 1,
    totalInstances: 1,
    runtimeInputs: {},
    instanceInputs: {},
    flowOutputs: {},
    paths: { downloads: join(work, "d"), screenshots: join(work, "s"), logs: join(work, "l"), reports: join(work, "r") }
  };
  const runStep = async (target: FlowStep, on: Page) =>
    new StepExecutor(on, new LocatorFactory(on), new ValueResolver(runContext), runContext).execute(target);

  await seedFlow(FLOW_ID);
  page = await freshPage();
  // In flight while the step runs, then failing: a host that dies 2 s in. A hang would hold the test for
  // the whole 185 s deadline.
  const [failingJob, duringRun] = await Promise.all([job(undefined, [{ crash: true, delayMs: 2_000 }]), runStep(archive, page)]);
  check("a step runs normally while an AI job is failing beside it", duringRun.status === "passed", duringRun.error);
  check("...and acts on the element its OWN locator names", (await page.getByTestId("lu-result").textContent()) === "archive");
  check("...and the failed job changed nothing about the step", failingJob.result.outcome === "provider-unavailable" && (await savedPending()) === undefined);
  await page.close();

  page = await freshPage();
  const noAi = await runStep(archive, page);
  check("with no AI configured at all the same step still passes", noAi.status === "passed", noAi.error);
  check("...on the same element", (await page.getByTestId("lu-result").textContent()) === "archive");

  // ── 15. A stored candidate is still inert ───────────────────────────────────────────────────────
  console.log("\n15 — an accepted candidate is inert until L3 §6 promotes it");
  await seedFlow(FLOW_ID);
  const provenPage = await freshPage();
  await job(provenPage, [PLANS.good]);
  const storedStep = (await flows.get(FLOW_ID))!.nodes.find((n) => n.id === archive.id)!;
  check("the candidate is stored", storedStep.locator?.pendingUpgrade !== undefined);
  const withCandidate = await runStep(storedStep, provenPage);
  check("...and a run still uses the saved locator", withCandidate.status === "passed" && (await provenPage.getByTestId("lu-result").textContent()) === "archive", withCandidate.error);
  check("...the saved primary is unchanged", storedStep.locator?.strategy === archive.locator?.strategy && storedStep.locator?.value === archive.locator?.value);
  check("...and the guarded baseline still carries its positional guard", hasPositionalIdentityGuard(storedStep));
  await provenPage.close();
  await page.close();

  // ── 17. The request an attempt sends, and the plans its grammar can decode (L1.8) ────────────────
  console.log("\n17 — the request an attempt sends, and the plans its grammar can decode (L1.8)");
  // The attempt grammar must sit inside the plan schema: same keys, `required` and enums, no looser
  // bound. Then whatever it decodes is a plan the trusted compiler still judges in full.
  const looser = (attempt: AiOutputSchema, plan: AiOutputSchema, path = "$"): string[] => {
    if (attempt.type !== plan.type) return [`${path}: type`];
    if (attempt.type === "object" && plan.type === "object") {
      const same = JSON.stringify([Object.keys(attempt.properties), attempt.required]) === JSON.stringify([Object.keys(plan.properties), plan.required]);
      return [...(same ? [] : [`${path}: keys`]), ...Object.keys(attempt.properties).flatMap((key) => (plan.properties[key] ? looser(attempt.properties[key], plan.properties[key], `${path}.${key}`) : []))];
    }
    if (attempt.type === "array" && plan.type === "array") {
      return [...(attempt.maxItems <= plan.maxItems && (attempt.minItems ?? 0) >= (plan.minItems ?? 0) ? [] : [`${path}: items`]), ...looser(attempt.items, plan.items, `${path}[]`)];
    }
    if (attempt.type === "string" && plan.type === "string" && "maxLength" in attempt && "maxLength" in plan) return attempt.maxLength <= plan.maxLength ? [] : [`${path}: maxLength`];
    return JSON.stringify(attempt) === JSON.stringify(plan) ? [] : [`${path}: bounds`];
  };
  check("the attempt grammar is bounded", isBoundedSchema(LOCATOR_ATTEMPT_SCHEMA));
  check("...and is the plan schema narrowed: same keys and enums, no bound looser", looser(LOCATOR_ATTEMPT_SCHEMA, LOCATOR_PLAN_SCHEMA).length === 0, looser(LOCATOR_ATTEMPT_SCHEMA, LOCATOR_PLAN_SCHEMA).join(", "));
  const loosened = JSON.parse(JSON.stringify(LOCATOR_ATTEMPT_SCHEMA)) as { properties: { scopes: { maxItems: number } } };
  loosened.properties.scopes.maxItems = 99;
  check("(non-vacuity) a copy with a looser bound IS flagged", looser(loosened as unknown as AiOutputSchema, LOCATOR_PLAN_SCHEMA).length > 0);

  const long = (seed: string, chars: number): string => seed.repeat(Math.ceil(chars / seed.length)).slice(0, chars);
  const planWith = (value: string, scopes: unknown[]) => ({ version: 1, target: { strategy: "testId", value, name: "", exact: false }, scopes });
  const scope = (name: string) => ({ strategy: "role", value: "region", name, exact: false, kind: "card", hasText: "", visibleOnly: false });
  const capturedLong = sanitizeUpgradeContext({ target: { tag: "a" }, candidates: [{ strategy: "testId", value: long("orders-archive-", 300), count: 2 }] }, { pageAlias: "lab", frameDepth: 0 });
  const longestCandidate = capturedLong?.candidates[0]?.value ?? "";
  check("(precondition) a capture keeps a candidate value at its 200-character bound", longestCandidate.length === 200, String(longestCandidate.length));
  check("a candidate value as long as any capture offers is decodable whole", validateAiOutput(planWith(longestCandidate, []), LOCATOR_ATTEMPT_SCHEMA).length === 0);
  check("...and a container name as long as any capture shows is decodable as a scope", validateAiOutput(planWith("lu-archive", [scope(long("Guarded baselines ", 80))]), LOCATOR_ATTEMPT_SCHEMA).length === 0);
  check("a second scope is not decodable: two do not fit the cap with their texts", validateAiOutput(planWith("lu-archive", [scope("A"), scope("B")]), LOCATOR_ATTEMPT_SCHEMA).length > 0);
  check("...nor a scope text longer than any the capture shows", validateAiOutput(planWith("lu-archive", [scope(long("Guarded baselines ", 81))]), LOCATOR_ATTEMPT_SCHEMA).length > 0);

  const attempt = (upgradeContext: UpgradeContext, records: Parameters<typeof locatorAttemptJob>[1] = []) =>
    locatorAttemptJob({ requestId: "req-17", step: archive, boundValues: ["Alice Smith", "Bob Jones"], upgradeContext }, records, "req-17.a1");
  const shownBy = (request: AiJobRequest) => {
    const built = buildAiPrompt(request.prompt, new SemanticRedactor(), "0123456789abcdef");
    return built.ok && built.omittedFields.length === 0 ? built.user : "";
  };
  const typicalJob = attempt(context);
  const typicalShown = shownBy(typicalJob);
  check("an attempt sends ONE data block, built whole", typicalJob.prompt.fields.length === 1 && typicalShown.split("<<<DATA ").length === 2, typicalShown);
  check("...decoded against the attempt grammar at the attempt's output cap", typicalJob.schema === LOCATOR_ATTEMPT_SCHEMA && typicalJob.maxOutputTokens === LOCATOR_ATTEMPT_LIMITS.maxOutputTokens);
  const expected = [`current locator: ${archive.locator?.strategy}, guarded-positional`, "target: tag=button role=button name=Archive", 'candidate: {"strategy":"role","value":"button","name":"Archive"} matches=2', "container: card region", "heading: Locator Upgrade Lab", "sibling action: Remove", "data-bound, not shown: siblingActions.1"];
  check("...showing the saved locator's strategy and class only, the target, candidate, container, heading and actions", expected.every((line) => typicalShown.includes(`\n${line}\n`)), typicalShown);
  check("...and never the sibling flagged as a bound value", !typicalShown.includes("Swap twins"));
  check("...nor a container name the page computed from its content (D1 B: only an authored name is offered)", !typicalShown.includes("Guarded baselines"), typicalShown);

  // Element Spy's Save profile on the real 0.8B: offered `testId=spy-save-profile`, it answered `css`
  // `data-testid=spy-save-profile` — Playwright's engine=selector form, which the compiler refuses.
  const spySave = sanitizeUpgradeContext(
    { target: { tag: "button", role: "button", name: "Save profile" }, candidates: [{ strategy: "testId", value: "spy-save-profile", count: 1 }, { strategy: "role", value: "button", name: "Save profile", count: 1 }] },
    { pageAlias: "lab", frameDepth: 0 }
  );
  if (!spySave) throw new Error("the Save profile capture did not sanitize");
  const spyCandidateLines = (upgradeContext: UpgradeContext) => (attempt(upgradeContext).prompt.fields[0].text ?? "").split("\n").filter((line) => line.startsWith("candidate: "));
  const spyLines = spyCandidateLines(spySave);
  const spyTargets = spyLines.map((line) => {
    try {
      return JSON.parse(/^candidate: (\{.*\}) matches=\d+$/.exec(line)?.[1] ?? "") as unknown;
    } catch {
      return null;
    }
  });
  check("an offered test id is shown as the plan's own target, strategy testId", spyLines[0] === 'candidate: {"strategy":"testId","value":"spy-save-profile"} matches=1', spyLines.join(" | "));
  check("...every candidate shown is a target the compiler accepts as written", spyTargets.length === 2 && spyTargets.every((target) => target !== null && compileLocatorPlan({ version: 1, target, scopes: [] }, undefined).ok), spyLines.join(" | "));
  check("...and none is written in the engine=selector form", spyLines.every((line) => !/^candidate: [\w-]+=/.test(line)), spyLines.join(" | "));
  const refusedAs = (target: Record<string, unknown>) => {
    const compiled = compileLocatorPlan({ version: 1, target, scopes: [] }, undefined);
    return compiled.ok ? "OK" : compiled.code;
  };
  check("the compiler still refuses the real 0.8B's answer as SCRIPT", refusedAs({ strategy: "css", value: "data-testid=spy-save-profile" }) === "SCRIPT");
  check("...and the old line forms copied into a value, text= and id= as SCRIPT", refusedAs({ strategy: "css", value: "text=Save profile" }) === "SCRIPT" && refusedAs({ strategy: "css", value: "id=save" }) === "SCRIPT");
  check("a candidate flagged as a bound value is still never shown", !spyCandidateLines(markBoundValues(spySave, ["spy-save-profile"])).some((line) => line.includes("spy-save-profile")), spyCandidateLines(markBoundValues(spySave, ["spy-save-profile"])).join(" | "));

  // A capture at every L2 bound: four distinct 200-character candidates, a Recorder fallback, and
  // more context than fits. Every line is shown whole or not at all.
  const boundRaw = {
    target: { tag: long("button", 20), role: long("button", 30), name: long("Archive the selected order ", 80), type: long("button", 20) },
    candidates: [
      ...["alpha-", "bravo-", "charlie-", "delta-"].map((seed) => ({ strategy: "placeholder", value: long(seed, 200), name: long("Archive ", 80), count: 10_000 })),
      { strategy: "css", value: "main > section:nth-of-type(3) > div.row > button", count: 3, fallback: true }
    ],
    // The widest a container line can get since D1: an authored name at its bound AND a stable test id at its bound.
    containers: Array.from({ length: 6 }, (_, index) => ({
      kind: "listItem",
      tag: "li",
      role: long("listitem", 30),
      name: long(`Panel ${"ABCDEF"[index]} of the orders workspace `, 80),
      nameSource: "aria-label",
      testId: `${"abcdef"[index]}-panel${"-orders".repeat(10)}`.slice(0, 60),
      text: "Open order row"
    })),
    heading: long("Open orders ", 80),
    siblingActions: Array.from({ length: 6 }, (_, index) => long(`Action ${index} for this order `, 60))
  };
  const boundCaptured = sanitizeUpgradeContext(boundRaw, { pageAlias: "lab", frameDepth: 0 });
  if (!boundCaptured) throw new Error("the bound capture did not sanitize");
  check(
    "(precondition) every bound container keeps its authored name and its 60-character test id, so each line is the widest D1 allows",
    boundCaptured.containers.every((container) => container.authoredName === true && container.testId?.length === 60),
    JSON.stringify(boundCaptured.containers.map((container) => [container.authoredName, container.testId?.length]))
  );
  const boundJob = attempt(markBoundValues(boundCaptured, []), [LONGEST_REFUSAL]);
  const boundText = boundJob.prompt.fields[0].text ?? "";
  const boundLines = boundText.split("\n");
  const semantic = boundCaptured.candidates.filter((candidate) => !candidate.fallback);
  // Every line this capture can produce, whole. A cut line is none of them: every line shown is checked,
  // not only those whose label survived, since a cut can land inside a label.
  const { tag, role, type, name } = boundCaptured.target;
  const wholeLines = new Set([
    `current locator: ${archive.locator?.strategy}, guarded-positional`,
    `target: tag=${tag} role=${role} type=${type} name=${name}`,
    `refused ${buildAttemptFeedback([LONGEST_REFUSAL])}`,
    ...semantic.map((candidate) => `candidate: ${JSON.stringify({ strategy: candidate.strategy, value: candidate.value, name: candidate.name })} matches=${candidate.count}`),
    ...boundCaptured.containers.map(
      (container, index) => `container: ${container.kind} ${container.role}${offeredContainerScopes(boundCaptured)[index].map((offered) => ` scope ${JSON.stringify(offered)}`).join("")}`
    ),
    `heading: ${boundCaptured.heading}`,
    ...boundCaptured.siblingActions.map((action) => `sibling action: ${action}`)
  ]);
  check("at every L2 bound the context stays within its budget and builds whole", boundText.length <= LOCATOR_ATTEMPT_LIMITS.maxContextChars && shownBy(boundJob) !== "", String(boundText.length));
  check("...(precondition) and more was offered than fits, so lines were dropped", boundLines.length < wholeLines.size && boundLines.length > 3, `${boundLines.length} of ${wholeLines.size}`);
  check("...and every line shown is whole, never cut", boundLines.every((line) => wholeLines.has(line)), boundLines.filter((line) => !wholeLines.has(line)).join(" | "));
  check("...with every candidate among them, since they come first", semantic.every((candidate) => boundLines.some((line) => line.startsWith(`candidate: {"strategy":"${candidate.strategy}","value":"${candidate.value}"`))));
  check("...and the refusal survives the budget", boundText.includes("refused attempt 1: refused at intent (INTENT_BOUND_VALUE) on scopes.0.hasText"));
  check("a Recorder fallback (structural or positional CSS/XPath) is never shown", !boundText.includes("nth-of-type") && !boundText.includes("(fallback)"));

  const largestText = productLocatorRequest(LARGEST_CONTEXT, [LONGEST_REFUSAL]).prompt.fields[0].text ?? "";
  const largestCaptured = locatorInput(LARGEST_CONTEXT, "req-largest").upgradeContext!;
  check(
    "the largest fixture's request drops nothing: every semantic candidate, action and the heading, whole",
    largestCaptured.candidates.every((candidate) => candidate.fallback !== largestText.includes(`candidate: {"strategy":"${candidate.strategy}","value":${JSON.stringify(candidate.value)}`)) &&
      [...largestCaptured.siblingActions.map((action) => `sibling action: ${action}`), `heading: ${largestCaptured.heading}`].every((line) => largestText.split("\n").includes(line)),
    largestText
  );

  // The benchmark's packet is the second attempt of the largest job after a real intent refusal: run
  // the product's own loop to that point and compare what it submits.
  const submitted: AiJobRequest[] = [];
  const refusedFirst = await runLocatorUpgradeAttempts(locatorInput(LARGEST_CONTEXT, "req-packet"), {
    ai: {
      submit: async (request) => {
        submitted.push(request);
        return submitted.length === 1
          ? { status: "ok", value: JSON.parse(PLANS.dataBound), modelId: "stub", usage: { promptTokens: 1, outputTokens: 1, firstTokenMs: 0, generationMs: 0 }, yields: 0 }
          : { status: "cancelled", yields: 0 };
      },
      cancel: () => false
    },
    prove: async () => {
      throw new Error("a refused plan reached the proof");
    },
    annotate: async () => ({ code: "OK" as const })
  });
  const secondText = submitted[1]?.prompt.fields[0].text ?? "";
  check("(precondition) the first plan was refused by the intent guard on its scope's text", refusedFirst.attempts[0]?.code === "INTENT_BOUND_VALUE" && submitted.length === 2, JSON.stringify(refusedFirst));
  check("a refusal reaches the next attempt as its code and field path, never the value", secondText.includes("refused attempt 1: refused at intent (INTENT_BOUND_VALUE) on scopes.0.hasText") && !/alice|bob/i.test(secondText), secondText);
  const packet = locatorUpgradePacket();
  check(
    "the benchmark's packet IS the job the product submits on that second attempt",
    JSON.stringify([submitted[1]?.prompt, submitted[1]?.schema, submitted[1]?.maxOutputTokens]) === JSON.stringify([packet.spec, packet.schema, packet.maxOutputTokens])
  );

  // Through the real AiService and output contract: what the grammar cannot decode is refused before the
  // compiler and never reaches the page, and a plan at the capture's own bounds still reaches the proof.
  await seedFlow(FLOW_ID);
  page = await freshPage();
  before = proofs;
  const twoScopes = JSON.stringify(planWith("lu-archive", [scope("Guarded baselines"), scope("Lab")]));
  const refusedScopes = await job(page, [twoScopes, twoScopes]);
  check("a two-scope plan is refused by the output contract (SCHEMA_REJECTED)", refusedScopes.result.outcome === "attempts-exhausted" && refusedScopes.result.code === "SCHEMA_REJECTED", JSON.stringify(refusedScopes.result));
  check("...and never reached the browser", proofs === before, `${proofs - before} proofs ran`);
  before = proofs;
  const longValue = await job(page, [JSON.stringify(planWith(longestCandidate, [])), PLANS.notJson]);
  check("a plan carrying a 200-character captured value passes the contract and compiler to the proof", proofs === before + 1 && longValue.result.attempts[0]?.stage === "proof", JSON.stringify(longValue.result));
  await page.close();

  // ── 18. D1 (owner decision A+B): what a request may offer about a container, and nothing else ────
  console.log("\n18 — D1 A+B: only an authored container name or a stable container test id is offered, and only an offered scope is proposed");
  const d1 = (containers: Array<Record<string, unknown>>) =>
    sanitizeUpgradeContext({ target: { tag: "button", role: "button", name: "Call" }, containers }, { pageAlias: "lab", frameDepth: 0 })?.containers ?? [];
  const regionRaw = { kind: "landmark", tag: "section", role: "region", name: "Billing address", nameSource: "aria-label", testId: "lu-scope-billing", text: "Billing address Edit address" };
  const itemRaw = { kind: "listItem", tag: "li", role: "listitem", name: "Alice Smith Call", nameSource: "content", testId: "slot-primary", text: "Alice Smith Call" };
  const rowRaw = { kind: "row", tag: "tr", role: "row", name: "Invoice INV-2001 Edit Void", nameSource: "content", testId: "", text: "Invoice INV-2001 Edit Void" };
  const [region, item, contentRow] = d1([regionRaw, itemRaw, rowRaw]);
  check("B: a region's aria-label name is offered", region?.authoredName === true, JSON.stringify(region));
  check("A: ...and its test id, whose one word also on the page is in its authored name", region?.testId === "lu-scope-billing", JSON.stringify(region));
  check("A: a list item's stable test id is offered, its computed name is not", item?.testId === "slot-primary" && item.authoredName === undefined, JSON.stringify(item));
  check("B: a row's name computed from its cells is kept for the Spy to show, never offered", Boolean(contentRow?.name.includes("INV-2001")) && contentRow?.authoredName === undefined && contentRow.testId === undefined, JSON.stringify(contentRow));
  const refusedIds = d1([
    { kind: "row", role: "row", name: "", testId: "spy-row-2003", text: "Invoice INV-2003 Archive" },
    { kind: "listItem", role: "listitem", name: "", testId: "contact-carol-white", text: "Carol White Call" },
    { kind: "card", role: "", name: "", testId: "token-abcdefgh", text: "Settings" },
    { kind: "form", role: "form", name: "", testId: "billing panel", text: "Pay" },
    { kind: "landmark", role: "region", name: "", testId: "billing-panel" }
  ]);
  check(
    "A: a record-keyed (digits or the record's own words), secret-shaped, malformed or unverifiable test id is never offered",
    refusedIds.length === 5 && refusedIds.every((container) => container.testId === undefined),
    JSON.stringify(refusedIds)
  );
  const names = d1([
    { kind: "listItem", role: "listitem", name: "Dan Brown", nameSource: "aria-label", text: "Dan Brown Call" },
    { kind: "row", role: "row", name: "Invoice 2002", nameSource: "aria-label", text: "Paid Edit" },
    { kind: "listItem", role: "listitem", name: "Contact dan@example.com", nameSource: "aria-label", text: "Dan Brown Call" },
    { kind: "row", role: "row", name: "Paid", nameSource: "aria-label" },
    { kind: "listItem", role: "listitem", name: "Night shift", nameSource: "aria-labelledby", text: "Carol White Call" },
    { kind: "dialog", role: "dialog", name: "Confirm discount", nameSource: "aria-label", text: "Confirm discount Apply Keep" }
  ]);
  check(
    "B: a record's authored name that repeats its data, carries a record key, is sensitive, or cannot be checked is never offered",
    names.slice(0, 4).every((container) => container.authoredName === undefined),
    JSON.stringify(names.slice(0, 4))
  );
  check("B: ...while a record's own authored label and a dialog's authored name are", names[4]?.authoredName === true && names[5]?.authoredName === true, JSON.stringify(names.slice(4)));
  // Not a record, so only the name's source keeps its content out: a section with no label is named by
  // everything inside it, row text included.
  const structuralNames = d1([
    { kind: "landmark", role: "region", name: "Invoices Invoice INV-2001 Edit Void", nameSource: "content", text: "Invoices Invoice INV-2001 Edit Void" },
    { kind: "dialog", role: "dialog", name: "Refund Alice Smith", nameSource: "content", text: "Refund Alice Smith Confirm" }
  ]);
  check(
    "B: a section's or dialog's name computed from its content is never offered, although neither is a record",
    structuralNames.length === 2 && structuralNames.every((container) => container.authoredName === undefined),
    JSON.stringify(structuralNames)
  );

  const d1Captured = sanitizeUpgradeContext({ target: { tag: "button", role: "button", name: "Call" }, containers: [itemRaw, regionRaw] }, { pageAlias: "lab", frameDepth: 0 });
  if (!d1Captured) throw new Error("the D1 capture did not sanitize");
  const d1Context = markBoundValues(d1Captured, ["lu-scope-billing"]);
  const d1Text = locatorAttemptJob({ requestId: "req-18", step: archive, boundValues: [], upgradeContext: d1Context }, [], "req-18.a1").prompt.fields[0].text ?? "";
  check("the request offers the stable test id as a ready scope", d1Text.includes('container: listItem listitem scope {"kind":"listItem","strategy":"testId","value":"slot-primary"}'), d1Text);
  check("...and the authored name as a ready role scope", d1Text.includes('scope {"kind":"landmark","strategy":"role","value":"region","name":"Billing address"}'), d1Text);
  check("...never a test id marked as a bound value, which is named by its field only", !d1Text.includes("lu-scope-billing") && d1Text.includes("containers.1.testId"), d1Text);
  check("...and never the list item's computed name", !d1Text.includes("Alice Smith"), d1Text);
  const structural = sanitizeUpgradeContext(
    { target: { tag: "button", role: "button", name: "Call" }, candidates: [{ strategy: "css", value: '[data-testid="contact-2004"] button', count: 1, fallback: false }, { strategy: "role", value: "button", name: "Call", count: 4 }] },
    { pageAlias: "lab", frameDepth: 0 }
  );
  const structuralText = structural ? (locatorAttemptJob({ requestId: "req-18s", step: archive, boundValues: [], upgradeContext: structural }, [], "req-18s.a1").prompt.fields[0].text ?? "") : "";
  check(
    "a candidate the compiler would refuse as written is never shown, so a structural CSS path cannot carry a container's record-keyed id",
    structuralText.includes('candidate: {"strategy":"role","value":"button","name":"Call"}') && !structuralText.includes("contact-2004"),
    structuralText
  );

  const compiledScope = (scopeSpec: Record<string, unknown>) => {
    const compiled = compileLocatorPlan({ version: 1, target: { strategy: "role", value: "button", name: "Call" }, scopes: [scopeSpec] }, undefined);
    if (!compiled.ok) throw new Error(`scope fixture did not compile: ${compiled.code}`);
    return compiled.context;
  };
  const scopedBy = (scopeSpec: Record<string, unknown>) => unofferedScopeField(compiledScope(scopeSpec), d1Context);
  check("an offered test id scope is accepted", scopedBy({ kind: "listItem", strategy: "testId", value: "slot-primary" }) === undefined);
  check("an offered authored name is accepted, in any case", scopedBy({ kind: "landmark", strategy: "role", value: "region", name: "billing address" }) === undefined);
  check("a nameless role scope names structure only and is accepted", scopedBy({ kind: "tableRow", strategy: "role", value: "row" }) === undefined);
  check("a sibling's or invented test id is refused", scopedBy({ kind: "listItem", strategy: "testId", value: "slot-backup" }) === "scopes.0.value");
  check("a test id that is a bound value is refused although the page carries it", scopedBy({ kind: "landmark", strategy: "testId", value: "lu-scope-billing" }) === "scopes.0.value");
  check("C is not approved: a row-text scope (hasText) is refused", scopedBy({ kind: "tableRow", strategy: "role", value: "row", hasText: "INV-2001" }) === "scopes.0.hasText");
  check(
    "...and so are a row's computed name and a text scope",
    scopedBy({ kind: "tableRow", strategy: "role", value: "row", name: "Invoice INV-2001 Edit Void" }) === "scopes.0.name" && scopedBy({ kind: "listItem", strategy: "text", value: "Alice Smith" }) === "scopes.0.value"
  );
  check("with no capture, no named scope is offered", unofferedScopeField(compiledScope({ kind: "listItem", strategy: "testId", value: "slot-primary" }), undefined) === "scopes.0.value");

  let d1Proofs = 0;
  const d1Plan = (scopeSpec: Record<string, unknown>) => ({ version: 1, target: { strategy: "role", value: "button", name: "Call", exact: true }, scopes: [scopeSpec] });
  const d1Loop = (plan: unknown, mode: "upgrade" | "repair" = "upgrade") =>
    runLocatorUpgradeAttempts(
      { requestId: "req-d1", mode, step: archive, boundValues: [], upgradeContext: d1Context, userRequested: true, maxAttempts: 1 },
      {
        ai: {
          submit: async () => ({ status: "ok", value: plan, modelId: "stub", usage: { promptTokens: 1, outputTokens: 1, firstTokenMs: 0, generationMs: 0 }, yields: 0 }),
          cancel: () => false
        },
        prove: async () => {
          d1Proofs += 1;
          return { schemaVersion: 1, outcome: "rejected", code: "WRONG_ELEMENT", compiled: true, intent: "passed", gates: { policy: "pass", buildable: "pass", unique: "pass", sameElement: "fail" }, scope: "compatible", pendingEligible: false };
        },
        annotate: async () => ({ code: "OK" as const })
      }
    );
  const unofferedRun = await d1Loop(d1Plan({ kind: "listItem", strategy: "testId", value: "slot-backup" }));
  check(
    "the loop refuses an unoffered scope at intent (SCOPE_NOT_OFFERED), spending the attempt",
    unofferedRun.attempts[0]?.stage === "intent" && unofferedRun.attempts[0].code === "SCOPE_NOT_OFFERED" && unofferedRun.attempts[0].field === "scopes.0.value" && unofferedRun.attemptsUsed === 1,
    JSON.stringify(unofferedRun)
  );
  check("...and it never reached the browser", d1Proofs === 0, String(d1Proofs));
  check("...and the next attempt is told why, by code and field only", buildAttemptFeedback(unofferedRun.attempts).includes("SCOPE_NOT_OFFERED) on scopes.0.value — a scope must be one of the offered container scopes") && !buildAttemptFeedback(unofferedRun.attempts).includes("slot-backup"));
  await d1Loop(d1Plan({ kind: "listItem", strategy: "testId", value: "slot-primary" }));
  check("an offered scope goes on to the browser proof, which stays authoritative", d1Proofs === 1, String(d1Proofs));
  await d1Loop(d1Plan({ kind: "listItem", strategy: "testId", value: "slot-backup" }), "repair");
  check("(scope) §8 repair has no capture to offer from and is unchanged: its scope reaches the proof", d1Proofs === 2, String(d1Proofs));

  // ── 19. verify:ai-spy-live's own classifier applies D1's scope rule before the page ────────────────
  // `classifyAttempts` re-derives each real reply to report why a request was refused, and fails the
  // live run when a plan the page proves right was withheld. A plan D1 withholds is the product's correct
  // refusal, so it must never count as one, however well the page would match it. Real Chromium on
  // the Element Spy lab; the replies are scripted plan text, so no model is asked.
  console.log("\n19 — verify:ai-spy-live's classifier: a scope D1 withholds is the product's refusal, never a right plan withheld");
  const spyUrl = `${BASE}${SPY_LAB}`;
  const spyCapture = (target: string, containers: Array<Record<string, unknown>>) =>
    sanitizeUpgradeContext({ target: { tag: "button", role: "button", name: target }, containers }, { pageAlias: "main", frameDepth: 0 });
  const primaryItem = { kind: "listItem", tag: "li", role: "listitem", name: "Alice Smith Call", nameSource: "content", testId: "slot-primary", text: "Alice Smith Call" };
  const nightItem = { kind: "listItem", tag: "li", role: "listitem", name: "Night shift", nameSource: "aria-label", testId: "contact-carol-white", text: "Carol White Call" };
  const contacts = { kind: "landmark", tag: "section", role: "region", name: "On-call contacts", nameSource: "aria-labelledby", testId: "spy-contacts", text: "On-call contacts Alice Smith Call Bob Jones Call Carol White Call Dan Brown Call" };
  const primaryCapture = spyCapture("Call", [primaryItem, contacts]);
  const nightCapture = spyCapture("Call", [nightItem, contacts]);
  const offeredOf = (capture: UpgradeContext | undefined) => JSON.stringify(offeredContainerScopes(capture).flat().map((scope) => [scope.strategy, scope.value, scope.name ?? null]));
  check(
    "(precondition) the capture offers the Call's own slot-primary and the section, never the item's computed name",
    offeredOf(primaryCapture) === JSON.stringify([["testId", "slot-primary", null], ["testId", "spy-contacts", null], ["role", "region", "On-call contacts"]]),
    offeredOf(primaryCapture)
  );
  check(
    "(precondition) ...and for Night shift its authored name, never its record-keyed test id",
    offeredOf(nightCapture) === JSON.stringify([["role", "listitem", "Night shift"], ["testId", "spy-contacts", null], ["role", "region", "On-call contacts"]]),
    offeredOf(nightCapture)
  );
  const callBaseline = { strategy: "role", value: "button", name: "Call", exact: true } as const;
  const callIn = (scopeSpec: Record<string, unknown>) => JSON.stringify({ version: 1, target: { strategy: "role", value: "button", name: "Call", exact: true }, scopes: [scopeSpec] });
  const replies = (...texts: string[]): HostAttempt[] => texts.map((text, index) => ({ attempt: index + 1, ok: true, text }));
  const rowText = callIn({ kind: "listItem", strategy: "role", value: "listitem", hasText: "Alice Smith" });
  const ownRecordKey = callIn({ kind: "listItem", strategy: "testId", value: "contact-carol-white" });
  const pageSays = async (plan: string, intended: string) => {
    const compiled = compileLocatorPlan(JSON.parse(plan), undefined);
    if (!compiled.ok) throw new Error(`fixture plan did not compile: ${compiled.code}`);
    const verdict = await judge(liveBrowser(), spyUrl, { candidate: compiled.candidate, ...(compiled.context ? { context: compiled.context } : {}), meaningChange: false });
    return verdict.matches === 1 && verdict.selected === intended;
  };
  check("(precondition) asked directly, the page proves the row-text plan and the record-key plan ARE the inspected Calls", (await pageSays(rowText, "call-primary")) && (await pageSays(ownRecordKey, "call-night")));

  // 1 and 4: a correct target through a withheld scope, then a sibling's and an invented id, each twice.
  const withheld = await classifyAttempts(liveBrowser(), spyUrl, replies(rowText, rowText), callBaseline, "call-primary", primaryCapture);
  check(
    "a row-text scope is the product's SCOPE_NOT_OFFERED refusal on its hasText, both times (the rule comes before the duplicate rule, as in the loop)",
    withheld.lines.length === 2 && withheld.lines.every((line) => / intent SCOPE_NOT_OFFERED on scopes\.0\.hasText .*withheld by D1$/.test(line)),
    withheld.lines.join(" | ")
  );
  check("...never judged by the page, and never counted a right plan withheld", withheld.rightButWithheld === 0 && !withheld.lines.some((line) => line.includes("→ page:")), withheld.lines.join(" | "));
  check("...and the line shapes the row text, never shows it", !withheld.lines.some((line) => /Alice|Smith/.test(line)), withheld.lines.join(" | "));
  const recordKey = await classifyAttempts(liveBrowser(), spyUrl, replies(ownRecordKey), callBaseline, "call-night", nightCapture);
  check(
    "the item's own record-keyed test id, which the page proves, is refused SCOPE_NOT_OFFERED on its value and not counted",
    recordKey.rightButWithheld === 0 && / intent SCOPE_NOT_OFFERED on scopes\.0\.value .*withheld by D1$/.test(recordKey.lines[0] ?? "") && !recordKey.lines[0]?.includes("carol"),
    recordKey.lines.join(" | ")
  );
  const invented = await classifyAttempts(
    liveBrowser(),
    spyUrl,
    replies(callIn({ kind: "listItem", strategy: "testId", value: "slot-backup" }), callIn({ kind: "listItem", strategy: "testId", value: "slot-tertiary" })),
    callBaseline,
    "call-primary",
    primaryCapture
  );
  check(
    "a sibling's and an invented test id are refused before the page: a browser match cannot authorize a scope the request never offered",
    invented.lines.length === 2 && invented.lines.every((line) => / intent SCOPE_NOT_OFFERED on scopes\.0\.value /.test(line) && !line.includes("→ page:")) && invented.rightButWithheld === 0,
    invented.lines.join(" | ")
  );
  // The codes verify:ai-spy-live's saved evidence keeps (spyLiveEvidence.mts): the same decisions, as records.
  const coded = (records: readonly AttemptRecord[]) => JSON.stringify(records.map((r) => [r.attempt, r.responded, r.host, r.contract, r.strategy, r.scope, r.refusal, r.field, r.page, r.matches, r.target]));
  const d1Refused = (attempt: number, scope: string, field: string) => [attempt, true, null, "pass", "role", scope, "intent:SCOPE_NOT_OFFERED", field, null, null, null];
  check(
    "the records keep each D1 refusal as codes: intent SCOPE_NOT_OFFERED on its field, the scope's category, no page verdict and no text",
    coded(withheld.records) === JSON.stringify([d1Refused(1, "row-content", "scopes.0.hasText"), d1Refused(2, "row-content", "scopes.0.hasText")]) &&
      coded(recordKey.records) === JSON.stringify([d1Refused(1, "not-offered", "scopes.0.value")]) &&
      coded(invented.records) === JSON.stringify([d1Refused(1, "not-offered", "scopes.0.value"), d1Refused(2, "not-offered", "scopes.0.value")]) &&
      !/Alice|Smith|carol|slot-/.test(JSON.stringify([withheld.records, recordKey.records, invented.records])),
    `${coded(withheld.records)} ${coded(recordKey.records)} ${coded(invented.records)}`
  );

  // 2 (C): an offered scope that proves the inspected element stays counted, test id and authored name alike.
  const offeredId = await classifyAttempts(liveBrowser(), spyUrl, replies(callIn({ kind: "listItem", strategy: "testId", value: "slot-primary" })), callBaseline, "call-primary", primaryCapture);
  check("an offered test id scope that the page proves is still counted a right plan", offeredId.rightButWithheld === 1 && /→ page: THE INSPECTED ELEMENT$/.test(offeredId.lines[0] ?? ""), offeredId.lines.join(" | "));
  const offeredName = await classifyAttempts(liveBrowser(), spyUrl, replies(callIn({ kind: "listItem", strategy: "role", value: "listitem", name: "Night shift" })), callBaseline, "call-night", nightCapture);
  check("...and so is an offered authored name", offeredName.rightButWithheld === 1 && /→ page: THE INSPECTED ELEMENT$/.test(offeredName.lines[0] ?? ""), offeredName.lines.join(" | "));

  // A and 3 (D): offered but not proven. The section holds all four Calls; a capture that misattributes the
  // sibling's slot as the item's own lets that scope through, and the page still names the sibling.
  const section = await classifyAttempts(liveBrowser(), spyUrl, replies(callIn({ kind: "landmark", strategy: "testId", value: "spy-contacts" })), callBaseline, "call-primary", primaryCapture);
  check("an offered scope that is not unique reaches the page and is judged NOT_UNIQUE, not right", section.rightButWithheld === 0 && /→ page: NOT_UNIQUE \(4\)$/.test(section.lines[0] ?? ""), section.lines.join(" | "));
  const misattributed = spyCapture("Call", [{ ...primaryItem, testId: "slot-backup" }]);
  const sibling = await classifyAttempts(liveBrowser(), spyUrl, replies(callIn({ kind: "listItem", strategy: "testId", value: "slot-backup" })), callBaseline, "call-primary", misattributed);
  check("an offered scope that finds a sibling is judged WRONG_ELEMENT: the page stays authoritative", sibling.rightButWithheld === 0 && /→ page: WRONG_ELEMENT \(call-backup\)$/.test(sibling.lines[0] ?? ""), sibling.lines.join(" | "));
  const judged = (scope: string, page: string, matches: number, target: string) => [[1, true, null, "pass", "role", scope, null, null, page, matches, target]];
  check(
    "the records of the judged plans keep the page's verdict as codes: the inspected element, not unique (4), and a sibling as another element",
    coded(offeredId.records) === JSON.stringify(judged("offered", "INSPECTED_ELEMENT", 1, "intended")) && coded(offeredName.records) === JSON.stringify(judged("offered", "INSPECTED_ELEMENT", 1, "intended")) &&
      coded(section.records) === JSON.stringify(judged("offered", "CANDIDATE_NOT_UNIQUE", 4, "not-unique")) && coded(sibling.records) === JSON.stringify(judged("offered", "WRONG_ELEMENT", 1, "other")),
    `${coded(offeredId.records)} ${coded(section.records)} ${coded(sibling.records)}`
  );

  // 5 and E: no scope on a unique target is untouched by the rule; contract and compiler refusals keep their own class.
  const saveCapture = spyCapture("Save profile", [{ kind: "landmark", tag: "section", role: "region", name: "Account settings", nameSource: "aria-labelledby", testId: "spy-unique", text: "Account settings Save profile Display name" }]);
  const unscoped = await classifyAttempts(
    liveBrowser(),
    spyUrl,
    replies(PLANS.notJson, PLANS.positional, '{"version":1,"target":{"strategy":"testId","value":"spy-save-profile"},"scopes":[]}'),
    { strategy: "testId", value: "spy-save-profile" } as const,
    "save-profile",
    saveCapture
  );
  check(
    "an unscoped plan for a unique element is judged, not refused, and counted right",
    unscoped.rightButWithheld === 1 && /^attempt 3: compiled .*→ page: THE INSPECTED ELEMENT$/.test(unscoped.lines[2] ?? "") && !unscoped.lines.some((line) => line.includes("SCOPE_NOT_OFFERED")),
    unscoped.lines.join(" | ")
  );
  check(
    "...while an unparsable reply and a positional plan stay contract and compiler refusals",
    /^attempt 1: [A-Z_]+ \(/.test(unscoped.lines[0] ?? "") && /^attempt 2: compiler /.test(unscoped.lines[1] ?? ""),
    unscoped.lines.join(" | ")
  );
  const hostThenTwice = await classifyAttempts(
    liveBrowser(),
    spyUrl,
    [{ attempt: 1, ok: false, reason: "AI_CANCELLED" }, ...replies(callIn({ kind: "listItem", strategy: "testId", value: "slot-primary" }), callIn({ kind: "listItem", strategy: "testId", value: "slot-primary" })).map((r) => ({ ...r, attempt: r.attempt + 1 }))],
    callBaseline,
    "call-primary",
    primaryCapture
  );
  const [contract, positional, unscopedRight] = unscoped.records;
  check(
    "the records keep a contract refusal, a compiler refusal (not compiled), an unscoped plan, a host refusal and a duplicate each apart",
    contract?.responded === true && /^[A-Z_]+$/.test(contract.contract ?? "") && contract.contract !== "pass" && contract.strategy === null && contract.page === null &&
      positional?.contract === "pass" && positional.scope === "not-compiled" && /^compiler:[A-Z_]+$/.test(positional.refusal ?? "") && positional.page === null &&
      JSON.stringify(unscopedRight) === JSON.stringify({ attempt: 3, responded: true, host: null, contract: "pass", strategy: "testId", scope: "none", refusal: null, field: null, page: "INSPECTED_ELEMENT", matches: 1, target: "intended" }) &&
      coded(hostThenTwice.records) ===
        JSON.stringify([[1, false, "AI_CANCELLED", null, null, null, null, null, null, null, null], judged("offered", "INSPECTED_ELEMENT", 1, "intended")[0].map((v, i) => (i === 0 ? 2 : v)), [3, true, null, "pass", "role", "offered", "duplicate:DUPLICATE_CANDIDATE", null, null, null, null]]),
    `${coded(unscoped.records)} ${coded(hostThenTwice.records)}`
  );
} finally {
  await browser?.close().catch(() => undefined);
  server?.kill();
}

console.log(`\nL3 §7 bounded attempts: ${passed}/${passed + failed} checks passed.`);
process.exit(failed === 0 ? 0 : 1);
