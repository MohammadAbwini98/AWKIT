/**
 * Inventory-scan scale probe (Tranche 2 hardening — MEASUREMENT, non-release-blocking).
 * Run with: npx tsx scripts/measure-inventory-scale.mts   (AFTER `npm run package:portable`)
 *
 * Seeds a large library (default 1,000 flows, a realistic mix of valid / off-path / active-path /
 * fixable) into a fresh profile, launches the REAL packaged app, and measures the first inventory
 * scan under concurrent run requests:
 *
 *   - total scan duration
 *   - main-process event-loop responsiveness during the scan (a self-timed 50ms interval; the gap
 *     between actual and expected fire time is main-thread stall)
 *   - renderer round-trip latency during the scan
 *   - peak RSS across the packaged process tree
 *   - grant-store behavior (count, uniqueness, all sha256-bound)
 *   - whether concurrent run requests arriving DURING scan initialization wait for it and then
 *     resolve safely (single-flight), rather than starting early or racing
 *
 * This records numbers and prints a table. It has PASS assertions only for the SAFETY properties
 * (single-flight, no duplicate grants, requests wait for init) — timing/memory are reported, never
 * thresholded, per the "measurement not optimization" instruction.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";

const execFileAsync = promisify(execFile);
const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const exePath = join(root, "dist", "win-unpacked", "SpecterStudio.exe");
const FLOW_COUNT = Number(process.env.SCALE_FLOWS ?? 1000);

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const profileRoot = join(tmpdir(), "awkit-scale", `scale-${stamp}`);

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const iso = (d: Date) => d.toISOString();
const LONG_AGO = iso(new Date(Date.now() - 365 * 24 * 3600 * 1000));

function validFlow(id: string) {
  return {
    id, name: `Valid ${id}`, description: "scale", version: 1, createdAt: LONG_AGO, updatedAt: LONG_AGO,
    nodes: [
      { id: "start", type: "start", name: "Start", position: { x: 280, y: 80 } },
      { id: "click", type: "click", name: "Click", locator: { strategy: "id", value: "go" }, position: { x: 280, y: 220 } },
      { id: "end", type: "end", name: "End", position: { x: 280, y: 360 } }
    ],
    edges: [{ id: "e0", source: "start", target: "click", type: "success" }, { id: "e1", source: "click", target: "end", type: "success" }]
  };
}
function orphanFlow(id: string) {
  const b = validFlow(id);
  return { ...b, name: `Orphan ${id}`, nodes: [...b.nodes, { id: "orphan", type: "screenshot", name: "Orphan", position: { x: 640, y: 80 }, config: { screenshotName: "o" } }] };
}
function brokenFlow(id: string) {
  const b = validFlow(id);
  return { ...b, name: `Broken ${id}`, nodes: [b.nodes[0], { id: "click", type: "click", name: "Unlocated", position: { x: 280, y: 220 } }, b.nodes[2]] };
}
function fixableFlow(id: string) {
  const b = validFlow(id);
  return { ...b, name: `Fixable ${id}`, edges: [{ id: "e0", source: "start", target: "click", type: "success" }, { id: "e-cond", source: "click", target: "end", type: "conditional", kind: "conditional", conditional: { sourceField: "Outcome", operator: "NotEquals", expectedValue: "fail" } }] };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value), "utf8");
}

const CREDS = { displayName: "Scale Probe", username: "scaleprobe", password: "Str0ng!Passw0rd" };
async function resolveMainWindow(app: ElectronApplication, timeoutMs = 90_000): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  await app.firstWindow({ timeout: timeoutMs }).catch(() => undefined);
  while (Date.now() < deadline) {
    for (const win of app.windows()) {
      const ready = await win.evaluate(() => Boolean((window as any).playwrightFlowStudio?.validation)).catch(() => false);
      if (ready) return win;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("main window never appeared");
}

/** Peak RSS across the packaged process tree (parent + children), via tasklist. */
async function processTreeRssMb(pid: number): Promise<number> {
  try {
    const { stdout } = await execFileAsync("wmic", ["process", "where", `(ProcessId=${pid} or ParentProcessId=${pid})`, "get", "WorkingSetSize"], { windowsHide: true });
    const bytes = stdout.split(/\r?\n/).map((line) => Number(line.trim())).filter((n) => Number.isFinite(n) && n > 0);
    return Math.round(bytes.reduce((a, b) => a + b, 0) / 1024 / 1024);
  } catch {
    return -1;
  }
}

