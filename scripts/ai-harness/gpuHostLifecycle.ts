/**
 * Host lifecycle for the GPU harness modes (gpu, gpuLifecycle, gpuProgress) and their launcher,
 * scripts/verify-ai-gpu-host.mts. Free of Electron and of product imports, so
 * scripts/verify-ai-gpu-harness.mts drives every branch with fake hosts.
 *
 *  - MECHANICS observes the L8a.2 pack guard on a fork. On an eligible machine the PRODUCT steps have
 *    already started the GPU host, so a hello would reuse it: no fork, no guard run, and a failed
 *    assertion about correct product behaviour (the GTX 980M run, 2026-10-02). `establishFreshHost` makes
 *    "no host is running" an explicit precondition through the manager's own `release()`, and
 *    `expectOneGuardedFork` keeps the assertion: exactly one guard run for the one fork the call caused.
 *  - Teardown: a manager hears of an exit when the host's channel closes, and `dispose()` returns after a
 *    bounded grace (2 s, then a kill and 250 ms) whether or not Windows has finished the process. The
 *    harness then exited with Vulkan hosts still mapping the pack's DLLs, and the launcher's delete hit
 *    EPERM. `HostTeardown` records every host pid a run started and, before the harness exits, disposes
 *    every manager and waits until each pid is gone. A host still running at the ceiling is a failed step
 *    that names it, never a pass.
 *  - Launcher cleanup: `removeWhenReleased` waits until no process maps a module from the scratch folders
 *    (Windows' own module list, the L8a.0 loader-proof method), names any that still do, then removes the
 *    folders with the repository's rmSync retry convention and reports what it could not remove.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";

type Step = <T>(label: string, fn: () => Promise<T> | T) => Promise<T | undefined>;

/** What these helpers use of `AiUtilityHostManager`. */
export interface HarnessHost {
  status(): { pid: number | null };
  release(): Promise<void>;
  dispose(): Promise<void>;
}

/** A host whose calls can be observed: any call may fork one. */
export interface TrackableHost extends HarnessHost {
  call: (...args: never[]) => Promise<unknown>;
}

/** How long a disposed host's process may take to leave Windows before teardown fails. A ceiling, not a sleep. */
export const HOST_EXIT_CEILING_MS = 60_000;
/** How long the scratch folders may stay mapped by a process before the launcher stops waiting. */
export const SCRATCH_RELEASE_CEILING_MS = 60_000;
export const TEARDOWN_LABEL = "TEARDOWN every AI host this run started has exited (the OS process, not only its channel)";

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** True while Windows still has the process. EPERM means it exists but is not ours to signal. */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

// ── MECHANICS: a fork that can be observed ─────────────────────────────────────────────────────────

/**
 * The precondition for observing a fork: no host is running. `release()` is the manager's intentional
 * stop (no restart strike; the next call forks a fresh, re-verified host). A host that survives it fails
 * here: MECHANICS is never skipped because a host already exists.
 */
export async function establishFreshHost(host: HarnessHost): Promise<{ releasedPid: number | null }> {
  const releasedPid = host.status().pid;
  if (releasedPid !== null) await host.release();
  const still = host.status().pid;
  if (still !== null) throw new Error(`a host (pid ${still}) is still running after release, so no fork can be observed`);
  return { releasedPid };
}

/** The pack guard ran exactly once for the one fork `start` caused. */
export async function expectOneGuardedFork<T>(host: HarnessHost, guardRuns: () => number, start: () => Promise<T>): Promise<T> {
  if (host.status().pid !== null) throw new Error("a host is already running, so this call cannot fork: establish the fresh-host precondition first");
  const before = guardRuns();
  const value = await start();
  if (host.status().pid === null) throw new Error("the call started no host");
  const runs = guardRuns() - before;
  if (runs !== 1) throw new Error(`guard ran ${runs} times for one fork`);
  return value;
}

// ── Teardown inside the harness ────────────────────────────────────────────────────────────────────

export interface HostTeardownOptions {
  isAlive?: (pid: number) => boolean;
  ceilingMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface HostTeardownResult {
  hosts: number;
  pids: number[];
  /** Still in Windows when every dispose() had returned: the gap the launcher's delete used to hit. */
  aliveAfterDispose: number[];
  exitedWithinMs: number;
}

export class HostTeardown {
  private readonly hosts = new Set<TrackableHost>();
  private readonly pids = new Set<number>();

  /** Records the host's pid after every call, so a host replaced later (killed, restarted) is still counted. */
  track<T extends TrackableHost>(host: T): T {
    this.hosts.add(host);
    const call = (host.call as (...args: unknown[]) => Promise<unknown>).bind(host);
    (host as unknown as { call: (...args: unknown[]) => Promise<unknown> }).call = async (...args: unknown[]) => {
      try {
        return await call(...args);
      } finally {
        this.note(host);
      }
    };
    return host;
  }

  started(): number[] {
    return [...this.pids];
  }

  private note(host: HarnessHost): void {
    const pid = host.status().pid;
    if (pid !== null) this.pids.add(pid);
  }

