/**
 * Parse docs/ai/KNOWN_ISSUES.md — fragile areas, risky assumptions, and repeated-problem patterns.
 *
 * This file is prose, not a register: entries are bullets with bold lead-ins under topic sections,
 * and resolution is recorded by editing the heading ("RESOLVED 2026-07-25: ...") rather than by a
 * status field. So the parser extracts sections and bullet lead-ins, and classifies by heading
 * prefix — it does not pretend to produce structured issue records.
 *
 * The one genuine cross-namespace join here is `bd \`awkit-xxx\`` inside the prose, which links a
 * known issue to a real tracked bead.
 */

import { readSource } from "./read-cache.mjs";

const SECTION = /^##\s+(.+)$/;
/** `- **Bold lead-in** — the rest of the bullet` */
const BULLET_LEAD = /^[-*]\s+\*\*(.+?)\*\*\s*(?:[—–-]\s*)?([\s\S]*)$/;
/** A bead id as written in this file: bd `awkit-64x` */
const BEAD_REF = /\bbd\s+`([a-z][a-z0-9]*-[a-z0-9.]+)`/g;

const RESOLVED_PREFIX = /^(RESOLVED|FIXED)\b/i;
const FRAGILE_PREFIX = /^Fragile area\b/i;

/**
 * @typedef {Object} KnownIssueEntry
 * @property {string} section
 * @property {"resolved"|"fragile"|"note"} kind
 * @property {string} lead        the bold lead-in
 * @property {string} detail
 * @property {string[]} beadRefs
 * @property {number} line
 */

/**
 * @returns {{
 *   ok: boolean,
 *   sections: {name: string, kind: string, entries: number, line: number}[],
 *   entries: KnownIssueEntry[],
 *   beadRefs: string[],
 *   warnings: string[],
 *   stats: Record<string, number>,
 *   mtimeMs: number
 * }}
 */
export function parseKnownIssues() {
  const read = readSource("knownIssues");
  /** @type {string[]} */
  const warnings = [];

  if (!read.ok) {
    return {
      ok: false,
      sections: [],
      entries: [],
      beadRefs: [],
      warnings: [`knownIssues: ${read.error}`],
      stats: {},
      mtimeMs: read.mtimeMs
    };
  }

  const lines = read.text.split(/\r?\n/);

  /** @type {{name: string, kind: string, line: number}[]} */
  const sectionMarks = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = SECTION.exec(lines[i]);
    if (m) sectionMarks.push({ name: m[1].trim(), kind: classify(m[1].trim()), line: i + 1 });
  }

  /** @type {KnownIssueEntry[]} */
  const entries = [];
  /** @type {Set<string>} */
  const allBeadRefs = new Set();

  for (let s = 0; s < sectionMarks.length; s += 1) {
    const start = sectionMarks[s].line;
    const end = s + 1 < sectionMarks.length ? sectionMarks[s + 1].line - 1 : lines.length;

    for (let i = start; i < end; i += 1) {
      const m = BULLET_LEAD.exec(lines[i]);
      if (!m) continue;

      // Gather indented continuation lines so a bullet wrapped across three lines keeps its detail.
      const parts = [m[2]];
      for (let j = i + 1; j < end; j += 1) {
        if (/^\s*$/.test(lines[j])) break;
        if (/^[-*]\s/.test(lines[j])) break;
        if (/^#{1,6}\s/.test(lines[j])) break;
        if (!/^\s+/.test(lines[j])) break;
        parts.push(lines[j].trim());
      }

      const detail = parts.join(" ").replace(/\s+/g, " ").trim();
      const lead = m[1].replace(/\s+/g, " ").trim();

      /** @type {string[]} */
      const beadRefs = [];
      for (const b of `${lead} ${detail}`.matchAll(BEAD_REF)) {
        if (!beadRefs.includes(b[1])) beadRefs.push(b[1]);
        allBeadRefs.add(b[1]);
      }

      entries.push({
        section: sectionMarks[s].name,
        kind: entryKind(sectionMarks[s].kind, lead),
        lead,
        detail,
        beadRefs,
        line: i + 1
      });
    }
  }

  const sections = sectionMarks.map((s, idx) => {
    const end = idx + 1 < sectionMarks.length ? sectionMarks[idx + 1].line : lines.length;
    return {
      name: s.name,
      kind: s.kind,
      entries: entries.filter((e) => e.line > s.line && e.line < end).length,
      line: s.line
    };
  });

  const stats = {
    sections: sections.length,
    entries: entries.length,
    resolved: entries.filter((e) => e.kind === "resolved").length,
    fragile: entries.filter((e) => e.kind === "fragile").length,
    beadRefs: allBeadRefs.size
  };

  return {
    ok: true,
    sections,
    entries,
    beadRefs: [...allBeadRefs],
    warnings,
    stats,
    mtimeMs: read.mtimeMs
  };
}

/**
 * @param {string} name
 * @returns {"resolved"|"fragile"|"note"}
 */
function classify(name) {
  if (RESOLVED_PREFIX.test(name)) return "resolved";
  if (FRAGILE_PREFIX.test(name) || /fragile/i.test(name)) return "fragile";
  return "note";
}

/**
 * A bullet inside a general section can still announce its own resolution inline
 * ("... — FIXED (bd `awkit-64x`)").
 *
 * @param {string} sectionKind
 * @param {string} lead
 * @returns {"resolved"|"fragile"|"note"}
 */
function entryKind(sectionKind, lead) {
  if (sectionKind === "resolved") return "resolved";
  if (RESOLVED_PREFIX.test(lead)) return "resolved";
  return sectionKind === "fragile" ? "fragile" : "note";
}
