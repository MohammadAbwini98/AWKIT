import { ipcMain } from "electron";
import { createReportStore } from "../profileStores";
import { getUiSettings } from "../uiSettings";
import { computeEffectiveConcurrency, buildMachineRunContext } from "../capacityService";
import { executionEngine } from "@src/runner/ExecutionEngine";
import type { ConcurrencyLimits } from "@src/runner/concurrency/ConcurrencyConfig";
import { getSessionService } from "./session.ipc";
import { assertSenderPermission, assertSenderSuperUser } from "../security/sessionContext";
import { Permission } from "@src/security/authz/Permissions";
import { getSecretStore } from "../secretStore";
import { getOracleNodeRunner } from "../oracleService";
import { indexCompletedRun } from "../semantic/semanticService";
import { applyRunGateEnforcement, licenseDispatchGate, parkedResumeBlocker } from "../licensing/licenseEnforcementService";
import { ExecutionApplicationService } from "../execution/ExecutionApplicationService";
import type { ExecutionRunRequest } from "../execution/ExecutionApplicationService";

/**
 * The `execution:runWorkflow` wire contract, as imported by `preload.ts`. It is exactly the
 * application-layer run request — declared here by extension rather than restated, so the two can
 * never drift. The field list lives with the code that consumes it, in
 * `app/main/execution/ExecutionApplicationService.ts`; this is a type-only import, so the import
 * graph keeps its single runtime direction (IPC -> service, never back).
 */
export interface RunWorkflowRequest extends ExecutionRunRequest {}

