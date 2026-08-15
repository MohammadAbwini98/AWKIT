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
  pathInScope,
  riskLevelFor
} from "./routing-matrix.mjs";

/**
 * @typedef {Object} RoutingResult
 * @property {0|1|2|3} riskLevel
 * @property {string[]} activated        every agent id this task requires, sorted canonically
 * @property {string[]} writerSequence   writer-capable agents in lease order
 * @property {string[]} consultants      activated read-only/review agents
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
 * @param {readonly string[]} [options.expectedPaths]  paths the task is expected to touch; these
 *   activate an agent through `onOwnedPath` even when no flag names its domain.
 * @returns {RoutingResult}
 */
export function route(classification, { expectedPaths = [] } = {}) {
  const riskLevel = riskLevelFor(classification);
  const crossLayer = Number(classification.cross_layer_count ?? 1);

  /** @type {Set<string>} */
  const activated = new Set(["manager"]);
  /** @type {{agent: string, why: string, trigger: string}[]} */
  const rationale = [
    { agent: "manager", why: "Every task has exactly one orchestrator.", trigger: "always" }
  ];

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

    if (trigger) {
      activated.add(rule.agent);
      rationale.push({ agent: rule.agent, why: rule.why, trigger });
    }
  }

  const activatedIds = canonicalOrder(activated);
  const writerSequence = WRITER_PRECEDENCE.filter(
    (id) => activated.has(id) && agent(id).defaultMode === "writer"
  );
  const consultants = activatedIds.filter((id) => {
    const mode = agent(id).defaultMode;
    return (mode === "read-only" || mode === "review") && id !== "qc";
  });
  const reviewers = activatedIds.filter((id) => id === "qa" || id === "qc");

  rationale.sort((a, b) => AGENT_IDS.indexOf(a.agent) - AGENT_IDS.indexOf(b.agent));

  return { riskLevel, activated: activatedIds, writerSequence, consultants, reviewers, rationale };
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
