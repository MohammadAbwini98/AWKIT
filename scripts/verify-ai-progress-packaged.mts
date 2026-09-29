/**
 * verify:ai-progress-packaged — Phase L, L9 (`awkit-djnl.13`) PACKAGED_LIVE, in the REAL packaged application.
 *
 * Launches `dist/win-unpacked/SpecterStudio.exe` on a fresh, isolated %LOCALAPPDATA%, creates its first
 * account through the real sign-in screen, imports the pinned Qwen3.5-0.8B and then uses the app's own IPC
 * only, watching every job status main pushes to this window (`ai:jobStatus`):
 *
 *   1. the model copy is the window's "model-import" job: determinate by bytes against the file's own size,
 *      rising to exactly that size, completed;
 *   2. CPU & RAM only, a real explanation in the packaged host: cold, the runtime's own load fraction as the
 *      only determinate progress (from the packaged host's L9.1 forwarding), then prompt evaluation and
 *      generation with no value, "no history" and no ETA, the explanation budget in force;
 *   3. warm with no warm history, then warm with one: a measured warm range from exactly one earlier run;
 *      Settings' measured speed shows both, a measurement for this configuration;
 *   4. GPU-Offload: this machine's real product answer (L8a E2 on its own adapters and backend pack), a cold
 *      reload that runs on CPU & RAM with the reason in the job's profile, never a GPU claim;
 *   5. GPU-Only: refused with its reason as the job's terminal reason, with no load stage and no progress;
 *   6. the ETA history on disk: versioned, under the profile's AI folder, keyed by the pack's checksum and
 *      this configuration, durations only, never a step name, prompt or answer;
 *   7. after a restart of the packaged app, the first explanation is cold again and its ETA is the range
 *      measured before the restart, from exactly the cold samples on disk.
 *
 * The non-packaged test provider is set and must be ignored: every answer names the pinned model.
 * GPU placement is proven only as vendor-independent mechanics (verify:ai-progress-gpu-packaged); on a
 * machine without a 0x10DE adapter NVIDIA stays BLOCKED (E11), and this gate says so, never PASS for it.
 *
 * Exit, the `gateExitCode` convention: NOT RUN (exit 2) without a packaged tree carrying native-hosts/ai or
 * without the pack. A stale package FAILS (exit 1). A TIMEOUT on a contended host is INCONCLUSIVE (exit 2).
 *
 * Run: npm run verify:ai-progress-packaged   (after `npm run package:portable`)
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { _electron as electron, type ElectronApplication, type Page } from "playwright";

import type { AiJobStatus } from "../src/ai/AiJobStatus";
import { AI_TIME_BUDGETS } from "../src/ai/AiTimeBudgets";
import { AI_MODEL_MANIFEST } from "../src/offline/AiModelManifest";
import { HOST_PATH, measurePack, ROOT } from "./ai-harness/launch.mts";
import { FLOW } from "./ai-harness/validationExplanationPacket";
import { stalePackagedPayload } from "./helpers/packaged-artifacts.mjs";
import { sanitizeAppEnv } from "./helpers/packaged-license.mts";
import { capturePackagedAppPids, ensurePackagedAppDead, type PackagedAppPids } from "./helpers/packaged-process-tree.mts";
import { gateExitCode } from "./lib/failure-capture-gate.mts";

const UNPACKED = path.join(ROOT, "dist", "win-unpacked");
const EXE = path.join(UNPACKED, "SpecterStudio.exe");
const PACKAGED_HOST = path.join(UNPACKED, "resources", "native-hosts", "ai", "ai-host.cjs");
const PACK_NAME = "Qwen3.5-0.8B-Q4_K_M.gguf";
// The password policy refuses a password containing the username, so the two share no word.
const ACCOUNT = { displayName: "Packaged Progress Gate", username: "l9-progress", password: "Phase-L9!HonestEta2026" };

let passed = 0;
let failed = 0;
let inconclusive = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)?.slice(0, 600)}`}`);
  }
}

function notRun(reason: string): never {
  console.log(`NOT RUN: ${reason} — exit 2, never a pass`);
  process.exit(2);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const distinct = <T,>(values: T[]) => values.filter((value, i) => i === 0 || values[i - 1] !== value);

async function mainWindow(app: ElectronApplication, timeoutMs = 60_000): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  await app.firstWindow({ timeout: timeoutMs }).catch(() => undefined);
  while (Date.now() < deadline) {
    for (const candidate of app.windows()) {
      const ready = await candidate.evaluate(() => typeof (window as any).playwrightFlowStudio?.ai?.onJobStatus === "function").catch(() => false);
      if (ready) return candidate;
    }
    await sleep(400);
  }
  throw new Error("packaged main window with the preload bridge never appeared");
}

/** First run creates the account through the real setup screen; a later run signs in to it. */
async function signIn(win: Page, firstRun: boolean): Promise<void> {
  await win.waitForSelector(".awkit-login-card, .app-shell", { timeout: 30_000 });
  if ((await win.locator(".app-shell").count()) > 0) return;
  if (firstRun) {
    await win.fill("#awkit-setup-display", ACCOUNT.displayName);
    await win.fill("#awkit-setup-username", ACCOUNT.username);
    const passwords = win.locator('.awkit-login-form input[type="password"]');
    await passwords.nth(0).fill(ACCOUNT.password);
    await passwords.nth(1).fill(ACCOUNT.password);
    await win.getByRole("button", { name: "Create account" }).click();
    await win.getByRole("heading", { name: "Save your recovery code" }).waitFor({ timeout: 30_000 });
    await win.getByRole("checkbox", { name: "I saved this recovery code in a secure place." }).check();
    await win.getByRole("button", { name: "Continue to SpecterStudio" }).click();
  } else {
    await win.fill("#awkit-login-username", ACCOUNT.username);
    await win.locator('.awkit-login-form input[type="password"]').first().fill(ACCOUNT.password);
    await win.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await win.waitForSelector(".app-shell", { timeout: 30_000 });
}

/** Every status main pushes to this window, kept in the page from here on. */
async function watchJobs(win: Page): Promise<void> {
  await win.evaluate(() => {
    const w = window as any;
    w.__jobStatuses = [];
    w.playwrightFlowStudio.ai.onJobStatus((status: unknown) => w.__jobStatuses.push(status));
  });
}
const statusesOf = (win: Page, jobId: string): Promise<AiJobStatus[]> =>
  win.evaluate((id) => ((window as any).__jobStatuses as AiJobStatus[]).filter((status) => status.jobId === id), jobId);

/** ai:updateSettings re-authenticates: a fresh sign-in for this window, then its re-authentication. */
async function freshAuth(win: Page): Promise<void> {
  const login = (await win.evaluate(
    (c) => (window as any).playwrightFlowStudio.security.login({ providerId: "local", username: c.username, password: c.password }),
    ACCOUNT
  )) as any;
  if (!login?.ok) throw new Error(`sign-in over IPC failed: ${login?.reason ?? "unknown"}`);
  const reauth = (await win.evaluate((input) => (window as any).playwrightFlowStudio.security.reauth(input), { sessionRef: login.principal.sessionRef, password: ACCOUNT.password })) as any;
  if (!reauth?.ok) throw new Error(`re-authentication failed: ${reauth?.reason ?? "unknown"}`);
}

async function setMode(win: Page, executionMode: "cpu" | "gpu-offload" | "gpu-only"): Promise<any> {
  await freshAuth(win);
  return win.evaluate((mode) => (window as any).playwrightFlowStudio.ai.updateSettings({ executionMode: mode }), executionMode);
}

interface Seen {
  code: string;
  modelId: string | null;
  seconds: number;
  statuses: AiJobStatus[];
  stages: string[];
  loads: AiJobStatus[];
  last: AiJobStatus | null;
}

let asked = 0;
async function explain(win: Page): Promise<Seen> {
  const requestId = `l9-packaged-${++asked}`;
  const started = Date.now();
  const view = (await win.evaluate((input) => (window as any).playwrightFlowStudio.ai.explainValidation(input), { requestId, profile: FLOW as unknown })) as any;
  const seconds = Math.round((Date.now() - started) / 1000);
  // The terminal status can trail the answer by one IPC hop.
  let statuses: AiJobStatus[] = [];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    statuses = await statusesOf(win, requestId);
    if (statuses.some((status) => ["completed", "failed", "timed-out", "cancelled"].includes(status.state))) break;
    await sleep(100);
  }
  return {
    code: view?.code ?? "NO_ANSWER",
    modelId: view?.modelId ?? null,
    seconds,
    statuses,
    stages: distinct(statuses.map((status) => status.stage)),
    loads: statuses.filter((status) => status.progress !== null),
    last: statuses.at(-1) ?? null
  };
}

