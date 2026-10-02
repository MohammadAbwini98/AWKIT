/**
 * Local-AI settings (Phase L, L1.5): the master switch, per-feature tiers, yield-during-runs and
 * idle unload. No cloud fields exist, by design.
 *
 * Deliberately NOT a `UiSettings` group. The generic `settings:update` channel leaves every group
 * outside its substantive list open to any signed-in role, and `settings:import` / `settings:reset`
 * rewrite whole documents under other permissions; either would let a caller without `ai.manage`
 * flip the master switch or restore a tier an administrator lowered. This file has one writer,
 * `ai:updateSettings`, which is authorized for `ai.manage` with re-authentication.
 *
 * Reads are tolerant and fail closed: a missing file is the defaults (AI off), a corrupt file is
 * preserved and read as the defaults, and a configured tier that is not a valid tier for a known
 * feature reads as T0, the same value the autonomy policy gives it.
 *
 * Framework-agnostic: node:fs only, no Electron.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  AI_FEATURE_IDS,
  isAiFeatureId,
  isConfigurableAiTier,
  type AiFeatureId,
  type AiTier
} from "../security/authz/AiAutonomyPolicy";
import { replaceFileAtomically } from "../storage/atomicReplace";
import { runExclusive } from "../storage/folderWriteCoordinator";
import { AI_BUDGET_IDS, budgetBoundsSentence, isAiBudgetId, isBudgetSeconds, type AiBudgetId } from "./AiTimeBudgets";

/**
 * Where the model runs (L8a, E4; "auto" by owner decision 2026-10-03). "auto", the default, runs as
 * GPU-Offload when the GPU readiness check proves NVIDIA (a valid backend pack and only NVIDIA hardware
 * adapters) and as CPU & RAM only otherwise, decided at each load. "cpu" is CPU & RAM only, the one mode
 * that never touches the GPU. "gpu-offload" offloads the largest safe layer count and falls back to CPU
 * with a visible reason; "gpu-only" offloads every layer or refuses, never silently falling back.
 */
export type AiExecutionMode = "auto" | "cpu" | "gpu-offload" | "gpu-only";
export const AI_EXECUTION_MODES: readonly AiExecutionMode[] = Object.freeze(["auto", "cpu", "gpu-offload", "gpu-only"]);
/** What a load actually runs as: "auto" is always resolved to one of these first. */
export type AiEffectiveMode = Exclude<AiExecutionMode, "auto">;

export interface AiSettings {
  enabled: boolean;
  yieldDuringRuns: boolean;
  /** 0 keeps the model loaded. */
  idleUnloadMinutes: number;
  /** Absent means the feature runs at its ceiling. */
  featureTiers: Partial<Record<AiFeatureId, AiTier>>;
  executionMode: AiExecutionMode;
  /** VRAM kept free beside the model; null is the runtime's own system-derived padding. */
  vramReserveMb: number | null;
  /** L9.2: per-budget request timeouts in seconds; absent is the committed default (`AI_TIME_BUDGETS`). */
  timeBudgetSeconds: Partial<Record<AiBudgetId, number>>;
}

export type AiSettingsPatch = Partial<AiSettings>;

export const MAX_IDLE_UNLOAD_MINUTES = 240;
/** Committed bounds for an administrator's VRAM reserve. Outside them a value is refused, not clamped. */
export const MIN_VRAM_RESERVE_MB = 128;
export const MAX_VRAM_RESERVE_MB = 32768;

/** AI is opt-in: nothing runs until an administrator imports a pack and turns it on. */
export const DEFAULT_AI_SETTINGS: Readonly<AiSettings> = Object.freeze({
  enabled: false,
  yieldDuringRuns: true,
  idleUnloadMinutes: 10,
  featureTiers: {},
  executionMode: "auto",
  vramReserveMb: null,
  timeBudgetSeconds: {}
});

const isReserveMb = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= MIN_VRAM_RESERVE_MB && value <= MAX_VRAM_RESERVE_MB;

export type AiSettingsSanitizeResult = { ok: true; value: AiSettingsPatch } | { ok: false; errors: string[] };

/**
 * Validate an untrusted patch. Unknown top-level keys are dropped (a newer renderer must not fail
 * against an older main process), but a present, malformed value is an error, and a tier above a
 * feature's ceiling is refused rather than clamped: the caller must learn it asked for too much.
 */
