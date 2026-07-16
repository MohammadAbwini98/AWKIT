# Browser Resource Optimization (per-instance Chromium)

Goal: reduce the CPU / RAM / network / background / disk cost of **one** running Chromium automation
instance while preserving the workflow's intended behaviour, with one authoritative configuration path,
workflow-capability guards, and measured evidence. Per-instance, **not** a concurrency change.

## 1. Traced browser lifecycle (Confirmed)

`execution.ipc.runWorkflow` → `ExecutionEngine.startRun` → `InstanceManager.createInstanceConfig`
(default run is **headed** — `execution.ipc` sets `headless = request.headless ?? false`) →
`ExecutionEngine.runInstance` → `PlaywrightRunner.executeScenario` → **`BrowserContextFactory.create`** is
the single launch/context site. Three context paths: persistent (`launchPersistentContext`), isolated
(`launch`+`newContext`), shared-pool lease (A5). `resolveLivePage` reuses `context.pages()[0]` (the
auto-blank page) — the main page is never orphaned; popups/branch pages are closed by their owners.

`createLaunchOptions()` is the ONLY place launch args are assembled; `buildContextOptions()` the only place
context options are. Before this work, `ResourceRoutingPolicy` (A9) and `ArtifactProfile` (A9) existed but
were env-only and never passed to `PlaywrightRunner`, with no unified profile or resolver.

## 2. Chromium launch audit (Playwright 1.61.0, no `ignoreDefaultArgs`)

Playwright ships ~35 default switches (verified in `node_modules/playwright-core/lib/coreBundle.js`),
including the three background-throttle switches: `--disable-background-timer-throttling`,
`--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding`. `buildChromiumHardeningArgs()`
appends AWKIT's args AFTER Playwright's: re-pins ~14 defaults (intentional dups), **replaces**
`--disable-features` with a verified superset, adds egress suppression (`--no-pings`, host-resolver-rules,
gaia/lso redirects). No `--no-sandbox`/`--single-process`/`--disable-web-security` — the effective set is
safe (sandbox on, site isolation on, web security on). Full table unchanged from the audit; the only
duplicates are intentional pins.

## 3. Architecture (Phases 6–8) — one authoritative resolver

```
Browser Resource Profile  +  Workflow Capabilities  +  Runtime Requirements (machine/env)
                                        │
                     resolveBrowserRuntimeConfiguration()   ← THE single resolver
                                        │
   { resourceRouting, launchArgOverrides, artifact/traceMode, contextOverrides, pageCleanup, diagnostics[] }
                                        │
              PlaywrightRunner → BrowserContextFactory (launch args + context options)
```

- `src/runner/browserProfile/BrowserResourceProfile.ts` — declarative profile + 4 presets. Maps blocking
  flags onto the existing `ResourceProfile` (normal/lean/ultraLean) — no duplication.
- `WorkflowCapabilities.ts` — static analysis (reuses `WorkloadWeights.extractWorkloadFeatures`).
  **Capabilities only ever RELAX optimizations.**
- `BrowserRuntimeConfigurationResolver.ts` — deterministic, total, `{setting,value,source}` diagnostic per
  decision, `explainResolution()`.
- `resolveForRun.ts` — env entry, default `balanced` == today.

Wiring is default-preserving: `balanced` with no env overrides resolves byte-for-byte to today's behaviour
(verified: `verify:browser-resource-profile`).

## 4. Profiles

| Knob | maximum-compatibility | balanced (default = today) | low-resource |
|---|---|---|---|
| image/media/font blocking | none | none | **block** |
| analytics/telemetry hosts | allow | allow | **block** (URL patterns) |
| service workers | allow | allow | **block** (unless needed) |
| reduced motion | no | no | **reduce** (unless animations) |
| background throttling | disabled | disabled | **disabled** (removed — see §5/§7C) |
| device scale | default | default | **1** (unless full-res) |
| disk cache | default | default | **bounded 64 MB** |
| artifacts (trace) | onFailure | onFailure | **off** (production) |
| page cleanup | off | off | on (unless multi-page) |
| GPU / WebGL | auto / on | auto / on | auto / on (Custom-only to disable) |

## 5. Rejected / never-added (safety + evidence)

Never introduced (security): `--no-sandbox`, `--single-process`, `--disable-web-security`,
`--disable-site-isolation-trials`, `--disable-features=IsolateOrigins`.
Custom-only pending clean-machine benchmark: `--disable-gpu`, `--disable-webgl`, `--renderer-process-limit`.
**Removed from the low-resource default on measured evidence: background throttling** (see §7C) — it
produced no CPU benefit for AWKIT instances. The mechanism (selective `ignoreDefaultArgs` +
`omitBackgroundTimerThrottlePin`) is retained for `custom` only.

