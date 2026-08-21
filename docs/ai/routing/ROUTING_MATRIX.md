# ROUTING_MATRIX

> **This file is DERIVED. Do not edit it.** It is generated from `tools/agents/routing-matrix.mjs`
> by `node tools/agents/render-docs.mjs --write`, and `verify:agent-routing` re-renders it and
> compares byte-for-byte. Change the registry, then regenerate — a hand edit fails the verifier.

The registry is the single encoding of who may write where, which specialists a task activates,
and what risk it carries. An earlier draft stated these rules in three places that disagreed.

## Agents

| Agent | Role | Default mode | Owns | Folder authority |
| --- | --- | --- | --- | --- |
| `manager` | Manager / Orchestrator | writer | `tools/agents/**`<br>`.claude/**`<br>`.codex/**`<br>`.gemini/**`<br>`.agents/**`<br>`.cursor/**`<br>`.cbmignore`<br>`.graphifyignore`<br>`scripts/AGENTS.md`<br>`src/AGENTS.md`<br>`AGENTS.md`<br>`CLAUDE.md`<br>`GEMINI.md` | — |
| `architect` | Software Architect | read-only | — | — |
| `uiux` | UI/UX & Accessibility Specialist | read-only | — | — |
| `frontend` | React / Renderer Engineer | writer | `app/renderer/**`<br>`logos/**`<br>`UI Samples/**`<br>`ui-mock.html`<br>`capture-dribbble.mjs`<br>`get-videos.mjs` | `app/renderer/AGENTS.md` |
| `software` | General Software Engineer | writer | `src/branding/**`<br>`src/logging/**`<br>`src/reports/**`<br>`src/roadmap/**`<br>`src/semantic/**`<br>`src/theme/**`<br>`src/utils/**`<br>`src/validation/**` | `src/AGENTS.md` |
| `runtime` | Electron Main / Runner Engineer | writer | `app/main/**`<br>`src/runner/**`<br>`src/orchestrator/**`<br>`src/instances/**`<br>`src/oracle/**`<br>`oracle-jdbc-bridge/**`<br>`native-hosts/**`<br>`scripts/oracle/**`<br>`scripts/prepare-oracle-runtime.mjs`<br>`scripts/prepare-zvec-native-host.mjs`<br>`scripts/zvec-harness/**`<br>`scripts/zvec-spike/**` | `app/main/AGENTS.md` |
| `integration` | Cross-Boundary Integration Specialist | read-only | — | — |
| `recorder` | Recorder / Playwright Specialist | writer | `src/recorder/**`<br>`src/session/**` | `src/AGENTS.md` |
| `qa` | Quality Assurance Engineer | writer | `tests/**`<br>`mock-site/**`<br>`scripts/verify-*`<br>`scripts/validate-*`<br>`scripts/benchmark-*`<br>`scripts/benchmark/**`<br>`scripts/helpers/**`<br>`scripts/measure-*`<br>`scripts/random-test-lab.mts`<br>`scripts/seed-*`<br>`scripts/capture-*`<br>`scripts/write-test-root-manifest.mjs`<br>`playwright.config.ts`<br>`specs/e2e/**`<br>`scripts/lib/e2e-qa-lib.mjs`<br>`scripts/lib/gui-verify-harness.mjs`<br>`scripts/lib/latency-histogram.mts`<br>`scripts/lib/legacy-gui-verifier-coverage.mjs`<br>`scripts/lib/loop-capsule-visual-oracle.mjs`<br>`scripts/lib/rss-trend.mts`<br>`scripts/lib/selfSignedCertificate.mts`<br>`scripts/lib/test-lab-packaging-policy.ts`<br>`scripts/lib/verify-flow-loop-capsule-gui.mjs`<br>`scripts/lib/verify-workflow-loop-capsule-gui.mjs`<br>`src/testing/**` | `tests/AGENTS.md` |
| `qc` | Independent Quality Control Reviewer | read-only | — | — |
| `security` | Security & Trust-Boundary Engineer | writer | `src/licensing/**`<br>`src/auth/**`<br>`src/secrets/**`<br>`src/security/**`<br>`tools/license-issuer/**`<br>`.env.example` | — |
| `researcher` | Codebase Researcher | read-only | — | — |
| `persistence` | Data & Persistence Specialist | writer | `src/storage/**`<br>`src/profiles/**`<br>`src/data/**`<br>`src/project/**` | `src/AGENTS.md` |
| `performance` | Performance / Concurrency Specialist | read-only | — | — |
| `release` | Packaging / Offline / Release Engineer | writer | `build/**`<br>`resources/**`<br>`src/offline/**`<br>`package.json`<br>`package-lock.json`<br>`electron-builder*`<br>`.github/workflows/**`<br>`.gitattributes`<br>`.gitignore`<br>`.npmrc`<br>`electron.vite*.ts`<br>`vite.config.ts`<br>`tsconfig.json`<br>`tsconfig.scripts.json`<br>`scripts/build-*`<br>`scripts/build.ps1`<br>`scripts/clean-machine/**`<br>`scripts/compare-offline-payloads.mjs`<br>`scripts/dev.mjs`<br>`scripts/dev.ps1`<br>`scripts/generate-app-icon.mjs`<br>`scripts/generate-dependency-manifest.ps1`<br>`scripts/lib/clean-machine-validation-policy.ts`<br>`scripts/lib/nsis-per-user-install.ps1`<br>`scripts/lib/offline-browser-integrity.ps1`<br>`scripts/lib/release-key-custody.*`<br>`scripts/offline-manifest-signature.mjs`<br>`scripts/package-*`<br>`scripts/prepare-offline-deps.ps1`<br>`scripts/release-*`<br>`scripts/stage-offline-assets-from.ps1`<br>`scripts/write-artifact-provenance.mjs` | — |
| `project-state` | Documentation / Project-State Specialist | writer | `docs/**`<br>`README.md`<br>`IMPLEMENTATION_STATUS.md`<br>`CLEAN_MACHINE_VALIDATION_RUNBOOK.md`<br>`SESSION_OUTCOMES_CLOSEOUT.md`<br>`BROWSER_AUTOMATION_SKILLS_REPORT.md`<br>`00_TEMPLATE_REVIEW_FINDINGS.md`<br>`change_requests/**`<br>`plans/**`<br>`playwright_flow_studio_updated_phases/**`<br>`.beads/**`<br>`tools/roadmap/**`<br>`scripts/lib/verifier-classification.ts`<br>`scripts/ai-memory/**`<br>`scripts/generate-embedded-roadmap-snapshot.mjs`<br>`setup-ai-memory.mjs` | `docs/AGENTS.md` |

