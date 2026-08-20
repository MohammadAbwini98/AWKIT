/**
 * The router — the only place a classification becomes a set of agents.
 *
 * Determinism here means something narrow and testable: identical input produces byte-identical
 * output, with no reliance on iteration order, wall-clock time, or the filesystem. Every list this
 * module returns is sorted by an explicit rule, never by the order rules happen to be declared in.
 *
 * The router does NOT pick a single writer for a multi-domain task. It returns the ordered sequence
 * of writers implied by WRITER_PRECEDENCE, because one-writer-at-a-time makes a multi-domain task a
 * sequence of leases rather than a committee. The contract then names the ONE writer holding the
 * lease right now, and `validate-contract.mjs` checks that the name is a member of this sequence.
 */

import {
  ACTIVATION_RULES,
  AGENT_IDS,
  WRITER_PRECEDENCE,
  agent,
  domainForPath,
  pathInScope,
  riskLevelFor
} from "./routing-matrix.mjs";

/**
 * @typedef {Object} RoutingResult
 * @property {0|1|2|3} riskLevel
 * @property {string[]} activated        every agent id this task requires, sorted canonically
 * @property {string[]} writerSequence   agents that will hold a lease, in lease order
 * @property {boolean} writerSequenceNarrowed  true when the sequence was restricted to path owners;
 *   false means it is the unnarrowed activated-writer list, used as the fail-closed fallback
 * @property {string[]} consultants      activated agents that advise but hold no lease here
 * @property {string[]} reviewers        qa/qc subset that is active
 * @property {{agent: string, why: string, trigger: string}[]} rationale
 */

/**
 * Sort agent ids into the registry's own order, so output never depends on Set insertion order.
 * @param {Iterable<string>} ids
 * @returns {string[]}
 */
function canonicalOrder(ids) {
  const wanted = new Set(ids);
  return AGENT_IDS.filter((id) => wanted.has(id));
}

/**
 * Route a classification to the specialists it requires.
 *
 * @param {Record<string, boolean|number>} classification  normalized declared classification
 * @param {Object} [options]
 * @param {readonly string[]} [options.expectedPaths] paths the task is expected to touch
 * @param {"inspect"|"change"} [options.taskMode] explicit intent; inspection never receives a writer
 * @returns {RoutingResult}
 */
