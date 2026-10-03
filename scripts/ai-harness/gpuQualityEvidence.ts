/**
 * verify:ai-gpu-quality's verdict on where a run's model calls ran (L8a). Pure, so verify:ai-gpu-harness drives
 * every branch.
 *
 * Two questions, kept apart:
 *  - Topology: was the run at the physical console (session "console", Active) with no Remote Display Adapter?
 *    Only claims about Windows' display and session topology need it: the adapters Windows enumerates, the absence
 *    of the remote adapter, the count Windows or Settings shows. Those were qualified at the console by their own
 *    verifiers. Remote Desktop changes this topology, so a remote run is never a console topology qualification.
 *  - Compute: did every model call run on the NVIDIA GPU through Vulkan with every layer offloaded? Remote Desktop
 *    adds a display adapter, never a compute device, so a remote session alone does not void this evidence. It is
 *    proven, never inferred from an adapter count (Chromium lists the one NVIDIA GPU twice under Remote Desktop), by
 *    all of:
 *      1. Windows' compute adapters, the PCI-identified ones (windowsAdapters.ts), are NVIDIA only and the same set at
 *         the start and the end. Microsoft's software and remote adapters are display topology; an adapter that is
 *         neither leaves the device unproven;
 *      2. every gate's readiness answered ok, so Automatic resolved to the GPU;
 *      3. every call ran as GPU-Offload on Vulkan with all of its layers, and every answer came from vulkan/full;
 *      4. every gate started its GPU host behind the pack guard;
 *      5. nvidia-smi read the NVIDIA GPU after every call, and while a gate's model was loaded the GPU held at least
 *         the model file's size more memory than at the gate's lowest (idle) reading;
 *      6. the runtime bound no more Vulkan devices than Windows' NVIDIA PCI adapters, by its own GPU plan. The
 *         product's E2 check compares that count with readiness, which off the console counts the NVIDIA GPU twice,
 *         so a second device (a software ICD, say) would pass it there. At the physical console readiness counts
 *         what Windows lists and the product's check is exact, so a console run needs no recorded plan.
 *
 * Verdicts: PASS, labelled with the topology the run had; FAIL when Automatic resolved to the GPU and a call still ran
 * on another backend or offload; INCONCLUSIVE when the compute device cannot be proven, including an Automatic that
 * resolved to CPU & RAM only, which is supported behaviour and simply no GPU evidence.
 */

import { classifyWindowsAdapter, pciVendorId } from "./windowsAdapters";

export interface RunTopology {
  sessionName: string;
  state: string;
  adapters: ReadonlyArray<{ pnpDeviceId: string; name: string }>;
}

const NVIDIA_VENDOR = "10DE";

export const isRemoteDisplayAdapter = (adapter: { pnpDeviceId: string }): boolean => /^SWD\\REMOTEDISPLAYENUM\\/i.test(adapter.pnpDeviceId.trim());

/** The physical console: this process's session is "console" and Active, and Windows lists no Remote Display Adapter. */
export function physicalConsole(topology: RunTopology): boolean {
  return /^console$/i.test(topology.sessionName) && /^Active$/i.test(topology.state) && !topology.adapters.some(isRemoteDisplayAdapter);
}

/** An adapter's PCI identity for display and comparison: enumerator and hardware ID, e.g. PCI\VEN_10DE&DEV_13D7&…. */
const pciIdentity = (pnpDeviceId: string) => pnpDeviceId.trim().toUpperCase().split("\\").slice(0, 2).join("\\");

/** Windows' adapters split into compute candidates (PCI), display topology (Microsoft software or remote) and unknown. */
export function adapterRoles(topology: RunTopology): { compute: string[]; displayOnly: string[]; unknown: string[] } {
  const roles = { compute: [] as string[], displayOnly: [] as string[], unknown: [] as string[] };
  for (const adapter of topology.adapters) {
    const kind = classifyWindowsAdapter(adapter.pnpDeviceId, adapter.name);
    if (kind === "pci") roles.compute.push(pciIdentity(adapter.pnpDeviceId));
    else if (kind === "microsoft-software") roles.displayOnly.push(adapter.name);
    else roles.unknown.push(`${adapter.name || "(no name)"} [${adapter.pnpDeviceId || "no PNP id"}]`);
  }
  roles.compute.sort();
  return roles;
}

// ── A gate's printed execution record (verify-ai-explanation-live.mts, reportExecution) ─────────────────────