Mandates:

- **`manager`** — Owns task decomposition, deterministic routing, context budgets, the serialized write lease, acceptance synthesis and final repository gates; it delegates detailed discovery.
- **`architect`** — Analyzes Electron boundaries, IPC, runner/orchestration, persistence contracts, offline packaging, compatibility, concurrency and architectural debt before implementation.
- **`uiux`** — Design authority for interaction, Hologram tokens, focus, reduced motion and accessibility. Specifies behavior; frontend implements it.
- **`frontend`** — Renderer: React, both designers, admin screens, renderer state, Hologram styles.
- **`software`** — Implements scoped TypeScript product work that does not belong to a narrower owner; never displaces a renderer, runtime, recorder, persistence, security or release specialist.
- **`runtime`** — Electron main, preload, IPC implementation, runner, execution orchestration, instance state and Windows runtime behavior while preserving offline operation.
- **`integration`** — Reviews renderer-preload-main, Electron-Playwright, Flow-Workflow-Runner, session, settings, reporting, licensing and packaged-runtime contracts end to end.
- **`recorder`** — Playwright and Chromium recorder semantics, resilient locators, popups, frames, waits, downloads, uploads, browser contexts, session reuse and Feature Test Lab evidence.
- **`qa`** — Owns red-to-green proof, regression and negative cases, mock-site scenarios, runtime and GUI evidence, accessibility, concurrency and compatibility verification; never weakens assertions.
- **`qc`** — Independently reviews requested behavior, architecture, security, offline and data rules, test credibility, code quality and documentation; never self-approves implementation.
- **`security`** — Owns tightly scoped licensing, authorization, secret and trust-boundary modules and reviews protected-login handoff, Electron/session security, logging redaction and signing risk.
- **`researcher`** — Uses Graphify, codebase memory, narrow source confirmation, documentation and Git history to return concise evidence for unfamiliar areas without dumping files into the manager context.
- **`persistence`** — Owns persisted JSON, LOCALAPPDATA storage, migrations, atomic writes, corruption recovery, unknown-field preservation, import/export and old-data compatibility.
- **`performance`** — Analyzes workload concurrency, scheduling, backpressure, memory pressure, cancellation and large-workflow regressions without hardcoding host CPU or RAM assumptions.
- **`release`** — Owns build, packaging, bundled Chromium, offline validation, dependency manifests, signing procedure, source hygiene, NSIS/portable artifacts and packaged-runtime evidence.
- **`project-state`** — Reconciles CURRENT_STATE, HANDOFF, TASK_LOG, KNOWN_ISSUES, DEFECTS, Beads, validation ledger, assignments, verifier registry and roadmap sources without editing derived status to fake progress.

