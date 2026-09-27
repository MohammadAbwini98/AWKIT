# L8b — External Compatible-Model Registration & Qualification

Shared rules and the Phase L extension decisions (E1–E12): `ROADMAP.md` › *Phase L extension
(2026-09-27)*. Beads `awkit-djnl.12`. Depends on L8a (`awkit-djnl.11`). Blocks L9 (`awkit-djnl.13`).

**Status (2026-09-27): OPEN — planned, zero implementation.** Every verifier named below is
planned and does not exist yet.

## Objective

Let an administrator register any **compatible** local GGUF model, not only the manifest-listed
packs, while keeping the model optional, the filesystem confined, and the product honest about
which configurations are actually qualified.

## Non-goals

- Bundling a model, downloading one, or an online model catalogue.
- Referencing a model file in place, or hard-linking it (E1: copy only).
- Changing autonomy tiers, T3, or any feature's acceptance thresholds.
- Treating a compatible model as qualified.

## Registration (E1)

- The user selects a `.gguf` in **Settings → Local AI**. The app shows the file size and the free
  space in the app-managed model root, and only then **copies** it there (the current
  `ai:importModelPack` → `modelsDir()` path), hashing during the copy.
- Path-traversal, junction, symlink, mutation-after-hash, tamper and replacement protections stay
  exactly as today (`confineModelPath`, `AWKIT_AI_MODEL_ROOT`, once-per-session checksum
  verification in `AiModelPack.ts`).
- With AI disabled, no model, a load failure or an incompatible model, every deterministic feature
  keeps working.

## Compatibility (E6) — two bounded, cancellable stages, both in the utility host

| Stage | Checks | Failure |
|---|---|---|
| **Static** | GGUF version and readability; architecture supported by the pinned runtime; chat template resolvable; context and token limits; quantization; size and SHA-256 (provenance); licence/notice acknowledgement | `Incompatible` with the failing check |
| **Dynamic probe** | load; one tiny JSON-schema-constrained generation; runtime schema validation; thinking **verifiably disabled** | `Incompatible` with the failing check |

- Today's thinking-off mechanism (an empty think block pre-filled on the assistant turn) is
  Qwen-family specific. A model whose thinking cannot be shown to be off is `Incompatible`.
- GGUF parsing never happens in the Electron main process.
- Both stages report progress through the L9 job-status contract (hashing and copying are
  determinate; the probe is staged).

## Qualification (E6)

| Layer | Key | Meaning |
|---|---|---|
| **Quality qualification** | model SHA-256 + runtime build + backend + offload class (`cpu` / `partial:<layers>` / `full`) + context + configurable KV/attention settings + feature + prompt/output budget | what "Qualified" means; carries across hardware |
| **Latency class** | quality key + hardware class (`MachineCapabilityDetector` buckets, GPU VRAM/capability class, driver version) | measured locally or not claimed; feeds L9's ETA |

- Curated models ship as a source-controlled **qualified list**, release-owned and Risk-3, beside
  `AI_MODEL_MANIFEST`.
- One configuration never qualifies another: GPU does not qualify CPU, full offload does not
  qualify partial, and GPU results never replace CPU functional/fallback verification.
- Existing 0.8B / 2B / 4B CPU evidence stays unchanged, keyed to its historical CPU quality key.
- Labels, each with a reason: `Compatible`, `Qualified`, `Compatible but unqualified`,
  `Incompatible`. Unqualified compatible models run under conservative bounded defaults and are
  never presented as meeting the recommended quality or latency class.
- Never use the licensing machine fingerprint for any key.
- `AiActionRecord` gains the effective profile (backend numerics can change output).

## Trust boundary (E7)

- Accepting arbitrary GGUF files supersedes the 2026-09-19 "manifest-only, no user override"
  decision (`DECISIONS.md`). Threat model: llama.cpp has had GGUF-parser memory-safety advisories,
  and the host runs with the user's privileges.
- Registration keeps `AI_MANAGE` + re-auth. **No new permission** — `ADMINISTRATOR_PERMISSIONS`
  is a denylist, so a new permission would be auto-granted.
- An explicit "unverified model" acknowledgement before a non-qualified model is enabled.
- The runtime pin stays current so parser fixes arrive with app releases.
- Every `src/offline/**` and security slice is Risk-3 and lease-gated.

## Existing owners to extend

| Owner | L8b change |
|---|---|
| `src/ai/AiModelPack.ts` | copy with preflight; drop the manifest-only refusal in favor of compatibility stages |
| `src/offline/AiModelManifest.ts` (Risk-3) | curated entries become the qualified list; `isValidAiModelManifestEntry` unchanged for them |
| `native-hosts/ai/ai-host.cjs` | static header read and dynamic probe requests |
| `src/ai/contracts/AiHostProtocol.ts` | probe request/response, compatibility reasons |
| `src/ai/AiActionRecord.ts` | effective profile field (additive; old records load) |
| `app/main/ipc/ai.ipc.ts`, `app/main/preload.ts` | status and label channels, same permission |
| `app/renderer/pages/LocalAiSettings.tsx` | labels, reasons, acknowledgement, disk-space preflight |

## Implementation slices

| Slice | Content | Lease domain |
|---|---|---|
| L8b.1 | Copy registration with preflight; protections re-proved | security + persistence |
| L8b.2 | Static header checks in the host | runtime |
| L8b.3 | Dynamic probe and thinking-off check | runtime |
| L8b.4 | Qualified list, quality key, latency class, labels | release (Risk-3) + runtime |
| L8b.5 | Settings UI, acknowledgement, `AiActionRecord` profile | frontend + persistence |

## Acceptance and evidence (E11: development machine, packaged build)

- Registration of a compatible non-manifest GGUF; disk-space preflight shown before copy.
- Negative cases: traversal, junction, symlink, mutation after hashing, malformed GGUF, unsupported
  architecture, thinking not disableable — each `Incompatible` with its reason.
- The curated models still read `Qualified` on their historical CPU key; a GPU run of the same
  model reads `Compatible but unqualified` until its own evidence exists.
- Old `ai-settings.json`, model store and `AiActionRecord` files load unchanged (migration).
- Planned verifiers (registered only when written): `verify:ai-model-compatibility` (fake host +
  malformed fixtures), `verify:ai-model-registration` (packaged, development machine).

## Risks and open decisions

- How much of the chat-template check is static vs probe-only — settled by L8b.2.
- Disk usage doubles for a copied model; the preflight makes it visible.
