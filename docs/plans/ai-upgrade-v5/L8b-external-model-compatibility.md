# L8b — External Compatible-Model Registration & Qualification

Shared rules and the Phase L extension decisions (E1–E12): `ROADMAP.md` › *Phase L extension
(2026-09-27)*. Beads `awkit-djnl.12`. Depends on L8a (`awkit-djnl.11`). Blocks L9 (`awkit-djnl.13`).

**Status (2026-09-29): CLOSED — L8b.1–L8b.5 implemented, QA PASS, independent QC pending (carried
forward).** The records follow the plan, newest last. Both planned verifiers exist and pass:
`verify:ai-model-compatibility` (188/0) and `verify:ai-model-registration` (33/0 on the packaged build).

## Objective

Let an administrator register any **compatible** local GGUF model, not only the manifest-listed
packs, while keeping the model optional, the filesystem confined, and the product honest about
which configurations are actually qualified.

## Non-goals

- Bundling a model, downloading one, or an online model catalogue.
- Referencing a model file in place, or hard-linking it (E1: copy only).
- Changing autonomy tiers, T3, or any feature's acceptance thresholds.
- Treating a compatible model as qualified.

## Registration (E1)

- The user selects a `.gguf` in **Settings → Local AI**. The app shows the file size and the free
  space in the app-managed model root, and only then **copies** it there (the current
  `ai:importModelPack` → `modelsDir()` path), hashing during the copy.
- Path-traversal, junction, symlink, mutation-after-hash, tamper and replacement protections stay
  exactly as today (`confineModelPath`, `AWKIT_AI_MODEL_ROOT`, once-per-session checksum
  verification in `AiModelPack.ts`).
- With AI disabled, no model, a load failure or an incompatible model, every deterministic feature
  keeps working.

## Compatibility (E6) — two bounded, cancellable stages, both in the utility host

| Stage | Checks | Failure |
|---|---|---|
| **Static** | GGUF version and readability; architecture supported by the pinned runtime; chat template resolvable; context and token limits; quantization; size and SHA-256 (provenance); licence/notice acknowledgement | `Incompatible` with the failing check |
| **Dynamic probe** | load; one tiny JSON-schema-constrained generation; runtime schema validation; thinking **verifiably disabled** | `Incompatible` with the failing check |

- Today's thinking-off mechanism (an empty think block pre-filled on the assistant turn) is
  Qwen-family specific. A model whose thinking cannot be shown to be off is `Incompatible`.
- GGUF parsing never happens in the Electron main process.
- Both stages report progress through the L9 job-status contract (hashing and copying are
  determinate; the probe is staged).

## Qualification (E6)

| Layer | Key | Meaning |
|---|---|---|
| **Quality qualification** | model SHA-256 + runtime build + backend + offload class (`cpu` / `partial:<layers>` / `full`) + context + configurable KV/attention settings + feature + prompt/output budget | what "Qualified" means; carries across hardware |
| **Latency class** | quality key + hardware class (`MachineCapabilityDetector` buckets, GPU VRAM/capability class, driver version) | measured locally or not claimed; feeds L9's ETA |

- Curated models ship as a source-controlled **qualified list**, release-owned and Risk-3, beside
  `AI_MODEL_MANIFEST`.
- One configuration never qualifies another: GPU does not qualify CPU, full offload does not
  qualify partial, and GPU results never replace CPU functional/fallback verification.
- Existing 0.8B / 2B / 4B CPU evidence stays unchanged, keyed to its historical CPU quality key.
- Labels, each with a reason: `Compatible`, `Qualified`, `Compatible but unqualified`,
  `Incompatible`. Unqualified compatible models run under conservative bounded defaults and are
  never presented as meeting the recommended quality or latency class.
- Never use the licensing machine fingerprint for any key.
- `AiActionRecord` gains the effective profile (backend numerics can change output).

## Trust boundary (E7)

- Accepting arbitrary GGUF files supersedes the 2026-09-19 "manifest-only, no user override"
  decision (`DECISIONS.md`). Threat model: llama.cpp has had GGUF-parser memory-safety advisories,
  and the host runs with the user's privileges.
- Registration keeps `AI_MANAGE` + re-auth. **No new permission** — `ADMINISTRATOR_PERMISSIONS`
  is a denylist, so a new permission would be auto-granted.
