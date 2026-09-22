/**
 * verify:ai-model-live — the real runtime and a real model pack through the production path
 * (Phase L, L1). The only AI verifier that touches a model; every other one uses the fake transport.
 *
 * NOT RUN (exit 0 with a NOT RUN line, like verify:oracle-live) until both owner steps in
 * docs/plans/ai-upgrade-v5/L1-ai-foundation.md are done: node-llama-cpp installed and the pack
 * downloaded. Then it:
 *   1. measures the pack's SHA-256 and size (the only source for a manifest pin; the published
 *      Hugging Face object is a cross-check),
 *   2. requires AI_RUNTIME_PIN.build to equal the installed runtime and AI_MODEL_MANIFEST to list the
 *      measured pack (both FAIL until pinned under the release lease),
 *   2b. reads the pack's own GGUF header (architecture, name, context length, file type) and requires
 *      the manifest entry's context length and quantization to be the header's, so a pin cannot carry
 *      a value copied from a model card,
 *   3. when pinned, imports the pack through AiModelPackStore with the real manifest and re-verifies it,
 *   4. runs the live harness: the production AiService and AiUtilityHostManager against the real host
 *      in a real utility process (constrained decoding, determinism, injection text, thinking off,
 *      special-token literalness, truncation, cancellation, deadline, yield, crash recovery, shutdown).
 *
 * `--pack <file>` picks one of PACKS (default: the 4B, found as before); any other pack must sit in
 * ~/Downloads and be the published object.
 *
 * Run: npm run verify:ai-model-live | verify:ai-model-live-0-8b
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { deriveInferenceThreads } from "../src/ai/AiAdmission";
import { AiModelPackStore } from "../src/ai/AiModelPack";
import { AI_MODEL_MANIFEST, AI_RUNTIME_PIN } from "../src/offline/AiModelManifest";
import {
  HOST_PATH,
  MODEL_FILE_NAME,
  PUBLISHED_PACK,
  buildAiHarness,
  locateModelCandidate,
  measurePack,
  printSteps,
  runAiHarness,
  runtimeInstalled,
  stageModelRoot
} from "./ai-harness/launch.mts";

/** Packs this gate runs on, with the published object each must be. */
const PACKS: Readonly<Record<string, { sizeBytes: number; sha256: string }>> = Object.freeze({
  [MODEL_FILE_NAME]: PUBLISHED_PACK,
  "Qwen3.5-0.8B-Q4_K_M.gguf": { sizeBytes: 527_502_816, sha256: "f5b14da98939b60bbe1019a964eba656407e1e0b64f1fe3003ff6d650e93bfec" }
});
/** llama.cpp `llama_ftype` values the manifest names. */
const QUANTIZATION: Readonly<Record<number, string>> = Object.freeze({ 15: "Q4_K_M" });

/**
 * The GGUF header's own metadata (GGUF v2/v3): the version, the tensor count and the scalar key/values.
 * Arrays (the tokenizer's) are walked and skipped, so the whole key/value section is read.
 */
function readGgufHeader(file: string): { version: number; tensors: number; values: Map<string, unknown> } {
  const buf = Buffer.alloc(64 * 1024 ** 2);
  const fd = fs.openSync(file, "r");
  const length = fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);
  let at = 0;
  const take = (n: number): number => {
    if (at + n > length) throw new Error(`the GGUF metadata runs past the first ${length} bytes`);
    const start = at;
    at += n;
    return start;
  };
  const u32 = () => buf.readUInt32LE(take(4));
  const u64 = () => Number(buf.readBigUInt64LE(take(8)));
  const text = () => {
    const n = u64();
    return buf.toString("utf8", take(n), at);
  };
  const WIDTH: Record<number, number> = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };
  const scalar = (type: number): unknown => {
    if (type === 4) return u32();
    if (type === 5) return buf.readInt32LE(take(4));
    if (type === 10) return u64();
    if (type === 7) return buf[take(1)] !== 0;
    if (type === 8) return text();
    if (WIDTH[type] === undefined) throw new Error(`unsupported GGUF value type ${type}`);
    take(WIDTH[type]);
    return undefined;
  };
  if (buf.toString("latin1", 0, 4) !== "GGUF") throw new Error("not a GGUF file");
  take(4);
  const version = u32();
  const tensors = u64();
  const count = u64();
  const values = new Map<string, unknown>();
  for (let i = 0; i < count; i += 1) {
    const key = text();
    const type = u32();
    if (type !== 9) {
      values.set(key, scalar(type));
      continue;
    }
    const itemType = u32();
    const items = u64();
    for (let j = 0; j < items; j += 1) scalar(itemType);
    values.set(key, `[${items} items]`);
  }
  return { version, tensors, values };
}

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("verify:ai-model-live — real runtime, real model pack, production AiService\n");
const packFlag = process.argv.indexOf("--pack");
const packName = packFlag >= 0 ? (process.argv[packFlag + 1] ?? "") : MODEL_FILE_NAME;
const published = PACKS[packName];
if (!published) {
  console.error(`unknown --pack "${packName}"; one of ${Object.keys(PACKS).join(", ")}`);
  process.exit(1);
}
const runtime = runtimeInstalled();
if (!runtime.installed) {
  console.log("NOT RUN: node-llama-cpp and its Windows CPU prebuilt are not installed (owner step 1 in L1-ai-foundation.md).");
  process.exit(0);
}
const inDownloads = path.join(os.homedir(), "Downloads", packName);
const candidate = packName === MODEL_FILE_NAME ? locateModelCandidate() : fs.existsSync(inDownloads) ? inDownloads : null;
if (!candidate) {
  console.log(`NOT RUN: no model pack at ~/Downloads/${packName}${packName === MODEL_FILE_NAME ? " or AWKIT_AI_LIVE_MODEL" : ""} (owner step 2 in L1-ai-foundation.md).`);
  process.exit(0);
}

