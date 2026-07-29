# Codex Program Brief — resolve the dashboard backlog

You are working locally only on the AWKIT Electron + Playwright project, on `main`.

Do not create branches or worktrees — AWKIT is single-branch, continuous-commit.
**Work ONE tranche per session.** Do not begin a tranche until the previous one is committed and its
gates are green. Do not attempt the items under "NOT Codex's work".
Do not weaken or delete a verifier check to make a gate pass.
Read `AGENTS.md`, `docs/ai/RULES.md` and `docs/ai/BRANCH_AND_COMMIT_POLICY.md` before editing.

## Main Goal

Work the dashboard's outstanding backlog to completion, in the order below, stopping at the boundary
where a decision or an authorized human is required rather than guessing past it.

---

## What the dashboard actually shows

Measured from the live snapshot, not from memory:

| Source | State |
|---|---|
| **Defects** (`DEFECTS.md`) | **0 open, 34 resolved** — there is nothing to fix here |
| **Beads** | 30 queued: 24 ready, 6 blocked (2 declared, 4 dependency) |
| **Validation ledger** | 61 PASS / 4 NOT RUN / 1 BLOCKED (66 cases) |
| **Traceability** | 84 PASS / 14 NOT RUN / 3 BLOCKED (101 rows) |
| **Phases** | 9/11 complete (82%); J and K partially-completed |

So the backlog is **30 bead items**, and they split very unevenly — that split is the point of this
document:

- **~7 are code defects** you can close end to end.
- **6 are not engineering at all.** Two of them (`awkit-az7`, `awkit-8ri`) say so in their own
  descriptions: *"no engineering remains"*. They need an owner decision or an authorized operator.
- **The rest are multi-session features**, several interdependent.

Anything claiming all 30 can be "resolved" in one pass is wrong. Sequence, and stop at the boundaries.

---

## Standing rules — read once, apply to every item

**Working loop, per item:**

1. `bd show <id>` — the beads already carry root cause, file paths and fix shape. **Do not
   re-derive them.**
2. Claim it in `tools/roadmap/assignments.json`. Claims expire; a stale claim is worse than none.
3. **Reproduce the defect first**, with a failing check, before fixing it.
4. Fix the smallest area. No unrelated refactors. Never rename `window.playwrightFlowStudio`.
5. Extend an existing verifier. A **new** `verify:*` script must be registered in
   `scripts/lib/verifier-classification.ts` or `verify:verifier-classification` fails.
6. **Mutation-test** the new check: break the fix, confirm `FAIL`, revert. A check that has never
   been seen to fail is not evidence.
7. `bd close <id>`, update docs, commit.

**Traps that have already cost this repo time:**

- **Opening or closing a bead moves the pinned counts** in `scripts/verify-roadmap-dashboard.mjs` —
  currently `112 issues`, `30 outstanding / 82 closed`, `declaredBlocked === 2`. Update them in the
  same commit or the gate fails for a reason that looks unrelated to your change.
- **A new `docs/ai/CURRENT_STATE.md` top section must quote the ledger tally**
  (`61 PASS / 4 NOT RUN / 1 BLOCKED`). `tools/roadmap/lib/parse-narrative.mjs` reads only the newest
  section, so a head without it silently drops the file from the consistency banner **while the
  banner still reads "Sources agree"**.
- **Never hand-edit `tools/roadmap/` to change a number.** It is derived. Update the source that owns
  the fact.
- **`.every()` needs a cardinality assertion beside it**, or it passes vacuously over an empty list.
- **Capture permissively, validate strictly.** A restrictive capture regex drops malformed input
  instead of flagging it, so the check passes precisely when it should fail.
- **Verify a CSS change by its computed value**, not its declaration — a later cascade block may win.
- Report gates you did **not** run, and why. Packaging/offline gates are correctly skipped when no
  packaging or offline surface changed; say so explicitly rather than leaving it unstated.

