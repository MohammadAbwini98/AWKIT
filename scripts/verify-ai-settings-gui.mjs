/**
 * verify:ai-settings-gui — real Electron walkthrough of Settings › Local AI (Phase L, L1.5).
 *
 * Launches the BUILT app on an isolated profile, signs in as the first-run Super User and drives the
 * panel through the real preload bridge, IPC authorization and the dedicated AI settings store.
 *
 * What it pins, and what makes it fail:
 *   • a fresh profile shows AI OFF, no model pack, no runtime, zero accepted packs and an empty audit
 *     log (the "app unchanged without a model" acceptance, as a user sees it);
 *   • each tier selector offers only tiers up to that feature's ceiling (a T1 feature never offers
 *     Auto-apply; a T0 feature offers only Observe);
 *   • turning AI on and lowering a tier persist to `ai/ai-settings.json` under the isolated data root,
 *     checked on DISK rather than by asking the app, and survive navigating away;
 *   • no renderer error is logged across the journey.
 *
 * Needs `npm run build` first (it launches `out/`). Run: npm run verify:ai-settings-gui
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

import { isolatedLaunchEnv, resolveMainWindow, signInFirstRun } from "./lib/gui-verify-harness.mjs";
import { makeChecker, navClick, watchConsole } from "./lib/e2e-qa-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { check, note, summarize, shotDir } = makeChecker("ai-settings-gui");
const { env, electronArgs, dataRoot, cleanup } = isolatedLaunchEnv("awkit-ai-settings-gui");
const settingsFile = path.join(dataRoot, "SpecterStudio", "ai", "ai-settings.json");
const readSettingsFile = () => (existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, "utf8")) : null);

let app;
let win;
let console_;

const panelOf = (page) => page.locator(".settings-card").filter({ has: page.getByRole("heading", { name: "Local AI", exact: true }) });

async function openSettings() {
  await navClick(win, "Settings");
  const panel = panelOf(win);
  await panel.waitFor({ state: "visible", timeout: 15000 });
  return panel;
}

async function optionsOf(panel, label) {
  return panel.getByRole("combobox", { name: label }).locator("option").allTextContents();
}

/** A wait that is recorded as a check: a timeout fails the check instead of aborting the suite. */
async function sees(locator, label, timeout = 10000) {
  const ok = await locator.waitFor({ state: "visible", timeout }).then(
    () => true,
    () => false
  );
  check(label, ok);
  return ok;
}

