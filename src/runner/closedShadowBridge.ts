import { randomBytes } from "node:crypto";
import { selectors } from "playwright";
import type { LocatorContext } from "@src/profiles/FlowProfile";

/**
 * Closed-shadow bridge (awkit-65g Phase C2). Web components frequently mount their UI inside a CLOSED
 * shadow root, which Playwright's built-in engines cannot pierce. This module lets the RUNNER replay an
 * interaction whose target lives inside such a root, via two cooperating pieces installed at run time:
 *
 *  1. `closedShadowBridgeScript()` — an `addInitScript` that wraps `Element.prototype.attachShadow`
 *     WITHOUT changing the requested `mode`, and retains each closed `ShadowRoot` on its host under a
 *     Symbol keyed by a per-process random `TOKEN`. The retention is reachable ONLY via that Symbol —
 *     no `window` accessor, no IPC/renderer/workflow surface — so app/page script cannot enumerate it
 *     without the secret (see docs/ai/security-reviews/2026-08-04-closed-shadow-c2.md).
 *  2. `registerClosedShadowEngine()` — a Playwright custom selector engine (`awtkitclosedshadow=`) that
 *     walks a recorded host chain (open roots via `host.shadowRoot`, closed roots via the retained
 *     reference) and returns the target element. Playwright then acts on it as an ordinary Locator, so
 *     auto-waiting is preserved and StepExecutor needs no closed-shadow special case.
 *
 * The token is per-process and included in each encoded selector; it is NEVER persisted in a flow, report,
 * or log. The bridge does not force `mode:"open"` and never marks an unresolved target as valid.
 */

export const CLOSED_SHADOW_ENGINE = "awtkitclosedshadow";

/** Per-process secret. Fixed for the process so the bridge and engine agree; never persisted. */
const TOKEN = randomBytes(9).toString("hex");

/** `addInitScript` content that retains closed shadow roots privately. Install BEFORE app scripts run. */
export function closedShadowBridgeScript(): string {
  // `var __name = (t) => t` shims esbuild's keepNames helper (undefined in the page), matching the recorder.
  // The retained roots live in a CLOSURE WeakMap — never on the host, never on an enumerable window
  // property — reachable only through a token-gated resolver keyed by a per-process secret Symbol. Same-
  // realm reflection can find the resolver function, but cannot call it usefully without the secret token.
  return `(() => { var __name = (t) => t;
    var INSTALLED = Symbol.for("awtkit-cs-installed");
    if (window[INSTALLED]) return;
    try { Object.defineProperty(window, INSTALLED, { value: true, enumerable: false, configurable: true }); } catch (e) { window[INSTALLED] = true; }
    var TOKEN = "${TOKEN}";
    var roots = new WeakMap();
    var native = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) {
      var root = native.call(this, init);
      if (init && init.mode === "closed") { try { roots.set(this, root); } catch (e) {} }
      return root;
    };
    try {
      Object.defineProperty(window, Symbol.for("awtkit-cs-fn-" + TOKEN), {
        value: function (token, host) { return token === TOKEN ? roots.get(host) : null; },
        enumerable: false,
        configurable: true
      });
    } catch (e) {}
  })();`;
}

let registered = false;

/** Register the custom selector engine once per process (idempotent). */
export async function registerClosedShadowEngine(): Promise<void> {
  if (registered) return;
  registered = true;
  // No named inner functions (esbuild `__name` gotcha). `this._resolve` shares logic between query/queryAll.
  const engine = `{
    _resolve(root, selector) {
      var spec = JSON.parse(selector);
      var fn = window[Symbol.for("awtkit-cs-fn-" + spec.token)];
      var scope = root;
      for (var i = 0; i < spec.chain.length; i++) {
        var host = scope && scope.querySelector ? scope.querySelector(spec.chain[i]) : null;
        if (!host) return null;
        var sr = host.shadowRoot || (typeof fn === "function" ? fn(spec.token, host) : null);
        if (!sr) return null;
        scope = sr;
      }
      return scope && scope.querySelector ? scope.querySelector(spec.target) : null;
    },
    query(root, selector) { return this._resolve(root, selector); },
    queryAll(root, selector) { var el = this._resolve(root, selector); return el ? [el] : []; }
  }`;
  try {
    await selectors.register(CLOSED_SHADOW_ENGINE, engine);
  } catch {
    /* already registered in this process — the engine is stateless, so this is safe to ignore */
  }
}

/** A locator whose target lives inside a closed shadow root captured through the instrumentation bridge. */
export function isInstrumentedClosedShadow(context: LocatorContext | undefined): boolean {
  return context?.shadow?.boundary === "closed" && context.shadow.instrumented === true;
}

/**
 * Encode an instrumented closed-shadow context as a Playwright selector for the custom engine.
 * `chain` is the ordered outer→inner host CSS selectors; `target` is the CSS selector inside the innermost
 * root. Returns undefined when the context lacks the CSS host chain / target the engine requires.
 */
export function encodeClosedShadowSelector(context: LocatorContext | undefined): string | undefined {
  const shadow = context?.shadow;
  if (!shadow || shadow.boundary !== "closed" || !shadow.instrumented) return undefined;
  const chain = (shadow.hosts ?? []).map((host) => host.value).filter((value): value is string => typeof value === "string" && value.length > 0);
  const target = shadow.target?.value;
  if (chain.length !== (shadow.hosts ?? []).length || !target) return undefined;
  return `${CLOSED_SHADOW_ENGINE}=` + JSON.stringify({ token: TOKEN, chain, target });
}
