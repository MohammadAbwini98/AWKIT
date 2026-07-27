# Codex Goal Prompt — Phase E completion: Workflow Builder import-from-file (`awkit-d3c`)

You are working locally only on the AWKIT Electron + Playwright project, on `main`.

Do not create branches or worktrees — AWKIT is single-branch, continuous-commit.
Do not stop after the UI renders; the acceptance below is behavioural.
Do not weaken or delete a verifier check to make a gate pass.
Read `AGENTS.md`, `docs/ai/RULES.md` and `docs/ai/BRANCH_AND_COMMIT_POLICY.md` before editing.

## Main Goal

Add import-from-file to the Workflow Builder canvas, with a shared validator and a
confirm-before-overwrite policy, and close Phase E.

---

## Why this exists

Phase E (*Scenario Builder / Workflow Builder*) is the only roadmap phase still `in-progress`.
Its five deliverables all shipped — Workflows Library page, workflow CRUD, canvas load of saved
flows, order sync, save/load/clone/export. **One gap remains, and it is the whole of what is left
for the phase.**

`app/renderer/pages/WorkflowsLibrary.tsx:163` has `importWorkflow`.
`app/renderer/pages/ScenarioBuilder.tsx` — the Builder canvas itself — has no file input and no
import handler; its only `Import` occurrence is the node-description string `"Imported flow"`. A
workflow JSON can be brought in from the library list, but not from the builder, which is where a
user editing a workflow actually is.

Two latent defects were found while scoping this. **The owner has decided both are in scope:**

1. **`JsonProfileStore.import()` validates nothing** (`src/storage/ProfileStore.ts:89`) — it writes
   whatever object it is handed, so `{"hello":"world"}` is persisted as a "workflow" today. This
   matters more in the Builder than in the library, because import **replaces the live canvas**
   rather than adding a list row.
2. **`store.import()` overwrites by id**, so importing a workflow whose id already exists silently
   destroys the saved one.

## Decisions already made — do not re-litigate

- **Shared validator**, wired into the Builder, the Library **and** the `workflows:import` IPC.
- **Confirm-then-overwrite** on id collision, applied consistently across all three — no silent
  overwrite anywhere.

---

## 1. Shared validator

**New file:** `src/profiles/workflowProfileValidation.ts`

Pure logic — no React, no Electron, no `window`, so a `tsx` verifier and the main process can both
import it.

```ts
export type WorkflowValidationResult =
  | { ok: true; profile: WorkflowProfile }
  | { ok: false; errors: string[] };

export function validateWorkflowProfile(candidate: unknown): WorkflowValidationResult;
```

**Structural checks only.** This is an import gate, not a semantic linter — `validateFlowSet`
(`src/validation/FlowValidator.ts`) already owns execution-time validation and must not be
duplicated here.

- `id`, `name` — non-empty strings; `version` — a number
- `nodes`, `edges`, `runtimeInputs` — arrays
- every node has a string `id` and a `type` in the union; `flowRef` nodes have a string `flowId`
  (reuse the existing `isWorkflowFlowNode` guard, `src/profiles/WorkflowProfile.ts:47`)
- every edge has `id`, `source`, `target`, `type`, and **both endpoints resolve to a node id in the
  same document**
- `execution` is an object with `mode`, numeric `maxConcurrentInstances`, boolean
  `stopOnRequiredFlowFailure`

Errors are user-facing sentences, **collected** — not thrown, not first-failure-only.
`createBlankWorkflowProfile` (`WorkflowProfile.ts:108`) is the reference for the canonical shape.

Wire it into three call sites:

| Site | File | Behaviour on invalid |
|---|---|---|
| Builder import | `app/renderer/pages/ScenarioBuilder.tsx` | error toast listing errors; **canvas untouched** |
| Library import | `app/renderer/pages/WorkflowsLibrary.tsx:163` | replaces the current blanket `catch` message |
| IPC (authoritative) | `app/main/ipc/scenario.ipc.ts:31` | reject before `store.import` |

---

## 2. Id-collision policy

> **⚠️ Trap — do not put the guard inside `store.import()`.** `scenario:save`
> (`scenario.ipc.ts:41-44`) also calls `store.import()`, and overwriting is exactly what it means
> to do. A guard in the store breaks every save. The guard belongs in the **IPC handler**, driven
> by an explicit intent flag.

**Contract change** — `app/main/ipc/scenario.ipc.ts` and `app/main/preload.ts:256` only.
`app/renderer/types/preload.d.ts` re-exports `PlaywrightFlowStudioApi` from the preload
implementation, so the renderer type updates itself — do not edit it.

```ts
workflows.import(profile: WorkflowProfile, options?: { allowOverwrite?: boolean })
```

Handler order, still behind `assertSenderPermission(event, Permission.WORKFLOW_CREATE)`:

1. `validateWorkflowProfile` → reject with the collected errors
2. `store.get(profile.id)` → if it exists **and** `allowOverwrite !== true`, reject with a
   distinguishable error carrying the existing workflow's **name** (code
   `WORKFLOW_IMPORT_ID_CONFLICT`) — the renderer needs that name for the dialog
3. otherwise `store.import(profile)`

This is the **recheck at the persistence boundary**: the renderer pre-check is a UX affordance, the
IPC is the gate, so the decision never rests on stale renderer state. Leave `scenario:save`
passing `allowOverwrite: true`.

**Renderer sequence — identical in Builder and Library:**

