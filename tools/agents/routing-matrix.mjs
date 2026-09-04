/**
 * The canonical routing registry — the ONE source for who may write where, which specialists a task
 * activates, and what risk level it carries.
 *
 * Why this is a `.mjs` module and not `ROUTING_MATRIX.yaml`:
 *
 *   1. The repository has no YAML parser in `dependencies` or `devDependencies`. Adding one would
 *      itself be a `new_dependency: true` change — the exact class this architecture routes to the
 *      Architect and Release specialists and reviews against the offline boundary. A governance
 *      tool must not open the boundary it exists to police.
 *   2. TypeScript would buy nothing here: `npm run build` runs `tsc --noEmit` over `include:
 *      ["app", "src", …]` only, so a registry under `tools/` or `scripts/` is NOT typechecked by the
 *      build. The claim "the build catches a malformed registry" would be false.
 *   3. `tools/roadmap/lib/sources.mjs` already establishes the pattern: a plain ESM module with
 *      JSDoc typedefs, consumed by parsers and by a verifier, that fails in ONE place with a clear
 *      message when something is renamed.
 *   4. The write-lease guard runs on EVERY Edit/Write as a `PreToolUse` hook. It must start in
 *      milliseconds, which rules out a `tsx` entry point. A `.mjs` registry is importable directly
 *      by `node`.
 *
 * The human-readable `docs/ai/routing/ROUTING_MATRIX.md` is RENDERED from this module and asserted
 * against it by `verify:agent-routing`. Never hand-edit the rendered table — that is how the
 * proposal's §17 pseudocode, §18 matrix and §24 validator came to disagree with each other.
 */

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Evidence vocabulary
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The ledger's own status words, copied deliberately rather than invented.
 *
 * `tools/roadmap/lib/parse-ledger.mjs` defines LEDGER_STATUSES as exactly these five. An earlier
 * draft of this architecture used `NOT_RUN` (underscore) and added `INCONCLUSIVE` while dropping
 * `NOT APPLICABLE`, which would have created a second, near-identical vocabulary in a system whose
 * first principle is one repository truth. An inconclusive check is `NOT RUN` with a reason.
 *
 * `verify:agent-routing` asserts this array still equals the ledger's set, so a change there fails
 * here instead of drifting silently.
 * @type {readonly string[]}
 */
export const EVIDENCE_STATUSES = Object.freeze([
  "PASS",
  "FAIL",
  "BLOCKED",
  "NOT RUN",
  "NOT APPLICABLE"
]);

/** Statuses that may never be counted as success. BLOCKED != PASS is the repository's oldest rule. */
export const NON_PASSING_STATUSES = Object.freeze(["FAIL", "BLOCKED", "NOT RUN"]);

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Agents
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * @typedef {Object} AgentEntry
 * @property {string} id            canonical agent id, used everywhere
 * @property {string} role          human-readable role
 * @property {"read-only"|"writer"} defaultMode
 * @property {string} claudeName   executable project-scoped Claude identity
 * @property {"inherit"|"haiku"|"sonnet"|"opus"} model
 * @property {number} maxTurns
 * @property {string[]} ownsPaths   globs this agent may hold a write lease over
 * @property {string} [agentsMd]    the per-folder AGENTS.md that already governs this area
 * @property {string} mandate       one line: what this agent is answerable for
 */

/**
 * The sixteen canonical agents requested by AWKIT's token-aware orchestration architecture.
 *
 * `ownsPaths` is the ONLY hand-edited statement of write ownership. PATH_DOMAINS below must resolve
 * every one of these globs back to the same owner, and the verifier rejects overlaps. Read-only
 * specialists deliberately own no product paths: they advise, then a writer applies the change.
 *
 * @type {readonly AgentEntry[]}
 */