  /** Dispose every manager, then wait until Windows no longer has any host this run started. */
  async teardown({ isAlive = processAlive, ceilingMs = HOST_EXIT_CEILING_MS, pollMs = 100, now = Date.now, sleep = defaultSleep }: HostTeardownOptions = {}): Promise<HostTeardownResult> {
    for (const host of this.hosts) this.note(host);
    await Promise.all([...this.hosts].map((host) => host.dispose().catch(() => undefined)));
    const started = now();
    let running = [...this.pids].filter((pid) => isAlive(pid));
    const aliveAfterDispose = [...running];
    while (running.length > 0 && now() - started < ceilingMs) {
      await sleep(pollMs);
      running = running.filter((pid) => isAlive(pid));
    }
    if (running.length > 0) throw new Error(`host process(es) ${running.join(", ")} still running ${ceilingMs} ms after dispose`);
    return { hosts: this.hosts.size, pids: [...this.pids], aliveAfterDispose, exitedWithinMs: now() - started };
  }
}

/** Runs `body`, then always the teardown step, including after an early return or a throw. */
export async function withHostTeardown(step: Step, hosts: HostTeardown, body: () => Promise<void>, options?: HostTeardownOptions): Promise<void> {
  try {
    await body();
  } finally {
    await step(TEARDOWN_LABEL, () => hosts.teardown(options));
  }
}

// ── Cleanup in the launcher ────────────────────────────────────────────────────────────────────────

export interface ModuleOwner {
  pid: number;
  name: string;
  file: string;
}

/** Long, final form of a path. os.tmpdir() can be an 8.3 short path; Windows reports modules by long path. */
function finalPath(dir: string): string {
  try {
    return fs.realpathSync.native(dir);
  } catch {
    return dir;
  }
}

/** Every process with a module (an EXE, DLL or .node image) mapped from beneath any of `roots`. */
export function moduleOwners(roots: readonly string[]): ModuleOwner[] {
  if (process.platform !== "win32" || roots.length === 0) return [];
  const script = [
    "$roots = $env:AWKIT_MAPPED_ROOTS -split '\\|' | Where-Object { $_ } | ForEach-Object { $_.TrimEnd('\\') + '\\' }",
    "Get-Process | ForEach-Object { $p = $_; try { foreach ($m in $p.Modules) { $f = $m.FileName; foreach ($r in $roots) { if ($f -and $f.StartsWith($r, [StringComparison]::OrdinalIgnoreCase)) { '{0}|{1}|{2}' -f $p.Id, $p.ProcessName, $f } } } } catch {} }"
  ].join("; ");
  const out = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 120_000,
    env: { ...process.env, AWKIT_MAPPED_ROOTS: roots.join("|") }
  });
  return String(out.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [pid = "", name = "", ...file] = line.split("|");
      return { pid: Number(pid), name, file: file.join("|") };
    })
    .filter((owner) => Number.isInteger(owner.pid) && owner.pid > 0);
}

export interface ScratchRemovalOptions {
  owners?: (roots: string[]) => ModuleOwner[] | Promise<ModuleOwner[]>;
  remove?: (dir: string) => void;
  ceilingMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface ScratchRemoval {
  ok: boolean;
  /** From the first scan to the last, scans included (one module scan takes seconds). */
  waitedMs: number;
  /** Processes mapping a module from the folders at the first scan: who still held them when the harness had exited. */
  heldAtStart: ModuleOwner[];
  /** Processes still mapping a module from the folders when the wait ended (empty when released). */
  owners: ModuleOwner[];
  /** Folders that could not be removed, with the error code. */
  failures: Array<{ dir: string; code: string }>;
}

/** The repository's cleanup convention: Node's bounded rmSync retry on the transient Windows codes. */
function removeTree(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

/** Wait until no process maps a module from `dirs`, then remove them; report owners and failures, never throw. */
export async function removeWhenReleased(dirs: readonly string[], options: ScratchRemovalOptions = {}): Promise<ScratchRemoval> {
  const { owners = moduleOwners, remove = removeTree, ceilingMs = SCRATCH_RELEASE_CEILING_MS, pollMs = 500, now = Date.now, sleep = defaultSleep } = options;
  const roots = dirs.map(finalPath);
  const started = now();
  let held = await owners(roots);
  const heldAtStart = held;
  while (held.length > 0 && now() - started < ceilingMs) {
    await sleep(pollMs);
    held = await owners(roots);
  }
  const waitedMs = now() - started;
  const failures: ScratchRemoval["failures"] = [];
  for (const dir of dirs) {
    try {
      remove(dir);
    } catch (error) {
      failures.push({ dir, code: String((error as NodeJS.ErrnoException)?.code ?? (error as Error)?.message ?? error) });
    }
  }
  return { ok: held.length === 0 && failures.length === 0, waitedMs, heldAtStart, owners: held, failures };
}

/** One line for the launcher: who held the folders when it started looking, and for how long. */
export function describeRelease(removal: ScratchRemoval): string {
  if (removal.heldAtStart.length === 0) return "nothing mapped a module from them when the harness had exited";
  const names = [...new Set(removal.heldAtStart.map((o) => `${o.name} pid ${o.pid}`))].join(", ");
  return `still mapped by ${names} when the harness had exited; ${removal.owners.length === 0 ? `released within ${removal.waitedMs} ms` : `not released within ${removal.waitedMs} ms`}`;
}

export function describeRemoval(removal: ScratchRemoval): string {
  const parts: string[] = [];
  if (removal.owners.length > 0) parts.push(`still mapped after ${removal.waitedMs} ms by ${removal.owners.map((o) => `${o.name} pid ${o.pid} (${o.file})`).join("; ")}`);
  if (removal.failures.length > 0) parts.push(`not removed: ${removal.failures.map((f) => `${f.dir} ${f.code}`).join("; ")}`);
  return parts.join(" — ");
}
