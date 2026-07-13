// Large-graph performance measurement for the Flow Designer (report tool, not a pass/fail gate).
//
// Seeds flows of 40 / 100 / 200 / 500 nodes (realistic vertical chain + periodic branches) into the
// REAL built Electron app and measures load time, interaction wall-time + React re-render counts
// (via the opt-in render probe), save time, flow-switch time, and JS heap growth after repeated
// switching. Also does a navigation-leak check (designer ⇆ reports) tracking DOM node count + heap.
//
// Run: node scripts/measure-large-graphs.mjs   (after `npm run build`)
import { _electron as electron } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const SIZES = [40, 100, 200, 500];
const seedIds = SIZES.map((n) => `perf-large-${n}`);

const app = await electron.launch({ args: [root], cwd: root, env });
const rows = [];
try {
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");

  // Seed all sizes up front.
  await win.evaluate(async (sizes) => {
    for (const N of sizes) {
      const nodes = [];
      const edges = [];
      for (let i = 0; i < N; i++) {
        const id = i === 0 ? "start" : i === N - 1 ? "end" : `n-${i}`;
        const type = i === 0 ? "start" : i === N - 1 ? "end" : i % 5 === 0 ? "assertVisible" : i % 3 === 0 ? "fill" : "click";
        nodes.push({
          id, type, name: `${type} ${i}`, description: "perf node",
          position: { x: 240 + (i % 4) * 260, y: 120 + i * 90 },
          locator: type === "click" || type === "fill" ? { strategy: "role", value: `el-${i}` } : undefined,
          retry: { count: 0, delayMs: 1000 }, onFailure: { action: "stop", screenshot: true },
          size: { width: 220, height: 96 }, config: {}
        });
        if (i > 0) edges.push({ id: `e-${i}`, source: nodes[i - 1].id, target: id, type: i === 1 ? "always" : "success" });
      }
      const now = new Date().toISOString();
      const profile = { id: `perf-large-${N}`, name: `Perf Large ${N}`, description: "perf", version: 1, nodes, edges, createdAt: now, updatedAt: now };
      const existing = await window.playwrightFlowStudio.flows.get(profile.id);
      if (existing) await window.playwrightFlowStudio.flows.update(profile.id, profile);
      else await window.playwrightFlowStudio.flows.create(profile);
    }
  }, SIZES);

  const heap = () => win.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1));
  const enable = () => win.evaluate(() => { window.__awkitRenderProbe = { node: 0, edge: 0, card: 0 }; });
  const readProbe = () => win.evaluate(() => ({ ...window.__awkitRenderProbe }));

  for (const N of SIZES) {
    // Open this flow and time load → first render.
    await win.evaluate((id) => window.playwrightFlowStudio.settings.update({ selections: { lastSelectedFlowId: id }, lastRouteId: "flowChart" }), `perf-large-${N}`);
    const t0 = Date.now();
    await win.reload();
    await win.waitForLoadState("domcontentloaded");
    if (!(await win.$(".action-flow-node"))) await win.click('button.nav-item:has-text("Flow Designer")').catch(() => {});
    await win.waitForSelector(".action-flow-node", { timeout: 30000 });
    const loadMs = Date.now() - t0;
    await win.waitForTimeout(500);

    const box = await win.evaluate(() => {
      const r = document.querySelector(".awkit-flow-canvas").getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    const cx = Math.round(box.x + box.w / 2), cy = Math.round(box.y + box.h / 2);
    const domNodes = await win.evaluate(() => document.querySelectorAll("*").length);

    // Zoom: 20 wheel ticks; record wall-time + re-renders.
    await enable();
    const z0 = Date.now();
    for (let i = 0; i < 20; i++) { await win.mouse.move(cx, cy); await win.mouse.wheel(0, i % 2 ? 120 : -120); await win.waitForTimeout(8); }
    const zoomMs = Date.now() - z0;
    const zoomProbe = await readProbe();

    // Drag a node: 20 moves. Reframe first (fit) so the graph is on-screen at every size, then pick
    // the middle node whose center is actually INSIDE the canvas viewport and closest to its center —
    // guaranteeing the drag grabs a real, visible node (not one panned/zoomed off-screen).
    await win.click('.canvas-zoom-control button[aria-label="Fit to screen"]').catch(() => {});
    await win.waitForTimeout(300);
    const nb = await win.evaluate(() => {
      const canvas = document.querySelector(".awkit-flow-canvas");
      if (!canvas) return null;
      const cb = canvas.getBoundingClientRect();
      const centerX = cb.x + cb.width / 2;
      const centerY = cb.y + cb.height / 2;
      const inset = 24; // stay clear of the canvas edges / bottom zoom pill
      let best = null;
      for (const el of document.querySelectorAll(".awkit-flow-node[data-id]")) {
        if (!el.getAttribute("data-id")?.startsWith("n-")) continue;
        const r = el.getBoundingClientRect();
        const x = r.x + r.width / 2;
        const y = r.y + r.height / 2;
        const visible = x > cb.x + inset && x < cb.right - inset && y > cb.y + inset && y < cb.bottom - inset;
        if (!visible) continue;
        const d = (x - centerX) ** 2 + (y - centerY) ** 2;
        if (!best || d < best.d) best = { x: Math.round(x), y: Math.round(y), d, id: el.getAttribute("data-id") };
      }
      return best;
    });
    let dragProbe = { node: -1, edge: -1 };
    if (nb) {
      console.log(`  · N=${N} dragging visible node ${nb.id} at (${nb.x},${nb.y})`);
      await enable();
      await win.mouse.move(nb.x, nb.y); await win.mouse.down();
      for (let i = 0; i < 20; i++) { await win.mouse.move(nb.x + 3 + i * 3, nb.y + 2 + i * 2); await win.waitForTimeout(8); }
      dragProbe = await readProbe();
      await win.mouse.up();
    }

    // Save time.
    const s0 = Date.now();
    await win.evaluate(async (id) => {
      const p = await window.playwrightFlowStudio.flows.get(id);
      await window.playwrightFlowStudio.flows.update(id, { ...p, updatedAt: new Date().toISOString() });
    }, `perf-large-${N}`);
    const saveMs = Date.now() - s0;

    rows.push({ N, loadMs, domNodes, zoomMs, zoomRerenders: zoomProbe.card, dragNodeRerenders: dragProbe.node, dragEdgeRerenders: dragProbe.edge, saveMs, heapMB: await heap() });
  }

  // Leak check: in-session navigation (NO reload) between two designers, 10x, so component
  // mount/unmount + listener/observer cleanup is exercised in a single JS context. Heap + DOM
  // should return to baseline (allowing generous slack for lazy caches), proving no accumulation.
  await win.evaluate((id) => window.playwrightFlowStudio.settings.update({ selections: { lastSelectedFlowId: id } }), "perf-large-200");
  await win.reload(); await win.waitForLoadState("domcontentloaded");
  await win.waitForSelector(".action-flow-node", { timeout: 30000 });
  await win.waitForTimeout(400);
  const navTo = async (label, waitSel) => {
    await win.evaluate((t) => {
      const btn = [...document.querySelectorAll("button.nav-item")].find((b) => (b.textContent || "").trim().includes(t) || b.getAttribute("title") === t);
      btn?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    }, label);
    await win.waitForSelector(waitSel, { timeout: 20000 }).catch(() => {});
    await win.waitForTimeout(250);
  };
  const heapBefore = await heap();
  const domBefore = await win.evaluate(() => document.querySelectorAll("*").length);
  for (let i = 0; i < 10; i++) {
    await navTo("Workflow Builder", ".scenario-flow-node, .scenario-canvas-empty");
    await navTo("Flow Designer", ".action-flow-node");
  }
  const heapAfter = await heap();
  const domAfter = await win.evaluate(() => document.querySelectorAll("*").length);

  console.log("\n=== Large-graph metrics (Flow Designer, real Electron) ===");
  console.log("N\tload(ms)\tdomNodes\tzoom(ms)\tzoomRerenders\tdragNodeRR\tdragEdgeRR\tsave(ms)\theap(MB)");
  for (const r of rows) {
    console.log(`${r.N}\t${r.loadMs}\t\t${r.domNodes}\t\t${r.zoomMs}\t\t${r.zoomRerenders}\t\t${r.dragNodeRerenders}\t\t${r.dragEdgeRerenders}\t\t${r.saveMs}\t${r.heapMB}`);
  }
  console.log(`\nLeak check (10× in-session Flow⇆Workflow nav, no reload): heap ${heapBefore}MB → ${heapAfter}MB, DOM ${domBefore} → ${domAfter}`);
} finally {
  try {
    const win = await app.firstWindow();
    await win.evaluate(async (ids) => {
      for (const id of ids) await window.playwrightFlowStudio.flows.delete(id).catch(() => undefined);
      await window.playwrightFlowStudio.settings.update({ selections: { lastSelectedFlowId: null } }).catch(() => undefined);
    }, seedIds).catch(() => undefined);
  } catch { /* ignore */ }
  await app.close();
}
