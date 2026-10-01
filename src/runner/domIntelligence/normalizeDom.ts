import type { Page } from "playwright";

import { detectRecorderProtectedLogin } from "@src/security/ProtectedLoginDetector";
import type { SemanticRedactor } from "@src/semantic/SemanticRedactor";

import type { DomIntelligenceProvider } from "./DomIntelligenceProvider";
import { captureDomSnapshot, withDeadline } from "./domSnapshot";
import { PAGE_CONTEXT_LIMITS, normalizePageContext, type PageContextMetrics, type PageContextRefusal, type PageContextResult } from "./pageContext";

/**
 * L11.G AI-context normalization, the capture: the page a step failed on, through the whole required path,
 * inside one budget.
 *
 *   eligible page → protected-surface refusal (the Recorder's own detector: sign-in, MFA/OTP, CAPTCHA,
 *                   passkey, device approval, known identity providers; then the serializer's password and
 *                   one-time-code check)
 *   → in-page minimization (`captureDomSnapshot` normalize mode: no scripts, styles, templates, comments,
 *     iframes, SVG or media bodies, no `value`, `on*`, `style` or `srcdoc`, no hidden subtrees, password,
 *     hidden and OTP inputs dropped, query strings dropped, a byte cap)
 *   → the parser-only provider's `normalize_dom`
 *   → `normalizePageContext` (pageContext.ts): closed shape, `SemanticRedactor`, residual rescan, bounds.
 *
 * Nothing here fetches, navigates, owns a browser or acts. Any refusal or provider fault yields no context,
 * and the failure analysis then reads exactly the evidence it read before (the existing path).
 */
export async function capturePageContext(
  page: Page,
  provider: DomIntelligenceProvider | undefined,
  options: { budgetMs?: number; redactor?: Pick<SemanticRedactor, "redactText"> } = {}
): Promise<PageContextResult> {
  const started = performance.now();
  const metrics = (extra: Partial<PageContextMetrics> = {}): PageContextMetrics => ({ totalMs: performance.now() - started, ...extra });
  if (!provider) return { ok: false, reason: "provider-unavailable", metrics: metrics() };
  const budgetMs = Math.max(100, Math.min(options.budgetMs ?? PAGE_CONTEXT_LIMITS.budgetMs, 10_000));
  const deadline = started + budgetMs;

  // A protected sign-in, MFA, CAPTCHA, passkey or device-approval surface never enters the path at all.
  const detection = await withDeadline(detectRecorderProtectedLogin(page).catch(() => undefined), budgetMs, () => undefined);
  if (!detection) return { ok: false, reason: "snapshot-failed", metrics: metrics() };
  if (detection.detected && detection.recommendedAction === "pause") return { ok: false, reason: "protected-surface", metrics: metrics() };

  const snapshotStarted = performance.now();
  const snapshot = await withDeadline(
    captureDomSnapshot(page.mainFrame(), { mode: "normalize", maxBytes: PAGE_CONTEXT_LIMITS.maxHtmlBytes }).catch(() => undefined),
    Math.max(50, deadline - performance.now()),
    () => undefined
  );
  const snapshotMs = performance.now() - snapshotStarted;
  if (!snapshot) return { ok: false, reason: "snapshot-failed", metrics: metrics({ snapshotMs }) };
  if (snapshot.refused) return { ok: false, reason: "protected-surface", metrics: metrics({ snapshotMs }) };

  const remaining = Math.max(50, deadline - performance.now());
  const providerStarted = performance.now();
  const result = await withDeadline(
    provider.normalizeForAi({ html: snapshot.html, timeoutMs: remaining }).catch(() => ({ ok: false as const, code: "CRASHED" as const, message: "" })),
    remaining,
    () => ({ ok: false as const, code: "TIMEOUT" as const, message: "" })
  );
  const base = {
    snapshotMs,
    providerMs: performance.now() - providerStarted,
    htmlBytes: Buffer.byteLength(snapshot.html),
    elements: snapshot.elements,
    hiddenDropped: snapshot.hiddenDropped
  };
  if (!result.ok) {
    const reason: PageContextRefusal =
      result.code === "TIMEOUT"
        ? "provider-timeout"
        : result.code === "DISABLED" || result.code === "UNAVAILABLE"
          ? "provider-unavailable"
          : result.code === "PROTECTED_SURFACE"
            ? "protected-surface"
            : "provider-error";
    return { ok: false, reason, metrics: metrics(base) };
  }
  // The title is the document's own (bounded in the page); the provider never sees one.
  const context = normalizePageContext({ ...result.normalization, title: snapshot.title, truncated: result.normalization.truncated || snapshot.truncated }, options.redactor);
  return { ok: true, context, metrics: metrics(base) };
}
