# L7 — Packaging, Hardening & Release Confirmation

Shared rules, architecture and decisions: `ROADMAP.md`. Depends on L1–L6. Confirms — does not discover.

## Packaging

Installer carries the pinned runtime and integration only; model pack separate, imported and checksum-verified;
missing model is a supported state; mutable state outside `resources`/`app.asar`; no download/telemetry/cloud.

### Packaging as built (2026-09-24, contract `awkit-djnl-10-ai-runtime-packaging-0924`)

Before this, the installer did **not** carry the runtime. `node-llama-cpp` is a dev dependency,
`electron-builder.json` shipped only `native-hosts/zvec`, and nothing staged `native-hosts/ai`, so a packaged
build could never run AI (the L1 decision record's "no packaged AI gate has run").

- **Staging:** `scripts/prepare-ai-native-host.mjs` (`npm run prepare:ai-host`, run by both package
  pipelines before the manifest) copies `ai-host.cjs`, `node-llama-cpp` 3.21.1, the CPU-only
  `@node-llama-cpp/win-x64` prebuilt and the declared runtime dependency closure (130 packages, 1,461 files,
  50.7 MB) into `build/native-hosts/ai`, each at its own `node_modules` place. It never downloads or builds.
  It refuses symlinks, escapes, GPU and foreign prebuilts, and a locally built binary. It excludes the
  llama.cpp source bundle, CLI templates, type declarations, source maps, import libraries and dotfiles.
  The runtime build must equal `AI_RUNTIME_PIN.build`.
- **Shipping:** `electron-builder.json` ships it as `resources/native-hosts/ai`. `aiRuntime.ts` already
  resolved that path, and no product code changed. The signed dependency manifest records it as `aiRuntime`
  (every file's SHA-256, `modelPackBundled: false`). A strict `validate:offline` without it FAILS, and every
  file is checksum-verified.
- **Size:** the portable EXE is 242,967,860 bytes (was 237,009,238). The NSIS installer is 271,754,055
  bytes (was 264,089,214).
- **Gates, on fresh portable + NSIS from clean `bafb05e3`:**

| Gate | Result |
|---|---|
| `verify:ai-packaged-runtime` (staged into a temp dir outside the repo; isolated load with two negative controls; handshake; live harness on the staged copy; the same on `dist/win-unpacked`) | 66/0 |
| `verify:ai-packaged-app` (the real packaged EXE, fresh profile: runtime found, no pack bundled, import through the app, a real 0.8B inference in 73 s, the test provider ignored) | 19/0 |
| `validate:offline -- -Strict` · `verify:offline-supply-chain` · `verify:packaged-validation` · `verify:packaged-runtime` | PASS (1,461/1,461 AI assets) · 25/0 · 119/0 · 25/0 |

- **Found by the packaged layer:** electron-builder silently dropped `chmodrp/.gitkeep`, so the first
  package's signed manifest listed a file the installer did not carry. Fixed at `e8f99c3f`.
- **Not done here, and L7 is not accepted:** the performance confirmation, the security review, the quality
  and autonomy gates below, the packaged walkthrough and the clean-machine VM. L7 still depends on L1–L6
  acceptance.

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
