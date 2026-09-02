import { createHash } from "node:crypto";
import type { LocatorElementFingerprint } from "@src/profiles/FlowProfile";

/**
 * Shared element-identity fingerprint used by BOTH the runner (runtime resolution / local recovery)
 * and the Recorder's guarded-positional capture. Keeping a single implementation is the correctness
 * lynchpin for {@link LocatorGuard}: capture-time and runtime fingerprints must be computed by the
 * exact same function, or a guarded sensitive step could false-abort with SENSITIVE_TARGET_IDENTITY_CHANGED.
 *
 * `createPageFingerprint` is browser-evaluated (Playwright serializes its body) and MUST stay
 * self-contained — no external references. `hashFingerprint`/`similarity` run Node-side.
 */

/** Browser-evaluated and intentionally self-contained: Playwright serializes this function body. */
export function createPageFingerprint(element: Element): LocatorElementFingerprint {
  const tag = element.tagName.toLocaleLowerCase();
  const type = (element.getAttribute("type") || "").replace(/\s+/g, " ").trim().toLocaleLowerCase().slice(0, 160);
  const explicitRole = (element.getAttribute("role") || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase()
    .slice(0, 160);
  const implicitRole =
    tag === "button"
      ? "button"
      : tag === "a" && element.hasAttribute("href")
        ? "link"
        : tag === "select"
          ? "combobox"
          : tag === "textarea"
            ? "textbox"
            : tag === "input" && ["button", "submit", "reset"].includes(type)
              ? "button"
              : tag === "input" && type === "checkbox"
                ? "checkbox"
                : tag === "input" && type === "radio"
                  ? "radio"
                  : tag === "input"
                    ? "textbox"
                    : "";
  let controlLabels = "";
  if ("labels" in element) {
    const labels = (element as HTMLInputElement).labels;
    if (labels) {
      for (let index = 0; index < labels.length; index += 1) {
        controlLabels += ` ${labels[index].textContent || ""}`;
      }
    }
  }
  const text = (element.textContent || "").replace(/\s+/g, " ").trim().toLocaleLowerCase().slice(0, 160);
  const rawName =
    element.getAttribute("aria-label") ||
    controlLabels ||
    element.getAttribute("alt") ||
    element.getAttribute("placeholder") ||
    element.getAttribute("title") ||
    text;
  const name = rawName.replace(/\s+/g, " ").trim().toLocaleLowerCase().slice(0, 160);
  const attributes: Record<string, string> = {};
  for (const key of ["id", "name", "type", "placeholder", "data-testid", "aria-label", "data-key", "data-id", "data-row-key", "data-item-key"]) {
    const value = (element.getAttribute(key) || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase()
      .slice(0, 160);
    if (value) attributes[key] = value;
  }
  const ancestry: string[] = [];
  let parent = element.parentElement;
  while (parent && ancestry.length < 3) {
    let ancestor = parent.tagName.toLocaleLowerCase();
    const parentRole = (parent.getAttribute("role") || "").replace(/\s+/g, " ").trim().toLocaleLowerCase().slice(0, 160);
    const parentId = (parent.getAttribute("id") || "").replace(/\s+/g, " ").trim().toLocaleLowerCase().slice(0, 160);
    const parentTestId = (parent.getAttribute("data-testid") || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase()
      .slice(0, 160);
    if (parentRole) ancestor += `|${parentRole}`;
    if (parentId) ancestor += `|${parentId}`;
    if (parentTestId) ancestor += `|${parentTestId}`;
    ancestry.push(ancestor);
    parent = parent.parentElement;
  }
  return { tag, role: explicitRole || implicitRole, name, text, attributes, ancestry };
}

/**
 * Persist equality-preserving token hashes instead of page text/labels/attribute values. This
 * keeps lexical overlap useful for local similarity without turning locator memory (or a saved
 * guard) into a second store of customer-visible business data.
 */
export function hashFingerprint(fingerprint: LocatorElementFingerprint): LocatorElementFingerprint {
  const hash = (value: string): string => createHash("sha256").update(value).digest("hex").slice(0, 20);
  const hashTokens = (value: string): string =>
    [...new Set(value.split(/\s+/).filter(Boolean).map(hash))].sort().join(" ");
  return {
    tag: fingerprint.tag,
    role: fingerprint.role,
    name: hashTokens(fingerprint.name),
    text: hashTokens(fingerprint.text),
    attributes: Object.fromEntries(Object.entries(fingerprint.attributes).map(([key, value]) => [key, hash(value)])),
    ancestry: fingerprint.ancestry.map(hash)
  };
}

/** Hash a single non-secret token the same way a fingerprint token is hashed (for preconditions). */
export function hashToken(value: string): string {
  return createHash("sha256").update(value.replace(/\s+/g, " ").trim().toLocaleLowerCase()).digest("hex").slice(0, 20);
}

/**
 * Exact identity equality of the identity-bearing fields (tag, role, name, text, attributes). Used by the
 * guarded-positional check where `confidence: "exact"` — the recorded target's identity must be UNCHANGED.
 * Unlike {@link similarity} (built for fuzzy local recovery), an identical fingerprint always matches, so a
 * bare control with empty text/attributes (an input, an icon) is never falsely rejected. Ancestry is
 * intentionally not compared: it is a weaker signal that shifts on benign wrapper restructuring, while
 * name/text/attributes carry the record identity that matters for a sensitive action.
 */
export function fingerprintsEqual(a: LocatorElementFingerprint, b: LocatorElementFingerprint): boolean {
  if (a.tag !== b.tag || a.role !== b.role || a.name !== b.name || a.text !== b.text) return false;
  const aKeys = Object.keys(a.attributes).sort();
  const bKeys = Object.keys(b.attributes).sort();
  if (aKeys.length !== bKeys.length || aKeys.some((key, index) => key !== bKeys[index])) return false;
  return aKeys.every((key) => a.attributes[key] === b.attributes[key]);
}

/**
 * Weighted lexical/structural similarity of two hashed fingerprints in [0, 1].
 *
 * The structural portion deliberately follows the useful part of adaptive-relocation systems such
 * as Scrapling without importing their runtime or weakening AWKIT's resolution gates: attribute
 * dictionaries get partial credit when the same identity-bearing keys survive value drift, and the
 * short ancestry path is compared as an ORDERED sequence instead of fixed indexes so inserting a
 * benign wrapper does not erase every parent signal. LocatorFactory still owns the 0.86 confidence
 * threshold, 0.08 runner-up margin, bounded scans, page/context gates, and sensitive-action refusal.
 * Persisted fingerprints remain the existing privacy-hashed schema; no page text or raw attributes
 * are introduced by this scoring change.
 */
export function similarity(a: LocatorElementFingerprint, b: LocatorElementFingerprint): number {
  const textScore = (left: string, right: string): number => {
    if (!left || !right) return 0;
    if (left === right) return 1;
    const leftTokens = new Set(left.split(/\s+/).filter(Boolean));
    const rightTokens = new Set(right.split(/\s+/).filter(Boolean));
    const common = [...leftTokens].filter((token) => rightTokens.has(token)).length;
    return common / Math.max(leftTokens.size, rightTokens.size, 1);
  };

  // A bounded longest-common-subsequence score is the hashed-token equivalent of path sequence
  // matching: it preserves parent order while tolerating an inserted/removed wrapper. Ancestry is
  // capped at three entries by createPageFingerprint, so this dynamic-programming table is tiny.
  const orderedSequenceScore = (left: string[], right: string[]): number => {
    if (left.length === 0 || right.length === 0) return 0;
    const row = new Array<number>(right.length + 1).fill(0);
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
      let diagonal = 0;
      for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
        const previous = row[rightIndex];
        row[rightIndex] =
          left[leftIndex - 1] === right[rightIndex - 1]
            ? diagonal + 1
            : Math.max(row[rightIndex], row[rightIndex - 1]);
        diagonal = previous;
      }
    }
    return row[right.length] / Math.max(left.length, right.length, 1);
  };

  const attributeKeys = new Set([...Object.keys(a.attributes), ...Object.keys(b.attributes)]);
  const attributeScore = (() => {
    if (attributeKeys.size === 0) return 0;
    const sharedKeys = [...attributeKeys].filter((key) => key in a.attributes && key in b.attributes).length;
    const exactValues = [...attributeKeys].filter(
      (key) => a.attributes[key] !== undefined && a.attributes[key] === b.attributes[key]
    ).length;
    const keyShapeScore = sharedKeys / attributeKeys.size;
    const retainedValueScore = exactValues / attributeKeys.size;
    return (keyShapeScore + retainedValueScore) / 2;
  })();
  const ancestryScore = orderedSequenceScore(a.ancestry, b.ancestry);

  return (
    (a.tag === b.tag ? 0.12 : 0) +
    (a.role && a.role === b.role ? 0.18 : 0) +
    textScore(a.name, b.name) * 0.32 +
    textScore(a.text, b.text) * 0.18 +
    attributeScore * 0.1 +
    ancestryScore * 0.1
  );
}
