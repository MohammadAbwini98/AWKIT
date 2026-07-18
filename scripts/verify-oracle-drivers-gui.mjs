// WS-E — Real-Electron walkthrough of Settings › Database Drivers (Phase 10): the user-selected Java
// runtime + managed Oracle JDBC driver bundle sections. Drives the actual app through Playwright's
// `_electron` launcher (non-destructive: it creates and deletes only a temporary probe profile and
// restores the original route). It asserts:
//   • both cards render (headings, hints, security warnings);
//   • the seeded Java runtime + driver bundle display with correct metadata + status badges;
//   • validate() returns valid for both; availability() reports the configured runtime;
//   • the selected Java launches the isolated bridge AND loads the real ojdbc driver end-to-end
//     (java.testBridge + drivers.testLoad through the real IPC — the whole point of the feature);
//   • the deletion guard: a profile referencing a runtime/bundle blocks its removal (usageCount +
//     disabled remove button), and removal re-enables after the reference is dropped;
//   • no secret material is exposed in the renderer projections or DOM;
//   • the layout has no horizontal overflow and honors reduced-motion;
//   • zero renderer console errors throughout.
//
// Run: node scripts/verify-oracle-drivers-gui.mjs   (after `npm run build` + `npm run build:oracle-bridge`)
// Expects the local validation store: Java runtime "Local-JDK-17" + bundle
// "Oracle-ojdbc17-local-19c-validation" (seeded by add-java-runtime.mts / import-driver-bundle.mts).
import { _electron as electron } from "playwright";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const JAVA_ID = process.env.AWKIT_GUI_JAVA_RUNTIME_ID ?? "Local-JDK-17";
const BUNDLE_ID = process.env.AWKIT_GUI_DRIVER_BUNDLE_ID ?? "Oracle-ojdbc17-local-19c-validation";
const TEMP_PROFILE_ID = "awkit-gui-usage-probe";

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// The app shows a branding splash window first; wait for the MAIN window that exposes the
// `window.playwrightFlowStudio` preload bridge (the splash has no bridge).
async function resolveMainWindow(app, timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  await app.firstWindow().catch(() => undefined);
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      try {
        const ready = await w.evaluate(() => typeof window.playwrightFlowStudio !== "undefined" && !!window.playwrightFlowStudio.settings);
        if (ready) return w;
      } catch { /* window navigating/closing — retry */ }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("main window with the playwrightFlowStudio bridge did not appear within timeout");
}

const app = await electron.launch({ args: [root], cwd: root, env });
const win = await resolveMainWindow(app);
const consoleErrors = [];
win.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
await win.waitForLoadState("domcontentloaded");
await win.waitForTimeout(400);

// Snapshot the real route so the test restores it exactly (non-destructive).
const original = await win.evaluate(async () => {
  const s = await window.playwrightFlowStudio.settings.get();
  return { lastRouteId: s.lastRouteId };
});

