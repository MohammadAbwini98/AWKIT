/**
 * L8b.2 live: the static header stage on the REAL host (`native-hosts/ai/ai-host.cjs`) in a real utility
 * process, reading with the pinned runtime's own GGUF reader. Harness mode `inspect`.
 *
 *  - The real models staged in AWKIT_HARNESS_MODEL_ROOT must pass: the curated packs, and a real model the
 *    manifest does not list.
 *  - Hand-built header-only GGUF files, one per check, must each fail that check and no other, and one
 *    compatible header of another architecture must pass. That includes a header claiming endless
 *    entries, which the runtime's reader would read as zeros forever: the host's deadline must end it
 *    and leave the host answering.
 *  - The product path: `AiModelPackStore` imports a non-manifest file, `runStaticStage` runs it through
 *    `AiService.inspectModel` (with AI switched off) and records the verdict on that model only.
 *  - The main process never loads the runtime, and the host never restarts.
 */

import fs from "node:fs";
import path from "node:path";

import { AiUtilityHostManager } from "@main/ai/AiUtilityHostManager";
import { runStaticStage, staticStanding, staticVerdict } from "@src/ai/AiModelCompatibility";
import { AiModelPackStore } from "@src/ai/AiModelPack";
import { AiService } from "@src/ai/AiService";
import { AI_HOST_PROTOCOL_VERSION, AI_HOST_TIMEOUTS, type AiHostHello, type AiModelHeader } from "@src/ai/contracts/AiHostProtocol";
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
  await manager.dispose();

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
  const stage = () => runStaticStage({ store, inspect: (file) => service.inspectModel(file), runtimeBuild: build });
  const llama = path.join(sources, "Llama-3-style.gguf");
  const qwen2 = path.join(sources, "Qwen2-style.gguf");
  fs.writeFileSync(llama, model({ arch: "llama", template: LLAMA3 }));
  fs.writeFileSync(qwen2, model());

  await step("an imported non-manifest model is checked in the host and its failure recorded (AI off)", async () => {
    const imported = await store.import(llama);
    if (!imported.ok || imported.entry !== null) throw new Error(JSON.stringify(imported));
    const before = await store.status();
    const result = await stage();
    const after = await store.status();
    if (before.status !== "registered" || before.staticCheck !== null) throw new Error(`before: ${JSON.stringify(before)}`);
    if (result !== "CHAT_TEMPLATE" || after.status !== "registered" || after.staticCheck?.failed !== "CHAT_TEMPLATE" || after.staticCheck.runtimeBuild !== build) {
      throw new Error(`${result}: ${JSON.stringify(after)}`);
    }
    if (staticStanding(after.staticCheck, build) !== "CHAT_TEMPLATE" || staticStanding(after.staticCheck, `${build}-other`) !== null) throw new Error("standing");
    return { result, staticCheck: after.staticCheck };
  });
  await step("a replacement starts unchecked and records its own pass", async () => {
    const imported = await store.import(qwen2);
    if (!imported.ok || imported.entry !== null) throw new Error(JSON.stringify(imported));
    const before = await store.status();
    const result = await stage();
    const after = await store.status();
    if (before.status !== "registered" || before.staticCheck !== null) throw new Error(`the old verdict carried over: ${JSON.stringify(before)}`);
    if (result !== "passed" || after.status !== "registered" || after.staticCheck?.failed !== null) throw new Error(`${result}: ${JSON.stringify(after)}`);
    return { result, staticCheck: after.staticCheck };
  });
  await service.shutdown();

  await step("the main process never loaded the runtime", () => {
    // An internal Node list, absent from @types/node.
    const loaded = (process as unknown as { moduleLoadList: string[] }).moduleLoadList.filter((entry) => /llama/i.test(entry));
    if (loaded.length > 0) throw new Error(`runtime modules loaded in main: ${loaded.join(", ")}`);
    return { loaded: 0 };
  });
}
