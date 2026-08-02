/**
 * verify:roadmap-dashboard — static source validation for tools/roadmap.
 *
 * What regression makes this fail?
 *   - a document this dashboard reads is renamed, moved, or restructured (a heading level changes,
 *     a CSV column is added, the roadmap array literal is reformatted);
 *   - the ledger tally in CURRENT_STATE.md or HANDOFF.md drifts from the case file itself;
 *   - the ordering algorithm stops producing a gapless deterministic rank, or marks an item ready
 *     while it still has an open blocker;
 *   - a provenance guarantee is broken — a derived agent attribution acquires the authority of a
 *     declared one;
 *   - a global.css class the dashboard borrows is renamed, so the page would silently lose styling;
 *   - a CDN or remote URL is introduced into the page, breaking the offline rule.
 *
 * Deliberately .mjs: tsconfig.scripts.json covers .mts only and verify-source-hygiene globs
 * .ts/.mts/.tsx, so this file stays outside both — matching the existing node scripts/verify-*.mjs
 * entries. It never launches a browser or the Electron app, which is why it is classified
 * static-source-validation rather than real-browser.
 */

import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readAssignments } from "../tools/roadmap/lib/agents.mjs";
import { buildSnapshot } from "../tools/roadmap/lib/model.mjs";
import { deriveAreaWeighted, normalizeBeadStatus, normalizePhases } from "../tools/roadmap/lib/normalize.mjs";
import { computeOrder } from "../tools/roadmap/lib/order.mjs";
import { KNOWN_EDGE_TYPES, KNOWN_STATUSES, parseBeads } from "../tools/roadmap/lib/parse-beads.mjs";
import { LEDGER_STATUSES, parseLedger } from "../tools/roadmap/lib/parse-ledger.mjs";
import { parseNarrative } from "../tools/roadmap/lib/parse-narrative.mjs";
import { EXPECTED_PHASE_IDS, extractPhases } from "../tools/roadmap/lib/parse-roadmap-phases.mjs";
import { TRACE_STATUSES, parseTraceability } from "../tools/roadmap/lib/parse-traceability.mjs";
import { readSource } from "../tools/roadmap/lib/read-cache.mjs";
import { ROADMAP_ROOT, SOURCES, sourcePath } from "../tools/roadmap/lib/sources.mjs";

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  OK ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

/** A frozen clock, so the snapshot is a pure function of the files on disk. */
const NOW = Date.parse("2026-07-27T12:00:00Z");

