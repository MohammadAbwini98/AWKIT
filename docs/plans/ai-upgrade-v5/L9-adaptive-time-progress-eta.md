# L9 — Adaptive Time Budgets, Progress & ETA UX

Shared rules and the Phase L extension decisions (E1–E12): `ROADMAP.md` › *Phase L extension
(2026-09-27)*. Beads `awkit-djnl.13`. Depends on L8a (`awkit-djnl.11`) and L8b (`awkit-djnl.12`)
for **acceptance**; builds on the closed L4b / L5b / L6 feature surfaces.

**Status (2026-09-29): CLOSED — L9.1–L9.5 implemented with QA PASS** (contract
`awkit-djnl-13-l9-0929`; commits `16de408b`, `a748b4b6`, `5cd3a195`, `ccfdd07c`). The QC follow-up
`awkit-djnl.17` is closed too (`7f5deca1`). See *L9 record (2026-09-29)* and *QC follow-up* at the end.

## Objective

Every long-running AI operation tells the user what it is doing, how long it has been doing it and
roughly how much longer it will take — honestly — and every AI request runs under a bounded,
feature-specific time budget.

## Non-goals

- Rewriting the historical 120 s (`AI_HOST_TIMEOUTS.loadMs`) and 125 s (authoring explanation)
  values: they stay as acceptance evidence for the closed CPU profile.
- Converting any past failure into a pass by raising a timeout.
- Infinite or unbounded jobs.

## Time budgets (E8)

- Bounded budgets per feature: locator assistance, authoring explanation, failure analysis, fragment
  assistance, model load, compatibility probe, component copy, and later AI features.
- Four separate things, never merged: **benchmark acceptance ceilings**, **runtime request
  timeouts**, **cancel grace / forced host termination**, and **ETA ranges**.
- Defaults come from quality-qualified evidence where it exists, otherwise from committed
  conservative bounds.
- Administrators may configure a budget only within committed min/max bounds; the settings
  sanitizer **refuses** out-of-range values rather than clamping them, matching
  `sanitizeAiSettingsPatch`.
- A changed budget requires re-benchmarking that configuration; it never re-labels old evidence.

## Job-status contract (E9)

One contract for every long AI operation:

- state: `queued` / `running` / `cancelling` / `completed` / `failed` / `timed-out`;
- queue position and hold reason (e.g. yielding to a run);
- stage: compatibility check, component or model copy/hash, backend probe, model load, prompt
  preparation, prompt evaluation, generation, validation, finalization;
- elapsed time;
- ETA **range** + confidence/sample count + cold or warm;
- effective profile (model, backend, device, offload);
- cancel action and terminal reason.

## Progress rules

- **Determinate** only with a known denominator: hashing, copying, known model-load progress,
  prompt evaluation.
- **Generation is indeterminate.** Constrained JSON usually stops well before `maxTokens`, so
  tokens/maxTokens is not a valid percentage. Show stage + elapsed + ETA range.
- Never fabricate a linear percentage from elapsed time.
- Defined behavior for: first run with no history, cold vs warm, timeout, cancellation, model
  reload, CPU fallback (L8a), reduced motion, keyboard, screen reader, app restart.

## ETA history

- Bounded aggregates keyed by the non-sensitive quality key + latency class + feature (L8b).
- Stored under `%LOCALAPPDATA%/SpecterStudio/`, written through `app/main/atomicReplace.ts`
  (retry-safe tmp + rename), versioned for migration, capped per key.
- Never prompts, page text, responses, secrets or credential-bearing metadata.

## Accessibility

- `role="progressbar"`; `aria-valuenow` only when progress is determinate.
- Polite, throttled announcements on stage changes — not every second.
- Any modal job view carries the full focus contract (focus in, trap, restore) — this defect class
  has shipped three times.
- Hologram tokens only; reduced-motion honored by the indeterminate animation.

## Existing owners to extend

| Owner | L9 change |
|---|---|
| `src/ai/AiService.ts` | emits job events; per-feature budgets replace fixed timeouts |
| `src/ai/contracts/AiHostProtocol.ts` | load / prompt-evaluation progress where the runtime reports it |
| `src/ai/contracts/AiApi.ts`, `app/main/ipc/ai.ipc.ts`, `app/main/preload.ts` | job-status subscription channel |
| `src/ai/AiSettings.ts` | budget settings with committed bounds |
| `src/ai/authoringExplanation.ts`, `failureAnalysis.ts`, `fragmentAssist.ts`, locator jobs | consume the budget table |
| `app/renderer/pages/LocalAiSettings.tsx` and each AI feature surface | shared progress component |

## Implementation slices

