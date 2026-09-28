/**
 * Hardware-adaptive execution policy (Phase L, L8a.3): the pure rules that turn an execution mode, the
 * machine's display adapters and the runtime's own offload plan into a backend and a layer count, or
 * into a reason. No Electron, no filesystem, no runtime: `AiService` applies them, the verifiers drive
 * every branch directly.
 *
 * E2 (capability, never a name): an adapter is NVIDIA only by PCI vendor ID 0x10DE. The runtime does not
 * report a vendor, so the only proof is the machine's adapter list (Electron's GPU info) and the rule
 * that every Vulkan device the runtime binds must be explained by NVIDIA adapters alone. Mixed or
 * unknown adapters are reported as unproven, never as NVIDIA (owner decision, 2026-09-27).
 *
 * E4 (modes): GPU-Offload loads the largest layer count that fits beside the reserve, retries smaller a
 * bounded number of times, then runs on the CPU with the reason visible. GPU-Only loads every layer or
 * refuses with the exact shortfall, and never falls back silently.
 */

import type { AiExecutionView } from "./contracts/AiApi";
import type { AiGpuPlan } from "./contracts/AiHostProtocol";
import type { AiExecutionMode } from "./AiSettings";

export const NVIDIA_PCI_VENDOR_ID = 0x10de;
/** Microsoft's software adapter (Basic Render Driver / WARP): present on many machines, never a GPU to use. */
export const SOFTWARE_ADAPTER_VENDOR_ID = 0x1414;

export type AiGpuReason =
  | "BACKEND_PACK_MISSING"
  | "BACKEND_PACK_INVALID"
  | "BACKEND_UNAVAILABLE"
  | "NO_COMPATIBLE_ADAPTER"
  | "VENDOR_UNPROVEN"
  | "NO_USABLE_DEVICE"
  | "INSUFFICIENT_VRAM"
  | "GPU_LOAD_FAILED"
  /** L8a.5: the GPU host failed or exited after a successful load, GPU_LOSS_LIMIT times for this setting. */
  | "LOST_AFTER_LOAD";

/** One short, safe sentence per reason; numbers for a VRAM shortfall travel separately. */
export const AI_GPU_REASON_MESSAGES: Readonly<Record<AiGpuReason, string>> = Object.freeze({
  BACKEND_PACK_MISSING: "No GPU backend pack is installed.",
  BACKEND_PACK_INVALID: "The GPU backend pack failed its integrity check.",
  BACKEND_UNAVAILABLE: "The GPU backend cannot run in this build.",
  NO_COMPATIBLE_ADAPTER: "No NVIDIA display adapter was detected.",
  VENDOR_UNPROVEN: "The GPU the runtime would use cannot be proven to be NVIDIA.",
  NO_USABLE_DEVICE: "The runtime found no usable GPU device.",
  INSUFFICIENT_VRAM: "There is not enough free GPU memory for the model.",
  GPU_LOAD_FAILED: "The model could not be loaded on the GPU.",
  LOST_AFTER_LOAD: "The GPU failed after the model loaded, for example because other apps took its memory."
});

/** Main-process readiness before any GPU host is started: the backend pack and the adapters. */
export type AiGpuReadiness = { ok: true; nvidiaAdapters: number } | { ok: false; reason: AiGpuReason };

/**
 * E2 eligibility from PCI vendor IDs alone. `null` means the adapter list could not be read.
 * Eligible only when every hardware adapter is NVIDIA; the software adapter is ignored.
 */
export function classifyAdapters(vendorIds: readonly number[] | null): AiGpuReadiness {
  if (vendorIds === null) return { ok: false, reason: "VENDOR_UNPROVEN" };
  const hardware = vendorIds.filter((id) => id !== SOFTWARE_ADAPTER_VENDOR_ID);
  const nvidia = hardware.filter((id) => id === NVIDIA_PCI_VENDOR_ID).length;
  if (hardware.length > 0 && nvidia === hardware.length) return { ok: true, nvidiaAdapters: nvidia };
  // Known non-NVIDIA adapters only: detected, not enabled. An unknown ID (0) could be anything.
  if (nvidia === 0 && !hardware.includes(0)) return { ok: false, reason: "NO_COMPATIBLE_ADAPTER" };
  // Mixed vendors (a hybrid laptop) or an unknown adapter: nothing ties a Vulkan device to a PCI one.
  return { ok: false, reason: "VENDOR_UNPROVEN" };
}

/** Every Vulkan device the runtime binds must be explained by the NVIDIA adapters alone. */
export function unprovenDevices(deviceCount: number, nvidiaAdapters: number): AiGpuReason | null {
  if (!(deviceCount >= 1)) return "NO_USABLE_DEVICE";
  return deviceCount > nvidiaAdapters ? "VENDOR_UNPROVEN" : null;
}

/** For display: the adapters by vendor ID. Eligibility never reads this; it reads `classifyAdapters`. */
export function describeAdapters(vendorIds: readonly number[] | null): Array<{ vendorId: string; nvidia: boolean; software: boolean }> {
  return (vendorIds ?? []).map((id) => ({
    vendorId: `0x${id.toString(16).padStart(4, "0")}`,
    nvidia: id === NVIDIA_PCI_VENDOR_ID,
    software: id === SOFTWARE_ADAPTER_VENDOR_ID
  }));
}

export type AiGpuDecision =
  | { action: "load"; layers: number }
  | { action: "fallback"; reason: AiGpuReason }
  | { action: "refuse"; reason: AiGpuReason; requiredBytes: number; availableBytes: number };

