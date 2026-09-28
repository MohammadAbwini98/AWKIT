/**
 * L8b.2 and L8b.3 live: the static header stage and the dynamic probe on the REAL host
 * (`native-hosts/ai/ai-host.cjs`) in a real utility process, with the pinned runtime. Harness mode `inspect`.
 *
 *  - The real models staged in AWKIT_HARNESS_MODEL_ROOT must pass both: the curated packs, and a real model
 *    the manifest does not list. The probe loads each once, reads its first unconstrained tokens after the
 *    product's thinking-off prompt for a think marker, and answers the probe schema.
 *  - Hand-built header-only GGUF files, one per check, must each fail that check and no other, and one
 *    compatible header of another architecture must pass. That includes a header claiming endless
 *    entries, which the runtime's reader would read as zeros forever: the host's deadline must end it
 *    and leave the host answering. The compatible header has no weights, so its probe must fail the load
 *    without taking the host down.
 *  - The same host with its thinking-off pre-fill removed (AWKIT_HARNESS_MUTANT_HOST_PATH) must read
 *    THINKING_NOT_DISABLED on a real Qwen3.5 model: the check observes the model, not the template text.
 *  - The product path: `AiModelPackStore` imports a non-manifest file, `runCompatibilityStages` runs it
 *    through `AiService.inspectModel` and `probeModel` (with AI switched off) and records each verdict on
 *    that model only.
 *  - The main process never loads the runtime, and the host never restarts.
 */

import fs from "node:fs";
import path from "node:path";

import { AiUtilityHostManager } from "@main/ai/AiUtilityHostManager";
import { compatibilityStanding, probeVerdict, runCompatibilityStages, staticVerdict } from "@src/ai/AiModelCompatibility";
import { AiModelPackStore } from "@src/ai/AiModelPack";
import { AiService } from "@src/ai/AiService";
import {
  AI_HOST_PROTOCOL_VERSION,
  AI_HOST_TIMEOUTS,
  type AiHostHello,
  type AiModelHeader,
  type AiModelProbe
} from "@src/ai/contracts/AiHostProtocol";
import { AI_MODEL_MANIFEST } from "@src/offline/AiModelManifest";

import { ggufHeader, LLAMA3, modelHeader } from "../helpers/gguf-header.mts";

interface Deps {
  step: <T>(label: string, fn: () => Promise<T> | T) => Promise<T | undefined>;
  record: (key: string, value: unknown) => void;
  log: (line: string) => void;
}

const model = modelHeader;