| Slice | Content | May start |
|---|---|---|
| L9.1 | Job-status contract + event plumbing (fake clock) | now, in parallel with L8a |
| L9.2 | Budget hierarchy and bounded settings | after L9.1 |
| L9.3 | Shared progress component; determinate/indeterminate; accessibility | after L9.1 |
| L9.4 | ETA estimator and persisted aggregates | after L8b's quality key |
| L9.5 | Wire every AI feature surface; packaged + live evidence | after L8a/L8b |

## Acceptance and evidence (E11: development machine, packaged build)

- Fake-clock deterministic tests for every state and stage transition, timeout and cancel.
- GUI evidence in real Electron: determinate and indeterminate bars, reduced motion, keyboard,
  screen-reader names, focus contract.
- No-history, cold and warm ETA behavior; ETA persisted across restart; migration of old settings.
- Mutation testing of each new verifier once green.
- Live-model evidence on the development machine with the packaged build, in each L8a mode.
- Planned verifiers (registered only when written): `verify:ai-job-status` (fake clock),
  `verify:ai-progress-gui` (real Electron).

## Risks and open decisions

- Whether 3.21.1 reports load/prompt-evaluation progress at all — decided by L8a.0's probe; without
  it those stages stay indeterminate.
  - **Settled (L9.1):** the runtime reports its load fraction (`onLoadProgress`), which the host
    forwards in steps of at least 5 % for the request that asked. It reports nothing during prompt
    evaluation, so that stage and generation stay indeterminate; the first token marks generation.

## L9 record (2026-09-29)

**What was built.**

- **L9.1** `src/ai/AiJobStatus.ts`: the one job-status contract and its tracker (state, queue position
  and hold reason, stage, elapsed, ETA range with samples, confidence and cold or warm, effective
  profile, budget, cancel, terminal reason). `AiService` reports every job; `aiRuntime` reports the
  model copy (`model-import`, determinate by bytes), the compatibility check and the backend-pack copy.
  Main sends each status to the owning window only (`ai:jobStatus`, `ai:listJobs` under `AI_USE`);
  `ai:cancelModelJob` (`AI_MANAGE`) stops only that window's model copy or check. The host
  (`16de408b`) forwards the runtime's load fraction and the first token, a stage and a number only.
- **L9.2** `src/ai/AiTimeBudgets.ts`: seven bounded budgets whose defaults are the closed evidence values
  (125 s explanation, 185 s failure analysis and each locator attempt, 30 s fragments, 120 s load, 240 s
  probe, 30 min copy). `sanitizeAiSettingsPatch` refuses a value outside its bounds with main's own
  sentence, never clamps; a stored out-of-range value reads as the default. A moved budget makes the
  features under it read Compatible but unqualified (`TIME_BUDGET_CHANGED`). Settings → Local AI →
  Time limits.
- **L9.3** `app/renderer/components/shared/AiJobProgress.tsx`: one accessible progress view on the
  explanation bar, the fragment dialog, failure analysis, the Element Spy, model import and check, and
  the backend-pack copy. `aria-valuenow` only with a real denominator; stage and elapsed time in the
  value text; polite announcements at most every 5 s; the indeterminate sweep stops under reduced
  motion; Hologram tokens only.
- **L9.4** `src/ai/AiEtaHistory.ts`: per latency class (quality key plus hardware class), the last 20
  cold and 20 warm durations of completed jobs, at most 64 keys, versioned, written through
  `replaceFileAtomically` under the runtime data root; keys and integers only. Settings shows what was
  measured here as a measurement, never a qualification.
- **L9.5** every surface wired, and a product defect fixed on the way: a compatibility check that
  stopped at the model header loaded nothing, yet was recorded as a cold probe, so Settings claimed a
  measured speed for an incompatible model. A job is cold now only once the probe starts loading.

**Evidence (all on the final source; packaged on a fresh package of clean `80906caf`).**

| Acceptance | Evidence | Result |
|---|---|---|
| Fake clock, every transition, budgets, history | `verify:ai-job-status` | 142/142; `verify:ai-job-status-mutations` 53/53 killed, 7/7 controls clean |
| Feature deadlines | `verify:ai-deadlines` | 42/42 |
| Host progress | `verify:ai-host` | 279/0, 46/46 mutations |
| GUI in real Electron | `verify:ai-progress-gui` | 41/41; 7/7 GUI mutants caught and restored |
| Settings GUI | `verify:ai-settings-gui` | 140/140 |
| Contracts | `verify:ai-permissions`, `verify:ai-fallback`, `verify:ai-model-compatibility` | 135/0, 51/0, 188/0 |
| Packaged, real model, each L8a mode, restart | `verify:ai-progress-packaged` | 33/0; a host mutant killed 3 checks |
| GPU placements (E11 mechanics, AMD) | `verify:ai-progress-gpu-packaged` | 11/0; NVIDIA BLOCKED |
| Build | `build`, `typecheck:scripts`, `verify:verifier-classification` | PASS (295 scripts) |

