import type { Frame, Locator } from "playwright";

import { DOM_INTELLIGENCE_LIMITS, type DomIntelligenceProvider } from "./DomIntelligenceProvider";
import { captureDomSnapshot } from "./domSnapshot";

/**
 * L12.13 (awkit-djnl.21.13): "pick one row, get every row like it". The inspected element and the elements the
 * parser-only provider finds alike to it (`find_similar`), in page order, as bounded visible text the caller
 * redacts. Read-only: nothing is clicked or changed. A protected document is refused by the snapshot, so no
 * sign-in page is ever read here.
 *
 * L12.24 (awkit-djnl.21.24): the provider's "alike" is structural, so a row's Approve and Reject buttons were one
 * set and the loop clicked both. Only elements with the picked control's semantic identity are kept (see
 * `semanticIdentity`), and a loop is offered only when that identity is provable and occurs once per row.
 */

export const SIMILAR_ROWS_LIMITS = Object.freeze({ rows: 50, chars: 120 });

export type SimilarRowsResult =
  /**
   * `loop` (L12.19): a selector matching exactly these rows on the main page, when one could be proven.
   * `loopRowDepth` (L12.25): how many levels above each matched element its row is, for the run-time row check.
   */
  | { ok: true; rows: string[]; total: number; loop?: string; loopRowDepth?: number }
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
    const found = [...new Set([index, ...similar.similar])].sort((a, b) => a - b);
    const complete = found.length === similar.count + 1;
    const identity = await frame.locator("body *").evaluateAll(semanticIdentity, { wanted: found, picked: index, control: CONTROL });
    const wanted = identity.keep;
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
    // Over the cap the identity of the unreturned rows is unknown, so the total stays the provider's count.
    const loop = complete && identity.proven && wanted.length > 1 && frame === frame.page().mainFrame() ? await commonRowSelector(frame, wanted, identity.same) : null;
    return { ok: true, rows, total: complete ? wanted.length : similar.count + 1, ...(loop ? { loop: loop.selector, loopRowDepth: loop.rowDepth } : {}) };
  } catch {
    return { ok: false, reason: "provider-error" };
  }
}

/**
 * L12.24: which of the provider's look-alikes carry the picked element's semantic identity, and whether a loop
 * over them is safe. For a control (button, link, field, or an interactive role) the identity is its tag, role,
 * `type`, disabled and visible state, and its accessible name, `name` and `data-action`, each with the row's own
 * data replaced by a placeholder (the row's other visible text, and digits), so "More actions for Rotate API
 * keys" and "More actions for Renew certificate" are one action while Approve and Reject are two. Classes and
 * position never count. A non-control (a row or card) keeps its tag and role only.
 *
 * `proven` is false, and no loop is offered, when the picked control has no name left once row data is removed
 * (an unlabelled icon), when a row holds the identity twice (two indistinguishable Approve buttons: which one
 * was meant is unknowable), or when a picked non-control contains controls (the click lands on one of them).
 *
 * L12.25 (awkit-djnl.21.25): disabled and visible state is NOT identity, it changes between making the loop and
 * running it. Independent QC: Approve named after its row's invoice and a disabled Reject differed only in state,
 * the loop selector excluded Reject by `:not([disabled])`, and once Reject was enabled the real StepExecutor
 * clicked both. So every element under the rows' container with the picked tag is compared on its state-free
 * identity: a row holding that identity twice (one enabled, one disabled) refuses the loop, and `same` (every
 * element carrying it, available or not) is the only set a loop selector may match before its state filters.
 * NOTE: no named inner functions in this evaluate body (esbuild's `__name` helper is undefined in the page).
 */
const CONTROL =
  "button,a[href],input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=tab],[role=checkbox],[role=radio],[role=switch],[role=option],[role=treeitem]";

