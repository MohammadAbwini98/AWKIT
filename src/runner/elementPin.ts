import { randomBytes } from "node:crypto";
import { selectors, type Locator } from "playwright";

/**
 * Proof-to-action pinning (L11, awkit-djnl.19). A proof names its element by index into a list, and
 * `list.nth(index)` is re-resolved at action time, so an element inserted before that index in between
 * would receive the action. Instead, the SAME evaluate that reads the identity being proven registers that
 * exact node under a fresh nonce, and the step acts through `awkitpin=<nonce>`: a custom selector engine
 * that resolves to that node while it is connected inside the scope, or to nothing. A replaced or detached
 * node is never substituted; the action auto-waits and fails (fail closed).
 *
 * The live DOM is never written. The registry is a closure Map reachable only through a function stored
 * under a per-process secret Symbol, which registers only with that secret (the closed-shadow bridge's
 * pattern). The secret travels in evaluate arguments and the engine's own source, never in a selector,
 * report or log; the selector carries only the nonce.
 */

export const PIN_ENGINE = "awkitpin";

/** Per-process secret. Never persisted. */
const TOKEN = randomBytes(9).toString("hex");

export interface ElementPin {
  token: string;
  nonce: string;
}

export function newElementPin(): ElementPin {
  return { token: TOKEN, nonce: randomBytes(9).toString("hex") };
}

/**
 * Page code, `function (token, nonce, element)`: registers `element` under `nonce`. Call it inside the same
 * evaluate that reads the element's identity, so nothing can change the DOM between the read and the pin.
 * No named inner functions (esbuild `__name` gotcha).
 */
export const PIN_PAGE_SOURCE = `function (token, nonce, element) {
  var key = Symbol.for("awkit-pin-" + token);
  var registry = window[key];
  if (typeof registry !== "function") {
    var pins = new Map();
    registry = function (t, n, node) {
      if (t !== token) return null;
      if (node) { pins.set(n, new WeakRef(node)); return node; }
      var ref = pins.get(n);
      return ref ? ref.deref() || null : null;
    };
    Object.defineProperty(window, key, { value: registry, enumerable: false, configurable: false, writable: false });
  }
  registry(token, nonce, element);
}`;

/**
 * Registered when this module loads, before any browser context exists: a frame builds its injected script
 * once, with the engines registered at that moment, so a later `register` never reaches a frame a step has
 * already used (measured on Playwright 1.61; the pinned locator then resolves to nothing).
 */
const engineReady = selectors
  .register(
    PIN_ENGINE,
    `{
    queryAll(root, nonce) {
      var registry = window[Symbol.for("awkit-pin-${TOKEN}")];
      var element = typeof registry === "function" ? registry("${TOKEN}", nonce) : null;
      // Only inside the scope; a detached node never reaches it, so it resolves to nothing.
      for (var node = element; node; node = node.parentNode || node.host) if (node === root) return [element];
      return [];
    },
    query(root, nonce) { return this.queryAll(root, nonce)[0] || null; }
  }`
  )
  .catch(() => undefined);

/** The locator for a pinned node, within `scope` (the same frame the pinning evaluate ran in). */
export async function pinnedLocator(scope: { locator(selector: string): Locator }, pin: ElementPin): Promise<Locator> {
  await engineReady;
  return scope.locator(`${PIN_ENGINE}=${pin.nonce}`);
}
