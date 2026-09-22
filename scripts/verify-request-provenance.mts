/**
 * verify:request-provenance — L5a runtime request-to-step provenance, end to end.
 *
 * Real runs through the REAL `ExecutionEngine` (real Chromium, real `StepExecutor`, the production
 * `FailureEvidenceCollector`) against the REAL mock site (`/runner-lab` → Request provenance), read back
 * from the `report.json` the real `ReportService` persisted. Nothing here builds an evidence event.
 *
 * What must hold:
 *  - the request the failed step itself holds (its response wait's match, its navigation's response) is
 *    linked to that step: the only confirmed request-to-step link;
 *  - a background request issued while the failed step ran, from the same page, is NOT attributed to the
 *    step: it stays uncertain, exactly like a request the step's action issued that nothing waited for;
 *  - a request from another page or a child frame during the step is off target;
 *  - a request issued during an earlier step and answered during the failed one is confirmed as issued
 *    before it, although the step stamp alone says "during the failed step";
 *  - one id per request across its redirect, its response and its later transfer failure; a request the
 *    page cancelled leaves no event;
 *  - a request whose start was not observed (a page loading before the collector attached) stays
 *    `unknown` rather than being guessed;
 *  - provenance survives report.json, an older report without it gets no relation at all, and neither
 *    the deterministic cause baseline nor the failure-analysis request changes because of it.
 *
 * Run: npm run verify:request-provenance   (node scripts/benchmark/run.mjs → tsx + the electron stub)
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { get as httpGet } from "node:http";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import { buildFailureAnalysisRequest, coalesceFailures, failureSignature, stepRelations } from "@src/ai/failureAnalysis";
import type { ConcurrentRunProfile } from "@src/instances/ConcurrentRunProfile";
import type { FlowProfile, FlowStep, WaitCondition } from "@src/profiles/FlowProfile";
import type { ScenarioProfile } from "@src/profiles/ScenarioProfile";
import type { ConcurrentRunReport, InstanceReport } from "@src/reports/ExecutionReport";
import { ExecutionEngine } from "@src/runner/ExecutionEngine";
import {
  CONFIRMED_REQUEST_RELATIONS,
  EvidenceRunBudget,
  requestRelations,
  type ExecutionEvidenceEvent,
  type RequestRelation
} from "@src/runner/evidence/ExecutionEvidence";
import { deriveFailureCause } from "@src/runner/evidence/FailureCauseBaseline";
import { FailureEvidenceCollector, liveEvidenceAttachments } from "@src/runner/evidence/FailureEvidenceCollector";
import { buildDirs, cleanupRoot, installBenchGuards } from "./benchmark/engineHarness.mts";

installBenchGuards();

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PORT = await new Promise<number>((resolvePort, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const { port } = probe.address() as { port: number };
    probe.close(() => resolvePort(port));
  });
});
const BASE = `http://127.0.0.1:${PORT}`;
const LAB = `${BASE}/runner-lab`;
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: unknown): boolean {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
  return Boolean(condition);
}

const sleep = (ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
function httpOk(url: string): Promise<boolean> {
  return new Promise((resolveOk) => {
    const request = httpGet(url, (response) => {
      response.resume();
      resolveOk((response.statusCode ?? 500) < 500);
    });
    request.on("error", () => resolveOk(false));
    request.setTimeout(2_000, () => {
      request.destroy();
      resolveOk(false);
    });
  });
}

// ── Flow fixtures ────────────────────────────────────────────────────────────────────────────────

const testId = (value: string) => ({ strategy: "testId" as const, value });
const goto = (id: string, url = LAB, afterWaits?: WaitCondition[]): FlowStep => ({ id, type: "goto", name: id, url, ...(afterWaits ? { afterWaits } : {}) });
const click = (id: string, target: string, afterWaits?: WaitCondition[]): FlowStep => ({ id, type: "click", name: id, locator: testId(target), ...(afterWaits ? { afterWaits } : {}) });
const waitText = (id: string, text: string): FlowStep => ({ id, type: "wait", name: id, value: text, timeoutMs: 5_000, config: { waitType: "textVisible" } });
const assertText = (id: string, target: string, expected: string): FlowStep => ({
  id,
  type: "assertText",
  name: id,
  locator: testId(target),
  timeoutMs: 2_000,
  config: { assertionType: "text", comparisonOperator: "equals", expectedValue: expected }
});
const responseWait = (urlContains: string, statusRange: [number, number]): WaitCondition =>
  ({ type: "response", urlContains, statusRange, armBeforeAction: true, timeoutMs: 6_000 }) as WaitCondition;

function flow(id: string, steps: FlowStep[]): FlowProfile {
  const nodes: FlowStep[] = [{ id: "start", type: "start", name: "start" }, ...steps, { id: "end", type: "end", name: "end" }];
  return {
    id,
    name: id,
    version: 1,
    nodes,
    edges: nodes.slice(0, -1).map((node, index) => ({ id: `${id}-e${index}`, source: node.id, target: nodes[index + 1].id, type: "success" }))
  } as FlowProfile;
}

/** Step execution ordinals: Start is 1, so a flow's first real step is 2. */
const SCENARIOS: Array<{ key: string; steps: FlowStep[] }> = [
  {
    // arm = 3, save = 4 (fails: its awaited save answers 500).
    key: "checkout",
    steps: [goto("c-goto"), click("c-arm", "rp-arm"), click("c-save", "rp-save", [responseWait("/api/provenance/save", [200, 299])])]
  },
  {
    // redirect = 3 (passes: 500 expected), truncated = 4, cancel = 6, transport = 8, assert = 10 (fails).
    key: "chain",
    steps: [
      goto("n-goto"),
      click("n-redirect", "rp-redirect", [responseWait("/api/provenance/moved", [500, 500])]),
      click("n-truncated", "rp-truncated"),
      waitText("n-truncated-wait", "interrupted"),
      click("n-cancel", "rp-cancel"),
      waitText("n-cancel-wait", "cancelled"),
      click("n-transport", "fe-transport"),
      waitText("n-transport-wait", "Network error"),
      assertText("n-assert", "rp-state", "prepared")
    ]
  },
  {
    // goto = 2: its navigation answers 503 and its after-wait then fails, so the failed step holds it.
    key: "navigation",
    steps: [goto("g-goto", `${BASE}/runner-lab/error-page?code=503`, [{ type: "elementVisible", locator: testId("rp-never"), timeoutMs: 1_500 } as WaitCondition])]
  }
];

