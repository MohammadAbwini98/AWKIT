# L8a — Hardware-Adaptive Inference Runtime

Shared rules, architecture and the Phase L extension decisions (E1–E12): `ROADMAP.md` ›
*Phase L extension (2026-09-27)*. Beads `awkit-djnl.11`. Depends on closed L1 (`awkit-djnl.1`) and
closed L7 (`awkit-djnl.10`). Blocks L8b (`awkit-djnl.12`) and L9 (`awkit-djnl.13`).

**Status (2026-09-27): OPEN — planned, zero implementation.** Registered by the owner's
post-closeout scope expansion. Nothing in this file is implemented or verified; every verifier
named below is planned and does not exist yet.

## Objective

Let an administrator choose where the local model runs — CPU & RAM, part-GPU, or all-GPU — on
whatever NVIDIA hardware the running machine actually has, without bundling any GPU binary,
without weakening the offline boundary, and without ever breaking non-AI automation.

## Non-goals

- Automatic mode selection, a throughput-comparing planner, or a manual layer-count override (E4
  removes all three).
- AMD or Intel GPUs. Vulkan also enumerates them; they are reported as *detected, not enabled*.
- Multi-GPU tensor splitting. One adapter per load.
- CUDA in the first delivery (E3: a later manifest entry with its own evidence).
- Changing `WorkloadWeights`, the yield-to-runs policy, autonomy tiers or any feature behavior.
- External-model registration (L8b) and progress/ETA (L9).
- Bundling any GPU component, downloading anything, installing drivers, or requiring admin rights.

## Modes (E4)

| Mode | GPU layers | Requires | When it cannot run |
|---|---|---|---|
| **CPU & RAM only** (default) | 0 | nothing beyond the installer | current L1 behavior |
| **GPU-Offload** | largest safe partial count; full if it fits | validated GPU components + a compatible NVIDIA adapter | fewer layers within a bounded retry, then CPU with a visible reason |
| **GPU-Only** | every model layer | the same, plus VRAM for model + context + reserve | refuses to load and names the exact shortfall; never a silent CPU fallback; AI features show unavailable with a one-click mode switch |

- "GPU-Only" means every model **layer** is on the GPU. Sampling and grammar-constrained decoding
  still use the CPU; the UI never says "no CPU use".
- A mode change applies at the next model load, never mid-inference. It unloads and reloads.
- A GPU mode whose components are missing, tampered or changed, or whose probe fails after a
  driver change, becomes **unavailable with a reason**. The mode is never switched silently, and
  non-AI features are unaffected.
- Qualification offload class (L8b): `cpu`, `partial:<layers>` or `full`.

## GPU components (E3)

Nothing GPU ships in the installer or portable. Choosing a GPU mode opens a required-components
checklist in **Settings → Local AI**; the mode cannot be activated until every item validates.
Each item has a Browse action and says where to obtain the file offline.

| Component | Needed for | Validation |
|---|---|---|
| llama.cpp GPU backend pack for the pinned build (Vulkan first), selected as a folder | GPU-Offload, GPU-Only | exact SHA-256 of every file against a release-owned **backend manifest** keyed to `node-llama-cpp@3.21.1+llama.cpp@v0.4.0`; any other file, version or extra DLL is refused |
| NVIDIA CUDA runtime DLLs (only once a CUDA backend is added) | CUDA backend | expected file names, a version range and a valid NVIDIA Authenticode signature |
| NVIDIA display driver with Vulkan support | Vulkan backend | detected by the host probe; never imported |

- The release produces the pinned backend pack separately from the installer, the same way as
  the model pack. The backend manifest lives beside `AI_MODEL_MANIFEST` in `src/offline/**`
  (Risk-3, release role).
- `AI_RUNTIME_PIN` becomes backend-aware (build + backend set). The handshake's `compatible`
  check stops comparing a single build string.
- Accepted components are **copied** into an app-managed runtime folder under
  `%LOCALAPPDATA%/SpecterStudio/`: disk-space preflight, hash during copy, path confinement,
  tamper check at every load (same rules as the model copy, E1).
- The utility host loads GPU binaries **only** from that folder.
- Importing components and changing mode require `AI_MANAGE` + re-auth, like
  `ai:importModelPack`. **No new permission.**
- Existing precedent for "user supplies a runtime component through Settings": the Oracle JDBC
  flow (user-selected Java + imported driver).

## Capability rule (E2)

- NVIDIA = PCI vendor ID **0x10DE** as reported by the runtime. No branching on product name,
  marketing generation or a GPU-name table — anywhere, including tests.
- Enumerate every adapter; hybrid-graphics laptops (integrated + NVIDIA) must be handled.
- Suitability comes from detected capability: backend and driver compatibility, runtime-reported
  capabilities, total/available/usable VRAM, model weights, KV cache, compute buffers, grammar
  overhead, the safety reserve, and current workload.
- No fixed VRAM minimum. GPU presence is not proof of compatibility.

## Offload sizing (GPU-Offload / GPU-Only)

Product policy wrapped around the runtime's own measurement — no hand-written memory estimator.
node-llama-cpp 3.x exposes VRAM state, GPU device names, automatic layer fitting and GGUF resource
estimation; **each API is confirmed against the installed 3.21.1 by a real probe in L8a.0, never
from type definitions.**

1. Enumerate compatible adapters by vendor ID and capability.
2. Identify the backend actually loaded (not the one installed in `node_modules`).
3. Estimate memory before loading.
4. Keep a VRAM safety reserve: system-derived default, admin-configurable within committed bounds;
   out-of-range values are refused, not clamped.
5. GPU-Offload: full offload if the safe allocation fits, otherwise the largest safe partial count.
   GPU-Only: full offload or refusal.
