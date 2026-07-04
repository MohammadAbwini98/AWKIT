# Local Agent Rules — `tests`

## Scope
Automated verification of the automation core against the offline `mock-site/`.

## Required reading
Root `AGENTS.md` + `docs/ai/TESTING.md`.

## Local rules
- **Two entry points, one source of truth:** `tests/runner.mocksite.spec.ts` is the `@playwright/test`
  spec; `scripts/verify-runner.mts` is the standalone `tsx` runner. Keep them in sync — when you add
  a runner/connector/node behavior, add a case to **both** (the `tsx` script is what runs in CI-less,
  Node-18 environments).
- **Node version caveat:** `@playwright/test` cannot load the TS/ESM config on Node < 18.19. On such
  environments verify with `npm run verify:runner` instead of `npx playwright test`.
- **Determinism:** drive the local `mock-site` (start it in the test/script, fixed `MOCK_SITE_PORT`);
  do not depend on external/network sites. Clean up browser/context and the spawned server.
- **Feature Test Lab:** before adding feature-specific pages or fixtures, check `mock-site/README.md`
  and prefer extending existing scenarios. New scenarios must be covered by `npm run verify:mock-site`
  or the related feature verifier.
- **Naming/framework:** follow the existing Playwright-test conventions; don't introduce a second
  test framework.
- Use the real runner classes (`StepExecutor`/`FlowExecutor`/`PlaywrightRunner`) via `@src/*` — test
  actual behavior, not reimplementations.

## Testing / verification
- `npm run verify:runner` (must stay green; report the pass count).
- `npm run verify:mock-site` after mock-site scenario changes.

## Do not break
- The mock-site contract that existing checks rely on (login → form → `/success`).
- The Feature Test Lab URLs documented in `mock-site/README.md`.

## Update requirements
- If verification scope changes, update `docs/ai/TESTING.md`; append to `docs/ai/TASK_LOG.md`.