- An explicit "unverified model" acknowledgement before a non-qualified model is enabled.
- The runtime pin stays current so parser fixes arrive with app releases.
- Every `src/offline/**` and security slice is Risk-3 and lease-gated.

## Existing owners to extend

| Owner | L8b change |
|---|---|
| `src/ai/AiModelPack.ts` | copy with preflight; drop the manifest-only refusal in favor of compatibility stages |
| `src/offline/AiModelManifest.ts` (Risk-3) | curated entries become the qualified list; `isValidAiModelManifestEntry` unchanged for them |
| `native-hosts/ai/ai-host.cjs` | static header read and dynamic probe requests |
| `src/ai/contracts/AiHostProtocol.ts` | probe request/response, compatibility reasons |
| `src/ai/AiActionRecord.ts` | effective profile field (additive; old records load) |
| `app/main/ipc/ai.ipc.ts`, `app/main/preload.ts` | status and label channels, same permission |
| `app/renderer/pages/LocalAiSettings.tsx` | labels, reasons, acknowledgement, disk-space preflight |

## Implementation slices

| Slice | Content | Lease domain |
|---|---|---|
| L8b.1 | Copy registration with preflight; protections re-proved | security + persistence |
| L8b.2 | Static header checks in the host | runtime |
| L8b.3 | Dynamic probe and thinking-off check | runtime |
| L8b.4 | Qualified list, quality key, latency class, labels | release (Risk-3) + runtime |
| L8b.5 | Settings UI, acknowledgement, `AiActionRecord` profile | frontend + persistence |

## Acceptance and evidence (E11: development machine, packaged build)

- Registration of a compatible non-manifest GGUF; disk-space preflight shown before copy.
- Negative cases: traversal, junction, symlink, mutation after hashing, malformed GGUF, unsupported
  architecture, thinking not disableable — each `Incompatible` with its reason.
- The curated models still read `Qualified` on their historical CPU key; a GPU run of the same
  model reads `Compatible but unqualified` until its own evidence exists.
- Old `ai-settings.json`, model store and `AiActionRecord` files load unchanged (migration).
- Planned verifiers (registered only when written): `verify:ai-model-compatibility` (fake host +
  malformed fixtures), `verify:ai-model-registration` (packaged, development machine).

## Risks and open decisions

- How much of the chat-template check is static vs probe-only — settled by L8b.2.
- Disk usage doubles for a copied model; the preflight makes it visible.

## L8b.1 record (2026-09-28)

Contract `awkit-djnl-12-l8b1-registration-0928`. Commit `10ea7862`.

**Store (`src/ai/AiModelPack.ts`).**
- A GGUF the manifest does not list is no longer refused. E7 supersedes the 2026-09-19
  manifest-only rule, noted in place in `DECISIONS.md`.
  - It is copied with the same single hashed pass, stored as `<sha256>.gguf`, and registered with
    `external: { sizeBytes, fileName }`.
  - The file name is the source's own base name. It is shown, never used as a path, and validated as
    one segment with no reserved or control characters. Otherwise it reads `model.gguf`.
- Its status is `registered`. It is never `installed`, so it is never curated and never loaded: the
  runtime answers `MODEL_UNCHECKED` until L8b.2 and L8b.3 exist. A later release that lists those
  bytes reads them as its curated pack.
- **Space:** every import needs free space for the file plus `MODEL_IMPORT_HEADROOM_BYTES` (256 MB),
  measured again at copy time, and fails closed (`INSUFFICIENT_SPACE`) when the space cannot be
  measured. `preflight(path)` reports name, size, free, required and whether it fits, and copies
  nothing. Its UI is L8b.5.
- **Registry:** the one additive field is optional, so pre-L8b registries load unchanged. A forged
  `external` (path in the name, control character, zero, negative or string size, null) reads
  `REGISTRY_UNREADABLE`.
- **Protections re-proved on a registered model:**
  - a same-size edit fails load verification (HASH_MISMATCH);
  - a swapped file is caught (SIZE_MISMATCH), and a deleted one reads FILE_MISSING;
  - a symlinked source is stored as a regular-file copy;
  - the registry holds no directory or path;
  - the host's `confineModelPath` and `AWKIT_AI_MODEL_ROOT` are unchanged.

