/**
 * AWKIT local-AI utility host (Phase L, L1.1). RAW, UNBUNDLED CommonJS.
 *
 * Runs as an Electron utilityProcess child and speaks only `src/ai/contracts/AiHostProtocol.ts` over
 * `process.parentPort`: structured clone, no TCP listener, no command line. It owns inference and
 * nothing else. It never decides what a prompt contains, never logs or persists a prompt or a
 * response, and never returns raw runtime text: failures are the stable, path-free reason codes below.
 *
 * Runtime: node-llama-cpp (llama.cpp), loaded lazily by the first `load` or `gpuPlan`. It is
 * resolved from this file's own module paths: `native-hosts/ai/node_modules` when staged, the
 * repository's `node_modules` in development. `build: "never"` means a missing or unusable prebuilt
 * binary is an error, never a download or a source build, so the host stays offline.
 *
 * Backend (L8a.3), fixed ONCE at fork by the manager, never per request: the CPU prebuilt (`gpu: false`,
 * no layer offloaded: CPU & RAM only), or Vulkan from the imported pack the main process verified byte
 * for byte immediately before forking (`AWKIT_AI_BACKEND_DIR`). node-llama-cpp finds a GPU prebuilt only
 * by importing its package name, so one resolve hook maps that single specifier into the pack; nothing
 * GPU is ever loaded from `node_modules`, `resources` or PATH.
 *
 * Like the Zvec host it is never bundled: native runtimes are shipped and versioned as one unit
 * beside the host, not pulled into an electron-vite chunk.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Mirrors src/ai/contracts/AiHostProtocol.ts and src/ai/AiOutputContract.ts. verify:ai-host-source
// reads both files and fails if any of these drift.
const PROTOCOL_VERSION = 1;
const AI_CONTEXT_TOKENS = 4096;
const AI_MAX_PROMPT_TOKENS = 3072;
const AI_MAX_OUTPUT_TOKENS = 512;
const MAX_SCHEMA_DEPTH = 6;

const AI_MAX_GPU_LAYERS = 1024;
const AI_MAX_VRAM_RESERVE_BYTES = 68719476736;

const MAX_THREADS = 16;
const MAX_PROPERTIES = 64;
const MAX_GRAMMAR_CACHE = 16;
const MAX_EARLY_CANCELS = 32;
const RUNTIME_PACKAGE = "node-llama-cpp";
const BINARY_PACKAGE = "@node-llama-cpp/win-x64";
const VULKAN_PACKAGE = "@node-llama-cpp/win-x64-vulkan";
const JOB_ID = /^[A-Za-z0-9._:#-]{1,160}$/;

/**
 * Qwen3.5 chat template with thinking disabled: the template's `enable_thinking: false` branch
 * pre-fills an EMPTY think block, so decoding starts at the answer. The JSON grammar then admits
 * nothing but the answer anyway.
 */
const TEMPLATE = Object.freeze({
  systemOpen: "<|im_start|>system\n",
  userOpen: "<|im_end|>\n<|im_start|>user\n",
  assistantOpen: "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"
});

/**
 * Fixed ONCE at process start from the environment the manager forks with, never per request, so no
 * single request can point the host at another directory (the Zvec host's rule).
 */
const MODEL_ROOT = process.env.AWKIT_AI_MODEL_ROOT ? path.resolve(process.env.AWKIT_AI_MODEL_ROOT) : null;
/** The same rule for the backend: anything but an explicit Vulkan fork is the CPU host. */
const BACKEND = process.env.AWKIT_AI_BACKEND === "vulkan" ? "vulkan" : "cpu";
const BACKEND_DIR = BACKEND === "vulkan" && process.env.AWKIT_AI_BACKEND_DIR ? path.resolve(process.env.AWKIT_AI_BACKEND_DIR) : null;

