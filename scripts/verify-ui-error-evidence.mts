/**
 * verify:ui-error-evidence — Phase L L5a end to end: the run-lifetime failure-evidence collector,
 * exercised through the REAL `ExecutionEngine` (startRun → admission → BrowserContextFactory →
 * PlaywrightRunner → real Chromium) against the REAL mock site (`/runner-lab` → Failure evidence),
 * and read back from the `report.json` the real `ReportService` persisted.
 *
 * Nothing here builds an evidence object. Every event the checks read was produced by a real page,
 * caught by the production collector's real listeners or init script, correlated by the runner's real
 * progress events, and handed to the real report. So the suite fails if the collector is disconnected
 * from the engine, a listener never fires, the buffer drops the event, or the report omits it.
 *
 * Scenarios (one execution each, run concurrently so cross-instance attribution is tested too):
 * transient toast then a timeout, native + inline validation, HTTP 409/422/500/503, a transport
 * failure, an uncaught page error, a console error the runner outranks, an application error page, a
 * repeated-error burst, a PASS with an unrelated warning, a failure followed by a consequential wait
 * timeout, a protected-login surface (excluded entirely), a manual handoff that resumes, a user
 * cancellation, a clean pass, and the `AWKIT_FAILURE_EVIDENCE=0` switch.
 *
 * Run: npm run verify:ui-error-evidence   (node scripts/benchmark/run.mjs → tsx + the electron stub)
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { get as httpGet } from "node:http";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ExecutionEngine } from "@src/runner/ExecutionEngine";
import type { ConcurrentRunProfile } from "@src/instances/ConcurrentRunProfile";
import type { FlowProfile, FlowStep } from "@src/profiles/FlowProfile";
import type { ScenarioProfile } from "@src/profiles/ScenarioProfile";
import type { ConcurrentRunReport, InstanceReport } from "@src/reports/ExecutionReport";
import type { EvidenceSource, ExecutionEvidenceEvent } from "@src/runner/evidence/ExecutionEvidence";
import { liveEvidenceAttachments } from "@src/runner/evidence/FailureEvidenceCollector";
import { buildDirs, cleanupRoot, installBenchGuards } from "./benchmark/engineHarness.mts";

installBenchGuards();

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
/** An OS-assigned free port: Windows reserves whole port blocks (EACCES on a fixed choice). */
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
async function pollUntil<T>(probe: () => T | undefined | null | false, timeoutMs: number, intervalMs = 100): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== undefined && value !== null && value !== false) return value as T;
    if (Date.now() >= deadline) return undefined;
    await sleep(intervalMs);
  }
}
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
const goto = (id: string, url = LAB): FlowStep => ({ id, type: "goto", name: id, url });
const click = (id: string, target: string): FlowStep => ({ id, type: "click", name: id, locator: testId(target) });
const fill = (id: string, target: string, value: string): FlowStep => ({ id, type: "fill", name: id, locator: testId(target), value });
const waitVisible = (id: string, target: string, timeoutMs = 2_500): FlowStep => ({
  id,
  type: "wait",
  name: id,
  locator: testId(target),
  timeoutMs,
  config: { waitType: "selector" }
});
const waitText = (id: string, text: string): FlowStep => ({ id, type: "wait", name: id, value: text, timeoutMs: 5_000, config: { waitType: "textVisible" } });
const waitTime = (id: string, ms: number): FlowStep => ({ id, type: "wait", name: id, value: String(ms), timeoutMs: ms, config: { waitType: "time" } });
const assertText = (id: string, target: string, expected: string): FlowStep => ({
  id,
  type: "assertText",
  name: id,
  locator: testId(target),
  timeoutMs: 3_000,
  config: { assertionType: "text", comparisonOperator: "equals", expectedValue: expected }
});
const handoff = (id: string): FlowStep => ({ id, type: "manualHandoff", name: id, message: "Check the order, then continue." } as FlowStep);

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

