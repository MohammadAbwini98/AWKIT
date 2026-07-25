# AWKIT Zvec — Blocker Resolution and Production Implementation Plan

**Repository:** `MohammadAbwini98/AWKIT`  
**Target:** Windows x64, Electron 33, offline, non-admin  
**Status:** Solution derived from Phase 0 and Phase 0B evidence  
**Decision:** Zvec must run in a raw, unbundled Electron utility-process host

---

## 1. Executive Decision

The Phase 0B output changes the implementation approach in one important way:

> Do not import or call Zvec from code bundled into AWKIT’s electron-vite main chunk.

The observed test result was:

- Zvec loaded and completed the operations suite under Electron’s bundled Node runtime.
- Raw, unbundled Zvec caller code also completed the operations suite in packaged Electron application mode.
- A caller bundled by electron-vite caused a hard crash at the first collection operation.
- A utility-process crash was contained and did not terminate AWKIT.
- Utility placement kept the main-process memory increase very small and had no measured performance disadvantage in the recorded single-run comparison.

Therefore, production placement is:

```text
Electron main process
        │
        │ narrow request/response protocol
        ▼
Electron utility process
        │
        │ raw, unbundled CommonJS host
        ▼
@zvec/zvec + Windows x64 .node binding
        │
        ▼
%LOCALAPPDATA%\SpecterStudio\semantic-index
```

Zvec remains optional, derived, rebuildable, and non-authoritative.

---

## 2. Review of Claude Code’s Output

## 2.1 Findings accepted as strong evidence

The output provides credible evidence for:

1. The Windows x64 Zvec binding is usable with Electron 33.4.11’s bundled Node 20.18.3 / N-API runtime.
2. The Zvec operations tested include collection creation, inserts, FTS, Jieba tokenization, vector query, update, upsert, delete, close/reopen, restart persistence, and abrupt-termination recovery.
3. The native binary and dictionary assets can be copied into an AWKIT-generated package outside ASAR.
4. Electron application mode works through the packaged SpecterStudio executable in the interactive session.
5. A raw unbundled caller works in real packaged Electron application mode.
6. A bundled caller crashed during the first collection operation.
7. Utility-process failure containment works: the utility process can abort while the AWKIT host remains alive.
8. The tested portable package did not require elevation and did not produce a Defender or SmartScreen warning in that one environment.
9. The produced packages were reduced spike packages, not complete AWKIT offline packages.

## 2.2 Claims that must remain qualified

The following are not fully proven yet:

- The exact technical mechanism by which bundling causes the native crash.
- Full production package success with bundled Chromium and every existing vendor resource.
- NSIS install, application launch, uninstall, and SmartScreen behavior.
- Repeated main-versus-utility percentile benchmarks.
- Coexistence with representative Playwright workload.
- Production shutdown p95/p99 behavior.
- Antivirus behavior outside the tested Windows environment.
- Upgrade behavior across Zvec or Electron version changes.

The solution below avoids depending on the unknown crash mechanism by making the native host unbundled by construction.

---

## 3. Blocker Matrix

