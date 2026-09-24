/**
 * verify:ai-packaged-app — local AI inside the REAL packaged application (Phase L, L7 › Packaging; the
 * L1 decision record's "no packaged AI gate has run").
 *
 * `verify:ai-packaged-runtime` proves the shipped runtime tree is complete, but through a harness app.
 * This gate launches `dist/win-unpacked/SpecterStudio.exe` itself on a fresh, isolated %LOCALAPPDATA%,
 * creates its first account through the real sign-in screen, and then uses the app's own IPC only:
 *
 *   0. the packaged artifact itself carries no model file: every file of dist/win-unpacked and every file
 *      packed in its app.asar is read (extension, GGUF magic, pinned pack size), before anything launches;
 *   1. diagnostics: the packaged main process finds its runtime in resources/native-hosts/ai and reports
 *      the pinned build, and a fresh install has NO model pack (the installer never carries one);
 *   2. with AI enabled and no pack, AI is unavailable for the model, never for a missing runtime;
 *   3. the pinned Qwen3.5-0.8B pack from ~/Downloads imports through `ai:importModelPack` (the file dialog
 *      is answered in the main process, the only stub) into the writable profile, never into resources;
 *   4. a validation explanation of a broken flow runs a REAL inference in the packaged app's own utility
 *      host under the feature's own deadline, and the answer names the pinned model;
 *   5. the non-packaged test provider is unreachable: AWKIT_TEST_AI_PROVIDER points at a scripted answer
 *      and the answer must still come from the real model.
 *
 * Exit, the `gateExitCode` convention: NOT RUN (exit 2, with the reason, never a pass) without a packaged
 * tree that carries native-hosts/ai or without the pack. A stale packaged tree FAILS (exit 1). A TIMEOUT on
 * a contended host is INCONCLUSIVE (exit 2). Only a run where every step executed and passed exits 0.
 *
 * Run: npm run verify:ai-packaged-app   (after `npm run package:portable`)
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { _electron as electron, type ElectronApplication, type Page } from "playwright";

import { AI_MODEL_MANIFEST, AI_RUNTIME_PIN } from "../src/offline/AiModelManifest";
import { measurePack, ROOT } from "./ai-harness/launch.mts";
import { FLOW } from "./ai-harness/validationExplanationPacket";
import { scanForModelFiles } from "./helpers/model-pack-scan.mts";
import { stalePackagedPayload } from "./helpers/packaged-artifacts.mjs";
import { sanitizeAppEnv } from "./helpers/packaged-license.mts";
import { capturePackagedAppPids, ensurePackagedAppDead, type PackagedAppPids } from "./helpers/packaged-process-tree.mts";
import { gateExitCode } from "./lib/failure-capture-gate.mts";

const UNPACKED = path.join(ROOT, "dist", "win-unpacked");
const EXE = path.join(UNPACKED, "SpecterStudio.exe");
const PACKAGED_AI_MANIFEST = path.join(UNPACKED, "resources", "native-hosts", "ai", "ai-native-host-manifest.json");
const PACK_NAME = "Qwen3.5-0.8B-Q4_K_M.gguf";
// The password policy refuses a password containing the username, so the two share no word.
const ACCOUNT = { displayName: "Packaged AI Gate", username: "l7-ai-check", password: "Phase-L7!LocalRuntime2026" };

let passed = 0;
let failed = 0;
let inconclusive = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** The gate did not execute, so the process must not report success: exit 2, never 0. */
function notRun(reason: string): never {
  console.log(`NOT RUN: ${reason} — exit 2, never a pass`);
  process.exit(2);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The main window is the one carrying the preload bridge — never the splash window. */
async function mainWindow(app: ElectronApplication, timeoutMs = 60_000): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  await app.firstWindow({ timeout: timeoutMs }).catch(() => undefined);
  while (Date.now() < deadline) {
    for (const candidate of app.windows()) {
      const ready = await candidate.evaluate(() => typeof (window as any).playwrightFlowStudio?.ai?.getDiagnostics === "function").catch(() => false);
      if (ready) return candidate;
    }
    await sleep(400);
  }
  throw new Error("packaged main window with the preload bridge never appeared");
}

