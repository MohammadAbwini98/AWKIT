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

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";

import { LEDGER_STATUSES } from "../tools/roadmap/lib/parse-ledger.mjs";
import {
  ACTIVATION_RULES,
  AGENTS,
  AGENT_IDS,
  CLAUDE_BASH_PERMISSION_RULES,
  CLAUDE_PERMISSION_DENIES,
  CLASSIFICATION_FLAGS,
  CODEBASE_MEMORY_MUTATING_TOOLS,
  CODEBASE_MEMORY_READ_TOOLS,
  EVIDENCE_STATUSES,
  GRAPHIFY_MUTATION_DENIES,
  GRAPHIFY_READ_TOOLS,
  PATH_DOMAINS,
  PROTECTED_PATHS,
  RISK_3_FLAGS,
  ROLE_SKILLS,
  SHARED_WRITE_PATHS,
  WATCHED_IGNORED_PATHS,
  WRITER_PRECEDENCE,
  agent,
  disallowedToolsFor,
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
  recordViolations,
  unclaimedProtectedWrites,
  releaseLease
} from "../tools/agents/lease.mjs";
import {
  canonicalActorId,
  decideActorWrite,
  decideWrite,
  isAllowedActiveShellCommand,
  isContractControlPath,
  isLeaseGrantCommand,
  isManagerGitCommand,
  isPhysicallyWithinRepo,
  isReadOnlyShellCommand,
  pushAuthorizedForLease,
  targetPathOf
} from "../tools/agents/lease-guard.mjs";

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
    task: {
      id: "awkit-fixture",
      title: "Fixture",
      objective: "Prove the rules fire.",
      risk_level: 1,
      mode: "change"
    },
    repository: {
      branch: "main",
      baseline_commit: "HEAD",
      working_tree_expected: "clean",
      preserved_paths: []
    },
    classification: { renderer_visual_change: true, cross_layer_count: 1 },
    routing: {
      manager: "manager",
      activated_agents: ["manager", "uiux", "frontend", "qa"],
      expected_paths: ["app/renderer/components/Thing.tsx"],
      consultants: ["uiux"],
      writer: { agent_id: "frontend", allowed_paths: ["app/renderer/components/Thing.tsx"] },
      reviewers: ["qa"]
    },
    acceptance: [{ id: "AC-001", description: "It looks right.", evidence_required: ["EV-001"] }],
    evidence: [{ id: "EV-001", type: "build", command: "npm run build", required: true, result: "PASS" }],
    git: {
      direct_main: true,
      commit_policy: "coherent",
      force_push: false,
      destructive_reset: false
    },
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

function sameArray(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function invoke(fn, ...args) {
  try {
    return { ok: typeof fn === "function", value: typeof fn === "function" ? fn(...args) : undefined };
  } catch (error) {
    return { ok: false, value: undefined, error };
  }
}

async function invokeAsync(fn, ...args) {
  try {
    if (typeof fn !== "function") return { ok: false, value: undefined };
    return { ok: true, value: await fn(...args) };
  } catch (error) {
    return { ok: false, value: undefined, error };
  }
}

function zoneLabel(value) {
  if (typeof value === "string") return value.toLowerCase();
  return String(value?.zone ?? value?.id ?? value?.label ?? value?.name ?? value?.action ?? "")
    .toLowerCase();
}

function frontmatterValue(content, key) {
  return content.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? "";
}

function probePath(glob) {
  return glob.replace(/\*\*/g, "__probe__").replace(/\*/g, "__probe__");
}

function filesBelow(root) {
  const found = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) found.push(path);
    }
  };
  try {
    visit(root);
  } catch {
    /* absent is represented by an empty list */
  }
  return found.sort();
}

function containsForbiddenCheckpointKey(value) {
  if (Array.isArray(value)) return value.some(containsForbiddenCheckpointKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) =>
    ["transcript", "compact_summary", "messages", "conversation", "session_state"].includes(
      key.toLowerCase()
    ) || containsForbiddenCheckpointKey(child)
  );
}

async function optionalImport(specifier) {
  try {
    return { module: await import(specifier), error: null };
  } catch (error) {
    return { module: null, error };
  }
}

const [contextPolicyLoad, contextStatusLoad, checkpointLoad, taskGateLoad, leaseExtrasLoad] =
  await Promise.all([
    optionalImport("../tools/agents/context-policy.mjs"),
    optionalImport("../tools/agents/context-status.mjs"),
    optionalImport("../tools/agents/compaction-checkpoint.mjs"),
    optionalImport("../tools/agents/task-gate.mjs"),
    optionalImport("../tools/agents/lease.mjs")
  ]);

const tempDirs = [];
function tempFile(name, contents) {
  const dir = mkdtempSync(join(tmpdir(), "awkit-routing-"));
  tempDirs.push(dir);
  const path = join(dir, name);
  writeFileSync(path, contents, "utf8");
  return path;
}

function spawnLeaseGuard(payload) {
  return spawnSync(process.execPath, ["tools/agents/lease-guard.mjs"], {
    cwd: process.cwd(),
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    encoding: "utf8"
  });
}

function spawnActorDecision(payload) {
  const guardUrl = new URL("../tools/agents/lease-guard.mjs", import.meta.url).href;
  const source = `
    import { decideActorWrite, isAllowedActiveShellCommand } from ${JSON.stringify(guardUrl)};
    const payload = JSON.parse(process.argv[1]);
    process.stdout.write(JSON.stringify({
      write: decideActorWrite(
        payload.lease,
        payload.path,
        payload.options?.agentType,
        payload.options?.agentId
      ),
      shell: isAllowedActiveShellCommand(
        payload.command,
        payload.lease,
        payload.options ?? {}
      )
    }));
  `;
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", source, JSON.stringify(payload)],
    { cwd: process.cwd(), encoding: "utf8" }
  );
  let value = null;
  try {
    value = JSON.parse(child.stdout);
  } catch {
    /* A malformed child reply is a failed probe, reported by the caller. */
  }
  return { ...child, value };
}

