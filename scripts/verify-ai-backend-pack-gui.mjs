/**
 * verify:ai-backend-pack-gui — real Electron walkthrough of Settings › Local AI › GPU backend pack (L8a.2).
 *
 * Launches the BUILT app on an isolated profile, signs in as the first-run Super User and drives the
 * workflow through the real preload bridge, IPC authorization, the signed-manifest trust chain and the
 * app-managed store. The folder dialog is answered in the main process (the only stub); the pack is the
 * real pinned Vulkan pack assembled from the installed prebuilt's 24 manifest files.
 *
 * What it pins, and what makes it fail:
 *   • a fresh profile shows the pack not installed and GPU use not active, and Local AI unchanged;
 *   • a folder with an extra DLL is refused with a named reason, with no import offered and focus moved
 *     to the checklist; a closed dialog shows nothing;
 *   • a valid folder shows the whole preflight (backend, build, source, destination, size, free space,
 *     headroom, files validated, identical-pack state, warning) and copies NOTHING until confirmed;
 *   • confirming shows progress and installs the pack, checked on DISK: registry with a directory name
 *     only, 24 pack files plus the app's own 3 runtime DLLs byte-identical to this build's staged copies;
 *   • a byte flipped after import makes "Verify" refuse it and mark it invalid, on screen and on disk;
 *   • replacing installs a new versioned directory and removes the old one; removing (confirmed) deletes it;
 *   • nothing on screen claims a GPU is in use, and no renderer error is logged.
 *
 * Needs `npm run build` first (it launches `out/`). Run: npm run verify:ai-backend-pack-gui
 *
 * `--packaged` (npm run verify:ai-backend-pack-packaged, under tsx) runs the same walkthrough against
 * `dist/win-unpacked/SpecterStudio.exe`: trust then comes from the packaged `resources/resources` signed
 * manifest and `resources/native-hosts/ai`, the licence bypass is stripped as for every packaged gate, and
 * a `dist/` older than the sources is refused. Without a packaged app it exits 2 (NOT RUN), never 0.
 */

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

import { stalePackagedPayload } from "./helpers/packaged-artifacts.mjs";
import { isolatedLaunchEnv, resolveMainWindow, signInFirstRun } from "./lib/gui-verify-harness.mjs";
import { makeChecker, navClick, watchConsole } from "./lib/e2e-qa-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packaged = process.argv.includes("--packaged");
const EXE = path.join(root, "dist", "win-unpacked", "SpecterStudio.exe");
if (packaged && !existsSync(EXE)) {
  console.log("NOT RUN: dist/win-unpacked carries no packaged app — run `npm run package:portable` — exit 2, never a pass");
  process.exit(2);
}
const { check, note, summarize, shotDir } = makeChecker(packaged ? "ai-backend-pack-packaged" : "ai-backend-pack-gui");
const { env, electronArgs, dataRoot, cleanup } = isolatedLaunchEnv(packaged ? "awkit-ai-backend-pack-packaged" : "awkit-ai-backend-pack-gui");
// The runtime copies the app ships: packaged beside the CPU prebuilt in resources, in development the staged host.
const shippedRuntime = packaged
  ? path.join(root, "dist", "win-unpacked", "resources", "native-hosts", "ai", "node_modules", "@node-llama-cpp", "win-x64", "bins", "win-x64")
  : path.join(root, "build", "native-hosts", "ai", "node_modules", "@node-llama-cpp", "win-x64", "bins", "win-x64");
const backends = path.join(dataRoot, "SpecterStudio", "ai", "backends");
const BINS = "bins/win-x64-vulkan";
const VC = ["msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll"];

// The real pinned pack: exactly the manifest's 24 files, from the installed prebuilt.
const manifest = JSON.parse(readFileSync(path.join(root, "src", "offline", "ai-backend-manifest.json"), "utf8"));
const vulkan = manifest.backends.find((b) => b.id === "vulkan");
const installedPkg = path.join(root, "node_modules", "@node-llama-cpp", "win-x64-vulkan");
const work = mkdtempSync(path.join(tmpdir(), "awkit-backend-gui-src-"));
const goodPack = path.join(work, "vulkan-pack");
const badPack = path.join(work, "vulkan-pack-extra-dll");
for (const dir of [goodPack, badPack]) {
  for (const file of vulkan.files) {
    const target = path.join(dir, ...file.path.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(installedPkg, ...file.path.split("/")), target);
  }
}
writeFileSync(path.join(badPack, ...`${BINS}/evil.dll`.split("/")), Buffer.concat([Buffer.from("MZ"), Buffer.alloc(4094)]));