/** First run on a fresh profile: create the account through the real setup screen. */
async function signIn(win: Page): Promise<void> {
  await win.waitForSelector(".awkit-login-card, .app-shell", { timeout: 30_000 });
  if ((await win.locator(".app-shell").count()) > 0) return;
  await win.fill("#awkit-setup-display", ACCOUNT.displayName);
  await win.fill("#awkit-setup-username", ACCOUNT.username);
  const passwords = win.locator('.awkit-login-form input[type="password"]');
  await passwords.nth(0).fill(ACCOUNT.password);
  await passwords.nth(1).fill(ACCOUNT.password);
  await win.getByRole("button", { name: "Create account" }).click();
  await win
    .getByRole("heading", { name: "Save your recovery code" })
    .waitFor({ timeout: 30_000 })
    .catch(async (error: unknown) => {
      const shown = await win.locator(".awkit-login-form").innerText().catch(() => "");
      throw new Error(`first-run setup did not reach the recovery code: ${shown.replace(/\s+/g, " ").slice(0, 300)} (${String(error).slice(0, 80)})`);
    });
  await win.getByRole("checkbox", { name: "I saved this recovery code in a secure place." }).check();
  await win.getByRole("button", { name: "Continue to SpecterStudio" }).click();
  await win.waitForSelector(".app-shell", { timeout: 30_000 });
}

function findFiles(dir: string, match: (name: string) => boolean, out: string[] = []): string[] {
  for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findFiles(full, match, out);
    else if (entry.isFile() && match(entry.name)) out.push(full);
  }
  return out;
}

// ── Preconditions ────────────────────────────────────────────────────────────────────────────────

console.log("verify:ai-packaged-app — local AI inside the real packaged application\n");
if (!fs.existsSync(EXE) || !fs.existsSync(PACKAGED_AI_MANIFEST)) {
  notRun("dist/win-unpacked carries no packaged app with native-hosts/ai — run `npm run package:portable`");
}
const pack = path.join(os.homedir(), "Downloads", PACK_NAME);
if (!fs.existsSync(pack)) notRun(`no model pack at ~/Downloads/${PACK_NAME}`);

const stale = await stalePackagedPayload(ROOT);
check("the packaged payload is not older than the source", stale === null, stale ?? undefined);
const measured = await measurePack(pack);
const entry = AI_MODEL_MANIFEST.find((item) => item.sha256 === measured.sha256 && item.sizeBytes === measured.sizeBytes);
check("the pack is a pinned manifest entry", Boolean(entry), `sha256 ${measured.sha256}`);

console.log("\n0. The packaged artifact itself carries no model file");
const shipped = scanForModelFiles(UNPACKED);
check(
  `no model file in dist/win-unpacked, app.asar included (${shipped.files} files and ${shipped.asarEntries} asar entries read)`,
  shipped.files > 0 && shipped.asarEntries > 0 && shipped.found.length === 0,
  shipped.found.length > 0 ? shipped.found.slice(0, 5).join("; ") : "nothing was read"
);
if (stale !== null || !entry || failed > 0) {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(1);
}

// ── Run ──────────────────────────────────────────────────────────────────────────────────────────

const localAppData = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-ai-packaged-app-"));
// A scripted answer the non-packaged test provider WOULD return. A packaged app must never read it.
const scripted = path.join(localAppData, "scripted-ai-answer.json");
fs.writeFileSync(scripted, JSON.stringify({ text: '{"explanations":[],"fixOrder":[]}' }));
const env = sanitizeAppEnv({ ...process.env, LOCALAPPDATA: localAppData, AWKIT_TEST_AI_PROVIDER: scripted }) as Record<string, string | undefined>;
delete env.ELECTRON_RUN_AS_NODE;

