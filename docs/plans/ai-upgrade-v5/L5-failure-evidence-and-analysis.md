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
