# L11.I — DOM-intelligence acceptance benchmark and mutation record (2026-10-01)

Beads `awkit-djnl.19`. Plan: `../L11-performance-dom-intelligence.md`. Data:
`L11-acceptance-results.json` (this folder). Gate: `verify:dom-intelligence-acceptance` (10/0);
`benchmark:dom-intelligence-acceptance` writes the data file.

## What was compared

Every fixture runs in real Chromium against the real staged parser-only host (CPython 3.12.10,
Scrapling pinned), on a development host (Windows 10, Node 18.16.0). Engines:

| Engine | Meaning |
|---|---|
| legacy | the pre-L11 recovery (alternatives, then the 200-element in-page scan) |
| snapshot (B) | AWKIT's local snapshot recovery with the unchanged gate (0.86 / margin 0.08 / ancestry veto 0.5), the stale recheck, route binding and the actionability veto |
| scrapling | Scrapling's best candidate alone, acted on directly (a measurement, never a product path) |
| proof (D) | Scrapling's candidates, kept only when AWKIT's proof picks the same element |
| product | the production failure path: B, then the non-executing provider suggestion |

The 16 classes: 1 is normal-step overhead; 2–10 are the L10.0 cases, re-recorded with the real
Recorder; 11–16 run on `/dom-context-lab` (route mismatch, iframe, popup, virtualized list, delayed
render behind a disabled skeleton, stale reference). 23 rows: 14 must recover, 9 must refuse.

## Results

| Engine | Correct | WRONG | Unresolved or refused | p50 | p95 |
|---|---|---|---|---|---|
| legacy | 7 | 0 | 16 | 1,706 ms | 3,417 ms |
| snapshot (B) | 8 | **0** | 15 | 31 ms | 64 ms |
| scrapling alone | 11 | **10** | 2 | 25 ms | 54 ms |
| proof (D) | 7 | **0** | 16 | 25 ms | 71 ms |
| product (B + suggestion) | 8 | **0** | 15 | 48 ms | 113 ms |

- **Wrong-element actions on the product path: 0 of 23.** Zero for B and D as well.
- Scrapling alone acted on the wrong element 10 times: on 7 of the 9 rows that must refuse (same-tag
  decoy, cross-region decoy, page variant, route mismatch, popup, virtualized, delayed render) and on
  3 recoveries. It was right on 4 recoveries that B and D leave unresolved (text drift, duplicate
  text, field relabel, duplicate list rows). Those 4 are why the parser stays a non-executing
  suggestion: the extra recall comes with wrong elements on refusal rows.
- B recovers everything legacy recovers, plus the large DOM shift that legacy's 200-element cap
  cannot reach. D misses the wrapper insertion (Scrapling's best is not AWKIT's winner there).
- Every expected refusal ends refused or unresolved for B, the product path and D.

### Latency

| Measure | p50 | p95 |
|---|---|---|
| Warm snapshot recovery, 8 accepted recoveries | 37.6 ms | **170 ms** (target < 500 ms: PASS on these fixtures) |
| Local stage / blueprint stage | 18.2 / 16.6 ms | 139.4 / 38.4 ms |
| Serialize, host round trip | 11.7 / 15.3 ms | 22.1 / 32.0 ms |
| Host parse / match / AWKIT proof | 0.6 / 13.8 / 0.2 ms | 2.2 / 29.8 / 17.6 ms |
| Sanitized HTML sent to the host | 7,339 B | 7,643 B |

- Host cold start was 821 ms. Its working set was 20.5 MB after start and 12.7 MB after the run.
- Normal steps, class 1, 96 samples: the median was 25 ms with DOM intelligence off and 23 ms with it
  on, so there is **no measurable cost** once a step's reference is bound. The first step that seeds
  a reference took a median of 45.9 ms; that is a one-time refresh.

### DOM scaling (three recoveries per size)

| Elements | Snapshot recovery | Serialize | Host parse + match | Legacy |
|---|---|---|---|---|
| 345 | 67 ms | 28 ms | 56 ms | 0 recovered |
| 975 | 60 ms | 33 ms | 86 ms | 0 recovered |
| 3,405 | 157 ms | 97 ms | 320 ms | 0 recovered |
| 8,265 | **711 ms** | 439 ms | **1,109 ms** | 0 recovered |

**The < 500 ms result is not universal.** Snapshot recovery measured 449–710 ms on the 8k-element page
across runs, and the Scrapling parse and match took 1.1–1.4 s there. All four sizes recovered 3 of 3
correctly through B. Legacy recovers nothing on any of the sizes, because the target sits past its
200-element cap.

### L10.0 residual (unchanged, not a recovery defect)

`other-region-decoy-target-removed`: once the form is gone, the recorded `role=button` locator itself
matches the notifications-panel button. The primary locator resolves, so recovery never runs. This
is a recording-time locator configuration issue and is carried forward as is.

## Mutation record, Stages F–I (all restored; no marker remains)

| # | Boundary removed | Killed by |
|---|---|---|
| F M1a–M6 | local frame binding, provider frame binding, page binding, route check, route fallback for route-less memory, stale-snapshot recheck, ambiguity margin, actionability veto (8) | `verify:dom-intelligence-contexts` (each look-alike is first asserted convincing, so only the removed binding lets it through) |
| H1 | suggestion deadline | recovery-provenance: the run hung for 65 s |
| H2 | provider effect marker | recovery-provenance: the effect "none" is missing |
| H3 | actedOn limited to AWKIT proof | recovery-provenance: a suggestion is claimed as acted on |
| H4 | code-only record | recovery-provenance: step text reaches the record |
| G1–G5 | redaction, bounds, hidden drop, protected detector, provider fault → empty | dom-normalization (see `L11-normalization-2026-10-01.md`) |
| I1 | AWKIT proof bypassed (best candidate taken regardless of the gate) | acceptance: 6 WRONG results |
| I2 | malformed host answer accepted (shape validation skipped) | dom-intelligence-host: the bad-shape answer is accepted and the host is not killed |
| I3 | request timeout removed (+30 s) | dom-intelligence-host: TIMEOUT arrives after 30.3 s against a 300 ms deadline |

Total: 20 of 20 killed.

## Limits

- "Suggestion accepted by user" is not an execution event. Applying a suggestion is an unsaved
  editor edit, and recording it would need a persisted flow field. It is not recorded.
- The fixtures are local, synthetic pages. The p95 target is met on them and not claimed beyond them.
- Shadow DOM: nothing here extends the existing open-shadow and instrumented closed-shadow support.
  Scrapling is not claimed to handle closed shadow roots.
