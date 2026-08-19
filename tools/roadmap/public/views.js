/**
 * The eight views.
 *
 * This registry is imported by `app/renderer/pages/ImplementationRoadmap.tsx` to render the same
 * views INSIDE SpecterStudio, so everything reachable from here is compiled into the shipped
 * application. Anything that must not ship — the license issuer, for one — is registered by the
 * standalone shell in `dashboard.js` instead, which the application never imports.
 *
 * Two rules run through all of them, and they are the reason this dashboard can be trusted:
 *
 *   1. Declared fact and derived inference never look alike. An assignee comes only from
 *      assignments.json and renders as a solid chip; an agent name recovered from TASK_LOG renders
 *      muted, dashed, italic, and is phrased as "recent activity in <area>" — never "working on".
 *   2. Where two sources disagree, both are shown with their provenance. Nothing is reconciled,
 *      averaged, or silently preferred. A disagreement between the ledger and a bead description is
 *      a real finding about the repository, not a rendering problem to smooth over.
 */

import { formatBytes, formatDate, el, frag, plural, relativeTime } from "./dom.js";
import { icon, iconSpan } from "./icons.js";
import { renderDependencies } from "./graph.js";

/** View-local UI state. Survives a snapshot refresh so a live update never resets your filters. */
const local = {
  queueState: "all",
  issuesTab: "issues",
  issuesStatus: "open",
  validationStatus: "all"
};

/* ==========================================================================
   Shared pieces
   ========================================================================== */

/** @param {any} item @param {string} filter */
export function matchesFilter(item, filter) {
  if (!filter) return true;
  const needle = filter.toLowerCase();
  return (
    (item.nativeId ?? "").toLowerCase().includes(needle) ||
    (item.title ?? "").toLowerCase().includes(needle) ||
    (item.area?.value ?? "").toLowerCase().includes(needle) ||
    (item.type ?? "").toLowerCase().includes(needle)
  );
}

function statCard(iconName, label, value, hint) {
  return el("article", { title: hint ?? undefined }, [
    icon(iconName, 18),
    el("span", { text: label }),
    el("strong", { text: String(value) })
  ]);
}

function priorityBadge(item) {
  if (!item.rawPriority) return null;
  const key = String(item.rawPriority).toLowerCase();
  return el("span", { class: `rm-badge rm-badge-${key}`, text: item.rawPriority });
}

function areaChip(area) {
  if (!area || !area.value) {
    return el("span", {
      class: "rm-chip rm-chip-unclassified",
      text: "unclassified",
      title: "No keyword in this record's title or body matched the area table. Not guessed."
    });
  }
  return el("span", {
    class: `rm-chip rm-chip-area`,
    text: area.value,
    title: `${area.confidence}: ${area.basis}`
  });
}

/**
 * The authoritative field. Populated only by an explicit write to assignments.json — there is no
 * code path by which a derived signal can set it.
 */
function assigneeChip(item) {
  const claim = item.assignee;
  if (!claim) {
    return el("span", {
      class: "rm-assignee rm-assignee-empty",
      text: "Unclaimed",
      title: "No claim in tools/roadmap/assignments.json"
    });
  }
  const expired = claim.expired === true;
  return el("span", {
    class: `rm-assignee${expired ? " rm-assignee-expired" : ""}`,
    text: expired
      ? `${claim.agent} · claim expired`
      : `${claim.agent} · claimed ${relativeTime(claim.claimedAt)}`,
    title: `${claim.state ?? "claimed"} — assignments.json${claim.note ? ` — ${claim.note}` : ""}`
  });
}

/**
 * The derived field. Deliberately reads as an observation about an area of the codebase, not as a
 * statement about this issue: TASK_LOG records what an agent has already done, and cannot support
 * a claim about what anyone is doing now.
 */
function activityNote(item) {
  const activity = item.areaActivity;
  if (!activity) return null;
  return el("span", {
    class: "rm-activity",
    text: `recent activity in "${item.area.value}": ${activity.agent}, ${activity.date}`,
    title: `derived from docs/ai/TASK_LOG.md — ${activity.heading}`
  });
}

function subheading(title, note) {
  return el("div", { class: "rm-subhead" }, [
    el("h3", { text: title }),
    note ? el("span", { text: note }) : null
  ]);
}

function table(headers, rows) {
  return el("div", { class: "rm-table-wrap" }, [
    el("table", { class: "rm-table" }, [
      el("thead", {}, [el("tr", {}, headers.map((h) => el("th", { text: h })))]),
      el("tbody", {}, rows)
    ])
  ]);
}

function toggleRow(options, current, onPick) {
  return el(
    "div",
    { class: "rm-filters" },
    options.map(([value, label]) =>
      el("button", {
        type: "button",
        class: `rm-button${current === value ? " is-on" : ""}`,
        text: label,
        "aria-pressed": current === value ? "true" : "false",
        on: { click: () => onPick(value) }
      })
    )
  );
}

function emptyState(message) {
  return el("p", { class: "rm-empty", text: message });
}

