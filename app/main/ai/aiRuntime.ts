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
import { AiEtaHistoryStore } from "@src/ai/AiEtaHistory";
import { describeAdapters, toExecutionView, type AiGpuReadiness } from "@src/ai/AiExecutionProfile";
import { AiJobTracker, type AiJobKind, type AiJobProfile, type AiJobSample, type AiJobStatus } from "@src/ai/AiJobStatus";
import { compatibilityStanding, runCompatibilityStages, staticStanding } from "@src/ai/AiModelCompatibility";
import { AiModelPackStore, MODEL_IMPORT_HEADROOM_BYTES, type AiModelPackStatus } from "@src/ai/AiModelPack";
import { AI_KV_CACHE_SETTINGS, describeQualification, hardwareClassOf, latencyClassId, runConfigurationOf, type AiRunConfiguration } from "@src/ai/AiQualification";
import { revertAiAction } from "@src/ai/AiRevert";
import { AiService, type AiServiceDeps } from "@src/ai/AiService";
import { AI_BUDGET_IDS, AI_BUDGET_LABELS, AI_TIME_BUDGETS, featuresWithChangedBudget, resolveAiTimeBudgets, type AiTimeBudgets } from "@src/ai/AiTimeBudgets";
import { AUTHORING_LIMITS } from "@src/ai/authoringExplanation";
import { FAILURE_ANALYSIS_LIMITS } from "@src/ai/failureAnalysis";
import { FakeAiHostTransport, type FakeInferStep } from "@src/ai/FakeAiHostTransport";
import { FRAGMENT_ASSIST_LIMITS } from "@src/ai/fragmentAssist";
import { LOCATOR_ATTEMPT_LIMITS } from "@src/ai/locatorUpgradeAttempts";
import { AiSettingsStore, MAX_IDLE_UNLOAD_MINUTES, MAX_VRAM_RESERVE_MB, MIN_VRAM_RESERVE_MB, sanitizeAiSettingsPatch } from "@src/ai/AiSettings";
import { AI_CONTEXT_TOKENS, AI_PROBE, type AiGpuPlan, type AiHostBackend, type AiHostProgressUpdate, type AiHostReason } from "@src/ai/contracts/AiHostProtocol";
import type {
  AiAdminResponse,
  AiAuditView,
  AiBackendPackView,
  AiBackendPreflightResponse,
  AiDiagnosticsView,
  AiMeasuredSpeed,
  AiModelPackView,
  AiModelPreflightResponse,
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

// ── L9: job status, ETA history and time budgets ─────────────────────────────────────────────────────

let etaStore: AiEtaHistoryStore | null = null;
let tracker: AiJobTracker | null = null;
let jobPublisher: ((owner: number, status: AiJobStatus) => void) | null = null;
/** Set when the non-packaged test provider replaced the model, so its jobs still have a history key. */
let testProviderModel: string | null = null;

const etaHistory = (): AiEtaHistoryStore => (etaStore ??= new AiEtaHistoryStore(join(aiRoot(), "ai-eta-history.json")));

/** Where job statuses go: the IPC layer sends each to its owning window only. */
export function setAiJobPublisher(publish: ((owner: number, status: AiJobStatus) => void) | null): void {
  jobPublisher = publish;
}

function jobTracker(): AiJobTracker {
  tracker ??= new AiJobTracker({
    estimate: async (sample) => {
      const key = await latencyKey(sample);
      return key ? etaHistory().estimate(key, sample.cold) : null;
    },
    record: (sample, runMs) => {
      void latencyKey(sample)
        .then((key) => (key ? etaHistory().record(key, sample.cold, runMs) : false))
        .catch(() => undefined);
    },
    publish: (owner, status) => jobPublisher?.(owner, status)
  });
  return tracker;
}

/** The asking window's jobs: running, queued and recently finished ones. */
export function aiJobsFor(owner: number): AiJobStatus[] {
  return jobTracker().list(owner);
}

const currentBudgets = async (): Promise<AiTimeBudgets> => resolveAiTimeBudgets((await settings().read()).timeBudgetSeconds);

/** The checksum the ETA history keys a model by: the file's own, or the test provider's fixed name. */
async function modelKeyOf(modelId: string | null): Promise<string | null> {
  if (!modelId) return null;
  if (testProviderModel !== null) return modelId === testProviderModel ? `test-provider-${modelId}` : null;
  const status = await readPack();
  if (status.status === "installed" && status.entry.id === modelId) return status.entry.sha256;
  if (status.status === "registered" && externalModelId(status.external.sha256) === modelId) return status.external.sha256;
  return null;
}

/** The output budget a kind of job runs with: a feature's, or the probe's own. */
const outputBudgetOf = (kind: AiJobKind): number | null =>
  kind === "compatibilityCheck" ? AI_PROBE.outputTokens : ((FEATURE_OUTPUT_BUDGETS as Partial<Record<string, number>>)[kind] ?? null);

function hardwareClassNow(vramTotalBytes: number | null): string {
  const caps = detectMachineCapabilities("local");
  return hardwareClassOf({ logicalCpus: caps.logicalCpuCount, totalMemoryMb: caps.totalMemoryMb, vramTotalBytes });
}

/**
 * The latency class a job belongs to (E6): its quality key — model checksum, runtime build, backend,
 * offload class, context, KV settings, the job kind and its output budget — on this machine's coarse
 * hardware class. Null when any part is unknown (no profile yet, a model this build cannot name): then
 * no ETA is shown and nothing is recorded, rather than a guess under another configuration's key.
 */
async function latencyKey(sample: AiJobSample): Promise<string | null> {
  const profile = sample.profile;
  const outputTokens = outputBudgetOf(sample.kind);
  if (!profile || outputTokens === null || !AI_RUNTIME_PIN.build) return null;
  const modelSha256 = await modelKeyOf(profile.modelId);
  if (!modelSha256) return null;
  const vram = profile.backend === "vulkan" ? ((await getAiService().status()).execution.vram?.totalBytes ?? null) : null;
  return latencyKeyFor(sample.kind, modelSha256, { backend: profile.backend, offload: profile.offload as AiRunConfiguration["offload"], contextTokens: AI_CONTEXT_TOKENS }, hardwareClassNow(vram), outputTokens);
}

function latencyKeyFor(kind: AiJobKind, modelSha256: string, configuration: AiRunConfiguration, hardwareClass: string, outputTokens: number): string {
  return latencyClassId({ modelSha256, runtimeBuild: AI_RUNTIME_PIN.build ?? "unpinned", ...configuration, kvCache: AI_KV_CACHE_SETTINGS, feature: kind, outputTokens }, hardwareClass);
}

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
const TEST_PROVIDER_MODEL = "test-deterministic-provider";

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
  // A slow load, so the GUI verifier can watch the runtime-reported load progress (L9.3).
  const fake = new FakeAiHostTransport({
    modelRoot,
    respond,
    get loadDelayMs() {
      return (respond() as FakeInferStep & { loadDelayMs?: number }).loadDelayMs;
    }
  });
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
    model: async () => ({ ok: true, modelId: TEST_PROVIDER_MODEL, modelPath: join(modelRoot, "test.gguf"), contextTokens: 4096 }),
    verifyModel: async () => true,
    expectedRuntimeBuild: undefined
  };
}

