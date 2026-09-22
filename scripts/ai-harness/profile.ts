/**
 * L1.8 inference profile (Phase L) — the bounded measurements that separate the `locatorUpgrade`
 * timeout into its parts. Diagnosis only: it changes no product behaviour and asserts no ceiling.
 *
 * The benchmark could not tell WHY `locatorUpgrade` blew 180 s because `native-hosts/ai/ai-host.cjs`
 * returns `promptMs`/`firstTokenMs`/`generationMs` only on completion, and a timed-out run never
 * completes. It also cannot answer the grammar question at all: the host refuses unconstrained
 * generation (`AI_SCHEMA_REQUIRED`), by design, so no request through the product path can measure
 * what the grammar costs.
 *
 * So this profile drives node-llama-cpp DIRECTLY, in the harness's own Electron main process. That
 * is deliberately not the product architecture — the product always infers out of process — and it
 * is why this lives in `scripts/` and runs only from `verify:ai-inference-profile`. Driving the
 * runtime directly is the only way to hold everything else equal and vary ONE thing at a time:
 *
 *   A  short prompt, no grammar      decode tokens/s, floor for the model on this host
 *   B  short prompt, JSON grammar    the same decode with the real locatorUpgrade schema  → A/B = grammar cost
 *   C  long prompt (~2K), no grammar TTFT against A's TTFT  → prompt-evaluation tokens/s
 *   D  short prompt, no grammar, more threads                → does decode scale with cores?
 *
 * Every probe is bounded by a small `maxTokens`, so even at the observed ~1 token/s no probe can run
 * away, and each records its own measurement before the next starts. A probe that produced no tokens
 * reports `ok: false` rather than a rate computed from nothing.
 */

import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildAiPrompt, type AiPromptSpec } from "@src/ai/AiPromptBuilder";
import { SemanticRedactor } from "@src/semantic/SemanticRedactor";

export interface ProfileApi {
  step: <T>(label: string, fn: () => Promise<T> | T) => Promise<T | undefined>;
  record: (key: string, value: unknown) => void;
  /** Persist what has been recorded so far, so a step killed mid-flight still leaves its evidence. */
  flush: () => void;
}

const NONCE = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";

/**
 * The exact grammar shape the `locatorUpgrade` packet uses (scripts/ai-harness/bench.ts), already
 * translated the way `toGrammarSchema` in the host translates it: no `minimum`/`maximum`, which the
 * grammar has no way to express.
 */
const LOCATOR_GRAMMAR_SCHEMA = {
  type: "object",
  properties: {
    choice: { enum: Array.from({ length: 8 }, (_, i) => `cand-${i + 1}`) },
    scope: { enum: ["none", "form", "dialog", "row", "region"] },
    confidence: { type: "integer" },
    rationale: { type: "string", maxLength: 240 }
  },
  required: ["choice", "scope", "confidence", "rationale"],
  additionalProperties: false
} as const;

/** Mirrors the host's TEMPLATE: Qwen3.5 ChatML with thinking pre-closed. */
const TEMPLATE = Object.freeze({
  systemOpen: "<|im_start|>system\n",
  userOpen: "<|im_end|>\n<|im_start|>user\n",
  assistantOpen: "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"
});

function built(spec: AiPromptSpec): { system: string; user: string } {
  const prompt = buildAiPrompt(spec, new SemanticRedactor(), NONCE);
  if (!prompt.ok) throw new Error(`synthetic packet refused by the prompt builder: ${prompt.code}`);
  return { system: prompt.system, user: prompt.user };
}

/**
 * The smallest prompt the builder will still produce (~146 tokens once its system preamble is
 * counted), shared by both probes so the grammar is the only thing that differs between them.
 *
 * It is deliberately NOT the L1.8 locatorUpgrade packet. That packet's ~2,000 prompt tokens cost
 * more than the launcher's whole 540 s budget at the rates measured here, so running it would
 * produce another timeout instead of a number. Rates measured on this prompt project onto it.
 */
const TINY: AiPromptSpec = {
  instructions: "Choose the best locator candidate.",
  fields: [{ name: "candidates", ids: ["cand-1", "cand-2"] }],
  maxDataChars: 9_000
};

