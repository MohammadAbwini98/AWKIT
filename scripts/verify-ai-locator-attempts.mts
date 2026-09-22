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
  runLocatorUpgradeAttempts,
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
  const expected = [`current locator: ${archive.locator?.strategy}, guarded-positional`, "target: tag=button role=button name=Archive", "candidate: role=button name=Archive matches=2", "container: card region Guarded baselines", "heading: Locator Upgrade Lab", "sibling action: Remove", "data-bound, not shown: siblingActions.1"];
  check("...showing the saved locator's strategy and class only, the target, candidate, container, heading and actions", expected.every((line) => typicalShown.includes(`\n${line}\n`)), typicalShown);
  check("...and never the sibling flagged as a bound value", !typicalShown.includes("Swap twins"));

  // A capture at every L2 bound: four distinct 200-character candidates, a Recorder fallback, and
  // more context than fits. Every line is shown whole or not at all.
  const boundRaw = {
    target: { tag: long("button", 20), role: long("button", 30), name: long("Archive the selected order ", 80), type: long("button", 20) },
    candidates: [
      ...["alpha-", "bravo-", "charlie-", "delta-"].map((seed) => ({ strategy: "placeholder", value: long(seed, 200), name: long("Archive ", 80), count: 10_000 })),
      { strategy: "css", value: "main > section:nth-of-type(3) > div.row > button", count: 3, fallback: true }
    ],
    containers: Array.from({ length: 6 }, (_, index) => ({ kind: "listItem", tag: "li", role: long("listitem", 30), name: long(`Panel ${index} of the orders workspace `, 80) })),
    heading: long("Open orders ", 80),
    siblingActions: Array.from({ length: 6 }, (_, index) => long(`Action ${index} for this order `, 60))
  };
  const boundCaptured = sanitizeUpgradeContext(boundRaw, { pageAlias: "lab", frameDepth: 0 });
  if (!boundCaptured) throw new Error("the bound capture did not sanitize");
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
    ...semantic.map((candidate) => `candidate: ${candidate.strategy}=${candidate.value} name=${candidate.name} matches=${candidate.count}`),
    ...boundCaptured.containers.map((container) => `container: ${container.kind} ${container.role} ${container.name}`),
    `heading: ${boundCaptured.heading}`,
    ...boundCaptured.siblingActions.map((action) => `sibling action: ${action}`)
  ]);
  check("at every L2 bound the context stays within its budget and builds whole", boundText.length <= LOCATOR_ATTEMPT_LIMITS.maxContextChars && shownBy(boundJob) !== "", String(boundText.length));
  check("...(precondition) and more was offered than fits, so lines were dropped", boundLines.length < wholeLines.size && boundLines.length > 3, `${boundLines.length} of ${wholeLines.size}`);
  check("...and every line shown is whole, never cut", boundLines.every((line) => wholeLines.has(line)), boundLines.filter((line) => !wholeLines.has(line)).join(" | "));
  check("...with every candidate among them, since they come first", semantic.every((candidate) => boundLines.some((line) => line.startsWith(`candidate: ${candidate.strategy}=${candidate.value} `))));
  check("...and the refusal survives the budget", boundText.includes("refused attempt 1: refused at intent (INTENT_BOUND_VALUE) on scopes.0.hasText"));
  check("a Recorder fallback (structural or positional CSS/XPath) is never shown", !boundText.includes("nth-of-type") && !boundText.includes("(fallback)"));

  const largestText = productLocatorRequest(LARGEST_CONTEXT, [LONGEST_REFUSAL]).prompt.fields[0].text ?? "";
  const largestCaptured = locatorInput(LARGEST_CONTEXT, "req-largest").upgradeContext!;
  check(
    "the largest fixture's request drops nothing: every semantic candidate, action and the heading, whole",
    largestCaptured.candidates.every((candidate) => candidate.fallback !== largestText.includes(`candidate: ${candidate.strategy}=${candidate.value} `)) &&
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
} finally {
  await browser?.close().catch(() => undefined);
  server?.kill();
}

console.log(`\nL3 §7 bounded attempts: ${passed}/${passed + failed} checks passed.`);
process.exit(failed === 0 ? 0 : 1);
