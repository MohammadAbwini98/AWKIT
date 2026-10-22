/**
 * Visual baseline storage layout and the KEYLESS half of the N6 baseline lifecycle (Phase N, N6.3 /
 * awkit-vra.15.3). Plan: docs/plans/ai-upgrade-v5/N6-visual-assertions.md, VA-5, VA-11, VA-14, C2, C3.
 *
 * Two places, two identities:
 *
 *  - IN THE FLOWS FOLDER (`<flows>/.awkit-visual/`): the cross-process lock and the unsigned epoch
 *    tokens. Both builds share them, and they follow the folder itself, so a changed Settings flows
 *    path can never let same-id flows elsewhere inherit a token (C2, C3). The folder name does not end
 *    in `.json`, so no profile scan reads it. Every path here is built from the folder's NATIVE REAL
 *    PATH, so one folder reached through a junction, a symlink, another case or a trailing separator is
 *    one lock and one set of tokens.
 *  - UNDER THE RUNTIME ROOT (`<runtime>/visual-baselines/<mode>/<folderKey>/<flowKey>/`): signed
 *    indexes and records, one tree per app mode, keyed by that same resolved folder identity.
 *
 * Nothing here needs a key. Invalidation writes a fresh random token FIRST and only then deletes the
 * flow's signed files in every mode, so a crash part-way through can only leave files whose epoch no
 * longer matches (ignored, swept later), never revive an approval.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { link, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { replaceFileAtomically } from "../../storage/atomicReplace";
import { CrossProcessLockError, currentCrossProcessLease, withCrossProcessLock, type CrossProcessLockOptions } from "../../storage/crossProcessLock";
import { runExclusive } from "../../storage/folderWriteCoordinator";

export type VisualBaselineAppMode = "packaged" | "dev";
export const VISUAL_BASELINE_APP_MODES: readonly VisualBaselineAppMode[] = ["packaged", "dev"];

/** Private subfolder of the flows folder. */
export const FLOWS_PRIVATE_FOLDER = ".awkit-visual";
const TOKEN_PATTERN = /^[0-9a-f]{32}$/;

export interface VisualBaselineLayoutOptions {
  /** The configured flows folder. Its physical identity is resolved here. */
  flowsFolder: string;
  /** The runtime root that holds `visual-baselines/`. */
  runtimeRoot: string;
  /** Cross-process lock deadline (default 5000 ms). */
  lockTimeoutMs?: number;
  /** Verifier seam for the lock's liveness probe; production leaves it unset. */
  isProcessAlive?: (pid: number) => boolean;
  /** Verifier seam for the hard-link probe; production leaves it unset. */
  probeHardLinks?: (directory: string) => Promise<boolean>;
}

export const sha256Hex = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

/** Whether `directory` supports hard links (the lock's atomic publish). Any failure is "no". */
async function defaultProbeHardLinks(directory: string): Promise<boolean> {
  await mkdir(directory, { recursive: true });
  const source = join(directory, `probe.${randomBytes(8).toString("hex")}`);
  const target = `${source}.link`;
  try {
    await writeFile(source, "probe", { flag: "wx" });
    await link(source, target);
    return true;
  } catch {
    return false;
  } finally {
    await rm(source, { force: true });
    await rm(target, { force: true });
  }
}

const probeResults = new Map<string, Promise<boolean>>();
const warnedFallback = new Set<string>();

/** Inside a coordinated critical section for a flows folder (lane + cross-process lock), by configured path. */
const coordinated = new AsyncLocalStorage<ReadonlySet<string>>();
/** Inside a flow write on a folder that cannot be coordinated across processes (no hard links). */
const uncoordinated = new AsyncLocalStorage<ReadonlySet<string>>();

export class VisualBaselineLayout {
  readonly flowsFolder: string;
  readonly runtimeRoot: string;
  private resolved: Promise<string> | null = null;

  constructor(private readonly options: VisualBaselineLayoutOptions) {
    this.flowsFolder = options.flowsFolder;
    this.runtimeRoot = options.runtimeRoot;
  }

  // ── Identity and paths ─────────────────────────────────────────────────────────────────────

  /** The flows folder's native real path (created first so it can be resolved). */
  realFlowsFolder(): Promise<string> {
    if (!this.resolved) {
      this.resolved = mkdir(this.flowsFolder, { recursive: true }).then(() => realpathSync.native(this.flowsFolder));
      this.resolved.catch(() => {
        this.resolved = null;
      });
    }
    return this.resolved;
  }

