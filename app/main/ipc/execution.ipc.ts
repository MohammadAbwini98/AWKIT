import { ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { ScenarioOrchestrator } from "@src/orchestrator/ScenarioOrchestrator";
import { workflowToScenarioProfile, type WorkflowProfile } from "@src/profiles/WorkflowProfile";
import { PreRunValidator } from "@src/reports/PreRunValidator";
import { resolveJsonPath } from "@src/data/JsonPathResolver";
import { DataSourceResolver } from "@src/data/DataSourceResolver";
import { isOracleDataSource, type DataSourceProfile, type JsonArrayDataSourceProfile } from "@src/data/DataSourceProfile";
import type { ResolvedDataSource } from "@src/runner/InstanceExecutionContext";
import { createDataSourceProfileStore, createFlowProfileStore, createWorkflowProfileStore, createReportStore } from "../profileStores";
import { getResourcesRoot, getRuntimePaths } from "../appPaths";
import { getConfiguredPaths } from "../storagePaths";
import { getUiSettings } from "../uiSettings";
import { computeEffectiveConcurrency, buildMachineRunContext } from "../capacityService";
import { executionEngine } from "@src/runner/ExecutionEngine";
import type { ConcurrentRunProfile } from "@src/instances/ConcurrentRunProfile";
import type { ConcurrencyLimits } from "@src/runner/concurrency/ConcurrencyConfig";
import { getSessionService } from "./session.ipc";
import { assertSenderPermission } from "../security/sessionContext";
import { Permission } from "@src/security/authz/Permissions";
import { getSecretStore } from "../secretStore";
import { getOracleNodeRunner, runOracleDataSourceQuery } from "../oracleService";
import { evaluateRunGate } from "../licensing/licenseRuntime";
import {
  CERTIFICATE_BYPASS_LOG_MESSAGE,
  explainIgnoreHttpsErrors,
  resolveIgnoreHttpsErrors
} from "@src/security/browser/CertificateTrust";

export interface RunWorkflowRequest {
  workflowId: string;
  runtimeInputs?: Record<string, unknown>;
  headless?: boolean;
  dryRun?: boolean;
  totalInstances?: number;
  maxConcurrentInstances?: number;
  /** Per-card run parameters (Concurrent Instance Monitor workflow cards). */
  isolationMode?: "browserContext" | "persistentContext";
  stopOnError?: boolean;
  /** When set, the run uses this captured session profile's persistent user-data directory. */
  sessionProfileId?: string;
  /**
   * Run-level certificate-trust override (highest precedence). Omitted = inherit the workflow /
   * application setting. Present and `false` = force certificate validation for this run only.
   */
  ignoreHttpsErrors?: boolean;
}

export function registerExecutionIpc(): void {
  // Let the runner resolve `type:"secret"` value sources from the encrypted secret store at run time
  // (audit §15). Values live only in the main process; they never enter workflow JSON or the renderer.
  executionEngine.setSecretResolver((name) => getSecretStore().get(name));

  // Oracle query nodes run through the main-process OracleQueryService (owns the JDBC bridge).
  executionEngine.setOracleNodeRunner(getOracleNodeRunner());

  ipcMain.handle("execution:list", async () => executionEngine.getInstances());
  ipcMain.handle("execution:validate", async (_, workflowId: string) => validateWorkflow(workflowId));
  ipcMain.handle("execution:runWorkflow", async (event, request: RunWorkflowRequest) => {
    // A REAL run (dryRun:false) requires execute permission; validation/dry-run stays open (view-level —
    // no browser is launched, so Viewer's pre-run preview still works). Authorization (who) precedes the
    // licensing gate (which machine) inside runWorkflow — independent checks, authorization first.
    if (request.dryRun === false) {
      await assertSenderPermission(event, Permission.WORKFLOW_EXECUTE);
    }
    return runWorkflow(request);
  });
  ipcMain.handle("execution:pauseInstance", async (event, instanceId: string) => {
    await assertSenderPermission(event, Permission.WORKFLOW_STOP);
    executionEngine.pauseInstance(instanceId);
    return { instanceId, state: "pause-requested" };
  });
  ipcMain.handle("execution:resumeInstance", async (event, instanceId: string) => {
    await assertSenderPermission(event, Permission.WORKFLOW_STOP);
    executionEngine.resumeInstance(instanceId);
    return { instanceId, state: "resume-requested" };
  });
  ipcMain.handle("execution:retryHandoff", async (event, instanceId: string) => {
    await assertSenderPermission(event, Permission.WORKFLOW_STOP);
    try {
      executionEngine.retryHandoff(instanceId);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });
  ipcMain.handle("execution:stopInstance", async (event, instanceId: string) => {
    await assertSenderPermission(event, Permission.WORKFLOW_STOP);
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
    try {
      executionEngine.repeatInstance(instanceId);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });
  // Concurrency-layer status: capacity, lock table, browser pool, watchdog (read-only, no secrets).
  ipcMain.handle("execution:runtimeStatus", async () => executionEngine.getRuntimeStatus());
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
  void executionEngine.initializeDurableRuntime(resolveStorageDirs()).catch((error) => {
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

/** Effective storage directories (honours user-configured Settings paths). */
function resolveStorageDirs() {
  const runtimePaths = getRuntimePaths();
  const configured = getConfiguredPaths();
  return {
    root: runtimePaths.root,
    downloads: configured.downloads,
    screenshots: configured.screenshots,
    logs: configured.logs,
    reports: configured.reports
  };
}

async function validateWorkflow(workflowId: string) {
  const workflowStore = createWorkflowProfileStore();
  const flowStore = createFlowProfileStore();
  const workflow = await workflowStore.get(workflowId);
  const flows = await flowStore.list();
  const scenario = workflow ? workflowToScenarioProfile(workflow) : undefined;
  const issues = new PreRunValidator().validate({ scenario, flows, runtimeInputs: {} });
  const plan = scenario ? new ScenarioOrchestrator().createExecutionPlan(scenario) : null;

  return {
    workflow,
    scenario,
    plan,
    issues,
    valid: issues.every((issue) => issue.severity !== "error")
  };
}

async function runWorkflow(request: RunWorkflowRequest) {
  const validation = await validateWorkflow(request.workflowId);
  if (!validation.workflow || !validation.scenario || !validation.plan) {
    return { status: "failed", validation, error: `Workflow not found: ${request.workflowId}` };
  }

  if (!validation.valid) {
    return { status: "validationFailed", validation };
  }

  if (request.dryRun !== false) {
    return {
      status: "validated",
      executionId: randomUUID(),
      validation,
      message: "Workflow validation passed. Browser execution is available when dryRun=false."
    };
  }

  // Trusted per-machine license gate for a REAL run (validation/dry-run above stay available so diagnostics
  // and reports work regardless of license state). Enforcement is opt-in (default OFF) — see licenseRuntime;
  // with it off the gate always allows and this is a no-op. This is a machine/installation check, NOT a user
  // authorization check — it is intentionally independent of authentication/RBAC.
  const gate = evaluateRunGate();
  if (!gate.allowed) {
    return {
      status: "licenseBlocked",
      validation,
      license: { status: gate.status.status, reasonCode: gate.status.reasonCode, userAction: gate.status.userAction },
      error: gate.status.userAction
    };
  }

  const flows = await createFlowProfileStore().list();
  const { workflowDataSource, dataSources } = await resolveWorkflowDataSources(validation.workflow);

  // Ensure this run honours the latest Settings-configured host caps (idempotent; the browser-slot
  // resize only applies while the pool is idle, i.e. no other run is in flight).
  await applyRuntimeConcurrencyFromSettings();

  const executionId = randomUUID();
  const totalInstances = request.totalInstances ?? 1;
  const maxConcurrentInstances = request.maxConcurrentInstances ?? 1;
  const headless = request.headless ?? false;

  const profile: ConcurrentRunProfile = {
    id: executionId,
    scenarioId: validation.workflow.id,
    runMode: workflowDataSource ? "dataDrivenConcurrent" : "fixedConcurrent",
    maxConcurrentInstances,
    browserWindowMode: headless ? "headless" : "activeOnly",
    dataSource: workflowDataSource ? {
      id: workflowDataSource.id,
      name: workflowDataSource.name,
      type: "jsonArray",
      file: workflowDataSource.file,
      path: workflowDataSource.rootArrayPath,
      rowCount: workflowDataSource.rows.length,
      sampleRow: workflowDataSource.rows[0]
    } : { id: "", name: "", type: "jsonArray", file: "", path: "$", rowCount: 0, sampleRow: {} },
    instanceTemplate: await resolveInstanceTemplate(request, headless, validation.workflow),
    resourceControls: {
      maxBrowserContextsPerProcess: 5,
      delayBetweenInstanceStartsMs: 250
    },
    failurePolicy: {
      stopAllOnCriticalFailure: request.stopOnError ?? false,
      continueOtherInstancesOnFailure: !(request.stopOnError ?? false),
      retryFailedInstance: false,
      retryCount: 0
    }
  };

  const rows = workflowDataSource?.rows ?? Array.from({ length: totalInstances });

  // Resolve effective storage directories (honours user-configured Settings paths).
  const dirs = resolveStorageDirs();

  // Fire and forget, but wait for initial pool registration to complete synchronously
  await executionEngine.startRun(
    executionId,
    profile,
    rows,
    dirs,
    request.runtimeInputs ?? {},
    validation.scenario,
    flows,
    workflowDataSource,
    dataSources
  );

  return { 
    status: "started", 
    executionId, 
    validation, 
    message: `Started execution run ${executionId} with ${totalInstances} total instance(s).` 
  };
}

async function resolveWorkflowDataSources(
  workflow: WorkflowProfile
): Promise<{ workflowDataSource?: ResolvedDataSource; dataSources: Record<string, ResolvedDataSource> }> {
  const store = createDataSourceProfileStore();
  // The data-sources folder holds a discriminated union (jsonArray | oracle); the store reads the raw
  // JSON regardless of its generic, so widen to the union to branch on the discriminator.
  const profiles = (await store.list()) as unknown as DataSourceProfile[];
  const dataSources: Record<string, ResolvedDataSource> = {};

  // One resolver per run defines the runtime cache scope: an Oracle runtime source executes once and
  // shares that result (single-flight) across every consumer in the run. JSON arrays keep their
  // existing eager file/path path below and are not routed through the resolver.
  const resolver = new DataSourceResolver({
    readJsonRows: async () => [],
    runOracleRuntimeQuery: (profile) => runOracleDataSourceQuery(profile)
  });

  for (const profile of profiles) {
    try {
      if (isOracleDataSource(profile)) {
        dataSources[profile.id] = resolver.resolve(profile);
      } else {
        const json = profile as JsonArrayDataSourceProfile;
        dataSources[json.id] = await toResolvedDataSource(json.id, json.name, json.file, json.path);
      }
    } catch {
      // Skip unreadable data sources
    }
  }

  let workflowDataSource: ResolvedDataSource | undefined;
  if (workflow.dataSource?.dataSourceId) {
    const bound = dataSources[workflow.dataSource.dataSourceId];
    if (bound?.type === "oracle") {
      // Materialize the bound Oracle source eagerly so `.rows`-driven loops (dataRows) see a real
      // count. Snapshot rows are already present; a runtime source executes its query once here.
      const rows = bound.rows.length ? bound.rows : bound.loadRows ? await bound.loadRows() : [];
      workflowDataSource = { ...bound, rows };
    } else if (bound) {
      workflowDataSource = {
        ...bound,
        rootArrayPath: workflow.dataSource.rootArrayPath || bound.rootArrayPath,
        rows: extractRows(await readDataFile(bound.file), workflow.dataSource.rootArrayPath || bound.rootArrayPath)
      };
    }
  }

  return { workflowDataSource, dataSources };
}

async function toResolvedDataSource(id: string, name: string, file: string, rootArrayPath: string): Promise<ResolvedDataSource> {
  const data = await readDataFile(file);
  return { id, name, file: resolveDataFilePath(file), rootArrayPath: rootArrayPath || "$", rows: extractRows(data, rootArrayPath || "$") };
}

function extractRows(data: unknown, rootArrayPath: string): unknown[] {
  const resolved = resolveJsonPath(data, rootArrayPath || "$");
  return Array.isArray(resolved) ? resolved : [];
}

async function readDataFile(file: string): Promise<unknown> {
  return JSON.parse(await readFile(resolveDataFilePath(file), "utf8"));
}

function resolveDataFilePath(file: string): string {
  if (isAbsolute(file)) return file;
  if (file.startsWith("resources/") || file.startsWith("resources\\")) return join(process.cwd(), file);
  return join(getResourcesRoot(), file);
}

/**
 * Build the instance template. When a session profile is selected, force persistent
 * context isolation using the profile's user-data directory so the captured
 * authentication state is available to the automation run.
 */
async function resolveInstanceTemplate(
  request: RunWorkflowRequest,
  headless: boolean,
  workflow: WorkflowProfile
): Promise<ConcurrentRunProfile["instanceTemplate"]> {
  // Certificate trust is resolved ONCE here, at the top of the run, and stamped onto the instance
  // template. Precedence: run override → workflow security → application setting → false. Every context
  // the run creates (initial, retry, restart, parallel isolated) inherits this single value.
  const { recorder } = await getUiSettings();
  const certificateTrustSources = {
    run: request.ignoreHttpsErrors,
    workflow: workflow.security,
    app: recorder.security
  };
  const ignoreHttpsErrors = resolveIgnoreHttpsErrors(certificateTrustSources);

  const base: ConcurrentRunProfile["instanceTemplate"] = {
    browser: "chromium",
    headless,
    isolationMode: request.isolationMode ?? "browserContext",
    timeoutMs: 30000,
    viewport: { width: 1365, height: 768 },
    ignoreHttpsErrors,
    ignoreHttpsErrorsSource: explainIgnoreHttpsErrors(certificateTrustSources)
  };

  if (ignoreHttpsErrors) {
    // One warning per run (ids only — never URLs or credentials). Per-context warnings are emitted by
    // BrowserContextFactory into the run log.
    console.warn(
      `[security] ${CERTIFICATE_BYPASS_LOG_MESSAGE} — workflowId=${workflow.id} source=${base.ignoreHttpsErrorsSource}`
    );
  }

  if (request.sessionProfileId) {
    const profile = await getSessionService().getById(request.sessionProfileId);
    if (profile && profile.status === "ready") {
      base.isolationMode = "persistentContext";
      base.userDataDir = profile.profileDir;
      base.sessionProfileId = request.sessionProfileId;
      // Mark the profile as used.
      await getSessionService().markUsed(profile.id);
      console.log(`[execution] Using session profile "${profile.name}" (${profile.profileDir}) for this run.`);
    } else if (profile) {
      console.warn(`[execution] Session profile "${profile.name}" is not ready (status=${profile.status}); ignoring.`);
    } else {
      console.warn(`[execution] Session profile ${request.sessionProfileId} not found; ignoring.`);
    }
  }

  return base;
}
