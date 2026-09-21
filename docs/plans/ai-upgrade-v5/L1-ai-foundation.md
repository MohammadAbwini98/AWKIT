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
| L1.8 Performance go/no-go | **FAIL for the 4B on the qualifying host** (this development machine, all 12 logical CPUs): `locatorUpgrade` times out at 240 s against a 180 s ceiling, as it did on 6 CPUs. **Re-scoped to a smaller model (owner, 2026-09-21):** Qwen3.5-0.8B is **NO-GO** on 2 of 8 criteria (`validationExplanation` at cap, and cancel latency, `awkit-g555`), and Qwen3.5-2B is **NOT RUN** (not downloaded). See "Qwen3.5-0.8B measured" below. | `scripts/benchmark-ai-model.mts`, `evidence/L1.8-benchmark-full-host*.json` |

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
Originally a constrained 6-logical-CPU harness; since 2026-09-21 the qualifying host is this development machine
with all logical CPUs (owner re-scope, below). Neither is a VMware claim. Measure load time, RSS/peak, prompt tokens/s, generation
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

#### Isolated (2026-09-20): the grammar hypothesis is REFUTED. Evidence: `evidence/L1.8-inference-profile.json`

The split the section above could not reach is now measured by `verify:ai-inference-profile`, which
drives node-llama-cpp directly under the same `0x3F` mask and the same 3 threads, and varies **one
thing**: the JSON grammar. Both probes send the identical ~146-token prompt.

| probe | prompt eval | decode | TTFT |
|---|---|---|---|
| A — no grammar | 1.43 tok/s | 0.73 tok/s | 114,914 ms |
| B — **locatorUpgrade grammar** | 1.58 tok/s | 0.75 tok/s | 101,617 ms |

**The grammar-constrained probe is marginally FASTER** (`grammarDecodeSlowdown` 0.97,
`grammarTtftDeltaMs` −9,968). Grammar construction itself is 5–29 ms and cached. The prior leading
hypothesis — GBNF sampling over the vocabulary (which is 248,320 tokens, not ~151k) — is refuted:
its effect is smaller than the host's own run-to-run spread, which reached **2×** on repeated
identical probes. Storage is also cleared: the pack maps at ~183 MB/s and loads warm in 7.5 s.

**The bottleneck is raw throughput, and prompt evaluation is the larger half.** Prefill runs at
1.4–2.2 tok/s — roughly *half a decode step per prompt token*, when it should be an order of
magnitude cheaper. Decode is 0.64–1.10 tok/s. Projected from the measured rates:

| | budget | projected | over by |
|---|---|---|---|
| L1.8 packet (2,000 in / 192 out) | 180,000 ms | **1,654,601 ms** | 9.2× |
| — its 192-token output cap **alone**, free prompt | 180,000 ms | **256,000 ms** | 1.4× |
| Product call, `LOCATOR_ATTEMPT_LIMITS` (3,000 chars / 512 out) | **30,000 ms** | **1,242,107 ms** | 41× |

**No AWKIT-layer change closes this.** The output cap alone exceeds the ceiling with a free prompt,
so no prompt trimming helps; the grammar is free, so no decoding-strategy change helps; and the
runtime is a pinned offline prebuilt that cannot be rebuilt here. `native-hosts/ai/ai-host.cjs` was
inspected and is **not** implicated — no runtime lease was taken, because nothing in the host needed
changing.

**L3 §8 / L4b / L5b stay BLOCKED — now on a quantified hardware/model decision, not an open
question.** Remedy (2) from the list below is closed. The owner chooses between re-scoping the model
(a smaller or non-hybrid one), the ceilings, or the qualifying hardware. Note the measurement scope
itself is worth confirming: mask `0x3F` selects logical CPUs 0–5, which on a 6-core/12-thread part is
**3 physical cores**, not 6 — the harness has never verified that topology.

#### Re-scoped to the qualifying host (2026-09-21): still NO-GO. Evidence: `evidence/L1.8-benchmark-full-host.json`

**Owner decision:** L1.8 is re-scoped to the qualifying hardware, and the qualifying host is **this
development machine with all 12 logical CPUs and no affinity mask**. The model and every ceiling are
unchanged. `benchmark:ai-model` (`8e788187`) now:

- drops `start /affinity 3F`;
- derives inference threads from the host as the product does: `deriveInferenceThreads(12)` = **4**;
- writes a new evidence file, so the 6-CPU FAIL above stays on record untouched;
- answers NOT RUN on any other machine, so no host can overwrite or stand in for this one.