/** Each hand-built header and the one verdict it must get. */
const CASES: Array<{ label: string; bytes: Buffer; want: string }> = [
  { label: "a ChatML model of another architecture (qwen2)", bytes: model(), want: "passed" },
  { label: "a Llama-3 chat template", bytes: model({ arch: "llama", template: LLAMA3 }), want: "CHAT_TEMPLATE" },
  { label: "no chat template", bytes: model({ template: null }), want: "CHAT_TEMPLATE" },
  { label: "an architecture the runtime does not know", bytes: model({ arch: "notanarch" }), want: "ARCHITECTURE_UNSUPPORTED" },
  { label: "a tensor of a type the runtime does not know", bytes: model({ tensors: [{ name: "blk.0.ffn_up.weight", type: 99 }] }), want: "TENSOR_TYPE_UNSUPPORTED" },
  { label: "a 2,048-token context", bytes: model({ context: 2048 }), want: "CONTEXT_TOO_SMALL" },
  { label: "no layers", bytes: model({ blocks: 0 }), want: "LAYER_COUNT" },
  { label: "5,000 layers", bytes: model({ blocks: 5000 }), want: "LAYER_COUNT" },
  { label: "GGUF version 4 (read as 3 by the runtime)", bytes: model({ version: 4 }), want: "GGUF_VERSION" },
  { label: "GGUF version 1 (refused by the runtime)", bytes: model({ version: 1 }), want: "GGUF_UNREADABLE" },
  { label: "no tensors", bytes: model({ tensors: [] }), want: "GGUF_UNREADABLE" },
  { label: "not a GGUF file", bytes: Buffer.from("NOT A GGUF MODEL, ONLY BYTES"), want: "GGUF_UNREADABLE" },
  {
    label: "a header claiming 2^62 entries (read as zeros past its end)",
    bytes: ggufHeader({ kv: [["general.architecture", "str", "qwen2"]], kvCount: 2n ** 62n }),
    want: "GGUF_UNREADABLE"
  }
];

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export async function runModelInspect({ step, record, log }: Deps): Promise<void> {
  const hostPath = required("AWKIT_HARNESS_HOST_PATH");
  const modelRoot = required("AWKIT_HARNESS_MODEL_ROOT");
  const build = required("AWKIT_HARNESS_EXPECT_BUILD");
  const packs = JSON.parse(required("AWKIT_HARNESS_PACKS")) as Array<{ id: string; file: string; curated: boolean }>;
  const manager = new AiUtilityHostManager({ hostPath, modelRoot, log: (level, message) => log(`${level}: ${message}`) });
  const inspect = async (file: string) => {
    const started = Date.now();
    const header = await manager.call<AiModelHeader>({ type: "inspect", modelPath: path.join(modelRoot, file) }, AI_HOST_TIMEOUTS.inspectMs);
    const verdict = staticVerdict(header);
    return { header, standing: verdict.ok ? "passed" : verdict.failed, ms: Date.now() - started };
  };

  const hello = await step("the host reports the pinned runtime", async () => {
    const value = await manager.call<AiHostHello>({ type: "hello", expected: { protocolVersion: AI_HOST_PROTOCOL_VERSION } }, 15_000);
    if (!value.compatible || value.runtime.build !== build) throw new Error(JSON.stringify(value.runtime));
    return value.runtime;
  });
  if (!hello) return;
  const pid = manager.status().pid;

  const curated: Record<string, unknown> = {};
  for (const pack of packs) {
    await step(`${pack.curated ? "the curated pack" : "the real model the manifest does not list,"} ${pack.id} passes the header check`, async () => {
      const result = await inspect(pack.file);
      curated[pack.id] = result;
      if (result.standing !== "passed") throw new Error(`${result.standing}: ${JSON.stringify(result.header)}`);
      return result;
    });
  }
  record("curated", curated);

  const cases: Record<string, unknown> = {};
  for (const [index, item] of CASES.entries()) {
    const file = `${String(index).padStart(64, "c")}.gguf`;
    fs.writeFileSync(path.join(modelRoot, file), item.bytes);
    await step(`${item.label}: ${item.want}`, async () => {
      const result = await inspect(file);
      cases[item.label] = result;
      if (result.standing !== item.want) throw new Error(`got ${result.standing}: ${JSON.stringify(result.header)}`);
      return result;
    });
  }
  record("cases", cases);

  await step("the host answered every file without restarting", async () => {
    const value = await manager.call<AiHostHello>({ type: "hello", expected: { protocolVersion: AI_HOST_PROTOCOL_VERSION } }, 15_000);
    const status = manager.status();
    if (!value.compatible || status.pid !== pid || status.unexpectedExits !== 0) throw new Error(JSON.stringify(status));
    return { pid: status.pid, unexpectedExits: status.unexpectedExits };
  });
  await step("a path outside the model root is refused", async () => {
    const outside = path.join(path.dirname(modelRoot), `${"f".repeat(64)}.gguf`);
    fs.writeFileSync(outside, model());
    const reason = await manager.call({ type: "inspect", modelPath: outside }, AI_HOST_TIMEOUTS.inspectMs).then(
      () => "answered",
      (error: { reason?: string }) => error.reason
    );
    if (reason !== "AI_MODEL_PATH_OUTSIDE_ROOT") throw new Error(String(reason));
    return { reason };
  });

  // ── L8b.3: the probe on the real host ──
  const threads = Number(process.env.AWKIT_HARNESS_THREADS ?? "4");
  let probes = 0;
  const probe = async (host: AiUtilityHostManager, file: string) => {
    const started = Date.now();
    const reply = await host.call<AiModelProbe>(
      { type: "probe", jobId: `probe-${++probes}`, modelPath: path.join(modelRoot, file), contextTokens: 4096, threads },
      AI_HOST_TIMEOUTS.probeMs
    );
    const verdict = probeVerdict(reply);
    return { reply, standing: verdict.ok ? "passed" : verdict.failed, ms: Date.now() - started };
  };
  const probed: Record<string, unknown> = {};
  for (const pack of packs) {
    await step(`${pack.curated ? "the curated pack" : "the real model the manifest does not list,"} ${pack.id} passes the probe: loads, thinking stays off, answers the schema`, async () => {
      const result = await probe(manager, pack.file);
      probed[pack.id] = result;
      if (result.standing !== "passed") throw new Error(`${result.standing}: ${JSON.stringify(result.reply)}`);
      return result;
    });
  }
  record("probes", probed);
  const headerOnly = `${String(0).padStart(64, "c")}.gguf`;
  await step("a compatible header with no weights fails the probe's load: PROBE_LOAD_FAILED", async () => {
    const result = await probe(manager, headerOnly);
    if (result.standing !== "PROBE_LOAD_FAILED") throw new Error(`got ${result.standing}: ${JSON.stringify(result.reply)}`);
    return result;
  });
  await step("the host survived every probe, the failed load included (same process, no restart)", async () => {
    const value = await manager.call<AiHostHello>({ type: "hello", expected: { protocolVersion: AI_HOST_PROTOCOL_VERSION } }, 15_000);
    const status = manager.status();
    if (!value.compatible || status.pid !== pid || status.unexpectedExits !== 0) throw new Error(JSON.stringify(status));
    return { pid: status.pid, unexpectedExits: status.unexpectedExits };
  });
  await manager.dispose();

  const mutantPath = required("AWKIT_HARNESS_MUTANT_HOST_PATH");
  const mutant = new AiUtilityHostManager({ hostPath: mutantPath, modelRoot, log: (level, message) => log(`${level}: ${message}`) });
  await step(`with the thinking-off pre-fill removed, the same host reads THINKING_NOT_DISABLED on the real ${packs[0].id}`, async () => {
    const result = await probe(mutant, packs[0].file);
    record("mutantProbe", result);
    if (result.standing !== "THINKING_NOT_DISABLED") throw new Error(`got ${result.standing}: ${JSON.stringify(result.reply)}`);
    return result;
  });
  await mutant.dispose();

  // ── The product path: store, stage and service, with AI switched off ──
  const storeRoot = path.join(path.dirname(modelRoot), "store-models");
  const sources = path.join(path.dirname(modelRoot), "sources");
  fs.mkdirSync(storeRoot, { recursive: true });
  fs.mkdirSync(sources, { recursive: true });
  const storeManager = new AiUtilityHostManager({ hostPath, modelRoot: storeRoot, log: (level, message) => log(`${level}: ${message}`) });
  const service = new AiService({
    transport: (backend) => (backend === "cpu" ? storeManager : null),
    model: async () => ({ ok: false, reason: "MODEL_MISSING" }),
    settings: async () => ({ enabled: false, yieldDuringRuns: true, idleUnloadMs: 0, minFreeMemoryMb: 0 }),
    admission: () => ({ activeRuns: 0, queuedRuns: 0, pressureState: "stable", dispatchBlocked: false, activeWeight: 0, weightedBudget: 100, freeMemoryMb: 1_000_000 }),
    threads: 2,
    expectedRuntimeBuild: build,
    log: (level, message) => log(`${level}: ${message}`)
  });
  const store = new AiModelPackStore(storeRoot, AI_MODEL_MANIFEST);
  let probesAsked = 0;
  const stage = () =>
    runCompatibilityStages({
      store,
      inspect: (file) => service.inspectModel(file),
      probe: (file) => (probesAsked++, service.probeModel(file)),
      runtimeBuild: build
    });
  const llama = path.join(sources, "Llama-3-style.gguf");
  const qwen2 = path.join(sources, "Qwen2-style.gguf");
  fs.writeFileSync(llama, model({ arch: "llama", template: LLAMA3 }));
  fs.writeFileSync(qwen2, model());

  await step("an imported non-manifest model is checked in the host, its header failure recorded, and it is never probed (AI off)", async () => {
    const imported = await store.import(llama);
    if (!imported.ok || imported.entry !== null) throw new Error(JSON.stringify(imported));
    const before = await store.status();
    const result = await stage();
    const after = await store.status();
    if (before.status !== "registered" || before.staticCheck !== null) throw new Error(`before: ${JSON.stringify(before)}`);
    if (result !== "CHAT_TEMPLATE" || after.status !== "registered" || after.staticCheck?.failed !== "CHAT_TEMPLATE" || after.staticCheck.runtimeBuild !== build) {
      throw new Error(`${result}: ${JSON.stringify(after)}`);
    }
    if (probesAsked !== 0 || after.probeCheck !== null) throw new Error("a model that failed its header was probed");
    if (compatibilityStanding(after, build) !== "CHAT_TEMPLATE" || compatibilityStanding(after, `${build}-other`) !== null) throw new Error("standing");
    return { result, staticCheck: after.staticCheck };
  });
  await step("a replacement starts unchecked, passes its header, and its probe records the failed load", async () => {
    const imported = await store.import(qwen2);
    if (!imported.ok || imported.entry !== null) throw new Error(JSON.stringify(imported));
    const before = await store.status();
    const result = await stage();
    const after = await store.status();
    if (before.status !== "registered" || before.staticCheck !== null || before.probeCheck !== null) throw new Error(`the old verdict carried over: ${JSON.stringify(before)}`);
    if (result !== "PROBE_LOAD_FAILED" || after.status !== "registered" || after.staticCheck?.failed !== null || after.probeCheck?.failed !== "PROBE_LOAD_FAILED") {
      throw new Error(`${result}: ${JSON.stringify(after)}`);
    }
    if (probesAsked !== 1 || compatibilityStanding(after, build) !== "PROBE_LOAD_FAILED") throw new Error(`probes ${probesAsked}`);
    return { result, staticCheck: after.staticCheck, probeCheck: after.probeCheck };
  });
  await service.shutdown();

  await step("the main process never loaded the runtime", () => {
    // An internal Node list, absent from @types/node.
    const loaded = (process as unknown as { moduleLoadList: string[] }).moduleLoadList.filter((entry) => /llama/i.test(entry));
    if (loaded.length > 0) throw new Error(`runtime modules loaded in main: ${loaded.join(", ")}`);
    return { loaded: 0 };
  });
}
