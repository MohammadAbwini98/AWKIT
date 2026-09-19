/**
 * verify:ai-adapter — Phase L L1.1/L1.3/L1.6/L1.7: AiService over the deterministic fake host.
 *
 * Covers the plan's list for the adapter: protocol handshake and model load, one inference at a
 * time, priority and FIFO order, the queue bound, cancellation (queued and running), timeout,
 * crash/restart and the circuit, malformed output and schema rejection (including an unoffered id
 * inside valid JSON), yield to active runs and its bound, idle unload, shutdown, and service states.
 *
 * Each behavior is asserted on the MECHANISM (the host requests the fake recorded, the concurrency it
 * observed) and not only on the outcome, since an outcome-only check can pass for the wrong reason.
 *
 * What makes it fail: two inferences overlapping on the host; a job that runs while runs are active;
 * a timed-out generation left running; thinking enabled or a schema-less inference; an output the
 * schema does not allow reaching a caller; a crash that is not followed by a fresh handshake and load.
 *
 * Run: npm run verify:ai-adapter
 */

import { join, resolve } from "node:path";

import { deriveInferenceThreads, type AiAdmissionView } from "@src/ai/AiAdmission";
import type { AiOutputSchema } from "@src/ai/AiOutputContract";
import {
  AiService,
  type AiJobOutcome,
  type AiJobRequest,
  type AiModelResolution,
  type AiServiceSettings
} from "@src/ai/AiService";
import { FakeAiHostTransport, type FakeAiHostOptions } from "@src/ai/FakeAiHostTransport";

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

// Unref'd service timers must not let the process exit with work pending.
const keepAlive = setInterval(() => undefined, 1_000);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until(predicate: () => boolean, timeoutMs = 2_000): Promise<boolean> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) return false;
    await sleep(2);
  }
  return true;
}

const ROOT = resolve("ai-fake-models");
const IDLE: AiAdmissionView = {
  activeRuns: 0,
  queuedRuns: 0,
  pressureState: "healthy",
  dispatchBlocked: false,
  activeWeight: 0,
  weightedBudget: 4,
  freeMemoryMb: 8_000
};
const SCHEMA: AiOutputSchema = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["keep", "promote"] },
    candidateId: { type: "string", enum: ["c1", "c2"] }
  },
  required: ["verdict"],
  additionalProperties: false
};
const GOOD = JSON.stringify({ verdict: "promote", candidateId: "c1" });

interface HarnessOptions {
  fake?: FakeAiHostOptions;
  settings?: Partial<AiServiceSettings>;
  model?: AiModelResolution;
  expectedRuntimeBuild?: string;
  maxQueue?: number;
  maxYields?: number;
}

function harness(options: HarnessOptions = {}) {
  const fake = new FakeAiHostTransport({ modelRoot: ROOT, respond: () => GOOD, ...options.fake });
  let view: AiAdmissionView = { ...IDLE };
  const settings: AiServiceSettings = { enabled: true, yieldDuringRuns: true, idleUnloadMs: 0, minFreeMemoryMb: 512, ...options.settings };
  const service = new AiService({
    transport: () => fake,
    model: async () => options.model ?? { ok: true, modelId: "qwen-test", modelPath: join(ROOT, "model.gguf"), contextTokens: 8192 },
    settings: async () => settings,
    admission: () => view,
    threads: 3,
    expectedRuntimeBuild: options.expectedRuntimeBuild,
    limits: { yieldCheckMs: 5, admissionRetryMs: 10, maxQueue: options.maxQueue ?? 16, maxYields: options.maxYields ?? 3 },
    nonce: () => "0123456789abcdef"
  });
  return {
    fake,
    service,
    settings,
    setView: (patch: Partial<AiAdmissionView>) => {
      view = { ...view, ...patch };
    }
  };
}

function job(requestId: string, overrides: Partial<AiJobRequest> = {}): AiJobRequest {
  return {
    requestId,
    feature: "locatorSemanticUpgrade",
    priority: "background",
    prompt: { instructions: "Choose the candidate that names the same element.", fields: [{ name: "step", text: "Click the Save button" }], maxDataChars: 2_000 },
    schema: SCHEMA,
    maxOutputTokens: 192,
    timeoutMs: 2_000,
    ...overrides
  };
}