| Blocker | Root cause / current evidence | Production solution | Verification |
|---|---|---|---|
| Bundled Zvec caller hard-crashes | Observed when the caller was included in electron-vite output; raw caller passed | Ship a raw CommonJS utility-process entry file as an external resource; never bundle it | Build inspection plus real packaged CRUD test |
| Main-process crash blast radius | Native abort in main terminates AWKIT | Utility process is the only approved native host | Forced `process.abort()` test; main remains usable |
| Main memory growth | Recorded main placement grew about 60 MB; utility placement left main nearly unchanged | Keep native engine and indexes in utility process | Process-specific RSS benchmark |
| Bare `electron.exe script` hangs | Environment-specific launcher behavior | Test through the actual packaged AWKIT app or the packaged utility host, not bare script launch | Real packaged executable verifier |
| Full offline bundle absent | Spike worktree lacked bundled Chromium/vendor payload | Stage normal offline dependencies, regenerate manifest, then build full portable and NSIS packages | Strict `validate:offline` and live package startup |
| NSIS tests not executed | Installer path not completed | Run real per-user non-elevated install/launch/relaunch/uninstall matrix | Recorded installer test |
| SmartScreen cannot be generalized | One unsigned/reputation state on one machine | Sign production EXE and installer; record rather than bypass endpoint protection | Authenticode and SmartScreen test |
| Existing 2-second shutdown budget crowded | Settings, Oracle, and security already share the budget; Zvec close measured around 630–690 ms once | Give the semantic utility host a separate bounded graceful-close stage followed by termination | Repeated shutdown measurements and forced timeout |
| Optional dependency may be pruned | Windows binding is an optional dependency | Install with optional dependencies; explicitly package and validate the binding | Negative package with binding removed must fail |
| Native asset can be put inside ASAR | `.node` requires real filesystem loading; dictionaries need adjacent resolution | Put complete Zvec package tree in `app.asar.unpacked` or an explicit `extraResources` native-host directory | Package tree inspection and live load |
| Vite may transform host path/code | The problematic caller was bundled | Entry file is copied byte-for-byte after build; utility process launches absolute unpacked path | Hash source host against packaged host |
| Index may write to package resources | Native default paths could be relative to CWD | Main computes an approved absolute runtime path; host independently confines it | Read-only/package-path negative tests |
| Index can become stale | Derived store receives asynchronous updates | Source hashes, generation metadata, incremental events, and reconciliation/rebuild | Delete/update/reconcile tests |
| Zvec failure could affect workflow run | Indexing integration could be accidentally awaited | Fire-and-observe indexing after authoritative persistence; never place in execution success path | Inject unavailable/crashed host during runs |
| Utility process could restart-loop | Native or corrupt collection may repeatedly crash | Bounded restart policy with circuit breaker and degraded state | Crash-window verifier |
| Collection corruption | Power loss, disk error, incompatible schema | Generation directories, quarantine, and rebuild; never overwrite active generation during rebuild | Corruption and interrupted rebuild tests |
| Secrets could enter index | Failures, locators, and page text can be sensitive | Central redactor and policy validator before messages enter the host | Hostile secret corpus |
| Native package upgrade regression | Electron/Zvec package changes can alter ABI/behavior | Pin exact package; compatibility gate on every Electron or Zvec change | CI/package matrix |
| Package size growth | Zvec native binary is significant; full Chromium also large | Measure compressed/uncompressed delta; do not duplicate package trees | Full-bundle size report |

---

## 4. Final Target Architecture

## 4.1 Process boundaries

```mermaid
flowchart LR
    R[React Renderer] -->|restricted preload methods| P[Preload]
    P -->|validated IPC| M[Electron Main]
    M -->|internal typed protocol| H[ZvecUtilityHostManager]
    H -->|utilityProcess.fork| U[Raw Zvec Utility Host]
    U --> Z[@zvec/zvec native binding]
    Z --> D[(Semantic index generations)]
    M --> A[Authoritative AWKIT stores]
```

Rules:

- Renderer never communicates directly with the utility process.
- Renderer never sees filesystem paths, native errors, or vectors.
- Main process performs sender validation, authorization, request bounding, source lookup, and redaction.
- Utility process owns Zvec collection handles.
- Exactly one utility host owns the writable collection.
- AWKIT authoritative stores are never opened or modified by the utility process.
- Zvec is lazy-started only when an approved semantic operation requires it.
- Normal AWKIT startup remains independent from Zvec availability.

---

## 4.2 Raw unbundled host

Recommended source:

```text
native-hosts/zvec/zvec-host.cjs
```

Recommended packaged destination:

```text
resources/native-hosts/zvec/zvec-host.cjs
resources/native-hosts/zvec/node_modules/@zvec/zvec/...
resources/native-hosts/zvec/node_modules/@zvec/bindings-win32-x64/...
resources/native-hosts/zvec/node_modules/bindings/...
```

Alternative accepted destination:

