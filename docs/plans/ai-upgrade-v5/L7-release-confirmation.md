# L7 — Packaging, Hardening & Release Confirmation

Shared rules, architecture and decisions: `ROADMAP.md`. Depends on L1–L6. Confirms — does not discover.

## Packaging

Installer carries the pinned runtime and integration only; model pack separate, imported and checksum-verified;
missing model is a supported state; mutable state outside `resources`/`app.asar`; no download/telemetry/cloud.

## Performance confirmation

Re-run the L1 harness with final prompts; compare to L1 budgets. Confirm: Recorder never waits; authoring UI responsive
during inference; AI yields to runs; idle unload; bounded queues; prompt cancellation; `<3s` runs make zero model
calls; failure-capture overhead within the committed threshold; ≤2 synthesis attempts; health sweep yields instantly.
No VMware throughput claims from dev hardware.

## Security review

Prompt injection from page text; redaction and personal-data masking; protected-login exclusion; process/renderer
boundaries; local transport; model-pack path traversal/tampering; checksum handling; permission defaults per role
(Administrator denylist); report/log leakage; T3 unreachability; revert integrity; pending candidates never executed.

## Quality & autonomy gates

Per feature: case count, metric, result, target, PASS/FAIL, model/runtime version. Commit final values for: promotion
N and data-row diversity, self-demotion revert threshold, coalescing caps, overhead threshold. Live-model gates
`NOT RUN` without the pack are not release evidence.

## Verification

`npm run build`, `npm run typecheck:scripts`, `npm run verify:runner`, `npm run verify:mock-site`,
`npm run verify:source-hygiene`, `npm run verify:verifier-classification`, `npm run verify:roadmap-dashboard`,
`npm run validate:offline`, `git diff --check`, plus every L1–L6 verifier and affected existing gates. Packaged and
live gates only when prerequisites exist; otherwise `BLOCKED`/`NOT RUN`.

## Final acceptance

All ROADMAP stability guarantees hold; quality and autonomy thresholds committed and met; offline and security gates
pass; profile/report compatibility passes; sources agree; work committed to `main` or push blocker recorded.
