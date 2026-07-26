# Agent Handoff

## ACTIVE (2026-07-26, latest): packaged gate re-verified at `82c2514` — 70/70

The package was rebuilt and `verify:packaged-walkthrough` re-run: **70 passed, 0 failed**. This is
the first packaged run covering the whole session together — `manualApproval` routing, the Reports
authorization/export contract, and Settings authorization plus main-process validation. Fixes
confirmed present in `out/main/main.js` before the run.

**The staleness guard is now proven in the wild.** It refused the previous package, naming
`ConfirmDialog.tsx` as newer than the payload — on work it was not written for. After any `src/` or
`app/` change, repackage before citing a packaged result; the verifier will stop you rather than let
a misleading pass through.

`resources/dependency-manifest.json` holds the regenerated `builtAt` — produced by packaging, never
hand-edited.

### Still open

- **`awkit-cww`** — `benchmark:oracle-jdbc` Node RSS check is **RED** (8 PASS / 1 FAIL). The
  endpoint-delta method cannot distinguish a leak from GC sawtooth; threshold deliberately NOT
  loosened. Owner decision.
- **41 of 66** focused cases remain `NOT RUN` (Recorder 18, Reports 11, Settings 12).
- **`ORA-LIVE-001`** (`awkit-7bu`) — blocked on an authorized operator *and* still has no real-mode
  code path in `verify-oracle-mock-ui-workflow.mts`.
- Clean/offline Windows VM walkthrough and protected-login manual handoffs remain external gates.

## PRIOR (2026-07-26): Settings 116/116; AWKIT-SET-001–004 resolved

The Settings phase of `FULL_VALIDATION_REMEDIATION_PROMPT.md` is complete. The new
`npm run verify:settings-e2e` creates a timestamped isolated profile, seeds representative product
data and synthetic secrets, then drives every Settings section through the real Electron renderer,
preload and sender-bound main process with restart and direct-IPC negative controls.

- Complete pre-fix negative control: **81 PASS / 33 FAIL** at
  `test-artifacts/settings-e2e/2026-07-26T09-49-23-933Z/`.
- Final: **116 PASS / 0 FAIL** at
  `test-artifacts/settings-e2e/2026-07-26T09-55-38-176Z/`.
- `AWKIT-SET-001` (S2): Settings metadata/UI reset/folder operations and every Secrets handler lacked
  authoritative sender permission checks. Reads now require `PAGE_SETTINGS`; mutations require
  `SETTINGS_EDIT`.
- `AWKIT-SET-002` (S2): crafted updates/imports bypassed authoritative validation. Main-owned writes
  now validate before persistence; arrays are rejected, unknown fixed-schema keys pruned and GUI
  import capped at 1 MB.
- `AWKIT-SET-003` (S3): a file was reported as a writable directory. Path validation now requires a
  directory.
- `AWKIT-SET-004` (S3): errors were not announced and modal focus escaped/was not returned. Settings
  live regions and `ConfirmDialog` keyboard focus semantics are fixed.
- Regressions: Settings persistence 3/3, RBAC 51/51, HTTPS 31/31, capacity 12/12, accent 33/33,
  branding 30/30, Oracle Drivers 30/30, Flow Designer 56/56, Workflow Builder 20/20, secrets 16/16,
  authz 40/40, IPC contract 4/4, type-checks and build pass.

Do not overclaim 116 assertions as 21/21 Settings cases. Only SET-001 and SET-018 moved to PASS;
partially executed cases remain `NOT RUN` for their exact unexecuted submatrices. Settings are
**9 PASS / 12 NOT RUN** and the combined Recorder/Reports/Settings ledger is **41 NOT RUN**.

## ACTIVE (2026-07-26, latest): populated Reports 64/64; AWKIT-REP-001/002 resolved

The next phase of `FULL_VALIDATION_REMEDIATION_PROMPT.md` is complete. The new
`npm run verify:reports-populated-gui` seeds real SQLite/report stores in an isolated profile and
drives Overview, Workflow, Instance, Failure, Runtime, Chrome, Server and Run Artifacts through the
real Electron/preload/IPC boundary.

- Pre-fix negative control: **44 PASS / 13 FAIL** at
  `test-artifacts/reports-populated-gui/2026-07-26T09-16-20-217Z/`.
- Final: **64 PASS / 0 FAIL** at
  `test-artifacts/reports-populated-gui/2026-07-26T09-30-15-417Z/`.
- `AWKIT-REP-001`: pre-auth/no-role telemetry and report reads lacked sender-bound authorization.
  Fixed with `PAGE_REPORTS` on every telemetry/report read.
- `AWKIT-REP-002`: Run Artifacts used an incompatible summary shape, lacked trusted open/export
  bridges, exported only its card, and exposed Export to Viewer. Fixed against the real stored-report
  contract with `REPORT_EXPORT` enforcement and an id-only main-owned folder-open boundary.
- Regressions: Reports 31/31, telemetry 61/61, observability 65/65, Runtime Analytics 36/36,
  real-Electron RBAC 51/51, IPC contract 4/4, type-checks and build pass.

Do not overclaim the 64 assertions as 16/16 Reports cases. Only SYS-REP-002/003 moved to PASS.
SYS-REP-004–012 and 015 have useful populated/auth subsets but remain `NOT RUN` until the exact
remaining submatrices execute; SYS-REP-016 is untouched. Actual Explorer launch was not run.
Reports are **5 PASS / 11 NOT RUN** and the combined Recorder/Reports/Settings ledger now has
**41 NOT RUN** after the Settings campaign.

## ACTIVE (2026-07-26, latest): REC-018 is complete — Recorder E2E 41/41

The decisive Recorder release gate is now executed, not inferred from component suites.
`npm run verify:recorder-e2e` drives the real Electron Recorder controls, bundled Chromium, Stop,
Save to Flow Library, full restart/reopen, production `ExecutionEngine`, Flow Designer no-op save,
and a second production replay. Result: **41 PASS / 0 FAIL**. Evidence:
`test-artifacts/recorder-e2e/2026-07-26T08-59-26-977Z/`.

The fixture stays inert during replay; a resettable mock-site oracle is cleared after capture and
before each run, so only the replayed actions can submit the fixed synthetic target values. Both
runs completed all eight nodes in order and wrote valid JSONL logs, reports, and recovery state.
No authentication secret entered those artifacts. No protected-login control was exercised or
bypassed.

Regressions: mock site 90/90, Recorder locator/Smart Wait 78/0, flow conversion 19/19, draft/URL
17/17, script type-check and production build pass.

## ACTIVE (2026-07-26, latest): AWKIT-E2E-001 fixed — comprehensive campaign 9/9

Phase 0-1 of `docs/testing/comprehensive-validation/FULL_VALIDATION_REMEDIATION_PROMPT.md` is done.
**There is no longer a known open product defect.** Recorder, the first populated Reports phase and
the Settings core campaign are complete; exact remaining case submatrices are next.

### What changed

`FlowExecutor.resolveNext` never routed a flow-level `manualApproval` edge, so a `manualHandoff` node
whose only outgoing edge was `manualApproval` reported `passed` while End never executed. Fixed by a
`manualApproval` case gated on `outcome === "manualContinued"` (an explicit operator resume), plus a
guard that fails — rather than silently passes — a flow that dead-ends at an ungranted approval edge.
Full rationale and the deliberate scope limits are in `CURRENT_STATE.md` and `DEFECTS.md`.

Bead `awkit-3eo`. The defect had been tracked only in `DEFECTS.md` and had **no Beads record** — worth
checking for other markdown-only defects.

### Verified at this change

`verify:runner` **89/0** (84 + 5 new regressions) · `verify:comprehensive-e2e` **9 PASS / 0 FAIL** ·
`verify:concurrency` 78/0 · `verify:waits` 56/0 · `verify:popup` 12/0 · `verify:cancellation` 12/0 ·
`verify:artifacts` 13/0 · `verify:flow-step-mapping` 101/0 · `typecheck` + `typecheck:scripts` clean.
Evidence: `test-artifacts/comprehensive-e2e/2026-07-26T00-01-06-419Z/` (the pre-fix run at
`2026-07-25T22-37-55-841Z/` is retained, not overwritten).

`package:portable` was rebuilt and `verify:packaged-walkthrough` re-run against it: **70/70**.

### `verify:packaged-walkthrough` now refuses a stale packaged tree

It previously drove whatever sat in `dist/win-unpacked` with **no freshness check** — a packaged pass
was only as trustworthy as whoever remembered to repackage first, and nothing in the suite would have
said otherwise. Part A now refuses when the newest file under `src/` or `app/` is newer than the
packaged payload, naming the file and both timestamps. Negative-controlled (a touched source file
made it exit 1; the file was then confirmed byte-identical to `HEAD`). Same class of trap as the
stale Zvec host tree recorded further down this file.

If you change product code, **repackage before citing any packaged result** — the verifier will now
stop you rather than let you publish a misleading pass.

### Remaining work, in priority order

1. **The remaining 41 `NOT RUN` cases** in `RECORDER_REPORTS_SETTINGS_TEST_CASES.md`. REC-018,
   SYS-REP-002/003 and SET-001/018 are now PASS; complete the exact residual Recorder, Reports and
   Settings submatrices recorded beside each case.
   Beads: `awkit-az7` (Reports),
   `awkit-8ri` (Settings). Bead `awkit-gi2` can be closed when the user-owned Beads changes are
   reconciled; this work deliberately did not modify `.beads/*`.
2. **`ORA-LIVE-001`** (bead `awkit-7bu`) — needs an authorized operator with SYSDBA and an
   out-of-band ephemeral `SPECTER_READER` password. Not agent-actionable; do not let it block the rest.
3. **Beads hygiene** — `bd ready` is stale against `main` (it still lists `awkit-oyc` and `awkit-ebh`,
   both merged). Cross-check before treating any bead as open. `AWKIT-E2E-001` had lived only in
   `DEFECTS.md` with no Beads record at all — worth checking for other markdown-only defects.

### Do not touch

- Do not treat `manualApproval` as a general success edge, and do not enable it on `sessionCaptured`.
  Both would bypass the approval semantic the fix exists to protect.
- Do not remove the dead-end guard in `executeFlow` — it is what stops the silent success from
  relocating rather than being fixed.

## PRIOR (2026-07-26): verification pass — no source changes; tree is current

A verification-only session. **No source file was modified.** The Oracle mock-UI work described in the
sections below was already committed at `cfe4594`; this pass independently re-ran its gates at `HEAD`
and added one piece of evidence that was not previously recorded.

### Repository state (verified, not assumed)

| | |
|---|---|
| Branch | `main` (single-branch policy) |
| HEAD | **`d43dfa6`** — `git rev-parse HEAD` == `origin/main`; nothing to push |
| Working tree | clean **except** `.beads/interactions.jsonl` and `.beads/issues.jsonl` |
| Source/doc diff | none — `git diff HEAD` is empty for all code, scripts, and `docs/ai/` |

### Re-verified at `d43dfa6`

| Command | Result |
|---|---|
| `npm run verify:oracle-mock-ui` | **36 passed, 0 failed** (builds + drives the real Java bridge; no database) |
| `npm run verify:oracle-bridge` | **32 passed, 0 failed** (generic mock shape unaffected by the fixture branch) |
| `npm run build` | PASS (`tsc --noEmit` + main/preload/renderer bundles) |
| `node scripts/ai-memory/check-memory.mjs` | PASS |

### New evidence: `verify:oracle-mock-ui` is not vacuous

A deliberate-drift negative control was run and reverted. Changing one fixture row's country from `AE`
to a non-existent `ZZ` failed **exactly two** checks with precise diagnostics —
`every country / accountType / skill / gender is a real option — null-optional-text: country ZZ` and
`every value agrees with the SQL fixture — row 2 column COUNTRY: mock="AE" sql="ZZ"` — then passed
36/36 again after restoring the file (confirmed byte-identical to a pre-test copy).

This matters because the suite's value rests on two claims that would otherwise be untested: that the
SQL fixture and its database-free twin cannot silently drift apart, and that the fixture's select/radio
values are still real controls on `/form`. Both now have a demonstrated failure mode.

### Remaining work

1. **Provision `SPECTER_MOCKUI` on real Oracle** — still **NOT RUN**. Requires an authorized operator:
   SYSDBA provisioning, an out-of-band ephemeral `SPECTER_READER` password, then rotate + `ACCOUNT LOCK`.
   Procedure: `docs/ai/ORACLE_JDBC_VALIDATION_GATES.md`. The one BLOCKED workflow case is live-Oracle only.
2. **Unrelated open defect** — the `manualApproval` connector routing failure keeps the broader campaign
   at 8 PASS / 1 FAIL. Not caused by, and not fixed by, the Oracle work.
3. **Beads hygiene** — `awkit-v8x` was opened and closed during this pass for work that `cfe4594` had
   already delivered, so it is a duplicate record. `.beads/*.jsonl` is the only dirty path in the tree;
   reconcile or drop it before the next sync rather than treating it as new scope.

### Do not touch

- Do not retrieve, persist, print, or reconstruct an Oracle password anywhere, including logs and Markdown.
- Do not weaken the fail-closed rule: packaged builds must never accept the mock executor.
- Do not hardcode `DATE` or `NUMBER(p,2)` values in `MockFormCasesFixture` — it deliberately mirrors the
  real JDBC conversions (`Timestamp`→`Instant`, JVM-zone dependent; `BigDecimal.toPlainString()`), and
  hardcoding would disagree with a real database on any non-UTC host.
- Do not create branches or worktrees; `main` is the only development branch.

### Recommended next step

Take the three-surface remediation prompt below (`RECORDER_REPORTS_SETTINGS_REMEDIATION_PROMPT.md`) — it
is the only self-contained, execution-ready brief outstanding. The Oracle track needs an operator with
database credentials, not an agent, so it should not block it.

## ACTIVE (2026-07-26): three-surface remediation prompt ready

Use `docs/testing/comprehensive-validation/RECORDER_REPORTS_SETTINGS_REMEDIATION_PROMPT.md` for the
next implementation pass. It is self-contained and orders the work as: reproduce/fix
`AWKIT-E2E-001`, create isolated deterministic fixtures, complete the Recorder release journey,
exercise populated Reports, complete Settings safety/RBAC/accessibility, then run cross-feature and
packaged regression. It explicitly forbids treating `NOT RUN` as a defect without reproduction and
keeps protected authentication as manual handoff.

## ACTIVE (2026-07-26): Recorder / Reports / Settings test-design gap closed

The comprehensive package now includes
`docs/testing/comprehensive-validation/RECORDER_REPORTS_SETTINGS_TEST_CASES.md`: 66 focused cases
with exact preconditions, steps, expected outcomes, safety boundaries, evidence mapping, and honest
execution status.

Recorder's decisive REC-018 journey is PASS at 41/41. The populated Reports core is 64/64 and the
Settings core is 116/116; the exact partially executed case submatrices remain documented beside
their `NOT RUN` statuses. Manual protected-login completion stays `BLOCKED`; no CAPTCHA/MFA/security
control was bypassed.

## ACTIVE (2026-07-26): Oracle Data Source → row-driven browser workflow complete

The missing Oracle mock-UI workflow is now persisted and executed. The same credential-free fixture
set can run through the explicit development mock bridge today and against real Oracle after an
authorized operator provisions the schema and supplies a fresh ephemeral reader password.

- Fixtures: `resources/test-fixtures/mock-site/data-sources/mock-oracle-form-cases.json`,
  `flows/mock-oracle-form-flow.json`, `workflows/mock-oracle-form-workflow.json`.
- Main evidence: `test-artifacts/oracle-mock-ui-workflow/2026-07-25T22-36-01-353Z/execution-summary.json`.
- Result: **7 PASS / 0 FAIL / 1 BLOCKED**. The blocked case is live Oracle only; it was not attempted
  without credentials.
- Production path: 8 data-driven `ExecutionEngine` instances, maximum 2 active, all completed;
  run-level report + 8 JSONL logs + 16 engine screenshots.
- Lower-level matrix: every mapped form value checked for all 8 rows, plus stale-checkbox reuse and
  native required-terms blocking.
- Fixes: scheduled rows now reach `currentRow`, structured connectors can read `currentRow.*`, Oracle
  DATE instants fill HTML date controls as local calendar dates, and the lab terms checkbox is required.
- Green regressions: Oracle fixture 36/36, bridge 32/32, runner 84/84, concurrency 78/78, mock site
  84/84, verifier taxonomy 134/134, script type-check, production build.
- Broader campaign remains **8 PASS / 1 FAIL** at
  `test-artifacts/comprehensive-e2e/2026-07-25T22-37-55-841Z/`; the known unrelated
  `manualApproval` connector defect remains open.

Do not retrieve or persist an Oracle password. For the live rerun, the user/operator must provision
`SPECTER_MOCKUI`, unlock/mint the reader credential out of band, export `AWKIT_ORACLE_LIVE_*`, run the
live gate, then rotate and lock the account.

## ACTIVE (2026-07-25, latest): native-host contract + rebuild orchestration — verified and pushed

The previous session ended with unverified work in the tree after a shell-tooling outage. That work
has now been **compiled, executed, corrected and pushed**. The tree is clean apart from docs/beads.

### Repository state

| | |
|---|---|
| Branch | `main` (single-branch policy) |
| HEAD | **`67835cd`** — `git rev-parse HEAD` == `origin/main`, confirmed after `git fetch --prune` |
| Working tree | clean except `docs/ai/*` and `.beads/issues.jsonl` |

