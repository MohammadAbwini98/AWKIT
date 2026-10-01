/**
 * verify:recovery-provenance — L11.H locator repair and recovery provenance in execution reports.
 *
 * Real runs through the REAL `ExecutionEngine` (real Chromium, `StepExecutor`, `LocatorFactory`) against the
 * Feature Test Lab's /dom-context-lab SPA routes, read back from the `report.json` the real `ReportService`
 * persisted. The runs share one runtime root, so winner memory and DOM references persist between them
 * exactly as they do between a user's runs:
 *   seed        — the recorded locator resolves (memory and a DOM reference are written);
 *   recovered   — `?drift=testid`: the recorded test id is gone, AWKIT's snapshot proof recovers the element;
 *   route       — the page moves to another SPA route with a look-alike: recovery refuses, the step fails;
 *   timeout / unavailable / malformed / suggested — `?drift=gone`: no candidate, so the non-executing
 *                 provider stage runs against a provider that hangs, is disabled, answers malformed, or
 *                 proposes an element AWKIT's proof rejects.
 * Every recovery attempt must leave one bounded, code-only `data.locatorRecovery` record on its log entry:
 * the stages, outcomes, timings and counts, the page alias, frame and route agreement; `actedOn` only when
 * AWKIT's proof acted; provider evidence always `effect: none`; never DOM, page text, a selector, a URL or a
 * secret. A hung provider must not hold the step past its budget.
 *
 * Run: npm run verify:recovery-provenance   (node scripts/benchmark/run.mjs → tsx + the electron stub)
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ConcurrentRunProfile } from "@src/instances/ConcurrentRunProfile";
import type { FlowProfile, FlowStep } from "@src/profiles/FlowProfile";
import type { ScenarioProfile } from "@src/profiles/ScenarioProfile";
import type { ConcurrentRunReport, InstanceReport } from "@src/reports/ExecutionReport";
import type { StructuredLog } from "@src/reports/StructuredLog";
import { ExecutionEngine } from "@src/runner/ExecutionEngine";
import { MemoryDomReferenceStore } from "@src/runner/domIntelligence/domReference";
import type { DomIntelligenceProvider, DomRecoveryResult } from "@src/runner/domIntelligence/DomIntelligenceProvider";
import { NoopDomIntelligenceProvider } from "@src/runner/domIntelligence/DomIntelligenceProvider";
import { RECOVERY_PROVENANCE_MAX_EVENTS, toRecoveryProvenance, type LocatorRecoveryProvenance } from "@src/runner/domIntelligence/recoveryProvenance";
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
const ORDERS = `${BASE}/dom-context-lab/route/orders`;
const TERMINAL = new Set(["completed", "failed", "cancelled"]);
/** The engine's per-attempt suggestion budget (DomIntelligenceRecoveryOptions.budgetMs). */
const BUDGET_MS = 600;

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
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

type ProviderMode = "timeout" | "unavailable" | "malformed" | "suggest";
/** A controllable stand-in for the parser-only host (whose own contract is verify:dom-intelligence-host). */
class ScriptedProvider implements DomIntelligenceProvider {
  mode: ProviderMode = "suggest";
  calls = 0;
  private readonly off = new NoopDomIntelligenceProvider();
  async getStatus() {
    return this.mode === "unavailable"
      ? this.off.getStatus()
      : { available: true, provider: "scrapling" as const, mode: "parser-only" as const, browserAccess: false as const, networkAccess: false as const };
  }
  async findRecoveryCandidates(): Promise<DomRecoveryResult> {
    this.calls += 1;
    if (this.mode === "timeout") return new Promise(() => undefined);
    if (this.mode === "unavailable") return { ok: false, code: "DISABLED", message: "off" };
    if (this.mode === "malformed") return { ok: false, code: "MALFORMED", message: "The host answered outside the protocol." };
    // Index 0 of `body *` is the lab's <main>: a real element AWKIT's proof must reject.
    return { ok: true, candidates: [{ index: 0, score: 91 }], elements: 40, parseMs: 1, matchMs: 1 };
  }
  saveReference = () => this.off.saveReference();
  normalizeForAi = () => this.off.normalizeForAi();
  shutdown = () => this.off.shutdown();
}

