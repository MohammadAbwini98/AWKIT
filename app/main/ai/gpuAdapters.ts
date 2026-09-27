/**
 * The machine's display adapters by PCI vendor ID (Phase L, L8a.3, E2), from Chromium's own GPU info in
 * the main process: no child process, no WMI, no driver query, and never a product name. The local-AI
 * runtime reports no vendor at all (L8a.0), so this list is the only vendor evidence there is.
 */

import { app } from "electron";

import type { AiBackendPackStatus } from "@src/ai/AiBackendPack";
import { classifyAdapters, type AiGpuReadiness } from "@src/ai/AiExecutionProfile";

/** Every adapter's PCI vendor ID (0 when Chromium does not know it), or null when the list cannot be read. */
export async function displayAdapterVendorIds(): Promise<number[] | null> {
  try {
    const info = (await app.getGPUInfo("basic")) as { gpuDevice?: Array<{ vendorId?: unknown }> };
    if (!Array.isArray(info?.gpuDevice)) return null;
    return info.gpuDevice.map((device) => (Number.isInteger(device?.vendorId) ? (device.vendorId as number) : 0));
  } catch {
    return null;
  }
}

/** A GPU mode's readiness before any GPU host starts: the backend pack's cheap status, then E2. */
export async function gpuReadiness(
  pack: { status(): Promise<Pick<AiBackendPackStatus, "status">> },
  vendorIds: () => Promise<number[] | null> = displayAdapterVendorIds
): Promise<AiGpuReadiness> {
  const status = await pack.status().catch(() => null);
  if (!status || status.status === "unavailable") return { ok: false, reason: "BACKEND_UNAVAILABLE" };
  if (status.status === "not-installed") return { ok: false, reason: "BACKEND_PACK_MISSING" };
  if (status.status === "invalid") return { ok: false, reason: "BACKEND_PACK_INVALID" };
  return classifyAdapters(await vendorIds());
}