const code = (outcome: AiJobOutcome): string => ("code" in outcome ? `${outcome.status}/${outcome.code}` : outcome.status);

console.log("Handshake, load and a constrained inference:\n");
{
  const { fake, service } = harness();
  const outcome = await service.submit(job("r1"));
  check("a valid job completes", outcome.status === "ok", code(outcome));
  check("the value is the validated JSON", outcome.status === "ok" && JSON.stringify(outcome.value) === GOOD);
  check("the outcome names the model", outcome.status === "ok" && outcome.modelId === "qwen-test");
  check("the host saw hello, load, infer in order", fake.requestTypes().join(",") === "hello,load,infer", fake.requestTypes().join(","));
  const load = fake.requests.find((r) => r.type === "load") as { threads: number; contextTokens: number } | undefined;
  check("threads come from the service configuration", load?.threads === 3);
  check("context is capped at the 4K ceiling", load?.contextTokens === 4096, String(load?.contextTokens));
  const infer = fake.inferRequests()[0];
  check("thinking is off", infer?.thinking === false);
  check("the JSON schema is sent for constrained decoding", JSON.stringify(infer?.jsonSchema) === JSON.stringify(SCHEMA));
  check("output tokens are the request's bounded budget", infer?.maxOutputTokens === 192);
  check("decoding is deterministic", infer?.temperature === 0 && infer?.seed === 0);
  const again = await service.submit(job("r2"));
  check("a second job reuses the loaded model (no second hello or load)", again.status === "ok" && fake.requestTypes().join(",") === "hello,load,infer,infer", fake.requestTypes().join(","));
  check("the service is available afterwards", (await service.status()).state.kind === "available");
  await service.shutdown();
}

console.log("\nOne inference at a time, priority then FIFO, bounded queue:\n");
{
  const { fake, service, setView } = harness({ fake: { respond: () => ({ text: GOOD, delayMs: 15 }) } });
  const outcomes = await Promise.all(Array.from({ length: 6 }, (_, i) => service.submit(job(`p${i}`))));
  check("six concurrent submissions all complete", outcomes.every((o) => o.status === "ok"), outcomes.map(code).join(","));
  check("the host never ran two inferences at once", fake.maxConcurrentInferences === 1, String(fake.maxConcurrentInferences));
  check("six inferences ran", fake.inferRequests().length === 6);

  setView({ activeRuns: 1 });
  const b1 = service.submit(job("b1"));
  const b2 = service.submit(job("b2"));
  const i1 = service.submit(job("i1", { priority: "interactive" }));
  await sleep(30);
  check("nothing runs while a run is active", fake.inferRequests().length === 6);
  check("the hold reason is reported", (await service.status()).holdReason === "RUNS_ACTIVE");
  setView({ activeRuns: 0 });
  service.notifyAdmissionChanged();
  await Promise.all([b1, b2, i1]);
  const order = fake.inferRequests().slice(6).map((r) => r.jobId.split("#")[0]);
  check("interactive first, then background in FIFO order", order.join(",") === "i1,b1,b2", order.join(","));
  await service.shutdown();
}
{
  const { service, setView } = harness({ maxQueue: 2 });
  setView({ activeRuns: 1 });
  const held = [service.submit(job("q1")), service.submit(job("q2"))];
  await sleep(5);
  const overflow = await service.submit(job("q3"));
  check("the queue bound refuses the next job immediately", code(overflow) === "rejected/QUEUE_FULL", code(overflow));
  const duplicate = await service.submit(job("q1"));
  check("a duplicate request id is refused", code(duplicate) === "rejected/DUPLICATE_REQUEST", code(duplicate));
  await service.shutdown();
  check("queued jobs are rejected at shutdown", (await Promise.all(held)).every((o) => code(o) === "rejected/SHUTDOWN"));
}