## Write-lease order

One writer at a time, so a multi-domain task is a SEQUENCE of leases. Contracts settle before
the code consuming them; QA writes the proof once the behavior exists.

```text
persistence -> security -> runtime -> recorder -> frontend -> software -> qa -> release -> project-state -> manager
```

## Path map

The basis for BOTH lease scoping and derived classification. `Implies` lists only flags that are
true *whenever* the path is touched — editing the renderer proves it changed, never that the
change was visual. First match wins, so narrower paths come first.

| Path | Owner | Implies | Note |
| --- | --- | --- | --- |
| `app/main/ipc/**` | `runtime` | `electron_main_change`, `ipc_change` | Every renderer-visible channel lives here; touching it is by definition an IPC change. |
| `app/main/preload.ts` | `runtime` | `ipc_change`, `public_contract_change` | The window.playwrightFlowStudio surface — an internal contract other layers compile against. |
| `src/licensing/**` | `security` | `licensing_change` | Licensing is automatically Risk 3. |
| `src/auth/**` | `security` | `auth_change` | Authentication. |
| `src/secrets/**` | `security` | `secret_handling_change` | Secret storage and redaction. |
| `src/security/**` | `security` | `authorization_change` | Permissions registry and trust boundaries. |
| `src/session/**` | `recorder` | `browser_behavior_change` | Session capture and reuse; protected-login handoff lands here. |
| `src/recorder/**` | `recorder` | `recorder_change` | Recorder capture and locator synthesis. |
| `src/runner/**` | `runtime` | `runner_change`, `execution_change` | Playwright execution path. |
| `src/orchestrator/**` | `runtime` | `execution_change` | Not `src/orchestration` — that directory does not exist. |
| `src/instances/**` | `runtime` | `execution_change` | Live instance model behind the Instance Monitor. |
| `src/storage/**` | `persistence` | `filesystem_write_change` | Atomic writes and the profile stores. |
| `src/profiles/**` | `persistence` | `filesystem_write_change` | JSON profile shapes; unknown-field preservation lives or dies here. |
| `src/data/**` | `persistence` | `filesystem_write_change` | Data sources and row-driven inputs. |
| `src/project/**` | `persistence` | `filesystem_write_change` | Project-level persisted state. |
| `src/oracle/**` | `runtime` | `execution_change`, `authorization_change` | Oracle SQL policy is a duplicated read-only trust gate in the execution boundary. |
| `oracle-jdbc-bridge/**` | `runtime` | `execution_change`, `authorization_change`, `offline_boundary_change` | The shipped JDBC bridge crosses both the SQL trust boundary and the offline runtime. |
| `native-hosts/**` | `runtime` | `execution_change`, `authorization_change`, `offline_boundary_change` | Bundled native hosts execute outside Electron and are part of the shipped trust boundary. |
| `tools/license-issuer/**` | `security` | `licensing_change`, `signing_change`, `secret_handling_change` | License issuance and signing-key custody are security-owned Risk 3 surfaces. |
| `.env.example` | `security` | `secret_handling_change`, `authorization_change` | The public secret-key inventory is a trust-boundary contract even though values are placeholders. |
| `src/testing/**` | `qa` | — | Test-only helpers that ship in src for reuse by verifiers. |
| `src/branding/**` | `software` | `general_engineering_change` | General product module; use a narrower specialist when the task crosses its boundary. |
| `src/logging/**` | `software` | `general_engineering_change` | General product module; use a narrower specialist when the task crosses its boundary. |
| `src/reports/**` | `software` | `general_engineering_change` | General product module; use a narrower specialist when the task crosses its boundary. |
| `src/roadmap/**` | `software` | `general_engineering_change` | General product module; use a narrower specialist when the task crosses its boundary. |
| `src/semantic/**` | `software` | `general_engineering_change` | General product module; use a narrower specialist when the task crosses its boundary. |
| `src/theme/**` | `software` | `general_engineering_change` | General product module; use a narrower specialist when the task crosses its boundary. |
| `src/utils/**` | `software` | `general_engineering_change` | General product module; use a narrower specialist when the task crosses its boundary. |
| `src/validation/**` | `software` | `general_engineering_change` | General product module; use a narrower specialist when the task crosses its boundary. |
| `app/renderer/**` | `frontend` | — | Renderer. Visual/interaction/accessibility intent is not path-determinable — declare it. |
| `logos/**` | `frontend` | `renderer_visual_change` | Renderer reference imagery and visual evidence tooling. |
| `UI Samples/**` | `frontend` | `renderer_visual_change` | Renderer reference imagery and visual evidence tooling. |
| `ui-mock.html` | `frontend` | `renderer_visual_change` | Renderer reference imagery and visual evidence tooling. |
| `capture-dribbble.mjs` | `frontend` | `renderer_visual_change` | Renderer reference imagery and visual evidence tooling. |
| `get-videos.mjs` | `frontend` | `renderer_visual_change` | Renderer reference imagery and visual evidence tooling. |
| `app/main/**` | `runtime` | `electron_main_change` | Electron main process. |
| `tests/**` | `qa` | — | Test suites. |
| `mock-site/**` | `qa` | `mock_site_required` | The Feature Test Lab. |
| `scripts/verify-*` | `qa` | — | Verifiers. A new one must be registered in scripts/lib/verifier-classification.ts. |
| `scripts/validate-*` | `qa` | — | Validators, same registration rule. |
| `scripts/benchmark-*` | `qa` | `performance_change` | Performance evidence stays independent from the implementation it measures. |
| `scripts/benchmark/**` | `qa` | — | Focused test, measurement or fixture infrastructure owned independently by QA. |
| `scripts/helpers/**` | `qa` | — | Focused test, measurement or fixture infrastructure owned independently by QA. |
| `scripts/measure-*` | `qa` | — | Focused test, measurement or fixture infrastructure owned independently by QA. |
| `scripts/random-test-lab.mts` | `qa` | — | Focused test, measurement or fixture infrastructure owned independently by QA. |
| `scripts/seed-*` | `qa` | — | Focused test, measurement or fixture infrastructure owned independently by QA. |
| `scripts/capture-*` | `qa` | — | Focused test, measurement or fixture infrastructure owned independently by QA. |
| `scripts/write-test-root-manifest.mjs` | `qa` | — | Focused test, measurement or fixture infrastructure owned independently by QA. |
| `playwright.config.ts` | `qa` | — | End-to-end and rendered-GUI verification infrastructure. |
| `specs/e2e/**` | `qa` | — | End-to-end and rendered-GUI verification infrastructure. |
| `scripts/lib/e2e-qa-lib.mjs` | `qa` | — | End-to-end and rendered-GUI verification infrastructure. |
| `scripts/lib/gui-verify-harness.mjs` | `qa` | — | End-to-end and rendered-GUI verification infrastructure. |
| `scripts/lib/legacy-gui-verifier-coverage.mjs` | `qa` | — | End-to-end and rendered-GUI verification infrastructure. |
| `scripts/lib/loop-capsule-visual-oracle.mjs` | `qa` | — | End-to-end and rendered-GUI verification infrastructure. |
| `scripts/lib/selfSignedCertificate.mts` | `qa` | — | End-to-end and rendered-GUI verification infrastructure. |
| `scripts/lib/test-lab-packaging-policy.ts` | `qa` | — | End-to-end and rendered-GUI verification infrastructure. |
| `scripts/lib/verify-flow-loop-capsule-gui.mjs` | `qa` | — | End-to-end and rendered-GUI verification infrastructure. |
| `scripts/lib/verify-workflow-loop-capsule-gui.mjs` | `qa` | — | End-to-end and rendered-GUI verification infrastructure. |
| `scripts/lib/latency-histogram.mts` | `qa` | `performance_change` | Performance measurement evidence stays independent from product implementation. |
| `scripts/lib/rss-trend.mts` | `qa` | `performance_change` | Performance measurement evidence stays independent from product implementation. |
| `scripts/oracle/**` | `runtime` | `execution_change`, `authorization_change`, `offline_boundary_change` | Runtime preparation and native bridge tooling crosses the shipped execution boundary. |
| `scripts/prepare-oracle-runtime.mjs` | `runtime` | `execution_change`, `authorization_change`, `offline_boundary_change` | Runtime preparation and native bridge tooling crosses the shipped execution boundary. |
| `scripts/prepare-zvec-native-host.mjs` | `runtime` | `execution_change`, `authorization_change`, `offline_boundary_change` | Runtime preparation and native bridge tooling crosses the shipped execution boundary. |
| `scripts/zvec-harness/**` | `runtime` | `execution_change`, `authorization_change`, `offline_boundary_change` | Runtime preparation and native bridge tooling crosses the shipped execution boundary. |
| `scripts/zvec-spike/**` | `runtime` | `execution_change`, `authorization_change`, `offline_boundary_change` | Runtime preparation and native bridge tooling crosses the shipped execution boundary. |
| `build/**` | `release` | `packaging_change` | Packaging inputs. |
| `resources/**` | `release` | `packaging_change`, `offline_boundary_change` | Shipped resources. Never a runtime write target. |
| `src/offline/**` | `release` | `offline_boundary_change` | Offline-boundary verification and shipped-runtime guarantees. |
| `package.json` | `release` | `packaging_change` | Script inventory and dependencies. A dependency edit is also new_dependency. |
| `package-lock.json` | `release` | `packaging_change`, `new_dependency` | The lockfile only moves when the dependency graph moves. |
| `electron-builder*` | `release` | `packaging_change` | Installer and portable build configuration. |
| `.github/workflows/**` | `release` | `packaging_change`, `offline_boundary_change` | Packaging, signing and clean-machine evidence tooling belongs to the release boundary. |
| `.gitattributes` | `release` | `packaging_change`, `offline_boundary_change` | Packaging, signing and clean-machine evidence tooling belongs to the release boundary. |
| `.gitignore` | `release` | `packaging_change`, `offline_boundary_change` | Packaging, signing and clean-machine evidence tooling belongs to the release boundary. |
| `.npmrc` | `release` | `packaging_change`, `offline_boundary_change` | Packaging, signing and clean-machine evidence tooling belongs to the release boundary. |
| `electron.vite*.ts` | `release` | `packaging_change`, `offline_boundary_change` | Packaging, signing and clean-machine evidence tooling belongs to the release boundary. |
| `vite.config.ts` | `release` | `packaging_change`, `offline_boundary_change` | Packaging, signing and clean-machine evidence tooling belongs to the release boundary. |
| `tsconfig.json` | `release` | `packaging_change`, `offline_boundary_change` | Packaging, signing and clean-machine evidence tooling belongs to the release boundary. |
| `tsconfig.scripts.json` | `release` | `packaging_change`, `offline_boundary_change` | Packaging, signing and clean-machine evidence tooling belongs to the release boundary. |
| `scripts/build-*` | `release` | `packaging_change`, `offline_boundary_change` | Packaging, signing and clean-machine evidence tooling belongs to the release boundary. |
| `scripts/build.ps1` | `release` | `packaging_change`, `offline_boundary_change` | Packaging, signing and clean-machine evidence tooling belongs to the release boundary. |
| `scripts/clean-machine/**` | `release` | `packaging_change`, `offline_boundary_change` | Packaging, signing and clean-machine evidence tooling belongs to the release boundary. |
| `scripts/compare-offline-payloads.mjs` | `release` | `packaging_change`, `offline_boundary_change` | Packaging, signing and clean-machine evidence tooling belongs to the release boundary. |
| `scripts/dev.mjs` | `release` | `packaging_change`, `offline_boundary_change` | Packaging, signing and clean-machine evidence tooling belongs to the release boundary. |
| `scripts/dev.ps1` | `release` | `packaging_change`, `offline_boundary_change` | Packaging, signing and clean-machine evidence tooling belongs to the release boundary. |
| `scripts/generate-app-icon.mjs` | `release` | `packaging_change`, `offline_boundary_change` | Packaging, signing and clean-machine evidence tooling belongs to the release boundary. |
| `scripts/generate-dependency-manifest.ps1` | `release` | `packaging_change`, `offline_boundary_change` | Packaging, signing and clean-machine evidence tooling belongs to the release boundary. |
| `scripts/lib/clean-machine-validation-policy.ts` | `release` | `packaging_change`, `offline_boundary_change` | Packaging, signing and clean-machine evidence tooling belongs to the release boundary. |
| `scripts/lib/nsis-per-user-install.ps1` | `release` | `packaging_change`, `offline_boundary_change` | Packaging, signing and clean-machine evidence tooling belongs to the release boundary. |
| `scripts/lib/offline-browser-integrity.ps1` | `release` | `packaging_change`, `offline_boundary_change` | Packaging, signing and clean-machine evidence tooling belongs to the release boundary. |
| `scripts/lib/release-key-custody.*` | `release` | `packaging_change`, `offline_boundary_change` | Packaging, signing and clean-machine evidence tooling belongs to the release boundary. |
| `scripts/offline-manifest-signature.mjs` | `release` | `packaging_change`, `offline_boundary_change` | Packaging, signing and clean-machine evidence tooling belongs to the release boundary. |
| `scripts/package-*` | `release` | `packaging_change`, `offline_boundary_change` | Packaging, signing and clean-machine evidence tooling belongs to the release boundary. |
| `scripts/prepare-offline-deps.ps1` | `release` | `packaging_change`, `offline_boundary_change` | Packaging, signing and clean-machine evidence tooling belongs to the release boundary. |
| `scripts/release-*` | `release` | `packaging_change`, `offline_boundary_change` | Packaging, signing and clean-machine evidence tooling belongs to the release boundary. |
| `scripts/stage-offline-assets-from.ps1` | `release` | `packaging_change`, `offline_boundary_change` | Packaging, signing and clean-machine evidence tooling belongs to the release boundary. |
| `scripts/write-artifact-provenance.mjs` | `release` | `packaging_change`, `offline_boundary_change` | Packaging, signing and clean-machine evidence tooling belongs to the release boundary. |
| `docs/**` | `project-state` | `project_state_change` | AI memory and governance documents; architectural advice does not confer write ownership. |
| `README.md` | `project-state` | `project_state_change` | Repository status, decision history, planning and specification sources. |
| `IMPLEMENTATION_STATUS.md` | `project-state` | `project_state_change` | Repository status, decision history, planning and specification sources. |
| `CLEAN_MACHINE_VALIDATION_RUNBOOK.md` | `project-state` | `project_state_change` | Repository status, decision history, planning and specification sources. |
| `SESSION_OUTCOMES_CLOSEOUT.md` | `project-state` | `project_state_change` | Repository status, decision history, planning and specification sources. |
| `BROWSER_AUTOMATION_SKILLS_REPORT.md` | `project-state` | `project_state_change` | Repository status, decision history, planning and specification sources. |
| `00_TEMPLATE_REVIEW_FINDINGS.md` | `project-state` | `project_state_change` | Repository status, decision history, planning and specification sources. |
| `change_requests/**` | `project-state` | `project_state_change` | Repository status, decision history, planning and specification sources. |
| `plans/**` | `project-state` | `project_state_change` | Repository status, decision history, planning and specification sources. |
| `playwright_flow_studio_updated_phases/**` | `project-state` | `project_state_change` | Repository status, decision history, planning and specification sources. |
| `tools/roadmap/**` | `project-state` | `project_state_change` | Derived dashboard. Never hand-edited to record progress. |
| `tools/agents/**` | `manager` | `agent_infrastructure_change` | This routing system itself. |
| `.beads/**` | `project-state` | `project_state_change` | Tracker database and its JSONL export. Project State reconciles the source, and the export must be refreshed with `bd export -o .beads/issues.jsonl` before the dashboard reads it. |
| `scripts/lib/verifier-classification.ts` | `project-state` | `project_state_change` | Authoritative verifier registry; new verify and validate commands must be classified. |
| `scripts/ai-memory/**` | `project-state` | `project_state_change` | Project memory and derived status synchronization tooling. |
| `scripts/generate-embedded-roadmap-snapshot.mjs` | `project-state` | `project_state_change` | Project memory and derived status synchronization tooling. |
| `setup-ai-memory.mjs` | `project-state` | `project_state_change` | Project memory and derived status synchronization tooling. |
| `.claude/**` | `manager` | `agent_infrastructure_change` | Claude Code agent/skill/hook configuration. Generated role definitions live here. |
| `.cbmignore` | `manager` | `agent_infrastructure_change` | Cross-agent discovery and local instruction boundaries. |
| `.graphifyignore` | `manager` | `agent_infrastructure_change` | Cross-agent discovery and local instruction boundaries. |
| `scripts/AGENTS.md` | `manager` | `agent_infrastructure_change` | Cross-agent discovery and local instruction boundaries. |
| `src/AGENTS.md` | `manager` | `agent_infrastructure_change` | Cross-agent discovery and local instruction boundaries. |
| `.codex/**` | `manager` | `agent_infrastructure_change` | Codex configuration and skills. |
| `.gemini/**` | `manager` | `agent_infrastructure_change` | Gemini / Antigravity configuration and skills. |
| `.agents/**` | `manager` | `agent_infrastructure_change` | Cross-platform agent rules and skills. |
| `.cursor/**` | `manager` | `agent_infrastructure_change` | Cursor-compatible agent configuration. |
| `AGENTS.md` | `manager` | `agent_infrastructure_change` | Root cross-agent instruction surface. |
| `CLAUDE.md` | `manager` | `agent_infrastructure_change` | Root cross-agent instruction surface. |
| `GEMINI.md` | `manager` | `agent_infrastructure_change` | Root cross-agent instruction surface. |

