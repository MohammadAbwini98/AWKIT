import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { ScenarioOrchestrator } from "@src/orchestrator/ScenarioOrchestrator";
import { workflowToScenarioProfile, type WorkflowProfile } from "@src/profiles/WorkflowProfile";
import { PreRunValidator, isRunBlocked } from "@src/reports/PreRunValidator";
import { getFlowValidationService } from "../validation";
import type { CompatibilityGrant } from "@src/validation/LegacyCompatibility";
import { resolveJsonPath } from "@src/data/JsonPathResolver";
import { DataSourceResolver } from "@src/data/DataSourceResolver";
import { isOracleDataSource, type DataSourceProfile, type JsonArrayDataSourceProfile } from "@src/data/DataSourceProfile";
import type { ResolvedDataSource } from "@src/runner/InstanceExecutionContext";
import { createDataSourceProfileStore, createFlowProfileStore, createWorkflowProfileStore } from "../profileStores";
import { getResourcesRoot, getRuntimeDataRoot, getRuntimePaths } from "../appPaths";
import { isReadableDataSourceFile } from "@src/utils/pathSafety";
import { getConfiguredPaths } from "../storagePaths";
import { getUiSettings } from "../uiSettings";
import { executionEngine } from "@src/runner/ExecutionEngine";
import type { ConcurrentRunProfile } from "@src/instances/ConcurrentRunProfile";
import type { SessionCaptureService } from "@src/session/SessionCaptureService";
import { runOracleDataSourceQuery } from "../oracleService";
import type { RunGateDecision } from "../licensing/licenseRuntime";
import { applyRunGateEnforcement } from "../licensing/licenseEnforcementService";
import {
  CERTIFICATE_BYPASS_LOG_MESSAGE,
  explainIgnoreHttpsErrors,
  resolveIgnoreHttpsErrors
} from "@src/security/browser/CertificateTrust";
import { InstalledChromeResolver } from "@src/session/InstalledChromeResolver";

/**
 * Application-layer run request — the single declaration of the run parameters.
 *
 * The IPC facade's `RunWorkflowRequest` (`app/main/ipc/execution.ipc.ts`), which is what
 * `preload.ts` imports and what defines the `execution:runWorkflow` wire contract, is declared as
 * `extends ExecutionRunRequest` with no members of its own. So the two cannot drift: adding a run
 * parameter here adds it to the wire contract, and there is no second copy to forget. The facade
 * reaches this type through a type-only import, so the runtime import graph stays one-directional
 * — IPC depends on this service, never the reverse.
 */
export interface ExecutionRunRequest {
  workflowId: string;
  runtimeInputs?: Record<string, unknown>;
  headless?: boolean;
  dryRun?: boolean;
  totalInstances?: number;
  maxConcurrentInstances?: number;
  /** Capture failure evidence for steps with no explicit `onFailure.screenshot`. Omitted = artifact-profile default. */
  screenshotOnFailure?: boolean;
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

/**
 * Collaborators that live in the IPC layer and are handed to this service by
 * `registerExecutionIpc`. Injected rather than imported so `app/main/execution` never points back
 * at `app/main/ipc`.
 */
export interface ExecutionApplicationServiceDependencies {
  /**
   * Push the Settings-configured browser/flow caps into the execution engine. Owned by
   * `execution.ipc.ts` (also called at startup and after a settings save); this service only
   * sequences it before a run.
   */
  applyRuntimeConcurrencyFromSettings: () => Promise<void>;
  /** Captured-session profile access (owned by `session.ipc.ts`). */
  getSessionService: () => SessionCaptureService;
}

/**
 * Application-level run preparation for the Electron main process.
 *
 * Layering: IPC transport + sender/session/RBAC authorization -> ExecutionApplicationService ->
 * ExecutionEngine. Authorization stays in the IPC handler and completes before anything here runs;
 * this service owns validation, licensing checkpoints, data-source resolution, run-profile
 * assembly, and the single production call into `ExecutionEngine.startRun`.
 */
export class ExecutionApplicationService {
  private readonly applyRuntimeConcurrencyFromSettings: () => Promise<void>;
  private readonly getSessionService: () => SessionCaptureService;

  constructor(dependencies: ExecutionApplicationServiceDependencies) {
    this.applyRuntimeConcurrencyFromSettings = dependencies.applyRuntimeConcurrencyFromSettings;
    this.getSessionService = dependencies.getSessionService;
  }

  /** Effective storage directories (honours user-configured Settings paths). */
  public resolveStorageDirs(): StorageDirs {
    return resolveStorageDirs();
  }

  /** Validate a workflow without running it (also the pre-flight for a real run). */
  public async validateWorkflow(workflowId: string): Promise<WorkflowValidation> {
    // Resolves to the module-level function below, not to this method.
    return validateWorkflow(workflowId);
  }

