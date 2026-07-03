// Real GUI walkthrough of the Workflow Builder connector UI (the Flow Designer counterpart
// lives in scripts/verify-flow-designer-gui.mjs). Launches the actual built Electron app via
// Playwright's _electron and drives the Workflow Builder (ScenarioBuilder) canvas, asserting on
// the real rendered DOM/SVG. The Workflow Builder reuses the shared connector components
// (ConnectorPorts / ConnectorLoopPort / SelfLoopEdge / the node loop button) on `.scenario-flow-node`.
//
// Run: node scripts/verify-workflow-builder-gui.mjs   (after `npm run build`)
import { _electron as electron } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // must run as a GUI app, not plain Node

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const WF_SELECT = 'label.sb-toolbar-field:has(span:text-is("Workflow")) select';

const app = await electron.launch({ args: [root], cwd: root, env });
try {
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  await win.waitForTimeout(1200);

  // Navigate to the Workflow Builder (collapsed sidebar → match by title attribute).
  if (!(await win.$(".scenario-flow-node"))) {
    await win.click('button.nav-item[title="Workflow Builder"]').catch(() => {});
  }
  await win.waitForSelector(".scenario-flow-node", { timeout: 20000 });
  await win.waitForTimeout(600);

  // Load a saved workflow that actually has edges (so the conditional-lock check has an edge to
  // select). The currently-loaded workflow may have zero edges. Prefer linked/mock workflows.
  let edgeCountNow = await win.$$eval(".react-flow__edge", (e) => e.length);
  if (edgeCountNow === 0) {
    const options = await win.$$eval(`${WF_SELECT} option`, (els) => els.map((o) => ({ value: o.value, label: (o.textContent || "").trim() })));
    const ranked = [...options].sort((a, b) => {
      const score = (l) => (/failure|route|data|assert|recover|mock/i.test(l) ? 0 : 1);
      return score(a.label) - score(b.label);
    });
    for (const opt of ranked) {
      await win.selectOption(WF_SELECT, opt.value).catch(() => {});
      await win.waitForTimeout(900);
      edgeCountNow = await win.$$eval(".react-flow__edge", (e) => e.length).catch(() => 0);
      if (edgeCountNow > 0 && (await win.$(".scenario-flow-node"))) {
        console.log(`  · loaded workflow with edges: "${opt.label}" (${edgeCountNow} edges)`);
        break;
      }
    }
    await win.waitForSelector(".scenario-flow-node", { timeout: 10000 });
    await win.waitForTimeout(400);
  }

  // Discover a loopable node (all scenario nodes are loopable) without an existing loop.
  const NODE = await win.evaluate(() => {
    const nodes = [...document.querySelectorAll(".react-flow__node")].filter((n) => n.querySelector(".scenario-flow-node") && n.querySelector(".node-loop-button") && !n.querySelector(".connector-port-loop.active"));
    return nodes[0]?.getAttribute("data-id") || null;
  });
  if (!NODE) throw new Error("no loopable scenario node without an existing loop found");
  const LOOP_EDGE_ID = `edge-${NODE}-${NODE}-loop`;
  console.log(`  · target node: ${NODE}   edges on canvas: ${edgeCountNow}`);

  // --- 1. Ports render and are NOT clipped by the card's overflow:hidden ---
  const portInfo = await win.evaluate((nodeId) => {
    const node = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`);
    const card = node.querySelector(".scenario-flow-node");
    const handles = [...node.querySelectorAll(".react-flow-handle")];
    const nr = node.getBoundingClientRect();
    const handleData = handles.map((h) => {
      const r = h.getBoundingClientRect();
      return { pos: h.getAttribute("data-handlepos"), cx: r.x + r.width / 2, cy: r.y + r.height / 2, w: r.width, h: r.height, insideCard: card.contains(h) };
    });
    return { count: handles.length, cardOverflow: getComputedStyle(card).overflow, node: { left: nr.left, right: nr.right, top: nr.top }, handleData };
  }, NODE);

  check("Node renders left + right connector ports", portInfo.count >= 2, `handleCount=${portInfo.count}`);
  const clippedInside = portInfo.handleData.filter((h) => h.insideCard).length;
  check("Ports are rendered as siblings of the overflow:hidden card (not clipped)", clippedInside === 0 && portInfo.cardOverflow.includes("hidden"), `handlesInsideCard=${clippedInside}, cardOverflow=${portInfo.cardOverflow}`);
  const leftPort = portInfo.handleData.find((h) => h.pos === "left");
  const rightPort = portInfo.handleData.find((h) => h.pos === "right");
  check("Left port on the node's left edge, right port on the right edge", leftPort && rightPort && Math.abs(leftPort.cx - portInfo.node.left) < 12 && Math.abs(rightPort.cx - portInfo.node.right) < 12, leftPort && rightPort ? `leftΔ=${(leftPort.cx - portInfo.node.left).toFixed(1)} rightΔ=${(rightPort.cx - portInfo.node.right).toFixed(1)}` : "missing left/right port");
  check("Every port has non-zero size", portInfo.handleData.every((h) => h.w > 0 && h.h > 0), `sizes=${portInfo.handleData.map((h) => `${h.w.toFixed(1)}x${h.h.toFixed(1)}`).join(",")}`);

  // --- 2. Add Loop button creates a visible self-loop connector ---
  const edgesBefore = await win.$$eval(".react-flow__edge", (e) => e.length);
  await win.click(`.react-flow__node[data-id="${NODE}"] .node-loop-button`, { force: true });
  await win.waitForTimeout(500);
  const loop = await win.evaluate(({ nodeId, edgeId }) => {
    const node = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`);
    const nr = node.getBoundingClientRect();
    const edges = [...document.querySelectorAll(".react-flow__edge")];
    const loopEdge = edges.find((e) => (e.getAttribute("data-testid") || "").includes(edgeId) || (e.getAttribute("data-id") || "").includes(edgeId));
    const p = loopEdge ? loopEdge.querySelector("path.react-flow__edge-path") : null;
    const pr = p ? p.getBoundingClientRect() : null;
    const activePort = node.querySelector(".connector-port-loop.active");
    const topPort = activePort ? activePort.getBoundingClientRect() : null;
    return {
      edgeCount: edges.length,
      loopFound: Boolean(loopEdge),
      hasPath: Boolean(p),
      pathRect: pr ? { top: pr.top, bottom: pr.bottom } : null,
      node: { top: nr.top },
      activePortOpacity: activePort ? getComputedStyle(activePort).opacity : null,
      topPort: topPort ? { cy: topPort.y + topPort.height / 2 } : null
    };
  }, { nodeId: NODE, edgeId: LOOP_EDGE_ID });

  check("Clicking Add Loop creates a new edge", loop.edgeCount === edgesBefore + 1 && loop.loopFound, `before=${edgesBefore} after=${loop.edgeCount} loopFound=${loop.loopFound}`);
  check("Loop connector has a rendered path", loop.hasPath, loop.pathRect ? `pathTop=${loop.pathRect.top.toFixed(1)}` : "no path");
  check("Top loop port becomes visible (opacity 1)", loop.activePortOpacity && Number(loop.activePortOpacity) > 0.9, `opacity=${loop.activePortOpacity}`);
  check("Loop port sits on the node's TOP edge", loop.topPort && Math.abs(loop.topPort.cy - loop.node.top) < 14, loop.topPort ? `portCy=${loop.topPort.cy.toFixed(1)} nodeTop=${loop.node.top.toFixed(1)}` : "no top port");
  check("Loop connector draws as a semicircle ABOVE the node", loop.pathRect && loop.pathRect.top < loop.node.top - 8 && loop.pathRect.bottom <= loop.node.top + 6, loop.pathRect ? `pathTop=${loop.pathRect.top.toFixed(1)} pathBottom=${loop.pathRect.bottom.toFixed(1)} nodeTop=${loop.node.top.toFixed(1)}` : "no path rect");

  // --- 3. Loop is deletable via the toggled Remove button ---
  const removeTitle = await win.getAttribute(`.react-flow__node[data-id="${NODE}"] .node-loop-button`, "title");
  check("Loop button toggled to a Remove control", removeTitle === "Remove loop connector", `title="${removeTitle}"`);
  await win.click(`.react-flow__node[data-id="${NODE}"] .node-loop-button`, { force: true });
  await win.waitForTimeout(400);
  const afterRemove = await win.evaluate(({ nodeId, edgeId }) => {
    const node = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`);
    const edges = [...document.querySelectorAll(".react-flow__edge")];
    const loopEdge = edges.find((e) => (e.getAttribute("data-testid") || "").includes(edgeId) || (e.getAttribute("data-id") || "").includes(edgeId));
    return { edgeCount: edges.length, loopStillThere: Boolean(loopEdge), activePort: Boolean(node.querySelector(".connector-port-loop.active")) };
  }, { nodeId: NODE, edgeId: LOOP_EDGE_ID });
  check("Removing the loop deletes the connector", !afterRemove.loopStillThere && afterRemove.edgeCount === edgesBefore, `edgeCount=${afterRemove.edgeCount} (baseline ${edgesBefore})`);
  check("Top loop port hides again once the loop is gone", !afterRemove.activePort, `activePortPresent=${afterRemove.activePort}`);

  // --- 4. With a loop present, outgoing connectors lock the Link Type selector ---
  // Loaded-workflow edge ids are saved link ids (not edge-<src>-<tgt>), so rather than parse the
  // source, give every loopable node a self-loop — the source of any existing edge is then
  // loop-controlled — and select the remaining non-loop edge.
  const loopNodeIds = await win.evaluate(() =>
    [...document.querySelectorAll(".react-flow__node")]
      .filter((n) => n.querySelector(".scenario-flow-node") && n.querySelector(".node-loop-button") && !n.querySelector(".connector-port-loop.active"))
      .map((n) => n.getAttribute("data-id"))
      .slice(0, 8)
  );
  for (const id of loopNodeIds) {
    await win.click(`.react-flow__node[data-id="${id}"] .node-loop-button`, { force: true }).catch(() => {});
    await win.waitForTimeout(150);
  }
  const edgeTestId = await win.evaluate(() => {
    const e = [...document.querySelectorAll(".react-flow__edge")].find((g) => {
      const id = g.getAttribute("data-testid") || "";
      return id.startsWith("rf__edge-") && !id.endsWith("-loop");
    });
    return e ? e.getAttribute("data-testid") : null;
  });

  if (!edgeTestId) {
    check("Loop node locks outgoing connectors (Link Type panel)", false, "SKIPPED: loaded workflow had no non-loop edge to select — conditional-lock uses the same shared `selectedEdgeKindLocked` logic verified in the Flow Designer");
  } else {
    await win.evaluate((testId) => {
      const e = document.querySelector(`.react-flow__edge[data-testid="${testId}"]`);
      const p = e.querySelector(".react-flow__edge-interaction") || e.querySelector("path.react-flow__edge-path");
      p.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    }, edgeTestId);
    await win.waitForTimeout(400);
    const panel = await win.evaluate(() => {
      const sels = [...document.querySelectorAll("select")];
      const linkSel = sels.find((s) => {
        const vals = [...s.options].map((o) => o.value);
        return vals.includes("loopBack") && vals.includes("parallel") && vals.includes("success");
      });
      if (!linkSel) return { hasLink: false };
      const opts = Object.fromEntries([...linkSel.options].map((o) => [o.value, o.disabled]));
      const helper = [...document.querySelectorAll(".scenario-builder-page small, .selected-connector small, small")].map((s) => s.textContent || "").join(" | ");
      return { hasLink: true, disabled: linkSel.disabled, opts, helper };
    });
    const locked = panel.hasLink && panel.disabled && /loop connector/i.test(panel.helper) && /Conditional/i.test(panel.helper);
    check("Loop node locks outgoing connectors (Link Type panel)", locked, panel.hasLink ? `selectDisabled=${panel.disabled}, successOptDisabled=${panel.opts.success}, conditionalOptDisabled=${panel.opts.conditional}` : "Link Type selector not found on selected edge");
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} GUI checks passed`);
  await app.close();
  process.exit(passed === results.length ? 0 : 1);
} catch (err) {
  console.error("GUI walkthrough error:", err);
  try {
    await app.close();
  } catch {
    /* ignore */
  }
  process.exit(2);
}