## Protected paths

No repository path is writable without a lease, except the exact task-contract bootstrap file
that deterministic routing validates before grant. Protected paths are the subset whose implied
flags already make them Risk 3; they require the matching owner and critical review.

**Derived, not hand-listed** — a path is protected when what it implies is already Risk 3.

| Path | Owner | Implies |
| --- | --- | --- |
| `src/licensing/**` | `security` | `licensing_change` |
| `src/auth/**` | `security` | `auth_change` |
| `src/secrets/**` | `security` | `secret_handling_change` |
| `src/security/**` | `security` | `authorization_change` |
| `src/oracle/**` | `runtime` | `execution_change`, `authorization_change` |
| `oracle-jdbc-bridge/**` | `runtime` | `execution_change`, `authorization_change`, `offline_boundary_change` |
| `native-hosts/**` | `runtime` | `execution_change`, `authorization_change`, `offline_boundary_change` |
| `tools/license-issuer/**` | `security` | `licensing_change`, `signing_change`, `secret_handling_change` |
| `.env.example` | `security` | `secret_handling_change`, `authorization_change` |
| `scripts/oracle/**` | `runtime` | `execution_change`, `authorization_change`, `offline_boundary_change` |
| `scripts/prepare-oracle-runtime.mjs` | `runtime` | `execution_change`, `authorization_change`, `offline_boundary_change` |
| `scripts/prepare-zvec-native-host.mjs` | `runtime` | `execution_change`, `authorization_change`, `offline_boundary_change` |
| `scripts/zvec-harness/**` | `runtime` | `execution_change`, `authorization_change`, `offline_boundary_change` |
| `scripts/zvec-spike/**` | `runtime` | `execution_change`, `authorization_change`, `offline_boundary_change` |
| `resources/**` | `release` | `packaging_change`, `offline_boundary_change` |
| `src/offline/**` | `release` | `offline_boundary_change` |
| `.github/workflows/**` | `release` | `packaging_change`, `offline_boundary_change` |
| `.gitattributes` | `release` | `packaging_change`, `offline_boundary_change` |
| `.gitignore` | `release` | `packaging_change`, `offline_boundary_change` |
| `.npmrc` | `release` | `packaging_change`, `offline_boundary_change` |
| `electron.vite*.ts` | `release` | `packaging_change`, `offline_boundary_change` |
| `vite.config.ts` | `release` | `packaging_change`, `offline_boundary_change` |
| `tsconfig.json` | `release` | `packaging_change`, `offline_boundary_change` |
| `tsconfig.scripts.json` | `release` | `packaging_change`, `offline_boundary_change` |
| `scripts/build-*` | `release` | `packaging_change`, `offline_boundary_change` |
| `scripts/build.ps1` | `release` | `packaging_change`, `offline_boundary_change` |
| `scripts/clean-machine/**` | `release` | `packaging_change`, `offline_boundary_change` |
| `scripts/compare-offline-payloads.mjs` | `release` | `packaging_change`, `offline_boundary_change` |
| `scripts/dev.mjs` | `release` | `packaging_change`, `offline_boundary_change` |
| `scripts/dev.ps1` | `release` | `packaging_change`, `offline_boundary_change` |
| `scripts/generate-app-icon.mjs` | `release` | `packaging_change`, `offline_boundary_change` |
| `scripts/generate-dependency-manifest.ps1` | `release` | `packaging_change`, `offline_boundary_change` |
| `scripts/lib/clean-machine-validation-policy.ts` | `release` | `packaging_change`, `offline_boundary_change` |
| `scripts/lib/nsis-per-user-install.ps1` | `release` | `packaging_change`, `offline_boundary_change` |
| `scripts/lib/offline-browser-integrity.ps1` | `release` | `packaging_change`, `offline_boundary_change` |
| `scripts/lib/release-key-custody.*` | `release` | `packaging_change`, `offline_boundary_change` |
| `scripts/offline-manifest-signature.mjs` | `release` | `packaging_change`, `offline_boundary_change` |
| `scripts/package-*` | `release` | `packaging_change`, `offline_boundary_change` |
| `scripts/prepare-offline-deps.ps1` | `release` | `packaging_change`, `offline_boundary_change` |
| `scripts/release-*` | `release` | `packaging_change`, `offline_boundary_change` |
| `scripts/stage-offline-assets-from.ps1` | `release` | `packaging_change`, `offline_boundary_change` |
| `scripts/write-artifact-provenance.mjs` | `release` | `packaging_change`, `offline_boundary_change` |

