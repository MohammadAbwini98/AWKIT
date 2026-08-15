/**
 * verify:agent-routing — static source validation for the deterministic routing system.
 *
 * What regression makes this fail?
 *   - the agent registry, path map, or activation rules become internally inconsistent (an unknown
 *     agent id, a writer that owns nothing, a path domain with no owner);
 *   - the evidence vocabulary drifts from the validation ledger's own LEDGER_STATUSES, recreating
 *     the second-vocabulary problem this system exists to avoid;
 *   - the glob matcher stops matching a path it must match, or starts matching one it must not —
 *     the failure mode that would let a scope escape read as "no domain touched";
 *   - routing stops being deterministic, or a mandatory specialist stops being mandatory;
 *   - a contract rule stops FIRING: every rejection rule below is driven by a fixture that violates
 *     it, so a rule that silently became unreachable fails here instead of passing forever;
 *   - a vacuity guard is removed, so a completion gate could pass with nothing proven;
 *   - the write lease stops blocking an out-of-scope path, or an amendment widens a lease into
 *     another specialist's territory instead of rerouting;
 *   - the rendered ROUTING_MATRIX.md disagrees with the registry it is generated from.
 *
 * Deliberately .mjs: tsconfig.scripts.json covers .mts only and verify-source-hygiene globs
 * .ts/.mts/.tsx, so this file stays outside both — matching verify-roadmap-dashboard.mjs. It never
 * launches a browser or the Electron app, which is why it is static-source-validation.
 */

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LEDGER_STATUSES } from "../tools/roadmap/lib/parse-ledger.mjs";
import {
  ACTIVATION_RULES,
  AGENTS,
  AGENT_IDS,
  CLASSIFICATION_FLAGS,
  EVIDENCE_STATUSES,
  PATH_DOMAINS,
  PROTECTED_PATHS,
  RISK_3_FLAGS,
  ROLE_SKILLS,
  SHARED_WRITE_PATHS,
  WATCHED_IGNORED_PATHS,
  WRITER_PRECEDENCE,
  agent,
  domainForPath,
  matchGlob,
  pathInScope,
  protectedPathFor,
  riskLevelFor,
  sharedWritePathFor,
  toolsFor,
  watchedIgnoredPathFor
} from "../tools/agents/routing-matrix.mjs";
import {
  MAPPED_OWNERS,
  deriveClassification,
  deriveGuardedFieldChanges,
  findGuardedFieldEscapes,
  findScopeEscapes,
  normalizeClassification
} from "../tools/agents/classify.mjs";
import { leaseScopeFor, route } from "../tools/agents/route.mjs";
import { MATRIX_DOC_PATH, renderMatrix } from "../tools/agents/render-docs.mjs";
import { allGeneratedFiles } from "../tools/agents/render-platform-agents.mjs";
import {
  completionBlockers,
  requireCardinality,
  validateContract
} from "../tools/agents/validate-contract.mjs";
import {
  SYSTEM_BOOKKEEPING_PATHS,
  amendLease,
  changedWatchedIgnored,
  fingerprintWatchedIgnored,
  dirtyPaths,
  grantLease,
  leaseAllows,
  outOfLeaseWrites,
  readLease,
  unclaimedProtectedWrites,
  releaseLease
} from "../tools/agents/lease.mjs";
import { decideWrite, targetPathOf } from "../tools/agents/lease-guard.mjs";

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

/** A contract that must be VALID. Every rejection fixture below is this, minimally damaged. */
function validContract() {
  return {
    version: 1,
    task: { id: "awkit-fixture", title: "Fixture", objective: "Prove the rules fire.", risk_level: 1 },
    repository: { branch: "main", baseline_commit: "HEAD" },
    classification: { renderer_visual_change: true, cross_layer_count: 1 },
    routing: {
      manager: "manager",
      activated_agents: ["manager", "uiux", "frontend", "qa"],
      expected_paths: ["app/renderer/components/Thing.tsx"],
      writer: { agent_id: "frontend", allowed_paths: ["app/renderer/components/Thing.tsx"] },
      reviewers: ["qa"]
    },
    acceptance: [{ id: "AC-001", description: "It looks right.", evidence_required: ["EV-001"] }],
    evidence: [{ id: "EV-001", type: "build", command: "npm run build", required: true, result: "PASS" }],
    git: { direct_main: true, force_push: false },
    completion: { status: "pending", qa_status: "PASS", qc_status: "NOT_REQUIRED" }
  };
}

/** Does validating `mutate(validContract())` produce a violation with this rule id? */
function rejects(ruleId, mutate) {
  const contract = validContract();
  mutate(contract);
  const { violations } = validateContract(contract);
  return violations.some((v) => v.rule === ruleId);
}

const tempDirs = [];
function tempFile(name, contents) {
  const dir = mkdtempSync(join(tmpdir(), "awkit-routing-"));
  tempDirs.push(dir);
  const path = join(dir, name);
  writeFileSync(path, contents, "utf8");
  return path;
}