const VALIDATION_CANARY = "PC-CANARY-7731";
const LOGIN_CANARIES = ["canary.user", "FE-LOGIN-CANARY", "Invalid password"];

interface Scenario {
  key: string;
  steps: FlowStep[];
  /** `resume`: continue the manual handoff; `cancel`: stop the instance once this step is running. */
  drive?: { resume?: true; cancelAtStep?: string };
}

const SCENARIOS: Scenario[] = [
  { key: "toast", steps: [goto("t-goto"), click("t-click", "fe-transient-toast"), waitVisible("t-wait", "fe-order-confirmed")] },
  {
    key: "validation",
    steps: [goto("v-goto"), fill("v-fill", "fe-postcode", VALIDATION_CANARY), click("v-submit", "fe-submit"), assertText("v-assert", "fe-form-status", "submitted")]
  },
  {
    key: "http",
    steps: [
      goto("h-goto"),
      ...[409, 422, 500, 503].flatMap((code) => [click(`h-${code}`, `fe-http-${code}`), waitText(`h-${code}-wait`, `(HTTP ${code})`)]),
      assertText("h-assert", "fe-http-result", "200")
    ]
  },
  { key: "transport", steps: [goto("n-goto"), click("n-click", "fe-transport"), waitText("n-wait", "Network error"), assertText("n-assert", "fe-transport-result", "synced")] },
  { key: "pageerror", steps: [goto("p-goto"), click("p-click", "fe-throw"), assertText("p-assert", "fe-cart-total", "42.00")] },
  { key: "console", steps: [goto("c-goto"), click("c-click", "fe-console-error"), assertText("c-assert", "fe-console-result", "rendered")] },
  { key: "errorpage", steps: [goto("e-goto", `${BASE}/runner-lab/error-page?code=503`), assertText("e-assert", "error-page-heading", "Order history")] },
  { key: "burst", steps: [goto("b-goto"), click("b-click", "fe-burst"), assertText("b-assert", "fe-burst-result", "fresh")] },
  {
    key: "warning",
    steps: [goto("w-goto"), click("w-click", "fe-warn"), waitText("w-wait", "Prices refresh at midnight."), assertText("w-assert", "fe-warn-result", "open")]
  },
  { key: "consequence", steps: [goto("s-goto"), click("s-click", "fe-save-order"), waitVisible("s-wait", "fe-order-saved")] },
  {
    key: "protected",
    steps: [goto("l-goto"), click("l-click", "fe-login-reveal"), waitText("l-wait", "sign-in failed"), assertText("l-assert", "fe-login-result", "signed in")]
  },
  {
    key: "handoff",
    steps: [
      goto("m-goto"),
      click("m-http", "fe-http-500"),
      waitText("m-http-wait", "(HTTP 500)"),
      handoff("m-handoff"),
      click("m-console", "fe-console-error"),
      assertText("m-assert", "fe-console-result", "unavailable")
    ],
    drive: { resume: true }
  },
  {
    key: "cancel",
    steps: [goto("k-goto"), click("k-http", "fe-http-503"), waitText("k-http-wait", "(HTTP 503)"), waitTime("k-long", 60_000)],
    drive: { cancelAtStep: "k-long" }
  },
  { key: "clean", steps: [goto("x-goto"), assertText("x-assert", "failure-status", "idle")] }
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

// ── Engine driver ────────────────────────────────────────────────────────────────────────────────

interface Outcome {
  report: ConcurrentRunReport;
  instance: InstanceReport;
  events: ExecutionEvidenceEvent[];
}

async function runScenarios(engine: ExecutionEngine, dirs: Awaited<ReturnType<typeof buildDirs>>["dirs"], scenarios: Scenario[], tag: string): Promise<Map<string, Outcome | undefined>> {
  const ids = new Map<string, string>();
  for (const scenario of scenarios) {
    const executionId = `uev-${tag}-${scenario.key}-${Date.now().toString(36)}`;
    ids.set(scenario.key, executionId);
    const flowProfile = flow(`uev-flow-${scenario.key}`, scenario.steps);
    await engine.startRun(executionId, runProfile(executionId, `uev-scn-${scenario.key}`), [undefined], dirs, {}, scenarioProfile(`uev-scn-${scenario.key}`, flowProfile.id), [flowProfile]);
  }

  const resumed = new Set<string>();
  const cancelled = new Set<string>();
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const instances = engine.getInstances();
    for (const scenario of scenarios) {
      const instance = instances.find((candidate) => candidate.executionId === ids.get(scenario.key));
      if (!instance) continue;
      if (scenario.drive?.resume && instance.status === "waitingForManualAction" && !resumed.has(instance.instanceId)) {
        resumed.add(instance.instanceId);
        engine.resumeInstance(instance.instanceId);
      }
      const live = instance.liveProgress;
      if (scenario.drive?.cancelAtStep && live?.currentStepId === scenario.drive.cancelAtStep && live.currentStatus === "running" && !cancelled.has(instance.instanceId)) {
        cancelled.add(instance.instanceId);
        engine.stopInstance(instance.instanceId);
      }
    }
    const mine = instances.filter((instance) => [...ids.values()].includes(instance.executionId));
    if (mine.length === scenarios.length && mine.every((instance) => TERMINAL.has(instance.status))) break;
    await sleep(100);
  }

  const outcomes = new Map<string, Outcome | undefined>();
  for (const scenario of scenarios) {
    const path = join(dirs.reports, ids.get(scenario.key)!, "report.json");
    await pollUntil(() => existsSync(path), 30_000);
    if (!existsSync(path)) {
      outcomes.set(scenario.key, undefined);
      continue;
    }
    const report = JSON.parse(readFileSync(path, "utf8")) as ConcurrentRunReport;
    const instance = report.instances[0];
    outcomes.set(scenario.key, instance ? { report, instance, events: instance.diagnostics?.evidence ?? [] } : undefined);
  }
  return outcomes;
}