try {
  /* ======================================================================
     1. Sources
     ====================================================================== */
  console.log("Sources:");
  check("13 sources are registered", SOURCES.length === 13, `got ${SOURCES.length}`);
  for (const source of SOURCES) {
    const read = readSource(source.id);
    check(`${source.rel} is readable`, read.ok, read.error ?? "");
  }
  check(
    "every unparsed source states why",
    SOURCES.filter((s) => !s.parsed).every((s) => typeof s.skipReason === "string" && s.skipReason.length > 0)
  );

  /* ======================================================================
     2. Beads
     ====================================================================== */
  console.log("Beads issue tracker:");
  const beads = parseBeads();
  check("149 issues parse", beads.stats.total === 149, `got ${beads.stats.total}`);
  // Moved 22/96 → 21/97 (`awkit-0jp`) → 20/98 (`awkit-thg`) → 19/99 (`awkit-epz`) →
  // 18/100 (`awkit-y24`) → 17/101 (`awkit-4km`) on 2026-07-28 → 6/113, then 5/114, then 6/114 on 2026-07-29 when Codex filed awkit-f3l (owner decisions
  // closed `awkit-wza.8`, `awkit-wza` and `awkit-8ri`; SET-015 carved out as `awkit-hlp`, so the
  // total also moved 118 → 119). Then 8/114 on 2026-07-29 when the clean-machine run-based checks
  // filed `awkit-vbj` (run reports omit Legacy Compatibility attribution) and `awkit-5ci`
  // (runbook 8.7-8.11), moving the total 120 → 122. Move this pin deliberately when a bead closes —
  // never relax it to a range, or it stops noticing that the export was not refreshed
  // (`bd close` does not rewrite `.beads/issues.jsonl`; `bd export -o .beads/issues.jsonl` does —
  // plain `bd export` writes to STDOUT and leaves the file untouched).
  // Then 8/115 of 123 on 2026-07-30: the clean-machine migration ceremony closed `awkit-5ci` and
  // filed `awkit-x48` (undo-refusal toast leaks the IPC channel name).
  // Then 10/115 of 125 on 2026-07-30, from the full single-artifact gate run: `awkit-3zr` (the run
  // itself, in progress), `awkit-k2s` (Flow Library re-scan action absent in the installed app).
  // Then 10/116 of 126 when the full single-artifact gate run finished: `awkit-3zr` closed,
  // `awkit-o7r` filed (undo offered for records that cannot be undone) — then 9/117 when that fix
  // landed and `awkit-o7r` closed.
  // Then 9/118 of 127 on 2026-07-30: `awkit-843` (Graphify code knowledge graph integration) filed
  // and closed in the same session, so the total moved 126 → 127 and closed 117 → 118 while
  // outstanding stayed put. This pin caught its own documented trap that session: `bd close`
  // followed by a plain `bd export` left the export showing `awkit-843` still open.
  // Then 17/118 of 135 on 2026-07-31: epic `awkit-aui` (Recorder ambiguity-resolution &
  // recorded-flow replayability, AWKIT-REC-030) filed with 7 dependency-ordered children
  // (`awkit-aui.1`…`.6`, `.8`), adding 8 outstanding (total 127 → 135) and 7 edges (76 → 83).
  // Then 18/121 of 139 on 2026-08-01: `awkit-aui.5` (Inc5 hover-replay repair, AWKIT-REC-031) and
  // `awkit-aui.8` (Inc7 nine-point ambiguity gate) closed; four follow-ups filed OPEN — `awkit-bw9`
  // (table-row container-name replay gap), `awkit-vot` + `awkit-0vm` (Inc5 hover residuals), and
  // `awkit-hj8` (dependency-manifest audit). Net: total 135 → 139, closed 120 → 121, outstanding 15 → 18.
  // Then 16/123 of 139 on 2026-08-01: `awkit-aui.2` (Inc2 reconciled complete) and `awkit-bw9` (table-row
  // container-name replay fix, AWKIT-REC-032) closed; no new issues. Increment 6 (`awkit-aui.6`)
  // then closed: 16 → 15 outstanding, total unchanged at 139.
  // Reconciliation filed two defect children (`awkit-aui.3.1` / `.4.1`), raising total/edges to
  // 141/91, then closed both children, Increments 3/4, and parent epic: 12 outstanding / 129 closed.
  // The licensing/manifest closure filed key-custody follow-up `awkit-2l1` (one issue and one edge),
  // then closed `awkit-f3l` and `awkit-hj8`: 142/92, 11 outstanding / 131 closed.
  // Recorder hover review filed `awkit-3vh` and the separate catalog defect `awkit-8lz`, then closed
  // `awkit-3vh`: total 144, edges unchanged at 92, 12 outstanding / 132 closed.
  // Then 11/133 of 144 on 2026-08-02: `awkit-8lz` closed (hover catalog entry + explicit Unknown-step
  // rendering + `verify:flow-node-catalog-parity`); no new issues or edges filed.
  // Then 11/134 of 145 on 2026-08-02: `awkit-vot` closed (adjacent-sibling hover attribution) and
  // `awkit-hmt` filed for the remote non-adjacent boundary it deliberately leaves open — one issue in,
  // one out, so outstanding held while total and closed each rose by one. Edges unchanged at 92.
  // Then 10/135 of 145 on 2026-08-02: `awkit-0vm` closed (hover-inserted control attribution); no new
  // issues or edges filed — the remote-trigger boundary stays on `awkit-hmt`.
  // Then 10/136 of 146 on 2026-08-02: `awkit-hmt` closed (remote hover attribution) and `awkit-a7k`
  // filed (the verifier harness installs the init script after load, not at document start) — one in,
  // one out, so outstanding held while total and closed each rose by one. Edges unchanged at 92.
  // Then 9/137 of 146 on 2026-08-02: `awkit-a7k` closed (recorder baselines the loaded page; the
  // verifiers now install at document start like production). No new issues or edges.
  // Then 9/138 of 147 on 2026-08-02: `awkit-0tn` was filed and closed (singleton Issuer role and
  // in-app offline license issuance). No new edges.
  // Then 10/139 of 149 on 2026-08-02: `awkit-x48` closed (IPC toast no longer leaks the channel
  // name), and two filed during the same session - `awkit-5ea` (issuer key has no synced-folder
  // custody check, found reviewing the issuer console) and `awkit-73s` (an intermittent geometry
  // check in the Flow Designer GUI gate). Net: total +2, closed +1, outstanding 9 -> 10.
  check(
    "10 outstanding / 139 closed",
    beads.stats.outstanding === 10 && beads.stats.closed === 139,
    `outstanding ${beads.stats.outstanding}, closed ${beads.stats.closed}`
  );
  check(
    "every status in the export is one bd actually defines",
    Object.keys(beads.stats.byStatus).every((s) => KNOWN_STATUSES.has(s)),
    JSON.stringify(beads.stats.byStatus)
  );
  check(
    "the full bd status taxonomy is accepted, not just open/closed",
    KNOWN_STATUSES.size === 7 && KNOWN_STATUSES.has("in_progress") && KNOWN_STATUSES.has("blocked"),
    "`bd update --claim` sets in_progress; rejecting it would fail this gate the first time anyone claimed work"
  );
  check("no dangling dependency reference", beads.stats.danglingEdges === 0, `got ${beads.stats.danglingEdges}`);
  check("every status is known", beads.beads.every((b) => KNOWN_STATUSES.has(b.status)));
  check(
    "92 edges are present to classify",
    beads.stats.edges === 92,
    `got ${beads.stats.edges} — the edge-type check below is vacuous if this reaches 0`
  );
  check(
    "every edge type is known",
    beads.beads.every((b) => (b.dependencies ?? []).every((d) => KNOWN_EDGE_TYPES.has(d.type))),
    "an unrecognised edge type would be silently ignored by the graph"
  );

  /* ======================================================================
     3. Ledger — reconciled four ways. The highest-value check here: it is what
        catches the campaign documents drifting apart from the case file.
     ====================================================================== */
  console.log("Validation ledger:");
  const ledger = parseLedger();
  check("the ledger parse is not degraded", ledger.degraded === false);
  check("66 cases", ledger.stats.cases === 66, `got ${ledger.stats.cases}`);
  check(
    "heading, status and priority counts agree",
    ledger.stats.cases === ledger.stats.statusLines && ledger.stats.cases === ledger.stats.priorityLines,
    `${ledger.stats.cases} / ${ledger.stats.statusLines} / ${ledger.stats.priorityLines}`
  );
  check("every status is in the allowed set", ledger.cases.every((c) => LEDGER_STATUSES.has(c.status)));
  check(
    "tally is 62 PASS / 3 NOT RUN / 1 BLOCKED",
    ledger.tally.pass === 62 && ledger.tally.notRun === 3 && ledger.tally.blocked === 1,
    `got ${ledger.tally.pass}/${ledger.tally.notRun}/${ledger.tally.blocked}`
  );
  check("statuses sum to the case count", ledger.tally.total === ledger.stats.cases);

  const narrative = parseNarrative();
  const asserted = narrative.heads.filter((h) => h.assertedTally);
  check("both narrative documents assert a tally", asserted.length === 2, `got ${asserted.length}`);
  for (const head of asserted) {
    check(
      `${head.rel} agrees with the measured tally`,
      head.assertedTally.pass === ledger.tally.pass &&
        head.assertedTally.notRun === ledger.tally.notRun &&
        head.assertedTally.blocked === ledger.tally.blocked,
      `claims ${head.assertedTally.pass}/${head.assertedTally.notRun}/${head.assertedTally.blocked}`
    );
  }

  /* ======================================================================
     4. Traceability CSV
     ====================================================================== */
  console.log("Traceability matrix:");
  const trace = parseTraceability();
  check("101 rows", trace.stats.rows === 101, `got ${trace.stats.rows}`);
  check(
    "84 PASS / 14 NOT RUN / 3 BLOCKED",
    trace.stats.pass === 84 && trace.stats.notRun === 14 && trace.stats.blocked === 3,
    `got ${trace.stats.pass}/${trace.stats.notRun}/${trace.stats.blocked}`
  );
  check("every status is allowed", trace.rows.every((r) => TRACE_STATUSES.has(r.status)));
  check(
    "statuses account for every row",
    trace.stats.pass + trace.stats.notRun + trace.stats.blocked + trace.stats.fail === trace.stats.rows
  );
  check(
    "notes survive the unescaped commas in the source",
    trace.rows.some((r) => r.notes.includes(",")),
    "a plain 6-way split would have truncated these rows instead"
  );

  /* ======================================================================
     5. Roadmap phase module, with a negative case
     ====================================================================== */
  console.log("Roadmap phase module:");
  const phasesText = readSource("phases").text;
  const phases = extractPhases(phasesText, null, 0);
  check("11 phases", phases.phases.length === 11, `got ${phases.phases.length}`);
  check(
    "phase ids are exactly A..K",
    phases.phases.map((p) => p.id).join("") === EXPECTED_PHASE_IDS,
    phases.phases.map((p) => p.id).join("")
  );
  const mangled = extractPhases("export const implementationRoadmap = [ {{{ not an array", null, 0);
  check(
    "a mangled literal is rejected rather than half-parsed",
    mangled.phases.length === 0 && mangled.warnings.length > 0,
    `got ${mangled.phases.length} phases, ${mangled.warnings.length} warnings`
  );

  // The mid-string colon property is proven against a FIXTURE, not against whichever prose phase E
  // happens to carry today. The old form asserted the live note contained "Remaining:", so ordinary
  // rewording of a note broke a parser check that had nothing to do with the wording.
  const syntheticPhase = (status) =>
    [
      "export const implementationRoadmap: RoadmapPhase[] = [",
      "  {",
      '    id: "A",',
      '    title: "Synthetic",',
      `    status: ${JSON.stringify(status)},`,
      '    deliverables: ["one"],',
      '    acceptance: "n/a",',
      '    implementationNote: "Shipped: yes. Remaining: a named gap."',
      "  }",
      "];"
    ].join("\n");

  const syntheticPartial = extractPhases(syntheticPhase("partially-completed"), null, 0);
  check(
    "a mid-string 'Word:' inside a note does not corrupt the parse",
    syntheticPartial.phases.length === 1 &&
      syntheticPartial.phases[0].implementationNote === "Shipped: yes. Remaining: a named gap.",
    "a naive key-quoting regex quotes 'Shipped' and 'Remaining' mid-string and invalidates the JSON"
  );
  check(
    "partially-completed is an accepted phase status",
    syntheticPartial.warnings.every((w) => !/unrecognised status/.test(w)),
    syntheticPartial.warnings.join(" | ")
  );
  // Proves the line above is not vacuous: the unrecognised-status path must actually fire.
  check(
    "an unknown phase status still warns",
    extractPhases(syntheticPhase("mostly-done"), null, 0).warnings.some((w) =>
      /unrecognised status "mostly-done"/.test(w)
    ),
    "if this never fires, the accepted-status check above proves nothing"
  );
  check(
    "a partially-completed phase is counted separately and credited no completion",
    syntheticPartial.summary.partiallyCompleted === 1 &&
      syntheticPartial.summary.complete === 0 &&
      syntheticPartial.summary.completionPercent === 0,
    `partial=${syntheticPartial.summary.partiallyCompleted} complete=${syntheticPartial.summary.complete} pct=${syntheticPartial.summary.completionPercent}`
  );
  check(
    "a partially-completed phase normalises to active, never done",
    normalizePhases(syntheticPartial.phases, 0)[0]?.status === "active",
    "mapping it to done would count an unclosed phase as finished work"
  );
  // Live-data guards. Cardinality first, so neither `every` can pass over an empty list.
  check(
    "all 11 live phase notes parsed non-empty",
    phases.phases.length === 11 && phases.phases.every((p) => p.implementationNote.length > 0),
    "a silently truncated string value would leave a phase with no note"
  );
  check(
    "no live phase carries an unrecognised status",
    phases.warnings.every((w) => !/unrecognised status/.test(w)),
    phases.warnings.join(" | ")
  );

  /* ======================================================================
     6. Ordering, including the cycle branch that has no real instances today
     ====================================================================== */
  console.log("Ordering:");
  const snapshot = buildSnapshot({ now: NOW });
  const order = snapshot.order;
  const ranks = order.ordered.map((o) => o.rank).filter((r) => r !== null);
  check(
    "rank is a gapless 1..N permutation",
    ranks.length === order.stats.ranked &&
      new Set(ranks).size === ranks.length &&
      Math.min(...ranks) === 1 &&
      Math.max(...ranks) === ranks.length,
    `n=${ranks.length} min=${Math.min(...ranks)} max=${Math.max(...ranks)}`
  );
  check(
    "every ready item has zero open blockers",
    order.ordered.filter((o) => o.state === "ready").every((o) => o.openBlockers.length === 0)
  );
  check(
    "every blocked item is blocked for a stated reason",
    order.ordered
      .filter((o) => o.state === "blocked")
      .every((o) => o.openBlockers.length > 0 || o.declaredBlocked === true),
    "either an edge names the blocker, or the tracker declared the status — never neither"
  );
  check(
    "a declared-blocked issue is never offered as ready",
    order.ordered.filter((o) => o.declaredBlocked).every((o) => o.state === "blocked"),
    "awkit-7bu said BLOCKED in its title for a day while the queue ranked it startable"
  );
  // Five today (2026-07-29, down from seven): the three owner-decision items were decided and built,
  // so only externally-gated work remains — two authorized-operator gates (`awkit-7bu` real Oracle,
  // `awkit-cey` real IdP), the Oracle external release gates, and two manual OS shell launches
  // (`awkit-az7`, `awkit-hlp`). `awkit-1cc` is in_progress, not blocked: its packaged-licensing half
  // is real remaining engineering. None of the five can be represented by a normal `blocks` edge,
  // hence declared status. The layer assertion is `.every()`, not `[0]`; the cardinality guard
  // prevents vacuous success if blocked items disappear from parsing.
  check(
    "every declared-blocked issue is present and out of the layers",
    order.stats.declaredBlocked === 5 &&
      order.externallyBlocked.length === 5 &&
      order.externallyBlocked.every((id) => order.ordered.find((o) => o.id === id)?.layer === null),
    `declaredBlocked ${order.stats.declaredBlocked}, externallyBlocked ${order.externallyBlocked.length}`
  );
  check(
    "an open blocker is itself queued",
    order.ordered.every((o) => o.openBlockers.every((b) => order.ordered.some((x) => x.id === b)))
  );
  check("no cycles in the real data", order.stats.cycles === 0, `got ${order.stats.cycles}`);
  check(
    "the caveat counts agree with the edges",
    order.caveat.withDeclaredDeps + order.caveat.withoutDeclaredDeps === order.caveat.openTotal &&
      order.caveat.openTotal === order.stats.queued
  );

  // The cycle branch must be proven to fire. A guard with no test and no real instances is
  // decoration: it would be deleted or broken by a refactor and nothing would notice.
  const synthetic = [
    makeIssue("bead:cycle-a", ["bead:cycle-b"]),
    makeIssue("bead:cycle-b", ["bead:cycle-a"]),
    makeIssue("bead:free", [])
  ];
  const cycleOrder = computeOrder(synthetic);
  check("a synthetic 2-cycle produces one cycle group", cycleOrder.cycles.length === 1, `got ${cycleOrder.cycles.length}`);
  check(
    "cycle members carry rank null and state cycle",
    cycleOrder.ordered
      .filter((o) => o.id !== "bead:free")
      .every((o) => o.rank === null && o.state === "cycle"),
    JSON.stringify(cycleOrder.ordered.map((o) => [o.id, o.rank, o.state]))
  );
  check(
    "an item outside the cycle is still ranked",
    cycleOrder.ordered.find((o) => o.id === "bead:free")?.rank === 1
  );

  // Statuses with no instance in the repository today. Each collapsed into plain "open" before this
  // was fixed, so a claimed or deferred issue was offered as ready work.
  check(
    "in_progress normalises to active and stays in the queue",
    normalizeBeadStatus("in_progress") === "active" &&
      computeOrder([{ ...makeIssue("bead:claimed", []), status: "active" }]).stats.queued === 1,
    "`bd update --claim` sets in_progress; claimed work must remain visible, not vanish"
  );
  check(
    "deferred is excluded from the queue entirely",
    normalizeBeadStatus("deferred") === "deferred" &&
      computeOrder([{ ...makeIssue("bead:iced", []), status: "deferred" }]).stats.queued === 0
  );
  check(
    "a DEFERRED prerequisite blocks its dependent (fail closed)",
    (() => {
      const o = computeOrder([
        { ...makeIssue("bead:iced", []), status: "deferred" },
        makeIssue("bead:waiting", ["bead:iced"])
      ]);
      const waiting = o.ordered.find((x) => x.id === "bead:waiting");
      return waiting?.state === "blocked" && waiting.openBlockers.includes("bead:iced");
    })(),
    "treating 'not in the queue' as satisfied would mark an item ready because its blocker was put on ice"
  );
  check(
    "a dependent of a declared-blocked issue is blocked too, and not called a cycle",
    (() => {
      const o = computeOrder([
        { ...makeIssue("bead:stuck", []), status: "blocked" },
        makeIssue("bead:downstream", ["bead:stuck"])
      ]);
      return (
        o.cycles.length === 0 &&
        o.externallyBlocked.length === 2 &&
        o.ordered.every((x) => x.state === "blocked")
      );
    })(),
    "Kahn cannot drain either one; Tarjan must separate 'held from outside' from 'circular'"
  );

  /* ======================================================================
     7. Determinism
     ====================================================================== */
  console.log("Determinism:");
  const a = JSON.stringify(buildSnapshot({ now: NOW }));
  const b = JSON.stringify(buildSnapshot({ now: NOW }));
  check("two builds from identical input are byte-identical", a === b, `${a.length} vs ${b.length} bytes`);

  /* ======================================================================
     8. Honesty invariants — the provenance rules, asserted rather than assumed
     ====================================================================== */
  console.log("Provenance:");
  // Driven against a fixture, not the shipped file. assignments.json normally ships with zero
  // claims, so asserting over "items that have an assignee" would be an .every() on an empty array
  // — true without testing anything, and it would stay true if the field stopped working entirely.
  const fixture = join(tmpdir(), `awkit-roadmap-claims-${process.pid}.json`);
  writeFileSync(
    fixture,
    JSON.stringify({
      claims: [
        { itemId: "bead:awkit-7lj", agent: "Claude", state: "in-progress", claimedAt: "2026-07-27T10:00:00Z" },
        { itemId: "bead:awkit-cxa", agent: "Codex", state: "in-progress", claimedAt: "2026-07-20T10:00:00Z", expiresAt: "2026-07-21T10:00:00Z" }
      ]
    })
  );
  const claimed = readAssignments(NOW, fixture);
  rmSync(fixture, { force: true });
  check("two fixture claims are read", claimed.stats.claims === 2, `got ${claimed.stats.claims}`);
  check(
    "every assignee is sourced to assignments.json",
    claimed.claims.size === 2 && [...claimed.claims.values()].every((c) => c.source === "assignments.json"),
    "an assignee is an authoritative claim; nothing derived may populate it"
  );
  check(
    "an expired claim is marked expired, not silently dropped",
    claimed.claims.get("bead:awkit-cxa")?.expired === true && claimed.stats.expired === 1,
    "a stale claim shown as current is worse than no claim"
  );
  check("an unexpired claim is not marked expired", claimed.claims.get("bead:awkit-7lj")?.expired === false);
  // The hazard is a STALE claim, not a claim. assignments.json exists precisely so an agent can
  // record sustained work, and the dashboard renders that as an Assignee chip; requiring the shipped
  // file to be empty made the feature unusable, because any honest claim failed this gate. Worse, the
  // only way to satisfy it was to delete another agent's live claim - which causes exactly the
  // misattribution the file was added to prevent. Assert what actually matters: nothing shipped is
  // already expired.
  const shipped = readAssignments(NOW);
  check(
    "no EXPIRED claim is shipped in the claims file",
    shipped.stats.expired === 0,
    `tools/roadmap/assignments.json ships ${shipped.stats.claims} claim(s), ${shipped.stats.expired} expired; a stale claim misattributes work`
  );
  const withActivity = snapshot.items.filter((i) => i.areaActivity);
  check("derived activity exists to test", withActivity.length > 0);
  check(
    "every derived activity is labelled task-log and derived",
    withActivity.every((i) => i.areaActivity.source === "task-log" && i.areaActivity.confidence === "derived")
  );
  check(
    "no task-log attribution sets a claim state",
    withActivity.every((i) => i.areaActivity.state === undefined),
    "a past-tense log entry must never be able to look like an active claim"
  );
  check(
    "every link declares a confidence",
    snapshot.links.links.every((l) => typeof l.confidence === "string" && l.confidence.length > 0)
  );
  check(
    "at least one cited id is unresolved and preserved",
    snapshot.links.stats.unresolvedTokens >= 1,
    "CMP-CON-002 proves the Detected by join is lossy; if this reaches 0 the honest path is untested"
  );
  check(
    "every area carries a confidence and a basis",
    snapshot.items.every((i) => i.area && typeof i.area.confidence === "string" && typeof i.area.basis === "string")
  );

  // Area weighting. Every case below returned the WRONG value before the weighting fix, when title
  // and body were concatenated into one haystack and the keyword list's own order decided.
  check(
    "a title keyword outranks a body keyword",
    deriveAreaWeighted("Settings full-page coverage", "extends verify:recorder-gui", "title", "description").value ===
      "Settings",
    "a Settings issue was filed under Recorder because its body cited a recorder verifier"
  );
  check(
    "the earliest keyword in a scope wins, not the first in the keyword list",
    deriveAreaWeighted("Settings coverage: unavailable secret-store GUI", "", "title", "description").value ===
      "Settings",
    "`secret` precedes `settings` in the keyword table; position must decide, not list order"
  );
  check(
    "a body keyword is still used when the title is silent",
    deriveAreaWeighted("Phase 4 follow-up", "the popup registration path", "title", "description").value ===
      "Runner / engine"
  );
  check(
    "the body's basis says the title was silent",
    deriveAreaWeighted("Phase 4 follow-up", "the popup path", "title", "description").basis.includes(
      "no keyword in title"
    ),
    "a weaker signal must announce itself"
  );
  check(
    "no keyword anywhere stays unclassified rather than guessing",
    deriveAreaWeighted("Phase 4 follow-up", "nothing recognisable", "title", "description").value === null
  );
  check(
    "the five Test Lab issues are all filed under Test Lab",
    snapshot.items.filter((i) => i.nativeId.startsWith("awkit-wza.")).every((i) => i.area.value === "Test Lab"),
    "they were scattered across Reports, Licensing and Security by body keywords"
  );
  check(
    "the consistency banner checked something",
    snapshot.consistency.checked >= 2,
    `checked ${snapshot.consistency.checked}`
  );

  /* ======================================================================
     9. Server
     ====================================================================== */
  console.log("Server:");
  process.env.ROADMAP_PORT = "0"; // ephemeral: never collide with a dashboard the owner is running
  const { server } = await import("../tools/roadmap/server.mjs");
  await new Promise((resolve) => (server.listening ? resolve() : server.once("listening", resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const snapRes = await fetch(`${base}/api/snapshot`);
  const etag = snapRes.headers.get("ETag");
  const payload = await snapRes.json();
  check("/api/snapshot returns 200", snapRes.status === 200, `got ${snapRes.status}`);
  check("/api/snapshot sends an ETag", typeof etag === "string" && etag.length > 0);
  check(
    "the payload carries every top-level section",
    ["items", "order", "links", "consistency", "ledger", "defects", "traceability", "phases", "sources", "stats"].every(
      (key) => key in payload
    )
  );
  const revalidated = await fetch(`${base}/api/snapshot`, { headers: { "If-None-Match": etag } });
  check("a matching If-None-Match returns 304", revalidated.status === 304, `got ${revalidated.status}`);

  const events = await fetch(`${base}/api/events`);
  check(
    "/api/events is an event stream",
    (events.headers.get("Content-Type") ?? "").startsWith("text/event-stream"),
    events.headers.get("Content-Type") ?? "none"
  );
  await events.body.cancel();

  const cssRes = await fetch(`${base}/app.css`);
  const cssBody = await cssRes.arrayBuffer();
  const cssOnDisk = statSync(sourcePath("globalCss")).size;
  check(
    "/app.css serves global.css byte-for-byte",
    cssBody.byteLength === cssOnDisk,
    `served ${cssBody.byteLength}, on disk ${cssOnDisk}`
  );

  const notFound = await fetch(`${base}/../package.json`);
  check("an unlisted path is 404", notFound.status === 404, `got ${notFound.status}`);
  const notAllowed = await fetch(`${base}/api/refresh`);
  check("GET /api/refresh is rejected", notAllowed.status === 405, `got ${notAllowed.status}`);

  server.close();

  /* ======================================================================
     10. Offline rules
     ====================================================================== */
  console.log("Offline:");
  const publicDir = join(ROADMAP_ROOT, "public");
  const assets = readdirSync(publicDir);
  check("the page has its assets", assets.length >= 6, assets.join(", "));
  // The SVG and XHTML namespace URIs are identifiers passed to createElementNS, not addresses —
  // nothing is ever fetched from them. They are removed before the scan so the check stays a real
  // test of "does this page reach the network" rather than a string match that has to be waived.
  const NAMESPACE_URIS = /https?:\/\/www\.w3\.org\/(2000\/svg|1999\/xhtml|1999\/xlink)/g;
  for (const file of assets) {
    const text = readFileSync(join(publicDir, file), "utf8");
    check(`${file} has no remote URL`, !/https?:\/\//.test(text.replace(NAMESPACE_URIS, "")));
    check(`${file} has no @import url(`, !/@import\s+url\(/.test(text));
  }
  // icon() falls back to ICON_NODES.circle for a name it does not know, so a typo or a status added
  // without its icon renders a plain circle and nothing fails. Resolve every referenced name here.
  const viewsSrc = readFileSync(join(publicDir, "views.js"), "utf8");
  const iconsSrc = readFileSync(join(publicDir, "icons.js"), "utf8");
  const definedIcons = new Set(
    [...iconsSrc.matchAll(/^ {2}"?([a-z][a-z0-9-]*)"?:\s*\[/gm)].map((m) => m[1])
  );
  const statusIconBlock = /const statusIcon = \{([\s\S]*?)\};/.exec(viewsSrc)?.[1] ?? "";
  // Capture ANY string content, not [a-z0-9-]+. A restrictive class silently skips the malformed
  // name instead of collecting it, so the membership test below would never see a typo — the check
  // would pass precisely when it was needed. (Verified by mutation: "circle-dashedX" must fail.)
  const referencedIcons = [
    ...[...viewsSrc.matchAll(/\b(?:icon|iconSpan|statCard)\(\s*"([^"]*)"/g)].map((m) => m[1]),
    ...[...statusIconBlock.matchAll(/:\s*"([^"]*)"/g)].map((m) => m[1])
  ];
  check(
    "the icon-name scan actually found names to resolve",
    definedIcons.size >= 20 && referencedIcons.length >= 10,
    `${definedIcons.size} defined, ${referencedIcons.length} referenced`
  );
  check(
    "every icon name views.js references is defined in icons.js",
    referencedIcons.every((name) => definedIcons.has(name)),
    referencedIcons.filter((name) => !definedIcons.has(name)).join(", ") || "-"
  );
  check(
    "every phase status maps to its own icon",
    ["complete", "in-progress", "partially-completed", "pending", "blocked"].every((s) =>
      new RegExp(`"?${s}"?:\\s*"`).test(statusIconBlock)
    ),
    statusIconBlock.trim()
  );
  check(
    "partially-completed renders a label, not its raw hyphenated value",
    /"partially-completed"\)\s*return\s*"Partially completed"/.test(viewsSrc.replace(/\s+/g, " ")),
    "the generic title-case path would render 'Partially-completed'"
  );
  check(
    "no asset builds markup with innerHTML",
    assets.every((f) => !/\.innerHTML\s*=/.test(readFileSync(join(publicDir, f), "utf8"))),
    "every string rendered here comes from repository prose and must be assigned as text"
  );

  /* ======================================================================
     11. The borrowed application classes still exist
     ====================================================================== */
  console.log("Borrowed application classes:");
  const globalCss = readSource("globalCss").text;
  const borrowed = [
    "app-shell",
    "app-main",
    "top-header",
    "left-navigation",
    "brand-block",
    "brand-tile",
    "nav-item",
    "nav-footer",
    "navigation-list",
    "work-panel",
    "section-heading",
    "page",
    "roadmap-grid",
    "roadmap-card",
    "roadmap-summary-grid",
    "roadmap-next-panel",
    "roadmap-card-header",
    "roadmap-deliverables",
    "roadmap-acceptance",
    // Phase status modifiers. The dashboard sets `roadmap-card <rawStatus>` and
    // `roadmap-status <rawStatus>` verbatim from the source file, so a status with no rule renders
    // as an unstyled chip rather than failing.
    "roadmap-status.complete",
    "roadmap-status.in-progress",
    "roadmap-status.partially-completed",
    "roadmap-status.pending",
    "roadmap-status.blocked",
    "roadmap-card.partially-completed"
  ];
  for (const name of borrowed) {
    check(
      `.${name} is still defined in global.css`,
      new RegExp(`\\.${name}[\\s.,:{>[]`).test(globalCss),
      "the dashboard reuses this rule; a rename would degrade the page silently"
    );
  }
  check(
    ".nav-item.active is the modifier the dashboard sets",
    /\.nav-item\.active[\s,{]/.test(globalCss),
    "dashboard.js applies `active`; if global.css renames it the nav loses its selected state"
  );
} catch (error) {
  failed += 1;
  console.error(error);
}

console.log(`\n${passed}/${passed + failed} roadmap dashboard checks passed`);
process.exit(failed === 0 ? 0 : 1);

/** A minimal open issue, shaped like normalize.mjs output, for the synthetic cycle. */
function makeIssue(id, dependsOn) {
  return {
    id,
    nativeId: id,
    kind: "issue",
    title: id,
    status: "open",
    rawStatus: "open",
    priority: 1,
    rawPriority: "P1",
    type: "bug",
    area: { value: null, confidence: "derived", basis: "synthetic" },
    dependsOn,
    blocks: [],
    related: [],
    evidence: [],
    source: { file: "synthetic", line: 0, sourceId: "synthetic" },
    updatedAt: null,
    body: "",
    flags: {}
  };
}
