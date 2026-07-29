# Randomized Automation Test Lab — Implementation Plan

Date: 2026-07-21
Prerequisite reading: `RANDOMIZED_TESTING_ARCHITECTURE.md` (findings), especially **§6 Blocked or
vacuous** and **§7 Defects found**.

## Status

| Phase | State | Verification |
|---|---|---|
| 0.1 extract designer mapping | **done** | designer imports the shared mapping; regression guard active |
| 0.2–0.6 verifier fix + mock fixtures | not started (all touch tracked files) | — |
| 1 generation core | **done** | `verify-random-generator.mts` — 49 passed, 0 failed |
| 2 validation oracle | **done; all validation gaps fixed** | `verify-random-oracle.mts` — **27 passed, 0 failed** |
| 3 persistence round-trip | **done; all defects since FIXED (Tranche 1)** | `verify-random-roundtrip.mts` — **26 passed, 0 failed** (was 8/15; now a regression guard) |
| 4 failure artifacts, shrinking, CLI | **done** | `verify:random-failures` **17/17**; campaign 25 workflows / 59 flows |
| 5 live execution | **done** | `verify:random-live` **14/14** against the real engine/local Mock Site |
| 6–8 | not started | — |

> **Tranche 1 update (2026-07-21):** all 11 observed + 2 predicted round-trip defects (RT-01…RT-15) were
> fixed in `flowProfileMapping.ts` and their catalog entries deleted. The round trip is lossless and the
> verifier is green; §"Phase 3" below records the original discovery-run findings for history.

Everything built so far is **additive**: new files under `src/testing/`, `scripts/`,
`app/renderer/components/workflow/` and `docs/testing/`. Zero tracked files are modified, so the
in-flight checkpoint on `chore/brand-logo-5b` stays clean. Campaign artifacts land in
`reports/random-tests/`, which is already gitignored.

### Deferred git actions (nothing here has been run)

As of the last session the checkpoint was **not committed** — `chore/brand-logo-5b` still points at
`382847c`, the same commit as `origin/main`, with 45 modified tracked files and no stash. Until it
is committed, the lab must not switch branches (the switch would carry the checkpoint along) and
must not file Beads issues (`.beads/*.jsonl` are among the 45 modified files).

The untracked set splits cleanly with no overlap — 19 checkpoint files, and the lab's own files:

```bash
# 1. Preserve the checkpoint. `git add -u` stages ONLY already-tracked files;
#    the lab's untracked files are named nowhere below, so they cannot be swept in.
git add -u
git add app/main/brandingService.ts app/main/ipc/branding.ipc.ts \
        app/renderer/lib/brandingImage.ts app/renderer/pages/AccentColorSettings.tsx \
        app/renderer/pages/BrandingSettings.tsx app/renderer/state/accentTheme.ts \
        app/renderer/state/branding.tsx src/branding src/theme/accentColor.ts \
        src/security/browser/CertificateTrust.ts docs/HTTPS_CERTIFICATE_TRUST.md \
        scripts/lib/selfSignedCertificate.mts scripts/verify-accent-gui.mjs \
        scripts/verify-accent-theme.mts scripts/verify-branding-gui.mjs \
        scripts/verify-branding.mts scripts/verify-https-certificates-gui.mjs \
        scripts/verify-https-certificates.mts

# 2. Prove the lab was not swept in — this MUST print nothing.
git diff --cached --name-only | grep -E "src/testing|roundtrip|verify-random|RANDOMIZED|flowProfileMapping"

git commit -m "feat: branding, accent theme, and HTTPS certificate trust"

# 3. Only then branch the lab. Its files are untracked, so they follow the switch.
git switch -c feature/randomized-test-lab
```

Beads (one epic, per-phase issues, and one issue per confirmed round-trip defect) is filed **after**
step 3, as its own commit, separate from the lab implementation.

---

## Guiding decisions

These follow from the audit and shape every phase.

1. **Generate + oracle, don't duplicate.** ~700 checks already cover auth, RBAC, licensing,
   concurrency, cancellation and artifacts. The lab adds deterministic *generation*, *invariant
   oracles* and *coverage accounting* on top of the existing engine — it does not re-test what
   `verify:e2e-*` already proves.
2. **Pure core first, browser last.** Everything that can be proven without launching Chromium is
   built and verified first. Live execution is the slowest, flakiest layer and depends on all of it.
3. **`tsc` is the drift guard.** Catalogs are exhaustive `Record<Literal, …>` types, so adding a
   node type, connector kind, operator or loop mode fails the build until the generator handles it.