export function getAiService(): AiService {
  const testProvider = service ? null : testProviderDeps();
  if (testProvider) testProviderModel = TEST_PROVIDER_MODEL;
  service ??= new AiService({
    transport,
    gpu: currentGpuReadiness,
    model: async () => {
      const status = await modelPack().status();
      if (status.status === "missing") return { ok: false, reason: "MODEL_MISSING" };
      if (status.status === "registered") {
        // A model the manifest does not list is loaded only once both compatibility stages passed for this
        // runtime build (L8b.2, L8b.3) AND an administrator acknowledged it as unverified (L8b.5, E7).
        const standing = registeredStanding(status);
        if (standing === null) return { ok: false, reason: "MODEL_UNCHECKED" };
        if (standing !== "compatible") return { ok: false, reason: "MODEL_INCOMPATIBLE" };
        if (status.acknowledgedAt === null) return { ok: false, reason: "MODEL_UNACKNOWLEDGED" };
        return {
          ok: true,
          modelId: externalModelId(status.external.sha256),
          modelPath: modelPack().modelPath(status.external.sha256),
          // Its header showed at least this much (CONTEXT_TOO_SMALL otherwise); every request is capped here anyway.
          contextTokens: AI_CONTEXT_TOKENS
        };
      }
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
      if (status.status === "installed") return status.entry.id === model.modelId && modelPack().verifyForLoad(status.entry.sha256);
      if (status.status === "registered") return externalModelId(status.external.sha256) === model.modelId && modelPack().verifyForLoad(status.external.sha256);
      return false;
    },
    settings: async () => {
      const current = await settings().read();
      return {
        enabled: current.enabled,
        yieldDuringRuns: current.yieldDuringRuns,
        idleUnloadMs: current.idleUnloadMinutes * 60_000,
        minFreeMemoryMb: executionEngine.getAiAdmissionView().minFreeMemoryMb,
        executionMode: current.executionMode,
        vramReserveBytes: current.vramReserveMb === null ? null : current.vramReserveMb * 1024 ** 2,
        budgets: resolveAiTimeBudgets(current.timeBudgetSeconds)
      };
    },
    admission: () => executionEngine.getAiAdmissionView(),
    threads: inferenceThreads(),
    expectedRuntimeBuild: AI_RUNTIME_PIN.build ?? undefined,
    log: logAi,
    jobs: jobTracker(),
    ...testProvider
  });
  return service;
}

