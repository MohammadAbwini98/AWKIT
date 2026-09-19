/**
 * verify:locator-upgrade-proof — Phase L L3 §4 browser proof gates and §5 pending upgrades with replay
 * proof, against real Chromium on the Feature Test Lab page /recorder-lab/locator-upgrade.
 *
 * Real layers: the trusted compiler and intent guard (`src/ai/locatorPlan.ts`), the output contract
 * (`parseAiOutput`), `proveLocatorPlan`/`replayPendingUpgrade` (`src/runner/locatorProof.ts`) over the real
 * `LocatorFactory`, the real Recorder capture + `buildRecordedFlow` for guarded baselines, `StepExecutor`
 * for replays, `FileLocatorRecoveryStore` for tallies, `JsonProfileStore` + the Flow Designer save
 * mapping for persistence. The only fake is the AI provider: a fixed table of plan TEXT, parsed by the
 * real output contract exactly as model output would be.
 *
 * What makes it fail: a unique candidate on the wrong element, an ambiguous candidate, a frame or shadow
 * scope the capture did not prove, a bound-data scope, a policy-forbidden step or surface, or a vanished
 * target proving; the proof clicking anything; a pending candidate executing; a failed or refused replay
 * counting; a stale or superseded candidate overwriting a newer step; the saved locator changing.
 *
 * Run: npm run verify:locator-upgrade-proof
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { parseAiOutput } from "@src/ai/AiOutputContract";
import { LOCATOR_PLAN_SCHEMA, compileLocatorPlan } from "@src/ai/locatorPlan";
import {
  annotatePendingUpgrade,
  attachPendingUpgrade,
  createPendingUpgrade,
  evaluatePendingUpgrade,
  mergeReplayProof,
  type LocatorReplayProofRecord
} from "@src/ai/pendingUpgrade";
import type { FlowProfile, FlowStep, PendingLocatorUpgrade, StepLocator } from "@src/profiles/FlowProfile";
import { hasPositionalIdentityGuard } from "@src/profiles/locatorApproval";
import { buildRecordedFlow } from "@src/recorder/buildRecordedFlow";
import { getRecorderInitScriptContent } from "@src/recorder/recorderInitScript";
import type { RecordedAction } from "@src/recorder/RecorderTypes";
import { sanitizeUpgradeContext } from "@src/recorder/upgradeContext";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { FileLocatorRecoveryStore } from "@src/runner/LocatorRecoveryStore";
import {
  observePendingReplay,
  pendingUpgradeDigests,
  recordPendingReplay,
  proveCompiledCandidate,
  proveLocatorPlan,
  replayPendingUpgrade,
  type LocatorProofResult
} from "@src/runner/locatorProof";
import { StepExecutor } from "@src/runner/StepExecutor";
import { ValueResolver } from "@src/runner/ValueResolver";
import { decideAiAction } from "@src/security/authz/AiAutonomyPolicy";
import { JsonProfileStore } from "@src/storage/ProfileStore";
import { toDesignerDocument, toFlowProfile } from "../app/renderer/components/workflow/flowProfileMapping";

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
const expect = (label: string, result: LocatorProofResult, outcome: string, code: string): void =>
  check(`${label} → ${outcome} ${code}`, result.outcome === outcome && result.code === code, JSON.stringify(result));

/** The deterministic stand-in for the model: plan TEXT, parsed by the real output contract. */
const PROVIDER: Record<string, string> = {
  archiveRole: '{"version":1,"target":{"strategy":"role","value":"button","name":"Archive","exact":true},"scopes":[]}',
  gammaTestId: '{"version":1,"target":{"strategy":"testId","value":"lu-open-gamma"},"scopes":[]}',
  openAny: '{"version":1,"target":{"strategy":"role","value":"button","name":"Open"},"scopes":[]}',
  openBeta: '{"version":1,"target":{"strategy":"role","value":"button","name":"Open Beta","exact":true},"scopes":[]}',
  removeExact: '{"version":1,"target":{"strategy":"role","value":"button","name":"Remove","exact":true},"scopes":[]}',
  frameConfirm: '{"version":1,"target":{"strategy":"testId","value":"lu-frame-confirm"},"scopes":[]}',
  shadowSave: '{"version":1,"target":{"strategy":"role","value":"button","name":"Shadow save"},"scopes":[]}',
  aliceDelete: '{"version":1,"target":{"strategy":"role","value":"button","name":"Delete"},"scopes":[{"kind":"tableRow","strategy":"role","value":"row","hasText":"Alice Smith"}]}',
  inventedFrame: '{"version":1,"target":{"strategy":"testId","value":"lu-frame-confirm"},"scopes":[],"frameChain":[{"selector":"iframe"}]}',
  truncated: '{"version":1,"target":{"strategy":"role"'
};
function propose(key: string): unknown {
  const parsed = parseAiOutput(PROVIDER[key], LOCATOR_PLAN_SCHEMA);
  // The invented-frame case is kept raw so the compiler, not the output contract, is what refuses it.
  if (!parsed.ok) return key === "inventedFrame" ? JSON.parse(PROVIDER[key]) : undefined;
  return parsed.value;
}

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
const work = await mkdtemp(join(tmpdir(), "awkit-l3-proof-"));