export const CALL_LINE =
  /^\s+· (\w+) (\w+)(?:\/(\w+))?: ([\w-]+) on (\w+) \(([^)]*)\), answer (\S+)(?:, cold load (\S+) ms|, warm), first token (\S+) ms, generation (\S+) ms, (\S+)\/(\d+) out \((\S+) in\), (\d+) ms end to end$/;
const EXECUTION_LINE = /^\s+· readiness answers (\[.*\]); pack guard runs (\d+); GPU host pids (\[.*\]); nvidia-smi MiB after each call (\[.*\])$/;
const PLAN_LINE = /^\s+· runtime GPU plans: Vulkan devices (\[.*\]), VRAM total MiB (\[.*\])$/;

export interface GateCall {
  feature: string;
  status: string;
  resolved: string;
  backend: string;
  layers: string;
  answer: string;
  coldLoadMs: number | null;
  firstTokenMs: number | null;
  generationMs: number | null;
  outputTokens: number | null;
  maxOutputTokens: number;
  wallMs: number;
}
const num = (value: string | undefined) => (value === undefined || value === "-" || value === "?" ? null : Number(value));

export function callsOf(text: string): GateCall[] {
  return text
    .split(/\r?\n/)
    .map((line) => CALL_LINE.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({
      feature: m[1],
      status: m[3] ? `${m[2]}/${m[3]}` : m[2],
      resolved: m[4],
      backend: m[5],
      layers: m[6],
      answer: m[7],
      coldLoadMs: num(m[8]),
      firstTokenMs: num(m[9]),
      generationMs: num(m[10]),
      outputTokens: num(m[11]),
      maxOutputTokens: Number(m[12]),
      wallMs: Number(m[14])
    }));
}

export interface GateExecution {
  readiness: Array<{ ok: boolean; nvidiaAdapters?: number; reason?: string }>;
  guardRuns: number;
  hostPids: number[];
  vramMib: Array<number | null>;
  /** Vulkan devices per GPU plan, from the runtime; null where the gate printed none (before 2026-10-03's change). */
  vulkanDevices: number[] | null;
}

export function executionOf(text: string): GateExecution | null {
  const lines = text.split(/\r?\n/);
  const plan = lines.map((line) => PLAN_LINE.exec(line)).find((m) => m !== null);
  for (const line of lines) {
    const m = EXECUTION_LINE.exec(line);
    if (!m) continue;
    try {
      return { readiness: JSON.parse(m[1]), guardRuns: Number(m[2]), hostPids: JSON.parse(m[3]), vramMib: JSON.parse(m[4]), vulkanDevices: plan ? JSON.parse(plan[1]) : null };
    } catch {
      return null;
    }
  }
  return null;
}

/** Every layer on the GPU: "25 of 25". */
const allLayers = (layers: string) => {
  const m = /^(\d+) of (\d+)$/.exec(layers.trim());
  return m !== null && Number(m[1]) > 0 && m[1] === m[2];
};

// ── The verdict ─────────────────────────────────────────────────────────────────────────────────────────────

export interface GateEvidence {
  name: string;
  text: string;
  /** nvidia-smi readings the runner took with no gate running, just before and after this one; null where none. */
  idleVramMib: ReadonlyArray<number | null>;
}

export type ComputeVerdict = "PASS" | "FAIL" | "INCONCLUSIVE";
export const COMPUTE_LABELS = Object.freeze({
  console: "PASS — physical-console topology qualification",
  remote: "PASS — NVIDIA compute qualification under RDP",
  unproven: "INCONCLUSIVE — compute device cannot be proven",
  wrong: "FAIL — runtime used the wrong backend/device"
});

export interface GpuQualityVerdict {
  verdict: ComputeVerdict;
  label: string;
  topology: "physical-console" | "remote-session";
  reasons: string[];
  computeAdapters: { start: string[]; end: string[] };
  displayOnly: string[];
  gates: Array<{ name: string; calls: number; idleMib: number | null; loadedMib: number | null; vulkanDevices: number[] | null }>;
}

