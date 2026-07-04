---
name: mock-site-maintainer
description: Maintain AWKIT's local Mock Site Feature Test Lab. Use when adding or changing Recorder, Runner, Smart Wait, Flow Designer, Workflow Builder, Instance Monitor, locator, node, wait, execution features, mock-site pages, mock fixtures, or related verifiers/docs.
---

# Mock Site Maintainer

Use `mock-site/` as AWKIT's local Feature Test Lab.

## When to update the Mock Site

- Update it when a feature changes Recorder behavior, runner/execution timing, waits, locator generation,
  Flow Designer/Workflow Builder canvas or panels, workflow cards, nodes, or instance behavior.
- Before creating feature-specific fixtures, inspect `mock-site/README.md` and existing pages. Prefer
  extending `/smart-waits`, `/recorder-lab`, `/designer-lab`, `/login`, `/form`, or `/details`.

## Scenario requirements

Each scenario needs:
- Stable local URL.
- Clear title, description, expected behavior, and related AWKIT feature.
- Stable selectors using role/name, labels, placeholders, and/or `data-testid`.
- Deterministic local behavior: bounded delays, no external services, no random-only assertions.

## How to add a scenario

1. Add or extend a page under `mock-site/public/`.
2. Add any route/API in `mock-site/server.mjs` using Node built-ins only.
3. Add visible status text/logs and reset controls when useful.
4. Update `mock-site/README.md` with the URL and expected behavior.
5. Add or update `scripts/verify-mock-site.mjs` or the related feature verifier.

## Verification

Run `npm run verify:mock-site` plus the related feature verifier:
- Recorder or locator: `npm run verify:recorder` and/or `npm run verify:recorder-draft`.
- Smart Wait or runner timing: `npm run verify:waits` and `npm run verify:runner`.
- Flow Designer / Workflow Builder / cards: `npm run verify:flow-designer`, `npm run verify:workflow-builder`,
  or `npm run verify:instance-monitor`.
- Always finish with `npm run build` and `node scripts/ai-memory/check-memory.mjs`.

## Docs and memory

Update `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`, and any changed command/testing/architecture docs.
Do not copy secrets or external URLs into the lab docs.
