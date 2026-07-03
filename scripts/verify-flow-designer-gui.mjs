// Real GUI walkthrough of the Flow Designer connector UI.
//
// Launches the actual built Electron app (main + preload + renderer) via Playwright's
// _electron API and drives the Flow Designer canvas, asserting on the real rendered DOM/SVG
// geometry. This is the manual-walkthrough replacement that three prior sessions could not
// perform because the agent environment sets ELECTRON_RUN_AS_NODE=1 (which we clear here).
//
// Run: node scripts/verify-flow-designer-gui.mjs   (after `npm run build`)
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

// Fire the node's loop button via a synthetic click dispatched directly on the element, so it
// works even when another node overlaps the button in a saved flow's layout (React's delegated
// onClick still fires from the bubbling event). Coordinate clicks would hit the overlapping node.
async function selectAndClickLoop(win, nodeId) {
  await win.evaluate((id) => {
    const btn = document.querySelector(`.react-flow__node[data-id="${id}"] .node-loop-button`);
    if (btn) btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  }, nodeId);
}

const app = await electron.launch({ args: [root], cwd: root, env });
try {
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");

  // Ensure we're on the Flow Designer (the app restores the last route; if not, click the
  // sidebar nav — collapsed, so match by its title attribute).
  if (!(await win.$(".action-flow-node"))) {
    await win.click('button.nav-item[title="Flow Designer"]').catch(() => {});
  }
  await win.waitForSelector(".action-flow-node", { timeout: 20000 });
  await win.waitForTimeout(600);

  // Discover a loopable action node that does not already have a loop — prefer the
  // "Auto Secure Login" node the bug report called out.
  const NODE = await win.evaluate(() => {
    const nodes = [...document.querySelectorAll(".react-flow__node")].filter((n) => n.querySelector(".node-loop-button") && !n.querySelector(".connector-port-loop.active"));
    const preferred = nodes.find((n) => (n.getAttribute("data-id") || "").startsWith("autoSecureLogin"));
    return (preferred || nodes[0])?.getAttribute("data-id") || null;
  });
  if (!NODE) throw new Error("no loopable action node without an existing loop found");
  const DRAG_TARGET = await win.evaluate((nodeId) => {
    const other = [...document.querySelectorAll(".react-flow__node")].find((n) => n.getAttribute("data-id") !== nodeId && n.querySelector('.react-flow-handle[data-handleid="normal-in"]'));
    return other ? other.getAttribute("data-id") : null;
  }, NODE);
  const LOOP_EDGE_ID = `edge-${NODE}-${NODE}-loop`;
  console.log(`  · target node: ${NODE}   drag target: ${DRAG_TARGET}`);

  // --- 1. Ports render and are NOT clipped by the card's overflow:hidden ---
  const portInfo = await win.evaluate((nodeId) => {
    const node = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`);
    const article = node.querySelector(".action-flow-node");
    const handles = [...node.querySelectorAll(".react-flow-handle")];
    const nr = node.getBoundingClientRect();
    const handleData = handles.map((h) => {
      const r = h.getBoundingClientRect();
      return {
        id: h.getAttribute("data-handleid"),
        pos: h.getAttribute("data-handlepos"),
        cx: r.x + r.width / 2,
        cy: r.y + r.height / 2,
        w: r.width,
        h: r.height,
        insideArticle: article.contains(h)
      };
    });
    return {
      count: handles.length,
      articleOverflow: getComputedStyle(article).overflow,
      node: { left: nr.left, right: nr.right, top: nr.top, bottom: nr.bottom, w: nr.width, h: nr.height },
      handleData
    };
  }, NODE);

  check("Node renders left + right connector ports", portInfo.count >= 2, `handleCount=${portInfo.count}`);
  const clippedInside = portInfo.handleData.filter((h) => h.insideArticle).length;
  check(
    "Ports are rendered as siblings of the overflow:hidden card (not clipped)",
    clippedInside === 0 && portInfo.articleOverflow.includes("hidden"),
    `handlesInsideCard=${clippedInside}, cardOverflow=${portInfo.articleOverflow}`
  );
  const leftPort = portInfo.handleData.find((h) => h.pos === "left");
  const rightPort = portInfo.handleData.find((h) => h.pos === "right");
  check(
    "Left port sits on the node's left edge, right port on the right edge",
    leftPort && rightPort && Math.abs(leftPort.cx - portInfo.node.left) < 12 && Math.abs(rightPort.cx - portInfo.node.right) < 12,
    leftPort && rightPort ? `leftΔ=${(leftPort.cx - portInfo.node.left).toFixed(1)} rightΔ=${(rightPort.cx - portInfo.node.right).toFixed(1)}` : "missing left/right port"
  );
  check(
    "Every port has non-zero size (visible, not collapsed)",
    portInfo.handleData.every((h) => h.w > 0 && h.h > 0),
    `sizes=${portInfo.handleData.map((h) => `${h.w}x${h.h}`).join(",")}`
  );

  // --- 1b. Conditional pair (Rules 3): converting a connector to Conditional yields a two-port
  // branch on the source node, locks the kind selector, and reverts to one normal port on delete.
  const condTarget = await win.evaluate(() => {
    const edges = [...document.querySelectorAll(".react-flow__edge")];
    for (const nid of [...document.querySelectorAll(".react-flow__node")].map((n) => n.getAttribute("data-id"))) {
      const e = edges.find((g) => (g.getAttribute("data-testid") || "").startsWith(`rf__edge-edge-${nid}-`) && !(g.getAttribute("data-testid") || "").endsWith("-loop"));
      if (e && !document.querySelector(`.react-flow__node[data-id="${nid}"] .connector-port-loop.active`)) {
        const edgeTestId = e.getAttribute("data-testid");
        const prefix = `rf__edge-edge-${nid}-`;
        const target = edgeTestId?.startsWith(prefix) ? edgeTestId.slice(prefix.length) : "";
        return { node: nid, edgeTestId, target };
      }
    }
    return null;
  });
  if (!condTarget) {
    check("Convert connector to Conditional → two aligned ports + locked kind", false, "SKIPPED: no normal outgoing edge available in this flow");
  } else {
    // Select the edge, then set the kind selector to Conditional (native setter + change event so
    // React's onChange fires) — the panel path, since drag-created pairs can't be driven headlessly.
    await win.evaluate((t) => {
      const e = document.querySelector(`.react-flow__edge[data-testid="${t}"]`);
      const p = e.querySelector(".react-flow__edge-interaction") || e.querySelector("path.react-flow__edge-path");
      p.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    }, condTarget.edgeTestId);
    await win.waitForTimeout(300);
    await win.evaluate(() => {
      const sel = [...document.querySelectorAll(".properties-panel select")].find((s) => {
        const v = [...s.options].map((o) => o.value);
        return v.includes("normal") && v.includes("conditional") && v.includes("loop");
      });
      if (!sel || sel.disabled) return;
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(sel, "conditional");
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await win.waitForTimeout(400);
    const pair = await win.evaluate((nid) => {
      const node = document.querySelector(`.react-flow__node[data-id="${nid}"]`);
      const ports = [...node.querySelectorAll(".react-flow-handle")].map((h) => h.getAttribute("data-handleid")).filter((id) => (id || "").startsWith("conditional-out")).sort();
      const rects = ports.map((id) => node.querySelector(`[data-handleid="${id}"]`).getBoundingClientRect());
      const sels = [...document.querySelectorAll(".properties-panel select")];
      const sel = sels.find((s) => { const v = [...s.options].map((o) => o.value); return v.includes("normal") && v.includes("conditional") && v.includes("loop"); });
      return { ports, locked: sel ? sel.disabled : null, dy: rects.length === 2 ? Math.abs(rects[0].y - rects[1].y) : 0 };
    }, condTarget.node);
    check("Converting to Conditional shows exactly 2 conditional ports (conditional-out-0/1)", pair.ports.length === 2 && pair.ports.includes("conditional-out-0") && pair.ports.includes("conditional-out-1"), `ports=[${pair.ports.join(",")}]`);
    check("The two conditional ports are vertically separated (aligned pair)", pair.dy > 4, `Δy=${pair.dy.toFixed(1)}`);
    check("Conditional connector kind is locked after creation", pair.locked === true, `kindSelectDisabled=${pair.locked}`);
    // Delete the (now conditional) edge → node reverts to a single normal port (Rule 3 revert).
    const branchDrag = await win.evaluate(({ nodeId, originalTarget }) => {
      const nid = nodeId;
      const source = document.querySelector(`.react-flow__node[data-id="${nid}"] [data-handleid="conditional-out-1"]`);
      const targetNode = [...document.querySelectorAll(".react-flow__node")].find((n) => {
        const targetId = n.getAttribute("data-id");
        if (!targetId || targetId === nid) return false;
        if (targetId === originalTarget) return false;
        if (!n.querySelector('[data-handleid="normal-in"]')) return false;
        return !document.querySelector(`.react-flow__edge[data-testid^="rf__edge-edge-${nid}-${targetId}"]`);
      });
      const target = targetNode?.querySelector('[data-handleid="normal-in"]');
      const sr = source?.getBoundingClientRect();
      const tr = target?.getBoundingClientRect();
      return sr && tr && targetNode
        ? {
            source: { x: sr.x + sr.width / 2, y: sr.y + sr.height / 2 },
            target: { x: tr.x + tr.width / 2, y: tr.y + tr.height / 2 },
            targetId: targetNode.getAttribute("data-id")
          }
        : null;
    }, { nodeId: condTarget.node, originalTarget: condTarget.target });
    if (!branchDrag) {
      check("Dragging second Conditional connector creates the missing branch", false, "no target node/handle available");
    } else {
      const sourceHandle = win.locator(`.react-flow__node[data-id="${condTarget.node}"] [data-handleid="conditional-out-1"]`);
      const targetHandle = win.locator(`.react-flow__node[data-id="${branchDrag.targetId}"] [data-handleid="normal-in"]`);
      await sourceHandle.dragTo(targetHandle, { force: true }).catch(async () => {
        await win.mouse.move(branchDrag.source.x, branchDrag.source.y);
        await win.mouse.down();
        await win.mouse.move((branchDrag.source.x + branchDrag.target.x) / 2, (branchDrag.source.y + branchDrag.target.y) / 2, { steps: 8 });
        await win.mouse.move(branchDrag.target.x, branchDrag.target.y, { steps: 8 });
        await win.mouse.up();
      });
      await win.waitForTimeout(600);

      const twoBranches = await win.evaluate(({ nodeId, targetId, originalEdgeTestId }) => {
        const node = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`);
        const ports = [...node.querySelectorAll('[data-handleid^="conditional-out"]')].map((h) => h.getAttribute("data-handleid")).sort();
        const outgoing = [...document.querySelectorAll(".react-flow__edge")]
          .map((edge) => edge.getAttribute("data-testid") || "")
          .filter((id) => id.startsWith(`rf__edge-edge-${nodeId}-`) && !id.endsWith("-loop"));
        return {
          ports,
          outgoing,
          expectedEdgeTestId: `rf__edge-edge-${nodeId}-${targetId}`,
          branchEdgeTestId: outgoing.find((id) => id !== originalEdgeTestId) || ""
        };
      }, { nodeId: condTarget.node, targetId: branchDrag.targetId, originalEdgeTestId: condTarget.edgeTestId });
      check(
        "Dragging second Conditional connector creates the missing branch",
        Boolean(twoBranches.branchEdgeTestId) && twoBranches.outgoing.length === 2 && twoBranches.ports.length === 2,
        `expected=${twoBranches.expectedEdgeTestId} actual=${twoBranches.branchEdgeTestId} outgoing=[${twoBranches.outgoing.join(",")}] ports=[${twoBranches.ports.join(",")}]`
      );

      await win.evaluate((testId) => {
        const e = document.querySelector(`.react-flow__edge[data-testid="${testId}"]`);
        const p = e?.querySelector(".react-flow__edge-interaction") || e?.querySelector("path.react-flow__edge-path");
        p?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      }, twoBranches.branchEdgeTestId);
      await win.waitForTimeout(300);
      await win.click('.properties-panel button:has-text("Delete connection")').catch(() => {});
      await win.waitForTimeout(500);

      const survivor = await win.evaluate((nid) => {
        const node = document.querySelector(`.react-flow__node[data-id="${nid}"]`);
        const normalPort = Boolean(node.querySelector('[data-handleid="normal-out"]'));
        const condPorts = node.querySelectorAll('[data-handleid^="conditional-out"]').length;
        const outgoing = [...document.querySelectorAll(".react-flow__edge")]
          .map((edge) => edge.getAttribute("data-testid") || "")
          .filter((id) => id.startsWith(`rf__edge-edge-${nid}-`) && !id.endsWith("-loop"));
        return { normalPort, condPorts, outgoing };
      }, condTarget.node);
      check(
        "Deleting one of two Conditional branches reverts the survivor to one normal port",
        survivor.normalPort && survivor.condPorts === 0 && survivor.outgoing.length === 1,
        `normalPort=${survivor.normalPort} conditionalPorts=${survivor.condPorts} outgoing=[${survivor.outgoing.join(",")}]`
      );
    }
  }

  // --- 2. Add Loop button creates a visible self-loop connector ---
  const edgesBefore = await win.evaluate(() => document.querySelectorAll(".react-flow__edge").length);
  await selectAndClickLoop(win, NODE);
  await win.waitForTimeout(500);

  const loop = await win.evaluate(
    ({ nodeId, edgeId }) => {
      const node = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`);
      const nr = node.getBoundingClientRect();
      const edges = [...document.querySelectorAll(".react-flow__edge")];
      const loopEdge = edges.find((e) => (e.getAttribute("data-testid") || "").includes(edgeId) || (e.getAttribute("data-id") || "").includes(edgeId));
      const p = loopEdge ? loopEdge.querySelector("path.react-flow__edge-path") : null;
      const pr = p ? p.getBoundingClientRect() : null;
      const activePort = node.querySelector(".connector-port-loop.active");
      const portOpacity = activePort ? getComputedStyle(activePort).opacity : null;
      const topPort = activePort ? activePort.getBoundingClientRect() : null;
      return {
        edgeCount: edges.length,
        loopFound: Boolean(loopEdge),
        hasPath: Boolean(p),
        pathRect: pr ? { top: pr.top, bottom: pr.bottom, left: pr.left, right: pr.right } : null,
        node: { top: nr.top, bottom: nr.bottom, left: nr.left, right: nr.right },
        activePortOpacity: portOpacity,
        topPort: topPort ? { cx: topPort.x + topPort.width / 2, cy: topPort.y + topPort.height / 2 } : null
      };
    },
    { nodeId: NODE, edgeId: LOOP_EDGE_ID }
  );

  check("Clicking Add Loop creates a new edge", loop.edgeCount === edgesBefore + 1 && loop.loopFound, `before=${edgesBefore} after=${loop.edgeCount} loopFound=${loop.loopFound}`);
  check("Loop connector has a rendered path", loop.hasPath, loop.pathRect ? `pathTop=${loop.pathRect.top.toFixed(1)}` : "no path");
  check(
    "Top loop port becomes visible (opacity 1)",
    loop.activePortOpacity && Number(loop.activePortOpacity) > 0.9,
    `opacity=${loop.activePortOpacity}`
  );
  check(
    "Loop port sits on the node's TOP edge",
    loop.topPort && Math.abs(loop.topPort.cy - loop.node.top) < 14,
    loop.topPort ? `portCy=${loop.topPort.cy.toFixed(1)} nodeTop=${loop.node.top.toFixed(1)}` : "no top port"
  );
  check(
    "Loop connector draws as a semicircle ABOVE the node",
    loop.pathRect && loop.pathRect.top < loop.node.top - 8 && loop.pathRect.bottom <= loop.node.top + 6,
    loop.pathRect ? `pathTop=${loop.pathRect.top.toFixed(1)} pathBottom=${loop.pathRect.bottom.toFixed(1)} nodeTop=${loop.node.top.toFixed(1)}` : "no path rect"
  );

  // --- 3. Loop is selectable + deletable (button toggles to Remove) ---
  const removeTitle = await win.getAttribute(`.react-flow__node[data-id="${NODE}"] .node-loop-button`, "title");
  check("Loop button toggled to a Remove control", removeTitle === "Remove loop connector", `title="${removeTitle}"`);
  await selectAndClickLoop(win, NODE);
  await win.waitForTimeout(400);
  const afterRemove = await win.evaluate(
    ({ nodeId, edgeId }) => {
      const node = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`);
      const edges = [...document.querySelectorAll(".react-flow__edge")];
      const loopEdge = edges.find((e) => (e.getAttribute("data-testid") || "").includes(edgeId) || (e.getAttribute("data-id") || "").includes(edgeId));
      return { edgeCount: edges.length, loopStillThere: Boolean(loopEdge), activePort: Boolean(node.querySelector(".connector-port-loop.active")) };
    },
    { nodeId: NODE, edgeId: LOOP_EDGE_ID }
  );
  check("Removing the loop deletes the connector", !afterRemove.loopStillThere && afterRemove.edgeCount === edgesBefore, `edgeCount=${afterRemove.edgeCount} (baseline ${edgesBefore})`);
  check("Top loop port hides again once the loop is gone", !afterRemove.activePort, `activePortPresent=${afterRemove.activePort}`);

  // --- 4. With a loop present, outgoing connectors from that node are locked to Conditional ---
  // Deterministic check via the real Connection Properties panel (synthetic React Flow drag
  // connections can't be driven reliably headlessly): pick a loopable node that already has an
  // outgoing edge, give it a loop, select that edge, and confirm the kind selector is locked.
  void DRAG_TARGET;
  const lc = await win.evaluate(() => {
    const loopNodes = [...document.querySelectorAll(".react-flow__node")]
      .filter((n) => n.querySelector(".node-loop-button"))
      .map((n) => n.getAttribute("data-id"));
    const edges = [...document.querySelectorAll(".react-flow__edge")];
    for (const nodeId of loopNodes) {
      const e = edges.find((g) => {
        const id = g.getAttribute("data-testid") || "";
        return id.startsWith(`rf__edge-edge-${nodeId}-`) && !id.endsWith("-loop");
      });
      if (e) {
        const hasLoop = Boolean(document.querySelector(`.react-flow__node[data-id="${nodeId}"] .connector-port-loop.active`));
        return { nodeId, edgeTestId: e.getAttribute("data-testid"), hasLoop };
      }
    }
    return null;
  });

  if (!lc) {
    check("Loop node locks outgoing connectors to Conditional (panel)", false, "no loopable node with an outgoing edge found in this flow");
  } else {
    if (!lc.hasLoop) {
      await selectAndClickLoop(win, lc.nodeId);
      await win.waitForTimeout(400);
    }
    // Select the outgoing edge by dispatching a click on its interaction path (React picks it up).
    await win.evaluate((testId) => {
      const e = document.querySelector(`.react-flow__edge[data-testid="${testId}"]`);
      const p = e.querySelector(".react-flow__edge-interaction") || e.querySelector("path.react-flow__edge-path");
      p.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    }, lc.edgeTestId);
    await win.waitForTimeout(400);
    const panel = await win.evaluate(() => {
      const sels = [...document.querySelectorAll(".properties-panel select")];
      const kindSel = sels.find((s) => {
        const vals = [...s.options].map((o) => o.value);
        return vals.includes("normal") && vals.includes("conditional") && vals.includes("loop");
      });
      if (!kindSel) return { hasKind: false };
      const opts = Object.fromEntries([...kindSel.options].map((o) => [o.value, o.disabled]));
      const helper = [...document.querySelectorAll(".properties-panel small")].map((s) => s.textContent || "").join(" | ");
      return { hasKind: true, disabled: kindSel.disabled, opts, helper };
    });
    const locked = panel.hasKind && panel.disabled && /loop connector/i.test(panel.helper) && /Conditional/i.test(panel.helper);
    check(
      "Loop node locks outgoing connectors to Conditional (panel)",
      locked,
      panel.hasKind ? `selectDisabled=${panel.disabled}, normalOptDisabled=${panel.opts.normal}, parallelOptDisabled=${panel.opts.parallel}` : "kind selector not found on selected edge"
    );
  }

  // --- 5. Saved Flow searchable dropdown closes on an outside click over the React Flow canvas ---
  // (Previously the bubble-phase mousedown listener never saw pane clicks because React Flow
  // consumes pointer events; the fix uses a capture-phase pointerdown listener.)
  const trigger = await win.$(".searchable-select-trigger");
  if (!trigger) {
    check("Saved Flow dropdown closes on outside (canvas) click", false, "SKIPPED: no .searchable-select-trigger on this page");
  } else {
    await win.click(".searchable-select-trigger").catch(() => {});
    await win.waitForTimeout(200);
    const opened = Boolean(await win.$(".searchable-select-menu"));
    // Simulate an outside click on the canvas pane (dispatch reaches the document capture listener
    // even though React Flow would stop propagation before a bubble-phase listener).
    await win.evaluate(() => {
      const pane = document.querySelector(".react-flow__pane") || document.body;
      pane.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    });
    await win.waitForTimeout(200);
    const stillOpen = Boolean(await win.$(".searchable-select-menu"));
    check("Saved Flow dropdown opens, then closes on an outside canvas pointerdown", opened && !stillOpen, `opened=${opened} closedAfterCanvasClick=${!stillOpen}`);
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
