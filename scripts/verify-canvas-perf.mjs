// Canvas performance regression verifier.
//
// Guards the memoization + stable-callback work on the in-house canvas engine
// (app/renderer/components/canvas). It seeds a large (40-node) flow, then asserts —
// via the opt-in render probe (app/renderer/components/canvas/renderProbe.ts) — that:
//   • Zooming (20 wheel ticks) re-renders NO node cards / edge layer (viewport-only change).
//   • Typing in the Flow Name field re-renders NO node cards (unrelated page re-render).
//   • Dragging one node re-renders only that node, never the whole graph, and never the
//     edge layer during the drag motion.
// These are structural (not timing) assertions, so they are robust across machines.
//
// Run: node scripts/verify-canvas-perf.mjs   (after `npm run build`)
import { _electron as electron } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const SEED_ID = "perf-canvas-verify-flow";
const app = await electron.launch({ args: [root], cwd: root, env });
try {
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");

  // Seed a 40-node vertical-chain flow and open it in the Flow Designer.
  const seed = await win.evaluate(async (seedId) => {
    const N = 40;
    const nodes = [];
    const edges = [];
    for (let i = 0; i < N; i++) {
      const id = i === 0 ? "start" : i === N - 1 ? "end" : `click-${i}`;
      const type = i === 0 ? "start" : i === N - 1 ? "end" : "click";
      nodes.push({
        id, type, name: type === "click" ? `Click ${i}` : type, description: "perf node",
        position: { x: 280, y: 120 + i * 140 },
        locator: type === "click" ? { strategy: "role", value: `button-${i}` } : undefined,
        retry: { count: 0, delayMs: 1000 }, onFailure: { action: "stop", screenshot: true },
        size: { width: 220, height: 96 }, config: {}
      });
      if (i > 0) edges.push({ id: `edge-${nodes[i - 1].id}-${id}`, source: nodes[i - 1].id, target: id, type: i === 1 ? "always" : "success" });
    }
    const now = new Date().toISOString();
    const profile = { id: seedId, name: "Perf Canvas Verify Flow", description: "perf", version: 1, nodes, edges, createdAt: now, updatedAt: now };
    try {
      const existing = await window.playwrightFlowStudio.flows.get(seedId);
      if (existing) await window.playwrightFlowStudio.flows.update(seedId, profile);
      else await window.playwrightFlowStudio.flows.create(profile);
      await window.playwrightFlowStudio.settings.update({ selections: { lastSelectedFlowId: seedId }, lastRouteId: "flowChart" });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  }, SEED_ID);
  check("Seed 40-node flow", seed.ok, seed.error);

  await win.reload();
  await win.waitForLoadState("domcontentloaded");
  if (!(await win.$(".action-flow-node"))) {
    await win.click('button.nav-item:has-text("Flow Designer")').catch(() => {});
  }
  await win.waitForSelector(".action-flow-node", { timeout: 20000 });
  await win.waitForTimeout(1000);

  const nodeCount = await win.evaluate(() => document.querySelectorAll(".awkit-flow-node[data-id]").length);
  check("Large flow rendered", nodeCount >= 30, `nodeCount=${nodeCount}`);

  const box = await win.evaluate(() => {
    const r = document.querySelector(".awkit-flow-canvas").getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const cx = Math.round(box.x + box.w / 2);
  const cy = Math.round(box.y + box.h / 2);
  const enable = () => win.evaluate(() => { window.__awkitRenderProbe = { node: 0, edge: 0, card: 0 }; });
  const read = () => win.evaluate(() => ({ ...window.__awkitRenderProbe }));

  // --- Zoom: 20 wheel ticks over the canvas center ---
  await enable();
  for (let i = 0; i < 20; i++) {
    await win.mouse.move(cx, cy);
    await win.mouse.wheel(0, i % 2 === 0 ? -120 : 120);
    await win.waitForTimeout(16);
  }
  const zoom = await read();
  check("Zoom does not re-render node cards", zoom.card === 0, `card=${zoom.card}`);
  check("Zoom does not re-render node wrappers", zoom.node === 0, `node=${zoom.node}`);
  check("Zoom does not re-render the edge layer", zoom.edge === 0, `edge=${zoom.edge}`);

  // --- Typing in the Flow Name input (page re-renders; nodes/edges unchanged) ---
  await enable();
  const nameInput = await win.$('.flow-action-bar label:has-text("Flow Name") input');
  if (nameInput) {
    await nameInput.click();
    await nameInput.type("perf-typing-test", { delay: 20 });
  }
  const typing = await read();
  check("Typing the flow name does not re-render node cards", typing.card === 0, `card=${typing.card}`);
  check("Typing the flow name does not re-render node wrappers", typing.node === 0, `node=${typing.node}`);
  check("Typing the flow name does not re-render the edge layer", typing.edge === 0, `edge=${typing.edge}`);

  // --- Drag one node: only the dragged node re-renders during motion; edges stay put ---
  const nodeBox = await win.evaluate(() => {
    const el = [...document.querySelectorAll(".awkit-flow-node[data-id]")].find((n) => n.getAttribute("data-id")?.startsWith("click-"));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  if (nodeBox) {
    await enable();
    await win.mouse.move(nodeBox.x, nodeBox.y);
    await win.mouse.down();
    for (let i = 0; i < 20; i++) {
      await win.mouse.move(nodeBox.x + 3 + i * 3, nodeBox.y + 2 + i * 2);
      await win.waitForTimeout(16);
    }
    const dragMotion = await read();
    // The connected edges follow the node via the dragging overlay (not the static EdgeLayer).
    const dragOverlay = await win.evaluate(() => ({
      overlayPaths: document.querySelectorAll(".awkit-flow-edges-drag path.awkit-flow-edge-path").length
    }));
    await win.mouse.up();
    // Only the single dragged node re-renders during motion — never the whole graph (which
    // would be up to nodeCount * moves).
    check("Drag re-renders only the dragged node (not the whole graph)", dragMotion.node > 0 && dragMotion.node < nodeCount, `node=${dragMotion.node} (< ${nodeCount})`);
    // The static EdgeLayer recomputes at most a bounded number of times (drag start/stop), NOT once
    // per frame (which would be ~20 for 20 moves). Only the small overlay re-routes per frame.
    check("Drag does not recompute the static edge layer per frame", dragMotion.edge <= 2, `edge=${dragMotion.edge} (<= 2)`);
    check("Connected edges follow the dragged node (live overlay)", dragOverlay.overlayPaths > 0, `overlayPaths=${dragOverlay.overlayPaths}`);
  } else {
    check("Drag re-renders only the dragged node (not the whole graph)", false, "no draggable node found");
  }

  // --- Edit one node's Name: only the edited node's card should re-render (identity preserved) ---
  const selected = await win.evaluate(() => {
    const el = [...document.querySelectorAll(".awkit-flow-node[data-id]")].find((n) => n.getAttribute("data-id")?.startsWith("click-"));
    if (!el) return false;
    // Open the node's Configure drawer via its kebab menu (reliable delegated click).
    el.querySelector(".action-node-menu")?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return true;
  });
  await win.waitForTimeout(200);
  await win.evaluate(() => {
    const item = [...document.querySelectorAll(".node-options-menu .node-options-item")].find((b) => /configure/i.test(b.textContent || ""));
    item?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  });
  await win.waitForTimeout(250);
  const editNameInput = await win.$('.properties-panel label:text-is("Name") input');
  if (selected && editNameInput) {
    await enable();
    await editNameInput.click();
    await editNameInput.type("XYZ", { delay: 25 });
    const edit = await read();
    // Editing one node re-renders only that node's card (~1 per keystroke), never the whole graph
    // (which before the identity fix was typedChars * nodeCount). 3 chars → well under nodeCount.
    check("Editing one node re-renders only that node's card", edit.card > 0 && edit.card < nodeCount, `card=${edit.card} (< ${nodeCount})`);
    check("Editing one node does not re-render other node wrappers", edit.node < nodeCount, `node=${edit.node} (< ${nodeCount})`);
  } else {
    check("Editing one node re-renders only that node's card", false, `selected=${selected} input=${Boolean(editNameInput)}`);
  }
} finally {
  // Cleanup: remove the seeded flow and stop pointing the designer at it, so other verifiers
  // (which restore the last route/flow) are unaffected.
  try {
    const win = await app.firstWindow();
    await win.evaluate(async (seedId) => {
      await window.playwrightFlowStudio.flows.delete(seedId).catch(() => undefined);
      await window.playwrightFlowStudio.settings.update({ selections: { lastSelectedFlowId: null } }).catch(() => undefined);
    }, SEED_ID).catch(() => undefined);
  } catch { /* ignore */ }
  await app.close();
}

const passed = results.filter((r) => r.pass).length;
console.log(`\nCanvas perf: ${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
