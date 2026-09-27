/**
 * The machine's display adapters by PCI vendor ID (Phase L, L8a.3, E2), from Chromium's own GPU info in
 * the main process: no child process, no WMI, no driver query, and never a product name. The local-AI
 * runtime reports no vendor at all (L8a.0), so this list is the only vendor evidence there is.
 */

import { app } from "electron";

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
