import { createPageFingerprint } from "../locatorFingerprint";

/**
 * In-page code for L11 DOM intelligence, as plain source strings (never transpiled closures — esbuild's
 * `keepNames` `__name` wrapper does not exist in the page).
 *
 * ONE set of sanitization helpers serves both the Recorder's reference capture and the snapshot
 * serializer. A provider compares raw attribute and text strings, so a reference sanitized one way and a
 * candidate page sanitized another would score apart for no reason; sharing the helpers makes that
 * impossible by construction.
 *
 * What never leaves the page (plan E6): script/style/template/noscript bodies, comments, SVG and media
 * bodies, `value`, event handlers, `style`, `srcdoc`, query strings and fragments, password,
 * one-time-code and hidden inputs, textarea contents. A document with a protected-login field is refused
 * outright. Shadow roots are not serialized.
 */

/** Selector for a protected-login document: never captured, never serialized. */
export const PROTECTED_LOGIN_SELECTOR =
  'input[type="password"],input[autocomplete="one-time-code"],input[autocomplete="current-password"],input[autocomplete="new-password"]';

/** Attributes a reference or a serialized element may carry (after `aria-` state is excluded). */
export const DOM_ATTRIBUTE_ALLOWLIST = Object.freeze([
  "id",
  "name",
  "type",
  "role",
  "placeholder",
  "title",
  "alt",
  "for",
  "href",
  "class",
  "data-testid",
  "data-test",
  "data-qa",
  "data-cy",
  "aria-label",
  "aria-labelledby",
  "aria-describedby",
  "aria-controls",
  "aria-haspopup",
  "aria-roledescription",
  "aria-placeholder"
]);

/** Tags whose content never leaves the page (the element itself is dropped). */
const DROPPED_TAGS = ["script", "style", "template", "noscript", "link", "meta", "base", "object", "embed", "iframe", "frame", "frameset"];
/** Tags kept as an empty element: their bodies are markup or media, not identity. */
const EMPTY_TAGS = ["svg", "math", "canvas", "video", "audio", "picture", "textarea", "select"];
const VOID_TAGS = ["area", "br", "col", "hr", "img", "input", "source", "track", "wbr"];

/** Shared helpers, evaluated once per page function. */
const HELPERS = `
  var ALLOWED = ${JSON.stringify(DOM_ATTRIBUTE_ALLOWLIST)};
  var DROPPED = ${JSON.stringify(DROPPED_TAGS)};
  var EMPTY = ${JSON.stringify(EMPTY_TAGS)};
  var VOID = ${JSON.stringify(VOID_TAGS)};
  var PROTECTED = ${JSON.stringify(PROTECTED_LOGIN_SELECTOR)};
  var norm = function (value, max) {
    return String(value || "").replace(/\\s+/g, " ").trim().slice(0, max);
  };
  var sensitiveInput = function (el) {
    if (el.tagName.toLowerCase() !== "input") return false;
    var type = (el.getAttribute("type") || "").toLowerCase();
    var auto = (el.getAttribute("autocomplete") || "").toLowerCase();
    return type === "password" || type === "hidden" || auto === "one-time-code" || auto === "current-password" || auto === "new-password";
  };
  var cleanClass = function (value) {
    var kept = [];
    var tokens = String(value || "").split(/\\s+/);
    for (var t = 0; t < tokens.length && kept.length < 8; t++) {
      var token = tokens[t];
      if (!/^[A-Za-z][A-Za-z0-9_-]{1,40}$/.test(token)) continue;
      if (/\\d.*\\d.*\\d/.test(token)) continue;
      if (/^(css|sc|jsx|emotion|makeStyles|Mui[A-Za-z]*-root)-/.test(token)) continue;
      if (/_[A-Za-z0-9]{5,}$/.test(token) && /[0-9]/.test(token)) continue;
      kept.push(token);
    }
    return kept.join(" ");
  };
  var cleanHref = function (value, base) {
    try {
      var url = new URL(value, base);
      if (url.protocol !== "http:" && url.protocol !== "https:") return "";
      return norm(url.pathname, 120);
    } catch (error) {
      return "";
    }
  };
  var attributesOf = function (el) {
    var out = {};
    for (var a = 0; a < ALLOWED.length; a++) {
      var key = ALLOWED[a];
      if (!el.hasAttribute(key)) continue;
      var raw = el.getAttribute(key);
      var value = key === "class" ? cleanClass(raw) : key === "href" ? cleanHref(raw, el.ownerDocument.baseURI) : norm(raw, 120);
      if (value) out[key] = value;
    }
    return out;
  };
  var leadingText = function (el) {
    var text = "";
    for (var node = el.firstChild; node; node = node.nextSibling) {
      if (node.nodeType === 1) break;
      if (node.nodeType === 3) text += node.nodeValue;
    }
    return norm(text, 120);
  };
`;

