/**
 * Dependency view — CSS grid lanes with an SVG edge overlay.
 *
 * Designed for the shape of the data rather than for a graph library's demo. The measured open
 * dependency graph is almost empty: 24 of 29 queued issues declare no dependencies at all, and the
 * entire connected portion is one Test Lab chain. A force-directed canvas would render 24 floating
 * dots and one thread, and would imply a richness the repository does not have.
 *
 * So: nodes are laid out by CSS grid (column = scheduling layer) in normal flow, needing no
 * measurement to position. A single absolutely-positioned <svg> then measures the placed nodes once
 * per frame and draws the curves between them. Orphans never enter the graph — they get their own
 * explicitly-counted section, because "has no dependencies" is a fact worth stating, not an absence
 * worth hiding.
 */

import { clear, el, frag, svgEl } from "./dom.js";
import { iconSpan } from "./icons.js";

/**
 * @param {{snap: Record<string, any>, byId: Map<string, any>, onDispose: (fn: () => void) => void}} ctx
 * @returns {DocumentFragment}
 */
export function renderDependencies(ctx) {
  const { snap, byId } = ctx;
  const ordered = snap.order.ordered;
  const orderById = new Map(ordered.map((o) => [o.id, o]));

  const edges = [];
  for (const entry of ordered) {
    for (const from of entry.openBlockers) edges.push({ from, to: entry.id, ghost: false });
    for (const from of entry.doneBlockers) edges.push({ from, to: entry.id, ghost: true });
  }

  const components = groupComponents(edges);
  const connectedIds = new Set(edges.flatMap((e) => [e.from, e.to]));
  const orphans = ordered.filter((o) => !connectedIds.has(o.id));

  return frag([
    el("section", { class: "work-panel" }, [
      el("div", { class: "section-heading" }, [
        el("h1", { text: "Dependency chains" }),
        el("span", {
          text: `${components.length} connected ${components.length === 1 ? "chain" : "chains"} · ${edges.length} edges`
        })
      ]),
      el("p", { class: "rm-panel-note" }, [
        "Only edges declared as ",
        el("code", { text: "blocks" }),
        ` in .beads/issues.jsonl appear here. Prerequisites that are already closed are drawn as
         dashed ghost nodes — without them a chain appears to begin from nowhere. Nothing on this
         page is inferred from prose.`
      ]),
      components.length === 0
        ? el("p", { class: "rm-empty", text: "No open issue declares a dependency on another." })
        : frag(components.map((component) => renderComponent(component, orderById, byId, ctx)))
    ]),

    el("section", { class: "work-panel" }, [
      el("div", { class: "section-heading" }, [
        el("h1", { text: `No declared dependencies (${orphans.length})` }),
        el("span", { text: "ordered by priority alone" })
      ]),
      el("p", { class: "rm-panel-note" }, [
        `These issues carry no dependency edge in either direction. They are not blocked and they
         block nothing — so their relative order is a priority sort, not a schedule. They are listed
         apart from the graph deliberately: drawing them as isolated dots would suggest the graph
         knows something about them that it does not.`
      ]),
      el(
        "div",
        { class: "rm-orphans" },
        orphans.map((entry) => {
          const item = byId.get(entry.id);
          return el("article", { class: "rm-node" }, [
            el("span", { class: "rm-node-title", text: item?.title ?? entry.id }),
            el("span", { class: "rm-id", text: item?.nativeId ?? entry.id })
          ]);
        })
      )
    ]),

    renderInferred(snap, byId),
    renderUnresolved(snap)
  ]);
}

/**
 * Union-find over the declared edges. Each component is rendered as its own card, so an unrelated
 * chain appearing later never reflows an existing one.
 */
