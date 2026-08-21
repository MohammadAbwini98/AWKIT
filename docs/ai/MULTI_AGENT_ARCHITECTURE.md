# AWKIT multi-agent architecture

AWKIT's multi-agent system is developer infrastructure for this repository. It is not part of the
SpecterStudio product, Electron runtime, renderer or packaged application.

The objective is not to maximize agent count. It is to keep the main session authoritative while
moving bounded, verbose work into the smallest useful set of isolated specialist contexts:

```text
user -> manager/classifier -> bounded specialists -> concise evidence -> manager synthesis/gates
```

The canonical machine-readable source is `tools/agents/routing-matrix.mjs`. The generated routing
matrix, Claude definitions and Codex/Gemini adapters must never be hand-edited.

## Authority and lifecycle

The main session is always the Manager. It owns the objective, decomposition, dependency order,
acceptance criteria, routing, temporary write ownership, synthesis, final verification, Git/project
state and user communication. A normal specialist does not recursively create arbitrary agents.

For every non-trivial change:

1. Inspect Git and the current handoff; preserve unrelated paths.
2. Create a task contract under `docs/ai/contracts/` with `task.mode` set to `inspect` or `change`.
3. Declare classification, expected paths and evidence before implementation.
4. Route through `route()` and activate the exact canonical set—no missing roles and no gratuitous
   swarm.
5. For a change, grant one contract-bound writer lease. Read-only analysis may run concurrently;
   writers are serialized on `main`.
6. Commit a coherent writer checkpoint, release, and hand off to the next routed writer.
7. Run `node tools/agents/task-gate.mjs <contract>` before claiming completion.
8. Obtain QA proof and routed independent QC, then finish the normal `AGENTS.md` checklist.

Repository state in Beads and `docs/ai/` remains authoritative. Agent messages and compaction
checkpoints are working context, never a competing status system.

## Canonical roles

| Routing id | Claude identity | Mode | Primary responsibility |
| --- | --- | --- | --- |
| `manager` | `awkit-manager` | writer | orchestration and agent infrastructure only |
| `architect` | `awkit-system-architect` | read-only | cross-layer architecture and compatibility |
| `uiux` | `awkit-ui-designer` | read-only | Hologram UX, accessibility and motion decisions |
| `frontend` | `awkit-frontend-engineer` | writer | `app/renderer/**` |
| `software` | `awkit-software-engineer` | writer | product modules without a narrower owner |
| `runtime` | `awkit-backend-engineer` | writer | Electron main/preload, runner and orchestration |
| `integration` | `awkit-integration-specialist` | read-only | renderer/main/browser/runtime contract integrity |
| `recorder` | `awkit-recorder-playwright` | writer | Recorder, Playwright, sessions and browser behavior |
| `qa` | `awkit-qa-engineer` | writer | red-to-green verifiers, tests and mock-site proof |
| `qc` | `awkit-qc-reviewer` | read-only | independent requirement and evidence review |
| `security` | `awkit-security-engineer` | writer | tightly scoped security/licensing/auth modules and review |
| `researcher` | `awkit-researcher` | read-only | low-cost Graphify/MCP/source/history investigation |
| `persistence` | `awkit-data-persistence` | writer | JSON/local storage, migrations and compatibility |
| `performance` | `awkit-performance-engineer` | read-only | capacity, concurrency, pressure and cancellation analysis |
| `release` | `awkit-build-release` | writer | build, packaging, bundled assets and offline gates |
| `project-state` | `awkit-project-state` | writer | AI docs, Beads, verifier registry and roadmap sources |

The full, generated ownership and activation data is in `docs/ai/routing/ROUTING_MATRIX.md`.
Equivalent responsibilities are represented once: the runtime role is the requested Backend/Core
Engineer, and Recorder is no longer conflated with the read-only integration reviewer.

## Routing philosophy

Task meaning comes first; expected paths provide a deterministic safety net by activating their
owner. Representative minimal routes are pinned by `verify:agent-routing`:

- Flow Designer visual change: Manager + UI/UX + Frontend + QA.
- Recorder-only locator/wait defect: Manager + Recorder + QA. Integration is added only when an IPC
  or public boundary is actually declared.
- IPC authorization boundary: Manager + Runtime + Integration + Security + QA + QC, with Security
  then Runtime holding serialized leases.
- Broad unfamiliar inspection: Manager + Researcher, no writer and no reviewer until evidence
  establishes implementation scope.

Architect and QC join when risk/cross-layer rules require them. General Software is a fallback for
owned product modules, not an automatic companion to every implementation specialist.

## Context and token policy