const semanticIdentity = (elements: Element[], arg: { wanted: number[]; picked: number; control: string }): { keep: number[]; same: number[]; proven: boolean } => {
  const CONTROL = arg.control;
  const nodes = arg.wanted.map((i) => elements[i]);
  if (nodes.some((node) => !node)) return { keep: [arg.picked], same: [], proven: false };
  let common: Element | null = nodes.length > 1 ? nodes[0].parentElement : null;
  while (common && !nodes.every((node) => common!.contains(node) && node !== common)) common = common.parentElement;
  const picked = elements[arg.picked];
  // The look-alikes first (in `wanted` order), then everything else under the container a loop selector could match.
  const pool = [...nodes, ...(common && picked ? Array.from(common.querySelectorAll(picked.localName)).filter((el) => !nodes.includes(el)) : [])];
  // ponytail: over 5,000 candidates the check is not run and no loop is offered.
  if (pool.length > 5_000) return { keep: [arg.picked], same: [], proven: false };
  const facts = pool.map((el) => {
    let row: Element = el;
    while (common && row.parentElement && row.parentElement !== common) row = row.parentElement;
    if (!el.matches(CONTROL)) {
      const key = `${el.localName}|${el.getAttribute("role") ?? ""}`;
      return { key, semantic: key, row, control: false, named: true, nested: el.querySelector(CONTROL) !== null };
    }
    // The row's own data: visible text outside this element and outside every other control in the row.
    const pieces: string[] = [];
    if (row !== el) {
      const walker = el.ownerDocument.createTreeWalker(row, 4);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (!parent || el.contains(parent) || parent.closest(CONTROL) || /^(SCRIPT|STYLE|TEMPLATE)$/.test(parent.tagName)) continue;
        const text = (node.nodeValue ?? "").replace(/\s+/g, " ").trim();
        if (text.length > 1) pieces.push(text);
      }
    }
    pieces.sort((a, b) => b.length - a.length);
    const labelledBy = (el.getAttribute("aria-labelledby") ?? "")
      .split(/\s+/)
      .map((id) => (id ? el.ownerDocument.getElementById(id)?.textContent ?? "" : ""))
      .join(" ");
    const labels = "labels" in el && (el as HTMLInputElement).labels ? Array.from((el as HTMLInputElement).labels!, (label) => label.textContent ?? "").join(" ") : "";
    const image = el.querySelector("img[alt],svg title");
    const name =
      labelledBy.trim() ||
      el.getAttribute("aria-label") ||
      labels.trim() ||
      (el.localName === "input" && /^(button|submit|reset)$/i.test(el.getAttribute("type") ?? "") ? el.getAttribute("value") : "") ||
      el.getAttribute("alt") ||
      el.getAttribute("title") ||
      el.textContent?.trim() ||
      (image ? image.getAttribute("alt") || image.textContent : "") ||
      "";
    const templates = [name, el.getAttribute("name") ?? "", el.getAttribute("data-action") ?? ""].map((value) => {
      let template = value.replace(/\s+/g, " ").trim();
      for (const piece of pieces) template = template.split(piece).join("\u0001");
      return template.replace(/\d+/g, "#");
    });
    const disabled = (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true";
    const style = el.ownerDocument.defaultView?.getComputedStyle(el);
    const visible = el.getClientRects().length > 0 && style?.visibility !== "hidden";
    const semantic = [el.localName, el.getAttribute("role") ?? "", (el.getAttribute("type") ?? "").toLowerCase(), ...templates].join("\u0002");
    return {
      key: [semantic, disabled, visible].join("\u0002"),
      semantic,
      row,
      control: true,
      named: /[\p{L}\p{N}]/u.test(templates[0].replace(/[\u0001#]/g, "")),
      nested: false
    };
  });
  const me = facts[arg.wanted.indexOf(arg.picked)];
  if (!me) return { keep: [arg.picked], same: [], proven: false };
  const alike = facts.filter((fact) => fact.semantic === me.semantic);
  const position = new Map<Element, number>();
  elements.forEach((el, i) => position.set(el, i));
  return {
    keep: arg.wanted.filter((_, k) => facts[k].key === me.key),
    same: pool.filter((_, k) => facts[k].semantic === me.semantic).map((el) => position.get(el) ?? -1),
    proven: (me.control ? me.named : !me.nested) && new Set(alike.map((fact) => fact.row)).size === alike.length
  };
};

/**
 * L12.19 (awkit-djnl.21.19): one selector that matches EXACTLY the given rows, for an element loop over them.
 * The rows must share their tag path below their nearest common ancestor. The selector is anchored on that
 * ancestor or a nearer-the-root one that is uniquely named by `data-testid`, a non-numeric `id` or `aria-label`,
 * followed by the child tag path. Never classes (utility and hashed classes are what the Recorder refuses to emit).
 *
 * L12.24: the last step also carries what every row shares that says which action it is (its `aria-label`,
 * `data-action`, `name`, `title` or `role`, and its exact text as Playwright's `:text-is()`), so a reordered or
 * newly added sibling action never matches at run time; then, only if needed, `:not([disabled])` and
 * `:visible`. The selector is returned only when Playwright itself resolves it to the very same elements.
 *
 * L12.25: before its state filters, the selector may match only elements in `same` (the picked control's
 * state-free identity, see `semanticIdentity`). A state filter may set aside an unavailable copy of the same
 * action, never a different action: that one is told apart by state alone, which the page can change before the
 * loop runs. `rowDepth` is how far above a matched element its row is (the row is a child of the rows' container).
 *
 * L12.27 (awkit-djnl.21.27): the semantic part must NAME the action (a shared `aria-label`, `data-action`, a `title`
 * that is a textless control's accessible name, or the shared text; L12.28 QC: never a form `name`). A tag path, a role, position or state alone is never enough, even when it matches
 * only the picked action today: the page can rename, unwrap or add an action before the loop runs.
 *
 * L12.30 (awkit-djnl.21.30, re-QC N4/N5): a value is not the action's name merely because every picked row carries it. It
 * names the action only when no other control under the rows' container (another action, in any state, on any path)
 * carries it too, and, when there is no other action to tell it apart from, only when it agrees with what the control
 * itself shows (a word of its text or icon name). A generic "Row action" label, data-action or title only narrows.
 *
 * L12.32 (L12.31 QC N6): the agreement is required whether or not other actions exist; telling actions apart today is
 * not naming one. A control that shows no name at all (an icon) is named only with its icon pinned in the selector.
 */
export async function commonRowSelector(frame: Frame, wanted: number[], same: number[]): Promise<{ selector: string; rowDepth: number } | null> {
  // NOTE: no named inner functions in this evaluate body (esbuild's `__name` helper is undefined in the page).
  const found = await frame.locator("body *").evaluateAll((elements, arg) => {
    const indices = arg.wanted;
    const allowed = new Set<Element>(arg.same.map((i) => elements[i]));
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
    // Attribute values and text are quoted as CSS strings: `"` and `\` escaped.
    const texts = rows.map((row) => (row.textContent ?? "").replace(/\s+/g, " ").trim());
    // L12.30 (re-QC N4/N5): the names every OTHER control under the rows' container carries (another action, in any state
    // and on any path), and the words each picked control shows itself (its text, or its icon's own name).
    const siblingNames = new Set<string>();
    for (const element of Array.from(common.querySelectorAll(arg.control))) {
      if (allowed.has(element)) continue;
      for (const value of [element.getAttribute("aria-label"), element.getAttribute("data-action"), element.getAttribute("title"), element.textContent]) {
        const label = (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
        if (label) siblingNames.add(label);
      }
    }
    const shown = rows.map((row, k) =>
      (texts[k] || row.querySelector("img[alt]")?.getAttribute("alt") || row.querySelector("svg title")?.textContent || "")
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word.length > 2 && !/^\d+$/.test(word))
    );
    // L12.32 (L12.31 QC N6): a control that shows no name at all (an icon) shows its icon. A label can name such an
    // action only together with that icon, pinned in the selector (`:has(...)`), so the loop follows what the user sees,
    // never the label alone: an icon that becomes Reject under the same "Row action" title then matches nothing.
    let pin = "";
    if (shown.every((own) => !own.length)) {
      for (const [tag, name] of [["path", "d"], ["use", "href"], ["img", "src"]]) {
        const value = rows[0].querySelector(`${tag}[${name}]`)?.getAttribute(name) ?? "";
        if (value && !/[\r\n]/.test(value) && rows.every((row) => row.querySelector(`${tag}[${name}]`)?.getAttribute(name) === value)) {
          pin = `:has(${tag}[${name}="${value.replace(/["\\]/g, "\\$&")}"])`;
          break;
        }
      }
    }
    let attributes = "";
    let named = false;
    for (const name of ["aria-label", "data-action", "name", "title", "role"]) {
      const value = rows[0].getAttribute(name);
      if (value && rows.every((row) => row.getAttribute(name) === value)) {
        attributes += `[${name}="${value.replace(/["\\]/g, "\\$&")}"]`;
        // What names the action: its aria-label, its data-action, or a title that is its accessible name (no text).
        // A role says what kind of control it is, and a form `name` is shared by every action of one form
        // (`decision=approve|reject`, L12.28 QC: such a loop clicked Unapprove in every row): they only narrow.
        if (name === "aria-label" || name === "data-action" || (name === "title" && texts.every((text) => !text))) {
          // L12.30: and only when it tells this action apart. Not when another action carries it too (a generic "Row
          // action": the loop clicked Unapprove, or Reject, in every row once the page changed). L12.32 (L12.31 QC N6):
          // and, whether or not other actions exist, only when it agrees with what the control itself shows, or, for an
          // icon, with its icon pinned. Telling actions apart today is not naming one: a "Row action" carried by Approve
          // alone, beside a differently named Reject, followed Approve when it became Unapprove. Otherwise it only narrows.
          const label = value.replace(/\s+/g, " ").trim().toLowerCase();
          const words = label.split(/[^\p{L}\p{N}]+/u);
          if (!siblingNames.has(label) && (pin || shown.every((own) => own.some((word) => words.includes(word))))) named = true;
        }
      }
    }
    if (named) attributes += pin;
    const sharedText = texts[0] && texts[0].length <= 80 && texts.every((text) => text === texts[0]) ? texts[0] : "";
    // L12.27: every head names the action, by a shared attribute or the shared text. A tag path (with a role at most)
    // was offered whenever no other action sat on that exact path when the loop was made, and clicked Unapprove, or a
    // Reject unwrapped later, in every row (independent QC). Nothing else is guessed: no shared name, no loop.
    const heads: Array<{ css: string; text: string }> = [];
    if (named || sharedText) heads.push({ css: attributes, text: sharedText });
    if (named && sharedText) heads.push({ css: attributes, text: "" });
    const variants: Array<{ head: string; css: string; text: string; visible: boolean }> = [];
    for (const head of heads) {
      for (const state of ["", ':not([disabled]):not([aria-disabled="true"])']) {
        variants.push({ head: head.css, css: head.css + state, text: head.text, visible: false }, { head: head.css, css: head.css + state, text: head.text, visible: true });
      }
    }
    const doc = rows[0].ownerDocument;
    const all = Array.from(doc.body.querySelectorAll("*"));
    let below = chains[0];
    for (let anchor: Element | null = common; anchor && anchor !== doc.documentElement; anchor = anchor.parentElement) {
      for (const name of ["data-testid", "id", "aria-label"]) {
        const value = anchor.getAttribute(name);
        if (!value || (name === "id" && /\d/.test(value))) continue;
        const prefix = `${anchor.localName}[${name}="${value.replace(/["\\]/g, "\\$&")}"] > ${below}`;
        for (const variant of variants) {
          const base = `${prefix}${variant.css}`;
          let matches: Element[];
          try {
            // The variant's semantic part alone, without its state filters, must name nothing but the picked action.
            const semantic = Array.from(doc.querySelectorAll(`${prefix}${variant.head}`)).filter(
              (element) => !variant.text || (element.textContent ?? "").replace(/\s+/g, " ").trim() === variant.text
            );
            if (semantic.some((element) => !allowed.has(element))) continue;
            matches = Array.from(doc.querySelectorAll(base));
          } catch {
            continue;
          }
          if (variant.text) matches = matches.filter((element) => (element.textContent ?? "").replace(/\s+/g, " ").trim() === variant.text);
          if (variant.visible) matches = matches.filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
          if (matches.length === rows.length && rows.every((row) => matches.includes(row))) {
            const text = variant.text ? `:text-is("${variant.text.replace(/["\\]/g, "\\$&")}")` : "";
            return {
              selector: `${base}${text}${variant.visible ? ":visible" : ""}`,
              semantic: `${prefix}${variant.head}${text}`,
              allowed: Array.from(allowed, (element) => all.indexOf(element)),
              rows: rows.map((row) => all.indexOf(row)),
              rowDepth: chains[0].split(" > ").length - 1
            };
          }
        }
      }
      below = `${anchor.localName} > ${below}`;
    }
    return null;
  }, { wanted, same, control: CONTROL });
  if (!found || found.rows.includes(-1)) return null;
  // The loop runs on Playwright's selector engine, so Playwright, not the page, has the final word: on the selector,
  // and on its semantic part naming nothing but the picked action.
  const resolve = (selector: string) =>
    frame
      .locator(selector)
      .evaluateAll((elements) => {
        const all = Array.from(document.body.querySelectorAll("*"));
        return elements.map((element) => all.indexOf(element));
      })
      .catch(() => null);
  const [resolved, semantic] = await Promise.all([resolve(found.selector), resolve(found.semantic)]);
  if (!semantic || semantic.some((index) => index < 0 || !found.allowed.includes(index))) return null;
  return resolved && resolved.length === found.rows.length && found.rows.every((row) => resolved.includes(row)) ? { selector: found.selector, rowDepth: found.rowDepth } : null;
}