function groupComponents(edges) {
  /** @type {Map<string, string>} */
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(x) !== root) {
      const next = parent.get(x);
      parent.set(x, root);
      x = next;
    }
    return root;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const edge of edges) union(edge.from, edge.to);

  /** @type {Map<string, {ids: Set<string>, edges: typeof edges}>} */
  const groups = new Map();
  for (const edge of edges) {
    const root = find(edge.from);
    const group = groups.get(root) ?? { ids: new Set(), edges: [] };
    group.ids.add(edge.from);
    group.ids.add(edge.to);
    group.edges.push(edge);
    groups.set(root, group);
  }
  // Largest first, then by first id — a total order, so the page does not reshuffle between renders.
  return [...groups.values()].sort(
    (a, b) => b.ids.size - a.ids.size || [...a.ids][0].localeCompare([...b.ids][0])
  );
}

function renderComponent(component, orderById, byId, ctx) {
  /**
   * Lane 0 is reserved for already-satisfied prerequisites; queued work sits at `layer + 1`.
   * Putting every ghost in one lane keeps the lane labels honest — a closed issue has no
   * scheduling layer, so inventing one for it would be a claim the data does not support.
   */
  const laneOf = (id) => {
    const entry = orderById.get(id);
    return entry ? entry.layer + 1 : 0;
  };

  const lanes = new Map();
  for (const id of component.ids) {
    const lane = laneOf(id);
    if (!lanes.has(lane)) lanes.set(lane, []);
    lanes.get(lane).push(id);
  }
  const laneKeys = [...lanes.keys()].sort((a, b) => a - b);

  /** @type {Map<string, HTMLElement>} */
  const nodeEls = new Map();

  const lanesEl = el(
    "div",
    { class: "rm-graph-lanes" },
    laneKeys.map((lane) =>
      el("div", { class: "rm-graph-lane" }, [
        el("span", { class: "rm-graph-lane-label", text: laneLabel(lane) }),
        ...lanes
          .get(lane)
          .sort((a, b) => (orderById.get(a)?.rank ?? 0) - (orderById.get(b)?.rank ?? 0) || a.localeCompare(b))
          .map((id) => {
            const entry = orderById.get(id);
            const item = byId.get(id);
            const ghost = !entry;
            const node = el(
              "article",
              {
                class: `rm-node${ghost ? " rm-node-ghost" : entry.state === "ready" ? " rm-node-ready" : ""}`,
                title: item?.title ?? id
              },
              [
                el("span", { class: "rm-node-title", text: item?.title ?? id }),
                el("span", { class: "rm-queue-meta" }, [
                  el("span", { class: "rm-id", text: item?.nativeId ?? id }),
                  ghost
                    ? el("span", { class: "rm-badge rm-badge-done", text: "done" })
                    : el("span", {
                        class: `rm-badge rm-badge-${entry.state}`,
                        text: entry.state === "ready" ? "ready" : "blocked"
                      }),
                  !ghost && entry.unblocks > 0
                    ? el("span", { class: "rm-chip", text: `unblocks ${entry.unblocks}` })
                    : null
                ])
              ]
            );
            nodeEls.set(id, node);
            return node;
          })
      ])
    )
  );

  const svg = svgEl("svg", { class: "rm-graph-edges", "aria-hidden": "true" });
  lanesEl.appendChild(svg);

  const card = el("div", { class: "rm-graph-card" }, [lanesEl]);
  scheduleEdgeDraw(card, lanesEl, svg, component.edges, nodeEls, ctx);
  return card;
}

function laneLabel(lane) {
  if (lane === 0) return "Satisfied prerequisites";
  if (lane === 1) return "Ready now (L0)";
  return `After L${lane - 2} (L${lane - 1})`;
}

/**
 * Draw the edges once the nodes have been laid out, and again whenever the container resizes.
 * Layout is never read during construction — only after the browser has placed the grid.
 */