| Commit | Contents |
|---|---|
| `a1e6bc8` | Identity filtered by a derived **`entityKey`**, never by raw `entityId` |
| `d208c64` | **Real utility-host protocol alignment** — the three defects below |
| `67835cd` | **Rebuild orchestration** — watermark + ordered delta replay |

### Verification actually executed at `67835cd`

`npm run build` PASS · `npx tsc --noEmit` PASS · `npm run typecheck:scripts` PASS ·
`verify:semantic-zvec-native-contract` **21/0** *(real Electron `utilityProcess` + staged raw host +
real Zvec binding; shared contract suite **68/68**)* · `verify:semantic-rebuild` **56/0** ·
`verify:semantic-store` **151/0** · `verify:semantic-queue` **70/0** ·
`verify:semantic-zvec-filter` **89/0** · `verify:semantic-policy` **141/0** ·
`verify:zvec-generation-lifecycle` **102/0** · `verify:zvec-generation-recovery` **134/0** ·
`verify:zvec-generation-concurrency` **12/0** · `verify:zvec-host-source-boundary` **22/0**.

Packaged validation then completed too (from `5311d57`): `verify:zvec-packaged-assets` 17/17 ·
`verify:semantic-zvec-native-contract` **21/0 against the packaged tree** (`dist/win-unpacked`) ·
`verify:zvec-packaged-live` **35/0** · `verify:zvec-coexistence` 16/0 · **NSIS installed layout
35/0**, installed per-user unelevated and uninstalled clean (host tree gone, HKCU key cleared, no
residue). `resources/dependency-manifest.json` now records `hostProtocolVersion: 2`.

**Not run:** `validate:offline`, `verify:runner`, mock-site verifiers, signing/SmartScreen, and the
clean-machine walkthrough (optional/non-blocking by owner policy).

### What the real-host verifier found (all fixed in `d208c64`)

Driving `ZvecSemanticStore → ZvecUtilityHostManager → utilityProcess → raw host → Zvec` exposed three
defects that a fully green suite had hidden, because the transport fake was more permissive than the
backend:

1. **`open` returned `{generation}`, not `{collectionId}`.** The adapter read `collectionId`, got
   `undefined`, and reported `BACKEND_UNAVAILABLE` for a collection that had in fact opened.
   *(Fixed and verified — `verify:semantic-store` 151/0 after the fix.)*
2. **Zvec rejects `:` in a document primary key.** AWKIT ids are `kind:component:hash`, so **not one
   document could ever have been written to a real index.** Every test passed because the fake used a
   JavaScript `Map`, which accepts any string as a key. Measured accepted charset:
   `A-Za-z0-9` plus `- _ . @ # + =`; rejected: `:` `/` `\` `~` `|` `,` `;`, space, non-ASCII, and an
   over-long key (64 chars fine, 200 refused). Fixed by deriving the backend key
   (`toZvecDocumentKey = sha256(id)`) while the AWKIT id stays in the `id` FIELD — colons are legal in
   a field *value*, only the key is restricted.
3. **`fts: {}` is REJECTED, not treated as match-all.** Every filter-only search (`text: ""`) would
   have failed against the real host; the fake accepted it. Now sent as a scalar-only query with an
   explicit match-all clause.

`FakeZvecHostTransport` now enforces the real key charset and rejects an empty full-text clause, so
this class of defect cannot hide again.

### Rebuild orchestration (`awkit-ttd`, `67835cd`)

`SemanticRebuildOrchestrator` + queue watermark and ordered delta journal. Sequence:

    drain prior active writes → watermark W, start journalling → populate the candidate while normal
    mutations keep flowing to the ACTIVE generation and are also journalled → validate → pause
    draining, replay the post-W journal into the candidate in order, revalidate → close the
    candidate, swap the pointer, retarget, resume draining → only then clear rebuildRequired

The pointer swap is the single commit point. `queue.clear()` is never called on activation.

**Three defects were found by actually executing the verifier** (it opened at 42 passed / 5 failed):

1. **Real bug — delta completeness was judged against the live journal.** A mutation accepted while
   the replay was in flight counted as "unreplayed" and failed the rebuild, i.e. a busy index could
   never finish one. Such a mutation is necessarily still pending (draining is paused) and drains
   against the new generation, so completeness is now judged against the **captured** entry set. A
   regression test injects a write from inside the replay itself.
2. **A negative control asserted the wrong invariant** — "pending mutations are intact" required
   `queue.size` to be unchanged across a failed rebuild, which a *correct* implementation must fail,
   since draining before the watermark is what makes the watermark mean anything.
3. **A negative control was vacuous** — the replay-failure test declared its `populated` flag inside
   `openCandidate`, so it reset on the second open, the replay write succeeded, the rebuild
   activated, and the control passed while exercising nothing.

The suite-size guard in the native-contract verifier was also corrected from `>= 100` to `>= 68`
(the measured full size of `runSemanticStoreContract` with `entityOperations`); the original number
was written before that verifier had ever been executed.

### Running the semantic verifiers

```bash
npm run prepare:zvec-host
npm run verify:semantic-zvec-native-contract
```

`prepare:zvec-host` **must** run first: the native-contract verifier refuses a host tree that is not
byte-identical to `native-hosts/zvec/zvec-host.cjs` (its first ever run silently tested the old
protocol-v1 host from `dist/win-unpacked`).

### Measured facts about `@zvec/zvec` 0.6.0 that no type signature reveals

Each of these cost a real debugging cycle. **Do not re-derive them from the `.d.ts` — it is
incomplete, and inferring absence from it is what produced a wrong architectural conclusion the round
before this one.**

1. Filter equality is a single `=`; `==` is a syntax error. `IN` takes parentheses, not brackets.
   `NOT <field> = <v>` does not parse — use `!=`. `AND` / `OR` / `IS NULL` / `LIKE` / `>=` work.
2. `filter` is a **PRE-filter**, applied before ranking, so pushing it into the query is a
   *correctness* fix, not an optimisation.
3. `topk` is **not** vendor-capped. The former 100-document ceiling was AWKIT's own
   `Math.min(topK, 100)` in the host.
4. A `nullable` STRING field **rejects an explicit `null`**. Absent optionals must be **omitted**;
   omission reads back as NULL for `IS NULL`.
5. `deleteByFilterSync` returns a **status object** and does not throw — an unchecked call reads an
   invalid-filter rejection as a successful delete.
6. **No escaper is safe for arbitrary strings.** Escaping only quotes throws on backslash values;
   escaping both **silently matches nothing**. Unsafe values are refused, and identity is filtered
   through the derived `entityKey` so no identity is ever unrepresentable.
7. A document **primary key** accepts only `A-Za-z0-9 - _ . @ # + =` and is length-bounded.
8. `outputFields: []` returns ids with no scalar fields (documented only for `fetch`, but it works on
   `query`) — that is what lets an exact-count pass avoid transferring document bodies.

### Known risks / blockers

- **The orchestrator is not yet wired to a real generation root.** It is verified against in-memory
  stores and a generation-lifecycle stub only; `openCandidate` / `rebuildGeneration` / `retarget`
  still need binding to `rebuildIntoNewGeneration` and a real runtime root.
- **A verifier that has never been executed is not evidence.** Both new verifiers contained
  assertions that were wrong in the direction of *passing* — a vacuous negative control and a
  suite-size floor above the suite's real size. Run a new verifier before citing its checks.
- **A stale host tree silently produces a false result.** The native-contract verifier's first run
  tested the old protocol-v1 host from `dist/win-unpacked`. It now refuses any tree that differs from
  the repo source; `dist/win-unpacked` is still stale until the next `package:portable`.
- `resources/dependency-manifest.json` still records `hostProtocolVersion: 1`. It is generated by
  packaging — **do not hand-edit it.**
- **A fake that is more permissive than the real backend relocates risk rather than reducing it.**
  Three defects in this subsystem survived a fully green suite for exactly that reason. When adding to
  `FakeZvecHostTransport`, model the binding's REJECTIONS, not just its shapes.
- Writing a literal control character into source is a recurring trap here (it happened again this
  session, in a check *about* control characters). Always use `\uXXXX` escapes;
  `verify:source-hygiene` is the guard.
- Not run: `verify:zvec-packaged-live`, `verify:zvec-coexistence`, the NSIS installed-layout matrix,
  `validate:offline`, `verify:runner`, and the mock-site verifiers.

### Do not touch without confirmation

- `native-hosts/zvec/zvec-host.cjs` must stay raw, unbundled CommonJS, `utilityProcess`-only, and
  must never regain a crash-injection path.
- A filter **string** must never cross `SemanticStore`. The host builds it from a typed clause list
  and an allowlist, duplicated on purpose (as `assertConfinedPath` duplicates
  `isConfinedGenerationPath`). An empty clause list is refused, so "delete where nothing" can never
  mean "delete everything".
- Raw `entityId`, `revision` and `nodeId` must stay OUT of the filter allowlist in **both** copies.
- `queue.clear()` must not be called because a rebuild activated — that is what discards a user's
  mid-rebuild changes.
- The active-generation pointer is authoritative; the pointer swap is the only commit point.
- `electron-builder.json`'s `!node_modules/@zvec/**` exclusion and its `extraResources` entry.

### Recommended next step

**The orchestrator is now bound to the real generation runtime** (`src/semantic/SemanticIndexRuntime.ts`,
commit `27d93d1`), verified by `verify:semantic-rebuild-live` — orchestrator → generation filesystem →
`ZvecSemanticStore` → `ZvecUtilityHostManager` → `utilityProcess` → raw host → real Zvec, **23/0 with
62 lifecycle assertions**. Bounded shutdown is wired into `disposeSemanticSubsystem` and raced against
a 3s ceiling in `main.ts`.

Two defects only reachable there were fixed: **the rebuild path could never have run** (the host
treated an existing empty directory as an openable collection, and `createGeneration` always
pre-creates one), and **a rebuild overlapping a delete could never activate** (post-replay validation
read a correct deletion as corruption). See `CURRENT_STATE.md` for both.

**Phase 1B infrastructure is complete.** The next work is product functionality, in this order:

    authorized semantic main-process service → RBAC permissions → preload/API boundary
    → automatic approved projections → Settings health/rebuild controls → search UI

Nothing registers a runtime via `setSemanticIndexRuntime` yet, so shutdown currently has nothing to
drain — that registration belongs to the semantic service when it gains a projection source.

---

## PRIOR (2026-07-25): Zvec entity operations landed via protocol v2

**Branch/commit:** `main` @ `5f6250a` (working tree clean at the time). Single-branch policy.

**Done this session (bd `awkit-8lj`, CLOSED).** Host protocol **v2**: typed
`scan`/`count`/`deleteByFilter`, and `fetch`/`query` now return real documents.
`ZvecSemanticStore.capabilities.entityOperations` is `true`, so `deleteByEntity`, `stats` and `clear`
work instead of refusing.

**Read this before touching the semantic store — the previous recorded conclusion was wrong.** The
"vendor has no scan or cursor, `query` is capped at 100" note was incorrect: the cap was AWKIT's own
`Math.min(topK, 100)` in `zvec-host.cjs`, and `deleteByFilterSync` existed all along. It was settled
by *executing* the binding (`verify:semantic-zvec-filter`, 63/0), not by reading its `.d.ts`.

**Four measured facts that will bite anyone who assumes otherwise:**
1. Filter equality is a single `=`. `==` is a syntax error. `IN` takes parentheses, not brackets.
   `NOT <field> = <v>` does not parse — use `!=`.
2. A `nullable` STRING field **rejects an explicit `null`**. Absent optionals must be **omitted**;
   omission reads back as NULL for `IS NULL`.
3. `deleteByFilterSync` returns a **status object** and does not throw — an unchecked call reads an
   invalid-filter rejection as a successful delete.
4. **No escaper is safe for arbitrary strings.** Escaping only quotes throws on backslash values;
   escaping both silently matches NOTHING. Unsafe values are therefore refused, not escaped.

**Do not change without understanding why:** a filter **string** must never cross `SemanticStore` —
the host builds it from a typed clause list and an allowlist, duplicated on purpose (as
`assertConfinedPath` duplicates `isConfinedGenerationPath`). An empty clause list is refused so
"delete where nothing" can never mean "delete everything".

**Recommended next step:** bd **`awkit-ttd`** (rebuild orchestration and generation activation),
then bd **`awkit-9yv`** (run the shared contract suite through the REAL host in a `utilityProcess`).
`awkit-9yv` also carries the one gap this session did not close: the host's own filter builder,
two-pass exact-total query and post-delete re-scan are asserted by **source-drift checks, not
executed**.

**Not run:** `verify:zvec-packaged-live`, packaged/NSIS trees, `verify:runner`, mock-site verifiers.
The staged manifest's `hostProtocolVersion` is now 2; `resources/dependency-manifest.json` still
records 1 and is regenerated by packaging — do not hand-edit it.

---

## PRIOR (2026-07-25): Zvec Phase 1A complete - begin Phase 1B semantic store

### From Agent / Tool
Previous session (AI coding agent), working on `main` under the single-branch policy.

### To Agent / Tool
Any AI coding agent or human developer.

### Timestamp
2026-07-25

