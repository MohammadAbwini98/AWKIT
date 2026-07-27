/**
 * Map every parser's output into one WorkItem shape.
 *
 * Two design rules drive this file:
 *
 *  1. `area` and `agent` are provenance objects, never bare strings. Anything derived carries how
 *     it was derived, so the UI can style inference differently from fact and the verifier can
 *     assert that no derived value is ever rendered as authoritative.
 *
 *  2. Nothing is invented to fill a field. An unmatched area is null and renders "unclassified";
 *     it is not guessed from a neighbouring value.
 */

/**
 * Keyword -> area. Order is significance order, not alphabetical, and is used only as a TIEBREAK:
 * within a given scope the *earliest occurrence in the text* wins, because titles and file lists are
 * written subject-first. Ordering alone is not enough — "Settings full-page coverage (unavailable
 * secret-store GUI)" contains both `settings` and `secret`, and list order alone would file a
 * Settings issue under Security.
 */
const AREA_KEYWORDS = [
  ["recorder", "Recorder"],
  ["zvec", "Zvec / semantic"],
  ["semantic", "Zvec / semantic"],
  ["oracle", "Oracle / JDBC"],
  ["jdbc", "Oracle / JDBC"],
  ["licens", "Licensing"],
  ["rbac", "Security / RBAC"],
  ["auth", "Security / RBAC"],
  ["permission", "Security / RBAC"],
  ["secret", "Security / RBAC"],
  ["packaging", "Packaging / offline"],
  ["offline", "Packaging / offline"],
  ["installer", "Packaging / offline"],
  ["report", "Reports"],
  ["analytics", "Reports"],
  ["telemetry", "Reports"],
  ["settings", "Settings"],
  ["designer", "Designer / canvas"],
  ["canvas", "Designer / canvas"],
  ["workflow", "Workflow builder"],
  ["scenario", "Workflow builder"],
  ["runner", "Runner / engine"],
  ["execution", "Runner / engine"],
  ["engine", "Runner / engine"],
  ["concurren", "Runner / engine"],
  ["browser", "Runner / engine"],
  ["popup", "Runner / engine"],
  ["ipc", "IPC / main process"],
  ["preload", "IPC / main process"],
  ["test lab", "Test Lab"],
  ["randomi", "Test Lab"],
  ["locator", "Locators"],
  // An instance is the runner's unit of execution; Instance Monitor is its surface. Listed last
  // because the word appears incidentally in many bodies — position, not list order, decides.
  ["instance", "Runner / engine"]
];

/** Sort weight for the work queue: a regression of shipped behaviour outranks new work. */
const TYPE_RANK = { bug: 0, task: 1, feature: 2, chore: 3, epic: 4 };

/**
 * @typedef {Object} Provenance
 * @property {string|null} value
 * @property {"declared"|"derived"} confidence
 * @property {string} basis
 *
 * @typedef {Object} WorkItem
 * @property {string} id            namespaced: "bead:awkit-7lj", "case:SET-013", "defect:...", "phase:E"
 * @property {string} nativeId
 * @property {string} kind
 * @property {string} title
 * @property {string} status        normalised
 * @property {string} rawStatus     verbatim source value
 * @property {number|null} priority
 * @property {string|null} rawPriority
 * @property {string|null} type
 * @property {Provenance} area
 * @property {string[]} dependsOn
 * @property {string[]} blocks
 * @property {{id: string|null, unresolvedText?: string, relation: string, basis: string, confidence: string}[]} related
 * @property {string[]} evidence
 * @property {{file: string, line: number, sourceId: string}} source
 * @property {string|null} updatedAt
 * @property {string} body
 * @property {Record<string, unknown>} flags
 */

/**
 * Best keyword match within ONE scope of text.
 *
 * Earliest occurrence wins. A title states its subject first — "Designer round trip drops a bare
 * FlowStep.value", "Test Lab Phase 6: campaign reporting" — so the leading keyword is the subject
 * and anything later is detail. The keyword list order breaks ties only.
 *
 * @param {string} text
 * @returns {{needle: string, area: string, at: number}|null}
 */
function matchArea(text) {
  const haystack = (text ?? "").toLowerCase();
  if (!haystack) return null;
  let best = null;
  for (const [needle, area] of AREA_KEYWORDS) {
    const at = haystack.indexOf(needle);
    // Strictly-less-than, and the list is walked in order, so an earlier keyword wins a tie.
    if (at !== -1 && (best === null || at < best.at)) best = { needle, area, at };
  }
  return best;
}

