# L1 — AI Foundation, Autonomy Policy & Performance Gate

Shared rules, architecture and decisions: `ROADMAP.md`. Depends on L0.

**Status (2026-09-19): IN PROGRESS.** `awkit-djnl.1` is `in_progress`. Implementation choices are in
`docs/ai/DECISIONS.md` (L1 entry).

| Task | State | Where |
|---|---|---|
| L1.1 AiService host | **Built, except the real host script.** Service, queue, protocol, utility-host manager and IPC. `native-hosts/ai/ai-host.cjs` is BLOCKED on the runtime-binding decision. | `src/ai/AiService.ts`, `src/ai/contracts/AiHostProtocol.ts`, `app/main/ai/*`, `app/main/ipc/ai.ipc.ts` |
| L1.2 Model pack | **Built:** import, SHA-256 against the manifest, status, remove. **BLOCKED:** the llama.cpp pin, the manifest entry and the notices need the runtime and pack. | `src/ai/AiModelPack.ts`, `src/offline/AiModelManifest.ts` |
| L1.3 Output contract | **Done.** | `src/ai/{AiPromptBuilder,AiOutputContract}.ts` |
| L1.4 Autonomy and audit | **Done.** The policy lives in `src/security/authz` (see DECISIONS). | `src/security/authz/AiAutonomyPolicy.ts`, `src/ai/{AiActionRecord,AiActionStore,AiRevert}.ts` |
| L1.5 Permissions and Settings | **Done.** | `Permissions.ts`, `src/ai/AiSettings.ts`, Settings › Local AI |
| L1.6 Resource integration | **Done:** yield, weighted admission, derived threads, idle unload. | `src/ai/AiAdmission.ts`, `WorkloadWeights.aiInferenceWeight`, `ExecutionEngine.getAiAdmissionView` |
| L1.7 Fake provider | **Done.** | `src/ai/FakeAiHostTransport.ts` |
| L1.8 Performance go/no-go | **BLOCKED:** no runtime or model. | — |

Verifiers: all listed below exist and pass, plus `verify:ai-settings-gui`. `verify:ai-model-live`
is not written until a host exists: NOT RUN.

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

**Owner steps.** The lease guard allows the agent only git, `build` and `verify:`/`validate:`/`benchmark:`
scripts, so an install or a download has to be run by the owner. Run both in PowerShell from the
repo root:

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
   curl.exe -L -o "$env:USERPROFILE\Downloads\Qwen3.5-4B-Q4_K_M.gguf" https://huggingface.co/lmstudio-community/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf
   ```

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
