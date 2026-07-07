# Phase 5 — Clean Offline VM Walkthrough & Release Candidate Gate

**Created:** 2026-07-06 (Claude Fable 5). **Updated:** 2026-07-07 (Phase 5.1 verification — Chromium
no-egress hardening validated; strict-net walkthrough passes). Local-only, uncommitted, on
`feature/smart-wait-engine`. Builds on Phase 4 (`docs/ai/PHASE4_RELEASE_HARDENING.md`).

## Honest status — read this first

| Validation | Status |
|---|---|
| Packaged app, fresh/clean user profile, full functional walkthrough (automated) | **DONE on the dev machine** — `npm run verify:packaged-walkthrough` (see §2) |
| Loopback-only network observation of the packaged app + its browsers | **DONE on the dev machine** (see §2, Part M) |
| **Chromium no-egress hardening (Phase 5.1C)** | **DONE + PROVEN on the dev machine** — `verify:chromium-hardening` 13/13 (bundled Chromium: zero non-loopback over 20 s idle, external navigation still works) and `AWKIT_WALKTHROUGH_STRICT_NET=1 verify:packaged-walkthrough` **70/70** (strict no-egress passes; the Phase 5 Google-service burst is eliminated) |
| Packaged-process teardown targets the REAL Electron main (Phase 5.1D) | **DONE** — `scripts/helpers/packaged-process-tree.mts`; both packaged verifiers report a fully-terminated tree (no zombie app/Chromium) |
| Portable EXE real launch on a fresh profile | **DONE on the dev machine** (see §2, Part K) |
| Rebuild the shippable, max-compressed, hardened portable/NSIS EXEs | **PARTIAL** — 7-Zip `-mx=9` OOMs here (KNOWN_ISSUES), so the shippable max-compressed EXEs were NOT produced. `win-unpacked` (the validated payload) is hardened, and one-off `store`-compressed **hardened** portable (~1.23 GB) + NSIS (~376 MB) EXEs + a consistent `latest.yml` (installer sha512 re-verified) were produced for validation only. Max-compressed + signed distributables need a higher-memory machine. |
| NSIS installer **install/uninstall + launch** | **NOT DONE** — installer integrity (sha512 vs `latest.yml`) verified only; the install/uninstall cycle needs a clean machine |
| **Clean/offline Windows VM walkthrough (this checklist, §3)** | **NOT PERFORMED** — no VM/Windows Sandbox available in the agent environment (`WindowsSandbox.exe` absent; host is a MacBookPro15,1 running Windows 10 Enterprise 19045) |

Per the Phase 5 guardrail, **offline-VM validation is NOT claimed**. The dev-machine walkthrough
below is strong evidence (fresh `LOCALAPPDATA`, real packaged EXE, no dev paths, loopback-only
traffic — now including a strict no-egress pass), but the app still ran on a machine that has the
dev toolchain installed. The §3 checklist is the remaining human gate.

## 1. What the automated packaged walkthrough proves (and how)

`npm run verify:packaged-walkthrough` (`scripts/verify-packaged-walkthrough.mts`, run after
`npm run package:portable`) launches the REAL packaged build with `LOCALAPPDATA` pointed at a
brand-new empty directory — the closest dev-machine equivalent of "first run on a clean user
profile":

- **First run:** window renders (no white screen), durable runtime initializes at startup,
  `appMode === "packaged"`, sql.js WASM loads from app.asar, `runtime.sqlite` + all runtime
  folders are created under the fresh root, only the bundled sample content appears.
- **Full workflow run inside the packaged app:** mock-site fixtures imported through the app's
  own IPC, `Mock — Simple Workflow` runs to `completed`; JSONL run log, screenshots, report and
  `flow-state.json` artifacts all written under the fresh profile.
- **Hard cancellation:** a long-waiting run is stopped; run ends `cancelled` (not `failed`);
  the bundled-Chromium process tree is gone; browser slot + locks released.
- **Browser bound:** 4 concurrent instances with `AWKIT_MAX_BROWSERS=2` never exceed 2 browser
  roots at OS level; excess instances queue; `stopAll` drains everything to `cancelled`.
- **Recorder:** starts and cancels cleanly inside the packaged app (bundled browser).
- **Kill + recovery:** the app is hard-killed mid-run; on restart the orphaned run surfaces as
  recoverable (safe, NOT auto-resumed), the Recoverable Runs panel renders in the Instance
  Monitor, details/mark-reviewed work, and the run disappears from the list.
- **External DB read:** `runtime.sqlite` is read afterwards by an external sql.js instance —
  completed/cancelled/reviewed runs are all recorded.
