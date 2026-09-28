/**
 * verify:ai-model-compatibility — Phase L L8b.2, the static header stage outside the host.
 *
 * The host's own reading is verify:ai-host (fake runtime) and verify:ai-model-inspect (real host,
 * runtime and models). This covers what decides and records, against real temporary folders and the
 * deterministic fake host:
 *  A. `staticVerdict`: each check fails on its own, at its boundary, first failure wins, every code is
 *     reachable, and a malformed host reply is never a pass;
 *  B. `staticStanding`: a verdict counts only for the runtime build that produced it;
 *  C. `AiModelPackStore.recordStaticCheck` and the registry: recorded only on the active registered
 *     model, never on a curated one or a replacement; L8b.1 registries load; forged verdicts read
 *     unreadable; a re-import starts unchecked;
 *  D. `runStaticStage`: not run (and nothing recorded) whenever the host cannot answer, and never
 *     recorded on a model replaced while the host was reading;
 *  E. `AiService.inspectModel`: the CPU host's handshake first, null whenever the host cannot run it,
 *     and it runs with AI switched off.
 *
 * Run: npm run verify:ai-model-compatibility
 */

import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AI_STATIC_CHECKS, runStaticStage, staticStanding, staticVerdict } from "@src/ai/AiModelCompatibility";
import { AiModelPackStore, type AiStaticCheckRecord } from "@src/ai/AiModelPack";
import { AiService } from "@src/ai/AiService";
import type { AiModelHeader } from "@src/ai/contracts/AiHostProtocol";
import { FAKE_QWEN_HEADER, FakeAiHostTransport } from "@src/ai/FakeAiHostTransport";
import type { AiModelManifestEntry } from "@src/offline/AiModelManifest";

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

function isDeep(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 && passed > 0 ? 0 : 1);
