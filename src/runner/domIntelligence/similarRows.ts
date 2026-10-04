import type { Frame, Locator } from "playwright";

import { DOM_INTELLIGENCE_LIMITS, type DomIntelligenceProvider } from "./DomIntelligenceProvider";
import { captureDomSnapshot } from "./domSnapshot";

/**
 * L12.13 (awkit-djnl.21.13): "pick one row, get every row like it". The inspected element and the elements the
 * parser-only provider finds alike to it (`find_similar`), in page order, as bounded visible text the caller
 * redacts. Read-only: nothing is clicked or changed. A protected document is refused by the snapshot, so no
 * sign-in page is ever read here.
 */

export const SIMILAR_ROWS_LIMITS = Object.freeze({ rows: 50, chars: 120 });

export type SimilarRowsResult =
  | { ok: true; rows: string[]; total: number }
  | { ok: false; reason: "provider-unavailable" | "not-on-page" | "protected-surface" | "provider-error" };

export async function extractSimilarRows(
  frame: Frame,
  target: Locator,
  provider: DomIntelligenceProvider,
  redact: (text: string) => string
): Promise<SimilarRowsResult> {
  if (!provider.findSimilar) return { ok: false, reason: "provider-unavailable" };
  try {
    const index = await target.evaluate((element) => Array.prototype.indexOf.call(element.ownerDocument.body ? element.ownerDocument.body.querySelectorAll("*") : [], element) as number);
    if (index < 0) return { ok: false, reason: "not-on-page" };
    const snapshot = await captureDomSnapshot(frame, { mode: "recover" });
    if (snapshot.refused) return { ok: false, reason: "protected-surface" };
    const similar = await provider.findSimilar({ html: snapshot.html, index, maxResults: SIMILAR_ROWS_LIMITS.rows - 1, timeoutMs: DOM_INTELLIGENCE_LIMITS.diagnosisTimeoutMs });
    if (!similar.ok) return { ok: false, reason: similar.code === "DISABLED" || similar.code === "UNAVAILABLE" ? "provider-unavailable" : "provider-error" };
    const wanted = [...new Set([index, ...similar.similar])].sort((a, b) => a - b);
    // Visible text nodes joined by a space, so adjacent inline cells do not run together ("Alice View", not
    // "AliceView"). Hidden text (display:none, visibility:hidden) and script or style bodies are never read.
    const texts = await frame.locator("body *").evaluateAll(
      (elements, arg) =>
        arg.wanted.map((i) => {
          const root = elements[i];
          if (!root) return "";
          const parts: string[] = [];
          const walker = root.ownerDocument.createTreeWalker(root, 4);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const parent = node.parentElement;
            if (!parent || /^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(parent.tagName)) continue;
            if (typeof parent.checkVisibility === "function" && !parent.checkVisibility({ visibilityProperty: true } as CheckVisibilityOptions)) continue;
            const text = (node.nodeValue ?? "").replace(/\s+/g, " ").trim();
            if (text) parts.push(text);
          }
          return parts.join(" ").slice(0, arg.chars);
        }),
      { wanted, chars: SIMILAR_ROWS_LIMITS.chars }
    );
    return { ok: true, rows: texts.map((text) => redact(text).slice(0, SIMILAR_ROWS_LIMITS.chars)), total: similar.count + 1 };
  } catch {
    return { ok: false, reason: "provider-error" };
  }
}
