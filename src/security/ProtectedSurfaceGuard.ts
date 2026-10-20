import { randomUUID } from "node:crypto";
import type { CDPSession, ConsoleMessage, Frame, Page } from "playwright";

import { PROTECTED_LOGIN_STEP_TYPES, type StepType } from "../profiles/FlowProfile";
import { detectRecorderProtectedLogin } from "./ProtectedLoginDetector";

/**
 * Protected-surface refusal for anything that photographs or serializes a page: Visual Intelligence (Phase N, N0) and
 * the runner's B2 failure capture (awkit-4b5y).
 *
 * Capture must never look at a sign-in, CAPTCHA, MFA, OTP, passkey or device-approval surface. Two checks run
 * and EITHER refuses:
 *
 *  1. The shared `detectRecorderProtectedLogin` — the same provider-host, text and DOM signals the Recorder pauses
 *     on, at any confidence (capture is conservative where the Recorder may continue).
 *  2. A strict per-frame scan of every frame in the page. The shared detector treats a frame it cannot read as
 *     "no signal"; here a frame that cannot be scanned within the budget refuses, because absence of a protected
 *     field has not been proven.
 *  3. A CDP pierce pass over each page/out-of-process frame document (awkit-3gtj): page script cannot see into a
 *     CLOSED shadow root, the DevTools protocol can. Its attribute rules mirror the selector list.
 *
 * Callers run this before capturing and again after. Between the two, `watchProtectedWindow` arms a mutation
 * sentinel in every frame, so a field that appears and disappears again inside the window — or (strict mode) any
 * frame navigation or attachment — still refuses. Only booleans leave the page — never field values, text or cookies.
 *
 * It lives outside `src/visual` so the execution tree can use it without reaching the visual module (verify:visual-
 * isolation); `src/visual/protectedGuard.ts` re-exports it unchanged.
 */

export type ProtectedGuardReason =
  | "protected-step"
  | "handed-off"
  | "protected-detected"
  | "protected-field"
  | "frame-unscannable"
  /** A frame navigated, attached or the page closed inside a strict capture window: the window was not proven clean. */
  | "window-changed";

export interface ProtectedGuardVerdict {
  protected: boolean;
  reason?: ProtectedGuardReason;
}

export interface ProtectedCallerContext {
  /** The flow step the capture serves; a protected-login step type always refuses. */
  stepType?: string;
  /** True while the session is handed off to the user's own browser for a protected login. */
  handedOff?: boolean;
}

/** Upper bound for one frame's strict scan. */
export const PROTECTED_FRAME_SCAN_TIMEOUT_MS = 1500;

/** Refusals that need no page at all: the caller says the step is a protected-login one, or the session is handed off. */
export function protectedCallerVerdict(context: ProtectedCallerContext): ProtectedGuardVerdict {
  if (context.handedOff === true) return { protected: true, reason: "handed-off" };
  if (typeof context.stepType === "string" && PROTECTED_LOGIN_STEP_TYPES.has(context.stepType as StepType)) {
    return { protected: true, reason: "protected-step" };
  }
  return { protected: false };
}

/** Protected fields and challenge widgets, as one CSS selector list (passed into the page; `cdpNodeIsProtected` mirrors it). */
const PROTECTED_FIELD_SELECTOR = [
  'input[type="password"]',
  'input[autocomplete="current-password"]',
  'input[autocomplete="new-password"]',
  'input[autocomplete="one-time-code"]',
  'input[autocomplete*="webauthn"]',
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  'iframe[src*="turnstile"]',
  'iframe[src*="challenges.cloudflare.com"]',
  'iframe[src*="arkoselabs"]',
  '[aria-label*="captcha" i]',
  ".g-recaptcha",
  ".h-captcha",
  ".cf-turnstile",
  "[data-sitekey]",
  "[data-hcaptcha-widget-id]",
  '[data-testid*="captcha" i]',
  '[aria-label*="verification" i]',
  '[aria-label*="passkey" i]',
  '[aria-label*="security key" i]',
  "[data-webauthn]"
].join(", ");