**Runtime and UI.**
- `aiRuntime` maps `registered` to `MODEL_UNCHECKED` and shows the file name.
- Settings reads "registered, not checked for compatibility yet (not used)"; Replace and Remove work
  for it.
- The import notice no longer claims "verified".
- No new channel or permission. The two-step preflight UI is L8b.5.

**Evidence.**
- `verify:ai-model-pack` 74/0 (38 new checks); `verify:ai-fallback` 42/0 (a registered-unchecked model
  never reaches the host).
- 4/4 mutations caught and reverted:

  | Mutation | Result |
  |---|---|
  | space gate skipped | 69/5 |
  | registry validation dropped | 68/6 |
  | full source path stored as the name | 66/8 |
  | size check skipped for a registered model | 73/1 |

- `verify:ai-backend-pack` 139/0 (its free-space helper moved here), `verify:ai-settings-gui`
  124/124, `verify:ai-backend-pack-gui` 59/59.
- Build, `typecheck:scripts` and `verify:verifier-classification` (287) PASS.
- `verify:failure-capture-overhead` INCONCLUSIVE on this host (run 18; zero AI calls on the run path
  PASS).
- **NOT RUN:** the packaged import (no package rebuilt for this slice); `verify:ai-model-live`
  (unchanged curated path).

## L8b.2 record (2026-09-28)

Contract `awkit-djnl-12-l8b2-static-checks-0928`. Commits `dd7ddb8d` (host), `aeb18017`, manifest
`5b08eb89`.

- The CPU host's `inspect` reads a confined model's GGUF header with the pinned runtime's own reader:
  filesystem only, no split-part siblings, nothing native loaded, a 20 s deadline below the manager's.
  Only numbers, a vetted short architecture name and the template's shape cross the boundary.
- `staticVerdict` (`src/ai/AiModelCompatibility.ts`) decides, first failure wins: `GGUF_UNREADABLE`,
  `GGUF_VERSION`, `ARCHITECTURE_UNSUPPORTED`, `TENSOR_TYPE_UNSUPPORTED`, `CHAT_TEMPLATE`,
  `CONTEXT_TOO_SMALL`, `LAYER_COUNT`. The verdict is recorded on the model with the runtime build that
  produced it; a verdict from another build no longer counts.
- **Settled open question:** the chat-template check is static and shape-only (ChatML or not). Whether
  thinking can be turned off is the probe's job, observed on the model.
- Evidence: `verify:ai-host` 227/0 (30/30 mutations), `verify:ai-model-compatibility` 81/0,
  `verify:ai-model-inspect` 25/0 on the real host, `verify:ai-packaged-app` 28/0 on a fresh package.

## L8b.3–L8b.5 record (2026-09-29)

Contract `awkit-djnl-12-l8b3-l8b5-0929`. Commits `79c99a0f` (host), `86aacc1e` (qualified list),
`2bef0033`, `99351b69`, `33d218f4`, manifest `7b35277c`, `2d961a41`.

**L8b.3, the probe.** A new CPU-host request, `probe`:
- It loads the confined model exactly as `load` does, then generates 16 tokens unconstrained and greedy
  after the product's own thinking-off prompt (ChatML with the empty think block pre-filled). It reports
  only whether they opened a think block; their text never leaves the host.
- It then answers a fixed schema (`{"answer": "yes"|"no"}`) under its grammar, bounded to 32 tokens. The
  main process validates it with `parseAiOutput`, like any product answer.
- The model is always released afterwards. The probe is cancellable. A load failure is an answer
  (`loaded: false`); a runtime that cannot start is an error, so the stage is not run.
- `probeVerdict`, first failure wins: `PROBE_LOAD_FAILED`, `PROBE_GENERATION_FAILED`,
  `THINKING_NOT_DISABLED`, `PROBE_OUTPUT_INVALID`. A malformed reply fails; a cancelled one is not run.
- `runCompatibilityStages` probes only a model whose own header passed for this runtime build, so a
  replacement imported meanwhile is never probed on another file's verdict. A mutation that dropped this
  guard recorded a replacement **Compatible with no header check at all**.
- `AiService.probeModel` waits for admission (a probe loads a whole model), handshakes the CPU host,
  forgets the host's loaded model, and cancels a probe past its 240 s deadline on the host. The host
  manager now tracks probe job ids like inference ones, so a cancel it cannot honour kills the host.

