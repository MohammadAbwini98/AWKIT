# 12 — Verification & QA Plan

All commands below exist in `package.json` today (except `verify:telemetry`, created in Phase 3).
There is **no** `npm test` and **no** `npm run lint`. `@playwright/test` cannot load its TS config
on Node 18.16 (needs ≥18.19) — verification uses the `tsx` verifier scripts instead
(see `docs/ai/TESTING.md`).

## Static / build checks (every phase)

```bash
npm run typecheck        # tsc --noEmit (also first step of build)
npm run build            # typecheck + electron-vite main/preload/renderer bundles
npm run ai:memory        # memory-file checker (before finishing a task)
```

## Verifier matrix (run the rows matching the phase's touched area)

| Area touched | Commands (recent baseline counts) |
|---|---|
| Any runner/engine/telemetry writer | `verify:runner` (82), `verify:waits` (21), `verify:concurrency` (78), `verify:cancellation` (12) |
| Durable store / migrations | `verify:durable-store` (11), `verify:durable-locks` (17), `verify:startup-recovery` (10), **`verify:telemetry` (new)** |
| Runtime status / sampling | `verify:runtime-status` (15), `verify:resource-sampling` (14) |
| Browser pool / locks | `verify:browser-pool` (13), `verify:locks` (15), `verify:watchdog` (13) |
| Designer / Builder UI | `verify:flow-designer` (19), `verify:workflow-builder` (13) — real Electron GUI |
| Recorder surfaces | `verify:recorder` (57), `verify:recorder-draft` (17), `verify:protected-login-recorder` (34) |
| Instance Monitor logic | `verify:instance-monitor` (27-check suite) |
| Mock-site scenarios | `verify:mock-site` (28) + the focused feature verifier |
| Artifacts/traces | `verify:artifacts` (13) |
| Offline/packaging (Phase 13) | `validate:offline`, `verify:packaged-runtime` (25), `verify:packaged-walkthrough` (70; `AWKIT_WALKTHROUGH_STRICT_NET=1`) |
| Stress (Phase 12/13 only) | `verify:stress:concurrency`, `verify:stress:cancellation`, `verify:stress:locks`, `verify:stress:artifacts`, `verify:soak:runtime` |

Report actual pass counts; a drop from baseline = regression, stop and fix.

## Manual GUI walkthrough (Phases 5–11, full pass at 13)

Environment: `npm run mock-site` (port per `mock-site/README.md`) + `npm run dev`
(ensure `ELECTRON_RUN_AS_NODE` is unset). Seed: `npm run seed:mock-fixtures`.

1. **Shell:** app loads; all nav groups incl. Reports; collapse/expand sidebar; status bar;
   no blank route; console clean.
2. **Workflow Builder regression checklist:** open saved workflow; add/remove flow node; draw
   success/failure/conditional link; resize node; edit Workflow Definition panel; save (toast);
   reload; no spurious dirty dialog; double-click flow node opens Flow Designer.
3. **Flow Designer regression checklist:** open recorded + hand-built flows; select each major
   node type and confirm required fields + validation; Smart Waits section; conditional/parallel
   branch-pair ports draggable; loop button add/remove + semicircle; connector style editor;
   save/reload; unsaved-changes dialog only on real edits.
4. **Run lifecycle:** run a workflow from a card; watch Instance Monitor live (status, runtime
   strip, Live Report modal per-step flow); Stop an instance (hard cancel); Repeat an instance;
   run 4 instances and confirm the 2-browser cap.
5. **Reports dashboard checklist:** every report page in empty state → after runs (1 pass,
   1 fail) shows exactly those runs; time-range selector; workflow drill-down → run detail →
   node attempts + artifact open; instance reports; pagination.
6. **Runtime live metrics checklist:** Chrome consumption page idle → during run (gauges,
   process strip) → after Chromium kill (graceful) → availability notice with sampler disabled
   (`AWKIT_PROCESS_SAMPLING=0`).
7. **Failure/server analytics:** categories match the induced failure; flakiness threshold
   behavior; server storage sizes plausible; insights cite evidence.
8. **Recorder + sessions spot-check:** start/cancel a recording; protected-login mock scenario
   handoff panel unaffected.

## Performance checklist

- DevTools performance trace: canvas node drag ≥ 55 fps equivalent (no long tasks > 50 ms from
  new CSS); dashboard poll ticks cause no layout thrash (check Layout events).
- Heap: snapshot after load, after 10-min soak on Reports + Chrome pages, after navigating away —
  detached-node and listener counts stable.
- Renderer bundle: record `out/renderer` size before/after (baseline ~900 KB JS); flag growth
  > 15 % for discussion.
- App cold-start not visibly slower (durable init already runs at startup — telemetry init must
  piggyback, not add blocking work).

## Accessibility checklist

- Keyboard-only pass across new pages (tab order, focus rings, Escape closes drawers).
- Windows "Show animations" OFF → no count-ups/sweeps/shimmer/pulses.
- Contrast spot-checks of token pairs (02 rule); status badges include text/icon.
- Charts expose text summaries; tables remain readable at 125 % zoom.

## Packaging / build checklist (Phase 13)

```bash
npm run validate:offline
npm run verify:packaged-runtime
npm run verify:packaged-walkthrough      # fresh-profile: reports must be clean empty states
```

Note: full max-compression packaging (`package:portable`/`package:nsis`) OOMs on 16 GB machines
(KNOWN_ISSUES); use `-c.compression=store` for validation builds as documented.

## Gaps to document honestly

- Clean/offline Windows VM walkthrough remains a human gate (unchanged from Phase 5).
- Dribbble references not fetched (offline) — design fidelity judged against written direction.
- No automated visual-regression tooling exists; before/after screenshots in
  `docs/ai/ui-reports-refactor/baseline/` are the substitute.