/** Every attribute the selector list depends on; the sentinel watches changes to exactly these. */
const PROTECTED_FIELD_ATTRIBUTES = ["type", "autocomplete", "src", "aria-label", "class", "data-sitekey", "data-hcaptcha-widget-id", "data-testid", "data-webauthn"];

/**
 * Evaluated in each frame. Keep this body (and every other page-side body in this file) free of named function
 * expressions — esbuild/tsx inject a `__name(...)` helper for those, which does not exist in the page and would make
 * every scan throw (and so refuse every capture). Walks the document, every open shadow root and every same-origin
 * child document.
 */
const scanFrameForProtectedFields = (selector: string): boolean => {
  const roots: Array<Document | ShadowRoot> = [document];
  for (let r = 0; r < roots.length; r++) {
    if (roots[r].querySelector(selector)) return true;
    const all = roots[r].querySelectorAll("*");
    for (let i = 0; i < all.length; i++) {
      const shadow = all[i].shadowRoot;
      if (shadow) roots.push(shadow);
      if (all[i].tagName === "IFRAME" || all[i].tagName === "FRAME") {
        let inner: Document | null = null;
        try {
          inner = (all[i] as HTMLIFrameElement).contentDocument;
        } catch {
          inner = null; // Cross-origin: scanned as its own frame.
        }
        if (inner) roots.push(inner);
      }
    }
  }
  return false;
};

const CHALLENGE_FRAME_URL = /recaptcha|hcaptcha|turnstile|challenges\.cloudflare\.com|arkoselabs/i;

function scanOneFrame(frame: Frame, timeoutMs: number): Promise<"clear" | "protected" | "unscannable"> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("unscannable"), timeoutMs);
    frame.evaluate(scanFrameForProtectedFields, PROTECTED_FIELD_SELECTOR).then(
      (found) => {
        clearTimeout(timer);
        resolve(found === true ? "protected" : found === false ? "clear" : "unscannable");
      },
      () => {
        clearTimeout(timer);
        resolve("unscannable");
      }
    );
  });
}

/** Run both page checks. Never throws: any failure to prove the page clean is a refusal. */
export async function checkProtectedSurface(page: Page, timeoutMs = PROTECTED_FRAME_SCAN_TIMEOUT_MS): Promise<ProtectedGuardVerdict> {
  let frames: Frame[];
  try {
    frames = page.frames();
  } catch {
    return { protected: true, reason: "frame-unscannable" };
  }
  if (frames.length === 0) return { protected: true, reason: "frame-unscannable" };
  try {
    if (frames.some((frame) => CHALLENGE_FRAME_URL.test(frame.url()))) return { protected: true, reason: "protected-field" };
  } catch {
    return { protected: true, reason: "frame-unscannable" };
  }

  const scans = await Promise.all([...frames.map((frame) => scanOneFrame(frame, timeoutMs)), pierceScan(page, frames, timeoutMs)]);
  if (scans.includes("protected")) return { protected: true, reason: "protected-field" };
  if (scans.includes("unscannable")) return { protected: true, reason: "frame-unscannable" };

  try {
    const detection = await detectRecorderProtectedLogin(page);
    if (detection.detected) return { protected: true, reason: "protected-detected" };
  } catch {
    return { protected: true, reason: "frame-unscannable" };
  }
  return { protected: false };
}

/** The slice of a CDP `DOM.Node` the pierce pass reads. */
interface CdpNode {
  nodeType?: number;
  nodeName?: string;
  attributes?: string[];
  children?: CdpNode[];
  shadowRoots?: CdpNode[];
  shadowRootType?: string;
  contentDocument?: CdpNode;
}

