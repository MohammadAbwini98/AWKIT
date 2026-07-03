# Phase 10 — Implementation Roadmap

## Phase A — Desktop Foundation

Deliver Electron, React, routing, app shell, runtime path resolver, and local folders under user profile.

Acceptance: app opens on Windows and does not require admin permission for runtime folders.

## Phase B — Flow Designer MVP

Deliver React Flow canvas, node palette, node properties, connectors, save/load flow JSON, and basic nodes.

Acceptance: user can create and reload a simple login flow.

## Phase C — Generic Playwright Runner

Deliver Playwright runner, flow executor, step executor, locator factory, value resolver, screenshots, and logs.

Acceptance: saved flow runs without custom scenario-specific code.

## Phase D — Data Binding

Deliver JSON data source manager, runtime input panel, data binding editor, fill from JSON, dropdown from runtime UI, generated values, and current-row support.

Acceptance: same flow runs with different JSON/runtime values.

## Phase E — Scenario Builder

Deliver scenario builder, flow linking, flow order, required/optional flows, failure policy, and output passing.

Acceptance: Login → Create Customer → Validate Customer → Logout runs in configured order.

## Phase F — Concurrent UI Automation Instances

Deliver instance manager, instance pool, concurrent execution coordinator, browser process manager, lock manager, isolated contexts, per-instance logs/screenshots/downloads, and instance monitor UI.

Acceptance: user can run the same scenario in 5 isolated concurrent UI automation instances.

## Phase G — Data-Driven Concurrent Runs

Deliver JSON array data source, one row per instance, queue when rows exceed concurrency limit, per-row report, and retry failed rows.

Acceptance: user can run onboarding for every row in `customers.json` with max 5 parallel instances.

## Phase H — Advanced Flow Control

Deliver conditional connectors, failure connectors, manual approval connectors, loops, run another flow node, and manual handoff.

Acceptance: scenario can branch, and manual handoff pauses only one instance.

## Phase I — Reporting & Stability

Deliver run history, concurrent run summary, instance report, step timeline, screenshot gallery, export report, retry policies, and validation.

Acceptance: every run produces clear logs, screenshots, and report details.

## Phase J — Offline Standalone Packaging

Deliver offline packaging scripts, bundled Chromium, bundled dependencies, portable package, per-user installer, dependency manifest, offline runtime validator, and startup check.

Acceptance: app runs on production Windows machine with no internet, no `npm install`, no global Node/Playwright/Chromium, and no admin permission.

## Phase K — Recorder Mode

Deliver browser action recorder, locator suggestions, action-to-node conversion, and editable recorded flows.

Acceptance: user records a flow and saves it as editable nodes.
