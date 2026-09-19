/**
 * Durable store for `AiActionRecord`s and the self-demotion state they drive (Phase L, L1.4).
 *
 * One JSON document under the runtime data root, rewritten through the shared tmp+rename replace
 * (`src/storage/atomicReplace.ts`, which `app/main/atomicReplace.ts` re-exports) and serialized on
 * the folder write coordinator, so two concurrent appends can never drop each other.
 *
 * Demotion is persisted STATE, not a view recomputed on read: once the revert rate trips it, the
 * feature stays at T1 until an administrator restores it with `clearDemotion`. Re-promotion is
 * never automatic, so reverts ageing out of the window cannot silently restore auto-apply.
 *
 * Framework-agnostic: node:fs only, no Electron.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { evaluateSelfDemotion, isAiFeatureId, type AiFeatureId } from "../security/authz/AiAutonomyPolicy";
import { replaceFileAtomically } from "../storage/atomicReplace";
import { runExclusive } from "../storage/folderWriteCoordinator";
import {
  pruneAiActionRecords,
  sanitizeAiActionRecord,
  selfDemotionFacts,
  type AiActionRecord
} from "./AiActionRecord";

export interface AiFeatureDemotion {
  at: string;
  applied: number;
  reverted: number;
  revertRate: number;
}

export interface AiAuditSnapshot {
  /** Newest first. */
  records: AiActionRecord[];
  demotions: Partial<Record<AiFeatureId, AiFeatureDemotion>>;
}

export type AiAppendResult =
  | { ok: true; record: AiActionRecord; demoted: AiFeatureDemotion | null }
  | { ok: false; errors: string[] };

export class AiActionStore {
  constructor(
    private readonly filePath: string,
    private readonly now: () => number = () => Date.now(),
    private readonly log: (message: string) => void = (message) => console.warn(`[ai-audit] ${message}`)
  ) {}

  snapshot(): Promise<AiAuditSnapshot> {
    return this.read();
  }

  async get(id: string): Promise<AiActionRecord | null> {
    return (await this.read()).records.find((record) => record.id === id) ?? null;
  }

  /** Validate, prepend, prune, then re-evaluate the feature's demotion. Nothing is written on a refusal. */
  append(input: unknown): Promise<AiAppendResult> {
    const sanitized = sanitizeAiActionRecord(input);
    if (!sanitized.ok) return Promise.resolve(sanitized);
    const record = sanitized.record;
    return this.mutate<AiAppendResult>((state) => {
      if (state.records.some((existing) => existing.id === record.id)) {
        return { result: { ok: false, errors: ["duplicate id"] } };
      }
      state.records = pruneAiActionRecords([record, ...state.records], this.now());
      return { result: { ok: true, record, demoted: this.demoteIfTripped(state, record.feature) }, write: true };
    });
  }

  markReverted(id: string, atIso: string): Promise<"marked" | "not-found" | "already-reverted"> {
    return this.mutate((state) => {
      const record = state.records.find((candidate) => candidate.id === id);
      if (!record) return { result: "not-found" as const };
      if (record.reverted) return { result: "already-reverted" as const };
      record.reverted = { at: atIso };
      this.demoteIfTripped(state, record.feature);
      return { result: "marked" as const, write: true };
    });
  }

  /** The explicit administrator re-promotion. Returns false when the feature was not demoted. */
  clearDemotion(feature: AiFeatureId): Promise<boolean> {
    return this.mutate((state) => {
      if (!state.demotions[feature]) return { result: false };
      delete state.demotions[feature];
      return { result: true, write: true };
    });
  }

  private demoteIfTripped(state: AiAuditSnapshot, feature: AiFeatureId): AiFeatureDemotion | null {
    if (state.demotions[feature]) return null;
    const evaluation = evaluateSelfDemotion(feature, selfDemotionFacts(state.records), this.now());
    if (!evaluation.demote || evaluation.revertRate === null) return null;
    const demotion: AiFeatureDemotion = {
      at: new Date(this.now()).toISOString(),
      applied: evaluation.applied,
      reverted: evaluation.reverted,
      revertRate: evaluation.revertRate
    };
    state.demotions[feature] = demotion;
    return demotion;
  }

  private mutate<T>(change: (state: AiAuditSnapshot) => { result: T; write?: boolean }): Promise<T> {
    return runExclusive(dirname(this.filePath), async () => {
      const state = await this.read();
      const { result, write } = change(state);
      if (write) await this.write(state);
      return result;
    });
  }

  private async read(): Promise<AiAuditSnapshot> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { records: [], demotions: {} };
      throw error;
    }
    let parsed: { records?: unknown; demotions?: unknown };
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      // Preserve the bytes for recovery rather than overwriting them on the next append.
      const target = `${this.filePath}.corrupt-${this.now()}`;
      await rename(this.filePath, target).catch(() => undefined);
      this.log(`audit file was not valid JSON; preserved as ${target} and restarted empty`);
      return { records: [], demotions: {} };
    }
    const records: AiActionRecord[] = [];
    for (const candidate of Array.isArray(parsed.records) ? parsed.records : []) {
      const sanitized = sanitizeAiActionRecord(candidate);
      if (sanitized.ok) records.push(sanitized.record);
    }
    const demotions: AiAuditSnapshot["demotions"] = {};
    const storedDemotions = typeof parsed.demotions === "object" && parsed.demotions !== null ? parsed.demotions : {};
    for (const [feature, value] of Object.entries(storedDemotions)) {
      const demotion = value as Partial<AiFeatureDemotion>;
      if (
        isAiFeatureId(feature) &&
        typeof demotion?.at === "string" &&
        typeof demotion.applied === "number" &&
        typeof demotion.reverted === "number" &&
        typeof demotion.revertRate === "number"
      ) {
        demotions[feature] = { at: demotion.at, applied: demotion.applied, reverted: demotion.reverted, revertRate: demotion.revertRate };
      }
    }
    return { records: pruneAiActionRecords(records, this.now()), demotions };
  }

  private async write(state: AiAuditSnapshot): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    await writeFile(tmp, `${JSON.stringify({ schemaVersion: 1, records: state.records, demotions: state.demotions }, null, 2)}\n`, "utf8");
    await replaceFileAtomically(tmp, this.filePath);
  }
}