Regressions on the same state: `verify:ai-assist-gui` 182/0, `verify:element-spy` 205/0,
`verify:ai-backend-pack-gui` 59/59, `verify:ai-model-pack` 74/0, `verify:ai-gpu-modes` 184/0,
`verify:ai-adapter` 117/0, `verify:ai-locator-attempts` 191/191, `verify:ipc-contract` 10/10,
`verify:source-hygiene` 11/0, `verify:failure-capture-overhead` 18/0 PASS (run 20),
`verify:ai-packaged-app` 32/0, `verify:ai-model-registration` 33/0, `verify:ai-packaged-runtime` 104/0,
`verify:ai-gpu-packaged` 24/0; strict offline validation PASS inside packaging. For the host file the
coverage map names three more: `verify:ai-failure-analysis-budget` 7/0, `verify:ai-locator-upgrade-budget`
8/0 and `verify:ai-inference-profile` 14/0 (its committed L1.8 evidence restored afterwards).

**Not PASS, recorded as they are.**

- NVIDIA placement: **BLOCKED** (no `0x10DE` adapter, E11); carried in `awkit-djnl.15`.
- `verify:ai-authoring` 387/388 and `verify:ai-display-gate-mutations` FAIL at its controls: the same
  pre-existing DX-0 frozen-manifest precondition (`awkit-djnl.14`), unchanged by L9.
- `validate:offline -- -Strict` at HEAD `5cd3a195`: FAIL on the HEAD-equality clause only, by design (the
  manifest records `80906caf`, the commit it was generated from); the release-source run inside
  packaging passed.

**Qualification and budgets.** At the default budgets nothing changes: the 0.8B stays Qualified on its
historical CPU key for its three limited-GO features. An administrator who moves a feature's budget
un-qualifies exactly the features under it until they are re-measured; old evidence is never re-labelled.
Latency is still never claimed by a qualification; Settings shows the measured speed apart from it.

## QC follow-up (`awkit-djnl.17`, 2026-09-29)

A Claude session, not a separate reviewer model, reviewed L9.1 to L9.5 (the planned CodeCraft pass
could not run: its tools fail schema validation in this client). The nine findings are fixed in
`7f5deca1`. Every testable one has a check, and a mutant that undoes it is killed:

- **Model jobs ran concurrently.** Two checks, or a check and a copy, could both pass the busy test
  before either took the slot. The slot is now claimed synchronously, before any await.
- **"No history" was claimed too early.** A GPU mode's first load claimed no history before its
  placement was known. It now claims nothing until the estimate is asked for a known placement.
- **Fallback runs polluted CPU history.** A cold run that fell back from a GPU mode was recorded as a
  CPU measurement, but it also spent the GPU attempt. It is no longer recorded; a warm run still is.
- **The bar showed a stale fraction.** Every load step (retry, fallback, unload) now starts with no
  progress, so the bar never shows the previous attempt's fraction or runs backwards.
- **A requeue kept its pending estimate.** Requeueing now invalidates it.
- **Some history files became unwritable for good.** JSON that is not this version (`{}`, older, no
  version) is now preserved beside itself and a new history starts. Only a newer version is left
  untouched.
- **The trim threshold was misstated.** It is now stated as 10. Below ten, nearest-rank tenths are the
  min and max, so nothing changes in behaviour. The overrun sentence now says "the measured range",
  not "the longest".
- **Screen readers heard elapsed time.** It is no longer in the bar's value text, which a screen reader
  would re-read every second. It is shown only in the visible line.
- **The GPU-Only refusal hid its cause.** The AI panels now show main's own cause sentence, the one
  Settings shows.

**Decisions.** No separate unloading label: saving a mode unloads the model at once, so users rarely see
this stage. The GPU-Only job keeps the stable `GPU_UNAVAILABLE` terminal code, and its cause is shown
from main's own status sentence.

**Evidence.** `build` PASS; `verify:ai-job-status` 148/148; `verify:ai-job-status-mutations` 67/0 (57/57
killed, 7/7 controls clean); `verify:element-spy` 206/0; `verify:ai-settings-gui` 141/141;
`verify:ai-progress-gui` 41/0. **NOT RUN:** `verify:ai-progress-packaged` and
`verify:ai-progress-gpu-packaged`. The current package predates `7f5deca1` (main bundle only; the
host and the signed manifest are unchanged), and the GPU harness now expects the new no-history rule.
Both need a fresh package.