function scenarioProfile(id: string, flowId: string): ScenarioProfile {
  return {
    id,
    name: id,
    executionMode: "sequential",
    maxParallelFlows: 1,
    flows: [{ order: 1, flowId, required: true }],
    links: [],
    failurePolicy: { stopOnRequiredFlowFailure: true, continueOnOptionalFlowFailure: false, takeScreenshotOnFailure: true }
  };
}
function runProfile(executionId: string, scenarioId: string): ConcurrentRunProfile {
  return {
    id: executionId,
    scenarioId,
    runMode: "fixedConcurrent",
    maxConcurrentInstances: 1,
    browserWindowMode: "headless",
    instanceTemplate: { browser: "chromium", headless: true, isolationMode: "browserContext", baseUrl: BASE, timeoutMs: 30_000, viewport: { width: 1280, height: 720 } },
    resourceControls: { maxBrowserContextsPerProcess: 8, delayBetweenInstanceStartsMs: 0 },
    failurePolicy: { stopAllOnCriticalFailure: false, continueOtherInstancesOnFailure: true, retryFailedInstance: false, retryCount: 0 }
  };
}

interface Outcome {
  instance: InstanceReport;
  events: ExecutionEvidenceEvent[];
  /** report.json as written, for the reload and old-report checks. */
  raw: string;
}