/** Long Markdown bodies, collapsed. Rendered as text — never parsed, never injected as HTML. */
function bodyDetails(item) {
  if (!item.body) return null;
  return el("details", { class: "rm-details" }, [
    el("summary", { text: "Details" }),
    el("p", { class: "rm-body", text: item.body })
  ]);
}

/* ==========================================================================
   1 — Overview
   ========================================================================== */

function renderOverview(ctx) {
  const { snap, byId } = ctx;
  const order = snap.order.stats;
  const ledger = snap.ledger.tally;

  return frag([
    consistencyBanner(snap),

    el("section", { class: "work-panel" }, [
      el("div", { class: "section-heading" }, [
        el("h1", { text: "Program status" }),
        el("span", { text: `${snap.stats.items} records across ${snap.sources.length} sources` })
      ]),
      el("div", { class: "roadmap-summary-grid" }, [
        statCard(
          "list-checks",
          "Outstanding",
          snap.stats.beads.outstanding,
          `not closed — ${Object.keys(snap.stats.beads.byStatus)
            .filter((status) => status !== "closed")
            .map((status) => `${snap.stats.beads.byStatus[status]} ${status}`)
            .join(", ")}`
        ),
        statCard("circle-check", "Ready now", order.ready, "Zero open blockers"),
        statCard("clock", "Blocked", order.blocked, "At least one open blocker"),
        statCard("bug", "Open defects", snap.stats.defects.open, "DEFECTS.md 'Open product defects'"),
        statCard("flask-conical", "Ledger PASS", `${ledger.pass}/${ledger.total}`, "Executed and observed"),
        statCard("triangle-alert", "Not run / blocked", ledger.notRun + ledger.blocked, "Open validation surface"),
        statCard(
          "shield-check",
          "Traceability PASS",
          `${snap.traceability.stats.pass}/${snap.traceability.stats.rows}`,
          "TRACEABILITY_MATRIX.csv"
        ),
        statCard("file-text", "Verifiers classified", snap.verifiers.stats.classified, "FR-I1 registry")
      ])
    ]),

    el("section", { class: "work-panel" }, [
      el("div", { class: "section-heading" }, [
        el("h1", { text: "Next up" }),
        el("span", { text: "top of the work queue" })
      ]),
      el(
        "div",
        { class: "rm-queue" },
        snap.order.ordered.slice(0, 5).map((entry) => queueRow(entry, byId.get(entry.id), ctx))
      ),
      el("p", { class: "rm-panel-note" }, [
        "Ordering is a suggestion computed from declared dependencies and priority. ",
        el("button", {
          type: "button",
          class: "rm-button",
          text: "Open the work queue",
          on: { click: () => ctx.navigate("queue") }
        })
      ])
    ]),

    snap.warnings.length > 0
      ? el("section", { class: "work-panel" }, [
          el("div", { class: "section-heading" }, [
            el("h1", { text: "Parse warnings" }),
            el("span", { text: plural(snap.warnings.length, "warning") })
          ]),
          el("p", { class: "rm-panel-note" }, [
            `Raised while reading the repository. These describe the sources, not the dashboard —
             each one is a real irregularity in a file it parses.`
          ]),
          el(
            "ul",
            { class: "rm-banner-list" },
            snap.warnings.map((w) => el("li", { text: w }))
          )
        ])
      : null
  ]);
}

/**
 * The single most valuable check on the page: the ledger tally computed from the case file itself,
 * against every other place in the repository that asserts it. These numbers have drifted before.
 */
function consistencyBanner(snap) {
  const c = snap.consistency;
  const ok = c.agrees;
  const measured = `${c.measured.pass} PASS / ${c.measured.notRun} NOT RUN / ${c.measured.blocked} BLOCKED`;

  return el("section", { class: `rm-banner ${ok ? "rm-banner-ok" : "rm-banner-warn"}` }, [
    el("h3", {}, [
      iconSpan(ok ? "circle-check" : "triangle-alert", 15),
      ok ? " Sources agree" : " Sources disagree"
    ]),
    el("p", {
      text: ok
        ? `The ledger measures ${measured}, and all ${c.checked} other places that assert this tally match.`
        : `The ledger measures ${measured}. ${c.staleClaims.length + c.copies.filter((x) => !x.agrees).length} of ${c.checked} checked assertions elsewhere disagree. Both are shown — neither is corrected.`
    }),
    el("ul", { class: "rm-banner-list" }, [
      ...c.copies.map((copy) =>
        el("li", {
          text: `${copy.rel}: claims ${copy.tally.pass}/${copy.tally.notRun}/${copy.tally.blocked} — ${copy.agrees ? "agrees" : "DIFFERS"}`
        })
      ),
      ...c.staleClaims.map((claim) =>
        el("li", {
          text: `${claim.itemId} claims "${claim.text}" for ${claim.area}; the ledger measures ${claim.measured} — DIFFERS`
        })
      )
    ])
  ]);
}

/* ==========================================================================
   2 — Roadmap phases
   ========================================================================== */

