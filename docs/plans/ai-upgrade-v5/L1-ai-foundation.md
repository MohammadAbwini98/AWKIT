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
| L1.8 Performance go/no-go | **FAIL for the 4B on the qualifying host** (this development machine, all 12 logical CPUs): `locatorUpgrade` times out at 240 s against a 180 s ceiling, as it did on 6 CPUs. **Re-scoped to a smaller model (owner, 2026-09-21):** Qwen3.5-0.8B is **NO-GO on 1 of 8** after the `awkit-g555` kill-and-restart fix: only `validationExplanation` at cap still fails, 132,300 ms against 120,000. Qwen3.5-2B is **NOT RUN** (not downloaded). See "Qwen3.5-0.8B after the cancel fix" below. | `scripts/benchmark-ai-model.mts`, `evidence/L1.8-benchmark-full-host*.json` |

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

#### Qwen3.5-0.8B after the cancel fix (2026-09-21): NO-GO on 1 of 8. Evidence: same file, at `d8162f86` (pre-fix run at `e391115e`)

**The fix (owner's choice, kill-and-restart, `6ca6297a`):**

- **The kill:** `AiUtilityHostManager` tracks each inference until the host answers it. If a
  cancelled inference is still running after `AI_HOST_TIMEOUTS.cancelGraceMs` (1,000 ms), the
  manager kills the host.
- **After the kill:** it is an intentional exit, so no restart strike. The next call starts a fresh
  host, and both the inference and the cancel reject with the new manager-raised
  `AI_HOST_KILLED_ON_CANCEL`.
- **When a cancel returns:** only once its inference has left the host. `AiService` needs that so a
  timed-out job's successor cannot land on a host about to be killed.
- **The service side:** `AiService` treats a kill as a cancel. A yield is requeued and a user cancel
  ends cancelled. In both cases it forgets the loaded model, so the next job re-handshakes and
  reloads.

**Proven by:**

- `verify:ai-adapter`: 117/117, mutation-tested 2/2.
- `verify:ai-host-electron`: 26/0, mutation-tested 2/2. That is the production manager against a stub
  host whose inference ignores cancels, including a negative control that a cooperative cancel kills
  nothing.

The fingerprint now includes `cancelGraceMs`, so all seven scenarios ran again.

| Criterion | Ceiling | Measured | |
|---|---|---|---|
| Cold model load | 60,000 ms | 7,183 ms | PASS |
| Host peak working set | 6,144 MB | 1,051 MB | PASS |
| `locatorUpgrade` at cap | 180,000 ms | 120,499 ms | PASS |
| `failureAnalysis` at cap | 180,000 ms | 139,615 ms | PASS |
| `validationExplanation` at cap | 120,000 ms | 132,300 ms (1.10× over) | **FAIL** |
| Cancel latency | 3,000 ms | 1,020 ms | **PASS** (was 74,490) |
| Main-loop delay p99 | 100 ms | 40 ms | PASS |
| Playwright slowdown, yield on | 1.15 | 0.99 (1.03 with yield off) | PASS |

- **Cancel during prompt evaluation:** settled by the kill in 1,020 ms, which is the grace plus a 20 ms
  exit.
- **Cancel during generation:** measured for the first time. The probe now cancels 2 s after this
  prompt's measured first token. It was settled **by the host itself in 62 ms**, with 10 output tokens
  and no kill, so a cancel mid-answer costs no reload.
- **Playwright contention:** 3 kills and reloads, while the slowdown stayed within the ceiling.
- **Packet numbers vary between runs:** `locatorUpgrade` at cap was 151 s before and 120 s now. The fix
  touches only the cancel paths, so read these as run-to-run variance.
- **A harness defect, and a sequencing mistake:**
  - The `playwright` scenario's contention loop awaited a cancel that now correctly rejects, and after
    a kill it would have run its next workload beside a host with no model. It failed twice.
  - The second failure was my accidental retry at an unchanged state.
  - The loop now accepts the kill and reloads, and the scenario passed on its one corrected run.

**L1.8 is still NO-GO on the 0.8B,** on `validationExplanation` alone. It is plain throughput: about
700 prompt tokens at ~11 tokens/s, plus a 192-token cap at under 3 tokens/s.

#### `validationExplanation` fixed in the product (2026-09-21): GO on all 8. Evidence: same file, at `f58cf28f` (the unchanged product request at `7f0e931e`)

**Root cause: the measured packet was never the product's request, and the product's request was
worse.**

- **A stand-in.** The packet was written with the harness (`9c252885`), before L4b built the feature
  (`510bdbe2`). Two of its three DATA blocks were validator messages and flow text, which
  `buildAuthoringRequest` is designed never to send. Its nonce was 32 hex; `AiService` generates 16.
- **The product's own request**, measured once through the unchanged builder at `7f0e931e`, sent 552
  prompt tokens with a 512-token output cap: **222,036 ms at cap**. And the real 0.8B explained **none**
  of the 5 issues in either run, because the grammar let it skip them all.
- **Where the time goes** (two runs each; wall time minus prompt and generation was 1–41 ms per run,
  so scheduling and grammar setup are negligible):

| Request | Prompt tokens | Prompt evaluation | Output | At cap |
|---|---|---|---|---|
| Synthetic stand-in (`d8162f86`) | 697 | 57,973–64,932 ms, 10.7–12 tok/s | 23 tokens; cap 192 at 2.85–3.11 tok/s | 132,300 ms |
| Product request, unchanged (`7f0e931e`) | 552 | 32,638–58,979 ms, 9.4–16.9 tok/s | 53 tokens, **0 explanations**; cap 512 | 222,036 ms |
| **Product request, fixed (`f58cf28f`)** | **334** | **24,275–29,929 ms, 11.2–13.8 tok/s** | **151 tokens, 2 of 2 explained**; cap 192 at 3.29 tok/s | **88,288 ms** |

**The harness change (`7f0e931e`).** The packet is now built the way `explainFlowValidation` builds its
job: the real `FlowValidator` over a flow with casing mistakes on two conditional connectors, so every
line sent carries a fix marker, the longest line the builder writes. It lives in the Electron-free
`scripts/ai-harness/validationExplanationPacket.ts`. The launcher records a SHA-256 identity of the
built prompt, schema and cap, and a packet scenario whose identity no longer matches the checkout is
measured again. Each answer is checked by the product's own `parseAuthoringAnswer` and recorded as
counts, never text. A refused answer fails the step.

**The fix (`d2a81262`, `src/ai/authoringExplanation.ts`):**

- **Send what one answer explains.** `maxIssues` 24 → 2. Blocking issues go first, and the rest are
  counted in `truncated`, which the designer already reports.
- **One DATA block.** Each block costs two nonce delimiters. `RepairableIssueIds` repeated the per-line
  `fixable=` marker, so it is gone, and each fix kind's product-authored summary rides on its line.
- **The anchor's kind, not its id.** A recorded step's id is a UUID the model cannot use, and an answer
  maps back through `request.issues`. The prompt's size is now a function of product constants alone,
  so the benchmark's worst case is the product's.
- **Every issue sent is explained.** `minItems` equals the number sent.
- **No placeholder ranking.** With nothing fixable, the schema has no `ranking`. The old `["none"]`
  enum decoded into an id that `parseAuthoringAnswer` refuses, which discarded the whole answer.
- **Output budget.** `maxOutputTokens` 512 → 192, this feature's L1.8 budget, and `maxExplanationChars`
  400 → 160. The runtime's JSON grammar allows indentation, and the 0.8B uses it: 151 tokens for
  2 × 116 characters, about 90 of them structure. Two explanations at the limit plus a full ranking
  still fit, which matters because an answer cut off at the cap is invalid JSON and is discarded whole.
- **A fabrication path closed.** The prompt builder's 1,200-character default field cap cut the Issues
  list while the grammar still offered all 24 ids, so a model could explain an issue it never saw.

**Explanation quality, measured on the real 0.8B (both runs):**

- The product accepted both answers. Ids come from the report, with no duplicates, no empty or
  over-long text, and no control characters.
- 2 of 2 sent issues were explained, and both texts name their issue's subject.
- 116 characters each, 0 residual secrets, nothing ranked (the ranking is optional).
- `stop` at 151 of 192 tokens: the answer ended by itself, not at the cap.
- **Limit of this evidence:** model text is never recorded, so "actionable" rests on these proxies,
  not on a person reading the answers. `verify:ai-authoring-quality-live` is still not built. *(Built
  at `1126c1b6`: L4 › "The live quality gate as built".)*

**Margin.** 88,288 ms is 26 % under the ceiling. *Projection, not evidence:* at the slowest rates this
host has shown for this pack (prompt 9.4 tok/s, decode 2.55 tok/s), 334 tokens plus the 192-token cap
come to about 110.8 s, still under.

**Unchanged:** the 120,000 ms ceiling, the pack, the fingerprint, and the other six scenarios'
`d8162f86` results. An intermediate run at `maxExplanationChars` 180, before it was lowered to 160,
measured 87,095 ms with the same counts and was not committed.

**Still open:**

- ~~**The product timeout.**~~ Fixed the same day; see the next section.
- **The other two packets** still carry the harness's 32-hex nonce. That only overstates them, and they
  pass.
- **A GO still owes** the pin in `AI_MODEL_MANIFEST` with its license notice, `verify:ai-model-pack`
  and `verify:ai-model-live` on the 0.8B, and the live quality gates.

**Superseded remedy list (kept for the record).** The owner must
choose: (1) authorize a `runtime`-routed change so the host reports timings on timeout (or add a
grammar-off probe) and separate prefill from decode; then (2) if constrained decode dominates, revisit
the decoding strategy; **or** (3) accept that a 4B Q4_K_M on a 2018 6-core mobile CPU is below the bar
and re-scope the model, the ceilings, or the qualifying hardware. No ceiling was moved and no timeout
was raised to hide throughput.

#### `validationExplanation` gets its own deadline (2026-09-21): delivered on the real 0.8B. Evidence: `verify:ai-explanation-live` at `d2f5feb2`

**Root cause: the benchmark and the product applied different deadlines.**

- **The benchmark** calls the host directly, with a 240 s harness deadline. It could not see the
  product's deadline.
- **The product** gives each inference its job's `timeoutMs`. `AUTHORING_LIMITS.timeoutMs` was 30,000
  ms, the same as every other feature, so every real explanation was cancelled. Observed on the 0.8B
  through the production path with the old value: **TIMEOUT at 30 s, 0 of 2 explained, both times.**
- **A second boundary sat behind it.** `AI_SERVICE_LIMITS.maxJobTimeoutMs` (120,000 ms) refuses any
  longer job as `INVALID_REQUEST`, which the designer shows as "could not answer". Raising only the
  feature's timeout would have broken every explanation (mutation below).

**The trace.** One deadline covers an explanation, and it is armed in one place:

1. `explainFlowValidation` submits `AUTHORING_LIMITS.timeoutMs`.
2. `AiService.submit` refuses a value above `maxJobTimeoutMs`, and `execute` passes it to the infer call.
3. `AiUtilityHostManager.call` arms the timer when it posts the infer. The handshake and model load come
   first, under their own `helloMs` and `loadMs`, and queue time is not counted. A yield re-arms it on
   the next attempt.
4. On expiry `AiService` cancels on the host (`cancelMs`, 2 s). A cancel the runtime cannot honour kills
   the host after `cancelGraceMs` (1 s). The job ends TIMEOUT.

The host and the renderer apply no deadline of their own.

**The policy (owner instruction, 2026-09-21):**

- `AUTHORING_LIMITS.timeoutMs` 30,000 → **125,000 ms**: this feature's L1.8 ceiling, 120,000 ms at
  the output cap, plus 5,000 ms over the overhead measured beside it. That overhead is under 0.1 s:
  wall minus prompt and generation ≤ 41 ms, main-loop delay ≤ 61 ms.
- `AI_SERVICE_LIMITS.maxJobTimeoutMs` 120,000 → **125,000 ms**, the longest per-feature deadline.
- **Unchanged:**
  - fragment summary, failure analysis and locator attempts keep 30,000 ms;
  - the ceiling, the model, the output budget (192 tokens, 160 characters) and the manifest;
  - the benchmark's packet identity and fingerprint. Neither includes a timeout, so its evidence
    stands.

**Real-model evidence.** `verify:ai-explanation-live`, 5/5: the production path in a real Electron
utility process, over the benchmark's own flow.

| Step | Result |
|---|---|
| Cold explanation (the model load comes before the deadline) | OK, 2 of 2 explained. 51,509 ms of inference (prompt 18,605, generation 32,904; 328 prompt and 157 output tokens), 58,726 ms with the load. The host call carried 125,000 ms. |
| User cancel 35 s in | CANCELLED in 443 ms, settled by the host, no kill |
| A 5 s deadline in prompt evaluation | TIMEOUT. The host was killed as an intentional exit (0 strikes), and the model forgotten. |
| The next explanation | Reloaded. OK, 2 of 2 explained, 62,704 ms of inference (26,642 + 36,062), 71,442 ms with the reload. |

With `timeoutMs` back at 30,000 the same run fails 3 of 5: both explanations end TIMEOUT with 0
explained, and the 35 s cancel finds the job already gone.

This run was faster than the benchmark's (51–63 s of inference against 70–76 s). Read that as
run-to-run variance: the prompt is the same request, 328 tokens here against 334 with the benchmark's
fixed nonce.

**Regression suites:**

- **`verify:ai-authoring` §10, 125/125 (was 98).** It runs on a virtual clock, with the production
  `AiService` limits and the fake transport applying deadlines as the manager does:
  - an answer at 31 s is delivered, and so is one at the ceiling plus the measured overhead;
  - a hang ends TIMEOUT exactly at 125 s, and the inference is cancelled on the host;
  - a user cancel at 60 s ends CANCELLED, counted once;
  - an answer due after the deadline completes nothing, then or later, and never reaches the next job;
  - a prompt evaluation stuck at the deadline ends TIMEOUT by a kill, and the next explanation
    re-handshakes and reloads;
  - a fragment summary still times out at its own 30 s.
- **Mutation-tested 3/3:** the old 30 s fails 9 checks, the old 120 s cap fails 35, and a fragment
  summary raised to 125 s fails 2.
- **`verify:ai-assist-gui`, 97/0 (was 92).** In real Electron, an answer arriving after 31 s is
  delivered and rendered under the findings it explains. With the old value those 4 checks fail.

**Not changed, and a risk:** `locatorUpgrade` and `failureAnalysis` still get 30 s. Their benchmark
packets take 80–105 s on this host, so they may time out in the product the same way. Those packets are
synthetic stand-ins, as the explanation's once was. That risk was not measured through the product, and
was out of this task's scope. *(Measured and fixed the next day; see the next section.)*

#### `failureAnalysis` and `locatorUpgrade` measured through the product (2026-09-22): own deadlines set; both exceed their ceiling at their own output cap. Evidence: `verify:ai-failure-analysis-live` and `verify:ai-locator-upgrade-live` at `d71ee244`

**What was measured.** Each feature's own request on the real 0.8B, sent by the product's own code
through the production `AiService`, `AiUtilityHostManager` and `ai-host.cjs`:

- **`failureAnalysis`** through `analyzeFailure`, the function behind `ai:analyzeFailure`. Two failures,
  both built by L5a's real evidence buffer and cause baseline: a typical one (a server error, then the
  runner's assertion) and the largest the request sends (15 events, 12 offered; every offered line fits
  the prompt).
