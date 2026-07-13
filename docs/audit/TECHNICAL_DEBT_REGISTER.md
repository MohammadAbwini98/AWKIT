# TECHNICAL_DEBT_REGISTER

Effort: Small (<½ day) · Medium (½–2 days) · Large (>2 days) · Architectural.
Priority: P1 (fix before GA) · P2 (soon) · P3 (opportunistic).

> **Update 2026-07-12 — Phases 1 & 2 complete.**
> - **Phase 1 (A1, A2, A3, +S1) RESOLVED** in `src/storage/ProfileStore.ts` (atomic temp+rename writes,
>   in-instance serialized mutations, corrupt-file quarantine, write-new-before-delete id rename).
>   Guarded by `npm run verify:profile-store` (13/13).
> - **Phase 2 (A4) RESOLVED** in `src/runner/BrowserContextFactory.ts` (`closeIsolatedRuntime` try/finally
>   so the browser always closes even if `context.close()` rejects). Guarded by `verify:browser-pool`
>   Part F (20/20).
> - **Phase 3 (A5, A6) RESOLVED.** A5: `windowManager.ts` `setWindowOpenHandler` now only opens
>   `http(s)` externally. A6: the 23 registered-but-unexposed channels are documented in a `BACKEND_ONLY`
>   allowlist and drift-guarded by `npm run verify:ipc-contract` (4/4) — they were kept (unreachable from
>   the renderer), not deleted, pending a UI-wiring decision.
>
> - **Phase 4 (A7) — decision: ACCEPTED / DEFERRED (owner call, 2026-07-12).** The Protected Login
>   Handoff `useSavedSession` (Load Session) and `useTestSession` modes are kept **as-is** — they are
>   already honestly disabled in the UI (tooltip + validation note + capability flag `false`) and are
>   redundant with the working `Reuse Session` / `Auto Secure Login` nodes. Reclassified from a defect to
>   an intentional **roadmap stub**; no code change. Revisit only if Load Session is prioritized as a
>   feature.
>
> See `docs/ai/CURRENT_STATE.md`. Remaining open items: **A8 (bundle size), A9 (docs bloat),
> A10 (test tier)**. A7 is accepted/deferred (not counted as open debt).