try {
  app = await electron.launch({ args: [root, ...electronArgs], cwd: root, env });
  win = await resolveMainWindow(app);
  console_ = watchConsole(win);
  await win.waitForLoadState("domcontentloaded");
  console_.setLabel("first-run super user");
  await signInFirstRun(win);

  // ── Fresh profile: the app is unchanged without a model ─────────────────────────────────────
  console_.setLabel("fresh panel");
  let panel = await openSettings();
  check("Settings shows exactly one Local AI panel", (await panel.count()) === 1);
  await sees(panel.getByText("Turned off", { exact: true }), "the panel finished loading its status");
  const fresh = await panel.innerText();
  check("AI reads as turned off on a fresh profile", /Turned off/.test(fresh), fresh.slice(0, 300));
  check("no model pack is imported", /Not imported/.test(fresh));
  check("the runtime is reported as not included in this build", /Not included in this build/.test(fresh));
  check("zero model packs are accepted by this build", /Accepted model packs\s*0/.test(fresh), fresh.match(/Accepted model packs\s*\S*/)?.[0]);
  check("the audit log is empty and says so", /No AI change has been applied yet/.test(fresh));
  check("no settings file exists before any change", readSettingsFile() === null);

  const enable = panel.getByRole("checkbox", { name: "Enable local AI" });
  const pause = panel.getByRole("checkbox", { name: "Pause AI work while runs are active" });
  check("the master switch is present and off", (await enable.count()) === 1 && !(await enable.isChecked()));
  check("pausing AI while runs are active defaults to on", (await pause.count()) === 1 && (await pause.isChecked()));
  check("import is offered", (await panel.getByRole("button", { name: "Import Model Pack…" }).count()) === 1);
  check("remove is not offered without a pack", (await panel.getByRole("button", { name: "Remove Model Pack" }).count()) === 0);

  // ── Tier selectors are bounded by each feature's ceiling ────────────────────────────────────
  const featureRows = panel.locator("table[aria-label='Local AI features and their autonomy tiers'] tbody tr");
  check("all seven features are listed", (await featureRows.count()) === 7, String(await featureRows.count()));
  const t2 = await optionsOf(panel, "Semantic locator upgrade tier");
  const t1 = await optionsOf(panel, "Saved-locator repair tier");
  const t0 = await optionsOf(panel, "Failure analysis tier");
  check("the T2 feature offers all three tiers", t2.join("|") === "Observe|Suggest|Auto-apply with proof", t2.join("|"));
  check("a T1 feature never offers Auto-apply", t1.join("|") === "Observe|Suggest", t1.join("|"));
  check("a T0 feature offers only Observe", t0.join("|") === "Observe", t0.join("|"));
  await panel.scrollIntoViewIfNeeded().catch(() => undefined);
  await win.screenshot({ path: path.join(shotDir, "01-local-ai-fresh.png") }).catch(() => undefined);

  // ── Turning AI on persists, on disk ─────────────────────────────────────────────────────────
  console_.setLabel("enable");
  await enable.click();
  await sees(panel.getByText("Local AI turned on."), "turning AI on is confirmed");
  // With AI on, status names the FIRST blocker. This build ships no runtime, which outranks the
  // missing pack (importing a pack would not help); the Model pack row still reports "Not imported".
  const runtimeMissing = "The AI runtime is not included in this build";
  await sees(panel.getByText(runtimeMissing, { exact: true }), "once on, status names the first blocker: no runtime in this build");
  check("the pack row still reports the missing pack", /Model pack\s*Not imported/.test(await panel.innerText()));
  check("the switch is written to ai-settings.json", readSettingsFile()?.enabled === true, JSON.stringify(readSettingsFile()));

  console_.setLabel("lower a tier");
  await panel.getByRole("combobox", { name: "Semantic locator upgrade tier" }).selectOption("T0");
  await sees(panel.getByText("Semantic locator upgrade set to Observe."), "lowering a tier is confirmed");
  const upgradeRow = featureRows.filter({ hasText: "Semantic locator upgrade" });
  check("the lowered tier is in effect", (await upgradeRow.locator("td").nth(2).innerText()).trim() === "Observe");
  check("the lowered tier is written to disk", readSettingsFile()?.featureTiers?.locatorSemanticUpgrade === "T0", JSON.stringify(readSettingsFile()));

  // Navigating away and back re-reads from main, so this is persistence, not React state.
  await navClick(win, "Dashboard");
  panel = await openSettings();
  await sees(panel.getByText(runtimeMissing, { exact: true }), "the re-opened panel re-reads its status from main");
  check("the switch survives navigating away", await panel.getByRole("checkbox", { name: "Enable local AI" }).isChecked());
  check(
    "the lowered tier survives navigating away",
    (await panel.getByRole("combobox", { name: "Semantic locator upgrade tier" }).inputValue()) === "T0"
  );
  await panel.scrollIntoViewIfNeeded().catch(() => undefined);
  await win.screenshot({ path: path.join(shotDir, "02-local-ai-enabled.png") }).catch(() => undefined);

  console_.setLabel("disable");
  await panel.getByRole("checkbox", { name: "Enable local AI" }).click();
  await sees(panel.getByText("Local AI turned off."), "turning AI off is confirmed");
  await sees(panel.getByText("Turned off", { exact: true }), "the panel returns to turned off");
  check("and is written to disk", readSettingsFile()?.enabled === false);

  const relevantErrors = console_.errors.filter((e) => !/Autofill|DevTools/i.test(e.text));
  check("no renderer errors across the Local AI journey", relevantErrors.length === 0, console_.summary());
  note(`settings file: ${JSON.stringify(readSettingsFile())}`);
} finally {
  await app?.close().catch(() => undefined);
  cleanup?.();
}

const failed = summarize();
process.exit(failed === 0 ? 0 : 1);
