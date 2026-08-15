# ROUTING_MATRIX

> **This file is DERIVED. Do not edit it.** It is generated from `tools/agents/routing-matrix.mjs`
> by `node tools/agents/render-docs.mjs --write`, and `verify:agent-routing` re-renders it and
> compares byte-for-byte. Change the registry, then regenerate — a hand edit fails the verifier.

The registry is the single encoding of who may write where, which specialists a task activates,
and what risk it carries. An earlier draft stated these rules in three places that disagreed.

## Agents

| Agent | Role | Default mode | Owns | Folder authority |
| --- | --- | --- | --- | --- |
| `manager` | Manager / Orchestrator | writer | `docs/ai/**`<br>`tools/roadmap/**`<br>`tools/agents/**`<br>`.beads/**`<br>`.claude/**`<br>`.codex/**`<br>`.gemini/**` | `docs/AGENTS.md` |
| `architect` | Software Architect | read-only | `docs/ai/ARCHITECTURE.md`<br>`docs/ai/DECISIONS.md` | — |
| `uiux` | UI/UX & Accessibility Specialist | read-only | — | — |
| `frontend` | React / Renderer Engineer | writer | `app/renderer/**` | `app/renderer/AGENTS.md` |
| `runtime` | Electron Main / Runner Engineer | writer | `app/main/**`<br>`app/preload.ts`<br>`src/runner/**`<br>`src/orchestrator/**`<br>`src/instances/**` | `app/main/AGENTS.md` |
| `persistence` | Data & Persistence Specialist | writer | `src/storage/**`<br>`src/profiles/**`<br>`src/data/**`<br>`src/project/**` | `src/AGENTS.md` |
| `integration` | Playwright / Browser / IPC Integration Specialist | writer | `src/recorder/**`<br>`src/session/**`<br>`src/oracle/**` | `src/AGENTS.md` |
| `security` | Security & Trust-Boundary Specialist | review | `src/licensing/**`<br>`src/auth/**`<br>`src/secrets/**`<br>`src/security/**` | — |
| `qa` | Quality Assurance Engineer | writer | `tests/**`<br>`mock-site/**`<br>`scripts/verify-*`<br>`scripts/validate-*`<br>`src/testing/**` | `tests/AGENTS.md` |
| `qc` | Independent Quality Control Reviewer | read-only | — | — |
| `release` | Packaging / Offline / Release Engineer | writer | `build/**`<br>`resources/**`<br>`package.json`<br>`package-lock.json`<br>`electron-builder*` | — |

Mandates:

- **`manager`** — Classifies, routes, grants and revokes the write lease, and reconciles authoritative sources. Denied product code by default so it orchestrates rather than becoming a twelfth implementer.
- **`architect`** — Cross-layer contracts, IPC design, schema evolution, concurrency model, dependencies.
- **`uiux`** — Design authority for interaction, Hologram tokens, focus, reduced motion and accessibility. Specifies behavior; frontend implements it.
- **`frontend`** — Renderer: React, both designers, admin screens, renderer state, Hologram styles.
- **`runtime`** — Electron main, IPC implementation, runner, orchestration, execution and concurrency.
- **`persistence`** — JSON profile compatibility, migrations, atomic writes, unknown-field preservation, import/export and backward compatibility.
- **`integration`** — Playwright, Chromium, Recorder capture, popups/frames/downloads, live browser sessions.
- **`security`** — Auth, licensing, secrets, protected-login handoff, IPC authorization and signing. Prefers review; may own tightly scoped security modules.
- **`qa`** — Designs the proof: verifiers, mock-site scenarios, negative and race cases. May never weaken an assertion to obtain green output.
- **`qc`** — Asks whether the evidence actually proves the requested result. Rejects to the Manager; never silently repairs a defect it found.
- **`release`** — Packaging, bundled Chromium, signing, offline boundary, installer and portable builds.

## Write-lease order

