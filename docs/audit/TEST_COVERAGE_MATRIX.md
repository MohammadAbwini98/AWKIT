# TEST_COVERAGE_MATRIX

The project has **no `test`/`lint` npm script**. Verification = `npm run build` (tsc + bundles) plus 47
bespoke `verify:*` scripts (mix of `tsx` unit-style checks and real-Electron/Playwright GUI/live checks).
Columns below map a feature to the *kind* of coverage that exists. ✅ script exists · ⚠️ indirect/partial ·
❌ none · ➖ n/a. "Packaged App" = exercised against a built EXE.

| Feature | Unit (tsx) | Integration/live | UI (Electron) | Runtime | Packaged App | Status | Missing scenarios |
|---------|-----------|------------------|---------------|---------|--------------|--------|-------------------|
| Flow save/load round-trip | ⚠️ | ⚠️ | ✅ `verify:flow-designer` | ➖ | ❌ | Covered (GUI) | **Crash/corruption durability of the JSON store (A1/A2)** |
| Workflow save + sentinels | ✅ `verify:workflow-sentinels` | ⚠️ | ✅ `verify:workflow-builder` | ✅ | ❌ | Good | Concurrent-save race (S1) |
| Connector routing (cond/parallel/loop) | ⚠️ | ✅ `verify:runner` | ➖ | ✅ | ❌ | Good | — |
| Step execution (28 types) | ⚠️ | ✅ `verify:runner`/`verify:waits` | ➖ | ✅ | ❌ | Good | Per-type negative/error paths |
| Smart Wait engine | ✅ `verify:waits` | ✅ | ⚠️ | ✅ | ❌ | Good | — |
| Recorder locators + alternatives | ✅ `verify:recorder` | ✅ | ⚠️ | ✅ | ❌ | Good | — |
| Recorder draft/flow build | ✅ `verify:recorder-draft/-flow` | ✅ | ⚠️ | ✅ | ❌ | Good | — |
| Protected-login handoff | ⚠️ | ✅ `verify:protected-login(-recorder)` | ⚠️ | ✅ | ❌ | Covered (live) | — |
| Session capture / reuse | ⚠️ | ✅ (protected-login verifiers) | ⚠️ | ✅ | ❌ | Covered | Reuse Session dedicated unit |
| Browser pool / crash window | ✅ `verify:browser-pool` | ✅ | ➖ | ✅ | ❌ | Good | Isolated-context teardown orphan (A4) |
| Concurrency / claims / locks | ✅ `verify:concurrency/-locks/-durable-locks` | ✅ (2nd process) | ➖ | ✅ | ⚠️ `verify:stress:*` | Strong | — |
| Hard cancellation | ✅ `verify:cancellation` | ✅ live | ➖ | ✅ | ⚠️ stress | Good | — |
| Watchdog / heartbeat | ✅ `verify:watchdog` | ⚠️ | ➖ | ✅ | ❌ | Good | — |
| Durable SQLite store | ✅ `verify:durable-store` | ✅ | ➖ | ✅ | ✅ `verify:packaged-runtime` | Strong | — |
| Startup recovery | ✅ `verify:startup-recovery` | ✅ | ⚠️ | ✅ | ❌ | Good | — |
| Artifacts/traces/logs | ✅ `verify:artifacts` | ✅ | ➖ | ✅ | ⚠️ stress | Good | — |
| Runtime status API | ✅ `verify:runtime-status` | ✅ | ✅ (monitor strip) | ✅ | ❌ | Good | — |
| Instance Monitor (records/modal/bulk stop) | ✅ `verify:instance-monitor` | ⚠️ | ✅ `verify:instance-monitor-gui` | ⚠️ | ❌ | Good | — |
| Reports / telemetry read model | ✅ `verify:telemetry` | ⚠️ | ✅ `verify:reports` | ✅ | ❌ | Good | — |
| Data source editor | ✅ `verify:data-editor` | ⚠️ | ⚠️ | ✅ | ❌ | Good | Atomic-write durability (A1) |
| Settings persistence | ✅ `verify:write-queue` | — | ✅ `verify:settings-persistence` | ➖ | ❌ | **Strong (hardened)** | — |
| Canvas performance | ➖ | ➖ | ✅ `verify:canvas-perf` | ➖ | ❌ | Good | — |
| Mock-site fixtures | ✅ `verify:mock-site` | ✅ | ⚠️ | ✅ | ❌ | Good | — |
| Offline bundle / packaging | ➖ | ⚠️ | ⚠️ | ⚠️ | ✅ `validate:offline`/`verify:packaged-*` | Present, not CI | Clean-machine walkthrough (external) |
| Chromium egress hardening | ✅ `verify:chromium-hardening` | ✅ | ➖ | ✅ | ⚠️ | Good | — |
| Electron IPC security | ❌ | ❌ | ❌ | ❌ | ❌ | **No coverage** | No test asserts isolation config / preload contract / handler input validation |
| `instances/runtimeInputs/reports` mutation IPC | ❌ | ❌ | ❌ | ❌ | ❌ | Uncovered (also unwired, A6) | — |
| Load Session | ➖ | ➖ | ➖ | ➖ | ➖ | n/a (unimplemented, A7) | — |

## Coverage observations

- **Strengths:** the concurrency/durable-runtime/recorder/runner core has genuinely deep verification,
  including cross-process, live-browser, stress, and packaged-EXE checks — rare at this project size.
- **Gaps that map to findings:**
  - No durability/corruption test for the **document store** → A1/A2/A3 went unnoticed.
  - No **IPC/Electron-security** assertion (isolation flags, handler input validation) — regressions
    here would be silent.
  - Verification is **live/GUI-heavy** (A10): fast, headless CI gating is limited to the handful of
    `tsx` unit scripts (write-queue, sentinels, data-editor, telemetry logic, etc.).
- **Practically CI-headless-safe today (sampled):** `verify:write-queue`, `verify:workflow-sentinels`
  ran green in this session without a display/browser.
