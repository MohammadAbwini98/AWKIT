# E2E Execution Report — 2026-07-19 (main @ `0a4500f`)

Adapted full end-to-end QA assessment of **AWKIT / SpecterStudio** (bd `awkit-xyo`). The original
web-app template (E2E_BASE_URL, Playwright planner/generator/healer agents, agent-browser Dogfood,
Firefox/WebKit matrix) does not apply to this offline Electron desktop app; with the owner's
approval ("Adapt to Electron") the assessment ran through the repo's own conventions instead:
real-Electron Playwright `_electron` verifiers on isolated fresh profiles, specs as markdown plans,
and the `fullstack-webapp-testing` methodology for coverage/classification.

## Environment tested

- **Target:** the real Electron app built from source (`npm run build` → `out/`), launched via
  Playwright `_electron` against isolated, empty `%LOCALAPPDATA%` temp profiles. Never the
  developer's profile; no production target exists (offline/local-only product).
- **Host:** Windows 10 dev machine, Node 18.16 (documented `@playwright/test` config caveat → all
  executable tests are standalone `node` verifiers per `tests/AGENTS.md`).
- **Commit:** `main` @ `0a4500f` (PR #21 admin/licensing package). No `src/` or `app/` production
  code changed during this assessment; test scripts + docs only.
- **Browsers/viewports:** Electron's bundled Chromium only (Firefox/WebKit N/A). Window resize
  1280×800 → 1024×700 → 900×620 stands in for responsive projects.

## What was discovered vs covered

- **Discovered:** 31 routes (30 nav-reachable incl. footer + 2 in-page-only), 4 roles
  (SuperUser/Administrator/Operator/Viewer), 188 IPC handlers (165 renderer-exposed), the
  licensing run-gate, and the first-run/forced-change/idle-lock auth lifecycle. Full inventory:
  `docs/testing/E2E_COVERAGE_MATRIX.md` + `test-artifacts/2026-07-19-e2e-qa/system-map.md`.
- **Covered new this assessment (4 suites, 107 checks, all green):**

| Suite | Spec | Checks | Highlights |
|---|---|---|---|
| `verify:e2e-auth` | `specs/e2e/E2E-AUTH.md` | **30/30** | first-run validation, weak/duplicate/double-click create, no user enumeration, forced change (mismatch/policy/success), old-password rejection, disable/enable, reset→forced-change, idle lock, 0 console errors |
| `verify:e2e-rbac` | `specs/e2e/E2E-RBAC.md` | **42/42** | per-role nav sets, route-mount guard via restored `lastRouteId` ("direct URL"), direct preload-IPC denials all `NOT_AUTHORIZED` (admin + licensing, incl. Administrator), SU control pass, 2 documented gaps (awkit-b92) |
| `verify:e2e-licensing` | `specs/e2e/E2E-LIC.md` | **22/22** | unlicensed page render, activation request privacy (no hostname/username/MAC), garbage + forged-signature imports rejected, enforcement default-OFF admits runs, `SPECTER_LICENSE_ENFORCE=true` → `licenseBlocked` with actionable message, dry-run ungated |
| `verify:e2e-sweep` | `specs/e2e/E2E-SWEEP.md` | **13/13** | 30 routes render console-clean (30 screenshots), tracked seeded-samples defect, dark/light toggle, 3-step resize no overflow, `:focus-visible` ring on real Tab, keyboard submit |

- **Healed (test defects only, per policy):** `verify:auth-gui` (stale PR-#21 selectors) → **18/18**;
  `verify:admin-gui` (asserted the deleted licensing placeholder) → **11/11**. No assertion was
  weakened; both now assert the real current UI.
- **Regression rerun (unchanged suites, same session):** `verify:licensing` 56/56 ·
  `verify:avatar` 24/24 · `verify:ipc-contract` 4/4 · `verify:authz` 40/40 · `verify:auth` 49/49.
- **Pass/fail/flaky:** 0 failing checks at end state; 0 flaky observed (each GUI suite ran on a
  fresh isolated profile; e2e-sweep ran 3× during healing with identical results).

## Defects

See `docs/testing/E2E_DEFECTS.md`: 2 test defects (both fixed in this assessment), 2 product
defects/gaps OPEN — **`awkit-64x`** (fresh install seeds bundled samples as real user records) and
**`awkit-b92`** (no per-role authorization on non-security IPC; plus the unfiltered footer nav) —
and 2 exploratory observations. Failure classification: no environment or data defects; no
requirement ambiguities beyond the template-vs-Electron adaptation approved up front.

## Exploratory pass (adapted)

The agent-browser Dogfood skill is not installed; exploration ran through the same real-Electron
harness + human review of the 30 route screenshots (light + dark): first-time user (first-run),
each role (RBAC suite), keyboard-only (Tab/Enter), small window (resize steps), theme switch.
Findings that reproduced became E2E-DEF-003/-005 and OBS-001/-002; nothing else surfaced —
navigation traps, data loss, duplicate actions, and permission leaks were all specifically probed
and not found.

## Coverage gaps / not tested (honest list)

- **Packaged EXE + clean-machine offline VM walkthrough** — BLOCKED: `electron-builder` OOMs on
  this 15.9 GB host (standing gate, `awkit-cm8`/`awkit-1cc` context).
- **ReauthDialog GUI flow** — no test override for the 5-min reauth window (OBS-002); covered at
  domain level by `verify:authz`.
- **Slow/failing network for automation targets** — covered by existing `verify:waits` (21) at the
  runner level, not re-run here (untouched area).
- **Screen readers, OS reduce-motion, RTL/long-text** — MANUAL-ONLY (unchanged).
- **Multi-day soak** — BLOCKED (dedicated machine; `awkit-cm8`).
- Firefox/WebKit/mobile emulation — N/A for Electron.

## Rerun commands

```bash
npm run build                 # once, before any GUI suite
npm run verify:e2e-auth       # 30 checks
npm run verify:e2e-rbac       # 42 checks
npm run verify:e2e-licensing  # 22 checks (seeds mock fixtures into its isolated profile itself)
npm run verify:e2e-sweep      # 13 checks + 30 route screenshots
npm run verify:auth-gui && npm run verify:admin-gui   # repaired existing suites
```

## Evidence locations

- Logs (per-suite check transcripts): `test-artifacts/2026-07-19-e2e-qa/logs/*.log`
- Screenshots (per-route light + dark + defect states): `test-artifacts/2026-07-19-e2e-qa/screenshots/`
- Sanitized activation-request sample: `test-artifacts/2026-07-19-e2e-qa/logs/activation-request-sample.json`
- System map: `test-artifacts/2026-07-19-e2e-qa/system-map.md`

**Verdict:** the auth/RBAC/licensing surfaces shipped in PR #21 hold up under adversarial E2E
testing (every denial enforced in the main process, no enumeration, no fingerprint privacy leak,
enforcement gate exact). The application is NOT "fully tested" by these suites alone: the packaged
EXE walkthrough and the OPEN product defects above remain before any production-ship claim.
