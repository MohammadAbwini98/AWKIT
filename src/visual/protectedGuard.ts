import type { Frame, Page } from "playwright";

import { PROTECTED_LOGIN_STEP_TYPES, type StepType } from "../profiles/FlowProfile";
import { detectRecorderProtectedLogin } from "../security/ProtectedLoginDetector";

/**
 * Protected-surface refusal for Visual Intelligence (Phase N, N0).
 *
 * Visual capture must never look at a sign-in, CAPTCHA, MFA, OTP, passkey or device-approval surface. Two checks run
 * and EITHER refuses:
 *
 *  1. The shared `detectRecorderProtectedLogin` — the same provider-host, text and DOM signals the Recorder pauses
 *     on, at any confidence (capture is conservative where the Recorder may continue).
 *  2. A strict per-frame scan of every frame in the page. The shared detector treats a frame it cannot read as
 *     "no signal"; here a frame that cannot be scanned within the budget refuses, because absence of a protected
 *     field has not been proven.
 *
 * Callers run this before capturing and again after, so a protected field that appears during the screenshot still
 * discards it. Only booleans leave the page — never field values, text or cookies.
 */

export type ProtectedGuardReason =
  | "protected-step"
  | "handed-off"
  | "protected-detected"
  | "protected-field"
  | "frame-unscannable";

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

/**
 * Evaluated in each frame. Keep this body free of named function expressions — esbuild/tsx inject a `__name(...)`
 * helper for those, which does not exist in the page and would make every scan throw (and so refuse every capture).
 * Walks the document, every open shadow root and every same-origin child document.
 */
const scanFrameForProtectedFields = (): boolean => {
  const selector = [
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
    frame.evaluate(scanFrameForProtectedFields).then(
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

  const scans = await Promise.all(frames.map((frame) => scanOneFrame(frame, timeoutMs)));
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
