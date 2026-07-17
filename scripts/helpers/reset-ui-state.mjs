// Verifier-only UI-state reset helper.
//
// The GUI verifiers (`verify:flow-designer`, `verify:workflow-builder`, …) navigate the sidebar by
// visible label or by nav `title`, so they depend on the app opening in a compatible route +
// sidebar-collapse state. Because the app persists `lastRouteId`/`sidebarCollapsed` to
// `%LOCALAPPDATA%/SpecterStudio/storage/ui-settings.json` between runs, a previous session can leave
// the app on an incompatible state and time a verifier out (documented gotcha in CURRENT_STATE).
//
// This helper resets ONLY those two persisted UI fields to a known state before launching a
// verifier. It mutates the local dev settings file only — no production code path, no schema/route/
// runner change — so it is safe to run ad hoc. It is intentionally NOT wired into the existing
// (currently green) verifier scripts to avoid destabilizing them; run it as a pre-step instead.
//
// Usage:
//   node scripts/helpers/reset-ui-state.mjs <routeId> <collapsed:true|false>
// Examples (matching each verifier's required state):
//   node scripts/helpers/reset-ui-state.mjs flowChart false        # verify:flow-designer
//   node scripts/helpers/reset-ui-state.mjs scenarioBuilder true   # verify:workflow-builder
//   node scripts/helpers/reset-ui-state.mjs dashboard false        # neutral / screenshots
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const routeId = process.argv[2] ?? "dashboard";
const collapsed = String(process.argv[3] ?? "false").toLowerCase() === "true";

const localAppData = process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE ?? "", "AppData", "Local");
const settingsPath = path.join(localAppData, "SpecterStudio", "storage", "ui-settings.json");

if (!existsSync(settingsPath)) {
  console.log(`[reset-ui-state] no settings file at ${settingsPath} — the app will create defaults on first launch; nothing to reset.`);
  process.exit(0);
}

try {
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  const before = { lastRouteId: settings.lastRouteId, sidebarCollapsed: settings.sidebarCollapsed };
  settings.lastRouteId = routeId;
  settings.sidebarCollapsed = collapsed;
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  console.log(`[reset-ui-state] ${settingsPath}`);
  console.log(`  before: route=${before.lastRouteId} collapsed=${before.sidebarCollapsed}`);
  console.log(`  after:  route=${routeId} collapsed=${collapsed}`);
} catch (error) {
  console.error(`[reset-ui-state] failed to update settings: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