const readRegistry = () => {
  const file = path.join(backends, "registry.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
};
const packDirs = () => (existsSync(backends) ? readdirSync(backends).filter((n) => /^vulkan-/.test(n)) : []);
function filesUnder(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesUnder(path.join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`]
  );
}

let app;
let win;
let console_;

const localAi = (page) => page.locator(".settings-card").filter({ has: page.getByRole("heading", { name: "Local AI", exact: true }) });
const packPanel = (page) => page.locator("section.settings-subsection").filter({ has: page.getByRole("heading", { name: "GPU backend pack (Vulkan)" }) });

async function openPanel() {
  await navClick(win, "Settings");
  const panel = packPanel(win);
  await panel.waitFor({ state: "visible", timeout: 15000 });
  return panel;
}

/** A wait that is recorded as a check: a timeout fails the check instead of aborting the suite. */
async function sees(locator, label, timeout = 15000) {
  const ok = await locator.waitFor({ state: "visible", timeout }).then(
    () => true,
    () => false
  );
  check(label, ok);
  return ok;
}

async function answerDialog(result) {
  await app.evaluate(({ dialog }, value) => {
    dialog.showOpenDialog = async () => value;
  }, result);
}

async function noReauthPrompt(label) {
  const prompt = win.getByRole("dialog").filter({ hasText: /password/i });
  check(`${label} needed no second password prompt (fresh sign-in)`, (await prompt.count()) === 0);
}

try {
  if (packaged) {
    const stale = await stalePackagedPayload(root);
    check("the packaged payload is not older than the source", stale === null, stale ?? undefined);
    const { sanitizeAppEnv } = await import("./helpers/packaged-license.mts");
    app = await electron.launch({ executablePath: EXE, args: electronArgs, env: sanitizeAppEnv(env), timeout: 60000 });
    check("the packaged app is what launched", (await app.evaluate(({ app: electronApp }) => electronApp.isPackaged)) === true);
  } else {
    app = await electron.launch({ args: [root, ...electronArgs], cwd: root, env });
  }
  win = await resolveMainWindow(app);
  console_ = watchConsole(win);
  await win.waitForLoadState("domcontentloaded");
  console_.setLabel("first-run super user");
  await signInFirstRun(win);

  // ── Fresh profile ───────────────────────────────────────────────────────────────────────────
  console_.setLabel("fresh");
  let panel = await openPanel();
  await sees(panel.getByText("Not installed", { exact: true }), "the backend pack reads as not installed");
  const fresh = await panel.innerText();
  check("GPU use is reported as not active", /GPU use\s*Not active — the model runs on CPU & RAM/.test(fresh), fresh.slice(0, 400));
  check("the pinned build is shown", fresh.includes(vulkan ? "node-llama-cpp@3.21.1+llama.cpp@v0.4.0" : "?"));
  check("Select Pack Folder is offered", (await panel.getByRole("button", { name: "Select Pack Folder…" }).count()) === 1);
  check("verify and remove are not offered without a pack", (await panel.getByRole("button", { name: "Verify Backend Pack" }).count()) === 0 && (await panel.getByRole("button", { name: "Remove Backend Pack" }).count()) === 0);
  check("Local AI itself is unchanged (turned off, CPU path)", /Turned off/.test(await localAi(win).innerText()));
  check("nothing exists under the backends folder yet", packDirs().length === 0 && readRegistry() === null);

  // ── A closed dialog shows nothing ───────────────────────────────────────────────────────────
  console_.setLabel("dialog closed");
  await answerDialog({ canceled: true, filePaths: [] });
  await panel.getByRole("button", { name: "Select Pack Folder…" }).click();
  await win.waitForTimeout(800);
  check("a closed folder dialog shows no checklist and no error", (await panel.getByRole("list", { name: "Backend pack checks" }).count()) === 0 && (await panel.getByRole("alert").count()) === 0);

  // ── A refused folder ────────────────────────────────────────────────────────────────────────
  console_.setLabel("refused folder");
  await answerDialog({ canceled: false, filePaths: [badPack] });
  await panel.getByRole("button", { name: "Select Pack Folder…" }).click();
  await sees(panel.getByRole("heading", { name: "This folder cannot be imported" }), "a folder with an extra DLL is refused");
  await noReauthPrompt("choosing a folder");
  const refusedText = await panel.innerText();
  check("the refusal names the unexpected native file", /executable or native library the manifest does not list: bins\/win-x64-vulkan\/evil\.dll/.test(refusedText), refusedText.slice(0, 600));
  check("the refusal is announced as an alert", (await panel.getByRole("alert").count()) >= 1);
  check("the failed check is spelled out, not only coloured", /File set: failed/.test(refusedText));
  check("no import is offered for a refused folder", (await panel.getByRole("button", { name: "Copy and Import" }).count()) === 0);
  const focusedId = await win.evaluate(() => document.activeElement?.id ?? "");
  check("focus moves to the checklist heading", focusedId === "ai-backend-preflight-title", focusedId);
  check("nothing was copied for the refused folder", packDirs().length === 0 && !(existsSync(backends) && readdirSync(backends).some((n) => n.startsWith(".staging-"))));
  await panel.getByRole("button", { name: "Close" }).click();
  check("closing removes the checklist", (await panel.getByRole("list", { name: "Backend pack checks" }).count()) === 0);

  // ── A valid folder: preflight, then confirm ─────────────────────────────────────────────────
  console_.setLabel("preflight");
  await answerDialog({ canceled: false, filePaths: [goodPack] });
  await panel.getByRole("button", { name: "Select Pack Folder…" }).click();
  await sees(panel.getByRole("heading", { name: "Ready to import — review and confirm" }), "a valid folder is ready to import");
  const pre = await panel.innerText();
  const checks = panel.getByRole("list", { name: "Backend pack checks" }).getByRole("listitem");
  check("the checklist has nine items", (await checks.count()) === 9, String(await checks.count()));
  check("every check passed", (await checks.allInnerTexts()).every((t) => /: passed/.test(t)), (await checks.allInnerTexts()).join(" | ").slice(0, 400));
  check("backend and build are shown", /vulkan · node-llama-cpp@3\.21\.1\+llama\.cpp@v0\.4\.0/.test(pre));
  check("the source folder is shown", pre.includes(goodPack));
  check("the app-managed destination is shown", pre.includes(path.join(dataRoot, "SpecterStudio", "ai", "backends")));
  check("the pack size including the runtime is shown", /Pack size\s*96\.\d MB \(including this build's Visual C\+\+ runtime\)/.test(pre), pre.match(/Pack size[^\n]*\n?[^\n]*/)?.[0]);
  check("free space and headroom are shown", /available; 256\.0 MB kept as headroom/.test(pre));
  check("all 24 files were validated", /Files validated\s*24 of 24/.test(pre));
  check("no identical pack is installed yet", /Already installed\s*No/.test(pre));
  check("the local-copy warning is shown", /copies these local files into the app's\s+data folder/.test(pre));
  check("nothing is copied before confirmation", packDirs().length === 0);
  await win.screenshot({ path: path.join(shotDir, "01-preflight.png") }).catch(() => undefined);

  console_.setLabel("import");
  await panel.getByRole("button", { name: "Copy and Import" }).click();
  // Progress is ephemeral: sample it while the import runs rather than after.
  let sawProgress = false;
  let sawCancel = false;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (!sawProgress && (await panel.getByRole("progressbar", { name: "Backend pack import progress" }).count()) > 0) sawProgress = true;
    if (!sawCancel && (await panel.getByRole("button", { name: "Cancel Import" }).count()) > 0) sawCancel = true;
    if ((await panel.getByText("Installed and verified", { exact: true }).count()) > 0) break;
    await win.waitForTimeout(50);
  }
  check("an accessible progress bar is shown while copying", sawProgress);
  check("Cancel Import is offered while copying", sawCancel);
  await sees(panel.getByText("Installed and verified", { exact: true }), "the pack reads as installed and verified");
  await sees(panel.getByText("GPU backend pack installed and verified. This does not turn on GPU use."), "success is announced without claiming GPU use");
  await noReauthPrompt("importing");
  const installedText = await panel.innerText();
  check("size and file count are shown", /Pack size\s*96\.\d MB, 27 files/.test(installedText), installedText.match(/Pack size[^\n]*\n?[^\n]*/)?.[0]);
  check("last verification is shown", /Last verified\s*\d/.test(installedText));
  check("GPU use is still reported as not active", /GPU use\s*Not active/.test(installedText));
  const registry = readRegistry();
  const dir = registry?.active?.dir ?? "";
  check("the registry names a versioned directory, not a path", /^vulkan-3\.21\.1-[a-z0-9]+$/.test(dir) && !JSON.stringify(registry).includes(":\\\\"), JSON.stringify(registry)?.slice(0, 200));
  const files = dir ? filesUnder(path.join(backends, dir)).sort() : [];
  const expected = [...vulkan.files.map((f) => f.path), ...VC.map((n) => `${BINS}/${n}`)].sort();
  check("on disk: exactly the 24 pack files plus 3 runtime DLLs", files.join() === expected.join(), `${files.length}`);
  check(
    `on disk: the runtime DLLs are this build's own copies (${packaged ? "shipped in resources/native-hosts/ai" : "the staged host"})`,
    dir !== "" && VC.every((n) => readFileSync(path.join(backends, dir, ...BINS.split("/"), n)).equals(readFileSync(path.join(shippedRuntime, n))))
  );
  check("the source folder is untouched and still holds no runtime DLL", VC.every((n) => !existsSync(path.join(goodPack, ...BINS.split("/"), n))));
  await win.screenshot({ path: path.join(shotDir, "02-installed.png") }).catch(() => undefined);

  // ── Tampering after import ──────────────────────────────────────────────────────────────────
  console_.setLabel("tamper");
  const target = path.join(backends, dir, ...`${BINS}/ggml-vulkan.dll`.split("/"));
  const bytes = readFileSync(target);
  bytes[4096] ^= 0xff;
  writeFileSync(target, bytes);
  await panel.getByRole("button", { name: "Verify Backend Pack" }).click();
  await sees(panel.getByRole("alert").filter({ hasText: "failed its SHA-256 check: bins/win-x64-vulkan/ggml-vulkan.dll" }), "Verify refuses the altered file and names it");
  await sees(panel.getByText("Invalid — not used", { exact: true }), "the pack reads as invalid and not used");
  check("the invalid state is persisted with its reason", readRegistry()?.active?.invalid?.reason === "HASH_MISMATCH", JSON.stringify(readRegistry()?.active?.invalid));
  check("the altered file was not repaired", !readFileSync(target).equals(readFileSync(path.join(goodPack, ...`${BINS}/ggml-vulkan.dll`.split("/")))));
  check("replace and remove are offered for an invalid pack", (await panel.getByRole("button", { name: "Replace Backend Pack…" }).count()) === 1 && (await panel.getByRole("button", { name: "Remove Backend Pack" }).count()) === 1);
  await win.screenshot({ path: path.join(shotDir, "03-invalid.png") }).catch(() => undefined);

  // ── Replace ─────────────────────────────────────────────────────────────────────────────────
  console_.setLabel("replace");
  await answerDialog({ canceled: false, filePaths: [goodPack] });
  await panel.getByRole("button", { name: "Replace Backend Pack…" }).click();
  await sees(panel.getByRole("heading", { name: "Ready to import — review and confirm" }), "the replacement folder is ready");
  await panel.getByRole("button", { name: "Copy and Import" }).click();
  await sees(panel.getByText("Installed and verified", { exact: true }), "the replacement is installed and verified", 60000);
  const newDir = readRegistry()?.active?.dir ?? "";
  check("the replacement lives in a new versioned directory", newDir !== "" && newDir !== dir, `${dir} -> ${newDir}`);
  check("the invalid pack's directory is gone", !existsSync(path.join(backends, dir)) && packDirs().length === 1, packDirs().join(","));

  // ── Navigating away and back re-reads from main ─────────────────────────────────────────────
  await navClick(win, "Dashboard");
  panel = await openPanel();
  await sees(panel.getByText("Installed and verified", { exact: true }), "the installed state survives navigating away");

  // ── Remove, with confirmation ───────────────────────────────────────────────────────────────
  console_.setLabel("remove");
  await panel.getByRole("button", { name: "Remove Backend Pack" }).click();
  const confirm = win.getByRole("alertdialog", { name: "Remove the GPU backend pack?" });
  await sees(confirm, "removal asks for confirmation");
  const focusInside = await win.evaluate(() => Boolean(document.activeElement?.closest("[role='alertdialog']")));
  check("focus is inside the confirmation dialog", focusInside);
  check("nothing is removed before confirming", packDirs().length === 1);
  // awkit-djnl.16: the shared dialog keeps a message's paragraph breaks (innerText follows white-space).
  const confirmBody = await confirm.locator(".modal-body").innerText();
  check(
    "the confirmation keeps its paragraph breaks",
    /on CPU & RAM\.\n\nThe folder you imported from is not touched\.\n\nContinue\?$/.test(confirmBody),
    JSON.stringify(confirmBody)
  );
  await confirm.getByRole("button", { name: "Remove backend pack" }).click();
  await sees(panel.getByText("GPU backend pack removed."), "removal is announced");
  await sees(panel.getByText("Not installed", { exact: true }), "the pack reads as not installed again");
  check("on disk: no pack directory is left and the registry is empty", packDirs().length === 0 && readRegistry()?.active === null, JSON.stringify(readRegistry()));

  const panelText = (await localAi(win).innerText()).replace(/Not active[^\n]*/g, "");
  check("no text claims a GPU is in use", !/GPU (is )?(active|enabled|in use|running)/i.test(panelText));
  const relevantErrors = console_.errors.filter((e) => !/Autofill|DevTools/i.test(e.text));
  check("no renderer errors across the journey", relevantErrors.length === 0, console_.summary());
  note(`registry after removal: ${JSON.stringify(readRegistry())}`);
} finally {
  await app?.close().catch(() => undefined);
  cleanup?.();
  rmSync(work, { recursive: true, force: true });
}

const failed = summarize();
process.exit(failed === 0 ? 0 : 1);