console.log("\nInvalid requests never reach the host:\n");
{
  const { fake, service } = harness();
  const invalid: Array<[string, AiJobRequest]> = [
    ["an unbounded array schema", job("x1", { schema: { type: "array", items: { type: "boolean" } } as unknown as AiOutputSchema })],
    ["an open object schema", job("x2", { schema: { type: "object", properties: {} } as unknown as AiOutputSchema })],
    ["a free string without maxLength", job("x3", { schema: { type: "string" } as unknown as AiOutputSchema })],
    ["too many output tokens", job("x4", { maxOutputTokens: 513 })],
    ["a zero timeout", job("x5", { timeoutMs: 0 })],
    ["a request id with a space", job("x 6")],
    ["an unknown feature", job("x7", { feature: "rogue" as never })]
  ];
  for (const [label, request] of invalid) check(`rejects ${label}`, code(await service.submit(request)) === "rejected/INVALID_REQUEST");
  check("no host call was made for any of them", fake.requests.length === 0, fake.requestTypes().join(","));
  await service.shutdown();
}

console.log("\nCancellation and timeout:\n");
{
  const { fake, service, setView } = harness({ fake: { respond: () => ({ hang: true }) } });
  setView({ activeRuns: 1 });
  const queued = service.submit(job("c-queued"));
  await sleep(5);
  check("cancel finds a queued job", service.cancel("c-queued"));
  check("a cancelled queued job resolves cancelled", (await queued).status === "cancelled");
  check("it never reached the host", fake.inferRequests().length === 0);
  check("cancelling an unknown id reports false", !service.cancel("nope"));

  setView({ activeRuns: 0 });
  const running = service.submit(job("c-running"));
  check("the hanging job starts", await until(() => fake.inferRequests().length === 1));
  check("busy while inferring", (await service.status()).state.kind === "busy");
  check("cancel finds the running job", service.cancel("c-running"));
  check("a cancelled running job resolves cancelled", (await running).status === "cancelled");
  check("the host received a cancel for that job", fake.requests.some((r) => r.type === "cancel" && r.jobId.startsWith("c-running#")));
  await service.shutdown();
}
{
  let hangFirst = true;
  const { fake, service } = harness({
    fake: {
      respond: () => {
        if (hangFirst) {
          hangFirst = false;
          return { hang: true };
        }
        return { text: GOOD, delayMs: 5 };
      }
    }
  });
  const timedOut = await service.submit(job("t1", { timeoutMs: 40 }));
  check("a hung inference fails with TIMEOUT", code(timedOut) === "failed/TIMEOUT", code(timedOut));
  check("the timed-out generation was cancelled on the host", fake.requests.some((r) => r.type === "cancel" && r.jobId.startsWith("t1#")));
  const next = await service.submit(job("t2"));
  check("the next job still runs", next.status === "ok", code(next));
  check("and never overlapped the timed-out one", fake.maxConcurrentInferences === 1, String(fake.maxConcurrentInferences));
  await service.shutdown();
}

console.log("\nOutput contract:\n");
{
  const cases: Array<[string, string, string]> = [
    ["plain text", "Sure! The answer is c1.", "failed/MALFORMED_OUTPUT"],
    ["truncated JSON (a length stop)", '{"verdict":"pro', "failed/MALFORMED_OUTPUT"],
    ["an operation the request did not offer", '{"verdict":"delete"}', "failed/SCHEMA_REJECTED"],
    ["an unknown id inside valid JSON", '{"verdict":"keep","candidateId":"c9"}', "failed/SCHEMA_REJECTED"],
    ["an extra property", '{"verdict":"keep","reason":"x"}', "failed/SCHEMA_REJECTED"],
    ["a missing required property", '{"candidateId":"c1"}', "failed/SCHEMA_REJECTED"]
  ];
  for (const [label, text, want] of cases) {
    const { service } = harness({ fake: { respond: () => text } });
    const outcome = await service.submit(job(`o-${label.length}`));
    check(`${label} is refused (${want})`, code(outcome) === want, code(outcome));
    check(`${label} never reaches the caller as a value`, !("value" in outcome));
    await service.shutdown();
  }
}