/** `PROTECTED_FIELD_SELECTOR` as attribute rules over a CDP node (case-insensitive and token-wise: never looser). */
function cdpNodeIsProtected(node: CdpNode): boolean {
  if (node.nodeType !== 1 || !node.attributes) return false;
  const attrs = new Map<string, string>();
  for (let i = 0; i + 1 < node.attributes.length; i += 2) attrs.set(node.attributes[i].toLowerCase(), node.attributes[i + 1]);
  const value = (name: string): string => (attrs.get(name) ?? "").toLowerCase();
  const name = (node.nodeName ?? "").toUpperCase();
  if (name === "INPUT") {
    if (value("type").trim() === "password") return true;
    const tokens = value("autocomplete").split(/\s+/);
    if (tokens.some((token) => token === "current-password" || token === "new-password" || token === "one-time-code" || token.includes("webauthn"))) return true;
  }
  if (name === "IFRAME" && CHALLENGE_FRAME_URL.test(attrs.get("src") ?? "")) return true;
  if (/captcha|verification|passkey|security key/.test(value("aria-label"))) return true;
  if (value("data-testid").includes("captcha")) return true;
  if (value("class").split(/\s+/).some((token) => token === "g-recaptcha" || token === "h-captcha" || token === "cf-turnstile")) return true;
  return attrs.has("data-sitekey") || attrs.has("data-hcaptcha-widget-id") || attrs.has("data-webauthn");
}

/** Walk a pierced CDP document — light DOM, open AND closed shadow roots, in-process child documents. */
function cdpTreeIsProtected(root: CdpNode): boolean {
  const stack: CdpNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as CdpNode;
    if (cdpNodeIsProtected(node)) return true;
    for (const child of node.children ?? []) stack.push(child);
    for (const shadow of node.shadowRoots ?? []) if (shadow.shadowRootType !== "user-agent") stack.push(shadow);
    if (node.contentDocument) stack.push(node.contentDocument);
  }
  return false;
}

async function pierceOne(session: CDPSession): Promise<boolean> {
  try {
    const { root } = (await session.send("DOM.getDocument", { depth: -1, pierce: true })) as { root: CdpNode };
    return cdpTreeIsProtected(root);
  } finally {
    await session.detach().catch(() => undefined);
  }
}

/**
 * awkit-3gtj: page script cannot read a closed shadow root, so the per-frame scan cannot see a field inside one. The
 * DevTools protocol can: pierce the page's document (in-process child frames included) and every out-of-process frame
 * (a frame that is part of its parent's session refuses a session of its own and is already covered). Chromium only —
 * a page without a CDP session cannot be proven clean and is unscannable.
 */
function pierceScan(page: Page, frames: Frame[], timeoutMs: number): Promise<"clear" | "protected" | "unscannable"> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("unscannable"), timeoutMs);
    const work = async (): Promise<"clear" | "protected" | "unscannable"> => {
      const context = page.context();
      if (await pierceOne(await context.newCDPSession(page))) return "protected";
      const outOfProcess = await Promise.all(
        frames
          .filter((frame) => frame !== page.mainFrame())
          .map((frame) =>
            context.newCDPSession(frame).then(
              (session) => pierceOne(session),
              (error: unknown) => {
                // In-process frame: already pierced through its parent's document. Any other failure is unscannable.
                if (error instanceof Error && IN_PROCESS_FRAME_SESSION.test(error.message)) return false;
                throw error;
              }
            )
          )
      );
      return outOfProcess.includes(true) ? "protected" : "clear";
    };
    work().then(
      (verdict) => {
        clearTimeout(timer);
        resolve(verdict);
      },
      () => {
        clearTimeout(timer);
        resolve("unscannable");
      }
    );
  });
}

/** Playwright's refusal for a frame that shares its parent's session — the only benign `newCDPSession` failure. */
const IN_PROCESS_FRAME_SESSION = /does not have a separate CDP session/i;

/** Property under which each frame keeps its one shared `attachShadow` hook (per process, not guessable by a page). */
const SENTINEL_HUB_KEY = `awkit-protected-hub-${randomUUID()}`;

/**
 * Page-side sentinel (see the `__name` note above). Arms one MutationObserver per frame document that latches `seen`
 * the moment a protected field is added or an attribute turns an element into one. It observes every open shadow root
 * at any depth (at arm time and inside each added subtree), and — through one shared `attachShadow` hook per document
 * — every root attached while armed, open or closed. The latch is what callers read; the console signal is only an
 * early warning a page can silence. Returns "bound" when armed (now or earlier under this key) with the CDP binding as
 * its signal, "console" when armed with only the console fallback.
 */
