// Capture screenshots of the running Electron app for UI re-skin before/after evidence.
//
// Usage:
//   node scripts/capture-ui-screenshots.mjs [outSubdir]
// e.g. node scripts/capture-ui-screenshots.mjs before
//
// Requires a prior `npm run build`. Clears ELECTRON_RUN_AS_NODE so the app boots as a GUI.
// Not part of CI — a manual evidence helper for the UI re-skin phases.
import { _electron as electron } from "playwright";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sub = process.argv[2] || "before";
const outDir = path.join(root, "docs/ai/ui-reskin-template-plan/mockups/screenshots", sub);
mkdirSync(outDir, { recursive: true });

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

// Route label (visible nav text when expanded) -> shot file name.
const SIMPLE_ROUTES = [
  ["Dashboard", "01-dashboard"],
  ["Workflow Builder", "04-workflow-builder"],
  ["Workflow Designer", "05-workflow-designer"],
  ["Recorder", "06-recorder"],
  ["Instances", "07-instances"],
  ["Reports", "08-reports-overview"],
  ["Settings", "09-settings"]
];

const app = await electron.launch({ args: [root], cwd: root, env });
const shots = [];
try {
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  await win.waitForTimeout(1500);
  await win.setViewportSize({ width: 1600, height: 1000 });

  async function nav(label) {
    // Exact label match (expanded sidebar renders the label in a <span>). Using has-text here would
    // let "Flows" also match "Workflows"/"Workflow Reports"; text-is pins the exact nav item.
    const btn = win.locator(`button.nav-item:has(span:text-is("${label}"))`).first();
    await btn.click({ timeout: 8000 }).catch(() => {});
    await win.waitForTimeout(1200);
  }
  async function shot(name) {
    const file = path.join(outDir, `${name}.png`);
    await win.screenshot({ path: file });
    shots.push(name);
    console.log("  saved", name);
  }

  // Flow Designer populated: open the first flow from the Flows library.
  await nav("Flows");
  const firstFlowRow = win.locator("tbody tr, .flow-card, [data-testid='flow-row']").first();
  if (await firstFlowRow.count()) {
    await firstFlowRow.click().catch(() => {});
    await win.waitForTimeout(1500);
  } else {
    await nav("Flow Designer");
  }
  await win.waitForSelector(".action-flow-node", { timeout: 8000 }).catch(() => {});
  await shot("02-flow-designer");

  for (const [label, name] of SIMPLE_ROUTES) {
    await nav(label);
    await shot(name);
  }
} finally {
  await app.close();
}
console.log("DONE — captured", shots.length, "shots to", outDir);
