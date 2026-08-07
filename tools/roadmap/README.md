# AWKIT Program Status & Roadmap Dashboard (separate from the app)

A local, read-only web dashboard that answers one question the repository cannot currently answer in
one place: **what is left, in what order, blocked by what, and who is on it.**

It parses the project's real status sources live and renders them using AWKIT's own design system.
Like `tools/license-issuer/`, it is intentionally **not part of the SpecterStudio application** and is
never bundled into the packaged app.

```bash
npm run roadmap
```

Then open <http://127.0.0.1:4380>. Override the port with `ROADMAP_PORT`.

## What it reads

Thirteen sources, listed in `lib/sources.mjs` and shown with their parse state, size, mtime and
record count in the dashboard's own **Sources** view. Eleven are parsed; two are registered but not
parsed, and the page states why. Nothing else in `tools/roadmap` hardcodes a repository path, so a
renamed document fails in one place with a clear message instead of degrading silently in three.

| Source | Used for |
|---|---|
| `.beads/issues.jsonl` | open/closed work, priorities, types, and the **only** declared dependency edges |
| `docs/testing/comprehensive-validation/RECORDER_REPORTS_SETTINGS_TEST_CASES.md` | the 66-case ledger and its authoritative PASS / NOT RUN / BLOCKED tally |
| `…/DEFECTS.md` | 34 defects, severity, lifecycle section, and the `Detected by` join |
| `…/TRACEABILITY_MATRIX.csv` | 101 requirement-coverage rows |
| `src/roadmap/ImplementationRoadmap.ts` | the A–K phase model rendered in-app |
| `docs/ai/TASK_LOG.md` | the only per-agent signal in the repository — past tense, never an assignment |
| `docs/ai/CURRENT_STATE.md`, `HANDOFF.md` | their asserted ledger tally, for the consistency banner |
| `docs/ai/KNOWN_ISSUES.md` | fragile areas and bead references found in prose |
| `scripts/lib/verifier-classification.ts` + `package.json` | per-class verifier counts |
| `app/renderer/styles/global.css` | served verbatim at `/app.css`; never parsed |
| `docs/ai/FEATURES.md` | registered, not parsed — it joins to nothing |

## Three rules it will not break

**1. Declared fact and derived inference never look alike.** The tracker records no per-issue
assignee — all 111 issues carry the same owner — and `TASK_LOG.md` records only what an agent has
already finished. So "who is working on this issue" has no honest source, and the dashboard refuses
to invent one. Instead there are two structurally separate fields:

- **Assignee** — from `assignments.json` only. A solid chip. The empty state is the literal word
  *Unclaimed*. No derived signal can populate it, and the verifier asserts that.
- **Recent activity in this area** — from `TASK_LOG.md`. Muted, dashed, italic, and phrased as an
  observation about an area of the codebase. Never the words "working on".

**2. Where sources disagree, both are shown.** Nothing is reconciled, averaged, or silently
preferred. Today the ledger measures 61/4/1 and two bead descriptions still claim otherwise; the
Overview banner names both with their sources. A disagreement is a finding about the repository, not
a rendering problem.

**3. Rank is a suggestion, not a plan.** The Work Queue orders by declared `blocks` edges with
priority as tiebreak. It knows nothing about effort, value, or any dependency nobody wrote down —
and 24 of the 29 queued issues declare no dependency at all. The view says so, with the count
computed live so it self-corrects as edges are added.

## Keeping it current — update the source, never the page

**This dashboard is derived.** It re-parses the files above on a 1.5s poll, so it updates itself the
moment one of them changes — no restart, no build step, nothing to regenerate. There is no file here
you can edit to make a number say something different, and there should never be: a page that can be
edited independently of the repository is a page that can lie about it, which is precisely the
failure the consistency banner exists to detect.

So on every task — any change made, stage reached, or issue observed or reported — update the source
that owns that fact, and the dashboard follows:

