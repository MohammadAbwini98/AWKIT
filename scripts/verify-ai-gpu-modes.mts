/**
 * verify:ai-gpu-modes — Phase L L8a.3 execution modes against deterministic fake hosts.
 *
 * The production `AiService`, settings sanitizer and execution policy run unmodified; only the two host
 * TRANSPORTS are `FakeAiHostTransport`s (a CPU one and a Vulkan one), which reproduce the real host's
 * backend rules (a CPU host refuses a GPU plan and offloaded layers, a GPU host needs 1..1024 layers).
 *
 * What makes it fail: CPU & RAM only touching the GPU host; old settings or garbage not reading as CPU;
 * an adapter proven NVIDIA by anything but PCI vendor 0x10DE, or a mixed/unknown set read as NVIDIA;
 * GPU-Offload not loading the largest fitting count, not retrying smaller a bounded number of times, or
 * not falling back to the CPU with its reason; GPU-Only ever falling back, retrying smaller, or refusing
 * without the exact shortfall; a missing/tampered pack, no adapter or no usable device reaching a GPU
 * load; a mode or reserve change not reloading, or reloading mid-inference; a GPU host left holding VRAM
 * after a fallback, a refusal, an idle unload or a release; cancel, crash and shutdown not following the
 * active host. L8a.4 (section G): a load not reporting its real stage at each host request, or a stage
 * surviving the load; a fallback or refusal found under an old mode or reserve still reported (reason,
 * sentence or GPU-Only unavailability) after the setting changed; the next load's profile not belonging
 * to the current mode and reserve; the plan's VRAM figures not reported, or invented where no plan ran.
 *
 * Real NVIDIA hardware is NOT exercised here (E11). Run: npm run verify:ai-gpu-modes
 */

import { join, resolve } from "node:path";

import {
  AI_GPU_REASON_MESSAGES,
  classifyAdapters,
  decideGpuLoad,
  describeAdapters,
  GPU_LOAD_RETRIES,
  NVIDIA_PCI_VENDOR_ID,
  retryLayers,
  toExecutionView,
  unprovenDevices,
  type AiGpuReadiness,
  type AiGpuReason
} from "@src/ai/AiExecutionProfile";
import type { AiAdmissionView } from "@src/ai/AiAdmission";
import type { AiOutputSchema } from "@src/ai/AiOutputContract";
import { AiService, type AiJobRequest, type AiServiceSettings } from "@src/ai/AiService";
import { DEFAULT_AI_SETTINGS, MAX_VRAM_RESERVE_MB, MIN_VRAM_RESERVE_MB, normalizeAiSettings, sanitizeAiSettingsPatch, type AiExecutionMode } from "@src/ai/AiSettings";
import type { AiGpuPlan, AiHostRequestPayload, AiLoadRequest } from "@src/ai/contracts/AiHostProtocol";
import { FakeAiHostTransport, type FakeAiHostOptions } from "@src/ai/FakeAiHostTransport";

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

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const MIB = 1024 ** 2;
const GIB = 1024 ** 3;
const MODEL_ROOT = resolve("fake-model-root");
const IDLE: AiAdmissionView = { activeRuns: 0, queuedRuns: 0, pressureState: "stable", dispatchBlocked: false, activeWeight: 0, weightedBudget: 100, freeMemoryMb: 1_000_000 };
const SCHEMA: AiOutputSchema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };

function job(requestId: string): AiJobRequest {
  return {
    requestId,
    feature: "locatorSemanticUpgrade",
    priority: "interactive",
    prompt: { instructions: "Answer whether the element is a button.", fields: [{ name: "element", text: "Save changes" }], maxDataChars: 2_000 },
    schema: SCHEMA,
    maxOutputTokens: 32,
    timeoutMs: 10_000
  };
}

function plan(fitLayers: number, overrides: Partial<AiGpuPlan> = {}): AiGpuPlan {
  return { deviceCount: 1, totalLayers: 24, fitLayers, fullRequiredBytes: 3 * GIB, reserveBytes: 256 * MIB, freeBytes: 2 * GIB, totalBytes: 8 * GIB, ...overrides };
}

const NVIDIA_ONE: AiGpuReadiness = { ok: true, nvidiaAdapters: 1 };

interface World {
  cpu: FakeAiHostTransport;
  gpu: FakeAiHostTransport | null;
  settings: AiServiceSettings;
  service: AiService;
  run: (id: string) => ReturnType<AiService["submit"]>;
}