One writer at a time, so a multi-domain task is a SEQUENCE of leases. Contracts settle before
the code consuming them; QA writes the proof once the behavior exists.

```text
persistence -> security -> runtime -> integration -> frontend -> qa -> release -> manager
```

## Path map

The basis for BOTH lease scoping and derived classification. `Implies` lists only flags that are
true *whenever* the path is touched — editing the renderer proves it changed, never that the
change was visual. First match wins, so narrower paths come first.

| Path | Owner | Implies | Note |
| --- | --- | --- | --- |
| `app/main/ipc/**` | `runtime` | `electron_main_change`, `ipc_change` | Every renderer-visible channel lives here; touching it is by definition an IPC change. |
| `app/preload.ts` | `runtime` | `ipc_change`, `public_contract_change` | The window.playwrightFlowStudio surface — an internal contract other layers compile against. |
| `src/licensing/**` | `security` | `licensing_change` | Licensing is automatically Risk 3. |
| `src/auth/**` | `security` | `auth_change` | Authentication. |
| `src/secrets/**` | `security` | `secret_handling_change` | Secret storage and redaction. |
| `src/security/**` | `security` | `authorization_change` | Permissions registry and trust boundaries. |
| `src/session/**` | `integration` | `browser_behavior_change` | Session capture and reuse; protected-login handoff lands here. |
| `src/recorder/**` | `integration` | `recorder_change` | Recorder capture and locator synthesis. |
| `src/runner/**` | `runtime` | `runner_change`, `execution_change` | Playwright execution path. |
| `src/orchestrator/**` | `runtime` | `execution_change` | Not `src/orchestration` — that directory does not exist. |
| `src/instances/**` | `runtime` | `execution_change` | Live instance model behind the Instance Monitor. |
| `src/storage/**` | `persistence` | `filesystem_write_change` | Atomic writes and the profile stores. |
| `src/profiles/**` | `persistence` | `filesystem_write_change` | JSON profile shapes; unknown-field preservation lives or dies here. |
| `src/data/**` | `persistence` | `filesystem_write_change` | Data sources and row-driven inputs. |
| `src/project/**` | `persistence` | `filesystem_write_change` | Project-level persisted state. |
| `src/oracle/**` | `integration` | — | Oracle JDBC bridge; its own external gates apply. |
| `src/testing/**` | `qa` | — | Test-only helpers that ship in src for reuse by verifiers. |
| `app/renderer/**` | `frontend` | — | Renderer. Visual/interaction/accessibility intent is not path-determinable — declare it. |
| `app/main/**` | `runtime` | `electron_main_change` | Electron main process. |
| `tests/**` | `qa` | — | Test suites. |
| `mock-site/**` | `qa` | `mock_site_required` | The Feature Test Lab. |
| `scripts/verify-*` | `qa` | — | Verifiers. A new one must be registered in scripts/lib/verifier-classification.ts. |
| `scripts/validate-*` | `qa` | — | Validators, same registration rule. |
| `build/**` | `release` | `packaging_change` | Packaging inputs. |
| `resources/**` | `release` | `packaging_change`, `offline_boundary_change` | Shipped resources. Never a runtime write target. |
| `package.json` | `release` | `packaging_change` | Script inventory and dependencies. A dependency edit is also new_dependency. |
| `package-lock.json` | `release` | `packaging_change`, `new_dependency` | The lockfile only moves when the dependency graph moves. |
| `electron-builder*` | `release` | `packaging_change` | Installer and portable build configuration. |
| `docs/ai/ARCHITECTURE.md` | `architect` | — | Module map and data/runtime flow. |
| `docs/ai/DECISIONS.md` | `architect` | — | Recorded technical and product decisions. |
| `docs/ai/**` | `manager` | — | AI memory and governance documents. |
| `tools/roadmap/**` | `manager` | — | Derived dashboard. Never hand-edited to record progress. |
| `tools/agents/**` | `manager` | — | This routing system itself. |
| `.beads/**` | `manager` | — | Tracker database and its JSONL export. The Manager files and closes issues, and the export must be refreshed with `bd export -o .beads/issues.jsonl` before the dashboard reads it. |
| `.claude/**` | `manager` | — | Claude Code agent/skill/hook configuration. Generated role definitions live here. |
| `.codex/**` | `manager` | — | Codex configuration and skills. |
| `.gemini/**` | `manager` | — | Gemini / Antigravity configuration and skills. |

