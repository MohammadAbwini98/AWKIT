/**
 * verify:ai-model-compatibility — Phase L L8b.2–L8b.4, the compatibility stages and qualification
 * outside the host.
 *
 * The host's own reading and probing is verify:ai-host (fake runtime) and verify:ai-model-inspect (real
 * host, runtime and models). This covers what decides and records, against real temporary folders and
 * the deterministic fake host:
 *  A. `staticVerdict`: each check fails on its own, at its boundary, first failure wins, every code is
 *     reachable, and a malformed host reply is never a pass;
 *  B. `staticStanding`: a verdict counts only for the runtime build that produced it;
 *  C. `AiModelPackStore.recordStaticCheck` and the registry: recorded only on the active registered
 *     model, never on a curated one or a replacement; L8b.1 registries load; forged verdicts read
 *     unreadable; a re-import starts unchecked;
 *  D. `runStaticStage`: not run (and nothing recorded) whenever the host cannot answer, and never
 *     recorded on a model replaced while the host was reading;
 *  E. `AiService.inspectModel`: the CPU host's handshake first, null whenever the host cannot run it,
 *     and it runs with AI switched off;
 *  F. L8b.3 `probeVerdict` and `compatibilityStanding`: each probe check on its own, a malformed or
 *     cancelled reply never a pass, static before probe, both for this runtime build;
 *  G. the store's probe verdict and acknowledgement: recorded on the active registered model only, kept
 *     beside each other, older registries load, forged ones read unreadable, a re-import clears both;
 *  H. `runCompatibilityStages`: the probe runs only after this model's header passed, and a replacement
 *     is never probed or recorded on another file's verdict;
 *  I. `AiService.probeModel`: admission first, the CPU handshake, the host's model forgotten, null when
 *     it cannot run, a timed-out probe cancelled on the host;
 *  J. L8b.4 qualification: the release list holds only the historical CPU keys, the live key matches
 *     exactly those, and one configuration never qualifies another; labels and the latency class.
 *
 * Run: npm run verify:ai-model-compatibility
 */

import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AI_PROBE_CHECKS,
  AI_STATIC_CHECKS,
  compatibilityStanding,
  probeVerdict,
  runCompatibilityStages,
  runStaticStage,
  staticStanding,
  staticVerdict
} from "@src/ai/AiModelCompatibility";
import { AiModelPackStore, type AiProbeCheckRecord, type AiStaticCheckRecord } from "@src/ai/AiModelPack";
import { AI_KV_CACHE_SETTINGS, describeQualification, hardwareClassOf, isQualified, latencyClassId, qualityKeyId, type AiQualityKey } from "@src/ai/AiQualification";
import { AiService } from "@src/ai/AiService";
import { AUTHORING_LIMITS } from "@src/ai/authoringExplanation";
import { AiHostCallError, type AiModelHeader, type AiModelProbe } from "@src/ai/contracts/AiHostProtocol";
import { FAILURE_ANALYSIS_LIMITS } from "@src/ai/failureAnalysis";
import { FAKE_PASSING_PROBE, FAKE_QWEN_HEADER, FakeAiHostTransport } from "@src/ai/FakeAiHostTransport";
import { LOCATOR_ATTEMPT_LIMITS } from "@src/ai/locatorUpgradeAttempts";
import { AI_MODEL_MANIFEST, AI_RUNTIME_PIN, type AiModelManifestEntry } from "@src/offline/AiModelManifest";
import { AI_QUALIFIED_CONFIGURATIONS, isValidAiQualifiedConfiguration } from "@src/offline/AiQualifiedList";
import { AI_FEATURE_IDS } from "@src/security/authz/AiAutonomyPolicy";

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}
const section = (title: string) => console.log(`\n${title}`);

function gguf(bytes: number): Buffer {
  const body = randomBytes(bytes);
  body.write("GGUF", 0, "latin1");
  body.writeUInt32LE(3, 4);
  return body;
}

function entryFor(id: string, content: Buffer): AiModelManifestEntry {
  return {
    id,
    displayName: `Test ${id}`,
    fileName: `${id}.gguf`,
    sizeBytes: content.length,
    sha256: createHash("sha256").update(content).digest("hex"),
    format: "gguf",
    contextTokens: 4096,
    quantization: "Q4_K_M",
    license: { spdx: "Apache-2.0", notice: "THIRD_PARTY_NOTICES.md" },
    capabilities: { jsonSchemaGrammar: true, thinkingToggle: true }
  };
}

const BUILD = "node-llama-cpp@3.21.1+llama.cpp@v0.4.0";
const PASSING = FAKE_QWEN_HEADER as Extract<AiModelHeader, { readable: true }>;
const verdictOf = (header: unknown) => {
  const verdict = staticVerdict(header);
  return verdict.ok ? "passed" : verdict.failed;
};
const record = (failed: AiStaticCheckRecord["failed"], runtimeBuild = BUILD): AiStaticCheckRecord => ({ runtimeBuild, failed, checkedAt: "2026-09-28T12:00:00.000Z" });