export function sanitizeAiSettingsPatch(input: unknown): AiSettingsSanitizeResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: ["AI settings patch must be an object."] };
  }
  const raw = input as Record<string, unknown>;
  const errors: string[] = [];
  const patch: AiSettingsPatch = {};
  for (const key of ["enabled", "yieldDuringRuns"] as const) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== "boolean") errors.push(`${key} must be true or false.`);
    else patch[key] = raw[key] as boolean;
  }
  if (raw.idleUnloadMinutes !== undefined) {
    const minutes = raw.idleUnloadMinutes;
    if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 0 || minutes > MAX_IDLE_UNLOAD_MINUTES) {
      errors.push(`Idle unload must be a whole number of minutes from 0 to ${MAX_IDLE_UNLOAD_MINUTES}.`);
    } else {
      patch.idleUnloadMinutes = minutes;
    }
  }
  if (raw.featureTiers !== undefined) {
    const tiers = raw.featureTiers;
    if (typeof tiers !== "object" || tiers === null || Array.isArray(tiers)) {
      errors.push("featureTiers must be an object.");
    } else {
      const next: Partial<Record<AiFeatureId, AiTier>> = {};
      for (const [feature, tier] of Object.entries(tiers as Record<string, unknown>)) {
        if (!isAiFeatureId(feature)) errors.push("featureTiers names an unknown feature.");
        else if (!isConfigurableAiTier(feature, tier)) errors.push(`${feature} cannot be set to that tier; its ceiling is fixed by policy.`);
        else next[feature] = tier as AiTier;
      }
      patch.featureTiers = next;
    }
  }
  if (raw.executionMode !== undefined) {
    if (!AI_EXECUTION_MODES.includes(raw.executionMode as AiExecutionMode)) errors.push("executionMode must be auto, cpu, gpu-offload or gpu-only.");
    else patch.executionMode = raw.executionMode as AiExecutionMode;
  }
  if (raw.vramReserveMb !== undefined) {
    if (raw.vramReserveMb !== null && !isReserveMb(raw.vramReserveMb)) {
      errors.push(`The VRAM reserve must be a whole number of MB from ${MIN_VRAM_RESERVE_MB} to ${MAX_VRAM_RESERVE_MB}, or the system default.`);
    } else {
      patch.vramReserveMb = raw.vramReserveMb as number | null;
    }
  }
  // Like featureTiers, the map replaces the stored one; a budget left out returns to its default.
  if (raw.timeBudgetSeconds !== undefined) {
    const budgets = raw.timeBudgetSeconds;
    if (typeof budgets !== "object" || budgets === null || Array.isArray(budgets)) {
      errors.push("timeBudgetSeconds must be an object.");
    } else {
      const next: Partial<Record<AiBudgetId, number>> = {};
      for (const [id, seconds] of Object.entries(budgets as Record<string, unknown>)) {
        if (!isAiBudgetId(id)) errors.push("timeBudgetSeconds names an unknown budget.");
        else if (!isBudgetSeconds(id, seconds)) errors.push(budgetBoundsSentence(id));
        else next[id] = seconds;
      }
      patch.timeBudgetSeconds = next;
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: patch };
}

/** Normalize whatever is on disk. Never throws; fails closed. */
export function normalizeAiSettings(raw: unknown): AiSettings {
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const tiers: Partial<Record<AiFeatureId, AiTier>> = {};
  const storedTiers = typeof source.featureTiers === "object" && source.featureTiers !== null ? (source.featureTiers as Record<string, unknown>) : {};
  for (const feature of AI_FEATURE_IDS) {
    if (!(feature in storedTiers)) continue;
    tiers[feature] = isConfigurableAiTier(feature, storedTiers[feature]) ? (storedTiers[feature] as AiTier) : "T0";
  }
  const minutes = source.idleUnloadMinutes;
  // A file from before L9, or a stored value outside today's bounds, reads as the default: never clamped.
  const storedBudgets = typeof source.timeBudgetSeconds === "object" && source.timeBudgetSeconds !== null ? (source.timeBudgetSeconds as Record<string, unknown>) : {};
  const timeBudgetSeconds: Partial<Record<AiBudgetId, number>> = {};
  for (const id of AI_BUDGET_IDS) if (isBudgetSeconds(id, storedBudgets[id])) timeBudgetSeconds[id] = storedBudgets[id] as number;
  return {
    enabled: source.enabled === true,
    yieldDuringRuns: source.yieldDuringRuns !== false,
    idleUnloadMinutes:
      typeof minutes === "number" && Number.isInteger(minutes) && minutes >= 0 && minutes <= MAX_IDLE_UNLOAD_MINUTES
        ? minutes
        : DEFAULT_AI_SETTINGS.idleUnloadMinutes,
    featureTiers: tiers,
    // No mode stored (a file from before L8a) was never chosen, so it gets the default. A stored mode is kept
    // as written, "cpu" included, and a value this version does not know is CPU & RAM only (fail closed).
    executionMode:
      source.executionMode === undefined
        ? DEFAULT_AI_SETTINGS.executionMode
        : AI_EXECUTION_MODES.includes(source.executionMode as AiExecutionMode)
          ? (source.executionMode as AiExecutionMode)
          : "cpu",
    vramReserveMb: isReserveMb(source.vramReserveMb) ? source.vramReserveMb : null,
    timeBudgetSeconds
  };
}

export class AiSettingsStore {
  constructor(
    private readonly filePath: string,
    private readonly log: (message: string) => void = (message) => console.warn(`[ai-settings] ${message}`)
  ) {}

  async read(): Promise<AiSettings> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch {
      return normalizeAiSettings(DEFAULT_AI_SETTINGS);
    }
    try {
      return normalizeAiSettings(JSON.parse(raw));
    } catch {
      const target = `${this.filePath}.corrupt-${Date.now()}`;
      await rename(this.filePath, target).catch(() => undefined);
      this.log(`settings file was not valid JSON; preserved as ${target}, AI reads as off`);
      return normalizeAiSettings(DEFAULT_AI_SETTINGS);
    }
  }

  /** Apply an already-sanitized patch. `featureTiers` and `timeBudgetSeconds` replace the stored maps rather than merging. */
  update(patch: AiSettingsPatch): Promise<AiSettings> {
    return runExclusive(dirname(this.filePath), async () => {
      const next = normalizeAiSettings({ ...(await this.read()), ...patch });
      await mkdir(dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
      await writeFile(tmp, `${JSON.stringify({ schemaVersion: 1, ...next }, null, 2)}\n`, "utf8");
      await replaceFileAtomically(tmp, this.filePath);
      return next;
    });
  }
}
