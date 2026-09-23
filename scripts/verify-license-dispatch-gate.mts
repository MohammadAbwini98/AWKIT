/**
 * License dispatch synchronization verifier (awkit-f3l).
 *
 * Drives the real ExecutionEngine queue without Chromium by pinning maxConcurrentInstances to zero,
 * then proves the injected synchronous gate reaches queued work and fails closed on faults.
 *
 * The trusted-transition section runs one instance for real (only the Chromium work behind
 * runInstanceInner is held) and moves a signed license through the production store, validator,
 * policy and latch, so the sweep is driven by a license the validator actually rejected.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { ExecutionEngine } from "@src/runner/ExecutionEngine";
import { globalResourceLocks, type LeaseToken } from "@src/runner/concurrency/ResourceLockManager";
import type { DurableCancellationRecord } from "@src/runner/store/RuntimeStoreSchema";
import type { ConcurrentRunProfile } from "@src/instances/ConcurrentRunProfile";
import type { InstanceRuntimeState } from "@src/instances/InstanceRuntimeState";
import type { ScenarioProfile } from "@src/profiles/ScenarioProfile";
import type { InstanceStatus } from "@src/instances/InstanceStatus";
import { LICENSE_SCHEMA_VERSION, LicenseStatus, type LicenseDocument } from "@src/licensing/LicenseTypes";
import type { LicensePayload } from "@src/licensing/LicenseCanonical";
import { signLicensePayload } from "@src/licensing/crypto/LicenseSignature";
import type { TrustedKey } from "@src/licensing/crypto/TrustedKeys";
import { computeMachineFingerprint } from "@src/licensing/MachineFingerprint";
import { LicenseService } from "@src/licensing/LicenseService";
import { LicenseStore, buildEnvelope } from "@src/licensing/store/LicenseStore";
import { applyLicenseRunGatePolicy, DEFAULT_REQUIRED_ENTITLEMENT } from "@src/licensing/RunGatePolicy";
import {
  CLEARED_ENFORCEMENT_STATE,
  nextEnforcementState,
  type EnforcementLatchState,
  type EnforcementTrigger
} from "@src/licensing/RunGateEnforcement";

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

/** Private engine members the trusted-transition section holds or observes. */
interface EngineInternals {
  runInstanceInner: (
    instance: InstanceRuntimeState,
    flows: unknown,
    scenario: unknown,
    workflowDataSource: unknown,
    dataSources: unknown,
    dirs: unknown,
    slot?: unknown,
    claimTokens?: LeaseToken[]
  ) => Promise<void>;
  browserPool: { releaseSlot(slot: unknown): void };
  backpressure: { admit(...args: unknown[]): { allow: boolean; reason?: string } };
  durableStore: { recordCancellation(record: DurableCancellationRecord): void };
}

