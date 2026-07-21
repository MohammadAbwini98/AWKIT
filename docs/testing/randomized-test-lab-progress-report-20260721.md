# Randomized Automation Test Lab — Progress Report

**Date:** 2026-07-21
**Branch:** `feature/randomized-test-lab`
**Source session:** `claude-session-20260721-202842.md`
**Verified against:** live repo (git + beads) at time of writing

---

## What this session was

The **Randomized Automation Test Lab** for AWKIT — a seeded subsystem that generates random
workflows/flows, drives them through the *real* validators and persistence boundaries, and reports
coverage + reproducible defect artifacts. The plan is **9 phases (0–8)**, tracked under epic **awkit-wza**.

The session's explicit ground rule was honored throughout: **Phase 3 is a baseline *discovery* run — do
not fix product defects to make it pass, do not weaken assertions.** The round-trip verifier is therefore
*red by design*.

---

## Verified state (git + beads)

- Branch **`feature/randomized-test-lab`**, HEAD `0f32fe2`, **7 commits ahead of origin/main**,
  **not pushed, no PR**.
- One uncommitted change: `.beads/issues.jsonl` (passive export drift — not product code).
- Epic **awkit-wza: 4 of 9 phases complete (44%)**.

> The prior memory-note warning ("verify git state, don't trust 'it's done'") is now **stale** — the work
> *is* committed (6 feature/beads commits + a handoff-docs commit).

**Commit history (branch):**

```
0f32fe2 docs(ai): handoff for the Randomized Automation Test Lab
562c29b fix(designer): preserve typed value sources instead of rebuilding them from one string
7342fc5 chore(beads): close Test Lab Phase 0 (awkit-wza.1), unblocking the 13 round-trip defects
2ead08f feat(mock-site): download, HTTP-failure, iframe and multipart-upload fixtures
3e1db88 refactor(designer): complete flowProfileMapping extraction; fix stale durable-store assertions
3175954 feat(testing): randomized test lab phases 1-3 (generation, oracle, round-trip)
2909fa7 chore(beads): file Randomized Automation Test Lab epic, phases, and defects
```

---

## Done ✅

| Phase | Bead | What landed |
|---|---|---|
| 0 — Prerequisites | awkit-wza.1 ✓ | `flowProfileMapping.ts` extraction (single source), 2 stale durable-store assertions fixed, mock-site `/runner-lab` + `/iframe-lab` fixtures, `uploadFile`/`downloadFile` ungated |
| 1 — Generation core | awkit-wza.2 ✓ | Deterministic seeded generator, node catalog, coverage tracker |
| 2 — Validation oracle | awkit-wza.3 ✓ | Mutation/validation oracle — surfaced validator-coverage gaps |
| 3 — Round-trip baseline | awkit-wza.4 ✓ | Persistence round-trip harness; catalogued 13 defects deterministically |

**Defects actually fixed this session:** `RT-14` (awkit-1w5, value/valueSource flattening) + `RT-02`
(awkit-ihx, secret-source destruction) — one fix cleared both, committed in `562c29b`. Catalog entries
deleted so any recurrence now reads as a regression.

---

## Results (verification numbers)

| Check | Result | Note |
|---|---|---|
| `npm run build` | ✅ pass | typecheck + bundles |
| `verify-random-generator` (P1) | **49 / 0** | all green |
| `verify-random-oracle` (P2) | **19 / 1** | the 1 failure is an *intentional* validator-gap finding |
| `verify-random-roundtrip` (P3) | **17 / 12** | **red by design** (was 8/15 before the RT-14/02 fix) |
| `verify-durable-store` | **11 / 11** | |
| `verify:mock-site` | **65 / 65** | up from 39 |
| `verify:flow-designer` | **24 / 24** | real Electron (RT-14 touched a live UI path) |
| `check-memory` | ✅ pass | |
| `verify:runner`, `validate:offline` | **not run** | no runner/packaging behavior changed |

---

## Pending / not yet implemented ⏳

### A. Five phases never started (awkit-wza epic)

- **Phase 4** (awkit-wza.5, P2) — failure artifacts, shrinking, CLI *(next ready item)*
- **Phase 5** (awkit-wza.6, P2) — live execution against the mock site
- **Phase 6** (awkit-wza.7, P3) — campaign reporting
- **Phase 7** (awkit-wza.8, P3) — Super-User Test Lab UI
- **Phase 8** (awkit-wza.9, P3) — application-lifecycle campaigns

### B. 11 round-trip defects — catalogued, unblocked, none fixed

| Pri | Beads |
|---|---|
| P1 | RT-03 popup/window metadata (awkit-4t9) · RT-04 step safety policy/security (awkit-3lq) · RT-05 edge identity (awkit-07c) · RT-01 locator discarded (awkit-abi) |
| P2 | RT-06 desc/version (awkit-3qs) · RT-07 timestamps (awkit-ani) · RT-11 maxLoopCount (awkit-o4q) · RT-12 outputs (awkit-x8w) |
| P3 | RT-08 connector labels (awkit-7df) · RT-09 toNodeConfig (awkit-ao6) · RT-10 optional fields (awkit-who) |

Plus **RT-13 and RT-15** — *predicted but not yet exercised* by the generator (need coverage before they
can be confirmed).

### C. Two validation-layer defects found by the Phase 2 oracle (not round-trip)

- **awkit-7fm** (P2) — 9 of 13 controlled defect classes are accepted by *no* validator
- **awkit-acw** (P2) — PreRunValidator locator-type list drifted; `radio` escapes locator validation

### D. External gates (unchanged, out of scope)

- Push / PR, `verify:runner`, `validate:offline`, clean-machine walkthrough.

---

## Process flags worth knowing

1. The RT-14/RT-02 **bead closures were folded into the fix commit** `562c29b` rather than kept as a separate
   beads commit as originally requested — flagged as a deliberate deviation; can be split on request.
2. Suggested next step in the handoff was **RT-03 (awkit-4t9)** — it breaks recorded multi-window flows
   outright — followed by **RT-04 (awkit-3lq)** (small pass-through fix, security impact).

---

## Bottom line

**Phases 0–3 complete and verified; 2 defects fixed; Phases 4–8 and 13 defects (11 round-trip + 2 validation)
remain.** The red round-trip suite is intended, not a broken build.
