# Mock-site test fixtures (TEST-ONLY)

Predefined flows, workflows, and a data source that target the offline **mock-site**
(`npm run mock-site`, default `http://localhost:4321`). They exercise a wide range of
node types and connector behaviors for local testing.

> **These are not default/production data.** Nothing here loads on app startup, and a fresh
> install still shows empty Flows/Workflows/Data Sources. They are excluded from packaged
> builds (`electron-builder.json` → `!test-fixtures/**`). All ids are prefixed `mock-` and
> names start with "Mock —".

## How to use

```bash
npm run mock-site          # start the offline mock website (terminal 1)
npm run seed:mock-fixtures # import these fixtures into the local runtime userData folders (terminal 2)
npm run dev                # open WebFlow Studio; the Mock — flows/workflows/data source appear
```

`seed:mock-fixtures` is explicit and dev-only. It writes:
- flows  → `%LOCALAPPDATA%/WebFlow Studio/flows/`
- workflows → `%LOCALAPPDATA%/WebFlow Studio/workflows/`
- data source → `%LOCALAPPDATA%/WebFlow Studio/data/` (+ data file under `data/files/`)

(or the custom paths configured in Settings → Paths). Re-running is idempotent.

## Contents

**Flows** (`flows/`): login, fill-form, screenshot, scroll, upload, wait, loop (fixed count),
conditional branch, run-another-flow, assertion-failure + failure-edge recovery, and
route-change (opens `/details` in a new tab, switches the active page, fills + asserts).

**Workflows** (`workflows/`): simple (login → form → screenshot), failure-handling
(failing assertion → failure connector → recovery), data-driven (bound to Mock Users), and
route-change (login → route-change flow).

**Data source** (`data-sources/mock-users.json`): array of user records matching the mock
form fields (`username`, `password`, `firstName`, `lastName`, `email`, `country`, `accountType`).

## Notes
- The upload flow points `#attachment` at `package.json` as a placeholder — edit to a real file.
- The mock site has no download endpoint, so no download fixture is included.
- Selectors use stable ids/roles from the mock site (`/login`, `/form`, `/success`).