  /** Physical identity of the flows folder: its native real path, lower-cased on Windows (NTFS is case-insensitive). */
  async folderKey(): Promise<string> {
    const real = await this.realFlowsFolder();
    return sha256Hex(`awkit-n6-folder-v1\u0000${process.platform === "win32" ? real.toLowerCase() : real}`);
  }

  flowKey(flowId: string): string {
    return sha256Hex(`awkit-n6-flow-v1\u0000${flowId}`);
  }

  stepKey(stepId: string): string {
    return sha256Hex(`awkit-n6-step-v1\u0000${stepId}`);
  }

  modeRoot(mode: VisualBaselineAppMode): string {
    return join(this.runtimeRoot, "visual-baselines", mode);
  }

  async flowDirectory(mode: VisualBaselineAppMode, flowId: string): Promise<string> {
    return join(this.modeRoot(mode), await this.folderKey(), this.flowKey(flowId));
  }

  private async privateFolder(): Promise<string> {
    return join(await this.realFlowsFolder(), FLOWS_PRIVATE_FOLDER);
  }

  private async tokenPath(flowId: string): Promise<string> {
    return join(await this.privateFolder(), "epochs", `${this.flowKey(flowId)}.token`);
  }

  /** The cross-process lock for this flows folder, at its physical location. Overridable for verifier variants. */
  protected async lockOptions(): Promise<CrossProcessLockOptions> {
    return {
      directory: join(await this.privateFolder(), "locks"),
      name: "flows",
      timeoutMs: this.options.lockTimeoutMs,
      isProcessAlive: this.options.isProcessAlive
    };
  }

  // ── Coordination ───────────────────────────────────────────────────────────────────────────

  /** True inside `coordinate` (or a flow-store write wrapped by `exclusive`) for this folder. */
  isCoordinated(): boolean {
    return coordinated.getStore()?.has(this.flowsFolder) ?? false;
  }

  /**
   * True inside a flow write on a folder without hard links. No approval can be made there, but the hooks
   * still invalidate (keyless, fail-safe) in case another process could coordinate on the same folder.
   */
  isUncoordinatedFallback(): boolean {
    return uncoordinated.getStore()?.has(this.flowsFolder) ?? false;
  }

  /**
   * Whether this flows folder supports the cross-process lock. A positive probe is cached per physical
   * folder; a negative one is re-probed on every write, so a transient failure never pins a process into
   * the uncoordinated fallback.
   */
  async coordinationSupported(): Promise<boolean> {
    const directory = (await this.lockOptions()).directory;
    let probe = this.options.probeHardLinks ? this.options.probeHardLinks(directory).catch(() => false) : probeResults.get(directory);
    if (!probe) {
      probe = defaultProbeHardLinks(directory).catch(() => false);
      probeResults.set(directory, probe);
      void probe.then((ok) => {
        if (!ok) probeResults.delete(directory);
      });
    }
    const supported = await probe;
    if (!supported && !warnedFallback.has(directory)) {
      warnedFallback.add(directory);
      console.warn(`[visual-baselines] ${directory} does not support hard links: flow writes there are not coordinated across processes and visual baselines are unavailable`);
    }
    return supported;
  }

  private enter<R>(task: () => Promise<R>): Promise<R> {
    return coordinated.run(new Set(coordinated.getStore() ?? []).add(this.flowsFolder), task);
  }

  /**
   * The cross-process critical section for a FLOW WRITE, inside the in-process lane. On a folder that
   * cannot be locked across processes, the write keeps today's in-process behavior and the N6 hooks do
   * nothing; every N6 operation (`coordinate`) fails closed there instead.
   */
  async exclusive<R>(task: () => Promise<R>): Promise<R> {
    if (!(await this.coordinationSupported())) return uncoordinated.run(new Set(uncoordinated.getStore() ?? []).add(this.flowsFolder), task);
    return withCrossProcessLock(await this.lockOptions(), () => this.enter(task));
  }

  /** A flow-write critical section from outside the lane: the lane, then `exclusive` (lock, or the fallback). */
  write<R>(task: () => Promise<R>): Promise<R> {
    return runExclusive(this.flowsFolder, () => this.exclusive(task));
  }