| What happened | Update this |
|---|---|
| Work started / finished / newly discovered | `bd` — create, `--claim`, close; add `blocks` edges for real dependencies |
| A test case changed status | the validation case ledger |
| A defect observed, reported, or fixed | `DEFECTS.md` (keep `Detected by` pointing at a real case id) |
| Requirement coverage changed | `TRACEABILITY_MATRIX.csv` |
| A roadmap phase changed status | `src/roadmap/ImplementationRoadmap.ts` |
| State, behaviour or commands changed | `docs/ai/CURRENT_STATE.md` |
| Work paused, blocked, or handed over | `docs/ai/HANDOFF.md` |
| Any task finished | `docs/ai/TASK_LOG.md` |
| A fragile area or risky assumption | `docs/ai/KNOWN_ISSUES.md` |
| A new `verify:*` / `validate:*` script | `scripts/lib/verifier-classification.ts` |
| You are taking sustained ownership | `assignments.json` (below) |

**Dependencies exist only if you declare them.** The ordering view can use nothing but `blocks` edges
from `bd`. If you know B cannot start until A lands, record it — otherwise no view can know.

Then confirm you introduced no drift:

```bash
npm run verify:roadmap-dashboard
```

and check the Overview banner still reads **"Sources agree"**. Amber means two sources now claim
different things — fix the one that is wrong, at the source.

Two traps that have already bitten: the **newest** `##` section of `CURRENT_STATE.md` and
`HANDOFF.md` must carry the `N PASS / N NOT RUN / N BLOCKED` tally, because the parser scopes to the
newest heading only; and `verify:verifier-classification` stays red until a new verifier is
registered — it went unnoticed for two sessions.

Canonical procedure: `docs/ai/DEVELOPMENT_WORKFLOW.md` § 6.

## Claiming an item

Add an entry to `assignments.json`. `expiresAt` defaults to `claimedAt + 24h`; expired claims render
struck through, because a stale claim is worse than no claim.

```jsonc
{ "claims": [
  { "itemId": "bead:awkit-7lj", "agent": "Claude", "state": "in-progress",
    "claimedAt": "2026-07-27T10:00:00Z", "expiresAt": "2026-07-28T10:00:00Z",
    "note": "IPC authz sweep" }
] }
```

`itemId` uses the dashboard's namespaced ids: `bead:awkit-7lj`, `case:SET-013`,
`defect:AWKIT-SET-006`, `phase:E`. The file participates in the liveness fingerprint, so a claim
appears within ~1.5s without a restart.

## Isolation — structural, not conventional

`tools/` sits outside every allowlist that defines the application. Each row below was verified by
running the gate, not by reading the config:

| Gate | Why this folder cannot affect it | Verified |
|---|---|---|
| `npm run build` | `tsconfig.json` `include` is a 4-entry allowlist (`app`, `src`, 2 configs) with no `exclude` | `tsc --noEmit --listFiles` matches **0** files under `tools/roadmap` |
| `npm run typecheck:scripts` | `tsconfig.scripts.json` covers `scripts/**/*.mts`; the verifier is `.mjs` | passes unchanged |
| electron-builder | `files` is an allowlist: `out/**`, `package.json`, 2 sql.js files | `electron-builder.json` untouched |
| `verify:source-hygiene` | `ROOTS = ["src","app","scripts"]`, and it globs `.ts/.mts/.tsx` only | 7/0, file count unchanged |
| `validate:offline` | checks a fixed list of absolute paths; no repo walk | passes unchanged |
| `verify:verifier-classification` | **expected delta**: `static-source-validation` 7 → 8 | see below |

Two `package.json` script keys are added (`roadmap`, `dev:roadmap`) plus the verifier. `package.json`
does ship inside `app.asar`, but this is metadata only — no dependency and no lockfile change.

**Zero new npm dependencies.** Pure `node:http` and plain ES modules, following `mock-site/server.mjs`.
Node 18.16 is the dev runtime, so no `Object.groupBy`, no RegExp `/v`, no type stripping.

## Security posture

- **Binds `127.0.0.1` only.** This is a requirement, not a style preference: the payload includes
  unfixed security findings, such as `awkit-7lj` *"flows:list/get/export are unauthenticated reads"*.
- **Routes are an explicit allowlist.** No path is ever joined from request input, so traversal is
  impossible by construction rather than by validation.