### Branch / Commit
`main` @ `4ddc773`, in sync with `origin/main`. Working tree clean. `main` is the ONLY branch,
locally and remotely (plus Beads' `__dolt_remote_info__` ref). No extra worktrees.

### Active Task
**Zvec semantic subsystem, Phase 1B: vendor-neutral semantic storage layer.** Phase 1A (native-host
foundation) is complete and pushed.

### Completed Work
Phase 1A, plus three rounds of review hardening:

- Raw unbundled utility host (`native-hosts/zvec/zvec-host.cjs`) shipped via `extraResources`,
  never inside `app.asar`.
- `ZvecUtilityHostManager` - lazy start, correlated requests with deadlines, compatibility gate,
  staged shutdown, masked diagnostics.
- `ZvecHostRestartPolicy` - pure, clock-injected restart + circuit breaker.
- Generation lifecycle: create / validate / activate / rollback, atomic pointer swap, reconciliation,
  quarantine, retention.
- `SemanticHealth` - seven degraded reasons plus `availableOnDemand`; `indexPath` is privileged and
  omitted unless explicitly requested.
- Phase 0 spike hook removed from `app/main/main.ts`; `__testAbort` removed from the shipped host.
- Live coverage restored WITHOUT a production hook: `verify:zvec-packaged-live` esbuilds a harness
  into a temporary Electron app directory and drives the real manager.
- All branches/worktrees consolidated into `main`; former tips preserved as pushed
  `archive/*-20260725` tags.

Defects found and fixed (each by running the real thing, not by unit tests alone):
1. Semantic data used roaming `%APPDATA%` instead of `%LOCALAPPDATA%`.
2. The host hard-coded its approved root, ignoring AWKIT's configurable runtime path.
3. Zvec was duplicated into `app.asar.unpacked` and stayed resolvable from the main process.
4. A failed metadata write deleted the generation the authoritative pointer named.
5. Reconciliation derived active identity from metadata, so an unreadable `metadata.json` deleted the
   active generation.
6. The allocator could reissue a missing active generation's name.

### Files Changed
- `native-hosts/zvec/zvec-host.cjs`
- `app/main/semantic/{ZvecUtilityHostManager,semanticService}.ts`
- `app/main/main.ts` (spike hook removed; staged shutdown; startup reconciliation)
- `src/semantic/{SemanticGenerationLayout,SemanticGenerationManager,SemanticGenerationReconciler,ZvecHostRestartPolicy}.ts`
- `src/semantic/contracts/{ZvecHostProtocol,SemanticHealth}.ts`
- `scripts/verify-zvec-*.mts`, `scripts/prepare-zvec-native-host.mjs`, `scripts/zvec-harness/**`
- `electron-builder.json`, `scripts/{generate-dependency-manifest,validate-offline-bundle}.ps1`

### Commands / Tests Run
| Command | Result |
|---|---|
| `npm run build` | PASS |
| `verify:zvec-host-source-boundary` | 22 passed, 0 failed |
| `verify:zvec-host-lifecycle` | 52 passed, 0 failed |
| `verify:zvec-generation-recovery` | 34 passed, 0 failed |
| `verify:zvec-generation-lifecycle` | 102 passed, 0 failed |
| `verify:zvec-generation-concurrency` | 12 passed, 0 failed |
| `verify:zvec-packaged-live` | 35 passed, 0 failed (packaged AND installed trees) |
| `verify:zvec-coexistence` | 16 passed, 0 failed |
| `package:portable`, `package:nsis`, strict `validate:offline` | PASS |
| `node scripts/ai-memory/check-memory.mjs` | PASS |
| `npm run typecheck:scripts` | **FAILS - pre-existing**, see Known Risks |
| `verify:runner`, `verify:popup-identity`, mock-site verifiers | NOT RUN this session |

### Current State Summary
Zvec loads only in an Electron utility process, from a packaged tree verified byte-for-byte against
its own shipped manifest. The active-generation pointer is authoritative everywhere. The subsystem is
reachable from NO product surface yet - that is intentional.

### Remaining Work
Phase 1B, in this order (order matters: nothing may enter a queue before sanitisation exists):
1. `SemanticDocument`, document kinds, typed metadata, typed search query/result, deterministic ID rules
2. Projection allowlist
3. `SemanticRedactor`
4. `SemanticPolicyValidator` + branded `ValidatedSemanticDocument`
5. `SemanticStore` interface
6. `InMemorySemanticStore` with real semantics (upsert-is-replace, token matching, injected failures)
7. Shared contract suite run against BOTH implementations
8. `ZvecSemanticStore` over `ZvecUtilityHostManager`
9. Serialized mutation/rebuild queue (coalescing, delete-supersedes-upsert, bounded, no blind replay)
10. Rebuild orchestration and parity tests

### Known Risks / Blockers
- **`npm run typecheck:scripts` is RED (pre-existing).** `scripts/verify-branch-pairs.mts` builds edge
  fixtures as `{ id }` while `FlowDesignerEdge` now requires `source`/`target`. From the
  randomized-test-lab consolidation, not the semantic work. It means `verify:all-typecheck` cannot be
  trusted as a gate, and it DOES catch real errors - fix it early.
- Three validation verifiers have no npm alias: `verify-validation.mts`,
  `verify-random-roundtrip.mts`, `verify-packaged-validation.mts`.
- CPU utilisation for the host is unmeasured (the Phase 0D sampler was invalid and withheld).
- Authenticode signing / SmartScreen reputation unaddressed; only unsigned local builds observed.
- `@zvec/zvec` must be installed (`npm install`) or `prepare:zvec-host` fails by design.

### Do Not Touch Without Confirmation
- `native-hosts/zvec/zvec-host.cjs` must stay raw CommonJS, unbundled, `utilityProcess`-only, and
  must never regain a crash-injection path. `verify:zvec-host-source-boundary` guards this.
- `electron-builder.json`: `!node_modules/@zvec/**` and the `extraResources` entry. Removing either
  re-creates the Phase 0B hard-crash path.
- The active-generation pointer is authoritative. Reconciliation must never derive active identity
  from `metadata.json`, and must never delete/rewrite the pointer.
- `window.playwrightFlowStudio` preload root name.
- `archive/*-20260725` tags - the only record of the eight deleted branch tips.

### Recommended Next Step
Start Phase 1B item 1 (`SemanticDocument` + typed query contracts), then the projection allowlist,
redactor and policy validator BEFORE any store or queue code. Brand `ValidatedSemanticDocument` so
only the policy pipeline can mint one - that makes "only redacted, validated documents reach the
store or queue" a compile-time guarantee.

### Required First Actions For Next Agent
1. Read `docs/ai/BRANCH_AND_COMMIT_POLICY.md` - one branch (`main`), continuous truthful commits, no
   new branches or worktrees, never freeze because a check fails.
2. `git status --short --branch`; confirm `main` is clean and in sync.
3. `npm install` (needed for `@zvec/zvec`), then `npm run build`.
4. Run the Zvec verifiers listed above to confirm a green baseline before changing anything.
5. Read `docs/AWKIT_ZVEC_TARGET_ARCHITECTURE_PLAN.md` sections 6-9 and 24 for the Phase 1B contracts.

### Explicitly Out Of Scope Until Later Phases
Renderer/preload semantic APIs, product semantic IPC, automatic workflow/flow indexing, global search
UI, failure memory, locator memory, embeddings, RAG/AI features.

---

Last updated: **2026-07-24 (latest — Backend SRS Tranche 2A: FR-C1 deterministic page identity, PR #36 review round 1 fixes applied. Draft PR, NOT merged. Prior: Tranche 1 FR-B2, since merged at `5dbe25f`.)**

## ACTIVE HANDOFF — Backend SRS Tranche 2A (FR-C1 popup/page identity)

> This is the authoritative handoff. The `## Current Handoff` block further down this file is a
> historical entry from an earlier task and is retained unchanged for reference only.

### From Agent / Tool

AI coding agent session implementing Backend SRS Tranche 2A, including PR #36 review round 1.

### To Agent / Tool

Next AI coding agent or human developer. No tool-specific setup is required beyond the repository's
standard workflow in `AGENTS.md`.

### Timestamp

2026-07-24.

### Branch / Commit

`feature/backend-srs-tranche-2a-popup-identity` @ `94eb9e0` (base `main` `5dbe25f`).

### Active Task

Implement **SRS-BAO-001 FR-C1 (Deterministic page identity)** — defect **`awkit-ebh`** — plus the
named prerequisite **`awkit-4t9`** (recorder popup metadata lost on designer re-save).
**FR-C2 frame identity is explicitly Tranche 2B and must not be started here.**

### Current State Summary

| | |
|---|---|
| Branch | `feature/backend-srs-tranche-2a-popup-identity` |
| Base | `main` = `5dbe25f` (unchanged; never modified directly) |
| Head | `94eb9e0` — remote and local identical |
| Working tree | clean (both the primary worktree on `main` and the feature worktree) |
| Worktree | `%LOCALAPPDATA%\Temp\awkit-worktrees\backend-srs-tranche-2a` (isolated, independent `npm ci`) |
| PR | **#36 — OPEN, DRAFT, NOT MERGED**, mergeable `CLEAN`, CI "Typecheck & Build" **pass** |
| Commits | 8 (4 original + 4 additive review fixes); no amend, rebase, squash, or force-push |
| `.beads` | untouched — 0 `.beads/*` paths in the branch diff |

Commits, oldest first: `4b7f414` fixtures → `a948cde` runner fix → `62ef5cd` designer fix →
`c28af52` docs → `56e3fb9` shared registry → `a9dedd8` lifecycle/ambiguity/masking →
`b6cd333` tests → `94eb9e0` docs.

### Completed Work

1. **Single identity owner.** `src/runner/runtime/PopupIdentityRegistry.ts` owns both
   `alias → Page` and `Page → alias`. The context-level `"page"` event is the only observation
   point; step paths **claim** the `Page` they awaited instead of performing a second registration.
2. **Ownership is browser-context-wide.** Exactly one registry and one `"page"` observer per
   BrowserContext / runtime generation, owned by the runner's `BrowserHolder` and injected into the
   parent flow, every nested child flow, and every parallel-branch executor. `runFlowWithChildren`
   is **recursive**, so a registry/observer per invocation gave one popup two identity owners.
3. **Deterministic synthetic identity:** `popup-<sha256(origin + normalized path) first 12 hex>` —
   a fixed neutral prefix plus a hash that **never echoes its inputs**. Query strings and fragments
   are never read. Active step id, `window.name`, and opener alias are excluded as timing-dependent.
4. **Ambiguity is reconciled, not latched.** Identity buckets grant a public alias only while
   exactly one *eligible* page occupies them, re-reconciled on every membership change.
5. **Runner-owned pages excluded.** Parallel-branch pages are marked internal; marking also cancels
   any identity finalization scheduled while the page was `about:blank`.
6. **Secret safety.** No caller-controlled text reaches an alias; all identity diagnostics are
   `SecretMasker`-masked (the missing-popup resolver message keeps its SRS-mandated stable shape).
7. **`awkit-4t9` prerequisite fixed.** `flowStepMapping.ts` now maps `pageAlias`, `opensPopup`, and
   `popupExpectation` in both directions (absent stays absent).
8. **Mock-site fixtures added before the runtime fix**, per SRS rule C-9.

### Files Changed (23 vs `origin/main`)

- **Runtime:** `src/runner/runtime/PopupIdentityRegistry.ts` (new), `src/runner/StepExecutor.ts`,
  `src/runner/PlaywrightRunner.ts`
- **Designer:** `app/renderer/components/workflow/flowStepMapping.ts`,
  `app/renderer/components/workflow/flowDesignerTypes.ts`
- **Tests:** `scripts/verify-popup-identity.mts` (new), `scripts/verify-popup.mts`,
  `scripts/verify-popup-mock-site.mts`, `scripts/verify-flow-step-mapping.mts`
- **Registration:** `package.json`, `scripts/lib/verifier-classification.ts`
- **Mock site:** 5 new pages under `mock-site/public/popup/`, plus `index.html` and
  `mock-site/README.md`
- **Docs:** `docs/ai/backend-srs-tranche-2a-scope.md` (new), `CURRENT_STATE.md`, `HANDOFF.md`,
  `TASK_LOG.md`, `TESTING.md`

### Commands / Tests Run (isolated worktree; Node 18.16.0 / npm 9.5.1)

| Command | Result |
|---|---|
| `npm run build` | pass |
| `npm run typecheck` | pass |
| `npm run verify:popup-identity` | **43/43** (new verifier; 25 → 43 after review fixes) |
| `npm run verify:popup` | 12/12 |
| `npm run verify:popup-mock-site` | 11/11 (was 8) |
| `npm run verify:flow-step-mapping` | 101/101 (was 94) |
| `npm run verify:runner` | 84/84 |
| `npm run verify:recorder` | 78/78 |
| `npm run verify:failure-evidence` | 34/34 |
| `npm run verify:failure-evidence-live` | 17/17 |
| `npm run verify:failure-screenshot-precedence` | 6/6 |
| `npm run verify:ipc-contract` | 4/4 |
| `npm run verify:security` | 39/39 |
| `npm run verify:auth` | 49/49 |
| `npm run verify:authz` | 40/40 |
| `npm run verify:clean-machine-policy` | 28/28 |
| `npm run verify:verifier-classification` | reconciled **111** (110 → 111; real-browser 37 → 38) |

**Not run, and why:** packaged-EXE, offline-bundle, and clean-machine gates — this tranche changes
no packaging or offline surface. Clean-machine validation remains owner-waived / non-blocking and
**NOT EXECUTED**; nothing here is recorded as passed that was not actually executed.

### Remaining Work

1. **Owner re-review of PR #36** (round 2). It must stay draft until that completes.
2. **Reconcile `awkit-4t9` in Beads** — it is marked `closed` citing `ab9f5f6`, which is **not an
   ancestor of `main`** (it exists only on the unmerged `feature/randomized-test-lab`). The code gap
   is fixed on this branch, but the tracker record is still wrong. Deliberately left alone here.
3. **Tranche 2B — FR-C2 frame identity.** Needs an optional identity schema plus a fallback resolver
   that genuinely survives a non-functional selector change. Not started, not authorized.
4. Later tranches: FR-C1.8 (needs FR-A2 / Tranche 5), FR-C3, cross-origin frame identity (needs CDP).

### Known Risks / Blockers

- **Multi-window flows are high regression risk** by the SRS's own assessment. The invariants are
  asserted mechanically in `verify:popup-identity`; run it after any change to popup routing.
- **A passing test here does not prove much on its own.** Two concrete traps were hit and are now
  guarded: (a) comparing only *sorted alias keys* across reversed popup order passes vacuously — the
  discriminating assertion is "each alias maps to the same page in both orders"; (b) an outcome-only
  check for the internal-page race passes even with both defenses disabled, because `reconcile`'s
  eligibility filter independently blocks the alias — assert the mechanism via
  `pendingIdentityCount()`. Use a negative control before trusting a new assertion here.
- **FR-B2 evidence masking depends on registry shape.** `resolveStepPage`'s throw and
  `captureFailureEvidence`'s resolver diagnostic must stay masked; `verify:failure-evidence` and
  `verify:failure-evidence-live` are the guards.
- **`SecretMasker.maskText` is not a general sanitizer.** It normalizes `token`/`password` query-style
  assignments, `Bearer …` headers, and registered literal values only — `token-SECRET` (hyphen) passes straight through.
  Never rely on it alone to make caller-controlled text safe; prefer structural exclusion.

### Do Not Touch Without Confirmation

- `.beads/*` — no edits, and do not run `bd` or `bd dolt push` in this track.
- The 8 existing commits — no amend, rebase, squash, reset, or force-push.
- Preserved references: `backup/pr24-pre-reconstruction` (`ec19bda`), `backup/chore-brand-logo-5b`,
  `chore/brand-logo-5b`, `archive/chore-brand-logo-5b-pre-recovery`, and the planning branch
  `docs/browser-automation-srs` (authoritative SRS-BAO-001; **not** on `main`).
- PR #35 safety-net files under `%LOCALAPPDATA%\Temp\awkit-scratch\pr35-review-fixes\`.
- `main` — never commit to it directly; it is PR-only.
- Release promotion, packaging, and artifact work are out of scope for this track.

### Recommended Next Step

Wait for the PR #36 round-2 review. If changes are requested, continue in the existing worktree with
**additive** commits and a normal (non-force) push, keeping the PR draft. Do not merge, and do not
begin FR-C2 until it is explicitly authorized.

### Required First Actions For Next Agent

1. Read `AGENTS.md` and the required-reading order it lists (at minimum `docs/ai/CURRENT_STATE.md`,
   `RULES.md`, `ARCHITECTURE.md`, `COMMANDS.md`), then `docs/ai/backend-srs-tranche-2a-scope.md`.
2. Confirm the state above before changing anything:
   ```bash
   git fetch origin --prune && git status --short --branch && git rev-parse HEAD && git rev-parse origin/main
   ```
   Stop and report if `origin/main` has moved off `5dbe25f`, if the branch head is not `94eb9e0`, or
   if either worktree is dirty.
3. Re-establish the isolated worktree if it is gone (`%LOCALAPPDATA%\Temp\awkit-worktrees\backend-srs-tranche-2a`),
   with its own `npm ci` — do not share `node_modules` through a junction.
4. Before trusting any change to popup routing, run `npm run build`, `npm run verify:popup-identity`,
   `npm run verify:popup`, and `npm run verify:runner`.
5. **Known pre-existing gate failure, not caused by this branch:**
   `node scripts/ai-memory/check-memory.mjs` exits 1 with
   *"Possible Password assignment detected in memory file: docs/ai/TASK_LOG.md"*. It fails identically
   on clean `main`. The trigger is a **false positive** — a historical Tranche 1 log entry that
   documents masking behavior with a literal password-assignment example, matching the scanner's
   `/password\s*[:=]\s*.{6,}/i` rule. No credential is present. It was left in place because rewriting
   a merged historical log entry needs owner confirmation; the fix is either a one-word cosmetic edit
   to that line or a scanner refinement that ignores fenced/inline code spans. Owner decision.

Last updated: **2026-07-24 (Backend SRS Tranche 1: FR-B2 immediate failure evidence — since MERGED via PR #35 at `5dbe25f`. Prior: Track 4 clean-machine policy.)**

> **Backend SRS Tranche 1 (2026-07-24) — FR-B2 immediate failure evidence. PR OPEN as draft, NOT
> merged.** Branch `feature/backend-srs-tranche-1` off `main` `88c76ed`. Implements SRS-BAO-001 FR-B2
> (the WS-B ordering defect): failure evidence now captured **per failing attempt inside the retry
> loop, before any retry/navigation** (was: once, after the loop) — screenshot + DOM + a11y + meta,
> secret-masked, bounded, accumulated per attempt; original error stays primary; capture failure is a
> secondary diagnostic. New `StepExecutor.captureFailureEvidence` + `StepEvidenceRef`/`evidence[]` on
> `StepExecutionResult`. **No schema migration.** **PR #35 review fixes (round 2):** evidence now
> preserved onto a passing retry; all path components sanitized via new `safePathComponent`
> (`pathSafety.ts`) + `isPathInside` confinement; truthful requested-vs-captured page identity
> (`StepEvidenceRef.requestedPageId`); new real file-output verifier. **Round 3 (final correction
> pass):** every `StepEvidenceRef.note` is now masked (the resolver-failure diagnostic and each
> per-artifact capture-failure note could echo a hostile `pageAlias` or an error message carrying a URL
> token); `FlowExecutor`'s belt-and-suspenders fallback note is masked too (new `FlowExecutor.evidenceMasker`);
> `safePathComponent`'s `fallback` argument is now sanitized through the same pipeline as `raw` instead
> of being trusted verbatim. Verifiers `verify:failure-evidence` (unit, 29 → **34/34**) +
> `verify:failure-evidence-live` (real-browser, 14 → **17/17**); verifier taxonomy total unchanged at
> **110** (checks added to existing scripts, no new script). **Deferred (documented):** console-tail +
> in-flight network state → FR-A2 (Tranche 5); FR-B1 run-root + `manifest.json` + durable `evidence[]`
> surfacing → own tranche. **No `.beads` change; no `bd` run; no release promotion.** Full authoritative
> SRS lives on the planning branch `docs/browser-automation-srs` (`37dc67c`) — unchanged. Scope + matrix:
> `docs/ai/backend-srs-tranche-1-scope.md`. **PR #35 remains draft — do not merge without owner
> re-review.**

Last updated: **2026-07-24 (Track 4: clean-machine validation policy is now optional and non-blocking. Prior top block: PR #24 reconstruction.)**

> **Track 4 (2026-07-24) — clean-machine validation is optional and non-blocking by owner policy.**
> Owner decision: clean-machine validation **execution is waived as a mandatory release-promotion
> prerequisite** — it is **optional and non-blocking**. Execution status stays truthful (still **NOT
> EXECUTED**; nothing recorded as passed); a **failed** run, if ever executed, **remains blocking**.
> The gate was documentation-enforced (no code/CI resolver). Canonical source:
> `scripts/lib/clean-machine-validation-policy.ts`, enforced by `npm run verify:clean-machine-policy`
> (class documentation-consistency; verifier total 107 → 108). **Protected gates unchanged and still
> mandatory:** checksum, offline-bundle, packaged-startup, artifact-integrity, dependency-manifest,
> security. **No `.beads` change; no `bd` run.** Historical NOT EXECUTED evidence left intact. See the
> authoritative banner atop `CLEAN_MACHINE_VALIDATION_RUNBOOK.md` and the top of `CURRENT_STATE.md`.

Last updated: **2026-07-24 (PR #24 reconstructed off current `main` @ `b416f8c`: Oracle data-source RBAC + hardened live-reauth verifier. PR #27 backend Tranche 0 and PR #33 beads reconciliation are now MERGED.)**

> **Read this block first — canonical current state (2026-07-24, PR #24 reconstruction).** Authoritative
> repo/PR state; supersedes the dated blocks below. Since the prior block was written, **PR #27** (backend
> Tranche 0) and **PR #33** (beads reconciliation) have **merged** — `main` is at **`b416f8c`**, and its
> tracked `.beads/issues.jsonl` holds **93 records** with `awkit-5yx`/`awkit-oei` closed.

### PR #24 — Oracle IPC authorization + live reauth verification (reconstructed)

- **Reconstructed off current `main` (`b416f8c`)** on `reconstruct/pr24-oracle-authz-reauth`. The stale old
  branch tip `ec19bda` is preserved as **`backup/pr24-pre-reconstruction`** (local + remote). The old branch is
  **not** conventionally rebased — it carried stale `.beads`/docs churn and predated the verifier taxonomy.
- **Oracle data-source mutators require `DATASOURCE_MANAGE`.** `oracle:dataSources:save`/`delete`/
  `refreshSnapshot` call `assertSenderPermission(event, Permission.DATASOURCE_MANAGE)` **before** any service
  lookup, existence check, secret access, or Oracle work (the trusted-sender guarantee is preserved *inside*
  `assertSenderPermission`). Oracle driver / Java-runtime / bridge / packaged-mode / Settings channels are
  **unchanged**. A Viewer's direct preload call is `NOT_AUTHORIZED` (`verify:e2e-rbac` 49 → 51).
- **`verify:e2e-reauth` is a real-Electron verifier** (taxonomy class `real-browser`; registry now **107**
  total / **36** real-browser). It drives the live ReauthDialog: **cancel** drops the held create; a **wrong**
  password applies nothing and writes **no** `USER_CREATE` success audit; the **correct** password applies it
  **exactly once** (no replay); no credential reaches console/audit. **19/19**.
- **Beads:** `awkit-b3w` and `awkit-2d8` were **closed in the tracked export before their code reached `main`**;
  this PR brings `main` into alignment with those already-closed records. **No `.beads` change is part of this
  PR**, and no `bd` command / `bd dolt push` was run.
- **Verification (isolated `npm ci` off `b416f8c`):** build ✓ · `e2e-rbac` **51/51** · `e2e-reauth` **19/19** ·
  `ipc-contract` **4/4** · `security` **39/39** · `auth` **49/49** · `auth-gui` **18/18** · `authz` **40/40** ·
  `verifier-classification` **107** (real-browser 36). `verify:oracle-drivers-gui` **25/30** — the five Oracle
  **bridge/Java/ojdbc** checks remain **environmental/inconclusive** (the Oracle bridge runtime is not built in
  this worktree; `build:oracle-bridge` + a configured Java runtime + ojdbc bundle are required) and do **not**
  gate this PR; **no global waiver** was created.

---

> **Read this block first — canonical current state (2026-07-24).** This is the authoritative
> repository / PR / branch state and supersedes every dated block below for that purpose. It records the
> **PR #27 rebase only** — no code, feature, or release state changed. The three-branch recovery block that
> follows is retained as prior context.

### Canonical repository state

- **`main` is at `9960633`.**
- The recovered **accent**, **HTTPS certificate-trust**, **custom-logo**, and **recovery-documentation**
  work is all **merged**.
- The three-feature recovery is **complete**.

### PR #27 — `fix/backend-observability-tranche-0` (backend Tranche 0)

- PR #27 is **still OPEN and DRAFT**.
- Its remote branch was **rebased from `85df851` onto `main` `9960633`**; new remote tip **`455dc04`**.
- It contains **exactly four rebased commits**.
- It is **MERGEABLE — no remaining conflicts**.
- **Implementation review passed:**
  - `screenshotOnFailure` precedence is correct,
  - execution-completed-cleanup is correct,
  - the verifier taxonomy is functioning as intended.
- **The classification registry now classifies 106 verifiers:**
  - 43 unit
  - 35 real-browser
  - 21 integration
  - 4 static-source-validation
  - 3 packaged-application
  - 0 documentation-consistency
  - 0 clean-machine-acceptance
- **Required verification passed:** build · failure-screenshot-precedence 6/6 · runner 84/84 ·
  verifier-classification reconciled 106 · branch-pairs 31/31 · accent-theme 71/71 · accent-gui 33/33 ·
  https-certificates 49/49 · https-certificates-gui 31/31 · custom-brand-logo 31/31 · branding 47/47 ·
  branding-gui 30/30 · settings-persistence 3/3 · ipc-contract 4/4.
- PR #27 **has NOT been merged** and **must remain DRAFT until separately authorized.**
- **Tranche 1 has NOT started.**
- The production **screenshot-profile value remains unchanged.**

### ⚠️ Frozen backend worktree warning

- The existing backend worktree remains **locally at `85df851`**.
- Its branch was **force-updated remotely to `455dc04`** — the local worktree is intentionally **behind** the
  remote branch.
- It carries the **frozen `.beads/issues.jsonl` modification**.
- **Do NOT run `git pull`, `git reset`, rebase, checkout, restore, stash, or branch reconciliation there.**
- **Do NOT attempt to align that worktree with the remote branch** until Beads reconciliation is separately
  authorized.
- Any future PR #27 review or modification **must use a new isolated worktree from
  `origin/fix/backend-observability-tranche-0`** — never the frozen local worktree.

### Beads

- `.beads/issues.jsonl` remains **frozen**.
- **Do NOT commit, restore, splice, export, or synchronize it.**
- **Do NOT run any `bd` command.** **Do NOT run `bd dolt push`.**
- `awkit-5yx` and `awkit-oei` remain **open by design**.

### Other tracks

- **PR #24 remains separate and untouched.**
- **No Tranche 1 work is authorized.**
- Archived recovery references remain **retained at `a1adcc2`**:
  - `chore/brand-logo-5b`
  - `backup/chore-brand-logo-5b`
  - `archive/chore-brand-logo-5b-pre-recovery`
- **Do NOT delete those references before a validated packaged release.**

### Release status

**Development integration does NOT equal product promotion.** Still **NOT EXECUTED / NOT PASSED:**

- portable rebuild,
- portable / NSIS artifact verification,
- clean-machine offline validation,
- release promotion.

### Worktree safety note (Windows junction hazard)

- **Never** remove a worktree containing a `node_modules` junction using `git worktree remove --force`.
- Unlink shared junctions first, or use an independent `npm ci`.
- A prior forced removal **deleted the shared `node_modules` target**; it was **restored**.
- The current `main` `node_modules` is **intact**.

---

> **Prior context — three-branch feature recovery (still accurate as history).** The previous agent
> decomposed the mixed commit `a1adcc2` ("branding, accent
> theme, and HTTPS certificate trust", on `chore/brand-logo-5b`) into **three independent feature
> branches off `main` @ `32e378e`**, each verified and opened as its own PR — then, after a full pre-merge
> review + combined integration validation, **merged all three to `main`** (order #28 → #30 → #29).
> Nothing is paused mid-edit. The original mixed branch is untouched.

## Current PR landscape (post-recovery-merge)

**`main` is now `0777682`** and carries all three recovered features. PR #27 remains frozen; the
clean-machine gate still blocks backend *promotion* (the recovery merges are development integration only).

- **PR #27** (`fix/backend-observability-tranche-0`) — **frozen at `85df851`**. Untouched by the recovery.
  Do not amend, add commits, or push to it.
- **PR #28** (`feature/custom-accent-gradient`) — **MERGED** (merge commit `3e79b70`): custom accent gradient.
- **PR #30** (`feature/custom-brand-logo`) — **MERGED** (merge commit `2033424`): custom brand logo (+ a
  test-only verifier fix `f01e4ec`).
- **PR #29** (`feature/https-certificate-trust`) — **MERGED** (merge commit `0777682`): scoped HTTPS
  certificate exceptions. Its **mandatory security review passed 11/11**.
- **PR #31** (`docs/feature-recovery-state-sync`) — this recovery-state documentation (merges last).
- **Release gates NOT EXECUTED / NOT PASSED:** `validate:offline` (browser payload absent in worktrees),
  portable rebuild, artifact verification, clean-machine validation, and release promotion all remain
  outstanding. Merging the features was **development integration, not product promotion.**
- **`.beads/issues.jsonl` is frozen** — must not be committed or synchronized. **Do not run
  `bd dolt push`.**

**After PR #31 merges:** verify its content is present on `main`, then remove the temporary recovery/
integration worktrees and delete the merged feature + docs-sync branches.

---

## Three-branch recovery — branch / PR map (all merged to `main`, final `main` @ `0777682`)

| Branch | Merge commit | PR | State | Verification (re-run after updating onto `main`) |
|---|---|---|---|---|
| `feature/custom-accent-gradient` | `3e79b70` | #28 | **MERGED** | build ✓ · `verify:accent-theme` 71/71 · `verify:accent-gui` 33/33 |
| `feature/custom-brand-logo` | `2033424` | #30 | **MERGED** | build ✓ · `verify:custom-brand-logo` 31/31 · `verify:branding` 47/47 · `verify:branding-gui` 30/30 |
| `feature/https-certificate-trust` | `0777682` | #29 | **MERGED** (security review 11/11) | build ✓ · `verify:https-certificates` 49/49 · `verify:https-certificates-gui` 31/31 · `verify:runner` 82 · `verify:recorder` 78 · `verify:settings-persistence` 3/3 · `verify:ipc-contract` 4/4 |

Merge order was **#28 → #30 → #29**. After each merge the next branch was updated onto the advancing
`main` and its **additive** conflicts (`Settings.tsx` / `package.json` / `uiSettings.ts` / `global.css` /
`App.tsx` / `preload.ts`) resolved by preserving **all** feature additions (no broad `--ours`/`--theirs`);
each branch's focused verifiers were re-run green before its merge.

### Key recovery decisions
- **HTTPS: the browser-wide bypass was removed.** The blanket `--ignore-certificate-errors` launch arg
  and its `AWKIT_CERT_FALLBACK_LAUNCH_ARG` env hatch from the original draft are **dropped**. Trust is
  now **context-level only** (`ignoreHTTPSErrors` on both context factories). `sharedCompatibilityKey`
  no longer carries a cert dimension. A regression guard in `verify:https-certificates` fails if a quoted
  `"--ignore-certificate-errors"` is reintroduced anywhere under `src/`/`app/`.
- **Branding: shipped assets preserved.** The source branch's `specter-logo.svg` replacement and its
  `package-portable.ps1` compression change were **excluded** (shipped logo, icons, splash, packaged
  resources untouched). The login-screen display was **added** during recovery (the original draft wired
  only the sidebar); login + sidebar now resolve the same logo via one `branding.getState()` read.
- **Accent: one intentional omission** — the `SecurityGate.tsx` live-OS-theme-switch refinement is
  deferred as optional polish (the `index.html` pre-mount bootstrap already applies the accent on login;
  GUI verifier passes without it). Recorded in PR #28 and `docs/ACCENT_COLOR.md`.

### Remaining work
- **PR #29 (HTTPS) security review is complete — passed 11/11** (context-scoped only · default `false` /
  import can't enable · permission-gated mutation · recorder initial + persistent-context resume use the
  resolved setting · retries/branches/replacement/shared contexts per-context · no `--ignore-certificate-errors`
  launch arg / Electron override · not in the shared-browser pool key · validating + bypassing coexist ·
  logs expose no URL/cookie/cert/session data · CAPTCHA/MFA/protected-login/handoff unchanged). Merged.
- **`docs/ai/` reconciliation** (FEATURES / DECISIONS / COMMANDS entries for the three features) remains a
  follow-up now that all three are on `main`; each feature ships its own self-contained doc
  (`docs/ACCENT_COLOR.md`, `docs/HTTPS_CERTIFICATE_TRUST.md`, `docs/BRANDING_CUSTOM_LOGO.md`).
- **Release promotion still owed** (unchanged): portable rebuild, artifact verification, and clean-machine
  offline validation are NOT executed. The feature merges do not clear the standing clean-machine gate.

### Do-not-touch (recovery)
- The archived source branches `chore/brand-logo-5b` + `backup/chore-brand-logo-5b` (both at `a1adcc2`) —
  leave intact; do not delete.
- `.beads` / `bd dolt push` / release promotion — untouched by all three branches; the only working-tree
  `.beads/issues.jsonl` change is the **pre-existing** backend-tranche export (see below), not from this work.

---

> ⚠️ **Below is PRIOR CONTEXT (history), unchanged by the recovery above.** The current checkout of this
> repo is `fix/backend-observability-tranche-0` (backend Tranche 0). The blocks below cover the FR-2.6
> branch-pair fix and the backend Tranche 0 / clean-machine acceptance gate — those threads are still
> open and still gated. `.beads/issues.jsonl` remains uncommitted here (the frozen cross-branch export).

> **Four local branches exist, none pushed. One acceptance gate blocks all
> backend implementation. Nothing is paused mid-edit.**
>
> **Update (2026-07-23, later session):** the confirmed FR-2.6 defect below (both editors' branch
> reconcilers were no-op pass-throughs) is now **FIXED and VERIFIED** on `feature/canvas-ux-foundation`
> — new shared `app/renderer/components/shared/branchPairs.ts` + `verify:branch-pairs` (31/31), and
> `docs/SRS_CANVAS_UX.md` has been **reconciled** against the in-house engine. Commits `62aca6d`
> (fix), `92b40b5` (test), `209de4a` (SRS), `25b2334` (state/log) — none pushed. The owner decision
> the "Open decision" note below asked for was taken (hybrid rule; see FR-2.6 in the SRS and the
> top TASK_LOG entry). **`.beads/issues.jsonl` remains uncommitted** (prior session's cross-branch
> beads — the splice hazard). The frontend "Recommended next step" below is therefore **done**;
> what remains is the backend/clean-machine track.

## Branch map (all local, nothing pushed, no PRs)

| Branch | Tip | Contents |
|---|---|---|
| `feature/recorder-protected-login-and-async-awareness` | `61f6099` | **FROZEN** — merged to `main` via PR #25 (`5cef580`). Do not modify until the clean-machine gate clears. |
| `docs/browser-automation-srs` | `32ed8c4` | `docs/SRS_BROWSER_AUTOMATION_OBSERVABILITY.md` + 4 defect beads + a bead cross-ref fix |
| `docs/offline-packaging-beads` | `3fa2876` | 2 packaging-provenance beads |
| `feature/canvas-ux-foundation` | `25b2334` | `verify:canvas-layout` **+ FR-2.6 branch-pair fix** (`branchPairs.ts`, `verify:branch-pairs` 31/31) + reconciled `docs/SRS_CANVAS_UX.md`. Tip was `63eef5c`. |

**Local `main` is stale at `382847c`.** `origin/main` is `5cef580`. Always compare scope against
`origin/main`, never local `main`, or diffs falsely show ~17 extra commits.

## THE BLOCKING GATE — clean-machine acceptance

`CLEAN_MACHINE_VALIDATION_RUNBOOK.md` is **Not Executed**. Until it passes: no backend SRS
implementation, no changes to the frozen branch. Required sequence:

1. Rebuild **both** portable + NSIS artifacts from `61f6099` on a **higher-memory host**.
2. Transfer + verify the preserved offline payload (below).
3. Re-pin runbook §2 with new hashes **and** provenance fields.
4. Execute the clean offline Windows validation.
5. Promote or reject `61f6099`.
6. Reconcile `CURRENT_STATE.md` / `TASK_LOG.md` for `f600959` / `61f6099` / PR #25 (still owed).
7. Only then start backend Tranche 0.

### Artifact regeneration result (2026-07-22)

Rebuilt from a detached worktree at `61f6099` + the preserved payload:

- **NSIS: SUCCEEDED.** `SpecterStudio Setup 0.1.0.exe`, 373,894,726 bytes, SHA-256
  `4df7fa6402c9c551ca1c6e6310a8e21c8c61a0097884b316eeca1ba41f1ec333`, NotSigned. Chromium
  **149.0.7827.55** verified *inside* the installer via `7za l`.
- **Portable: FAILED.** 7-Zip `-mx=9` OOM ("Can't allocate required memory!") compressing 1,177 MiB;
  host commit charge was saturated at 31.1/31.8 GB. `dist/win-unpacked` (1.2 GB) completed but is
  **not** a substitute. **Do not retry on the 15.9 GB dev host.**
- Evidence archived at `C:\Users\moham\awkit-build-evidence\61f6099\` (357 MB): installer (hash
  re-verified after copy), `provenance.md`, `payload-verification.txt`, `SHA256SUMS.txt`, all build
  logs. The disposable worktree was removed.

**⚠ The build is NOT hermetic from Git.** `vendor/` is fully gitignored (0 files tracked);
`resources/browsers/` and `resources/oracle-jdbc/` too. `electron-builder.json` copies both trees
wholesale as `extraResources`, so a clean checkout builds a **hollow artifact with no bundled
Chromium** that still installs and launches. The ~832 MB payload must be transferred out-of-band.
Do **not** run `scripts/prepare-offline-deps.ps1` — it issues an unpinned `npx playwright install
chromium` and would swap an uncontrolled input. Tracked as **`awkit-epz` (P1)**.

**Reproducibility expectation:** `package-per-user-installer.ps1` regenerates
`resources/dependency-manifest.json` (fresh `builtAt`) on every run and packages it, so **installer
SHA-256 equality is not achievable** even from identical inputs. Compare **decompressed payload**
paths/sizes/per-entry CRCs instead, excluding that manifest and its `vendor/` copy. Final hashes are
still recorded for pinning — they identify the accepted build, not reproducible compilation.

## Beads filed this session (6)

| Bead | P | Summary |
|---|---|---|
| `awkit-ebh` | P1 | Popup registered under two aliases; counter key is positional |
| `awkit-oyc` | P1 | Failure evidence captured after the retry loop, not at the failing attempt |
| `awkit-5yx` | P1 | `resolveArtifactSettings().screenshotOnFailure` computed but never read |
| `awkit-oei` | P2 | Success path logs cleanup as `execution-failed-cleanup` (**log text only** — verified NOT to reach pool analytics) |
| `awkit-epz` | P1 | Offline packaging inputs untracked/unverified; clean checkout → hollow artifact |
| `awkit-c0c` | P2 | `dependency-manifest` `builtAt` conflates manifest generation with payload provenance |

## Frontend (independent of the gate)

`feature/canvas-ux-foundation` @ `63eef5c` adds `scripts/verify-canvas-layout.mts`
(`npm run verify:canvas-layout`, **35/35**). **No production code changed** — the auto-layout defect it
was scoped to fix was already fixed on `main`; the gap was that no verifier referenced
`app/renderer/components/shared/graphLayout.ts`.

**`docs/SRS_CANVAS_UX.md` (2026-07-10) is materially STALE — do not implement from it directly.** A
read-only sweep found:

- **Already implemented:** Workflow Builder edge "+" (`ScenarioBuilder.tsx:576-586`); FR-1.4 button
  semantics (`SmoothEdge.tsx:54-65`); load-time auto-layout + manual Auto-arrange; dotted background
  consistency (all three canvases pass `gap={22} size={2}`).
- **Renamed/moved:** `TemplateSmoothEdge` → `components/canvas/edges/SmoothEdge.tsx`; branch helpers →
  `components/shared/connectorStyle.ts`.
- **Every cited `global.css` line number is wrong** (764 / 2886 / 7678); the file is now 10,162 lines.
  FR-4.2's token values are stale (light is `#c4c9d2`, dark `#2c3140`).
- **Confirmed defect — FR-2.6 fails in BOTH editors.** `reconcileBranchConnectors`
  (`connectorStyle.ts:198`) is **dead code** (zero call sites). `reconcileFlowBranches`
  (`FlowChartDesigner.tsx:114`) and `reconcileScenarioBranches` (`ScenarioBuilder.tsx:1660`) are
  identical no-op pass-throughs that ignore `_revertSources`. The editors are at *parity*, both having
  lost the lone-branch revert. `ScenarioBuilder.tsx:1658`'s comment still claims the revert happens.
  Neither `connectorStructureIssues` nor its scenario twin flags a lone branch member, so it **saves
  silently**; at run time `FlowExecutor.ts:528-544` falls through to a "stop safely" default, i.e. the
  flow **silently truncates**. A lone *parallel* instead fans out one branch through join/fail
  machinery (`FlowExecutor.ts:157-161`). **No verifier covers branch reconciliation.**
- **Consolidation hazard:** four `prefers-reduced-motion` blocks (`:7438`, `:7791`, `:8984`, `:9676`).
  The global one uses `!important` on `transition-property`; two others use the non-important
  `transition: none` shorthand, which still suppresses via `transition-duration: 0s`. Merging them
  naively **would change behavior** — analyze, do not merge blindly.
- **Not verified:** focus states, keyboard navigation, icon labels across the canvases.

**Open decision — RESOLVED (2026-07-23, later).** The owner chose a **hybrid**: interactive
deletion auto-reverts the lone survivor to a normal connector (editor never leaves a graph it can
deterministically repair), while **existing/imported** lone branches are **Save-blocking** rather
than silently rewritten on load, and a lone branch **with a standard fallback** (valid if/else) is
exempt. Implemented in `components/shared/branchPairs.ts`; both editors' `reconcile*Branches` and
`connectorStructureIssues` now use it; dead `reconcileBranchConnectors` removed. Also corrected: a
lone branch does **not** truncate at run time — a lone conditional routes with its condition
ignored, a lone parallel runs its target twice. Verified `verify:branch-pairs` 31/31 + both GUI
verifiers green.

## Verification run this session

`npm run build` clean (tsc + all bundles). `npx tsx scripts/verify-canvas-layout.mts` **35/35**.
`npm ci` on the rebuild worktree exit 0. Packaging: NSIS exit 0, portable exit 1 (OOM, above).
**Not run:** `verify:runner`, `verify:recorder`, GUI/mock-site/packaging verifiers — no runner,
recorder, renderer, or packaging *source* was modified. `npm test` / `npm run lint` still do not exist.

## Do not touch without confirmation

- The frozen branch `feature/recorder-protected-login-and-async-awareness` @ `61f6099`.
- `CLEAN_MACHINE_VALIDATION_RUNBOOK.md` §2 hashes — re-pinning is its own authorized docs-only change.
- `docs/SRS_BROWSER_AUTOMATION_OBSERVABILITY.md` FR-H4: the protected-login profile stays **opaque**.
  Cookie extraction / entropy scanning was investigated and **rejected** — adding extraction would
  create the exposure a scanner then manages.
- `bd dolt push` — deliberately unsynced; `.beads/issues.jsonl` is the repo state.

**Beads gotcha:** `bd create` / `bd update` **auto-write a full export over `.beads/issues.jsonl`**.
On a branch carrying a curated subset this silently drags in unrelated beads. Procedure: run the `bd`
writes → `git restore .beads/issues.jsonl` → `bd export -o <TEMP>` → diff **by id** → splice only the
intended ids (preserving CRLF) → verify N replacements / 0 additions before staging.

## Recommended next step

**Backend (the remaining track):** rebuild both artifacts on the higher-memory host (§ above), then
work the gate sequence. **Frontend:** the SRS reconcile and the FR-2.6 fix (both were the recommended
next steps) are **done** on `feature/canvas-ux-foundation` — see the update note at the top of this
file. Remaining frontend follow-ups are optional: the node-attached "+" (FR-1.3, unbuilt), loop
routing-priority authoring surfacing (FR-2.9), and pruning the vestigial port helpers in
`connectorStyle.ts` (`portHandlesForKind`/`computePortFlags`/`portFlags`).
Last updated: **2026-07-21 (Randomized Automation Test Lab)** — work is on **two local branches, neither
pushed and neither has a PR**. `main` is unchanged at `382847c`. Read this block first; everything below it
is history and describes a state that no longer holds.

## From / To

- **From:** the agent that built the Randomized Automation Test Lab (epic `awkit-wza`) and fixed its first
  two discovered defects.
- **To:** any next agent or human developer.

## Branch state — READ BEFORE ANY GIT OPERATION

| Branch | Head | Contents |
|---|---|---|
| `main` | `382847c` | unchanged; level with `origin/main` |
| `chore/brand-logo-5b` | `a1adcc2` | **owner's pre-existing checkpoint**, committed this session at their request: branding, accent theme, HTTPS certificate trust (64 files) |
| `feature/randomized-test-lab` | `562c29b` | the lab, branched from `main` (6 commits) |

Working tree is **clean**. Nothing is pushed; no PRs exist. Branch only from `main`, and push/PR only when
the user asks.

`chore/brand-logo-5b` was uncommitted for several sessions. It is now preserved as one commit. Its content
was **not** authored or reviewed in this session — it was staged deliberately (`git add -u` plus the 19
branding/accent/HTTPS files by name) and verified not to contain any lab file. Treat it as owner work
awaiting their review.

## Active task — Randomized Automation Test Lab (epic `awkit-wza`)

A deterministic **generation + oracle + coverage** layer over the existing engine. It does not re-test what
the ~130 existing verifiers already cover; it generates definitions from a seed, drives them through the
**real** validators and persistence boundaries, and reports reproducible defects.

Design docs: `docs/testing/RANDOMIZED_TESTING_ARCHITECTURE.md` (findings, incl. §6 "blocked or vacuous" —
capabilities the original brief assumed that do not exist) and `RANDOMIZED_TESTING_IMPLEMENTATION_PLAN.md`
(phase order + status table).

### Completed

- **Phase 0 — prerequisites** (`awkit-wza.1`, closed). `flowProfileMapping.ts` is now the single source of
  the designer persistence mapping; `FlowChartDesigner.tsx` imports it (behavior-preserving). Two stale
  `verify-durable-store.mts` assertions pinned at 2 migrations against an actual 4 now derive from
  `RUNTIME_STORE_MIGRATIONS` — that verifier was **silently red** and is now 11/11. Mock site gained
  `/runner-lab` and `/iframe-lab` + `/iframe-child` (see `mock-site/README.md`).
- **Phase 1 — generation core** (closed). Seeded PRNG with position-stable `derive()`, exhaustive
  `Record<Literal, …>` catalogs, and a valid-by-construction 9-pattern library.
- **Phase 2 — validation oracle** (closed). 13 controlled mutations, exactly one defect per scenario.
- **Phase 3 — persistence round-trip** (closed as a baseline discovery run). Field-level semantic diff plus
  a defect catalog that separates known baseline failures from unexpected new ones.
- **First two defects fixed** — `awkit-1w5` (RT-14) and `awkit-ihx` (RT-02), both closed.

### ⚠️ Two verifiers are RED ON PURPOSE — do not "fix" them

- `npx tsx scripts/verify-random-roundtrip.mts` — **17 passed / 12 failed**. The failures are 11 catalogued
  **product** defects, one per filed bead. The assertions are deliberately untuned and no lost field is
  excluded from the equality check.
- `npx tsx scripts/verify-random-oracle.mts` — **19 passed / 1 failed**. The failure is a real product
  defect (`awkit-acw`).

To resolve one, **fix the product defect and delete its entry from
`src/testing/roundtrip/RoundTripDefectCatalog.ts`**. The verifier then reports any recurrence as a
regression. Never weaken an assertion to make these green — that is the one thing this subsystem exists to
prevent.

### Verification run this session (all as stated)

`npm run build` clean · `verify:flow-designer` **24/24** (real Electron) · `verify:mock-site` **65/65**
(was 39) · `verify-durable-store` **11/11** (was 10/1) · `verify-random-generator` **49/49** ·
`verify-random-oracle` 19+1 · `verify-random-roundtrip` 17+12 · `check-memory.mjs` pass.

**Not run:** `verify:runner` and `validate:offline` (no runner or packaging behavior changed); the packaged
EXE / clean-machine / soak gates (unchanged, still external — `awkit-cm8`). **Phase 5 is not built, so no
generated flow has ever been executed against a real browser.**

### Remaining work

Ready now (`bd ready`): **11 round-trip defect beads** (6 × P1, 4 × P2, 3 × P3), the two Phase 2 findings
(`awkit-acw`, `awkit-7fm`), and **Phase 4** (`awkit-wza.5` — failure artifacts, shrinking, and the
`test:random:*` npm aliases, which were deferred while `package.json` was dirty).

Blocked behind their prerequisites: Phases 5–8 (`awkit-wza.6`–`.9`). Phase 7 (a Super-User Test Lab page)
carries an **open product decision** — shipping a test-generation harness inside the production app is a
real surface-area and packaging choice, and a CLI-only lab avoids it. Decide before building.

Recommended next: `awkit-4t9` (RT-03, recorder popup metadata) — it breaks recorded multi-window flows
outright, and `awkit-3lq` (RT-04, safety policy) is a small pass-through fix with security impact.

### Known risks / load-bearing facts

- **`flowProfileMapping.ts` is now the single source of the designer persistence mapping.** Changing it
  changes what gets persisted. Read `RoundTripDefectCatalog.ts` before editing it.
- The round-trip verifier's source-parity guard **retired itself** when task 0.1 landed; it now asserts the
  designer imports the module. If someone re-inlines the mapping, that check flips back automatically.
- **`tsx` can import renderer modules directly** (including `lucide-react`). That is what lets a headless
  verifier drive the real `flowNodeCatalog` and designer mapping rather than a copy — do not replace those
  imports with local duplicates.
- A legacy `loopBack` edge must **not** set `kind: "loop"` — `validateConnectorStructure` treats an explicit
  `kind` as a structured self-only loop and rejects it across nodes. The exemption relies on the kind being
  *derived* from `type`.
- `MAX_BRANCH_CONNECTORS = 2` is a hard port cap, so 3-way branching must chain two condition nodes.
- Generated secrets are **opaque references only** and are never resolved, so no plaintext can reach a
  fixture, diff, log or artifact. Keep it that way when extending the lab.
- Campaign artifacts land in `reports/random-tests/` (already gitignored) and are byte-deterministic for a
  fixed seed — a non-deterministic report means a generator bug.

### Do not touch without confirmation

- Do not weaken, skip or delete assertions in the two intentionally-red verifiers.
- Do not commit, rebase, or amend `chore/brand-logo-5b` — it is the owner's checkpoint, unreviewed here.
- Everything in the standing list still applies: do not rename `window.playwrightFlowStudio`; keep
  offline-first (no runtime internet, no global Node/Playwright/Chromium, no writes to `resources/` or
  `app.asar`); keep mock-site scenarios local-only and deterministic.

---

Previously: **2026-07-19 (E2E-defects fix session)** — **All open E2E-assessment product findings FIXED**,
merged to **clean `main` @ `79e9999`** via **PR #22** (bd **`awkit-64x`** + **`awkit-b92`**, both CLOSED).
Working tree **clean**, **no open PRs**, **no uncommitted work** — start the next task from `main`, normal Git
flow (push/PR only when the user asks). Read this block + the top of `docs/ai/CURRENT_STATE.md` and
`docs/testing/E2E_DEFECTS.md` first.

**Shipped this session (PR #22 → `main`):**
- **awkit-64x (DEF-003)** — first-run sample seeding removed (`app/main/profileStores.ts` `seedFolder` dropped;
  `dataSource.ipc.ts` `ensureDefaultDataSource` + `runtimeInput.ipc.ts` `ensureDefaultRuntimeInputs` deleted).
  Fresh profile → empty states; samples stay in `resources/` via `npm run seed:mock-fixtures`.
- **awkit-b92 (DEF-004/005)** — sender-bound trusted authorization: new `app/main/security/sessionContext.ts`
  binds `event.sender.id → sessionRef`; `assertSenderPermission(event, perm)` fail-closed-gates `execution:*`,
  flow/workflow CRUD, data-source CRUD, and substantive `settings.update`/reset/import. Renderer per-action
  button gating (`usePermissions().can()`) across libraries/designers/DataSource/InstanceMonitor
  (`NodeOptionsMenu`/`WorkflowRunCard` gained `disabled` props); footer nav permission-filtered.
- **OBS-001/002** — StatusBar chips read "Active flows/browsers"; `AWKIT_REAUTH_WINDOW_MS` dev/test override
  wired through `SecurityKernelOptions.reauthWindowMs`.
- **New verifier:** `scripts/verify-session-context.mts` + `verify:session-context` alias (**11/11**).

**Verification (all green):** `npm run build` (tsc + bundles) clean; `verify:session-context` **11/11**;
`verify:e2e-rbac` **49/49** (Viewer `settings.update` + real run now DENIED; footer fixed); `verify:e2e-sweep`
13/13; `verify:e2e-auth` 30 · `verify:e2e-licensing` 22 · `verify:runner` 82 · `verify:authz` 40 · `verify:auth`
49 · `verify:security` 39 · `verify:licensing` 56 · `verify:ipc-contract` 4 · `verify:auth-gui` 18 ·
`verify:admin-gui` 11 · `verify:avatar` 24.

**⚠️ Load-bearing facts + open follow-ups:**
- `assertSenderPermission` (main-process, deny-by-default) is the REAL boundary; renderer `can()` gating is a
  hint only. The binding is set on login/change-password/validate and cleared on logout/destroy/expiry, so a
  window with no bound session is denied (`NOT_AUTHORIZED`).
- Residual gap: **`app/main/ipc/oracle.ipc.ts` backend is not yet sender-gated** (its UI IS gated) — bd
  **`awkit-b3w`** (P2, "Gate Oracle data-source IPC with DATASOURCE_MANAGE").
- **bd `awkit-2d8` (P3)** — automate the live ReauthDialog GUI flow (now unblocked by `AWKIT_REAUTH_WINDOW_MS`).
- Pattern recorded: `bd remember` key `sender-bound-authz`. Details: `docs/testing/E2E_DEFECTS.md`
  (DEF-003/004/005 marked FIXED) + `docs/ai/TASK_LOG.md` top entry.
- External gates unchanged / NOT run: packaged EXE, clean-machine offline VM, multi-day soak (`awkit-cm8`).

---

Previously: **2026-07-19 (E2E QA session)** — **Full adapted E2E QA assessment of `main` @ `0a4500f`
COMPLETE** (bd `awkit-xyo`, closed). The generic web-app QA template was adapted to this offline Electron
app with owner approval; discovery/specs came from the earlier half of the session (before a usage-limit
cut), and this half wrote + ran the executables and reports. **Working tree: UNCOMMITTED test/docs work**
(no production code changed): new `scripts/verify-e2e-*-gui.mjs` + `scripts/verify-e2e-route-sweep.mjs` +
`scripts/lib/e2e-qa-lib.mjs`, 4 `verify:e2e-*` npm aliases, `docs/testing/**` (matrix + execution report +
defects), `specs/e2e/**`, healed `scripts/verify-{auth,admin}-gui.mjs`, docs/ai updates, beads export.
Suggested next step: review + commit on a branch, PR to `main` (only when the user asks).

**Results (all green):** `verify:e2e-auth` **30/30** · `verify:e2e-rbac` **42/42** ·
`verify:e2e-licensing` **22/22** · `verify:e2e-sweep` **13/13** · healed `verify:auth-gui` **18/18** and
`verify:admin-gui` **11/11** (both were silently broken on `main` by PR #21's AccountMenu/LicensingPage —
E2E-DEF-001/-002) · regression `verify:licensing` 56 / `verify:avatar` 24 / `verify:ipc-contract` 4 /
`verify:authz` 40 / `verify:auth` 49.

**Open product findings from the assessment:**
- **bd `awkit-64x` (P2, NEW)** — fresh install seeds bundled samples ("Customer Onboarding Workflow",
  "Login Flow", `customers.json`) as REAL user records via `app/main/profileStores.ts` `seedFolder` —
  violates RULES.md "no demo/seed data". `verify:e2e-sweep` has a tracked-defect check that must be
  updated when this is fixed.
- **bd `awkit-b92` (P3, pre-existing, now evidence-backed)** — `settings:*`/`execution:*` IPC have no
  per-role authorization (Viewer can patch settings / reach `runWorkflow`; sender-guard only), and the
  footer Settings/Help Center nav is not permission-filtered (route guard holds). `verify:e2e-rbac`
  documents both as KNOWN GAP checks that flip when awkit-b92 lands.
- OBS-002: consider an `AWKIT_REAUTH_WINDOW_MS` test override so the ReauthDialog GUI path becomes
  verifiable (today: domain-level only via `verify:authz`).

Read `docs/testing/E2E_EXECUTION_REPORT.md` + `E2E_DEFECTS.md` first. External gates unchanged and NOT
run here: packaged EXE, clean-machine offline VM, multi-day soak (`awkit-cm8`).

---

Previously: **2026-07-19 (later session)** — **Admin/Licensing 8-phase package shipped**: login branding,
Administration UI kit, signed-in profile avatar, and a complete **offline per-machine licensing** system.
Merged to **clean `main` @ `0a4500f`** via **PR #21** (which also carried the two earlier RBAC / Super User
admin commits `908be41`+`985329e` that hadn't reached `main`). Working tree **clean**, **no open PRs**, **no
uncommitted work** — start the next task from `main`, normal Git flow (only push/PR when the user asks). Read
this block + the top of `docs/ai/CURRENT_STATE.md` and **`docs/LICENSING.md`** first.

**Shipped this session (PR #21 -> `main`):**
- **Login branding** — official `specter-violet` logo on the login card
  (`app/renderer/assets/brand/specter-logo.svg`), vector/high-DPI, `onError` fallback to the built-in glyph.
- **Admin UI kit** — `app/renderer/pages/admin/components/AdminUi.tsx` (`AdminPage`/`Banner`/`StatusBadge`
  [13-state, icon+text, theme-aware]/`Loading`/`Empty`); all 5 admin pages refactored; audit *Refresh*
  moved to the canonical `TopHeader` via `usePageChrome`. Existing route authorization preserved.
- **Profile avatar** — `app/renderer/lib/initials.ts` (Unicode `Intl.Segmenter` Teams initials + deterministic
  FNV palette), `UserAvatar` + `AccountMenu` in `AppFrame`. `verify:avatar` **24/24**.
- **Licensing core** — new `src/licensing/**`: Ed25519 signed per-machine licenses, multi-signal hashed
  machine fingerprint (**no IP**), 11-status validator (exact-timestamp expiry), adaptive store (LocalAppData
  primary / ProgramData optional-read, atomic + checksum). Separate offline issuer `tools/license-issuer/**`
  (**NOT bundled**; private key external in `%LOCALAPPDATA%\SpecterStudio\issuer-keys\`). App ships the
  **public key only** (`TrustedKeys.ts` key1).
- **Licensing integration** — granular Super-User-only `license.*` permissions,
  `app/main/licensing/licenseRuntime.ts` + `app/main/ipc/licensing.ipc.ts` (RBAC + reauth + audit), preload
  `licensing.*`, full `LicensingPage.tsx` replacing the placeholder.

**Verification (all green):** `npm run build` (tsc + bundles) clean; **`verify:licensing` 56/56** (domain +
RBAC); **`verify:avatar` 24/24**; **`verify:ipc-contract` 4/4** (new `licensing:*` channels matched);
real-key issuer->app E2E VALID here / MACHINE_MISMATCH elsewhere; security scan — **no private key** in
repo/tree/package (`electron-builder.json` ships `out/**` only; `tools/**` excluded).

**⚠️ Load-bearing facts for the next agent:**
- **License enforcement is OPT-IN, default OFF** (`SPECTER_LICENSE_ENFORCE=true`). With it off the app runs
  exactly as before (no run is blocked); the run gate is in `app/main/ipc/execution.ipc.ts` `runWorkflow`
  (before `startRun`) via `evaluateRunGate()`. Turning on hard enforcement is a **product decision** —
  bead **`awkit-1cc`**.
- Licensing is **independent of auth/RBAC** — nothing under `src/licensing/**` imports `src/security/**`;
  machine binding is enforced by the SIGNED fingerprint, not the file's directory (a copied `license.dat`
  fails `MACHINE_MISMATCH`).
- Issue a test license via `npx tsx tools/license-issuer/{keygen,issue-license}.mts` (see
  `tools/license-issuer/README.md`); the dev key1 private half lives at
  `%LOCALAPPDATA%\SpecterStudio\issuer-keys\key1.ed25519.pkcs8.b64`. Full reference: **`docs/LICENSING.md`**.

**Open follow-ups (beads):** `awkit-1cc` (hard-enforcement rollout decision) + a global-status-banner /
periodic-revalidation task (both P2). **Licensing external gates NOT run** (unchanged): clean-machine offline
VM, packaged NSIS/portable EXE, and the **live Electron GUI walkthrough of the admin/licensing flows** — this
session verified the UI via Playwright screenshots against the real `global.css` (the in-app Browser-pane
preview was unavailable). The prior Oracle thread **`awkit-cm8`** remains open (its two external gates).

---

Previously: 2026-07-19 (**Secure-login epic finished + GUI-verifier suite repaired + Oracle re-validated**,
all merged to **clean `main`** @ `f4f11f3`). The working tree is **clean**, there are **no open PRs**, and
there is **no uncommitted work** — start the next task from `main` with normal Git flow (branch → commit →
push → PR; still only push/PR when the user asks). Everything below the "Current Handoff" heading is
**history**; read this block + the top of `docs/ai/CURRENT_STATE.md` first — older notes about uncommitted
trees or feature branches are obsolete.

**Shipped in the secure-login session (PRs #16–#19, merged to `main`):**
- **PR #16** — GUI-verifier remediation. New shared harness `scripts/lib/gui-verify-harness.mjs`
  (`resolveMainWindow` past the bridge-less splash + `signInFirstRun` past `SecurityGate` + `isolatedLaunchEnv`)
  fixes every real-Electron GUI verifier the splash + gate broke: capacity-settings 12/12, instance-monitor
  12/12, runtime-analytics 36/36 (now idempotent), workflow-builder 20/20, flow-designer 24/24, oracle-drivers
  30/30 (reports 31/31 was the reference). Plus session rotation (`ekd.7`) + single-instance guard (`ekd.6`).
  Closed `awkit-gmn`, `awkit-7ek`, `awkit-9p6`, `awkit-xjv`.
- **PR #17** — proactive idle-lock UI (`awkit-l6h`): renderer activity tracking locks after the idle window
  without a focus event (login notice), and keeps the server's sliding idle window fresh during active use;
  `idleTimeoutMs` surfaced via `BootState`; `AWKIT_SESSION_IDLE_MS` dev/test override. Dark-mode login pass.
- **PR #18** — debounced `SecurityStore` persistence (`awkit-ekd.8`): critical writes (provisioning/user/
  revocations) flush immediately; `insertSession`/`touchSession`/`appendAudit` coalesce over 300 ms + flush on
  close. **Completed the `awkit-ekd` secure-login epic (8/8).**
- **PR #19** — rescoped the stale `awkit-cm8` Oracle-gates tracker.

**Also closed:** `awkit-ekd` epic (secure-login trusted core, 8/8) and `awkit-kzo` (Oracle user-selected-Java)
epic. **Oracle re-validated on current `main`:** 350/350 across 13 non-GUI verifiers, `validate:offline` clean,
`build:oracle-bridge` OK, `verify:oracle-drivers-gui` 30/30, and **`verify:oracle-live` 7/7** vs the real local
Oracle 19c (ephemeral `SPECTER_READER` credential minted → used → rotated + `ACCOUNT LOCK` → secret files
deleted; confirmed LOCKED). Oracle feature is **PRODUCTION-CANDIDATE**.

**Only open thread — `awkit-cm8` (P2, left open):** two genuinely-EXTERNAL gates remain, neither doable on this
**15.9 GB** dev host: (1) packaged-EXE build + clean-machine offline walkthrough (`electron-builder` OOMs),
(2) sustained days-long real-world soak. Both need a higher-memory build host / dedicated soak machine.
Procedures: `docs/ai/ORACLE_JDBC_VALIDATION_GATES.md`. Everything else runnable in this environment is green.

---

Previously: 2026-07-18 (**Release-readiness audit** via the `fullstack-webapp-testing` skill, on merged
`main` @ `93162d6`). **State correction:** the Secure Login work (PR #15, `93162d6`) and the Oracle
user-selected-Java/direct-JDBC work (PR #14, `79e20a5`) are **merged to `main`** — every note below that says
"branch `feature/secure-login-auth`", "branch `feature/oracle-jdbc-driver-settings`", or "NOTHING COMMITTED"
is history. **Decision: `CONDITIONAL GO`** for `main` as a dev/integration checkpoint (NOT a
production-ship verdict — the standing external gates are unchanged and un-run). Fresh safe-test evidence
(build; ipc-contract 4/4; security 39/39; secrets 16/16; auth 41/41; auth-gui 13/13; profile-store 13/13;
write-queue 7/7; mock-site 39/39; runner 82/82) + full report under
`test-artifacts/2026-07-18-release-readiness-audit/`. Flagged the GUI-verifier regression as bigger than bd
`awkit-gmn` recorded — the splash **and** the new `SecurityGate` both block the app shell; fixed
`scripts/verify-reports-gui.mjs` (31/31) as the reference. **That recipe is now applied across every GUI
verifier (PR #16, 2026-07-19) — this item is DONE.**

---

Previously: 2026-07-16 (**Runtime Observability final production-validation** — Phases 1–6). Controlled A/B
overhead + full 30-min soak + measured storage/query benchmarks + real-Electron UI walkthrough (36/36) across
seeded normal/empty/migration/high-data DBs. **Decision: `PRODUCTION-CANDIDATE`** (report §16–17). Corrected the
report's overhead/query/storage/"Experimental" claims. Fixed 2 soak-harness accounting bugs (`cancelled`-run
count; NaN event-loop peak) in `scripts/benchmark-engine-soak.mts`; **no `src/` change** this session. New:
`scripts/seed-observability-fixtures.mts`, `scripts/verify-runtime-analytics-gui.mjs`, 2 `package.json` aliases,
`.gitignore` (`.fixtures-observability/`). Working tree still modified & uncommitted on `main`.
**Remaining gate:** fresh packaged-EXE build + the same walkthrough against the EXE on a higher-memory host (the
`dist/` EXE predates observability; re-packaging OOMs on the 16 GB dev host — see `KNOWN_ISSUES`). Provisional:
anomaly numeric thresholds (uncalibrated) + a precise A/B RSS figure (variance-limited). Prior handoff below is
history.

---

Previously: 2026-07-15 (Real-`ExecutionEngine` capacity benchmark + shared-pool over-launch **race fix** +
Phases 6–10. New benchmark harness drives real workflow instances through the full production scheduler; the
race fix and Phase 8 completion touch `src/runner` core (`SharedBrowserPool`, `ExecutionEngine`,
`BrowserProcessSampler`). Default path unchanged (pool + A8 weights stay flag-OFF pending owner sign-off).
Full write-up: `docs/ai/EXECUTION_ENGINE_CAPACITY_REPORT.md`. **Open decision for the owner:** the evidence
recommends enabling BOTH the shared pool and A8 weighted admission by default (Config D) — a one-line default
flip in `src/runner/concurrency/ConcurrencyConfig.ts`, not yet applied. Working tree modified & uncommitted on
`main`. Earlier uncommitted sessions also remain in the tree — see history below.)

Previous: Shared-browser concurrency capacity — authoritative `BrowserIsolationResolver` + launch-arg-aware
compatibility key hardening the A5 shared Chromium pool (`src/runner` core only; default path byte-for-byte
unchanged). Prior handoff sections are preserved as history.

## Purpose

This file is the active handoff note between AI coding agents and humans. It applies to any coding
agent (Claude Code, Codex, Gemini, Antigravity, future agents) and human developers.

Use this file when work is paused, blocked, or moving from one agent/tool to another.

## Current Handoff

> ⚠️ **SUPERSEDED — see the dated block at the very top of this file (2026-07-21).** The status quoted
> below ("clean `main`, nothing uncommitted") is no longer true: there are now two unpushed local branches,
> `chore/brand-logo-5b` and `feature/randomized-test-lab`. The rest of this block is still accurate as
> *history* of the licensing/secure-login/Oracle threads.
>
> Historical status (2026-07-19, later session): clean `main` @ `0a4500f`, nothing paused or blocked. The
> newest work is the **admin/licensing 8-phase package** (PR #21) — see the top block of this file +
> **`docs/LICENSING.md`**. License enforcement ships **default OFF** (`SPECTER_LICENSE_ENFORCE=true`); the
> open rollout decision is bead **`awkit-1cc`**. The secure-login/Oracle summary below is prior context.
> The full detail is the dated
> block at the top of this file + `docs/ai/CURRENT_STATE.md`. Summary: the secure-login epic (`awkit-ekd`) is
> complete and the Oracle epic (`awkit-kzo`) is closed; both shipped to `main`. The GUI-verifier suite is
> repaired and idempotent (shared `scripts/lib/gui-verify-harness.mjs`). Oracle is PRODUCTION-CANDIDATE,
> re-validated on current `main` (350/350 non-GUI + `verify:oracle-live` 7/7 vs the real local 19c, with a
> minted-then-retired ephemeral credential).
>
> **The single open thread is `awkit-cm8`** — two genuinely-external gates (packaged-EXE clean-machine
> walkthrough — `electron-builder` OOMs on this 15.9 GB host — and sustained days-long soak). Neither is
> runnable here; both need a higher-memory build host / dedicated soak machine. Everything else runnable in
> this environment is green. Procedures: `docs/ai/ORACLE_JDBC_VALIDATION_GATES.md`.
>
> **Live-Oracle re-run recipe (for the next agent, if asked):** the local Oracle 19c listens on
> `:1521`; Java 17 + the ojdbc bundle are in the Settings store (`Local-JDK-17` /
> `Oracle-ojdbc17-local-19c-validation`). `SPECTER_READER` is normally left **LOCKED** — re-run
> `scripts/oracle/local-19c-awkit-types-fixture.sql` via OS-auth `sqlplus / as sysdba` (PowerShell, not Git
> Bash — Bash mangles the `/ as sysdba` arg), mint a fresh ephemeral password, run `npm run verify:oracle-live`
> with the `AWKIT_ORACLE_LIVE_*` env, then **rotate + `ACCOUNT LOCK`** and delete the secret file. Never print
> the password.

---

> ⚠️ **Everything below this line is PRESERVED HISTORY** (older dated handoffs — shared-browser capacity,
> React Flow removal, the Phase 2–5 packaging work, etc.). The **current** state is the top block + the
> "Current status (2026-07-19)" note above. Every "uncommitted tree", "feature branch", and "Active Task"
> below is history; do not act on it as if it were current.

### From / To

- **From:** the agent that hardened the A5 shared Chromium browser pool (isolation resolver + compatibility key).
- **To:** any next agent or human developer.
- **Branch (historical):** `main`, working tree modified & uncommitted. **Superseded — see the state change
  above: the tree is now clean and everything is merged.**

### Active Task — Shared-browser concurrency capacity: COMPLETE (pool stays default-OFF)

Goal: maximise stable concurrent workflow capacity by safely sharing Chromium processes. The A5 shared pool
+ adaptive/backpressure/weighted admission + machine-aware capacity core already existed (plan phases
A1–A10); this task **proved them from code + runtime**, then closed the real gaps. `src/runner` core only —
**no route, IPC, preload (`window.playwrightFlowStudio`), profile schema, or packaging change; the default
path is byte-for-byte unchanged** (shared pool stays flag-OFF via `AWKIT_SHARED_BROWSER_POOL`; the `balanced`
resource profile resolves to one stable compatibility key → sharing behaves exactly as before).

### Completed Work (shared-browser capacity)

- **New `src/runner/browser/BrowserIsolationResolver.ts`** — THE authoritative resolver. Classifies every
  instance into `SHARED_CONTEXT | DEDICATED_BROWSER | PERSISTENT_BROWSER | HANDOFF_BROWSER` with a
  `{decision,value,source}` diagnostic per rule (precedence: persistent profile > mid-run browser-swap node >
  shared-flag > catch-all dedicated), plus `sharedCompatibilityKey(config, launchArgOverrides)` that folds the
  **browser-level** launch config (headed/headless + resolved launch-arg deltas) into the pool grouping key.
  Context-level options (viewport, device scale, storageState, request routing) are deliberately EXCLUDED —
  they stay isolated per `BrowserContext`. Pure/framework-agnostic; delimited + collision-safe (no hash dep).
- **Latent correctness bug fixed:** the shared pool previously grouped browsers only by `browser:headed/headless`
  and ignored per-instance `launchArgOverrides`. With the pool ON **and** a non-`balanced` resource profile,
  two instances with divergent launch flags could reuse one browser carrying only the first leaser's flags.
  `sharedCompatibilityKey` now separates them.
- **Wiring:** `browserSharing.isSharedEligible` now delegates to the resolver (single source of truth — the
  dispatch loop and the factory can't drift); `BrowserContextFactory` shared launcher keys on
  `sharedCompatibilityKey(config, this.options.launchArgOverrides)`; `ExecutionEngine.runInstanceInner` logs the
  isolation class + diagnostics **only when the shared pool is enabled** (silent on the default path).
  `sharedLaunchKey` kept as a legacy human-readable diagnostic.
- **Benchmarks:** ran `benchmark:concurrency` with `AWKIT_SHARED_BROWSER_POOL=1` and found the flag is **inert
  in that harness** (it `chromium.launch()`es one browser per instance, bypassing engine/factory/pool). It
  reported this machine's baseline (highest sustainable **7**, production-approved **5**, stop at 8 on P95 CPU
  96.5%). Built + ran new **`scripts/benchmark-shared-pool.mts`** (`npm run benchmark:shared-pool`) that drives
  the REAL `BrowserContextFactory` + `SharedBrowserPool`: Model A (browser/workflow) vs Model B (shared) →
  **N=4 −37.5% processes / −27% RSS; N=8 −56% / −39%** (headless, maxBrowsers=2); per-context cookie isolation
  held in every cell. The pool saves **RAM + process count, NOT CPU** (per-page render CPU is unchanged), so it
  raises the memory-bound ceiling only.

### Changed Files (this task, on top of the pre-existing uncommitted tree)

- **New (untracked):** `src/runner/browser/BrowserIsolationResolver.ts`, `scripts/verify-browser-isolation.mts`,
  `scripts/benchmark-shared-pool.mts`.
- **Modified (tracked):** `src/runner/browser/browserSharing.ts`, `src/runner/BrowserContextFactory.ts`,
  `src/runner/ExecutionEngine.ts`, `package.json`, `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`,
  `docs/ai/HANDOFF.md`.

### Commands / Tests Run (this task, all green)

- `npm run build` — clean (tsc + electron-vite main/preload/renderer).
- New `verify:browser-isolation` **27/27**.
- Regression: `verify:shared-browser-pool` 18/18, `verify:shared-browser-live` 5/5 (real Chromium),
  `verify:runner` 82/82, `verify:concurrency` 78/78, `verify:workload-weights` 53/53, `verify:resource-routing`
  42/42, `verify:chromium-hardening` 13/13, `verify:browser-resource-profile` 51/51,
  `verify:adaptive-concurrency` 14/14, `verify:operation-limiters` 10/10, `verify:telemetry` 54/54.
- Benchmarks: `benchmark:concurrency` (baseline; profile written to the gitignored `.benchmark-runtime/`),
  `benchmark:shared-pool` (Model A vs B, above).
- **Not run** (untouched areas): recorder/protected-login/GUI/mock-site/packaging verifiers. `npm test` /
  `npm run lint` still do not exist.

### Remaining Work / Recommended Next Step (shared-browser capacity)

- **External gate (unchanged):** a full flag-ON run *through `ExecutionEngine` dispatch* under sustained load on
  a clean machine, then the owner decision to flip the shared pool default ON (owner decision D4). The
  factory+pool lease itself is now measured; sharing does not lift a CPU-bound ceiling (it helps RAM-bound hosts).
- **Optional follow-ups:** wire `browserRecycleMemoryMb` (config field exists; the pool recycles by context
  count only); enable A8 weighted admission (`AWKIT_WORKLOAD_WEIGHTS`, default OFF) once per-class costs are
  calibrated; surface the isolation class / shared-browser count in the Instance Monitor.
- **Recommended next step:** decide whether to commit the working tree. Read the git-full-cycle skill for your
  agent surface (`.claude`/`.codex`/`.gemini` mirror) before any Git operation. Do not push/PR unless asked.

### Known Risks (shared-browser capacity)

- The shared pool is **experimental, default OFF**. Turning it on is now *safe* (incompatible launch configs are
  separated by the compatibility key) but should follow the clean-machine engine-dispatch benchmark.
- `BrowserIsolationResolver` is the single source of truth for browser isolation — do NOT re-derive eligibility
  elsewhere; extend the resolver instead.
- Reuse Session / Auto Secure Login / Manual Handoff / persistent-profile / popup / parallel-isolated-page
  behaviour is unchanged and must stay that way (they map to PERSISTENT/HANDOFF/DEDICATED classes).

### Other uncommitted work already in the tree (NOT this task — leave as-is unless asked)

The working tree carries several earlier sessions beyond this task; do not revert or "clean up" without the
user's ask:

- **Custom in-house canvas engine** (React Flow removal) — see the preserved "Prior uncommitted session" block
  below. Still needs `npm install` to sync `package-lock.json` (`@xyflow/react` removed from `package.json`) +
  `npm run offline:manifest` re-validate.
- **DPAPI secret store + full security-audit remediation** — `src/secrets/`, `app/main/secretStore.ts`,
  `app/main/ipc/{secrets,senderGuard,window}.ipc.ts`, `src/utils/pathSafety.ts`, `src/runner/urlPolicy.ts`,
  `src/profiles/FlowValidation.ts`, `docs/security/`.
- **Browser Resource Optimization** profiles — `src/runner/browserProfile/`, `scripts/benchmark-*.mts`,
  `scripts/benchmark/`, `verify:browser-resource-profile`, `docs/ai/BROWSER_RESOURCE_OPTIMIZATION.md`.
- **Custom app window frame** — `app/renderer/layout/{AppFrame,WindowControls}.tsx`, frameless window changes.

---

## Prior uncommitted session — custom canvas engine (React Flow removal)

### From / To

- **From:** the agent that removed React Flow and built the in-house canvas engine.
- **To:** any next agent or human developer.
- **Branch:** `feature/smart-wait-engine` (level with `origin/feature/smart-wait-engine`; the working
  tree is **modified & uncommitted / unpushed**, and already carried prior sessions' UI-migration work
  before this task). Do not fetch/pull/push/PR unless the user asks.

### Active Task — Remove React Flow (`@xyflow/react`) from the canvases: COMPLETE

The user asked to replace the React Flow-based canvases with the **same custom UI design as their
`Workflow` (flowforge) reference project, but implemented without the React Flow library**. Note the
reference project is itself built on `@xyflow/react`, so this required building a small in-house canvas
engine (viewport pan/zoom, node drag, SVG smooth-step edges, dotted grid, fit-view, screen↔flow
mapping) and porting all three canvases onto it. Renderer-only — **no route, IPC, preload API
(`window.playwrightFlowStudio`), runner/runtime, profile schema, storage contract, or packaging
behavior changed.** Per the user's explicit choice ("adopt flowforge nodes as-is"), the extra
node features listed under Known Risks were intentionally dropped.

### Completed Work (React Flow removal)

- **New in-house engine** `app/renderer/components/canvas/` (all untracked, no `@xyflow` anywhere):
  `FlowCanvas.tsx` (viewport pan/zoom via CSS transform, node drag with DOM measurement, SVG edge
  layer, fit-view, `useCanvas`/`useViewport`, `FlowCanvasHandle` imperative ref exposing
  `fitView`/`zoomTo`/`screenToFlowPosition`, `getIntersectingNodes`), `geometry.ts` (a faithful port
  of React Flow's `getSmoothStepPath` / `getViewportForBounds` math), `edgeComponents.tsx` +
  `edgeLabelContext.ts` (`BaseEdge`/`EdgeLabelRenderer` portaling into an in-transform HTML overlay),
  `Background.tsx` (dotted grid that pans/scales), `CanvasZoomControl.tsx` (glass zoom pill),
  `state.ts` (`useNodesState`/`useEdgesState`/`addEdge` compat helpers), `nodes/StepNode.tsx`,
  `edges/SmoothEdge.tsx` (insert `+`), `edges/LoopEdge.tsx` (self-loop), `types.ts`, `index.ts` barrel.
  The flow runs **top→bottom**: every edge leaves a node's bottom-center and enters the next node's
  top-center (self-loops when source === target).
- **All three canvases converted** to `<FlowCanvas>`: `pages/WorkflowDesigner.tsx` (read-only
  overview, uses `StepNode`), `pages/FlowChartDesigner.tsx`, `pages/ScenarioBuilder.tsx`. Their
  save/load/validation/serialization logic is unchanged — only the rendering layer swapped.
- **Node components rebuilt on the engine** (kept their existing flowforge-parity card markup/CSS):
  `components/workflow/ActionFlowNode.tsx`, `components/scenario/ScenarioFlowNode.tsx`. Resize +
  connector-port rendering removed; loop create/remove moved to the kebab menu via new
  `onToggleLoop`/`hasLoop` data callbacks (page owns the edge mutation).
- **Shared edits:** `components/shared/connectorStyle.ts` dropped its `@xyflow` import; `buildConnectorVisual`
  now returns `{ type: "smooth" | "loop", animated, style }` (was `templateSmooth`/`circular`).
  `components/workflow/FlowNodePropertiesPanel.tsx` `Node` type now imports from the engine.
  `flowDesignerTypes.ts` / `scenarioDesignerTypes.ts` gained `hasLoop`/`onToggleLoop`.
- **Deleted** (React-Flow-only, orphaned by the swap): `components/shared/TemplateSmoothEdge.tsx`,
  `components/shared/SelfLoopEdge.tsx`, `components/shared/ConnectorPorts.tsx`,
  `components/workflow/CanvasZoomControl.tsx`. Removed the `@xyflow/react/dist/style.css` import from
  `main.tsx` and the `@xyflow/react` dependency line from `package.json`.
- **Engine CSS** appended to `global.css` (`.awkit-flow-*`, `.awkit-step-node*`, `.awkit-edge-*`),
  translating the reference's Tailwind card design to AWKIT `--awkit-*` tokens (AWKIT has no Tailwind).
- **Both GUI verify scripts rewritten** against the new DOM (`.awkit-flow-node[data-id]`,
  `g.awkit-flow-edge[data-source][data-target]`, `.awkit-edge-add`, `.awkit-flow-canvas`), dropping the
  removed branch-port geometry checks. `AGENTS.md` (renderer) architecture note updated.

### Changed Files (this task, on top of the pre-existing uncommitted tree)

- **New (untracked):** `app/renderer/components/canvas/**` (engine).
- **Modified:** `app/renderer/pages/{WorkflowDesigner,FlowChartDesigner,ScenarioBuilder}.tsx`,
  `app/renderer/components/workflow/{ActionFlowNode,FlowNodePropertiesPanel,flowDesignerTypes}.tsx`,
  `app/renderer/components/scenario/{ScenarioFlowNode,scenarioDesignerTypes}.tsx`,
  `app/renderer/components/shared/connectorStyle.ts`, `app/renderer/main.tsx`,
  `app/renderer/styles/global.css`, `app/renderer/AGENTS.md`, `package.json`,
  `scripts/verify-flow-designer-gui.mjs`, `scripts/verify-workflow-builder-gui.mjs`.
- **Deleted:** `app/renderer/components/shared/{TemplateSmoothEdge,SelfLoopEdge,ConnectorPorts}.tsx`,
  `app/renderer/components/workflow/CanvasZoomControl.tsx`.
- **Note:** the working tree also holds many *pre-existing* uncommitted changes from earlier sessions
  (Workflow UI migration, Hologram reskin — e.g. `Recorder.tsx`, `LeftNavigation.tsx`, `Settings.tsx`,
  `src/profiles/WorkflowProfile.ts`, `mock-site/*`, doc/`.md` files, `package-lock.json`). Those are
  **not** from this task; leave them as-is unless the user asks.

### Commands / Tests Run (this task)

- `npx tsc --noEmit` — **clean**.
- `npx electron-vite build` — **clean** (main + preload + renderer). Renderer bundle
  **1,589 kB → 1,235 kB** (~355 kB smaller, React Flow gone; modules 2214 → 2049).
- `node scripts/verify-flow-designer-gui.mjs` (real Electron GUI) — **14/14**.
- `node scripts/verify-workflow-builder-gui.mjs` (real Electron GUI) — **14/14**.
- `grep -rn "@xyflow" app/` — no imports remain in source.
- **Not run** (no runner/runtime/mock-site/packaging code touched): `verify:runner`, `verify:recorder`,
  `verify:mock-site`, `verify:workflow-sentinels`, `validate:offline`, packaging verifiers. `npm test` /
  `npm run lint` still do not exist.

### Remaining Work / Recommended Next Step

- **Run `npm install`** — `@xyflow/react` was removed from `package.json` but **still exists in
  `package-lock.json` (6 refs) and `node_modules/`** (install was not run). Sync the lockfile + prune
  the module. This is the top remaining item.
- **Regenerate the offline dependency manifest + re-validate** after the install:
  `npm run offline:manifest` then `npm run validate:offline`. `scripts/generate-dependency-manifest.ps1`
  still references React Flow / `@xyflow` — confirm the manifest no longer lists it and that offline
  validation passes (a dependency was removed).
- **Optional — free node-to-node connect:** the engine currently connects via the `+` insert / append /
  Logic-picker affordances only. Port-drag-to-connect and edge-reconnect were dropped with the port
  model; if arbitrary connect-any-two-nodes is wanted, add flowforge-style drag-a-node-onto-another
  (the engine already exposes `getIntersectingNodes`).
- **Optional cleanup:** the now-unused port helpers remain in `components/shared/connectorStyle.ts`
  (`ConnectorPortFlags`, `computePortFlags`, `reconcileBranchConnectors`, `portHandlesForKind`,
  `branchSourceHandle`, `portPositions`) and the `portFlags?` fields on the two node-data types — dead
  after this task; safe to prune later.
- **Recommended next step:** run `npm install`, then `npm run build`, then `verify:flow-designer` +
  `verify:workflow-builder` to confirm still-green, before committing. Read
  `.claude/skills/git-full-cycle/SKILL.md` before any Git commit. Do not push/PR unless asked.

### Known Risks / Behavior Changes

- **Intentionally dropped features** (from the user's "adopt flowforge nodes as-is" choice): node
  resize, branch-port dragging, edge reconnect, and free port-drag-to-connect. Connections are now made
  via the `+`/append/Logic-picker affordances; loop is toggled from the node kebab menu. All connector
  *kinds* (conditional/parallel/loop), their config, and save/validation logic are preserved.
- **The engine is new hand-written code.** It has been GUI-verified (14/14 ×2) but is less battle-tested
  than React Flow — watch pan/zoom/drag edge cases. Node size is measured from the rendered DOM
  (`ResizeObserver`), so edges attach after first paint.
- The old `docs/ai/CURRENT_STATE.md` "Structured connectors (Checkpoint B)" section still describes the
  **removed** port/handle/`reconcileBranchConnectors` rendering model — the *runtime* connector
  semantics it documents are unchanged, but the renderer half (ports, `useUpdateNodeInternals`,
  branch-pair handles, `.react-flow__*` DOM) no longer exists. See the new dated CURRENT_STATE entry.

---

## Prior release-hardening context (historical — the release gates below are still the real gates)

### Codex Git-Cycle Update

2026-07-07: User explicitly requested committing and pushing all current project changes on
`feature/smart-wait-engine`. This overrides the older "do not push unless explicitly asked" caution for
this Git cycle only; do not assume future pushes are approved.

Fresh verification before staging:
- `npm run build` pass
- `npm run verify:runner` 82/82
- `npm run verify:recorder` 57/57
- `npm run verify:telemetry` 39/39
- `npm run verify:reports` 26/26
- `npm run verify:waits` 21/21
- `npm run verify:mock-site` 28/28
- `npm run validate:offline` pass
- `npm run verify:concurrency` 78/78

### From Agent / Tool

Claude Fable 5 (completed the concurrency & stability layer on top of Codex's uncommitted Reuse Session
lifecycle fixes — both change sets are in the working tree together)

### To Agent / Tool

Any next agent

### Timestamp

2026-07-06

### Branch / Commit

- Repository is a Git repo; always run `git status --short --branch` before editing.
- ~~Current branch: `feature/smart-wait-engine` (ahead of origin by 5 commits; local-only work not pushed).~~
  ~~Work is local-only. Do not fetch, pull, push, or open PRs unless the user explicitly asks.~~
  **STALE (corrected 2026-07-17):** that branch state no longer exists. The repo is on **`main`**, level with
  `origin/main` (`b6e473d`), working tree **clean**, no open PRs. Normal Git flow applies — still only
  push/PR when the user asks. See the state-change note at the top of this file.

### Active Task

Phase 5.1 release-candidate follow-up is in progress on branch `feature/smart-wait-engine`.
The repo is locally modified and uncommitted. The current work items are to:
- centralize Chromium no-egress hardening and ship it into the packaged app,
- make packaged verifiers track the real Electron main process tree and terminate it on cleanup,
- then validate the NSIS install/uninstall cycle and a real clean/offline Windows VM walkthrough.

### Phase 5.1 verification (2026-07-07, current handoff)

- **Chromium no-egress hardening validated end-to-end.** `src/runner/ChromiumHardening.ts`
  (`buildChromiumHardeningArgs`, env-configurable via `AWKIT_CHROMIUM_OFFLINE_HARDENING` /
  `AWKIT_CHROMIUM_EXTRA_ARGS`) is wired into `BrowserContextFactory` + both recorder launch paths and
  NOT into `SessionCaptureService`. Confirmed the `--disable-features` list is an exact superset of
  installed Playwright 1.61's (last-wins), and pinned 4 Playwright behavioral defaults so the arg set
  is self-contained. `npm run verify:chromium-hardening` **13/13** (ONLINE: zero non-loopback over a
  20 s idle window + external navigation still works). `AWKIT_WALKTHROUGH_STRICT_NET=1
  npm run verify:packaged-walkthrough` **70/70** — the strict no-egress check now PASSES; the Phase 5
  Google-service burst is eliminated. **This resolves the Phase 5 egress WARNING.**
- **Packaged-process teardown proven** (`scripts/helpers/packaged-process-tree.mts`): both
  `verify:packaged-runtime` (**25/25**) and the strict walkthrough report a fully-terminated tree.
- **Packaging OOM finding:** the default max-compression (`-mx=9`) packaging OOMs on this 16 GB
  machine; `win-unpacked` (the shared, validated payload) rebuilt hardened. One-off
  `-c.compression=store` builds produced **hardened** validation-grade portable (~1.23 GB) + NSIS
  (~376 MB) EXEs + a consistent `latest.yml` (installer sha512 re-verified). The two package wrappers
  were fixed to fail on a non-zero `electron-builder` exit (they previously masked the failure).
- **Remaining gates (unchanged):** clean/offline Windows VM walkthrough
  (`docs/ai/PHASE5_OFFLINE_VM_WALKTHROUGH.md` §3); NSIS install/uninstall cycle (integrity sha512 only);
  code-signing; producing max-compressed shippable EXEs on a higher-memory machine.
- **RC decision: `PASS WITH WARNINGS`.** `npm test` / `npm run lint` still do not exist.

### Phase 5 additions (2026-07-06, this session)

- **`npm run verify:packaged-walkthrough` (68/68)** — `scripts/verify-packaged-walkthrough.mts`:
  launches the REAL `dist/win-unpacked` EXE with `LOCALAPPDATA` pointed at a fresh empty dir
  (clean first-run simulation); proves first-run init, IPC fixture import, full workflow run +
  artifacts (JSONL/screenshots/report/flow-state), hard cancellation (`cancelled`, Chromium tree
  gone, slot+locks freed), 2-browser OS-level bound under 4 instances, recorder start/cancel,
  hard kill → startup recovery (`orphaned`/recoverable, real Recoverable Runs panel renders,
  markReviewed clears), external SQLite read, ACTUAL portable EXE first boot, NSIS sha512 vs
  `latest.yml`, and network sampling (app processes loopback-only; bundled-Chromium startup
  Google burst = warn-only, `AWKIT_WALKTHROUGH_STRICT_NET=1` to fail). Evidence in
  `dist/phase5-evidence/`.
- **Findings recorded in KNOWN_ISSUES ("Phase 5 packaged-walkthrough findings")** — REQUIRED
  reading before scripting against the packaged app: launcher-stub pid (kill the REAL main from
  `app.evaluate(() => process.pid)`, never `app.process().pid`), orphaned Chromium self-exits
  when the real main dies, per-launch Chromium egress burst, `runWorkflow` needs `dryRun:false`,
  decorated instance ids, mock-site 127.0.0.1/Node-18 `localhost`→`::1` probe gotcha.
- Phase 5J full re-verification green (see CURRENT_STATE header for the complete list).
  `npm test` / `npm run lint` still do not exist.

### Phase 4 additions (2026-07-06, same session family)

- **sql.js ships verified in the packaged app:** `src/runner/store/SqlJsLoader.ts` resolves
  `sql-wasm.wasm` explicitly (`createRequire` + `locateFile`, path exposed);
  `electron-builder.json` lists the dist WASM; manifest generator + `validate-offline-bundle.ps1`
  + the TS manifest policy now REQUIRE `sqlJsRuntimeIncluded`/`sqlJsWasmIncluded` (an old manifest
  fails the packaged startup gate — both packaging scripts regenerate it). Portable (310 MB) +
  NSIS (357 MB) EXEs rebuilt 2026-07-06; `npm run verify:packaged-runtime` 24/24 launches the real
  packaged EXE and proves durable-store init + `%LOCALAPPDATA%` paths + external SQLite read.
- **Runtime diagnostics:** `getRuntimeStatus().environment` = appMode/runtimeRoot/sqlitePath/
  artifactsRoot/sqlJsWasmPath/durableStoreEnabled (logged once at init).
- **Durable runtime opens at app startup** (`registerExecutionIpc` →
  `engine.initializeDurableRuntime`), so startup recovery + recoverable runs appear right after a
  restart without starting a run.
- **Recoverable runs are actionable:** Instance Monitor `RecoverableRunsPanel` (details incl. last
  node/safety/URL/error class/trace/screenshot, open artifact folder, re-run workflow for SAFE runs
  only, mark reviewed/abandoned). New IPC `execution:recoveryDetails`/`execution:recoveryAction`;
  engine `getRecoveryDetails`/`applyRecoveryAction`; `RuntimeStore.listArtifacts`. Dangerous
  (failed/manual-review) runs are never auto-resumed.
- **Stress/soak verifiers (deterministic, tunable `AWKIT_STRESS_*`):** `verify:stress:concurrency`
  13, `verify:stress:cancellation` 8, `verify:stress:locks` 10, `verify:stress:artifacts` 7,
  `verify:soak:runtime` 8 — all green. `verify:stress:locks` found a real bug, now fixed:
  `DurableLockStore.acquireExclusive` treats Windows EPERM/EBUSY wx-create races as contention
  (clean denial) instead of throwing.
- Full Phase 1/2/3 regression re-run green (one `verify:durable-locks` flake under packaging CPU
  load, clean on re-run — noted in KNOWN_ISSUES). `npm test`/`npm run lint` still do not exist.

### Phase 3 additions (2026-07-06, same session family)

- **New dependency:** `sql.js` 1.13.0 (WASM SQLite — chosen because better-sqlite3's native ABI
  can't serve Node 18 tsx verifiers AND Electron 33's Node 20 simultaneously) +
  `@types/sql.js` (dev). Externalized in the main bundle; **packaged-EXE rebuild + dependency
  manifest regeneration still pending** before shipping.
- Durable runtime under `<runtime root>/runtime/`: `runtime.sqlite` (runs/attempts/heartbeats/
  cancellations/watchdog/artifacts/capacity, versioned migrations) + `locks/` (atomic wx-file
  cross-process locks, fencing versions, stale quarantine with reasons).
- Hard cancellation: Stop closes the live browser via per-instance CancellationTokenSource;
  runs end `cancelled` (not failed); `cancelled` error class never retried.
- `FlowStep.safety` explicit side-effect metadata (keyword heuristic = fallback only);
  RetryPolicy is metadata-first; unknown custom types conservative (no auto-retry).
- Dynamic origin claims (`OriginClaimTracker`), CPU/memory `ResourceSampler` in backpressure,
  startup recovery (`runStartupRecovery`: orphaned/recoverable vs failed/manual-review).
- Engine `getRuntimeStatus()` is now **async** (adds `durableLocks` + `recoverableRuns`);
  Instance Monitor strip shows CPU/Mem/Recoverable/Stale-durable-locks.
- New verifiers (95 checks, all green): `verify:durable-store` 11, `verify:durable-locks` 17,
  `verify:cancellation` 12, `verify:safety-policy` 17, `verify:dynamic-origin-claims` 14,
  `verify:resource-sampling` 14, `verify:startup-recovery` 10. Full Phase 1/2 regression green
  (`verify:concurrency` 78, `verify:runner` 82, `verify:waits` 21, `verify:protected-login` 16,
  `verify:recorder` 57, build clean, `ai:memory` pass, `validate:offline` pass in dev mode).
  `npm test`/`npm run lint` do not exist.

### Phase 2 additions (2026-07-06, same session family)

- Failure-path traces: `TraceService` per-step chunks; failed engine-run steps save
  `traces/<stepId>-<ts>.zip` before cleanup; `AWKIT_TRACE_MODE` off/onFailure/always; armed only
  when `instance.paths.traces` exists (verify scripts unaffected).
- Failure screenshots default ON (`onFailure.screenshot: false` opts out; best-effort).
- Origin/account dispatch semaphores (`DispatchClaims` + kind-prefix capacities `origin:*`/`account:*`;
  `AWKIT_MAX_PER_ORIGIN`=2, `AWKIT_MAX_PER_ACCOUNT`=1); released with slot in `finally`.
- Heartbeat refresh on `resumeInstance`/`retryHandoff`; watchdog snapshot (last scan/findings/swept).
- Runtime status: `getRuntimeStatus()` + IPC `execution:runtimeStatus` + preload
  `executions.runtimeStatus()` + read-only Instance Monitor strip (2s poll).
- Node attempts carry `tracePath` + sanitized `currentUrl`.
- New verifiers: `verify:locks` 15, `verify:browser-pool` 13, `verify:watchdog` 13,
  `verify:artifacts` 13, `verify:runtime-status` 15. Regression all green: `verify:concurrency`
  78, build clean, `verify:runner` 82, `verify:waits` 21, `verify:protected-login` 16,
  `verify:recorder` 57, `ai:memory` pass. `npm test`/`npm run lint` do not exist.

### Completed Work

1. **New pure modules:** `src/runner/concurrency/` (ResourceKey, Semaphore, ResourceLockManager —
   exclusive/shared/semaphore, TTL leases, fencing versions, atomic multi-acquire, stale sweep, snapshot;
   ConcurrencyConfig with `AWKIT_*` env overrides; BackpressureController; CapacitySnapshot),
   `src/runner/browser/BrowserWorkerPool.ts`, `src/runner/runtime/` (RuntimeStateMachine, NodeAttempt,
   ErrorClassifier, RetryPolicy, InstanceHeartbeat, WatchdogService), `src/runner/artifacts/` (RunLogger
   JSONL, RunStateArtifacts), `src/profiles/ProfileLockManager.ts`.
2. **BrowserContextFactory:** takes the exclusive in-process `profile:<userDataDir>` lock before
   `launchPersistentContext`, releases it in the runtime close path (and on launch failure). The on-disk
   `Singleton*` artifact check remains for external Chrome/Edge processes.
3. **FlowExecutor:** `executeWithRetry` is classification-gated (RetryPolicy + ErrorClassifier) — only
   transient navigation/timeout/locator/download errors auto-retry, with exponential backoff; dangerous-
   looking mutations (submit/approve/delete/send/pay/confirm keywords) and dead browser/context/page
   failures never do. Isolated parallel branches clamped by `maxActiveNodesPerFlow`.
4. **PlaywrightRunner:** optional `onBrowserRuntime` hook reports the live runtime (initial + each swap
   generation) so the engine's pool can track contexts/pages/disconnects without owning the lifecycle.
5. **ExecutionEngine:** browser-slot admission via BrowserWorkerPool + BackpressureController in
   `processQueue` (blocked dispatch queues with a logged reason); per-instance runner promises tracked;
   heartbeats + JSONL run logs + NodeAttempt records folded from progress events;
   `InstanceRuntimeState.runtime` additive field (flowRunStatus/heartbeatAt/browserWorkerId — UI `status`
   unchanged); WatchdogService marks orphans failed, notes stale heartbeats, sweeps stale locks; end-of-run
   `finally` releases the slot + stray profile locks and writes flow-state/node-attempts/capacity/locks
   JSON under `<instance storage>/state`; `repeatInstance` clears watchdog dedupe and re-enters through the
   slot gate.
6. **Verification:** new `scripts/verify-concurrency.mts` + `npm run verify:concurrency` (78/78), and the
   prior Codex work's tests still pass.

### Files Changed (uncommitted, working tree — includes the prior Codex change set)

- New: `src/runner/concurrency/*`, `src/runner/browser/*`, `src/runner/runtime/*`, `src/runner/artifacts/*`,
  `src/profiles/ProfileLockManager.ts`, `scripts/verify-concurrency.mts`,
  `docs/ai/CONCURRENCY_IMPLEMENTATION_PLAN.md`
- Modified this task: `src/runner/BrowserContextFactory.ts`, `src/runner/FlowExecutor.ts`,
  `src/runner/PlaywrightRunner.ts`, `src/runner/ExecutionEngine.ts`, `src/instances/InstanceRuntimeState.ts`,
  `package.json`, `docs/ai/{ARCHITECTURE,CURRENT_STATE,TASK_LOG,TESTING,COMMANDS,HANDOFF}.md`
- Untracked `electron_test*.cjs` at repo root are **pre-existing** and were left untouched.

### Commands / Tests Run

- `npm run verify:concurrency` — 78/78 (new).
- `npm run build` — clean (tsc + electron-vite).
- `npm run verify:runner` — 82/82.
- `npm run verify:waits` — 21/21.
- `npm run ai:memory` — pass.
- Not run this session: `verify:recorder`, `verify:protected-login`, GUI verifiers, packaging — no
  recorder/protected-login/renderer/packaging code touched.

### Current State Summary

The runner now has an enforced-in-code stability layer: exclusive persistent-profile locking, bounded
browser processes with queueing under backpressure (defaults: 2 browsers, 4 active flows — override via
`AWKIT_MAX_BROWSERS`, `AWKIT_MAX_ACTIVE_FLOWS`, etc.), classified retries with a dangerous-mutation guard,
heartbeat/watchdog recovery for orphaned instances and stale locks, per-instance JSONL run logs (the
previously-unwritten `paths.logs` file), and end-of-run state artifacts for debugging.

### Remaining Work / Recommended Next Step

- **Human clean/offline VM walkthrough** per `docs/ai/PHASE5_OFFLINE_VM_WALKTHROUGH.md` §3 —
  the main remaining gate (includes the NSIS install/uninstall cycle, offline-adapter-disabled
  startup, and the protected-login handoff on a machine with real Chrome). The dev-machine half
  (full packaged workflow run, now with strict no-egress) is automated by `verify:packaged-walkthrough`.
- **Produce shippable EXEs on a higher-memory machine** — the default `-mx=9` packaging OOMs here;
  only `store`-compressed validation EXEs were produced (KNOWN_ISSUES). Then code-sign them.
- Chromium no-egress launch flags: **DONE** (`src/runner/ChromiumHardening.ts`, Phase 5.1C — proven).
- Optional: renderer code-splitting.
- Next phase (deliberately NOT started): remote runner hosts — see the roadmap section in
  `docs/ai/PHASE3_DURABLE_RUNTIME.md`.

### Known Risks / Blockers

- `ELECTRON_RUN_AS_NODE=1` in agent environments makes direct `npx electron script.cjs` boot as plain Node
  (`require('electron').app` is `undefined`). Clear it (`unset ELECTRON_RUN_AS_NODE`) for ad hoc Electron
  reproduction commands. The project GUI verification scripts clear it themselves.
- The real workflow can still pause at Protected Login Handoff after Navigate if the target site requires a
  human login/verification step. Do not automate or bypass that surface.
- Playwright 1.49 API note carried from prior work: no `locator.filter({ visible })`; locator fallback uses
  `nth(i).isVisible()` probing. (Installed Playwright for the app is 1.61 / Chromium 149.)

### Do Not Touch Without Confirmation

- Do not rename `window.playwrightFlowStudio`.
- Do not break offline-first constraints: no runtime internet, no global Node/Playwright/Chromium, and no
  writes to `resources/` or `app.asar`.
- Do not add a "block external / non-Playwright profile" guard to Reuse Session; protected-login session
  capture intentionally uses real Chrome/Edge scoped profiles.
- Keep Mock Site scenarios local-only, deterministic, and free of external services.

### Recommended Next Step

Start from `git status --short --branch`. The lifecycle fix is complete locally and uncommitted. Do not push
unless explicitly asked.

### Required First Actions For Next Agent

1. Read `AGENTS.md`.
2. Read `docs/ai/CURRENT_STATE.md`.
3. Read `docs/ai/HANDOFF.md` (this file).
4. Run `git status --short --branch` and inspect `git diff` before editing.
5. For mock-site work, read `mock-site/AGENTS.md`, `mock-site/README.md`, and the `mock-site-maintainer`
   skill for your agent surface.
6. Read `.claude/skills/git-full-cycle/SKILL.md` (or the `.codex`/`.gemini` mirror) before any Git
   branch/stage/commit/push/PR operation.

## Handoff History

Older handoff detail is preserved in Git history.