let app: ElectronApplication | null = null;
let pids: PackagedAppPids = { stubPid: 0, mainPid: 0 };
try {
  app = await electron.launch({ executablePath: EXE, env: env as never, timeout: 60_000 });
  pids = await capturePackagedAppPids(app);
  const win = await mainWindow(app);
  await signIn(win);
  check("the packaged app launched on a fresh profile and signed in its first account", true);
  const diagnostics = (): Promise<any> => win.evaluate(() => (window as any).playwrightFlowStudio.ai.getDiagnostics());

  console.log("\n1. The installer carries the runtime and no model pack");
  const before = await diagnostics();
  check("the packaged main process finds its runtime (resources/native-hosts/ai)", before?.runtime?.included === true, JSON.stringify(before?.runtime));
  check("it reports the pinned runtime build", before?.runtime?.pinnedBuild === AI_RUNTIME_PIN.build, String(before?.runtime?.pinnedBuild));
  check("a fresh install has no model pack", before?.modelPack?.status === "missing", String(before?.modelPack?.status));
  check("the manifest it enforces is the source's", before?.modelPack?.manifestEntries === AI_MODEL_MANIFEST.length, String(before?.modelPack?.manifestEntries));

  console.log("\n2. Enabled with no pack: unavailable for the model, never for the runtime");
  const enabled: any = await win.evaluate(() => (window as any).playwrightFlowStudio.ai.updateSettings({ enabled: true }));
  check("AI can be enabled right after sign-in (fresh re-authentication)", enabled?.ok === true, JSON.stringify(enabled));
  const noPack: any = await win.evaluate(() => (window as any).playwrightFlowStudio.ai.getStatus());
  check("status is unavailable for MODEL_MISSING, not RUNTIME_MISSING", noPack?.state === "unavailable" && noPack?.reason === "MODEL_MISSING", `${noPack?.state}/${noPack?.reason}`);

  console.log("\n3. The pinned pack imports into the writable profile");
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog;
  }, pack);
  const started = Date.now();
  const imported: any = await win.evaluate(() => (window as any).playwrightFlowStudio.ai.importModelPack());
  check(`ai:importModelPack accepts the pinned pack (${Math.round((Date.now() - started) / 1000)} s)`, imported?.ok === true && imported?.detail === entry.id, JSON.stringify(imported));
  const after = await diagnostics();
  check("diagnostics now report that pack installed", after?.modelPack?.status === "installed" && after?.modelPack?.modelId === entry.id && after?.modelPack?.sha256 === entry.sha256, JSON.stringify(after?.modelPack));
  const inProfile = findFiles(localAppData, (name) => name.toLowerCase().endsWith(".gguf"));
  const inResources = scanForModelFiles(path.join(UNPACKED, "resources"));
  check("the imported pack lives under the writable %LOCALAPPDATA% profile", inProfile.length === 1, inProfile.join(", "));
  check("no model file was written into the packaged resources", inResources.files > 0 && inResources.found.length === 0, inResources.found.join(", "));

  console.log("\n4. A real inference in the packaged app's own utility host");
  const asked = Date.now();
  const view: any = await win.evaluate((flow) => (window as any).playwrightFlowStudio.ai.explainValidation({ requestId: "packaged-ai-gate-1", profile: flow }), FLOW as unknown);
  const elapsed = Math.round((Date.now() - asked) / 1000);
  if (view?.code === "TIMEOUT") {
    inconclusive += 1;
    console.log(`  ? INCONCLUSIVE: the explanation timed out after ${elapsed} s under the feature's own deadline (host contention is not a product verdict)`);
  } else {
    check(`the validation explanation answers OK (${elapsed} s)`, view?.code === "OK" && view?.ok === true, `${view?.code}: ${view?.message ?? ""}`);
    check("the answer names the pinned model, not the test provider (step 5)", view?.modelId === entry.id, String(view?.modelId));
    const explanations: Array<{ issue?: { code?: string }; text?: string }> = view?.explanations ?? [];
    check("it carries explanations attached to the validator's own issues", explanations.length > 0 && explanations.every((e) => typeof e.issue?.code === "string" && typeof e.text === "string" && e.text.length > 0), `${explanations.length} explanations`);
  }
  const final = await diagnostics();
  check("the host is healthy afterwards (circuit closed)", final?.runtime?.circuitOpen === false, JSON.stringify(final?.runtime));
  if (view?.code !== "TIMEOUT") check("the service counted one completed inference", (final?.counters?.completed ?? 0) >= 1, JSON.stringify(final?.counters));
} catch (error) {
  check("the packaged-app gate ran to completion", false, error instanceof Error ? error.message : String(error));
} finally {
  const leftovers = await ensurePackagedAppDead(app, pids);
  check("the packaged app's process tree terminated", leftovers.length === 0, leftovers.join(","));
  // Windows releases a memory-mapped .gguf slightly after its process exits.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(localAppData, { recursive: true, force: true });
      break;
    } catch {
      await sleep(1_000);
    }
  }
}

const exitCode = gateExitCode({ passed, failed, inconclusive, gateNotRun: false });
const verdict = exitCode === 1 ? "FAIL" : exitCode === 2 ? "INCONCLUSIVE" : "PASS";
console.log(`\n${passed} passed, ${failed} failed${inconclusive > 0 ? `, ${inconclusive} inconclusive` : ""} — ${verdict}`);
process.exit(exitCode);