## 6. Workflow capability resolution (Phase 7)

The optimization adapts to the workflow, never the reverse. Live-validated in the workload matrix:
`low-resource + downloadFile → downloads kept (downloadOk 100%)`; `+ switchToPopup → pages kept (popup/tab
100%)`; `+ screenshot → images re-allowed + full device-scale`; `+ persistent/session → service workers
kept`. Env hints (`AWKIT_WORKFLOW_REQUIRES_*`) force undetectable needs (WebGL/GPU/media/animations) on.

## 7. Benchmarks — statistically-robust, multi-experiment

**Machine:** Intel i7-8750H · 12 cores · 16 GB · Windows. Harness: `scripts/benchmark/lib.mts` +
`benchmark-workloads.mts` / `benchmark-ablation.mts` / `benchmark-occlusion.mts`. Per-instance Chromium
subtree sampled via `Win32_Process` (PID-baseline diff; catches `chrome-headless-shell.exe`). Network is
server-side bytes/requests (an aborted request never reaches the server — deterministic). Stats reported as
mean/median/p95/max/stddev. **All runs headed** (AWKIT's default run mode).

### A. Workload matrix — Balanced vs Low-Resource (15 reps each)

RAM reduction is **workload-dependent** (median-based, robust to GC outliers):

| Workload | RAM Balanced→Low (median) | ΔRAM | Network Balanced→Low | Duration | Behaviour (Low) |
|---|---:|---:|---:|---:|---|
| multitab | 353 → 308 MB | **−12.7%** | 1612 → 1 KB | unchanged | tabOk 100% |
| image-heavy | 331 → 307 MB | **−7.3%** | 4594 → 0 KB (**−99.99%**) | unchanged | — |
| spa | 333 → 318 MB | −4.7% | 3458 → 1 KB | unchanged | — |
| download | 349 → 338 MB | −3.2% | 48 → 0 KB | unchanged | downloadOk 100% |
| popup | 316 → 307 MB | −3.0% | 97 → 1 KB | unchanged | popupOk 100% |
| animation | 320 → 315 MB | −1.7% | 49 → 1 KB | unchanged | — |
| form | 303 → 306 MB | +1.0% (noise) | 53 → 5 KB | unchanged | filledOk 100% |
| table | 380 → 382 MB | −0.4% (noise) | 49 → 1 KB | unchanged | — |

Takeaways: **RAM saving tracks how image-heavy a page is** (~7–13% for image-heavy, ~0% for
form/table). **Network saving is large wherever sub-resources exist** (≈99% on image/asset pages).
**Duration is unchanged** (no workflow slowdown). **CPU showed no consistent per-instance win** (noisy,
both signs across workloads). **Behaviour is 100% under Low-Resource**, confirming capability guards.

### B. Ablation — where the RAM/network saving originates (image-heavy, 20 reps)

| Optimization | RAM Impact | CPU Impact | Network Impact | Duration | Compatibility risk (mitigation) |
|---|---:|---:|---:|---:|---|
| **image blocking** | **−5.98%** (med −6.0%) | ~0 (noise) | **−98.95%** | ~0 | breaks screenshots/image checks (needsImages) |
| font blocking | −0.68% | ~0 | −1.04% | ~0 | visual only (text uses fallback) |
| media blocking | ~0 (no media on page) | ~0 | ~0 | ~0 | breaks audio/video (needsMedia) |
| analytics blocking | ~0 (varies by site) | ~0 | ~0 here | ~0 | none (fire-and-forget beacons) |
| reduced motion | −1.15% (noise) | ~0 (rAF unaffected) | 0 | ~0 | breaks animation validation (needsAnimations) |
| service-worker block | ~0 (no SW on page) | ~0 | 0 | ~0 | breaks offline app shells (needsServiceWorkers) |
| device-scale 1 | ~0 | ~0 | 0 | ~0 | pixel-faithful screenshots (needsFullResolution) |
| background throttling | +0.27% (zero) | ~0 (see §7C) | 0 | ~0 | none, but no benefit → removed |
| artifact policy (trace off) | n/a (host/disk I/O, not browser) | n/a | 0 | ~0 | fewer diagnostics |
| page cleanup | ~0 (AWKIT already reuses pages) | ~0 | 0 | ~0 | none |
| **COMBINED low-resource** | **−7.67%** (med −6.0%) | ~0 | **−99.99%** | ~0 | guarded by capabilities |

**The profile's RAM win is almost entirely image blocking** (COMBINED ≈ image-blocking alone; fonts add a
little). **The earlier 21% figure was 3-rep noise** — the honest stable RAM saving is ~6% on a clean
image-heavy page, up to ~13% on the most image-dense workload. Network is the large, reliable win.

### C. Occluded/minimized headed windows — the throttling question (20 reps)