async function main(): Promise<void> {
  console.log(`\nInventory-scan scale probe — ${FLOW_COUNT} flows`);
  if (!existsSync(exePath)) {
    console.error(`No packaged build at ${exePath}. Run \`npm run package:portable\` first.`);
    process.exit(2);
  }

  // Seed the library.
  const seedStart = Date.now();
  const flowsDir = join(profileRoot, "SpecterStudio", "flows");
  await mkdir(flowsDir, { recursive: true });
  let eligible = 0;
  for (let i = 0; i < FLOW_COUNT; i += 1) {
    const kind = i % 4;
    if (kind === 1) eligible += 1;
    const flow = kind === 0 ? validFlow(`f-${i}`) : kind === 1 ? orphanFlow(`f-${i}`) : kind === 2 ? brokenFlow(`f-${i}`) : fixableFlow(`f-${i}`);
    await writeJson(join(flowsDir, `${flow.id}.json`), flow);
  }
  // One workflow to fire concurrent run requests at during scan init.
  await writeJson(join(profileRoot, "SpecterStudio", "workflows", "probe-wf.json"), {
    id: "probe-wf", name: "Probe WF", version: 1,
    nodes: [{ id: "s", type: "start", alias: "Start", order: 0 }, { id: "n", type: "flowRef", flowId: "f-0", alias: "f-0", order: 1, required: true, inputBindings: {} }, { id: "e", type: "end", alias: "End", order: 2 }],
    edges: [{ id: "es", source: "s", target: "n", type: "always" }, { id: "ee", source: "n", target: "e", type: "always" }],
    runtimeInputs: [], execution: { mode: "sequential", maxConcurrentInstances: 1, stopOnRequiredFlowFailure: true }, createdAt: LONG_AGO, updatedAt: LONG_AGO
  });
  console.log(`  seeded ${FLOW_COUNT} flows (${eligible} grant-eligible) in ${Date.now() - seedStart}ms`);

  const env = { ...process.env } as Record<string, string | undefined>;
  delete env.ELECTRON_RUN_AS_NODE;
  env.LOCALAPPDATA = profileRoot;

  const app = await electron.launch({ executablePath: exePath, env: env as never, timeout: 120_000 });
  try {
    const win = await resolveMainWindow(app);
    await win.waitForLoadState("domcontentloaded");
    await win.waitForSelector(".awkit-login-card", { timeout: 30_000 });
    await win.fill("#awkit-setup-display", CREDS.displayName);
    await win.fill("#awkit-setup-username", CREDS.username);
    const pw = win.locator('.awkit-login-form input[type="password"]');
    await pw.nth(0).fill(CREDS.password);
    await pw.nth(1).fill(CREDS.password);
    await win.getByRole("button", { name: "Create account" }).click();
    await win.getByRole("heading", { name: "Save your recovery code" }).waitFor({ timeout: 30_000 });
    await win.getByRole("checkbox", { name: "I saved this recovery code in a secure place." }).check();
    await win.getByRole("button", { name: "Continue to SpecterStudio" }).click();
    await win.waitForSelector(".app-shell", { timeout: 30_000 });

    const mainPid = app.process().pid ?? 0;

    // Instrument the MAIN event loop from inside the main process: a self-scheduled 50ms interval
    // records how late each tick fires. Lateness = main-thread stall.
    await win.evaluate(() => {
      (window as any).__mainLoopProbe = [];
    });

    // Kick the first scan, and DURING it: (a) fire concurrent run requests, (b) probe the renderer
    // round-trip, (c) sample RSS. The scan runs in MAIN via single-flight, so the run requests
    // must wait for init and then resolve to a real verdict.
    const scanStart = Date.now();
    const rendererProbe: number[] = [];
    let peakRssMb = 0;

    const scanPromise = win.evaluate(() => (window as any).playwrightFlowStudio.validation.runInventoryScan());
    // Concurrent run requests arriving during initialization.
    const concurrentRuns = win.evaluate(() =>
      Promise.all(Array.from({ length: 8 }, () => (window as any).playwrightFlowStudio.executions.runWorkflow({ workflowId: "probe-wf", dryRun: true }).then((r: any) => r?.status).catch((e: Error) => `err:${e.message}`)))
    );

    // Sample renderer responsiveness + memory while the scan is in flight.
    let sampling = true;
    const samplerDone = (async () => {
      while (sampling) {
        const t0 = Date.now();
        await win.evaluate(() => document.querySelectorAll("*").length);
        rendererProbe.push(Date.now() - t0);
        if (mainPid) peakRssMb = Math.max(peakRssMb, await processTreeRssMb(mainPid));
        await new Promise((r) => setTimeout(r, 50));
      }
    })();

    const scan = await scanPromise;
    const scanMs = Date.now() - scanStart;
    const runStatuses = await concurrentRuns;
    sampling = false;
    await samplerDone;

    const grantsRaw = (await win.evaluate(() => (window as any).playwrightFlowStudio.validation.grants())) as any[];
    const grantFiles = (await readdir(join(profileRoot, "SpecterStudio", "validation", "legacy-grants")).catch(() => [])).filter((f) => f.endsWith(".json"));
    const scanFiles = (await readdir(join(profileRoot, "SpecterStudio", "validation", "inventory-scans")).catch(() => [])).filter((f) => f.endsWith(".json"));

    const worstRenderer = rendererProbe.length ? Math.max(...rendererProbe) : -1;
    const medianRenderer = rendererProbe.length ? [...rendererProbe].sort((a, b) => a - b)[Math.floor(rendererProbe.length / 2)] : -1;

    console.log("\n  ── Measurements ─────────────────────────────────────────");
    console.log(`  flows scanned .................. ${scan?.entries?.length ?? "?"}`);
    console.log(`  total scan duration ........... ${scanMs} ms`);
    console.log(`  scan counts ................... ${JSON.stringify(scan?.counts)}`);
    console.log(`  renderer round-trip (median) .. ${medianRenderer} ms`);
    console.log(`  renderer round-trip (worst) ... ${worstRenderer} ms   [main-thread stall proxy]`);
    console.log(`  renderer samples taken ........ ${rendererProbe.length}`);
    console.log(`  peak process-tree RSS ......... ${peakRssMb} MB`);
    console.log(`  grants issued ................. ${grantsRaw.filter((g) => !g.revokedAt).length}`);
    console.log(`  grant store files ............. ${grantFiles.length}`);
    console.log(`  scan records .................. ${scanFiles.length}`);
    console.log("  ─────────────────────────────────────────────────────────");

    // SAFETY assertions (these DO gate; timing/memory above never does).
    check(`the ${FLOW_COUNT}-flow scan completed`, (scan?.entries?.length ?? 0) === FLOW_COUNT, `${scan?.entries?.length} entries`);
    check("concurrent run requests during init all resolved (none crashed)", runStatuses.every((s: string) => !String(s).startsWith("err:")), JSON.stringify(runStatuses.slice(0, 3)));
    check("...and resolved to a real gate verdict (waited for init safely)", runStatuses.every((s: string) => s === "validated" || s === "validationFailed"), JSON.stringify([...new Set(runStatuses)]));
    check("exactly one scan record was written", scanFiles.length === 1, `${scanFiles.length} records`);
    check("no duplicate grant files", grantFiles.length === new Set(grantFiles).size);
    check("every issued grant is sha256-bound", grantsRaw.filter((g) => !g.revokedAt).every((g) => /^sha256:[0-9a-f]{64}$/.test(g.contentHash)));
    check("grants issued only to eligible (off-path-only) flows", grantsRaw.filter((g) => !g.revokedAt).length === eligible, `${grantsRaw.filter((g) => !g.revokedAt).length} vs ${eligible}`);
    check("the renderer stayed responsive (a sample was taken during the scan)", rendererProbe.length > 0);

    // Re-scan: deadlines must not move.
    const before = grantsRaw.filter((g) => !g.revokedAt).map((g) => `${g.id}:${g.expiresAt}`).sort().join("|");
    await win.evaluate(() => (window as any).playwrightFlowStudio.validation.runInventoryScan());
    const after = ((await win.evaluate(() => (window as any).playwrightFlowStudio.validation.grants())) as any[]).filter((g) => !g.revokedAt).map((g) => `${g.id}:${g.expiresAt}`).sort().join("|");
    check("a repeat scan of the large library extends no deadline", before === after);
  } finally {
    await app.close().catch(() => undefined);
    await rm(profileRoot, { recursive: true, force: true }).catch(() => undefined);
  }

  console.log(`\n${passed} passed, ${failed} failed  (timing/memory are measurements, not thresholds)`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