async function freshPage(): Promise<Page> {
  const context = await liveBrowser().newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(3_000);
  await page.goto(LAB);
  await page.frameLocator('iframe[name="lu-frame"]').getByTestId("lu-frame-confirm").waitFor();
  return page;
}
const result = (page: Page): Promise<string | null> => page.getByTestId("lu-result").textContent();

function step(id: string, locator: StepLocator, extra: Partial<FlowStep> = {}): FlowStep {
  return { id, type: "click", name: `Open item ${id}`, locator, ...extra };
}
const cardsBaseline = (): StepLocator => ({ strategy: "css", value: ".lu-card:nth-child(2) .lu-open" });
const ordersBaseline = (): StepLocator => ({ strategy: "css", value: 'table[aria-label="Orders"] tr:nth-child(1) button' });
const frameBaseline = (): StepLocator => ({
  strategy: "css",
  value: "#confirm",
  context: { frameChain: [{ selector: 'iframe[name="lu-frame"]', name: "lu-frame" }] }
});
const shadowBaseline = (): StepLocator => ({
  strategy: "css",
  value: "button.save",
  context: { shadow: { boundary: "open", hosts: [{ strategy: "testId", value: "lu-shadow-host" }] } }
});

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

function makeContext(currentRow?: unknown): InstanceExecutionContext {
  return {
    executionId: "exec-l3",
    instanceId: "inst-l3",
    scenarioId: "scen-l3",
    flowId: "flow-l3",
    instanceOrderNumber: 1,
    totalInstances: 1,
    runtimeInputs: {},
    instanceInputs: {},
    flowOutputs: {},
    ...(currentRow !== undefined ? { currentRow } : {}),
    paths: { downloads: join(work, "d"), screenshots: join(work, "s"), logs: join(work, "l"), reports: join(work, "r") }
  };
}

async function runStep(page: Page, target: FlowStep, store: FileLocatorRecoveryStore | undefined, currentRow?: unknown) {
  const context = makeContext(currentRow);
  const factory = new LocatorFactory(page, store ? { recoveryStore: store, scope: { scenarioId: context.scenarioId, flowId: context.flowId } } : {});
  return new StepExecutor(page, factory, new ValueResolver(context), context).execute(target);
}