/**
 * Resolve the ESM runtime from the repository, since the harness is esbuilt into a temp directory
 * whose node_modules is empty. By path, not by `require.resolve`: the package's `exports` map has no
 * `./package.json` entry, so resolving through the specifier throws ERR_PACKAGE_PATH_NOT_EXPORTED.
 * This is the same install `runtimeInstalled()` in launch.mts reports on.
 */
export async function loadRuntime(repoRoot: string): Promise<Record<string, any>> {
  const entry = path.join(repoRoot, "node_modules", "node-llama-cpp", "dist", "index.js");
  return (await import(pathToFileURL(entry).href)) as Record<string, any>;
}

interface Measurement {
  promptTokens: number;
  outputTokens: number;
  firstTokenMs: number;
  generationMs: number;
  wallMs: number;
  decodeTokensPerSec: number | null;
  stopReason: string;
  grammar: boolean;
  threads: number;
  batchSize: number;
  promptTokensPerSec: number | null;
}

export async function runProfile(api: ProfileApi): Promise<void> {
  const repoRoot = process.env.AWKIT_HARNESS_REPO_ROOT ?? "";
  const modelPath = process.env.AWKIT_HARNESS_MODEL_PATH ?? "";
  const threads = Number(process.env.AWKIT_HARNESS_THREADS ?? "3");
  const wideThreads = Number(process.env.AWKIT_HARNESS_WIDE_THREADS ?? "6");
  const contextTokens = 4096;

  api.record("host", { logicalCpusVisible: os.cpus().length, threads, wideThreads });

  const runtime = await loadRuntime(repoRoot);
  const { LlamaText, SpecialTokensText } = runtime;

  // llama.cpp's own log, kept (bounded) instead of discarded. The host disables it because a
  // production host must never relay runtime text; a diagnostic that throws it away cannot say which
  // phase of a load or a decode the time went into.
  const runtimeLog: string[] = [];
  const logger = (level: unknown, message: unknown) => {
    if (runtimeLog.length < 400) runtimeLog.push(`${String(level)}: ${String(message).trim()}`);
    api.record("runtimeLog", runtimeLog);
  };

  // The host's exact value. `maxThreads` is documented as a cap, but it is NOT inert: raising it to
  // 6 while every context still asked for 3 made the identical probe run 3x slower (TTFT 102 s →
  // 313 s, decode 1.10 → 0.23 tokens/s), which is what a larger spinning thread pool contending for
  // a 3-physical-core affinity mask looks like. Measuring the shipped configuration means setting it
  // the way the host sets it. It is never 0 ("as many as the hardware allows") — inside an
  // affinity-masked process `os.cpus()` still reports every logical CPU on the machine.
  const llama = await runtime.getLlama({
    gpu: false,
    build: "never",
    skipDownload: true,
    progressLogs: false,
    logLevel: runtime.LlamaLogLevel.info,
    logger,
    maxThreads: threads
  });

  // A heartbeat, so "still inside loadModel at 300 s" is recorded rather than inferred from silence.
  const startedAt = performance.now();
  const heartbeat = setInterval(() => {
    api.record("heartbeatMs", Math.round(performance.now() - startedAt));
    api.flush();
  }, 5_000);
  heartbeat.unref?.();

  // The model is held here, never returned from the step: a step's return value becomes its report
  // `detail`, and `LlamaModel` carries a cycle that used to wedge the whole harness (see `serialize`).
  let loadedModel: any = null;
  await api.step("profile: load the model", async () => {
    const started = performance.now();
    // Progress is recorded as it arrives, so a load killed by the launcher still says how far it
    // got and how fast: "the load never finished" and "the load was reading at 5 MB/s" are very
    // different findings, and a report written only on success cannot tell them apart.
    let lastRecorded = 0;
    const value = await llama.loadModel({
      modelPath,
      gpuLayers: 0,
      useMmap: true,
      useMlock: false,
      onLoadProgress(loadProgress: number) {
        const percent = Math.floor(loadProgress * 100);
        if (percent < lastRecorded + 5) return;
        lastRecorded = percent;
        api.record("loadProgress", { percent, atMs: Math.round(performance.now() - started) });
        api.flush();
      }
    });
    loadedModel = value;
    const loadMs = Math.round(performance.now() - started);
    api.record("load", { loadMs });
    return { loadMs };
  });
  const model = loadedModel;
  if (!model) throw new Error("the model did not load");

  await api.step("profile: grammar construction for the locatorUpgrade schema", async () => {
    const started = performance.now();
    await llama.createGrammarForJsonSchema(LOCATOR_GRAMMAR_SCHEMA);
    const grammarMs = Math.round(performance.now() - started);
    api.record("grammarMs", grammarMs);
    return { grammarMs };
  });

  const grammar = await llama.createGrammarForJsonSchema(LOCATOR_GRAMMAR_SCHEMA);

  const measurements: Record<string, Measurement> = {};

  const probe = async (
    key: string,
    label: string,
    spec: AiPromptSpec,
    options: { grammar: boolean; maxTokens: number; threads: number; batchSize: number }
  ): Promise<void> => {
    await api.step(label, async () => {
      // A context per probe, disposed with it. Holding several alive would have each one's KV cache
      // and its ~500 MiB compute buffer resident at once, so a later probe would be measuring a
      // machine the earlier probes had already filled.
      const context = await model.createContext({
        contextSize: contextTokens,
        threads: options.threads,
        batchSize: options.batchSize,
        sequences: 1
      });
      const sequence = context.getSequence();
      const completion = new runtime.LlamaCompletion({ contextSequence: sequence });
      try {
      const prompt = built(spec);
      const tokens = LlamaText([
        new SpecialTokensText(TEMPLATE.systemOpen),
        prompt.system,
        new SpecialTokensText(TEMPLATE.userOpen),
        prompt.user,
        new SpecialTokensText(TEMPLATE.assistantOpen)
      ]).tokenize(model.tokenizer);

      await sequence.clearHistory();
      const started = performance.now();
      let firstTokenAt: number | null = null;
      let outputTokens = 0;
      const { metadata } = await completion.generateCompletionWithMeta(tokens, {
        ...(options.grammar ? { grammar } : {}),
        maxTokens: options.maxTokens,
        temperature: 0,
        seed: 0,
        onToken(chunk: unknown[]) {
          if (firstTokenAt === null) firstTokenAt = performance.now();
          outputTokens += chunk.length;
        }
      });
      const finished = performance.now();
      const firstToken = firstTokenAt as number | null;
      const generationMs = firstToken === null ? 0 : Math.round(finished - firstToken);
      const measurement: Measurement = {
        promptTokens: tokens.length,
        outputTokens,
        firstTokenMs: firstToken === null ? 0 : Math.round(firstToken - started),
        generationMs,
        wallMs: Math.round(finished - started),
        // One token arrives WITH the first-token mark, so the rate covers the tokens after it.
        decodeTokensPerSec: outputTokens > 1 && generationMs > 0 ? +((outputTokens - 1) / (generationMs / 1000)).toFixed(2) : null,
        stopReason: String(metadata.stopReason),
        grammar: options.grammar,
        threads: options.threads,
        batchSize: options.batchSize,
        // Time-to-first-token over the prompt. It includes ONE decode step, so it slightly
        // understates prompt evaluation — which is the safe direction for a bottleneck claim.
        promptTokensPerSec: firstToken === null ? null : +(tokens.length / ((firstToken - started) / 1000)).toFixed(2)
      };
      measurements[key] = measurement;
      // A probe that decoded nothing measured nothing: never let it stand as a pass whose rate is
      // simply null, because the comparisons below would then be drawn from absent data.
      if (measurement.outputTokens < 2) throw new Error(`probe produced ${measurement.outputTokens} token(s); no rate can be derived`);
      return measurement;
      } finally {
        await context.dispose().catch(() => undefined);
      }
    });
  };

  // TWO probes, differing ONLY in the grammar, at the shipped batch size and thread count. The
  // output budget is tiny because PROMPT EVALUATION dominates: even this ~150-token prompt costs
  // 115-240 s, so the pair has to fit inside the launcher's 540 s kill on a host whose throughput
  // sags under sustained load. A third probe does not fit, and the ~2K `LONG` packet is deliberately
  // not run at all — at the measured rate it alone needs 1,500 s or more, which IS the finding.
  await probe("A_tinyNoGrammar", `profile A: tiny prompt, NO grammar, ${threads} threads`, TINY, { grammar: false, maxTokens: 8, threads, batchSize: 512 });
  await probe("B_tinyGrammar", `profile B: tiny prompt, JSON grammar, ${threads} threads`, TINY, { grammar: true, maxTokens: 8, threads, batchSize: 512 });

  clearInterval(heartbeat);
  api.record("measurements", measurements);

  await api.step("profile: derive the split", () => {
    // Cardinality first: a derivation over a partly-missing set would quietly report nulls as "fine".
    const missing = ["A_tinyNoGrammar", "B_tinyGrammar"].filter((key) => !measurements[key]);
    if (missing.length > 0) throw new Error(`no derivation without every probe; missing ${missing.join(", ")}`);
    const a = measurements.A_tinyNoGrammar;
    const b = measurements.B_tinyGrammar;
    const decodeWithGrammar = b.decodeTokensPerSec;
    // The slower of the two prompt rates, so nothing downstream is projected from a lucky sample.
    const promptRates = [a.promptTokensPerSec, b.promptTokensPerSec].filter((rate): rate is number => typeof rate === "number");
    const promptTokensPerSec = promptRates.length > 0 ? Math.min(...promptRates) : null;
    const derived = {
      promptTokensPerSec,
      promptTokensPerSecNoGrammar: a.promptTokensPerSec,
      promptTokensPerSecWithGrammar: b.promptTokensPerSec,
      decodeTokensPerSecNoGrammar: a.decodeTokensPerSec,
      decodeTokensPerSecWithGrammar: decodeWithGrammar,
      /** >1 would mean the grammar made decoding slower. Compare it against `hostVarianceRatio`. */
      grammarDecodeSlowdown: a.decodeTokensPerSec && decodeWithGrammar ? +(a.decodeTokensPerSec / decodeWithGrammar).toFixed(2) : null,
      grammarTtftDeltaMs: b.firstTokenMs - a.firstTokenMs,
      /**
       * Two probes with the SAME prompt should evaluate it at the same rate, so their ratio is the
       * host's own run-to-run spread. When it exceeds `grammarDecodeSlowdown`, the grammar's effect
       * is smaller than the noise it is being measured against and no grammar claim is supportable.
       */
      hostVarianceRatio: promptRates.length === 2 ? +(Math.max(...promptRates) / Math.min(...promptRates)).toFixed(2) : null,
      // What the L1.8 locatorUpgrade packet costs end to end at the measured rates, the way
      // benchmark:ai-model evaluates it: prompt time plus the 192-token output cap.
      projectedLocatorUpgradeAtCapMs:
        promptTokensPerSec && decodeWithGrammar ? Math.round((2_000 / promptTokensPerSec) * 1000 + (192 / decodeWithGrammar) * 1000) : null,
      /** The floor the 192-token output cap alone imposes, even if the prompt were free. */
      outputCapAloneMs: decodeWithGrammar ? Math.round((192 / decodeWithGrammar) * 1000) : null,
      /**
       * The PRODUCT's own budget for one locator-upgrade provider call
       * (`LOCATOR_ATTEMPT_LIMITS`: 30 s, 3,000 data chars ≈ 800 prompt tokens, 512 output tokens).
       * This is the number the feature actually has to meet, and it is far tighter than L1.8's.
       */
      projectedProductCallMs:
        promptTokensPerSec && decodeWithGrammar ? Math.round((800 / promptTokensPerSec) * 1000 + (512 / decodeWithGrammar) * 1000) : null,
      productCallBudgetMs: 30_000
    };
    api.record("derived", derived);
    return derived;
  });

  await model.dispose().catch(() => undefined);
  await llama.dispose?.().catch(() => undefined);
}