/** Policy input for feature modules (L3 onward): the switch, configured tiers and persisted demotions. */
export async function aiPolicyConfig(): Promise<AiPolicyConfig> {
  const [current, snapshot] = await Promise.all([settings().read(), audit().snapshot()]);
  return { enabled: current.enabled, featureTiers: current.featureTiers, demotedFeatures: Object.keys(snapshot.demotions) };
}

/** L12.15: the local-AI master switch, as the run's default for capturing the AI page context. Never throws. */
export async function localAiEnabled(): Promise<boolean> {
  return settings()
    .read()
    .then((current) => current.enabled)
    .catch(() => false);
}

/** A registered model's compatibility under the runtime in use (L8b.2, L8b.3). */
const registeredStanding = (status: Extract<AiModelPackStatus, { status: "registered" }>) => compatibilityStanding(status, AI_RUNTIME_PIN.build);

/** The id a registered model's answers and audit records carry: never its file name or a path. */
const externalModelId = (sha256: string): string => `external-${sha256.slice(0, 12)}`;

/**
 * Each feature's current output budget: the last field of its quality key (L8b.4, E6). A budget raised
 * later no longer matches the key its evidence was measured at, so the feature reads unqualified again.
 */
const FEATURE_OUTPUT_BUDGETS: Readonly<Partial<Record<AiFeatureId, number>>> = Object.freeze({
  validationExplanation: AUTHORING_LIMITS.maxOutputTokens,
  // Ranked inside the explanation's own request.
  safeFixRanking: AUTHORING_LIMITS.maxOutputTokens,
  locatorSemanticUpgrade: LOCATOR_ATTEMPT_LIMITS.maxOutputTokens,
  locatorRepair: LOCATOR_ATTEMPT_LIMITS.maxOutputTokens,
  failureAnalysis: FAILURE_ANALYSIS_LIMITS.maxOutputTokens,
  // Both answered by the fragment assist's one request.
  fragmentSummary: FRAGMENT_ASSIST_LIMITS.maxOutputTokens,
  fragmentParameterMapping: FRAGMENT_ASSIST_LIMITS.maxOutputTokens
});

