/**
 * verify:ai-settings-gui — real Electron walkthrough of Settings › Local AI (Phase L, L1.5 and L8a.4).
 *
 * Launches the BUILT app on an isolated profile, signs in as the first-run Super User and drives the
 * panel through the real preload bridge, IPC authorization and the dedicated AI settings store.
 *
 * What it pins, and what makes it fail:
 *   • a fresh profile shows AI OFF, no model pack, the runtime included at the manifest's pinned build,
 *     the manifest's accepted-pack count and an empty audit log (both read from the SOURCE, so they
 *     cannot go stale again the way the pre-pin "not included / 0 packs" expectations did);
 *   • each tier selector offers only tiers up to that feature's ceiling;
 *   • turning AI on and lowering a tier persist to `ai/ai-settings.json`, checked on DISK;
 *   • L8a.4, production path (no test seam): Automatic (the default since 2026-10-03) and the three E4
 *     modes as a labelled, described radio group driven by the KEYBOARD; the choice on disk; the GPU
 *     check from the real readiness answer (information under Automatic, a warning under GPU-Offload);
 *     an out-of-range VRAM reserve REFUSED (not clamped) with an accessible error, a valid one saved,
 *     the default restored; both themes use the Hologram tokens;
 *   • L8a.4 after a RESTART, with the deterministic test provider and its GPU fixture (a non-packaged
 *     seam that qualifies no hardware): the mode and reserve survived; GPU-Only refusal and
 *     GPU-Offload fallback are told apart for a missing pack, no NVIDIA adapter, a mixed or unreadable
 *     adapter set and low VRAM; fixture GPU-Offload and GPU-Only placements render with their layer
 *     counts and are labelled unqualified; Automatic runs every layer on the GPU with one NVIDIA adapter
 *     and on CPU & RAM only (no fallback) with a mixed set; a mode change unloads the idle model and the
 *     reserve is then disabled in CPU mode, and a change of the reserve alone unloads it too (the next
 *     load then reads as current again); a slow load shows its real stage; a settings file from before
 *     L8a, which never chose a mode, loads as Automatic and keeps its other fields;
 *   • L8b.5, production path: choosing a model file shows its size, the free space and what the copy
 *     needs BEFORE anything is copied (checked on disk), Cancel copies nothing, confirming copies it
 *     under its checksum and runs the real host's compatibility check; a file the runtime cannot read
 *     reads not compatible with its reason, its qualification Incompatible, speed unclaimed, with a
 *     re-check and no acknowledgement offered, and it can be removed;
 *   • no renderer error is logged across either launch.
 *
 * Needs `npm run build` first (it launches `out/`). Run: npm run verify:ai-settings-gui
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

import { DEFAULT_CREDS, isolatedLaunchEnv, resolveMainWindow, signInFirstRun } from "./lib/gui-verify-harness.mjs";
import { loginAs, makeChecker, navClick, watchConsole } from "./lib/e2e-qa-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { check, note, summarize, shotDir } = makeChecker("ai-settings-gui");
const { env, electronArgs, dataRoot, cleanup } = isolatedLaunchEnv("awkit-ai-settings-gui");
const settingsFile = path.join(dataRoot, "SpecterStudio", "ai", "ai-settings.json");
const readSettingsFile = () => (existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, "utf8")) : null);

// The runtime pin and the accepted packs, from the manifest source itself.
const manifestSource = readFileSync(path.join(root, "src", "offline", "AiModelManifest.ts"), "utf8");
const pinnedBuild = manifestSource.match(/AI_RUNTIME_PIN[\s\S]*?build:\s*"([^"]+)"/)?.[1] ?? null;
const acceptedPacks = (manifestSource.match(/export const AI_MODEL_MANIFEST[\s\S]*?\n\]\);/)?.[0].match(/sha256:\s*"[0-9a-f]{64}"/g) ?? []).length;

// Launch 2's test provider and GPU fixture. The fixture file starts ABSENT: the production readiness answers.
const work = mkdtempSync(path.join(tmpdir(), "awkit-ai-settings-gui-fixture-"));
const providerFile = path.join(work, "provider.json");
const gpuFile = path.join(work, "gpu.json");
writeFileSync(providerFile, JSON.stringify({ text: "{}" }));
const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const plan = (fitLayers) => ({ deviceCount: 1, totalLayers: 24, fitLayers, fullRequiredBytes: 3 * GIB, reserveBytes: 256 * MIB, freeBytes: 2 * GIB, totalBytes: 8 * GIB });
const fixture = (value) => writeFileSync(gpuFile, JSON.stringify(value));

// A flow whose validator finds an issue, so asking for an explanation submits a real AI job.
const probeFlow = {
  id: "l8a4-gpu-probe",
  name: "GPU probe",
  version: 1,
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
  nodes: [
    { id: "start", type: "start", name: "Start", position: { x: 0, y: 0 } },
    { id: "click", type: "click", name: "Click without a locator", position: { x: 0, y: 120 } },
    { id: "end", type: "end", name: "End", position: { x: 0, y: 240 } }
  ],
  edges: [
    { id: "e0", source: "start", target: "click", type: "success" },
    { id: "e1", source: "click", target: "end", type: "success" }
  ]
};

let app;
let win;
let console_;
let asked = 0;

const panelOf = (page) => page.locator(".settings-card").filter({ has: page.getByRole("heading", { name: "Local AI", exact: true }) });

async function openSettings() {
  const panel = panelOf(win);
  // Right after sign-in the app restores its saved route when its settings read resolves, which can land
  // after a click and put the Dashboard back. Navigate again (bounded) rather than wait on a lost click.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await navClick(win, "Settings");
    if (await panel.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) return panel;
  }
  await panel.waitFor({ state: "visible", timeout: 5000 }).catch(async (error) => {
    // Evidence for the failure: what the window showed instead of the panel.
    await win.screenshot({ path: path.join(shotDir, "settings-open-timeout.png") }).catch(() => undefined);
    note(`window text: ${(await win.locator("body").innerText().catch(() => "")).slice(0, 400)}`);
    throw error;
  });
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

const radio = (panel, name) => panel.getByRole("radio", { name, exact: true });
const reserveInput = (panel) => panel.getByRole("spinbutton", { name: "GPU memory reserve (MB)" });
const describedBy = (locator) =>
  locator.evaluate((el) =>
    (el.getAttribute("aria-describedby") ?? "")
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
  );

/** The "Runs on" value in the status list. */
const runsOnOf = (text) => text.match(/Runs on\s*\n?([^\n]+)/)?.[1]?.trim() ?? "";
const runsOn = async (panel) => runsOnOf(await panel.innerText());

