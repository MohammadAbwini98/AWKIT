/**
 * Parse docs/ai/TASK_LOG.md for agent attribution.
 *
 * This is the ONLY per-agent signal in the repository. Beads carries no assignee — all 111 issues
 * are owned by the same human email. So everything the dashboard can say about agents comes from
 * here, and it is all PAST TENSE. This file records what an agent DID, never what it is assigned.
 * Nothing downstream may phrase a value from this parser as "working on".
 *
 * The heading format is not uniform. Measured across all 247 headings:
 *
 *   - 32 put the agent in a trailing paren:  `## 2026-07-27 - <task> (Claude)`
 *   - 193 put it in a dash-delimited segment: `## 2026-07-07 — Claude (Opus 4.8) — <task>`
 *   - 22 name no agent at all
 *
 * Separators are mixed ASCII hyphen, en dash and em dash. Four spellings — Claude, Claude Code,
 * Claude (Opus 4.8), Claude Fable 5 — are one agent, so they canonicalise for grouping while the
 * raw string is retained for hover.
 *
 * Coverage is reported (225/247 = 91.1% today) rather than silently accepted, so that a future
 * format change shows up as a coverage drop instead of a quietly emptier timeline.
 */

import { readSource } from "./read-cache.mjs";

/**
 * Exact agent spellings observed in the log, longest first so that "Claude (Opus 4.8)" is never
 * shadowed by "Claude" during matching.
 */
const AGENT_VOCAB = [
  { raw: "Claude (Opus 4.8)", canonical: "Claude" },
  { raw: "Claude Fable 5", canonical: "Claude" },
  { raw: "Claude Code", canonical: "Claude" },
  { raw: "Claude", canonical: "Claude" },
  { raw: "Codex", canonical: "Codex" },
  { raw: "Gemini", canonical: "Gemini" },
  { raw: "Antigravity", canonical: "Antigravity" },
  { raw: "AI coding agent", canonical: "Unspecified agent" },
  { raw: "Coding agent", canonical: "Unspecified agent" },
  { raw: "agent", canonical: "Unspecified agent" }
];

/** Canonical names the dashboard groups by. */
export const CANONICAL_AGENTS = [...new Set(AGENT_VOCAB.map((a) => a.canonical))];

const HEADING = /^##\s+(.*)$/;
const LEADING_DATE = /^(\d{4}-\d{2}-\d{2})\b/;
/** ASCII hyphen, en dash, em dash — all three are used as segment separators in this file. */
const SEGMENT_SPLIT = /\s+[—–-]\s+/;
const TRAILING_PAREN = /\(([^()]+)\)\s*$/;
/** Ordering qualifiers that sit next to the date: (latest), (earlier), (later), (continued). */
const DATE_QUALIFIER = /^\((?:latest|earlier|later|continued|cont\.?|second|third)\)$/i;

/**
 * @typedef {Object} TaskLogEntry
 * @property {string} date            ISO yyyy-mm-dd, or "" when the heading has none
 * @property {string} heading         the verbatim heading text, minus the leading "## "
 * @property {string} task            the heading with date and agent removed
 * @property {string|null} agentRaw   the spelling as written
 * @property {string|null} agent      canonical name
 * @property {"paren"|"segment"|null} basis how the agent was recognised
 * @property {number} line
 */

/**
 * @returns {{
 *   ok: boolean,
 *   entries: TaskLogEntry[],
 *   byAgent: {agent: string, count: number, latest: string}[],
 *   coverage: {total: number, attributed: number, unattributed: number, percent: number},
 *   warnings: string[],
 *   stats: Record<string, number>,
 *   mtimeMs: number
 * }}
 */
