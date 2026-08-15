---
name: agent-routing
description: >-
  AWKIT's canonical specialist roles, ownership boundaries and write-lease rules for Gemini / Antigravity.
  Read before taking on work that spans more than one area, before editing outside your own
  domain, and before claiming a task is complete.
allowed-tools: Read, Glob, Grep, Bash(git *), Bash(npm run *), Bash(node *)
---

# Agent Routing

> **Generated from `tools/agents/routing-matrix.mjs`. Do not edit.**
> Regenerate with `npm run agent:render-agents`; `verify:agent-routing` compares this file
> byte-for-byte against the registry.

Gemini / Antigravity has no per-role agent runtime in this repository, so the eleven roles are not emitted
as separate executable files here — that would be eleven more documents able to drift while
executing nothing. This one adapter carries the same registry-derived roster. Claude Code, which
does have a subagent runtime, gets generated definitions under `.claude/agents/`.

## Roles

| Role | Mode | Owns | Mandate |
| --- | --- | --- | --- |
| `manager` | writer | `docs/ai/**`<br>`tools/roadmap/**`<br>`tools/agents/**`<br>`.beads/**`<br>`.claude/**`<br>`.codex/**`<br>`.gemini/**` | Classifies, routes, grants and revokes the write lease, and reconciles authoritative sources. Denied product code by default so it orchestrates rather than becoming a twelfth implementer. |
| `architect` | read-only | `docs/ai/ARCHITECTURE.md`<br>`docs/ai/DECISIONS.md` | Cross-layer contracts, IPC design, schema evolution, concurrency model, dependencies. |
| `uiux` | read-only | — | Design authority for interaction, Hologram tokens, focus, reduced motion and accessibility. Specifies behavior; frontend implements it. |
| `frontend` | writer | `app/renderer/**` | Renderer: React, both designers, admin screens, renderer state, Hologram styles. |
| `runtime` | writer | `app/main/**`<br>`app/preload.ts`<br>`src/runner/**`<br>`src/orchestrator/**`<br>`src/instances/**` | Electron main, IPC implementation, runner, orchestration, execution and concurrency. |
| `persistence` | writer | `src/storage/**`<br>`src/profiles/**`<br>`src/data/**`<br>`src/project/**` | JSON profile compatibility, migrations, atomic writes, unknown-field preservation, import/export and backward compatibility. |
| `integration` | writer | `src/recorder/**`<br>`src/session/**`<br>`src/oracle/**` | Playwright, Chromium, Recorder capture, popups/frames/downloads, live browser sessions. |
| `security` | review | `src/licensing/**`<br>`src/auth/**`<br>`src/secrets/**`<br>`src/security/**` | Auth, licensing, secrets, protected-login handoff, IPC authorization and signing. Prefers review; may own tightly scoped security modules. |
| `qa` | writer | `tests/**`<br>`mock-site/**`<br>`scripts/verify-*`<br>`scripts/validate-*`<br>`src/testing/**` | Designs the proof: verifiers, mock-site scenarios, negative and race cases. May never weaken an assertion to obtain green output. |
| `qc` | read-only | — | Asks whether the evidence actually proves the requested result. Rejects to the Manager; never silently repairs a defect it found. |
| `release` | writer | `build/**`<br>`resources/**`<br>`package.json`<br>`package-lock.json`<br>`electron-builder*` | Packaging, bundled Chromium, signing, offline boundary, installer and portable builds. |

## The rules that matter most

1. **One writer at a time.** Lease order: persistence -> security -> runtime -> integration -> frontend -> qa -> release -> manager. AWKIT develops directly on `main`, so a second concurrent writer has nothing to isolate it.
2. **A blocked write is scope expansion, not an obstacle.** Amend the lease (`npm run agent:lease-amend`), which re-runs routing and may reassign the work.
3. **Evidence vocabulary is the ledger's:** PASS | FAIL | BLOCKED | NOT RUN | NOT APPLICABLE. No `INCONCLUSIVE`, no underscored `NOT_RUN`.
4. **Declare evidence before implementing**, and never weaken an assertion to get green.
5. **No worktrees, no new branches.** See `docs/ai/BRANCH_AND_COMMIT_POLICY.md`.

Process: `docs/ai/routing/ROUTING_RULES.md`. Data: `docs/ai/routing/ROUTING_MATRIX.md`.
