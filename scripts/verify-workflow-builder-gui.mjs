// Real GUI walkthrough of the Workflow Builder canvas (the Flow Designer counterpart lives in
// scripts/verify-flow-designer-gui.mjs). Launches the actual built Electron app via Playwright's
// _electron and drives the Workflow Builder (ScenarioBuilder), asserting on the real rendered
// DOM/SVG. The canvas runs on the in-house engine (app/renderer/components/canvas) — no React
// Flow — rendering `.awkit-flow-node[data-id]` cards (wrapping `.scenario-flow-node`) and
// `g.awkit-flow-edge` connectors. The kebab menu toggles a node's self-loop connector.
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

// Toggle a scenario node's self-loop via its kebab ("…") menu. The menu portals into #root, so
// synthetic bubbling clicks fire React's delegated onClick reliably.
async function toggleLoopViaMenu(win, nodeId) {
  await win.evaluate((id) => {
    const kebab = document.querySelector(`.awkit-flow-node[data-id="${id}"] .action-node-menu`);
    if (kebab) kebab.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  }, nodeId);
  await win.waitForTimeout(180);
  await win.evaluate(() => {
    const item = [...document.querySelectorAll(".node-options-menu .node-options-item")].find((b) => /loop/i.test(b.textContent || ""));
    if (item) item.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  });
  await win.waitForTimeout(150);
}

// Read the loop menu item label ("Add loop" | "Remove loop") without activating it.
async function loopItemLabel(win, nodeId) {
  await win.evaluate((id) => {
    const kebab = document.querySelector(`.awkit-flow-node[data-id="${id}"] .action-node-menu`);
    if (kebab) kebab.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  }, nodeId);
  await win.waitForTimeout(180);
  const label = await win.evaluate(
    () => ([...document.querySelectorAll(".node-options-menu .node-options-item")].find((b) => /loop/i.test(b.textContent || ""))?.textContent || "").trim()
  );
  await win.keyboard.press("Escape").catch(() => {});
  await win.waitForTimeout(80);
  return label;
}

const WF_SELECT = 'label.sb-toolbar-field:has(span:text-is("Workflow")) select';

