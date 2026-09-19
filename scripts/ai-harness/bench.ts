/**
 * L1.8 performance measurements, run inside the AI harness (scripts/ai-harness/harnessMain.ts) in
 * a real Electron main process with the real host and model. The launcher
 * (scripts/benchmark-ai-model.mts) pins the whole process tree to a CPU affinity mask, so the
 * utility host and the Chromium it starts inherit the constrained CPU set.
 *
 * AWKIT_HARNESS_SCENARIOS picks the scenarios, so one launch fits the tool's time limit:
 *   load       cold start: fork, handshake, model load, resident memory
 *   packets:<name>  one L1.8 feature packet (locatorUpgrade, validationExplanation, failureAnalysis),
 *              measured on the host: prompt/generation rates, TTFT, memory, main-loop delay
 *   cancel     cancellation latency during prompt processing and during generation
 *   playwright a Chromium workload alone, beside a running inference, and with inference yielding
 *   batch      a coalesced burst through AiService: queue cap, drain time, hold while runs are active
 *
 * Everything recorded is a count, a code or a timing. Prompts are synthetic and model text is never
 * recorded.
 */

import { app } from "electron";
import { createRequire } from "node:module";
import path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";

import { buildAiPrompt, type AiPromptSpec } from "@src/ai/AiPromptBuilder";
import type { AiOutputSchema } from "@src/ai/AiOutputContract";
import type { AiUtilityHostManager } from "@main/ai/AiUtilityHostManager";
import type { AiJobOutcome, AiJobRequest } from "@src/ai/AiService";
import { AI_HOST_PROTOCOL_VERSION, type AiInferResult } from "@src/ai/contracts/AiHostProtocol";
import { SemanticRedactor } from "@src/semantic/SemanticRedactor";

import type { LiveContext } from "./harnessMain";

