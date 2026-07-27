/**
 * Agent attribution — two fields that are never merged.
 *
 * The repository has no per-issue assignee. All 111 beads carry the same human owner email, and
 * TASK_LOG.md is a past-tense record of what was done. So "which agent is working on this issue"
 * has no truthful answer today, and this module refuses to manufacture one.
 *
 * Instead it produces two structurally different values:
 *
 *   assignee  from assignments.json only. An explicit, expiring claim an agent wrote. This is the
 *             only field permitted to say someone IS working on something. Empty means "Unclaimed".
 *
 *   activity  from TASK_LOG. "The last agent to log work in this area, and when." Rendered muted
 *             and dashed. It may never be phrased as "working on" — Claude closing a Recorder task
 *             on Monday says nothing about who will pick up a different Recorder issue on Friday.
 *
 * The verifier asserts the separation structurally: every agent value carries a `source`, and no
 * value sourced from the task log may carry a claim `state`.
 */

import { readFileSync } from "node:fs";

import { ASSIGNMENTS_PATH } from "./sources.mjs";

/** A claim older than this is shown struck through. A stale claim is worse than no claim. */
const DEFAULT_CLAIM_TTL_MS = 24 * 60 * 60 * 1000;

/** How far back a task-log entry can be and still count as "recent activity". */
const ACTIVITY_WINDOW_DAYS = 30;

/**
 * @typedef {Object} Assignee
 * @property {string} agent
 * @property {string} state
 * @property {string} claimedAt
 * @property {string|null} expiresAt
 * @property {boolean} expired
 * @property {string} note
 * @property {"assignments.json"} source
 * @property {"declared"} confidence
 *
 * @typedef {Object} AreaActivity
 * @property {string} agent
 * @property {string} raw
 * @property {string} date
 * @property {string} heading
 * @property {"task-log"} source
 * @property {"derived"} confidence
 */

/**
 * Read the opt-in claims file. Never throws: a missing or malformed file simply means every item
 * is Unclaimed, which is the honest default.
 *
 * @param {number} [now]
 * @param {string} [path] the claims file to read. Defaults to the real one; the parameter exists so
 *   the verifier can drive this against a fixture. Without it the "an assignee is authoritative"
 *   check is vacuous whenever the shipped file is empty — which is its normal state.
 * @returns {{claims: Map<string, Assignee>, warnings: string[], stats: Record<string, number>}}
 */
export function readAssignments(now = Date.now(), path = ASSIGNMENTS_PATH) {
  /** @type {string[]} */
  const warnings = [];
  /** @type {Map<string, Assignee>} */
  const claims = new Map();

  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { claims, warnings, stats: { claims: 0, expired: 0 } };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    warnings.push(
      `assignments.json is not valid JSON (${err instanceof Error ? err.message : String(err)}) — ` +
        "every item will show as Unclaimed"
    );
    return { claims, warnings, stats: { claims: 0, expired: 0 } };
  }

  let expired = 0;
  for (const claim of Array.isArray(parsed?.claims) ? parsed.claims : []) {
    if (typeof claim?.itemId !== "string" || typeof claim?.agent !== "string") {
      warnings.push("assignments.json: a claim is missing itemId or agent and was ignored");
      continue;
    }

    const claimedAt = typeof claim.claimedAt === "string" ? claim.claimedAt : "";
    const expiresAt =
      typeof claim.expiresAt === "string"
        ? claim.expiresAt
        : claimedAt
          ? new Date(Date.parse(claimedAt) + DEFAULT_CLAIM_TTL_MS).toISOString()
          : null;

    const isExpired = expiresAt !== null && Number.isFinite(Date.parse(expiresAt))
      ? Date.parse(expiresAt) < now
      : false;
    if (isExpired) expired += 1;

    claims.set(claim.itemId, {
      agent: claim.agent,
      state: typeof claim.state === "string" ? claim.state : "claimed",
      claimedAt,
      expiresAt,
      expired: isExpired,
      note: typeof claim.note === "string" ? claim.note : "",
      source: "assignments.json",
      confidence: "declared"
    });
  }

  return { claims, warnings, stats: { claims: claims.size, expired } };
}

/**
 * Fold the task log into "most recent logged activity per area".
 *
 * Area is derived from the task text using the same keyword table the issues use, so an issue in
 * "Reports" can be shown next to the last Reports entry in the log. That adjacency is a hint about
 * where attention has been, nothing more, and the UI must label it that way.
 *
 * @param {import("./parse-task-log.mjs").TaskLogEntry[]} entries
 * @param {(text: string, basis?: string) => {value: string|null}} deriveArea
 * @param {number} [now]
 * @returns {{byArea: Map<string, AreaActivity>, recent: AreaActivity[], stats: Record<string, number>}}
 */
export function buildAreaActivity(entries, deriveArea, now = Date.now()) {
  const cutoff = new Date(now - ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  /** @type {Map<string, AreaActivity>} */
  const byArea = new Map();
  /** @type {AreaActivity[]} */
  const recent = [];

  for (const entry of entries) {
    if (!entry.agent || !entry.date) continue;

    /** @type {AreaActivity} */
    const activity = {
      agent: entry.agent,
      raw: entry.agentRaw ?? entry.agent,
      date: entry.date,
      heading: entry.heading,
      source: "task-log",
      confidence: "derived"
    };

    if (entry.date >= cutoff) recent.push(activity);

    const area = deriveArea(entry.task, "task log heading").value;
    if (!area) continue;

    const existing = byArea.get(area);
    if (!existing || entry.date > existing.date) byArea.set(area, activity);
  }

  recent.sort((a, b) => b.date.localeCompare(a.date) || a.agent.localeCompare(b.agent));

  return {
    byArea,
    recent,
    stats: { areasWithActivity: byArea.size, recentEntries: recent.length, windowDays: ACTIVITY_WINDOW_DAYS }
  };
}

/**
 * Group task-log entries into a timeline. This is the one agent question that IS answerable from
 * real data: at the PROGRAM level, who has been working, and when.
 *
 * @param {import("./parse-task-log.mjs").TaskLogEntry[]} entries
 * @param {number} [limit]
 * @returns {{agent: string, entries: {date: string, task: string, raw: string}[], count: number, latest: string}[]}
 */
export function buildAgentTimeline(entries, limit = 40) {
  /** @type {Map<string, {agent: string, entries: {date: string, task: string, raw: string}[], count: number, latest: string}>} */
  const groups = new Map();

  for (const e of entries) {
    if (!e.agent) continue;
    const g = groups.get(e.agent) ?? { agent: e.agent, entries: [], count: 0, latest: "" };
    g.count += 1;
    if (e.date > g.latest) g.latest = e.date;
    if (g.entries.length < limit) {
      g.entries.push({ date: e.date, task: e.task, raw: e.agentRaw ?? e.agent });
    }
    groups.set(e.agent, g);
  }

  return [...groups.values()].sort(
    (a, b) => b.latest.localeCompare(a.latest) || b.count - a.count || a.agent.localeCompare(b.agent)
  );
}