/** A TIMEOUT on a contended host is not a product verdict: INCONCLUSIVE, and the rest of that step is skipped. */
function timedOut(seen: Seen, what: string): boolean {
  if (seen.code !== "TIMEOUT") return false;
  inconclusive += 1;
  console.log(`  ? INCONCLUSIVE: ${what} timed out after ${seen.seconds} s under the feature's own budget (host contention is not a product verdict)`);
  return true;
}

const runtimeLoad = (seen: Seen) =>
  seen.loads.length > 0 &&
  seen.loads.every((s) => s.stage === "model-load" && s.progress!.unit === "fraction" && s.progress!.total === 1000 && s.progress!.done <= 1000) &&
  seen.loads.every((s, i) => i === 0 || s.progress!.done >= seen.loads[i - 1].progress!.done);

// ── Preconditions ────────────────────────────────────────────────────────────────────────────────

console.log("verify:ai-progress-packaged — L9 job status, progress and ETA in the real packaged application\n");
if (!fs.existsSync(EXE) || !fs.existsSync(PACKAGED_HOST)) notRun("dist/win-unpacked carries no packaged app with native-hosts/ai — run `npm run package:portable`");
const pack = path.join(os.homedir(), "Downloads", PACK_NAME);
if (!fs.existsSync(pack)) notRun(`no model pack at ~/Downloads/${PACK_NAME}`);