**L8b.4, qualification.**
- The release-owned list `src/offline/AiQualifiedList.ts` (Risk 3) holds quality keys: model SHA-256,
  runtime build, backend, offload class, context, KV settings, feature, output budget.
- It holds only the historical CPU evidence: Qwen3.5-0.8B on CPU & RAM for the owner's three limited-GO
  features (`locatorSemanticUpgrade` 256, `validationExplanation` 176, `failureAnalysis` 256 output
  tokens), from the L1.8 GO. The 4B (NO-GO) and 2B (FAIL) have no entry, so they are compatible but never
  qualified.
- `src/ai/AiQualification.ts` derives the live key from the configuration the model runs in. CPU mode is
  decided by the mode; a GPU mode only by a load under the current setting, and before one nothing is
  claimed.
- Labels, each with a reason: Incompatible (the failed check), unchecked, Qualified (for the named
  features), Compatible but unqualified (`NO_QUALITY_EVIDENCE`, `NOT_QUALIFIED_ON_THIS_CONFIGURATION`,
  `CONFIGURATION_NOT_DECIDED`).
- The latency class is the quality key on a coarse hardware class (powers of two, never the licensing
  fingerprint). Nothing measures it before L9, so latency is never claimed.
- An unqualified model runs with exactly the product's own bounded budgets; nothing is raised for it.

**L8b.5, Settings, acknowledgement and the effective profile.**
- **Two-step import:** `ai:preflightModelPack` opens the dialog in main and returns the file's name,
  size, the free space and the need, with a one-time token. `ai:importModelPack(token)` copies it. The
  renderer never supplies a path.
- **Acknowledgement:** `ai:acknowledgeModelPack` records "unverified model" acceptance on that exact file,
  only once it is compatible. A new import, even of the same file, needs a new one. Until then the AI
  reads `MODEL_UNACKNOWLEDGED`.
- **Re-check:** `ai:checkModelPack` re-runs both stages (a new runtime build, or a check that could not
  run at import).
- All three are `AI_MANAGE` with re-authentication; no new permission.
- **Settings** shows the preflight before any copy, the pack's compatibility label with its reason, a
  Qualification row, "Speed on this machine: not measured, so not claimed", Check Compatibility Again,
  and Use Unverified Model… with a confirmation. The audit table gains a "Ran on" column.
- **`AiActionRecord.profile`** (optional): runtime build, backend and offload class. It is carried from
  the job outcome through the pending candidate to the record. Old records and old candidates load
  unchanged; a malformed profile is refused.

**Evidence (final state).**