## Watched ignored paths

`git status` never reports gitignored files, and enumerating them all is impossible — `node_modules/`
alone would make the audit unusable. Most of what is ignored genuinely does not matter: `out/`,
`dist/`, `graphify-out/` and the logs are derived artifacts.

These are the exceptions — ignored, but consequential — fingerprinted by metadata at lease
grant and compared after every shell command. This is bounded tamper detection, not a cryptographic
attestation of large bundled directories; final release validation remains authoritative.

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
| `software` | `general_engineering_change`<br>or a expected path it owns is touched | Handles scoped product modules that have no narrower implementation owner. |
| `runtime` | `electron_main_change` or `ipc_change` or `runner_change` or `execution_change` or `concurrency_change`<br>or a expected path it owns is touched | Owns the main process and the execution path. |
| `integration` | `ipc_change` or `public_contract_change` | Reviews contracts that cross renderer, preload, main, browser and runtime boundaries. |
| `recorder` | `playwright_change` or `recorder_change` or `browser_behavior_change` or `mock_site_required`<br>or a expected path it owns is touched | Real browser and recorder behavior requires Playwright-specific evidence. |
| `security` | `licensing_change` or `auth_change` or `authorization_change` or `secret_handling_change` or `protected_login_change` or `signing_change`<br>or a expected path it owns is touched | Trust boundaries are reviewed, never assumed. |
| `researcher` | `broad_investigation` | Unfamiliar problems begin with one concise, reusable discovery report. |
| `persistence` | `persisted_shape_change` or `migration_required` or `filesystem_write_change`<br>or a expected path it owns is touched | A persisted shape that changes without this agent is how unknown fields get dropped. |
| `performance` | `performance_change` or `concurrency_change` | Performance and concurrency claims need workload, pressure and backpressure analysis. |
| `release` | `packaging_change` or `offline_boundary_change` or `signing_change` or `new_dependency`<br>or a expected path it owns is touched | Offline-first is a release property; a dependency is a packaging decision. |
| `project-state` | `project_state_change`<br>or a expected path it owns is touched | Repository status is reconciled in authoritative sources, never in derived dashboard output. |
| `architect` | `public_contract_change` or `migration_required` or `new_dependency` or `concurrency_change` or `licensing_change`<br>or `cross_layer_count >= 3` | Cross-layer contracts and schema evolution need a designer, not three local decisions. |
| `qa` | `risk_level >= 1`<br>or a expected path it owns is touched | Anything above documentation must state how it is proven. |
| `qc` | `licensing_change` or `auth_change` or `authorization_change` or `secret_handling_change` or `signing_change` or `migration_required` or `concurrency_change` or `packaging_change`<br>or `risk_level >= 2`<br>or `cross_layer_count >= 2` | Independent review of whether the evidence proves the requested result. |

