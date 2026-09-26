# L4b DX revision 3 — NOT MET (2026-09-26)

Revision 3 was frozen and pushed at `f2bf1073` before model output. Its inputs are in `L4b-dx-revision-3-freeze-2026-09-26.md`. The prior revision 1 and 2 failures remain separate and unchanged.

## Performance qualification

`npm run benchmark:ai-model-0-8b`: **GO**, 8 of 8 L1.8 criteria. The validation explanation took 68,627 ms at the 176-token cap (ceiling 120,000 ms); the product deadline remains 125,000 ms. The command refreshed `L1.8-benchmark-full-host-Qwen3.5-0.8B-Q4_K_M.json` with its measured packet and host details.

## Fresh inference and DX

- `verify:ai-authoring-quality-live-part1`: 9/0. Five cases and ten issues were delivered, with no secret leak. The model's own text was actionable on **0/10** issues despite the request to copy each trusted action.
- `verify:ai-authoring-quality-live-part2`: 6/2. Three of four cases delivered; `duplicate-timeout` returned `MALFORMED_OUTPUT` after 73,287 ms, with a 176-token cap. The harness recorded all four cases, including the undelivered two issues.
- The frozen `verify:ai-authoring-dx` returned **NOT MET** (exit 1): DX-0 MET, DX-1 separate authoring/GUI gates, DX-2 PENDING (one complete labelled run, no held-out or second labelled run), DX-3 **NOT MET** (14 displayed, 0 correct and actionable, one displayed MISATTRIBUTED), DX-4 PENDING (3 of 17 undisplayed in the incomplete plan's first labelled run: one gate, two undelivered), DX-5 MET. Model-only actionable rate was **0/17**. The earlier revisions' captures were retained and excluded.

The remaining revision-3 inference parts were stopped after this actionable failure. They cannot make the already failed DX-3 or the malformed response pass, and repeating a failing command would not be a corrective action. The raw texts and issue-level capture evidence remain in the local redacted authoring review store under `%LOCALAPPDATA%/SpecterStudio/ai-quality-review/authoring`; model text is not copied into this repository.

## Measured correction for the next revision

Free prose still omits the supplied action and sometimes reassigns the problem, even with a short request. The next revision should constrain the decoded text to request-specific, validator-authored problem/action variants. It must still have the model emit the text, preserve the unchanged gate and DX evaluator, and freeze and push before any inference. This is a response-contract correction, not a threshold change or a different model.