// ── A. staticVerdict ───────────────────────────────────────────────────────────────────────────────
section("A. staticVerdict");
check("the curated Qwen3.5 header passes", verdictOf(PASSING) === "passed");
const cases: Array<[string, Record<string, unknown>, string]> = [
  ["an unreadable file", { readable: false }, "GGUF_UNREADABLE"],
  ["no tensors", { tensorCount: 0 }, "GGUF_UNREADABLE"],
  ["a fractional tensor count", { tensorCount: 1.5 }, "GGUF_UNREADABLE"],
  ["GGUF version 1", { ggufVersion: 1 }, "GGUF_VERSION"],
  ["GGUF version 4", { ggufVersion: 4 }, "GGUF_VERSION"],
  ["no GGUF version", { ggufVersion: null }, "GGUF_VERSION"],
  ["an unknown architecture", { architectureKnown: false }, "ARCHITECTURE_UNSUPPORTED"],
  ["a known flag with no architecture name", { architecture: null }, "ARCHITECTURE_UNSUPPORTED"],
  ["a truthy but non-boolean known flag", { architectureKnown: 1 }, "ARCHITECTURE_UNSUPPORTED"],
  ["one tensor of an unknown type", { unknownTensorTypes: 1 }, "TENSOR_TYPE_UNSUPPORTED"],
  ["an uncounted tensor type", { unknownTensorTypes: "0" }, "TENSOR_TYPE_UNSUPPORTED"],
  ["another chat template", { chatTemplate: "other" }, "CHAT_TEMPLATE"],
  ["no chat template", { chatTemplate: "missing" }, "CHAT_TEMPLATE"],
  ["a 4,095-token context", { contextLength: 4095 }, "CONTEXT_TOO_SMALL"],
  ["no context length", { contextLength: null }, "CONTEXT_TOO_SMALL"],
  ["no layers", { blockCount: 0 }, "LAYER_COUNT"],
  ["1,025 layers", { blockCount: 1025 }, "LAYER_COUNT"],
  ["no layer count", { blockCount: null }, "LAYER_COUNT"]
];
const reached = new Set<string>();
for (const [label, change, want] of cases) {
  const got = verdictOf({ ...PASSING, ...change });
  reached.add(got);
  check(`${label} fails ${want}`, got === want, got);
}
check("every static check is reachable, and no other code exists", reached.size === AI_STATIC_CHECKS.length && AI_STATIC_CHECKS.every((code) => reached.has(code)), [...reached]);
for (const [label, change] of [["a 4,096-token context", { contextLength: 4096 }], ["one layer", { blockCount: 1 }], ["1,024 layers", { blockCount: 1024 }], ["GGUF version 2", { ggufVersion: 2 }]] as const) {
  check(`${label} is inside its bound`, verdictOf({ ...PASSING, ...change }) === "passed");
}
check("the first failing check wins", verdictOf({ ...PASSING, ggufVersion: 1, chatTemplate: "other", contextLength: 1 }) === "GGUF_VERSION");
for (const [label, reply] of [["null", null], ["a string", "passed"], ["an array", [PASSING]], ["an empty object", {}], ["readable as a string", { ...PASSING, readable: "true" }]] as const) {
  check(`a malformed reply (${label}) is unreadable, never a pass`, verdictOf(reply) === "GGUF_UNREADABLE");
}

// ── B. staticStanding ──────────────────────────────────────────────────────────────────────────────
section("B. staticStanding");
check("no verdict is unchecked", staticStanding(null, BUILD) === null);
check("a verdict from another runtime build is unchecked", staticStanding(record("CHAT_TEMPLATE", "node-llama-cpp@3.20.0+llama.cpp@v0.3.0"), BUILD) === null);
check("no runtime pin is unchecked", staticStanding(record(null), null) === null);
check("a failure for this build is that check", staticStanding(record("CONTEXT_TOO_SMALL"), BUILD) === "CONTEXT_TOO_SMALL");
check("a pass for this build is passed", staticStanding(record(null), BUILD) === "passed");

