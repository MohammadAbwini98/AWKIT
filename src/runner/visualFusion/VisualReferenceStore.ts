import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { replaceFileAtomically, type AtomicReplaceOptions } from "@src/storage/atomicReplace";

/**
 * N2.4b (awkit-vra.12.4b): the runner-owned "last known good" visual reference of a step — one element evidence per
 * `scopeKey`, in its own sidecar (`<root>/visual-references/<sha256(scopeKey)>.json`), never a field of
 * `LocatorRecoveryRecord` (FD-4). Plan: docs/plans/ai-upgrade-v5/N2-dom-vision-evidence-fusion.md › Reference.
 *
 * OPAQUE BY DESIGN. This module does not import `src/visual`: `VisualFusionStage` is the only runner module allowed to
 * (FD-2), so the evidence version, its size ceiling and how its content digest is read are injected by that adapter.
 *
 * NEVER THROWS. A missing, unreadable, oversized, malformed or foreign record reads as `missing`/`corrupt` (fusion R1,
 * unchecked); only a record of another evidence version reads as `version-mismatch` (R2). A failed write is reported,
 * not thrown — losing a reference only means the next step is unchecked.
 *
 * BOUNDED. One record per step, at most `maxEvidenceBytes` of evidence; the refresh table below is capped. Writes are
 * tmp + rename with the shared bounded EPERM/EBUSY retry (`src/storage/atomicReplace.ts`).
 */

export const VISUAL_REFERENCE_RECORD_VERSION = 1;
/**
 * `REFERENCE_REFRESH` (FD-9). Not measurable in the N2.3 lab, so set here as a policy anchor: a refresh costs one element
 * capture, and a step that passes in a loop must not pay one per iteration. A step's reference is rewritten at most
 * once per minute per process, and only when its content digest changed.
 */
export const VISUAL_REFERENCE_REFRESH_MS = 60_000;
/** Distinct steps whose last refresh is remembered; the oldest is forgotten first (it may then refresh early). */
export const VISUAL_REFERENCE_REFRESH_ENTRIES = 4096;
/** Room for the envelope around the evidence (scope key, digest, timestamps). */
const ENVELOPE_BYTES = 2048;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export interface VisualReferenceRecord {
  version: typeof VISUAL_REFERENCE_RECORD_VERSION;
  scopeKey: string;
  evidenceVersion: number;
  contentDigest: string;
  evidence: unknown;
  updatedAt: string;
}

export type VisualReferenceRead =
  | { status: "found"; evidence: unknown; contentDigest: string; updatedAt: string }
  | { status: "missing" }
  | { status: "corrupt" }
  | { status: "version-mismatch"; evidenceVersion: number };

export type VisualReferenceWrite =
  | { status: "written" }
  | { status: "unchanged" }
  | { status: "rate-limited" }
  | { status: "refused"; reason: "invalid" | "oversized" }
  | { status: "failed"; code: string };

export interface VisualReferenceStoreOptions {
  folder: string;
  /** The evidence version this build reads and writes (`VISUAL_EVIDENCE_VERSION`). */
  evidenceVersion: number;
  /** Serialised evidence ceiling (`VISUAL_EVIDENCE_MAX_BYTES`). */
  maxEvidenceBytes: number;
  /** The evidence's own content digest (`sha256:<hex>`), or null when it has none. */
  digestOf: (evidence: unknown) => string | null;
  refreshMs?: number;
  now?: () => number;
  replace?: AtomicReplaceOptions;
}

// In-process lanes and refresh times keyed by file path, shared by every store instance (each PlaywrightRunner builds
// its own), like `LocatorRecoveryStore`. Another process writing the same folder is not serialized; its write still
// lands whole because the rename is atomic, so the last writer wins.
const lanes = new Map<string, Promise<unknown>>();
const lastRefresh = new Map<string, number>();

function serialized<T>(key: string, task: () => Promise<T>): Promise<T> {
  const run = (lanes.get(key) ?? Promise.resolve()).then(task);
  const lane = run.catch(() => undefined);
  lanes.set(key, lane);
  void lane.then(() => {
    if (lanes.get(key) === lane) lanes.delete(key);
  });
  return run;
}

function markRefreshed(key: string, at: number): void {
  lastRefresh.delete(key);
  lastRefresh.set(key, at);
  while (lastRefresh.size > VISUAL_REFERENCE_REFRESH_ENTRIES) {
    const oldest = lastRefresh.keys().next().value as string;
    lastRefresh.delete(oldest);
  }
}

/** Diagnostics for the verifier: how many steps' refresh times this process holds. */
export function visualReferenceRefreshEntries(): number {
  return lastRefresh.size;
}

export class VisualReferenceStore {
  private readonly refreshMs: number;
  private readonly now: () => number;