export const AGENTS = Object.freeze([
  {
    id: "manager",
    claudeName: "awkit-manager",
    role: "Manager / Orchestrator",
    defaultMode: "writer",
    model: "inherit",
    maxTurns: 32,
    ownsPaths: [
      "tools/agents/**",
      ".claude/**",
      ".codex/**",
      ".gemini/**",
      ".agents/**",
      ".cursor/**",
      ".cbmignore",
      ".graphifyignore",
      ".mcp.json",
      "scripts/AGENTS.md",
      "src/AGENTS.md",
      "AGENTS.md",
      "CLAUDE.md",
      "GEMINI.md"
    ],
    mandate:
      "Owns task decomposition, deterministic routing, context budgets, the serialized write lease, " +
      "acceptance synthesis and final repository gates; it delegates detailed discovery."
  },
  {
    id: "architect",
    claudeName: "awkit-system-architect",
    role: "Software Architect",
    defaultMode: "read-only",
    model: "inherit",
    maxTurns: 18,
    ownsPaths: [],
    mandate:
      "Analyzes Electron boundaries, IPC, runner/orchestration, persistence contracts, offline " +
      "packaging, compatibility, concurrency and architectural debt before implementation."
  },
  {
    id: "uiux",
    claudeName: "awkit-ui-designer",
    role: "UI/UX & Accessibility Specialist",
    defaultMode: "read-only",
    model: "inherit",
    maxTurns: 14,
    ownsPaths: [],
    mandate:
      "Design authority for interaction, Hologram tokens, focus, reduced motion and accessibility. " +
      "Specifies behavior; frontend implements it."
  },
  {
    id: "frontend",
    claudeName: "awkit-frontend-engineer",
    role: "React / Renderer Engineer",
    defaultMode: "writer",
    model: "inherit",
    maxTurns: 32,
    ownsPaths: [
      "app/renderer/**",
      "logos/**",
      "UI Samples/**",
      "ui-mock.html",
      "capture-dribbble.mjs",
      "get-videos.mjs"
    ],
    agentsMd: "app/renderer/AGENTS.md",
    mandate: "Renderer: React, both designers, admin screens, renderer state, Hologram styles."
  },
  {
    id: "software",
    claudeName: "awkit-software-engineer",
    role: "General Software Engineer",
    defaultMode: "writer",
    model: "inherit",
    maxTurns: 32,
    ownsPaths: [
      "src/branding/**",
      "src/logging/**",
      "src/reports/**",
      "src/roadmap/**",
      "src/semantic/**",
      "src/theme/**",
      "src/utils/**",
      "src/validation/**"
    ],
    agentsMd: "src/AGENTS.md",
    mandate:
      "Implements scoped TypeScript product work that does not belong to a narrower owner; never " +
      "displaces a renderer, runtime, recorder, persistence, security or release specialist."
  },
  {
    id: "runtime",
    claudeName: "awkit-backend-engineer",
    role: "Electron Main / Runner Engineer",
    defaultMode: "writer",
    model: "inherit",
    maxTurns: 32,
    ownsPaths: [
      "app/main/**",
      "src/runner/**",
      "src/orchestrator/**",
      "src/instances/**",
      "src/oracle/**",
      "oracle-jdbc-bridge/**",
      "native-hosts/**",
      "scripts/oracle/**",
      "scripts/prepare-oracle-runtime.mjs",
      "scripts/prepare-zvec-native-host.mjs",
      "scripts/zvec-harness/**",
      "scripts/zvec-spike/**"
    ],
    agentsMd: "app/main/AGENTS.md",
    mandate:
      "Electron main, preload, IPC implementation, runner, execution orchestration, instance state " +
      "and Windows runtime behavior while preserving offline operation."
  },
  {
    id: "integration",
    claudeName: "awkit-integration-specialist",
    role: "Cross-Boundary Integration Specialist",
    defaultMode: "read-only",
    model: "inherit",
    maxTurns: 18,
    ownsPaths: [],
    mandate:
      "Reviews renderer-preload-main, Electron-Playwright, Flow-Workflow-Runner, session, settings, " +
      "reporting, licensing and packaged-runtime contracts end to end."
  },
  {
    id: "recorder",
    claudeName: "awkit-recorder-playwright",
    role: "Recorder / Playwright Specialist",
    defaultMode: "writer",
    model: "inherit",
    maxTurns: 32,
    ownsPaths: ["src/recorder/**", "src/session/**"],
    agentsMd: "src/AGENTS.md",
    mandate:
      "Playwright and Chromium recorder semantics, resilient locators, popups, frames, waits, " +
      "downloads, uploads, browser contexts, session reuse and Feature Test Lab evidence."
  },
  {
    id: "qa",
    claudeName: "awkit-qa-engineer",
    role: "Quality Assurance Engineer",
    defaultMode: "writer",
    model: "inherit",
    maxTurns: 28,
    ownsPaths: [
      "tests/**",
      "mock-site/**",
      "scripts/verify-*",
      "scripts/validate-*",
      "scripts/benchmark-*",
      "scripts/benchmark/**",
      "scripts/helpers/**",
      "scripts/measure-*",
      "scripts/random-test-lab.mts",
      "scripts/seed-*",
      "scripts/capture-*",
      "scripts/write-test-root-manifest.mjs",
      "playwright.config.ts",
      "specs/e2e/**",
      "scripts/lib/e2e-qa-lib.mjs",
      "scripts/lib/gui-verify-harness.mjs",
      "scripts/lib/latency-histogram.mts",
      "scripts/lib/legacy-gui-verifier-coverage.mjs",
      "scripts/lib/loop-capsule-visual-oracle.mjs",
      "scripts/lib/rss-trend.mts",
      "scripts/lib/selfSignedCertificate.mts",
      "scripts/lib/test-lab-packaging-policy.ts",
      "scripts/lib/verify-flow-loop-capsule-gui.mjs",
      "scripts/lib/verify-workflow-loop-capsule-gui.mjs",
      "src/testing/**"
    ],
    agentsMd: "tests/AGENTS.md",
    mandate:
      "Owns red-to-green proof, regression and negative cases, mock-site scenarios, runtime and GUI " +
      "evidence, accessibility, concurrency and compatibility verification; never weakens assertions."
  },
  {
    id: "qc",
    claudeName: "awkit-qc-reviewer",
    role: "Independent Quality Control Reviewer",
    defaultMode: "read-only",
    model: "inherit",
    maxTurns: 18,
    ownsPaths: [],
    mandate:
      "Independently reviews requested behavior, architecture, security, offline and data rules, " +
      "test credibility, code quality and documentation; never self-approves implementation."
  },
  {
    id: "security",
    claudeName: "awkit-security-engineer",
    role: "Security & Trust-Boundary Engineer",
    defaultMode: "writer",
    model: "inherit",
    maxTurns: 24,
    ownsPaths: [
      "src/licensing/**",
      "src/auth/**",
      "src/secrets/**",
      "src/security/**",
      "tools/license-issuer/**",
      ".env.example"
    ],
    mandate:
      "Owns tightly scoped licensing, authorization, secret and trust-boundary modules and reviews " +
      "protected-login handoff, Electron/session security, logging redaction and signing risk."
  },
  {
    id: "researcher",
    claudeName: "awkit-researcher",
    role: "Codebase Researcher",
    defaultMode: "read-only",
    model: "haiku",
    maxTurns: 12,
    ownsPaths: [],
    mandate:
      "Uses Graphify, codebase memory, narrow source confirmation, documentation and Git history to " +
      "return concise evidence for unfamiliar areas without dumping files into the manager context."
  },
  {
    id: "persistence",
    claudeName: "awkit-data-persistence",
    role: "Data & Persistence Specialist",
    defaultMode: "writer",
    model: "inherit",
    maxTurns: 28,
    ownsPaths: ["src/storage/**", "src/profiles/**", "src/data/**", "src/project/**"],
    agentsMd: "src/AGENTS.md",
    mandate:
      "Owns persisted JSON, LOCALAPPDATA storage, migrations, atomic writes, corruption recovery, " +
      "unknown-field preservation, import/export and old-data compatibility."
  },
  {
    id: "performance",
    claudeName: "awkit-performance-engineer",
    role: "Performance / Concurrency Specialist",
    defaultMode: "read-only",
    model: "inherit",
    maxTurns: 18,
    ownsPaths: [],
    mandate:
      "Analyzes workload concurrency, scheduling, backpressure, memory pressure, cancellation and " +
      "large-workflow regressions without hardcoding host CPU or RAM assumptions."
  },
  {
    id: "release",
    claudeName: "awkit-build-release",
    role: "Packaging / Offline / Release Engineer",
    defaultMode: "writer",
    model: "inherit",
    maxTurns: 28,
    ownsPaths: [
      "build/**",
      "resources/**",
      "src/offline/**",
      "package.json",
      "package-lock.json",
      "electron-builder*",
      ".github/workflows/**",
      ".gitattributes",
      ".gitignore",
      ".npmrc",
      "electron.vite*.ts",
      "vite.config.ts",
      "tsconfig.json",
      "tsconfig.scripts.json",
      "scripts/build-*",
      "scripts/build.ps1",
      "scripts/clean-machine/**",
      "scripts/compare-offline-payloads.mjs",
      "scripts/dev.mjs",
      "scripts/dev.ps1",
      "scripts/generate-app-icon.mjs",
      "scripts/generate-dependency-manifest.ps1",
      "scripts/lib/clean-machine-validation-policy.ts",
      "scripts/lib/nsis-per-user-install.ps1",
      "scripts/lib/offline-browser-integrity.ps1",
      "scripts/lib/release-key-custody.*",
      "scripts/offline-manifest-signature.mjs",
      "scripts/package-*",
      "scripts/prepare-offline-deps.ps1",
      "scripts/release-*",
      "scripts/stage-offline-assets-from.ps1",
      "scripts/write-artifact-provenance.mjs"
    ],
    mandate:
      "Owns build, packaging, bundled Chromium, offline validation, dependency manifests, signing " +
      "procedure, source hygiene, NSIS/portable artifacts and packaged-runtime evidence."
  },
  {
    id: "project-state",
    claudeName: "awkit-project-state",
    role: "Documentation / Project-State Specialist",
    defaultMode: "writer",
    model: "inherit",
    maxTurns: 24,
    ownsPaths: [
      "docs/**",
      "README.md",
      "IMPLEMENTATION_STATUS.md",
      "CLEAN_MACHINE_VALIDATION_RUNBOOK.md",
      "SESSION_OUTCOMES_CLOSEOUT.md",
      "BROWSER_AUTOMATION_SKILLS_REPORT.md",
      "00_TEMPLATE_REVIEW_FINDINGS.md",
      "change_requests/**",
      "plans/**",
      "playwright_flow_studio_updated_phases/**",
      ".beads/**",
      "tools/roadmap/**",
      "scripts/lib/verifier-classification.ts",
      "scripts/ai-memory/**",
      "scripts/generate-embedded-roadmap-snapshot.mjs",
      "setup-ai-memory.mjs"
    ],
    agentsMd: "docs/AGENTS.md",
    mandate:
      "Reconciles CURRENT_STATE, HANDOFF, TASK_LOG, KNOWN_ISSUES, DEFECTS, Beads, validation ledger, " +
      "assignments, verifier registry and roadmap sources without editing derived status to fake progress."
  }
]);

