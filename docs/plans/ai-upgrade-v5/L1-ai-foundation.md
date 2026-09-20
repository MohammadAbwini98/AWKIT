# L1 — AI Foundation, Autonomy Policy & Performance Gate

Shared rules, architecture and decisions: `ROADMAP.md`. Depends on L0.

**Status (2026-09-19): IN PROGRESS.** `awkit-djnl.1` is `in_progress`. Implementation choices are in
`docs/ai/DECISIONS.md` (L1 entry).

| Task | State | Where |
|---|---|---|
| L1.1 AiService host | **Built.** Service, queue, protocol, utility-host manager, IPC, and the real host `native-hosts/ai/ai-host.cjs` on node-llama-cpp (`51cacba`), proven against a fake runtime (`verify:ai-host`) and in a real utility process (`verify:ai-host-electron`, `9c25288`). Running it on a real model is BLOCKED on the two owner steps below. | `src/ai/AiService.ts`, `src/ai/contracts/AiHostProtocol.ts`, `app/main/ai/*`, `app/main/ipc/ai.ipc.ts`, `native-hosts/ai/ai-host.cjs` |
| L1.2 Model pack | **Built:** import, SHA-256 against the manifest, status, remove. **PACK ACQUIRED AND VERIFIED 2026-09-20** (size + SHA-256 exact, metadata read from the file). **STILL BLOCKED:** the llama.cpp runtime pin and the third-party notices need the installed runtime, which cannot be installed on Node 18.16 — so `AI_MODEL_MANIFEST` is still empty and `AI_RUNTIME_PIN.build` is still null. | `src/ai/AiModelPack.ts`, `src/offline/AiModelManifest.ts` |
| L1.3 Output contract | **Done.** | `src/ai/{AiPromptBuilder,AiOutputContract}.ts` |
| L1.4 Autonomy and audit | **Done.** The policy lives in `src/security/authz` (see DECISIONS). | `src/security/authz/AiAutonomyPolicy.ts`, `src/ai/{AiActionRecord,AiActionStore,AiRevert}.ts` |
| L1.5 Permissions and Settings | **Done.** | `Permissions.ts`, `src/ai/AiSettings.ts`, Settings › Local AI |
| L1.6 Resource integration | **Done:** yield, weighted admission, derived threads, idle unload. | `src/ai/AiAdmission.ts`, `WorkloadWeights.aiInferenceWeight`, `ExecutionEngine.getAiAdmissionView` |
| L1.7 Fake provider | **Done.** | `src/ai/FakeAiHostTransport.ts` |
| L1.8 Performance go/no-go | **BLOCKED:** no runtime or model. The harness `benchmark:ai-model` and its pre-registered ceilings exist. | `scripts/benchmark-ai-model.mts` |

Verifiers: all listed below exist and pass, plus `verify:ai-settings-gui`, `verify:ai-host` and
`verify:ai-host-electron`. `verify:ai-model-live` and `benchmark:ai-model` exist and are NOT RUN until
the owner installs the runtime and downloads the pack.

**Re-checked 2026-09-20.** Both owner artifacts are still absent on the development machine:
`node-llama-cpp` is in neither `package.json` nor `node_modules/`, and no `.gguf` exists in `Downloads`
(readable, 59,082 files) or under `%LOCALAPPDATA%/SpecterStudio`. `verify:ai-model-live` reports `NOT RUN`
naming owner step 1, and `verify:ai-model-pack` (46/46) ends `0 pinned pack(s); runtime build not pinned`.
The two owner commands below are unchanged.

That pass also found `verify:ai-fallback` at **34/2** and the structural check in
`verify:failure-capture-overhead` red — both regressed by L3, both stale assertions rather than product
defects, and both now assert *reachability to the model* over the full import closure instead of naming
the `src/ai` folder. `verify:ai-fallback` is now **38/38**. See `KNOWN_ISSUES.md` for why a folder proxy
was simultaneously too broad and too weak.

## Runtime decision and acquisition (2026-09-19)

