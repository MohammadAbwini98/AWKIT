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
  // Open roots created after install are queued here for the insertion observer (awkit-0vm); a
  // childList mutation inside a shadow root is invisible to a document-level observer. Bounded when
  // drained, and holding a root that already exists on the page adds no new retention.
  const queuedShadowRoots: ShadowRoot[] = [];
  w.__awtkitPendingShadowRoots = queuedShadowRoots;
  // Closed roots retarget composedPath for outside listeners, so the recorder must attach its capture
  // handlers INSIDE each closed root to observe internal interactions (Phase C2). Roots created before
  // the handlers exist are queued and drained once `installClosedRootCapture` is assigned during setup.
  // The wrap never changes the requested `mode`.
  const closedRootsPendingCapture: ShadowRoot[] = [];
  let installClosedRootCapture: ((root: ShadowRoot) => void) | null = null;
  const nativeAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init: ShadowRootInit): ShadowRoot {
    const root = nativeAttachShadow.call(this, init);
    if (init?.mode === "closed") {
      closedShadowHosts.add(this);
      if (installClosedRootCapture) installClosedRootCapture(root);
      else if (closedRootsPendingCapture.length < 256) closedRootsPendingCapture.push(root);
    } else if (queuedShadowRoots.length < 256) {
      queuedShadowRoots.push(root);
    }
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
    if (/__[A-Za-z0-9]*\d[A-Za-z0-9]*$/.test(id)) return true; // CSS-module hashed suffix (Header_root__2x9Yt)
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
    img: "img[alt], [role=img]",
    row: "tr, [role=row]",
    listitem: "li, [role=listitem]",
    article: "article, [role=article]"
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
    // CSS-module hashed class (Button_primary__3xKz9): a `__`-delimited suffix that contains a digit.
    // Pure-word BEM elements (card__title) carry no digit and remain meaningful.
    if (/__[A-Za-z0-9]*\d[A-Za-z0-9]*$/.test(c)) return false;
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

  // ── Guarded-positional capture ──────────────────────────────────────────────────────────────────
  // Identity fingerprint of the clicked element, computed IN-PAGE from the exact target (never a
  // re-resolved locator, which for a positional twin could pick the wrong one). This is a byte-for-byte
  // copy of the runner's `createPageFingerprint` (src/runner/locatorFingerprint.ts); `verify:fingerprint-parity`
  // asserts they stay identical, since the guard compares a capture-time fingerprint to a runtime one.
  const computeFingerprint = (element: Element): Record<string, unknown> => {
    const tag = element.tagName.toLocaleLowerCase();
    const type = (element.getAttribute("type") || "").replace(/\s+/g, " ").trim().toLocaleLowerCase().slice(0, 160);
    const explicitRole = (element.getAttribute("role") || "").replace(/\s+/g, " ").trim().toLocaleLowerCase().slice(0, 160);
    const implicitRole =
      tag === "button" ? "button"
      : tag === "a" && element.hasAttribute("href") ? "link"
      : tag === "select" ? "combobox"
      : tag === "textarea" ? "textbox"
      : tag === "input" && ["button", "submit", "reset"].indexOf(type) >= 0 ? "button"
      : tag === "input" && type === "checkbox" ? "checkbox"
      : tag === "input" && type === "radio" ? "radio"
      : tag === "input" ? "textbox"
      : "";
    let controlLabels = "";
    if ("labels" in element) {
      const labels = (element as HTMLInputElement).labels;
      if (labels) {
        for (let index = 0; index < labels.length; index += 1) controlLabels += " " + (labels[index].textContent || "");
      }
    }
    const text = (element.textContent || "").replace(/\s+/g, " ").trim().toLocaleLowerCase().slice(0, 160);
    const rawName =
      element.getAttribute("aria-label") || controlLabels || element.getAttribute("alt") ||
      element.getAttribute("placeholder") || element.getAttribute("title") || text;
    const name = rawName.replace(/\s+/g, " ").trim().toLocaleLowerCase().slice(0, 160);
    const attributes: Record<string, string> = {};
    const attrKeys = ["id", "name", "type", "placeholder", "data-testid", "aria-label"];
    for (let i = 0; i < attrKeys.length; i += 1) {
      const value = (element.getAttribute(attrKeys[i]) || "").replace(/\s+/g, " ").trim().toLocaleLowerCase().slice(0, 160);
      if (value) attributes[attrKeys[i]] = value;
    }
    const ancestry: string[] = [];
    let parent = element.parentElement;
    while (parent && ancestry.length < 3) {
      let ancestor = parent.tagName.toLocaleLowerCase();
      const parentRole = (parent.getAttribute("role") || "").replace(/\s+/g, " ").trim().toLocaleLowerCase().slice(0, 160);
      const parentId = (parent.getAttribute("id") || "").replace(/\s+/g, " ").trim().toLocaleLowerCase().slice(0, 160);
      const parentTestId = (parent.getAttribute("data-testid") || "").replace(/\s+/g, " ").trim().toLocaleLowerCase().slice(0, 160);
      if (parentRole) ancestor += "|" + parentRole;
      if (parentId) ancestor += "|" + parentId;
      if (parentTestId) ancestor += "|" + parentTestId;
      ancestry.push(ancestor);
      parent = parent.parentElement;
    }
    return { tag, role: explicitRole || implicitRole, name, text, attributes, ancestry };
  };

  // Build the runtime identity guard for a positional target: a stable enumeration container, the base
  // selector that enumerates the candidate set, the target's index/count within it, and the RAW
  // fingerprint (hashed by the main process). Returns undefined when the target cannot be located
  // among a stable candidate set, in which case the step falls back to review.
  const buildPositionalGuard = (el: Element): Record<string, unknown> | undefined => {
    let container: Record<string, unknown> | undefined;
    let scopeRoot: ParentNode = document;
    let anc: Element | null = el.parentElement;
    for (let d = 0; anc && d < 10 && tagOf(anc) !== "html"; d += 1, anc = anc.parentElement) {
      const dt = attr(anc, "data-testid");
      if (dt) { container = { type: "section", strategy: "testId", value: dt }; scopeRoot = anc; break; }
      const id = (anc as HTMLElement).id;
      if (id && !looksGeneratedId(id)) { container = { type: "section", strategy: "id", value: id }; scopeRoot = anc; break; }
    }
    const candidateSelector = localSelectorFor(el, 2, 2);
    if (!candidateSelector) return undefined;
    let siblings: Element[] = [];
    try {
      siblings = Array.prototype.slice.call(scopeRoot.querySelectorAll(candidateSelector));
    } catch {
      return undefined;
    }
    const index = siblings.indexOf(el);
    if (index < 0) return undefined;
    const guard: Record<string, unknown> = {
      candidateSelector,
      fingerprint: computeFingerprint(el),
      siblingCount: siblings.length,
      index,
      confidence: "exact"
    };
    if (container) guard.container = [container];
    // Precondition: the enclosing dialog's title (verify you are acting in the right dialog before a
    // sensitive Confirm/Delete). Non-secret; hashed by the main process alongside the fingerprint.
    const dialog = el.closest ? el.closest('[role="dialog"], [role="alertdialog"], dialog') : null;
    if (dialog) {
      const title = norm(dialog.getAttribute("aria-label") || dialog.textContent).slice(0, 80);
      if (title) guard.preconditions = [{ kind: "dialogTitle", expected: title }];
    }
    // Non-click precondition: for a form control, capture its associated <label> text so a positional
    // fill/select/check re-verifies the label before acting at replay (a changed label aborts). The
    // `for` value is escaped for a quoted attribute selector, matching the codebase convention.
    const controlTag = tagOf(el);
    if (controlTag === "input" || controlTag === "select" || controlTag === "textarea") {
      let labelText = "";
      const id = attr(el, "id");
      if (id) {
        const labelled = document.querySelector('label[for="' + esc(id) + '"]');
        if (labelled) labelText = norm(labelled.textContent).slice(0, 80);
      }
      if (!labelText && el.closest) {
        const wrapping = el.closest("label");
        if (wrapping) labelText = norm(wrapping.textContent).slice(0, 80);
      }
      if (labelText) {
        const preconditions = (guard.preconditions as Array<Record<string, string>>) || [];
        preconditions.push({ kind: "labelContent", expected: labelText });
        guard.preconditions = preconditions;
      }
    }

    return guard;
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
    type: "dialog" | "tableRow" | "card" | "listItem" | "landmark" | "form" | "section";
    strategy: string;
    value: string;
    name?: string;
    exact?: boolean;
    hasText?: string;
    visibleOnly?: boolean;
  }

  interface ContainerCandidate {
    node: Element;
    context: ContainerContext;
  }

  const MAX_CONTAINER_CHAIN_LENGTH = 3;
  const MAX_CONTAINER_ANCESTOR_DEPTH = 16;
  /**
   * Hard ceiling on chain validations per capture. The nested search is combinatorial in the
   * ancestor count and each validation issues DOM queries, so an unbounded search would stall the
   * click handler on deeply nested pages. Exhausting the budget is safe: no chain is adopted and
   * the step falls through to the existing review-required path rather than guessing.
   */
  const MAX_CONTAINER_CHAIN_EVALUATIONS = 240;

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

  /** Describe one semantic ancestor without inventing a positional or full-DOM-path selector. */
  const describeContainerAncestor = (node: Element): ContainerContext | null => {
    const tag = tagOf(node);
    const role = attr(node, "role").toLowerCase();
    if (node.matches('[role="dialog"], [role="alertdialog"], dialog, .modal, [class*="modal"], .mat-dialog-container, .ant-modal, .MuiDialog-root, .MuiDialog-container')) {
      const context = describeContainer(node, "dialog");
      if (context) context.visibleOnly = true;
      return context;
    }
    if (tag === "tr" || role === "row") {
      const name = rowAccessibleName(node).slice(0, 80);
      return name ? { type: "tableRow", strategy: "role", value: "row", name, exact: false } : null;
    }
    if (tag === "form" || role === "form") return describeContainer(node, "form");
    if (tag === "section" || role === "region") return describeContainer(node, "section");
    if (tag === "li" || role === "listitem") {
      const text = norm(node.textContent).slice(0, 80) || undefined;
      const dtid = attr(node, "data-testid");
      if (dtid) return { type: "listItem", strategy: "testId", value: dtid, hasText: text };
      return { type: "listItem", strategy: "role", value: "listitem", hasText: text };
    }
    if (tag === "article" || attr(node, "data-testid")) {
      const context = describeContainer(node, "card");
      if (context) context.hasText = norm(node.textContent).slice(0, 80) || undefined;
      return context;
    }
    if (["nav", "main", "header", "footer", "aside"].indexOf(tag) >= 0 ||
        ["navigation", "main", "banner", "contentinfo", "complementary"].indexOf(role) >= 0) {
      return describeContainer(node, "landmark");
    }
    return null;
  };

  /** Stable semantic ancestors, nearest first, bounded independently of the persisted chain cap. */
  const containerCandidates = (el: Element): ContainerCandidate[] => {
    const found: ContainerCandidate[] = [];
    let current = el.parentElement;
    let depth = 0;
    while (current && depth < MAX_CONTAINER_ANCESTOR_DEPTH) {
      const context = describeContainerAncestor(current);
      if (context) found.push({ node: current, context });
      current = current.parentElement;
      depth += 1;
    }
    return found;
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
  const detectContext = (
    el: Element,
    chosenCount: number,
    selectedContainers?: ContainerContext[]
  ): Record<string, unknown> | undefined => {
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

    if (selectedContainers?.length) {
      if (selectedContainers.length === 1) context.container = selectedContainers[0];
      else context.containers = selectedContainers.slice(0, MAX_CONTAINER_CHAIN_LENGTH);
    } else {
      const container = detectContainer(el, chosenCount);
      if (container) context.container = container;
    }

    return context.frame || context.container || context.containers ? context : undefined;
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
        return elementsForRoleIn(root, cand.value).filter((e) => {
          const actual = cand.value === "row" ? rowAccessibleName(e) : accessibleName(e);
          const expected = cand.name || "";
          return cand.exact ? actual === expected : actual.toLowerCase().indexOf(expected.toLowerCase()) >= 0;
        });
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

  const containerMatchesIn = (root: ParentNode, container: ContainerContext): Element[] => {
    let matches = candidateElementsIn(root, container);
    if (container.hasText) matches = matches.filter((node) => norm(node.textContent).indexOf(norm(container.hasText)) >= 0);
    if (container.visibleOnly) matches = matches.filter(isVisibleMatch);
    return matches;
  };

  /**
   * Prove the serialized chain itself is load-bearing: every outer-to-inner segment must resolve to
   * the concrete ancestor under the previous scope, and the target must be the exact clicked node.
   */
  const containerChainIsolatesSemantic = (
    root: ParentNode,
    el: Element,
    cand: Candidate,
    chain: ContainerCandidate[]
  ): boolean => {
    if (!chain.length || chain.length > MAX_CONTAINER_CHAIN_LENGTH) return false;
    let scope: ParentNode = root;
    for (let index = 0; index < chain.length; index += 1) {
      const segment = chain[index];
      const matches = containerMatchesIn(scope, segment.context);
      if (matches.length !== 1 || matches[0] !== segment.node) return false;
      scope = matches[0];
    }
    const targets = semanticElementsIn(scope, cand);
    return targets.length === 1 && targets[0] === el;
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
    reviewAmbiguousSemanticOwner?: boolean;
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
    let selectedContainerChain: ContainerContext[] | undefined;
    const compoundPrimary = chosen.strategy === "css" && /\s|>/.test(chosen.value);
    const goodPrimary = chosen.count === 1 && !chosen.fallback && !compoundPrimary;
    if (!goodPrimary) {
      const ancestors = containerCandidates(el);
      const root = options.root ?? document;
      let evaluations = 0;
      /** Validate one chain against the budget; adopt it only when it isolates the clicked node. */
      const tryChain = (c: Candidate, chain: ContainerCandidate[]): void => {
        if (containerScoped || evaluations >= MAX_CONTAINER_CHAIN_EVALUATIONS) return;
        evaluations += 1;
        if (!containerChainIsolatesSemantic(root, el, c, chain)) return;
        chosen = c;
        selectedContainerChain = chain.map((entry) => entry.context);
        containerScoped = true;
      };
      const budgetLeft = (): boolean => !containerScoped && evaluations < MAX_CONTAINER_CHAIN_EVALUATIONS;

      for (let i = 0; i < candidates.length && budgetLeft(); i += 1) {
        const c = candidates[i];
        if (!isSemanticStrategy(c.strategy)) continue;

        // Preserve the direct -> one-container -> nested-chain preference order.
        for (let inner = 0; inner < ancestors.length && budgetLeft(); inner += 1) {
          tryChain(c, [ancestors[inner]]);
        }
        for (let length = 2; length <= MAX_CONTAINER_CHAIN_LENGTH && budgetLeft(); length += 1) {
          const choose = (pickedNearestFirst: ContainerCandidate[], nextIndex: number): void => {
            if (!budgetLeft()) return;
            if (pickedNearestFirst.length === length) {
              tryChain(c, pickedNearestFirst.slice().reverse());
              return;
            }
            for (let index = nextIndex; index < ancestors.length; index += 1) {
              choose([...pickedNearestFirst, ancestors[index]], index + 1);
              if (!budgetLeft()) return;
            }
          };
          choose([], 0);
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

    // A positional path can point at one DOM node today even when the action owner's semantic
    // identity is genuinely ambiguous. Keep that diagnostic fallback, but do not silently turn two
    // indistinguishable named controls into a runnable action merely because their sibling order is
    // known. Container scoping above is the safe exception: it has already proved semantic identity
    // within a stable context.
    const ambiguousSemanticOwner =
      options.reviewAmbiguousSemanticOwner === true &&
      positional && !containerScoped && candidates.some((candidate) => isSemanticStrategy(candidate.strategy) && candidate.count > 1);
    if (ambiguousSemanticOwner) {
      locator.resolution = "needs-review";
      locator.resolvedBy = "recorder";
      locator.reviewReason = "the semantic action owner matches multiple elements; positional identity requires review";
    }

    const alternatives = buildAlternatives(candidates, chosen);
    if (alternatives.length) locator.alternatives = alternatives;

    const context = options.includeContext === false
      ? undefined
      : detectContext(el, chosen.count, selectedContainerChain);
    if (context) locator.context = context;

    // Attach a runtime identity guard whenever the chosen locator is POSITIONAL — a fallback strategy
    // OR an nth-based value (`isPositionalLocator` is value-based, so a scoped `…:nth-of-type(n)` counts
    // too) — so a SENSITIVE step can re-prove the target before acting. `buildRecordedFlow` hashes it and
    // keeps it only for sensitive steps; non-sensitive steps drop it.
    const chosenIsPositional =
      positional || (typeof chosen.value === "string" && /(?:>>\s*nth\s*=|:nth-(?:child|of-type)\s*\()/.test(chosen.value));
    if (chosenIsPositional) {
      const guard = buildPositionalGuard(el);
      if (guard) locator.guard = guard;
    }

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
    let nearestCustomElement: Element | null = null;
    while (candidate) {
      const tag = tagOf(candidate);
      if (candidate.matches?.(ACTION_OWNER_SELECTOR)) return candidate;
      // A custom element can be a real control, but its tag alone is weaker evidence than a
      // semantic/native owner above it. Keep the nearest one for bare-component fallback only.
      if (!nearestCustomElement && tag.indexOf("-") > 0) nearestCustomElement = candidate;
      candidate = candidate.parentElement;
    }
    return nearestCustomElement ?? el;
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

  // ── Instrumented closed-shadow capture (Phase C2) ─────────────────────────────────────────────
  // A CSS selector unique WITHIN one root (document or a shadow root) — what the runtime closed-shadow
  // engine needs to query inside a retained closed root (getBy*/role are not CSS-queryable there).
  const cssUniqueIn = (el: Element, root: ParentNode): string | null => {
    const qn = (sel: string): number => {
      try {
        return (root as unknown as { querySelectorAll: (s: string) => ArrayLike<Element> }).querySelectorAll(sel).length;
      } catch {
        return 999;
      }
    };
    const local = localSelectorFor(el, 3, 3);
    if (local && qn(local) === 1) return local;
    let chain = local || tagOf(el);
    let node: Element | null = el.parentElement;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 12) {
      const anc = localSelectorFor(node, 1, 1);
      if (anc) {
        const candidate = anc + " " + chain;
        if (qn(candidate) < qn(chain)) {
          chain = candidate;
          if (qn(chain) === 1) return chain;
        }
      }
      node = node.parentElement;
      depth += 1;
    }
    // Structural nth-child path, scoped to the root (parentElement is null at the shadow boundary).
    const parts: string[] = [];
    let n: Element | null = el;
    depth = 0;
    while (n && n.nodeType === 1 && depth < 20) {
      const parentEl: Element | null = n.parentElement;
      let seg = tagOf(n);
      if (parentEl) {
        const idx = Array.prototype.slice.call(parentEl.children).indexOf(n);
        if (idx >= 0) seg += ":nth-child(" + (idx + 1) + ")";
      }
      parts.unshift(seg);
      if (qn(parts.join(" > ")) === 1) return parts.join(" > ");
      if (!parentEl) break;
      n = parentEl;
      depth += 1;
    }
    const full = parts.join(" > ");
    return qn(full) === 1 ? full : null;
  };

  // Build an instrumented closed-shadow context when the target lives inside a CLOSED root. Walk the
  // boundary chain via getRootNode()/host (composedPath keeps these reachable across closed roots) and
  // build a CSS selector unique within each parent root plus the target. Returns null when any host or
  // the target is not CSS-addressable (→ the caller falls back to review), or when no closed root is present.
  const captureClosedShadowChain = (target: Element): Record<string, unknown> | null => {
    const boundaries: Array<{ root: ShadowRoot; host: Element; mode: string }> = [];
    let node: Node = target;
    let depth = 0;
    while (depth < 8) {
      const root = node.getRootNode();
      if (!(root instanceof ShadowRoot)) break;
      boundaries.push({ root, host: root.host, mode: root.mode });
      node = root.host;
      depth += 1;
    }
    if (!boundaries.length || !boundaries.some((b) => b.mode === "closed")) return null;
    const outerToInner = boundaries.slice().reverse();
    const hosts: Array<Record<string, unknown>> = [];
    for (let i = 0; i < outerToInner.length; i += 1) {
      const css = cssUniqueIn(outerToInner[i].host, outerToInner[i].host.getRootNode() as ParentNode);
      if (!css) return null;
      hosts.push({ strategy: "css", value: css });
    }
    const targetCss = cssUniqueIn(target, boundaries[0].root);
    if (!targetCss) return null;
    return { boundary: "closed", instrumented: true, hosts, target: { strategy: "css", value: targetCss } };
  };

  const generateForEvent = (event: Event, interactive: boolean): { target: Element; generated: ReturnType<typeof generate>; shadow: ShadowCapture } | null => {
    const raw = firstPathElement(event);
    if (!raw) return null;
    const target = interactive ? interactiveTarget(raw) : raw;

    // Instrumented closed shadow: the target lives inside a closed root the runtime bridge can reach.
    const closedShadow = captureClosedShadowChain(target);
    if (closedShadow) {
      const generated = generate(target, { allowPositional: false, includeContext: false });
      const existingContext = (generated.locator.context as Record<string, unknown> | undefined) ?? {};
      generated.locator.context = { ...existingContext, shadow: closedShadow };
      generated.locator.strategy = "css";
      generated.locator.value = String((closedShadow.target as { value: string }).value);
      delete (generated.locator as Record<string, unknown>).name;
      delete (generated.locator as Record<string, unknown>).exact;
      // Drop the throwaway generate()'s ranked alternatives: they carry the internal accessible name/text
      // (privacy — a closed root's content is not persisted), and the engine host-chain is the resolution.
      delete (generated.locator as Record<string, unknown>).alternatives;
      // The throwaway generate() could not see into the closed root, so it left a "fallback" strategy;
      // the real locator is the instrumented-shadow chain, which is neither positional nor a fallback.
      generated.quality.strategy = "css";
      generated.quality.isUnique = true;
      generated.quality.matchCount = 1;
      generated.quality.disambiguation = "shadow";
      generated.quality.warning = undefined;
      generated.locator.resolution = "resolved";
      generated.locator.resolvedBy = "recorder";
      // Do not surface the closed root's internal accessible name in the step name (privacy — a closed
      // root's content is intentionally encapsulated); the step is labelled by the target's tag instead.
      generated.accessibleName = "";
      return { target, generated, shadow: { boundary: "closed", hosts: closedShadow.hosts as Array<Record<string, unknown>>, valid: true } };
    }

    const targetRoot = target.getRootNode();
    const isOpenInternal = targetRoot instanceof ShadowRoot && targetRoot.mode === "open";
    const generated = generate(target, {
      allowPositional: !isOpenInternal && !closedShadowHosts.has(raw),
      reviewAmbiguousSemanticOwner: interactive
    });
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
  interface RevealWitness {
    /** The element the pointer was resident on, or null when it was nowhere recent. */
    el: Element | null;
    /** When the pointer ARRIVED there — the causal clock, not how long it stayed. */
    since: number;
    /** When the reveal was first observed. */
    at: number;
    /** Whether anything outranks the pointer as the explanation. Filled in at observation time. */
    cause: "pointer" | "navigation" | "click" | "focus" | "unattributed";
  }
  const revealWitness = new WeakMap<Element, RevealWitness>();

  /**
   * Controls first seen AFTER the baseline scan — i.e. absent from the observed DOM at rest.
   *
   * This is the second, independent reading of "was not there before", alongside the MutationObserver
   * insertion record. It exists because the two can disagree: a node can arrive while insertion
   * tracking is saturated, or inside a boundary no observer reached. Keeping them separate is the
   * point — absence is a fact about the baseline, insertion is a fact about an observation, and
   * neither is hiddenness.
   */
  const absentAtBaseline = new WeakSet<Element>();
  let baselineScanDone = false;
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
  /**
   * Pointer RESIDENCE — the element the pointer is currently over, and when it arrived.
   *
   * The trail answers "where has the pointer been"; residence answers "where is it now, and since
   * when". Insertion attribution (`awkit-0vm`) needs the second: a node that appears 80ms after the
   * pointer arrives somewhere is explained by that arrival, while the same node appearing two seconds
   * into a stationary dwell is not. Moving within one subtree continues the same residence, so
   * crossing between a control and its label does not reset the clock.
   */
  let pointerOwner: Element | null = null;
  let pointerOwnerSince = 0;
  const recordPointer = (event: Event): void => {
    try {
      if (!event.isTrusted) return;
      // `event.target` is RETARGETED to the shadow host on a window-level listener, so using it
      // would record the host as the pointer owner and make every shadow-internal trigger look like
      // its host. The composed path gives the element actually under the pointer; for a CLOSED root
      // it stops at the host, which is the correct answer there.
      const el = firstPathElement(event);
      if (!el || el.nodeType !== 1) return;
      const me = event as MouseEvent;
      const now = Date.now();
      pointerTrail.push({ el, x: Math.round(me.clientX), y: Math.round(me.clientY), ts: now });
      if (pointerTrail.length > POINTER_TRAIL_MAX) pointerTrail.shift();
      const sameResidence =
        pointerOwner === el || (!!pointerOwner && (pointerOwner.contains(el) || el.contains(pointerOwner)));
      if (!sameResidence) pointerOwnerSince = now;
      pointerOwner = el;
    } catch {
      /* ignore */
    }
  };
  try {
    // Competing-cause clocks for insertion attribution. These run BEFORE the capture listeners below
    // in document order but on the same capture phase, so a click's own timestamp is set before the
    // interaction that reads it is built — which is why the window is checked against the INSERTION
    // time, recorded earlier, and never against the click being captured now.
    window.addEventListener(
      "click",
      (event) => {
        if (event.isTrusted) lastTrustedClickAt = Date.now();
      },
      true
    );
    window.addEventListener(
      "focusin",
      (event) => {
        if (event.isTrusted) lastFocusChangeAt = Date.now();
      },
      true
    );
  } catch {
    /* ignore */
  }
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
  /**
   * The most recent pointer sample OUTSIDE `el` — the last place the pointer was before it entered.
   * Samples inside a revealed or inserted surface are where the pointer went afterwards, so they are
   * an effect of the interaction and can never be evidence of what caused it.
   */
  const lastPointerOutside = (el: Element): PointerSample | null => {
    for (let i = pointerTrail.length - 1; i >= 0; i -= 1) {
      if (!el.contains(pointerTrail[i].el)) return pointerTrail[i];
    }
    return null;
  };
  /**
   * Build the locator that will be PERSISTED for a hover trigger, and say whether it is safe.
   *
   * The caller must use this one object for both the decision and the payload. Generating the
   * locator a second time at persist time is how a positional selector once reached a saved step
   * through a gate that had approved a different, non-positional one.
   *
   * A trigger inside an open shadow root is described with the Increment 6 model — an ordered
   * outer-to-inner host chain in `context.shadow.hosts` plus a semantic locator scoped to the
   * innermost root — which `LocatorFactory` already knows how to walk. THE HOST IS NEVER
   * SUBSTITUTED FOR THE INTERNAL TRIGGER: hovering a host picks an action point at the host's
   * centre, which need not lie on the internal control, and a listener bound to that control does
   * not fire for a hover that never enters it. A host locator is only ever persisted when the host
   * itself was the observed pointer witness. When the internal trigger cannot be represented, the
   * answer is review — never an executable fallback that happens to work on one fixture.
   */
  const buildTriggerLocator = (el: Element): { locator: Record<string, unknown>; ok: boolean; reason?: string } => {
    const positional = (value: unknown): boolean => typeof value === "string" && /:nth-(?:child|of-type)\s*\(/.test(value);

    // Walk inner → outer to find any open-shadow chain above this element.
    const innerToOuter: Array<{ root: ShadowRoot; host: Element }> = [];
    let node: Element = el;
    for (let depth = 0; depth < OPEN_ROOT_CAP; depth += 1) {
      const root = node.getRootNode();
      if (!(root instanceof ShadowRoot)) break;
      if (root.mode !== "open") {
        return {
          locator: {},
          ok: false,
          reason: "hover trigger inside a closed shadow root cannot be represented safely"
        };
      }
      innerToOuter.push({ root, host: root.host });
      node = root.host;
    }

    if (!innerToOuter.length) {
      const generated = generate(el, { allowPositional: false });
      const ok = isStableGenerated(generated) && !positional(generated.locator.value);
      return { locator: generated.locator, ok, reason: ok ? undefined : "trigger has no stable, non-positional locator" };
    }

    const unsafe = { locator: {}, ok: false, reason: "hover trigger inside open shadow root could not be represented safely" };
    const innermostRoot = innerToOuter[0].root;
    const outerToInner = innerToOuter.slice().reverse();
    const hosts: Array<Record<string, unknown>> = [];
    for (let index = 0; index < outerToInner.length; index += 1) {
      const boundary = outerToInner[index];
      const described = hostDescriptor(boundary.host, boundary.host.getRootNode() as ParentNode);
      // Every host must be independently resolvable, or the chain cannot be walked at replay.
      if (!described.valid || positional(described.descriptor.value)) return unsafe;
      hosts.push(described.descriptor);
    }

    // The inner locator is generated against the innermost root, so it describes the control itself
    // rather than anything about its host.
    const generated = generate(el, { root: innermostRoot, allowPositional: false, includeContext: false });
    if (!generated.traversalComplete) return unsafe;
    if (generated.quality.strategy === "fallback") return unsafe;
    if (generated.locator.strategy === "xpath") return unsafe;
    if (positional(generated.locator.value)) return unsafe;

    // Strict uniqueness WITHIN that root: exactly one match, and it is this element.
    const candidate = {
      strategy: String(generated.locator.strategy || ""),
      value: String(generated.locator.value || ""),
      name: typeof generated.locator.name === "string" ? generated.locator.name : undefined
    };
    const local = candidateElementsIn(innermostRoot, candidate);
    if (local.length !== 1 || local[0] !== el) return unsafe;

    const existingContext = (generated.locator.context as Record<string, unknown> | undefined) ?? {};
    generated.locator.context = { ...existingContext, shadow: { boundary: "open", hosts } };
    return { locator: generated.locator, ok: true };
  };

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
    | { kind: "trigger"; el: Element; locator: Record<string, unknown>; inserted?: boolean }
    | { kind: "review"; reason?: string; inserted?: boolean } // hover-gated, but no stable trigger pinned
    | { kind: "none" }; //     the target was not hover-gated by a revealed container (e.g. async self-toggle)

  // ── Insertion evidence (hover-INSERTED controls, awkit-0vm) ─────────────────────────────────
  //
  // A control that did not exist at the baseline scan has no hidden-at-rest record, and ABSENCE IS
  // NOT HIDDENNESS: `visibilityState.get(el) === false` is simply false for it, so the hover paths
  // above never even look at it. Such a click is saved with no prerequisite and fails replay.
  //
  // The fix is to record what the recorder actually OBSERVED: that the node was not in the DOM, that
  // our own MutationObserver saw it arrive, and where the pointer was — and had been — at that
  // moment. Everything here is bounded and evidence-only; when a bound is reached the recorder fails
  // CLOSED (refuses attribution and marks the click for review) rather than guessing.

  /** What best explains an insertion. Anything other than `pointer` blocks hover attribution. */
  type InsertionCause = "pointer" | "navigation" | "click" | "focus" | "unattributed";

  interface InsertionRecord {
    /** When the recorder observed the node enter the DOM. */
    at: number;
    /** The element the pointer was resident on at that moment (never retained beyond the WeakMap). */
    witness: Element | null;
    /** When the pointer arrived at that element — the causal clock, not the dwell length. */
    witnessSince: number;
    cause: InsertionCause;
    /** The inserted root this node arrived as part of. */
    root: Element;
    /** True when the insertion happened inside an open shadow root. */
    shadow: boolean;
  }

  const insertionRecord = new WeakMap<Element, InsertionRecord>();
  /** Bounds. Reaching any of them degrades to fail-closed, never to a guess. */
  const INSERTION_RECORD_CAP = 600;
  const INSERTION_NODES_PER_BATCH = 64;
  const INSERTION_ANCESTOR_WALK = 8;
  const SHADOW_OBSERVER_CAP = 32;
  /**
   * How soon after the pointer ARRIVES an insertion must appear to be explained by that arrival.
   * This is the causal signal. Dwell length is not: a pointer parked somewhere for two seconds when
   * a timer fires satisfies "the pointer was nearby" perfectly, which is exactly the coincidence
   * that must not become an attribution.
   */
  const INSERTION_CAUSAL_WINDOW_MS = 600;
  /** How long insertion evidence stays usable for a later click. */
  const INSERTION_CLICK_WINDOW_MS = 15_000;
  /** A navigation / click / focus this recently before an insertion outranks the pointer. */
  const COMPETING_CAUSE_WINDOW_MS = 400;

  let insertionRecordCount = 0;
  let insertionSaturatedAt = 0;
  let lastNavigationAt = 0;
  let lastTrustedClickAt = 0;
  let lastFocusChangeAt = 0;

  /** Open shadow roots created after install, queued by the `attachShadow` wrapper. */
  const pendingShadowRoots = (w.__awtkitPendingShadowRoots as ShadowRoot[]) || [];
  const observedShadowRoots = new WeakSet<ShadowRoot>();
  let observedShadowRootCount = 0;

  /** Which competing explanation, if any, outranks the pointer for an insertion at `at`. */
  const competingCauseAt = (at: number): InsertionCause => {
    if (at - lastNavigationAt >= 0 && at - lastNavigationAt <= COMPETING_CAUSE_WINDOW_MS) return "navigation";
    if (at - lastTrustedClickAt >= 0 && at - lastTrustedClickAt <= COMPETING_CAUSE_WINDOW_MS) return "click";
    if (at - lastFocusChangeAt >= 0 && at - lastFocusChangeAt <= COMPETING_CAUSE_WINDOW_MS) return "focus";
    return "pointer";
  };

  /**
   * Record one inserted subtree. Bounded in breadth (`INSERTION_NODES_PER_BATCH` descendants) and in
   * total (`INSERTION_RECORD_CAP` elements); the root is always recorded first so a flood of siblings
   * cannot starve the node that matters. Only elements are held, and only in a WeakMap.
   */
  const noteInsertion = (root: Element, at: number, shadow: boolean): void => {
    try {
      if (insertionRecordCount >= INSERTION_RECORD_CAP) {
        if (!insertionSaturatedAt) insertionSaturatedAt = at;
        return;
      }
      const witness = pointerOwner && pointerOwner.isConnected ? pointerOwner : null;
      const shared: Omit<InsertionRecord, "root"> = {
        at,
        witness,
        witnessSince: pointerOwnerSince,
        cause: competingCauseAt(at),
        shadow
      };
      const stamp = (el: Element): boolean => {
        if (insertionRecordCount >= INSERTION_RECORD_CAP) {
          if (!insertionSaturatedAt) insertionSaturatedAt = at;
          return false;
        }
        if (insertionRecord.has(el)) return true; // first observation wins — re-insertion is not new evidence
        insertionRecord.set(el, { ...shared, root });
        insertionRecordCount += 1;
        return true;
      };
      if (!stamp(root)) return;
      let descendants: Element[] = [];
      try {
        descendants = Array.prototype.slice.call(root.querySelectorAll("*"), 0, INSERTION_NODES_PER_BATCH);
      } catch {
        descendants = [];
      }
      for (let index = 0; index < descendants.length; index += 1) {
        if (!stamp(descendants[index])) return;
      }
    } catch {
      /* ignore */
    }
  };

  /** Drain childList additions from one MutationObserver batch. */
  const noteMutations = (records: MutationRecord[], shadow: boolean): void => {
    const at = Date.now();
    for (let r = 0; r < records.length; r += 1) {
      const added = records[r].addedNodes;
      if (!added || !added.length) continue;
      for (let n = 0; n < added.length; n += 1) {
        const node = added[n];
        if (node && node.nodeType === 1) noteInsertion(node as Element, at, shadow);
      }
    }
  };

  /**
   * The insertion record covering `el` — itself or the nearest recorded ancestor within a bounded
   * walk, so a click on a button inside a hover-inserted menu resolves to the menu's insertion.
   */
  const nearestInsertion = (el: Element): InsertionRecord | null => {
    let node: Element | null = el;
    for (let depth = 0; node && depth < INSERTION_ANCESTOR_WALK; depth += 1) {
      const found = insertionRecord.get(node);
      if (found) return found;
      node = node.parentElement;
    }
    return null;
  };

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
    const witnessRecord = revealWitness.has(revealedRoot) ? revealWitness.get(revealedRoot) : revealWitness.get(target);
    const witness = witnessRecord?.el ?? null;
    // No witness recorded means the reveal was never observed happening (it predates the baseline
    // scan); a null witness means the pointer was nowhere near it at the time. Neither is evidence
    // of a hover, and inventing a trigger from a coincidence is the failure mode this guards.
    if (!witness) return null;

    // The most recent pointer sample OUTSIDE the revealed surface. Samples inside it are where the
    // pointer went after the reveal — an effect of the hover, never its cause.
    const sample = lastPointerOutside(revealedRoot);
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
    const builtSibling = buildTriggerLocator(candidate);
    if (!builtSibling.ok) return { kind: "review", reason: builtSibling.reason };
    return { kind: "trigger", el: candidate, locator: builtSibling.locator };
  };

  /**
   * Attribute a REVEAL whose trigger is in a different subtree entirely — neither an ancestor nor a
   * sibling of what it shows (`awkit-hmt`). CSS cannot express that relationship, so these are always
   * JS-driven: a `mouseenter` handler somewhere that unhides something somewhere else.
   *
   * `awkit-vot` refused these because reveal-moment pointer evidence, as recorded then, was only
   * "the pointer was somewhere when this appeared" — satisfied by any hover coinciding with any
   * reveal. What makes them attributable now is the discriminator the INSERTION path already relies
   * on and which the reveal path did not have: the pointer's ARRIVAL, not its presence. A reveal that
   * follows the pointer landing somewhere by less than `INSERTION_CAUSAL_WINDOW_MS` is explained by
   * that landing; one that happens while the pointer has been parked is not. Competing causes
   * (navigation, click, focus) are filtered the same way too.
   *
   * Note the asymmetry this removes: a remote hover that INSERTS a control has been attributed since
   * `awkit-0vm`, because the insertion resolver never required adjacency. A remote hover that merely
   * UNHIDES an existing control was refused. Same interaction, same evidence, opposite verdicts —
   * that inconsistency, not a new signal, is what this closes.
   */
  const resolveRemoteHoverTrigger = (revealedRoot: Element, target: Element): HoverResolution | null => {
    const record = revealWitness.has(revealedRoot) ? revealWitness.get(revealedRoot) : revealWitness.get(target);
    if (!record || !record.el) return null; // nothing was under the pointer when it appeared
    if (record.cause !== "pointer") return null; // a navigation / click / focus explains it better
    if (record.since > record.at) return null; // the pointer arrived after the reveal
    if (record.at - record.since > INSERTION_CAUSAL_WINDOW_MS) return null; // parked, not causing

    const surface = revealedRoot;
    if (surface.contains(record.el)) return { kind: "review", reason: "pointer was inside the revealed surface" };
    const candidate = interactiveTarget(record.el);
    if (surface.contains(candidate)) return { kind: "review", reason: "trigger resolves inside the revealed surface" };
    if (!candidate.isConnected) return { kind: "review", reason: "trigger left the page before the click" };
    if (isBroadTrigger(candidate)) return { kind: "review", reason: "trigger is too broad to replay" };
    if (isLandmark(candidate) && !pointerTrail.some((s) => s.el === candidate)) {
      return { kind: "review", reason: "trigger is a landmark the pointer never landed on" };
    }
    // The pointer must still belong to the trigger as the click lands.
    const outside = lastPointerOutside(surface);
    if (!outside || !(outside.el === candidate || candidate.contains(outside.el))) {
      return { kind: "review", reason: "pointer moved off the trigger before the click" };
    }
    const built = buildTriggerLocator(candidate);
    if (!built.ok) return { kind: "review", reason: built.reason ?? "trigger has no stable, non-positional locator" };
    return { kind: "trigger", el: candidate, locator: built.locator };
  };

  /**
   * Attribute a click on a control that was INSERTED after the baseline scan (`awkit-0vm`).
   *
   * Returns `null` when there is no insertion evidence at all, so the caller falls through to the
   * hidden-at-rest paths and ordinary clicks are untouched. Every other outcome is stated: a trigger,
   * or a review carrying the reason attribution was refused. It never returns `none` from a position
   * of knowledge — if the recorder saw the target arrive under the pointer, the click is either
   * explained or flagged.
   *
   * The joint evidence required, in order of what each rules out:
   *   - an insertion record          → the node was absent, and OUR observer saw it arrive
   *   - `cause === "pointer"`        → no navigation / click / focus better explains it
   *   - a concrete witness           → the pointer was somewhere real at that moment
   *   - arrival inside the window    → the pointer's ARRIVAL explains it, not a coincident timer
   *   - witness outside the surface  → the trigger is not part of what appeared
   *   - witness still connected      → the trigger survived to be replayed
   *   - witness still pointer owner  → the pointer did not move on to something else meanwhile
   *   - stable, non-positional       → the trigger can actually be found again
   */
  const resolveInsertedHoverTrigger = (target: Element): HoverResolution | null => {
    const record = nearestInsertion(target);
    if (!record) {
      // Fail closed: once insertion tracking has overflowed, an unrecorded control of unknown
      // provenance clicked while the pointer was resident ELSEWHERE cannot be cleared of a hover
      // dependency. Bounded to the window after saturation so a degraded page does not flag forever.
      const before = lastPointerOutside(target);
      if (
        insertionSaturatedAt &&
        Date.now() - insertionSaturatedAt <= INSERTION_CLICK_WINDOW_MS &&
        (absentAtBaseline.has(target) || !visibilityState.has(target)) &&
        before
      ) {
        return { kind: "review", reason: "insertion tracking saturated — provenance unknown", inserted: true };
      }
      return null;
    }

    // A navigation / click / focus explains the insertion better than the pointer did. The control
    // does not depend on a hover, so there is no omitted prerequisite and nothing to review — making
    // a review item here would be a false alarm, not caution.
    if (record.cause !== "pointer") return null;
    if (!record.witness) return null; // nothing was under the pointer — an independent update
    if (record.witnessSince > record.at) return null; // the pointer arrived after the node did
    if (record.at - record.witnessSince > INSERTION_CAUSAL_WINDOW_MS) return null; // parked, not causing
    if (Date.now() - record.at > INSERTION_CLICK_WINDOW_MS) {
      return { kind: "review", reason: "insertion evidence expired before the click", inserted: true };
    }

    const surface = record.root;
    if (surface.contains(record.witness)) {
      return { kind: "review", reason: "pointer was inside the inserted surface", inserted: true };
    }

    const candidate = interactiveTarget(record.witness);
    if (surface.contains(candidate)) return { kind: "review", reason: "trigger resolves inside the inserted surface", inserted: true };
    if (!candidate.isConnected) return { kind: "review", reason: "trigger left the page before the click", inserted: true };
    if (isBroadTrigger(candidate)) return { kind: "review", reason: "trigger is too broad to replay", inserted: true };
    if (isLandmark(candidate) && !pointerTrail.some((s) => s.el === candidate)) {
      return { kind: "review", reason: "trigger is a landmark the pointer never landed on", inserted: true };
    }
    // The pointer must still belong to the trigger as the click lands — the last place it was before
    // entering what appeared. Otherwise it moved on, and the transition has a gap in it.
    const outside = lastPointerOutside(surface);
    const lastOutside = outside ? outside.el : null;
    if (!lastOutside || !(lastOutside === candidate || candidate.contains(lastOutside))) {
      return { kind: "review", reason: "pointer moved off the trigger before the click", inserted: true };
    }
    const built = buildTriggerLocator(candidate);
    if (!built.ok) {
      return { kind: "review", reason: built.reason ?? "trigger has no stable, non-positional locator", inserted: true };
    }
    return { kind: "trigger", el: candidate, locator: built.locator, inserted: true };
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
    if (revealedSurfaceCount === 0) {
      return (
        resolveSiblingHoverTrigger(revealedRoot, target) ??
        resolveRemoteHoverTrigger(revealedRoot, target) ??
        { kind: "none" }
      );
    }

    /**
     * The ancestor walk could not pin a trigger. Before settling for review, check whether the
     * pointer evidence explains the reveal through an adjacent sibling instead — a sibling-driven
     * reveal inside a wrapper reaches here whenever the wrapper itself is not stably locatable.
     * A sibling answer of `review` is the same verdict, so only a positive attribution changes it.
     */
    const reviewOrSibling = (): HoverResolution => {
      const sibling = resolveSiblingHoverTrigger(revealedRoot, target);
      if (sibling && sibling.kind === "trigger") return sibling;
      const remote = resolveRemoteHoverTrigger(revealedRoot, target);
      return remote && remote.kind === "trigger" ? remote : { kind: "review" };
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
    const builtAncestor = buildTriggerLocator(candidate);
    if (!builtAncestor.ok) return reviewOrSibling();
    return { kind: "trigger", el: candidate, locator: builtAncestor.locator };
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
      const emitUrl = (): void => {
        // Also the navigation clock for insertion attribution: content that arrives right after a
        // route change is explained by the navigation, not by whatever the pointer was resting on.
        lastNavigationAt = Date.now();
        signal({ kind: "url", url: location.href, ts: lastNavigationAt });
      };
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
            // First sighting. After the baseline this control was not in the observed DOM at rest —
            // record that as its own fact, distinct from being present and hidden.
            if (baselineScanDone) absentAtBaseline.add(el);
            visibilityState.set(el, isVisible(el));
          } else if (visibilityState.get(el) === false && !revealWitness.has(el) && isVisible(el)) {
            // First time this hidden-at-rest control has been seen visible: record where the pointer
            // was, so a sibling reveal can be attributed to the hover that caused it (`awkit-vot`).
            const last = pointerTrail.length ? pointerTrail[pointerTrail.length - 1] : null;
            const fresh = !!last && now - last.ts <= REVEAL_POINTER_WINDOW_MS;
            revealWitness.set(el, {
              el: fresh && pointerOwner && pointerOwner.isConnected ? pointerOwner : null,
              since: pointerOwnerSince,
              at: now,
              cause: competingCauseAt(now)
            });
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

    /**
     * Take the at-rest baseline and start observing.
     *
     * This MUST NOT run at document start. Production injects the recorder with
     * `context.addInitScript` (`RecorderService`), so this file executes before the page's own
     * markup is parsed. Baselining an empty document would make every element on the page look
     * absent-at-rest and would record the entire initial parse as a stream of "insertions" — which
     * is exactly what it used to do: `absentAtBaseline` was true for everything, up to
     * `INSERTION_RECORD_CAP` records were burned before the user did anything, and
     * `nearestInsertion` found a witness-less parse record on some ancestor of almost any target,
     * short-circuiting insertion attribution and making the fail-closed saturation guard
     * unreachable. Deferring to DOMContentLoaded makes "at rest" mean the loaded page under either
     * install order (`awkit-a7k`).
     */
    const startObservation = (): void => {
      try {
        scanAll(true); // silent baseline — don't emit for pre-existing content
      } catch {
        /* ignore */
      }
      // Everything recorded above is the at-rest DOM; anything first seen from here is not.
      baselineScanDone = true;
      /**
       * Observe open shadow roots for insertions. A document-level observer cannot see a childList
       * change inside a shadow root, so a control inserted there on hover would have no evidence at
       * all. Bounded to `SHADOW_OBSERVER_CAP` roots; beyond that the recorder simply has no insertion
       * evidence for further roots, which the resolver treats as "no claim", never as "not inserted".
       */
      const observeShadowRoots = (): void => {
        try {
          while (pendingShadowRoots.length) {
            const root = pendingShadowRoots.shift();
            if (!root || observedShadowRoots.has(root)) continue;
            if (observedShadowRootCount >= SHADOW_OBSERVER_CAP) return;
            observedShadowRoots.add(root);
            observedShadowRootCount += 1;
            try {
              new MutationObserver((records) => noteMutations(records, true)).observe(root, {
                subtree: true,
                childList: true
              });
            } catch {
              /* ignore */
            }
          }
        } catch {
          /* ignore */
        }
      };
      try {
        // Roots that already existed when the recorder installed (bounded traversal).
        const existing = collectOpenRoots(document);
        for (let index = 0; index < existing.length; index += 1) {
          const root = existing[index] as ShadowRoot;
          if (root && (root as ShadowRoot).host) pendingShadowRoots.push(root);
        }
        observeShadowRoots();
      } catch {
        /* ignore */
      }
      try {
        const obs = new MutationObserver((records) => {
          try {
            noteMutations(records, false);
            observeShadowRoots();
          } catch {
            /* ignore */
          }
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
            observeShadowRoots(); // roots attached since the last sweep
          } catch {
            /* ignore */
          }
          try {
            scanAll(false);
          } catch {
            /* ignore */
          }
        }, 150);
      } catch {
        /* ignore */
      }
    };

    try {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => startObservation(), { once: true });
      } else {
        startObservation();
      }
    } catch {
      // If the readyState check itself fails, observe now rather than never.
      startObservation();
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
    // Insertion evidence first: a control that did not exist at the baseline scan has no
    // hidden-at-rest record at all, so the visibility branch below would never consider it. Absence
    // is not hiddenness, and the two are answered by different evidence.
    const inserted = resolveInsertedHoverTrigger(target);
    const hover: HoverResolution | null =
      inserted ?? (visibilityState.get(target) === false ? resolveHoverTrigger(target, event) : null);
    if (hover) {
      if (hover.kind === "trigger") {
        interaction.requiresHover = true;
        // Literally the object the guard accepted — not a re-generation of it. A second call let a
        // positional locator through a gate that had approved a different, non-positional one.
        interaction.hoverContainer = hover.locator;
        if (hover.inserted) interaction.hoverInserted = true;
      } else if (hover.kind === "review") {
        // Hover-gated, but no stable trigger could be pinned. Flag for review instead of emitting a
        // hover step that cannot replay — and say WHY, so the review is actionable.
        interaction.requiresHover = true;
        interaction.hoverUnresolved = true;
        if (hover.reason) interaction.hoverReviewReason = hover.reason;
        // A refusal still states its evidence source: the recorder OBSERVED the node arrive, it just
        // could not pin the trigger. Without this a refused insertion is indistinguishable from one
        // that was never seen at all.
        if (hover.inserted) interaction.hoverInserted = true;
      }
      // hover.kind === "none": target toggled independently of a hover trigger — no hover step.
    }
    return interaction;
  };

  // A closed shadow root retargets composedPath for outside listeners, so the window listener never sees
  // the internal target. The `attachShadow` wrap installs these SAME capture handlers INSIDE each closed
  // root; the handler ignores a target that is itself a closed host (a retargeted internal click, or the
  // outer boundary of a nested closed chain), so only the innermost listener — which sees the true target
  // — records. (A direct click on a closed-shadow host is intentionally not recorded.)
  const insideClosedHostRetarget = (event: Event): boolean => {
    const raw = firstPathElement(event);
    return !!raw && closedShadowHosts.has(raw);
  };

  const captureBlueprint = (el: Element): Record<string, unknown> | undefined => {
    // Blueprint recovery resolves via the top document's `body *` document order and cannot reach a
    // shadow-scoped element, so capturing one is useless — and would persist the internal (including
    // CLOSED-root) element's name/text, breaking the closed-shadow "no internal identity persisted"
    // invariant. Skip any element whose root is a shadow root.
    const root = el.getRootNode ? el.getRootNode() : null;
    if (root && typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot) return undefined;
    let documentOrder = -1;
    try {
      const walker = document.createTreeWalker(document.body || document.documentElement, 1 /* NodeFilter.SHOW_ELEMENT */, null);
      let order = 0;
      while (walker.nextNode()) {
        if (walker.currentNode === el) {
          documentOrder = order;
          break;
        }
        order += 1;
        if (order > 10000) break; // bounded
      }
    } catch {
      /* ignore */
    }

    let siblingIndex = 0;
    let sameTagIndex = 0;
    const parent = el.parentElement;
    if (parent) {
      const children = parent.children;
      for (let i = 0; i < children.length; i++) {
        if (children[i] === el) {
          siblingIndex = i;
          break;
        }
      }
      const tag = el.tagName;
      let sameTagCount = 0;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.tagName === tag) {
          if (child === el) {
            sameTagIndex = sameTagCount;
            break;
          }
          sameTagCount += 1;
        }
      }
    }

    let enabled: boolean | undefined;
    if (el.hasAttribute("disabled") || (el as HTMLInputElement).disabled === true) enabled = false;

    let boundingRegion: Record<string, number> | undefined;
    const vis = isVisible(el);
    if (vis) {
      try {
        const rect = el.getBoundingClientRect();
        const winWidth = window.innerWidth || 1;
        const winHeight = window.innerHeight || 1;
        // 0..1 ratio to remain resilient to exact pixel resizing
        boundingRegion = {
          relativeX: Math.max(0, Math.min(1, rect.left / winWidth)),
          relativeY: Math.max(0, Math.min(1, rect.top / winHeight)),
          relativeWidth: Math.max(0, Math.min(1, rect.width / winWidth)),
          relativeHeight: Math.max(0, Math.min(1, rect.height / winHeight))
        };
      } catch {
        /* ignore */
      }
    }

    return {
      documentOrder,
      siblingIndex,
      sameTagIndex,
      visible: vis,
      enabled,
      boundingRegion,
      fingerprint: computeFingerprint(el),
      // Origin + pathname only — never persist query/fragment (tokens/PII) in the draft. Matches the
      // recorder's URL-masking policy and what buildRecordedFlow derives for the stored blueprint.
      url: location.origin && location.origin !== "null" ? location.origin + location.pathname : location.href,
      title: document.title,
      documentStructure: (() => {
        try {
          const all = document.body ? document.body.querySelectorAll("*") : [];
          const histogram = new Map<string, number>();
          for (let i = 0; i < all.length && i < 5000; i++) {
            const t = all[i].tagName.toLowerCase();
            const r = all[i].getAttribute("role");
            const key = r ? t + ":" + r : t;
            histogram.set(key, (histogram.get(key) || 0) + 1);
          }
          const sorted: string[] = [];
          histogram.forEach((v, k) => sorted.push(k + "=" + v));
          return sorted.sort().join("|");
        } catch {
          return "";
        }
      })()
    };
  };

  // A recognized pointer-emulated drag ends with a synthetic `click` on the common ancestor of the
  // press/release targets (browsers fire it whenever mousedown and mouseup differ). That click is part
  // of the drag gesture, not a separate action, so the pointer recognizer suppresses exactly the next
  // click after it emits a `drag`.
  let suppressClickAfterDrag = false;
  const onClickCapture = (event: Event): void => {
    if (suppressClickAfterDrag) {
      suppressClickAfterDrag = false;
      return;
    }
    if (insideClosedHostRetarget(event)) return;
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
    const blueprintCapture = captureBlueprint(target);
    record({ type: "click", name: "Click " + label, locator: { ...g.locator, interaction, blueprintCapture } });
  };
  window.addEventListener("click", onClickCapture, true);

  // ── Drag and drop (native HTML5 DnD) ─────────────────────────────────────────
  // Capture a drag gesture as ONE `drag` action carrying the source locator (from dragstart) and the
  // drop-target locator (from drop), emitted on dragend once both ends are known. A cancelled drag
  // (Escape, or a target that never accepts the drop) records nothing. Sortable/kanban/reorder UIs
  // that use the standard draggable + drop protocol are captured here; pointer-emulated DnD is handled
  // by the bounded gesture recognizer below. `nativeDragFired` deduplicates the two paths.
  let pendingDragSource: { locator: Record<string, unknown>; name: string } | null = null;
  let pendingDragTarget: { locator: Record<string, unknown>; name: string } | null = null;
  let nativeDragFired = false;
  const onDragStartCapture = (event: Event): void => {
    nativeDragFired = true;
    pendingDragSource = null;
    pendingDragTarget = null;
    if (insideClosedHostRetarget(event)) return;
    const captured = generateForEvent(event, false);
    if (!captured) return;
    const { target, generated: g, shadow } = captured;
    const interaction = captureInteraction(event, target, g, shadow);
    pendingDragSource = { locator: { ...g.locator, interaction }, name: g.accessibleName || tagOf(target) || "element" };
  };
  const onDropCapture = (event: Event): void => {
    if (!pendingDragSource) return;
    const captured = generateForEvent(event, false);
    if (!captured) return;
    const { target, generated: g, shadow } = captured;
    const interaction = captureInteraction(event, target, g, shadow);
    pendingDragTarget = { locator: { ...g.locator, interaction }, name: g.accessibleName || tagOf(target) || "element" };
  };
  const onDragEndCapture = (): void => {
    if (pendingDragSource && pendingDragTarget) {
      record({
        type: "drag",
        name: "Drag " + pendingDragSource.name + " to " + pendingDragTarget.name,
        locator: pendingDragSource.locator,
        targetLocator: pendingDragTarget.locator
      });
    }
    pendingDragSource = null;
    pendingDragTarget = null;
  };
  window.addEventListener("dragstart", onDragStartCapture, true);
  window.addEventListener("drop", onDropCapture, true);
  window.addEventListener("dragend", onDragEndCapture, true);

  // ── Pointer-emulated drag and drop (bounded gesture recognizer) ──────────────
  // Libraries like react-dnd / dnd-kit / SortableJS implement drag with pointer events, not native
  // HTML5 DnD. Recognize a drag ONLY when: the PRIMARY mouse/pen button goes down on a valid source,
  // the pointer moves beyond DRAG_MOVE_THRESHOLD_PX while still pressed, no scroll/selection/cancel/
  // native-drag intervenes, and a CREDIBLE, DISTINCT drop target sits under the release point. Then
  // emit ONE `drag`, deduplicated with the native path (a native `dragstart` sets `nativeDragFired`).
  // Everything else fails closed with NO action — clicks + jitter, double-clicks, text selection,
  // scroll/pan, sliders, resizes, canvas drawing, long presses, cancellation/Escape/navigation/detach,
  // non-primary buttons and touch. The drop target is NEVER fabricated from coordinates alone.
  const DRAG_MOVE_THRESHOLD_PX = 10;
  let pointerDrag:
    | { pointerId: number; startX: number; startY: number; startEl: Element; source: { locator: Record<string, unknown>; name: string }; moved: boolean; canceled: boolean }
    | null = null;

  const isExcludedPointerDragSource = (el: Element): boolean => {
    let node: Element | null = el;
    for (let depth = 0; node && node.nodeType === 1 && depth < 6; node = node.parentElement, depth += 1) {
      const tag = tagOf(node);
      if (tag === "textarea" || tag === "select" || tag === "canvas") return true; // text entry / drawing
      if ((node as HTMLElement).isContentEditable) return true; // text selection
      if (tag === "input") {
        const type = ((node as HTMLInputElement).type || "text").toLowerCase();
        if (["range", "file", "number", "color", "date", "datetime-local", "month", "week", "time", "text", "search", "email", "url", "tel", "password"].indexOf(type) >= 0) return true;
      }
      const role = (attr(node, "role") || "").toLowerCase();
      if (role === "slider" || role === "scrollbar" || role === "spinbutton") return true;
    }
    try {
      const view = el.ownerDocument ? el.ownerDocument.defaultView : null;
      if (view && view.getComputedStyle(el).resize !== "none") return true; // resize handle
    } catch {
      /* ignore */
    }
    return false;
  };

  const cancelPointerDrag = (): void => {
    if (pointerDrag) pointerDrag.canceled = true;
  };

  const onPointerDownDrag = (event: Event): void => {
    pointerDrag = null;
    nativeDragFired = false;
    suppressClickAfterDrag = false;
    if (!(event instanceof PointerEvent)) return;
    if (event.button !== 0 || !event.isPrimary) return; // primary button only
    if (event.pointerType === "touch") return; // touch pan/scroll is not a drag
    if (insideClosedHostRetarget(event)) return;
    const raw = firstPathElement(event);
    if (!raw || isExcludedPointerDragSource(raw)) return;
    const captured = generateForEvent(event, false);
    if (!captured) return;
    pointerDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startEl: captured.target,
      source: { locator: { ...captured.generated.locator }, name: captured.generated.accessibleName || tagOf(captured.target) || "element" },
      moved: false,
      canceled: false
    };
  };

  const onPointerMoveDrag = (event: Event): void => {
    if (!pointerDrag || !(event instanceof PointerEvent) || event.pointerId !== pointerDrag.pointerId) return;
    const dx = event.clientX - pointerDrag.startX;
    const dy = event.clientY - pointerDrag.startY;
    if (dx * dx + dy * dy > DRAG_MOVE_THRESHOLD_PX * DRAG_MOVE_THRESHOLD_PX) pointerDrag.moved = true;
  };

  const onPointerUpDrag = (event: Event): void => {
    const gesture = pointerDrag;
    pointerDrag = null;
    if (!gesture || !(event instanceof PointerEvent) || event.pointerId !== gesture.pointerId) return;
    if (gesture.canceled || nativeDragFired || !gesture.moved) return; // cancel / native-dedup / click-jitter
    if (event.button !== 0) return;
    const selection = typeof window.getSelection === "function" ? window.getSelection() : null;
    if (selection && !selection.isCollapsed && String(selection).length > 0) return; // text selection
    if (!gesture.startEl.isConnected) return; // navigation / detachment mid-gesture
    // Identify a CREDIBLE, DISTINCT drop target under the release point — never fabricate from coords.
    const dropEl = document.elementFromPoint(event.clientX, event.clientY);
    if (!dropEl) return;
    const dropTag = tagOf(dropEl);
    if (dropTag === "html" || dropTag === "body") return; // no credible target
    if (dropEl === gesture.startEl) return; // released on the source itself — not a move
    const targetGen = generate(dropEl, { allowPositional: true });
    record({
      type: "drag",
      name: "Drag " + gesture.source.name + " to " + (targetGen.accessibleName || dropTag || "target"),
      locator: gesture.source.locator,
      targetLocator: { ...targetGen.locator }
    });
    // Swallow the synthetic click the browser fires on the common ancestor right after this pointerup.
    suppressClickAfterDrag = true;
  };

  window.addEventListener("pointerdown", onPointerDownDrag, true);
  window.addEventListener("pointermove", onPointerMoveDrag, true);
  window.addEventListener("pointerup", onPointerUpDrag, true);
  window.addEventListener("pointercancel", cancelPointerDrag, true);
  window.addEventListener("lostpointercapture", cancelPointerDrag, true);
  window.addEventListener("scroll", cancelPointerDrag, true);
  window.addEventListener("keydown", (event) => { if (event instanceof KeyboardEvent && event.key === "Escape") cancelPointerDrag(); }, true);

  const onChangeCapture = (event: Event): void => {
    if (insideClosedHostRetarget(event)) return;
    const captured = generateForEvent(event, false);
    if (!captured) return;
    const { target, generated: g, shadow } = captured;
    const tag = tagOf(target);
    if (tag !== "input" && tag !== "select" && tag !== "textarea") return;

    const label = g.accessibleName || (target as HTMLInputElement).name || tag;
    const interaction = captureInteraction(event, target, g, shadow);
    const blueprintCapture = captureBlueprint(target);
    const locator = { ...g.locator, interaction, blueprintCapture };

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
  };
  window.addEventListener("change", onChangeCapture, true);

  // Now that the handlers exist, teach the `attachShadow` wrap to install them inside each closed root,
  // and drain any closed roots created before this point. This is what lets the recorder observe an
  // interaction inside a closed shadow root (Phase C2); the wrap never changes the requested mode.
  installClosedRootCapture = (root: ShadowRoot): void => {
    try {
      root.addEventListener("click", onClickCapture, true);
      root.addEventListener("change", onChangeCapture, true);
    } catch {
      /* detached/invalid root — ignore */
    }
  };
  for (let index = 0; index < closedRootsPendingCapture.length; index += 1) installClosedRootCapture(closedRootsPendingCapture[index]);
  closedRootsPendingCapture.length = 0;

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
      // Rich-text / contenteditable hosts (Notion/Quill/Slate/ProseMirror-style editors) fire 'input'
      // on the editing host, not 'change'. Capture their text like a fill so replay enters the content
      // instead of only clicking the editor. The 'input' event targets the editing host per spec.
      const isEditableHost = tag !== "input" && tag !== "textarea" && !!(target as HTMLElement).isContentEditable;
      if (tag !== "input" && tag !== "textarea" && !isEditableHost) return;
      const type = tag === "input" ? ((target as HTMLInputElement).type || "text").toLowerCase() : "";
      // checkbox/radio fire 'input' too but are recorded as check/uncheck/radio by 'change'.
      if (type === "checkbox" || type === "radio") return;
      const label = g.accessibleName || (target as HTMLInputElement).name || tag;
      const interaction = captureInteraction(event, target, g, shadow);
      const blueprintCapture = captureBlueprint(target);
      const locator = { ...g.locator, interaction, blueprintCapture };
      const rawValue = isEditableHost
        ? ((target as HTMLElement).innerText || target.textContent || "")
        : (target as HTMLInputElement | HTMLTextAreaElement).value;
      // Never store sensitive field values (password/OTP/card/…) in the recorded flow.
      const value = shouldRedactValue(target, type) ? "" : rawValue;
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
