# Security review — Diff-level for closed-shadow bridge implementation

Date: 2026-08-05. Reviewer: Gemini (diff-level, post-implementation).
Scope: Implementation of the closed-shadow capture + runtime bridge (`src/runner/closedShadowBridge.ts`).

## Review Against Boundaries

1. **Registry stays private:**
   - **Check:** The `roots` registry is a `WeakMap` created inside the closure of `closedShadowBridgeScript`. The `TOKEN` is a per-process 9-byte random hex string.
   - **Check:** The resolver function is placed on `window` under `Symbol.for("awtkit-cs-fn-" + TOKEN)`. It uses `enumerable: false`.
   - **Verification:** The closure correctly isolates `roots`. The resolver function requires `token === TOKEN` to return `roots.get(host)`. Without the randomly generated `TOKEN` string, the function returns `null`. This correctly prevents unauthenticated access by hostile page scripts.
   - **Result:** Pass.

2. **Mode is never changed:**
   - **Check:** The monkeypatch does: `var root = native.call(this, init);` followed by a check `if (init && init.mode === "closed")`. It returns the original `root`.
   - **Verification:** The mode is passed unmodified to the native `attachShadow`. The application correctly observes a closed root.
   - **Result:** Pass.

3. **No false-valid:**
   - **Check:** The custom selector engine `_resolve` strictly loops over the `spec.chain`. If any `querySelector` or resolver returns null/undefined, it immediately returns `null`.
   - **Verification:** It never falls back to siblings or returns a partial match.
   - **Result:** Pass.

4. **Protected-surface exclusion is absolute:**
   - **Check:** The bridge is just a Playwright custom selector engine (`awtkitclosedshadow`). It does not intercept clicks or alter the protected login detection logic in `StepExecutor.ts`.
   - **Verification:** The existing `detectProtectedLogin` continues to run and take precedence.
   - **Result:** Pass.

5. **Offline-first preserved:**
   - **Check:** `closedShadowBridge.ts` imports no external network packages and uses built-in `node:crypto` and `playwright`.
   - **Verification:** The bridge strictly evaluates standard DOM APIs in-process.
   - **Result:** Pass.

6. **No secret leakage:**
   - **Check:** `encodeClosedShadowSelector` dynamically injects the in-memory `TOKEN` into the serialized string for the engine. This selector string is never returned back to the recorded step JSON.
   - **Verification:** The `TOKEN` is never saved to `FlowProfile.ts` or written to disk.
   - **Result:** Pass.

## 7. CDP fallback (`LocatorFactory.attemptCdpFallback`) — reviewed + hardened 2026-08-05 (Claude)

The same diff added a Chromium-only fallback for a closed root the pre-navigation bridge could not observe.
The original diff-level review (sections 1–6) did NOT cover it; this section does.

- **Scoped as a genuine fallback, not always-on.** `resolveClosedShadow` first waits
  `CLOSED_SHADOW_FALLBACK_GRACE_MS` (1 s) for the target to attach via the bridge/DOM; only a *still*-unresolvable
  target triggers CDP. So the normal case (a root the bridge instrumented) and merely-not-yet-attached timing
  never spawn a CDP session — matching the design's "documented Chromium-specific fallback, only when the bridge
  genuinely cannot resolve." The walk is capped at `MAX_CDP_CLOSED_ROOTS` (50).
- **Local + offline.** Uses `page.context().newCDPSession(page)` (already used offline by
  `NetworkDiagnosticsObserver`), `DOM.getDocument({pierce:true})`, `DOM.resolveNode`, and
  `Runtime.callFunctionOn`; no network. The session is detached in `finally`.
- **Fail-closed.** If the bridge resolver is absent (no token match) or CDP cannot resolve, nothing is
  registered, the count stays 0, and the step fails with a normal timeout — no false-valid, no wrong element
  (`verify:closed-shadow` [4]/[5] exercise this fail-closed path with the CDP branch active).
- **Protected surfaces.** CDP piercing only *reads* structure to register roots; it performs no action. The
  protected-login detector still runs upstream and pauses the run before a protected surface is automated —
  the CDP fallback does not bypass it.
- **Known limit.** The CDP *success* path (registering a genuinely pre-instrumentation root) is difficult to
  reproduce deterministically, so it is best-effort with limited automated coverage; the fail-closed behaviour
  IS covered. **Result: acceptable, no prohibited design.**

## 8. Resolver write-path (`rootToRegister`) — reviewed + hardened 2026-08-05 (Claude)

The diff widened the token-gated resolver from read-only to also accept a root to REGISTER (so the CDP fallback
can inject a discovered root). Reviewed here because section 1 evaluated only the read-only form.

- **Token-gated + additive-only.** Registration requires the correct per-process `TOKEN`, and is now guarded by
  `if (rootToRegister && !roots.has(host))` — it NEVER overwrites a root the wrap already captured. A token
  holder therefore cannot hijack a legitimately-instrumented host to redirect the engine to a different element
  (integrity preserved); at most it can add a mapping for a host that had none, which only matters if a recorded
  step targets that host. **Result: bounded and token-gated; acceptable.**

## Conclusion

The implementation of `src/runner/closedShadowBridge.ts` adheres to the 6 boundaries defined in the
design-level security review (`2026-08-04-closed-shadow-c2.md`). The added CDP fallback (§7) and resolver
write-path (§8) were reviewed and hardened on 2026-08-05 (gate the fallback behind a grace period, cap the
walk, make registration additive-only), and stay within the same boundaries: mode is never changed, the
registry is token-gated and cannot be overwritten, protected surfaces are not automated, and every failure is
deterministic and fail-closed.