function scheduleEdgeDraw(card, lanesEl, svg, edges, nodeEls, ctx) {
  let frameHandle = 0;
  const draw = () => {
    frameHandle = 0;
    const box = lanesEl.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    clear(svg);
    svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);

    for (const edge of edges) {
      const from = nodeEls.get(edge.from);
      const to = nodeEls.get(edge.to);
      if (!from || !to) continue;
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      const x1 = a.right - box.left;
      const y1 = a.top + a.height / 2 - box.top;
      const x2 = b.left - box.left;
      const y2 = b.top + b.height / 2 - box.top;
      // Clamped to half the gap so the two control points never cross each other: a flat minimum
      // larger than the available span inverts the curve and it bulges backwards.
      const dx = Math.max(12, Math.min((x2 - x1) / 2, 60));
      svg.appendChild(
        svgEl("path", {
          d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
          "stroke-dasharray": edge.ghost ? "4 3" : null
        })
      );
    }
  };

  const request = () => {
    if (frameHandle) return;
    frameHandle = requestAnimationFrame(draw);
  };

  // Draw once, synchronously, as soon as the card is in the document. requestAnimationFrame is not
  // guaranteed to run — a background or non-compositing tab can starve it indefinitely — and an
  // edge overlay that never appears would look exactly like a graph with no edges. rAF is kept
  // below purely to coalesce redraws, where dropping a frame is harmless.
  ctx.onMount(draw);
  const observer = new ResizeObserver(request);
  observer.observe(lanesEl);
  ctx.onDispose(() => {
    observer.disconnect();
    if (frameHandle) cancelAnimationFrame(frameHandle);
  });
  // Fonts can settle after first paint and shift every node by a pixel or two.
  if (document.fonts?.ready) document.fonts.ready.then(request).catch(() => {});
}

/**
 * Links recovered by scanning prose. Kept in a visually separate, dashed strip and never merged
 * into the graph above: a title that happens to name a case ID is a mention, not a dependency.
 */
function renderInferred(snap, byId) {
  const inferred = snap.links.links.filter((l) => l.confidence === "inferred" && l.to);
  if (inferred.length === 0) return null;

  const byFrom = new Map();
  for (const link of inferred) {
    if (!byFrom.has(link.from)) byFrom.set(link.from, []);
    byFrom.get(link.from).push(link);
  }

  return el("section", { class: "work-panel" }, [
    el("div", { class: "section-heading" }, [
      el("h1", { text: "Text mentions (inferred)" }),
      el("span", { text: `${inferred.length} references across ${byFrom.size} records` })
    ]),
    el("p", { class: "rm-panel-note" }, [
      `Recovered by scanning issue titles and bodies for case and defect IDs. These are references,
       not dependencies — they carry no scheduling meaning and are excluded from ordering.`
    ]),
    el(
      "div",
      { class: "rm-inferred-strip" },
      [
        el("h4", { text: "mentioned in text" }),
        el(
          "div",
          { class: "rm-stack" },
          [...byFrom.entries()].map(([from, links]) =>
            el("p", { class: "rm-queue-meta" }, [
              el("span", { class: "rm-id", text: byId.get(from)?.nativeId ?? from }),
              el("span", { text: byId.get(from)?.title ?? "" }),
              ...links.map((l) =>
                el("span", { class: "rm-chip", text: byId.get(l.to)?.nativeId ?? l.to })
              )
            ])
          )
        )
      ]
    )
  ]);
}

/**
 * IDs cited by a repository file that resolve to no record the dashboard can see. Rendered inert
 * rather than dropped — silently discarding a citation would hide that the join is lossy.
 */
function renderUnresolved(snap) {
  const unresolved = snap.links.unresolved;
  if (unresolved.length === 0) return null;
  return el("section", { class: "work-panel" }, [
    el("div", { class: "section-heading" }, [
      el("h1", { text: "Cited but not found" }),
      el("span", { text: `${unresolved.length} unresolved` })
    ]),
    el("p", { class: "rm-panel-note" }, [
      `A repository file cites these IDs, but no source the dashboard reads contains them. They are
       shown rather than dropped: the join is lossy, and hiding that would make the link counts
       above look more complete than they are.`
    ]),
    el(
      "div",
      { class: "rm-filters" },
      unresolved.map((entry) =>
        el("span", {
          class: "rm-chip rm-chip-dangling",
          text: entry.token,
          title: `cited by ${entry.citedBy.join(", ")} — not present in any parsed source`
        })
      )
    ),
    el("p", { class: "rm-panel-note" }, [iconSpan("link-2-off", 13), " external or renamed identifiers"])
  ]);
}