Measured once, host Intel i7-8750H, 12 logical CPUs, 16 GB:

| Criterion | Ceiling | Measured | |
|---|---|---|---|
| Cold model load | 60,000 ms | 57,041 ms (warm 10,503 ms) | PASS |
| Host peak working set | 6,144 MB | 3,823 MB | PASS |
| Main-loop delay p99 | 100 ms | 24 ms | PASS |
| `locatorUpgrade` background job | 180,000 ms | >240,000 ms ×2 (`AI_HOST_TIMEOUT`), no answer | **FAIL** |
| The five later scenarios | — | NOT RUN: the harness stops at the first failed scenario, as the 6-CPU run did | — |

Host CPU held a flat 30–31 % across both 240 s attempts (the same `percentCPUUsage` normalization
caveat as above applies, so the evidence is the flat line, not the absolute figure). Unconstraining the
machine did not change the outcome. The measured
gap (9.2× on the L1.8 packet, 1.4× from the 192-token output cap alone) was never within reach of the
extra cores. Cold load also moved closer to its ceiling: 57,041 ms here against 50,101 ms under the
mask, 2.9 s of margin.

**L1.8 FAILS on the qualifying host.** L1 stays `in_progress`, the conditional development
authorization stands, and L3 §8/§9, L4b, L5b and the L6 AI parts stay L1-gated. The remaining owner
options were the model or the ceilings. The owner then chose the model (next section).

#### Re-scoped to a smaller model (2026-09-21): both candidates prepared, NOT RUN until downloaded

**Owner decision:** re-scope L1.8 to a smaller model, and measure **both** smaller Qwen3.5 packs
separately. The qualifying host, the ceilings, the thread derivation and the 4B's evidence are all
unchanged. Both packs stay in the Qwen3.5 family, so the host's ChatML template with the thinking
block pre-closed applies as-is, and no host or runtime change is needed.

| Pack (lmstudio-community, Q4_K_M, Apache-2.0) | Bytes | Published SHA-256 | Evidence file | Command |
|---|---|---|---|---|
| `Qwen3.5-2B-Q4_K_M.gguf` | 1,270,808,032 | `0bfe35afc9f05b7fac3fa04925e051ac7939a42a8a17ea11afc99701bea826cc` | `L1.8-benchmark-full-host-Qwen3.5-2B-Q4_K_M.json` | `npm run benchmark:ai-model-2b` |
| `Qwen3.5-0.8B-Q4_K_M.gguf` | 527,502,816 | `f5b14da98939b60bbe1019a964eba656407e1e0b64f1fe3003ff6d650e93bfec` | `L1.8-benchmark-full-host-Qwen3.5-0.8B-Q4_K_M.json` | `npm run benchmark:ai-model-0-8b` |

Each SHA-256 was read twice, from the Hugging Face tree API and from the file's own page, and the two
agree. The harness refuses a download whose size or SHA-256 differs, so a truncated file under the
right name is never measured. As with the 4B, the manifest will pin the value **measured** from the
downloaded file. The published value is only a cross-check.

**Owner step (the lease guard has no download verb).** Run both commands in PowerShell. `-C -` and
`--retry` are there because the 4B's first attempt died mid-file:

```powershell
curl.exe -L -C - --retry 5 --retry-all-errors -o "$env:USERPROFILE\Downloads\Qwen3.5-2B-Q4_K_M.gguf" https://huggingface.co/lmstudio-community/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf
curl.exe -L -C - --retry 5 --retry-all-errors -o "$env:USERPROFILE\Downloads\Qwen3.5-0.8B-Q4_K_M.gguf" https://huggingface.co/lmstudio-community/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_K_M.gguf
```

**Projection, not evidence.** Scaling the measured 4B rates by parameter count, and assuming the fourth
thread helps linearly (both optimistic), puts the L1.8 packet at about 620,000 ms for the 2B (3.4× over
180 s) and about 250,000 ms for the 0.8B (1.4× over). Small models spend a larger share of each token in
the vocabulary-sized output head (248,320 entries on the 4B), which that scaling ignores. Only the
measurement decides.

**After a pack is measured:**

- **A GO** means every scenario passes, not just `locatorUpgrade`. Five scenarios have never run on any
  host. It would still owe:
  - pinning the measured pack in `AI_MODEL_MANIFEST`, with its license in the third-party notices;
  - `verify:ai-model-pack` and `verify:ai-model-live` on it;
  - the live quality gates. A smaller model is the likelier to fail on answer quality.
