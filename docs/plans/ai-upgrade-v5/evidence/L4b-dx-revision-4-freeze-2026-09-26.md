# L4b DX revision 4 — frozen before inference (2026-09-26)

**Status at freeze: no revision-4 model output exists.** Revision 3 is NOT MET on DX-3, with a measured 0/14 displayed correct and actionable, one displayed misattribution, and a malformed response at the 176-token cap. Its captures remain in the local review store and its failure is recorded separately. Revision 4 corrects those measured failures by limiting each model text to the validator's issue-specific action, optionally preceded by an exact short problem from the rule summary. No prior capture counts toward revision 4.

The model emits the selected text under the production constrained decoder. The product accepts only a value offered for that same issue, and the existing display gate still checks it. There is no deterministic fallback counted as model output. The model's task is choosing which trusted problem/action wording to show and, when applicable, ranking only emitted safe fixes. The rule table and corrective-step table generate these choices for every validation code; no held-out answer is hard-coded.

## Frozen identities

| Input | Identity |
|---|---|
| Implementation commit | `7587f020`, committed before this freeze record and before inference |
| Model | Qwen3.5-0.8B Q4_K_M, SHA-256 `f5b14da98939b60bbe1019a964eba656407e1e0b64f1fe3003ff6d650e93bfec` |
| Runtime | `node-llama-cpp@3.21.1+llama.cpp@v0.4.0`; `native-hosts/ai/ai-host.cjs` SHA-256 `dcd20ca9004dc6b53be93f25ca9cc56c7c419cba27625611918bdf318a8c565a` |
| Adapter/config | `src/offline/AiModelManifest.ts` Git blob `a6f2472e72b589fb37aa1ba543d588830972d1b2`; `src/ai/AiPromptBuilder.ts` SHA-256 `c6c5e7faeb621a5d697a37ef7c59c0de35405c71732ef6dfb431e610038768f6`; `src/ai/AiService.ts` SHA-256 `5c79a9acaaa84282da8d8f1dbf07ca6cb39b84e58528594ede84e236819228c9`; `app/main/ai/aiAssist.ts` Git blob `5ce4c93b09570bf6c91a5f59392c006137268677`, SHA-256 `99e741ee1e76093bab938f337708945d2790a6e544a89d90d38d1f3679fe155d` |
| Request/parser | `src/ai/authoringExplanation.ts` Git blob `51b400f3d3593fcf4655117d8ad5842c8ef135d2`, SHA-256 `3c65c899724932fb87bb82d1e673195a58c9e4a3582ce8b6e33d78e3a1e639c9`; instruction SHA-256 `0f72ee35ddc72d1a03f3dbd397e5799081be868b5225f9a7906c6fd7b4961f9c` |
| Display gate | `src/ai/authoringClaimScreen.ts` Git blob `b8142e0b7928dc7143ffba030ba3f5e662a3363f`, SHA-256 `81b0369c2a1815aa92b05592e16ba2f9f02f32333dae87680cecd79e26630a81` |
| DX evaluator | `scripts/ai-harness/authoringDx.ts` SHA-256 `ad38fdb783a29d728b986f501dd1bc23402f9268cac076b91f4778735e654420` |
| Subject/action evaluator | `scripts/ai-harness/authoringQualitySet.ts` SHA-256 `6210c5a41a61ee9a4abb935eb14dd216df081405a49208b63e9b8dc5f618f228`; capture/redaction `scripts/ai-harness/authoringQualityReview.ts` SHA-256 `bca50594ec103e801a42f954426614173dd652fb8b40d7101cc1fdffa514bf9a` |
| Rule tables | `src/validation/FlowValidator.ts` SHA-256 `8d079b27b4ba9593a08c755648dc7125bd4c1cef1e42388ffabb384a37d08d07`; corrective-step table and offered-text construction in the authoring file above |
| Held-out corpus | Owner-confirmed 11 flows, 18 issues, corpus SHA-256 `0db8a5814eee3e08a2a1fc3d8bcb72826af584e48ea8062fd4461ad716ac09d3`; inventory file SHA-256 `9aa4bad4095edeedc42ed716c4d8d64497ceedf19429982c41949b7919c150ed` |
| Output limits | 2 issues per request; at most 120 characters per offered text (parser ceiling 160); 176 output tokens; 3,000 data characters; unchanged 125,000 ms deadline |
| Verification code | `scripts/verify-ai-authoring.mts` SHA-256 `5ba7fd021f776b1209094e446f7cdc56a4b8fedb643b4456e5bc77911991900c`; `scripts/verify-ai-assist-gui.mts` SHA-256 `eb76d8fcc86cec5d84089864e7110819b1c851d31e1211b14d4970e17a9a20fe` |

## Unchanged acceptance

DX-0 to DX-5 retain the revision-3 definitions. DX-3 requires zero displayed unsupported claims or misattributions and at least 80% correct and actionable displayed texts. DX-4 counts every undisplayed issue against the 25% cap **per complete run**. The 125-second deadline, held-out set, secret protections, and raw model evidence stay fixed. The required fresh plan is labelled run 1, the full held-out run, then labelled run 2.

## Pre-inference verification

- `npm run verify:ai-authoring`: 388/388 PASS. Includes all labelled and held-out issue types, every offered wording, omitted or fabricated actions, unsupported causes, secrets, issue swaps, and truncation.
- `npm run verify:ai-assist-gui`: 182/182 PASS on the rebuilt app. Invalid model text is rejected and absent from the screen; validator findings remain visible.
- `npm run verify:ai-dx-mutations`: 82/0 PASS, 37/37 mutants killed.
- `npm run verify:ai-display-gate-mutations`: 40/0 PASS, 16/16 mutants killed.
- `npm run typecheck:scripts`, `npm run build`, `npm run verify:source-hygiene`: PASS (source hygiene 11/0).
- `npm run verify:ai-authoring-held-out`: PASS, committed 11 flows and 18 issues.
- `npm run verify:verifier-classification`: PASS, 277 commands classified.

The next step is L1.8 qualification on this frozen response contract, followed by the fresh DX plan only if performance remains GO. This record and the revision registry must be committed and pushed before any revision-4 inference.
