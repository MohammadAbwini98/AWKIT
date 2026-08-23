/**
 * Atomic JSON file write for session metadata, built on the ONE canonical
 * temp+rename+EPERM/EBUSY-retry helper (`src/storage/atomicReplace.ts`).
 *
 * AWKIT-SES-001: this module used to reimplement the retry loop with drifted defaults
 * (4 attempts / 50ms linear vs the canonical 5 / 20) — exactly the duplication
 * `docs/ai/RULES.md` forbids. The rename half is now delegated to the canonical helper; if the
 * session store ever needs different retry values they are PARAMETERS of this call, not a fork.
 *
 * Session metadata (`session-profiles.json`) must never be lost to a torn or partial write when
 * the process crashes mid-write, and must survive transient Windows file contention (antivirus
 * scans, a browser process still releasing the directory) that surfaces as `EPERM`/`EBUSY` on
 * rename.
 */

import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { replaceFileAtomically, type AtomicReplaceOptions } from "../storage/atomicReplace";

/** Injectable rename seam, identical to the canonical helper's. */
type RenameImpl = NonNullable<AtomicReplaceOptions["renameImpl"]>;

export interface AtomicWriteOptions {
  /** Total attempts (1 initial + retries). Default: the canonical {@link DEFAULT_REPLACE_ATTEMPTS}. */
  attempts?: number;
  /** Base linear backoff between attempts in ms. Default: the canonical {@link DEFAULT_REPLACE_BACKOFF_MS}. */
  delayMs?: number;
  /** Test seams; production uses the real fs. */
  writeFileImpl?: typeof writeFile;
  renameImpl?: RenameImpl;
  delayImpl?: (ms: number) => Promise<void>;
}

export async function writeJsonFileAtomic(
  filePath: string,
  value: unknown,
  options: AtomicWriteOptions = {}
): Promise<void> {
  const doWrite = options.writeFileImpl ?? writeFile;
  // AWKIT-SES-002: two-space pretty-printing — the format session-profiles.json had before the
  // original atomicity fix silently switched it to single-line. Deliberate, not accidental.
  const payload = JSON.stringify(value, null, 2);
  const tempPath = `${filePath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;

  await doWrite(tempPath, payload, "utf8");
  await replaceFileAtomically(tempPath, filePath, {
    attempts: options.attempts,
    backoffMs: options.delayMs,
    renameImpl: options.renameImpl
  });
}