- **A NO-GO for both** leaves only the ceilings. Changing to a non-hybrid model would be a new owner
  decision.

**Not yet run:** the two harness refusals for an unknown pack and for a pack not yet downloaded. Both
stop before any model loads. They were BLOCKED in this session, because the lease guard refuses
`npm run <script> -- <args>` and marked that denial terminal. The named scripts exist so that no
arguments are needed. *Later the same day:* the not-downloaded refusal ran (`benchmark:ai-model-2b`
before its pack existed) and behaved correctly. The 0.8B script was renamed `benchmark:ai-model-0-8b`,
because the guard refuses a dot in a script name.

#### Qwen3.5-0.8B measured (2026-09-21): NO-GO on 2 of 8. Evidence: `evidence/L1.8-benchmark-full-host-Qwen3.5-0.8B-Q4_K_M.json`

The pack matched its published size and SHA-256 before any measurement. It is the **first pack to
complete all seven scenarios**, each run once, at `e391115e`.

| Criterion | Ceiling | Measured | |
|---|---|---|---|
| Cold model load | 60,000 ms | 7,449 ms | PASS |
| Host peak working set | 6,144 MB | 1,040 MB | PASS |
| `locatorUpgrade` at the 192-token cap | 180,000 ms | 151,241 ms (real answers in 121.9 / 124.6 s) | PASS |
| `failureAnalysis` at cap | 180,000 ms | 164,391 ms | PASS |
| `validationExplanation` at cap | 120,000 ms | 138,485 ms (1.15× over) | **FAIL** |
| Cancel latency | 3,000 ms | 74,490 ms | **FAIL** |
| Main-loop delay p99 | 100 ms | 36 ms | PASS |
| Playwright slowdown, yield on | 1.15 | 1.03 (1.04 with yield off) | PASS |

Prompt evaluation ran at 9.6–11 tokens/s and decode at 2.55–3.42 tokens/s.

**The cancel failure is not about the model.**

- **Both probes landed in prompt evaluation.** Each produced 0 output tokens before the cancel took
  effect.
- **The long probe:** it cancelled 1 s into an 829-token prompt and returned after 74,490 ms. That is
  the whole remaining evaluation at ~10.5 tokens/s. It is not the 512-token batch boundary, which
  would have come at ~49 s.
- **The "during generation" probe:** its fixed 6 s wait is shorter than this host's prompt time, so it
  also measured prompt evaluation (12,456 ms). Generation-phase cancel has never been measured.
- **Consequence:** any prompt that takes more than 3 s to evaluate fails this ceiling on this host,
  whatever the model. L1.8 cannot pass until cancellation frees the CPU during prompt evaluation.
- **Tracking:** filed as **`awkit-g555`** (bug, P2), which **blocks `awkit-djnl.1`**.
- **Fix options, an owner or architect decision:**
  - evaluate the prompt in checked chunks;
  - or hard-kill and restart the host after a short grace period, at the cost of a reload (7.4 s for
    the 0.8B).
  - Either way, fix the probe to wait for the first output token, then re-measure.

**`validationExplanation` is plain throughput.** Its worst case is 697 prompt tokens at ~11 tokens/s,
plus its 192-token cap at 2.73 tokens/s. That comes to 138.5 s against 120 s.

**Qwen3.5-2B: NOT RUN.** Its pack is not on disk.

**Superseded remedy list (kept for the record).** The owner must
choose: (1) authorize a `runtime`-routed change so the host reports timings on timeout (or add a
grammar-off probe) and separate prefill from decode; then (2) if constrained decode dominates, revisit
the decoding strategy; **or** (3) accept that a 4B Q4_K_M on a 2018 6-core mobile CPU is below the bar
and re-scope the model, the ceilings, or the qualifying hardware. No ceiling was moved and no timeout
was raised to hide throughput.

## L1 status: PARTIAL PASS — CONDITIONAL FOR DEVELOPMENT, NOT APPROVED FOR RELEASE (owner, 2026-09-20)

The owner has read the NO-GO above and decided that Phase L **development** continues without waiting
for it. This section records what that authorization does and does not cover. **It changes no measured
number, no ceiling and no gate result.** `evidence/L1.8-benchmark.json` and
`evidence/L1.8-inference-profile.json` are unchanged, `benchmark:ai-model`'s `locatorUpgrade` scenario
is still a **FAIL**, and nothing below reclassifies it.