```text
resources/app.asar.unpacked/node_modules/@zvec/...
```

The explicit native-host directory is preferred because:

- it makes the raw/non-bundled boundary visible;
- it prevents accidental Vite inclusion;
- it simplifies path and hash validation;
- it allows the utility host and native dependencies to be versioned as one unit;
- it reduces dependence on ASAR’s virtual module-resolution behavior.

The host should be CommonJS (`.cjs`) and load Zvec using `require()` from its own packaged module root.

Do not:

- import the host from `app/main` as a normal TypeScript module;
- add it as a Rollup/electron-vite input;
- transpile it with Vite;
- bundle it into a chunk;
- copy it into the renderer;
- expose it as an executable command or listening service.

---

## 5. Utility Host Protocol

## 5.1 Message contract

Use versioned discriminated messages:

```typescript
type ZvecHostRequest =
  | { version: 1; id: string; type: "hello"; expected: HostCompatibility }
  | { version: 1; id: string; type: "open"; generation: string; path: string; schema: SafeSchema }
  | { version: 1; id: string; type: "upsert"; collectionId: string; docs: SafeDocument[] }
  | { version: 1; id: string; type: "delete"; collectionId: string; ids: string[] }
  | { version: 1; id: string; type: "query"; collectionId: string; query: SafeQuery }
  | { version: 1; id: string; type: "stats"; collectionId: string }
  | { version: 1; id: string; type: "optimize"; collectionId: string }
  | { version: 1; id: string; type: "close"; collectionId: string }
  | { version: 1; id: string; type: "shutdown" };
```

Response:

```typescript
type ZvecHostResponse =
  | { version: 1; id: string; ok: true; value?: unknown }
  | { version: 1; id: string; ok: false; reason: SafeReasonCode; retryable: boolean };
```

Events:

```typescript
type ZvecHostEvent =
  | { version: 1; type: "ready"; versions: HostVersions }
  | { version: 1; type: "health"; stats: HostHealth }
  | { version: 1; type: "fatal"; reason: SafeReasonCode };
```

## 5.2 Communication

Use Electron utility-process messaging:

- `utilityProcess.fork()` after `app.whenReady()`.
- `UtilityProcess.postMessage()` and `process.parentPort`.
- Optionally transfer a `MessagePortMain` for the long-lived request channel.
- Main holds a pending-request map by request ID.
- Every request has a deadline and `AbortSignal` integration.
- Unknown messages are rejected.
- Payloads are schema-validated before use.
- Raw Zvec filter expressions are never accepted from renderer requests.

## 5.3 Timeouts

Initial safe defaults, subject to benchmarks:

| Operation | Timeout |
|---|---:|
| Host spawn and ready handshake | 10 seconds |
| Open small existing collection | 15 seconds |
| Search query | 5 seconds |
| Normal incremental batch | 15 seconds |
| Close collection | 2 seconds |
| Graceful host shutdown | 2 seconds |
| Full rebuild/optimize | Operation-specific, cancellable, progress-based |

A timeout cancels the request at the manager level. It must not automatically kill the host unless health checks also fail or the operation violates its hard deadline.

---

## 6. Host Lifecycle and Crash Recovery

## 6.1 State machine

```text
disabled
  → stopped
  → starting
  → ready
  → degraded
  → stopping
  → stopped
  → failed-open
```

## 6.2 Startup handshake

The host reports:

- protocol version;
- Zvec package version;
- binding package version;
- Electron/Node/N-API versions;
- platform and architecture;
- dictionary path status;
- native-host source hash;
- native binary hash.

Main compares those values to the dependency manifest.

Mismatch means:

```text
SEMANTIC_NATIVE_INCOMPATIBLE
```

AWKIT continues without semantic features.

## 6.3 Restart policy

Use a bounded crash window:

- first unexpected exit: restart lazily on next operation;
- second exit within 5 minutes: one automatic restart after short delay;
- third exit within 5 minutes: open circuit for the session;
- corrupt-generation signature: do not reopen the same generation; quarantine it;
- user may run health check or rebuild after the circuit is open.

