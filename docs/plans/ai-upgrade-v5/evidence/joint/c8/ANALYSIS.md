# Campaign 8: joint N8 and N9 qualification, NOT MET (2026-11-02)

Pre-declared in N8 plan § 12 (`62a3b0bf`), contract `awkit-vra-phase-n-qualification-1102`, project-state lease on
`evidence/joint/c8/**`. The six cell files and `N8N9-joint-summary.json` are committed unchanged (`233734a4`). This
analysis does not exclude, modify or reclassify any record.

- **Revision:** `1c7f8b57`, `treeClean: true` in all six cells. Its product source, joint harness, labs, frozen criteria
  and `benchmark:visual-joint:*` scripts are byte-identical to `62a3b0bf`, so the product source is `7a0a9227`'s. The
  only commit after the pre-declaration is the lease bookkeeping.
- **Run:** `npm run benchmark:visual-joint:<cell>` for the six cells, one after another in one shell, then `:aggregate`.
  01:32:32 to 02:03:29 (+03:00). No other build, verifier, benchmark or browser ran in the VM. No instrumentation.
- **Host:** the approved Windows 11 ARM64 Parallels VM, x64 Node under emulation, bundled Chromium.

## Six-cell matrix

| Cell | R-1 to R-4 | R-5 (row p95, late) | S-1 to S-4 | S-5 (state p95, late) | Protected | Disabled control | Cell |
|---|---|---|---|---|---|---|---|
| headless@1 | MET | MET (71 ms, 0) | MET | **NOT MET** (783 ms, 1) | 12/12 refused, 0 frames | MET | **NOT MET** |
| headless@1.25 | MET | MET (52 ms, 0) | MET | **NOT MET** (624 ms, 2) | 12/12 | MET | **NOT MET** |
| headless@2 | MET | MET (41 ms, 0) | MET | MET (396 ms, 0) | 12/12 | MET | MET |
| headed@1 | MET | MET (31 ms, 0) | MET | MET (249 ms, 0) | 12/12 | **VIOLATION** (1 late) | **NOT MET** |
| headed@1.25 | MET | **NOT MET** (50 ms, 1) | MET | MET (310 ms, 0) | 12/12 | MET | **NOT MET** |
| headed@2 | MET | MET (51 ms, 0) | MET | MET (349 ms, 0) | 12/12 | MET | MET |

The budgets are 150 ms (R-5) and 600 ms (S-5). Pooled: 0 false associations in 396, 0 consistent claims in 180
adversarial trials, 0 `ready` on 324 loading-truth trials, 0 `error` on 792 non-error trials, and 72 of 72 protected
trials refused with 0 frames and 0 codes. **JOINT QUALIFICATION: NOT MET.** Under the frozen repeat rule,
**campaign 9 was NOT RUN.**

## Every late record (hard deadline 1600 ms; disabled controls 1000 ms)

| Cell | Trial | Overrun | Frames taken | N9 / N8 work |
|---|---|---|---|---|
| headless@1 | state `skeleton-shimmer`/b | +54.8 ms | 0 | none (`stateMs` null) |
| headless@1.25 | state `empty-text`/c | +24.6 ms | 1 | none (`stateMs` null, `rowMs` 0) |
| headless@1.25 | state `ready-form`/d | +205.8 ms | 0 | none |
| headed@1 | **disabled control** `ready-table`/b (N5 only) | +126.1 ms | 0 | N8 and N9 off |
| headed@1.25 | rows `ghost`/b | +321.4 ms | 0 | none (`rowMs` null) |

## Diagnosis (once, from the evidence and the host's System log)

1. **The `awkit-vra.18` mechanism did not recur.** That mechanism was synchronous N8/N9 pixel work and N9's second-frame
   decode running past the deadline while a frame was held. In all five late records, no N9 state work and no N8 row
   decision ran. Four took no frame. The fifth (`empty-text`/c) took frame 1 and nothing after it. One late record is a
   disabled-mode control, where N8 and N9 are off. headed@2, the cell this fix targeted, has 0 late records and 0 cuts.
   Its state p95 fell from 548 to 344 ms against campaign 6, and its record p95 from 1160 to 715 ms.