**Runtime: `node-llama-cpp` 3.21.1 inside the existing Electron utility process.** It bundles
llama.cpp `v0.4.0` (2026-09-04), and llama.cpp has supported the `qwen35` architecture since
February 2026. The alternative, a pinned `llama-server.exe`, was rejected:

| Contract | node-llama-cpp in the utility process | `llama-server.exe` behind the host |
|---|---|---|
| Listener (L1.1) | None; MessagePort only | Loopback port plus a per-session key: the plan's fallback, allowed only "if unavoidable" |
| Crash domain | One process; a crash frees the model | Grandchild process; Windows does not kill it when the utility process dies, so it needs a job object or watchdog |
| Cancellation | `AbortSignal`, checked between tokens and batches | Abort the HTTP request |
| Constrained decoding | `createGrammarForJsonSchema` covers the whole bounded subset except numeric min/max, which `parseAiOutput` re-checks | `json_schema` field |
| CPU dispatch | Prebuilt `@node-llama-cpp/win-x64` ships every variant (SSE4.2 to AVX-512) and selects at runtime | Same, in the release zip |
| New infrastructure | A staging script, like the Zvec host's | Port allocation, key handling, orphan cleanup, process supervision |

It is a dev dependency, so it never enters `app.asar`. The host's runtime tree is staged next to it,
like the Zvec host.

> **PREREQUISITE FOUND 2026-09-20, and it is not optional: `node-llama-cpp@3.21.1` requires Node
> `>=20.0.0`. This machine runs Node v18.16.0, so step 1 CANNOT succeed here.** The package declares
> that engine, and its postinstall crashes outright on Node 18 (`import … with { type: 'json' }` →
> `SyntaxError: Unexpected token 'with'`). Installing with `--ignore-scripts` is **not** a workaround:
> the JS lands, but every one of the 13 platform prebuilts — including `@node-llama-cpp/win-x64`,
> which carries the actual native binary — is an optional dependency that also requires Node ≥20, so
> npm **silently skips all of them** and `node_modules/@node-llama-cpp/` is left empty. There is then
> no runtime at all, and `verify:ai-model-live` correctly still reports `NOT RUN` (it tests for the
> prebuilt, not just the package, so it does not fail open). The attempt was reverted; `npm uninstall`
> restored `package.json` and `package-lock.json` to zero diff. **Upgrading Node is a toolchain
> decision for the owner**, not a step an agent should take: the 233 verifiers, the `tsx` harnesses and
> `electron-builder` all currently pass on 18.16, and the repository declares no `engines` field.

**Owner steps.** The lease guard's grammar has no install or download verb at all — not an
authorization level, a missing command *form* — so neither step can be run by an agent under any
lease. Run both in PowerShell from the repo root:

1. Runtime (exact pin; `NODE_LLAMA_CPP_SKIP_DOWNLOAD` prevents any source build). npm also installs
   optional CUDA and Vulkan packages. They are never used or staged.

   ```powershell
   $env:NODE_LLAMA_CPP_SKIP_DOWNLOAD="true"; npm install --save-dev --save-exact node-llama-cpp@3.21.1
   ```

2. Model pack, `lmstudio-community/Qwen3.5-4B-GGUF`, file `Qwen3.5-4B-Q4_K_M.gguf`: 2,707,513,696
   bytes, Apache-2.0, published SHA-256 `25082a7dd3776cc3c741c6347d3bd04523f05796607b3fbc32fa3a25dfa1418c`.
   Save it to Downloads, not the OneDrive-synced repository. The manifest pins the SHA-256 measured
   from the downloaded file; the published value is only a cross-check.

   ```powershell
   curl.exe -L -C - --retry 5 --retry-all-errors -o "$env:USERPROFILE\Downloads\Qwen3.5-4B-Q4_K_M.gguf" https://huggingface.co/lmstudio-community/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf
   ```

   **DONE 2026-09-20 — the pack is downloaded and its identity is verified.** It sits at
   `%USERPROFILE%\Downloads\Qwen3.5-4B-Q4_K_M.gguf`, measures **2,707,513,696 bytes** (exact match) and
   hashes to **`25082a7dd3776cc3c741c6347d3bd04523f05796607b3fbc32fa3a25dfa1418c`** (exact match to the
   published value, via `certutil -hashfile … SHA256`). Metadata read from the file itself rather than
   assumed: `GGUF version 3`, `general.architecture = qwen35`, `qwen35.context_length = 262144`,
   `general.name = Qwen_Qwen3.5 4B`, 426 tensors.

   **Use `-C -` and `--retry`.** The first attempt died at 1,084,225,386 bytes with
   `curl: (56)` (receive failure) and left a **truncated fragment under the correct file name** — the
   exact shape that makes a `Downloads\*.gguf` existence check report success for a broken artifact.
   Verify size **and** checksum, never presence.

