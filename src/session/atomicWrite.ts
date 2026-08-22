/**
 * Atomic JSON file write with Windows-contention retry.
 *
 * Session metadata (`session-profiles.json`) must never be lost to a torn or partial write when the
 * process crashes mid-write, and must survive transient Windows file contention (antivirus scans,
 * a browser process still releasing the directory) that surfaces as `EPERM`/`EBUSY` on rename.
 */

import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";

/** Transient Windows lock errors that a short retry resolves. */
const RETRYABLE_CODES = new Set(["EPERM", "EBUSY"]);

export interface AtomicWriteOptions {
  /** Total attempts (1 initial + retries). Default 4. */
  attempts?: number;
  /** Base delay between attempts in ms. Default 50. */
  delayMs?: number;
  /** Test seams; production uses the real fs. */
  writeFileImpl?: typeof writeFile;
  renameImpl?: typeof rename;
  delayImpl?: (ms: number) => Promise<void>;
}

const defaultDelay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function removeTemp(tempPath: string): Promise<void> {
  await rm(tempPath, { force: true }).catch(() => undefined);
}

export async function writeJsonFileAtomic(
  filePath: string,
  value: unknown,
  options: AtomicWriteOptions = {}
): Promise<void> {
  const attempts = Math.max(1, options.attempts ?? 4);
  const delayMs = options.delayMs ?? 50;
  const doWrite = options.writeFileImpl ?? writeFile;
  const doRename = options.renameImpl ?? rename;
  const doDelay = options.delayImpl ?? defaultDelay;

  const payload = JSON.stringify(value);
  const tempPath = `${filePath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await doWrite(tempPath, payload, "utf8");
      await doRename(tempPath, filePath);
      return;
    } catch (error) {
      lastError = error;
      await removeTemp(tempPath);
      const code = (error as NodeJS.ErrnoException)?.code;
      if (!RETRYABLE_CODES.has(code ?? "") || attempt === attempts) break;
      await doDelay(delayMs * attempt);
    }
  }
  throw lastError;
}