async function runScenarios(engine: ExecutionEngine, dirs: Awaited<ReturnType<typeof buildDirs>>["dirs"]): Promise<Map<string, Outcome | undefined>> {
  const ids = new Map<string, string>();
  for (const scenario of SCENARIOS) {
    const executionId = `rpv-${scenario.key}-${Date.now().toString(36)}`;
    ids.set(scenario.key, executionId);
    const flowProfile = flow(`rpv-flow-${scenario.key}`, scenario.steps);
    await engine.startRun(executionId, runProfile(executionId, `rpv-scn-${scenario.key}`), [undefined], dirs, {}, scenarioProfile(`rpv-scn-${scenario.key}`, flowProfile.id), [flowProfile]);
  }
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const mine = engine.getInstances().filter((instance) => [...ids.values()].includes(instance.executionId));
    if (mine.length === SCENARIOS.length && mine.every((instance) => TERMINAL.has(instance.status))) break;
    await sleep(100);
  }
  const outcomes = new Map<string, Outcome | undefined>();
  for (const scenario of SCENARIOS) {
    const path = join(dirs.reports, ids.get(scenario.key)!, "report.json");
    for (let waited = 0; !existsSync(path) && waited < 30_000; waited += 100) await sleep(100);
    if (!existsSync(path)) {
      outcomes.set(scenario.key, undefined);
      continue;
    }
    const raw = readFileSync(path, "utf8");
    const instance = (JSON.parse(raw) as ConcurrentRunReport).instances[0];
    outcomes.set(scenario.key, instance ? { instance, events: instance.diagnostics?.evidence ?? [], raw } : undefined);
  }
  return outcomes;
}

const urlOf = (event: ExecutionEvidenceEvent) => String(event.payload.url ?? "");
const named = (outcome: Outcome | undefined, name: string, source = "http.error") =>
  outcome?.events.find((event) => event.source === source && urlOf(event).endsWith(`/api/provenance/${name}`));
