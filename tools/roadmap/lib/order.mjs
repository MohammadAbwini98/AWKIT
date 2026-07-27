/**
 * Compute a suggested implementation order over the OPEN work items.
 *
 * What this is: a layered topological sort over the `blocks` edges declared in .beads/, with
 * priority as the tiebreak. It answers exactly one question — given only what somebody actually
 * wrote down, what can be started without waiting?
 *
 * What this is not: a plan. It knows nothing about effort, business value, or who is free, and it
 * cannot see a dependency nobody recorded. Today only 5 of the 30 open issues declare a `blocks`
 * edge at all, so most of the order is priority-sort. `caveat` below carries that number, computed
 * live, so the UI states the limitation using the current data rather than a hardcoded claim that
 * would rot the moment edges are added.
 *
 * Determinism matters: the final tiebreak is the id, so two runs over identical input produce a
 * byte-identical ranking. The verifier asserts this.
 */

import { typeRank } from "./normalize.mjs";

/**
 * @typedef {Object} OrderedItem
 * @property {string} id
 * @property {number|null} rank        1-based; null for members of a dependency cycle
 * @property {number} layer            earliest round it could start in; -1 for cycle members
 * @property {"ready"|"blocked"|"cycle"} state
 * @property {string[]} openBlockers   ids of prerequisites that are still open
 * @property {string[]} doneBlockers   ids of prerequisites already satisfied
 * @property {number} unblocks         how many open items list this one as a prerequisite
 */

/**
 * @param {import("./normalize.mjs").WorkItem[]} items
 * @returns {{
 *   ordered: OrderedItem[],
 *   layers: {layer: number, ids: string[]}[],
 *   cycles: {ids: string[], edges: {from: string, to: string}[]}[],
 *   caveat: {openTotal: number, withDeclaredDeps: number, withoutDeclaredDeps: number, percentWithout: number},
 *   stats: Record<string, number>
 * }}
 */
export function computeOrder(items) {
  const byId = new Map(items.map((i) => [i.id, i]));

  // Epics are containers, not work. awkit-wza is the Randomized Test Lab epic; ranking it beside
  // its own children would double-count and put a non-actionable row in the queue.
  const queue = items.filter((i) => i.status === "open" && i.kind === "issue" && i.type !== "epic");
  const queueIds = new Set(queue.map((i) => i.id));

  /** @type {Map<string, {open: string[], done: string[]}>} */
  const blockers = new Map();
  for (const item of queue) {
    /** @type {string[]} */
    const open = [];
    /** @type {string[]} */
    const done = [];
    for (const dep of item.dependsOn) {
      const target = byId.get(dep);
      if (!target) {
        // Fail closed. A prerequisite we cannot see may or may not be satisfied, and assuming
        // "satisfied" would mark an item ready on the strength of a missing record.
        open.push(dep);
        continue;
      }
      if (target.status === "done") done.push(dep);
      else if (queueIds.has(dep)) open.push(dep);
      else done.push(dep); // closed, or excluded from the queue (an epic): not a wait state
    }
    blockers.set(item.id, { open, done });
  }

  /** how many queued items are waiting on each id */
  /** @type {Map<string, number>} */
  const unblocks = new Map();
  for (const item of queue) {
    for (const dep of blockers.get(item.id)?.open ?? []) {
      unblocks.set(dep, (unblocks.get(dep) ?? 0) + 1);
    }
  }

  // Kahn layering: L0 is everything with no open prerequisite; remove it, recompute, repeat.
  /** @type {Set<string>} */
  const settled = new Set();
  /** @type {{layer: number, ids: string[]}[]} */
  const layers = [];

  let layerIndex = 0;
  for (;;) {
    const ready = queue
      .filter((i) => !settled.has(i.id))
      .filter((i) => (blockers.get(i.id)?.open ?? []).every((d) => settled.has(d)));

    if (ready.length === 0) break;

    const ids = ready.map((i) => i.id).sort(comparator(byId, unblocks));
    layers.push({ layer: layerIndex, ids });
    for (const id of ids) settled.add(id);
    layerIndex += 1;
  }

  // Whatever Kahn could not drain is in a cycle. Zero instances today; the branch exists because
  // a guard that cannot fire is decoration, and the verifier proves it against a synthetic cycle.
  const residue = queue.filter((i) => !settled.has(i.id)).map((i) => i.id);
  const cycles = findCycles(residue, blockers);

  /** @type {OrderedItem[]} */
  const ordered = [];
  let rank = 1;
  for (const layer of layers) {
    for (const id of layer.ids) {
      const b = blockers.get(id) ?? { open: [], done: [] };
      ordered.push({
        id,
        rank: rank++,
        layer: layer.layer,
        state: b.open.length === 0 ? "ready" : "blocked",
        openBlockers: b.open,
        doneBlockers: b.done,
        unblocks: unblocks.get(id) ?? 0
      });
    }
  }
  for (const cycle of cycles) {
    for (const id of cycle.ids) {
      const b = blockers.get(id) ?? { open: [], done: [] };
      ordered.push({
        id,
        rank: null,
        layer: -1,
        state: "cycle",
        openBlockers: b.open,
        doneBlockers: b.done,
        unblocks: unblocks.get(id) ?? 0
      });
    }
  }

  const withDeps = queue.filter((i) => i.dependsOn.length > 0).length;
  const caveat = {
    openTotal: queue.length,
    withDeclaredDeps: withDeps,
    withoutDeclaredDeps: queue.length - withDeps,
    percentWithout: queue.length === 0 ? 0 : Math.round(((queue.length - withDeps) / queue.length) * 100)
  };

  return {
    ordered,
    layers,
    cycles,
    caveat,
    stats: {
      queued: queue.length,
      ranked: ordered.filter((o) => o.rank !== null).length,
      ready: ordered.filter((o) => o.state === "ready").length,
      blocked: ordered.filter((o) => o.state === "blocked").length,
      inCycle: ordered.filter((o) => o.state === "cycle").length,
      layers: layers.length,
      cycles: cycles.length
    }
  };
}

