import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LocatorElementFingerprint } from "@src/profiles/FlowProfile";

// The fingerprint shape now lives with the flow schema (it is persisted inside `LocatorGuard`).
// Re-exported here so existing runner imports (`from "./LocatorRecoveryStore"`) keep resolving.
export type { LocatorElementFingerprint };

export interface LocatorRecoveryRecord {
  version: 1;
  scopeKey: string;
  candidatesDigest: string;
  winningCandidateSignature: string;
  fingerprint?: LocatorElementFingerprint;
  source: "recorded-candidate" | "local-recovery";
  updatedAt: string;
}

export interface LocatorRecoveryStore {
  get(scopeKey: string): Promise<LocatorRecoveryRecord | undefined>;
  put(record: LocatorRecoveryRecord): Promise<void>;
  /**
   * Every remembered record. Bounded by `limit` because this memory grows with every distinct step
   * the runner has ever resolved, and the only caller (the semantic snapshot) wants a bounded
   * corpus rather than the whole history.
   *
   * Files that no longer parse are SKIPPED, not thrown: one corrupt record must not make the memory
   * unreadable — the same tolerance `get` already applies per key.
   */
  list(limit?: number): Promise<LocatorRecoveryRecord[]>;
}

/** Durable, offline-only locator memory. One hashed file per step avoids cross-run file contention. */
export class FileLocatorRecoveryStore implements LocatorRecoveryStore {
  constructor(private readonly folder: string) {}

  async get(scopeKey: string): Promise<LocatorRecoveryRecord | undefined> {
    try {
      const parsed = JSON.parse(await readFile(this.pathFor(scopeKey), "utf8")) as Partial<LocatorRecoveryRecord>;
      if (
        parsed.version !== 1 ||
        parsed.scopeKey !== scopeKey ||
        typeof parsed.candidatesDigest !== "string" ||
        typeof parsed.winningCandidateSignature !== "string"
      ) {
        return undefined;
      }
      return parsed as LocatorRecoveryRecord;
    } catch {
      return undefined;
    }
  }

  async put(record: LocatorRecoveryRecord): Promise<void> {
    await mkdir(this.folder, { recursive: true });
    const target = this.pathFor(record.scopeKey);
    const temp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    try {
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async list(limit = 2000): Promise<LocatorRecoveryRecord[]> {
    let names: string[];
    try {
      names = await readdir(this.folder);
    } catch {
      // No folder yet simply means nothing has been remembered. That is an empty memory, not a fault.
      return [];
    }

    const records: LocatorRecoveryRecord[] = [];
    for (const name of names) {
      if (records.length >= limit) break;
      if (!name.endsWith(".json")) continue;
      try {
        const parsed = JSON.parse(await readFile(join(this.folder, name), "utf8")) as Partial<LocatorRecoveryRecord>;
        // Same shape gate `get` applies. Validated here too because a file read by name has not been
        // matched against an expected scopeKey, so nothing else would catch a malformed record.
        if (
          parsed.version !== 1 ||
          typeof parsed.scopeKey !== "string" ||
          typeof parsed.candidatesDigest !== "string" ||
          typeof parsed.winningCandidateSignature !== "string"
        ) {
          continue;
        }
        records.push(parsed as LocatorRecoveryRecord);
      } catch {
        continue;
      }
    }
    return records;
  }

  private pathFor(scopeKey: string): string {
    const digest = createHash("sha256").update(scopeKey).digest("hex");
    return join(this.folder, `${digest}.json`);
  }
}

export function locatorCandidatesDigest(signatures: string[]): string {
  return createHash("sha256").update(JSON.stringify(signatures)).digest("hex");
}