function world(options: {
  mode?: AiExecutionMode;
  reserveBytes?: number | null;
  readiness?: AiGpuReadiness | (() => Promise<AiGpuReadiness>) | null;
  cpu?: FakeAiHostOptions;
  gpu?: FakeAiHostOptions | null;
  idleUnloadMs?: number;
  verifyModel?: () => Promise<boolean>;
}): World {
  const respond = () => '{"ok":true}';
  const cpu = new FakeAiHostTransport({ modelRoot: MODEL_ROOT, respond, ...options.cpu });
  const gpu = options.gpu === null ? null : new FakeAiHostTransport({ modelRoot: MODEL_ROOT, backend: "vulkan", respond, ...options.gpu });
  const settings: AiServiceSettings = {
    enabled: true,
    yieldDuringRuns: false,
    idleUnloadMs: options.idleUnloadMs ?? 0,
    minFreeMemoryMb: 0,
    ...(options.mode ? { executionMode: options.mode } : {}),
    ...(options.reserveBytes !== undefined ? { vramReserveBytes: options.reserveBytes } : {})
  };
  const readiness = options.readiness;
  const service = new AiService({
    transport: (backend) => (backend === "cpu" ? cpu : gpu),
    ...(readiness === null ? {} : { gpu: typeof readiness === "function" ? readiness : async () => readiness ?? NVIDIA_ONE }),
    model: async () => ({ ok: true, modelId: "model-a", modelPath: join(MODEL_ROOT, "model-a.gguf"), contextTokens: 4096 }),
    ...(options.verifyModel ? { verifyModel: options.verifyModel } : {}),
    settings: async () => settings,
    admission: () => IDLE,
    threads: 4,
    nonce: () => "0123456789abcdef"
  });
  return { cpu, gpu, settings, service, run: (id) => service.submit(job(id)) };
}

const loads = (transport: FakeAiHostTransport | null): AiLoadRequest[] =>
  (transport?.requests ?? []).filter((request): request is AiLoadRequest => request.type === "load");
const types = (transport: FakeAiHostTransport | null) => transport?.requestTypes() ?? [];

// ── A. Settings ──────────────────────────────────────────────────────────────────────────────────
console.log("A. Settings: mode and VRAM reserve\n");
{
  check("the default mode is CPU & RAM only", DEFAULT_AI_SETTINGS.executionMode === "cpu" && DEFAULT_AI_SETTINGS.vramReserveMb === null);
  const old = normalizeAiSettings({ schemaVersion: 1, enabled: true, yieldDuringRuns: true, idleUnloadMinutes: 10, featureTiers: {} });
  check("a settings file from before L8a loads unchanged, as CPU with the default reserve", old.enabled === true && old.executionMode === "cpu" && old.vramReserveMb === null);
  check("an unknown mode on disk reads as CPU (fail closed)", normalizeAiSettings({ executionMode: "gpu-turbo" }).executionMode === "cpu");
  check("an out-of-range reserve on disk reads as the default", normalizeAiSettings({ vramReserveMb: 5 }).vramReserveMb === null);
  check("both GPU modes round-trip", normalizeAiSettings({ executionMode: "gpu-offload" }).executionMode === "gpu-offload" && normalizeAiSettings({ executionMode: "gpu-only" }).executionMode === "gpu-only");
  for (const mode of ["cpu", "gpu-offload", "gpu-only"]) {
    const result = sanitizeAiSettingsPatch({ executionMode: mode });
    check(`the patch accepts ${mode}`, result.ok && result.value.executionMode === mode);
  }
  for (const [label, patch] of [
    ["an unknown mode", { executionMode: "auto" }],
    ["a mode as a number", { executionMode: 1 }],
    ["a reserve below the bound", { vramReserveMb: MIN_VRAM_RESERVE_MB - 1 }],
    ["a reserve above the bound", { vramReserveMb: MAX_VRAM_RESERVE_MB + 1 }],
    ["a fractional reserve", { vramReserveMb: 512.5 }],
    ["a string reserve", { vramReserveMb: "512" }]
  ] as const) {
    check(`the patch refuses ${label}, never clamping`, !sanitizeAiSettingsPatch(patch).ok);
  }
  const bounds = sanitizeAiSettingsPatch({ vramReserveMb: MIN_VRAM_RESERVE_MB });
  const reset = sanitizeAiSettingsPatch({ vramReserveMb: null });
  check("the reserve accepts its bounds and null (the system default)", bounds.ok && bounds.value.vramReserveMb === MIN_VRAM_RESERVE_MB && reset.ok && reset.value.vramReserveMb === null);
}