## Goal

Build the single optional AI boundary, the autonomy/audit machinery every AI feature uses, and prove the model is
viable on constrained CPU **before** any AI feature is built.

## Tasks

### L1.1 AiService host
- Long-lived utility/stdio child process (no TCP listener). If `llama-server` is unavoidable: loopback only,
  random ephemeral port, per-session random token, reject non-loopback.
- Pattern lifecycle on `ZvecUtilityHostManager` + `ZvecHostRestartPolicy` (lazy restart, circuit breaker, clean shutdown).
- States: `available | unavailable(reason) | loading | busy | error(code)`.
- One job queue: request/feature id, priority, timeout, cancellation, bounded length, one inference at a time,
  bounded prompt/output tokens.
- Renderer gets narrow feature APIs only (pattern: `SemanticApi.ts` drops unknown properties).

### L1.2 Model pack
- Settings import: select file → format/identity check → SHA-256 vs manifest → copy under data root → register.
- Status: Installed / Missing / Invalid / Incompatible; remove/replace behind permission.
- Pin llama.cpp revision; add model/runtime license and third-party notices.

### L1.3 Output contract
- Thinking disabled for all product prompts; grammar/JSON-schema constrained decoding; runtime schema validation
  after decoding; reject unknown IDs/operations even in valid JSON.
- Prompt builder separates instructions from delimited untrusted data; per-field and total caps; IDs/enums over text;
  central redaction (`SecretMasker`, `SemanticRedactor`) before every request; no raw prompt/response persistence.

### L1.4 Autonomy policy & audit (new, shared by L3–L6)
- Pure `AiAutonomyPolicy`: `(feature, actionClass, context) → observe | suggest | autoApply | forbidden`.
  T3 action classes hard-coded forbidden; configured tiers capped at T2.
- `AiActionRecord` store (atomic writes via `app/main/atomicReplace.ts`): action, target, evidence IDs, proof result,
  model id, tier, timestamp, revert handle, reverted flag.
- Revert API restores the prior value through the owning save path.
- Self-demotion: revert rate per feature over a rolling window > committed threshold ⇒ T2→T1 + notice.

### L1.5 Permissions & Settings
- Decide each permission explicitly in `Permissions.ts` for every built-in role (Administrator is a denylist):
  use AI, manage AI/model pack, view AI audit/diagnostics, Element Spy.
- Settings: master switch; model-pack status; per-feature tier selector (bounded by policy); yield-during-runs
  (default ON); idle unload; runtime/model/checksum status; audit log view with revert. No cloud fields.

### L1.6 Resource integration
- Register inference in `WorkloadWeights`; admission via `AdaptiveController`/`BackpressureController`.
- Threads derived from `MachineCapabilityDetector` (3–4 on the target envelope), never hardcoded.
- Queued jobs pause while runs are active; never preempt Playwright-critical work; idle unload.

### L1.7 Fake provider
- Deterministic fake transport (pattern: `FakeZvecHostTransport`) scripted per test; all normal verifiers use it.

