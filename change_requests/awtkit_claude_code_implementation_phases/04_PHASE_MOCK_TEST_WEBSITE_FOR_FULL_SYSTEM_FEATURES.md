# Phase 04 — Mock Test Website for Full System Feature Testing

## Claude Code Role

You are an expert TypeScript, React/Electron, Playwright, test automation, and mock web app engineer.

Work inside the AWTKIT / Playwright Flow Studio project.

Read `AGENTS.md` before editing.

---

## Objective

Create a simple local mock website that can be used to test all major automation features of AWTKIT.

The mock website should include:

```text
Login page
Form page
All common form element types
Submit button
Success/result page
Predictable IDs and labels
Test data compatibility
```

This website should be easy to run during development and, if needed, from the offline standalone package.

---

## Purpose

The mock website will be used to verify:

```text
Open URL node
Click node
Fill text node
Fill email/password/number nodes
Checkbox node
Radio button node
Dropdown select node
Textarea node
File upload node
Submit button node
Assertion node
Read text node
Screenshot node
Dynamic JSON value source
Instance order dynamic ID
Concurrent workflow runs
```

---

## Recommended Location

Add a folder:

```text
mock-site/
```

Suggested structure:

```text
mock-site/
├── package.json
├── README.md
├── server.ts
├── public/
│   ├── index.html
│   ├── login.html
│   ├── form.html
│   ├── success.html
│   └── styles.css
└── data/
    └── submissions.json
```

Alternative if project already has Vite/Express infrastructure:

```text
src/mock-site/
```

Use the simplest maintainable approach that matches the existing project.

---

## Technical Requirement

The mock site should run locally.

Recommended:

```text
Node.js + Express
```

Development command example:

```bash
npm run mock-site
```

Or from root:

```bash
npm run dev:mock-site
```

If the project prefers one package.json, add scripts in root package.json.

---

## Pages Required

## 1. Login Page

URL:

```text
http://localhost:PORT/login
```

Fields:

```text
Username
Password
Remember Me checkbox
Login button
```

Element IDs:

```html
<input id="username" name="username" />
<input id="password" name="password" type="password" />
<input id="rememberMe" name="rememberMe" type="checkbox" />
<button id="loginButton">Login</button>
```

Behavior:

```text
Accept any non-empty username/password.
After login, navigate to /form.
Show friendly validation message if missing.
```

---

## 2. Full Form Page

URL:

```text
http://localhost:PORT/form
```

Include these elements:

```text
Text input
Email input
Password input
Number input
Decimal input
Textarea
Checkbox
Checkbox list
Radio group
Dropdown
Multi-select dropdown if easy
Date input
File upload
Submit button
Reset button
```

Recommended element IDs:

```text
firstName
lastName
email
password
age
salary
description
acceptTerms
interestAutomation
interestTesting
genderMale
genderFemale
country
accountType
skills
birthDate
attachment
submitButton
resetButton
```

Dropdown examples:

```text
country:
  JO
  SA
  AE
  US

accountType:
  PERSONAL
  BUSINESS
  CORPORATE
```

Radio example:

```text
gender:
  MALE
  FEMALE
```

Checkbox list example:

```text
interests:
  Automation
  Testing
  Reporting
```

---

## 3. Success Page

URL:

```text
http://localhost:PORT/success
```

Show:

```text
Submission successful
Generated submission ID
Submitted first name
Submitted email
Submitted country
Submitted account type
```

Element IDs:

```text
successMessage
submissionId
submittedFirstName
submittedEmail
submittedCountry
submittedAccountType
```

This allows Playwright flows to assert and read values.

---

## Mock Site Behavior

On form submit:

1. Validate required fields.
2. Store submitted values in memory or local JSON file.
3. Generate submission ID.
4. Navigate to success page.
5. Display submitted values.

No real database is required.

---

## Sample JSON Data Source

Add sample data:

```text
resources/sample-data/mock-customers.json
```

Example:

```json
[
  {
    "id": 1,
    "username": "user1",
    "password": "pass1",
    "firstName": "Mohammad",
    "lastName": "Abwini",
    "email": "mohammad1@example.com",
    "age": 30,
    "salary": 1000.50,
    "description": "Automation test user 1",
    "country": "JO",
    "accountType": "BUSINESS",
    "gender": "MALE"
  },
  {
    "id": 2,
    "username": "user2",
    "password": "pass2",
    "firstName": "Ali",
    "lastName": "Ahmad",
    "email": "ali@example.com",
    "age": 28,
    "salary": 900.75,
    "description": "Automation test user 2",
    "country": "SA",
    "accountType": "PERSONAL",
    "gender": "MALE"
  }
]
```

This file should support dynamic instance order ID:

```text
Instance 1 → object id 1
Instance 2 → object id 2
```

---

## Sample Flow Profiles

If the project has sample flow resources, add or update sample flows:

```text
Login Mock Site Flow
Fill Mock Form Flow
Submit Mock Form Flow
Validate Mock Success Flow
```

These should use stable locators:

```text
id
label
role
```

---

## Sample Workflow

Add sample workflow:

```text
Mock Full Form Workflow
```

Flow order:

```text
Login Mock Site Flow
→ Fill Mock Form Flow
→ Submit Mock Form Flow
→ Validate Mock Success Flow
```

The workflow should use:

```text
mock-customers.json
```

as its workflow data source.

---

## Offline Requirement

The mock website should not require internet at runtime.

It should use local files and bundled dependencies only.

If Express is used, it must already be included in the production dependency set or dev-only if the mock site is development-only.

Clarify in README whether the mock site is:

```text
Development test utility only
or
Bundled offline test utility
```

Prefer making it available in development and optionally packageable offline.

---

## Required README

Add:

```text
mock-site/README.md
```

Include:

```text
How to start mock site
Available URLs
Test credentials
Element ID reference
How to use it with AWTKIT flows
How to test concurrent instance order data
```

---

## Root package.json Script

Add scripts if appropriate:

```json
{
  "scripts": {
    "mock-site": "tsx mock-site/server.ts",
    "dev:mock-site": "tsx mock-site/server.ts"
  }
}
```

Adapt to current project tooling.

---

## Validation

After implementation, verify:

```text
Mock site starts locally.
Login page loads.
Login form navigates to form page.
All form elements are visible.
Submit creates success page.
Success page contains assertion-friendly element IDs.
Sample JSON file exists.
Sample workflow can target the mock site.
```

---

## Acceptance Criteria

```text
A local mock website exists.
Login page works.
Form page includes all important element types.
Form submission works.
Success page shows submitted data.
Element IDs are stable and automation-friendly.
Sample JSON data supports id 1, id 2, etc.
Site can be used for dynamic instance order testing.
Documentation exists.
```

---

## Final Response Required

After implementation, report:

```text
Files added
Files changed
How to run the mock website
URLs available
Element IDs created
Sample data created
Sample flows/workflows created or updated
Commands executed
Manual verification results
Remaining limitations
```