export interface BenchApi {
  step: <T>(label: string, fn: () => Promise<T> | T) => Promise<T | undefined>;
  record: (key: string, value: unknown) => void;
  makeLiveContext: (options?: { yieldDuringRuns?: boolean }) => LiveContext;
  makeManager: () => AiUtilityHostManager;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const HELLO = { type: "hello", expected: { protocolVersion: AI_HOST_PROTOCOL_VERSION } } as const;
const NONCE = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";

// ── Synthetic, redaction-clean packet text ───────────────────────────────────────────────────────

const WORDS =
  "account billing customer order shipment invoice address delivery status review approve reject submit cancel save " +
  "profile settings dashboard report export import filter search table column header footer dialog panel toolbar " +
  "button link field label required optional warning error message notice summary detail history pending complete";

function prose(chars: number, seed: number): string {
  const words = WORDS.split(" ");
  const out: string[] = [];
  let length = 0;
  let i = seed;
  while (length < chars) {
    const sentence = Array.from({ length: 9 }, () => words[(i = (i * 31 + 7) % words.length)]).join(" ");
    const line = `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
    out.push(line);
    length += line.length + 1;
  }
  return out.join(" ").slice(0, chars);
}

const ids = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}-${i + 1}`);

interface Packet {
  name: "locatorUpgrade" | "validationExplanation" | "failureAnalysis";
  spec: AiPromptSpec;
  schema: AiOutputSchema;
  maxOutputTokens: number;
}

function packets(): Packet[] {
  const candidates = ids("cand", 8);
  const issues = ids("issue", 6);
  const steps = ids("step", 12);
  return [
    {
      name: "locatorUpgrade",
      spec: {
        instructions:
          "You propose a durable semantic locator for one recorded element. Choose the candidate that best identifies the " +
          "same element by role, accessible name and a stable container. Never choose by position when a named candidate " +
          "exists. Give a confidence from 0 to 100 and a one-sentence rationale.",
        fields: [
          { name: "candidates", ids: candidates },
          { name: "element", text: prose(900, 3) },
          { name: "ancestors", text: prose(1_400, 5) },
          { name: "page", text: prose(5_400, 11) }
        ],
        maxDataChars: 9_000
      },
      schema: {
        type: "object",
        properties: {
          choice: { type: "string", enum: candidates },
          scope: { type: "string", enum: ["none", "form", "dialog", "row", "region"] },
          confidence: { type: "integer", minimum: 0, maximum: 100 },
          rationale: { type: "string", maxLength: 240 }
        },
        required: ["choice", "scope", "confidence", "rationale"],
        additionalProperties: false
      },
      maxOutputTokens: 192
    },
    {
      name: "validationExplanation",
      spec: {
        instructions:
          "Explain each validation issue in plain words for the flow author: what is wrong and what to check. Refer to " +
          "issues only by the ids offered.",
        fields: [
          { name: "issues", ids: issues },
          { name: "messages", text: prose(1_800, 17) },
          { name: "flow", text: prose(3_600, 23) }
        ],
        maxDataChars: 9_000
      },
      schema: {
        type: "object",
        properties: {
          explanations: {
            type: "array",
            maxItems: 3,
            items: {
              type: "object",
              properties: { issue: { type: "string", enum: issues }, text: { type: "string", maxLength: 220 } },
              required: ["issue", "text"],
              additionalProperties: false
            }
          }
        },
        required: ["explanations"],
        additionalProperties: false
      },
      maxOutputTokens: 192
    },
    {
      name: "failureAnalysis",
      spec: {
        instructions:
          "Analyze the failed run. Pick the most likely primary cause from the offered categories, the related steps by id, " +
          "a confidence from 0 to 100 and a short summary for the operator.",
        fields: [
          { name: "steps", ids: steps },
          { name: "baseline", ids: ["uiValidation", "httpError", "scriptError", "locatorNotFound", "timeout", "unknown"] },
          { name: "evidence", text: prose(4_200, 29) },
          { name: "run", text: prose(4_000, 31) }
        ],
        maxDataChars: 9_000
      },
      schema: {
        type: "object",
        properties: {
          primaryCause: { type: "string", enum: ["uiValidation", "httpError", "scriptError", "locatorNotFound", "timeout", "unknown"] },
          confidence: { type: "integer", minimum: 0, maximum: 100 },
          relatedSteps: { type: "array", maxItems: 4, items: { type: "string", enum: steps } },
          summary: { type: "string", maxLength: 400 }
        },
        required: ["primaryCause", "confidence", "relatedSteps", "summary"],
        additionalProperties: false
      },
      maxOutputTokens: 256
    }
  ];
}

function built(spec: AiPromptSpec): { system: string; user: string } {
  const prompt = buildAiPrompt(spec, new SemanticRedactor(), NONCE);
  if (!prompt.ok) throw new Error(`synthetic packet refused by the prompt builder: ${prompt.code}`);
  return { system: prompt.system, user: prompt.user };
}

// ── Sampling ─────────────────────────────────────────────────────────────────────────────────────

interface Sampler {
  stop(): { hostPeakWorkingSetMb: number; hostMaxWorkingSetMb: number; hostCpuAvgPct: number; hostCpuMaxPct: number; mainLoopDelayP99Ms: number; mainLoopDelayMaxMs: number };
}

function sample(hostPid: () => number | null): Sampler {
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  let peak = 0;
  let maxWs = 0;
  const cpu: number[] = [];
  const read = () => {
    const metric = app.getAppMetrics().find((m) => m.pid === hostPid());
    if (!metric) return;
    peak = Math.max(peak, metric.memory.peakWorkingSetSize);
    maxWs = Math.max(maxWs, metric.memory.workingSetSize);
    cpu.push(metric.cpu.percentCPUUsage);
  };
  read();
  const timer = setInterval(read, 500);
  return {
    stop() {
      clearInterval(timer);
      read();
      loop.disable();
      const busy = cpu.slice(1);
      return {
        hostPeakWorkingSetMb: Math.round(peak / 1024),
        hostMaxWorkingSetMb: Math.round(maxWs / 1024),
        hostCpuAvgPct: busy.length ? Math.round(busy.reduce((a, b) => a + b, 0) / busy.length) : 0,
        hostCpuMaxPct: busy.length ? Math.round(Math.max(...busy)) : 0,
        mainLoopDelayP99Ms: Math.round(loop.percentile(99) / 1e6),
        mainLoopDelayMaxMs: Math.round(loop.max / 1e6)
      };
    }
  };
}

function rates(result: AiInferResult, wallMs: number) {
  const { promptMs, generationMs, firstTokenMs } = result.timings;
  return {
    promptTokens: result.promptTokens,
    outputTokens: result.outputTokens,
    stopReason: result.stopReason,
    promptMs,
    firstTokenMs,
    generationMs,
    wallMs,
    promptTokensPerSec: promptMs > 0 ? +(result.promptTokens / (promptMs / 1000)).toFixed(1) : null,
    generationTokensPerSec: generationMs > 0 && result.outputTokens > 1 ? +((result.outputTokens - 1) / (generationMs / 1000)).toFixed(2) : null
  };
}

async function loadedManager(api: BenchApi, threads: number): Promise<{ manager: AiUtilityHostManager; loadMs: number; wallMs: number }> {
  const manager = api.makeManager();
  await manager.call(HELLO, 15_000);
  const started = Date.now();
  const load = await manager.call<{ loadMs: number }>(
    { type: "load", modelPath: process.env.AWKIT_HARNESS_MODEL_PATH ?? "", contextTokens: 4096, threads },
    300_000
  );
  return { manager, loadMs: load.loadMs, wallMs: Date.now() - started };
}

function infer(manager: AiUtilityHostManager, jobId: string, packet: { system: string; user: string }, schema: AiOutputSchema, maxOutputTokens: number) {
  return manager.call<AiInferResult>(
    {
      type: "infer",
      jobId,
      system: packet.system,
      user: packet.user,
      jsonSchema: schema as unknown as Record<string, unknown>,
      maxPromptTokens: 3072,
      maxOutputTokens,
      thinking: false,
      temperature: 0,
      seed: 0
    },
    600_000
  );
}

// ── Scenarios ────────────────────────────────────────────────────────────────────────────────────

async function scenarioLoad(api: BenchApi, threads: number): Promise<void> {
  await api.step("load: cold fork, handshake and model load", async () => {
    const forkStarted = Date.now();
    const manager = api.makeManager();
    await manager.call(HELLO, 15_000);
    const helloMs = Date.now() - forkStarted;
    const sampler = sample(() => manager.status().pid);
    const started = Date.now();
    const load = await manager.call<{ loadMs: number }>(
      { type: "load", modelPath: process.env.AWKIT_HARNESS_MODEL_PATH ?? "", contextTokens: 4096, threads },
      300_000
    );
    const wallMs = Date.now() - started;
    await sleep(1_000);
    const memory = sampler.stop();
    await manager.dispose();
    const result = { forkAndHelloMs: helloMs, hostLoadMs: load.loadMs, loadWallMs: wallMs, ...memory };
    api.record("load", result);
    return result;
  });
}

async function scenarioPackets(api: BenchApi, threads: number, iterations: number, only: string): Promise<void> {
  const selected = packets().filter((packet) => packet.name === only);
  if (selected.length !== 1) throw new Error(`unknown packet ${only}`);
  const { manager, loadMs } = await loadedManager(api, threads);
  const results: Record<string, unknown[]> = {};
  for (const packet of selected) {
    const prompt = built(packet.spec);
    results[packet.name] = [];
    for (let i = 1; i <= iterations; i += 1) {
      await api.step(`packets: ${packet.name} #${i}`, async () => {
        const sampler = sample(() => manager.status().pid);
        const started = Date.now();
        const result = await infer(manager, `${packet.name}-${i}#1`, prompt, packet.schema, packet.maxOutputTokens);
        const wallMs = Date.now() - started;
        const measured = { ...rates(result, wallMs), ...sampler.stop(), maxOutputTokens: packet.maxOutputTokens };
        JSON.parse(result.text);
        results[packet.name].push(measured);
        return measured;
      });
    }
  }
  api.record(`packets:${only}`, { threads, loadMs, iterations: results[only] });
  await manager.dispose();
}

async function scenarioCancel(api: BenchApi, threads: number): Promise<void> {
  const { manager } = await loadedManager(api, threads);
  const [failure] = packets().filter((p) => p.name === "failureAnalysis");
  const longPrompt = built(failure.spec);
  const shortPrompt = built({ instructions: failure.spec.instructions, fields: [{ name: "run", text: prose(300, 41) }], maxDataChars: 9_000 });
  const result: Record<string, unknown> = {};
  const measure = async (label: string, jobId: string, packet: { system: string; user: string }, afterMs: number) =>
    api.step(label, async () => {
      const pending = infer(manager, jobId, packet, failure.schema, 256);
      await sleep(afterMs);
      const cancelledAt = Date.now();
      await manager.call({ type: "cancel", jobId }, 5_000);
      const answer = await pending;
      const latencyMs = Date.now() - cancelledAt;
      if (answer.stopReason !== "cancelled") throw new Error(`finished before the cancel (${answer.stopReason})`);
      return { latencyMs, outputTokensBeforeCancel: answer.outputTokens };
    });
  result.duringPrompt = await measure("cancel: during prompt processing", "cancel-prompt#1", longPrompt, 1_000);
  result.duringGeneration = await measure("cancel: during generation", "cancel-generation#1", shortPrompt, 6_000);
  api.record("cancel", result);
  await manager.dispose();
}

function heavyHtml(round: number): string {
  const cells = Array.from({ length: 400 }, (_, i) => `<div class="cell" style="width:${20 + ((i * 7 + round) % 60)}px">cell ${i}</div>`).join("");
  const buttons = Array.from({ length: 50 }, (_, i) => `<button onclick="this.textContent='done ${i}'">Action ${i}</button>`).join("");
  return `<!doctype html><html><body><input id="q" aria-label="Query"><div>${buttons}</div><div style="display:flex;flex-wrap:wrap">${cells}</div></body></html>`;
}

async function scenarioPlaywright(api: BenchApi, threads: number): Promise<void> {
  const root = process.env.AWKIT_HARNESS_REPO_ROOT ?? "";
  const { chromium } = createRequire(path.join(root, "package.json"))("playwright") as typeof import("playwright");
  const browser = await chromium.launch();
  const rounds = Number(process.env.AWKIT_HARNESS_PW_ROUNDS ?? "40");
  const workload = async (): Promise<number> => {
    const page = await browser.newPage();
    const started = Date.now();
    for (let round = 0; round < rounds; round += 1) {
      await page.setContent(heavyHtml(round));
      await page.getByRole("button", { name: `Action ${round % 50}`, exact: true }).click();
      await page.getByLabel("Query").fill(`query ${round}`);
      await page.evaluate(() => Array.from(document.querySelectorAll("div.cell")).reduce((sum, el) => sum + (el as HTMLElement).offsetHeight, 0));
    }
    const ms = Date.now() - started;
    await page.close();
    return ms;
  };
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const result: Record<string, unknown> = { rounds };
  try {
    await workload(); // warm-up
    const alone = await api.step("playwright: workload alone (3 runs)", async () => {
      const runs = [await workload(), await workload(), await workload()];
      return { runs, medianMs: median(runs) };
    });
    result.alone = alone;

    const { manager } = await loadedManager(api, threads);
    const [failure] = packets().filter((p) => p.name === "failureAnalysis");
    const prompt = built(failure.spec);
    const beside = await api.step("playwright: workload beside a running inference (yield off)", async () => {
      const runs: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        const pending = infer(manager, `contend-${i}#1`, prompt, failure.schema, 256);
        await sleep(300);
        runs.push(await workload());
        await manager.call({ type: "cancel", jobId: `contend-${i}#1` }, 5_000);
        await pending.catch(() => undefined);
      }
      return { runs, medianMs: median(runs) };
    });
    result.besideInference = beside;
    await manager.dispose();

    const ctx = api.makeLiveContext({ yieldDuringRuns: true });
    const yielded = await api.step("playwright: workload while inference yields to the run", async () => {
      ctx.admission.view = { ...ctx.admission.view, activeRuns: 1 };
      const job: AiJobRequest = {
        requestId: "yield-bench",
        feature: "failureAnalysis",
        priority: "background",
        prompt: failure.spec,
        schema: failure.schema,
        maxOutputTokens: 256,
        timeoutMs: 120_000
      };
      const pending = ctx.service.submit(job);
      const runs = [await workload(), await workload(), await workload()];
      const held = (await ctx.service.status()).holdReason;
      const completedWhileRunning = (await ctx.service.status()).counters.completed;
      ctx.admission.view = { ...ctx.admission.view, activeRuns: 0 };
      ctx.service.notifyAdmissionChanged();
      const releasedAt = Date.now();
      const outcome = await pending;
      return { runs, medianMs: median(runs), holdReason: held, completedWhileRunning, jobAfterRelease: outcome.status, jobMsAfterRelease: Date.now() - releasedAt };
    });
    result.withYield = yielded;
    await ctx.service.shutdown();
  } finally {
    await browser.close();
  }
  const base = (result.alone as { medianMs?: number } | undefined)?.medianMs;
  const beside = (result.besideInference as { medianMs?: number } | undefined)?.medianMs;
  const withYield = (result.withYield as { medianMs?: number } | undefined)?.medianMs;
  if (base) {
    result.slowdownBesideInference = beside ? +(beside / base).toFixed(2) : null;
    result.slowdownWithYield = withYield ? +(withYield / base).toFixed(2) : null;
  }
  api.record("playwright", result);
}

async function scenarioBatch(api: BenchApi): Promise<void> {
  const ctx = api.makeLiveContext({ yieldDuringRuns: true });
  const small = (id: string): AiJobRequest => ({
    requestId: id,
    feature: "failureAnalysis",
    priority: "background",
    prompt: { instructions: "Name the primary cause of this failed run in one short phrase.", fields: [{ name: "run", text: prose(900, id.length) }], maxDataChars: 9_000 },
    schema: { type: "object", properties: { cause: { type: "string", maxLength: 80 } }, required: ["cause"], additionalProperties: false },
    maxOutputTokens: 48,
    timeoutMs: 120_000
  });
  const result: Record<string, unknown> = {};
  await api.step("batch: 20 concurrent failures against the 16-job queue", async () => {
    const started = Date.now();
    const settled: { outcome: AiJobOutcome; ms: number }[] = [];
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        ctx.service.submit(small(`burst-${i}`)).then((outcome) => settled.push({ outcome, ms: Date.now() - started }))
      )
    );
    const ok = settled.filter((s) => s.outcome.status === "ok").map((s) => s.ms).sort((a, b) => a - b);
    const queueFull = settled.filter((s) => s.outcome.status === "rejected" && s.outcome.code === "QUEUE_FULL").length;
    if (queueFull < 1) throw new Error("the queue cap never engaged");
    const summary = {
      accepted: 20 - queueFull,
      queueFull,
      completed: ok.length,
      drainMs: Date.now() - started,
      firstCompletionMs: ok[0] ?? null,
      p50CompletionMs: ok[Math.floor(ok.length / 2)] ?? null,
      lastCompletionMs: ok[ok.length - 1] ?? null
    };
    result.burst = summary;
    return summary;
  });
  await api.step("batch: queued work holds while runs are active, then drains", async () => {
    ctx.admission.view = { ...ctx.admission.view, activeRuns: 1 };
    const before = (await ctx.service.status()).counters.completed;
    const pending = [ctx.service.submit(small("held-1")), ctx.service.submit(small("held-2"))];
    await sleep(5_000);
    const status = await ctx.service.status();
    if (status.counters.completed !== before || status.holdReason !== "RUNS_ACTIVE") throw new Error(JSON.stringify(status));
    ctx.admission.view = { ...ctx.admission.view, activeRuns: 0 };
    const releasedAt = Date.now();
    ctx.service.notifyAdmissionChanged();
    const outcomes = await Promise.all(pending);
    const summary = { heldForMs: 5_000, completedAfterRelease: outcomes.filter((o) => o.status === "ok").length, drainAfterReleaseMs: Date.now() - releasedAt };
    result.hold = summary;
    return summary;
  });
  api.record("batch", result);
  await ctx.service.shutdown();
}

export async function runBench(api: BenchApi): Promise<void> {
  const threads = Number(process.env.AWKIT_HARNESS_THREADS);
  const iterations = Number(process.env.AWKIT_HARNESS_ITERATIONS ?? "2");
  const scenarios = (process.env.AWKIT_HARNESS_SCENARIOS ?? "load").split(",").filter(Boolean);
  api.record("benchThreads", threads);
  for (const scenario of scenarios) {
    if (scenario === "load") await scenarioLoad(api, threads);
    else if (scenario.startsWith("packets:")) await scenarioPackets(api, threads, iterations, scenario.slice("packets:".length));
    else if (scenario === "cancel") await scenarioCancel(api, threads);
    else if (scenario === "playwright") await scenarioPlaywright(api, threads);
    else if (scenario === "batch") await scenarioBatch(api);
    else await api.step(`unknown scenario ${scenario}`, () => Promise.reject(new Error("unknown scenario")));
  }
}