try {
  /* ======================================================================
     1. Registry integrity
     ====================================================================== */
  console.log("Registry:");
  const canonicalAgentIds = [
    "manager",
    "architect",
    "uiux",
    "frontend",
    "software",
    "runtime",
    "integration",
    "recorder",
    "qa",
    "qc",
    "security",
    "researcher",
    "persistence",
    "performance",
    "release",
    "project-state"
  ];
  check("exactly 16 canonical agents are registered", AGENTS.length === 16, `got ${AGENTS.length}`);
  check(
    "the canonical roster covers every requested responsibility exactly once",
    sameArray(AGENT_IDS, canonicalAgentIds),
    `got [${AGENT_IDS.join(", ")}]`
  );
  check("agent ids are unique", new Set(AGENT_IDS).size === AGENT_IDS.length);
  const canonicalClaudeNames = [
    "awkit-manager",
    "awkit-system-architect",
    "awkit-ui-designer",
    "awkit-frontend-engineer",
    "awkit-software-engineer",
    "awkit-backend-engineer",
    "awkit-integration-specialist",
    "awkit-recorder-playwright",
    "awkit-qa-engineer",
    "awkit-qc-reviewer",
    "awkit-security-engineer",
    "awkit-researcher",
    "awkit-data-persistence",
    "awkit-performance-engineer",
    "awkit-build-release",
    "awkit-project-state"
  ];
  const claudeNames = AGENTS.map((a) => a.claudeName);
  check(
    "Claude identities are the exact AWKIT-scoped names",
    sameArray(claudeNames, canonicalClaudeNames),
    JSON.stringify(claudeNames)
  );
  check("Claude identities are unique", new Set(claudeNames).size === claudeNames.length);
  const intendedModes = {
    manager: "writer",
    architect: "read-only",
    uiux: "read-only",
    frontend: "writer",
    software: "writer",
    runtime: "writer",
    integration: "read-only",
    recorder: "writer",
    qa: "writer",
    qc: "read-only",
    security: "writer",
    researcher: "read-only",
    persistence: "writer",
    performance: "read-only",
    release: "writer",
    "project-state": "writer"
  };
  check(
    "canonical roles use the intended writer/read-only modes",
    AGENTS.every((a) => intendedModes[a.id] === a.defaultMode),
    AGENTS.filter((a) => intendedModes[a.id] !== a.defaultMode)
      .map((a) => `${a.id}:${a.defaultMode}`)
      .join(", ")
  );
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
  const probe = probePath;

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

  const ownershipCollisions = [];
  for (let leftIndex = 0; leftIndex < AGENTS.length; leftIndex += 1) {
    const left = AGENTS[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < AGENTS.length; rightIndex += 1) {
      const right = AGENTS[rightIndex];
      for (const leftGlob of left.ownsPaths) {
        for (const rightGlob of right.ownsPaths) {
          if (
            pathInScope(probe(leftGlob), [rightGlob]) ||
            pathInScope(probe(rightGlob), [leftGlob])
          ) {
            ownershipCollisions.push(`${left.id}:${leftGlob} <> ${right.id}:${rightGlob}`);
          }
        }
      }
    }
  }
  check(
    "canonical path ownership has no cross-agent broad overlap",
    ownershipCollisions.length === 0,
    ownershipCollisions.join("; ")
  );

  for (const domain of PATH_DOMAINS) {
    const expectedPath = probe(domain.glob);
    const routed = route(normalizeClassification({}).classification, {
      expectedPaths: [expectedPath],
      taskMode: "change"
    });
    check(
      `expected path ${domain.glob} activates its owner ${domain.owner}`,
      routed.activated.includes(domain.owner),
      `activated=[${routed.activated.join(", ")}]`
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
    "read-only/advisory agents receive no write tools",
    AGENTS.filter((a) => ["read-only", "advisory", "review"].includes(a.defaultMode)).every(
      (a) => !/\bEdit\b|\bWrite\b/.test(toolsFor(a.id))
    )
  );
  check(
    "writer agents receive write tools",
    AGENTS.filter((a) => a.defaultMode === "writer").every((a) => /\bEdit\b/.test(toolsFor(a.id)))
  );

  const expectedCodebaseMemoryReads = [
    "mcp__codebase-memory-mcp__search_graph",
    "mcp__codebase-memory-mcp__query_graph",
    "mcp__codebase-memory-mcp__trace_path",
    "mcp__codebase-memory-mcp__get_code_snippet",
    "mcp__codebase-memory-mcp__get_graph_schema",
    "mcp__codebase-memory-mcp__get_architecture",
    "mcp__codebase-memory-mcp__search_code",
    "mcp__codebase-memory-mcp__list_projects",
    "mcp__codebase-memory-mcp__index_status",
    "mcp__codebase-memory-mcp__detect_changes"
  ];
  const expectedGraphifyReads = [
    "Bash(graphify query:*)",
    "Bash(graphify explain:*)",
    "Bash(graphify path:*)",
    "Bash(graphify affected:*)",
    "Bash(graphify god-nodes:*)",
    "Bash(graphify diagnose multigraph:*)",
    "Bash(graphify benchmark:*)",
    "Bash(graphify hook status:*)",
    "Bash(graphify global list)",
    "Bash(graphify global path)"
  ];
  const generatedDenyToolNames = new Set(["Edit", "Write", "Agent", "NotebookEdit"]);
  check(
    "the MCP discovery grant is exactly the 10 read-only codebase-memory tools",
    sameArray(CODEBASE_MEMORY_READ_TOOLS, expectedCodebaseMemoryReads),
    JSON.stringify(CODEBASE_MEMORY_READ_TOOLS)
  );
  check(
    "the Graphify settings policy is exactly the bounded read-only command set",
    sameArray(GRAPHIFY_READ_TOOLS, expectedGraphifyReads),
    JSON.stringify(GRAPHIFY_READ_TOOLS)
  );
  for (const role of AGENTS) {
    const roleTools = toolsFor(role.id);
    const mcpGrants = [...roleTools.matchAll(/mcp__codebase-memory-mcp__[A-Za-z0-9_.*-]+/g)]
      .map((match) => match[0]);
    const skillGrants = [...roleTools.matchAll(/Skill\(([^)]+)\)/g)].map((match) => match[1]);
    check(
      `${role.id} receives exactly the 10 read-only MCP grants`,
      sameArray(mcpGrants, expectedCodebaseMemoryReads),
      JSON.stringify(mcpGrants)
    );
    check(
      `${role.id} receives only its lazy role skills`,
      sameArray(skillGrants, ROLE_SKILLS[role.id] ?? []),
      JSON.stringify(skillGrants)
    );
    check(
      `${role.id} has no broad MCP, node, npm, or git grant`,
      !roleTools.includes("mcp__codebase-memory-mcp__*") &&
        !/Bash\((?:node|npm|git)(?::\*|\s+\*)\)/.test(roleTools),
      roleTools
    );
    check(
      `${role.id} exposes the real Bash tool without frontmatter command patterns`,
      /(?:^|, )Bash(?:,|$)/.test(roleTools) && !/Bash\(/.test(roleTools),
      roleTools
    );
    const deniedTools = disallowedToolsFor(role.id).split(", ").filter(Boolean);
    check(
      `${role.id} disallows only real tool names; command denies stay in project settings`,
      deniedTools.length > 0 && deniedTools.every((name) => generatedDenyToolNames.has(name)),
      JSON.stringify(deniedTools)
    );
  }

  const managerAgentGrants = [...toolsFor("manager").matchAll(/Agent\(([^)]*)\)/g)];
  const delegatedClaudeNames = managerAgentGrants[0]?.[1]
    ?.split(",")
    .map((name) => name.trim())
    .filter(Boolean) ?? [];
  const expectedDelegatedClaudeNames = AGENTS
    .filter((entry) => entry.id !== "manager")
    .map((entry) => entry.claudeName);
  check(
    "Manager Agent delegation is restricted to the other 15 AWKIT identities",
    managerAgentGrants.length === 1 &&
      sameArray(delegatedClaudeNames, expectedDelegatedClaudeNames) &&
      delegatedClaudeNames.every((name) => name.startsWith("awkit-")),
    JSON.stringify(delegatedClaudeNames)
  );
  check(
    "non-manager roles cannot spawn agents",
    AGENTS.filter((entry) => entry.id !== "manager").every(
      (entry) => !/Agent\(/.test(toolsFor(entry.id)) && /(?:^|, )Agent(?:,|$)/.test(disallowedToolsFor(entry.id))
    )
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
     2a. Context budget, specialist concurrency, and evidence contracts
     ====================================================================== */
  console.log("Context and delegation policy:");
  const contextPolicy = contextPolicyLoad.module;
  check(
    "context-policy.mjs exists and imports",
    contextPolicy !== null,
    contextPolicyLoad.error?.message ?? "missing module"
  );
  check(
    "CONTEXT_POLICY is exported",
    contextPolicy?.CONTEXT_POLICY && typeof contextPolicy.CONTEXT_POLICY === "object"
  );
  check(
    "CONCURRENCY_POLICY is exported",
    contextPolicy?.CONCURRENCY_POLICY && typeof contextPolicy.CONCURRENCY_POLICY === "object"
  );
  check("contextZoneFor is exported", typeof contextPolicy?.contextZoneFor === "function");
  check("specialistLimitFor is exported", typeof contextPolicy?.specialistLimitFor === "function");

  const tokenBoundaries = [
    [0, "normal"],
    [99_999, "normal"],
    [100_000, "delegate"],
    [119_999, "delegate"],
    [120_000, "warning"],
    [149_999, "warning"],
    [150_000, "compact"],
    [250_000, "compact"]
  ];
  for (const [tokens, expected] of tokenBoundaries) {
    const actual = invoke(contextPolicy?.contextZoneFor, tokens);
    check(
      `${tokens.toLocaleString("en-US")} tokens maps to ${expected}`,
      actual.ok && zoneLabel(actual.value) === expected,
      `got ${zoneLabel(actual.value) || actual.error?.message || "no result"}`
    );
  }

  const routineLimit = invoke(contextPolicy?.specialistLimitFor, {
    crossLayerCount: 1,
    broadInvestigation: false
  });
  const crossLayerLimit = invoke(contextPolicy?.specialistLimitFor, {
    crossLayerCount: 2,
    broadInvestigation: false
  });
  const majorLimit = invoke(contextPolicy?.specialistLimitFor, {
    crossLayerCount: 3,
    broadInvestigation: true
  });
  check("routine work permits at most 2 specialists", routineLimit.value === 2, `${routineLimit.value}`);
  check("cross-layer work permits at most 3 specialists", crossLayerLimit.value === 3, `${crossLayerLimit.value}`);
  check("major investigation permits at most 4 specialists", majorLimit.value === 4, `${majorLimit.value}`);

  const concurrencyPolicy = contextPolicy?.CONCURRENCY_POLICY ?? {};
  const swarmPolicy =
    concurrencyPolicy.allRoleSwarm ??
    concurrencyPolicy.allowAllRoleSwarm ??
    concurrencyPolicy.all_role_swarm;
  check(
    "all-role swarms are explicitly prohibited",
    swarmPolicy === false ||
      swarmPolicy === "prohibited" ||
      concurrencyPolicy.allRoleSwarmProhibited === true,
    JSON.stringify(concurrencyPolicy)
  );

  const delegationFields = Array.isArray(contextPolicy?.DELEGATION_FIELDS)
    ? contextPolicy.DELEGATION_FIELDS
    : [];
  const reportSections = Array.isArray(contextPolicy?.REPORT_SECTIONS)
    ? contextPolicy.REPORT_SECTIONS
    : [];
  const normalizedDelegation = delegationFields.map((field) => String(field).trim().toUpperCase());
  const normalizedSections = reportSections.map((section) =>
    String(section).trim().toLowerCase().replace(/[_-]+/g, " ")
  );
  const requiredDelegation = ["FACT", "INFERENCE", "RECOMMENDATION", "UNKNOWN"];
  const requiredSections = [
    "summary",
    "evidence",
    "changes",
    "files",
    "checks",
    "results",
    "risks",
    "unresolved",
    "next action"
  ];
  check(
    "delegation fields require FACT / INFERENCE / RECOMMENDATION / UNKNOWN",
    sameArray(normalizedDelegation, requiredDelegation),
    JSON.stringify(delegationFields)
  );
  check(
    "specialist reports require every concise evidence section",
    sameArray(normalizedSections, requiredSections),
    JSON.stringify(reportSections)
  );

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

  /* Representative scenarios pin the MINIMAL set, not just the presence of one specialist. A
     router that added every plausible role would satisfy inclusion checks while defeating the
     requested bounded orchestration model. */
  const uiScenario = route(
    normalizeClassification({ renderer_visual_change: true }).classification,
    { expectedPaths: ["app/renderer/components/Thing.tsx"], taskMode: "change" }
  );
  check(
    "UI routes exactly to manager + uiux + frontend + qa",
    sameArray(uiScenario.activated, ["manager", "uiux", "frontend", "qa"]),
    uiScenario.activated.join(", ")
  );
  check("UI has exactly frontend as writer", sameArray(uiScenario.writerSequence, ["frontend"]));
  check("UI has exactly uiux as consultant", sameArray(uiScenario.consultants, ["uiux"]));
  check("UI has exactly qa as reviewer", sameArray(uiScenario.reviewers, ["qa"]));

  const recorderScenario = route(
    normalizeClassification({ recorder_change: true }).classification,
    { expectedPaths: ["src/recorder/RecorderService.ts"], taskMode: "change" }
  );
  check(
    "Recorder routes exactly to manager + recorder + qa",
    sameArray(recorderScenario.activated, ["manager", "recorder", "qa"]),
    recorderScenario.activated.join(", ")
  );
  check(
    "Recorder does not add the integration-boundary adviser without cross-layer evidence",
    !recorderScenario.activated.includes("integration")
  );
  check("Recorder has exactly recorder as writer", sameArray(recorderScenario.writerSequence, ["recorder"]));
  check("Recorder has no consultant by default", sameArray(recorderScenario.consultants, []));
  check("Recorder has exactly qa as reviewer", sameArray(recorderScenario.reviewers, ["qa"]));

  const recorderAcrossIpc = route(
    normalizeClassification({ recorder_change: true, ipc_change: true, cross_layer_count: 2 }).classification,
    {
      expectedPaths: ["src/recorder/RecorderService.ts", "app/main/ipc/recorder.ipc.ts"],
      taskMode: "change"
    }
  );
  check(
    "Recorder adds the integration-boundary adviser when IPC evidence is declared",
    recorderAcrossIpc.activated.includes("integration") && recorderAcrossIpc.consultants.includes("integration"),
    `activated=[${recorderAcrossIpc.activated.join(", ")}] consultants=[${recorderAcrossIpc.consultants.join(", ")}]`
  );

  const ipcSecurityScenario = route(
    normalizeClassification({
      ipc_change: true,
      authorization_change: true,
      cross_layer_count: 2
    }).classification,
    {
      expectedPaths: ["app/main/ipc/security.ipc.ts", "src/security/Authorization.ts"],
      taskMode: "change"
    }
  );
  check(
    "IPC/security routes exactly to the six required roles",
    sameArray(ipcSecurityScenario.activated, [
      "manager",
      "runtime",
      "integration",
      "qa",
      "qc",
      "security"
    ]),
    ipcSecurityScenario.activated.join(", ")
  );
  check(
    "IPC/security has exactly security then runtime as serialized writers",
    sameArray(ipcSecurityScenario.writerSequence, ["security", "runtime"]),
    ipcSecurityScenario.writerSequence.join(" -> ")
  );
  check(
    "IPC/security has exactly integration as consultant",
    sameArray(ipcSecurityScenario.consultants, ["integration"]),
    ipcSecurityScenario.consultants.join(", ")
  );
  check(
    "IPC/security has exactly qa and qc as reviewers",
    sameArray(ipcSecurityScenario.reviewers, ["qa", "qc"]),
    ipcSecurityScenario.reviewers.join(", ")
  );

  const oraclePath = "src/oracle/OracleService.ts";
  const oracleDerived = deriveClassification([oraclePath]);
  const oracleDeclared = Object.fromEntries(oracleDerived.flags.map((flag) => [flag, true]));
  oracleDeclared.cross_layer_count = Math.max(1, oracleDerived.crossLayerCount);
  const oracleScenario = route(normalizeClassification(oracleDeclared).classification, {
    expectedPaths: [oraclePath],
    taskMode: "change"
  });
  check(
    "Oracle routes exactly to manager + runtime + QA + QC + security",
    sameArray(oracleScenario.activated, ["manager", "runtime", "qa", "qc", "security"]),
    oracleScenario.activated.join(", ")
  );
  check("Oracle has exactly runtime as writer", sameArray(oracleScenario.writerSequence, ["runtime"]));
  check("Oracle has exactly security as consultant", sameArray(oracleScenario.consultants, ["security"]));
  check("Oracle has exactly QA and QC as reviewers", sameArray(oracleScenario.reviewers, ["qa", "qc"]));
  const oracleDomain = domainForPath("src/oracle/OracleService.ts");
  const bridgeDomain = domainForPath("oracle-jdbc-bridge/src/Bridge.java");
  const nativeDomain = domainForPath("native-hosts/zvec/zvec-host.cjs");
  const issuerDomain = domainForPath("tools/license-issuer/index.mjs");
  check(
    "Oracle, JDBC bridge, native hosts, and license issuer have exact owner/flag contracts",
    oracleDomain?.owner === "runtime" &&
      sameArray(oracleDomain.impliesFlags, ["execution_change", "authorization_change"]) &&
      bridgeDomain?.owner === "runtime" &&
      sameArray(bridgeDomain.impliesFlags, [
        "execution_change",
        "authorization_change",
        "offline_boundary_change"
      ]) &&
      nativeDomain?.owner === "runtime" &&
      sameArray(nativeDomain.impliesFlags, [
        "execution_change",
        "authorization_change",
        "offline_boundary_change"
      ]) &&
      issuerDomain?.owner === "security" &&
      sameArray(issuerDomain.impliesFlags, [
        "licensing_change",
        "signing_change",
        "secret_handling_change"
      ])
  );
  const routeFromOwnedPath = (path) => {
    const derived = deriveClassification([path]);
    const declared = Object.fromEntries(derived.flags.map((flag) => [flag, true]));
    declared.cross_layer_count = Math.max(1, derived.crossLayerCount);
    return route(normalizeClassification(declared).classification, {
      expectedPaths: [path],
      taskMode: "change"
    });
  };
  const bridgeScenario = routeFromOwnedPath("oracle-jdbc-bridge/src/Bridge.java");
  check(
    "Oracle bridge routing adds the offline release adviser without a second writer",
    sameArray(bridgeScenario.activated, ["manager", "runtime", "qa", "qc", "security", "release"]) &&
      sameArray(bridgeScenario.writerSequence, ["runtime"]) &&
      sameArray(bridgeScenario.consultants, ["security", "release"]) &&
      sameArray(bridgeScenario.reviewers, ["qa", "qc"]),
    JSON.stringify(bridgeScenario)
  );
  const issuerScenario = routeFromOwnedPath("tools/license-issuer/index.mjs");
  check(
    "license issuer routing serializes security and requires architecture/release advice plus QA/QC",
    sameArray(issuerScenario.activated, ["manager", "architect", "qa", "qc", "security", "release"]) &&
      sameArray(issuerScenario.writerSequence, ["security"]) &&
      sameArray(issuerScenario.consultants, ["architect", "release"]) &&
      sameArray(issuerScenario.reviewers, ["qa", "qc"]),
    JSON.stringify(issuerScenario)
  );
  check(
    "the canonical preload is app/main/preload.ts and is runtime-owned",
    existsSync(new URL("../app/main/preload.ts", import.meta.url)) &&
      domainForPath("app/main/preload.ts")?.owner === "runtime" &&
      domainForPath("app/preload.ts") === null
  );

  const broadInspectScenario = route(
    normalizeClassification({ broad_investigation: true }).classification,
    { expectedPaths: [], taskMode: "inspect" }
  );
  check("broad_investigation is a recognized routing flag", CLASSIFICATION_FLAGS.includes("broad_investigation"));
  check(
    "an unfamiliar broad defect starts exactly with manager + researcher",
    sameArray(broadInspectScenario.activated, ["manager", "researcher"]),
    broadInspectScenario.activated.join(", ")
  );
  check("an unfamiliar inspection starts with no writer", sameArray(broadInspectScenario.writerSequence, []));
  check(
    "an unfamiliar inspection has exactly researcher as consultant",
    sameArray(broadInspectScenario.consultants, ["researcher"]),
    broadInspectScenario.consultants.join(", ")
  );
  check("an unfamiliar inspection starts with no reviewer", sameArray(broadInspectScenario.reviewers, []));

  const licensingOwned = route(
    normalizeClassification({ licensing_change: true }).classification,
    { expectedPaths: ["src/licensing/LicenseValidator.ts"], taskMode: "change" }
  );
  check(
    "a security-owned licensing path places security in writerSequence",
    sameArray(licensingOwned.writerSequence, ["security"]),
    licensingOwned.writerSequence.join(" -> ")
  );

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

    // A documentation task belongs to the project-state writer, while manager stays the orchestrator.
    const docsOnly = route(normalizeClassification({}).classification, {
      expectedPaths: ["docs/ai/CURRENT_STATE.md"]
    });
    check(
      "a documentation task routes project-state as its writer",
      JSON.stringify(docsOnly.writerSequence) === JSON.stringify(["project-state"]),
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
  check("rejects an undeclared working-tree expectation", rejects("repository.working_tree_expected", (c) => {
    delete c.repository.working_tree_expected;
  }));
  check("rejects a non-coherent commit policy", rejects("git.commit_policy", (c) => {
    c.git.commit_policy = "squash-later";
  }));
  check("rejects destructive reset permission", rejects("git.destructive_reset", (c) => {
    c.git.destructive_reset = true;
  }));

  const validPreservedContract = validContract();
  validPreservedContract.repository.preserved_paths = [{
    path: "docs/ai/user-note.md",
    git_status: " M",
    sha256: "a".repeat(64)
  }];
  check(
    "an exact preserved file fingerprint object is valid",
    validateContract(validPreservedContract).ok,
    JSON.stringify(validateContract(validPreservedContract).violations)
  );
  check("rejects a legacy preserved path string", rejects("repository.preserved_entry", (c) => {
    c.repository.preserved_paths = ["docs/ai/user-note.md"];
  }));
  check("rejects a preserved glob instead of one exact file", rejects("repository.preserved_path", (c) => {
    c.repository.preserved_paths = [{ path: "docs/ai/**", git_status: " M", sha256: "a".repeat(64) }];
  }));
  check("rejects a preserved file without exact two-character Git status", rejects("repository.preserved_status", (c) => {
    c.repository.preserved_paths = [{ path: "docs/ai/user-note.md", git_status: "modified", sha256: "a".repeat(64) }];
  }));
  check("rejects a preserved file without a SHA-256 fingerprint", rejects("repository.preserved_sha256", (c) => {
    c.repository.preserved_paths = [{ path: "docs/ai/user-note.md", git_status: " M", sha256: "not-a-sha" }];
  }));

  check("rejects a contract with no manager", rejects("manager.absent", (c) => {
    c.routing.activated_agents = c.routing.activated_agents.filter((x) => x !== "manager");
  }));
  check("rejects an unknown task mode", rejects("task.mode", (c) => {
    c.task.mode = "maybe";
  }));
  check("rejects a missing mandatory specialist", rejects("activation.missing", (c) => {
    c.classification.licensing_change = true;
  }));
  check("rejects a missing mandatory routed reviewer", rejects("reviewer.missing", (c) => {
    c.routing.reviewers = [];
  }));
  check("rejects more than one writer", rejects("writer.multiple", (c) => {
    c.routing.writer = [{ agent_id: "frontend" }, { agent_id: "runtime" }];
  }));
  check("an inspect task cannot declare a writer", rejects("writer.inspect", (c) => {
    c.task.mode = "inspect";
  }));
  check("rejects a writer outside the routed sequence", rejects("writer.unrouted", (c) => {
    c.routing.writer.agent_id = "release";
  }));
  check("rejects a writer with no allowed_paths", rejects("writer.no_paths", (c) => {
    c.routing.writer.allowed_paths = [];
  }));
  check("a change task with an owned expected path still requires a writer", rejects("writer.absent", (c) => {
    c.task.mode = "change";
    delete c.routing.writer;
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
  check("rejects duplicate evidence IDs", rejects("evidence.duplicate", (c) => {
    c.evidence.push({ ...c.evidence[0] });
  }));
  check("rejects acceptance with no evidence link", rejects("acceptance.unproven", (c) => {
    c.acceptance[0].evidence_required = [];
  }));
  check("rejects acceptance citing unknown evidence", rejects("acceptance.dangling", (c) => {
    c.acceptance[0].evidence_required = ["EV-999"];
  }));
  check("rejects acceptance citing optional evidence", rejects("acceptance.optional_evidence", (c) => {
    c.evidence[0].required = false;
  }));
  check("rejects duplicate acceptance IDs", rejects("acceptance.duplicate", (c) => {
    c.acceptance.push({ ...c.acceptance[0] });
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

  const citedFailure = validContract();
  citedFailure.evidence[0].result = "FAIL";
  const citedFailureBlockers = completionBlockers(citedFailure);
  check(
    "every acceptance citation must resolve to required PASS evidence",
    citedFailureBlockers.some((blocker) =>
      /acceptance "AC-001" is not proven/.test(blocker) && /EV-001/.test(blocker) && /FAIL/.test(blocker)
    ),
    JSON.stringify(citedFailureBlockers)
  );
  const partiallyProven = validContract();
  partiallyProven.evidence.push({
    id: "EV-002",
    type: "qc",
    required: true,
    result: "BLOCKED"
  });
  partiallyProven.acceptance[0].evidence_required = ["EV-001", "EV-002"];
  const partialProofBlockers = completionBlockers(partiallyProven);
  check(
    "one passing citation cannot hide a second blocked citation",
    partialProofBlockers.some((blocker) =>
      /acceptance "AC-001" is not proven/.test(blocker) && /EV-002/.test(blocker) && /BLOCKED/.test(blocker)
    ),
    JSON.stringify(partialProofBlockers)
  );

  check("a fully proven contract has no blockers", completionBlockers(validContract()).length === 0,
    JSON.stringify(completionBlockers(validContract())));

  const escaped = validContract();
  escaped.scope_escapes = [{ kind: "domain", subject: "persistence" }];
  check("an unresolved scope escape blocks completion", completionBlockers(escaped).length > 0);

  const qcPending = validContract();
  qcPending.routing.reviewers = ["qa", "qc"];
  qcPending.completion.qc_status = "pending";
  check("pending QC blocks completion when QC is a reviewer", completionBlockers(qcPending).length > 0);

  // The gate must compute mandatory reviewers from route(), not trust the contract's list. Otherwise
  // a Risk 3 task can erase "qc" from routing.reviewers and make a pending review disappear.
  const omittedQc = validContract();
  omittedQc.task.risk_level = 3;
  omittedQc.classification.authorization_change = true;
  const omittedQcRoute = route(normalizeClassification(omittedQc.classification).classification, {
    expectedPaths: omittedQc.routing.expected_paths,
    taskMode: omittedQc.task.mode
  });
  omittedQc.routing.activated_agents = [...omittedQcRoute.activated];
  omittedQc.routing.reviewers = omittedQcRoute.reviewers.filter((id) => id !== "qc");
  omittedQc.completion.qc_status = "pending";
  const omittedQcBlockers = completionBlockers(omittedQc);
  check(
    "completion cannot bypass pending routed QC by omitting qc from the contract",
    omittedQcBlockers.some((blocker) => /\bqc\b/i.test(blocker) && /pending|review/i.test(blocker)),
    JSON.stringify(omittedQcBlockers)
  );

  /* ======================================================================
     8. Write lease — driven against fixtures, never the real lease file
     ====================================================================== */
  console.log("Write lease:");
  const leasePath = tempFile("active-lease.json", "");
  const assignPath = tempFile("assignments.json", JSON.stringify({ claims: [] }));
  const leaseContractPath = tempFile(
    "awkit-fixture.json",
    `${JSON.stringify(validContract(), null, 2)}\n`
  );
  rmSync(leasePath, { force: true });

  const frontendLeaseRouting = {
    ...route(normalizeClassification({ renderer_visual_change: true }).classification, {
      expectedPaths: ["app/renderer/**"],
      taskMode: "change"
    }),
    expectedPaths: ["app/renderer/**"]
  };

  const granted = grantLease({
    task: "awkit-fixture",
    holder: "frontend",
    allowedPaths: ["app/renderer/**"],
    routing: frontendLeaseRouting,
    path: leasePath,
    assignmentsPath: assignPath,
    contractPath: leaseContractPath
  });
  check("a lease can be granted", granted.status === "active");
  check("the lease allows an in-scope path", leaseAllows(granted, "app/renderer/App.tsx"));
  check("the lease BLOCKS an out-of-scope path", !leaseAllows(granted, "src/runner/exec.ts"));
  check("the lease blocks another specialist's territory", !leaseAllows(granted, "src/licensing/x.ts"));

  const rejectedGrant = (name, params) => {
    const candidatePath = tempFile(`${name}-lease.json`, "");
    const candidateAssignments = tempFile(`${name}-assignments.json`, JSON.stringify({ claims: [] }));
    const candidateContract = validContract();
    candidateContract.task.id = params.task;
    const candidateContractPath = tempFile(
      `${name}-contract.json`,
      `${JSON.stringify(candidateContract, null, 2)}\n`
    );
    rmSync(candidatePath, { force: true });
    try {
      grantLease({
        ...params,
        path: candidatePath,
        assignmentsPath: candidateAssignments,
        contractPath: candidateContractPath
      });
      return false;
    } catch {
      return true;
    }
  };

  const licensingRouting = {
    ...licensingOwned,
    expectedPaths: ["src/licensing/**"]
  };
  check(
    "grantLease rejects allowed paths outside the holder's ownership",
    rejectedGrant("outside-owner", {
      task: "outside-owner",
      holder: "frontend",
      allowedPaths: ["src/licensing/**"],
      routing: licensingRouting
    })
  );

  const runtimeRouting = {
    ...route(normalizeClassification({ electron_main_change: true }).classification, {
      expectedPaths: ["app/main/window.ts"],
      taskMode: "change"
    }),
    expectedPaths: ["app/main/window.ts"]
  };
  check(
    "grantLease rejects a holder outside routing.writerSequence",
    rejectedGrant("unrouted-holder", {
      task: "unrouted-holder",
      holder: "frontend",
      allowedPaths: ["app/renderer/components/Thing.tsx"],
      routing: runtimeRouting
    })
  );

  const narrowFrontendRouting = {
    ...route(normalizeClassification({ renderer_visual_change: true }).classification, {
      expectedPaths: ["app/renderer/components/Thing.tsx"],
      taskMode: "change"
    }),
    expectedPaths: ["app/renderer/components/Thing.tsx"]
  };
  check(
    "grantLease rejects holder-owned paths outside the routed contract scope",
    rejectedGrant("outside-contract", {
      task: "outside-contract",
      holder: "frontend",
      allowedPaths: ["app/renderer/components/Other.tsx"],
      routing: narrowFrontendRouting
    })
  );

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
    amendLease({
      addPaths: ["app/renderer/other.tsx"],
      reason: "",
      path: leasePath,
      assignmentsPath: assignPath,
      contractPath: leaseContractPath
    });
  } catch {
    noReason = true;
  }
  check("an amendment without a reason is refused", noReason);

  const extended = amendLease({
    addPaths: ["app/renderer/deep/Other.tsx"],
    reason: "same domain",
    path: leasePath,
    assignmentsPath: assignPath,
    contractPath: leaseContractPath
  });
  check("an in-domain amendment EXTENDS the lease", extended.outcome === "extended");

  const rerouted = amendLease({
    addPaths: ["src/storage/store.ts"],
    reason: "persistence impact discovered",
    path: leasePath,
    assignmentsPath: assignPath,
    contractPath: leaseContractPath
  });
  check("an out-of-domain amendment REROUTES instead of widening", rerouted.outcome === "reroute");
  check("rerouting names the specialist who owns the new path", rerouted.requiredAgents.includes("persistence"));
  check("rerouting releases the old lease", readLease(leasePath) === null);
  check("rerouting records the amendment for audit", rerouted.lease.amendments.length === 2);
  check(
    "rerouting clears the stale claim",
    JSON.parse(readFileSync(assignPath, "utf8")).claims.length === 0
  );

  /* Lease violations must survive the active-file lifecycle. Refusal and archival are exercised
     against disposable contract files so this proof never mutates the repository control plane. */
  {
    const historyTask = "awkit-history-fixture";
    const historyLeasePath = tempFile("history-active-lease.json", "");
    const historyAssignmentsPath = tempFile(
      "history-assignments.json",
      `${JSON.stringify({ claims: [] }, null, 2)}\n`
    );
    const historyContract = validContract();
    historyContract.task.id = historyTask;
    const historyContractPath = tempFile(
      "history-contract.json",
      `${JSON.stringify(historyContract, null, 2)}\n`
    );
    rmSync(historyLeasePath, { force: true });

    grantLease({
      task: historyTask,
      holder: "frontend",
      allowedPaths: ["app/renderer/**"],
      routing: frontendLeaseRouting,
      path: historyLeasePath,
      assignmentsPath: historyAssignmentsPath,
      contractPath: historyContractPath
    });
    recordViolations(["src/runner/outside.ts"], historyLeasePath);

    let unresolvedReleaseRefused = false;
    try {
      releaseLease(
        "attempt with unresolved violation",
        historyLeasePath,
        historyAssignmentsPath,
        historyContractPath
      );
    } catch {
      unresolvedReleaseRefused = true;
    }
    check(
      "lease release refuses an unresolved violation",
      unresolvedReleaseRefused && readLease(historyLeasePath)?.status === "active"
    );

    const overridePending = JSON.parse(readFileSync(historyContractPath, "utf8"));
    overridePending.write_lease = {
      ...(overridePending.write_lease ?? {}),
      overrides: [{
        timestamp: new Date().toISOString(),
        reason: "independently reviewed emergency recovery",
        affected_paths: ["src/runner/outside.ts"],
        qc_required: true
      }]
    };
    overridePending.completion.qc_status = "pending";
    writeFileSync(historyContractPath, `${JSON.stringify(overridePending, null, 2)}\n`, "utf8");
    let unapprovedOverrideRefused = false;
    try {
      releaseLease(
        "attempt before QC approval",
        historyLeasePath,
        historyAssignmentsPath,
        historyContractPath
      );
    } catch {
      unapprovedOverrideRefused = true;
    }
    check("a declared override cannot release before QC approval", unapprovedOverrideRefused);

    overridePending.completion.qc_status = "APPROVED";
    writeFileSync(historyContractPath, `${JSON.stringify(overridePending, null, 2)}\n`, "utf8");
    const releasedHistoryLease = releaseLease(
      "QC-approved emergency release",
      historyLeasePath,
      historyAssignmentsPath,
      historyContractPath
    );
    const archivedAfterRelease = JSON.parse(readFileSync(historyContractPath, "utf8"));
    check(
      "a QC-approved narrow override permits release",
      releasedHistoryLease?.status === "released" && readLease(historyLeasePath) === null
    );
    check(
      "release archives the violation into durable task-contract history",
      archivedAfterRelease.write_lease?.history?.some((entry) =>
        entry.task === historyTask &&
          entry.status === "released" &&
          entry.violations?.some((violation) => violation.path === "src/runner/outside.ts")
      ),
      JSON.stringify(archivedAfterRelease.write_lease?.history)
    );

    grantLease({
      task: historyTask,
      holder: "frontend",
      allowedPaths: ["app/renderer/**"],
      routing: frontendLeaseRouting,
      path: historyLeasePath,
      assignmentsPath: historyAssignmentsPath,
      contractPath: historyContractPath
    });
    const historyAfterNextLease = JSON.parse(readFileSync(historyContractPath, "utf8"));
    check(
      "granting the next lease cannot erase archived violation history",
      historyAfterNextLease.write_lease?.history?.some((entry) =>
        entry.violations?.some((violation) => violation.path === "src/runner/outside.ts")
      ) && readLease(historyLeasePath)?.violations?.length === 0,
      JSON.stringify(historyAfterNextLease.write_lease?.history)
    );
  }

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
      acquired_at_commit: "baseline-sha",
      baseline_dirty: ["docs/ai/TASK_LOG.md"],
      baseline_dirty_fingerprints: { "docs/ai/TASK_LOG.md": "baseline" },
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
      outOfLeaseWrites(auditLease, ["docs/ai/TASK_LOG.md"], {
        committedPaths: [],
        currentFingerprints: { "docs/ai/TASK_LOG.md": "baseline" }
      }).length === 0
    );
    check(
      "an out-of-lease path committed after acquired_at_commit is still detected",
      sameArray(
        outOfLeaseWrites(auditLease, [], {
          committedPaths: ["src/runner/committed-after-lease.ts"],
          currentFingerprints: {}
        }),
        ["src/runner/committed-after-lease.ts"]
      )
    );
    check(
      "modifying a baseline-dirty file is detected rather than exempt by name",
      sameArray(
        outOfLeaseWrites(auditLease, ["docs/ai/TASK_LOG.md"], {
          committedPaths: [],
          currentFingerprints: { "docs/ai/TASK_LOG.md": "modified" }
        }),
        ["docs/ai/TASK_LOG.md"]
      )
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

    const committedPathsSince = leaseExtrasLoad.module?.committedPathsSince;
    const trackedPathFingerprints = leaseExtrasLoad.module?.trackedPathFingerprints;
    check("committedPathsSince is exported for the Bash audit", typeof committedPathsSince === "function");
    check("trackedPathFingerprints is exported for baseline-dirty audit", typeof trackedPathFingerprints === "function");

    let committedProbe = [];
    let fingerprintChanged = false;
    let invalidBaselineRejected = false;
    let unavailableGitRejected = false;
    let auditProbeError = "helpers unavailable";
    if (typeof committedPathsSince === "function" && typeof trackedPathFingerprints === "function") {
      const gitSandbox = mkdtempSync(join(tmpdir(), "awkit-routing-git-"));
      tempDirs.push(gitSandbox);
      try {
        execFileSync("git", ["init"], { cwd: gitSandbox, stdio: "ignore" });
        execFileSync("git", ["config", "user.name", "AWKIT Routing Verifier"], {
          cwd: gitSandbox,
          stdio: "ignore"
        });
        execFileSync("git", ["config", "user.email", "routing-verifier@example.invalid"], {
          cwd: gitSandbox,
          stdio: "ignore"
        });
        writeFileSync(join(gitSandbox, "baseline.txt"), "before\n", "utf8");
        execFileSync("git", ["add", "baseline.txt"], { cwd: gitSandbox, stdio: "ignore" });
        execFileSync("git", ["commit", "-m", "baseline"], { cwd: gitSandbox, stdio: "ignore" });
        const baselineCommit = execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: gitSandbox,
          encoding: "utf8"
        }).trim();
        const beforeFingerprints = trackedPathFingerprints(["baseline.txt"], gitSandbox);

        try {
          committedPathsSince("not-a-valid-commit", gitSandbox);
        } catch {
          invalidBaselineRejected = true;
        }

        mkdirSync(join(gitSandbox, "src"), { recursive: true });
        writeFileSync(join(gitSandbox, "src", "after.ts"), "export const after = true;\n", "utf8");
        execFileSync("git", ["add", "src/after.ts"], { cwd: gitSandbox, stdio: "ignore" });
        execFileSync("git", ["commit", "-m", "after lease"], { cwd: gitSandbox, stdio: "ignore" });
        committedProbe = committedPathsSince(baselineCommit, gitSandbox);

        writeFileSync(join(gitSandbox, "baseline.txt"), "after\n", "utf8");
        const afterFingerprints = trackedPathFingerprints(["baseline.txt"], gitSandbox);
        fingerprintChanged =
          beforeFingerprints["baseline.txt"] !== afterFingerprints["baseline.txt"];

        const noGitSandbox = mkdtempSync(join(tmpdir(), "awkit-routing-no-git-"));
        tempDirs.push(noGitSandbox);
        try {
          dirtyPaths(noGitSandbox);
        } catch {
          unavailableGitRejected = true;
        }
        auditProbeError = "";
      } catch (error) {
        auditProbeError = error instanceof Error ? error.message : String(error);
      }
    }
    check(
      "committedPathsSince finds a path committed after the lease baseline",
      committedProbe.includes("src/after.ts"),
      auditProbeError || JSON.stringify(committedProbe)
    );
    check(
      "trackedPathFingerprints changes when a baseline-dirty file is modified",
      fingerprintChanged,
      auditProbeError
    );
    check(
      "an invalid acquired_at_commit baseline fails closed",
      invalidBaselineRejected,
      auditProbeError
    );
    check(
      "unavailable Git state fails closed instead of returning a clean tree",
      unavailableGitRejected,
      auditProbeError
    );
  }

  /* ── Protected-path audit plus the fail-closed no-lease gate ────────────────────────────────
     All repository writes now need a lease. The protected set remains independently useful to the
     post-command audit: when no lease exists it identifies critical already-dirty paths that still
     need an accountable owner. */
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
    // Non-vacuity in both directions: this is a focused audit set, not the write gate itself.
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

    // The guard's actual JUDGEMENT, not just its payload parser.
    const held = { holder: "qa", allowed_paths: ["tests/**"], task: "t", status: "active" };
    check(
      "no lease + ordinary path fails closed",
      decideWrite(null, "app/renderer/App.tsx").allow === false &&
        decideWrite(null, "app/renderer/App.tsx").reason === "lease-required"
    );
    check(
      "no lease + protected path also fails closed through the same lease requirement",
      decideWrite(null, "src/licensing/x.ts").allow === false &&
        decideWrite(null, "src/licensing/x.ts").reason === "lease-required"
    );
    check(
      "only a canonical lowercase task-contract file is a no-lease write control plane",
      isContractControlPath("docs/ai/contracts/awkit-task.json") &&
        decideWrite(null, "docs/ai/contracts/awkit-task.json").allow === true &&
        decideWrite(null, "docs/ai/contracts/awkit-task.json").reason === "contract-control-plane"
    );
    check(
      "active lease, schema, nested, glob, traversal, and case-alias paths are not contract bootstrap writes",
      [
        "docs/ai/contracts/active-lease.json",
        "docs/ai/contracts/TASK_CONTRACT.schema.json",
        "docs/ai/contracts/task_contract.schema.json",
        "docs/ai/contracts/nested/t.json",
        "docs/ai/contracts/*.json",
        "docs/ai/contracts/../t.json",
        "Docs/ai/contracts/awkit-task.json",
        "docs/AI/contracts/awkit-task.json",
        "docs/ai/Contracts/awkit-task.json",
        "docs/ai/contracts/AWKIT-task.json",
        "docs/ai/contracts/awkit-task.JSON"
      ].every((path) => !isContractControlPath(path))
    );
    check("lease + in-scope -> allow", decideWrite(held, "tests/x.ts").allow === true);
    check("lease + out-of-scope -> BLOCK", decideWrite(held, "src/runner/x.ts").allow === false);
    check(
      "a lease may update only its own exact task contract through the control plane",
      decideWrite(held, "docs/ai/contracts/t.json").allow === true &&
        decideWrite(held, "docs/ai/contracts/another-task.json").allow === false
    );
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
  const incompleteLease = tempFile(
    "incomplete-lease.json",
    `${JSON.stringify({ status: "active", holder: "qa" }, null, 2)}\n`
  );
  let incompleteLeaseThrew = false;
  try {
    readLease(incompleteLease);
  } catch {
    incompleteLeaseThrew = true;
  }
  check("an active lease missing enforcement fields fails closed", incompleteLeaseThrew);
  check("an absent lease reads as null", readLease(join(tmpdir(), "awkit-no-such-lease.json")) === null);

  check("the guard reads Edit payloads", targetPathOf({ tool_input: { file_path: "a.ts" } }) === "a.ts");
  check("the guard reads NotebookEdit payloads", targetPathOf({ tool_input: { notebook_path: "b.ipynb" } }) === "b.ipynb");
  check("the guard ignores payloads with no target", targetPathOf({ tool_input: {} }) === null);

  const actorLease = {
    task: "awkit-actor-fixture",
    contract_path: "docs/ai/contracts/awkit-actor-fixture.json",
    holder: "qa",
    status: "active",
    allowed_paths: ["scripts/verify-agent-routing.mjs"]
  };
  const qaAgentType = agent("qa").claudeName;
  const frontendAgentType = agent("frontend").claudeName;
  check(
    "only exact AWKIT claudeName values identify subagent actors",
    AGENTS.every((entry) => canonicalActorId(entry.claudeName, `instance-${entry.id}`) === entry.id) &&
      AGENTS.every((entry) => canonicalActorId(entry.id, `instance-${entry.id}`) === null) &&
      canonicalActorId("AWKIT-QA-ENGINEER", "instance-qa") === null
  );
  check(
    "root Manager identity requires both agent_type and agent_id to be absent",
    canonicalActorId(undefined, undefined) === "manager" &&
      canonicalActorId(undefined, "qa") === null &&
      canonicalActorId("", "qa") === null
  );
  check(
    "the holder may write its leased path but canonical-id impersonation and nonholders cannot",
    decideActorWrite(actorLease, "scripts/verify-agent-routing.mjs", qaAgentType, "instance-qa").allow === true &&
      decideActorWrite(actorLease, "scripts/verify-agent-routing.mjs", "qa", "instance-qa").allow === false &&
      decideActorWrite(actorLease, "scripts/verify-agent-routing.mjs", undefined, "qa").allow === false &&
      decideActorWrite(actorLease, "scripts/verify-agent-routing.mjs", frontendAgentType, "instance-frontend").allow === false
  );
  check(
    "active shell commands require the holder, foreground execution, and the exact verifier form",
    isAllowedActiveShellCommand("npm run verify:agent-routing", actorLease, {
      agentType: qaAgentType,
      agentId: "instance-qa"
    }) &&
      !isAllowedActiveShellCommand("npm run build", actorLease, {
        agentType: frontendAgentType,
        agentId: "instance-frontend"
      }) &&
      !isAllowedActiveShellCommand("npm run verify:agent-routing", actorLease, {
        agentType: qaAgentType,
        agentId: "instance-qa",
        runInBackground: true
      }) &&
      !isAllowedActiveShellCommand("npm run verify:agent-routing -- --output result.json", actorLease, {
        agentType: qaAgentType,
        agentId: "instance-qa"
      }) &&
      !isAllowedActiveShellCommand("npm run verify:agent-routing extra", actorLease, {
        agentType: qaAgentType,
        agentId: "instance-qa"
      })
  );

  const spawnedHolderActor = spawnActorDecision({
    lease: actorLease,
    path: "scripts/verify-agent-routing.mjs",
    command: "npm run verify:agent-routing",
    options: { agentType: qaAgentType, agentId: "instance-qa" }
  });
  const spawnedCanonicalImpersonator = spawnActorDecision({
    lease: actorLease,
    path: "scripts/verify-agent-routing.mjs",
    command: "npm run verify:agent-routing",
    options: { agentType: "qa", agentId: "instance-qa" }
  });
  const spawnedIdOnlyActor = spawnActorDecision({
    lease: actorLease,
    path: "scripts/verify-agent-routing.mjs",
    command: "npm run verify:agent-routing",
    options: { agentId: "qa" }
  });
  const spawnedNonholderActor = spawnActorDecision({
    lease: actorLease,
    path: "scripts/verify-agent-routing.mjs",
    command: "npm run build",
    options: { agentType: frontendAgentType, agentId: "instance-frontend" }
  });
  const spawnedBackgroundActor = spawnActorDecision({
    lease: actorLease,
    path: "scripts/verify-agent-routing.mjs",
    command: "npm run verify:agent-routing",
    options: { agentType: qaAgentType, agentId: "instance-qa", runInBackground: true }
  });
  check(
    "spawned actor probes preserve holder, impersonation, id-only, nonholder, and background decisions",
    [
      spawnedHolderActor,
      spawnedCanonicalImpersonator,
      spawnedIdOnlyActor,
      spawnedNonholderActor,
      spawnedBackgroundActor
    ].every((probe) => probe.status === 0 && probe.value) &&
      spawnedHolderActor.value.write.allow === true &&
      spawnedHolderActor.value.shell === true &&
      spawnedCanonicalImpersonator.value.write.allow === false &&
      spawnedCanonicalImpersonator.value.shell === false &&
      spawnedIdOnlyActor.value.write.allow === false &&
      spawnedIdOnlyActor.value.shell === false &&
      spawnedNonholderActor.value.write.allow === false &&
      spawnedNonholderActor.value.shell === false &&
      spawnedBackgroundActor.value.shell === false,
    [
      spawnedHolderActor,
      spawnedCanonicalImpersonator,
      spawnedIdOnlyActor,
      spawnedNonholderActor,
      spawnedBackgroundActor
    ].map((probe) => `${probe.status}:${probe.stdout || probe.stderr}`).join(" | ")
  );

  const confinementRoot = mkdtempSync(join(tmpdir(), "awkit-guard-root-"));
  const confinementOutside = mkdtempSync(join(tmpdir(), "awkit-guard-outside-"));
  tempDirs.push(confinementRoot, confinementOutside);
  mkdirSync(join(confinementRoot, "inside"), { recursive: true });
  check(
    "physical path confinement accepts an in-repository nearest parent and rejects an external one",
    isPhysicallyWithinRepo(join(confinementRoot, "inside", "new-file.ts"), confinementRoot) &&
      !isPhysicallyWithinRepo(join(confinementOutside, "new-file.ts"), confinementRoot)
  );
  const junctionPath = join(confinementRoot, "outside-junction");
  let junctionSupported = true;
  try {
    symlinkSync(confinementOutside, junctionPath, process.platform === "win32" ? "junction" : "dir");
  } catch {
    junctionSupported = false;
  }
  if (junctionSupported) {
    check(
      "physical path confinement rejects a lexical in-repo path through an external junction",
      !isPhysicallyWithinRepo(join(junctionPath, "escaped.ts"), confinementRoot)
    );
  }

  const incompletePushContract = validContract();
  incompletePushContract.git.push_authorized = true;
  incompletePushContract.git.push_evidence_id = "EV-PUSH";
  incompletePushContract.evidence[0].result = "BLOCKED";
  incompletePushContract.evidence.push({
    id: "EV-PUSH",
    type: "inspection",
    command: "git push origin main",
    required: true,
    result: "pending"
  });
  const incompletePushContractPath = tempFile(
    "incomplete-push-contract.json",
    `${JSON.stringify(incompletePushContract, null, 2)}\n`
  );
  const incompletePushLease = { ...actorLease, contract_path: incompletePushContractPath };
  check(
    "push authorization stays false until the prospective full task gate is clear",
    pushAuthorizedForLease(incompletePushLease) === false &&
      isManagerGitCommand("git push origin main", actorLease, { pushAuthorized: false }) === false &&
      isManagerGitCommand("git push origin main", actorLease, { pushAuthorized: true }) === true
  );

  const malformedGuardPayload = spawnLeaseGuard("{ not json");
  const emptyGuardPayload = spawnLeaseGuard("");
  const missingGuardTarget = spawnLeaseGuard({ tool_name: "Edit", tool_input: {} });
  const outsideGuardTarget = spawnLeaseGuard({
    tool_name: "Write",
    tool_input: { file_path: join(tmpdir(), "awkit-outside-repository.txt") }
  });
  check(
    "malformed and empty PreToolUse payloads block",
    malformedGuardPayload.status === 2 && emptyGuardPayload.status === 2,
    `${malformedGuardPayload.status}/${emptyGuardPayload.status}`
  );
  check(
    "a write-capable payload with no target blocks",
    missingGuardTarget.status === 2 && /no resolvable target/i.test(missingGuardTarget.stderr),
    `${missingGuardTarget.status}: ${missingGuardTarget.stderr}`
  );
  check(
    "a write target outside AWKIT blocks",
    outsideGuardTarget.status === 2 && /outside|cannot be resolved/i.test(outsideGuardTarget.stderr),
    `${outsideGuardTarget.status}: ${outsideGuardTarget.stderr}`
  );

  const productionLease = readLease();
  if (
    productionLease &&
    AGENT_IDS.includes(productionLease.holder) &&
    leaseAllows(productionLease, "scripts/verify-agent-routing.mjs")
  ) {
    check(
      "the live production lease stores its exact task contract as a repo-relative canonical path",
      productionLease.contract_path === `docs/ai/contracts/${productionLease.task}.json` &&
        !isAbsolute(productionLease.contract_path) &&
        !productionLease.contract_path.includes("\\")
    );
    const liveHolderType = agent(productionLease.holder).claudeName;
    const liveNonholder = AGENTS.find(
      (entry) => entry.defaultMode === "writer" && entry.id !== productionLease.holder
    );
    const liveVerifierPath = join(process.cwd(), "scripts", "verify-agent-routing.mjs");
    const liveHolderEdit = spawnLeaseGuard({
      tool_name: "Edit",
      agent_type: liveHolderType,
      agent_id: "live-holder-fixture",
      tool_input: { file_path: liveVerifierPath }
    });
    const liveCanonicalIdImpersonator = spawnLeaseGuard({
      tool_name: "Edit",
      agent_type: productionLease.holder,
      agent_id: "live-canonical-id-fixture",
      tool_input: { file_path: liveVerifierPath }
    });
    const liveIdOnlyImpersonator = spawnLeaseGuard({
      tool_name: "Edit",
      agent_id: productionLease.holder,
      tool_input: { file_path: liveVerifierPath }
    });
    const liveNonholderEdit = spawnLeaseGuard({
      tool_name: "Edit",
      agent_type: liveNonholder?.claudeName,
      agent_id: "live-nonholder-fixture",
      tool_input: { file_path: liveVerifierPath }
    });
    check(
      "the live hook allows the exact holder agent_type and blocks canonical-id, id-only, and nonholder Edit actors",
      liveHolderEdit.status === 0 &&
        liveCanonicalIdImpersonator.status === 2 &&
        liveIdOnlyImpersonator.status === 2 &&
        liveNonholderEdit.status === 2,
      [liveHolderEdit, liveCanonicalIdImpersonator, liveIdOnlyImpersonator, liveNonholderEdit]
        .map((probe) => `${probe.status}:${probe.stderr}`)
        .join(" | ")
    );

    const liveHolderShell = spawnLeaseGuard({
      tool_name: "Bash",
      agent_type: liveHolderType,
      agent_id: "live-holder-fixture",
      tool_input: { command: "npm run verify:agent-routing" }
    });
    const liveNonholderShell = spawnLeaseGuard({
      tool_name: "Bash",
      agent_type: liveNonholder?.claudeName,
      agent_id: "live-nonholder-fixture",
      tool_input: { command: "npm run verify:agent-routing" }
    });
    const liveBackgroundShell = spawnLeaseGuard({
      tool_name: "Bash",
      agent_type: liveHolderType,
      agent_id: "live-holder-fixture",
      tool_input: { command: "npm run verify:agent-routing", run_in_background: true }
    });
    check(
      "the live hook allows the holder's exact foreground verifier and blocks nonholder/background shells",
      liveHolderShell.status === 0 &&
        liveNonholderShell.status === 2 &&
        liveBackgroundShell.status === 2,
      [liveHolderShell, liveNonholderShell, liveBackgroundShell]
        .map((probe) => `${probe.status}:${probe.stderr}`)
        .join(" | ")
    );
  }

  const safeNoLeaseCommands = [
    "git status --short",
    "git diff -- scripts/verify-agent-routing.mjs",
    "git log -1",
    "git show HEAD",
    "git rev-parse HEAD",
    "git ls-files tools/agents",
    "graphify query routing",
    "graphify explain routing",
    "graphify path route validateContract",
    "graphify affected tools/agents/route.mjs",
    "graphify diagnose multigraph",
    "graphify hook status",
    "graphify global list",
    "graphify global path",
    "bd show awkit-fixture",
    "bd list",
    "claude --version",
    "claude mcp list",
    "npm run agent:lease",
    "node tools/agents/task-gate.mjs docs/ai/contracts/awkit-fixture.json"
  ];
  const exactLeaseGrant =
    "npm run agent:lease-grant -- --task awkit-fixture --holder qa --paths scripts/verify-agent-routing.mjs";
  const unsafeNoLeaseCommands = [
    "git status > status.txt",
    "git status; git checkout -- x",
    "git status | tee status.txt",
    "git status --ext-diff",
    "git checkout -- x",
    "git commit -am unsafe",
    "git push origin main",
    "graphify update .",
    "graphify install",
    "graphify query routing --output graph.json",
    "graphify query routing \"--graph=C:/outside/graph.json\"",
    "graphify explain routing --extract-path=C:/outside",
    "bd list \"--profile=external\"",
    "bd show awkit-fixture \"--db=C:/outside.db\"",
    "bd stats \"-Coutside\"",
    "bd update awkit-fixture --status closed",
    "npm install",
    "npm run build",
    "npm run agent:lease-amend -- --add x --reason y",
    "node -e process.exit(0)",
    "node tools/agents/task-gate.mjs contract.json && echo changed"
  ];
  check(
    "the no-lease shell grammar permits every representative bounded read/control command",
    safeNoLeaseCommands.every((command) => isReadOnlyShellCommand(command)),
    safeNoLeaseCommands.filter((command) => !isReadOnlyShellCommand(command)).join(" | ")
  );
  check(
    "the exact lease grant is a Manager control command, never a read-only command",
    !isReadOnlyShellCommand(exactLeaseGrant) && isLeaseGrantCommand(exactLeaseGrant) &&
      !isLeaseGrantCommand(`${exactLeaseGrant} --extra`) &&
      !isLeaseGrantCommand(
        "npm run agent:lease-grant -- --holder qa --task awkit-fixture --paths scripts/verify-agent-routing.mjs"
      )
  );
  check(
    "the no-lease shell grammar rejects mutations, broad execution, and shell composition",
    unsafeNoLeaseCommands.every((command) => !isReadOnlyShellCommand(command)),
    unsafeNoLeaseCommands.filter((command) => isReadOnlyShellCommand(command)).join(" | ")
  );
  const projectStateLease = {
    ...actorLease,
    holder: "project-state",
    allowed_paths: ["docs/**"]
  };
  const externalBdWriteCommands = [
    "bd update awkit-fixture \"-foutside.json\"",
    "bd update awkit-fixture \"--repo=C:/outside\""
  ];
  check(
    "quoted or attached bd profile/db/-C/-f/repo escapes are rejected in read and write modes",
    [
      "bd list \"--profile=external\"",
      "bd show awkit-fixture \"--db=C:/outside.db\"",
      "bd stats \"-Coutside\""
    ].every((command) => !isReadOnlyShellCommand(command)) &&
      externalBdWriteCommands.every(
        (command) => !isAllowedActiveShellCommand(command, projectStateLease, {
          agentType: agent("project-state").claudeName,
          agentId: "instance-project-state"
        })
      )
  );
  check(
    "Graphify cannot redirect reads to an external graph or extraction path",
    [
      "graphify query routing \"--graph=C:/outside/graph.json\"",
      "graphify explain routing --extract-path=C:/outside"
    ].every((command) => !isReadOnlyShellCommand(command))
  );
  check(
    "only the exact verifier command is allowed; arguments and output options are blocked",
    isAllowedActiveShellCommand("npm run verify:agent-routing", actorLease, {
      agentType: qaAgentType,
      agentId: "instance-qa"
    }) &&
      [
        "npm run verify:agent-routing -- --output result.json",
        "npm run verify:agent-routing -- --reporter json",
        "npm run verify:agent-routing extra"
      ].every(
        (command) => !isAllowedActiveShellCommand(command, actorLease, {
          agentType: qaAgentType,
          agentId: "instance-qa"
        })
      )
  );

  /* ======================================================================
     9. Context status, compaction checkpoint, and supported Claude wiring
     ====================================================================== */
  console.log("Context lifecycle:");
  const contextStatus = contextStatusLoad.module;
  const checkpoint = checkpointLoad.module;
  check(
    "context-status.mjs exists and imports",
    contextStatus !== null,
    contextStatusLoad.error?.message ?? "missing module"
  );
  check("renderStatusLine is exported", typeof contextStatus?.renderStatusLine === "function");
  check(
    "compaction-checkpoint.mjs exists and imports",
    checkpoint !== null,
    checkpointLoad.error?.message ?? "missing module"
  );
  for (const name of ["buildCheckpoint", "captureCheckpoint", "renderCheckpoint", "checkpointPathFor"]) {
    check(`${name} is exported`, typeof checkpoint?.[name] === "function");
  }

  const statusPayload = (tokens) => ({
    model: { display_name: "Claude fixture" },
    context_window: {
      context_window_size: 200_000,
      current_usage: {
        input_tokens: tokens,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0
      }
    }
  });
  const nullStatus = invoke(contextStatus?.renderStatusLine, null);
  check(
    "status rendering is null-safe",
    nullStatus.ok && typeof nullStatus.value === "string" && !/undefined|NaN/.test(nullStatus.value),
    nullStatus.error?.message ?? String(nullStatus.value)
  );
  const warningStatus = invoke(contextStatus?.renderStatusLine, statusPayload(120_000));
  check(
    "status rendering labels the warning zone",
    warningStatus.ok && /warning/i.test(String(warningStatus.value)),
    warningStatus.error?.message ?? String(warningStatus.value)
  );
  const compactStatus = invoke(contextStatus?.renderStatusLine, statusPayload(150_000));
  check(
    "status rendering labels the compact zone",
    compactStatus.ok && /compact/i.test(String(compactStatus.value)),
    compactStatus.error?.message ?? String(compactStatus.value)
  );

  const statusCli = spawnSync(process.execPath, ["tools/agents/context-status.mjs"], {
    cwd: process.cwd(),
    input: JSON.stringify(statusPayload(120_000)),
    encoding: "utf8"
  });
  check(
    "context-status CLI accepts a spawned Claude payload",
    statusCli.status === 0 && /warning/i.test(statusCli.stdout),
    `${statusCli.status}: ${statusCli.stderr || statusCli.stdout}`
  );

  const checkpointRoot = mkdtempSync(join(tmpdir(), "awkit-checkpoint-"));
  tempDirs.push(checkpointRoot);
  const checkpointInput = {
    taskId: "awkit-fixture",
    localAppData: checkpointRoot,
    repository: {
      root: process.cwd(),
      branch: "main",
      head: "fixture-head",
      dirty: ["scripts/verify-agent-routing.mjs"],
      activeLease: {
        task: "awkit-fixture",
        holder: "qa",
        status: "active",
        allowed_paths: ["scripts/verify-agent-routing.mjs"],
        violations: [{ path: "none", resolved: true }]
      }
    },
    status: {
      objective: "prove checkpoint recovery",
      acceptanceCriteria: [{ id: "AC-001", description: "resume exactly" }],
      architectureDecisions: ["checkpoint stays ephemeral"],
      filesChanged: ["scripts/verify-agent-routing.mjs"],
      commits: ["fixture-sha"],
      completed: ["routing"],
      unresolved: ["final QC"],
      defects: [],
      checks: [{ id: "EV-001", result: "PASS" }],
      securityConstraints: ["no credentials"],
      dataConstraints: ["LOCALAPPDATA only"],
      offlineConstraints: ["offline"],
      compatibilityConstraints: ["Windows"],
      blockers: [],
      nextAction: "continue the routed task"
    },
    transcript: "DO_NOT_PERSIST_TRANSCRIPT",
    compact_summary: "DO_NOT_PERSIST_SUMMARY",
    messages: [{ role: "user", content: "DO_NOT_PERSIST_MESSAGE" }]
  };
  const checkpointPath = invoke(checkpoint?.checkpointPathFor, {
    taskId: checkpointInput.taskId,
    localAppData: checkpointRoot
  });
  const checkpointRelative =
    typeof checkpointPath.value === "string" ? relative(checkpointRoot, checkpointPath.value) : "";
  const checkpointPathIsLocal =
    checkpointPath.ok &&
    typeof checkpointPath.value === "string" &&
    isAbsolute(checkpointPath.value) &&
    checkpointRelative !== "" &&
    checkpointRelative !== ".." &&
    !checkpointRelative.startsWith(`..${process.platform === "win32" ? "\\\\" : "/"}`) &&
    !isAbsolute(checkpointRelative);
  check(
    "checkpointPathFor confines state beneath injected LOCALAPPDATA",
    checkpointPathIsLocal,
    String(checkpointPath.value ?? checkpointPath.error?.message ?? "no path")
  );

  const builtCheckpoint = invoke(checkpoint?.buildCheckpoint, checkpointInput);
  check("buildCheckpoint accepts a synthetic repository-state probe", builtCheckpoint.ok);
  const expectedCheckpointStatusFields = [
    "objective",
    "acceptance_criteria",
    "architecture_decisions",
    "files_changed",
    "commits",
    "completed",
    "unresolved",
    "defects",
    "checks",
    "security_constraints",
    "data_constraints",
    "offline_constraints",
    "compatibility_constraints",
    "blockers",
    "next_action"
  ];
  check(
    "checkpoint carries the full bounded task-resumption field set",
    builtCheckpoint.ok &&
      sameArray(Object.keys(builtCheckpoint.value.status ?? {}), expectedCheckpointStatusFields) &&
      sameArray(Object.keys(builtCheckpoint.value.repository ?? {}), [
        "root",
        "branch",
        "head",
        "changed_paths",
        "active_lease"
      ]),
    JSON.stringify(builtCheckpoint.value)
  );
  check(
    "checkpoint data never contains transcript or compact-summary fields",
    builtCheckpoint.ok &&
      !containsForbiddenCheckpointKey(builtCheckpoint.value) &&
      !/DO_NOT_PERSIST_(TRANSCRIPT|SUMMARY|MESSAGE)/.test(JSON.stringify(builtCheckpoint.value)),
    JSON.stringify(builtCheckpoint.value)
  );
  const renderedCheckpoint = invoke(checkpoint?.renderCheckpoint, builtCheckpoint.value);
  check(
    "restore output identifies checkpoint state as ephemeral and non-authoritative",
    renderedCheckpoint.ok &&
      /ephemeral/i.test(String(renderedCheckpoint.value)) &&
      /non[- ]authoritative/i.test(String(renderedCheckpoint.value)),
    renderedCheckpoint.error?.message ?? String(renderedCheckpoint.value)
  );

  const capturedCheckpoint = checkpointPathIsLocal
    ? await invokeAsync(checkpoint?.captureCheckpoint, checkpointInput)
    : { ok: false, value: undefined, error: new Error("unsafe checkpoint path") };
  const capturedFiles = filesBelow(checkpointRoot);
  check(
    "captureCheckpoint writes a local ephemeral checkpoint",
    capturedCheckpoint.ok && capturedFiles.length > 0,
    capturedCheckpoint.error?.message ?? JSON.stringify(capturedCheckpoint.value)
  );
  const capturedText = capturedFiles
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  check(
    "persisted checkpoint files omit transcript, compact_summary, and messages",
    capturedFiles.length > 0 &&
      !/DO_NOT_PERSIST_(TRANSCRIPT|SUMMARY|MESSAGE)/.test(capturedText) &&
      !/\"(?:transcript|compact_summary|messages)\"\s*:/i.test(capturedText),
    capturedFiles.join(", ")
  );

  const hostileSentinels = [
    "HOSTILE_PASSWORD_SENTINEL",
    "HOSTILE_SECRET_SENTINEL",
    "HOSTILE_TOKEN_SENTINEL",
    "HOSTILE_COOKIE_SENTINEL",
    "HOSTILE_CREDENTIAL_SENTINEL",
    "HOSTILE_AUTHORIZATION_SENTINEL",
    "HOSTILE_API_KEY_SENTINEL",
    "HOSTILE_PRIVATE_KEY_SENTINEL",
    "HOSTILE_CONNECTION_STRING_SENTINEL",
    "HOSTILE_SESSION_STATE_SENTINEL",
    "HOSTILE_TRANSCRIPT_SENTINEL",
    "HOSTILE_MESSAGE_SENTINEL",
    "HOSTILE_CONVERSATION_SENTINEL"
  ];
  const hostileCheckpointInput = {
    taskId: "awkit-hostile-fixture",
    repository: {
      root: process.cwd(),
      branch: "main",
      head: "fixture-head",
      password: hostileSentinels[0],
      secret: hostileSentinels[1],
      token: hostileSentinels[2],
      cookie: hostileSentinels[3],
      credential: hostileSentinels[4],
      authorization: hostileSentinels[5],
      session_state: hostileSentinels[9]
    },
    status: {
      objective: `password=${hostileSentinels[0]}`,
      acceptanceCriteria: [{ secret: hostileSentinels[1], note: `cookie=${hostileSentinels[3]}` }],
      architectureDecisions: [`token=${hostileSentinels[2]}`],
      filesChanged: [],
      commits: [`credential=${hostileSentinels[4]}`],
      completed: [`authorization=${hostileSentinels[5]}`],
      unresolved: [`api_key=${hostileSentinels[6]}`],
      defects: [`private_key=${hostileSentinels[7]}`],
      checks: [`connection_string=${hostileSentinels[8]}`],
      securityConstraints: [{ session_state: hostileSentinels[9] }],
      dataConstraints: [{ transcript: hostileSentinels[10] }],
      offlineConstraints: [{ messages: hostileSentinels[11] }],
      compatibilityConstraints: [{ conversation: hostileSentinels[12] }],
      blockers: [],
      nextAction: "inspect live state"
    },
    transcript: hostileSentinels[10],
    messages: hostileSentinels[11],
    conversation: hostileSentinels[12]
  };
  const hostileCheckpoint = invoke(checkpoint?.buildCheckpoint, hostileCheckpointInput);
  const hostileSerialized = JSON.stringify(hostileCheckpoint.value ?? {});
  check(
    "hostile password/secret/token/cookie/credential/string sentinels are omitted or redacted",
    hostileCheckpoint.ok && hostileSentinels.every((sentinel) => !hostileSerialized.includes(sentinel)),
    hostileSentinels.filter((sentinel) => hostileSerialized.includes(sentinel)).join(", ")
  );
  const hostileCapture = await invokeAsync(checkpoint?.captureCheckpoint, {
    ...hostileCheckpointInput,
    localAppData: checkpointRoot
  });
  const hostilePersisted = hostileCapture.ok
    ? readFileSync(hostileCapture.value.path, "utf8")
    : String(hostileCapture.error?.message ?? "capture failed");
  check(
    "persisted checkpoint also omits every hostile sentinel",
    hostileCapture.ok && hostileSentinels.every((sentinel) => !hostilePersisted.includes(sentinel)),
    hostilePersisted
  );

  const checkpointCliEnv = { ...process.env, LOCALAPPDATA: checkpointRoot };
  const checkpointCaptureCli = spawnSync(
    process.execPath,
    ["tools/agents/compaction-checkpoint.mjs", "capture"],
    {
      cwd: process.cwd(),
      env: checkpointCliEnv,
      input: JSON.stringify({
        taskId: "awkit-cli-fixture",
        transcript: "DO_NOT_PERSIST_CLI_TRANSCRIPT",
        compact_summary: "DO_NOT_PERSIST_CLI_SUMMARY"
      }),
      encoding: "utf8"
    }
  );
  check(
    "PreCompact capture CLI is non-fatal for a spawned hook payload",
    checkpointCaptureCli.status === 0,
    `${checkpointCaptureCli.status}: ${checkpointCaptureCli.stderr}`
  );
  const checkpointRestoreCli = spawnSync(
    process.execPath,
    ["tools/agents/compaction-checkpoint.mjs", "restore"],
    {
      cwd: process.cwd(),
      env: checkpointCliEnv,
      input: JSON.stringify({ taskId: "awkit-cli-fixture" }),
      encoding: "utf8"
    }
  );
  check(
    "SessionStart restore CLI is non-fatal and labels ephemeral non-authoritative state",
    checkpointRestoreCli.status === 0 &&
      /ephemeral/i.test(checkpointRestoreCli.stdout) &&
      /non[- ]authoritative/i.test(checkpointRestoreCli.stdout),
    `${checkpointRestoreCli.status}: ${checkpointRestoreCli.stderr || checkpointRestoreCli.stdout}`
  );
  const allCheckpointText = filesBelow(checkpointRoot)
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  check(
    "spawned checkpoint payloads never persist transcript or compact_summary",
    !/DO_NOT_PERSIST_CLI_(TRANSCRIPT|SUMMARY)/.test(allCheckpointText)
  );

  const recoveryCwd = mkdtempSync(join(tmpdir(), "awkit-checkpoint-recovery-"));
  tempDirs.push(recoveryCwd);
  const recoverySession = "awkit-session-after-release";
  const recoveryCaptureCli = spawnSync(
    process.execPath,
    ["tools/agents/compaction-checkpoint.mjs", "capture"],
    {
      cwd: process.cwd(),
      env: checkpointCliEnv,
      input: JSON.stringify({
        taskId: "awkit-released-fixture",
        session_id: recoverySession,
        cwd: recoveryCwd,
        localAppData: checkpointRoot
      }),
      encoding: "utf8"
    }
  );
  const recoveryRestoreCli = spawnSync(
    process.execPath,
    ["tools/agents/compaction-checkpoint.mjs", "restore"],
    {
      cwd: process.cwd(),
      env: checkpointCliEnv,
      input: JSON.stringify({
        session_id: recoverySession,
        cwd: recoveryCwd,
        localAppData: checkpointRoot
      }),
      encoding: "utf8"
    }
  );
  check(
    "compact SessionStart recovers the captured task after its active lease is gone",
    recoveryCaptureCli.status === 0 &&
      recoveryRestoreCli.status === 0 &&
      /Task: awkit-released-fixture/.test(recoveryRestoreCli.stdout),
    `${recoveryCaptureCli.status}/${recoveryRestoreCli.status}: ${recoveryRestoreCli.stdout || recoveryRestoreCli.stderr}`
  );

  const claudeSettings = JSON.parse(
    readFileSync(new URL("../.claude/settings.json", import.meta.url), "utf8")
  );
  const expectedProjectPermissionAllows = [
    ...CODEBASE_MEMORY_READ_TOOLS,
    ...CLAUDE_BASH_PERMISSION_RULES
  ];
  const projectPermissionAllows = claudeSettings.permissions?.allow ?? [];
  const projectPermissionDenies = claudeSettings.permissions?.deny ?? [];
  check(
    "project settings have the byte/order-exact 63-entry MCP plus Bash allowlist",
    expectedProjectPermissionAllows.length === 63 &&
      projectPermissionAllows.length === 63 &&
      sameArray(projectPermissionAllows, expectedProjectPermissionAllows),
    JSON.stringify(projectPermissionAllows)
  );
  check(
    "project settings have the byte/order-exact 41-entry permission denylist",
    CLAUDE_PERMISSION_DENIES.length === 41 &&
      projectPermissionDenies.length === 41 &&
      sameArray(projectPermissionDenies, CLAUDE_PERMISSION_DENIES),
    JSON.stringify(projectPermissionDenies)
  );
  check(
    "project allows contain no broad MCP/Graphify wildcard or denied mutator",
    !projectPermissionAllows.includes("mcp__codebase-memory-mcp__*") &&
      !projectPermissionAllows.includes("Bash(graphify:*)") &&
      CODEBASE_MEMORY_MUTATING_TOOLS.every((rule) => !projectPermissionAllows.includes(rule)) &&
      GRAPHIFY_MUTATION_DENIES.every((rule) => !projectPermissionAllows.includes(rule)),
    JSON.stringify(projectPermissionAllows.filter((rule) =>
      rule === "mcp__codebase-memory-mcp__*" ||
      rule === "Bash(graphify:*)" ||
      CODEBASE_MEMORY_MUTATING_TOOLS.includes(rule) ||
      GRAPHIFY_MUTATION_DENIES.includes(rule)
    ))
  );
  const hooksFor = (event) =>
    (claudeSettings.hooks?.[event] ?? []).flatMap((group) =>
      (group.hooks ?? []).map((hook) => ({ matcher: group.matcher, ...hook }))
    );
  const leaseHooks = hooksFor("PreToolUse");
  const bashHooks = hooksFor("PostToolUse");
  check(
    "the exact Edit/Write/NotebookEdit lease hook remains wired",
    leaseHooks.filter(
      (hook) =>
        hook.matcher === "Edit|Write|NotebookEdit" &&
        hook.type === "command" &&
        hook.command === "node tools/agents/lease-guard.mjs"
    ).length === 1
  );
  check(
    "the exact Bash/PowerShell pre-command lease hook remains wired",
    leaseHooks.filter(
      (hook) =>
        hook.matcher === "Bash|PowerShell" &&
        hook.type === "command" &&
        hook.command === "node tools/agents/lease-guard.mjs"
    ).length === 1
  );
  check(
    "the exact Bash post-write audit hook remains wired",
    bashHooks.filter(
      (hook) =>
        hook.matcher === "Bash" &&
        hook.type === "command" &&
        hook.command === "node tools/agents/bash-audit.mjs"
    ).length === 1
  );
  check(
    "the exact PowerShell post-write audit hook remains wired",
    bashHooks.filter(
      (hook) =>
        hook.matcher === "PowerShell" &&
        hook.type === "command" &&
        hook.command === "node tools/agents/bash-audit.mjs"
    ).length === 1
  );
  const preCompactHooks = hooksFor("PreCompact");
  const postCompactHooks = hooksFor("PostCompact");
  const compactSessionStartHooks = hooksFor("SessionStart").filter(
    (hook) => hook.matcher === "compact"
  );
  check(
    "PreCompact synchronously captures one checkpoint with the bounded timeout",
    preCompactHooks.length === 1 &&
      preCompactHooks[0].matcher === "manual|auto" &&
      preCompactHooks[0].type === "command" &&
      preCompactHooks[0].command === "node tools/agents/compaction-checkpoint.mjs capture" &&
      preCompactHooks[0].timeout === 15 &&
      !("async" in preCompactHooks[0])
  );
  check(
    "compact SessionStart synchronously restores one checkpoint with the bounded timeout",
    compactSessionStartHooks.length === 1 &&
      compactSessionStartHooks[0].type === "command" &&
      compactSessionStartHooks[0].command ===
        "node tools/agents/compaction-checkpoint.mjs restore" &&
      compactSessionStartHooks[0].timeout === 15 &&
      !("async" in compactSessionStartHooks[0])
  );
  check(
    "PostCompact is absent because compact SessionStart owns restore",
    postCompactHooks.length === 0,
    JSON.stringify(postCompactHooks)
  );
  check(
    "statusLine runs context-status.mjs",
    claudeSettings.statusLine?.type === "command" &&
      /(?:^|\s)node\s+tools\/agents\/context-status\.mjs(?:\s|$)/.test(
        claudeSettings.statusLine.command ?? ""
      )
  );
  check(
    "the supported compaction window is exactly 200000 tokens with a 75 percent override",
    claudeSettings.env?.CLAUDE_CODE_AUTO_COMPACT_WINDOW === "200000" &&
      claudeSettings.env?.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE === "75" &&
    !("autoCompactWindow" in claudeSettings) &&
      Object.keys(claudeSettings.env ?? {}).filter((key) => /COMPACT/i.test(key)).length === 2
  );
  check(
    "Agent Teams are not globally enabled",
    !("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS" in (claudeSettings.env ?? {})) &&
      !JSON.stringify(claudeSettings).includes("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS")
  );

  /* ======================================================================
     10. Operational completion gate
     ====================================================================== */
  console.log("Task completion gate:");
  const taskGate = taskGateLoad.module;
  check(
    "task-gate.mjs exists and imports",
    taskGate !== null,
    taskGateLoad.error?.message ?? "missing module"
  );
  check("evaluateTaskGate is exported", typeof taskGate?.evaluateTaskGate === "function");

  const gateBlockers = (result) => [
    ...(Array.isArray(result?.blockers) ? result.blockers : []),
    ...(Array.isArray(result?.scopeEscapes) ? result.scopeEscapes : []),
    ...(Array.isArray(result?.scope_escapes) ? result.scope_escapes : [])
  ];
  const gateIsOpen = (result) =>
    (result?.ok ?? result?.canComplete ?? result?.allowed) === true;

  const inScopeGate = await invokeAsync(taskGate?.evaluateTaskGate, validContract(), {
    lease: null,
    changedFiles: ["app/renderer/components/Thing.tsx"],
    guardedFieldChanges: []
  });
  check(
    "task gate opens for a valid, proven, in-scope change",
    inScopeGate.ok && gateIsOpen(inScopeGate.value),
    JSON.stringify(inScopeGate.value ?? inScopeGate.error?.message)
  );

  const escapedGate = await invokeAsync(taskGate?.evaluateTaskGate, validContract(), {
    lease: null,
    changedFiles: ["src/storage/outside.ts"],
    guardedFieldChanges: []
  });
  check(
    "task gate blocks a derived scope escape since baseline_commit",
    escapedGate.ok &&
      !gateIsOpen(escapedGate.value) &&
      /scope|persistence/i.test(JSON.stringify(gateBlockers(escapedGate.value))),
    JSON.stringify(escapedGate.value ?? escapedGate.error?.message)
  );

  const preservedContract = validContract();
  const preservedFingerprint = {
    path: "src/storage/pre-existing.ts",
    git_status: " M",
    sha256: "a".repeat(64)
  };
  preservedContract.repository.preserved_paths = [preservedFingerprint];
  const preservedGate = await invokeAsync(taskGate?.evaluateTaskGate, preservedContract, {
    lease: null,
    changedFiles: ["src/storage/pre-existing.ts"],
    guardedFieldChanges: [],
    preservedStates: {
      "src/storage/pre-existing.ts": { ...preservedFingerprint }
    }
  });
  check(
    "task gate excludes explicitly preserved pre-existing paths from derived escapes",
    preservedGate.ok && gateIsOpen(preservedGate.value),
    JSON.stringify(preservedGate.value ?? preservedGate.error?.message)
  );
  const changedPreservedGate = await invokeAsync(taskGate?.evaluateTaskGate, preservedContract, {
    lease: null,
    changedFiles: ["src/storage/pre-existing.ts"],
    guardedFieldChanges: [],
    preservedStates: {
      "src/storage/pre-existing.ts": { ...preservedFingerprint, sha256: "b".repeat(64) }
    }
  });
  check(
    "a preserved file with changed content is a blocking scope escape",
    changedPreservedGate.ok &&
      !gateIsOpen(changedPreservedGate.value) &&
      /preserved|fingerprint|changed/i.test(JSON.stringify(gateBlockers(changedPreservedGate.value))),
    JSON.stringify(changedPreservedGate.value ?? changedPreservedGate.error?.message)
  );
  const replacedPreservedGate = await invokeAsync(taskGate?.evaluateTaskGate, preservedContract, {
    lease: null,
    changedFiles: ["src/storage/pre-existing.ts"],
    guardedFieldChanges: [],
    preservedStates: {
      "src/storage/pre-existing.ts": { ...preservedFingerprint, git_status: "??" }
    }
  });
  check(
    "a preserved file replaced by a new file is a blocking scope escape",
    replacedPreservedGate.ok &&
      !gateIsOpen(replacedPreservedGate.value) &&
      /preserved|status|changed/i.test(JSON.stringify(gateBlockers(replacedPreservedGate.value))),
    JSON.stringify(replacedPreservedGate.value ?? replacedPreservedGate.error?.message)
  );

  const baselineRepo = mkdtempSync(join(tmpdir(), "awkit-task-gate-git-"));
  tempDirs.push(baselineRepo);
  execFileSync("git", ["init"], { cwd: baselineRepo, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "AWKIT Routing Verifier"], {
    cwd: baselineRepo,
    stdio: "ignore"
  });
  execFileSync("git", ["config", "user.email", "routing-verifier@example.invalid"], {
    cwd: baselineRepo,
    stdio: "ignore"
  });
  writeFileSync(join(baselineRepo, "baseline.txt"), "baseline\n", "utf8");
  execFileSync("git", ["add", "baseline.txt"], { cwd: baselineRepo, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "baseline"], { cwd: baselineRepo, stdio: "ignore" });
  const validBaseline = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: baselineRepo,
    encoding: "utf8"
  }).trim();
  const validBaselineContract = validContract();
  validBaselineContract.repository.baseline_commit = validBaseline;
  const validBaselineGate = await invokeAsync(taskGate?.evaluateTaskGate, validBaselineContract, {
    cwd: baselineRepo,
    lease: null,
    changedFiles: [],
    guardedFieldChanges: []
  });
  check(
    "a real temporary-repository baseline is accepted",
    validBaselineGate.ok && gateIsOpen(validBaselineGate.value),
    JSON.stringify(validBaselineGate.value ?? validBaselineGate.error?.message)
  );
  const invalidBaselineContract = validContract();
  invalidBaselineContract.repository.baseline_commit = "definitely-not-a-commit";
  const invalidBaselineGate = await invokeAsync(taskGate?.evaluateTaskGate, invalidBaselineContract, {
    cwd: baselineRepo,
    lease: null,
    changedFiles: [],
    guardedFieldChanges: []
  });
  check(
    "task completion fails closed when its Git baseline is invalid",
    invalidBaselineGate.ok &&
      !gateIsOpen(invalidBaselineGate.value) &&
      /baseline is invalid|baseline.*unavailable/i.test(JSON.stringify(gateBlockers(invalidBaselineGate.value))),
    JSON.stringify(invalidBaselineGate.value ?? invalidBaselineGate.error?.message)
  );
  const noGitGateRoot = mkdtempSync(join(tmpdir(), "awkit-task-gate-no-git-"));
  tempDirs.push(noGitGateRoot);
  const unavailableGitGate = await invokeAsync(taskGate?.evaluateTaskGate, validContract(), {
    cwd: noGitGateRoot,
    lease: null,
    guardedFieldChanges: []
  });
  check(
    "task completion fails closed when Git change derivation is unavailable",
    unavailableGitGate.ok &&
      !gateIsOpen(unavailableGitGate.value) &&
      /changed-file derivation failed closed/i.test(JSON.stringify(gateBlockers(unavailableGitGate.value))),
    JSON.stringify(unavailableGitGate.value ?? unavailableGitGate.error?.message)
  );
  const unreadableLeaseGate = await invokeAsync(taskGate?.evaluateTaskGate, validContract(), {
    lease: null,
    changedFiles: [],
    guardedFieldChanges: [],
    infrastructureBlockers: ["active lease is unreadable: fixture corruption"]
  });
  check(
    "an unreadable active lease is an infrastructure blocker, never absence",
    unreadableLeaseGate.ok &&
      !gateIsOpen(unreadableLeaseGate.value) &&
      /active lease is unreadable/i.test(JSON.stringify(gateBlockers(unreadableLeaseGate.value))),
    JSON.stringify(unreadableLeaseGate.value ?? unreadableLeaseGate.error?.message)
  );

  const guardedGate = await invokeAsync(taskGate?.evaluateTaskGate, validContract(), {
    lease: null,
    changedFiles: ["app/renderer/components/Thing.tsx"],
    guardedFieldChanges: [
      {
        path: "package.json",
        owner: "release",
        changedGuardedFields: ["dependencies"],
        changedSharedFields: []
      }
    ]
  });
  check(
    "task gate blocks a guarded shared-file field escape",
    guardedGate.ok &&
      !gateIsOpen(guardedGate.value) &&
      /guarded|release|dependencies/i.test(JSON.stringify(gateBlockers(guardedGate.value))),
    JSON.stringify(guardedGate.value ?? guardedGate.error?.message)
  );

  const invalidGateContractPath = tempFile(
    "invalid-task-contract.json",
    `${JSON.stringify({ task: { id: "invalid" } }, null, 2)}\n`
  );
  const taskGateCli = spawnSync(
    process.execPath,
    ["tools/agents/task-gate.mjs", invalidGateContractPath],
    { cwd: process.cwd(), encoding: "utf8" }
  );
  const taskGateCliOutput = `${taskGateCli.stdout}\n${taskGateCli.stderr}`;
  check(
    "task-gate direct CLI evaluates a contract and reports blockers",
    taskGateCli.status !== 0 &&
      !/ERR_MODULE_NOT_FOUND|Cannot find module/i.test(taskGateCliOutput) &&
      /block|invalid|fail/i.test(taskGateCliOutput),
    `${taskGateCli.status}: ${taskGateCliOutput}`
  );

  /* ======================================================================
     11. Rendered documentation agrees with the registry
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
  check(
    "the contract schema supports explicit inspect/change task mode",
    sameArray([...(schema.properties?.task?.properties?.mode?.enum ?? [])].sort(), ["change", "inspect"]),
    JSON.stringify(schema.properties?.task?.properties?.mode)
  );
  const preservedItemSchema = schema.properties?.repository?.properties?.preserved_paths?.items;
  check(
    "the contract schema requires preserved path/status/SHA fingerprint objects",
    preservedItemSchema?.type === "object" &&
      sameArray([...(preservedItemSchema.required ?? [])].sort(), ["git_status", "path", "sha256"]) &&
      preservedItemSchema.properties?.path?.type === "string" &&
      preservedItemSchema.properties?.git_status?.type === "string" &&
      preservedItemSchema.properties?.sha256?.type === "string",
    JSON.stringify(preservedItemSchema)
  );
  check(
    "the contract schema preserves append-only lease history",
    schema.properties?.write_lease?.properties?.history?.type === "array" &&
      schema.properties.write_lease.properties.history.items?.type === "object",
    JSON.stringify(schema.properties?.write_lease?.properties?.history)
  );

  const packageManifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8")
  );
  check(
    "package scripts keep docs render, agent render, and agent check commands separate",
    packageManifest.scripts?.["agent:render-docs"] ===
      "node tools/agents/render-docs.mjs --write" &&
      packageManifest.scripts?.["agent:render-agents"] ===
        "node tools/agents/render-platform-agents.mjs --write" &&
      packageManifest.scripts?.["agent:check-agents"] ===
        "node tools/agents/render-platform-agents.mjs" &&
      !packageManifest.scripts["agent:check-agents"].includes("--write")
  );

  /* ======================================================================
     12. Generated platform agent definitions
     ====================================================================== */
  console.log("Generated platform definitions:");
  const generated = allGeneratedFiles();
  check(
    "one definition per agent, plus the two adapters",
    generated.length === AGENTS.length + 2,
    `got ${generated.length}`
  );

  const claudeDefinitions = generated.filter((file) =>
    file.path.replace(/\\/g, "/").includes("/.claude/agents/")
  );
  const expectedClaudeFiles = canonicalClaudeNames.map((name) => `${name}.md`).sort();
  const onDiskClaudeFiles = readdirSync(new URL("../.claude/agents", import.meta.url), {
    withFileTypes: true
  })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
  check(
    "generated Claude discovery has exactly the 16 AWKIT-scoped definitions and no legacy duplicates",
    sameArray(onDiskClaudeFiles, expectedClaudeFiles),
    `got [${onDiskClaudeFiles.join(", ")}]`
  );
  check(
    "allGeneratedFiles uses each registry claudeName",
    sameArray(
      claudeDefinitions.map((file) => file.path.replace(/\\/g, "/").split("/").at(-1)).sort(),
      expectedClaudeFiles
    )
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

  const supportedModelAliases = ["inherit", "haiku", "sonnet", "opus"];
  for (const a of AGENTS) {
    const def = claudeDefinitions.find((file) => file.path.endsWith(`${a.claudeName}.md`));
    const content = def?.content ?? "";
    const description = frontmatterValue(content, "description");
    const model = frontmatterValue(content, "model");
    const maxTurns = Number(frontmatterValue(content, "maxTurns"));
    const denylist = frontmatterValue(content, "disallowedTools");
    const permissionMode = frontmatterValue(content, "permissionMode");
    const tools = frontmatterValue(content, "tools");
    const generatedMcpGrants = [
      ...tools.matchAll(/mcp__codebase-memory-mcp__[A-Za-z0-9_.*-]+/g)
    ].map((match) => match[0]);
    const generatedSkillGrants = [...tools.matchAll(/Skill\(([^)]+)\)/g)]
      .map((match) => match[1]);
    const generatedDeniedTools = denylist.split(", ").filter(Boolean);

    check(
      `generated ${a.id} uses Claude identity ${a.claudeName}`,
      frontmatterValue(content, "name") === a.claudeName
    );
    check(
      `generated ${a.claudeName} uses a supported model alias`,
      supportedModelAliases.includes(model),
      model || "missing"
    );
    check(
      `generated ${a.claudeName} has a conservative maxTurns bound`,
      Number.isInteger(maxTurns) && maxTurns >= 1 && maxTurns <= 32,
      String(maxTurns)
    );
    check(
      `generated ${a.claudeName} carries a non-empty tool denylist`,
      denylist.length > 0,
      "missing disallowedTools"
    );
    check(
      `generated ${a.claudeName} uses normal permission lookup`,
      permissionMode === "default",
      permissionMode || "missing permissionMode"
    );
    check(
      `generated ${a.claudeName} exposes bare Bash with no command patterns in tools`,
      /(?:^|, )Bash(?:,|$)/.test(tools) && !/Bash\(/.test(tools),
      tools
    );
    check(
      `generated ${a.claudeName} disallows actual tool names only`,
      generatedDeniedTools.length > 0 &&
        generatedDeniedTools.every((name) => generatedDenyToolNames.has(name)) &&
        !/[()]/.test(denylist),
      denylist
    );
    check(
      `generated ${a.claudeName} has exact MCP reads and lazy role skills`,
      sameArray(generatedMcpGrants, expectedCodebaseMemoryReads) &&
        !tools.includes("mcp__codebase-memory-mcp__*") &&
        sameArray(generatedSkillGrants, ROLE_SKILLS[a.id] ?? []) &&
        tools === toolsFor(a.id) &&
        denylist === disallowedToolsFor(a.id),
      tools
    );

    const triggerRules = ACTIVATION_RULES.filter((rule) => rule.agent === a.id);
    const missingTriggers = [];
    for (const rule of triggerRules) {
      for (const flag of rule.anyFlag) {
        if (!description.includes(flag)) missingTriggers.push(flag);
      }
      if (
        typeof rule.minRisk === "number" &&
        !(description.includes("risk_level") && description.includes(String(rule.minRisk)))
      ) {
        missingTriggers.push(`risk_level >= ${rule.minRisk}`);
      }
      if (
        typeof rule.minCrossLayer === "number" &&
        !(description.includes("cross_layer_count") && description.includes(String(rule.minCrossLayer)))
      ) {
        missingTriggers.push(`cross_layer_count >= ${rule.minCrossLayer}`);
      }
      if (rule.onOwnedPath && !/owned path|path it owns|expected path/i.test(description)) {
        missingTriggers.push("owned expected path");
      }
    }
    if (a.id === "manager" && !/always/i.test(description)) missingTriggers.push("always");
    check(
      `generated ${a.claudeName} discovery description includes every trigger`,
      missingTriggers.length === 0,
      missingTriggers.join(", ")
    );

    check(
      `generated ${a.claudeName} carries the FACT/INFERENCE/RECOMMENDATION/UNKNOWN contract`,
      requiredDelegation.every((field) => content.includes(field)),
      requiredDelegation.filter((field) => !content.includes(field)).join(", ")
    );
    const lowerContent = content.toLowerCase().replace(/[_-]+/g, " ");
    check(
      `generated ${a.claudeName} carries every specialist report section`,
      requiredSections.every((section) => lowerContent.includes(section)),
      requiredSections.filter((section) => !lowerContent.includes(section)).join(", ")
    );
  }

  // A read-only role must not be handed write tools by the GENERATOR either, not merely by the
  // registry — the frontmatter is what the runtime actually reads.
  for (const a of AGENTS.filter((x) => ["read-only", "advisory", "review"].includes(x.defaultMode))) {
    const def = claudeDefinitions.find((f) => f.path.endsWith(`${a.claudeName}.md`));
    check(
      `the generated ${a.id} definition grants no Edit/Write`,
      def !== undefined && !/^tools:.*\b(Edit|Write)\b/m.test(def.content)
    );
    check(
      `the generated ${a.id} denylist explicitly denies Edit and Write`,
      def !== undefined &&
        /^(?:disallowedTools):.*\bEdit\b.*\bWrite\b|^(?:disallowedTools):.*\bWrite\b.*\bEdit\b/m.test(
          def.content
        )
    );
  }
} finally {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed}/${passed + failed} agent routing checks passed`);
if (failed > 0) process.exit(1);