/**
 * Refresh, THEN read, until the panel matches. Reading first would let the previous state satisfy a
 * pattern two scenarios share (it did: an unreadable adapter list "passed" on the mixed set's text).
 */
async function panelMatches(panel, predicate, timeout) {
  const deadline = Date.now() + timeout;
  let text = "";
  do {
    await panel.getByRole("button", { name: "Refresh" }).click();
    await win.waitForTimeout(300);
    text = await panel.innerText();
  } while (!predicate(text) && Date.now() < deadline);
  return text;
}

async function runsOnMatches(panel, pattern, label, timeout = 10000) {
  const text = runsOnOf(await panelMatches(panel, (all) => pattern.test(runsOnOf(all)), timeout));
  check(label, pattern.test(text), text);
  return text;
}

/** Submit one real AI job through the renderer bridge (the Flow Designer's explain call). */
async function askAi() {
  asked += 1;
  const answer = await win.evaluate(
    ({ requestId, profile }) => window.playwrightFlowStudio.ai.explainValidation({ requestId, profile }),
    { requestId: `l8a4-ask-${asked}`, profile: probeFlow }
  );
  return answer.code;
}

/** The radio shows the SAVED mode, so it changes once the save lands (after any re-auth), not on click. */
async function chooseMode(panel, name, notice) {
  await radio(panel, name).click();
  await sees(panel.getByText(notice), `choosing ${name} is confirmed`);
  const saved = await win
    .waitForFunction((label) => [...document.querySelectorAll("input[name='ai-execution-mode']")].some((r) => r.checked && r.labels?.[0]?.textContent === label), name, { timeout: 5000 })
    .then(() => true, () => false);
  check(`...and ${name} shows as the selected mode`, saved);
}

async function launch(extraEnv) {
  app = await electron.launch({ args: [root, ...electronArgs], cwd: root, env: { ...env, ...extraEnv } });
  win = await resolveMainWindow(app);
  console_ = watchConsole(win);
  await win.waitForLoadState("domcontentloaded");
}

function noRendererErrors(label) {
  const relevantErrors = console_.errors.filter((e) => !/Autofill|DevTools/i.test(e.text));
  check(label, relevantErrors.length === 0, console_.summary());
}