- **Repository mutation is fixed and bounded.** The one explicit action, **Generate next portable
  EXE**, invokes `scripts/release-portable.ps1` with a fixed patch bump and confirmation. The wrapper
  requires a clean `main`, synchronizes `package.json` and `package-lock.json`, commits only those
  version files, runs the canonical guarded `package-portable.ps1` pipeline, then commits only the
  signed manifest pair. The browser cannot provide a command, bump type, arguments, environment, or
  output path, and the UI states the commit behavior before starting.
- **Build starts are CSRF-resistant.** `POST /api/package-portable` requires a custom action header
  and rejects a foreign `Origin`. A hostile webpage cannot submit that header with a plain form,
  while a cross-origin fetch is preflighted and receives no CORS permission.
- **One build at a time.** A concurrent start receives 409; GET /api/package-portable exposes only
  state/timestamps/exit code, a repo-relative artifact name, and the clean main release base (commit
  plus current/next patch versions), never command output or paths. The dashboard labels this as a
  base rather than an artifact SHA because the fixed wrapper creates the version commit from it before
  packaging.
- **`textContent` everywhere, `innerHTML` never.** Bead descriptions and defect bodies are arbitrary
  Markdown containing backticks and angle brackets. This is a correctness guard as much as a
  security one, and the verifier asserts no asset contains an `innerHTML` assignment.
- **No network at runtime.** The verifier asserts no asset contains a remote URL or `@import url(`.

## UI

`GET /app.css` serves `app/renderer/styles/global.css` **verbatim**. It has zero `url()` and zero
`@import`, so it is fully self-contained. This is why the dashboard is literally the same UI rather
than a lookalike: it gets the real `.work-panel`, `.roadmap-card`, `.nav-item` and `.badge-*` rules,
with permanently zero token drift. A hand-copied palette rots immediately; a generated one rots
silently — and both would violate the "no parallel class systems" rule.

Two overrides are mandatory and live in `dashboard.css`; without them the first render looks broken:

```css
:root { --titlebar-height: 0px; }      /* no Electron frame */
html, body, #root { overflow: auto; }  /* global.css locks scrolling for the desktop shell */
```

Because every colour resolves through a token, light/dark/system theming is free — the toggle simply
sets `data-theme` on `<html>`, the same contract `App.tsx` uses.

The trade-off: borrowing the app's stylesheet couples this page to renderer CSS, so a `.roadmap-card`
rename would silently change the look. `verify:roadmap-dashboard` guards the 19 borrowed class names
so that rename fails loudly instead.

## Liveness

A `stat()` fingerprint poll every 1500 ms (13 syscalls, ~1 ms) pushes an SSE notification; the client
re-fetches `/api/snapshot` with `If-None-Match` and the server answers 304 when unchanged. The client
also re-fetches on every SSE `open`, so a change that lands while the connection is down is picked up
on reconnect.

**Not `fs.watch`:** on Windows, editors and `bd` write via temp-file + rename, which permanently
detaches a file-bound watch handle **with no error event**. A dashboard labelled "live" that has
silently stopped updating is the worst available outcome. This repo also sits under OneDrive, which
can rewrite a file with an unchanged mtime and size — so the two hot sources are content-hashed on
the fingerprint-unchanged path, and `POST /api/refresh` backs the Refresh button.

## Verification

```bash
npm run verify:roadmap-dashboard
```

157 checks: source readability, exact record counts, the four-way ledger reconciliation, CSV field
recovery, a negative case proving a mangled phase literal is rejected, ordering invariants, a
**synthetic 2-cycle** proving the cycle branch fires (there are no real cycles today), byte-identical
determinism, the provenance rules driven against a claims fixture, server routes including 304 and
404, the guarded portable-build lifecycle (with a non-packaging test child), the offline rules, and
the borrowed class names.

### Updating a running dashboard

Public assets are read from disk on each request, but the Node route table is loaded once. After a
dashboard server/API change, restart `npm run roadmap`. If a tab receives new assets from an older
server process, it now disables the packaging action and shows the restart instruction instead of
trying to parse the old server's plain-text `Not found` response as JSON. SSE reconnect rechecks the
capability after the restarted server comes online.