- **`locatorUpgrade`** through `runLocatorUpgradeAttempts`, the L3 §7 job. Two capture contexts, bounded
  by L2's `sanitizeUpgradeContext`: the Feature Test Lab's, and one with every field at L2's caps.
  - **Nothing in the product queues this job yet.** `locatorUpgradeService.ts` keeps it unwired until
    L1's go/no-go, so its new deadline takes effect when it is wired.
  - The browser proof is stubbed as "page unavailable". It runs after the model answers, outside any
    deadline.

**At the old shared 30 s** (the observed "before" run): all four requests ended TIMEOUT at 30 s, with
nothing analysed and no plan.

**The policy (owner instruction, 2026-09-22), the same rule as the explanation's:**

- Each feature's L1.8 ceiling, `backgroundJobAtCapMs` 180,000 ms at the output cap, plus 5,000 ms:
  - `FAILURE_ANALYSIS_LIMITS.timeoutMs` 30,000 → **185,000 ms**;
  - `LOCATOR_ATTEMPT_LIMITS.timeoutMs` 30,000 → **185,000 ms per attempt** (a job makes at most 2).
- `AI_SERVICE_LIMITS.maxJobTimeoutMs` 125,000 → **185,000 ms**, the longest per-feature deadline.
- **Unchanged:** the explanation's 125,000 ms, the fragment summary's 30,000 ms, the ceilings, the
  model, the output budgets, the manifest, and the benchmark and its evidence.

**Measured under the new deadlines** (inference time; prompt and output tokens in brackets):

| Run | `failureAnalysis` typical | `failureAnalysis` largest | `locatorUpgrade` typical | `locatorUpgrade` largest |
|---|---|---|---|---|
| A | 117.4 s (499 / 271) | 152.9 s (853 / 301) | 75.8 s (541 / 95), accepted | 113.2 s (887 / 59), accepted |
| B | 152.3 s (489 / 171) | **TIMEOUT at 185 s** | 85.6 s (513 / 94), accepted | 129.8 s, refused `UNSUPPORTED`; retry 124.9 s (971 / 66), accepted |
| C | **TIMEOUT at 185 s** | **TIMEOUT at 185 s** | — | — |
| D | 97.0 s (509 / 126) | 159.9 s (893 / 204) | — | — |

- **Host variance is large.** Runs B and C followed A back to back, and prompt evaluation fell from
  10.7–12.0 to 5.9 tokens/s. Run D came after about 20 minutes without inference, with the CPU 18% busy
  beforehand. The explanation's own request, re-run the same day, took 85.1 s where it had taken 51.5 s
  the day before.
- **The deadline holds the ceiling. The requests do not fit it:**
  - At the 512-token output cap both features use, every measured answer projects to 181–293 s
    (`failureAnalysis`) and 233–300 s (`locatorUpgrade`), against 180 s.
  - The benchmark measured stand-ins for both, at 256- and 192-token caps, which is why it passed.
    This is the gap the explanation had before `d2a81262`.
  - Real locator plans are short (59–100 tokens), so they fit with room to spare.
  - Real analyses run 126–301 tokens, and the largest analysis still hit 185 s on a hot CPU.
- **Every real failure analysis was refused by the answer contract.** The recorded refusals (runs B and
  D) are all `CONTRADICTORY`: the model set `insufficient: true` and still wrote a conclusion. The
  grammar allows that shape and the parser refuses it. This is flagged as its own task; it is not a
  deadline issue, and it was not changed here. *(Fixed at `5ef4852f`; see the next section.)*

**Owner decisions this leaves:**

1. Bring both requests inside their ceiling, as `d2a81262` did for the explanation: output budgets at
   the L1.8 figures, and, for failure analysis, a smaller answer, since its measured answers exceed 256
   tokens. Or re-scope the ceilings. *(Done for failure analysis at `42655904` and for the locator
   upgrade at `4a846c41`; see "`failureAnalysis` inside its ceiling at its own output cap" and
   "`locatorUpgrade` inside its ceiling at its own output cap".)*
2. Re-point the benchmark's two packets at the product's requests, as `7f0e931e` did for the
   explanation. *(Done for failure analysis at `42655904` and for the locator upgrade at `4a846c41`.)*

**Regression suites:**

- **New `verify:ai-deadlines`, 41/41** on a shared virtual clock (`scripts/lib/virtual-clock.mts`):
  - a table of every feature's deadline against its ceiling and the service limit;
  - `analyzeFailure`: answers after 31 s and at the ceiling plus overhead are delivered and saved; a
    hang ends TIMEOUT at exactly 185 s with nothing saved; a cancel at 60 s ends CANCELLED; a late answer
    is never saved and never reaches the next request; a kill at the deadline is followed by a reload;
  - `runLocatorUpgradeAttempts`: the same cases, plus a second attempt that gets a full deadline of its
    own.
- **Mutation-tested 4/4:** failure analysis at 30 s fails 9 checks; the locator at 30 s fails 7; the
  service limit left at 125 s fails 32; and a limit raised past every feature fails 1.
- **`verify:ai-assist-gui`, 97/0.** The run-detail analysis now arrives after 31 s, and is still shown
  labelled, cited and saved with the report.
- **`verify:ai-locator-attempts`, 87/87.** Its two timeout tests no longer wait out the real 185 s. The
  transport reports the deadline at once, or the host dies 2 s in; the exact deadline is proven in
  `verify:ai-deadlines`.

#### The failure-analysis answer contract, fixed (2026-09-22): the real 0.8B's analyses are accepted and classified. Evidence: `verify:ai-failure-analysis-live` at `5ef4852f`

**Root cause.** node-llama-cpp 3.21.1 builds its JSON grammar with **every property required, in
schema order**, whatever the schema's `required` says (`getGbnfJsonTerminalForGbnfJsonSchema` marks each
field required, and `GbnfObjectMap` emits them all). v1's answer had seven keys, two of them `required`:

- the model therefore decided `insufficient` as its second token, before writing anything;
- it then had to write a `category` and an `explanation` anyway;
- the prompt told it to "set insufficient to true and say so";
- and the parser refused any category or explanation beside `insufficient: true` as `CONTRADICTORY`.

The grammar, the prompt and the parser disagreed, and every real answer landed in that gap.

**The contract now (`src/ai/failureAnalysis.ts`):**

- The answer is `{version: 1, conclusion: [...]}`, with at most one conclusion. **An empty list is the
  insufficient answer**, and nothing can be written beside it: declining is one decision, `[]` or `[{`.
- A conclusion cites first — `primaryEvidenceIds` (at least one), `secondaryEvidenceIds` — then
  `category`, `explanation` and `investigationSteps`. Every key is `required`, as the grammar writes
  them all.
