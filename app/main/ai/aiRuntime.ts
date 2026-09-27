/**
 * Main-process owner of the optional local-AI subsystem (Phase L, L1).
 *
 * Lazy and non-throwing. Nothing is constructed at startup and nothing spawns until an admitted
 * inference needs the host. With no runtime in the build, no pinned runtime build in the manifest,
 * or no model pack, every entry point answers with a code and the application behaves exactly as
 * before Phase L. Settings, the audit log and revert never need the model.
 *
 * All mutable state lives under `<runtime data root>/ai`, never in resources or app.asar.
 */

import { app } from "electron";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path, { join } from "node:path";

import { deriveInferenceThreads } from "@src/ai/AiAdmission";
import { AiActionStore, type AiAppendResult } from "@src/ai/AiActionStore";
import {
  AiBackendPackStore,
  backendRefusalMessage,
  backendTrustSources,
  resolveBackendTrust,
  type AiBackendPackStatus,
  type BackendTrust
} from "@src/ai/AiBackendPack";
import { describeAdapters, toExecutionView, type AiGpuReadiness } from "@src/ai/AiExecutionProfile";
import { AiModelPackStore, type AiModelPackStatus } from "@src/ai/AiModelPack";
import { revertAiAction } from "@src/ai/AiRevert";
import { AiService, type AiServiceDeps } from "@src/ai/AiService";
import { FakeAiHostTransport, type FakeInferStep } from "@src/ai/FakeAiHostTransport";
import { AiSettingsStore, MAX_IDLE_UNLOAD_MINUTES, MAX_VRAM_RESERVE_MB, MIN_VRAM_RESERVE_MB, sanitizeAiSettingsPatch } from "@src/ai/AiSettings";
import type { AiGpuPlan, AiHostBackend, AiHostReason } from "@src/ai/contracts/AiHostProtocol";
import type {
  AiAdminResponse,
  AiAuditView,
  AiBackendPackView,
  AiBackendPreflightResponse,
  AiDiagnosticsView,
  AiModelPackView,
  AiSettingsView,
  AiStatusView
} from "@src/ai/contracts/AiApi";
import { AI_BACKEND_MANIFEST, AI_MODEL_MANIFEST, AI_RUNTIME_PIN } from "@src/offline/AiModelManifest";
import { readSignedDependencyManifest } from "@src/offline/SupplyChainIntegrity";
import { detectMachineCapabilities } from "@src/runner/concurrency/MachineCapabilityDetector";
import { executionEngine } from "@src/runner/ExecutionEngine";
import {
  AI_FEATURE_CEILINGS,
  AI_FEATURE_IDS,
  effectiveAiTier,
  type AiFeatureId,
  type AiPolicyConfig
} from "@src/security/authz/AiAutonomyPolicy";

import { getRuntimeDataRoot } from "../appPaths";
import { createFlowProfileStore } from "../profileStores";
import { AiUtilityHostManager } from "./AiUtilityHostManager";
import { displayAdapterVendorIds, gpuReadiness } from "./gpuAdapters";

const aiRoot = (): string => join(getRuntimeDataRoot(), "ai");
const modelsDir = (): string => join(aiRoot(), "models");

let settingsStore: AiSettingsStore | null = null;
let auditStore: AiActionStore | null = null;
let packStore: AiModelPackStore | null = null;
let hostManager: AiUtilityHostManager | null = null;
let gpuHostManager: AiUtilityHostManager | null = null;
let service: AiService | null = null;

const settings = (): AiSettingsStore => (settingsStore ??= new AiSettingsStore(join(aiRoot(), "ai-settings.json")));
const audit = (): AiActionStore => (auditStore ??= new AiActionStore(join(aiRoot(), "ai-actions.json")));
const modelPack = (): AiModelPackStore => (packStore ??= new AiModelPackStore(modelsDir(), AI_MODEL_MANIFEST));

