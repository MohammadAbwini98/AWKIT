# Flow Validation Engine — Design (Test Lab Tranche 2)

Date: 2026-07-22 · Status: **INTEGRATION-CANDIDATE — packaged validation and SHA-256 grant binding
pending** · Epic: `awkit-wza` (gaps `awkit-7fm` ✅, `awkit-acw` ✅ — both closed by 2b)

> **Hardening checkpoint 2026-07-22** (`awkit-xy3`). Grant binding moved from FNV-1a to **SHA-256**
> computed at a trusted main-process boundary (`app/main/validation/contentDigest.ts`);
> canonicalization stays pure and deterministic in `LegacyCompatibility.canonicalFlowContent`.
> Pre-hardening (FNV-era) records are **retired, never migrated or replaced** — no deadline is
> extended and no grant is created merely because an old format was seen. The inventory scan is
> single-flight, fails closed, and serializes grant writes. A fresh package was built and validated
> on clean and upgrade profiles (87/0), including all ten `validation:*` channels and their
> authorization matrix.
>
> Status deliberately remains INTEGRATION-CANDIDATE: source, Electron-dev and packaged-on-dev-machine
> suites are green, but the clean **offline VM** walkthrough has not been run.

> **Stage 2c landed 2026-07-22** (`awkit-9xb`). Enforcement is now the full gate: off-path errors block
> unless an explicit, time-limited, content-bound, audited Legacy Compatibility grant tolerates them
> (`src/validation/LegacyCompatibility.ts` — pure policy; `effectiveVerdict` is the single decision
> every surface uses). The inventory scan classifies the library into immediately-blocked ·
> temporarily-compatible · valid · possible-validator-defect and grants only the off-path-only group;
> re-scans never extend a deadline. Suggested fixes (`SafeFixApplier.ts`) cover schema migration only,
> behind preview → confirm → backup → apply → report → undo. Deviation worth noting: grants are keyed
> to a content HASH rather than a stored "unchanged" flag, so an edit voids compatibility even if the
> app never observed the edit. `verify-legacy-compat.mts` (90/0) drives the real service.

> **Stage 2a landed 2026-07-21** (`awkit-lqe`, commit `491eff0`). `src/validation/FlowValidator.ts` +
> `StepRequirements.ts` + `scripts/verify-validation.mts` (99/0); `verify-random-oracle` 19/1 → **26/0**.
> Additive only — the engine is wired into no production caller. Deviations from this design, all
> deliberate: report helpers are standalone functions (`errorsOf`/`hasActivePathError`/…) rather than
> methods, so a report stays a plain serializable object; the fix metadata field is `safeFix` rather than
> `migrationFix`; `validateFlowSet` was added for nested/referenced-flow validation (duplicate flow ids +
> `runFlow` cycles); `unreachableEndNode` was added so "an End exists but cannot be reached" blocks as an
> active-path error while a plain orphan stays off-path.
>
> **Stage 2b landed 2026-07-21** (`awkit-nmg`). `PreRunValidator` is a thin adapter over the engine
> (its drifted hardcoded locator list is deleted); the run gate blocks on `blocking` issues only
> (active-path errors + all connector-structure errors — the latter regardless of path, a documented
> deviation: `FlowExecutor` refuses such flows flow-wide, so an off-path structural error would just
> become an immediate runtime failure). Gate validation is **scoped** to the scenario's flows plus the
> transitive `runFlow` closure — before 2b, `validateWorkflow` validated the entire library and an
> unrelated broken draft blocked every run. Designer/builder save-blocks removed (Draft model, nothing
> auto-fixed); designer chip → clickable issue list with node/connector navigation; Flow Library derives
> Checking…→Runnable/Not runnable per flow (never persisted); `flows:import` returns a validation
> summary and always imports parseable flows as drafts. Owner decisions implemented: canonical loop cap
> **1,000** in `src/validation/FlowLimits.ts` (FlowExecutor, FLOW_BOUNDS — was 10,000 —, test-lab
> catalog and renderer all read it); `validateConnectorStructureDetailed` provides structured findings
> (the string form wraps it); the generator derives `config.targetFlowId` from the canonical `flowId`.

## Context & goal

