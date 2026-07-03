# Master Claude Code Prompt — Implement Requested AWTKIT Phases

You are an expert Electron, React, TypeScript, Playwright, UI/UX, workflow automation, and desktop application engineer.

You are working in the AWTKIT / Playwright Flow Studio project.

Before implementing, read:

```text
AGENTS.md
README.md
package.json
```

Follow the existing architecture. Reuse existing stores, IPC, profile schemas, and UI components where possible. Refactor only when current implementation is incomplete, broken, or confusing.

## Required Phases

Implement the following phase files in order:

```text
01_PHASE_NODE_PROPERTIES_VALUE_SOURCE_AND_DYNAMIC_JSON_BINDING.md
02_PHASE_ADJUSTABLE_NODE_PALETTE_WIDTH.md
03_PHASE_WORKFLOW_OWN_DATA_SOURCE.md
04_PHASE_MOCK_TEST_WEBSITE_FOR_FULL_SYSTEM_FEATURES.md
```

Recommended order:

```text
1. Phase 03 — Each Workflow Has Its Own Data Source
2. Phase 01 — Node Properties Value Source and Dynamic JSON Binding
3. Phase 02 — Adjustable Node Palette Width
4. Phase 04 — Mock Test Website
```

## High-Level Product Rules

### Flow

A flow is one reusable automation unit with action nodes.

### Workflow

A workflow is a connected group of flows.

```text
Flow + Flow + N flows = Workflow
```

### Data Source

Data Source Manager should be a simple table of JSON files.

### Workflow Data Source

Each workflow has its own selected data source.

### Node Value Source

Node value source supports only:

```text
static
dynamic
```

Static:

```text
Direct text value inserted by user.
```

Dynamic:

```text
Value from JSON file.
Object ID can be explicit or based on runtime instance order.
Key name is inserted by user.
```

### Runtime Dynamic ID

For concurrent instances:

```text
Instance 1 → JSON object id 1
Instance 2 → JSON object id 2
Instance 3 → JSON object id 3
```

The key name is the same across instances.

## Required Verification

After each phase, run available project checks:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

If a script is missing, inspect `package.json` and run the closest equivalent.

## Final Response

After implementation, provide:

```text
Files changed
Files added
Schema changes
UI changes
Resolver/runtime changes
Persistence changes
Commands executed
Manual verification results
Remaining TODOs
```