| Gate | Result |
|---|---|
| `verify:ai-host` | 269/0, 39/39 mutations (9 new for the probe) |
| `verify:ai-model-compatibility` | 188/0, 3/3 manual mutations caught (thinking check, probe-after-replacement guard, probe admission) |
| `verify:ai-model-inspect` (real host) | 31/0: the 0.8B, 4B and unlisted 2B pass the probe (36, 142 and 92 s); a weightless header fails the load without restarting the host; the host with the pre-fill removed reads `THINKING_NOT_DISABLED` on the real 0.8B |
| `verify:ai-model-registration` (packaged) | 33/0: the 2B registered, Compatible but unqualified, acknowledged in Settings; malformed and unknown-architecture headers Incompatible; a real inference on an unlisted 0.8B copy; a byte flipped after hashing refused (`HASH_MISMATCH`) |
| `verify:ai-packaged-app` (packaged) | 32/0: two-step import, the curated 0.8B Qualified on its CPU key |
| `verify:ai-settings-gui` | 140/140 |
| Other gates | fallback 50/0, permissions 129/0, audit-revert 78/0, gpu-modes 184/0, locator-upgrade 79/0, locator-attempts 191/191, element-spy 205/0, model-pack 74/0 |
| Build | build, `typecheck:scripts`, `verify:verifier-classification` (290) PASS; strict offline validation on a fresh package from clean `7eeff437` |
| Guards of the edited host and `src/ai` | `verify:ai-failure-analysis-budget` 7/0, `verify:ai-locator-upgrade-budget` 8/0 on the real tokenizer; `verify:failure-capture-overhead` INCONCLUSIVE (run 19: 15 passed, 0 failed, 3 timing intervals straddle their ceilings on this noisy host; zero AI calls on the run path PASS); `verify:ai-inference-profile` NOT RUN (an L1.8 diagnostic measurement; the host's inference path is unchanged) |

**Acceptance, mapped.**
- Registration of a compatible non-manifest GGUF, preflight first: `verify:ai-model-registration` A.
- Traversal, junction and symlink: refused by the host's confinement (`verify:ai-host`) and the store's
  copy (`verify:ai-model-pack`).
- Mutation after hashing: `verify:ai-model-registration` D.
- Malformed GGUF, unsupported architecture: `verify:ai-model-registration` B, `verify:ai-model-inspect`.
- Thinking not disableable: `verify:ai-model-inspect`'s host mutant on the real 0.8B.
- Curated models: the 0.8B reads Qualified on its historical CPU key; a GPU run reads Compatible but
  unqualified (`verify:ai-model-compatibility` J). The 4B reads Compatible but unqualified, because its
  historical evidence is a NO-GO.
- Migration: pre-L8b.3 registries and pre-L8b.5 action records load unchanged; `ai-settings.json` is
  untouched by L8b.

**Carried forward (Beads `awkit-djnl.16`):**
- independent QC of L8b.1–L8b.5;
- the latency class is defined but measured by L9's ETA history;
- a shared `ConfirmDialog` renders `\n` line breaks as spaces (see KNOWN_ISSUES);
- `verify:failure-capture-overhead` stays INCONCLUSIVE on this host; a measurement-quiet host decides it.

## `awkit-djnl.16` follow-up record (2026-09-30)

Contract `awkit-djnl-16-l8b-qc-0930`. The issue stays open for one item: an independent review of the
L8b.2/L8b.3 verdict logic.

**1. Independent QC: done for L8b.1, L8b.4 and L8b.5; INCONCLUSIVE for L8b.2/L8b.3.**
- GPT-5.6 Luna, through CodeCraft, reviewed these on the current code:
  - the copy import (L8b.1);
  - qualification, the latency class and the action-record profile (L8b.4, L8b.5);
  - the acknowledgement and model resolution (L8b.5).
- No product defect:
  - its "undefined size" was an artifact of the compressed packet;
  - a listed checksum with a different size is unreachable, and would fall to the stricter
    registered path;
  - a source that grows mid-copy only fails the copy (LOW, kept).
- The compatibility-verdict packet (`staticVerdict`, `probeVerdict`, `runCompatibilityStages`) timed
  out twice on `gpt-5.6-luna` and came back empty on `deepseek-v4-flash-0731`. Its independent review
  is **INCONCLUSIVE**.
  - Claude's review found no defect: malformed host replies fail, a cancelled probe records nothing,
    and a verdict never lands on a replacement.
  - `verify:ai-model-compatibility` 188/0 re-ran on the final state, and its guards were
    mutation-tested at L8b close.
- Claude also reviewed the host probe and the four `AI_MANAGE` channels, all with re-auth. There is
  one LOW observation: the think check knows only the `<think>` marker, but every product answer is
  grammar-constrained.

**2. Latency class: settled.** L9's ETA history records under it (`verify:ai-progress-gui` 41/0,
where the history file's keys are latency classes).
- QC found the formula written twice: `latencyClassId` was dead, and `aiRuntime.latencyKeyFor`
  re-derived the same string.
- `latencyKeyFor` now calls `latencyClassId`, so the class L8b.4 defines is the key L9 records. The
  output is byte-identical, so existing history files keep their keys.

**3. `ConfirmDialog` line breaks: fixed.** `.modal-body` has `white-space: pre-line`.
- `verify:ai-backend-pack-gui` asserts the removal dialog's `\n\n` breaks: 59/60 before the fix,
  60/60 after it.
- `verify:https-certificates-gui` 31/31 and `verify:ai-settings-gui` 141/141 were re-run.
- `verify:ai-backend-pack-packaged` is NOT RUN: `dist/win-unpacked` predates the fix, and the next
  fresh package carries it.

**4. `verify:failure-capture-overhead`: PASS.** Run 21 was 18 passed, 0 failed, 0 inconclusive, with a
fast median of +9 ms and an evidence median of +12 ms against a 150 ms ceiling.

**Other gates on the final state:**
- `build` and `typecheck:scripts` PASS;
- `verify:ai-fallback` 51/0.