/**
 * Single-scope derivation, for text that has no title/body split (a TASK_LOG heading, a bare
 * defect title).
 *
 * @param {string} text
 * @param {string} basis
 * @returns {Provenance}
 */
export function deriveArea(text, basis = "title") {
  const hit = matchArea(text);
  if (!hit) return { value: null, confidence: "derived", basis: `no keyword matched in ${basis}` };
  return { value: hit.area, confidence: "derived", basis: `matched "${hit.needle}" in ${basis}` };
}

/**
 * Two-scope derivation: the primary scope decides whenever it matches at all, and the secondary is
 * consulted only when the primary is silent.
 *
 * Concatenating the two and scanning once — what this used to do — lets an incidental word in a
 * long body outrank the subject of the title. Measured examples from this repository: a Settings
 * coverage issue filed under Recorder because its body cited `verify:recorder-gui`, and all four
 * Test Lab issues scattered across Reports, Licensing and Security because their bodies mention
 * those words. The body is real evidence, but it is weaker evidence, and the ranking must say so.
 *
 * @param {string} primary
 * @param {string} secondary
 * @param {string} primaryLabel
 * @param {string} secondaryLabel
 * @returns {Provenance}
 */
export function deriveAreaWeighted(primary, secondary, primaryLabel, secondaryLabel) {
  const fromPrimary = matchArea(primary);
  if (fromPrimary) {
    return {
      value: fromPrimary.area,
      confidence: "derived",
      basis: `matched "${fromPrimary.needle}" in ${primaryLabel}`
    };
  }
  const fromSecondary = matchArea(secondary);
  if (fromSecondary) {
    return {
      value: fromSecondary.area,
      confidence: "derived",
      basis: `matched "${fromSecondary.needle}" in ${secondaryLabel} (no keyword in ${primaryLabel})`
    };
  }
  return {
    value: null,
    confidence: "derived",
    basis: `no keyword matched in ${primaryLabel} or ${secondaryLabel}`
  };
}

/**
 * @param {string|null} type
 * @returns {number}
 */
export function typeRank(type) {
  return TYPE_RANK[type ?? ""] ?? 5;
}

/**
 * Beads -> WorkItem. Only `blocks` edges become dependencies; parent-child and discovered-from
 * are relationships, not scheduling constraints, and folding them in would fabricate an order.
 *
 * @param {import("./parse-beads.mjs").Bead[]} beads
 * @returns {WorkItem[]}
 */
export function normalizeBeads(beads) {
  const byId = new Map(beads.map((b) => [b.id, b]));

  return beads.map((b) => {
    const dependsOn = b.edges.filter((e) => e.type === "blocks").map((e) => `bead:${e.to}`);

    /** @type {WorkItem["related"]} */
    const related = [];
    for (const e of b.edges) {
      if (e.type === "blocks") continue;
      related.push({
        id: byId.has(e.to) ? `bead:${e.to}` : null,
        unresolvedText: byId.has(e.to) ? undefined : e.to,
        relation: e.type,
        basis: "declared dependency edge in .beads/issues.jsonl",
        confidence: byId.has(e.to) ? "declared" : "dangling"
      });
    }

    return {
      id: `bead:${b.id}`,
      nativeId: b.id,
      kind: "issue",
      title: b.title,
      status: b.status === "closed" ? "done" : "open",
      rawStatus: b.status,
      priority: b.priority,
      rawPriority: b.priority === null ? null : `P${b.priority}`,
      type: b.issueType,
      area: deriveAreaWeighted(b.title, b.description, "title", "description"),
      dependsOn,
      blocks: [],
      related,
      evidence: [],
      source: { file: ".beads/issues.jsonl", line: b.lineNumber, sourceId: "beads" },
      updatedAt: b.updatedAt,
      body: b.description,
      flags: {}
    };
  });
}

/**
 * Ledger cases -> WorkItem. The layer field is a DECLARED area, unlike everything else here,
 * so it carries confidence "declared".
 *
 * @param {import("./parse-ledger.mjs").LedgerCase[]} cases
 * @returns {WorkItem[]}
 */