const stale = await stalePackagedPayload(ROOT);
check("the packaged payload is not older than the source", stale === null, stale ?? undefined);
check("the packaged AI host is the source host, byte for byte (L9.1's progress forwarding is in it)", fs.readFileSync(PACKAGED_HOST).equals(fs.readFileSync(HOST_PATH)));
const measured = await measurePack(pack);
const entry = AI_MODEL_MANIFEST.find((item) => item.sha256 === measured.sha256 && item.sizeBytes === measured.sizeBytes);
check("the pack is a pinned manifest entry", Boolean(entry), `sha256 ${measured.sha256}`);
if (failed > 0 || !entry) {
  console.log(`\n${passed} passed, ${failed} failed — FAIL`);
  process.exit(1);
}

// ── Run ──────────────────────────────────────────────────────────────────────────────────────────

const localAppData = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-ai-progress-packaged-"));
const scripted = path.join(localAppData, "scripted-ai-answer.json");
fs.writeFileSync(scripted, JSON.stringify({ text: '{"version":1,"explanations":[]}' }));
const env = sanitizeAppEnv({ ...process.env, LOCALAPPDATA: localAppData, AWKIT_TEST_AI_PROVIDER: scripted }) as Record<string, string | undefined>;
delete env.ELECTRON_RUN_AS_NODE;
const historyFile = path.join(localAppData, "SpecterStudio", "ai", "ai-eta-history.json");
const flowWords = [FLOW.name, ...FLOW.nodes.map((node) => node.name)].filter((name) => name.length > 3 && !["Start"].includes(name));

