# Software Requirements Specification (SRS)

## Browser-Automation Observability, Evidence, and Safety Boundary

| | |
|---|---|
| **Document ID** | SRS-BAO-001 |
| **Product** | SpecterStudio / AWKIT — offline-capable Windows Electron + React + Playwright desktop app |
| **Author** | Runner / Observability |
| **Date** | 2026-07-22 |
| **Status** | Draft for review — no implementation authorized by this document |
| **Source request** | `AWKIT_Browser_Automation_Skills_Improvement_Summary.md` (25 recommendations + verification warning) |
| **Upstream evidence** | `BROWSER_AUTOMATION_SKILLS_REPORT.md` (committed `f600959`) — technical teardown of the top-10 open-source browser-automation agent skills |
| **Related surfaces** | `src/runner/**`, `src/recorder/**`, `src/reports/**`, `src/session/**`, `src/instances/**`, `app/main/ipc/**`, `app/renderer/pages/InstanceMonitor.tsx` |
| **Open beads** | `awkit-60w` (P2), `awkit-4a6` (P3), `awkit-v4r` (P3), `awkit-4km` (P2, overlaps) |

> **Branch state notice.** The working branch `feature/recorder-protected-login-and-async-awareness`
> is **frozen at pushed checkpoint `61f6099`** pending the clean-machine acceptance gate
> (`CLEAN_MACHINE_VALIDATION_RUNBOOK.md`). This SRS is specification only. No requirement herein
> may be implemented on the frozen branch; each workstream lands on its own branch after the gate
> clears.

### Revision history

| Rev | Change |
|---|---|
| r1 | Initial review of the 25 recommendations against the tree at `61f6099`. |
| r2 | **Correction:** r1 claimed the mislabeled success close reason contaminates `BrowserPoolEffectiveness.closeReasons`. Tracing the consumers disproved it — `onRuntimeClosing`'s sole consumer discards the reason, and pool analytics are fed by a *different* enum (`SharedBrowserCloseReason`). Defect #4 is re-scoped to log truthfulness, and the change note must **not** claim analytics will shift. See FR-G1. |
| r2 | Added: single-owner page-registry invariant (FR-C1); four-item evidence preservation set and secondary-diagnostic rule (FR-B2); explicit `screenshotOnFailure` precedence contract (FR-A4); `inconclusive` connector-routing semantics and the 7-step change method (FR-E2); close-reason enum reconciliation (FR-G1); SEC-13/SEC-14; tranche exit criteria and branch discipline (§6.1). |

---

## 1. Introduction

### 1.1 Purpose

The source summary proposes 25 improvements drawn from a teardown of open-source browser-automation
agent skills. This SRS does three things:

1. **Reviews every recommendation against the actual AWKIT codebase** and classifies it as
   *Implemented*, *Partial*, *Absent*, or *Rejected* — with file and line evidence.
2. **Specifies the requirements** for the subset worth building, expressed as testable FRs.
3. **Names the change dependencies** — the specific existing contracts, verifiers, and invariants
   each change would disturb — so the work can be sequenced without regressions or security loss.

The third item is the reason this document is long. Several recommendations look additive but touch
contracts that are load-bearing across the runner, the durable store, the IPC bridge, and the
recorder round trip. Those are called out per requirement and consolidated in §7.

### 1.2 Scope

**In scope**

- A read-only CDP observation client and the unified event timeline built on it.
- Addressable per-run session artifacts and immediate failure-evidence capture.
- Stable page/frame identity; snapshot-before-action enforcement.
- Locator winner memory and confidence-scored, approval-gated locator recovery.
- Structured step assertions, the `INCONCLUSIVE` result class, and the validation rigor ladder.
- Numeric record-to-replay fidelity measurement.
- Recorder interaction-primitive and pagination-cursor preservation; rehearse-before-record.
- Browser lifecycle staging and per-resource cleanup accounting.
- A domain capability boundary and runtime-enforced (not documentation-enforced) safety invariants.
- Verifier classification and honest verification reporting.

**Out of scope**

- Any change to the protected-login handoff's opaque-profile design (see §3.8.4 — deliberately
  **rejected**; the current design is stronger than the reference).
- Renaming the `window.playwrightFlowStudio` preload identifier.
- Any runtime network access, CDN asset, or global Node/Playwright/Chromium dependency.
- Cloud/hosted live-view substrates (WSS DevTools proxies) — offline-first forbids them.
- Changes to the Oracle JDBC bridge, licensing, RBAC, or concurrency admission policy except where
  a named FR explicitly extends an existing contract.
- Implementation. This document specifies; it does not authorize code changes.

### 1.3 Definitions

| Term | Meaning |
|---|---|
| **CDP** | Chrome DevTools Protocol. Here always a *second, read-only* client attached alongside Playwright. |
| **Run trace** | The on-disk, addressable folder holding one run's manifest, event streams, and evidence. |
| **Trajectory** | The chronological stream of AWKIT-intentional actions (step started/ended, decisions). |
| **Browser events** | The chronological stream of browser-generated CDP events (console, network, lifecycle, dialogs). |
| **Unified timeline** | Trajectory ∪ browser events, merged on a single monotonic clock. |
| **Winner candidate** | The locator candidate that actually resolved an element at run time. |
| **Recovery** | Resolving an element when the primary *and every recorded alternative* failed. |
| **INCONCLUSIVE** | A terminal result meaning "the check could not be performed", distinct from pass and fail. |
| **Rigor tier** | The evidence class backing an assertion: deterministic eval > a11y match > snapshot diff > pixel. |
| **Fidelity** | Replayed-successfully ÷ recorded-actions, expressed as a percentage. |

### 1.4 References

- `AGENTS.md`, `docs/ai/RULES.md` — offline-first and coding constraints.
- `docs/ai/ARCHITECTURE.md`, `docs/ai/CURRENT_STATE.md`.
- `docs/ai/SECURITY.md`, `docs/PROTECTED_LOGIN_HANDOFF.md`.
- `BROWSER_AUTOMATION_SKILLS_REPORT.md` §5.2 (CDP done properly), §5.5 (capability boundary),
  §5.6 (state boundary), §8 (AWKIT relevance).
- `CLEAN_MACHINE_VALIDATION_RUNBOOK.md` — the gate currently blocking the branch.

---

## 2. Overall Description

### 2.1 Current-state findings (grounded in code)

Every row below was verified against the working tree at `61f6099`. "Absent" means a targeted search
found no implementation, not that one is merely undocumented.

