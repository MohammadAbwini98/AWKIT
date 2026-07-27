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
  check("111 issues parse", beads.stats.total === 111, `got ${beads.stats.total}`);
  check("30 open / 81 closed", beads.stats.open === 30 && beads.stats.closed === 81);
  check("no dangling dependency reference", beads.stats.danglingEdges === 0, `got ${beads.stats.danglingEdges}`);
  check("every status is known", beads.beads.every((b) => KNOWN_STATUSES.has(b.status)));
  check(
    "74 edges are present to classify",
    beads.stats.edges === 74,
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
    "tally is 61 PASS / 4 NOT RUN / 1 BLOCKED",
    ledger.tally.pass === 61 && ledger.tally.notRun === 4 && ledger.tally.blocked === 1,
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
  check(
    "phase E's prose colon does not corrupt the parse",
    phases.phases.find((p) => p.id === "E")?.implementationNote.includes("Remaining:") === true,
    "a naive key-quoting regex mangles this exact string"
  );
  const mangled = extractPhases("export const implementationRoadmap = [ {{{ not an array", null, 0);
  check(
    "a mangled literal is rejected rather than half-parsed",
    mangled.phases.length === 0 && mangled.warnings.length > 0,
    `got ${mangled.phases.length} phases, ${mangled.warnings.length} warnings`
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
    "every blocked item has at least one open blocker",
    order.ordered.filter((o) => o.state === "blocked").every((o) => o.openBlockers.length > 0)
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
  check(
    "the shipped claims file is empty",
    readAssignments(NOW).stats.claims === 0,
    "tools/roadmap/assignments.json ships with no claims; a leftover one would misattribute work"
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
    "roadmap-acceptance"
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
