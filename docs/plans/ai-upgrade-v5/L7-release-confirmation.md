# L7 — Packaging, Hardening & Release Confirmation

Shared rules, architecture and decisions: `ROADMAP.md`. Depends on L1–L6. Confirms — does not discover.

**Status (2026-09-26, latest): open.**
- **Why:** L7 depends on L1 to L6, and L4b and L6 are open. On this host, no runnable model meets both L1.8 and
  L4b's DX.
- **Stale artifacts:** the packaged artifacts below, built from `62aab2dc`, predate the `dc3d0c18` product change
  (R5's request and R4's number-screen fix). They were not rebuilt. A rebuild belongs after L4b's product state is
  final.
- **Its technical gates that do not need a package pass at the final state:** build, `typecheck:scripts`,
  `verify:runner`, `verify:mock-site`, `validate:offline`, `verify:source-hygiene`,
  `verify:verifier-classification` and `verify:licensing`.
- **External prerequisites, unchanged and not engineering:**
  - the clean-machine VM (an operator);
  - the licensed walkthrough (the issuer key's custodian);
  - the VS redistribution statement (the owner).

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

### `awkit-i6ot`: the app-local Visual C++ runtime (2026-09-25, owner decision: the VS redist folder)

- **Measured with the new `verify:native-dependencies`:**
  - **Scope:** every PE image in `dist/win-unpacked`, 46 in all: Electron 8, Chromium 17, Zvec 1, AI 20.
  - **"Ships with Windows"** means a System32 file validly signed *Microsoft Windows*. The Visual C++
    runtime this host installed globally is signed *Microsoft Windows Software Compatibility Publisher*,
    so it does not count.
  - **What is unresolved:** exactly `msvcp140.dll`, `vcruntime140.dll` and `vcruntime140_1.dll`. The
    earlier check truncated its list to 6 and hid the last one, and hid that the reflink addon also needs
    them.
  - **Loader-level reproduction:** with every name the host could supply from outside the tree rewritten
    to a decoy, `getLlama` fails with `NoBinaryFoundError`, and `reflink.node` fails with "module could
    not be found". Zvec, Electron and Chromium are self-sufficient.
- **The remedy:** `scripts/prepare-ai-native-host.mjs` copies the three DLLs beside every staged native
  binary (`9ced79c4`, `393452f9`, `420f2aad`, `ff817161`). The source rules:
  - Only a Visual Studio 2022 Community, Professional or Enterprise installation that has both the MSVC
    x64 tools and the VC redist component. Microsoft's Distributable Code list for VS 2022 covers those
    editions, not Build Tools.
  - The files must resolve inside that installation, never under `SystemRoot`.
  - Each must be x64, validly Microsoft-signed, and at least `max(14.40, newest linker)`.
  - Everything is checked before the output is replaced, so a refusal stages nothing and leaves an
    earlier staging intact.
  - The manifest records the files' versions, and the notices describe the runtime and cite the list.
- **On this host it refuses, correctly:**
  - VS 2022 Community has no C++ workload.
  - VS 18 Insiders is a prerelease.
  - VS 2019 BuildTools' CRT 14.29.30139 is below the 14.42 minimum.

  The owner authorized adding the VS 2022 C++ tools and redist on 2026-09-25. Until they are installed,
  and portable and NSIS are rebuilt and re-verified, `awkit-i6ot` stays open.
- **Re-checked after the owner reported the components installed (2026-09-25, later).** The session runs on
  the owner's own Windows host: profile `C:\Users\moham`, the same local review store as the earlier runs.
  - **The staging's own query:** `verify:ai-packaged-runtime` ran `prepare-ai-native-host.mjs`, whose
    vswhere call found no qualifying install. It refused with "vswhere reports no released Visual Studio
    2022 Community, Professional or Enterprise installation with
    Microsoft.VisualStudio.Component.VC.Tools.x86.x64 and Microsoft.VisualStudio.Component.VC.Redist.14.Latest".
    The result was 45/5, the same five failures as before.
  - **The installer's instance record** (`C:\ProgramData\Microsoft\VisualStudio\Packages\_Instances\62576ba5\state.json`,
    VS 2022 Community 17.14.5):
    - its selected C++ component is `Microsoft.VisualStudio.Component.VC.Tools.ARM`;
    - neither `…VC.Tools.x86.x64` nor `…VC.Redist.14.Latest` is selected;
    - the record's `updateDate` is 2025-06-12.
  - **On disk:**
    - `VC\Tools\MSVC\14.44.35207` exists, with an x64 linker;
    - `VC\Redist\MSVC\14.44.35112` holds only `onecore\arm` and `debug_nonredist\arm`: there is no
      `x64\Microsoft.VC143.CRT`;
    - the package cache holds no `Microsoft.VC.14.44.*.CRT.Redist.X64` package.
  - **The other instances still do not qualify:** VS 18 Insiders is a prerelease, and VS 2019 Build Tools
    (CRT 14.29.30139) is below the floor and outside the Distributable Code list.
  - **So the exact missing prerequisite** is the two components, added to VS 2022 Community with
    *Modify*: "MSVC v143 - VS 2022 C++ x64/x86 build tools (Latest)" and "C++ 2022 Redistributable
    Update". What is installed looks like the ARM build tools.
  - **Proof they are present:** `vswhere.exe -products * -requires
    Microsoft.VisualStudio.Component.VC.Tools.x86.x64 Microsoft.VisualStudio.Component.VC.Redist.14.Latest
    -property installationPath` prints the Community path. Today it prints nothing.
  - **Not checked:** the x64 DLLs' versions, signatures and source, because they are absent. Nothing was
    copied from System32, and no assertion was weakened.
  - **Not run:** the portable and NSIS rebuild, the manifest, `verify:native-dependencies` (its input, the
    stale `1e856706` package, is unchanged), `verify:ai-packaged-app`, and strict offline. The last package
    also predates R2 and R4.