// ── B. Policy ────────────────────────────────────────────────────────────────────────────────────
console.log("\nB. E2 and E4 policy\n");
{
  const AMD = 0x1002;
  const INTEL = 0x8086;
  const SOFT = 0x1414;
  const reason = (readiness: AiGpuReadiness) => (readiness.ok ? `ok:${readiness.nvidiaAdapters}` : readiness.reason);
  check("NVIDIA is PCI vendor 0x10DE", NVIDIA_PCI_VENDOR_ID === 0x10de);
  const cases: Array<[string, number[] | null, string]> = [
    ["no adapter at all", [], "NO_COMPATIBLE_ADAPTER"],
    ["an unreadable adapter list", null, "VENDOR_UNPROVEN"],
    ["only an AMD adapter (this machine)", [AMD], "NO_COMPATIBLE_ADAPTER"],
    ["only an Intel adapter", [INTEL], "NO_COMPATIBLE_ADAPTER"],
    ["only the software adapter", [SOFT], "NO_COMPATIBLE_ADAPTER"],
    ["one NVIDIA adapter", [0x10de], "ok:1"],
    ["one NVIDIA adapter beside the software adapter", [SOFT, 0x10de], "ok:1"],
    ["two NVIDIA adapters", [0x10de, 0x10de], "ok:2"],
    ["a hybrid laptop (Intel + NVIDIA)", [INTEL, 0x10de], "VENDOR_UNPROVEN"],
    ["AMD + NVIDIA", [AMD, 0x10de], "VENDOR_UNPROVEN"],
    ["an adapter of unknown vendor", [0], "VENDOR_UNPROVEN"],
    ["NVIDIA beside an adapter of unknown vendor", [0, 0x10de], "VENDOR_UNPROVEN"]
  ];
  for (const [label, ids, want] of cases) check(`${label}: ${want}`, reason(classifyAdapters(ids)) === want, reason(classifyAdapters(ids)));
  check("eligibility reads IDs only, never a name", !/name|model|brand/i.test(classifyAdapters.toString()));
  check("the runtime binding no device is NO_USABLE_DEVICE", unprovenDevices(0, 1) === "NO_USABLE_DEVICE");
  check("one device per NVIDIA adapter is proven", unprovenDevices(1, 1) === null && unprovenDevices(2, 2) === null && unprovenDevices(1, 2) === null);
  check("a device beyond the NVIDIA adapters is VENDOR_UNPROVEN", unprovenDevices(2, 1) === "VENDOR_UNPROVEN");
  check("adapters are described by vendor ID", JSON.stringify(describeAdapters([0x10de, SOFT])) === JSON.stringify([{ vendorId: "0x10de", nvidia: true, software: false }, { vendorId: "0x1414", nvidia: false, software: true }]));

  check("GPU-Offload loads every layer when they all fit", JSON.stringify(decideGpuLoad("gpu-offload", plan(24))) === JSON.stringify({ action: "load", layers: 24 }));
  check("GPU-Offload loads the largest fitting count", JSON.stringify(decideGpuLoad("gpu-offload", plan(10))) === JSON.stringify({ action: "load", layers: 10 }));
  check("GPU-Offload with nothing fitting falls back for VRAM", JSON.stringify(decideGpuLoad("gpu-offload", plan(0))) === JSON.stringify({ action: "fallback", reason: "INSUFFICIENT_VRAM" }));
  check("GPU-Only loads every layer when they all fit", JSON.stringify(decideGpuLoad("gpu-only", plan(24))) === JSON.stringify({ action: "load", layers: 24 }));
  const short = decideGpuLoad("gpu-only", plan(23));
  check(
    "GPU-Only one layer short refuses with the exact shortfall (need + reserve vs free)",
    short.action === "refuse" && short.reason === "INSUFFICIENT_VRAM" && short.requiredBytes === 3 * GIB + 256 * MIB && short.availableBytes === 2 * GIB,
    short
  );
  check("GPU-Only never falls back", decideGpuLoad("gpu-only", plan(0)).action === "refuse");
  check(`the retry halves the layers at most ${GPU_LOAD_RETRIES} times`, retryLayers(20, 0) === 10 && retryLayers(10, 1) === 5 && retryLayers(5, 2) === null);
  check("the retry never goes below one layer", retryLayers(1, 0) === null);
  const reasons: AiGpuReason[] = ["BACKEND_PACK_MISSING", "BACKEND_PACK_INVALID", "BACKEND_UNAVAILABLE", "NO_COMPATIBLE_ADAPTER", "VENDOR_UNPROVEN", "NO_USABLE_DEVICE", "INSUFFICIENT_VRAM", "GPU_LOAD_FAILED"];
  check("every reason has one short sentence", reasons.every((r) => typeof AI_GPU_REASON_MESSAGES[r] === "string" && AI_GPU_REASON_MESSAGES[r].length < 100) && Object.keys(AI_GPU_REASON_MESSAGES).length === reasons.length);
}

// ── C. CPU & RAM only ────────────────────────────────────────────────────────────────────────────
console.log("\nC. CPU & RAM only (default)\n");
{
  const w = world({});
  const outcome = await w.run("cpu-1");
  check("a job answers with no mode set", outcome.status === "ok", outcome);
  check("the GPU host is never touched", types(w.gpu).length === 0, types(w.gpu));
  check("the CPU host loads with no GPU layers", loads(w.cpu).length === 1 && loads(w.cpu)[0].gpuLayers === undefined);
  const execution = (await w.service.status()).execution;
  check("the profile is CPU with no fallback", execution.mode === "cpu" && execution.backend === "cpu" && execution.gpuLayers === 0 && execution.fallbackReason === null && execution.refusal === null, execution);
  const explicit = world({ mode: "cpu", readiness: NVIDIA_ONE, gpu: { gpuPlan: plan(24) } });
  await explicit.run("cpu-2");
  check("CPU mode stays off the GPU even with an eligible NVIDIA GPU and pack", types(explicit.gpu).length === 0);
}

