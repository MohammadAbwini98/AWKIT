/**
 * Dashboard shell — state, routing, theme, and liveness.
 *
 * The page holds exactly one snapshot at a time and re-renders the active view from it. There is no
 * client-side derivation of any number shown: every count comes from the server's model, so what
 * the page displays and what the verifier asserts are the same values.
 *
 * Liveness is push-then-pull. The server watches the repository and pushes a bare notification over
 * SSE; the client responds by re-fetching /api/snapshot with If-None-Match. A re-fetch also happens
 * on every `open`, so a change that lands while the connection is down is picked up on reconnect
 * rather than leaving the page silently frozen on stale data.
 */

import { clear, el, formatClock, plural } from "./dom.js";
import { icon } from "./icons.js";
import { VIEWS } from "./views.js";

const THEME_KEY = "awkit-roadmap-theme";
const THEME_MODES = ["system", "light", "dark"];

const dom = {
  nav: document.getElementById("rm-nav"),
  view: document.getElementById("rm-view"),
  title: document.getElementById("rm-title"),
  subtitle: document.getElementById("rm-subtitle"),
  filter: document.getElementById("rm-filter"),
  freshness: document.getElementById("rm-freshness"),
  packagePortable: document.getElementById("rm-package-portable"),
  buildStatus: document.getElementById("rm-build-status"),
  refresh: document.getElementById("rm-refresh"),
  status: document.getElementById("rm-status"),
  live: document.getElementById("rm-live"),
  liveLabel: document.getElementById("rm-live-label"),
  theme: document.getElementById("rm-theme"),
  themeIcon: document.getElementById("rm-theme-icon"),
  themeLabel: document.getElementById("rm-theme-label")
};

const state = {
  /** @type {Record<string, any>|null} */
  snap: null,
  /** @type {Map<string, any>} */
  byId: new Map(),
  etag: "",
  viewId: "overview",
  filter: "",
  /** @type {Array<() => void>} */
  disposers: [],
  /** @type {Array<() => void>} */
  mounters: [],
  /** @type {Record<string, any>|null} */
  portableBuild: null,
  portablePoll: 0
};

/* ==========================================================================
   Theme — mirrors the application's own contract: data-theme on <html>.
   ========================================================================== */

const media = window.matchMedia("(prefers-color-scheme: dark)");

function themeMode() {
  const stored = localStorage.getItem(THEME_KEY);
  return THEME_MODES.includes(stored) ? stored : "system";
}

function applyTheme() {
  const mode = themeMode();
  const resolved = mode === "system" ? (media.matches ? "dark" : "light") : mode;
  document.documentElement.dataset.theme = resolved;
  dom.themeLabel.textContent = mode === "system" ? "System theme" : mode === "dark" ? "Dark theme" : "Light theme";
  clear(dom.themeIcon);
  dom.themeIcon.appendChild(icon(mode === "system" ? "monitor" : mode === "dark" ? "moon" : "sun", 16));
}

dom.theme.addEventListener("click", () => {
  const next = THEME_MODES[(THEME_MODES.indexOf(themeMode()) + 1) % THEME_MODES.length];
  localStorage.setItem(THEME_KEY, next);
  applyTheme();
});
media.addEventListener("change", () => {
  if (themeMode() === "system") applyTheme();
});
applyTheme();

/* ==========================================================================
   Routing
   ========================================================================== */