/** What a GPU mode does with the runtime's plan. */
export function decideGpuLoad(mode: Exclude<AiExecutionMode, "cpu">, plan: AiGpuPlan): AiGpuDecision {
  const everyLayer = plan.totalLayers >= 1 && plan.fitLayers >= plan.totalLayers;
  if (mode === "gpu-only") {
    return everyLayer
      ? { action: "load", layers: plan.totalLayers }
      : { action: "refuse", reason: "INSUFFICIENT_VRAM", requiredBytes: plan.fullRequiredBytes + plan.reserveBytes, availableBytes: plan.freeBytes };
  }
  return plan.fitLayers >= 1 ? { action: "load", layers: plan.fitLayers } : { action: "fallback", reason: "INSUFFICIENT_VRAM" };
}

/** GPU-Offload's bounded retry after a failed load: half the layers, at most this many times. */
export const GPU_LOAD_RETRIES = 2;

export function retryLayers(layers: number, retriesUsed: number): number | null {
  if (retriesUsed >= GPU_LOAD_RETRIES) return null;
  const next = Math.floor(layers / 2);
  return next >= 1 ? next : null;
}

/**
 * GPU losses after a successful load (L8a.5) tolerated per mode and reserve in a session: the GPU host's
 * inference failed or the host exited. The first loss drops the load, and the next job re-plans against
 * the VRAM that is free by then, so it loads fewer layers (or GPU-Only refuses with the shortfall) when
 * another application took memory. At the limit the setting stays off the GPU for the session: GPU-Offload
 * runs on CPU & RAM and GPU-Only refuses, both with LOST_AFTER_LOAD, until the mode or reserve changes.
 * The cause is not diagnosed: the runtime's free-VRAM reading lags other processes (measured, L8a.5).
 * Two, so a GPU host never reaches its own restart circuit (a third exit) through losses alone.
 */
export const GPU_LOSS_LIMIT = 2;

/** What actually runs, as reported in status and diagnostics. */
export interface AiExecutionProfile {
  mode: AiExecutionMode;
  backend: "cpu" | "vulkan";
  /** Layers on the GPU; 0 on the CPU backend. */
  gpuLayers: number;
  totalLayers: number | null;
  /** The count the plan asked for, before any retry. */
  requestedLayers: number | null;
  /** Why a GPU mode is running on the CPU. */
  fallbackReason: AiGpuReason | null;
  /** Why GPU-Only refused; the AI is unavailable until the mode changes or the cause is fixed. */
  refusal: { reason: AiGpuReason; requiredBytes: number | null; availableBytes: number | null } | null;
  /** The runtime's own VRAM figures from this load's plan (bytes); null when no plan ran. */
  vram: AiGpuVram | null;
}

export type AiGpuVram = Pick<AiGpuPlan, "totalBytes" | "freeBytes" | "reserveBytes" | "fullRequiredBytes">;

/** A load's offload class, as a quality key names it (L8b.4, E6): none, every layer, or how many. */
export type AiOffloadClass = "cpu" | "full" | `partial:${number}`;

export function offloadClassOf(gpuLayers: number, totalLayers: number | null): AiOffloadClass {
  if (!Number.isInteger(gpuLayers) || gpuLayers <= 0) return "cpu";
  return totalLayers !== null && gpuLayers >= totalLayers ? "full" : `partial:${gpuLayers}`;
}

export const vramOf = (plan: AiGpuPlan | null): AiGpuVram | null =>
  plan ? { totalBytes: plan.totalBytes, freeBytes: plan.freeBytes, reserveBytes: plan.reserveBytes, fullRequiredBytes: plan.fullRequiredBytes } : null;

export const CPU_PROFILE: Readonly<AiExecutionProfile> = Object.freeze({
  mode: "cpu",
  backend: "cpu",
  gpuLayers: 0,
  totalLayers: null,
  requestedLayers: null,
  fallbackReason: null,
  refusal: null,
  vram: null
});

/**
 * What a model load is doing right now (L8a.4). Stages, never a percentage: the runtime measures no
 * progress inside a load.
 */
export type AiLoadStage =
  | "unloading"
  | "verifying-model"
  | "checking-gpu"
  | "starting-gpu-host"
  | "planning-gpu"
  | "loading-gpu"
  | "retrying-gpu"
  | "loading-cpu"
  | "falling-back";

/**
 * The renderer's view of where the model runs (L8a.4). `mode` is the CONFIGURED mode. A profile made
 * under another mode or reserve is not `applied`: its fallback or refusal reason answered a different
 * question, so it is not reported, and the new setting takes effect at the next load.
 */
export function toExecutionView(
  status: { execution: AiExecutionProfile; executionApplied: boolean; loadedModelId: string | null; loadStage: AiLoadStage | null },
  mode: AiExecutionMode,
  readiness: AiGpuReadiness
): AiExecutionView {
  const { execution: profile, executionApplied: applied } = status;
  const reason = applied ? (profile.refusal?.reason ?? profile.fallbackReason) : null;
  return {
    ...profile,
    mode,
    fallbackReason: applied ? profile.fallbackReason : null,
    refusal: applied && profile.refusal ? { ...profile.refusal } : null,
    vram: profile.vram ? { ...profile.vram } : null,
    message: reason ? AI_GPU_REASON_MESSAGES[reason] : null,
    applied,
    modelLoaded: status.loadedModelId !== null,
    stage: status.loadStage,
    gpuReadiness: readiness.ok
      ? { ok: true, nvidiaAdapters: readiness.nvidiaAdapters, reason: null, message: null }
      : { ok: false, nvidiaAdapters: 0, reason: readiness.reason, message: AI_GPU_REASON_MESSAGES[readiness.reason] }
  };
}