4. **Never weaken production behavior to make a generated test pass** (explicit instruction). Where
   a generated scenario cannot pass because a feature is absent, the lab records a *blocked*
   coverage entry — it does not stub the feature.
5. **Bounded by construction.** Loop caps, graph size, branch counts and concurrency all derive from
   real runtime limits (`RANDOMIZED_TESTING_ARCHITECTURE.md` §1.5) or from
   `getCapacitySnapshot()` — never from hardcoded machine assumptions.

---

## Phase 0 — Prerequisites (blockers for later phases)

Small, independent, and each unblocks a phase. Not part of the lab itself.

| # | Work | Unblocks | Est. |
|---|---|---|---|
| 0.1 | **Half done.** `app/renderer/components/workflow/flowProfileMapping.ts` now exists with `toFlowProfile`/`toFlowStep`/`toNodeConfig`/`createValueSource`/`fromFlowStep` **plus `createEdge`** (scope grew: `createEdge` is part of the load path, so the round trip cannot be driven without it) and a `toDesignerDocument` helper mirroring `loadProfile`. **Remaining:** delete the private copies in `FlowChartDesigner.tsx` and import from the module — held back only because that is a tracked file in an in-flight checkpoint. Until then the two copies are kept identical by a source-parity assertion in `verify-random-roundtrip.mts`, which retires itself once the import lands. | Phase 3 round-trip testing | S |
| 0.2 | Fix `scripts/verify-durable-store.mts:34-41` stale migration-count assertion (2 → 4) | a currently-red verifier | XS |
| 0.3 | Mock-site: add a `Content-Disposition` download route | `downloadFile` coverage | S |
| 0.4 | Mock-site: add controlled HTTP-failure routes (500/503/429 + `Retry-After` + fail-once-then-succeed) | retry/error-handling coverage | S |
| 0.5 | Mock-site: add an interactive same-origin iframe scenario | `LocatorFrameContext` coverage (currently an untested path) | S |
| 0.6 | Mock-site: add a multipart upload endpoint + success assertion | `uploadFile` coverage | S |

Phases 1–4 do **not** depend on Phase 0 and can start immediately.

---

## Phase 1 — Deterministic generation core *(pure, no browser)*

**Deliverables**
- `src/testing/random/SeededRandom.ts` — ✅ **done**. `mulberry32` (repo idiom), FNV-1a seed hash,
  `int/bool/pick/pickWeighted/sample/shuffle`, and `derive(label)` producing position-stable child
  streams so shrinking one flow does not perturb others.
- `src/testing/random/NodeCatalog.ts` — ✅ **done**. Exhaustive `Record<StepType, NodeGenerationSpec>`
  with role, locator/value requirements, generation gates and weights.
- `src/testing/random/ConnectorCatalog.ts` — ✅ **done**. Exhaustive catalogs for connector kinds,
  all 9 edge types, 13 operators, 5 condition sources, join/fail/isolation modes, 4 loop modes, plus
  `RUNTIME_LOOP_LIMITS` sourced from the runtime.
- `GenerationConstraints.ts` — ✅ **done**. Campaign options; every bound defaulted well below the
  real runtime cap and clamped against `CONSTRAINT_CEILINGS`. `assertAllowedTarget` refuses any
  non-allowlisted host *at constraint resolution*, before a node is generated.
- `RandomConfigurationGenerator.ts` + `fixtures/SafeTestData.ts` — ✅ **done**. Per-node payloads
  built from locators read out of `mock-site/public/*.html`, so Phase 5 needs no fixture rework. A
  `recorderFidelity` mode emits the extra information a recorded flow carries — popup metadata,
  locators on non-`requiresLocator` steps, secret *references*, safety policies, multi-key outputs —
  which is what makes Phase 3 meaningful. Secrets are opaque references only; no plaintext is ever
  generated, so none can reach a fixture, diff or artifact.
- `RandomFlowGenerator.ts` — ✅ **done**. **Valid by construction** via a pattern library rather than
  arbitrary graphs: linear, conditional split, multi-condition branch, parallel + `waitAll`, parallel
  + `waitAny`, nested branch, bounded loop, loop containing a branch, and mixed. Guarantees exactly
  one Start, ≥1 reachable End, unique ids, no unintended cycles, required config present, and
  connector rules that satisfy `validateConnectorStructure`. Branch fan-out is capped at 2 because
  `MAX_BRANCH_CONNECTORS` is a hard port-count cap; 3-way branching chains two condition nodes.