function viewFromHash() {
  const id = window.location.hash.replace(/^#\/?/, "");
  return VIEWS.some((v) => v.id === id) ? id : "overview";
}

function navigate(id) {
  if (window.location.hash === `#/${id}`) {
    state.viewId = id;
    render();
    return;
  }
  window.location.hash = `#/${id}`;
}

window.addEventListener("hashchange", () => {
  state.viewId = viewFromHash();
  render();
});
state.viewId = viewFromHash();

/* ==========================================================================
   Filter
   ========================================================================== */

let filterTimer = 0;
dom.filter.addEventListener("input", () => {
  window.clearTimeout(filterTimer);
  filterTimer = window.setTimeout(() => {
    state.filter = dom.filter.value.trim();
    render();
  }, 120);
});

dom.refresh.addEventListener("click", async () => {
  dom.refresh.disabled = true;
  try {
    await fetch("/api/refresh", { method: "POST" });
    await load(true);
  } finally {
    dom.refresh.disabled = false;
  }
});

dom.packagePortable.addEventListener("click", async () => {
  const confirmed = window.confirm(
    "Generate a new portable EXE now?\n\n" +
      "This runs the repository's full portable packaging pipeline. It can refresh the dependency manifest " +
      "and replace the existing portable artifact under dist/. Offline inputs and approved signing-key " +
      "custody must already be available."
  );
  if (!confirmed) return;

  dom.packagePortable.disabled = true;
  try {
    const response = await fetch("/api/package-portable", {
      method: "POST",
      headers: { "X-AWKIT-Roadmap-Action": "package-portable" }
    });
    const payload = await response.json();
    if (!response.ok && response.status !== 409) throw new Error(payload.error ?? `HTTP ${response.status}`);
    state.portableBuild = payload.build;
    renderPortableBuild();
    schedulePortablePoll();
  } catch (error) {
    dom.buildStatus.dataset.state = "failed";
    dom.buildStatus.textContent = error instanceof Error ? error.message : String(error);
    dom.packagePortable.disabled = false;
  }
});

async function loadPortableBuild() {
  try {
    const response = await fetch("/api/package-portable");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.portableBuild = await response.json();
    renderPortableBuild();
    schedulePortablePoll();
  } catch {
    dom.buildStatus.dataset.state = "failed";
    dom.buildStatus.textContent = "Build status unavailable";
  }
}

function schedulePortablePoll() {
  window.clearTimeout(state.portablePoll);
  if (state.portableBuild?.state !== "running") return;
  state.portablePoll = window.setTimeout(loadPortableBuild, 1000);
}

function renderPortableBuild() {
  const build = state.portableBuild;
  const running = build?.state === "running";
  dom.packagePortable.disabled = running;
  dom.packagePortable.textContent = running ? "Building portable EXE…" : "Generate portable EXE";
  dom.buildStatus.dataset.state = build?.state ?? "idle";
  dom.buildStatus.title = "";

  if (!build || build.state === "idle") {
    dom.buildStatus.textContent = "";
  } else if (running) {
    dom.buildStatus.textContent = "Packaging in progress";
  } else if (build.state === "succeeded") {
    dom.buildStatus.textContent = "Portable EXE ready";
    dom.buildStatus.title = build.artifact ?? "dist/";
  } else {
    dom.buildStatus.textContent = build.errorCode === "SPAWN_FAILED" ? "Could not start packaging" : "Portable build failed";
    dom.buildStatus.title = build.exitCode === null ? "" : `Exit code ${build.exitCode}`;
  }
}

/* ==========================================================================
   Data
   ========================================================================== */

/** @param {boolean} [force] bypass the ETag so a manual Refresh always re-reads. */
async function load(force = false) {
  try {
    const headers = !force && state.etag ? { "If-None-Match": state.etag } : {};
    const response = await fetch("/api/snapshot", { headers });
    if (response.status === 304) {
      setLive("live", "Live");
      return;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.etag = response.headers.get("ETag") ?? "";
    state.snap = await response.json();
    state.byId = new Map(state.snap.items.map((item) => [item.id, item]));
    setLive("live", "Live");
    render();
  } catch (error) {
    setLive("offline", "Server unreachable");
    if (!state.snap) {
      clear(dom.view);
      dom.view.appendChild(
        el("p", {
          class: "rm-empty",
          text: `Could not read the snapshot: ${error instanceof Error ? error.message : String(error)}`
        })
      );
    }
  }
}

function connect() {
  const source = new EventSource("/api/events");
  // Re-fetch on open as well as on push: a change that landed while the connection was down would
  // otherwise never be noticed, leaving a page that claims to be live but is not.
  source.addEventListener("open", () => load());
  source.addEventListener("snapshot", () => load());
  source.addEventListener("error", () => setLive("stale", "Reconnecting…"));
}

/** @param {"live"|"stale"|"offline"|"connecting"} status @param {string} label */
function setLive(status, label) {
  dom.live.dataset.state = status;
  dom.liveLabel.textContent = label;
}

/* ==========================================================================
   Render
   ========================================================================== */

function renderNav() {
  const snap = state.snap;
  clear(dom.nav);
  for (const view of VIEWS) {
    const count = snap ? view.count(snap) : null;
    dom.nav.appendChild(
      el(
        "button",
        {
          type: "button",
          class: `nav-item${view.id === state.viewId ? " active" : ""}`,
          "aria-current": view.id === state.viewId ? "page" : null,
          on: { click: () => navigate(view.id) }
        },
        [
          icon(view.icon, 16),
          el("span", { text: view.label }),
          count === null ? null : el("span", { class: "rm-nav-count", text: String(count) })
        ]
      )
    );
  }
}

function render() {
  for (const dispose of state.disposers) dispose();
  state.disposers = [];
  state.mounters = [];

  renderNav();
  const snap = state.snap;
  if (!snap) return;

  const view = VIEWS.find((v) => v.id === state.viewId) ?? VIEWS[0];
  dom.title.textContent = view.title;
  dom.subtitle.textContent = view.subtitle(snap);
  dom.freshness.textContent = `snapshot ${formatClock(snap.generatedAt)}`;

  const ctx = {
    snap,
    items: snap.items,
    byId: state.byId,
    filter: state.filter,
    navigate,
    setFilter: (value) => {
      state.filter = value;
      dom.filter.value = value;
    },
    rerender: render,
    onDispose: (fn) => state.disposers.push(fn),
    // Anything that needs real layout — measuring a placed node, for instance — registers here and
    // runs once the view is actually in the document, where getBoundingClientRect is meaningful.
    onMount: (fn) => state.mounters.push(fn)
  };

  clear(dom.view);
  const body = el("div", { class: "rm-stack rm-view-enter" });
  body.appendChild(view.render(ctx));
  dom.view.appendChild(body);
  dom.view.scrollTop = 0;
  for (const mount of state.mounters) mount();

  const degraded = snap.sources.filter((s) => !s.ok).length;
  clear(dom.status);
  dom.status.appendChild(
    el("span", {
      text: [
        `snapshot ${formatClock(snap.generatedAt)}`,
        `${snap.sources.length} sources`,
        `${snap.stats.items} records`,
        plural(snap.warnings.length, "warning"),
        degraded > 0 ? `${degraded} unreadable` : null
      ]
        .filter(Boolean)
        .join(" · ")
    })
  );
}

renderNav();
setLive("connecting", "Connecting…");
Promise.all([load(), loadPortableBuild()]).then(connect);