const root = await mkdtemp(join(tmpdir(), "awkit-ai-compat-"));
try {
  const source = join(root, "source");
  await mkdir(source, { recursive: true });
  const externalBytes = gguf(2048);
  const otherBytes = gguf(3072);
  const curatedBytes = gguf(1024);
  const externalFile = join(source, "External-Model.gguf");
  const otherFile = join(source, "Other-Model.gguf");
  const curatedFile = join(source, "curated.gguf");
  await writeFile(externalFile, externalBytes);
  await writeFile(otherFile, otherBytes);
  await writeFile(curatedFile, curatedBytes);
  const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

  // ── C. The store ─────────────────────────────────────────────────────────────────────────────────
  section("C. AiModelPackStore");
  const modelsDir = join(root, "models");
  const store = new AiModelPackStore(modelsDir, [entryFor("curated", curatedBytes)]);
  const registryPath = join(modelsDir, "registry.json");
  const imported = await store.import(externalFile);
  check("a non-manifest model registers", imported.ok && imported.entry === null, imported);
  const fresh = await store.status();
  check("a fresh registration has no verdict", fresh.status === "registered" && fresh.staticCheck === null, fresh);
  check("a verdict for another model is not recorded", (await store.recordStaticCheck(sha(otherBytes), record("CHAT_TEMPLATE"))) === false);
  check("...and nothing was written", ((await store.status()) as { staticCheck?: unknown }).staticCheck === null);
  for (const [label, bad] of [
    ["an unknown check", { ...record(null), failed: "BOGUS" }],
    ["an empty runtime build", record(null, "")],
    ["a date that is not one", { ...record(null), checkedAt: "yesterday" }]
  ] as const) {
    check(`a malformed verdict (${label}) is not recorded`, (await store.recordStaticCheck(sha(externalBytes), bad as AiStaticCheckRecord)) === false);
  }
  check("the verdict for this model is recorded", (await store.recordStaticCheck(sha(externalBytes), record("CHAT_TEMPLATE"))) === true);
  const recorded = await store.status();
  check("status carries it", recorded.status === "registered" && recorded.staticCheck?.failed === "CHAT_TEMPLATE" && recorded.staticCheck.runtimeBuild === BUILD, recorded);
  check("it survives a new store instance", ((await new AiModelPackStore(modelsDir, []).status()) as { staticCheck?: AiStaticCheckRecord }).staticCheck?.failed === "CHAT_TEMPLATE");
  const onDisk = JSON.parse(await readFile(registryPath, "utf8"));
  check("the registry holds the verdict beside the size and name, and no path", onDisk.active.external.staticCheck?.failed === "CHAT_TEMPLATE" && !JSON.stringify(onDisk).includes(root.replace(/\\/g, "\\\\")), onDisk);

  const good = JSON.stringify(onDisk);
  const writeRegistry = (value: unknown) => writeFile(registryPath, JSON.stringify(value), "utf8");
  const l8b1 = structuredClone(onDisk);
  delete l8b1.active.external.staticCheck;
  await writeRegistry(l8b1);
  const old = await store.status();
  check("an L8b.1 registry (no verdict) loads unchecked", old.status === "registered" && old.staticCheck === null, old);
  for (const [label, staticCheck] of [
    ["null", null],
    ["an array", [record(null)]],
    ["an unknown check", { ...record(null), failed: "BOGUS" }],
    ["a numeric runtime build", { ...record(null), runtimeBuild: 5 }],
    ["an over-long runtime build", { ...record(null), runtimeBuild: "x".repeat(201) }],
    ["a date that is not one", { ...record(null), checkedAt: "not a date" }],
    ["no failed field", { runtimeBuild: BUILD, checkedAt: record(null).checkedAt }]
  ] as const) {
    const forged = structuredClone(onDisk);
    forged.active.external.staticCheck = staticCheck;
    await writeRegistry(forged);
    const got = await store.status();
    check(`a forged verdict (${label}) reads unreadable`, got.status === "invalid" && got.reason === "REGISTRY_UNREADABLE", got);
  }
  await writeFile(registryPath, good, "utf8");
  check("the valid registry reads again", ((await store.status()) as { staticCheck?: AiStaticCheckRecord }).staticCheck?.failed === "CHAT_TEMPLATE");
  await store.import(externalFile);
  check("re-importing the same file starts unchecked", ((await store.status()) as { staticCheck?: unknown }).staticCheck === null);
  const curated = await store.import(curatedFile);
  check("a curated pack imports as installed", curated.ok && curated.entry?.id === "curated");
  check("a verdict is never recorded on a curated pack", (await store.recordStaticCheck(sha(curatedBytes), record(null))) === false);
  check("...whose registry stays without one", !("external" in JSON.parse(await readFile(registryPath, "utf8")).active));

  // ── D. runStaticStage ────────────────────────────────────────────────────────────────────────────
  section("D. runStaticStage");
  const stageDir = join(root, "stage-models");
  const stageStore = new AiModelPackStore(stageDir, []);
  const asked: string[] = [];
  const run = (inspect: (file: string) => Promise<AiModelHeader | null>, runtimeBuild: string | null = BUILD) =>
    runStaticStage({ store: stageStore, inspect: (file) => (asked.push(file), inspect(file)), runtimeBuild, now: () => Date.parse("2026-09-28T12:00:00.000Z") });
  check("no model: not run, the host is not asked", (await run(async () => PASSING)) === "not-run" && asked.length === 0);
  await stageStore.import(externalFile);
  check("no runtime pin: not run, the host is not asked", (await run(async () => PASSING, null)) === "not-run" && asked.length === 0);
  check("a host that cannot answer: not run", (await run(async () => null)) === "not-run");
  check("a host that throws: not run", (await run(async () => Promise.reject(new Error("host gone")))) === "not-run");
  check("...and nothing was recorded", ((await stageStore.status()) as { staticCheck?: unknown }).staticCheck === null);
  check("the host is asked for the stored model's own path", asked.every((file) => file === stageStore.modelPath(sha(externalBytes))), asked);
  check("a failing header is recorded as its check", (await run(async () => ({ ...PASSING, chatTemplate: "other" }))) === "CHAT_TEMPLATE");
  const staged = await stageStore.status();
  check("with the runtime build and the time", staged.status === "registered" && isDeep(staged.staticCheck, record("CHAT_TEMPLATE")), staged);
  check("a passing header is recorded as a pass", (await run(async () => PASSING)) === "passed" && ((await stageStore.status()) as { staticCheck?: AiStaticCheckRecord }).staticCheck?.failed === null);
  const raced = await run(async () => {
    await stageStore.import(otherFile);
    return { ...PASSING, contextLength: 16 };
  });
  const after = await stageStore.status();
  check("a model replaced while the host read: not run", raced === "not-run", raced);
  check("...and the replacement carries no verdict", after.status === "registered" && after.external.sha256 === sha(otherBytes) && after.staticCheck === null, after);
} finally {
  await rm(root, { recursive: true, force: true });
}

// ── E. AiService.inspectModel ───────────────────────────────────────────────────────────────────────
section("E. AiService.inspectModel");
const modelRoot = join(tmpdir(), "awkit-fake-model-root");
const inside = join(modelRoot, `${"a".repeat(64)}.gguf`);
function service(transport: FakeAiHostTransport | null, expectedRuntimeBuild: string | undefined = "b-fake"): AiService {
  return new AiService({
    transport: (backend) => (backend === "cpu" ? transport : null),
    model: async () => ({ ok: false, reason: "MODEL_MISSING" }),
    settings: async () => ({ enabled: false, yieldDuringRuns: true, idleUnloadMs: 0, minFreeMemoryMb: 0 }),
    admission: () => ({ activeRuns: 0, queuedRuns: 0, pressureState: "stable", dispatchBlocked: false, activeWeight: 0, weightedBudget: 100, freeMemoryMb: 1_000_000 }),
    threads: 2,
    expectedRuntimeBuild
  });
}
{
  const fake = new FakeAiHostTransport({ modelRoot });
  const svc = service(fake);
  const header = await svc.inspectModel(inside);
  check("it answers the host's header, with AI switched off", isDeep(header, FAKE_QWEN_HEADER), header);
  check("the CPU host's handshake came first", isDeep(fake.requestTypes(), ["hello", "inspect"]), fake.requestTypes());
  await svc.inspectModel(inside);
  check("the handshake is not repeated", isDeep(fake.requestTypes(), ["hello", "inspect", "inspect"]), fake.requestTypes());
  check("a path outside the host's root is null", (await svc.inspectModel(join(tmpdir(), "elsewhere.gguf"))) === null);
  await svc.shutdown();
  check("after shutdown it is null", (await svc.inspectModel(inside)) === null);
}
{
  const refused = new FakeAiHostTransport({ modelRoot, compatible: false });
  check("an incompatible host is null, and is never asked", (await service(refused).inspectModel(inside)) === null && !refused.requestTypes().includes("inspect"));
  const skewed = new FakeAiHostTransport({ modelRoot, runtimeBuild: "b-other" });
  check("a host on another runtime build is null, and is never asked", (await service(skewed).inspectModel(inside)) === null && !skewed.requestTypes().includes("inspect"));
  check("no host in this build is null", (await service(null).inspectModel(inside)) === null);
  const failing = new FakeAiHostTransport({ modelRoot, header: { fail: "AI_HOST_EXITED" } });
  const svc = service(failing);
  check("a host that exits while reading is null", (await svc.inspectModel(inside)) === null);
  await svc.inspectModel(inside);
  check("...and the next call handshakes the restarted host", failing.requestTypes().filter((type) => type === "hello").length === 2, failing.requestTypes());
  const down = new FakeAiHostTransport({ modelRoot });
  for (let crash = 0; crash < 3; crash += 1) down.crash();
  check("an open circuit is null, and the host is never asked", (await service(down).inspectModel(inside)) === null && down.requests.length === 0);
}

