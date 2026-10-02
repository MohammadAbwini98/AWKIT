/**
 * Windows' own view of the display adapters (Win32_VideoController), classified for the E2 evidence of
 * verify:ai-gpu-backend-gate section C. Pure, so scripts/verify-ai-gpu-harness.mts drives every branch.
 *
 * Section C requires PCI identity of every adapter that could be a hardware acceleration candidate. A
 * Remote Desktop session adds the Microsoft Remote Display Adapter, an indirect display Windows creates in
 * software: no PCI function, so no vendor ID, and never a Vulkan compute device. On the GTX 980M
 * (2026-10-02) it failed the check while the runtime's own E2 answer, from Chromium, was already right:
 * Chromium reports such adapters as Microsoft's software vendor 0x1414, which `classifyAdapters` ignores.
 *
 * So the classes are explicit, and the exemption is narrow:
 *  - "pci": a PCI vendor ID is present. This is the identity evidence a hardware adapter must carry.
 *  - "microsoft-software": no vendor ID, enumerated by a SOFTWARE enumerator (SWD or ROOT, never a bus),
 *    AND named as one of Microsoft's software or remote adapters. Both, never one.
 *  - "unknown": anything else. An adapter without PCI identity that is not a known Microsoft software
 *    adapter (a USB display, an unnamed device, a misnamed one on a bus) still fails the check.
 * Runtime eligibility never reads this.
 */

export type WindowsAdapterClass = "pci" | "microsoft-software" | "unknown";

/** Microsoft adapters with no PCI function behind them: Remote Desktop's display and the Basic Render Driver (WARP). */
const MICROSOFT_SOFTWARE_ADAPTER_NAMES: readonly RegExp[] = [/^Microsoft Remote Display Adapter$/i, /^Microsoft Basic Render Driver$/i];
/** Software device enumerators: SWD (software devices, such as Remote Desktop's indirect display) and ROOT. */
const SOFTWARE_ENUMERATOR = /^(SWD|ROOT)\\/i;

export function pciVendorId(pnpDeviceId: string): string | null {
  return /VEN_([0-9A-F]{4})/i.exec(pnpDeviceId)?.[1]?.toUpperCase() ?? null;
}

export function classifyWindowsAdapter(pnpDeviceId: string, name: string): WindowsAdapterClass {
  if (pciVendorId(pnpDeviceId) !== null) return "pci";
  if (SOFTWARE_ENUMERATOR.test(pnpDeviceId.trim()) && MICROSOFT_SOFTWARE_ADAPTER_NAMES.some((pattern) => pattern.test(name.trim()))) {
    return "microsoft-software";
  }
  return "unknown";
}

/** Section C's verdict: at least one adapter, every one either PCI-identified or a known Microsoft software adapter. */
export function adapterIdentityVerdict(adapters: ReadonlyArray<{ pnpDeviceId: string; name: string }>): {
  ok: boolean;
  pci: number;
  microsoftSoftware: string[];
  unknown: string[];
} {
  const classes = adapters.map((adapter) => ({ adapter, kind: classifyWindowsAdapter(adapter.pnpDeviceId, adapter.name) }));
  const pci = classes.filter((entry) => entry.kind === "pci").length;
  const microsoftSoftware = classes.filter((entry) => entry.kind === "microsoft-software").map((entry) => entry.adapter.name);
  const unknown = classes.filter((entry) => entry.kind === "unknown").map((entry) => `${entry.adapter.name || "(no name)"} [${entry.adapter.pnpDeviceId || "no PNP id"}]`);
  return { ok: pci > 0 && unknown.length === 0, pci, microsoftSoftware, unknown };
}