- `RandomWorkflowGenerator.ts` — ✅ **done**. Multi-flow workflows respecting the depth-5 `runFlow`
  guard; only earlier flows are referenceable, so a reference cycle is unrepresentable.
- `CoverageTracker.ts` — ✅ **done**. Per-dimension counters (generated / configured / serialized /
  deserialized / executed / passed / failed-as-expected), including **`blocked`** entries for §6
  features. `gaps()` returns blocked keys *with their reason* rather than filtering them out.

**Verification:** `npx tsx scripts/verify-random-generator.mts` — **48 passed, 0 failed**. Covers
seed reproducibility, position-stable `derive()`, different seeds → different graphs,
catalog↔registry parity (all 30 node types, both `requiresLocator`/`requiresValue` flags), constraint
clamping and host-allowlist refusal, 225 generated flows across 9 patterns driven through the real
`validateConnectorStructure`, forward-BFS reachability, unique/resolvable ids, bounded loops, campaign
determinism, no-plaintext-secret and no-external-URL safety, and coverage accounting.

*Three generator defects were found and fixed by this verifier during the build: a `loopBack` edge
that declared `kind: "loop"` (making it a structured self-loop and illegal across nodes), `select`
and `radio` steps generated on pages with no such control, and a loop mode that never appeared
because the campaign was too small to converge.*

---

## Phase 2 — Validation oracle *(pure)* — ✅ done

Runs every generated graph through the **real** validators rather than a reimplementation:
`validateConnectorStructure` (`FlowProfile.ts:531`) and `PreRunValidator.validate`, which internally
runs `FlowDependencyResolver.validate` and `SecurityPolicy`.

- `src/testing/oracle/TestExecutionOracle.ts` — expected-outcome model. Every mutation declares
  whether it *is* detected and by which layer, with a citation. A valid flow must produce zero
  error-severity issues — that negative control matters, because without it a validator that
  rejected everything would score full marks on the mutation suite.
- `src/testing/random/RandomMutator.ts` — 13 mutation kinds, **exactly one defect per scenario**.
  Never mutates its input, is reproducible from a seed, and returns `undefined` rather than an
  unmutated profile when a flow offers no target — a mutation that quietly did nothing would look
  exactly like a validator correctly accepting a defect it never saw.

**Verification:** `npx tsx scripts/verify-random-oracle.mts` — **19 passed, 1 failed.** The single
failure is a product defect, described below.

### Result: 9 of 13 controlled defects are rejected by nothing

Detected (4): `structuralLoopAcrossNodes`, `multipleStandardOutgoing`,
`loopNodeNonConditionalSibling` (all by `validateConnectorStructure`) and `missingRequiredLocator`
(by `PreRunValidator`).

**Not detected by anything (9):** `missingRequiredValue`, `invalidConnectorTarget`,
`unsupportedOperator`, `duplicateNodeId`, `missingEndNode`, `unreachableNode`, `invalidLoopLimit`,
`invalidTimeout`, `missingFlowReference`. Each is catalogued with its citation, its risk if it
reaches the runner, and a recommended fix, and each is asserted to *still* be a gap — so a gap that
closes and a gap that opens both fail. The catalog is a regression guard on validation coverage, not
an excuse list.

The common thread: several of these rules **do** exist, but only in the renderer's advisory
`validateFlow`, which is not the save gate and has no counterpart in `src/`. `unreachableNode` is
worse — there is no reachability check anywhere, so a step the author believes runs may silently
never run, with nothing reporting it.

### New product defect found: `radio` escapes locator validation

`PreRunValidator.ts:55` hardcodes the list of step types it enforces a locator for, and that list
has drifted from `flowNodeCatalog.ts`: **`radio` is marked `requiresLocator: true` but is absent
from the validator's list.** A `radio` step with no locator passes pre-run validation and fails at
run time with a raw Playwright error, after the browser is open and earlier steps have applied their
side effects.

The verifier detects this by **probing the real validator** (`deriveLocatorValidatedTypes()`) rather
than copying its list, so it stays correct automatically as node types are added. Recommended fix:
derive the list from the node catalog so the two cannot drift.

Reports (gitignored): `reports/random-tests/validation-gaps.json`, `validation-gaps.md`.

### Two generator defects this phase exposed