function renderPhases(ctx) {
  const { snap } = ctx;
  const phases = ctx.items.filter((i) => i.kind === "phase");
  const summary = snap.phases.summary;
  const nextPhase = phases.find((p) => p.rawStatus !== "complete");

  const statusIcon = {
    complete: "circle-check",
    "in-progress": "clock",
    "partially-completed": "circle-dashed",
    pending: "circle",
    blocked: "triangle-alert"
  };

  return frag([
    el("section", { class: "rm-banner rm-banner-warn" }, [
      el("h3", {}, [iconSpan("triangle-alert", 15), " This module is hand-maintained"]),
      el("p", {
        text: `src/roadmap/ImplementationRoadmap.ts was last written ${snap.phases.ageDays} days ago and is edited by hand, so it lags the work it describes. It also shares no identifier with any issue: no phase names a bead and no bead names a phase, so this view is deliberately drawn with no edges to the rest of the dashboard. Any such mapping would be invented.`
      })
    ]),

    el("section", { class: "work-panel" }, [
      el("div", { class: "section-heading" }, [
        el("h1", { text: "Implementation Roadmap" }),
        el("span", { text: `updated ${formatDate(new Date(snap.phases.mtimeMs).toISOString())}` })
      ]),

      el("div", { class: "roadmap-summary-grid" }, [
        statCard("list-checks", "Completed phases", `${summary.complete}/${summary.total}`),
        statCard("clock", "In progress", summary.inProgress),
        statCard("circle-dashed", "Partially completed", summary.partiallyCompleted),
        statCard("circle", "Pending", summary.pending),
        statCard("circle-check", "Completion", `${summary.completionPercent}%`)
      ]),

      nextPhase
        ? el("section", { class: "roadmap-next-panel" }, [
            el("div", {}, [
              el("span", { text: "Current focus" }),
              el("strong", { text: `Phase ${nextPhase.nativeId}: ${nextPhase.title}` })
            ]),
            el("p", { text: nextPhase.body })
          ])
        : null,

      el(
        "div",
        { class: "roadmap-grid" },
        phases.map((phase) =>
          el("article", { class: `roadmap-card ${phase.rawStatus}` }, [
            el("div", { class: "roadmap-card-header" }, [
              el("span", { class: "roadmap-phase-id", text: `Phase ${phase.nativeId}` }),
              el("span", { class: `roadmap-status ${phase.rawStatus}` }, [
                icon(statusIcon[phase.rawStatus] ?? "circle", 15),
                formatPhaseStatus(phase.rawStatus)
              ])
            ]),
            el("h2", { text: phase.title }),
            el("p", { text: phase.body }),
            el(
              "div",
              { class: "roadmap-deliverables" },
              (phase.flags.deliverables ?? []).map((d) => el("span", { text: d }))
            ),
            el("div", { class: "roadmap-acceptance" }, [
              el("span", { text: "Acceptance" }),
              el("strong", { text: phase.flags.acceptance ?? "—" })
            ])
          ])
        )
      )
    ])
  ]);
}

