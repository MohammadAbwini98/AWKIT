# L8a — Qwen3.5-0.8B quality on the NVIDIA GPU under Automatic (2026-10-03)

The curated Qwen3.5-0.8B (`Qwen3.5-0.8B-Q4_K_M.gguf`, SHA-256 `f5b14da9…`, runtime
`node-llama-cpp@3.21.1+llama.cpp@v0.4.0`) under the stored mode `auto`, on the GTX 980M machine (PCI
`VEN_10DE&DEV_13D7&SUBSYS_11291462`, 8192 MiB, driver 581.80). Every live acceptance gate of the three
qualified features ran through `verify:ai-gpu-quality-part1` and `-part2` (13 gates). Each gate uses its own
labelled set, judge, deadlines and thresholds. The CPU baseline (`verify:ai-gpu-quality-cpu-baseline`) ran
the same 13 gates on CPU & RAM on the same machine.

## Topology and compute are separate questions

- **Topology** is what Windows shows: the display adapters, whether a Remote Display Adapter is present, the
  count Windows or Settings shows. Remote Desktop changes it. It was qualified at the physical console by the
  topology-sensitive gates: the backend gate, the host and packaged gates, the lifecycles and the real
  Settings walkthrough (`CURRENT_STATE.md`).
- **Compute** is where the model calls ran. Remote Desktop adds a display adapter, never a compute device.
  So a quality run under Remote Desktop is compute evidence when the device is proven directly
  (`scripts/ai-harness/gpuQualityEvidence.ts`):
  1. Windows' PCI compute adapters are NVIDIA only, and the same at the start and the end.
  2. Every gate's readiness answered ok.
  3. Every call ran as GPU-Offload on Vulkan with all 25 layers, and every answer came from `vulkan/full`.
  4. Every gate's GPU host started behind the pack guard.
  5. The runtime's own GPU plan bound no more Vulkan devices than Windows' NVIDIA PCI adapters. Readiness counts
     the GPU twice under Remote Desktop, so its count is never the proof.
  6. nvidia-smi read every call. The NVIDIA GPU held at least the model file's size (503 MiB) more while each
     gate's model was loaded than at the runner's idle reading.
- A run that proves all of this under Remote Desktop reads **PASS — NVIDIA compute qualification under
  RDP**. It is never a physical-console topology qualification.

## Runs

| Run | Gate output (temp) | Commit | Topology, start → end | Compute | Gates |
|---|---|---|---|---|---|
| CPU baseline | (not kept) | `097abfa9` + the uncommitted `b3450b43` harness | Remote Desktop (the CPU arm runs anywhere) | CPU & RAM only | 13/13, exit 0 |
| GPU Run 1 | `wRiIXz` + `hXiHsY` | `b3450b43` | console Active, no remote adapter → the same | PASS under the console rule then in force | 6/6 + 7/7, exit 0 |
| GPU Run 2 | `XoGMBF` + `Cnd0Ew` | `63cc74ca` | `rdp-tcp#49` Active, Remote Display Adapter → the same | **PASS — NVIDIA compute qualification under RDP** | 6/6 + 7/7, exit 0 |
| superseded | `uAq4tb` (part 1), `4lDKGN` (part 2) | `b3450b43`, `7374c1b1` | Remote Desktop | INCONCLUSIVE under the final rule: no runtime device count recorded | 6/6, 7/7 |

Run 1 predates the runner's idle readings. It stands on the console rule it ran under, plus every gate's own
execution checks. At the console, readiness counts what Windows lists, so the product's own E2 device check is
exact there.

### Run 2 compute proof

- **Compute adapter, start and end:** `PCI\VEN_10DE&DEV_13D7&SUBSYS_11291462&REV_A1` only. The Microsoft
  Remote Display Adapter is display topology and is never counted as a compute device.
- **Calls:** 43 of 43 were `gpu-offload` on Vulkan (25 of 25) with answers `vulkan/full`. There was no fallback
  reason, no refusal and no CPU answer.
