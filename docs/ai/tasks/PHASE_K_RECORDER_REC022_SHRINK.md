# Codex Goal Prompt — Phase K: shrink REC-022 to "a real IdP only"

You are working locally only on the AWKIT Electron + Playwright project, on `main`.

Do not create branches or worktrees — AWKIT is single-branch, continuous-commit.
Do not flip Phase K to `complete`. That is not what this task achieves; see below.
Do not weaken or delete a verifier check to make a gate pass.
Never automate, type into, or solve a protected login — that prohibition is the reason this task
exists, not an obstacle to it.
Read `AGENTS.md`, `docs/ai/RULES.md`, `docs/ai/SECURITY.md` and `docs/ai/BRANCH_AND_COMMIT_POLICY.md`
before editing.

## Main Goal

Automate every part of REC-022 the offline mock site can express, so the only irreducibly manual
step left is *a real identity provider*.

**Part 0b also carries five follow-ups from the Phase E review** — two of them prerequisites. Do not
skip them to get to the Recorder work; one is "run the two Phase E gates nobody has run yet", and if
those fail this task is standing on an unverified base.

---

## Why this exists

Phase K (*Recorder Mode*) is `partially-completed`, and its `implementationNote` is **stale in three
ways**: it claims `verify:recorder-gui` is at 103 PASS (it is **152 PASS / 0 FAIL / 0 NOT RUN**),
that REC-024 is NOT RUN (it **passed** 2026-07-27, commit `958f575`), and that `awkit-38k` has two
open cases (it is **closed**). The Recorder ledger block is **28 PASS / 0 NOT RUN / 1 BLOCKED**.

Exactly one thing separates Phase K from complete: **REC-022 — authorized manual Chrome handoff and
session reuse**, `BLOCKED` because it needs an authorized human and an approved test identity.

**This task does not make Phase K `complete`, and must not claim to.** It shrinks REC-022 so the
eventual operator run — or a later decision to redefine completion — is cheap. Three of REC-022's
four expectations are assertable against the mock today:

| REC-022 expectation | Automatable against the mock? |
|---|---|
| AWKIT never types or solves protected input | **Yes** — Part 1 |
| Protected page actions are not recorded | **Yes** — Part 2 |
| Captured session produces Auto Secure Login + Reuse Session nodes | Already covered by `verify:protected-login-recorder` |
| Resumed business steps replay | **Yes, after a mock-site fix** — Part 3 |

Only "real login/MFA/CAPTCHA against a real IdP" is not.

---

## Part 0 — Correct the stale note, and give REC-022 a tracker

In `src/roadmap/ImplementationRoadmap.ts`, rewrite phase K's `implementationNote` with the measured
facts: `verify:recorder-gui` **152 PASS / 0 FAIL / 0 NOT RUN**, REC-024 **PASS** (2026-07-27,
`958f575`), `awkit-38k` **closed**, and REC-022 named as the single remaining blocker with its
operator precondition. **Status stays `partially-completed`.**

File a **P2 bead for REC-022**. It has none today, which is why the one thing blocking Phase K is
invisible in the dashboard queue even though `awkit-38k`'s close note says "tracked separately".
Record the precondition (authorized operator + approved test identity) and that it is `BLOCKED` **by
status, not by a `blocks` edge** — an external human prerequisite is not expressible as a dependency,
the same reasoning already applied to `awkit-7bu`. Link this brief from the bead.

---

## Part 0b — Carried over from the Phase E review (do these first)

These came out of reviewing `ddc261c` (*feat(workflows): complete Phase E import-from-file*) and out
of researching Phase K. They are listed here so one agent owns them; **items 1 and 3 are
prerequisites** — do them before Part 1.

### 1. PREREQUISITE — run the two Phase E gates that were never run

`ddc261c` is committed but **unpushed**, and two of its four required gates have not been executed by
anyone who reported a result: `npm run build` and `npm run verify:workflow-builder` (the second needs
the first). `verify:workflow-sentinels` (**11/11**, including the required mutation check) and
`verify:roadmap-dashboard` (**135/135**) were re-run and pass.

Run both and report the counts. **If either fails, fix Phase E before starting Part 1** — the Phase K
work builds on the same Recorder/runner surfaces and must not sit on an unverified base. Build
artifacts are currently newer than source, so a build did happen; that is not the same as a reported
pass.

### 2. De-duplicate `workflowConflictExistingName` (fail-open risk)

`ddc261c` copied this helper **verbatim** into both `app/renderer/pages/ScenarioBuilder.tsx` and
`app/renderer/pages/WorkflowsLibrary.tsx`:

