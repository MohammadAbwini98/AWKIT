/**
 * Measured job durations for ETA ranges (Phase L, L9.4, E9) — and the local measurement of the latency
 * class that L8b defined and left unmeasured (E6: "measured locally or not claimed").
 *
 * Bounded, non-sensitive aggregates: per key, the last `samplesPerKey` running durations of completed
 * jobs, split cold (the job loaded the model) and warm. A key is a latency class id — the quality key
 * (model SHA-256, runtime build, backend, offload class, context, KV settings, feature, output budget)
 * on a coarse hardware class — so it names a configuration, never a prompt, page, response, path or
 * credential; anything that does not look like one is refused on write and dropped on read.
 *
 * Stored under the runtime data root (never resources), written through the retry-safe tmp + rename
 * (`replaceFileAtomically`), versioned: a file from a NEWER version is read as no history and never
 * overwritten; a corrupt file is preserved beside it and read as no history. At most `maxKeys` keys,
 * the least recently updated dropped first.
 *
 * Framework-agnostic: node:fs only.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { replaceFileAtomically } from "../storage/atomicReplace";
import { runExclusive } from "../storage/folderWriteCoordinator";
import { etaConfidence, type AiEtaEstimate } from "./AiJobStatus";

export const AI_ETA_HISTORY_VERSION = 1;

export const AI_ETA_HISTORY_LIMITS = Object.freeze({
  maxKeys: 64,
  samplesPerKey: 20,
  /** Longer than any budget allows; a larger value is not a job duration. */
  maxSampleMs: 3 * 60 * 60_000,
  /** At and above this many samples the range trims the outer tenths instead of spanning min to max. */
  trimFrom: 5
});

/**
 * Hex, build tags (`node-llama-cpp@3.21.1+llama.cpp@v0.4.0`), backend and feature names, `|`, `:`, `@`,
 * `+` and dashes: the shapes a latency class id has. No space, slash or backslash, so no free text or path.
 */
const KEY = /^[A-Za-z0-9._|:@+-]{8,400}$/;

interface Entry {
  cold: number[];
  warm: number[];
  updatedAt: string;
}

interface HistoryFile {
  schemaVersion: number;
  entries: Record<string, Entry>;
}

export type AiEtaHistorySnapshot = { writable: boolean; entries: Map<string, Entry> };

const isSample = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value <= AI_ETA_HISTORY_LIMITS.maxSampleMs;

export const isEtaKey = (key: unknown): key is string => typeof key === "string" && KEY.test(key);

function sampleList(value: unknown): number[] {
  return Array.isArray(value) ? value.filter(isSample).slice(-AI_ETA_HISTORY_LIMITS.samplesPerKey) : [];
}

/** A measured range: min to max for a few samples, the 10th to 90th percentile (nearest rank) for more. */
export function estimateFromSamples(samples: readonly number[]): AiEtaEstimate | null {
  const sorted = samples.filter(isSample).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const rank = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
  const trim = sorted.length >= AI_ETA_HISTORY_LIMITS.trimFrom;
  return {
    minMs: trim ? rank(0.1) : sorted[0],
    maxMs: trim ? rank(0.9) : sorted[sorted.length - 1],
    samples: sorted.length,
    confidence: etaConfidence(sorted.length)
  };
}

export class AiEtaHistoryStore {
  constructor(
    private readonly filePath: string,
    private readonly now: () => number = () => Date.now(),
    private readonly log: (message: string) => void = (message) => console.warn(`[ai-eta] ${message}`)
  ) {}

  async read(): Promise<AiEtaHistorySnapshot> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch {
      return { writable: true, entries: new Map() };
    }
    let parsed: Partial<HistoryFile>;
    try {
      parsed = JSON.parse(raw) as Partial<HistoryFile>;
    } catch {
      const target = `${this.filePath}.corrupt-${this.now()}`;
      await rename(this.filePath, target).catch(() => undefined);
      this.log(`history file was not valid JSON; preserved as ${target}, ETA reads as no history`);
      return { writable: true, entries: new Map() };
    }
    // A newer version's file is left exactly as it is: this version neither reads nor rewrites it.
    if (parsed?.schemaVersion !== AI_ETA_HISTORY_VERSION) return { writable: false, entries: new Map() };
    const entries = new Map<string, Entry>();
    const stored = typeof parsed.entries === "object" && parsed.entries !== null ? (parsed.entries as Record<string, unknown>) : {};
    for (const [key, value] of Object.entries(stored)) {
      if (!isEtaKey(key) || typeof value !== "object" || value === null) continue;
      const entry = value as Record<string, unknown>;
      const updatedAt = typeof entry.updatedAt === "string" && !Number.isNaN(Date.parse(entry.updatedAt)) ? entry.updatedAt : new Date(0).toISOString();
      entries.set(key, { cold: sampleList(entry.cold), warm: sampleList(entry.warm), updatedAt });
    }
    return { writable: true, entries };
  }

  async estimate(key: string, cold: boolean): Promise<AiEtaEstimate | null> {
    if (!isEtaKey(key)) return null;
    const entry = (await this.read()).entries.get(key);
    return entry ? estimateFromSamples(cold ? entry.cold : entry.warm) : null;
  }

  /** Every stored sample list, for Settings' measured speed. */
  async entries(): Promise<ReadonlyMap<string, { cold: readonly number[]; warm: readonly number[] }>> {
    return (await this.read()).entries;
  }

  /** Add one completed job's running duration. False, and nothing written, when it cannot be stored. */
  record(key: string, cold: boolean, runMs: number): Promise<boolean> {
    const ms = Math.round(runMs);
    if (!isEtaKey(key) || !isSample(ms)) return Promise.resolve(false);
    return runExclusive(dirname(this.filePath), async () => {
      const snapshot = await this.read();
      if (!snapshot.writable) return false;
      const entries = snapshot.entries;
      const entry = entries.get(key) ?? { cold: [], warm: [], updatedAt: "" };
      const list = cold ? entry.cold : entry.warm;
      list.push(ms);
      entries.set(key, {
        cold: entry.cold.slice(-AI_ETA_HISTORY_LIMITS.samplesPerKey),
        warm: entry.warm.slice(-AI_ETA_HISTORY_LIMITS.samplesPerKey),
        updatedAt: new Date(this.now()).toISOString()
      });
      // The key just written always stays; the rest keep their most recently updated.
      const others = [...entries.entries()].filter(([name]) => name !== key).sort((a, b) => Date.parse(b[1].updatedAt) - Date.parse(a[1].updatedAt));
      const kept = [[key, entries.get(key)!] as const, ...others].slice(0, AI_ETA_HISTORY_LIMITS.maxKeys);
      const file: HistoryFile = { schemaVersion: AI_ETA_HISTORY_VERSION, entries: Object.fromEntries(kept) };
      await mkdir(dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.${process.pid}.${this.now()}.${Math.random().toString(16).slice(2)}.tmp`;
      await writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`, "utf8");
      await replaceFileAtomically(tmp, this.filePath);
      return true;
    });
  }
}
