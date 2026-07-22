# Session Outcomes — Close-out Tracker

**Branch:** `feature/recorder-protected-login-and-async-awareness`
**Source report:** `scratchpad/SESSION_OUTCOMES_REPORT.md` (Promotion status: ⛔ UNAPPROVED)
**Goal:** close every reported point and clear the 5 promotion conditions.
**Started:** 2026-07-22

Update the **Status** column as each item lands. Legend: `[ ]` todo · `[~]` in progress ·
`[x]` done · `[!]` blocked / needs user.

---

## Tracker

| # | Item | Report ref | Verify gate | Status |
|---|---|---|---|---|
| 0a | Create this tracker file | deliverable | — | [x] |
| 0b | Close AWKIT dev instance → rerun `verify:settings-persistence` | Cond. 5 | `verify:settings-persistence` green | [!] 4 Electron procs running — needs you to close AWKIT |
| 1 | **awkit-cxa (P1):** designer preserves bare `FlowStep.value` losslessly | Cond. 3 / Finding 4 | `verify:flow-step-mapping` (pins inverted) + `tsc` | [x] |
| 2 | **awkit-y24 (P2):** grouped completion `A AND (B OR C)` → GUI 11.3 PASS | Cond. 1 / Finding 3 | `verify:waits` + `verify:flow-step-mapping` + `verify:runner` + `verify:mock-site` | [~] code done; GUI walkthrough pending |
| 3 | **awkit-4km C1:** 202 → terminal-status polling (own commit) | Bead awkit-4km | `verify:waits` + `verify:mock-site` + round-trip | [x] (C1 only) |
| 4 | Coverage-gap hardening (verifier breadth) | Section 8 | `verify:flow-step-mapping` | [x] (+ fixed generated/secret drop) |
| 5a | Distributable installer on a host that clears `-mx=9` | Cond. 2 | `package:portable` exit 0 + artifact recorded | [!] |
| 5b | Visual confirmation packaged renderer paints | Cond. 4 | screenshot of painted renderer | [!] |
| 6 | Close-out: full verify matrix + docs sync + memory + beads + git report | checklist | Section 6 matrix + `build` + `-Strict` + `check-memory` | [~] verifiers + docs + memory + bead notes done; commit/push awaiting approval |

---

## Promotion-condition → item map

| Report promotion condition | Closed by |
|---|---|
| 1. awkit-y24 resolved → GUI check 11.3 PASS | Item 2 |
| 2. Installer produced on `-mx=9`-clean build host | Item 5a |
| 3. awkit-cxa (P1 data loss) resolved | Item 1 |
| 4. Packaged renderer visually paints | Item 5b |
| 5. `verify:settings-persistence` re-run green | Item 0b |

---

## Open beads

| Bead | Pri | Closed by | Status |
|---|---|---|---|
| `awkit-cxa` | P1 | Item 1 | ✅ fixed (uncommitted) |
| `awkit-y24` | P2 | Item 2 | ✅ implemented (uncommitted); GUI 11.3 walkthrough pending |
| `awkit-4km` | P2 | Item 3 (C1 only; WS/SSE + CDP stay deferred) | ⏳ C1 done (uncommitted); WS/SSE + CDP still open |

---

## Notes / log

- 2026-07-22 — Tracker created from the approved close-out plan. Decisions: full in-repo scope
  incl. awkit-4km C1 (202-polling only); awkit-cxa fixed on the designer round-trip side (preserve
  bare `step.value`, never fabricate a static `valueSource`).
- 2026-07-22 — **Item 1 (awkit-cxa) DONE.** `fromFlowStep` now reads `step.value` and marks the node
  with a designer-only `valueSourceType: "none"` sentinel; `createValueSource` returns `undefined`
  for it so `toFlowStep` re-emits `value` alone. Files: `flowDesignerTypes.ts`, `flowStepMapping.ts`,
  `verify-flow-step-mapping.mts` (2 pinned checks inverted + string/numeric/boolean/json/empty
  coverage). Gates: `verify:flow-step-mapping` 68/0, `tsc` 0, `verify:waits` 48/0,
  `verify:recorder` 78/0, `verify:ipc-contract` 4/4. Not committed.
- 2026-07-22 — **Item 2 (awkit-y24) implemented.** New `anyOf` OR-group `WaitCondition`. Runner
  resolves it via `Promise.any` in `executeWaitCondition` (works under every completion policy);
  `describeWaitCondition`/`waitSuggestion` + `FlowValidation.clampWaits` recursion + review model
  (`reviewWait`) updated. Editor: `renderWaitEditor` refactored to `(wait, update)` so it renders
  nested branches recursively; top-level "+ OR group" button; token-only CSS (`.anyof-group` /
  `.anyof-branch`). Files: `FlowProfile.ts`, `StepExecutor.ts`, `FlowValidation.ts`,
  `asyncCompletionReview.ts`, `FlowNodePropertiesPanel.tsx`, `global.css`, `verify-waits.mts`,
  `verify-flow-step-mapping.mts`. Gates: `verify:waits` 52/0 (OR-group truth table incl. "API ok +
  neither branch → fails"), `verify:flow-step-mapping` 74/0, `verify:async-review` 21/0,
  `verify:runner` 82/0, `verify:mock-site` 55/55, `tsc` 0, `npm run build` 0. `/async-results` fixture
  already exposes `#resultsTable` + `data-testid=empty-state`, so GUI 11.3 is configurable. Remaining:
  the manual GUI walkthrough of check 11.3. Not committed.
- 2026-07-22 — **Item 3 (awkit-4km C1) done.** New `apiPolling` `WaitCondition` (202 → poll status
  endpoint to terminal by status range or JSON `responseField`/`terminalValues`, bounded by
  `maxAttempts`). Runner `resolveApiPolling` observes the page's own poll responses (issues none
  itself). Diagnostics + review + designer editor (+ "Poll" scaffold/button) + mock-site `/api/job`
  (deterministic 202×N → terminal, repeatable). Files: `FlowProfile.ts`, `StepExecutor.ts`,
  `asyncCompletionReview.ts`, `FlowNodePropertiesPanel.tsx`, `mock-site/server.mjs`,
  `verify-waits.mts`, `verify-flow-step-mapping.mts`, `verify-mock-site.mjs`. Gates: `verify:waits`
  56/0 (status- + field-based + bounded failure), `verify:mock-site` 58/58, `verify:flow-step-mapping`
  75/0, `verify:async-review` 21/0, `verify:runner` 82/0, `tsc` 0, `build` 0. WebSocket/SSE + CDP
  diagnostics remain deferred on awkit-4km. Not committed.
- 2026-07-22 — **Item 4 (coverage-gap hardening) done.** Added §8 round-trip coverage: all 10
  `valueSource` variants, compound locator `alternatives` + container/frame `context`, edge→`next`
  wiring, `routeChange`/`saveSession` config breadth (incl. falsy `maskSession:false`), and a PINNED
  multi-key-outputs limitation. The new coverage surfaced two more awkit-cxa-class drops — `generated`
  (`generator`) and `secret` (`secretName`) value sources were lost — **fixed** the same lossless way
  (value chain + a `secret` branch in `createValueSource`). `verify:flow-step-mapping` **94/0**; `tsc`
  0. Not committed.