- **Portable EXE:** the actual `WebFlow Studio 0.1.0.exe` boots on a second fresh profile and
  creates the durable runtime.
- **NSIS integrity:** `WebFlow Studio Setup 0.1.0.exe` sha512 matches `dist/latest.yml`.
- **Network isolation:** the app process tree is sampled every ~4s for the whole walkthrough;
  every observed TCP connection must be loopback (app ⇄ local mock site / DevTools pipe).

Evidence folder: `dist/phase5-evidence/` (screenshots, run log, workflow screenshot,
`walkthrough-summary.json`). Fresh profiles are kept under `%TEMP%\awkit-phase5\` for
inspection.

## 2. Automated walkthrough results (dev machine)

> Fill/refresh after each `npm run verify:packaged-walkthrough` run.

| Field | Value |
|---|---|
| Date | **2026-07-07** (Phase 5.1 hardened re-run; original run 2026-07-06 was 68/68 warn-only) |
| Machine | Dev machine (MacBookPro15,1, Windows 10 Enterprise 10.0.19045, 16 GB RAM) — **not a clean VM** |
| Build under test | `dist/win-unpacked` rebuilt 2026-07-07 **with the Chromium hardening** (app.asar re-emitted; the shared payload for both EXEs). The final single-file EXEs could not be max-compressed here (7-Zip `-mx=9` OOM — see KNOWN_ISSUES); a one-off `store`-compressed hardened portable EXE (~1.2 GB) was produced for the Part K boot check. |
| Result | **70 passed, 0 failed** with `AWKIT_WALKTHROUGH_STRICT_NET=1` (strict no-egress mode) |
| Egress | **RESOLVED.** Strict check passed: bundled Chromium made **zero** non-loopback connections; app processes made zero non-loopback connections; 69 loopback connections (app ⇄ mock site / DevTools pipe). The Phase 5 Google-service burst is eliminated by `src/runner/ChromiumHardening.ts`. |
| Key proofs | fresh-profile first run; full workflow `completed` in the packaged app; hard cancel → `cancelled` + Chromium tree gone; 4 instances never exceeded the 2-browser OS-level cap; recorder start/cancel; kill of real main pid → startup recovery surfaced `orphaned`/recoverable, panel rendered, markReviewed cleared it; external SQLite read; portable EXE booted a 2nd fresh profile; NSIS sha512 matches `latest.yml`; **strict no-egress** (app + bundled Chromium); teardown left no zombie process |
| Evidence | `dist/phase5-evidence/` (`01-first-run.png`, `02-run-log.jsonl`, `03-workflow-screenshot.png`, `04-recovery-panel.png`, `walkthrough-summary.json`) |

## 3. Manual clean/offline VM checklist (the remaining human gate)

Perform on a Windows 10/11 VM (Hyper-V/VirtualBox/VMware/Windows Sandbox) with **no** Node, no
Playwright, no Chrome requirement, and a snapshot taken before starting.

### 3.1 Environment record

| Field | Value |
|---|---|
| VM OS version + build | |
| VM RAM / CPU | |
| Internet state during install test | (enabled/disabled) |
| Internet state during offline test | **disabled (required)** |
| Portable EXE path on VM | |
| NSIS installer path on VM | |
| App data path observed | expect `%LOCALAPPDATA%\WebFlow Studio\` |
| Runtime DB path observed | expect `%LOCALAPPDATA%\WebFlow Studio\runtime\runtime.sqlite` |
| Artifacts path observed | expect `%LOCALAPPDATA%\WebFlow Studio\instances\<executionId>\...` |
| Max chrome.exe count observed | |
| Tested workflows | |
| Observed failures | |
| Screenshots/evidence folder | |
| Final result | PASS / PASS WITH WARNINGS / FAIL |

### 3.2 Install & launch (Phase 5B)

- [ ] Portable EXE launches (expect a SmartScreen warning — EXEs are **unsigned**; "More info → Run anyway").
- [ ] NSIS installer completes per-user (no admin prompt) and the installed app launches.
- [ ] No missing DLL/WASM/module error dialog; no white screen; no startup crash.
- [ ] Offline Runtime Status page shows packaged mode and a passing dependency manifest.
- [ ] `%LOCALAPPDATA%\WebFlow Studio\` appears with `flows/ workflows/ logs/ screenshots/ runtime/ storage/` etc.
- [ ] `runtime\runtime.sqlite` exists after first launch (durable runtime initialized at startup).
- [ ] Nothing is written into the install folder / `resources\` / `app.asar`.

### 3.3 Offline startup (Phase 5C)

- [ ] Disable the VM network adapter entirely.
- [ ] Relaunch the app: it starts, dependency manifest still passes, no download attempt, no hang.
- [ ] Run a workflow against a **local** page (e.g. copy `mock-site/` to the VM and run
      `mock-site` with the bundled Node-free option — or use any local HTML file via `file://`).
      *(The mock site needs Node; if unavailable on the VM, validate with a local file/flow that
      does not navigate.)*
