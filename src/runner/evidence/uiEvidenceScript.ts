/**
 * The page-side half of the L5a collector: an init script that reports transient UI errors and form
 * validation to a per-collector binding.
 *
 * Event-driven only (docs/plans/ai-upgrade-v5/L5-failure-evidence-and-analysis.md): one bounded query
 * for alerts already on the page when it starts, then a MutationObserver that looks only at added nodes
 * and changed candidate attributes, plus the native `invalid` event. No polling, no periodic rescans.
 *
 * Privacy: a field is identified by name, id, label or aria-label, never by its value, and a password
 * field is never reported. A page carrying a password or one-time-code field is a protected-login
 * surface: the script reports nothing from it at all, and it tells the collector so (a `document`
 * message per document, and again the moment such a field appears), because the collector's own
 * network, console and error listeners must exclude that surface too.
 *
 * Built as a plain string, never from a function's source. The main process is bundled, and a bundler
 * can inject helpers (esbuild's `__name`) into a function body that do not exist in the page.
 */

export const UI_EVIDENCE_LIMITS = Object.freeze({
  maxTextChars: 280,
  maxCallsPerDocument: 500,
  maxInitialAlerts: 20,
  maxDescendantCandidates: 20,
  /** Messages held while the binding is still being exposed (the start of a run's first document). */
  maxQueued: 50
});

/** Symbol-keyed per-document handle the script installs; the collector flushes the queue through it. */
function handleKey(bindingName: string): string {
  return `awkit.ui-evidence.${bindingName}`;
}

/** Deliver messages a document queued before the binding existed. Safe to evaluate in any frame. */
export function buildUiEvidenceFlush(bindingName: string): string {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/.test(bindingName)) throw new Error("invalid binding name");
  return `(() => { const handle = document[Symbol.for("${handleKey(bindingName)}")]; if (handle) handle.flush(); })()`;
}

export type UiEvidenceKind = "alert" | "status" | "toast" | "fieldInvalid";

/** The shapes the page may send. Anything else is dropped by the collector: the page is untrusted. */
export type UiEvidencePayload =
  | {
      kind: UiEvidenceKind;
      text: string;
      tone: "error" | "success" | "neutral";
      role: string;
      field?: string;
      validity?: string;
      describedBy?: string;
    }
  /** Once per document, and again if it becomes a protected-login surface later. */
  | { kind: "document"; guarded: boolean };

/** A queued message also carries how long it waited, so its offset stays truthful. */
export type UiEvidenceDelivery = UiEvidencePayload & { ageMs?: number };