  /** In-process lane, then the cross-process lock, then `task`. Refused (typed) when re-entered or unsupported. */
  coordinate<R>(task: () => Promise<R>): Promise<R> {
    return runExclusive(this.flowsFolder, async () => {
      if (!(await this.coordinationSupported())) {
        throw new CrossProcessLockError("lock-unsupported", "this flows folder does not support cross-process coordination (no hard links); visual baselines are unavailable here");
      }
      return withCrossProcessLock(await this.lockOptions(), () => this.enter(task));
    });
  }

  /** Fencing: throws `lock-lost` unless this context still owns the cross-process lock (no lock exists in the fallback). */
  async assertHeld(): Promise<void> {
    if (this.isUncoordinatedFallback()) return;
    const lease = currentCrossProcessLease(await this.lockOptions());
    if (!lease) throw new Error("visual baseline write outside the coordinated critical section");
    await lease.assertHeld();
  }

  // ── Epoch tokens (unsigned, shared by both modes) ──────────────────────────────────────────

  /** The flow's current token, or null when missing or unreadable (both mean `no-baseline`). */
  async readToken(flowId: string): Promise<string | null> {
    try {
      const parsed = JSON.parse(await readFile(await this.tokenPath(flowId), "utf8")) as { version?: unknown; flowId?: unknown; token?: unknown };
      return parsed.version === 1 && parsed.flowId === flowId && typeof parsed.token === "string" && TOKEN_PATTERN.test(parsed.token) ? parsed.token : null;
    } catch {
      return null;
    }
  }

  protected async writeToken(flowId: string): Promise<string> {
    await this.assertHeld();
    const path = await this.tokenPath(flowId);
    await mkdir(join(await this.privateFolder(), "epochs"), { recursive: true });
    const token = randomBytes(16).toString("hex");
    const tmp = `${path}.${randomBytes(8).toString("hex")}.tmp`;
    await writeFile(tmp, JSON.stringify({ version: 1, flowId, token }), { flag: "wx" });
    await replaceFileAtomically(tmp, path);
    return token;
  }

  /**
   * The flow's token, created when missing or unreadable. Only inside the critical section, so two
   * processes can never both create one: the second sees the first's token.
   */
  async ensureTokenUnlocked(flowId: string): Promise<string> {
    const existing = await this.readToken(flowId);
    if (existing) return existing;
    await this.deleteSignedFiles(flowId);
    return this.writeToken(flowId);
  }

  // ── Keyless invalidation and purge ─────────────────────────────────────────────────────────

  /**
   * Invalidate every approval of a flow: a new random token when one exists (written first), then
   * delete the flow's signed files in every mode. A flow with no token has nothing a candidate could
   * have bound, so it gets none (it is created on first capture).
   */
  async invalidateFlowUnlocked(flowId: string): Promise<void> {
    await this.assertHeld();
    if (await this.tokenFileExists(flowId)) await this.writeToken(flowId);
    await this.deleteSignedFiles(flowId);
  }

  /** Delete the signed index and records of these steps in every mode. */
  async purgeStepsUnlocked(flowId: string, stepIds: readonly string[]): Promise<void> {
    if (stepIds.length === 0) return;
    await this.assertHeld();
    const stepKeys = new Set(stepIds.map((stepId) => this.stepKey(stepId)));
    for (const mode of VISUAL_BASELINE_APP_MODES) {
      const directory = await this.flowDirectory(mode, flowId);
      for (const entry of await listDirectory(directory)) {
        if (stepKeys.has(entry.slice(0, 64))) await rm(join(directory, entry), { force: true });
      }
    }
  }

  protected async tokenFileExists(flowId: string): Promise<boolean> {
    try {
      await readFile(await this.tokenPath(flowId));
      return true;
    } catch {
      return false;
    }
  }

  /** Delete every mode's signed files of a flow. Protected so verifiers can plant a crash part-way through. */
  protected async deleteSignedFiles(flowId: string): Promise<void> {
    for (const mode of VISUAL_BASELINE_APP_MODES) {
      await rm(await this.flowDirectory(mode, flowId), { recursive: true, force: true });
    }
  }
}

export async function listDirectory(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch {
    return [];
  }
}

/** Write a file only if it does not exist, complete or not at all (temporary file plus hard link). */
export async function createExclusive(path: string, contents: string): Promise<boolean> {
  const tmp = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(tmp, contents, { flag: "wx" });
  try {
    await link(tmp, path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    await rm(tmp, { force: true });
  }
}

/** Replace a file atomically with complete contents. */
export async function writeAtomically(path: string, contents: string): Promise<void> {
  const tmp = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(tmp, contents, { flag: "wx" });
  await replaceFileAtomically(tmp, path);
}
