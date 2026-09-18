// Real-Electron walkthrough of the ten pages rebuilt on the approved "SpecterStudio (offline)" design
// (Users, Roles, Permissions, Audit Log, Licensing, Run Artifacts, Recorder, Data Sources, Runtime
// Inputs, Sessions). Launches the built app on an isolated profile, signs in through first-run, visits
// every page and proves the design frame actually mounted — the shared `.sys-page` surface plus each
// page's signature blocks — that nothing overflows the content surface at 1024/1440/1920 widths, that
// the renderer logs no errors, and captures light + dark screenshots as evidence.
//
// What regression makes this fail? A page falling back to an older layout (no `.sys-page` or missing
// its signature block), a block overflowing horizontally, a theme token that stops resolving (sys
// tone fills painting transparent), or a renderer exception on any of the ten routes.
//
// Run: npm run build && npm run verify:system-pages-gui
import { _electron as electron } from "playwright";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isolatedLaunchEnv, resolveMainWindow, signInFirstRun } from "./lib/gui-verify-harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shotDir = path.join(root, "test-artifacts", "system-pages");
mkdirSync(shotDir, { recursive: true });
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail: detail ? String(detail) : "" });
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

/** label = exact nav text; blocks = selectors that must each match at least `min` elements. */
const PAGES = [
  { label: "Users", slug: "users", title: "Users", blocks: [[".sys-admin-head h1", 1], [".sys-metric", 4], [".sys-filters", 1], [".sys-table-card", 1]] },
  { label: "Roles", slug: "roles", title: "Roles", blocks: [[".sys-admin-head h1", 1], [".sys-banner", 1], [".sys-panel", 5], [".sys-check-row", 7]] },
  { label: "Permissions", slug: "permissions", title: "Permissions", blocks: [[".sys-admin-head h1", 1], [".sys-banner", 1], [".sys-table-card", 1], [".sys-table tr.is-group", 1]] },
  { label: "Audit Log", slug: "audit-log", title: "Audit Log", blocks: [[".sys-admin-head h1", 1], [".sys-filters", 1], [".sys-table-card", 1]] },
  { label: "Licensing", slug: "licensing", title: "Licensing", blocks: [[".sys-admin-head h1", 1], [".sys-metric", 4], [".sys-kv-item", 6], [".sys-panel", 3]] },
  { label: "Run Artifacts", slug: "run-artifacts", blocks: [[".sys-filters", 1], [".sys-table-card", 1], [".report-card", 1], [".sys-kpi", 4]] },
  { label: "Recorder", slug: "recorder", blocks: [[".sys-metric", 4], [".sys-panel", 3]] },
  { label: "Data Sources", slug: "data-sources", blocks: [[".sys-filters", 1], [".sys-table-card", 1]] },
  { label: "Runtime Inputs", slug: "runtime-inputs", blocks: [[".sys-section", 1], [".sys-panel", 2], [".sys-field", 4]] },
  { label: "Sessions", slug: "sessions", blocks: [[".sys-banner", 1], [".sys-panel", 2], [".sys-list-row", 1]] }
];

const { env, dataRoot, electronArgs, cleanup } = isolatedLaunchEnv("awkit-system-pages");

// Seed one READY session profile so the Sessions list renders a real row (the profile directory must
// exist or SessionCaptureService flips the status to "error" on list()).
{
  const profilesRoot = path.join(dataRoot, "SpecterStudio", "profiles");
  const profileDir = path.join(profilesRoot, "verify-system-pages-profile");
  mkdirSync(path.join(profileDir, "Default"), { recursive: true });
  writeFileSync(
    path.join(profilesRoot, "session-profiles.json"),
    JSON.stringify([
      {
        id: "verify-system-pages-profile",
        name: "System pages verifier session",
        profileDir,
        targetUrl: "https://example.test/login",
        origin: "https://example.test",
        source: "manual",
        createdAt: new Date().toISOString(),
        status: "ready"
      }
    ], null, 2),
    "utf8"
  );
}

// Seed one stored run report so Run Artifacts renders a populated row (and its widgets), not only
// the empty state — a legacy `.report-card { display: grid }` rule once turned these <tr>s into
// grid boxes and hid the row actions, which an empty-state walkthrough could never see.
{
  const reportsDir = path.join(dataRoot, "SpecterStudio", "reports");
  mkdirSync(reportsDir, { recursive: true });
  const startedAt = new Date(Date.now() - 120_000).toISOString();
  writeFileSync(
    path.join(reportsDir, "rep-system-pages-001.json"),
    JSON.stringify({
      id: "rep-system-pages-001",
      executionId: "rep-system-pages-001",
      scenarioId: "wf-system-pages",
      scenarioName: "System pages verifier workflow",
      runMode: "single",
      maxConcurrentInstances: 1,
      status: "failed",
      startedAt,
      endedAt: new Date(Date.parse(startedAt) + 2_100).toISOString(),
      durationMs: 2_100,
      passedFlows: 0,
      failedFlows: 1,
      skippedFlows: 0,
      instances: [{ instanceId: "run-system-pages-00", status: "failed", durationMs: 2_100, error: "Synthetic failure", screenshots: [], downloadedFiles: [] }]
    }, null, 2),
    "utf8"
  );
}

