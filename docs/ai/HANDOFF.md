# Agent Handoff

Last updated: **2026-07-23 (latest — three-branch feature recovery: accent / HTTPS / custom brand logo → 3 PRs)**

> **Read this block first.** The previous agent decomposed the mixed commit `a1adcc2` ("branding, accent
> theme, and HTTPS certificate trust", on `chore/brand-logo-5b`) into **three independent feature
> branches off `main` @ `32e378e`**, each verified, pushed, and opened as its own PR. Nothing is paused
> mid-edit; every recovery worktree is clean. The original mixed branch is untouched.

## Next Agent — current PR landscape & next steps

Six PRs are in flight. `main` remains at `32e378e` until they merge. No backend implementation may start
before the clean-machine gate clears (see the "THE BLOCKING GATE" section below).

- **PR #27** (`fix/backend-observability-tranche-0`) — **frozen at `85df851`**. Do not amend, add commits,
  or push to it.
- **PR #28** (`feature/custom-accent-gradient`) — **ready for review**: custom accent gradient.
- **PR #29** (`feature/https-certificate-trust`) — **draft**, pending a focused HTTPS security review.
- **PR #30** (`feature/custom-brand-logo`) — **ready for review**: custom brand logo.
- **PR #31** (`docs/feature-recovery-state-sync`) — the recovery-state documentation (this branch).
- **Release gates NOT EXECUTED / NOT PASSED:** portable rebuild, artifact verification, clean-machine
  validation, and release promotion all remain outstanding.
- **`.beads/issues.jsonl` is frozen** — must not be committed or synchronized. **Do not run
  `bd dolt push`.**

**Recommended review order:** #28, #29, #30, then #31 (after confirming its references remain accurate).

**After PR #31 merges:** verify its content is present on `main`, then remove the docs-sync worktree,
prune worktrees, and delete the merged `docs/feature-recovery-state-sync` branch.

---

## Three-branch recovery — branch / PR map (all off `main` @ `32e378e`, pushed)

| Branch | Tip | PR | State | Verification |
|---|---|---|---|---|
| `feature/custom-accent-gradient` | `cf5b50f` | #28 | **ready for review** | build ✓ · `verify:accent-theme` 71/71 · `verify:accent-gui` 33/33 |
| `feature/https-certificate-trust` | `ba2e887` | #29 | **draft (security review)** | build ✓ · `verify:https-certificates` 49/49 · `verify:https-certificates-gui` 31/31 · regression `verify:runner` 82 + `verify:recorder` 78 |
| `feature/custom-brand-logo` | `11b2afa` | #30 | **ready for review** | build ✓ · `verify:custom-brand-logo` 31/31 · `verify:branding` 47/47 · `verify:branding-gui` 30/30 |

Each branch = one feature commit + one focused docs commit. They are **independent, not stacked**; each
was confirmed cleanly based on `origin/main` (`32e378e`) before its PR. The three worktrees live under
`%LOCALAPPDATA%\Temp\awkit-worktrees\{accent,https,branding}` (each `node_modules` is a junction to the
main repo's — deps unchanged).

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
- **PR #29 (HTTPS) is in draft for a focused security review** — the PR body lists six invariants to
  confirm (context-scoped only · default `false` / import can't enable · recorder persistent-context
  resume uses the resolved setting · no `--ignore-certificate-errors` launch arg · shared contexts don't
  leak cert policy · logs expose no sensitive cert/session data). Mark ready when satisfied.
- **PRs #28 and #30 are ready for review** — review + merge per normal flow.
- **`docs/ai/` reconciliation** (FEATURES / DECISIONS / COMMANDS entries for the three features) was left
  for merge time; each branch carries only its own self-contained feature doc (`docs/ACCENT_COLOR.md`,
  `docs/HTTPS_CERTIFICATE_TRUST.md`, `docs/BRANDING_CUSTOM_LOGO.md`) to avoid cross-PR conflicts.

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

> **Current status (2026-07-19, later session): clean `main` @ `0a4500f`, nothing paused or blocked.** The
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
