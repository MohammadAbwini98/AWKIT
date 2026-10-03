/**
 * verify:ai-settings-gpu-gui — Settings › Local AI on REAL hardware with the REAL GPU backend pack (L8a,
 * Automatic). The same real-Electron walkthrough as verify:ai-settings-gui, with nothing substituted: no test
 * provider and no GPU fixture (both are refused here), the pinned Vulkan pack installed through Settings, the
 * pinned Qwen3.5-0.8B imported through Settings, and every AI request answered by the real runtime.
 *
 * What it pins, and what makes it fail:
 *   • the pack installs and the model imports through the real dialogs, trust chain and stores, and the
 *     stored mode stays Automatic (checked on DISK) from the fresh profile on;
 *   • before any load, the GPU check and diagnostics show the production readiness (the NVIDIA adapters by PCI
 *     vendor ID, the pack installed), nothing claims the GPU is in use, and the label claims no configuration;
 *   • a real AI request resolves Automatic: its job profile (the real `ai:jobStatus` push) and the panel name
 *     the mode the load RAN AS (GPU-Offload) with Automatic as the choice that picked it, never Automatic as the
 *     runtime mode; diagnostics show Vulkan and the layer count; a process maps ggml-vulkan.dll from the
 *     app-managed pack; nvidia-smi shows the model's VRAM;
 *   • the qualification label is the one the qualified list implies: Compatible but unqualified on the GPU
 *     (no Vulkan entry), Qualified on CPU & RAM for exactly the listed features;
 *   • CPU & RAM only stays available: choosing it unloads the GPU load (VRAM given back), the next request
 *     runs on the CPU, and choosing Automatic again resolves afresh onto the GPU;
 *   • a real not-ready condition, the pack removed through Settings: Automatic runs on CPU & RAM only with the
 *     reason as information, no fallback reason and no refusal; re-installing the pack puts the next load back
 *     on the GPU;
 *   • no renderer error is logged.
 *
 * Exit 0 PASS, 1 FAIL, 2 NOT RUN (no NVIDIA adapter, no Vulkan prebuilt or no model) or INCONCLUSIVE (a Remote
 * Desktop session: its adapter and Chromium's double count are not qualification topology; the checks still
 * run). Needs `npm run build` first (it launches `out/`). Run: npm run verify:ai-settings-gpu-gui
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

import { isolatedLaunchEnv, resolveMainWindow, signInFirstRun } from "./lib/gui-verify-harness.mjs";
import { makeChecker, navClick, watchConsole } from "./lib/e2e-qa-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODEL = Object.freeze({ file: "Qwen3.5-0.8B-Q4_K_M.gguf", sizeBytes: 527_502_816, displayName: "Qwen3.5 0.8B (Q4_K_M)" });
const modelFile = path.join(os.homedir(), "Downloads", MODEL.file);
const installedVulkan = path.join(root, "node_modules", "@node-llama-cpp", "win-x64-vulkan");
const smi = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "nvidia-smi.exe");

function notRun(reason) {
  console.log(`NOT RUN: ${reason} — exit 2, never a pass`);
  process.exit(2);
}

/** Windows' display adapters (name and PnP id), the setup doc's step 1. */
function windowsAdapters() {
  const out = spawnSync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_VideoController | ForEach-Object { '{0}|{1}' -f $_.PNPDeviceID, $_.Name }"],
    { encoding: "utf8", windowsHide: true, timeout: 60_000 }
  );
  return String(out.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [pnp = "", ...name] = line.split("|");
      return { pnp, name: name.join("|") };
    });
}
const remoteDesktop = (adapters) => adapters.some((a) => /^SWD\\REMOTEDISPLAYENUM\\/i.test(a.pnp));
/** This process's session, which `query session` marks with ">": "console Active" at the physical console. */
function ownSession() {
  const out = spawnSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "query.exe"), ["session"], { encoding: "utf8", windowsHide: true, timeout: 60_000 });
  const fields = String(out.stdout ?? "").split(/\r?\n/).find((line) => line.startsWith(">"))?.slice(1).trim().split(/\s+/) ?? [];
  const name = fields.length >= 4 ? fields[0] : "";
  const state = fields.find((field) => /^(Active|Disc|Conn|Listen)$/i.test(field)) ?? "unknown";
  return { text: `${name || "(unnamed)"} ${state}`, console: /^console$/i.test(name) && /^Active$/i.test(state) };
}