### L1.8 Performance go/no-go
Constrained 6-logical-CPU harness (not a VMware claim). Measure load time, RSS/peak, prompt tokens/s, generation
tokens/s, TTFT, cancellation latency, CPU, Recorder responsiveness, Playwright impact (queued/active/yielded) for:
1. locator semantic-upgrade job (≤~2K in / ≤192 out, ≤2 attempts);
2. replay-proof path (no model — confirms zero cost);
3. validation explanation (≤~1.5K / ≤192);
4. post-run failure analysis (≤~2K / ≤256);
5. coalesced concurrent-failure batch incl. queue-cap/budget exhaustion.

Record per-feature budgets from results. If unacceptable after tuning, mark L3/L4b/L5b **BLOCKED pending model/runtime
decision**.

#### Result (2026-09-20): NO-GO. Evidence: `evidence/L1.8-benchmark.json`

Host: Intel i7-8750H, 12 logical CPUs, 16 GB, Windows 10 — constrained to 6 CPUs (mask `0x3F`),
3 inference threads. Runtime `node-llama-cpp@3.21.1+llama.cpp@v0.4.0`, pack `25082a7d…1418c`.

| Criterion | Ceiling | Measured | |
|---|---|---|---|
| Cold model load | 60,000 ms | 50,101 ms (warm 10,488 ms) | PASS |
| Host peak working set | 6,144 MB | 3,550 MB | PASS |
| Main-loop delay p99 | 100 ms | 21 ms | PASS |
| `locatorUpgrade` background job | 180,000 ms | >240,000 ms ×2, no answer | **FAIL** |

Through the production `AiService`, with the model already loaded, a ~250-token prompt capped at 128
output tokens returns `TIMEOUT` at 120 s — under ~1 token/s.

**Bottleneck: compute, with the model fully resident.** An initial slow-storage reading (50 s cold
load ≈ 54 MB/s; a 2.7 GB import at ≈ 31 MB/s) was **overturned** by the resource sample — warm load is
10,488 ms, the working set stays at 3,550 MB, and CPU holds a *flat* line (avg 25 / max 26) across
240 s at ~3× the 8 observed during the single-threaded load, matching the 3 configured threads.
Not thrashing; not thread starvation. *Caveat:* Electron `percentCPUUsage` normalization is ambiguous —
the evidence is the flat line and the 3:1 ratio, not the absolute number.

**Not yet isolated:** prefill vs constrained decode. The host returns `promptMs`/`firstTokenMs`/
`generationMs` only on completion, and no timed-out run completes. Leading hypothesis — **not a
finding** — is JSON-schema GBNF sampling over Qwen3.5's ~151k vocabulary, applied to every token
because `AI_SCHEMA_REQUIRED` refuses unconstrained generation.

**Per the rule above, L3 §8 / L4b / L5b are BLOCKED pending a model/runtime decision.** The owner must
choose: (1) authorize a `runtime`-routed change so the host reports timings on timeout (or add a
grammar-off probe) and separate prefill from decode; then (2) if constrained decode dominates, revisit
the decoding strategy; **or** (3) accept that a 4B Q4_K_M on a 2018 6-core mobile CPU is below the bar
and re-scope the model, the ceilings, or the qualifying hardware. No ceiling was moved and no timeout
was raised to hide throughput.

## Verifiers

`verify:ai-adapter`, `verify:ai-redaction`, `verify:ai-fallback`, `verify:ai-permissions`, `verify:ai-model-pack`,
`verify:ai-autonomy-policy` (tier matrix, T3 unreachable, cap, self-demotion), `verify:ai-audit-revert`;
live: `verify:ai-model-live` (`NOT RUN` without pack). Cover runtime/model missing, checksum mismatch, timeout,
cancel, queue saturation, crash/restart, malformed output, schema rejection, injection text, shutdown.

## Acceptance

- App works unchanged with no runtime/model; renderer cannot run arbitrary prompts/processes.
- Autonomy policy + audit + revert exist and are verified; T3 unreachable.
- Model pack separate from installer; output constrained; permissions explicit.
- Benchmark recorded with a go/no-go decision.