console.log(`  runtime: ${runtime.build}`);
console.log(`  pack:    ${path.basename(candidate)}`);
const measured = await measurePack(candidate);
console.log(`  MEASURED sha256=${measured.sha256} size=${measured.sizeBytes}${measured.cached ? " (cached measurement)" : ""}\n`);

console.log("Pack and pins");
if (path.basename(candidate) === packName) {
  check(
    "the downloaded pack matches the published object",
    measured.sha256 === published.sha256 && measured.sizeBytes === published.sizeBytes,
    `published ${published.sha256}/${published.sizeBytes}`
  );
}
check("AI_RUNTIME_PIN.build pins the installed runtime", AI_RUNTIME_PIN.build === runtime.build, `pin ${AI_RUNTIME_PIN.build ?? "null"}, installed ${runtime.build}`);
const entry = AI_MODEL_MANIFEST.find((item) => item.sha256 === measured.sha256);
check("AI_MODEL_MANIFEST lists the measured pack", Boolean(entry && entry.sizeBytes === measured.sizeBytes), entry ? `size ${entry.sizeBytes}` : "no entry with this SHA-256");

console.log("\nPack identity, from its own GGUF header");
const header = readGgufHeader(candidate);
const architecture = String(header.values.get("general.architecture") ?? "");
const contextLength = header.values.get(`${architecture}.context_length`);
const fileType = Number(header.values.get("general.file_type"));
console.log(
  `  GGUF v${header.version}, ${header.tensors} tensors, general.architecture = ${architecture}, general.name = ${String(header.values.get("general.name"))}, ` +
    `${architecture}.context_length = ${String(contextLength)}, general.file_type = ${fileType} (${QUANTIZATION[fileType] ?? "unnamed"}), ${header.values.size} keys`
);
// The host's chat template, with its pre-closed think block, is Qwen3.5's.
check("the pack is a qwen35 model, the architecture the host's template is written for", architecture === "qwen35", architecture);
if (entry) {
  check("the entry's context length is the header's", entry.contextTokens === contextLength, `entry ${entry.contextTokens}, header ${String(contextLength)}`);
  check("the entry's quantization is the header's file type", entry.quantization === QUANTIZATION[fileType], `entry ${entry.quantization}, header file type ${fileType}`);
}

const cleanup: string[] = [];
let modelRoot: string;
let modelPath: string;
if (entry) {
  console.log("\nImport through AiModelPackStore (real manifest)");
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-ai-import-"));
  cleanup.push(dataRoot);
  modelRoot = path.join(dataRoot, "models");
  const store = new AiModelPackStore(modelRoot, AI_MODEL_MANIFEST);
  const started = Date.now();
  const imported = await store.import(candidate);
  check(`the pack imports (${Math.round((Date.now() - started) / 1000)} s)`, imported.ok, imported.ok ? undefined : imported.code);
  const status = await store.status();
  check("its status is installed", status.status === "installed", status.status);
  check("load verification re-hashes and accepts it", await store.verifyForLoad(measured.sha256));
  modelPath = store.modelPath(measured.sha256);
} else {
  const staged = stageModelRoot(candidate, measured.sha256);
  cleanup.push(staged.root);
  modelRoot = staged.modelRoot;
  modelPath = staged.modelPath;
  console.log(`\n  (unpinned: the pack is ${staged.linked ? "hard-linked" : "copied"} into a scratch model root for the runtime checks)`);
}

const threads = deriveInferenceThreads(os.cpus().length);
console.log(`\nLive harness (threads ${threads})`);
const harnessDir = await buildAiHarness();
cleanup.push(harnessDir);
try {
  const report = await runAiHarness(
    harnessDir,
    {
      AWKIT_HARNESS_MODE: "live",
      AWKIT_HARNESS_HOST_PATH: HOST_PATH,
      AWKIT_HARNESS_MODEL_ROOT: modelRoot,
      AWKIT_HARNESS_MODEL_PATH: modelPath,
      AWKIT_HARNESS_MODEL_ID: entry?.id ?? "unpinned-candidate",
      AWKIT_HARNESS_THREADS: String(threads),
      AWKIT_HARNESS_EXPECT_BUILD: AI_RUNTIME_PIN.build ?? runtime.build ?? ""
    },
    { timeoutMs: 480_000 }
  );
  if (!report) {
    check("the live harness wrote a report", false, "no report: Electron never reached app.whenReady() or timed out");
  } else {
    printSteps(report, check);
    check("the live harness ran every step", report.steps.length === 13, `${report.steps.length} steps`);
    console.log(`\n  counters: ${JSON.stringify(report.counters ?? null)}`);
  }
} finally {
  for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 && passed > 0 ? 0 : 1);