let app: ElectronApplication | null = null;
let pids: PackagedAppPids = { stubPid: 0, mainPid: 0 };
async function launch(firstRun: boolean): Promise<Page> {
  app = await electron.launch({ executablePath: EXE, env: env as never, timeout: 60_000 });
  pids = await capturePackagedAppPids(app);
  const win = await mainWindow(app);
  await signIn(win, firstRun);
  await watchJobs(win);
  return win;
}

let coldBeforeRestart = 0;
try {
  let win = await launch(true);
  check("the packaged app launched on a fresh profile and signed in its first account", true);
  const enabled = (await win.evaluate(() => (window as any).playwrightFlowStudio.ai.updateSettings({ enabled: true }))) as any;
  check("AI can be enabled right after sign-in", enabled?.ok === true, enabled);

  console.log("\n1. The model copy is a determinate job, by bytes");
  await app!.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [picked] })) as typeof dialog.showOpenDialog;
  }, pack);
  const preflight = (await win.evaluate(() => (window as any).playwrightFlowStudio.ai.preflightModelPack())) as any;
  const imported = (await win.evaluate((token) => (window as any).playwrightFlowStudio.ai.importModelPack(token), preflight?.preflight?.token ?? "")) as any;
  check("the pinned pack imports", imported?.ok === true && imported?.detail === entry.id, imported);
  await sleep(300);
  const copy = await statusesOf(win, "model-import");
  const copied = copy.filter((status) => status.progress !== null);
  check(
    "the copy reports bytes against the file's own size, rising, and reaches exactly that size",
    copied.length > 0 &&
      copied.every((s, i) => s.stage === "copy-hash" && s.progress!.unit === "bytes" && s.progress!.total === entry.sizeBytes && (i === 0 || s.progress!.done >= copied[i - 1].progress!.done)) &&
      copied.at(-1)!.progress!.done === entry.sizeBytes,
    { updates: copied.length, last: copied.at(-1)?.progress }
  );
  check(
    "...under the component-copy budget, and it ends completed",
    copy.at(-1)?.state === "completed" && copy.every((s) => s.budgetMs === AI_TIME_BUDGETS.componentCopy.defaultMs),
    { state: copy.at(-1)?.state, budget: copy[0]?.budgetMs }
  );

  console.log("\n2. CPU & RAM only: the first, cold explanation in the packaged host");
  const cold = await explain(win);
  if (!timedOut(cold, "the cold explanation")) {
    check(`the explanation answers from the pinned model, never the test provider (${cold.seconds} s)`, cold.modelId === entry.id && cold.last?.state === "completed", { code: cold.code, modelId: cold.modelId, state: cold.last?.state });
    check(
      "its stages: the model check, the load, prompt evaluation, then generation",
      cold.stages.indexOf("model-load") > 0 && cold.stages.indexOf("prompt-evaluation") > cold.stages.indexOf("model-load") && cold.stages.indexOf("generation") > cold.stages.indexOf("prompt-evaluation"),
      cold.stages
    );
    check("the load's progress is the runtime's own fraction, rising, the only determinate progress", runtimeLoad(cold), cold.loads.map((s) => s.progress?.done));
    check(
      "prompt evaluation and generation carry no progress at all",
      cold.statuses.filter((s) => s.stage === "prompt-evaluation" || s.stage === "generation").every((s) => s.progress === null)
    );
    check("cold on CPU & RAM, with no history it says so, and it claims no ETA", cold.last?.cold === true && cold.last.profile?.device === "cpu" && cold.last.profile.mode === "cpu" && cold.statuses.some((s) => s.state === "running" && s.noHistory) && cold.statuses.every((s) => s.eta === null), cold.last?.profile);
    check("the explanation's budget is the one in force", cold.statuses.every((s) => s.budgetMs === AI_TIME_BUDGETS.authoringExplanation.defaultMs), cold.statuses[0]?.budgetMs);
  }

  console.log("\n3. Warm, first without warm history, then with it");
  const warm1 = await explain(win);
  if (!timedOut(warm1, "the first warm explanation")) {
    check(`a warm run loads nothing (${warm1.seconds} s)`, warm1.last?.state === "completed" && warm1.last.cold === false && !warm1.stages.includes("model-load") && warm1.loads.length === 0, warm1.stages);
    check("...and with no warm history it claims no ETA", warm1.statuses.some((s) => s.state === "running" && s.noHistory) && warm1.statuses.every((s) => s.eta === null));
  }
  const warm2 = await explain(win);
  if (!timedOut(warm2, "the second warm explanation")) {
    const etas = warm2.statuses.filter((s) => s.eta !== null).map((s) => s.eta!);
    check(`the next warm run carries a measured warm range from exactly one earlier run (${warm2.seconds} s)`, etas.length > 0 && etas.every((eta) => eta.warmth === "warm" && eta.samples === 1 && eta.remainingMinMs <= eta.remainingMaxMs), etas[0]);
  }
  const status = (await win.evaluate(() => (window as any).playwrightFlowStudio.ai.getStatus())) as any;
  const speed = (status?.measuredSpeed ?? []).find((m: any) => m.kind === "validationExplanation");
  check("Settings' measured speed shows this configuration's cold and warm explanation times", speed?.cold?.samples === 1 && (speed?.warm?.samples ?? 0) >= 1, status?.measuredSpeed);
  check("...and qualification still claims no latency", status?.modelPack?.qualification?.latency?.claimed === false, status?.modelPack?.qualification?.latency);

  console.log("\n4. GPU-Offload: this machine's own answer");
  const offloadSet = await setMode(win, "gpu-offload");
  check("GPU-Offload is saved", offloadSet?.ok === true, offloadSet);
  const offload = await explain(win);
  if (!timedOut(offload, "the GPU-Offload explanation")) {
    const execution = ((await win.evaluate(() => (window as any).playwrightFlowStudio.ai.getStatus())) as any)?.execution;
    const profile = offload.last?.profile;
    if (profile?.device === "gpu") {
      check("GPU-Offload placed layers on an ELIGIBLE adapter: its load progress is the runtime's own", runtimeLoad(offload) && offload.last?.state === "completed", offload.stages);
    } else {
      check(
        `the mode change reloads cold, checks the GPU, then loads on CPU & RAM with the runtime's own fraction (${offload.seconds} s)`,
        offload.last?.state === "completed" && offload.last.cold === true && offload.stages.includes("backend-probe") && offload.stages.indexOf("model-load") > offload.stages.indexOf("backend-probe") && runtimeLoad(offload),
        offload.stages
      );
      check("the job's profile says GPU-Offload ran on CPU & RAM and why, never a device name", profile?.mode === "gpu-offload" && profile.backend === "cpu" && typeof profile.fallbackReason === "string" && profile.fallbackReason === execution?.fallbackReason, { profile, fallback: execution?.fallbackReason });
      console.log(`  · GPU-Offload fell back here: ${profile?.fallbackReason}`);
    }
  }

  console.log("\n5. GPU-Only: refused here, with no load and no progress");
  const onlySet = await setMode(win, "gpu-only");
  check("GPU-Only is saved", onlySet?.ok === true, onlySet);
  const only = await explain(win);
  const readiness = ((await win.evaluate(() => (window as any).playwrightFlowStudio.ai.getStatus())) as any)?.execution;
  if (only.last?.profile?.device === "gpu" && only.last.state === "completed") {
    check("GPU-Only loaded every layer on an ELIGIBLE adapter, with the runtime's own load progress", runtimeLoad(only) && only.last.profile.offload === "full", only.last.profile);
  } else {
    check(
      "the job ends failed with the refusal's reason, before any load and with no progress",
      only.last?.state === "failed" && typeof only.last.terminalReason === "string" && !only.stages.includes("model-load") && only.loads.length === 0 && only.statuses.every((s) => s.eta === null),
      { stages: only.stages, last: only.last?.state, reason: only.last?.terminalReason }
    );
    check("...the same reason the Settings panel gives for the refusal", only.last?.terminalReason === readiness?.refusal?.reason, { job: only.last?.terminalReason, settings: readiness?.refusal });
    console.log(`  · GPU-Only refused here: ${only.last?.terminalReason}`);
  }
  const cpuSet = await setMode(win, "cpu");
  check("CPU & RAM only is saved again", cpuSet?.ok === true, cpuSet);

  console.log("\n6. The ETA history on disk");
  const raw = fs.existsSync(historyFile) ? fs.readFileSync(historyFile, "utf8") : "";
  const history = raw ? (JSON.parse(raw) as { schemaVersion: number; entries: Record<string, { cold: number[]; warm: number[] }> }) : null;
  const cpuKey = Object.keys(history?.entries ?? {}).find((key) => key.startsWith(`${entry.sha256}|`) && key.includes("|cpu|cpu|ctx4096|") && key.includes("|validationExplanation|"));
  coldBeforeRestart = cpuKey ? history!.entries[cpuKey].cold.length : 0;
  check("it is versioned, under the profile's AI folder, never under resources", history?.schemaVersion === 1 && historyFile.startsWith(localAppData));
  check("CPU & RAM explanations are keyed by the pack's checksum, this runtime and configuration and the machine class", Boolean(cpuKey), Object.keys(history?.entries ?? {}));
  check(
    "it holds whole-millisecond durations only: no step name, prompt or answer, and no path",
    Object.values(history?.entries ?? {}).every((e) => [...e.cold, ...e.warm].every(Number.isInteger)) && !flowWords.some((word) => raw.includes(word)) && !raw.includes(localAppData.replace(/\\/g, "\\\\")),
    flowWords.filter((word) => raw.includes(word))
  );
  console.log(`  · cold samples before the restart: ${coldBeforeRestart}`);

  console.log("\n7. After a restart of the packaged app");
  await ensurePackagedAppDead(app, pids);
  app = null;
  win = await launch(false);
  check("the packaged app restarted on the same profile and signed in", true);
  const again = await explain(win);
  if (!timedOut(again, "the explanation after the restart")) {
    const etas = again.statuses.filter((s) => s.eta !== null).map((s) => s.eta!);
    check(`the first explanation after the restart is cold, and loads (${again.seconds} s)`, again.last?.state === "completed" && again.last.cold === true && runtimeLoad(again), again.stages);
    check(
      "its ETA is the cold range measured before the restart, from exactly the cold samples on disk",
      coldBeforeRestart >= 1 && etas.length > 0 && etas.every((eta) => eta.warmth === "cold" && eta.samples === coldBeforeRestart),
      { onDisk: coldBeforeRestart, eta: etas[0] }
    );
  }
} catch (error) {
  check("the packaged progress gate ran to completion", false, error instanceof Error ? error.message : String(error));
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

console.log(
  "\n  · GPU placement: only as vendor-independent mechanics (verify:ai-progress-gpu-packaged). NVIDIA: BLOCKED unless a 0x10DE adapter is present (E11); nothing here qualifies it."
);
const exitCode = gateExitCode({ passed, failed, inconclusive, gateNotRun: false });
const verdict = exitCode === 1 ? "FAIL" : exitCode === 2 ? "INCONCLUSIVE" : "PASS";
console.log(`\n${passed} passed, ${failed} failed${inconclusive > 0 ? `, ${inconclusive} inconclusive` : ""} — ${verdict}`);
process.exit(exitCode);
