# L4b DX revision 3 — frozen before inference (2026-09-26)

**Status at freeze: no revision-3 model output exists.** Revision 1 and revision 2 remain NOT MET and their captures remain in the local review store. The owner requested a new evidence-bounded 0.8B recovery on 2026-09-26. This revision changes the authoring request and output budget; it does not change the held-out corpus, evaluator thresholds, display gate, model, runtime, or deadline.

The validator supplies the issue code, blocking decision, anchor kind, rule summary (`Problem`), and trusted corrective step (`Action`). The model is asked to copy the action verbatim and optionally add a brief problem from the given words. It is not asked to infer a cause or runtime consequence. The product continues to show the validator's own finding and corrective step separately, and withholds unsafe model prose under the existing gate. This revision adds no deterministic fallback to model text and claims no fallback as model success.

## Frozen inputs

| Input | Identity |
|---|---|
| Model | Qwen3.5-0.8B Q4_K_M, SHA-256 `f5b14da98939b60bbe1019a964eba656407e1e0b64f1fe3003ff6d650e93bfec` (measured from the local pack) |
| Runtime | `node-llama-cpp@3.21.1+llama.cpp@v0.4.0`; `native-hosts/ai/ai-host.cjs` SHA-256 `dcd20ca9004dc6b53be93f25ca9cc56c7c419cba27625611918bdf318a8c565a` |
| Model adapter/config | `src/offline/AiModelManifest.ts` Git blob `a6f2472e72b589fb37aa1ba543d588830972d1b2`; `src/ai/AiPromptBuilder.ts` SHA-256 `c6c5e7faeb621a5d697a37ef7c59c0de35405c71732ef6dfb431e610038768f6`; `src/ai/AiService.ts` SHA-256 `5c79a9acaaa84282da8d8f1dbf07ca6cb39b84e58528594ede84e236819228c9`; `app/main/ai/aiAssist.ts` Git blob `74180291114b7eecc9718b8d2761f4dc90665e2b` |
| Authoring request and parser | `src/ai/authoringExplanation.ts` Git blob `38af77bb43a3d0ab352a6b1fc75f7fd37b565d02`, SHA-256 `b582d1504495f6df687c3791e6fe2f343f5c37f69e34f1d9dddda0ff62d0240a`; instruction SHA-256 `407d8b735a371dc74d569884523bc6607187dc20a8e9146229f3d1ae0f8a7fce` |
| Display gate | `src/ai/authoringClaimScreen.ts` Git blob `b8142e0b7928dc7143ffba030ba3f5e662a3363f`, SHA-256 `81b0369c2a1815aa92b05592e16ba2f9f02f32333dae87680cecd79e26630a81` |
| DX evaluator | `scripts/ai-harness/authoringDx.ts` SHA-256 `92b81ac4e534f1976be8a249f144d3115e22115f41d4c72d1b902c6f62a89b0c` |
| Subject/action evaluator | `scripts/ai-harness/authoringQualitySet.ts` SHA-256 `6210c5a41a61ee9a4abb935eb14dd216df081405a49208b63e9b8dc5f618f228`; capture/redaction `scripts/ai-harness/authoringQualityReview.ts` SHA-256 `bca50594ec103e801a42f954426614173dd652fb8b40d7101cc1fdffa514bf9a` |
| Validator rule table | `src/validation/FlowValidator.ts` SHA-256 `8d079b27b4ba9593a08c755648dc7125bd4c1cef1e42388ffabb384a37d08d07`; corrective-step table is in the authoring file above |
| Held-out corpus | The owner-confirmed 11 flows, 18 issues, corpus SHA-256 `0db8a5814eee3e08a2a1fc3d8bcb72826af584e48ea8062fd4461ad716ac09d3`; inventory file SHA-256 `9aa4bad4095edeedc42ed716c4d8d64497ceedf19429982c41949b7919c150ed` |
| Bounds | 2 issues/request; 160 characters/model text; 176 output tokens; 3,000 data characters; 125,000 ms explanation deadline |

Revision 3's implementation was committed at `6da43a9e` before this freeze. The DX revision registry names that commit and pins the four source blobs it checks at capture time. This record and the registry commit must be pushed to `origin/main` before the first fresh inference.

## Acceptance remains unchanged

- DX-0: every capture must match the revision-3 frozen inputs.
- DX-1: deterministic finding and corrective action remain available, proved by the authoring and GUI gates.
- DX-2: two complete fresh labelled runs and one complete fresh held-out run on the owner-confirmed corpus.
- DX-3: the frozen automated reviewer finds zero displayed unsupported claims or misattributions, and at least 80% of displayed texts are correct and actionable.
- DX-4: at most one in four issues has no displayed model text **in each run**; a missing answer or secret withholding counts.
- DX-5: raw model text, model-only quality, gate decisions, and the earlier NOT MET results stay separately visible.

## Deterministic pre-inference evidence

- `npm run verify:ai-authoring`: 379/379 PASS, including a concise action-only response on every issue of both frozen corpora.
- `npm run verify:ai-dx-mutations`: 82/0 PASS, 37/37 mutants killed.
- `npm run verify:ai-display-gate-mutations`: 40/0 PASS, 16/16 mutants killed.
- `npm run typecheck:scripts`: PASS.
- `npm run build`: PASS.
- `npm run verify:source-hygiene`: 11/0 PASS.
- `npm run verify:verifier-classification`: 277 commands classified, PASS.

The next gates are the unchanged L1.8 qualification on this request and then the fresh DX run plan. No acceptance result is asserted by this freeze.
