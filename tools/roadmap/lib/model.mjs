/**
 * Build the snapshot the dashboard renders. This is the only module server.mjs calls.
 *
 * The snapshot is deliberately a pure function of the files on disk plus an injected clock: given
 * the same sources and the same `now`, it serialises byte-identically. The verifier asserts that,
 * because a snapshot that changes without its inputs changing cannot be reasoned about — and an
 * ETag built from it would be meaningless.
 */

import { buildAgentTimeline, buildAreaActivity, readAssignments } from "./agents.mjs";
import { buildLinks, findStaleClaims } from "./link.mjs";
import {
  deriveArea,
  normalizeBeads,
  normalizeCases,
  normalizeDefects,
  normalizePhases
} from "./normalize.mjs";
import { computeOrder } from "./order.mjs";
import { parseBeads } from "./parse-beads.mjs";
import { parseDefects } from "./parse-defects.mjs";
import { parseKnownIssues } from "./parse-known-issues.mjs";
import { parseLedger } from "./parse-ledger.mjs";
import { parseNarrative } from "./parse-narrative.mjs";
import { parseRoadmapPhases } from "./parse-roadmap-phases.mjs";
import { parseTaskLog } from "./parse-task-log.mjs";
import { parseTraceability } from "./parse-traceability.mjs";
import { parseVerifiers } from "./parse-verifiers.mjs";
import { readSource } from "./read-cache.mjs";
import { SOURCES } from "./sources.mjs";

/**
 * @param {{now?: number}} [options]
 * @returns {Record<string, unknown>}
 */
export function buildSnapshot(options = {}) {
  const now = options.now ?? Date.now();

  const beads = parseBeads();
  const ledger = parseLedger();
  const defects = parseDefects();
  const traceability = parseTraceability();
  const phases = parseRoadmapPhases();
  const taskLog = parseTaskLog();
  const knownIssues = parseKnownIssues();
  const verifiers = parseVerifiers();
  const narrative = parseNarrative();

  const items = [
    ...normalizeBeads(beads.beads),
    ...normalizeCases(ledger.cases),
    ...normalizeDefects(defects.defects),
    ...normalizePhases(phases.phases, phases.mtimeMs)
  ];

  // Fill the inverse edge now that every item exists.
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const item of items) {
    for (const dep of item.dependsOn) byId.get(dep)?.blocks.push(item.id);
  }

  const links = buildLinks(items, defects.defects, knownIssues.entries);
  const staleClaims = findStaleClaims(items, ledger.cases);
  for (const claim of staleClaims) {
    const item = byId.get(claim.itemId);
    if (item) item.flags.staleClaim = { claimed: claim.claimed, measured: claim.measured, area: claim.area };
  }

  const order = computeOrder(items);
  const assignments = readAssignments(now);
  const activity = buildAreaActivity(taskLog.entries, deriveArea, now);
  const timeline = buildAgentTimeline(taskLog.entries);

  // Attach the two agent fields. They stay separate all the way to the DOM.
  for (const item of items) {
    const claim = assignments.claims.get(item.id);
    item.assignee = claim ?? null;
    const area = item.area.value;
    item.areaActivity = area ? (activity.byArea.get(area) ?? null) : null;
  }

  const consistency = buildConsistency(ledger, narrative, staleClaims);
  const warnings = [
    ...beads.warnings,
    ...ledger.warnings,
    ...defects.warnings,
    ...traceability.warnings,
    ...phases.warnings,
    ...taskLog.warnings,
    ...knownIssues.warnings,
    ...verifiers.warnings,
    ...narrative.warnings,
    ...assignments.warnings
  ];

  return {
    generatedAt: new Date(now).toISOString(),
    items,
    order,
    links,
    consistency,
    ledger: {
      tally: ledger.tally,
      degraded: ledger.degraded,
      byFamily: familyTally(ledger.cases),
      residual: ledger.cases
        .filter((c) => c.status !== "PASS")
        .map((c) => ({
          id: c.id,
          title: c.title,
          status: c.status,
          priority: c.priority,
          layer: c.layer,
          note: c.statusNote
        }))
    },
    defects: {
      sections: defects.sections,
      stats: defects.stats
    },
    traceability: {
      byStatus: traceability.byStatus,
      byRequirement: traceability.byRequirement,
      rows: traceability.rows,
      stats: traceability.stats
    },
    phases: {
      summary: phases.summary,
      mtimeMs: phases.mtimeMs,
      ageDays: phases.mtimeMs ? Math.floor((now - phases.mtimeMs) / 86400000) : null
    },
    knownIssues: {
      sections: knownIssues.sections,
      entries: knownIssues.entries,
      stats: knownIssues.stats
    },
    verifiers,
    agents: {
      timeline,
      coverage: taskLog.coverage,
      byAgent: taskLog.byAgent,
      recent: activity.recent.slice(0, 60),
      assignments: assignments.stats
    },
    sources: SOURCES.map((s) => {
      const read = readSource(s.id);
      return {
        id: s.id,
        rel: s.rel,
        label: s.label,
        role: s.role,
        parsed: s.parsed,
        skipReason: s.skipReason ?? null,
        ok: read.ok,
        error: read.error,
        bytes: read.size,
        mtime: read.mtimeMs ? new Date(read.mtimeMs).toISOString() : null,
        records: recordCount(s.id, { beads, ledger, defects, traceability, phases, taskLog, knownIssues, verifiers })
      };
    }),
    warnings,
    stats: {
      items: items.length,
      beads: beads.stats,
      ledger: ledger.stats,
      defects: defects.stats,
      traceability: traceability.stats,
      phases: phases.stats,
      taskLog: taskLog.stats,
      knownIssues: knownIssues.stats,
      verifiers: verifiers.stats,
      order: order.stats,
      links: links.stats
    }
  };
}