export function normalizeCases(cases) {
  return cases.map((c) => ({
    id: `case:${c.id}`,
    nativeId: c.id,
    kind: "case",
    title: c.title,
    status: caseStatus(c.status),
    rawStatus: c.status,
    priority: c.priority ? Number(c.priority.slice(1)) : null,
    rawPriority: c.priority,
    type: null,
    area: c.layer
      ? { value: c.layer, confidence: "declared", basis: "Priority / layer field" }
      : { value: null, confidence: "derived", basis: "no layer declared" },
    dependsOn: [],
    blocks: [],
    related: [],
    evidence: c.statusNote ? [c.statusNote] : [],
    source: {
      file: "docs/testing/comprehensive-validation/RECORDER_REPORTS_SETTINGS_TEST_CASES.md",
      line: c.line,
      sourceId: "ledger"
    },
    updatedAt: null,
    body: [c.preconditions, c.steps, c.expected].filter(Boolean).join("\n\n"),
    flags: {}
  }));
}

/**
 * Defects -> WorkItem. `detectedBy` tokens stay raw here; link.mjs resolves them against the
 * ledger and preserves the ones that do not resolve.
 *
 * @param {import("./parse-defects.mjs").Defect[]} defects
 * @returns {WorkItem[]}
 */
export function normalizeDefects(defects) {
  return defects.map((d) => ({
    id: `defect:${d.id}`,
    nativeId: d.id,
    kind: "defect",
    title: d.title,
    status: d.resolved ? "done" : "open",
    rawStatus: d.status || (d.resolved ? "Resolved" : "Open"),
    priority: severityToPriority(d.severity),
    rawPriority: d.severity,
    type: "bug",
    // For a defect the affected files are the most direct evidence of area — a title like
    // "a control that did nothing" names nothing, while its file list names the engine. So the
    // affected area leads here and the title is the fallback, the reverse of a bead.
    area: d.affectedArea
      ? deriveAreaWeighted(d.affectedArea, d.title, "affected area", "title")
      : deriveArea(d.title, "title"),
    dependsOn: [],
    blocks: [],
    related: [],
    evidence: [d.evidenceBefore, d.evidenceAfter].filter(Boolean),
    source: {
      file: "docs/testing/comprehensive-validation/DEFECTS.md",
      line: d.line,
      sourceId: "defects"
    },
    updatedAt: null,
    body: d.affectedArea,
    flags: { section: d.section, detectedByRaw: d.detectedBy }
  }));
}

/**
 * Roadmap phases -> WorkItem.
 *
 * Phases are deliberately given NO dependsOn edges. No source links a phase to an issue, and the
 * alphabetical order of A-K is a naming convention, not a declared prerequisite chain. Inferring
 * "B depends on A" would be invention.
 *
 * @param {import("./parse-roadmap-phases.mjs").RoadmapPhase[]} phases
 * @param {number} mtimeMs
 * @returns {WorkItem[]}
 */
export function normalizePhases(phases, mtimeMs) {
  return phases.map((p, idx) => ({
    id: `phase:${p.id}`,
    nativeId: p.id,
    kind: "phase",
    title: p.title,
    status: phaseStatus(p.status),
    rawStatus: p.status,
    priority: null,
    rawPriority: null,
    type: null,
    area: { value: null, confidence: "derived", basis: "phases are not area-scoped" },
    dependsOn: [],
    blocks: [],
    related: [],
    evidence: p.acceptance ? [p.acceptance] : [],
    source: { file: "src/roadmap/ImplementationRoadmap.ts", line: idx + 1, sourceId: "phases" },
    updatedAt: mtimeMs ? new Date(mtimeMs).toISOString() : null,
    body: p.implementationNote,
    flags: { deliverables: p.deliverables, acceptance: p.acceptance }
  }));
}

/**
 * @param {string} status
 * @returns {string}
 */
function caseStatus(status) {
  switch (status) {
    case "PASS":
      return "done";
    case "FAIL":
      return "open";
    case "BLOCKED":
      return "blocked";
    case "NOT RUN":
      return "not-run";
    case "NOT APPLICABLE":
      return "not-applicable";
    default:
      return "unknown";
  }
}

/**
 * @param {string} status
 * @returns {string}
 */
function phaseStatus(status) {
  switch (status) {
    case "complete":
      return "done";
    case "in-progress":
      return "active";
    case "blocked":
      return "blocked";
    case "pending":
      return "open";
    default:
      return "unknown";
  }
}

/**
 * Severity maps onto the same 0-3 scale as bead priority so one sort comparator serves both.
 * S1 is the most severe.
 *
 * @param {string|null} severity
 * @returns {number|null}
 */
function severityToPriority(severity) {
  if (!severity) return null;
  const n = Number(severity.slice(1));
  return Number.isFinite(n) ? n : null;
}
