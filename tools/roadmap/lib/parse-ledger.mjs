/**
 * Parse the validation case ledger — RECORDER_REPORTS_SETTINGS_TEST_CASES.md.
 *
 * This is the authoritative source for the PASS / NOT RUN / BLOCKED tally that CURRENT_STATE.md,
 * HANDOFF.md and the bead descriptions all quote. Everything else that states a number is a copy.
 *
 * The file is rigidly templated: every case is `### <ID> - <title>` followed by exactly five
 * bold keys in a fixed order. Measured today: 66 headings, 66 Status lines, 66 Priority lines.
 *
 * The counts are asserted rather than assumed. If they ever disagree, this parser reports
 * `degraded` and the UI shows a banner instead of a tally, because a ledger that silently
 * under-counts is worse than one that admits it could not be read.
 */

import { readSource } from "./read-cache.mjs";

/** The status vocabulary the ledger declares for itself at the top of the file. */
export const LEDGER_STATUSES = new Set(["PASS", "FAIL", "BLOCKED", "NOT RUN", "NOT APPLICABLE"]);

const CASE_HEADING = /^### ((?:REC|SYS-REP|SET)-\d+)\s+[—–-]\s+(.+)$/;

/**
 * @typedef {Object} LedgerCase
 * @property {string} id             e.g. "SET-013"
 * @property {string} family         "REC" | "SYS-REP" | "SET"
 * @property {string} title
 * @property {string} status         normalised upper-case verbatim value
 * @property {string} statusNote     the prose that follows the status token
 * @property {string|null} priority  "P0" | "P1"
 * @property {string|null} layer     the half after "P0 / "
 * @property {string} preconditions
 * @property {string} steps
 * @property {string} expected
 * @property {number} line
 */

/**
 * @returns {{
 *   ok: boolean,
 *   degraded: boolean,
 *   cases: LedgerCase[],
 *   tally: {pass: number, fail: number, blocked: number, notRun: number, notApplicable: number, total: number},
 *   warnings: string[],
 *   stats: Record<string, number>,
 *   mtimeMs: number
 * }}
 */
export function parseLedger() {
  const read = readSource("ledger");
  /** @type {string[]} */
  const warnings = [];

  if (!read.ok) {
    return {
      ok: false,
      degraded: true,
      cases: [],
      tally: emptyTally(),
      warnings: [`ledger: ${read.error}`],
      stats: {},
      mtimeMs: read.mtimeMs
    };
  }

  const lines = read.text.split(/\r?\n/);

  // Locate every case heading first, then slice each block to the next heading. Slicing by
  // heading index rather than by a greedy regex keeps a case whose body contains "###" intact.
  /** @type {{id: string, title: string, line: number}[]} */
  const headings = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = CASE_HEADING.exec(lines[i]);
    if (m) headings.push({ id: m[1], title: m[2].trim(), line: i + 1 });
  }

  /** @type {LedgerCase[]} */
  const cases = [];
  for (let h = 0; h < headings.length; h += 1) {
    const start = headings[h].line; // first body line is start (0-indexed heading is line-1)
    const end = h + 1 < headings.length ? headings[h + 1].line - 1 : lines.length;
    const body = lines.slice(start, end);

    const statusRaw = bodyValue(body, "Status");
    const priorityRaw = bodyValue(body, "Priority / layer");

    let status = "";
    let statusNote = "";
    if (statusRaw !== null) {
      // `- **Status:** \`PASS\` - trailing prose about the evidence`
      const m = /^`([^`]+)`\s*(?:[—–-]\s*)?([\s\S]*)$/.exec(statusRaw.trim());
      if (m) {
        status = m[1].trim().toUpperCase();
        statusNote = m[2].trim();
      } else {
        status = statusRaw.trim().toUpperCase();
      }
    }

    if (!status) {
      warnings.push(`ledger ${headings[h].id}: no Status line`);
    } else if (!LEDGER_STATUSES.has(status)) {
      warnings.push(`ledger ${headings[h].id}: unrecognised status "${status}"`);
    }

    let priority = null;
    let layer = null;
    if (priorityRaw !== null) {
      const m = /^(P\d)\s*\/\s*(.+)$/s.exec(priorityRaw.trim());
      if (m) {
        priority = m[1];
        layer = collapse(m[2]);
      } else {
        priority = collapse(priorityRaw) || null;
      }
    }

    cases.push({
      id: headings[h].id,
      family: headings[h].id.replace(/-\d+$/, ""),
      title: headings[h].title,
      status,
      statusNote: collapse(statusNote),
      priority,
      layer,
      preconditions: collapse(bodyValue(body, "Preconditions") ?? ""),
      steps: collapse(bodyValue(body, "Steps") ?? ""),
      expected: collapse(bodyValue(body, "Expected") ?? ""),
      line: headings[h].line
    });
  }

  const statusCount = cases.filter((c) => c.status).length;
  const priorityCount = cases.filter((c) => c.priority).length;

  // The structural invariant: one heading, one status, one priority per case. Anything else means
  // the template drifted and the tally below cannot be trusted.
  const degraded = cases.length === 0 || statusCount !== cases.length || priorityCount !== cases.length;
  if (degraded && cases.length > 0) {
    warnings.push(
      `ledger: template drift — ${cases.length} cases, ${statusCount} with a status, ` +
        `${priorityCount} with a priority. The tally is not trustworthy until this is fixed.`
    );
  }

  const tally = {
    pass: cases.filter((c) => c.status === "PASS").length,
    fail: cases.filter((c) => c.status === "FAIL").length,
    blocked: cases.filter((c) => c.status === "BLOCKED").length,
    notRun: cases.filter((c) => c.status === "NOT RUN").length,
    notApplicable: cases.filter((c) => c.status === "NOT APPLICABLE").length,
    total: cases.length
  };

  const stats = {
    cases: cases.length,
    statusLines: statusCount,
    priorityLines: priorityCount,
    p0: cases.filter((c) => c.priority === "P0").length,
    p1: cases.filter((c) => c.priority === "P1").length,
    ...tally
  };

  return { ok: true, degraded, cases, tally, warnings, stats, mtimeMs: read.mtimeMs };
}

/**
 * Read one `- **Key:** value` entry, including any indented continuation lines that follow it.
 * The ledger wraps long values across several indented lines, so a single-line regex would
 * truncate every Steps and Expected field.
 *
 * @param {string[]} body
 * @param {string} key
 * @returns {string|null}
 */
function bodyValue(body, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const head = new RegExp(`^-\\s+\\*\\*${escaped}:\\*\\*\\s*([\\s\\S]*)$`);

  for (let i = 0; i < body.length; i += 1) {
    const m = head.exec(body[i]);
    if (!m) continue;

    const parts = [m[1]];
    for (let j = i + 1; j < body.length; j += 1) {
      const next = body[j];
      if (/^\s*$/.test(next)) break;
      if (/^-\s+\*\*/.test(next)) break; // the next key
      if (/^#{1,6}\s/.test(next)) break; // a new section
      if (!/^\s+/.test(next)) break; // no longer a continuation
      parts.push(next.trim());
    }
    return parts.join(" ");
  }
  return null;
}

/**
 * @param {string} s
 * @returns {string}
 */
function collapse(s) {
  return s.replace(/\s+/g, " ").trim();
}

function emptyTally() {
  return { pass: 0, fail: 0, blocked: 0, notRun: 0, notApplicable: 0, total: 0 };
}
