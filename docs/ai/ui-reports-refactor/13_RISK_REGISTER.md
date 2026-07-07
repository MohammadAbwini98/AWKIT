# 13 — Risk Register

Severity = Impact × Likelihood. Review at the start of every phase; add rows when new risks appear.

| # | Risk | Impact | Likelihood | Mitigation | Verification |
|---|---|---|---|---|---|
| 1 | **Building on the uncommitted `feature/smart-wait-engine` tree** — refactor regressions become un-bisectable from Phase 5.x runtime work | Critical | High (current state) | Phase 0: land/commit current work first; new branch for this initiative | `git status` clean before Phase 1 |
| 2 | Breaking workflow/flow schema or serializers during canvas refactor | Critical | Medium | Phase 10 forbids persisted-shape changes; visual state lives in CSS only; dirty-snapshot purity rule (03) | `verify:runner` 82, open old saved flows, no-dirty-on-open check |
| 3 | Losing required field bindings in restyled properties panels | High | Medium | field-by-field checklist before/after (03); no panel logic changes | manual checklist + `verify:flow-designer`/`workflow-builder` |
| 4 | IPC contract mismatch (channel name/type drift between `ipc/*`, `preload.ts`, renderer) | High | Medium | single typed contract file (`TelemetryContracts.ts`); additive-only rule; audit §C.3 | tsc + dev-tools smoke + audit |
| 5 | Reports showing fake/stale data as real | High | Low | no mock data outside `VITE_ENABLE_DEMO_REPORTS`; empty states; last-updated timestamps on live cards | acceptance #11–13 |
| 6 | Live polling degrading run performance or freezing UI | High | Medium | reuse existing 1 s/2 s polls, one shared poller per page; server-side aggregation; point caps | acceptance #19, perf trace, soak |
| 7 | Telemetry writers slowing or failing runs | Critical | Low | never-throw pattern, best-effort writes at existing seams, `AWKIT_PROCESS_SAMPLING`/`AWKIT_DURABLE_STORE` kill switches | fault injection (11 #15), `verify:runner` |
| 8 | Per-process metrics assumed to need admin / CIM query failing on locked-down machines | Medium | Medium | availability model (`full/partial/unavailable`) + notice; core metrics never depend on it | manual degradation test (12 §6) |
| 9 | Interval/listener leaks from live dashboards | Medium | Medium | `useEffect` teardown convention; audit §C.3; soak test | heap/listener snapshots (12) |
| 10 | Migration v2 corrupting or breaking old `runtime.sqlite` | High | Low | additive ALTERs only; run-once versioned migrations (existing mechanism); test on a copied v1 DB | `verify:durable-store` + `verify:telemetry` upgrade check |
| 11 | Unbounded sample tables growing the DB | Medium | High (without action) | retention sweep + change-only writes (04 §4) | `verify:telemetry` retention check |
| 12 | Animation jank on canvas / low-end machines | Medium | Medium | compositor-only properties; no idle infinite animations; reduced-motion global | perf trace, designer drag test |
| 13 | Dribbble-inspired design drifting into copying protected artwork | Low | Low | tokens + written direction only; references never fetched/downloaded; original AWKIT components | design review |
| 14 | Over-refactoring visuals before telemetry contracts stabilize | Medium | Medium | plan order: contracts (3–4) → dashboards (5–9) → canvas visuals (10) | plan adherence |
| 15 | Large phases causing hard-to-debug regressions | Medium | Medium | one phase per session, per-phase verification + audit rows, no auto-continue | phase reports |
| 16 | New chart/motion dependency breaking offline packaging | High | Low | zero-dependency default; any exception needs approval + `validate:offline` + packaged smoke | acceptance #29 |
| 17 | Route/`lastRouteId` persistence blank-screening on unknown ids (up/downgrade) | Medium | Medium | fallback-to-`dashboard` guard (Phase 5); keep existing `reports` route id | stale-id relaunch test (11 #28) |
| 18 | Renderer bundle growth worsening the known ~900 KB debt | Low | High | hand-rolled SVG (no lib); measure per phase; consider lazy-loading report pages if > +15 % | bundle-size record (12) |
| 19 | Reports UI regressing the fresh-install packaged walkthrough (first-run empty states) | High | Low | empty-state-first development; walkthrough re-run at Phase 13 | `verify:packaged-walkthrough` |
| 20 | Mock-site scenarios/verifiers drifting from changed Instance Monitor/designer surfaces | Medium | Medium | mock-site duty in each phase prompt; `mock-site-maintainer` skill | `verify:mock-site` 28 |
| 21 | Theme direction mismatch (user expected dark, pack/current app are light) | Medium | Medium | explicit decision gate before Phase 2; token-first keeps dark cheap later | user sign-off recorded in TASK_LOG |
| 22 | Attribution errors (linking Chromium processes to the wrong instance/workflow) misleading users | Medium | Medium | attribute only via tracked browser PIDs (worker→instance map); show "unattributed" otherwise | manual multi-instance run check |