function logAi(level: "info" | "warn" | "error", message: string): void {
  const line = `[ai] ${message}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** The packaged or repository host script, or null when this build does not include the runtime. */
function resolveHostPath(): string | null {
  const candidate = app.isPackaged
    ? path.join(process.resourcesPath, "native-hosts", "ai", "ai-host.cjs")
    : path.join(app.getAppPath(), "native-hosts", "ai", "ai-host.cjs");
  return fs.existsSync(candidate) ? candidate : null;
}

/**
 * A transport exists only when the host is present AND the manifest pins its runtime build. The GPU
 * host additionally needs the pin to admit Vulkan; the pack itself is checked before every fork.
 */
function transport(backend: AiHostBackend = "cpu"): AiUtilityHostManager | null {
  const hostPath = resolveHostPath();
  if (!hostPath || !AI_RUNTIME_PIN.build) return null;
  if (backend === "cpu") {
    hostManager ??= new AiUtilityHostManager({ hostPath, modelRoot: modelsDir(), log: logAi });
    return hostManager;
  }
  if (!AI_RUNTIME_PIN.backends.includes("vulkan")) return null;
  gpuHostManager ??= new AiUtilityHostManager({
    hostPath,
    modelRoot: modelsDir(),
    backend: {
      kind: "vulkan",
      // The L8a.2 load-time guard, run immediately before every GPU host starts.
      verify: async () => {
        const verdict = await backendPack().verifyForLoad();
        return verdict.ok ? { ok: true, dir: verdict.dir } : { ok: false };
      }
    },
    log: logAi
  });
  return gpuHostManager;
}


const inferenceThreads = (): number => deriveInferenceThreads(detectMachineCapabilities("local").logicalCpuCount);

/**
 * Test-only deterministic provider for the real-Electron GUI verifiers — the `AWKIT_TEST_LICENSE_BYPASS`
 * pattern. The variable names a JSON file holding ONE `FakeInferStep`, re-read on every inference so a
 * verifier can script the next answer. `app.isPackaged` is checked first, so a shipped build never even
 * reads the variable, and no setting, flag or IPC call reaches it. It replaces the transport and the
 * model pack only: the queue, admission, prompt builder and output contract stay the production ones.
 */
const TEST_PROVIDER_ENV = "AWKIT_TEST_AI_PROVIDER";

/**
 * The test provider's GPU side (L8a.4 GUI verifier): `AWKIT_TEST_AI_GPU` names a JSON file giving the
 * backend pack's state, the display adapters' PCI vendor IDs and the fake GPU host's plan, re-read on
 * every use. Only with the test provider, so never in a packaged build. The production E2 classifier
 * still decides from these IDs, and nothing here qualifies any real GPU.
 */
const TEST_GPU_ENV = "AWKIT_TEST_AI_GPU";
interface TestGpuFixture {
  pack: AiBackendPackStatus["status"];
  adapters: number[] | null;
  plan?: AiGpuPlan | { fail: AiHostReason };
  gpuLoadFailAbove?: number;
  /** A slow GPU load, so the verifier can watch a load's stage. */
  loadDelayMs?: number;
}

function testGpuFixture(): TestGpuFixture | null {
  if (app.isPackaged || !process.env[TEST_PROVIDER_ENV] || !process.env[TEST_GPU_ENV]) return null;
  try {
    return JSON.parse(fs.readFileSync(process.env[TEST_GPU_ENV], "utf8")) as TestGpuFixture;
  } catch {
    return null;
  }
}

const adapterVendorIds = (): Promise<number[] | null> => {
  const fixture = testGpuFixture();
  return fixture ? Promise.resolve(fixture.adapters) : displayAdapterVendorIds();
};

/** The one readiness answer: what the next GPU load decides, and what status and diagnostics show. */
function currentGpuReadiness(): Promise<AiGpuReadiness> {
  const fixture = testGpuFixture();
  return fixture ? gpuReadiness({ status: async () => ({ status: fixture.pack }) }, adapterVendorIds) : gpuReadiness(backendPack());
}

function testProviderDeps(): Pick<AiServiceDeps, "transport" | "model" | "verifyModel" | "expectedRuntimeBuild"> | null {
  if (app.isPackaged) return null;
  const script = process.env[TEST_PROVIDER_ENV];
  if (!script) return null;
  const modelRoot = join(aiRoot(), "test-provider");
  const respond = (): FakeInferStep => {
    try {
      return JSON.parse(fs.readFileSync(script, "utf8")) as FakeInferStep;
    } catch {
      return { text: "{}" };
    }
  };
  const fake = new FakeAiHostTransport({ modelRoot, respond });
  const gpuFake = new FakeAiHostTransport({
    modelRoot,
    respond,
    backend: "vulkan",
    get gpuPlan() {
      return testGpuFixture()?.plan;
    },
    get gpuLoadFailAbove() {
      return testGpuFixture()?.gpuLoadFailAbove;
    },
    get loadDelayMs() {
      return testGpuFixture()?.loadDelayMs;
    }
  });
  logAi("warn", "test AI provider active (non-packaged build)");
  return {
    transport: (backend) => (backend === "vulkan" ? gpuFake : fake),
    model: async () => ({ ok: true, modelId: "test-deterministic-provider", modelPath: join(modelRoot, "test.gguf"), contextTokens: 4096 }),
    verifyModel: async () => true,
    expectedRuntimeBuild: undefined
  };
}

export function getAiService(): AiService {
  const testProvider = service ? null : testProviderDeps();
  service ??= new AiService({
    transport,
    gpu: currentGpuReadiness,
    model: async () => {
      const status = await modelPack().status();
      if (status.status === "missing") return { ok: false, reason: "MODEL_MISSING" };
      if (status.status !== "installed") return { ok: false, reason: "MODEL_INVALID" };
      return {
        ok: true,
        modelId: status.entry.id,
        modelPath: modelPack().modelPath(status.entry.sha256),
        contextTokens: status.entry.contextTokens
      };
    },
    verifyModel: async (model) => {
      const status = await modelPack().status();
      return status.status === "installed" && status.entry.id === model.modelId && modelPack().verifyForLoad(status.entry.sha256);
    },
    settings: async () => {
      const current = await settings().read();
      return {
        enabled: current.enabled,
        yieldDuringRuns: current.yieldDuringRuns,
        idleUnloadMs: current.idleUnloadMinutes * 60_000,
        minFreeMemoryMb: executionEngine.getAiAdmissionView().minFreeMemoryMb,
        executionMode: current.executionMode,
        vramReserveBytes: current.vramReserveMb === null ? null : current.vramReserveMb * 1024 ** 2
      };
    },
    admission: () => executionEngine.getAiAdmissionView(),
    threads: inferenceThreads(),
    expectedRuntimeBuild: AI_RUNTIME_PIN.build ?? undefined,
    log: logAi,
    ...testProvider
  });
  return service;
}

/** Policy input for feature modules (L3 onward): the switch, configured tiers and persisted demotions. */
export async function aiPolicyConfig(): Promise<AiPolicyConfig> {
  const [current, snapshot] = await Promise.all([settings().read(), audit().snapshot()]);
  return { enabled: current.enabled, featureTiers: current.featureTiers, demotedFeatures: Object.keys(snapshot.demotions) };
}

function packView(status: AiModelPackStatus): AiModelPackView {
  if (status.status === "installed") {
    return { status: "installed", reason: null, modelId: status.entry.id, displayName: status.entry.displayName };
  }
  if (status.status === "missing") return { status: "missing", reason: null, modelId: null, displayName: null };
  return { status: status.status, reason: status.reason, modelId: null, displayName: null };
}

const readPack = (): Promise<AiModelPackStatus> =>
  modelPack()
    .status()
    .catch((): AiModelPackStatus => ({ status: "invalid", reason: "REGISTRY_UNREADABLE" }));

export async function aiStatusView(): Promise<AiStatusView> {
  const [status, pack, current, readiness] = await Promise.all([getAiService().status(), readPack(), settings().read(), currentGpuReadiness()]);
  const state = status.state;
  return {
    enabled: current.enabled,
    state: state.kind,
    reason: state.kind === "unavailable" ? state.reason : state.kind === "error" ? state.code : null,
    holdReason: status.holdReason,
    queueDepth: status.queueDepth,
    modelPack: packView(pack),
    execution: toExecutionView(status, current.executionMode, readiness)
  };
}

export async function aiSettingsView(): Promise<AiSettingsView> {
  const [current, snapshot] = await Promise.all([settings().read(), audit().snapshot()]);
  const config: AiPolicyConfig = { enabled: current.enabled, featureTiers: current.featureTiers, demotedFeatures: Object.keys(snapshot.demotions) };
  return {
    enabled: current.enabled,
    yieldDuringRuns: current.yieldDuringRuns,
    idleUnloadMinutes: current.idleUnloadMinutes,
    maxIdleUnloadMinutes: MAX_IDLE_UNLOAD_MINUTES,
    features: AI_FEATURE_IDS.map((id) => ({
      id,
      ceiling: AI_FEATURE_CEILINGS[id],
      configured: current.featureTiers[id] ?? null,
      effective: effectiveAiTier(id, config),
      demotion: snapshot.demotions[id] ?? null
    })),
    executionMode: current.executionMode,
    vramReserveMb: current.vramReserveMb,
    minVramReserveMb: MIN_VRAM_RESERVE_MB,
    maxVramReserveMb: MAX_VRAM_RESERVE_MB
  };
}

export async function updateAiSettings(patch: unknown): Promise<AiAdminResponse> {
  const sanitized = sanitizeAiSettingsPatch(patch);
  if (!sanitized.ok) return { code: "SETTINGS_REJECTED", ok: false, message: sanitized.errors.join(" ") };
  let before: Awaited<ReturnType<AiSettingsStore["read"]>>;
  try {
    before = await settings().read();
    await settings().update(sanitized.value);
  } catch {
    return { code: "SETTINGS_REJECTED", ok: false, message: "The AI settings could not be saved." };
  }
  // A new mode or reserve drops an idle load now (freeing the GPU host and its VRAM) rather than
  // keeping it under the old setting; a running job finishes first and the next one reloads.
  const { executionMode = before.executionMode, vramReserveMb = before.vramReserveMb } = sanitized.value;
  if (executionMode !== before.executionMode || vramReserveMb !== before.vramReserveMb) await getAiService().releaseModel();
  // A switch-off rejects queued work at once rather than on the next admission retry.
  getAiService().notifyAdmissionChanged();
  return { code: "OK", ok: true };
}

/** The explicit administrator re-promotion after self-demotion. */
export async function restoreAiFeature(feature: AiFeatureId): Promise<AiAdminResponse> {
  try {
    const cleared = await audit().clearDemotion(feature);
    return cleared ? { code: "OK", ok: true } : { code: "NOT_FOUND", ok: false, message: "That feature is not demoted." };
  } catch {
    return { code: "NOT_AVAILABLE", ok: false, message: "The AI audit store could not be updated." };
  }
}

export async function aiDiagnosticsView(): Promise<AiDiagnosticsView> {
  const [status, pack, current, adapters, readiness] = await Promise.all([
    getAiService().status(),
    readPack(),
    settings().read(),
    adapterVendorIds(),
    currentGpuReadiness()
  ]);
  const host = hostManager?.status();
  const gpuHost = gpuHostManager?.status();
  const installed = pack.status === "installed" ? pack.entry : null;
  return {
    runtime: {
      included: resolveHostPath() !== null,
      pinnedBuild: AI_RUNTIME_PIN.build,
      hostState: host?.state ?? "stopped",
      circuitOpen: host?.circuitOpen ?? false,
      lastReason: host?.lastReason ?? null
    },
    gpuHost: { state: gpuHost?.state ?? "stopped", circuitOpen: gpuHost?.circuitOpen ?? false, lastReason: gpuHost?.lastReason ?? null },
    modelPack: {
      ...packView(pack),
      sha256: installed?.sha256 ?? null,
      sizeBytes: installed?.sizeBytes ?? null,
      manifestEntries: AI_MODEL_MANIFEST.length
    },
    execution: toExecutionView(status, current.executionMode, readiness),
    adapters: adapters === null ? null : describeAdapters(adapters),
    threads: inferenceThreads(),
    counters: status.counters
  };
}

/**
 * Append an applied AI change to the audit log (L3 §6 promotion; L3 §8 repair later). The store
 * re-sanitizes whatever it is given, so a record is never trusted because of where it came from.
 */
export function appendAiActionRecord(record: unknown): Promise<AiAppendResult> {
  return audit().append(record);
}

export async function aiAuditView(page: { limit: number; offset: number }): Promise<AiAuditView> {
  const { records } = await audit().snapshot();
  return { records: records.slice(page.offset, page.offset + page.limit), total: records.length };
}

export async function revertAiActionFromAudit(actionId: string): Promise<AiAdminResponse> {
  const result = await revertAiAction(actionId, { audit: audit(), flows: createFlowProfileStore() });
  if (result.code === "OK") {
    return result.auditMarked === false
      ? { code: "OK", ok: true, message: "Reverted. The audit log could not be updated." }
      : { code: "OK", ok: true };
  }
  if (result.code === "NOT_FOUND") return { code: "NOT_FOUND", ok: false, message: "That AI action is not in the audit log." };
  return { code: "REVERT_REFUSED", ok: false, detail: result.code, message: revertMessage(result.code) };
}

function revertMessage(code: string): string {
  switch (code) {
    case "STALE":
      return "The locator was edited after the AI change, so it was not reverted.";
    case "ALREADY_REVERTED":
      return "This change was already reverted.";
    case "FLOW_NOT_FOUND":
    case "STEP_NOT_FOUND":
      return "The flow or step no longer exists.";
    default:
      return "The change could not be reverted.";
  }
}

export async function importAiModelPack(sourcePath: string): Promise<AiAdminResponse> {
  await getAiService().releaseModel();
  const result = await modelPack()
    .import(sourcePath)
    .catch(() => ({ ok: false as const, code: "COPY_FAILED" as const }));
  if (result.ok) return { code: "OK", ok: true, detail: result.entry.id };
  const messages: Record<string, string> = {
    NOT_A_FILE: "The selected item is not a file.",
    NOT_GGUF: "The selected file is not a GGUF model.",
    SIZE_NOT_IN_MANIFEST: "This model pack is not one this version of SpecterStudio accepts.",
    NOT_IN_MANIFEST: "This model pack's checksum is not one this version of SpecterStudio accepts.",
    COPY_FAILED: "The model pack could not be copied into the app's data folder."
  };
  return { code: "IMPORT_REFUSED", ok: false, detail: result.code, message: messages[result.code] };
}

export async function removeAiModelPack(): Promise<AiAdminResponse> {
  await getAiService().releaseModel();
  try {
    await modelPack().remove();
    return { code: "OK", ok: true };
  } catch {
    return { code: "NOT_AVAILABLE", ok: false, message: "The model pack could not be removed." };
  }
}

// ── GPU backend pack (L8a.2) ──────────────────────────────────────────────────────────────────────
//
// Imported and verified only; nothing loads it yet (L8a.3), so CPU inference is untouched by every
// path below. The store's `verifyForLoad` is the boundary the host must pass before any backend load.

let backendStore: AiBackendPackStore | null = null;
const PREFLIGHT_TTL_MS = 10 * 60_000;
/** The folder the last ready checklist covered, named to the renderer only by its token. */
let pendingPreflight: { token: string; owner: number; source: string; at: number } | null = null;
let activeImport: { owner: number; controller: AbortController } | null = null;

function backendPack(): AiBackendPackStore {
  if (backendStore) return backendStore;
  const entry = AI_BACKEND_MANIFEST.find((candidate) => candidate.id === "vulkan") ?? null;
  const build = AI_RUNTIME_PIN.build;
  const sources = backendTrustSources({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath() });
  backendStore = new AiBackendPackStore({
    root: join(aiRoot(), "backends"),
    entry,
    runtimeBuild: build,
    trust: async (): Promise<BackendTrust> =>
      entry && build
        ? resolveBackendTrust({ signed: await readSignedDependencyManifest(sources.resourcesRoot), hostRoot: sources.hostRoot, entry, runtimeBuild: build })
        : { ok: false, code: "SIGNED_MANIFEST_MISMATCH", detail: "no backend is pinned" }
  });
  // Staging a crash or cancellation left behind is removed once per session, queued ahead of any import.
  void backendStore.recover().catch(() => undefined);
  return backendStore;
}

export async function aiBackendPackView(): Promise<AiBackendPackView> {
  const store = backendPack();
  const status = await store
    .status()
    .catch((): AiBackendPackStatus => ({ status: "invalid", reason: "REGISTRY_UNREADABLE", path: null, record: null }));
  const entry = AI_BACKEND_MANIFEST.find((candidate) => candidate.id === "vulkan") ?? null;
  const record = status.status === "installed" || status.status === "invalid" ? status.record : null;
  const refused = status.status === "invalid" || status.status === "unavailable" ? status : null;
  return {
    backend: entry?.id ?? null,
    pinnedBuild: AI_RUNTIME_PIN.build,
    packageVersion: entry?.packageVersion ?? null,
    status: status.status,
    reason: refused?.reason ?? null,
    message: refused ? backendRefusalMessage(refused.reason, "path" in refused ? refused.path : null) : null,
    sizeBytes: record?.sizeBytes ?? null,
    fileCount: record?.fileCount ?? null,
    installedAt: record?.installedAt ?? null,
    lastVerifiedAt: record?.lastVerifiedAt ?? null,
    importing: store.importProgress()
  };
}

/** Check the folder the main process just picked; a ready folder is remembered for its owner only. */
export async function preflightAiBackendPack(owner: number, source: string): Promise<AiBackendPreflightResponse> {
  const preflight = await backendPack()
    .preflight(source)
    .catch(() => null);
  if (!preflight) {
    return { code: "IMPORT_REFUSED", ok: false, detail: "COPY_FAILED", message: backendRefusalMessage("COPY_FAILED"), preflight: null };
  }
  const token = preflight.ready ? randomBytes(16).toString("hex") : "";
  pendingPreflight = preflight.ready ? { token, owner, source, at: Date.now() } : null;
  const view = {
    token,
    ready: preflight.ready,
    backend: preflight.backend,
    pinnedBuild: preflight.runtimeBuild,
    packageVersion: preflight.packageVersion,
    source,
    destination: preflight.destination,
    requiredBytes: preflight.requiredBytes,
    headroomBytes: preflight.headroomBytes,
    availableBytes: preflight.availableBytes,
    identicalInstalled: preflight.identicalInstalled,
    filesValidated: preflight.filesValidated,
    fileCount: preflight.fileCount,
    checks: preflight.checks
  };
  if (preflight.ready) return { code: "OK", ok: true, preflight: view };
  return {
    code: "IMPORT_REFUSED",
    ok: false,
    detail: preflight.code ?? "COPY_FAILED",
    message: backendRefusalMessage(preflight.code ?? "COPY_FAILED", preflight.path),
    preflight: view
  };
}

/** Import the folder a ready checklist covered. The renderer names it only by that checklist's token. */
export async function importAiBackendPack(owner: number, token: string): Promise<AiAdminResponse> {
  const pending = pendingPreflight;
  if (!pending || pending.token !== token || pending.owner !== owner || Date.now() - pending.at > PREFLIGHT_TTL_MS) {
    return { code: "INVALID_REQUEST", ok: false, message: "Check the pack folder again before importing." };
  }
  if (activeImport) return { code: "NOT_AVAILABLE", ok: false, message: "A backend pack import is already running." };
  pendingPreflight = null;
  const controller = new AbortController();
  activeImport = { owner, controller };
  try {
    // A GPU host keeps the old pack's DLLs loaded, and Windows cannot delete a loaded DLL.
    await releaseGpuHost();
    const result = await backendPack().import(pending.source, { signal: controller.signal });
    if (result.ok) return { code: "OK", ok: true, detail: result.unchanged ? "UNCHANGED" : "INSTALLED" };
    if (result.code === "CANCELLED") return { code: "IMPORT_CANCELLED", ok: false, detail: "CANCELLED", message: backendRefusalMessage("CANCELLED") };
    return { code: "IMPORT_REFUSED", ok: false, detail: result.code, message: backendRefusalMessage(result.code, result.path) };
  } catch {
    return { code: "IMPORT_REFUSED", ok: false, detail: "COPY_FAILED", message: backendRefusalMessage("COPY_FAILED") };
  } finally {
    activeImport = null;
  }
}

/** Cancel the caller's running import (while it is still cancellable) or drop its checklist. */
export function cancelAiBackendPack(owner: number): AiAdminResponse {
  if (activeImport?.owner === owner) activeImport.controller.abort();
  if (pendingPreflight?.owner === owner) pendingPreflight = null;
  return { code: "OK", ok: true };
}

/** Run the load-time integrity guard now, so Settings can show a current verification. */
export async function verifyAiBackendPack(): Promise<AiAdminResponse> {
  const verdict = await backendPack()
    .verifyForLoad()
    .catch(() => null);
  if (!verdict) return { code: "VERIFY_FAILED", ok: false, detail: "REGISTRY_UNREADABLE", message: backendRefusalMessage("REGISTRY_UNREADABLE") };
  if (verdict.ok) return { code: "OK", ok: true };
  return { code: verdict.reason === "NOT_INSTALLED" ? "NOT_FOUND" : "VERIFY_FAILED", ok: false, detail: verdict.reason, message: verdict.message };
}

export async function removeAiBackendPack(): Promise<AiAdminResponse> {
  if (activeImport) return { code: "NOT_AVAILABLE", ok: false, message: "Wait for the running import to finish or cancel it first." };
  pendingPreflight = null;
  try {
    await releaseGpuHost();
    await backendPack().remove();
    return { code: "OK", ok: true };
  } catch {
    return { code: "NOT_AVAILABLE", ok: false, message: "The backend pack could not be removed." };
  }
}

/** Unload an idle model and stop the GPU host so nothing holds the pack; the next job re-plans. */
async function releaseGpuHost(): Promise<void> {
  if (service) await service.releaseModel().catch(() => undefined);
  await gpuHostManager?.release().catch(() => undefined);
}

/** Staged shutdown: bounded, never throws, and a no-op when nothing was ever constructed. */
export async function disposeAiSubsystem(): Promise<void> {
  const active = service;
  service = null;
  await active?.shutdown().catch(() => undefined);
  if (!active) await Promise.all([hostManager?.dispose(), gpuHostManager?.dispose()].map((done) => done?.catch(() => undefined)));
  hostManager = null;
  gpuHostManager = null;
}