export function gpuQualityVerdict(input: { start: RunTopology; end: RunTopology; gates: readonly GateEvidence[]; minModelVramMib: number }): GpuQualityVerdict {
  const wrong: string[] = [];
  const unproven: string[] = [];

  const start = adapterRoles(input.start);
  const end = adapterRoles(input.end);
  for (const [when, roles] of [["start", start], ["end", end]] as const) {
    if (roles.unknown.length > 0) unproven.push(`at the ${when}, an adapter that is neither PCI-identified nor Microsoft's software or remote adapter: ${roles.unknown.join("; ")}`);
    if (roles.compute.length === 0) unproven.push(`at the ${when}, Windows lists no compute adapter (Microsoft's software and remote adapters are display topology, never a compute device)`);
    const other = roles.compute.filter((id) => pciVendorId(id) !== NVIDIA_VENDOR);
    if (other.length > 0) unproven.push(`at the ${when}, a compute adapter that is not NVIDIA (${other.join(", ")}): nothing ties the runtime's device to the NVIDIA one`);
  }
  if (start.compute.join("|") !== end.compute.join("|")) unproven.push(`the compute adapters changed during the run (${start.compute.join(", ") || "none"} → ${end.compute.join(", ") || "none"})`);
  const topology = physicalConsole(input.start) && physicalConsole(input.end) ? "physical-console" : "remote-session";
  const nvidiaPci = Math.min(...[start, end].map((roles) => roles.compute.filter((id) => pciVendorId(id) === NVIDIA_VENDOR).length));

  const gates = input.gates.map((gate) => {
    const calls = callsOf(gate.text);
    const execution = executionOf(gate.text);
    const readings = execution?.vramMib ?? [];
    const known = [...gate.idleVramMib, ...readings].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const idleMib = known.length > 0 ? Math.min(...known) : null;
    const loaded = readings.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const loadedMib = loaded.length > 0 ? Math.max(...loaded) : null;
    const summary = { name: gate.name, calls: calls.length, idleMib, loadedMib, vulkanDevices: execution?.vulkanDevices ?? null };
    if (!execution || calls.length === 0) {
      unproven.push(`${gate.name}: no execution record`);
      return summary;
    }
    if (execution.readiness.length === 0 || !execution.readiness.every((r) => r.ok)) {
      unproven.push(`${gate.name}: Automatic did not resolve to the GPU (readiness ${JSON.stringify(execution.readiness)}), so it ran as CPU & RAM only and is no GPU evidence`);
      return summary;
    }
    const offGpu = calls.filter((c) => !(c.resolved === "gpu-offload" && c.backend === "vulkan" && allLayers(c.layers) && (c.answer === "none" || c.answer === "vulkan/full")));
    if (offGpu.length > 0) wrong.push(`${gate.name}: ${offGpu.length} of ${calls.length} calls not on Vulkan with every layer offloaded (${[...new Set(offGpu.map((c) => `${c.resolved} on ${c.backend} (${c.layers}), answer ${c.answer}`))].join("; ")})`);
    if (!calls.some((c) => c.answer !== "none")) unproven.push(`${gate.name}: no call was answered`);
    if (execution.guardRuns < 1 || execution.hostPids.length < 1) unproven.push(`${gate.name}: no GPU host started behind the pack guard`);
    const devices = execution.vulkanDevices;
    if (devices === null) {
      if (topology !== "physical-console") unproven.push(`${gate.name}: the runtime's Vulkan device count was not recorded, and off the physical console readiness counts the NVIDIA GPU twice, so nothing shows the runtime bound only the NVIDIA GPU`);
    } else if (devices.length === 0 || devices.some((count) => !(count >= 1 && count <= nvidiaPci))) {
      unproven.push(`${gate.name}: the runtime bound ${JSON.stringify(devices)} Vulkan devices for ${nvidiaPci} NVIDIA PCI adapter(s): a device beyond them is not proven NVIDIA`);
    }
    if (readings.length < calls.length || loaded.length !== readings.length) {
      unproven.push(`${gate.name}: nvidia-smi did not read the NVIDIA GPU after every call (${JSON.stringify(readings)})`);
    } else if (idleMib === null || loadedMib === null || loadedMib - idleMib < input.minModelVramMib) {
      unproven.push(`${gate.name}: the NVIDIA GPU held ${loadedMib === null || idleMib === null ? "no" : loadedMib - idleMib} MiB over its idle reading while the model was loaded, less than the model's ${input.minModelVramMib} MiB`);
    }
    return summary;
  });
  if (gates.length === 0) unproven.push("no gate ran");

  const verdict: ComputeVerdict = wrong.length > 0 ? "FAIL" : unproven.length > 0 ? "INCONCLUSIVE" : "PASS";
  const label = verdict === "FAIL" ? COMPUTE_LABELS.wrong : verdict === "INCONCLUSIVE" ? COMPUTE_LABELS.unproven : topology === "physical-console" ? COMPUTE_LABELS.console : COMPUTE_LABELS.remote;
  return {
    verdict,
    label,
    topology,
    reasons: [...wrong, ...unproven],
    computeAdapters: { start: start.compute, end: end.compute },
    displayOnly: [...new Set([...start.displayOnly, ...end.displayOnly])],
    gates
  };
}