Never restart continuously.

## 6.4 Pending requests on crash

On utility exit:

- reject all pending requests with `SEMANTIC_HOST_EXITED`;
- mark retryability based on operation type;
- never blindly retry mutation requests unless idempotency is proven by deterministic document IDs;
- schedule reconciliation after recovery;
- preserve normal AWKIT operation.

---

## 7. Collection and Generation Design

## 7.1 Runtime directory

Add:

```text
%LOCALAPPDATA%\SpecterStudio\semantic-index\
```

Suggested layout:

```text
semantic-index\
  metadata.json
  active-generation.json
  generations\
    gen-000001\
    gen-000002\
  rebuild\
    rebuild-state.json
  quarantine\
  logs\
```

The Zvec host receives only generation paths already resolved by the main process.

It independently verifies:

```text
resolvedPath is inside semantic-index\generations\
```

## 7.2 Generation switching

A rebuild must not modify the active generation.

Procedure:

1. Create `gen-<new-id>`.
2. Open and populate the new collection.
3. Close it.
4. Reopen read-only and run health/sample queries.
5. Atomically replace `active-generation.json`.
6. Close old generation if open.
7. Open the new generation.
8. Retain old generation for rollback.
9. Delete old generation after retention and no open handle.

## 7.3 Incremental writes

- Main creates sanitized semantic documents.
- Mutations enter a serial queue.
- Coalesce multiple saves for the same deterministic document ID.
- Upsert in bounded batches.
- Persist catalog/source hashes outside Zvec or as safe fields.
- Schedule reconciliation after a failed or ambiguous mutation.

---

## 8. Build and Bundling Solution

## 8.1 electron-vite

The native host is not part of electron-vite inputs.

The current main and preload builds may continue using dependency externalization. Add an explicit safeguard:

- `@zvec/zvec`
- `@zvec/bindings-win32-x64`
- `bindings`

must be external if any production TypeScript accidentally references them.

Add a build-time verifier that fails if:

- generated `out/main/**/*.js` contains `ZVecCreateAndOpen`;
- generated chunks contain the native-host implementation;
- a direct `@zvec/zvec` import exists outside approved host/test files.

A simple source scanner plus output scanner is sufficient.

## 8.2 electron-builder

Recommended production strategy:

1. Keep Zvec in `dependencies`, not `devDependencies`.
2. Pin exact versions.
3. Stage a dedicated native-host directory before packaging.
4. Include it with `extraResources`.
5. Ensure `.node` and dictionaries are normal unpacked files.
6. Hash the staged tree.
7. Do not build Zvec from source on the target machine.

Illustrative configuration:

```json
{
  "extraResources": [
    {
      "from": "build/native-hosts/zvec",
      "to": "native-hosts/zvec",
      "filter": ["**/*"]
    }
  ],
  "buildDependenciesFromSource": false
}
```

Because electron-builder rebuilds native dependencies by default, Phase 1 must make an explicit decision after testing:

- Prefer the published prebuilt Zvec Windows x64 binding.
- Set `npmRebuild: false` only if the full clean build proves the prebuilt package works consistently and the staged native-host tree is produced before packaging.
- Otherwise retain rebuild behavior only on the development/build machine, never the end-user machine.

Do not silently accept a source compilation fallback. The package-preparation script should fail if a prebuilt binding is absent.

## 8.3 Staging script

Add:

```text
scripts/prepare-zvec-native-host.mjs
```

Responsibilities:

- locate exact installed packages;
- verify platform `win32`, architecture `x64`;
- verify versions match;
- copy the raw host file;
- copy only required production files;
- preserve adjacency of binding and dictionaries;
- calculate SHA-256 and sizes;
- write `zvec-native-host-manifest.json`;
- reject symlinks/path escapes;
- reject missing optional binding;
- reject unexpected source-build output;
- never download.

Output:

```text
build/native-hosts/zvec/
```

This generated folder should be ignored by Git.

---

## 9. Offline Manifest and Startup Validation

