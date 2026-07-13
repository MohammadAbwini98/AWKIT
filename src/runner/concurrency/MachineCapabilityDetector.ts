/**
 * Machine capability detection (Concurrency Capacity plan — Phase A1).
 *
 * Inspects the CURRENT host and records a hardware-agnostic capability snapshot. Nothing here is
 * specific to any machine shape: every value is read from `node:os` at runtime. A stable, locally
 * generated `machineId` (never a hardware serial / MAC) plus a coarse capability *fingerprint* let the
 * per-machine capacity profile (Phase A3) detect when the host changed and needs recalibration.
 *
 * Framework-agnostic (`src/` rule): only `node:os` / `node:fs` / `node:crypto`, no Electron/React. The
 * OS reads are injectable (`OsProbe`) so the planner/detector can be unit-tested against synthetic
 * machine shapes without touching the real host.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import os from "node:os";

export interface MachineCapabilities {
  /** Locally generated install/machine id (see loadOrCreateMachineId). NOT a hardware serial. */
  machineId: string;
  /** Best-effort, non-authoritative (hostnames can change or duplicate). */
  hostname?: string;
  platform: string;
  architecture: string;

  logicalCpuCount: number;
  /** Best-effort; undefined when the physical core count is not reliably detectable. */
  physicalCpuCount?: number;
  totalMemoryMb: number;
  /** Currently available memory at detection time — fluctuates; not part of the fingerprint. */
  availableMemoryMb: number;

  cpuModel?: string;
  cpuBaseSpeedMhz?: number;

  operatingSystem: string;
  operatingSystemVersion?: string;

  detectedAt: string;
}

/** Minimal surface of `node:os` the detector needs; injectable so tests can supply fake machines. */
export interface OsProbe {
  platform(): string;
  arch(): string;
  type(): string;
  release(): string;
  hostname(): string;
  totalmem(): number;
  freemem(): number;
  cpus(): Array<{ model?: string; speed?: number }>;
}

export const nodeOsProbe: OsProbe = {
  platform: () => os.platform(),
  arch: () => os.arch(),
  type: () => os.type(),
  release: () => os.release(),
  hostname: () => os.hostname(),
  totalmem: () => os.totalmem(),
  freemem: () => os.freemem(),
  cpus: () => os.cpus() ?? []
};

const BYTES_PER_MB = 1024 * 1024;
const MB_PER_GB = 1024;

function toMb(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.round(bytes / BYTES_PER_MB);
}

/**
 * Detect the current host's capabilities. Never throws — a probe that returns garbage yields a minimal
 * snapshot (counts floored to sane values, optional fields left undefined) rather than failing.
 */
export function detectMachineCapabilities(
  machineId: string,
  opts: { probe?: OsProbe; now?: Date } = {}
): MachineCapabilities {
  const probe = opts.probe ?? nodeOsProbe;
  const now = opts.now ?? new Date();

  let cpus: Array<{ model?: string; speed?: number }> = [];
  try {
    cpus = probe.cpus() ?? [];
  } catch {
    cpus = [];
  }

  const logicalCpuCount = Math.max(1, cpus.length || 0);
  const cpuModel = cpus[0]?.model?.trim() || undefined;
  const speed = cpus[0]?.speed;
  const cpuBaseSpeedMhz = typeof speed === "number" && speed > 0 ? Math.round(speed) : undefined;

  const safe = <T>(fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };

  const hostname = safe(() => probe.hostname(), "").trim() || undefined;
  const operatingSystemVersion = safe(() => probe.release(), "").trim() || undefined;

  return {
    machineId,
    hostname,
    platform: safe(() => probe.platform(), "unknown") || "unknown",
    architecture: safe(() => probe.arch(), "unknown") || "unknown",
    logicalCpuCount,
    physicalCpuCount: undefined, // not reliably detectable cross-platform without native deps
    totalMemoryMb: toMb(safe(() => probe.totalmem(), 0)),
    availableMemoryMb: toMb(safe(() => probe.freemem(), 0)),
    cpuModel,
    cpuBaseSpeedMhz,
    operatingSystem: safe(() => probe.type(), "unknown") || "unknown",
    operatingSystemVersion,
    detectedAt: now.toISOString()
  };
}

