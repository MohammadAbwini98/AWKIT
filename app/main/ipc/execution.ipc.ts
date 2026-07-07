import { ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { ScenarioOrchestrator } from "@src/orchestrator/ScenarioOrchestrator";
import { workflowToScenarioProfile, type WorkflowProfile } from "@src/profiles/WorkflowProfile";
import { PreRunValidator } from "@src/reports/PreRunValidator";
import { resolveJsonPath } from "@src/data/JsonPathResolver";
import type { ResolvedDataSource } from "@src/runner/InstanceExecutionContext";
import { createDataSourceProfileStore, createFlowProfileStore, createWorkflowProfileStore, createReportStore } from "../profileStores";
import { getResourcesRoot, getRuntimePaths } from "../appPaths";
import { getConfiguredPaths } from "../storagePaths";
import { executionEngine } from "@src/runner/ExecutionEngine";
import type { ConcurrentRunProfile } from "@src/instances/ConcurrentRunProfile";
import { getSessionService } from "./session.ipc";

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
}

export function registerExecutionIpc(): void {
  ipcMain.handle("execution:list", async () => executionEngine.getInstances());
  ipcMain.handle("execution:validate", async (_, workflowId: string) => validateWorkflow(workflowId));
  ipcMain.handle("execution:runWorkflow", async (_, request: RunWorkflowRequest) => runWorkflow(request));
  ipcMain.handle("execution:pauseInstance", async (_, instanceId: string) => {
    executionEngine.pauseInstance(instanceId);
    return { instanceId, state: "pause-requested" };
  });
  ipcMain.handle("execution:resumeInstance", async (_, instanceId: string) => {
    executionEngine.resumeInstance(instanceId);
    return { instanceId, state: "resume-requested" };
  });
  ipcMain.handle("execution:retryHandoff", async (_, instanceId: string) => {
    try {
      executionEngine.retryHandoff(instanceId);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });
  ipcMain.handle("execution:stopInstance", async (_, instanceId: string) => {
    executionEngine.stopInstance(instanceId);
    return { instanceId, state: "stop-requested" };
  });
  ipcMain.handle("execution:stopAll", async () => {
    executionEngine.stopAll();
    return { state: "stop-all-requested" };
  });
  ipcMain.handle("execution:removeInstance", async (_, instanceId: string) => {
    try {
      executionEngine.removeInstance(instanceId);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });
  ipcMain.handle("execution:repeatInstance", async (_, instanceId: string) => {
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
  ipcMain.handle("execution:recoveryAction", async (_, instanceId: string, action: "markReviewed" | "markAbandoned") => {
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

  const flows = await createFlowProfileStore().list();
  const { workflowDataSource, dataSources } = await resolveWorkflowDataSources(validation.workflow);
  
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
    instanceTemplate: await resolveInstanceTemplate(request, headless),
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
  const profiles = await store.list();
  const dataSources: Record<string, ResolvedDataSource> = {};

  for (const profile of profiles) {
    try {
      dataSources[profile.id] = await toResolvedDataSource(profile.id, profile.name, profile.file, profile.path);
    } catch {
      // Skip unreadable data sources
    }
  }

  let workflowDataSource: ResolvedDataSource | undefined;
  if (workflow.dataSource?.dataSourceId) {
    const bound = dataSources[workflow.dataSource.dataSourceId];
    if (bound) {
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
  headless: boolean
): Promise<ConcurrentRunProfile["instanceTemplate"]> {
  const base: ConcurrentRunProfile["instanceTemplate"] = {
    browser: "chromium",
    headless,
    isolationMode: request.isolationMode ?? "browserContext",
    timeoutMs: 30000,
    viewport: { width: 1365, height: 768 }
  };

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
