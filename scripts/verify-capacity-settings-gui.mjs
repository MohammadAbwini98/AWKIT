// Real-Electron check for the machine-aware Runtime Concurrency settings (plan Phase A4):
//   • system:capacityPreview detects THIS machine and returns a valid recommendation.
//   • Sequential / Auto / Manual modes resolve to the expected effective concurrency end-to-end.
//   • Workload class affects the Auto recommendation.
//   • The Settings "Runtime Concurrency" card + mode buttons render with no renderer console errors.
//
// Run: node scripts/verify-capacity-settings-gui.mjs   (after `npm run build`)
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

const app = await electron.launch({ args: [root], cwd: root, env });
const win = await app.firstWindow();
const consoleErrors = [];
win.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
await win.waitForLoadState("domcontentloaded");
await win.waitForTimeout(400);

// Snapshot the user's real settings so this test restores them exactly (non-destructive).
const original = await win.evaluate(async () => {
  const s = await window.playwrightFlowStudio.settings.get();
  return { runtime: s.runtime, lastRouteId: s.lastRouteId };
});

// 1. capacityPreview detects the current machine and returns a coherent recommendation.
const preview = await win.evaluate(() => window.playwrightFlowStudio.system.capacityPreview());
check(
  "capacityPreview detects this machine",
  preview && preview.capabilities && preview.capabilities.logicalCpuCount >= 1 && preview.capabilities.totalMemoryMb > 0,
  preview ? `cpu=${preview.capabilities.logicalCpuCount} totalMb=${preview.capabilities.totalMemoryMb}` : "no preview"
);
check(
  "capacityPreview recommendation is valid",
  preview && preview.recommendation.conservativeRecommendedCapacity >= 1 && preview.autoTarget >= 1 && preview.effectiveTarget >= 1,
  preview ? `rec=${preview.recommendation.conservativeRecommendedCapacity} auto=${preview.autoTarget} eff=${preview.effectiveTarget} binding=${preview.recommendation.bindingConstraint}` : ""
);

// 2. Sequential mode → exactly one active instance, end-to-end through saved settings.
const seq = await win.evaluate(async () => {
  await window.playwrightFlowStudio.settings.update({ runtime: { capacityMode: "sequential" } });
  return window.playwrightFlowStudio.system.capacityPreview();
});
check("sequential mode → effective 1", seq.mode === "sequential" && seq.effectiveTarget === 1, `eff=${seq.effectiveTarget}`);

// 3. Manual mode → the explicit value is applied (clamped by ceilings).
const manual = await win.evaluate(async () => {
  await window.playwrightFlowStudio.settings.update({ runtime: { capacityMode: "manual", maxBrowsers: 3, maxActiveFlows: 5 } });
  return window.playwrightFlowStudio.system.capacityPreview();
});
check("manual mode → applies explicit value", manual.mode === "manual" && manual.effectiveTarget === 5, `eff=${manual.effectiveTarget}`);

// 4. Auto mode → effective equals the auto target and is >= 1.
const auto = await win.evaluate(async () => {
  await window.playwrightFlowStudio.settings.update({ runtime: { capacityMode: "auto" } });
  return window.playwrightFlowStudio.system.capacityPreview();
});
check("auto mode → effective equals auto target", auto.mode === "auto" && auto.effectiveTarget === auto.autoTarget && auto.autoTarget >= 1, `eff=${auto.effectiveTarget} auto=${auto.autoTarget}`);

// 5. Workload class affects the Auto recommendation (light is never below heavy on the same machine).
const byClass = await win.evaluate(async () => {
  const light = await window.playwrightFlowStudio.system.capacityPreview("light");
  const heavy = await window.playwrightFlowStudio.system.capacityPreview("heavy");
  return { light: light.recommendation.conservativeRecommendedCapacity, heavy: heavy.recommendation.conservativeRecommendedCapacity };
});
check("workload class is monotonic (light >= heavy)", byClass.light >= byClass.heavy, `light=${byClass.light} heavy=${byClass.heavy}`);

// 6. The Settings "Runtime Concurrency" card renders with its three mode buttons.
await win.evaluate(() => window.playwrightFlowStudio.settings.update({ lastRouteId: "settings" }));
await win.reload();
await win.waitForLoadState("domcontentloaded");
await win.waitForTimeout(500);
const heading = await win.getByRole("heading", { name: "Runtime Concurrency" }).count();
check("Runtime Concurrency card renders", heading >= 1, `headings=${heading}`);
for (const label of ["Sequential", "Auto", "Manual"]) {
  const count = await win.getByRole("button", { name: label, exact: true }).count();
  check(`mode button "${label}" renders`, count >= 1, `count=${count}`);
}
const readout = await win.locator(".capacity-readout").count();
check("machine capacity readout renders", readout >= 1, `readouts=${readout}`);

// 7. No renderer console errors during the flow.
check("no renderer console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

// Restore the user's original settings exactly (non-destructive test).
await win.evaluate(async (orig) => {
  await window.playwrightFlowStudio.settings.update({ runtime: orig.runtime, lastRouteId: orig.lastRouteId });
}, original);
await app.close();

const passed = results.filter((r) => r.pass).length;
console.log(`\nCapacity settings GUI: ${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