---

## Tranche 1 — the four P1 code defects (start here)

Independent of each other, each fully specified in its bead, two of them severe. This is the one
tranche unambiguously finishable in a single session.

**Order: `awkit-cxa` then `awkit-7lj` first** — silent data loss, then the security hole.

### `awkit-cxa` — silent DATA LOSS on a designer round trip
`fromFlowStep` (`app/renderer/components/workflow/flowStepMapping.ts`) derives the node value from
`step.url ?? valueSource?.value ?? … ?? ""` and **never reads `step.value`**. A `FlowStep` carrying
only `value` (no `valueSource`, not a `goto`) resolves to `""` on load, and `toFlowStep` then emits
`value: data.value || undefined` → `undefined`. One open+save in the designer destroys it, with no
error shown.

**Reachable on shipped data:** `resources/test-fixtures/mock-site/flows/mock-conditional-flow.json`
stores its condition node with a `value` expression and no `valueSource`. Reproduce with that fixture
before changing anything.

### `awkit-7lj` — unauthenticated reads of the flow library
`app/main/ipc/flow.ipc.ts` registers `flows:list`, `flows:get` and `flows:export` as
`async (_, …)` with **no `assertSenderPermission`**, while `create`/`update`/`delete`/`clone`/`import`
in the same file do enforce it. Any sender — including one with no bound session — can enumerate the
library, read any flow by id, and export it.

Fix shape is already proven three times in this repo (`AWKIT-REC-001`, `AWKIT-REP-001`,
`AWKIT-SET-001`): take the `event`, call `assertSenderPermission(event, Permission.PAGE_FLOWS)` on the
reads. Verify with **both** a pre-auth probe and a Viewer probe.

### `awkit-oyc` — failure evidence captured after the retry loop
The failure screenshot is taken in `FlowExecutor.runStepWithRetries` *after* the whole retry loop
(`src/runner/FlowExecutor.ts:446-448`). A retry that navigates, refreshes, dismisses a dialog or
re-renders **destroys the broken state before it is photographed**, and intermediate failed attempts
get no evidence at all. `StepExecutor.execute`'s catch block (`src/runner/StepExecutor.ts:287-307`)
already holds the correct per-attempt scope and already saves the trace chunk there for exactly this
reason — evidence capture belongs alongside it.

### `awkit-ebh` — one popup Page registered under two aliases
`PlaywrightRunner.runFlowWithChildren` installs a context-level `page` handler assigning a
**positional** `popup-${++runnerPopupCounter}` (`src/runner/PlaywrightRunner.ts:471-479`), while the
click path separately registers the recorded alias via `registerPopupPage(...)`
(`src/runner/StepExecutor.ts:1255`). Both fire for the same popup, so the Page is reachable under two
keys and the counter-derived key depends on arrival order — multi-window flows replay
non-deterministically. **The bead warns you cannot simply delete one call site; read it in full.**

**Verify:** `npm run build`, `npm run verify:runner`, plus `verify:flow-step-mapping` and
`verify:recorder-authz` as each item touches them.

---

## Tranche 2 — remaining code defects, and making packaging fail loudly

### `awkit-epz` (P1) — only the fail-loud half is yours
`vendor/`, `resources/browsers/` and `resources/oracle-jdbc/` are gitignored (27 of 339 `resources/`
files tracked) and `electron-builder.json` copies both trees wholesale as `extraResources`. A pristine
checkout therefore builds an artifact ~830 MB lighter with **no bundled Chromium**: it packages, it
launches, it cannot automate anything, **and nothing fails loudly**.

Build the loud failure — a packaging/startup check that refuses when the bundled Chromium is absent
and names exactly what is missing. **The vendoring strategy itself is an owner decision** (see below);
do not pick one.

### The rest
- **`awkit-c0c`** (P2) — `resources/dependency-manifest.json` has a single `application.builtAt`
  recording when the *manifest* was regenerated, which readers reasonably take as the vintage of the
  *payload* it describes. Separate the two.