export function route(classification, { expectedPaths = [], taskMode = "change" } = {}) {
  const riskLevel = riskLevelFor(classification);
  const crossLayer = Number(classification.cross_layer_count ?? 1);

  /** @type {Set<string>} */
  const activated = new Set(["manager"]);
  /** @type {{agent: string, why: string, trigger: string}[]} */
  const rationale = [
    { agent: "manager", why: "Every task has exactly one orchestrator.", trigger: "always" }
  ];

  // Ownership activates the responsible role for EVERY mapped expected path. Encoding this only on
  // selected activation rules left Risk-0 tests/** and governance paths without an eligible writer.
  for (const expectedPath of expectedPaths) {
    const domain = domainForPath(expectedPath);
    if (!domain || activated.has(domain.owner)) continue;
    activated.add(domain.owner);
    rationale.push({
      agent: domain.owner,
      why: `Owns ${domain.glob}.`,
      trigger: `expected path ${expectedPath}`
    });
  }

  for (const rule of ACTIVATION_RULES) {
    /** @type {string|null} */
    let trigger = null;

    const flagHit = rule.anyFlag.find((flag) => classification[flag] === true);
    if (flagHit) trigger = `flag ${flagHit}`;

    if (!trigger && typeof rule.minRisk === "number" && riskLevel >= rule.minRisk) {
      trigger = `risk_level ${riskLevel} >= ${rule.minRisk}`;
    }

    if (!trigger && typeof rule.minCrossLayer === "number" && crossLayer >= rule.minCrossLayer) {
      trigger = `cross_layer_count ${crossLayer} >= ${rule.minCrossLayer}`;
    }

    if (!trigger && rule.onOwnedPath === true) {
      const owned = agent(rule.agent).ownsPaths;
      const hit = expectedPaths.find((path) => pathInScope(path, owned));
      if (hit) trigger = `expected path ${hit}`;
    }

    if (trigger && !activated.has(rule.agent)) {
      activated.add(rule.agent);
      rationale.push({ agent: rule.agent, why: rule.why, trigger });
    }
  }

  const activatedIds = canonicalOrder(activated);

  /* ── Who actually takes a lease ────────────────────────────────────────────────────────────
     An agent can be activated by a FLAG while owning none of the task's paths. Running awkit-4qs
     through this router produced exactly that: `filesystem_write_change` activated persistence,
     which then led the writer sequence for a task whose only file was `app/main/uiSettings.ts` —
     runtime's. Persistence had a real reason to be involved and nothing whatsoever to write.

     So the sequence is narrowed to activated writers that own at least one expected path, and the
     rest are reclassified as consultants, which is what they were.

     The fallback matters more than the narrowing. `validate-contract.mjs` derives
     "does this task change product code?" from `writerSequence.length > 0`, so a narrowing that
     could empty the list would stop requiring a writer at all — the check would fail OPEN on
     precisely the tasks where paths are unmapped or mis-declared. When the intersection is empty,
     or when no paths were declared at all, the full activated-writer list is used instead. Both
     fallbacks err toward requiring MORE review, never less. */
  const activatedWriters = WRITER_PRECEDENCE.filter(
    (id) => activated.has(id) && agent(id).defaultMode === "writer"
  );
  const owningWriters = activatedWriters.filter((id) =>
    expectedPaths.some((path) => pathInScope(path, agent(id).ownsPaths))
  );
  const narrowed = expectedPaths.length > 0 && owningWriters.length > 0;
  const changeWriterSequence = narrowed ? owningWriters : activatedWriters;
  const writerSequence = taskMode === "inspect" ? [] : changeWriterSequence;

  const consultants = activatedIds.filter((id) => {
    if (id === "qc" || id === "manager") return false;
    const mode = agent(id).defaultMode;
    if (mode === "read-only" || mode === "review") return true;
    // A writer-mode agent activated for this task that owns none of its paths advises here.
    return narrowed && !writerSequence.includes(id) && id !== "qa";
  });
  const reviewers = activatedIds.filter((id) => id === "qa" || id === "qc");

  rationale.sort((a, b) => AGENT_IDS.indexOf(a.agent) - AGENT_IDS.indexOf(b.agent));

  return {
    riskLevel,
    taskMode,
    expectedPaths: [...expectedPaths],
    activated: activatedIds,
    writerSequence,
    writerSequenceNarrowed: narrowed,
    consultants,
    reviewers,
    rationale
  };
}

/**
 * The lease scope a given writer is permitted for this task: the intersection of what the agent
 * owns and what the task expects to touch.
 *
 * Intersecting rather than handing over the agent's whole ownership matters. A frontend task that
 * touches two components should not receive a lease over all of `app/renderer/**` — a lease is a
 * budget, and the narrowest correct one is what makes an amendment (and its re-routing) happen at
 * the moment scope actually grows.
 *
 * @param {string} agentId
 * @param {readonly string[]} expectedPaths
 * @returns {{allowed: string[], forbidden: string[]}}
 */
export function leaseScopeFor(agentId, expectedPaths) {
  const owned = agent(agentId).ownsPaths;
  const allowed = expectedPaths.filter((path) => pathInScope(path, owned));

  const forbidden = AGENT_IDS.filter((id) => id !== agentId)
    .flatMap((id) => agent(id).ownsPaths)
    .filter((glob) => !owned.includes(glob));

  return {
    allowed: [...new Set(allowed.length > 0 ? allowed : owned)].sort(),
    forbidden: [...new Set(forbidden)].sort()
  };
}