| L1 task | State | Counts toward |
|---|---|---|
| L1.1 AiService host | PASS — `verify:ai-host` 135/0 + 12/12 mutations; `verify:ai-host-electron` 20/0 (`7f441a38`) | development + release |
| L1.2 Model pack, manifest and runtime pin | PASS — `verify:ai-model-pack` 46/46, 1 pinned pack (`a28050c7`) | development + release |
| L1.3 Output contract | PASS — `verify:ai-adapter` 102/0, `verify:ai-redaction` 52/0 | development + release |
| L1.4 Autonomy policy, audit, revert | PASS — `verify:ai-autonomy-policy` 62/0, `verify:ai-audit-revert` 69/0 | development + release |
| L1.5 Permissions and Settings | PASS — `verify:ai-permissions` 75/0 | development + release |
| L1.6 Resource integration | PASS — `verify:ai-adapter` yield/admission sections | development + release |
| L1.7 Fake provider | PASS — `verify:ai-fallback` 38/0 | development + release |
| **L1.8 live inference latency** | **FAIL** — `locatorUpgrade` >240,000 ms against a 180,000 ms ceiling; product path `TIMEOUT` at 120 s | **release only — unmet** |

**What the authorization permits.** Building the AI-dependent features — L3 §8/§9, L4b, L5b and the L6
*Intelligence* section — against the **deterministic providers that already exist**
(`FakeAiHostTransport`, the scripted plan fixtures L3 §4–§7 use). Those features are structurally
independent of inference throughput: the contract, the compiler, the intent guard, the proof gates, the
policy and the audit trail are all deterministic, and L3 §2–§7 and §10 were already built this way while
L1 stayed open. Building them now is what makes the eventual model decision a *swap*, not a rewrite.

**What it does NOT permit, and what an agent must not do with it.**

1. **No milestone closes on it.** `awkit-djnl.1` stays `in_progress`. The `blocks` edges L1 → L3, L1 →
   L4b and L1 → L5b are **correct and stay**, because they encode *acceptance*, not *permission to type*.
   A milestone whose acceptance criteria name live-model behavior cannot be closed while L1.8 fails.
2. **No ceiling moves and no gate is relabelled.** The 180,000 ms background-job ceiling, the 30,000 ms
   `LOCATOR_ATTEMPT_LIMITS.timeoutMs` and the recorded measurements stay exactly as they are. A `FAIL`
   is never rewritten as `BLOCKED`, `INCONCLUSIVE` or `PASS`.
3. **No production feature may require a model to behave correctly.** Every AI path keeps its existing
   guarantee: no model, a disabled model, a timeout or a crash leaves behavior identical to today. A
   deterministic provider is a **test** substitute, never a shipped one.
4. **No release claim.** The live gates `verify:ai-model-live`, `benchmark:ai-model` and
   `verify:ai-locator-quality-live` remain the only evidence that would satisfy L1.8, and none of them
   passes. L7 cannot be entered on this authorization.

**Still outstanding for L1 acceptance:** the qualifying hardware was re-scoped on 2026-09-21 to this
machine with all 12 logical CPUs, and the 4B still FAILS there (see "Re-scoped to the qualifying
host"). The owner then re-scoped the model to Qwen3.5-2B and Qwen3.5-0.8B. The 0.8B is NO-GO on 2 of 8
criteria, and its cancel failure (`awkit-g555`) blocks L1 for any model. The 2B is NOT RUN because it
is not downloaded (see "Qwen3.5-0.8B measured").

## Verifiers

`verify:ai-adapter`, `verify:ai-redaction`, `verify:ai-fallback`, `verify:ai-permissions`, `verify:ai-model-pack`,
`verify:ai-autonomy-policy` (tier matrix, T3 unreachable, cap, self-demotion), `verify:ai-audit-revert`;
live: `verify:ai-model-live` (`NOT RUN` without pack). Cover runtime/model missing, checksum mismatch, timeout,
cancel, queue saturation, crash/restart, malformed output, schema rejection, injection text, shutdown.

`verify:ai-inference-profile` (`NOT RUN` without pack) is the **diagnostic** counterpart to
`benchmark:ai-model`: it splits one inference into prompt evaluation, decode and grammar cost, so a
missed ceiling says *why*. It asserts that measurements exist, never that they meet a ceiling —
`benchmark:ai-model` alone judges the numbers.

## Acceptance

- App works unchanged with no runtime/model; renderer cannot run arbitrary prompts/processes.
- Autonomy policy + audit + revert exist and are verified; T3 unreachable.
- Model pack separate from installer; output constrained; permissions explicit.
- Benchmark recorded with a go/no-go decision.
