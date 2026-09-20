/**
 * verify:failure-capture-overhead — Phase L L5a: what run-lifetime failure capture costs a normal run,
 * measured through the REAL `ExecutionEngine` against the REAL mock site with capture ON and OFF
 * (`AWKIT_FAILURE_EVIDENCE=0`), and proof that the run path makes zero AI calls.
 *
 * Batches alternate ON/OFF (the order flips every round, so drift cancels) after one untimed warm-up.
 * Each batch runs two passing workloads concurrently, several instances each:
 *   - fast:     open the lab and assert one value (a "< 3 s" run),
 *   - evidence: trigger an HTTP 500, a toast burst and an unrelated warning, then assert (the collector
 *               is doing real work: listeners, init script, buffering, de-duplication).
 * Per batch: instance durations (median/p95, from report.json), Node CPU (process.cpuUsage), Node RSS
 * and event-loop delay, Chromium CPU/RSS where supported (Windows CIM), event volume and bytes, and
 * that every page listener and binding was released.
 *
 * The acceptance ceilings below were proposed from this suite's first measurement on a development
 * machine (2026-09-19). They are a development-host gate, not a VMware production latency claim; the
 * owner approves them in the L5 plan, and if capture ever fails them the default changes (L5 plan).
 *
 * Run: npm run verify:failure-capture-overhead   (node scripts/benchmark/run.mjs → tsx + electron stub)
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { get as httpGet } from "node:http";
import { createServer } from "node:net";
import { dirname, join, relative, resolve } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { ExecutionEngine } from "@src/runner/ExecutionEngine";
import type { ConcurrentRunProfile } from "@src/instances/ConcurrentRunProfile";
import type { FlowProfile, FlowStep } from "@src/profiles/FlowProfile";
import type { ScenarioProfile } from "@src/profiles/ScenarioProfile";
import type { ConcurrentRunReport } from "@src/reports/ExecutionReport";
import { FailureEvidenceCollector, liveEvidenceAttachments } from "@src/runner/evidence/FailureEvidenceCollector";
import { stats, type Stats } from "./benchmark/lib.mts";
import { buildDirs, cleanupRoot, installBenchGuards } from "./benchmark/engineHarness.mts";

installBenchGuards();

/**
 * Format stack traces as the packaged app does. tsx turns on source-mapped stacks for every script;
 * the Electron main bundle has no source maps and nothing enables them. Playwright captures a stack for
 * every client API call and pre-builds an error (with its stack) for every CDP command, so under tsx
 * each one paid a source-map translation (~8 ms per call measured, 2026-09-19) that production never
 * pays, charged to whichever mode makes more calls. `AWKIT_L5A_OVERHEAD_SOURCE_MAPS=1` keeps them on.
 */
const SOURCE_MAPPED_STACKS = process.env.AWKIT_L5A_OVERHEAD_SOURCE_MAPS === "1";
if (!SOURCE_MAPPED_STACKS) process.setSourceMapsEnabled(false);

/** Attribution only: time the collector's awaited lifecycle calls without changing what they do. */
const lifecycleMs: Record<"startGeneration" | "stopGeneration", number[]> = { startGeneration: [], stopGeneration: [] };
for (const method of ["startGeneration", "stopGeneration"] as const) {
  const original = FailureEvidenceCollector.prototype[method] as (...args: unknown[]) => Promise<void>;
  (FailureEvidenceCollector.prototype as unknown as Record<string, unknown>)[method] = async function (this: FailureEvidenceCollector, ...args: unknown[]) {
    const started = performance.now();
    try {
      return await original.apply(this, args);
    } finally {
      lifecycleMs[method].push(performance.now() - started);
    }
  };
}

/**
 * Acceptance ceilings for capture ON versus OFF, per workload. Proposed from the first measured run
 * (see the L5 plan's overhead record). A ceiling is a fraction of the OFF value or an absolute floor,
 * whichever is larger, so millisecond-scale jitter on a fast run cannot fail the gate by itself.
 */