if (process.platform !== "win32") notRun("the GPU path is Windows-only");
if (!existsSync(path.join(root, "out", "main"))) notRun("no built app: run npm run build first");
if (!existsSync(installedVulkan)) notRun("the pinned Vulkan prebuilt is not installed");
if (!existsSync(modelFile) || statSync(modelFile).size !== MODEL.sizeBytes) notRun(`no ${MODEL.file} of ${MODEL.sizeBytes} bytes at ~/Downloads`);
const adaptersAtStart = windowsAdapters();
if (!adaptersAtStart.some((a) => /^PCI\\VEN_10DE&/i.test(a.pnp))) notRun(`no NVIDIA (VEN_10DE) display adapter: ${adaptersAtStart.map((a) => a.name).join(", ") || "none"}`);
if (!existsSync(smi)) notRun("nvidia-smi is not installed with the NVIDIA driver");

const { check, note, summarize, shotDir } = makeChecker("ai-settings-gpu-gui");
// The real path only: neither non-packaged seam may be set, whatever the caller's environment holds.
const { env, electronArgs, dataRoot, cleanup } = isolatedLaunchEnv("awkit-ai-settings-gpu-gui");
delete env.AWKIT_TEST_AI_PROVIDER;
delete env.AWKIT_TEST_AI_GPU;
const settingsFile = path.join(dataRoot, "SpecterStudio", "ai", "ai-settings.json");
const readSettingsFile = () => (existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, "utf8")) : null);
const backendsDir = path.join(dataRoot, "SpecterStudio", "ai", "backends");

// The pinned pack exactly as a user supplies it: the manifest's files from the installed prebuilt.
const backendManifest = JSON.parse(readFileSync(path.join(root, "src", "offline", "ai-backend-manifest.json"), "utf8"));
const vulkan = backendManifest.backends.find((b) => b.id === "vulkan");
const work = mkdtempSync(path.join(os.tmpdir(), "awkit-ai-settings-gpu-gui-src-"));
const packFolder = path.join(work, "vulkan-pack");
for (const file of vulkan.files) {
  const target = path.join(packFolder, ...file.path.split("/"));
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(path.join(installedVulkan, ...file.path.split("/")), target);
}

// What the qualified list says, read from its source: the CPU features of the 0.8B, and no Vulkan entry.
const qualifiedSource = readFileSync(path.join(root, "src", "offline", "AiQualifiedList.ts"), "utf8");
const qualifiedFeatureIds = [...qualifiedSource.matchAll(/cpu08b\("(\w+)", \d+\)/g)].map((m) => m[1]);
const listsVulkan = /backend:\s*"vulkan"/.test(qualifiedSource);
const settingsSource = readFileSync(path.join(root, "app", "renderer", "pages", "LocalAiSettings.tsx"), "utf8");
const featureLabels = Object.fromEntries([...(settingsSource.match(/const FEATURE_LABELS[\s\S]*?\n\};/)?.[0] ?? "").matchAll(/(\w+): "([^"]+)"/g)].map((m) => [m[1], m[2]]));
const featureOrder = Object.keys(featureLabels);
const qualifiedLabels = featureOrder.filter((id) => qualifiedFeatureIds.includes(id)).map((id) => featureLabels[id]);

/** VRAM in use on every NVIDIA GPU (MiB, summed), from the driver's own nvidia-smi. */
function vramMib() {
  const out = spawnSync(smi, ["--query-gpu=memory.used", "--format=csv,noheader,nounits"], { encoding: "utf8", windowsHide: true, timeout: 60_000 });
  const rows = String(out.stdout ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map(Number);
  return rows.length > 0 && rows.every(Number.isFinite) ? rows.reduce((a, b) => a + b, 0) : null;
}
/** nvidia-smi's reading once it is below `mib`, or the last one after 10 s: the driver frees VRAM once the process is gone. */
async function vramBelow(mib) {
  let reading = vramMib();
  for (let waited = 0; reading !== null && reading >= mib && waited < 10_000; waited += 250) {
    await new Promise((r) => setTimeout(r, 250));
    reading = vramMib();
  }
  return reading;
}
/** Processes with ggml-vulkan.dll mapped from the app-managed pack folder (Windows' own module list). */
function vulkanOwners() {
  const script =
    "$root = $env:AWKIT_BACKENDS_DIR.TrimEnd('\\') + '\\'; Get-Process | ForEach-Object { $p = $_; try { foreach ($m in $p.Modules) { if ($m.FileName -and $m.FileName.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and $m.FileName -like '*ggml-vulkan.dll') { '{0}|{1}' -f $p.Id, $p.ProcessName } } } catch {} }";
  const out = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true, timeout: 120_000, env: { ...process.env, AWKIT_BACKENDS_DIR: backendsDir } });
  return [...new Set(String(out.stdout ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean))];
}

