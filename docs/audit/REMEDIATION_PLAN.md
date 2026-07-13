# REMEDIATION_PLAN

Phases are ordered by risk-to-user-data and release impact. Each phase is independently shippable and
minimal-diff (matching the project's stated conventions). Nothing here changes runtime automation
semantics except where explicitly noted.

---

## Phase 1 — Document-store data integrity (P1, release-gating)

**Objective:** make the flow/workflow/data-source/report store crash-safe and never silently lose data.

- **Issues:** A1 (non-atomic write), A2 (silent corrupt-file drop), A3 (non-atomic id-rename update),
  S1 (concurrent-save race — closed as a side effect).
- **Affected files:** `src/storage/ProfileStore.ts` (primary); optionally reuse
  `app/main/writeQueue.ts` (`createSerialQueue`) as the serialization primitive.
- **Dependencies:** none (writeQueue pattern already exists and is tested).
- **Approach:**
  1. `writeProfile`: write to `${pathForId(id)}.tmp` then `fs.rename()` over the target (atomic on
     Windows for same-volume). Fsync optional.
  2. Route all writes for a given path through a per-store serial queue so overlapping saves cannot
     interleave (closes S1).
  3. `readProfileFile`: on JSON/IO parse failure, **do not** return `null` silently — rename the bad
     file to `${path}.corrupt-<ts>` and record a surfaced warning (return a typed marker the IPC layer
     can report), so the user learns a document could not be loaded.
  4. `update` id-rename: write-new-then-delete-old ordering; if renaming ids, leave a breadcrumb or
     block it if referencing workflows exist.
- **Required tests:** new `tsx` verifier `verify:profile-store` asserting: (a) a simulated mid-write
  (write `.tmp`, no rename) leaves the prior good file intact; (b) a corrupt file is quarantined and
  reported, not dropped from `list()`; (c) 40 concurrent `update()` calls all persist with no partial
  files. Model it on `verify:write-queue`/`verify:settings-persistence`.
- **Acceptance criteria:** kill-mid-write never corrupts the previous version; corrupt files are visible
  to the user, never silently gone; new verifier green; `npm run build` clean.
- **Rollback:** self-contained to `ProfileStore.ts`; revert file. Data-format unchanged (still one JSON
  per profile), so no migration.
- **Effort:** Small–Medium · **Risk:** Low.

---

## Phase 2 — Browser lifecycle hardening (P2)

**Objective:** eliminate orphaned browser processes on teardown error paths.

- **Issues:** A4 (isolated-context close ordering).
- **Affected files:** `src/runner/BrowserContextFactory.ts:93-96`.
- **Approach:** wrap the isolated close in `try { await context.close(); } finally { await
  browser.close().catch(()=>{}); }`, mirroring the persistent path's try/finally.
- **Required tests:** extend `verify:browser-pool` with a case where `context.close()` rejects and
  assert the browser is still closed (no leaked process / pool slot).
- **Acceptance criteria:** forced context-close rejection still closes the browser; pool crash-count
  unaffected; `verify:browser-pool` green.
- **Rollback:** one-function revert.
- **Effort:** Small · **Risk:** Low.

---

## Phase 3 — Electron/IPC surface hygiene (P2/P3)

**Objective:** close the external-open hole and remove/正wire dead IPC.

- **Issues:** A5 (openExternal scheme guard), A6 (unexposed/dead IPC handlers).
- **Affected files:** `app/main/windowManager.ts`; `app/main/ipc/*` (instances, runtimeInputs, reports);
  `app/main/preload.ts` (only if wiring, not pruning).
- **Approach:**
  1. In `setWindowOpenHandler`, reuse the `^https?://` guard from `auth.ipc.ts:15` before
     `shell.openExternal`; `deny` otherwise.
  2. For each registered-but-unexposed handler, decide with the owner: **wire** (add to preload + UI) or
     **prune** (remove the handler). Document any intentional backend-only ones.
- **Required tests:** a small `tsx` assertion that the preload API and registered channel list stay in
  sync (guards future drift); manual check that external links still open.
- **Acceptance criteria:** non-http(s) `window.open` is denied; no registered handler lacks either a UI
  consumer or a documented reason; build clean.
- **Rollback:** per-change revert.
- **Effort:** Small · **Risk:** Low (pruning must confirm no dynamic callers — grep first).

---

## Phase 4 — Scope decisions: Load Session & Runtime Inputs CRUD (P3)

**Objective:** resolve the honestly-incomplete features to a definite state.

- **Issues:** A7 (Load Session), A6 (Runtime Inputs CRUD unwired).
- **Affected files:** `src/auth/OAuthHandoffService.ts`, `flowNodeRegistry.ts`,
  `ProtectedLoginHandoffPanel.tsx`; runtime-input IPC/preload/pages.
- **Approach (owner choice):** either implement `storageState` reuse in a fresh run (Medium) and flip
  the capability, or remove the disabled affordance + validation message so the product has no dangling
  "not implemented" reference. Same decision for Runtime Inputs editing.
- **Required tests:** if implemented, a runner verifier that a saved storageState logs in without manual
  handoff.
- **Acceptance criteria:** no user-visible "not implemented yet" strings unless the affordance is
  explicitly a roadmap stub.
- **Effort:** Medium (implement) / Small (remove) · **Risk:** Low.

---

## Phase 5 — Test tier & observability (P3)

**Objective:** add a fast headless safety net and an IPC-security assertion.

- **Issues:** A10 (bespoke/live-heavy verification), plus the Phase-1/2/3 verifiers.
- **Affected files:** `scripts/verify-*.mts`, `package.json`, `.github/workflows/*`.
- **Approach:** tag which `verify:*` are headless-CI-safe; add a `verify:ci` aggregate that runs the
  `tsx` unit tier (write-queue, sentinels, new profile-store, IPC-contract sync, data-editor, telemetry
  logic) on push; keep live/GUI/packaged checks as manual/nightly.
- **Acceptance criteria:** a green push-time CI gate exists that does not require a display or a live
  browser.
- **Effort:** Large · **Risk:** Low.

---

## Phase 6 — Performance & maintainability (P3)

**Objective:** reduce startup weight and doc drift.

- **Issues:** A8 (1.28 MB single chunk), A9 (CURRENT_STATE bloat/dupes), dead port helpers in
  `connectorStyle.ts`.
- **Approach:** route-level `React.lazy` + `manualChunks` (framer-motion / reports / canvas); split
  `CURRENT_STATE.md` into a short live head + archived changelog and de-duplicate headers; delete the
  confirmed-unused connector port helpers after a final dynamic-reference grep.
- **Acceptance criteria:** largest chunk < ~700 kB; `CURRENT_STATE.md` head < ~150 lines; build clean.
- **Effort:** Medium · **Risk:** Low.

---

## Ordering rationale

1. **Data-loss first** (Phase 1) — it is the only class of finding that can silently destroy the user's
   work and is the sole GA-gating item.
2. **Lifecycle** (Phase 2) — resource leak, easy win.
3–4. **Surface hygiene & scope** — reduce confusion/attack surface.
5–6. **Test tier / perf / docs** — durable quality investments, no user-facing urgency.