| # | Recommendation | Status | Code evidence |
|---|---|---|---|
| 1 | Read-only CDP observation client | **Absent** | No `newCDPSession` / `CDPSession` / `chrome-devtools` reference exists anywhere in `src/` or `app/`. `SessionCaptureService.ts` header states the invariant *"No CDP connection"* for the real-Chrome path. |
| 2 | Unified execution timeline (NDJSON) | **Partial** | `RunLogger` (`src/runner/artifacts/RunLogger.ts`) already writes masked JSONL to `InstanceRuntimePaths.logs`, with `runId`/`flowId`/`nodeId`/`attemptId`/`workerId` correlation fields. It carries **only AWKIT-intentional events** — there is no browser-event source to merge, and no shared clock. |
| 3 | Addressable run session artifact | **Partial** | Per-instance dirs exist (`InstanceRuntimeState.ts:8` — `downloads`, `screenshots`, `logs`, `reports`, `storage`, `traces?`, `userDataDir?`) and `writeRunStateArtifacts` emits `flow-state.json`, `node-attempts.json`, `capacity.json`, `locks.json`. There is **no `manifest.json`, no single run-addressable root, no DOM/snapshot/network dirs, no `findings.json`**. `runtime_artifacts` (SQLite) indexes paths but does not define a layout. |
| 4 | Numeric record-to-replay fidelity | **Absent** | No replay-fidelity measurement exists. Tracked as `awkit-60w`. |
| 5 | Remember which locator alternative won | **Absent** | `LocatorFactory.resolve()` (`src/runner/LocatorFactory.ts:60`) returns a bare `Locator`. Candidate identity is discarded; `CandidateDiagnostic[]` is built but consumed **only** on the failure path by `formatFailure`. Tracked as `awkit-v4r`. |
| 6 | Controlled recovery when all locators fail | **Absent** | `resolve()` throws once primary + `alternatives` are exhausted. Deterministic narrowing exists (`pickSingle` → single-visible → `narrowToActionable` → enabled → in-viewport, `VISIBILITY_PROBE_CAP = 30`) but it never *invents* a candidate. Tracked as `awkit-v4r`. |
| 7 | Snapshot-before-action enforcement | **Partial** | Liveness is checked per step (`assertActivePageAlive`, `assertBrowserRuntimeAlive` — `StepExecutor.ts:228-229`) and locators are lazily re-resolved per step, so Playwright's own auto-waiting covers most staleness. There is **no explicit invalidation event** on navigation / popup creation / DOM replacement, and no state-capture step in the loop. |
| 8 | Stable tab / page / frame identity | **Partial — with a defect** | A real registry exists: `StepExecutor.pageRegistry` (`Map<string, Page>`, `'main'` always present), `PageAlias = "main" \| \`popup-${number}\` \| string`, and alias-targeted steps via `resolveStepPage`. **But** `PlaywrightRunner.runFlowWithChildren` installs a context-level `page` handler that assigns `popup-${++runnerPopupCounter}` (`PlaywrightRunner.ts:471-479`) while the click path *separately* registers the recorded alias (`StepExecutor.ts:1255`). One popup is therefore registered under two keys, and the counter-derived key is **positional** — exactly the anti-pattern this recommendation warns against. Frames are identified by raw CSS selector (`LocatorContext.frame.selector`), not by stable id. |
| 9 | Browser-process lifecycle staging | **Partial** | Launch/attach/run/cleanup are real and careful: generation-tracked `BrowserHolder`, `assertRuntimeAlive` with a `stableForMs` re-check, stale-event suppression by generation, `onRuntimeClosing` so intentional teardown is not scored as a crash, `finally`-guaranteed `closeRuntime`. **Gaps:** no bounded readiness *poll* (a single `page.evaluate(() => 1)` probe), and the success-path `finally` closes with the mislabeled reason `"execution-failed-cleanup"` (`PlaywrightRunner.ts:282`), which pollutes `BrowserCloseReasonName` analytics. |
| 10 | Run/session cleanup policies | **Partial** | `BrowserProcessManager` tracks contexts-per-process; `ResourceLockManager` + `WatchdogService.cleanupStale` sweep stale locks; `StartupRecovery` handles crash residue. **No per-resource released/not-released accounting** is reported at run end — a run can report success while a profile dir, trace chunk, or context leaked. |
| 11 | Stuck detection via progress signals | **Partial** | `WatchdogService` detects `staleHeartbeat` and `orphaned`, but `WatchdogInstanceView` exposes **only** `heartbeatAt`, `startedAt`, `runnerActive`. The richer signals the recommendation names already exist *elsewhere* and are simply not wired in: `BrowserProcessSampler`, `ProcessTreeSampler`, `RuntimeObservationCollector`, `AnomalyDetector`. No network/page-lifecycle/download-progress signal exists at all (needs #1). |
| 12 | Structured step assertions | **Absent** | `assertText` → `executeAssertion(step)` then `mapOutputs(..., { assertionResult: true })`; `assertVisible` → `isVisible()` else throw (`StepExecutor.ts:1433-1444`). The literal `true` is written on success and the step throws on failure — **no expected/actual pair, no machine-readable assertion record** survives into the report. |
| 13 | Validation rigor hierarchy | **Absent** | No tiering concept exists in code or in the GUI verifiers. |
| 14 | `INCONCLUSIVE` result | **Absent** | `StepExecutionStatus = "passed" \| "failed" \| "skipped" \| "manualHandoff"` (`RunnerResult.ts:5`); flow and scenario results narrow further to `"passed" \| "failed" \| "manualHandoff"`. A missing fixture/baseline currently resolves to pass or fail — never "not determinable". |
| 15 | Immediate failure evidence | **Partial — ordering defect** | A failure screenshot *is* captured, but in `FlowExecutor.runStepWithRetries` **after the whole retry loop finishes** (`FlowExecutor.ts:446-448`), guarded by `step.onFailure?.screenshot ?? true`. Consequences: (a) intermediate failed attempts get no evidence; (b) retries that navigate or re-render destroy the broken state before it is photographed. `StepExecutor`'s own catch block (`StepExecutor.ts:287-307`) saves a trace chunk but captures **no screenshot, DOM, console, or network state**. Separately, `resolveArtifactSettings().screenshotOnFailure` is computed but **never read** — the real switch is the per-step flag, so the `production` profile does not actually control failure screenshots. |
| 16 | Rehearse-before-record | **Absent** | `RecorderService` records directly; no pre-flight element discovery or selector validation pass. |
| 17 | Preserve the interaction primitive | **Absent** | `RecordedAction` (`src/recorder/RecorderTypes.ts:19`) has no input-method field, and `fill` always replays as `locator.fill()` (`StepExecutor.ts:1346-1351`). Real keystrokes, paste, and shortcut input are not distinguishable at record time or reproducible at replay time. |
| 18 | Pagination state / continuation cursors | **Absent** | No cursor or pagination state is captured in `RecordedAction`. |
| 19 | Visual regression with step pairing | **Absent** | No pixel-diff or a11y-tree-diff code exists (no `pixelmatch`, no baseline comparison anywhere in `src/`, `app/`, or `scripts/`). |
| 20 | Detail-tiered observability | **Partial** | `ArtifactProfile` (`production` / `balanced` / `debug` / `full`) already tiers **artifact capture** via `AWKIT_ARTIFACT_PROFILE`, with `AWKIT_TRACE_MODE` overriding. It does not tier **report/log detail**, and (per #15) one of its three fields is inert. |
| 21 | Safety enforced beneath the node layer | **Partial** | Genuinely strong in places: `SecretMasker` is applied inside `RunLogger` and `MemoryRunnerLogger` (so masking cannot be bypassed by a caller), `assertNavigableUrl` gates `goto`, and `guardLocatorQuality` refuses fragile positional locators for `dangerousMutation` / `externalCommit` steps (`StepExecutor.ts:326-336`). Missing: domain allowlisting, action approval, and per-run audit of enforcement decisions. |
| 22 | Strict domain capability boundary | **Absent (scheme-only today)** | `urlPolicy.ts` allowlists **protocols** (`http`, `https`, `about`, `data`) and *deliberately* does not restrict private networks. There is no origin/domain allowlist, no request/popup/redirect interception. Note the mitigating fact: AWKIT exposes **no raw CDP passthrough** today, so the "expose approved actions, not raw CDP" half of this recommendation is already satisfied — and #1 must not break it. |
| 23 | Keep protected-login state opaque | **Implemented — do not change** | `SessionCaptureService` launches the user's real Chrome/Edge against a dedicated `--user-data-dir` and never extracts cookie or token values; the profile directory stays opaque. Header invariant: *"No CDP connection. No automation flags. No secrets logged. No stealth/anti-detection code."* |
| 24 | MFA/CAPTCHA via manual handoff | **Implemented** | `detectProtectedLogin` → pause → `HandoffInfo` (`kind`, `provider`, `reason`, `url`, `allowedActions`) → real-Chrome capture → `reuseSession`. Auto-detection runs post-navigation and on popups, and only pauses when `recommendedAction === "pause"` so low-confidence text signals do not stall runs. |
| 25 | Treat page content as untrusted | **Implemented for today's surface** | AWKIT has no AI-assisted feature that ingests page text as instructions. `RecordedUrl` masks sensitive query values; `RunLogEvent.currentUrl` is documented as origin + path only. The requirement becomes live the moment any AI diagnosis feature reads page content. |
| — | Verification credibility | **Structurally exposed** | 94 `verify:*` npm scripts across 116 script files. They span everything from `verify-ipc-contract.mts` (real static contract enforcement) to GUI walkthroughs to doc checks — but they are **undifferentiated**: every one reports a pass count in the same voice, and those counts get quoted as completeness. |

### 2.2 Constraints

| ID | Constraint | Source |
|---|---|---|
| C-1 | No runtime network access. No CDN, remote font, remote script, or telemetry egress. | `AGENTS.md`, `docs/ai/RULES.md` |
| C-2 | No writes to `resources/` or `app.asar`. Mutable data lives under `%LOCALAPPDATA%/SpecterStudio/` or user-configured Settings paths. | `docs/ai/RULES.md` |
| C-3 | `npm run build` runs `tsc --noEmit` and must stay clean. There is no `lint` and no `test` script. | `AGENTS.md` |
| C-4 | `window.playwrightFlowStudio` preload identifier must not be renamed. | `AGENTS.md` |
| C-5 | New/changed UI must use `global.css` Hologram tokens — no hardcoded hex, no arbitrary px, no parallel class system. | `docs/ai/RULES.md` › UI |
| C-6 | Every new IPC channel must satisfy `verify:ipc-contract`: exactly one handler, exposed through preload **or** listed in `BACKEND_ONLY`, with no stale entries. | `scripts/verify-ipc-contract.mts` |
| C-7 | New durable-store tables require a new numbered `RUNTIME_STORE_MIGRATIONS` entry. Current max version is **4**. Migrations are forward-only and run once. | `src/runner/store/RuntimeStoreSchema.ts` |
| C-8 | New saved-flow fields must be optional so existing profile JSON deserializes unchanged. | `StepLocator` / `FlowStep` doc comments |
| C-9 | Mock-site scenarios must be added or updated for Recorder / Runner / Smart Wait / locator / node / wait / execution features, and covered by `verify:mock-site`. | `AGENTS.md` |
| C-10 | Authorized automation only. Never bypass CAPTCHA, MFA, or bot detection. | `docs/ai/SECURITY.md` |

### 2.3 Assumptions and dependencies

- **A-1.** Playwright's bundled Chromium exposes CDP to `context.newCDPSession(page)` in-process. This
  needs no network and no `--remote-debugging-port`, so C-1 holds. **This assumption must be
  empirically confirmed against the bundled Chromium build before FR-A1 is scheduled** — the whole
  of WS-A depends on it.
- **A-2.** `sql.js` (pure-WASM) remains the durable-store driver, so new tables carry no native ABI risk.
- **A-3.** The clean-machine gate (`CLEAN_MACHINE_VALIDATION_RUNBOOK.md`) clears before any workstream
  here begins. Nothing in this SRS may be sequenced ahead of it.
- **A-4.** `awkit-4km` (async engine: 202 polling, WebSocket/SSE, **CDP diagnostics**) overlaps WS-A.
  There must be **one** CDP attach helper serving both, not two clients. Whichever lands first owns
  the helper; the other consumes it.

---

## 3. Functional Requirements

Priority follows the source document's own "Highest-Priority Implementation Set", adjusted for the
dependency order the codebase actually imposes.

Each requirement carries: **Requirement**, **Acceptance criteria**, and **Change dependencies** — the
existing contracts a change would disturb.

---

### 3.1 WS-A — Observation substrate

*Covers recommendations 1, 2, 11, 20. Bead: `awkit-4a6`, overlapping `awkit-4km`.*

#### FR-A1 — Read-only CDP observation client

**Requirement.** Provide a single `CdpObservationClient` that attaches a second, **read-only** CDP
session to a run's automation browser and emits normalized events. It must enable only observation
domains — `Runtime`, `Log`, `Network`, `Page`, `Target` — and must never issue a command that
mutates page state, navigates, evaluates script, or alters browser configuration.

**Acceptance criteria**

- A1.1 A run with the client attached produces identical step results to the same run without it
  (verified by differential run over a fixed mock-site scenario).
- A1.2 The client exposes no method that maps to a state-changing CDP command. The command allowlist
  is a module-level constant, and a verifier asserts every issued command is a member.
- A1.3 Attach failure degrades to a warning; the run proceeds without observation. Observation is
  never load-bearing for correctness.
- A1.4 Detach is guaranteed on run end, cancel, crash, and app shutdown, and is idempotent.
- A1.5 The client is **never** attached to a `SessionCaptureService` browser (see FR-H4).
- A1.6 Per-run event volume is bounded; on breach the client sheds load and records the shed count
  rather than growing without limit.

**Change dependencies**

- `PlaywrightRunner.executeScenario` owns runtime generation. The client **must** re-attach on the
  Reuse Session / Auto Secure Login generation swap (`restartBrowser`, `PlaywrightRunner.ts:147-204`)
  and must honour the existing stale-generation suppression in `attachLifecycleHandlers`, or
  post-swap events will be attributed to the wrong browser generation.
- `TraceService.attach(context)` is already called on both initial launch and swap; the CDP client
  should follow that exact call-site pattern so the two cannot drift.
- `onRuntimeClosing` exists so intentional teardown is not scored as a crash by the pool's
  crash-rate backpressure. A CDP detach that races teardown must not emit a synthetic crash signal —
  doing so would silently tighten admission control across the whole app.
- **Regression risk — high.** This touches the run's hot path. Gate it behind an explicit setting
  defaulting **off**, and require `verify:runner` and `verify:shared-browser-live` to pass with it
  both on and off before the default flips.

#### FR-A2 — Unified execution timeline

**Requirement.** Merge AWKIT trajectory events and CDP browser events into one chronological NDJSON
stream per run, on a single monotonic clock, with cause and effect adjacent.

**Acceptance criteria**

- A2.1 One line per event, valid JSON, appended in non-decreasing timestamp order.
- A2.2 Every line carries the existing correlation fields: `runId`, `flowId`, `nodeId`, `attemptId`,
  plus new `pageId` and `source` (`"awkit"` | `"browser"`).
- A2.3 A step failure caused by an HTTP 4xx/5xx shows the request, the response, the console error,
  and the step failure within one contiguous window.
- A2.4 Wall-clock and CDP monotonic timestamps are **both** recorded; ordering uses the monotonic
  clock, display uses wall-clock. (§5.2 of the upstream report documents dual-clock skew as the
  single most expensive detail to rediscover.)
- A2.5 Every value reaching disk passes `SecretMasker` — including CDP-sourced fields.

**Change dependencies**

- `RunLogger` already owns the JSONL sink and applies `SecretMasker` internally. **Extend it; do not
  add a second writer.** Its sequential `queue` promise is what prevents interleaved partial lines
  under concurrency — a parallel writer to the same file would reintroduce that corruption.
- `RunLogEvent` gains optional fields only. Any consumer that spreads `RunLogEvent` must tolerate
  unknown keys.
- **Secret-masking is the security-critical dependency.** CDP `Network.requestWillBeSent` carries
  full URLs, headers, and POST bodies — credentials, bearer tokens, session cookies. See FR-H1.

#### FR-A3 — Progress-signal stuck detection

**Requirement.** Extend stuck detection beyond heartbeat staleness to a composite of last completed
step, last browser event, network activity, page lifecycle state, and download progress, so a slow
operation is distinguishable from a dead one.

**Acceptance criteria**

- A3.1 A run blocked on a legitimately slow (>2×`staleHeartbeatMs`) network call with active
  requests in flight is **not** flagged stuck.
- A3.2 A run with a live heartbeat but zero browser events and zero network activity for the
  threshold **is** flagged.
- A3.3 Findings name which signals were stale, not just "no heartbeat".
- A3.4 Recovery stays conservative: mark and report; never auto-restart a business flow.

**Change dependencies**

- `WatchdogInstanceView` (`WatchdogService.ts:15`) is the seam — it must grow optional fields, and
  `evaluate()` must treat every new signal as *optional*, defaulting to today's heartbeat-only
  behaviour when absent. Otherwise every caller that builds the view breaks at once.
- Network/lifecycle signals require FR-A1. CPU/RSS signals do **not** — `BrowserProcessSampler` and
  `ProcessTreeSampler` already collect them and can be wired first as an independent increment.
- `runtime_watchdog_events` gains a reason taxonomy. Existing rows must remain readable (C-7).
- **Regression risk:** false-positive stuck detection marks healthy runs failed. Ship detection in
  observe-only mode first — record the finding, do not act on it — and compare against real run
  history before enabling enforcement.

#### FR-A4 — Detail-tiered observability

**Requirement.** Extend the existing artifact tiering to cover report and log detail: `summary`,
`standard`, `diagnostic`.

**Acceptance criteria**

- A4.1 `standard` reproduces today's output byte-for-byte on a fixed scenario (the no-op default).
- A4.2 `summary` suppresses per-event detail while preserving all terminal results and failures.
- A4.3 `diagnostic` includes the full unified timeline.
- A4.4 Failure evidence (FR-B2) is captured at **every** tier. Diagnostics may be quieter; evidence
  is never optional.

**Change dependencies**

- Reuse `ArtifactProfile`'s shape and env-override precedence rather than inventing a parallel knob.
- **Fix the inert field first — with an explicit precedence contract.**
  `resolveArtifactSettings().screenshotOnFailure` is computed and never read; the real gate is
  `step.onFailure?.screenshot ?? true`. This is a *configuration-contract* defect: the Flow Designer
  and the resolved profile imply one behaviour while the runtime follows a different switch. The fix
  establishes a stated precedence:

  ```text
  explicit per-step override        (step.onFailure.screenshot, when present)
    → artifact profile default      (resolveArtifactSettings().screenshotOnFailure)
      → safe system default         (capture)
  ```

  Concretely, the `?? true` fallback becomes `?? resolvedArtifactSettings.screenshotOnFailure`.
  **Flows that explicitly disable failure screenshots must keep disabling them** — the profile only
  governs steps with no explicit override. Shipping a second tier on top of a tier that already lies
  about one of its three fields compounds the problem, so this is a prerequisite, not a follow-up.

---

### 3.2 WS-B — Run artifacts and evidence

*Covers recommendations 3, 15.*

#### FR-B1 — Addressable run session artifact

**Requirement.** Every run gets one addressable root directory with a `manifest.json` describing its
contents, and a defined internal layout.

```text
<runsRoot>/<runId>/
├── manifest.json          # schema version, runId, executionId, instanceId, scenarioId,
│                          # status, timings, artifact inventory, cleanup ledger (FR-G2)
├── trajectory.ndjson      # AWKIT-intentional events
├── browser-events.ndjson  # CDP events (absent when observation is off)
├── screenshots/
├── snapshots/             # a11y snapshots
├── dom/
├── network/
├── trace/
└── findings.json          # assertions, INCONCLUSIVE reasons, recovery decisions
```

**Acceptance criteria**

- B1.1 The root is derivable from `runId` alone, with no database lookup.
- B1.2 `manifest.json` is written even for crashed runs (best-effort, on the recovery path).
- B1.3 A run folder is self-describing: an external reader can enumerate evidence from the manifest
  without AWKIT.
- B1.4 The layout is versioned; readers reject unknown major versions with a clear message.
- B1.5 Retention/purge is explicit and user-controllable. Unbounded growth is a defect.

**Change dependencies**

- `InstanceRuntimePaths` (`InstanceRuntimeState.ts:8`) is the existing path contract, consumed by
  `toExecutionContext` and passed to `StepExecutor`, `ScreenshotService`, `TraceService`,
  `RunLogger`. The safe migration is to make the run root the **parent** of the existing dirs and
  keep every current field populated. Redefining existing fields breaks all four consumers at once.
- `ScreenshotService.getScreenshotPath` hardcodes `screenshotsRoot/executionId/instanceId/flowId/stepId.png`.
  Changing it changes historical-report path resolution — old reports reference old paths, so any
  change must be additive with a fallback read path.
- `runtime_artifacts` (SQLite) indexes artifact paths; rows written under the old layout must stay
  resolvable. Prefer storing paths relative to the run root going forward, with absolute-path rows
  still readable.
- C-2 applies: the runs root lives under `%LOCALAPPDATA%/SpecterStudio/` or a Settings-configured
  path — never `resources/`.

#### FR-B2 — Immediate failure evidence capture

**Requirement.** Capture screenshot, DOM snapshot, a11y snapshot, console tail, and in-flight network
state **at the moment of each failing attempt**, before any retry, recovery, or navigation.

**Acceptance criteria**

- B2.1 Evidence is captured inside the failing attempt's scope, not after the retry loop.
- B2.2 Each retry attempt produces its own evidence set; attempt *n*'s evidence is never overwritten
  by attempt *n+1*.
- B2.3 Evidence filenames encode `runId`, `flowId`, `stepId`, `pageId`, `attemptId`, and timestamp.
- B2.4 Each failed attempt preserves **all four** of the following, independently:

  ```text
  original exception          ← always primary; never replaced
  attempt-specific evidence   ← screenshot, DOM, a11y, console tail, network state
  trace chunk                 ← existing TraceService.endStep behaviour
  retry decision              ← the RetryPolicy verdict and its reason
  ```

- B2.5 Evidence-capture failure is **appended as a secondary diagnostic** and never replaces,
  masks, or reorders the original automation error. A dead page that cannot be photographed still
  reports the step's real failure as the primary cause.
- B2.6 Capture is bounded — a hung page must not block the failure path indefinitely.

**Change dependencies**

- **This is the ordering fix, and it is the highest-value item in WS-B.** Today's capture lives in
  `FlowExecutor.runStepWithRetries` (`FlowExecutor.ts:446-448`), *after* the loop. Evidence must move
  into `StepExecutor.execute`'s catch block (`StepExecutor.ts:287-307`), which already holds the
  correct scope and already saves the trace chunk there for exactly this reason.
- `step.onFailure?.screenshot ?? true` is the current opt-out and is surfaced in the Flow Designer
  (`flowDesignerTypes.ts:46`) and UI settings (`app/main/uiSettings.ts`). **Preserve the opt-out
  semantics** — users have saved flows that rely on it.
- `StepExecutionResult.screenshotPath` is a single optional string. Per-attempt evidence needs a
  collection. Add an optional `evidence?: StepEvidenceRef[]` and **keep `screenshotPath` populated**
  with the last capture — `FlowExecutor.ts:446` checks `!lastResult.screenshotPath`, and the reports
  UI reads it.
- **Regression risk — cost.** Full-page screenshot + DOM + a11y on every failing attempt, under
  concurrency, is heavy. Route captures through the existing `OperationLimiters` (`limitOp`), which
  already staggers screenshots across instances. Skipping this will degrade throughput under load.

---

### 3.3 WS-C — Identity and state discipline

*Covers recommendations 7, 8.*

#### FR-C1 — Deterministic page identity (defect fix + hardening)

**Requirement.** Every page has exactly one stable identity for its lifetime, assigned by exactly one
owner. Positional aliasing is removed.

**Acceptance criteria**

- C1.1 **One registration mechanism owns the page registry.** Registration is not performed from two
  independent call sites.
- C1.2 A popup opened by a click with a recorded `popupExpectation.popupAlias` is registered under
  **that alias only** — never additionally under a counter-derived key.
- C1.3 A popup opened with no recorded expectation (script-, timer-, or redirect-opened) receives
  **one** deterministic synthetic alias derived from identity-bearing attributes (opener step id +
  target URL origin), not from arrival order.
- C1.4 **Invariant: the same `Page` object is never reachable under more than one alias.** A verifier
  asserts registry values are distinct.
- C1.5 Two popups opening in reversed order across runs resolve to the same aliases in both runs.
- C1.6 A closed-and-reopened popup does not silently inherit the previous page's alias.
- C1.7 Existing recorded aliases (`popup-1`, `popup-2`, …) continue to resolve unchanged.
- C1.8 Every timeline event carries `pageId` (FR-A2).

**Change dependencies**

- **This fixes a live defect.** `PlaywrightRunner.ts:471-479` and `StepExecutor.ts:1255` both
  register the same popup. Removing either path naively breaks the other's contract: the runner
  handler is the only registration for script/timer-opened popups, and the click path is the only
  one that applies the *recorded* alias. The fix must reconcile them in one change, not delete one.
- `PageAlias = "main" | \`popup-${number}\` | string` is a saved-flow type. The `string` arm means new
  id shapes deserialize without a schema change — but **recorded flows contain literal `popup-1`
  aliases**, so those must keep resolving. Back-compat is mandatory, not optional.
- `resolveStepPage` throws a diagnostic listing open aliases; its message is user-facing and should
  stay stable.
- `verify:recorder` and `verify:flow-step-mapping` both cover recorder→step alias propagation.
- **Regression risk — high.** Multi-window flows are among the hardest to test and among the most
  used. Mock-site multi-window scenarios must be extended **before** the fix (C-9), including the
  reversed-open-order case that today's code cannot pass.

#### FR-C2 — Stable frame identity

**Requirement.** Frames get a stable identity independent of their CSS selector.

**Acceptance criteria**

- C2.1 A frame targeted by identity resolves after a non-functional wrapper/class change that would
  break its recorded selector.
- C2.2 Frame identity is recorded at record time and carried through the designer round trip.
- C2.3 Legacy `LocatorContext.frame.selector` continues to resolve unchanged.

**Change dependencies**

- `LocatorContext.frame` feeds `LocatorFactory.buildRoot`, which calls `page.frameLocator(selector)`.
  Identity resolution must degrade to the selector when identity is unavailable.
- **Round-trip fragility is the real risk here.** `app/renderer/components/workflow/flowStepMapping.ts`
  (`toFlowStep` / `fromFlowStep`) is the **single** node↔step mapping site, used by
  `FlowChartDesigner.tsx:492` and `:1113`. Prior work (`awkit-cxa`) fixed a class of silent
  round-trip data loss here; the established rule is **preserve, don't re-derive**. Any new locator
  field must be explicitly carried through both directions and covered by `verify:flow-step-mapping`,
  or it will be silently dropped the first time a user opens and saves the flow.

#### FR-C3 — Mechanical stale-reference invalidation

**Requirement.** Element references are invalidated on navigation, popup creation, page replacement,
and major DOM mutation — enforced at runtime, not documented as guidance.

**Acceptance criteria**

- C3.1 An action attempted against a reference captured before a navigation fails with a clear
  staleness error rather than acting on a wrong element.
- C3.2 Invalidation is driven by observed events, not by step-type heuristics.
- C3.3 Steps that legitimately span a navigation still pass.

**Change dependencies**

- AWKIT is **largely protected already**: locators are re-resolved per step and Playwright locators
  are lazy by design. The genuine exposure is `LocatorFactory.buildRoot`'s resolved container —
  `pickSingle` returns a `Locator` bound to a container element resolved earlier in the same step.
- Scope this narrowly. A broad invalidation layer over a runner that mostly does not need one is
  net-negative complexity. **Recommendation: implement C3 only after FR-A1 provides real lifecycle
  events, and only for the container-scoping path.**

---

### 3.4 WS-D — Locator intelligence

*Covers recommendations 5, 6. Bead: `awkit-v4r`.*

#### FR-D1 — Winner memory (low risk, high value — do this half first)

**Requirement.** Record which locator candidate actually resolved each step, persist it, and expose
locator health statistics.

**Acceptance criteria**

- D1.1 Every successful resolution records the winning candidate's strategy, value, index in the
  candidate list, and the narrowing rule applied (unique / single-visible / enabled / in-viewport).
- D1.2 Winner data is queryable per step across runs.
- D1.3 A step whose primary has stopped winning is surfaced as *degraded*.
- D1.4 **Reordering is advisory by default.** Automatic reordering of saved alternatives, if enabled,
  is user-visible and reversible.
- D1.5 Per the upstream rule: **more than one recovery on the same step means re-record, not
  replay** — the UI must say so rather than silently self-healing forever.

**Change dependencies**

- `LocatorFactory.resolve(step): Promise<Locator>` is called from ~15 sites in `StepExecutor`, nearly
  all in the shape `await (await this.locatorFactory.resolve(step)).click(...)`. **Do not change the
  return type** — every call site would need editing and the inline-await idiom would break. Instead
  add an out-channel: an optional observer callback on the constructor, or a
  `lastResolution` accessor read by `StepExecutor` after the action.
- `CandidateDiagnostic[]` is already built on every resolution and currently used only by
  `formatFailure`. It is the natural carrier — extend it with the winner, do not add a parallel
  structure.
- Persistence needs a new table → migration **version 5** (C-7).
- Locator values can embed user data (a `text=` candidate may contain a name or account number).
  Winner records must pass `SecretMasker` before persistence. See FR-H1.
- **Regression risk — low.** This is additive and observational. It is the right first increment of
  `awkit-v4r`.

#### FR-D2 — Controlled recovery (higher risk — gate it)

**Requirement.** When the primary and every recorded alternative fail, attempt one bounded,
confidence-scored recovery from previously successful locator evidence for the same page and intent.

**Acceptance criteria**

- D2.1 Recovery attempts are limited to **one** per step per run.
- D2.2 Every attempt produces a confidence score and a full log of what was tried and why.
- D2.3 Recovery is **disabled** for steps whose `sideEffectLevel` is `dangerousMutation` or
  `externalCommit` — no confidence score authorizes guessing at a Delete or Submit control.
- D2.4 A recovered locator is **never** persisted to the saved flow without explicit user review.
- D2.5 Recovery is off by default and opt-in per workflow.
- D2.6 Recovery never widens scope: a candidate outside the recorded container/frame context is
  rejected regardless of score.

**Change dependencies**

- `resolveStepSafety` (`StepSafetyPolicy.ts:46`) already yields the classification D2.3 needs, and
  `guardLocatorQuality` (`StepExecutor.ts:326-336`) already establishes the precedent that sensitive
  steps refuse fragile locators. **Reuse both.** Recovery that ignores this precedent would
  reintroduce the exact "wrong privileged action" risk that guard was written to close.
- Depends on FR-D1 for its evidence corpus. Do not build D2 first.
- **Regression risk — high, and it is a *correctness* risk, not a performance one.** A wrong-element
  click on a banking or enterprise workflow is the worst failure this product can produce. The
  conservative posture of `narrowToActionable` — *"still ambiguous — do not guess"* — is deliberate.
  D2 must extend it without inverting it.

---

### 3.5 WS-E — Result semantics and assertions

*Covers recommendations 12, 13, 14.*

#### FR-E1 — Structured step assertions

**Requirement.** Every assertion produces a machine-readable record: assertion id, kind, expected,
actual, operator, outcome, rigor tier, and evidence refs.

**Acceptance criteria**

- E1.1 A failing assertion records expected and actual values, not only an error string.
- E1.2 A passing assertion records the same structure with `outcome: "pass"`.
- E1.3 Assertion records are queryable and comparable across runs.
- E1.4 Expected/actual values pass `SecretMasker` before persistence.
- E1.5 Records land in `findings.json` (FR-B1) and the report.

**Change dependencies**

- `assertText`/`assertVisible` currently write the literal `{ assertionResult: true }` into
  `outputs` (`StepExecutor.ts:1433-1444`). That key is a **published output** that saved flows may
  reference via `flowOutputs` expressions and connector conditions
  (`ConnectorConditionEvaluator`, `ExpressionEvaluator`). **Keep writing it**; add the structured
  record alongside. Removing or retyping it silently breaks conditional routing in existing
  workflows — a class of failure that shows up as a wrong branch taken, not as an error.
- `NodeConfig.assertionType` (`visible` | `text` | `value` | `count` | `url`) and
  `comparisonOperator` are the existing vocabulary; the record should reuse them verbatim.

#### FR-E2 — `INCONCLUSIVE` and the terminal result set

**Requirement.** Introduce `inconclusive` as a first-class result for when a required baseline,
fixture, test account, expected file, or comparison artifact is missing.

**Acceptance criteria**

- E2.1 A step whose prerequisite is absent reports `inconclusive`, never `passed`.
- E2.2 The result names the missing prerequisite.
- E2.3 `inconclusive` is visually distinct from both pass and fail in reports and the Instance Monitor.
- E2.4 Release-gate logic treats `inconclusive` as **not passed**.
- E2.5 **Connector routing does not treat `inconclusive` as an ordinary business failure.** It is
  *not passed*, but it must not silently traverse a `failure` link unless the connector is
  explicitly configured to route it there. Rationale: failure branches commonly perform compensating
  business actions — rollback, refund, cancellation, notification. A missing test fixture must never
  be able to trigger one. Default behaviour is to halt the path and report, exactly as an
  unroutable result does today.
- E2.6 The routing decision for `inconclusive` is recorded in `docs/ai/DECISIONS.md` before
  implementation, not inferred from code.
- E2.7 Existing runs and stored history render unchanged.

**Change dependencies**

- **This is the widest-blast-radius change in the SRS.** `StepExecutionStatus` (`RunnerResult.ts:5`)
  is consumed by:
  - `FlowExecutor` status mapping and `handleFailure` routing,
  - `PlaywrightRunner.executeScenario`'s flow-result branching (`result.status === "failed"` drives
    connector routing — `PlaywrightRunner.ts:260-272`),
  - `StepExecutor.emitProgress`'s `LiveStepStatus` mapping (`StepExecutor.ts:263`),
  - `RuntimeStateMachine` / `FlowRunStatus`,
  - `runtime_runs.status` and `runtime_node_attempts.status` (persisted strings),
  - the reports and Instance Monitor renderers,
  - the durable-store aggregation queries (`success`/`failed`/`cancelled` counters in
    `WorkflowHistoricalStats`, `FailureAtPressure`, trend buckets).
- **Mandated method**, in order:

  1. Add `"inconclusive"` to the discriminated union — and nothing else in the same commit.
  2. Run `tsc --noEmit`.
  3. Resolve **every** compiler-reported consumer explicitly. No blanket `default:` arms added to
     silence the exhaustiveness check.
  4. Add a separate persisted and aggregated counter (see below).
  5. Define connector-routing behaviour deliberately per E2.5, recorded in `DECISIONS.md`.
  6. Update IPC payloads, reports, live status, and historical analytics.
  7. **Never widen the status to `string`** to make it compile — that discards the only safety net
     available for this change.
- Aggregation queries must decide explicitly whether `inconclusive` counts toward `failureRate`.
  Recommendation: a separate counter, excluded from both `success` and `failed`, so historical
  success rates stay comparable across the change.
- `verify:ipc-contract` does not cover payload *shapes*; a widened status crossing IPC will not be
  caught statically. `verify:reports` and the Instance Monitor GUI verifier must be extended.

#### FR-E3 — Validation rigor hierarchy

**Requirement.** Tag each assertion with its evidence tier and prefer the strongest available:
(1) deterministic JS/data assertion, (2) a11y snapshot match, (3) before/after snapshot diff,
(4) screenshot visual judgment.

**Acceptance criteria**

- E3.1 Every assertion record carries a tier.
- E3.2 Reports surface the tier distribution for a run.
- E3.3 A tier-4-only validation is flagged as weak evidence.
- E3.4 Existing assertions map to their honest tier — no retroactive promotion.

**Change dependencies**

- Mostly a metadata addition over FR-E1; low regression risk.
- Applies equally to AWKIT's own GUI verifiers (see FR-I1) — several currently assert on screenshots
  where a deterministic DOM evaluation is available.

---

### 3.6 WS-F — Recorder fidelity

*Covers recommendations 4, 16, 17, 18. Bead: `awkit-60w`.*

#### FR-F1 — Numeric record-to-replay fidelity

**Requirement.** Report replay as a measured percentage with a breakdown, not a boolean.

```text
Successful replayed steps: 87 / 100
Replay fidelity: 87%
Recovered locator steps: 6
Unrecoverable steps: 7
```

**Acceptance criteria**

- F1.1 Fidelity = successfully replayed actions ÷ recorded actions, with both operands reported.
- F1.2 The baseline contains **real interactions** — click, fill, wait, download, popup handling —
  not only navigation and screenshots. A baseline of trivial steps is a defect in the metric.
- F1.3 The breakdown separates clean successes, recovered steps, and unrecoverable steps.
- F1.4 Fidelity is tracked over time so gradual recorder degradation is visible as a trend.
- F1.5 The gate threshold is configurable and its current value is reported alongside the score.

**Change dependencies**

- **The upstream cautionary tale is the whole point of this FR.** The reference implementation's
  "≥80% fidelity gate" actually asserted that a snapshot file was non-empty — its `orig_steps` and
  `replay_steps` were hardcoded and never compared. A fidelity verifier that cannot fail for the
  reason it claims is worse than no verifier, because it is quoted as evidence.
- Requires a stable mock-site baseline scenario (C-9) exercising every interaction class.
- Interacts with FR-D1: "recovered" is only measurable once winner memory exists.
- This is the natural home for the round-trip regression guard: fidelity would surface
  `awkit-cxa`-class silent data loss as a declining trend rather than as a bug found by hand.

#### FR-F2 — Preserve the interaction primitive

**Requirement.** Record and replay *how* input occurred: `fill`, real keystrokes, paste, keyboard
shortcut, select option, or programmatic JS.

**Acceptance criteria**

- F2.1 `RecordedAction` carries the input method.
- F2.2 Replay reproduces the recorded method.
- F2.3 An autocomplete field that requires real keystrokes replays correctly — the concrete
  regression this FR exists to prevent.
- F2.4 Legacy actions with no recorded method replay as `fill` (today's behaviour, unchanged).

**Change dependencies**

- `RecordedAction` (`RecorderTypes.ts:19`) and `FlowStep` both gain an optional field (C-8).
- `flowStepMapping.ts` must carry it both directions (see FR-C2's round-trip warning).
- `StepExecutor`'s `fill` case (`:1346`) gains a branch. `step.config.clearBeforeFill` semantics must
  be preserved for each method.
- `recorderInitScript.ts` must capture the method **without** capturing values on protected surfaces.
  See FR-H3 — this is where an innocuous-looking fidelity feature becomes a secrets-exposure risk.

#### FR-F3 — Rehearse-before-record

**Requirement.** Before producing a saved recording: discover visible interactive elements, validate
every selector, fail loudly with the available elements listed when one is missing, and only then
perform the final recording.

**Acceptance criteria**

- F3.1 An invalid selector aborts with a list of what was actually available.
- F3.2 Invalid dropdown values and assumed field types are caught before the recording is saved.
- F3.3 Rehearsal is skippable for quick recordings.

**Change dependencies**

- Additive to `RecorderService`; no runner impact.
- Must **not** run on a protected-login surface — rehearsal enumerates page elements, which is
  exactly what FR-H3 forbids there.

#### FR-F4 — Pagination state and continuation cursors

**Requirement.** Capture pagination state / continuation cursors for table pagination, infinite
scroll, and API cursor navigation.

**Acceptance criteria**

- F4.1 A recorded extraction workflow replays independently from its captured cursor state.
- F4.2 Pause/resume across an interruption preserves position.
- F4.3 No hidden runtime state is required for replay.

**Change dependencies**

- Additive to `RecordedAction` and `FlowStep` (C-8), through `flowStepMapping.ts` (FR-C2 warning).
- Cursors frequently embed account, tenant, or user identifiers → `SecretMasker` before persistence
  (FR-H1).
- Lowest priority in WS-F; schedule after F1 and F2.

---

### 3.7 WS-G — Lifecycle and resource accounting

*Covers recommendations 9, 10.*

#### FR-G1 — Explicit lifecycle staging with bounded readiness

**Requirement.** Make the five stages explicit and instrumented: launch → bounded readiness poll →
attach runtime → run → guaranteed cleanup. Readiness uses a limited retry budget; on exhaustion the
system fails clearly or offers manual intervention. No blind relaunch loops.

**Acceptance criteria**

- G1.1 Each stage emits a timeline event with duration.
- G1.2 Readiness polling has a bounded attempt count and total timeout.
- G1.3 Budget exhaustion produces a diagnosable error naming the stage that failed.
- G1.4 Cleanup is guaranteed on success, failure, cancellation, **and app shutdown**.
- G1.5 No orphaned Chromium process survives a normal or abnormal run end.

**Change dependencies**

- Much of this exists. `assertRuntimeAlive` with `stableForMs` already re-checks after a delay;
  `finally` already guarantees `closeRuntime`; generation tracking already suppresses stale events.
  **Scope this as instrumentation plus the readiness poll — not a rewrite.**
- **Fix the mislabeled close reason — and scope the claim correctly.** `PlaywrightRunner.ts:282`
  closes with `"execution-failed-cleanup"` on *every* exit path, including success.

  **Verified blast radius (narrower than it first appears).** `BrowserCloseReason` is consumed in
  exactly two places: the structured log line at `PlaywrightRunner.ts:402`, and `onRuntimeClosing` —
  whose sole consumer, `ExecutionEngine.ts:1334`, destructures `({ generation })` and **discards the
  reason entirely**. It is a *different* enum from `SharedBrowserCloseReason`
  (`SharedBrowserPool.ts:48`), which is what actually feeds `runtime_browser_lifecycle_buckets` and
  `BrowserPoolEffectiveness.closeReasons` via `RuntimeObservationCollector`. The two never meet.

  Therefore: this is a **log-truthfulness defect, not an analytics-contamination defect**. Pool
  analytics are unaffected, capacity decisions are unaffected, and **the change note must not claim
  close-reason distributions will shift** — they will not. It is still worth fixing promptly: a
  passing run whose log reads `closing runtime (execution-failed-cleanup)` actively misleads anyone
  debugging, and the mislabel would become load-bearing the moment FR-A2 puts lifecycle events on
  the timeline.

  **Enum reconciliation.** The existing union is `reuse-session-swap-old-runtime | instance-stop |
  execution-failed-cleanup | user-request | app-shutdown | launch-failed-cleanup`. The fix should
  **add** the missing terminal states rather than rename the existing ones:
  - add `execution-completed-cleanup` (the actual gap — success currently has no reason of its own);
  - add `execution-cancelled-cleanup` **only if** it is distinguished from the existing
    `user-request`, which the cancel path already uses; otherwise reuse `user-request`;
  - keep `app-shutdown` and `reuse-session-swap-old-runtime` as-is — renaming them to
    `application-shutdown` / `runtime-restart` churns existing log-grep habits for no behavioural gain;
  - **do not add `browser-crash`.** `onRuntimeClosing` is documented as announcing *intentional*
    teardown so the pool does not score it as a crash. A crash reason on that channel would invert
    the very semantics that keep crash-rate backpressure honest.
- App-shutdown cleanup involves the Electron main lifecycle and `StartupRecovery`. Verify against
  `verify:single-instance` and `validate:offline`.

#### FR-G2 — Per-resource cleanup ledger

**Requirement.** Track each run-scoped resource independently — browser context, page, temporary
profile dir, trace chunk, CDP session, download dir, lock lease — and report whether each was
released. Task completion must not imply resource release.

**Acceptance criteria**

- G2.1 The ledger is written into `manifest.json` (FR-B1).
- G2.2 An unreleased resource is reported even when the run itself passed.
- G2.3 Leaked resources are surfaced in the Instance Monitor, not only in logs.
- G2.4 The ledger distinguishes *released*, *leaked*, and *not applicable*.

**Change dependencies**

- `BrowserProcessManager`, `ResourceLockManager`, and `WatchdogService.cleanupStale` each own part of
  this today. The ledger should **read** from them rather than re-implement tracking, or the two
  views will drift and the ledger will be the one users stop trusting.
- Concurrency capacity accounting depends on accurate release. A ledger that reports leaks the
  admission controller does not know about is a signal that one of the two is wrong — treat any
  disagreement as a bug in whichever is newer.

---

### 3.8 WS-H — Safety boundary

*Covers recommendations 21, 22, 23, 24, 25. **Security-critical — see also §5.***

#### FR-H1 — Runtime-enforced invariants beneath the node layer

**Requirement.** Redaction, domain allowlisting, action approval, credential protection, resource
cleanup, and audit logging are enforced in the runtime, below any node or tool layer, so no
alternative execution path can bypass them.

**Acceptance criteria**

- H1.1 Every disk/log/IPC sink passes `SecretMasker` **inside** the sink, not at each call site.
- H1.2 A new node type added without knowledge of these rules is still subject to them.
- H1.3 Enforcement decisions are auditable per run.
- H1.4 A verifier proves enforcement cannot be bypassed by calling a lower-level API directly.

**Change dependencies**

- **AWKIT already gets the hardest part right, and the pattern must be preserved verbatim.**
  `RunLogger.log` and `MemoryRunnerLogger.log` apply `SecretMasker` internally, so a caller cannot
  forget to mask. Every new sink — CDP events (FR-A2), assertion records (FR-E1), winner memory
  (FR-D1), pagination cursors (FR-F4) — **must** follow that shape.
- **The single largest new secret-exposure surface in this SRS is FR-A1/A2.** CDP
  `Network.requestWillBeSent` and `Network.responseReceived` carry full URLs, request headers, and
  POST bodies — i.e. `Authorization` headers, session cookies, form-posted passwords. Today AWKIT
  logs only origin + path (`RunLogEvent.currentUrl` is documented as such) precisely to avoid this.
  Requirements:
  - Header and body capture default **off**.
  - A header **denylist** (`Authorization`, `Cookie`, `Set-Cookie`, `Proxy-Authorization`, `X-API-Key`)
    applied before masking, not after.
  - Query strings stripped to origin + path by default, matching today's behaviour.
  - POST bodies never captured at `standard` tier.

#### FR-H2 — Domain capability boundary

**Requirement.** A workflow may optionally be restricted to approved domains and origins. Navigation,
requests, popups, and redirects outside the allowlist are blocked or require approval.

**Acceptance criteria**

- H2.1 Off by default; existing workflows are unaffected.
- H2.2 When enabled, an out-of-allowlist navigation is blocked with a clear, actionable message.
- H2.3 Popups and redirects are subject to the same boundary as top-level navigation.
- H2.4 Blocks are audited with the attempted origin.
- H2.5 The boundary is enforced in the runtime, not by node configuration alone (FR-H1).
- H2.6 The runtime exposes approved actions only — **no raw CDP command passthrough**, ever.

**Change dependencies**

- `urlPolicy.ts` is the existing seam and its current design is deliberate: it blocks `file:`,
  `chrome:`, `chrome-extension:`, `devtools:`, `javascript:` and **intentionally permits private
  networks**, because AWKIT legitimately automates internal and localhost applications. **Do not
  narrow the default.** The domain allowlist is an opt-in layer above the scheme policy, not a
  replacement for it.
- `assertNavigableUrl` is called from the `goto` case. Popup and redirect enforcement has **no
  equivalent call site today** — that is new interception, and it is where the regression risk lives:
  over-broad interception silently breaks OAuth redirect chains and SSO hops, which are exactly the
  flows that matter most to enterprise users.
- H2.6 is **already true** and is a security property worth protecting explicitly: the HTTPS-trust
  work confirmed AWKIT has no CDP attach path anywhere. FR-A1 introduces the first one. It must be
  read-only and internal, never reachable from a workflow node, a saved profile, or IPC.

#### FR-H3 — Protected-login recording restrictions

**Requirement.** On a protected surface, record only field names and redacted placeholders. Never
record a code, password, OTP, CAPTCHA value, cookie, or token.

**Acceptance criteria**

- H3.1 No secret value reaches the draft, the log, the timeline, or any artifact.
- H3.2 Field identity is preserved so the flow remains editable.
- H3.3 Every new recorder capability (FR-F2 input method, FR-F3 rehearsal, FR-F4 cursors) is
  explicitly evaluated against this rule before it ships.

**Change dependencies**

- Already implemented for today's recorder surface and covered by the protected-login detector
  verifiers, which the working-branch memory flags as **regression-critical**.
- **FR-F2 is the live risk.** Capturing "how the user typed" is one small step from capturing "what
  the user typed". The input-method field must be an enum of methods, never a keystroke sequence.
- FR-F3 rehearsal enumerates page elements — it must be suppressed on protected surfaces.
- The existing pause/close/hand-off sequence — detect → pause → preserve draft → close automation
  browser → hand off to real Chrome → link session to `Reuse Session` — must not be weakened by any
  requirement here.

#### FR-H4 — Opaque session state (explicitly **rejected** change)

**Requirement.** The protected-login session design stays as-is. AWKIT **must not** add cookie-value
extraction, token entropy scanning, or any secret classification to `SessionCaptureService`.

**Rationale.** The upstream report's v1 recommended adopting reference-implementation cookie entropy
scanning; reading the code reversed that conclusion. The reference needs a scanner because it *pulls
cookies out* via `document.cookie` and must then guess what is a secret. AWKIT never extracts cookie
values at all — it launches the user's real Chrome/Edge against a dedicated `--user-data-dir` and
keeps the profile directory opaque. **A vault you never open needs no scanner.** Adding extraction
would create the exposure the scanner then exists to manage.

**Change dependencies**

- `SessionCaptureService`'s header invariant — *"No CDP connection. No automation flags. No secrets
  logged. No stealth/anti-detection code."* — is a **hard constraint on FR-A1**. The CDP observation
  client must be structurally incapable of attaching to a session-capture browser. This is the single
  most important interaction between two workstreams in this document: the observability work and the
  protected-login work touch the same object (a browser process) with opposite security postures.
- Recorded here so the entropy-scanning idea is not re-proposed by a future session reading only the
  v1 summary.

#### FR-H5 — Page content is untrusted input

**Requirement.** Text found in a page is never treated as an instruction. This binds any future
AI-assisted diagnosis, suggestion, or self-healing feature.

**Acceptance criteria**

- H5.1 Page-derived text cannot alter workflow policy, security settings, or allowlists.
- H5.2 AI assistance is subordinate to runtime rules — it may propose, never enforce.
- H5.3 Page content included in a diagnosis prompt is clearly delimited as data.

**Change dependencies**

- No AWKIT feature ingests page text as instruction today, so this is currently vacuous — and that is
  worth stating, because it becomes live the instant FR-A2's timeline is fed to any AI diagnosis
  feature. The unified timeline will contain attacker-controlled strings: console messages, page
  titles, response bodies. **The timeline is evidence, not instruction.**

---

### 3.9 WS-I — Verification credibility

*Covers the "Important Verification Change" section and recommendation 19.*

#### FR-I1 — Verifier classification

**Requirement.** Every `verify:*` script declares its class:

```text
Documentation consistency
Static source validation
Unit test
Integration test
Real browser test
Packaged application test
Clean-machine acceptance test
```

**Acceptance criteria**

- I1.1 All 94 `verify:*` scripts carry a class.
- I1.2 Each verifier answers, in its header: *what realistic regression would make this test fail?*
- I1.3 Summary output reports counts **per class** — never one undifferentiated total.
- I1.4 A verifier that cannot fail for the reason it claims is a defect, and is fixed or deleted.
- I1.5 Structural checks are never presented as runtime validation.

**Change dependencies**

- No production-code impact. Pure verification-infrastructure change; can proceed independently of
  every other workstream, and is the **cheapest item in this SRS**.
- Expect the audit to reclassify some current pass counts downward. That is the intended outcome, not
  a regression — but it must be communicated as such, because those counts appear in
  `docs/ai/CURRENT_STATE.md` and in prior task-log entries.
- Existing exemplars to classify *against*: `verify-ipc-contract.mts` is genuine static contract
  enforcement (it fails when a handler is renamed, duplicated, or orphaned); a verifier that greps a
  markdown file for a required word is not in the same class and must not be counted with it.

#### FR-I2 — Step-paired visual regression

**Requirement.** Compare matching steps between two runs, not only final screenshots. Use pixel diff,
a11y-tree diff, missing/unmatched step detection, ignore regions for dynamic content, and a fixed
viewport and device scale.

**Acceptance criteria**

- I2.1 Reports name the first diverging step, not just "the runs differ".
- I2.2 A11y-tree diff is available and preferred over raw HTML comparison (more stable).
- I2.3 Ignore regions suppress clocks, ads, and dynamic data.
- I2.4 Viewport and device scale are pinned for comparison runs.
- I2.5 A missing baseline yields `INCONCLUSIVE` (FR-E2) — **never** pass.

**Change dependencies**

- Requires FR-B1 (addressable runs to compare), FR-E2 (`INCONCLUSIVE`), and step-level evidence
  pairing from FR-B2.
- Any diff library must be offline and free of native ABI requirements (C-1, and the same constraint
  that drove the `sql.js` choice).
- Baseline storage is user data under `%LOCALAPPDATA%` (C-2), and needs a retention policy — image
  baselines grow fast.
- **Lowest priority in this SRS.** It depends on three other workstreams and delivers value only
  after they land.

---

## 4. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-1 | Observation overhead ≤ 5% wall-clock on a representative mock-site run at default tier, measured A/B. |
| NFR-2 | Per-run artifact footprint bounded and reported; retention/purge user-controllable. |
| NFR-3 | All new work is fully offline (C-1) and writes only to user-data paths (C-2). |
| NFR-4 | `tsc --noEmit` stays clean (C-3). |
| NFR-5 | All saved-flow additions are optional and backward compatible (C-8); an old profile opened and saved by a new build must round-trip losslessly. |
| NFR-6 | New UI uses Hologram tokens only (C-5). |
| NFR-7 | Observation, recovery, domain boundary, and evidence capture each default **off** or **to today's behaviour**; no default changes without an explicit decision recorded in `docs/ai/DECISIONS.md`. |
| NFR-8 | No new native dependency; WASM/pure-JS only. |
| NFR-9 | Every new failure mode produces an actionable, end-user-readable message — matching the standard already set by `LocatorFactory.formatFailure`. |

---

## 5. Security Requirements

Consolidated because the user request calls this out explicitly. Each item is a gate, not a guideline.

| ID | Requirement | Why it matters here |
|---|---|---|
| SEC-1 | The CDP observation client is **read-only**, enforced by a module-level command allowlist and a verifier — not by convention. | FR-A1 introduces AWKIT's first CDP attach path. Today there is none, anywhere. |
| SEC-2 | The CDP client is structurally incapable of attaching to a `SessionCaptureService` browser. | FR-H4. The real-Chrome profile is the one place where the user's actual credentials live. |
| SEC-3 | CDP network capture defaults to origin + path. Headers and bodies are opt-in, with `Authorization` / `Cookie` / `Set-Cookie` / `Proxy-Authorization` / `X-API-Key` denylisted before masking. | The largest new secret-exposure surface in this SRS. |
| SEC-4 | Masking is applied **inside** every sink, never at call sites. | The existing `RunLogger` pattern. A single unmasked sink defeats every other control. |
| SEC-5 | No cookie extraction, no token entropy scanning, no secret classification is added to session capture. | FR-H4, explicitly rejected. |
| SEC-6 | Locator recovery is disabled for `dangerousMutation` and `externalCommit` steps regardless of confidence score. | FR-D2.3. A wrong click on Submit/Delete/Approve is the worst outcome this product can produce. |
| SEC-7 | Recovered locators are never auto-persisted to a saved flow without user review. | FR-D2.4. Silent self-modification of an audited automation asset. |
| SEC-8 | Recorder never captures secret values on protected surfaces; the input-method field is an enum, never a keystroke sequence. | FR-H3, and the specific trap in FR-F2. |
| SEC-9 | No raw CDP command passthrough is exposed to a workflow node, saved profile, IPC channel, or user-supplied script. | FR-H2.6. Currently true; FR-A1 is the first thing that could break it. |
| SEC-10 | Timeline content — console text, page titles, response bodies — is treated as untrusted data, never as instruction. | FR-H5. Becomes live the moment any AI feature reads the timeline. |
| SEC-11 | Domain allowlist blocks are audited with the attempted origin; the default remains permissive so internal/localhost automation keeps working. | FR-H2. Narrowing the default would break legitimate enterprise use. |
| SEC-12 | No new IPC channel is exposed to the renderer unless it needs to be; otherwise it goes in `BACKEND_ONLY`. | C-6. The preload bridge is the renderer's entire attack surface. |
| SEC-13 | Observation failure — attach, event handling, or detach — never affects workflow correctness. Observation is diagnostic, never load-bearing. | FR-A1.3. An observer that can fail a run is a new failure mode bolted onto a working one. |
| SEC-14 | Observation ships **disabled by default** and stays disabled until differential testing proves both acceptable overhead (NFR-1) and identical run outcomes with it on and off. | Tranche 5 exit criteria. The default flip is a separate, explicitly recorded decision. |

---

## 6. Recommended sequencing

Dependency-ordered. Each tranche is independently shippable and independently revertible.

**Framing:** AWKIT does **not** need a broad rewrite. It needs several targeted correctness fixes,
followed by carefully isolated observability work. The tranches below reflect that.

| Tranche | Contents | Exit criteria |
|---|---|---|
| **0 — Reporting truthfulness** | FR-I1 (classify all 94 verifiers); fix the inert `screenshotOnFailure` precedence (FR-A4 dep); fix the mislabeled success close reason (FR-G1 dep). | Both corrections carry regression tests proving the old behaviour is gone. Per-class verifier counts replace the single total. **Repairs misleading system output before new evidence and analytics are layered on top of it.** |
| **1 — Evidence correctness** | FR-B2 (capture inside each failed attempt); FR-B1 (addressable run layout, introduced incrementally). | `screenshotPath` compatibility field still populated; attempt-scoped evidence refs added; original exception always primary. Immediate debugging value with **zero CDP risk**. |
| **2 — Page identity** | FR-C1 (single registry owner, dual-registration fix); FR-C2 (frame identity, as a separate change). | Reversed-popup-order and script-opened-popup mock-site scenarios exist and pass; legacy `popup-N` aliases still resolve. **Must land before any event or screenshot relies on `pageId`.** |
| **3 — Result semantics** | FR-E1 (structured assertions); FR-E2 (`INCONCLUSIVE`); FR-E3 (rigor tiers). | Store, report, IPC, routing, and aggregation all updated; routing decision recorded in `DECISIONS.md`. **Keep focused — blast radius exceeds any single observability change.** |
| **4 — Locator winner memory** | FR-D1 **only**. | Observational tracking lands without automatic recovery. Do **not** combine with FR-D2. Most of `awkit-v4r`'s value at little correctness risk. |
| **5 — CDP observation** | FR-A1, FR-A2, FR-A4, FR-A3. | Gated on **all five**: secret filtering implemented (FR-H1/SEC-3); page identity stable (Tranche 2); assumption A-1 empirically verified; one shared attach helper agreed with `awkit-4km`; differential tests prove the observer does not change workflow outcomes. |
| **6 — Lifecycle & recorder** | FR-G1 (remaining instrumentation + readiness poll), FR-G2, FR-F1, FR-F2, FR-F3. | FR-F1 needs FR-D1 to measure "recovered". |
| **7 — Deferred / gated** | FR-D2 (recovery), FR-H2 (domain boundary), FR-C3 (invalidation), FR-F4 (cursors), FR-I2 (visual regression). | Each is high-risk, low-urgency, or dependent on three prior tranches. |

### 6.1 Branch discipline

- The working branch `feature/recorder-protected-login-and-async-awareness` stays **frozen at
  `61f6099`** until the clean-machine acceptance gate clears. **No fix in this document may be
  applied to that branch before then** — including the four discovered defects, however small.
- After acceptance, **each tranche takes its own branch and its own promotion decision.**
- **The four discovered defects must not be bundled into the CDP implementation branch.** They are
  independent correctness fixes with independent value; attaching them to the highest-risk
  workstream in this SRS would make them hostage to its review and its rollback.
- `SRS-CANVAS-UX-001` is a separate front-end workstream and stays independent of this runner /
  observability program. There is no technical dependency between them; combining them would widen
  regression scope for no benefit.

---

## 7. Change-dependency and regression map

The consolidated view. A change to any left-hand contract requires re-verifying everything on its row.

| Contract | Location | Touched by | Regression exposure | Guarding verifier |
|---|---|---|---|---|
| `StepExecutionStatus` union | `src/runner/RunnerResult.ts:5` | FR-E2 | **Widest in this SRS.** Flow/scenario status mapping, connector routing on `status === "failed"`, `LiveStepStatus` mapping, `RuntimeStateMachine`, persisted `runtime_runs.status` + `runtime_node_attempts.status`, all aggregation counters, reports + Instance Monitor renderers. | `tsc --noEmit` exhaustiveness; `verify:runner`; `verify:reports` |
| `LocatorFactory.resolve()` signature | `src/runner/LocatorFactory.ts:60` | FR-D1, FR-D2 | ~15 call sites in `StepExecutor` using the `await (await resolve(step)).action()` idiom. **Do not change the return type** — use an out-channel. | `verify:recorder`; `verify:runner` |
| `assertionResult` output key | `src/runner/StepExecutor.ts:1435,1443` | FR-E1 | Published into `outputs` → readable by `flowOutputs` expressions and connector conditions. Removing/retyping it breaks conditional routing **silently** (wrong branch, not an error). | `verify:runner`; `verify:async-review` |
| `flowStepMapping.ts` round trip | `app/renderer/components/workflow/flowStepMapping.ts` | FR-C2, FR-F2, FR-F4 | **The** node↔step mapping site (`FlowChartDesigner.tsx:492`, `:1113`). Known-fragile — `awkit-cxa` fixed silent field loss here. Any new field not explicitly carried both ways is dropped on first open-and-save. Rule: **preserve, don't re-derive.** | `verify:flow-step-mapping` |
| Popup alias assignment | `PlaywrightRunner.ts:471-479` + `StepExecutor.ts:1255` | FR-C1 | Dual registration of one popup; positional counter key. Removing either path alone breaks the other's case (script-opened popups vs. recorded aliases). | `verify:recorder`; mock-site multi-window (needs extension) |
| `InstanceRuntimePaths` | `src/instances/InstanceRuntimeState.ts:8` | FR-B1 | Consumed by `toExecutionContext`, `StepExecutor`, `ScreenshotService`, `TraceService`, `RunLogger`. Make the run root the parent; keep all current fields populated. | `verify:runner`; `verify:reports` |
| `ScreenshotService.getScreenshotPath` | `src/reports/ScreenshotService.ts` | FR-B1, FR-B2 | Historical reports reference old paths. Changes must be additive with a fallback read path. | `verify:reports` |
| Browser generation swap | `PlaywrightRunner.ts:147-204` | FR-A1 | CDP client must re-attach per generation and honour stale-generation suppression, or events land on the wrong browser. | `verify:shared-browser-live`; `verify:runner` |
| `onRuntimeClosing` (expected-close signal) | `PlaywrightRunner.ts:401` → `ExecutionEngine.ts:1334` | FR-A1 | Sole consumer calls `markExpectedClose(slot, generation)` so teardown is not scored as a crash. A CDP detach that races teardown and emits a synthetic crash signal would silently tighten crash-rate backpressure app-wide. | `verify:browser-pool`; `verify:adaptive-concurrency` |
| `BrowserCloseReason` string | `PlaywrightRunner.ts:32,282` | FR-G1 | **Log text only.** The reason is discarded by `onRuntimeClosing`'s consumer and is a *different* enum from `SharedBrowserCloseReason`, which is what feeds `runtime_browser_lifecycle_buckets`. Fixing the mislabel does **not** shift pool analytics. Becomes load-bearing once FR-A2 puts lifecycle events on the timeline. | `verify:runner` (log assertions) |
| `WatchdogInstanceView` | `src/runner/runtime/WatchdogService.ts:15` | FR-A3 | Every caller constructs this view. New signals must be optional with heartbeat-only fallback. False positives mark healthy runs failed → ship observe-only first. | `verify:concurrency`; `verify:locks` |
| `RUNTIME_STORE_MIGRATIONS` | `src/runner/store/RuntimeStoreSchema.ts` | FR-D1, FR-A3, FR-B1 | Currently max version **4**; forward-only, run-once. New tables need v5+. Existing rows must stay readable. | `verify:durable-accuracy`; `verify:profile-store` |
| IPC channel contract | `app/main/ipc/*` + `preload.ts` | any new surface | Exactly one handler per channel; exposed via preload **or** in `BACKEND_ONLY`; no stale entries. Payload *shapes* are **not** statically checked — a widened status crossing IPC will not be caught. | `verify:ipc-contract` |
| `SecretMasker` sink discipline | `RunLogger.ts`, `RunnerResult.ts:60` | FR-A2, FR-D1, FR-E1, FR-F4 | Masking lives inside sinks so callers cannot forget. Every new sink must copy the shape. One unmasked sink defeats every other control. | `verify:secrets`; `verify:security` |
| `urlPolicy` scheme allowlist | `src/runner/urlPolicy.ts` | FR-H2 | Deliberately permits private networks. **Do not narrow the default** — internal/localhost automation is a core use case. Popup/redirect interception is new surface with no existing call site. | `verify:security`; `verify:runner` |
| `SessionCaptureService` invariants | `src/session/SessionCaptureService.ts` | FR-H4 (as a **constraint** on FR-A1) | "No CDP connection. No automation flags. No secrets logged." The observability and protected-login workstreams touch the same object with opposite security postures. | protected-login detector verifiers (**regression-critical**) |
| `resolveStepSafety` classification | `src/runner/runtime/StepSafetyPolicy.ts:46` | FR-D2 | Supplies the `dangerousMutation` / `externalCommit` gate for SEC-6. Extending recovery must not invert `narrowToActionable`'s "do not guess" posture. | `verify:runner`; `verify:workflow-sentinels` |

---

## 8. Acceptance criteria (document level)

This SRS is accepted when:

1. Every recommendation in the source summary appears in §2.1 with a status and code evidence, or in
   §9 as explicitly deferred/rejected with a reason.
2. Every FR has testable acceptance criteria and a named change-dependency set.
3. Every security-relevant change appears in §5 with a stated gate.
4. Every contract in §7 names the verifier that guards it.
5. No requirement contradicts C-1 … C-10.
6. The rejected item (FR-H4) is recorded with enough rationale that a future session reading only the
   v1 summary does not re-propose it.

Implementation acceptance is per-tranche and requires: `npm run build` clean; `npm run verify:runner`
with its pass count reported; the tranche's named verifiers green; mock-site scenarios extended where
C-9 applies; and — for anything touching packaging or offline behaviour — `npm run validate:offline`.

---

## 9. Traceability

| Rec # | Title | Status | FR | Bead | Tranche |
|---|---|---|---|---|---|
| 1 | Read-only CDP observation | Absent | FR-A1 | `awkit-4a6` | 5 |
| 2 | Unified execution timeline | Partial | FR-A2 | `awkit-4a6` | 5 |
| 3 | Addressable run artifact | Partial | FR-B1 | `awkit-4a6` | 1 |
| 4 | Record-to-replay fidelity | Absent | FR-F1 | `awkit-60w` | 6 |
| 5 | Locator winner memory | Absent | FR-D1 | `awkit-v4r` | 4 |
| 6 | Controlled locator recovery | Absent | FR-D2 | `awkit-v4r` | 7 |
| 7 | Snapshot-before-action | Partial | FR-C3 | — | 7 |
| 8 | Stable page/frame identity | Partial (**defect**) | FR-C1, FR-C2 | — | 2 |
| 9 | Lifecycle staging | Partial | FR-G1 | — | 6 |
| 10 | Cleanup policies | Partial | FR-G2 | — | 6 |
| 11 | Stuck detection | Partial | FR-A3 | `awkit-4km` | 5 |
| 12 | Structured assertions | Absent | FR-E1 | — | 3 |
| 13 | Validation rigor hierarchy | Absent | FR-E3 | — | 3 |
| 14 | `INCONCLUSIVE` result | Absent | FR-E2 | — | 3 |
| 15 | Immediate failure evidence | Partial (**ordering defect**) | FR-B2 | — | 1 |
| 16 | Rehearse-before-record | Absent | FR-F3 | — | 6 |
| 17 | Interaction primitive | Absent | FR-F2 | — | 6 |
| 18 | Pagination cursors | Absent | FR-F4 | — | 7 |
| 19 | Step-paired visual regression | Absent | FR-I2 | — | 7 |
| 20 | Detail-tiered observability | Partial | FR-A4 | — | 5 |
| 21 | Safety beneath the node layer | Partial | FR-H1 | — | 5 (prereq) |
| 22 | Domain capability boundary | Absent (scheme-only) | FR-H2 | — | 7 |
| 23 | Opaque protected-login state | **Implemented** | FR-H4 (**rejected change**) | — | — |
| 24 | MFA/CAPTCHA manual handoff | **Implemented** | FR-H3 | — | — |
| 25 | Page content untrusted | **Implemented** (vacuously) | FR-H5 | — | — |
| — | Verification credibility | Structurally exposed | FR-I1 | — | 0 |

**Defects found during this review** (independent of any recommendation, worth filing regardless):

| Finding | Location | Impact |
|---|---|---|
| Popup registered under two aliases; one is positional | `PlaywrightRunner.ts:471-479` + `StepExecutor.ts:1255` | Non-deterministic multi-window replay when popups open out of order. |
| Failure screenshot taken after the retry loop | `FlowExecutor.ts:446-448` | Retries that navigate destroy the broken state before it is captured; intermediate attempts get no evidence. |
| `resolveArtifactSettings().screenshotOnFailure` computed, never read | `ArtifactProfile.ts:22-38` | Configuration-contract defect: the Flow Designer and resolved profile imply one behaviour, the runtime follows `step.onFailure?.screenshot ?? true`. The `production` profile does not actually control failure screenshots. |
| Success path closes runtime as `"execution-failed-cleanup"` | `PlaywrightRunner.ts:282` | **Log truthfulness only** — a passing run logs a failure-shaped reason. Verified *not* to reach `BrowserPoolEffectiveness.closeReasons` (different enum; the reason is discarded by `onRuntimeClosing`'s consumer). No analytics impact today; becomes load-bearing under FR-A2. |

---

## 10. Open questions

1. **A-1 must be settled before Tranche 5 is scheduled.** Does the bundled Chromium expose
   `context.newCDPSession(page)` without a debugging port? If not, all of WS-A needs redesign.
2. Does `inconclusive` count toward `failureRate` in historical analytics? This SRS recommends a
   separate counter so historical success rates stay comparable — needs a decision recorded in
   `docs/ai/DECISIONS.md`.
3. What is the retention policy for run artifacts and visual baselines? Unbounded local growth is the
   default failure mode of every recommendation in WS-B and FR-I2.
4. Is FR-D2 (locator recovery) wanted at all? FR-D1 delivers most of `awkit-v4r`'s value at a fraction
   of the correctness risk. Building D1 and stopping is a defensible outcome.
5. Should the domain capability boundary (FR-H2) be per-workflow or per-session-profile? Per-workflow
   is specified here; per-profile may fit the enterprise story better.
