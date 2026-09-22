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
  not on a person reading the answers. `verify:ai-authoring-quality-live` is still not built.

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
   tokens. Or re-scope the ceilings. *(Done for failure analysis at `42655904`; see "`failureAnalysis`
   inside its ceiling at its own output cap". The locator request is unchanged.)*
2. Re-point the benchmark's two packets at the product's requests, as `7f0e931e` did for the
   explanation. *(Done for failure analysis at `42655904`; `packets:locatorUpgrade` is still a stand-in.)*

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
  (`verify:ai-error-quality-live`, not built).
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
| **L1.8 live inference latency** | 4B: **FAIL** — `locatorUpgrade` >240,000 ms against a 180,000 ms ceiling; product path `TIMEOUT` at 120 s. Re-scoped Qwen3.5-0.8B: benchmark **GO on all 8** (`f58cf28f`), not pinned; its explanation is delivered in the product under its own 125 s deadline (`d2f5feb2`). Failure analysis and locator upgrade have their own 185 s deadlines (`d71ee244`). Real failure analyses are accepted and classified since the answer contract was rebuilt (`5ef4852f`), and the product's own failure-analysis request meets its ceiling at its own 256-token cap (132.3 s, `42655904`); the locator request still exceeds it at its 512-token cap | **release only — unmet** until the pin and live gates |

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
   passes. L7 cannot be entered on this authorization.

**Still outstanding for L1 acceptance:** the qualifying hardware was re-scoped on 2026-09-21 to this
machine with all 12 logical CPUs, and the 4B still FAILS there (see "Re-scoped to the qualifying
host"). The owner then re-scoped the model to Qwen3.5-2B and Qwen3.5-0.8B. The cancel defect
`awkit-g555` is fixed and closed. The 0.8B's benchmark is **GO on all 8** since the product's
explanation request was fixed (88.3 s against 120 s; see "`validationExplanation` fixed in the
product"). It still owes the pin, its license notice, `verify:ai-model-pack`, `verify:ai-model-live`,
and the live quality gates. Every feature now has its own deadline (`d2f5feb2`, `d71ee244`). The answer
contract that refused every real failure analysis is fixed (`5ef4852f`), and the failure-analysis request
now meets its ceiling at its own output cap, measured on the product's own request (`42655904`; see
"`failureAnalysis` inside its ceiling at its own output cap"). The locator upgrade still exceeds its
180 s ceiling at its own 512-token output cap, and `packets:locatorUpgrade` is still a stand-in (see
"`failureAnalysis` and `locatorUpgrade` measured through the product"). So L1 is not accepted. The 2B is
NOT RUN because it is not downloaded.

## Verifiers

`verify:ai-adapter`, `verify:ai-redaction`, `verify:ai-fallback`, `verify:ai-permissions`, `verify:ai-model-pack`,
`verify:ai-autonomy-policy` (tier matrix, T3 unreachable, cap, self-demotion), `verify:ai-audit-revert`;
`verify:ai-deadlines` (every feature's own deadline, on a virtual clock);
live: `verify:ai-model-live` (`NOT RUN` without pack), and `verify:ai-explanation-live`, `verify:ai-failure-analysis-live`
and `verify:ai-locator-upgrade-live` (each feature's own request on the 0.8B under its own deadline, and each failure
analysis accepted and classified as its fixture requires; `NOT RUN` without pack), and `verify:ai-failure-analysis-budget`
(the failure-analysis prompt and its longest acceptable answer counted on the 0.8B's own tokenizer against the output cap;
`NOT RUN` without pack). Cover runtime/model missing, checksum mismatch, timeout,
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
