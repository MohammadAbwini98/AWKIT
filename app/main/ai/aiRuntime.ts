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
import fs from "node:fs";
import path, { join } from "node:path";

import { deriveInferenceThreads } from "@src/ai/AiAdmission";
import { AiActionStore, type AiAppendResult } from "@src/ai/AiActionStore";
import { AiModelPackStore, type AiModelPackStatus } from "@src/ai/AiModelPack";
import { revertAiAction } from "@src/ai/AiRevert";
import { AiService } from "@src/ai/AiService";
import { AiSettingsStore, MAX_IDLE_UNLOAD_MINUTES, sanitizeAiSettingsPatch } from "@src/ai/AiSettings";
import type {
  AiAdminResponse,
  AiAuditView,
  AiDiagnosticsView,
  AiModelPackView,
  AiSettingsView,
  AiStatusView
} from "@src/ai/contracts/AiApi";
import { AI_MODEL_MANIFEST, AI_RUNTIME_PIN } from "@src/offline/AiModelManifest";
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

const aiRoot = (): string => join(getRuntimeDataRoot(), "ai");
const modelsDir = (): string => join(aiRoot(), "models");

let settingsStore: AiSettingsStore | null = null;
let auditStore: AiActionStore | null = null;
let packStore: AiModelPackStore | null = null;
let hostManager: AiUtilityHostManager | null = null;
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

/** A transport exists only when the host is present AND the manifest pins its runtime build. */
function transport(): AiUtilityHostManager | null {
  if (hostManager) return hostManager;
  const hostPath = resolveHostPath();
  if (!hostPath || !AI_RUNTIME_PIN.build) return null;
  hostManager = new AiUtilityHostManager({ hostPath, modelRoot: modelsDir(), log: logAi });
  return hostManager;
}

const inferenceThreads = (): number => deriveInferenceThreads(detectMachineCapabilities("local").logicalCpuCount);

export function getAiService(): AiService {
  service ??= new AiService({
    transport,
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
        minFreeMemoryMb: executionEngine.getAiAdmissionView().minFreeMemoryMb
      };
    },
    admission: () => executionEngine.getAiAdmissionView(),
    threads: inferenceThreads(),
    expectedRuntimeBuild: AI_RUNTIME_PIN.build ?? undefined,
    log: logAi
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
  const [status, pack, current] = await Promise.all([getAiService().status(), readPack(), settings().read()]);
  const state = status.state;
  return {
    enabled: current.enabled,
    state: state.kind,
    reason: state.kind === "unavailable" ? state.reason : state.kind === "error" ? state.code : null,
    holdReason: status.holdReason,
    queueDepth: status.queueDepth,
    modelPack: packView(pack)
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
    }))
  };
}

export async function updateAiSettings(patch: unknown): Promise<AiAdminResponse> {
  const sanitized = sanitizeAiSettingsPatch(patch);
  if (!sanitized.ok) return { code: "SETTINGS_REJECTED", ok: false, message: sanitized.errors.join(" ") };
  try {
    await settings().update(sanitized.value);
  } catch {
    return { code: "SETTINGS_REJECTED", ok: false, message: "The AI settings could not be saved." };
  }
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
  const [status, pack] = await Promise.all([getAiService().status(), readPack()]);
  const host = hostManager?.status();
  const installed = pack.status === "installed" ? pack.entry : null;
  return {
    runtime: {
      included: resolveHostPath() !== null,
      pinnedBuild: AI_RUNTIME_PIN.build,
      hostState: host?.state ?? "stopped",
      circuitOpen: host?.circuitOpen ?? false,
      lastReason: host?.lastReason ?? null
    },
    modelPack: {
      ...packView(pack),
      sha256: installed?.sha256 ?? null,
      sizeBytes: installed?.sizeBytes ?? null,
      manifestEntries: AI_MODEL_MANIFEST.length
    },
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

/** Staged shutdown: bounded, never throws, and a no-op when nothing was ever constructed. */
export async function disposeAiSubsystem(): Promise<void> {
  const active = service;
  service = null;
  await active?.shutdown().catch(() => undefined);
  if (!active) await hostManager?.dispose().catch(() => undefined);
  hostManager = null;
}