console.log("\nCrash, restart and the circuit:\n");
{
  let crashNext = true;
  const { fake, service } = harness({
    fake: {
      respond: () => {
        if (crashNext) {
          crashNext = false;
          return { crash: true, delayMs: 5 };
        }
        return GOOD;
      }
    }
  });
  const crashed = await service.submit(job("k1"));
  check("a crash mid-inference fails the job", code(crashed) === "failed/HOST_ERROR", code(crashed));
  check("the error state is reported", (await service.status()).state.kind === "error");
  const recovered = await service.submit(job("k2"));
  check("the next job recovers", recovered.status === "ok", code(recovered));
  check("after the crash the host is re-handshaken and the model reloaded", fake.requestTypes().join(",") === "hello,load,infer,hello,load,infer", fake.requestTypes().join(","));
  fake.crash();
  fake.crash();
  fake.crash();
  const open = await service.submit(job("k3"));
  check("an open circuit makes the service unavailable", code(open) === "rejected/UNAVAILABLE" && open.status === "rejected" && open.reason === "CIRCUIT_OPEN", JSON.stringify(open));
  check("status reports the open circuit", JSON.stringify((await service.status()).state) === JSON.stringify({ kind: "unavailable", reason: "CIRCUIT_OPEN" }));
  await service.shutdown();
}
{
  const { fake, service } = harness({ fake: { loadFails: true } });
  const outcome = await service.submit(job("l1"));
  check("a load failure fails the job with LOAD_FAILED", code(outcome) === "failed/LOAD_FAILED", code(outcome));
  check("no inference is attempted without a loaded model", fake.inferRequests().length === 0);
  await service.shutdown();
}
{
  const { fake, service } = harness({ expectedRuntimeBuild: "b-pinned" });
  const first = await service.submit(job("v1"));
  check("a runtime build other than the pinned one is incompatible", first.status === "rejected" && first.reason === "RUNTIME_INCOMPATIBLE", JSON.stringify(first));
  check("no model is loaded into an incompatible runtime", !fake.requestTypes().includes("load"));
  const second = await service.submit(job("v2"));
  check("incompatibility is sticky and refused before queueing", second.status === "rejected" && second.reason === "RUNTIME_INCOMPATIBLE" && fake.requests.length === 1);
  await service.shutdown();
}
{
  const { service } = harness({ model: { ok: true, modelId: "escape", modelPath: resolve("elsewhere", "model.gguf"), contextTokens: 4096 } });
  const outcome = await service.submit(job("m1"));
  check("a model path outside the model root is refused by the host", code(outcome) === "failed/LOAD_FAILED", code(outcome));
  await service.shutdown();
}