| ID | Debt item | Sev | Evidence | Impact | Recommended fix | Effort | Priority |
|----|-----------|-----|----------|--------|-----------------|--------|----------|
| A1 | Profile store writes are **non-atomic** | Medium | `src/storage/ProfileStore.ts:126-128` — `writeProfile` calls `writeFile(pathForId, ...)` directly to the live path. Contrast `app/main/writeQueue.ts` + `uiSettings.ts` which use temp-file + atomic rename. | Power loss / crash / AV lock mid-write truncates or corrupts a saved **flow, workflow, data source, or report**. This is the product's core user asset. | Write to `${path}.tmp` then `rename()` over target; optionally route through a serial queue keyed by path (reuse `createSerialQueue`). | Small | P1 |
| A2 | Corrupt JSON is **silently swallowed to `null`** | Medium | `ProfileStore.ts:118-124` — `readProfileFile` catches parse/IO errors and returns `null`; `list()` (`:34-36`) then drops it. | A corrupted or partially-written flow **disappears from the library** with no error. User perceives silent data loss ("my flow is gone"). Violates the audit rule "must not silently reset corrupted data". | On parse failure: quarantine the file (rename to `*.corrupt`) and surface a user-facing warning / entry, rather than dropping it. | Small–Medium | P1 |
| A3 | `update()` rename path is non-atomic + no ref integrity | Medium | `ProfileStore.ts:53-59` — when `id !== profile.id` it `delete(oldId)` then `writeProfile(new)`. | Crash between delete and write **loses the record entirely**. Workflows referencing the old flow id are left dangling (no cascade/repair). | Write-new-then-delete-old ordering; validate/repair references, or forbid in-place id change. | Small | P2 |
| A4 | Isolated-context teardown lacks try/finally | Low | `src/runner/BrowserContextFactory.ts:93-96` — `close: async () => { await isolatedContext.close(); await browser.close(); }`. The persistent path (`:73-79`) correctly uses try/finally. | If `context.close()` rejects (e.g. already-crashed target), `browser.close()` is skipped → **orphaned Chromium process** accumulates over a long-running host. | Wrap: `try { await context.close(); } finally { await browser.close().catch(()=>{}); }`. | Small | P2 |
| A5 | `setWindowOpenHandler` opens any URL scheme | Low | `app/main/windowManager.ts:22-25` — `shell.openExternal(url)` for any `url`, no scheme check. `auth.ipc.ts:15` correctly guards `^https?://`. | Inconsistent; a `file:`/other-scheme `window.open` from renderer would be launched by the OS. Low risk (renderer is app-owned) but an unnecessary hole. | Reuse the http(s) guard before `openExternal`; deny otherwise. | Small | P3 |
| A6 | Registered-but-unexposed IPC handlers | Low | 117 handlers registered vs preload surface: `instances:create/update/delete/get/export/import/clone`, `runtimeInputs:create/update/delete/get/export/import/clone`, `reports:create/delete/export`, `flow:list` (singular alias) are **not** in `preload.ts`. | Dead surface or half-wired features; increases attack/maintenance surface; confuses future contributors about what's real. | Audit each: either expose+wire in UI or remove the handler. Document intentional backend-only ones. | Small | P3 |
| A7 | "Load Session" sub-feature unimplemented | Low → **Accepted/Deferred** | `src/auth/OAuthHandoffService.ts:23-29` (`savedSession: "Load Session is not implemented yet."`), `app/renderer/components/workflow/flowNodeRegistry.ts:167`, `ProtectedLoginHandoffPanel.tsx:91`. | A node/validation path references a capability that doesn't exist. **Honestly disabled** (tooltip + capability flag), so not a trap. | **Owner decision 2026-07-12: leave as-is, treat as roadmap stub** (redundant with the working Reuse Session / Auto Secure Login nodes). Implement only if prioritized. | Medium | Deferred |
| A8 | Renderer ships a single 1.28 MB JS chunk | Low | `npm run build` output: `assets/renderer-*.js 1,277.79 kB` (> Vite 500 kB warning). No manual chunking. | Larger startup parse/eval; slower first paint on modest machines. | Route-level `React.lazy` code-splitting and/or `build.rollupOptions.output.manualChunks` (split framer-motion / reports charts / canvas). | Medium | P3 |
| A9 | `CURRENT_STATE.md` bloated + duplicated | Info | `docs/ai/CURRENT_STATE.md` 1521 lines; several headers appear twice (e.g. "Workflow Builder UI functionality/organization pass", "UI performance — Phase 2"). | The file is meant to be read every task but is now a chronological changelog; costly to parse, easy to distrust. | Split into a short living "state" head + an archived changelog; de-duplicate; enforce a length cap. | Small | P3 |
| A10 | No fast/headless test tier; verification is bespoke | Info | `package.json` has no `test`/`lint`; 47 `verify:*` scripts, many requiring real Electron/Playwright/GUI (`verify:flow-designer`, `verify:packaged-runtime`, live runner). | Refactor safety relies on slow, environment-heavy scripts; hard to gate in CI; contributor friction. | Add a light `tsx`-based assertion tier for pure logic (many already exist, e.g. write-queue) and wire a CI subset; document which `verify:*` are CI-safe. | Large | P3 |

## Suspected / needs runtime validation (NOT counted as confirmed defects)

- **S1 — Concurrent `update()`/`writeJson` races on the same profile.** `JsonProfileStore` has no
  per-path serialization; two rapid saves interleave (last-write-wins) and, combined with A1, could
  observe a partial file. Low risk in single-user/single-process use; validate under stress before
  treating as a defect. *(root shared with A1 — fix A1's queueing to also close this.)*
- **S2 — Non-Windows report sampling.** `ProcessTreeSampler` is described as Windows CIM-based; the
  product targets Windows, so this is expected, but any cross-platform ambition would need a fallback.
- **S3 — Packaged/offline behavior** was not re-exercised in this pass (`validate:offline`,
  `verify:packaged-runtime` need Windows packaging). Prior `CURRENT_STATE.md` entries claim green; treat
  as unverified-this-session, not as a finding.