// ── F. probeVerdict and compatibilityStanding (L8b.3) ────────────────────────────────────────────────
section("F. probeVerdict and compatibilityStanding");
const probeOf = (reply: unknown) => {
  const verdict = probeVerdict(reply);
  return verdict.ok ? "passed" : verdict.failed;
};
check("the curated Qwen3.5 probe passes", probeOf(FAKE_PASSING_PROBE) === "passed");
const probeCases: Array<[string, unknown, string]> = [
  ["a model the runtime could not load", { loaded: false }, "PROBE_LOAD_FAILED"],
  ["a generation that failed", { ...FAKE_PASSING_PROBE, stopReason: "failed", text: "" }, "PROBE_GENERATION_FAILED"],
  ["tokens that opened a think block", { ...FAKE_PASSING_PROBE, thinkingOff: false }, "THINKING_NOT_DISABLED"],
  ["a truthy but non-boolean thinkingOff", { ...FAKE_PASSING_PROBE, thinkingOff: "true" }, "THINKING_NOT_DISABLED"],
  ["an answer cut at its bound", { ...FAKE_PASSING_PROBE, stopReason: "length", text: '{"answer":' }, "PROBE_OUTPUT_INVALID"],
  ["an answer outside the enum", { ...FAKE_PASSING_PROBE, text: '{"answer":"maybe"}' }, "PROBE_OUTPUT_INVALID"],
  ["an answer with an extra key", { ...FAKE_PASSING_PROBE, text: '{"answer":"yes","why":"x"}' }, "PROBE_OUTPUT_INVALID"],
  ["an answer that is not JSON", { ...FAKE_PASSING_PROBE, text: "yes" }, "PROBE_OUTPUT_INVALID"],
  ["an answer that is not text", { ...FAKE_PASSING_PROBE, text: { answer: "yes" } }, "PROBE_OUTPUT_INVALID"]
];
const probeReached = new Set<string>();
for (const [label, reply, want] of probeCases) {
  const got = probeOf(reply);
  probeReached.add(got);
  check(`${label} fails ${want}`, got === want, got);
}
check("every probe check is reachable, and no other code exists", probeReached.size === AI_PROBE_CHECKS.length && AI_PROBE_CHECKS.every((code) => probeReached.has(code)), [...probeReached]);
check("the first failing probe check wins", probeOf({ loaded: true, stopReason: "failed", thinkingOff: false, text: "" }) === "PROBE_GENERATION_FAILED");
for (const [label, reply] of [["null", null], ["a string", "passed"], ["an array", [FAKE_PASSING_PROBE]], ["an empty object", {}], ["loaded as a string", { ...FAKE_PASSING_PROBE, loaded: "true" }]] as const) {
  check(`a malformed probe reply (${label}) fails, never a pass`, probeOf(reply) === "PROBE_LOAD_FAILED");
}
const probeRecord = (failed: AiProbeCheckRecord["failed"], runtimeBuild = BUILD): AiProbeCheckRecord => ({ runtimeBuild, failed, checkedAt: "2026-09-29T12:00:00.000Z" });
const OTHER_BUILD = "node-llama-cpp@3.20.0+llama.cpp@v0.3.0";
const standing = (staticCheck: AiStaticCheckRecord | null, probeCheck: AiProbeCheckRecord | null) => compatibilityStanding({ staticCheck, probeCheck }, BUILD);
check("no stage run is unchecked", standing(null, null) === null);
check("a failed header is that check, whatever the probe said", standing(record("CHAT_TEMPLATE"), probeRecord(null)) === "CHAT_TEMPLATE");
check("a passed header with no probe is unchecked", standing(record(null), null) === null);
check("a probe from another runtime build is unchecked", standing(record(null), probeRecord(null, OTHER_BUILD)) === null);
check("a header from another runtime build is unchecked, whatever the probe said", standing(record(null, OTHER_BUILD), probeRecord(null)) === null);
check("a failed probe is that check", standing(record(null), probeRecord("THINKING_NOT_DISABLED")) === "THINKING_NOT_DISABLED");
check("both passed for this build is compatible", standing(record(null), probeRecord(null)) === "compatible");
check("no runtime pin is unchecked", compatibilityStanding({ staticCheck: record(null), probeCheck: probeRecord(null) }, null) === null);