const armFrameSentinel = (args: { key: string; hub: string; selector: string; attributes: string[]; binding?: string }): "bound" | "console" => {
  const host = window as unknown as Record<string, unknown>;
  const existing = host[args.key] as { bound?: boolean } | undefined;
  if (existing) return existing.bound === true ? "bound" : "console";
  // awkit-3gtj re-review N1: the CDP binding (random name, captured now) is a channel the page cannot silence;
  // console.debug is only the fallback where no binding exists.
  const binding = args.binding ? (host[args.binding] as ((payload: string) => void) | undefined) : undefined;
  const signal = typeof binding === "function" ? binding : console.debug.bind(console);
  const options: MutationObserverInit = { subtree: true, childList: true, attributes: true, attributeFilter: args.attributes };
  const state = { seen: false, disarmed: false, bound: typeof binding === "function", options, observer: undefined as unknown as MutationObserver };
  state.observer = new MutationObserver((records) => {
    if (state.seen) return;
    for (let i = 0; i < records.length && !state.seen; i++) {
      const record = records[i];
      if (record.type === "attributes") {
        if (record.target.nodeType === 1 && (record.target as Element).matches(args.selector)) state.seen = true;
        continue;
      }
      for (let j = 0; j < record.addedNodes.length && !state.seen; j++) {
        const added = record.addedNodes[j];
        if (added.nodeType !== 1) continue;
        if ((added as Element).matches(args.selector)) {
          state.seen = true;
          break;
        }
        const roots: Array<Element | ShadowRoot> = [added as Element];
        for (let r = 0; r < roots.length && !state.seen; r++) {
          if (roots[r].querySelector(args.selector)) {
            state.seen = true;
            break;
          }
          const within = roots[r].querySelectorAll("*");
          for (let k = 0; k < within.length; k++) {
            const shadow = within[k].shadowRoot;
            if (!shadow) continue;
            roots.push(shadow);
            state.observer.observe(shadow, options);
          }
        }
      }
    }
    if (state.seen) signal(args.key);
  });
  state.observer.observe(document, options);
  const roots: Array<Document | ShadowRoot> = [document];
  for (let r = 0; r < roots.length; r++) {
    const within = roots[r].querySelectorAll("*");
    for (let i = 0; i < within.length; i++) {
      const shadow = within[i].shadowRoot;
      if (!shadow) continue;
      roots.push(shadow);
      state.observer.observe(shadow, options);
    }
  }
  type Hub = { states: Array<typeof state>; original: Element["attachShadow"] };
  let hub = host[args.hub] as Hub | undefined;
  if (!hub) {
    const created: Hub = { states: [], original: Element.prototype.attachShadow };
    Object.defineProperty(host, args.hub, { value: created, configurable: true, enumerable: false });
    Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit): ShadowRoot {
      const root = created.original.call(this, init);
      for (let i = 0; i < created.states.length; i++) {
        if (!created.states[i].disarmed) created.states[i].observer.observe(root, created.states[i].options);
      }
      return root;
    };
    hub = created;
  }
  hub.states.push(state);
  Object.defineProperty(host, args.key, { value: state, configurable: true, enumerable: false });
  return state.bound ? "bound" : "console";
};

/**
 * Page-side: read and remove the sentinel. "missing" when this document was never armed (or replaced by a navigation);
 * "unsettled" when mutation records were still undelivered at the read (they cannot be classified any more).
 */
const readFrameSentinel = (args: { key: string; hub: string }): "seen" | "clear" | "missing" | "unsettled" => {
  const host = window as unknown as Record<string, unknown>;
  const state = host[args.key] as { seen: boolean; disarmed: boolean; observer: MutationObserver } | undefined;
  if (!state) return "missing";
  const pending = state.observer.takeRecords().length;
  state.disarmed = true;
  state.observer.disconnect();
  delete host[args.key];
  const hub = host[args.hub] as { states: unknown[] } | undefined;
  if (hub) {
    const at = hub.states.indexOf(state);
    if (at >= 0) hub.states.splice(at, 1);
  }
  return state.seen ? "seen" : pending > 0 ? "unsettled" : "clear";
};