/** @type {ReadonlyMap<string, AgentEntry>} */
const AGENTS_BY_ID = new Map(AGENTS.map((a) => [a.id, a]));

/**
 * @param {string} id
 * @returns {AgentEntry}
 */
export function agent(id) {
  const found = AGENTS_BY_ID.get(id);
  if (!found) {
    throw new Error(`Unknown agent id "${id}". Known ids: ${AGENTS.map((a) => a.id).join(", ")}`);
  }
  return found;
}

export const AGENT_IDS = Object.freeze(AGENTS.map((a) => a.id));

/**
 * Which existing skills each role should reach for.
 *
 * AWKIT already had a focused skill library under `.claude/skills/` before this routing system
 * existed, and
 * several of them cover exactly what a role does — `test-and-verify` IS most of QA's job, `pr-review`
 * IS most of QC's. Generating eleven role definitions beside twelve skills without saying how they
 * relate would leave overlapping accounts of the same work, which is the drift this whole system is
 * built to prevent.
 *
 * So roles REFERENCE skills; they never restate them. `verify:agent-routing` asserts that every
 * installed skill is claimed by at least one role, so a new skill cannot sit unowned and a deleted
 * one cannot linger here.
 *
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const ROLE_SKILLS = Object.freeze({
  manager: ["ai-memory-maintainer", "docs-sync", "git-full-cycle"],
  architect: ["codebase-review", "graphify"],
  uiux: ["frontend-ui-ux-master"],
  frontend: ["frontend-ui-ux-master", "feature-implementation", "bug-fix", "refactor-safe"],
  software: ["feature-implementation", "bug-fix", "refactor-safe"],
  runtime: ["feature-implementation", "bug-fix", "refactor-safe"],
  integration: ["codebase-review", "graphify"],
  recorder: ["mock-site-maintainer", "bug-fix"],
  qa: ["test-and-verify", "mock-site-maintainer"],
  qc: ["pr-review", "codebase-review"],
  security: ["pr-review", "codebase-review"],
  researcher: ["graphify", "codebase-review"],
  persistence: ["refactor-safe", "bug-fix"],
  performance: ["codebase-review", "test-and-verify"],
  release: ["test-and-verify"],
  "project-state": ["ai-memory-maintainer", "docs-sync", "git-full-cycle"]
});

/** Codebase-memory 0.9.0 tools that cannot mutate, index or delete graph state. */
export const CODEBASE_MEMORY_READ_TOOLS = Object.freeze([
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
]);

/**
 * Exact Graphify read permission rules for `.claude/settings.json`.
 *
 * These are command permissions, not Claude subagent tool names. Generated `tools:` frontmatter
 * must expose the real `Bash` tool; the project permission layer narrows which command prefixes do
 * not require a prompt, and the PreToolUse lease guard makes the final actor/scope decision.
 */
export const GRAPHIFY_READ_TOOLS = Object.freeze([
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
]);

export const GIT_READ_TOOLS = Object.freeze([
  "Bash(git status:*)",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(git show:*)",
  "Bash(git rev-parse:*)",
  "Bash(git ls-files:*)"
]);

export const VERIFICATION_TOOLS = Object.freeze([
  "Bash(npm run build)",
  "Bash(npm run typecheck)",
  "Bash(npm run typecheck:scripts)",
  "Bash(npm run verify:*)",
  "Bash(npm run validate:*)",
  "Bash(npm run benchmark:*)"
]);

export const BEADS_READ_TOOLS = Object.freeze([
  "Bash(bd show:*)",
  "Bash(bd list:*)",
  "Bash(bd stats:*)",
  "Bash(bd ready:*)",
  "Bash(bd blocked:*)"
]);

export const BEADS_WRITE_TOOLS = Object.freeze([
  "Bash(bd create:*)",
  "Bash(bd update:*)",
  "Bash(bd close:*)",
  "Bash(bd export:*)",
  "Bash(bd dep add:*)"
]);

export const WRITER_SHELL_TOOLS = Object.freeze([
  ...VERIFICATION_TOOLS,
  "Bash(node --check:*)",
  "Bash(graphify update .)"
]);

export const RELEASE_SHELL_TOOLS = Object.freeze(["Bash(npm run package:*)"]);

export const PROJECT_STATE_SHELL_TOOLS = Object.freeze([
  ...BEADS_WRITE_TOOLS,
  "Bash(npm run ai:memory)",
  "Bash(npm run ai:memory:check)",
  "Bash(npm run verify:roadmap-dashboard)",
  "Bash(node tools/agents/render-docs.mjs --write)"
]);

export const MANAGER_SHELL_TOOLS = Object.freeze([
  "Bash(npm run agent:lease)",
  "Bash(npm run agent:lease-grant:*)",
  "Bash(npm run agent:lease-amend:*)",
  "Bash(npm run agent:lease-release:*)",
  "Bash(node tools/agents/render-platform-agents.mjs --write)",
  "Bash(npm run agent:check-agents)",
  "Bash(node tools/agents/task-gate.mjs:*)",
  "Bash(git add --:*)",
  "Bash(git commit -m:*)",
  "Bash(git fetch origin)",
  "Bash(git push origin main)"
]);

/** The exact project permission allowlist, after the ten read-only MCP tools. */
export const CLAUDE_BASH_PERMISSION_RULES = Object.freeze([
  ...GRAPHIFY_READ_TOOLS,
  ...GIT_READ_TOOLS,
  ...BEADS_READ_TOOLS,
  "Bash(claude --version)",
  "Bash(claude --help)",
  "Bash(claude mcp list)",
  "Bash(npm run agent:lease)",
  "Bash(node tools/agents/task-gate.mjs:*)",
  ...WRITER_SHELL_TOOLS,
  ...RELEASE_SHELL_TOOLS,
  ...PROJECT_STATE_SHELL_TOOLS,
  ...MANAGER_SHELL_TOOLS.filter((rule) => ![
    "Bash(npm run agent:lease)",
    "Bash(node tools/agents/task-gate.mjs:*)"
  ].includes(rule))
]);

export const CODEBASE_MEMORY_MUTATING_TOOLS = Object.freeze([
  "mcp__codebase-memory-mcp__index_repository",
  "mcp__codebase-memory-mcp__delete_project",
  "mcp__codebase-memory-mcp__manage_adr",
  "mcp__codebase-memory-mcp__ingest_traces"
]);

/**
 * Tool grants for a generated platform agent definition, derived from mode and mandate.
 *
 * Discovery grants enumerate read-only MCP operations because its wildcard also exposes mutators.
 * `Bash` is a real tool name; exact Graphify/Git/build command rules live in project settings and
 * are still checked by the role-aware PreToolUse lease guard. Skills are lazy exact grants, so their
 * contents do not inflate every specialist's start context. Shell permission is never ownership.
 *
 * @param {string} agentId
 * @returns {string}
 */