export function registerExecutionIpc(): void {
  // Application-level run preparation. Authorization stays in the handlers below and completes
  // before the service is invoked; the service owns validation, licensing checkpoints, data-source
  // resolution, run-profile assembly, and the single call into ExecutionEngine.startRun.
  const applicationService = new ExecutionApplicationService({
    applyRuntimeConcurrencyFromSettings,
    getSessionService
  });

  executionEngine.setExecutionPorts({
    sessionAccess: getSessionService(),
    // Preserve the existing per-report factory behavior. R1B separately owns any store registry or
    // same-folder write coordination; R1A only reverses this dependency through a narrow port.
    reportPersistence: {
      persist: async (report) => {
        await createReportStore().import(report);
      }
    }
  });
  executionEngine.setDispatchGate(licenseDispatchGate);
  // Let the runner resolve `type:"secret"` value sources from the encrypted secret store at run time
  // (audit §15). Values live only in the main process; they never enter workflow JSON or the renderer.
  executionEngine.setSecretResolver((name) => getSecretStore().get(name));

  // Oracle query nodes run through the main-process OracleQueryService (owns the JDBC bridge).
  executionEngine.setOracleNodeRunner(getOracleNodeRunner());

  // Keep the semantic index fresh as runs finish, instead of only when a rebuild runs (plan §14).
  // Gated on `semantic.autoIndex` inside the observer, and non-throwing on both sides of the seam.
  executionEngine.setRunCompletionObserver((event) => indexCompletedRun(event));

  ipcMain.handle("execution:list", async () => executionEngine.getInstances());
  ipcMain.handle("execution:validate", async (_, workflowId: string) => applicationService.validateWorkflow(workflowId));
  ipcMain.handle("execution:runWorkflow", async (event, request: RunWorkflowRequest) => {
    // A REAL run (dryRun:false) requires execute permission; validation/dry-run stays open (view-level —
    // no browser is launched, so Viewer's pre-run preview still works). Authorization (who) precedes the
    // licensing gate (which machine) inside runWorkflow — independent checks, authorization first.
    //
    // AWKIT-TTVB — the exemption above is DECIDED, not accidental (docs/ai/DECISIONS.md). It is kept
    // rather than gated because gating the dryRun-not-false path would break the documented Viewer
    // pre-run preview. What makes it safe is a CROSS-MODULE COMPLEMENT: this guard runs when
    // `request.dryRun === false`, and `ExecutionApplicationService.runWorkflow` returns
    // `{ status: "validated" }` when `request.dryRun !== false`, before `applyRunGateEnforcement` and
    // `ExecutionEngine.startRun`. So every request that skips this guard launches no browser. The two
    // predicates must stay exact complements: changing EITHER one alone is a security change, not a
    // refactor. Both halves and that ordering are pinned by scripts/verify-r0-characterization.mts.
    if (request.dryRun === false) {
      const settings = await getUiSettings();
      if (settings.superUser.chrome.mode === "installedChrome") {
        await assertSenderSuperUser(event, Permission.WORKFLOW_EXECUTE, {
          audit: { eventType: "INSTALLED_CHROME_EXECUTION_DENIED", channel: "execution:runWorkflow" }
        });
      } else {
        await assertSenderPermission(event, Permission.WORKFLOW_EXECUTE);
      }
    }
    return applicationService.runWorkflow(request);
  });
  ipcMain.handle("execution:pauseInstance", async (event, instanceId: string) => {
    await assertSenderPermission(event, Permission.WORKFLOW_STOP);
    executionEngine.pauseInstance(instanceId);
    return { instanceId, state: "pause-requested" };
  });
  ipcMain.handle("execution:resumeInstance", async (event, instanceId: string) => {
    await assertSenderPermission(event, Permission.WORKFLOW_STOP);
    // AWKIT-LIC-002: parked work must consult the enforcement latch before resuming.
    const blocker = parkedResumeBlocker();
    if (blocker) return { instanceId, state: "blocked-by-license", error: blocker };
    executionEngine.resumeInstance(instanceId);
    return { instanceId, state: "resume-requested" };
  });
  ipcMain.handle("execution:retryHandoff", async (event, instanceId: string) => {
    await assertSenderPermission(event, Permission.WORKFLOW_STOP);
    // AWKIT-LIC-002: retrying a handoff resumes parked work — same latch consultation.
    const blocker = parkedResumeBlocker();
    if (blocker) return { success: false, error: blocker };
    try {
      executionEngine.retryHandoff(instanceId);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });
  ipcMain.handle("execution:stopInstance", async (event, instanceId: string) => {
    await assertSenderPermission(event, Permission.WORKFLOW_STOP);
    // AWKIT-RUN-003: refuse to stop an already-terminal instance instead of relabelling it
    // cancelled with a fresh endedAt (history corruption). Active/queued work still stops.
    const terminal = ["completed", "failed", "cancelled"];
    const instance = executionEngine.getInstances().find((i) => i.instanceId === instanceId);
    if (instance && terminal.includes(instance.status)) {
      return { instanceId, state: `already-${instance.status}` };
    }
    executionEngine.stopInstance(instanceId);
    return { instanceId, state: "stop-requested" };
  });
  ipcMain.handle("execution:stopAll", async (event) => {
    await assertSenderPermission(event, Permission.WORKFLOW_STOP);
    executionEngine.stopAll();
    return { state: "stop-all-requested" };
  });
  ipcMain.handle("execution:removeInstance", async (event, instanceId: string) => {
    await assertSenderPermission(event, Permission.WORKFLOW_STOP);
    try {
      executionEngine.removeInstance(instanceId);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });
  ipcMain.handle("execution:repeatInstance", async (event, instanceId: string) => {
    await assertSenderPermission(event, Permission.WORKFLOW_EXECUTE);
    // AWKIT-SYAA: Repeat relaunches a browser, so it must carry the same installed-Chrome Super User
    // requirement as `execution:runWorkflow` — otherwise an execute-permitted non-Super-User could
    // repeat an installed-Chrome run only a Super User was allowed to start. The decision comes from
    // the instance's own stored `config.browserDistribution`, not `getUiSettings()`: Repeat relaunches
    // from the stored config, so current settings are not launch truth. A missing instance fails closed
    // with the engine's own unknown-id message, so the wire contract for an unknown id is unchanged.
    // This sits OUTSIDE the try on purpose: inside it, a Super User denial would be swallowed by the
    // catch and downgraded to an ordinary `{ success: false, error }`. Authorization (who) precedes the
    // licensing gate (which machine).
    const repeatTarget = executionEngine.getInstances().find((i) => i.instanceId === instanceId);
    if (!repeatTarget) return { success: false, error: `Instance ${instanceId} not found.` };
    if (repeatTarget.config?.browserDistribution === "installedChrome") {
      await assertSenderSuperUser(event, Permission.WORKFLOW_EXECUTE, {
        audit: { eventType: "INSTALLED_CHROME_EXECUTION_DENIED", channel: "execution:repeatInstance" }
      });
    }
    try {
      const gate = applyRunGateEnforcement("run-request").decision;
      if (!gate.allowed) return { success: false, error: gate.status.userAction };
      executionEngine.repeatInstance(instanceId);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });
  // Concurrency-layer status: capacity, lock table, browser pool, watchdog (read-only, no secrets).
  ipcMain.handle("execution:runtimeStatus", async () => executionEngine.getRuntimeStatus());
  ipcMain.handle("execution:observationSnapshot", async (event, instanceId: string) => {
    await assertSenderPermission(event, Permission.PAGE_INSTANCES);
    return executionEngine.getObservationSnapshot(instanceId);
  });
  // Recoverable/interrupted prior runs (Phase 4C): durable detail + explicit user verdicts.
  ipcMain.handle("execution:recoveryDetails", async (_, instanceId: string) => executionEngine.getRecoveryDetails(instanceId));
  ipcMain.handle("execution:recoveryAction", async (event, instanceId: string, action: "markReviewed" | "markAbandoned") => {
    await assertSenderPermission(event, Permission.WORKFLOW_EXECUTE);
    try {
      await executionEngine.applyRecoveryAction(instanceId, action);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // Open the durable runtime at app startup (not lazily on the first run) so startup
  // recovery runs immediately and recoverable prior runs appear in the Instance Monitor
  // right after a restart. Failure downgrades to in-memory behavior inside the engine.
  void executionEngine.initializeDurableRuntime(applicationService.resolveStorageDirs()).catch((error) => {
    console.warn(`[execution] durable runtime startup init failed: ${error instanceof Error ? error.message : String(error)}`);
  });

  // Apply the user's configured host concurrency caps at startup so the idle Chrome Consumption
  // gauges and admission reflect Settings (not just the env/default 2 browsers / 4 flows).
  void applyRuntimeConcurrencyFromSettings();
}

/**
 * Push the Settings-configured browser/flow caps into the execution engine. Called at startup, after a
 * settings save (settings.ipc), and before each run. Best-effort — a read failure leaves the current
 * (env/default) limits in place and never blocks a run.
 */
export async function applyRuntimeConcurrencyFromSettings(): Promise<void> {
  try {
    const { runtime } = await getUiSettings();
    // Resolve the capacity mode (sequential / auto / manual) into concrete host caps. Auto derives them
    // from the detected machine (and refreshes the per-machine profile); sequential pins to one active
    // instance; manual uses the explicit numbers. All modes are clamped to the absolute safety ceiling.
    const effective = await computeEffectiveConcurrency(runtime);
    const overrides: Partial<ConcurrencyLimits> = {
      maxBrowsersPerHost: effective.maxBrowsers,
      maxActiveFlows: effective.maxActiveFlows
    };
    // Sequential means "one thing at a time" — also pin every operation limiter to 1 so parallel
    // branches within a single instance can't run concurrent launches/navigations/downloads either.
    if (effective.mode === "sequential") {
      overrides.maxConcurrentBrowserLaunches = 1;
      overrides.maxConcurrentContextCreations = 1;
      overrides.maxConcurrentNavigations = 1;
      overrides.maxConcurrentDownloads = 1;
      overrides.maxConcurrentScreenshots = 1;
    }
    executionEngine.configureConcurrency(overrides);
    // Phase B1: stamp upcoming runs with their machine context (mode/class/machine) for machine-aware
    // reporting. Best-effort — a detection failure never blocks the run.
    executionEngine.setMachineRunContext(await buildMachineRunContext(runtime, effective));
  } catch (error) {
    console.warn(`[execution] failed to apply runtime concurrency settings: ${error instanceof Error ? error.message : String(error)}`);
  }
}