try {
  check("(precondition) the manifest source names a pinned build and at least one accepted pack", pinnedBuild !== null && acceptedPacks >= 1, `${pinnedBuild} / ${acceptedPacks}`);

  await launch({});
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
  check(
    "the runtime is reported as included, at the manifest's pinned build",
    fresh.includes(`Included (llama.cpp ${pinnedBuild})`),
    fresh.match(/Runtime\s*\n?[^\n]*/)?.[0]
  );
  check(
    "the accepted model packs are the manifest's",
    new RegExp(`Accepted model packs\\s*${acceptedPacks}\\b`).test(fresh),
    `${fresh.match(/Accepted model packs\s*\S*/)?.[0]} (manifest: ${acceptedPacks})`
  );
  check("the audit log is empty and says so", /No AI change has been applied yet/.test(fresh));
  check("no settings file exists before any change", readSettingsFile() === null);

  const enable = panel.getByRole("checkbox", { name: "Enable local AI" });
  const pause = panel.getByRole("checkbox", { name: "Pause AI work while runs are active" });
  check("the master switch is present and off", (await enable.count()) === 1 && !(await enable.isChecked()));
  check("pausing AI while runs are active defaults to on", (await pause.count()) === 1 && (await pause.isChecked()));
  check("import is offered", (await panel.getByRole("button", { name: "Import Model Pack…" }).count()) === 1);
  check("remove is not offered without a pack", (await panel.getByRole("button", { name: "Remove Model Pack" }).count()) === 0);

  // ── L8b.5: the disk-space preflight comes BEFORE any copy, and a model the runtime cannot read is Incompatible ──
  console_.setLabel("model preflight");
  const modelsDir = path.join(dataRoot, "SpecterStudio", "ai", "models");
  const ggufsInProfile = () => (existsSync(modelsDir) ? readdirSync(modelsDir).filter((name) => name.endsWith(".gguf")) : []);
  // A GGUF magic and version with nothing after them: importable, but no model the runtime can read.
  const bareGguf = path.join(work, "Bare-Header.gguf");
  writeFileSync(bareGguf, Buffer.concat([Buffer.from("GGUF", "latin1"), Buffer.from([3, 0, 0, 0]), Buffer.alloc(4096)]));
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, bareGguf);
  const preflightDialog = win.getByRole("alertdialog", { name: "Import this model?" });
  await panel.getByRole("button", { name: "Import Model Pack…" }).click();
  if (await sees(preflightDialog, "choosing a model file shows what the copy needs before copying")) {
    const shown = await preflightDialog.innerText();
    check(
      "...its file name, size, the free space in the app's data folder and what is needed",
      /Bare-Header\.gguf is [\d.]+ [KMG]B\./.test(shown) && /The app's data folder has [\d.]+ [KMG]B free, and the copy needs [\d.]+ [KMG]B: the file and 256\.0 MB to spare\./.test(shown),
      shown
    );
    check("...and says a model this version does not list is checked and then needs accepting", /checked for compatibility on this machine/.test(shown) && /until you accept it as unverified/.test(shown), shown);
    check("keyboard focus starts on Cancel, the safe choice", await win.evaluate(() => document.activeElement?.textContent === "Cancel"));
    check("nothing is copied while the preflight is shown", ggufsInProfile().length === 0, ggufsInProfile().join(","));
    await preflightDialog.getByRole("button", { name: "Cancel" }).click();
    await preflightDialog.waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
    check("cancelling copies nothing and the pack stays not imported", ggufsInProfile().length === 0 && /Model pack\s*Not imported/.test(await panel.innerText()));
  }
  await panel.getByRole("button", { name: "Import Model Pack…" }).click();
  await preflightDialog.getByRole("button", { name: "Copy and check" }).click();
  await sees(panel.getByText(/Model copied into the app's data folder and checksummed/), "confirming copies the file and runs its compatibility check");
  check("the copy lands in the writable profile, under its checksum", /^[0-9a-f]{64}\.gguf$/.test(ggufsInProfile()[0] ?? "") && ggufsInProfile().length === 1, ggufsInProfile().join(","));
  const registeredText = await panelMatches(panel, (text) => /cannot read the file/.test(text), 20000);
  check("the registered model reads not compatible, with its reason", /Model pack\s*Bare-Header\.gguf: not compatible: the runtime cannot read the file \(not used\)/.test(registeredText), registeredText.match(/Model pack[^\n]*\n?[^\n]*/)?.[0]);
  check("...and its qualification reads Incompatible, with the same reason", /Qualification\s*Incompatible: the runtime cannot read the file/.test(registeredText), registeredText.match(/Qualification[^\n]*\n?[^\n]*/)?.[0]);
  check("...and speed is not claimed", /Speed on this machine\s*Not measured, so not claimed/.test(registeredText));
  check("an incompatible model offers a re-check but never the unverified-model acknowledgement", (await panel.getByRole("button", { name: "Check Compatibility Again" }).count()) === 1 && (await panel.getByRole("button", { name: "Use Unverified Model…" }).count()) === 0);
  await panel.getByRole("button", { name: "Check Compatibility Again" }).click();
  await sees(panel.getByText("Compatibility checked again. The result is below."), "the re-check runs and confirms");
  // awkit-djnl.17: one model copy or check at a time. The slot is claimed before any await, so of two checks
  // started together exactly one runs and the other is refused at once, never both running.
  const both = await win.evaluate(() => Promise.all([window.playwrightFlowStudio.ai.checkModelPack(), window.playwrightFlowStudio.ai.checkModelPack()]));
  const busy = both.filter((r) => r.code === "NOT_AVAILABLE" && /already running/.test(r.message ?? ""));
  check("two checks started together: exactly one runs, the other is refused as already running", busy.length === 1 && both.some((r) => r.ok === true), JSON.stringify(both));
  await panel.getByRole("button", { name: "Remove Model Pack" }).click();
  await win.getByRole("alertdialog", { name: "Remove the local AI model pack?" }).getByRole("button", { name: "Remove model pack" }).click();
  await sees(panel.getByText("Model pack removed."), "the registered model can be removed");
  check("...and its file is gone", ggufsInProfile().length === 0, ggufsInProfile().join(","));
  noRendererErrors("no renderer errors across the preflight, import, re-check and removal");

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
  // With AI on, status names the FIRST blocker. The runtime ships pinned, so it is the missing pack.
  const modelMissing = "No model pack imported";
  await sees(panel.getByText(modelMissing, { exact: true }), "once on, status names the first blocker: no model pack imported");
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
  await sees(panel.getByText(modelMissing, { exact: true }), "the re-opened panel re-reads its status from main");
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

  // ── L8a.4: execution mode, production path ──────────────────────────────────────────────────
  console_.setLabel("execution mode");
  const modes = panel.getByRole("group", { name: "Execution mode" });
  await sees(modes, "the execution modes are one labelled group");
  const auto = radio(panel, "Automatic");
  const cpu = radio(panel, "CPU & RAM only");
  const offload = radio(panel, "GPU-Offload");
  const only = radio(panel, "GPU-Only");
  check(
    "exactly four modes, named for a non-specialist",
    (await modes.getByRole("radio").count()) === 4 && (await auto.count()) === 1 && (await cpu.count()) === 1 && (await offload.count()) === 1 && (await only.count()) === 1
  );
  check("Automatic is selected on a fresh profile (the default since 2026-10-03)", (await auto.isChecked()) && !(await cpu.isChecked()) && !(await offload.isChecked()) && !(await only.isChecked()));
  check("...and turning AI on wrote it to disk as auto", readSettingsFile()?.executionMode === "auto", JSON.stringify(readSettingsFile()));
  const autoHelp = await describedBy(auto);
  const cpuHelp = await describedBy(cpu);
  const offloadHelp = await describedBy(offload);
  const onlyHelp = await describedBy(only);
  check(
    "Automatic says it is the default, runs as GPU-Offload when every adapter is NVIDIA and the pack is installed, and CPU & RAM only otherwise",
    /^The default\./.test(autoHelp) && /every display adapter is NVIDIA/.test(autoHelp) && /runs as GPU-Offload/.test(autoHelp) && /CPU & RAM only/.test(autoHelp),
    autoHelp
  );
  check("CPU mode says the GPU runtime is never started, and no longer claims to be the default", /GPU runtime is never started/.test(cpuHelp) && !/default/i.test(cpuHelp), cpuHelp);
  check("GPU-Offload says partial offload and a CPU fallback with a reason", /as many model layers on it as safely fit/.test(offloadHelp) && /runs on CPU & RAM and the reason is shown/.test(offloadHelp), offloadHelp);
  check("GPU-Only says every layer or unavailable, never a silent CPU switch", /Every model layer must fit/.test(onlyHelp) && /never switches to CPU & RAM on its own/.test(onlyHelp), onlyHelp);
  check("the group tells when a change applies", /next time the model loads/.test(await describedBy(modes)));
  const reserve = reserveInput(panel);
  check("the VRAM reserve is enabled under Automatic (it may use the GPU)", (await reserve.count()) === 1 && !(await reserve.isDisabled()));
  check("the reserve hint states its unit and the contract's bounds", /128–32768 MB/.test(await describedBy(reserve)) && /Windows/.test(await describedBy(reserve)), await describedBy(reserve));
  check("Status names where the model runs before any load", /^Not loaded; Automatic is used the next time the model loads$/.test(await runsOn(panel)), await runsOn(panel));
  const gpuCheck = panel.locator("#ai-execution-gpu-check");
  await panelMatches(panel, (text) => /Automatic runs the model on CPU & RAM only/.test(text), 10000);
  check(
    "the GPU check is the production answer here: no backend pack, so Automatic runs on CPU & RAM only",
    /No GPU backend pack is installed\. Automatic runs the model on CPU & RAM only\./.test(await gpuCheck.innerText()),
    await gpuCheck.innerText()
  );
  check("...as information, not a warning: it is the expected default without a GPU", !/\bwarn\b/.test((await gpuCheck.getAttribute("class")) ?? ""), await gpuCheck.getAttribute("class"));

  console_.setLabel("keyboard");
  await cpu.focus();
  await win.keyboard.press("ArrowDown");
  await sees(panel.getByText("Execution mode set to GPU-Offload. It takes effect the next time the model loads."), "an arrow key selects GPU-Offload and it is confirmed");
  check("GPU-Offload is written to disk", readSettingsFile()?.executionMode === "gpu-offload", JSON.stringify(readSettingsFile()));
  const focus = await win.evaluate(() => ({ id: document.activeElement?.id ?? "", ring: getComputedStyle(document.activeElement ?? document.body).boxShadow }));
  check("keyboard focus stays on the chosen mode after the save", focus.id === "ai-mode-gpu-offload", focus.id);
  check("...with a visible focus ring", focus.ring !== "none" && focus.ring !== "", focus.ring);
  await panelMatches(panel, (text) => /GPU-Offload will run the model on CPU & RAM/.test(text), 10000);
  check(
    "the GPU check is the production answer here: no backend pack, so GPU-Offload runs on CPU & RAM",
    /No GPU backend pack is installed\. GPU-Offload will run the model on CPU & RAM/.test(await gpuCheck.innerText()),
    await gpuCheck.innerText()
  );
  check("...and under an explicit GPU mode it is a warning", /\bwarn\b/.test((await gpuCheck.getAttribute("class")) ?? ""), await gpuCheck.getAttribute("class"));
  check("the reserve is enabled in a GPU mode", !(await reserve.isDisabled()));
  check("Status says the new mode applies at the next load", /GPU-Offload is used the next time the model loads/.test(await runsOn(panel)), await runsOn(panel));

  console_.setLabel("theme");
  const themeOf = () =>
    win.evaluate(() => {
      const option = document.querySelector(".ai-mode-option.is-selected");
      const probe = document.createElement("div");
      probe.style.background = "var(--awkit-accent-soft)";
      probe.style.color = "var(--awkit-text)";
      document.body.appendChild(probe);
      const token = getComputedStyle(probe);
      const out = {
        optionBg: option ? getComputedStyle(option).backgroundColor : "",
        tokenBg: token.backgroundColor,
        label: option ? getComputedStyle(option.querySelector("label")).color : "",
        tokenText: token.color,
        transition: option ? getComputedStyle(option).transitionDuration : ""
      };
      probe.remove();
      return out;
    });
  // Through the app's own switch, which re-derives the accent tokens for the theme. Setting data-theme by
  // hand would leave the light accent tokens inline (and did); the OS scheme is ignored once the
  // appearance is saved as light or dark.
  const themeIs = (theme) =>
    win.waitForFunction((want) => document.documentElement.dataset.theme === want, theme, { timeout: 5000 }).then(() => true, () => false);
  const darkSwitch = win.getByRole("switch", { name: "Dark appearance" });
  const setTheme = async (theme) => {
    if (((await darkSwitch.getAttribute("aria-checked")) === "true") !== (theme === "dark")) await darkSwitch.click();
    return themeIs(theme);
  };
  const startedDark = (await darkSwitch.getAttribute("aria-checked")) === "true";
  check("(precondition) the app applied the light theme", await setTheme("light"));
  await win.waitForTimeout(200);
  const light = await themeOf();
  await win.screenshot({ path: path.join(shotDir, "03-execution-light.png") }).catch(() => undefined);
  check("(precondition) the app applied the dark theme", await setTheme("dark"));
  await win.waitForTimeout(200);
  const dark = await themeOf();
  await win.screenshot({ path: path.join(shotDir, "04-execution-dark.png") }).catch(() => undefined);
  await setTheme(startedDark ? "dark" : "light");
  check("light theme: the selected mode uses the Hologram tokens", light.optionBg === light.tokenBg && light.label === light.tokenText, JSON.stringify(light));
  check("dark theme: the selected mode uses the Hologram tokens", dark.optionBg === dark.tokenBg && dark.label === dark.tokenText, JSON.stringify(dark));
  check("...and the two themes really differ", light.optionBg !== dark.optionBg && light.label !== dark.label);
  check("the mode options carry no motion (nothing for reduced motion to remove)", light.transition === "0s", light.transition);

  console_.setLabel("reserve");
  await reserve.fill("64");
  await reserve.press("Enter");
  const reserveAlert = panel.locator("#ai-vram-reserve-error");
  await sees(reserveAlert, "an out-of-range reserve is refused with an error beside the field");
  check("the error is main's own bounds sentence", /whole number of MB from 128 to 32768/.test(await reserveAlert.innerText()), await reserveAlert.innerText());
  check("the error is announced and tied to the field", (await reserveAlert.getAttribute("role")) === "alert" && (await reserve.getAttribute("aria-invalid")) === "true" && /from 128 to 32768/.test(await describedBy(reserve)));
  check("nothing was clamped: the file keeps the system default", readSettingsFile()?.vramReserveMb === null, JSON.stringify(readSettingsFile()));
  check("the refused entry stays visible for correction", (await reserve.inputValue()) === "64");
  check("keyboard focus stays in the field after Enter", (await win.evaluate(() => document.activeElement?.id)) === "ai-vram-reserve");
  await reserve.fill("1024");
  await reserve.press("Enter");
  await sees(panel.getByText("GPU memory reserve set to 1024 MB. It takes effect the next time the model loads."), "a valid reserve is saved and confirmed");
  check("1024 MB is written to disk", readSettingsFile()?.vramReserveMb === 1024, JSON.stringify(readSettingsFile()));
  check("the error clears once the value is accepted", (await reserveAlert.count()) === 0 && (await reserve.getAttribute("aria-invalid")) === null);
  await panel.getByRole("button", { name: "Use System Default" }).click();
  await sees(panel.getByText("GPU memory reserve set to the system default. It takes effect the next time the model loads."), "restoring the system default is confirmed");
  check("the default is written as null", readSettingsFile()?.vramReserveMb === null, JSON.stringify(readSettingsFile()));
  check("the field shows the default as empty", (await reserve.inputValue()) === "" && (await reserve.getAttribute("placeholder")) === "System default");
  await reserve.fill("1024");
  await reserve.press("Enter");
  await sees(panel.getByText("GPU memory reserve set to 1024 MB. It takes effect the next time the model loads."), "the reserve is set again before the restart");

  await offload.focus();
  await win.keyboard.press("ArrowDown");
  await sees(panel.getByText("Execution mode set to GPU-Only. It takes effect the next time the model loads."), "an arrow key selects GPU-Only");
  check("GPU-Only is written to disk", readSettingsFile()?.executionMode === "gpu-only");
  check("the GPU check says GPU-Only will refuse", /GPU-Only will refuse to load the model/.test(await gpuCheck.innerText()), await gpuCheck.innerText());
  check("the backend pack panel still says GPU use is not active", /GPU use\s*Not active yet — GPU-Only is selected/.test(await panel.innerText()));
  await panel.scrollIntoViewIfNeeded().catch(() => undefined);
  await win.screenshot({ path: path.join(shotDir, "05-execution-gpu-only.png") }).catch(() => undefined);
  noRendererErrors("no renderer errors across the first launch");
  await app.close();
  app = null;

  // ── L8a.4 after a restart, with the deterministic provider and its GPU fixture ──────────────
  await launch({ AWKIT_TEST_AI_PROVIDER: providerFile, AWKIT_TEST_AI_GPU: gpuFile });
  console_.setLabel("restart");
  await loginAs(win, DEFAULT_CREDS.username, DEFAULT_CREDS.password);
  await win.waitForSelector(".app-shell", { timeout: 25000 });
  panel = await openSettings();
  await sees(radio(panel, "GPU-Only"), "the panel is back after the restart");
  check("GPU-Only survived the restart", await radio(panel, "GPU-Only").isChecked());
  check("the 1024 MB reserve survived the restart", (await reserveInput(panel).inputValue()) === "1024");
  await panel.getByRole("checkbox", { name: "Enable local AI" }).click();
  await sees(panel.getByText("Local AI turned on."), "AI is turned on for the fixture launch");

  console_.setLabel("refusal: no pack (production readiness)");
  check("(fixture) a GPU-Only job is refused", (await askAi()) === "UNAVAILABLE");
  await runsOnMatches(panel, /^Not running: GPU-Only refused\. No GPU backend pack is installed\.$/, "GPU-Only refusal names the missing pack (the real readiness answer)");
  await sees(panel.getByText("Unavailable: GPU-Only refused to load the model", { exact: true }), "the AI status reads unavailable, not an error");
  const refusalAlert = panel.getByRole("alert").filter({ hasText: "GPU-Only refused to load the model" });
  await sees(refusalAlert, "the refusal is announced where the mode is chosen");
  await panel.getByRole("button", { name: "Switch to GPU-Offload" }).click();
  await sees(panel.getByText("Execution mode set to GPU-Offload. It takes effect the next time the model loads."), "the one-click switch to GPU-Offload is confirmed");
  check("...and written to disk", readSettingsFile()?.executionMode === "gpu-offload");
  check("(fixture) a GPU-Offload job is answered", (await askAi()) !== "UNAVAILABLE");
  await runsOnMatches(panel, /^CPU & RAM \(GPU-Offload fell back: No GPU backend pack is installed\.\)$/, "GPU-Offload falls back to CPU & RAM and says why");
  check("fallback and refusal read differently", !/refused/.test(await runsOn(panel)));
  await panel.scrollIntoViewIfNeeded().catch(() => undefined);
  await win.screenshot({ path: path.join(shotDir, "06-offload-fallback.png") }).catch(() => undefined);

  console_.setLabel("no NVIDIA adapter");
  fixture({ pack: "installed", adapters: [0x1002, 0x1414] });
  await chooseMode(panel, "GPU-Only", "Execution mode set to GPU-Only. It takes effect the next time the model loads.");
  await askAi();
  await runsOnMatches(panel, /^Not running: GPU-Only refused\. No NVIDIA display adapter was detected\.$/, "no NVIDIA adapter: GPU-Only refuses with that reason");
  const noNvidia = await panel.innerText();
  check("diagnostics list the adapters by PCI vendor ID only", /Display adapters \(PCI vendor\)\s*0x1002, 0x1414 \(software\)/.test(noNvidia), noNvidia.match(/Display adapters[^\n]*\n?[^\n]*/)?.[0]);
  check("diagnostics give readiness from the same reason sentence", /GPU readiness now\s*Not ready: No NVIDIA display adapter was detected\./.test(noNvidia));

  console_.setLabel("mixed adapters");
  fixture({ pack: "installed", adapters: [0x10de, 0x1002] });
  await askAi();
  await runsOnMatches(panel, /^Not running: GPU-Only refused\. The GPU the runtime would use cannot be proven to be NVIDIA\.$/, "a mixed adapter set is unproven, never treated as NVIDIA");
  check("the NVIDIA adapter is still shown by vendor ID", /0x10de \(NVIDIA\), 0x1002/.test(await panel.innerText()));

  console_.setLabel("unreadable adapters");
  fixture({ pack: "installed", adapters: null });
  await askAi();
  // The mixed set gave the same reason, so wait on what only this state shows.
  const unreadable = await panelMatches(panel, (text) => /Display adapters \(PCI vendor\)\s*Could not be read/.test(text), 10000);
  check("diagnostics say the adapter list could not be read", /Display adapters \(PCI vendor\)\s*Could not be read/.test(unreadable), unreadable.match(/Display adapters[^\n]*\n?[^\n]*/)?.[0]);
  check("...and an unreadable list is unproven, never NVIDIA", /^Not running: GPU-Only refused\. The GPU the runtime would use cannot be proven to be NVIDIA\.$/.test(runsOnOf(unreadable)), runsOnOf(unreadable));

  console_.setLabel("low VRAM");
  fixture({ pack: "installed", adapters: [0x10de], plan: plan(10) });
  await askAi();
  await runsOnMatches(
    panel,
    /^Not running: GPU-Only refused\. There is not enough free GPU memory for the model\. Needs 3\.3 GB including the reserve; 2\.0 GB is free\.$/,
    "low VRAM: GPU-Only refuses with the exact shortfall"
  );
  check("diagnostics show the runtime's VRAM figures from the plan", /GPU memory at the last plan\s*2\.0 GB free of 8\.0 GB; every layer needs 3\.0 GB plus a 256\.0 MB reserve/.test(await panel.innerText()));

  console_.setLabel("fixture GPU-Offload");
  await chooseMode(panel, "GPU-Offload", "Execution mode set to GPU-Offload. It takes effect the next time the model loads.");
  await askAi();
  await runsOnMatches(panel, /^GPU-Offload: 10 of 24 layers on the GPU, the rest on CPU & RAM$/, "(fixture) GPU-Offload places the layers that fit");
  const offloaded = await panel.innerText();
  check("diagnostics: Vulkan backend and 10 of 24 layers", /Backend\s*Vulkan, from the GPU backend pack/.test(offloaded) && /GPU layers\s*10 of 24/.test(offloaded));
  check("the backend pack panel reports the placement", /GPU use\s*In use: GPU-Offload: 10 of 24 layers on the GPU/.test(offloaded));
  check("a fixture success is labelled unqualified, never NVIDIA-qualified", /compatible but unqualified/.test(offloaded) && !/qualified NVIDIA|NVIDIA-qualified/i.test(offloaded));
  await panel.scrollIntoViewIfNeeded().catch(() => undefined);
  await win.screenshot({ path: path.join(shotDir, "07-fixture-offload.png") }).catch(() => undefined);

  console_.setLabel("mode change unloads");
  await chooseMode(panel, "CPU & RAM only", "Execution mode set to CPU & RAM only. It takes effect the next time the model loads.");
  await runsOnMatches(panel, /^Not loaded; CPU & RAM only is used the next time the model loads$/, "a mode change unloads the idle model at once (no stale GPU load)");
  check("the old placement is no longer reported", !/GPU use\s*In use/.test(await panel.innerText()));
  check("the VRAM reserve is disabled in CPU mode (it would have no effect)", await reserveInput(panel).isDisabled());
  await askAi();
  await runsOnMatches(panel, /^CPU & RAM$/, "the next job runs on CPU & RAM");

  console_.setLabel("fixture GPU-Only");
  fixture({ pack: "installed", adapters: [0x10de], plan: plan(24), loadDelayMs: 3000 });
  await chooseMode(panel, "GPU-Only", "Execution mode set to GPU-Only. It takes effect the next time the model loads.");
  const pending = askAi();
  await runsOnMatches(panel, /^Loading the model with layers on the GPU…$/, "a slow load shows its real stage", 5000);
  await pending;
  // No Refresh here: the panel re-reads by itself while a load is in progress.
  const finished = await panel.getByText("GPU-Only: all 24 layers on the GPU", { exact: true }).first().waitFor({ timeout: 6000 }).then(() => true, () => false);
  check("(fixture) GPU-Only places every layer, and the panel updated itself after the load", finished, await runsOn(panel));

  // Automatic through the real main process: readiness from the fixture, the resolution in the AiService.
  console_.setLabel("fixture Automatic");
  fixture({ pack: "installed", adapters: [0x10de], plan: plan(24) });
  await chooseMode(panel, "Automatic", "Execution mode set to Automatic. It takes effect the next time the model loads.");
  check("...written to disk as auto", readSettingsFile()?.executionMode === "auto", JSON.stringify(readSettingsFile()));
  await askAi();
  await runsOnMatches(panel, /^Automatic: all 24 layers on the GPU$/, "(fixture) Automatic with one NVIDIA adapter and the pack runs as GPU-Offload: every layer on the GPU");
  check("...the backend pack panel reports the GPU in use", /GPU use\s*In use: Automatic: all 24 layers on the GPU/.test(await panel.innerText()));
  // The adapter set changes; the reserve reset drops the idle load, so the next job resolves Automatic again.
  fixture({ pack: "installed", adapters: [0x10de, 0x1002], plan: plan(24) });
  await panel.getByRole("button", { name: "Use System Default" }).click();
  await sees(panel.getByText("GPU memory reserve set to the system default. It takes effect the next time the model loads."), "the reserve reset is confirmed (it drops the idle load)");
  await askAi();
  await runsOnMatches(panel, /^CPU & RAM$/, "(fixture) Automatic on a mixed adapter set runs on CPU & RAM only, not as a GPU-Offload fallback");
  const autoMixed = await panel.innerText();
  check(
    "...the GPU check says why, as information",
    /The GPU the runtime would use cannot be proven to be NVIDIA\. Automatic runs the model on CPU & RAM only\./.test(await panel.locator("#ai-execution-gpu-check").innerText()),
    await panel.locator("#ai-execution-gpu-check").innerText()
  );
  check("...and diagnostics give the readiness reason", /GPU readiness now\s*Not ready: The GPU the runtime would use cannot be proven to be NVIDIA\./.test(autoMixed));
  check("...and the GPU is not reported in use", !/GPU use\s*In use/.test(autoMixed));

  console_.setLabel("offload low VRAM fallback");
  fixture({ pack: "installed", adapters: [0x10de], plan: plan(0) });
  await chooseMode(panel, "GPU-Offload", "Execution mode set to GPU-Offload. It takes effect the next time the model loads.");
  await askAi();
  await runsOnMatches(panel, /^CPU & RAM \(GPU-Offload fell back: There is not enough free GPU memory for the model\.\)$/, "GPU-Offload with nothing fitting falls back to CPU & RAM");

  // A reserve change alone, the mode untouched, must also drop the idle load: releasing only on a mode
  // change would keep the model loaded under the old reserve ("Still loaded with the previous setting").
  console_.setLabel("reserve change unloads");
  const offloadReserve = reserveInput(panel);
  await offloadReserve.fill("2048");
  await offloadReserve.press("Enter");
  await sees(panel.getByText("GPU memory reserve set to 2048 MB. It takes effect the next time the model loads."), "a reserve-only change is saved and confirmed");
  check("...the mode is unchanged on disk and the reserve is new", readSettingsFile()?.executionMode === "gpu-offload" && readSettingsFile()?.vramReserveMb === 2048, JSON.stringify(readSettingsFile()));
  await runsOnMatches(panel, /^Not loaded; GPU-Offload is used the next time the model loads$/, "a reserve-only change unloads the idle model at once (no load kept under the old reserve)");
  await askAi();
  await runsOnMatches(
    panel,
    /^CPU & RAM \(GPU-Offload fell back: There is not enough free GPU memory for the model\.\)$/,
    "the next load is made under the new reserve: its result reads as current again"
  );

  console_.setLabel("legacy settings file");
  // Otherwise the panel could already show Automatic and the check below would pass on the old state.
  check("(precondition) GPU-Offload is the saved and shown mode before the legacy file is written", readSettingsFile()?.executionMode === "gpu-offload" && (await radio(panel, "GPU-Offload").isChecked()));
  const legacy = { schemaVersion: 1, enabled: true, yieldDuringRuns: true, idleUnloadMinutes: 10, featureTiers: { locatorSemanticUpgrade: "T0" } };
  writeFileSync(settingsFile, `${JSON.stringify(legacy, null, 2)}\n`);
  await panel.getByRole("button", { name: "Refresh" }).click();
  const legacyAuto = await radio(panel, "Automatic").waitFor({ state: "visible" }).then(async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !(await radio(panel, "Automatic").isChecked())) await win.waitForTimeout(100);
    return radio(panel, "Automatic").isChecked();
  });
  check("a settings file from before L8a never chose a mode, so it reads as Automatic (the default)", legacyAuto);
  check("...with the system-default reserve, enabled under Automatic", (await reserveInput(panel).inputValue()) === "" && !(await reserveInput(panel).isDisabled()));
  await chooseMode(panel, "GPU-Offload", "Execution mode set to GPU-Offload. It takes effect the next time the model loads.");
  const upgraded = readSettingsFile();
  check(
    "the first change writes the new fields and keeps the old ones",
    upgraded?.executionMode === "gpu-offload" && upgraded?.vramReserveMb === null && upgraded?.enabled === true && upgraded?.featureTiers?.locatorSemanticUpgrade === "T0",
    JSON.stringify(upgraded)
  );

  noRendererErrors("no renderer errors across the restart and fixture states");
  note(`settings file: ${JSON.stringify(readSettingsFile())}`);
} finally {
  await app?.close().catch(() => undefined);
  cleanup?.();
  rmSync(work, { recursive: true, force: true });
}

const failed = summarize();
process.exit(failed === 0 ? 0 : 1);
