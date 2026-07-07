/**
 * Packaged-app process-tree ownership helpers (Phase 5.1D).
 *
 * LAUNCHER-STUB WARNING (verified empirically in Phase 5): the packaged
 * "WebFlow Studio.exe" that Playwright/`spawn` starts is a LAUNCHER STUB — the real Electron
 * main process is its CHILD. `app.process().pid` is the stub; killing only the stub can leave
 * a live zombie app (and Node's `process.kill()` does not reliably terminate the packaged
 * Electron root on Windows). Every packaged verifier MUST:
 *
 *  1. capture the stub pid (`app.process().pid`) AND the real main pid
 *     (`app.evaluate(() => process.pid)`),
 *  2. on cleanup — including FAILURE paths — `taskkill /T /F` the REAL main pid (tree kill),
 *  3. verify afterwards that no app/bundled-Chromium processes remain.
 */
import { execFile } from "node:child_process";
import type { ElectronApplication } from "playwright";

export interface PackagedAppPids {
  /** Pid of the spawned launcher stub (NOT the real app). */
  stubPid: number;
  /** Pid of the real Electron main process (kill target). 0 if evaluation failed. */
  mainPid: number;
}

/** Capture launcher-stub + real-main pids for a packaged Electron session. */
export async function capturePackagedAppPids(app: ElectronApplication): Promise<PackagedAppPids> {
  const stubPid = app.process().pid ?? 0;
  const mainPid = await app.evaluate(() => process.pid).catch(() => 0);
  return { stubPid, mainPid };
}

/** `taskkill /PID <pid> [/T] /F` — resolves regardless of outcome (pid may already be gone). */
export function taskkillTree(pid: number, tree = true): Promise<void> {
  return new Promise((resolveKill) => {
    if (!pid) return resolveKill();
    const args = ["/PID", String(pid), ...(tree ? ["/T"] : []), "/F"];
    execFile("taskkill", args, () => resolveKill());
  });
}

export function pidAlive(pid: number): Promise<boolean> {
  return new Promise((resolveAlive) => {
    if (!pid) return resolveAlive(false);
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object -ExpandProperty ProcessId`],
      { windowsHide: true },
      (error, stdout) => resolveAlive(!error && stdout.trim().length > 0)
    );
  });
}

function pidExecutablePath(pid: number): Promise<string> {
  return new Promise((resolvePath) => {
    if (!pid) return resolvePath("");
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object -ExpandProperty ExecutablePath`],
      { windowsHide: true },
      (error, stdout) => resolvePath(error ? "" : stdout.trim())
    );
  });
}

/** Matches AWKIT-owned packaged processes (app, portable extraction, bundled Chromium). */
export const APP_PATH_PATTERN = /win-unpacked|webflow studio|browsers[\\/]chromium/i;

/**
 * A pid is only a valid kill target if it is alive AND its executable is still ours —
 * Windows reuses pids aggressively (Phase 5 finding), so a stale pid could belong to an
 * innocent process by the time cleanup runs.
 */
async function pidIsOurs(pid: number): Promise<boolean> {
  if (!pid || !(await pidAlive(pid))) return false;
  const path = await pidExecutablePath(pid);
  return APP_PATH_PATTERN.test(path);
}

/**
 * Guaranteed teardown for a packaged session: graceful `app.close()`, then tree-kill BOTH the
 * real main and the launcher stub (path-verified to still be ours), then verify both are dead.
 * Returns pids still alive (empty array = clean). Safe to call multiple times and on failure paths.
 */
export async function ensurePackagedAppDead(app: ElectronApplication | null, pids: PackagedAppPids): Promise<number[]> {
  if (app) await app.close().catch(() => undefined);
  // Real main first (owns the Chromium children), stub second.
  for (const pid of [pids.mainPid, pids.stubPid]) {
    if (await pidIsOurs(pid)) await taskkillTree(pid);
  }
  const leftovers: number[] = [];
  const deadline = Date.now() + 10_000;
  for (const pid of [pids.mainPid, pids.stubPid]) {
    if (!pid) continue;
    let ours = await pidIsOurs(pid);
    while (ours && Date.now() < deadline) {
      await new Promise((resolveSleep) => setTimeout(resolveSleep, 500));
      ours = await pidIsOurs(pid);
    }
    if (ours) leftovers.push(pid);
  }
  return leftovers;
}
