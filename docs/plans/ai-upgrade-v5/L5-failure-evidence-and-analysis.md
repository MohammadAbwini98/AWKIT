# L5 — Failure Evidence (L5a) & Failure Intelligence (L5b)

Shared rules, architecture and decisions: `ROADMAP.md`. L5a depends on L0; L5b on L1 go/no-go PASS + L5a.
**Source of truth for failure capture and analysis.**

## L5a — Run-lifetime deterministic evidence

### Collector (new owner)
Context/run-lifetime collector, composed with the existing browser-context creation hook (no second browser owner).
`NetworkDiagnosticsObserver` keeps its per-action stream-wait role; `captureFailureEvidence` keeps point-in-time
screenshots/DOM. The collector owns: page + popup attach, page replacement, init-script install, listeners, step-window
correlation, teardown, bounded buffering, persistence handoff.

### Signals
- Init script (event-driven MutationObserver on added/changed candidate nodes only; no polling, no full rescans):
  `role=alert`, `aria-live`, `role=status` (neutral), `aria-invalid` transitions, native `invalid` events +
  `validationMessage` + validity flags, bounded `aria-describedby` text, deterministic toast/banner heuristics.
  Field identity only, never values; protected-login excluded.
- Page listeners: HTTP 4xx/5xx metadata (method, sanitized path, status, timing), `requestfailed`, `pageerror`
  (name/message, bounded safe frames), `console.error` (bounded text), error-navigation snapshot (status, title,
  heading/alert — never full HTML), runner failure events (timeout, assertion, locator, cancel, navigation).
- Response-body excerpts **off by default**; if enabled by policy: failure status, allowlisted content type, small
  declared length, hard cap, masking. Never request bodies/headers/cookies; never scan 2xx bodies.

### Contract & bounds
One versioned `ExecutionEvidenceEvent`: id, schemaVersion, source, monotonic offset, execution/instance/flow/node/
step/page context, severity hint, bounded masked payload, dedupe key, repeat count. Caps per event, per source, per
instance, **per run (bytes)**; dedupe with repeat counts; explicit truncation flags. Personal-data masking per L0 policy;
raw evidence not semantically indexed.

### Default & overhead gate
Metadata/UI/form/error listeners ON; body excerpts OFF; console capture bounded and configurable; protected-login
exclusion mandatory. `verify:failure-capture-overhead` measures duration median/p95, CPU, RSS, event volume, observer
work, listener leaks, popup lifecycle, concurrency; first run proposes a numeric threshold that is owner-approved and
committed. If it fails, change the default.

### Deterministic cause baseline
Coded precedence table: failing step window → earliest/highest-confidence error event; else bounded preceding window;
direct HTTP/network/page/UI error before a runner timeout/assertion wins; output evidence IDs + reason code or
`insufficient`. Always computed, no model.

### Status (2026-09-19, `awkit-djnl.7`): implementation and capture evidence complete; duration gate currently FAILS