function pendingFor(target: FlowStep, key: string, createdAt: Date, proof: PendingLocatorUpgrade["proof"] = "capture-proven"): PendingLocatorUpgrade {
  const compiled = compileLocatorPlan(propose(key), target.locator?.context);
  if (!compiled.ok) throw new Error(`fixture ${key} did not compile: ${compiled.code}`);
  const pending = createPendingUpgrade({ step: target, compiled, meaningChange: false, proof, modelId: "fake-provider", now: createdAt });
  if (!pending) throw new Error("no pending upgrade");
  return pending;
}
const withPending = (target: FlowStep, pending: PendingLocatorUpgrade): FlowStep => ({ ...target, locator: { ...target.locator!, pendingUpgrade: pending } });

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

  // ── Real Recorder baselines ────────────────────────────────────────────────────────────────────
  console.log("\nRecorder-captured guarded baselines");
  const archive = await capture((page) => page.getByRole("button", { name: "Archive" }).click(), "Archive item");
  check("Archive (hidden duplicate) is captured as a guarded position", hasPositionalIdentityGuard(archive), JSON.stringify(archive.locator));
  const twin = await capture((page) => page.locator(".lu-twins button").nth(1).click(), "Remove second");
  check("the second identical twin is captured as a guarded position", hasPositionalIdentityGuard(twin), JSON.stringify(twin.locator));

  // ── §4 proof gates ─────────────────────────────────────────────────────────────────────────────
  console.log("\n§4 browser proof gates");
  let page = await freshPage();
  const archiveProof = await proveLocatorPlan(page, archive, propose("archiveRole"), { boundValues: [] });
  expect("role=button Archive over the guarded baseline", archiveProof, "proven", "PROVEN");
  check("...every gate passed and the scope is compatible", Object.values(archiveProof.gates).every((g) => g === "pass") && archiveProof.scope === "compatible" && archiveProof.candidateMatchCount === 1 && archiveProof.baselineMatchCount === 1);
  check("...the result carries a digest, never candidate text", /^[0-9a-f]{64}$/.test(archiveProof.candidateDigest ?? "") && !JSON.stringify(archiveProof).includes("Archive"));
  const wrong = await proveLocatorPlan(page, archive, propose("gammaTestId"), { boundValues: [] });
  expect("a unique test id on a DIFFERENT element", wrong, "rejected", "WRONG_ELEMENT");
  check("...uniqueness passed, identity failed", wrong.gates.unique === "pass" && wrong.gates.sameElement === "fail" && !wrong.pendingEligible);
  expect("impossible identical twins", await proveLocatorPlan(page, twin, propose("removeExact"), { boundValues: [] }), "rejected", "CANDIDATE_NOT_UNIQUE");
  const cards = step("cards", cardsBaseline());
  expect("role=button Open matches every card", await proveLocatorPlan(page, cards, propose("openAny"), { boundValues: [] }), "rejected", "CANDIDATE_NOT_UNIQUE");
  expect("Open Beta over the positional card baseline", await proveLocatorPlan(page, cards, propose("openBeta"), { boundValues: [] }), "proven", "PROVEN");
  const frame = step("frame", frameBaseline());
  expect("a frame test id proven inside the captured frame (a parent twin exists)", await proveLocatorPlan(page, frame, propose("frameConfirm"), { boundValues: [] }), "proven", "PROVEN");
  expect("a plan inventing a frame", await proveLocatorPlan(page, frame, propose("inventedFrame"), { boundValues: [] }), "rejected", "INVENTED_FRAME");
  const topCompiled = compileLocatorPlan(propose("frameConfirm"), undefined);
  if (!topCompiled.ok) throw new Error("top-level fixture did not compile");
  const topMismatch = await proveCompiledCandidate(page, frame, topCompiled, { meaningChange: false });
  expect("a candidate compiled for the top document against a framed step", topMismatch, "rejected", "FRAME_CONTEXT_MISMATCH");
  check("...refused at the policy gate before any browser gate ran", topMismatch.gates.policy === "fail" && topMismatch.gates.sameElement === "not-run");
  const shadow = step("shadow", shadowBaseline());
  expect("a role candidate inside the captured open shadow root", await proveLocatorPlan(page, shadow, propose("shadowSave"), { boundValues: [] }), "proven", "PROVEN");
  const closed = step("closed", { strategy: "css", value: "button", context: { shadow: { boundary: "closed", instrumented: true, hosts: [{ strategy: "testId", value: "lu-closed-host" }] } } });
  expect("a closed-shadow target", await proveLocatorPlan(page, closed, propose("shadowSave"), { boundValues: [] }), "rejected", "UNSUPPORTED");
  const orders = step("orders", ordersBaseline());
  const bound = await proveLocatorPlan(page, orders, propose("aliceDelete"), { boundValues: ["Alice Smith"] });
  expect("row text equal to a bound data value", bound, "rejected", "INTENT_BOUND_VALUE");
  check("...refused by the intent guard at a field path, never the value", bound.intent === "rejected" && bound.field === "scopes.0.hasText" && !JSON.stringify(bound).includes("Alice"));
  const rowScoped = await proveLocatorPlan(page, orders, propose("aliceDelete"), { boundValues: [] });
  expect("the same row scope with no bound value", rowScoped, "proven", "PROVEN");
  check("...is a meaning change (position → text), so policy only suggests", rowScoped.meaningChange === true && decideAiAction("locatorSemanticUpgrade", "locatorChange", { step: orders, meaningChange: true, proofSatisfied: true }, { enabled: true }).decision === "suggest");
  expect("a sensitive step", await proveLocatorPlan(page, { ...cards, name: "Delete account" }, propose("openBeta"), { boundValues: [] }), "rejected", "T3_SENSITIVE_STEP");
  expect("a protected-login step type", await proveLocatorPlan(page, { ...cards, type: "reuseSession" } as FlowStep, propose("openBeta"), { boundValues: [] }), "rejected", "T3_PROTECTED_LOGIN");
  expect("model output truncated by the provider", await proveLocatorPlan(page, cards, propose("truncated"), { boundValues: [] }), "rejected", "MALFORMED");
  const oldContext = sanitizeUpgradeContext({ target: { tag: "button" } }, { pageAlias: "main", frameDepth: 0 }, new Date(Date.now() - 11 * 60_000));
  expect("an L2 upgrade context older than its 10-minute TTL", await proveLocatorPlan(page, cards, propose("openBeta"), { boundValues: [], upgradeContext: oldContext }), "rejected", "CONTEXT_EXPIRED");
  const topContext = sanitizeUpgradeContext({ target: { tag: "button" } }, { pageAlias: "main", frameDepth: 0 });
  expect("an L2 context captured in the top document for a framed step", await proveLocatorPlan(page, frame, propose("frameConfirm"), { boundValues: [], upgradeContext: topContext }), "rejected", "FRAME_CONTEXT_MISMATCH");
  expect("a fresh top-document L2 context for a top-document step", await proveLocatorPlan(page, cards, propose("openBeta"), { boundValues: [], upgradeContext: topContext }), "proven", "PROVEN");
  check("proof is observational: nothing was clicked", (await result(page)) === "none" && (await page.frameLocator('iframe[name="lu-frame"]').getByTestId("lu-frame-result").textContent()) === "none");
  check("...and nothing navigated", page.url() === LAB);

  console.log("\n§4 lifecycle: DOM changes, navigation, closure");
  await page.getByTestId("lu-add-beta-twin").click();
  expect("Open Beta after a second Beta appears", await proveLocatorPlan(page, cards, propose("openBeta"), { boundValues: [] }), "rejected", "CANDIDATE_NOT_UNIQUE");
  await page.close();
  page = await freshPage();
  await page.getByTestId("lu-rename-beta").click();
  expect("Open Beta after Beta is renamed", await proveLocatorPlan(page, cards, propose("openBeta"), { boundValues: [] }), "rejected", "CANDIDATE_NO_MATCH");
  await page.getByTestId("lu-clear-cards").click();
  const missing = await proveLocatorPlan(page, cards, propose("openBeta"), { boundValues: [] });
  expect("the original target removed", missing, "unprovable-now", "TARGET_MISSING");
  check("...unprovable-now may still be kept as pending (not a rejection)", missing.pendingEligible === true);
  await page.getByTestId("lu-swap-twins").click();
  expect("the twins reordered under a guarded baseline", await proveLocatorPlan(page, twin, propose("removeExact"), { boundValues: [] }), "unprovable-now", "BASELINE_IDENTITY_CHANGED");
  await page.goto(`${BASE}/recorder-lab/locator-quality`);
  expect("after navigating away", await proveLocatorPlan(page, cards, propose("openBeta"), { boundValues: [] }), "unprovable-now", "TARGET_MISSING");
  await page.goto(`${BASE}/mock/protected-login`);
  expect("on a protected sign-in surface", await proveLocatorPlan(page, cards, propose("openBeta"), { boundValues: [] }), "rejected", "T3_PROTECTED_LOGIN");
  await page.close();
  expect("the browser page closed", await proveLocatorPlan(page, cards, propose("openBeta"), { boundValues: [] }), "unprovable-now", "PAGE_UNAVAILABLE");

  // ── §5 pending upgrades: creation and persistence ──────────────────────────────────────────────
  console.log("\n§5 pending upgrade: creation, persistence, staleness, supersession");
  const t0 = new Date("2026-09-19T10:00:00.000Z");
  const t1 = new Date("2026-09-19T10:05:00.000Z");
  const pending = pendingFor(cards, "openBeta", t0);
  check("the pending record has exactly the ratified shape", Object.keys(pending).sort().join() === "binding,candidate,createdAt,meaningChange,modelId,proof,schemaVersion", Object.keys(pending).join());
  check("...and carries no fingerprint, upgrade context or typed value", !/fingerprint|upgradeContext|boundValues|Alice/.test(JSON.stringify(pending)));
  const flows = new JsonProfileStore<FlowProfile>({ folder: join(work, "flows") });
  const flow: FlowProfile = {
    id: "flow-l3",
    name: "L3 proof",
    version: 1,
    nodes: [
      { ...cards, locator: { ...cards.locator!, futureLocatorField: "kept" } as StepLocator },
      { ...cards, id: "danger", name: "Delete account" }
    ],
    edges: []
  };
  await flows.create(flow);
  const write = await annotatePendingUpgrade(flows, "flow-l3", "cards", pending);
  check("annotating through the flow store lane succeeds", write.code === "OK" && write.replaced === false, JSON.stringify(write));
  const reloaded = JSON.parse(await readFile(join(work, "flows", "flow-l3.json"), "utf8")) as FlowProfile;
  const saved = reloaded.nodes[0].locator!;
  check("the pending candidate survives save and reload unchanged", JSON.stringify(saved.pendingUpgrade) === JSON.stringify(pending));
  check("the saved executable locator is unchanged", saved.strategy === "css" && saved.value === cardsBaseline().value && saved.alternatives === undefined);
  check("unknown locator fields are preserved", (saved as StepLocator & { futureLocatorField?: string }).futureLocatorField === "kept");
  check("a T3 (sensitive) step refuses the annotation", (await annotatePendingUpgrade(flows, "flow-l3", "danger", { ...pending, binding: pendingFor({ ...cards, id: "danger", name: "Delete account" }, "openBeta", t0).binding })).code === "T3_SENSITIVE_STEP");
  const older = pendingFor(cards, "openAny", new Date("2026-09-19T09:00:00.000Z"));
  const before = await readFile(join(work, "flows", "flow-l3.json"), "utf8");
  check("an OLDER proposal never overwrites a newer pending candidate", (await annotatePendingUpgrade(flows, "flow-l3", "cards", older)).code === "SUPERSEDED");
  check("...and writes nothing", (await readFile(join(work, "flows", "flow-l3.json"), "utf8")) === before);
  const newer = pendingFor(cards, "openBeta", t1, "unprovable-now");
  check("a newer proposal for the same step supersedes the pending one", (await annotatePendingUpgrade(flows, "flow-l3", "cards", newer)).replaced === true);
  const edited = (await flows.get("flow-l3"))!;
  edited.nodes[0] = { ...edited.nodes[0], locator: { ...edited.nodes[0].locator!, value: ".lu-card:nth-child(3) .lu-open" } };
  const staleBefore = await readFile(join(work, "flows", "flow-l3.json"), "utf8");
  check("a proposal made for the pre-edit step is STALE after the step changed", attachPendingUpgrade(edited, "cards", pendingFor(cards, "openBeta", new Date("2026-09-19T11:00:00.000Z"))).ok === false);
  await flows.update("flow-l3", edited);
  check("...through the lane too (nothing written by the refused proposal)", (await annotatePendingUpgrade(flows, "flow-l3", "cards", pendingFor(cards, "openBeta", new Date("2026-09-19T11:00:00.000Z")))).code === "STALE" && staleBefore !== (await readFile(join(work, "flows", "flow-l3.json"), "utf8")));
  const designer = (profile: FlowProfile): FlowProfile => {
    const doc = toDesignerDocument(profile);
    return toFlowProfile(doc.nodes, doc.edges, profile.id, profile.name, { description: profile.description, version: profile.version });
  };
  const unchanged: FlowProfile = { ...flow, nodes: [withPending(cards, pending)] };
  check("a Flow Designer save of the unchanged step keeps the pending candidate", JSON.stringify(designer(unchanged).nodes[0].locator?.pendingUpgrade) === JSON.stringify(pending));
  const retargeted: FlowProfile = { ...flow, nodes: [{ ...withPending(cards, pending), locator: { ...withPending(cards, pending).locator!, value: "#other" } }] };
  check("a Flow Designer save after retargeting the step drops it", designer(retargeted).nodes[0].locator?.pendingUpgrade === undefined);
  const renamed: FlowProfile = { ...flow, nodes: [{ ...withPending(cards, pending), name: "Open a different item" }] };
  check("...as does renaming the step (the binding covers the name)", designer(renamed).nodes[0].locator?.pendingUpgrade === undefined);

  // ── §5 replay proof through StepExecutor ───────────────────────────────────────────────────────
  console.log("\n§5 replay proof through the real StepExecutor");
  const store = new FileLocatorRecoveryStore(join(work, "memory"));
  // Same shape as LocatorFactory's scope key. The separator is built at runtime: a literal control
  // character in source fails verify:source-hygiene.
  const scopeKey = (id: string): string => ["scen-l3", "flow-l3", id].join(String.fromCharCode(0));
  const evaluate = async (target: FlowStep) => evaluatePendingUpgrade(target, await store.getReplayProof(scopeKey(target.id)), pendingUpgradeDigests(target)!);
  const replayStep = withPending(step("replay", cardsBaseline()), pendingFor(step("replay", cardsBaseline()), "openBeta", t0));

  page = await freshPage();
  let run = await runStep(page, replayStep, store, { id: 1 });
  check("replay 1: the step passes and acts through its OWN locator", run.status === "passed" && (await result(page)) === "open-beta", run.error);
  const first = await evaluate(replayStep);
  check("...pending-replay after one replay on one row", first.state === "pending-replay" && !first.proofSatisfied && first.replays === 1 && first.dataRows === 1, JSON.stringify(first));
  await page.close();
  page = await freshPage();
  await page.getByTestId("lu-disable-beta").click();
  run = await runStep(page, { ...replayStep, timeoutMs: 1_000 }, store, { id: 2 });
  check("a replay whose step FAILS (target disabled) counts nothing", run.status === "failed" && (await store.getReplayProof(scopeKey("replay")))?.proven === 1);
  await page.close();
  // A step can also end without throwing and without passing (skipped, manual handoff): the record
  // hook itself must refuse to count a proof then, not rely on the failure being thrown.
  page = await freshPage();
  const handoff = await observePendingReplay(page, replayStep, makeContext({ id: 9 }), { store, scopeKey: scopeKey("replay") });
  check("...the proof itself was proven before the step ran", handoff?.result.outcome === "proven");
  await recordPendingReplay(handoff!, false);
  check("a proven replay whose step did not pass (e.g. manual handoff) counts nothing", (await store.getReplayProof(scopeKey("replay")))?.proven === 1);
  await page.close();
  for (const row of [{ id: 2 }, { id: 2 }]) {
    page = await freshPage();
    run = await runStep(page, replayStep, store, row);
    await page.close();
  }
  const eligible = await evaluate(replayStep);
  check("3 passing replays over 2 distinct rows → eligible", eligible.state === "eligible" && eligible.proofSatisfied && eligible.replays === 3 && eligible.dataRows === 2, JSON.stringify(eligible));
  check("...which the autonomy policy may auto-apply (T2) — promotion itself is L3 §6", decideAiAction("locatorSemanticUpgrade", "locatorChange", { step: replayStep, meaningChange: eligible.meaningChange, proofSatisfied: eligible.proofSatisfied }, { enabled: true }).decision === "autoApply");
  const tally = (await store.getReplayProof(scopeKey("replay")))!;
  check("the tally holds digests, counts and hashed row keys only", !JSON.stringify(tally).includes("Beta") && tally.dataRowKeys.every((key) => /^[0-9a-f]{24}$/.test(key)));
  page = await freshPage();
  run = await runStep(page, replayStep, store, { id: 3 });
  check("an ELIGIBLE candidate still does not replace the saved locator: the step acts on its own", run.status === "passed" && replayStep.locator!.value === cardsBaseline().value && (await result(page)) === "open-beta");
  await page.close();

  const failing = withPending(step("failing", cardsBaseline()), pendingFor(step("failing", cardsBaseline()), "openBeta", t0));
  page = await freshPage();
  await page.getByTestId("lu-add-beta-twin").click();
  run = await runStep(page, failing, store, { id: 1 });
  check("a replay where the candidate became ambiguous still runs the step on its own locator", run.status === "passed" && (await result(page)) === "open-beta");
  await page.close();
  for (const row of [{ id: 1 }, { id: 2 }, { id: 3 }]) {
    page = await freshPage();
    await runStep(page, failing, store, row);
    await page.close();
  }
  const refused = await evaluate(failing);
  check("one refused replay blocks eligibility even after 3 good ones", refused.state === "replay-rejected" && !refused.proofSatisfied && refused.replays === 3, JSON.stringify(refused));

  const boundStep = withPending(step("bound", ordersBaseline()), pendingFor(step("bound", ordersBaseline()), "aliceDelete", t0));
  page = await freshPage();
  run = await runStep(page, boundStep, store, { customer: "Alice Smith" });
  check("a data row equal to the candidate's row text: the step runs on its own locator", run.status === "passed" && (await result(page)) === "delete-alice");
  check("...and the replay is refused by the intent guard (never promotable)", (await evaluate(boundStep)).state === "replay-rejected" && (await store.getReplayProof(scopeKey("bound")))?.lastCode === "INTENT_BOUND_VALUE");
  await page.close();

  const neverTried = withPending(step("never", { strategy: "css", value: "#lu-missing" }, { timeoutMs: 1_000 }), pendingFor(step("never", { strategy: "css", value: "#lu-missing" }), "openBeta", t0));
  page = await freshPage();
  run = await runStep(page, neverTried, store, { id: 1 });
  check("pending present + primary misses ⇒ the step fails and the pending candidate is never tried", run.status === "failed" && (await result(page)) === "none");
  check("...and no replay is counted", (await store.getReplayProof(scopeKey("never"))) === undefined);
  await page.close();

  const tampered = withPending(step("tampered", frameBaseline()), { ...pendingFor(step("tampered", frameBaseline()), "frameConfirm", t0), context: undefined });
  page = await freshPage();
  expect("a stored candidate whose scope no longer matches the step's frame", await replayPendingUpgrade(page, tampered, { boundValues: [] }), "rejected", "FRAME_CONTEXT_MISMATCH");
  const stale = { ...withPending(step("stale", cardsBaseline()), pendingFor(step("stale", cardsBaseline()), "openBeta", t0)), name: "Renamed without a save" };
  expect("a pending candidate whose binding no longer matches", await replayPendingUpgrade(page, stale, { boundValues: [] }), "rejected", "STALE_PENDING");
  run = await runStep(page, stale, store, { id: 1 });
  check("...the step still runs, and a stale candidate records nothing", run.status === "passed" && (await store.getReplayProof(scopeKey("stale"))) === undefined);
  await page.close();

  page = await freshPage();
  const plain = step("plain", cardsBaseline());
  run = await runStep(page, plain, undefined);
  check("no provider, no pending candidate, no memory: ordinary execution is unchanged", run.status === "passed" && (await result(page)) === "open-beta");
  await page.close();
  page = await freshPage();
  run = await runStep(page, withPending(step("nomem", cardsBaseline()), pendingFor(step("nomem", cardsBaseline()), "openBeta", t0)), undefined);
  check("a pending candidate without locator memory is ignored and the step runs", run.status === "passed" && (await result(page)) === "open-beta");
  await page.close();

  console.log("\n§5 supersession and concurrency of the runtime tally");
  const superseded = withPending(step("replay", cardsBaseline()), pendingFor(step("replay", cardsBaseline()), "archiveRole", t1));
  check("a superseding candidate does not inherit the old candidate's replays", (await evaluate(superseded)).state === "pending-replay" && (await evaluate(superseded)).replays === 0);
  const now = new Date();
  const concurrentKey = scopeKey("concurrent");
  await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      store.updateReplayProof(concurrentKey, (prev: LocatorReplayProofRecord | undefined) =>
        mergeReplayProof(prev, { scopeKey: concurrentKey, candidateDigest: "c", bindingDigest: "b", outcome: "proven", code: "PROVEN", rowKey: `row-${i % 3}`, now })
      )
    )
  );
  const concurrent = await store.getReplayProof(concurrentKey);
  check("12 concurrent replays on one step lose no update", concurrent?.proven === 12 && concurrent.dataRowKeys.length === 3, JSON.stringify(concurrent));
  const memoryFiles = await readdir(join(work, "memory"));
  check("tallies live in the runtime memory subfolder, never beside winner records", memoryFiles.includes("upgrade-proofs") && memoryFiles.every((name) => name === "upgrade-proofs" || name.endsWith(".json")));
} catch (error) {
  failed += 1;
  console.error(`  ✗ unexpected error — ${error instanceof Error ? error.stack : String(error)}`);
} finally {
  await browser?.close().catch(() => undefined);
  server?.kill();
}

console.log(`\nverify:locator-upgrade-proof — ${passed} passed, ${failed} failed`);
if (passed === 0) failed += 1;
process.exit(failed === 0 ? 0 : 1);
