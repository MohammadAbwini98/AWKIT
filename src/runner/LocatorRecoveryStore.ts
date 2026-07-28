import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface LocatorElementFingerprint {
  tag: string;
  role: string;
  name: string;
  text: string;
  attributes: Record<string, string>;
  ancestry: string[];
}

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

  private pathFor(scopeKey: string): string {
    const digest = createHash("sha256").update(scopeKey).digest("hex");
    return join(this.folder, `${digest}.json`);
  }
}

export function locatorCandidatesDigest(signatures: string[]): string {
  return createHash("sha256").update(JSON.stringify(signatures)).digest("hex");
}