export function toolsFor(agentId) {
  const role = agent(agentId);
  const skills = (ROLE_SKILLS[agentId] ?? []).map((skill) => `Skill(${skill})`);
  const discovery = [...CODEBASE_MEMORY_READ_TOOLS, ...skills];

  if (role.defaultMode === "read-only") {
    return ["Read", "Glob", "Grep", "Bash", ...discovery].join(", ");
  }

  const writer = [
    "Read",
    "Edit",
    "Write",
    "Glob",
    "Grep",
    "Bash",
    ...CODEBASE_MEMORY_READ_TOOLS,
    ...skills
  ];

  if (agentId === "manager") {
    const specialists = AGENTS.filter((entry) => entry.id !== "manager")
      .map((entry) => entry.claudeName)
      .join(", ");
    writer.push(`Agent(${specialists})`);
  }

  return writer.join(", ");
}

export const DESTRUCTIVE_GIT_DENIES = Object.freeze([
  "Bash(git reset:*)",
  "Bash(git clean:*)",
  "Bash(git stash:*)",
  "Bash(git worktree:*)",
  "Bash(git branch:*)",
  "Bash(git switch:*)",
  "Bash(git checkout:*)",
  "Bash(git merge:*)",
  "Bash(git rebase:*)",
  "Bash(git restore:*)",
  "Bash(git rm:*)",
  "Bash(git cherry-pick:*)",
  "Bash(git push --force:*)",
  "Bash(git push -f:*)"
]);

export const GRAPHIFY_MUTATION_DENIES = Object.freeze([
  "Bash(graphify add:*)",
  "Bash(graphify watch:*)",
  "Bash(graphify cluster-only:*)",
  "Bash(graphify label:*)",
  "Bash(graphify extract:*)",
  "Bash(graphify save-result:*)",
  "Bash(graphify tree:*)",
  "Bash(graphify hook install:*)",
  "Bash(graphify hook uninstall:*)",
  "Bash(graphify platform install:*)",
  "Bash(graphify platform uninstall:*)",
  "Bash(graphify global add:*)",
  "Bash(graphify global remove:*)",
  "Bash(graphify clone:*)",
  "Bash(graphify merge:*)"
]);

export const CLAUDE_PERMISSION_DENIES = Object.freeze([
  ...CODEBASE_MEMORY_MUTATING_TOOLS,
  ...DESTRUCTIVE_GIT_DENIES,
  ...GRAPHIFY_MUTATION_DENIES,
  "Bash(node -e:*)",
  "Bash(node --eval:*)",
  "Bash(npm exec:*)",
  "PowerShell(Remove-Item:*)",
  "PowerShell(Move-Item:*)",
  "PowerShell(Set-Content:*)",
  "PowerShell(Out-File:*)",
  "PowerShell(Start-Process:*)"
]);

/**
 * Generated subagent `disallowedTools` accepts tool names, not command permission patterns. Shell
 * families are denied in `.claude/settings.json` and the PreToolUse guard; placing
 * `Bash(git reset:*)` here makes Claude remove the entire Bash tool at runtime.
 */
