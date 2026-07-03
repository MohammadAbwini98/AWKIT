# AWTKIT — Claude Code Implementation Plan Phases

## Purpose

This package contains separate Claude Code-ready implementation plan files for the requested AWTKIT / Playwright Flow Studio fixes.

Each phase is separated so Claude Code can implement, verify, and commit one area at a time without mixing unrelated UI, persistence, data-binding, and test-site changes.

## Phase Files

```text
00_README_PHASE_INDEX.md
01_PHASE_NODE_PROPERTIES_VALUE_SOURCE_AND_DYNAMIC_JSON_BINDING.md
02_PHASE_ADJUSTABLE_NODE_PALETTE_WIDTH.md
03_PHASE_WORKFLOW_OWN_DATA_SOURCE.md
04_PHASE_MOCK_TEST_WEBSITE_FOR_FULL_SYSTEM_FEATURES.md
05_MASTER_CLAUDE CODE_EXECUTION_ORDER_PROMPT.md
```

## Recommended Implementation Order

```text
1. Phase 03 — Workflow owns data source
2. Phase 01 — Node Properties value source and dynamic JSON binding
3. Phase 02 — Adjustable Node Palette width
4. Phase 04 — Mock test website
```

Reason:

- Workflow data-source ownership should be defined first.
- Node Properties dynamic binding depends on workflow/data-source rules.
- Node Palette resizing is mostly UI-only and can be implemented independently.
- Mock test website should be added after the data-binding behavior is defined.

## Product Rules Introduced

### Value Source Simplification

Node Properties should support only two value source types:

```text
static
dynamic
```

Where:

```text
static  = user inserts direct text value.
dynamic = value is read from one existing JSON file from Data Source Manager.
```

### Dynamic JSON Binding

Dynamic value binding supports two object ID modes:

```text
explicit ID
runtime instance order ID
```

Examples:

```text
Explicit:
  dataSource = customers.json
  objectId = 5
  keyName = email
  resolved value = JSON object with id = 5, then key email

Runtime:
  dataSource = customers.json
  idMode = instanceOrder
  keyName = email
  instance #1 resolves id = 1
  instance #2 resolves id = 2
  instance #10 resolves id = 10
```

### Workflow Owns Data Source

Each workflow should define its own data source. This makes workflow execution predictable and easier for the user.

### Data Source Manager Simplification

Data Source Manager should be a clean table of JSON files used as data sources.

It should not be a complex binding page.

### Mock Website

Add a simple local website for testing all automation features:

```text
login page
form page
text input
email input
password input
number input
textarea
checkbox
radio button
dropdown
file upload
submit button
result/success page
```
