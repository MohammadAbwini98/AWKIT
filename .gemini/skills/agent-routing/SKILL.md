---
name: agent-routing
description: >-
  AWKIT's canonical specialist roles, ownership boundaries and write-lease rules for Gemini / Antigravity.
  Read before taking on work that spans more than one area, before editing outside your own
  domain, and before claiming a task is complete.
allowed-tools: Read, Glob, Grep, Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git show:*), Bash(git rev-parse:*), Bash(git ls-files:*), Bash(npm run agent:lease), Bash(npm run agent:lease-grant:*), Bash(node tools/agents/task-gate.mjs:*)
---

# Agent Routing

> **Generated from `tools/agents/routing-matrix.mjs`. Do not edit.**
> Regenerate with `node tools/agents/render-platform-agents.mjs --write`; `verify:agent-routing` compares this file
> byte-for-byte against the registry.

Gemini / Antigravity has no per-role agent runtime in this repository, so the 16 roles are not emitted
as separate executable files here — that would be 16 more documents able to drift while
executing nothing. This one adapter carries the same registry-derived roster. Claude Code, which
does have a subagent runtime, gets generated definitions under `.claude/agents/`.

## Roles

| Role | Mode | Owns | Mandate |
| --- | --- | --- | --- |
| `manager` | writer | `tools/agents/**`<br>`.claude/**`<br>`.codex/**`<br>`.gemini/**`<br>`.agents/**`<br>`.cursor/**`<br>`.cbmignore`<br>`.graphifyignore`<br>`.mcp.json`<br>`scripts/AGENTS.md`<br>`src/AGENTS.md`<br>`AGENTS.md`<br>`CLAUDE.md`<br>`GEMINI.md` | Owns task decomposition, deterministic routing, context budgets, the serialized write lease, acceptance synthesis and final repository gates; it delegates detailed discovery. |
| `architect` | read-only | — | Analyzes Electron boundaries, IPC, runner/orchestration, persistence contracts, offline packaging, compatibility, concurrency and architectural debt before implementation. |
| `uiux` | read-only | — | Design authority for interaction, Hologram tokens, focus, reduced motion and accessibility. Specifies behavior; frontend implements it. |
| `frontend` | writer | `app/renderer/**`<br>`logos/**`<br>`UI Samples/**`<br>`ui-mock.html`<br>`capture-dribbble.mjs`<br>`get-videos.mjs` | Renderer: React, both designers, admin screens, renderer state, Hologram styles. |
| `software` | writer | `src/branding/**`<br>`src/logging/**`<br>`src/reports/**`<br>`src/roadmap/**`<br>`src/semantic/**`<br>`src/theme/**`<br>`src/utils/**`<br>`src/validation/**` | Implements scoped TypeScript product work that does not belong to a narrower owner; never displaces a renderer, runtime, recorder, persistence, security or release specialist. |
| `runtime` | writer | `app/main/**`<br>`src/runner/**`<br>`src/orchestrator/**`<br>`src/instances/**`<br>`src/oracle/**`<br>`oracle-jdbc-bridge/**`<br>`native-hosts/**`<br>`scripts/oracle/**`<br>`scripts/prepare-oracle-runtime.mjs`<br>`scripts/prepare-zvec-native-host.mjs`<br>`scripts/zvec-harness/**`<br>`scripts/zvec-spike/**` | Electron main, preload, IPC implementation, runner, execution orchestration, instance state and Windows runtime behavior while preserving offline operation. |
| `integration` | read-only | — | Reviews renderer-preload-main, Electron-Playwright, Flow-Workflow-Runner, session, settings, reporting, licensing and packaged-runtime contracts end to end. |
| `recorder` | writer | `src/recorder/**`<br>`src/session/**` | Playwright and Chromium recorder semantics, resilient locators, popups, frames, waits, downloads, uploads, browser contexts, session reuse and Feature Test Lab evidence. |
| `qa` | writer | `tests/**`<br>`mock-site/**`<br>`scripts/verify-*`<br>`scripts/validate-*`<br>`scripts/benchmark-*`<br>`scripts/benchmark/**`<br>`scripts/helpers/**`<br>`scripts/measure-*`<br>`scripts/random-test-lab.mts`<br>`scripts/seed-*`<br>`scripts/capture-*`<br>`scripts/write-test-root-manifest.mjs`<br>`playwright.config.ts`<br>`specs/e2e/**`<br>`scripts/lib/e2e-qa-lib.mjs`<br>`scripts/lib/gui-verify-harness.mjs`<br>`scripts/lib/latency-histogram.mts`<br>`scripts/lib/legacy-gui-verifier-coverage.mjs`<br>`scripts/lib/loop-capsule-visual-oracle.mjs`<br>`scripts/lib/rss-trend.mts`<br>`scripts/lib/selfSignedCertificate.mts`<br>`scripts/lib/test-lab-packaging-policy.ts`<br>`scripts/lib/verify-flow-loop-capsule-gui.mjs`<br>`scripts/lib/verify-workflow-loop-capsule-gui.mjs`<br>`src/testing/**` | Owns red-to-green proof, regression and negative cases, mock-site scenarios, runtime and GUI evidence, accessibility, concurrency and compatibility verification; never weakens assertions. |
| `qc` | read-only | — | Independently reviews requested behavior, architecture, security, offline and data rules, test credibility, code quality and documentation; never self-approves implementation. |
| `security` | writer | `src/licensing/**`<br>`src/auth/**`<br>`src/secrets/**`<br>`src/security/**`<br>`tools/license-issuer/**`<br>`.env.example` | Owns tightly scoped licensing, authorization, secret and trust-boundary modules and reviews protected-login handoff, Electron/session security, logging redaction and signing risk. |
| `researcher` | read-only | — | Uses Graphify, codebase memory, narrow source confirmation, documentation and Git history to return concise evidence for unfamiliar areas without dumping files into the manager context. |
| `persistence` | writer | `src/storage/**`<br>`src/profiles/**`<br>`src/data/**`<br>`src/project/**` | Owns persisted JSON, LOCALAPPDATA storage, migrations, atomic writes, corruption recovery, unknown-field preservation, import/export and old-data compatibility. |
| `performance` | read-only | — | Analyzes workload concurrency, scheduling, backpressure, memory pressure, cancellation and large-workflow regressions without hardcoding host CPU or RAM assumptions. |
| `release` | writer | `build/**`<br>`resources/**`<br>`src/offline/**`<br>`package.json`<br>`package-lock.json`<br>`electron-builder*`<br>`.github/workflows/**`<br>`.gitattributes`<br>`.gitignore`<br>`.npmrc`<br>`electron.vite*.ts`<br>`vite.config.ts`<br>`tsconfig.json`<br>`tsconfig.scripts.json`<br>`scripts/build-*`<br>`scripts/build.ps1`<br>`scripts/clean-machine/**`<br>`scripts/compare-offline-payloads.mjs`<br>`scripts/dev.mjs`<br>`scripts/dev.ps1`<br>`scripts/generate-app-icon.mjs`<br>`scripts/generate-dependency-manifest.ps1`<br>`scripts/lib/clean-machine-validation-policy.ts`<br>`scripts/lib/nsis-per-user-install.ps1`<br>`scripts/lib/offline-browser-integrity.ps1`<br>`scripts/lib/release-key-custody.*`<br>`scripts/offline-manifest-signature.mjs`<br>`scripts/package-*`<br>`scripts/prepare-offline-deps.ps1`<br>`scripts/release-*`<br>`scripts/stage-offline-assets-from.ps1`<br>`scripts/write-artifact-provenance.mjs` | Owns build, packaging, bundled Chromium, offline validation, dependency manifests, signing procedure, source hygiene, NSIS/portable artifacts and packaged-runtime evidence. |
| `project-state` | writer | `docs/**`<br>`README.md`<br>`IMPLEMENTATION_STATUS.md`<br>`CLEAN_MACHINE_VALIDATION_RUNBOOK.md`<br>`SESSION_OUTCOMES_CLOSEOUT.md`<br>`BROWSER_AUTOMATION_SKILLS_REPORT.md`<br>`00_TEMPLATE_REVIEW_FINDINGS.md`<br>`change_requests/**`<br>`plans/**`<br>`playwright_flow_studio_updated_phases/**`<br>`.beads/**`<br>`tools/roadmap/**`<br>`scripts/lib/verifier-classification.ts`<br>`scripts/ai-memory/**`<br>`scripts/generate-embedded-roadmap-snapshot.mjs`<br>`setup-ai-memory.mjs` | Reconciles CURRENT_STATE, HANDOFF, TASK_LOG, KNOWN_ISSUES, DEFECTS, Beads, validation ledger, assignments, verifier registry and roadmap sources without editing derived status to fake progress. |

## The rules that matter most

1. **One writer at a time.** Lease order: persistence -> security -> runtime -> recorder -> frontend -> software -> qa -> release -> project-state -> manager. AWKIT develops directly on `main`, so a second concurrent writer has nothing to isolate it.
2. **A blocked write is scope expansion, not an obstacle.** Amend the lease (`npm run agent:lease-amend`), which re-runs routing and may reassign the work.
3. **Evidence vocabulary is the ledger's:** PASS | FAIL | BLOCKED | NOT RUN | NOT APPLICABLE. No `INCONCLUSIVE`, no underscored `NOT_RUN`.
4. **Declare evidence before implementing**, and never weaken an assertion to get green.
5. **No worktrees, no new branches.** See `docs/ai/BRANCH_AND_COMMIT_POLICY.md`.

Process: `docs/ai/routing/ROUTING_RULES.md`. Data: `docs/ai/routing/ROUTING_MATRIX.md`.
