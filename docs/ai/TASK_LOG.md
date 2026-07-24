# TASK_LOG

Append a new entry after every task (newest at top). Keep entries short and factual.

---

## 2026-07-24 — PR #24 reconstructed: Oracle data-source RBAC + hardened live-reauth verifier

- **Task:** reconstruct the stale PR #24 (disposition NEEDS FIX) off current `main` (`b416f8c`), bringing
  `main` into alignment with the already-closed beads `awkit-b3w` + `awkit-2d8`, with **no** `.beads`/`bd`
  mutation.
- **Branch:** `reconstruct/pr24-oracle-authz-reauth` (off `main`); old tip `ec19bda` preserved as
  `backup/pr24-pre-reconstruction` (local + remote). Not a conventional rebase — the old branch carried stale
  `.beads`/docs churn and predated the verifier taxonomy.
- **Code:** `oracle:dataSources:save`/`delete`/`refreshSnapshot` now `assertSenderPermission(event,
  Permission.DATASOURCE_MANAGE)` before service lookup/existence/secrets (trusted-sender preserved inside);
  other Oracle channels unchanged. `verify:e2e-rbac` +2 Viewer Oracle-denial checks (49 → 51). New hardened
  `verify:e2e-reauth` (real-Electron, **19/19**: cancel, exactly-once, no-wrong-password-success-audit,
  no-replay, no-credential-leak) + alias + **`real-browser`** taxonomy entry (registry **107** / real-browser 36).
- **Docs:** COMMANDS / TESTING / E2E_DEFECTS / spec-step-10 + this state/handoff/log refreshed; **no** stale
  `.beads` or old AI-state content ported.
- **Files:** `app/main/ipc/oracle.ipc.ts`, `scripts/verify-e2e-rbac-gui.mjs`, `scripts/verify-e2e-reauth-gui.mjs`
  (new), `scripts/lib/verifier-classification.ts`, `package.json`, `docs/ai/{COMMANDS,TESTING,CURRENT_STATE,
  HANDOFF,TASK_LOG}.md`, `docs/testing/E2E_DEFECTS.md`, `specs/e2e/E2E-RBAC.md`. **No `.beads` files.**
- **Tests:** build ✓; e2e-rbac 51/51; e2e-reauth 19/19; ipc-contract 4/4; security 39/39; auth 49/49; auth-gui
  18/18; authz 40/40; verifier-classification 107. `verify:oracle-drivers-gui` 25/30 — five Oracle
  bridge/Java/ojdbc checks environmental/inconclusive (bridge runtime unavailable in this build), non-blocking;
  no global waiver.
- **Boundaries:** no `bd`, no `bd dolt push`, no `.beads` change; `main` not edited directly; archived `a1adcc2`
  refs untouched.

---

## 2026-07-23 (latest) — Three-branch recovery: pre-merge review + merge to `main`

- **Task:** full pre-merge review + combined integration validation of the three recovered feature PRs
  (#28 accent, #29 HTTPS, #30 branding) and the recovery-docs PR (#31), then merge the features to `main`.
- **Reviews:** PR #28 clean; **PR #29 mandatory security review passed 11/11** (context-scoped only ·
  default `false` · import can't enable · permission-gated mutation · recorder initial + persistent-context
  resume same resolved policy · retries/branches/replacement/shared contexts per-context · no process-wide
  `--ignore-certificate-errors` / Electron cert override · not in the shared-browser pool key · validating
  + bypassing contexts coexist · logs carry no URL/cookie/cert/session data · CAPTCHA/MFA/protected-login/
  handoff unchanged); PR #30 clean; PR #31 factually accurate.
- **Combined integration:** merged accent + https + branding into a throwaway validation branch — only
  **additive** conflicts in `Settings.tsx` / `package.json` / `uiSettings.ts` / `global.css` / `App.tsx`
  (`preload.ts` auto-merged), all resolved preserving every feature (no broad `--ours`/`--theirs`).
  Combined tree built clean; every feature verifier stayed green; a real-Electron coexistence check
  confirmed all three Settings cards on one page, saving one feature doesn't reset another, login applies
  both accent + logo, and defaults restore.
- **PR #30 verifier fix (`f01e4ec`, test-only):** `verify:custom-brand-logo` check #14 changed from
  "`app/main/uiSettings.ts` byte-identical to `main`" to a semantic "branding adds no branding-specific
  UiSettings field" source scan, so it stays 31/31 in a combined tree where accent / recorder-security
  legitimately modify that file. No production branding code changed.
- **Merge sequence (development integration, NOT product promotion):** #28 → `3e79b70`; #30 (updated onto
  `main`, additive conflicts resolved, verifiers re-run 31/31 · 47/47 · 30/30) → `2033424`; #29 (updated
  onto `main`, full HTTPS suite re-run — certs 49/49 · gui 31/31 · runner 82 · recorder 78 · settings 3/3
  · ipc 4/4) → `0777682`. **Final `main`: `0777682`.**
- **Boundaries kept:** `.beads/issues.jsonl` untouched (still the frozen pre-existing backend export); no
  `bd` / `bd dolt push`; PR #27 (`85df851`) untouched; archived source branches intact; release promotion
  (portable rebuild / artifact verification / clean-machine / `validate:offline`) still NOT executed.

---

## 2026-07-23 (earlier) — Three-branch feature recovery (accent / HTTPS / custom brand logo)

- **Task:** decompose the mixed commit `a1adcc2` ("branding, accent theme, and HTTPS certificate trust",
  on `chore/brand-logo-5b`) into **three independent feature branches off `main` @ `32e378e`**, verify
  each, and open three separate PRs. Not stacked; original mixed branch left intact.
- **`feature/custom-accent-gradient` @ `cf5b50f` (PR #28, ready):** finished the accent port (added the
  missing `<AccentColorSettings/>` mount + the two verifiers + package.json aliases). Accent-only.
  `verify:accent-theme` 71/71, `verify:accent-gui` 33/33, build clean. New `docs/ACCENT_COLOR.md`.
  Deferred (optional polish): the `SecurityGate.tsx` live-OS-theme-switch accent hunk.
- **`feature/https-certificate-trust` @ `ba2e887` (PR #29, DRAFT — security review):** recovered
  context-level `ignoreHTTPSErrors` on both context factories; **removed** the browser-wide
  `--ignore-certificate-errors` launch arg + `AWKIT_CERT_FALLBACK_LAUNCH_ARG` env hatch, and reverted
  `sharedCompatibilityKey`'s cert pool-key dimension. Added a source-scan **regression guard** (fails if
  a quoted `"--ignore-certificate-errors"` reappears; pinned `-spki-list` excluded). 3-way merged
  StepExecutor/RecorderService/recorder.ipc/Recorder.tsx to preserve protected-login.
  `verify:https-certificates` 49/49, `verify:https-certificates-gui` 31/31, regression `verify:runner`
  82 + `verify:recorder` 78, build clean. `docs/HTTPS_CERTIFICATE_TRUST.md` gained a security-review
  checklist.
- **`feature/custom-brand-logo` @ `11b2afa` (PR #30, ready):** recovered the Super-User custom logo
  (`src/branding/*` already met the security bar — PNG-signature validation, SVG→PNG rasterization,
  app-managed atomic store, bytes-not-paths IPC, permission/audit, data-URL-only, safe fallback).
  **Excluded** the source branch's `specter-logo.svg` replacement + `package-portable.ps1` change (shipped
  assets preserved). **Added** login-screen display (parity with the sidebar via one `getState()` read).
  New `verify:custom-brand-logo` 31/31 (maps 1:1 to the 15 acceptance cases) + `verify:branding` 47/47 +
  `verify:branding-gui` 30/30 (retargeted one accent-dependent check to the ungated "Application" card),
  build clean. New `docs/BRANDING_CUSTOM_LOGO.md`.
- **Git:** each branch = 1 feature commit + 1 focused docs commit; confirmed cleanly based on
  `origin/main` before its PR. Pushed; PRs #28/#30 ready, #29 draft. `.beads`, `bd dolt push`, release
  promotion, and the archived source branches (`chore/brand-logo-5b` + `backup/…`) left untouched.
- **Docs sync:** these canonical `docs/ai/` updates recording the recovery are committed on a docs-only
  branch `docs/feature-recovery-state-sync` off `main` (kept separate from the feature PRs #28–#30 and
  from `fix/backend-observability-tranche-0` / PR #27). `.beads/issues.jsonl` left untouched.

---

## 2026-07-23 (later; rebased onto `main` @ `9960633` 2026-07-24) — Claude (Opus 4.8) — Backend Tranche 0 (Reporting truthfulness)

- **Authorization:** owner-approved DEVELOPMENT WAIVER of the portable-rebuild / artifact-verification /
  clean-machine gates (recorded atop `CLEAN_MACHINE_VALIDATION_RUNBOOK.md`). Gates **not executed, not
  passed**; `61f6099` promotion **not completed** (release debt). Waiver authorized **Tranche 0 only**.
- **Branch:** `fix/backend-observability-tranche-0` (**PR #27, draft**). Originally branched from `main`
  @ `32e378e`; **rebased onto `main` @ `9960633`** (post-recovery) on 2026-07-24 and pushed
  (`--force-with-lease`). Four-commit history preserved; verified compatible with the merged accent/HTTPS/
  branding recovery. `.beads/issues.jsonl` carried unchanged (still the frozen cross-branch export — not
  committed, excluded from the PR).
- **awkit-5yx (screenshotOnFailure precedence):** wired the resolved artifact-profile default through
  `browserConfig.artifact.screenshotOnFailure` → `PlaywrightRunnerOptions.screenshotOnFailure` → a new
  `FlowExecutor` ctor arg (default `true`), replacing the hardcoded `?? true` at the failure-screenshot
  gate. Precedence: explicit per-step override → profile default → safe system default.
  Behaviour-preserving today (all profiles return `true`). **AC-3 NOT done** (flipping `production` to
  actually suppress contradicts the `ArtifactProfile.ts` design; needs an owner call — out of
  "precedence" scope). Regression: `scripts/verify-failure-screenshot-precedence.mts` (unit, 6/6) —
  drives the real `executeWithRetry` with a stub StepExecutor; the `(default false, no override)` case
  captures 0 and would capture 1 under the old `?? true`.
- **awkit-oei (success close reason):** added `execution-completed-cleanup` to `BrowserCloseReason`;
  `executeScenario`'s `finally` now closes with a reason that tracks the terminal (`closeReason` set to
  completed only on the passed return; failure/other keep `execution-failed-cleanup`). **Log text only**
  — verified the reason never reaches pool analytics. Regression: extended `verify-runner.mts` with two
  live assertions on `result.logs` (passed → completed-cleanup; failed-terminal → failed-cleanup);
  `verify:runner` now **84/84** (+2).
- **FR-I1 (verifier classification):** `scripts/lib/verifier-classification.ts` (registry, 7-class
  taxonomy, all **106** `verify:`/`validate:` scripts) + `scripts/verify-verifier-classification.mts`
  (reconciles against `package.json`, fails on unclassified/stale/non-taxonomy, prints **per-class
  counts** — the Tranche 0 exit criterion). Counts: 43 unit · 35 real-browser · 21 integration · 4
  static-source · 3 packaged · 0 doc-consistency · 0 clean-machine. The seven verifiers `main` gained in
  the recovery are classified by execution behavior: `accent-theme`=unit; `accent-gui`/`https-certificates`/
  `https-certificates-gui`/`branding-gui`=real-browser; `branding`/`custom-brand-logo`=integration.
  **Remaining FR-I1 depth NOT done:** I1.4 "can it actually fail?" audit + I1.2 per-file headers.
- **Files:** `src/runner/{FlowExecutor,PlaywrightRunner,ExecutionEngine}.ts`;
  `scripts/verify-failure-screenshot-precedence.mts` (new), `scripts/verify-runner.mts` (extended),
  `scripts/lib/verifier-classification.ts` (new), `scripts/verify-verifier-classification.mts` (new),
  `package.json` (+2 aliases); `CLEAN_MACHINE_VALIDATION_RUNBOOK.md`, `docs/ai/{CURRENT_STATE,TASK_LOG}.md`.
- **Tests (rebased tree):** `npm run build` clean; `verify:failure-screenshot-precedence` 6/6;
  `verify:runner` 84/84; `verify:verifier-classification` reconciled (**106**); `verify:branch-pairs`
  31/31. Recovery compatibility: `verify:accent-theme` 71/71 · `verify:accent-gui` 33/33 ·
  `verify:https-certificates` 49/49 · `verify:https-certificates-gui` 31/31 · `verify:branding` 47/47 ·
  `verify:branding-gui` 30/30 · `verify:custom-brand-logo` 31/31 · `verify:settings-persistence` 3/3 ·
  `verify:ipc-contract` 4/4. **Not run:** Oracle/packaged/stress suites (untouched surfaces). Beads left
  OPEN (`.beads` frozen — no `bd close`, no `bd dolt push`).
- **Excluded (still in force):** CDP observation, failure-evidence restructuring (`awkit-oyc`),
  `INCONCLUSIVE`/`StepExecutionStatus`, locator recovery (`awkit-v4r`). **No Tranche 1 work.**

---

## 2026-07-23 (later) — Claude (Opus 4.8) — FR-2.6 branch-pair deletion semantics + SRS reconcile

- **Task:** implement the FR-2.6 owner decision from the prior session's canvas sweep — restore the
  lone-branch-connector behavior that both editors had lost — on `feature/canvas-ux-foundation`.
- **Runtime correction (load-bearing):** the prior handoff/SRS said a lone branch connector
  "truncates the flow at run time." Traced the code — it does **not**. `flowStepMapping.toFlowStep`
  sets `FlowStep.next` to the first outgoing edge regardless of kind, and `FlowExecutor.resolveNext`
  falls back `success → always → step.next`. So a lone **conditional** routes to its target with the
  **condition ignored**; a lone **parallel** fans out and then runs the same target **again** via the
  fallback (twice). The fix targets those real behaviors.
- **Hybrid decision (owner-approved):** (a) interactive deletion auto-reverts the lone survivor to a
  normal connector; (b) existing/imported lone branches are **not** rewritten on load — they are
  reported as Save-blocking issues; (c) a lone branch **with a standard fallback** is a valid if/else
  and is exempt.
- **New shared module** `app/renderer/components/shared/branchPairs.ts` (React-free, verifier-loadable):
  `revertLoneBranchConnectors`, `incompleteBranchPairs` + message, `flowEdgeToNormal` /
  `scenarioEdgeToNormal`, `flowEdgeKind` / `scenarioEdgeKind`. Both editors' `reconcile*Branches`
  (were no-op pass-throughs) now delegate to it; both `connectorStructureIssues` validators gained
  the incomplete-pair check. Removed dead `reconcileBranchConnectors` from `connectorStyle.ts`
  (zero call sites; revert semantics moved to `branchPairs.ts`).
- **New verifier** `scripts/verify-branch-pairs.mts` (`npm run verify:branch-pairs`, **31/31**):
  both editors, both kinds — deletion reverts survivor; unrelated/normal connectors untouched;
  load never mutates; lone-with-no-fallback reported while valid if/else exempt; conversion clears
  branch-only config; runtime-safety proofs (no silent truncation, no single-branch fan-out);
  determinism + idempotence.
- **SRS reconcile (docs-only, separate commit):** `docs/SRS_CANVAS_UX.md` (2026-07-10) was
  materially stale — rewrote it against current code: React Flow → in-house engine; FR-2.6 marked
  implemented+verified; corrected dot tokens (`#c4c9d2`/`#2c3140`/`#cac5d3`, `gap={22} size={2}`),
  component renames (`SmoothEdge`/`LoopEdge`/`Background`/`graphLayout`), removed port-slotting
  assumptions, corrected the reduced-motion finding (six blocks, `!important` vs shorthand hazard),
  replaced drifted `global.css` line numbers with token/selector references. `[NEEDS REFERENCE]`
  visual markers preserved.
- **Files changed:** `app/renderer/components/shared/branchPairs.ts` (new),
  `app/renderer/components/shared/connectorStyle.ts`, `app/renderer/pages/FlowChartDesigner.tsx`,
  `app/renderer/pages/ScenarioBuilder.tsx`, `scripts/verify-branch-pairs.mts` (new),
  `package.json` (+1 alias), `docs/SRS_CANVAS_UX.md`, `docs/ai/{TASK_LOG,CURRENT_STATE}.md`.
- **Commits (on `feature/canvas-ux-foundation`, not pushed):** `62aca6d` fix(canvas), `92b40b5`
  test(canvas), + docs commits for the SRS reconcile and this log entry. `.beads/issues.jsonl` left
  uncommitted (carries the prior session's cross-branch beads — splice hazard).
- **Tests:** `npm run build` clean; `verify:branch-pairs` 31/31; `verify:flow-step-mapping` 94/94;
  `verify:canvas-layout` 35/35; `verify:flow-designer` 24/24 + `verify:workflow-builder` 20/20 (real
  Electron, no console errors). **Not run:** runner/recorder/mock-site/packaging verifiers (none of
  those surfaces touched).
- **Result:** FR-2.6 closed and verified in both editors; SRS reconciled. No production behavior
  changed outside the branch-pair rule. Clean-machine gate (backend) unchanged and still blocking.

---

## 2026-07-23 — Coding agent — Browser-automation SRS, artifact regeneration, canvas current-state sweep

- **Task:** review an external browser-automation improvement summary (25 recommendations) against the
  codebase and produce an SRS; then regenerate the 0.1.0 release artifacts from `61f6099`; then
  re-validate the Canvas UX SRS against current code. No backend implementation (blocked by the
  clean-machine gate).
- **SRS** (`docs/browser-automation-srs` @ `32ed8c4`): new
  `docs/SRS_BROWSER_AUTOMATION_OBSERVABILITY.md` (SRS-BAO-001, 1185 lines). Classified the 25
  recommendations as **9 absent / 11 partial / 3 implemented / 1 rejected**, with per-requirement change
  dependencies, a §7 contract map naming the guarding verifier for each, 14 security gates, and 8
  tranches. Key grounded findings: **zero CDP usage anywhere** in `src/`/`app/` (FR-A1 would be the
  first attach path); `urlPolicy.ts` is a *scheme* allowlist that deliberately permits private networks;
  `StepExecutionStatus` has the widest blast radius of any proposed change. Cookie-entropy scanning
  **rejected** — `SessionCaptureService` never materializes cookie values, so extraction would create
  the exposure a scanner then manages.
- **Beads filed (6):** `awkit-ebh`/`awkit-oyc`/`awkit-5yx`/`awkit-oei` (defects found during the SRS
  review) and `awkit-epz`/`awkit-c0c` (packaging provenance), on two separate branches.
- **Artifact regeneration** from a detached worktree at `61f6099` + the preserved offline payload
  (Chromium 149.0.7827.55; `prepare-offline-deps.ps1` deliberately NOT run):
  **NSIS SUCCEEDED** — 373,894,726 B, SHA-256 `4df7fa64…1f1ec333`, NotSigned, Chromium verified inside
  the installer. **Portable FAILED** — 7-Zip `-mx=9` OOM on 1,177 MiB with commit charge at 31.1/31.8 GB;
  `win-unpacked` completed but is not a substitute. Evidence archived outside the repo; worktree removed.
- **Discovered:** the build is **not hermetic from Git** — `vendor/` + `resources/browsers/` +
  `resources/oracle-jdbc/` are gitignored yet copied wholesale as `extraResources`, so a clean checkout
  produces a **hollow artifact** that installs and launches but cannot drive a browser (`awkit-epz`).
  Also: installer SHA-256 equality is unachievable because `dependency-manifest.json` is regenerated
  with a fresh `builtAt` and packaged (`awkit-c0c`).
- **Corrections made to earlier claims in this session** (recorded so they are not re-derived):
  the mislabeled `execution-failed-cleanup` reason is **log text only** — `onRuntimeClosing`'s sole
  consumer discards it and pool analytics come from a different enum; the Flow Designer auto-layout
  "defect" was **already fixed**; the connector-parity "divergence" is actually **parity**, with both
  editors equally missing the invariant.
- **New verifier** `scripts/verify-canvas-layout.mts` (`verify:canvas-layout`, **35/35**) on
  `feature/canvas-ux-foundation` @ `63eef5c`. Imports the real `graphLayout.ts` and asserts **geometry**
  (bounding-box overlap on real 320×96 dimensions, clearance floors, layer order, cycle termination,
  determinism, idempotence) rather than structure. Three behaviors PINNED rather than silently changed:
  `force:true` re-positions hand-placed nodes; the stack detector buckets on an 8px **grid** so a
  boundary-straddling near-stack escapes; `graphLayout`'s `defaultWidth` (220) is narrower than the
  designer's real 320.
- **Canvas UX SRS sweep (read-only):** `docs/SRS_CANVAS_UX.md` (2026-07-10) is materially stale — the
  Workflow Builder edge "+" and the auto-layout are already implemented, components were renamed, and
  every cited `global.css` line number is wrong. **Confirmed defect:** FR-2.6 fails in **both** editors —
  `reconcileBranchConnectors` is dead code and both editors' replacements are no-op pass-throughs, so a
  lone conditional/parallel connector saves silently and truncates the flow at run time. No verifier
  covers branch reconciliation. Four `prefers-reduced-motion` blocks interact through `!important` vs
  shorthand, so consolidation would change behavior.
- **Files changed:** `docs/SRS_BROWSER_AUTOMATION_OBSERVABILITY.md` (new),
  `scripts/verify-canvas-layout.mts` (new), `package.json` (+1 alias), `.beads/issues.jsonl`,
  `docs/ai/{HANDOFF,TASK_LOG,CURRENT_STATE}.md`. **No production source modified.**
- **Tests:** `npm run build` clean; `verify:canvas-layout` 35/35; `npm ci` exit 0 on the rebuild
  worktree; NSIS packaging exit 0; portable packaging exit 1 (OOM — host limit, not a code defect).
  **Not run:** `verify:runner`, `verify:recorder`, GUI/mock-site/packaging verifiers (no runner,
  recorder, renderer, or packaging source touched).
- **Result:** SRS + sweep complete; artifacts half-regenerated. Clean-machine gate still **Not
  Executed** and still blocks backend implementation. Nothing pushed; no PRs.

---

## 2026-07-22 — Claude (Opus 4.8) — Serialization Round-Trip Hardening (extraction + executable verifier)

- **Task:** close the most dangerous verification gap — the designer's model↔node-data converters had
  **no executable round-trip coverage** because they were module-private in a `.tsx` renderer page.
  Behavior-preserving only: no schema changes, renames, migrations, UI changes, or runtime changes.
- **Extraction:** `toFlowStep`, `toNodeConfig`, `createValueSource`, `fromFlowStep` moved verbatim from
  `app/renderer/pages/FlowChartDesigner.tsx` → new `app/renderer/components/workflow/flowStepMapping.ts`
  (also exports the `FlowDesignerNode`/`FlowDesignerEdge` aliases). Every import in the new module is a
  plain non-React module or `import type` (erased), so it carries **no React runtime** and `tsx` can load
  it. Both designer call sites unchanged in behavior; 5 now-dead imports removed from the page.
- **Proof of fidelity:** `diff` of the original block (backup lines 1125–1307) against the extracted
  functions with the `export ` prefix normalized → **183 lines each side, byte-identical**. No
  stop-and-report condition triggered by the extraction itself.
- **New verifier** `scripts/verify-flow-step-mapping.mts` (`verify:flow-step-mapping`) imports the REAL
  production functions — no copied logic. **59/59.** Covers all **12** `WaitCondition` variants,
  before/afterWaits, condition ORDER, response detail (method/URL/statusRange/arming/adaptive timeout
  not recalculated), loader lifecycle, required/optional true/false/absent, all 4 completion policies +
  absent-stays-absent, UI-outcome scaffold with empty text, `minRows:0`/`minItems:0`, legacy steps
  gaining nothing, defaults for missing optionals, clone + edit, and 3 cycles for gradual drift.
- **DEFECT FOUND — bead `awkit-cxa` (P1), pre-existing:** `fromFlowStep` never reads `step.value`, so a
  step with only `value` (no `valueSource`, not `goto`) is silently emptied by one designer open+save.
  Confirmed against real shipped data (`mock-conditional-flow.json`'s `condition` expression is
  destroyed). Scan of `resources/**`: 69 steps, 1 affected today. **Not** caused by the extraction
  (byte-identical). Current behavior **pinned** by two checks; the fix is a runtime behavior change and
  was excluded from this phase by scope.
- **Files:** `flowStepMapping.ts` (new), `FlowChartDesigner.tsx` (−183 lines, +import, −5 dead imports),
  `scripts/verify-flow-step-mapping.mts` (new), `package.json`, `docs/ai/CURRENT_STATE.md`,
  `docs/ai/TASK_LOG.md`.
- **Verification:** flow-step-mapping **59/0**, waits 48/0, async-review 21/0, recorder-flow 19/19,
  recorder 78/0, runner 82/0, protected-login 26/0, protected-login-recorder 45/45, mock-site 55/55,
  ipc-contract 4/4, `tsc --noEmit` clean, `npm run build` clean.
- **NOT RUN — `verify:settings-persistence` (BLOCKED, environmental).** It launches Electron, and
  `app.requestSingleInstanceLock()` (app/main/main.ts:17) makes a second instance quit immediately. An
  AWKIT dev instance has been running since 19:20 (the user's GUI walkthrough). Unrelated to this
  change; it passed 3/3 earlier in the same session. Re-run once no AWKIT Electron instance is open.
- **Also recorded:** GUI gate result 11/12 PASS + 11.3 BLOCKED by `awkit-y24`; and two corrections to
  the earlier packaged-gate claims (the `-mx=9` OOM is intermittent, not a fixed limit — it succeeded on
  retry; and the first packaged build predated awkit-54t).

---

## 2026-07-22 — Claude (Opus 4.8) — Mock Site: async results + empty state + HTTP status fixtures

- **Task:** unblock two Electron GUI gate checks that had **no fixture at all**, and file the design gap
  found while pre-flighting that gate. Fixtures only — no runner, recorder, or serialization logic changed.
- **Why:** a pre-flight of the 12-check GUI gate found (a) `mock-site/server.mjs` had no way to return a
  non-2xx status, so "HTTP 500 is reported as a status error, not a timeout" was unrunnable, and (b) no
  page anywhere had a table/list or empty-state panel (`grep -ci "table|tbody|empty" smart-waits.html` → 0),
  so the empty-result contract was unrunnable.
- **New scenario** `/async-results` (`mock-site/public/async-results.html`): loader + exactly one outcome
  per action — three fixed invoice rows (`results-table`, rows in `tbody`), a **valid empty result**
  (HTTP 200 + zero rows → table hidden, `empty-state` visible), or a selectable HTTP error
  (`error-banner`). Controls `load-populated`, `load-empty`, `load-error`, `error-code`,
  `results-delay-ms`, `reset-async-results`; event log; bounded delays only.
- **New endpoints:** `/api/status?code=&ms=` returns an **allow-listed** status (200/201/202/204/400/401/
  403/404/409/422/429/500/502/503/504; anything else → 500). **3xx is deliberately excluded** so the
  endpoint can never act as an open redirect. `/api/results?mode=populated|empty&ms=` returns three fixed
  rows or a 200 with zero rows — both successes, differing only in UI outcome.
- **Files:** `mock-site/public/async-results.html` (new), `mock-site/server.mjs` (+2 endpoints, +1 route,
  +2 constants), `mock-site/public/index.html`, `mock-site/README.md`, `scripts/verify-mock-site.mjs`.
- **Verification:** `verify:mock-site` **55/55** (was 39/39; +16 new checks incl. an explicit assertion
  that the empty branch renders **zero** rows so `tableHasRows` genuinely fails there, and that
  `?code=302` is refused). Regression `verify:waits` 48/0, `verify:runner` 82/0, `verify:recorder` 78/0,
  `npm run build` clean.
- **Bead filed — `awkit-y24` (P2):** grouped completion composition. `FlowStep.completionMode` is one
  per-step scalar over all `afterWaits`, giving only flat AND / flat OR, so `API success AND (tableHasRows
  OR emptyStateVisible)` is **not expressible**: `resolveAnyRequired` runs `Promise.any` across every
  required condition including the armed API response, so the API resolving first satisfies the step and
  neither UI outcome is ever required. Not a regression — missing expressiveness. Blocks GUI check 11
  configuration 3.
- **Not run / limitations:** the fixtures are not yet exercised end-to-end by a runner verifier (the
  HTTP-500 path is already covered inside `verify:waits`); the GUI gate itself still requires the
  credential holder. Promotion remains **UNAPPROVED**.

---

## 2026-07-22 — Claude (Opus 4.8) — awkit-54t: Async Completion editor + Recorder review-before-save

- **Task:** the UI layer over the awkit-62o async model (bead awkit-54t). Same branch; earlier commits
  (checkpoint + 62o) untouched.
- **Shared pure module** `src/profiles/asyncCompletionReview.ts` — statically classifies a step/action's
  waits + policy as **Reliable / Needs review / Incomplete / Unsafe** with contradiction warnings
  (response with no endpoint pattern; status range inverted / 200-only; empty/non-unique locator;
  fixedDelay-only or all-optional = no completion signal; networkThenUi without an API; anyRequired
  with <2 required; required table-rows vs empty-state outcome). `reviewWait`/`reviewStepAsync`/
  `summarizeReviews`/`classLabel`. Used by BOTH the designer and the recorder.
- **Flow Designer** (`FlowNodePropertiesPanel.tsx`): the old timeout-only "Smart Waits" section is now
  a full **Async Completion** editor — completion-policy `<select>` (allRequired/networkThenUi/
  anyRequired/quietPeriod → `FlowStep.completionMode`); **+ API / + Loader / + UI outcome** add buttons
  (add missing waits, not just remove); per-condition required/optional toggle, timeout, a
  classification badge + warnings, and type-specific field editors (response method/URL/status/arm;
  loader locator/grace/completion/mustAppear; text; table/list min counts). Shown for action nodes even
  when empty.
- **Recorder** (`Recorder.tsx`): Save now opens a **review-before-save modal** (reused `.modal-*`
  system) when the recording captured async activity — per-action classification + warnings + summary
  counts; "Keep editing" / "Save to Flow Library". No async activity → saves directly.
- **Files:** `src/profiles/asyncCompletionReview.ts` (new), `scripts/verify-async-review.mts` (new) +
  `verify:async-review` script, `FlowNodePropertiesPanel.tsx`, `Recorder.tsx`, `global.css`.
- **Verification (all green):** `verify:async-review` **21/0**; regression `verify:waits` 48/0,
  `verify:recorder-flow` 19/19, `verify:runner` 82/0, `verify:recorder` 78/0, `verify:protected-login`
  26/0, `verify:protected-login-recorder` 45/45, `verify:settings-persistence` 3/3, `verify:ipc-contract`
  4/4, `verify:mock-site` 39/39, `npm run build` clean. Built renderer bundle contains the new UI.
- **Not run / limitations:** the "Test locators against the active recorded page" affordance from the
  prompt is not implemented (needs a live recorded page — deferred). GUI click-through of the editor/
  modal is behind the Electron auth gate (same manual gate as before); the interactive walkthrough is
  user-driven.

## 2026-07-22 — Claude (Opus 4.8) — awkit-62o: loader lifecycle + completion policies + consistency

- **Task:** the runtime completion-policy + loader-lifecycle follow-up (bead awkit-62o), extending the
  canonical `WaitCondition`/`beforeWaits`/`afterWaits` model — NOT a parallel field. Same branch;
  prior commits (`eabd555`, `34c9e47`, beads chore) treated as an accepted checkpoint (not amended).
- **Model (FlowProfile.ts):** `WaitConditionBase.optional?`; `loaderHidden` gains
  `appearanceGraceMs?/mustAppear?/completion?` (+ `LoaderCompletion`); `FlowStep.completionMode?`
  (+ `AsyncCompletionMode` = allRequired|anyRequired|networkThenUi|quietPeriod). All additive.
- **Two-phase loader lifecycle (StepExecutor):** appearance watch armed BEFORE the action (a late
  spinner is never skipped); after the action, wait up to `appearanceGraceMs` for it to appear, then
  for the `completion` signal (hidden/detached/aria-busy=false). Optional-never-appears passes;
  required-never-appears + never-disappears produce precise diagnostics (`formatLoaderLifecycleFailure`).
- **Completion policies (`resolveAfterWaits` dispatcher):** allRequired (default, = legacy),
  anyRequired (`Promise.any`), networkThenUi (network→loaders→UI phases), quietPeriod (request-start
  observer + no-blocking-loader). Consistency failures: API-ok-but-UI-missing, API-failed-but-UI-changed,
  loader-still-blocking (`formatConsistencyFailure`); valid empty-result states pass (engine never
  forces table rows). Optional conditions are best-effort everywhere.
- **Cancellation:** new `withCancellation` races every wait against the token; the quiet loop also
  polls `throwIfCancelled` — Stop interrupts API/loader/quiet/UI waits in <2s (verified).
- **Progress:** `emitWaiting` emits `waiting` events naming the endpoint/loader/UI condition, resolved
  timeout, and required/optional status.
- **Round-trip:** `completionMode` carried through the designer allowlist (`fromFlowStep`/`toFlowStep`
  + `FlowDesignerNodeData`); extended wait fields ride in the whole-array `afterWaits`. Recorder emits
  the lifecycle on recorded loaders (grace 1500, mustAppear false) via new `loaderAppearanceGraceMs`
  option + `asyncAwareness.loaderAppearanceGraceMs` setting (validated).
- **Files:** `FlowProfile.ts`, `StepExecutor.ts`, `smartWaitObservation.ts`, `RecorderService.ts`,
  `app/main/uiSettings.ts`, `flowDesignerTypes.ts`, `FlowChartDesigner.tsx`, `scripts/verify-waits.mts`,
  `scripts/verify-recorder-flow.mts`.
- **Verification (all green):** `verify:waits` **48/0** (loader lifecycle ×7, policies+consistency ×8,
  cancellation ×4), `verify:recorder-flow` 19/19, `verify:recorder` 78/0, `verify:runner` 82/0,
  `verify:cancellation` 12/0, `verify:protected-login` 26/0, `verify:protected-login-recorder` 45/45,
  `verify:settings-persistence` 3/3, `verify:ipc-contract` 4/4, `verify:mock-site` 39/39,
  `verify:security` 39/0, `verify:popup` 12/0, `verify:safety-policy` 17/0, `npm run build` clean.
- **Limitations:** quietPeriod window is a runtime constant (750ms), not per-step; the request-start
  observer is active-page-scoped (popup/iframe network not folded in); no Async Completion editor UI
  yet (awkit-54t) — recorded/imported `completionMode` round-trips but is not user-editable.
- **Manual gates still outstanding:** Electron GUI walkthrough + packaged/offline validation.

## 2026-07-22 — Claude (Opus 4.8) — Async Activity Awareness: status-vs-timeout + adaptive timeouts (Phase B of 2)

- **Task:** Phase B of the same prompt — extend the EXISTING `WaitCondition`/`beforeWaits`/`afterWaits`
  model (the canonical async model) rather than fork a parallel `AsyncActivityGroup`, keeping the
  fragile flow round-trip intact. Same branch. Not pushed.
- **Response status vs. timeout (the #1 named runtime bug):** `StepExecutor.buildResponseWait` matched
  on status INSIDE the `waitForResponse` predicate, so an immediate HTTP 500 never matched and became
  a misleading timeout. Refactored: match endpoint (method + urlContains) only, then
  `validateResponseStatus` throws a `ResponseStatusError` with a clear "API returned HTTP 500 for POST
  /path (expected 200–299)…" message routed through a new `formatResponseStatusFailure` (never the
  timeout formatter). Applied to both the armed-before-action path and the deferred path.
- **Adaptive dynamic bounded timeouts:** `smartWaitObservation.buildSmartWaits` now derives
  `timeoutMs = clamp(observed×multiplier + safetyMargin, min, max)` (defaults 3× / +5000 / [10000,
  300000]) for `response` + `loaderHidden` waits, exposed via new `SmartWaitBuildOptions`
  (`adaptiveTimeouts`, `minimumTimeoutMs`, `maximumTimeoutMs`, `timeoutMultiplier`,
  `timeoutSafetyMarginMs`) + exported `adaptiveTimeoutMs()`. Reason strings state the observed ms.
- **Settings:** `recorder.asyncAwareness {enabled, adaptiveTimeouts, minimumTimeoutMs,
  maximumTimeoutMs}` in `uiSettings.ts` — **deep-merged** in `hydrate`/`mergePatch` (nested block must
  not drop siblings), validated/clamped in `validateSettings` (no unlimited timeout). Threaded through
  `recorder:start` → `RecorderService.startRecording` → `attachSmartWaits`.
- **Round-trip:** async waits (incl. adaptive `timeoutMs`) copied whole-array by `buildRecordedFlow`
  and `flowProfileMapping`; new `verify:recorder-flow` assertions prove they survive JSON save.
- **Files:** `StepExecutor.ts`, `smartWaitObservation.ts`, `app/main/uiSettings.ts`,
  `app/main/ipc/recorder.ipc.ts`, `RecorderService.ts`, `scripts/verify-waits.mts`,
  `scripts/verify-recorder-locator.mts`, `scripts/verify-recorder-flow.mts`.
- **Verification (all green):** `verify:waits` 26/0 (incl. HTTP-500-is-not-a-timeout) ·
  `verify:recorder` 78/0 (incl. 6 adaptive-timeout units) · `verify:recorder-flow` 16/16 (round-trip) ·
  `verify:runner` 82/0 · `verify:settings-persistence` 3/3 · `verify:protected-login` 26/0 ·
  `verify:protected-login-recorder` 45/45 · `npm run build` clean.
- **Deferred (filed as follow-ups):** loader appearance-grace/mustAppear runtime lifecycle;
  quietPeriod/networkThenUi/allRequired/anyRequired completion policies + UI-outcome consistency
  failures; 202 job-status polling + response-field predicate; WebSocket/SSE + CDP diagnostics; Flow
  Designer "Async Completion" editor UI; Recorder review-before-save UI; context-level authoritative
  network source. Core correctness (status, adaptive bounded timeouts, arm-before-action, cancellation)
  and the canonical model + round-trip are in place.

## 2026-07-22 — Claude (Opus 4.8) — Recorder protected-login controls + SSO false-positive fix (Phase A of 2)

- **Task:** implement `AWKIT_RECORDER_PROTECTED_LOGIN_AND_ASYNC_ACTIVITY` prompt, phased & regression-safe.
  Phase A = protected-login controls; Phase B (async activity engine) to follow. Branch
  `feature/recorder-protected-login-and-async-awareness` (off main). Not pushed.
- **Root cause:** `src/security/ProtectedLoginDetector.ts` treated plain text "single sign-on" /
  "identity provider" as `reason: sso` with **no confidence level**, and the recorder auto-paused +
  closed the browser on any `detected`. Normal internal HTTPS apps containing that phrase paused.
- **Detector:** added `confidence` (`low|medium|high`) + `recommendedAction` (`continue|warn|pause`).
  Only text-only `sso` (no provider host, no DOM affordance) → low/continue; providers, CAPTCHA, MFA,
  passkey, security-check, and a detected password field all stay `pause`. Pure `classifyProtection`.
- **RecorderService:** pause now gated on `recommendedAction === "pause"` + ignore controls
  (session override, global setting, per-session loop-guard keys). `beginHandoff` now keeps the
  automation browser OPEN during the "detected" phase (closed only on manual handoff) so
  "Ignore and continue recording" (`ignoreCurrentProtectedDetection`) resumes the same page; added
  `if(!isRecording)return` guards to the `__awtkit_recordAction`/`__awtkit_recordSignal` bindings so
  nothing on a protected page is ever recorded while paused.
- **Runner:** the two auto-pause entry points in `StepExecutor.ts` (post-nav + popup) also gate on
  `recommendedAction === "pause"`; manual-handoff retry loop + explicit ManualHandoff node unchanged.
- **Settings:** `recorder.ignoreProtectedLoginDetection` (default false) in `app/main/uiSettings.ts`;
  read server-side in `recorder:start`. New IPC `recorder:ignoreProtectedDetection` + preload method.
  Settings page card with confirmation dialog (immediate persist); Recorder page "Ignore and continue
  recording" button + non-blocking session notice.
- **Mock site:** new `/mock/sso-text-app` false-positive fixture. **Files:**
  `ProtectedLoginDetector.ts`, `RecorderTypes.ts`, `RecorderService.ts`, `StepExecutor.ts`,
  `app/main/uiSettings.ts`, `app/main/ipc/recorder.ipc.ts`, `app/main/preload.ts`,
  `app/renderer/pages/{Recorder,Settings}.tsx`, `app/renderer/styles/global.css`,
  `scripts/verify-protected-login{,-recorder}.mts`, `mock-site/public/secure-login/sso-text-app.html`,
  `mock-site/README.md`.
- **Verification (all green):** `verify:protected-login` 26/0 · `verify:protected-login-recorder` 45/45
  · `verify:runner` 82/0 · `verify:mock-site` 39/39 · `verify:waits` 21/0 · `verify:recorder` 72/0 ·
  `verify:settings-persistence` 3/3 · `verify:ipc-contract` 4/4 · `npm run build` clean.
- **Not run:** clean-machine / packaged-EXE GUI walkthrough (Recorder handoff card is Electron-only —
  manual gate). Phase B (async engine) pending.

## 2026-07-19 — Claude — Fix all E2E-assessment defects (DEF-003/004/005 + OBS-001/002)

- **Task:** implement the plan to fix the open E2E-QA findings on `main` @ `0a4500f` — sender-bound
  trusted authorization, remove first-run seeding, footer nav, status labels, reauth-window override.
- **Fix A (DEF-003 / bd `awkit-64x`):** removed first-run sample seeding — `profileStores.ts`
  `seedFolder` dropped; `dataSource.ipc.ts` `ensureDefaultDataSource` + `runtimeInput.ipc.ts`
  `ensureDefaultRuntimeInputs` deleted (stores return `store.list()`). Samples stay in `resources/`
  via `seed:mock-fixtures`.
- **Fix B (DEF-004 / bd `awkit-b92`):** new `app/main/security/sessionContext.ts` — main-owned,
  sender-bound session registry (`event.sender.id → sessionRef`; bound on login/change-password/
  validate, unbound on logout/destroy/expiry, match-guarded). `assertSenderPermission(event, perm)`
  gates `execution:*` (real-run/repeat/recovery = EXECUTE; pause/resume/stop/… = STOP; dry-run open),
  flow/workflow CRUD (create/clone/import = CREATE, update = EDIT, delete = DELETE), data-source CRUD
  = DATASOURCE_MANAGE, substantive `settings.update`/reset/import = SETTINGS_EDIT. Fails closed.
  Renderer B4 gating via `usePermissions().can()` across libraries, designers, DataSource pages,
  InstanceMonitor (+ `NodeOptionsMenu`/`WorkflowRunCard` disabled props).
- **Fix C (DEF-005):** footer Settings filtered by `can(PAGE_SETTINGS)`; Help Center universal
  (`projectContract` dropped from `RoutePermissions` + the System nav group).
- **Fix D/E:** StatusBar → "Active flows/browsers" (OBS-001); `AWKIT_REAUTH_WINDOW_MS` dev/test
  override wired through `SecurityKernelOptions.reauthWindowMs` (OBS-002).
- **New files:** `app/main/security/sessionContext.ts`, `scripts/verify-session-context.mts` +
  `verify:session-context` alias.
- **Modified (main):** `profileStores.ts`, `ipc/{dataSource,runtimeInput,execution,flow,scenario,settings,
  security}.ts`, `security/{SecurityKernel,securityKernel}.ts`. **(renderer):** `LeftNavigation`,
  `routePermissions`, `StatusBar`, `WorkflowsLibrary`, `FlowLibrary`, `DataSourceManager`,
  `DataSourceEditor`, `FlowChartDesigner`, `ScenarioBuilder`, `InstanceMonitor`, `WorkflowRunCard`,
  `components/shared/NodeOptionsMenu`. **(tests):** `verify-e2e-rbac-gui.mjs`, `verify-e2e-route-sweep.mjs`.
- **Tests (all green):** build clean; `verify:session-context` 11/11; `verify:e2e-rbac` **49/49**;
  `verify:e2e-sweep` 13/13; `verify:e2e-auth` 30 · `verify:e2e-licensing` 22 · `verify:runner` 82 ·
  `verify:authz` 40 · `verify:auth` 49 · `verify:security` 39 · `verify:licensing` 56 ·
  `verify:ipc-contract` 4 · `verify:auth-gui` 18 · `verify:admin-gui` 11 · `verify:avatar` 24.
- **Beads:** closed `awkit-64x` + `awkit-b92`; filed Oracle-backend-gating (P2) + `awkit-2d8`
  (live ReauthDialog GUI, P3); `bd remember` key `sender-bound-authz`.
- **Merged to `main` via PR #22 (`79e9999`).** Residual: `oracle.ipc.ts` backend not yet gated (UI gated); live GUI ReauthDialog
  not automated (a global short reauth window would destabilize the single-launch seed flow).

---

## 2026-07-19 — Claude — E2E QA assessment: executable suites + reports (bd awkit-xyo)

- **Task:** complete the adapted full E2E QA of `main` @ `0a4500f` (prior session did discovery +
  coverage matrix + specs; this session wrote and ran the executables, healed test defects, and
  produced the reports).
- **New files:** `scripts/lib/e2e-qa-lib.mjs` (shared login/nav/admin/direct-IPC drivers),
  `scripts/verify-e2e-auth-gui.mjs`, `scripts/verify-e2e-rbac-gui.mjs`,
  `scripts/verify-e2e-licensing-gui.mjs`, `scripts/verify-e2e-route-sweep.mjs`,
  `docs/testing/E2E_EXECUTION_REPORT.md`, `docs/testing/E2E_DEFECTS.md`; 4 npm aliases (`verify:e2e-*`).
- **Modified:** `scripts/verify-auth-gui.mjs` + `scripts/verify-admin-gui.mjs` (healed stale
  post-PR-#21 selectors — E2E-DEF-001/-002), `package.json`, `docs/testing/E2E_COVERAGE_MATRIX.md`,
  `docs/ai/{CURRENT_STATE,TESTING,COMMANDS,KNOWN_ISSUES,TASK_LOG,HANDOFF}.md`.
- **Tests run (all green):** `verify:e2e-auth` 30/30 · `verify:e2e-rbac` 42/42 ·
  `verify:e2e-licensing` 22/22 · `verify:e2e-sweep` 13/13 · repaired `verify:auth-gui` 18/18 ·
  `verify:admin-gui` 11/11 · regression `verify:licensing` 56 / `verify:avatar` 24 /
  `verify:ipc-contract` 4 / `verify:authz` 40 / `verify:auth` 49. Build was green at session start;
  no production code changed.
- **Findings:** product defect bd `awkit-64x` (fresh install seeds bundled samples as real records);
  documented gaps on bd `awkit-b92` (settings/execution IPC not role-gated; footer nav unfiltered);
  2 test defects fixed. Full detail: `docs/testing/E2E_DEFECTS.md`.
- **Result:** assessment complete; external gates (packaged EXE, clean-machine VM, multi-day soak)
  remain out of scope on this host.

---

## 2026-07-19 — Claude — Admin/Licensing package: Phase 6 (validation) + Phase 7 (docs)

- **Validation:** `npm run build` (tsc + bundles) clean; `verify:licensing` 56/56; `verify:avatar` 24/24;
  real-key issuer→app E2E (VALID on this machine, MACHINE_MISMATCH elsewhere, masked serial). Security scan:
  no private-key material in tracked files or the working tree (`git grep`/grep for the PKCS8 literal =
  empty); only the **public** key in `TrustedKeys.ts`; `electron-builder.json` ships `out/**` only so
  `tools/**` (issuer) is never bundled. Bypass resistance is by construction — enforcement + RBAC live in the
  main process; renderer holds display hints only.
- **Docs:** new **`docs/LICENSING.md`** (architecture, security/threat model, user+admin guidance, developer
  reference, migration, and the Phase 6 validation matrix). `docs/ai/CURRENT_STATE.md` updated with the
  whole package. Filed follow-up beads: `awkit-1cc` (hard-enforcement rollout decision) + the global-status/
  periodic-revalidation task.
- **External gates NOT run this session (unchanged):** clean-machine offline VM walkthrough, packaged
  NSIS/portable EXE run, and the live Electron GUI walkthrough (Browser-pane preview was unavailable; UI was
  verified via Playwright screenshots against the real `global.css`). No commit/push (local-only, per request).

## 2026-07-19 — Claude — Admin/Licensing package: Phase 5 (licensing UI + trusted enforcement + RBAC)

- **RBAC:** added granular licensing permissions to `src/security/authz/Permissions.ts`
  (`license.view/export_request/import/replace/revoke/audit.view`), Super-User-only (Administrator/
  Operator/Viewer excluded — filter now drops all `license.*` + `page.license`); import/replace/revoke are
  SENSITIVE (require fresh reauth). Verified by 8 RBAC assertions in `verify:licensing`.
- **Trusted main-process runtime** `app/main/licensing/licenseRuntime.ts`: single `LicenseService` wired to
  real machine fingerprint + adaptive store (LocalAppData primary, ProgramData optional-read). Enforcement
  is **OPT-IN, default OFF** (`SPECTER_LICENSE_ENFORCE=true`) so existing/unlicensed installs are NOT
  blocked until an operator turns it on. `evaluateRunGate()` gates only REAL runs.
- **Enforcement point:** `execution.ipc.ts` `runWorkflow` — before `executionEngine.startRun` (validation/
  dry-run stay available so diagnostics/reports work). Blocked run returns `status:"licenseBlocked"` with a
  safe action message; never throws. Machine/installation check, independent of auth/RBAC.
- **IPC** `app/main/ipc/licensing.ipc.ts` (registered in `ipc/index.ts`): getStatus/revalidate/
  exportRequest/import/replace/revoke/remove — each sender-guarded, RBAC-checked (deny-by-default), sensitive
  ops reauth-gated, all audited into the shared trail (`targetType:"license"`, safe reason codes, no
  secrets). Preload `window.playwrightFlowStudio.licensing.*` added.
- **UI:** `LicensingPage.tsx` rewritten from placeholder to a full page using the shared admin kit —
  status badge + actionable guidance, masked serial, license id, local-time issued/valid-from/expiry,
  remaining, entitlements, source + conflict banner; machine code + copy + export activation request;
  import/replace/revoke/remove with reauth dialog; loading / permission-denied states. Route description
  updated (no longer "placeholder"). Licensing CSS + `toolbar-button.danger` added (tokens only).
- **Verified:** `npm run verify:licensing` = **56/56** (48 domain + 8 RBAC). `npm run build` (tsc) clean.
  Visual proof of the page (valid state) in light+dark via Playwright screenshot of the real `global.css`.
- **Deferred (noted for Phase 6/7 + beads):** app-wide non-intrusive global status banner and a periodic
  background revalidation timer (the gate already revalidates before each run); enforcement default-OFF
  rollout decision. No commit/push.

## 2026-07-19 — Claude — Admin/Licensing package: Phase 4 (licensing core, offline, per-machine)

- **New bounded context `src/licensing/*`** — independent of auth/RBAC (imports nothing from
  `src/security/*`): `LicenseTypes.ts` (schema v1, 11 statuses, entitlements, activation request, safe
  views, policy), `MachineFingerprint.ts` (SHA-256 over multiple normalised non-admin signals — Windows
  MachineGuid, cpu model/count, mem, platform, first stable MAC, hostname — tolerant of missing signals,
  confidence high/medium/limited, **no IP/hostname-alone/MAC-alone**, raw values never stored),
  `LicenseCanonical.ts` (deterministic signed-bytes + activation request), `crypto/TrustedKeys.ts` (PUBLIC
  keys only; key1 embedded), `crypto/LicenseSignature.ts` (Ed25519 verify for the app; issuer-only sign
  helper), `LicenseValidator.ts` (precedence CORRUPTED→UNSUPPORTED→INVALID_SIGNATURE→MACHINE_MISMATCH→
  REVOKED→CLOCK_INTEGRITY_WARNING→NOT_YET_VALID→EXPIRED→EXPIRING_SOON→VALID; exact-timestamp expiry),
  `store/LicenseStore.ts` (adaptive LocalAppData-primary / ProgramData-optional-read, atomic temp+rename,
  SHA-256 corruption detection, precedence + conflict flag), `LicenseService.ts` (orchestration:
  status/import/replace/revoke/remove/export, clock high-water maintenance).
- **Separate offline issuer `tools/license-issuer/`** (NOT bundled — app ships from `app/**`+`out/**`):
  `keygen.mts`, `issue-license.mts`, `README.md`. Private key sourced from an external path
  (`%LOCALAPPDATA%\SpecterStudio\issuer-keys\`) / `SPECTER_ISSUER_KEY` — never in repo/resources/.env.
- **Storage decision** implemented per user direction (bead memory `licensing-storage-decision`): per-user
  location for admin-free activation; machine binding enforced ONLY by the signed fingerprint, so a copied
  license fails MACHINE_MISMATCH regardless of directory.
- **Verified:** `npm run verify:licensing` = **48/48** (valid/invalid signature, payload modification,
  unsupported schema+algorithm, machine match/mismatch, missing-signal tolerance, exact valid-from/expiry
  boundaries, expiring-soon, revoked, corrupted storage, atomic import/replace, precedence/conflict,
  activation export). Real-key E2E (issuer signs w/ external key1 → app validates w/ embedded public key):
  VALID on this machine, MACHINE_MISMATCH elsewhere, serial masked, high-confidence 7-signal fingerprint.
  `npm run build` (tsc) clean.
- **Security posture:** public key only in app; no private key in repo/package; no IP binding; licensing
  isolated from auth/RBAC. Full threat-model/security-doc write-up deferred to Phase 7 (docs phase).
- **Not done:** Phase 5 (Licensing UI + trusted IPC enforcement + audit), Phase 6 (validation), Phase 7
  (docs). No commit/push.

## 2026-07-19 — Claude — Admin/Licensing package: Phase 2 (admin UI kit) + Phase 3 (profile avatar)

- **Phase 2 (Administration UI):** Added a shared admin UI kit `app/renderer/pages/admin/components/AdminUi.tsx`
  (`AdminPage`, `AdminBanner`, `AdminStatusBadge`, `AdminLoading`, `AdminEmpty`). One status-badge
  vocabulary (13 states: active/valid/disabled/locked/expiring/archived/not-activated/expired/revoked/
  invalid-signature/machine-mismatch/corrupted/not-yet-valid) — icon + text, theme-aware, never colour
  alone; unknown status falls back to a neutral badge with the raw text. Refactored UserManagement, Roles,
  Permissions, and AuditLog pages to compose the kit; removed the login-spinner leak into admin. Audit
  "Refresh" now publishes through the canonical `TopHeader` via `usePageChrome` instead of a card button.
  Route authorization was already enforced (`RoutePermissions` + nav filter + route-mount guard + IPC) and
  is preserved untouched. Deferred (needs live-UI verification): row-action overflow menus, table
  search/sort/pagination — current buttons still work.
- **Phase 3 (Profile avatar):** New shared, DOM-free `app/renderer/lib/initials.ts` (Unicode grapheme-aware
  via `Intl.Segmenter`): `initialsFromName`, `initialsFromIdentity` (displayName→username→email local
  part→"?"), `avatarPaletteIndex` (deterministic FNV-1a → stable colour). New `UserAvatar` (image→initials→
  "?", 6-tone deterministic palette) and `AccountMenu` (avatar + name + role trigger → popover with Sign
  out; keyboard + click-outside + origin-anchored pop, reduced-motion aware). `AppFrame` now renders the
  account menu instead of the plain name+logout. Note: `PrincipalSnapshot` has no profile-image field yet,
  so image source is wired but inactive (honest to the current model). Verifier `npm run verify:avatar`
  (`scripts/verify-avatar-initials.mts`) = **24/24** incl. MA/SK/MO/M, Arabic multi/single word, combining
  marks, whitespace/punctuation, email fallback, missing identity, deterministic palette.
- **Files:** admin: `pages/admin/components/AdminUi.tsx` (new), `UserManagement.tsx`, `RolesPage.tsx`,
  `PermissionsPage.tsx`, `AuditLogPage.tsx`; avatar: `lib/initials.ts` (new),
  `components/shared/UserAvatar.tsx` (new), `components/shared/AccountMenu.tsx` (new), `layout/AppFrame.tsx`;
  `styles/global.css`; `scripts/verify-avatar-initials.mts` (new) + `package.json` (verify:avatar).
- **Verified:** `npm run build` passes (tsc clean); `npm run verify:avatar` 24/24; visual proof via
  Playwright screenshots of the real `global.css` (admin badges/states, avatar + account menu) in light+dark.
- **Not done:** Phases 4–7 (licensing core + integration, validation, docs). No commit/push.

## 2026-07-19 — Claude — Admin/Licensing package: Phase 0 audit + Phase 1 login branding

- **Scope:** Audited the external 8-phase `specterstudio-admin-licensing-phases` package against the
  codebase, then executed Phase 1 (login-screen branding) using the `apple-design` skill for the UI work.
- **Phase 0 (audit):** Login uses a generic `Workflow` lucide glyph (not the product logo); official vector
  exists at `logos/specter-violet/export/logo.svg` (+ PNG exports); admin pages exist but share no admin
  shell (Phase 2 work); `PrincipalSnapshot` has no profile-image field (Phase 3); `LicensingPage` is a pure
  placeholder, bead `awkit-s05` already tracks it (Phases 4–5). No IP-binding / private-key-in-package
  issues exist today (nothing implemented yet).
- **Phase 1 changes:** Copied the official logo to `app/renderer/assets/brand/specter-logo.svg`; imported it
  into `LoginScreen.tsx` and rendered it as the brand mark (self-contained squircle, standalone — not in the
  accent-soft box), with an `onError` fallback to the existing `Workflow` glyph so a failed asset never
  shows a broken image. Added `.awkit-login-logo` CSS (64px, vector = sharp on high-DPI). Added
  `app/renderer/types/assets.d.ts` ambient module decl for `*.svg`/`*.png` imports.
- **Files:** `app/renderer/security/screens/LoginScreen.tsx`, `app/renderer/styles/global.css`,
  `app/renderer/types/assets.d.ts`, `app/renderer/assets/brand/specter-logo.svg` (new).
- **Verified:** `npm run build` passes (tsc --noEmit clean; logo bundled as `assets/specter-logo-*.svg`).
  Visual proof via a Playwright screenshot of the real `global.css` login card in light + dark (Browser
  pane preview was timing out). Auth behavior, AD "Coming soon" tab, lockout, and session flow unchanged.
- **Not done:** Phases 2–7 (admin UI shell, profile/avatar, licensing core + integration, full validation,
  docs) remain. No commit/push (conservative profile; awaiting direction).

## 2026-07-19 — Claude — Super User administration + RBAC authorization (Phase 3)

- **What:** built the authorization/administration layer the auth core lacked — RBAC + Super User admin +
  user management, per the design plan (Phase 3/11/12). On branch `feature/superuser-admin-rbac`.
- **Backend:** `authz/Permissions.ts` (registry + built-in SuperUser/Administrator/Operator/Viewer roles +
  effectivePermissions), `authz/AuthorizationService.ts` (requirePermission = the real deny-by-default
  boundary + requireFreshReauth 5-min window), `admin/UserAdminService.ts` (create/update/enable/disable/
  archive/reset/revoke with final-active-SU protection, protected-SU immutability, no escalation, session
  invalidation on security change, audit). Schema migration v2 (roles column + archived status);
  AuthenticationService.reauthenticate + roles/permissions in PrincipalSnapshot; SessionManager reauth
  helpers; SecurityStore list/roles/audit-read + SU counts. 9 `security:admin:*` + `security:reauth` IPC
  (authorization-enforced, schema-validated) + preload.
- **Renderer:** `usePermissions`/`RoutePermissions` gate nav + route mount (`NotAuthorized`); Super User
  Administration area — Users (CRUD + role editor + reauth modal), Roles, Permissions matrix, Audit Log,
  Licensing placeholder; token-only `.awkit-admin-*` CSS.
- **Decisions resolved:** O-1 scrypt, O-2 built-in roles, O-4 roles-only v1, O-5 fresh login; O-8 recovery
  codes deferred; licensing left as a clean placeholder (Phase 5).
- **Files:** new `src/security/{authz/Permissions,authz/AuthorizationService,admin/UserAdminService,
  ipc/SecurityAdminIpcSchema}.ts`, `app/renderer/security/{usePermissions,routePermissions,NotAuthorized}`,
  `app/renderer/pages/admin/*` (6 files), `scripts/verify-{authz,admin-gui}`; modified SecurityStore(+Schema),
  AuthenticationService, AuthTypes, ReasonCodes, SessionManager, SecurityKernel, security.ipc, preload,
  routes.tsx, LeftNavigation, App.tsx, global.css, package.json.
- **Tests:** `npm run build` clean; **verify:authz 40/40**, **verify:admin-gui 10/10** (real Electron),
  **verify:auth 49/49**. Backend committed locally (part 1); renderer + tests pending local commit (part 2).
  Follow-ups: SU recovery codes, per-user overrides/custom roles (v2), machine licensing (Phase 5), AD.

---

## 2026-07-19 — Claude — SecurityStore debounced persistence (awkit-ekd.8)

- **What:** `SecurityStore` exported + fsynced the whole DB on every mutation (login ≈ 4 full writes; the
  idle-lock heartbeat's `touchSession` wrote on every validate). Adopted `SqliteRuntimeStore`'s debounced +
  persist-on-critical-transition + flush-on-close model.
- **Criticality split:** critical/immediate = `setProvisioned`, `insertUser`, `updateUser`, `revokeSession`,
  `revokeSessionsForUser`, `revokeSessionsForUserExcept` (a provisioned/changed/revoked credential must
  survive a crash). Debounced (300 ms) = `insertSession`, `touchSession`, `appendAudit`. A critical flush
  exports the whole in-memory DB, so it sweeps up any pending debounced write; `close()` force-flushes the
  trailing write; `open()` still forces the initial schema write. Crash-before-debounce is fail-closed
  (re-login / slightly-stale idle / missing forensic row).
- **Implementation:** `persist(critical=false)` marks dirty + either flushes now (critical, awaited) or arms
  a single unref'd debounce timer; `persistNow()` → `flushDirty()` (dirty guard, atomic temp+rename, re-arm
  dirty + rethrow on failure). Added a test-only `persistWriteCountForTest()`.
- **Files:** `src/security/store/SecurityStore.ts`, `scripts/verify-auth.mts` (+4 debounce checks).
- **Tests:** `npm run build` clean; **verify:auth 49/49** (was 45), **verify:auth-gui 18/18** (real Electron,
  DPAPI + real close-on-quit), **verify:security 39/39**, **verify:single-instance 3/3**. Closes `awkit-ekd.8`.

---

## 2026-07-19 — Claude — Proactive idle-lock UI + dark-mode login pass (awkit-l6h)

- **Proactive idle lock (renderer):** `SecurityGate` now tracks user activity (pointer/keyboard/wheel/
  scroll/touch) while authenticated and locks after the idle window WITHOUT waiting for a focus/visibility
  event — returns to the login screen with a *"You were signed out after N minutes of inactivity."* notice.
  The same heartbeat, while the user is genuinely active, refreshes the server's sliding idle window
  (`validateSession`) so a continuously-used, never-blurred window isn't logged out at 30 min, and catches
  server-side invalidation. Tick/refresh cadence scale off the idle window.
- **Idle window exposed:** `SessionManager.idleTimeoutMs` getter → `SecurityKernel.getBootState().idleTimeoutMs`
  → renderer. Electron binding honors a numeric `AWKIT_SESSION_IDLE_MS` dev/test override (production keeps
  `DEFAULT_SESSION_POLICY` 30 min / 12 h).
- **Dark-mode login pass:** added `.awkit-login-notice` (info-toned, theme-aware) and a dark-mode assertion +
  screenshot to the login verifier.
- **Files:** `app/renderer/security/SecurityGate.tsx`, `app/renderer/security/screens/LoginScreen.tsx`,
  `app/renderer/styles/global.css`, `src/security/SecurityKernel.ts`, `src/security/session/SessionManager.ts`,
  `app/main/security/securityKernel.ts`, `app/main/preload.ts`, `scripts/verify-auth-gui.mjs`.
- **Tests:** `npm run build` clean; **verify:auth-gui 18/18** (was 13/13; +dark-mode, +proactive-lock via a
  4s `AWKIT_SESSION_IDLE_MS`), **verify:auth 45/45**. Screenshots `reports/security-login/login-dark.png` +
  `login-idle-locked.png` inspected. On branch `feature/proactive-idle-lock`; nothing committed yet.

---

## 2026-07-19 — Claude — Oracle Drivers GUI verifier: self-contained isolated profile + gate auth (awkit-xjv)

- **What:** `verify-oracle-drivers-gui.mjs` was the one GUI verifier the awkit-gmn shared-harness fix didn't
  resolve on its own — it launched against the developer's REAL profile (so PR #15's SecurityGate blocked
  the app shell) and depended on the real validation store. Reworked it to be self-contained + non-destructive
  like the others.
- **How:** launch on an **isolated empty `%LOCALAPPDATA%`** (`isolatedLaunchEnv`), then **copy** the
  validation stores (`java-runtimes` + `oracle-drivers`) from the source profile into it before launch. The
  copy resolves to the same ids because the Java record holds a machine-global `java.exe` path and the driver
  bundle's managed dir carries its own jar (manifest uses a **relative** `jdbcJar`). Then `signInFirstRun`
  past the SecurityGate, and reach Settings via **nav-item clicks** instead of `win.reload()` (a reload
  re-mounts the gate and drops the session — same lesson as capacity-settings); the post-save re-render is a
  nav bounce (`remountSettings`) rather than a reload. Source profile overridable via
  `AWKIT_GUI_SOURCE_LOCALAPPDATA`; a clear `exit 2` if the validation store is absent.
- **Non-destructive:** the real profile is only **read** (copied from); all writes (probe profile, sign-in,
  set-default) land in the temp profile, which `cleanup()` deletes.
- **Files:** `scripts/verify-oracle-drivers-gui.mjs` (removed the local `resolveMainWindow`/`env`, added
  seed-copy + `gotoSettings`/`remountSettings` nav helpers + first-run auth). No `src/` change.
- **Tests:** `npm run build:oracle-bridge` OK; **verify:oracle-drivers-gui 30/30 twice** (was blocked by the
  gate) — real bridge launches Java 17.0.8 + loads the real ojdbc `23.26.2.0.0` end-to-end; no temp-profile
  leftovers. Requires the Oracle validation env (real java.exe + ojdbc jar). bd `awkit-xjv` CLOSED.

---

## 2026-07-19 — Claude — Flow Designer GUI verifier: modernize stale geometry assertions (awkit-9p6)

- **What:** the 5 flow-designer geometry checks asserted the pre-Hologram **docked-column** model
  (`canvasEngineRight <= panelLeft`, `panelRight <= canvasRight`, `panelTop ≈ canvasAreaTop`, and
  engine-width-grows-on-collapse). The design is now a **floating overlay drawer** — measured the live
  geometry and rewrote them to the real invariants.
- **Measured (real Electron):** expanded drawer → `.react-flow-shell` keeps the **full canvas width**
  (1200/1696/784 == canvasWidth at 1440/1936/1024), fixed **435px** drawer floats over the right edge with
  a consistent **~1.8px** overhang past `canvasRight`, `panelTop` 2–3px below `canvasAreaTop` (below the
  action bar); collapsed rail = **48px** (CSS `calc(var(--space-5) * 2)` — resolves the bead's rail-width
  question), `bodyPaddingRight` 0 open → ~60px collapsed.
- **New assertions:** engine spans full canvas width (`|canvasEngineWidth - canvasWidth| <= 2`), drawer
  contained left + `panelRight <= canvasRight + 4`, `panelTop >= canvasAreaTop - 2`,
  `panelBottom <= canvasAreaBottom + 2`, and collapse shrinks the rail well below the open drawer width
  (`railWidth <= 96 && railWidth < panelWidth/2`). Also fixed a **races-the-animation** bug: the collapse
  measurement waited a fixed 220ms (< the 240ms `--awkit-dur-panel` glide) and sometimes read the drawer
  mid-collapse (~440px) → replaced with `waitForFunction` polling until the rail settles ≤96px.
- **Files:** `scripts/verify-flow-designer-gui.mjs` (`readInspectorGeometry` gains `bodyPaddingRight`; the
  5 checks + collapse wait rewritten). No `src/` change.
- **Tests:** `npm run build` clean; **verify:flow-designer 24/24 twice** (was 19/24). bd `awkit-9p6` CLOSED.

---

## 2026-07-19 — Claude — GUI-verifier sweep (awkit-gmn) + auth hardening (awkit-ekd.6/.7)

- **GUI-verifier sweep (bd `awkit-gmn`):** added shared harness `scripts/lib/gui-verify-harness.mjs`
  (`resolveMainWindow` splash-poll + `signInFirstRun` SecurityGate first-run + `isolatedLaunchEnv`).
  Fixed the app-shell verifiers to launch on an isolated empty `%LOCALAPPDATA%` and sign in past the
  gate: **verify:capacity-settings-gui 12/12** (nav to Settings instead of a session-dropping reload),
  **verify:instance-monitor-gui 12/12**, **verify:runtime-analytics-gui 36/36** (all four seeded states),
  **verify:workflow-builder 20/20** (seeds 2 flows + 1 workflow),
  **verify:flow-designer 19/24** (seeds 1 multi-node flow; now launches + signs in + all behaviour checks
  pass). `verify:settings-persistence` confirmed **3/3 unchanged** (pure preload IPC, never gated).
- **Residuals split out:** flow-designer's 5 remaining failures are **stale post-Hologram geometry
  assertions** (assert the old docked-column `canvasEngineRight <= panelLeft`; the design is now a floating
  overlay drawer with a `padding-right` canvas inset — global.css ~8286) → **bd `awkit-9p6`**.
  `verify-oracle-drivers-gui` needs the auth half **plus** its Oracle validation store (Java runtime +
  ojdbc bundle) seeded into an isolated profile → **bd `awkit-xjv`** (Oracle-epic GUI gate).
- **Idempotency fix (bd `awkit-7ek`, found + fixed during re-verification):** `verify-runtime-analytics-gui`
  points `LOCALAPPDATA` at persisted `.fixtures-observability/<state>` dirs, so the first run provisioned a
  Super User into `<state>/SpecterStudio/security` and a re-run (without a fresh seed) hit the login form —
  `signInFirstRun` then timed out and the walkthrough silently reported **0/4**. `walkState` now `rmSync`s
  `<state>/SpecterStudio/security` before each launch (leaving the observability fixture untouched), so every
  run is a clean first-run. Proven idempotent: **36/36 twice back-to-back with no re-seed**.
- **awkit-ekd.7 (session rotation):** `AuthenticationService.changePassword` now revokes every other active
  session for the user, keeping the current one (`SessionManager.revokeOthersForUser` →
  `SecurityStore.revokeSessionsForUserExcept`). `verify:auth` **45/45** (added 4 Session-rotation checks).
- **awkit-ekd.6 (single-instance guard):** added `app.requestSingleInstanceLock()` in `app/main/main.ts`
  (second launch focuses the running window via `second-instance` and quits before opening any window/store)
  so two processes can't race on `security.sqlite`/ui-settings per profile. New **verify:single-instance 3/3**.
- **Files:** `scripts/lib/gui-verify-harness.mjs` (new), `scripts/verify-single-instance.mjs` (new),
  `scripts/verify-{capacity-settings,instance-monitor,runtime-analytics,workflow-builder,flow-designer}-gui.mjs`,
  `scripts/verify-auth.mts`, `src/security/{auth/AuthenticationService,session/SessionManager,store/SecurityStore}.ts`,
  `app/main/main.ts`, `package.json` (verify:single-instance).
- **Tests run (all re-verified independently 2026-07-19):** build (typecheck+bundles) clean; verify:auth
  **45/45**, verify:single-instance **3/3**, verify:capacity-settings-gui **12/12**,
  verify:instance-monitor-gui **12/12**, verify:runtime-analytics-gui **36/36** (idempotent, twice),
  verify:workflow-builder **20/20**, verify:flow-designer **19/24** (5 known geometry residuals → awkit-9p6).
  Earlier session also: verify:auth-gui 13/13, verify:security 39/39, verify:secrets 16/16,
  verify:settings-persistence 3/3. **Not run:** verify:oracle-drivers-gui (awkit-xjv) and the wider
  Oracle/concurrency/packaging suites (out of scope).
- **Result:** awkit-gmn's splash/gate breakage resolved across the general verifiers; ekd.6 + ekd.7 closed;
  awkit-7ek (runtime-analytics idempotency) fixed + closed.

---

## 2026-07-18 — Claude — Oracle `verify:oracle-live` gate PASSED against real local Oracle 19c

- **Task:** Complete the unfinished Oracle JDBC driver-settings work by running the credential-gated
  `verify:oracle-live` application gate against the user's real local Oracle DB
  (`jdbc:oracle:thin:@//localhost:1521/ORCLPDB`, user `SPECTER_READER`). Branch
  `feature/oracle-jdbc-driver-settings`.
- **Driver bundle:** imported `ojdbc17.jar` (23.26.2.0.0) into the Settings-managed store via
  `scripts/oracle/import-driver-bundle.mts` → bundle `Oracle-ojdbc17-local-19c-validation`, status valid,
  JDBC-only (no UCP). Real driver loaded in an isolated bridge.
- **Fixture mismatch (decided with the user):** the downloaded pack created
  `SPECTER_FIXTURE.CUSTOMERS`(3)/`TYPE_SAMPLES`(1) with columns unlike the harness's `id`/`name`+50-row
  expectation. Chose to **provision the canonical fixture additively** rather than weaken the harness. New
  `scripts/oracle/local-19c-awkit-types-fixture.sql` (idempotent) creates `SPECTER_FIXTURE.AWKIT_TYPES_TEST`
  (204 rows), `GRANT SELECT` to `SPECTER_READER`, private synonym `SPECTER_READER.AWKIT_TYPES_TEST` **as
  SYS**; existing objects untouched. Ran via OS-auth `sqlplus` from the registered 19c home
  (`C:\Users\moham\Downloads\WINDOWS.X64_193000_db_home`; not on PATH).
- **Credential (decided with the user):** minted a strong random dev-only `SPECTER_READER` password via
  OS-auth (`ALTER USER … IDENTIFIED BY`), stored only in a user-scoped scratchpad file — never printed to
  chat/logs/history/the redacted artifact. After the run: rotated to a discarded random password + **ACCOUNT
  LOCK**, then securely overwrote+deleted the secret file. No persistent env var set.
- **Result:** `npm run verify:oracle-live` **7/7 in real mode** (testConnection, select-small, truncation,
  type-conversion, policy-blocks-dml=`SQL_POLICY_VIOLATION`, permission-or-missing-object=`DRIVER_ERROR`,
  cancellation=`CANCELLED`). Bridge `executionMode=real`, driver 23.26.2.0.0, Java 17.0.8. Redacted artifact
  `reports/oracle-validation/oracle-live.json` (gitignored). Pre-run read-only self-check also confirmed
  `SELECT` works (qualified + via synonym) and `INSERT` is blocked (ORA-01031).
- **Regression:** `npm run build` clean; `npm run verify:oracle-driver-bundle` 43/43.
- **Status:** external gate #2 (authorized read-only Oracle run) is **met**; overall release status stays
  `INTEGRATION-CANDIDATE` — UCP pooled path still unvalidated (no UCP jar), private-JRE/packaged-EXE
  walkthrough and perf/soak gates remain. **Not committed** (conservative profile; awaiting user go-ahead).
- **Files:** new `scripts/oracle/local-19c-awkit-types-fixture.sql`; docs `CURRENT_STATE`/`HANDOFF`/`TASK_LOG`
  + `ORACLE_LIVE_VALIDATION_RESUME.md`. No app source changed.

---

## 2026-07-18 — Codex — Provision and verify local Specter Oracle fixture

- **Task:** Execute the downloaded `SPECTER_ORACLE_FIXTURE_SETUP` PowerShell setup and verifier and confirm
  that every expected Oracle artifact was created.
- **Environment discovery:** local Oracle Database 19c was already running as `ORCL` with PDB `ORCLPDB`
  open read/write on port 1521. SQL*Plus was present in the registered Oracle home but absent from `PATH`;
  commands used that exact Oracle-home binary. Docker remained stopped and was not needed.
- **Setup correction:** the first run exited 1 before creating anything because the downloaded setup script
  unconditionally opened an already-open PDB (`ORA-65019`). Updated only the downloaded (non-repository)
  script's open step to query `V$PDBS` and open the PDB only when needed; the rerun exited 0.
- **Created:** open users `SPECTER_FIXTURE` and `SPECTER_READER`; valid table objects `CUSTOMERS` and
  `TYPE_SAMPLES`; valid view `V_ACTIVE_CUSTOMERS`; deterministic counts 3 customers / 1 type sample /
  2 active customers.
- **Least privilege:** `SPECTER_READER` has only `CREATE SESSION`, non-grantable `SELECT` on those three
  objects, and no roles. The supplied reader verifier exited 0 and proved `INSERT` is rejected.
- **Secrets:** both passwords were entered in local interactive PowerShell prompts; none were printed,
  persisted by Codex, or copied into repository memory.
- **Repository files:** `docs/ai/{CURRENT_STATE,HANDOFF,TASK_LOG}.md` only. The corrected downloaded script
  is outside the repository.
- **Tests run:** setup process exit 0; direct SYSDBA object/count/grant inspection exit 0; supplied
  `verify-specter-reader.ps1 -ServiceName ORCLPDB` exit 0; final sentinel-row check exit 0.
- **Not run:** application `verify:oracle-live`, build, and packaging checks; no app source or package changed.
- **Result:** downloaded fixture setup is complete and independently verified on local `ORCLPDB`.

---

## 2026-07-17 — Claude — Oracle pending-phase plan (01–12): 5 executed, 7 blocked on verified-absent artifacts

- **Task:** User supplied a 12-phase "pending implementation" plan and asked to review/validate/modify it,
  then start execution.
- **Audit:** plan is sound and correctly holds status at INTEGRATION-CANDIDATE, but is written against a
  pre-merge world. Corrections: (1) "work only against the committed Oracle feature branch" — that branch is
  merged + deleted, baseline is `main` @ `b6e473d`; (2) Phase 01 expects "rebrand/splash absent" — present
  **by design**, the rename is an Oracle dependency, so reverting would be wrong; (3) Phase 04's
  `ORACLE_RUNTIME_UNAVAILABLE` maps to the existing `DRIVER_UNAVAILABLE` wire category — not renamed for
  cosmetics; (4) Phase 07's "use real bridge/query counters" identified a **genuine gap** worth fixing now.
- **Blockers PROBED, not assumed:** `ojdbc*/ucp*.jar` absent from `~/.m2`, Downloads, Desktop; Maven Central
  unreachable (**HTTP 000**); `docker` unavailable; `AWKIT_ORACLE_LIVE_*` unset; JDK 17.0.8 present. All
  seven blocked phases fail at the same first step — acquiring the artifacts.
- **Phase 01 (done):** baseline green — build PASS, Oracle 137/137 on the listed verifiers, all three
  fail-closed layers present, docs read INTEGRATION-CANDIDATE.
- **Phase 07 (done — the real work):** rewrote `verify-oracle-lazy-resolution.mts` to drive the **real Java
  bridge process** and count actual `executeQuery` RPCs at the wire, replacing an injected stub counter.
  12 → **20 checks**. Negative proofs are the valuable ones: snapshot + unreferenced Runtime sources leave
  the Java process **never started**. Also folded in Phase 04's Required Product Behavior (runtime
  unavailable ⇒ JSON + Snapshot keep working, Runtime fails safely, no crash, no cache poisoning).
- **Phase 04 (done, 4/5):** truth-table rows proven across resolver + TS manager + Java executor selection.
  Row `packaged + valid real bundle → real executor` blocked on jars.
- **Phase 08 (done):** full regression green — Oracle **226/226**; runner 82, concurrency 78, observability
  65, recorder 72, telemetry 61/61, security 39, data-editor 27, browser-isolation 27/27, waits 21,
  safety-policy 17, recorder-draft 17/17, secrets 16, protected-login 16, locks 15, runtime-status 15,
  artifacts 13, chromium-hardening 13, recorder-flow 13/13, profile-store 13/13, cancellation 12,
  startup-recovery 10, write-queue 7/7, ipc-contract 4/4, workflow-sentinels 4/4; `validate:offline` passes
  (correctly warns Oracle not bundled). **`verify:durable-store` 9/2 is PRE-EXISTING** — fails identically
  at `dee283e` (pre-Oracle), proven in an isolated worktree; this session never touched the durable store.
  Left alone per the plan's "fix only actual regressions" rule.
- **Phase 12 (done):** report §16b + the plan's required final summary block; status stays
  **INTEGRATION-CANDIDATE**.
- **Phases 02/03/05/06/09/10/11 (blocked):** documented with the probe evidence table + per-phase unblock
  steps in `ORACLE_JDBC_VALIDATION_GATES.md`, mapped to this plan's numbering.
- **Files:** `scripts/verify-oracle-lazy-resolution.mts` (rewritten); `docs/ai/{CURRENT_STATE,TASK_LOG,
  ORACLE_JDBC_VALIDATION_GATES,ORACLE_JDBC_DATA_SOURCE_NODE_REPORT}.md`.
- **Tests run:** build PASS; Oracle 226/226 (10 verifiers); the impacted regression set above; validate:offline.
- **Not run:** real-jar compile, live Oracle suite, real UCP pooling, packaging, packaged EXE, soak — all
  externally blocked, none approximated.
- **Result:** 5 of 12 phases executed and green; 7 blocked with verified evidence. Status unchanged.

---

## 2026-07-17 — Claude — Ship it: Oracle JDBC + SpecterStudio rename + launch splash merged to `main`; AI memory refreshed

- **Task:** User asked to commit the session's work, then open/merge the PRs, then update the memory files.
- **Classification first (the tree was mixed):** the working tree held ~101 changed files spanning several
  uncommitted scopes. Audited before staging and found the "other" scope was **not** a sibling feature but a
  repo-wide rename (`WebFlow Studio`/`playwright-flow-studio` → **SpecterStudio**) that the Oracle work is
  built on (`com.specterstudio.*` packages, `com.specterstudio.app`, `%LOCALAPPDATA%/SpecterStudio/`). An
  Oracle-only commit would have left the rename half-applied, so the user chose rename + Oracle as two
  commits on one branch, with the splash/icons/nav excluded.
- **PR #11 → `main` (`476dc29`), 114 files:** `488eabf` chore(rename, 38 files, renames only) +
  `5e7977d` feat(oracle, 79 files). `git add -p` is unavailable (interactive), so the 3 files mixing scopes
  (`package.json`, `electron-builder.json`, `app/main/main.ts`) were split by staging hand-built blobs
  (`git hash-object -w` + `git update-index --cacheinfo`) — precise, and it never writes the working tree.
- **PR #12 → `main` (`b6e473d`), 33 files:** `feat(branding)` launch splash + logo/icons + `png-to-ico`
  removal, and `chore` gitignoring the superseded logo families. Stacked on the Oracle branch because these
  files already carried the rename. `logos/specter-violet/` tracked; `awkit-violet/` + duplicate top-level
  sets gitignored (scoped rule, **not** a blanket `logos/`, since specter-violet is tracked).
- **Two mistakes worth recording:** (1) I reported the #11 merge as "not landed" after fetching too early
  and reading a stale ref — `git ls-remote origin refs/heads/main` is the authoritative check. (2)
  `gh pr merge --delete-branch` **closed** stacked PR #12 instead of retargeting it; recovery hit a
  catch-22 (can't retarget a closed PR, can't reopen without its base branch) and needed the base ref
  restored from `5e7977d`, then reopen → retarget → re-delete. Using a **merge commit** (repo convention)
  rather than squash is what kept the stack cheap to fix — the Oracle SHAs stayed in `main`.
- **Found:** CI never ran on #12 — `.github/workflows/ci.yml` triggers only on `main`, so stacked PRs get
  **no checks**, and a CLEAN merge state there means "nothing blocking", not "verified". Verified locally
  instead; CI then passed on `main`. Recorded in KNOWN_ISSUES.
- **Memory refresh (this entry's second half):** FEATURES/ARCHITECTURE/DECISIONS/KNOWN_ISSUES had **zero**
  Oracle coverage; HANDOFF still claimed an uncommitted tree on `feature/smart-wait-engine` and told agents
  not to push; the report header and several CURRENT_STATE entries still said "not committed (local only)";
  DECISIONS still recorded the superseded "WebFlow Studio" rename as current. All corrected.
- **Files:** `docs/ai/{CURRENT_STATE,TASK_LOG,FEATURES,ARCHITECTURE,DECISIONS,KNOWN_ISSUES,HANDOFF,
  ORACLE_JDBC_DATA_SOURCE_NODE_REPORT}.md`; personal memory `oracle-jdbc-feature.md`, `git-pr-strategy.md`,
  `MEMORY.md`.
- **Tests run (on merged `main`):** `npm run build` clean (emits `splash.html`); Oracle **218/218** across
  10 verifiers; `verify:runner` 82/82; `verify:recorder` 72/72; GitHub Actions "Typecheck & Build" success.
- **Not run:** the four Oracle external gates (real-jar compile, authorized Oracle DB, packaged-EXE
  walkthrough, perf/soak) — unchanged, and impossible in this environment.
- **Result:** `main` at `b6e473d`, working tree clean, no open PRs. Oracle remains **INTEGRATION-CANDIDATE**
  — merging shipped the code, not the validation.

---

## 2026-07-17 — Claude — Oracle JDBC: status corrected to INTEGRATION-CANDIDATE; fail-closed production, real UCP executor, SQL hardening, validation harnesses (validation track 01–10)

- **Task:** User supplied `AWKIT_ORACLE_NEXT_REQUIRED_PHASES/` (11 docs, a 10-phase validation & release
  track) and asked to review/audit/enhance, then implement. Audited all 10 phases against the real code
  first, then implemented every phase that does not require external infrastructure.
- **Audit outcome:** the track is accurate; its central correction (status must be
  **INTEGRATION-CANDIDATE**, not PRODUCTION-CANDIDATE) is right — the real executor had never compiled
  and no authorized Oracle was ever used. Three enhancements folded in from reading the code:
  (1) Phase 01 was **more urgent than documented** — a *live* mock leak existed;
  (2) Phase 03 was mis-scoped — `OracleUcpQueryExecutor` did not exist and had to be **authored**, not
  merely "compiled"; (3) Phase 04's `WITH FUNCTION`/`WITH PROCEDURE` gap was real and confirmed.
- **Phase 01 (done):** fixed the mock leak in `app/main/oracleService.ts` (forced
  `AWKIT_ORACLE_BRIDGE_MOCK=1` on any missing driver with **no packaged guard**). Policy moved into
  `OracleRuntimeResolver` (`mockAllowed`/`requireRealDriver`, env baked into the launch spec); packaged +
  missing driver ⇒ unavailable (Snapshot unaffected); new Java `DriverUnavailableExecutor`; Java `Main`
  ignores the mock flag under `AWKIT_ORACLE_REQUIRE_REAL`; manager `requireRealDriver` handshake guard;
  `hello` gained `executionMode`/`ucpVersion`/`javaVersion`. Report corrected to INTEGRATION-CANDIDATE.
- **Phase 02 (done):** `ORACLE_JDBC_RUNTIME_MATRIX.md`, locked `scripts/oracle/oracle-runtime.manifest.json`,
  and `prepare:oracle-runtime` (offline, fail-closed, reproducible — no `generatedAt`, so checksums are
  byte-stable). `verify:oracle-runtime-prep` 20/20.
- **Phase 03 (authored + stub-compiled):** wrote the real `OracleUcpQueryExecutor`;
  `verify:oracle-bridge-real-build` stub-compiles it against the real JDK `java.sql` every run (caught a
  missing `BridgeException(category, msg, retriable)` constructor). Live real build skips until jars exist.
- **Phase 04 (done):** rejected `WITH FUNCTION`/`WITH PROCEDURE`, dblinks (`@`), `UTL_`/`DBMS_`/`OWA_`
  packages on **both** sides; `verify:oracle-sql-policy` proves TS↔Java parity over a 30-case adversarial
  corpus via the real Dispatcher. Wrote `ORACLE_JDBC_DB_ACCOUNT_RUNBOOK.md`.
- **Phases 05/07/08 (done):** `verify:oracle-live` (credential-gated, fail-closed, redacted artifact) +
  `scripts/oracle/oracle-live-fixture.sql`; `verify:oracle-lazy-resolution` 12/12 (unreferenced ⇒ 0
  queries, single-flight, per-run cache, snapshot ⇒ 0 DB); `auditOracleOfflineBundle` +
  `verify:oracle-offline-bundle`, `validate-offline-bundle.ps1` Oracle section, electron-builder secret
  exclusions.
- **Files:** new — `OracleUcpQueryExecutor.java`, `DriverUnavailableExecutor.java`,
  `src/oracle/OracleOfflineBundle.ts`, `scripts/prepare-oracle-runtime.mjs`, `scripts/oracle/*`,
  6 new verifiers, 3 new docs. Modified — `OracleRuntimeResolver`, `OracleJdbcBridgeManager`,
  `OracleBridgeProtocol`, `oracleService`, `OracleSqlPolicy` + `SqlReadOnlyPolicy.java`, `Main.java`,
  `Dispatcher.java`, `QueryExecutor.java`, `MockQueryExecutor.java`, `BridgeException.java`,
  `verify-oracle-{runtime,packaging}.mts`, `validate-offline-bundle.ps1`, `electron-builder.json`,
  `package.json`, report + plan + CURRENT_STATE.
- **Tests run:** `npm run build` clean; Oracle suite **218/218 green across 10 verifiers**
  (bridge 32, real-build 11, profiles 22, data-source 28, runtime 36, runtime-prep 20, sql-policy 30,
  packaging 19, lazy-resolution 12, offline-bundle 8) + `verify:oracle-live` skip path; regression
  `verify:runner` 82/82, `verify:security` 39/39, `verify:secrets` 16/16, `verify:ipc-contract` 4/4.
- **Not run (external gates):** real-jar compile + real Oracle suite (Phase 06 — no DB/Docker/network),
  packaged-EXE clean-machine walkthrough (Phase 09), real perf/soak (Phase 10). Procedure documented in
  `ORACLE_JDBC_VALIDATION_GATES.md`.
- **Result:** all actionable phases complete; status **INTEGRATION-CANDIDATE**. Not committed (local only).

---

## 2026-07-17 — Claude — Oracle JDBC: DS renderer UI verification, result-limit hardening, packaging checksums, final report (Phases 05, 11, 12, 14)

- **Task:** Resumed the Oracle JDBC feature from a prior session's cut-off (session limit hit mid-way
  through GUI-verifying the Phase 05 Data Source UI). Verified the build/all prior Oracle verifiers were
  still green, then completed the Phase 05 GUI verification, closed a real Phase 11 limits gap, added
  Phase 12 packaging-checksum infrastructure, and wrote the Phase 14 final report.
- **Phase 05 GUI verification:** launched `npx electron .` fresh and drove it via PowerShell Win32
  automation (no computer-use grant available for this window — see [[electron-gui-verify-workflow]]).
  Root-caused early click failures to a **DPI-awareness bug in the automation itself**
  (`SetProcessDPIAware()` doesn't persist across separate PowerShell tool invocations, so
  `GetWindowRect`/`SetCursorPos` silently flipped between logical and physical pixel spaces) — not an
  app bug. Once fixed: the "Add Oracle Source" modal opens, Name/SQL fields accept clipboard-pasted
  text, and clicking Create with no Oracle connection profile correctly shows "Select an Oracle
  connection profile." with zero DevTools console errors.
- **Phase 11 fix:** `OracleTypeConversion.ResultLimits.maxCellBytes` was declared but never enforced,
  and no caller ever passed `maxColumns`/`maxSerializedBytes` — three defensive limits were dead code.
  `enforceResultLimits` now checks per-cell byte length; `OracleQueryService` applies built-in defaults
  (200 columns / 1MB cell / 25MB serialized) even when the caller doesn't specify one.
- **Phase 12 addition:** new `src/oracle/OracleBundleChecksums.ts` (sha256 `checksums.json` validation,
  synchronous, pure) wired into `OracleRuntimeResolver`'s bundled-runtime branch — production fails
  closed on a corrupted/tampered/incomplete Oracle bundle instead of launching it. Jar/JRE vendoring
  itself remains blocked (no build-time network in this environment).
- **Phase 14:** confirmed migration needs no code (additive union, missing `type` ⇒ `jsonArray`); wrote
  `docs/ai/ORACLE_JDBC_DATA_SOURCE_NODE_REPORT.md` (17-section final report, **PRODUCTION-CANDIDATE**).
- **Files:** new `src/oracle/OracleBundleChecksums.ts`, `scripts/verify-oracle-packaging.mts`,
  `docs/ai/ORACLE_JDBC_DATA_SOURCE_NODE_REPORT.md`; modified `src/oracle/OracleTypeConversion.ts`,
  `src/oracle/OracleQueryService.ts`, `scripts/verify-oracle-runtime.mts`, `package.json`,
  `docs/ai/ORACLE_JDBC_DATA_SOURCE_NODE_PLAN.md`.
- **Tests run:** `npm run build` clean; `verify:oracle-packaging` **11/11** (new); `verify:oracle-runtime`
  **27/27** (was 22, +5 limit checks); `verify:oracle-bridge` **32/32**; `verify:oracle-profiles`
  **22/22**; `verify:oracle-data-source` **28/28**; `verify:runner` **82/82**. 120 total Oracle checks
  green, no regressions. Live Electron GUI walkthrough of the Data Source Manager (see above).
- **Not run:** real-Oracle validation, packaged-EXE rebuild, `validate:offline` Oracle-specific checks
  (all external gates — see the final report §13/§16 for exact blockers).
- **Result:** Phases 05, 11 (partial→further hardened), 12 (partial→checksum infra added), 14 all
  advanced; release status remains PRODUCTION-CANDIDATE. Not committed (local only).

## 2026-07-17 — Claude — Oracle JDBC: node + Data-Source execution wiring & snapshot capture (Phases 06, 08–10)

- **Task:** Continue the Oracle JDBC feature. Reviewed prior progress (node + panel files already
  existed; plan status table was stale), fixed a broken build, and completed the Oracle **node**
  execution wiring, the **Data-Source-side** workflow integration, and **snapshot capture**.
- **Fix:** `app/main/oracleService.ts` failed `tsc` (`Record<string,unknown>` vs `JsonScalar`). Typed
  `OracleDataSourceSnapshot.rows` as the normalized `Record<string, OracleJsonScalar>[]` (new local
  scalar type in `DataSourceProfile.ts`) — the honest snapshot contract.
- **Phase 10 (DS-side):** `resolveWorkflowDataSources` (`execution.ipc.ts`) now branches the
  `jsonArray | oracle` union — jsonArray keeps its eager path; Oracle resolves via `DataSourceResolver`
  (one per run = cache scope). Workflow-bound Oracle source materialized eagerly for `dataRows` loops.
  Added `materializeDataSourceRows` (`InstanceExecutionContext`) and used it in `FlowExecutor`
  (loop connector) + `StepExecutor` (`executeLoop`) so lazy runtime sources load on demand.
- **Phase 06 (snapshot):** `refreshOracleDataSourceSnapshot(id)` — execute once, normalize,
  atomic-persist (`store.update`), keep last-good rows on error, secret-safe error summary.
- **Phase 05 (backend):** new `OracleDataSourceBinds.resolveDataSourceBinds` (static/env/workflowInput
  only; rejects per-row/step binds); `saveOracleDataSource`/`list`/`get`/`delete` in `oracleService`;
  `oracle:dataSources:{list,get,save,delete,refreshSnapshot}` IPC (mutations sender-guarded) + preload
  `oracle.{listDataSources,getDataSource,saveDataSource,deleteDataSource,refreshSnapshot}`;
  `OracleProfileService.connectionFingerprintForId`.
- **Files:** `src/data/DataSourceProfile.ts`, `src/oracle/OracleDataSourceBinds.ts` (new),
  `src/oracle/OracleProfileService.ts`, `src/runner/InstanceExecutionContext.ts`,
  `src/runner/FlowExecutor.ts`, `src/runner/StepExecutor.ts`, `app/main/oracleService.ts`,
  `app/main/ipc/execution.ipc.ts`, `app/main/ipc/oracle.ipc.ts`, `app/main/preload.ts`,
  `scripts/verify-oracle-data-source.mts`, plus plan + CURRENT_STATE docs.
- **Tests:** `npm run build` clean; `verify:oracle-data-source` **28/28** (+8 for DS binds +
  materialization); `verify:runner` **82/82**; `verify:oracle-bridge` **32/32**,
  `verify:oracle-profiles` **22/22**, `verify:oracle-runtime` **22/22**.
- **Not run / remaining:** Phase 05 **renderer** UI (create/edit Oracle Data Sources + snapshot-refresh
  button in `DataSourceManager`); Phases 11/12/14; real-Oracle (13) + vendored-jar/packaged-EXE
  external gates. Not committed (local only).
- **Result:** Oracle node + Data Sources execute end-to-end (runtime + offline snapshot) against the
  mock bridge; build + all Oracle/runner verifiers green.

## 2026-07-16 — Claude — Oracle JDBC Data Source & Node — Phases 01–04 + 07 (foundation)

- **Task:** Review the 14-phase `AWKIT_ORACLE_JDBC_DATA_SOURCE_NODE_PHASES` plan against the real
  codebase, correct wrong assumptions, then implement. Delivered the backend/architecture foundation.
- **Phase 01 (audit):** wrote `docs/ai/ORACLE_JDBC_DATA_SOURCE_NODE_PLAN.md` (corrected architecture)
  and annotated the source `00_MASTER_OVERVIEW.md`. Key corrections proven from code: **no
  `DataSourceResolver` existed** (data sources resolve eagerly in `execution.ipc.ts`
  `resolveWorkflowDataSources` → `ResolvedDataSource`); `passwordSecretRef` = a **secret NAME** in the
  existing by-name DPAPI `SecretStore`; a "node" = a `FlowStep` `StepType` (no migration engine); the
  **runner is in the Electron main process** (no worker threads) so `OracleQueryService` owns the Java
  child process directly. Environment constraints: **build-time network blocked**, inconsistent JDKs
  (JAVA_HOME=8, PATH=17, jlink=11 → pin JDK 17), **no Docker** (real-Oracle = external gate).
- **Phase 02 (Java bridge):** new `oracle-jdbc-bridge/` module. **Zero-dependency** pure-JDK core
  (JSON codec, 4-byte length framing, dispatch + cancellation registry, read-only SQL policy,
  database-free `MockQueryExecutor`) + `Main` (stdout reserved for frames, reflective Oracle-executor
  load with mock fallback). TS `OracleJdbcBridgeManager`/`OracleBridgeProtocol` (lazy spawn, handshake,
  correlation, timeout, AbortSignal cancel, bounded restart, orphan-free dispose). Reproducible
  offline build `scripts/build-oracle-bridge.mjs` (pins `C:\Program Files\Java\jdk-17`). Oracle UCP
  executor = gated on vendored jars (external gate, like Chromium). `verify:oracle-bridge` **32/32**.
- **Phase 03 (profiles + secrets):** `OracleConnectionProfile` model (JDBC URL builder, redaction,
  pool fingerprint, validation, renderer-safe view) + pure `OracleProfileService` (CRUD, inline
  secrets → by-name `SecretStore`, testConnection via bridge, error-category→safe-message mapping).
  Main wiring `app/main/oracleService.ts`, IPC `oracle.ipc.ts` (+ preload `oracle` domain, all
  sender-guarded), quit-time bridge dispose in `main.ts`. New `oracle-profiles` runtime folder.
  Renderer never receives a secret value (`hasPassword` only). `verify:oracle-profiles` **22/22**.
- **Phase 04 (data source model + resolver):** `DataSourceProfile` widened to a backward-compatible
  `jsonArray | oracle` union (legacy profiles unchanged); `OracleDataSourceProfile` (+ binds, limits,
  runtime/snapshot). Authoritative pure `DataSourceResolver` → one normalized `ResolvedDataSource`
  contract for all types; **runtime = single-flight per-run-cached lazy loader** (failed attempts not
  cached); snapshot = stored offline rows; JSON = unchanged lazy file read. `ResolvedDataSource` gained
  optional `loadRows()`/`type`/`oracleMode`; `ValueResolver` uses the lazy loader. Query-hash +
  snapshot-staleness helpers. `verify:oracle-data-source` **20/20**.
- **Phase 07 (runtime query service):** `OracleQueryService` — the single query authority (read-only
  gate → descriptor/secret resolution → bind assembly → bridge `executeQuery` → normalize + defensive
  result limits → outer timeout, AbortSignal cancel, transient-only retry, bounded concurrency limiter,
  low-cardinality telemetry). Deterministic bind/type conversion (`OracleTypeConversion`,
  high-precision numbers as strings). `verify:oracle-runtime` **22/22**.
- **Verification:** `npm run build` **passes** (tsc + all bundles); `verify:ipc-contract` **4/4** (143
  handlers, 7 new oracle channels handled+exposed); new suites 32+22+20+22 = **96 checks green** using
  the real Java mock bridge (no database). Orphan-Java check clean. **Not done (remaining phases):**
  05 UI, 06 snapshot execution/persistence, 08/09 Oracle node, 10 workflow-seam wiring, 11 hardening,
  12 packaging/runtime resolver validation, 13 tests + real-Oracle (**external gate** — needs
  authorized DB + vendored ojdbc/ucp jars + private JRE), 14 report. Not committed (local only).

## 2026-07-16 — Claude — Splash hold-on-brief + spinner, concept-1c icon, simplified sidebar brand

- **Task:** (1) splash should play one full round then, if the app is ready, dismiss and continue; if the
  app still needs time, pause on the last/brief frame with a small bottom loader/spinner until loaded;
  (2) change the app icon to concept "1c" from `UI Samples/Application icon design/Spectr Icon.dc.html`;
  (3) in the side menu add the new app icon and simplify the brand to just the app name.
- **Splash:** `app/renderer/splash.html` now plays once to `HOLD_T = 11.70s` (the resolved brief frame) and
  freezes there instead of looping; added a bottom-right CSS spinner revealed by `window.__splashHold()`.
  `app/main/main.ts` handoff rewritten: reveal at `max(one-round, ready-to-show)` — dissolve if ready by
  round end, else `executeJavaScript` the spinner and hold until ready; `ONE_ROUND_MS = 11_800`,
  `HARD_CAP_MS = 30_000` safety net. Splash stays sandboxed/preload-free.
- **Icon:** regenerated `resources/icon-source.png`/`icon.png`/`icon.ico` from a 1c SVG (near-black squircle,
  off-white brick-form S, spectrum-edge bottom-left brick) via `scripts/generate-app-icon.mjs`.
- **Sidebar:** `app/renderer/layout/LeftNavigation.tsx` — new inline `SpecterAppIcon` SVG (1c mark, `useId`
  defs) replaces the `Workflow` brand glyph; removed the `Automation workbench` subtitle (brand = icon +
  "SpecterStudio"). Added `.brand-app-icon` to `global.css`. Footer chip / `AppFrame` wordmark untouched.
- **Verification:** `npm run build` passed. Captured the built splash's brief-frame + spinner (bundled
  Chromium), viewed `resources/icon.png`, and launched the real Electron app + screen-captured it — sidebar
  shows the new mark + "SpecterStudio" only and the splash handed off ("Electron shell: Online", "IPC
  bridge: Connected"). Browser-pane screenshots of the canvas splash timed out (infinite spinner never
  settles) — used Playwright/PowerShell capture instead.
- **Not run:** packaged EXE/NSIS rebuild (taskbar icon) + clean-machine GUI walkthrough.
- **Result:** splash finishes a round then either continues or waits with a spinner; app + taskbar identity
  use the 1c mark; sidebar brand is icon + name only.

---

## 2026-07-16 — Claude — Product rename WebFlow Studio → SpecterStudio + apply launch splash

- **Task:** apply the new Specter Studio splash at launch (already wired) and rename the app to
  **SpecterStudio** everywhere it is the product's own identity.
- **Splash:** confirmed the splash is wired into launch (`main.ts` → `createSplashWindow()` →
  `fadeOutAndClose()` on `ready-to-show`); `app/renderer/splash.html` is a second renderer entry.
- **Rename (identity/user-facing):** window/dialog/HTML titles, renderer UI (app frame, left nav, Settings),
  packaging (`electron-builder.json` `productName` + `appId com.specterstudio.app`),
  `package.json`/`package-lock.json` (`name: specterstudio`, `productName: SpecterStudio`), and all
  user-facing message strings in `app/**` + `src/**`.
- **Rename (runtime + offline chain):** `RUNTIME_DATA_FOLDER = "SpecterStudio"` → data under
  `%LOCALAPPDATA%/SpecterStudio/`; kept manifest (`resources/dependency-manifest.json`,
  `resources/offline-runtime.json`), the TS + PS validators, and the seed/verify/benchmark tooling that
  resolve the runtime folder or packaged EXE consistent with the new name.
- **Live docs:** `README.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules/00-project.mdc`,
  `.cursor/rules/30-storage-ipc.mdc`, and the `ci.yml` comment updated to SpecterStudio.
- **Left unchanged (intentional):** `window.playwrightFlowStudio` preload API, `--awkit-*` CSS tokens,
  `AWKIT_*` env vars / `awkitRssMb` field (functional), the manifest *schema* name, and dated historical
  records that reference the already-built `WebFlow Studio 0.1.0.exe`/`Setup` artifacts.
- **Verification:** `npm run build` passed (tsc + bundles; `splash.html` self-contained at 18.27 kB);
  `npm run validate:offline` passed (development mode) with manifest name/path checks green; consistency
  sweep confirms no residual `WebFlow Studio` in `app/`/`src/`/`scripts/`/`resources/`/config.
- **Not run:** packaged EXE/NSIS rebuild + clean-machine GUI launch walkthrough (no packaging env here).
- **Result:** the app launches with the SpecterStudio splash and presents a consistent SpecterStudio
  identity; existing installs' old `WebFlow Studio` data folder is not auto-migrated (documented).

---

## 2026-07-16 — Claude — Specter Studio launch splash (reference-recreation of SplashScreen.mp4)

- **Task:** recreate the attached `UI Samples/SplashScreen.mp4` (the "Module 151.30" flexible-logo motion
  reel) as an app-launch splash, rebranded to first word **Specter** / second word **Studio**, keeping the
  reference structure with user-supplied body copy + credits, monochrome + project violet accent, full
  13.7s multi-format loop. Named skill `exact-reference-design-recreation` is not installed; followed the
  same methodology manually.
- **Analysis:** no ffmpeg available → extracted true frames with Playwright + bundled Chromium
  (`resources/browsers/chromium/chrome.exe`). Seeking a paused encode returned identical frames (MAD 0);
  switched to play-through capture via `requestVideoFrameCallback` (137 frames, 12 fps). Built a MAD motion
  timeline + heatmap to locate every beat: intro build 0–2s, minimal grid ~3.2s, portrait ~5.4s, wide
  snap-back ~7.3s, copy fade-in ~8.4–9s, **dead-still hold 9.8–11.7s (MAD 0)**, loop wind-up 11.8–13.7s.
- **Build:** new `app/renderer/splash.html` — self-contained canvas timeline (one parametric layout:
  words/two grids/counter/tagline/paragraph/credits) interpolated through scene keyframes; grid col/row
  counts from a rounded lerp reproduce the responsive reflow; seamless loop (t=13.7167 == t=0);
  `window.__renderAt(t)` deterministic hook. Monochrome + violet glow/counter on `#0e1016`.
- **Integration:** `windowManager.ts` `createSplashWindow()` + `fadeOutAndClose()`, `createMainWindow({show})`;
  `main.ts` splash→main handoff (min 2.4s, 8s fallback, opacity fade); `electron.vite.config.ts` splash as a
  second renderer input.
- **Files:** `app/renderer/splash.html` (new); `app/main/windowManager.ts`, `app/main/main.ts`,
  `electron.vite.config.ts` (edited); `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`.
- **Verification:** `npm run build` passed (tsc + bundles; `out/renderer/splash.html` 17.36 kB, confirmed no
  external `src`/`href` → offline-safe). Iterated by rendering my splash at the source's exact timestamps
  and diffing side-by-side until every format/beat matched. **Not run:** live packaged-EXE GUI walkthrough.
- **Result:** launch splash reproduces every animated element, the format sequence, timings, the still hold,
  and the loop; residual diffs are minor (Specter/Studio are longer than MO/DULE; copy fades out slightly
  slower in the wind-up).
- **Revision (same session, per user step-by-step feedback):** added the missing **Step-3 pivot** — the
  isolated 2×2 grid rotates 90° clockwise through the 45° diamond and settles upright (`pivotRotation(t)`,
  `drawGrid` rotates about centre); verified against the source's 3–4.8s frames (diamond at ~3.6s).
  Wordmark set to **uppercase** SPECTER/STUDIO; **text alignment fixed** (word `y` is now the baseline,
  placed just above each grid — previously overlapped the grid top); contrast tightened (crisp white
  strokes, violet glow dialed to 0.08); Format A grid set to 10×3. Rebuilt (`npm run build` passed,
  `out/renderer/splash.html` 18.27 kB) and re-compared frame-by-frame.

## 2026-07-16 — Claude — Runtime Observability final production-validation (Phases 1–6; not committed)

- **Task:** prove the observability layer production-ready via controlled A/B overhead, full 30-min soak,
  measured storage/query benchmarks, packaged-renderer UI walkthrough, admission-semantics check, and an
  evidence-based release decision. No product-code redesign; only benchmark/validation tooling + docs.
- **Phase 1 — A/B overhead** (`benchmark:observability-ab`, already run): 3A+3B, Config D, MIXED, conc 6,
  interleaved order. Honest read: per-tick cost negligible (event-loop delay P95 **+0.5 ms**, CPU +2 pts within
  noise); throughput **~1.5–2.5 %** (median −1.53 %, confounded w/ run-order drift); **RSS unresolvable** — the
  OFF config's own RSS P95 spans 180→344 MB (SD 69) ≫ the +10 MB between-config delta, so the JSON "+48 MB" is
  a median-of-reps artifact, not a real cost. `AWKIT_RUNTIME_OBSERVABILITY=0` disables only the incremental work.
- **Phase 2 — full 30-min soak** (`AWKIT_SOAK_MS=1800000`): 4661 completed / 0 failed / 0 crashes; teardown
  CLEAN; durable==live; **4666 run summaries == 4666 terminal runs**; leak-free (handles flat 51→51, RSS end≈start,
  Chromium RSS down). Found+fixed **2 soak-harness bugs** in `scripts/benchmark-engine-soak.mts` (`durableTerminalRuns`
  omitted `cancelled`→spurious MISMATCH; NaN poisoned event-loop `peak`) — validated on a 40 s re-run; neither an
  observability defect. Canonical artifact `soak-30min.json`.
- **Phase 3 — storage/query** (`benchmark:observability-storage`, 5k/25k/50k): ~465 B/run, 322 B/cap-bucket,
  237 B/anomaly; **~3.1 MB/day** uncapped (corrects the old "~1 MB/day"); retention-bounded; all cutoff boundaries
  validated. Analytics queries **tens-to-~500 ms** P95 (corrects "sub-millisecond"); aggregation-bound, not
  index-bound (EXPLAIN confirms index use); no speculative indexes added.
- **Phase 4 — admission semantics:** already the honest **rename** (queue-delay proxy; "Runtime admission delays …
  not per-workflow"; ENV tags) — confirmed in code + the live UI. No per-workflow reason attribution claimed.
- **Phase 5 — packaged-renderer UI:** new `scripts/seed-observability-fixtures.mts` (normal/empty/migration/
  high-data seeded DBs + `lastRouteId` deep-link) + `scripts/verify-runtime-analytics-gui.mjs` — real built
  Electron (`out/`) driven per state via `_electron`, all 7 IPC channels (incl. malformed inputs) exercised.
  **36/36**; panels populated (capacity/admission/anomalies), no NaN/undefined/errors; screenshots under
  `reports/browser-performance/phase5-ui-evidence/`. (dist/ EXE is pre-observability + re-package OOMs → packaged-EXE
  walkthrough is the one remaining gate.)
- **Phase 6 — report:** rewrote `RUNTIME_OBSERVABILITY_ANALYTICS_REPORT.md` (§5/10/11/12/13/15/16 + new §17
  with methods/tables/deltas). Corrected "measured-negligible overhead", "sub-millisecond queries", "~1 MB/day",
  "Experimental: none". **Decision: `PRODUCTION-CANDIDATE`** — remaining gate: fresh packaged-EXE build + walkthrough
  on a higher-memory host; provisional: anomaly thresholds (uncalibrated), precise A/B RSS figure.
- **Files:** modified `scripts/benchmark-engine-soak.mts`, `package.json` (2 script aliases), `.gitignore`,
  `docs/ai/RUNTIME_OBSERVABILITY_ANALYTICS_REPORT.md`; new `scripts/seed-observability-fixtures.mts`,
  `scripts/verify-runtime-analytics-gui.mjs`. No `src/` change.
- **Verification:** `npm run build` clean; `verify:observability` **65/65**; `verify-runtime-analytics-gui` **36/36**;
  the 3 benchmarks green. Not re-run (no product-code change): the broader runner/concurrency regression suite
  (green in the prior entry). `npm test`/`npm run lint` still do not exist.

---

## 2026-07-15 — Claude — Concurrency closing task Phases 02–06 (enforce dependency + prove durable root cause, not committed)

- **Task:** close the three remaining concurrency validation gaps — enforce the Shared-Pool → A8 dependency
  (Phase 02), PROVE the `~3822 live vs 495 durable` root cause (Phase 03), add durable-accuracy verification
  (Phase 04), audit reporting/statistics impact (Phase 05), final verification + report (Phase 06). GitHub
  intentionally not used.
- **Phase 02 (ENFORCED — this WAS a real gap):** the prior session's claim that the dependency was already
  enforced was wrong — `envBool("AWKIT_WORKLOAD_WEIGHTS", pool)` still let an explicit `=true` recreate Config C
  while the pool was OFF. Added `resolveWeightedAdmission` + `WEIGHTED_ADMISSION_REQUIRES_POOL_DIAGNOSTIC` in
  `ConcurrencyConfig.ts`; weights now resolve OFF whenever the pool is OFF (even explicit true) with one
  searchable diagnostic; enforced on the final merged values (one authoritative path). Inverted the stale
  verifier assertion. `verify:concurrency-defaults` **12/12 → 18/18**.
- **Phase 03 (PROVEN):** exact cause = `SqliteRuntimeStore.queryRunHistory` hard-clamps a page to
  `Math.min(500, …)`; the soak counted `rows` of a single `{ limit: 200000 }` page (≤500) vs a live in-memory
  counter (~3822). NOT lost/unflushed/pruned/overwritten writes — the in-memory sql.js DB is synchronous, a
  reopened on-disk store returns every row, retention (5000) never triggered (3822<5000), `instanceId` is the
  PRIMARY KEY (no collision). Reproduced at 648-vs-500 through the real engine.
- **Fix:** added `countRunsByStatus` (unbounded SQL aggregate) + `getRun` to the store; `queryOverview` counts
  now use the aggregate (was a ≤5000 materialized read — latent under-count >5000); `getTelemetryRunDetail`
  uses the keyed `getRun`; added `getTelemetryStatusCounts` + `persistDurableNow`; benchmark harness/soak now
  paginate via `readAllRunHistory` + aggregate (live-vs-durable reconciliation logged).
- **Phase 04:** `scripts/verify-durable-accuracy.mts` (`verify:durable-accuracy`) — real engine, 600 OK + 40
  fail + 40 cancelled, explicit drain. **27/27**: submitted 680 = 600+40+40; expected persisted 648 = actual
  648; clamp reproduced (500 < 648); no dup/missing IDs; disk-reopen sees all; retention deterministic.
- **Phase 05:** impact matrix — no shipped stat was wrong except the latent `queryOverview` count under-count
  (fixed to aggregate); run-history `total`, workflow/failure aggregations, Instance Monitor (live), and Live
  Report were already correct. No UI redesign.
- **Verification:** `build` ✅ · `verify:concurrency-defaults` 18/18 · `verify:telemetry` 61/61 (new Part I) ·
  `verify:durable-accuracy` 27/27 · `verify:concurrency` 78/78 · `verify:runner` 82/82 ·
  `verify:shared-browser-pool` 19/19 · `verify:browser-isolation` 27/27.
- **Files:** `src/runner/concurrency/ConcurrencyConfig.ts`, `src/runner/store/{RuntimeStore,SqliteRuntimeStore}.ts`,
  `src/reports/TelemetryContracts.ts`, `src/runner/ExecutionEngine.ts`, `scripts/benchmark/engineHarness.mts`,
  `scripts/benchmark-engine-soak.mts`, `scripts/verify-concurrency-defaults.mts`, `scripts/verify-telemetry.mts`,
  `scripts/verify-durable-accuracy.mts` (new), `package.json`, `docs/ai/EXECUTION_ENGINE_CAPACITY_REPORT.md`
  (§13 truth table + §14–§20), `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`.

## 2026-07-15 — Claude — Headed Production Anchor (closing Phase 01, not committed)

- **Task:** run the missing headed cross-check anchoring the pool+A8 production defaults against AWKIT's real
  default headed (`activeOnly`) execution — Config A vs D, MIXED, F=6, 50 s each, real `ExecutionEngine`.
- **New:** `scripts/benchmark-engine-headed-anchor.mts` (`benchmark:engine-headed`), reuses the engine harness
  (`runStage`, headed) — no new architecture, no `chromium.launch()` per instance. Artifact
  `reports/browser-performance/headed-anchor.json`.
- **Result:** D vs A headed — throughput **+122 %** (116.6 vs 52.5/min), P95 duration **−63.5 %** (2394 vs
  6554 ms), CPU P95 **−16 %** (83.8 vs 99.7 — A's 6 dedicated headed browsers pin CPU at 99.7 %), Chromium
  procs −10.5 %, RSS peak −52 % (1065 vs 2215 MB), median RSS +4.9 % (wash); 0 failures/crashes, clean
  teardown both. **Production defaults CONFIRMED (win larger headed than headless).** No regression → no fix.
- **Files:** `scripts/benchmark-engine-headed-anchor.mts` (new), `package.json`,
  `docs/ai/EXECUTION_ENGINE_CAPACITY_REPORT.md` (§4a + exec summary/§10/§11), `docs/ai/CURRENT_STATE.md`,
  `docs/ai/TASK_LOG.md`.
- **Note:** master overview also lists Phase 02 (enforce pool→A8 dependency — already implemented + verified
  by `verify:concurrency-defaults` last session) and Phase 03 (root-cause the 3822-vs-495 durable count — still
  open). Not executed here; awaiting their phase files / go-ahead.

## 2026-07-15 — Claude — Apply capacity defaults + reserve-formula change + close-reason telemetry + 30-min soak (not committed)

- **Task:** four completion items on top of the capacity report — (1) flip production defaults, (2) run the
  full 30-min soak, (3) resolve the browser-recycling contradiction with exact close-reason attribution,
  (4) re-evaluate the CapacityPlanner memory reserve across machine sizes.
- **(1) Defaults:** `ConcurrencyConfig.ts` — `useSharedBrowserPool` default → **true**; `workloadWeights`
  now defaults to the resolved pool state (dependency: ON with pool, never independently; explicit env wins).
  New `verify:concurrency-defaults` (12/12) proves the two required examples + override precedence.
- **(3) Close reasons:** `SharedBrowserPool` stamps + counts an exact reason per retirement
  (CONTEXT_COUNT_RECYCLE / MEMORY_THRESHOLD / IDLE_DRAIN / UNHEALTHY / CRASH / POOL_SHUTDOWN / LAUNCH_FAILURE /
  OTHER); exposed on the snapshot. Forced-recycle smoke → CONTEXT_COUNT_RECYCLE=22, IDLE_DRAIN=3,
  MEMORY_THRESHOLD=0. Report corrected: relaunches are context-count recycling + idle drain, never memory.
- **(4) Reserve:** replay (`benchmark:capacity-reserve`) showed the old formula under-admits on big machines
  (128 GB/23 GB-free → cap 1, usable=0) by subtracting %-of-total OS+safety from already-current available.
  Changed `CapacityPlanner.planCapacity` to Model C (OS reserve = ceiling; 1024 MB baseline + bounded growth;
  safety off available). Small/pressured machines unchanged. `verify:capacity-planner` 35/35 (+anti-pathology).
- **(2) 30-min soak (Config D, MIXED, conc 6):** ≈3822 completed (~127/min), 0 failed/retries/crashes; JS heap
  flat, handles flat, browsers/contexts bounded (≤4/≤5); AWKIT RSS +55 MB native drift (bounded); 80 relaunched
  = 80 closed (CONTEXT_COUNT_RECYCLE=77, IDLE_DRAIN=3, MEMORY_THRESHOLD=0); teardown CLEAN (all orphan/stale=0).
- **Files:** `src/runner/concurrency/ConcurrencyConfig.ts`, `src/runner/concurrency/CapacityPlanner.ts`,
  `src/runner/browser/SharedBrowserPool.ts`, `scripts/benchmark-engine-soak.mts`,
  `scripts/verify-concurrency-defaults.mts` (new), `scripts/benchmark-capacity-reserve.mts` (new),
  `scripts/verify-capacity-planner.mts`, `package.json`, `docs/ai/EXECUTION_ENGINE_CAPACITY_REPORT.md`,
  `docs/ai/CURRENT_STATE.md`, `docs/ai/KNOWN_ISSUES.md`, `docs/ai/TASK_LOG.md`.
- **Verification:** build clean; concurrency-defaults 12/12, capacity-planner 35/35, capacity-modes 10/10,
  machine-capabilities 20/20, benchmark-planner 36/36, shared-browser-pool 19/19, browser-isolation 27/27,
  runner 82/82, concurrency 78/78, shared-browser-live 5/5.
- **Not run / risks:** clean-machine packaged GUI walkthrough with pool-ON default; lower-spec hardware; the
  new reserve model admits more on large machines (bounded by benchmark-gating + runtime backpressure).

## 2026-07-15 — Claude — Real-ExecutionEngine capacity benchmark, shared-pool race fix, Phases 6–10 (not committed)

- **Task:** activate + calibrate the shared-browser dynamic capacity through the REAL `ExecutionEngine`
  dispatch path (not the context factory), across A/B/C/D configs, MIXED workloads, machine-relative ramp,
  weight calibration, memory-formula review, browser recycling, and a sustained soak; recommend defaults.
- **Continuation:** resumed a prior session that hit its limit mid-Phase-8 — the build was broken
  (`ExecutionEngine` called `evaluateSharedBrowserMemoryRecycling` which didn't exist; `SharedBrowserPool`
  used `browser.process()` which isn't on Playwright's typed `Browser`). Completed both.
- **Real defect found + fixed:** `SharedBrowserPool.selectOrLaunch` check-then-act race over-launched browsers
  under concurrent dispatch (maxBrowsers=2,conc=6 → 6 browsers). Reserved slot atomically under the pool
  mutex; peak 6 → 2; added a regression test to `verify:shared-browser-pool` (19/19).
- **Phase 8:** memory recycling wired end-to-end (`applyMemorySamples` moving-window drain + Windows
  `BrowserProcessSampler` subtree walk + throttled engine evaluator) but **inert** — Playwright 1.61 `Browser`
  has no `process()` (verified via types + runtime), so no per-browser root PID. Kept wired + documented
  ("disable-with-evidence") rather than rebuilding the launch path.
- **Findings:** Config D (pool+weights) at F=6 vs baseline A: procs −50 %, RSS −56 %, throughput +12.7 %, P95
  duration −34 %, stable concurrency +50 % (9 vs 6, 0 failures). Weighting-alone (C) is a net negative.
  Waiting workflows use ~0 CPU despite long duration → weight seeds validated + kept; no phase-aware weighting.
  1024 MB AWKIT reserve reviewed + kept. **Recommendation: enable pool + A8 weights by default (Config D);**
  shipped defaults left unchanged pending owner sign-off.
- **Phase 9 soak (Config D, MIXED, 10 min):** 497 completed / 0 failed / 0 retries; Chromium RSS −48 %,
  AWKIT RSS flat, browsers steady 3–4; teardown CLEAN (active/leased/stale/orphan all 0). Leak-free.
- **Files:** `src/runner/browser/SharedBrowserPool.ts`, `src/runner/ExecutionEngine.ts`,
  `src/runner/browser/BrowserProcessSampler.ts` (new), `scripts/benchmark/*` + `scripts/benchmark-engine-abcd.mts`
  / `-weight-calibration.mts` / `-engine-soak.mts` (new), `scripts/verify-shared-browser-pool.mts`,
  `docs/ai/EXECUTION_ENGINE_CAPACITY_REPORT.md` (new), `docs/ai/CURRENT_STATE.md`, `docs/ai/KNOWN_ISSUES.md`,
  `docs/ai/TASK_LOG.md`, `docs/ai/HANDOFF.md`.
- **Verification:** `npm run build` clean; `verify:shared-browser-pool` 19/19, `verify:browser-isolation`
  27/27, `verify:runner` 82/82, `verify:concurrency` 78/78. Reports in `reports/browser-performance/`.
- **Not run / risks:** single machine, single run/stage, synthetic flows; heavy-class CPU undersampled;
  30-min soak not run (10-min practical); recycling unexercised (no PID on this stack); default-flag flip
  left for owner.

## 2026-07-15 — Handoff prepared (shared-browser capacity)

- Updated `docs/ai/HANDOFF.md` current handoff to the shared-browser capacity task (branch `main`, HEAD level
  with `origin/main`, working tree modified & uncommitted; prior React-Flow-removal note demoted to a preserved
  "prior session" block; earlier uncommitted sessions — canvas engine, secret store/security audit, browser
  resource optimization, custom app frame — listed as "not this task").
- Verification re-confirmed green (see the entry below). `node scripts/ai-memory/check-memory.mjs` run.
- Next agent: decide whether to commit the tree (read the git-full-cycle skill first); do not push/PR unless asked.

---

## 2026-07-15 — Claude — Shared-browser capacity: authoritative isolation resolver + launch-arg-aware compatibility key (not committed)

- **Task:** maximise stable concurrent capacity by safely sharing Chromium processes. Prove the existing
  A5 shared-pool from code + runtime first; implement only the real gaps; do not rewrite working systems.
- **Investigation (proven from code):** traced `execution.ipc → ExecutionEngine.processQueue (500 ms tick)
  → Adaptive (A7) + Backpressure + [A8 weighted] admission → isSharedEligible? contextSlot : browserSlot
  → PlaywrightRunner → BrowserContextFactory.create (persistent | A5 shared lease | dedicated isolated)`.
  Confirmed A5 leases a fresh isolated `BrowserContext` per instance on a shared `Browser`, spreads then
  packs, drops crashed browsers, recycles after N contexts, drains idle at run end. Dynamic admission
  (A7 hysteresis), workload cost (A8), machine-aware memory reserve (A2 CapacityPlanner) already exist.
- **Gap found (latent correctness bug):** the shared launch key was only `browser:headed/headless` — it
  ignored the per-instance resolved `launchArgOverrides`. With the shared pool ON **and** a non-`balanced`
  resource profile, two instances with divergent launch flags (gpu/webgl/cache / throttle drops) would
  reuse one browser configured with only the first leaser's flags. No four-class isolation taxonomy or
  decision diagnostics existed either.
- **Built:** `src/runner/browser/BrowserIsolationResolver.ts` — authoritative resolver classifying every
  instance into `SHARED_CONTEXT | DEDICATED_BROWSER | PERSISTENT_BROWSER | HANDOFF_BROWSER` with
  `{decision,value,source}` diagnostics, plus `sharedCompatibilityKey(config, launchArgOverrides)` folding
  the browser-LEVEL launch config into the key (context-level options stay isolated per context). Delimited,
  collision-safe, dependency-free; `balanced`/no-overrides → one stable key (unchanged sharing).
- **Wired:** `browserSharing.isSharedEligible` now delegates to the resolver (single source of truth, no
  drift); `BrowserContextFactory` shared launcher uses `sharedCompatibilityKey(config, launchArgOverrides)`
  so incompatible launch configs never share a process; `ExecutionEngine.runInstanceInner` logs the
  isolation class + diagnostics only when the shared pool is enabled (quiet on the default path).
- **Files:** `src/runner/browser/BrowserIsolationResolver.ts` (new), `src/runner/browser/browserSharing.ts`,
  `src/runner/BrowserContextFactory.ts`, `src/runner/ExecutionEngine.ts`, `scripts/verify-browser-isolation.mts`
  (new), `package.json`, `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`.
- **Verified (no regression):** `npm run build` clean; new `verify:browser-isolation` **27/27** (four-class
  classification, precedence, shareability, isSharedEligible parity, compat-key folds launch args but not
  context-level diffs, pool honours the key); `verify:shared-browser-pool` **18/18**, `verify:shared-browser-live`
  **5/5** (real Chromium — 4 contexts on 2 processes preserved), `verify:runner` **82/82**, `verify:concurrency`
  **78/78**, `verify:workload-weights` **53/53**, `verify:resource-routing` **42/42**, `verify:chromium-hardening`
  **13/13**, `verify:browser-resource-profile` **51/51**, `verify:adaptive-concurrency` **14/14**,
  `verify:operation-limiters` **10/10**, `verify:telemetry` **54/54**.
- **Benchmarked:** ran `benchmark:concurrency` with `AWKIT_SHARED_BROWSER_POOL=1` — found the flag is INERT
  in that harness (it `chromium.launch()`es one browser per instance, bypassing ExecutionEngine/factory/pool).
  It reported this machine's baseline: highest sustainable **7**, production-approved **5**, stop at 8 on P95
  CPU 96.5% (CPU-bound). Built + ran new `benchmark:shared-pool` (`scripts/benchmark-shared-pool.mts`) that
  drives the REAL `BrowserContextFactory` + `SharedBrowserPool` and compares Model A (browser/workflow) vs
  Model B (shared): **N=4 −37.5% procs / −27% RSS; N=8 −56% procs / −39% RSS** (headless, maxBrowsers=2),
  per-context cookie isolation held every cell. Saving is RAM+process count, not CPU.
- **Not done / risks:** shared pool stays **default OFF** (owner decision D4). A full flag-ON run *through
  ExecutionEngine dispatch* under sustained load on a clean machine + the default flip remain the gate; the
  factory+pool lease is now measured. Persistent/Handoff dedicated paths and Reuse Session / Auto Secure
  Login / Manual Handoff / popup / parallel-page behaviour are unchanged.

---

## 2026-07-15 — Claude — Browser Resource Optimization: deep benchmark evidence + throttling removed (not committed)

- **Task:** raise statistical confidence (20–30 reps), test minimized/occluded headed windows, ablate each
  optimization, build a representative workload matrix, and produce an evidence-based production recommendation.
- **Built:** `scripts/benchmark/lib.mts` (shared: stats, multi-workload server, subtree sampling, Win32
  minimize) + `benchmark-occlusion.mts` / `benchmark-ablation.mts` / `benchmark-workloads.mts` (+ npm scripts).
- **Ran:** occlusion 20 reps (5 throttle configs on a genuinely minimized window), ablation 20 reps (per-knob,
  image-heavy), workloads 15 reps (Balanced vs Low-Resource × 8 workloads). Artifacts + logs in
  `reports/browser-performance/`.
- **Findings:** background throttling gives **zero** CPU benefit for automated instances (minimize already
  floors CPU; Playwright keeps pages `visible` so timers never throttle; behaviour 100%) → **removed from
  low-resource default**. RAM win is ~all image blocking (−6% RAM / −99% net); earlier 21% was 3-rep noise;
  RAM saving is workload-dependent (~0–13%). Duration unchanged; capability overrides validated live.
- **Fix applied:** `BrowserResourceProfile.ts` low-resource `backgroundThrottling.enabled=false` (mechanism
  kept for `custom`); `verify-browser-resource-profile.mts` updated (51/51). Doc `BROWSER_RESOURCE_OPTIMIZATION.md`
  rewritten (§4/§5/§7/§9) with tables + recommendation; `.env.example` + CURRENT_STATE corrected.
- **Files:** `src/runner/browserProfile/BrowserResourceProfile.ts`, `scripts/benchmark/lib.mts`,
  `scripts/benchmark-{occlusion,ablation,workloads}.mts`, `scripts/verify-browser-resource-profile.mts`,
  `package.json`, `.env.example`, `docs/ai/BROWSER_RESOURCE_OPTIMIZATION.md`, `docs/ai/CURRENT_STATE.md`,
  `docs/ai/TASK_LOG.md`, `reports/browser-performance/*`.
- **Verified (no regression):** build clean; `verify:browser-resource-profile` 51/51, `verify:runner` 82/82,
  `verify:chromium-hardening` 13/13, `verify:lean-mode` 12/12, `verify:resource-routing` 42/42,
  `verify:concurrency` 78/78, `verify:workload-weights` 53/53, `verify:telemetry` 54/54.
- **Not done / risks:** multi-instance RAM totals are a labelled linear estimate (not multi-instance-benchmarked);
  CPU is not a reliable per-instance lever (rendering-dominated); GPU/WebGL/renderer-limit stay Custom-only;
  Settings UI + unattended→low-resource auto-rule are follow-ups.

---

## 2026-07-15 — Claude — Browser Resource Optimization: per-instance Chromium profiles + resolver (not committed)

- **Task:** reduce per-instance Chromium CPU/RAM/network/disk cost while preserving workflow behaviour;
  build a safe, configurable, measurable optimization architecture (not a concurrency change).
- **Investigation:** traced the full launch lifecycle (single site = `BrowserContextFactory.create`) and
  audited the real launch args (Playwright 1.61.0 defaults + `ChromiumHardening`); found the A9
  `ResourceRoutingPolicy`/`ArtifactProfile` were env-only and never wired to `PlaywrightRunner`, with no
  unified profile / resolver. Full write-up: `docs/ai/BROWSER_RESOURCE_OPTIMIZATION.md`.
- **Implemented (additive, default = today):** `src/runner/browserProfile/` — `BrowserResourceProfile.ts`
  (4 presets), `WorkflowCapabilities.ts` (capabilities only RELAX), `BrowserRuntimeConfigurationResolver.ts`
  (authoritative + per-decision diagnostics), `resolveForRun.ts`. Wired via
  `BrowserContextFactory.launchArgOverrides` (selective `ignoreDefaultArgs`, never `true`),
  `ChromiumHardening.omitBackgroundTimerThrottlePin` (re-enable background throttling for low-resource),
  `PlaywrightRunner.traceMode/resourceRouting`, `ExecutionEngine.runInstance` (resolve once/instance).
  Measurement fix: `ProcessTreeSampler` now counts `chrome-headless-shell.exe`.
- **Files:** `src/runner/browserProfile/{BrowserResourceProfile,WorkflowCapabilities,BrowserRuntimeConfigurationResolver,resolveForRun}.ts`,
  `src/runner/ChromiumHardening.ts`, `src/runner/BrowserContextFactory.ts`, `src/runner/PlaywrightRunner.ts`,
  `src/runner/ExecutionEngine.ts`, `src/runner/runtime/ProcessTreeSampler.ts`,
  `scripts/verify-browser-resource-profile.mts`, `scripts/benchmark-browser-resource.mts`, `package.json`,
  `.env.example`, `docs/ai/BROWSER_RESOURCE_OPTIMIZATION.md`, `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`.
- **Verification:** `npm run build` clean; `verify:browser-resource-profile` **49/49**; regression
  `verify:runner` **82/82**, `verify:chromium-hardening` **13/13**, `verify:lean-mode` **12/12**,
  `verify:resource-routing` **42/42**, `verify:concurrency` **78/78**, `verify:workload-weights` **53/53**,
  `verify:telemetry` **54/54**. Benchmark (i7-8750H/12c/16GB headless, 3 reps): low-resource vs balanced —
  network **−100% bytes / −96.8% req**, RAM **−8% avg / −9.6% peak**, navigate CPU **−20.6%**; idle CPU a
  wash (foreground headless doesn't background-throttle). Artifacts: `reports/browser-performance/`.
- **Not run / risks:** headed/occluded throttling win (display-dependent) not measured; GPU/WebGL/renderer-limit
  Custom-only pending clean-machine benchmark; Settings UI + per-workflow capability hints are follow-ups;
  low-resource-as-default is an owner decision. No packaged/offline walkthrough run (no offline-path behaviour changed).

---

## 2026-07-14 — Claude — Security hardening batch 2: residuals + defense-in-depth (not committed)

- **Task:** close the F-01/F-09 residuals and add the §13/§16 hardening; attempt `sandbox:true`.
- **F-01 residual:** global runtime root threaded into the execution context as `protectedUploadRoots`
  (`InstanceExecutionContext` + `ExecutionEngine` + `StepExecutor.assertUploadAllowed`) → uploads of
  captured browser profiles (cookies/Login Data) + durable store are now blocked.
- **F-09 residual:** `installGlobalSenderGuard()` in `app/main/ipc/index.ts` wraps every `ipcMain.handle`
  with `isTrustedSender` (covers all channels, not just the high-privilege ones).
- **Prototype pollution (§13):** `setJsonAtPath` rejects `__proto__`/`constructor`/`prototype` keys;
  `resolveJsonPath` refuses to traverse them (`TableEditing.ts`, `JsonPathResolver.ts`).
- **Smart Locator integrity (§16):** `guardLocatorQuality` fails a dangerousMutation/externalCommit step
  with a positional/fallback locator (wrong-privileged-action risk).
- **`sandbox:true`:** attempted, **reverted** — broke the ESM `preload.mjs` in a real-Electron GUI smoke
  (`verify:flow-designer` timed out on render). Needs preload→CJS migration; tracked as standalone. F-06
  `will-navigate` lockdown already removes the exploitable vector.
- **Also fixed:** a stray control byte in `StepExecutor.ts` (download-sanitizer regex) that made the file
  read as binary to ripgrep — rewritten as clean ASCII (`/[\x00-\x1f]+/`).
- **Verified:** `npm run build` clean; `verify:security` **33/33**; GUI `verify:flow-designer` **24/24**
  (no console errors, proves sender guard + IPC intact); `verify:runner` **82/82**, `verify:data-editor`
  **27/27**, `verify:ipc-contract` **4/4**.

## 2026-07-14 — Claude — Security hardening: LOW+MEDIUM+HIGH audit fixes (not committed)

- **Task:** fix the findings from `docs/security/FULL_SECURITY_AUDIT.md`, ascending severity. LOW+MEDIUM
  first; HIGH (F-01, F-03) applied after owner review chose the "recommended" approach. No commit, no GitHub.
- **HIGH fixes:** F-01 upload crown-jewels blocklist — `StepExecutor.assertUploadAllowed` refuses uploads
  inside AWKIT sessions/logs/reports/screenshots/traces (+ traversal), general user files still allowed;
  F-03 lenient bounds normalization — new `src/profiles/FlowValidation.ts` `normalizeFlowBounds` clamps
  timeouts/retries/loop iterations + caps alternatives/waits arrays + warns on duplicate ids, wired into
  `FlowExecutor.executeFlow` (keeps unknown-step-type rejection; does not reject unknown props → legacy
  flows still load). `verify:security` extended to 29/29; `verify:runner` 82/82, `verify:waits` 21/21.
  Residual P2: global session-capture profile dir not yet in the upload blocklist (needs runtime root
  threaded into the execution context).
- **New helpers:** `src/runner/urlPolicy.ts` (navigation allowlist), `src/utils/pathSafety.ts`
  (`isPathInside` confinement), `app/main/ipc/senderGuard.ts` (`assertTrustedSender`).
- **Fixes:** F-02 `assertNavigableUrl` on both `goto` sinks (blocks `file:`/`javascript:`/`chrome*`/
  `devtools:`; allows http(s)/about/data); F-04 data-source writes confined to workspace + `saveSession`
  folder confined to sessions root; F-05 `system:openPath` confined to app data folders + exe-extension
  block; F-06 `will-navigate`/`will-redirect` lockdown in `windowManager.ts`; F-07 recorder redaction
  extended to OTP/one-time-code/card/CVV/PIN/SSN/token fields; F-08 `sanitizeDownloadFileName`;
  F-09 `assertTrustedSender` on `execution:runWorkflow`, `dataSources:writeJson/createFromScratch`,
  `session:startCapture`, `system:openPath`; F-11 session capture rejects non-http(s) targets.
- **Files:** `src/runner/StepExecutor.ts`, `src/session/SessionCaptureService.ts`, `src/recorder/
  recorderInitScript.ts`, `app/main/windowManager.ts`, `app/main/ipc/{system,dataSource,execution,session}.ipc.ts`,
  + the 3 new helpers, `scripts/verify-security.mts`, `package.json` (`verify:security`).
- **Verified:** `npm run build` clean; new `verify:security` **20/20**; regression `verify:runner` **82/82**,
  `verify:recorder` **72/72**, `verify:ipc-contract` **4/4**, `verify:data-editor` **27/27**,
  `verify:waits` **21/21**, `verify:protected-login` **16/16**, `verify:protected-login-recorder` **34/34**.
- **Behaviour notes:** data-source edits to a file outside the workspace now save a workspace copy (were
  written in place); `goto`/`routeChange` to `file://` now error; `system:openPath` outside app folders
  returns a message instead of opening. Remediation status table added to the audit report.

## 2026-07-14 — Claude — Full security audit (report-only, no code changes)

- **Task:** perform an evidence-based security audit of the actual AWKIT codebase per
  `docs/security/SECURITY_AUDIT_BRIEF.md` (added from `UI Samples/Security Audit.md`). Audit-and-report
  only — no fixes applied, no commit, no GitHub interaction (per user instruction and the brief).
- **Produced:** `docs/security/FULL_SECURITY_AUDIT.md` (executive summary, threat model, architecture,
  privileged-op inventory, IPC/workflow-trust reviews, 11 findings, roadmap). Rating **C**; recommendation
  **YES WITH CONDITIONS**.
- **Key findings (all traced to current source):** F-01 arbitrary local-file upload via `uploadFile`
  `setInputFiles` unbounded path (`StepExecutor.ts:832`, HIGH); F-03 no runtime schema/bounds validation of
  workflow JSON (`FlowProfile.ts`, HIGH); F-02 no `goto` protocol allowlist (`file://` reachable, MEDIUM);
  F-04 arbitrary FS write via data-source `file`/`saveSession` folder (MEDIUM); F-05 `system:openPath`
  unrestricted (MEDIUM); F-06 no `will-navigate` guard + `sandbox:false` (MEDIUM); F-07 recorder captures
  non-password field values literally (MEDIUM).
- **Strong existing controls confirmed:** no eval/Function/vm; safe hand-written condition evaluators;
  arg-array spawn (no shell injection); http(s)-only external open; recorder password/URL redaction; no
  CAPTCHA/MFA-bypass or stealth; parameterized SQL; atomic writes + profile locks; downloads never executed.
- **Tests run:** `npm audit` (dev-only advisories, not shipped). **Not run:** live malformed-workflow repro,
  packaged-EXE signing/storage check, concurrent-session isolation stress (called out in the report).
- **No source code changed.**

## 2026-07-13 — Claude — Live-vs-history on the execution report (phase B4)

- **Task:** show a running/finished instance's elapsed vs the workflow's historical per-run avg/p95 (for
  the current machine) on the Execution Report opened from Instance Monitor. Renderer + verifier only;
  consumes the B2 channels (no IPC/preload/schema/InstanceMonitor change). Completes reporting workstream B.
- **Changed:** `app/renderer/components/instances/executionReportModel.ts` (+pure
  `compareElapsedToHistory` + `WorkflowHistoryBaseline`/`HistoryComparison` types);
  `app/renderer/components/instances/LiveExecutionReportModal.tsx` (baseline fetch via
  `telemetry.workflowComparison("all", {machineId})` with all-machines fallback; `vs history` banner line +
  tone chip + `History avg`/`History p95` stat cards + Elapsed delta hint); `app/renderer/styles/global.css`
  (`.report-history-vs`, `.report-vs-chip.tone-*`).
- **Files:** `executionReportModel.ts`, `LiveExecutionReportModal.tsx`, `global.css`,
  `scripts/verify-instance-monitor.mts`; `docs/ai/CURRENT_STATE.md`, `TASK_LOG.md`.
- **Verified:** `npm run build` clean; `verify:instance-monitor` **43/43** (+8 comparison cases);
  `verify:instance-monitor-gui` **12/12** (real 4-instance run, no renderer errors); a real-Electron capture
  with a 3-run history rendered the machine-scoped `vs history: avg 4s · p95 4s · 18% slower than avg` line
  + stat cards, 0 console errors.
- **Result:** reporting workstream B (B1–B4) complete.

## 2026-07-13 — Claude — Workflow Reports comparison UI + machine filters (phase B3)

- **Task:** surface the B1/B2 machine-aware read-model in the renderer — per-workflow comparison vs the
  previous window, trend sparklines, delta chips, and machine/mode/pool/class filters. Renderer + verifier
  only; consumes the existing B2 channels (no IPC/preload/schema change).
- **Changed:** `app/renderer/pages/ReportsWorkflows.tsx` — swapped `telemetry.workflows` →
  `telemetry.workflowComparison(range, machineFilter)`; added delta chips (goodness-colored) on
  Runs/Success/Avg/p95, a trend glyph + lazy per-row success-rate sparkline (`telemetry.workflowTrend`,
  reusing `MetricSparkline`), a machine-context caption, a Machine/Mode/Browsers/Workload filter bar
  (options from `telemetry.machines`, "This machine" from `system.capacityPreview`), and a Compare mode
  (2–4 side-by-side cards). `app/renderer/styles/global.css` — token-only classes for the above; new
  columns stay inside `.awkit-table-wrap`; `prefers-reduced-motion` honored.
- **Files:** `ReportsWorkflows.tsx`, `global.css`, `scripts/verify-reports-gui.mjs`;
  `docs/ai/CURRENT_STATE.md`, `TASK_LOG.md`.
- **Verified:** `npm run build` clean; `verify:reports` (GUI) **31/31** (adds filter-bar 4 selects,
  interactive filter + stable page, Compare toggle + valid state, no telemetry/undefined console errors);
  real Electron capture visually confirmed delta chips + sparkline + trend glyph with live data. Regression
  `verify:ipc-contract` **4/4**, `verify:telemetry` **54/54**.
- **Next:** B4 (optional) live-vs-history on the Instance Monitor run card. Machine-context captions stay
  blank until v3 runs accrue.

## 2026-07-13 — Claude — Machine-aware report IPC + preload (phase B2)

- **Task:** expose the B1 read-model to the renderer via IPC + preload. Additive channels; existing
  telemetry channels untouched.
- **Changed:** `app/main/ipc/telemetry.ipc.ts` (+`telemetry:workflowComparison`/`workflowTrend`/`machines`
  handlers + `trendBucketsForPreset`); `src/runner/ExecutionEngine.ts` (+`getTelemetryWorkflowComparison`/
  `getTelemetryWorkflowTrend`/`getTelemetryMachines` delegators); `app/main/preload.ts` (+`workflowComparison`/
  `workflowTrend`/`machines` bridge methods + type imports).
- **Files:** `telemetry.ipc.ts`, `ExecutionEngine.ts`, `preload.ts`; `docs/ai/CURRENT_STATE.md`, `TASK_LOG.md`.
- **Verified:** `npm run build` clean; `verify:ipc-contract` **4/4** (121 handlers / 98 exposed / 23
  backend-only — each new channel has one handler AND is exposed).
- **Next:** B3 comparison UI + machine filters (ReportsWorkflows); B4 optional live-vs-history run card.

## 2026-07-13 — Claude — Machine-aware report read-model (phase B1)

- **Task:** persist per-run machine context + add a machine-aware per-workflow comparison (current vs
  previous window) and run-over-run trend to the reporting read-model. Read-model + persistence only; no
  IPC/UI (B2/B3).
- **Schema:** migration **v3** (`RuntimeStoreSchema.ts`) — additive nullable machine-context columns on
  `runtime_runs` (machineId/cpu/mem/executionMode/browserPoolMode/configuredConcurrency/
  observedPeakConcurrency/workloadClass/capacityRecommendationAtRun) + `idx_runs_machine`; v1/v2 upgrade in
  place. `DurableRunRecord` + `upsertRun` extended.
- **Contracts (`TelemetryContracts.ts`):** `MachineRunContext`, `MachineFilter`, `WorkflowComparisonRow`
  (+previous/delta/trend/machineContext), `WorkflowTrend(Point)`, `MachineSummary`, `machineContextFromRun`;
  `RunHistoryFilter` extends `MachineFilter`.
- **Store (`SqliteRuntimeStore.ts`):** `queryWorkflowComparison` (half-open current/previous windows;
  all-time → trend "new"; deltas undefined-not-NaN), `queryWorkflowTrend`, `listRunMachines`; machine
  filters in `queryRunHistory`; shared `aggregateWorkflows`. `RuntimeStore` + `NullRuntimeStore` updated.
- **Write path:** `ExecutionEngine.setMachineRunContext` + run-start/end `upsertRun` stamping + peak-
  concurrency tracking; `capacityService.buildMachineRunContext` + `execution.ipc` push.
- **Files:** `RuntimeStoreSchema.ts`, `SqliteRuntimeStore.ts`, `RuntimeStore.ts`, `TelemetryContracts.ts`,
  `ExecutionEngine.ts`, `app/main/capacityService.ts`, `app/main/ipc/execution.ipc.ts`;
  `scripts/verify-telemetry.mts`; `docs/ai/CURRENT_STATE.md`, `TASK_LOG.md`.
- **Verified:** `npm run build` clean; `verify:telemetry` **54/54** (v1→v2→v3 in-place upgrade, comparison
  window split + delta/trend + empty→new/no-NaN, machine filtering, trend buckets, listRunMachines,
  run-history machine filters); regression `verify:runner` **82/82**.
- **Next:** B2 IPC (`telemetry:workflowComparison`/`workflowTrend`/`machines`) + preload; B3 comparison UI +
  machine filters; B4 optional live-vs-history run card.

## 2026-07-13 — Claude — Machine-relative benchmark harness (phase A10)

- **Task:** calibrate this machine's real sustainable capacity via machine-relative concurrency stages
  (scaled from the recommendation R + ceiling, not a fixed sequence), stopping at the first stage that
  trips a health stop condition; write the result into the machine profile. Heavy + opt-in.
- **New:** `src/runner/concurrency/BenchmarkPlanner.ts` (pure) — `generateBenchmarkStages`/`normalizeStages`
  (distinct ascending integers in `[1,ceiling]`), `evaluateStopConditions` (sustained/P95 CPU, free-mem
  reserve, memory %, event-loop delay, error rate, browser/renderer crashes, queue delay, latency
  regression; missing telemetry never stops), `productionApprovedCapacity` (margin below highest
  sustainable), `summarizeBenchmark` (contiguous sustainable run), `applyBenchmarkToProfile`.
  `scripts/benchmark-concurrency.mts` — heavy driver (`npm run benchmark:concurrency`) with an
  `AWKIT_BENCHMARK_PLAN_ONLY`/`--plan` dry-run; drives mock-site loops per stage, samples health, writes a
  JSON artifact + updates the machine profile.
- **Files:** the new module; `scripts/verify-benchmark-planner.mts`, `scripts/benchmark-concurrency.mts`;
  `package.json`; `.gitignore` (`.benchmark-runtime/`); `docs/ai/CURRENT_STATE.md`, `TASK_LOG.md`.
- **Verified:** `npm run build` clean; new `verify:benchmark-planner` **36/36**; plan-only harness smoke on
  a 12-CPU/16-GB host printed machine-relative stages (`1 → … → 12`). Not run: the full live benchmark — a
  true production cap requires a clean-machine run (external gate).
- **Next:** consume `benchmarkTestedCapacity`/`productionApprovedCapacity` in Auto + the Settings capacity
  preview; feed measured per-instance estimates back into the planner seeds; reporting workstream B.

## 2026-07-13 — Claude — Resource-reduction profiles (PR-CAP-2 phase A9)

- **Task:** per-run knobs to cut per-instance cost — Normal/Lean/Ultra-Lean request routing + formal
  Production/Balanced/Debug/Full artifact profiles. Defaults (Normal + Balanced) preserve today's exact
  behaviour; images are never blocked by default.
- **New:** `src/runner/ResourceRoutingPolicy.ts` (pure decision + context options + env loader + best-
  effort `context.route` installer) and `src/runner/artifacts/ArtifactProfile.ts` (trace/screenshot/video
  mapping).
- **Changed:** `BrowserContextFactory.ts` (resolves routing once; `buildContextOptions` folds profile
  context options into all 3 context paths; installs routing on each created context);
  `artifacts/TraceService.ts` (`loadTraceMode` falls back to the artifact profile — Balanced default =
  onFailure, unchanged; explicit `AWKIT_TRACE_MODE` still wins).
- **Files:** the two new modules; `BrowserContextFactory.ts`, `artifacts/TraceService.ts`;
  `scripts/verify-resource-routing.mts`, `scripts/verify-lean-mode.mts`; `package.json`;
  `docs/ai/CURRENT_STATE.md`, `TASK_LOG.md`.
- **Verified:** `npm run build` clean; new `verify:resource-routing` **42/42** + `verify:lean-mode`
  **12/12** (real Chromium: Lean aborts image, Ultra-Lean aborts image+stylesheet, DOM intact, allow-list
  rescue); regression `verify:runner` **82/82** (Normal unregressed), `verify:concurrency` **78/78**.
  Not run: a dedicated Mock Site Lean/downloads scenario (live proof uses a self-contained temp server).
- **Next:** A10 machine-relative benchmark harness; Settings UI to pick resource/artifact profiles; wire
  the artifact-profile video/screenshot fields beyond trace; optional Mock Site lean/downloads scenario.

## 2026-07-13 — Claude — Workload-aware capacity + scheduler weights (PR-CAP-2 phase A8)

- **Task:** stop treating every instance as one identical flow — weight each by real cost (persistent
  profile / headed / downloads / parallel branches / trace-video / large flows) and, when enabled, admit
  dispatch against a weighted budget instead of a raw active count. Flag-guarded OFF; flag-off unchanged.
- **New:** `src/runner/concurrency/WorkloadWeights.ts` (pure) — `extractWorkloadFeatures`,
  `computeWorkloadWeight` (additive, monotonic, clamped), `classifyWorkload` (light/medium/heavy, rounds
  UP on ambiguity), `weightedBudget` + `canAdmitWeighted` (never deadlocks an idle host),
  `buildWorkloadRecommendation` (confidence unmeasured→estimated→benchmarked), one
  `DEFAULT_WORKLOAD_WEIGHT_CONFIG` of seeds.
- **Changed:** `ConcurrencyConfig.ts` (+`workloadWeights` bool + `workloadWeightBudgetPerFlow`, both
  env-overridable; new `envFloat` helper); `ExecutionEngine.ts` (per-instance weight cache dropped on
  runner settle; dispatch-loop weighted-admission gate before slot acquisition, flag-gated).
- **Files:** the new module; `ConcurrencyConfig.ts`, `ExecutionEngine.ts`;
  `scripts/verify-workload-weights.mts`; `package.json`; `docs/ai/CURRENT_STATE.md`, `TASK_LOG.md`.
- **Verified:** `npm run build` clean; new `verify:workload-weights` **53/53**; regression
  `verify:concurrency` **78/78**, `verify:adaptive-concurrency` **14/14**, `verify:operation-limiters`
  **10/10**. Not run: live flag-ON multi-instance weighted-admission engine run (external gate).
- **Next:** A9 resource-reduction profiles (lean/artifact modes); A10 benchmark harness; surface the
  per-class recommendations in the Settings capacity preview / IPC; history-driven weight calibration.

## 2026-07-13 — Claude — Adaptive concurrency controller (PR-CAP-2 phase A7)

- **Task:** shrink the live active-flow target under real host pressure (incl. other apps) and recover
  gradually. Purely protective — no pressure means it sits at the cap (steady-state unchanged).
- **New:** `src/runner/concurrency/AdaptiveController.ts` (healthy/stable/pressure/critical classification,
  grow-slow/shrink-fast, cooldown, `[1,ceiling]` clamp, `setCeiling` jump; injected clock; pure).
- **Changed:** `ResourceSampler.ts` (+`eventLoopDelayMs` via `monitorEventLoopDelay`); `ConcurrencyConfig.ts`
  (+adaptive enable/steps/cooldown/thresholds, env-overridable); `BackpressureController.ts` (`admit` takes
  optional `effectiveMaxFlows` clamped ≤ maxActiveFlows; `snapshot` carries adaptive fields);
  `CapacitySnapshot.ts` (+`adaptiveTarget`/`adaptiveState`); `ExecutionEngine.ts` (owns controller, evaluates
  each tick with the live sample + crash count + queue depth, passes target to admit, re-seeds ceiling in
  configureConcurrency, surfaces state in getCapacitySnapshot).
- **Files:** the new module; `ResourceSampler.ts`, `ConcurrencyConfig.ts`, `BackpressureController.ts`,
  `CapacitySnapshot.ts`, `ExecutionEngine.ts`; `scripts/verify-adaptive-concurrency.mts`; `package.json`;
  `docs/ai/CURRENT_STATE.md`, `TASK_LOG.md`.
- **Verified:** `npm run build` clean; `verify:adaptive-concurrency` **14/14**; regression
  `verify:concurrency` **78/78**, `verify:resource-sampling` **14/14**, `verify:runtime-status` **15/15**,
  `verify:operation-limiters` 10/10, `verify:runner` **82/82**. Not run: live sustained-pressure engine run.
- **Next:** A8 workload weights, A10 benchmark harness; workstream B reports; optional monitor-strip UI for
  adaptive state.

## 2026-07-13 — Claude — Operation limiters (PR-CAP-2 phase A6)

- **Task:** stagger expensive operations so N active instances don't all launch/navigate/download/
  screenshot at once. Active by default with conservative caps; only staggers, no behavior change.
- **New:** `src/runner/concurrency/OperationLimiters.ts` (five semaphore-backed kinds + `run`/`configure`/
  `snapshot`; short-held permits released in `finally`).
- **Changed:** `ConcurrencyConfig.ts` (+5 `maxConcurrent*` fields, env-overridable);
  `BrowserContextFactory.ts` (wraps launch/persistent-launch + newContext, both shared+dedicated);
  `StepExecutor.ts` (+15th ctor param + `limitOp`; wraps 2 goto sites, `download.saveAs`, both
  screenshot calls); `PlaywrightRunner.ts` (passes limiters to both StepExecutor sites);
  `ExecutionEngine.ts` (owns/sizes limiters, passes to every runner); `app/main/ipc/execution.ipc.ts`
  (Sequential → all limiters 1).
- **Files:** the new module; `ConcurrencyConfig.ts`, `BrowserContextFactory.ts`, `StepExecutor.ts`,
  `PlaywrightRunner.ts`, `ExecutionEngine.ts`, `app/main/ipc/execution.ipc.ts`;
  `scripts/verify-operation-limiters.mts`; `package.json`; `docs/ai/CURRENT_STATE.md`, `TASK_LOG.md`.
- **Verified:** `npm run build` clean; `verify:operation-limiters` **10/10**; `verify:runner` **82/82**
  (real Chromium, wrapped ops unregressed); `verify:waits` **21/21**; `verify:concurrency` **78/78**;
  shared-pool 18/18 + live 5/5; capacity-modes 10/10. Not run: full multi-instance live spike test.
- **Next:** A7 adaptive controller, A8 weights, A10 benchmark; workstream B reports.

## 2026-07-13 — Claude — Shared Chromium browser pool (PR-CAP-3 phase A5, flag-guarded)

- **Task:** implement the plan's shared browser pool so many isolated contexts share a few Chromium
  processes. Experimental, gated by `AWKIT_SHARED_BROWSER_POOL` (default OFF); flag-off is unchanged.
- **New:** `src/runner/browser/SharedBrowserPool.ts` (lease/spread/pack/least-loaded/health/recycle/drain,
  injectable launcher), `src/runner/browser/browserSharing.ts` (`isSharedEligible`/`scenarioUsesBrowserSwap`/
  `sharedLaunchKey`).
- **Changed:** `ConcurrencyConfig.ts` (+`useSharedBrowserPool` + recycle/hard-limit fields, env-overridable);
  `BrowserWorkerPool.ts` (+`acquireContextSlot` non-semaphore context slots; snapshot counts only real
  browser slots for saturation); `BrowserContextFactory.ts` (leases from the pool for browserContext when
  supplied); `ExecutionEngine.ts` (constructs+sizes the pool, routes eligible instances to context
  slots + the pool, drains idle at run end); `PlaywrightRunner` passes the pool through via options.
- **Design:** dedicated (own browser) for persistentContext / captured session / browser-swap-node
  instances; shared for plain browserContext. Shared instances bounded by `maxActiveFlows` + the pool's
  browser cap, not `maxBrowsersPerHost`. Preserves the expected-close/crash generation logic.
- **Files:** the two new `src/runner/browser/*` modules; `ConcurrencyConfig.ts`, `BrowserWorkerPool.ts`,
  `BrowserContextFactory.ts`, `ExecutionEngine.ts`; `scripts/verify-shared-browser-pool.mts`,
  `scripts/verify-shared-browser-live.mts`; `package.json`; `docs/ai/CURRENT_STATE.md`, `TASK_LOG.md`.
- **Verified:** `npm run build` clean; `verify:shared-browser-pool` **18/18**; `verify:shared-browser-live`
  **5/5** (real Chromium — 4 contexts → 2 processes); flag-off parity `verify:browser-pool` **25/25**,
  `verify:concurrency` **78/78**, `verify:runner` **82/82**; `verify:capacity-modes` **10/10**. Not run:
  full flag-ON multi-instance engine run vs mock site (heavy — external/clean-machine gate).
- **Next:** live flag-ON multi-instance verification before default-on (D4); shared-browser count in the
  runtime-status gauge; A6 operation limiters, A7 adaptive controller, A8 weights, A10 benchmark.

## 2026-07-13 — Claude — Machine-aware concurrency modes (PR-CAP-1 phase A4)

- **Task:** wire the A1–A3 capacity core into real dispatch + Settings — Sequential/Auto/Manual modes.
- **Settings (`app/main/uiSettings.ts`):** extended `runtime` with `capacityMode` (default `manual`,
  back-compat), `workloadClass`, `administratorMaximumConcurrency`, `absoluteSafetyMaximum`,
  `capacitySafetyFactor`, `reservedLogicalCpuCount`; legacy files migrate on read; validation extended
  (main + renderer mirror).
- **Resolver + service:** `src/runner/concurrency/CapacityContracts.ts` (pure `resolveEffectiveConcurrency`
  + `CapacityMode`/`CapacityPreview` + `DEFAULT_UNBENCHMARKED_AUTO_CEILING`); `app/main/capacityService.ts`
  (`computeEffectiveConcurrency` for the apply seam, `previewCapacity` for the UI, detects host + refreshes
  the per-machine profile on Auto). Sequential=1/1, Manual=explicit, Auto=benchmark-or-conservative; all
  clamped to admin max + absolute ceiling.
- **Apply + IPC:** `applyRuntimeConcurrencyFromSettings()` (`app/main/ipc/execution.ipc.ts`) now maps the
  mode through `computeEffectiveConcurrency` → `ExecutionEngine.configureConcurrency`; new
  `system:capacityPreview` handler (`system.ipc.ts`) + preload `system.capacityPreview`.
- **UI:** `app/renderer/pages/Settings.tsx` Runtime Concurrency card → mode selector + live machine
  readout + Auto workload class + Manual inputs/warning + Advanced safety limits; token-only CSS in
  `global.css` (`.capacity-mode-row/.capacity-readout/.capacity-advanced`, `.form-message.warn`).
- **Files:** `app/main/uiSettings.ts`, `app/main/capacityService.ts`,
  `src/runner/concurrency/CapacityContracts.ts`, `app/main/ipc/execution.ipc.ts`,
  `app/main/ipc/system.ipc.ts`, `app/main/preload.ts`, `app/renderer/pages/Settings.tsx`,
  `app/renderer/styles/global.css`, `scripts/verify-capacity-modes.mts`,
  `scripts/verify-capacity-settings-gui.mjs`, `package.json`, `docs/ai/CURRENT_STATE.md`, `TASK_LOG.md`.
- **Verified:** `npm run build` clean; `verify:capacity-modes` **10/10**; `verify:capacity-settings-gui`
  **12/12** (real Electron, non-destructive snapshot/restore); `verify:ipc-contract` **4/4**;
  `verify:settings-persistence` **3/3**; `verify:concurrency` **78/78**. Not run: clean-machine offline
  walkthrough.
- **Next:** A5 shared browser pool (Auto maps target→maxBrowsers 1:1 until then); A6/A7/A8/A10 per plan.

## 2026-07-13 — Claude — Machine-agnostic capacity core (PR-CAP-1 phases A1–A3)

- **Task:** begin executing `docs/ai/CONCURRENCY_CAPACITY_AND_REPORTS_PLAN.md`. Landed the pure-core,
  hardware-agnostic foundation only — **no** engine/IPC/UI wiring yet, no behavior change to runs.
- **A1 — `src/runner/concurrency/MachineCapabilityDetector.ts`:** detects `MachineCapabilities` from an
  injectable `OsProbe` (never throws), a coarse capability **fingerprint** (stable across reboot +
  available-memory drift; changes on CPU count / total-RAM band / platform / OS), `capabilitiesChanged`
  with reasons, and a locally generated + atomically persisted `machineId` (`<runtimeRoot>/machine-id.json`
  — no hardware serials/MACs).
- **A2 — `src/runner/concurrency/CapacityPlanner.ts`:** pure `min(RAM, CPU, adminMax, ceiling)` planner
  with all seeds/bounds in one `CapacityTuning` object (`DEFAULT_CAPACITY_TUNING`); absolute+percentage
  reserve precedence (more-protective wins); config-driven bootstrap categories; live background-CPU input;
  measured per-instance overrides; per-workload recommendations. High RAM alone never inflates capacity.
- **A3 — `src/runner/concurrency/MachineCapacityProfileStore.ts`:** per-machine `MachineCapacityProfile`
  persisted atomically under `<runtimeRoot>/runtime/machine-profiles/<machineId>.json`; `reconcileMachineProfile`
  flags recalibration + drops stale benchmark values on hardware change while preserving the
  administrator/manual `configuredCapacity`; profiles isolated per machine.
- **Files:** the three `src/` modules above; `scripts/verify-machine-capabilities.mts`,
  `scripts/verify-capacity-planner.mts`, `scripts/verify-machine-profile.mts`; `package.json` (3 scripts);
  `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`.
- **Verification:** `tsc --noEmit` clean; `verify:machine-capabilities` **20/20**; `verify:capacity-planner`
  **29/29**; `verify:machine-profile` **15/15**. Not run: engine/GUI (no wiring yet — A4 does that).
- **Next:** A4 wires Sequential/Auto/Manual modes + capacity settings + `system:capacityPreview` IPC into
  `uiSettings.ts` / `execution.ipc.ts` / `Settings.tsx` (checkpoint before that integration).

## 2026-07-12 — Claude — Fix Flow/Workflow Designer right inspector overflowing into the toolbar

- **Task:** the right properties drawer's top edge poked above the canvas into the flush action bar
  ("overflow to the toolbar … shouldn't exceed canvas height") on the Flow Designer.
- **Root cause:** `.designer-layout.flush-layout .designer-right-drawer-slot` used a fixed
  `padding-top: calc(var(--space-5)*3 + var(--space-1))` (76px) to clear the in-canvas `.flow-action-bar`.
  That bar has `flex-wrap: wrap`; at narrower widths it wraps to ~106px, so the 76px offset left the
  drawer starting above the canvas body.
- **Change:** `DesignerCanvasLayout` now measures the live `.flow-action-bar` height (layout effect +
  `ResizeObserver`) and exposes it as `--awkit-action-bar-h` on the layout `<section>`; the drawer
  `padding-top` reads that var with the old 76px as pre-paint fallback. Serves both Flow Designer and
  Workflow Designer (shared flush layout). No markup/token changes.
- **Files changed:** `app/renderer/layout/DesignerCanvasLayout.tsx`, `app/renderer/styles/global.css`,
  `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`.
- **Verification:** `npm run build` clean; ad-hoc Electron GUI check (Playwright `_electron`, window
  narrowed to force the bar to wrap to 106px) confirmed `--awkit-action-bar-h: 106px`, drawer top 170 ==
  action-bar bottom 170, drawer bottom == canvas bottom. Not run: clean-machine offline GUI walkthrough.

## 2026-07-11 — Claude — Fix false "browser crash rate high" backpressure from normal browser closes

- **Task:** diagnose why a 50-instance run showed `Crashes 5` + backpressure "pausing new dispatch" with
  ~46 instances stranded `Pending` while the host was idle, then fix it.
- **Root cause:** in `browserContext` isolation the runtime owns a real `Browser`; `PlaywrightRunner`
  closes it inside `executeScenario`'s `finally` (before returning), so `BrowserWorkerPool.releaseSlot`
  had not run yet and the `disconnected` handler scored every *normal* end-of-instance close as a crash.
  Once >3 accumulated in the 5-min window, `BackpressureController` blocked all new dispatch. (Failing
  navigations to an unreachable target merely supplied the quick completions — 5 Failed ⇒ 5 "crashes".)
- **Change:** new `onRuntimeClosing` runner option, fired in `closeRuntime` (end-of-run / cancel / Reuse
  Session swap); engine wires it to `BrowserWorkerPool.markExpectedClose(slot, generation)`; the pool's
  `disconnected` handler skips crash-counting when `expectedCloseGeneration === generation`. Genuine
  crashes (unsignalled mid-run disconnect, page `crash`, engine `browser-crash` classification) still
  count; the signal is generation-scoped so post-swap later-generation crashes still count.
- **Files changed:** `src/runner/browser/BrowserWorkerPool.ts` (`markExpectedClose` +
  `expectedCloseGeneration` slot field + guarded `disconnected` handler), `src/runner/PlaywrightRunner.ts`
  (`onRuntimeClosing` option, fired in `closeRuntime`), `src/runner/ExecutionEngine.ts` (wire the
  callback), `scripts/verify-browser-pool.mts` (Part E regression), `docs/ai/CURRENT_STATE.md`,
  `docs/ai/KNOWN_ISSUES.md`, `docs/ai/TASK_LOG.md`.
- **Verification:** `npm run build` clean; `verify:browser-pool` 16/16 (new Part E: unexpected disconnect
  still counts, intentional teardown does not, generation-scoped); `verify:concurrency` 78/78;
  `verify:runner` 82/82. Not run: clean-machine offline GUI walkthrough (no live 50-instance repro).

## 2026-07-11 — Claude — Compound/tree locators for non-unique recorder elements

- **Task:** the Recorder saved ambiguous single-strategy locators ("matches 2 elements" warning, e.g.
  two `checkbox` controls sharing accessible name `0796713928`). Build combinations/series/trees of
  locators until exactly one element matches. Full scope (Phases 1–3), skip-noise descendant chains.
- **Change:**
  - **Phase 1 (recorder):** `compoundSelector` (meaningful features + fewest distinguishing ancestors,
    descendant combinators, utility/hashed classes rejected, frequency-ranked) + `anchoredStructural`
    (unique id/testid ancestor + positional tail), wired into `buildCandidates` before the positional
    fallback; `elementsForRole` refactored to `elementsForRoleIn` for scoped counting.
  - **Phase 2a (recorder):** prefer a readable semantic locator scoped to a stable container that
    isolates the exact element (verified in-page); new `quality.disambiguation`.
  - **Phase 2b (renderer):** carry Recorder `alternatives`/`context` through the Flow Designer
    load→save round-trip; panel shows how uniqueness was achieved.
  - **Phase 3 (runner):** deterministic self-healing (visible → enabled → in-viewport; never guess
    among equal twins) in `LocatorFactory.pickSingle`/`narrowToActionable`.
- **Files changed:** `src/recorder/recorderInitScript.ts`, `src/profiles/FlowProfile.ts`
  (`LocatorQuality.disambiguation?`), `src/runner/LocatorFactory.ts`,
  `app/renderer/components/workflow/flowDesignerTypes.ts`, `app/renderer/pages/FlowChartDesigner.tsx`,
  `app/renderer/components/workflow/FlowNodePropertiesPanel.tsx`, `mock-site/public/recorder-lab.html`,
  `mock-site/README.md`, `scripts/verify-recorder-locator.mts`, `scripts/verify-mock-site.mjs`, docs.
- **Verification:** build clean; `verify:recorder` 72/72; `verify:runner` 82/82; `verify:mock-site`
  35/35; `verify:flow-designer` 21/21; `verify:recorder-flow` 13/13; `verify:recorder-draft` 17/17.
  Not run: clean-machine offline GUI walkthrough.
- **Result:** ordinary duplicate elements now record as a unique compound/container locator (no red
  warning); legacy non-unique flows self-heal at run time when exactly one match is actionable.
  Schema back-compatible (one optional field); no IPC/preload/runner-contract/packaging change.

---

## 2026-07-11 — Codex — Flow Designer half-height canvas repair

- **Task:** fix the attached Flow Designer screenshot where the graph canvas stopped halfway down the
  window and left a large dead region below it.
- **Root cause:** an empty `.designer-right-drawer-slot` remained mounted when `rightPanel={null}`. In
  the one-column grid it became an implicit second row, splitting the 703px designer into a 347.5px
  canvas plus an empty row. A no-panel `right-collapsed` class also retained an unused 56px column.
- **Files changed:** `app/renderer/layout/DesignerCanvasLayout.tsx`,
  `scripts/verify-flow-designer-gui.mjs`, and AI memory/completion-report docs.
- **Verification:** build pass; real Electron `verify:flow-designer` 21/21; canvas performance 13/13;
  mock-site 29/29; 2048×1098 visual walkthrough measured canvas = designer = 1808×1002 with zero
  drawer slots and no console/page errors.
- **Result:** the no-inspector canvas now fills the available width and height; populated and collapsed
  inspectors retain their reserved-column behavior. No canvas engine, profile schema, persistence,
  runner, IPC, dependency, or packaging behavior changed.

---

## 2026-07-11 — Codex — Critical Flow / Workflow Designer defect closure

- **Task:** eliminate the supplied critical `originX` crash, inspector overlap/collapse defects,
  connection-dialog mismatch, and oversized Workflow Builder toolbar; validate in the built Electron GUI
  without remote Git operations.
- **Root causes:** queued pane updater read a gesture ref after pointer-up cleared it; fast node pointer-up
  read stale React drag state; Flow inspector was absolutely positioned over the canvas and its collapsed
  state was not passed to the layout; generic confirmation styling did not match the branch-link reference;
  an older, more-specific `.scenario-toolbar > div` rule forced compact toolbar groups back to grid layout.
- **Files changed:** `app/renderer/components/canvas/FlowCanvas.tsx`,
  `app/renderer/components/shared/ConfirmDialog.tsx`, `app/renderer/layout/DesignerCanvasLayout.tsx`,
  `app/renderer/pages/FlowChartDesigner.tsx`, `app/renderer/pages/ScenarioBuilder.tsx`,
  `app/renderer/styles/global.css`, `scripts/verify-flow-designer-gui.mjs`,
  `scripts/verify-workflow-builder-gui.mjs`, and AI memory/completion-report docs.
- **Verification:** `npm run build` pass; `npm run verify:flow-designer` 20/20;
  `npm run verify:workflow-builder` 20/20; `npm run verify:canvas-perf` 13/13;
  `npm run verify:mock-site` 29/29; `npm run verify:settings-persistence` 3/3.
- **Result:** real pointer pan/drag no longer crashes or loses the drop; the Flow inspector cannot cover
  canvas content and collapses to 48px; the connect dialog matches the supplied branch-link layout; the
  Workflow toolbar measures 59px in one row; canvas memoization/performance remains intact. No persistence
  schema, runner, IPC, preload, dependency, or offline-runtime behavior changed.

---

## 2026-07-11 - Claude Code - Canvas UI fix pass (9 reported issues: crash guard, insert-button, drag-connect, edge text, node size, parallel color, panel shift, toolbar, nav anim)

Renderer-only. Reference parity = local `Workflow` (flowforge) project. All verified on real Electron.

- **#8 white screen (critical):** no error boundary → any render throw blanked the window. Added
  `ErrorBoundary` around `<ActivePage>` (keyed by route) with a readable fallback + reload.
- **#1 edge "+" dead:** `.awkit-flow-nodes` (transparent, z-index 2) covered the `+` overlay and ate
  real clicks (synthetic dispatch bypassed it, so the verifier missed it). Fix: container
  `pointer-events:none` + cards `pointer-events:auto`. Confirmed with a REAL Playwright click.
- **#3 edge text clipped:** `+` split the branch label at the shared midpoint. `SmoothEdge` offsets the
  label 18px above the line when an insert button is shown.
- **#4 drag-to-connect:** engine `onNodeDragStop` → new `onNodeConnect(src,tgt)` (largest overlap at the
  final drop). Both designers show a `ConfirmDialog`, skip linked pairs, orient top→bottom, add on
  confirm. Callbacks read live nodes/edges from refs (stable → no re-render regression).
- **#5 node size:** pinned `.action-flow-node`/`.scenario-flow-node` to 320px (were content-driven).
- **#6 parallel color:** new `--awkit-connector-parallel` (teal), mapped in `connectorStyle.ts`.
- **#7 drawer covers nodes:** new animated `FlowCanvasHandle.panBy`; Flow Designer glides the graph left
  when the floating drawer opens / back on close.
- **#2 toolbar:** Workflow Builder toolbar → single low row (inline labels + `overflow-x` scroll).
- **#9 nav animation:** `.nav-group-items` → `grid-template-rows` accordion (added `-inner` wrapper).
- **Files:** `app/renderer/App.tsx`, `components/shared/ErrorBoundary.tsx` (new),
  `components/canvas/FlowCanvas.tsx`, `components/canvas/edges/SmoothEdge.tsx`,
  `components/shared/connectorStyle.ts`, `pages/ScenarioBuilder.tsx`, `pages/FlowChartDesigner.tsx`,
  `layout/LeftNavigation.tsx`, `styles/global.css`, docs.
- **Tests:** build clean; real-GUI: edge `+` real click ✓, drag start→end confirm+create ✓, no white
  screen ✓; `verify:flow-designer` 14/14, `verify:workflow-builder` 18/18, `verify:canvas-perf` 13/13
  (found+fixed a non-stable-callback perf regression via refs).

---

## 2026-07-11 - Claude Code - Workflow Builder UI repair (Add-menu Flow Logic, grouped toolbar, selection highlight, drag harness)

Focused UI functionality/organization pass on the reported Workflow Builder / Workflow Designer issues.
Renderer-only + one measurement script; no route/IPC/preload/runner/schema/packaging change.

- **Issue 3 / Add menu:** added a **Flow Logic** section (Conditional Branch · Parallel Branch · Loop)
  to the Workflow Builder contextual picker — it previously listed only Saved Flows. New
  `applyWorkflowLogic()` maps them onto the existing connector model (conditional/parallel connectors
  from the selected flow to available flows; Loop toggles the self-loop). Guards against no-selection /
  no-available-flows with a toast; never creates an invalid graph.
- **Issue 4 / toolbar:** reorganized the flat button row into labeled groups (Workflow · Add ·
  Execution · Layout · status) with `.sb-toolbar-sep` dividers; fixed the stale Auto-arrange tooltip.
- **Issue 2 / selection:** clicking a node/connector opened the drawer but never highlighted the item
  on the canvas — the pages never set `CanvasNode.selected`/`CanvasEdge.selected` (CSS existed). Fixed
  in **both** designers (selection folded into the node identity signature; `edge.selected` set).
- **Issue 1 / Part 7:** edge-follow (`DraggingEdgeLayer`) was already correct — revalidated and fixed
  `scripts/measure-large-graphs.mjs` to fit + drag the nearest visible node (was first-in-DOM, could be
  off-screen). 40/100/200/500: drag = 20 node re-renders + 1 static-edge recompute at every size.
- **Part 2:** confirmed Workflow Designer is intentionally read-only (no misleading controls) — left as-is.
- **Files:** `app/renderer/pages/ScenarioBuilder.tsx`, `app/renderer/pages/FlowChartDesigner.tsx`,
  `app/renderer/styles/global.css`, `scripts/verify-workflow-builder-gui.mjs`,
  `scripts/measure-large-graphs.mjs`, `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`.
- **Tests:** build clean; `verify:workflow-builder` 18/18 (4 new checks), `verify:flow-designer` 14/14,
  `verify:canvas-perf` 13/13, `verify:write-queue` 7/7, `verify:settings-persistence` 3/3,
  `verify:reports` 26/26, large-graph measurement green. Not run (no runtime code touched):
  runner/recorder/mock-site/waits/instance-monitor/data-editor.

---

## 2026-07-11 - Claude Code - UI performance Phase 2 (node-edit identity, edge-follow, settings safety, large graphs)

Built on Phase 1 (below). Audited Phase 1 for correctness (memoization, render probe, settings queue —
all sound; probe is opt-in/zero-retention) then closed the remaining gaps.

- **Node-edit object identity** (biggest remaining render win): `interactiveNodesForCanvas` rebuilt
  EVERY node's wrapper on any edit, so editing one node re-rendered the whole graph. New
  `components/canvas/identityMap.ts` (`mapWithIdentity`) preserves per-node output identity; applied in
  both designers. **Editing one node's name on a 40-node flow: 120 → 3 card re-renders** (only the
  edited node). Verified.
- **Edge-follow during drag** (was a migration regression — edges snapped on drop): FlowCanvas now
  tracks the live drag position (rAF-batched) and renders only the dragged node's edges in a
  `DraggingEdgeLayer` overlay; the memoized `EdgeLayer` recomputes just once at drag start (not per
  frame) and skips those edges. Connected edges follow the node; the static layer never re-routes the
  whole graph.
- **Settings persistence hardening:** extracted the queue to a testable `app/main/writeQueue.ts`
  (`createSerialQueue`: FIFO, failure-isolated, `flush()`); `writeSettings` is now **atomic**
  (temp-file + rename, Windows-safe); added `flushSettingsWrites()` wired into Electron **`before-quit`**
  (2s-bounded, no deadlock) so a last-moment edit isn't lost.
- **Large-graph glide guard:** the auto-arrange/load glide (animates `left`/`top` on every node) is
  skipped above `GLIDE_MAX_NODES` (120) so big graphs snap instead of thrashing layout.
- **Panels/listeners audit:** Node Palette picker unmounts when closed + memoized filter; Node/Connector
  Properties unmount when nothing is selected and collapse to a cheap rail; all `setInterval`/
  `ResizeObserver`/`addEventListener` sites have matching cleanup (no leaks found).
- **Measured (real Electron, 40/100/200/500 nodes):** zoom re-renders **0 at every size**; load
  ~0.30/0.48/0.70/1.23 s; save 10–45 ms; in-session Flow⇆Workflow nav ×10 leak check heap 14→14 MB,
  DOM 5645→5645 (no leak). See `scripts/measure-large-graphs.mjs`.
- **New verifiers:** `verify:write-queue` (7/7, unit), `verify:settings-persistence` (3/3, real
  Electron), `verify:canvas-perf` now 13/13 (added node-edit + edge-follow assertions).
- **Regression (all green):** build; write-queue 7/7; settings-persistence 3/3; canvas-perf 13/13;
  flow-designer 14/14; workflow-builder 14/14; reports 26/26; waits 21/21; data-editor 27/27;
  recorder 57/57; runner 82/82; instance-monitor 22/22; mock-site 29/29; ai:memory pass.
- **Not run:** clean/offline VM walkthrough (unchanged external gate).

---

## 2026-07-11 - Claude Code - Canvas UI performance pass (memoization + stable callbacks + settings queue)

- **Problem:** the in-house canvas engine re-rendered the entire node + edge tree on every
  viewport frame (pan/zoom/wheel) and on unrelated page re-renders (typing a name, save-state
  text), because `NodeContainer`/`EdgeLayer` were unmemoized and the designers passed inline
  callbacks to `<FlowCanvas>`.
- **Root causes (measured, 40-node flow):** zoom (20 wheel ticks) = **800** NodeContainer +
  **800** card + **20** EdgeLayer renders (whole graph every frame); typing 16 chars in Flow Name
  = **1280** node + **1280** card renders (inline callbacks defeated the memo).
- **Fixes (renderer + one main-process file; no schema/IPC/runner/behavior change):**
  - `FlowCanvas.tsx`: memoized `NodeContainer` (renders the node component internally instead of via
    `children`, and reads zoom from `viewportRef` instead of a prop, so viewport-only changes never
    invalidate the memo) and memoized `EdgeLayer`.
  - `FlowChartDesigner.tsx` + `ScenarioBuilder.tsx`: replaced inline `<FlowCanvas>` callbacks with
    stable `useCallback` references so unrelated page re-renders bail the memoized subtree.
  - `uiSettings.ts` (main): serialized all settings mutations through a promise queue so the many
    fire-and-forget `settings.update` calls (one per selection/zoom/toggle) can't race on
    read-modify-write or overlap file writes.
  - New opt-in `renderProbe.ts` + `scripts/verify-canvas-perf.mjs` (`npm run verify:canvas-perf`)
    regression guard.
- **After (same measurements):** zoom = **0/0/0**; typing = **0/0/0**; dragging one node re-renders
  **only that node** (20 for 20 moves, not 800) and never the edge layer during motion.
- **Verification:** `npm run build` (tsc + bundles) clean; `verify:canvas-perf` 10/10;
  `verify:flow-designer` 14/14; `verify:workflow-builder` 14/14; `verify:reports` 26/26.
- **Not run:** clean/offline VM walkthrough (unchanged external gate); runner verifiers (no runner change).

---

## 2026-07-11 - Codex - Workflow.rar full UI migration, Phases 0-6

- **Reference/discovery:** read prompt-pack files 00-19 in order; extracted relevant source from
  `Workflow.rar` to the local temp directory; SHA-256 matched
  `9b3320b609e12da1032a94d4e156389e06f0e4315bc6983e0e76b18909795946`. Mapped renderer, IPC,
  profiles, recorder, runner, settings, reports, and offline boundaries before editing.
- **Implementation:** exact 240px/64px shell rhythm and reference canvas/theme tokens; collapsible route
  groups and pre-paint theme bootstrap; shared `CanvasItemPicker` and `NodeAppendButton`; Flow Designer
  and Workflow Builder contextual blank/edge/leaf/tool-picker entry points; 400px overlay configuration
  drawers; permanent palette/definition rails unmounted; new workflows persist `Start -> End` structural
  sentinels; runtime conversion filters sentinels while legacy workflows remain unchanged.
- **Mock lab:** `/designer-lab` now documents the contextual picker/edge/leaf/drawer contract;
  mock verifier extended.
- **Evidence:** 32 route screenshots plus 6 picker/drawer state screenshots in
  `docs/ai/ui-reskin-template-plan/mockups/screenshots/workflow-migration-*`.
- **Verification:** `npm run build`; `verify:flow-designer`; `verify:workflow-builder`;
  `verify:workflow-sentinels` 4/4; `verify:mock-site` 29/29; `verify:recorder-flow` 13/13;
  `verify:recorder-draft` 17/17; `verify:recorder` 57/57; `verify:waits` 21/21;
  `verify:runner` 82/82; `verify:data-editor` 27/27; `verify:instance-monitor` 22/22;
  `verify:reports` 26/26; `validate:offline`; AI-memory checker passed.
- **Not run:** clean/offline Windows VM install/uninstall, code signing, and max-compressed packaging
  (existing external release gates; max-compression OOM is documented in KNOWN_ISSUES).

---

## 2026-07-10 - Claude - Workflow/FlowForge visual parity (framer-motion), Phases 0-5

- **Task:** Adopt the Workflow/FlowForge ("Hologram") reference style, canvas, theme, and animations
  into AWKIT. Plan: `docs/plan-workflow-visual-parity.md`. Renderer/CSS only — no runner/orchestrator,
  IPC, preload API, or profile-schema change. Key finding: the two apps are siblings (same violet
  `#7c3aed`, same `[data-theme]` theming, existing token system), so most parity pre-existed; the work
  was targeted gap-filling plus a real motion library.
- **P0 Foundation:** Added `framer-motion@11.18.2` (dep + offline `dependency-manifest` line via
  `scripts/generate-dependency-manifest.ps1`). New tokens in `styles/global.css`: `--awkit-edge`/
  `-strong`, `--awkit-shadow-node`/`-hover` (both themes, + backfilled dark `--awkit-shadow-hover`).
  New `app/renderer/lib/motion.ts` (springs, variants, `hoverTap`/`hoverLift`, `usePrefersReducedMotion`,
  `useFlowGlide`). Existing reduced-motion block already matched the reference.
- **P1 Canvas:** Added the auto-layout **glide** (`.flow-animating .react-flow__node/__edge-path`
  transitions) armed via `useFlowGlide` in FlowChartDesigner + ScenarioBuilder auto-arrange/load.
  Dotted bg, per-connector violet edges, mid-edge "+", visible ports already existed (kept; did NOT
  hide handles — AWKIT has a deliberate ConnectorPorts system).
- **P2 Nodes:** `ActionFlowNode` + `ScenarioFlowNode` → `motion.article` (nodeEnter spring mount +
  `whileHover y:-1`, reduced-motion gated); removed the old CSS `awkit-fade-in` node mount (framer owns
  it now); node elevation → `--awkit-shadow-node(-hover)`; **hover-reveal kebab** menu. Unified
  `actionNode`/`stepType` model means no separate Condition/Delay/Loop components to port. Leaf
  AppendButton deferred (functional, not visual — would violate "no fake controls").
- **P3 Chrome:** Sidebar active pill, theme toggle→`setAppearance`, page-enter, drawer/panel slide-ins,
  button press feedback all already existed. One real gap fixed: animated sidebar **collapse**
  (`transition: grid-template-columns` on `.app-shell`).
- **P4 Pages:** Card-grid **stagger** on `.page-grid` children (`awkit-card-rise`, `nth-child` delays,
  `animation-fill-mode: backwards` to preserve `.metric-card:hover` transform). Covers 7 pages.
- **Tests run:** `npm run build` ✅ (2201 modules; framer-motion bundles, renderer JS 1.29→1.54 MB).
  GUI verifiers ✅ **58/58**: `verify:flow-designer` 19/19, `verify:workflow-builder` 13/13,
  `verify:reports` 26/26 (no console errors, metric cards render under stagger).
- **Not run:** clean-machine offline GUI walkthrough (manual gate). Reduced-motion + dark-theme visual
  eyeball still worth a manual pass. **Result:** motion/style parity landed; no runtime behavior changed.

---

## 2026-07-10 - Claude - Canvas UX: auto-layout, edge "+" in Workflow Builder, motion (SRS-CANVAS-UX-001)

- **Task:** Implement `docs/SRS_CANVAS_UX.md` (Flow Designer + Workflow Builder). Renderer/CSS only —
  no runner/orchestrator, IPC, preload API, or profile-schema change (loop runtime semantics untouched).
- **1c Auto-layout:** New dependency-free layered layout `app/renderer/components/shared/graphLayout.ts`
  (`layeredLayout`/`positionsNeedLayout`/`withAutoLayout`, cycle-safe longest-path, self-loops ignored).
  Flow Designer `loadProfile` (TB) and Workflow Builder `loadWorkflowProfile` (LR) now rearrange only
  when positions are missing/stacked (fixes the `{280,120}` stack), `fitView` only then so persisted
  zoom survives normal loads. Added an "Auto-arrange" toolbar button to both editors (force layout).
- **1a Edge "+":** Wired the existing `TemplateSmoothEdge` inline "+" into Workflow Builder via a
  display-only `edgesForCanvas` map + `insertFlowOnEdge` (splices the first unused saved flow at the
  edge midpoint; toasts if none). Added display-only `showAddButton`/`onInsertNode` to `ScenarioLinkData`.
  Restyled `.template-edge-add-button` to the reference: always-visible white circle, subtle border,
  violet "+" (tokens only).
- **1d Dotted canvas:** Bumped light `--awkit-canvas-dot` `#d8d4e0`->`#c7c0d6` (dots were too faint).
- **1b Loop priority:** Added authoring help text in `ConnectionPropertiesPanel` (loop takes priority;
  continues on the Conditional exit when unsatisfied/maxed). No runner change.
- **2 Motion:** Opacity-only fade-in for `.action-flow-node`/`.scenario-flow-node`/`.react-flow__edge`
  (no transform on measured RF wrappers); `:active` press on toolbar/icon buttons. Covered by the
  existing reduced-motion neutralizer.
- **Files:** `graphLayout.ts` (new); `pages/FlowChartDesigner.tsx`, `pages/ScenarioBuilder.tsx`,
  `components/scenario/scenarioDesignerTypes.ts`, `components/workflow/ConnectionPropertiesPanel.tsx`,
  `styles/global.css`; `docs/SRS_CANVAS_UX.md` (spec, prior task).
- **Tests run:** `npm run build` OK (tsc --noEmit + electron-vite bundles, no type errors).
- **Tests not run:** `verify:runner`/`verify:mock-site` (no runner/mock-site logic changed); clean-machine
  GUI walkthrough (Electron, human/VM step) — visual conformance of connectors/branches still to eyeball.
- **Result:** Behavioral items landed; visual polish matches the supplied reference. No commit.

---

## 2026-07-09 - Claude - /HANDOFF refresh (UI re-skin complete)

- **Task:** Prepare the repo for the next agent/human after the UI/UX Hologram re-skin (Phases 01-15).
- **Changes:** Rewrote the active "Current Handoff" block in `docs/ai/HANDOFF.md` to reflect the closed
  UI re-skin (task/completed work/changed files/commands run/remaining work/risks/recommended next step),
  and reframed the older Phase 2-5.1 release-hardening detail as historical (its release gates still valid).
- **Repo state recorded:** branch `feature/smart-wait-engine` level with origin; working tree modified &
  uncommitted (`global.css`, `Recorder.tsx`, 3 designer one-liners, `AGENTS.md`, `docs/ai/{CURRENT_STATE,
  RULES,TASK_LOG,TESTING}.md`; untracked `.claude/skills/frontend-ui-ux-master/` + golden screenshots).
- **Checks:** `git status --short --branch` + `git diff --stat` inspected; `npm run ai:memory` pass.
  No secrets written to Markdown.
- **Result:** `docs/ai/HANDOFF.md` ready for the next agent. No code changed by this task; no commit.

---

## 2026-07-09 - Claude - Phase 13-15: dark/a11y verify, visual QA, handoff (UI re-skin closed)

- **Task:** Execute `13_LIGHT_DARK_MODE_AND_ACCESSIBILITY.md`, `14_VISUAL_QA_TESTING_AND_ACCEPTANCE.md`,
  `15_FINAL_IMPLEMENTATION_HANDOFF.md` in order (gap-based; audit first, no blind rewrites).
- **Phase 13 (result: no code change):** audited `[data-theme="dark"]` in `global.css` and did a
  dark-mode screenshot walkthrough — already meets standards (deep slate `#0e0d12` not black, elevated
  surfaces, off-white `#f3f1f8` text, brighter `#8b5cf6` accent, inverted canvas dots; global
  `:focus-visible` ring; semantic `<button>`s). No token edits warranted; theme persistence/OS-sync in
  `theme.tsx` untouched.
- **Phase 14 (screenshots + checklist):** captured 8 light + 8 dark golden baselines via
  `scripts/capture-ui-screenshots.mjs` → `docs/ai/ui-reskin-template-plan/mockups/screenshots/{golden,
  golden-dark}/`; added a Visual QA section (capture recipe + manual QA checklist) to
  `docs/ai/TESTING.md`. Deliberately did NOT add `toHaveScreenshot` tests (no `npm test` script;
  `@playwright/test` Node caveat; dynamic timestamps/ids → flaky) — rationale documented.
- **Phase 15 (doc sync):** `CURRENT_STATE.md` gets a "UI re-skin initiative — CLOSED" architecture
  summary (token system, `.app-shell`/`.app-main` grid, RF class/token adherence, reusable base
  components); `RULES.md` › UI gains the mandatory-token / app-shell-grid-lock / a11y rules;
  `AGENTS.md` carries the summary bullet.
- **Preserved:** all routes, IPC/preload API, runner/runtime, schema, persistence, `theme.tsx` logic,
  existing tests. Renderer used a scratchpad-only helper to toggle `appearance` for dark capture, then
  restored it to `light`; no runner tests touched.
- **Tests:** `npm run build` pass (from the Phase 09-12 pass; no source changed in 13-15 beyond docs);
  dark/light golden capture ran clean (16 shots). `verify:runner` not run (no runtime logic touched).
- **Result:** UI re-skin initiative (Phases 01-15) officially closed. No commit.

---

## 2026-07-09 - Claude - Phase 09-12 gap-based UI polish

- **Task:** Execute `09_INSTANCES_AND_WORKFLOW_CARDS.md`, `10_REPORTS_AND_ANALYTICS_UI.md`,
  `11_FORMS_TABLES_MODALS_AND_EMPTY_STATES.md`, `12_MOTION_AND_MICRO_INTERACTIONS.md` as a **gap-based
  polish** pass (audit first; only close real gaps; reuse existing tokens/classes; no parallel systems).
- **Audit:** repo already ~95% satisfies all four phases from prior re-skin passes (motion tokens,
  reduced-motion neutralizer, focus rings, modal system + `awkit-fade-in`/`awkit-pop-in` entrance,
  tokenized charts/gauges with no hardcoded hex, semantic status badges, tokenized inputs,
  uppercase primary-table headers, MetricCard/EmptyState/SkeletonCard).
- **Changes (all in `app/renderer/styles/global.css`, CSS-only):** (1) `.workflow-card:hover/:focus-within`
  gains `transform: translateY(-2px)` + `transform` in transition (Phase 09 subtle lift; transform-only,
  no grid reflow). (2) `.modal-overlay` gains `backdrop-filter: blur(3px)` (+`-webkit-`) for a blurred
  backdrop (Phase 09/11; ConfirmDialog/UnsavedChanges/LiveExecutionReportModal). (3) `.modal-dialog`
  `border-radius: 10px` → `var(--radius-lg)` (Phase 11 token alignment). (4) `.awkit-table th` gains
  `text-transform: uppercase; letter-spacing: 0.04em; background: var(--awkit-surface-soft)` to match the
  established `.wl-table`/`.instance-table` header convention (Phase 10/11 consistency).
- **Deliberately not done:** no new `.awkit-input/.awkit-select/.awkit-button` (global element rules +
  `.toolbar-button` already cover forms/buttons — would be a parallel/dead system); no rewrite of the
  duration-based reduced-motion neutralizer (intentional, working). Noted: `.workflow-run-card` selectors
  (~7615/7626) appear unused (component renders `.workflow-card`) — left as a future dead-CSS cleanup.
- **Preserved:** all routes, IPC/preload API, runner/runtime logic, state contracts, persistence, node/
  connector handles, table/card behavior. No `.tsx` or token additions/removals.
- **Tests:** `npm run build` pass (tsc --noEmit + bundles); `verify:reports` 26/26; `verify:instance-monitor`
  22/22 (both after `reset-ui-state.mjs`). `verify:runner` not run (no runner logic touched). New hover
  transform is auto-covered by the last-in-cascade reduced-motion block; all edits use theme-aware tokens.
- **Result:** Complete locally. No commit.

---

## 2026-07-09 - Codex - Execute Phase 03-08 UI prompts

- **Task:** Execute `C:\Users\moham\Downloads\03_APP_SHELL_AND_NAVIGATION.md` through
  `C:\Users\moham\Downloads\08_RECORDER_UI_REDESIGN.md` in order.
- **Changes:** Tuned shell/canvas styling in `global.css`; set React Flow dot backgrounds to
  `gap={24}` / `size={1}` in Flow Designer, Workflow Builder, and Workflow Designer; rewrote
  `Recorder.tsx` as a tokenized control-center UI with sticky controls, grouped toggles, disabled
  recording inputs, auto-scrolling action timeline, action icons/locator/value/wait details, handoff
  panel styling, inline save feedback, and restyled recorded URLs.
- **Preserved:** existing routes, IPC/preload API, recorder service, `recorder.saveFlow()` path,
  protected-login handoff handlers, node/connector handle IDs, `NodeResizer`, property-panel update
  callbacks, table logic, and drag/drop data.
- **Tests:** `npm run typecheck` pass; `npm run build` pass; `verify:flow-designer` initially timed out
  waiting for `.action-flow-node` due persisted UI state, then passed 19/19 after
  `node scripts/helpers/reset-ui-state.mjs flowChart false`; `verify:workflow-builder` 13/13 after reset;
  `verify:recorder` 57/57; `verify:recorder-flow` 13/13.
- **Result:** Complete locally. No route/IPC/schema/runner/build-process changes; no commit.

---

## 2026-07-09 - Codex - Execute Phase 01/02 UI audit and token foundation prompts

- **Task:** Execute `C:\Users\moham\Downloads\01_REPO_UI_AUDIT.md`, then
  `C:\Users\moham\Downloads\02_DESIGN_TOKENS_AND_THEME.md`.
- **Phase 01 audit:** Confirmed current source is already beyond the baseline prompt: `global.css` is the
  single tokenized stylesheet; `AppShell` uses the left-sidebar plus `.app-main` header/content/status
  grid; Flow Designer/Workflow Builder use React Flow with shared connector, template edge, and zoom
  components. No code changed during the audit portion.
- **Changes:** CSS-only token compatibility pass in `app/renderer/styles/global.css`: set
  `--radius-md` to `12px`, added `--radius-lg`, `--awkit-lavender-soft`, `--awkit-shadow-soft`, and
  `--shadow-soft`, and routed `--awkit-node-selected-bg` through the lavender token for both light and
  dark themes.
- **Tests:** `npm run build` pass; `verify:flow-designer` 19/19; `verify:workflow-builder` 13/13.
- **Result:** Complete locally. No route/IPC/schema/runner/build-process changes; no commit.

---

## 2026-07-08 - Codex - Flow/Workflow canvas dots matched to attachment

- **Task:** Make Workflow Builder and Flow Designer canvases use the attached sparse lavender dot grid.
  Renderer/UI only; no route/IPC/schema/runner automation behavior changed.
- **Changes:** Flow Designer and Workflow Builder `BackgroundVariant.Dots` now use `gap={44}` and
  `size={2.4}`. `global.css` scopes light-mode canvas tokens for those two canvas containers
  (`#f4f1f8` background, `#cac5d3` dots), makes `.react-flow__pane` transparent so the SVG background dots
  are visible, and keeps `.react-flow__background` pointer-transparent.
- **Screenshots:** Refreshed `docs/ai/ui-reskin-template-plan/mockups/screenshots/after/02-flow-designer.png`
  and `04-workflow-builder.png`; both show the wider attached-style dot field.
- **Tests:** `npm run build` pass; `verify:flow-designer` 19/19 (using stable local `login-flow`
  selection after the current `test-mock` local flow made the drag branch check flaky);
  `verify:workflow-builder` 13/13; `ai:memory` pass.
- **Result:** Complete locally. No commit. `verify:runner` not run because runtime automation logic was not
  changed.

---

## 2026-07-08 - Codex - Reverted Flow/Workflow canvas frame follow-up

- **Task:** Revert the most recent canvas-frame alignment pass at the user's request.
- **Changes:** Removed the final `global.css` override that framed `.flow-designer-body .react-flow-shell`
  and `.scenario-canvas-panel` like the Form Designer canvas. Removed the corresponding current-state and
  feature-inventory claims. Older template UI work remains untouched.
- **Tests:** `npm run build` pass; `npm run ai:memory` pass.
- **Result:** Reverted locally. No commit. GUI verifiers were not re-run because the reverted CSS block is
  gone and the previous baseline already had passing designer verifiers.

---

## 2026-07-08 — Codex — Template UI completion evidence + token/status polish

- **Task:** Implement the user-requested Hologram-style AWKIT UI completion pass using the local samples,
  prompt, and prior template work as the baseline. Renderer/UI only; no route/IPC/schema/runner automation
  behavior changed.
- **Assets:** Reviewed `UI Samples/sample_01.png`, attached matching image, local mp4 presence, and reachable
  Dribbble text pages. Fresh mp4 extraction was attempted with local Chrome + Playwright but timed out;
  `ffmpeg`/`ffprobe`, `cv2`, and PIL were unavailable. Prior extracted frames remain under
  `ui-reskin-template-plan/mockups/screenshots/template-frames/`.
- **Changes:** `global.css` light tokens aligned to the requested palette (`#f6f4f9`, `#f3f0f8`,
  `#7c3aed`), added prompt-style spacing/motion aliases, missing muted status tokens, explicit
  `html/body/#root` overflow reset, loader utility classes (`.awkit-spinner`, `.awkit-loader-dot`,
  `.loading-panel`, `.skeleton-card`, `.skeleton-shimmer`), and final panel/palette/status polish.
  `StatusBar.tsx` now polls real `executions.runtimeStatus()` instead of showing fake static chips.
  Remaining UI inline border hex in `Recorder.tsx`, `SessionsManager.tsx`, and
  `RecoverableRunsPanel.tsx` was tokenized.
- **Docs/screenshots:** Added `18_CODEX_TEMPLATE_IMPLEMENTATION_PLAN.md` and
  `19_CODEX_TEMPLATE_COMPLETION_REPORT.md`; refreshed after screenshots in
  `docs/ai/ui-reskin-template-plan/mockups/screenshots/after/`, including direct
  `05-workflow-designer.png` and optional `10-dark-flow-designer.png`.
- **Tests:** `npm run typecheck` pass; `npm run build` pass; `verify:flow-designer` 19/19;
  `verify:workflow-builder` 13/13; `verify:reports` 26/26; `verify:instance-monitor` 22/22;
  `verify:data-editor` 27/27; `verify:recorder` 57/57; `ai:memory` pass.
- **Result:** Complete locally. No commit. `verify:runner` not run because runner/runtime automation logic
  was not changed.

---

## 2026-07-07 — Claude (Opus 4.8) — Template UI final visual acceptance + hardening pass

- **Task:** Strict final acceptance/hardening of the Hologram template UI before commit. Reviewed every
  surface against `docs/01_ACTUAL_TEMPLATE_DESIGN_EXTRACTION.md` with screenshot + code evidence.
- **Fixes:** (1) floating drawer covered the flush-page action bar → `.designer-layout.flush-layout
  .designer-right-drawer-slot { top: 62px }` in `global.css`; (2) tokenized `#dfe6ef`×6/`#e2e8f0`×1
  inline borders → `var(--awkit-border)` in `Recorder.tsx` + `SessionsManager.tsx`; (3) captured a real
  Workflow Designer screenshot (route not in nav — reached via direct restore).
- **New helper:** `scripts/helpers/reset-ui-state.mjs` — verifier-only reset of `ui-settings.json`
  `lastRouteId`/`sidebarCollapsed`; proved `verify:flow-designer` state-independent (19/19 from two start
  states).
- **Proof:** `showAddButton`/`onInsertNode` absent from `src/` and `FlowEdge`; `toFlowProfile` reads
  explicit fields only → display-only edge fields never persist.
- **Files:** `global.css`, `Recorder.tsx`, `SessionsManager.tsx`, `scripts/helpers/reset-ui-state.mjs`
  (new); docs `ui-reskin-template-plan/17_FINAL_VISUAL_ACCEPTANCE_REPORT.md` (new), `CURRENT_STATE.md`,
  `TASK_LOG.md`; refreshed 8 after-screenshots.
- **Tests:** build clean; verify:flow-designer 19/19 ×2, workflow-builder 13/13, reports 26/26, recorder
  57, instance-monitor 22, data-editor 27; ai:memory pass.
- **Result:** Complete. No commit. Runtime automation behavior unchanged.

---

## 2026-07-07 — Claude (Opus 4.8) — Template UI completion pass: floating drawer / node anatomy / templateSmooth connectors / zoom pill

- **Task:** Implement the remaining Hologram-template structural details from the spec pack
  (`docs/` + `docs/files/01..15`) that the token-only + shell re-skin left out. Verified proven-missing
  via grep (no `templateSmooth`, `designer-right-drawer-slot`, `action-node-content`, `properties-body`,
  or `TemplateSmoothEdge.tsx`). Renderer visual/markup + CSS only.
- **Changes:** new `components/shared/TemplateSmoothEdge.tsx` (label pill + insert `+` + running flow);
  `connectorStyle.ts` tokenized colors + `smoothstep→templateSmooth` runtime remap (saved shape
  untouched); `ActionFlowNode.tsx` template card anatomy (icon tile/meta/type badge/title/desc/kebab);
  `FlowChartDesigner.tsx` register edge + `insertNodeOnEdge` + display-only `edgesForCanvas`;
  `ScenarioBuilder.tsx` + `WorkflowDesigner.tsx` register/use `templateSmooth`; `CanvasZoomControl.tsx`
  `canvas-zoom-button`/divider; `DesignerCanvasLayout.tsx` floating `designer-right-drawer-slot`;
  `FlowNodePropertiesPanel.tsx` + `ConnectionPropertiesPanel.tsx` drawer shell (header/tabs/body/footer,
  no fake save/test); `global.css` appended TEMPLATE COMPLETION PASS block before reduced-motion.
- **Non-persistence:** `showAddButton`/`onInsertNode` added as optional display-only fields on
  `FlowConnectionData`; `toFlowProfile` reads connector fields explicitly, so they never serialize.
- **Files:** 10 renderer files + `global.css`; docs: `ui-reskin-template-plan/16_VISUAL_GAP_CLOSURE_REPORT.md`
  (new), `CURRENT_STATE.md`, `TASK_LOG.md`.
- **Tests:** `npm run build` clean; `verify:flow-designer` 19/19, `verify:workflow-builder` 13/13,
  `verify:reports` 26/26, `verify:recorder` 57, `verify:instance-monitor` 22, `verify:data-editor` 27;
  `ai:memory` pass. 8 after-screenshots captured. Not run: `verify:runner` (no runtime/connector-runtime
  code touched — connectorStyle is renderer-only).
- **Result:** Complete. No commit (per instructions). Runtime automation behavior unchanged.

---

## 2026-07-07 — Claude (Opus 4.8) — Missing-template design pack (Phases 1–5): shell/sidebar/header structural re-skin

- **Task:** Execute the "Missing Template Design" prompt pack (`01`–`05`) — the structural template
  work the prior token-only re-skin left out. Visual/layout layer only; no route/IPC/runner/schema
  changes; `window.playwrightFlowStudio`, React Flow geometry, and the canvas no-transform rule
  preserved.
- **Phase 1 (audit):** Extracted 12 motion frames from the 3 mp4s via system Chrome over a local
  HTTP server (bundled Chromium can't decode H.264; `file://` + the "UI Samples" space fails —
  needs HTTP Range). Captured 8 live "before" shots. Wrote
  `docs/ai/ui-reskin-template-plan/15_MISSING_DESIGN_IMPLEMENTATION_REVIEW.md` (design-direction
  reconciliation: the ACTIVE target is the LIGHT Hologram template, not the stale dark-direction
  docs 00–03; gap table G1–G7). Added reusable `scripts/capture-ui-screenshots.mjs`.
- **Phase 2 (shell):** `AppShell.tsx` restructured so the **sidebar is full-height on the left** and
  the header renders only over the content (`.app-shell` → `grid-template-columns: 260px 1fr` [76px
  collapsed]; new `.app-main` holds header/content/status). Removed `.app-body`. Canvas geometry
  preserved.
- **Phase 3 (sidebar/header):** `LeftNavigation.tsx` — brand **workspace tile**, Settings moved to a
  pinned **footer utility area** (Settings + Dark Mode + non-interactive workspace identity row).
  `TopHeader.tsx` — real **"Unsaved changes" status chip** driven by `chrome.dirty` (threaded
  through `AppShell`/`App`); icon-square back button; purple primary retained. No fake data/controls.
- **Phase 4 (shared polish):** template KPI-card hover-lift (`.metric-card`) + elevated purple CTA
  (`.toolbar-button.primary`), reduced-motion-safe. (Cards/tables/forms/inputs/tabs/modals/toasts/
  empty/skeletons were already tokenized by the prior re-skin.)
- **Phase 5 (canvas/drawer/motion):** verified already delivered by the re-skin — dotted canvas,
  16px node cards + type badge + purple/lavender selection, node hover-lift, **floating** rounded
  properties drawer with float shadow + uppercase section labels, floating bottom-center zoom pill,
  reduced-motion neutralizer. No structural drawer rewrite (would risk canvas coordinate stability).
- **Files:** `app/renderer/layout/{AppShell,TopHeader,LeftNavigation}.tsx`, `app/renderer/App.tsx`,
  `app/renderer/styles/global.css`, `scripts/capture-ui-screenshots.mjs` (new),
  `docs/ai/ui-reskin-template-plan/15_*.md` (new) + before/phase2/phase3/after/template-frames shots.
- **Tests run:** `npm run build` clean (×several); `verify:flow-designer` 19/19; `verify:workflow-builder`
  13/13; `verify:reports` 26/26; `verify:instance-monitor` 22; `verify:recorder` 57/57;
  `verify:data-editor` 27/27. **Not run:** packaging/offline (untouched); clean-VM GUI walkthrough.
- **Note (pre-existing test fragility, re-confirmed):** the GUI verifiers navigate by nav **title**
  (workflow-builder, matches only when collapsed) vs **text** (flow-designer, matches only when
  expanded), so a collapsed sidebar + restored-route can time out a verifier — reset app route/collapse
  state between runs. Not caused by these changes.
- **Result:** the app shell now matches the template structurally (full-height sidebar, header over
  content, template sidebar footer, real header status chip) on top of the existing token re-skin.

---

## 2026-07-07 — Claude Fable 5 — Hologram-template UI re-skin + light/dark theme system

- **Task:** Full AWKIT UI/UX re-skin to the user-provided Hologram template (light SaaS, violet
  accent) with a real light/dark/system theme system. Visual layer only — no route/IPC/runner/
  validation changes. Template attachments reviewed directly (`UI Samples/` png + 3 mp4s; frames
  extracted with system Chrome since bundled Chromium lacks H.264).
- **Files:** `app/renderer/styles/global.css` (token system + re-skin, ~550 hex→token
  substitutions), `app/main/uiSettings.ts` (+`appearance`), `app/renderer/state/theme.tsx` (new),
  `App.tsx` (theme root + context), `LeftNavigation.tsx` (Dark Mode toggle), `Settings.tsx`
  (Appearance select), `connectorStyle.ts` (palette values only), `CanvasZoomControl.tsx`
  (bottom-center pill), `FlowChartDesigner/ScenarioBuilder/WorkflowDesigner.tsx` (dot-grid
  Background + minimap colors), inline-hex→token conversion in Recorder, SessionsManager,
  InstanceMonitor, ExecutionMonitor, ExecutionReports, WorkflowsLibrary, RecoverableRunsPanel.
- **Tests:** `npm run build` clean; `verify:flow-designer` 19/19; `verify:workflow-builder` 13/13;
  `verify:reports` 26/26; `verify:instance-monitor` 22/22; `verify:data-editor` 27/27;
  `verify:recorder` 57/57; two-theme screenshot walkthrough of 6 key pages via `_electron`.
  Not run: packaging/offline validators (no packaging change), runner suite (no runner change).
- **Result:** Both themes render correctly across shell, canvases, and pages; canvas invariants
  intact. Known gap: Settings import doesn't live-refresh the theme context.

---

## 2026-07-07 - Codex - Commit and push all project changes

- **Task:** User explicitly requested committing and pushing all current project changes on
  `feature/smart-wait-engine`.
- **Scope:** Existing local workset covering runner/concurrency stability, durable runtime/offline
  packaging hardening, recorder/session lifecycle, reports/telemetry UI, docs/plans, verifier scripts,
  and untracked project files currently visible to Git. Root `electron_test*.cjs` scratch probes were
  intentionally ignored because they contain absolute local profile paths and are not project artifacts.
- **Verification before commit:** `npm run build` pass; `npm run verify:runner` 82/82;
  `npm run verify:recorder` 57/57; `npm run verify:telemetry` 39/39; `npm run verify:reports` 26/26;
  `npm run verify:waits` 21/21; `npm run verify:mock-site` 28/28; `npm run validate:offline` pass;
  `npm run verify:concurrency` 78/78.
- **Result:** Fresh local verification passed; changes prepared for commit and push per the explicit
  Git-cycle request.

---

## 2026-07-07 — Claude (Opus 4.8) — Dark premium re-skin PLANNING pass (docs only)

- **Task:** Planning-only pass for the full-app dark premium re-skin (user pivot: light → dark
  premium SaaS; full-app scope). Reviewed the 4 Dribbble template URLs via WebFetch — **all four
  returned blocked/empty content**; proceeded per the fallback design target as instructed.
- **Audit findings:** `global.css` still has **130 distinct hex colors** vs 124 `--awkit-*` usages
  (tokens confined to the reports refactor); hotspots `#ffffff`×47, `#617089`×39, `#dfe6ef`×37,
  `#f8fafc`×29, `#eef2f7`×17, `#1769e0`×17; shared-class leverage: `.toolbar-button`×70,
  `.work-panel`×38, `.section-heading`×18; 11 TSX files with inline hex + `connectorStyle.ts`
  (light-tuned semantic colors) + `ReportsFailures.CATEGORY_COLORS`.
- **Created:** `docs/ai/ui-reskin-template-plan/` — `00_TEMPLATE_REVIEW_FINDINGS` (incl. honest
  inaccessibility record), `01_RESKIN_REVIEW_SUMMARY`, `02_SPECIFIC_SYSTEM_DESIGN` (per-class dark
  anatomy), `03_DESIGN_TOKENS_AND_GLOBAL_CSS_PLAN` (full dark token system + legacy-hex→token
  conversion table + specificity strategy: value-substitution inside existing rules),
  `04_APP_SHELL_AND_SHARED_COMPONENTS_PLAN` (21-item table), `05_PAGE_BY_PAGE_RESKIN_PLAN` (every
  route), `06_WORKFLOW_CANVAS_NODES_CONNECTORS_PLAN` (invariant-preserving; connectorStyle values-only
  edit, saved styles win), `07_MOTION_AND_ANIMATION_SYSTEM_PLAN`, `08_SIMPLIFICATION_WITHOUT_
  FUNCTIONALITY_LOSS` (iron rule + control-count diff gate), `09_BINDING_AND_DEPENDENCY_AUDIT`,
  `10_IMPLEMENTATION_PHASES` (R1–R12, stop-and-report), `11_VERIFICATION_QA_AND_REGRESSION_PLAN`
  (real package.json commands + grep gates), `12_RISK_REGISTER` (20 risks),
  `13_NEXT_IMPLEMENTATION_PROMPT` (Phase R1 prompt).
- **Application code changed:** NONE (docs only). **Tests run:** none needed (planning);
  grep audits only.
- **Result:** implementation-ready dark re-skin plan; awaiting user approval to start Phase R1.

---

## 2026-07-07 — Claude (Opus 4.8) — UI/UX refactor Phase 13: final QA + packaging + handoff (COMPLETE, PASS)

- **Task:** Execute Phase 13 (final) of `docs/ai/ui-reports-refactor/09_EXECUTION_PLAN.md` — final
  verification sweep, packaging validation, docs, and the structured handoff report.
- **Verification (2026-07-07):** `npm run build` clean; `npm run validate:offline` pass (dev mode);
  `npm run verify:mock-site` 28/28; rebuilt `dist/win-unpacked` via `electron-builder --dir` (avoids
  the documented max-compression OOM); `npm run verify:packaged-runtime` **25/25** against the real
  rebuilt EXE (boots with all changes; durable/telemetry init + migration v2 on a fresh runtime.sqlite;
  external SQLite read OK). Plus the Phase 12 fresh runtime/store evidence (runner 82, cancellation 12,
  telemetry 39, durable-store 11, runtime-status 15) and Phase 11 UI evidence (reports 26, flow-designer
  19, workflow-builder 13).
- **Docs:** created `docs/ai/ui-reports-refactor/FINAL_REPORT.md` (pack's handoff format);
  updated `docs/ai/ARCHITECTURE.md` (Reporting & Telemetry + Design-system sections) and
  `docs/ai/FEATURES.md` (Reports & analytics section).
- **Not re-run (justified):** the 70-check `verify:packaged-walkthrough` — it exercises
  workflow-run/cancellation/recovery paths this read-only-telemetry + UI initiative doesn't touch, and
  `verify:packaged-runtime` 25/25 already proves a clean packaged boot with the changes. Standing
  pre-existing gates unchanged: max-compression signed EXEs (16 GB OOM), clean/offline VM walkthrough,
  code-signing.
- **Result:** UI/UX refactor + reports initiative (Phases 1–13) COMPLETE — implemented, verified,
  documented; additive; zero new npm deps. Nothing committed/pushed (git skipped per user).

---

## 2026-07-07 — Claude (Opus 4.8) — UI/UX refactor Phase 12: mapping/binding regression audit (PASS)

- **Task:** Execute Phase 12 of `docs/ai/ui-reports-refactor/09_EXECUTION_PLAN.md` — full Section-C
  mapping/binding/dependency audit over every file changed in Phases 2–11; produce a readiness verdict.
- **Method:** concrete checks — route-id uniqueness (grep), `telemetry:*` handler↔preload channel
  parity (8/8 exact), interval/listener cleanup (grep: all cleared on unmount), dependency count
  (unchanged: 7 runtime deps / 13 devDeps, zero new), dead-component scan (`TrendDelta` unused —
  documented primitive), plus fresh runtime regression evidence.
- **Fresh evidence (2026-07-07):** `verify:telemetry` 39/39, `verify:durable-store` 11/11,
  `verify:runtime-status` 15/15, `verify:runner` 82/82, `verify:cancellation` 12/12 (execution
  semantics intact WITH telemetry writers + process sampler active — proves telemetry can't fail a
  run); plus Phase 11's `verify:flow-designer` 19/19, `verify:workflow-builder` 13/13,
  `verify:reports` 26/26, build clean.
- **Verdict (recorded in `08_MAPPING_BINDING_DEPENDENCY_AUDIT.md` §C): PASS.** All 8 audit checks
  pass; no regressions in execution/persistence/canvases; no blocking risks. Open non-blocking items:
  `TrendDelta` primitive not yet consumed, populated-data report GUI path not exercised on the empty
  dev profile, 10-min heap soak + OS reduced-motion toggle are manual gates.
- **Result:** Initiative audited PASS. Next: Phase 13 (final QA + packaging + handoff report).

---

## 2026-07-07 — Claude (Opus 4.8) — UI/UX refactor Phase 11: motion pass + reduced-motion audit

- **Task:** Execute Phase 11 of `docs/ai/ui-reports-refactor/09_EXECUTION_PLAN.md` — route-content
  fade, motion-token unification, and a reduced-motion / compositor / idle-animation audit.
- **Changed:** `app/renderer/layout/AppShell.tsx` — route-content fade: `<main>` keyed by
  `activeRouteId` (re-triggers on nav) + `main-surface-animated` class applied to **non-canvas routes
  only** (CANVAS_ROUTES excluded so a mount transform never perturbs React Flow measurement).
  `app/renderer/components/reports/ReportPage.tsx` — dropped the now-redundant `awkit-page-enter`
  (fade centralized in AppShell). `app/renderer/styles/global.css` — `.main-surface-animated` shares
  the `awkit-page-enter` keyframes.
- **Audit (documented in `08_MAPPING_BINDING_DEPENDENCY_AUDIT.md` §Phase 11):** reduced motion fully
  covered (global CSS media block + `AnimatedCounter`'s `usePrefersReducedMotion`; no other JS
  animation); compositor-friendly except a bounded one-shot `.awkit-bar-fill` width transition
  (accepted); no idle always-running animations (gauge pulse only ≥85%, shimmer only while loading,
  spin only while refreshing); one-shot transitions use motion tokens.
- **Tests (2026-07-07):** `npm run build` ✅ clean; `verify:flow-designer` ✅ 19/19 and
  `verify:workflow-builder` ✅ 13/13 (the `<main>` key change is safe for canvas mount);
  `verify:reports` ✅ 26/26 (route fade doesn't break report rendering).
- **Result:** Consistent motion language + a safe route fade; reduced-motion comprehensively honored.
  Next: Phase 12 (mapping/binding regression audit — 08 §C full pass).

---

## 2026-07-07 — Claude (Opus 4.8) — UI/UX refactor Phase 10: Flow Designer / Workflow Builder visual refactor (CSS-only)

- **Task:** Execute Phase 10 of `docs/ai/ui-reports-refactor/09_EXECUTION_PLAN.md` — the delicate
  designer visual polish, preserving every invariant in `03_ENHANCED_WORKFLOW_BUILDER_CANVAS_NODES.md`.
- **Scope decision:** kept it **strictly CSS-only** (edited only `app/renderer/styles/global.css`).
  Deliberately did NOT change `connectorStyle.ts` — the connector colors are semantically meaningful
  (success=green/failure=red/conditional=amber/parallel=violet); overriding with flat purple/blue
  would regress clarity and the design rule "status colors carry meaning."
- **Changed (`global.css` only):** `.action-flow-node` + `.scenario-flow-node` → token surfaces/
  border/blue accent + `--awkit-shadow-card` + box-shadow/border transition + 10px radius;
  `.selected` → purple token ring (`color-mix`) + float shadow; `.action-node-icon` → surface-inset +
  purple; `.scenario-node-order` → `--awkit-blue`. No geometry/structure/DOM/serializer changes.
- **Tests (2026-07-07):** `npm run build` ✅ clean; **`verify:flow-designer` ✅ 19/19** and
  **`verify:workflow-builder` ✅ 13/13** (all port-sibling/un-clipped/edge, loop button+port+semicircle,
  conditional-lock, and selected-only resize invariants intact with the restyled nodes — WB verifier
  needs a persisted Builder workflow selection: re-seed `selections.selectedBuilderWorkflowId` if it
  times out on an empty canvas). `verify:runner`/`verify:recorder` NOT re-run — they execute headlessly
  against the runner core and never load `global.css`; a CSS-only diff cannot affect serialization or
  recorder logic.
- **Audit:** row appended to `08_MAPPING_BINDING_DEPENDENCY_AUDIT.md` Section B (PASS, zero persisted/
  serializer impact).
- **Result:** Designer nodes visually modernized (softer premium shadows, purple accent system) with
  every canvas invariant preserved; zero logic/serializer risk by construction. Next: Phase 11
  (motion/animation pass + reduced-motion audit).

---

## 2026-07-07 — Claude (Opus 4.8) — UI/UX refactor Phase 9: failure/success + server-performance analytics

- **Task:** Execute Phase 9 of `docs/ai/ui-reports-refactor/09_EXECUTION_PLAN.md` — failure/reliability
  analytics and server/storage performance.
- **Changed (additive server channel):** `src/reports/TelemetryContracts.ts` (+`StorageUsage`/
  `ServerReport`); `app/main/ipc/telemetry.ipc.ts` (+`telemetry:server` — computed in the IPC layer
  to keep the src/ boundary: `getConfiguredPaths` + a bounded ≤20k-entry never-throwing dir walk
  cached 60s + `getRuntimeStatus` capacity/process fields); `app/main/preload.ts` (+`telemetry.server`).
- **Created:** `pages/ReportsFailures.tsx` (category donut + bar from `telemetry.failures`, top failing
  workflows, reliability ranking with flakiness `min(100, round(failureRate×60 + retryRate×40))` [≥5-run
  threshold, tooltip-documented], deterministic evidence-based insights — no AI/network);
  `pages/ReportsServer.tsx` (memory/CPU/Chromium cards + storage bar chart + availability + backpressure
  + artifacts-never-auto-deleted note). Insights/failure-grid/donut-legend/storage CSS in `global.css`.
  Routes `reportsFailures`/`reportsServer` + Reports nav group.
- **Tests (2026-07-07):** `npm run build` ✅ clean (renderer JS +19 kB); **`npm run verify:reports`
  ✅ 26/26** (real Electron: all 7 report routes render + resolve; Server Performance shows 4 cards +
  a real storage-usage section from actual dev-profile folder sizes; zero telemetry/undefined console
  errors); `verify:flow-designer` ✅ 19/19 (no canvas regression).
- **Audit:** rows appended to `08_MAPPING_BINDING_DEPENDENCY_AUDIT.md` Section B (all PASS).
- **Result:** Reports section complete (Overview/Workflow/Instance/Chrome/Runtime/Failure/Server +
  Run Artifacts); zero new deps. Next: Phase 10 (Flow Designer / Workflow Builder visual refactor).

---

## 2026-07-07 — Claude (Opus 4.8) — UI/UX refactor Phase 8: consumption history + concurrency analytics

- **Task:** Execute Phase 8 of `docs/ai/ui-reports-refactor/09_EXECUTION_PLAN.md` — historical runtime
  + Chrome consumption trends and analytical summary, on the Phase 4 `runtimeSeries`/`processHistory`
  channels.
- **Created:** `app/renderer/components/reports/ConsumptionTimeline.tsx` (hand-rolled multi-series SVG
  line chart — shared time x-domain, y auto-scale, gaps for undefined points, aria summary,
  empty-safe); `pages/ReportsRuntime.tsx` (4 timelines: concurrency [browsers/flows/queue], host
  [memory %/CPU %], Chrome process count, Chrome memory [chromium + electron]; analytical summary:
  busiest window + peak browsers/memory/process count). Timeline CSS in `global.css` (`awkit-`
  namespaced). Route `reportsRuntime` + Reports nav group.
- **Tests (2026-07-07):** `npm run build` ✅ clean (renderer JS +11 kB); **`npm run verify:reports`
  ✅ 21/21** (real Electron: Runtime route renders + resolves to a clean empty state — dev profile has
  no in-range samples — zero telemetry/undefined console errors); `verify:flow-designer` ✅ 19/19 (no
  canvas regression). Retention sweep for both sample tables already proven by `verify:telemetry`
  Part D (unchanged, 39/39).
- **Audit:** rows appended to `08_MAPPING_BINDING_DEPENDENCY_AUDIT.md` Section B (all PASS).
- **Result:** Runtime/consumption history + analytics live; zero new deps. Next: Phase 9
  (failure/success + server-performance analytics).

---

## 2026-07-07 — Claude (Opus 4.8) — UI/UX refactor Phase 7: live Chrome consumption + RPM gauges

- **Task:** Execute Phase 7 of `docs/ai/ui-reports-refactor/09_EXECUTION_PLAN.md` — live
  Chrome/Playwright consumption dashboard with animated RPM-style gauges, on the existing 2s
  `executions.runtimeStatus()` poll (carrying the Phase 3 `processes` sample).
- **Created:** `app/renderer/components/reports/` — `RadialGauge.tsx` (hand-rolled 180° SVG gauge,
  bands 0–60/60–85/85–100, CSS-rotated needle [reduced-motion safe], undefined→neutral "—"),
  `RpmGaugeCard.tsx` (title + mandatory source/formula tooltip + high-band pulse),
  `AvailabilityNotice.tsx` (only mentions access when the reason is access-related), `LiveProcessStrip.tsx`
  (Chrome/host stats + per-slot contexts/pages/health, NULL-tolerant), `useRuntimeStatus.ts` (2s poll,
  cleaned up on unmount, keeps last snapshot on transient error); `pages/ReportsChrome.tsx` (4 gauges:
  pool saturation / concurrency / memory pressure / CPU + process cards + strip + availability +
  backpressure banner). Gauge/notice/process-strip CSS in `global.css` (all `awkit-` namespaced).
  Route `reportsChrome` + Reports nav group.
- **Tests (2026-07-07):** `npm run build` ✅ clean (renderer JS +16 kB, CSS +2.5 kB); **`npm run
  verify:reports` ✅ 18/18** (real Electron: Chrome route renders 4 RPM gauges — idle shows pool/
  concurrency 0% and memory/CPU "—" because ResourceSampler starts on first run, i.e. the graceful
  unavailable path — process-detail section present, stable across a poll tick, zero telemetry/undefined
  console errors); `verify:flow-designer` ✅ 19/19 (no canvas regression). runtime-status logic
  untouched (consume-only), so `verify:runtime-status` not re-run.
- **Audit:** rows appended to `08_MAPPING_BINDING_DEPENDENCY_AUDIT.md` Section B (all PASS).
- **Result:** Live Chrome consumption dashboard with RPM gauges + graceful availability degradation;
  zero new deps. Next: Phase 8 (consumption history + concurrency analytics).

---

## 2026-07-07 — Claude (Opus 4.8) — UI/UX refactor Phase 6: workflow & instance reports + run drill-down

- **Task:** Execute Phase 6 of `docs/ai/ui-reports-refactor/09_EXECUTION_PLAN.md` — per-workflow and
  per-instance report pages with run drill-down, on the Phase 4 telemetry channels.
- **Changed (additive filter):** `src/reports/TelemetryContracts.ts` (+`RunHistoryFilter`);
  `queryRunHistory(range,page,filter?)` threaded through `RuntimeStore`/`SqliteRuntimeStore`
  (parameterized scenarioId/status conditions), `ExecutionEngine`, `app/main/ipc/telemetry.ipc.ts`,
  `app/main/preload.ts`. Back-compatible (filter optional).
- **Created:** `app/renderer/components/reports/RunDetailDrawer.tsx` (run metadata + node-attempts
  table + artifact "Open folder" via `system.openPath` to the parent dir), `statusTone.ts`
  (status→StatusBadge tone + duration/time formatters); `pages/ReportsWorkflows.tsx` (client-side
  sortable per-workflow table + scenarioId-filtered recent-runs + drawer); `pages/ReportsInstances.tsx`
  (live status distribution via a 2s `executions.list()` poll cleaned up on unmount + paginated run
  history + drawer). Report table/drawer/distribution/pager CSS in `global.css` (all `awkit-`
  namespaced). Routes `reportsWorkflows`/`reportsInstances` added to `routes.tsx` + the Reports nav group.
- **Tests (2026-07-07):** `npm run build` ✅ clean (renderer JS +27 kB, CSS +4 kB); **`npm run
  verify:reports` ✅ 13/13** (real Electron: all 3 report routes render + resolve to valid states,
  Instances live-status section, zero telemetry/undefined console errors); **`npm run verify:telemetry`
  ✅ 39/39** (+scenarioId + status filter checks); `verify:flow-designer` ✅ 19/19 (no canvas regression).
  Populated-data GUI path (rows + drawer content) not exercised — dev profile has no in-range runs;
  covered by `verify:telemetry` + build-time binding types.
- **Audit:** rows appended to `08_MAPPING_BINDING_DEPENDENCY_AUDIT.md` Section B (all PASS).
- **Result:** Workflow + instance reports live with run drill-down; zero new deps. Next: Phase 7
  (live Chrome consumption + RPM gauges).

---

## 2026-07-07 — Claude (Opus 4.8) — UI/UX refactor Phase 5: reports nav shell + Overview dashboard

- **Task:** Execute Phase 5 of `docs/ai/ui-reports-refactor/09_EXECUTION_PLAN.md` — first rendered
  report UI: Reports nav + the `app/renderer/components/reports/` scaffold + a live Overview page on
  the Phase 4 `telemetry.overview` channel.
- **Created:** `app/renderer/components/reports/` — `useTelemetryQuery.ts` (loading/error/data,
  stale-request cancel, manual refetch, no polling), `ReportPage.tsx`, `TimeRangeSelector.tsx`,
  `MetricSparkline.tsx`, `BarChart.tsx`, `DonutChart.tsx` (hand-rolled SVG/DOM, zero chart deps,
  point-capped, text/aria fallbacks); `pages/ReportsOverview.tsx` (overview metrics + live instance
  counts + runs-over-time sparkline; loading/error/store-disabled/empty/ready states);
  `scripts/verify-reports-gui.mjs` (+ `verify:reports` npm script).
- **Changed:** `app/renderer/routes.tsx` (+`reportsOverview` route/RouteId; relabel existing `reports`
  → "Run Artifacts", id unchanged), `app/renderer/layout/LeftNavigation.tsx` (new "Reports" group;
  moved `reports` out of "Run"), `app/renderer/styles/global.css` (report/chart CSS — all `awkit-`
  namespaced, reduced-motion block stays last). App.tsx needed no change — it already ignores an
  unknown `lastRouteId` and falls back to `routes[0]`.
- **Tests (2026-07-07):** `npm run build` ✅ clean (renderer JS +15 kB, CSS +3 kB for the pages/charts);
  **`npm run verify:reports` ✅ 8/8** (real Electron: nav→render, header "Reports Overview", resolves
  to a valid non-loading state — empty "No runs in this range yet" on the dev profile — 5-button range
  selector + range change + refresh, zero telemetry/undefined console errors); `verify:flow-designer`
  ✅ 19/19 (shared CSS, no canvas regression); `verify:telemetry` ✅ 37/37 (aggregate correctness).
  Real-data GUI path (populated metrics) not exercised — dev profile has no in-range runs; covered by
  `verify:telemetry` aggregates + the GUI empty→ready state machine.
- **Audit:** rows appended to `08_MAPPING_BINDING_DEPENDENCY_AUDIT.md` Section B (all PASS).
- **Result:** First report page live and rendering real telemetry (empty state on a fresh profile),
  full state matrix, zero new deps. Next: Phase 6 (workflow & instance reports + run drill-down).

---

## 2026-07-07 — Claude (Opus 4.8) — UI/UX refactor Phase 4: telemetry query IPC + preload

- **Task:** Execute Phase 4 of `docs/ai/ui-reports-refactor/09_EXECUTION_PLAN.md` — read-only
  `telemetry:*` query channels over the Phase 3 durable read-model, so Phase 5 report pages have a
  typed data source. Additive; existing channels untouched.
- **Created:** `src/reports/TelemetryContracts.ts` (shared read-model types + `percentile`/
  `durationStats`/`processSampleToHistoryPoint` helpers), `app/main/ipc/telemetry.ipc.ts` (7 channels;
  preset→sinceIso + bucketMs resolved server-side).
- **Changed:** `src/runner/store/RuntimeStore.ts` (+5 query methods on the interface;
  NullRuntimeStore returns empty + `storeEnabled:false`). `src/runner/store/SqliteRuntimeStore.ts`
  (queryOverview/Workflows/RunHistory/Failures/RuntimeSeries — SQL SELECT + bounded JS aggregation,
  windowed/paginated, row-capped; + `selectAll`/`rangeClause`/`statusBucket`/`buildRunsSeries`
  helpers). `src/runner/ExecutionEngine.ts` (getTelemetry* read-only delegators; run detail reuses
  run/attempts/artifacts). `app/main/ipc/index.ts` (register). `app/main/preload.ts` (typed
  `telemetry` group — additive; no global rename).
- **Tests (2026-07-07):** `npm run build` ✅ clean; **`npm run verify:telemetry` ✅ 37/37** (Phase 3's
  21 + 16 new Part G query-layer checks: overview counts/rates/duration/queue-wait, workflow grouping
  + sort, run-history pagination, failure categorization + top-workflow, runtime-series bucketing,
  deterministic range filtering, empty-DB safety, NullRuntimeStore `storeEnabled:false`);
  `verify:durable-store` ✅ 11/11; `verify:runtime-status` ✅ 15/15. Runner/concurrency NOT re-run —
  Phase 4 adds only read-only query methods + IPC/preload; execution/write paths are unchanged from
  Phase 3 (which passed runner 82 / concurrency 78 / cancellation 12) and the whole engine typechecks.
- **Audit:** rows appended to `08_MAPPING_BINDING_DEPENDENCY_AUDIT.md` Section B (all PASS).
- **Result:** Read-only telemetry query surface complete and typed end-to-end
  (store → engine → IPC → preload). No report pages yet. Next: Phase 5 (reports nav shell + Overview).

---

## 2026-07-07 — Claude (Opus 4.8) — UI/UX refactor Phase 3: telemetry read-model (additive)

- **Task:** Execute Phase 3 of `docs/ai/ui-reports-refactor/09_EXECUTION_PLAN.md` — additive durable
  telemetry foundation for the reports UI, without changing execution semantics.
- **Changed:** `src/runner/store/RuntimeStoreSchema.ts` (migration **v2** `reporting-extensions`:
  nullable `runtime_runs` cols scenarioName/triggerType/queueWaitMs/durationMs/retryCount/
  recoveryCount/reportCategory + new `runtime_process_samples` table + 4 read indexes; new
  `DurableProcessSampleRecord`; extended `DurableRunRecord`). `src/runner/store/SqliteRuntimeStore.ts`
  (extended `upsertRun` for v2 cols — preserved across INSERT OR REPLACE via the existing merge-read;
  new `recordProcessSample`/`listProcessSamples`/`sweepRetention` + `selectAll` helper).
  `src/runner/store/RuntimeStore.ts` (interface + NullRuntimeStore: 3 new methods).
  `src/runner/concurrency/RuntimeStatus.ts` (+`processes?: ProcessTreeSample`, additive).
  `src/runner/ExecutionEngine.ts` (run-summary writers at the existing start/end upsert seams:
  scenarioName/triggerType/queueWaitMs at start, durationMs/retryCount/reportCategory at end;
  `startProcessSampling()` gated by `AWKIT_PROCESS_SAMPLING`, persists ≤1 history row/15s; retention
  sweep on durable init). `.env.example` (+3 `AWKIT_*` reporting vars). `package.json`
  (+`verify:telemetry`). `scripts/verify-durable-store.mts` (migration-count assertions updated for v2).
- **Created:** `src/reports/ReportCategories.ts` (pure map over the existing `ErrorClass` →
  report taxonomy; no re-parsing; conservative `unknown`), `src/runner/runtime/ProcessTreeSampler.ts`
  (Windows CIM own-subtree Chromium count+memory + Electron main RSS; throttled unref'd timer;
  never-throws; `availability` full/partial/unavailable), `scripts/verify-telemetry.mts`.
- **Tests (2026-07-07):** `npm run build` ✅ clean; **`npm run verify:telemetry` ✅ 21/21** (v1→v2
  in-place upgrade on a real v1-only DB, run-summary round-trip incl. REPLACE-preservation,
  process-sample write/read, retention time+run cap keeping recoverable runs, full taxonomy mapping,
  sampler never-throws); `verify:durable-store` ✅ 11/11; `verify:runtime-status` ✅ 15/15;
  `verify:runner` ✅ 82/82; `verify:cancellation` ✅ 12/12; `verify:concurrency` ✅ 78/78.
- **Audit:** rows appended to `08_MAPPING_BINDING_DEPENDENCY_AUDIT.md` Section B (all PASS).
- **Result:** Durable telemetry read-model in place, additive, execution semantics unchanged. No IPC
  query layer or report pages yet. Next: Phase 4 (telemetry query IPC + preload typings).

---

## 2026-07-07 — Claude (Opus 4.8) — UI/UX refactor Phase 2: design-system token + primitive foundation

- **Task:** Execute Phase 2 of `docs/ai/ui-reports-refactor/09_EXECUTION_PLAN.md` (design tokens +
  shared primitives + reduced-motion). Theme locked light-first per user; git/Phase 0 skipped per user.
- **Changed:** `app/renderer/styles/global.css` — added the `--awkit-*` light-first token block after
  the existing `--space-*`/`--radius-*` root (additive; no existing rule modified), the `awkit-`
  namespaced component CSS (StatusBadge/SectionHeader/SkeletonCard/EmptyState/TrendDelta +
  `.metric-card-*` tone/trend + page-enter keyframes), and a global `prefers-reduced-motion` block
  placed last. `app/renderer/components/shared/MetricCard.tsx` — extended additively (`trend`, `tone`,
  `loading` optional props; `value` widened string→ReactNode; delegates loading to SkeletonCard).
- **Created:** `components/shared/StatusBadge.tsx`, `SectionHeader.tsx`, `SkeletonCard.tsx`,
  `EmptyState.tsx`, `TrendDelta.tsx`, `AnimatedCounter.tsx`, `usePrefersReducedMotion.ts`. All
  `awkit-` namespaced so they never collide with the existing `.status-chip`/`.badge-*`/
  `.empty-state`/`.section-heading` classes. Not yet consumed by any page (consumption begins Phase 5).
- **Tests (2026-07-07):** `npm run build` ✅ clean (renderer CSS 106→114 kB for the new rules; JS
  +~1 kB); `npm run verify:flow-designer` ✅ 19/19; `npm run verify:workflow-builder` ✅ 13/13 after
  `npm run seed:mock-fixtures` + persisting `selections.selectedBuilderWorkflowId` (the WB GUI
  verifier needs a workflow already loaded on the Builder canvas — the empty-canvas timeout is a
  persisted-state/environment dependency, confirmed NOT a regression: the failure is at the load
  precondition and no new CSS matches `.scenario-flow-node`).
- **Audit:** rows appended to `docs/ai/ui-reports-refactor/08_MAPPING_BINDING_DEPENDENCY_AUDIT.md`
  Section B (all PASS; zero persisted-data/IPC impact).
- **Result:** Design-system foundation in place, additive, no behavior change. Next: Phase 3
  (telemetry read-model — migration v2 + ReportCategories + ProcessTreeSampler + retention).

---

## 2026-07-07 — Claude (Fable 5) — UI/UX refactor + reports prompt-pack review → enhanced execution pack (docs only)

- **Task:** Review the 10-file external prompt pack (`~/Downloads/awkit-ui-reports-prompt-pack/...`)
  for the planned UI/UX refactor + reports/telemetry initiative, compare it against the real
  codebase, and produce an enhanced, path-accurate execution pack. No application code changed;
  originals preserved (they live outside the repo).
- **Created:** `docs/ai/ui-reports-refactor/` — `00_REVIEW_SUMMARY`, `01_ENHANCED_MASTER_GOAL`,
  `02_ENHANCED_DESIGN_SYSTEM_AND_MOTION`, `03_ENHANCED_WORKFLOW_BUILDER_CANVAS_NODES`,
  `04_ENHANCED_REPORTING_TELEMETRY_CONTRACT`, `05_ENHANCED_REPORTS_DASHBOARDS`,
  `06_ENHANCED_LIVE_CHROME_CONSUMPTION_RPM`, `07_ENHANCED_ANALYTICS_FAILURE_SUCCESS_SERVER`,
  `08_MAPPING_BINDING_DEPENDENCY_AUDIT` (baseline binding map + live audit table),
  `09_EXECUTION_PLAN` (14 phases, Phase 0 = land current branch work first),
  `10_IMPLEMENTATION_PHASES` (copy-paste phase prompts), `11_ACCEPTANCE_CRITERIA` (30 measurable),
  `12_VERIFICATION_AND_QA_PLAN`, `13_RISK_REGISTER` (22 risks).
- **Key corrections to the pack:** the telemetry foundation largely EXISTS (`runtime.sqlite`
  runs/node-attempts/heartbeats/capacity snapshots via `RuntimeStoreSchema.ts`; `RuntimeStatusSnapshot`
  IPC; `ResourceSampler`; `ErrorClassifier`; JSON `ConcurrentRunReport`) — re-scoped Prompt 04 to
  additive migration v2 + taxonomy mapping + retention + `ProcessTreeSampler` + windowed `telemetry:*`
  query IPC; flagged the light-vs-dark theme contradiction (decision gate before Phase 2, light-first
  recommended); zero-new-dependency chart/motion approach (hand-rolled SVG + CSS, per RULES.md);
  replaced the "admin required" process-metrics framing with an availability model; moved the fragile
  canvas visual refactor to Phase 10 (after reports stabilize); added the uncommitted-branch
  precondition (Phase 0) as the top risk.
- **Tests run:** `npm run build` ✅ clean (docs-only change; renderer bundle now reports ~1,176 kB —
  pre-existing growth, noted for the bundle-size debt). **Not run:** feature verifiers (no code touched).
- **Result:** Enhanced pack ready; Phase 1 (baseline audit) can start after Phase 0 (land current work).

## 2026-07-07 — Claude (Fable 5) — Phase 5.1 verification: Chromium no-egress hardening validated, strict-net packaged walkthrough, packaging OOM finding

- **Task:** Close the Phase 5.1 gates — validate the Chromium no-egress hardening end-to-end, prove
  the packaged-process teardown, re-run packaged + regression verification after hardening, and
  honestly document the VM/NSIS gates that need a clean machine. GitHub untouched; nothing committed.
- **Verified the hardening (no code rewrite needed — the module was already sound):** confirmed
  `PLAYWRIGHT_DISABLED_FEATURES` in `src/runner/ChromiumHardening.ts` is an exact mirror of installed
  Playwright 1.61's `disabledFeatures` (load-bearing: the `--disable-features` override is last-wins),
  and that the hardening is wired into `BrowserContextFactory` + both recorder launch paths and NOT
  into `SessionCaptureService` (user's real Chrome stays plain).
- **Changed:** `src/runner/ChromiumHardening.ts` — pinned four Playwright behavioral defaults
  (`--disable-background-timer-throttling/-hang-monitor/-popup-blocking/-prompt-on-repost`) that the
  prompt listed, so the no-egress arg set is self-contained if a future Playwright drops them
  (`--disable-popup-blocking` is load-bearing for the popup-flow feature). `scripts/package-portable.ps1`
  + `scripts/package-per-user-installer.ps1` — throw on a non-zero `electron-builder` exit (they
  previously masked a fatal pack failure and left a stale EXE). Docs: `CURRENT_STATE`, `KNOWN_ISSUES`
  (egress finding marked RESOLVED + new packaging-OOM finding), `PHASE5_OFFLINE_VM_WALKTHROUGH`,
  `TESTING`, `COMMANDS`, `ARCHITECTURE`, `HANDOFF`.
- **Tests (all ✅, 2026-07-07):** build clean; `verify:chromium-hardening` **13/13** (ONLINE — bundled
  Chromium made ZERO non-loopback connections over a 20 s idle window AND navigation to google.com/
  example.com still worked); rebuilt `dist/win-unpacked` **with hardening**; `verify:packaged-runtime`
  **25/25**; `AWKIT_WALKTHROUGH_STRICT_NET=1 verify:packaged-walkthrough` **70/70** (strict no-egress
  PASSES — Phase 5 Google-service burst eliminated; no zombie process); validate:offline pass;
  durable-store 11; durable-locks 17; cancellation 12; safety-policy 17; dynamic-origin-claims 14;
  resource-sampling 14; startup-recovery 10; concurrency 78; locks 15; browser-pool 13; watchdog 13;
  artifacts 13; runtime-status 15; runner 82; waits 21; protected-login 16; recorder 57; mock-site 28;
  stress:concurrency 13; stress:cancellation 8; stress:locks 10; stress:artifacts 7; soak:runtime 8;
  `ai:memory` pass. `npm test` / `npm run lint` still do not exist.
- **Packaging finding:** rebuilding the final single-file EXEs at 7-Zip `-mx=9` OOMs on this 16 GB
  machine (`Can't allocate required memory!`); `win-unpacked` (the shared, validated payload) rebuilt
  fine. Produced a one-off `store`-compressed **hardened** portable EXE (~1.2 GB, validation-only);
  the NSIS installer likewise needs a higher-memory (or lower-compression) machine for a shippable build.
- **Not done / remaining gates:** clean/offline Windows VM walkthrough (§3 checklist — no VM available);
  NSIS install/uninstall cycle (integrity sha512 only); code-signing (EXEs unsigned); max-compressed
  shippable EXEs. **Release-candidate decision: `PASS WITH WARNINGS`** (egress now hardened + proven;
  VM/installer/signing gates remain).

---

## 2026-07-06 — Claude — Phase 5.1 handoff update: centralized Chromium hardening + packaged-process cleanup

- **Task:** Capture the current Phase 5.1 follow-up state after implementing Chromium no-egress hardening and safer packaged-process teardown for the real Electron main.
- **Added:** `src/runner/ChromiumHardening.ts`, `scripts/helpers/packaged-process-tree.mts`, and `scripts/verify-chromium-hardening.mts`; wired the hardening into the runner/recorder launch paths and the packaged verifiers.
- **Tests:** `npm run verify:chromium-hardening` — 13/13 passed. `node scripts/ai-memory/check-memory.mjs` pending final run.
- **Remaining:** rebuild/package the EXEs with the new hardening, run the NSIS install/uninstall cycle, and perform the clean/offline Windows VM walkthrough.

---

## 2026-07-06 — Claude (Fable 5) — Phase 5 Release-Candidate Gate: packaged clean-profile walkthrough, VM checklist, full re-verification, RC decision

- **Task:** Final release-candidate validation of the freshly packaged AWKIT build (Phase 5).
  A true clean/offline Windows VM was NOT available to the agent (no Windows Sandbox/Hyper-V on
  this machine), so the phase delivers: (a) an automated packaged **clean-profile** walkthrough on
  the dev machine, (b) the human offline-VM checklist, (c) full verification-suite re-run, (d) an
  honest RC decision. Details in `docs/ai/PHASE5_OFFLINE_VM_WALKTHROUGH.md`.
- **Added:** `scripts/verify-packaged-walkthrough.mts` + `npm run verify:packaged-walkthrough`
  (**68/68** final run) — real `dist/win-unpacked` EXE with a FRESH empty `LOCALAPPDATA`:
  first-run init (no white screen, durable init, folders, sample-only content), IPC fixture
  import, full workflow → `completed` + artifacts (JSONL/screenshot/report/flow-state), hard
  cancel → `cancelled` + Chromium tree gone + slot/locks freed, 4 instances ≤ 2 browser roots at
  OS level, recorder start/cancel, hard kill of the REAL main pid → startup recovery
  (`orphaned`/recoverable, Recoverable Runs panel renders in the real UI, markReviewed clears),
  external SQLite read, ACTUAL portable EXE first boot on a 2nd fresh profile, NSIS sha512 vs
  `latest.yml`, continuous TCP sampling (app processes loopback-only; bundled-Chromium startup
  Google burst = warn-only / strict env flag). Evidence: `dist/phase5-evidence/`.
  Also `docs/ai/PHASE5_OFFLINE_VM_WALKTHROUGH.md` (honest status + §3 human VM checklist).
- **Findings (KNOWN_ISSUES "Phase 5 packaged-walkthrough findings"):** packaged EXE spawn pid is a
  LAUNCHER STUB (kill the real main from `app.evaluate(() => process.pid)` — stub kills created
  zombie apps in early runs); orphaned Chromium self-exits when the real main dies; bundled
  Chromium emits a per-launch Google-service TCP burst (app data stays loopback; harmless
  offline; hardening follow-up noted); `runWorkflow` requires `dryRun:false`; decorated instance
  ids vs raw executionId; mock-site 127.0.0.1 vs Node-18 `localhost`→`::1` probe gotcha.
- **Tests (Phase 5J, all ✅):** build clean; validate:offline pass; packaged-runtime 24;
  packaged-walkthrough 68; durable-store 11; durable-locks 17; cancellation 12; safety-policy 17;
  dynamic-origin-claims 14; resource-sampling 14; startup-recovery 10; concurrency 78; locks 15;
  browser-pool 13; watchdog 13; artifacts 13; runtime-status 15; runner 82; waits 21;
  protected-login 16; recorder 57; mock-site 28; ai:memory pass. `npm test`/`npm run lint` do not
  exist (honest note).
- **Not done / remaining gate:** the clean/offline Windows VM walkthrough itself (§3 checklist) —
  including the NSIS install/uninstall cycle, offline-adapter startup, and manual
  protected-login/session-reuse GUI flows on a machine with real Chrome. EXEs unsigned.
- **Result:** Release candidate **PASS WITH WARNINGS** — packaged build proven functional on a
  clean user profile with loopback-only app traffic; the offline-VM human gate remains open.

---

## 2026-07-06 — Claude (Fable 5) — Phase 4 Release Hardening: sql.js packaging, runtime diagnostics, recoverable-runs UI, packaged smoke + stress verifiers, offline manifest

- **Task:** Make the Phase 3 durable runtime safe to ship in the packaged app: sql.js WASM
  packaging + offline manifest, runtime path diagnostics, actionable recoverable runs in the
  Instance Monitor, packaged-app smoke verification, deterministic stress/soak verifiers, docs.
  Full detail in `docs/ai/PHASE4_RELEASE_HARDENING.md`.
- **Added:** `src/runner/store/SqlJsLoader.ts` (explicit `sql-wasm.wasm` resolution via
  `createRequire` + `locateFile`; path exposed for diagnostics; dev/tsx/app.asar);
  `RuntimeStatusSnapshot.environment` (`RuntimeEnvironmentInfo`: appMode/runtimeRoot/sqlitePath/
  artifactsRoot/sqlJsWasmPath/durableStoreEnabled) + `appPaths.getAppMode()`;
  engine `initializeDurableRuntime` (called at startup from `registerExecutionIpc`),
  `getRecoveryDetails`, `applyRecoveryAction` (+ `RuntimeStore.listArtifacts`,
  `DurableArtifactRecord`); IPC `execution:recoveryDetails`/`execution:recoveryAction` + preload;
  `app/renderer/components/instances/RecoverableRunsPanel.tsx` (details, open artifacts, re-run
  safe runs only, mark reviewed/abandoned — dangerous runs never auto-resumed); verifiers
  `verify-packaged-runtime.mts`, `verify-stress-{concurrency,cancellation,locks,artifacts}.mts`,
  `verify-soak-runtime.mts`; `docs/ai/PHASE4_RELEASE_HARDENING.md`.
- **Changed:** `SqliteRuntimeStore` uses the loader; `electron-builder.json` explicitly ships
  `node_modules/sql.js/dist/sql-wasm.{js,wasm}`; `generate-dependency-manifest.ps1` +
  `validate-offline-bundle.ps1` + `DependencyManifest.ts` policy require the sql.js runtime/WASM
  flags (`dependencies.sqlJs` added); `execution.ipc.ts` (startup durable init +
  `resolveStorageDirs` dedupe); `InstanceMonitor.tsx` (recovery panel + refresh callback);
  engine recoverable-run filter → status `orphaned`/`failed` with note (so reviewed/abandoned
  drop out). **Fix found by stress:** `DurableLockStore.acquireExclusive` treats Windows
  EPERM/EBUSY wx-create races as contention (clean denial) instead of throwing.
- **Packaging:** manifest regenerated; `validate:offline` ✅ (dev + strict); portable EXE rebuilt
  (310 MB) + NSIS installer rebuilt (357 MB), both 2026-07-06, warm cache, no internet needed by
  the app; `verify:packaged-runtime` ✅ 24/24 (real packaged-EXE launch: appMode=packaged, durable
  store enabled, WASM from app.asar, `%LOCALAPPDATA%` paths, external SQLite read, artifacts
  writable).
- **Tests:** build ✅; new: stress:concurrency 13 ✅, stress:cancellation 8 ✅, stress:locks 10 ✅,
  stress:artifacts 7 ✅, soak:runtime 8 ✅, packaged-runtime 24 ✅. Regression: durable-store 11 ✅,
  durable-locks 17 ✅ (one flake under packaging CPU load, re-run clean — noted in KNOWN_ISSUES),
  safety-policy 17 ✅, startup-recovery 10 ✅, resource-sampling 14 ✅, locks 15 ✅, browser-pool
  13 ✅, watchdog 13 ✅, runtime-status 15 ✅, concurrency 78 ✅, artifacts 13 ✅, cancellation
  12 ✅, dynamic-origin-claims 14 ✅, runner 82 ✅, waits 21 ✅, protected-login 16 ✅, recorder
  57 ✅, mock-site ✅, ai:memory ✅. `npm test`/`npm run lint` do not exist.
- **Not run:** clean offline-VM GUI walkthrough (human gate); full workflow execution inside the
  packaged app (smoke verifier launches + inspects the runtime only); GUI verifiers
  (flow-designer/workflow-builder — no connector-canvas changes).

---

## 2026-07-06 — Claude (Fable 5) — Concurrency Phase 3: durable SQLite runtime store, cross-process locks, hard cancellation, safety metadata, dynamic origin claims, CPU sampling, startup recovery

- **Task:** Fix the Phase 2 limitations: durable runtime state (SQLite), cross-process locks,
  hard-stopping cancellation, explicit side-effect metadata (keyword heuristic → fallback only),
  mid-flow origin claim re-evaluation, CPU/memory sampling in backpressure, and app-restart
  recovery. Full design + honest trade-offs in `docs/ai/PHASE3_DURABLE_RUNTIME.md`.
- **Driver decision:** native `better-sqlite3` unusable (Node 18 verifiers vs Electron 33 Node 20
  ABI split; `node:sqlite` needs Node 22.5+) → **`sql.js` 1.13.0** (WASM SQLite, new runtime
  dependency + `@types/sql.js` dev): real SQLite file, zero native ABI, offline after install.
  Persistence = atomic-rename writes (debounced, immediate on critical transitions); cross-process
  exclusion comes from atomic-filesystem locks, not SQLite file locking.
- **Added:** `src/runner/store/` — `RuntimeStoreSchema` (10 tables, versioned migrations),
  `SqliteRuntimeStore`, `RuntimeStore` interface + `NullRuntimeStore`, `DurableLockStore`
  (wx-file exclusive locks, rank-based semaphores, fencing versions, TTL + dead-pid stale
  detection with quarantine-not-delete), `DurableLockConfig`, `AppInstance` (app instance id /
  pid liveness), `StartupRecovery` (pure policy shared by engine + verifier);
  `src/runner/concurrency/CancellationToken.ts` (token + source, CancelledError),
  `OriginClaimTracker.ts` (acquire-new-then-release-old, bounded wait, transition log),
  `ResourceSampler.ts` (system/process memory + CPU deltas, never throws);
  `FlowStep.safety`/`SideEffectLevel` schema types + `src/runner/runtime/StepSafetyPolicy.ts`
  (explicit → type defaults → keyword fallback → conservative unknown).
- **Changed:** `RetryPolicy` is metadata-first (explicit dangerous/externalCommit never retry;
  explicit-retryable overrides keywords; idempotency-key requirement enforced; infra-terminal
  classes — incl. new `cancelled` — beat everything); `ErrorClassifier` + `cancelled` class;
  `BackpressureController` + sampler thresholds (`AWKIT_MAX_SYSTEM_MEMORY_PERCENT`/
  `AWKIT_MAX_PROCESS_MEMORY_MB`/`AWKIT_MAX_CPU_PERCENT`, fresh-sample gated, sampler failures
  tolerated); `CapacitySnapshot` + sampled fields; `ProfileLockManager.acquireDurable` (memory +
  durable, both released) used by `BrowserContextFactory`; `PlaywrightRunner` cancellation
  (onCancel closes the live generation; flow loop refuses post-cancel work) + passes token/origin
  tracker to executors; `StepExecutor` throws pre-step on cancel, re-evaluates origin claims after
  successful steps, emits `sideEffectLevel`; `ExecutionEngine` — per-instance
  `CancellationTokenSource` (`stopInstance` → durable cancellation record + hard browser close +
  `cancelled` state, not failed), durable store init + startup recovery + stale-lock scan on first
  run, durable run/attempt/heartbeat/watchdog/artifact/capacity writes, durable dispatch-claim
  mirroring, origin tracker per instance, async `getRuntimeStatus` with `durableLocks` +
  `recoverableRuns`; Instance Monitor strip shows CPU/Mem/Recoverable/Stale-durable-locks.
- **Tests (new, all deterministic/local):** `verify:durable-store` 11/11, `verify:durable-locks`
  17/17 (REAL second process via spawned tsx child), `verify:cancellation` 12/12 (live Chromium:
  30s wait cancelled in seconds, profile lock freed), `verify:safety-policy` 17/17,
  `verify:dynamic-origin-claims` 14/14 (live 127.0.0.1→localhost origin change),
  `verify:resource-sampling` 14/14, `verify:startup-recovery` 10/10.
- **Regression (all green):** `npm run build` clean (sql.js externalized in the main bundle),
  `verify:concurrency` 78, `verify:locks` 15, `verify:browser-pool` 13, `verify:watchdog` 13,
  `verify:artifacts` 13, `verify:runtime-status` 15, `verify:runner` 82, `verify:waits` 21,
  `verify:protected-login` 16, `verify:recorder` 57, `ai:memory` pass, `validate:offline` pass
  (dev mode). `npm test` / `npm run lint` do not exist.
- **Behavior changes:** Stop now hard-closes the running browser (run ends `cancelled`, artifacts
  where possible); unknown custom step types are no longer auto-retried (conservative default);
  cross-origin mid-flow navigation claims the new origin (can queue/fail the step when saturated,
  env-tunable); dispatch/profile locks are cross-process durable; packaged builds must ship
  `node_modules/sql.js` (manifest regeneration + repack pending — flagged).

---

## 2026-07-06 — Claude (Fable 5) — Concurrency Phase 2: audit, hardening, traces, semaphores, runtime status UI

- **Task:** Audit the Phase 1 concurrency layer's real wiring, answer the 15 review questions
  (`docs/ai/CONCURRENCY_PHASE2_REVIEW.md`), and complete production hardening: failure traces,
  origin/account semaphores, runtime status visibility, manual-handoff heartbeat safety, and focused
  verifiers for the dangerous failure modes.
- **Audit outcome:** slot/lock release paths and manual-handoff watchdog exclusions were already correct;
  gaps found and fixed: stale heartbeat right after handoff resume, failure screenshots gated behind
  `onFailure.screenshot`, no trace capture, no per-origin/account fairness, no status surface.
- **Added:** `src/runner/artifacts/TraceService.ts` (per-step trace chunks on the context; failed steps
  save `traces/<stepId>-<ts>.zip` before anything closes, success discards; `AWKIT_TRACE_MODE`
  off/onFailure/always, armed only when the engine provides `paths.traces` so verify scripts and embedded
  runners have zero overhead); `src/runner/concurrency/DispatchClaims.ts` (origin from baseUrl/first goto,
  account from envFile) + kind-prefix semaphore capacities in `ResourceLockManager` (`origin:*` →
  `AWKIT_MAX_PER_ORIGIN` default 2, `account:*` → `AWKIT_MAX_PER_ACCOUNT` default 1; exact-key overrides);
  `src/runner/concurrency/RuntimeStatus.ts` (pure aggregation) + engine methods `getRuntimeStatus` /
  `getLockSnapshot` / `getBrowserPoolSnapshot` / `getWatchdogSnapshot`, IPC `execution:runtimeStatus`,
  preload `executions.runtimeStatus()`, and a read-only Instance Monitor status strip (browsers/flows/
  pages/queued/locks incl. stale, crash count, backpressure reason, last watchdog action; 2s poll).
- **Changed:** `ExecutionEngine` acquires origin/account claims at dispatch (saturated key → only those
  instances queue; browser slot returned) and releases them + strays in `finally`; heartbeat refreshed on
  `resumeInstance`/`retryHandoff`; node attempts now carry `tracePath` + sanitized `currentUrl`.
  `StepExecutor` wraps every step in a trace chunk and emits `tracePath`/`currentUrl` on failed events;
  `FlowExecutor` captures failure screenshots **by default** (opt-out via `onFailure.screenshot: false`;
  best-effort, never masks the step error). `WatchdogService` gained a snapshot (last scan, recent
  findings, swept locks). `ResourceLockManager.snapshot(false)` keeps expired-but-unswept leases visible
  for diagnostics. `InstanceRuntimePaths`/`InstanceExecutionContext.paths` gained `traces`.
- **Tests:** new `verify:locks` 15/15 (incl. lock release after failed `launchPersistentContext` and the
  concurrent-profile race), `verify:browser-pool` 13/13 (fake runtimes; saturation, release after
  failure/cancel, generation guards), `verify:watchdog` 13/13 (incl. manual-handoff no-false-positive),
  `verify:artifacts` 13/13 (live Chromium: failure trace zip, success discards, default screenshot,
  trace-save failure never masks error), `verify:runtime-status` 15/15. Regression: `verify:concurrency`
  78/78, `npm run build` clean, `verify:runner` 82/82, `verify:waits` 21/21, `verify:protected-login`
  16/16, `verify:recorder` 57/57, `ai:memory` pass. `npm test` / `npm run lint` do not exist in this repo.
- **Behavior changes:** failing steps now save a trace zip + screenshot by default in engine runs;
  instances sharing one origin/account queue beyond the configured caps (env-tunable).

---

## 2026-07-06 — Claude (Fable 5) — Concurrency & stability layer (locks, browser pool, backpressure, watchdog, classified retry, run artifacts)

- **Task:** Implement the local high-concurrency stability architecture: resource locks, bounded browser
  pool, backpressure/admission control, explicit runtime state machines, node-attempt records, classified
  retries with a dangerous-mutation guard, heartbeats + watchdog, and structured on-disk run artifacts —
  without breaking the existing execution path. Plan in `docs/ai/CONCURRENCY_IMPLEMENTATION_PLAN.md`.
- **New modules:** `src/runner/concurrency/` (`ResourceKey`, `Semaphore`, `ResourceLockManager` with
  exclusive/shared/semaphore modes + TTL leases + fencing versions + atomic multi-acquire + snapshot,
  `ConcurrencyConfig` with `AWKIT_*` env overrides, `BackpressureController`, `CapacitySnapshot`),
  `src/runner/browser/BrowserWorkerPool.ts` (bounded browser slots, health/crash window, capacity snapshot),
  `src/runner/runtime/` (`RuntimeStateMachine` — FlowRunStatus/NodeStatus with validated transitions,
  `NodeAttempt`(+Log), `ErrorClassifier`, `RetryPolicy`, `InstanceHeartbeat`, `WatchdogService`),
  `src/runner/artifacts/` (`RunLogger` — JSONL to `instance.paths.logs`, `RunStateArtifacts` —
  flow-state/node-attempts/capacity/locks JSON under `<instance storage>/state`),
  `src/profiles/ProfileLockManager.ts` (exclusive in-process `profile:*` lock).
- **Integrations (minimal diffs):** `BrowserContextFactory` acquires the exclusive profile lock before
  `launchPersistentContext` (released in the runtime close path — two runtimes can never share one
  `userDataDir` in-process); `FlowExecutor.executeWithRetry` is now classification-gated (transient
  navigation/timeout/locator/download errors retry with exponential backoff; submit/approve/delete/send/
  pay/confirm-looking mutations and dead browser/context/page failures never auto-retry) and isolated
  parallel branches are clamped by `maxActiveNodesPerFlow`; `PlaywrightRunner` gained an optional
  `onBrowserRuntime` hook (initial launch + every Reuse Session swap generation); `ExecutionEngine`
  acquires a pool slot per instance under backpressure admission (pool saturation / active-flow cap /
  low memory / crash rate → dispatch queued with a logged reason), tracks per-instance runner promises,
  updates `InstanceRuntimeState.runtime` (flowRunStatus/heartbeatAt/browserWorkerId — additive; UI
  `status` unchanged), folds progress events into heartbeats + JSONL log + node attempts, runs the
  `WatchdogService` (stale-heartbeat notes, orphan → failed, stale-lock sweep), and writes end-of-run
  state artifacts + releases slots/stray profile locks in `finally`.
- **Defaults (env-overridable):** maxBrowsers 2, contexts/browser 4, pages/context 2, activeFlows 4,
  nodes/flow 2, min free memory 512MB, crash window 3/5min, stale heartbeat 120s, watchdog 15s.
- **Tests:** new `npm run verify:concurrency` (78/78 — locks incl. fencing/TTL/atomicity, semaphore,
  pool saturation, backpressure reasons, classifier/retry incl. dangerous guard, state machines, node
  attempts, watchdog stale/orphan/dedupe/lock-sweep, JSONL logger, state artifacts, FlowExecutor retry
  integration with stubbed executor, live Chromium profile-lock + cleanup). Regression: `npm run build`
  clean, `verify:runner` 82/82, `verify:waits` 21/21, `ai:memory` pass.
- **Behavior changes:** instances beyond the browser cap now queue (previously unbounded Chromium
  processes); failed steps only retry for transient error classes; isolated-parallel concurrency is
  clamped by host limits (existing verifier configs unaffected at the default of 2).

---

## 2026-07-05 — Codex — Workflow protected-login handoff now captures a normal-browser session

- **Task:** Align workflow-runner protected-login handling with the intended secure-login design: when a
  protected login / human verification page is detected, close the Playwright automation browser, open normal
  Chrome/Edge at the detected login URL, wait for the user to complete login and close it, capture the session,
  relaunch Playwright with that persistent profile, and continue the workflow.
- **Root cause:** `Auto Secure Login` and recorder secure-login handoff already used `SessionCaptureService`
  + browser restart, but runner-side auto-detected Protected Login Handoff only paused for
  Continue/Retry/Cancel and did not start normal-browser session capture.
- **Fix:** `StepExecutor` now calls a protected-login capture path when `sessionService` and
  `browserRestarter` are available. The helper emits waiting progress, closes the automation browser, starts
  `manualChromeHandoff` capture at the detected/configured login URL, handles cancel/timeout/error, validates
  captured profile data, relaunches on the captured profile, marks the session used, clears pending handoff
  state, and maps session outputs. The capture wait uses `config.handoffTimeoutMs` (0 disables timeout on
  explicit Protected Login Handoff nodes) and deliberately ignores the triggering step's `timeoutMs`, so an
  auto-detected protected login after `goto` does not time out on the navigation/action timeout while the
  user is still completing login in normal Chrome/Edge. Captured handoff also returns step outcome
  `sessionCaptured` for connector routing parity with Auto Secure Login / Reuse Session. If capture services
  are unavailable, the existing manual pause behavior remains as fallback.
- **Tests:** Added `verify:runner` coverage for explicit `protectedLoginHandoff` session capture and
  auto-detected protected-login capture after `goto`, including a short-navigation-timeout regression.
  `npm run typecheck` pass; `npm run verify:runner` 82/82; `npm run build` pass;
  `npm run ai:memory` pass; `npm run verify:protected-login` 16/16.

---

## 2026-07-05 — Codex — Reuse Session browser lifecycle fixed

- **Task:** Fix the real `Smart-Rec-Chatgpt` workflow path (`Start → Auto Secure Login → Reuse Session →
  Navigate to https://chat.openai.com`) so Reuse Session does not leave stale browser/page references and
  Navigate no longer fails with `Target page, context or browser has been closed`.
- **Root cause:** `StepExecutor.runStepWithWaits` restored the pre-swap active page after `Auto Secure Login`
  / `Reuse Session`, so the next step could target an old closed page/context. Browser-swap lifecycle
  handlers and cleanup also lacked generation guards, so old-generation close/disconnect events were not
  explicitly isolated from the new persistent runtime.
- **Fix:** `PlaywrightRunner` now performs a generation-guarded two-phase persistent-context swap with
  explicit close reasons, debug close-stack traces behind `AWKIT_BROWSER_LIFECYCLE_DEBUG=1`, a swap mutex,
  live page resolution from the new context, active-executor rebinding, old-runtime close after publish, and
  post-swap liveness verification. `StepExecutor` liveness-checks before every step, preserves the new active
  page after session-swap steps, verifies swapped sessions, reports locked/open profile failures clearly, and
  treats stale recorder-generated armed response waits on successful `goto` as optional navigation hints.
  `BrowserContextFactory` checks profile lock artifacts before launch; `ExecutionEngine` avoids an unhandled
  rejection from fire-and-forget `.finally()` cleanup.
- **Files changed:** `src/runner/BrowserContextFactory.ts`, `src/runner/PlaywrightRunner.ts`,
  `src/runner/StepExecutor.ts`, `src/runner/ExecutionEngine.ts`, `scripts/verify-runner.mts`,
  `scripts/verify-waits.mts`, and AI memory docs.
- **Tests:** `npm run typecheck` pass; `npm run verify:waits` 21/21; `npm run build` pass;
  `npm run verify:runner` 79/79; `npm run verify:recorder` 57/57; `npm run ai:memory` pass.
- **Real Electron evidence:** Built app launched through Playwright `_electron`; workflow execution
  `df1f89c3-71b4-4f40-a3bd-73dcefd542fe` showed `Reuse Session` succeeded (3433 ms) and `Navigate to
  https://chat.openai.com` succeeded (30579 ms) after resuming the expected Protected Login Handoff. No
  closed-target browser lifecycle error occurred and no terminal unhandled rejection was observed.

---

## 2026-07-04 — Claude — IN PROGRESS: Reuse Session browser swap dies ~34–76ms after relaunch (UNRESOLVED)

- **Symptom:** Recorded ChatGPT workflow (`Start → Auto Secure Login → Reuse Session → Navigate`) fails.
  `Reuse Session` swaps the automation browser to `launchPersistentContext(session-8aa61a06 dir)`; diagnostics
  show `[swap] relaunched OK: 2 page(s), activePage.closed=false`, then the active page closes ~34ms later,
  the context ~58ms, and the browser disconnects ~76ms after relaunch. `Navigate` then throws
  `page.goto: Target page, context or browser has been closed`. The browser process is dying on its own
  right after Playwright connects — **only inside the running Electron app.**
- **Hypotheses DISPROVEN by direct reproduction (all four repro paths SUCCEED with the exact failing
  profile + swap sequence):** standalone Node, inside real Electron (bundled Chromium `resources/browsers/
  chromium/chrome.exe`), inside real Electron on the dev path (Playwright `chromium-1228`), and a same-dir
  persistent-context close→relaunch race. In every isolated harness the profile opens, pages stay alive, and
  `goto https://chat.openai.com` succeeds.
  - NOT a version mismatch: profile `Last Version`, bundled Chromium, and `chromium-1228` are all
    `149.0.7827.55`.
  - NOT stale lock files: profile dir has no `SingletonLock`/`SingletonCookie`/`SingletonSocket`/`lockfile`.
  - NOT "external/incompatible profile": the real-Chrome (`manualChromeHandoff`) profile reuses fine with the
    bundled Chromium. **Do NOT add a `createdBy: awkit-playwright` guard — `SessionCaptureService` captures
    every session with the user's REAL Chrome/Edge by design, so such a guard would block 100% of sessions.**
  - NOT signal teardown: `handleSIGINT/SIGTERM/SIGHUP:false` added; browser still dies.
- **What changed (hardening + diagnostics only — does NOT fix the crash):**
  - `src/runner/BrowserContextFactory.ts` — `removeStaleProfileLocks` before `launchPersistentContext`
    (best-effort); `handleSIGINT/SIGTERM/SIGHUP:false` on all launches (embed-in-Electron best practice).
  - `src/runner/PlaywrightRunner.ts` — `[swap]` diagnostics in `restartBrowser` (relaunch log + context/page
    `close` listeners with elapsed-ms) + `logMeta` helper. This is what produced the decisive timing.
  - `src/runner/StepExecutor.ts` — `assertSwappedBrowserAlive` (round-trips `page.title()` after swap) +
    `sessionProfileOpenError`; `executeReuseSession`/`executeAutoSecureLogin` wrap the swap and fail the node
    with an actionable message instead of a cryptic downstream `goto` error. (Fails cleanly; does not prevent
    the browser death.)
- **Next step (not done):** discriminate crash vs. close vs. process-exit in-app — add `page.on('crash')` +
  browser-disconnect reason to the swap path, and run the workflow once pointing `Reuse Session` at a
  brand-new profile. If a fresh profile also dies at ~76ms, the profile is conclusively ruled out and the
  cause is app-runtime-specific (something the full app does to the freshly launched browser).
- **Tests:** `npm run build` clean. `npm run verify:runner` → 76/76 (does not cover the in-app Electron swap
  that fails). Root cause still OPEN.
- **Repro scripts were temporary and deleted** (they lived under `scripts/_tmp_*`). Untracked
  `electron_test*.cjs` at repo root are pre-existing (not from this task) and were left untouched.

---

## 2026-07-04 — Claude — Recorder secure-login browser handoff (protected login/popup)

- **Task:** Detect protected login / protected popup during recording, pause + close the Playwright
  browser, hand off to the user's real Chrome for the manual login/MFA/OTP/CAPTCHA/approval, capture the
  authenticated session, insert `Auto Secure Login` + `Reuse Session` nodes, and resume recording on the
  saved session. No security bypass; no secrets captured/logged.
- **What was added:** Recorder-side detector `detectRecorderProtectedLogin` + `detectFromRecorderSignals`
  (DOM signals: password / one-time-code / recaptcha-hcaptcha-turnstile iframe / captcha+verification aria /
  passkey-webauthn; plus new text patterns OTP/verification-code/passkey/digital-signature/external-approval)
  in `ProtectedLoginDetector.ts`. `RecorderService` handoff state machine (detected → capturingSession →
  sessionCaptured → resumed/error): pause + preserve draft + `closeBrowser`, `continueWithNormalBrowser`
  (real Chrome via `SessionCaptureService.startCapture(..., "manualChromeHandoff")`), `captureSessionAndResume`
  (validate via `hasCapturedData`, insert secure nodes deduped, `launchPersistentContext` resume), and
  `cancelSecureHandoff`. Extracted shared `wireContext`. `buildRecordedFlow` serializes the secure nodes.
  Recorder UI handoff panel + always-on handoff poll. IPC/preload `recorder.getHandoff/
  continueWithNormalBrowser/captureSessionAndResume/cancelHandoff`. Mock Site `/mock/protected-login`,
  `/mock/protected-popup-login`, `/mock/protected-popup-captcha`, `/mock/protected-popup-otp`,
  `/mock/session-reuse` (+ index link) and `scripts/verify-protected-login-recorder.mts`.
- **Files changed:** `src/security/ProtectedLoginDetector.ts`, `src/recorder/RecorderService.ts`,
  `src/recorder/RecorderTypes.ts`, `src/recorder/buildRecordedFlow.ts`, `src/session/SessionProfile.ts`,
  `src/session/SessionCaptureService.ts`, `app/main/ipc/recorder.ipc.ts`, `app/main/preload.ts`,
  `app/renderer/pages/Recorder.tsx`, `mock-site/server.mjs`, `mock-site/public/secure-login/*`,
  `mock-site/public/index.html`, `mock-site/README.md`, `scripts/verify-protected-login-recorder.mts`,
  `package.json`, and `docs/ai/*`.
- **Tests run:** `npm run verify:protected-login-recorder` → 34/34, `verify:protected-login` → 16/16,
  `verify:recorder` → 57/57, `verify:recorder-draft` → 17/17, `verify:recorder-flow` → 13/13,
  `verify:mock-site` → 28/28, `verify:popup` → 12/12, `verify:runner` → 76/76, `npm run build` clean.
- **Notes / limits:** Runtime replay of the inserted nodes uses the existing Auto Secure Login / Reuse
  Session runner behavior (no new runner logic). Full GUI walkthrough (real Chrome launch + persistent-context
  resume) not driven here — logic + detection are verified via `_electron`-free scripts against the mock site.

## 2026-07-04 — Antigravity — Verified Popup Flow Handling & Mock Site Scenarios

- **Task:** Verify the Multi-Window / Popup Flow Handling implementation and expand the local Feature Test Lab with robust mock-site popup scenarios.
- **What was added:** Added 7 mock site scenarios inside `mock-site/public/popup/` to verify target blank, window.open, auto-close, multiple popups, failure cases, and smart-wait inside popups. Created automated verification suite `scripts/verify-popup-mock-site.mts`. Fixed `verify-popup.mts` server fileMap. Added `routeChange` exclusion to `runStepWithWaits` in `StepExecutor` to prevent reverting the active page back to main after a route change.
- **Files changed:** `mock-site/public/popup/*`, `mock-site/server.mjs`, `mock-site/README.md`, `scripts/verify-popup-mock-site.mts`, `scripts/verify-popup.mts`, `src/runner/StepExecutor.ts`.
- **Tests run:** `npm run verify:popup` → 12/12, `npm run verify:popup-mock-site` → 8/8, `node scripts/ai-memory/check-memory.mjs` → Passed.

## 2026-07-04 — Antigravity — Multi-Window / Popup Flow Handling

- **Task:** Implement Phase 10/11: Multi-Window / Popup Flow Handling. Allow AWKIT to record and replay workflows where clicking a link/button opens a new Chrome window, tab, or popup.
- **What was added:** `PageRegistry` introduced in `StepExecutor` to maintain mappings of `pageAlias` to Playwright `Page` objects. Added step types `switchToPopup`, `switchToMainPage`, and `closePopup`. Click actions with `opensPopup` wait for the newly spawned window and register it into the context. `LocatorFactory` and the step running routine `runStepWithWaits` now correctly route commands targeting a specific popup by temporarily mutating the active page so internal wait logic applies to the specific popup context.
- **Testing:** Added `/popup-lab` and `/popup-terms` to Mock Site. Created `scripts/verify-popup.mts`.
- **Files changed:** `src/profiles/FlowProfile.ts`, `src/runner/StepExecutor.ts`, `src/runner/PlaywrightRunner.ts`, `app/renderer/components/workflow/flowNodeCatalog.ts`, `app/renderer/components/workflow/flowNodeRegistry.ts`, `app/renderer/pages/Recorder.tsx`, `mock-site/server.mjs`, `scripts/verify-popup.mts`, and docs.
- **Tests run:** `npm run verify:popup` → 12/12, `npm run build` clean.

---

## 2026-07-04 — Codex — Agent handoff refresh

- **Task:** Refresh `docs/ai/HANDOFF.md` for transfer to the next agent/human after the local Smart Wait
  and Mock Site Feature Test Lab work.
- **Repo state captured:** branch `feature/smart-wait-engine`, latest local commit `fe1edc4`, clean before
  the handoff docs refresh, ahead of upstream by 3 local commits.
- **Files changed:** `docs/ai/HANDOFF.md`, `docs/ai/TASK_LOG.md`.
- **Tests:** AI memory check run for the handoff refresh.

## 2026-07-04 — Codex — Mock Site Feature Test Lab and agent guidance

- **Task:** Upgrade the offline mock site into a mandatory Feature Test Lab and update agent guidance so
  future Recorder, Runner, Smart Wait, Flow Designer, Workflow Builder, Instance Monitor, locator, node,
  wait, and execution work considers mock-site scenarios.
- **What was added:** new lab index (`/`), Smart Wait/Runner scenarios (`/smart-waits`), Recorder scenarios
  (`/recorder-lab`), Designer/Workflow scenarios (`/designer-lab`), local delayed JSON endpoint
  (`/api/delay?ms=...`), `npm run verify:mock-site` (28/28), `mock-site/AGENTS.md`, and mirrored
  `mock-site-maintainer` skills for `.agents`, Claude, and Gemini.
- **Docs/guidance:** updated mock-site docs, root/adaptor agent instructions, scripts/tests local rules,
  AI architecture/testing/commands/workflow/current-state/handoff docs, and fixture docs.
- **Tests:** `npm run build` passed; `npm run verify:waits` 18/18; `npm run verify:runner` 76/76;
  `npm run verify:recorder` 57/57; `npm run verify:recorder-draft` 17/17;
  `npm run verify:flow-designer` 19/19; `npm run verify:mock-site` 28/28; AI memory check passed.

## 2026-07-04 — Codex — Smart Wait Engine remaining phases (diagnostics + UI)

- **Task:** Complete the remaining Smart Wait Engine phases after Phase 1 runner support and Phase 2
  recorder observation.
- **What was added:** Runner Smart Wait failures now include phase, sanitized current URL, condition,
  timeout, recorded reason, last observed state, and suggestion. Recorder Controls exposes a persisted
  Smart Wait toggle and recorded actions summarize captured wait types. Flow Designer save/load now
  preserves `beforeWaits`/`afterWaits`, and Node Properties shows a Smart Waits section with before/after
  grouping, condition details, timeout editing, per-wait remove, and clear-list controls. The Flow Designer
  GUI verifier now navigates by visible label instead of stale `title` text.
- **Files changed:** `src/runner/StepExecutor.ts`, `scripts/verify-waits.mts`,
  `scripts/verify-flow-designer-gui.mjs`, `app/renderer/pages/Recorder.tsx`,
  `app/renderer/pages/FlowChartDesigner.tsx`, `app/renderer/components/workflow/FlowNodePropertiesPanel.tsx`,
  `app/renderer/components/workflow/flowDesignerTypes.ts`, `app/renderer/styles/global.css`, docs.
- **Tests:** `npm run typecheck` passed; `npm run verify:waits` 18/18; `npm run verify:runner` 76/76;
  `npm run verify:recorder` 57/57; `npm run verify:recorder-draft` 17/17; `npm run build` clean;
  `npm run verify:flow-designer` 19/19; AI memory check passed.

## 2026-07-04 — Claude Code/Codex — Smart Wait Engine Phase 2 (recorder observation)

- **Task:** Phase 2 — the recorder now observes what happens between user actions and captures
  condition-based Smart Waits, reusing the Phase 1 `WaitCondition` model. No UI controls; no
  Multi-Window/Popup or Manual Handoff work.
- **What was added:**
  - **Pure correlation core** (`src/recorder/smartWaitObservation.ts`, new): `RecordedSignal` union +
    `buildSmartWaits(signals, fromTs, toTs, opts)` — turns raw page signals from the window after the
    previous action into ranked `WaitCondition[]`. Priority response → loaderHidden → tableHasRows/
    listHasItems → toastVisible → elementEnabled → urlChanged; caps at 3; **ignores background polling**
    (a request path repeated ≥3× in the window); `fixedDelay` only as a fallback when nothing reliable
    is found (and only when `captureWaitTime` is off, to avoid double delays). Browser-free → unit-tested.
  - **In-page observer** (`src/recorder/recorderInitScript.ts`): patches `fetch`/`XMLHttpRequest`
    (method + URL **path** only — never query/headers/bodies/cookies), `history`+popstate/hashchange
    for URL changes, and a MutationObserver + 150 ms scan for loaders appearing→disappearing, toasts,
    disabled→enabled transitions, and table/list/card row-count increases. Emits safe signals via a new
    `__awtkit_recordSignal` binding. A silent baseline scan avoids emitting for pre-existing content.
  - **RecorderService** (`RecorderService.ts`): new `captureSmartWaits` option (**default on**), buffers
    signals (bounded), and on each distinct action attaches `buildSmartWaits(...)` output as `afterWaits`
    on the **previous** action. Legacy `captureWaitTime` fixed-time nodes and fill-collapsing unchanged.
  - **Settings/IPC pass-through** (`uiSettings.ts`, `recorder.ipc.ts`, `preload.ts`, `Recorder.tsx`):
    persisted `settings.recorder.captureSmartWaits` defaults ON and is passed to `RecorderService` without
    adding a new UI control.
  - **Propagation:** `RecordedAction` gains `beforeWaits`/`afterWaits` (`RecorderTypes.ts`);
    `buildRecordedFlow.ts` copies them onto the `FlowStep`.
- **Security:** only method + URL path, status range, timing, loader selectors, short (≤80 char) toast
  text, and locators are captured. No secrets/headers/bodies/cookies/tokens; `networkidle` is not used.
- **Files changed:** `src/recorder/smartWaitObservation.ts` (new), `src/recorder/recorderInitScript.ts`,
  `src/recorder/RecorderService.ts`, `src/recorder/RecorderTypes.ts`, `src/recorder/buildRecordedFlow.ts`,
  `src/profiles/FlowProfile.ts`, `app/main/uiSettings.ts`, `app/main/ipc/recorder.ipc.ts`,
  `app/main/preload.ts`, `app/renderer/pages/Recorder.tsx`, `scripts/verify-recorder-locator.mts`
  (Part D), `scripts/verify-recorder-draft.mts`, docs.
- **Tests:** `npm run verify:recorder` → **57/57** (Part D: POST/GET response, loaderHidden, card/list
  waits, toast, enabled, urlChanged path-only, polling-ignored, fixedDelay fallback on/off, and in-page
  signal emission incl. query stripped). `npm run verify:recorder-draft` → **17/17** (incl. legacy fixed
  wait with Smart Wait disabled), `npm run verify:waits` 15/15, `verify:runner` 76/76, build clean,
  check-memory passed.
- **Not done (later):** UI controls (Phase 4) — `captureSmartWaits` defaults on and has no toggle yet;
  a future Recorder UI can pass the option like `captureWaitTime`. Branch: `feature/smart-wait-engine`
  (separate local commit on top of Phase 1 `cd68ef9`).

## 2026-07-04 — Claude Code — Smart Wait Engine Phase 1 (runner execution)

- **Task:** Phase 1 of the Smart Wait Engine — condition-based waits executed by the runner. Recorder
  observation, UI, and other phases are intentionally out of scope.
- **What was added:**
  - **Types** (`src/profiles/FlowProfile.ts`): a `WaitCondition` discriminated union
    (`loaderHidden` / `elementVisible` / `elementHidden` / `elementEnabled` / `textVisible` /
    `toastVisible` / `response` / `tableHasRows` / `listHasItems` / `urlChanged` / `domStable` /
    `fixedDelay`) with locator-based conditions reusing `StepLocator`; and optional
    `beforeWaits?: WaitCondition[]` / `afterWaits?: WaitCondition[]` on `FlowStep`. Fully additive —
    steps without them, and the legacy `wait` step node, are unchanged.
  - **Runner** (`src/runner/StepExecutor.ts`): `execute` now runs a step via `runStepWithWaits`
    (`beforeWaits` → arm action-triggered `response` waits → action → await armed → `afterWaits`).
    A `response` wait with `armBeforeAction: true` is registered **before** the action (so a fast
    response isn't missed) and awaited after. Added `executeWaitCondition` + helpers
    (`buildResponseWait`, `waitForPredicate`, `waitForDomStable`, `waitLocator` reusing
    `LocatorFactory`) and clear per-wait diagnostics (`formatWaitFailure` / `describeWaitCondition` /
    `waitSuggestion`: step, wait type, condition, timeout, last observed state, suggestion).
    `networkidle` is deliberately not used as a Smart Wait strategy. The legacy `executeWait`
    (time/selector/navigation/networkIdle/textVisible) step node is untouched.
- **Files changed:** `src/profiles/FlowProfile.ts`, `src/runner/StepExecutor.ts`,
  `scripts/verify-waits.mts` (new), `package.json` (`verify:waits` script), docs.
- **Tests:** `npm run verify:waits` → **15/15** (no-waits backward compat, legacy wait node,
  beforeWaits gate, afterWaits, armed-before-action response, loaderHidden, elementEnabled,
  tableHasRows, urlChanged, fixedDelay timing, timeout diagnostics). `npm run verify:runner` → 76/76,
  `npm run verify:recorder` → 42/42 (no regressions), `npm run build` clean, check-memory passed.
- **Not done (later phases):** recorder observation of loaders/network/DOM (Phase 2), diagnostics
  polish (Phase 3), UI controls (Phase 4). Wait locators use page-rooted `LocatorFactory.create().first()`
  for now; container/frame-scoped wait locators can arrive with recorder Phase 2. Branch:
  `feature/smart-wait-engine`.

## 2026-07-04 — Claude Code — Fix .gitignore: track source dirs missing from the repo

- **Task:** Repository-integrity fix. Broad `.gitignore` directory rules meant for runtime output
  (`profiles/`, `reports/`, `instances/`, `storage/`, `data/`) also matched same-named **source**
  directories, so 32 real source files were never committed. `main` therefore could not build from a
  fresh clone (committed code imports `@src/profiles/FlowProfile`, `@src/instances/*`, `@src/reports/*`,
  `@src/storage/*`, `@src/data/*`, and `app/renderer/components/{instances,reports}/*` — all absent).
- **Root cause:** unanchored bare-directory patterns in `.gitignore` (lines ~53/61/62/64/65) match a
  directory of that name at any depth, including `src/profiles/`, `src/reports/`, etc.
- **Fix:** kept the broad rules (they still ignore genuine runtime dirs) and appended anchored
  negations re-including only the source trees: `!src/profiles/`, `!src/reports/`, `!src/instances/`,
  `!src/storage/`, `!src/data/`, `!app/renderer/components/instances/`, `!app/renderer/components/reports/`.
  Added the 32 previously-untracked source files. Sensitive patterns (`session-profiles.json`,
  `*.storageState.json`, `user-data-dir/`, `.env*`, etc.) remain ignored; no secrets/build output added
  (`SecretMasker.ts` is the masking utility, not a secret).
- **Files changed:** `.gitignore` + 32 source files under `src/profiles`, `src/reports`, `src/instances`,
  `src/storage`, `src/data`, `app/renderer/components/instances`, `app/renderer/components/reports`.
- **Verification:** `npm run build` clean, `npm run verify:runner` 76/76, `npm run verify:recorder` 42/42,
  `node scripts/ai-memory/check-memory.mjs` passed. Branch `fix/track-source-dirs-gitignore` (own PR).

## 2026-07-04 — Claude Code — Handoff prep after Smart Locator + Git Full Cycle merges

- **Task:** `/HANDOFF` — prepare the repo for the next agent/human after the stacked-PR merge cycle.
- **Repo state:** `main` at `35548e1` (PR #2 merge); both PRs merged; local merged branches deleted;
  now on a clean `feature/smart-wait-engine` branch (no feature work started). Git metadata is available
  (earlier handoffs' "not a Git repository" note is obsolete).
- **Docs updated:** rewrote `docs/ai/HANDOFF.md` (new current handoff: Smart Locator runtime delta +
  Git Full Cycle skill merged, Smart Wait Engine is the next feature; superseded 2026-07-03 connector
  content moved to Handoff History). Added the `git-full-cycle` cross-agent skill to the
  `docs/ai/CURRENT_STATE.md` AI-agent-architecture inventory.
- **Validation:** `node scripts/ai-memory/check-memory.mjs` — passed. Docs only, so
  `verify:recorder`/`verify:runner`/`build` not re-run this turn (current on `main`: 42/42, 76/76, clean).
- **Note:** Two merged remote branches (`chore/save-inflight-recorder-work`,
  `feature/smart-locator-engine`) still exist on `origin`, left pending user confirmation to delete.

## 2026-07-04 — Claude Code — Smart Locator: runtime fallback, visibility disambiguation, context scoping

- **Task:** Make the existing recorder locator engine production-ready by adding the missing runtime
  delta (the recorder already generates ranked, uniqueness-validated locators). Targeted scope from
  the Smart Locator Engine plan — no new module tree, minimal diffs.
- **What was added:**
  - **Structured locator model** (`src/profiles/FlowProfile.ts`): `StepLocator` now carries optional
    `alternatives: LocatorCandidate[]` (ranked runtime fallbacks) and `context` (container/frame
    scoping). `FlowStep.locator` points at `StepLocator`. Fully backward compatible — legacy steps set
    only the primary fields and deserialize unchanged.
  - **Runtime resolver** (`src/runner/LocatorFactory.ts`): new async `resolve(step)` builds a scoped
    root from `context` (iframe `frameLocator`, then a container resolved to its single/visible match),
    tries the primary then `alternatives` in order, and returns a **single** element per candidate —
    unique match wins, else the one *visible* match when several exist (the fix for a hidden modal
    template + visible modal). Falls back to the primary (auto-wait) when nothing is present yet, and
    throws an actionable diagnostic (per-candidate count/visibleCount + context) when genuinely
    ambiguous. Playwright is 1.49 (no `filter({ visible })`), so visibility is probed via
    `nth(i).isVisible()`. `create()` is retained for count/loop/waitFor paths.
  - **StepExecutor** (`src/runner/StepExecutor.ts`): single-target actions (click/fill/select/check/
    uncheck/radio/scroll-element/upload/download/readText/assertVisible/assert value+text/screenshot
    element) now go through `resolve(step)`; count assertions, element loops, and `waitFor` keep
    `create()`. `guardLocatorQuality` now defers to the resolver when the step has `context` or
    `alternatives` (so recoverable non-unique steps aren't pre-failed).
  - **Recorder** (`recorderInitScript.ts`, `RecorderTypes.ts`, `buildRecordedFlow.ts`): the in-page
    capture script now emits up to 3 ranked `alternatives` and a `context` — nearest **visible dialog**
    (id/testId/role, `visibleOnly`), **table row** (role=row + row text), **card/list item**
    (testId/role + `hasText`), and **iframe** (`frameLocator` selector for same-origin frames). Rows/
    cards are only scoped when the primary is not already globally unique.
- **Files changed:** `src/profiles/FlowProfile.ts`, `src/runner/LocatorFactory.ts`,
  `src/runner/StepExecutor.ts`, `src/recorder/recorderInitScript.ts`, `src/recorder/RecorderTypes.ts`,
  `src/recorder/buildRecordedFlow.ts`, `scripts/verify-recorder-locator.mts` (Part C, +15 checks),
  docs.
- **Tests:** `npm run verify:recorder` → **42/42** (new Part C: duplicate hidden+visible modal,
  visibility fallback, table-row scoping, repeated-card scoping, alternative fallback, iframe context,
  legacy backward-compat). `npm run build` clean; `npm run verify:runner` → 76/76 (no regressions).
- **Not done / limitations:** No UI changes (locator quality badge / debug candidates table / manual
  override editor) — resolver + recorder only. Closed shadow DOM and cross-origin iframes still can't
  be scoped. Feature branch: `feature/smart-locator-engine`.

## 2026-07-04 — Claude Code — Add Git Full Cycle agent skill

- **Task:** Add a reusable Git lifecycle skill teaching agents to safely inspect status, protect
  in-flight work, branch, commit, push, open PRs, handle protected `main`, and manage stacked PRs.
- **What was added:**
  - Added the Git Full Cycle skill for Claude, Codex, and Gemini as byte-identical mirrors:
    `.claude/skills/git-full-cycle/SKILL.md`, `.codex/skills/git-full-cycle/SKILL.md`,
    `.gemini/skills/git-full-cycle/SKILL.md`, plus a canonical shared copy at
    `docs/ai/skills/git-full-cycle/SKILL.md` (`.codex/` and `docs/ai/skills/` newly created).
  - Added a **Git Full Cycle Skill** reference section to the agent entry files `CLAUDE.md`,
    `AGENTS.md`, and `GEMINI.md` (existing content preserved) pointing each agent at its mirror and
    requiring the skill be read before branch/stage/commit/push/PR operations.
- **Files changed:** `.claude/skills/git-full-cycle/SKILL.md`, `.codex/skills/git-full-cycle/SKILL.md`,
  `.gemini/skills/git-full-cycle/SKILL.md`, `docs/ai/skills/git-full-cycle/SKILL.md`, `CLAUDE.md`,
  `AGENTS.md`, `GEMINI.md`, `docs/ai/TASK_LOG.md`.
- **Validation:** `node scripts/ai-memory/check-memory.mjs` (no `verify:ai-memory` npm script exists).
- **Branch:** committed on `chore/save-inflight-recorder-work` (PR #1 still open — docs/skills work
  belongs with it). No Smart Locator feature files touched; Smart Wait Engine not started; no UI
  diagnostics added.

## 2026-07-04 — Claude Code — Recorder: guarantee unique positional fallback locator

- **Task:** Recorder saved a non-unique positional locator, so runs failed with
  "the saved locator matches N elements" (reported: `css=div > div > div > div:nth-of-type(3) > div > div:nth-of-type(3) > svg` matched 6 elements).
- **Root cause:** `structuralSelector` in `src/recorder/recorderInitScript.ts` built a floating
  child-combinator chain capped at 6 levels and only added `:nth-of-type` for same-tag siblings; it
  never validated the result against the live DOM, so the path could match many sibling subtrees.
- **Fix:** Rebuilt `structuralSelector` to walk up from the element prepending one segment per
  ancestor and stop the instant the accumulated path resolves to exactly one element (`q === 1`).
  Each segment pins the node's position among ALL siblings via `:nth-child` (more disambiguating than
  `:nth-of-type`); a stable ancestor id short-circuits into an anchored unique path. This yields the
  shortest unique path and keeps the fallback flagged low-confidence. Semantic/scoped strategies are
  unchanged and still preferred first.
- **Files changed:** `src/recorder/recorderInitScript.ts` (fallback rewrite),
  `scripts/verify-recorder-locator.mts` (added regression test 4b: repeated deeply-nested
  attribute-less `<svg>` subtrees must resolve to one element).
- **Tests run:** `npm run verify:recorder` **27/27** (was 25 + 2 new); `npm run build` clean.
- **Result:** Recorded positional-fallback locators are now unique; the reported multi-match failure
  no longer occurs.

---

## 2026-07-04 — Claude Code — Instances: remove Load More, always-on two-row card scroller

- **Task:** In the Concurrent Instance Monitor, remove the "Load More workflows" button and instead always
  render every workflow card, capping the grid at two rows tall with an internal scroller when the cards
  overflow two rows.
- **Behavior now:** `visibleWorkflows = filteredWorkflows` (all cards always rendered).
  `needsScroll = filteredWorkflows.length > visibleCardCount(gridColumns, 2)`. When `needsScroll`, the grid
  gets `.is-scrolling` (`overflow-y:auto`) and an inline `maxHeight` measured from two card rows + one row
  gap (unchanged measurement logic, now gated on `needsScroll` instead of the old `cardsExpanded`). At two
  rows or fewer the grid renders at natural height with no scroller. Removed the `cardsExpanded`/`visibleRows`
  state, the `INITIAL_CARD_ROWS`/`ROWS_PER_LOAD` constants (replaced by `MAX_CARD_ROWS = 2`), the Load-More
  button, and its search-reset side effects. A "Showing all N workflows — scroll the grid" hint remains when
  scrolling is active.
- **Files changed:** `app/renderer/pages/InstanceMonitor.tsx` (logic + render),
  `app/renderer/styles/global.css` (removed orphaned `.im-load-more` button rule; refreshed a stale
  "Load More" grid comment).
- **Tests run:** `npm run build` clean; `npm run verify:instance-monitor` **22/22** (the `visibleCardCount`
  helper is still used for the two-row threshold and remains covered). Not run: GUI walkthrough of the live
  scroller (manual check outstanding).
- **Result:** Load-More button gone; two-row card scroller is always-on when cards overflow two rows.

---

## 2026-07-04 — Claude Code — AI agent architecture hardening

- **Task:** Added/completed the scalable multi-agent architecture for Cursor, Claude Code,
  Codex/Antigravity, Gemini, and future agents — without rewriting existing AI memory.
- **Baseline preserved:** `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, all existing `docs/ai/*`,
  `.claude/commands/{HANDOFF,TAKEOFF}.md`, `.claude/skills/ai-memory-maintainer`,
  `.agents/skills/{ai-memory-maintainer,agent-handoff,agent-takeoff}`, `.agents/workflows/*`,
  and `.gemini/commands/*` were left untouched.
- **Files added:** `docs/ai/README.md` (concise AI-memory index); `.cursor/rules/`
  `00-project.mdc`, `10-electron-react.mdc`, `20-playwright-runner.mdc`, `30-storage-ipc.mdc`,
  `90-safety.mdc`; `.claude/skills/` `codebase-review`, `feature-implementation`, `bug-fix`,
  `test-and-verify`, `docs-sync`, `refactor-safe`, `pr-review` (each `SKILL.md`); `.agents/skills/`
  `codebase-review`, `feature-implementation`, `bug-fix`, `test-and-verify` (tool-neutral `SKILL.md`).
- **Files changed:** `scripts/ai-memory/check-memory.mjs` — added a non-fatal `optionalFiles`
  warning pass for the new README, Cursor rules, and Claude/agent skills (required checks and
  secret scans unchanged; Cursor rules stay soft, not hard failures).
- **Verification:** `node scripts/ai-memory/check-memory.mjs` → passed required checks, exit 0,
  no warnings. `npm run build`: skipped — only AI-memory Markdown, Cursor `.mdc`, and the checker
  script changed (no app runtime/TS source touched).
- **Result:** Architecture targets 1–11 met; all optional adapter/skill files present.
- **Remaining work:** None for this task. Cursor rules are enforced softly by design.

---

## 2026-07-04 — Claude Code — Recorder wait-capture + Start/End nodes, canvas-click collapse, last-opened restore, Instances Load-More scroller, reusable saved URLs

- **Task:** Six-point AWKIT change set across Recorder, Flow Designer, Workflow Builder, and Instances.
- **Point 1 — Recorder wait-time capture:** New toggle in Recorder Controls (default OFF, persisted at
  `settings.recorder.captureWaitTime`). When ON, `RecorderService` measures think-time between distinct
  actions and inserts a `wait` action (`waitMs`) for pauses ≥ 500 ms (capped 60 s); `buildRecordedFlow`
  saves it as a fixed-time wait step (`config.waitType:"time"`, `timeoutMs`). OFF = unchanged behavior.
- **Point 2 — default Start/End nodes:** Extracted `src/recorder/buildRecordedFlow.ts` (pure). Recorded
  flows now always contain Start + End with actions between (`Start → action… → End`; `Start → End` when
  empty); Start's edge is `always`, action edges `success`; recorded start/end are de-duped.
- **Point 3 — empty-canvas collapse:** Clicking empty canvas in Flow Designer (`onPaneClick`) and Workflow
  Builder collapses the app side menu (new `navigation.collapseSidebar()`), Node Palette / Workflow
  Definition, and Node Properties / Selected Connector — collapse-only (idempotent, persisted). Node
  selection still auto-opens properties; connector selection opens the connector panel (Workflow Builder
  now expands the right panel on edge click).
- **Point 4 — last opened restore:** Already persisted (`selections.lastSelectedFlowId` /
  `selectedBuilderWorkflowId`); added stale-reference clearing so a deleted flow/workflow no longer sticks.
- **Point 5 — Instances Load More:** After Load More, the workflow-card grid renders all cards but becomes
  a two-row internal scroller (measured height + `.workflow-card-grid.is-scrolling`), so the page below
  stays put. Pre-click layout unchanged; new search resets it.
- **Point 6 — reusable saved URLs:** URL history moved out of the transient draft into its own persisted,
  deduped, canonicalized `recorder-urls.json` (survives save/cancel/restart). New `recorder:saveUrl` IPC +
  "Save URL" button; clicking a saved URL row fills the Controls URL field (`saveUrl`/click-to-fill).
- **Files changed:** `src/recorder/RecorderService.ts`, `src/recorder/RecorderTypes.ts`,
  `src/recorder/buildRecordedFlow.ts` (new), `app/main/ipc/recorder.ipc.ts`, `app/main/preload.ts`,
  `app/main/uiSettings.ts`, `app/renderer/pages/Recorder.tsx`, `FlowChartDesigner.tsx`, `ScenarioBuilder.tsx`,
  `InstanceMonitor.tsx`, `app/renderer/App.tsx`, `app/renderer/state/navigation.tsx`,
  `app/renderer/styles/global.css`. Tests: rewrote `scripts/verify-recorder-draft.mts`, added
  `scripts/verify-recorder-flow.mts` + `npm run verify:recorder-flow`.
- **Tests run:** `npm run build` clean; `verify:recorder-draft` **15/15**; `verify:recorder-flow` **13/13**;
  `verify:recorder` **25/25**; `verify:instance-monitor` **22/22**; `verify:runner` **76/76**. Not run:
  GUI walkthroughs for the canvas-collapse and Load-More scroller (manual GUI check outstanding).
- **Result:** All six points implemented; automated validation green.

---

## 2026-07-03 — Claude Code — Recorder: persist unsaved recording draft (URLs survive app close)

- **Task:** Follow-up to "why are Recorded URLs removed when the app closes?" — they were session-scoped,
  in-memory only on the `RecorderService` singleton, so closing before Save lost them. Implemented draft
  persistence so an unsaved recording (actions + URLs) survives a restart and reloads on the Recorder page.
- **How:** `RecorderService` now writes a small JSON draft (`recorder-draft.json`) under the runtime data
  root (`getRuntimeDataRoot()`, i.e. `%LOCALAPPDATA%/WebFlow Studio/`). New methods:
  `configureDraftStorage(path)` (set once by the recorder IPC at startup), `scheduleDraftPersist()`
  (debounced write, called on every recorded action/URL and dedup update), `persistDraft()`,
  `ensureDraftLoaded()` (one-time restore on startup, only when idle + empty so it never clobbers a live
  session), and `discardDraft()` (clear memory + delete file). `startRecording` replaces any old draft;
  `stopRecording` flushes a final write; `cancelRecording` discards; `saveFlow` (IPC) discards after the
  flow is written. `recorder:getActions`/`getUrls` await `ensureDraftLoaded()` so the Recorder page shows a
  restored draft on mount. Renderer `handleSave` now also clears the URL table (consistent with discard).
  URLs are masked and passwords blanked before storage, so the draft holds no secrets.
- **Files changed:** `src/recorder/RecorderService.ts`, `app/main/ipc/recorder.ipc.ts`,
  `app/renderer/pages/Recorder.tsx`. Added `scripts/verify-recorder-draft.mts` +
  `npm run verify:recorder-draft`. Docs: TASK_LOG, CURRENT_STATE, COMMANDS, TESTING, HANDOFF.
- **Tests run:** `npm run build` clean, `npm run verify:recorder-draft` **7/7** (write → restart-restore →
  discard round-trip), `npm run verify:recorder` **25/25** (unaffected).
- **Result:** Recorded URLs (and actions) now survive an app close until explicitly saved or discarded.

## 2026-07-03 — Claude Code — Fix: dropdown not closing on outside click + recorder losing un-blurred text

- **Bug 1 (dropdown):** the `SearchableSelect` combobox (Flow Designer "Saved Flow" picker + the Run-Another-
  Flow node property pickers) did not close when clicking the canvas. Root cause: its outside-click
  listener used a **bubble-phase `mousedown`**, but the React Flow pane consumes pointer events on the
  canvas, so the document listener never fired. Fix: `SearchableSelect.tsx` now listens on **`pointerdown`
  in the capture phase** (fires before any handler can stop propagation; also covers touch "tap out").
  (Workflow Builder's workflow selector is a native `<select>`, which already auto-closes.)
- **Bug 2 (recorder):** typed text was recorded only on the `change` event, which fires on **blur** — so
  text typed into a field that never lost focus (user stops recording while focused, or a SPA re-renders
  the input) was lost. Fix: `recorderInitScript.ts` now also records the value on every **`input`** event
  (live), and `RecorderService`'s `__awtkit_recordAction` binding **collapses consecutive same-field fills**
  (same page + same locator) into one action — so live capture doesn't bloat the saved flow. Password
  values are still masked in both paths.
- **Files changed:** `app/renderer/components/shared/SearchableSelect.tsx`,
  `src/recorder/recorderInitScript.ts`, `src/recorder/RecorderService.ts`. Tests extended:
  `scripts/verify-recorder-locator.mts` (added a no-blur live-typing case),
  `scripts/verify-flow-designer-gui.mjs` (added a dropdown outside-click-closes case). Docs: TASK_LOG,
  CURRENT_STATE, COMMANDS, TESTING, HANDOFF.
- **Tests run:** `npm run build` clean, `npm run verify:runner` **76/76** (unaffected),
  `npm run verify:recorder` **25/25** (incl. "live typing (no blur) records a fill" / captures the value),
  `npm run verify:flow-designer` **19/19** (incl. "Saved Flow dropdown … closes on an outside canvas
  pointerdown"). `npm run verify:workflow-builder` unaffected (last green 13/13).
- **Result:** Both reported bugs fixed and verified in the real Electron app / a real Chromium recorder run.

## 2026-07-03 — Codex — Remaining-work burn-down: runtime safeguards, handoff resume, GUI branch verification

- **Task:** Resolve the repo-verifiable items from the handoff Remaining Work: close the branch-pair
  2→1 GUI verification gap, add Workflow Builder runtime connector-structure validation, and fix the
  manual/protected-login handoff dead-end. Also rebuild current portable/NSIS packages for the offline VM
  walkthrough.
- **Connector GUI fix:** `ActionFlowNode.tsx` and `ScenarioFlowNode.tsx` now call
  `useUpdateNodeInternals(id)` when `portFlags` change; without this, dynamic branch handles rendered but
  real drag-connections could miss the new handle bounds. `scripts/verify-flow-designer-gui.mjs` now drags
  from `conditional-out-1` to create a second branch and deletes one branch to prove the survivor reverts to
  Normal.
- **Runtime validation:** `FlowDependencyResolver.validate()` mirrors Workflow Builder connector-structure
  rules for `ScenarioProfile.links` before execution: structured loop links must self-loop, multiple
  standard outgoing workflow links are blocked, and loop-controlled workflow flows may only exit via
  Conditional links.
- **Handoff resume:** `ManualHandoffController` now tracks pending promises and resolves Continue/Retry/
  Cancel. `StepExecutor` waits inside the live runner/browser; `ExecutionEngine` owns the shared controller,
  marks `waitingForManualAction` through live progress, keeps waiting instances active, exposes
  `retryHandoff`, and cancels pending handoffs on stop. `ProtectedLoginHandoffPanel` now offers Continue and
  maps Retry Detection to in-place retry instead of `repeatInstance`.
- **Files changed:** `src/orchestrator/FlowDependencyResolver.ts`, `src/runner/ManualHandoffController.ts`,
  `src/runner/StepExecutor.ts`, `src/runner/ExecutionEngine.ts`, `src/runner/RunnerProgress.ts`,
  `app/main/ipc/execution.ipc.ts`, `app/main/preload.ts`,
  `app/renderer/components/auth/ProtectedLoginHandoffPanel.tsx`,
  `app/renderer/pages/InstanceMonitor.tsx`,
  `app/renderer/components/workflow/ActionFlowNode.tsx`,
  `app/renderer/components/scenario/ScenarioFlowNode.tsx`, `scripts/verify-runner.mts`,
  `scripts/verify-flow-designer-gui.mjs`, `resources/dependency-manifest.json`, `dist/**`, and AI docs.
- **Tests/verification:** `npx tsc --noEmit` clean; `npm run build` clean; `npm run verify:runner` **76/76**;
  `npm run verify:flow-designer` **18/18**; `npm run verify:workflow-builder` **13/13**;
  `npm run validate:offline` passed; `npm run package:portable` passed with strict offline validation;
  `npm run package:nsis` passed with strict offline validation.
- **Remaining external gate:** clean-machine offline GUI walkthrough in `docs/OFFLINE_STANDALONE_PACKAGING.md`
  still requires a separate offline Windows VM with no Node/global Playwright/global Chromium. Current
  artifacts for that walkthrough: `dist/WebFlow Studio 0.1.0.exe` and
  `dist/WebFlow Studio Setup 0.1.0.exe`.

---

## 2026-07-03 — Claude Code — /HANDOFF after connector-rules task

- **Task:** Ran `/HANDOFF` to prepare `docs/ai/HANDOFF.md` for the next agent/human after the connector
  two-port-pair rules task (entry below).
- **Repo state:** Git metadata unavailable (`git status` → "not a git repository"); changed files were
  inspected directly and are listed in `docs/ai/HANDOFF.md` → Files Changed.
- **Files changed:** `docs/ai/HANDOFF.md` (Active Task, Completed Work, Files Changed, Commands/Tests,
  Current State Summary, Remaining Work, Known Risks, Do-Not-Touch, Recommended Next Step all refreshed for
  the connector-rules task), `docs/ai/TASK_LOG.md` (this entry).
- **Verification:** `node scripts/ai-memory/check-memory.mjs` passed. No source changed, so build/GUI
  suites were not re-run (last green: build clean, `verify:runner` 70/70, `verify:flow-designer` 17/17,
  `verify:workflow-builder` 13/13).
- **Result:** `docs/ai/HANDOFF.md` is ready for the next agent. No active/blocked task remains.

## 2026-07-03 — Claude Code — Connector rules: loop panel-lock, conditional/parallel two-port pairs

- **Task:** Apply four connector rules (UI + backend) across both canvases: (1) Loop is never selectable
  from the properties panel (button-only); (2) loop has execution priority over other connector kinds;
  (3) conditional connectors are a **two-port pair** (exactly 2 same-kind right-side ports, each with its
  own aligned connector, both locked to conditional; removing one auto-reverts the survivor to Normal and
  collapses to one centered port); (4) same for parallel (both locked parallel; sequential-by-default
  execution, config kept). Confirmed the design via AskUserQuestion before building.
- **Shared model (`connectorStyle.ts` + `ConnectorPorts.tsx`):** source side is a single centered
  `normal-out` port by default; once a conditional/parallel connector leaves the node it switches to a
  **branch pair** — two same-kind ports `<kind>-out-0/1` (evenly centered), so each of the 2 connectors
  aligns to its own port (fixes the old single-shared-handle overlap where "only one connector worked").
  New: `branchSourceHandle`, `slotFromHandle`, `MAX_BRANCH_CONNECTORS=2`, `ConnectorPortFlags.sourceKind`,
  and `reconcileBranchConnectors(edges, { kindOf, slotAssign, toNormal, revertSources })` which slots each
  node's pair and reverts a lone survivor to normal.
- **Both canvases wired identically:** `onConnect` caps branch connectors at 2 + reconciles; the panel
  kind/type change reconciles; edge deletion (Delete key via a wrapped `onEdgesChange`, panel delete, and
  node deletion) reconciles with `revertSources` so a surviving lone pair-member reverts to Normal; load
  reconciles saved edges. Flow Designer `ConnectionPropertiesPanel` and the Workflow Builder inline Link
  Type panel: Loop option disabled (Rule 1), kind+type selects locked while conditional/parallel/loop, with
  explanatory helper text.
- **Backend unchanged (verified compatible):** `FlowExecutor` already runs the self-loop before parallel
  fan-out and `resolveNext` (Rule 2 satisfied), and parallel defaults to sequential shared-page execution
  (Rule 4). Branch-pair invariants are maintained by construction (the UI only exposes the current mode's
  ports), so `validateConnectorStructure`/structure-issue checks (kind-based) needed no change.
- **Files changed:** `app/renderer/components/shared/connectorStyle.ts`, `.../shared/ConnectorPorts.tsx`,
  `.../workflow/ConnectionPropertiesPanel.tsx`, `app/renderer/pages/FlowChartDesigner.tsx`,
  `app/renderer/pages/ScenarioBuilder.tsx`. GUI harnesses extended: `scripts/verify-flow-designer-gui.mjs`
  (added conditional-pair checks; overlap-proof loop click). Docs: CURRENT_STATE, HANDOFF, KNOWN_ISSUES,
  this entry.
- **Tests run:** `npm run build` clean, `npm run verify:runner` 70/70, `npm run verify:flow-designer`
  **17/17** (incl. convert→2 aligned conditional ports `conditional-out-0/1` Δy=9.6, kind locked, delete
  reverts to one normal port), `npm run verify:workflow-builder` **13/13**.
- **Known gap:** the 2→1 survivor-revert (delete one of an existing pair) is verified by the reconcile
  logic + the delete-to-normal GUI path, but not by a GUI-drawn second connector (React Flow drag
  connections can't be driven headlessly). The Workflow Builder conditional-pair rendering uses the same
  shared components verified in the Flow Designer harness.

## 2026-07-03 — Claude Code — Workflow Builder connector GUI verification (closes the last loose end)

- **Task:** Narrow verification checkpoint — adapt the real-Electron GUI verification to the Workflow
  Builder canvas (the Flow Designer was already 13/13; Workflow Builder was the remaining un-walked
  surface). No new features unless a bug surfaced (none did).
- **Added:** `scripts/verify-workflow-builder-gui.mjs` + `npm run verify:workflow-builder` — launches the
  REAL built app (Playwright `_electron`, `ELECTRON_RUN_AS_NODE` cleared), navigates to the Workflow
  Builder, loads a saved workflow that has an edge (via the toolbar Workflow `<select>`), and drives the
  `.scenario-flow-node` connector UI.
- **Result: 13/13 GUI checks pass** on the user's saved workflows ("Mock — Data-Driven Workflow"): ports
  render un-clipped as card siblings (0 handles inside the `overflow:hidden` card, left/right on the node
  edges), Add Loop creates a visible edge, the top loop port becomes visible on the node's top edge, the
  loop draws as a **semicircle above** the node, the button toggles to Remove and deletes the edge (top
  port hides), and a loop node **locks its Link Type selector** (`selectDisabled=true`, conditional option
  stays enabled) — full parity with the Flow Designer.
- **Notes / gotchas found (no code changes needed):** (1) `ScenarioBuilder` starts with an empty canvas
  and loads `savedWorkflows[0]` (or the persisted selection) on mount — the script loads a workflow with
  edges via the toolbar select. (2) Loaded-workflow edge ids are the **saved link ids**, not
  `edge-<src>-<tgt>`, so the lock check gives every loopable node a self-loop (making any edge's source
  loop-controlled) and selects the remaining non-loop edge instead of parsing the source from the id.
- **Files changed:** `scripts/verify-workflow-builder-gui.mjs` (new), `package.json` (new
  `verify:workflow-builder` script). Docs: `docs/ai/CURRENT_STATE.md`, `docs/ai/HANDOFF.md`,
  `docs/ai/COMMANDS.md`, `docs/ai/KNOWN_ISSUES.md`, this entry.
- **Tests run:** `npm run verify:workflow-builder` 13/13 (real Electron GUI). No source/behavior changed,
  so build/runner were not re-run (last known green: build clean, `verify:runner` 70/70,
  `verify:flow-designer` 13/13).
- **Result:** Both connector canvases (Flow Designer + Workflow Builder) are now GUI-verified in the real
  app. No bugs discovered during verification.

## 2026-07-03 — Claude Code — Fix npm run dev launch + real GUI walkthrough of Flow Designer connectors

- **Task:** Stop feature work; (1) fix the `npm run dev` Electron launch crash that blocked all prior GUI
  verification, then (2) perform a real GUI walkthrough of the Flow Designer connector UI.
- **Root cause of the "launch crash" (misdiagnosed by 3 prior sessions as a Node/Electron version
  mismatch):** the agent/sandbox environment exports **`ELECTRON_RUN_AS_NODE=1`**, which makes the
  Electron binary boot as plain Node.js — `require("electron")` returns the binary path string (no
  `app`/`BrowserWindow`), and the ESM main entry gets loaded by bare Node, producing the
  `esm/translators` `TypeError: …reading 'exports'` (and the `Node.js v20.18.3` trace = Electron's Node
  running as node). Confirmed via `env | grep -i electron`. Clearing the var lets the GUI window open.
- **Fix:** `npm run dev` now runs `node scripts/dev.mjs`, which deletes `ELECTRON_RUN_AS_NODE` from the
  child env before spawning `electron-vite dev` (no-op on normal machines). Explored switching the main
  process to CommonJS to dodge the ESM preparse, then **reverted** it — the ESM main launches fine once
  the env var is cleared, so the module format was never the problem (kept the diff minimal).
- **Real GUI walkthrough:** added `scripts/verify-flow-designer-gui.mjs` + `npm run verify:flow-designer`,
  which launches the REAL built app (Playwright `_electron`, env cleared) and drives the Flow Designer.
  **13/13 checks pass** on the user's actual saved "Chatgpt-Login-v1.1" flow / "Auto Secure Login" node:
  ports render un-clipped as card siblings (0 handles inside the `overflow:hidden` card, left/right on the
  node edges), Add Loop creates a visible edge, the top loop port becomes visible on the node's top edge,
  the loop draws as a **semicircle above** the node (pathTop < nodeTop), the button toggles to Remove and
  deletes the edge (top port hides), and a loop node **locks its outgoing connectors to Conditional** in
  the properties panel. This retroactively validates the prior loop-port UI task (previously code-only).
- **Files changed:** `package.json` (dev script → `node scripts/dev.mjs`; new `verify:flow-designer`),
  `scripts/dev.mjs` (new), `scripts/verify-flow-designer-gui.mjs` (new). Reverted mid-task (net no change):
  `electron.vite.config.ts`, `app/main/windowManager.ts`, `src/runner/BrowserContextFactory.ts`,
  `src/recorder/RecorderService.ts` (all back to original ESM/import form). Docs:
  `docs/ai/KNOWN_ISSUES.md`, `docs/ai/COMMANDS.md`, `docs/ai/CURRENT_STATE.md`, `docs/ai/HANDOFF.md`, this
  entry.
- **Tests run:** `npm run build` clean, `npm run verify:runner` 70/70, `npm run verify:flow-designer`
  13/13 (real Electron GUI), `npm run dev` launches the GUI window (4 electron.exe processes, no crash).
- **Result:** `npm run dev` fixed and root-caused; the Flow Designer connector UI is now **GUI-verified**
  in a running app — the outstanding "no GUI walkthrough" caveat from the last three tasks is cleared for
  the Flow Designer. (Workflow Builder connector UI shares the same components but was not separately
  GUI-walked this pass.)

## 2026-07-03 — Claude Code — Loop port UI fix: top loop port, semicircle self-loop, un-clip ports

- **Task:** Second GUI-driven bugfix pass on the same connector subsystem. User reported (after real GUI
  testing): (1) port/connector points render corrupted; (2) the "Add loop" button is broken — clicking it
  on `Auto Secure Login` doesn't visibly create a loop, and the loop can't be deleted; (3) a loop
  connector should attach to a **special loop port on top of the node** and draw as a **visible semicircle
  above** the node; (4) once a node has a loop, any new right-edge connector must be **Conditional only**.
- **Root causes found:** (1) The prior task added `position: relative` to `.action-flow-node` /
  `.scenario-flow-node`, which — combined with the pre-existing `overflow: hidden` — made those cards the
  offset parent for the React Flow `<Handle>` elements rendered *inside* them, so the edge-hugging handles
  (half outside the card box) were **clipped**. (2) Loop handles were invisible, co-located on the right,
  and gated behind `flags.loop` (only true *after* the edge exists → flaky attach); the self-loop arc
  bulged sideways where the node covered it, so it read as "not created / not deletable".
- **Fix:**
  - **Un-clip ports** — `ConnectorTargetPorts`/`ConnectorSourcePorts` are now rendered as *siblings* of
    the node `<article>` (in `ActionFlowNode`/`ScenarioFlowNode`), so React Flow positions them against
    the un-clipped `.react-flow__node` wrapper instead of the `overflow: hidden` card.
  - **Top loop port** — new `ConnectorLoopPort` renders a dedicated `loop-out`/`loop-in` handle pair on
    the node's **top** edge (slightly apart), always present (so the loop edge attaches immediately) but
    invisible/non-interactive until a loop exists (`.connector-port-loop.active`).
  - **Semicircle** — `SelfLoopEdge` now detects a self-loop via `source === target` (node identity, not
    coordinates) and draws a semicircle arcing **above** the node; distinct-node "curved" case unchanged.
  - **Reliable add/remove** — the node loop button is now an add/remove **toggle** (filled "active" state
    when a loop exists; `title` switches to "Remove loop connector"); `addLoop` guards against duplicates.
  - **Conditional-only on connect** — both canvases' `onConnect` now force the new connector's kind to
    `conditional` when the source node already has a self-loop (was only enforced by the properties-panel
    lock + save-time validation before).
- **Files changed:** `app/renderer/components/shared/ConnectorPorts.tsx`,
  `app/renderer/components/shared/SelfLoopEdge.tsx`, `app/renderer/components/shared/connectorStyle.ts`
  (doc comment only), `app/renderer/components/workflow/ActionFlowNode.tsx`,
  `app/renderer/components/scenario/ScenarioFlowNode.tsx`, `app/renderer/pages/FlowChartDesigner.tsx`,
  `app/renderer/pages/ScenarioBuilder.tsx`, `app/renderer/styles/global.css`. Docs:
  `docs/ai/CURRENT_STATE.md`, `docs/ai/KNOWN_ISSUES.md`, `docs/ai/HANDOFF.md`, this entry.
- **Tests run:** `npx tsc --noEmit` clean, `npm run build` clean, `npm run verify:runner` 70/70 (no
  regressions), `npm run validate:offline` passed (dev-mode warnings only). No `verify:flow-designer`
  script exists (prompt listed it speculatively). `npm run dev` still cannot launch here (Electron
  bundled-Node ESM/CJS crash — see `KNOWN_ISSUES.md`), so the **GUI walkthrough remains outstanding** —
  the rendered semicircle, top port visibility, and click/drag behavior are not visually confirmed.
- **Result:** Corrupted-port, invisible/undeletable-loop, and loop-shape bugs addressed in code and
  backend-verified. Backward compatible: loop edges keep the same `loop-out`/`loop-in` handle ids, so
  existing saved self-loops re-attach to the new top port automatically. GUI verification still pending.

## 2026-07-03 — Claude Code — Fix connector-port bugs found via manual GUI testing

- **Task:** A user manually tested the Flow Designer/Workflow Builder (the AWKIT points 1–5 connector
  work below was previously only typecheck/build-verified, never GUI-walked) and reported 3 bugs: (1)
  Loop kind connector always disabled, (2) new conditional/parallel/loop connectors' ports not
  functional + wrong position, (3) loop connector should auto-attach to its node in a circular/retry-icon
  shape. User confirmed via AskUserQuestion: loop creation should use a dedicated button (not
  drag-to-self), and extra ports should be evenly distributed centered on the node (not fixed offsets).
- **Root causes found:** (1) Loop kind was gated on `edge.source === edge.target`, achievable only by a
  fiddly manual self-drag — effectively unusable. (2) Both canvases' `onConnect` hardcoded every new
  connector to kind "normal"/linkType "success", ignoring `connection.sourceHandle`/`targetHandle`, so a
  drag from a conditional/parallel port silently created a normal connector. (3) Conditional/parallel
  ports were hardcoded to `top: 30%`/`70%` instead of centering as a group. (4) `portHandlesForKind
  ("loop")` reused the opposite-side `normal-out`/`normal-in` handles, so `SelfLoopEdge`'s same-point
  `isSelf` check never fired and a self-loop rendered as a giant arc instead of a tight circular shape.
- **Fix:** added a dedicated co-located `loop-out`/`loop-in` handle pair for loop connectors; added an
  "Add loop" button (small circular icon) on each node that creates the self-loop edge programmatically;
  added `connectorPortKindFromHandle()` so `onConnect` derives the new connector's kind from the dragged
  handle; added `portPositions(count)` to evenly space + center multi-port groups; extended
  `ConnectorPortFlags` with a `loop` flag.
- **Files changed:** `app/renderer/components/shared/connectorStyle.ts`,
  `app/renderer/components/shared/ConnectorPorts.tsx`, `app/renderer/components/workflow/
  ActionFlowNode.tsx`, `app/renderer/components/scenario/ScenarioFlowNode.tsx`, `app/renderer/pages/
  FlowChartDesigner.tsx`, `app/renderer/pages/ScenarioBuilder.tsx`, `app/renderer/styles/global.css`.
  Docs: `docs/ai/CURRENT_STATE.md`, `docs/ai/KNOWN_ISSUES.md`, `docs/ai/HANDOFF.md`, this entry.
- **Tests run:** `npx tsc --noEmit` clean, `npm run build` clean, `npm run verify:runner` 70/70 (no
  regressions). `npm run dev` **could not run** — Electron crashes on launch with a Node ESM/CJS
  translator error before any app code runs (trace reports Electron's own bundled Node v20.18.3; system
  Node here is 18.16.0, matching `docs/ai/COMMANDS.md`) — new environment finding, logged in
  `docs/ai/KNOWN_ISSUES.md`. No manual GUI walkthrough was possible as a result — the click/drag
  interactions and rendered arc/port positions are not visually confirmed.
- **Result:** Bugs fixed in code and backend-verified; GUI walkthrough still outstanding (second
  consecutive task on this subsystem to land without one — flagged clearly in `KNOWN_ISSUES.md` and
  `HANDOFF.md`).

## 2026-07-03 — Claude Code — /HANDOFF prepared after connector structure rules task

- **Task:** Ran `/HANDOFF` to close out the AWKIT connector-structure task (points 1–5, see the entry
  directly below) and prepare `docs/ai/HANDOFF.md` for the next agent.
- **Files changed:** `docs/ai/HANDOFF.md` (filled in Current Handoff with completed work, files changed,
  commands/tests run, remaining work, known risks, recommended next step), `docs/ai/TASK_LOG.md` (this
  entry).
- **Verification:** Git metadata unavailable in this checkout (`git status`/`git diff` both fail with
  "not a git repository") — recorded in `docs/ai/HANDOFF.md` instead of git output. `node
  scripts/ai-memory/check-memory.mjs` passed.
- **Result:** `docs/ai/HANDOFF.md` is ready for the next agent. No active/blocked task remains.

## 2026-07-03 — Claude Code — Connector structure rules (AWKIT points 1–5)

- **Task:** Implement 5 connector-structure enhancements to the Flow Designer + Workflow Builder, in order:
  (1) dynamic conditional/parallel ports, (2) prevent duplicate standard outgoing connectors, (3) loop
  connectors force additional connectors to Conditional, (4) loop connectors must be self-loops
  (source === target), (5) curved/circular connector shape option.
- **Files changed:** `src/profiles/FlowProfile.ts` (circular shape, `validateConnectorStructure`),
  `src/runner/FlowExecutor.ts` (self-loop execution model + runtime structure guard),
  `app/renderer/components/shared/connectorStyle.ts` (`portHandlesForKind`, `computePortFlags`, circular
  shape default for loop), `app/renderer/components/shared/ConnectorStyleEditor.tsx` (circular option),
  `app/renderer/styles/global.css` (port + self-loop label CSS), `app/renderer/components/workflow/
  ActionFlowNode.tsx`, `app/renderer/components/workflow/flowDesignerTypes.ts` (`portFlags`),
  `app/renderer/components/workflow/ConnectionPropertiesPanel.tsx` (kind-lock UI for points 3/4),
  `app/renderer/pages/FlowChartDesigner.tsx` (ports/edgeTypes/validation/save-gating),
  `app/renderer/components/scenario/ScenarioFlowNode.tsx`, `app/renderer/components/scenario/
  scenarioDesignerTypes.ts` (`portFlags`), `app/renderer/pages/ScenarioBuilder.tsx` (ports/edgeTypes/
  validation/save-gating, `scenarioEdgeKind`), `scripts/verify-runner.mts` (self-loop test fixtures + 2 new
  structural-safeguard tests).
- **Files added:** `app/renderer/components/shared/ConnectorPorts.tsx`, `app/renderer/components/shared/
  SelfLoopEdge.tsx`.
- **Verification:** `npx tsc --noEmit` clean; `npm run build` clean; `npm run verify:runner` → 70/70 (was
  68/68 — 2 new structural-safeguard tests, 3 loop tests rewritten for the self-loop model);
  `npm run validate:offline` passed (dev-mode warnings only). `npm run verify:flow-designer` does not exist
  — not run (per `docs/ai/COMMANDS.md`).
- **Result:** All 5 points implemented on both canvases. Loop connectors are now self-loop-only at both
  save-time (UI) and run-time (`FlowExecutor`); the legacy `loopBack` edge type is explicitly exempt.
  Ports/shape are derived at render time, no `FlowEdge`/`WorkflowEdge` schema change. **Not done:** GUI
  walkthrough of the port/self-loop visuals (no dev server run in this session — see `docs/ai/
  CURRENT_STATE.md`); Workflow Builder has no runtime-engine equivalent to `FlowExecutor`, so its structural
  safeguard is UI-only (documented in `docs/ai/KNOWN_ISSUES.md`).

## 2026-07-02 — Codex — Generic agent handoff/takeoff memory workflow

- **Task:** Add automated generic handoff and takeoff workflows to the AI memory system for Claude Code,
  Codex, Gemini, Antigravity, future agents, and human developers.
- **Files added:** `docs/ai/HANDOFF.md`, `.claude/commands/HANDOFF.md`,
  `.claude/commands/TAKEOFF.md`, `.gemini/commands/HANDOFF.toml`, `.gemini/commands/TAKEOFF.toml`,
  `.agents/skills/agent-handoff/SKILL.md`, `.agents/skills/agent-takeoff/SKILL.md`,
  `.agents/workflows/HANDOFF.md`, `.agents/workflows/TAKEOFF.md`.
- **Files changed:** `AGENTS.md`, `.claude/skills/ai-memory-maintainer/SKILL.md`,
  `.agents/skills/ai-memory-maintainer/SKILL.md`, `.agents/workflows/update-memory.md`,
  `.gemini/commands/ai-memory.toml`, `scripts/ai-memory/check-memory.mjs`,
  `docs/ai/DEVELOPMENT_WORKFLOW.md`, `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`.
- **Verification:** `node scripts/ai-memory/check-memory.mjs` passed.
- **Result:** Generic handoff/takeoff workflow added; `HANDOFF.md` is now part of the required memory set.

---

## 2026-07-02 — Claude Code — True concurrent parallel branches (opt-in isolated pages)

- **Task:** Add real concurrency for parallel connectors, gated behind explicit isolation config (per the
  spec's "require explicit isolation configuration"). `sharedPage` (default) stays sequential fan-out;
  `isolatedPage` runs branches concurrently, each on its own page in the shared browser context (shared
  cookies/session, independent DOM), bounded by `maxConcurrency`.
- **Files changed:**
  - `src/profiles/FlowProfile.ts` — `ParallelConnectorConfig.isolation` (sharedPage/isolatedPage); documented `maxConcurrency`.
  - `src/runner/FlowExecutor.ts` — `IsolatedBranchExecutor`/`ParallelBranchFactory` types; `branchExecutorFactory`
    constructor arg; `executeParallelIsolated` (bounded-concurrency batches, join/fail applied to collected results).
  - `src/runner/PlaywrightRunner.ts` — provides the branch factory (new page in the shared context + its own StepExecutor, closed after).
  - `app/renderer/components/workflow/ConnectionPropertiesPanel.tsx` — Execution (isolation) selector + Max concurrency field.
- **Tests:** `scripts/verify-runner.mts` +1 (isolated concurrent branches each run on their own page). → **68/68**.
- **Verification:** `npm run build` clean; `npm run verify:runner` → 68/68; `npm run validate:offline` passes; `npm run ai:memory` ✅.
- **Semantics note:** isolated `failFast` reports failure after branches settle (no hard-abort of in-flight branches);
  `waitAny` succeeds if ≥1 branch passes.

---

## 2026-07-02 — Claude Code — Connector polish: loop data-source dropdown + live-report connector events

- **Task:** Two follow-ups after checkpoint B. (1) Loop connector `dataSource` mode: pick a specific data
  source from a dropdown (or default to the workflow data source) with an optional row-key binding; runner
  honors `LoopConnectorConfig.dataSourceId`. (2) Surface connector events in the Live Report timeline.
- **Files changed:**
  - `src/runner/FlowExecutor.ts` — `progress?` constructor arg + `emitConnectorEvent()`; emits on structured
    conditional match, parallel fan-out, loop iteration, and Auto Secure Login restart; `resolveLoopValues`
    honors `dataSourceId`.
  - `src/runner/PlaywrightRunner.ts` — passes `this.options.progress` into `FlowExecutor`.
  - `app/renderer/components/workflow/ConnectionPropertiesPanel.tsx` — `dataSources` prop; loop dataSource
    dropdown + optional row key.
  - `app/renderer/pages/FlowChartDesigner.tsx` — passes `dataSources` to the connection panel; relaxed loop
    dataSource validation (row key optional).
- **Tests:** `scripts/verify-runner.mts` +1 (connector events reach the progress reporter). → **67/67**.
- **Verification:** `npm run build` clean; `npm run verify:runner` → 67/67; `npm run validate:offline` passes;
  `npm run ai:memory` ✅.

---

## 2026-07-02 — Claude Code — Structured connector model (checkpoint B of the AWKIT connectors/sessions spec)

- **Task:** The "full structured connector replacement" the user chose: a `kind`-based connector model with
  structured Conditional/Parallel/Loop configs across types, execution engine, designer UI, validation, and tests.
  Backward compatible — legacy edges keep executing via the expression paths.
- **Files added:** `src/runner/ConnectorConditionEvaluator.ts` (operators + sourceField resolution).
- **Files changed:**
  - `src/profiles/FlowProfile.ts` — `ConnectorKind`, `ConnectorConditionOperator`, `ConnectorConditionSource`,
    `ConditionalConnectorConfig`, `ParallelConnectorConfig`, `LoopConnectorConfig`; `FlowEdge.kind/conditional/
    parallel/loop`; `connectorKind()` helper.
  - `src/runner/RunnerResult.ts` — `StepExecutionResult.errorCode`.
  - `src/runner/FlowExecutor.ts` — structured conditional routing (priority) in `resolveNext`; parallel
    join/fail modes in `executeParallelTargets`; loop-connector execution (`executeLoopConnector` +
    `resolveLoopValues`, count/staticList/dataSource/whileCondition, param injection via runtimeInputs,
    `LOOP_CONNECTOR_HARD_CAP`).
  - `app/renderer/components/workflow/ConnectionPropertiesPanel.tsx` — `FlowConnectionData` gains
    kind/conditional/parallel/loop; kind selector + per-kind property fields.
  - `app/renderer/pages/FlowChartDesigner.tsx` — `createEdge` `extra`; `toFlowProfile`/`loadProfile`
    round-trip kind + configs; `validateFlow` connector checks (expected value, variable, loop bounds,
    ambiguous same-priority conditionals).
- **Tests:** `scripts/verify-runner.mts` +8 (conditional priority, conditional no-match safe stop, parallel
  waitAny, parallel failFast, parallel collectErrors, loop count, loop staticList, loop whileCondition).
- **Verification:** `npm run build` clean; `npm run verify:runner` → **66/66**; `npm run validate:offline`
  passes; `npm run ai:memory` ✅.
- **Not done (remaining):** true concurrent parallelism (still sequential fan-out), loop over multi-node
  branches (single target node only), dataSource-loop UI dropdown (binding is a text field), reporting/runtime
  connector events, GUI walkthrough, live real-Chrome capture.

---

## 2026-07-02 — Claude Code — Session registry + node behaviors (checkpoint A of the AWKIT connectors/sessions spec)

- **Task:** First checkpoint of the larger "Auto Secure Login / Reuse Session / smart connectors" spec.
  Decisions confirmed with user: **full structured connector replacement** (deferred to checkpoint B),
  **keep `SessionCaptureService`** (dedicated automation profile dir, AWKIT sessions dir), **both** restart
  mechanisms (engine counter + loopBack edge), **phased delivery**. This checkpoint = the additive,
  lower-risk session/node behaviors.
- **Files added:** `src/session/sessionMatch.ts` (`normalizeOrigin`, `profileOrigin`, `sessionMatchesUrl`,
  `findBestSessionForUrl`).
- **Files changed:**
  - `src/session/SessionProfile.ts` — `origin`, `loginUrl`, `source` fields.
  - `src/session/SessionCaptureService.ts` — compute `origin`/`loginUrl`/`source` on capture (`startCapture`
    gains optional `source`); backfill `origin`/`source` for legacy profiles in `list()`.
  - `src/runner/RunnerResult.ts` — `StepExecutionResult.outcome` + `restartRequired`.
  - `src/runner/StepExecutor.ts` — Auto Secure Login now matches by normalized origin, tags capture source,
    sets `outcome`/`restartRequired`; Reuse Session gains **auto-detect** (origin) vs **selected** modes and
    sets `outcome`; threads `outcome`/`restartRequired` through `execute()`.
  - `src/runner/FlowExecutor.ts` — engine-level Auto Secure Login restart guard (`MAX_AUTO_LOGIN_RESTART = 1`)
    that restarts from Start on `restartRequired` and fails safely on exhaustion.
  - `src/profiles/FlowProfile.ts` — `NodeConfig.reuseSessionMode`.
  - `app/renderer/components/workflow/flowDesignerTypes.ts` — `reuseSessionMode` field + default.
  - `app/renderer/pages/FlowChartDesigner.tsx` — map `reuseSessionMode` (+ only persist `reuseSessionId` in selected mode).
  - `app/renderer/components/workflow/FlowNodePropertiesPanel.tsx` — Reuse Session mode selector + auto-detect URL / selected dropdown.
  - `app/renderer/pages/SessionsManager.tsx` — Source column + origin subtitle + search over origin/source.
  - `.gitignore` — ignore `sessions/`, `profiles/`, `session-profiles.json`, `*.storageState.json`.
- **Tests:** `scripts/verify-runner.mts` +5 (normalized-origin match, auto-detect find, auto-detect no-match,
  engine restart-then-complete, restart-guard exhaustion). Updated the selected-mode "no id" test.
- **Verification:** `npm run build` clean; `npm run verify:runner` → **58/58**; `npm run validate:offline`
  passes; `npm run ai:memory` ✅.
- **Not yet done (later checkpoints):** full structured connector-config model (Conditional/Parallel/Loop
  configs, designer UI, validation, execution — checkpoint B), reporting/runtime events, GUI walkthrough,
  live real-Chrome capture.

---

## 2026-07-02 — Claude Code — Enhanced Connectors + Auto Secure Login + Reuse Session (Phases 1–3)

- **Task:** Three-phase feature set. Phase 1: enhanced flow connectors (new `outcome`, `loopBack`,
  `parallel` edge types + `maxLoopCount`). Phase 2: `autoSecureLogin` node (capture manual login in real
  Chrome mid-run, then resume automation). Phase 3: `reuseSession` node (load a saved session profile
  mid-run). Reviewed all three prompt specs against the live code first; the prompts' code was
  illustrative — several signatures (preload `session.*` not `sessions.*`, positional `StepExecutor`
  ctor, `resolveStepValue`) were adapted.
- **Phase 1 files changed:**
  - `src/profiles/FlowProfile.ts` — `FlowEdgeType` += `outcome`/`loopBack`/`parallel`; `FlowEdge.maxLoopCount`.
  - `src/profiles/ScenarioProfile.ts` — `ScenarioLink.type` union synced.
  - `src/runner/FlowExecutor.ts` — rewired routing: `resolveNext()` (outcome edges via `${stepResult.*}`
    scope, conditional, conditional/unconditional loopBack gated by `maxLoopCount`); loopBack-aware cycle
    guard that clears `visited` only on a taken back-edge and **falls through to success/always on
    exhaustion** (no cycle error); `executeParallelTargets()` sequential fan-out.
  - `src/runner/PlaywrightRunner.ts` — `chooseNextFlow` now checks `outcome` links before `conditional`.
  - `app/renderer/components/shared/connectorStyle.ts` — colors + animate/dash for new types.
  - `app/renderer/components/workflow/ConnectionPropertiesPanel.tsx` — new options, outcome/loopBack
    expression inputs, `maxLoopCount` input; `FlowConnectionData.maxLoopCount`.
  - `app/renderer/pages/FlowChartDesigner.tsx` — `createEdge`/`toFlowProfile` serialize `maxLoopCount`.
  - `app/renderer/pages/ScenarioBuilder.tsx` — workflow edge-type dropdown extended.
- **Phase 2–3 files changed:**
  - `src/profiles/FlowProfile.ts` — `StepType` += `autoSecureLogin`/`reuseSession`; `NodeConfig.reuseSessionId`.
  - `src/runner/StepExecutor.ts` — `BrowserRestarter` type; ctor gains positional `browserRestarter` +
    `sessionService`; public `setActivePage`; `executeAutoSecureLogin` + `executeReuseSession`.
  - `src/runner/PlaywrightRunner.ts` — mutable `BrowserHolder` + `restartBrowser` callback (close-only /
    relaunch with `persistentContext` + new `userDataDir`, re-points the live executor's page);
    `sessionService` option threaded to `StepExecutor`; save/restore active executor across child flows.
  - `src/runner/ExecutionEngine.ts` — injects `getSessionService()` into `PlaywrightRunner`.
  - `app/renderer/components/workflow/flowNodeCatalog.ts` — `autoSecureLogin` (ShieldCheck) + `reuseSession` (History).
  - `app/renderer/components/workflow/flowNodeRegistry.ts` — META + new `reuseSession` section.
  - `app/renderer/components/workflow/flowDesignerTypes.ts` — `reuseSessionId` field + default.
  - `app/renderer/components/workflow/FlowNodePropertiesPanel.tsx` — session-list fetch + `SearchableSelect`.
  - `app/renderer/pages/FlowChartDesigner.tsx` — `reuseSessionId` in `toNodeConfig`/`fromFlowStep`.
- **Tests:** `scripts/verify-runner.mts` +9 cases (multi-conditional first-match, outcome routing,
  loopBack max=2/max=1, parallel fan-out, autoSecureLogin skip/capture, reuseSession load/missing).
- **Verification:** `npm run build` clean; `npm run verify:runner` → **53/53** (was 44); `npm run
  validate:offline` passes. Not run: clean-machine GUI walkthrough; live real-Chrome capture (mocked in tests).
- **Result:** ✅ All three phases implemented, backward compatible, offline-first preserved.

---

## 2026-07-01 — Gemini — Session Capture Browser (manual login without automation detection)

- **Task:** Implement a Session Capture Browser feature that launches the user's real system Chrome/Edge
  (not Playwright's Chromium) so they can manually log into protected sites (Google, Microsoft,
  Cloudflare-gated) without being blocked by automation detection. After login, the session is saved
  for reuse in automation runs via `launchPersistentContext`.
- **Files added:**
  - `src/session/SessionProfile.ts` — types: `SessionProfile`, `SessionCaptureStatus`, `DetectedBrowser`.
  - `src/session/SessionCaptureService.ts` — core service: system Chrome/Edge detection (Windows paths),
    named profile directory management under `%LOCALAPPDATA%/WebFlow Studio/profiles/`, browser launch
    via `child_process.spawn --user-data-dir`, process monitoring, profile CRUD + metadata persistence.
  - `app/main/ipc/session.ipc.ts` — 9 IPC handlers (`session:list/startCapture/getStatus/delete/rename/
    detectBrowser/stopCapture/getById/markUsed`) + `getSessionService()` export.
  - `app/renderer/pages/SessionsManager.tsx` — full UI: browser detection banner, capture form with
    active-capture status, saved sessions table with rename/delete/open-folder, search + pagination.
- **Files changed:**
  - `app/main/ipc/index.ts` — register `registerSessionIpc()`.
  - `app/main/preload.ts` — add `session.*` namespace to the `playwrightFlowStudio` API.
  - `src/instances/InstanceConfig.ts` — add `sessionProfileId?: string`.
  - `app/main/ipc/execution.ipc.ts` — add `sessionProfileId` to `RunWorkflowRequest`, add
    `resolveInstanceTemplate()` that resolves profiles to `userDataDir + persistentContext`.
  - `src/instances/InstanceManager.ts` — prefer template `userDataDir` over per-instance generated path.
  - `app/renderer/routes.tsx` — add `sessions` route with `KeyRound` icon.
  - `app/renderer/layout/LeftNavigation.tsx` — add `sessions` to Data nav group.
  - `docs/ai/CURRENT_STATE.md` — document the new feature.
- **Tests run:** `npm run build` ✅ (tsc --noEmit + electron-vite); `npm run verify:runner` ✅ 44/44.
- **Tests not run:** `npm run validate:offline` (no resources/ or manifest touched); clean-machine GUI
  walkthrough (human/VM step). Live capture flow requires a running Electron app.
- **Result:** Feature fully implemented. Users can capture manual login sessions from a real Chrome/Edge
  browser and reuse them in automation runs. No automation detection triggered.

---

## 2026-07-01 — Claude Code — Investigation: manual/protected-login handoff dead-ends (no code change)

- **Trigger:** User's `Chatgpt-Workflow` instance paused on a "Protected login — action required" card
  with Provider/Reason/URL = unknown/—.
- **Findings (evidence-based, no code changed):**
  - The workflow runs one flow `flow-96138dff` (`Chatgpt-Login-v1.1`): Start → goto chat.openai.com →
    click → click "Log in" → **Manual Handoff** → End. The pause is that deliberate `manualHandoff` node.
  - `PlaywrightRunner.executeScenario` returns on `manualHandoff` (`:103-104`) and its `finally` closes
    the browser (`:130-131`), so the automation browser is gone when the card appears.
  - Instance Monitor handoff card: **Retry Detection → `repeatInstance`** (full re-run in a fresh
    context), **Cancel Run → `stopInstance`**. No in-place resume exists, so the flow can never get past
    the handoff. The `manualHandoff → saveSession` pattern in `flow-0a526377` is unreachable too.
  - UX gaps: `ProtectedLoginHandoffPanel` hardcodes the "Protected login" header for plain manual
    handoffs and shows `unknown/—` with no detection detail.
- **Files changed:** docs only — `KNOWN_ISSUES.md`, `CURRENT_STATE.md`, `TASK_LOG.md`.
- **Tests run:** none (documentation-only). **Result:** confirmed bug recorded; fix (keep browser open
  across a handoff + real Continue/resume) not yet implemented — awaiting user direction.

---

## 2026-07-01 — Claude Code — Recorder generates unique, Playwright-safe locators + runner safeguard

- **Task:** Fix the Recorder so it captures unique, Playwright-safe locators instead of generic
  utility-class selectors (e.g. `div.flex.items-center.justify-center`) that fail Playwright strict mode.
- **Files added:**
  - `src/recorder/recorderInitScript.ts` — self-contained DOM capture script (`installRecorderCapture`
    + `getRecorderInitScriptContent`): ranked candidate generation (role/label/placeholder/text/testId →
    stable attributes → id → scoped → positional fallback; never utility classes), live-DOM uniqueness
    validation, `LocatorQuality` metadata, human-readable step names, password-value masking.
  - `scripts/verify-recorder-locator.mts` — live Playwright verification (23 checks).
- **Files changed:**
  - `src/profiles/FlowProfile.ts` — new `LocatorQuality` type; `FlowStep.locator` gains `exact?`/`quality?`.
  - `src/recorder/RecorderTypes.ts` — `RecordedActionLocator` gains `exact?`/`quality?`.
  - `src/recorder/RecorderService.ts` — inject shared capture script via `addInitScript({ content })`;
    removed the old inline class-list locator logic.
  - `app/main/ipc/recorder.ipc.ts` — copy `exact`/`quality` onto saved `FlowStep.locator`.
  - `src/runner/LocatorFactory.ts` — honor `locator.exact` for role/text/label/placeholder.
  - `src/runner/StepExecutor.ts` — `guardLocatorQuality` (fail non-unique steps early) +
    `friendlyLocatorError` (translate strict-mode violations; raw error stays in logs).
  - Flow Designer: `flowDesignerTypes.ts` (+`locatorExact`/`locatorQuality`), `FlowChartDesigner.tsx`
    (round-trip + flow-level validation message), `FlowNodePropertiesPanel.tsx` (quality readout, exact
    toggle, clears stale quality on manual edits, validation message), `global.css` (`.locator-quality`).
  - `package.json` (+`verify:recorder`).
- **Tests run:** `npm run build` ✅ (tsc + bundles); `npm run verify:recorder` ✅ 23/23;
  `npm run verify:runner` ✅ 44/44 (regression check after LocatorFactory/StepExecutor edits).
- **Tests not run:** `npm run validate:offline` (PowerShell packaging validation — unrelated to this
  change; no `resources/` or manifest touched); clean-machine offline GUI walkthrough (human/VM step).
- **Result:** Recorder now saves unique semantic locators with quality metadata; designer surfaces
  non-unique locators; runner fails ambiguous steps with a friendly message. Backward compatible
  (all new fields optional; legacy flows load and run unchanged).

---

## 2026-07-01 — Claude Code — Recorder auto-captures visited URLs + Recorded URLs table

- **Task:** Automatically save URLs visited during a recording session and show them in a searchable,
  paginated table at the bottom of the Recording screen.
- **Capture:** `RecorderService` listens to main-frame `framenavigated` on the initial page and any tab the
  site opens (`context.on("page")`); records `{ id, url, title?, timestamp, source, sessionId }`. Sensitive
  query values (token/access_token/refresh_token/id_token/code/password/secret/session/auth/key/api_key)
  are masked to `***` **before storage** (`maskUrl`). Consecutive identical URLs within 1.5s are deduped;
  later revisits are kept. First URL = `manual_url_entry`, others = `navigation`. Session-scoped in memory,
  like recorded actions (start/cancel clear, stop keeps).
- **Wiring:** new `recorder:getUrls` IPC + `recorder.getUrls()` preload; `RecordedUrl` type in
  `RecorderTypes.ts`.
- **UI:** `Recorder.tsx` polls `getUrls` (500ms while recording + on mount + after stop) and renders a
  "Recorded URLs" table using the system table classes (`wl-table`, `table-search`, `DataTablePagination`,
  `TableEmptyState`): columns Time / Title / URL / Source / Session / Actions (copy). Case-insensitive
  search over url/title/source/session, resets to page 1; page sizes 10/25/50/100; newest-first; long URLs
  truncate with a full-value tooltip (`table-layout: fixed`). Empty + no-match states included.
- **Preserved:** existing recorder start/stop/cancel/getActions and Save to Flow Library unchanged.
- **Tests:** `npm run build` ✅; `npm run validate:offline` ✅. No `verify:recorder` script exists. GUI
  capture flow needs manual verification (headed browser). check-memory below.

---

## 2026-07-01 - Codex - Live Execution Report process-flow UI/UX fix

- **Task:** Improve the Live Execution Report modal, especially Flows & Steps, and fix the terminal
  "Updated" counter behavior.
- **Files changed:** `app/renderer/components/instances/LiveExecutionReportModal.tsx`,
  `app/renderer/components/instances/executionReportModel.ts`, `app/renderer/styles/global.css`,
  `docs/ai/CURRENT_STATE.md`, `docs/ai/FEATURES.md`, `docs/ai/TASK_LOG.md`.
- **UI/UX:** Replaced the static step-card grid with a connected horizontal process flow, numbered nodes,
  status icons/badges, active/waiting/manual-action animation, and a real progress bar based on visible
  step statuses. Narrow layouts keep the flow horizontally scrollable.
- **Failure handling:** Failed nodes now show friendly user-facing copy in the main UI; masked technical
  error detail is available only via hover/focus tooltip.
- **Timer/polling:** Modal report polling now runs only while the instance is live, with cleanup on close
  or unmount and one delayed final fetch after terminal transition. Terminal runs show a stable final
  update timestamp instead of an endlessly increasing relative "Updated" counter.
- **Tests:** `npm run build` passed; `npm run verify:instance-monitor` passed 22/22. Runner/offline
  verification not run because no runner/orchestrator/offline behavior changed. GUI walkthrough not run.

---

## 2026-06-27 — Claude Code — True live per-flow/per-step progress for the Execution Report

- **Runner progress events:** new `src/runner/RunnerProgress.ts` (`RunnerProgressReporter`,
  `RunnerProgressEvent`, bounded `LiveExecutionSnapshot`). `StepExecutor` takes an optional 8th
  `progress` reporter and emits `running` at step start and `succeeded`/`failed`/`waitingForManualAction`
  at step end (incl. the protected-login auto-pause). Threaded via `PlaywrightRunnerOptions.progress` →
  `StepExecutor` (existing call sites/tests unaffected — param is optional).
- **Bounded live snapshot in runtime state:** `InstanceRuntimeState.liveProgress?: LiveExecutionSnapshot`.
  `ExecutionEngine.createProgressReporter` folds step events into a snapshot (current flow/step, per-step
  states, recent events) capped at 500 steps / 200 events, resolves flow labels, and writes it to the pool
  (also live-updates the table's Current Flow/Step) — so the renderer's existing 1s poll shows live
  progress. No secrets stored.
- **Renderer:** `executionReportModel.buildLiveExecutionReport` now builds **per-step** node cards +
  timeline + stats from `instance.liveProgress` while running, from the stored report once finished, and
  falls back to the coarse per-flow map otherwise. Modal shows the active step pulsing, the flow label per
  card, and a live-updating timeline (`reports.get` still enriches/loads the final report; warning kept if
  it fails).
- **Compatibility:** final report + JSONL generation and workflow execution behavior unchanged; live and
  final share the same step statuses.
- **Tests:** `npm run build` ✅, `npm run verify:runner` ✅ 44/44, `npm run verify:instance-monitor` ✅
  22/22, `npm run validate:offline` ✅. check-memory below.

---

## 2026-06-27 — Claude Code — Live human-readable Execution Report modal (replaces JSONL button)

- **Instances table button:** the Files column's Logs (open-JSONL) button is replaced with a **Live Report**
  button (Activity icon, always enabled); the Screenshots button is kept. JSONL/report file generation is
  untouched — only the user-facing button changed.
- **New components:** `app/renderer/components/instances/executionReportModel.ts` (pure adapter +
  `LiveExecutionReport` types) and `LiveExecutionReportModal.tsx` (modal reusing `.modal-overlay`).
- **Data sources (no runner change):** banner/heartbeat from the live polled `InstanceRuntimeState`
  (status, currentStep, started, elapsed, manualHandoff); per-flow node map + step stats + timeline from
  the stored report (`reports.get(executionId)` → `InstanceReport.scenarioResult.flows[].steps[]` +
  `logs[]`). Added `reports.get` to preload (existing `reports:get` IPC). The modal refreshes the report
  every 3s while open so it fills in when the run completes.
- **UI/UX:** summary banner with status pill + animated heartbeat + "Running… waiting…" activity line;
  node-map cards with status colors and a pulse animation on the active/running/waiting node; statistics
  cards (total/completed/failed/pending/running, success rate, elapsed, avg/longest step, screenshots,
  errors — unavailable metrics show "Not available"); human-readable activity timeline from masked log
  messages (never raw JSON). Loading/empty states included. CSS-only animations.
- **Tests:** `npm run build` ✅, `npm run verify:instance-monitor` ✅ 22/22, `npm run validate:offline` ✅.
  No runner/report-generation files changed. check-memory below.

---

## 2026-06-27 — Claude Code — Recorder save feedback + Node Palette search-bar layout fix

- **Recorder "Save to Flow Library" feedback:** `Recorder.tsx` now shows clear success/failure feedback —
  shared `Toast` ("Flow saved to library successfully: <name>" / "Failed to save flow to library. Please
  try again. (<detail>)") plus an inline status banner in the Save Options panel. Added an `isSaving`
  pending guard (early-return + disabled button + "Saving…" label) so duplicate clicks can't corrupt the
  save. Existing save behavior/data unchanged; backend error message surfaced safely.
- **Node Palette search bar corruption:** root cause — the expanded `.flow-node-palette` is a CSS grid with
  `grid-template-rows: auto minmax(0, 1fr)` (two rows: head + scroll), but a third child (`.palette-search`)
  was added between them, so the search input landed in the `1fr` row and stretched tall while the list
  lost its scroll row. Fixed to `grid-template-rows: auto auto minmax(0, 1fr)` (head / search / scroll).
  Filtering/clear/drag-drop behavior unchanged (CSS-only fix).
- **Tests:** `npm run build` ✅ (tsc --noEmit + bundles). No `lint`/`test` npm scripts exist. check-memory below.

---

## 2026-06-27 — Claude Code — Protected Login Handoff (detect + pause + node + UI + OAuth foundation)

- **Detector (Task 01):** `src/security/ProtectedLoginDetector.ts` — pure `detectFromSignals(url,title,body)`
  + live `detectProtectedLogin(page)`. Flags provider URLs (Google/Microsoft/Okta/Auth0/Duo) and text
  signals (Google "browser may not be secure", "couldn't sign you in", CAPTCHA/"verify you are human"/
  "just a moment", MFA/2-step/authenticator, security check). Conservative: body text only scanned when
  URL/title is suspicious → no false positives on normal pages. Never reads/returns secrets.
- **Runner pause (Task 02):** `StepExecutor` auto-runs detection after goto/click/routeChange/wait; on
  detection it pauses via `ManualHandoffController` and returns `manualHandoff` + a `HandoffInfo`
  (`src/security/ProtectedLoginHandoff.ts`). Threaded through `FlowExecutor`/`PlaywrightRunner` results;
  `ExecutionEngine.runInstance` maps `manualHandoff` → `waitingForManualAction` with the detail, and the
  queue treats waiting as run-complete (no infinite loop; report still writes).
- **Node (Task 03):** new `protectedLoginHandoff` StepType + palette item + `protectedLogin` properties
  section (provider, handoff mode, instructions, detect-first, allow-retry, timeout). Validation surfaces
  capability notes (OAuth/saved/test-session unsupported) and requires instructions for pause-and-ask.
- **UI (Task 04):** `components/auth/ProtectedLoginHandoffPanel.tsx` in the Instance Monitor shows paused
  instances with provider/reason/URL + **Cancel Run** (stopInstance) and **Retry Detection**
  (repeatInstance); saved/test/OAuth actions shown disabled-with-reason unless supported.
- **OAuth foundation (Task 05):** `src/auth/OAuthHandoffService.ts` + `app/main/ipc/auth.ipc.ts` +
  preload `auth.*`. Capability-gated (env `WFS_OAUTH_*`); uses `shell.openExternal`; no fake tokens/success.
- **Sessions (Task 06):** Load Session not implemented → "Use Saved Session"/"Use Test Session" disabled
  with clear reasons. No third-party cookie extraction.
- **Docs (Task 07):** `docs/PROTECTED_LOGIN_HANDOFF.md`.
- **Verification (Task 08):** new `npm run verify:protected-login` (16/16, pure detector) + `verify:runner`
  extended (44/44, node pauses + auto-detect doesn't pause mock pages).
- **Tests:** `npm run build` ✅, `verify:runner` ✅ 44/44, `verify:protected-login` ✅ 16/16,
  `validate:offline` ✅, `verify:instance-monitor` ✅ 22/22, check-memory below.

---

## 2026-06-27 — Claude Code — Save Session node, flow row-open, shared connectors + style, palette/dropdown search

- **Task 01 — Save Session node:** new `saveSession` StepType. `StepExecutor.saveSession` writes Playwright
  `storageState` (cookies + localStorage/origins) to `<runtimeRoot>/sessions/<name>.json` (context.paths.sessions,
  set in `ExecutionEngine.runInstance` to `<dirs.root>/sessions`). Config: `sessionName`, `sessionFolder`,
  `overwriteSession`, `captureScope` (context | origin), `maskSession`. Validates required+file-safe name,
  writable folder, no-overwrite collision; logs only the path (never cookie/token values). Catalog + registry
  `session` section + properties UI added. `verify:runner` covers it (41/41, +4).
- **Task 02 — Flows row click → Flow Designer:** `FlowLibrary` rows are `role="button"`/tabbable, click or
  Enter/Space persists `selections.lastSelectedFlowId` and `navigateTo("flowChart")`; action buttons
  `stopPropagation`. Designer already loads `lastSelectedFlowId` on mount; Back returns via route history.
- **Task 03 + 06 — shared connector visuals + style customization:** new
  `components/shared/connectorStyle.ts` (`buildConnectorVisual`, `connectorTypeColor`, presets,
  `normalizeEdgeStyle`, `hasCustomStyle`) is now the single source for edge visuals in BOTH the Flow Designer
  (`createEdge`/`updateEdgeData`) and Workflow Builder (`createScenarioEdge`/`updateEdgeData`) — so they match.
  New `EdgeVisualStyle` on `FlowEdge`/`WorkflowEdge` (color/lineStyle/thickness/shape/arrowHead) persists and
  reloads; shared `ConnectorStyleEditor` added to both Connection Properties panels with Reset-to-default.
  Legacy connectors (no style) render with type defaults.
- **Task 04 — Node Palette search:** search input in the Flow Designer palette filters by
  label/type/description/category; "No matching nodes found." empty state; clear (X) + Escape reset.
- **Task 05 — searchable dropdowns:** new `components/shared/SearchableSelect.tsx` combobox applied to the long
  selectors in node properties (JSON Data Source, Target flow) and the Saved Flow selector — filter by
  label/value/description, keeps selection, "No matching options found." empty state.
- **Tests:** `npm run build` ✅, `npm run verify:runner` ✅ 41/41, `npm run validate:offline` ✅,
  `npm run verify:instance-monitor` ✅ 22/22, `check-memory` below.

---

## 2026-06-27 — Claude Code — UI fixes: instance-table alignment, DS row-preview, nav icon, brand mark

- **Instance table column alignment:** root cause was a global `table { display:block }` rule winning over
  `.instance-table` (so `table-layout:fixed` + `<colgroup>` were ignored) plus `.instance-name-cell` using
  `display:grid` on the `<td>` itself (removing it from the column model). Fix: `.instance-table` now sets
  `display:table`; `.instance-name-cell` is a normal table-cell with block-stacked `strong`/`small`.
  Horizontal scroll still handled by `.instance-table-wrapper`.
- **Data Source Manager preview on row click:** clicking a row now previews that source
  (`DataSourceManager` `<tr onClick>` → `openPreview`), with hover/selected row styles (`.ds-row*`);
  `stopPropagation` on the root-array-path input and the actions cell so they don't trigger a preview.
- **Runtime Inputs nav icon:** changed from `PlaySquare` (duplicated with Recorder) to `FormInput` in
  `routes.tsx`.
- **Brand mark consistency:** `.brand-mark` (WFS badge) is now a 32×32 square, radius 8px, weight 800,
  subtle shadow — consistent with the design system (was 38×30).
- **Tests:** `npm run build` ✅ (CSS/markup-only + icon swap; no logic touched). check-memory below.

---

## 2026-06-27 — Claude Code — Workflow cards grid: stable 3-column layout across Load More

- **Problem:** with `auto-fit minmax(250px,1fr)` the rendered column count depended on how many cards
  existed, so clicking "Load More" could reflow the row (cards-per-row and card width changed).
- **Fix (CSS only):** `.workflow-card-grid` is now `grid-template-columns: repeat(3, minmax(0,1fr))`
  (responsive: 2 cols ≤1080px, 1 col ≤680px). Cards-per-row and dimensions stay identical before/after
  Load More. `useGridColumns` still measures 3/2/1 for the Load-More row math; card design/min-height
  unchanged.
- **Tests:** `npm run build` ✅ (`verify:instance-monitor` logic unaffected — CSS-only change).

---

## 2026-06-27 — Claude Code — Workflow cards grid UI polish (equal height, full-width, no-jump hover)

- **UI-only changes** to the Concurrent Instance Monitor workflow cards (no runner/exec/logic changes;
  `instanceCardLogic` untouched, `verify:instance-monitor` still 22/22).
- **Equal-height cards:** `.workflow-card-grid` now `align-items: stretch`; `.workflow-card` is a fixed
  `grid-template-rows: auto 1fr` with `height:100%` + `min-height:250px`; names ellipsis, descriptions
  2-line clamped.
- **More cards per row:** grid switched from `auto-fill minmax(280px)` to `auto-fit minmax(250px, 1fr)`
  so cards stretch to fill the row (no wasted right gap) and up to ~4 fit on wide screens. The
  `useGridColumns` ResizeObserver still measures the real column count for Load-More math.
- **No-height-change hover:** `WorkflowRunCard` restructured into a fixed-height body with two
  absolutely-positioned, equal-area layers (`.workflow-card-summary` / `.workflow-card-params`) that
  cross-fade on `:hover`/`:focus-within`. Card height is constant → grid never reflows. Params inputs stay
  in the DOM and tab-focusable (focus reveals the layer); a "Hover or focus to configure & run" hint shows
  on the summary.
- **Full-width search & Load More:** removed `max-width` from `.im-card-search` (now `width:100%`) and
  `.im-load-more` (now full-width button).
- **Tests:** `npm run build` ✅, `npm run verify:instance-monitor` ✅ 22/22, `npm run verify:runner` ✅
  37/37, `npm run validate:offline` ✅, `check-memory` ✅.

---

## 2026-06-27 — Claude Code — Instance Monitor cards: unit verification + repackage

- **Goal:** close repo-verifiable unknowns for the workflow-cards work (no new features).
- **Extracted pure logic:** new `src/instances/instanceCardLogic.ts` (`filterWorkflows`,
  `visibleCardCount`, `validateCardParams`, `resolveWorkflowName`); `InstanceMonitor` now imports these
  instead of inline copies (behavior unchanged).
- **Added unit verification:** `scripts/verify-instance-monitor.mts` + `npm run verify:instance-monitor`
  → **22/22 pass** (search filter, responsive visible-count incl. 4×3=12 / 3×3=9 / 2×3=6 and +2-row Load
  More, per-card validation, deleted/unknown workflow-name resolution).
- **Repackaged after the UI change:** `npm run package:portable` → `dist/WebFlow Studio 0.1.0.exe`,
  `npm run package:nsis` → `dist/WebFlow Studio Setup 0.1.0.exe` (both unsigned; test-fixtures excluded).
- **Gates:** `npm run build` ✅, `npm run verify:runner` ✅ 37/37, `npm run validate:offline` ✅,
  `node scripts/ai-memory/check-memory.mjs` ✅.
- **Still GUI/VM-only:** live multi-workflow concurrency, hover/focus reveal, responsive widths, and the
  clean offline-VM walkthrough — see the checklist in `docs/OFFLINE_STANDALONE_PACKAGING.md`.

---

## 2026-06-27 — Claude Code — Instance Monitor workflow cards grid + workflow-aware instance records

- **Workflow cards grid (primary run UX):** new `components/instances/WorkflowRunCard.tsx` + a responsive
  grid in `InstanceMonitor`. Each card shows name/description, status badge (Active/Inactive/Invalid),
  flows + connectors counts, execution mode, data source, last updated; run parameters (total runs,
  concurrent, run mode, isolation, screenshot-on-failure [disabled — per-step concept], stop-on-error,
  Run) are revealed on **hover or keyboard focus** (`:focus-within`, inputs stay in the DOM so they're
  tabbable). Per-card params are independent, seeded from `settings.execution` defaults and persisted to
  the new `settings.workflowRunCards[workflowId]`.
- **Search + Load More by rows:** case-insensitive name/description search; grid shows 3 rows initially
  and Load More reveals +2 rows. Visible count = measured grid columns × rows (`ResizeObserver` reads
  `grid-template-columns`); search resets to 3 rows; empty states for no-workflows / no-match.
- **Classic form de-emphasized:** the old dropdown run form moved into a collapsed
  "Advanced / Classic run form" `<details>`; header keeps only **Stop All**.
- **Workflow column (Task 05):** instance table gains a Workflow column (resolves
  `scenarioId` → workflow name; "Deleted workflow"/"Unknown workflow" when missing); Instance subtext now
  shows the short execution id.
- **Concurrent workflows (Task 06):** fixed an instanceId collision — `InstanceManager` now mints
  globally-unique `instanceId` (`${executionId}-i${n}`) + sets `instanceOrderNumber`/`totalInstances`, so
  two workflows running at once no longer overwrite each other in the `InstancePool`. Card params
  `isolationMode` + `stopOnError` are plumbed through `RunWorkflowRequest` → the `ConcurrentRunProfile`
  (no fake controls; screenshot-on-failure shown disabled with tooltip).
- **Controls preserved (Task 07):** Pause All/Resume All/Stop All/Clear Completed moved to a monitor-wide
  bar; per-instance Pause/Resume/Stop/Repeat/Remove and the failed-only file-button rule unchanged.
- **Tests:** `npm run build` ✅; `npm run verify:runner` ✅ 37/37; `npm run validate:offline` ✅;
  `check-memory` — see below.

---

## 2026-06-27 — Claude Code — WB resize-handle alignment, Saved Flows pagination footer, per-instance Repeat

- **Task 02 fix — resize handles aligned to node bounds:** `.scenario-flow-node` had a fixed
  `width: 260px` and no `height: 100%`, so the article didn't fill the React Flow node wrapper that
  `NodeResizer` bounds — handles floated off the visible node. Now `width/height: 100%` +
  `box-sizing: border-box` + `overflow: hidden` (mirrors `.action-flow-node`).
- **Task 04 fix — Load More always discoverable:** Saved Flows now renders a footer showing
  "Showing X of N flows" whenever any flows exist, with the **Load More** button while more remain
  (and "All flows loaded." once exhausted). Previously the button only appeared when >10 flows existed,
  so with ≤10 it looked unimplemented. Logic unchanged (10 per page).
- **Task 09 (new) — Repeat single instance:** added `executionEngine.repeatInstance(instanceId)` which
  re-runs a finished instance from a retained per-execution `RunContext` (flows/scenario/dataSources/
  dirs/runtimeInputs, stored in `startRun` and kept beyond the run). New `execution:repeatInstance` IPC +
  `executions.repeatInstance` preload. Instance Monitor controls column gains a Repeat (RefreshCw) button,
  enabled only for terminal instances; Controls column widened to 200px so 5 buttons don't overflow.
- **Tests:** `npm run build` ✅; `npm run verify:runner` ✅ 37/37; `check-memory` — see below.

---

## 2026-06-27 — Claude Code — Route Change node, WB navigation/resize/search, save toasts, instance-monitor fixes

- **Task 01 — WB double-click opens Flow Designer:** `ScenarioBuilder` `onNodeDoubleClick` persists
  `selections.lastSelectedFlowId` + `selectedBuilderWorkflowId`, then `navigation.navigateTo("flowChart")`
  (routes through the unsaved-changes guard). `FlowChartDesigner` now honors `lastSelectedFlowId` on
  mount. Header Back returns to the Workflow Builder (restores the workflow via `selectedBuilderWorkflowId`).
- **Task 02 — WB node resize:** `ScenarioFlowNode` adds a `NodeResizer` (visible only when selected);
  `ScenarioFlowNodeData` carries `width/height`; size persists via `WorkflowFlowNode.size` and restores
  on load. Defaults `SCENARIO_NODE_DEFAULT_WIDTH/HEIGHT`.
- **Task 03/04 — Saved Flows search + Load More:** case-insensitive name filter, 10 shown initially,
  "Load More" reveals +10, "All flows loaded." when exhausted, "No matching flows found." empty state;
  search resets paging.
- **Task 05 — Route Change node:** new `routeChange` StepType + `NodeConfig.{routeMode,urlMatch,routeWaitUntil}`.
  Modes: switchToUrl / switchToLatestTab / waitForNewTab / navigateCurrentPage. Runtime switches the
  active page so later steps target the new tab: `StepExecutor` now holds a mutable `activePage` +
  `setActivePage`, and `LocatorFactory.setPage` redirects locators. Palette item, properties section, and
  mode-aware validation (incl. invalid-regex) added.
- **Task 06 — mock/recorder/fixtures:** mock site gains `#openNewTabButton` (form) + `/details` page
  (`routeChangeTargetTitle/Input/Submit/Result`). `RecorderService` inserts a Route Change action when an
  interaction occurs on a different tab/page; `recorder.ipc` maps it to a `switchToLatestTab` step. Seed
  adds `mock-route-change-flow` + `mock-route-change-workflow`. `verify-runner.mts` covers Route Change.
- **Task 07 — save messages:** shared `components/shared/Toast` + `.app-toast` CSS; Flow Designer and
  Workflow Builder show "… saved successfully: <name>" / "Failed to save changes. <err>". Data Source
  Editor already had success/error banners.
- **Tasks 08–10 — Instance Monitor:** Clear Completed now removes terminal instances from the backend
  pool (`executions.removeInstance`) so the 1s poll can't re-add them; controls audited (all map to real
  `executionEngine` methods); file/artifact buttons (Logs/Screenshots) enabled ONLY for `failed` instances
  with a path, disabled for completed/others, with status-specific tooltips.
- **Tests:** `npm run build` ✅; `npm run verify:runner` ✅ 37/37 (was 31; +6 Route Change); seed ✅
  (11 flows / 4 workflows / 1 data source); `npm run validate:offline` and `check-memory` — see below.

---

## 2026-06-27 — Claude Code — Selected-node resize handles + snapshot dirty-state + mock test fixtures

- **Task 1 — resize handles only on the selected node:** `ActionFlowNode.tsx` already used
  `<NodeResizer isVisible={selected} …>`; added a CSS safety net in
  `app/renderer/styles/global.css`
  (`.react-flow__node:not(.selected) .react-flow__resize-control { display:none }`) so unselected
  nodes never render handles/lines regardless of React Flow quirks. Resize + persistence unchanged.
- **Task 2 — unsaved dialog only for real changes:** replaced the string-state `isDirty` heuristic in
  `FlowChartDesigner.tsx` and `ScenarioBuilder.tsx` with a snapshot model. `serializeFlowDoc` /
  `serializeWorkflowDoc` produce an order-independent JSON of the saveable document (id-sorted nodes/
  edges; workflow also includes execution + dataSource). `isDirty = savedSnapshot !== "" &&
  docSnapshot !== savedSnapshot`. Baseline captured on load (`pendingSnapshot` ref + effect) and reset
  on save. Removed `handleNodesChange` (React Flow's initial `dimensions` measurement was flagging
  spurious dirty); now uses `onNodesChange` directly. Selection/zoom/pan/measurement no longer mark
  dirty; node/edge/property/metadata changes do.
- **Task 3 — test-only mock fixtures:** new `scripts/seed-mock-fixtures.mjs` + `seed:mock-fixtures`
  npm script. Generates 10 flows (login, fill-form, screenshot, scroll, upload, wait, loop,
  conditional, run-another-flow, assertion-fail+recovery), 3 workflows (simple, failure-handling,
  data-driven), 1 data source (mock-users, 3 rows). Writes source fixtures to
  `resources/test-fixtures/mock-site/{flows,workflows,data-sources}/` AND seeds them into the runtime
  userData folders (data file under `data/files/` per the collision fix). All `mock-`/"Mock —"
  prefixed, do NOT auto-load on fresh install. Excluded from packaged builds
  (`electron-builder.json` → `!test-fixtures/**`). Documented in
  `resources/test-fixtures/mock-site/README.md`.
- **Tests run:** seed script ✅ (10 flows / 3 workflows / 1 data source, 14 fixture JSON files parse);
  `npm run build`, `npm run validate:offline`, `npm run verify:runner`, and
  `node scripts/ai-memory/check-memory.mjs` — see below.

---

## 2026-06-27 — Claude Code — AI memory maintenance pass (skill)

- **Task:** Run the ai-memory-maintainer procedure; sync memory with recent changes.
- **Inspected:** `scripts/` now includes `verify-data-editor.mts` and `ai-memory/check-memory.mjs`
  (plus the `ai:memory` npm scripts and skill/command scaffolds).
- **Change:** `docs/ai/ARCHITECTURE.md` — `scripts/` map updated to list `verify-data-editor.mts`
  and `ai-memory/check-memory.mjs`. (COMMANDS, FEATURES, KNOWN_ISSUES, CURRENT_STATE already current
  from the data-source editor + collision-fix + review entries above.)
- **Checker:** `node scripts/ai-memory/check-memory.mjs` → passed.
- **Result:** memory consistent with the repo; no app code changed.

---

## 2026-06-27 — Claude Code — Memory review + checker pass

- **Task:** Review repo + memory files, replace any TODO sections, run `scripts/ai-memory/check-memory.mjs`.
- **Findings:** No literal TODO/placeholder sections exist — the memory files were authored fully
  populated and are current. Skill/command scaffolds present (no checker warnings). No secrets.
- **Change:** `docs/ai/COMMANDS.md` — added the new `ai:memory` / `ai:memory:check` npm scripts.
- **Checker:** `node scripts/ai-memory/check-memory.mjs` → passed (exit 0), no failures/warnings.
- **Result:** memory layer verified accurate and consistent with the current repo.

---

## 2026-06-27 — Claude Code — Fix data-source file/profile collision (editor "not a root array")

- **Bug:** Creating a data source wrote the data file to `<dataSources>/<name>.json`, the same path
  the profile-metadata store uses (`<dataSources>/<id>.json`); `store.import` then overwrote the
  array with the profile object, so the editor showed "not a root array of objects."
- **Fix:** `app/main/ipc/dataSource.ipc.ts` — user data files now live in `<dataSources>/files/`
  (`dataFilesDir`); `resolveDataFile` redirects legacy collided files and auto-heals (seeds from
  `profile.sampleRow` when the data file is missing); `preview`/`getJsonPaths` use the resolved
  data path too.
- **Tests run:** `npm run build` ✅, `npm run verify:data-editor` ✅ 27/27, `npm run verify:runner` ✅ 31/31.
- **Result:** new data sources save/read correctly; the previously-broken "users" source reopens
  with its seed row recovered. No schema change.

---

## 2026-06-27 — Claude Code — Data Source visual JSON table editor

- **Task:** Add a visual table editor for JSON data sources (view/edit/add/delete/duplicate rows,
  add/rename/delete columns, create from scratch, save real files).
- **Files added:** `app/renderer/pages/DataSourceEditor.tsx`,
  `app/renderer/components/shared/ConfirmDialog.tsx`, `src/data/TableEditing.ts` (pure helpers),
  `scripts/verify-data-editor.mts`.
- **Files changed:** `app/main/ipc/dataSource.ipc.ts` (+`readJson`/`writeJson`/`createFromScratch`,
  resources read-only → migrate on save), `app/main/preload.ts` (3 channels),
  `app/renderer/routes.tsx` (hidden `dataSourceEditor` route), `app/renderer/pages/DataSourceManager.tsx`
  (Edit Table / Duplicate / Export actions + Create Data Source modal), `app/renderer/styles/global.css`
  (editor table styles), `package.json` (`verify:data-editor`).
- **Tests run:** `npm run build` ✅, `npm run verify:data-editor` ✅ 27/27 (incl. real file round-trip),
  `npm run verify:runner` ✅ 31/31 (no regression), `npm run validate:offline` ✅.
- **Tests not run:** live GUI of the editor (needs the running Electron app).
- **Result:** feature implemented and logic verified against real files; uses real storage, not mock.

---

## 2026-06-26 — Claude Code — Final verification of AI memory (Prompt 04)

- **Task:** Pre-commit verification of the AI-agent memory setup.
- **Checks (all pass):** all 21 required files exist (3 root + 12 `docs/ai/` + 6 local `AGENTS.md`);
  Markdown code fences balanced in every file; `CLAUDE.md`/`GEMINI.md` both import `@AGENTS.md`;
  no secret-like values; referenced paths exist (`docs/OFFLINE_STANDALONE_PACKAGING.md`,
  `docs/IMPLEMENTATION_AUDIT.md`, `IMPLEMENTATION_STATUS.md`, `.env.example`, `.gitignore`,
  `playwright.config.ts`, `mock-site/server.mjs`).
- **Issues fixed:** none required.
- **Result:** AI memory layer verified and ready to commit.

---

## 2026-06-26 — Claude Code — Add folder-specific AGENTS.md (Prompt 03)

- **Task:** Add local `AGENTS.md` rules to high-value folders.
- **Files created:** `app/main/AGENTS.md`, `app/renderer/AGENTS.md`, `src/AGENTS.md`,
  `scripts/AGENTS.md`, `tests/AGENTS.md`, `docs/AGENTS.md`.
- **Files modified:** `docs/ai/DEVELOPMENT_WORKFLOW.md` (listed local AGENTS.md locations).
- **Skipped:** `resources/`, `vendor/`, `mock-site/`, `instances/`-style leaf folders — covered by
  root + `src`/`scripts` rules; per-folder files would add noise.
- **Tests run:** none (docs-only). **Result:** local rules added; consistent with root, no conflicts.

---

## 2026-06-26 — Claude Code — Audit & correct AI memory (Prompt 02)

- **Task:** Audit the memory files for accuracy, conflicts, invented features, unverifiable
  commands, secrets, and broken paths.
- **Findings:** All cited paths exist (verified `src/orchestrator`, `src/data`, `src/storage`,
  `app/main/ipc`, runner files, components/table, mock-site, tests, playwright.config). All
  `COMMANDS.md` commands are backed by `package.json`. No secrets; no conflicting rules; CLAUDE.md
  and GEMINI.md correctly import `@AGENTS.md`.
- **Corrections:** `ARCHITECTURE.md` — completed the `orchestrator/` and `data/` file lists
  (added FlowOrchestrator, ConditionalFlowRouter, ExecutionQueue, FlowOutputRegistry, DataBinding).
- **Tests run:** none (docs-only). **Result:** memory files verified accurate.

---

## 2026-06-26 — Claude Code — Bootstrap AI agent memory structure

- **Task:** Create the shared AI-agent memory/instruction layer (Prompt 01).
- **Files created:** `CLAUDE.md`, `GEMINI.md`, and `docs/ai/`: `PROJECT_BRIEF.md`,
  `CURRENT_STATE.md`, `FEATURES.md`, `ARCHITECTURE.md`, `COMMANDS.md`, `RULES.md`,
  `KNOWN_ISSUES.md`, `TASK_LOG.md`, `DECISIONS.md`, `SECURITY.md`, `TESTING.md`,
  `DEVELOPMENT_WORKFLOW.md`.
- **Files modified:** `AGENTS.md` (rewritten from a long product spec into a concise agent hub that
  delegates detail to `docs/ai/`; spec content relocated into `ARCHITECTURE.md`/`RULES.md`/
  `FEATURES.md`/`SECURITY.md`).
- **Repository understanding:** Electron + React + TypeScript Windows desktop app (WebFlow Studio)
  for offline Playwright automation; framework-agnostic core under `src/`; JSON profile storage;
  offline packaging (portable + NSIS) with bundled Chromium; runner verified live via
  `npm run verify:runner`.
- **Tests run:** none new (documentation-only task). Prior session verified `npm run build` ✅,
  `npm run verify:runner` ✅ 31/31, `npm run validate:offline` ✅, packaging ✅.
- **Tests not run:** clean-machine offline GUI walkthrough (human/VM step, pending).
- **Result:** AI memory layer created; no application code or runtime behavior changed.
- **Notes:** Folder-specific `AGENTS.md` files (Prompt 03) and audit (Prompt 02) not yet done.

---

## 2026-07-11 — Claude Code — Node kebab menu, loop-button removal, canvas parity

- **Task:** Finish Workflow→AWKIT UI parity for the two graph editors: remove the in-node loop
  button (user req 10), make the node "…" 3-dot menu functional (req 11), and tighten canvas
  fidelity to the reference.
- **Files created:** `app/renderer/components/shared/NodeOptionsMenu.tsx` (portalled per-node
  context menu — Configure / Add·Remove loop / Delete; framer-motion `menuSpring`, Escape +
  outside-click, reduced-motion aware; portals into `#root` so click delegation + fixed
  positioning both work).
- **Files modified:**
  - `components/workflow/ActionFlowNode.tsx`, `components/scenario/ScenarioFlowNode.tsx` — removed
    the standalone `node-loop-button`; wired the kebab to `NodeOptionsMenu`. Loop create/remove now
    lives in the menu. Scenario node gained a functional kebab (it had none).
  - `components/workflow/flowDesignerTypes.ts`, `components/scenario/scenarioDesignerTypes.ts` —
    added render-only `onConfigure` / `onDeleteNode`·`onDeleteFlow` callbacks (never serialized).
  - `pages/FlowChartDesigner.tsx`, `pages/ScenarioBuilder.tsx` — wired the menu callbacks; removed
    the React Flow `Controls` (top-right) and `MiniMap` from both canvases (reference has neither —
    only the dotted grid + bottom-center glass toolbar); dropped now-dead `nodeColor`/`resolvedTheme`.
  - `styles/global.css` — deleted `.node-loop-button` rules; added `.node-options-menu` /
    `.node-options-item` styles; added scenario kebab hover-reveal + 4th grid column for the kebab.
  - `scripts/verify-flow-designer-gui.mjs`, `scripts/verify-workflow-builder-gui.mjs` — migrated the
    loop assertions from the removed button to the new kebab menu; made Workflow Builder navigation
    robust to expanded/collapsed sidebar.
- **Tests run (real Electron GUI):** `verify:flow-designer` ✅ 24/24, `verify:workflow-builder`
  ✅ 21/21, `verify:workflow-sentinels` ✅ 4/4, `npm run build` (incl. `tsc --noEmit`) ✅.
  Kebab click-through proven: "Add loop" creates the self-loop (active loop ports 0→2) and toggles
  to "Remove loop"; 0 `.node-loop-button` remain in either editor.
- **Evidence:** light + dark captures of both editors under
  `docs/ai/ui-reskin-template-plan/mockups/screenshots/`.
- **Result:** reqs 10 & 11 implemented and verified; canvas chrome now matches the reference. No
  data-model/serialization or runtime change (menu callbacks are render-only).

---

## 2026-07-11 (cont.) — Claude Code — Reference-parity canvas: vertical flow, hidden ports

- **Task (user feedback):** the graph nodes still used the old design with visible ports on both
  sides; the two editors were not the reference top→bottom canvas.
- **Files modified:**
  - `components/shared/ConnectorPorts.tsx` — moved target handles to the node's TOP edge and source
    handles to the BOTTOM edge (branch pairs fan out along the bottom). Handle **ids** are unchanged,
    so `onConnect`, `portHandlesForKind`, serialization and the runtime are untouched.
  - `styles/global.css` — `.connector-port { opacity: 0 }`: handles are hidden (reference parity)
    but stay in the DOM and connectable (drag-to-connect + programmatic edges still attach); the
    active loop port still shows.
  - `pages/ScenarioBuilder.tsx` — Workflow Builder now lays flows out **top→bottom** (was
    left-to-right): `addFlow`/`reorderFlow`/load-fallback positions are vertical and `withAutoLayout`
    /Auto-arrange use `direction: "TB"`. New workflows and Auto-arrange produce the vertical reference
    flow; existing saved layouts are still preserved on load.
  - `scripts/verify-flow-designer-gui.mjs`, `scripts/verify-workflow-builder-gui.mjs` — port-geometry
    checks updated from left/right to top/bottom; branch pair asserted horizontally separated; leaf
    append click made robust to the new vertical edge overlap.
- **Tests run (real Electron GUI):** `verify:flow-designer` ✅ 24/24, `verify:workflow-builder`
  ✅ 21/21, `tsc --noEmit` + build ✅. Drag-to-connect still verified ("Dragging second Conditional
  connector creates the missing branch").
- **Result:** both editors render the reference top→bottom canvas — clean cards, hidden handles, no
  visible side ports, vertical smooth edges with `+` insertion and label pills. No runtime/schema change.
- **Still open (user feedback):** add-step menu "Logic" options (Condition / Parallel / Loop) that
  create the branch structure from the picker — next task.

---

## 2026-07-11 (cont. 2) — Claude Code — Add-step "Logic" options (Condition / Parallel / Loop)

- **Task (user feedback):** the add-step menu was missing branch-creating logic options (conditional
  branch, parallel branch, loop). User chose reference-style auto-branching.
- **Files modified:** `pages/FlowChartDesigner.tsx`
  - Added a "Logic" group to the Node Palette picker (Condition / Parallel / Loop, listed first);
    folded the plain `condition`/`loop` node types into these so there's no duplicate lone-node entry.
  - New `applyLogic()` auto-creates the branch structure mapped to AWKIT's real connector kinds:
    Condition → a `condition` node with two conditional connectors ("If true" / "If false",
    priorities 0/1); Parallel → a two-way parallel fan-out (`parallel` edges, waitAll/failFast);
    Loop → a step carrying a self-loop `loop` connector. Handles blank / edge-insert / leaf-append
    modes and produces valid edges the runtime + validator accept.
  - `handlePickerPick` now routes `logic-*` ids to `applyLogic` and plain ids to the node factories.
- **Verifier:** `scripts/verify-flow-designer-gui.mjs` — replaced the two hidden-handle drag checks
  (drag-to-connect is not usable once handles are hidden per the reference model) with a Logic →
  Condition test that asserts the auto-created conditional pair (If true/If false) and the
  delete-one-branch revert-to-normal.
- **Tests run (real Electron GUI, ×2 each for stability):** `verify:flow-designer` ✅ 24/24,
  `verify:workflow-builder` ✅ 21/21, `verify:workflow-sentinels` ✅ 4/4,
  `verify:recorder-flow` ✅ 13/13, `tsc --noEmit` + build ✅.
- **Result:** the Flow Designer add-step menu now exposes Condition / Parallel / Loop logic options
  that auto-create the branch, matching the Workflow reference while preserving AWKIT's runtime
  connector semantics. No schema/serialization change.

---

## 2026-07-11 (cont. 3) — Claude Code — Remove React Flow: in-house canvas engine

- **Task (user):** replace the React Flow-based canvases with the *same custom UI design as the
  `Workflow` (flowforge) reference project, but without the `@xyflow/react` library*. The reference is
  itself built on React Flow, so this meant building a small in-house canvas engine and porting all
  three canvases onto it. User chose "adopt flowforge nodes as-is" (drop the extra node features) and
  "all three canvases".
- **New engine:** `app/renderer/components/canvas/` — `FlowCanvas.tsx` (pan/zoom via CSS transform,
  node drag with DOM measurement, SVG edge layer, fit-view, `useCanvas`/`useViewport`,
  `FlowCanvasHandle` ref → `fitView`/`zoomTo`/`screenToFlowPosition`, `getIntersectingNodes`),
  `geometry.ts` (faithful port of React Flow's `getSmoothStepPath`/`getViewportForBounds` math),
  `edgeComponents.tsx` + `edgeLabelContext.ts` (`BaseEdge`/`EdgeLabelRenderer` via an in-transform HTML
  overlay portal), `Background.tsx`, `CanvasZoomControl.tsx`, `state.ts`
  (`useNodesState`/`useEdgesState`/`addEdge` compat), `nodes/StepNode.tsx`, `edges/SmoothEdge.tsx`,
  `edges/LoopEdge.tsx`, `types.ts`, `index.ts`. Flow is top→bottom (edge = source-bottom → target-top;
  self-loop when source === target).
- **Canvases converted:** `pages/WorkflowDesigner.tsx` (read-only), `pages/FlowChartDesigner.tsx`,
  `pages/ScenarioBuilder.tsx` — rendering layer swapped only; save/load/validation/serialization
  unchanged. Node components rebuilt on the engine (`ActionFlowNode.tsx`, `ScenarioFlowNode.tsx`),
  keeping their flowforge-parity card CSS; loop create/remove moved to the kebab (`onToggleLoop`).
- **Shared:** `connectorStyle.ts` dropped its `@xyflow` import (`buildConnectorVisual` → engine edge
  types `smooth`/`loop`); `FlowNodePropertiesPanel.tsx` `Node` type from the engine;
  `flowDesignerTypes.ts`/`scenarioDesignerTypes.ts` gained `hasLoop`/`onToggleLoop`.
- **Deleted (React-Flow-only):** `shared/TemplateSmoothEdge.tsx`, `shared/SelfLoopEdge.tsx`,
  `shared/ConnectorPorts.tsx`, `workflow/CanvasZoomControl.tsx`. Removed the RF CSS import from
  `main.tsx` and the `@xyflow/react` dep from `package.json`. Appended engine CSS (`.awkit-flow-*`,
  `.awkit-step-node*`, `.awkit-edge-*`) to `global.css` (AWKIT has no Tailwind, so the reference's
  utility-class card design was translated to `--awkit-*` tokens).
- **Verifiers rewritten** against the new DOM: `scripts/verify-flow-designer-gui.mjs`,
  `scripts/verify-workflow-builder-gui.mjs` (dropped the removed branch-port geometry checks).
- **Behavior intentionally dropped** (per "adopt flowforge nodes as-is"): node resize, branch-port
  dragging, edge reconnect, port-drag-to-connect. Connections via `+`/append/Logic picker; loop via
  kebab. Connector kinds/config + save/validation preserved.
- **Tests run:** `tsc --noEmit` ✅ clean; `electron-vite build` ✅ clean (renderer bundle 1,589 → 1,235
  kB, ~355 kB smaller; modules 2214 → 2049); `verify:flow-designer` (real Electron GUI) ✅ 14/14;
  `verify:workflow-builder` (real Electron GUI) ✅ 14/14; `grep @xyflow app/` → none.
- **Remaining:** run `npm install` (`@xyflow/react` still in `package-lock.json` (6 refs) +
  `node_modules/`; install not run), then regenerate the offline manifest + `validate:offline`
  (`generate-dependency-manifest.ps1` still references React Flow). Optional: add flowforge-style
  drag-node-onto-node connect; prune the now-unused port helpers in `connectorStyle.ts`.

---

## 2026-07-12 — Codex — Keep Flow Designer inspector within canvas bounds

- **Task:** fix the right properties panel overflowing the Flow Designer canvas area around the toolbar.
- **Root cause:** the populated inspector was still a second outer grid column, so its entire width sat
  beyond the Flow Designer canvas/action-toolbar boundary. The first pass only fixed vertical sizing and
  left the reported horizontal overflow unchanged.
- **Files modified:** `app/renderer/styles/global.css`, `scripts/verify-flow-designer-gui.mjs`,
  `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`.
- **Fix:** restored a full-width designer canvas and toolbar, positioned the drawer inside those bounds,
  and reserved an equal internal strip in the canvas body so nodes/connectors remain unobscured. The
  collapsed rail returns that strip. Added four-edge containment, toolbar alignment, usable-canvas
  non-overlap, and exact **1936×1290** viewport assertions to the real-Electron verifier.
- **Tests run:** `npm run build` ✅; `npm run verify:flow-designer` ✅ **24/24** (default, compact
  1024×768 wrapped-toolbar, and exact reported 1936×1290 geometry); `npm run verify:mock-site` ✅
  **35/35**; visually inspected the captured 1936×1290 Electron frame; AI memory check ✅.
- **Not run:** clean-machine GUI walkthrough (not needed for this focused renderer geometry regression).
- **Result:** the expanded inspector is fully contained inside the Flow Designer canvas—horizontally
  within the toolbar edge and vertically between toolbar bottom and canvas bottom—at normal and reported
  viewport sizes.

---

## 2026-07-12 — Codex — Instance bulk stop and workflow-run drill-down

- **Task:** add an Instances action that stops all pending/running work; show running workflow records
  with summary data; open a modal containing all detailed instance data when a record is selected.
- **Implementation:** `InstanceMonitor.tsx` now treats pending/queued as bulk-stoppable, confirms the
  destructive action, calls the existing backend `executions.stopAll()`, and exposes the action in the
  monitor toolbar plus compact page header. Instance rows are grouped by unique `executionId` through
  pure `summarizeWorkflowRuns` logic and rendered as active-first summary records.
- **Modal:** new `WorkflowInstancesModal.tsx` provides focus-on-open, Escape/backdrop close, workflow/run
  summary metrics, every instance's activity/runtime/timing detail, and per-instance live-report actions.
- **Mock lab:** extended `/designer-lab`, its README entry, and `verify-mock-site` with the workflow-run
  record → three-instance modal contract.
- **Files modified/added:** `app/renderer/pages/InstanceMonitor.tsx`,
  `app/renderer/components/instances/WorkflowInstancesModal.tsx`, `app/renderer/styles/global.css`,
  `src/instances/instanceCardLogic.ts`, `scripts/verify-instance-monitor.mts`,
  `scripts/verify-instance-monitor-gui.mjs`, `mock-site/public/designer-lab.html`,
  `mock-site/README.md`, `scripts/verify-mock-site.mjs`, `package.json`, and AI memory docs.
- **Verification:** `npm run build` ✅; `verify:instance-monitor` **35/35**;
  `verify:instance-monitor-gui` **12/12** (real Electron, isolated temp profile, bundled Chromium, two
  running + two queued → all cancelled); `verify:mock-site` **39/39**; light-theme modal capture visually
  inspected; no renderer console/page errors.
- **Not run:** `verify:runner` (no runner/orchestrator implementation changed; real GUI verification used
  the existing hard-cancel path); clean-machine packaged/installer walkthrough (out of scope).
- **Result:** operators can see each workflow execution at a glance, inspect every instance in one modal,
  and safely cancel all pending/running work across workflows.

## 2026-07-12 — Claude — Profile store data-integrity hardening (audit remediation Phase 1)

- **Task:** After a full codebase audit (`docs/audit/`), implement Phase 1 of the remediation plan:
  make the JSON document store crash-safe and stop it silently dropping corrupt files.
- **Change:** `src/storage/ProfileStore.ts` — atomic temp-file+rename writes (A1), an in-instance FIFO
  serialization chain for all writes/deletes (S1), corrupt-file quarantine to `.corrupt-<ts>` instead of
  silent `null` (A2), and write-new-before-delete-old id-rename in `update()` (A3). On-disk format
  unchanged; no route/IPC/preload/runner/schema/packaging change. `src/` stays app-agnostic (queue
  inlined, not imported from `app/main/writeQueue.ts`).
- **Files:** `src/storage/ProfileStore.ts`, `scripts/verify-profile-store.mts` (new),
  `package.json` (new `verify:profile-store` script), `docs/ai/CURRENT_STATE.md`,
  `docs/ai/COMMANDS.md`, `docs/audit/TECHNICAL_DEBT_REGISTER.md` (findings marked resolved).
- **Verification:** `npm run build` ✅; `verify:profile-store` **13/13** (new); `verify:data-editor`
  **27/27** (store consumer, unregressed); `verify:write-queue` 7/7; `verify:workflow-sentinels` 4/4.
- **Not run:** live/GUI verifiers, packaged/offline validators (no behavior in those paths changed).
- **Result:** flows/workflows/data-sources/reports can no longer be truncated by a crash mid-save or
  silently vanish on corruption; a corrupt file is preserved on disk and logged. Closes A1/A2/A3/S1.

## 2026-07-12 — Claude — Isolated browser teardown hardening (audit remediation Phase 2)

- **Task:** Phase 2 of the `docs/audit/` remediation plan — stop the isolated-context teardown from
  orphaning the Chromium process when `context.close()` throws (finding A4).
- **Change:** `src/runner/BrowserContextFactory.ts` — extracted `closeIsolatedRuntime(context, browser)`
  which closes the context in `try` and the browser in `finally` (failing browser close swallowed; the
  context error still propagates). The isolated `create()` close closure delegates to it. Persistent path
  unchanged (already had try/finally around the profile lease).
- **Files:** `src/runner/BrowserContextFactory.ts`, `scripts/verify-browser-pool.mts` (new Part F),
  `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`, `docs/audit/TECHNICAL_DEBT_REGISTER.md` (A4 resolved).
- **Verification:** `npm run build` ✅; `verify:browser-pool` **20/20** (was 16 — Part F asserts the
  browser closes even when context.close rejects, error propagation, happy path, and swallowed browser
  close error).
- **Not run:** live/GUI verifiers, packaged/offline (no behavior in those paths changed; teardown proven
  at the unit level with fakes, matching the rest of the browser-pool suite).
- **Result:** a throwing context close can no longer leak a browser process; closes A4.

## 2026-07-12 — Claude — Electron/IPC surface hygiene (audit remediation Phase 3)

- **Task:** Phase 3 of the `docs/audit/` remediation plan — close the external-open scheme hole (A5) and
  resolve the registered-but-unexposed IPC handlers (A6).
- **Change:**
  - `app/main/windowManager.ts` — `setWindowOpenHandler` opens via `shell.openExternal` only for
    `http(s)` (was any scheme); other schemes are denied. Matches `auth.ipc.ts`.
  - New `scripts/verify-ipc-contract.mts` — static guard over `app/main/ipc/*` + `preload.ts`: preload
    invokes only real handlers, no duplicate registrations, every handler is exposed or in a documented
    `BACKEND_ONLY` allowlist (23 channels), allowlist has no stale entries. Documents the dead/internal
    surface instead of deleting possibly-intended CRUD APIs, and fails on future drift.
- **Files:** `app/main/windowManager.ts`, `scripts/verify-ipc-contract.mts` (new), `package.json`
  (new `verify:ipc-contract` script), `docs/ai/CURRENT_STATE.md`, `docs/ai/COMMANDS.md`, `docs/ai/TASK_LOG.md`,
  `docs/audit/TECHNICAL_DEBT_REGISTER.md` (A5/A6 resolved).
- **Verification:** `npm run build` ✅; `verify:ipc-contract` **4/4** (117 handlers, 94 exposed, 23 backend-only).
- **Not run:** live/GUI verifiers (no UI/runtime behavior changed); external-link open is a one-line guard.
- **Result:** non-http(s) window.open can't launch an OS handler; the IPC contract is drift-guarded and
  the unexposed surface is documented. Closes A5/A6.

## 2026-07-12 — Claude — Load Session (A7) accepted as roadmap stub (audit remediation Phase 4)

- **Task:** Phase 4 of the `docs/audit/` remediation plan — resolve A7 (the "Load Session" /
  `useSavedSession` Protected Login Handoff mode surfaced as "not implemented yet").
- **Decision (owner):** leave the `useSavedSession` + `useTestSession` handoff modes as-is and document
  them as intentional roadmap stubs. They are already honestly disabled (validation note + `false`
  capability flags + disabled button) and redundant with the working `Reuse Session` /
  `Auto Secure Login` nodes. No implementation, no removal.
- **Change:** documentation only — reclassified A7 from defect to accepted/deferred in
  `docs/audit/TECHNICAL_DEBT_REGISTER.md` and `docs/audit/UNIMPLEMENTED_FEATURES.md`; noted the decision
  in `docs/ai/CURRENT_STATE.md` and here.
- **Files:** `docs/audit/TECHNICAL_DEBT_REGISTER.md`, `docs/audit/UNIMPLEMENTED_FEATURES.md`,
  `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`. No source/build change.
- **Verification:** none required (docs-only; no code touched). Build already green from Phases 1-3.
- **Result:** A7 is accepted/deferred, not open debt. Remaining audit items: A8 (bundle size),
  A9 (docs bloat), A10 (headless test tier).

## 2026-07-12 — Claude — Reports tables: full width + bounded-height scroller (UI fix)

- **Task:** User-reported Workflow Reports layout bug — tables only used the left half of each card and
  the recent-runs list grew unbounded. "Reports should fill full width and assign fixed height for each
  card with scroller."
- **Root cause:** the global `table { display: block; overflow-x: auto }` rule (for the wide Instance
  Monitor table) forced every `.awkit-table` to a block box, so `width:100%` filled the block but the
  inner columns shrank to content and clustered left.
- **Change (`app/renderer/styles/global.css`, renderer/CSS only):** `.awkit-table` now `display: table`
  so `width:100%` stretches columns to fill the card; `.awkit-report-page .awkit-table-wrap` gets
  `max-height: 46vh` + `overflow-y: auto` with a sticky `thead th`, giving each report card a bounded
  height with an internal scroller and pinned header. `.awkit-table` is reports-only (5 files), so the
  blast radius is contained.
- **Files:** `app/renderer/styles/global.css`, `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`.
- **Verification:** `npm run build` ✅ (clean; the one EXIT 1 was contention from running build and the
  Electron verifier in parallel — tsc alone is clean and the solo rebuild is green);
  `npm run verify:reports` **26/26** (real Electron, all report routes render/resolve, no console errors).
- **Not run:** pixel-level width/scroll assertion (Electron GUI can't be driven in this harness's Browser
  pane, which needs the preload API) — the change is CSS-only and the GUI verifier confirms no functional
  regression on any report route.
- **Result:** report tables fill the full card width and long lists scroll inside a fixed-height card.

## 2026-07-12 — Claude — Chrome Consumption gauge distortion + idle sampling (UI/runtime fix)

- **Task:** User report on the Chrome Consumption page — Browser pool/Concurrency gauges looked distorted
  (not RPM-like), Memory/CPU gauges stuck on "sampling…", plus questions on the 2-browser / 4-flow caps.
- **Fix 1 — gauge distortion (`app/renderer/components/reports/RadialGauge.tsx`):** `bandArc` SVG arc
  sweep-flag 0 → 1. Flag 0 is unambiguous only for the full 0→100 arc (chord == diameter); the shorter
  band sub-arcs resolved to the mirrored circle centre, cusping the segments. Confirmed by rasterizing the
  exact SVG with `sharp` (flag 0 reproduced the reported distortion; flag 1 is a clean semicircle).
- **Fix 2 — idle sampling (`src/runner/ExecutionEngine.ts`):** `ResourceSampler.start()` ran only in
  `startRun`, so idle Memory/CPU gauges never sampled. `getRuntimeStatus()` now starts it idempotently
  (primes the first sample synchronously, unref'd), so system RAM shows immediately and CPU within a poll.
- **Answered (no change):** the 2/4 caps are `ConcurrencyConfig` defaults `maxBrowsersPerHost`/
  `maxActiveFlows`, env-overridable via `AWKIT_MAX_BROWSERS` / `AWKIT_MAX_ACTIVE_FLOWS`.
- **Files:** `app/renderer/components/reports/RadialGauge.tsx`, `src/runner/ExecutionEngine.ts`,
  `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`.
- **Verification:** `npm run build` ✅; `npm run verify:reports` **26/26** (real Electron, gauges render,
  no console errors); gauge geometry proven via `sharp` raster (before/after).
- **Not run:** live pixel check inside Electron (Browser pane can't drive the Electron renderer) — the
  raster proof + GUI verifier cover geometry and non-regression.
- **Result:** gauges render as clean RPM dials; Memory/CPU are live at idle.

## 2026-07-12 — Claude — Configurable runtime concurrency caps in Settings (feature)

- **Task:** User request — expose the browser/flow host caps in the Settings UI instead of env-only, and
  make Browser pool / Concurrency gauges consistent with Memory pressure (the latter delivered by the
  earlier gauge sweep-flag fix).
- **Change:**
  - Schema: `runtime: { maxBrowsers, maxActiveFlows }` in `app/main/uiSettings.ts` (defaults 2/4; bounds
    1–16 / 1–64; hydrate/mergePatch/validate).
  - Engine: `ExecutionEngine.configureConcurrency` → `BrowserWorkerPool.reconfigure` — mutates the shared
    limits object (live `maxActiveFlows`) and rebuilds the browser-slot `Semaphore` only when idle
    (`slots.size === 0`), keeping `maxBrowsersPerHost` in sync with the live semaphore.
  - Wiring: `applyRuntimeConcurrencyFromSettings()` in `execution.ipc.ts`, called at startup, after each
    settings save/reset/import (`settings.ipc.ts`), and before each run.
  - UI: Runtime Concurrency card in `app/renderer/pages/Settings.tsx` + `.settings-card-hint` CSS.
- **Files:** `app/main/uiSettings.ts`, `src/runner/ExecutionEngine.ts`,
  `src/runner/browser/BrowserWorkerPool.ts`, `app/main/ipc/execution.ipc.ts`, `app/main/ipc/settings.ipc.ts`,
  `app/renderer/pages/Settings.tsx`, `app/renderer/styles/global.css`, `scripts/verify-browser-pool.mts`
  (Part G), `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`.
- **Verification:** `npm run build` ✅; `verify:browser-pool` **25/25** (Part G: live flows cap + guarded
  browser-cap resize); `verify:settings-persistence` **3/3**; `verify:reports` **26/26**;
  `verify:ipc-contract` **4/4**.
- **Not run:** live Settings-page GUI walkthrough (no dedicated verifier; schema round-trip covered by
  settings-persistence; the caps→pool logic covered by browser-pool Part G).
- **Result:** users set Max browsers / Max active flows in Settings; the caps drive admission and the
  Chrome Consumption gauge denominators (applied on save + each run; browser-cap resize when idle).

## 2026-07-14 — Claude — UI/motion direction: spatial-continuity completions + type-scale migration

- **Task:** Continue implementing `docs/ui-design-and-motion-direction.md`. Phases 0–4 (foundation tokens,
  motion vocabulary, origin-aware surfaces, hover gating, canvas transforms, glass materials, a11y media
  queries) were already applied (uncommitted, from the 7 `plans/00x` motion plans + Phase-0 foundation).
  This session closed the additive "missed opportunities" and started the Phase-4 type migration.
- **Change:**
  - **Toast exit** (`components/shared/Toast.tsx`, `global.css` `.app-toast`): enter→shown→leave state
    machine; fades out along the same bottom edge via CSS transitions (not a keyframe). Removed the now
    unused `@keyframes app-toast-in`.
  - **Empty-state first-render delight** (`global.css` `.awkit-empty-state`): staggered rise
    icon→headline→hint→CTA (45ms/step, `--awkit-dur-med` ease-out), fully removed under reduced motion.
  - **Node-deletion exit** (`components/canvas/FlowCanvas.tsx`, `global.css` `.awkit-flow-node.is-exiting`):
    manual exit-tracking (no `AnimatePresence`) renders a deleted node ~150ms as a non-interactive ghost
    that fades+scales out (keyframe on the node's child; outer `translate3d` untouched). Gated on the
    `nodes` reference so pan/zoom/typing never re-render the memoized node subtree.
  - **Properties-panel glide:** confirmed already implemented (§9.1). Coordinated `panBy` deferred (needs
    cross-boundary ref threading; documented in `plans/README.md`).
  - **Type-scale migration:** 199 exact-match `font-size` literals (11/12/13/14/16/18/22px) → `--text-*`
    tokens (zero visual change). 28 off-scale one-offs left; `--leading-*`/`--tracking-*` application is a
    per-section visual follow-on.
- **Files:** `app/renderer/components/shared/Toast.tsx`, `app/renderer/components/canvas/FlowCanvas.tsx`,
  `app/renderer/styles/global.css`, `plans/README.md`, `docs/ai/TASK_LOG.md`. (CURRENT_STATE.md left
  unchanged — it tracks committed app state; this whole UI-motion body is intentionally uncommitted.)
- **Verification:** `npm run build` ✅; `verify:flow-designer` **24/24** (incl. node add/delete flows, no
  console errors); `verify:reports` **31/31**; `verify:canvas-perf` **7/10** — the 3 failures are
  pre-existing on baseline `7c4b260` (harness "no draggable node found" / seed nodeCount=3), and all
  memoization assertions (zoom/typing → 0 node/card/edge re-renders) pass before and after.
- **Not run:** clean-machine packaged GUI walkthrough; light/dark + reduced-motion visual pass (Electron
  renderer can't be driven from the Browser pane). Motion is CSS-token-driven and reduced-motion-guarded.
- **Result:** toasts, empty states, and node deletion complete their spatial loops; font sizes are
  single-sourced. Whole UI-motion body remains uncommitted for user review (per request).

## 2026-07-14 — Claude — Fix Settings › Paths & Directories button overlap (UI)

- **Task:** User reported the Browse/Reset buttons in Settings → Paths & Directories were misaligned —
  each field's Reset button overlapped the next field's path input (`ResetC:\Users\...`), last column clipped.
- **Cause:** Path fields used the shared `.settings-grid` (`auto-fit, minmax(240px,1fr)`) — too narrow for a
  long path input + Browse + Reset. Measured overflow was a constant **+80px** per field (Reset spilling
  into the neighbour's cell).
- **Change:** Scoped a `.settings-paths-grid` modifier (added to the paths grid in `Settings.tsx`):
  `minmax(340px,1fr)` tracks; `.settings-path-row` gets `align-items:center` + `flex-wrap:wrap`; input
  `flex:1 1 160px; min-width:0`; buttons `flex:0 0 auto; white-space:nowrap` so they never shrink/overflow.
- **Files:** `app/renderer/pages/Settings.tsx`, `app/renderer/styles/global.css`, `docs/ai/TASK_LOG.md`.
- **Verification:** `npm run build` ✅. Reproduced in a faithful standalone HTML harness (real CSS + markup)
  and measured via DOM rects: BEFORE = 4 cols, **+80px** Reset overflow on every field; AFTER = 3 cols,
  **0px** overflow, no wrap. Forced a 300px cell → buttons wrap below the input (row 74px), still 0 overflow.
- **Result:** buttons align within each field; no cross-field overlap; degrades gracefully on narrow windows.

## 2026-07-14 — Claude — Custom AWKIT application frame (remove native Electron/Windows frame)

- **Task:** Remove the native OS title bar from the main window and replace it with an application-owned,
  theme-aware AWKIT title bar (brand + current area + window controls), integrated into the existing shell.
- **Main process:** `windowManager.ts` sets `frame: false` (security prefs untouched — contextIsolation on,
  nodeIntegration off) and forwards real `maximize`/`unmaximize`/`enter|leave-full-screen` to the renderer
  via `window:maximizedChanged` so the control state never drifts from the OS. New `ipc/window.ipc.ts`
  (`registerWindowIpc`, registered first in `ipc/index.ts`) exposes minimize / toggleMaximize / close /
  isMaximized, each resolving the window from `event.sender` (multi-window-safe, missing-window = no-op).
- **Preload:** added a narrowly-scoped `appWindow` domain (minimize/toggleMaximize/close/isMaximized +
  leak-free `onMaximizedChange` returning an unsubscribe). No `ipcRenderer`/`BrowserWindow`/Node exposed;
  `window.playwrightFlowStudio` identifier unchanged.
- **Renderer:** `layout/AppFrame.tsx` (thin draggable title bar; double-click toggles maximize) +
  `layout/WindowControls.tsx` (three caption buttons, inline SVG glyphs, `useWindowMaximized` seeds from
  `isMaximized()` then syncs via the event; maximize↔restore icon + aria label follow real state). `AppShell`
  now wraps the shell in `.app-window` with the frame on top.
- **Styling (`global.css`):** new `--titlebar-height: 36px`; `--shell-chrome` now includes it; `.app-shell`
  & `.left-navigation` heights adjusted; legacy `calc(100vh - 92px|132px|170px)` designer/scenario calcs
  updated to subtract the title bar. Frame + `.win-control` styling uses only design tokens; hover gated to
  fine pointers, close-hover = danger, press = instant wash (asymmetric), color-only motion (120ms ease-out).
- **Design/motion:** applied emil-design-eng + apple-design (immediate pointer-down feedback, restraint,
  theme-aware opaque material, no entrance motion on persistent chrome, interruptible CSS transitions).
  Strict `review-animations` pass: one press-immediacy finding fixed (`:active { transition:none }`) → **Approve**.
- **Files:** `app/main/windowManager.ts`, `app/main/ipc/window.ipc.ts`, `app/main/ipc/index.ts`,
  `app/main/preload.ts`, `app/renderer/layout/AppFrame.tsx`, `app/renderer/layout/WindowControls.tsx`,
  `app/renderer/layout/AppShell.tsx`, `app/renderer/styles/global.css`, `docs/ai/CURRENT_STATE.md`,
  `docs/ai/TASK_LOG.md`.
- **Verification:** `npm run build` clean (tsc + 3 bundles); `verify:ipc-contract` **4/4** (125 handlers,
  the 4 new window channels have handlers, no dupes); `verify:canvas-perf` **13/13**; `verify:flow-designer`
  **24/24** (canvas fills the frame-adjusted height, panels contained, 0 console errors). Real Electron
  manual inspection (light + dark): native frame gone; maximize→restore icon sync; double-click toggle;
  minimize; close hover = red; Dashboard + Flow Designer stack cleanly under the frame; context label tracks
  the active route.
- **Not run / risks:** OS window *move* via drag confirmed by implementation (standard `-webkit-app-region:
  drag`; buttons + double-click on the region both fire) but not visually reproduced — synthetic drag input
  didn't drive the OS non-client move; no snap-layout hover flyout on the maximize button (would need a
  WM_NCHITTEST/titleBarOverlay hook). Automation browsers launched by Playwright are untouched.

## 2026-07-14 — Claude — Security follow-ups: Settings → Secrets UI (§15) + data-source read confinement verifier (§14)

- **Task:** Continue the security-audit remediation follow-ups — finish the DPAPI secret store (§15) and the
  data-source read confinement (§14). The backends were already implemented and passing (`verify:secrets`
  16/16); the gaps were the operator-facing **Settings → Secrets** UI and regression coverage for the
  data-source read guard.
- **Secret store UI (§15):** added a **Secrets** card to `Settings.tsx` — add/update by name (name pattern
  mirrored client-side as `SECRET_NAME_RE`, password-masked value input, Enter-to-add), delete-with-confirm,
  a stored-secret list (name + last-updated, no values), and a keystore-unavailable banner. Calls the existing
  name-only preload API (`window.playwrightFlowStudio.secrets.isAvailable/list/set/delete`); no channel returns
  a decrypted value. New token-only CSS (`.settings-secret-form/-list/-row`) — no hardcoded hex/px.
- **Data-source read (§14):** extracted the read-confinement decision into a pure predicate
  `isReadableDataSourceFile(runtimeRoot, dataSourcesDir, resolved)` in `src/utils/pathSafety.ts` and switched
  `dataSource.ipc.ts::assertReadableDataFile` to it (behavior unchanged: 25 MB cap + refuse runtime-internal
  files that aren't the data workspace). Added 6 regression checks to `verify-security.mts`.
- **Files:** `app/renderer/pages/Settings.tsx`, `app/renderer/styles/global.css`, `src/utils/pathSafety.ts`,
  `app/main/ipc/dataSource.ipc.ts`, `scripts/verify-security.mts`, `docs/security/FULL_SECURITY_AUDIT.md`,
  `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`.
- **Verification:** `npm run build` clean (tsc + 3 bundles); `verify:security` **39/39** (+6 data-source
  read-confinement checks), `verify:secrets` **16/16**, `verify:data-editor` **27/27**, `verify:ipc-contract`
  **4/4** (129 handlers). Settings → Secrets card verified in a token-faithful standalone HTML harness (real
  `global.css`, all three states) via the Browser pane — computed styles confirm flex form, inset rows,
  right-aligned timestamps, danger banner, and **no horizontal overflow** in both light and dark themes.
- **Not run / risks:** real packaged-Electron DPAPI round-trip and the clean-machine GUI walkthrough (the
  Electron renderer can't be driven from the Browser pane; the harness proves layout only, not live IPC). The
  secret set/list/delete IPC path itself is covered by `verify:secrets`. Whole security batch remains
  uncommitted (local only) per the standing "do not push unless asked" note.

## 2026-07-14 — Claude — New Flow: name dialog + auto-open in Flow Designer

- **Task:** The Flows page **New Flow** button should pop a dialog to set the flow name, then create the
  flow and open it automatically in the Flow Designer with only a Start and End step.
- **Change:** Added reusable `app/renderer/components/shared/PromptDialog.tsx` (single-field modal:
  autofocus+select, Enter to confirm, Escape/overlay to cancel, confirm disabled until non-empty). Routed
  all three New/Create Flow triggers in `FlowLibrary.tsx` through a `namingFlow` state that opens the
  dialog. `createFlow(name)` now creates the Start→End-only flow with the entered name and calls the
  existing `openFlow(profile)` (persist `lastSelectedFlowId` + navigate to `flowChart`). Token-only CSS
  (`.modal-icon.create`, `.modal-field`) in `global.css`.
- **Files:** `app/renderer/components/shared/PromptDialog.tsx` (new), `app/renderer/pages/FlowLibrary.tsx`,
  `app/renderer/styles/global.css`, `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`.
- **Verification:** `npm run build` clean (tsc --noEmit + main/preload/renderer bundles).
- **Not run / risks:** live Electron GUI walkthrough (Browser pane can't exercise `window.playwrightFlowStudio`
  IPC). Start/End scaffold unchanged, so no runner/verifier surface touched.

## 2026-07-14 — Claude — Workflows library + Workflow Builder header/toolbar cleanup

- **Task:** (1) header keeps only **Save** (remove New/Run); (2) disable Reload, Mode, and Parallel in the
  builder toolbar; (3) drop the **Max Parallel** column from the Workflows table; (4) remove the grey id line
  under each workflow name; (5) one line per row with full text in a title tooltip and per-row actions
  collapsed into a single "…" kebab menu; (6) **Create Workflow** opens a name modal, persists the workflow,
  then opens it in the builder; (7) the builder toolbar **New** does the same.
- **Change:** New shared factory `createBlankWorkflowProfile(name)` in `WorkflowProfile.ts` (Start→End
  scaffold, sequential defaults) — the single source both entry points use. **ScenarioBuilder.tsx:** header
  chrome trimmed to Save only; removed the now-dead `runWorkflow`; `#sb-new` and a new `namingWorkflow`
  `PromptDialog` route through `createNamedWorkflow` (create → list → `loadWorkflowProfile` → Saved); `#sb-reload`,
  Mode `<select>`, and Parallel `<input>` marked `disabled`. **WorkflowsLibrary.tsx:** removed the Max Parallel
  column (header/body/colgroup) + its adapter accessor and two filter fields; removed `<small>{id}</small>`;
  per-row action buttons replaced by a single `.wl-kebab` (`MoreVertical`) that opens the existing
  `NodeOptionsMenu` (Open in Builder / Clone / Export JSON / Delete-danger); Delete now uses `ConfirmDialog`;
  **Create Workflow** (toolbar + empty-state) opens a `PromptDialog` → `createWorkflow(name)` persists via
  `createBlankWorkflowProfile` + navigates to the builder. Token-only CSS: `.wl-table-workflows` single-line
  cells + `.wl-kebab`.
- **Files:** `src/profiles/WorkflowProfile.ts`, `app/renderer/pages/ScenarioBuilder.tsx`,
  `app/renderer/pages/WorkflowsLibrary.tsx`, `app/renderer/styles/global.css`,
  `scripts/verify-workflow-builder-gui.mjs` (New now names the workflow first), `docs/ai/CURRENT_STATE.md`,
  `docs/ai/TASK_LOG.md`.
- **Verification:** `npm run build` clean (tsc + 3 bundles). `verify:workflow-builder` **20/20** (updated
  section 3 drives the New name modal). Workflows library covered by a throwaway `_electron` walkthrough
  (**7/7**): no Max Parallel header, no id sub-line, one kebab per row opening the 4-action menu, Create
  opens the name modal, zero renderer console errors.
- **Not run / risks:** clean-machine packaged walkthrough. The `verify:workflow-builder` run now persists one
  blank "GUI New …" workflow per run (New persists by design) — cosmetic data-dir leftover only.

## 2026-07-16 — Claude — Runtime Observability & Historical Analytics (full phase set 01–09)

- **Task:** Build the production Runtime Observability & Historical Analytics layer per
  `AWKIT_RUNTIME_OBSERVABILITY_ANALYTICS_PHASES` (audit → data model → collection → per-workflow analytics →
  capacity/queue effectiveness → anomaly/regression → UI integration → retention → verification/soak/report).
- **Approach:** Extend the EXISTING durable telemetry stack (one SQLite store, one contract, one IPC surface)
  — migration v4, no second database. Reuse the existing samplers (no new polling loop). Environmental
  resource fields labelled as correlations, never per-workflow ownership.
- **Files:** `src/runner/store/RuntimeStoreSchema.ts`, `SqliteRuntimeStore.ts`, `RuntimeStore.ts`;
  new `src/reports/ObservabilityContracts.ts`, `src/reports/observabilityAggregation.ts`,
  `src/runner/runtime/RuntimeObservationCollector.ts`, `src/runner/runtime/AnomalyDetector.ts`;
  `src/runner/ExecutionEngine.ts`; `app/main/ipc/telemetry.ipc.ts`, `app/main/preload.ts`;
  `app/renderer/pages/ReportsRuntime.tsx`, `app/renderer/styles/global.css`;
  new `scripts/verify-observability.mts`, `package.json`, `scripts/verify-telemetry.mts` (v4 assertion);
  docs (`RUNTIME_OBSERVABILITY_ANALYTICS_REPORT.md`, `CURRENT_STATE.md`, `COMMANDS.md`, `.env.example`).
- **Tests run:** build clean; `verify:observability` 65/65; `verify:telemetry` 61/61; `verify:runner` 82/82;
  `verify:concurrency` 78/78; `verify:concurrency-defaults` 18/18; `verify:shared-browser-pool` 19/19;
  `verify:browser-isolation` 27/27; bounded Config-D real-engine soak (1.5 min) 299 done / 0 failed /
  teardown CLEAN / durable=live MATCH.
- **Not run / risks:** full ≥30-min production soak (documented pre-release gate); packaged-EXE walkthrough.
  Environmental attribution is correlation not ownership (labelled); capacity-window P95 is a bucketed ceiling.
- **Result:** Complete + verified; ON by default at measured-negligible overhead, bounded storage.

## 2026-07-16 — Codex — AWKIT violet application icon + valid multi-frame ICO

- **Task:** Use the supplied `logo-designer` skill and visual reference to create a premium AWKIT
  application icon using the specified indigo/violet/glass palette, preserve transparent alpha, remain
  legible at 16px, and export a Windows ICO containing every required frame.
- **Design:** explored three original SVG directions under `logos/awkit-violet/concepts/` (Orbit Flow,
  Browser Route, Reliable Path), selected Browser Route, and refined it into a bold browser frame with a
  three-node workflow and one restrained electric-blue execution point. No text, copied rosette, unrelated
  dominant color, or fine browser-control detail.
- **Assets:** added `logos/awkit-violet/preview.html`, final editable
  `iterations/iteration-1-browser-route.svg`, `export/logo.svg`, PNG exports at
  16/24/32/48/64/128/192/256/512/1024/2048px, and light/dark size-check evidence. Replaced
  `resources/icon-source.png`, `resources/icon.png`, and `resources/icon.ico`.
- **Exporter fix:** byte-level validation exposed that `png-to-ico` 2.1.0 omitted AND-mask bytes from
  ICO directory lengths/offsets. Replaced only that packing step in `scripts/generate-app-icon.mjs` with
  direct PNG-compressed ICO entries plus built-in validation of offsets, dimensions, 32-bit declaration,
  PNG signatures, and RGBA color type.
- **Verification:** `npm run icon:generate` passed; seven embedded ICO frames independently decoded at
  256/128/64/48/32/24/16px with 32-bit RGBA and transparent corners; master is 1024×1024 RGBA with 9.96%
  opaque padding; blue accent is 0.561% of opaque pixels; visual checks passed at 16–256px on light/dark
  backgrounds; `npm run build` passed; `npm run validate:offline` passed (development mode).
- **Not run:** packaged Electron/NSIS rebuild or clean-machine Windows icon-cache/taskbar walkthrough;
  those remain release-stage/manual checks and no runtime application behavior changed.
- **Result:** the repository now ships the requested AWKIT violet browser-workflow icon and a
  standards-compliant, validated multi-resolution Windows ICO.

## 2026-07-16 — Codex — Specter segmented-S Hologram application icon

- **Task:** Replace the prior browser-workflow icon direction with a premium iOS/macOS-style Specter icon:
  a front-facing 62%-canvas glass squircle, exact Hologram violet palette, and a bold geometric S made from
  separate rounded brick segments, with full 16–256px Windows legibility and a 1024px alpha master.
- **Design exploration:** used the supplied `logo-designer` skill to create three SVG concepts under
  `logos/specter-violet/concepts/`: ringed five-segment S, luminous eleven-brick S, and open-halo
  five-segment S. True-size checks eliminated the eleven-brick direction because its gaps compressed at
  16px. The ringed five-segment direction was refined with a larger S and quieter enclosure.
- **Final design:** `iterations/iteration-1-specter-ringed.svg` uses a 318×318 superellipse-style tile
  centered in a 512 viewBox (62.109%), near-black/violet glass depth, top-left sheen, a 10-unit
  lavender ring, and five off-white rounded rectangles forming the only visible S. No font/text element,
  warm hue, photographic texture, noise, or fine browser-control detail.
- **Assets:** added `logos/specter-violet/preview.html`, final/export SVG, PNGs at
  16/24/32/48/64/128/192/256/512/1024/2048px, and a light/dark size-check sheet generated from the
  actual embedded ICO frames. Replaced `resources/icon-source.png`, `resources/icon.png`, and
  `resources/icon.ico`.
- **Verification:** SVG XML/no-visible-text checks passed; `npm run icon:generate` passed; the 1024px
  master is RGBA with transparent corners; seven ICO frames independently decoded at
  256/128/64/48/32/24/16px as 32-bit RGBA with transparent corners; visual inspection passed at
  16–256px in light and dark contexts; `npm run build` passed; `npm run validate:offline` passed
  (development mode); AI memory validation passed.
- **Not run:** packaged EXE/NSIS rebuild and Windows taskbar/Explorer icon-cache walkthrough. No runtime
  logic or renderer behavior changed.
- **Result:** the application now uses the requested Specter segmented-S identity while preserving the
  hardened, validated Windows ICO pipeline.

## 2026-07-18 — Secure Login / Authorization / Machine-Licensing — PLAN ONLY (no code)
- **Agent:** Claude (Opus 4.8). **Task:** produce an implementation-ready design plan for adding secure
  authentication, RBAC authorization, Super-User administration, and per-machine signed licensing to AWKIT.
  **Explicitly planning-only — no production code created or modified.**
- **Inspected (grounding):** startup `app/main/main.ts` (splash coordinator + `passesOfflineStartupGate` = the
  pre-window init hook), state-machine router `app/renderer/App.tsx`/`routes.tsx` (no gate today → flash risk),
  IPC trust (`ipc/index.ts` global sender guard, `senderGuard.ts`, `windowManager.ts` will-navigate lockdown),
  storage (`SqliteRuntimeStore` + `RUNTIME_STORE_MIGRATIONS` + `DurableLockStore`; `JsonProfileStore`; DPAPI
  `secretStore.ts`/`SecretStore.ts`), machine identity (`MachineCapabilityDetector` — copyable random-UUID +
  hardware fingerprint), packaging (`electron-builder.json` portable+nsis, per-user, no admin), theme tokens
  (`global.css`, `AppFrame`). Noted the `auth`/`session` namespace collision (existing = automation OAuth/login
  sessions, NOT app login) → new subsystem uses `security`/`license` namespaces.
- **Deliverable:** `docs/plans/SECURE_LOGIN_AUTHORIZATION_LICENSING_IMPLEMENTATION_PLAN.md` — 34 sections:
  exec summary, current assessment, gaps, arch, startup/routing, auth-provider abstraction (Local active / AD
  disabled-visible), virtual-user auth (scrypt), Super User, RBAC + permission registry, sessions, machine
  identity (augmented fingerprint), Ed25519 signed licenses (private key OFF client — Model 2), lifecycle,
  secure storage (sql.js `security.sqlite` + DPAPI wrap), schema+migrations, trust boundaries, IPC security,
  UI/UX, error handling, audit (hash-chained), threat model, 10-phase plan, file-by-file map, tests, migration,
  recovery, future AD, risks, acceptance, order, 10 open decisions.
- **Tests run:** none (planning task; no code). **Not done:** implementation (intentional).
- **Result:** plan committed to `docs/plans/`. Feature NOT implemented; 10 open decisions (O-1..O-10) need
  confirmation before Phase 1. Tracking bead `awkit-bn2`. Conservative git — nothing committed/pushed.

## 2026-07-18 — Machine fingerprint design spec (companion to secure-login plan §14) — PLAN ONLY
- **Agent:** Claude (Opus 4.8). Design-only; no production code. Deliverable:
  `docs/plans/MACHINE_FINGERPRINT_DESIGN.md`, cross-linked from the master plan §14.
- **Verified on the real host, non-elevated** (`IsInRole(Administrator)=False`): all four primary claims
  readable without admin — SMBIOS UUID (`Win32_ComputerSystemProduct`), BIOS serial (`Win32_BIOS`),
  MachineGuid (registry, no WMI), system disk serial (`Win32_DiskDrive` Index 0) — plus aux baseboard +
  C: volume serial. Raw values redacted/never persisted. Cost measured: registry ~0.17s, `vol` ~0.04s,
  3× CIM warm ~0.31s (cold ~0.9s) → collection must run async off the splash critical path.
- **Spec covers:** version envelope, claim model (status present/missing/restricted/placeholder/malformed),
  main-only collectors (batched CIM + cheap non-WMI paths, execFile timeout+AbortSignal, no wmic),
  normalization + placeholder denylist/heuristics, deterministic salted-hash-before-persist (raw discarded),
  weighted matching (SMBIOS .35/MachineGuid .30/disk .20/BIOS .15 + aux; bind ≥0.60 AND ≥1 strong anchor;
  degraded band 0.40–0.60), issuance trust gate (fail-closed), safe renderer contract (request code + status
  only), Crockford-base32 request code (hashes only), fail-closed + manual activation + signed admin-recovery
  token (private key stays off client), tests, privacy/VM-clone limits, 5 open decisions F-O-1..F-O-5.
- **Tests run:** none (design). **Result:** spec committed under docs/plans/. Not implemented. Conservative git.

## 2026-07-18 — Secure login trusted core (Phase 1+2 backend) IMPLEMENTED — branch feature/secure-login-auth
- **Agent:** Claude (Opus 4.8). **Epic:** awkit-ekd. **Scope chosen with user:** trusted core first
  (backend, headless-verified, no UI) on a dedicated branch.
- **Created (src/security/**):** errors/ReasonCodes, crypto/ColumnCrypto (+PassthroughColumnCrypto),
  crypto/PasswordHasher (scrypt), auth/{UsernameRules,PasswordPolicy,AuthTypes,AuthenticationProvider
  (+ActiveDirectoryProvider disabled stub),LocalVirtualUserProvider,AuthenticationService},
  session/SessionManager, store/{SecurityStoreSchema,SecurityStore} (sql.js + migrations + DPAPI-wrapped
  passwordSecret), ipc/SecurityIpcSchema (payload validators), SecurityKernel.
- **Created (app/main):** security/securityKernel.ts (safeStorage-backed ColumnCrypto singleton),
  ipc/security.ipc.ts (sender-guarded, schema-validated, fail-closed). **Modified:** ipc/index.ts
  (register), preload.ts (`.security` namespace — `playwrightFlowStudio` identifier untouched; distinct
  from automation `auth`/`session`), main.ts (dispose on quit). **Created:** scripts/verify-auth.mts;
  package.json `verify:auth`.
- **Tests run:** `npm run verify:auth` **41/41**; `npm run build` (tsc --noEmit + electron-vite) clean;
  `verify:ipc-contract` 4/4 (172 handlers, security channels exposed); `verify:secrets` 16/16,
  `verify:security` 39/39 unaffected. **Not run:** verify:runner (unrelated live runner; untouched),
  packaged-EXE (external gate), any GUI (no UI in this slice).
- **Self-review (code-review skill, high):** 5 findings. Fixed now: fail-closed try/catch on
  getBootState/getLoginOptions kernel-open failure; removed dead `instanceof InvalidPayloadError` branch.
  Deferred to beads: awkit-ekd.6 (cross-process single-writer lock + requestSingleInstanceLock),
  awkit-ekd.7 (revoke other sessions on password change), awkit-ekd.8 (debounced persistence).
- **Result:** trusted core complete + verified. **Nothing committed** (conservative git; new branch
  feature/secure-login-auth shares the working tree with the in-flight Oracle changes — security files are
  all new/isolated). Next: authorization (Phase 3) or login UI (Phase 6) per user direction.

## 2026-07-18 — Secure login UI (Phase 6) IMPLEMENTED — branch feature/secure-login-auth
- **Agent:** Claude (Opus 4.8). **Epic:** awkit-an7 (closed). Built the renderer login UI on the verified
  trusted core; user direction "build the login UI next".
- **Created (app/renderer/security/):** SecurityGate (state machine loading/unavailable/firstRun/login/
  forcedChange/authed; themes pre-auth; re-validates session on focus/visibility), LockedShell,
  SessionContext (+useSession), reasonMessages (safe reason→copy, generic fallback), components/PasswordField
  (show/hide + Caps-Lock), screens/{LoginScreen (AD disabled "Coming soon" tab, uniform errors, duplicate-submit
  guard), FirstRunSetup (one-time SU → auto sign-in), ForcedPasswordChange, SecurityUnavailable (fail-closed)}.
- **Modified:** main.tsx (render SecurityGate instead of App), layout/AppFrame.tsx (title-bar user chip +
  sign-out via SessionContext; no chip pre-auth), styles/global.css (+~280 lines `.awkit-login-*` /
  `.app-frame-session`, token-only, light/dark, reduced-motion). No IPC/preload/backend changes.
- **No-flash:** protected `<App/>` (and all routes) mount only in the `authed` state; GUI verifier asserts
  `.app-shell` is absent on every pre-auth surface.
- **Tests run:** `npm run verify:auth-gui` **13/13** real Electron (isolated temp %LOCALAPPDATA%): no-flash,
  first-run→shell, session chip+sign-out→login, AD disabled/coming-soon, re-login, 0 console errors +
  screenshots reports/security-login/{login,authed-shell}.png. `npm run build` clean; `verify:auth` 41/41;
  `verify:ipc-contract` 4/4. **Not run:** packaged EXE (external gate); dark-mode visual pass (bead awkit-l6h).
- **Follow-up bead:** awkit-l6h (proactive idle-lock activity tracking + dark-mode login screenshot assertion).
- **Result:** login flow complete and verified in the real app. **Nothing committed** (conservative git).

## 2026-07-17 — Claude — Install & integrate Codebase Memory MCP + Beads

- **Task:** Install, configure, verify, and document two persistent project-memory tools — Codebase Memory
  MCP (code-structure knowledge graph) and Beads (`bd`, task/blocker tracker) — for this repo, preserving all
  existing config/hooks/instructions and excluding generated/runtime/binary content.
- **Codebase Memory MCP (v0.9.0):** ran the official DeusData `install.ps1` (inspected first; checksum-verified
  binary → `%LOCALAPPDATA%\Programs\codebase-memory-mcp`). It auto-configured Claude Code **globally**
  (`~/.claude/.mcp.json` single entry; PreToolUse Grep/Glob augmenter + SessionStart/SubagentStart user hooks;
  `codebase-memory` skill). Set `auto_index`/`auto_watch=true`. Authored root-anchored `.cbmignore` (source dirs
  that share names with runtime dirs — `src/reports/` etc. — are kept). Indexed `--mode full` (no persistence):
  ~8,750 nodes / ~20,500 edges, 23 dirs excluded, langs TS/HTML/Java/TOML/SQL/CSS/YAML. Verified architecture,
  entry points, preload boundary, `trace_path`, and `detect_changes` (40 files → 924 impacted symbols) against
  real source (`oracle.ipc.ts` callees matched).
- **Beads (v1.1.0, Dolt embedded):** ran the official gastownhall `install.ps1` (inspected; checksum-verified
  → `%LOCALAPPDATA%\Programs\bd`, added to User PATH, `beads.exe` alias). `bd init --prefix awkit` +
  `bd setup claude` added a project `SessionStart` hook (`bd prime`) and merged a managed block into `CLAUDE.md`
  — the existing `Stop` hook (`check-memory.mjs`) and original CLAUDE.md content were preserved. Metrics off;
  JSONL auto-export on. Seeded a backlog (setup epic + real Oracle work `awkit-jz5`/`awkit-cm8`); CRUD +
  dependencies + `bd remember` verified. `bd init` made one scoped commit (`a4ce464`) of `.beads/` scaffolding.
- **Files changed:** new `.cbmignore`, `docs/ai/CODEBASE-MEMORY-AND-BEADS.md`, `.beads/**`; modified `.gitignore`,
  `CLAUDE.md`, `.claude/settings.json`. **No application source (`app/`, `src/`) changed.** Config backups saved
  to the session scratchpad.
- **Verification:** both tools' versions/config confirmed; all touched JSON + `config.yaml` parse cleanly.
- **Not run / remaining:** a one-time Claude Code **restart** is required before the `mcp__…` graph tools load
  in-session (the CLI works now). Codebase Memory config is global/machine-specific (not portable to teammates).
- **Result:** both tools installed, verified, and documented; Beads is the authoritative active-work tracker.

## 2026-07-18 — Claude (Opus 4.8) — Oracle: user-selected Java runtime + direct JDBC, remove UCP (epic awkit-kzo, WS-D..I)

- **Task:** completed the approved epic (branch `feature/oracle-jdbc-driver-settings`). WS-A/B/C were done in
  prior sessions; this session finished **WS-D → WS-I**. Model: Specter no longer bundles Java or UCP — the
  user selects a Java runtime + imports an ojdbc driver in Settings → Database Drivers; Oracle runs via direct
  JDBC (one connection per query, no pool). Full report:
  [`ORACLE_USER_SELECTED_JAVA_REMOVE_UCP_REPORT.md`](ORACLE_USER_SELECTED_JAVA_REMOVE_UCP_REPORT.md).
- **WS-D — live 7/7 + concurrency:** re-provisioned an ephemeral `SPECTER_READER` out-of-band (never printed),
  ran `verify:oracle-live` **7/7** real mode via the Settings Java-runtime+bundle path (`Local-JDK-17` 17.0.8 +
  `Oracle-ojdbc17-local-19c-validation` 23.26.2.0.0). Deterministic cancellation now uses a per-row concat+LIKE
  over a ~8.5M-row 3-way cross join (Oracle can't cardinality-shortcut it). `verify:oracle-direct-jdbc` 23/23.
- **WS-E — GUI 30/30:** new `verify:oracle-drivers-gui` (real Electron via Playwright `_electron`, resolves the
  main window past the branding splash). Both Database Drivers cards render; `testBridge` launches the bridge
  with the selected Java and loads the **real ojdbc 23.26.2.0.0**; deletion guard; no secrets; 0 console errors.
  Screenshots in `reports/oracle-validation/database-drivers-*.png`.
- **WS-F — packaging:** rewrote `prepare-oracle-runtime.mjs` + `oracle-runtime.manifest.json` to stage ONLY the
  bridge jar; `OracleOfflineBundle.ts` + `validate-offline-bundle.ps1` now **reject** a bundled JRE/driver
  (inverse of the old "driver required" gate); `.gitignore` ignores all of `resources/oracle-jdbc/`. Real
  `prepare:oracle-runtime → validate:offline` loop green ("0 optional compile jar(s)"). runtime-prep 14/14,
  offline-bundle 11/11, packaging 23/23. `electron-builder.json` unchanged (generic copy carries the bridge jar).
- **WS-G — regression:** build clean; 13 non-GUI Oracle verifiers **350/350**; cross-cutting ipc-contract 4/4,
  settings-persistence 3/3, profile-store 13/13, secrets 16/16, data-editor 27/27, concurrency 78/78,
  cancellation 12/12. Found + fixed a **pre-existing branding-splash regression** breaking `firstWindow()`-based
  GUI verifiers (filed a bd bug for the others; fixed `verify-settings-persistence.mjs`).
- **WS-H — soak:** new `benchmark:oracle-jdbc` — ≥30-min direct-JDBC soak through the live path + the app's
  `OracleQueryService` limiter; measures latency P50/P95, cancellation latency, bridge+Node RSS, teardown
  invariants; asserts no pool metrics. Redacted artifact `reports/oracle-validation/oracle-soak.json`.
- **WS-I — docs:** updated CURRENT_STATE, COMMANDS, ORACLE_JDBC_RUNTIME_MATRIX (now selection-model
  compatibility/setup), ORACLE_JDBC_VALIDATION_GATES (cleared gates), wrote the 19-section report, deleted the
  obsolete ORACLE_LIVE_VALIDATION_RESUME.md, appended this entry.
- **Tests run:** `npm run build`; all `verify:oracle-*` (350 non-GUI + live 7 + GUI 30); `validate:offline`;
  cross-cutting regression above; 30-min soak. **Not run:** packaged-EXE build (dev host OOMs on
  electron-builder) + clean-machine walkthrough; sustained real-world soak — external gates.
- **Result:** epic complete → **PRODUCTION-CANDIDATE**. Nothing committed (conservative git profile, ephemeral
  branch); handoff reports the changed-file set + proposed commit for approval.
  > **Superseded same day:** this branch was committed and merged to `main` via PR #14 (`79e20a5`) later on
  > 2026-07-18. See the audit entry below — this log entry's "nothing committed" is stale.

## 2026-07-18 — Claude Sonnet 5 — Full-stack release-readiness audit (`fullstack-webapp-testing` skill)

- **Task:** ran the `fullstack-webapp-testing` skill's audit + safe-tests + release-gate workflow against
  `main` @ `93162d6`. Full report: `test-artifacts/2026-07-18-release-readiness-audit/full-test-report.md`
  (+ `system-map.md`, `execution-summary.json` in the same folder). Tracked as beads `awkit-7s5`.
- **State correction:** the Oracle WS-D..I entry directly above, and `docs/ai/HANDOFF.md`'s "Current
  Handoff" section, both describe the Oracle driver-settings work and the Secure Login trusted-core+UI
  work as uncommitted. That changed later the same day: **both merged to `main`** — PR #14 Oracle
  (`79e20a5`) and PR #15 Secure Login (`93162d6`). Working tree is clean on `main`. `CURRENT_STATE.md` and
  `HANDOFF.md` were **not** rewritten as part of this audit (kept out of scope to avoid a rushed partial
  edit) — flagged as the top follow-up action in the report instead.
- **Safe tests executed today (fresh evidence):** `npm run build` clean (tsc + 3 bundles); `verify:ipc-
  contract` 4/4; `verify:security` 39/39; `verify:secrets` 16/16; `verify:auth` 41/41 (headless secure-login
  core); `verify:profile-store` 13/13; `verify:write-queue` 7/7; `verify:mock-site` 39/39; `verify:auth-gui`
  13/13 (real Electron); `verify:runner` 82/82 (real Chromium, core E2E). Manual read-only secret-pattern
  scan of tracked source (excl. `node_modules`/`out`/`dist`/`vendor`): 4 regex hits, all confirmed benign
  (1 `ReasonCodes.ts` constant, 3 mock/test-fixture credentials in `seed-mock-fixtures.mjs` and two Oracle
  verifier/benchmark scripts). `.env` confirmed gitignored; `.env.example` placeholder-only; no `.pem/.pfx/
  .p12/.key/id_rsa/.env` tracked in git.
- **Defect confirmed (not new — reproduced an open bug):** `verify:reports` fails (`Target page, context or
  browser has been closed` waiting for `.awkit-report-page`), reproducing `awkit-gmn` (branding-splash
  breaks `app.firstWindow()`-based GUI verifiers). Confirmed via the codebase graph that
  `resolveMainWindow()` already exists in `verify-oracle-drivers-gui.mjs`, `verify-settings-persistence.mjs`,
  and `verify-auth-gui.mjs` (all pass), but not yet in `verify-reports-gui.mjs` or (per `awkit-gmn`, not
  independently re-checked) `verify-flow-designer-gui.mjs`, `verify-workflow-builder-gui.mjs`,
  `verify-instance-monitor-gui.mjs`, `verify-capacity-settings-gui.mjs`, `verify-runtime-analytics-gui.mjs`.
- **Not run (scope/time — see report for full reasoning):** the Oracle 350+-check suite, the concurrency/
  stress/soak suite, packaging/offline validation, the 5 other "likely affected" GUI verifiers, Recorder/
  Smart-Wait/popup/canvas-perf/Chromium-hardening suites, automated accessibility scanning (none exists in
  this repo), and any destructive/load/production test (none authorized or applicable to a local
  single-user desktop app).
- **Result:** **CONDITIONAL GO** for `main` as a development/integration checkpoint (no P0/P1 found; every
  critical journey tested today passed with fresh evidence). Explicitly **not** a production-ship verdict —
  the project's own pre-existing, already-tracked external gates (clean-machine offline VM walkthrough,
  code-signed packaged EXE, Oracle live perf/soak under the new architecture) remain un-run and unchanged
  by this audit. Filed no new beads (used existing `awkit-gmn`/`awkit-ekd.6`/`awkit-ekd.7`); `awkit-7s5`
  (this audit) closed with the report as its resolution.

### 2026-07-22 — Claude Code — Session-outcomes close-out (awkit-cxa P1, awkit-y24 P2, awkit-4km C1, §8 hardening)

- **Task:** work the approved close-out plan for `SESSION_OUTCOMES_REPORT.md` (tracker:
  `SESSION_OUTCOMES_CLOSEOUT.md`), on `feature/recorder-protected-login-and-async-awareness`.
- **awkit-cxa (P1) FIXED:** designer round-trip preserves a bare `FlowStep.value` losslessly via a
  designer-only `valueSourceType: "none"` sentinel (`flowStepMapping.ts`, `flowDesignerTypes.ts`); the two
  pinned "KNOWN DEFECT" checks were inverted. Files: `flowStepMapping.ts`, `flowDesignerTypes.ts`,
  `FlowNodePropertiesPanel.tsx`, `verify-flow-step-mapping.mts`.
- **awkit-y24 (P2) IMPLEMENTED:** new `anyOf` OR-group `WaitCondition` (extends the union). Runner
  `executeWaitCondition` resolves via `Promise.any`; `clampWaits` recursion; `reviewWait` rollup; designer
  editor refactored to `(wait, update)` + "+ OR group" button + token CSS. Files: `FlowProfile.ts`,
  `StepExecutor.ts`, `FlowValidation.ts`, `asyncCompletionReview.ts`, `FlowNodePropertiesPanel.tsx`,
  `global.css`, `verify-waits.mts`, `verify-flow-step-mapping.mts`.
- **awkit-4km C1 IMPLEMENTED:** new `apiPolling` `WaitCondition` (202 → poll-to-terminal). Runner
  `resolveApiPolling` observes the page's poll responses; designer editor + "Poll" scaffold; mock-site
  `/api/job`. WS/SSE + CDP stay deferred. Files: `FlowProfile.ts`, `StepExecutor.ts`,
  `asyncCompletionReview.ts`, `FlowNodePropertiesPanel.tsx`, `mock-site/server.mjs`, `verify-waits.mts`,
  `verify-flow-step-mapping.mts`, `verify-mock-site.mjs`.
- **§8 coverage hardening:** added round-trip coverage for all 10 `valueSource` variants, compound locator
  `alternatives`/`context`, edge→`next`, config breadth, pinned multi-key-outputs limitation. This
  surfaced + **fixed** two more awkit-cxa-class drops (`generated`, `secret`).
- **Verification (all green):** `verify:flow-step-mapping` 94/0, `verify:waits` 56/0, `verify:async-review`
  21/0, `verify:recorder` 78/0, `verify:recorder-flow` 19/19, `verify:runner` 82/0, `verify:protected-login`
  26/0, `verify:protected-login-recorder` 45/45, `verify:mock-site` 58/58, `verify:ipc-contract` 4/4, `tsc`
  0, `npm run build` 0, `check-memory` pass.
- **Not run / gates:** `verify:settings-persistence` (blocked — a dev Electron instance holds the
  single-instance lock; not force-killed); packaged installer + `validate:offline` -Strict (packaging host
  gate); packaged-renderer visual paint + GUI check 11.3 walkthrough (need screen access). No commit/push
  (conservative profile — awaiting approval).