const root2 = await mkdtemp(join(tmpdir(), "awkit-ai-compat-l8b3-"));
try {
  const source = join(root2, "source");
  await mkdir(source, { recursive: true });
  const aBytes = gguf(2048);
  const bBytes = gguf(3072);
  const curatedBytes = gguf(1024);
  const aFile = join(source, "A-Model.gguf");
  const bFile = join(source, "B-Model.gguf");
  const curatedFile = join(source, "curated.gguf");
  await writeFile(aFile, aBytes);
  await writeFile(bFile, bBytes);
  await writeFile(curatedFile, curatedBytes);
  const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  type Registered = { status: string; staticCheck?: AiStaticCheckRecord | null; probeCheck?: AiProbeCheckRecord | null; acknowledgedAt?: string | null; external?: { sha256: string } };

  // ── G. The store's probe verdict and acknowledgement ───────────────────────────────────────────────
  section("G. AiModelPackStore: probe verdict and acknowledgement");
  const modelsDir = join(root2, "models");
  let clock = Date.parse("2026-09-29T10:00:00.000Z");
  const store = new AiModelPackStore(modelsDir, [entryFor("curated", curatedBytes)], () => clock);
  const registryPath = join(modelsDir, "registry.json");
  await store.import(aFile);
  const fresh = (await store.status()) as Registered;
  check("a fresh registration has no probe verdict and no acknowledgement", fresh.status === "registered" && fresh.probeCheck === null && fresh.acknowledgedAt === null, fresh);
  check("a probe verdict for another model is not recorded", (await store.recordProbeCheck(sha(bBytes), probeRecord(null))) === false);
  for (const [label, bad] of [
    ["an unknown check", { ...probeRecord(null), failed: "CHAT_TEMPLATE" }],
    ["an empty runtime build", probeRecord(null, "")],
    ["a date that is not one", { ...probeRecord(null), checkedAt: "soon" }]
  ] as const) {
    check(`a malformed probe verdict (${label}) is not recorded`, (await store.recordProbeCheck(sha(aBytes), bad as AiProbeCheckRecord)) === false);
  }
  check("an acknowledgement for another model is not recorded", (await store.acknowledge(sha(bBytes))) === false);
  check("...and nothing was written", ((await store.status()) as Registered).probeCheck === null && ((await store.status()) as Registered).acknowledgedAt === null);
  await store.recordStaticCheck(sha(aBytes), record(null));
  check("the probe verdict for this model is recorded", (await store.recordProbeCheck(sha(aBytes), probeRecord(null))) === true);
  clock = Date.parse("2026-09-29T10:05:00.000Z");
  check("this model's acknowledgement is recorded", (await store.acknowledge(sha(aBytes))) === true);
  await store.recordStaticCheck(sha(aBytes), record(null));
  const kept = (await store.status()) as Registered;
  check(
    "the header verdict, the probe verdict and the acknowledgement are kept beside each other",
    isDeep(kept.staticCheck, record(null)) && isDeep(kept.probeCheck, probeRecord(null)) && kept.acknowledgedAt === "2026-09-29T10:05:00.000Z",
    kept
  );
  check("they survive a new store instance", ((await new AiModelPackStore(modelsDir, []).status()) as Registered).acknowledgedAt === "2026-09-29T10:05:00.000Z");
  const onDisk = JSON.parse(await readFile(registryPath, "utf8"));
  check("the registry holds them with no path", onDisk.active.external.probeCheck?.failed === null && typeof onDisk.active.external.acknowledgedAt === "string" && !JSON.stringify(onDisk).includes(root2.replace(/\\/g, "\\\\")), onDisk);
  const good = JSON.stringify(onDisk);
  const writeRegistry = (value: unknown) => writeFile(registryPath, JSON.stringify(value), "utf8");
  const l8b2 = structuredClone(onDisk);
  delete l8b2.active.external.probeCheck;
  delete l8b2.active.external.acknowledgedAt;
  await writeRegistry(l8b2);
  const old = (await store.status()) as Registered;
  check("an L8b.2 registry (a header verdict only) loads, unprobed and unacknowledged", old.status === "registered" && old.probeCheck === null && old.acknowledgedAt === null && isDeep(old.staticCheck, record(null)), old);
  for (const [label, field, value] of [
    ["a null probe verdict", "probeCheck", null],
    ["a probe verdict with a header check's code", "probeCheck", { ...probeRecord(null), failed: "CHAT_TEMPLATE" }],
    ["an array probe verdict", "probeCheck", [probeRecord(null)]],
    ["an acknowledgement that is not a date", "acknowledgedAt", "yes"],
    ["an acknowledgement that is true", "acknowledgedAt", true],
    ["a null acknowledgement", "acknowledgedAt", null]
  ] as const) {
    const forged = structuredClone(onDisk);
    forged.active.external[field] = value;
    await writeRegistry(forged);
    const got = await store.status();
    check(`a forged registry (${label}) reads unreadable`, got.status === "invalid" && got.reason === "REGISTRY_UNREADABLE", got);
  }
  await writeFile(registryPath, good, "utf8");
  await store.import(aFile);
  const again = (await store.status()) as Registered;
  check("re-importing the same file starts unprobed and unacknowledged", again.probeCheck === null && again.acknowledgedAt === null && again.staticCheck === null, again);
  await store.import(curatedFile);
  check("a probe verdict is never recorded on a curated pack", (await store.recordProbeCheck(sha(curatedBytes), probeRecord(null))) === false);
  check("a curated pack is never acknowledged", (await store.acknowledge(sha(curatedBytes))) === false);

  // ── H. runCompatibilityStages ──────────────────────────────────────────────────────────────────────
  section("H. runCompatibilityStages");
  const stageStore = new AiModelPackStore(join(root2, "stage-models"), []);
  const inspected: string[] = [];
  const probed: string[] = [];
  const stages = (inspect: (file: string) => Promise<AiModelHeader | null>, probe: (file: string) => Promise<AiModelProbe | null>, runtimeBuild: string | null = BUILD) =>
    runCompatibilityStages({
      store: stageStore,
      inspect: (file) => (inspected.push(file), inspect(file)),
      probe: (file) => (probed.push(file), probe(file)),
      runtimeBuild,
      now: () => Date.parse("2026-09-29T12:00:00.000Z")
    });
  const passing = async () => PASSING;
  const probing = async () => ({ ...FAKE_PASSING_PROBE });
  check("no model: not run, the host is not asked", (await stages(passing, probing)) === "not-run" && inspected.length === 0 && probed.length === 0);
  await stageStore.import(aFile);
  check("no runtime pin: not run, the host is not asked", (await stages(passing, probing, null)) === "not-run" && inspected.length === 0 && probed.length === 0);
  check("a failed header is its check, and the model is never probed", (await stages(async () => ({ ...PASSING, chatTemplate: "other" }), probing)) === "CHAT_TEMPLATE" && probed.length === 0);
  check("a header the host could not read: not run, never probed", (await stages(async () => null, probing)) === "not-run" && probed.length === 0);
  check("a probe the host could not run: not run", (await stages(passing, async () => null)) === "not-run");
  check("a probe that throws: not run", (await stages(passing, () => Promise.reject(new Error("host gone")))) === "not-run");
  check("a cancelled probe: not run", (await stages(passing, async () => ({ ...FAKE_PASSING_PROBE, stopReason: "cancelled" as const, text: "" }))) === "not-run");
  const unprobed = (await stageStore.status()) as Registered;
  check(
    "...and none of them recorded a probe verdict (the header's pass is recorded)",
    unprobed.probeCheck === null && isDeep(unprobed.staticCheck, { runtimeBuild: BUILD, failed: null, checkedAt: "2026-09-29T12:00:00.000Z" }),
    unprobed
  );
  check("the probe is asked for the stored model's own path", probed.length > 0 && probed.every((file) => file === stageStore.modelPath(sha(aBytes))), probed);
  check("a model that thinks is recorded as THINKING_NOT_DISABLED", (await stages(passing, async () => ({ ...FAKE_PASSING_PROBE, thinkingOff: false }))) === "THINKING_NOT_DISABLED");
  const thinking = (await stageStore.status()) as Registered;
  check("...with the runtime build and the time, and reads incompatible", isDeep(thinking.probeCheck, probeRecord("THINKING_NOT_DISABLED")) && compatibilityStanding(thinking as never, BUILD) === "THINKING_NOT_DISABLED", thinking);
  check("both stages passing is compatible", (await stages(passing, probing)) === "compatible");
  const compatible = (await stageStore.status()) as Registered;
  check("...recorded, and read compatible for this build only", compatibilityStanding(compatible as never, BUILD) === "compatible" && compatibilityStanding(compatible as never, OTHER_BUILD) === null, compatible);
  const probesBefore = probed.length;
  const racedHeader = await stages(async () => {
    await stageStore.import(bFile);
    return PASSING;
  }, probing);
  check("a model replaced while its header was read: not run, and the replacement is never probed", racedHeader === "not-run" && probed.length === probesBefore, { racedHeader, probed: probed.length - probesBefore });
  // The narrowest race: the header verdict lands on this model, then a replacement is imported before the probe.
  await stageStore.import(aFile);
  const probesBeforeSwap = probed.length;
  const swapping = {
    status: () => stageStore.status(),
    modelPath: (sha256: string) => stageStore.modelPath(sha256),
    recordProbeCheck: (sha256: string, check: AiProbeCheckRecord) => stageStore.recordProbeCheck(sha256, check),
    recordStaticCheck: async (sha256: string, check: AiStaticCheckRecord) => {
      const recorded = await stageStore.recordStaticCheck(sha256, check);
      await stageStore.import(bFile);
      return recorded;
    }
  };
  const swapped = await runCompatibilityStages({ store: swapping, inspect: passing, probe: (file) => (probed.push(file), probing()), runtimeBuild: BUILD });
  const afterSwap = (await stageStore.status()) as Registered;
  check(
    "a replacement imported after the header verdict and before the probe is never probed on that verdict",
    swapped === "not-run" && probed.length === probesBeforeSwap && afterSwap.external?.sha256 === sha(bBytes) && afterSwap.probeCheck === null,
    { swapped, probed: probed.length - probesBeforeSwap, afterSwap }
  );
  const racedProbe = await stages(passing, async () => {
    await stageStore.import(aFile);
    return { ...FAKE_PASSING_PROBE };
  });
  const afterRace = (await stageStore.status()) as Registered;
  check("a model replaced while it was probed: not run", racedProbe === "not-run", racedProbe);
  check("...and the replacement carries neither verdict", afterRace.external?.sha256 === sha(aBytes) && afterRace.staticCheck === null && afterRace.probeCheck === null, afterRace);
} finally {
  await rm(root2, { recursive: true, force: true });
}

