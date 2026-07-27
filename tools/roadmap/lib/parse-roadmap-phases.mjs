/**
 * Parse src/roadmap/ImplementationRoadmap.ts — the A-K phase model the app itself renders.
 *
 * The module is TypeScript under src/, so it cannot be imported from a plain-node process without
 * tsx (a devDependency we deliberately do not take a runtime dependency on) and Node 18 has no
 * type-stripping. So the exported array literal is extracted and converted to JSON.
 *
 * The key-quoting regex MUST be line-anchored. The naive /(\w+):/g variant throws, because phase
 * E's implementationNote contains the prose "Remaining: full edge/condition persistence
 * validation" — an unanchored pass quotes "Remaining" mid-string and produces invalid JSON.
 * Verified: the file contains no escaped quotes, so the line-anchored form is safe.
 *
 * This file is also the most stale source in the set. It is read as "what this file says", and
 * its mtime travels with the data so the UI can show how old the claim is.
 */

import { readSource } from "./read-cache.mjs";

export const EXPECTED_PHASE_IDS = "ABCDEFGHIJK";
export const PHASE_STATUSES = new Set([
  "complete",
  "in-progress",
  "partially-completed",
  "pending",
  "blocked"
]);

const ARRAY_LITERAL = /export const implementationRoadmap[^=]*=\s*(\[[\s\S]*?\n\]);/;
/** Line-anchored: only quote a key that begins a line (after indentation). */
const KEY_AT_LINE_START = /^(\s*)([A-Za-z_]\w*):/gm;
const TRAILING_COMMA = /,(\s*[\]}])/g;

/**
 * @typedef {Object} RoadmapPhase
 * @property {string} id
 * @property {string} title
 * @property {string} status
 * @property {string[]} deliverables
 * @property {string} acceptance
 * @property {string} implementationNote
 */

/**
 * @returns {{
 *   ok: boolean,
 *   phases: RoadmapPhase[],
 *   summary: {total: number, complete: number, inProgress: number, partiallyCompleted: number, pending: number, blocked: number, completionPercent: number},
 *   warnings: string[],
 *   stats: Record<string, number>,
 *   mtimeMs: number
 * }}
 */
export function parseRoadmapPhases() {
  const read = readSource("phases");
  return extractPhases(read.ok ? read.text : "", read.ok ? null : read.error, read.mtimeMs);
}

/**
 * Split out from parseRoadmapPhases so the verifier can feed it a deliberately mangled literal
 * and prove the extractor rejects it instead of silently producing a partial phase list.
 *
 * @param {string} text
 * @param {string|null} readError
 * @param {number} mtimeMs
 */
export function extractPhases(text, readError = null, mtimeMs = 0) {
  /** @type {string[]} */
  const warnings = [];
  const empty = {
    ok: false,
    phases: [],
    summary: {
      total: 0,
      complete: 0,
      inProgress: 0,
      partiallyCompleted: 0,
      pending: 0,
      blocked: 0,
      completionPercent: 0
    },
    warnings,
    stats: {},
    mtimeMs
  };

  if (readError) {
    warnings.push(`phases: ${readError}`);
    return empty;
  }

  const m = ARRAY_LITERAL.exec(text);
  if (!m) {
    warnings.push("phases: could not locate the implementationRoadmap array literal");
    return empty;
  }

  const json = m[1].replace(KEY_AT_LINE_START, '$1"$2":').replace(TRAILING_COMMA, "$1");

  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    warnings.push(
      `phases: array literal did not convert to JSON (${err instanceof Error ? err.message : String(err)})`
    );
    return empty;
  }

  if (!Array.isArray(parsed)) {
    warnings.push("phases: implementationRoadmap did not parse to an array");
    return empty;
  }

  /** @type {RoadmapPhase[]} */
  const phases = [];
  for (const p of parsed) {
    if (!p || typeof p !== "object" || typeof p.id !== "string") {
      warnings.push("phases: entry with no id was skipped");
      continue;
    }
    if (!PHASE_STATUSES.has(p.status)) {
      warnings.push(`phases ${p.id}: unrecognised status "${p.status}"`);
    }
    phases.push({
      id: p.id,
      title: typeof p.title === "string" ? p.title : "(untitled)",
      status: typeof p.status === "string" ? p.status : "pending",
      deliverables: Array.isArray(p.deliverables) ? p.deliverables.filter((d) => typeof d === "string") : [],
      acceptance: typeof p.acceptance === "string" ? p.acceptance : "",
      implementationNote: typeof p.implementationNote === "string" ? p.implementationNote : ""
    });
  }

  // Shape guards. The app's own page assumes A-K; a silently truncated list would understate the
  // roadmap without any visible symptom.
  const ids = phases.map((p) => p.id).join("");
  if (ids !== EXPECTED_PHASE_IDS) {
    warnings.push(`phases: expected ids "${EXPECTED_PHASE_IDS}", found "${ids}"`);
  }

  const complete = phases.filter((p) => p.status === "complete").length;
  const summary = {
    total: phases.length,
    complete,
    inProgress: phases.filter((p) => p.status === "in-progress").length,
    // Mirrors getRoadmapSummary in the source module: a partially-completed phase shipped its
    // deliverables but retains a named gap, so it is counted separately and credited no completion.
    partiallyCompleted: phases.filter((p) => p.status === "partially-completed").length,
    pending: phases.filter((p) => p.status === "pending").length,
    blocked: phases.filter((p) => p.status === "blocked").length,
    completionPercent: phases.length === 0 ? 0 : Math.round((complete / phases.length) * 100)
  };

  return {
    ok: phases.length > 0 && ids === EXPECTED_PHASE_IDS,
    phases,
    summary,
    warnings,
    stats: { phases: phases.length, ...summary },
    mtimeMs
  };
}