try {
  /* ======================================================================
     1. Registry integrity
     ====================================================================== */
  console.log("Registry:");
  check("11 agents are registered", AGENTS.length === 11, `got ${AGENTS.length}`);
  check("agent ids are unique", new Set(AGENT_IDS).size === AGENT_IDS.length);
  check(
    "every agent states a mandate",
    AGENTS.every((a) => typeof a.mandate === "string" && a.mandate.length > 20)
  );
  check(
    "every writer-mode agent owns at least one path",
    AGENTS.filter((a) => a.defaultMode === "writer").every((a) => a.ownsPaths.length > 0)
  );
  check(
    "read-only agents own no product code",
    AGENTS.filter((a) => a.defaultMode === "read-only").every((a) =>
      a.ownsPaths.every((p) => p.startsWith("docs/"))
    )
  );
  check(
    "every activation rule targets a known agent",
    ACTIVATION_RULES.every((r) => AGENT_IDS.includes(r.agent))
  );
  check(
    "every activation rule cites only known flags",
    ACTIVATION_RULES.every((r) => r.anyFlag.every((f) => CLASSIFICATION_FLAGS.includes(f)))
  );
  check(
    "every path domain has a known owner",
    PATH_DOMAINS.every((d) => AGENT_IDS.includes(d.owner))
  );
  check(
    "every implied flag is a known flag",
    PATH_DOMAINS.every((d) => d.impliesFlags.every((f) => CLASSIFICATION_FLAGS.includes(f)))
  );
  check(
    "writer precedence covers every writer-mode agent",
    AGENTS.filter((a) => a.defaultMode === "writer").every((a) => WRITER_PRECEDENCE.includes(a.id))
  );
  check("path map is non-empty", PATH_DOMAINS.length >= 20, `got ${PATH_DOMAINS.length}`);
  check(
    "every owned path is reachable through the path map",
    MAPPED_OWNERS.length >= 6,
    `mapped owners: ${MAPPED_OWNERS.join(", ")}`
  );

  /* ── The two ownership lists must agree ──────────────────────────────────────────────────────
     AGENTS[].ownsPaths is what a LEASE is checked against; PATH_DOMAINS[].owner is what DERIVED
     CLASSIFICATION uses. They are two statements of the same fact, and dogfooding this system on
     its own Phase 5 immediately proved they can drift: `tools/agents/**` was mapped to the manager
     for classification while missing from the manager's ownsPaths entirely, so a lease amendment
     rerouted work to the specialist who already owned it. These checks make that disagreement
     impossible to reintroduce quietly. */
  const probe = (glob) => glob.replace(/\*\*/g, "__probe__").replace(/\*/g, "__probe__");

  for (const a of AGENTS) {
    for (const owned of a.ownsPaths) {
      const resolved = domainForPath(probe(owned));
      check(
        `ownsPaths "${owned}" resolves to ${a.id} in the path map`,
        resolved?.owner === a.id,
        `resolved to ${resolved?.owner ?? "NOTHING"}`
      );
    }
  }

  for (const d of PATH_DOMAINS) {
    const owned = agent(d.owner).ownsPaths;
    check(
      `path domain "${d.glob}" is inside ${d.owner}'s ownsPaths`,
      pathInScope(probe(d.glob), owned),
      `${d.owner} owns [${owned.join(", ")}]`
    );
  }

  /* ── Roles reference existing skills, and no skill is orphaned ───────────────────────────── */
  const installedSkills = readdirSync(new URL("../.claude/skills", import.meta.url), {
    withFileTypes: true
  })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  check("skills are installed to reconcile against", installedSkills.length >= 10, `${installedSkills.length}`);
  check(
    "every role's skills exist on disk",
    Object.values(ROLE_SKILLS).every((list) => list.every((s) => installedSkills.includes(s))),
    Object.entries(ROLE_SKILLS)
      .flatMap(([role, list]) => list.filter((s) => !installedSkills.includes(s)).map((s) => `${role}:${s}`))
      .join(", ")
  );
  check(
    "every ROLE_SKILLS key is a known agent",
    Object.keys(ROLE_SKILLS).every((id) => AGENT_IDS.includes(id))
  );
  check(
    "every installed skill is claimed by at least one role",
    installedSkills.every((s) => Object.values(ROLE_SKILLS).some((list) => list.includes(s))),
    installedSkills.filter((s) => !Object.values(ROLE_SKILLS).some((l) => l.includes(s))).join(", ")
  );
  check(
    "read-only agents receive no write tools",
    AGENTS.filter((a) => a.defaultMode === "read-only").every(
      (a) => !/\bEdit\b|\bWrite\b/.test(toolsFor(a.id))
    )
  );
  check(
    "writer agents receive write tools",
    AGENTS.filter((a) => a.defaultMode === "writer").every((a) => /\bEdit\b/.test(toolsFor(a.id)))
  );

  /* ======================================================================
     2. Evidence vocabulary — one repository truth
     ====================================================================== */
  console.log("Evidence vocabulary:");
  const ledger = [...LEDGER_STATUSES].sort();
  const ours = [...EVIDENCE_STATUSES].sort();
  check(
    "evidence statuses equal the ledger's LEDGER_STATUSES exactly",
    JSON.stringify(ledger) === JSON.stringify(ours),
    `ledger=${ledger.join("|")} routing=${ours.join("|")}`
  );
  check("no underscored NOT_RUN variant exists", !EVIDENCE_STATUSES.includes("NOT_RUN"));
  check("INCONCLUSIVE was not reintroduced", !EVIDENCE_STATUSES.includes("INCONCLUSIVE"));

  /* ======================================================================
     3. Glob matcher — positive AND negative, because a matcher that under-matches
        would let a scope escape read as "nothing touched"
     ====================================================================== */
  console.log("Glob matcher:");
  const globCases = [
    ["app/renderer/**", "app/renderer/App.tsx", true],
    ["app/renderer/**", "app/renderer/a/b/c.tsx", true],
    ["app/renderer/**", "app/main/index.ts", false],
    ["app/main/ipc/**", "app/main/ipc/execution.ipc.ts", true],
    ["app/main/ipc/**", "app/main/window.ts", false],
    ["scripts/verify-*", "scripts/verify-runner.mts", true],
    ["scripts/verify-*", "scripts/validate-offline.mts", false],
    ["scripts/verify-*", "scripts/lib/helper.ts", false],
    ["package.json", "package.json", true],
    ["package.json", "app/package.json", false],
    ["src/orchestrator/**", "src/orchestrator/queue.ts", true],
    ["src/orchestrator/**", "src/orchestration/queue.ts", false]
  ];
  for (const [glob, path, want] of globCases) {
    check(`glob ${glob} ${want ? "matches" : "rejects"} ${path}`, matchGlob(glob, path) === want);
  }
  check(
    "src/orchestration does not exist in the path map (it is src/orchestrator)",
    !PATH_DOMAINS.some((d) => d.glob.startsWith("src/orchestration/"))
  );

  /* ======================================================================
     4. Derived classification
     ====================================================================== */
  console.log("Derived classification:");
  const derivedIpc = deriveClassification(["app/main/ipc/execution.ipc.ts"]);
  check("ipc path implies ipc_change", derivedIpc.flags.includes("ipc_change"));
  check("ipc path is owned by runtime", derivedIpc.domains.includes("runtime"));

  const derivedMixed = deriveClassification([
    "app/renderer/App.tsx",
    "src/storage/store.ts",
    "src/licensing/validate.ts"
  ]);
  check("three domains give cross_layer_count 3", derivedMixed.crossLayerCount === 3, `got ${derivedMixed.crossLayerCount}`);
  check("licensing path implies licensing_change", derivedMixed.flags.includes("licensing_change"));
  check(
    "renderer path implies NO visual flag (not path-determinable)",
    !derivedMixed.flags.includes("renderer_visual_change")
  );

  const unmapped = deriveClassification(["some/unknown/place.ts"]);
  check("an unmapped path is reported, not silently owned", unmapped.unmappedFiles.length === 1);
  check("an unmapped path yields no domain", unmapped.domains.length === 0);

  const escapes = findScopeEscapes(
    { renderer_visual_change: true },
    deriveClassification(["src/storage/store.ts"]),
    ["manager", "frontend"]
  );
  check("touching persistence under a frontend contract is a scope escape", escapes.length > 0);
  check(
    "the escape names the unactivated domain",
    escapes.some((e) => e.kind === "domain" && e.subject === "persistence")
  );
  check(
    "declaring MORE than touched is not an escape",
    findScopeEscapes(
      { renderer_visual_change: true, migration_required: true },
      deriveClassification(["app/renderer/App.tsx"]),
      ["manager", "frontend", "persistence"]
    ).length === 0
  );

  const unknownFlag = normalizeClassification({ persistance_change: true });
  check("a misspelled flag is rejected, not ignored", unknownFlag.errors.length === 1);
  check("a valid flag normalizes cleanly", normalizeClassification({ ipc_change: true }).errors.length === 0);

  /* ======================================================================
     5. Risk and routing
     ====================================================================== */
  console.log("Risk and routing:");
  check("licensing is Risk 3", riskLevelFor({ licensing_change: true }) === 3);
  check("migration is Risk 3", riskLevelFor({ migration_required: true }) === 3);
  check("ipc alone is Risk 2", riskLevelFor({ ipc_change: true }) === 2);
  check(
    "packaging alone is Risk 2, not 3 (the §15/§30 contradiction, resolved)",
    riskLevelFor({ packaging_change: true }) === 2
  );
  check("packaging + signing is Risk 3", riskLevelFor({ packaging_change: true, signing_change: true }) === 3);
  check("a visual-only change is Risk 1", riskLevelFor({ renderer_visual_change: true }) === 1);
  check("documentation is Risk 0", riskLevelFor({}) === 0);
  check("cross_layer_count 3 alone reaches Risk 2", riskLevelFor({ cross_layer_count: 3 }) === 2);
  check(
    "every Risk 3 flag really returns 3",
    RISK_3_FLAGS.every((flag) => riskLevelFor({ [flag]: true }) === 3)
  );

  const a = route(normalizeClassification({ licensing_change: true }).classification);
  const b = route(normalizeClassification({ licensing_change: true }).classification);
  check("routing is deterministic for identical input", JSON.stringify(a) === JSON.stringify(b));
  check("licensing activates security", a.activated.includes("security"));
  check("licensing activates qc", a.activated.includes("qc"));
  check("licensing activates architect", a.activated.includes("architect"));
  check("manager is always activated", a.activated.includes("manager"));
  check("every activation carries a stated trigger", a.rationale.every((r) => r.trigger.length > 0));

  const migration = route(normalizeClassification({ migration_required: true }).classification);
  check("migration activates persistence", migration.activated.includes("persistence"));

  const packaging = route(normalizeClassification({ packaging_change: true }).classification);
  check("packaging activates release", packaging.activated.includes("release"));

  const wide = route(normalizeClassification({ cross_layer_count: 3 }).classification);
  check("cross_layer_count 3 activates architect", wide.activated.includes("architect"));

  const docs = route(normalizeClassification({}).classification);
  check("a Risk 0 documentation task does not activate qc", !docs.activated.includes("qc"));
  check("a Risk 0 documentation task does not activate qa", !docs.activated.includes("qa"));

  const visual = route(normalizeClassification({ renderer_visual_change: true }).classification);
  check("a visual change activates uiux", visual.activated.includes("uiux"));
  check("a visual change activates qa", visual.activated.includes("qa"));
  check("a visual change does NOT activate qc (Risk 1 fast path)", !visual.activated.includes("qc"));

  const multi = route(
    normalizeClassification({ persisted_shape_change: true, ipc_change: true }).classification
  );
  check(
    "a multi-domain task yields an ordered writer sequence",
    multi.writerSequence.length >= 2,
    multi.writerSequence.join(" -> ")
  );
  check(
    "persistence precedes runtime in the lease order",
    multi.writerSequence.indexOf("persistence") < multi.writerSequence.indexOf("runtime")
  );

  /* ── writerSequence names only agents that will actually hold a lease (awkit-yeh) ──────────
     Regression from the first real routed task: `filesystem_write_change` activated persistence,
     which then LED the writer sequence for a task whose only file was runtime's. The narrowing must
     drop it — and, more importantly, must never empty the sequence, because validate-contract
     derives "changes product code" from its length and would otherwise stop requiring a writer. */
  {
    const cls = normalizeClassification({
      electron_main_change: true,
      filesystem_write_change: true
    }).classification;

    const unscoped = route(cls);
    const scoped = route(cls, { expectedPaths: ["app/main/uiSettings.ts"] });

    check(
      "without declared paths, every activated writer stays in the sequence",
      unscoped.writerSequence.includes("persistence") && unscoped.writerSequence.includes("runtime"),
      unscoped.writerSequence.join(" -> ")
    );
    check(
      "with a runtime-only path, persistence is dropped from the writer sequence",
      !scoped.writerSequence.includes("persistence"),
      scoped.writerSequence.join(" -> ")
    );
    check(
      "the path owner remains the writer",
      scoped.writerSequence.includes("runtime"),
      scoped.writerSequence.join(" -> ")
    );
    check(
      "the dropped writer is reclassified as a consultant, not discarded",
      scoped.consultants.includes("persistence"),
      `consultants=${scoped.consultants.join(", ")}`
    );
    check("narrowing is reported", scoped.writerSequenceNarrowed === true);
    check("no narrowing is reported when no paths are declared", unscoped.writerSequenceNarrowed === false);

    // The fail-open guard. Paths that no activated writer owns must NOT empty the sequence.
    const unmapped = route(cls, { expectedPaths: ["some/unmapped/place.ts"] });
    check(
      "unmapped paths fall back to the full writer list rather than emptying it",
      unmapped.writerSequence.length === unscoped.writerSequence.length,
      unmapped.writerSequence.join(" -> ")
    );
    check("the fallback reports itself as un-narrowed", unmapped.writerSequenceNarrowed === false);

    // And the consequence that actually matters: a contract for such a task still needs a writer.
    const stillNeedsWriter = validContract();
    stillNeedsWriter.classification = { electron_main_change: true, cross_layer_count: 1 };
    stillNeedsWriter.routing.expected_paths = ["some/unmapped/place.ts"];
    stillNeedsWriter.routing.activated_agents = ["manager", "runtime", "qa", "qc"];
    stillNeedsWriter.routing.reviewers = ["qa", "qc"];
    stillNeedsWriter.completion.qc_status = "APPROVED";
    delete stillNeedsWriter.routing.writer;
    check(
      "a task with unmapped paths still fails without a writer (no fail-open)",
      validateContract(stillNeedsWriter).violations.some((v) => v.rule === "writer.absent"),
      JSON.stringify(validateContract(stillNeedsWriter).violations.map((v) => v.rule))
    );

    // The manager is writer-mode and activated on EVERY task, so before narrowing it sat in every
    // writer sequence regardless of what the task touched. Ownership now governs it too.
    check(
      "the manager is not a writer for a task it owns no path in",
      !scoped.writerSequence.includes("manager"),
      scoped.writerSequence.join(" -> ")
    );
    check(
      "a runtime-only task narrows to exactly one writer",
      JSON.stringify(scoped.writerSequence) === JSON.stringify(["runtime"]),
      scoped.writerSequence.join(" -> ")
    );

    // A documentation task genuinely IS the manager's to write, so it keeps the lease here.
    const docsOnly = route(normalizeClassification({}).classification, {
      expectedPaths: ["docs/ai/CURRENT_STATE.md"]
    });
    check(
      "a documentation task routes the manager as its writer",
      JSON.stringify(docsOnly.writerSequence) === JSON.stringify(["manager"]),
      docsOnly.writerSequence.join(" -> ")
    );
    check("a Risk 0 documentation task activates no reviewer", docsOnly.reviewers.length === 0);
  }

  const scope = leaseScopeFor("frontend", ["app/renderer/x.tsx", "src/storage/y.ts"]);
  check("a lease scope keeps only what its holder owns", JSON.stringify(scope.allowed) === JSON.stringify(["app/renderer/x.tsx"]));
  check("a lease scope forbids other agents' territory", scope.forbidden.includes("src/storage/**"));

  /* ======================================================================
     6. Contract validation — every rule proven to FIRE
     ====================================================================== */
  console.log("Contract rules (each driven by a violating fixture):");
  check("the baseline fixture is VALID", validateContract(validContract()).ok,
    JSON.stringify(validateContract(validContract()).violations));

  check("rejects a contract with no manager", rejects("manager.absent", (c) => {
    c.routing.activated_agents = c.routing.activated_agents.filter((x) => x !== "manager");
  }));
  check("rejects a missing mandatory specialist", rejects("activation.missing", (c) => {
    c.classification.licensing_change = true;
  }));
  check("rejects more than one writer", rejects("writer.multiple", (c) => {
    c.routing.writer = [{ agent_id: "frontend" }, { agent_id: "runtime" }];
  }));
  check("rejects a writer outside the routed sequence", rejects("writer.unrouted", (c) => {
    c.routing.writer.agent_id = "release";
  }));
  check("rejects a writer with no allowed_paths", rejects("writer.no_paths", (c) => {
    c.routing.writer.allowed_paths = [];
  }));
  check("rejects a lease exceeding its holder's ownership", rejects("writer.scope_exceeds_ownership", (c) => {
    c.routing.writer.allowed_paths = ["src/licensing/**"];
  }));
  check("rejects understated risk", rejects("risk.understated", (c) => {
    c.classification.licensing_change = true;
    c.task.risk_level = 1;
    c.routing.activated_agents = [...c.routing.activated_agents, "security", "qc", "architect"];
  }));
  check("rejects an empty required-evidence set", rejects("evidence.no_required", (c) => {
    c.evidence = [{ id: "EV-001", type: "build", required: false, result: "PASS" }];
  }));
  check("rejects a foreign evidence status", rejects("evidence.status", (c) => {
    c.evidence[0].result = "INCONCLUSIVE";
  }));
  check("rejects acceptance with no evidence link", rejects("acceptance.unproven", (c) => {
    c.acceptance[0].evidence_required = [];
  }));
  check("rejects acceptance citing unknown evidence", rejects("acceptance.dangling", (c) => {
    c.acceptance[0].evidence_required = ["EV-999"];
  }));
  check("rejects no acceptance criteria", rejects("acceptance.empty", (c) => {
    c.acceptance = [];
  }));
  check("rejects direct_main false", rejects("git.direct_main", (c) => {
    c.git.direct_main = false;
  }));
  check("rejects force_push", rejects("git.force_push", (c) => {
    c.git.force_push = true;
  }));
  check("rejects an override with no reason", rejects("override.no_reason", (c) => {
    c.write_lease = { overrides: [{ timestamp: "t", affected_paths: ["x"], qc_required: true }] };
    c.completion.qc_status = "APPROVED";
  }));
  check("rejects an override that exempts itself from QC", rejects("override.no_qc", (c) => {
    c.write_lease = { overrides: [{ timestamp: "t", reason: "r", affected_paths: ["x"], qc_required: false }] };
  }));
  check("rejects an override whose forced QC never resolved", rejects("override.qc_unresolved", (c) => {
    c.write_lease = { overrides: [{ timestamp: "t", reason: "r", affected_paths: ["x"], qc_required: true }] };
    c.completion.qc_status = "pending";
  }));

  /* ======================================================================
     7. Vacuity guards
     ====================================================================== */
  console.log("Vacuity guards:");
  check("requireCardinality flags an empty collection", requireCardinality([], 1, "x") !== null);
  check("requireCardinality passes a populated one", requireCardinality([1], 1, "x") === null);

  const allOptional = validContract();
  allOptional.evidence = allOptional.evidence.map((e) => ({ ...e, required: false }));
  const optionalBlockers = completionBlockers(allOptional);
  check(
    "a contract whose evidence is all optional CANNOT complete",
    optionalBlockers.length > 0,
    "this is the .every()-over-empty trap the reviewed proposal left open"
  );

  // The check above is NOT enough on its own, and mutation testing proved it: deleting the
  // completion gate's own cardinality guard left it green, because `validateContract` independently
  // rejects an empty required set and that one blocker satisfied "length > 0". The assertion was
  // being met by a mechanism other than the one it names — so assert the gate's OWN blocker text.
  check(
    "the completion gate raises its own vacuity blocker (not merely inheriting the validator's)",
    optionalBlockers.some((b) => b.includes("required evidence") && b.includes("vacuously")),
    JSON.stringify(optionalBlockers)
  );
  check(
    "both guards fire independently for an empty required set",
    optionalBlockers.filter((b) => /required evidence|contract is invalid/.test(b)).length === 2,
    `got ${optionalBlockers.length} blocker(s): ${JSON.stringify(optionalBlockers)}`
  );

  const blockedEvidence = validContract();
  blockedEvidence.evidence[0].result = "BLOCKED";
  check("BLOCKED evidence blocks completion", completionBlockers(blockedEvidence).length > 0);

  const notRun = validContract();
  notRun.evidence[0].result = "NOT RUN";
  check("NOT RUN evidence blocks completion", completionBlockers(notRun).length > 0);

  check("a fully proven contract has no blockers", completionBlockers(validContract()).length === 0,
    JSON.stringify(completionBlockers(validContract())));

  const escaped = validContract();
  escaped.scope_escapes = [{ kind: "domain", subject: "persistence" }];
  check("an unresolved scope escape blocks completion", completionBlockers(escaped).length > 0);

  const qcPending = validContract();
  qcPending.routing.reviewers = ["qa", "qc"];
  qcPending.completion.qc_status = "pending";
  check("pending QC blocks completion when QC is a reviewer", completionBlockers(qcPending).length > 0);

  /* ======================================================================
     8. Write lease — driven against fixtures, never the real lease file
     ====================================================================== */
  console.log("Write lease:");
  const leasePath = tempFile("active-lease.json", "");
  const assignPath = tempFile("assignments.json", JSON.stringify({ claims: [] }));
  rmSync(leasePath, { force: true });

  const granted = grantLease({
    task: "awkit-fixture",
    holder: "frontend",
    allowedPaths: ["app/renderer/**"],
    path: leasePath,
    assignmentsPath: assignPath
  });
  check("a lease can be granted", granted.status === "active");
  check("the lease allows an in-scope path", leaseAllows(granted, "app/renderer/App.tsx"));
  check("the lease BLOCKS an out-of-scope path", !leaseAllows(granted, "src/runner/exec.ts"));
  check("the lease blocks another specialist's territory", !leaseAllows(granted, "src/licensing/x.ts"));

  check(
    "the holder is mirrored into the claims file",
    JSON.parse(readFileSync(assignPath, "utf8")).claims.length === 1
  );

  let doubleGrant = false;
  try {
    grantLease({ task: "other", holder: "runtime", allowedPaths: ["app/main/**"], path: leasePath, assignmentsPath: assignPath });
  } catch {
    doubleGrant = true;
  }
  check("a second concurrent lease is refused", doubleGrant);

  let noReason = false;
  try {
    amendLease({ addPaths: ["app/renderer/other.tsx"], reason: "", path: leasePath, assignmentsPath: assignPath });
  } catch {
    noReason = true;
  }
  check("an amendment without a reason is refused", noReason);

  const extended = amendLease({
    addPaths: ["app/renderer/deep/Other.tsx"],
    reason: "same domain",
    path: leasePath,
    assignmentsPath: assignPath
  });
  check("an in-domain amendment EXTENDS the lease", extended.outcome === "extended");

  const rerouted = amendLease({
    addPaths: ["src/storage/store.ts"],
    reason: "persistence impact discovered",
    path: leasePath,
    assignmentsPath: assignPath
  });
  check("an out-of-domain amendment REROUTES instead of widening", rerouted.outcome === "reroute");
  check("rerouting names the specialist who owns the new path", rerouted.requiredAgents.includes("persistence"));
  check("rerouting releases the old lease", readLease(leasePath) === null);
  check("rerouting records the amendment for audit", rerouted.lease.amendments.length === 2);
  check(
    "rerouting clears the stale claim",
    JSON.parse(readFileSync(assignPath, "utf8")).claims.length === 0
  );

  /* ── Shared write paths: relaxed at edit time, strict on content (awkit-dwo) ───────────────
     package.json is release-owned because it carries the dependency graph, but adding a one-line
     npm script had to go through a full lease handoff — the guard runs BEFORE an edit and cannot
     see which key is changing. The gate is relaxed for such files and the enforcement moved to a
     content-aware derived check. Both halves are asserted here, because relaxing one without the
     other is precisely how a governance system quietly stops governing. */
  {
    const shared = { task: "t", holder: "qa", status: "active", allowed_paths: ["tests/**"], amendments: [], overrides: [] };
    check("a shared path is writable by any lease holder", leaseAllows(shared, "package.json"));
    check("a non-shared path is still blocked", !leaseAllows(shared, "src/runner/exec.ts"));
    check(
      "package.json is registered as shared for scripts only",
      sharedWritePathFor("package.json")?.sharedFields.join(",") === "scripts",
      JSON.stringify(sharedWritePathFor("package.json")?.sharedFields)
    );
    check("an unrelated file has no shared rule", sharedWritePathFor("src/runner/exec.ts") === null);

    const rules = [
      { glob: "package.json", owner: "release", sharedFields: ["scripts"], sharedFor: "t", note: "t" }
    ];
    const base = { name: "app", version: "1.0.0", scripts: { a: "x" }, dependencies: { left: "1.0.0" } };
    const derive = (current) =>
      deriveGuardedFieldChanges({
        rules,
        readCommitted: () => JSON.stringify(base),
        readCurrent: () => JSON.stringify(current)
      });

    // Adding a script is the whole point of the relaxation: permitted, and NOT an escape.
    const scriptOnly = derive({ ...base, scripts: { a: "x", b: "y" } });
    check("adding a script reports no guarded change", scriptOnly[0]?.changedGuardedFields.length === 0);
    check("adding a script is recorded as a shared change", scriptOnly[0]?.changedSharedFields.includes("scripts"));
    check(
      "adding a script is NOT a scope escape without release",
      findGuardedFieldEscapes(["manager", "qa"], { changes: scriptOnly }).length === 0
    );

    // A dependency edit is exactly what the ownership exists for.
    const depChange = derive({ ...base, dependencies: { left: "2.0.0" } });
    check("changing a dependency reports a guarded change", depChange[0]?.changedGuardedFields.includes("dependencies"));
    check(
      "changing a dependency IS a scope escape without release",
      findGuardedFieldEscapes(["manager", "qa"], { changes: depChange }).length === 1
    );
    check(
      "changing a dependency is NOT an escape when release is activated",
      findGuardedFieldEscapes(["manager", "release"], { changes: depChange }).length === 0
    );

    // Default-guarded: a key nobody listed is owned, not shared by omission.
    const newKey = derive({ ...base, workspaces: ["packages/*"] });
    check(
      "an unlisted new top-level key is guarded, not shared",
      newKey[0]?.changedGuardedFields.includes("workspaces"),
      JSON.stringify(newKey[0]?.changedGuardedFields)
    );

    // Removing a guarded key counts too — comparison is over the union of both key sets.
    const removed = derive({ name: "app", version: "1.0.0", scripts: { a: "x" } });
    check("removing a guarded key is detected", removed[0]?.changedGuardedFields.includes("dependencies"));

    // An unreadable file is not evidence of innocence.
    const unreadable = deriveGuardedFieldChanges({
      rules,
      readCommitted: () => "{ not json",
      readCurrent: () => JSON.stringify(base)
    });
    check(
      "an unparseable file is reported as guarded rather than clean",
      unreadable[0]?.changedGuardedFields.includes("<unreadable>")
    );

    // No change at all must produce nothing, or every task would report an escape.
    check("an identical file reports no change", derive(base).length === 0);
  }

  /* ── Bash bypass audit (awkit-c6n) ─────────────────────────────────────────────────────────
     The PreToolUse guard matches Edit|Write|NotebookEdit, so a shell redirect reaches past it. The
     audit observes the filesystem instead of parsing the command — deliberately, because a
     shell-parsing guard has false negatives (`python -c "open(...)"`) AND false positives
     (`echo "a > b"`). These checks drive the pure comparison directly; the hook is a thin wrapper. */
  {
    const auditLease = {
      task: "t",
      holder: "runtime",
      status: "active",
      allowed_paths: ["app/main/**"],
      baseline_dirty: ["docs/ai/TASK_LOG.md"],
      amendments: [],
      overrides: [],
      violations: []
    };

    check(
      "an in-lease shell write is not a violation",
      outOfLeaseWrites(auditLease, ["app/main/uiSettings.ts"]).length === 0
    );
    check(
      "an out-of-lease shell write IS detected",
      JSON.stringify(outOfLeaseWrites(auditLease, ["src/runner/exec.ts"])) ===
        JSON.stringify(["src/runner/exec.ts"])
    );
    check(
      "a file already dirty when the lease was granted is not blamed on this lease",
      outOfLeaseWrites(auditLease, ["docs/ai/TASK_LOG.md"]).length === 0
    );
    check(
      "a shared write path is not a violation",
      outOfLeaseWrites(auditLease, ["package.json"]).length === 0
    );
    // Found the first time the audit ran against a real lease: grantLease writes the lease file and
    // mirrors assignments.json AFTER snapshotting, so taking a lease reported itself.
    for (const path of SYSTEM_BOOKKEEPING_PATHS) {
      check(
        `the system's own bookkeeping (${path}) is never a violation`,
        outOfLeaseWrites(auditLease, [path]).length === 0
      );
    }
    // The bookkeeping exclusion must be an exact list, not a shape. Mutation-testing caught this:
    // widening it to "every .json" survived, because every other out-of-lease fixture here is .ts.
    check(
      "an ordinary out-of-lease .json is still a violation (exclusion is a list, not a pattern)",
      JSON.stringify(outOfLeaseWrites(auditLease, ["src/data/fixture.json"])) ===
        JSON.stringify(["src/data/fixture.json"])
    );
    check(
      "the bookkeeping exclusion is exactly two known paths",
      SYSTEM_BOOKKEEPING_PATHS.length === 2,
      SYSTEM_BOOKKEEPING_PATHS.join(", ")
    );
    check(
      "a lease with no recorded baseline over-reports rather than staying silent",
      outOfLeaseWrites({ ...auditLease, baseline_dirty: undefined }, ["docs/ai/TASK_LOG.md"]).length === 1
    );
    check(
      "several out-of-lease writes are all reported, sorted",
      JSON.stringify(outOfLeaseWrites(auditLease, ["src/z.ts", "src/a.ts"])) ===
        JSON.stringify(["src/a.ts", "src/z.ts"])
    );

    // Detection only acquires consequences at the gate. Without this the audit is a warning to scroll past.
    const withViolation = validContract();
    check(
      "an unresolved out-of-lease write blocks completion",
      completionBlockers(withViolation, {
        lease: { violations: [{ path: "src/runner/exec.ts", resolved: false }] }
      }).some((b) => b.includes("out-of-lease")),
      JSON.stringify(completionBlockers(withViolation, { lease: { violations: [{ path: "x", resolved: false }] } }))
    );
    check(
      "a RESOLVED out-of-lease write does not block completion",
      completionBlockers(withViolation, {
        lease: { violations: [{ path: "src/runner/exec.ts", resolved: true }] }
      }).length === 0
    );
    check(
      "no lease passed means no out-of-lease blocker is invented",
      completionBlockers(withViolation).length === 0
    );

    // The parser must survive git's real porcelain shapes, not just the simple case.
    check("dirtyPaths is exported for the hook", typeof dirtyPaths === "function");
  }

  /* ── Protected paths close the no-lease gap (awkit-mtt) ────────────────────────────────────
     The guard allows every edit when no lease is held, because failing closed everywhere would
     block every task that does not use a contract. That is right for ordinary work and wrong for
     the areas the repository already treats as critical, so those specifically fail closed. The set
     is DERIVED from RISK_3_FLAGS rather than hand-listed, and these checks pin both the derivation
     and the fact that it is neither empty nor everything. */
  {
    check(
      "protected paths are derived from the Risk 3 flags, not hand-listed",
      PROTECTED_PATHS.every((d) => d.impliesFlags.some((f) => RISK_3_FLAGS.includes(f)))
    );
    check(
      "every path implying a Risk 3 flag IS protected",
      PATH_DOMAINS.filter((d) => d.impliesFlags.some((f) => RISK_3_FLAGS.includes(f))).every(
        (d) => protectedPathFor(d.glob.replace(/\*\*/g, "probe")) !== null
      )
    );
    // Non-vacuity in both directions: a set that is empty protects nothing, and a set that is
    // everything reinstates the fail-closed-everywhere behaviour this deliberately avoids.
    check("the protected set is non-empty", PROTECTED_PATHS.length >= 4, `${PROTECTED_PATHS.length}`);
    check(
      "the protected set is NOT everything",
      PROTECTED_PATHS.length < PATH_DOMAINS.length / 2,
      `${PROTECTED_PATHS.length} of ${PATH_DOMAINS.length}`
    );

    for (const p of ["src/licensing/x.ts", "src/auth/x.ts", "src/secrets/x.ts", "src/security/x.ts", "resources/x.bin"]) {
      check(`${p} is protected`, protectedPathFor(p) !== null);
    }
    for (const p of ["app/renderer/App.tsx", "src/runner/exec.ts", "docs/ai/TASK_LOG.md", "tests/x.ts"]) {
      check(`${p} is NOT protected (ordinary work stays unrestricted)`, protectedPathFor(p) === null);
    }

    // The Bash audit's symmetric half: with no lease, a dirty protected file is reported and an
    // ordinary one is not.
    check(
      "an unclaimed protected shell write is reported",
      JSON.stringify(unclaimedProtectedWrites(["src/licensing/x.ts", "app/renderer/App.tsx"])) ===
        JSON.stringify(["src/licensing/x.ts"])
    );
    check("no unclaimed protected write means silence", unclaimedProtectedWrites(["docs/ai/x.md"]).length === 0);

    // The guard's actual JUDGEMENT, not just its payload parser. Before this was extracted, only
    // targetPathOf() was covered, so flipping the protected-path branch changed no assertion.
    const held = { holder: "qa", allowed_paths: ["tests/**"], task: "t", status: "active" };
    check(
      "no lease + ordinary path -> allow",
      decideWrite(null, "app/renderer/App.tsx").allow === true
    );
    check(
      "no lease + protected path -> BLOCK",
      decideWrite(null, "src/licensing/x.ts").allow === false
    );
    check(
      "the block names why it is protected",
      decideWrite(null, "src/licensing/x.ts").reason === "protected-unclaimed"
    );
    check("lease + in-scope -> allow", decideWrite(held, "tests/x.ts").allow === true);
    check("lease + out-of-scope -> BLOCK", decideWrite(held, "src/runner/x.ts").allow === false);
    check(
      "a lease covering a protected path permits it",
      decideWrite({ ...held, allowed_paths: ["src/licensing/**"] }, "src/licensing/x.ts").allow === true
    );
  }

  /* ── Gitignored-but-consequential paths (awkit-6ab) ────────────────────────────────────────
     git status never reports ignored files, and enumerating them all is impossible (node_modules).
     Auditing this repo's own .gitignore found that "ignored" and "unimportant" are not the same:
     secrets, captured auth, the local permission file, and two subtrees INSIDE the protected
     offline boundary are all ignored. `build/**` was worse — release-owned and implying
     packaging_change while having zero tracked files, so its ownership pointed at nothing git
     could show. */
  {
    check("watched ignored paths are registered", WATCHED_IGNORED_PATHS.length >= 6, `${WATCHED_IGNORED_PATHS.length}`);
    check(
      "every watched ignored path names an owner and a reason",
      WATCHED_IGNORED_PATHS.every((w) => AGENT_IDS.includes(w.owner) && w.why.length > 20)
    );
    check(
      "the secrets file is watched",
      watchedIgnoredPathFor(".env") !== null
    );
    check(
      "the local permission override is watched",
      watchedIgnoredPathFor(".claude/settings.local.json") !== null
    );
    check(
      "a file INSIDE a watched ignored directory resolves to it",
      watchedIgnoredPathFor("resources/browsers/chromium/x.dll")?.path === "resources/browsers"
    );
    check(
      "an ordinary path is not treated as watched",
      watchedIgnoredPathFor("app/renderer/App.tsx") === null
    );
    // The two defects that motivated this. Both are ownership entries git could never show.
    check("the gitignored build/ tree is watched", watchedIgnoredPathFor("build/native-hosts/x") !== null);
    check(
      "the ignored subtrees of the protected offline boundary are watched",
      watchedIgnoredPathFor("resources/browsers") !== null &&
        watchedIgnoredPathFor("resources/oracle-jdbc") !== null
    );

    // The comparison itself, driven with plain objects rather than a filesystem.
    const base = { ".env": "absent", "build": "dir(1):a:1" };
    check("an unchanged fingerprint reports nothing", changedWatchedIgnored(base, { ...base }).length === 0);
    check(
      "a created secret is detected (absent -> present)",
      JSON.stringify(changedWatchedIgnored(base, { ...base, ".env": "12:345" })) === JSON.stringify([".env"])
    );
    check(
      "a changed directory fingerprint is detected",
      JSON.stringify(changedWatchedIgnored(base, { ...base, build: "dir(2):a:1|b:2" })) ===
        JSON.stringify(["build"])
    );
    check(
      "a deleted file is detected (present -> absent)",
      changedWatchedIgnored({ ".env": "12:345" }, { ".env": "absent" }).length === 1
    );
    // A lease predating the field must not read as proof that nothing happened.
    check(
      "a missing baseline reports everything rather than staying silent",
      changedWatchedIgnored(undefined, base).length === Object.keys(base).length
    );

    // Non-vacuity against the real repository: the fingerprint must actually produce entries.
    const live = fingerprintWatchedIgnored();
    check(
      "fingerprinting the real repo returns one entry per watched path",
      Object.keys(live).length === WATCHED_IGNORED_PATHS.length,
      `${Object.keys(live).length} of ${WATCHED_IGNORED_PATHS.length}`
    );
    check(
      "at least one watched path really exists here (the check is not all-absent)",
      Object.values(live).some((v) => v !== "absent"),
      JSON.stringify(live)
    );

    /* The PRODUCER, not just the comparator. Mutation testing caught this: every check above uses
       hand-written fixture strings, so breaking `fingerprintWatchedIgnored` itself — dropping
       mtimes from directory entries, or emitting "" instead of "absent" — changed no assertion.
       These drive the real function against a temp tree with known contents. */
    const sandbox = mkdtempSync(join(tmpdir(), "awkit-ignored-"));
    tempDirs.push(sandbox);

    const allAbsent = fingerprintWatchedIgnored(sandbox);
    check(
      "a missing watched path fingerprints as exactly \"absent\"",
      Object.values(allAbsent).every((v) => v === "absent"),
      JSON.stringify(allAbsent)
    );

    writeFileSync(join(sandbox, ".env"), "SECRET=1\n", "utf8");
    const withEnv = fingerprintWatchedIgnored(sandbox);
    check("a created file stops being \"absent\"", withEnv[".env"] !== "absent", withEnv[".env"]);
    check(
      "a file fingerprint carries size and mtime",
      /^\d+:\d+(\.\d+)?$/.test(withEnv[".env"]),
      withEnv[".env"]
    );

    mkdirSync(join(sandbox, "build"), { recursive: true });
    writeFileSync(join(sandbox, "build", "artifact.bin"), "one", "utf8");
    const dirPrint = fingerprintWatchedIgnored(sandbox).build;
    check("a directory fingerprint counts its entries", dirPrint.startsWith("dir(1):"), dirPrint);
    check(
      "a directory fingerprint carries each entry's mtime, not just its name",
      /artifact\.bin:\d+/.test(dirPrint),
      dirPrint
    );

    // Rewriting a file inside a watched directory must change the fingerprint. Without entry
    // mtimes this is exactly the case that would silently pass.
    const before = fingerprintWatchedIgnored(sandbox).build;
    const future = new Date(Date.now() + 5000);
    utimesSync(join(sandbox, "build", "artifact.bin"), future, future);
    check(
      "modifying a file inside a watched directory changes its fingerprint",
      fingerprintWatchedIgnored(sandbox).build !== before,
      `${before} -> ${fingerprintWatchedIgnored(sandbox).build}`
    );
  }

  const damaged = tempFile("damaged.json", "{ not json");
  let damagedThrew = false;
  try {
    readLease(damaged);
  } catch {
    damagedThrew = true;
  }
  check("a damaged lease throws rather than reading as absent", damagedThrew);
  check("an absent lease reads as null", readLease(join(tmpdir(), "awkit-no-such-lease.json")) === null);

  check("the guard reads Edit payloads", targetPathOf({ tool_input: { file_path: "a.ts" } }) === "a.ts");
  check("the guard reads NotebookEdit payloads", targetPathOf({ tool_input: { notebook_path: "b.ipynb" } }) === "b.ipynb");
  check("the guard ignores payloads with no target", targetPathOf({ tool_input: {} }) === null);

  /* ======================================================================
     9. Rendered documentation agrees with the registry
     ====================================================================== */
  console.log("Rendered documentation:");
  const matrixDoc = readFileSync(MATRIX_DOC_PATH, "utf8");
  const freshlyRendered = renderMatrix();

  // Byte-for-byte, not "contains every id". A containment check would still pass if someone hand-
  // edited a routing decision in the table while leaving the names in place — which is exactly the
  // drift that put the pseudocode, the table and the validator into disagreement in the first place.
  check(
    "the rendered matrix is byte-identical to the registry it derives from",
    matrixDoc === freshlyRendered,
    "run `node tools/agents/render-docs.mjs --write` — never hand-edit ROUTING_MATRIX.md"
  );
  check(
    "every agent id appears in the rendered matrix",
    AGENT_IDS.every((id) => matrixDoc.includes(`\`${id}\``)),
    AGENT_IDS.filter((id) => !matrixDoc.includes(`\`${id}\``)).join(", ")
  );
  check(
    "every classification flag appears in the rendered matrix",
    CLASSIFICATION_FLAGS.every((flag) => matrixDoc.includes(flag)),
    CLASSIFICATION_FLAGS.filter((f) => !matrixDoc.includes(f)).join(", ")
  );
  check("the rendered matrix declares itself derived", /derived|generated/i.test(matrixDoc));

  const schema = JSON.parse(
    readFileSync(new URL("../docs/ai/routing/TASK_CONTRACT.schema.json", import.meta.url), "utf8")
  );
  const schemaFlags = Object.keys(schema.properties?.classification?.properties ?? {}).filter(
    (k) => k !== "cross_layer_count"
  );
  check(
    "the contract schema lists exactly the registry's classification flags",
    JSON.stringify([...schemaFlags].sort()) === JSON.stringify([...CLASSIFICATION_FLAGS].sort()),
    `schema has ${schemaFlags.length}, registry has ${CLASSIFICATION_FLAGS.length}`
  );
  check(
    "the schema's evidence enum equals the ledger vocabulary",
    JSON.stringify([...(schema.$defs?.evidenceResult?.enum ?? [])].sort()) ===
      JSON.stringify([...EVIDENCE_STATUSES, "pending"].sort())
  );

  /* ======================================================================
     10. Generated platform agent definitions
     ====================================================================== */
  console.log("Generated platform definitions:");
  const generated = allGeneratedFiles();
  check(
    "one definition per agent, plus the two adapters",
    generated.length === AGENTS.length + 2,
    `got ${generated.length}`
  );

  for (const file of generated) {
    const rel = file.path.replace(/\\/g, "/").split("/").slice(-3).join("/");
    let onDisk = null;
    try {
      onDisk = readFileSync(file.path, "utf8");
    } catch {
      /* missing */
    }
    check(
      `${rel} is byte-identical to the registry it derives from`,
      onDisk === file.content,
      onDisk === null ? "file missing — run `npm run agent:render-agents`" : "drifted from the registry"
    );
  }

  // A read-only role must not be handed write tools by the GENERATOR either, not merely by the
  // registry — the frontmatter is what the runtime actually reads.
  for (const a of AGENTS.filter((x) => x.defaultMode === "read-only")) {
    const def = generated.find((f) => f.path.endsWith(`${a.id}.md`));
    check(
      `the generated ${a.id} definition grants no Edit/Write`,
      def !== undefined && !/^tools:.*\b(Edit|Write)\b/m.test(def.content)
    );
  }
} finally {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed}/${passed + failed} agent routing checks passed`);
if (failed > 0) process.exit(1);
