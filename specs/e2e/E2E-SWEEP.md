# E2E-SWEEP — Full route sweep: render, console, empty states, theme, resize, keyboard

Executable: `scripts/verify-e2e-route-sweep.mjs` · Role: SuperUser (sees all 30 routes) ·
Setup: fresh profile (empty states are the expected content).

| # | Step | Expected |
|---|---|---|
| 1 | Visit every route in `routes.tsx` (30) via nav/route state | Each mounts a non-empty main region; no blank/white screen |
| 2 | Console + pageerror watch across the sweep | 0 renderer console errors / unhandled rejections (allow-list: none) |
| 3 | Data-bearing routes on fresh profile (Workflows, Flows, Data Sources, Instances, Reports*, Sessions, Run Artifacts) | Intentional empty-state UI; no fake/demo records |
| 4 | Toggle dark theme; re-screenshot Dashboard + Flow Designer + Settings + Licensing | `data-theme="dark"` applied; text nodes keep non-zero contrast styling (token check); toggle back |
| 5 | Resize 1280×800 → 1024×700 → 900×620 on Dashboard + Instances | `.app-shell` grid intact; no horizontal overflow of the shell |
| 6 | Keyboard: Tab through login screen and Settings page | Focus lands on interactive elements in order; focused element shows a computed outline/box-shadow (`:focus-visible` ring) |
| 7 | Screenshots per route (light) into the artifact dir | 30 PNGs for human review |
