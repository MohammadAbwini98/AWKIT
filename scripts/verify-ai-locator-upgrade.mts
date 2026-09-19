/**
 * verify:ai-locator-upgrade — Phase L L3 §6 controlled promotion, audit and revert, against real
 * Chromium on the Feature Test Lab page /recorder-lab/locator-upgrade.
 *
 * Real layers: the Recorder and `buildRecordedFlow` for a genuine guarded-positional baseline, the
 * trusted compiler (`src/ai/locatorPlan.ts`) parsed by the real output contract, `StepExecutor` +
 * `LocatorFactory` + `FileLocatorRecoveryStore` for replays that earn the evidence, the real
 * `JsonProfileStore` single-writer lane and the Flow Designer save mapping for persistence, the real
 * `AiActionStore` for the audit log, and `revertAiAction` for the one-click revert. The only fake is
 * the AI provider: a fixed table of plan TEXT.
 *
 * What makes it fail: a candidate promoted without replay evidence, with a refused replay, on a
 * sensitive or protected-login step, over an edited step, while the editor has unsaved changes, or
 * automatically on seeded thresholds; a promotion that changes anything but the locator fields, that
 * leaves the old guard in place, that does not execute in Chromium, that does not survive a reload,
 * or whose revert overwrites a newer edit; two concurrent promotions both writing; an audit record
 * that claims a change that did not happen or that carries page text.
 *
 * Run: npm run verify:ai-locator-upgrade
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

import { AiActionStore } from "@src/ai/AiActionStore";
import { parseAiOutput } from "@src/ai/AiOutputContract";
import { revertAiAction } from "@src/ai/AiRevert";
import { LOCATOR_PLAN_SCHEMA, compileLocatorPlan } from "@src/ai/locatorPlan";
import {
  describeFlowLocatorUpgrades,
  promoteLocatorUpgrade,
  selectReplayEvidence,
  type LocatorPromotionMode,
  type LocatorPromotionRefusal
} from "@src/ai/locatorPromotion";
import {
  createPendingUpgrade,
  LOCATOR_UPGRADE_REPLAY_POLICY,
  mergeReplayProof,
  type LocatorReplayProofRecord
} from "@src/ai/pendingUpgrade";
import type { FlowProfile, FlowStep, PendingLocatorUpgrade, StepLocator } from "@src/profiles/FlowProfile";
import { hasPositionalIdentityGuard, isPositionalLocator } from "@src/profiles/locatorApproval";
import { buildRecordedFlow } from "@src/recorder/buildRecordedFlow";
import { classifyLocatorQuality } from "@src/recorder/LocatorQualityClass";
import { getRecorderInitScriptContent } from "@src/recorder/recorderInitScript";
import type { RecordedAction } from "@src/recorder/RecorderTypes";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { FileLocatorRecoveryStore } from "@src/runner/LocatorRecoveryStore";
import { StepExecutor } from "@src/runner/StepExecutor";
import { ValueResolver } from "@src/runner/ValueResolver";
import type { AiPolicyConfig } from "@src/security/authz/AiAutonomyPolicy";
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

/** The deterministic stand-in for the model: plan TEXT, parsed by the real output contract. */
const PROVIDER: Record<string, string> = {
  archiveRole: '{"version":1,"target":{"strategy":"role","value":"button","name":"Archive","exact":true},"scopes":[]}',
  gammaTestId: '{"version":1,"target":{"strategy":"testId","value":"lu-open-gamma"},"scopes":[]}'
};
function propose(key: string): unknown {
  const parsed = parseAiOutput(PROVIDER[key], LOCATOR_PLAN_SCHEMA);
  if (!parsed.ok) throw new Error(`fixture ${key} did not parse: ${parsed.code}`);
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
const work = await mkdtemp(join(tmpdir(), "awkit-l3-promote-"));
const FLOW_ID = "flow-promote";
const SCENARIO_ID = "scen-promote";

async function freshPage(): Promise<Page> {
  const context = await liveBrowser().newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(3_000);
  await page.goto(LAB);
  return page;
}
const result = (page: Page): Promise<string | null> => page.getByTestId("lu-result").textContent();

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
    executionId: "exec-promote",
    instanceId: "inst-promote",
    scenarioId: SCENARIO_ID,
    flowId: FLOW_ID,
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

function pendingFor(target: FlowStep, key: string, createdAt: Date): PendingLocatorUpgrade {
  const compiled = compileLocatorPlan(propose(key), target.locator?.context);
  if (!compiled.ok) throw new Error(`fixture ${key} did not compile: ${compiled.code}`);
  const pending = createPendingUpgrade({ step: target, compiled, meaningChange: false, proof: "capture-proven", modelId: "fake-provider", now: createdAt });
  if (!pending) throw new Error("no pending upgrade");
  return pending;
}
const withPending = (target: FlowStep, pending: PendingLocatorUpgrade): FlowStep => ({ ...target, locator: { ...target.locator!, pendingUpgrade: pending } });

const ENABLED: AiPolicyConfig = { enabled: true };
const COMMITTED = { ...LOCATOR_UPGRADE_REPLAY_POLICY, committed: true };

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

  // ── A real guarded-positional baseline and the candidate that would replace it ──────────────────
  console.log("\nA Recorder-captured guarded baseline and its pending candidate");
  const archive = await capture((page) => page.getByRole("button", { name: "Archive" }).click(), "Archive item");
  check("Archive (hidden duplicate) is captured as a guarded position", hasPositionalIdentityGuard(archive), JSON.stringify(archive.locator));
  check("...and its L2 class is guarded-positional, which is what L3 tries to upgrade", classifyLocatorQuality(archive.locator)?.class === "guarded-positional");
  const t0 = new Date("2026-09-20T10:00:00.000Z");
  const good = pendingFor(archive, "archiveRole", t0);
  const wrongTarget = pendingFor(archive, "gammaTestId", t0);

  // The step carries enough unrelated persisted state that a promotion rebuilding it would be obvious.
  const target: FlowStep = {
    ...withPending(archive, good),
    timeoutMs: 7_000,
    onFailure: { action: "continue", screenshot: true },
    description: "Archive the visible item",
    beforeWaits: [{ type: "textVisible", text: "Locator Upgrade Lab" }],
    locator: { ...withPending(archive, good).locator!, futureLocatorField: "kept" } as StepLocator
  };
  const store = new FileLocatorRecoveryStore(join(work, "memory"));
  const scopeKey = (id: string): string => [SCENARIO_ID, FLOW_ID, id].join(String.fromCharCode(0));
  const flows = new JsonProfileStore<FlowProfile>({ folder: join(work, "flows") });
  const baseFlow: FlowProfile = { id: FLOW_ID, name: "Promotion", version: 1, nodes: [target], edges: [] };
  await flows.create(baseFlow);
  const audit = new AiActionStore(join(work, "ai-actions.json"));
  const savedStep = async (id = archive.id): Promise<FlowStep> => (await flows.get(FLOW_ID))!.nodes.find((node) => node.id === id)!;
  const savedBytes = (): Promise<string> => readFile(join(work, "flows", `${FLOW_ID}.json`), "utf8");

  /** The promotion path exactly as `app/main/ai/locatorUpgradeService.ts` drives it, minus Electron. */
  async function promote(
    stepId: string,
    options: { createdAt: string; mode?: LocatorPromotionMode; editorDirty?: boolean; policy?: AiPolicyConfig; committed?: boolean; actionId?: string }
  ): Promise<{ code: "OK" | LocatorPromotionRefusal | "FLOW_NOT_FOUND"; actionId: string }> {
    const proofs = await store.listReplayProofs();
    const actionId = options.actionId ?? `act-${Math.random().toString(16).slice(2, 10)}`;
    let code: "OK" | LocatorPromotionRefusal | "FLOW_NOT_FOUND" = "FLOW_NOT_FOUND";
    let record: unknown = null;
    await flows.updateWith(FLOW_ID, (current) => {
      if (!current) return undefined;
      const outcome = promoteLocatorUpgrade(current, stepId, {
        createdAt: options.createdAt,
        mode: options.mode ?? "user-approved",
        actionId,
        nowIso: new Date().toISOString(),
        replayProofs: proofs,
        policy: options.policy ?? ENABLED,
        editorDirty: options.editorDirty ?? false,
        replayPolicy: options.committed ? COMMITTED : undefined
      });
      code = outcome.ok ? "OK" : outcome.code;
      record = outcome.ok ? outcome.record : null;
      return outcome.ok ? outcome.profile : undefined;
    });
    // The locator write commits first; only then is the audit entry appended (L3 §6).
    if (record) await audit.append(record);
    return { code, actionId };
  }

  // ── The candidate is inert until it is promoted ────────────────────────────────────────────────
  console.log("\nA pending candidate changes nothing on its own");
  let page = await freshPage();
  let run = await runStep(page, target, store, { id: 1 });
  check("a step with a pending candidate runs on its OWN locator and acts on the right element", run.status === "passed" && (await result(page)) === "archive", run.error);
  check("...and the saved locator is untouched", (await savedStep()).locator?.strategy === archive.locator?.strategy);
  await page.close();

  console.log("\nPromotion refuses everything that is not proven evidence");
  const before = await savedBytes();
  check("an unverified candidate (no replay yet) is refused", (await promote(archive.id, { createdAt: good.createdAt })).code === "PROOF_NOT_SATISFIED");
  check("...and nothing was written", (await savedBytes()) === before);
  check("a candidate the caller names by the wrong timestamp is refused", (await promote(archive.id, { createdAt: new Date(t0.getTime() + 1000).toISOString() })).code === "SUPERSEDED");
  check("an unsaved editor defers the promotion", (await promote(archive.id, { createdAt: good.createdAt, editorDirty: true })).code === "EDITOR_DIRTY");
  check("a step that does not exist is refused", (await promote("no-such-step", { createdAt: good.createdAt })).code === "STEP_NOT_FOUND");

  // ── Earn the evidence through real replays ─────────────────────────────────────────────────────
  // The inert run above already earned one proof on row 1; two more on row 2 reach exactly the
  // policy minimum, so this proves the minimum is what is required rather than "enough runs".
  console.log("\nEvidence is earned by real replays through StepExecutor");
  for (const row of [{ id: 2 }, { id: 2 }]) {
    page = await freshPage();
    run = await runStep(page, target, store, row);
    if (run.status !== "passed") check(`replay on row ${JSON.stringify(row)} passed`, false, run.error);
    await page.close();
  }
  const tally = await store.getReplayProof(scopeKey(archive.id));
  check("3 passing replays over 2 distinct data rows are tallied", tally?.proven === 3 && tally.dataRowKeys.length === 2, JSON.stringify(tally));
  check("the tally carries digests and hashed rows only, never the candidate's text", !JSON.stringify(tally).includes("Archive"));

  console.log("\nEligible evidence still does not authorize an unattended replacement");
  check(
    "automatic promotion is refused while the replay thresholds are only seeded",
    (await promote(archive.id, { createdAt: good.createdAt, mode: "auto" })).code === "THRESHOLDS_PROVISIONAL"
  );
  check("the shipped policy really is uncommitted", LOCATOR_UPGRADE_REPLAY_POLICY.committed === false);
  check(
    "a T1-configured feature cannot promote automatically even with committed thresholds",
    (await promote(archive.id, { createdAt: good.createdAt, mode: "auto", committed: true, policy: { enabled: true, featureTiers: { locatorSemanticUpgrade: "T1" } } })).code ===
      "POLICY_REFUSED"
  );
  check(
    "the master switch off refuses a user-approved promotion too",
    (await promote(archive.id, { createdAt: good.createdAt, policy: { enabled: false } })).code === "POLICY_REFUSED"
  );
  check(
    "a T0 feature observes and never applies",
    (await promote(archive.id, { createdAt: good.createdAt, policy: { enabled: true, featureTiers: { locatorSemanticUpgrade: "T0" } } })).code === "POLICY_REFUSED"
  );
  check("...and none of those refusals wrote anything", (await savedBytes()) === before);
  check("no refusal was recorded as an applied change", (await audit.snapshot()).records.length === 0);

  // ── T3 and baseline refusals, on steps that are otherwise fully eligible ────────────────────────
  console.log("\nT3 and non-promotable baselines are refused for what they are");
  // Each variant gets a pending candidate bound to ITSELF, so the refusal cannot be a stale binding
  // standing in for the T3 rule it is meant to prove.
  const bindTo = (step: FlowStep): FlowStep => ({ ...step, locator: { ...step.locator!, pendingUpgrade: pendingFor(step, "archiveRole", t0) } });
  const t3Flow: FlowProfile = {
    ...baseFlow,
    nodes: [
      bindTo({ ...target, id: "danger", name: "Delete account" }),
      bindTo({ ...target, id: "login", type: "reuseSession" } as FlowStep),
      bindTo({ ...target, id: "review", locator: { ...target.locator!, resolution: "needs-review" } })
    ]
  };
  const t3Promote = (stepId: string): LocatorPromotionRefusal | "OK" => {
    const outcome = promoteLocatorUpgrade(t3Flow, stepId, {
      createdAt: good.createdAt,
      mode: "user-approved",
      actionId: "t3",
      nowIso: new Date().toISOString(),
      replayProofs: [],
      policy: ENABLED,
      editorDirty: false
    });
    return outcome.ok ? "OK" : outcome.code;
  };
  check("a sensitive-action step is refused as T3, not for want of evidence", t3Promote("danger") === "T3_SENSITIVE_STEP");
  check("a protected-login step type is refused as T3", t3Promote("login") === "T3_PROTECTED_LOGIN");
  check("a locator that still needs review is not an upgrade target", t3Promote("review") === "BASELINE_NOT_PROMOTABLE");

  // A step edited outside the designer's save boundary keeps its pending candidate, so the binding
  // compare-and-swap is the only thing standing between a stale proposal and a retargeted step.
  const beforeRename = (await flows.get(FLOW_ID))!;
  await flows.update(FLOW_ID, { ...beforeRename, nodes: beforeRename.nodes.map((node) => (node.id === archive.id ? { ...node, name: "Archive item, retitled" } : node)) });
  check("a candidate proposed for an earlier version of the step is refused as stale", (await promote(archive.id, { createdAt: good.createdAt })).code === "STALE");
  check("...and the stale proposal wrote nothing", (await savedStep()).locator?.strategy === archive.locator?.strategy);

  // ── A candidate that targets a different element can never become eligible ──────────────────────
  console.log("\nA candidate that changes the intended target is refused by its own replays");
  const wrongStep: FlowStep = { ...target, id: "wrong", locator: { ...target.locator!, pendingUpgrade: wrongTarget } };
  const wrongFlow: FlowProfile = { ...baseFlow, id: FLOW_ID, nodes: [...baseFlow.nodes, wrongStep] };
  await flows.update(FLOW_ID, wrongFlow);
  for (const row of [{ id: 1 }, { id: 2 }, { id: 3 }]) {
    page = await freshPage();
    await runStep(page, wrongStep, store, row);
    await page.close();
  }
  const wrongTally = await store.getReplayProof(scopeKey("wrong"));
  check("the wrong-element candidate is refused at replay", (wrongTally?.rejected ?? 0) > 0 && wrongTally?.lastCode === "WRONG_ELEMENT", JSON.stringify(wrongTally));
  check("...so promotion refuses it for good", (await promote("wrong", { createdAt: wrongTarget.createdAt })).code === "REPLAY_REJECTED");
  check("...having earned no proof at all, however many times the step itself passed", (await store.getReplayProof(scopeKey("wrong")))?.proven === 0);

  // ── The view the Flow Designer renders agrees with the write ───────────────────────────────────
  console.log("\nThe Flow Designer view is a dry run of the same operation");
  const describe = async (editorDirty = false) =>
    describeFlowLocatorUpgrades({ profile: (await flows.get(FLOW_ID))!, replayProofs: await store.listReplayProofs(), policy: ENABLED, editorDirty });
  let view = await describe();
  const archiveView = view.pending.find((entry) => entry.stepId === archive.id)!;
  check("the eligible candidate is offered as promotable", archiveView.state === "eligible" && archiveView.promotable && archiveView.blockedReason === null, JSON.stringify(archiveView));
  check("...with the counts the policy asks for", archiveView.replays === 3 && archiveView.dataRows === 2 && archiveView.minReplays === 3 && archiveView.minDataRows === 2);
  check("...and both locators, so the change can be reviewed before it is applied", archiveView.current.strategy === archive.locator?.strategy && archiveView.proposed.name === "Archive");
  check("the refused candidate is shown as refused, not offered", view.pending.find((e) => e.stepId === "wrong")?.blockedReason === "REPLAY_REJECTED");
  // Dirtiness is reported beside the candidate, never folded into it: it changes on every keystroke
  // while this view is fetched and cached, and a cached "unsaved changes" outlives the fact.
  const dirtyView = await describe(true);
  check(
    "an unsaved editor is reported separately from the candidate's own readiness",
    dirtyView.editorDirty === true && dirtyView.pending.find((e) => e.stepId === archive.id)?.blockedReason === null,
    JSON.stringify({ editorDirty: dirtyView.editorDirty, blocked: dirtyView.pending.find((e) => e.stepId === archive.id)?.blockedReason })
  );
  check("the view carries no guard, fingerprint or provenance", !/fingerprint|siblingCount|candidateSelector/.test(JSON.stringify(view)));

  // ── The promotion itself ───────────────────────────────────────────────────────────────────────
  console.log("\nPromotion replaces the locator and nothing else");
  const preLocator = structuredClone((await savedStep()).locator!);
  const applied = await promote(archive.id, { createdAt: good.createdAt, actionId: "act-promote-1" });
  check("an eligible candidate is promoted through the flow store lane", applied.code === "OK");
  const promoted = await savedStep();
  const promotedLocator = promoted.locator!;
  check("the saved locator is now the proven candidate", promotedLocator.strategy === "role" && promotedLocator.value === "button" && promotedLocator.name === "Archive" && promotedLocator.exact === true);
  check("the positional guard that described the replaced primary is gone", promotedLocator.guard === undefined && !isPositionalLocator(promotedLocator));
  check("...so the L2 class is now a semantic one", classifyLocatorQuality(promotedLocator)?.class === "strong-semantic", JSON.stringify(classifyLocatorQuality(promotedLocator)));
  check("the pending candidate is cleared", promotedLocator.pendingUpgrade === undefined);
  const expectedPrevious: Record<string, unknown> = { ...preLocator };
  delete expectedPrevious.pendingUpgrade;
  check(
    "the whole pre-change locator is kept as the revert target",
    JSON.stringify(promotedLocator.locatorProvenance?.previous) === JSON.stringify(expectedPrevious),
    JSON.stringify(promotedLocator.locatorProvenance?.previous)
  );
  check("...with its guard and identity intact", promotedLocator.locatorProvenance?.previous.guard !== undefined);
  check("the replaced locator is NOT added to alternatives, which the runner executes", JSON.stringify(promotedLocator.alternatives) === JSON.stringify(preLocator.alternatives));
  check("provenance records a user-approved apply as T1, replay-proven", promotedLocator.locatorProvenance?.tier === "T1" && promotedLocator.locatorProvenance.proof === "replay-proven" && promotedLocator.locatorProvenance.source === "ai-semantic-upgrade");
  check("unknown locator fields survive the promotion", (promotedLocator as StepLocator & { futureLocatorField?: string }).futureLocatorField === "kept");
  check("identity, interaction and context evidence survive", promotedLocator.identity !== undefined && JSON.stringify(promotedLocator.interaction) === JSON.stringify(preLocator.interaction));
  check("the step's own action semantics are untouched", promoted.type === target.type && promoted.timeoutMs === 7_000 && JSON.stringify(promoted.onFailure) === JSON.stringify(target.onFailure) && JSON.stringify(promoted.beforeWaits) === JSON.stringify(target.beforeWaits) && promoted.description === target.description);

  console.log("\nThe audit log tells the truth about what happened");
  let snapshot = await audit.snapshot();
  check("exactly one applied change is recorded", snapshot.records.length === 1 && snapshot.records[0].id === "act-promote-1");
  check("...naming the flow, the step, the tier and the proof counts", snapshot.records[0].target.flowId === FLOW_ID && snapshot.records[0].target.stepId === archive.id && snapshot.records[0].tier === "T1" && snapshot.records[0].proof.replays === 3 && snapshot.records[0].proof.dataRows === 2);
  check("...with digests as evidence, never a locator, page text or model output", snapshot.records[0].evidenceIds.every((id) => /^(candidate|binding):[0-9a-f]{64}$/.test(id)) && !/Archive|button|lu-/.test(JSON.stringify(snapshot.records[0])));
  check("...and the revert handle points at the step, not at the record", snapshot.records[0].revertHandle.kind === "locatorProvenance");

  console.log("\nThe promoted locator executes, survives a reload, and is idempotent");
  page = await freshPage();
  run = await runStep(page, promoted, store, { id: 1 });
  check("the promoted locator runs in real Chromium and acts on the same element", run.status === "passed" && (await result(page)) === "archive", run.error);
  await page.close();
  const reloaded = JSON.parse(await savedBytes()) as FlowProfile;
  const reloadedLocator = reloaded.nodes.find((node) => node.id === archive.id)!.locator!;
  check("the promoted locator survives save and reload", reloadedLocator.strategy === "role" && reloadedLocator.name === "Archive");
  check("...and so does the revert target", reloadedLocator.locatorProvenance?.previous.value === preLocator.value);
  check("a repeated promotion of the same candidate changes nothing", (await promote(archive.id, { createdAt: good.createdAt })).code === "NO_PENDING");
  check("...and adds no second audit record", (await audit.snapshot()).records.length === 1);

  console.log("\nThe Flow Designer round trip keeps the promotion");
  const designer = (profile: FlowProfile): FlowProfile => {
    const doc = toDesignerDocument(profile);
    return toFlowProfile(doc.nodes, doc.edges, profile.id, profile.name, { description: profile.description, version: profile.version });
  };
  const roundTripped = designer(reloaded).nodes.find((node) => node.id === archive.id)!.locator!;
  check("an open-and-save of the promoted step keeps the provenance", roundTripped.locatorProvenance?.actionId === "act-promote-1");
  check("...and does not resurrect the promoted candidate as pending", roundTripped.pendingUpgrade === undefined);
  const retargeted = designer({ ...reloaded, nodes: reloaded.nodes.map((node) => (node.id === archive.id ? { ...node, locator: { ...node.locator!, value: "link" } } : node)) });
  check("editing the promoted locator drops the provenance at the save boundary", retargeted.nodes.find((node) => node.id === archive.id)?.locator?.locatorProvenance === undefined);

  // ── Revert ─────────────────────────────────────────────────────────────────────────────────────
  console.log("\nOne-click revert restores the exact previous locator");
  const revertDeps = { audit, flows };
  const editedAway = await flows.get(FLOW_ID);
  const edited = { ...editedAway!, nodes: editedAway!.nodes.map((node) => (node.id === archive.id ? { ...node, name: "Archive item, renamed" } : node)) };
  await flows.update(FLOW_ID, edited);
  check("revert is refused once the user edited the promoted step", (await revertAiAction("act-promote-1", revertDeps)).code === "STALE");
  check("...and the user's edit still stands", (await savedStep()).name === "Archive item, renamed");
  await flows.update(FLOW_ID, editedAway!);
  const reverted = await revertAiAction("act-promote-1", revertDeps);
  check("revert through the real flow store succeeds", reverted.code === "OK" && reverted.auditMarked === true, JSON.stringify(reverted));
  const afterRevert = (await savedStep()).locator!;
  check("the exact previous locator is back, guard and all", afterRevert.strategy === preLocator.strategy && afterRevert.value === preLocator.value && JSON.stringify(afterRevert.guard) === JSON.stringify(preLocator.guard));
  check("...and it is a guarded position again", hasPositionalIdentityGuard({ locator: afterRevert }));
  check("the provenance is gone, so nothing claims an AI change any more", afterRevert.locatorProvenance === undefined);
  check("the audit record is marked reverted rather than deleted", (await audit.snapshot()).records[0].reverted !== undefined);
  check("a repeated revert is refused", (await revertAiAction("act-promote-1", revertDeps)).code === "ALREADY_REVERTED");
  page = await freshPage();
  run = await runStep(page, await savedStep(), store, { id: 1 });
  check("the reverted step still runs and acts on the same element", run.status === "passed" && (await result(page)) === "archive", run.error);
  await page.close();

  // ── Concurrency and the dirty-editor hand-off ──────────────────────────────────────────────────
  console.log("\nConcurrent promotions and the editor hand-off");
  const second = pendingFor(await savedStep(), "archiveRole", new Date("2026-09-20T12:00:00.000Z"));
  const withSecond = await flows.get(FLOW_ID);
  await flows.update(FLOW_ID, {
    ...withSecond!,
    nodes: withSecond!.nodes.map((node) => (node.id === archive.id ? { ...node, locator: { ...node.locator!, pendingUpgrade: second } } : node))
  });
  // The candidate's tally is keyed by its own digest and the step binding, both unchanged by the
  // revert, so the evidence earned earlier still applies to this identical proposal.
  const race = await Promise.all([
    promote(archive.id, { createdAt: second.createdAt, actionId: "act-race-a" }),
    promote(archive.id, { createdAt: second.createdAt, actionId: "act-race-b" })
  ]);
  const codes = race.map((entry) => entry.code).sort();
  check("two concurrent promotions produce exactly one apply", codes.join() === "NO_PENDING,OK", codes.join());
  check("...and exactly one new audit record", (await audit.snapshot()).records.length === 2);
  check("...leaving one coherent locator", (await savedStep()).locator?.strategy === "role");

  const racedActionId = race.find((entry) => entry.code === "OK")!.actionId;
  await revertAiAction(racedActionId, revertDeps);

  console.log("\nA deferred promotion never overwrites what the editor saved");
  const deferredState = await flows.get(FLOW_ID);
  const third = pendingFor(deferredState!.nodes.find((node) => node.id === archive.id)!, "archiveRole", new Date("2026-09-20T13:00:00.000Z"));
  await flows.update(FLOW_ID, {
    ...deferredState!,
    nodes: deferredState!.nodes.map((node) => (node.id === archive.id ? { ...node, locator: { ...node.locator!, pendingUpgrade: third } } : node))
  });
  check("while the editor is dirty the promotion is deferred", (await promote(archive.id, { createdAt: third.createdAt, editorDirty: true })).code === "EDITOR_DIRTY");
  // The editor then saves a real locator edit through the designer's own mapping.
  const editorDoc = await flows.get(FLOW_ID);
  const editorSaved = designer({
    ...editorDoc!,
    nodes: editorDoc!.nodes.map((node) => (node.id === archive.id ? { ...node, locator: { ...node.locator!, value: "link" } } : node))
  });
  await flows.update(FLOW_ID, editorSaved);
  check("the editor's save drops the candidate it retargeted", (await savedStep()).locator?.pendingUpgrade === undefined);
  check("...so the deferred promotion cannot land on the newer locator", (await promote(archive.id, { createdAt: third.createdAt })).code === "NO_PENDING");
  check("...and the user's edit is what is saved", (await savedStep()).locator?.value === "link");

  // ── Evidence selection and the no-AI baseline ──────────────────────────────────────────────────
  console.log("\nEvidence selection, and AWKIT without any AI");
  const across = (scenario: string, rowKey: string): LocatorReplayProofRecord =>
    mergeReplayProof(undefined, { scopeKey: [scenario, FLOW_ID, archive.id].join(String.fromCharCode(0)), candidateDigest: "c", bindingDigest: "b", outcome: "proven", code: "PROVEN", rowKey, now: t0 });
  const spread = [across("s1", "r1"), across("s2", "r2"), across("s3", "r3")];
  check(
    "replays are never summed across scenarios to manufacture eligibility",
    (selectReplayEvidence(spread, FLOW_ID, archive.id, { candidateDigest: "c", bindingDigest: "b" })?.proven ?? 0) === 1
  );
  const rejectedElsewhere = [{ ...spread[0], proven: 9, dataRowKeys: ["r1", "r2", "r3"] }, { ...spread[1], rejected: 1 }];
  check("one refusal anywhere disqualifies the candidate", selectReplayEvidence(rejectedElsewhere, FLOW_ID, archive.id, { candidateDigest: "c", bindingDigest: "b" })?.rejected === 1);
  check("a tally for another flow's step is never read as evidence", selectReplayEvidence(spread, "other-flow", archive.id, { candidateDigest: "c", bindingDigest: "b" }) === undefined);

  const plain: FlowProfile = { id: "flow-plain", name: "No AI", version: 1, nodes: [{ ...archive, locator: archive.locator }], edges: [] };
  const plainView = describeFlowLocatorUpgrades({ profile: plain, replayProofs: [], policy: { enabled: false }, editorDirty: false });
  check("a flow with no AI fields has nothing to show and nothing to apply", plainView.pending.length === 0 && plainView.applied.length === 0);
  page = await freshPage();
  run = await runStep(page, archive, undefined);
  check("with no provider, no pending candidate and no locator memory, execution is unchanged", run.status === "passed" && (await result(page)) === "archive", run.error);
  await page.close();
} catch (error) {
  failed += 1;
  console.error(`  ✗ unexpected error — ${error instanceof Error ? error.stack : String(error)}`);
} finally {
  await browser?.close().catch(() => undefined);
  server?.kill();
}

console.log(`\nverify:ai-locator-upgrade — ${passed} passed, ${failed} failed`);
if (passed === 0) failed += 1;
process.exit(failed === 0 ? 0 : 1);