## Protected paths

Most paths are writable when NO lease is held — failing closed everywhere would block every task
that does not use a contract, and a gate that stops all work gets removed rather than obeyed.
These are the exception: an unclaimed edit here leaves nobody answerable for a Risk 3
change, so the guard refuses it until someone takes a lease.

**Derived, not hand-listed** — a path is protected when what it implies is already Risk 3.

| Path | Owner | Implies |
| --- | --- | --- |
| `src/licensing/**` | `security` | `licensing_change` |
| `src/auth/**` | `security` | `auth_change` |
| `src/secrets/**` | `security` | `secret_handling_change` |
| `src/security/**` | `security` | `authorization_change` |
| `resources/**` | `release` | `packaging_change`, `offline_boundary_change` |

## Watched ignored paths

`git status` never reports gitignored files, and enumerating them all is impossible — `node_modules/`
alone would make the audit unusable. Most of what is ignored genuinely does not matter: `out/`,
`dist/`, `graphify-out/` and the logs are derived artifacts.

These are the exceptions — ignored, but consequential — fingerprinted by mtime and size at lease
grant and compared after every shell command.

| Path | Kind | Owner | Why |
| --- | --- | --- | --- |
| `.env` | file | `security` | Real environment secrets. `.env.example` is tracked; this is not. |
| `.claude/settings.local.json` | file | `manager` | Local permission and hook overrides — including whether these guards run at all. |
| `storage-state.json` | file | `integration` | Captured browser auth state. |
| `auth-state.json` | file | `integration` | Captured browser auth state. |
| `session-profiles.json` | file | `integration` | Reusable session profiles bound to Reuse Session nodes. |
| `resources/browsers` | dir | `release` | Bundled Chromium — a gitignored subtree INSIDE the protected offline boundary. Swapping a browser build changes what ships without touching a tracked file. |
| `resources/oracle-jdbc` | dir | `release` | Imported Oracle driver jars — same problem, same protected parent. |
| `build` | dir | `release` | Release owns `build/**` and touching it implies packaging_change, yet the whole directory is gitignored with zero tracked files — so the ownership entry was pointing at something git could never show. Watched here rather than left as a phantom. |

## Shared write paths

Files whose ownership is real but whose risk lives in specific KEYS rather than the whole file.
The lease guard runs BEFORE an edit and cannot see which key is about to change, so for these
paths the edit-time gate is relaxed and the enforcement moves to a content-aware derived check
that compares the committed file against the working tree.

| Path | Owner | Shared fields | Shared for |
| --- | --- | --- | --- |
| `package.json` | `release` | `scripts` | adding, renaming or removing npm scripts |

`sharedFields` is an ALLOW-list, so the default is guarded: a top-level key nobody has thought
about yet is owned automatically rather than shared by omission. Changing any guarded field
without activating the owner is a scope escape and blocks completion.

## Activation rules