6. Allocation/load failure: bounded lower-offload retries (GPU-Offload only), then CPU with a reason.
7. **VRAM exhaustion after load** (headed Chromium or another app took memory) is its own reason:
   GPU-Offload drops layers or moves to CPU for the session, GPU-Only unloads and reports. Neither
   counts as a generic crash toward the restart circuit (2 restarts / 5 min).
8. Persist the effective backend/device/offload for diagnostics and qualification — never prompts.
9. Never block app startup or non-AI automation.

Adapter choice: with several NVIDIA adapters the user picks one — **only if** the L8a.0 probe proves
the runtime can pin a device (natively or by per-spawn environment on the utility host). Otherwise
the runtime default is used and diagnostics say so.

## Protocol and settings (backward-compatible)

- `AiSettings` gains `executionMode: "cpu" | "gpu-offload" | "gpu-only"` (default `"cpu"`), an
  optional adapter selection, and the VRAM reserve. `sanitizeAiSettingsPatch` refuses invalid
  values. A missing field reads as today's behavior, so old `ai-settings.json` files load unchanged.
- `AiHostProtocol` handshake adds (path-free): runtime build, backend, detected adapters (vendor id,
  capability, total/available VRAM where reliable), selected adapter, requested/effective GPU
  layers, fallback reason, CPU threads. `load` accepts a bounded `gpuLayers` and backend selector;
  the host still refuses anything outside its bounds (`AI_PROTOCOL_VIOLATION`).
- GGUF headers and backend probes run **only in the utility host**, never in the main process.
- Unchanged: crash boundary, bounded queue, one inference at a time, cancel and kill-restart, idle
  unload (now also frees VRAM), yielding to Playwright, zero model calls on the synchronous path.

## Existing owners to extend (no duplicates)

| Owner | L8a change |
|---|---|
| `native-hosts/ai/ai-host.cjs` | `getLlama` backend selection, `gpuLayers`, VRAM probe, extended handshake, OOM reason |
| `app/main/ai/AiUtilityHostManager.ts` | load GPU binaries from the app-managed folder; restart policy distinguishes VRAM exhaustion |
| `app/main/ai/aiRuntime.ts` | mode plumbing, component status, effective profile |
| `src/ai/contracts/AiHostProtocol.ts` | handshake and load fields, new reason codes |
| `src/ai/AiSettings.ts`, `src/ai/AiService.ts` | mode, adapter, reserve; effective-profile reporting |
| `src/ai/AiAdmission.ts` | admission reads the effective profile (weights unchanged) |
| `src/offline/AiModelManifest.ts` (Risk-3) | backend manifest, backend-aware `AI_RUNTIME_PIN` |
| `scripts/prepare-ai-native-host.mjs` | stays CPU-only; release tooling produces the separate backend pack |
| `app/main/ipc/ai.ipc.ts`, `app/main/preload.ts` | component import/status channels under `AI_MANAGE` + re-auth |
| `app/renderer/pages/LocalAiSettings.tsx` | mode selector, component checklist, adapter picker, reasons |
| `scripts/validate-offline-bundle.ps1` | backend manifest is signed and checked; no GPU file in the installer |
| `scripts/lib/verifier-classification.ts` | registers each new verifier once it exists |

## Implementation slices (each independently verifiable)

| Slice | Content | Lease domain |
|---|---|---|
| L8a.0 | Backend gate on the packaged build: stage Vulkan pack, measure size delta and driver/Vulkan floor, probe the 3.21.1 VRAM/device/layer APIs and device pinning, prove DLL resolution only from the app-managed folder | release + runtime |
| L8a.1 | Backend manifest, backend-aware runtime pin, signed-manifest and offline validation | release (Risk-3) |
| L8a.2 | Component import: checklist, hash-validated copy, tamper check, permissions | security + runtime |
| L8a.3 | Host protocol + three modes + offload sizing + fallback/refusal reasons | runtime |
| L8a.4 | Settings UI and diagnostics | frontend |
| L8a.5 | GPU cancel ceiling, kill-restart-reload cost, VRAM-exhaustion handling, packaged evidence | qa |

## Acceptance and evidence (E11: development machine, packaged build)

- **L8a.0 record**: component list and hashes, package-size delta, driver/Vulkan floor, runtime API
  probe results, adapter-pinning result, and the **loader-isolation proof** that no DLL resolves
  from PATH, a system CUDA Toolkit or the development tree (same method as the L7 VC++ loader proof).
- CPU & RAM only re-proved on the packaged build (no regression from the closed CPU profile).
- GPU-Offload and GPU-Only live runs on the development machine's NVIDIA adapter.
- The L1.8 **≤3 s cancel ceiling** and the kill → restart → VRAM reload cost, measured in both GPU modes.
- Fake-host deterministic cases: no GPU, unsupported GPU, low VRAM, sufficient VRAM, multiple
  adapters, missing components, tampered components, VRAM exhaustion after load, cancel, crash.
- Mutation testing of each new verifier once green.
- Planned verifiers (names indicative, registered only when written): `verify:ai-gpu-modes`
  (fake host), `verify:ai-gpu-components`, `verify:ai-gpu-packaged` (live, development machine).
- **Truthful claim:** GPU modes are verified on the development machine's adapter. Every other
  adapter is "Compatible but unqualified" until someone runs it; the capability rule (E2) still
  decides eligibility. No external machine, clean VM GPU run or second adapter is required.

## Risks and open decisions

- Device pinning may not be supported by 3.21.1 → adapter picker deferred (decided by L8a.0).
- Vulkan driver floor unknown until measured.
- Backend pack size and how the release produces it (from the pinned npm prebuilt) — L8a.0.
- A driver update can invalidate a working GPU mode; the unavailable-with-reason path covers it.