/**
 * `(element) => raw reference | null`: an allowlisted, bounded, element-local description in the shape a
 * parser-only matcher compares (tag, attributes, leading text, tag path, parent, sibling and child tags).
 * Null for a protected-login document, a sensitive input or a shadow-scoped element.
 */
export const DOM_REFERENCE_CAPTURE_SOURCE = `function (el) {
  ${HELPERS}
  if (!el || el.nodeType !== 1) return null;
  var doc = el.ownerDocument;
  if (doc.querySelector(PROTECTED)) return null;
  if (sensitiveInput(el)) return null;
  var root = el.getRootNode ? el.getRootNode() : doc;
  if (root !== doc) return null;
  var path = [];
  for (var cursor = el; cursor && cursor.nodeType === 1; cursor = cursor.parentElement) path.unshift(cursor.tagName.toLowerCase());
  var parent = el.parentElement;
  var siblings = [];
  var children = [];
  if (parent) {
    for (var s = 0; s < parent.children.length && siblings.length < 20; s++) {
      if (parent.children[s] !== el) siblings.push(parent.children[s].tagName.toLowerCase());
    }
  }
  for (var c = 0; c < el.children.length && children.length < 20; c++) children.push(el.children[c].tagName.toLowerCase());
  return {
    tag: el.tagName.toLowerCase(),
    attributes: attributesOf(el),
    text: el.tagName.toLowerCase() === "textarea" ? "" : leadingText(el),
    path: path.slice(-12),
    parent: parent ? { tag: parent.tagName.toLowerCase(), attributes: attributesOf(parent), text: leadingText(parent).slice(0, 80) } : null,
    siblings: siblings,
    children: children
  };
}`;

/**
 * Snapshot serializer for `frame.locator("body *").evaluateAll(fn, arg)`.
 *
 * Returns sanitized HTML of `document.body` in which every VISIBLE element of Playwright's `body *` list
 * carries `data-awkit-v="<its index>"` (in the serialized copy only; the live DOM is never touched), so a
 * provider candidate maps back to exactly `frame.locator("body *").nth(index)`. It also returns the
 * pruned fingerprints of visible elements sharing the expected tag or role (the proof's competitor set,
 * plan E2), keyed by the same index. `arg.mode === "normalize"` additionally drops hidden subtrees.
 */