export function buildUiEvidenceScript(bindingName: string): string {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/.test(bindingName)) throw new Error("invalid binding name");
  const limits = UI_EVIDENCE_LIMITS;
  // Installed once per DOCUMENT, not per window: a same-origin navigation away from a popup's initial
  // about:blank keeps the Window object, and a window-keyed flag would skip the real document.
  return `(() => {
  const flag = Symbol.for("${handleKey(bindingName)}");
  if (document[flag]) return;
  const MAX = ${limits.maxTextChars};
  let calls = 0;
  const ERROR = /\\b(error|errors|failed|failure|invalid|denied|unable|cannot|can't|not allowed|forbidden|rejected|declined|required|expired|conflict|incorrect|wrong|problem|unavailable|timed out|try again)\\b/i;
  const SUCCESS = /\\b(success|successful|successfully|saved|updated|created|completed|thank you)\\b/i;
  const TOAST = /(toast|snackbar|notification|flash|banner|alert-|notice)/i;
  const CANDIDATES = '[role="alert"],[role="status"],[aria-live]';
  const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim().slice(0, MAX);
  const tone = (text) => (ERROR.test(text) ? "error" : SUCCESS.test(text) ? "success" : "neutral");
  const PROTECTED = 'input[type="password"],input[autocomplete="one-time-code"],input[autocomplete="current-password"],input[autocomplete="new-password"]';
  const guarded = () => Boolean(document.querySelector(PROTECTED));
  // The binding is exposed after this script is registered, so the first document of a run can
  // start before it exists: hold a bounded queue until then, delivered in order with its age.
  const queue = [];
  const deliver = (payload) => {
    const fn = window["${bindingName}"];
    if (typeof fn !== "function") return false;
    try {
      fn(payload);
    } catch (e) {}
    return true;
  };
  const flush = () => {
    while (queue.length > 0) {
      const item = queue[0];
      if (!deliver(Object.assign({}, item.payload, { ageMs: Math.max(0, Math.round(performance.now() - item.at)) }))) return;
      queue.shift();
    }
  };
  // A script registered before the binding's own runs first in each new document, so a queued message
  // is retried once after the document's remaining init scripts; the collector flushes the rest.
  let retrying = false;
  const call = (payload) => {
    flush();
    if (queue.length === 0 && deliver(payload)) return;
    if (queue.length < ${limits.maxQueued}) queue.push({ payload, at: performance.now() });
    if (!retrying) {
      retrying = true;
      setTimeout(() => { retrying = false; flush(); }, 0);
    }
  };
  Object.defineProperty(document, flag, { value: { flush } });
  let guardSent = false;
  // Not rate-limited: at most two per document, and the collector's exclusion depends on them. An
  // unguarded about:blank carries no information (a frame left guarded stays excluded until its next
  // real document announces), so it costs no binding call.
  const announce = (isGuarded) => {
    if (isGuarded) guardSent = true;
    else if (location.href === "about:blank") return;
    call({ kind: "document", guarded: isGuarded });
  };
  const sent = new WeakMap();
  const send = (el, payload) => {
    if (calls >= ${limits.maxCallsPerDocument} || guarded()) return;
    const key = payload.kind + "|" + payload.text + "|" + (payload.validity || "");
    if (sent.get(el) === key) return;
    sent.set(el, key);
    calls += 1;
    call(payload);
  };
  const report = (kind, el) => {
    if (!el || !el.isConnected) return;
    const text = clean(el.innerText || "");
    if (!text) return;
    send(el, { kind, text, tone: tone(text), role: el.getAttribute("role") || "" });
  };
  const classify = (el) => {
    if (!el || el.nodeType !== 1) return;
    const role = el.getAttribute("role");
    const live = el.getAttribute("aria-live");
    if (role === "alert" || live === "assertive") return report("alert", el);
    const marker = (typeof el.className === "string" ? el.className : "") + " " + (el.id || "");
    if (TOAST.test(marker)) return report("toast", el);
    if (role === "status" || live === "polite") return report("status", el);
  };
  const fieldName = (el) => {
    const label = el.labels && el.labels[0] ? el.labels[0].innerText : "";
    return clean(el.getAttribute("name") || el.id || el.getAttribute("aria-label") || label || el.tagName.toLowerCase()).slice(0, 80);
  };
  const validity = (el) => {
    const v = el.validity;
    if (!v) return "ariaInvalid";
    for (const flag of ["valueMissing", "typeMismatch", "patternMismatch", "tooShort", "tooLong", "rangeUnderflow", "rangeOverflow", "stepMismatch", "badInput", "customError"]) {
      if (v[flag]) return flag;
    }
    return "ariaInvalid";
  };
  const describedBy = (el) => {
    const ids = (el.getAttribute("aria-describedby") || "").split(/\\s+/).filter(Boolean).slice(0, 3);
    return clean(ids.map((id) => { const node = document.getElementById(id); return node ? node.innerText : ""; }).join(" "));
  };
  const invalid = (el) => {
    if (!el || el.nodeType !== 1 || el.type === "password") return;
    send(el, { kind: "fieldInvalid", text: clean(el.validationMessage || ""), tone: "error", role: el.getAttribute("role") || "", field: fieldName(el), validity: validity(el), describedBy: describedBy(el) });
  };
  document.addEventListener("invalid", (event) => invalid(event.target), true);
  const regionOf = (node) => {
    const el = node && node.nodeType === 1 ? node : node && node.parentElement;
    return el && el.closest ? el.closest(CANDIDATES) : null;
  };
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") {
        const el = record.target;
        if (record.attributeName === "aria-invalid") {
          if (el.getAttribute("aria-invalid") === "true") invalid(el);
        } else classify(el);
        continue;
      }
      if (record.type === "childList") {
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (!guardSent && (node.matches(PROTECTED) || node.querySelector(PROTECTED))) announce(true);
          classify(node);
          const inner = node.querySelectorAll ? node.querySelectorAll(CANDIDATES) : [];
          for (let i = 0; i < inner.length && i < ${limits.maxDescendantCandidates}; i += 1) classify(inner[i]);
        }
      }
      const region = regionOf(record.target);
      if (region) classify(region);
    }
  });
  const start = () => {
    announce(guarded());
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["aria-invalid", "role", "aria-live", "class", "hidden"] });
    const present = document.querySelectorAll('[role="alert"],[aria-live="assertive"]');
    for (let i = 0; i < present.length && i < ${limits.maxInitialAlerts}; i += 1) classify(present[i]);
  };
  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();`;
}