function formatPhaseStatus(status) {
  if (status === "in-progress") return "In progress";
  // Without this case the generic path renders "Partially-completed" — the hyphen is not a label.
  if (status === "partially-completed") return "Partially completed";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/* ==========================================================================
   3 — Work queue
   ========================================================================== */

function queueRow(entry, item, ctx) {
  if (!item) return el("div", { class: "rm-queue-row", text: entry.id });
  return el("article", { class: "rm-queue-row", data: { state: entry.state } }, [
    el("span", {
      class: "rm-rank",
      text: entry.rank === null ? "—" : String(entry.rank),
      title: entry.rank === null ? "In a dependency cycle — no rank" : `Layer L${entry.layer}`
    }),
    el("div", { class: "rm-queue-main" }, [
      el("span", { class: "rm-queue-title", text: item.title }),
      el("span", { class: "rm-queue-meta" }, [
        el("span", { class: "rm-id", text: item.nativeId }),
        priorityBadge(item),
        item.type ? el("span", { class: "rm-chip", text: item.type }) : null,
        areaChip(item.area),
        entry.unblocks > 0 ? el("span", { class: "rm-chip", text: `unblocks ${entry.unblocks}` }) : null
      ])
    ]),
    el("div", { class: "rm-queue-side" }, [
      assigneeChip(item),
      entry.openBlockers.length > 0
        ? el("span", {
            class: "rm-blockers",
            text: `blocked by ${entry.openBlockers.map((b) => ctx.byId.get(b)?.nativeId ?? b).join(", ")}`
          })
        : null,
      // A declared block has no edge to name, so say where it comes from instead of leaving the
      // row looking startable.
      entry.declaredBlocked
        ? el("span", {
            class: "rm-blockers",
            text: "declared blocked in bd",
            title: `status "${item.rawStatus}" — blocked for a reason no dependency edge expresses`
          })
        : null,
      activityNote(item)
    ])
  ]);
}

function renderQueue(ctx) {
  const { snap, byId, filter } = ctx;
  const caveat = snap.order.caveat;

  const visible = snap.order.ordered.filter((entry) => {
    if (local.queueState !== "all" && entry.state !== local.queueState) return false;
    return matchesFilter(byId.get(entry.id) ?? {}, filter);
  });

  const layers = snap.order.layers
    .map((layer) => ({
      layer: layer.layer,
      entries: layer.ids.map((id) => visible.find((v) => v.id === id)).filter(Boolean)
    }))
    .filter((group) => group.entries.length > 0);

  // Ranked, but outside every layer — the graph cannot release them, so they get their own section
  // rather than being shown "after" a layer they are not actually waiting on.
  const blockedOutside = (snap.order.externallyBlocked ?? [])
    .map((id) => visible.find((v) => v.id === id))
    .filter(Boolean);

  return frag([
    el("section", { class: "work-panel" }, [
      el("div", { class: "section-heading" }, [
        el("h1", { text: "Work queue" }),
        el("span", { text: `${visible.length} of ${snap.order.stats.queued} shown` })
      ]),
      el("p", { class: "rm-panel-note" }, [
        el("strong", { text: "Rank is a scheduling suggestion, not a decision. " }),
        `It answers one question: given only the dependency edges declared in .beads, with priority
         as the tiebreak, in what order can this work be started without waiting? It knows nothing
         about effort, business value, who is free, or any dependency nobody wrote down. `,
        el("strong", {
          text: `${caveat.withoutDeclaredDeps} of the ${caveat.openTotal} queued issues (${caveat.percentWithout}%) declare no dependencies at all`
        }),
        ` — their relative order comes purely from priority and type. Treat that portion as a sorted
         list rather than a plan.`
      ]),
      toggleRow(
        [
          ["all", `All (${snap.order.stats.queued})`],
          ["ready", `Ready now (${snap.order.stats.ready})`],
          ["blocked", `Blocked (${snap.order.stats.blocked})`]
        ],
        local.queueState,
        (value) => {
          local.queueState = value;
          ctx.rerender();
        }
      ),

      layers.length === 0
        ? emptyState("Nothing matches the current filter.")
        : frag(
            layers.map((group) =>
              el("div", {}, [
                subheading(
                  group.layer === 0 ? "Ready now (L0)" : `After L${group.layer - 1} (L${group.layer})`,
                  group.layer === 0
                    ? "no open blockers — can be started today"
                    : "starts once the previous layer clears"
                ),
                el(
                  "div",
                  { class: "rm-queue" },
                  group.entries.map((entry) => queueRow(entry, byId.get(entry.id), ctx))
                )
              ])
            )
          ),

      blockedOutside.length > 0
        ? el("div", {}, [
            subheading(
              `Blocked — not startable (${blockedOutside.length})`,
              "held up from outside the dependency graph"
            ),
            el("p", { class: "rm-panel-note" }, [
              `These are outstanding, but nothing in the graph will release them — each is either
               declared blocked in the tracker, waiting on deferred work, or waiting on a record the
               dashboard cannot see. They carry no scheduling position, because there is nothing to
               schedule them after.`
            ]),
            el(
              "div",
              { class: "rm-queue" },
              blockedOutside.map((entry) => queueRow(entry, byId.get(entry.id), ctx))
            )
          ])
        : null,

      snap.order.cycles.length > 0
        ? el("div", {}, [
            subheading("Circular dependencies", "must be broken manually — these have no rank"),
            el(
              "div",
              { class: "rm-queue" },
              snap.order.cycles.flatMap((cycle) =>
                cycle.ids.map((id) =>
                  el("article", { class: "rm-queue-row", data: { state: "cycle" } }, [
                    el("span", { class: "rm-rank", text: "—" }),
                    el("div", { class: "rm-queue-main" }, [
                      el("span", { class: "rm-queue-title", text: byId.get(id)?.title ?? id }),
                      el("span", { class: "rm-queue-meta" }, [
                        el("span", { class: "rm-id", text: byId.get(id)?.nativeId ?? id }),
                        el("span", { class: "rm-badge rm-badge-cycle", text: "in a cycle" })
                      ])
                    ])
                  ])
                )
              )
            )
          ])
        : null
    ])
  ]);
}

/* ==========================================================================
   5 — Issues & defects
   ========================================================================== */

function renderIssues(ctx) {
  const tabs = toggleRow(
    [
      ["issues", `Issues (${ctx.snap.stats.beads.total})`],
      ["defects", `Defects (${ctx.snap.stats.defects.defects})`]
    ],
    local.issuesTab,
    (value) => {
      local.issuesTab = value;
      ctx.rerender();
    }
  );
  return frag([tabs, local.issuesTab === "issues" ? issuesTab(ctx) : defectsTab(ctx)]);
}

function issuesTab(ctx) {
  const { snap, byId, filter } = ctx;
  const all = ctx.items.filter((i) => i.kind === "issue");
  // "Outstanding" means everything not closed, not literally status === "open" — otherwise a
  // blocked or in-progress issue disappears from a list whose own label counts it.
  const wanted =
    local.issuesStatus === "all"
      ? all
      : local.issuesStatus === "done"
        ? all.filter((i) => i.status === "done")
        : all.filter((i) => i.status !== "done");
  const visible = wanted.filter((i) => matchesFilter(i, filter));

  return el("section", { class: "work-panel" }, [
    el("div", { class: "section-heading" }, [
      el("h1", { text: "Beads issues" }),
      el("span", { text: `${visible.length} shown · ${snap.stats.beads.edges} declared edges` })
    ]),
    el("p", { class: "rm-panel-note" }, [
      `Read from .beads/issues.jsonl, the passive export of the Dolt-backed tracker. Every issue in
       the file carries the same owner, so ownership here is not a signal — the Assignee column is
       driven by tools/roadmap/assignments.json instead.`
    ]),
    toggleRow(
      [
        ["open", `Outstanding (${snap.stats.beads.outstanding})`],
        ["done", `Closed (${snap.stats.beads.closed})`],
        ["all", `All (${snap.stats.beads.total})`]
      ],
      local.issuesStatus,
      (value) => {
        local.issuesStatus = value;
        ctx.rerender();
      }
    ),
    visible.length === 0
      ? emptyState("No issue matches the current filter.")
      : el(
          "div",
          { class: "rm-queue" },
          visible.map((item) =>
            el("article", { class: "rm-queue-row", data: { state: item.status } }, [
              el("span", {
                class: "rm-rank",
                text: item.rawPriority ?? "—",
                title: `priority ${item.rawPriority ?? "unset"}`
              }),
              el("div", { class: "rm-queue-main" }, [
                el("span", { class: "rm-queue-title", text: item.title }),
                el("span", { class: "rm-queue-meta" }, [
                  el("span", { class: "rm-id", text: item.nativeId }),
                  el("span", {
                    class: `rm-badge rm-badge-${item.status === "done" ? "done" : "open"}`,
                    text: item.rawStatus
                  }),
                  item.type ? el("span", { class: "rm-chip", text: item.type }) : null,
                  areaChip(item.area),
                  item.dependsOn.length > 0
                    ? el("span", {
                        class: "rm-chip",
                        text: `depends on ${item.dependsOn.map((d) => byId.get(d)?.nativeId ?? d).join(", ")}`
                      })
                    : null
                ]),
                item.flags.staleClaim
                  ? el("span", {
                      class: "rm-blockers",
                      text: `this issue's description claims ${item.flags.staleClaim.claimed} ${item.flags.staleClaim.area} cases outstanding; the ledger measures ${item.flags.staleClaim.measured}`
                    })
                  : null,
                bodyDetails(item)
              ]),
              el("div", { class: "rm-queue-side" }, [
                assigneeChip(item),
                item.updatedAt ? el("span", { class: "rm-id", text: formatDate(item.updatedAt) }) : null,
                activityNote(item)
              ])
            ])
          )
        )
  ]);
}

function defectsTab(ctx) {
  const { snap, byId, filter } = ctx;
  const defects = ctx.items.filter((i) => i.kind === "defect" && matchesFilter(i, filter));
  const bySection = new Map();
  for (const defect of defects) {
    const section = defect.flags.section ?? "Uncategorised";
    if (!bySection.has(section)) bySection.set(section, []);
    bySection.get(section).push(defect);
  }

  return el("section", { class: "work-panel" }, [
    el("div", { class: "section-heading" }, [
      el("h1", { text: "Defect register" }),
      el("span", {
        text: `${snap.stats.defects.open} open · ${snap.stats.defects.resolved} resolved · S1 ${snap.stats.defects.s1} / S2 ${snap.stats.defects.s2} / S3 ${snap.stats.defects.s3}`
      })
    ]),
    el("p", { class: "rm-panel-note" }, [
      `Grouped into the five lifecycle sections DEFECTS.md itself uses. "Detected by" renders as
       chips: a chip that resolves to a known test case is solid, one that does not is dashed and
       inert — cited, but not present in any source the dashboard reads.`
    ]),
    frag(
      snap.defects.sections.map((section) => {
        const entries = bySection.get(section.name) ?? [];
        return el("div", {}, [
          subheading(section.name, `${section.count} in file · ${entries.length} shown`),
          entries.length === 0
            ? emptyState(
                section.count === 0
                  ? `None. The file records this section as empty.`
                  : "No entry in this section matches the current filter."
              )
            : el(
                "div",
                { class: "rm-queue" },
                entries.map((defect) =>
                  el("article", { class: "rm-queue-row", data: { state: defect.status } }, [
                    el("span", {
                      class: "rm-rank",
                      text: defect.rawPriority ?? "—",
                      title: "severity"
                    }),
                    el("div", { class: "rm-queue-main" }, [
                      el("span", { class: "rm-queue-title", text: defect.title }),
                      el("span", { class: "rm-queue-meta" }, [
                        el("span", { class: "rm-id", text: defect.nativeId }),
                        el("span", {
                          class: `rm-badge rm-badge-${(defect.rawPriority ?? "s3").toLowerCase()}`,
                          text: defect.rawPriority ?? "—"
                        }),
                        areaChip(defect.area),
                        ...detectedByChips(defect, snap, byId, ctx)
                      ]),
                      bodyDetails(defect)
                    ]),
                    el("div", { class: "rm-queue-side" }, [
                      el("span", {
                        class: "rm-badge rm-badge-done",
                        text: defect.status === "done" ? "resolved" : defect.status
                      })
                    ])
                  ])
                )
              )
        ]);
      })
    )
  ]);
}

function detectedByChips(defect, snap, byId, ctx) {
  const tokens = defect.flags.detectedByRaw ?? [];
  return tokens.map((token) => {
    const link = snap.links.links.find(
      (l) => l.from === defect.id && l.relation === "detected-by" && byId.get(l.to)?.nativeId === token
    );
    if (!link) {
      return el("span", {
        class: "rm-chip rm-chip-dangling",
        text: token,
        title: "Cited as the detecting case, but no such case exists in the ledger this dashboard reads."
      });
    }
    return el("button", {
      type: "button",
      class: "rm-chip",
      text: token,
      title: "Detected by this case — open it in Validation",
      on: {
        click: () => {
          ctx.setFilter(token);
          ctx.navigate("validation");
        }
      }
    });
  });
}

/* ==========================================================================
   6 — Validation
   ========================================================================== */

function renderValidation(ctx) {
  const { snap, filter } = ctx;
  const cases = ctx.items.filter((i) => i.kind === "case");
  const wanted =
    local.validationStatus === "all" ? cases : cases.filter((c) => c.rawStatus === local.validationStatus);
  const visible = wanted.filter((c) => matchesFilter(c, filter));

  return frag([
    el("section", { class: "work-panel" }, [
      el("div", { class: "section-heading" }, [
        el("h1", { text: "Open validation surface" }),
        el("span", { text: `${snap.ledger.residual.length} cases are not PASS` })
      ]),
      el("p", { class: "rm-panel-note" }, [
        `Every case in the ledger that is not PASS, pinned. This is the whole of the outstanding
         validation work — the other ${snap.ledger.tally.pass} were executed and observed.`
      ]),
      el(
        "div",
        { class: "rm-queue" },
        snap.ledger.residual.map((residual) =>
          el("article", { class: "rm-queue-row", data: { state: "blocked" } }, [
            el("span", { class: "rm-rank", text: residual.priority ?? "—" }),
            el("div", { class: "rm-queue-main" }, [
              el("span", { class: "rm-queue-title", text: residual.title }),
              el("span", { class: "rm-queue-meta" }, [
                el("span", { class: "rm-id", text: residual.id }),
                el("span", {
                  class: `rm-badge rm-badge-${residual.status === "BLOCKED" ? "blocked" : "notrun"}`,
                  text: residual.status
                }),
                residual.layer ? el("span", { class: "rm-chip", text: residual.layer }) : null
              ]),
              residual.note ? el("p", { class: "rm-panel-note", text: residual.note }) : null
            ])
          ])
        )
      )
    ]),

    el("section", { class: "work-panel" }, [
      el("div", { class: "section-heading" }, [
        el("h1", { text: "Test case ledger" }),
        el("span", {
          text: `${snap.ledger.tally.total} cases · ${snap.ledger.tally.pass} PASS / ${snap.ledger.tally.notRun} NOT RUN / ${snap.ledger.tally.blocked} BLOCKED`
        })
      ]),
      snap.ledger.degraded
        ? el("p", { class: "rm-banner rm-banner-warn", text: "The ledger parse is degraded — the tally below may be wrong. See Sources." })
        : null,
      el(
        "div",
        { class: "roadmap-summary-grid" },
        snap.ledger.byFamily.map((family) =>
          statCard("flask-conical", family.family, `${family.pass}/${family.total}`, `${family.notRun} not run, ${family.blocked} blocked`)
        )
      ),
      toggleRow(
        [
          ["all", `All (${snap.ledger.tally.total})`],
          ["PASS", `PASS (${snap.ledger.tally.pass})`],
          ["NOT RUN", `NOT RUN (${snap.ledger.tally.notRun})`],
          ["BLOCKED", `BLOCKED (${snap.ledger.tally.blocked})`]
        ],
        local.validationStatus,
        (value) => {
          local.validationStatus = value;
          ctx.rerender();
        }
      ),
      visible.length === 0
        ? emptyState("No case matches the current filter.")
        : table(
            ["Case", "Title", "Status", "Priority", "Layer"],
            visible.map((c) =>
              el("tr", {}, [
                el("td", { class: "rm-mono", text: c.nativeId }),
                el("td", { text: c.title }),
                el("td", {}, [
                  el("span", {
                    class: `rm-badge rm-badge-${c.rawStatus === "PASS" ? "pass" : c.rawStatus === "BLOCKED" ? "blocked" : "notrun"}`,
                    text: c.rawStatus
                  })
                ]),
                el("td", { class: "rm-num", text: c.rawPriority ?? "—" }),
                el("td", { text: c.area?.value ?? "—" })
              ])
            )
          )
    ]),

    el("section", { class: "work-panel" }, [
      el("div", { class: "section-heading" }, [
        el("h1", { text: "Requirement traceability" }),
        el("span", {
          text: `${snap.traceability.stats.rows} rows · ${snap.traceability.stats.pass} PASS / ${snap.traceability.stats.notRun} NOT RUN / ${snap.traceability.stats.blocked} BLOCKED`
        })
      ]),
      table(
        ["Requirement", "Rows", "PASS"],
        snap.traceability.byRequirement.map((group) =>
          el("tr", {}, [
            el("td", { text: group.name }),
            el("td", { class: "rm-num", text: String(group.total) }),
            el("td", { class: "rm-num", text: `${group.pass}/${group.total}` })
          ])
        )
      )
    ]),

    el("section", { class: "work-panel" }, [
      el("div", { class: "section-heading" }, [
        el("h1", { text: "Verifiers by class" }),
        el("span", { text: `${snap.verifiers.stats.classified} classified of ${snap.verifiers.stats.verifierScripts} scripts` })
      ]),
      el("p", { class: "rm-panel-note" }, [
        `Per-class counts, never one undifferentiated total — a structural check and a live-browser
         check are not the same evidence. Taken from scripts/lib/verifier-classification.ts.`
      ]),
      snap.verifiers.unclassified.length > 0
        ? el("div", { class: "rm-banner rm-banner-warn" }, [
            el("h3", {}, [iconSpan("triangle-alert", 15), " Unclassified verifiers"]),
            el("p", {
              text: `${snap.verifiers.unclassified.join(", ")} — present in package.json but absent from the registry. verify:verifier-classification fails while this is true.`
            })
          ])
        : null,
      table(
        ["Class", "Count"],
        snap.verifiers.byClass.map((entry) =>
          el("tr", {}, [el("td", { text: entry.name }), el("td", { class: "rm-num", text: String(entry.count) })])
        )
      )
    ])
  ]);
}

/* ==========================================================================
   7 — Agent activity
   ========================================================================== */

function renderAgents(ctx) {
  const { snap } = ctx;
  const coverage = snap.agents.coverage;
  const assignments = snap.agents.assignments;

  return frag([
    el("section", { class: "work-panel" }, [
      el("div", { class: "section-heading" }, [
        el("h1", { text: "Agent activity" }),
        el("span", { text: `${coverage.attributed} of ${coverage.total} log entries name an agent` })
      ]),
      el("p", { class: "rm-panel-note" }, [
        el("strong", { text: "This answers the answerable version of the question. " }),
        `The issue tracker records no per-issue assignee — every issue carries the same owner — and
         TASK_LOG records only what an agent has already finished. So there is no honest source for
         "who is working on this issue right now". `,
        el("strong", { text: `${assignments.claims} explicit ${assignments.claims === 1 ? "claim exists" : "claims exist"}` }),
        ` in tools/roadmap/assignments.json${assignments.expired > 0 ? `, ${assignments.expired} expired` : ""}; everything below is program-level history, derived and labelled as such. `,
        el("span", { text: `${coverage.unattributed} entries name no agent at all.` })
      ]),
      el(
        "div",
        { class: "rm-agent-grid" },
        snap.agents.timeline.map((agent) =>
          el("article", { class: "rm-agent-card" }, [
            el("div", { class: "rm-agent-head" }, [
              el("strong", { text: agent.agent }),
              el("span", { class: "rm-chip", text: plural(agent.count, "entry", "entries") })
            ]),
            el("span", { class: "rm-id", text: `latest ${agent.latest}` }),
            el(
              "ul",
              { class: "rm-agent-entries" },
              agent.entries.map((entry) =>
                el("li", { title: entry.raw ? `recorded as "${entry.raw}"` : undefined }, [
                  el("time", { datetime: entry.date, text: entry.date }),
                  entry.task
                ])
              )
            )
          ])
        )
      )
    ]),

    el("section", { class: "work-panel" }, [
      el("div", { class: "section-heading" }, [
        el("h1", { text: "Most recent entries" }),
        el("span", { text: "docs/ai/TASK_LOG.md, newest first" })
      ]),
      table(
        ["Date", "Agent", "Recorded as", "Entry"],
        snap.agents.recent.map((entry) =>
          el("tr", {}, [
            el("td", { class: "rm-num", text: entry.date }),
            el("td", { text: entry.agent }),
            el("td", { class: "rm-mono", text: entry.raw }),
            el("td", { text: entry.heading })
          ])
        )
      )
    ])
  ]);
}

/* ==========================================================================
   8 — Sources
   ========================================================================== */

function renderSources(ctx) {
  const { snap } = ctx;
  const parsed = snap.sources.filter((s) => s.parsed).length;

  return frag([
    el("section", { class: "work-panel" }, [
      el("div", { class: "section-heading" }, [
        el("h1", { text: "Sources" }),
        el("span", { text: `${parsed} parsed of ${snap.sources.length} registered` })
      ]),
      el("p", { class: "rm-panel-note" }, [
        `Everything this dashboard knows comes from the files below, and it states its own blind
         spots: a source listed as not parsed contributes nothing to any number on any other page.`
      ]),
      table(
        ["State", "Path", "Role", "Records", "Size", "Modified"],
        snap.sources.map((source) =>
          el("tr", {}, [
            el("td", {}, [
              el("span", {
                class: `rm-source-state ${!source.ok ? "rm-source-error" : source.parsed ? "rm-source-ok" : "rm-source-skipped"}`,
                text: !source.ok ? "error" : source.parsed ? "parsed" : "not parsed"
              })
            ]),
            el("td", {}, [
              el("div", { class: "rm-mono", text: source.rel }),
              el("div", { text: source.label })
            ]),
            el("td", { text: source.parsed ? source.role : (source.skipReason ?? source.role) }),
            el("td", { class: "rm-num", text: source.records === null ? "—" : String(source.records) }),
            el("td", { class: "rm-num", text: formatBytes(source.bytes) }),
            el("td", { class: "rm-num", text: source.mtime ? formatDate(source.mtime) : "—" })
          ])
        )
      )
    ]),

    el("section", { class: "work-panel" }, [
      el("div", { class: "section-heading" }, [
        el("h1", { text: "Known issues register" }),
        el("span", {
          text: `${snap.knownIssues.stats.entries} entries · ${snap.knownIssues.stats.fragile} fragile-area sections`
        })
      ]),
      table(
        ["Section", "Kind", "Entries"],
        snap.knownIssues.sections.map((section) =>
          el("tr", {}, [
            el("td", { text: section.name }),
            el("td", {}, [el("span", { class: "rm-chip", text: section.kind })]),
            el("td", { class: "rm-num", text: String(section.entries) })
          ])
        )
      )
    ])
  ]);
}

/* ==========================================================================
   Registry
   ========================================================================== */

/** @type {Array<{id: string, label: string, icon: string, title: string, subtitle: (s: any) => string, count: (s: any) => number|null, render: (ctx: any) => Node}>} */
export const VIEWS = [
  {
    id: "overview",
    label: "Overview",
    icon: "layout-dashboard",
    title: "Overview",
    subtitle: (s) =>
      `${s.stats.beads.outstanding} outstanding · ${s.order.stats.ready} ready now · ${s.ledger.tally.pass}/${s.ledger.tally.total} cases passing`,
    count: () => null,
    render: renderOverview
  },
  {
    id: "phases",
    label: "Roadmap Phases",
    icon: "map",
    title: "Roadmap Phases",
    subtitle: (s) => `${s.phases.summary.complete} of ${s.phases.summary.total} phases complete`,
    count: (s) => s.phases.summary.total,
    render: renderPhases
  },
  {
    id: "queue",
    label: "Work Queue",
    icon: "list-checks",
    title: "Work Queue",
    subtitle: (s) => `${s.order.stats.ready} ready · ${s.order.stats.blocked} blocked · ${s.order.stats.layers} layers`,
    count: (s) => s.order.stats.queued,
    render: renderQueue
  },
  {
    id: "graph",
    label: "Dependencies",
    icon: "git-branch",
    title: "Dependencies",
    subtitle: (s) =>
      `${s.order.caveat.withDeclaredDeps} of ${s.order.caveat.openTotal} queued issues declare a dependency`,
    count: (s) => s.stats.beads.blocksEdges,
    render: renderDependencies
  },
  {
    id: "issues",
    label: "Issues & Defects",
    icon: "bug",
    title: "Issues & Defects",
    subtitle: (s) => `${s.stats.beads.outstanding} outstanding · ${s.stats.defects.open} open defects`,
    count: (s) => s.stats.beads.outstanding,
    render: renderIssues
  },
  {
    id: "validation",
    label: "Validation",
    icon: "flask-conical",
    title: "Validation",
    subtitle: (s) =>
      `${s.ledger.tally.pass} PASS / ${s.ledger.tally.notRun} NOT RUN / ${s.ledger.tally.blocked} BLOCKED`,
    count: (s) => s.ledger.residual.length,
    render: renderValidation
  },
  {
    id: "agents",
    label: "Agent Activity",
    icon: "users",
    title: "Agent Activity",
    subtitle: (s) => `${s.agents.coverage.attributed} of ${s.agents.coverage.total} log entries attributed`,
    count: (s) => s.agents.timeline.length,
    render: renderAgents
  },
  {
    id: "sources",
    label: "Sources",
    icon: "database",
    title: "Sources",
    subtitle: (s) => `${s.sources.filter((x) => x.parsed).length} parsed of ${s.sources.length}`,
    count: (s) => s.warnings.length,
    render: renderSources
  }
];
