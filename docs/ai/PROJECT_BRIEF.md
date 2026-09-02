# PROJECT_BRIEF — SpecterStudio

## Confirmed

- **What it is:** an offline-capable **Windows desktop application** for visually designing and
  running **Playwright** web UI automation. Built with Electron + React + TypeScript.
- **Product name:** **SpecterStudio** (the package and `electron-builder.json` use
  `SpecterStudio` / `com.specterstudio.app`; the preload API remains the compatibility contract
  `window.playwrightFlowStudio`).
- **Main goal:** let users build reusable **flows** (sequences of Playwright steps) and link them
  into **workflows**, bind runtime/JSON data, run isolated concurrent browser instances, and
  produce logs, screenshots, downloads, and reports — all runnable fully offline in production.
- **Core screens (renderer):** Dashboard, Workflows library, Workflow Builder, Flows library,
  Flow Designer, Form Designer, Recorder, Data Sources, Runtime Inputs, Instances, Run/Execution
  Monitor, Reports, Roadmap, Project Contract, Offline Runtime, Settings (see `app/renderer/routes.tsx`).
- **Main workflows:**
  1. Design a flow on the Flow Designer canvas (`@xyflow/react`), configure type-specific node
     properties, save as a JSON `FlowProfile`.
  2. Link saved flows into a `WorkflowProfile` in the Workflow Builder with typed connectors.
  3. Bind a JSON data source / runtime inputs.
  4. Run (optionally concurrent, data-driven) via the runner using the bundled Chromium.
  5. Review reports/logs/screenshots.
- **High-level modules:** Electron main (`app/main`), React renderer (`app/renderer`), and a
  framework-agnostic core under `src/` (runner, orchestrator, instances, profiles, data, offline,
  reports, storage, recorder).

## Inferred

- **Main users:** QA / automation engineers building authorized web-UI automation in
  locked-down, offline enterprise environments (no internet, no admin).
- It is a **single-user desktop tool**, not a web service or multi-tenant server.

## What this project is NOT

- Not a web/server application; not multi-tenant; no cloud backend.
- Not a general scraper — it is for **authorized** automation only (no CAPTCHA/MFA/bot-detection
  bypass; manual handoff is used for human-required steps).
- Does not require a server database. User-authored profiles and settings use JSON stores; durable
  execution/runtime history uses the versioned local SQLite-compatible `sql.js` store. Both remain
  under standard-user mutable data roots outside `resources` / `app.asar`.

## Unknown / Needs Verification

- Target end-user persona specifics and deployment scale are inferred, not documented.
- Whether the app has ever been run end-to-end on a clean offline Windows machine (the GUI
  walkthrough in `docs/OFFLINE_STANDALONE_PACKAGING.md` is still pending).