The Phase-2 validation oracle proved that **9 of 13 controlled defect classes are caught by no
validator**, and that `PreRunValidator.ts:55` hardcodes its locator-required list, which has drifted
(`radio` escapes locator validation — `awkit-acw`). Several real rules exist only in the renderer's
*advisory* `validateFlow`, which is not the save gate and has no `src/` counterpart. There is **no
reachability check anywhere**.

Goal: one shared, framework-agnostic validation engine used by the UI, persistence, run gate,
import/export, and CLI, with a strict-but-recoverable save/run model — never weakening production, never
destroying user work.

## Owner decisions (locked)

1. **Runnable status is DERIVED, never persisted.** Compute fresh on: designer open, library display,
   import/migrate, execution, CLI. The pre-run gate always re-validates and never trusts a prior result.
   No `runnable` boolean on the schema. Validation *history* (`validatedAt`, validator version, errors,
   warnings) may be persisted **for diagnostics only** — it must never gate execution. Library lists
   validate asynchronously and show **"Checking…"** rather than a cached verdict.
2. **Legacy fixes are SUGGESTED, never automatic.** Opening a legacy flow never modifies or saves it.
   Validate the original, show all issues, and offer *Fix / Fix all safe issues / Review manually* only
   for deterministic corrections that cannot alter execution logic. **Safe = schema migration only:**
   rename/deprecated field mapping, adding missing *optional* props from documented defaults, enum-casing
   normalization, removing runtime-ignored metadata, ID regen **only** when every reference can be
   remapped unambiguously. **Never auto:** add Start/End, delete unreachable/broken nodes, guess flow
   refs, reconnect, replace operators, clamp loops, change timeouts, or anything altering order/branching/
   retries/timing/results. Before applying: show a **change preview**, write an **untouched backup**,
   require **explicit confirmation**, record a **migration report**, allow **undo/restore**.
3. **Enforcement is STAGED and active-path-aware.** Errors on the **reachable execution path** block
   immediately for every flow (missing/ambiguous flow ref, duplicate ids on reachable objects, broken
   connectors on a reachable path, invalid Start/End preventing deterministic completion, unbounded loop
   config, undefined runtime config). Existing **unchanged** flows whose *only* errors are **off the
   reachable path** (orphan nodes, disconnected obsolete metadata) may run temporarily under an explicit,
   time-limited **Legacy Compatibility** status. New / imported / duplicated / **materially-edited** flows
   must pass the **full** gate immediately. Compatibility is auditable (validator version, issues, runs,
   expiry), shown persistently (library/designer/scheduler/run report), never silent, and ends the moment
   the flow is edited/repaired/migrated or the deadline passes. Before enabling, an **inventory scan**
   produces a migration report grouped by: immediately-blocked · temporarily-compatible · valid ·
   possible-validator-defect. The runtime never relies on a flag or stored verdict alone — always fresh
   validation; compatibility never overrides an active-path critical error.

## Architecture — one pure engine

New **`src/validation/FlowValidator.ts`** (no Electron/React/Node), the single source of truth:

```ts
validateFlowDefinition(profile: FlowProfile, ctx?: FlowValidationContext): FlowValidationReport

interface FlowValidationIssue {
  code: FlowValidationCode;        // stable machine code, e.g. "unreachableNode"
  severity: "error" | "warning";
  onActivePath: boolean;           // is the offending node/edge reachable from Start?
  nodeId?: string; edgeId?: string;
  message: string;
  migrationFix?: MigrationFix;      // present only for deterministic schema-migration fixes
}
interface FlowValidationReport {
  issues: FlowValidationIssue[];
  reachableNodeIds: ReadonlySet<string>;   // the forward-BFS result, reused by callers
  // helpers: hasActivePathError(), errors(), warnings()
}
interface FlowValidationContext { referenceableFlowIds?: ReadonlySet<string>; } // for runFlow refs
```

It **wraps** the existing `validateConnectorStructure(edges)` (leaving the runtime-enforced connector
gate untouched) and adds the flow-level rules. Reachability is computed once (a forward BFS from Start,
lifted from `verify-random-generator.mts`) and drives both `unreachableNode` and every issue's
`onActivePath` flag. Callers decide blocking policy from the report; the engine itself is verdict-free.

## Rule set (from the oracle's `MUTATION_EXPECTATIONS`)

