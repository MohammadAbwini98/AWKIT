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

  // Elements that plausibly expose the given ARIA role (used to count role matches).
  const elementsForRole = (role: string): Element[] => {
    const map: Record<string, string> = {
      button: "button, [role=button], input[type=submit], input[type=button], input[type=reset]",
      link: "a[href], [role=link]",
      textbox: "input[type=text], input[type=email], input[type=tel], input[type=url], input[type=search], input:not([type]), textarea, [role=textbox]",
      checkbox: "input[type=checkbox], [role=checkbox]",
      radio: "input[type=radio], [role=radio]",
      combobox: "select, [role=combobox]",
      heading: "h1,h2,h3,h4,h5,h6,[role=heading]",
      img: "img[alt], [role=img]"
    };
    const selector = map[role] || "[role=" + role + "]";
    try {
      return Array.prototype.slice.call(document.querySelectorAll(selector));
    } catch {
      return [];
    }
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
  const structuralSelector = (el: Element): string => {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node.nodeType === 1 && tagOf(node) !== "html") {
      if ((node as HTMLElement).id && !looksGeneratedId((node as HTMLElement).id)) {
        parts.unshift("#" + ident((node as HTMLElement).id));
        break;
      }
      let part = tagOf(node);
      const current: Element = node;
      const parent: Element | null = current.parentElement;
      if (parent) {
        const sameTag = Array.prototype.slice.call(parent.children).filter((c: Element) => c.tagName === current.tagName);
        if (sameTag.length > 1) part += ":nth-of-type(" + (sameTag.indexOf(current) + 1) + ")";
      }
      parts.unshift(part);
      node = parent;
      if (parts.length > 6) break;
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

    const structural = structuralSelector(el);
    if (structural) out.push({ strategy: "css", value: structural, count: q(structural), fallback: true });

    return out;
  };

  interface Quality {
    strategy: string;
    isUnique: boolean;
    matchCount: number;
    confidence: string;
    warning?: string;
    candidateCount: number;
  }

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

    const isUnique = chosen.count === 1;
    const semantic = chosen.strategy === "role" || chosen.strategy === "label" || chosen.strategy === "placeholder" || chosen.strategy === "testId";
    const confidence = !isUnique ? "low" : chosen.fallback ? "low" : semantic ? "high" : "medium";

    const quality: Quality = {
      strategy: chosen.fallback ? "fallback" : chosen.strategy,
      isUnique,
      matchCount: chosen.count,
      confidence,
      candidateCount: candidates.length
    };
    if (!isUnique) {
      quality.warning = "This locator matches " + chosen.count + " elements. The recorder could not find a unique locator — this step may fail in Playwright strict mode. Re-record or refine it.";
    } else if (chosen.fallback) {
      quality.warning = "Positional fallback locator — it may break if the page layout changes.";
    }

    const locator: Record<string, unknown> = { strategy: chosen.strategy, value: chosen.value, quality };
    if (chosen.name) locator.name = chosen.name;
    if (chosen.exact) locator.exact = true;

    return { locator, quality, accessibleName: accessibleName(el) };
  };

  // Climb to the nearest meaningful interactive element for a raw click target.
  const interactiveTarget = (el: Element): Element => {
    const candidate = el.closest
      ? el.closest('a[href], button, input, select, textarea, label, summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [onclick]')
      : null;
    return (candidate as Element) || el;
  };

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