- **Where declining is true is decided from the evidence, not by the model.** Left to the model, the
  0.8B chose wrongly on all three requests (table below). So:
  - a baseline resting on **direct** evidence (`DIRECT_FAILURE_CAUSES`, exported from L5a's own table)
    must conclude (`minItems` 1). The drawer shows that cause directly above the AI's answer, so "not
    enough evidence" beside it would be the report contradicting itself;
  - a request offering **nothing but the runner's own failure record** can only decline (`maxItems` 0);
  - otherwise — a runner cause with console errors beside it — the model decides.
- **The runner's own failure record is never primary evidence.** It records that the step failed, never
  why, and the 0.8B cited it as the cause of a bare timeout. It may still be cited as a consequence.
- The parser re-checks every rule the grammar enforces: `CONTRADICTORY` for a decline beside a direct
  cause, or v1's flag against the list; `UNSUPPORTED_CONCLUSION` for a conclusion resting on nothing or
  on the runner's record; `MALFORMED` for an empty explanation or a key the schema does not name.
- **Unchanged:** the stored body, the IPC view, the renderer, redaction and the residual-secret rescan,
  the evidence bounds, the 185 s deadline, the 512-token output cap, the model and the benchmark.

**Measured on the real 0.8B** through `analyzeFailure`, `AiService`, `AiUtilityHostManager` and
`ai-host.cjs`. The gate now fails unless each answer is delivered, accepted, saved and classified as its
fixture requires; the typical conclusion must also cite the event its cause rests on.

| Contract | Typical (HTTP 500, then the assertion) | Bare runner timeout | Largest (15 events, 12 offered) |
|---|---|---|---|
| v1 (runs B and D above) | refused `CONTRADICTORY` | — | refused `CONTRADICTORY`, or TIMEOUT |
| v2, the model decides | accepted as insufficient (wrong) | a conclusion citing its own failure record (wrong) | accepted as insufficient (wrong) |
| v2, concrete decline rule in the prompt | accepted conclusion citing the HTTP 500 | same conclusion (wrong) | accepted as insufficient (wrong) |
| **v2, evidence tiers (`5ef4852f`)** | **accepted conclusion citing the HTTP 500**, 63.8 s (463 / 181 tokens) | **accepted as insufficient**, 35.0 s (428 / 22) | **accepted conclusion**, 128.1 s (897 / 227) |

The final run started with the CPU 13% busy. The grammar premise is read from node-llama-cpp's source,
not measured; the v1 refusals are consistent with it, since every recorded one wrote a category or an
explanation beside `insufficient: true`.

**What the gate does not show:**

- **The largest conclusion cites all 11 cause candidates as primary.** It is accepted and grounded (each
  id is offered evidence), but it does not single out a cause. Primary citations are capped at the
  evidence offered, as in v1; a tighter cap is a quality decision for the labelled set
  (`verify:ai-error-quality-live`, not built; *built at `4f81424a`, see L5 › "The live quality gate as
  built"*).
- **Latency is unchanged and still open.** At the 512-token cap the typical request projects to 127 s and
  the largest to 199 s, against the 180 s ceiling (see the section above). *(Fixed at `42655904`; see the
  next section.)*
- **A bare runner timeout still costs one model call** (35 s here) whose only decodable answer is a
  decline. Answering it without the model, as an insufficient baseline already is, would change what is
  analysed, so it is left to the owner.

**Regression suites:**

- **`verify:ai-error-analysis`, 185/185 (was 140).** A new section enumerates every answer the grammar
  can decode in each evidence tier and requires each one to be accepted and correctly classified; the
  only permitted refusal is an id listed twice, which no grammar can express.
- **Mutation-tested:** v1's free flag restored → 178/185, naming `CONTRADICTORY` as decodable; the
  runner's record accepted as primary → 183/185; a decline decodable beside a direct cause → 183/185;
  the parser's decline check and v1's prompt together → 182/185, each failing only its own checks.
- **`verify:ai-assist-gui`, 100/0 (was 97).** In real Electron, a decline beside the run's direct cause
  is refused, and the saved, cited analysis stays on screen.

#### `failureAnalysis` inside its ceiling at its own output cap (2026-09-22): GO. Evidence: `packets:failureAnalysis` (now the product's request) and `verify:ai-failure-analysis-live` at `42655904`

**Root cause: the output cap alone was most of the ceiling, and most of the prompt was delimiters.**

- **The cap.** `FAILURE_ANALYSIS_LIMITS.maxOutputTokens` was 512. At the decode rates this host has shown
  for the 0.8B (2.55–4.6 tokens/s), 512 tokens alone project to 110–200 s, before any prompt
  evaluation. No prompt trim can meet 180 s at that cap.
- **The prompt.** Counted on the pack's own tokenizer (`verify:ai-failure-analysis-budget`), each
  nonce-delimited DATA block costs about 45 tokens before its content. Four of the request's five
  blocks carried no evidence: the typical failure's `AffectedInstances` spent 50 tokens to say `["1"]`.
- **A grounding defect beside it.** The evidence list was one text field under the prompt builder's
  1,200-character default cap, which cuts text, not lines. The largest failure's twelfth line reached
  the model as `ev8: http.error (err`, its status gone, while the grammar still offered `ev8`. The
  live gate reported 12 of 12 shown because it checked only each line's prefix.

**Baseline, measured through the product at `82b83c6c`** (`verify:ai-failure-analysis-live`, host 12%
busy): typical 513 prompt / 198 output tokens, 30.8 s prompt evaluation + 43.0 s generation = 73.8 s,
**142.5 s at the cap**; bare runner timeout 412 / 22, 42.5 s; largest 887 / 211, 76.3 s + 58.7 s =
135.0 s, **219.3 s at the cap**. The longest answer the old grammar admitted: 398 (typical) and 463
(largest) tokens.

**The change (`42655904`, `src/ai/failureAnalysis.ts`):**

- **Output budget 512 → 256**, this feature's L1.8 budget (§L1.8, item 4).
- **An answer sized to fit it,** because an answer cut at the cap is invalid JSON and is discarded whole:
  2 ids per citation list (was up to 11 primary and 12 secondary), explanation 600 → 260 characters,
  steps 4 × 200 → 2 × 150, category unchanged at 40. The parser re-checks the list caps.
- **Brevity asked for,** since the model never sees the schema: the instructions now ask for "a short
  category, a one- or two-sentence explanation and up to two brief things to check". A text the
  grammar ends at its `maxLength` would end mid-sentence. The decline sentence is unchanged.
- **One DATA block where there were four.** The deterministic conclusion, the ids it rests on, the
  instance count (only when more than one) and the evidence lines are one `Failure` text block. The
  routes stay in the unredacted `ids` channel, as L5b decided.
- **Whole-line evidence.** Lines are taken most important first while they fit `maxEvidenceChars`
  (1,500), and only shown ids are offered. 1,500 keeps all twelve of the largest failure's lines whole
  (1,255 characters); 1,200 would have dropped its payment gateway's 502. The lead event always goes,
  cut only if it alone exceeds the budget.
- **Unchanged:** the tiered decline/conclude contract, the runner-record rule, every payload field and
  its rendering, redaction and the residual-secret rescan, the stored body, IPC and renderer, the 185 s
  deadline, the 180 s ceiling and the model.

**Where the prompt went** (tokens, fixed 16-hex nonce, template included):

| Request | Before (5 blocks) | After (1 block + routes) |
|---|---|---|
| Typical | 523: system 168, conclusion 67, its ids 55, evidence 102, routes 60, count 50 | **396**: system 179, `Failure` 139, routes 60 |
| Bare runner timeout | 444 | **317** |
| Largest | 897, its twelfth line cut | **788**, all twelve lines whole |

**The answer against its cap** (the longest the grammar admits and the parser accepts, digit-dense
English at every limit): typical 220 / 232 tokens (4-space / tab indentation), largest 236 / 250, and
with the longest ids L5a mints (`ev200`) **240 / 254 ≤ 256**.

**Measured on the real 0.8B after the change:**

| Run | Typical | Bare runner timeout | Largest |
|---|---|---|---|
| `verify:ai-failure-analysis-live`, host 8% busy | accepted conclusion citing its HTTP 500: 388 / 141 tokens, 21.6 + 28.6 = **50.2 s**, 74.0 s at the cap | accepted as insufficient: 313 / 23, **27.8 s** | accepted conclusion: 772 / 134, 59.0 + 35.0 = **94.0 s**, 126.4 s at the cap; 12 of 12 lines whole |
| `benchmark:ai-model-0-8b`, `packets:failureAnalysis` #1 / #2 | — | — | 788 / 143, `stop` at 143 of 256; wall **87.2 s / 102.0 s**; at the cap 118.5 s / **132.3 s** |

- **Measured versus projected.** The wall and inference times above are measured. "At the cap" is the
  benchmark's rule, the measured prompt time plus all 256 tokens at the measured decode rate; no answer
  ran to the cap (134–143 of 256 tokens). `failureAnalysisAtCap` **132,320 ms ≤ 180,000**, and the
  benchmark verdict is **GO on all 8**. The other scenarios are the unchanged `d8162f86` and `f58cf28f`
  measurements; host memory (1,101 MB) and main-loop delay (30 ms) are recomputed across every packet,
  the new one included.
- **Quality proxies, never model text:** every answer accepted and classified as its evidence tier
  requires; both conclusions cite the event the deterministic cause rests on; no text ended at its
  grammar limit (`cutByGrammar` 0); explanations 143–170 characters; the typical wrote 2 steps (91, 113
  characters), the benchmark's largest 2 (55, 98). **The live largest wrote no step**, as it did before
  the change.
- **The benchmark measures the product.** `packets:failureAnalysis` is now built by the product's own
  functions over the live gate's largest fixture (`scripts/ai-harness/failureAnalysisPacket.ts`),
  judged by the product's output contract, parser, redaction and rescan, and re-measured whenever its
  identity (prompt, schema, cap) changes. The `cancel` and `playwright` scenarios keep the old synthetic
  packet, because their recorded results were measured with it.

**What this does not show:**

- **A request at every bound was not measured.** Evidence lines are bounded by `maxEvidenceChars`, but
  routes only by the 3,000-character data budget; a failure with twelve long routes would send a longer
  prompt than the largest fixture's.
- **Host heat.** Earlier back-to-back runs slowed prompt evaluation to 5.9 tokens/s. At that rate the
  largest prompt alone takes about 134 s, and at the cap it would project to about 205 s, over the
  ceiling. Both runs here were at 12.3–16.4 tokens/s.
- **The bound's margin in the tab layout is 2 tokens,** for an answer at every limit with digit-dense
  text. An answer denser than that would be cut and discarded whole, never shown truncated.
- **The runner-cause-with-console-errors tier** (the one where the model decides) is still not
  exercised on the real model. A bare runner timeout still costs a model call (27.8 s).

**Regression suites:**

- **New `verify:ai-failure-analysis-budget`, 7/0** (vocabulary only, seconds): the counted template is the
  host's, the filler is at least as token-dense as plain English, each fixture's offered lines reach the
  prompt whole, and the longest acceptable answer fits the cap in both layouts, including with the
  longest ids L5a mints.
- **`verify:ai-error-analysis`, 203/203 (was 185):** one text block plus routes; whole lines within the
  budget and no id offered without its line; a lead line longer than the budget still offered; both
  citation lists capped; the parser refusing a longer list or step; and the benchmark packet equal to
  the job `analyzeFailure` submits.
- **Mutation-tested, 5 of 5 caught:** an explanation limit of 400 fails 3 budget checks; the old field
  cap fails 1 contract and 2 budget checks; no whole-line selection fails 3 contract checks; uncapped
  citation lists fail 3 contract and 2 budget checks; no parser re-check fails 2 contract checks.
- **`verify:ai-failure-analysis-live`** now fails if an offered line is not shown whole, and records how
  many texts the grammar ended (`cutByGrammar`).

**Re-measured after the prompt lost the deterministic conclusion (`c44a6e2c`, 2026-09-22): still GO.**
The `Failure` block no longer carries the conclusion or its ids, and the instructions grew by a sentence
about unrelated events. See L5 › "Baseline anchoring, removed and measured".

| Measure | Before (`42655904`) | After (`c44a6e2c`) |
|---|---|---|
| Prompt, typical / bare timeout / largest (`verify:ai-failure-analysis-budget` 7/0) | 396 / 317 / 788 | 417 / 342 / 798 (system 179 → 231) |
| Longest acceptable answer (tabs, longest ids) | 254 ≤ 256 | 254 ≤ 256, unchanged |
| `benchmark:ai-model-0-8b` `packets:failureAnalysis` #1 / #2 | 788 / 143, wall 87.2 / 102.0 s | 798 / 183, `stop`, wall 101.8 / 102.1 s |
| `failureAnalysisAtCap` | 132,320 ms | **120,389 ms ≤ 180,000**, GO on all 8 |
| `verify:ai-failure-analysis-live` (5/0), at the cap: typical / bare / largest | 74.0 / — / 126.4 s | 106.4 / 136.2 / 120.5 s |

The bare timeout's 136.2 s is 24 prompt tokens and a decline, projected at 2.42 tokens/s, the slowest
decode seen that run. The largest answer (live and both benchmark iterations) did not cite the CDN script
the baseline rests on (`citesCause` false). That is recorded, not required: the fixture's payment
gateway 502 is an equally grounded reading of that run.

**Step relevance (`407d6080`, 2026-09-22): still GO, not re-measured, because nothing it measures
changed.** A request whose events all share one step, every fixture above included, is byte-identical
to `c44a6e2c`'s, so the benchmark's packet identity did not move. `benchmark:ai-model-0-8b` reported 7/7
current and GO on all 8, with `failureAnalysisAtCap` still 120,389 ms.
- `verify:ai-failure-analysis-budget`: 7/0, prompts unchanged at 417 / 342 / 798 tokens.
- `verify:ai-failure-analysis-live`: 5/0, at the cap 77.7 / 108.6 / 117.7 s.
- A request spanning steps adds a label of at most 25 characters per line. That is inside the unchanged
  1,500-character evidence budget, so a line is dropped rather than the prompt growing past it. The two
  provenance requests measured 458–463 prompt tokens and 92–101 s at the cap.

**Runtime request provenance (`3699617f`, 2026-09-22): still GO, not re-measured, because nothing it
measures changed.**
- The change is runtime-only: L5a's evidence events gain optional request provenance.
- The failure-analysis request is built from payloads, ids and step stamps, none of which moved.
  `verify:request-provenance` builds it from a real run with and without provenance and finds the prompt,
  offered ids and tier byte-identical.
- No model setting, deadline, output cap or benchmark ceiling was touched, and no model was run.

**The request reads request provenance (`e27e15bd`, 2026-09-22): still GO. The packet is unchanged, and
the new requests were measured live.** See L5 › "Request provenance in the failure-analysis request,
measured".
- A request without provenance is byte-identical, and the benchmark packet is one.
  `benchmark:ai-model-0-8b` re-evaluated at `e27e15bd`: 7/7 current, GO on all 8,
  `failureAnalysisAtCap` still 120,389 ms, with no inference run.
- `verify:ai-failure-analysis-budget`: 7/0, prompts unchanged at 417 / 342 / 798 tokens.
- A request that states provenance adds one instruction sentence, and its line labels come out of the
  unchanged 1,500-character evidence budget. The six real-runner requests measured live:
  - 655–770 prompt tokens and 77.3–99.0 s of inference;
  - 94.9–129.1 s projected at the 256-token cap, under the 180 s ceiling.
- **Not measured:** a provenance request at every bound. The budget verifier counts only requests
  without provenance. `verify:ai-failure-analysis-live` was not rerun: its fixtures carry no provenance,
  so their requests are unchanged.
- No model setting, deadline, output cap or benchmark ceiling was touched.

**The deterministic baseline reads the confirmed link (`14c0ad84`, 2026-09-22): still GO, and nothing the
model sees changed.** See L5 › "Deterministic cause selection reads confirmed request provenance".
- The prompt and schema of all 19 asked labelled rows are byte-identical to `e27e15bd`'s (sha256-guarded in
  `verify:ai-error-analysis`). So the six live request timings above still describe the requests sent.
- `benchmark:ai-model-0-8b` re-evaluated at `14c0ad84`: 7/7 current, GO on all 8, `failureAnalysisAtCap`
  still 120,389 ms, no inference. Its packet has no provenance.
- No model setting, deadline, output cap or benchmark ceiling was touched.

#### `locatorUpgrade` inside its ceiling at its own output cap (2026-09-22): GO. Evidence: `packets:locatorUpgrade` (now the product's request) and `verify:ai-locator-upgrade-live` at `4a846c41`

**Root cause: the output cap, a prompt that was mostly delimiters, and an answer no small cap could hold.**

- **The cap.** `LOCATOR_ATTEMPT_LIMITS.maxOutputTokens` was 512. At the 3.5–4.5 tokens/s this host decodes,
  512 tokens alone are 114–146 s before any prompt evaluation.
- **The prompt.** Seven nonce-delimited DATA blocks (`CurrentLocator`, `TargetElement`,
  `UniqueCandidates`, `Containers`, `PageHeading`, `SiblingActions`, `DataBoundFields`), each about 45
  prompt tokens of delimiters before its content. The Recorder's fallback CSS/XPath candidates were sent
  too, though the compiler refuses a CSS path, and XPath without policy.
- **The answer.** The grammar writes every key, whatever `required` says (the failure-analysis finding at
  `5ef4852f`), and the plan schema admitted three scopes of seven keys with 120-character texts. No cap
  much below 550 tokens held every plan it could decode.

**Baseline, measured through the product at `4608eaec`** (`verify:ai-locator-upgrade-live`, host 11%
busy): typical 527 prompt / 94 output tokens, 27.8 s prompt evaluation + 20.5 s generation = 48.3 s,
**140.9 s at the cap**; largest 887 / 69, 57.8 s + 17.1 s = 74.9 s, **186.4 s at the cap**. Both jobs
accepted. Earlier runs on a slower host projected 233–300 s (above).

**The change (`4a846c41`, `src/ai/locatorUpgradeAttempts.ts`):**

- **One DATA block of whole lines.** `locatorAttemptJob`, now exported, is the job the loop submits, the
  benchmark measures and the live gate compares against. It sends one `Element` block: the saved
  locator's strategy and class, the target, a previous refusal, the candidates, containers, heading,
  sibling actions and the bound field paths, in that order, whole, while they fit `maxContextChars`
  (2,800). A line that does not fit is skipped, never cut. The old per-field 1,200-character default cut
  text, not lines, so at L2's bounds a candidate could have reached the model mid-value.
- **No Recorder fallbacks.** Structural and positional CSS/XPath candidates are dropped, as the baseline's
  own value always was: both are the fragile form being replaced.
- **A narrowed grammar.** `LOCATOR_ATTEMPT_SCHEMA` is `LOCATOR_PLAN_SCHEMA` with the same keys, `required`
  and enums, and tighter bounds taken from what `sanitizeUpgradeContext` lets a capture show: one scope, a
  200-character target value (a captured candidate's own bound) and 80-character texts (any name or
  container text). Every plan it decodes is one the compiler still judges in full. The plan schema, which
  the compiler and replay use, is unchanged.
- **Output cap 512 → 256**, the lowest cap every valid plan fits (below). The instructions now say "at most
  one semantic scope".
- **Unchanged:** the compiler, intent guard and proof gates; dropping bound values; redaction and the
  residual-secret rescan; the refusal feedback; the 185 s per-attempt deadline; 2 attempts; the 180 s
  ceiling; the model; and the job's wiring (nothing queues it yet).

**Why 256 and not the L1.8 table's 192.** Counted on the pack's tokenizer
(`verify:ai-locator-upgrade-budget`). Digits cost a token each here: English names and test ids run 154
and 151 tokens per 1,000 characters, a name with an order number 258.

| Longest plan | Spaces / tabs | ≤ 192 | ≤ 256 |
|---|---|---|---|
| Any the grammar admits, in English names and test ids (judged) | 200 / 209 | no | **yes** |
| Using only the texts its strategies read (`name` only for `role`), names with an order number (judged) | 221 / 230 | no | **yes** |
| Any the grammar admits, names with an order number (recorded) | 267 / 276 | no | no |
| Texts read, a number every few characters / codes (recorded) | 252 / 261; 358 / 367 | no | no |

At 192, a plan copying a 200-character captured candidate and a named container would be cut by the cap.
Keeping it under 192 would have meant a value limit below what a capture offers, so the grammar itself
would cut the candidate the model copied.

**Where the prompt went** (tokens, host template included):

| Request | Before: 7 blocks, live | After: 1 block, counted | After, live |
|---|---|---|---|
| Typical | 527 | 271 | 261 |
| Largest, first attempt | 887 | 574 | 572 |
| Largest, second attempt (the benchmark's packet) | — | 618 | 618 |
| A capture at every L2 bound, second attempt, names with numbers | — | 1,017 | — |

Counted and live differ by a few tokens because the live nonce is random and hex tokenizes unevenly.

**Measured on the real 0.8B after the change:**

| Run | Typical | Largest |
|---|---|---|
| `verify:ai-locator-upgrade-live`, host 10% busy | accepted: 261 / 39 tokens, 14.9 + 9.4 = **24.3 s**, 78.0 s at the cap | accepted: 572 / 112, 34.5 + 27.7 = **62.2 s**, 98.3 s at the cap |
| `benchmark:ai-model-0-8b`, `packets:locatorUpgrade` #1 / #2 | — | second attempt: 618 / 112, `stop` at 112 of 256; wall **73.6 s / 77.1 s**; at the cap 114.7 s / **115.3 s** |

- **Measured versus projected.** Wall and inference times are measured. "At the cap" is the benchmark's
  rule: the measured prompt time plus all 256 tokens at the measured decode rate. No answer ran to the cap
  (39–112 of 256 tokens). `locatorUpgradeAtCap` is **115,321 ms ≤ 180,000**, and the benchmark verdict is
  **GO on all 8**. The other scenarios are the unchanged `d8162f86`, `f58cf28f` and `42655904`
  measurements.
- **Accepted, not just answered.** Both live jobs ended `accepted`: decoded, compiled, past the intent
  guard, and stored as unprovable-now with the proof stubbed. Both benchmark answers were accepted by the
  product's output contract, compiler and intent guard. No text ended at its grammar limit
  (`cutByGrammar` 0). The live gate now fails unless each job is accepted, each call is the request
  `locatorAttemptJob` builds, and every line is shown whole.
- **Quality proxies, never model text.** The typical plan is a `role` target with no scope (two texts, 6
  and 7 characters). The largest is a `role` target with one `section` scope and a 4-character `hasText`,
  flagged `meaningChange` by the intent guard's own rule, so it would be a T1 suggestion; one of its five
  texts is not a substring of the prompt.
- **The benchmark measures the product.** `packets:locatorUpgrade` is built by `locatorAttemptJob` over the
  live gate's largest capture, on its second attempt after the longest refusal line. It lives in the
  owner's `scripts/ai-harness/locatorUpgradePacket.ts`, integrated rather than copied: its grammar
  translation, template and host limits are kept and its synthetic packet is replaced, so the portable
  offline runner that imports it (`scripts/offline-benchmark/`, still untracked) measures the same request.
  `verify:ai-locator-attempts` proves the packet equal to what the loop submits.

**What this does not show:**

- **A proof on a real page.** The live gate stubs the browser proof as page-unavailable. Whether a real
  model plan proves on its page is `verify:ai-locator-quality-live`, not built. The typical plan is
  `role=button name=Archive` with no scope, over a capture that counted two matches; the proof decides
  whether it is unique. *(Built at `858ffd17`; see "The real 0.8B's locator plans proven on real
  pages".)*
- **A request at every bound was not measured.** Counted at 1,017 prompt tokens with numbered names; at the
  benchmark's prompt and decode rates (12.9–14.7 and 3.53–3.79 tokens/s) that projects to 137–151 s at
  the cap, and at the
  5.9 tokens/s once seen on a hot CPU to about 245 s.
- **Number-dense pages.** A plan with every text at its limit in number-dense or code-dense text exceeds
  256 tokens. It would be cut at the cap and refused, spending an attempt, never accepted truncated.
- **A second attempt on the real model.** Both jobs were accepted first time; the benchmark measured the
  second-attempt request, but no live job needed one. *(Measured at `858ffd17`: 5 of 6 quality jobs took
  one; see the next section.)*

**Regression suites:**

- **New `verify:ai-locator-upgrade-budget`, 8/0** (tokenizer only, seconds): the counted template is the
  host's; each request is one block with every line whole, within the host's limits; the longest prompt a
  capture at every L2 bound can send is counted; and both judged plan bounds fit the cap.
- **`verify:ai-locator-attempts`, 112/112 (was 87)**, new §17: the attempt grammar is the plan schema
  narrowed, with a non-vacuity check; a captured 200-character value and an 80-character container name
  decode whole; a second scope and a longer scope text do not; one block, with the saved locator's
  strategy and class only and no bound sibling; at every L2 bound every line shown is whole; no Recorder
  fallback shown; the largest fixture loses nothing; a refusal reaches the next attempt as a code and a
  field path; the benchmark packet equals the loop's second-attempt job; through the real `AiService`, a
  two-scope plan is refused before the browser and a 200-character value reaches the proof.
- **Mutation-tested, 7 of 7 caught:** three scopes fails 3 checks and both budget bounds; an 80-character
  value limit fails 2; the full plan schema submitted fails 3; fallback candidates shown fail 3; the
  packet built from the first attempt fails 1; a bound sibling shown fails 1; a context cut at its budget
  fails 1. That last mutation first **survived**: the check read only lines whose label survived, and the
  cut landed inside a label (`sibling a`). It now judges every line.

#### The real 0.8B's locator plans proven on real pages (2026-09-22): PASS. Evidence: `verify:ai-locator-quality-live` at `858ffd17`

**What was missing.** Every live locator run so far stubbed the browser proof as page-unavailable, so
a real plan had been decoded, compiled and stored, but never proven on a page.
`verify:ai-locator-quality-live` removes the stub. It keeps the model artifact, the 256-token cap, the
185 s per-attempt deadline, 2 attempts and every benchmark ceiling unchanged. Nothing wires the job into
the app.

**How it runs** (`scripts/ai-harness/locatorQualityLive.ts`, harness mode `locatorQuality`):

- **Six real Recorder captures** on `/recorder-lab/locator-upgrade`, taken the way `RecorderService`
  takes them: the context is lifted off the action, then sanitized and marked.
- **The product's own job and proof.** Each capture goes through `runLocatorUpgradeAttempts`, the
  production `AiService` and the real `ai-host.cjs`. Every plan that compiles is proven by
  `proveLocatorPlan` (or `proveRepairPlan`) in real Chromium.
- **Judged by the page, not by the product's gates.** An accepted candidate is re-checked on a fresh
  page:
  - exactly one match;
  - that element's `data-lu` is the one the Recorder clicked;
  - the product's replay proof (or repair proof) passes again;
  - a click on it makes the page report that element.
- **Every later attempt is checked against the real outcome of the one before it.** That outcome is
  re-derived from the earlier answer and its real proof, never read back from the job's own record.

**Acceptance: L3's own rule, not a new threshold** (L3 › "Labelled quality set" and "Acceptance"):

- **false-target = 0**, applied here to every accepted candidate, not only a promoted one;
- the impossible case stays honestly guarded;
- nothing refused is stored, and a pending candidate never executes (the saved locator and its
  alternatives are unchanged);
- **non-vacuity:** at least one real plan must be browser-proven, or the gate has judged nothing.

Upgrade and proof rates, rejection reasons and latency are **recorded, not judged**: no plan sets a
threshold for them.

**Results, two full runs** (the second is the final state):

| Scenario | Situation | Baseline | Run 1 | Run 2 (final) |
|---|---|---|---|---|
| `unique` | a uniquely identifiable element (Open Gamma, Element Spy request) | strong-semantic | compiler `UNSUPPORTED`, then `testId` **capture-proven** | the same |
| `multiple-matches` | the initial locator matched twice (Archive's hidden duplicate) | guarded-positional | `section` scope `NO_MATCH`, then unscoped `role` **capture-proven** | refused: two scoped plans, each `NO_MATCH` |
| `scope` | needs its container (Edit address in the Shipping region; new `lu-scope`) | acceptable-semantic | refused: `card` scope not strict, then unscoped `NOT_UNIQUE` (2) | the same |
| `stale` | a broken saved test-id locator, through repair (`lu-repair`) | strong-semantic | `role` **repair-proven** on the first attempt | the same |
| `dynamic` | the list re-renders as new elements while the job runs (new `lu-dynamic`) | strong-semantic | `listItem` scope `NO_MATCH`, then `role` **capture-proven** | the same |
| `impossible` | identical twins | guarded-positional | refused: `NOT_UNIQUE` twice | refused: `NO_MATCH`, then `NOT_UNIQUE` |

| Measure | Run 1 | Run 2 (final) |
|---|---|---|
| Solvable scenarios accepted and browser-proven | 4 / 5 | 3 / 5 |
| False targets | **0** | **0** |
| Impossible case accepted | 0 | 0 |
| Jobs that took a second attempt | 5 / 6 | 5 / 6 |
| Model calls; inference per call | 11; 33.7–51.0 s | 11; 36.0–48.6 s |
| Worst call at the 256-token cap (against 180 s) | 103.4 s | 97.0 s |

- **Every accepted candidate passed the page's re-check.** It had one match, it was the recorded
  element, its replay or repair proof passed on a fresh page, and a click on it acted on that element.
- **The dynamic case synchronized on the page's own signal.** A proof taken while the status read
  `loading` came back `unprovable-now TARGET_MISSING` every time, never proven. The proof the job
  received waited for `ready`.
- **Second-attempt evidence.** Each second request carried the first attempt's actual refusal (stage,
  code, field) as the product builds it. Three second attempts succeeded: `unique` after a compiler
  refusal, `dynamic` after `NO_MATCH`, and in run 1 `multiple-matches`. None accepted an unproven
  candidate.

**Controls, run before any model call; a failed one ends the run:**

- A correct scripted plan through the real proof passes the judge.
- A wrong element let through by a bypassed gate C is caught as a false target, and so is an ambiguous
  match let through by a bypassed gate B. Both bypasses tamper with the real proof's answer, and the
  control first asserts that the untampered product refused (`WRONG_ELEMENT`, `CANDIDATE_NOT_UNIQUE`).
- A claimed `PROVEN` stub and the old page-unavailable stub are never counted as browser proofs.
- A second attempt whose refusal is dropped, misrecorded or skipped is caught
  (`ATTEMPT_2_DOES_NOT_CARRY_THE_REFUSAL`, `ATTEMPT_1_RECORD_IS_NOT_ITS_OUTCOME`, `ATTEMPT_2_MISSING`).

**What this does not show:**

- **A stable rate.** `AiService` draws a random prompt nonce per job, so temperature 0 and seed 0 do
  not make answers reproducible across runs: `multiple-matches` was accepted in one run and refused in
  the other. One run's rate is one sample. A rate claim would need repeated runs, and no plan sets a
  rate threshold.
- **Scoped upgrades.** In both runs the 0.8B never proposed the region scope the `scope` case needs.
  Its scopes (`card`, `section`, `listItem`, sometimes with a 4-character `hasText` that is not in its
  prompt) were refused as `NO_MATCH` or non-strict. The product guarded every one; the model did not
  deliver a scoped upgrade.
- **A repair without a capture context.** The repair job carries the Recorder's capture context from
  before the break, inside its 10-minute TTL. No production caller exists yet, and a runtime repair
  long after capture would have none. That case was not measured.
- **Replay tallies, promotion, frames, shadow roots and protected login with real plans.** Those stay
  covered by the scripted-plan suites.
- **Product-level mutation runs.** One run of the gate against a deliberately weakened gate C was
  denied by this session's permission classifier. The product was restored with zero diff and was
  never executed mutated. The controls above are the negative evidence instead.
- **Margin on time.** One run is ~506–519 s of harness time against a 575 s budget, held inside the
  10-minute tool limit. A slower host times out and reads FAIL: truthful, but uninformative.

**Also fixed on the way.** The harness modes had never been type-checked, because esbuild bundles
without checking. They are now under `typecheck:scripts`, which surfaced five latent type errors in
`harnessMain.ts` and `failureAnalysisBudget.ts`. All five were fixed with no behavior change. The
harness bundle now resolves `playwright` by its repository path, so product code that imports it loads
from the temporary app directory.

**Regression suites at the final state:** `verify:ai-locator-quality-live` 14/0,
`verify:ai-locator-upgrade-live` 4/0, `verify:locator-upgrade-proof` 75/0, `verify:ai-locator-upgrade`
78/0, `verify:ai-locator-attempts` 112/112, `verify:ai-locator-repair` 85/85, `verify:ai-adapter`
117/0, `verify:ai-host` 135/0 with 12/12 mutations, `verify:ai-host-electron` 26/0,
`verify:mock-site` 234/234, `verify:verifier-classification` 248 scripts. Build PASS,
`typecheck:scripts` PASS.

#### The 0.8B pinned, and `verify:ai-model-live` on it (2026-09-22): PASS. Evidence: `verify:ai-model-live-0-8b` at `d6b306f0`

**How the pin was measured.** `verify:ai-model-live` gained `--pack` (a `PACKS` table: the 4B default,
found as before, and the 0.8B from `~/Downloads`, each with its published size and SHA-256) and a GGUF
v2/v3 header reader. The reader walks every key/value and skips the tokenizer arrays.
`verify:ai-model-live-0-8b` runs it on the 0.8B.

**Run first unpinned** (`3fa15327`): 17 passed, 1 failed. The one failure was the expected "lists the
measured pack", and that run is where the entry's values come from.

| Field | Measured | Source |
|---|---|---|
| Size | 527,502,816 bytes | the file on disk (equal to the published object) |
| SHA-256 | `f5b14da98939b60bbe1019a964eba656407e1e0b64f1fe3003ff6d650e93bfec` | the file on disk (equal to the published object) |
| Format | GGUF v3, 320 tensors, 34 keys | its header |
| `general.architecture` / `general.name` | `qwen35` / `Qwen_Qwen3.5 0.8B` | its header |
| `qwen35.context_length` → `contextTokens` | 262,144 | its header |
| `general.file_type` → `quantization` | 15 → Q4_K_M | its header |

**The pin** (`d6b306f0`, release lease `awkit-djnl-1-pin-0-8b-0922`):

- A second entry, `qwen3.5-0.8b-q4-k-m`, beside the 4B.
- Apache-2.0, with its notice in `resources/THIRD_PARTY_NOTICES.md`.
- `AI_RUNTIME_PIN` unchanged.
- The 4B stays pinned: retiring an accepted pack was not requested. The store keeps one active pack,
  matched by checksum, so either can be imported.

**Pinned: `verify:ai-model-live-0-8b` 23/0.**

- The pack is the published object, the runtime pin holds and the entry is listed.
- The pack is a `qwen35` model, the architecture the host's template is written for.
- The entry's context length and quantization are the header's. The gate fails if either stops matching.
- It imported through `AiModelPackStore` with the real manifest in 3 s, reads installed, and load
  verification re-hashed and accepted it.
- All 13 live-harness steps passed, among them determinism, injection text, the think block, prompt
  bound, truncation, deadline, yield and shutdown. Cancel settled in 4.0 s, and a host killed
  mid-inference restarted and reloaded.

**Also:** `verify:ai-model-pack` 46/0 with 2 pinned packs, build PASS.

**Not run:**

- `verify:ai-model-live` on the 4B after the `--pack` change;
- `validate:offline`, which checks the packaged runtime, browser and dependency manifest, while a model
  pack is never bundled;
- an independent QC review (no subagent requested).

## L1 status: PARTIAL PASS — CONDITIONAL FOR DEVELOPMENT, NOT APPROVED FOR RELEASE (owner, 2026-09-20)

The owner has read the NO-GO above and decided that Phase L **development** continues without waiting
for it. This section records what that authorization does and does not cover. **It changes no measured
number, no ceiling and no gate result.** `evidence/L1.8-benchmark.json` and
`evidence/L1.8-inference-profile.json` are unchanged, `benchmark:ai-model`'s `locatorUpgrade` scenario
is still a **FAIL**, and nothing below reclassifies it.

| L1 task | State | Counts toward |
|---|---|---|
| L1.1 AiService host | PASS — `verify:ai-host` 135/0 + 12/12 mutations; `verify:ai-host-electron` 20/0 (`7f441a38`) | development + release |
| L1.2 Model pack, manifest and runtime pin | PASS — `verify:ai-model-pack` 46/46, 1 pinned pack (`a28050c7`); the re-scoped Qwen3.5-0.8B pinned beside the 4B from its own measurements, with its notice (`d6b306f0`): `verify:ai-model-pack` 46/0 with 2 pinned packs, `verify:ai-model-live-0-8b` 23/0 | development + release |
| L1.3 Output contract | PASS — `verify:ai-adapter` 102/0, `verify:ai-redaction` 52/0 | development + release |
| L1.4 Autonomy policy, audit, revert | PASS — `verify:ai-autonomy-policy` 62/0, `verify:ai-audit-revert` 69/0 | development + release |
| L1.5 Permissions and Settings | PASS — `verify:ai-permissions` 75/0 | development + release |
| L1.6 Resource integration | PASS — `verify:ai-adapter` yield/admission sections | development + release |
| L1.7 Fake provider | PASS — `verify:ai-fallback` 38/0 | development + release |
| **L1.8 live inference latency** | 4B: **FAIL** — `locatorUpgrade` >240,000 ms against a 180,000 ms ceiling; product path `TIMEOUT` at 120 s. Re-scoped Qwen3.5-0.8B: benchmark **GO on all 8** (`f58cf28f`), not pinned; its explanation is delivered in the product under its own 125 s deadline (`d2f5feb2`). Failure analysis and locator upgrade have their own 185 s deadlines (`d71ee244`). Real failure analyses are accepted and classified since the answer contract was rebuilt (`5ef4852f`), and the product's own failure-analysis request meets its ceiling at its own 256-token cap (132.3 s, `42655904`), as does the product's own locator-upgrade request at its own 256-token cap (115.3 s, every live job accepted, `4a846c41`). The real model's locator plans are proven on real pages by `verify:ai-locator-quality-live`: 14/0 twice, 0 false targets, the twins refused, 3–4 of 5 solvable scenarios browser-proven (`858ffd17`) | **release only — unmet** until the pin and the remaining live gates |

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
   is never rewritten as `BLOCKED`, `INCONCLUSIVE` or `PASS`. *(2026-09-22: the owner instructed that
   `LOCATOR_ATTEMPT_LIMITS.timeoutMs` be measured through the product and fixed. It is now 185,000 ms,
   the unchanged 180 s ceiling plus 5 s. The ceiling and every recorded measurement still stand.)*
3. **No production feature may require a model to behave correctly.** Every AI path keeps its existing
   guarantee: no model, a disabled model, a timeout or a crash leaves behavior identical to today. A
   deterministic provider is a **test** substitute, never a shipped one.
4. **No release claim.** The live gates `verify:ai-model-live`, `benchmark:ai-model` and
   `verify:ai-locator-quality-live` remain the only evidence that would satisfy L1.8, and none of them
   passes. L7 cannot be entered on this authorization. *(2026-09-22: on the re-scoped 0.8B,
   `benchmark:ai-model-0-8b` is GO on all 8 and `verify:ai-locator-quality-live` passes, 14/0 at
   `858ffd17`. `verify:ai-model-live` has not run on it and the pack is not pinned, so L1.8 is still
   unmet for release and L7 still cannot be entered. Later the same day the pack was pinned and
   `verify:ai-model-live-0-8b` passed 23/0 (`d6b306f0`). L1 still owes two unbuilt quality gates and
   the owner's go/no-go, so L7 still cannot be entered.)*

**Still outstanding for L1 acceptance:** the qualifying hardware was re-scoped on 2026-09-21 to this
machine with all 12 logical CPUs, and the 4B still FAILS there (see "Re-scoped to the qualifying
host"). The owner then re-scoped the model to Qwen3.5-2B and Qwen3.5-0.8B. The cancel defect
`awkit-g555` is fixed and closed. The 0.8B's benchmark is **GO on all 8** since the product's
explanation request was fixed (88.3 s against 120 s; see "`validationExplanation` fixed in the
product"). It still owes the pin, its license notice, `verify:ai-model-pack`, `verify:ai-model-live`,
and the live quality gates. Every feature now has its own deadline (`d2f5feb2`, `d71ee244`). The answer
contract that refused every real failure analysis is fixed (`5ef4852f`), and the failure-analysis request
now meets its ceiling at its own output cap, measured on the product's own request (`42655904`; see
"`failureAnalysis` inside its ceiling at its own output cap"). The locator-upgrade request now meets its
ceiling at its own 256-token cap too, and `packets:locatorUpgrade` measures the product's own request
(`4a846c41`; see "`locatorUpgrade` inside its ceiling at its own output cap"), so no benchmark packet is a
stand-in any more. Real model plans are now proven on real pages: `verify:ai-locator-quality-live` is
14/0 with 0 false targets (`858ffd17`; see "The real 0.8B's locator plans proven on real pages").

**Done since (`d6b306f0`; see "The 0.8B pinned, and `verify:ai-model-live` on it"):** the 0.8B is pinned in
`AI_MODEL_MANIFEST` with its license notice, and `AI_RUNTIME_PIN.build` was already set.
`verify:ai-model-pack` is 46/0 with 2 pinned packs, and `verify:ai-model-live-0-8b` is 23/0.

**Also done since (`1126c1b6`):** `verify:ai-authoring-quality-live` is built and 10/0 on the 0.8B. It
sends L4b's labelled set of six flows, twelve issues and both fix kinds. All six answers were delivered
and all twelve issues explained with no leak, and 12/12 were on subject by the proxy. No explanation
quality target is recorded; see L4 › "The live quality gate as built".

**And (`4f81424a`):** `verify:ai-error-quality-live` is built. It sends all 14 items of L5's labelled
set through `analyzeFailure` on the 0.8B and passed 13/0 on two runs.
- Baseline accuracy 7/8, AI accuracy 7/8, improvement 0.
- One false attribution: the AI kept the baseline's wrong lead event.
- Evidence links all shown whole, coalescing 500 → 1, no leak.

The AI does not beat the baseline, so L5b's automatic analysis stays off under ROADMAP rule 7; see L5 ›
"The live quality gate as built". **Every live quality gate L1 names now exists and passes.**

**Then (`c44a6e2c`):** the failure-analysis request no longer shows the model the deterministic
conclusion, and lists the evidence newest first. The set gained three anchoring cases and runs in two
parts, each 20/0 across both parts on two runs.
- Whole set: baseline 9/11, AI 9/11, improvement 0, 2 false attributions, 1 correct decline.
- On the eight rows of `4f81424a`: unchanged at 7/8 and 7/8, with 1 false attribution.
- Without the conclusion, the model still chose a wrong event where the baseline was wrong. So the limit
  is its own cause selection, not only the prompt.
- The request still meets its ceiling: `failureAnalysisAtCap` 120,389 ms, GO on all 8.

See L5 › "Baseline anchoring, removed and measured".

**And then (`407d6080`):** the request now knows the step each event was captured in, from the
collector's step stamp. An event from after the failed step can no longer be the cause or be offered
first. A line states its step only when the offered events span more than one.
- The labelled set is unchanged at 9/11 vs 9/11. Every one of its events is in the failed step, so its
  requests are byte-identical.
- On two new provenance cases the AI scored 1/2 twice against the baseline's 2/2: it ignored the step
  labels.
- The packet identity is unchanged, so the benchmark is current at GO on all 8.

See L5 › "Step relevance, from the collector's step stamp".

**Then (`3699617f`):** the runtime now records the provenance the step stamp lacked:

- each request's stable id, the step it was issued in, its frame, and the failed step's target page
  and frame;
- a confirmed link for the requests the runner itself holds (its navigation's response, its response
  wait's match).

Nothing the model sees changed, and the ceiling was not re-measured. The failure-analysis request does
not read the provenance yet: doing so is a cause-selection decision for L5b. See L5 › "Request-to-step
provenance, recorded at runtime".

**And (`e27e15bd`):** the failure-analysis request now reads that provenance. Each request line states
what the runner observed, the failed step's own request is ranked first after the baseline's
citations, and a request issued after the failure can never be the cause. Six real-runner cases were
added, labelled before inference.
- **Technical verification: PASS.** `verify:ai-error-analysis` 401/401 with seven mutations caught;
  `verify:request-provenance` 81/0. Every live row was delivered and saved inside its deadline, with no
  leak and every citation shown whole (33/33).
- **Model quality: not met.**
  - The labelled set is unchanged at 9/11 against 9/11, with 2 false attributions.
  - On the six new cases the AI scored 0/6 against the baseline's 2/6, with 6 false attributions.
  - Across all 17 rows: baseline 11/17, AI 9/17, improvement −2.
  - The 0.8B never cited the request marked as the failed step's own. With and without provenance it
    gave the same wrong answer.
- **Unchanged:** the ceiling (GO on all 8), because the benchmark packet has no provenance.

See L5 › "Request provenance in the failure-analysis request, measured".

**Then (`14c0ad84`):** the deterministic baseline reads the same confirmed link. The failed step's own
request moves ahead of other requests, and never ahead of other evidence. Measured without a model on the
unchanged labelled set:
- the labelled set is unchanged at 9/11;
- the six request-provenance cases rise from 2/6 to 5/6;
- all 17 rows rise from 11/17 to 14/17, with false attributions falling from 6 to 3.

The model's requests are byte-identical, so the AI's recorded 9/17 stands. Against the new baseline its
improvement is −5 (was −2). That figure is re-scored from the recorded verdicts; no model was rerun. See
L5 › "Deterministic cause selection reads confirmed request provenance".

**Then (`3e37f2c1`):** `verify:ai-authoring-quality-live` also reads corrective action, five kinds of
unsupported claim and fix priority, over nine cases (17 issues, 14 codes). On the 0.8B, one run in two
parts (9/0, 8/0):
- 9/9 answers accepted, 17/17 on subject by proxy, 0 misattributed;
- **0/17 actionable by proxy.** The product's own instruction asks for what to look at and forbids
  describing a repair;
- 1 unconfirmed severity-overstated hit, and no invented fix, off-domain remedy or fabricated value;
- nothing ranked (0 of 5 fixable), so the T1 fix order is still unmeasured;
- inference 37.7–65.1 s against the 125 s deadline.

The request, the grammar and the inference configuration are unchanged, so L1.8 is not re-measured
(`verify:ai-explanation-live` 5/0 on the same run). A quality target is proposed, **not adopted**. See
L4 › "Corrective action, unsupported claims and fix priority, measured".

**Then (`97996c48`): the owner's four L4b decisions change the explanation request, so L1.8 is
re-measured.**

- **The request change.** The instruction now asks for a corrective step and adds a list of things never
  to invent. The schema, the 192-token output cap and the 160-character limit are unchanged. So are the
  120,000 ms ceiling (`explanationAtCapMs`) and the 125,000 ms product deadline.
- **`benchmark:ai-model-0-8b`: GO on all 8.** The packet's identity changed, so only
  `packets:validationExplanation` was measured again; the other six scenarios keep their results.

| Measure | `f58cf28f` | `97996c48` |
|---|---|---|
| Prompt tokens | 334 | **395** |
| Prompt evaluation | 24,275–29,929 ms | 24,145–27,955 ms (14.1–16.4 tok/s) |
| Output | 151 tokens, 2 of 2 explained | 144 tokens, 2 of 2 explained, `stop` |
| Decode rate | 3.29 tok/s | 4.41–4.77 tok/s |
| **At cap** | **88,288 ms** | **71,492 ms**, against 120,000 |

- **Why at-cap fell although the prompt grew:** this run decoded faster, at 4.41 tok/s against 3.29.
  That is host variance, not an effect of the change. The live gates on the same day decoded at
  3.0–3.75 tok/s, which puts them at 81.5–95.2 s at cap.
- **Projection, not evidence:** at the slowest rates this host has shown for this pack (prompt 9.4 tok/s,
  decode 2.55 tok/s), 395 prompt tokens plus the 192-token cap come to about 117.3 s. That is still under
  the ceiling, but with 2.7 s of margin, down from 9.2 s. Any further growth of the request is likely to
  cross it.
- **`verify:ai-explanation-live`: 5/0** on the changed request. Explanations were delivered at 73.9 s
  and 77.9 s of inference (387 and 389 prompt tokens), a cancel settled in 454 ms, and a kill during
  prompt evaluation was followed by a reload and a delivered explanation.
- **Quality on the 0.8B,** two complete runs: 17/17 and 16/17 on subject, **6/17 and 5/17 actionable by
  proxy** (was 0/17), 0 misattributed, 0 screen hits, nothing ranked, 51.4–86.1 s per answer.
  **`verify:ai-authoring-review`: TARGET NOT MET** on criterion 3, with 11 screen-clear answers
  awaiting a person. See L4 › "The owner's L4b decisions, implemented and measured".

**Then (`ddcfc35b`, 2026-09-23): the corrective action becomes the product's, so L1.8 is re-measured.**

- **The request change.** Each issue's line now ends with a product-authored corrective action in place
  of the fix kind/field/summary parenthetical, and the instruction is 616 characters against 875. The
  schema, the 192-token output cap, the 160-character limit, the 120,000 ms ceiling and the 125,000 ms
  deadline are unchanged.
- **`benchmark:ai-model-0-8b`: GO on all 8.** Only `packets:validationExplanation` was measured again.

| Measure | `97996c48` | `ddcfc35b` |
|---|---|---|
| Prompt tokens | 395 | **340** |
| Prompt evaluation | 24,145–27,955 ms | 18,174–29,260 ms (11.6–18.7 tok/s) |
| Output | 144 tokens, `stop` | 174 tokens, 2 of 2 explained, `stop` |
| Decode rate | 4.41–4.77 tok/s | 3.43–3.55 tok/s |
| **At cap** | 71,492 ms | **83,345 ms**, against 120,000 |

- **Why at-cap rose although the prompt shrank:** this run decoded at 3.43–3.55 tok/s against 4.41–4.77.
  That is host variance, the same effect in reverse as last time.
- **Projection, not evidence:** at the slowest rates this host has shown (prompt 9.4 tok/s, decode
  2.55 tok/s), 340 prompt tokens plus the 192-token cap come to about 111.5 s: **8.5 s of margin**, up
  from 2.7 s.
- **`verify:ai-explanation-live`: 5/0** on the changed request, delivered at 80.5 s and 69.7 s of
  inference (336 prompt tokens), a cancel settled in 64 ms, and a kill during prompt evaluation was
  followed by a reload and a delivered explanation.
- **Quality on the 0.8B,** two complete runs: 17/17 and 17/17 on subject, **9/17 and 7/17 actionable by
  proxy** (was 6/17 and 5/17 under a looser judge), 0 misattributed, 0 screen hits, nothing ranked.
  **`verify:ai-authoring-review`: TARGET NOT MET** on criterion 3, with 16 screen-clear answers awaiting
  a person. See L4 › "The corrective action made the product's, measured".

**Then (`d2f9721f`, 2026-09-23): one corrective change measured and restored, so L1.8 is confirmed, not
re-measured.**

- A task sentence asking "how to correct each validation issue" gave 8/17 and 8/17 over two complete
  runs, against 9/17 and 7/17. It also brought back model-authored actions with invented values, so the
  instruction was restored byte for byte. See L4 › "One corrective change, measured".
- **`benchmark:ai-model-0-8b`: GO on all 8, 7/7 scenarios current.** The packet identity is unchanged,
  so nothing was re-measured: 83,345 ms at cap against 120,000. Only `evaluatedAt` was rewritten.
- `verify:ai-explanation-live` 5/0: 336 prompt tokens, 53.2 s and 73.0 s of inference, a cancel in 74 ms.

**Still owed before L1 can be accepted:**

1. L4b's explanation quality target, **adopted provisionally on 2026-09-22, now PENDING**. Since
   `ddcfc35b` the corrective action a person sees is the product's (L1.8: GO, 83,345 ms at cap).
   - **Criterion 3:** the owner chose option B on 2026-09-23, so it measures the explanation a person
     sees. It is MET at 17/17 in each run (`289b9b71`).
   - **The model's own rate, reported and never credited:** the 0.8B's own sentence states the action in
     9/17 and 7/17 answers. Every one of them repeats the product's action word for word, and 0/34 hold a
     correction the model wrote itself. Prompt work has stopped.
   - **Still missing:** a person's review of the screen-clear answers (criteria 1 and 4). One of the
     current request's 16 is reviewed, under reviewer `MA` at 2026-09-23T10:15:07Z (not recorded by an
     agent; the owner is asked to confirm the label is theirs); 15 remain. The template placeholder is kept for audit and never counted (L4 ›
     "A placeholder verdict never counts"). The 11 earlier answers are unrecorded.
   - **A MET target does not decide L1.** The model's own remediation quality is weighed in item 2.
2. The owner's go/no-go on the re-scoped model, including whether the 4B stays pinned, in light of the
   quality evidence: locator plans 3–4 of 5 proven with 0 false targets, explanations 17/17 on subject
   by proxy but 7–9/17 actionable in the model's own text, all of it the product's action repeated, with no ranking (target PENDING on a person's review), and failure analysis tying the baseline on the labelled set, with or without
   the conclusion in its prompt and with step provenance, and falling below it (−2 over 17 rows) once the
   request states runtime request provenance. The gap is −5 since the baseline itself reads the confirmed
   link (`14c0ad84`): 9/17 against 14/17.

So L1 is not accepted. The 2B is NOT RUN because it is not downloaded.

## Decision record for the owner's L1 go/no-go (prepared 2026-09-23; decided the same day: option 1, limited)

A consolidation of the evidence above, for the owner to decide on. It adds no measurement and makes no
decision. Nothing live was re-run to write it, because no input changed.

| Area | Evidence | Reading |
|---|---|---|
| Latency (L1.8) | 4B: FAIL, `locatorUpgrade` >240 s against 180 s. Qwen3.5-0.8B: `benchmark:ai-model-0-8b` GO on all 8. `validationExplanation` at cap is 83,345 ms against 120,000 ms, about 8.5 s of projected margin at this host's slowest rates. Failure analysis at its cap is 120.4 s (`c44a6e2c`, last measured) and locator upgrade 115.3 s, both against 180 s. 2B: NOT RUN (not acquired). | The 0.8B meets every ceiling. The 4B does not. |
| Locator quality | `verify:ai-locator-quality-live` 14/0 twice. 3–4 of 5 solvable scenarios are proven in real Chromium, with **0 false targets** and the twins refused. | Proof is deterministic. The model only proposes, and an unproven candidate never runs. |
| Authoring explanations (L4b) | On subject 17/17 and 17/17. Corrective action a person sees 17/17 (criterion 3, option B, the product's action). The model's own text is actionable in 9/17 and 7/17, **all repeating the product's action**, so 0/34 are its own. Nothing ranked. A person has reviewed 1 of 16. | Target PENDING. The model adds wording, not remediation. |
| Failure analysis (L5b) | Deterministic baseline 14/17, the 0.8B 9/17: **−5**. Automatic analysis stays off under ROADMAP rule 7. | The model is below the baseline. |
| Operational | Per-feature deadlines (`verify:ai-deadlines`). Cancel settles in 64–454 ms, and a kill during prompt evaluation reloads and delivers (`verify:ai-explanation-live` 5/0). One inference at a time, yielding to runs, through weighted admission (L1.6). CPU-only on this 12-logical-CPU host. Two pinned packs with a GGUF header check (`verify:ai-model-pack` 46/0, `verify:ai-model-live-0-8b` 23/0). The pack ships outside the installer and is imported in Settings. AI off, missing or failing leaves behavior unchanged (`verify:ai-fallback` 38/0, re-run 2026-09-23). | Suitable for on-demand use on this host. The VMware target envelope was re-scoped to this host by the owner. Carrying the runtime in the installer is L7's scope, and L7 has not started, so no packaged AI gate has run. |

**Options, for the owner.** Each changes a baseline or a scope, so each needs an owner decision recorded
in `docs/ai/DECISIONS.md`:

1. **Limited GO on the 0.8B.** Accept it for explicitly limited, on-demand features only: explanations
   (T0, with the product's action), locator proposals (proven before use), and manual failure analysis.
   Automatic failure analysis stays off, and the 4B's pin is decided with it. This does **not** by itself
   satisfy L1's release gate or accept L3/L4b/L5b: each keeps its own acceptance (L4b still needs the
   15 reviews).
2. **Deterministic behavior only for now.** Keep L1 `in_progress` and every model-dependent acceptance
   PENDING. The product keeps its deterministic behavior, which already works with AI off.
3. **More evaluation first.** Acquire and measure Qwen3.5-2B (NOT RUN), or another model, against the
   same ceilings and labelled sets before any broader AI function is authorized.

**Decided by the owner, 2026-09-23: option 1** (`docs/ai/DECISIONS.md`, latest). The GO covers
authoring explanations, on-demand locator proposals (proven before use, never auto-promoted or
auto-repaired) and manual failure analysis. The measurements above are unchanged. L1 stays
`in_progress`: the release gate (packaged AI, L7) has not run. The 2B stays NOT RUN, and the 4B pin is
unchanged. Built under it: the Element Spy proposal (L3 › "§1 Element Spy trigger as built").

## Element Spy on the real 0.8B (2026-09-23): functional PASS, proposal correctness INCONCLUSIVE

`verify:ai-spy-live` drives **Find stronger locator with AI** in the real app with the pinned
Qwen3.5-0.8B. It uses the Recorder's own browser, a trusted click, the real IPC, main's loop, compiler,
intent guard and proof, and the production AiService with the real `ai-host.cjs`. It is evidence under
the limited GO, not an acceptance threshold. It does not replace the scripted `verify:ai-assist-gui`
159/0.

**Final-state run: 32 passed, 0 failed, 222 s, exit 2 (INCONCLUSIVE).** An earlier run the same day,
before the diagnostic was corrected, was 31/0 and exited 0. That exit code was wrong: it reported a pass
with no proposal shown.

| Scenario | Outcome | Attempts |
|---|---|---|
| Approve in frame (T3) | refused `PROTECTED` in 0.8 s, before any model call | 0 |
| Edit in the INV-2002 row | `NOT_PROVEN` in 93.9 s | 2 |
| Display name, cancelled mid-inference | `CANCELLED`, host released in 1.1 s (ceiling 3 s) | – |
| Save profile | `NOT_PROVEN` in 106.1 s | 2 |

No proposal was shown, so none could be judged. Every check a person depends on passed: both jobs
settled inside their 400 s job deadline and released the host, T3 made no call, cancel released the
host, no flow, fragment, report, draft or recorded step changed, and no renderer error was logged.

**Why each plan was refused.** Each attempt is the host reply to that job's own infer request, paired by
host id. Each is re-classified through the output contract, the compiler and intent guard, the duplicate
rule and a fresh page:

- **Edit (INV-2002). A contract limit on this fixture, and a model repeat.** Attempt 1 was
  `role button "Edit"` (exact), which the page matches twice. Attempt 2 was the same plan, refused as
  `DUPLICATE_CANDIDATE`. The request did carry the discriminator: a `row` container, and the text
  INV-2002 (reported yes/no, never printed). The instructions tell the model "Scope by stable page
  structure, never by row content", though. Position is refused (`POSITIONAL`). The only thing that tells
  this row apart is therefore its content. Uniqueness, row-content policy and privacy were not relaxed.
  The run of 2026-09-22 already lists rows among the cases no live run covers.
- **Save profile. A model-output violation of the approved plan schema.** Both attempts were
  `strategy css`, with a value shaped `a-a=a-a-a`, the `data-testid=<id>` Playwright engine prefix.
  `SCRIPT_PATTERN`'s engine-prefix branch refused it (`compiler SCRIPT on target.value`). This is the
  intended refusal: `css` admits only a stable `#id`, and a model never returns a selector. The request
  offered `candidate testId (matches 1)`, and `{strategy: testId}` would have compiled. The second
  attempt ignored the feedback ("looked like code or a selector engine prefix"). The request's
  `candidate: <strategy>=<value>` line format may prime the engine-prefix form. Changing the prompt
  needs an owner decision, so it is recorded here, not changed.

**Not changed:** the model, prompt, output cap, attempt limit, locator policy, proof and thresholds. The
two refusals are the product working as designed. The measured limitation is the 0.8B's plan quality on
these two elements.

**Closing it needs** the owner to choose one of these:
- a labelled real-model case that has a discriminator the contract allows, such as a named region or a
  test id on the row; or
- a decision on row-content scoping and the candidate line format.

Rerunning the same fixture is not one of the options.

## Element Spy on the real 0.8B, after the request-format fix (2026-09-23): one proven proposal

The owner authorized one narrow clarification of the model-facing request, followed by one bounded live
run. Neither the owner's limited GO nor any policy was widened.

**The defect in the request.** `contextLines` wrote each capture candidate as `candidate: <strategy>=<value>`,
for example `testId=spy-save-profile`, `text=Save profile` or `id=save`. That is Playwright's
`engine=selector` form. `SCRIPT_PATTERN` refuses that form in a `value`, and for `text=` and `id=` it
refuses the line itself. The 0.8B's two Save profile answers were `css` `data-testid=spy-save-profile`,
the same form with the test-id engine's name. Each candidate is now written as the plan's own target
object, for example `candidate: {"strategy":"testId","value":"spy-save-profile"} matches=1`. The request
carries the same fields, redaction and bound-value drops. The compiler, intent guard and proof are
unchanged. The instructions, output cap (256), attempt budget (2), deadlines and model pin are unchanged.
The longest request any capture can send is 1,003 prompt tokens on the 0.8B tokenizer
(`verify:ai-locator-upgrade-budget` 8/0).

**Regression** (`verify:ai-locator-attempts` 118/118, and 111/118 with the old format restored):
- the offered test id is shown as `strategy testId`, and every candidate line compiles as written;
- no candidate line is in the `engine=` form;
- the 0.8B's `css` `data-testid=` answer is still refused as `SCRIPT`, and so are copied `text=` and
  `id=` values;
- a bound candidate is still never shown.

**Positive scenario: Save profile** (`/recorder-lab/element-spy`, unchanged). It has a unique role and
name and a unique `data-testid`. It has no row, position, frame or sensitive content. The scripted
provider proves both a `role` and a `testId` plan for it through real Electron, the Recorder's own
browser, the compiler, intent guard and proof. The proposal is shown labelled AI and is applied nowhere
(`verify:ai-assist-gui` 162/0). Those scripted runs show the scenario can be solved. They are not
model-quality evidence.

**The live run** (`verify:ai-spy-live`, one run, 240 s): 32 passed, 1 failed, exit 1.

| Scenario | Outcome | Model calls | What each call became |
|---|---|---|---|
| Approve in frame (T3) | `PROTECTED` in 0.5 s | 0 | – |
| Edit (INV-2002) | `NOT_PROVEN` in 102.1 s | 2 | `role button "Edit"` (exact) matches 2, then the same plan refused as `DUPLICATE_CANDIDATE` |
| Display name, cancelled | `CANCELLED`, host released in 1.1 s | – | – |
| Save profile | **`OK` in 114.4 s, shown** | 2 | scoped to a `section`, which matched nothing, refused at proof; then `role button "Save profile"` (exact), proven |

- **Positive-quality observation:** the panel showed `role button "Save profile" (exact)`, labelled AI.
  The answer came from the pinned model. The verifier's own browser judged the shown proposal on a fresh
  page: 1 match, `data-spy=save-profile`, and a click landed there. Nothing was written: no flow, draft,
  fragment, report or recorded step changed.
- **Safe refusals, reported separately:** T3 was refused before any call. Edit refused a non-unique plan
  and then its repeat, as before; this request also showed the row container and INV-2002, but the
  contract still steers away from row content. The Save profile scope that matched nothing was refused
  at proof.
- **Compared with the run before the fix:** that run made 2 compiler `SCRIPT` refusals and showed no
  proposal. This one made 0 compiler refusals, 1 proof refusal and 1 proven proposal. This is one run
  each, so the fix is a probable cause, not a measured one.
- **The failed check was the verifier's.** Its precondition compared host replies with `attemptsUsed`,
  but `attemptsUsed` is the §7 budget, and only refusals spend it. The loop's own contract says an
  accepted answer spends nothing (`verify:ai-locator-attempts` §1). The run's pairing was sound: one job,
  replies 1 and 2 in order, 1 spent plus 1 accepted. The precondition now allows for the accepted reply.
  The live run was not repeated, because the brief bounds it to one run and the product request has not
  changed since.

**What this does not show:** anything about rows, duplicate controls, protected or sensitive elements,
frames, or elements other than Save profile. It sets no quality threshold, promotes nothing and applies
nothing, and it does not change L1's limited GO or L3's status.

## Verifiers

`verify:ai-adapter`, `verify:ai-redaction`, `verify:ai-fallback`, `verify:ai-permissions`, `verify:ai-model-pack`,
`verify:ai-autonomy-policy` (tier matrix, T3 unreachable, cap, self-demotion), `verify:ai-audit-revert`;
`verify:ai-deadlines` (every feature's own deadline, on a virtual clock);
live: `verify:ai-model-live` (`NOT RUN` without pack; `verify:ai-model-live-0-8b` runs it on the 0.8B, with the pack's own
GGUF header checked against its manifest entry), and `verify:ai-explanation-live`, `verify:ai-failure-analysis-live`
and `verify:ai-locator-upgrade-live` (each feature's own request on the 0.8B under its own deadline, each failure
analysis accepted and classified as its fixture requires, and each locator job accepted; `NOT RUN` without pack),
`verify:ai-locator-quality-live` (the 0.8B's locator plans proven by the product in real Chromium on the Feature Test Lab
and judged by the page: false-target 0, the twins refused after a real second attempt, at least one plan browser-proven,
behind five scripted controls; `NOT RUN` without pack), `verify:ai-spy-live` (Element Spy's proposal in the real app
on the 0.8B: functional and safety checks, every attempt re-classified, any shown proposal judged by the page; INCONCLUSIVE,
exit 2, when nothing is shown; `NOT RUN` without pack), and
`verify:ai-failure-analysis-budget` and `verify:ai-locator-upgrade-budget` (each request's prompt and its longest
acceptable answer counted on the 0.8B's own tokenizer against the output cap; `NOT RUN` without pack). Cover runtime/model missing, checksum mismatch, timeout,
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