`tools/agents/context-policy.mjs` defines the policy used by the status line and generated roles:

| Current input context | Zone | Manager behavior |
| --- | --- | --- |
| 0–99,999 | normal | Work normally; delegate only when it reduces total context. |
| 100,000–119,999 | delegate | Move verbose search, history, logs and broad reading to one specialist. |
| 120,000–149,999 | warning | Strongly prefer isolated specialists and retain only evidence summaries. |
| 150,000+ | compact | Allow automatic compaction and resume from the ephemeral checkpoint. |

Project settings use the installed Claude client's supported
`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=75`. On the standard 200K window that targets approximately 150K;
it is percentage-based and therefore not an absolute 150K guarantee on extended-context models.
The project deliberately does not assert the newer absolute `autoCompactWindow` control into shared
settings.

The status line reads Claude's official `context_window` payload and shows agent, model, client,
token usage and zone. It handles the null usage sent at session start and immediately after compact.

### Delegation packet

Send only:

- objective;
- relevant acceptance criteria;
- relevant AWKIT constraints;
- known evidence;
- relevant files/modules;
- expected output;
- write authority, if any.

Every specialist distinguishes `FACT`, `INFERENCE`, `RECOMMENDATION` and `UNKNOWN`, then returns
concise Summary, Evidence, Changes, Files, Checks, Results, Risks, Unresolved and Next action
sections. Do not return full files, giant logs, raw search output, repeated project instructions,
chain-of-thought or obsolete hypotheses.

The repository validation ledger remains the evidence vocabulary:
`PASS | FAIL | BLOCKED | NOT RUN | NOT APPLICABLE`. Narrative uncertainty belongs under `UNKNOWN`;
it does not convert an unexecuted check into `PASS`.

### Concurrency budget

- Routine task: at most 1–2 active specialists.
- Cross-layer work: at most 2–3.
- Major independent investigation: normally no more than 3–4.
- All-role swarm: prohibited by default.
- Writers: exactly one active lease regardless of the read-only concurrency limit.

Do not ask several agents to repeat discovery. One Researcher result becomes reusable evidence for
downstream roles.

## Compaction checkpoint

`PreCompact` asynchronously captures a small allowlisted snapshot beneath:

```text
%LOCALAPPDATA%/AWKIT/claude-context/
```

`PostCompact` asynchronously rehydrates that snapshot as additional context. Both hooks are
non-blocking and exit successfully on failure, so checkpoint trouble cannot prevent compaction.
Checkpoint files contain only task/repository facts such as objective, acceptance, changed paths,
checks, blockers, next action and active lease. They never persist the transcript, compact summary,
conversation messages, credentials or session state. Restore output explicitly labels the data
ephemeral and non-authoritative and tells the manager to verify live Git/Beads/docs before acting.

## Subagents and Agent Teams

Subagents are the default because they isolate context with lower coordination overhead. Generated
Claude definitions grant the Manager the `Agent` tool; ordinary specialists do not receive it.
Read-only roles additionally deny Edit, Write and NotebookEdit and use plan permission mode.

