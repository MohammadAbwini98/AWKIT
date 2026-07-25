# AWKIT Comprehensive Validation Fixtures

All fixtures are synthetic and target the loopback mock application. They are persisted through the same JSON model consumed by AWKIT.

## Data sources

| Fixture | Purpose |
| --- | --- |
| `resources/test-fixtures/mock-site/data-sources/mock-runtime-values.json` | JSON-path and row-driven values used by the core and workflow scenarios |

## Flows

| Fixture | Coverage |
| --- | --- |
| `mock-comprehensive-core-flow.json` | Navigation, fill/select/check/uncheck/radio/scroll, reads, assertions, conditions, loops, screenshots, generated/environment/runtime/row/JSON/secret/instance values, and `runFlow` |
| `mock-comprehensive-data-consumer-flow.json` | Cross-flow output consumption and republishing |
| `mock-comprehensive-io-flow.json` | Multipart upload, pre-armed response wait, UI wait, output mapping, download, and filename/content validation |
| `mock-comprehensive-popup-flow.json` | Popup creation, fast and delayed discovery, aliases, switching, main-page restoration, actions, and close |
| `mock-comprehensive-connectors-flow.json` | Structured conditional priority, parallel fan-out/join, outcome routing, count loop, and bounded loop-back |
| `mock-comprehensive-manual-session-flow.json` | Manual handoff, protected-login handoff, explicit controller resume, and local storage-state save |
| `mock-comprehensive-oracle-flow.json` | Persisted Oracle-node contract for inventory, validation, and blocked/live-environment reporting |

## Workflow

| Fixture | Coverage |
| --- | --- |
| `mock-comprehensive-workflow.json` | Persisted multi-flow workflow: core producer → data consumer → I/O → popup lifecycle |

## Generated run-time fixtures

The comprehensive verifier also creates isolated in-memory profiles for:

- Failure/retry/evidence/recovery routing
- Flow-level `manualApproval` edge continuation
- Synthetic session storage state
- Temporary upload file and download directory
- Per-case screenshots, DOM snapshots, accessibility snapshots, metadata, traces, logs, and workflow result JSON

## Fixture safety

- URLs resolve only to `127.0.0.1`/`localhost`.
- Credentials and secrets are synthetic.
- Protected-login steps pause and are resumed by the local test controller; no protected action is automated.
- The Oracle fixture does not issue a live database call without an explicitly configured approved environment.
- No fixture mutates files under the ChatGPT project mirror.
