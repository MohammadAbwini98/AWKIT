/**
 * Parse .beads/issues.jsonl — the Beads task tracker's passive export.
 *
 * Edge direction was established empirically, not from documentation. awkit-07c, awkit-abi,
 * awkit-3lq and awkit-4t9 all carry {depends_on_id: "awkit-wza.1", type: "blocks"}, and
 * awkit-wza.1 is titled "Test Lab Phase 0: prerequisites". So:
 *
 *     X.dependencies[] {depends_on_id: Y, type: "blocks"}   means   X is blocked by Y
 *
 * Two fields are deliberately ignored:
 *   - `owner` is the same email on all 111 records. It is the repository owner, not an assignee,
 *     and surfacing it would answer "who is working on this" with a value that means nothing.
 *   - `labels` are useless for open work: 13 of the 14 distinct labels sit on one closed batch.
 *     Area is derived in normalize.mjs instead.
 */

import { readSource } from "./read-cache.mjs";

/** Dependency edge kinds observed in the export. An unknown kind is surfaced, never dropped. */
export const KNOWN_EDGE_TYPES = new Set(["blocks", "parent-child", "discovered-from"]);

/** Statuses observed in the export. */
/**
 * bd's seven built-in statuses (`bd statuses`), not just the two this repository happens to use
 * today. Accepting only open/closed was a latent trap: `bd update <id> --claim` sets `in_progress`,
 * so the documented way to claim work would have made this parser warn and the verifier fail.
 */
export const KNOWN_STATUSES = new Set([
  "open",
  "in_progress",
  "blocked",
  "deferred",
  "closed",
  "pinned",
  "hooked"
]);

/**
 * @typedef {Object} BeadEdge
 * @property {string} from    the blocked / child / derived issue
 * @property {string} to      the blocker / parent / origin issue
 * @property {string} type
 *
 * @typedef {Object} Bead
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {"open"|"closed"|string} status
 * @property {number|null} priority
 * @property {string|null} issueType
 * @property {string[]} labels
 * @property {BeadEdge[]} edges
 * @property {string|null} createdAt
 * @property {string|null} updatedAt
 * @property {string|null} closedAt
 * @property {string|null} closeReason
 * @property {number} lineNumber
 */

/**
 * @returns {{
 *   ok: boolean,
 *   beads: Bead[],
 *   edges: BeadEdge[],
 *   warnings: string[],
 *   stats: Record<string, number>,
 *   mtimeMs: number
 * }}
 */
export function parseBeads() {
  const read = readSource("beads");
  /** @type {string[]} */
  const warnings = [];

  if (!read.ok) {
    return {
      ok: false,
      beads: [],
      edges: [],
      warnings: [`beads: ${read.error}`],
      stats: {},
      mtimeMs: read.mtimeMs
    };
  }

  /** @type {Bead[]} */
  const beads = [];
  /** @type {BeadEdge[]} */
  const edges = [];

  const lines = read.text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;

    let rec;
    try {
      rec = JSON.parse(line);
    } catch (err) {
      warnings.push(`beads line ${i + 1}: unparseable JSON (${message(err)})`);
      continue;
    }

    // The export is documented as one _type per line; today every record is an issue. A future
    // memory or comment record must be skipped rather than mangled into the issue list.
    if (rec._type !== "issue") continue;
    if (typeof rec.id !== "string" || !rec.id) {
      warnings.push(`beads line ${i + 1}: record has no id`);
      continue;
    }

    if (!KNOWN_STATUSES.has(rec.status)) {
      warnings.push(`beads ${rec.id}: unrecognised status "${rec.status}"`);
    }

    /** @type {BeadEdge[]} */
    const recEdges = [];
    for (const dep of Array.isArray(rec.dependencies) ? rec.dependencies : []) {
      if (typeof dep?.depends_on_id !== "string") continue;
      if (!KNOWN_EDGE_TYPES.has(dep.type)) {
        warnings.push(`beads ${rec.id}: unrecognised edge type "${dep.type}"`);
      }
      const edge = { from: rec.id, to: dep.depends_on_id, type: dep.type };
      recEdges.push(edge);
      edges.push(edge);
    }

    beads.push({
      id: rec.id,
      title: typeof rec.title === "string" ? rec.title : "(untitled)",
      description: typeof rec.description === "string" ? rec.description : "",
      status: rec.status,
      priority: Number.isInteger(rec.priority) ? rec.priority : null,
      issueType: typeof rec.issue_type === "string" ? rec.issue_type : null,
      labels: Array.isArray(rec.labels) ? rec.labels.filter((l) => typeof l === "string") : [],
      edges: recEdges,
      createdAt: rec.created_at ?? null,
      updatedAt: rec.updated_at ?? null,
      closedAt: rec.closed_at ?? null,
      closeReason: rec.close_reason ?? null,
      lineNumber: i + 1
    });
  }

  // A dangling reference means the graph is lying about what blocks what. Surface it loudly;
  // order.mjs then treats it as unsatisfied (fail-closed) rather than quietly ignoring the edge.
  const ids = new Set(beads.map((b) => b.id));
  const dangling = edges.filter((e) => !ids.has(e.to));
  for (const e of dangling) {
    warnings.push(`beads ${e.from}: depends on "${e.to}", which is not in the export`);
  }

  /** @type {Record<string, number>} */
  const byStatus = {};
  for (const b of beads) byStatus[b.status] = (byStatus[b.status] ?? 0) + 1;

  const stats = {
    total: beads.length,
    open: beads.filter((b) => b.status === "open").length,
    closed: beads.filter((b) => b.status === "closed").length,
    // Everything not closed. Reporting `open` alone under-counts the moment any other status is
    // used — a blocked or in-progress issue is still outstanding work.
    outstanding: beads.filter((b) => b.status !== "closed").length,
    byStatus,
    edges: edges.length,
    blocksEdges: edges.filter((e) => e.type === "blocks").length,
    parentChildEdges: edges.filter((e) => e.type === "parent-child").length,
    discoveredFromEdges: edges.filter((e) => e.type === "discovered-from").length,
    danglingEdges: dangling.length
  };

  return { ok: true, beads, edges, warnings, stats, mtimeMs: read.mtimeMs };
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function message(err) {
  return err instanceof Error ? err.message : String(err);
}
