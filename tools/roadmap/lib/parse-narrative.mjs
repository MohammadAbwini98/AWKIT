/**
 * Extract the headline and the asserted ledger tally from CURRENT_STATE.md and HANDOFF.md.
 *
 * These files are long-form narrative and the dashboard does not render their prose. They are read
 * for exactly one purpose: the consistency banner. Both quote a ledger tally in their newest
 * section, and so do several bead descriptions. When those copies drift from the ledger's own
 * measured count, that is a real finding — the campaign's own history contains a recorded
 * "Ledger correction", so this has happened before.
 *
 * Two traps:
 *
 *  1. The tally wraps across lines in both files today ("**61 PASS / 4 NOT\nRUN / 1 BLOCKED**"),
 *     so whitespace must be collapsed before matching. A line-based grep finds a HISTORICAL tally
 *     first and reports the wrong numbers.
 *
 *  2. Both files are newest-first and contain the full history of the tally. Only the newest
 *     section may be read, or the banner compares against a number from weeks ago.
 */

import { readSource } from "./read-cache.mjs";

const SECTION = /^##\s+(.+)$/;
const TALLY = /(\d+)\s+PASS\s*\/\s*(\d+)\s+NOT RUN\s*\/\s*(\d+)\s+BLOCKED/i;
/** Trailing "(2026-07-27, current)" or leading "ACTIVE (2026-07-27, latest):" */
const DATE_IN_HEADING = /\((\d{4}-\d{2}-\d{2})[^)]*\)/;

/**
 * @typedef {Object} NarrativeHead
 * @property {string} sourceId
 * @property {string} rel
 * @property {string} heading         newest section heading, verbatim
 * @property {string} date            yyyy-mm-dd parsed out of the heading, or ""
 * @property {string} summary         first paragraph, whitespace-collapsed
 * @property {{pass: number, notRun: number, blocked: number}|null} assertedTally
 * @property {number} sections
 * @property {number} mtimeMs
 * @property {boolean} ok
 */

/**
 * @returns {{ok: boolean, heads: NarrativeHead[], warnings: string[], stats: Record<string, number>}}
 */
export function parseNarrative() {
  /** @type {string[]} */
  const warnings = [];
  /** @type {NarrativeHead[]} */
  const heads = [];

  for (const id of ["currentState", "handoff"]) {
    const read = readSource(id);
    if (!read.ok) {
      warnings.push(`${id}: ${read.error}`);
      heads.push(blank(id, read.rel, read.mtimeMs));
      continue;
    }

    const lines = read.text.split(/\r?\n/);
    /** @type {number[]} */
    const marks = [];
    for (let i = 0; i < lines.length; i += 1) {
      if (SECTION.test(lines[i])) marks.push(i);
    }

    if (marks.length === 0) {
      warnings.push(`${id}: no "##" section headings found`);
      heads.push(blank(id, read.rel, read.mtimeMs));
      continue;
    }

    // Newest section only: from the first "##" to the second.
    const start = marks[0];
    const end = marks.length > 1 ? marks[1] : lines.length;
    const heading = (SECTION.exec(lines[start])?.[1] ?? "").trim();
    const body = lines.slice(start + 1, end).join(" ").replace(/\s+/g, " ").trim();

    const t = TALLY.exec(body);
    const assertedTally = t
      ? { pass: Number(t[1]), notRun: Number(t[2]), blocked: Number(t[3]) }
      : null;

    if (!assertedTally) {
      // Not an error — a section can legitimately not quote the ledger. The banner just has one
      // fewer copy to compare, and says so.
      warnings.push(`${id}: newest section quotes no ledger tally`);
    }

    heads.push({
      sourceId: id,
      rel: read.rel,
      heading,
      date: DATE_IN_HEADING.exec(heading)?.[1] ?? "",
      summary: firstParagraph(lines.slice(start + 1, end)),
      assertedTally,
      sections: marks.length,
      mtimeMs: read.mtimeMs,
      ok: true
    });
  }

  return {
    ok: heads.every((h) => h.ok),
    heads,
    warnings,
    stats: {
      files: heads.length,
      withTally: heads.filter((h) => h.assertedTally !== null).length
    }
  };
}

/**
 * @param {string[]} body
 * @returns {string}
 */
function firstParagraph(body) {
  /** @type {string[]} */
  const out = [];
  for (const line of body) {
    if (/^\s*$/.test(line)) {
      if (out.length > 0) break;
      continue;
    }
    out.push(line.trim());
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

/** @returns {NarrativeHead} */
function blank(sourceId, rel, mtimeMs) {
  return {
    sourceId,
    rel,
    heading: "",
    date: "",
    summary: "",
    assertedTally: null,
    sections: 0,
    mtimeMs,
    ok: false
  };
}