| Part | Where |
|---|---|
| Event contract, bounded masked buffer, retraction | `src/runner/evidence/ExecutionEvidence.ts` (`SemanticRedactor` on every string, URL → origin + path template) |
| Page-side script (UI, validation, document state) | `src/runner/evidence/uiEvidenceScript.ts` (a plain string, never a function's source) |
| Collector (listeners, step correlation, exclusion, handoff) | `src/runner/evidence/FailureEvidenceCollector.ts`, attached by `ExecutionEngine` on the per-generation lifecycle beside `PassiveCdpTrace` |
| Cause baseline | `src/runner/evidence/FailureCauseBaseline.ts` |
| Report extension | `InstanceReport.diagnostics` (optional; absent on clean passes, on old reports and with `AWKIT_FAILURE_EVIDENCE=0`) |
| Fixtures | `/runner-lab` › Failure evidence, `/api/transport-drop`, `/runner-lab/error-page` (`mock-site/README.md`) |

- **Protected-login exclusion.** The page script announces each document's state; a document with a password or
  one-time-code field is excluded and whatever it already produced is retracted (bytes returned, counted as
  `dropped.protected`). A page the runner hands off as a protected login, and every `protectedLoginHandoff`,
  `autoSecureLogin`, `reuseSession` or manual-handoff step, is excluded too. Only the runner's own failure survives.
- **Runner messages** keep the diagnosis line only: Playwright's colour codes and "Call log" (which quotes matched
  elements' HTML) are dropped. A `wait` step that ran out of time is `timeout` even though Playwright words it as a
  locator error.
- **Start-up cost.** Only the init script is awaited on the instance start-up path (one round trip, concurrent with
  the CDP trace start). Exposing the binding takes several sequential round trips (~330 ms median under start-up
  contention), so it completes in the background. Until it lands, the page queues its messages (at most 50), and
  they arrive in order with their age.
- **Cancellation.** A stopped instance is `cancelled` at once while its runner unwinds; the report writer now waits
  (bounded, 30 s) for unwinding runners, so a cancelled instance's report, evidence included, reaches `report.json`.

**Current overhead result, measured on the development host (12 logical CPUs, Windows), 6 ABBA rounds, 3 instances
per workload, 6 concurrent.** This is not a VMware production figure and does not approve a release ceiling.

| Measure | Capture ON | Capture OFF | Delta |
|---|---|---|---|
| Fast workload, median duration | 2,435 ms | 1,934 ms | +326 ms (median of paired rounds; **FAIL** vs 193.4 ms) |
| Evidence workload, median duration | 3,946 ms | 3,416 ms | +380 ms (median of paired rounds; **FAIL** vs 341.6 ms) |
| Fast / evidence p95 | 2,877 / 4,117 ms | 2,680 / 3,819 ms | +197 / +298 ms (**PASS**) |
| Node CPU per instance | 784.3 ms | 719.2 ms | +122.5 ms (**PASS** vs 179.8 ms) |
| Evidence per passing evidence-workload instance | 3.7 KB (7 events) | — | — |

Skipping the redundant initial `about:blank` script evaluation reduced collector start median from 123.9 ms to
94.0 ms, but did not bring both duration medians under the gate. Before the binding moved off the start-up path,
the same suite measured +568 to +1,077 ms on the fast workload's median and failed. **Proposed ceilings**
(in `scripts/verify-failure-capture-overhead.mts`, still pending owner approval):
median ≤ max(10 %, 150 ms), p95 ≤ max(15 %, 300 ms), Node CPU per instance ≤ max(25 %, 40 ms), and ≤ 4 KB of
evidence per passing evidence-workload instance. If capture ever fails them, the default changes.

**Verifiers:** `verify:failure-cause-baseline` 60/60, `verify:ui-error-evidence` 74/74 (real engine, real Chromium,
real mock site, persisted `report.json`; seven mutations caught: collector disconnected, response listener never
attached, buffer dropping UI events, report omitting diagnostics, protected-login guard disabled, report written
before a cancelled runner unwinds, listeners never detached), `verify:failure-capture-overhead` **13 PASS / 2 FAIL**.

**Open:** an engineering correction or explicit default-policy decision for the failed duration gate; only after a
passing measurement can an owner approve a release ceiling. The Raw-UI-text suppression Settings switch from the
privacy policy (default OFF) and per-step `stepIndex` stamping remain follow-ups.

## L5b — Failure intelligence (T0)

- Invocation: PASS + no evidence → nothing; PASS + evidence → baseline, AI on demand; FAIL → baseline immediately,
  AI only if enabled, admitted, not coalesced away, and the feature earned auto-run (beats baseline on labelled set).
  Never before terminal outcome.
- Coalescing: signature = source + status/error class + **path template** (ids stripped) + flow/node/step + baseline
  cause code. One analysis per signature; others reference it with counts; bounded distinct signatures and a
  per-batch budget; overflow keeps baseline only; backlog never delays execution or report finalization.
- Input: baseline, terminal failure, bounded high-signal evidence with IDs, small neighbor-step context, counts.
- Output (constrained): primary candidate + evidence IDs, secondary consequences, category, explanation,
  investigation steps, uncertainty; unknown evidence IDs rejected; "insufficient evidence" allowed. Never changes
  status, retries, policy, or workflow.
- Persistence: optional `diagnostics` extension — raw evidence, baseline, AI analysis stored separately; coalesced
  references; old reports load unchanged; analysis deletable/recomputable.
- Reports UX: three distinct sections — Captured evidence · Deterministic cause · AI analysis (labelled, with
  uncertainty and coalesced count).

## Labelled set

Transient toast before timeout; native validation; 409 + message; 422 + field validation; 500 + error page; transport
failure; pageerror before timeout; unrelated console error; duplicate burst; unrelated warning; pass with warning;
insufficient evidence; 500 identical failing rows; multiple signatures in one batch. Metrics: baseline accuracy, AI
accuracy, **AI improvement over baseline**, evidence-link accuracy, false attribution, coalescing ratio, calls per batch,
latency, privacy correctness.

## Verifiers

New `verify:ui-error-evidence`, `verify:failure-capture-overhead`, `verify:failure-cause-baseline`,
`verify:ai-error-analysis`, live `verify:ai-error-quality-live`. Existing: `verify:failure-evidence(-live)`,
`verify:run-report-compatibility`, `verify:telemetry`, `verify:reports`, `verify:runner`, `verify:mock-site`,
`validate:offline`, `npm run build`. Mock-site scenarios for each signal and a fast `<3s` run with zero model calls.

## Known limits (document, don't advertise)

Swallowed exceptions with no UI/network/console trace; errors inside 2xx bodies without an explicit rule;
canvas-only errors; protected-login surfaces (excluded by design).