// ── D. GPU unavailable: fallback or refusal ──────────────────────────────────────────────────────
console.log("\nD. Missing, tampered or ineligible GPU components\n");
{
  const scenarios: Array<[string, Parameters<typeof world>[0], AiGpuReason, boolean]> = [
    ["no backend pack", { readiness: { ok: false, reason: "BACKEND_PACK_MISSING" } }, "BACKEND_PACK_MISSING", false],
    ["an invalid backend pack", { readiness: { ok: false, reason: "BACKEND_PACK_INVALID" } }, "BACKEND_PACK_INVALID", false],
    ["no GPU at all", { readiness: classifyAdapters([]) }, "NO_COMPATIBLE_ADAPTER", false],
    ["an unsupported (non-NVIDIA) GPU", { readiness: classifyAdapters([0x1002]) }, "NO_COMPATIBLE_ADAPTER", false],
    ["a hybrid laptop", { readiness: classifyAdapters([0x8086, 0x10de]) }, "VENDOR_UNPROVEN", false],
    ["no GPU readiness wired", { readiness: null }, "BACKEND_UNAVAILABLE", false],
    ["no GPU host in this build", { gpu: null }, "BACKEND_UNAVAILABLE", false],
    ["readiness that throws", { readiness: async () => Promise.reject(new Error("boom")) }, "BACKEND_UNAVAILABLE", false],
    ["a pack that fails its check before the GPU host starts (tampered)", { gpu: { helloFails: "AI_GPU_BACKEND_REFUSED", gpuPlan: plan(24) } }, "BACKEND_PACK_INVALID", true],
    ["a GPU host whose backend is not Vulkan", { gpu: { backend: "cpu" } }, "BACKEND_UNAVAILABLE", true],
    ["an incompatible GPU host", { gpu: { compatible: false, gpuPlan: plan(24) } }, "BACKEND_UNAVAILABLE", true],
    ["no usable Vulkan device", { gpu: { gpuPlan: { fail: "AI_GPU_NO_USABLE_DEVICE" } } }, "NO_USABLE_DEVICE", true],
    ["more Vulkan devices than NVIDIA adapters", { gpu: { gpuPlan: plan(24, { deviceCount: 2 }) } }, "VENDOR_UNPROVEN", true],
    ["nothing fitting in VRAM", { gpu: { gpuPlan: plan(0) } }, "INSUFFICIENT_VRAM", true]
  ];
  for (const [label, setup, reason, reachesGpuHost] of scenarios) {
    const offload = world({ ...setup, mode: "gpu-offload" });
    const answered = await offload.run(`${reason}-off`);
    const profile = (await offload.service.status()).execution;
    check(`GPU-Offload, ${label}: runs on CPU`, answered.status === "ok" && loads(offload.cpu).length === 1 && loads(offload.gpu).length === 0, { answered, cpu: types(offload.cpu), gpu: types(offload.gpu) });
    check(`GPU-Offload, ${label}: the reason ${reason} is kept`, profile.backend === "cpu" && profile.mode === "gpu-offload" && profile.fallbackReason === reason && profile.refusal === null, profile);
    if (reachesGpuHost) check(`GPU-Offload, ${label}: the GPU host is stopped, holding no VRAM`, (offload.gpu?.releases ?? 0) >= 1);

    const only = world({ ...setup, mode: "gpu-only" });
    const refused = await only.run(`${reason}-only`);
    const status = await only.service.status();
    check(`GPU-Only, ${label}: refused, never a silent CPU fallback`, refused.status === "rejected" && refused.code === "UNAVAILABLE" && refused.reason === "GPU_UNAVAILABLE" && loads(only.cpu).length === 0, refused);
    check(`GPU-Only, ${label}: the refusal names ${reason} and the AI reads unavailable`, status.execution.refusal?.reason === reason && status.state.kind === "unavailable" && status.state.reason === "GPU_UNAVAILABLE", status.execution);
  }
}