const runProfile = (id: string, maxConcurrentInstances = 0): ConcurrentRunProfile => ({
  id,
  scenarioId: "license-gate-scenario",
  runMode: "fixedConcurrent",
  maxConcurrentInstances,
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

  console.log("\nTrusted license transition with running and queued work:");
  const DAY = 24 * 3_600_000;
  const iso = (ms: number): string => new Date(ms).toISOString();
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const trustedKeys: TrustedKey[] = [
    { keyId: "gate-key", algorithm: "Ed25519", publicKeySpkiB64: publicKey.export({ type: "spki", format: "der" }).toString("base64") }
  ];
  const fingerprint = () =>
    computeMachineFingerprint([
      { category: "machineGuid", value: "gate-machine", strong: true },
      { category: "platform", value: "gate-platform", strong: false },
      { category: "cpuModel", value: "gate-cpu", strong: true },
      { category: "cpuCount", value: "4", strong: false }
    ]);
  const issuedAt = Date.now();
  const payload: LicensePayload = {
    schemaVersion: LICENSE_SCHEMA_VERSION,
    licenseId: "gate-license",
    serialNumber: "SPEC-GATE-0000-0001",
    product: "SpecterStudio",
    machineFingerprintHash: fingerprint().fingerprintHash,
    issuedAtUtc: iso(issuedAt - DAY),
    validFromUtc: iso(issuedAt - DAY),
    expiresAtUtc: iso(issuedAt + 30 * DAY),
    licenseType: "standard",
    entitlements: [DEFAULT_REQUIRED_ENTITLEMENT],
    issuer: "SpecterStudio Licensing",
    signingKeyId: "gate-key",
    signatureAlgorithm: "Ed25519"
  };
  const license: LicenseDocument = {
    ...payload,
    signature: signLicensePayload(payload, privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"))
  };
  const licenseStore = new LicenseStore(join(tempRoot, "licensing"), null);
  const licenseService = new LicenseService({
    store: licenseStore,
    product: "SpecterStudio",
    appVersion: "0.0.0-verify",
    fingerprintProvider: fingerprint,
    trustedKeys
  });

  const trusted = new InstrumentedEngine();
  const internals = trusted as unknown as EngineInternals;
  // Host CPU/memory throttling is not under test; admitting keeps the running instance deterministic.
  internals.backpressure.admit = () => ({ allow: true });
  const persisted: DurableCancellationRecord[] = [];
  const recordCancellation = internals.durableStore.recordCancellation.bind(internals.durableStore);
  internals.durableStore.recordCancellation = (record) => {
    persisted.push(record);
    recordCancellation(record);
  };
  const ran: string[] = [];
  let releaseHeld = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    releaseHeld = resolve;
  });
  internals.runInstanceInner = async (instance, _flows, _scenario, _wds, _ds, _dirs, slot, claimTokens) => {
    ran.push(instance.instanceId);
    await held;
    if (slot) internals.browserPool.releaseSlot(slot);
    if (claimTokens?.length) globalResourceLocks.releaseMany(claimTokens);
    trusted.pool.update(instance.instanceId, { status: "completed" });
  };

  // The same composition as applyRunGateEnforcement and licenseDispatchGate, over an injected trusted
  // key and a temporary store instead of the production key list and %LOCALAPPDATA%.
  let latch: EnforcementLatchState = CLEARED_ENFORCEMENT_STATE;
  const audit: string[] = [];
  const enforce = (trigger: EnforcementTrigger): string[] => {
    const status = licenseService.getStatus();
    const decision = applyLicenseRunGatePolicy(
      {
        status: status.status,
        operable: status.operable,
        entitlements: status.entitlements,
        requiredEntitlement: DEFAULT_REQUIRED_ENTITLEMENT
      },
      true
    );
    const transition = nextEnforcementState(
      latch,
      { activeRunDisposition: decision.activeRunDisposition, reason: decision.reason, status: status.status },
      Date.now()
    );
    latch = transition.next;
    if (transition.shouldAudit && transition.auditEvent) audit.push(`${transition.auditEvent}:${trigger}`);
    return transition.shouldCancelPending
      ? trusted.cancelPendingInstances(`license integrity failure: ${decision.reason}`)
      : [];
  };
  trusted.setDispatchGate(() => ({ admit: !latch.blocking, reason: latch.reason ?? "LICENSE_GATE_ALLOWED" }));
  const statusOf = (id: string): InstanceStatus | undefined => trusted.pool.get(id)?.status;
  const everRan = (id: string): boolean =>
    (history.get(id) ?? []).some((status) => status === "starting" || status === "running");

  check("a trusted signed license imports", licenseService.importLicense(license).ok === true);
  check("the trusted license reads VALID", licenseService.getStatus().status === LicenseStatus.VALID, licenseService.getStatus().status);
  check("startup enforcement admits and cancels nothing", enforce("startup").length === 0 && !latch.blocking);

  await trusted.startRun("trusted-run-a", runProfile("trusted-run-a", 1), Array.from({ length: 3 }), dirs, {}, scenario, []);
  const runA = trusted.getInstances().filter((instance) => instance.executionId === "trusted-run-a");
  const oneRunning = await waitFor(() => ran.length === 1 && statusOf(ran[0]) === "running", history, [trusted]);
  check("one of three instances starts under the VALID license", oneRunning && runA.length === 3, `${ran.length} started of ${runA.length}`);
  const runningId = ran[0] ?? "";
  const waitingIds = runA.map((instance) => instance.instanceId).filter((id) => id !== runningId);
  check(
    "the other two are waiting to start",
    waitingIds.length === 2 && waitingIds.every((id) => statusOf(id) === "queued" || statusOf(id) === "pending"),
    waitingIds.map(statusOf).join(",")
  );

  // The transition: the stored license is replaced on disk by the same document modified after signing.
  const forged: LicenseDocument = { ...license, expiresAtUtc: iso(issuedAt + 999 * DAY) };
  licenseStore.saveLocal(
    buildEnvelope(forged, { importedAtUtc: iso(issuedAt), clockHighWaterUtc: iso(issuedAt), locallyRevoked: false })
  );
  check(
    "the modified license reads INVALID_SIGNATURE from the store",
    licenseService.getStatus().status === LicenseStatus.INVALID_SIGNATURE,
    licenseService.getStatus().status
  );
  const swept = enforce("interval");
  check(
    "the revalidation that sees it cancels exactly the two waiting instances",
    swept.length === 2 && waitingIds.every((id) => swept.includes(id)),
    swept.join(",")
  );
  check("the latch blocks with the integrity reason", latch.blocking && latch.reason === "LICENSE_INTEGRITY_FAILURE", String(latch.reason));
  check("the engagement is audited once", audit.length === 1 && audit[0] === "LICENSE_ENFORCEMENT_ENGAGED:interval", audit.join(","));

  await sleep(1_200);
  statusHistory(trusted, history);
  check("the running instance keeps running (allow-to-finish)", statusOf(runningId) === "running", statusOf(runningId));
  check("the running instance was never cancelled", !(history.get(runningId) ?? []).includes("cancelled"));
  check("no swept instance ever started", waitingIds.every((id) => statusOf(id) === "cancelled" && !everRan(id)) && ran.length === 1);

  const persistedA = persisted.filter((record) => record.executionId === "trusted-run-a");
  check(
    "exactly the two swept instances are persisted as cancelled",
    persistedA.length === 2 && waitingIds.every((id) => persistedA.some((record) => record.instanceId === id)),
    `${persistedA.length} records`
  );
  check(
    "the persisted reason names the license failure",
    persistedA.length > 0 && persistedA.every((record) => record.reason === "license integrity failure: LICENSE_INTEGRITY_FAILURE")
  );
  check(
    "the persisted source is the license gate, not the UI",
    persistedA.length > 0 && persistedA.every((record) => record.source === "license-gate"),
    persistedA.map((record) => record.source).join(",")
  );
  check(
    "a swept never-started instance is persisted as a completed cancellation",
    persistedA.length > 0 && persistedA.every((record) => typeof record.completedAt === "string"),
    persistedA.map((record) => String(record.completedAt)).join(",")
  );
  check("the running instance has no cancellation record", !persisted.some((record) => record.instanceId === runningId));

  // Work that reaches the queue after the transition (the IPC run gate refuses it; this is the race).
  await trusted.startRun("trusted-run-race", runProfile("trusted-run-race", 1), Array.from({ length: 2 }), dirs, {}, scenario, []);
  const raceIds = trusted
    .getInstances()
    .filter((instance) => instance.executionId === "trusted-run-race")
    .map((instance) => instance.instanceId);
  const raceCancelled = await waitFor(() => raceIds.every((id) => statusOf(id) === "cancelled"), history, [trusted]);
  check("work queued while blocked is cancelled by the dispatch loop", raceIds.length === 2 && raceCancelled);
  check("no work queued while blocked ever started", raceIds.every((id) => !everRan(id)) && ran.length === 1);

  const persistedBeforeRepeats = persisted.length;
  const repeats = [enforce("interval"), enforce("window-focus"), enforce("revalidate-ipc"), enforce("interval")];
  check("repeated revalidation cancels nothing further", repeats.every((ids) => ids.length === 0));
  check("repeated revalidation writes no further audit rows", audit.length === 1, audit.join(","));
  check("repeated revalidation persists no further cancellations", persisted.length === persistedBeforeRepeats);
  check("the running instance survives repeated revalidation", statusOf(runningId) === "running");

  check("re-importing the trusted license succeeds", licenseService.importLicense(license).ok === true);
  check("the re-imported license reads VALID", licenseService.getStatus().status === LicenseStatus.VALID);
  check("recovery sweeps nothing", enforce("license-changed").length === 0);
  check(
    "recovery clears the latch and audits the clearing once",
    !latch.blocking && audit.length === 2 && audit[1] === "LICENSE_ENFORCEMENT_CLEARED:license-changed",
    audit.join(",")
  );

  releaseHeld();
  const runningFinished = await waitFor(() => statusOf(runningId) === "completed", history, [trusted]);
  check("the instance that was running finishes normally", runningFinished, statusOf(runningId));
  await trusted.startRun("trusted-run-b", runProfile("trusted-run-b", 1), [null], dirs, {}, scenario, []);
  const recoveredId = trusted.getInstances().find((instance) => instance.executionId === "trusted-run-b")?.instanceId ?? "";
  const recoveredRan = await waitFor(() => ran.includes(recoveredId) && statusOf(recoveredId) === "completed", history, [trusted]);
  check("newly authorized work starts after recovery", recoveredRan, statusOf(recoveredId));
  check(
    "no instance the license gate cancelled is revived",
    [...waitingIds, ...raceIds].every((id) => statusOf(id) === "cancelled" && !ran.includes(id))
  );
  check("only the running instance and the newly authorized one ever ran", ran.length === 2, ran.join(","));

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
  check(
    "the enforcement service composes the latch and reason the trusted-transition section mirrors",
    enforcementService.includes("nextEnforcementState(") &&
      enforcementService.includes("const reason = `license integrity failure: ${decision.reason}`;")
  );
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