const exportStep: FlowStep = { id: "rp-export", type: "click", name: "Export the list", timeoutMs: 1_500, locator: { strategy: "testId", value: "dcl-route-export", blueprintId: "rp-export-ref" } };
function flow(steps: FlowStep[]): FlowProfile {
  const nodes: FlowStep[] = [{ id: "start", type: "start", name: "start" }, ...steps, { id: "end", type: "end", name: "end" }];
  // One flow id for every run: winner memory is scoped by scenario, flow and step.
  return { id: "rp-flow", name: "rp-flow", version: 1, nodes, edges: nodes.slice(0, -1).map((node, index) => ({ id: `rp-e${index}`, source: node.id, target: nodes[index + 1].id, type: "success" })) } as FlowProfile;
}
const goto = (url: string): FlowStep => ({ id: "rp-goto", type: "goto", name: "Open orders", url });
const scenario: ScenarioProfile = {
  id: "rp-scn",
  name: "rp-scn",
  executionMode: "sequential",
  maxParallelFlows: 1,
  flows: [{ order: 1, flowId: "rp-flow", required: true }],
  links: [],
  failurePolicy: { stopOnRequiredFlowFailure: true, continueOnOptionalFlowFailure: false, takeScreenshotOnFailure: false }
};
const runProfile = (executionId: string): ConcurrentRunProfile => ({
  id: executionId,
  scenarioId: scenario.id,
  runMode: "fixedConcurrent",
  maxConcurrentInstances: 1,
  browserWindowMode: "headless",
  instanceTemplate: { browser: "chromium", headless: true, isolationMode: "browserContext", baseUrl: BASE, timeoutMs: 30_000, viewport: { width: 1280, height: 720 } },
  resourceControls: { maxBrowserContextsPerProcess: 4, delayBetweenInstanceStartsMs: 0 },
  failurePolicy: { stopAllOnCriticalFailure: false, continueOtherInstancesOnFailure: true, retryFailedInstance: false, retryCount: 0 }
});

interface Run {
  instance?: InstanceReport;
  logs: StructuredLog[];
  provenance: LocatorRecoveryProvenance[];
  wallMs: number;
}

async function run(engine: ExecutionEngine, dirs: Awaited<ReturnType<typeof buildDirs>>["dirs"], key: string, steps: FlowStep[]): Promise<Run> {
  const executionId = `rp-${key}-${Date.now().toString(36)}`;
  const started = Date.now();
  await engine.startRun(executionId, runProfile(executionId), [undefined], dirs, {}, scenario, [flow(steps)]);
  for (let waited = 0; waited < 60_000; waited += 100) {
    const mine = engine.getInstances().filter((instance) => instance.executionId === executionId);
    if (mine.length === 1 && TERMINAL.has(mine[0].status)) break;
    await sleep(100);
  }
  const wallMs = Date.now() - started;
  const path = join(dirs.reports, executionId, "report.json");
  for (let waited = 0; !existsSync(path) && waited < 30_000; waited += 100) await sleep(100);
  if (!existsSync(path)) return { logs: [], provenance: [], wallMs };
  const instance = (JSON.parse(readFileSync(path, "utf8")) as ConcurrentRunReport).instances[0];
  const logs = instance?.scenarioResult?.logs ?? [];
  const provenance = logs.flatMap((log) => (log.data?.locatorRecovery ? [log.data.locatorRecovery as LocatorRecoveryProvenance] : []));
  return { instance, logs, provenance, wallMs };
}

const FIELDS = new Set(["schemaVersion", "engine", "result", "actedOn", "page", "frame", "frameDepth", "route", "totalMs", "events"]);
const EVENT_FIELDS = new Set(["event", "source", "stage", "ms", "candidates", "score", "runnerUpScore", "reason", "effect", "provider", "providerScore", "awkitScore", "fallback"]);
/** Every string in a record is a fixed code: lower-case words, digits, hyphens and one colon. */
const CODE = /^[a-z][a-z0-9-]*(:[a-z0-9-]+)?$/;

function privacyProblems(record: LocatorRecoveryProvenance): string[] {
  const problems: string[] = [];
  const text = JSON.stringify(record);
  if (text.length > 2_048) problems.push(`record is ${text.length} bytes`);
  for (const forbidden of ["Export list", "Export the list", "dcl-", "http", "127.0.0.1", "<", "[masked]", "orders", "archive"]) {
    if (text.includes(forbidden)) problems.push(`contains ${forbidden}`);
  }
  for (const key of Object.keys(record)) if (!FIELDS.has(key)) problems.push(`field ${key}`);
  for (const event of record.events) {
    for (const [key, value] of Object.entries(event)) {
      if (!EVENT_FIELDS.has(key)) problems.push(`event field ${key}`);
      if (typeof value === "string" && !CODE.test(value)) problems.push(`value ${value}`);
      if (typeof value !== "string" && typeof value !== "number") problems.push(`${key} is ${typeof value}`);
    }
  }
  for (const value of [record.engine, record.result, record.page, record.frame, record.route]) if (!CODE.test(String(value))) problems.push(`value ${value}`);
  return problems;
}

