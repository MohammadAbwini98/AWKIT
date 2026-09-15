#!/usr/bin/env node
/**
 * Bounded per-session denial ledger for the write-lease guard.
 *
 * The diagnostic that motivated this (2026-09) measured one Claude Code session at 158
 * `[write-lease] BLOCKED` denials for the same handful of operations: every denial returned an
 * open-ended remediation instruction, so the agent kept producing variants until the session
 * died. This module counts identical denials per Claude session so `lease-guard.mjs` can mark
 * the third one TERMINAL — "report BLOCKED and continue independent work" — instead of another
 * suggestion.
 *
 * State is a single JSON file per session beneath `%LOCALAPPDATA%/AWKIT/claude-context/`,
 * outside the repository. Counting must never change the guard decision: any persistence
 * failure fails open to the uncounted behavior of the previous guard.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** At this identical-denial count the guard labels the denial TERMINAL for that gate. */
export const DENIAL_TERMINAL_THRESHOLD = 3;

/** The ledger tracks intents, not history: keep it bounded to the newest MAX_TRACKED_INTENTS. */
const MAX_TRACKED_INTENTS = 50;

/**
 * @param {{sessionId?:string, localAppData?:string}} [input]
 * @returns {string}
 */
export function denialLedgerPath({ sessionId, localAppData } = {}) {
  const base = resolve(localAppData || process.env.LOCALAPPDATA || join(tmpdir(), "AWKIT-local"));
  const key = createHash("sha256").update(String(sessionId || "no-session")).digest("hex").slice(0, 24);
  return join(base, "AWKIT", "claude-context", `guard-denials-${key}.json`);
}

/**
 * Record one denial of the same normalized intent and return its session count.
 *
 * @param {{intent?:string, sessionId?:string, localAppData?:string}} [input]
 * @returns {{count:number, terminal:boolean, persisted:boolean}}
 */
export function recordDenial({ intent, sessionId, localAppData } = {}) {
  const normalized = typeof intent === "string" && intent.trim() ? intent.trim().slice(0, 200) : "unknown";
  const path = denialLedgerPath({ sessionId, localAppData });

  let counts = {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) counts = parsed;
  } catch {
    counts = {};
  }

  const previous = Number(counts[normalized]);
  const count = Number.isFinite(previous) ? previous + 1 : 1;
  counts[normalized] = count;

  const keys = Object.keys(counts);
  if (keys.length > MAX_TRACKED_INTENTS) {
    for (const stale of keys.slice(0, keys.length - MAX_TRACKED_INTENTS)) delete counts[stale];
  }

  try {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(counts)}\n`, "utf8");
    renameSync(temporary, path);
  } catch {
    // Unwritable ledger: report the count but persisted=false, so callers know it will not
    // accumulate across hook invocations. The guard decision itself never depends on this.
    return { count, terminal: false, persisted: false };
  }
  return { count, terminal: count >= DENIAL_TERMINAL_THRESHOLD, persisted: true };
}