export const DOM_SNAPSHOT_SERIALIZER_BODY = `
  ${HELPERS}
  var fingerprint = (${createPageFingerprint.toString()});
  var doc = document;
  // L12.17: only a Super User's opted-in diagnosis of an allowed sign-in or MFA page reads such a document;
  // its password, one-time-code and hidden inputs are still dropped below, and no value is ever written.
  if (!arg.allowProtected && doc.querySelector(PROTECTED)) return { refused: "protected-login" };
  // L12.21: under that override, a challenge widget or any refused reason's wording in THIS document, checked in
  // the same evaluate that serializes it, refuses the read (no gap for a widget that renders after a pre-check).
  if (arg.allowProtected) {
    if (doc.querySelector(arg.challenge)) return { refused: "protected-login" };
    var said = String(doc.title + "\\n" + (doc.body ? doc.body.innerText : "")).replace(/[\\u2018\\u2019]/g, "'").replace(/\\s+/g, " ").toLowerCase();
    for (var rt = 0; rt < arg.refusedText.length; rt++) {
      if (said.indexOf(arg.refusedText[rt]) >= 0) return { refused: "protected-login" };
    }
  }
  var visibleOf = function (root) {
    var style = root.ownerDocument.defaultView ? root.ownerDocument.defaultView.getComputedStyle(root) : null;
    if (!style) return true;
    if (style.display === "contents") {
      for (var child = root.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 1 && visibleOf(child)) return true;
        if (child.nodeType === 3) {
          var range = child.ownerDocument.createRange();
          range.selectNode(child);
          var r = range.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return true;
        }
      }
      return false;
    }
    if (typeof root.checkVisibility === "function" && !root.checkVisibility()) return false;
    if (style.visibility !== "visible") return false;
    var rect = root.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  var indexOf = new Map();
  var visibleCount = 0;
  var kept = [];
  var truncatedKept = false;
  for (var i = 0; i < elements.length; i++) {
    var el = elements[i];
    if (!visibleOf(el)) continue;
    visibleCount++;
    indexOf.set(el, i);
    if (arg.tag !== undefined) {
      var print = fingerprint(el);
      if (print.tag === arg.tag || (arg.role !== "" && print.role === arg.role)) {
        if (kept.length >= arg.cap) truncatedKept = true;
        else kept.push({ i: i, f: print });
      }
    }
  }
  var escapeText = function (value) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); };
  var escapeAttr = function (value) { return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); };
  var parts = ["<html><body>"];
  var bytes = 12;
  var truncated = false;
  var hiddenDropped = 0;
  var stack = [];
  for (var child = doc.body ? doc.body.lastChild : null; child; child = child.previousSibling) stack.push({ node: child });
  while (stack.length) {
    var item = stack.pop();
    if (item.close) { parts.push(item.close); bytes += item.close.length; continue; }
    var node = item.node;
    if (node.nodeType === 3) {
      if (node.parentElement && node.parentElement.tagName.toLowerCase() === "textarea") continue;
      var text = norm(node.nodeValue, 200);
      if (!text) continue;
      if (bytes + text.length > arg.maxBytes) { truncated = true; break; }
      var escaped = escapeText(text);
      parts.push(escaped);
      bytes += escaped.length;
      continue;
    }
    if (node.nodeType !== 1) continue;
    var tag = node.tagName.toLowerCase();
    if (DROPPED.indexOf(tag) >= 0 || sensitiveInput(node)) continue;
    var index = indexOf.get(node);
    if (arg.mode === "normalize") {
      // Hidden content never reaches AI context: the L10.0 leak was static text of CSS-hidden and
      // [hidden] nodes. Zero-size wrappers are kept, since their children can still be visible.
      if (node.hasAttribute("hidden") || node.getAttribute("aria-hidden") === "true") { hiddenDropped++; continue; }
      var computed = node.ownerDocument.defaultView ? node.ownerDocument.defaultView.getComputedStyle(node) : null;
      if (computed && (computed.display === "none" || computed.visibility === "hidden" || computed.visibility === "collapse")) { hiddenDropped++; continue; }
    }
    var attrs = attributesOf(node);
    if (arg.mode === "normalize") {
      // AI context needs a control's STATE (never its value): disabled, required, invalid. Recovery mode
      // keeps the identity allowlist only, so references and candidates still compare like with like.
      if (node.disabled === true || node.getAttribute("aria-disabled") === "true") attrs.disabled = "disabled";
      if (node.required === true || node.getAttribute("aria-required") === "true") attrs.required = "required";
      var userInvalid = false;
      try { userInvalid = node.matches(":user-invalid"); } catch (error) { userInvalid = false; }
      if (node.getAttribute("aria-invalid") === "true" || userInvalid) attrs["aria-invalid"] = "true";
    }
    var open = "<" + tag;
    for (var key in attrs) open += " " + key + '="' + escapeAttr(attrs[key]) + '"';
    if (index !== undefined) open += ' data-awkit-v="' + index + '"';
    open += ">";
    if (bytes + open.length > arg.maxBytes) { truncated = true; break; }
    parts.push(open);
    bytes += open.length;
    if (VOID.indexOf(tag) >= 0) continue;
    var close = "</" + tag + ">";
    if (EMPTY.indexOf(tag) >= 0) { parts.push(close); bytes += close.length; continue; }
    stack.push({ close: close });
    for (var grand = node.lastChild; grand; grand = grand.previousSibling) stack.push({ node: grand });
  }
  if (truncated) {
    for (var s = stack.length - 1; s >= 0; s--) if (stack[s].close) parts.push(stack[s].close);
  }
  parts.push("</body></html>");
  return {
    html: parts.join(""),
    truncated: truncated,
    elements: elements.length,
    visible: visibleCount,
    kept: kept,
    keptTruncated: truncatedKept,
    hiddenDropped: hiddenDropped,
    title: norm(doc.title, 120)
  };
`;
