# TESTING

## Confirmed

### Frameworks present
- `@playwright/test` (devDependency) — config `playwright.config.ts` (`testDir: "tests"`).
- `tsx` (devDependency) — used to run the standalone runner verification script on Node 18.

### What exists
- `tests/runner.mocksite.spec.ts` — Playwright test exercising the runner against the mock site.
- `scripts/verify-runner.mts` — standalone live verification (run via `npm run verify:runner`)
  that drives `StepExecutor` / `FlowExecutor` / `PlaywrightRunner` against `mock-site/` with a real
  Chromium. As of the last run: **76 checks pass** (node types, loop, runFlow + recursion guard,
  Protected Login Handoff pause/resume, manual handoff in-place resume, workflow runtime connector-structure validation,
  **Route Change** [opens a new tab, switches the active page, fills/clicks/asserts on it], **Save Session**
  [writes storageState; fails on missing name / no-overwrite collision], flow-level and workflow-level
  connector routing).
- `mock-site/server.mjs` — offline test website (login → form → success; `/details` opened via the form's
  `#openNewTabButton` for Route Change testing), default port 4321.
- `scripts/verify-protected-login.mts` (`npm run verify:protected-login`) — pure unit checks for the
  protected-login detector (provider URLs, Google insecure-browser page, MFA/CAPTCHA text, no false
  positives, no secret fields). As of the last run: **16 checks pass**. `verify:runner` also covers the
  Protected Login Handoff node pausing/resuming and auto-detect not pausing normal mock pages (76 total).
- `scripts/verify-recorder-locator.mts` (`npm run verify:recorder`) — live Chromium checks for recorder
  locator generation, runner locator safeguards/fallbacks, and Smart Wait recorder observation
  (safe fetch/XHR path-only signals, loader disappearance, URL changes, table/list/card waits, toast,
  enabled controls, polling ignored, fixed-delay fallback). As of the last run: **57 checks pass**.
- `scripts/verify-recorder-draft.mts` (`npm run verify:recorder-draft`) — browser-free recorder draft,
  URL-history, legacy wait-time, and smart-wait compatibility checks. As of the last run: **17 checks pass**.
- `scripts/verify-waits.mts` (`npm run verify:waits`) — Smart Wait runner checks for before/after waits,
  armed response waits, loader/element/table/list/URL/DOM/fixed-delay waits, and failure diagnostics
  (phase, sanitized URL, reason, suggestion). As of the last run: **18 checks pass**.
- `scripts/verify-flow-designer-gui.mjs` (`npm run verify:flow-designer`) — real Electron GUI walkthrough
  for Flow Designer connector behavior and saved-flow dropdown behavior. As of the last run: **19 checks
  pass**.
- `scripts/seed-mock-fixtures.mjs` (`npm run seed:mock-fixtures`) — imports test-only mock
  flows/workflows/data source into the runtime userData folders for manual GUI testing against the
  mock site. Sources live in `resources/test-fixtures/mock-site/` (see its README); they never
  auto-load and are excluded from packaged builds.

### How to verify
```bash
npm run build            # primary gate: tsc --noEmit + electron-vite bundles
npm run verify:runner    # live runner checks vs the mock site (tsx)
npm run verify:waits     # Smart Wait runner checks and diagnostics
npm run validate:offline # offline bundle validation (for packaging/offline changes)

# Manual UI fixtures (optional, for exercising the designer/builder by hand):
npm run mock-site            # terminal 1
npm run seed:mock-fixtures   # terminal 2 — seeds Mock — flows/workflows/data source
npm run dev                  # open the app; the mock fixtures appear in the tables
```

### Important caveats
- **No `lint` and no `test` npm script.** Don't assume `npm test` exists.
- The **`@playwright/test` runner** fails to load the TS/ESM config on **Node 18.16**
  (`Unknown file extension ".ts"`); it needs **Node ≥18.19/20**. On older Node, use
  `npm run verify:runner` (tsx works on Node 18).

## Required test behavior for future changes
- After changing runner/orchestrator/connector/node-execution logic, run `npm run verify:runner`
  and report the pass count; extend `scripts/verify-runner.mts` (and `tests/runner.mocksite.spec.ts`)
  with a case for the new behavior.
- After offline/packaging changes, run `npm run validate:offline` (the package scripts run it in
  `-Strict` mode).
- Always run `npm run build` before declaring done.

## Manual verification checklist
- For UI changes: run `npm run dev` and exercise the affected screen.
- For offline/packaging: the **clean-machine GUI walkthrough** in
  `docs/OFFLINE_STANDALONE_PACKAGING.md` (offline Windows VM) — the production-ready gate.

## Known test gaps
- No coverage for Form Designer, Runtime Inputs, Data Source Manager UI flows.
- Limited automated renderer GUI coverage exists for the Flow Designer / Workflow Builder connector
  walkthroughs; most renderer screens still require manual verification.
- Concurrency/worker isolation is not load-tested.
- The Concurrent Instance Monitor workflow-cards **non-DOM logic** (search filter, responsive
  visible-card-count, per-card validation, workflow-name resolution) is unit-verified by
  `npm run verify:instance-monitor` (22 checks, pure functions in `src/instances/instanceCardLogic.ts`).
  The **DOM/Electron behavior** (hover/focus cross-fade with no card-height change, equal-height cards,
  full-width search + Load More, stable 3-per-row grid across Load More, live multi-workflow concurrency, Workflow
  column with real runs) still has no automated test — verify manually via `npm run dev` (seed with
  `npm run seed:mock-fixtures`, run two cards, confirm both appear with correct workflow names). See the
  GUI checklist in `docs/OFFLINE_STANDALONE_PACKAGING.md`.

## Unknown / Needs Verification
- Whether `tests/*.spec.ts` is run in any CI (no CI config detected in the repo).
