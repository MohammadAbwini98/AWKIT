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
  /** `loop` (L12.19): a CSS selector matching exactly these rows on the main page, when one could be proven. */
  | { ok: true; rows: string[]; total: number; loop?: string }
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
    const rows = texts.map((text) => redact(text).slice(0, SIMILAR_ROWS_LIMITS.chars));
    // ponytail: only every row on the main page gets a loop; a list longer than the row cap, or inside a frame,
    // gets none (the loop step has no frame context and the selector could not be checked against all rows).
    const loop = wanted.length > 1 && wanted.length === similar.count + 1 && frame === frame.page().mainFrame() ? await commonRowSelector(frame, wanted) : null;
    return { ok: true, rows, total: similar.count + 1, ...(loop ? { loop } : {}) };
  } catch {
    return { ok: false, reason: "provider-error" };
  }
}

/**
 * L12.19 (awkit-djnl.21.19): one CSS selector that matches EXACTLY the given rows, for an element loop over them.
 * The rows must share their tag path below their nearest common ancestor. The selector is anchored on that
 * ancestor or a nearer-the-root one that is uniquely named by `data-testid`, a non-numeric `id` or `aria-label`,
 * followed by the child tag path. It is returned only when `querySelectorAll` yields the very same elements, so a
 * guess never reaches a loop. Never classes (utility and hashed classes are what the Recorder refuses to emit).
 */
export async function commonRowSelector(frame: Frame, wanted: number[]): Promise<string | null> {
  // NOTE: no named inner functions in this evaluate body (esbuild's `__name` helper is undefined in the page).
  return frame.locator("body *").evaluateAll((elements, indices) => {
    const rows = indices.map((i) => elements[i]);
    if (rows.length < 2 || rows.some((row) => !row)) return null;
    let common: Element | null = rows[0].parentElement;
    while (common && !rows.every((row) => common!.contains(row) && row !== common)) common = common.parentElement;
    if (!common) return null;
    const chains = rows.map((row) => {
      const tags: string[] = [];
      for (let node: Element | null = row; node && node !== common; node = node.parentElement) tags.unshift(node.localName);
      return tags.join(" > ");
    });
    if (chains.some((chain) => chain !== chains[0])) return null;
    const doc = rows[0].ownerDocument;
    let below = chains[0];
    for (let anchor: Element | null = common; anchor && anchor !== doc.documentElement; anchor = anchor.parentElement) {
      for (const name of ["data-testid", "id", "aria-label"]) {
        const value = anchor.getAttribute(name);
        if (!value || (name === "id" && /\d/.test(value))) continue;
        const selector = `${anchor.localName}[${name}="${value.replace(/["\\]/g, "\\$&")}"] > ${below}`;
        let matches: Element[];
        try {
          matches = Array.from(doc.querySelectorAll(selector));
        } catch {
          continue;
        }
        if (matches.length === rows.length && rows.every((row) => matches.includes(row))) return selector;
      }
      below = `${anchor.localName} > ${below}`;
    }
    return null;
  }, wanted);
}