The oracle found that `runFlow` and `loop` node types were **never generated** — both were declared
generatable, but `actionNodeWeights` only admitted role `action`, and no pattern placed them. Every
mutation and round-trip result for those types was silently vacuous. Fixed by admitting the
one-in/one-out roles (`action`, `loop`, `subflow`) to the inline pool, gating `runFlow` on having
something to reference. `verify-random-generator.mts` now asserts node-type coverage so this class
of gap cannot recur.

---

## Phase 3 — Persistence round-trip *(pure)* — ✅ baseline discovery run complete

Property: `profile → JSON → profile` and `profile → designer → profile` are semantically stable.

**Result: `npx tsx scripts/verify-random-roundtrip.mts` — 8 passed, 15 failed. This is the correct
outcome.** The failures belong to the product, not the test. No assertion was tuned, skipped or
weakened, and no lost field was excluded from the equality check.

- **JSON serialization is lossless** — 54/54 profiles survive `JsonProfileStore`'s stringify/parse
  unchanged. All the loss is in the designer mapping.
- **The designer round trip produced 8,474 field differences across 46 distinct defect shapes**,
  which group into **13 catalogued defects** — including all three the owner predicted (locators on
  `screenshot`/`wait`, secret value sources, recorder popup metadata).
- **Zero unexpected new failures.** Every one of the 46 shapes is explained by a catalog entry, so
  the next run can tell a regression from the known baseline.
- **Every defect minimizes** to a 3-node `start → node → end` definition that still reproduces it
  (46/46), preserved in the report alongside the original and reloaded definitions.
- The report is **byte-identical across runs** for a fixed seed.

Components: `src/testing/roundtrip/SemanticDiff.ts` (field-level diff; the only normalization is
`undefined ≡ absent`, because `JSON.stringify` deletes undefined keys — nothing is redacted or
excluded) and `src/testing/roundtrip/RoundTripDefectCatalog.ts` (13 `observed` + 2 `predicted`
entries, each with the owning boundary, severity, affected node types, runtime impact verified
against `StepExecutor`, and a recommended fix).

**The most serious finding was not on the predicted list — and is now FIXED.** `RT-14`:
`fromFlowStep` collapsed `FlowStep.value` and `FlowStep.valueSource` into a single designer string
via `step.url ?? valueSource?.value ?? valueSource?.key ?? valueSource?.envKey ?? …`, and
`createValueSource` rebuilt a typed source from it. On a `goto`, `step.url` was first in that chain
and shadowed the source entirely — `{type:"env", envKey:"AWKIT_LAB_ENV_ALPHA"}` came back as
`{type:"env", envKey:"http://127.0.0.1:4321/form.html"}`, and `{type:"generated",
generator:"randomEmail"}` came back with a `generator` outside its own union.

**Fix (`awkit-1w5`, also closing `awkit-ihx`/RT-02):** the properties panel can only author two of
the nine source kinds — `static` and `dynamic` — so every other kind comes from the Recorder, an
import, or a hand-edited profile, and the designer's job is to *preserve* it, not re-derive it.
`FlowDesignerNodeData.valueSourceOriginal` now carries the loaded source verbatim,
`createValueSource` reconstructs only the two authorable kinds and passes the rest through, and
`data.value` holds the literal only. That also fixed the secret-source loss, which was the same
mechanism: `createValueSource` bailed on an empty `data.value`, and a secret carries a reference
rather than a literal. Defect shapes dropped **46 → 35** and the round-trip verifier went from
**8 passed / 15 failed** to **17 passed / 12 failed**, with zero unexpected new failures throughout.
Both catalog entries were deleted, so any recurrence now reports as a regression.

Reports (gitignored, under `reports/random-tests/`): `roundtrip-defects.json`, `roundtrip-defects.md`.

**Out of scope for Phase 3: fixing any of this.** The defects are owned by their own follow-up
issues.

---

## Phase 4 — Failure artifacts, shrinking, CLI

**Completed 2026-07-29 (`awkit-wza.5`).**

- `FailureArtifactWriter.ts` — seed, generator version, definitions, constraints, coverage, machine
  snapshot, failure category, reproduction command. Written under `reports/random-tests/`
  (already gitignored). Originals are never overwritten.
- `FailureReproducer.ts` + `Shrinker.ts` — remove unrelated flows → branches → nonessential nodes →
  reduce concurrency → reduce loop iterations, keeping the same failure category.
- `npm run test:random`, `:smoke`, `:generator`, `:oracle`, `:roundtrip`, `:reproduce`
  (Windows-safe argument syntax).

