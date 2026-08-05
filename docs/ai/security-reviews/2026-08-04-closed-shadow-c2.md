# Security review — C2 instrumented closed-shadow resolver (`awkit-3zf`)

Date: 2026-08-04. Reviewer: Claude (design-level, before implementation, as required by the owner directive).
Scope: the design of the closed-shadow capture + runtime bridge for epic `awkit-65g` Phase C2.

## What is being added

Web components frequently mount their UI inside a **closed** shadow root (`attachShadow({mode:"closed"})`),
which Playwright's built-in selector engines cannot pierce. C2 lets AWKIT record and replay an interaction
whose target lives inside such a root, instead of leaving the step review-required.

- **Capture** (recorder): a click whose `composedPath()` passes through a closed shadow host (already tracked
  in the existing `closedShadowHosts` WeakSet) is recorded as an `instrumented-shadow` locator — an ordered
  host chain (CSS selectors, resolvable in each parent root) plus a CSS signature for the target inside the
  innermost root. `composedPath()` pierces closed roots, so no root retention is needed at record time.
- **Runtime** (runner only): a **bridge** `addInitScript` wraps `Element.prototype.attachShadow` WITHOUT
  changing the requested `mode`, and retains each closed `ShadowRoot` in a **closure `WeakMap`** (never on the
  host, never on an enumerable window property). The only path to a retained root is a resolver function
  stored under `Symbol.for("awtkit-cs-fn-" + token)` (non-enumerable) that returns `roots.get(host)` ONLY when
  called with the correct **per-process random token**. A Playwright **custom selector engine**
  (`awtkitclosedshadow=`) walks the host chain — `host.shadowRoot` for open roots, the token-gated resolver
  for closed roots — and returns the target element, which Playwright acts on as a normal Locator (auto-waiting
  preserved). The CDP `DOM.getDocument({pierce:true})` path is an *investigation* for roots created before
  instrumentation; a deterministic unsupported error is returned when the bridge cannot resolve the target.

## Threat model & boundaries (all MUST hold)

1. **Registry stays private.** The retained roots live in a closure `WeakMap`, reachable only by calling the
   token-gated resolver with the per-process secret. The bridge exposes no root on `window` or the host, no
   IPC channel, no renderer or workflow-expression surface. Same-realm reflection (`getOwnPropertySymbols`)
   can *find* the resolver function but cannot call it usefully without the secret token (a wrong token
   returns null). NOTE: absolute in-realm secrecy against a hostile *target page* is not achievable in
   JavaScript and is out of scope — the enforced boundary is "no accessor exposed to workflow / IPC /
   renderer, and no root retrievable without the secret token", which the gate `verify:closed-shadow` proves.
2. **Mode is never changed.** The wrapper calls the native `attachShadow` with the caller's exact `init`
   (including `mode:"closed"`) and only records a reference. The app observes an ordinary closed root. →
   satisfies "do not force `mode:"open"` / do not modify application behaviour."
3. **No false-valid.** If the host chain or target cannot be resolved at replay, the engine returns no match
   and the step fails with a deterministic error — never a silent success or a wrong element.
4. **Protected-surface exclusion is absolute.** This capability MUST NOT be used to automate CAPTCHA / MFA /
   OTP / passkeys / device approval / protected-login surfaces / bot-detection. AWKIT's existing
   protected-login detector (`detectRecorderProtectedLogin`) runs first and, on detection, PAUSES the
   recorder and hands off to the user's real Chrome — that path takes precedence and is unchanged. The
   closed-shadow bridge is a locator resolver for ordinary app widgets, not an anti-bot bypass.
5. **Offline-first preserved.** The bridge is a local `addInitScript`; the optional CDP path uses a local
   `newCDPSession` (already used offline by `NetworkDiagnosticsObserver`). No runtime network.
6. **No secret leakage.** The instrumented-shadow locator stores CSS selectors/signatures only; the per-run
   token is never persisted in a flow, report, or log. Report redaction rules are unchanged.

## Conclusion

No concrete prohibited design is present provided boundaries 1–6 hold. The reversal of the earlier
"never retain a closed root" stance is scoped to the **runner** (replay), gated by a per-run secret, and does
not weaken the protected-login handoff. **Proceeding with implementation** under these boundaries. A
diff-level `/security-review` should be run again once the code lands.
