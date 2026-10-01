# L11.G — AI-context normalization: implementation, comparison, decision (2026-10-01)

Beads `awkit-djnl.19`. Plan: `../L11-performance-dom-intelligence.md` (E10). Data:
`L11-normalization-results.json` (this folder), `scripts/ai-harness/pageContextCases.json`.

## Decision

**The normalized page context is implemented and verified, and stays OFF by default.** It runs only
with `AWKIT_AI_PAGE_CONTEXT=on`. On the labelled L5 set, it made the failure analysis one row worse
and no row better on the real Qwen3.5-0.8B, while costing 37% more prompt tokens and 24% more
inference time. The rule for this stage was that a different prompt is no reason to change what the
analysis reads unless quality holds, and here quality did not hold.

## The path (as built)

```text
eligible page (the failed step's page, after its last attempt)
 → protected-surface refusal: the Recorder's own detector (sign-in, MFA/OTP, CAPTCHA, passkey,
   device approval, known identity providers), then the serializer's password/OTP check
 → in-page minimization: captureDomSnapshot normalize mode (no scripts, styles, templates, comments,
   iframes, SVG or media bodies, no value/on*/style/srcdoc, hidden subtrees dropped, password, hidden and
   OTP inputs dropped, query strings dropped, 256 KiB cap; control STATE only: disabled, required, invalid)
 → parser-only host normalize_dom (data rows only in tables since 0615af12)
 → pageContext.ts: closed shape and role vocabulary, SemanticRedactor on every string, the residual
   rescan of what would be stored, hard per-list and per-string bounds
 → FailureEvidenceCollector (dropped under a protected step, a protected document or raw-UI-text
   suppression) → report.json diagnostics.pageContext (or pageContextRefusal)
 → failureBatch → buildFailureAnalysisRequest: a non-citable PageAtFailure field, last, so it is the
   field dropped if the data budget runs out; grammar and citable ids unchanged
 → AiService
```

No fetcher, crawler, second browser, `scrapling[rag]` or semantic indexing of raw DOM is involved.
Provider absence, timeout or a malformed answer yields no context, and the request is then the exact
request built before (checked byte for byte).

## Gates

- `verify:dom-normalization` 143/0. It drives the real staged host over 20 fixture pages and the
  product path through the real ExecutionEngine.
- Mutations killed, 5 of 5:
  1. Redaction removed: visible secrets reached the context.
  2. List bounds removed: the scale page broke its bounds.
  3. The in-page hidden drop removed: all four hidden canaries reached the host.
  4. The protected-surface detector bypassed: the CAPTCHA and passkey pages reached the host. The
     password and OTP pages were still refused by the serializer's own check, a second layer.
  5. A provider fault turned into an empty "ok" context: the disabled, hung and malformed cases failed.
- During mutation 1 the first safety fixture turned out to be vacuous: its visible secrets sat beyond
  the text bound, so the bound, not the redactor, removed them. The secrets now sit inside every bound
  and their surrounding words are labelled facts, so only redaction can pass that check.

## Measured (development host, labelled pages)

| Measure | Value |
|---|---|
| Causal facts kept, 13 labelled pages | normalized context 23/23 · browser `innerText` (the L10.0 baseline) 19/23 (no field/button state, no empty table) |
| Canary or secret leaks into the context or prompts | 0 (20 pages, 13 prompts) |
| Redaction escapes (residual rescan replacements) | 0 |
| Protected pages refused before any HTML left them | 4/4 (password, OTP, CAPTCHA, passkey); the SSO-text control is not refused |
| Scale page (≈ 12k elements) | truncated, every list within its bound, rendered ≤ 1,200 chars, HTML ≤ 256 KiB |
| Bytes, 13 labelled pages | raw DOM 6,294 · `innerText` 1,504 chars · sanitized HTML 8,124 · normalized JSON 6,736 · rendered 4,040 chars |
| Capture latency (detector + snapshot + host + normalize), warm | p50 10–20 ms, p95 52–109 ms over 20 captures (four runs) |
| Host cold start | 0.7–4.4 s (CPU-contended during the runs; 0.17 s in `verify:dom-intelligence-host`) |
| Prompt size, 13 rows (characters) | old 21,686 → with page context 28,911 (+33%) |

The fixture pages are small, so sanitized HTML is not smaller than the raw DOM here: the per-element
index stamps and state attributes outweigh the scripts and styles the pages lack. The reduction that
matters on real pages, unbounded raw DOM to a bounded summary, is shown by the scale page.

## Live comparison: old evidence versus old evidence plus page context

Real Qwen3.5-0.8B (`Q4_K_M`, sha256 `f5b14da9…`), node-llama-cpp 3.21.1, 4 inference threads, the
production `analyzeFailure` → `AiService` → `ai-host.cjs` path. Both arms ran in the same session on
the same 13 analysed rows of L5's synthetic labelled set: the six `part1` rows, the five `part2`
rows and the two step-provenance rows. The captured `rq-*` cases have no page and are not part of
this comparison.

| Arm | AI right | False attributions | Declines | Prompt tokens (mean) | Inference (mean) |
|---|---|---|---|---|---|
| Old (current product) | 10/13 | 3 | 1 | 426 | 78 s |
| + page context | 9/13 | 4 | 1 | 582 (+37%) | 97 s (+24%) |

Per row, every row matched except `earlier-step-cause`. With the page context the model cited the
unrelated console error beside the real cause as primary evidence, which counts as a false
attribution. No row improved. Every row in both arms was delivered within its deadline, with no
canary, no residual secret and every citation shown whole.

Scripts: `verify:ai-error-quality-live-part1` / `-part2` / `-provenance` (old arm), and
`verify:ai-error-quality-live-page-context-part1` / `-part1b` / `-part2` / `-part2b` / `-provenance`
(new arm). The longer prompts pushed `part1` past the launcher's time budget after five rows, so its
last case ran as `part1b`.

## Change after the comparison (independent review, 2026-10-01)

- Rendered strings are now JSON-quoted, and region entries are quoted too, so an embedded quote cannot
  forge a segment. Over the 13 labelled pages this adds 122 rendered characters (4,040 → 4,162). The live
  comparison above used the earlier format and was not re-run.
- A context read back from `report.json` is re-validated (`readPageContext`) before it reaches a prompt.
- `verify:dom-normalization` is now 150/0.

## Limits of this evidence

- The comparison is one run per row on a 0.8B model, so a one-row difference is within run-to-run
  noise. It is reported as observed and not explained away; the decision follows the rule above.
- The labelled pages were authored from each case's events before any model saw a context. Two of
  them carry an unrelated on-page message on purpose. A different page set could score differently.
- The page context cannot be cited, and a declined case is decided from the evidence events. So the
  context cannot turn a decline into a conclusion. That is by design, and it caps what the context
  can add.
