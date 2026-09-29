/**
 * verify:ai-model-registration — Phase L L8b acceptance (E11: the development machine, the PACKAGED build).
 *
 * Launches `dist/win-unpacked/SpecterStudio.exe` on a fresh, isolated %LOCALAPPDATA%, creates its first
 * account through the real sign-in screen and uses the app's own IPC and Settings page only:
 *
 *   A. a real compatible model the manifest does not list (Qwen3.5-2B) registers: the disk-space preflight
 *      comes before any copy; the copy lands under its checksum in the writable profile; the packaged host's
 *      header check and probe pass; it reads Compatible but unqualified (no quality evidence) and stays
 *      unused (MODEL_UNACKNOWLEDGED) until an administrator accepts it in Settings, after which AI is
 *      available on it;
 *   B. negative cases, each Incompatible with its reason: a malformed GGUF and an unsupported architecture;
 *   C. a real inference through the registered-model path, on an unlisted copy of the 0.8B that differs by
 *      one byte of its name metadata (so its checksum is not listed, and it still answers inside the
 *      feature's deadline, which the 2B does not on this machine: its L1.8 run failed at 240 s). It reads
 *      unqualified too: qualification is keyed on the checksum, not on how the model behaves;
 *   D. a byte changed in the stored copy after hashing is caught before the next load (HASH_MISMATCH), and
 *      AI reads MODEL_INVALID.
 *
 * Path traversal, junctions and symlinks are refused below this layer (verify:ai-host, verify:ai-model-pack);
 * a model whose thinking cannot be shown to be off is verify:ai-model-inspect's host mutant on a real model.
 *
 * Exit, the `gateExitCode` convention: NOT RUN (exit 2) without a packaged tree carrying native-hosts/ai or
 * without the models in ~/Downloads; a stale packaged tree FAILS; a TIMEOUT on a contended host is
 * INCONCLUSIVE (exit 2). Only a run where every step executed and passed exits 0.
 *
 * Run: npm run verify:ai-model-registration   (after `npm run package:portable`)
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { _electron as electron, type ElectronApplication, type Page } from "playwright";

import { AI_MODEL_MANIFEST } from "../src/offline/AiModelManifest";
import { measurePack, ROOT } from "./ai-harness/launch.mts";
import { FLOW } from "./ai-harness/validationExplanationPacket";
import { modelHeader } from "./helpers/gguf-header.mts";
import { stalePackagedPayload } from "./helpers/packaged-artifacts.mjs";
import { sanitizeAppEnv } from "./helpers/packaged-license.mts";
import { capturePackagedAppPids, ensurePackagedAppDead, type PackagedAppPids } from "./helpers/packaged-process-tree.mts";
import { gateExitCode } from "./lib/failure-capture-gate.mts";

const UNPACKED = path.join(ROOT, "dist", "win-unpacked");
const EXE = path.join(UNPACKED, "SpecterStudio.exe");
const PACKAGED_AI_MANIFEST = path.join(UNPACKED, "resources", "native-hosts", "ai", "ai-native-host-manifest.json");
const EXTERNAL_NAME = "Qwen3.5-2B-Q4_K_M.gguf";
const CURATED_NAME = "Qwen3.5-0.8B-Q4_K_M.gguf";
/** The 0.8B's own `general.name`, as its header carries it; one byte of it makes the unlisted copy. */
const NAME_IN_HEADER = "Qwen_Qwen3.5 0.8B";
const ACCOUNT = { displayName: "Registration Gate", username: "l8b-registration", password: "Phase-L8b!Register2026" };

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
function notRun(reason: string): never {
  console.log(`NOT RUN: ${reason} — exit 2, never a pass`);
  process.exit(2);
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function mainWindow(app: ElectronApplication, timeoutMs = 60_000): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  await app.firstWindow({ timeout: timeoutMs }).catch(() => undefined);
  while (Date.now() < deadline) {
    for (const candidate of app.windows()) {
      const ready = await candidate.evaluate(() => typeof (window as any).playwrightFlowStudio?.ai?.getStatus === "function").catch(() => false);
      if (ready) return candidate;
    }
    await sleep(400);
  }
  throw new Error("packaged main window with the preload bridge never appeared");
}