console.log("\nYield to Playwright:\n");
{
  const { fake, service, setView } = harness({ fake: { respond: () => ({ text: GOOD, delayMs: 60 }) } });
  const pending = service.submit(job("y1"));
  check("the job starts while the host is idle", await until(() => fake.inferRequests().length === 1));
  setView({ activeRuns: 1 });
  check("the running inference is cancelled when a run starts", await until(() => fake.requests.some((r) => r.type === "cancel")));
  await sleep(30);
  const held = await service.status();
  check("the yielded job is back in the queue, held by the run", held.queueDepth === 1 && held.holdReason === "RUNS_ACTIVE", JSON.stringify(held));
  check("it does not restart while the run is active", fake.inferRequests().length === 1);
  setView({ activeRuns: 0 });
  service.notifyAdmissionChanged();
  const outcome = await pending;
  check("it completes once the run ends", outcome.status === "ok", code(outcome));
  check("the outcome counts one yield", outcome.status === "ok" && outcome.yields === 1);
  const ids = fake.inferRequests().map((r) => r.jobId);
  check("the retry is a new host job id", ids.length === 2 && ids[0] !== ids[1], ids.join(","));
  check("the status counts the yield", (await service.status()).counters.yielded === 1);
  await service.shutdown();
}
{
  const { fake, service, setView } = harness({ maxYields: 1, fake: { respond: () => ({ text: GOOD, delayMs: 60 }) } });
  const pending = service.submit(job("y2"));
  for (let round = 1; round <= 2; round += 1) {
    await until(() => fake.inferRequests().length === round);
    setView({ activeRuns: 1 });
    await until(() => fake.requests.filter((r) => r.type === "cancel").length === round);
    setView({ activeRuns: 0 });
    service.notifyAdmissionChanged();
  }
  const outcome = await pending;
  check("a job pushed back more than maxYields times gives up", code(outcome) === "failed/YIELD_LIMIT", code(outcome));
  await service.shutdown();
}
{
  const holds: Array<[string, Partial<AiAdmissionView>, Partial<AiServiceSettings>, string]> = [
    ["queued runs", { queuedRuns: 2 }, {}, "RUNS_ACTIVE"],
    ["a dispatch refusal", { dispatchBlocked: true }, {}, "DISPATCH_BLOCKED"],
    ["host pressure", { pressureState: "pressure" }, {}, "HOST_PRESSURE"],
    ["critical pressure", { pressureState: "critical" }, {}, "HOST_PRESSURE"],
    ["low free memory", { freeMemoryMb: 100 }, {}, "LOW_MEMORY"],
    ["no weighted headroom with yield off", { activeRuns: 1, activeWeight: 1, weightedBudget: 2 }, { yieldDuringRuns: false }, "WEIGHTED_BUDGET"]
  ];
  for (const [label, view, settings, reason] of holds) {
    const { fake, service, setView } = harness({ settings });
    setView(view);
    const pending = service.submit(job("h1"));
    await sleep(25);
    const status = await service.status();
    check(`${label} holds the job (${reason})`, fake.inferRequests().length === 0 && status.holdReason === reason, `${status.holdReason}`);
    await service.shutdown();
    await pending;
  }
  const { fake, service, setView } = harness({ settings: { yieldDuringRuns: false } });
  setView({ activeRuns: 1, activeWeight: 1, weightedBudget: 4 });
  const outcome = await service.submit(job("h2"));
  check("with yield off and weighted headroom, inference runs beside a run", outcome.status === "ok" && fake.inferRequests().length === 1, code(outcome));
  await service.shutdown();
}

console.log("\nIdle unload, states and shutdown:\n");
{
  const { fake, service } = harness({ settings: { idleUnloadMs: 25 } });
  await service.submit(job("u1"));
  check("the model is unloaded after the idle period", await until(() => fake.requestTypes().includes("unload")));
  check("the service forgets the loaded model", (await service.status()).loadedModelId === null);
  await service.submit(job("u2"));
  check("the next job reloads without a second handshake", fake.requestTypes().join(",") === "hello,load,infer,unload,load,infer", fake.requestTypes().join(","));
  await service.shutdown();
}
{
  const { fake, service } = harness({ fake: { loadDelayMs: 80, respond: () => ({ hang: true }) } });
  const running = service.submit(job("s1"));
  check("loading is reported while the model loads", await until(() => fake.requestTypes().includes("load")) && (await service.status()).state.kind === "loading");
  await until(() => fake.inferRequests().length === 1);
  const queued = service.submit(job("s2"));
  await sleep(5);
  await service.shutdown();
  check("shutdown cancels the running job", (await running).status === "cancelled");
  check("shutdown rejects the queued job", code(await queued) === "rejected/SHUTDOWN");
  check("shutdown disposes the host", !fake.isAvailable());
  check("a submit after shutdown is refused", code(await service.submit(job("s3"))) === "rejected/SHUTDOWN");
  check("status reports shutdown", JSON.stringify((await service.status()).state) === JSON.stringify({ kind: "unavailable", reason: "SHUTDOWN" }));
}

console.log("\nThreads derive from the host:\n");
{
  const cases: Array<[number, number]> = [[1, 1], [2, 1], [4, 2], [6, 3], [8, 4], [12, 4], [64, 4], [Number.NaN, 1]];
  for (const [cpus, want] of cases) check(`${cpus} logical CPUs -> ${want} threads`, deriveInferenceThreads(cpus) === want, String(deriveInferenceThreads(cpus)));
}

clearInterval(keepAlive);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