const names = (record: LocatorRecoveryProvenance | undefined) => record?.events.map((event) => event.event).join(",") ?? "";

let mockSite: ChildProcess | undefined;
const { dirs, root } = await buildDirs("awkit-recovery-provenance-");
try {
  mockSite = spawn(process.execPath, [join(ROOT, "mock-site", "server.mjs")], { env: { ...process.env, MOCK_SITE_PORT: String(PORT) }, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  for (let attempt = 0; attempt < 100 && !(await fetch(ORDERS).then((r) => r.ok, () => false)); attempt += 1) await sleep(100);
  const engine = new ExecutionEngine();
  engine.configureConcurrency({ maxBrowsersPerHost: 2, maxActiveFlows: 2, useSharedBrowserPool: false, workloadWeights: false });
  const provider = new ScriptedProvider();
  const references = new MemoryDomReferenceStore();
  engine.setDomIntelligence({ provider, references, budgetMs: BUDGET_MS });
  const click = (target: string): FlowStep => ({ id: `rp-${target}`, type: "click", name: target, locator: { strategy: "testId", value: target } });

  console.log("Seed: the recorded locator resolves");
  const seed = await run(engine, dirs, "seed", [goto(ORDERS), exportStep]);
  check("the seed run passed", seed.instance?.status === "passed", seed.instance?.status);
  check("no recovery ran, so no provenance record was written", seed.provenance.length === 0, seed.provenance.length);
  const refreshed = seed.logs.filter((log) => log.message.startsWith("[locator:reference-refreshed]"));
  check("the reference refresh is reported once, as a bounded event of its own", refreshed.length === 1 && refreshed[0].stepId === exportStep.id && refreshed[0].data === undefined);

  console.log("Recovered: AWKIT's proof acted");
  const recovered = await run(engine, dirs, "recovered", [goto(`${ORDERS}?drift=testid`), exportStep]);
  const rec = recovered.provenance[0];
  check("the drifted run passed through recovery", recovered.instance?.status === "passed", recovered.instance?.status);
  check("exactly one provenance record, on the step's own log entry", recovered.provenance.length === 1 && recovered.logs.some((log) => log.stepId === exportStep.id && log.data?.locatorRecovery));
  check("schema version 1, snapshot engine, recovered", rec?.schemaVersion === 1 && rec.engine === "snapshot" && rec.result === "recovered");
  check("actedOn names AWKIT's proof", rec?.actedOn === "awkit-proof");
  check("events: primary failed, snapshot recovery invoked, AWKIT candidate proven", names(rec) === "primary-failed,snapshot-recovery-invoked,awkit-candidate-proven", names(rec));
  check("context: page main, top frame, same route", rec?.page === "main" && rec.frame === "main" && rec.frameDepth === 0 && rec.route === "match", rec);
  check("the proof carries its score and competitor count, and timings", (rec?.events[2].score ?? 0) >= 0.86 && (rec?.events[2].candidates ?? 0) > 0 && typeof rec?.events[2].ms === "number" && typeof rec.totalMs === "number");
  check("no provider event: the provider is only ever consulted after both layers refused", provider.calls === 0 && !names(rec).includes("provider"));

  console.log("Route mismatch: nothing acted, the step failed normally");
  const moved = await run(engine, dirs, "route", [goto(`${ORDERS}?drift=testid`), click("dcl-go-archive"), exportStep]);
  const mov = moved.provenance[0];
  check("the run failed on the export step", moved.instance?.status === "failed", moved.instance?.status);
  check("events: primary failed, route mismatch, fallback used", names(mov) === "primary-failed,route-mismatch,fallback-used", names(mov));
  check("no actedOn, route mismatch recorded, fallback to the recorded locator", mov?.actedOn === undefined && mov.route === "mismatch" && mov.events.at(-1)?.fallback === "recorded-locator");
  check("the provider was not consulted on another route", provider.calls === 0);

  const providerRun = async (mode: ProviderMode) => {
    provider.mode = mode;
    const before = provider.calls;
    const outcome = await run(engine, dirs, mode, [goto(`${ORDERS}?drift=gone`), exportStep]);
    return { outcome, record: outcome.provenance[0], consulted: provider.calls - before };
  };

  console.log("Provider timeout: bounded by the suggestion budget, then the normal failure");
  const timeout = await providerRun("timeout");
  const timedOut = timeout.record?.events.find((event) => event.event === "provider-timeout");
  check("the run still ended (a hung provider never holds the step)", timeout.outcome.instance?.status === "failed" && timeout.outcome.wallMs < 20_000, timeout.outcome.wallMs);
  check("events: local invoked and refused, blueprint refused (skipped), provider timeout, fallback", names(timeout.record) === "primary-failed,snapshot-recovery-invoked,snapshot-recovery-refused,snapshot-recovery-refused,provider-timeout,fallback-used", names(timeout.record));
  check("the refusals carry their codes", timeout.record?.events[2].reason?.startsWith("refused:") === true && timeout.record?.events[3].reason?.startsWith("skipped:") === true, timeout.record?.events.map((event) => event.reason));
  check("the provider was consulted once", timeout.consulted === 1, timeout.consulted);
  check("the timeout event is provider evidence with no effect, within the budget", timedOut?.source === "dom-intelligence" && timedOut.effect === "none" && (timedOut.ms ?? Infinity) < BUDGET_MS + 400, timedOut);

  console.log("Provider unavailable and malformed: recorded, then the normal failure");
  const unavailable = await providerRun("unavailable");
  check("unavailable: provider-unavailable, effect none, then fallback", unavailable.record?.events.some((event) => event.event === "provider-unavailable" && event.effect === "none") === true && unavailable.record?.events.at(-1)?.event === "fallback-used", names(unavailable.record));
  const malformed = await providerRun("malformed");
  check("malformed answer: provider-error, effect none, then fallback", malformed.record?.events.some((event) => event.event === "provider-error" && event.effect === "none" && event.reason === "provider-error") === true && malformed.record?.events.at(-1)?.event === "fallback-used", names(malformed.record));

  console.log("Provider suggestion: generated, rejected by AWKIT, never executed");
  const suggested = await providerRun("suggest");
  const generated = suggested.record?.events.find((event) => event.event === "provider-suggestion-generated");
  const rejected = suggested.record?.events.find((event) => event.event === "provider-suggestion-rejected");
  check("the suggestion is recorded as generated, with no effect", generated?.source === "dom-intelligence" && generated.effect === "none" && generated.provider === "scrapling" && generated.candidates === 1, generated);
  check("...and rejected by AWKIT with its proof code and both scores", rejected?.source === "awkit" && typeof rejected.reason === "string" && rejected.reason !== "proven" && rejected.providerScore === 91 && typeof rejected.awkitScore === "number", rejected);
  check("...and the step still failed normally: nothing acted on the suggestion", suggested.outcome.instance?.status === "failed" && suggested.record?.actedOn === undefined && suggested.record?.events.at(-1)?.event === "fallback-used");

  console.log("Every record is bounded, code-only and private");
  const all = [recovered, moved, timeout.outcome, unavailable.outcome, malformed.outcome, suggested.outcome].flatMap((outcome) => outcome.provenance);
  check("six recovery attempts, six records", all.length === 6, all.length);
  const problems = all.flatMap((record) => privacyProblems(record));
  check("no DOM, page text, selector, URL, route value or masked field; only allowlisted fields and codes", problems.length === 0, problems);
  check(`at most ${RECOVERY_PROVENANCE_MAX_EVENTS} events per record`, all.every((record) => record.events.length <= RECOVERY_PROVENANCE_MAX_EVENTS));
  check("actedOn appears only on the recovered record, and only as awkit-proof", all.filter((record) => record.actedOn !== undefined).length === 1 && all.every((record) => record.actedOn === undefined || (record.actedOn === "awkit-proof" && record.result === "recovered")));
  check("no provider event ever claims an effect", all.flatMap((record) => record.events).filter((event) => event.source === "dom-intelligence").every((event) => event.effect === "none"));
  check("no report line says a provider acted (clicked, filled, executed)", !all.some((record) => JSON.stringify(record).match(/clicked|filled|executed|acted-by-provider/)));
  // The provider name comes from a provider's own status: only a fixed code may reach the record.
  const forged = toRecoveryProvenance({
    engine: "snapshot",
    result: "unresolved",
    totalMs: 1,
    stages: [{ stage: "provider", outcome: "suggested", ms: 1, candidates: 1 }],
    suggestion: { provider: "<img src=x> https://evil.example" as never, candidates: 1 },
    context: { page: "main", frame: "main", frameDepth: 0, route: "unbound" },
    candidatesTried: 1
  });
  check("a provider name outside the fixed codes is recorded as 'none'", forged.events.some((event) => event.event === "provider-suggestion-generated" && event.provider === "none") && !JSON.stringify(forged).includes("evil"), forged.events);
} finally {
  mockSite?.kill();
  await cleanupRoot(root);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