// ── E. Sizing, retries and the shortfall ────────────────────────────────────────────────────────
console.log("\nE. VRAM sizing and bounded retry\n");
{
  const full = world({ mode: "gpu-offload", gpu: { gpuPlan: plan(24) } });
  const ok = await full.run("full-1");
  const profile = (await full.service.status()).execution;
  check("sufficient VRAM: GPU-Offload loads every layer on the GPU host", ok.status === "ok" && loads(full.gpu).map((l) => l.gpuLayers).join() === "24", loads(full.gpu));
  check("...infers there, never on the CPU host", full.gpu?.inferRequests().length === 1 && types(full.cpu).length === 0);
  check("...and reports vulkan 24/24", profile.backend === "vulkan" && profile.gpuLayers === 24 && profile.totalLayers === 24 && profile.requestedLayers === 24 && profile.fallbackReason === null, profile);
  check("...with the plan asked for the configured context and threads", full.gpu?.requests.some((r) => r.type === "gpuPlan" && r.contextTokens === 4096 && r.threads === 4 && r.reserveBytes === null));
  await full.run("full-2");
  check("the next job reuses the load (no second plan)", full.gpu?.requests.filter((r) => r.type === "gpuPlan").length === 1 && loads(full.gpu).length === 1);

  const onlyFull = world({ mode: "gpu-only", gpu: { gpuPlan: plan(24) } });
  check("sufficient VRAM: GPU-Only loads every layer", (await onlyFull.run("only-full")).status === "ok" && loads(onlyFull.gpu).map((l) => l.gpuLayers).join() === "24");

  const low = world({ mode: "gpu-offload", gpu: { gpuPlan: plan(10) } });
  await low.run("low-1");
  const lowProfile = (await low.service.status()).execution;
  check("low VRAM: GPU-Offload offloads the largest fitting count", loads(low.gpu).map((l) => l.gpuLayers).join() === "10" && lowProfile.gpuLayers === 10 && lowProfile.totalLayers === 24, lowProfile);

  const lowOnly = world({ mode: "gpu-only", gpu: { gpuPlan: plan(10) } });
  await lowOnly.run("low-only");
  const refusal = (await lowOnly.service.status()).execution.refusal;
  check("low VRAM: GPU-Only refuses with the exact shortfall", refusal?.reason === "INSUFFICIENT_VRAM" && refusal.requiredBytes === 3 * GIB + 256 * MIB && refusal.availableBytes === 2 * GIB, refusal);
  check("...loads nothing anywhere and stops the GPU host", loads(lowOnly.gpu).length === 0 && loads(lowOnly.cpu).length === 0 && (lowOnly.gpu?.releases ?? 0) >= 1);

  const retry = world({ mode: "gpu-offload", gpu: { gpuPlan: plan(20), gpuLoadFailAbove: 12 } });
  const retried = await retry.run("retry-1");
  const retryProfile = (await retry.service.status()).execution;
  check("a failed GPU load retries with half the layers", retried.status === "ok" && loads(retry.gpu).map((l) => l.gpuLayers).join() === "20,10", loads(retry.gpu).map((l) => l.gpuLayers));
  check("...and reports what ran against what was asked", retryProfile.gpuLayers === 10 && retryProfile.requestedLayers === 20 && retryProfile.backend === "vulkan", retryProfile);

  const spent = world({ mode: "gpu-offload", gpu: { gpuPlan: plan(20), gpuLoadFailAbove: 4 } });
  const fellBack = await spent.run("spent-1");
  const spentProfile = (await spent.service.status()).execution;
  check(`the retry is bounded: ${1 + GPU_LOAD_RETRIES} GPU attempts, then CPU`, loads(spent.gpu).map((l) => l.gpuLayers).join() === "20,10,5" && fellBack.status === "ok" && loads(spent.cpu).length === 1, loads(spent.gpu).map((l) => l.gpuLayers));
  check("...with GPU_LOAD_FAILED kept as the reason", spentProfile.backend === "cpu" && spentProfile.fallbackReason === "GPU_LOAD_FAILED", spentProfile);

  const onlyFails = world({ mode: "gpu-only", gpu: { gpuPlan: plan(24), loadFails: true } });
  const onlyFailed = await onlyFails.run("only-fail");
  check("GPU-Only never retries with fewer layers", loads(onlyFails.gpu).map((l) => l.gpuLayers).join() === "24");
  check("...and refuses with GPU_LOAD_FAILED instead of falling back", onlyFailed.status === "rejected" && (await onlyFails.service.status()).execution.refusal?.reason === "GPU_LOAD_FAILED" && loads(onlyFails.cpu).length === 0);

  const reserved = world({ mode: "gpu-offload", reserveBytes: 512 * MIB, gpu: { gpuPlan: plan(24) } });
  await reserved.run("reserve-1");
  check("the configured reserve reaches the plan in bytes", reserved.gpu?.requests.some((r) => r.type === "gpuPlan" && r.reserveBytes === 512 * MIB));
}

// ── F. Mode changes, lifecycle ───────────────────────────────────────────────────────────────────
console.log("\nF. Mode changes and host lifecycle\n");
{
  const w = world({ gpu: { gpuPlan: plan(24) } });
  await w.run("switch-1");
  check("starts on the CPU host", loads(w.cpu).length === 1 && loads(w.gpu).length === 0);
  w.settings.executionMode = "gpu-offload";
  check("changing the mode loads nothing until the next job", loads(w.gpu).length === 0 && !types(w.cpu).includes("unload"));
  await w.run("switch-2");
  check("the next job unloads the CPU host and loads on the GPU host", types(w.cpu).includes("unload") && loads(w.gpu).length === 1 && (await w.service.status()).execution.backend === "vulkan");
  w.settings.vramReserveBytes = 1024 * MIB;
  await w.run("switch-3");
  check("changing the reserve re-plans and reloads", w.gpu?.requests.filter((r) => r.type === "gpuPlan").length === 2 && loads(w.gpu).length === 2);
  w.settings.executionMode = "cpu";
  await w.run("switch-4");
  check("back to CPU: the GPU host is unloaded and stopped, the CPU host reloads", types(w.gpu).includes("unload") && (w.gpu?.releases ?? 0) >= 1 && loads(w.cpu).length === 2 && (await w.service.status()).execution.backend === "cpu");

  const mid = world({ gpu: { gpuPlan: plan(24) }, cpu: { respond: () => ({ text: '{"ok":true}', delayMs: 60 }) } });
  const running = mid.run("mid-1");
  await sleep(20);
  mid.settings.executionMode = "gpu-offload";
  const finished = await running;
  check("a mode change never lands mid-inference: the running job finishes on its host", finished.status === "ok" && types(mid.gpu).length === 0 && !types(mid.cpu).includes("unload"));

  const crash = world({ mode: "gpu-offload", gpu: { gpuPlan: plan(24), respond: (_request, index) => (index === 0 ? { crash: true, delayMs: 10 } : '{"ok":true}') } });
  const crashed = await crash.run("crash-1");
  check("a GPU host crash fails the running job", crashed.status === "failed" && crashed.code === "HOST_ERROR", crashed);
  const recovered = await crash.run("crash-2");
  check("the next job re-handshakes, re-plans and reloads on the GPU host", recovered.status === "ok" && types(crash.gpu).filter((t) => t === "hello").length === 2 && crash.gpu?.requests.filter((r) => r.type === "gpuPlan").length === 2, types(crash.gpu));

  const cancel = world({ mode: "gpu-offload", gpu: { gpuPlan: plan(24), respond: () => ({ hang: true }) } });
  const pending = cancel.run("cancel-1");
  await sleep(40);
  cancel.service.cancel("cancel-1");
  const cancelled = await pending;
  check("a cancel reaches the GPU host that runs the job", cancelled.status === "cancelled" && types(cancel.gpu).includes("cancel") && !types(cancel.cpu).includes("cancel"), { cancelled, gpu: types(cancel.gpu) });

  const idle = world({ mode: "gpu-offload", idleUnloadMs: 20, gpu: { gpuPlan: plan(24) } });
  await idle.run("idle-1");
  await sleep(120);
  check("an idle unload also stops the GPU host (frees VRAM)", types(idle.gpu).includes("unload") && (idle.gpu?.releases ?? 0) >= 1);

  const release = world({ mode: "gpu-offload", gpu: { gpuPlan: plan(24) } });
  await release.run("release-1");
  await release.service.releaseModel();
  check("releaseModel stops the GPU host (a pack can then be replaced)", (release.gpu?.releases ?? 0) >= 1 && (await release.service.status()).loadedModelId === null);
  await release.run("release-2");
  check("...and the next job starts a fresh GPU host", types(release.gpu).filter((t) => t === "hello").length === 2);

  const shutdown = world({ mode: "gpu-offload", gpu: { gpuPlan: plan(24) } });
  await shutdown.run("shutdown-1");
  await shutdown.service.shutdown();
  check("shutdown disposes both hosts", !shutdown.cpu.isAvailable() && !shutdown.gpu?.isAvailable());
}