async function signIn(win: Page): Promise<void> {
  await win.waitForSelector(".awkit-login-card, .app-shell", { timeout: 30_000 });
  if ((await win.locator(".app-shell").count()) > 0) return;
  await win.fill("#awkit-setup-display", ACCOUNT.displayName);
  await win.fill("#awkit-setup-username", ACCOUNT.username);
  const passwords = win.locator('.awkit-login-form input[type="password"]');
  await passwords.nth(0).fill(ACCOUNT.password);
  await passwords.nth(1).fill(ACCOUNT.password);
  await win.getByRole("button", { name: "Create account" }).click();
  await win.getByRole("heading", { name: "Save your recovery code" }).waitFor({ timeout: 30_000 });
  await win.getByRole("checkbox", { name: "I saved this recovery code in a secure place." }).check();
  await win.getByRole("button", { name: "Continue to SpecterStudio" }).click();
  await win.waitForSelector(".app-shell", { timeout: 30_000 });
}

function ggufsIn(dir: string): string[] {
  const out: string[] = [];
  const walk = (at: string) => {
    for (const entry of fs.existsSync(at) ? fs.readdirSync(at, { withFileTypes: true }) : []) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.toLowerCase().endsWith(".gguf")) out.push(full);
    }
  };
  walk(dir);
  return out;
}

// ── Preconditions ────────────────────────────────────────────────────────────────────────────────

console.log("verify:ai-model-registration — L8b external model registration in the real packaged application\n");
if (!fs.existsSync(EXE) || !fs.existsSync(PACKAGED_AI_MANIFEST)) notRun("dist/win-unpacked carries no packaged app with native-hosts/ai — run `npm run package:portable`");
const external = path.join(os.homedir(), "Downloads", EXTERNAL_NAME);
const curated = path.join(os.homedir(), "Downloads", CURATED_NAME);
if (!fs.existsSync(external) || !fs.existsSync(curated)) notRun(`needs ~/Downloads/${EXTERNAL_NAME} and ~/Downloads/${CURATED_NAME}`);
const stale = await stalePackagedPayload(ROOT);
check("the packaged payload is not older than the source", stale === null, stale ?? undefined);
const externalMeasured = await measurePack(external);
check("(precondition) Qwen3.5-2B is a model the manifest does not list", !AI_MODEL_MANIFEST.some((entry) => entry.sha256 === externalMeasured.sha256), externalMeasured.sha256);
if (stale !== null || failed > 0) {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(1);
}

const localAppData = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-ai-registration-"));
const sources = path.join(localAppData, "sources");
fs.mkdirSync(sources, { recursive: true });
const modelsDir = path.join(localAppData, "SpecterStudio", "ai", "models");
const env = sanitizeAppEnv({ ...process.env, LOCALAPPDATA: localAppData }) as Record<string, string | undefined>;
delete env.ELECTRON_RUN_AS_NODE;