- [ ] With the network adapter still **enabled**, watch Resource Monitor → Network while launching a
      run: the bundled Chromium should make **no external (non-loopback) connections** at browser
      startup (Phase 5.1C hardening; proven on the dev machine, re-confirm the VM's Chromium build).
- [ ] `runtime.sqlite` remains readable/writable offline.

### 3.4 Core GUI walkthrough (Phase 5D)

- [ ] Create/open a workflow from the GUI.
- [ ] Recorder: record navigate/click/type/wait on a local/authorized page; save the flow.
- [ ] Recorded flow opens in the Flow Designer with Start/End nodes wired.
- [ ] Run the flow/workflow; Instance Monitor shows live status; run completes.
- [ ] Screenshots/logs/artifacts appear under `%LOCALAPPDATA%\WebFlow Studio\`.

### 3.5 Session reuse & protected login (Phase 5E)

- [ ] Recorder against a protected login page pauses, closes the automation browser, and offers
      the real-Chrome handoff (never automates the protected surface).
- [ ] Manual Chrome handoff opens the user's real Chrome with an app-owned scoped profile.
- [ ] Capture Session & Resume links the session to a `Reuse Session` node.
- [ ] Reuse Session run restarts the browser on the captured profile without
      "Target page/context/browser has been closed".
- [ ] No stale profile lock remains after completion (second run works immediately).

### 3.6 Hard cancellation (Phase 5F)

- [ ] Start a workflow that is navigating/waiting; click Stop in the Instance Monitor.
- [ ] Browser window closes within seconds; run ends **cancelled** (not failed).
- [ ] Task Manager: no leftover chrome.exe from the run.
- [ ] A new run starts immediately (slot + locks released).

### 3.7 Recovery panel (Phase 5G)

- [ ] Start a safe workflow, kill the app via Task Manager mid-run.
- [ ] Relaunch: Recoverable Runs panel appears in the Instance Monitor.
- [ ] Details show last node, URL, safety level, trace/screenshot paths.
- [ ] Open artifacts opens the folder; Mark reviewed / Mark abandoned remove the entry.
- [ ] Re-run is offered ONLY for safe runs; dangerous runs show "Manual review required".

### 3.8 Browser process bound (Phase 5H)

- [ ] Queue 4+ workflow runs; Task Manager never shows more than the configured browser cap
      (default 2) of bundled-Chromium browser roots; excess runs queue.
- [ ] Runtime status strip shows capacity/backpressure; cancelling many runs frees slots.
- [ ] No runaway memory growth.

### 3.9 Artifact validation (Phase 5I)

For one success, one failure, one cancellation, and one recovery case:

- [ ] `runtime\runtime.sqlite` opens in an external SQLite tool.
- [ ] `logs\<executionId>\<instanceId>.jsonl` parses; lines carry runId/nodeId/attempt/error
      class/current URL where applicable; secrets masked.
- [ ] `screenshots\...` images open.
- [ ] `instances\<executionId>\<instanceId>\traces\*.zip` opens in Playwright trace viewer
      (if available on another machine).
- [ ] `state\flow-state.json` / `node-attempts.json` are valid JSON.

## 4. Known limitations to carry into the decision

- EXEs are unsigned → SmartScreen warning on first launch.
- **Shippable EXEs not rebuilt with max compression here.** 7-Zip `-mx=9` OOMs on this machine
  (KNOWN_ISSUES). `dist/win-unpacked` (the validated payload) is hardened, and a one-off
  `store`-compressed hardened portable EXE was produced (~1.2 GB, validation-only). Produce the
  distributable max-compressed + signed portable/NSIS EXEs on a higher-memory machine before release.
- NSIS install/uninstall cycle not yet exercised anywhere (integrity hash verified only).
- The offline mock site requires Node on the VM; pure-offline GUI validation needs a local
  target strategy (bundled mock page or `file://` flow).
- Protected-login handoff requires the VM to have real Chrome/Edge installed.
- **Chromium no-egress hardening is proven on this machine** (`verify:chromium-hardening` +
  strict-net walkthrough), but re-confirm on the VM if the VM's Chromium build differs; toggle via
  `AWKIT_CHROMIUM_OFFLINE_HARDENING` if a service host ever needs to be reachable.
- sql.js durable store keeps a ≤300 ms loss window on hard kill (by design, Phase 3/4).