## Risk levels

Risk is computed, never chosen. A contract may declare a HIGHER level than computed; never lower.

**Risk 3 — critical.** Any of: `licensing_change`, `auth_change`, `authorization_change`, `secret_handling_change`, `protected_login_change`, `signing_change`, `migration_required`, `concurrency_change`, `offline_boundary_change`.

**Risk 2 — cross-layer.** Any of: `electron_main_change`, `ipc_change`, `runner_change`, `execution_change`, `persisted_shape_change`, `filesystem_write_change`, `packaging_change`, `public_contract_change`, `new_dependency`, or `cross_layer_count >= 3`.

**Risk 1 — localized.** Any of: `renderer_visual_change`, `interaction_change`, `accessibility_change`, `general_engineering_change`, `playwright_change`, `recorder_change`, `browser_behavior_change`, `mock_site_required`, `performance_change`, `agent_infrastructure_change`, or `cross_layer_count >= 2`.

**Risk 0 — documentation.** Nothing above applies.

Note that `packaging_change` alone is Risk 2, not Risk 3. Packaging reaches critical through
`signing_change`, `offline_boundary_change` or `new_dependency` — the properties that actually
carry trust.

## Classification flags

Routing reads only these. An unknown key is rejected, never ignored.

- `renderer_visual_change`
- `interaction_change`
- `accessibility_change`
- `general_engineering_change`
- `electron_main_change`
- `ipc_change`
- `runner_change`
- `execution_change`
- `concurrency_change`
- `performance_change`
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
- `broad_investigation`
- `project_state_change`
- `agent_infrastructure_change`
- `cross_layer_count` (integer >= 1)

## Evidence vocabulary

Copied from the validation ledger's own `LEDGER_STATUSES`, not invented. `verify:agent-routing`
asserts the two still match.

```text
PASS | FAIL | BLOCKED | NOT RUN | NOT APPLICABLE
```

`BLOCKED`, `NOT RUN` and `FAIL` are not `PASS`. An inconclusive check is `NOT RUN` with a reason —
there is no separate `INCONCLUSIVE` state, and no underscored `NOT_RUN` variant.

