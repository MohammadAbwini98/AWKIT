# Diagnostic `c5-headed2-d1` — campaign-5 headed@2 investigation (2026-11-01)

**Not a qualification campaign.** One separately identified, lease-authorized run (contract
`awkit-vra-phase-n-recovery-1101`, project-state lease on `evidence/joint/diagnostic/**`), written only here, never
aggregated, never compared against the frozen criteria. Campaign-5 evidence (`../../c5/`) is unchanged.

- Command: `npm run benchmark:visual-joint:diagnostic` (`--diagnostic c5-headed2-d1 --cell headed@2`).
- Revision `27f6dd8a`. The product source is byte-identical to campaign 5's `c4e91fc0` (only the harness gained the
  opt-in diagnostic mode). `treeClean: false` comes from the lease bookkeeping files the grant wrote
  (`docs/ai/contracts/active-lease.json`, `tools/roadmap/assignments.json`), not from product or harness source.
- Host: Windows 11 ARM64 (`ARMv8 (64-bit)`), 8 logical CPUs, 12 GB, x64 Node v24.20.0 under emulation.
- Collected per trial (timings and counters only; no page content, values, pixels or text): Node event-loop delay
  (10 ms resolution) and utilization, process CPU, RSS and heap, host CPU busy share (`os.cpus()` deltas), Chromium
  renderer `TaskDuration`/`ScriptDuration`/`LayoutDuration`/`RecalcStyleDuration` deltas (CDP `Performance`), page
  `visibilityState` and `hasFocus()`, an evaluate round trip before and after, and the adapter's frame timestamps.

## Result

280 trials, **37 cuts, 0 late records** (record p50 582 ms, p95 1511 ms, max 1532 ms against 1600 ms).

| Signal | Cut / slow trials (median) | Other trials (median) |
|---|---|---|
| Node event-loop utilization | 0.04 | 0.76 |
| Node process CPU (user) | 62 ms | 484 ms |
| Event-loop delay max | 35 ms | 105 ms |
| Host CPU busy share | 0.18 | 0.23 |
| Renderer task time | 22 ms | 21 ms |
| Evaluate round trip before / after | 3.3 / 3.6 ms | 1.6 / 2.8 ms |
| Page visibility / focus | `visible` / focused (all 280) | same |
| First frame taken | **never** (30 of 37 cuts have 0 frames) | 188 ms |

Instrumentation cost outside the measured window: median 14 ms per trial (p95 31 ms, max 155 ms). Inside the window only
the event-loop delay timer ran.

## Reading

1. **The diagnostic did not reproduce campaign 5's burst.** Its cuts fall on every *animated* state fixture
   (`spinner`, `spinner-overlay`, `skeleton-shimmer`, `partial-skeleton`, `progress-indeterminate`, `loading-dots`,
   `ready-live-badge`) in all three variants, with no frame taken. Campaigns 4 and 5 ran the same fixtures in the same
   order without instrumentation and never cut them. The pattern is deterministic and fixture-bound, so it is an
   **observer effect of the instrumentation** (most likely the CDP `Performance` domain enabled on the page under
   test), not the campaign-5 mechanism. Campaigns 6 and 7 run without instrumentation.
2. **What it does show.** When a frame stalls, Node is idle, the renderer main thread is not busy, the page is visible
   and focused, and it answers an evaluate in a few ms: the stall is in Chromium's screenshot path, and N5 still
   settles at its deadline (0 late in 37 cuts).
3. **Campaign 5's burst is a different mechanism.** Its 32 cuts and 7 late records almost all *had* N5's frame
   (`frames: 1`, no state result): the time went into post-frame work (synchronous pixel work, or waiting for N9's
   second frame). The 7 late records (+44 to +190 ms) overran while a frame was held, which is what synchronous pixel
   work longer than the fixed `VISUAL_DIAGNOSIS_SYNC_NS_PER_PIXEL` (200 ns/px, a 384 ms reserve for a headed@2 frame)
   produces. The burst covers about 37 consecutive trials across two labs and many fixtures; the same fixtures in
   variants b and d ran normally (median ~563 ms against ~1526 ms in the burst).
4. **Host timing varies between campaigns on the same code.** Same-cell medians moved by about 1.7x between campaigns
   4 and 5 (headed@1: 321 → 549 ms; headless@1: 512 → 304 ms). Windows System, Defender and Task Scheduler logs for
   the campaign-5 headed@2 window show only an RTC query error at 01:36:43 and a Defender health report at 01:36:56
   (local), neither aligned with the burst.

## Classification: **INCONCLUSIVE**

No cause of the campaign-5 slowdown is demonstrated. The evidence is consistent with a time-local slowdown of the
emulated x64 Node process (all post-frame work ~2.7x slower for ~40 trials), and not with a fixture, a lab transition
or the product delta (one 1-px crop per frame). No external contention was measured during campaign 5, so it is
**not** called an environmental flake. No trial is excluded and no threshold or deadline changes.

**Product finding (not a fix in this task):** the synchronous-work reserve is a fixed per-pixel estimate measured on
this host, so a host slowdown larger than its margin can carry synchronous work past the hard deadline. Recorded with
the F2 pixel-cost follow-up (whole-frame cost, bounded and chunked work, host-adaptive reserve).

**Supported environmental controls** for campaigns 6 and 7: the approved ARM64 Parallels host, AC power, no
interactive use of the VM while a cell runs, cells run sequentially in one shell, no other benchmark or build in
parallel, and no instrumentation.