Artifacts are schema/version checked, written to unique exclusive directories, and rejected before
write if they contain a resolved secret or sensitive URL query parameter. Reproduction requires the
same category and recorded signature. The shrinker deep-clones originals and accepts only a strictly
smaller candidate that retains that identity. Verification: `verify:random-failures` **17/17**,
smoke **2 workflows / 4 flows**, full campaign **25 workflows / 59 flows**, generator **49/49**,
oracle **27/27**, round-trip **26/26**.

---

## Phase 5 — Live execution *(browser; needs Phases 1–4 + Phase 0 fixtures)*

**Completed 2026-07-29 (`awkit-wza.6`).**

`RandomTestRunner.ts` drives the real `ExecutionEngine` against the local mock site.

Constraints established by the audit:
- `startRun()` is not awaitable → **poll `getInstances()` to terminal with a deadline**.
- Concurrency comes from `getCapacitySnapshot()` / `planCapacity()` — never hardcoded.
- Genuine parallelism requires `isolation: "isolatedPage"` **and** a `branchExecutorFactory`.
- No `timedOut` status exists → the lab's own deadline produces a `labTimeout` outcome, clearly
  distinguished from a product status.

`RuntimeInvariantChecker.ts` implements only invariants that are **decidable against real behavior**
(terminal state reached, no both-passed-and-failed, node order respects dependencies, `waitAll`
waited, loop count ≤ configured max, cancelled runs stop scheduling, contexts/pages released to
baseline, records persisted once, report totals match records, no secrets in artifacts).

The live verifier uses deterministic goto-only generated definitions over the existing safe fixture
pool, including a forced `isolatedPage`/`waitAll` topology that exercises the production
`PlaywrightRunner` branch factory. A never-terminal engine double proves the deadline produces
`labTimeout` and cancels the product instance without inventing a new product status. Verification:
The same gate refuses unauthorized target hosts before dispatch and proves the documented upload
fixture is materialized under the campaign root without mutating generated originals.
Verification: `verify:random-live` **14/14**, `verify:runner` **89/89**,
`verify:mock-site` **99/99**.

---

## Phase 6 — Campaign reporting

Campaign JSON + Markdown: coverage per dimension, blocked entries with reasons, duration
percentiles computed **from raw samples** (never from aggregates — the repo already has an
aggregate-of-aggregates trap documented at `observabilityAggregation.ts:6-8`), peak resource
counts, failure categories, reproduction commands.

---

## Phase 7 — Test Lab UI *(Super-User-only)*

New Administration sub-page. Registration is exactly four edits (audited):
`RouteId` union (`routes.tsx:62-93`) → `AppRoute` entry (`:103-321`) → `RoutePermissions`
(`routePermissions.ts:37-42`) → the `"Administration"` group (`LeftNavigation.tsx:69`).

Must use the real admin kit — `AdminPage`, `AdminBanner`, `AdminStatusBadge`, `AdminLoading`,
`AdminEmpty` (note: **not** `Banner`/`StatusBadge`/`Loading`/`Empty`) — plus `.settings-card`,
`.awkit-admin-table`, and `global.css` tokens only.

**Open question for the owner:** shipping a test-generation harness inside the production app is a
meaningful surface-area and packaging decision. A CLI-only lab avoids it entirely. See the decision
request in the session summary.

---

## Phase 8 — Application-lifecycle campaigns *(auth / RBAC / licensing / reports / indicators)*

Deliberately **last**, and deliberately thin: `verify:e2e-auth|rbac|licensing` plus
`verify:auth|authz|licensing|session-context` already cover this ground with ~280 checks. The
incremental value here is *combinatorial* — randomized permission-set generation and the
auth × authz × license state matrix (§26) — driving the existing enforcement points, not new
assertions about them.

---

## Sequencing summary

```
Phase 1 (pure generation)  ──┬─> Phase 2 (oracle) ──> Phase 4 (artifacts/shrink/CLI) ──> Phase 5 (live) ──> Phase 6 (reports)
                             └─> Phase 3 (round-trip, needs 0.1)                                              │
Phase 0.3–0.6 (mock fixtures) ───────────────────────────────────────────────────────> Phase 5              │
                                                                                        Phase 7 (UI) <───────┘
                                                                                        Phase 8 (lifecycle)
```

## Honest scope estimate

Phases 1–4 are a substantial but tractable unit of work. Phases 5–8 each carry live-browser or
UI-surface risk and are individually comparable in size to Phases 1–4 combined. The full brief as
written (37 sections) is a multi-milestone program, not a single change; it should be tracked as an
epic with one bead per phase.