export const FAILURE_CAPTURE_OVERHEAD_CEILINGS = Object.freeze({
  medianDurationFraction: 0.1,
  medianDurationFloorMs: 150,
  p95DurationFraction: 0.15,
  p95DurationFloorMs: 300,
  /** Node-process CPU per instance (the collector's listeners and buffer run there). */
  nodeCpuPerInstanceFraction: 0.25,
  nodeCpuPerInstanceFloorMs: 40,
  /** Bytes of evidence one passing evidence-workload instance may add to its report. */
  maxEvidenceBytesPerInstance: 4 * 1024
});

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ROUNDS = envInt("AWKIT_L5A_OVERHEAD_ROUNDS", 6);
const INSTANCES = envInt("AWKIT_L5A_OVERHEAD_INSTANCES", 3);

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: unknown): boolean {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}${detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
  return Boolean(condition);
}
const sleep = (ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

// ── Zero AI calls on the run path: the engine's import closure reaches no AI module ────────────────

function resolveSpecifier(from: string, specifier: string): string | undefined {
  let base: string;
  if (specifier.startsWith("@src/")) base = join(ROOT, "src", specifier.slice(5));
  else if (specifier.startsWith("@main/")) base = join(ROOT, "app", "main", specifier.slice(6));
  else if (specifier.startsWith(".")) base = resolve(dirname(from), specifier);
  else return undefined; // a package, not repository code
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

function importClosure(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  const pattern = /(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of readFileSync(file, "utf8").matchAll(pattern)) {
      const next = resolveSpecifier(file, match[1] ?? match[2] ?? match[3]);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return seen;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────

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

const testId = (value: string) => ({ strategy: "testId" as const, value });
const WORKLOADS: Record<"fast" | "evidence", FlowStep[]> = {
  fast: [
    { id: "goto", type: "goto", name: "goto", url: LAB },
    { id: "assert", type: "assertText", name: "assert", locator: testId("failure-status"), timeoutMs: 3_000, config: { assertionType: "text", comparisonOperator: "equals", expectedValue: "idle" } }
  ],
  evidence: [
    { id: "goto", type: "goto", name: "goto", url: LAB },
    { id: "http", type: "click", name: "http", locator: testId("fe-http-500") },
    { id: "http-wait", type: "wait", name: "http-wait", value: "(HTTP 500)", timeoutMs: 5_000, config: { waitType: "textVisible" } },
    { id: "burst", type: "click", name: "burst", locator: testId("fe-burst") },
    { id: "warn", type: "click", name: "warn", locator: testId("fe-warn") },
    { id: "warn-wait", type: "wait", name: "warn-wait", value: "Prices refresh at midnight.", timeoutMs: 5_000, config: { waitType: "textVisible" } },
    { id: "assert", type: "assertText", name: "assert", locator: testId("fe-warn-result"), timeoutMs: 3_000, config: { assertionType: "text", comparisonOperator: "equals", expectedValue: "open" } }
  ]
};

function flowOf(key: string, steps: FlowStep[]): FlowProfile {
  const nodes: FlowStep[] = [{ id: "start", type: "start", name: "start" }, ...steps, { id: "end", type: "end", name: "end" }];
  return { id: `ovh-${key}`, name: `ovh-${key}`, version: 1, nodes, edges: nodes.slice(0, -1).map((node, i) => ({ id: `ovh-${key}-e${i}`, source: node.id, target: nodes[i + 1].id, type: "success" })) } as FlowProfile;
}
function scenarioOf(key: string): ScenarioProfile {
  return {
    id: `ovh-scn-${key}`,
    name: `ovh-scn-${key}`,
    executionMode: "sequential",
    maxParallelFlows: 1,
    flows: [{ order: 1, flowId: `ovh-${key}`, required: true }],
    links: [],
    failurePolicy: { stopOnRequiredFlowFailure: true, continueOnOptionalFlowFailure: false, takeScreenshotOnFailure: false }
  };
}
function profileOf(executionId: string, key: string): ConcurrentRunProfile {
  return {
    id: executionId,
    scenarioId: `ovh-scn-${key}`,
    runMode: "fixedConcurrent",
    maxConcurrentInstances: INSTANCES,
    browserWindowMode: "headless",
    instanceTemplate: { browser: "chromium", headless: true, isolationMode: "browserContext", baseUrl: BASE, timeoutMs: 30_000, viewport: { width: 1280, height: 720 } },
    resourceControls: { maxBrowserContextsPerProcess: 8, delayBetweenInstanceStartsMs: 0 },
    failurePolicy: { stopAllOnCriticalFailure: false, continueOtherInstancesOnFailure: true, retryFailedInstance: false, retryCount: 0 }
  };
}

/**
 * Automation Chromium only (Playwright's own build), never the user's Chrome: pid and working set.
 * Windows CIM, [] elsewhere. Deliberately queried a handful of times per batch, never polled: a WMI
 * query is expensive enough that polling it measurably loaded the very runs being measured.
 */
function automationChromium(): Promise<Array<{ pid: number; rssBytes: number }>> {
  if (process.platform !== "win32") return Promise.resolve([]);
  const script =
    "Get-CimInstance Win32_Process -Filter \"ExecutablePath LIKE '%ms-playwright%'\" | ForEach-Object { '{0}|{1}' -f $_.ProcessId,[int64]$_.WorkingSetSize }";
  return new Promise((resolveProcs) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 15_000, windowsHide: true }, (error, stdout) =>
      resolveProcs(
        error
          ? []
          : String(stdout)
              .split(/\r?\n/)
              .map((line) => line.split("|").map((part) => Number.parseInt(part, 10)))
              .filter(([pid]) => Number.isFinite(pid))
              .map(([pid, rss]) => ({ pid, rssBytes: Number.isFinite(rss) ? rss : 0 }))
      )
    );
  });
}
const automationChromiumPids = async () => (await automationChromium()).map((proc) => proc.pid);

// ── One measured batch ───────────────────────────────────────────────────────────────────────────

type Mode = "on" | "off";
interface Batch {
  mode: Mode;
  durations: Record<"fast" | "evidence", number[]>;
  statuses: string[];
  nodeCpuMs: number;
  nodeRssPeakMb: number;
  eventLoopDelayP99Ms: number;
  /** Automation Chromium working set, sampled once while every instance of the batch was running. */
  chromiumRssAtPeakMb?: number;
  events: number;
  evidenceBytesPerEvidenceInstance: number[];
  diagnosticsOnFast: number;
  attachmentsAfter: { pages: number; generations: number };
  /** Automation Chromium processes still alive once the batch settled (Windows; -1 elsewhere). */
  automationChromiumAfter: number;
  wallMs: number;
}

let batchNumber = 0;
let automationBaseline: Set<number> = new Set();
async function runBatch(engine: ExecutionEngine, dirs: Awaited<ReturnType<typeof buildDirs>>["dirs"], mode: Mode, sampleChromium: boolean): Promise<Batch> {
  batchNumber += 1;
  if (mode === "off") process.env.AWKIT_FAILURE_EVIDENCE = "0";
  else delete process.env.AWKIT_FAILURE_EVIDENCE;

  const executions = (["fast", "evidence"] as const).map((key) => ({ key, executionId: `ovh-${batchNumber}-${mode}-${key}` }));
  const cpuBefore = process.cpuUsage();
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  let nodeRssPeak = process.memoryUsage().rss;
  let chromiumRssAtPeakMb: number | undefined;
  let rssSample: Promise<void> | undefined;

  const started = Date.now();
  for (const { key, executionId } of executions) {
    await engine.startRun(executionId, profileOf(executionId, key), Array.from({ length: INSTANCES }), dirs, {}, scenarioOf(key), [flowOf(key, WORKLOADS[key])]);
  }
  const ids = new Set(executions.map((execution) => execution.executionId));
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    nodeRssPeak = Math.max(nodeRssPeak, process.memoryUsage().rss);
    const mine = engine.getInstances().filter((instance) => ids.has(instance.executionId));
    if (sampleChromium && !rssSample && mine.filter((instance) => instance.status === "running").length === INSTANCES * 2) {
      rssSample = automationChromium().then((procs) => {
        const ours = procs.filter((proc) => !automationBaseline.has(proc.pid));
        chromiumRssAtPeakMb = Math.round(ours.reduce((sum, proc) => sum + proc.rssBytes, 0) / (1024 * 1024));
      });
    }
    if (mine.length === INSTANCES * 2 && mine.every((instance) => ["completed", "failed", "cancelled"].includes(instance.status))) break;
    await sleep(100);
  }
  const reports: Array<{ key: "fast" | "evidence"; report: ConcurrentRunReport | undefined }> = [];
  for (const { key, executionId } of executions) {
    const path = join(dirs.reports, executionId, "report.json");
    const until = Date.now() + 30_000;
    while (!existsSync(path) && Date.now() < until) await sleep(100);
    reports.push({ key, report: existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as ConcurrentRunReport) : undefined });
  }
  const wallMs = Date.now() - started;
  await rssSample;
  loop.disable();
  const cpu = process.cpuUsage(cpuBefore);
  delete process.env.AWKIT_FAILURE_EVIDENCE;

  const durations: Batch["durations"] = { fast: [], evidence: [] };
  const statuses: string[] = [];
  let events = 0;
  const evidenceBytes: number[] = [];
  let diagnosticsOnFast = 0;
  for (const { key, report } of reports) {
    for (const instance of report?.instances ?? []) {
      durations[key].push(instance.durationMs);
      statuses.push(instance.status);
      events += instance.diagnostics?.evidence.length ?? 0;
      if (key === "evidence") evidenceBytes.push(instance.diagnostics ? JSON.stringify(instance.diagnostics).length : 0);
      if (key === "fast" && instance.diagnostics) diagnosticsOnFast += 1;
    }
  }
  const attachmentsAfter = await (async () => {
    const until = Date.now() + 10_000;
    for (;;) {
      const live = liveEvidenceAttachments();
      if ((live.pages === 0 && live.generations === 0) || Date.now() >= until) return live;
      await sleep(100);
    }
  })();
  const automationChromiumAfter = await (async () => {
    if (process.platform !== "win32") return -1;
    const until = Date.now() + 15_000;
    for (;;) {
      const leftover = (await automationChromiumPids()).filter((pid) => !automationBaseline.has(pid)).length;
      if (leftover === 0 || Date.now() >= until) return leftover;
      await sleep(500);
    }
  })();
  return {
    mode,
    durations,
    statuses,
    nodeCpuMs: (cpu.user + cpu.system) / 1000,
    nodeRssPeakMb: Math.round(nodeRssPeak / (1024 * 1024)),
    eventLoopDelayP99Ms: Math.round(loop.percentile(99) / 1e5) / 10,
    chromiumRssAtPeakMb,
    events,
    evidenceBytesPerEvidenceInstance: evidenceBytes,
    diagnosticsOnFast,
    attachmentsAfter,
    automationChromiumAfter,
    wallMs
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────────────────────────

const round1 = (value: number | undefined) => (value === undefined ? undefined : Math.round(value * 10) / 10);
const describe = (s: Stats | undefined) => (s ? { n: s.n, median: round1(s.median), p95: round1(s.p95), mean: round1(s.mean) } : undefined);

let mockSite: ChildProcess | undefined;
const { dirs, root } = await buildDirs("awkit-l5a-overhead-");
try {
  console.log("Zero AI calls on the run path");
  {
    const engineFile = join(ROOT, "src", "runner", "ExecutionEngine.ts");
    const closure = [...importClosure(engineFile)].map((file) => relative(ROOT, file).replace(/\\/g, "/"));
    // The modules that actually speak to the model. Everything else under `src/ai` is pure: the locator
    // plan compiler, the pending-upgrade record and the output contract are data and policy that L3 has
    // the run path depend on deliberately. A directory- or `Ai*`-name proxy condemns those too, which is
    // a naming coincidence rather than a model call. Kept in step with `verify:ai-fallback`.
    const modelBearing = /^(?:app\/main\/ai\/|native-hosts\/ai\/|src\/ai\/contracts\/|src\/ai\/(?:AiService|AiPromptBuilder|FakeAiHostTransport)\.ts$)/;
    const ai = closure.filter((file) => modelBearing.test(file));
    check(
      "the closure walk is real: it reaches the runner, the collector and the evidence buffer",
      closure.length > 100 && ["src/runner/PlaywrightRunner.ts", "src/runner/evidence/FailureEvidenceCollector.ts", "src/runner/evidence/ExecutionEvidence.ts"].every((file) => closure.includes(file)),
      `${closure.length} modules`
    );
    check("no module that can call the model (the service, prompt builder, fake, host protocol or host) is reachable from ExecutionEngine", ai.length === 0, ai.slice(0, 5));
  }

  console.log("\nPreconditions");
  mockSite = spawn(process.execPath, [join(ROOT, "mock-site", "server.mjs")], { env: { ...process.env, MOCK_SITE_PORT: String(PORT) }, stdio: "ignore", windowsHide: true });
  const up = await (async () => {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const ok = await new Promise<boolean>((resolveOk) => {
        const request = httpGet(LAB, (response) => {
          response.resume();
          resolveOk((response.statusCode ?? 500) < 500);
        });
        request.on("error", () => resolveOk(false));
      });
      if (ok) return true;
      await sleep(200);
    }
    return false;
  })();
  if (!check("the real mock site serves /runner-lab", up, LAB)) throw new Error("mock site never came up");

  const engine = new ExecutionEngine();
  engine.configureConcurrency({ maxBrowsersPerHost: INSTANCES * 2, maxActiveFlows: INSTANCES * 2, useSharedBrowserPool: false, workloadWeights: false });
  const sampleChromium = process.platform === "win32" && process.env.AWKIT_L5A_OVERHEAD_CHROMIUM !== "0";
  automationBaseline = new Set(await automationChromiumPids());

  console.log(`\nWarm-up (untimed): ${INSTANCES} instances × 2 workloads`);
  await runBatch(engine, dirs, "on", false);

  const batches: Batch[] = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    for (const mode of round % 2 === 0 ? (["on", "off"] as const) : (["off", "on"] as const)) {
      const batch = await runBatch(engine, dirs, mode, sampleChromium);
      batches.push(batch);
      console.log(
        `  round ${round + 1} ${mode.padEnd(3)} wall ${batch.wallMs} ms · fast median ${round1(stats(batch.durations.fast)?.median)} ms · evidence median ${round1(stats(batch.durations.evidence)?.median)} ms · node CPU ${Math.round(batch.nodeCpuMs)} ms · events ${batch.events} · leftover automation Chromium ${batch.automationChromiumAfter}`
      );
    }
  }

  const on = batches.filter((batch) => batch.mode === "on");
  const off = batches.filter((batch) => batch.mode === "off");
  const all = (list: Batch[], key: "fast" | "evidence") => list.flatMap((batch) => batch.durations[key]);
  const perInstance = (list: Batch[], pick: (batch: Batch) => number | undefined) =>
    list.reduce((sum, batch) => sum + (pick(batch) ?? 0), 0) / Math.max(1, list.reduce((sum, batch) => sum + batch.statuses.length, 0));
  /** ON minus OFF within each round (adjacent batches), so slow host drift cancels instead of adding noise. */
  const rounds = Array.from({ length: ROUNDS }, (_, index) => {
    const pair = batches.slice(index * 2, index * 2 + 2);
    return { on: pair.find((batch) => batch.mode === "on")!, off: pair.find((batch) => batch.mode === "off")! };
  });
  const pairedDelta = (pick: (batch: Batch) => number | undefined) =>
    stats(rounds.map(({ on: batchOn, off: batchOff }) => (pick(batchOn) ?? Number.NaN) - (pick(batchOff) ?? Number.NaN)));

  console.log("\nCorrectness of the measured runs");
  check("every measured instance passed in both modes", batches.every((batch) => batch.statuses.length === INSTANCES * 2 && batch.statuses.every((status) => status === "passed")), batches.map((batch) => batch.statuses.join(",")));
  check("capture ON did real work: the evidence workload produced events in every ON batch", on.every((batch) => batch.events >= INSTANCES * 3), on.map((batch) => batch.events));
  check("capture OFF wrote no diagnostics at all", off.every((batch) => batch.events === 0 && batch.evidenceBytesPerEvidenceInstance.every((bytes) => bytes === 0)));
  check("a clean fast run never grows its report, even with capture ON", on.every((batch) => batch.diagnosticsOnFast === 0), on.map((batch) => batch.diagnosticsOnFast));
  check("every page listener and binding was released after every batch", batches.every((batch) => batch.attachmentsAfter.pages === 0 && batch.attachmentsAfter.generations === 0), batches.map((batch) => batch.attachmentsAfter));
  if (process.platform === "win32") {
    check("no automation Chromium process outlives its batch", batches.every((batch) => batch.automationChromiumAfter === 0), batches.map((batch) => batch.automationChromiumAfter));
  } else {
    console.log("  ~ no automation Chromium process outlives its batch — NOT RUN: process attribution is Windows-only");
  }

  console.log("\nOverhead (capture ON versus OFF)");
  const ceilings = FAILURE_CAPTURE_OVERHEAD_CEILINGS;
  const measured: Record<string, unknown> = { rounds: ROUNDS, instancesPerWorkloadPerBatch: INSTANCES, concurrentInstances: INSTANCES * 2, stackTraces: SOURCE_MAPPED_STACKS ? "source-mapped (tsx default)" : "plain (as packaged)", host: { platform: process.platform, cpus: (await import("node:os")).cpus().length } };
  for (const key of ["fast", "evidence"] as const) {
    const sOn = stats(all(on, key));
    const sOff = stats(all(off, key));
    measured[key] = { on: describe(sOn), off: describe(sOff) };
    if (!sOn || !sOff) {
      check(`${key}: both modes produced durations`, false);
      continue;
    }
    const medianLimit = Math.max(sOff.median * ceilings.medianDurationFraction, ceilings.medianDurationFloorMs);
    const p95Limit = Math.max(sOff.p95 * ceilings.p95DurationFraction, ceilings.p95DurationFloorMs);
    const paired = pairedDelta((batch) => stats(batch.durations[key])?.median);
    measured[`${key}PairedMedianDeltaMs`] = describe(paired);
    check(
      `${key}: median duration overhead (median of ${ROUNDS} paired rounds) ${round1(paired?.median)} ms ≤ ${round1(medianLimit)} ms`,
      paired !== undefined && paired.n === ROUNDS && paired.median <= medianLimit,
      { pooledOn: round1(sOn.median), pooledOff: round1(sOff.median) }
    );
    check(`${key}: p95 duration overhead ${round1(sOn.p95 - sOff.p95)} ms ≤ ${round1(p95Limit)} ms`, sOn.p95 - sOff.p95 <= p95Limit, { on: round1(sOn.p95), off: round1(sOff.p95) });
  }
  const cpuOn = perInstance(on, (batch) => batch.nodeCpuMs);
  const cpuOff = perInstance(off, (batch) => batch.nodeCpuMs);
  const cpuLimit = Math.max(cpuOff * ceilings.nodeCpuPerInstanceFraction, ceilings.nodeCpuPerInstanceFloorMs);
  const cpuPaired = pairedDelta((batch) => batch.nodeCpuMs / Math.max(1, batch.statuses.length));
  measured.nodeCpuMsPerInstance = { on: round1(cpuOn), off: round1(cpuOff), pairedDelta: describe(cpuPaired) };
  check(
    `Node CPU per instance overhead (median of ${ROUNDS} paired rounds) ${round1(cpuPaired?.median)} ms ≤ ${round1(cpuLimit)} ms`,
    cpuPaired !== undefined && cpuPaired.n === ROUNDS && cpuPaired.median <= cpuLimit,
    { on: round1(cpuOn), off: round1(cpuOff) }
  );
  const evidenceBytes = on.flatMap((batch) => batch.evidenceBytesPerEvidenceInstance);
  measured.evidenceBytesPerEvidenceInstance = describe(stats(evidenceBytes));
  check(`evidence per passing instance stays ≤ ${ceilings.maxEvidenceBytesPerInstance} bytes`, evidenceBytes.length > 0 && Math.max(...evidenceBytes) <= ceilings.maxEvidenceBytesPerInstance, describe(stats(evidenceBytes)));
  measured.nodeRssPeakMb = { on: Math.max(...on.map((batch) => batch.nodeRssPeakMb)), off: Math.max(...off.map((batch) => batch.nodeRssPeakMb)) };
  measured.eventLoopDelayP99Ms = { on: describe(stats(on.map((batch) => batch.eventLoopDelayP99Ms))), off: describe(stats(off.map((batch) => batch.eventLoopDelayP99Ms))) };
  if (sampleChromium) {
    measured.automationChromiumRssAtPeakMb = { on: describe(stats(on.map((batch) => batch.chromiumRssAtPeakMb ?? Number.NaN))), off: describe(stats(off.map((batch) => batch.chromiumRssAtPeakMb ?? Number.NaN))) };
  }
  measured.chromiumCpu = "not measured: attributing it needs WMI polling, which loaded the runs it measured (duration and Node CPU carry the cost instead)";
  measured.collectorLifecycleMs = { startGeneration: describe(stats(lifecycleMs.startGeneration)), stopGeneration: describe(stats(lifecycleMs.stopGeneration)) };
  console.log(`\nMeasured (development host; informational where no ceiling applies):\n${JSON.stringify(measured, null, 2)}`);

  await engine.drainIdleSharedBrowsers().catch(() => undefined);
} catch (error) {
  check("the harness completed without throwing", false, error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  mockSite?.kill();
  await cleanupRoot(root);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 && passed > 0 ? 0 : 1);