/**
 * Within-layer ordering. Every term is a real signal; the final id term exists purely to make the
 * result a total order, so ranking is reproducible byte-for-byte.
 *
 * @param {Map<string, import("./normalize.mjs").WorkItem>} byId
 * @param {Map<string, number>} unblocks
 */
function comparator(byId, unblocks) {
  return (aId, bId) => {
    const a = byId.get(aId);
    const b = byId.get(bId);
    if (!a || !b) return aId.localeCompare(bId);

    // 1. priority — P0 first. Unprioritised sorts last rather than pretending to be urgent.
    const pa = a.priority ?? 99;
    const pb = b.priority ?? 99;
    if (pa !== pb) return pa - pb;

    // 2. a bug is a regression of shipped behaviour; it outranks new work at equal priority.
    const ta = typeRank(a.type);
    const tb = typeRank(b.type);
    if (ta !== tb) return ta - tb;

    // 3. group by area so consecutive items share context.
    const aa = a.area.value ?? "￿";
    const ab = b.area.value ?? "￿";
    if (aa !== ab) return aa.localeCompare(ab);

    // 4. unblock more work sooner.
    const ua = unblocks.get(aId) ?? 0;
    const ub = unblocks.get(bId) ?? 0;
    if (ua !== ub) return ub - ua;

    // 5. most recently touched first.
    const da = a.updatedAt ?? "";
    const db = b.updatedAt ?? "";
    if (da !== db) return db.localeCompare(da);

    // 6. total order, so the ranking is deterministic.
    return aId.localeCompare(bId);
  };
}

/**
 * Tarjan strongly-connected components over the Kahn residue. Any component of size > 1 is a
 * genuine cycle; a self-edge counts too.
 *
 * @param {string[]} ids
 * @param {Map<string, {open: string[], done: string[]}>} blockers
 * @returns {{ids: string[], edges: {from: string, to: string}[]}[]}
 */
function findCycles(ids, blockers) {
  const inResidue = new Set(ids);
  /** @type {Map<string, number>} */
  const index = new Map();
  /** @type {Map<string, number>} */
  const low = new Map();
  /** @type {Set<string>} */
  const onStack = new Set();
  /** @type {string[]} */
  const stack = [];
  let counter = 0;
  /** @type {string[][]} */
  const components = [];

  /** @param {string} v */
  const strongConnect = (v) => {
    index.set(v, counter);
    low.set(v, counter);
    counter += 1;
    stack.push(v);
    onStack.add(v);

    for (const w of (blockers.get(v)?.open ?? []).filter((d) => inResidue.has(d))) {
      if (!index.has(w)) {
        strongConnect(w);
        low.set(v, Math.min(low.get(v) ?? 0, low.get(w) ?? 0));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v) ?? 0, index.get(w) ?? 0));
      }
    }

    if (low.get(v) === index.get(v)) {
      /** @type {string[]} */
      const component = [];
      for (;;) {
        const w = stack.pop();
        if (w === undefined) break;
        onStack.delete(w);
        component.push(w);
        if (w === v) break;
      }
      components.push(component);
    }
  };

  for (const id of ids) {
    if (!index.has(id)) strongConnect(id);
  }

  return components
    .filter((c) => c.length > 1 || (blockers.get(c[0])?.open ?? []).includes(c[0]))
    .map((c) => {
      const members = [...c].sort();
      const memberSet = new Set(members);
      /** @type {{from: string, to: string}[]} */
      const edges = [];
      for (const from of members) {
        for (const to of blockers.get(from)?.open ?? []) {
          if (memberSet.has(to)) edges.push({ from, to });
        }
      }
      return { ids: members, edges };
    })
    .sort((a, b) => a.ids[0].localeCompare(b.ids[0]));
}