  constructor(private readonly options: VisualReferenceStoreOptions) {
    this.refreshMs = options.refreshMs ?? VISUAL_REFERENCE_REFRESH_MS;
    this.now = options.now ?? Date.now;
  }

  async get(scopeKey: string): Promise<VisualReferenceRead> {
    let text: string;
    try {
      text = await readFile(this.pathFor(scopeKey), "utf8");
    } catch (error) {
      return (error as NodeJS.ErrnoException | null)?.code === "ENOENT" ? { status: "missing" } : { status: "corrupt" };
    }
    if (text.length > this.options.maxEvidenceBytes + ENVELOPE_BYTES) return { status: "corrupt" };
    let parsed: Partial<VisualReferenceRecord> | null;
    try {
      parsed = JSON.parse(text) as Partial<VisualReferenceRecord> | null;
    } catch {
      return { status: "corrupt" };
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.version !== VISUAL_REFERENCE_RECORD_VERSION ||
      parsed.scopeKey !== scopeKey ||
      !Number.isInteger(parsed.evidenceVersion) ||
      typeof parsed.contentDigest !== "string" ||
      !DIGEST.test(parsed.contentDigest) ||
      typeof parsed.updatedAt !== "string" ||
      !parsed.evidence ||
      typeof parsed.evidence !== "object"
    ) {
      return { status: "corrupt" };
    }
    if (parsed.evidenceVersion !== this.options.evidenceVersion) {
      return { status: "version-mismatch", evidenceVersion: parsed.evidenceVersion as number };
    }
    if (
      (parsed.evidence as { version?: unknown }).version !== parsed.evidenceVersion ||
      JSON.stringify(parsed.evidence).length > this.options.maxEvidenceBytes ||
      this.digest(parsed.evidence) !== parsed.contentDigest
    ) {
      return { status: "corrupt" };
    }
    return { status: "found", evidence: parsed.evidence, contentDigest: parsed.contentDigest, updatedAt: parsed.updatedAt };
  }

  /** Cheap, in-memory: false while this step's reference was refreshed less than `refreshMs` ago in this process. */
  dueForRefresh(scopeKey: string): boolean {
    const last = lastRefresh.get(this.laneKey(scopeKey));
    return last === undefined || this.now() - last >= this.refreshMs;
  }

  /**
   * Replace a step's reference with `evidence`, at most once per `refreshMs` and only when its content digest changed.
   * The caller decides eligibility (never a protected, handed-off, sensitive or ineligible step, never a refused
   * capture); this store only ever accepts a complete evidence record of its own version.
   */
  async refresh(scopeKey: string, evidence: unknown): Promise<VisualReferenceWrite> {
    const contentDigest = this.digest(evidence);
    if (!contentDigest || !evidence || typeof evidence !== "object" || (evidence as { version?: unknown }).version !== this.options.evidenceVersion) {
      return { status: "refused", reason: "invalid" };
    }
    if (JSON.stringify(evidence).length > this.options.maxEvidenceBytes) return { status: "refused", reason: "oversized" };
    const key = this.laneKey(scopeKey);
    return serialized(key, async (): Promise<VisualReferenceWrite> => {
      if (!this.dueForRefresh(scopeKey)) return { status: "rate-limited" };
      const at = this.now();
      markRefreshed(key, at);
      const current = await this.get(scopeKey);
      if (current.status === "found" && current.contentDigest === contentDigest) return { status: "unchanged" };
      const record: VisualReferenceRecord = {
        version: VISUAL_REFERENCE_RECORD_VERSION,
        scopeKey,
        evidenceVersion: this.options.evidenceVersion,
        contentDigest,
        evidence,
        updatedAt: new Date(at).toISOString()
      };
      const target = this.pathFor(scopeKey);
      const temp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
      try {
        await mkdir(this.options.folder, { recursive: true });
        await writeFile(temp, `${JSON.stringify(record)}\n`, "utf8");
        await replaceFileAtomically(temp, target, this.options.replace);
        return { status: "written" };
      } catch (error) {
        await rm(temp, { force: true }).catch(() => undefined);
        return { status: "failed", code: (error as NodeJS.ErrnoException | null)?.code ?? "UNKNOWN" };
      }
    });
  }

  private digest(evidence: unknown): string | null {
    try {
      const value = this.options.digestOf(evidence);
      return typeof value === "string" && DIGEST.test(value) ? value : null;
    } catch {
      return null;
    }
  }

  private laneKey(scopeKey: string): string {
    return resolve(this.pathFor(scopeKey));
  }

  private pathFor(scopeKey: string): string {
    return join(this.options.folder, `${createHash("sha256").update(scopeKey).digest("hex")}.json`);
  }
}
