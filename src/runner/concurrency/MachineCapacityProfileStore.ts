/**
 * Per-machine capacity profile (Concurrency Capacity plan — Phase A3).
 *
 * Persists a capacity profile PER machine under the runtime root, and reconciles it against a fresh
 * detection. A profile calibrated on one machine is never reused on another: profiles are keyed by
 * `machineId`, and a material hardware change (different capability fingerprint) flags the profile as
 * requiring recalibration and drops the now-invalid benchmark measurements while PRESERVING the
 * administrator/manual `configuredCapacity` (see plan §12 migration rules).
 *
 * Pure `src/` core: only `node:fs`. The main process supplies the runtime-root path (framework-agnostic).
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  capabilitiesChanged,
  computeCapabilityFingerprint,
  type MachineCapabilities
} from "./MachineCapabilityDetector";
import type { CapacityRecommendation, CapacityTuning } from "./CapacityPlanner";

export interface MachineCapacityProfile {
  machineId: string;
  capabilitiesSnapshot: MachineCapabilities;
  /** Capability fingerprint this profile was last calibrated against. */
  fingerprint: string;
  /** True when the hardware changed since calibration (or a server-grade machine is not yet benchmarked). */
  requiresRecalibration: boolean;

  recommendedCapacity: number; // conservative recommended (pre/without benchmark)
  configuredCapacity: number; // administrator/manual — survives recalibration
  benchmarkTestedCapacity?: number; // highest sustainable stage measured on THIS hardware
  productionApprovedCapacity?: number; // margin below benchmarkTested
  absoluteSafetyCeiling: number;

  estimatedMemoryPerInstanceMb?: number; // measured; overrides seeds once known
  estimatedCpuCostPerInstance?: number;

  capacitySafetyFactor: number;

  lastBenchmarkId?: string;
  lastCalibratedAt?: string;
  updatedAt: string;
}

export interface ReconcileParams {
  existing: MachineCapacityProfile | null;
  capabilities: MachineCapabilities;
  recommendation: CapacityRecommendation;
  tuning: CapacityTuning;
  now?: Date;
}

export interface ReconcileResult {
  profile: MachineCapacityProfile;
  /** Reasons the hardware was considered materially changed (empty when unchanged / new). */
  recalibrationReasons: string[];
}

/**
 * Produce the capacity profile to use for the current machine, given the previously stored profile (if
 * any) and a fresh detection + recommendation. Pure — does no I/O, so it is fully unit-testable.
 *
 * - New machine: create a fresh conservative profile; `requiresRecalibration` mirrors whether the
 *   detected machine is server-grade (planner's `requiresBenchmark`).
 * - Unchanged hardware: refresh the conservative recommendation + snapshot but KEEP measured benchmark
 *   values and the administrator/manual `configuredCapacity`.
 * - Changed hardware: flag recalibration, DROP the stale benchmark/estimate values (they belonged to the
 *   old hardware), refresh the snapshot, and PRESERVE the administrator/manual `configuredCapacity`.
 */
export function reconcileMachineProfile(params: ReconcileParams): ReconcileResult {
  const { existing, capabilities, recommendation, tuning } = params;
  const now = (params.now ?? new Date()).toISOString();
  const fingerprint = computeCapabilityFingerprint(capabilities);
  const recommendedCapacity = recommendation.conservativeRecommendedCapacity;

  if (!existing) {
    return {
      recalibrationReasons: [],
      profile: {
        machineId: capabilities.machineId,
        capabilitiesSnapshot: capabilities,
        fingerprint,
        requiresRecalibration: recommendation.requiresBenchmark,
        recommendedCapacity,
        configuredCapacity: recommendedCapacity,
        absoluteSafetyCeiling: tuning.absoluteSafetyMaximum,
        capacitySafetyFactor: tuning.capacitySafetyFactor,
        updatedAt: now
      }
    };
  }

  const change = capabilitiesChanged(existing.capabilitiesSnapshot, capabilities);
  if (change.changed) {
    // Hardware changed — the old machine's benchmark numbers no longer apply. Keep only the
    // administrator/manual configured value; require recalibration before adopting higher limits.
    return {
      recalibrationReasons: change.reasons,
      profile: {
        machineId: capabilities.machineId,
        capabilitiesSnapshot: capabilities,
        fingerprint,
        requiresRecalibration: true,
        recommendedCapacity,
        configuredCapacity: existing.configuredCapacity, // preserved across recalibration
        benchmarkTestedCapacity: undefined,
        productionApprovedCapacity: undefined,
        estimatedMemoryPerInstanceMb: undefined,
        estimatedCpuCostPerInstance: undefined,
        absoluteSafetyCeiling: tuning.absoluteSafetyMaximum,
        capacitySafetyFactor: tuning.capacitySafetyFactor,
        lastBenchmarkId: undefined,
        lastCalibratedAt: undefined,
        updatedAt: now
      }
    };
  }

  // Same hardware — refresh the conservative recommendation + snapshot; keep measured calibration.
  return {
    recalibrationReasons: [],
    profile: {
      ...existing,
      capabilitiesSnapshot: capabilities,
      fingerprint,
      recommendedCapacity,
      absoluteSafetyCeiling: tuning.absoluteSafetyMaximum,
      capacitySafetyFactor: tuning.capacitySafetyFactor,
      updatedAt: now
    }
  };
}

/**
 * On-disk store: one JSON file per machine under `<runtimeRoot>/runtime/machine-profiles/`. Writes are
 * atomic (temp-file + rename) and serialized per store instance so overlapping saves cannot interleave.
 */
export class MachineCapacityProfileStore {
  private readonly folder: string;
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(runtimeRoot: string) {
    this.folder = join(runtimeRoot, "runtime", "machine-profiles");
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = this.writeChain.then(task, task);
    this.writeChain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private pathFor(machineId: string): string {
    // machineId is a locally generated UUID; sanitize defensively so it is always a safe filename.
    const safe = machineId.replace(/[^a-zA-Z0-9._-]/g, "_");
    return join(this.folder, `${safe}.json`);
  }

  async load(machineId: string): Promise<MachineCapacityProfile | null> {
    try {
      const parsed = JSON.parse(await readFile(this.pathFor(machineId), "utf8")) as MachineCapacityProfile;
      if (parsed && parsed.machineId === machineId) return parsed;
      return null;
    } catch {
      return null; // missing or corrupt — treated as "no profile yet"
    }
  }

  async save(profile: MachineCapacityProfile): Promise<void> {
    await this.serialize(async () => {
      await mkdir(this.folder, { recursive: true });
      const path = this.pathFor(profile.machineId);
      const tmp = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
      await writeFile(tmp, JSON.stringify(profile, null, 2), "utf8");
      try {
        await rename(tmp, path);
      } catch (error) {
        await rm(tmp, { force: true }).catch(() => undefined);
        throw error;
      }
    });
  }

  /** List all machine profiles present (used by reporting to label runs by machine). */
  async list(): Promise<MachineCapacityProfile[]> {
    let files: string[];
    try {
      files = (await readdir(this.folder)).filter((f) => f.endsWith(".json"));
    } catch {
      return [];
    }
    const profiles = await Promise.all(
      files.map(async (f) => {
        try {
          return JSON.parse(await readFile(join(this.folder, f), "utf8")) as MachineCapacityProfile;
        } catch {
          return null;
        }
      })
    );
    return profiles.filter((p): p is MachineCapacityProfile => p !== null);
  }
}