/** An error carrying a stable, path-free reason code that is safe to relay. */
class HostError extends Error {
  constructor(reason, retryable = false) {
    super(reason);
    this.reason = reason;
    this.retryable = retryable;
  }
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An integer inside [min, max], or null. Never clamps silently: a caller sending garbage is refused. */
function boundedInt(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function isStrictlyInside(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * The manager resolves the model path and the host re-verifies it, as the Zvec host does. Both the
 * lexical path and its real path must stay under the root, so a junction or symlink cannot escape.
 */
function confineModelPath(candidate) {
  if (!MODEL_ROOT || typeof candidate !== "string" || candidate.length === 0 || candidate.includes("\0")) {
    throw new HostError("AI_MODEL_PATH_OUTSIDE_ROOT");
  }
  const resolved = path.resolve(candidate);
  if (!isStrictlyInside(MODEL_ROOT, resolved) || path.extname(resolved).toLowerCase() !== ".gguf") {
    throw new HostError("AI_MODEL_PATH_OUTSIDE_ROOT");
  }
  let realFile;
  try {
    realFile = fs.realpathSync(resolved);
    if (!isStrictlyInside(fs.realpathSync(MODEL_ROOT), realFile)) throw new HostError("AI_MODEL_PATH_OUTSIDE_ROOT");
    if (!fs.statSync(realFile).isFile()) throw new HostError("AI_MODEL_LOAD_FAILED");
  } catch (error) {
    throw error instanceof HostError ? error : new HostError("AI_MODEL_LOAD_FAILED");
  }
  return realFile;
}

/** Node's own lookup order for this file, so hello reports the same install `import()` will load. */
function findPackageDir(name) {
  for (const dir of module.paths) {
    const candidate = path.join(dir, ...name.split("/"));
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
  }
  return null;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * The runtime identity, from package metadata only: cheap, and it never loads the native binary.
 * `build` is what the manifest pins (`AI_RUNTIME_PIN.build`). The CPU prebuilt must be present and
 * the same version as the JavaScript package, or the pairing is incompatible.
 */
function describeRuntime() {
  const packageDir = findPackageDir(RUNTIME_PACKAGE);
  const binaryDir = findPackageDir(BINARY_PACKAGE);
  const pkg = packageDir ? readJson(path.join(packageDir, "package.json")) : null;
  const release = packageDir ? readJson(path.join(packageDir, "llama", "binariesGithubRelease.json")) : null;
  const binary = binaryDir ? readJson(path.join(binaryDir, "package.json")) : null;
  if (!pkg || typeof pkg.version !== "string" || !release || typeof release.release !== "string") {
    return { build: null, binaryPresent: false, backendPresent: false };
  }
  const addon = binaryDir !== null && fs.existsSync(path.join(binaryDir, "bins", "win-x64", "llama-addon.node"));
  return {
    build: `${RUNTIME_PACKAGE}@${pkg.version}+llama.cpp@${release.release}`,
    binaryPresent: Boolean(binary && binary.version === pkg.version && addon),
    backendPresent: backendPresent(pkg.version)
  };
}

/**
 * The GPU pack this host was forked with is the pinned prebuilt for this exact runtime version. The
 * main process already verified every byte; this is the host's own shape check before it relies on it.
 */
function backendPresent(runtimeVersion) {
  if (BACKEND === "cpu") return true;
  if (!BACKEND_DIR) return false;
  const pkg = readJson(path.join(BACKEND_DIR, "package.json"));
  return Boolean(
    pkg &&
      pkg.name === VULKAN_PACKAGE &&
      pkg.version === runtimeVersion &&
      fs.existsSync(path.join(BACKEND_DIR, "dist", "index.js")) &&
      fs.existsSync(path.join(BACKEND_DIR, "bins", "win-x64-vulkan", "llama-addon.node"))
  );
}

let backendHooked = false;

/**
 * Map the one GPU prebuilt specifier to the verified pack's own entry (L8a.0's loader proof). The pack
 * computes its binaries directory from that file's location, so every GPU binary comes from the pack.
 */
function hookBackend() {
  if (BACKEND === "cpu" || backendHooked) return;
  const { register } = require("node:module");
  const { pathToFileURL } = require("node:url");
  if (!BACKEND_DIR || typeof register !== "function") throw new HostError("AI_GPU_BACKEND_UNAVAILABLE");
  const target = pathToFileURL(path.join(BACKEND_DIR, "dist", "index.js")).href;
  const hook =
    "export async function resolve(specifier, context, next) { return specifier === " +
    JSON.stringify(VULKAN_PACKAGE) +
    " ? { url: " +
    JSON.stringify(target) +
    ", shortCircuit: true } : next(specifier, context); }";
  register(`data:text/javascript,${encodeURIComponent(hook)}`);
  backendHooked = true;
}

/**
 * Translate the bounded output schema (`AiOutputSchema`, `isBoundedSchema`) into node-llama-cpp's
 * grammar subset. Anything outside the bounded subset is refused, so unconstrained generation can
 * never be requested by sending an empty or odd schema. The grammar has no numeric bounds, so
 * `minimum`/`maximum` are dropped here and enforced by `parseAiOutput` after decoding.
 */
function toGrammarSchema(schema, depth) {
  const refuse = () => {
    throw new HostError("AI_SCHEMA_REQUIRED");
  };
  if (depth > MAX_SCHEMA_DEPTH || !isPlainObject(schema)) refuse();
  switch (schema.type) {
    case "object": {
      if (schema.additionalProperties !== false || !isPlainObject(schema.properties)) refuse();
      const keys = Object.keys(schema.properties);
      if (keys.length > MAX_PROPERTIES) refuse();
      const required = schema.required === undefined ? [] : schema.required;
      if (!Array.isArray(required) || !required.every((key) => typeof key === "string" && keys.includes(key))) refuse();
      const properties = {};
      for (const key of keys) properties[key] = toGrammarSchema(schema.properties[key], depth + 1);
      return { type: "object", properties, required: [...required], additionalProperties: false };
    }
    case "array": {
      if (!Number.isInteger(schema.maxItems) || schema.maxItems < 0) refuse();
      const grammar = { type: "array", items: toGrammarSchema(schema.items, depth + 1), maxItems: schema.maxItems };
      if (schema.minItems !== undefined) {
        if (!Number.isInteger(schema.minItems) || schema.minItems < 0 || schema.minItems > schema.maxItems) refuse();
        grammar.minItems = schema.minItems;
      }
      return grammar;
    }
    case "string":
      if (Array.isArray(schema.enum)) {
        if (schema.enum.length === 0 || !schema.enum.every((value) => typeof value === "string")) refuse();
        return { enum: [...schema.enum] };
      }
      if (!Number.isInteger(schema.maxLength) || schema.maxLength < 0) refuse();
      return { type: "string", maxLength: schema.maxLength };
    case "integer":
    case "number":
      return { type: schema.type };
    case "boolean":
      return { type: "boolean" };
    default:
      return refuse();
  }
}

// ── Runtime state ────────────────────────────────────────────────────────────────────────────────

let runtimePromise = null;
let llama = null;
/** { model, context, sequence, completion, contextSize } while a model is loaded. */
let loaded = null;
/** The one inference in flight: { jobId, controller }. */
let active = null;
const grammars = new Map();
/** Cancels that arrived before their job started (the job was still queued behind other work). */
const earlyCancels = new Set();

function runtimeModule() {
  runtimePromise ??= import(RUNTIME_PACKAGE).catch(() => {
    runtimePromise = null;
    throw new HostError("AI_MODEL_LOAD_FAILED");
  });
  return runtimePromise;
}

/**
 * The one runtime instance, on this host's backend. A Vulkan host that cannot bind a usable device is
 * AI_GPU_NO_USABLE_DEVICE (node-llama-cpp reports "no visible device" as a missing binary, L8a.0).
 */
async function ensureLlama(threads) {
  if (llama) return llama;
  hookBackend();
  const runtime = await runtimeModule();
  let instance;
  try {
    instance = await runtime.getLlama({
      gpu: BACKEND === "vulkan" ? "vulkan" : false,
      build: "never",
      skipDownload: true,
      progressLogs: false,
      logLevel: runtime.LlamaLogLevel.disabled,
      logger: () => undefined,
      maxThreads: threads
    });
  } catch {
    throw new HostError(BACKEND === "vulkan" ? "AI_GPU_NO_USABLE_DEVICE" : "AI_MODEL_LOAD_FAILED");
  }
  if (BACKEND === "vulkan" && (instance.gpu !== "vulkan" || instance.supportsGpuOffloading !== true)) {
    await instance.dispose().catch(() => undefined);
    throw new HostError("AI_GPU_NO_USABLE_DEVICE");
  }
  llama = instance;
  return llama;
}

async function releaseModel() {
  const current = loaded;
  loaded = null;
  grammars.clear();
  if (!current) return;
  await current.context.dispose().catch(() => undefined);
  await current.model.dispose().catch(() => undefined);
}

async function grammarFor(schema) {
  const key = JSON.stringify(schema);
  const cached = grammars.get(key);
  if (cached) return cached;
  const grammar = await llama.createGrammarForJsonSchema(schema);
  if (grammars.size >= MAX_GRAMMAR_CACHE) grammars.delete(grammars.keys().next().value);
  grammars.set(key, grammar);
  return grammar;
}

/**
 * Only the fixed template is tokenized with special tokens enabled. The system and user text are
 * plain strings, so page text containing `<|im_end|>` stays literal text and cannot close its turn.
 */
function chatPrompt(runtime, system, user) {
  const { LlamaText, SpecialTokensText } = runtime;
  return LlamaText([
    new SpecialTokensText(TEMPLATE.systemOpen),
    system,
    new SpecialTokensText(TEMPLATE.userOpen),
    user,
    new SpecialTokensText(TEMPLATE.assistantOpen)
  ]);
}

function cancelledResult(promptTokens, outputTokens, started, firstTokenAt) {
  const now = performance.now();
  return {
    text: "",
    promptTokens,
    outputTokens,
    stopReason: "cancelled",
    timings: {
      promptMs: Math.round((firstTokenAt ?? now) - started),
      generationMs: firstTokenAt === null ? 0 : Math.round(now - firstTokenAt),
      firstTokenMs: firstTokenAt === null ? 0 : Math.round(firstTokenAt - started)
    }
  };
}

// ── Handlers ─────────────────────────────────────────────────────────────────────────────────────

function hello(req) {
  const runtime = describeRuntime();
  const expected = isPlainObject(req.expected) ? req.expected : {};
  return {
    protocolVersion: PROTOCOL_VERSION,
    compatible:
      expected.protocolVersion === PROTOCOL_VERSION &&
      process.platform === "win32" &&
      process.arch === "x64" &&
      runtime.build !== null &&
      runtime.binaryPresent &&
      runtime.backendPresent,
    runtime: { name: "llama.cpp", build: runtime.build ?? "unavailable" },
    backend: BACKEND,
    platform: process.platform,
    arch: process.arch
  };
}

/**
 * CPU & RAM only is the CPU backend with no layer offloaded. A GPU host always offloads at least one
 * layer: Vulkan with none still puts the whole context in VRAM (L8a.0), so it is never a CPU mode.
 */
function requestedGpuLayers(value) {
  if (BACKEND === "vulkan") return boundedInt(value, 1, AI_MAX_GPU_LAYERS);
  return value === undefined || value === 0 ? 0 : null;
}

async function load(req) {
  const modelPath = confineModelPath(req.modelPath);
  const contextSize = boundedInt(req.contextTokens, 256, AI_CONTEXT_TOKENS);
  const threads = boundedInt(req.threads, 1, MAX_THREADS);
  const gpuLayers = requestedGpuLayers(req.gpuLayers);
  if (contextSize === null || threads === null || gpuLayers === null) throw new HostError("AI_PROTOCOL_VIOLATION");
  const started = performance.now();
  await releaseModel();
  const runtime = await runtimeModule();
  const instance = await ensureLlama(threads);
  let model = null;
  try {
    model = await instance.loadModel({ modelPath, gpuLayers, useMmap: true, useMlock: false });
    const context = await model.createContext({ contextSize, threads, batchSize: Math.min(512, contextSize), sequences: 1 });
    const sequence = context.getSequence();
    loaded = {
      model,
      context,
      sequence,
      completion: new runtime.LlamaCompletion({ contextSequence: sequence }),
      contextSize
    };
  } catch {
    if (model) await model.dispose().catch(() => undefined);
    throw new HostError(BACKEND === "vulkan" ? "AI_GPU_LOAD_FAILED" : "AI_MODEL_LOAD_FAILED");
  }
  return {
    loadMs: Math.round(performance.now() - started),
    backend: BACKEND,
    gpuLayers: BACKEND === "vulkan" && Number.isInteger(model.gpuLayers) ? model.gpuLayers : 0
  };
}

/**
 * The offload plan, from the runtime's own measurement (L8a.0: its estimates matched measured VRAM
 * within 0.1 MB): the devices it binds, free VRAM, and the model and context estimates per layer count.
 * The largest count whose estimate fits beside the reserve is reported; the main process decides what
 * a mode does with it. Plans with this host's own model released, so free VRAM is not understated.
 */
async function gpuPlan(req) {
  if (BACKEND !== "vulkan") throw new HostError("AI_PROTOCOL_VIOLATION");
  const modelPath = confineModelPath(req.modelPath);
  const contextSize = boundedInt(req.contextTokens, 256, AI_CONTEXT_TOKENS);
  const threads = boundedInt(req.threads, 1, MAX_THREADS);
  const reserve = req.reserveBytes === null ? null : boundedInt(req.reserveBytes, 0, AI_MAX_VRAM_RESERVE_BYTES);
  if (contextSize === null || threads === null || (req.reserveBytes !== null && reserve === null)) throw new HostError("AI_PROTOCOL_VIOLATION");
  await releaseModel();
  const runtime = await runtimeModule();
  const instance = await ensureLlama(threads);
  let deviceCount;
  let vram;
  try {
    deviceCount = (await instance.getGpuDeviceNames()).length;
    vram = await instance.getVramState();
  } catch {
    throw new HostError("AI_GPU_NO_USABLE_DEVICE");
  }
  if (!(deviceCount >= 1) || !(vram.total > 0)) throw new HostError("AI_GPU_NO_USABLE_DEVICE");
  try {
    const insights = await runtime.GgufInsights.from(await runtime.readGgufFileInfo(modelPath), instance);
    const totalLayers = insights.totalLayers;
    if (boundedInt(totalLayers, 1, AI_MAX_GPU_LAYERS) === null) throw new Error("layers");
    const reserveBytes = reserve ?? Math.max(0, Math.round(instance.vramPaddingSize));
    const need = async (layers) => {
      const weights = await insights.estimateModelResourceRequirementsV2({ gpuLayers: layers, useMmap: true, gpuSupportsMmap: instance.gpuSupportsMmap });
      const context = await insights.estimateContextResourceRequirementsV2({ contextSize, modelGpuLayers: layers, batchSize: Math.min(512, contextSize), sequences: 1 });
      return weights.gpuVram + context.gpuVram;
    };
    const fits = async (layers) => (await need(layers)) + reserveBytes <= vram.free;
    const fullRequiredBytes = Math.round(await need(totalLayers));
    let fitLayers = totalLayers;
    if (fullRequiredBytes + reserveBytes > vram.free) {
      // The need grows with the layer count, so bisect: each estimate costs about a second on a real
      // model, and a linear scan took 45 s to find that nothing fits (L8a.3). 0 means none fits.
      let low = 0;
      let high = totalLayers - 1;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (await fits(middle)) low = middle;
        else high = middle - 1;
      }
      fitLayers = low;
    }
    return { deviceCount, totalLayers, fitLayers, fullRequiredBytes, reserveBytes, freeBytes: vram.free, totalBytes: vram.total };
  } catch {
    throw new HostError("AI_MODEL_LOAD_FAILED");
  }
}

async function infer(req) {
  if (!loaded) throw new HostError("AI_MODEL_NOT_LOADED");
  if (!isPlainObject(req.jsonSchema)) throw new HostError("AI_SCHEMA_REQUIRED");
  if (req.thinking !== false) throw new HostError("AI_PROTOCOL_VIOLATION");
  if (typeof req.jobId !== "string" || !JOB_ID.test(req.jobId) || typeof req.system !== "string" || typeof req.user !== "string") {
    throw new HostError("AI_PROTOCOL_VIOLATION");
  }
  const maxPromptTokens = boundedInt(req.maxPromptTokens, 1, AI_MAX_PROMPT_TOKENS);
  const maxOutputTokens = boundedInt(req.maxOutputTokens, 1, AI_MAX_OUTPUT_TOKENS);
  const seed = boundedInt(req.seed, 0, 2 ** 31 - 1);
  const temperature = typeof req.temperature === "number" && req.temperature >= 0 && req.temperature <= 2 ? req.temperature : null;
  if (maxPromptTokens === null || maxOutputTokens === null || seed === null || temperature === null) {
    throw new HostError("AI_PROTOCOL_VIOLATION");
  }
  const grammarSchema = toGrammarSchema(req.jsonSchema, 0);
  const runtime = await runtimeModule();
  const current = loaded;
  if (!current) throw new HostError("AI_MODEL_NOT_LOADED");
  const tokens = chatPrompt(runtime, req.system, req.user).tokenize(current.model.tokenizer);
  if (tokens.length > maxPromptTokens || tokens.length + maxOutputTokens > current.contextSize) {
    throw new HostError("AI_PROMPT_TOO_LONG");
  }

  const started = performance.now();
  let firstTokenAt = null;
  let outputTokens = 0;
  if (earlyCancels.delete(req.jobId)) return cancelledResult(tokens.length, 0, started, null);
  const controller = new AbortController();
  active = { jobId: req.jobId, controller };
  try {
    const grammar = await grammarFor(grammarSchema);
    await current.sequence.clearHistory();
    const { response, metadata } = await current.completion.generateCompletionWithMeta(tokens, {
      grammar,
      maxTokens: maxOutputTokens,
      signal: controller.signal,
      stopOnAbortSignal: false,
      temperature,
      seed,
      onToken(chunk) {
        if (firstTokenAt === null) firstTokenAt = performance.now();
        outputTokens += chunk.length;
      }
    });
    if (metadata.stopReason === "abort") return cancelledResult(tokens.length, outputTokens, started, firstTokenAt);
    const finished = performance.now();
    return {
      text: response,
      promptTokens: tokens.length,
      outputTokens,
      stopReason: metadata.stopReason === "maxTokens" ? "length" : "stop",
      timings: {
        promptMs: Math.round((firstTokenAt ?? finished) - started),
        generationMs: firstTokenAt === null ? 0 : Math.round(finished - firstTokenAt),
        firstTokenMs: firstTokenAt === null ? 0 : Math.round(firstTokenAt - started)
      }
    };
  } catch {
    if (controller.signal.aborted) return cancelledResult(tokens.length, outputTokens, started, firstTokenAt);
    throw new HostError("AI_INFERENCE_FAILED");
  } finally {
    active = null;
  }
}

/** Immediate, never queued: it must reach an inference that is running. */
function cancel(req) {
  if (typeof req.jobId !== "string" || !JOB_ID.test(req.jobId)) throw new HostError("AI_PROTOCOL_VIOLATION");
  if (active && active.jobId === req.jobId) {
    active.controller.abort();
    return { cancelled: true };
  }
  if (earlyCancels.size >= MAX_EARLY_CANCELS) earlyCancels.delete(earlyCancels.values().next().value);
  earlyCancels.add(req.jobId);
  return { cancelled: false };
}

async function unload() {
  await releaseModel();
  return { unloaded: true };
}

async function shutdown() {
  await releaseModel();
  const instance = llama;
  llama = null;
  if (instance) await instance.dispose().catch(() => undefined);
  return { shutdown: true };
}

// ── Dispatch ─────────────────────────────────────────────────────────────────────────────────────

const IMMEDIATE = new Map([
  ["hello", hello],
  ["cancel", cancel]
]);
// Handled strictly in arrival order, which `AiService` relies on (an unload can never land after
// the load that follows it).
const SERIAL = new Map([
  ["load", load],
  ["gpuPlan", gpuPlan],
  ["infer", infer],
  ["unload", unload],
  ["shutdown", shutdown]
]);

let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(fn);
  chain = run.catch(() => undefined);
  return run;
}

function reply(message) {
  try {
    process.parentPort.postMessage(message);
  } catch {
    /* the parent is gone; the process is about to be reaped */
  }
}

if (!process.parentPort) {
  // Refuse to run as a standalone command; the host is only ever a utilityProcess child.
  process.exit(2);
}

process.parentPort.on("message", (event) => {
  const req = event.data;
  if (!isPlainObject(req) || req.version !== PROTOCOL_VERSION || typeof req.id !== "string" || typeof req.type !== "string") {
    reply({
      version: PROTOCOL_VERSION,
      id: isPlainObject(req) && typeof req.id === "string" ? req.id : "unknown",
      ok: false,
      reason: "AI_PROTOCOL_VIOLATION",
      retryable: false
    });
    return;
  }
  const immediate = IMMEDIATE.get(req.type);
  const queued = SERIAL.get(req.type);
  if (!immediate && !queued) {
    reply({ version: PROTOCOL_VERSION, id: req.id, ok: false, reason: "AI_UNKNOWN_REQUEST", retryable: false });
    return;
  }
  // Shutdown must not wait behind a running inference.
  if (req.type === "shutdown" && active) active.controller.abort();
  const run = immediate ? Promise.resolve().then(() => immediate(req)) : serial(() => queued(req));
  run.then(
    (value) => {
      reply({ version: PROTOCOL_VERSION, id: req.id, ok: true, value });
      if (req.type === "shutdown") process.exit(0);
    },
    (error) => {
      const known = error instanceof HostError;
      reply({
        version: PROTOCOL_VERSION,
        id: req.id,
        ok: false,
        reason: known ? error.reason : "AI_HOST_INTERNAL_ERROR",
        retryable: known ? error.retryable : false
      });
    }
  );
});

reply({ version: PROTOCOL_VERSION, type: "ready", pid: process.pid });