```ts
function workflowConflictExistingName(message: string, fallback?: string): string {
  return /A workflow named "([^"]*)" already uses ID/.exec(message)?.[1] ?? fallback ?? "the saved workflow";
}
```

Its regex must stay in sync with the message template built in `app/main/ipc/scenario.ipc.ts` — so
**three places now encode one message format**. If the template is reworded, both parsers silently
fall back and the safety dialog reads *A workflow named "the saved workflow" already uses ID "x"* —
the conflict dialog degrades exactly when it matters, with nothing failing.

Move it into `src/profiles/workflowProfileValidation.ts` beside `WORKFLOW_IMPORT_ID_CONFLICT`, as a
**producer/parser pair** (`formatWorkflowConflictMessage()` / `parseWorkflowConflictName()`) so the
IPC builds the message with the same module that parses it and they cannot drift. Import both in the
two renderer pages and in the IPC. Add a check to `verify:workflow-sentinels` that a formatted
message round-trips back to the same name — that is what makes the pairing load-bearing.

### 3. PREREQUISITE — do not commit `.codex/config.toml`

It is untracked and contains a single line: `sandbox_mode = "danger-full-access"`. That is a
machine-local agent setting; committing it would push a full-access sandbox default into every
checkout. `.codex/` is not wholesale ignored (`.codex/skills/git-full-cycle/SKILL.md` is tracked), so
add a **targeted** `.codex/config.toml` entry to `.gitignore` rather than ignoring the directory.

### 4. Give `ddc261c` a real commit body

Its message is a single line for a 14-file, +586 change. `docs/ai/BRANCH_AND_COMMIT_POLICY.md`
requires the body to record what works, what is incomplete, and which gates ran with their counts —
every neighbouring commit does. It is unpushed, so `git commit --amend` rewrites nothing shared. Add
the body, including the gate counts from item 1 and the correct statement that packaging gates were
**not run because no packaging or offline surface changed** — which is the right call, not a gap.

### 5. Low priority — `WORKFLOW_NODE_TYPES` has no compile-time link to its union

`src/profiles/workflowProfileValidation.ts:13` hardcodes `new Set(["start", "end", "flowRef"])`.
It matches `WorkflowNode` today, but nothing ties them together, so adding a node type would make the
validator **silently reject valid workflows** at the import boundary. Derive it from the type (e.g. a
`satisfies` -checked const map keyed by the union) so the compiler fails instead.

---

## Part 1 — Pin the "never types into protected input" invariant

The guarantee exists in code and is **load-bearing but unguarded**.
`RecorderService.recordActionFromPage` (`src/recorder/RecorderService.ts:1114`) opens with
`if (!this.isRecording) return;`, and its own comment states why that line is the guarantee:

> the automation browser may stay open during the "detected" phase, so the guard — not just a closed
> browser — is what guarantees nothing on a protected page is ever recorded.

The automation browser is deliberately left **open** while a detection is showing (~line 753) so a
false positive stays recoverable; it closes only when the user chooses manual handoff (~line 826).
That makes `isRecording` the entire security boundary, and **no test holds it in place**.

Add to `scripts/verify-protected-login-recorder.mts` (already registered — **do not add a new
`verify:*` script**, a new one must be registered in `scripts/lib/verifier-classification.ts`):

- drive `recordActionFromPage` with the service paused → assert the action is **dropped**
- unpause → assert an identical action **is** recorded

Both directions, or the check proves nothing. Also assert the automation browser is still open
during the `detected` phase, so a future refactor cannot "fix" this by closing the browser and
quietly deleting the guard.

---

## Part 2 — Prove protected-page actions never reach the draft

Extend the same verifier end-to-end against `/mock/protected-login`
(`mock-site/public/secure-login/protected-login.html`; testids `password`, `otp`, `complete-login`):
record a business action, navigate to the protected page, let detection fire, attempt input on the
password and OTP fields, then assert the draft contains **exactly** the pre-detection actions.

Assert `=== n`, never `>= n`. Assert the pre-detection count is **non-zero first** — a draft that is
empty for an unrelated reason would otherwise satisfy "no protected actions" trivially.

---

## Part 3 — Make replay provable (mock-site fix first)

**The blocker:** `mock-site/public/secure-login/session-reuse.html` cannot support a truthful reuse
assertion today. Its `setAuth()` only toggles the DOM — no cookie, no storage read on load — so the
page renders "Not authenticated" regardless of any applied storage state, and the only route to
"Authenticated" is clicking `simulate-login`. A test asserting `data-authenticated="true"` after a
Reuse Session step would pass **because the flow clicked a button**, not because a session was
reused. Fail-open by construction.

