/**
 * Parse the defect register — DEFECTS.md.
 *
 * Two details drive the design:
 *
 *  1. `## Open product defects` currently contains the literal string "None." — an empty state,
 *     not a malformed entry. A parser that treats every `##` as a container of `###` entries must
 *     not warn about it.
 *
 *  2. `- **Detected by:** \`SET-009\`` is the only join between the defect namespace and the case
 *     namespace, and some rows cite several cases. Every backticked ID token is extracted, and
 *     tokens that do not resolve against the ledger (CMP-CON-002 is a live example) are preserved
 *     as unresolved rather than dropped. Silently discarding them would hide real data.
 */

import { readSource } from "./read-cache.mjs";

const SECTION_HEADING = /^## (.+)$/;
const DEFECT_HEADING = /^### ([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+)\s+[—–-]\s+(.+)$/;
/** Any `ID-123`-shaped token inside backticks, used on the Detected by line. */
const BACKTICKED_ID = /`([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+)`/g;

const FIELD_KEYS = [
  "Severity",
  "Priority recommendation",
  "Status",
  "Affected area",
  "Detected by",
  "Evidence before fix",
  "Evidence after fix"
];

/**
 * @typedef {Object} Defect
 * @property {string} id
 * @property {string} title
 * @property {string} section          the `##` lifecycle bucket it sits under
 * @property {boolean} resolved        derived from the section and the Status field
 * @property {string|null} severity    "S1" | "S2" | "S3"
 * @property {string|null} priorityRecommendation
 * @property {string} status
 * @property {string} affectedArea
 * @property {string[]} detectedBy     raw case/defect ID tokens, unresolved at this layer
 * @property {string} evidenceBefore
 * @property {string} evidenceAfter
 * @property {number} line
 */

/**
 * @returns {{
 *   ok: boolean,
 *   defects: Defect[],
 *   sections: {name: string, count: number, empty: boolean, line: number}[],
 *   warnings: string[],
 *   stats: Record<string, number>,
 *   mtimeMs: number
 * }}
 */
export function parseDefects() {
  const read = readSource("defects");
  /** @type {string[]} */
  const warnings = [];

  if (!read.ok) {
    return {
      ok: false,
      defects: [],
      sections: [],
      warnings: [`defects: ${read.error}`],
      stats: {},
      mtimeMs: read.mtimeMs
    };
  }

  const lines = read.text.split(/\r?\n/);

  /** @type {{name: string, line: number}[]} */
  const sectionMarks = [];
  /** @type {{id: string, title: string, line: number}[]} */
  const defectMarks = [];

  for (let i = 0; i < lines.length; i += 1) {
    const s = SECTION_HEADING.exec(lines[i]);
    if (s) {
      sectionMarks.push({ name: s[1].trim(), line: i + 1 });
      continue;
    }
    const d = DEFECT_HEADING.exec(lines[i]);
    if (d) defectMarks.push({ id: d[1], title: d[2].trim(), line: i + 1 });
  }

  /**
   * @param {number} line
   * @returns {string}
   */
  const sectionAt = (line) => {
    let name = "(no section)";
    for (const s of sectionMarks) {
      if (s.line < line) name = s.name;
      else break;
    }
    return name;
  };

  /** @type {Defect[]} */
  const defects = [];
  for (let d = 0; d < defectMarks.length; d += 1) {
    const start = defectMarks[d].line;
    const nextDefect = d + 1 < defectMarks.length ? defectMarks[d + 1].line - 1 : lines.length;
    const nextSection = sectionMarks.find((s) => s.line > start)?.line;
    const end = nextSection ? Math.min(nextDefect, nextSection - 1) : nextDefect;
    const body = lines.slice(start, end);

    const fields = readFields(body);
    const section = sectionAt(start);
    const status = fields.get("Status") ?? "";

    /** @type {string[]} */
    const detectedBy = [];
    const detectedRaw = fields.get("Detected by") ?? "";
    for (const m of detectedRaw.matchAll(BACKTICKED_ID)) {
      if (!detectedBy.includes(m[1])) detectedBy.push(m[1]);
    }

    const severityRaw = fields.get("Severity") ?? "";
    const severity = /\b(S[0-9])\b/.exec(severityRaw)?.[1] ?? null;

    defects.push({
      id: defectMarks[d].id,
      title: defectMarks[d].title,
      section,
      resolved: /^Resolved/i.test(section) || /\bResolved\b/i.test(status),
      severity,
      priorityRecommendation: fields.get("Priority recommendation") ?? null,
      status,
      affectedArea: fields.get("Affected area") ?? "",
      detectedBy,
      evidenceBefore: fields.get("Evidence before fix") ?? "",
      evidenceAfter: fields.get("Evidence after fix") ?? "",
      line: defectMarks[d].line
    });
  }

  // Section inventory, including the deliberately-empty ones. "None." is an empty state.
  const sections = sectionMarks.map((s, idx) => {
    const end = idx + 1 < sectionMarks.length ? sectionMarks[idx + 1].line : lines.length;
    const count = defectMarks.filter((d) => d.line > s.line && d.line < end).length;
    const bodyText = lines.slice(s.line, end).join(" ").trim();
    return {
      name: s.name,
      count,
      empty: count === 0 && /^none\.?$/i.test(bodyText.replace(/\s+/g, " ").trim()),
      line: s.line
    };
  });

  for (const d of defects) {
    if (!d.status) warnings.push(`defects ${d.id}: no Status field`);
  }

  const stats = {
    defects: defects.length,
    sections: sections.length,
    open: defects.filter((d) => !d.resolved).length,
    resolved: defects.filter((d) => d.resolved).length,
    s1: defects.filter((d) => d.severity === "S1").length,
    s2: defects.filter((d) => d.severity === "S2").length,
    s3: defects.filter((d) => d.severity === "S3").length,
    detectedByTokens: defects.reduce((n, d) => n + d.detectedBy.length, 0)
  };

  return { ok: true, defects, sections, warnings, stats, mtimeMs: read.mtimeMs };
}

/**
 * @param {string[]} body
 * @returns {Map<string, string>}
 */
function readFields(body) {
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const key of FIELD_KEYS) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const head = new RegExp(`^-\\s+\\*\\*${escaped}:\\*\\*\\s*([\\s\\S]*)$`);
    for (let i = 0; i < body.length; i += 1) {
      const m = head.exec(body[i]);
      if (!m) continue;
      const parts = [m[1]];
      for (let j = i + 1; j < body.length; j += 1) {
        const next = body[j];
        if (/^\s*$/.test(next)) break;
        if (/^-\s+\*\*/.test(next)) break;
        if (/^#{1,6}\s/.test(next)) break;
        if (!/^\s+/.test(next)) break;
        parts.push(next.trim());
      }
      out.set(key, parts.join(" ").replace(/\s+/g, " ").trim());
      break;
    }
  }
  return out;
}