function packView(status: AiModelPackStatus, configuration: AiRunConfiguration | null, vramTotalBytes: number | null, budgets: AiTimeBudgets): AiModelPackView {
  const qualification = (compatibility: Parameters<typeof describeQualification>[0]["compatibility"], sha256: string) =>
    describeQualification({
      compatibility,
      modelSha256: sha256,
      runtimeBuild: AI_RUNTIME_PIN.build,
      configuration,
      featureBudgets: FEATURE_OUTPUT_BUDGETS,
      hardwareClass: hardwareClassNow(vramTotalBytes),
      // L9.2: a feature whose time budget moved is not qualified by evidence measured under the old one.
      changedBudgetFeatures: featuresWithChangedBudget(budgets)
    });
  if (status.status === "installed") {
    return {
      status: "installed",
      reason: null,
      modelId: status.entry.id,
      displayName: status.entry.displayName,
      acknowledged: null,
      // A curated pack is compatible by its release's own evidence; qualified only where the list says so.
      qualification: qualification("compatible", status.entry.sha256)
    };
  }
  if (status.status === "missing") return { status: "missing", reason: null, modelId: null, displayName: null, acknowledged: null, qualification: null };
  if (status.status === "registered") {
    const standing = registeredStanding(status);
    const headerOnly = standing === null && staticStanding(status.staticCheck, AI_RUNTIME_PIN.build) === "passed";
    return {
      status: "registered",
      reason: standing === "compatible" ? "COMPATIBLE" : headerOnly ? "STATIC_PASSED" : standing,
      modelId: null,
      displayName: status.external.fileName,
      acknowledged: status.acknowledgedAt !== null,
      qualification: qualification(standing, status.external.sha256)
    };
  }
  return { status: status.status, reason: status.reason, modelId: null, displayName: null, acknowledged: null, qualification: null };
}

const readPack = (): Promise<AiModelPackStatus> =>
  modelPack()
    .status()
    .catch((): AiModelPackStatus => ({ status: "invalid", reason: "REGISTRY_UNREADABLE" }));

export async function aiStatusView(): Promise<AiStatusView> {
  const [status, pack, current, readiness] = await Promise.all([getAiService().status(), readPack(), settings().read(), currentGpuReadiness()]);
  const state = status.state;
  const configuration = runConfigurationOf(status, current.executionMode, readiness);
  return {
    enabled: current.enabled,
    state: state.kind,
    reason: state.kind === "unavailable" ? state.reason : state.kind === "error" ? state.code : null,
    holdReason: status.holdReason,
    queueDepth: status.queueDepth,
    modelPack: packView(pack, configuration, status.execution.vram?.totalBytes ?? null, resolveAiTimeBudgets(current.timeBudgetSeconds)),
    execution: toExecutionView(status, current.executionMode, readiness),
    measuredSpeed: await measuredSpeed(pack, configuration, status.execution.vram?.totalBytes ?? null).catch(() => [])
  };
}

/** The kinds a latency class is measured for: every feature, and the compatibility probe. */
const MEASURED_KINDS: readonly AiJobKind[] = [...AI_FEATURE_IDS, "compatibilityCheck"];

/**
 * L9.4: what the ETA history measured on this machine for the configuration AI runs in now. Nothing for
 * a configuration no load has decided yet (a GPU mode before its load), so nothing is attributed to it.
 */