Extend the dependency manifest with an optional semantic-native section:

```typescript
interface SemanticNativeManifest {
  enabled: boolean;
  requiredForAppStartup: false;
  hostProtocolVersion: number;
  zvecVersion: string;
  bindingVersion: string;
  platform: "win32";
  arch: "x64";
  assets: Array<{
    relativePath: string;
    size: number;
    sha256: string;
  }>;
}
```

Mandatory assets when the feature is included:

```text
native-hosts/zvec/zvec-host.cjs
native-hosts/zvec/zvec-native-host-manifest.json
native-hosts/zvec/.../zvec_node_binding.node
native-hosts/zvec/.../jieba.dict.utf8
native-hosts/zvec/.../hmm_model.utf8
```

Important startup behavior:

- Existing Chromium/sql.js/Oracle startup gates remain unchanged.
- A broken optional Zvec bundle does not prevent AWKIT startup.
- It disables semantic capabilities and records an actionable degraded status.
- Packaging/release validation still fails when the build claims Zvec is included but its assets are missing or mismatched.

This distinction prevents a secondary optional subsystem from taking down AWKIT while preserving truthful release validation.

---

## 10. Full Offline Bundle Blocker

The reduced spike packages cannot close this gate.

Resolution procedure:

1. On the authorized development machine, restore/install exact lockfile dependencies including optional dependencies.
2. Run AWKIT’s normal offline preparation to stage Chromium and vendor assets.
3. Run `prepare-zvec-native-host`.
4. Generate the dependency manifest including both existing assets and Zvec assets.
5. Run strict offline validation.
6. Build unpacked directory.
7. Inspect the full package tree.
8. Build portable.
9. Build NSIS.
10. Disconnect network or use the existing no-egress validation environment.
11. Launch portable and installed builds.
12. Execute the host health and operations verifier.
13. Tamper with one Zvec asset and prove strict validation fails.
14. Restore assets and regenerate the clean package.
15. Report full package-size delta.

Do not treat a reduced package as a production candidate.

---

## 11. NSIS and Windows Security Blockers

## 11.1 Installer validation

Run using a standard, non-elevated Windows account:

- install to per-user location;
- verify no UAC prompt;
- launch;
- run semantic host health/CRUD;
- close/relaunch;
- uninstall;
- verify app binaries removed;
- verify `%LOCALAPPDATA%\SpecterStudio` remains unless the product explicitly offers user-data deletion;
- verify no native host process remains.

## 11.2 SmartScreen and signing

One machine showing no prompt is useful but not universal proof.

Production solution:

- Authenticode-sign the application executable and NSIS installer.
- Timestamp signatures.
- Verify signatures after packaging.
- Prefer an organization-approved trusted signing service/certificate.
- Consider signing the staged `.node` file only after legal/security review; do not casually re-sign third-party native code.
- Preserve original vendor hash in the build provenance even if enterprise signing changes the packaged hash.
- Never programmatically bypass SmartScreen or endpoint protection.
- Provide hashes to enterprise deployment teams for allow-listing where necessary.

---

## 12. Shutdown Solution

Do not add semantic close to the existing shared 2-second race.

Use staged shutdown:

```text
Stage 1 — semantic utility host
  send shutdown
  close collections and flush queue
  wait up to 2,000 ms
  kill utility process if still alive
  wait up to 250 ms for exit

Stage 2 — existing AWKIT services
  settings flush + Oracle dispose + security dispose
  retain their existing 2,000 ms bounded parallel stage

Overall hard cap
  approximately 4,500 ms, including transition overhead
```

Implementation requirements:

- one re-entrancy guard;
- semantic failure cannot prevent Stage 2;
- forced kill after grace window;
- record whether shutdown was graceful;
- on next startup, reconcile if the prior shutdown was forced;
- do not call `app.quit()` until both bounded stages finish or the overall cap expires.

The 2-second semantic grace is intentionally conservative until repeated close-duration percentiles are available.

---

## 13. Performance and Coexistence Blocker