  public async runWorkflow(request: ExecutionRunRequest) {
    const validation = await validateWorkflow(request.workflowId);
    if (!validation.workflow || !validation.scenario || !validation.plan) {
      return { status: "failed", validation, error: `Workflow not found: ${request.workflowId}` };
    }

    if (!validation.valid) {
      return { status: "validationFailed", validation };
    }

    // AWKIT-TTVB — this is the ungated half of the cross-module complement (docs/ai/DECISIONS.md).
    // This short-circuit is the reason `execution:runWorkflow` can authorize only when
    // `dryRun === false`: every request that skipped that guard arrives here with `dryRun !== false`
    // and returns before `applyRunGateEnforcement` and `ExecutionEngine.startRun`, so no browser is
    // ever launched for it. Narrowing this predicate (for example to `=== true`) would silently
    // create a privilege escalation with no other control changing. The two predicates must stay
    // exact complements; both halves and this ordering are pinned by
    // scripts/verify-r0-characterization.mts.
    if (request.dryRun !== false) {
      return {
        status: "validated",
        executionId: randomUUID(),
        validation,
        message: "Workflow validation passed. Browser execution is available when dryRun=false."
      };
    }

    // Trusted per-machine license gate for a REAL run (validation/dry-run above stay available so diagnostics
    // and reports work regardless of license state). Enforcement is ON by default since 2026-07-29 — see
    // licenseRuntime and docs/LICENSING.md §5. This is a machine/installation check, NOT a user authorization
    // check — it is intentionally independent of authentication/RBAC.
    const gate = applyRunGateEnforcement("run-request").decision;
    if (!gate.allowed) {
      return licenseBlockedResult(gate, validation);
    }

    // Audit (Stage 2c): a REAL run proceeding under Legacy Compatibility is recorded on the grant,
    // so "how many runs did this exemption allow" is answerable. Dry runs above never reach here.
    const compatibilityFlowIds = validation.issues
      .filter((issue) => issue.key.startsWith("legacyCompatibility.") && issue.flowId)
      .map((issue) => issue.flowId as string);
    // Attribution for the execution report (awkit-vbj). The counter on the grant answers "how many
    // runs did this exemption allow"; it does not help someone reading one report. Snapshot the grant
    // deadlines HERE, at admission, rather than re-deriving at read time — grants expire and are
    // revoked, and a historical report must keep saying what was true when the run started.
    let legacyCompatibility: ConcurrentRunProfile["legacyCompatibility"];
    let grantSnapshot: Map<string, CompatibilityGrant> | undefined;
    if (compatibilityFlowIds.length > 0) {
      const service = getFlowValidationService();
      await service.recordRunUnderCompatibility(compatibilityFlowIds).catch(() => undefined);
      grantSnapshot = await service.grantsMap().catch(() => new Map());
    }

    const flows = await createFlowProfileStore().list();
    if (grantSnapshot) {
      const byId = new Map(flows.map((flow) => [flow.id, flow]));
      legacyCompatibility = {
        flows: Array.from(new Set(compatibilityFlowIds)).map((flowId) => {
          const grant = grantSnapshot?.get(flowId);
          const flowName = byId.get(flowId)?.name;
          return {
            flowId,
            ...(flowName ? { flowName } : {}),
            ...(grant?.expiresAt ? { expiresAt: grant.expiresAt } : {})
          };
        })
      };
    }
    const { workflowDataSource, dataSources } = await resolveWorkflowDataSources(validation.workflow);

    // Ensure this run honours the latest Settings-configured host caps (idempotent; the browser-slot
    // resize only applies while the pool is idle, i.e. no other run is in flight).
    await this.applyRuntimeConcurrencyFromSettings();

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
      ...(legacyCompatibility ? { legacyCompatibility } : {}),
      instanceTemplate: await this.resolveInstanceTemplate(request, headless, validation.workflow),
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
    const preRunGate = applyRunGateEnforcement("pre-run").decision;
    if (!preRunGate.allowed) return licenseBlockedResult(preRunGate, validation);
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

  /**
   * Build the instance template. When a session profile is selected, force persistent
   * context isolation using the profile's user-data directory so the captured
   * authentication state is available to the automation run.
   */
  private async resolveInstanceTemplate(
    request: ExecutionRunRequest,
    headless: boolean,
    workflow: WorkflowProfile
  ): Promise<ConcurrentRunProfile["instanceTemplate"]> {
    // Certificate trust is resolved ONCE here, at the top of the run, and stamped onto the instance
    // template. Precedence: run override → workflow security → application setting → false. Every context
    // the run creates (initial, retry, restart, parallel isolated) inherits this single value.
    const settings = await getUiSettings();
    const { recorder } = settings;
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
      ignoreHttpsErrorsSource: explainIgnoreHttpsErrors(certificateTrustSources),
      // Run-level failure-evidence choice. Only carried when the caller stated one, so an omitted
      // field still means "use the artifact profile's default" rather than "capture nothing".
      screenshotOnFailure: typeof request.screenshotOnFailure === "boolean" ? request.screenshotOnFailure : undefined
    };

    if (settings.superUser.chrome.mode === "installedChrome") {
      const resolution = await new InstalledChromeResolver().resolve(settings.superUser.chrome.executablePath);
      if (!resolution.available) throw new Error(`${resolution.code}: ${resolution.message}`);
      base.browserDistribution = "installedChrome";
      base.executablePath = resolution.executablePath;
      base.isolationMode = "persistentContext";
    } else {
      base.browserDistribution = "bundledChromium";
    }

    if (ignoreHttpsErrors) {
      // One warning per run (ids only — never URLs or credentials). Per-context warnings are emitted by
      // BrowserContextFactory into the run log.
      console.warn(
        `[security] ${CERTIFICATE_BYPASS_LOG_MESSAGE} — workflowId=${workflow.id} source=${base.ignoreHttpsErrorsSource}`
      );
    }

    if (request.sessionProfileId) {
      const profile = await this.getSessionService().getById(request.sessionProfileId);
      if (profile && profile.status === "ready") {
        base.isolationMode = "persistentContext";
        base.userDataDir = profile.profileDir;
        base.sessionProfileId = request.sessionProfileId;
        // Mark the profile as used.
        await this.getSessionService().markUsed(profile.id);
        console.log(`[execution] Using session profile "${profile.name}" (${profile.profileDir}) for this run.`);
      } else if (profile) {
        console.warn(`[execution] Session profile "${profile.name}" is not ready (status=${profile.status}); ignoring.`);
      } else {
        console.warn(`[execution] Session profile ${request.sessionProfileId} not found; ignoring.`);
      }
    }

    return base;
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

type StorageDirs = ReturnType<typeof resolveStorageDirs>;

async function validateWorkflow(workflowId: string) {
  const workflowStore = createWorkflowProfileStore();
  const flowStore = createFlowProfileStore();
  const workflow = await workflowStore.get(workflowId);
  const flows = await flowStore.list();
  const scenario = workflow ? workflowToScenarioProfile(workflow) : undefined;
  // Stage 2c: hand the gate the Legacy Compatibility grants. `ensureInventoryScan` makes the first
  // run after an enforcement change perform the inventory scan, so flows that already existed —
  // unchanged — get their time-limited grant instead of breaking without warning. Grants only ever
  // tolerate OFF-PATH errors; validation still runs fresh on every call.
  const validationService = getFlowValidationService();
  // Fail CLOSED: if the scan or the grant store is unavailable, run with NO grants — the strict
  // gate — rather than assuming a flow was exempt. A storage failure must never widen tolerance.
  let grants: ReadonlyMap<string, CompatibilityGrant> = new Map();
  try {
    await validationService.ensureInventoryScan();
    grants = await validationService.grantsMap();
  } catch (error) {
    console.warn(`[validation] inventory/grant lookup failed; applying the strict gate: ${error instanceof Error ? error.message : String(error)}`);
  }
  const issues = new PreRunValidator().validate({
    scenario,
    flows,
    runtimeInputs: {},
    legacyCompatibility: { grants, digestFor: validationService.contentDigest }
  });
  const plan = scenario ? new ScenarioOrchestrator().createExecutionPlan(scenario) : null;

  return {
    workflow,
    scenario,
    plan,
    issues,
    // Stage 2b: block on BLOCKING issues only — errors on the active execution path (plus
    // connector-structure errors, which the runtime rejects flow-wide). Warnings and confirmed
    // off-path errors (e.g. an unreachable orphan node) report but never block. The issues array
    // carries structured locations (code/flowId/nodeId/edgeId/onActivePath) for the UI.
    valid: !isRunBlocked(issues)
  };
}

type WorkflowValidation = Awaited<ReturnType<typeof validateWorkflow>>;

function licenseBlockedResult(decision: RunGateDecision, validation: WorkflowValidation) {
  return {
    status: "licenseBlocked",
    validation,
    license: {
      status: decision.status.status,
      reasonCode: decision.status.reasonCode,
      userAction: decision.status.userAction,
      reason: decision.reason,
      activeRunDisposition: decision.activeRunDisposition
    },
    error: decision.status.userAction
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
  // AWKIT-SEC-005: execution-time reads enforce the SAME §14 confinement as every other JSON
  // data-source read: the file must be outside the AWKIT runtime root unless it IS the
  // data-sources workspace. Without this, a workflow bound to an absolute path could read
  // parsed contents of internal stores (ui-settings, session metadata) back through run rows.
  const resolved = resolveDataFilePath(file);
  if (!isReadableDataSourceFile(getRuntimeDataRoot(), getConfiguredPaths().dataSources, resolved)) {
    throw new Error(
      `Data source file "${file}" resolves inside a SpecterStudio data folder and cannot be used at run time.`
    );
  }
  return JSON.parse(await readFile(resolved, "utf8"));
}

function resolveDataFilePath(file: string): string {
  if (isAbsolute(file)) return file;
  if (file.startsWith("resources/") || file.startsWith("resources\\")) return join(process.cwd(), file);
  return join(getResourcesRoot(), file);
}
