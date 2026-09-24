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

### QC findings resolved (2026-09-24, Phase L closeout)

A QC review of the packaging raised seven findings. Each is fixed, and each is proven red-first by a
black-box check that runs the real script or validator (`verify:ai-packaged-runtime` sections A0, A1, E0
and F):

| # | Finding | Fix | Red first |
|---|---|---|---|
| QC-1 | `verify:ai-packaged-runtime` exited 0 with its packaged section NOT RUN or stale | `gateExitCode`: 1 FAIL, stale = FAIL, 2 NOT RUN (`93beb341`, `5b77cdd7`) | F's self-probe requires exit 2. Under the old exit expression it gives 0 (read from the code, not re-run) |
| QC-2 | `verify:ai-packaged-app` exited 0 when it never ran | NOT RUN exits 2 | F with an empty home requires exit 2. The old `notRun()` exited 0 (read from the code, not re-run) |
| QC-3 | staging checked only a package's own entry for a link | every source path must resolve to its own place inside the real repository; `--out` may not lead back in (`b162e825`) | 3 junction cases, red on the old script |
| QC-4 | the pin was a lazy regex from the first mention of the name | one frozen declaration, one `name`, one `build` of the pinned form, agreeing with `package.json`'s single exact pin, in the staging and in the validator (`b162e825`, `93beb341`) | 5 staging cases and 4 validator cases |
| QC-5 | strict validation compared counts | the staged inventory is compared with the signed list by path both ways; duplicates, case variants and links are refused (`93beb341`) | duplicate and case-variant entries hid an unlisted file |
| QC-6 | model-pack exclusion was read from lists and app diagnostics | `scripts/helpers/model-pack-scan.mts` reads every file of `dist/win-unpacked` and every `app.asar` member (name, GGUF magic, pinned pack size), in both packaged gates | 3 controls (renamed pack, `.gguf`, a pack inside an asar) |
| QC-7 | no dependency-license inventory | 111 distinct packages (130 directories), a redistribution review and the missing notices (llama.cpp, 5 packages with no license text) in `resources/THIRD_PARTY_NOTICES.md`, gated (`b2f8bf36`, `1e856706`) | 111 rows missing, 5 texts missing |

**Also found and fixed:** the strict validator aborted on a failing signature check instead of reporting it
(PS 5.1 stderr under `Stop`, `518e1c1b`).

**Found and open, `awkit-i6ot`:** a new PE-import check shows that the prebuilt ggml/llama binaries import
`MSVCP140.dll` and `VCRUNTIME140.dll`. The installer carries neither, so on a machine without the Visual
C++ runtime, local AI will fail to load. The fix needs an owner or licensing decision (see
`KNOWN_ISSUES.md`).

**Gates on fresh portable and NSIS from clean `1e856706`** (manifest pair `9469e69e`):

| Gate | Result |
|---|---|
| `verify:ai-packaged-runtime` | 95/2 FAIL: all QC checks pass, and both failures are `awkit-i6ot` |
| `verify:ai-packaged-app` | 20/0 (a real 0.8B inference in 67 s) |
| `validate:offline -- -Strict` · `verify:offline-supply-chain` · `verify:packaged-validation` · `verify:packaged-runtime` | PASS · 25/0 · 119/0 · 25/0 |

**Phase L closeout status of the sections below (2026-09-24):**
- L1, L3 and L5b are accepted (`DECISIONS.md`, latest). L4b waits on 15 human verdicts, and L6 is blocked by L4b.
- **Performance confirmation:** re-run with the final prompts, GO on all 8. See the section below.
- **Security review:** the engineering evidence review is done, and every mapped gate passes. No
  independent security sign-off is claimed. See the section below.
- **Thresholds:** T2 auto-promotion and automatic failure analysis are off, and no automatic caller exists.
  Promotion N, row diversity and the self-demotion threshold therefore stay provisional, and do not apply
  until a feature is enabled. The overhead threshold is L5a's, accepted as INCONCLUSIVE by the owner.
- **Licensed walkthrough parts:** BLOCKED on the issuer key. **Clean-machine VM:** NOT RUN; it needs an
  operator.

## Performance confirmation

Re-run the L1 harness with final prompts; compare to L1 budgets. Confirm: Recorder never waits; authoring UI responsive
during inference; AI yields to runs; idle unload; bounded queues; prompt cancellation; `<3s` runs make zero model
calls; failure-capture overhead within the committed threshold; ≤2 synthesis attempts; health sweep yields instantly.
No VMware throughput claims from dev hardware.

### Performance confirmation as run (2026-09-24, final prompts)

`npm run benchmark:ai-model-0-8b` ran on the qualifying host (i7-8750H, 12 logical CPUs, 4 inference
threads) with runtime `node-llama-cpp@3.21.1+llama.cpp@v0.4.0` and the pinned Qwen3.5-0.8B. It
re-measured the one scenario the final prompts had made stale: the locator request, changed by D1 A+B at
`2fd2c3f5`. Its two runs took 55.3 s and 58.3 s. The other six scenarios' fingerprints still match the
product's current requests. All 7 are current, and the decision is **GO on all 8** L1.8 criteria:

| Criterion | Measured | Ceiling |
|---|---|---|
| Cold load | 7,183 ms | 60,000 |
| Host memory | 1,100 MB | 6,144 |
| Locator upgrade at its cap | 113,514 ms | 180,000 |
| Failure analysis at its cap | 120,389 ms | 180,000 |
| Validation explanation at its cap | 83,345 ms | 120,000 |
| Cancel latency | 1,020 ms | 3,000 |
| Main-loop delay p99 | 30 ms | 100 |
| Playwright slowdown with yield | 0.99 | 1.15 |

Evidence: `evidence/L1.8-benchmark-full-host-Qwen3.5-0.8B-Q4_K_M.json`. The rest of the list above is
covered by gates re-run on the same day:

- **The Recorder never waits, and a run of under 3 s makes zero model calls.** No module the execution tree
  can reach touches the model: `verify:ai-fallback` 38/0.
- **Queue and lifecycle** — the queue is bounded, one inference runs at a time, work yields to runs and
  resumes after them, the model unloads when idle, and a prompt can be cancelled: `verify:ai-adapter` 117/0.
- **At most 2 synthesis attempts:** `verify:ai-locator-attempts` 191/191.
- **The health sweep yields:** it is held by any active or queued run (`verify:ai-locator-sweep` 64/64). It
  has no production caller.
- **Failure-capture overhead:** L5a's gate, which the owner accepted as INCONCLUSIVE.

This is the development host, not a VMware claim.

## Security review

Prompt injection from page text; redaction and personal-data masking; protected-login exclusion; process/renderer
boundaries; local transport; model-pack path traversal/tampering; checksum handling; permission defaults per role
(Administrator denylist); report/log leakage; T3 unreachability; revert integrity; pending candidates never executed.

### Security review — engineering evidence (2026-09-24)

The implementing agent mapped each item to a gate re-run at the final state. **This is an evidence
review, not an independent security sign-off.** The project allows no reviewer subagent unless the owner
asks for one, and an implementer's approval is not QC.

| Item | Evidence (all PASS at `5b77cdd7`–`a65bdf4c`) |
|---|---|
| Prompt injection from page text | `verify:ai-redaction` 52/0: a forged delimiter does not survive, and untrusted text never reaches the system message. The live harness on the packaged runtime shows instructions inside page data cannot escape the schema, and special-token text is plain text. `verify:ai-host` checks that page text is never parsed for special tokens. |
| Redaction and personal-data masking | `verify:ai-redaction`: credentials, tokens, JWT, email, account numbers, token URLs and profile paths are masked before the host, and a residual secret is refused. `verify:ai-authoring` §1: no step name, typed value or locator value reaches a prompt. |
| Protected-login exclusion | `verify:ai-locator-attempts` §7: a protected-login surface ends the job. `verify:ai-locator-upgrade`: a protected-login step is refused as T3. |
| Process and renderer boundaries | `verify:ai-fallback`: the renderer cannot run a prompt, and no `ai:` channel can spawn a process or name a file. `verify:ai-host-electron` 26/0: the runtime stays out of the main process. |
| Local transport | `verify:ai-host` 135/0 with 12/12 mutations: the host requires only `node:fs` and `node:path`, and has no listener, socket, HTTP, child process or worker. |
| Model-pack path traversal and tampering; checksum handling | `verify:ai-host`: out-of-root paths, traversal, NUL bytes and junction escapes are refused. `verify:ai-model-pack` 46/0: format, size and checksum refusals, and tamper, truncate or delete caught at load. `verify:ai-packaged-app`: the import lands in the writable profile, never in `resources`. |
| Permission defaults per role (Administrator denylist) | `verify:ai-permissions` 99/0: every role in both directions, re-auth only for AI management, and every `ai:` channel authorizes before it acts. |
| Report and log leakage | `verify:ai-redaction`: logs carry codes only. The review store refuses a surviving secret (`verify:ai-authoring`). No leak on L5's labelled set (`verify:ai-error-analysis` 429/429). |
| T3 unreachability | `verify:ai-autonomy-policy` 62/0 over 968 combinations. |
| Revert integrity | `verify:ai-audit-revert` 69/0; `verify:ai-locator-upgrade` 78/0 (exact revert, STALE refused). |
| Pending candidates never executed | `verify:ai-locator-attempts` §15; `verify:ai-locator-upgrade` (a pending candidate changes nothing). |
| Packaging supply chain | The QC-3/QC-4 staging refusals, the QC-6 model scan and the QC-7 license review above; `verify:offline-supply-chain` 25/0. |

**Open from the security side:** `awkit-i6ot`, the MSVC runtime, is an availability and packaging issue,
not a confidentiality one. KNOWN_ISSUES keeps one limit: the host's `hello` reports "compatible" from
package metadata alone.

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