| Code | Severity | Active-path blocks? | Where the check goes |
|---|---|---|---|
| `missingStartOrEnd` | error | always (structural) | engine |
| `unreachableNode` | error | off-path by definition → **Legacy-tolerable** | engine (new BFS) |
| `duplicateNodeId` / `duplicateEdgeId` | error | only when the dup is reachable | engine |
| `brokenConnectorEndpoint` | error | only on a reachable edge | engine |
| `missingFlowReference` (`runFlow` step) | error | always | engine (+ PreRunValidator ctx) |
| `unsupportedOperator` | error | when on a reachable conditional | engine |
| `invalidLoopBounds` (0/neg/over-cap) | error | always (unbounded risk) | engine |
| `invalidTimeout` (≤0) | error | when on a reachable step | engine |
| `missingRequiredValue` | error | when on a reachable step | engine (mirror renderer rule) |
| `missingRequiredLocator` | error | when on a reachable step | engine — **list derived from node catalog** (`awkit-acw`) |
| high timeout / very large loop / disconnected optional / deprecated | warning | n/a | engine |

`awkit-acw` fix: the locator-required set is derived from `flowNodeCatalog` `requiresLocator` (as the
oracle's `deriveLocatorValidatedTypes()` already probes), so it cannot drift.

## Integration surfaces (all call the one engine)

- **Run gate** — `PreRunValidator.validate` delegates per-flow checks to `FlowValidator`; blocks on any
  active-path error. `execution.ipc.ts:186` already returns `validationFailed`. Covers flows *and*
  workflows (scenario → flows).
- **Designer + Workflow Builder** — replace `validateFlow`/`connectorStructureIssues` with the engine via
  the existing `toFlowProfile` adapter. **Save always succeeds**; invalid flows show a *Not Runnable*
  badge + inline issue list with per-issue navigation. (Removes today's connector-structure save-block.)
- **Persistence / import** — `flows:import` validates and surfaces status; `flows:create/update` never
  reject on validation.
- **CLI (Tranche 3)** — same call for machine-readable validation reports.

## Implementation staging (three reviewable checkpoints)

- **2a — Pure engine + oracle rewiring (additive, ZERO production-behavior change).**
  `src/validation/FlowValidator.ts` (all rules + reachability + active-path), `scripts/verify-validation.mts`
  (all 9 rules, radio drift, reachability, active-path classification). Rewire the oracle: the 9
  `knownGap` expectations flip to `detected`, so **`verify-random-oracle` goes 19/1 → green**; update the
  gaps report. Nothing wired into save/run/UI yet. Safe to land and verify on its own.
- **2b — Wire into the run gate + designer/builder (behavior change; the core).** PreRunValidator delegates
  to the engine (active-path errors block run). Designer/builder show Draft/Not-Runnable + inline issues;
  save stops blocking. Import validates. Closes `awkit-7fm`, `awkit-acw`. **Architectural checkpoint.**
- **2c — Legacy compatibility + migration subsystem.** Validate-on-load banner with navigation;
  suggested-fix model (preview + backup + confirm + migration report + undo); Legacy Compatibility status
  (explicit, time-limited, persistent warnings, audit records); inventory scan → grouped migration report.
  Largest UI + persistence piece. **Architectural checkpoint.**

## Test plan

`verify-validation.mts` — every rule (positive + negative controls), the catalog-derived locator list,
reachability incl. legal parallel/loop shapes (driven through the Tranche-1 corpus so it can't
false-positive), and active-path classification. Oracle: `MUTATION_EXPECTATIONS` all `detected`,
`verify-random-oracle` green. 2b/2c add: run-gate block, draft-save, import-validate, legacy-load banner,
migration preview/backup/undo, compatibility expiry.

## Risks

- **Production behavior change (2b):** designer save stops blocking; run gate starts rejecting active-path-
  broken flows. Exactly the spec, and the reason 2b/2c are checkpoints.
- **Reachability false-positives** would wrongly block flows → covered by driving the BFS through the
  Tranche-1 generated corpus (9 patterns incl. parallel/loop/nested).
- **Legacy Compatibility** is a genuine subsystem (deadlines, audit, inventory) — isolated in 2c so 2a/2b
  land first.
