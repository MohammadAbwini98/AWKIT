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

  // Closed roots cannot be traversed by Playwright or exposed by document-level composedPath().
  // Record only which host requested mode:"closed"; never retain or expose the returned root.
  const closedShadowHosts = new WeakSet<Element>();
  const nativeAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init: ShadowRootInit): ShadowRoot {
    const root = nativeAttachShadow.call(this, init);
    if (init?.mode === "closed") closedShadowHosts.add(this);
    return root;
  };

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
      return queryAll(selector).length;
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

  const OPEN_ROOT_CAP = 128;
  const OPEN_ROOT_ELEMENT_CAP = 10_000;
  let activeQueryRoots: ParentNode[] = [document];
  let activeQueryTruncated = false;

  /** A bounded, per-generation snapshot of the document and recursively reachable open roots. */
  const collectOpenRoots = (start: ParentNode): ParentNode[] => {
    const roots: ParentNode[] = [];
    const pending: ParentNode[] = [start];
    const seen = new WeakSet<object>();
    let inspected = 0;
    while (pending.length && roots.length < OPEN_ROOT_CAP && inspected < OPEN_ROOT_ELEMENT_CAP) {
      const root = pending.shift()!;
      if (seen.has(root as object)) continue;
      seen.add(root as object);
      roots.push(root);
      let elements: Element[] = [];
      try {
        elements = Array.prototype.slice.call(root.querySelectorAll("*"));
      } catch {
        continue;
      }
      for (let index = 0; index < elements.length && inspected < OPEN_ROOT_ELEMENT_CAP; index += 1) {
        inspected += 1;
        const shadow = (elements[index] as HTMLElement).shadowRoot;
        if (shadow?.mode === "open" && !seen.has(shadow)) pending.push(shadow);
      }
    }
    // Conservative by design: reaching either cap means uniqueness was not proven over the whole
    // reachable tree, even when the final inspected root happened to end exactly at the limit.
    activeQueryTruncated = pending.length > 0 || roots.length >= OPEN_ROOT_CAP || inspected >= OPEN_ROOT_ELEMENT_CAP;
    return roots;
  };

  const queryAll = (selector: string, roots: ParentNode[] = activeQueryRoots): Element[] => {
    const out: Element[] = [];
    for (let index = 0; index < roots.length; index += 1) {
      try {
        const matches = roots[index].querySelectorAll(selector);
        for (let match = 0; match < matches.length; match += 1) out.push(matches[match]);
      } catch {
        return [];
      }
    }
    return out;
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
        const root = el.getRootNode() as ParentNode;
        const lab = root.querySelector('label[for="' + esc(id) + '"]');
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
        const root = el.getRootNode() as Document | ShadowRoot;
        const ref = typeof root.getElementById === "function" ? root.getElementById(id) : null;
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
  const elementsForRole = (role: string): Element[] => {
    const out: Element[] = [];
    for (let index = 0; index < activeQueryRoots.length; index += 1) {
      out.push(...elementsForRoleIn(activeQueryRoots[index], role));
    }
    return out;
  };

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
      controls = queryAll("input, select, textarea, [role=textbox], [role=combobox]");
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
    let all: Element[];
    try {
      all = queryAll("*");
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
          const list = queryAll(selector);
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
          freq = queryAll("." + ident(c)).length || 999;
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
  const buildCandidates = (el: Element, allowPositional = true): Candidate[] => {
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
    if (scoped && (allowPositional || scoped.value.indexOf(":nth-") < 0)) {
      out.push({ strategy: "css", value: scoped.value, count: scoped.count });
    }

    // Compound "tree": meaningful features across the element + fewest distinguishing ancestors.
    // Non-fallback only when it reached a single match via features (so it wins over positional).
    const compound = compoundSelector(el);
    if (compound) out.push({ strategy: "css", value: compound.value, count: compound.count, fallback: compound.count !== 1 || compound.positional });

    // Guaranteed-unique hybrid anchored at the nearest stable ancestor.
    const anchored = allowPositional ? anchoredStructural(el) : null;
    if (anchored) out.push({ strategy: "css", value: anchored.value, count: anchored.count, fallback: true });

    const structural = allowPositional ? structuralSelector(el) : "";
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
    visibleMatchCount?: number;
    confidence: string;
    warning?: string;
    candidateCount: number;
    /** How uniqueness was achieved when no single strategy was unique. */
    disambiguation?: string;
  }

  interface ContainerContext {
    type: "dialog" | "tableRow" | "card" | "listItem" | "landmark";
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
    const tag = tagOf(node);
    if (["nav", "main", "header", "footer", "aside", "form", "section"].indexOf(tag) >= 0) return { type, strategy: "css", value: tag };
    const href = attr(node, "href");
    if (href) return { type, strategy: "css", value: tag + '[href="' + esc(href) + '"]' };
    return null;
  };

  // The accessible name of a `role=row` is the ACCESSIBLE NAMES of its cells joined by a SPACE
  // (ARIA name-from-content). Raw `row.textContent` concatenates adjacent cells with NO separator
  // ("Customer Beta" + "Edit" → "Customer BetaEdit"), which never matches `getByRole('row', {name})`
  // on replay — the platform computes "Customer Beta Edit". Join the row's direct-child cells with a
  // space so the captured row name matches the name the runner searches by. (Cards use `hasText`,
  // which matches `textContent` against `textContent`, so they are already self-consistent and are
  // deliberately left alone.)
  const rowAccessibleName = (row: Element): string => {
    let cells: Element[] = [];
    try {
      cells = Array.prototype.slice.call(
        row.querySelectorAll(':scope > td, :scope > th, :scope > [role="cell"], :scope > [role="gridcell"], :scope > [role="columnheader"], :scope > [role="rowheader"]')
      );
    } catch {
      cells = [];
    }
    if (!cells.length) return norm(row.textContent);
    const parts: string[] = [];
    for (let i = 0; i < cells.length; i += 1) {
      const t = norm(cells[i].textContent);
      if (t) parts.push(t);
    }
    return norm(parts.join(" "));
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
      const name = rowAccessibleName(row).slice(0, 80);
      if (name) return { type: "tableRow", strategy: "role", value: "row", name, exact: false };
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

    const landmark = el.closest('nav, main, header, footer, aside, form, section, [role="navigation"], [role="main"], [role="banner"], [role="contentinfo"], [role="complementary"], [role="form"], [role="region"]');
    if (landmark && landmark !== el) {
      const base = describeContainer(landmark, "landmark");
      if (base) return base;
    }

    const link = el.closest('a[href]');
    if (link && link !== el) {
      const href = attr(link, "href");
      if (href) return { type: "landmark", strategy: "css", value: 'a[href="' + esc(href) + '"]' };
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

  /** Match one recorder candidate inside one concrete root using the same normalization policy. */
  const candidateElementsIn = (root: ParentNode, cand: { strategy: string; value: string; name?: string }): Element[] => {
    if (cand.strategy === "role" || cand.strategy === "label" || cand.strategy === "placeholder" || cand.strategy === "text") {
      return semanticElementsIn(root, { ...cand, count: 0 });
    }
    try {
      if (cand.strategy === "testId") return Array.prototype.slice.call(root.querySelectorAll('[data-testid="' + esc(cand.value) + '"]'));
      if (cand.strategy === "id") return Array.prototype.slice.call(root.querySelectorAll("#" + ident(cand.value)));
      if (cand.strategy === "css" || cand.strategy === "tagName") return Array.prototype.slice.call(root.querySelectorAll(cand.value));
    } catch {
      return [];
    }
    return [];
  };

  const isVisibleMatch = (element: Element): boolean => {
    try {
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch {
      return false;
    }
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

  interface GenerateOptions {
    root?: ParentNode;
    allowPositional?: boolean;
    includeContext?: boolean;
  }

  const generate = (el: Element, options: GenerateOptions = {}): { locator: Record<string, unknown>; quality: Quality; accessibleName: string; traversalComplete: boolean } => {
    activeQueryRoots = collectOpenRoots(options.root ?? document);
    const traversalComplete = !activeQueryTruncated;
    const candidates = buildCandidates(el, options.allowPositional !== false);

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
      visibleMatchCount: containerScoped
        ? 1
        : activeQueryRoots.reduce((count, root) => count + candidateElementsIn(root, chosen!).filter(isVisibleMatch).length, 0),
      confidence,
      candidateCount: candidates.length
    };
    if (!traversalComplete) {
      quality.isUnique = false;
      quality.warning = "Shadow-aware locator matching reached its bounded traversal limit. Review is required before replay.";
    }
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

    const context = options.includeContext === false ? undefined : detectContext(el, chosen.count);
    if (context) locator.context = context;

    return { locator, quality, accessibleName: accessibleName(el), traversalComplete };
  };

  /**
   * The element that OWNS the action, not the pixel the pointer happened to hit. A control is
   * routinely authored as `<button aria-label="Next"><div><svg/></div></button>`, so the composed-path
   * leaf is an unlabelled wrapper while the accessible name lives on an ancestor. Climbing first is
   * what lets the semantic strategies produce anything at all.
   *
   * The generic `[role]` and `[tabindex]` entries matter: without them `role="tab"`, `"menuitem"`,
   * `"option"`, `"switch"`, `"slider"` and `"treeitem"` never climbed, so a click inside any of them
   * generated candidates from the inner span and fell through to positional CSS.
   */
  const ACTION_OWNER_SELECTOR =
    'a[href], button, input, select, textarea, label, summary, [role], [aria-label], [onclick], [tabindex]:not([tabindex="-1"]), [contenteditable="true"], [contenteditable=""]';

  const interactiveTarget = (el: Element): Element => {
    let candidate: Element | null = el;
    while (candidate) {
      const tag = tagOf(candidate);
      if (candidate.matches?.(ACTION_OWNER_SELECTOR) || tag.indexOf("-") > 0) return candidate;
      candidate = candidate.parentElement;
    }
    return el;
  };

  /**
   * The bar a locator must clear to be PERSISTED as a trigger, matching `hostDescriptor` below.
   * `isUnique` alone is not enough: a positional selector resolves to exactly one element today and
   * breaks on the next layout change, which is precisely how a fragile `nth-child` chain came to be
   * saved as a hover trigger.
   */
  const isStableGenerated = (generated: ReturnType<typeof generate>): boolean =>
    generated.quality.isUnique &&
    generated.traversalComplete &&
    generated.quality.strategy !== "fallback" &&
    generated.locator.strategy !== "xpath";

  interface ShadowCapture {
    boundary: "none" | "open" | "closed" | "unknown";
    hosts: Array<Record<string, unknown>>;
    innermostRoot?: ShadowRoot;
    valid: boolean;
    reason?: string;
  }

  const firstPathElement = (event: Event): Element | null => {
    if (typeof event.composedPath === "function") {
      const path = event.composedPath();
      for (let index = 0; index < path.length; index += 1) {
        const item = path[index] as Node;
        if (item && item.nodeType === 1) return item as Element;
      }
    }
    const target = event.target as Node | null;
    return target?.nodeType === 1 ? (target as Element) : null;
  };

  const hostDescriptor = (host: Element, parentRoot: ParentNode): { descriptor: Record<string, unknown>; valid: boolean; traversalComplete: boolean } => {
    const generated = generate(host, { root: parentRoot, allowPositional: false, includeContext: false });
    const locator = generated.locator;
    const descriptor: Record<string, unknown> = {
      strategy: locator.strategy,
      value: locator.value,
      quality: generated.quality
    };
    if (locator.name) descriptor.name = locator.name;
    if (locator.exact) descriptor.exact = locator.exact;
    if (locator.alternatives) descriptor.alternatives = locator.alternatives;
    const valid =
      generated.quality.isUnique &&
      generated.traversalComplete &&
      generated.quality.strategy !== "fallback" &&
      locator.strategy !== "xpath";
    return { descriptor, valid, traversalComplete: generated.traversalComplete };
  };

  const captureShadow = (event: Event, target: Element): ShadowCapture => {
    const pathTarget = firstPathElement(event);
    if (pathTarget && closedShadowHosts.has(pathTarget)) {
      const parentRoot = pathTarget.getRootNode() as ParentNode;
      const host = hostDescriptor(pathTarget, parentRoot);
      return {
        boundary: "closed",
        hosts: host.valid ? [host.descriptor] : [],
        valid: false,
        reason: "closed shadow root"
      };
    }

    const innerToOuter: Array<{ root: ShadowRoot; host: Element }> = [];
    let node: Element = target;
    while (true) {
      const root = node.getRootNode();
      if (!(root instanceof ShadowRoot) || root.mode !== "open") break;
      innerToOuter.push({ root, host: root.host });
      node = root.host;
    }
    if (!innerToOuter.length) return { boundary: "none", hosts: [], valid: true };

    const hosts: Array<Record<string, unknown>> = [];
    let valid = true;
    let traversalComplete = true;
    const outerToInner = innerToOuter.slice().reverse();
    for (let index = 0; index < outerToInner.length; index += 1) {
      const boundary = outerToInner[index];
      const described = hostDescriptor(boundary.host, boundary.host.getRootNode() as ParentNode);
      hosts.push(described.descriptor);
      if (!described.valid) valid = false;
      if (!described.traversalComplete) traversalComplete = false;
    }
    return {
      boundary: "open",
      hosts,
      innermostRoot: innerToOuter[0].root,
      valid,
      reason: valid ? undefined : (traversalComplete ? "ambiguous shadow host context" : "shadow traversal limit reached")
    };
  };

  const generateForEvent = (event: Event, interactive: boolean): { target: Element; generated: ReturnType<typeof generate>; shadow: ShadowCapture } | null => {
    const raw = firstPathElement(event);
    if (!raw) return null;
    const target = interactive ? interactiveTarget(raw) : raw;
    const targetRoot = target.getRootNode();
    const isOpenInternal = targetRoot instanceof ShadowRoot && targetRoot.mode === "open";
    const generated = generate(target, { allowPositional: !isOpenInternal && !closedShadowHosts.has(raw) });
    const shadow = captureShadow(event, target);
    if (shadow.boundary !== "none") {
      const existingContext = (generated.locator.context as Record<string, unknown> | undefined) ?? {};
      generated.locator.context = {
        ...existingContext,
        shadow: { boundary: shadow.boundary, hosts: shadow.hosts }
      };
    }
    if (shadow.boundary === "open") {
      const candidate = {
        strategy: String(generated.locator.strategy || ""),
        value: String(generated.locator.value || ""),
        name: typeof generated.locator.name === "string" ? generated.locator.name : undefined
      };
      const local = shadow.innermostRoot ? candidateElementsIn(shadow.innermostRoot, candidate) : [];
      const targetIsUnique = local.length === 1 && local[0] === target;
      if (shadow.valid && generated.traversalComplete && targetIsUnique && candidate.strategy !== "xpath") {
        generated.quality.isUnique = true;
        generated.quality.matchCount = 1;
        generated.quality.visibleMatchCount = 1;
        generated.quality.disambiguation = "shadow";
        generated.quality.warning = undefined;
        generated.locator.resolution = "resolved";
        generated.locator.resolvedBy = "recorder";
      } else {
        generated.quality.isUnique = false;
        generated.quality.warning = "The shadow-host chain or target locator is not unique. Review is required before replay.";
        generated.locator.resolution = "needs-review";
        generated.locator.resolvedBy = "recorder";
        generated.locator.reviewReason = !generated.traversalComplete
          ? "shadow traversal limit reached"
          : (shadow.reason ?? "ambiguous shadow target");
      }
    } else if (shadow.boundary === "closed") {
      generated.locator.resolution = "needs-review";
      generated.locator.resolvedBy = "recorder";
      generated.locator.reviewReason = "closed shadow root";
      generated.quality.warning = "The interaction originated inside a closed shadow root and cannot be replayed automatically.";
    }
    activeQueryRoots = collectOpenRoots(document);
    return { target, generated, shadow };
  };

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

  const visibilityState = new WeakMap<Element, boolean>();

  /**
   * Where the pointer was when a control that was HIDDEN AT REST was first observed visible.
   * `null` records "the pointer was nowhere recent", which is what a timer-driven reveal looks like.
   *
   * This is what separates a hover-CAUSED reveal from one that merely happened while the pointer was
   * parked nearby. Adjacency and recency alone are correlation: a pointer resting on a sibling when
   * an unrelated timer fires satisfies both. Only the reveal moment answers "did the hover do this?".
   */
  const revealWitness = new WeakMap<Element, Element | null>();
  /**
   * How fresh the pointer evidence must be at the reveal moment. A CSS `:hover` reveal changes no
   * attribute, so it is caught by the 150ms sweep rather than the MutationObserver — the sample that
   * caused it is therefore at most about one sweep old. A pointer that has been parked longer than
   * this did not cause the reveal it happens to coincide with.
   */
  const REVEAL_POINTER_WINDOW_MS = 300;

  // ── Trusted pointer trail (hover-trigger attribution) ───────────────────────────────────────
  // Record where the pointer has recently been so a hover-gated click can be attributed to the
  // element the user actually hovered — never the hidden surface that hover revealed. Only trusted
  // (real-input) events count; synthetic events must not fabricate a trigger.
  interface PointerSample {
    el: Element;
    x: number;
    y: number;
    ts: number;
  }
  const pointerTrail: PointerSample[] = [];
  const POINTER_TRAIL_MAX = 24;
  const recordPointer = (event: Event): void => {
    try {
      if (!event.isTrusted) return;
      const el = event.target as Element | null;
      if (!el || el.nodeType !== 1) return;
      const me = event as MouseEvent;
      pointerTrail.push({ el, x: Math.round(me.clientX), y: Math.round(me.clientY), ts: Date.now() });
      if (pointerTrail.length > POINTER_TRAIL_MAX) pointerTrail.shift();
    } catch {
      /* ignore */
    }
  };
  try {
    window.addEventListener("pointerover", recordPointer, true);
    window.addEventListener("mouseover", recordPointer, true);
    let lastMoveSampleTs = 0;
    window.addEventListener(
      "pointermove",
      (event) => {
        const now = Date.now();
        if (now - lastMoveSampleTs < 60) return; // throttle continuous movement
        lastMoveSampleTs = now;
        recordPointer(event);
      },
      true
    );
  } catch {
    /* ignore */
  }

  /** True when the pointer trail shows the pointer entered `el` (or an ancestor/descendant of it). */
  const pointerVisited = (el: Element): boolean =>
    pointerTrail.some((s) => s.el === el || el.contains(s.el) || s.el.contains(el));
  /** Elements too broad to ever be a specific hover trigger. */
  const isBroadTrigger = (el: Element): boolean => {
    const t = tagOf(el);
    return t === "html" || t === "body" || t === "main";
  };
  /** Landmark containers: only acceptable as a trigger when the pointer landed on them exactly. */
  const isLandmark = (el: Element): boolean => {
    const t = tagOf(el);
    const role = attr(el, "role");
    return (
      t === "nav" ||
      t === "header" ||
      t === "footer" ||
      t === "aside" ||
      role === "navigation" ||
      role === "menubar" ||
      role === "banner" ||
      role === "region"
    );
  };

  // The result of attributing a hover-gated reveal to the element that caused it.
  type HoverResolution =
    | { kind: "trigger"; el: Element } // a stable, unique, on-path visible trigger was identified
    | { kind: "review" } //   a container was revealed on hover but no stable trigger could be pinned
    | { kind: "none" }; //     the target was not hover-gated by a revealed container (e.g. async self-toggle)

  /**
   * How recently the pointer must have rested on an adjacent sibling for that sibling to be accepted
   * as the cause of a reveal. A reveal the pointer explains only from minutes ago is not evidence.
   */
  const SIBLING_HOVER_RECENCY_MS = 2000;

  /**
   * Attribute a reveal to an ADJACENT SIBLING trigger — `.trigger:hover + .target { display:block }`
   * and its `~` / JS-driven equivalents (`awkit-vot`), where the element that owns the hover is NOT an
   * ancestor of the surface it reveals. The ancestor walk in `resolveHoverTrigger` cannot see these:
   * when the revealed surface is the click target itself there is no hidden ancestor run at all, and
   * when there is one, the first visible-at-rest ancestor is the enclosing wrapper — which merely
   * CONTAINS the trigger rather than being it, so hovering it does not reliably reproduce the reveal.
   *
   * Evidence, not inference. The only accepted candidate is the LAST place the pointer rested before
   * it entered the revealed surface: anything earlier in the trail is somewhere the pointer passed
   * through, not the thing it hovered to open this. That candidate must also be a sibling subtree of
   * the revealed root, recent, visible at rest, and resolvable to a stable non-positional locator.
   *
   * Returns `null` for "no sibling evidence at all", so the caller keeps its existing behaviour
   * (`none` for an independent async self-reveal, `review` for an unattributable ancestor reveal)
   * rather than having this path invent an answer for a case it knows nothing about.
   */
  const resolveSiblingHoverTrigger = (revealedRoot: Element, target: Element): HoverResolution | null => {
    const parent = revealedRoot.parentElement;
    if (!parent) return null;

    // Was the pointer anywhere when this actually became visible? Only scanned controls carry a
    // witness, so fall back to the clicked control when the revealed root is a plain container.
    const witness = revealWitness.has(revealedRoot) ? revealWitness.get(revealedRoot) : revealWitness.get(target);
    // No witness recorded means the reveal was never observed happening (it predates the baseline
    // scan); a null witness means the pointer was nowhere near it at the time. Neither is evidence
    // of a hover, and inventing a trigger from a coincidence is the failure mode this guards.
    if (!witness) return null;

    // The most recent pointer sample OUTSIDE the revealed surface. Samples inside it are where the
    // pointer went after the reveal — an effect of the hover, never its cause.
    let sample: PointerSample | null = null;
    for (let i = pointerTrail.length - 1; i >= 0; i -= 1) {
      if (revealedRoot.contains(pointerTrail[i].el)) continue;
      sample = pointerTrail[i];
      break;
    }
    if (!sample) return null;
    if (Date.now() - sample.ts > SIBLING_HOVER_RECENCY_MS) return null;

    // That sample must sit in a SIBLING subtree of the revealed root — the adjacency the CSS encodes.
    let sibling: Element | null = sample.el;
    while (sibling && sibling.parentElement !== parent) sibling = sibling.parentElement;
    if (!sibling || sibling === revealedRoot) return null;
    // …and it must be the same subtree the pointer was in when the reveal was observed. A pointer
    // that moved on between causing nothing and clicking has not identified a trigger.
    if (witness !== sibling && !sibling.contains(witness)) return null;

    // From here the pointer evidence is real: the click IS hover-gated and the pointer was last on an
    // adjacent sibling. Anything that fails below is a review item, never a silently dropped
    // prerequisite and never a fabricated trigger.
    const candidate = interactiveTarget(sample.el);
    // Promotion must not escape the sibling subtree. Walking out into the shared wrapper would
    // re-introduce the container guess this path exists to avoid.
    if (!sibling.contains(candidate)) return { kind: "review" };
    if (visibilityState.get(candidate) !== true) return { kind: "review" };
    if (isBroadTrigger(candidate)) return { kind: "review" };
    if (isLandmark(candidate) && !pointerTrail.some((s) => s.el === candidate)) return { kind: "review" };
    if (!isStableGenerated(generate(candidate, { allowPositional: false }))) return { kind: "review" };
    return { kind: "trigger", el: candidate };
  };

  /**
   * Identify the visible element the pointer hovered to reveal `target`. Never returns the hidden
   * revealed surface (or its hidden descendants), never an unconditional immediate parent, and never
   * a broad landmark unless the pointer landed on it exactly. Uses only observed pointer evidence and
   * record-time first-seen (rest) visibility — no speculative re-hovering of the live page.
   */
  const resolveHoverTrigger = (target: Element, event: Event): HoverResolution => {
    if (!event.composedPath) return { kind: "none" };
    const path = (event.composedPath() as EventTarget[]).filter(
      (n): n is Element => !!n && (n as Node).nodeType === 1
    );
    let ti = path.indexOf(target);
    if (ti < 0) ti = 0;

    // Skip the contiguous run of ancestors that were HIDDEN at rest — the surface hover revealed.
    let revealedSurfaceCount = 0;
    let i = ti + 1;
    for (; i < path.length; i += 1) {
      if (visibilityState.get(path[i]) === false) {
        revealedSurfaceCount += 1;
        continue;
      }
      break;
    }
    // The hidden surface hover exposed: the topmost ancestor in the hidden run, or — when there is no
    // hidden ancestor at all — the target itself, which is then the thing hover revealed.
    const revealedRoot = revealedSurfaceCount > 0 ? path[i - 1] : target;

    // No hidden ancestor container was revealed. Either an adjacent-sibling reveal
    // (`.trigger:hover + .target`, where the revealed surface IS the control) or the target toggled
    // on its own (async self-reveal). Only the first is attributable; the second must stay silent.
    if (revealedSurfaceCount === 0) return resolveSiblingHoverTrigger(revealedRoot, target) ?? { kind: "none" };

    /**
     * The ancestor walk could not pin a trigger. Before settling for review, check whether the
     * pointer evidence explains the reveal through an adjacent sibling instead — a sibling-driven
     * reveal inside a wrapper reaches here whenever the wrapper itself is not stably locatable.
     * A sibling answer of `review` is the same verdict, so only a positive attribution changes it.
     */
    const reviewOrSibling = (): HoverResolution => {
      const sibling = resolveSiblingHoverTrigger(revealedRoot, target);
      return sibling && sibling.kind === "trigger" ? sibling : { kind: "review" };
    };

    if (i >= path.length) return reviewOrSibling();

    const pathCandidate = path[i];

    // The path candidate is chosen by VISIBILITY topology — the first ancestor visible at rest above
    // the revealed run — which says nothing about whether it is the element that owns the hover.
    // Promote it to its nearest actionable ancestor, because that is where an accessible name lives.
    // The action owner is authoritative. Comparing it with the wrapper's default `generate()` result
    // is unsafe because `scopedSelector()` can make an `:nth-of-type(...)` wrapper unique and label
    // that compound CSS as medium-confidence. That is still positional and is rejected by the runner.
    const candidate = interactiveTarget(pathCandidate);

    // The trigger must be known-visible at rest (proves it existed before the reveal), on the pointer
    // trail, specific (not a broad root / bare landmark), and resolvable to a STABLE locator.
    if (visibilityState.get(candidate) !== true) return reviewOrSibling();
    if (isBroadTrigger(candidate)) return reviewOrSibling();
    if (isLandmark(candidate) && !pointerTrail.some((s) => s.el === candidate)) return reviewOrSibling();
    if (!pointerVisited(candidate)) return reviewOrSibling();
    // Uniqueness alone would admit a positional `nth-child` chain that breaks on the next layout
    // change. A trigger we cannot pin semantically is a review item, not a saved fragile locator.
    if (!isStableGenerated(generate(candidate, { allowPositional: false }))) return reviewOrSibling();
    return { kind: "trigger", el: candidate };
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
        (Array.prototype.slice.call(document.querySelectorAll("a, button, input, select, textarea, [role=button], [role=menuitem]")) as Element[]).forEach((el) => {
          if (!visibilityState.has(el)) {
            visibilityState.set(el, isVisible(el));
          } else if (visibilityState.get(el) === false && !revealWitness.has(el) && isVisible(el)) {
            // First time this hidden-at-rest control has been seen visible: record where the pointer
            // was, so a sibling reveal can be attributed to the hover that caused it (`awkit-vot`).
            const last = pointerTrail.length ? pointerTrail[pointerTrail.length - 1] : null;
            revealWitness.set(el, last && now - last.ts <= REVEAL_POINTER_WINDOW_MS ? last.el : null);
          }
          // Also record first-seen (rest) visibility of the element's ancestor chain, so a hover-gated
          // reveal can distinguish the hidden surface it exposes from the always-visible trigger above
          // it. Bounded, and stops at the first already-recorded ancestor (its chain is already done).
          let anc = el.parentElement;
          for (let d = 0; anc && d < 8; d += 1) {
            if (visibilityState.has(anc)) break;
            visibilityState.set(anc, isVisible(anc));
            anc = anc.parentElement;
          }

          if (tagOf(el) !== "a" && attr(el, "role") !== "menuitem") {
            const disabled = (el as HTMLInputElement).disabled === true || attr(el, "aria-disabled") === "true";
            const was = disabledState.get(el);
            if (!silent && was === true && !disabled) {
              signal({ kind: "enabled", locator: waitLocatorFor(el), ts: now });
            }
            disabledState.set(el, disabled);
          }
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

  // Fields whose captured value must be redacted so secrets never enter the recorded flow
  // (audit F-07). Password fields were always redacted; this also covers OTP/one-time-code,
  // card number, CVV/CVC/CSC, PIN, SSN and similar, identified by type/autocomplete/name/id/
  // aria-label/placeholder.
  const SENSITIVE_FIELD_PATTERN =
    /otp|one[-_ ]?time|passcode|\bpin\b|\bcvv\b|\bcvc\b|\bcsc\b|card[-_ ]?number|cardnumber|credit[-_ ]?card|\bssn\b|social[-_ ]?security|\bsecret\b|\btoken\b/i;
  function shouldRedactValue(el: Element, type: string): boolean {
    if (type === "password") return true;
    const ac = (el.getAttribute("autocomplete") || "").toLowerCase();
    if (ac === "one-time-code" || ac.indexOf("cc-number") >= 0 || ac.indexOf("cc-csc") >= 0) return true;
    const hay = [
      el.getAttribute("name") || "",
      el.id || "",
      el.getAttribute("aria-label") || "",
      el.getAttribute("placeholder") || "",
      ac
    ].join(" ");
    // Several terms above are anchored with \b so "pin" does not fire on "shipping". But a word
    // boundary needs a NON-word character, and the two dominant field-naming conventions supply a
    // word character instead: `apiToken` (camelCase) and `api_token` (snake_case) both put a word
    // char immediately before the term, so \btoken\b never matched either. That silently exempted
    // apiToken / accessToken / refreshToken / clientSecret / devicePin / userSsn / cardCvv — some
    // of the most common secret field names on the web. Insert a separator at each camelCase
    // boundary and treat `_` as one, so the anchors mean what they were written to mean.
    const normalized = hay.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ");
    return SENSITIVE_FIELD_PATTERN.test(normalized);
  }

  const captureInteraction = (
    event: Event,
    target: Element,
    g: { locator: Record<string, unknown>; quality: Quality },
    shadow?: ShadowCapture
  ): Record<string, unknown> => {
    const interaction: Record<string, unknown> = {};
    if (event instanceof MouseEvent) {
      interaction.x = Math.round(event.clientX);
      interaction.y = Math.round(event.clientY);
    }
    if (event.composedPath) {
      const path = event.composedPath();
      const tags = [];
      for (let i = 0; i < path.length; i++) {
        const n = path[i] as Element;
        if (n.nodeType === 1 && typeof n.tagName === "string") {
          tags.push(n.tagName.toLowerCase());
        }
      }
      interaction.path = tags;
    }
    if (shadow && shadow.boundary !== "none") interaction.shadowBoundary = shadow.boundary;
    if (!g.quality.isUnique && g.locator.strategy === "css" && typeof g.locator.value === "string") {
      try {
        const matches = queryAll(g.locator.value);
        for (let i = 0; i < matches.length; i++) {
          if (matches[i] === target) {
            interaction.matchIndex = i;
            break;
          }
        }
      } catch {
        /* ignore */
      }
    }
    if (visibilityState.get(target) === false) {
      // Hidden at rest. Attribute the reveal to the element the pointer actually hovered.
      const hover = resolveHoverTrigger(target, event);
      if (hover.kind === "trigger") {
        interaction.requiresHover = true;
        interaction.hoverContainer = generate(hover.el).locator;
      } else if (hover.kind === "review") {
        // A container was revealed on hover, but no stable trigger could be pinned. Flag for review
        // instead of emitting a hover step that cannot replay.
        interaction.requiresHover = true;
        interaction.hoverUnresolved = true;
      }
      // hover.kind === "none": target toggled independently of a hover trigger — no hover step.
    }
    return interaction;
  };

  window.addEventListener(
    "click",
    (event) => {
      const captured = generateForEvent(event, true);
      if (!captured) return;
      const { target, generated: g, shadow } = captured;
      const tag = tagOf(target);
      // Selects/textareas and interactive inputs are recorded by the 'change' handler.
      if (tag === "select" || tag === "textarea") return;
      if (tag === "input") {
        const type = ((target as HTMLInputElement).type || "text").toLowerCase();
        if (["checkbox", "radio", "text", "password", "email", "search", "tel", "url", "number", "date"].indexOf(type) >= 0) return;
      }
      const label = g.accessibleName || tag || "element";
      const interaction = captureInteraction(event, target, g, shadow);
      record({ type: "click", name: "Click " + label, locator: { ...g.locator, interaction } });
    },
    true
  );

  window.addEventListener(
    "change",
    (event) => {
      const captured = generateForEvent(event, false);
      if (!captured) return;
      const { target, generated: g, shadow } = captured;
      const tag = tagOf(target);
      if (tag !== "input" && tag !== "select" && tag !== "textarea") return;

      const label = g.accessibleName || (target as HTMLInputElement).name || tag;
      const interaction = captureInteraction(event, target, g, shadow);
      const locator = { ...g.locator, interaction };

      if (tag === "input") {
        const input = target as HTMLInputElement;
        const type = (input.type || "text").toLowerCase();
        if (type === "checkbox") {
          record({ type: input.checked ? "check" : "uncheck", name: (input.checked ? "Check " : "Uncheck ") + label, locator });
        } else if (type === "radio") {
          if (input.checked) record({ type: "radio", name: "Select " + label, locator });
        } else {
          // Never store sensitive field values (password/OTP/card/…) in the recorded flow.
          const value = shouldRedactValue(input, type) ? "" : input.value;
          record({ type: "fill", name: "Fill " + label, locator, valueSource: { type: "static", value } });
        }
      } else if (tag === "select") {
        record({ type: "select", name: "Select " + label, locator, valueSource: { type: "static", value: (target as HTMLSelectElement).value } });
      } else {
        record({ type: "fill", name: "Fill " + label, locator, valueSource: { type: "static", value: (target as HTMLTextAreaElement).value } });
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
      const captured = generateForEvent(event, false);
      if (!captured) return;
      const { target, generated: g, shadow } = captured;
      const tag = tagOf(target);
      if (tag !== "input" && tag !== "textarea") return;
      const type = tag === "input" ? ((target as HTMLInputElement).type || "text").toLowerCase() : "";
      // checkbox/radio fire 'input' too but are recorded as check/uncheck/radio by 'change'.
      if (type === "checkbox" || type === "radio") return;
      const label = g.accessibleName || (target as HTMLInputElement).name || tag;
      const interaction = captureInteraction(event, target, g, shadow);
      const locator = { ...g.locator, interaction };
      // Never store sensitive field values (password/OTP/card/…) in the recorded flow.
      const value = shouldRedactValue(target, type) ? "" : (target as HTMLInputElement | HTMLTextAreaElement).value;
      record({ type: "fill", name: "Fill " + label, locator, valueSource: { type: "static", value } });
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