- **Device and hosts:** in all 13 gates, readiness answered ok, the runtime bound 1 Vulkan device, and one GPU
  host started behind the pack guard.
- **NVIDIA VRAM (nvidia-smi):** the idle reading is taken with no gate running; the loaded reading is the
  gate's highest.

  | Part | Idle → loaded MiB, per gate |
  |---|---|
  | Part 1 | 1813→2886, 1813→2972, 1879→3037, 1841→2951, 1841→2961, 1833→2926 |
  | Part 2 | 1845→2916, 1839→2968, 1812→2861, 1782→2868, 1782→2857, 1763→2834, 1763→3082 |

  - The rise is 1049–1319 MiB, against 503 required.
  - At the console (Run 1) the same model rose from about 985 to about 2035 MiB.
  - Remote Desktop raised the idle display memory. It did not change the model's footprint.
- **Remote Desktop changed no compute device:** the PCI adapter set was identical at the start and the end of
  both parts, and every gate bound one Vulkan device.

## Quality

| Measure | CPU & RAM | GPU Run 1 | GPU Run 2 |
|---|---|---|---|
| Gates | 13/13 | 13/13 | 13/13 |
| L4b authoring: accepted · explained · on subject · actionable · misattributed | 9/9 · 17/17 · 17/17 · 17/17 · 0 | 9/9 · 17/17 · 17/17 · 17/17 · 0 | 9/9 · 17/17 · 17/17 · 17/17 · 0 |
| L5 errors: AI · deterministic baseline · false attributions · declines · evidence links | 9/19 · 16/19 · 10 · 1 · 33/33 | 11/19 · 16/19 · 8 · 1 · 31/31 | 10/19 · 16/19 · 9 · 1 · 30/30 |
| L3 locators: browser-proven · false targets | 3 · 0 | 2 · 0 | 2 · 0 |
| Cut by grammar · answers at the output cap | 0 · — | 0 · 0/43 | 0 · 0/43 |
| Median first token (part 1 / part 2) | about 25 s | 783 / 1127 ms | 805 / 1126 ms |
| Median generation (part 1 / part 2) | — | 3457 / 7547 ms | 3730 / 7300 ms |

L3 evidence files:

- CPU: `L3-locator-quality-live-original-20261003T123743Z-d088e0.json`
- Run 1: `…T140503Z-d4f653.json`
- Run 2: `…T152637Z-20b808.json`

### Reading it

- **Acceptance is each gate's own.**
  - L5's gate requires every row delivered as the product contract requires, and records accuracy. It does
    not set a threshold on it.
  - L3's gate requires zero false targets, the impossible case guarded, and at least one plan proven in real
    Chromium.
  - L4b's gate judges each answer against its labelled case.
- **Every arm meets every gate.**
- **Differences are stochastic.**
  - Between the GPU runs, the L5 row `transport-noise` was right in Run 1 and a false attribution in Run 2.
  - The CPU's L5 rows differ again.
  - These are rows changing under one judge, not acceptance failures. Two runs do not rank CPU against GPU.
- **L5's accuracy is below the deterministic baseline in every arm.** This is a property of the 0.8B on that
  set, not of the GPU.

## Decision

- **NVIDIA runtime qualification is closed.** The topology-sensitive gates passed at the physical console,
  and the compute-quality runs are proven on the GTX 980M.
- **The 0.8B's GPU quality is compatible with its qualified CPU & RAM configuration.** It meets every
  repository acceptance gate in two valid runs.
- **The qualified list stays CPU-only.** Adding a Vulkan key is a product change that needs the owner's
  decision ("one configuration never qualifies another", `DECISIONS.md`). Until then the 0.8B reads
  "Compatible but unqualified" on Vulkan, and nothing is gated on that label.
- **NVIDIA handling stays generic:** PCI vendor `0x10DE`, the runtime's device count, and nvidia-smi. Nothing
  here is specific to the GTX 980M.
