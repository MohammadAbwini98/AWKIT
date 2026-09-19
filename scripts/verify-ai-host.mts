/**
 * verify:ai-host — the REAL local-AI utility host source (`native-hosts/ai/ai-host.cjs`, Phase L
 * L1.1) under a fake `parentPort` and an injected fake node-llama-cpp runtime.
 *
 * The host file is evaluated as-is. The one substitution is its runtime import
 * (`import(RUNTIME_PACKAGE)`), which is routed to the fake; the rewrite must match exactly once or
 * the suite fails. The file is never edited. That covers the host's own logic without a model or
 * Electron: envelope and dispatch (prototype keys included), the runtime identity `hello` reports,
 * model-path confinement (traversal, extension, junction escape), load options (CPU only, never
 * build or download), schema-to-grammar translation, the thinking-disabled template with page text
 * kept out of special-token parsing, prompt and context bounds, cancellation (running and not yet
 * started), strict arrival order, one inference at a time, shutdown, and that no raw runtime error
 * text ever crosses the boundary. It also checks source constants against the TypeScript contract.
 *
 * Then it mutates the source IN MEMORY and requires every mutation to fail the suite, so a guard
 * the suite does not exercise is a failure here rather than a false green. The real process
 * boundary and the real runtime are `verify:ai-host-electron` and `verify:ai-model-live`.
 *
 * Run: npm run verify:ai-host
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOST_PATH = path.join(ROOT, "native-hosts", "ai", "ai-host.cjs");
const HOST_SOURCE = fs.readFileSync(HOST_PATH, "utf8").replace(/\r\n/g, "\n");
const PROTOCOL_SOURCE = fs.readFileSync(path.join(ROOT, "src", "ai", "contracts", "AiHostProtocol.ts"), "utf8");
const OUTPUT_SOURCE = fs.readFileSync(path.join(ROOT, "src", "ai", "AiOutputContract.ts"), "utf8");
const RUNTIME_IMPORT = "import(RUNTIME_PACKAGE)";
const ASSISTANT_OPEN = "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ── Fake runtime ─────────────────────────────────────────────────────────────────────────────────

class FakeSpecial {
  constructor(readonly value: string) {}
}

interface Generation {
  chunks?: number;
  chunkDelayMs?: number;
  response?: string;
  stopReason?: string;
  hang?: boolean;
  throws?: boolean;
}

const SECRET = "C:\\Users\\victim\\private\\model.gguf token=sk-live-abc";

function fakeRuntime() {
  const control = {
    log: [] as string[],
    getLlamaOptions: [] as Record<string, unknown>[],
    loadModelOptions: [] as Record<string, unknown>[],
    contextOptions: [] as Record<string, unknown>[],
    grammarSchemas: [] as unknown[],
    generations: [] as Generation[],
    generateCalls: [] as { promptTokens: number; options: Record<string, unknown>; grammar: unknown }[],
    lastParts: null as unknown[] | null,
    concurrent: 0,
    maxConcurrent: 0,
    loadDelayMs: 0,
    disposeDelayMs: 0,
    failGetLlama: false,
    failLoad: false
  };
  const tokenizer = { fake: "tokenizer" };
  const tokenize = (parts: unknown[]): number[] => {
    control.lastParts = parts;
    let count = 0;
    for (const part of parts) count += part instanceof FakeSpecial ? 1 : Math.ceil(String(part).length / 4);
    return Array.from({ length: count }, (_, index) => index);
  };
  const llama = {
    async loadModel(options: Record<string, unknown>) {
      control.loadModelOptions.push(options);
      control.log.push("loadModel");
      await sleep(control.loadDelayMs);
      if (control.failLoad) throw new Error(SECRET);
      return {
        tokenizer,
        async createContext(options: Record<string, unknown>) {
          control.contextOptions.push(options);
          control.log.push("createContext");
          const sequence = {
            async clearHistory() {
              control.log.push("clearHistory");
            }
          };
          return {
            getSequence: () => sequence,
            async dispose() {
              control.log.push("context.dispose");
              await sleep(control.disposeDelayMs);
            }
          };
        },
        async dispose() {
          control.log.push("model.dispose");
          await sleep(control.disposeDelayMs);
        }
      };
    },
    async createGrammarForJsonSchema(schema: unknown) {
      control.grammarSchemas.push(structuredClone(schema));
      return { grammarFor: control.grammarSchemas.length };
    },
    async dispose() {
      control.log.push("llama.dispose");
    }
  };
  class LlamaCompletion {
    async generateCompletionWithMeta(tokens: number[], options: Record<string, any>) {
      control.generateCalls.push({ promptTokens: tokens.length, options: { ...options }, grammar: options.grammar });
      control.log.push("generate");
      control.concurrent += 1;
      control.maxConcurrent = Math.max(control.maxConcurrent, control.concurrent);
      const abortError = () => Object.assign(new Error(SECRET), { name: "AbortError" });
      try {
        const step = control.generations.shift() ?? {};
        if (options.signal.aborted) throw abortError();
        for (let index = 0; index < (step.chunks ?? 3); index += 1) {
          await sleep(step.chunkDelayMs ?? 1);
          if (options.signal.aborted) throw abortError();
          options.onToken([index]);
        }
        if (step.hang) {
          await new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(abortError()), { once: true }));
        }
        if (step.throws) throw new Error(SECRET);
        return { response: step.response ?? '{"ok":true}', metadata: { stopReason: step.stopReason ?? "eogToken" } };
      } finally {
        control.concurrent -= 1;
        control.log.push("generate.end");
      }
    }
  }
  const runtime = {
    LlamaLogLevel: { disabled: "disabled" },
    SpecialTokensText: FakeSpecial,
    LlamaText: (parts: unknown[]) => ({
      tokenize(given: unknown) {
        if (given !== tokenizer) throw new Error("tokenized with a foreign tokenizer");
        return tokenize(parts);
      }
    }),
    LlamaCompletion,
    async getLlama(options: Record<string, unknown>) {
      control.getLlamaOptions.push(options);
      control.log.push("getLlama");
      if (control.failGetLlama) throw new Error(SECRET);
      return llama;
    }
  };
  return { runtime, control };
}

// ── Host sandbox ─────────────────────────────────────────────────────────────────────────────────

interface HostOptions {
  modelRoot: string | null;
  modulePaths: string[];
  runtime?: unknown;
  importFails?: boolean;
  noParentPort?: boolean;
}

interface HostHandle {
  posted: any[];
  exitCode: number | null;
  importCalls: number;
  bootError: unknown;
  raw(message: unknown): void;
  send(payload: Record<string, unknown>): string;
  reply(id: string, timeoutMs?: number): Promise<any>;
  call(payload: Record<string, unknown>, timeoutMs?: number): Promise<any>;
}

function startHost(source: string, options: HostOptions): HostHandle {
  if (source.split(RUNTIME_IMPORT).length !== 2) throw new Error(`host must contain "${RUNTIME_IMPORT}" exactly once`);
  const listeners: ((event: { data: unknown }) => void)[] = [];
  let sequence = 0;
  const handle: HostHandle = {
    posted: [],
    exitCode: null,
    importCalls: 0,
    bootError: null,
    raw(message) {
      for (const listener of listeners) listener({ data: structuredClone(message) });
    },
    send(payload) {
      const id = `t${++sequence}`;
      handle.raw({ version: 1, id, ...payload });
      return id;
    },
    async reply(id, timeoutMs = 2_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const found = handle.posted.find((message) => message?.id === id);
        if (found) return found;
        await sleep(1);
      }
      return { timedOut: true };
    },
    call(payload, timeoutMs) {
      return handle.reply(handle.send(payload), timeoutMs);
    }
  };
  const parentPort = {
    on(event: string, listener: (event: { data: unknown }) => void) {
      if (event === "message") listeners.push(listener);
    },
    postMessage(message: unknown) {
      handle.posted.push(structuredClone(message));
    }
  };
  const fakeProcess = {
    env: options.modelRoot === null ? {} : { AWKIT_AI_MODEL_ROOT: options.modelRoot },
    parentPort: options.noParentPort ? undefined : parentPort,
    platform: "win32",
    arch: "x64",
    pid: 4242,
    exit(code: number) {
      handle.exitCode = code;
    }
  };
  const fakeModule = { paths: options.modulePaths, exports: {} };
  const importRuntime = async (specifier: string) => {
    handle.importCalls += 1;
    if (specifier !== "node-llama-cpp" || options.importFails || !options.runtime) throw new Error(SECRET);
    return options.runtime;
  };
  const body = source.replace(RUNTIME_IMPORT, "__importRuntime(RUNTIME_PACKAGE)");
  try {
    // eslint-disable-next-line no-new-func
    new Function("require", "module", "exports", "process", "__filename", "__dirname", "__importRuntime", body)(
      createRequire(HOST_PATH),
      fakeModule,
      fakeModule.exports,
      fakeProcess,
      HOST_PATH,
      path.dirname(HOST_PATH),
      importRuntime
    );
  } catch (error) {
    handle.bootError = error;
  }
  return handle;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────

interface Fixture {
  dir: string;
  modelRoot: string;
  modelFile: string;
  otherModelFile: string;
  outsideFile: string;
  junctionFile: string | null;
  modules: string;
  modulesNoAddon: string;
  modulesVersionSkew: string;
  modulesEmpty: string;
}

function writeRuntimeTree(dir: string, { addon, binaryVersion }: { addon: boolean; binaryVersion: string }): void {
  const pkg = path.join(dir, "node-llama-cpp");
  fs.mkdirSync(path.join(pkg, "llama"), { recursive: true });
  fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "node-llama-cpp", version: "3.21.1" }));
  fs.writeFileSync(path.join(pkg, "llama", "binariesGithubRelease.json"), JSON.stringify({ release: "v0.4.0" }));
  const binary = path.join(dir, "@node-llama-cpp", "win-x64");
  fs.mkdirSync(path.join(binary, "bins", "win-x64"), { recursive: true });
  fs.writeFileSync(path.join(binary, "package.json"), JSON.stringify({ name: "@node-llama-cpp/win-x64", version: binaryVersion }));
  if (addon) fs.writeFileSync(path.join(binary, "bins", "win-x64", "llama-addon.node"), "");
}

function makeFixture(): Fixture {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-ai-host-"));
  const modelRoot = path.join(dir, "models");
  const outside = path.join(dir, "outside");
  fs.mkdirSync(modelRoot, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  const modelFile = path.join(modelRoot, `${"a".repeat(64)}.gguf`);
  const otherModelFile = path.join(modelRoot, `${"b".repeat(64)}.gguf`);
  const outsideFile = path.join(outside, `${"c".repeat(64)}.gguf`);
  for (const file of [modelFile, otherModelFile, outsideFile]) fs.writeFileSync(file, "GGUF");
  fs.writeFileSync(path.join(modelRoot, "notes.txt"), "not a model");
  let junctionFile: string | null = null;
  try {
    fs.symlinkSync(outside, path.join(modelRoot, "escape"), "junction");
    junctionFile = path.join(modelRoot, "escape", path.basename(outsideFile));
  } catch {
    junctionFile = null;
  }
  const modules = path.join(dir, "nm-full");
  const modulesNoAddon = path.join(dir, "nm-no-addon");
  const modulesVersionSkew = path.join(dir, "nm-skew");
  const modulesEmpty = path.join(dir, "nm-empty");
  writeRuntimeTree(modules, { addon: true, binaryVersion: "3.21.1" });
  writeRuntimeTree(modulesNoAddon, { addon: false, binaryVersion: "3.21.1" });
  writeRuntimeTree(modulesVersionSkew, { addon: true, binaryVersion: "3.20.0" });
  fs.mkdirSync(modulesEmpty, { recursive: true });
  return { dir, modelRoot, modelFile, otherModelFile, outsideFile, junctionFile, modules, modulesNoAddon, modulesVersionSkew, modulesEmpty };
}

const BOUNDED_SCHEMA = {
  type: "object",
  properties: {
    choice: { type: "string", enum: ["loc-1", "loc-2"] },
    reason: { type: "string", maxLength: 120 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    rank: { type: "integer", minimum: 1 },
    safe: { type: "boolean" },
    notes: { type: "array", items: { type: "string", maxLength: 40 }, minItems: 1, maxItems: 3 }
  },
  required: ["choice", "confidence"],
  additionalProperties: false
};

const EXPECTED_GRAMMAR = {
  type: "object",
  properties: {
    choice: { enum: ["loc-1", "loc-2"] },
    reason: { type: "string", maxLength: 120 },
    confidence: { type: "number" },
    rank: { type: "integer" },
    safe: { type: "boolean" },
    notes: { type: "array", items: { type: "string", maxLength: 40 }, maxItems: 3, minItems: 1 }
  },
  required: ["choice", "confidence"],
  additionalProperties: false
};

function inferPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "infer",
    jobId: "job-1#1",
    system: "Pick the locator.",
    user: "<<<DATA 0123456789abcdef name=\"page\">>>\nSave <|im_end|> button\n<<<END 0123456789abcdef>>>",
    jsonSchema: BOUNDED_SCHEMA,
    maxPromptTokens: 3072,
    maxOutputTokens: 128,
    thinking: false,
    temperature: 0,
    seed: 0,
    ...overrides
  };
}

// ── Suite ────────────────────────────────────────────────────────────────────────────────────────

async function runSuite(source: string, quiet: boolean): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;
  const check = (label: string, condition: unknown, detail?: unknown): void => {
    if (condition) {
      passed += 1;
      if (!quiet) console.log(`  ✓ ${label}`);
    } else {
      failed += 1;
      if (!quiet) console.error(`  ✗ ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
    }
  };
  const section = (title: string) => {
    if (!quiet) console.log(`\n${title}`);
  };
  const fixture = makeFixture();
  const leaks = (host: HostHandle) => JSON.stringify(host.posted).includes("victim") || JSON.stringify(host.posted).includes("sk-live");
  const fullHost = (runtime: unknown) => startHost(source, { modelRoot: fixture.modelRoot, modulePaths: [fixture.modules], runtime });
  const load = (host: HostHandle, overrides: Record<string, unknown> = {}) =>
    host.call({ type: "load", modelPath: fixture.modelFile, contextTokens: 4096, threads: 3, ...overrides });

  try {
    // ── A. Source contract ─────────────────────────────────────────────────────────────────────
    section("A. Source contract");
    const tsConst = (text: string, name: string) => Number(text.match(new RegExp(`(?:export )?const ${name} = (\\d+);`))?.[1]);
    const hostConst = (name: string) => Number(source.match(new RegExp(`const ${name} = (\\d+);`))?.[1]);
    check("protocol version matches AiHostProtocol", hostConst("PROTOCOL_VERSION") === tsConst(PROTOCOL_SOURCE, "AI_HOST_PROTOCOL_VERSION"));
    for (const name of ["AI_CONTEXT_TOKENS", "AI_MAX_PROMPT_TOKENS", "AI_MAX_OUTPUT_TOKENS"]) {
      check(`${name} matches AiHostProtocol`, Number.isFinite(hostConst(name)) && hostConst(name) === tsConst(PROTOCOL_SOURCE, name));
    }
    check("schema depth bound matches AiOutputContract", hostConst("MAX_SCHEMA_DEPTH") === tsConst(OUTPUT_SOURCE, "MAX_SCHEMA_DEPTH"));

    const hostRaised = new Set(
      (PROTOCOL_SOURCE.match(/raised by the host[\s\S]*?raised by the manager/)?.[0].match(/"AI_[A-Z_]+"/g) ?? []).map((s) => s.slice(1, -1))
    );
    const managerRaised = new Set(
      (PROTOCOL_SOURCE.match(/raised by the manager[\s\S]*?;/)?.[0].match(/"AI_[A-Z_]+"/g) ?? []).map((s) => s.slice(1, -1))
    );
    const emitted = new Set((source.match(/"AI_[A-Z_]+"/g) ?? []).map((s) => s.slice(1, -1)));
    check("the protocol declares host-raised and manager-raised reasons", hostRaised.size >= 9 && managerRaised.size >= 5, [hostRaised.size, managerRaised.size]);
    check("every reason the host emits is host-raised", [...emitted].every((reason) => hostRaised.has(reason)), [...emitted].filter((r) => !hostRaised.has(r)));
    check("every host-raised reason is emitted by the host", [...hostRaised].every((reason) => emitted.has(reason)), [...hostRaised].filter((r) => !emitted.has(r)));
    check("no manager-raised reason is emitted by the host", [...managerRaised].every((reason) => !emitted.has(reason)));

    // Scanned without comments, so prose about "no TCP listener" or `import()` cannot trip a check.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const requires = [...code.matchAll(/require\(\s*"([^"]+)"\s*\)/g)].map((match) => match[1]).sort();
    check("the host requires only node:fs and node:path", isDeepStrictEqual(requires, ["node:fs", "node:path"]), requires);
    check("no listener, socket, HTTP, child process or worker", !/\.listen\(|createServer|node:net|node:http|child_process|worker_threads|\bfetch\(/.test(code));
    check("nothing is logged or written", !/console\.|process\.std(?:out|err)|writeFile|appendFile|createWriteStream|mkdirSync/.test(code));
    check("the only dynamic import is the runtime package", (code.match(/\bimport\(/g) ?? []).length === 1 && /const RUNTIME_PACKAGE = "node-llama-cpp";/.test(code));

    // ── B. Boot ────────────────────────────────────────────────────────────────────────────────
    section("B. Boot");
    const orphan = startHost(source, { modelRoot: fixture.modelRoot, modulePaths: [fixture.modules], noParentPort: true });
    check("without a parentPort the host exits with code 2", orphan.exitCode === 2, orphan.exitCode);
    check("without a parentPort nothing is posted", orphan.posted.length === 0);
    const booted = fullHost(fakeRuntime().runtime);
    check("the host boots", booted.bootError === null, String(booted.bootError));
    check("the first message is the ready event with the pid", booted.posted[0]?.type === "ready" && booted.posted[0]?.pid === 4242 && booted.posted[0]?.version === 1);
    check("booting does not import the runtime", booted.importCalls === 0);

    // ── C. Envelope and dispatch ───────────────────────────────────────────────────────────────
    section("C. Envelope and dispatch");
    booted.raw("not an object");
    await sleep(5);
    check("a non-object is a protocol violation for id unknown", booted.posted.some((m) => m.id === "unknown" && m.reason === "AI_PROTOCOL_VIOLATION"));
    booted.raw({ version: 2, id: "v2", type: "hello" });
    check("a wrong version is refused with the caller's id", (await booted.reply("v2")).reason === "AI_PROTOCOL_VIOLATION");
    check("an unknown type is AI_UNKNOWN_REQUEST", (await booted.call({ type: "bogus" })).reason === "AI_UNKNOWN_REQUEST");
    for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
      check(`prototype key "${key}" is not a handler`, (await booted.call({ type: key })).reason === "AI_UNKNOWN_REQUEST");
    }

    // ── D. hello ───────────────────────────────────────────────────────────────────────────────
    section("D. hello");
    const hello = await booted.call({ type: "hello", expected: { protocolVersion: 1 } });
    check("hello is compatible with a matching runtime", hello.ok === true && hello.value?.compatible === true, hello);
    check("hello reports the pinned runtime identity", hello.value?.runtime?.name === "llama.cpp" && hello.value?.runtime?.build === "node-llama-cpp@3.21.1+llama.cpp@v0.4.0", hello.value?.runtime);
    check("hello reports platform and arch", hello.value?.platform === "win32" && hello.value?.arch === "x64");
    check("hello does not load the runtime", booted.importCalls === 0);
    check("a protocol mismatch is incompatible", (await booted.call({ type: "hello", expected: { protocolVersion: 2 } })).value?.compatible === false);
    check("a missing expectation is incompatible", (await booted.call({ type: "hello" })).value?.compatible === false);
    const noAddon = await startHost(source, { modelRoot: fixture.modelRoot, modulePaths: [fixture.modulesNoAddon] }).call({ type: "hello", expected: { protocolVersion: 1 } });
    check("a missing CPU prebuilt is incompatible", noAddon.value?.compatible === false && noAddon.value?.runtime?.build === "node-llama-cpp@3.21.1+llama.cpp@v0.4.0");
    const skew = await startHost(source, { modelRoot: fixture.modelRoot, modulePaths: [fixture.modulesVersionSkew] }).call({ type: "hello", expected: { protocolVersion: 1 } });
    check("a prebuilt of another version is incompatible", skew.value?.compatible === false);
    const none = await startHost(source, { modelRoot: fixture.modelRoot, modulePaths: [fixture.modulesEmpty] }).call({ type: "hello", expected: { protocolVersion: 1 } });
    check("no runtime at all is incompatible and reported unavailable", none.value?.compatible === false && none.value?.runtime?.build === "unavailable");

    // ── E. load ────────────────────────────────────────────────────────────────────────────────
    section("E. load");
    {
      const { runtime, control } = fakeRuntime();
      const host = fullHost(runtime);
      const outside = async (modelPath: string) => (await load(host, { modelPath })).reason;
      check("a path outside the root is refused", (await outside(fixture.outsideFile)) === "AI_MODEL_PATH_OUTSIDE_ROOT");
      check("the root itself is refused", (await outside(fixture.modelRoot)) === "AI_MODEL_PATH_OUTSIDE_ROOT");
      check("traversal out of the root is refused", (await outside(path.join(fixture.modelRoot, "..", "outside", path.basename(fixture.outsideFile)))) === "AI_MODEL_PATH_OUTSIDE_ROOT");
      check("a non-GGUF file is refused", (await outside(path.join(fixture.modelRoot, "notes.txt"))) === "AI_MODEL_PATH_OUTSIDE_ROOT");
      check("a NUL byte is refused", (await outside(`${fixture.modelFile}\0.gguf`)) === "AI_MODEL_PATH_OUTSIDE_ROOT");
      check("a non-string path is refused", (await load(host, { modelPath: 42 })).reason === "AI_MODEL_PATH_OUTSIDE_ROOT");
      if (fixture.junctionFile) {
        check("a junction escaping the root is refused", (await outside(fixture.junctionFile)) === "AI_MODEL_PATH_OUTSIDE_ROOT");
      } else {
        check("a junction could be created for the escape case", false, "fs.symlinkSync junction failed");
      }
      check("a missing file inside the root fails to load", (await outside(path.join(fixture.modelRoot, `${"d".repeat(64)}.gguf`))) === "AI_MODEL_LOAD_FAILED");
      for (const [label, overrides] of [
        ["context 0", { contextTokens: 0 }],
        ["context above 4K", { contextTokens: 4097 }],
        ["fractional context", { contextTokens: 2048.5 }],
        ["string context", { contextTokens: "4096" }],
        ["0 threads", { threads: 0 }],
        ["17 threads", { threads: 17 }]
      ] as const) {
        check(`load with ${label} is a protocol violation`, (await load(host, overrides)).reason === "AI_PROTOCOL_VIOLATION");
      }
      check("refused loads never touched the runtime", host.importCalls === 0 && control.getLlamaOptions.length === 0);
      const unrooted = startHost(source, { modelRoot: null, modulePaths: [fixture.modules], runtime });
      check("with no model root every path is refused", (await load(unrooted)).reason === "AI_MODEL_PATH_OUTSIDE_ROOT");

      const ok = await load(host);
      check("a confined model loads", ok.ok === true && Number.isFinite(ok.value?.loadMs) && ok.value.loadMs >= 0, ok);
      const options = control.getLlamaOptions[0] ?? {};
      check("the runtime is CPU only", options.gpu === false, options.gpu);
      check("the runtime never builds from source", options.build === "never", options.build);
      check("the runtime never downloads", options.skipDownload === true);
      check("runtime logs are disabled and swallowed", options.logLevel === "disabled" && typeof options.logger === "function" && options.progressLogs === false);
      check("maxThreads is the requested thread count", options.maxThreads === 3);
      check("the model loads with no GPU layers from its real path", control.loadModelOptions[0]?.gpuLayers === 0 && control.loadModelOptions[0]?.modelPath === fs.realpathSync(fixture.modelFile));
      check("the context gets the requested size, threads and one sequence", control.contextOptions[0]?.contextSize === 4096 && control.contextOptions[0]?.threads === 3 && control.contextOptions[0]?.sequences === 1);
      control.log.length = 0;
      check("a second model loads", (await load(host, { modelPath: fixture.otherModelFile })).ok === true);
      check("the previous model is disposed before the next loads", control.log.indexOf("context.dispose") >= 0 && control.log.indexOf("model.dispose") < control.log.indexOf("loadModel"), control.log);
      check("the runtime instance is reused", control.getLlamaOptions.length === 1);
    }
    {
      const { runtime, control } = fakeRuntime();
      control.failGetLlama = true;
      const host = fullHost(runtime);
      check("a runtime that fails to start is AI_MODEL_LOAD_FAILED", (await load(host)).reason === "AI_MODEL_LOAD_FAILED");
      control.failGetLlama = false;
      control.failLoad = true;
      check("a model that fails to load is AI_MODEL_LOAD_FAILED", (await load(host)).reason === "AI_MODEL_LOAD_FAILED");
      check("no runtime error text crosses the boundary", !leaks(host));
      const missing = startHost(source, { modelRoot: fixture.modelRoot, modulePaths: [fixture.modules], importFails: true });
      check("a runtime that cannot be imported is AI_MODEL_LOAD_FAILED", (await load(missing)).reason === "AI_MODEL_LOAD_FAILED" && !leaks(missing));
    }

    // ── F. infer refusals ──────────────────────────────────────────────────────────────────────
    section("F. infer refusals");
    {
      const { runtime, control } = fakeRuntime();
      const host = fullHost(runtime);
      check("infer before load is AI_MODEL_NOT_LOADED", (await host.call(inferPayload())).reason === "AI_MODEL_NOT_LOADED");
      await load(host);
      const reason = async (overrides: Record<string, unknown>) => (await host.call(inferPayload(overrides))).reason;
      check("no schema is AI_SCHEMA_REQUIRED", (await reason({ jsonSchema: undefined })) === "AI_SCHEMA_REQUIRED");
      check("a null schema is AI_SCHEMA_REQUIRED", (await reason({ jsonSchema: null })) === "AI_SCHEMA_REQUIRED");
      check("an array schema is AI_SCHEMA_REQUIRED", (await reason({ jsonSchema: [] })) === "AI_SCHEMA_REQUIRED");
      check("thinking on is refused", (await reason({ thinking: true })) === "AI_PROTOCOL_VIOLATION");
      check("thinking unset is refused", (await reason({ thinking: undefined })) === "AI_PROTOCOL_VIOLATION");
      let deep: Record<string, unknown> = { type: "boolean" };
      for (let depth = 0; depth < 7; depth += 1) deep = { type: "array", items: deep, maxItems: 1 };
      for (const [label, schema] of [
        ["an empty schema", {}],
        ["an open object", { type: "object", properties: {} }],
        ["an unbounded string", { type: "string" }],
        ["an unbounded array", { type: "array", items: { type: "boolean" } }],
        ["a required key with no property", { type: "object", properties: {}, required: ["x"], additionalProperties: false }],
        ["an empty enum", { type: "string", enum: [] }],
        ["a non-string enum", { type: "string", enum: [1] }],
        ["minItems above maxItems", { type: "array", items: { type: "boolean" }, minItems: 3, maxItems: 1 }],
        ["a schema nested past the depth bound", deep],
        ["an unknown type", { type: "null" }]
      ] as const) {
        check(`${label} is AI_SCHEMA_REQUIRED`, (await reason({ jsonSchema: schema })) === "AI_SCHEMA_REQUIRED");
      }
      for (const [label, overrides] of [
        ["a malformed job id", { jobId: "job 1" }],
        ["a non-string user", { user: 7 }],
        ["a non-string system", { system: null }],
        ["maxPromptTokens 0", { maxPromptTokens: 0 }],
        ["maxPromptTokens above the protocol cap", { maxPromptTokens: 3073 }],
        ["maxOutputTokens above the protocol cap", { maxOutputTokens: 513 }],
        ["a negative temperature", { temperature: -1 }],
        ["a temperature above 2", { temperature: 3 }],
        ["a fractional seed", { seed: 1.5 }]
      ] as const) {
        check(`${label} is a protocol violation`, (await reason(overrides)) === "AI_PROTOCOL_VIOLATION");
      }
      check("a prompt over maxPromptTokens is AI_PROMPT_TOO_LONG", (await reason({ user: "x".repeat(4 * 200), maxPromptTokens: 150 })) === "AI_PROMPT_TOO_LONG");
      await load(host, { contextTokens: 1024 });
      check("prompt plus output over the context is AI_PROMPT_TOO_LONG", (await reason({ user: "x".repeat(4 * 700), maxOutputTokens: 512 })) === "AI_PROMPT_TOO_LONG");
      check("no refused request reached generation", control.generateCalls.length === 0, control.generateCalls.length);
    }

    // ── G. infer ───────────────────────────────────────────────────────────────────────────────
    section("G. infer");
    {
      const { runtime, control } = fakeRuntime();
      const host = fullHost(runtime);
      await load(host);
      control.log.length = 0;
      control.generations.push({ chunks: 4, response: '{"choice":"loc-1","confidence":0.9}' });
      const result = await host.call(inferPayload());
      check("an inference answers", result.ok === true, result);
      check("the text is the runtime's response", result.value?.text === '{"choice":"loc-1","confidence":0.9}');
      check("the stop reason is stop", result.value?.stopReason === "stop");
      check("output tokens are counted", result.value?.outputTokens === 4);
      check("prompt tokens are the tokenized prompt", result.value?.promptTokens === control.generateCalls[0]?.promptTokens);
      const timings = result.value?.timings ?? {};
      check(
        "timings are non-negative and consistent",
        [timings.promptMs, timings.generationMs, timings.firstTokenMs].every((v) => Number.isFinite(v) && v >= 0) && timings.firstTokenMs >= 0,
        timings
      );
      check("the grammar is the translated schema", isDeepStrictEqual(control.grammarSchemas[0], EXPECTED_GRAMMAR), control.grammarSchemas[0]);
      const call = control.generateCalls[0];
      check("generation gets the grammar it created", isDeepStrictEqual(call?.grammar, { grammarFor: 1 }));
      check("generation is bounded by maxOutputTokens", call?.options.maxTokens === 128);
      check("generation is greedy with the given seed", call?.options.temperature === 0 && call?.options.seed === 0);
      check("generation is abortable and throws on abort", call?.options.signal instanceof AbortSignal && call?.options.stopOnAbortSignal === false);
      check("history is cleared before generating", control.log.indexOf("clearHistory") >= 0 && control.log.indexOf("clearHistory") < control.log.indexOf("generate"), control.log);
      const parts = control.lastParts ?? [];
      const specials = parts.filter((part) => part instanceof FakeSpecial) as FakeSpecial[];
      check("exactly the three template pieces are special tokens", specials.length === 3, specials.length);
      check("the system text is a plain part", parts[1] === "Pick the locator.");
      check("page text with <|im_end|> stays a plain part", typeof parts[3] === "string" && String(parts[3]).includes("<|im_end|>"));
      check("the assistant turn pre-fills an empty think block", specials[2]?.value === ASSISTANT_OPEN, specials[2]?.value);
      check("the template opens with the system turn", specials[0]?.value === "<|im_start|>system\n");

      control.generations.push({ response: '{"choice":"loc-2","confidence":0.1}' });
      await host.call(inferPayload({ jobId: "job-2#1" }));
      check("an identical schema reuses its grammar", control.grammarSchemas.length === 1, control.grammarSchemas.length);
      control.generations.push({ stopReason: "maxTokens", response: '{"choice":"lo' });
      check("a length stop is reported as length", (await host.call(inferPayload({ jobId: "job-3#1" }))).value?.stopReason === "length");
      control.generations.push({ throws: true });
      const failed2 = await host.call(inferPayload({ jobId: "job-4#1" }));
      check("a runtime failure is AI_INFERENCE_FAILED", failed2.reason === "AI_INFERENCE_FAILED");
      check("no runtime error text crosses the boundary", !leaks(host));
      check("the host still answers after a failure", (await host.call(inferPayload({ jobId: "job-5#1" }))).ok === true);
      await host.call({ type: "unload" });
      await load(host);
      await host.call(inferPayload({ jobId: "job-6#1" }));
      check("a reload builds its grammar again", control.grammarSchemas.length === 2, control.grammarSchemas.length);
    }

    // ── H. Cancellation and order ──────────────────────────────────────────────────────────────
    section("H. Cancellation and order");
    {
      const { runtime, control } = fakeRuntime();
      const host = fullHost(runtime);
      await load(host);
      control.generations.push({ chunks: 2, hang: true });
      const running = host.send(inferPayload({ jobId: "hang#1" }));
      await sleep(20);
      const cancel = await host.call({ type: "cancel", jobId: "hang#1" });
      const result = await host.reply(running);
      check("cancelling the running job answers cancelled: true", cancel.ok === true && cancel.value?.cancelled === true, cancel);
      check("the cancelled inference resolves with stopReason cancelled", result.ok === true && result.value?.stopReason === "cancelled" && result.value?.text === "", result);
      check("a cancel does not leak error text", !leaks(host));
      check("the next job after a cancel succeeds", (await host.call(inferPayload({ jobId: "after#1" }))).value?.stopReason === "stop");
      check("cancelling an unknown job answers cancelled: false", (await host.call({ type: "cancel", jobId: "nobody#1" })).value?.cancelled === false);
      check("a malformed cancel is a protocol violation", (await host.call({ type: "cancel", jobId: 5 })).reason === "AI_PROTOCOL_VIOLATION");

      const before = control.generateCalls.length;
      control.loadDelayMs = 60;
      const reload = host.send({ type: "load", modelPath: fixture.modelFile, contextTokens: 4096, threads: 3 });
      const queued = host.send(inferPayload({ jobId: "queued#1" }));
      const early = await host.call({ type: "cancel", jobId: "queued#1" });
      const queuedResult = await host.reply(queued);
      check("a cancel for a queued job answers cancelled: false", early.value?.cancelled === false);
      check("the queued job still resolves cancelled when it starts", queuedResult.value?.stopReason === "cancelled", queuedResult);
      check("the queued job never reached generation", control.generateCalls.length === before, control.generateCalls.length - before);
      check("the load ahead of it completed", (await host.reply(reload)).ok === true);
      control.loadDelayMs = 0;

      control.log.length = 0;
      control.disposeDelayMs = 30;
      const first = host.send({ type: "unload" });
      const second = host.send({ type: "load", modelPath: fixture.modelFile, contextTokens: 4096, threads: 3 });
      const third = host.send(inferPayload({ jobId: "order#1" }));
      const replies = await Promise.all([host.reply(first), host.reply(second), host.reply(third)]);
      control.disposeDelayMs = 0;
      check("unload, load and infer all answer", replies.every((reply) => reply.ok === true), replies.map((r) => r.reason ?? "ok"));
      const order = control.log.filter((entry) => ["context.dispose", "model.dispose", "loadModel", "generate"].includes(entry));
      check("they run strictly in arrival order", isDeepStrictEqual(order, ["context.dispose", "model.dispose", "loadModel", "generate"]), order);

      control.maxConcurrent = 0;
      control.generations.push({ chunks: 5, chunkDelayMs: 4 }, { chunks: 5, chunkDelayMs: 4 });
      const pair = [host.send(inferPayload({ jobId: "pair-a#1" })), host.send(inferPayload({ jobId: "pair-b#1" }))];
      const pairReplies = await Promise.all(pair.map((id) => host.reply(id)));
      check("back-to-back jobs both complete", pairReplies.every((reply) => reply.value?.stopReason === "stop"));
      check("one inference at a time", control.maxConcurrent === 1, control.maxConcurrent);
    }

    // ── I. Shutdown ────────────────────────────────────────────────────────────────────────────
    section("I. Shutdown");
    {
      const { runtime, control } = fakeRuntime();
      const host = fullHost(runtime);
      await load(host);
      control.generations.push({ chunks: 1, hang: true });
      const running = host.send(inferPayload({ jobId: "busy#1" }));
      await sleep(15);
      const shutdown = await host.call({ type: "shutdown" });
      const result = await host.reply(running);
      check("shutdown does not wait behind a running inference", shutdown.ok === true, shutdown);
      check("the running inference is cancelled", result.value?.stopReason === "cancelled", result);
      check("shutdown disposes the context, model and runtime", ["context.dispose", "model.dispose", "llama.dispose"].every((entry) => control.log.includes(entry)), control.log);
      check("the host exits 0 after answering", host.exitCode === 0, host.exitCode);
    }
  } catch (error) {
    failed += 1;
    if (!quiet) console.error(`  ✗ suite aborted — ${error instanceof Error ? error.stack : String(error)}`);
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
  return { passed, failed };
}

// ── Mutation self-test ───────────────────────────────────────────────────────────────────────────

const MUTATIONS: { name: string; from: string; to: string }[] = [
  {
    name: "junction escape allowed (real-path containment removed)",
    from: 'if (!isStrictlyInside(fs.realpathSync(MODEL_ROOT), realFile)) throw new HostError("AI_MODEL_PATH_OUTSIDE_ROOT");',
    to: ""
  },
  { name: "thinking left on (think block not closed)", from: '<think>\\n\\n</think>\\n\\n"', to: '<think>\\n"' },
  { name: "page text parsed for special tokens", from: "    user,\n    new SpecialTokensText(TEMPLATE.assistantOpen)", to: "    new SpecialTokensText(user),\n    new SpecialTokensText(TEMPLATE.assistantOpen)" },
  { name: "thinking flag not enforced", from: 'if (req.thinking !== false) throw new HostError("AI_PROTOCOL_VIOLATION");', to: "" },
  { name: "GPU allowed", from: "gpu: false,", to: 'gpu: "auto",' },
  { name: "source build allowed", from: 'build: "never",', to: 'build: "auto",' },
  { name: "queued cancel forgotten", from: "if (earlyCancels.delete(req.jobId)) return cancelledResult(tokens.length, 0, started, null);", to: "" },
  { name: "shutdown waits behind inference", from: 'if (req.type === "shutdown" && active) active.controller.abort();', to: "" },
  { name: "requests no longer serialized", from: "const run = chain.then(fn);", to: "const run = Promise.resolve().then(fn);" },
  { name: "enum translated to a free string", from: "return { enum: [...schema.enum] };", to: 'return { type: "string", maxLength: 64 };' },
  { name: "prompt bound removed", from: "if (tokens.length > maxPromptTokens || tokens.length + maxOutputTokens > current.contextSize) {", to: "if (false) {" },
  { name: "prototype lookup for dispatch", from: "const immediate = IMMEDIATE.get(req.type);", to: "const immediate = IMMEDIATE.get(req.type) ?? ({})[req.type];" }
];

async function main(): Promise<void> {
  console.log("verify:ai-host — native-hosts/ai/ai-host.cjs under a fake parentPort and fake runtime");
  const { passed, failed } = await runSuite(HOST_SOURCE, false);
  console.log(`\nSuite: ${passed} passed, ${failed} failed`);

  console.log("\nMutation self-test (each must fail the suite)");
  let caught = 0;
  let missed = 0;
  for (const mutation of MUTATIONS) {
    if (HOST_SOURCE.split(mutation.from).length !== 2) {
      missed += 1;
      console.error(`  ✗ ${mutation.name} — target not found exactly once; update the mutation list`);
      continue;
    }
    const result = await runSuite(HOST_SOURCE.replace(mutation.from, mutation.to), true);
    if (result.failed > 0) {
      caught += 1;
      console.log(`  ✓ caught: ${mutation.name} (${result.failed} failing checks)`);
    } else {
      missed += 1;
      console.error(`  ✗ MISSED: ${mutation.name}`);
    }
  }
  console.log(`\nMutations: ${caught}/${MUTATIONS.length} caught`);
  const ok = failed === 0 && passed > 0 && missed === 0 && caught === MUTATIONS.length;
  console.log(ok ? `\nverify:ai-host PASS (${passed} checks, ${caught} mutations caught)` : "\nverify:ai-host FAIL");
  process.exit(ok ? 0 : 1);
}

void main();