2. **The late records fall in N5's first-capture phase.** That phase is the residual the fix left open, recorded with
   the fix in N8 plan § 12: N5's first capture gets `timeoutMs = remaining`, and N0's synchronous decode of a frame that
   arrives near the deadline is not reserved. A decode like that blocks the deadline timer. If the frame came too late
   to be used, the harness does not count it (`frames` counts only `taken`, not `late-released`). That fits all five
   records, but the qualification run records no phase timing, so it is not shown.
3. **One record coincides with a demonstrated VM suspension.** The System log at 01:59:22 shows "The system time has
   changed to 22:59:22.845Z from 22:43:55.988Z" (Kernel-General event 1, with HAL event 20 and a time-zone refresh), a
   15.5-minute jump. So the VM was suspended at about 01:43:56, 45 s into headed@1.25 (started 01:43:11). This explains
   that cell's 17.5-minute wall time against about 3 minutes for the others. At about 0.6 s per trial, trial 78 (`ghost`/b,
   +321.4 ms) falls at that point. No other time change or power event was logged from 01:30 to 02:05.
4. **The first two cells were slower than campaign 6, on the same work.**
   - headless@1 state work: p50 301 ms, p95 610 ms (campaign 6: 183 and 214 ms).
   - headless@1.25 state work: p50 255 ms, p95 532 ms (campaign 6: 212 and 269 ms).
   - The four later cells match or beat campaign 6: headed@1 194 and 249 ms (campaign 6: 201 and 243 ms).
   - The fix adds no work to state features; it only reserves time. So the S-5 p95 failures in headless@1 and
     headless@1.25 come from a time-local slowdown of the work itself, not from the reserves.
   - The same kind of variance was seen between campaigns 4 and 5 (about 1.7× on the same code), and was not explained.

## Classification

- **Campaign 8: NOT MET** (four of six cells). The failing criteria are S-5 in headless@1 and headless@1.25 (p95 over
  budget plus 3 late records), the disabled-control check in headed@1 (1 late), and R-5 in headed@1.25 (1 late).
- **Cause:**
  - The headed@1.25 late record is attributed to the demonstrated VM suspension.
  - The other four late records and the two S-5 p95 failures are **INCONCLUSIVE**. They fit N5's first-capture residual
    together with a time-local host slowdown, but no record shows the phase in which the time went.
  - No product correction is made in this task: the evidence demonstrates no specific defect, and a correction would
    require a new revision and a new pre-declared campaign pair.
- **Environmental-control breach:** the VM was suspended during headed@1.25, against the declared "VM not used, AC power,
  no interruption" controls. The cell is kept and counts as run, and nothing is excluded.

## Comparison with earlier failed campaigns

| | Campaign 5 headed@2 | Campaign 6 headed@2 | Campaign 8 headed@2 | Campaign 8, other cells |
|---|---|---|---|---|
| Late records | 7 (frames 1, post-frame work) | 1 (+42.8 ms, frame 1) | **0** | 5 (4 with 0 frames, none with N8/N9 work) |
| Cuts | 32 | 3 | **0** | 7 |
| Record p95 / max | 1535 / 1790 ms | 1160 / 1643 ms | **715 / 972 ms** | max 1921 ms (headed@1.25, suspension) |
| N8 false association | 0 | 0 | 0 | 0 in all cells |
| N9 false `ready` / `error` | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 in all cells |
| Protected refusals | 12/12, 0 frames | 12/12 | 12/12 | 72/72 pooled |
| Disabled controls | MET | MET | MET | 1 late (headed@1) |

N8 association recall stays 1000‰. N9 S-3 recall is at or above its floors in every cell (lowest: headless@1 loading
722‰ against 700‰, and error 666‰ against 600‰ in four cells).

## What a next qualification attempt needs (owner's decision; nothing here is implemented)

- Make the joint harness record `late-released` frames, and say which phase was running when the deadline passed. This
  is a harness change, so it needs a new pre-declaration.
- Decide whether N5's first capture should reserve N0's decode (`awkit-vra.18` residual 1). That is a product change: a
  new revision and a new campaign pair.
- Keep the VM from suspending during a campaign (host sleep and Parallels pause settings), and record that the
  monotonic clock and wall clock agree before and after each cell.