/**
 * Coarse, stable fingerprint of the *material* hardware shape. Deliberately excludes fluctuating
 * `availableMemoryMb`, timestamps, hostname, and OS patch version so a reboot with identical hardware
 * produces the same fingerprint, while a real change (CPU count, total-RAM band, arch, OS family)
 * produces a different one. Total memory is banded to whole GB so trivial reporting drift on a VM does
 * not false-trigger recalibration.
 */
export function computeCapabilityFingerprint(caps: MachineCapabilities): string {
  const totalMemGb = Math.round(caps.totalMemoryMb / MB_PER_GB);
  const canonical = [
    `platform=${caps.platform}`,
    `arch=${caps.architecture}`,
    `os=${caps.operatingSystem}`,
    `cpu=${caps.logicalCpuCount}`,
    `memGb=${totalMemGb}`
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

export interface CapabilityChange {
  changed: boolean;
  reasons: string[];
}

/**
 * Compare a previously calibrated snapshot to a freshly detected one and report whether the machine
 * changed materially enough to require recalibration, with human-readable reasons.
 */
export function capabilitiesChanged(prev: MachineCapabilities, next: MachineCapabilities): CapabilityChange {
  const reasons: string[] = [];
  if (prev.machineId !== next.machineId) reasons.push("machine identity changed");
  if (prev.logicalCpuCount !== next.logicalCpuCount)
    reasons.push(`logical CPU count changed (${prev.logicalCpuCount} → ${next.logicalCpuCount})`);
  const prevGb = Math.round(prev.totalMemoryMb / MB_PER_GB);
  const nextGb = Math.round(next.totalMemoryMb / MB_PER_GB);
  if (prevGb !== nextGb) reasons.push(`total memory changed (${prevGb} GB → ${nextGb} GB)`);
  if (prev.platform !== next.platform) reasons.push(`platform changed (${prev.platform} → ${next.platform})`);
  if (prev.architecture !== next.architecture)
    reasons.push(`architecture changed (${prev.architecture} → ${next.architecture})`);
  if (prev.operatingSystem !== next.operatingSystem)
    reasons.push(`operating system changed (${prev.operatingSystem} → ${next.operatingSystem})`);
  return { changed: reasons.length > 0, reasons };
}

interface MachineIdFile {
  machineId: string;
  createdAt: string;
}

async function writeFileAtomic(path: string, data: string): Promise<void> {
  const tmp = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tmp, data, "utf8");
  try {
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Load the machine's stable install id from `<runtimeRoot>/machine-id.json`, or generate + persist a
 * new random UUID on first run (or when the file is missing/corrupt). Best-effort: if persistence
 * fails, a freshly generated id is still returned so detection never blocks — the id simply won't
 * survive a restart until the write succeeds.
 */
export async function loadOrCreateMachineId(runtimeRoot: string): Promise<string> {
  const path = join(runtimeRoot, "machine-id.json");
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<MachineIdFile>;
    if (parsed && typeof parsed.machineId === "string" && parsed.machineId.trim().length > 0) {
      return parsed.machineId;
    }
  } catch {
    /* missing or corrupt — fall through and (re)create */
  }
  const machineId = randomUUID();
  const record: MachineIdFile = { machineId, createdAt: new Date().toISOString() };
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFileAtomic(path, JSON.stringify(record, null, 2));
  } catch {
    /* best-effort persistence; still return the id */
  }
  return machineId;
}

/**
 * Convenience service the app uses: resolve the stable machineId then detect capabilities against it.
 * Kept thin so the pure functions above stay independently testable.
 */
export class MachineCapabilityDetector {
  constructor(private readonly runtimeRoot: string, private readonly probe: OsProbe = nodeOsProbe) {}

  async detect(now: Date = new Date()): Promise<MachineCapabilities> {
    const machineId = await loadOrCreateMachineId(this.runtimeRoot);
    return detectMachineCapabilities(machineId, { probe: this.probe, now });
  }
}
