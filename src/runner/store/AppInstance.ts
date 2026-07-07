import { randomUUID } from "node:crypto";

/**
 * Identity of this running AWKIT process. Recorded on durable runs/locks so a later process
 * (or a second concurrent app instance) can tell "mine, still alive" from "prior crash".
 */
export const APP_INSTANCE_ID = randomUUID();
export const APP_PID = process.pid;

/** True when a pid appears to be a live process on this machine (best-effort). */
export function isPidAlive(pid: number | undefined): boolean {
  if (!pid || !Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM = alive but not ours; ESRCH = gone.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