Genuine minimized window (Win32 `ShowWindowAsync`) + background tab; heavy-rAF page (max power to detect a
real throttle effect). Selective `ignoreDefaultArgs` per switch (never `ignoreDefaultArgs: true`):

| Config (minimized) | CPU mean | median | p95 | sd | vs pw-default | timer | rAF | waitResp / popup / click |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| pw-default (today) | 1.5% | 1.6 | 3.5 | 0.9 | — | 5/s | 1/s | 100% / 100% / 100% |
| timer-throttle only | 2.7% | 2.3 | 5.4 | 1.2 | none (noise) | 5/s | 1/s | 100% / 100% / 100% |
| renderer-backgrounding only | 3.3% | 3.5 | 5.5 | 1.2 | none (noise) | 5/s | 1/s | 100% / 100% / 100% |
| occluded-backgrounding only | 2.6% | 2.9 | 5.1 | 1.2 | none (noise) | 5/s | 1/s | 100% / 100% / 100% |
| all three | 2.8% | 2.8 | 5.5 | 1.1 | none (noise) | 5/s | 1/s | 100% / 100% / 100% |

**Findings.** (1) Minimizing a headed window **already** floors CPU at ~1.5% — Chromium's compositor stops
producing frames (rAF 60→1/s) for a minimized window in the *current* default, no switches needed.
(2) Re-enabling any/all throttle switches gives **no CPU reduction** (all configs sit at/above baseline
within noise; overlapping p95). (3) **Page timers never throttle** (stay 5/s) because Playwright keeps
automated pages `visibilityState: visible` (`pageHidden 0%` in all configs) — so re-enabling throttling
would not slow timer-dependent workflows *and* would not save CPU. (4) All AWKIT behaviours (waitForResponse,
popup detection, click) stay **100%** in every config. → **Background throttling was removed from
low-resource** (kept in `custom`).

### D. Multi-instance memory estimate (LABELLED ESTIMATE — not yet multi-instance-benchmarked)

Per-instance median RAM saved on image-heavy workloads ≈ **24–45 MB** (image-heavy 331→307; multitab
353→308). **Naive linear scaling** for N concurrent image-heavy headed instances:

| Concurrent image-heavy instances | Estimated RAM saved (linear) |
|---:|---:|
| 4 | ~100–180 MB |
| 8 | ~200–360 MB |

These are **estimates only.** Real multi-instance totals may differ (OS page sharing across Chromium
processes, the A5 shared-browser pool, GC timing). Image-*light* workloads (form/table) save ≈0, so the
fleet saving depends on the workload mix. **Confirm with a multi-instance benchmark before quoting.**

## 8. Verification (no regression)

`npm run build` clean · `verify:browser-resource-profile` **51/51** (balanced==today, capability relaxations,
throttle pin now OFF in low-resource + Custom-throttling mechanism still works) · regression:
`verify:runner` **82/82**, `verify:chromium-hardening` **13/13**, `verify:lean-mode` **12/12**,
`verify:resource-routing` **42/42**, `verify:concurrency` **78/78**, `verify:workload-weights` **53/53**,
`verify:telemetry` **54/54**.

## 9. Production recommendation (evidence-based)

- **Keep `balanced` as the default** (proven == today; zero risk).
- **Use `low-resource` for unattended/headless and image-heavy runs.** Measured, safe wins: **network −~99%**
  on asset-heavy pages and **RAM −7…13%** on image-heavy pages, **duration unchanged**, **behaviour 100%**,
  with capability guards protecting screenshot/download/popup/animation/service-worker/persistent flows.
  On image-*light* workflows it is essentially free (≈0 change) — so it is a safe default *for a run the
  operator marks unattended*, but not worth forcing on every workflow.
- **Do NOT auto-select purely on "headed vs headless".** The right auto-selection signal is workflow
  capability + attended/unattended intent, which the resolver already computes — a future enhancement can
  default unattended runs to `low-resource` and attended/interactive runs to `balanced`.
- **Do not rely on background throttling** for unattended CPU savings — minimizing the window already
  achieves it, and the switches add nothing (§7C).

## 10. Remaining risks / follow-ups

- CPU is not a reliable per-instance lever with these profiles (rendering dominates and is already
  compositor-throttled when minimized); the wins are network + RAM.
- Multi-instance RAM totals are estimated, not yet benchmarked (§7D).
- GPU/WebGL/renderer-limit remain Custom-only pending clean-machine evidence.
- Profile selection is env-first (`AWKIT_BROWSER_RESOURCE_PROFILE`); a Settings UI + per-workflow capability
  hints on `WorkflowProfile` + an unattended→low-resource auto-rule are follow-ups.
- `pageCleanup` is resolved + guarded but a no-op in practice (AWKIT already reuses the initial page).