async function measuredSpeed(pack: AiModelPackStatus, configuration: AiRunConfiguration | null, vramTotalBytes: number | null): Promise<AiMeasuredSpeed[]> {
  if (!configuration) return [];
  const sha = testProviderModel !== null ? `test-provider-${testProviderModel}` : pack.status === "installed" ? pack.entry.sha256 : pack.status === "registered" ? pack.external.sha256 : null;
  if (!sha) return [];
  const hardware = hardwareClassNow(configuration.backend === "vulkan" ? vramTotalBytes : null);
  const measured: AiMeasuredSpeed[] = [];
  for (const kind of MEASURED_KINDS) {
    const outputTokens = outputBudgetOf(kind);
    if (outputTokens === null) continue;
    const key = latencyKeyFor(kind, sha, configuration, hardware, outputTokens);
    const [cold, warm] = await Promise.all([etaHistory().estimate(key, true), etaHistory().estimate(key, false)]);
    if (cold || warm) measured.push({ kind, cold, warm });
  }
  return measured;
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
    maxVramReserveMb: MAX_VRAM_RESERVE_MB,
    budgets: AI_BUDGET_IDS.map((id) => {
      const bounds = AI_TIME_BUDGETS[id];
      const configured = current.timeBudgetSeconds[id];
      return {
        id,
        label: AI_BUDGET_LABELS[id],
        seconds: configured ?? bounds.defaultMs / 1000,
        defaultSeconds: bounds.defaultMs / 1000,
        minSeconds: bounds.minMs / 1000,
        maxSeconds: bounds.maxMs / 1000,
        configured: configured !== undefined
      };
    })
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
  const installed = pack.status === "installed" ? pack.entry : pack.status === "registered" ? pack.external : null;
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
      ...packView(pack, runConfigurationOf(status, current.executionMode, readiness), status.execution.vram?.totalBytes ?? null, resolveAiTimeBudgets(current.timeBudgetSeconds)),
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

const MODEL_IMPORT_MESSAGES: Record<string, string> = {
  ABORTED: "Import cancelled. Nothing was kept.",
  NOT_A_FILE: "The selected item is not a file.",
  NOT_GGUF: "The selected file is not a GGUF model.",
  INSUFFICIENT_SPACE: "There is not enough free disk space in the app's data folder for this model and 256 MB to spare.",
  COPY_FAILED: "The model pack could not be copied into the app's data folder."
};

/** The file the last ready model preflight covered, named to the renderer only by its token (L8b.5, E1). */
let pendingModelPreflight: { token: string; owner: number; source: string; at: number } | null = null;

/** The model copy or compatibility check running now (one at a time), for its owner's cancel (L9.1). */
type ModelJob = { owner: number; cancel: () => void; cancelled: boolean };
let activeModelJob: ModelJob | null = null;

/**
 * Take the one model-job slot, or null when another copy or check holds it. Synchronous on purpose: taken
 * before any await, so two requests can never both pass the check and then both run (awkit-djnl.17).
 */
function claimModelJob(owner: number | null, cancel: () => void): ModelJob | null {
  if (activeModelJob) return null;
  activeModelJob = { owner: owner ?? -1, cancel, cancelled: false };
  return activeModelJob;
}

const MODEL_JOB_BUSY: AiAdminResponse = { code: "NOT_AVAILABLE", ok: false, message: "A model copy or check is already running." };

/** Throttled byte progress: at most every 200 ms, and always the last byte. */
function byteReporter(key: string): (done: number, total: number) => void {
  let last = 0;
  return (done, total) => {
    const at = Date.now();
    if (done < total && at - last < 200) return;
    last = at;
    jobTracker().update(key, { progress: { done, total, unit: "bytes" } });
  };
}

/**
 * Both compatibility stages on the active registered model, in the host (L8b.2, L8b.3). "not-run" when the
 * host cannot run them now; the model then stays unchecked until a re-check. Reported as the owner's
 * "compatibility-check" job (L9.1): the probe's load progress is the runtime's own, the rest indeterminate,
 * under the compatibility-probe budget; its ETA comes from earlier probes of the same model here.
 */
async function runModelStages(owner: number | null, job: ModelJob): Promise<string> {
  const key = `compatibility-check:${owner ?? "none"}`;
  // The caller holds the slot; from here a cancel stops the probe (a copy before it is already done).
  job.cancel = () => void getAiService().cancelProbe();
  const budgets = await currentBudgets();
  const status = await readPack();
  const modelId = status.status === "registered" ? externalModelId(status.external.sha256) : null;
  const profile: AiJobProfile = { modelId, mode: "cpu", backend: "cpu", device: "cpu", offload: "cpu", fallbackReason: null };
  jobTracker().open(key, {
    kind: "compatibilityCheck",
    owner,
    jobId: "compatibility-check",
    budgetMs: budgets.compatibilityProbe,
    cancellable: true,
    state: "running",
    stage: "compatibility-check"
  });
  jobTracker().update(key, { profile });
  // A probe always loads the model: cold, on CPU & RAM (L8b.3). A check that stops at the header loaded
  // nothing, so it stays neither cold nor warm and never joins the probe's measured history.
  const probe = (file: string) => {
    if (job.cancelled) return Promise.resolve(null);
    jobTracker().update(key, { cold: true });
    return getAiService().probeModel(file, onProgress);
  };
  const onProgress = (update: AiHostProgressUpdate) => {
    if (update.stage !== "load") return;
    // Loading ends at the runtime's own 100 %; the probe's generation after it has no denominator.
    if (update.fraction >= 1) jobTracker().update(key, { stage: "compatibility-check" });
    else jobTracker().update(key, { stage: "model-load", progress: { done: Math.round(update.fraction * 1000), total: 1000, unit: "fraction" } });
  };
  const stage = await runCompatibilityStages({
    store: modelPack(),
    inspect: (file) => getAiService().inspectModel(file),
    // A cancel that arrived during the header read stops the probe from starting at all.
    probe,
    runtimeBuild: AI_RUNTIME_PIN.build
  }).catch(() => "not-run" as const);
  logAi(stage === "not-run" ? "warn" : "info", `registered model compatibility: ${stage}`);
  if (job.cancelled) jobTracker().close(key, "cancelled", "CANCELLED");
  else if (stage !== "not-run") jobTracker().close(key, "completed", stage === "compatible" ? "COMPATIBLE" : stage);
  else jobTracker().close(key, getAiService().probeEndedBy() === "AI_HOST_TIMEOUT" ? "timed-out" : "failed", getAiService().probeEndedBy() ?? "NOT_RUN");
  return stage;
}

/** Cancel the asking window's model copy or compatibility check. */
export function cancelAiModelJob(owner: number): AiAdminResponse {
  const job = activeModelJob;
  if (!job || job.owner !== owner) return { code: "NOT_FOUND", ok: false, message: "There is no model job of yours to cancel." };
  job.cancelled = true;
  job.cancel();
  return { code: "OK", ok: true };
}

/**
 * Step one of an import: what copying the file main's own dialog just picked would need, measured before
 * anything is copied. A file that fits is remembered for its owner, behind a one-time token.
 */
export async function preflightAiModelPack(owner: number, source: string): Promise<AiModelPreflightResponse> {
  const result = await modelPack()
    .preflight(source)
    .catch(() => null);
  pendingModelPreflight = null;
  if (!result) return { code: "IMPORT_REFUSED", ok: false, detail: "COPY_FAILED", message: MODEL_IMPORT_MESSAGES.COPY_FAILED, preflight: null };
  if (!result.ok) return { code: "IMPORT_REFUSED", ok: false, detail: result.code, message: MODEL_IMPORT_MESSAGES[result.code], preflight: null };
  const { fileName, sizeBytes, freeBytes, requiredBytes, spaceOk } = result.preflight;
  const token = spaceOk ? randomBytes(16).toString("hex") : "";
  if (spaceOk) pendingModelPreflight = { token, owner, source, at: Date.now() };
  const preflight = { token, fileName, sizeBytes, freeBytes, requiredBytes, headroomBytes: MODEL_IMPORT_HEADROOM_BYTES, spaceOk };
  return spaceOk
    ? { code: "OK", ok: true, preflight }
    : { code: "IMPORT_REFUSED", ok: false, detail: "INSUFFICIENT_SPACE", message: MODEL_IMPORT_MESSAGES.INSUFFICIENT_SPACE, preflight };
}

/** Step two: copy the file a ready preflight covered, then check a registered model's compatibility. */
export async function importAiModelPack(owner: number, token: string): Promise<AiAdminResponse> {
  const pending = pendingModelPreflight;
  if (!pending || pending.token !== token || pending.owner !== owner || Date.now() - pending.at > PREFLIGHT_TTL_MS) {
    return { code: "INVALID_REQUEST", ok: false, message: "Choose the model file again before importing." };
  }
  // One model job at a time, claimed before any await; a refused request keeps its checklist token.
  const controller = new AbortController();
  const job = claimModelJob(owner, () => controller.abort());
  if (!job) return MODEL_JOB_BUSY;
  pendingModelPreflight = null;
  try {
    await getAiService().releaseModel();
    // L9: the copy and its hash are the owner's "model-import" job: determinate by bytes, under the
    // component-copy budget, cancellable until the copy is done.
    const key = `model-import:${owner}`;
    const budgetMs = (await currentBudgets()).componentCopy;
    const deadline = AbortSignal.timeout(budgetMs);
    jobTracker().open(key, { kind: "modelImport", owner, jobId: "model-import", budgetMs, cancellable: true, state: "running", stage: "copy-hash" });
    const result = await modelPack()
      .import(pending.source, { signal: AbortSignal.any([controller.signal, deadline]), onProgress: byteReporter(key) })
      .catch((): Awaited<ReturnType<AiModelPackStore["import"]>> => ({ ok: false, code: "COPY_FAILED" }));
    if (!result.ok) {
      if (result.code === "ABORTED") {
        const timedOut = deadline.aborted && !job.cancelled;
        jobTracker().close(key, timedOut ? "timed-out" : "cancelled", timedOut ? "TIMEOUT" : "CANCELLED");
        return timedOut
          ? { code: "IMPORT_REFUSED", ok: false, detail: "TIMEOUT", message: "Copying the model took longer than its time limit, so it was stopped. Nothing was kept." }
          : { code: "IMPORT_CANCELLED", ok: false, detail: "CANCELLED", message: "Import cancelled. Nothing was kept." };
      }
      jobTracker().close(key, "failed", result.code);
      return { code: "IMPORT_REFUSED", ok: false, detail: result.code, message: MODEL_IMPORT_MESSAGES[result.code] };
    }
    jobTracker().close(key, "completed");
    // The same slot covers the checks that follow a copy, so nothing starts between the two.
    if (result.entry === null) await runModelStages(owner, job);
    return { code: "OK", ok: true, detail: result.entry !== null ? result.entry.id : result.external.fileName };
  } finally {
    if (activeModelJob === job) activeModelJob = null;
  }
}

/**
 * Run a registered model's compatibility stages again, for this runtime build (a verdict from another
 * build no longer counts), or after they could not run at import.
 */
export async function checkAiModelPack(owner: number | null = null): Promise<AiAdminResponse> {
  if ((await readPack()).status !== "registered") {
    return { code: "NOT_FOUND", ok: false, message: "Only a registered model the app does not list is checked for compatibility." };
  }
  const job = claimModelJob(owner, () => void getAiService().cancelProbe());
  if (!job) return MODEL_JOB_BUSY;
  try {
    await getAiService().releaseModel();
    const stage = await runModelStages(owner, job);
    if (stage === "not-run") {
      return {
        code: "NOT_AVAILABLE",
        ok: false,
        detail: "NOT_RUN",
        message: "The check did not finish: it was cancelled or ran past its time limit, or the local AI runtime is unavailable, runs are active or memory is low. Try again later."
      };
    }
    return { code: "OK", ok: true, detail: stage === "compatible" ? "COMPATIBLE" : stage };
  } finally {
    if (activeModelJob === job) activeModelJob = null;
  }
}

/**
 * The administrator's "unverified model" acknowledgement (L8b.5, E7), for the active registered model
 * only once it is compatible. Recorded on that exact file; a new import needs a new one.
 */
export async function acknowledgeAiModelPack(): Promise<AiAdminResponse> {
  const status = await readPack();
  if (status.status !== "registered") return { code: "NOT_FOUND", ok: false, message: "There is no registered model to acknowledge." };
  if (registeredStanding(status) !== "compatible") {
    return { code: "NOT_AVAILABLE", ok: false, detail: "NOT_COMPATIBLE", message: "Only a model that passed its compatibility checks can be acknowledged." };
  }
  const recorded = await modelPack()
    .acknowledge(status.external.sha256)
    .catch(() => false);
  return recorded ? { code: "OK", ok: true } : { code: "NOT_AVAILABLE", ok: false, message: "The model changed meanwhile. Review it again." };
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
// Imported and verified here. Only the GPU host loads it (L8a.3), from the directory `verifyForLoad`
// returns just before each fork; CPU inference never depends on it.

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
  // Read before the slot is taken: the try that frees it starts below, so nothing may throw in between.
  const budgetMs = (await currentBudgets()).componentCopy;
  if (activeImport) return { code: "NOT_AVAILABLE", ok: false, message: "A backend pack import is already running." };
  pendingPreflight = null;
  const controller = new AbortController();
  activeImport = { owner, controller };
  // L9: the owner's "backend-import" job, determinate by bytes from the store's own staged-copy counters,
  // under the component-copy budget. A cancel and the deadline end it through the same signal.
  const key = `backend-import:${owner}`;
  const deadline = AbortSignal.timeout(budgetMs);
  jobTracker().open(key, { kind: "backendImport", owner, jobId: "backend-import", budgetMs, cancellable: true, state: "running", stage: "copy-hash" });
  const watch = setInterval(() => {
    const progress = backendPack().importProgress();
    if (!progress) return;
    jobTracker().update(key, {
      stage: progress.phase === "promoting" ? "finalization" : "copy-hash",
      cancellable: progress.phase !== "promoting",
      progress: progress.totalBytes > 0 ? { done: progress.doneBytes, total: progress.totalBytes, unit: "bytes" } : null
    });
  }, 250);
  watch.unref?.();
  try {
    // A GPU host keeps the old pack's DLLs loaded, and Windows cannot delete a loaded DLL.
    await releaseGpuHost();
    const result = await backendPack().import(pending.source, { signal: AbortSignal.any([controller.signal, deadline]) });
    if (result.ok) {
      jobTracker().close(key, "completed", result.unchanged ? "UNCHANGED" : "INSTALLED");
      return { code: "OK", ok: true, detail: result.unchanged ? "UNCHANGED" : "INSTALLED" };
    }
    if (result.code === "CANCELLED") {
      const timedOut = deadline.aborted && !controller.signal.aborted;
      jobTracker().close(key, timedOut ? "timed-out" : "cancelled", timedOut ? "TIMEOUT" : "CANCELLED");
      return timedOut
        ? { code: "IMPORT_REFUSED", ok: false, detail: "TIMEOUT", message: "Copying the backend pack took longer than its time limit, so it was stopped. Nothing was installed." }
        : { code: "IMPORT_CANCELLED", ok: false, detail: "CANCELLED", message: backendRefusalMessage("CANCELLED") };
    }
    jobTracker().close(key, "failed", result.code);
    return { code: "IMPORT_REFUSED", ok: false, detail: result.code, message: backendRefusalMessage(result.code, result.path) };
  } catch {
    jobTracker().close(key, "failed", "COPY_FAILED");
    return { code: "IMPORT_REFUSED", ok: false, detail: "COPY_FAILED", message: backendRefusalMessage("COPY_FAILED") };
  } finally {
    clearInterval(watch);
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