- **`awkit-60w`** (P2) — numeric record-to-replay fidelity gate for the recorder: a measured
  percentage, not pass/fail.
- **`awkit-v4r`** (P3) — locator recovery memory: remember the winning candidate, recover when every
  recorded candidate misses. Complements the runtime self-healing already in
  `src/runner/LocatorFactory.ts`.
- **`awkit-4a6`** (P3) — Instance Monitor: a second read-only CDP observation client plus an on-disk
  run trace.

---

## Tranche 3 — Zvec semantic subsystem (3 × P1, one epic)

`awkit-9yv`, `awkit-hzf`, `awkit-ttd`. Treat as a unit — they share the native host and a staged or
packaged tree, which makes them far heavier than Tranche 1 despite the same priority.

**Do `awkit-9yv` first.** The shared `SemanticStoreContract` currently runs against
`ZvecSemanticStore` through `FakeZvecHostTransport`, which proves adapter translation only. Until the
same suite runs through `ZvecUtilityHostManager` and the packaged raw native host against a real Zvec
collection, the other two cannot be trusted.

- **`awkit-hzf`** — a request that exceeds its deadline is **ambiguous**: the host may have applied
  the mutation, may be about to, or may have died before touching the collection. Reconcile it.
- **`awkit-ttd`** — rebuild orchestration and generation activation. Close the candidate **before**
  pointer activation; the pointer swap is the commit point.

**Probe the real binding rather than inferring from `.d.ts`.** Inferring absence from types has
already cost this project a full round of Zvec work.

---

## Tranche 4 — Async engine

- **`awkit-4km`** (P2) — `ApiPollingCondition` (202 Accepted → poll to terminal
  status/responseField/uiOutcome, `maxAttempts`), WebSocket/SSE lifecycle observation behind a
  capability check, CDP diagnostics.
- **`awkit-y24`** (P2) — completion policy is a single per-step scalar (`FlowStep.completionMode`)
  applied to **all** `afterWaits`, giving only flat AND or flat OR. Add grouped composition —
  `A AND (B OR C)`.

`awkit-y24` changes a persisted profile field. **Extend `WaitCondition` rather than forking it**, and
run the round-trip verifier: the Randomized Test Lab already fixed 13 round-trip defects, and the
"preserve, don't re-derive" pattern in `flowProfileMapping.ts` is the one to follow.

---

## Tranche 5 — Identity, licensing, RBAC

| Item | What |
|---|---|
| `awkit-aty` (P2) | Super User recovery codes: generated at first-run bootstrap, shown once, hash DPAPI-wrapped; entering one on the login screen forces a protected SU password reset. |
| `awkit-s05` (P2) | Machine licensing Phase 5: Ed25519-signed per-machine licenses (issue/import/revoke), machine fingerprint, tamper and clock-rollback detection. Independent of authz. |
| `awkit-x13` (P2) | App-wide licensing status banner + periodic background revalidation. |
| `awkit-i3e` (P3) | Active Directory provider behind the existing provider abstraction — the AD login tab is a disabled "Coming later" stub. Stay offline-first: no runtime egress unless configured. |
| `awkit-gsf` (P3) | RBAC v2: per-user grant/deny overrides applied in `effectivePermissions`, plus admin-defined custom roles. Schema and `AuthorizationService` are already structured for it. |

Do `awkit-s05` before `awkit-x13` — a status banner needs licenses that have status.

---

## Tranche 6 — Test Lab chain (strictly ordered)

The four blocked items are blocked *only* by their predecessor, so this chain unblocks itself as it
goes:

```
awkit-wza.5  (Phase 4: failure artifacts, shrinking, CLI)   ← the only startable one
  └→ awkit-wza.6  (Phase 5: live execution against the mock site)
       ├→ awkit-wza.7  (Phase 6: campaign reporting)
       ├→ awkit-wza.9  (Phase 8: application-lifecycle campaigns)
       └→ awkit-wza.8  (Phase 7: Super-User Test Lab UI)
```

