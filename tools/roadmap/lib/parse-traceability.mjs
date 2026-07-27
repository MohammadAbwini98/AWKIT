/**
 * Parse TRACEABILITY_MATRIX.csv.
 *
 * The file is NOT cleanly comma-splittable. Measured field counts across its 101 data rows:
 * {6: 98, 7: 2, 8: 1} — the trailing `Notes` column contains unescaped commas and no quoting.
 *
 * A plain 6-way split misaligns three rows silently, moving prose into the Status column. The
 * fix is positional: the first five fields are fixed, and everything from index 5 onward is
 * rejoined into Notes. That reproduces the documented 84 PASS / 14 NOT RUN / 3 BLOCKED exactly.
 */

import { readSource } from "./read-cache.mjs";

export const TRACE_STATUSES = new Set(["PASS", "FAIL", "BLOCKED", "NOT RUN", "NOT APPLICABLE"]);

const EXPECTED_HEADER = "Requirement,Model item,Primary evidence,Execution level,Status,Notes";

/**
 * @typedef {Object} TraceRow
 * @property {number} index
 * @property {string} requirement
 * @property {string} modelItem
 * @property {string} evidence
 * @property {string} level
 * @property {string} status
 * @property {string} notes
 */

/**
 * @returns {{
 *   ok: boolean,
 *   rows: TraceRow[],
 *   byStatus: Record<string, number>,
 *   byRequirement: {name: string, total: number, pass: number}[],
 *   warnings: string[],
 *   stats: Record<string, number>,
 *   mtimeMs: number
 * }}
 */
export function parseTraceability() {
  const read = readSource("traceability");
  /** @type {string[]} */
  const warnings = [];

  if (!read.ok) {
    return {
      ok: false,
      rows: [],
      byStatus: {},
      byRequirement: [],
      warnings: [`traceability: ${read.error}`],
      stats: {},
      mtimeMs: read.mtimeMs
    };
  }

  const lines = read.text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return {
      ok: false,
      rows: [],
      byStatus: {},
      byRequirement: [],
      warnings: ["traceability: file is empty"],
      stats: {},
      mtimeMs: read.mtimeMs
    };
  }

  // The header is the contract. If a column is inserted, the positional slice below is wrong,
  // and it is better to say so than to render shifted data.
  if (lines[0].trim() !== EXPECTED_HEADER) {
    warnings.push(
      `traceability: unexpected header "${lines[0].trim()}" — expected "${EXPECTED_HEADER}". ` +
        "Column positions may have shifted."
    );
  }

  /** @type {TraceRow[]} */
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const f = lines[i].split(",");
    if (f.length < 6) {
      warnings.push(`traceability row ${i}: only ${f.length} fields, expected at least 6`);
      continue;
    }

    const status = f[4].trim().toUpperCase();
    if (!TRACE_STATUSES.has(status)) {
      warnings.push(`traceability row ${i}: unrecognised status "${status}"`);
    }

    rows.push({
      index: i,
      requirement: f[0].trim(),
      modelItem: f[1].trim(),
      evidence: f[2].trim(),
      level: f[3].trim(),
      status,
      // Everything past the fixed five belongs to Notes — this is the unescaped-comma fix.
      notes: f.slice(5).join(",").trim()
    });
  }

  /** @type {Record<string, number>} */
  const byStatus = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

  /** @type {Map<string, {name: string, total: number, pass: number}>} */
  const groups = new Map();
  for (const r of rows) {
    const g = groups.get(r.requirement) ?? { name: r.requirement, total: 0, pass: 0 };
    g.total += 1;
    if (r.status === "PASS") g.pass += 1;
    groups.set(r.requirement, g);
  }
  const byRequirement = [...groups.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  const stats = {
    rows: rows.length,
    pass: byStatus.PASS ?? 0,
    notRun: byStatus["NOT RUN"] ?? 0,
    blocked: byStatus.BLOCKED ?? 0,
    fail: byStatus.FAIL ?? 0,
    requirementGroups: byRequirement.length
  };

  return { ok: true, rows, byStatus, byRequirement, warnings, stats, mtimeMs: read.mtimeMs };
}