**Fix the fixture** — use the `mock-site-maintainer` skill and update `mock-site/README.md`. Derive
the state from a real persisted signal (a server-set cookie on a `/mock/secure-login/sign-in` route,
or `localStorage`) read on load, while keeping `simulate-login`/`simulate-logout` for manual use.
Keep the `data-testid="auth-status"` / `data-authenticated` / `dashboard` markers so existing checks
keep working.

**Then the replay test:** build a captured-session fixture carrying that signal, run a recorded flow
containing the `Auto Secure Login` + `Reuse Session` nodes through the runner, and assert the mock
dashboard renders authenticated **with no login interaction in the flow**.

**Negative-control it:** the same flow with the session removed must FAIL. Without that control the
test cannot distinguish real reuse from the page defaulting to authenticated.

`RecorderService.captureSessionAndResume` (line 858) takes `sessionService` by **injection** — the
same seam REC-023 used to reach 50/50 with synthetic services. Reuse it; do not launch real Chrome.
`insertSecureSessionNodes` (~line 903) is idempotent and already covered.

---

## Part 4 — Narrow REC-022 in the ledger

In `docs/testing/comprehensive-validation/RECORDER_REPORTS_SETTINGS_TEST_CASES.md`, REC-022 stays
`BLOCKED`. Rewrite its **Status** prose to state exactly what is now covered automatically and what
still requires the operator, citing the new checks — so that when an authorized human finally runs
it, the manual script is one step rather than six.

**Do not touch the 61 PASS / 4 NOT RUN / 1 BLOCKED tally.** If a tally moves,
`verify:roadmap-dashboard` fails its narrative-consistency check and `docs/ai/CURRENT_STATE.md` plus
`docs/ai/HANDOFF.md` must move with it.

---

## Verification

```bash
npm run build
```
```bash
npm run verify:workflow-builder
```
```bash
npm run verify:workflow-sentinels
```
```bash
npm run verify:protected-login-recorder
```
```bash
npm run verify:recorder-gui
```
```bash
npm run verify:mock-site
```
```bash
npm run verify:roadmap-dashboard
```

The first three close Part 0b: `build` and `verify:workflow-builder` are the Phase E gates nobody has
reported, and `verify:workflow-sentinels` (currently **11/11**) gains the conflict-message round-trip
check from Part 0b item 2.

`verify:recorder-gui` must stay at **152 PASS / 0 FAIL / 0 NOT RUN** — this work should not disturb
it. Report the new `verify:protected-login-recorder` count as a delta from its current total.

**Packaging gates are correctly out of scope** — nothing here touches a packaging or offline surface.
Say so explicitly rather than leaving it unstated.

Once green, **mutation-test the new checks**: break the `isRecording` guard, remove the session from
the replay fixture, and let an action through on the protected page — each must produce a `FAIL`,
then revert. A check that has never been seen to fail is not yet evidence.

---

## Close out

1. Phase K stays **`partially-completed`** with a corrected note. Flipping it would assert an unrun
   check passed.
2. Update `docs/ai/CURRENT_STATE.md` with a new top section — **it must quote the ledger tally
   `61 PASS / 4 NOT RUN / 1 BLOCKED`**, because `tools/roadmap/lib/parse-narrative.mjs` reads only
   the newest section; a head without it silently drops this file from the consistency banner while
   the banner still reads "Sources agree". Append to `docs/ai/TASK_LOG.md`.
3. Update `docs/ai/FEATURES.md` (Recorder bullets) and `mock-site/README.md` (the fixture change).
4. Filing the new REC-022 bead moves the pinned counts in `scripts/verify-roadmap-dashboard.mjs`
   from `112 issues` / `30 outstanding / 82 closed` to **113 / 31 / 82**. Update them or the gate
   fails for a reason that looks unrelated.
5. `npm run verify:roadmap-dashboard`; the Overview banner must still read **"Sources agree"**.
6. Commit to `main` with a truthful body recording which gates ran and their counts. Read
   `.codex/skills/git-full-cycle/SKILL.md` first.
7. **Push is still owed for `ddc261c`** — `main` is currently 1 ahead of `origin/main`. Amend that
   commit's body per Part 0b item 4 *before* pushing, so the Phase E change does not reach the remote
   with a one-line message. `git commit --amend` is safe here only because it is unpushed; once it is
   on `origin/main` it is shared history and must not be rewritten.
8. `.beads/issues.jsonl` and `.beads/interactions.jsonl` are both commit-tracked. If the owner asks
   for it, `bd dolt push` syncs the Dolt store — its output says "Push complete." either way, so
   verify by comparing `git ls-remote origin refs/dolt/data` before and after.