The single recorded comparison is enough to choose safe placement, not enough to approve performance.

Required benchmark:

- 10 cold host starts;
- 30 warm operation suites;
- at least 1,000 FTS queries;
- vector fixture queries;
- bounded insert batches;
- p50/p95/p99;
- utility and total RSS;
- CPU;
- main event-loop delay;
- shutdown p50/p95/p99.

Playwright coexistence:

1. Run a stable local mock-site workflow.
2. Measure baseline.
3. Repeat with FTS queries.
4. Repeat with incremental upserts.
5. Repeat during rebuild throttled by current resource status.
6. Confirm no profile locks, browser slots, or origin/account claims are affected.
7. Confirm Zvec crash or timeout does not fail the workflow.

Acceptance should focus on no meaningful workflow regression and no event-loop degradation, not only raw Zvec speed.

---

## 14. Security and Authorization Solution

Proposed permissions following AWKIT’s dot-case convention:

```text
semantic.search
semantic.failure.view
semantic.index.manage
semantic.embedding.manage
semantic.diagnostics.export
```

Role proposal:

- Viewer: `semantic.search` for workflow/flow/documentation results only.
- Operator: Viewer plus permitted failure similarity.
- Administrator: search, failure view, index management, diagnostics.
- Super User: all semantic permissions including embedding management.

Recommended sensitive permissions:

```text
semantic.index.manage
semantic.embedding.manage
semantic.diagnostics.export
```

Require fresh reauthentication for:

- clear index;
- full rebuild if it can delete/swap generations;
- change embedding/model paths;
- export native diagnostics or physical paths.

Search itself should not require reauthentication.

---

## 15. Temporary Spike Code Cleanup

Before any merge:

Remove:

- env-gated spike hook from production `main.ts`;
- spike launch batch files;
- raw diagnostic logs;
- temporary package overrides;
- crash-injection paths not behind test-only build boundaries;
- reduced package artifacts.

Retain or rewrite as production components:

- validated raw utility host;
- native-host staging script;
- package verifier;
- negative-case tests;
- compatibility report;
- architecture decision;
- safe crash-injection only in dedicated test fixture/build.

No Phase 0 spike hook should remain in a normal release executable.

---

## 16. Implementation Sequence

## Phase 0C — Close remaining release-environment gates

Scope:

- full Chromium/vendor offline bundle;
- full manifest;
- full portable;
- full NSIS;
- non-admin installation;
- live full-package utility host;
- SmartScreen/Defender observation;
- negative packaged cases;
- repeated benchmarks;
- Playwright coexistence.

Output:

```text
GO / GO WITH CONDITIONS / NO-GO
```

No product semantic UI or indexing yet.

## Phase 1A — Production native-host foundation

Implement:

- raw `zvec-host.cjs`;
- `ZvecUtilityHostManager`;
- protocol contracts;
- path confinement;
- lifecycle and circuit breaker;
- native-host staging;
- packaging and manifest;
- health/status;
- shutdown stage;
- verifier suite.

No semantic documents or renderer UI.

## Phase 1B — Vendor-neutral semantic store

Implement:

- `SemanticStore` interface;
- Zvec adapter in the utility host boundary;
- in-memory fake;
- generation manager;
- mutation queue;
- metadata;
- redactor;
- policy validator.

No embeddings.

## Phase 2 — FTS-only product capability

Implement:

- workflow/flow/documentation projections;
- rebuild/reconciliation;
- authorized search IPC;
- global search UI;
- index administration UI.

## Phase 3 — Failure memory

Implement masked failure projections and similar-failure retrieval.

## Phase 4 — Locator observe-only memory

Suggestions only; deterministic validation and user review remain mandatory.

## Phase 5 — Local embeddings

Only after separate model, license, resource, offline, and security approval.

---

## 17. Mandatory Verifiers

Suggested scripts:

```text
verify:zvec-host-source-boundary
verify:zvec-native-assets
verify:zvec-host-protocol
verify:zvec-host-lifecycle
verify:zvec-host-crash-isolation
verify:zvec-path-confinement
verify:zvec-generation-recovery
verify:zvec-packaged
verify:zvec-full-offline-bundle
verify:zvec-nsis
verify:zvec-negative-cases
verify:zvec-shutdown
verify:zvec-playwright-coexistence
benchmark:zvec-host
```

Critical source-boundary assertions:

- no `@zvec/zvec` import outside allowed host/test paths;
- no Zvec operation symbol in `out/main`;
- packaged host hash equals staged host hash;
- `.node` exists outside ASAR;
- dictionary files resolve adjacent to the binding;
- only utility process loads the binding in production.

---

## 18. Final Acceptance Criteria

Production implementation can proceed to FTS features only when:

1. Raw unbundled utility host works in development and full packaged app.
2. Main process never directly loads Zvec.
3. Utility abort does not terminate or destabilize AWKIT.
4. Full portable package passes.
5. Full NSIS install/launch/uninstall passes without elevation.
6. Strict offline validation includes Zvec without weakening existing checks.
7. No runtime download or external service is used.
8. Path confinement is proven.
9. Shutdown is bounded and recovery is proven.
10. Packaged negative cases fail safely.
11. Playwright coexistence shows acceptable impact.
12. Security/redaction tests pass.
13. Spike-only hooks are removed.
14. Every unexecuted test is reported truthfully.
15. Architecture, current-state, commands, security, and packaging documentation are updated.

---

## 19. Recommended Immediate Authorization

Authorize **Phase 0C only**, followed by review.

Do not authorize product semantic indexing until Phase 0C closes:

- full offline package;
- NSIS;
- repeated benchmark;
- Playwright coexistence;
- packaged negative cases;
- final cleanup plan.

After Phase 0C, authorize **Phase 1A only** to build the production utility-host foundation.

---

## 20. Claude Code Execution Instruction

```text
Review and adopt docs/AWKIT_ZVEC_BLOCKER_RESOLUTION_IMPLEMENTATION_PLAN.md
as the resolution plan for the Zvec spike findings.

Current decision:
- Zvec production placement is Electron utility process.
- The utility host must be raw and unbundled.
- No @zvec/zvec import may enter the electron-vite main/preload/renderer bundles.
- Zvec remains optional, derived, rebuildable, and non-authoritative.

First execute Phase 0C only.

Before changing anything:
1. Read the repository Git skill and all governing AGENTS/docs.
2. Inspect the existing spike worktree and preserve its evidence.
3. Report branch, HEAD, dirty files, artifacts, and original-tree status.
4. Do not touch Beads or unrelated work.
5. Do not commit, push, or open a PR.

Phase 0C requirements:
- stage the complete AWKIT offline Chromium/vendor resources;
- create the Zvec raw utility-host staging tree;
- generate a full dependency manifest with Zvec hashes;
- run strict offline validation;
- build and launch full portable and NSIS packages;
- test non-admin install/relaunch/uninstall;
- record Defender/SmartScreen behavior;
- repeat utility-host benchmarks with percentiles;
- run a representative Playwright mock-site coexistence test;
- run packaged negative cases;
- measure bounded graceful shutdown;
- update the Phase 0 report with PASS/FAIL/NOT RUN/INCONCLUSIVE;
- remove no spike code yet if it is required for Phase 0C evidence, but identify every file that must be removed or converted before merge.

Do not implement:
- semantic product IPC;
- preload or renderer APIs;
- semantic UI;
- workflow/flow indexing;
- failure or locator memory;
- embeddings;
- changes to workflow execution behavior;
- authoritative schema changes.

At completion return:
- full package composition and size;
- full offline validation;
- portable result;
- NSIS result;
- negative-case matrix;
- repeated benchmark methodology and results;
- Playwright coexistence result;
- shutdown recommendation;
- SmartScreen/Defender observations;
- remaining blockers;
- GO / GO WITH CONDITIONS / NO-GO;
- exact files to remove or convert before Phase 1A.

Do not commit, push, or open a PR.
```

---

**End of plan**
