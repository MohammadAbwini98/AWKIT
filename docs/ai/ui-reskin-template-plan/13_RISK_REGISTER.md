# 13 — Risk Register

| # | Risk | Impact | Likelihood | Mitigation | Verification |
|---|------|--------|-----------|------------|--------------|
| 1 | Shared CSS change regresses many pages | High | Med | Edit base classes incrementally, rebuild per surface; phase-gated | `npm run build` + per-page screenshots each phase |
| 2 | Required field hidden by "simplify" | High | Low | 08 rules: only group under visible "Advanced", never remove | Field-presence checklist (12); property-panel review |
| 3 | Old hardcoded colors remain (patchy dark) | Med | High | Grep sweep + token map (03); track counts to zero | `grep` hex audit before/after; visual scan |
| 4 | Canvas behavior broken by styling | High | Med | Never touch RF geometry/transform; style classes only (06) | `verify:flow-designer/workflow-builder`; manual drag/connect |
| 5 | React Flow handles/connectors broken | High | Med | Keep handle IDs, ports, edge schema; restyle via css/tokens | connect/save/resize/loop tests |
| 6 | Animations cause jank | Med | Med | transform/opacity only; cap animated nodes; perf gate | fps check on busy canvas (12) |
| 7 | Reduced-motion not respected | Med | Low | Global kill-switch + JS guards (07) | OS reduce-motion test |
| 8 | Reports still look old (reuse old classes) | Med | Med | Retrofit base `.work-panel/.page-grid/.metric-card` first | `verify:reports` + tab screenshots |
| 9 | Dark-theme readability (low contrast) | Med | Med | AA contrast tokens; verify muted text ratios | contrast audit (11) |
| 10 | CSS specificity conflicts | Med | Med | Edit in place, no `!important` (except RM), single theme attr | build + visual diff |
| 11 | Over-copying template visuals (IP) | High | Low | Original palette/icons (lucide); no template assets | design review vs 00 "do-not-copy" |
| 12 | Phase scope creep | Med | Med | Strict per-phase files + stop-and-report | phase acceptance criteria |
| 13 | Runtime behavior changed accidentally | High | Low | Style-only; keep `window.playwrightFlowStudio`, IPC, schemas | runner/recorder/instance verifiers |
| 14 | 227 inline styles override tokens | Med | Med | Inventory inline styles; migrate chart/layout hex to tokens in Phase 5/7 | grep `style={{`; chart color check |
| 15 | White flash on load/route change | Low | Med | Set dark backdrop on `:root`/`body` early; keyed fade unaffected | boot + navigation screenshots |
