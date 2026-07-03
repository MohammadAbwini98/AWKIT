# Mock Test Website

A small offline website for exercising every AWTKIT automation feature
(open URL, fill, click, select, checkbox, radio, textarea, file upload, submit,
read text, assert). It is a **development / test utility** built on Node's
built-in `http` module — no extra dependencies, no internet required.

## Start it

```bash
npm run mock-site
```

Then open `http://localhost:4321/login`. Change the port with `MOCK_SITE_PORT`.

## URLs

| URL | Purpose |
| --- | --- |
| `http://localhost:4321/login` | Login page (any non-empty username/password) |
| `http://localhost:4321/form` | Full form with every input type |
| `http://localhost:4321/success?id=…` | Result page with submitted values |

After a successful login the site navigates to `/form`. Submitting the form
navigates to `/success` and shows the submitted values with stable IDs.

## Test credentials

Any non-empty `username` + `password` is accepted (e.g. `user1` / `pass1`).

## Element ID reference

**Login** — `username`, `password`, `rememberMe`, `loginButton`

**Form** — `firstName`, `lastName`, `email`, `password`, `age`, `salary`,
`birthDate`, `country`, `accountType`, `skills`, `description`, `gender`
(`genderMale` / `genderFemale`), `interestAutomation`, `interestTesting`,
`acceptTerms`, `attachment`, `submitButton`, `resetButton`

**Success** — `successMessage`, `submissionId`, `submittedFirstName`,
`submittedLastName`, `submittedEmail`, `submittedCountry`, `submittedAccountType`

## Using it with AWTKIT flows

1. Start the mock site (`npm run mock-site`).
2. In **Data Sources**, add `resources/sample-data/mock-customers.json`
   (root array path `$`).
3. In **Workflow Builder**, set the workflow data source to that file.
4. In **Flow Designer**, set node value sources to **Dynamic**:
   - `Object ID Mode = Instance order ID` so instance #1 → id 1, #2 → id 2, …
   - `Key Name = firstName` / `email` / `country`, etc.
5. Build a flow: open `http://localhost:4321/login` → fill `username`/`password`
   → click `loginButton` → fill the form fields from the data source → click
   `submitButton` → assert `successMessage`.

## Concurrent instance-order testing

`mock-customers.json` contains objects with `id` 1, 2, 3. With dynamic
`instanceOrder` binding, instance #1 resolves id 1, instance #2 resolves id 2,
and instance #3 resolves id 3 — letting you verify per-instance data isolation.