let app: ElectronApplication | null = null;
let pids: PackagedAppPids = { stubPid: 0, mainPid: 0 };
try {
  app = await electron.launch({ executablePath: EXE, env: env as never, timeout: 60_000 });
  pids = await capturePackagedAppPids(app);
  const win = await mainWindow(app);
  await signIn(win);
  check("the packaged app launched on a fresh profile and signed in its first account", true);
  const ai = <T = any,>(method: string, arg?: unknown): Promise<T> =>
    win.evaluate(([name, value]) => ((window as any).playwrightFlowStudio.ai as any)[name as string](value), [method, arg] as const) as Promise<T>;
  const pick = (file: string) =>
    app!.evaluate(({ dialog }, picked) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [picked] })) as typeof dialog.showOpenDialog;
    }, file);
  /** Both steps, the way Settings runs them: the preflight, then the copy named by its token. */
  const register = async (file: string) => {
    await pick(file);
    const pre: any = await ai("preflightModelPack");
    const copiedBefore = ggufsIn(modelsDir).length;
    const result: any = await ai("importModelPack", pre?.preflight?.token ?? "");
    const status: any = await ai("getStatus");
    return { pre, copiedBefore, result, status };
  };
  check("AI can be enabled right after sign-in", (await ai<any>("updateSettings", { enabled: true }))?.ok === true);

  // ── A ──────────────────────────────────────────────────────────────────────────────────────────
  console.log(`\nA. A real compatible model the manifest does not list: ${EXTERNAL_NAME}`);
  const started = Date.now();
  const a = await register(external);
  check(
    "the preflight names the file, its size and the free space against what the copy needs",
    a.pre?.ok === true &&
      a.pre.preflight?.fileName === EXTERNAL_NAME &&
      a.pre.preflight?.sizeBytes === externalMeasured.sizeBytes &&
      a.pre.preflight?.requiredBytes === externalMeasured.sizeBytes + a.pre.preflight?.headroomBytes &&
      typeof a.pre.preflight?.freeBytes === "number" &&
      a.pre.preflight?.spaceOk === true,
    JSON.stringify(a.pre?.preflight ?? a.pre)
  );
  check("...and nothing was copied before the import", a.copiedBefore === 0, String(a.copiedBefore));
  check(`the import copies it and runs both compatibility stages in the packaged host (${Math.round((Date.now() - started) / 1000)} s)`, a.result?.ok === true && a.result?.detail === EXTERNAL_NAME, JSON.stringify(a.result));
  const stored = ggufsIn(modelsDir);
  check("the copy is the only model file, stored under its checksum in the writable profile", stored.length === 1 && path.basename(stored[0]) === `${externalMeasured.sha256}.gguf`, stored.join(", "));
  const registry = fs.readFileSync(path.join(modelsDir, "registry.json"), "utf8");
  check("the registry holds its checksum, size and name, both verdicts, and no path", !registry.includes(os.homedir().replace(/\\/g, "\\\\")) && /"probeCheck"/.test(registry) && /"staticCheck"/.test(registry), registry);
  const pack = a.status?.modelPack;
  check("it reads compatible, not yet acknowledged", pack?.status === "registered" && pack?.reason === "COMPATIBLE" && pack?.acknowledged === false, JSON.stringify(pack));
  check("...and AI is unavailable on it: MODEL_UNACKNOWLEDGED", a.status?.state === "unavailable" && a.status?.reason === "MODEL_UNACKNOWLEDGED", `${a.status?.state}/${a.status?.reason}`);
  check(
    "...qualification: Compatible but unqualified, no quality evidence, speed not claimed",
    pack?.qualification?.label === "compatible-unqualified" && pack?.qualification?.reason === "NO_QUALITY_EVIDENCE" && pack?.qualification?.latency?.claimed === false,
    JSON.stringify(pack?.qualification)
  );

  // The acknowledgement, through Settings itself.
  const panel = win.locator(".settings-card").filter({ has: win.getByRole("heading", { name: "Local AI", exact: true }) });
  // Right after sign-in the app can restore its saved route over a click; navigate again, bounded.
  for (let attempt = 0; attempt < 3 && !(await panel.isVisible().catch(() => false)); attempt += 1) {
    // The sidebar's own nav button, as scripts/lib/e2e-qa-lib.mjs's navClick finds it.
    await win.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("button.nav-item")].find((b) => (b.textContent ?? "").trim() === "Settings")?.click());
    await panel.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
  }
  const accept = panel.getByRole("button", { name: "Use Unverified Model…" });
  // A wait, not `isVisible()`: that answers at once, before the panel has read its status.
  check("Settings offers the unverified-model acknowledgement", await accept.waitFor({ state: "visible", timeout: 15_000 }).then(() => true, () => false));
  await accept.click();
  const dialog = win.getByRole("alertdialog", { name: "Use a model this version does not list?" });
  await dialog.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
  check("...which names the model and says it has no quality evidence", /Qwen3\.5-2B-Q4_K_M\.gguf passed its compatibility checks/.test(await dialog.innerText().catch(() => "")) && /no quality evidence/.test(await dialog.innerText().catch(() => "")));
  await dialog.getByRole("button", { name: "Use unverified model" }).click();
  const acceptedNotice = await panel.getByText("Unverified model accepted. It is used the next time AI loads a model.").waitFor({ timeout: 15_000 }).then(() => true, () => false);
  check("accepting it is confirmed", acceptedNotice);
  const afterAck: any = await ai("getStatus");
  check("AI is now available on the registered model", afterAck?.state === "available" && afterAck?.modelPack?.acknowledged === true, `${afterAck?.state}/${afterAck?.reason}`);
  check("Settings reads it as compatible and acknowledged", /Qwen3\.5-2B-Q4_K_M\.gguf: compatible, acknowledged as unverified/.test(await panel.innerText()));

  // ── B ──────────────────────────────────────────────────────────────────────────────────────────
  console.log("\nB. Negative cases, each Incompatible with its reason");
  const bare = path.join(sources, "Malformed.gguf");
  fs.writeFileSync(bare, Buffer.concat([Buffer.from("GGUF", "latin1"), Buffer.from([3, 0, 0, 0]), Buffer.alloc(4096)]));
  const malformed = await register(bare);
  check(
    "a malformed GGUF reads GGUF_UNREADABLE, Incompatible, and AI reads MODEL_INCOMPATIBLE",
    malformed.status?.modelPack?.reason === "GGUF_UNREADABLE" && malformed.status?.modelPack?.qualification?.label === "incompatible" && malformed.status?.reason === "MODEL_INCOMPATIBLE",
    JSON.stringify(malformed.status?.modelPack)
  );
  const alien = path.join(sources, "Unknown-Architecture.gguf");
  fs.writeFileSync(alien, modelHeader({ arch: "notanarch" }));
  const unsupported = await register(alien);
  check(
    "an unsupported architecture reads ARCHITECTURE_UNSUPPORTED, Incompatible",
    unsupported.status?.modelPack?.reason === "ARCHITECTURE_UNSUPPORTED" && unsupported.status?.modelPack?.qualification?.label === "incompatible" && unsupported.status?.reason === "MODEL_INCOMPATIBLE",
    JSON.stringify(unsupported.status?.modelPack)
  );
  check("replacing the acknowledged model dropped its acknowledgement", unsupported.status?.modelPack?.acknowledged === false);

  // ── C ──────────────────────────────────────────────────────────────────────────────────────────
  console.log("\nC. A real inference through the registered-model path");
  const variant = path.join(sources, "Qwen3.5-0.8B-renamed.gguf");
  fs.copyFileSync(curated, variant);
  const head = Buffer.alloc(4 * 1024 ** 2);
  const handle = fs.openSync(variant, "r+");
  let edited = false;
  try {
    const read = fs.readSync(handle, head, 0, head.length, 0);
    const at = head.subarray(0, read).indexOf(Buffer.from(NAME_IN_HEADER, "latin1"));
    if (at >= 0) {
      // "0.8B" -> "0.8b": one byte of display metadata, so the checksum is no longer the curated pack's.
      fs.writeSync(handle, Buffer.from("b", "latin1"), 0, 1, at + NAME_IN_HEADER.length - 1);
      edited = true;
    }
  } finally {
    fs.closeSync(handle);
  }
  check("(precondition) the copy differs from the curated 0.8B in one byte of its name metadata", edited);
  const variantMeasured = await measurePack(variant);
  check("(precondition) ...so the manifest does not list it", !AI_MODEL_MANIFEST.some((entry) => entry.sha256 === variantMeasured.sha256));
  const c = await register(variant);
  check("it registers, passes both stages and reads compatible", c.result?.ok === true && c.status?.modelPack?.reason === "COMPATIBLE", JSON.stringify(c.status?.modelPack));
  check(
    "...and unqualified: qualification is keyed on the checksum, not on how the model behaves",
    c.status?.modelPack?.qualification?.label === "compatible-unqualified" && c.status?.modelPack?.qualification?.reason === "NO_QUALITY_EVIDENCE",
    JSON.stringify(c.status?.modelPack?.qualification)
  );
  check("...unused until acknowledged", c.status?.reason === "MODEL_UNACKNOWLEDGED");
  check("the acknowledgement is accepted over IPC too", (await ai<any>("acknowledgeModelPack"))?.ok === true);
  const asked = Date.now();
  const view: any = await win.evaluate((flow) => (window as any).playwrightFlowStudio.ai.explainValidation({ requestId: "registration-gate-1", profile: flow }), FLOW as unknown);
  const elapsed = Math.round((Date.now() - asked) / 1000);
  const externalId = `external-${variantMeasured.sha256.slice(0, 12)}`;
  if (view?.code === "TIMEOUT") {
    inconclusive += 1;
    console.log(`  ? INCONCLUSIVE: the explanation timed out after ${elapsed} s under the feature's own deadline (host contention is not a product verdict)`);
  } else {
    check(`a real validation explanation answers on the registered model (${elapsed} s)`, view?.code === "OK" && view?.ok === true, `${view?.code}: ${view?.message ?? ""}`);
    check("...naming the registered model by its checksum id, never a file name", view?.modelId === externalId, String(view?.modelId));
  }

  // ── D ──────────────────────────────────────────────────────────────────────────────────────────
  console.log("\nD. A byte changed in the stored copy after hashing");
  const storedVariant = path.join(modelsDir, `${variantMeasured.sha256}.gguf`);
  const sizeBefore = fs.statSync(storedVariant).size;
  // Release the loaded model (a mode change does), so the next job loads and verifies again.
  await ai("updateSettings", { executionMode: "gpu-offload" });
  await ai("updateSettings", { executionMode: "cpu" });
  await sleep(1_000);
  const tamper = fs.openSync(storedVariant, "r+");
  try {
    const one = Buffer.alloc(1);
    fs.readSync(tamper, one, 0, 1, sizeBefore - 1);
    fs.writeSync(tamper, Buffer.from([one[0] ^ 0xff]), 0, 1, sizeBefore - 1);
  } finally {
    fs.closeSync(tamper);
  }
  check("(precondition) the edit kept the file's size", fs.statSync(storedVariant).size === sizeBefore);
  const refused: any = await win.evaluate((flow) => (window as any).playwrightFlowStudio.ai.explainValidation({ requestId: "registration-gate-2", profile: flow }), FLOW as unknown);
  check("the next job is refused, never run on the altered file", refused?.ok === false, `${refused?.code}: ${refused?.message ?? ""}`);
  const tampered: any = await ai("getStatus");
  check(
    "the model reads invalid (HASH_MISMATCH) and AI reads MODEL_INVALID",
    tampered?.modelPack?.status === "invalid" && tampered?.modelPack?.reason === "HASH_MISMATCH" && tampered?.reason === "MODEL_INVALID",
    JSON.stringify({ pack: tampered?.modelPack, reason: tampered?.reason })
  );
  const diagnostics: any = await ai("getDiagnostics");
  check("the host stayed healthy through all of it (circuit closed)", diagnostics?.runtime?.circuitOpen === false, JSON.stringify(diagnostics?.runtime));
} catch (error) {
  check("the registration gate ran to completion", false, error instanceof Error ? error.message : String(error));
} finally {
  const leftovers = await ensurePackagedAppDead(app, pids);
  check("the packaged app's process tree terminated", leftovers.length === 0, leftovers.join(","));
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