Claude Code 2.1.201 supports the required project subagent fields and the PreCompact/PostCompact,
async-command and status-line mechanisms used here. Agent Teams are experimental, disabled by
default, interactive-only, limited to one team per session, and cannot be nested. On Windows they
run in-process rather than split panes. Therefore shared `.claude/settings.json` does not enable
them. A developer may opt in locally with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` only for a large
problem whose independent specialists genuinely need peer-to-peer coordination. The AWKIT lease
still serializes writes.

Do not use Teams for a tiny fix, one file, sequential work, simple research, routine verification or
when all members need the same files.

## Tools, models and memory

Generated definitions use least privilege and expose the configured Codebase Memory server through
`mcp__codebase-memory-mcp__*`, while retaining Graphify and narrow Git/test access. Graphify or MCP
findings must be confirmed against source before behavioral edits.

The Researcher uses the supported `haiku` alias for bounded discovery. Other roles use `inherit` so
the session selects a supported engineering/reasoning model rather than pinning a potentially stale
full model identifier. No role preloads every project skill or memory file; the prompt references
small global invariants, role scope and task context instead.

The production offline guarantee, protected-login handoff, mutable LOCALAPPDATA paths, persisted
unknown-field preservation, no-worktree/direct-main policy, Hologram UI rules, mock-site rules and
feature-specific verification remain in their existing authoritative documents and skills.

## Write and completion enforcement

Lease grant now requires a validated routing result. It rejects an unrouted holder, another owner's
path, an absolute/broad path, or a holder-owned path outside the contract's expected scope. The Bash
and PowerShell post-tool audit compares both the working tree and commits since lease acquisition;
it fingerprints baseline-dirty files so modifying pre-existing user work is no longer invisible.

`task-gate.mjs` combines contract validation, required evidence, QA/QC, unresolved lease violations,
changed files since `baseline_commit`, guarded shared-file fields, expected scope and explicitly
preserved pre-existing paths. A scope escape must be resolved and recorded; hiding it is not a fix.

### Default-deny, and the one bootstrap exception

No repository path is writable while no lease is held. The single exception is one task-contract
JSON file directly under `docs/ai/contracts/`, which the grant CLI validates against routing before
it creates a lease; `active-lease.json` and the schema are excluded from that exception. An earlier
draft failed open for "most" paths and protected only a Risk 3 subset, which meant the common case —
an unclaimed edit — was invisible. Ownership in the registry is now total, so every path has an
answerable owner and there is no unowned remainder for the guard to wave through.

### The shell is leased too, and the lease is role-aware

`lease-guard.mjs` runs on Bash/PowerShell as well as on Edit/Write/NotebookEdit. It fails closed on
shell metacharacters (`;`, `&`, `|`, `>`, `<`, backtick, newline, `$(`, `${`, `^`) and on background
commands, which could otherwise outlive their holder's lease. Beyond that it grants by role, not by
activation:

- every activated specialist may run a small read-only discovery grammar (bounded `git` reads,
  Graphify queries, `bd` reads);
- only the **active holder** may run state-changing commands, and only its own role's set — the
  project-state holder gets `bd` writes, `bd export -o .beads/issues.jsonl`, `npm run ai:memory` and
  `verify:roadmap-dashboard`; the release holder gets `package:*`; nobody else does;
- the root Manager may serialize lease transitions and run an exact, path-checked Git lifecycle, but
  it cannot borrow another specialist's implementation or build commands.

`git push origin main` is authorized only when the task contract sets `git.direct_main` and
`git.push_authorized`, names a push evidence item, and a prospective run of the whole task gate — with
that one unrunnable item treated as satisfied — still passes. Push is the only evidence that cannot
be `PASS` before it happens; nothing else is relaxed to reach it.

### Preserved user work is fingerprinted, not merely named

`preserved_paths` entries are `{path, git_status, sha256}` records, not bare strings. The gate
re-reads each file and blocks completion unless status and hash still match, so a preserved path
cannot become cover for editing the user's uncommitted work. `lease.mjs` archives every superseded
lease into an append-only `write_lease.history`, keyed by `task:holder:acquired_at`, so a released
lease and its amendments, overrides and violations survive the next holder taking over.

`verify:agent-routing` pins cardinalities as well as behavior: a check that iterates a collection is
paired with an assertion on that collection's size, because `.every()` over an emptied registry is
trivially true. Move such a pin deliberately when the registry changes; never relax it.

## Verification and failure behavior

Run at minimum:

```bash
npm run verify:agent-routing
npm run build
npm run verify:verifier-classification
npm run verify:roadmap-dashboard
npm run ai:memory
node tools/agents/task-gate.mjs docs/ai/contracts/<task>.json
```

Add feature-specific, GUI, packaged, security, migration, accessibility or mock-site proof when the
task touches those contracts. There is no generic `npm test` or lint gate.

When a check cannot run, record `NOT RUN` or `BLOCKED` and the reason. When a write is blocked, amend
the contract/lease and reroute; do not bypass the guard. When generated files drift, edit the
registry and run `npm run agent:render-agents`. When a checkpoint disagrees with Git or docs, discard
the checkpoint conclusion and use the live authoritative source.

## Adding, changing or removing a role

1. Edit only `tools/agents/routing-matrix.mjs`: unique routing id, unique `claudeName`, mode, bounded
   ownership, model alias, `maxTurns`, mandate, activation and write precedence.
2. Ensure ownership has no cross-role overlap and every path-domain owner is writer-eligible.
3. Update the contract schema's agent enum and classification properties.
4. Run `npm run agent:render-agents`; do not hand-edit generated definitions/adapters/matrix.
5. Extend exact minimal routing scenarios and negative/mutation proof in
   `scripts/verify-agent-routing.mjs`.
6. Re-run the gates above and update the authoritative project-state sources.

Official capability references:

- <https://code.claude.com/docs/en/sub-agents>
- <https://code.claude.com/docs/en/hooks>
- <https://code.claude.com/docs/en/statusline>
- <https://code.claude.com/docs/en/env-vars>
- <https://code.claude.com/docs/en/agent-teams>
