/**
 * Recorder capture script (runs in the recorded page's DOM context).
 *
 * This function is injected into every page/frame via Playwright's `addInitScript`,
 * so it MUST be fully self-contained: it may only reference browser globals
 * (`window`, `document`, `CSS`, …) and the `window.__awtkit_recordAction` binding
 * exposed by `RecorderService`. It must not reference any module-scope helpers,
 * because Playwright serializes it with `Function.prototype.toString()`.
 *
 * Its job is to turn a clicked/changed element into a **unique, Playwright-safe
 * locator**: it generates ranked candidate locators (semantic first, utility-class
 * selectors never), validates each against the live DOM (`count === 1`), and reports
 * the best one together with uniqueness metadata (`LocatorQuality`). This is what
 * prevents the recorder from saving generic selectors like
 * `div.flex.items-center.justify-center` that resolve to many elements.
 */
export function installRecorderCapture(): void {
  // Guard against double-install (addInitScript runs per navigation/frame).
  const w = window as unknown as Record<string, unknown>;
  if (w.__awtkitCaptureInstalled) return;
  w.__awtkitCaptureInstalled = true;

  const record = (action: unknown): void => {
    const fn = (window as unknown as { __awtkit_recordAction?: (a: unknown) => void }).__awtkit_recordAction;
    if (typeof fn === "function") {
      try {
        fn(action);
      } catch {
        /* recording binding not ready — ignore */
      }
    }
  };

  // Smart Wait observation (Phase 2): emit a raw signal (loader/network/url/rows/toast/enabled)
  // to the RecorderService, which correlates it into `afterWaits` on the previous action.
  const signal = (s: unknown): void => {
    const fn = (window as unknown as { __awtkit_recordSignal?: (s: unknown) => void }).__awtkit_recordSignal;
    if (typeof fn === "function") {
      try {
        fn(s);
      } catch {
        /* signal binding not ready — ignore */
      }
    }
  };

  interface SignalLocatorShape {
    strategy: string;
    value: string;
    name?: string;
    exact?: boolean;
  }

  const norm = (s: string | null | undefined): string => (s || "").replace(/\s+/g, " ").trim();

  // Escape a value for use inside a double-quoted CSS attribute selector.
  const esc = (v: string): string => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  // Escape an identifier for use as a CSS id/class token.
  const ident = (v: string): string => {
    try {
      if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(v);
    } catch {
      /* fall through */
    }
    return v.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  };

  // Count matches for a CSS selector; a broken selector counts as "many" so it loses.
  const q = (selector: string): number => {
    try {
      return document.querySelectorAll(selector).length;
    } catch {
      return 999;
    }
  };

  // Ids that are obviously framework-generated / random and unsafe to depend on.
  const looksGeneratedId = (id: string): boolean => {
    if (!id) return true;
    if (id.length > 40) return true;
    if (/^\d/.test(id)) return true; // invalid CSS id + usually generated
    if (/[:.]/.test(id)) return true; // React useId (":r0:") etc.
    if (/(^|[-_])[0-9a-f]{6,}($|[-_])/i.test(id)) return true; // hex hash chunk
    if (/^(radix|headlessui|mui-|ember|ext-gen|react-aria|:r)/i.test(id)) return true;
    if (/\d{4,}/.test(id)) return true; // long digit runs
    return false;
  };

  const tagOf = (el: Element): string => (el.tagName ? el.tagName.toLowerCase() : "");
  const attr = (el: Element, name: string): string => {
    const v = el.getAttribute ? el.getAttribute(name) : null;
    return v && v.trim() ? v.trim() : "";
  };

  // Best-effort ARIA role from an explicit role attribute or the element's tag.
  const roleOf = (el: Element): string => {
    const explicit = attr(el, "role");
    if (explicit) return explicit.toLowerCase();
    const tag = tagOf(el);
    if (tag === "button") return "button";
    if (tag === "a" && el.hasAttribute("href")) return "link";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "img" && attr(el, "alt")) return "img";
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "input") {
      const type = (attr(el, "type") || "text").toLowerCase();
      if (type === "submit" || type === "button" || type === "reset") return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (["text", "email", "tel", "url", "search"].indexOf(type) >= 0) return "textbox";
    }
    return "";
  };

  // The label text associated with a form control (wrapping <label> or label[for=id]).
  const labelText = (el: Element): string => {
    const wrapping = el.closest ? el.closest("label") : null;
    if (wrapping) {
      const t = norm(wrapping.textContent);
      if (t) return t;
    }
    const id = (el as HTMLElement).id;
    if (id) {
      try {
        const lab = document.querySelector('label[for="' + esc(id) + '"]');
        if (lab) {
          const t = norm(lab.textContent);
          if (t) return t;
        }
      } catch {
        /* ignore */
      }
    }
    return "";
  };

  // Approximate the element's accessible name (used for locators AND step naming).
  const accessibleName = (el: Element): string => {
    const al = attr(el, "aria-label");
    if (al) return norm(al);
    const labelledby = attr(el, "aria-labelledby");
    if (labelledby) {
      let text = "";
      labelledby.split(/\s+/).forEach((id) => {
        const ref = document.getElementById(id);
        if (ref) text += " " + ref.textContent;
      });
      if (norm(text)) return norm(text);
    }
    const tag = tagOf(el);
    if (tag === "input" || tag === "select" || tag === "textarea") {
      const lt = labelText(el);
      if (lt) return lt;
      const type = (attr(el, "type") || "").toLowerCase();
      if (type === "submit" || type === "button" || type === "reset") {
        const v = attr(el, "value");
        if (v) return norm(v);
      }
      const ph = attr(el, "placeholder");
      if (ph) return norm(ph);
    }
    if (tag === "img") {
      const alt = attr(el, "alt");
      if (alt) return norm(alt);
    }
    const txt = norm(el.textContent);
    if (txt) return txt;
    const title = attr(el, "title");
    if (title) return norm(title);
    return "";
  };

  const ROLE_SELECTORS: Record<string, string> = {
    button: "button, [role=button], input[type=submit], input[type=button], input[type=reset]",
    link: "a[href], [role=link]",
    textbox: "input[type=text], input[type=email], input[type=tel], input[type=url], input[type=search], input:not([type]), textarea, [role=textbox]",
    checkbox: "input[type=checkbox], [role=checkbox]",
    radio: "input[type=radio], [role=radio]",
    combobox: "select, [role=combobox]",
    heading: "h1,h2,h3,h4,h5,h6,[role=heading]",
    img: "img[alt], [role=img]"
  };

  // Elements plausibly exposing `role` within an arbitrary root (whole page or a container subtree).
  const elementsForRoleIn = (root: ParentNode, role: string): Element[] => {
    const selector = ROLE_SELECTORS[role] || "[role=" + role + "]";
    try {
      return Array.prototype.slice.call(root.querySelectorAll(selector));
    } catch {
      return [];
    }
  };

  // Elements that plausibly expose the given ARIA role (used to count role matches).
  const elementsForRole = (role: string): Element[] => elementsForRoleIn(document, role);

  const countRoleName = (role: string, name: string): number => {
    let count = 0;
    const els = elementsForRole(role);
    for (let i = 0; i < els.length; i += 1) {
      if (accessibleName(els[i]) === name) {
        count += 1;
        if (count > 5) break;
      }
    }
    return count;
  };

  const countByLabel = (text: string): number => {
    let count = 0;
    let controls: Element[] = [];
    try {
      controls = Array.prototype.slice.call(document.querySelectorAll("input, select, textarea, [role=textbox], [role=combobox]"));
    } catch {
      return 999;
    }
    for (let i = 0; i < controls.length; i += 1) {
      const el = controls[i];
      const al = attr(el, "aria-label");
      const name = al ? norm(al) : labelText(el);
      if (name === text) {
        count += 1;
        if (count > 5) break;
      }
    }
    return count;
  };

  const countExactText = (text: string): number => {
    let count = 0;
    let all: NodeListOf<Element>;
    try {
      all = document.querySelectorAll("body *");
    } catch {
      return 999;
    }
    for (let i = 0; i < all.length; i += 1) {
      if (norm(all[i].textContent) === text) {
        count += 1;
        if (count > 5) break;
      }
    }
    return count;
  };

  // A structural (positional) CSS path, used only as a fragile last resort.
  //
  // Unlike a naive tag path, this is guaranteed unique when possible: it walks up from the
  // element prepending one segment per ancestor and stops the instant the accumulated path
  // resolves to exactly one element (`count === 1`). Each segment pins the node's position
  // among ALL of its siblings via `:nth-child` (more disambiguating than `:nth-of-type`), and
  // a stable ancestor id short-circuits the climb into an anchored, unique path. The previous
  // implementation capped the path at 6 levels and only added an index for same-tag siblings,
  // so it could emit a "floating" child-chain like `div > div > … > svg` that matched many
  // subtrees — that is the multi-match bug this replaces.
  const structuralSelector = (el: Element): string => {
    // One path segment for a node: a stable id (anchors + guarantees uniqueness) or
    // tag + its 1-based position among all siblings.
    const segmentFor = (node: Element): string => {
      const nodeId = (node as HTMLElement).id;
      if (nodeId && !looksGeneratedId(nodeId)) return "#" + ident(nodeId);
      let seg = tagOf(node);
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.prototype.slice.call(parent.children);
        const index = siblings.indexOf(node);
        if (index >= 0) seg += ":nth-child(" + (index + 1) + ")";
      }
      return seg;
    };

    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node.nodeType === 1 && tagOf(node) !== "html") {
      const seg = segmentFor(node);
      parts.unshift(seg);
      const candidate = parts.join(" > ");
      // Anchored on a stable id, or already unique in the document → shortest unique path.
      if (seg.charAt(0) === "#" || q(candidate) === 1) return candidate;
      node = node.parentElement;
    }
    return parts.join(" > ");
  };

  // A locator scoped by a stable ancestor (id / data-testid) + the element's tag.
  const scopedSelector = (el: Element): { value: string; count: number } | null => {
    let anc = el.parentElement;
    for (let depth = 0; anc && depth < 5; depth += 1, anc = anc.parentElement) {
      const testid = attr(anc, "data-testid");
      let base = "";
      if (testid) base = '[data-testid="' + esc(testid) + '"]';
      else if ((anc as HTMLElement).id && !looksGeneratedId((anc as HTMLElement).id)) base = "#" + ident((anc as HTMLElement).id);
      if (!base) continue;
      const tag = tagOf(el);
      let selector = base + " " + tag;
      let count = q(selector);
      if (count > 1) {
        try {
          const list = Array.prototype.slice.call(document.querySelectorAll(selector));
          const idx = list.indexOf(el);
          if (idx >= 0) {
            selector = base + " " + tag + ":nth-of-type(" + (idx + 1) + ")";
            count = q(selector);
          }
        } catch {
          /* ignore */
        }
      }
      return { value: selector, count };
    }
    return null;
  };

  // ── Compound / tree locators (unique-via-combination) ────────────────────────────────────────
  // When no single strategy is unique, combine the element's own meaningful features with the
  // FEWEST distinguishing ancestors until the selector resolves to exactly one element. Utility/
  // layout classes are never used; positional :nth-* is only a last-ditch tiebreaker. This is what
  // produces selectors like `#results .customer-card input[type=checkbox]` instead of giving up
  // with a non-unique `role`/`text` locator.

  // Tailwind/Bootstrap/utility + state-prefix + hashed (css-modules/emotion/styled) classes:
  // never distinguishing and never safe to depend on.
  const UTILITY_CLASS_RE =
    /^(?:flex|inline-flex|grid|inline-grid|block|inline-block|inline|contents|table|table-cell|table-row|hidden|relative|absolute|fixed|sticky|static|container|row|col|cols|columns|items-|justify-|self-|place-|content-|gap-|space-[xy]-|[pm][trblxyse]?-|w-|h-|min-|max-|size-|text-|font-|leading-|tracking-|whitespace-|truncate|break-|bg-|from-|via-|to-|border|rounded|ring-|divide-|outline-|shadow|opacity-|blur|backdrop-|z-|order-|basis-|grow|shrink|flex-|overflow-|object-|aspect-|transition|duration-|ease-|delay-|animate-|transform|scale-|rotate-|translate-|skew-|origin-|cursor-|select-|pointer-|resize|list-|align-|float-|clear-|visible|invisible|uppercase|lowercase|capitalize|italic|underline|antialiased|sr-only)/;
  const CLASS_STATE_PREFIX_RE = /^(?:sm|md|lg|xl|2xl|hover|focus|focus-visible|focus-within|active|disabled|visited|checked|group|group-hover|peer|peer-focus|dark|light|first|last|odd|even|motion-safe|motion-reduce|print|rtl|ltr)[:-]/;
  const CLASS_HASH_RE = /(?:^|[_-])(?:[a-z0-9]{6,}|[0-9a-f]{5,})$/i;

  const isMeaningfulClass = (c: string): boolean => {
    if (!c || c.length < 3) return false;
    if (/^\d/.test(c)) return false;
    if (CLASS_STATE_PREFIX_RE.test(c)) return false;
    if (UTILITY_CLASS_RE.test(c)) return false;
    if (/^(?:sc-|css-|jsx-|emotion-|makeStyles-|MuiBox-)/.test(c)) return false;
    if (CLASS_HASH_RE.test(c)) return false;
    return true;
  };

  // Class tokens as strings (handles SVG's SVGAnimatedString className).
  const classListOf = (el: Element): string[] => {
    const raw = (el as unknown as { className?: unknown }).className;
    const s = typeof raw === "string" ? raw : attr(el, "class");
    return s ? s.split(/\s+/).filter(Boolean) : [];
  };

  // Rarest (most-distinguishing) meaningful classes first, capped.
  const classTokensFor = (el: Element, cap: number): string[] => {
    const meaningful = classListOf(el).filter(isMeaningfulClass);
    if (!meaningful.length) return [];
    const ranked = meaningful
      .map((c) => {
        let freq = 999;
        try {
          freq = document.getElementsByClassName(c).length || 999;
        } catch {
          freq = 999;
        }
        return { c: c, freq: freq };
      })
      .sort((a, b) => a.freq - b.freq);
    const out: string[] = [];
    for (let i = 0; i < ranked.length && out.length < cap; i += 1) out.push("." + ident(ranked[i].c));
    return out;
  };

  // Stable attribute selectors, most-distinguishing first (never class/style/generated id).
  const STABLE_ATTRS = ["data-testid", "data-test", "data-cy", "name", "role", "type", "aria-label", "title", "alt", "placeholder", "href", "value", "for"];
  const attrTokensFor = (el: Element, cap: number): string[] => {
    const out: string[] = [];
    for (let i = 0; i < STABLE_ATTRS.length && out.length < cap; i += 1) {
      const a = STABLE_ATTRS[i];
      const v = attr(el, a);
      if (!v) continue;
      if (a === "type" && (v === "text" || v === "button")) continue;
      if ((a === "href" || a === "value") && v.length > 120) continue;
      out.push("[" + a + '="' + esc(v) + '"]');
    }
    return out;
  };

  // Best single-node fragment: #id → [data-testid] → tag + stable attrs + meaningful classes.
  const localSelectorFor = (el: Element, maxAttrs: number, maxClasses: number): string => {
    const nodeId = (el as HTMLElement).id;
    if (nodeId && !looksGeneratedId(nodeId)) return "#" + ident(nodeId);
    const dtid = attr(el, "data-testid");
    if (dtid) return '[data-testid="' + esc(dtid) + '"]';
    const seg = tagOf(el);
    return seg + attrTokensFor(el, maxAttrs).join("") + classTokensFor(el, maxClasses).join("");
  };

  const isStableAnchorSeg = (seg: string): boolean => seg.charAt(0) === "#" || seg.indexOf("[data-testid=") === 0;

  // TREE: the leaf's meaningful signature scoped by the FEWEST distinguishing ancestors (descendant
  // combinators, skipping wrapper noise), stopping the instant it resolves to one element. No
  // positional indices — meaningful features only. Returns the best chain it reached (count may be >1).
  const compoundSelector = (el: Element): { value: string; count: number; positional: boolean } | null => {
    const leaf = localSelectorFor(el, 2, 2);
    if (!leaf) return null;
    if (q(leaf) === 1) return { value: leaf, count: 1, positional: false };

    let chain = leaf;
    let node = el.parentElement;
    for (let depth = 0; node && depth < 8 && tagOf(node) !== "html" && tagOf(node) !== "body"; depth += 1, node = node.parentElement) {
      const anc = localSelectorFor(node, 1, 1);
      if (!anc) continue;
      const candidate = anc + " " + chain;
      // Keep an ancestor only if it actually reduces ambiguity (compact, robust tree).
      if (q(candidate) < q(chain)) {
        chain = candidate;
        if (q(chain) === 1) return { value: chain, count: 1, positional: false };
      }
      // A stable id / data-testid ancestor is a hard anchor — climbing past it cannot help.
      if (isStableAnchorSeg(anc)) break;
    }
    return { value: chain, count: q(chain), positional: false };
  };

  // Guaranteed-unique hybrid: nearest UNIQUE stable ancestor (#id / [data-testid]) + a positional
  // '>' tail down to the leaf. Anchored and shorter than a whole-document positional path.
  const anchoredStructural = (el: Element): { value: string; count: number; positional: boolean } | null => {
    let anc: Element | null = el.parentElement;
    let base = "";
    let baseNode: Element | null = null;
    for (let d = 0; anc && d < 10 && tagOf(anc) !== "html"; d += 1, anc = anc.parentElement) {
      const id = (anc as HTMLElement).id;
      if (id && !looksGeneratedId(id)) {
        base = "#" + ident(id);
        baseNode = anc;
        break;
      }
      const dt = attr(anc, "data-testid");
      if (dt) {
        base = '[data-testid="' + esc(dt) + '"]';
        baseNode = anc;
        break;
      }
    }
    if (!base || !baseNode || q(base) !== 1) return null;
    const parts: string[] = [];
    let n: Element | null = el;
    while (n && n !== baseNode) {
      const p: Element | null = n.parentElement;
      if (!p) break;
      const idx = Array.prototype.slice.call(p.children).indexOf(n);
      let seg = tagOf(n);
      if (idx >= 0) seg += ":nth-child(" + (idx + 1) + ")";
      parts.unshift(seg);
      n = p;
    }
    if (!parts.length) return null;
    const value = base + " > " + parts.join(" > ");
    return q(value) === 1 ? { value: value, count: 1, positional: true } : null;
  };

  interface Candidate {
    strategy: string;
    value: string;
    name?: string;
    exact?: boolean;
    count: number;
    fallback?: boolean;
  }

  // Ordered candidate locators — semantic/stable first, positional fallback last.
  const buildCandidates = (el: Element): Candidate[] => {
    const out: Candidate[] = [];
    const tag = tagOf(el);
    const role = roleOf(el);
    const name = accessibleName(el);

    const testid = attr(el, "data-testid");
    if (testid) out.push({ strategy: "testId", value: testid, count: q('[data-testid="' + esc(testid) + '"]') });

    if (role && name && name.length <= 100) {
      out.push({ strategy: "role", value: role, name, exact: true, count: countRoleName(role, name) });
    }

    if (tag === "input" || tag === "select" || tag === "textarea") {
      const al = attr(el, "aria-label");
      const lt = al || labelText(el);
      if (lt) out.push({ strategy: "label", value: lt, exact: true, count: countByLabel(lt) });
    }

    const placeholder = attr(el, "placeholder");
    if (placeholder) out.push({ strategy: "placeholder", value: placeholder, exact: true, count: q('[placeholder="' + esc(placeholder) + '"]') });

    if (name && name.length <= 60 && (role === "button" || role === "link" || tag === "button" || tag === "a")) {
      out.push({ strategy: "text", value: name, exact: true, count: countExactText(name) });
    }

    // Stable attributes (never layout/utility classes).
    ["data-test", "data-cy", "name", "title", "alt", "type"].forEach((a) => {
      const v = attr(el, a);
      if (v && !(a === "type" && (v === "text" || v === "button"))) {
        const selector = tag + "[" + a + '="' + esc(v) + '"]';
        out.push({ strategy: "css", value: selector, count: q(selector) });
      }
    });

    const href = attr(el, "href");
    if (href && href.length <= 200) {
      const selector = tag + '[href="' + esc(href) + '"]';
      out.push({ strategy: "css", value: selector, count: q(selector) });
    }

    const id = (el as HTMLElement).id;
    if (id && !looksGeneratedId(id)) out.push({ strategy: "id", value: id, count: q("#" + ident(id)) });

    const scoped = scopedSelector(el);
    if (scoped) out.push({ strategy: "css", value: scoped.value, count: scoped.count });

    // Compound "tree": meaningful features across the element + fewest distinguishing ancestors.
    // Non-fallback only when it reached a single match via features (so it wins over positional).
    const compound = compoundSelector(el);
    if (compound) out.push({ strategy: "css", value: compound.value, count: compound.count, fallback: compound.count !== 1 || compound.positional });

    // Guaranteed-unique hybrid anchored at the nearest stable ancestor.
    const anchored = anchoredStructural(el);
    if (anchored) out.push({ strategy: "css", value: anchored.value, count: anchored.count, fallback: true });

    const structural = structuralSelector(el);
    if (structural) out.push({ strategy: "css", value: structural, count: q(structural), fallback: true });

    // De-duplicate by (strategy|value|name) so candidateCount reflects distinct options and the
    // ranked alternatives never repeat a selector.
    const seen: Record<string, boolean> = {};
    return out.filter((c) => {
      const key = c.strategy + "|" + c.value + "|" + (c.name || "");
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  };

  interface Quality {
    strategy: string;
    isUnique: boolean;
    matchCount: number;
    confidence: string;
    warning?: string;
    candidateCount: number;
    /** How uniqueness was achieved when no single strategy was unique. */
    disambiguation?: string;
  }

  interface ContainerContext {
    type: "dialog" | "tableRow" | "card" | "listItem";
    strategy: string;
    value: string;
    name?: string;
    exact?: boolean;
    hasText?: string;
    visibleOnly?: boolean;
  }

  // Describe a container element as a stable, Playwright-buildable locator (id → testId → role).
  const describeContainer = (node: Element, type: ContainerContext["type"]): ContainerContext | null => {
    const nodeId = (node as HTMLElement).id;
    if (nodeId && !looksGeneratedId(nodeId)) return { type, strategy: "id", value: nodeId };
    const dtid = attr(node, "data-testid");
    if (dtid) return { type, strategy: "testId", value: dtid };
    const role = attr(node, "role") || roleOf(node);
    const nm = accessibleName(node);
    if (role && nm && nm.length <= 80) return { type, strategy: "role", value: role.toLowerCase(), name: nm, exact: false };
    if (role) return { type, strategy: "css", value: '[role="' + esc(role.toLowerCase()) + '"]' };
    return null;
  };

  // Detect the nearest stable container so a repeated control targets the right subtree.
  // `chosenCount` is the primary locator's match count: when it is already globally unique we
  // only scope for dialogs (to survive a hidden modal twin), never for rows/cards.
  const detectContainer = (el: Element, chosenCount: number): ContainerContext | null => {
    if (!el.closest) return null;

    const dialog = el.closest(
      '[role="dialog"], [role="alertdialog"], dialog, .modal, [class*="modal"], .mat-dialog-container, .ant-modal, .MuiDialog-root, .MuiDialog-container'
    );
    if (dialog && dialog !== el) {
      const base = describeContainer(dialog, "dialog");
      if (base) {
        base.visibleOnly = true; // prefer the visible modal over a hidden template/duplicate
        return base;
      }
    }

    if (chosenCount === 1) return null; // primary already unique — don't over-scope

    const row = el.closest('tr, [role="row"]');
    if (row && row !== el) {
      const text = norm(row.textContent).slice(0, 80);
      if (text) return { type: "tableRow", strategy: "role", value: "row", name: text, exact: false };
    }

    const card = el.closest('[data-testid], [role="listitem"], article, li');
    if (card && card !== el) {
      const text = norm(card.textContent).slice(0, 80) || undefined;
      const dtid = attr(card, "data-testid");
      const isListItem = tagOf(card) === "li" || attr(card, "role") === "listitem";
      const type: ContainerContext["type"] = isListItem ? "listItem" : "card";
      if (dtid) return { type, strategy: "testId", value: dtid, hasText: text };
      if (isListItem) return { type: "listItem", strategy: "role", value: "listitem", hasText: text };
      if (tagOf(card) === "article") return { type: "card", strategy: "role", value: "article", hasText: text };
    }

    return null;
  };

  // Full context: iframe (when the capture runs inside a same-origin frame) + container.
  const detectContext = (el: Element, chosenCount: number): Record<string, unknown> | undefined => {
    const context: Record<string, unknown> = {};

    try {
      if (window.top !== window.self) {
        const fe = window.frameElement;
        if (fe) {
          const fid = (fe as HTMLElement).id;
          const fname = fe.getAttribute ? fe.getAttribute("name") : null;
          const ftitle = fe.getAttribute ? fe.getAttribute("title") : null;
          let selector = "iframe";
          if (fid && !looksGeneratedId(fid)) selector = "iframe#" + ident(fid);
          else if (fname) selector = 'iframe[name="' + esc(fname) + '"]';
          else if (ftitle) selector = 'iframe[title="' + esc(ftitle) + '"]';
          context.frame = { selector };
        }
      }
    } catch {
      /* cross-origin frame — frameElement is inaccessible; skip frame context */
    }

    const container = detectContainer(el, chosenCount);
    if (container) context.container = container;

    return context.frame || context.container ? context : undefined;
  };

  // ── Semantic container scoping (Phase 2a) ────────────────────────────────────────────────────
  // Keep a readable semantic primary (role/label/placeholder/text) when a stable container isolates
  // it to exactly this element. Verified against the real ancestor node so we never scope to the
  // wrong subtree; the compound CSS stays a ranked alternative so runtime is safe regardless.
  const isSemanticStrategy = (strategy: string): boolean =>
    strategy === "role" || strategy === "label" || strategy === "placeholder" || strategy === "text";

  // Elements within `root` that match a semantic candidate (mirrors the runner's getBy* semantics).
  const semanticElementsIn = (root: ParentNode, cand: Candidate): Element[] => {
    try {
      if (cand.strategy === "role") {
        return elementsForRoleIn(root, cand.value).filter((e) => accessibleName(e) === cand.name);
      }
      if (cand.strategy === "placeholder") {
        return Array.prototype.slice.call(root.querySelectorAll('[placeholder="' + esc(cand.value) + '"]'));
      }
      if (cand.strategy === "label") {
        const ctrls = Array.prototype.slice.call(root.querySelectorAll("input, select, textarea, [role=textbox], [role=combobox]")) as Element[];
        return ctrls.filter((e) => {
          const al = attr(e, "aria-label");
          return (al ? norm(al) : labelText(e)) === cand.value;
        });
      }
      if (cand.strategy === "text") {
        return (Array.prototype.slice.call(root.querySelectorAll("*")) as Element[]).filter((e) => norm(e.textContent) === cand.value);
      }
    } catch {
      /* ignore */
    }
    return [];
  };

  // Re-find the container node the same way detectContainer derived it, so verification runs against
  // the actual ancestor of the target element.
  const closestContainerNode = (el: Element, container: ContainerContext): Element | null => {
    if (!el.closest) return null;
    try {
      if (container.type === "dialog") {
        return el.closest('[role="dialog"], [role="alertdialog"], dialog, .modal, [class*="modal"], .mat-dialog-container, .ant-modal, .MuiDialog-root, .MuiDialog-container');
      }
      if (container.strategy === "id") return el.closest("#" + ident(container.value));
      if (container.strategy === "testId") return el.closest('[data-testid="' + esc(container.value) + '"]');
      if (container.strategy === "css") return el.closest(container.value);
      if (container.strategy === "role") {
        if (container.value === "row") return el.closest('tr, [role="row"]');
        if (container.value === "listitem") return el.closest('li, [role="listitem"]');
        if (container.value === "article") return el.closest("article");
        return el.closest('[role="' + esc(container.value) + '"]');
      }
    } catch {
      return null;
    }
    return null;
  };

  // True when `container` scopes semantic candidate `cand` to exactly the target element `el`.
  const containerIsolatesSemantic = (el: Element, cand: Candidate, container: ContainerContext): boolean => {
    const node = closestContainerNode(el, container);
    if (!node) return false;
    const matches = semanticElementsIn(node, cand);
    return matches.length === 1 && matches[0] === el;
  };

  // Up to 3 fallback candidates (excluding the chosen one), unique/non-fragile first.
  const buildAlternatives = (candidates: Candidate[], chosen: Candidate): Array<Record<string, unknown>> => {
    const rank = (c: Candidate): number => (c.count === 1 ? 0 : 2) + (c.fallback ? 1 : 0);
    const ranked = candidates.slice().sort((a, b) => rank(a) - rank(b));
    const seen: Record<string, boolean> = {};
    seen[chosen.strategy + "|" + chosen.value] = true;
    const out: Array<Record<string, unknown>> = [];
    for (let i = 0; i < ranked.length && out.length < 3; i += 1) {
      const c = ranked[i];
      const key = c.strategy + "|" + c.value;
      if (seen[key]) continue;
      seen[key] = true;
      const alt: Record<string, unknown> = { strategy: c.strategy, value: c.value };
      if (c.name) alt.name = c.name;
      if (c.exact) alt.exact = true;
      out.push(alt);
    }
    return out;
  };

  const generate = (el: Element): { locator: Record<string, unknown>; quality: Quality; accessibleName: string } => {
    const candidates = buildCandidates(el);

    let chosen: Candidate | undefined;
    // Prefer the first UNIQUE non-fallback candidate (highest-priority strategy wins).
    for (let i = 0; i < candidates.length; i += 1) {
      if (candidates[i].count === 1 && !candidates[i].fallback) {
        chosen = candidates[i];
        break;
      }
    }
    // Then a unique fallback, if any.
    if (!chosen) {
      for (let i = 0; i < candidates.length; i += 1) {
        if (candidates[i].count === 1) {
          chosen = candidates[i];
          break;
        }
      }
    }
    // Nothing unique: pick the least-ambiguous candidate (smallest positive count).
    if (!chosen) {
      const positive = candidates.filter((c) => c.count > 0).sort((a, b) => a.count - b.count);
      chosen = positive[0] || candidates[candidates.length - 1] || { strategy: "css", value: tagOf(el), count: q(tagOf(el)), fallback: true };
    }

    // Phase 2a: when the primary is not already globally-unique-and-non-fragile, prefer a readable
    // semantic candidate that a stable container isolates to this exact element. The compound CSS
    // stays a ranked alternative, so the runner is safe even if the container heuristic is imperfect.
    let containerScoped = false;
    const goodPrimary = chosen.count === 1 && !chosen.fallback;
    if (!goodPrimary) {
      const container = detectContainer(el, 2);
      if (container) {
        for (let i = 0; i < candidates.length; i += 1) {
          const c = candidates[i];
          if (!isSemanticStrategy(c.strategy)) continue;
          if (containerIsolatesSemantic(el, c, container)) {
            chosen = c;
            containerScoped = true;
            break;
          }
        }
      }
    }

    const globallyUnique = chosen.count === 1;
    const isUnique = globallyUnique || containerScoped;
    const positional = !!chosen.fallback && !containerScoped;
    const semantic = isSemanticStrategy(chosen.strategy) || chosen.strategy === "testId";
    const confidence = !isUnique ? "low" : positional ? "low" : semantic ? "high" : "medium";

    let disambiguation: string | undefined;
    if (containerScoped) disambiguation = "container";
    else if (chosen.strategy === "css" && !chosen.fallback && globallyUnique) disambiguation = "compound";
    else if (positional) disambiguation = "positional";

    const quality: Quality = {
      strategy: positional ? "fallback" : chosen.strategy,
      isUnique,
      matchCount: containerScoped ? 1 : chosen.count,
      confidence,
      candidateCount: candidates.length
    };
    if (disambiguation) quality.disambiguation = disambiguation;
    if (!isUnique) {
      quality.warning = "This locator matches " + chosen.count + " elements. The recorder could not find a unique locator — this step may fail in Playwright strict mode. Re-record or refine it.";
    } else if (positional) {
      quality.warning = "Positional fallback locator — it may break if the page layout changes.";
    }

    const locator: Record<string, unknown> = { strategy: chosen.strategy, value: chosen.value, quality };
    if (chosen.name) locator.name = chosen.name;
    if (chosen.exact) locator.exact = true;

    const alternatives = buildAlternatives(candidates, chosen);
    if (alternatives.length) locator.alternatives = alternatives;

    const context = detectContext(el, chosen.count);
    if (context) locator.context = context;

    return { locator, quality, accessibleName: accessibleName(el) };
  };

  // Climb to the nearest meaningful interactive element for a raw click target.
  const interactiveTarget = (el: Element): Element => {
    const candidate = el.closest
      ? el.closest('a[href], button, input, select, textarea, label, summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [onclick]')
      : null;
    return (candidate as Element) || el;
  };

  // ── Smart Wait observation (Phase 2) ────────────────────────────────────────────────────────
  // Watch the DOM/network between user actions and emit raw signals. Only safe metadata leaves the
  // page — request METHOD + URL PATH (never query/headers/bodies/cookies), loader selectors, short
  // toast text, and locators. RecorderService turns these into `afterWaits` on the previous action.
  (function installSmartWaitObserver(): void {
    const safePath = (u: string): string => {
      try {
        return new URL(u, document.baseURI || location.href).pathname || "";
      } catch {
        return "";
      }
    };
    const upper = (m: unknown): string => String(m || "GET").toUpperCase();

    // Network — patch fetch + XMLHttpRequest (method / path / status / timing only).
    try {
      const holder = window as unknown as { fetch?: (...args: unknown[]) => Promise<unknown> };
      const origFetch = holder.fetch;
      if (typeof origFetch === "function" && !(origFetch as unknown as { __awtkitPatched?: boolean }).__awtkitPatched) {
        const patched = function (this: unknown, input: unknown, init: unknown): Promise<unknown> {
          const initObj = (init || {}) as { method?: string };
          const inputObj = (typeof input === "object" && input ? input : {}) as { method?: string; url?: string };
          const method = upper(initObj.method || inputObj.method || "GET");
          const path = safePath(typeof input === "string" ? input : inputObj.url || "");
          const startedAt = Date.now();
          const done = (status: number): void => signal({ kind: "request", method, path, status, startedAt, endedAt: Date.now() });
          // eslint-disable-next-line prefer-rest-params
          return (origFetch as (...a: unknown[]) => Promise<unknown>).apply(this, arguments as unknown as unknown[]).then(
            (resp: unknown) => {
              const r = resp as { status?: number };
              done(typeof r.status === "number" ? r.status : 0);
              return resp;
            },
            (err: unknown) => {
              done(0);
              throw err;
            }
          );
        };
        (patched as unknown as { __awtkitPatched?: boolean }).__awtkitPatched = true;
        holder.fetch = patched as unknown as typeof holder.fetch;
      }
    } catch {
      /* ignore */
    }

    try {
      const XHR = (window as unknown as { XMLHttpRequest?: { prototype: Record<string, unknown> } }).XMLHttpRequest;
      const proto = XHR && XHR.prototype;
      if (proto && !proto.__awtkitPatched) {
        const open = proto.open as (...a: unknown[]) => unknown;
        const send = proto.send as (...a: unknown[]) => unknown;
        proto.open = function (this: Record<string, unknown>, method: string, url: string): unknown {
          this.__awtkitMethod = upper(method);
          this.__awtkitPath = safePath(url);
          // eslint-disable-next-line prefer-rest-params
          return open.apply(this, arguments as unknown as unknown[]);
        };
        proto.send = function (this: Record<string, unknown>): unknown {
          this.__awtkitStart = Date.now();
          const self = this;
          try {
            (this.addEventListener as (t: string, cb: () => void) => void).call(this, "loadend", function () {
              signal({
                kind: "request",
                method: (self.__awtkitMethod as string) || "GET",
                path: (self.__awtkitPath as string) || "",
                status: typeof self.status === "number" ? (self.status as number) : 0,
                startedAt: (self.__awtkitStart as number) || Date.now(),
                endedAt: Date.now()
              });
            });
          } catch {
            /* ignore */
          }
          // eslint-disable-next-line prefer-rest-params
          return send.apply(this, arguments as unknown as unknown[]);
        };
        proto.__awtkitPatched = true;
      }
    } catch {
      /* ignore */
    }

    // URL changes — patch history + listen to popstate/hashchange.
    try {
      const emitUrl = (): void => signal({ kind: "url", url: location.href, ts: Date.now() });
      const h = history as unknown as { __awtkitPatched?: boolean; pushState: (...a: unknown[]) => unknown; replaceState: (...a: unknown[]) => unknown };
      if (!h.__awtkitPatched) {
        const push = h.pushState;
        const replace = h.replaceState;
        h.pushState = function (this: unknown): unknown {
          // eslint-disable-next-line prefer-rest-params
          const r = push.apply(this, arguments as unknown as unknown[]);
          emitUrl();
          return r;
        };
        h.replaceState = function (this: unknown): unknown {
          // eslint-disable-next-line prefer-rest-params
          const r = replace.apply(this, arguments as unknown as unknown[]);
          emitUrl();
          return r;
        };
        h.__awtkitPatched = true;
      }
      window.addEventListener("popstate", emitUrl, true);
      window.addEventListener("hashchange", emitUrl, true);
    } catch {
      /* ignore */
    }

    // Loader / toast / enabled / rows — periodic scan + MutationObserver.
    const LOADER_TOKENS = [
      ".spinner", ".loading", ".loader", ".progress", ".skeleton", '[role="progressbar"]', '[aria-busy="true"]',
      ".mat-spinner", ".mat-progress-spinner", ".ant-spin", ".MuiCircularProgress-root", ".p-progress-spinner",
      ".v-progress-circular", ".el-loading-mask", ".q-spinner"
    ];
    const LOADER_SEL = LOADER_TOKENS.join(", ");
    const TOAST_SEL = '[role="alert"], [role="status"], .toast, .snackbar, .ant-message, .ant-notification, .MuiSnackbar-root, .Toastify__toast, .p-toast';

    const isVisible = (el: Element): boolean => {
      try {
        const s = getComputedStyle(el as HTMLElement);
        if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity || "1") === 0) return false;
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      } catch {
        return true;
      }
    };
    const loaderSelectorFor = (el: Element): string => {
      for (let i = 0; i < LOADER_TOKENS.length; i += 1) {
        try {
          if ((el as HTMLElement).matches(LOADER_TOKENS[i])) return LOADER_TOKENS[i];
        } catch {
          /* ignore */
        }
      }
      return ".spinner";
    };
    const waitLocatorFor = (el: Element): SignalLocatorShape => {
      const loc = generate(el).locator as Record<string, unknown>;
      const out: SignalLocatorShape = { strategy: String(loc.strategy), value: String(loc.value) };
      if (loc.name) out.name = String(loc.name);
      if (loc.exact) out.exact = true;
      return out;
    };

    const shownLoaders = new Map<Element, { selector: string; shownAt: number }>();
    const seenToasts = new WeakSet<Element>();
    const disabledState = new WeakMap<Element, boolean>();
    const rowCounts = new WeakMap<Element, number>();

    const scanAll = (silent: boolean): void => {
      const now = Date.now();
      try {
        const nodes = Array.prototype.slice.call(document.querySelectorAll(LOADER_SEL)) as Element[];
        const visibleSet = new Set<Element>();
        nodes.forEach((el) => {
          if (isVisible(el)) {
            visibleSet.add(el);
            if (!shownLoaders.has(el)) shownLoaders.set(el, { selector: loaderSelectorFor(el), shownAt: now });
          }
        });
        shownLoaders.forEach((info, el) => {
          if (!visibleSet.has(el) || !document.contains(el)) {
            if (!silent) signal({ kind: "loaderHidden", selector: info.selector, shownAt: info.shownAt, hiddenAt: now });
            shownLoaders.delete(el);
          }
        });
      } catch {
        /* ignore */
      }
      try {
        (Array.prototype.slice.call(document.querySelectorAll(TOAST_SEL)) as Element[]).forEach((el) => {
          if (!seenToasts.has(el) && isVisible(el)) {
            seenToasts.add(el);
            if (!silent) {
              const text = norm(el.textContent).slice(0, 80);
              signal({ kind: "toast", text: text || undefined, role: attr(el, "role") || "", ts: now });
            }
          }
        });
      } catch {
        /* ignore */
      }
      try {
        (Array.prototype.slice.call(document.querySelectorAll("button, input, select, textarea, [role=button]")) as Element[]).forEach((el) => {
          const disabled = (el as HTMLInputElement).disabled === true || attr(el, "aria-disabled") === "true";
          const was = disabledState.get(el);
          if (!silent && was === true && !disabled) {
            signal({ kind: "enabled", locator: waitLocatorFor(el), ts: now });
          }
          disabledState.set(el, disabled);
        });
      } catch {
        /* ignore */
      }
      try {
        const dataContainers =
          "table, [role=table], [role=grid], ul, ol, [role=list], [role=feed], .cards, .card-list, .results-list, [data-testid*=cards i], [data-testid*=list i], [data-testid*=results i]";
        (Array.prototype.slice.call(document.querySelectorAll(dataContainers)) as Element[]).forEach((container) => {
          const tag = tagOf(container);
          const role = attr(container, "role");
          const listLike = tag === "ul" || tag === "ol" || role === "list" || role === "feed" || /(^|\s)(cards|card-list|results-list)(\s|$)/i.test(attr(container, "class"));
          const rowSel = listLike ? "li, [role=listitem], .card, [data-testid*=card i]" : "tr, [role=row]";
          let count = 0;
          try {
            count = container.querySelectorAll(rowSel).length;
          } catch {
            count = 0;
          }
          const prev = rowCounts.get(container) || 0;
          if (!silent && count > prev && count > 0) {
            signal({ kind: "rows", container: waitLocatorFor(container), listLike, count, ts: now });
          }
          rowCounts.set(container, count);
        });
      } catch {
        /* ignore */
      }
    };

    try {
      scanAll(true); // silent baseline — don't emit for pre-existing content
    } catch {
      /* ignore */
    }
    try {
      const obs = new MutationObserver(() => {
        try {
          scanAll(false);
        } catch {
          /* ignore */
        }
      });
      obs.observe(document.documentElement || document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["class", "style", "hidden", "disabled", "aria-busy", "aria-disabled"]
      });
    } catch {
      /* ignore */
    }
    try {
      setInterval(() => {
        try {
          scanAll(false);
        } catch {
          /* ignore */
        }
      }, 150);
    } catch {
      /* ignore */
    }
  })();

  window.addEventListener(
    "click",
    (event) => {
      const raw = event.target as Element | null;
      if (!raw || raw.nodeType !== 1) return;
      const target = interactiveTarget(raw);
      const tag = tagOf(target);
      // Selects/textareas and interactive inputs are recorded by the 'change' handler.
      if (tag === "select" || tag === "textarea") return;
      if (tag === "input") {
        const type = ((target as HTMLInputElement).type || "text").toLowerCase();
        if (["checkbox", "radio", "text", "password", "email", "search", "tel", "url", "number", "date"].indexOf(type) >= 0) return;
      }
      const g = generate(target);
      const label = g.accessibleName || tag || "element";
      record({ type: "click", name: "Click " + label, locator: g.locator });
    },
    true
  );

  window.addEventListener(
    "change",
    (event) => {
      const target = event.target as Element | null;
      if (!target) return;
      const tag = tagOf(target);
      if (tag !== "input" && tag !== "select" && tag !== "textarea") return;

      const g = generate(target);
      const label = g.accessibleName || (target as HTMLInputElement).name || tag;

      if (tag === "input") {
        const input = target as HTMLInputElement;
        const type = (input.type || "text").toLowerCase();
        if (type === "checkbox") {
          record({ type: input.checked ? "check" : "uncheck", name: (input.checked ? "Check " : "Uncheck ") + label, locator: g.locator });
        } else if (type === "radio") {
          if (input.checked) record({ type: "radio", name: "Select " + label, locator: g.locator });
        } else {
          // Never store password values in the recorded flow.
          const value = type === "password" ? "" : input.value;
          record({ type: "fill", name: "Fill " + label, locator: g.locator, valueSource: { type: "static", value } });
        }
      } else if (tag === "select") {
        record({ type: "select", name: "Select " + label, locator: g.locator, valueSource: { type: "static", value: (target as HTMLSelectElement).value } });
      } else {
        record({ type: "fill", name: "Fill " + label, locator: g.locator, valueSource: { type: "static", value: (target as HTMLTextAreaElement).value } });
      }
    },
    true
  );

  // Live text capture. The 'change' handler above only fires when a field loses focus, so text
  // typed into a field that never blurs (e.g. the user stops recording while still focused, or a
  // SPA re-renders the input) was previously lost. Record the value on every 'input' event too;
  // consecutive keystrokes on the same field are collapsed into a single fill by the recorder
  // binding (`RecorderService`), so this does not bloat the saved flow.
  window.addEventListener(
    "input",
    (event) => {
      const target = event.target as Element | null;
      if (!target) return;
      const tag = tagOf(target);
      if (tag !== "input" && tag !== "textarea") return;
      const type = tag === "input" ? ((target as HTMLInputElement).type || "text").toLowerCase() : "";
      // checkbox/radio fire 'input' too but are recorded as check/uncheck/radio by 'change'.
      if (type === "checkbox" || type === "radio") return;
      const g = generate(target);
      const label = g.accessibleName || (target as HTMLInputElement).name || tag;
      // Never store password values in the recorded flow.
      const value = type === "password" ? "" : (target as HTMLInputElement | HTMLTextAreaElement).value;
      record({ type: "fill", name: "Fill " + label, locator: g.locator, valueSource: { type: "static", value } });
    },
    true
  );
}

/**
 * Build the init-script *source string* injected into the recorded page.
 *
 * We serialize `installRecorderCapture` and wrap it in an IIFE that shims esbuild's
 * `__name` helper. Some toolchains (e.g. `tsx` with esbuild `keepNames`) wrap named
 * functions in `__name(fn, "…")`, and that helper is undefined in the page context —
 * which would silently prevent the capture listeners from installing. Injecting a
 * string via `addInitScript({ content })` with the shim makes injection robust
 * regardless of how the main process is bundled. When the bundler does not emit
 * `__name`, the shim is simply unused.
 */
export function getRecorderInitScriptContent(): string {
  return `(() => { var __name = (t) => t; (${installRecorderCapture.toString()})(); })();`;
}
