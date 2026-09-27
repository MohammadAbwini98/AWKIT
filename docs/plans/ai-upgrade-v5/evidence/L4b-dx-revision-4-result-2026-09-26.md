# L4b DX revision 4 — fresh acceptance result (2026-09-26)

Revision 4 was frozen and pushed at `bd4e6bbb` before any revision-4 inference. Its identities, unchanged acceptance limits, and pre-inference checks are in `L4b-dx-revision-4-freeze-2026-09-26.md`. Revision 3 remains NOT MET in its separate result record; revision 2 and the original fresh-run failures also remain unchanged.

The measured revision-3 defect was model prose that omitted the action, invented facts, or exhausted the 176-token budget. Revision 4 gives the constrained decoder a per-issue choice of validator-authored wording containing that issue's supported corrective action, with an optional exact, short rule summary. The model emits one of those texts; the product checks that the value was offered for the same issue and applies the existing display gate. No deterministic fallback is counted as model output. This is a constrained language-selection task, not a claim that the 0.8B can independently write correct free-form diagnoses.

## Performance and fresh plan

- Model: Qwen3.5-0.8B Q4_K_M, SHA-256 `f5b14da98939b60bbe1019a964eba656407e1e0b64f1fe3003ff6d650e93bfec`.
- Runtime: `node-llama-cpp@3.21.1+llama.cpp@v0.4.0`.
- L1.8: GO on all eight criteria with the revision-4 request. Validation explanation at cap: **59,685 ms** against the existing 120,000 ms qualification ceiling; the product deadline remains **125,000 ms**. Benchmark details are in `L1.8-benchmark-full-host-Qwen3.5-0.8B-Q4_K_M.json`.
- Ordered fresh captures: labelled run 1 (parts 9/0 and 8/0), held-out (parts 9/0, 9/0, 5/0), labelled run 2 (parts 9/0 and 8/0). All seven parts passed. The 11-flow, 18-issue held-out corpus is unchanged.
- Per-issue trusted input, raw model output, final displayed text, gate decision, judgement, latency and truncation are retained in the redacted local review store under `%LOCALAPPDATA%/SpecterStudio/ai-quality-review/authoring`. Raw text is not copied into the repository under the existing privacy rule.

## Frozen DX evaluator result

| Criterion | Result | Evidence |
|---|---|---|
| DX-0 | MET | Seven revision-4 captures match the frozen identities; 35 prior captures are preserved and excluded. |
| DX-1 | MET | `verify:ai-authoring` 388/388, real-Electron `verify:ai-assist-gui` 182/182, DX mutations 37/37 killed, display-gate mutations 16/16 killed. |
| DX-2 | MET | Two complete labelled runs and one complete held-out run, in the frozen order. |
| DX-3 | MET | **52/52** displayed texts correct and actionable; zero displayed defects, unsupported claims, misattributions or unjudgeable texts. |
| DX-4 | MET | Undisplayed: **0/17**, **0/18**, **0/17** per run; zero gate refusals, secrets, undelivered issues or escapes. Each run stays below its separate 25% cap. |
| DX-5 | MET | Raw model-own subject/action: **17/17**, **18/18**, **17/17**. The older adopted target remains historically NOT MET; revision 4 does not relabel that old result. |

`npm run verify:ai-authoring-dx` exited 0, MET. The authoring parser, issue-specific membership check, and display gate reject fabricated corrections, unsupported causes or consequences, swaps, secrets, missing action and truncated output in regression controls. No DX threshold, held-out case, secret rule, display-gate rule or deadline changed.

`awkit-djnl.6` closed on this evidence. L6's approved deterministic scope was then reverified and `awkit-djnl.9` closed. L7 has separate package and clean-machine gates.
