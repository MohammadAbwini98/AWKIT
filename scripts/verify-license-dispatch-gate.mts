/**
 * License dispatch synchronization verifier (awkit-f3l).
 *
 * Drives the real ExecutionEngine queue without Chromium by pinning maxConcurrentInstances to zero,
 * then proves the injected synchronous gate reaches queued work and fails closed on faults.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { ExecutionEngine } from "@src/runner/ExecutionEngine";
import type { ConcurrentRunProfile } from "@src/instances/ConcurrentRunProfile";
import type { ScenarioProfile } from "@src/profiles/ScenarioProfile";
import type { InstanceStatus } from "@src/instances/InstanceStatus";

process.env.AWKIT_DURABLE_STORE = "0";
process.env.AWKIT_CDP_OBSERVATION = "0";
process.env.PRODUCTION_OFFLINE = "false";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
let failed = 0;

function check(label: string, condition: unknown, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

class InstrumentedEngine extends ExecutionEngine {
  readonly cancellationReasons: string[] = [];
  readonly cancelledIds: string[] = [];

  override cancelPendingInstances(reason: string): string[] {
    this.cancellationReasons.push(reason);
    const ids = super.cancelPendingInstances(reason);
    this.cancelledIds.push(...ids);
    return ids;
  }
}

const runProfile = (id: string): ConcurrentRunProfile => ({
  id,
  scenarioId: "license-gate-scenario",
  runMode: "fixedConcurrent",
  maxConcurrentInstances: 0,
  browserWindowMode: "headless",
  instanceTemplate: { browser: "chromium", headless: true, isolationMode: "browserContext" },
  resourceControls: { maxBrowserContextsPerProcess: 1, delayBetweenInstanceStartsMs: 0 },
  failurePolicy: {
    stopAllOnCriticalFailure: false,
    continueOtherInstancesOnFailure: true,
    retryFailedInstance: false,
    retryCount: 0
  }
});

const scenario: ScenarioProfile = {
  id: "license-gate-scenario",
  name: "License gate verifier",
  executionMode: "sequential",
  maxParallelFlows: 1,
  flows: [],
  links: [],
  failurePolicy: {
    stopOnRequiredFlowFailure: true,
    continueOnOptionalFlowFailure: false,
    takeScreenshotOnFailure: false
  }
};

function statusHistory(engine: ExecutionEngine, history: Map<string, InstanceStatus[]>): void {
  for (const instance of engine.getInstances()) {
    const statuses = history.get(instance.instanceId) ?? [];
    if (statuses.at(-1) !== instance.status) statuses.push(instance.status);
    history.set(instance.instanceId, statuses);
  }
}

async function waitFor(
  predicate: () => boolean,
  history: Map<string, InstanceStatus[]>,
  engines: ExecutionEngine[],
  timeoutMs = 4_000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    engines.forEach((engine) => statusHistory(engine, history));
    if (predicate()) return true;
    await sleep(50);
  }
  engines.forEach((engine) => statusHistory(engine, history));
  return predicate();
}

function walkScripts(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkScripts(full));
    else if (/\.(?:mjs|mts|cjs|ts|js)$/.test(entry.name)) files.push(full);
  }
  return files;
}

console.log("License dispatch gate verifier\n");

const tempRoot = mkdtempSync(join(tmpdir(), "awkit-license-dispatch-"));
const dirs = {
  root: tempRoot,
  downloads: join(tempRoot, "downloads"),
  screenshots: join(tempRoot, "screenshots"),
  logs: join(tempRoot, "logs"),
  reports: join(tempRoot, "reports")
};

try {
  console.log("Real queue synchronization:");
  const engine = new InstrumentedEngine();
  let verdict = { admit: true, reason: "LICENSE_GATE_ALLOWED" };
  engine.setDispatchGate(() => verdict);
  const history = new Map<string, InstanceStatus[]>();

  await engine.startRun("gate-run-a", runProfile("gate-run-a"), Array.from({ length: 6 }), dirs, {}, scenario, []);
  statusHistory(engine, history);
  const firstRun = engine.getInstances().filter((instance) => instance.executionId === "gate-run-a");
  check("six instances are created", firstRun.length === 6, `${firstRun.length} created`);
  check("all six are queued at submit", firstRun.every((instance) => instance.status === "queued"));
  await sleep(1_100);
  statusHistory(engine, history);
  check("an admitting gate leaves all six queued across two ticks", firstRun.every((instance) => engine.pool.get(instance.instanceId)?.status === "queued"));

  verdict = { admit: false, reason: "LICENSE_INTEGRITY_FAILURE" };
  const cancelled = await waitFor(
    () => firstRun.every((instance) => engine.pool.get(instance.instanceId)?.status === "cancelled"),
    history,
    [engine]
  );
  check("blocking the live gate cancels all six queued instances", cancelled);
  check("the instrument observed all six cancellations", engine.cancelledIds.length === 6, `${engine.cancelledIds.length} cancelled`);
  check("every instance history proves queued then cancelled", firstRun.every((instance) => (history.get(instance.instanceId)?.length ?? 0) >= 2));
  check(
    "no blocked instance reached starting or running",
    firstRun.every((instance) => !(history.get(instance.instanceId) ?? []).some((status) => status === "starting" || status === "running"))
  );
  check(
    "the gate reason reaches the cancellation boundary",
    engine.cancellationReasons.some((reason) => reason === "license integrity failure: LICENSE_INTEGRITY_FAILURE")
  );

  const cancelledBeforeHold = engine.cancelledIds.length;
  await sleep(2_500);
  check("continued blocking creates no duplicate cancellations", engine.cancelledIds.length === cancelledBeforeHold);

  let repeatError = "";
  try {
    engine.repeatInstance(firstRun[0].instanceId);
  } catch (error) {
    repeatError = error instanceof Error ? error.message : String(error);
  }
  check("repeatInstance is refused while the dispatch gate blocks", repeatError.includes("license integrity failure"), repeatError);

  verdict = { admit: true, reason: "LICENSE_GATE_ALLOWED" };
  await engine.startRun("gate-run-b", runProfile("gate-run-b"), Array.from({ length: 4 }), dirs, {}, scenario, []);
  const secondRun = engine.getInstances().filter((instance) => instance.executionId === "gate-run-b");
  check("recovery creates four new instances", secondRun.length === 4, `${secondRun.length} created`);
  await sleep(1_100);
  check("recovery permits new queued work to remain unswept", secondRun.every((instance) => engine.pool.get(instance.instanceId)?.status === "queued"));

  console.log("\nRegistration and fault behavior:");
  const registration = new ExecutionEngine();
  check("a bare engine reports no registered gate", registration.dispatchGateRegistered === false);
  registration.setDispatchGate(null as never);
  check("a null degradation does not count as registration", registration.dispatchGateRegistered === false);

  const faultEngine = new InstrumentedEngine();
  faultEngine.setDispatchGate(() => {
    throw new Error("synthetic gate fault");
  });
  await faultEngine.startRun("gate-run-fault", runProfile("gate-run-fault"), [null], dirs, {}, scenario, []);
  const faultInstance = faultEngine.getInstances().find((instance) => instance.executionId === "gate-run-fault");
  const faultCancelled = await waitFor(
    () => Boolean(faultInstance && faultEngine.pool.get(faultInstance.instanceId)?.status === "cancelled"),
    history,
    [faultEngine]
  );
  check("a throwing gate fails closed and cancels queued work", faultCancelled);
  check("a gate fault never reaches starting or running", !(history.get(faultInstance?.instanceId ?? "") ?? []).some((s) => s === "starting" || s === "running"));
  check("the fault verdict reason surfaces", faultEngine.cancellationReasons.includes("license integrity failure: DISPATCH_GATE_FAULT"));

  engine.cancelPendingInstances("verifier cleanup");
  faultEngine.cancelPendingInstances("verifier cleanup");
  await sleep(700);

  console.log("\nProduction wiring and shell boundary:");
  const executionIpc = readFileSync(join(root, "app/main/ipc/execution.ipc.ts"), "utf8");
  const licensingIpc = readFileSync(join(root, "app/main/ipc/licensing.ipc.ts"), "utf8");
  const enforcementService = readFileSync(join(root, "app/main/licensing/licenseEnforcementService.ts"), "utf8");
  const mainSource = readFileSync(join(root, "app/main/main.ts"), "utf8");
  const engineSource = readFileSync(join(root, "src/runner/ExecutionEngine.ts"), "utf8");
  const repeatHandlerSource = executionIpc.slice(
    executionIpc.indexOf('ipcMain.handle("execution:repeatInstance"'),
    executionIpc.indexOf('ipcMain.handle("execution:runtimeStatus"')
  );
  const appSources = walkScripts(join(root, "app"));
  const setterOccurrences = appSources.reduce(
    (count, file) => count + (readFileSync(file, "utf8").match(/setDispatchGate\s*\(/g)?.length ?? 0),
    0
  );
  check("execution IPC registers the named license gate", executionIpc.includes("executionEngine.setDispatchGate(licenseDispatchGate)"));
  check(
    "repeat IPC evaluates the full new-run license policy",
    repeatHandlerSource.includes('applyRunGateEnforcement("run-request")')
  );
  check("app code contains exactly one dispatch-gate setter call", setterOccurrences === 1, `${setterOccurrences} calls`);
  check("no app code sets a null or undefined dispatch gate", !appSources.some((file) => /setDispatchGate\s*\(\s*(?:null|undefined)/.test(readFileSync(file, "utf8"))));
  check("bootstrap refuses a missing dispatch gate", mainSource.includes("dispatchGateRegistered") && /app\.exit\(1\)/.test(mainSource));
  check("the enforcement service owns the pending sweep", enforcementService.includes("executionEngine.cancelPendingInstances("));
  check("license IPC applies enforcement during revalidation", licensingIpc.includes('applyRunGateEnforcement("revalidate-ipc")'));
  check("the obsolete duplicate sweep helper is gone", !executionIpc.includes("cancelPendingWorkForLicenseIntegrity"));
  check("the watcher owns focus and interval triggers", enforcementService.includes("browser-window-focus") && enforcementService.includes("LICENSE_REVALIDATE_INTERVAL_MS"));
  check("the final dispatch check releases browser slots", engineSource.includes("this.browserPool.releaseSlot(slot)"));
  check("the final dispatch check releases resource claims", engineSource.includes("globalResourceLocks.releaseMany(claimTokens)"));
  check("repeatInstance consults the dispatch gate", /repeatInstance[\s\S]+evaluateDispatchGate\(\)/.test(engineSource));
  check(
    "the runner does not import main-process licensing",
    !/^import .*app\/main\/licensing/m.test(engineSource)
  );

  const scriptFiles = walkScripts(join(root, "scripts"));
  // Liveness before the verdict: `shellTrue.length === 0` is vacuously true over an empty scan, so a
  // broken walk would report "no shell:true anywhere" while reading nothing. Floor measured at 224
  // files on 2026-08-02 — raise it if the tree grows, never lower it to match a failure.
  check(
    `the shell scan has script files to read (found ${scriptFiles.length})`,
    scriptFiles.length >= 150,
    `${scriptFiles.length} files under scripts/`
  );
  const shellTrue = scriptFiles
    .filter((file) => {
      const rel = relative(root, file).split(sep).join("/");
      return rel !== "scripts/dev.mjs" && rel !== "scripts/verify-license-dispatch-gate.mts";
    })
    .filter((file) => /shell\s*:\s*true/.test(readFileSync(file, "utf8")));
  check("scripts contain no shell:true outside the documented dev shim", shellTrue.length === 0, shellTrue.map((file) => relative(root, file)).join(", "));
  const packagedHelper = readFileSync(join(root, "scripts/helpers/packaged-license.mts"), "utf8");
  check("the packaged issuer uses process.execPath", packagedHelper.includes("process.execPath"));
  check("the packaged issuer invokes tsx with an argv array", packagedHelper.includes('"node_modules", "tsx", "dist", "cli.mjs"'));
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log(`\nlicense dispatch gate: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