const runnerOf = (outcome: Outcome | undefined) => outcome?.events.filter((event) => event.source === "runner.failure").pop();
/** Every trace of provenance removed: the shape of a report written before 2026-09-22. */
function asOldReport(events: readonly ExecutionEvidenceEvent[]): ExecutionEvidenceEvent[] {
  return (JSON.parse(JSON.stringify(events)) as ExecutionEvidenceEvent[]).map((event) => {
    const { request: _request, ...rest } = event;
    const { frame: _frame, ...context } = rest.context;
    // The failed step's target page is new too: an older runner record never had a page.
    if (rest.source === "runner.failure") delete (context as { pageId?: string }).pageId;
    return { ...rest, context };
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────────────────────────

let mockSite: ChildProcess | undefined;
const { dirs, root } = await buildDirs("awkit-request-provenance-");
try {
  console.log("Preconditions");
  mockSite = spawn(process.execPath, [join(ROOT, "mock-site", "server.mjs")], {
    env: { ...process.env, MOCK_SITE_PORT: String(PORT) },
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true
  });
  let up = false;
  for (let waited = 0; !up && waited < 20_000; waited += 200) {
    up = await httpOk(LAB);
    if (!up) await sleep(200);
  }
  if (!check("the real mock site serves /runner-lab on loopback", up)) throw new Error("mock site never came up");

  const engine = new ExecutionEngine();
  engine.configureConcurrency({ maxBrowsersPerHost: 4, maxActiveFlows: 4, useSharedBrowserPool: false, workloadWeights: false });
  const started = Date.now();
  const outcomes = await runScenarios(engine, dirs);
  console.log(`  (${SCENARIOS.length} executions through the real engine in ${Math.round((Date.now() - started) / 1000)}s)`);
  for (const scenario of SCENARIOS) check(`report.json persisted for "${scenario.key}", and the instance failed`, outcomes.get(scenario.key)?.instance.status === "failed", outcomes.get(scenario.key)?.instance.status);

  console.log("\n1. The failed step's own request versus everything else that happened during it");
  {
    const outcome = outcomes.get("checkout");
    const events = outcome?.events ?? [];
    const runner = runnerOf(outcome);
    const relations = requestRelations(events);
    const save = named(outcome, "save");
    const audit = named(outcome, "audit");
    const heartbeat = named(outcome, "heartbeat");
    const widget = named(outcome, "widget");
    const popup = named(outcome, "popup");
    const inventory = named(outcome, "inventory");
    const relation = (event: ExecutionEvidenceEvent | undefined) => (event ? relations.get(event.id) : undefined);

    check("the failed step is the save click (step 4) and its runner record names it", runner?.context.nodeId === "c-save" && runner.context.stepIndex === 4, runner?.context);
    check("the runner record carries the page and frame the failed step acted on", /^p\d+$/.test(runner?.context.pageId ?? "") && runner?.context.frame === "main", runner?.context);
    check("all six requests reached the report as HTTP errors", [save, audit, heartbeat, widget, popup, inventory].every(Boolean), events.map((event) => `${event.source}:${urlOf(event)}`));
    check(
      "every request event carries a distinct request id",
      [save, audit, heartbeat, widget, popup, inventory].every((event) => /^rq\d+$/.test(event?.request?.id ?? "")) &&
        new Set([save, audit, heartbeat, widget, popup, inventory].map((event) => event?.request?.id)).size === 6
    );

    check("save: the step's response wait matched it — linked to step 4", save?.request?.link === "responseWait" && save.request.linkStepIndex === 4, save?.request);
    check("save: confirmed relation linkedToFailedStep", relation(save) === "linkedToFailedStep", relation(save));
    check("save: issued in step 4, on the step's page, main frame", save?.request?.issuedStepIndex === 4 && save.context.pageId === runner?.context.pageId && save.context.frame === "main", { request: save?.request, context: save?.context });

    check("heartbeat (background timer, same page, during step 4): issued in step 4, NOT linked", heartbeat?.request?.issuedStepIndex === 4 && heartbeat.request.link === undefined, heartbeat?.request);
    check("heartbeat: uncertain duringFailedStep — never attributed to the failed operation", relation(heartbeat) === "duringFailedStep", relation(heartbeat));
    check(
      "audit (issued by the same click, awaited by nothing): the same uncertain class as the heartbeat — no inference either way",
      audit?.request?.issuedStepIndex === 4 && audit.request.link === undefined && relation(audit) === "duringFailedStep",
      { request: audit?.request, relation: relation(audit) }
    );

    check("widget: from a child frame of the step's page", widget?.context.frame === "child" && widget.context.pageId === runner?.context.pageId, widget?.context);
    check("widget: offTargetDuringFailedStep", relation(widget) === "offTargetDuringFailedStep", relation(widget));
    check("popup: from another page", /^p\d+$/.test(popup?.context.pageId ?? "") && popup?.context.pageId !== runner?.context.pageId, popup?.context);
    check("popup: offTargetDuringFailedStep", relation(popup) === "offTargetDuringFailedStep", relation(popup));

    check("inventory: answered during step 4 (its step stamp) but issued during step 3 (the arm click)", inventory?.context.stepIndex === 4 && inventory.request?.issuedStepIndex === 3, { stamp: inventory?.context.stepIndex, request: inventory?.request });
    check("inventory: confirmed issuedBeforeFailedStep", relation(inventory) === "issuedBeforeFailedStep", relation(inventory));
    const byStamp = inventory && outcome?.instance.diagnostics?.cause ? stepRelations({ baseline: outcome.instance.diagnostics.cause, events }).get(inventory.id) : undefined;
    check("...where the step stamp alone reads it as captured during the failed step (what provenance corrects)", byStamp === "failedStep", byStamp);

    const confirmedToFailed = [...relations].filter(([, value]) => value === "linkedToFailedStep").map(([id]) => id);
    check("exactly one request is attributed to the failed operation, and it is the save", confirmedToFailed.length === 1 && confirmedToFailed[0] === save?.id, confirmedToFailed);
    check(
      "no unrelated request holds a confirmed relation to the failed step",
      [heartbeat, audit, widget, popup].every((event) => event && !CONFIRMED_REQUEST_RELATIONS.has(relations.get(event.id) as RequestRelation))
    );
  }

  console.log("\n2. One identity per request: redirect, response then transfer failure, cancellation");
  {
    const outcome = outcomes.get("chain");
    const events = outcome?.events ?? [];
    const relations = requestRelations(events);
    const runner = runnerOf(outcome);
    const moved = named(outcome, "moved");
    const truncatedHttp = named(outcome, "truncated");
    const truncatedNet = named(outcome, "truncated", "network.failed");
    const transport = events.find((event) => event.source === "network.failed" && urlOf(event).endsWith("/api/transport-drop"));
    check("the failed step is the final assertion (step 10)", runner?.context.nodeId === "n-assert" && runner.context.stepIndex === 10, runner?.context);
    check("redirect: the 500 is one hop after the 302, and the redirect step's response wait holds it", moved?.request?.redirects === 1 && moved.request.link === "responseWait" && moved.request.linkStepIndex === 3, moved?.request);
    check("redirect: the hop keeps its chain's issue (step 3)", moved?.request?.issuedStepIndex === 3, moved?.request);
    check("redirect: confirmed linkedToOtherStep", relations.get(moved?.id ?? "-") === "linkedToOtherStep", relations.get(moved?.id ?? "-"));
    check(
      "truncated: the HTTP 500 and the later transfer failure are two events with ONE request id",
      truncatedHttp !== undefined && truncatedNet !== undefined && truncatedHttp.id !== truncatedNet.id && truncatedHttp.request?.id === truncatedNet.request?.id && /^rq\d+$/.test(truncatedHttp.request?.id ?? ""),
      { http: truncatedHttp?.request, net: truncatedNet?.request, failure: truncatedNet?.payload.failure }
    );
    check("truncated: issued in step 4, confirmed issuedBeforeFailedStep for both events", truncatedHttp?.request?.issuedStepIndex === 4 && [truncatedHttp, truncatedNet].every((event) => relations.get(event?.id ?? "-") === "issuedBeforeFailedStep"));
    check("transport failure: its own id, issued in step 8, issuedBeforeFailedStep", transport?.request?.issuedStepIndex === 8 && transport.request.id !== truncatedHttp?.request?.id && relations.get(transport.id) === "issuedBeforeFailedStep", transport?.request);
    check("the request the page cancelled left no event at all", !events.some((event) => urlOf(event).endsWith("/api/provenance/lookup")), events.map(urlOf));
    const ids = events.filter((event) => event.request).map((event) => event.request!.id);
    check("request ids are only shared by events of the same request (truncated's two)", new Set(ids).size === ids.length - 1, ids);
  }

  console.log("\n3. The failed step's own navigation");
  {
    const outcome = outcomes.get("navigation");
    const doc = outcome?.events.find((event) => event.source === "page.errorDocument");
    const runner = runnerOf(outcome);
    const relations = requestRelations(outcome?.events ?? []);
    check("the goto (step 2) failed in its after-wait", runner?.context.nodeId === "g-goto" && runner.context.stepIndex === 2 && runner.context.frame === "main", runner?.context);
    check("the 503 error document: main frame, the navigation the goto returned", doc?.payload.status === 503 && doc.context.frame === "main" && doc.request?.link === "navigation" && doc.request.linkStepIndex === 2, { context: doc?.context, request: doc?.request });
    check("...confirmed linkedToFailedStep", relations.get(doc?.id ?? "-") === "linkedToFailedStep", relations.get(doc?.id ?? "-"));
  }

  console.log("\n4. Persistence, reload and an older report");
  {
    const all = [...outcomes.values()].filter((outcome): outcome is Outcome => outcome !== undefined);
    const requestEvents = all.flatMap((outcome) => outcome.events.filter((event) => ["http.error", "network.failed", "page.errorDocument"].includes(event.source)));
    check("every request event in every report.json carries provenance and its frame", requestEvents.length >= 10 && requestEvents.every((event) => event.request && event.context.frame), requestEvents.filter((event) => !event.request).map(urlOf));
    check("non-request events carry no request provenance", all.every((outcome) => outcome.events.filter((event) => !requestEvents.includes(event)).every((event) => event.request === undefined)));
    const persistedFields = new Set(requestEvents.flatMap((event) => Object.keys(event.request ?? {})));
    check("provenance holds ids, counts, offsets and link kinds only", [...persistedFields].every((field) => ["id", "redirects", "issuedAtOffsetMs", "issuedStepIndex", "link", "linkStepIndex"].includes(field)), [...persistedFields]);
    check("no URL, header, cookie or body reaches provenance", requestEvents.every((event) => Object.values(event.request ?? {}).every((value) => typeof value === "number" || /^(rq\d+|navigation|responseWait)$/.test(String(value)))));

    const checkout = outcomes.get("checkout");
    const old = asOldReport(checkout?.events ?? []);
    check("an older report (no provenance fields) gets no request relation at all", requestRelations(old).size === 0);
    const cause = checkout?.instance.diagnostics?.cause;
    if (cause) {
      const now = stepRelations({ baseline: cause, events: checkout!.events });
      const before = stepRelations({ baseline: cause, events: old });
      check("step relations are identical with and without provenance", JSON.stringify([...now]) === JSON.stringify([...before]));
      const entry = { instanceId: "i", flowId: "f", nodeId: "c-save", stepIndex: 4, baseline: cause };
      check("the coalescing signature is identical", failureSignature({ ...entry, events: checkout!.events }) === failureSignature({ ...entry, events: old }));
      const withProvenance = buildFailureAnalysisRequest(coalesceFailures([{ ...entry, events: checkout!.events }]).groups[0]);
      const without = buildFailureAnalysisRequest(coalesceFailures([{ ...entry, events: old }]).groups[0]);
      check(
        "the failure-analysis request (prompt, offered ids, tier) is byte-identical: provenance never reaches the model",
        withProvenance !== undefined &&
          JSON.stringify(withProvenance.prompt) === JSON.stringify(without?.prompt) &&
          JSON.stringify(withProvenance.evidence.map((event) => event.id)) === JSON.stringify(without?.evidence.map((event) => event.id)) &&
          withProvenance.mustConclude === without?.mustConclude
      );
      const failure = { kind: "other" as const, failedAtOffsetMs: runnerOf(checkout)?.offsetMs ?? 0, evidenceId: runnerOf(checkout)?.id };
      check("the deterministic cause baseline is identical with and without provenance", JSON.stringify(deriveFailureCause(checkout!.events, failure)) === JSON.stringify(deriveFailureCause(old, failure)));
    } else {
      check("the checkout failure has a deterministic cause to compare against", false);
    }
    check("the report summary's byte count covers payloads only, as before", all.every((outcome) => outcome.instance.diagnostics?.summary.bytes === outcome.events.reduce((sum, event) => sum + JSON.stringify(event.payload).length, 0)));
  }

  console.log("\n5. A request whose start was not observed stays unknown (production collector, real Chromium)");
  {
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(LAB);
      const preexisting = page.waitForResponse((response) => response.url().includes("/api/provenance/preexisting"));
      // Issued before the collector exists: a restored session tab, a page loading before attach.
      await page.evaluate(() => void fetch("/api/provenance/preexisting?code=500&ms=800"));
      const collector = new FailureEvidenceCollector({ executionId: "rpv-direct", instanceId: "rpv-direct-1", budget: new EvidenceRunBudget() });
      await collector.startGeneration({ context }, 1);
      const timestamp = new Date().toISOString();
      collector.onProgress({ instanceId: "rpv-direct-1", flowId: "f", stepId: "s1", stepType: "click", status: "running", timestamp });
      collector.observe({ kind: "target", stepId: "s1", page, frame: "main" });
      const fresh = page.waitForResponse((response) => response.url().includes("/api/provenance/fresh"));
      await page.evaluate(() => void fetch("/api/provenance/fresh?code=500"));
      await Promise.all([preexisting, fresh]);
      await sleep(100);
      // A link reported for a step the collector never saw run is not a link to anything.
      collector.observe({ kind: "request", stepId: "ghost", request: (await fresh).request(), link: "responseWait" });
      collector.onProgress({ instanceId: "rpv-direct-1", flowId: "f", stepId: "s1", stepType: "click", status: "failed", error: "Timeout 1000ms exceeded.", timestamp });
      const diagnostics = collector.finish("failed");
      const events = diagnostics?.evidence ?? [];
      const relations = requestRelations(events);
      const pre = events.find((event) => urlOf(event).endsWith("/api/provenance/preexisting"));
      const post = events.find((event) => urlOf(event).endsWith("/api/provenance/fresh"));
      check("the pre-existing request has an id and no issue: its start was never seen", /^rq\d+$/.test(pre?.request?.id ?? "") && pre?.request?.issuedStepIndex === undefined && pre?.request?.issuedAtOffsetMs === undefined, pre?.request);
      check("...so its relation is unknown, not guessed from when it was answered", relations.get(pre?.id ?? "-") === "unknown", relations.get(pre?.id ?? "-"));
      check("the request issued after attach is duringFailedStep (issued in step 1)", post?.request?.issuedStepIndex === 1 && relations.get(post.id) === "duringFailedStep", post?.request);
      check("a link for a step the collector never saw run is dropped", post?.request?.link === undefined, post?.request);
      check("the runner record carries the target the runner reported", runnerOf({ events } as Outcome)?.context.frame === "main" && /^p\d+$/.test(runnerOf({ events } as Outcome)?.context.pageId ?? ""));
      await context.close();
    } finally {
      await browser.close();
    }
  }

  console.log("\n6. The classifier on the cases a live run cannot stage deterministically");
  {
    const base = { schemaVersion: 1 as const, severity: "error" as const, payload: {}, dedupeKey: "k", repeatCount: 1, truncated: false };
    const at = (id: string, source: ExecutionEvidenceEvent["source"], offsetMs: number, context: Partial<ExecutionEvidenceEvent["context"]>, request?: ExecutionEvidenceEvent["request"]): ExecutionEvidenceEvent => ({
      ...base,
      id,
      source,
      offsetMs,
      lastOffsetMs: offsetMs,
      context: { executionId: "e", instanceId: "i", ...context },
      ...(request ? { request } : {})
    });
    const failure = at("f", "runner.failure", 5_000, { stepIndex: 5, pageId: "p1", frame: "child" });
    const events = [
      at("after", "http.error", 5_100, { stepIndex: 6, pageId: "p1" }, { id: "rq1", redirects: 0, issuedAtOffsetMs: 5_050, issuedStepIndex: 6 }),
      at("late", "http.error", 5_200, { stepIndex: 5, pageId: "p1", frame: "child" }, { id: "rq2", redirects: 0, issuedAtOffsetMs: 5_100, issuedStepIndex: 5 }),
      at("childChild", "http.error", 4_000, { stepIndex: 5, pageId: "p1", frame: "child" }, { id: "rq3", redirects: 0, issuedAtOffsetMs: 3_900, issuedStepIndex: 5 }),
      at("mainVsChild", "http.error", 4_000, { stepIndex: 5, pageId: "p1", frame: "main" }, { id: "rq4", redirects: 0, issuedAtOffsetMs: 3_900, issuedStepIndex: 5 }),
      at("linkNoStep", "http.error", 4_000, { stepIndex: 5, pageId: "p1", frame: "child" }, { id: "rq5", redirects: 0, issuedAtOffsetMs: 100, issuedStepIndex: 2, link: "responseWait" }),
      at("noRequest", "console.error", 4_000, { stepIndex: 5 }),
      failure
    ];
    const relations = requestRelations(events);
    check("issued in a later step: issuedAfterFailure", relations.get("after") === "issuedAfterFailure");
    check("issued in the failed step but after its failure was recorded: issuedAfterFailure", relations.get("late") === "issuedAfterFailure");
    check("child frame against a child-frame target stays duringFailedStep (which child is not recorded)", relations.get("childChild") === "duringFailedStep");
    check("main frame against a child-frame target is off target", relations.get("mainVsChild") === "offTargetDuringFailedStep");
    check("a link without its step falls back to the issue time (issuedBeforeFailedStep)", relations.get("linkNoStep") === "issuedBeforeFailedStep");
    check("an event without provenance gets no relation", !relations.has("noRequest") && relations.size === 5);
    check("a failure record without a step makes every relation unknown", [...requestRelations(events, at("f2", "runner.failure", 5_000, {})).values()].every((value) => value === "unknown"));
    check("no failure record at all makes every relation unknown", [...requestRelations(events.filter((event) => event.source !== "runner.failure")).values()].every((value) => value === "unknown"));
  }

  console.log("\nTeardown");
  {
    let released = false;
    for (let waited = 0; !released && waited < 10_000; waited += 100) {
      const live = liveEvidenceAttachments();
      released = live.pages === 0 && live.generations === 0;
      if (!released) await sleep(100);
    }
    check("every page listener and generation binding was released", released, liveEvidenceAttachments());
  }
  await engine.drainIdleSharedBrowsers().catch(() => undefined);
} catch (error) {
  check("the harness completed without throwing", false, error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  mockSite?.kill();
  await cleanupRoot(root);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 && passed > 0 ? 0 : 1);