// ── G. L8a.4: load stages, current-setting ownership, VRAM figures ──────────────────────────────
console.log("\nG. L8a.4: load stages, current-setting ownership and the plan's VRAM figures\n");
{
  /**
   * A world whose readiness check, model verification and every host request record the service's own
   * `status().loadStage` at the moment they run: each stage is observed where the load actually is.
   */
  function traced(options: Parameters<typeof world>[0]): World & { seen: string[]; loadingStates: Set<string> } {
    const seen: string[] = [];
    // The AI state read while a load stage (other than the unload before it) was set.
    const loadingStates = new Set<string>();
    let probe: World | null = null;
    const at = async (label: string): Promise<void> => {
      const status = await probe!.service.status();
      seen.push(`${label}@${status.loadStage ?? "idle"}`);
      if (status.loadStage && status.loadStage !== "unloading") loadingStates.add(status.state.kind);
    };
    const readiness = options.readiness === undefined ? NVIDIA_ONE : options.readiness;
    const w = world({
      ...options,
      readiness:
        readiness === null
          ? null
          : async () => {
              await at("readiness");
              return typeof readiness === "function" ? readiness() : readiness;
            },
      verifyModel: async () => {
        await at("verify");
        return true;
      }
    });
    probe = w;
    for (const [name, host] of [["cpu", w.cpu], ["gpu", w.gpu]] as const) {
      if (!host) continue;
      const call = host.call.bind(host);
      host.call = (async (request: AiHostRequestPayload, timeoutMs: number) => {
        await at(`${name}:${request.type}`);
        return call(request, timeoutMs);
      }) as typeof host.call;
    }
    return Object.assign(w, { seen, loadingStates });
  }
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

  // Load stages, in the production AiLoadStage vocabulary.
  const offload = traced({ mode: "gpu-offload", gpu: { gpuPlan: plan(20), gpuLoadFailAbove: 12 } });
  const idle = await offload.service.status();
  check("before any job: no load stage, nothing loaded, the AI available", idle.loadStage === null && idle.loadedModelId === null && idle.state.kind === "available", idle);
  await offload.run("stage-offload");
  const offloadStages = ["verify@verifying-model", "readiness@checking-gpu", "gpu:hello@starting-gpu-host", "gpu:gpuPlan@planning-gpu", "gpu:load@loading-gpu", "gpu:load@retrying-gpu", "gpu:infer@idle"];
  check("GPU-Offload: verify, readiness, GPU host start, plan, load and the smaller retry each report their own stage", same(offload.seen, offloadStages), offload.seen);
  check("...the AI reads loading, never available or busy, while a stage is set", [...offload.loadingStates].join() === "loading", [...offload.loadingStates]);
  const ready = await offload.service.status();
  check("...and the stage clears once the model is ready (the inference ran with none)", ready.loadStage === null && ready.loadedModelId === "model-a" && ready.state.kind === "available", ready);

  const falling = traced({ mode: "gpu-offload", gpu: { gpuPlan: plan(0) } });
  await falling.run("stage-fallback");
  check(
    "GPU-Offload fallback: the CPU handshake and load report falling-back, not a plain CPU load",
    same(falling.seen, ["verify@verifying-model", "readiness@checking-gpu", "gpu:hello@starting-gpu-host", "gpu:gpuPlan@planning-gpu", "cpu:hello@falling-back", "cpu:load@falling-back", "cpu:infer@idle"]),
    falling.seen
  );

  const cpu = traced({ gpu: { gpuPlan: plan(24) } });
  await cpu.run("stage-cpu");
  check("CPU & RAM only: loading-cpu, and no GPU readiness check at all", same(cpu.seen, ["verify@verifying-model", "cpu:hello@loading-cpu", "cpu:load@loading-cpu", "cpu:infer@idle"]), cpu.seen);
  cpu.settings.executionMode = "gpu-offload";
  const firstSwitch = cpu.seen.length;
  await cpu.run("stage-switch");
  check(
    "a mode change: the old load is dropped under unloading, then the GPU load runs its stages",
    same(cpu.seen.slice(firstSwitch), ["cpu:unload@unloading", "verify@verifying-model", "readiness@checking-gpu", "gpu:hello@starting-gpu-host", "gpu:gpuPlan@planning-gpu", "gpu:load@loading-gpu", "gpu:infer@idle"]),
    cpu.seen.slice(firstSwitch)
  );

  const refusing = traced({ mode: "gpu-only", gpu: { gpuPlan: plan(10) } });
  await refusing.run("stage-refusal");
  const refusedStatus = await refusing.service.status();
  check("GPU-Only refusal: the stages stop at the plan, nothing is loaded", same(refusing.seen, ["verify@verifying-model", "readiness@checking-gpu", "gpu:hello@starting-gpu-host", "gpu:gpuPlan@planning-gpu"]), refusing.seen);
  check("...the stage clears, and the refusal is reported by state and profile, not by a stage", refusedStatus.loadStage === null && refusedStatus.state.kind === "unavailable" && refusedStatus.execution.refusal?.reason === "INSUFFICIENT_VRAM", refusedStatus);

  const failing = traced({ mode: "gpu-only", gpu: { gpuPlan: plan(24), loadFails: true } });
  await failing.run("stage-failure");
  check(
    "GPU-Only load failure: one loading-gpu attempt, no retrying-gpu, then the stage clears",
    same(failing.seen, ["verify@verifying-model", "readiness@checking-gpu", "gpu:hello@starting-gpu-host", "gpu:gpuPlan@planning-gpu", "gpu:load@loading-gpu"]) && (await failing.service.status()).loadStage === null,
    failing.seen
  );

  const unready = traced({ mode: "gpu-only", readiness: { ok: false, reason: "BACKEND_PACK_MISSING" } });
  await unready.run("stage-unready");
  check("GPU-Only without a pack: refused at checking-gpu, before any GPU host starts", same(unready.seen, ["verify@verifying-model", "readiness@checking-gpu"]) && types(unready.gpu).length === 0, unready.seen);

  // Current-setting ownership: a reason is reported only for the mode AND reserve that produced it.
  const reservePlan = plan(0, { reserveBytes: 512 * MIB });
  const own = world({ mode: "gpu-offload", reserveBytes: 512 * MIB, gpu: { gpuPlan: reservePlan } });
  const current = async () => {
    const status = await own.service.status();
    return { status, view: toExecutionView(status, own.settings.executionMode ?? "cpu", NVIDIA_ONE) };
  };
  await own.run("own-fallback");
  let now = await current();
  check(
    "1. GPU-Offload falls back and it reads as current: reason, its sentence, the configured mode, loaded",
    now.status.executionApplied && now.view.applied && now.view.mode === "gpu-offload" && now.view.backend === "cpu" && now.view.fallbackReason === "INSUFFICIENT_VRAM" && now.view.message === AI_GPU_REASON_MESSAGES.INSUFFICIENT_VRAM && now.view.modelLoaded,
    now.view
  );
  check(
    "...with the VRAM figures of the plan that decided it (required, free, total, reserve)",
    same(now.view.vram, { totalBytes: 8 * GIB, freeBytes: 2 * GIB, reserveBytes: 512 * MIB, fullRequiredBytes: 3 * GIB }),
    now.view.vram
  );

  own.settings.vramReserveBytes = 1024 * MIB;
  now = await current();
  check(
    "2. the reserve alone changes: the fallback no longer reads as current (no reason, sentence or refusal)",
    !now.status.executionApplied && !now.view.applied && now.view.mode === "gpu-offload" && now.view.fallbackReason === null && now.view.message === null && now.view.refusal === null,
    now.view
  );
  check("...the change itself loads and plans nothing; the next job applies it", loads(own.cpu).length === 1 && loads(own.gpu).length === 0 && own.gpu?.requests.filter((r) => r.type === "gpuPlan").length === 1);

  own.settings.executionMode = "gpu-only";
  now = await current();
  check(
    "3. the mode changes too: the configured mode is shown and the old fallback is still not current",
    !now.status.executionApplied && !now.view.applied && now.view.mode === "gpu-only" && now.view.fallbackReason === null && now.view.message === null,
    now.view
  );

  reservePlan.reserveBytes = 1024 * MIB; // the runtime plans with the reserve it was asked for
  const refused = await own.run("own-refusal");
  now = await current();
  check("4. GPU-Only refuses under the new settings, planned with the new reserve", refused.status === "rejected" && own.gpu?.requests.some((r) => r.type === "gpuPlan" && r.reserveBytes === 1024 * MIB), refused);
  check(
    "...and the refusal is current and belongs to them: made in GPU-Only, the exact shortfall, its sentence",
    now.status.executionApplied &&
      now.status.execution.mode === "gpu-only" &&
      now.view.applied &&
      now.view.refusal?.reason === "INSUFFICIENT_VRAM" &&
      now.view.refusal.requiredBytes === 3 * GIB + 1024 * MIB &&
      now.view.refusal.availableBytes === 2 * GIB &&
      now.view.message === AI_GPU_REASON_MESSAGES.INSUFFICIENT_VRAM &&
      now.view.fallbackReason === null &&
      now.view.vram?.reserveBytes === 1024 * MIB,
    now.view
  );
  check("...and the AI reads unavailable under exactly these settings", now.status.state.kind === "unavailable" && now.status.state.reason === "GPU_UNAVAILABLE", now.status.state);

  own.settings.vramReserveBytes = 2048 * MIB;
  now = await current();
  check(
    "5. the reserve alone changes: the old refusal is lifted from the AI state and the view",
    !(now.status.state.kind === "unavailable" && now.status.state.reason === "GPU_UNAVAILABLE") && !now.view.applied && now.view.refusal === null && now.view.message === null,
    { state: now.status.state, view: now.view }
  );

  own.settings.executionMode = "gpu-offload";
  reservePlan.fitLayers = 24;
  reservePlan.reserveBytes = 2048 * MIB;
  const succeeded = await own.run("own-success");
  now = await current();
  check(
    "6. a success under GPU-Offload with a 2048 MB reserve is current and belongs to them",
    succeeded.status === "ok" &&
      now.status.executionApplied &&
      now.status.execution.mode === "gpu-offload" &&
      now.view.applied &&
      now.view.modelLoaded &&
      now.view.backend === "vulkan" &&
      now.view.fallbackReason === null &&
      now.view.refusal === null &&
      now.view.message === null,
    now.view
  );
  check(
    "...planned with that reserve: all 24 of 24 layers on the GPU and that plan's VRAM figures",
    own.gpu?.requests.some((r) => r.type === "gpuPlan" && r.reserveBytes === 2048 * MIB) &&
      now.view.gpuLayers === 24 &&
      now.view.totalLayers === 24 &&
      now.view.requestedLayers === 24 &&
      same(now.view.vram, { totalBytes: 8 * GIB, freeBytes: 2 * GIB, reserveBytes: 2048 * MIB, fullRequiredBytes: 3 * GIB }),
    now.view
  );
  own.settings.executionMode = "gpu-only";
  const modeOnly = (await current()).status.executionApplied;
  own.settings.executionMode = "gpu-offload";
  const restored = (await current()).status.executionApplied;
  check("7. the mode alone decides too: another mode is not current, the producing one is again", modeOnly === false && restored === true, { modeOnly, restored });

  // VRAM figures: the plan's own numbers where a plan ran, never invented where none did.
  const partial = world({ mode: "gpu-offload", gpu: { gpuPlan: plan(10) } });
  await partial.run("vram-partial");
  const partialView = toExecutionView(await partial.service.status(), "gpu-offload", NVIDIA_ONE);
  check(
    "a partial offload reports the layers placed against the total and asked, with the plan's VRAM",
    partialView.backend === "vulkan" && partialView.gpuLayers === 10 && partialView.totalLayers === 24 && partialView.requestedLayers === 10 && same(partialView.vram, { totalBytes: 8 * GIB, freeBytes: 2 * GIB, reserveBytes: 256 * MIB, fullRequiredBytes: 3 * GIB }),
    partialView
  );
  const cpuOnly = world({ gpu: { gpuPlan: plan(24) } });
  await cpuOnly.run("vram-cpu");
  const noPack = world({ mode: "gpu-offload", readiness: { ok: false, reason: "BACKEND_PACK_MISSING" } });
  await noPack.run("vram-no-pack");
  const noPackOnly = world({ mode: "gpu-only", readiness: { ok: false, reason: "BACKEND_PACK_MISSING" } });
  await noPackOnly.run("vram-no-pack-only");
  const noPlan = [cpuOnly, noPack, noPackOnly].map((w) => w.service.status());
  const noPlanVram = (await Promise.all(noPlan)).map((status) => status.execution.vram);
  check("no VRAM figures where no plan ran: CPU mode, a GPU-Offload fallback and a GPU-Only refusal before the plan", noPlanVram.every((vram) => vram === null) && noPlanVram.length === 3, noPlanVram);
  const noPackView = toExecutionView(await noPackOnly.service.status(), "gpu-only", { ok: false, reason: "BACKEND_PACK_MISSING" });
  check(
    "...and a refusal before any plan has no shortfall to give, while readiness names its reason and sentence",
    noPackView.refusal?.reason === "BACKEND_PACK_MISSING" && noPackView.refusal.requiredBytes === null && noPackView.refusal.availableBytes === null && noPackView.gpuReadiness.ok === false && noPackView.gpuReadiness.reason === "BACKEND_PACK_MISSING" && noPackView.gpuReadiness.message === AI_GPU_REASON_MESSAGES.BACKEND_PACK_MISSING,
    noPackView
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 && passed > 0 ? 0 : 1);