export interface ProtectedWindowWatch {
  /** Arm frames that are not armed yet — a navigated frame lost its old document's sentinel. */
  rearm(): Promise<void>;
  /** Stop watching and remove every sentinel. Never throws. */
  finish(): Promise<ProtectedGuardVerdict>;
}

export interface ProtectedWindowOptions {
  /**
   * Strict (a capture window: B2, a screenshot): any frame navigation, attachment or detachment, the page closing, or
   * a frame that cannot be armed or read refuses — the window was not proven clean. Not strict (a trace session, whose
   * own scans cover navigations): only a protected field seen by a sentinel refuses. A sentinel's document can be gone
   * before its latch is read (it navigated or detached), so non-strict sentinels signal through a CDP binding the page
   * cannot silence, and a page whose binding cannot be installed refuses.
   */
  strict: boolean;
  /** Called once, as soon as a sentinel signals a protected field (before `finish`). */
  onProtected?: () => void;
  timeoutMs?: number;
}

function boundedEvaluate<T>(work: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

/**
 * awkit-3gtj: watch `page` between a capture's two guard checks. A protected field that is added and removed again
 * inside the window is invisible to both checks; the sentinel latches it. Arm BEFORE the first check and `finish`
 * after the second. Never throws: a page that cannot be watched is unwatchable (refuses in strict mode).
 */
export async function watchProtectedWindow(page: Page, options: ProtectedWindowOptions): Promise<ProtectedWindowWatch> {
  const key = `awkit-protected-${randomUUID()}`;
  const timeoutMs = options.timeoutMs ?? PROTECTED_FRAME_SCAN_TIMEOUT_MS;
  let seen = false;
  let changed = false;
  let unwatchable = false;
  let finished = false;
  let bindingFailed = false;
  const markSeen = (): void => {
    if (seen) return;
    seen = true;
    options.onProtected?.();
  };
  const onConsole = (message: ConsoleMessage): void => {
    if (seen) return;
    try {
      if (message.text() !== key) return;
    } catch {
      return;
    }
    markSeen();
  };
  // awkit-3gtj re-review N1: one CDP session per page and per out-of-process frame, each carrying a binding under a
  // random name. In-process child frames share their parent's session, whose binding reaches their contexts too.
  const bindingName = options.strict ? undefined : `awkitProtected_${randomUUID().replace(/-/g, "")}`;
  const sessions = new Map<Frame, CDPSession>();
  // Third re-review L1: at most one bind in flight per frame. A frameattached rearm and a scan rearm racing for the same
  // new frame share it, so no second session is opened and orphaned. A bind that ends without a session (an in-process
  // frame, a failure) is forgotten so a later rearm can try again.
  const binds = new Map<Frame, Promise<void>>();
  const bindFrame = (frame: Frame): Promise<void> => {
    if (!bindingName || sessions.has(frame) || finished) return Promise.resolve();
    const pending = binds.get(frame);
    if (pending) return pending;
    const work = bindFrameOnce(frame).finally(() => {
      if (!sessions.has(frame)) binds.delete(frame);
    });
    binds.set(frame, work);
    return work;
  };
  const bindFrameOnce = async (frame: Frame): Promise<void> => {
    if (!bindingName) return;
    const isMain = frame === page.mainFrame();
    let session: CDPSession;
    try {
      session = await page.context().newCDPSession(isMain ? page : frame);
    } catch (error) {
      if (!isMain && error instanceof Error && IN_PROCESS_FRAME_SESSION.test(error.message)) return;
      if (isMain) bindingFailed = true;
      return;
    }
    // Second re-review M2: the watch may have finished while the session was opening; never keep it then.
    if (finished) {
      await session.detach().catch(() => undefined);
      return;
    }
    sessions.set(frame, session);
    session.on("Runtime.bindingCalled", (event: { name?: string; payload?: string }) => {
      if (event.name === bindingName && event.payload === key) markSeen();
    });
    try {
      await session.send("Runtime.enable");
      await session.send("Runtime.addBinding", { name: bindingName });
    } catch {
      if (isMain) bindingFailed = true;
    }
  };
  const onChange = (): void => {
    changed = true;
  };
  const detach: Array<() => void> = [];
  try {
    page.on("console", onConsole);
    detach.push(() => page.off("console", onConsole));
    if (options.strict) {
      // A detached frame takes its sentinel's latch with it, so its removal is a change too.
      for (const event of ["framenavigated", "frameattached", "framedetached", "close"] as const) {
        page.on(event as "framenavigated", onChange);
        detach.push(() => page.off(event as "framenavigated", onChange));
      }
    }
  } catch {
    unwatchable = true;
  }
  const arm = async (): Promise<void> => {
    let frames: Frame[];
    try {
      frames = page.frames();
    } catch {
      unwatchable = true;
      return;
    }
    if (bindingName) {
      await Promise.all(frames.map((frame) => boundedEvaluate(bindFrame(frame), timeoutMs, undefined)));
      // Fail closed: without its binding a sentinel whose document goes away takes its latch with it.
      if (bindingFailed) markSeen();
    }
    // Second re-review M2: a rearm still in flight when the watch finished must not arm sentinels nothing will read.
    if (finished) return;
    const args = { key, hub: SENTINEL_HUB_KEY, selector: PROTECTED_FIELD_SELECTOR, attributes: PROTECTED_FIELD_ATTRIBUTES, binding: bindingName };
    const readArgs = { key, hub: SENTINEL_HUB_KEY };
    const armed = await Promise.all(
      frames.map((frame) => {
        const raw = frame.evaluate(armFrameSentinel, args);
        if (bindingName) {
          // Third re-review L2: an evaluate that overran its budget still arms later. Judge it when it lands: a console-
          // only sentinel fails closed, and one that lands after the watch finished is disarmed at once.
          raw.then(
            (mode) => {
              if (finished) void frame.evaluate(readFrameSentinel, readArgs).catch(() => undefined);
              else if (mode === "console") markSeen();
            },
            () => undefined
          );
        }
        return boundedEvaluate<string | false>(raw, timeoutMs, false);
      })
    );
    if (finished) {
      await Promise.all(frames.map((frame) => boundedEvaluate(frame.evaluate(readFrameSentinel, readArgs), timeoutMs, "unreadable")));
      return;
    }
    if (armed.some((mode) => mode !== "bound" && mode !== "console")) unwatchable = true;
    // Second re-review M1: in a trace session a sentinel armed without its binding (the bind timed out or failed for that
    // frame) has only a signal the page can silence, so it fails closed exactly as a missing main binding does.
    if (bindingName && armed.includes("console")) markSeen();
  };
  await arm();
  return {
    rearm: async () => {
      if (!finished) await arm();
    },
    finish: async () => {
      finished = true;
      // Read the latches first and only then stop listening, so a signal still in flight is not dropped.
      let reads: string[] = [];
      try {
        const readArgs = { key, hub: SENTINEL_HUB_KEY };
        reads = await Promise.all(page.frames().map((frame) => boundedEvaluate<string>(frame.evaluate(readFrameSentinel, readArgs), timeoutMs, "unreadable")));
      } catch {
        unwatchable = true;
      }
      for (const off of detach.splice(0)) {
        try {
          off();
        } catch {
          // A closed page has no listeners left to remove.
        }
      }
      // Remove the bindings and close their sessions; best-effort and bounded.
      const opened = [...sessions.values()];
      sessions.clear();
      await Promise.all(
        opened.map((session) =>
          boundedEvaluate(
            session
              .send("Runtime.removeBinding", { name: bindingName as string })
              .catch(() => undefined)
              .then(() => session.detach()),
            timeoutMs,
            undefined
          )
        )
      );
      if (seen || reads.includes("seen")) return { protected: true, reason: "protected-field" };
      if (options.strict) {
        if (changed) return { protected: true, reason: "window-changed" };
        if (unwatchable || reads.length === 0 || reads.some((read) => read !== "clear")) return { protected: true, reason: "frame-unscannable" };
      }
      return { protected: false };
    }
  };
}