- **Resolved on this host, and rebuilt (2026-09-25, latest).**
  - **The install:** the owner installed both components. The VS 2022 Community instance record was
    updated at 2026-09-25T16:10:45Z and lists `VC.Tools.x86.x64` and `VC.Redist.14.Latest`.
  - **The DLLs:** `VC\Redist\MSVC\14.44.35112\x64\Microsoft.VC143.CRT` holds `msvcp140.dll`,
    `vcruntime140.dll` and `vcruntime140_1.dll`. All three are file version 14.44.35211. The staging's
    own checks accepted each one: x64, a valid Microsoft Corporation signature, inside the VS install and
    never System32, and at least the 14.42 floor.
  - **One staging defect found and fixed (`176f8d5b`, red first at `0edccbba`).** The runtime was copied
    beside every native folder. That left an `msvcp140.dll` beside the reflink addon, which imports only
    `vcruntime140.dll`. Nothing there loads that file, and its own import `vcruntime140_1.dll` does not
    resolve. `verify:native-dependencies` failed on the first fresh package (`cb29a776`) for exactly that.
    - Staging now reads the imports, and puts runtime DLLs only where a binary loads them. That is all
      three beside `@node-llama-cpp/win-x64/bins/win-x64`, and `vcruntime140.dll` beside the reflink
      addon.
    - The new staged-tree check in `verify:ai-packaged-runtime` was red on the old staging and on that
      package.
  - **One harness defect found and fixed (`242d1df4`, red first).** The live determinism step compared
    two jobs with different random prompt nonces, so two different prompts. The pair now shares one
    nonce, and the step first asserts the two prompts are byte-identical.
  - **Second QC pass** (one read-only AI reviewer at `040407a4`; not a person's sign-off): PASS WITH
    FINDINGS, with no blocker and nothing major.
    - Fixed:
      - F1, the shipped notice wrongly said all three DLLs go into every native folder (`1d9244c6`);
      - F2 and F4, stale comments, and F3, silent skipping of old-style delay-load descriptors
        (`862dcb59`, not red first: no shipped binary has one);
      - F5 and F6, two display-gate evidence rules (`56d845b5`, red first).
    - Accepted: F7 and F8, nits.
    - **The reviewer's re-check of the fixes: PASS, all six RESOLVED,** from file reads.
    - New nit N1, accepted: the zero-import refusal would also refuse a resource-only DLL. None is staged
      today; the failure is safe.
  - **The final artifacts,** built from clean `62aab2dc` after those fixes (`dist/release-provenance.json`,
    treeDirty false). They supersede the pair built from `1fbd2178` (committed at `040407a4`):

    | Artifact | Bytes | SHA-256 |
    |---|---|---|
    | Portable `SpecterStudio 0.1.51.exe` | 243,160,364 | `11888cfbb2afe32e328257dcd398efabaca6bda867c16762d15257abd3e118f2` |
    | NSIS `SpecterStudio Setup 0.1.51.exe` | 272,026,668 | `f34a83e4112ea3e86676541ffbb335bf6b4a59a73b7ee96fba807129a7615030` |
    | Signed dependency manifest | — | `dc0532bb…`, Ed25519 `aa5b9dd8…`, committed at `c337b267` |

  - **The gates on them:**
    - `verify:native-dependencies` 14/0: every import of 50 PE images resolves. The loader proof loads
      the AI runtime and the reflink addon with the host's global Visual C++ runtime made unreachable.
    - `verify:ai-packaged-runtime` 104/0, the live harness 13/13 on the staged copy.
    - `verify:ai-packaged-app` 20/0: the pinned pack imported in 3 s, and a real explanation OK in 85 s in
      the packaged app's own host.
    - Strict `validate:offline` PASS, `verify:offline-supply-chain` 25/0, `verify:packaged-validation`
      119/0, `verify:packaged-runtime` 25/0.
    - `verify:nsis-per-user-install` 12/0, at `1fbd2178`: it reads only the install scripts, which are
      unchanged.
    - `verify:packaged-walkthrough` 42/0, with 1 BLOCKED: its licensed parts D–J need the issuer key.
      NSIS sha512 matches `latest.yml`, and the app made no non-loopback connection.
    - `verify:ai-assist-gui` 185/0 on the final build.
  - **What this does not prove:** it is the development host. Its global Visual C++ runtime is made
    unreachable only for the loader proof, which is not a clean machine.
  - **`awkit-i6ot` stays open.** Its acceptance also names the clean-machine VM loading the runtime from the
    installed package. That is NOT RUN, and needs an operator (runbook below).

### Clean-machine procedure for the local-AI runtime (operator; evidence required)

**Superseded on 2026-09-25 by `evidence/L7-clean-machine-procedure-0.1.51.md`**, which is self-contained. What
it adds to the runbook first written here:
- the portable EXE as well as the NSIS installer, each from a clean snapshot;
- five machine-qualification checks, where a failure means NOT RUN, not FAIL: no network; no global
  `msvcp140`/`vcruntime140_1`; no VC runtime registry key; nothing on `PATH`; the OS build;
- the signature and version of each app-local DLL;
- proof of which `*140*.dll` files the running app actually loaded, which must all come from the package;
- a real inference shown by the diagnostics' completed-job count;
- explicit PASS, FAIL, INCONCLUSIVE and NOT RUN rules.

The result goes in `awkit-i6ot` and here. PASS closes `awkit-i6ot` after the owner's review of the evidence.
**Status: NOT RUN** (it needs an operator).
- **Independent QC (2026-09-25, one AI QC reviewer agent, read-only, not a human sign-off):** QC-1..QC-7
  are re-verified with no regression, and provenance, the offline boundary and exit semantics PASS. It
  raised F1–F7, which are resolved at `420f2aad` and `0b581544`:
  - F1: the CPU backend must really register, and the by-path `ggml-cpu-*` rule;
  - F2: a 14.40 floor;
  - F3: refuse before replacing the output;
  - F4: the notices check is bound to its section;
  - F5: `node.exe` only as a delay-load import;
  - F7: the PE directory count and old-style delay-load descriptors.

  F6 was the cleanup crash, fixed at `37f9e62d`. F8, the signature check not pinning the root, is
  accepted on a trusted build host.

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
- **Licensed walkthrough, re-checked 2026-09-25 (latest) through the approved procedure:**
  - `verify:packaged-walkthrough` on the final artifacts gave 42/0 with 1 BLOCKED, because
    `AWKIT_PACKAGED_LICENSE_ISSUER_KEY` is not set in this session.
  - The key is deliberately not read from the issuer's default location
    (`scripts/helpers/packaged-license.mts`).
  - **The exact prerequisite:** an authorized validation machine or CI runner, where the operator sets
    `AWKIT_PACKAGED_LICENSE_ISSUER_KEY` to the absolute path of the offline issuer key under that machine's
    controlled custody, then runs `npm run verify:packaged-walkthrough`.
    - Only the path is set. The gate hands the path to `tools/license-issuer`, and strips it from the app's
      environment.
    - The key never goes into chat, the repository, an installer or a report.
  - Parts D–J then mint a 45-minute trial licence bound to that machine's fingerprint, and run the real
    workflows.

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