let app;
let win;
let console_;
let asked = 0;
const probeFlow = {
  id: "l8a-gpu-gui-probe",
  name: "GPU probe",
  version: 1,
  createdAt: "2026-10-03T00:00:00.000Z",
  updatedAt: "2026-10-03T00:00:00.000Z",
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

const localAi = (page) => page.locator(".settings-card").filter({ has: page.getByRole("heading", { name: "Local AI", exact: true }) });
const packPanel = (page) => page.locator("section.settings-subsection").filter({ has: page.getByRole("heading", { name: "GPU backend pack (Vulkan)" }) });
const radio = (panel, name) => panel.getByRole("radio", { name, exact: true });
/** A labelled value in a readiness list: the label alone on its line ("Backend" is not "Backend pack"), then its value. */
const rowOf = (text, label) => text.match(new RegExp(`(?:^|\\n)[ \\t]*${label}[ \\t]*(?:\\n|\\t)[ \\t]*([^\\n]+)`))?.[1]?.trim() ?? "";
/** Diagnostics' "Execution mode" row with the "Running as" row after it (the mode group's legend has the same words). */
const modeRows = (text) => {
  const m = text.match(/(?:^|\n)[ \t]*Execution mode[ \t]*(?:\n|\t)[ \t]*([^\n]+)\n[ \t]*Running as[ \t]*(?:\n|\t)[ \t]*([^\n]+)/);
  return { configured: m?.[1]?.trim() ?? "", runningAs: m?.[2]?.trim() ?? "" };
};

async function sees(locator, label, timeout = 15000) {
  const ok = await locator.waitFor({ state: "visible", timeout }).then(() => true, () => false);
  check(label, ok);
  return ok;
}

async function openSettings() {
  const panel = localAi(win);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await navClick(win, "Settings");
    if (await panel.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) return panel;
  }
  await panel.waitFor({ state: "visible", timeout: 5000 });
  return panel;
}

/** Refresh, then read, until the panel matches (never read first: an earlier state could satisfy a later pattern). */
async function panelMatches(panel, predicate, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let text = "";
  do {
    await panel.getByRole("button", { name: "Refresh" }).click();
    await win.waitForTimeout(300);
    text = await panel.innerText();
  } while (!predicate(text) && Date.now() < deadline);
  return text;
}

async function answerDialog(result) {
  await app.evaluate(({ dialog }, value) => {
    dialog.showOpenDialog = async () => value;
  }, result);
}

/** The radio shows the SAVED mode, so it changes once the save lands, not on click. */
async function chooseMode(panel, name) {
  await radio(panel, name).click();
  await sees(panel.getByText(`Execution mode set to ${name}. It takes effect the next time the model loads.`), `choosing ${name} is confirmed`);
  const saved = await win
    .waitForFunction((label) => [...document.querySelectorAll("input[name='ai-execution-mode']")].some((r) => r.checked && r.labels?.[0]?.textContent === label), name, { timeout: 5000 })
    .then(() => true, () => false);
  check(`...and ${name} shows as the selected mode`, saved);
}

/** One real AI request through the renderer bridge (the Flow Designer's explain call); its job's statuses as pushed. */
async function askAi() {
  asked += 1;
  const requestId = `gpu-gui-ask-${asked}`;
  const started = Date.now();
  const answer = await win.evaluate(({ requestId, profile }) => window.playwrightFlowStudio.ai.explainValidation({ requestId, profile }), { requestId, profile: probeFlow });
  const wallMs = Date.now() - started;
  const statuses = await win.evaluate((id) => (window.__awkitJobs ?? []).filter((s) => s.jobId === id), requestId);
  const last = statuses.at(-1) ?? null;
  return { requestId, code: answer.code, wallMs, last, stages: [...new Set(statuses.map((s) => s.stage))] };
}

