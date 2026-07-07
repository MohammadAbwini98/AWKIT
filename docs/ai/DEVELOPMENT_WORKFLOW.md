# DEVELOPMENT_WORKFLOW

How AI agents should work in this repository.

## 1. Start — load context
- Read `AGENTS.md`, then follow its required-reading order: `docs/ai/PROJECT_BRIEF.md`,
  `CURRENT_STATE.md`, `HANDOFF.md`, `ARCHITECTURE.md`, `RULES.md`, `COMMANDS.md`, plus
  `KNOWN_ISSUES.md` / `TESTING.md` / `SECURITY.md` as relevant.
- Read any **local `AGENTS.md`** in folders you will modify (these add folder-specific rules and
  take precedence within their folder; they must not contradict the root rules). Local files exist at:
  `app/main/AGENTS.md`, `app/renderer/AGENTS.md`, `src/AGENTS.md`, `scripts/AGENTS.md`,
  `tests/AGENTS.md`, `docs/AGENTS.md`.

## 2. Inspect before editing
- Use search/read tools on the actual files — code evolves between tasks; don't rely on memory.
- Identify the IPC method(s), profile schema(s), and UI screen(s) involved. The renderer talks to
  main only via `window.playwrightFlowStudio.*`.

## 3. Make safe changes
- Minimal, scoped diffs; match existing patterns; no unrelated refactors; no renaming internal
  identifiers (`window.playwrightFlowStudio`).
- Reuse shared canvas helpers instead of duplicating: connector visuals via
  `components/shared/connectorStyle.ts` (`buildConnectorVisual`), the connector style UI
  (`ConnectorStyleEditor`), and long dropdowns (`SearchableSelect`) — both designers depend on these.
- Respect offline-first and storage rules in `RULES.md`.
- Never add login-protection bypass (CAPTCHA/MFA/bot-detection/stealth) — protected logins must use the
  Protected Login Handoff (detect + pause). See `docs/PROTECTED_LOGIN_HANDOFF.md` and `SECURITY.md`.
- Treat `mock-site/` as the local Feature Test Lab. For Recorder, Runner, Smart Wait, Flow Designer,
  Workflow Builder, Instance Monitor, locator, node, wait, or execution features, decide whether an
  existing scenario needs to be updated before adding separate fixtures.
- For large/risky changes (runner, orchestrator, packaging, settings schema, IPC), plan first
  (Claude Code: use plan mode).

## 4. Verify
- Always: `npm run build` (typecheck + bundles).
- Runner/connector/node changes: `npm run verify:runner` (report pass count; add a case for new behavior).
- Mock Site changes: `npm run verify:mock-site` plus the related feature verifier.
- Instance Monitor card-logic changes: `npm run verify:instance-monitor` (pure functions in
  `src/instances/instanceCardLogic.ts`).
- Offline/packaging changes: `npm run validate:offline` (and repackage if needed).
- UI changes: `npm run dev` and exercise the screen. To get realistic data for the Flow Designer /
  Workflow Builder, run `npm run mock-site` + `npm run seed:mock-fixtures` first (test-only Mock —
  flows/workflows/data source). Report anything you could not run (e.g. the clean-machine GUI
  walkthrough).

## 5. Update memory (every task)
- Update `docs/ai/CURRENT_STATE.md` if state/behavior/commands/architecture changed.
- Update `docs/ai/HANDOFF.md` when work is paused, blocked, or handed to another agent/tool or human.
- Append an entry to `docs/ai/TASK_LOG.md` (date, agent, task, files, tests run/not-run, result).
- Add to `docs/ai/KNOWN_ISSUES.md` for repeated bugs / fragile areas / risky assumptions.
- Update `FEATURES.md` / `ARCHITECTURE.md` / `COMMANDS.md` / `DECISIONS.md` / `TESTING.md` only if
  those actually changed.

## Agent handoff workflow
- Use `docs/ai/HANDOFF.md` as the active transfer note between Claude Code, Codex, Gemini,
  Antigravity, future agents, and human developers.
- `/HANDOFF` prepares the repo for the next agent: inspect current state, update `HANDOFF.md`,
  append `TASK_LOG.md`, update other memory files only when relevant, then run
  `node scripts/ai-memory/check-memory.mjs`.
- `/TAKEOFF` resumes safely: read `HANDOFF.md`, inspect actual repo state before editing, compare the
  handoff against files on disk, then report completed work, remaining work, risks, likely files, and
  verification commands before risky or broad implementation.
- Keep handoffs short and factual. Do not copy secrets, tokens, cookies, passwords, private URLs,
  credentials, or session values into Markdown.

## 6. Finish — report
- Summary of the change; files changed; tests run and not-run (with why); remaining risks or manual
  verification needed.

## Quick reference
- Build/run/test/package commands: `docs/ai/COMMANDS.md`.
- What works / is incomplete: `docs/ai/CURRENT_STATE.md`.
- Module map & data flow: `docs/ai/ARCHITECTURE.md`.