/**
 * Compare the ledger's measured tally against every copy of it elsewhere in the repository.
 *
 * Divergence here is a real finding, not a rendering problem: the campaign's own history contains
 * a recorded "Ledger correction", so these numbers have drifted before.
 */
function buildConsistency(ledger, narrative, staleClaims) {
  const measured = {
    pass: ledger.tally.pass,
    notRun: ledger.tally.notRun,
    blocked: ledger.tally.blocked
  };

  const copies = narrative.heads
    .filter((h) => h.assertedTally)
    .map((h) => ({
      source: h.sourceId,
      rel: h.rel,
      heading: h.heading,
      tally: h.assertedTally,
      agrees:
        h.assertedTally.pass === measured.pass &&
        h.assertedTally.notRun === measured.notRun &&
        h.assertedTally.blocked === measured.blocked
    }));

  return {
    measured,
    copies,
    staleClaims,
    agrees: copies.every((c) => c.agrees) && staleClaims.length === 0,
    checked: copies.length + staleClaims.length
  };
}

function familyTally(cases) {
  /** @type {Map<string, {family: string, pass: number, notRun: number, blocked: number, total: number}>} */
  const out = new Map();
  for (const c of cases) {
    const family = c.family;
    const g = out.get(family) ?? { family, pass: 0, notRun: 0, blocked: 0, total: 0 };
    g.total += 1;
    if (c.status === "PASS") g.pass += 1;
    else if (c.status === "NOT RUN") g.notRun += 1;
    else if (c.status === "BLOCKED") g.blocked += 1;
    out.set(family, g);
  }
  return [...out.values()].sort((a, b) => b.total - a.total);
}

function recordCount(id, parsed) {
  switch (id) {
    case "beads":
      return parsed.beads.stats.total ?? 0;
    case "ledger":
      return parsed.ledger.stats.cases ?? 0;
    case "defects":
      return parsed.defects.stats.defects ?? 0;
    case "traceability":
      return parsed.traceability.stats.rows ?? 0;
    case "phases":
      return parsed.phases.stats.phases ?? 0;
    case "taskLog":
      return parsed.taskLog.stats.entries ?? 0;
    case "knownIssues":
      return parsed.knownIssues.stats.entries ?? 0;
    case "verifierClassification":
      return parsed.verifiers.stats.classified ?? 0;
    default:
      return null;
  }
}