Start at `awkit-wza.5`: `FailureArtifactWriter` (seed, generator version, definitions, constraints,
coverage, machine snapshot, failure category, reproduction command — originals never overwritten),
`FailureReproducer` + `Shrinker`, and the `npm run test:random:*` script entries that were deferred
because `package.json` was contended at the time.

---

## NOT Codex's work — these need the owner

**Do not attempt to close these. Do not mark them done.** Surface them and move on. Six of the thirty
queued items are here.

| Item | What is actually needed |
|---|---|
| `awkit-az7` | Reports is 14 PASS / 2 NOT RUN, and the bead itself says **"NO ENGINEERING REMAINS"** — both cases are owner-decision OS shell launches an agent cannot approve. |
| `awkit-8ri` | Settings is 19 PASS / 2 NOT RUN. Neither case is ordinary engineering: an unavailable-secret-store variant and an OS folder launch. |
| `awkit-1cc` | **DECIDED 2026-07-29** — enforcement ON by default, no production toggle, one-time 14-day migration window for upgraded installs only. See `docs/ai/DECISIONS.md`. |
| `awkit-cm8` | Oracle external gates: packaged EXE and clean-machine. The 2026-07-17 "4 gates" framing is stale — `docs/ai/ORACLE_JDBC_VALIDATION_GATES.md` is current. |
| `awkit-7bu` | **Declared blocked.** Real Oracle 19c run — an authorized operator for SYSDBA provisioning plus an out-of-band ephemeral credential. **No agent may retrieve, reconstruct, print or persist that password.** |
| `awkit-cey` | **Declared blocked.** REC-022 real-IdP Chrome handoff — an authorized operator with an approved test identity. Everything the offline mock can express is already automated at `verify:protected-login-recorder` 57/57. |
| `awkit-epz` *(part)* | **Policy decision** — how bundled binaries become reproducible: git-lfs, a checksummed fetch script, or documented provenance. You build the fail-loud check; the owner picks the strategy. |

Also owner-gated, outside the bead queue: **Phase J** stays `partially-completed` until the
clean-machine offline GUI walkthrough is executed, and **Phase K** until `awkit-cey` is.

---

## Verification

Per tranche, run what the touched surface requires and report the counts:

```bash
npm run build
```
```bash
npm run verify:runner
```
```bash
npm run verify:roadmap-dashboard
```

Add the per-area suites as they apply — `verify:recorder-*`, `verify:concurrency`, `verify:reports`,
`verify:telemetry`, `verify:workflow-*`, `verify:mock-site`, `verify:semantic-*`. For offline or
packaging changes, `npm run validate:offline`. There is no `lint` and no `test` script.

The Overview banner must still read **"Sources agree"** at the end of every tranche.

---

## Close out — every tranche

1. `bd close` what is finished; file beads for anything discovered, with `blocks` edges for real
   dependencies.
2. Update the pinned bead counts in `scripts/verify-roadmap-dashboard.mjs` — they move whenever a bead
   opens or closes.
3. `docs/ai/CURRENT_STATE.md` (new section **must** quote the ledger tally) and `docs/ai/TASK_LOG.md`.
   `FEATURES.md` / `ARCHITECTURE.md` / `COMMANDS.md` / `DECISIONS.md` only if they changed.
4. `docs/ai/KNOWN_ISSUES.md` for any repeated bug, fragile area or risky assumption found.
5. Clear your claim in `tools/roadmap/assignments.json`.
6. `npm run verify:roadmap-dashboard` → Overview reads "Sources agree".
7. Commit to `main` with a body recording what works, what is incomplete, and which gates ran with
   their counts. Read `.codex/skills/git-full-cycle/SKILL.md` first.
