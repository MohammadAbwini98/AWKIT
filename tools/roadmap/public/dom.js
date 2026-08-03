/**
 * DOM construction helpers for the dashboard.
 *
 * Every string this page renders originates in a repository file: bead descriptions, defect bodies
 * and TASK_LOG headings are arbitrary Markdown containing backticks, angle brackets, quotes and
 * `<img>`-shaped text. `el()` therefore assigns through `textContent`, and this module deliberately
 * exposes no innerHTML path at all. That is a correctness guard as much as a security one — a title
 * containing `<4 nodes>` must render as written rather than disappear into a malformed tag.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

export const ROADMAP_SERVER_RESTART_MESSAGE =
  "Restart the roadmap server (npm run roadmap) to enable portable packaging.";

/**
 * Decode an API response without assuming an error body is JSON. This matters when public assets
 * update while an older server process is still running: the old explicit route allowlist returns
 * plain-text `Not found` for a newly added API route.
 * @param {Response} response
 * @returns {Promise<Record<string, any>>}
 */
export async function readApiPayload(response) {
  const body = await response.text();
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return {
      error:
        response.status === 404
          ? ROADMAP_SERVER_RESTART_MESSAGE
          : `Request failed (HTTP ${response.status}).`
    };
  }
}

/**
 * @param {string} tag
 * @param {Record<string, unknown>} [props] `class` / `text` / `on` / `data` are special-cased;
 *   anything else becomes an attribute. `null`, `undefined` and `false` values are skipped.
 * @param {unknown} [children] node, string, or array of either; falsy entries are skipped.
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  applyProps(node, props);
  append(node, children);
  return node;
}

/**
 * Namespaced sibling of `el` — SVG elements created with `createElement` render as unknown HTML
 * and are silently invisible.
 * @param {string} tag
 * @param {Record<string, unknown>} [props]
 * @param {unknown} [children]
 * @returns {SVGElement}
 */
export function svgEl(tag, props = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  applyProps(node, props);
  append(node, children);
  return node;
}

/** @param {unknown} children @returns {DocumentFragment} */
export function frag(children) {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

/** @param {Node} node */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function applyProps(node, props) {
  for (const key of Object.keys(props)) {
    const value = props[key];
    if (value === null || value === undefined || value === false) continue;
    if (key === "text") {
      node.textContent = String(value);
      continue;
    }
    if (key === "on") {
      for (const event of Object.keys(value)) node.addEventListener(event, value[event]);
      continue;
    }
    if (key === "data") {
      for (const k of Object.keys(value)) {
        const v = value[k];
        if (v !== null && v !== undefined && v !== false) node.setAttribute(`data-${k}`, String(v));
      }
      continue;
    }
    node.setAttribute(key, value === true ? "" : String(value));
  }
}

function append(node, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false || child === "") continue;
    node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/* ==========================================================================
   Formatting
   ========================================================================== */

/** @param {string|null} iso @returns {string} */
export function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toISOString().slice(0, 10);
}

/** @param {string|null} iso @returns {string} local wall-clock, for "when was this built" */
export function formatClock(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toTimeString().slice(0, 8);
}

/**
 * @param {string|null} iso
 * @param {number} [now]
 * @returns {string}
 */
export function relativeTime(iso, now = Date.now()) {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return String(iso);
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

/** @param {number} bytes */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** @param {number} count @param {string} singular @param {string} [plural] */
export function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}