// ── I. AiService.probeModel ───────────────────────────────────────────────────────────────────────────
section("I. AiService.probeModel");
const IDLE = { activeRuns: 0, queuedRuns: 0, pressureState: "stable" as const, dispatchBlocked: false, activeWeight: 0, weightedBudget: 100, freeMemoryMb: 1_000_000 };
{
  const fake = new FakeAiHostTransport({ modelRoot });
  const svc = service(fake);
  const reply = await svc.probeModel(inside);
  check("it answers the host's probe, with AI switched off", isDeep(reply, FAKE_PASSING_PROBE), reply);
  check("the CPU host's handshake came first", isDeep(fake.requestTypes(), ["hello", "probe"]), fake.requestTypes());
  const sent = fake.requests.find((request) => request.type === "probe") as Record<string, unknown> | undefined;
  check("it asks for the model at the product's 4K context and thread count, under its own job id", sent?.contextTokens === 4096 && sent?.threads === 2 && /^probe#\d+$/.test(String(sent?.jobId)), sent);
  check("a path outside the host's root is null", (await svc.probeModel(join(tmpdir(), "elsewhere.gguf"))) === null);
  await svc.shutdown();
  check("after shutdown it is null", (await svc.probeModel(inside)) === null);
}
{
  const held = new FakeAiHostTransport({ modelRoot });
  const busy = new AiService({
    transport: (backend) => (backend === "cpu" ? held : null),
    model: async () => ({ ok: false, reason: "MODEL_MISSING" }),
    settings: async () => ({ enabled: false, yieldDuringRuns: true, idleUnloadMs: 0, minFreeMemoryMb: 0 }),
    admission: () => ({ ...IDLE, activeRuns: 1 }),
    threads: 2,
    expectedRuntimeBuild: "b-fake"
  });
  check("while runs are active it waits: null, and the host is never asked", (await busy.probeModel(inside)) === null && held.requests.length === 0);
  const noSettings = new AiService({
    transport: (backend) => (backend === "cpu" ? held : null),
    model: async () => ({ ok: false, reason: "MODEL_MISSING" }),
    settings: () => Promise.reject(new Error("unreadable")),
    admission: () => IDLE,
    threads: 2,
    expectedRuntimeBuild: "b-fake"
  });
  check("unreadable settings: null, and the host is never asked", (await noSettings.probeModel(inside)) === null && held.requests.length === 0);
  const refused = new FakeAiHostTransport({ modelRoot, compatible: false });
  check("an incompatible host is null, and is never probed", (await service(refused).probeModel(inside)) === null && !refused.requestTypes().includes("probe"));
  const failing = new FakeAiHostTransport({ modelRoot, probe: { fail: "AI_HOST_EXITED" } });
  const svc = service(failing);
  check("a host that exits while probing is null", (await svc.probeModel(inside)) === null);
  await svc.probeModel(inside);
  check("...and the next probe handshakes the restarted host", failing.requestTypes().filter((type) => type === "hello").length === 2, failing.requestTypes());
  check("a GPU host is never used for it", !failing.requestTypes().includes("gpuPlan"));
}
{
  // A probe past its deadline: the host is still generating, so it is cancelled before anything else is sent.
  const calls: Array<{ type: string; jobId?: string }> = [];
  const stuck = {
    async call<T>(request: { type: string; jobId?: string }): Promise<T> {
      calls.push({ type: request.type, ...(request.jobId ? { jobId: request.jobId } : {}) });
      if (request.type === "hello") return { protocolVersion: 1, compatible: true, runtime: { name: "llama.cpp", build: "b-fake" }, backend: "cpu", platform: "win32", arch: "x64" } as T;
      if (request.type === "probe") throw new AiHostCallError("AI_HOST_TIMEOUT");
      throw new AiHostCallError("AI_HOST_KILLED_ON_CANCEL");
    },
    isAvailable: () => true,
    dispose: async () => undefined
  };
  const svc = new AiService({
    transport: (backend) => (backend === "cpu" ? (stuck as never) : null),
    model: async () => ({ ok: false, reason: "MODEL_MISSING" }),
    settings: async () => ({ enabled: false, yieldDuringRuns: true, idleUnloadMs: 0, minFreeMemoryMb: 0 }),
    admission: () => IDLE,
    threads: 2,
    expectedRuntimeBuild: "b-fake"
  });
  check("a timed-out probe is null", (await svc.probeModel(inside)) === null);
  const probeId = calls.find((call) => call.type === "probe")?.jobId;
  check("...and it is cancelled on the host, by its own job id", calls.some((call) => call.type === "cancel" && call.jobId === probeId) && probeId !== undefined, calls);
  await svc.probeModel(inside);
  check("a host killed to honour that cancel is forgotten: the next probe handshakes again", calls.filter((call) => call.type === "hello").length === 2, calls);
}
{
  // The probe replaces the CPU host's model, so the next job loads again.
  const fake = new FakeAiHostTransport({ modelRoot, respond: () => '{"ok":true}' });
  const svc = new AiService({
    transport: (backend) => (backend === "cpu" ? fake : null),
    model: async () => ({ ok: true, modelId: "m", modelPath: inside, contextTokens: 4096 }),
    settings: async () => ({ enabled: true, yieldDuringRuns: true, idleUnloadMs: 0, minFreeMemoryMb: 0 }),
    admission: () => IDLE,
    threads: 2,
    expectedRuntimeBuild: "b-fake"
  });
  const job = (requestId: string) =>
    svc.submit({
      requestId,
      feature: "validationExplanation",
      priority: "interactive",
      prompt: { instructions: "Answer.", fields: [], maxDataChars: 100 },
      schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
      maxOutputTokens: 16,
      timeoutMs: 5_000
    });
  const first = await job("before-probe");
  check("a job answers with its effective profile (CPU & RAM, the host's runtime build)", first.status === "ok" && isDeep(first.profile, { runtimeBuild: "b-fake", backend: "cpu", offload: "cpu" }), first);
  await svc.probeModel(inside);
  const second = await job("after-probe");
  const types = fake.requestTypes();
  check("after a probe the next job loads the model again", second.status === "ok" && types.lastIndexOf("load") > types.indexOf("probe"), types);
  await svc.shutdown();
}

// ── J. Qualification (L8b.4) ──────────────────────────────────────────────────────────────────────────
section("J. Qualification");
const ZERO_8B = AI_MODEL_MANIFEST.find((entry) => entry.id === "qwen3.5-0.8b-q4-k-m");
const FOUR_B = AI_MODEL_MANIFEST.find((entry) => entry.id === "qwen3.5-4b-q4-k-m");
const PRODUCT_BUDGETS = {
  validationExplanation: AUTHORING_LIMITS.maxOutputTokens,
  safeFixRanking: AUTHORING_LIMITS.maxOutputTokens,
  locatorSemanticUpgrade: LOCATOR_ATTEMPT_LIMITS.maxOutputTokens,
  locatorRepair: LOCATOR_ATTEMPT_LIMITS.maxOutputTokens,
  failureAnalysis: FAILURE_ANALYSIS_LIMITS.maxOutputTokens
};
const LIMITED_GO = ["locatorSemanticUpgrade", "failureAnalysis", "validationExplanation"];
check("(precondition) the manifest pins the 0.8B and the 4B", Boolean(ZERO_8B && FOUR_B));
check("every qualified-list entry is well formed", AI_QUALIFIED_CONFIGURATIONS.length > 0 && AI_QUALIFIED_CONFIGURATIONS.every(isValidAiQualifiedConfiguration));
check(
  "the list holds exactly the historical CPU evidence: the 0.8B, CPU & RAM, 4K, the pinned build, runtime KV defaults",
  AI_QUALIFIED_CONFIGURATIONS.length === 3 &&
    AI_QUALIFIED_CONFIGURATIONS.every(
      (entry) =>
        entry.modelSha256 === ZERO_8B?.sha256 &&
        entry.backend === "cpu" &&
        entry.offload === "cpu" &&
        entry.contextTokens === 4096 &&
        entry.kvCache === AI_KV_CACHE_SETTINGS &&
        entry.runtimeBuild === AI_RUNTIME_PIN.build
    ),
  AI_QUALIFIED_CONFIGURATIONS
);
check(
  "...for the owner's three limited-GO features, at the product's current budgets",
  isDeep(AI_QUALIFIED_CONFIGURATIONS.map((entry) => entry.feature).sort(), [...LIMITED_GO].sort()) &&
    AI_QUALIFIED_CONFIGURATIONS.every((entry) => entry.outputTokens === PRODUCT_BUDGETS[entry.feature as keyof typeof PRODUCT_BUDGETS]),
  AI_QUALIFIED_CONFIGURATIONS.map((entry) => `${entry.feature}:${entry.outputTokens}`)
);
check("the 4B (L1.8 NO-GO) has no entry", !AI_QUALIFIED_CONFIGURATIONS.some((entry) => entry.modelSha256 === FOUR_B?.sha256));
const baseKey: AiQualityKey = {
  modelSha256: ZERO_8B?.sha256 ?? "",
  runtimeBuild: AI_RUNTIME_PIN.build ?? "",
  backend: "cpu",
  offload: "cpu",
  contextTokens: 4096,
  kvCache: AI_KV_CACHE_SETTINGS,
  feature: "validationExplanation",
  outputTokens: AUTHORING_LIMITS.maxOutputTokens
};
check("the 0.8B's historical CPU key is qualified", isQualified(baseKey));
for (const [label, change] of [
  ["the GPU with every layer", { backend: "vulkan", offload: "full" }],
  ["a partial offload", { backend: "vulkan", offload: "partial:12" }],
  ["another context", { contextTokens: 2048 }],
  ["another runtime build", { runtimeBuild: OTHER_BUILD }],
  ["other KV settings", { kvCache: "q8" }],
  ["another feature", { feature: "locatorRepair" }],
  ["a raised output budget", { outputTokens: AUTHORING_LIMITS.maxOutputTokens + 1 }],
  ["another model (the 4B)", { modelSha256: FOUR_B?.sha256 ?? "" }]
] as const) {
  check(`one field changed (${label}) is not qualified`, !isQualified({ ...baseKey, ...change } as AiQualityKey));
}
const forgedList = [{ ...AI_QUALIFIED_CONFIGURATIONS[0], modelSha256: (ZERO_8B?.sha256 ?? "").toUpperCase() }, { ...AI_QUALIFIED_CONFIGURATIONS[0], backend: "cpu", offload: "full" }];
check("a malformed list entry qualifies nothing", !isQualified({ ...baseKey, feature: "locatorSemanticUpgrade", outputTokens: 256 }, forgedList as never));
const describe = (compatibility: "compatible" | "CHAT_TEMPLATE" | null, sha: string | undefined, configuration: Parameters<typeof describeQualification>[0]["configuration"], budgets: Record<string, number> = PRODUCT_BUDGETS) =>
  describeQualification({ compatibility, modelSha256: sha ?? null, runtimeBuild: AI_RUNTIME_PIN.build, configuration, featureBudgets: budgets, hardwareClass: "cpu8-ram16g-novram" });
const CPU = { backend: "cpu" as const, offload: "cpu" as const, contextTokens: 4096 };
const onCpu = describe("compatible", ZERO_8B?.sha256, CPU);
check(
  "the curated 0.8B reads Qualified on CPU & RAM for exactly its three features, in the product's order",
  onCpu.label === "qualified" && onCpu.reason === null && isDeep(onCpu.qualifiedFeatures, AI_FEATURE_IDS.filter((id) => LIMITED_GO.includes(id))),
  onCpu
);
const onGpu = describe("compatible", ZERO_8B?.sha256, { backend: "vulkan", offload: "full", contextTokens: 4096 });
check("a GPU run of the same model reads Compatible but unqualified, for its configuration", onGpu.label === "compatible-unqualified" && onGpu.reason === "NOT_QUALIFIED_ON_THIS_CONFIGURATION" && onGpu.qualifiedFeatures.length === 0, onGpu);
const partial = describe("compatible", ZERO_8B?.sha256, { backend: "vulkan", offload: "partial:10", contextTokens: 4096 });
check("...and so does a partial offload", partial.label === "compatible-unqualified" && partial.reason === "NOT_QUALIFIED_ON_THIS_CONFIGURATION");
const undecided = describe("compatible", ZERO_8B?.sha256, null);
check("before a GPU mode's first load nothing is claimed", undecided.label === "compatible-unqualified" && undecided.reason === "CONFIGURATION_NOT_DECIDED");
const fourB = describe("compatible", FOUR_B?.sha256, CPU);
check("the curated 4B on CPU reads Compatible but unqualified: no quality evidence", fourB.label === "compatible-unqualified" && fourB.reason === "NO_QUALITY_EVIDENCE", fourB);
const external = describe("compatible", "e".repeat(64), CPU);
check("a compatible registered model reads Compatible but unqualified: no quality evidence", external.label === "compatible-unqualified" && external.reason === "NO_QUALITY_EVIDENCE");
check("a failed check reads Incompatible with that check", isDeep([describe("CHAT_TEMPLATE", "e".repeat(64), CPU).label, describe("CHAT_TEMPLATE", "e".repeat(64), CPU).reason], ["incompatible", "CHAT_TEMPLATE"]));
check("a model not checked for this runtime reads unchecked", describe(null, "e".repeat(64), CPU).label === "unchecked");
const raised = describe("compatible", ZERO_8B?.sha256, CPU, { ...PRODUCT_BUDGETS, validationExplanation: 256 });
check("a raised budget unqualifies that feature only", raised.label === "qualified" && !raised.qualifiedFeatures.includes("validationExplanation") && raised.qualifiedFeatures.length === 2, raised);
check("latency is never claimed, and the hardware class is reported", onCpu.latency.claimed === false && onCpu.latency.hardwareClass === "cpu8-ram16g-novram");
check("the hardware class is coarse: powers of two, no identity", hardwareClassOf({ logicalCpus: 12, totalMemoryMb: 16_265, vramTotalBytes: null }) === "cpu8-ram8g-novram" && hardwareClassOf({ logicalCpus: 16, totalMemoryMb: 32_768, vramTotalBytes: 8 * 1024 ** 3 }) === "cpu16-ram32g-vram8g");
check("the latency class is the quality key on a hardware class", latencyClassId(baseKey, "cpu8-ram16g-novram") === `${qualityKeyId(baseKey)}@cpu8-ram16g-novram`);

function isDeep(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 && passed > 0 ? 0 : 1);