1. `JSON.parse(await file.text())` → parse failure = "not valid JSON" toast, stop
2. `validateWorkflowProfile` → invalid = error toast, stop. **Nothing has changed yet.**
3. *(Builder only)* if `isDirty` (`ScenarioBuilder.tsx:922`) → `ConfirmDialog` to discard unsaved
   edits; Cancel stops
4. pre-check `workflows.get(profile.id)` for the existing name, then call `import` **without**
   `allowOverwrite`
5. on `WORKFLOW_IMPORT_ID_CONFLICT` → `ConfirmDialog`:

   > A workflow named "{existingName}" already uses ID "{profile.id}". Importing "{incomingName}"
   > will permanently replace the saved workflow. Continue?

   Actions **Cancel** / **Replace workflow**; `danger` styling; **Cancel is the default/safe
   action**. Cancel or dismiss ⇒ storage, canvas, selection and dirty state all unchanged.
6. on Replace → re-call `import` with `allowOverwrite: true`
7. on success → `setWorkflows(await workflows.list())`, then `loadWorkflowProfile(imported)`, then
   success toast

**No canvas mutation may occur before both validation and every applicable confirmation have
passed.**

---

## 3. Builder UI

`app/renderer/pages/ScenarioBuilder.tsx`

- Add `Upload` to the `lucide-react` import block (lines 18–38) — not currently imported.
- Add the button to **toolbar Group 1 ("File")**, immediately after `#sb-export` (line 1070), so it
  sits with New / Reload / Settings / Export:

```tsx
<button className="toolbar-button" id="sb-import" onClick={() => importInputRef.current?.click()}
        disabled={!canImportWorkflow}
        title={canImportWorkflow ? "Import a workflow JSON file" : "Requires the Create Workflows permission"}
        type="button">
  <Upload size={14} />
  Import
</button>
```

- Hidden `<input type="file" accept=".json,application/json" ref={importInputRef}
  style={{ display: "none" }}>` with the `e.target.value = ""` reset — copy the pattern verbatim
  from `WorkflowsLibrary.tsx:210-220`. **Keep it a hidden input, not a native dialog** — Playwright
  drives it with `setInputFiles()`; a native dialog is untestable.
- Permission: `const canImportWorkflow = can(Permission.WORKFLOW_CREATE)`. The Builder currently
  only derives `WORKFLOW_EDIT` (line 215); `WORKFLOW_CREATE` is what the IPC enforces.
- Reuse `loadWorkflowProfile` (line 836) to apply the document, `setToast` for feedback, and
  `ConfirmDialog` (already imported, line 42) for both dialogs. `createNamedWorkflow` (line 886) is
  the exact precedent to mirror: persist → refresh list → load → toast.

**Styling:** `global.css` tokens only. `.toolbar-button` already exists — no new CSS.

---

## 4. Verification

Extend the existing verifiers. **Do not add a new `verify:*` script** unless unavoidable — a new
one must be registered in `scripts/lib/verifier-classification.ts` or
`npm run verify:verifier-classification` fails.

**`scripts/verify-workflow-sentinels.mts`** (pure logic, already owns `WorkflowProfile`) — validator
cases: a valid profile passes; missing `id` / `name` / `execution` each fail with a named error; an
edge pointing at a non-existent node fails; a `flowRef` without `flowId` fails; **plus a mutation
check that the valid fixture fails once a required field is deleted**, proving the checks
discriminate rather than merely pass.

**`scripts/verify-workflow-builder-gui.mjs`** (real Electron + Playwright, isolated
`%LOCALAPPDATA%`, `setInputFiles` on `#sb-import`'s hidden input) — required matrix:

- confirmed replacement overwrites and loads onto the canvas
- **cancellation** leaves storage, canvas, selection and dirty state unchanged
- **dialog dismissal** (Esc) behaves as cancel
- same id with a **different name** still triggers the dialog and shows both names
- an **invalid file** never touches the canvas
- import over a **dirty canvas** prompts before discarding

Assert canvas state by node/edge **containment** (`.awkit-flow-node[data-id]`), not by label text.

Gate set before finishing:

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
npm run verify:roadmap-dashboard
```

---

## 5. Close out

Per the `AGENTS.md` End-of-task checklist:

1. **Flip Phase E to `complete`** in `src/roadmap/ImplementationRoadmap.ts` and rewrite its
   `implementationNote` to drop the "Remaining:" clause. The roadmap becomes 9 complete / 0 in
   progress / 2 partially completed → **82%**.
2. `bd close awkit-d3c`.
3. **⚠️ Trap:** closing that bead moves the pinned counts in
   `scripts/verify-roadmap-dashboard.mjs`. `"112 issues parse"` stays, but outstanding
   **31 → 30** and closed **81 → 82**. Update both pins or the gate fails.
4. Update `docs/ai/CURRENT_STATE.md` with a new top section — **it must quote the ledger tally
   `61 PASS / 4 NOT RUN / 1 BLOCKED`**, because `tools/roadmap/lib/parse-narrative.mjs` reads only
   the newest section, and a head without the tally silently drops this file from the consistency
   banner while the banner still reads "Sources agree". Append to `docs/ai/TASK_LOG.md`.
5. Update the Workflow Builder bullet list in `docs/ai/FEATURES.md`.
6. Re-run `npm run verify:roadmap-dashboard`; the Overview banner must still read
   **"Sources agree"**.
7. Commit directly to `main` with a truthful scoped message. Read
   `.codex/skills/git-full-cycle/SKILL.md` first.

The roadmap dashboard runs at <http://127.0.0.1:4380> and re-parses its sources on a 1.5s poll, but
**it caches its own `lib/*` code** — restart it only if you change `tools/roadmap/` (you should
not need to here).