const bySource = (outcome: Outcome | undefined, source: EvidenceSource) => outcome?.events.filter((event) => event.source === source) ?? [];
const text = (event: ExecutionEvidenceEvent | undefined, field: string) => String(event?.payload[field] ?? "");
const PAGE_SOURCES: EvidenceSource[] = ["ui.alert", "ui.status", "ui.toast", "ui.fieldInvalid", "http.error", "network.failed", "page.error", "console.error", "page.errorDocument"];

// ── Main ─────────────────────────────────────────────────────────────────────────────────────────

let mockSite: ChildProcess | undefined;
const { dirs, root } = await buildDirs("awkit-ui-evidence-");
try {
  console.log("Preconditions");
  mockSite = spawn(process.execPath, [join(ROOT, "mock-site", "server.mjs")], {
    env: { ...process.env, MOCK_SITE_PORT: String(PORT) },
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true
  });
  let mockStderr = "";
  mockSite.stderr?.on("data", (chunk) => (mockStderr += String(chunk)));
  const up = await (async () => {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (await httpOk(`${LAB}`)) return true;
      await sleep(200);
    }
    return false;
  })();
  if (!check("the real mock site serves /runner-lab on loopback", up, `${LAB} ${mockStderr.slice(0, 600)}`)) throw new Error("mock site never came up");
  check("the collector is on (AWKIT_FAILURE_EVIDENCE is not 0)", process.env.AWKIT_FAILURE_EVIDENCE !== "0");

  const engine = new ExecutionEngine();
  engine.configureConcurrency({ maxBrowsersPerHost: 6, maxActiveFlows: 6, useSharedBrowserPool: false, workloadWeights: false });
  const started = Date.now();
  const outcomes = await runScenarios(engine, dirs, SCENARIOS, "a");
  console.log(`  (${SCENARIOS.length} executions through the real engine in ${Math.round((Date.now() - started) / 1000)}s)`);
  for (const scenario of SCENARIOS) check(`report.json persisted with the instance for "${scenario.key}"`, outcomes.get(scenario.key) !== undefined);

  // Every event is correlated to its own execution and instance, never a neighbour's.
  console.log("\nCorrelation");
  {
    const all = [...outcomes.values()].filter((outcome): outcome is Outcome => outcome !== undefined);
    const misattributed = all.flatMap((outcome) =>
      outcome.events.filter((event) => event.context.executionId !== outcome.report.executionId || event.context.instanceId !== outcome.instance.instanceId)
    );
    check("every event names its own execution and instance (14 concurrent runs)", all.length === SCENARIOS.length && misattributed.length === 0, misattributed.slice(0, 2));
    const allIds = all.flatMap((outcome) => outcome.events.map((event) => event.id));
    check("event ids are unique within each instance", all.every((outcome) => new Set(outcome.events.map((event) => event.id)).size === outcome.events.length) && allIds.length > 0);
    const pageEvents = all.flatMap((outcome) => outcome.events.filter((event) => PAGE_SOURCES.includes(event.source)));
    check("every page-derived event carries its page id", pageEvents.length > 0 && pageEvents.every((event) => /^p\d+$/.test(event.context.pageId ?? "")));
    check("every event carries the flow and node that were running", pageEvents.every((event) => event.context.flowId?.startsWith("uev-flow-") && typeof event.context.nodeId === "string"));
    check("every cause cites only evidence that exists in its own report", all.every((outcome) => (outcome.instance.diagnostics?.cause?.evidenceIds ?? []).every((id) => outcome.events.some((event) => event.id === id))));
  }

  console.log("\n1. Transient toast, gone before the timeout is reported");
  {
    const outcome = outcomes.get("toast");
    const toast = bySource(outcome, "ui.toast")[0];
    const runner = bySource(outcome, "runner.failure")[0];
    const cause = outcome?.instance.diagnostics?.cause;
    check("the instance failed", outcome?.instance.status === "failed", outcome?.instance.status);
    check("the toast was captured with its text and error tone", text(toast, "text") === "Payment declined: the card on file has expired." && toast?.severity === "error", toast);
    check("...correlated to the click step that raised it", toast?.context.nodeId === "t-click", toast?.context);
    check("the runner's own failure is a timeout on the wait step", text(runner, "kind") === "timeout" && runner?.context.nodeId === "t-wait", runner);
    check("the toast is well before the failure (it was already gone)", toast !== undefined && runner !== undefined && runner.offsetMs - toast.offsetMs >= 1_000, { toast: toast?.offsetMs, failure: runner?.offsetMs });
    check("cause: uiErrorMessage resting on the toast, citing the timeout", cause?.cause === "uiErrorMessage" && cause.evidenceIds[0] === toast?.id && cause.evidenceIds.includes(runner?.id ?? "-"), cause);
    const failing = outcome?.instance.scenarioResult?.flows[0]?.steps.find((step) => step.stepId === "t-wait");
    const domRef = failing?.evidence?.find((ref) => ref.kind === "dom" && ref.path);
    const dom = domRef?.path && existsSync(domRef.path) ? readFileSync(domRef.path, "utf8") : "";
    // The page's own <script> source names the toast text, so assert on the toast host element itself.
    const host = /<div[^>]*data-testid="fe-toast-host"[^>]*>([\s\S]*?)<\/div>/.exec(dom);
    check(
      "the point-in-time DOM captured at the failure no longer holds the toast (only the collector kept it)",
      host !== null && host[1].trim() === "" && /data-testid="fe-toast-state"[^>]*>dismissed</.test(dom),
      host ? host[0].slice(0, 240) : domRef?.path ?? "no DOM evidence file"
    );
  }

  console.log("\n2. Native and inline form validation");
  {
    const outcome = outcomes.get("validation");
    const fields = bySource(outcome, "ui.fieldInvalid");
    const email = fields.find((event) => text(event, "field") === "email");
    const postcode = fields.find((event) => text(event, "field") === "postcode");
    check("native validation: the required email, valueMissing, with the browser's message", email?.payload.validity === "valueMissing" && text(email, "message").length > 0, email);
    check("inline validation: the postcode, aria-invalid, with its described-by text", postcode?.payload.validity === "ariaInvalid" && text(postcode, "describedBy") === "Postcode must be 5 digits.", postcode);
    check("cause: uiValidation", outcome?.instance.diagnostics?.cause?.cause === "uiValidation", outcome?.instance.diagnostics?.cause);
    check("the typed value never reaches the evidence", !JSON.stringify(outcome?.instance.diagnostics ?? {}).includes(VALIDATION_CANARY));
  }

  console.log("\n3. HTTP 409, 422, 500 and 503");
  {
    const outcome = outcomes.get("http");
    const http = bySource(outcome, "http.error");
    const statuses = http.map((event) => event.payload.status).sort();
    check("four HTTP errors, one per status", JSON.stringify(statuses) === JSON.stringify([409, 422, 500, 503]), statuses);
    check("metadata only: method, a query-free path template, status, resource type", http.length === 4 && http.every((event) => event.payload.method === "GET" && event.payload.url === `${BASE}/api/status` && event.payload.resourceType === "fetch" && Object.keys(event.payload).length === 4), http[0]?.payload);
    check(
      "each response is correlated to its own click or the wait that followed it",
      http.every((event) => [`h-${event.payload.status}`, `h-${event.payload.status}-wait`].includes(event.context.nodeId ?? "")),
      http.map((event) => `${event.payload.status}@${event.context.nodeId}`)
    );
    const alerts = bySource(outcome, "ui.alert");
    check("each distinct alert text is its own event", alerts.length === 4 && [409, 422, 500, 503].every((code) => alerts.some((event) => text(event, "text").endsWith(`(HTTP ${code})`))), alerts.map((event) => text(event, "text")));
    const cause = outcome?.instance.diagnostics?.cause;
    const first = http.find((event) => event.payload.status === 409);
    check("cause: httpError resting on the earliest (409), from the window before the failing step", cause?.cause === "httpError" && cause.evidenceIds[0] === first?.id && cause.window === "preceding", cause);
  }

  console.log("\n4. Transport failure");
  {
    const outcome = outcomes.get("transport");
    const net = bySource(outcome, "network.failed")[0];
    check("the dropped connection is a network failure, not an HTTP status", /ERR_EMPTY_RESPONSE/.test(text(net, "failure")) && net?.payload.url === `${BASE}/api/transport-drop` && bySource(outcome, "http.error").length === 0, net);
    check("cause: transportFailure resting on it", outcome?.instance.diagnostics?.cause?.cause === "transportFailure" && outcome.instance.diagnostics.cause.evidenceIds[0] === net?.id, outcome?.instance.diagnostics?.cause);
  }

  console.log("\n5. Uncaught page error");
  {
    const outcome = outcomes.get("pageerror");
    const error = bySource(outcome, "page.error")[0];
    check("a real TypeError with its message", text(error, "name") === "TypeError" && text(error, "message").includes("reading 'total'"), error);
    check("cause: scriptError", outcome?.instance.diagnostics?.cause?.cause === "scriptError" && outcome.instance.diagnostics.cause.evidenceIds[0] === error?.id, outcome?.instance.diagnostics?.cause);
  }

  console.log("\n6. A console error never outranks the runner's own diagnosis");
  {
    const outcome = outcomes.get("console");
    const log = bySource(outcome, "console.error").find((event) => text(event, "text").includes("Checkout widget"));
    const cause = outcome?.instance.diagnostics?.cause;
    check("console.error captured, bounded text", text(log, "text") === "Checkout widget failed to render: missing configuration." && log?.severity === "warning", log);
    const runner = bySource(outcome, "runner.failure")[0];
    check(
      "cause: assertionFailed resting on the runner's own failure, the console error cited only as context",
      cause?.cause === "assertionFailed" && cause.evidenceIds[0] === runner?.id && cause.evidenceIds.includes(log?.id ?? "-"),
      cause
    );
  }

  console.log("\n7. Application error page");
  {
    const outcome = outcomes.get("errorpage");
    const doc = bySource(outcome, "page.errorDocument")[0];
    check(
      "status, query-free URL, title and heading — never the page body",
      doc?.payload.status === 503 && doc.payload.url === `${BASE}/runner-lab/error-page` && doc.payload.title === "Service unavailable" && doc.payload.heading === "We could not load your orders" && !("detail" in doc.payload),
      doc
    );
    check("cause: errorPage", outcome?.instance.diagnostics?.cause?.cause === "errorPage" && outcome.instance.diagnostics.cause.evidenceIds[0] === doc?.id, outcome?.instance.diagnostics?.cause);
  }

  console.log("\n8. Repeated and simultaneous errors");
  {
    const outcome = outcomes.get("burst");
    const toasts = bySource(outcome, "ui.toast");
    const alerts = bySource(outcome, "ui.alert");
    check("three identical toasts fold into one event with a repeat count of 3", toasts.length === 1 && toasts[0].repeatCount === 3 && text(toasts[0], "text") === "Could not refresh prices.", toasts);
    check("the different alert stays its own event", alerts.length === 1 && text(alerts[0], "text") === "Inventory service unavailable.", alerts);
    check("the summary counts the folded repeats", (outcome?.instance.diagnostics?.summary.repeats ?? 0) >= 2, outcome?.instance.diagnostics?.summary);
    check("cause: uiErrorMessage", outcome?.instance.diagnostics?.cause?.cause === "uiErrorMessage", outcome?.instance.diagnostics?.cause);
  }

  console.log("\n9. A passing run with an unrelated warning");
  {
    const outcome = outcomes.get("warning");
    const status = bySource(outcome, "ui.status")[0];
    const log = bySource(outcome, "console.error").find((event) => text(event, "text").includes("Analytics beacon"));
    check("the instance passed", outcome?.instance.status === "passed", outcome?.instance.status);
    check("its evidence is kept: the neutral status note (info) and the console error", text(status, "text") === "Prices refresh at midnight." && status?.severity === "info" && log !== undefined, outcome?.events);
    check("a passed run gets no cause", outcome?.instance.diagnostics !== undefined && outcome.instance.diagnostics.cause === undefined, outcome?.instance.diagnostics?.cause);
  }

  console.log("\n10. A failure followed by a consequential wait timeout");
  {
    const outcome = outcomes.get("consequence");
    const http = bySource(outcome, "http.error")[0];
    const alert = bySource(outcome, "ui.alert")[0];
    const runner = bySource(outcome, "runner.failure")[0];
    const cause = outcome?.instance.diagnostics?.cause;
    check("the 409, its alert, and the later timeout are all captured", http?.payload.status === 409 && text(alert, "text").startsWith("Could not save the order") && text(runner, "kind") === "timeout", { http, alert, runner });
    check("cause: httpError (the root), citing the timeout as its consequence", cause?.cause === "httpError" && cause.evidenceIds[0] === http?.id && cause.evidenceIds.includes(runner?.id ?? "-"), cause);
  }

  console.log("\n11. A protected-login surface is excluded entirely");
  {
    const outcome = outcomes.get("protected");
    const diagnostics = outcome?.instance.diagnostics;
    const serialized = JSON.stringify(diagnostics ?? {});
    check("nothing page-derived is kept, only the runner's own failure", diagnostics !== undefined && diagnostics.evidence.every((event) => event.source === "runner.failure") && diagnostics.evidence.length === 1, diagnostics?.evidence);
    check("the exclusions are counted, never silent", (diagnostics?.summary.dropped.protected ?? 0) >= 2, diagnostics?.summary);
    check("no canary from the login surface reaches the report", LOGIN_CANARIES.every((canary) => !serialized.includes(canary)), LOGIN_CANARIES.filter((canary) => serialized.includes(canary)));
    check("the cause is the runner's own (assertion), not page evidence", diagnostics?.cause?.cause === "assertionFailed", diagnostics?.cause);
  }

  console.log("\n12. Manual handoff: evidence on both sides of the pause, no cause for a pass");
  {
    const outcome = outcomes.get("handoff");
    const http = bySource(outcome, "http.error")[0];
    const log = bySource(outcome, "console.error").find((event) => text(event, "text").includes("Checkout widget"));
    check("the handoff was resumed and the run passed", outcome?.instance.status === "passed", outcome?.instance.status);
    check("evidence from before the handoff is kept", http?.payload.status === 500 && ["m-http", "m-http-wait"].includes(http.context.nodeId ?? ""), http);
    check("capture resumes after the handoff", log !== undefined && log.context.nodeId === "m-console", log);
    check("no cause for a passed run", outcome?.instance.diagnostics?.cause === undefined);
  }

  console.log("\n13. User cancellation");
  {
    const outcome = outcomes.get("cancel");
    const http = bySource(outcome, "http.error")[0];
    check("the cancelled instance's report reached report.json", outcome !== undefined);
    check("evidence gathered before the cancel is kept", http?.payload.status === 503, outcome?.events);
    check("cause: cancelled (never blamed on the evidence)", outcome?.instance.diagnostics?.cause?.cause === "cancelled", outcome?.instance.diagnostics?.cause);
  }

  console.log("\n14. A clean pass does not grow its report");
  {
    const outcome = outcomes.get("clean");
    check("passed with no diagnostics block at all", outcome?.instance.status === "passed" && outcome.instance.diagnostics === undefined && !("diagnostics" in (outcome?.instance ?? {})), outcome?.instance.diagnostics);
  }

  console.log("\nBounds, privacy and schema across every report");
  {
    const all = [...outcomes.values()].filter((outcome): outcome is Outcome => outcome !== undefined);
    const events = all.flatMap((outcome) => outcome.events);
    check("every event carries schema version 1 and a dedupe key", events.length > 0 && events.every((event) => event.schemaVersion === 1 && event.dedupeKey.length > 0));
    check("every payload field is a bounded scalar", events.every((event) => Object.values(event.payload).every((value) => typeof value !== "string" || value.length <= 500)));
    check("no URL anywhere keeps a query string", events.every((event) => !String(event.payload.url ?? "").includes("?")));
    const runnerMessages = events.filter((event) => event.source === "runner.failure").map((event) => String(event.payload.message));
    check(
      "runner messages keep the diagnosis line only: no colour codes, no Playwright call log quoting page HTML",
      runnerMessages.length >= 10 && runnerMessages.every((message) => message.length > 0 && !message.includes("Call log") && !message.includes(String.fromCharCode(27)) && !message.includes("<")),
      runnerMessages.find((message) => message.includes("Call log") || message.includes("<"))
    );
    check("every report's summary matches its evidence", all.every((outcome) => !outcome.instance.diagnostics || outcome.instance.diagnostics.summary.accepted === outcome.instance.diagnostics.evidence.length));
    check("no collector degraded", all.every((outcome) => outcome.instance.diagnostics?.degraded === undefined), all.map((outcome) => outcome.instance.diagnostics?.degraded).filter(Boolean));
  }

  console.log("\nThe off switch");
  {
    process.env.AWKIT_FAILURE_EVIDENCE = "0";
    const off = await runScenarios(engine, dirs, [SCENARIOS[0]], "off");
    delete process.env.AWKIT_FAILURE_EVIDENCE;
    const outcome = off.get("toast");
    check("AWKIT_FAILURE_EVIDENCE=0: the same failing run writes no diagnostics (the pre-L5a report shape)", outcome?.instance.status === "failed" && !("diagnostics" in (outcome?.instance ?? {})), outcome?.instance.diagnostics);
  }

  console.log("\nTeardown");
  {
    const attachments = await pollUntil(() => {
      const live = liveEvidenceAttachments();
      return live.pages === 0 && live.generations === 0 ? live : undefined;
    }, 10_000);
    check("every page listener and generation binding was released", attachments !== undefined, liveEvidenceAttachments());
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
