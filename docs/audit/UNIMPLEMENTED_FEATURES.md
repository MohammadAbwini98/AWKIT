# UNIMPLEMENTED_FEATURES

Findings grouped by kind. Every item is anchored to code read this session. This project is unusually
complete for its size — the list is short and most items are *honestly disclosed* in the UI rather than
hidden traps.

## Explicit placeholders / "not implemented" markers

- **Load Session (reuse a saved `storageState` in a fresh run).** The one genuine "not implemented yet"
  in the product surface:
  - `src/auth/OAuthHandoffService.ts:23-29` — capability `loadSessionSupported: false`,
    reason string `"Load Session is not implemented yet."`
  - `app/renderer/components/workflow/flowNodeRegistry.ts:167` — validation message
    `"Use saved session requires Load Session support, which is not implemented yet."`
  - `app/renderer/components/auth/ProtectedLoginHandoffPanel.tsx:91` — the button is rendered
    **disabled** with that tooltip.
  - Assessment: **honestly disabled**, not a silent stub. `Reuse Session` (persistent-profile swap,
    `StepExecutor.executeReuseSession:1131`) *is* fully implemented — the gap is only the storageState
    variant. (ID A7)
  - **Disposition (owner decision 2026-07-12):** ACCEPTED as an intentional **roadmap stub**, not a
    defect. Kept as-is because it is redundant with the working `Reuse Session` / `Auto Secure Login`
    nodes and is already honestly disabled. The `useTestSession` handoff mode is treated the same way.
    No code change; revisit only if Load Session is prioritized as a feature.

No other `TODO`/`FIXME`/`HACK`/`NotImplemented` markers with product impact were found in `src/` or
`app/` (the keyword scan otherwise matched only input `placeholder=` attributes and lint-disable
comments — see `AUDIT_COMMAND_RESULTS.md`).

## Partially implemented features

- **Runtime Inputs** — the UI/preload expose only `runtimeInputs.list`; full CRUD handlers
  (`create/update/delete/get/export/import/clone`) exist in main but are not surfaced. Editing runtime
  input definitions from the UI is therefore not wired end-to-end. (A6)

## UI-only features

- None confirmed. Buttons/controls traced to real IPC/runtime. (The Error Boundary, status bar, and
  Instance Monitor strip that were previously placeholders are now backed by real data per
  `CURRENT_STATE.md` and code.)

## Runtime-only / backend-only features (no UI)

- **`instances:*` CRUD IPC** (`create/update/delete/get/export/import/clone`) — registered in main,
  only `instances.list` exposed in preload. Backend capability with no renderer consumer. (A6)
- **`reports:create/delete/export` IPC** — registered, not in preload; report lifecycle is otherwise
  driven by the engine and telemetry read model. (A6)

## Missing integrations

- **UI ↔ Runtime Inputs CRUD**, **UI ↔ Instances CRUD**, **UI ↔ Reports mutation** — see above. Either
  intentional internal seams or half-finished wiring; needs an owner decision. (A6)

## Missing persistence robustness (present but unsafe)

- Flows / workflows / data sources / reports persist through `JsonProfileStore` **without atomic
  writes** (A1) and **silently drop corrupt files** (A2); id-rename update is non-atomic (A3). The data
  *is* persisted, but not durably against crash/corruption — see `TECHNICAL_DEBT_REGISTER.md`.

## Missing tests (relative to risk)

- No regression test asserts profile-store crash/corruption behavior (would have caught A1/A2).
- No fast, headless, assertion-based tier for the broader logic; verification leans on live/GUI
  `verify:*` scripts (A10).
- Packaged/offline paths not exercised in this session (external Windows gate; not a defect).

## Documentation-only claims (verify before trusting)

- `CURRENT_STATE.md` asserts many green verifier counts (e.g. "verify:runner 82/82"). These were **not**
  re-run in this session (live/GUI/time cost). Treat historical counts as claims, not proof — the audit
  rule "do not use documentation as proof a feature works" applies. Build + 2 unit verifiers were
  independently re-run green (see `AUDIT_COMMAND_RESULTS.md`).

## Unreachable / dead implementations

- `connectorStyle.ts` still exports legacy React-Flow port helpers (`computePortFlags`,
  `reconcileBranchConnectors`, `portHandlesForKind`, `branchSourceHandle`, `portPositions`,
  `ConnectorPortFlags`) that `CURRENT_STATE.md` itself flags as **unused** after the React-Flow removal.
  Safe-to-prune dead code (low priority). *(Documented by the team; listed here for completeness.)*

## Cannot work in packaged / offline mode

- **None newly identified.** The offline path is a first-class concern (bundled Chromium resolver,
  Chromium egress hardening, explicit `sql.js` WASM packaging, dependency manifest). Not re-validated
  here, so no claim either way beyond "no code smell found".
