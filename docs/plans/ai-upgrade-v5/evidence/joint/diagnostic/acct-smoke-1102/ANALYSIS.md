# Diagnostic `acct-smoke-1102`: a smoke run of the joint-harness accounting (2026-11-02)

**Not a qualification campaign, never aggregated.** It checks that the passive accounting added to
`benchmark:visual-joint` (`aa54a586`) is written and printed. Contract `awkit-vra-joint-harness-accounting-1102`.

- **Command:** `npx tsx scripts/benchmark-visual-joint.mts --diagnostic acct-smoke-1102 --cell headless@1`.
- **Harness:** the working tree before `aa54a586`, with the accounting but without the `inspect` mark, which was added
  afterwards. Hence `treeClean: false`. Product source: `7a0a9227`'s.
- **Governance:** both attempts ran while no write lease was held. The QA lease had been released by a refused amend,
  and the project-state grant was refused because the contract then named `qa` as its writer. This file was committed
  later, under the project-state lease.
- **Diagnostic mode:** the run also has the diagnostic instrumentation (CDP `Performance` and the event-loop delay
  timer). Its timings are therefore not comparable to a campaign.

## Attempt 1: crashed, no file written

The process exited on an unhandled rejection: `page.screenshot: Timeout 25ms exceeded`, thrown at `screenshotViewport`
(`src/visual/internal/captureCore.ts:287`), reached through `VisualFailureDiagnosis.run`'s first capture.

`Budget.race(step)` attaches handlers to `step` only after `this.check()`, and every caller builds `step` before
calling it. So the screenshot promise went unhandled only because `check()` threw. With about 25 ms of budget left,
`check()` throws only on an already-aborted signal. N0 therefore started a screenshot on a cancelled capture and
orphaned it. No pixels are retained, but the process is lost.

How the abort came to precede the screenshot call was not reproduced. Filed as **`awkit-kv3n`** (P1 bug): a product
change in `src/visual`, needed before any new campaign pre-declaration.

## Attempt 2: completed (`N8N9-headless@1.json`)

- 280 trials; every frozen criterion MET in this cell; 0 late, 0 cut.
- **Clock:** wall 153 328 ms, monotonic 153 333 ms, skew −5 ms. The largest wall-against-monotonic difference within one
  trial is 7 ms.
- **Late-released frames:** 0.
- **Marks seen:**
  - frames taken and released;
  - the phase starts `sync-decode`, `sync-fingerprint`, `sync-stateFeatures`, `sync-memberCrop` and `sync-motionPlane`;
  - `capture-2`.
- **Example trial:** frame taken 257.7 ms, fingerprint 258.0, state features 360.1, frame released 459.0, second capture
  460.4, second frame 570.7, motion plane 570.9, released 581.8; ELU 0.813, CPU 594 + 94 ms.
- **Not exercised:** no trial was late or cut, so the per-trial "at deadline" lines were not printed.