export function parseTaskLog() {
  const read = readSource("taskLog");
  /** @type {string[]} */
  const warnings = [];

  if (!read.ok) {
    return {
      ok: false,
      entries: [],
      byAgent: [],
      coverage: { total: 0, attributed: 0, unattributed: 0, percent: 0 },
      warnings: [`taskLog: ${read.error}`],
      stats: {},
      mtimeMs: read.mtimeMs
    };
  }

  if (read.nulStripped > 0) {
    // This file should carry NONE. Worth stating rather than hiding, because a NUL inside a heading
    // would drop that entry from the tally without any other symptom — and because the write is
    // almost always accidental: an editing tool expanding a `\uXXXX` escape in prose about control
    // characters. `grep` then reports the file as binary instead of matching it.
    //
    // Do NOT re-add a hardcoded offset here. The previous message named "offset 62127", which every
    // subsequent append silently invalidated; by the time the NUL was found it sat at 102796 and the
    // message was pointing 40KB away. Report the count, which is always true, and let the reader
    // locate it.
    warnings.push(
      `taskLog: stripped ${read.nulStripped} NUL byte(s) before parsing — expected 0; find them with ` +
        `a byte scan, not grep`
    );
  }

  const lines = read.text.split(/\r?\n/);

  /** @type {TaskLogEntry[]} */
  const entries = [];
  for (let i = 0; i < lines.length; i += 1) {
    const h = HEADING.exec(lines[i]);
    if (!h) continue;

    const heading = h[1].trim();
    if (!heading) continue;

    const date = LEADING_DATE.exec(heading)?.[1] ?? "";
    const found = findAgent(heading);

    entries.push({
      date,
      heading,
      task: taskText(heading, date, found),
      agentRaw: found?.raw ?? null,
      agent: found?.canonical ?? null,
      basis: found?.basis ?? null,
      line: i + 1
    });
  }

  const attributed = entries.filter((e) => e.agent !== null).length;
  const coverage = {
    total: entries.length,
    attributed,
    unattributed: entries.length - attributed,
    percent: entries.length === 0 ? 0 : Math.round((attributed / entries.length) * 1000) / 10
  };

  // A sharp drop means the heading convention changed. Better a warning than a thinner timeline
  // that looks like the agents simply stopped working.
  if (entries.length > 0 && coverage.percent < 75) {
    warnings.push(
      `taskLog: only ${coverage.percent}% of ${entries.length} headings name a known agent — ` +
        "the heading convention may have changed"
    );
  }

  /** @type {Map<string, {agent: string, count: number, latest: string}>} */
  const groups = new Map();
  for (const e of entries) {
    if (!e.agent) continue;
    const g = groups.get(e.agent) ?? { agent: e.agent, count: 0, latest: "" };
    g.count += 1;
    if (e.date > g.latest) g.latest = e.date;
    groups.set(e.agent, g);
  }
  const byAgent = [...groups.values()].sort((a, b) => b.count - a.count || a.agent.localeCompare(b.agent));

  const stats = {
    entries: entries.length,
    attributed,
    unattributed: coverage.unattributed,
    viaParen: entries.filter((e) => e.basis === "paren").length,
    viaSegment: entries.filter((e) => e.basis === "segment").length,
    agents: byAgent.length
  };

  return { ok: true, entries, byAgent, coverage, warnings, stats, mtimeMs: read.mtimeMs };
}

/**
 * Two strategies, in order. Both require an EXACT match against the vocabulary — a substring
 * search would attribute "Claude" from a task description that merely mentions it.
 *
 * @param {string} heading
 * @returns {{raw: string, canonical: string, basis: "paren"|"segment"}|null}
 */
function findAgent(heading) {
  const paren = TRAILING_PAREN.exec(heading);
  if (paren) {
    const hit = matchVocab(paren[1]);
    if (hit) return { ...hit, basis: "paren" };
  }

  for (const segment of heading.split(SEGMENT_SPLIT)) {
    const hit = matchVocab(segment);
    if (hit) return { ...hit, basis: "segment" };
  }

  return null;
}

/**
 * @param {string} candidate
 * @returns {{raw: string, canonical: string}|null}
 */
function matchVocab(candidate) {
  const value = candidate.trim();
  if (!value) return null;
  for (const entry of AGENT_VOCAB) {
    if (entry.raw.toLowerCase() === value.toLowerCase()) {
      return { raw: value, canonical: entry.canonical };
    }
  }
  return null;
}

/**
 * The heading with its date, ordering qualifier and agent segment removed, so what is left reads
 * as the task itself. Used for the area keyword match.
 *
 * @param {string} heading
 * @param {string} date
 * @param {{raw: string}|null} found
 * @returns {string}
 */
function taskText(heading, date, found) {
  const segments = heading
    .split(SEGMENT_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);

  const kept = segments.filter((s, idx) => {
    if (idx === 0 && date && s.startsWith(date)) return false;
    if (found && s.toLowerCase() === found.raw.toLowerCase()) return false;
    return true;
  });

  let text = (kept.length > 0 ? kept : segments).join(" - ");

  if (date) text = text.replace(new RegExp(`^${date}\\s*`), "");
  // Drop a leading ordering qualifier left behind by the date removal.
  const lead = /^\((?:[^()]+)\)\s*/.exec(text);
  if (lead && DATE_QUALIFIER.test(lead[0].trim())) text = text.slice(lead[0].length);
  // Drop the trailing agent paren when that is how it was recognised.
  if (found) {
    const tail = TRAILING_PAREN.exec(text);
    if (tail && tail[1].trim().toLowerCase() === found.raw.toLowerCase()) {
      text = text.slice(0, tail.index);
    }
  }

  return text.replace(/\s+/g, " ").replace(/^[—–-]\s*/, "").trim();
}
