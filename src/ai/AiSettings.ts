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

export interface AiSettings {
  enabled: boolean;
  yieldDuringRuns: boolean;
  /** 0 keeps the model loaded. */
  idleUnloadMinutes: number;
  /** Absent means the feature runs at its ceiling. */
  featureTiers: Partial<Record<AiFeatureId, AiTier>>;
}

export type AiSettingsPatch = Partial<AiSettings>;

export const MAX_IDLE_UNLOAD_MINUTES = 240;

/** AI is opt-in: nothing runs until an administrator imports a pack and turns it on. */
export const DEFAULT_AI_SETTINGS: Readonly<AiSettings> = Object.freeze({
  enabled: false,
  yieldDuringRuns: true,
  idleUnloadMinutes: 10,
  featureTiers: {}
});

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
  return {
    enabled: source.enabled === true,
    yieldDuringRuns: source.yieldDuringRuns !== false,
    idleUnloadMinutes:
      typeof minutes === "number" && Number.isInteger(minutes) && minutes >= 0 && minutes <= MAX_IDLE_UNLOAD_MINUTES
        ? minutes
        : DEFAULT_AI_SETTINGS.idleUnloadMinutes,
    featureTiers: tiers
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

  /** Apply an already-sanitized patch. `featureTiers` replaces the stored map rather than merging. */
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