| Agent | Activates when | Why |
| --- | --- | --- |
| `uiux` | `renderer_visual_change` or `interaction_change` or `accessibility_change` | Design, focus, motion and accessibility decisions are not the implementer's to make alone. |
| `frontend` | `renderer_visual_change` or `interaction_change` or `accessibility_change`<br>or a expected path it owns is touched | Owns app/renderer/**. |
| `runtime` | `electron_main_change` or `ipc_change` or `runner_change` or `execution_change` or `concurrency_change`<br>or a expected path it owns is touched | Owns the main process and the execution path. |
| `persistence` | `persisted_shape_change` or `migration_required` or `filesystem_write_change`<br>or a expected path it owns is touched | A persisted shape that changes without this agent is how unknown fields get dropped. |
| `integration` | `playwright_change` or `recorder_change` or `browser_behavior_change` or `mock_site_required`<br>or a expected path it owns is touched | Real browser behavior cannot be reasoned about from the renderer alone. |
| `security` | `licensing_change` or `auth_change` or `authorization_change` or `secret_handling_change` or `protected_login_change` or `signing_change`<br>or a expected path it owns is touched | Trust boundaries are reviewed, never assumed. |
| `release` | `packaging_change` or `offline_boundary_change` or `signing_change` or `new_dependency`<br>or a expected path it owns is touched | Offline-first is a release property; a dependency is a packaging decision. |
| `architect` | `public_contract_change` or `migration_required` or `new_dependency` or `concurrency_change` or `licensing_change`<br>or `cross_layer_count >= 3` | Cross-layer contracts and schema evolution need a designer, not three local decisions. |
| `qa` | `risk_level >= 1` | Anything above documentation must state how it is proven. |
| `qc` | `licensing_change` or `auth_change` or `authorization_change` or `secret_handling_change` or `signing_change` or `migration_required` or `concurrency_change` or `packaging_change`<br>or `risk_level >= 2`<br>or `cross_layer_count >= 2` | Independent review of whether the evidence proves the requested result. |

## Risk levels

Risk is computed, never chosen. A contract may declare a HIGHER level than computed; never lower.

**Risk 3 — critical.** Any of: `licensing_change`, `auth_change`, `authorization_change`, `secret_handling_change`, `protected_login_change`, `signing_change`, `migration_required`, `concurrency_change`, `offline_boundary_change`.

**Risk 2 — cross-layer.** Any of: `electron_main_change`, `ipc_change`, `runner_change`, `execution_change`, `persisted_shape_change`, `filesystem_write_change`, `recorder_change`, `browser_behavior_change`, `packaging_change`, `public_contract_change`, `new_dependency`, or `cross_layer_count >= 3`.

**Risk 1 — localized.** Any of: `renderer_visual_change`, `interaction_change`, `accessibility_change`, `playwright_change`, `mock_site_required`, or `cross_layer_count >= 2`.

**Risk 0 — documentation.** Nothing above applies.

Note that `packaging_change` alone is Risk 2, not Risk 3. Packaging reaches critical through
`signing_change`, `offline_boundary_change` or `new_dependency` — the properties that actually
carry trust.

## Classification flags

Routing reads only these. An unknown key is rejected, never ignored.

- `renderer_visual_change`
- `interaction_change`
- `accessibility_change`
- `electron_main_change`
- `ipc_change`
- `runner_change`
- `execution_change`
- `concurrency_change`
- `persisted_shape_change`
- `migration_required`
- `filesystem_write_change`
- `playwright_change`
- `recorder_change`
- `browser_behavior_change`
- `mock_site_required`
- `licensing_change`
- `auth_change`
- `authorization_change`
- `secret_handling_change`
- `protected_login_change`
- `signing_change`
- `packaging_change`
- `offline_boundary_change`
- `new_dependency`
- `public_contract_change`
- `cross_layer_count` (integer >= 1)

## Evidence vocabulary

Copied from the validation ledger's own `LEDGER_STATUSES`, not invented. `verify:agent-routing`
asserts the two still match.

```text
PASS | FAIL | BLOCKED | NOT RUN | NOT APPLICABLE
```

`BLOCKED`, `NOT RUN` and `FAIL` are not `PASS`. An inconclusive check is `NOT RUN` with a reason —
there is no separate `INCONCLUSIVE` state, and no underscored `NOT_RUN` variant.