const app = await electron.launch({ args: [root, ...electronArgs], cwd: root, env });
const consoleErrors = [];
try {
  const win = await resolveMainWindow(app);
  win.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  await win.waitForLoadState("domcontentloaded");
  await signInFirstRun(win);
  await win.setViewportSize({ width: 1440, height: 900 });

  const nav = async (label) => {
    const found = await win.evaluate((text) => {
      const item = [...document.querySelectorAll("button.nav-item")].find((b) => (b.textContent || "").trim() === text);
      item?.click();
      return Boolean(item);
    }, label);
    await win.waitForTimeout(600);
    return found;
  };

  for (const page of PAGES) {
    const reached = await nav(page.label);
    check(`${page.label}: navigation item exists`, reached);
    await win.waitForSelector(".sys-page", { timeout: 10000 }).catch(() => undefined);
    const state = await win.evaluate(({ blocks, title }) => {
      const surface = document.querySelector(".sys-page");
      const main = document.querySelector(".main-surface");
      if (!surface || !main) return { mounted: false };
      const heading = surface.querySelector(".sys-admin-head h1")?.textContent?.trim() ?? null;
      const counts = Object.fromEntries(blocks.map(([selector]) => [selector, surface.querySelectorAll(selector).length]));
      // Tone fills must resolve to a painted (non-transparent) background in the current theme.
      const tone = surface.querySelector(".sys-tile, .sys-badge");
      const toneBg = tone ? getComputedStyle(tone).backgroundColor : "none";
      return {
        mounted: true,
        heading,
        headingOk: title ? heading === title : true,
        counts,
        blocksOk: blocks.every(([selector, min]) => counts[selector] >= min),
        toneBg,
        tonePainted: tone ? !/rgba\(0, 0, 0, 0\)|transparent/.test(toneBg) : true
      };
    }, { blocks: page.blocks, title: page.title });
    check(`${page.label}: design surface (.sys-page) is mounted`, state.mounted);
    check(`${page.label}: signature blocks render`, state.mounted && state.blocksOk && state.headingOk, JSON.stringify({ heading: state.heading, counts: state.counts }));
    check(`${page.label}: tone tiles/badges paint a token fill`, state.mounted && state.tonePainted, state.toneBg);

    if (page.slug === "run-artifacts") {
      // The stored-report row must stay a real table row, and each row action must be the element a
      // pointer actually hits at its centre (nothing clipping or covering it).
      const row = await win.evaluate(() => {
        const tr = document.querySelector("tr.report-card");
        if (!tr) return null;
        const actions = [...tr.querySelectorAll(".sys-cell-actions button")].map((button) => {
          button.scrollIntoView({ block: "center", inline: "center" });
          const box = button.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return { id: button.id, reachable: Boolean(hit && (hit === button || button.contains(hit))) };
        });
        return { display: getComputedStyle(tr).display, actions };
      });
      check(
        "Run Artifacts: a stored report renders as a table row with every action reachable",
        row !== null && row.display === "table-row" && row.actions.length === 4 && row.actions.every((action) => action.reachable),
        JSON.stringify(row)
      );
    }

    const containment = [];
    for (const width of [1024, 1440, 1920]) {
      await win.setViewportSize({ width, height: 900 });
      await win.waitForTimeout(120);
      containment.push(await win.evaluate((w) => {
        const surface = document.querySelector(".sys-page");
        const main = document.querySelector(".main-surface");
        if (!surface || !main) return { width: w, ok: false };
        const surfaceRect = surface.getBoundingClientRect();
        const mainRect = main.getBoundingClientRect();
        // A block that is wider than the page (not an intentional inner scroller) breaks containment.
        const escaping = [...surface.children].filter((child) => child.getBoundingClientRect().right > mainRect.right + 1).length;
        return {
          width: w,
          ok: surface.scrollWidth <= surface.clientWidth + 1 && surfaceRect.right <= mainRect.right + 1 && escaping === 0 && main.scrollWidth <= main.clientWidth + 1
        };
      }, width));
    }
    check(`${page.label}: contained at 1024/1440/1920`, containment.every((item) => item.ok), JSON.stringify(containment));

    await win.setViewportSize({ width: 1440, height: 900 });
    await win.evaluate(() => document.querySelector(".main-surface")?.scrollTo({ top: 0, left: 0 }));
    for (const theme of ["light", "dark"]) {
      await win.evaluate((next) => document.documentElement.setAttribute("data-theme", next), theme);
      await win.waitForTimeout(250);
      await win.screenshot({ path: path.join(shotDir, `${page.slug}-${theme}.png`), fullPage: true, animations: "disabled" }).catch(() => undefined);
    }
    await win.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  }

  check("no renderer console errors across the ten pages", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
} finally {
  await app.close().catch(() => undefined);
  cleanup();
}

const passed = results.filter((r) => r.pass).length;
writeFileSync(path.join(shotDir, "results.json"), JSON.stringify({ passed, total: results.length, results }, null, 2));
console.log(`\nSystem pages GUI: ${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