const app = await electron.launch({ args: [root], cwd: root, env });
try {
  const win = await app.firstWindow();
  const consoleErrors = [];
  win.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await win.waitForLoadState("domcontentloaded");
  await win.waitForTimeout(1200);

  // Navigate to the Workflow Builder (sidebar may be expanded or collapsed).
  if (!(await win.$(".scenario-flow-node"))) {
    await win.click('button.nav-item:has(span:text-is("Workflow Builder"))').catch(() => {});
    if (!(await win.$(".scenario-flow-node"))) {
      await win.waitForTimeout(400);
      await win.click('button.nav-item[title="Workflow Builder"]').catch(() => {});
    }
  }
  await win.waitForSelector(".scenario-flow-node", { timeout: 20000 });
  await win.waitForTimeout(600);

  // --- 1. Custom engine renders scenario cards and connector paths (no React Flow DOM) ---
  const dom = await win.evaluate(() => ({
    reactFlowNodes: document.querySelectorAll(".react-flow__node").length,
    engineNodes: document.querySelectorAll(".awkit-flow-node[data-id]").length,
    scenarioCards: document.querySelectorAll(".scenario-flow-node").length,
    edges: document.querySelectorAll("g.awkit-flow-edge").length,
    background: Boolean(document.querySelector(".awkit-flow-background")),
    zoomControl: Boolean(document.querySelector(".canvas-zoom-control"))
  }));
  check("No React Flow nodes remain in the DOM", dom.reactFlowNodes === 0, `reactFlowNodes=${dom.reactFlowNodes}`);
  // The restored workflow's node count varies (whatever was last open); multi-node rendering is
  // asserted deterministically below via the new-workflow scaffold (Start+End) and the splice.
  check("Custom engine renders scenario flow cards", dom.engineNodes >= 1 && dom.scenarioCards === dom.engineNodes, `engineNodes=${dom.engineNodes} cards=${dom.scenarioCards}`);
  check("Dotted background + zoom control render", dom.background && dom.zoomControl, `bg=${dom.background} zoom=${dom.zoomControl}`);

  const toolbarLayout = await win.evaluate(() => {
    const toolbar = document.querySelector(".scenario-toolbar-compact");
    if (!toolbar) return null;
    const rect = toolbar.getBoundingClientRect();
    const controls = [...toolbar.querySelectorAll(":scope > *")].map((element) => element.getBoundingClientRect());
    return {
      height: rect.height,
      oneRow: controls.every((control) => control.top >= rect.top && control.bottom <= rect.bottom),
      overflowY: getComputedStyle(toolbar).overflowY,
      groups: toolbar.querySelectorAll(".sb-toolbar-group").length
    };
  });
  check(
    "Workflow toolbar stays in one compact row with horizontal overflow",
    toolbarLayout && toolbarLayout.height <= 64 && toolbarLayout.oneRow && toolbarLayout.overflowY === "hidden" && toolbarLayout.groups === 4,
    toolbarLayout ? JSON.stringify(toolbarLayout) : "toolbar not found"
  );

  // Load a saved workflow with edges (so a cross-node connector exists for geometry).
  let edgeCountNow = dom.edges;
  if (edgeCountNow <= 1) {
    const options = await win.$$eval(`${WF_SELECT} option`, (els) => els.map((o) => ({ value: o.value, label: (o.textContent || "").trim() })));
    const ranked = [...options].sort((a, b) => {
      const score = (l) => (/failure|route|data|assert|recover|mock/i.test(l) ? 0 : 1);
      return score(a.label) - score(b.label);
    });
    for (const opt of ranked) {
      await win.selectOption(WF_SELECT, opt.value).catch(() => {});
      await win.waitForTimeout(900);
      edgeCountNow = await win.$$eval("g.awkit-flow-edge", (e) => e.length).catch(() => 0);
      if (edgeCountNow > 0 && (await win.$(".scenario-flow-node"))) {
        console.log(`  · loaded workflow with edges: "${opt.label}" (${edgeCountNow} edges)`);
        break;
      }
    }
    await win.waitForSelector(".scenario-flow-node", { timeout: 10000 });
    await win.waitForTimeout(400);
  }

  // --- 2. Loop toggle via the node kebab menu creates/removes a self-loop connector ---
  const NODE = await win.evaluate(() => {
    const node = [...document.querySelectorAll(".awkit-flow-node[data-id]")].find((n) => n.querySelector(".scenario-flow-node.flowRef"));
    return node ? node.getAttribute("data-id") : null;
  });
  if (!NODE) {
    check("Add loop creates a self-loop connector", false, "no loopable scenario flow node found");
  } else {
    const before = await win.evaluate(() => document.querySelectorAll("g.awkit-flow-edge").length);
    await toggleLoopViaMenu(win, NODE);
    await win.waitForTimeout(450);
    const loop = await win.evaluate((id) => {
      const self = document.querySelector(`g.awkit-flow-edge[data-source="${id}"][data-target="${id}"]`);
      return { count: document.querySelectorAll("g.awkit-flow-edge").length, hasSelfLoop: Boolean(self && self.querySelector("path.awkit-flow-edge-path")) };
    }, NODE);
    check("Add loop creates a self-loop connector", loop.count === before + 1 && loop.hasSelfLoop, `before=${before} after=${loop.count} selfLoop=${loop.hasSelfLoop}`);

    const removeLabel = await loopItemLabel(win, NODE);
    check("Loop menu item toggled to a Remove control", removeLabel === "Remove loop", `label="${removeLabel}"`);

    await toggleLoopViaMenu(win, NODE);
    await win.waitForTimeout(400);
    const after = await win.evaluate((id) => ({
      count: document.querySelectorAll("g.awkit-flow-edge").length,
      hasSelfLoop: Boolean(document.querySelector(`g.awkit-flow-edge[data-source="${id}"][data-target="${id}"]`))
    }), NODE);
    check("Removing the loop deletes the connector", !after.hasSelfLoop && after.count === before, `count=${after.count} (baseline ${before})`);
  }

  // --- 3. New workflows use the structural Start -> End scaffold and contextual picker ---
  // "New" now prompts for a workflow name (points 6/7), then creates + loads that workflow.
  await win.click("#sb-new");
  await win.waitForTimeout(300);
  await win.fill('.modal-dialog input[type="text"]', `GUI New ${Date.now().toString(36)}`).catch(() => {});
  await win.click('.modal-dialog button[type="submit"]').catch(() => {});
  await win.waitForTimeout(600);
  const scaffold = await win.evaluate(() => ({
    starts: document.querySelectorAll(".scenario-flow-node.start").length,
    ends: document.querySelectorAll(".scenario-flow-node.end").length,
    edges: document.querySelectorAll("g.awkit-flow-edge").length,
    legacyPanelVisible: [...document.querySelectorAll(".scenario-side-panel")].some((element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    })
  }));
  check("New workflow renders Start and End connected by default", scaffold.starts === 1 && scaffold.ends === 1 && scaffold.edges === 1, JSON.stringify(scaffold));
  check("Permanent Workflow Definition panel is not visible", !scaffold.legacyPanelVisible, `visible=${scaffold.legacyPanelVisible}`);

  await win.locator(".awkit-flow-canvas").click({ button: "right", position: { x: 120, y: 110 } });
  await win.waitForTimeout(250);
  const contextPicker = await win.locator('.canvas-item-picker[aria-label="Workflow Definition"]').isVisible().catch(() => false);
  check("Blank-canvas right click opens contextual Workflow Definition", contextPicker, `visible=${contextPicker}`);
  await win.keyboard.press("Escape");
  await win.waitForTimeout(300);

  // --- 4. Default edge "+" splices Start -> flow -> End ---
  const insertBtn = win.locator(".awkit-edge-add").first();
  if (await insertBtn.isVisible().catch(() => false)) {
    await insertBtn.evaluate((el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window })));
    await win.waitForTimeout(250);
    check("Default edge + opens Workflow Definition in insertion mode", await win.locator('.canvas-item-picker[aria-label="Workflow Definition"]').isVisible().catch(() => false));
    await win.locator('.canvas-item-picker section:has(h3:has-text("Saved Flows")) [role="menuitem"]').first().click();
    await win.waitForFunction(() => document.querySelectorAll(".scenario-flow-node").length === 3 && document.querySelectorAll("g.awkit-flow-edge").length === 2, null, { timeout: 2000 }).catch(() => {});
    const inserted = await win.evaluate(() => ({ nodes: document.querySelectorAll(".scenario-flow-node").length, edges: document.querySelectorAll("g.awkit-flow-edge").length }));
    check("Selecting a flow on the default edge splices Start -> flow -> End", inserted.nodes === 3 && inserted.edges === 2, JSON.stringify(inserted));
    await win.locator(".scenario-flow-node.flowRef").first().click();
    await win.waitForTimeout(200);
    check("Selecting a workflow flow opens its real configuration drawer", await win.getByText("Flow Configuration", { exact: true }).isVisible().catch(() => false));
  } else {
    check("Default edge + opens Workflow Definition in insertion mode", false, "SKIPPED: no insert + visible on the new scaffold");
  }

  // --- 4b. Add menu exposes the Flow Logic section (Conditional / Parallel / Loop) ---
  await win.click("#sb-add-flow");
  await win.waitForTimeout(300);
  const logicMenu = await win.evaluate(() => {
    const picker = document.querySelector('.canvas-item-picker[aria-label="Workflow Definition"]');
    if (!picker) return { present: false, labels: [] };
    const section = [...picker.querySelectorAll("section")].find((s) => /flow logic/i.test(s.querySelector("h3")?.textContent || ""));
    if (!section) return { present: false, labels: [] };
    return { present: true, labels: [...section.querySelectorAll('[role="menuitem"] strong')].map((el) => (el.textContent || "").trim()) };
  });
  check("Add menu has a Flow Logic section", logicMenu.present, JSON.stringify(logicMenu.labels));
  check(
    "Flow Logic exposes Conditional Branch, Parallel Branch, and Loop",
    ["Conditional Branch", "Parallel Branch", "Loop"].every((l) => logicMenu.labels.includes(l)),
    JSON.stringify(logicMenu.labels)
  );
  await win.keyboard.press("Escape");
  await win.waitForTimeout(150);

  // --- 4c. Selecting a flow highlights it, and Flow Logic › Loop toggles its self-loop ---
  const flowCard = win.locator(".scenario-flow-node.flowRef").first();
  if (await flowCard.isVisible().catch(() => false)) {
    await flowCard.click();
    await win.waitForTimeout(220);
    const loopTargetId = await win.evaluate(() => {
      const nodes = [...document.querySelectorAll(".awkit-flow-node[data-id]")];
      const node = nodes.find((n) => n.querySelector(".scenario-flow-node.flowRef.selected")) || nodes.find((n) => n.querySelector(".scenario-flow-node.flowRef"));
      return node ? node.getAttribute("data-id") : null;
    });
    check("Clicking a flow node applies the .selected highlight", Boolean(await win.$(".scenario-flow-node.flowRef.selected")), `id=${loopTargetId}`);
    const loopBefore = await win.evaluate((id) => Boolean(document.querySelector(`g.awkit-flow-edge[data-source="${id}"][data-target="${id}"]`)), loopTargetId);
    await win.click("#sb-add-flow");
    await win.waitForTimeout(250);
    await win.evaluate(() => {
      const item = [...document.querySelectorAll('.canvas-item-picker [role="menuitem"]')].find((b) => /^Loop$/i.test((b.querySelector("strong")?.textContent || "").trim()));
      if (item) item.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    });
    await win.waitForTimeout(420);
    const loopAfter = await win.evaluate((id) => Boolean(document.querySelector(`g.awkit-flow-edge[data-source="${id}"][data-target="${id}"]`)), loopTargetId);
    check("Flow Logic › Loop adds a self-loop connector to the selected flow", !loopBefore && loopAfter, `before=${loopBefore} after=${loopAfter}`);
  } else {
    check("Clicking a flow node applies the .selected highlight", false, "SKIPPED: no flowRef node present");
    check("Flow Logic › Loop adds a self-loop connector to the selected flow", false, "SKIPPED: no flowRef node present");
  }

  // --- 5. Add Flow toolbar → leaf append "+" opens the contextual picker ---
  await win.click("#sb-add-flow");
  await win.waitForTimeout(250);
  await win.locator('.canvas-item-picker section:has(h3:has-text("Saved Flows")) [role="menuitem"]').first().click().catch(() => {});
  await win.waitForTimeout(400);
  const appendButton = win.locator(".node-append-affordance button").first();
  check("Blank add creates a leaf flow with an append +", await appendButton.isVisible().catch(() => false));
  await appendButton.evaluate((el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }))).catch(() => {});
  await win.waitForTimeout(350);
  check("Workflow leaf + opens the contextual Workflow Definition", await win.locator('.canvas-item-picker[aria-label="Workflow Definition"]').isVisible().catch(() => false));
  await win.keyboard.press("Escape");

  check("Workflow Builder walkthrough emits no renderer console errors", consoleErrors.length === 0, JSON.stringify(consoleErrors));

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