export function disallowedToolsFor(agentId) {
  const denied = ["NotebookEdit"];
  if (agent(agentId).defaultMode === "read-only") denied.unshift("Edit", "Write", "Agent");
  else if (agentId !== "manager") denied.unshift("Agent");
  return denied.join(", ");
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Classification flags
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Every boolean a task contract may declare. Routing reads only these — never free-form prose, and
 * never an opinion formed after implementation started.
 * @type {readonly string[]}
 */
export const CLASSIFICATION_FLAGS = Object.freeze([
  "renderer_visual_change",
  "interaction_change",
  "accessibility_change",
  "general_engineering_change",
  "electron_main_change",
  "ipc_change",
  "runner_change",
  "execution_change",
  "concurrency_change",
  "performance_change",
  "persisted_shape_change",
  "migration_required",
  "filesystem_write_change",
  "playwright_change",
  "recorder_change",
  "browser_behavior_change",
  "mock_site_required",
  "licensing_change",
  "auth_change",
  "authorization_change",
  "secret_handling_change",
  "protected_login_change",
  "signing_change",
  "packaging_change",
  "offline_boundary_change",
  "new_dependency",
  "public_contract_change",
  "broad_investigation",
  "project_state_change",
  "agent_infrastructure_change"
]);

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Path map — the basis for BOTH lease scoping and derived classification
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * @typedef {Object} PathDomain
 * @property {string} glob
 * @property {string} owner              agent id that owns a lease over this path
 * @property {string[]} impliesFlags     flags that touching this path SOUNDLY implies
 * @property {string} note
 */

/**
 * Maps a repository path to its owning agent and to the classification flags that touching it
 * *soundly* implies.
 *
 * The soundness bar matters. Editing `app/renderer/**` proves the renderer changed; it does NOT
 * prove the change was visual rather than a comment, so `renderer_visual_change` is NOT implied
 * here. Only flags that are true whenever the path is touched appear in `impliesFlags`. Anything
 * weaker would make the derived-vs-declared comparison produce false scope-escape reports, and a
 * check that cries wolf gets switched off.
 *
 * Ordering is significant: the FIRST matching entry wins, so narrower paths precede broader ones.
 *
 * @type {readonly PathDomain[]}
 */
export const PATH_DOMAINS = Object.freeze([
  // ── Narrow, high-signal paths first ────────────────────────────────────────────────────────────
  {
    glob: "app/main/ipc/**",
    owner: "runtime",
    impliesFlags: ["electron_main_change", "ipc_change"],
    note: "Every renderer-visible channel lives here; touching it is by definition an IPC change."
  },
  {
    glob: "app/main/preload.ts",
    owner: "runtime",
    impliesFlags: ["ipc_change", "public_contract_change"],
    note: "The window.playwrightFlowStudio surface — an internal contract other layers compile against."
  },
  {
    glob: "src/licensing/**",
    owner: "security",
    impliesFlags: ["licensing_change"],
    note: "Licensing is automatically Risk 3."
  },
  {
    glob: "src/auth/**",
    owner: "security",
    impliesFlags: ["auth_change"],
    note: "Authentication."
  },
  {
    glob: "src/secrets/**",
    owner: "security",
    impliesFlags: ["secret_handling_change"],
    note: "Secret storage and redaction."
  },
  {
    glob: "src/security/**",
    owner: "security",
    impliesFlags: ["authorization_change"],
    note: "Permissions registry and trust boundaries."
  },
  {
    glob: "src/session/**",
    owner: "recorder",
    impliesFlags: ["browser_behavior_change"],
    note: "Session capture and reuse; protected-login handoff lands here."
  },
  {
    glob: "src/recorder/**",
    owner: "recorder",
    impliesFlags: ["recorder_change"],
    note: "Recorder capture and locator synthesis."
  },
  {
    glob: "src/runner/**",
    owner: "runtime",
    impliesFlags: ["runner_change", "execution_change"],
    note: "Playwright execution path."
  },
  {
    glob: "src/orchestrator/**",
    owner: "runtime",
    impliesFlags: ["execution_change"],
    note: "Not `src/orchestration` — that directory does not exist."
  },
  {
    glob: "src/instances/**",
    owner: "runtime",
    impliesFlags: ["execution_change"],
    note: "Live instance model behind the Instance Monitor."
  },
  {
    glob: "src/storage/**",
    owner: "persistence",
    impliesFlags: ["filesystem_write_change"],
    note: "Atomic writes and the profile stores."
  },
  {
    glob: "src/profiles/**",
    owner: "persistence",
    impliesFlags: ["filesystem_write_change"],
    note: "JSON profile shapes; unknown-field preservation lives or dies here."
  },
  {
    glob: "src/data/**",
    owner: "persistence",
    impliesFlags: ["filesystem_write_change"],
    note: "Data sources and row-driven inputs."
  },
  {
    glob: "src/project/**",
    owner: "persistence",
    impliesFlags: ["filesystem_write_change"],
    note: "Project-level persisted state."
  },
  {
    glob: "src/oracle/**",
    owner: "runtime",
    impliesFlags: ["execution_change", "authorization_change"],
    note: "Oracle SQL policy is a duplicated read-only trust gate in the execution boundary."
  },
  {
    glob: "oracle-jdbc-bridge/**",
    owner: "runtime",
    impliesFlags: ["execution_change", "authorization_change", "offline_boundary_change"],
    note: "The shipped JDBC bridge crosses both the SQL trust boundary and the offline runtime."
  },
  {
    glob: "native-hosts/**",
    owner: "runtime",
    impliesFlags: ["execution_change", "authorization_change", "offline_boundary_change"],
    note: "Bundled native hosts execute outside Electron and are part of the shipped trust boundary."
  },
  {
    glob: "tools/license-issuer/**",
    owner: "security",
    impliesFlags: ["licensing_change", "signing_change", "secret_handling_change"],
    note: "License issuance and signing-key custody are security-owned Risk 3 surfaces."
  },
  {
    glob: ".env.example",
    owner: "security",
    impliesFlags: ["secret_handling_change", "authorization_change"],
    note: "The public secret-key inventory is a trust-boundary contract even though values are placeholders."
  },
  {
    glob: "src/testing/**",
    owner: "qa",
    impliesFlags: [],
    note: "Test-only helpers that ship in src for reuse by verifiers."
  },

  // ── General product modules without a narrower specialist ───────────────────────────────────
  ...[
    "branding",
    "logging",
    "reports",
    "roadmap",
    "semantic",
    "theme",
    "utils",
    "validation"
  ].map((name) => ({
    glob: `src/${name}/**`,
    owner: "software",
    impliesFlags: ["general_engineering_change"],
    note: "General product module; use a narrower specialist when the task crosses its boundary."
  })),

  // ── Broad ownership ───────────────────────────────────────────────────────────────────────────
  {
    glob: "app/renderer/**",
    owner: "frontend",
    impliesFlags: [],
    note: "Renderer. Visual/interaction/accessibility intent is not path-determinable — declare it."
  },
  ...["logos/**", "UI Samples/**", "ui-mock.html", "capture-dribbble.mjs", "get-videos.mjs"].map((glob) => ({
    glob,
    owner: "frontend",
    impliesFlags: ["renderer_visual_change"],
    note: "Renderer reference imagery and visual evidence tooling."
  })),
  {
    glob: "app/main/**",
    owner: "runtime",
    impliesFlags: ["electron_main_change"],
    note: "Electron main process."
  },
  {
    glob: "tests/**",
    owner: "qa",
    impliesFlags: [],
    note: "Test suites."
  },
  {
    glob: "mock-site/**",
    owner: "qa",
    impliesFlags: ["mock_site_required"],
    note: "The Feature Test Lab."
  },
  {
    glob: "scripts/verify-*",
    owner: "qa",
    impliesFlags: [],
    note: "Verifiers. A new one must be registered in scripts/lib/verifier-classification.ts."
  },
  {
    glob: "scripts/validate-*",
    owner: "qa",
    impliesFlags: [],
    note: "Validators, same registration rule."
  },
  {
    glob: "scripts/benchmark-*",
    owner: "qa",
    impliesFlags: ["performance_change"],
    note: "Performance evidence stays independent from the implementation it measures."
  },
  ...[
    "scripts/benchmark/**",
    "scripts/helpers/**",
    "scripts/measure-*",
    "scripts/random-test-lab.mts",
    "scripts/seed-*",
    "scripts/capture-*",
    "scripts/write-test-root-manifest.mjs"
  ].map((glob) => ({
    glob,
    owner: "qa",
    impliesFlags: [],
    note: "Focused test, measurement or fixture infrastructure owned independently by QA."
  })),
  ...[
    "playwright.config.ts",
    "specs/e2e/**",
    "scripts/lib/e2e-qa-lib.mjs",
    "scripts/lib/gui-verify-harness.mjs",
    "scripts/lib/legacy-gui-verifier-coverage.mjs",
    "scripts/lib/loop-capsule-visual-oracle.mjs",
    "scripts/lib/selfSignedCertificate.mts",
    "scripts/lib/test-lab-packaging-policy.ts",
    "scripts/lib/verify-flow-loop-capsule-gui.mjs",
    "scripts/lib/verify-workflow-loop-capsule-gui.mjs"
  ].map((glob) => ({
    glob,
    owner: "qa",
    impliesFlags: [],
    note: "End-to-end and rendered-GUI verification infrastructure."
  })),
  ...["scripts/lib/latency-histogram.mts", "scripts/lib/rss-trend.mts"].map((glob) => ({
    glob,
    owner: "qa",
    impliesFlags: ["performance_change"],
    note: "Performance measurement evidence stays independent from product implementation."
  })),

  // ── Runtime preparation and native-boundary tooling ──────────────────────────────────────────
  ...[
    "scripts/oracle/**",
    "scripts/prepare-oracle-runtime.mjs",
    "scripts/prepare-zvec-native-host.mjs",
    "scripts/zvec-harness/**",
    "scripts/zvec-spike/**"
  ].map((glob) => ({
    glob,
    owner: "runtime",
    impliesFlags: ["execution_change", "authorization_change", "offline_boundary_change"],
    note: "Runtime preparation and native bridge tooling crosses the shipped execution boundary."
  })),

  // ── Packaging and the offline boundary ────────────────────────────────────────────────────────
  {
    glob: "build/**",
    owner: "release",
    impliesFlags: ["packaging_change"],
    note: "Packaging inputs."
  },
  {
    glob: "resources/**",
    owner: "release",
    impliesFlags: ["packaging_change", "offline_boundary_change"],
    note: "Shipped resources. Never a runtime write target."
  },
  {
    glob: "src/offline/**",
    owner: "release",
    impliesFlags: ["offline_boundary_change"],
    note: "Offline-boundary verification and shipped-runtime guarantees."
  },
  {
    glob: "package.json",
    owner: "release",
    impliesFlags: ["packaging_change"],
    note: "Script inventory and dependencies. A dependency edit is also new_dependency."
  },
  {
    glob: "package-lock.json",
    owner: "release",
    impliesFlags: ["packaging_change", "new_dependency"],
    note: "The lockfile only moves when the dependency graph moves."
  },
  {
    glob: "electron-builder*",
    owner: "release",
    impliesFlags: ["packaging_change"],
    note: "Installer and portable build configuration."
  },
  ...[
    ".github/workflows/**",
    ".gitattributes",
    ".gitignore",
    ".npmrc",
    "electron.vite*.ts",
    "vite.config.ts",
    "tsconfig.json",
    "tsconfig.scripts.json",
    "scripts/build-*",
    "scripts/build.ps1",
    "scripts/clean-machine/**",
    "scripts/compare-offline-payloads.mjs",
    "scripts/dev.mjs",
    "scripts/dev.ps1",
    "scripts/generate-app-icon.mjs",
    "scripts/generate-dependency-manifest.ps1",
    "scripts/lib/clean-machine-validation-policy.ts",
    "scripts/lib/nsis-per-user-install.ps1",
    "scripts/lib/offline-browser-integrity.ps1",
    "scripts/lib/release-key-custody.*",
    "scripts/offline-manifest-signature.mjs",
    "scripts/package-*",
    "scripts/prepare-offline-deps.ps1",
    "scripts/release-*",
    "scripts/stage-offline-assets-from.ps1",
    "scripts/write-artifact-provenance.mjs"
  ].map((glob) => ({
    glob,
    owner: "release",
    impliesFlags: ["packaging_change", "offline_boundary_change"],
    note: "Packaging, signing and clean-machine evidence tooling belongs to the release boundary."
  })),

  // ── Governance and agent infrastructure ─────────────────────────────────────────────────────
  {
    glob: "docs/**",
    owner: "project-state",
    impliesFlags: ["project_state_change"],
    note: "AI memory and governance documents; architectural advice does not confer write ownership."
  },
  ...[
    "README.md",
    "IMPLEMENTATION_STATUS.md",
    "CLEAN_MACHINE_VALIDATION_RUNBOOK.md",
    "SESSION_OUTCOMES_CLOSEOUT.md",
    "BROWSER_AUTOMATION_SKILLS_REPORT.md",
    "00_TEMPLATE_REVIEW_FINDINGS.md",
    "change_requests/**",
    "plans/**",
    "playwright_flow_studio_updated_phases/**"
  ].map((glob) => ({
    glob,
    owner: "project-state",
    impliesFlags: ["project_state_change"],
    note: "Repository status, decision history, planning and specification sources."
  })),
  {
    glob: "tools/roadmap/**",
    owner: "project-state",
    impliesFlags: ["project_state_change"],
    note: "Derived dashboard. Never hand-edited to record progress."
  },
  {
    glob: "tools/agents/**",
    owner: "manager",
    impliesFlags: ["agent_infrastructure_change"],
    note: "This routing system itself."
  },
  {
    glob: ".beads/**",
    owner: "project-state",
    impliesFlags: ["project_state_change"],
    note:
      "Tracker database and its JSONL export. Project State reconciles the source, and the export " +
      "must be refreshed with `bd export -o .beads/issues.jsonl` before the dashboard reads it."
  },
  {
    glob: "scripts/lib/verifier-classification.ts",
    owner: "project-state",
    impliesFlags: ["project_state_change"],
    note: "Authoritative verifier registry; new verify and validate commands must be classified."
  },
  ...[
    "scripts/ai-memory/**",
    "scripts/generate-embedded-roadmap-snapshot.mjs",
    "setup-ai-memory.mjs"
  ].map((glob) => ({
    glob,
    owner: "project-state",
    impliesFlags: ["project_state_change"],
    note: "Project memory and derived status synchronization tooling."
  })),
  {
    glob: ".claude/**",
    owner: "manager",
    impliesFlags: ["agent_infrastructure_change"],
    note: "Claude Code agent/skill/hook configuration. Generated role definitions live here."
  },
  ...[".cbmignore", ".graphifyignore", "scripts/AGENTS.md", "src/AGENTS.md"].map((glob) => ({
    glob,
    owner: "manager",
    impliesFlags: ["agent_infrastructure_change"],
    note: "Cross-agent discovery and local instruction boundaries."
  })),
  {
    glob: ".mcp.json",
    owner: "manager",
    impliesFlags: ["agent_infrastructure_change"],
    note: "Project-scoped MCP server registration for development agents. Never read by the app."
  },
  {
    glob: ".codex/**",
    owner: "manager",
    impliesFlags: ["agent_infrastructure_change"],
    note: "Codex configuration and skills."
  },
  {
    glob: ".gemini/**",
    owner: "manager",
    impliesFlags: ["agent_infrastructure_change"],
    note: "Gemini / Antigravity configuration and skills."
  },
  {
    glob: ".agents/**",
    owner: "manager",
    impliesFlags: ["agent_infrastructure_change"],
    note: "Cross-platform agent rules and skills."
  },
  {
    glob: ".cursor/**",
    owner: "manager",
    impliesFlags: ["agent_infrastructure_change"],
    note: "Cursor-compatible agent configuration."
  },
  ...["AGENTS.md", "CLAUDE.md", "GEMINI.md"].map((glob) => ({
    glob,
    owner: "manager",
    impliesFlags: ["agent_infrastructure_change"],
    note: "Root cross-agent instruction surface."
  }))
]);

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Glob matching
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Segment-wise glob matcher supporting `**` (zero or more segments), `*` (within one segment) and
 * literals. Deliberately small — a dependency-free matcher whose whole behavior is visible here and
 * mutation-tested by `verify:agent-routing`.
 *
 * A regex-substitution matcher was rejected: getting `**` and `*` to compose correctly through
 * string replacement is exactly the kind of over-restrictive pattern that silently fails to match
 * the offending path, which would let a scope escape pass as "no domain touched".
 *
 * @param {string} glob   POSIX-style pattern, e.g. "app/renderer/**" or "scripts/verify-*"
 * @param {string} path   POSIX-style repo-relative path
 * @returns {boolean}
 */
export function matchGlob(glob, path) {
  const g = glob.split("/");
  const p = path.split("/");

  /**
   * @param {number} gi
   * @param {number} pi
   * @returns {boolean}
   */
  const walk = (gi, pi) => {
    if (gi === g.length) return pi === p.length;

    if (g[gi] === "**") {
      // `**` at the end matches every remaining segment, including none.
      for (let skip = pi; skip <= p.length; skip += 1) {
        if (walk(gi + 1, skip)) return true;
      }
      return false;
    }

    if (pi === p.length) return false;
    if (!matchSegment(g[gi], p[pi])) return false;
    return walk(gi + 1, pi + 1);
  };

  return walk(0, 0);
}

/**
 * Match one path segment against one glob segment, where `*` matches any run of characters that
 * contains no separator.
 *
 * @param {string} pattern
 * @param {string} segment
 * @returns {boolean}
 */
function matchSegment(pattern, segment) {
  if (!pattern.includes("*")) return pattern === segment;

  const parts = pattern.split("*");
  let cursor = 0;

  // Leading literal must sit at the start.
  if (parts[0] !== "") {
    if (!segment.startsWith(parts[0])) return false;
    cursor = parts[0].length;
  }

  // Trailing literal must sit at the end, and must not overlap what we already consumed.
  const last = parts[parts.length - 1];
  let end = segment.length;
  if (last !== "") {
    if (!segment.endsWith(last)) return false;
    end = segment.length - last.length;
    if (end < cursor) return false;
  }

  // Interior literals appear in order between cursor and end.
  for (const middle of parts.slice(1, -1)) {
    if (middle === "") continue;
    const at = segment.indexOf(middle, cursor);
    if (at === -1 || at + middle.length > end) return false;
    cursor = at + middle.length;
  }

  return true;
}

/**
 * Resolve a repository path to its owning domain entry.
 *
 * Returns `null` for an unmapped path. That is a real answer, not a shrug: an unmapped path has no
 * declared owner, so `derive-classification` reports it and the contract validator refuses to treat
 * it as covered. Silently defaulting an unknown path to "allowed" is how a governance check ends up
 * failing open.
 *
 * @param {string} path
 * @returns {PathDomain|null}
 */
export function domainForPath(path) {
  const normalized = path.replace(/\\/g, "/");
  for (const entry of PATH_DOMAINS) {
    if (matchGlob(entry.glob, normalized)) return entry;
  }
  return null;
}

/**
 * True when `path` falls inside any of `globs`.
 * @param {string} path
 * @param {readonly string[]} globs
 * @returns {boolean}
 */
export function pathInScope(path, globs) {
  const normalized = path.replace(/\\/g, "/");
  return globs.some((glob) => matchGlob(glob, normalized));
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Activation rules
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * @typedef {Object} ActivationRule
 * @property {string} agent
 * @property {string[]} anyFlag        activate when ANY of these classification flags is true
 * @property {number} [minCrossLayer]  activate when cross_layer_count reaches this
 * @property {number} [minRisk]        activate when risk_level reaches this
 * @property {boolean} [onOwnedPath]   activate when the diff touches a path this agent owns
 * @property {string} why
 */

/**
 * The single encoding of "which specialists does this task need".
 *
 * The reviewed proposal stated this three times — as pseudocode, as a markdown matrix, and as a
 * validator rejection list — and the three already disagreed about when the Architect was
 * mandatory. There is one encoding now. The matrix document and the validator both read THIS.
 *
 * @type {readonly ActivationRule[]}
 */
export const ACTIVATION_RULES = Object.freeze([
  {
    agent: "uiux",
    anyFlag: ["renderer_visual_change", "interaction_change", "accessibility_change"],
    why: "Design, focus, motion and accessibility decisions are not the implementer's to make alone."
  },
  {
    agent: "frontend",
    anyFlag: ["renderer_visual_change", "interaction_change", "accessibility_change"],
    onOwnedPath: true,
    why: "Owns app/renderer/**."
  },
  {
    agent: "software",
    anyFlag: ["general_engineering_change"],
    onOwnedPath: true,
    why: "Handles scoped product modules that have no narrower implementation owner."
  },
  {
    agent: "runtime",
    anyFlag: [
      "electron_main_change",
      "ipc_change",
      "runner_change",
      "execution_change",
      "concurrency_change"
    ],
    onOwnedPath: true,
    why: "Owns the main process and the execution path."
  },
  {
    agent: "integration",
    anyFlag: ["ipc_change", "public_contract_change"],
    why: "Reviews contracts that cross renderer, preload, main, browser and runtime boundaries."
  },
  {
    agent: "recorder",
    anyFlag: ["playwright_change", "recorder_change", "browser_behavior_change", "mock_site_required"],
    onOwnedPath: true,
    why: "Real browser and recorder behavior requires Playwright-specific evidence."
  },
  {
    agent: "security",
    anyFlag: [
      "licensing_change",
      "auth_change",
      "authorization_change",
      "secret_handling_change",
      "protected_login_change",
      "signing_change"
    ],
    onOwnedPath: true,
    why: "Trust boundaries are reviewed, never assumed."
  },
  {
    agent: "researcher",
    anyFlag: ["broad_investigation"],
    why: "Unfamiliar problems begin with one concise, reusable discovery report."
  },
  {
    agent: "persistence",
    anyFlag: ["persisted_shape_change", "migration_required", "filesystem_write_change"],
    onOwnedPath: true,
    why: "A persisted shape that changes without this agent is how unknown fields get dropped."
  },
  {
    agent: "performance",
    anyFlag: ["performance_change", "concurrency_change"],
    why: "Performance and concurrency claims need workload, pressure and backpressure analysis."
  },
  {
    agent: "release",
    anyFlag: ["packaging_change", "offline_boundary_change", "signing_change", "new_dependency"],
    onOwnedPath: true,
    why: "Offline-first is a release property; a dependency is a packaging decision."
  },
  {
    agent: "project-state",
    anyFlag: ["project_state_change"],
    onOwnedPath: true,
    why: "Repository status is reconciled in authoritative sources, never in derived dashboard output."
  },
  {
    agent: "architect",
    anyFlag: [
      "public_contract_change",
      "migration_required",
      "new_dependency",
      "concurrency_change",
      "licensing_change"
    ],
    minCrossLayer: 3,
    why: "Cross-layer contracts and schema evolution need a designer, not three local decisions."
  },
  {
    agent: "qa",
    anyFlag: [],
    minRisk: 1,
    onOwnedPath: true,
    why: "Anything above documentation must state how it is proven."
  },
  {
    agent: "qc",
    anyFlag: [
      "licensing_change",
      "auth_change",
      "authorization_change",
      "secret_handling_change",
      "signing_change",
      "migration_required",
      "concurrency_change",
      "packaging_change"
    ],
    minRisk: 2,
    minCrossLayer: 2,
    why: "Independent review of whether the evidence proves the requested result."
  }
]);

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Shared write paths
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * @typedef {Object} SharedWritePath
 * @property {string} glob
 * @property {string} owner          the agent answerable for this file's guarded content
 * @property {string[]} sharedFields top-level keys ANY lease holder may change
 * @property {string} sharedFor      what the shared access is for, in plain words
 * @property {string} note
 */

/**
 * Files whose OWNERSHIP is real but whose risk lives in specific keys rather than the whole file.
 *
 * `package.json` is the case that forced this. It is release-owned because it carries the
 * dependency graph — a genuine packaging and trust surface — but it also carries the npm script
 * inventory, and adding a one-line `verify:*` script had to go through a full lease handoff to the
 * Release specialist. Measured on a real task, that was pure ceremony: the change could not
 * possibly affect packaging, and the checkpoint bought nothing.
 *
 * The path map is file-granular and the `PreToolUse` guard runs BEFORE an edit, so neither can see
 * which key is about to change. Rather than pretend otherwise, the two halves are split:
 *
 *   - the edit-time gate is RELAXED for these paths, because it cannot judge content;
 *   - a derived, content-aware check enforces the rest afterwards by comparing the committed file
 *     against the working tree.
 *
 * Capture permissively, validate strictly. The strict half is `deriveGuardedFieldChanges()`.
 *
 * `sharedFields` is an ALLOW-list, so the default is guarded: a top-level key nobody has thought
 * about yet — a new `build` block, a `workspaces` entry — is release-owned automatically rather
 * than being shared by omission.
 *
 * @type {readonly SharedWritePath[]}
 */
export const SHARED_WRITE_PATHS = Object.freeze([
  {
    glob: "package.json",
    owner: "release",
    sharedFields: ["scripts"],
    sharedFor: "adding, renaming or removing npm scripts",
    note:
      "Dependency, identity and packaging fields stay release-owned and are enforced by " +
      "deriveGuardedFieldChanges(), which reports a change to any of them as a scope escape."
  }
]);

/**
 * The shared-write rule covering a path, if any.
 * @param {string} path
 * @returns {SharedWritePath|null}
 */
export function sharedWritePathFor(path) {
  const normalized = path.replace(/\\/g, "/");
  return SHARED_WRITE_PATHS.find((entry) => matchGlob(entry.glob, normalized)) ?? null;
}

/**
 * The order in which sequential write leases are granted when a task touches several domains.
 *
 * One writer at a time is a hard rule on a `main`-only repository, so a multi-domain task is a
 * SEQUENCE of leases, not a committee. The order is fixed here rather than chosen per task so that
 * the same task always produces the same plan.
 *
 * It runs contracts-first: persisted shapes and trust boundaries settle before the code that
 * consumes them, the renderer follows the surface it renders, QA writes the proof once the behavior
 * exists, and Release packages what is already proven. Reversing it produces the familiar failure
 * where tests are written against an interface that then changes.
 * @type {readonly string[]}
 */
export const WRITER_PRECEDENCE = Object.freeze([
  "persistence",
  "security",
  "runtime",
  "recorder",
  "frontend",
  "software",
  "qa",
  "release",
  "project-state",
  "manager"
]);

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Risk
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Flags that make a task Risk 3 outright, no judgement involved.
 *
 * Note what is NOT here: `packaging_change` alone. The reviewed proposal listed "packaging trust"
 * as automatically critical in one section and as conditional in another. Resolved in favour of the
 * conditional reading — packaging reaches Risk 3 through `signing_change`, `offline_boundary_change`
 * or `new_dependency`, which are the properties that actually carry trust.
 * @type {readonly string[]}
 */
export const RISK_3_FLAGS = Object.freeze([
  "licensing_change",
  "auth_change",
  "authorization_change",
  "secret_handling_change",
  "protected_login_change",
  "signing_change",
  "migration_required",
  "concurrency_change",
  "offline_boundary_change"
]);

/** Flags that reach at least Risk 2 — cross-layer work with real runtime or persisted consequences. */
export const RISK_2_FLAGS = Object.freeze([
  "electron_main_change",
  "ipc_change",
  "runner_change",
  "execution_change",
  "persisted_shape_change",
  "filesystem_write_change",
  "packaging_change",
  "public_contract_change",
  "new_dependency"
]);

/** Flags that reach at least Risk 1 — localized behavior a user can observe. */
export const RISK_1_FLAGS = Object.freeze([
  "renderer_visual_change",
  "interaction_change",
  "accessibility_change",
  "general_engineering_change",
  "playwright_change",
  "recorder_change",
  "browser_behavior_change",
  "mock_site_required",
  "performance_change",
  "agent_infrastructure_change"
]);

/**
 * Paths that may never be written without an active lease, even though most paths may.
 *
 * The lease guard deliberately allows every edit when no lease is held: failing closed everywhere
 * would block every ordinary task in a repository where most work does not go through a contract,
 * and a gate that stops all work gets removed rather than obeyed. But "unrestricted" is the wrong
 * answer for the handful of areas the repository already treats as critical — an unclaimed edit to
 * licensing enforcement or the offline boundary is exactly the event this system exists to catch.
 *
 * DERIVED, not hand-listed: a path is protected when what it implies is already Risk 3. Adding a
 * new Risk 3 flag, or attaching one to a new path, extends this set automatically, so it cannot
 * drift out of agreement with the risk model the way a second hand-maintained list would.
 *
 * @type {readonly PathDomain[]}
 */
export const PROTECTED_PATHS = Object.freeze(
  PATH_DOMAINS.filter((d) => d.impliesFlags.some((flag) => RISK_3_FLAGS.includes(flag)))
);

/**
 * The protected-path rule covering a path, if any.
 * @param {string} path
 * @returns {PathDomain|null}
 */
export function protectedPathFor(path) {
  const normalized = path.replace(/\\/g, "/");
  return PROTECTED_PATHS.find((entry) => matchGlob(entry.glob, normalized)) ?? null;
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Watched ignored paths
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * @typedef {Object} WatchedIgnoredPath
 * @property {string} path   repo-relative file, or directory whose DIRECT entries are fingerprinted
 * @property {"file"|"dir"} kind
 * @property {string} owner
 * @property {string} why
 */

/**
 * Gitignored paths that still carry consequence, watched explicitly by fingerprint.
 *
 * `git status` never reports ignored files, so the Bash audit cannot see writes to them. Enumerating
 * every ignored path is not an option — `node_modules/` alone would make the audit unusable — and
 * most of what is ignored genuinely does not matter: `out/`, `dist/`, `graphify-out/` and the logs
 * are derived artifacts that are regenerated, not source anyone needs to be answerable for.
 *
 * But "ignored" and "unimportant" are not the same thing, and auditing this repository's own
 * `.gitignore` proved it. Secrets, captured authentication state, and the local permission file are
 * all ignored. So are two subtrees of `resources/**`, which this very registry marks PROTECTED as
 * the offline boundary — a Risk 3 path with invisible interiors.
 *
 * The list is therefore deliberately short and specific. Each entry is fingerprinted by mtime and
 * size (for a file) or by its direct entries' names and mtimes (for a directory), which costs a
 * handful of `stat` calls rather than a filesystem walk.
 *
 * @type {readonly WatchedIgnoredPath[]}
 */
export const WATCHED_IGNORED_PATHS = Object.freeze([
  {
    path: ".env",
    kind: "file",
    owner: "security",
    why: "Real environment secrets. `.env.example` is tracked; this is not."
  },
  {
    path: ".claude/settings.local.json",
    kind: "file",
    owner: "manager",
    why: "Local permission and hook overrides — including whether these guards run at all."
  },
  {
    path: "storage-state.json",
    kind: "file",
    owner: "integration",
    why: "Captured browser auth state."
  },
  {
    path: "auth-state.json",
    kind: "file",
    owner: "integration",
    why: "Captured browser auth state."
  },
  {
    path: "session-profiles.json",
    kind: "file",
    owner: "integration",
    why: "Reusable session profiles bound to Reuse Session nodes."
  },
  {
    path: "resources/browsers",
    kind: "dir",
    owner: "release",
    why:
      "Bundled Chromium — a gitignored subtree INSIDE the protected offline boundary. Swapping a " +
      "browser build changes what ships without touching a tracked file."
  },
  {
    path: "resources/oracle-jdbc",
    kind: "dir",
    owner: "release",
    why: "Imported Oracle driver jars — same problem, same protected parent."
  },
  {
    path: "build",
    kind: "dir",
    owner: "release",
    why:
      "Release owns `build/**` and touching it implies packaging_change, yet the whole directory " +
      "is gitignored with zero tracked files — so the ownership entry was pointing at something " +
      "git could never show. Watched here rather than left as a phantom."
  }
]);

/** @param {string} path @returns {WatchedIgnoredPath|null} */
export function watchedIgnoredPathFor(path) {
  const normalized = path.replace(/\\/g, "/");
  return (
    WATCHED_IGNORED_PATHS.find(
      (entry) => entry.path === normalized || normalized.startsWith(`${entry.path}/`)
    ) ?? null
  );
}

/**
 * Deterministic risk level for a classification. Same input, same output, every time.
 *
 * @param {Record<string, boolean|number>} classification
 * @returns {0|1|2|3}
 */
export function riskLevelFor(classification) {
  const on = (flag) => classification[flag] === true;
  const crossLayer = Number(classification.cross_layer_count ?? 1);

  if (RISK_3_FLAGS.some(on)) return 3;
  if (RISK_2_FLAGS.some(on) || crossLayer >= 3) return 2;
  if (RISK_1_FLAGS.some(on) || crossLayer >= 2) return 1;
  return 0;
}
