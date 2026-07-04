# Mock Site - Feature Test Lab

The mock site is AWKIT's local **Feature Test Lab**: a deterministic offline website for Recorder,
Runner, Smart Wait, Flow Designer, Workflow Builder, Instance Monitor, locator, node, wait, and execution
features. It uses Node's built-in `http` module only - no internet and no extra dependencies.

## Start it

```bash
npm run mock-site
```

Open `http://localhost:4321/`. Change the port with `MOCK_SITE_PORT`.

## Scenario URLs

| URL | Related AWKIT feature | Expected behavior |
| --- | --- | --- |
| `/` | Feature Test Lab index | Lists every local scenario with title, description, expected behavior, feature, and stable URL. |
| `/login` | Runner core, Recorder, seeded fixtures | Any non-empty username/password submits to `/form`. |
| `/form` | Runner core nodes, route-change trigger | Full form with stable labels, ids, and test ids; submit navigates to `/success`. |
| `/details` | Route Change node | Opens in a new tab from `/form`; automation must switch context before interacting. |
| `/success?id=...` | Assertions and reports | Shows submitted values with stable ids. |
| `/smart-waits` | Smart Wait Engine, Runner timing, Recorder wait capture | Element appears/disappears, text changes, button enables, loader/content, delayed navigation, modal, toast, delayed API response, sequential waits, intentional failure context, and fast no-wait scenario. |
| `/recorder-lab` | Recorder, locator engine, saved URL history | Accessible form controls, manual pause/countdown, reusable local URLs, linear Start/End flow, and dynamic DOM with stable selectors. |
| `/designer-lab` | Flow Designer, Workflow Builder, Instance Monitor | Canvas-like area, clickable mock nodes, workflow cards grid, stable named flows/workflows, and Smart Wait scenario data examples. |
| `/api/delay?ms=300` | Runner/Smart Wait response waits | Returns local JSON after a bounded deterministic delay. |

## Using it with Recorder

1. Start the site with `npm run mock-site`.
2. Record `http://localhost:4321/recorder-lab` for accessible controls, manual waiting-time capture,
   saved URL reuse, dynamic DOM, and Start -> actions -> End flow validation.
3. Record `http://localhost:4321/smart-waits` for Smart Wait observation signals.
4. Record `http://localhost:4321/login` -> `/form` for the existing core login/form flow.

## Using it with Flow Designer / Workflow Builder

1. Start the mock site.
2. Optionally seed local app fixtures:

   ```bash
   npm run seed:mock-fixtures
   ```

3. Use `/designer-lab` for manual panel/canvas/card scenarios and `/smart-waits` for wait-node or
   Smart Wait scenario data.

## Extending the lab

- Check existing scenarios before creating a new page.
- Prefer extending `/smart-waits`, `/recorder-lab`, or `/designer-lab` instead of duplicating pages.
- Every scenario must have a stable local URL, title, description, expected behavior, related AWKIT
  feature, and stable selectors using role/name, labels, placeholders, and/or `data-testid`.
- Any new page or scenario must be covered by `npm run verify:mock-site` or another focused verifier.
- Keep all behavior deterministic, local-only, and free of external services.

## Verification

```bash
npm run verify:mock-site
```

The verifier starts the mock site on its own port, checks key pages, exercises delay scenarios, and asserts
stable selectors for Recorder and Designer scenarios.
