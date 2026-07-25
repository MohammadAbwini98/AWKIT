# Mock-site test fixtures (TEST-ONLY)

Predefined flows, workflows, and a data source that target the offline **mock-site**
(`npm run mock-site`, default `http://localhost:4321`). They exercise a wide range of
node types and connector behaviors for local testing.

The mock site is the AWKIT **Feature Test Lab**. Before adding new feature-specific fixtures, check the
live scenarios in `mock-site/README.md` and prefer extending existing lab URLs (`/smart-waits`,
`/recorder-lab`, `/designer-lab`, `/login`, `/form`, `/details`) over adding isolated duplicates.

> **These are not default/production data.** Nothing here loads on app startup, and a fresh
> install still shows empty Flows/Workflows/Data Sources. They are excluded from packaged
> builds (`electron-builder.json` → `!test-fixtures/**`). All ids are prefixed `mock-` and
> names start with "Mock —".

## How to use

```bash
npm run mock-site          # start the offline mock website (terminal 1)
npm run seed:mock-fixtures # import these fixtures into the local runtime userData folders (terminal 2)
npm run dev                # open SpecterStudio; the Mock — flows/workflows/data source appear
```

`seed:mock-fixtures` is explicit and dev-only. It writes:
- flows  → `%LOCALAPPDATA%/SpecterStudio/flows/`
- workflows → `%LOCALAPPDATA%/SpecterStudio/workflows/`
- data source → `%LOCALAPPDATA%/SpecterStudio/data/` (+ data file under `data/files/`)

(or the custom paths configured in Settings → Paths). Re-running is idempotent.

## Contents

**Flows** (`flows/`): login, fill-form, screenshot, scroll, upload/download, wait, loop,
conditional branch, structured conditional/parallel/loop connectors, legacy outcome/loop-back
connectors, run-another-flow, assertion-failure + failure-edge recovery, popup lifecycle,
manual/session contracts, a read-only Oracle contract, and route-change.

**Workflows** (`workflows/`): simple (login → form → screenshot), failure-handling
(failing assertion → failure connector → recovery), data-driven (bound to Mock Users), and
route-change (login → route-change flow). `mock-comprehensive-workflow.json` chains the
comprehensive core, cross-flow output consumer, local upload/download, and popup fixtures.

**Data source** (`data-sources/mock-users.json`): array of user records matching the mock
form fields (`username`, `password`, `firstName`, `lastName`, `email`, `country`, `accountType`).
`mock-runtime-values.json` provides deterministic JSON-source values for the comprehensive run.

## Notes
- The upload flow points `#attachment` at `package.json` as a placeholder — edit to a real file.
- The comprehensive I/O flow uses `/runner-lab`, uploads `package.json`, and downloads the
  deterministic `/api/download?type=csv` payload.
- Selectors use stable ids/roles from the mock site (`/login`, `/form`, `/success`).
- `npm run verify:comprehensive-e2e` runs the persisted safe-local campaign and writes a
  machine-readable evidence ledger under `test-artifacts/comprehensive-e2e/`.
