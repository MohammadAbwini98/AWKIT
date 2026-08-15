/**
 * Bounded retry around the rename half of an atomic file replacement.
 *
 * `writeFile(tmp)` + `rename(tmp, target)` is the standard way to make a settings write
 * crash-safe: libuv's rename replaces the destination atomically on Windows
 * (MOVEFILE_REPLACE_EXISTING), so a crash mid-write can never leave a truncated
 * `ui-settings.json`. What it does NOT survive is another process briefly holding a handle to the
 * target. On Windows that is routine rather than exceptional — antivirus real-time scanning, the
 * search indexer, a backup agent, or a file-explorer preview can each open the file for a few
 * milliseconds, and `rename` then fails with `EPERM` or `EBUSY`.
 *
 * Before this helper, a single such failure discarded the write entirely: the temp file was cleaned
 * up and the error propagated, so a settings change the user had just made was silently lost to a
 * transient condition that would have cleared on its own within a few milliseconds.
 *
 * ── Why the retry set is narrow ───────────────────────────────────────────────────────────────
 *
 * Only `EPERM` and `EBUSY` are retried, because only those are plausibly transient here. Retrying
 * broadly would be worse than not retrying at all: `ENOENT` means the temp file is gone and no
 * amount of waiting will bring it back, `ENOSPC` means the disk is full and retrying just delays
 * the report, and `EACCES` on the target is a genuine permissions problem the user needs told
 * about promptly. A retry loop that swallows those turns a clear, immediate failure into a slow
 * one with the same outcome.
 *
 * ── Why the delay is what it is ───────────────────────────────────────────────────────────────
 *
 * The contention this exists for lasts milliseconds. Attempts are spaced by a short linear backoff
 * (20ms, 40ms, 60ms…) rather than an exponential one, because the goal is to outlast a scanner's
 * handle, not to back off from a loaded remote service. The total worst case is deliberately kept
 * well under a second: settings writes are serialized through a single FIFO queue and Electron's
 * `before-quit` awaits that queue, so an unbounded or slow retry would stall shutdown.
 */

import { rename, rm } from "node:fs/promises";

/** Errors that are worth a second attempt. Everything else fails immediately. */
export const TRANSIENT_REPLACE_CODES = Object.freeze(["EPERM", "EBUSY"]);

/** Attempts in total, including the first. */
export const DEFAULT_REPLACE_ATTEMPTS = 5;

/** Base linear backoff; attempt N waits N * this. */
export const DEFAULT_REPLACE_BACKOFF_MS = 20;

export interface AtomicReplaceOptions {
  /** Total attempts including the first. Values below 1 are treated as 1. */
  attempts?: number;
  /** Base linear backoff in milliseconds. */
  backoffMs?: number;
  /** Injectable sleep, so tests do not pay real wall-clock time. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable rename, so tests can force transient and permanent failures. */
  renameImpl?: (from: string, to: string) => Promise<void>;
  /** Called after each failed attempt. Diagnostics only. */
  onRetry?: (attempt: number, code: string) => void;
}

/** Is this the kind of failure that might clear on its own? */
export function isTransientReplaceError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" && TRANSIENT_REPLACE_CODES.includes(code);
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Rename `tmp` over `target`, retrying only bounded transient failures.
 *
 * On success the temp file is gone (rename consumed it). On any terminal failure the temp file is
 * removed and the ORIGINAL error is rethrown — not a wrapper — so callers and logs keep the real
 * errno. The target is never touched on a failing path, so a persistent failure leaves the previous
 * settings file exactly as it was.
 *
 * @param tmp    path to the fully-written temporary file
 * @param target path to replace
 */
export async function replaceFileAtomically(
  tmp: string,
  target: string,
  options: AtomicReplaceOptions = {}
): Promise<void> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_REPLACE_ATTEMPTS);
  const backoffMs = options.backoffMs ?? DEFAULT_REPLACE_BACKOFF_MS;
  const sleep = options.sleep ?? wait;
  const doRename = options.renameImpl ?? rename;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await doRename(tmp, target);
      return;
    } catch (error) {
      const transient = isTransientReplaceError(error);
      const exhausted = attempt >= attempts;

      if (!transient || exhausted) {
        // Terminal. Clean up so temp files cannot accumulate in the storage folder, then rethrow
        // the original error. The cleanup itself must never mask the real failure.
        await rm(tmp, { force: true }).catch(() => undefined);
        throw error;
      }

      options.onRetry?.(attempt, (error as NodeJS.ErrnoException).code ?? "");
      await sleep(backoffMs * attempt);
    }
  }

  // Unreachable: the loop either returns or throws. Present so the function is total.
  throw new Error(`replaceFileAtomically exhausted ${attempts} attempts without a terminal outcome`);
}