try {
  // Render Settings (the Database Drivers cards live inline on the settings route).
  await win.evaluate(() => window.playwrightFlowStudio.settings.update({ lastRouteId: "settings" }));
  await win.reload();
  await win.waitForLoadState("domcontentloaded");
  await win.waitForTimeout(600);

  // 1. Both cards render.
  const javaHeading = await win.getByRole("heading", { name: "Java Runtime for Database Drivers" }).count();
  check("Java Runtime card renders", javaHeading >= 1, `headings=${javaHeading}`);
  const driverHeading = await win.getByRole("heading", { name: "Oracle JDBC Drivers" }).count();
  check("Oracle JDBC Drivers card renders", driverHeading >= 1, `headings=${driverHeading}`);

  // 2. Both security warnings render with the expected copy.
  const warnings = await win.locator(".oracle-driver-warning").count();
  check("both security-warning notes render", warnings >= 2, `warnings=${warnings}`);
  const javaWarn = await win.getByText(/External Java runtimes execute code/i).count();
  const driverWarn = await win.getByText(/Oracle JDBC JAR files contain executable code/i).count();
  check("Java + driver security copy present", javaWarn >= 1 && driverWarn >= 1, `java=${javaWarn} driver=${driverWarn}`);

  // Visual proof of the rendered Database Drivers settings — focused element screenshots of each card
  // (the cards render below the fold, so a viewport capture would miss them).
  const shotDir = path.join(root, "reports", "oracle-validation");
  mkdirSync(shotDir, { recursive: true });
  const javaCard = win.locator("section.settings-card", { hasText: "Java Runtime for Database Drivers" });
  const driverCard = win.locator("section.settings-card", { hasText: "Oracle JDBC Drivers" });
  await javaCard.scrollIntoViewIfNeeded().catch(() => undefined);
  await javaCard.screenshot({ path: path.join(shotDir, "database-drivers-java-runtime.png") }).catch(() => undefined);
  await driverCard.scrollIntoViewIfNeeded().catch(() => undefined);
  await driverCard.screenshot({ path: path.join(shotDir, "database-drivers-jdbc-bundle.png") }).catch(() => undefined);
  console.log(`  → screenshots: ${shotDir}\\database-drivers-{java-runtime,jdbc-bundle}.png`);

  // 3. Java runtime metadata (model + rendered row).
  const javaList = await win.evaluate(() => window.playwrightFlowStudio.oracle.java.list());
  const jrt = javaList.find((r) => r.id === JAVA_ID);
  check("Java runtime present + valid", jrt && jrt.status === "valid", jrt ? `${jrt.name} status=${jrt.status} java=${jrt.javaVersion} arch=${jrt.architecture}` : "not found");
  check("Java runtime reports Java 8+ major", jrt && typeof jrt.javaMajorVersion === "number" && jrt.javaMajorVersion >= 8, jrt ? `major=${jrt.javaMajorVersion}` : "");
  const javaRowValid = jrt ? await win.getByText(jrt.name, { exact: false }).count() : 0;
  check("Java runtime row rendered", javaRowValid >= 1, `rows=${javaRowValid}`);
  const javaBadgeValid = await win.locator(".oracle-driver-badge.ok", { hasText: "Valid" }).count();
  check("a 'Valid' status badge renders", javaBadgeValid >= 1, `validBadges=${javaBadgeValid}`);

  // 4. Driver bundle metadata (model + rendered row).
  const bundleList = await win.evaluate(() => window.playwrightFlowStudio.oracle.drivers.list());
  const bundle = bundleList.find((b) => b.id === BUNDLE_ID);
  check("driver bundle present + valid", bundle && bundle.validationStatus === "valid", bundle ? `${bundle.name} status=${bundle.validationStatus} jdbc=${bundle.jdbcVersion}` : "not found");
  check("driver bundle reports a JDBC version", bundle && typeof bundle.jdbcVersion === "string" && bundle.jdbcVersion.length > 0, bundle ? `jdbc=${bundle.jdbcVersion}` : "");
  const bundleRow = bundle ? await win.getByText(bundle.name, { exact: false }).count() : 0;
  check("driver bundle row rendered", bundleRow >= 1, `rows=${bundleRow}`);

  // 5. Default selection is reflected, and set-default is idempotent (no second item to flip to).
  check("Java runtime marked default", jrt && jrt.isDefault === true, jrt ? `isDefault=${jrt.isDefault}` : "");
  check("driver bundle marked default", bundle && bundle.isDefault === true, bundle ? `isDefault=${bundle.isDefault}` : "");
  const stillDefault = await win.evaluate(async (id) => {
    await window.playwrightFlowStudio.oracle.java.setDefault(id);
    const list = await window.playwrightFlowStudio.oracle.java.list();
    return list.find((r) => r.id === id)?.isDefault === true;
  }, JAVA_ID);
  check("set-default is idempotent", stillDefault === true, `stillDefault=${stillDefault}`);

  // 6. validate() → valid for both.
  const jValidate = await win.evaluate((id) => window.playwrightFlowStudio.oracle.java.validate(id), JAVA_ID);
  check("java.validate → valid", jValidate.status === "valid", `status=${jValidate.status}`);
  const dValidate = await win.evaluate((id) => window.playwrightFlowStudio.oracle.drivers.validate(id), BUNDLE_ID);
  check("drivers.validate → valid", dValidate.validationStatus === "valid", `status=${dValidate.validationStatus}`);

  // 7. availability() reports a configured runtime (Java + driver selected).
  const avail = await win.evaluate(() => window.playwrightFlowStudio.oracle.availability());
  check("oracle.availability reports available", avail && avail.available === true, avail ? `available=${avail.available} source=${avail.source} driverExpected=${avail.driverExpected}` : "no result");

  // 8. END-TO-END: the selected Java launches the bridge, and with the bundle it loads the REAL driver.
  const bridgeOnly = await win.evaluate((id) => window.playwrightFlowStudio.oracle.java.testBridge(id), JAVA_ID);
  check("java.testBridge launches the isolated bridge", bridgeOnly && bridgeOnly.probed === true, bridgeOnly ? `probed=${bridgeOnly.probed} java=${bridgeOnly.javaVersion} reason=${bridgeOnly.reason ?? ""}` : "no result");
  const bridgeWithDriver = await win.evaluate((ids) => window.playwrightFlowStudio.oracle.java.testBridge(ids.j, ids.b), { j: JAVA_ID, b: BUNDLE_ID });
  check("java.testBridge + bundle loads the REAL ojdbc driver", bridgeWithDriver && bridgeWithDriver.probed === true && bridgeWithDriver.driverAvailable === true, bridgeWithDriver ? `driverAvailable=${bridgeWithDriver.driverAvailable} driver=${bridgeWithDriver.driverVersion} java=${bridgeWithDriver.javaVersion}` : "no result");
  const loadTest = await win.evaluate((id) => window.playwrightFlowStudio.oracle.drivers.testLoad(id), BUNDLE_ID);
  check("drivers.testLoad loads the driver in the bridge", loadTest && loadTest.driverAvailable === true, loadTest ? `driverAvailable=${loadTest.driverAvailable} driver=${loadTest.driverVersion} java=${loadTest.javaVersion}` : "no result");

  // 9. DELETION GUARD (non-destructive): a referencing profile blocks removal of the runtime + bundle.
  const beforeJavaUse = await win.evaluate((id) => window.playwrightFlowStudio.oracle.java.usage(id), JAVA_ID);
  const beforeBundleUse = await win.evaluate((id) => window.playwrightFlowStudio.oracle.drivers.usage(id), BUNDLE_ID);
  await win.evaluate((ids) => window.playwrightFlowStudio.oracle.saveProfile({
    id: ids.pid, name: "AWKIT GUI usage probe", connectionMode: "basic",
    host: "localhost", port: 1521, serviceName: "ORCLPDB", username: "reader",
    javaRuntimeProfileId: ids.j, driverBundleId: ids.b
  }), { pid: TEMP_PROFILE_ID, j: JAVA_ID, b: BUNDLE_ID });
  const afterJavaUse = await win.evaluate((id) => window.playwrightFlowStudio.oracle.java.usage(id), JAVA_ID);
  const afterBundleUse = await win.evaluate((id) => window.playwrightFlowStudio.oracle.drivers.usage(id), BUNDLE_ID);
  check("referencing profile increments Java usage", afterJavaUse === beforeJavaUse + 1, `before=${beforeJavaUse} after=${afterJavaUse}`);
  check("referencing profile increments bundle usage", afterBundleUse === beforeBundleUse + 1, `before=${beforeBundleUse} after=${afterBundleUse}`);

  // Rendered remove buttons must be disabled while referenced.
  await win.reload();
  await win.waitForLoadState("domcontentloaded");
  await win.waitForTimeout(500);
  const disabledRemoves = await win.evaluate(() =>
    Array.from(document.querySelectorAll(".oracle-driver-row"))
      .map((row) => {
        const title = row.querySelector(".oracle-driver-title strong")?.textContent ?? "";
        const del = row.querySelector("button.icon-button.danger");
        return { title, disabled: del ? del.disabled : null };
      }));
  check("a remove button is disabled while referenced", disabledRemoves.some((r) => r.disabled === true), JSON.stringify(disabledRemoves));

  // Drop the reference → usage returns to baseline and removal re-enables.
  await win.evaluate((id) => window.playwrightFlowStudio.oracle.deleteProfile(id), TEMP_PROFILE_ID);
  const restoredJavaUse = await win.evaluate((id) => window.playwrightFlowStudio.oracle.java.usage(id), JAVA_ID);
  const restoredBundleUse = await win.evaluate((id) => window.playwrightFlowStudio.oracle.drivers.usage(id), BUNDLE_ID);
  check("dropping the reference restores Java usage", restoredJavaUse === beforeJavaUse, `usage=${restoredJavaUse}`);
  check("dropping the reference restores bundle usage", restoredBundleUse === beforeBundleUse, `usage=${restoredBundleUse}`);

  // 10. No secret material in the renderer projections or DOM.
  const projections = JSON.stringify({ javaList, bundleList });
  check("renderer projections carry no secret keys", !/password|passwordSecret|secretValue/i.test(projections), "checked java+driver views");
  const html = await win.content();
  check("no obvious secret rendered in the DOM", !/IDENTIFIED BY|passwordSecretName/i.test(html), "scanned settings DOM");

  // 11. Responsive + reduced-motion.
  const noOverflow = await win.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2);
  check("Database Drivers layout has no horizontal overflow", noOverflow, "scrollWidth<=clientWidth");
  await win.emulateMedia({ reducedMotion: "reduce" });
  await win.waitForTimeout(150);
  const reduced = await win.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const headingStill = await win.getByRole("heading", { name: "Java Runtime for Database Drivers" }).count();
  check("renders under reduced-motion", reduced === true && headingStill >= 1, `reduced=${reduced} heading=${headingStill}`);

  // 12. No renderer console errors during the whole flow.
  check("no renderer console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
} finally {
  // Best-effort cleanup: delete the probe profile if it survived, restore the original route.
  await win.evaluate((id) => window.playwrightFlowStudio.oracle.deleteProfile(id).catch(() => undefined), TEMP_PROFILE_ID).catch(() => undefined);
  await win.evaluate((orig) => window.playwrightFlowStudio.settings.update({ lastRouteId: orig.lastRouteId }), original).catch(() => undefined);
  await app.close();
}

const passed = results.filter((r) => r.pass).length;
console.log(`\nDatabase Drivers GUI: ${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
