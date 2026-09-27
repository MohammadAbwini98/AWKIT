# L9 — Adaptive Time Budgets, Progress & ETA UX

Shared rules and the Phase L extension decisions (E1–E12): `ROADMAP.md` › *Phase L extension
(2026-09-27)*. Beads `awkit-djnl.13`. Depends on L8a (`awkit-djnl.11`) and L8b (`awkit-djnl.12`)
for **acceptance**; builds on the closed L4b / L5b / L6 feature surfaces.

**Status (2026-09-27): OPEN — planned, zero implementation.** The job-status contract (L9.1) may be
built in parallel with L8a/L8b, following the L1 → L3 precedent: the `blocks` edges encode
acceptance, not the start of work.

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
