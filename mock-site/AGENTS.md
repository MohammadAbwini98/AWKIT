# Local Agent Rules - `mock-site`

## Scope

AWKIT's local Feature Test Lab: deterministic offline pages used by Recorder, Runner, Smart Wait, Flow
Designer, Workflow Builder, Instance Monitor, locator, node, wait, and execution verification.

## Local rules

- Check `mock-site/README.md` before adding pages or fixtures.
- Prefer extending `/smart-waits`, `/recorder-lab`, `/designer-lab`, `/login`, `/form`, or `/details`
  instead of creating duplicate isolated pages.
- Every scenario needs a stable local URL, clear title, description, expected behavior, related AWKIT
  feature, and stable selectors using role/name, labels, placeholders, and/or `data-testid`.
- Keep pages offline/local friendly: no external scripts, CDNs, fonts, APIs, CAPTCHA/MFA, or bot-detection
  bypass scenarios.
- Keep behavior deterministic; use bounded delays and visible status logs/reset controls where useful.

## Verification

- Run `npm run verify:mock-site` after changing this folder.
- Run related feature verifiers too: Recorder changes need recorder verifiers, wait/runner changes need
  `verify:waits`/`verify:runner`, and designer/builder changes need their GUI verifiers.

## Update requirements

- Update `mock-site/README.md` with new scenario URLs and expected behavior.
- Update `docs/ai/*` memory files when the lab contract or verification commands change.