/** The job ran to an answer and its pushed profile is the resolved mode, never "auto". */
function jobRan(label, job, wanted) {
  const p = job.last?.profile;
  check(
    label,
    job.code === "OK" && job.last?.state === "completed" && p?.mode === wanted.mode && p?.backend === wanted.backend && p?.device === wanted.device && p?.mode !== "auto",
    JSON.stringify({ code: job.code, state: job.last?.state, profile: p, wallMs: job.wallMs, stages: job.stages })
  );
}

const noAutoAsRuntime = (text) => !/^Automatic\b/.test(rowOf(text, "Runs on")) && !/^Automatic\b/.test(modeRows(text).runningAs) && !/^In use: Automatic\b/.test(rowOf(text, "GPU use"));

try {
  check(
    "(precondition) the qualified list names the 0.8B's CPU features and no Vulkan configuration, and the Settings labels name them",
    qualifiedLabels.length === qualifiedFeatureIds.length && qualifiedLabels.length > 0 && !listsVulkan,
    `${qualifiedFeatureIds.join(",")} → ${qualifiedLabels.join(", ")}; vulkan entry: ${listsVulkan}`
  );
  check("(precondition) neither the test AI provider nor the GPU fixture is set for the app", env.AWKIT_TEST_AI_PROVIDER === undefined && env.AWKIT_TEST_AI_GPU === undefined);
  const rdp = remoteDesktop(adaptersAtStart);
  const sessionAtStart = ownSession();
  note(`session ${sessionAtStart.text}; Windows display adapters: ${adaptersAtStart.map((a) => `${a.name} (${a.pnp.split("\\")[0]}\\${a.pnp.split("\\")[1] ?? ""})`).join("; ")}`);
  if (rdp || !sessionAtStart.console) note("not at the physical console (or a Remote Desktop adapter is present): the run continues, but its result is INCONCLUSIVE, never qualification evidence");

  app = await electron.launch({ args: [root, ...electronArgs], cwd: root, env });
  win = await resolveMainWindow(app);
  console_ = watchConsole(win);
  await win.waitForLoadState("domcontentloaded");
  console_.setLabel("first-run super user");
  await signInFirstRun(win);
  // Every job status this window is pushed (ai:jobStatus), as AiJobProgress receives it.
  await win.evaluate(() => {
    window.__awkitJobs = [];
    window.playwrightFlowStudio.ai.onJobStatus((status) => window.__awkitJobs.push(status));
  });
  let panel = await openSettings();
  check("a fresh profile stores nothing yet", readSettingsFile() === null);

  // ── The real GPU backend pack, installed through Settings ──────────────────────────────────
  console_.setLabel("backend pack");
  const pack = packPanel(win);
  await answerDialog({ canceled: false, filePaths: [packFolder] });
  await pack.getByRole("button", { name: "Select Pack Folder…" }).click();
  await sees(pack.getByRole("heading", { name: "Ready to import — review and confirm" }), "the pinned Vulkan pack passes the preflight");
  await pack.getByRole("button", { name: "Copy and Import" }).click();
  await sees(pack.getByText("Installed and verified", { exact: true }), "the pack is installed and verified through the real trust chain", 120000);

  // ── The real model, imported through Settings ───────────────────────────────────────────────
  console_.setLabel("model import");
  await answerDialog({ canceled: false, filePaths: [modelFile] });
  await panel.getByRole("button", { name: "Import Model Pack…" }).click();
  const preflight = win.getByRole("alertdialog", { name: "Import this model?" });
  await sees(preflight, "choosing the model shows its preflight before copying");
  await preflight.getByRole("button", { name: "Copy and check" }).click();
  await sees(panel.getByText(/Model copied into the app's data folder and checksummed/), "the model is copied and checksummed", 180000);
  check("the model pack reads as the pinned 0.8B", rowOf(await panel.innerText(), "Model pack") === MODEL.displayName, rowOf(await panel.innerText(), "Model pack"));

  // ── AI on: the stored mode stays Automatic ──────────────────────────────────────────────────
  console_.setLabel("enable");
  await panel.getByRole("checkbox", { name: "Enable local AI" }).click();
  await sees(panel.getByText("Local AI turned on."), "turning AI on is confirmed");
  check("the stored mode is auto, on disk", readSettingsFile()?.executionMode === "auto" && readSettingsFile()?.enabled === true, JSON.stringify(readSettingsFile()));
  check("Automatic is the selected mode", await radio(panel, "Automatic").isChecked());

  // ── Before any load: the production readiness, and nothing claimed ──────────────────────────
  console_.setLabel("readiness");
  const ready = await panelMatches(panel, (text) => /GPU readiness now\s*\n?Ready:/.test(text) && /Runs on\s*\n?Not loaded; Automatic is used the next time the model loads/.test(text));
  const gpuCheck = panel.locator("#ai-execution-gpu-check");
  const gpuCheckText = await gpuCheck.innerText();
  check(
    "the GPU check is the production readiness: NVIDIA adapters by PCI vendor ID and the pack installed, as information",
    /^GPU check: \d+ NVIDIA display adapters? detected by PCI vendor ID and the backend pack is installed \(compatible but unqualified\)/.test(gpuCheckText) && !/\bwarn\b/.test((await gpuCheck.getAttribute("class")) ?? ""),
    gpuCheckText
  );
  check("diagnostics: readiness Ready, and the display adapters include 0x10de (NVIDIA)", /^Ready: \d+ NVIDIA adapters? by PCI vendor ID, backend pack installed/.test(rowOf(ready, "GPU readiness now")) && /0x10de \(NVIDIA\)/.test(rowOf(ready, "Display adapters \\(PCI vendor\\)")), `${rowOf(ready, "GPU readiness now")} / ${rowOf(ready, "Display adapters \\(PCI vendor\\)")}`);
  check("before a load, Runs on says Automatic is used at the next load, and the GPU is not claimed in use", rowOf(ready, "Runs on") === "Not loaded; Automatic is used the next time the model loads" && /GPU use\s*\n?Not active yet — Automatic is selected/.test(ready), `${rowOf(ready, "Runs on")} / ${rowOf(ready, "GPU use")}`);
  check("before a load, the label claims no configuration (where it runs is decided by the load)", /^Compatible but unqualified: where it runs is decided by/.test(rowOf(ready, "Qualification")), rowOf(ready, "Qualification"));
  const vramBefore = vramMib();
  await panel.scrollIntoViewIfNeeded().catch(() => undefined);
  await win.screenshot({ path: path.join(shotDir, "01-automatic-ready.png") }).catch(() => undefined);

  // ── A real request: Automatic resolves to GPU-Offload on the GPU ────────────────────────────
  console_.setLabel("automatic on the GPU");
  const first = await askAi();
  jobRan("a real request completes, and its pushed job profile is the resolved mode: GPU-Offload on the GPU (Vulkan), never auto", first, { mode: "gpu-offload", backend: "vulkan", device: "gpu" });
  check("...its stages include the GPU backend probe and the model load (a cold, resolved load)", first.stages.includes("backend-probe") && first.stages.includes("model-load") && first.last?.cold === true, first.stages.join(" → "));
  const onGpu = await panelMatches(panel, (text) => /^GPU-Offload/.test(rowOf(text, "Runs on")));
  const runsOn = rowOf(onGpu, "Runs on");
  const layers = runsOn.match(/(\d+)(?: of (\d+))? layers on the GPU/);
  check("Runs on names the mode the load ran as, GPU-Offload, with Automatic as the choice that picked it", /^GPU-Offload \(chosen by Automatic\): (all \d+|\d+ of \d+) layers on the GPU/.test(runsOn), runsOn);
  const modes = modeRows(onGpu);
  check("diagnostics: Execution mode is the stored Automatic, and Running as is the resolved GPU-Offload", modes.configured === "Automatic" && modes.runningAs === runsOn, `${modes.configured} / ${modes.runningAs}`);
  check("diagnostics: Vulkan from the GPU backend pack, and the layer count the status shows", rowOf(onGpu, "Backend") === "Vulkan, from the GPU backend pack" && layers !== null && rowOf(onGpu, "GPU layers").startsWith(`${layers[1]} of `), `${rowOf(onGpu, "Backend")} / ${rowOf(onGpu, "GPU layers")}`);
  check("the backend pack panel reports the GPU in use with the same placement", rowOf(onGpu, "GPU use") === `In use: ${runsOn}`, rowOf(onGpu, "GPU use"));
  check("no text presents Automatic as the runtime mode", noAutoAsRuntime(onGpu), [rowOf(onGpu, "Runs on"), rowOf(onGpu, "Running as"), rowOf(onGpu, "GPU use")].join(" | "));
  check(
    "the label is the qualified list's: Compatible but unqualified on the GPU, its evidence being for another configuration",
    rowOf(onGpu, "Qualification") === "Compatible but unqualified: its quality evidence is for another configuration. It runs with the app's standard limits and makes no quality claim",
    rowOf(onGpu, "Qualification")
  );
  const owners = vulkanOwners();
  check("a process maps ggml-vulkan.dll from the app-managed pack while the model is loaded", owners.length >= 1, owners.join(", ") || "none");
  const vramLoaded = vramMib();
  check("nvidia-smi shows the model's VRAM while loaded", vramBefore !== null && vramLoaded !== null && vramLoaded > vramBefore, `${vramBefore} → ${vramLoaded} MiB`);
  note(`first GPU request: ${first.wallMs} ms end to end (cold); VRAM ${vramBefore} → ${vramLoaded} MiB; Runs on "${runsOn}"`);
  const warm = await askAi();
  jobRan("a second request is answered warm on the same GPU load", warm, { mode: "gpu-offload", backend: "vulkan", device: "gpu" });
  check("...without a reload", warm.last?.cold === false && !warm.stages.includes("model-load"), warm.stages.join(" → "));
  await panel.scrollIntoViewIfNeeded().catch(() => undefined);
  await win.screenshot({ path: path.join(shotDir, "02-automatic-gpu.png") }).catch(() => undefined);

  // ── CPU & RAM only stays available ──────────────────────────────────────────────────────────
  console_.setLabel("cpu fallback available");
  await chooseMode(panel, "CPU & RAM only");
  check("...written to disk as cpu", readSettingsFile()?.executionMode === "cpu", JSON.stringify(readSettingsFile()));
  const vramAfterCpu = await vramBelow(vramLoaded ?? Number.MAX_SAFE_INTEGER);
  check("the mode change unloads the GPU load: no process maps the pack and nvidia-smi shows the VRAM given back", vulkanOwners().length === 0 && vramLoaded !== null && vramAfterCpu !== null && vramAfterCpu < vramLoaded, `${vramLoaded} → ${vramAfterCpu} MiB`);
  const onCpu = await askAi();
  jobRan("a request under CPU & RAM only runs on the CPU", onCpu, { mode: "cpu", backend: "cpu", device: "cpu" });
  const cpuText = await panelMatches(panel, (text) => rowOf(text, "Runs on") === "CPU & RAM");
  check("Runs on reads CPU & RAM", rowOf(cpuText, "Runs on") === "CPU & RAM", rowOf(cpuText, "Runs on"));
  check(
    `the label on CPU & RAM is Qualified for exactly the listed features (${qualifiedLabels.join(", ")})`,
    rowOf(cpuText, "Qualification") === `Qualified on CPU & RAM for ${qualifiedLabels.join(", ")}; every other feature is compatible but unqualified`,
    rowOf(cpuText, "Qualification")
  );

  console_.setLabel("automatic again");
  await chooseMode(panel, "Automatic");
  check("...written to disk as auto", readSettingsFile()?.executionMode === "auto");
  const again = await askAi();
  jobRan("choosing Automatic again: the next request resolves afresh onto the GPU", again, { mode: "gpu-offload", backend: "vulkan", device: "gpu" });
  check("...as a cold load through the backend probe", again.last?.cold === true && again.stages.includes("backend-probe"), again.stages.join(" → "));
  const againText = await panelMatches(panel, (text) => /^GPU-Offload/.test(rowOf(text, "Runs on")));
  check("Runs on is back on the GPU", rowOf(againText, "Runs on") === runsOn, rowOf(againText, "Runs on"));

  // ── A real not-ready condition: the pack removed ────────────────────────────────────────────
  console_.setLabel("pack removed");
  const loadedBeforeRemoval = vramMib();
  await pack.getByRole("button", { name: "Remove Backend Pack" }).click();
  const confirm = win.getByRole("alertdialog", { name: "Remove the GPU backend pack?" });
  await sees(confirm, "removing the pack asks for confirmation");
  await confirm.getByRole("button", { name: "Remove backend pack" }).click();
  await sees(pack.getByText("Not installed", { exact: true }), "the pack reads as not installed", 30000);
  check("the stored mode is still auto", readSettingsFile()?.executionMode === "auto");
  const removedVram = loadedBeforeRemoval === null ? null : await vramBelow(loadedBeforeRemoval);
  check("removing the pack released the GPU load (no process maps it, VRAM given back)", vulkanOwners().length === 0 && loadedBeforeRemoval !== null && removedVram !== null && removedVram < loadedBeforeRemoval, `${loadedBeforeRemoval} → ${removedVram} MiB`);
  const notReady = await panelMatches(panel, (text) => /Automatic runs the model on CPU & RAM only/.test(text));
  check(
    "the GPU check says why, as information: no pack, so Automatic runs on CPU & RAM only",
    /^GPU check: No GPU backend pack is installed\. Automatic runs the model on CPU & RAM only\.$/.test(await gpuCheck.innerText()) && !/\bwarn\b/.test((await gpuCheck.getAttribute("class")) ?? ""),
    await gpuCheck.innerText()
  );
  check("diagnostics: readiness Not ready with the same reason", rowOf(notReady, "GPU readiness now") === "Not ready: No GPU backend pack is installed.", rowOf(notReady, "GPU readiness now"));
  const fallback = await askAi();
  jobRan("Automatic without a ready GPU runs the request on CPU & RAM only, and it completes", fallback, { mode: "cpu", backend: "cpu", device: "cpu" });
  check("...with no fallback reason on the job (it is not GPU-Offload falling back)", fallback.last?.profile?.fallbackReason === null, JSON.stringify(fallback.last?.profile));
  const fallbackText = await panelMatches(panel, (text) => rowOf(text, "Runs on") === "CPU & RAM");
  check("Runs on reads CPU & RAM, with no fallback and no refusal", rowOf(fallbackText, "Runs on") === "CPU & RAM" && !/fell back|refused/.test(fallbackText), rowOf(fallbackText, "Runs on"));
  check("the AI status is not Unavailable (Automatic never refuses as GPU-Only would)", !/^Unavailable/.test(rowOf(fallbackText, "Status")), rowOf(fallbackText, "Status"));
  check("no process maps a Vulkan pack and the GPU is not claimed in use", vulkanOwners().length === 0 && /GPU use\s*\n?Not active yet — Automatic is selected/.test(fallbackText), rowOf(fallbackText, "GPU use"));
  await panel.scrollIntoViewIfNeeded().catch(() => undefined);
  await win.screenshot({ path: path.join(shotDir, "03-automatic-no-pack.png") }).catch(() => undefined);

  // ── Readiness restored: the pack re-installed ───────────────────────────────────────────────
  console_.setLabel("pack restored");
  await answerDialog({ canceled: false, filePaths: [packFolder] });
  await pack.getByRole("button", { name: "Select Pack Folder…" }).click();
  await sees(pack.getByRole("heading", { name: "Ready to import — review and confirm" }), "the pack folder passes the preflight again");
  await pack.getByRole("button", { name: "Copy and Import" }).click();
  await sees(pack.getByText("Installed and verified", { exact: true }), "the pack is installed again", 120000);
  const restored = await askAi();
  jobRan("with the pack back, the next request resolves afresh onto the GPU", restored, { mode: "gpu-offload", backend: "vulkan", device: "gpu" });
  const restoredText = await panelMatches(panel, (text) => /^GPU-Offload/.test(rowOf(text, "Runs on")));
  check("Runs on is on the GPU again, and no text presents Automatic as the runtime mode", rowOf(restoredText, "Runs on") === runsOn && noAutoAsRuntime(restoredText), rowOf(restoredText, "Runs on"));
  check("a process maps ggml-vulkan.dll from the re-installed pack", vulkanOwners().length >= 1);

  const errors = console_.errors.filter((e) => !/Autofill|DevTools/i.test(e.text));
  check("no renderer errors across the walkthrough", errors.length === 0, console_.summary());
  const rdpAtEnd = remoteDesktop(windowsAdapters());
  const sessionAtEnd = ownSession();
  note(`at the end: session ${sessionAtEnd.text}, Remote Desktop adapter ${rdpAtEnd}`);
  if (rdp || rdpAtEnd || !sessionAtStart.console || !sessionAtEnd.console) process.exitCode = 2;
  note(`settings file: ${JSON.stringify(readSettingsFile())}`);
} catch (error) {
  check("the walkthrough ran to its end", false, String(error?.message ?? error));
} finally {
  await app?.close().catch(() => undefined);
  cleanup?.();
  rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

const failed = summarize();
if (failed > 0) process.exit(1);
if (process.exitCode === 2) {
  console.log("INCONCLUSIVE: not at the physical console, or a Remote Desktop adapter was present; NVIDIA evidence is taken only at the physical console (exit 2).");
  process.exit(2);
}
process.exit(0);
