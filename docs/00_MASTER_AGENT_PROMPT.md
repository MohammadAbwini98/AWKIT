# Master Agent Prompt — Implement AWKIT Missing Hologram Template Design Exactly

You are working locally inside the AWKIT repository.

The previous implementation is still incomplete. The provided Hologram-style workflow builder template is not only a token/color change. It includes a precise light SaaS shell, full-height sidebar, compact top header, dotted workflow canvas, floating right configuration drawer, white rounded node cards, purple selected/running connectors, bottom-center zoom pill, polished panel overflow behavior, and visible micro-animations.

Your task is to implement the missing visual design and motion details using the file-by-file specs in this folder.

## Must-read inputs before coding

Read these files from this prompt pack first:

```text
01_ACTUAL_TEMPLATE_DESIGN_EXTRACTION.md
02_GITHUB_CODEBASE_REVIEW.md
03_FILE_BY_FILE_IMPLEMENTATION_MATRIX.md
files/*.md
```

Review these local design assets again:

```text
UI Samples/sample_01.png
UI Samples/Sample02.mp4
UI Samples/sample_03.mp4
UI Samples/sample_04.mp4
```

If possible, extract frames from the MP4 files and keep them under:

```text
docs/ai/ui-reskin-template-plan/screenshots/template-frames/
```

## Non-negotiable output

You must implement design fixes. Do not stop after saying “already delivered.”

For every area below, either implement a change or provide proof that it already matches the template:

- App shell
- Sidebar
- Header
- Dashboard/report/instance/recorder/settings cards
- Flow Designer canvas
- Scenario Builder / Workflow Builder canvas
- Workflow Designer canvas
- Form Designer canvas-like surface
- Node Palette
- Node Properties drawer
- Connector Properties drawer
- Node cards
- Start/End nodes
- Connectors
- Conditional branch labels
- Connector plus/add affordances
- Bottom zoom pill
- React Flow controls
- Minimap
- Hover states
- Selected states
- Loading/skeleton states
- Empty states
- Modal/dialog/toast motion
- Panel overflow/scroll behavior
- Reduced-motion behavior

## Implementation rule

Prefer CSS-first implementation and existing libraries:

- React
- @xyflow/react
- lucide-react
- CSS variables
- CSS transitions/keyframes

Do not add a new animation library unless you prove CSS is insufficient. If you add a library, update `package.json`, `package-lock.json`, offline dependency docs, and explain why.

## Safety rules

- Do not remove functionality.
- Do not remove required fields.
- Do not change Playwright/runtime automation behavior.
- Do not change IPC contracts unless strictly required and documented.
- Do not break workflow creation/execution.
- Do not break recorder, sessions, instances, reports, or settings.
- Do not bypass CAPTCHA, MFA, bot detection, or website security.
- Do not commit unless the user explicitly asks.

## Verification commands

Run available commands from `package.json`:

```bash
npm run build
npm run typecheck
npm run verify:flow-designer
npm run verify:workflow-builder
npm run verify:reports
npm run verify:instance-monitor
npm run verify:data-editor
npm run verify:recorder
npm run ai:memory
```

Run additional targeted verifiers if affected:

```bash
npm run verify:telemetry
npm run verify:runtime-status
npm run verify:resource-sampling
npm run verify:runner
```

## Required final report

When finished, report exact paths and selectors/components:

1. Template assets reviewed.
2. Frames extracted.
3. Files changed.
4. App shell changes.
5. Sidebar/header changes.
6. Canvas changes.
7. Node changes.
8. Connector changes.
9. Drawer/panel changes.
10. Overflow fixes.
11. Animation fixes.
12. Shared page polish.
13. Remaining hardcoded colors and why they remain.
14. Verification commands and results.
15. Screenshot paths.
16. Remaining gaps.
17. Confirmation that runtime automation behavior was not changed.
18. Confirmation that nothing was committed.
