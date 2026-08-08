import { contextBridge, ipcRenderer } from "electron";
import { toDisplayableIpcError } from "./ipcErrorMessage";
import type { JsonArrayDataSourceProfile } from "@src/data/DataSourceProfile";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import type { WorkflowProfile } from "@src/profiles/WorkflowProfile";
import type { OfflineRuntimeStatus } from "@src/offline/OfflineRuntimeValidator";
import type { SemanticSearchRequest } from "@src/semantic/contracts/SemanticDocument";
import type {
  LocatorSuggestionRequest,
  SemanticAdminResponse,
  SemanticSearchResponse,
  SemanticSettingsPatch,
  SemanticSettingsView,
  SemanticStatusView,
  SimilarFailureRequest
} from "@src/semantic/contracts/SemanticApi";
import type { RunWorkflowRequest } from "./ipc/execution.ipc";
import type { FlowValidationStatusDto as FlowValidationStatus } from "./ipc/validation.ipc";
import type { InstanceProfile, RuntimeInputProfile } from "./profileStores";
import type { DeepPartial, UiSettings } from "./uiSettings";
import type { SessionProfile, SessionCaptureStatus, DetectedBrowser } from "@src/session/SessionProfile";
import type { SecretSummary } from "./secretStore";
import type { OracleConnectionProfileView } from "@src/oracle/OracleConnectionProfile";
import type { OracleProfileInput, TestConnectionResult } from "@src/oracle/OracleProfileService";
import type { OracleDataSourceProfile } from "@src/data/DataSourceProfile";
import type { OracleDataSourceInput } from "./oracleService";
import type { OracleDriverBundleView } from "@src/oracle/OracleDriverBundle";
import type { DriverProbeResult } from "@src/oracle/OracleDriverBundleStore";
import type { JavaRuntimeProfileView } from "@src/oracle/JavaRuntimeProfile";
import type { LoginOption, LoginResult, ProviderId, SessionValidationResult } from "@src/security/auth/AuthTypes";
import type { AdminUserView } from "@src/security/admin/UserAdminService";
import type { AdminRoleView } from "@src/security/admin/RoleAdminService";
import type { AuditRecord } from "@src/security/store/SecurityStoreSchema";
import type { ActivationRequest, LicenseDocument } from "@src/licensing/LicenseTypes";
import type { LicenseStatusReport, ImportOutcome } from "@src/licensing/LicenseService";
import type { LicenseStatusView } from "./licensing/licenseRuntime";
import type {
  IssueLicenseInput,
  IssuedLicenseResult,
  IssuerReadiness
} from "@src/licensing/issuer/LicenseIssuerContracts";
import type { RuntimeStatusSnapshot } from "@src/runner/concurrency/RuntimeStatus";
import type { CdpObservationSnapshot } from "@src/runner/observation/PassiveCdpTrace";
import type { BrandingStateView } from "./ipc/branding.ipc";
import type { DebugLogEntry } from "./debugLogService";
import type { RoadmapSnapshot } from "./roadmapSnapshotService";

/** Uniform admin IPC response shape (success carries `value`; failure carries a safe `reason`). */
type AdminResponse<T> = { ok: boolean; value?: T; reason?: string; errors?: string[] };
import type { CapacityPreview } from "@src/runner/concurrency/CapacityContracts";
import type { WorkloadClass } from "@src/runner/concurrency/CapacityPlanner";
import type { DurableArtifactRecord, DurableAttemptRecord, DurableRunRecord } from "@src/runner/store/RuntimeStoreSchema";
import type {
  FailureBreakdown,
  MachineFilter,
  MachineSummary,
  ProcessHistoryPoint,
  RunDetail,
  RunHistoryFilter,
  RunHistoryPage,
  RuntimeSeriesPoint,
  ServerReport,
  TelemetryOverview,
  TelemetryPage,
  TelemetryRangePreset,
  WorkflowComparisonRow,
  WorkflowReportRow,
  WorkflowTrend
} from "@src/reports/TelemetryContracts";
import type {
  AnomalyEvent,
  CapacityAnalytics,
  RunVsHistoryComparison,
  RuntimeObservabilitySummary,
  WorkflowHistoricalStats,
  WorkflowHistoricalTrend,
  WorkflowRanking,
  WorkflowRankingMetric
} from "@src/reports/ObservabilityContracts";

/** Recorder status surfaced to the renderer (drives the record controls + the security indicators). */
type RecorderStatus = {
  isRecording: boolean;
  actionCount: number;
  /** True when protected-login detection is being ignored (global setting or session override). */
  protectedDetectionIgnored: boolean;
  /** True when the LIVE session's browser contexts were created with certificate validation off. */
  ignoreHttpsErrors: boolean;
  /** Non-secret popup capture initialization failure, when one occurred. */
  instrumentationError?: string;
};

/**
 * The single renderer-facing IPC boundary (awkit-x48).
 *
 * Every `window.playwrightFlowStudio.*` call goes through here so a rejection reaches the UI as the
 * message the handler actually wrote, not wrapped in Electron's
 * `Error invoking remote method '<channel>': ` preamble — which named an internal channel in a
 * user-facing toast. Fixed once at the boundary rather than at ~200 call sites or per toast; the
 * original error is kept as `cause`, so the failing channel is still available for diagnostics.
 */
async function invoke(channel: string, ...args: unknown[]): Promise<never> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as never;
  } catch (error) {
    throw toDisplayableIpcError(error);
  }
}

const api = {
  // Custom application-frame window controls. Deliberately minimal: the renderer can only drive
  // these passive window operations and observe the maximized state — no BrowserWindow, no ipcRenderer.
  appWindow: {
    minimize: () => invoke("window:minimize") as Promise<void>,
    toggleMaximize: () => invoke("window:toggleMaximize") as Promise<boolean>,
    close: () => invoke("window:close") as Promise<void>,
    isMaximized: () => invoke("window:isMaximized") as Promise<boolean>,
    /**
     * Subscribe to real maximize/restore/full-screen state changes. Returns an unsubscribe function;
     * callers must invoke it on unmount so remounts don't stack duplicate listeners.
     */
    onMaximizedChange: (callback: (maximized: boolean) => void) => {
      const listener = (_event: unknown, maximized: boolean) => callback(maximized);
      ipcRenderer.on("window:maximizedChanged", listener);
      return () => ipcRenderer.removeListener("window:maximizedChanged", listener);
    }
  },
  system: {
    openPath: (path: string) => invoke("system:openPath", path) as Promise<string>,
    browseFolder: (defaultPath?: string) => invoke("system:browseFolder", defaultPath) as Promise<string | null>,
    capacityPreview: (workloadClass?: WorkloadClass) =>
      invoke("system:capacityPreview", workloadClass) as Promise<CapacityPreview>
  },
  auth: {
    getCapabilities: () =>
      invoke("auth:getCapabilities") as Promise<{
        oauthConfigured: boolean;
        loadSessionSupported: boolean;
        testSessionSupported: boolean;
        reasons: { oauth: string; savedSession: string; testSession: string };
      }>,
    openOAuth: (provider: string) => invoke("auth:openOAuth", provider) as Promise<{ success: boolean; error?: string }>,
    openExternal: (url: string) => invoke("auth:openExternal", url) as Promise<{ success: boolean; error?: string }>
  },
  offlineRuntime: {
    getStatus: () => invoke("offlineRuntime:getStatus") as Promise<OfflineRuntimeStatus>
  },
  // App identity: local virtual-user authentication (distinct from the automation `auth`/`session`
  // namespaces above, which are for browser-login handoff). The renderer only ever receives a
  // PrincipalSnapshot (UI hint) or a safe reason code — never password material or hashes. All
  // decisions happen in the main process; this bridge is invoke-only.
  security: {
    getBootState: () =>
      invoke("security:getBootState") as Promise<{
        provisioned: boolean;
        secureStorageAvailable: boolean;
        idleTimeoutMs?: number;
      }>,
    getLoginOptions: () => invoke("security:getLoginOptions") as Promise<LoginOption[]>,
    bootstrapSuperUser: (input: { username: string; password: string; displayName?: string }) =>
      invoke("security:bootstrapSuperUser", input) as Promise<{ ok: boolean; recoveryCode?: string; reason?: string; errors?: string[] }>,
    login: (request: { providerId: ProviderId; username: string; password: string }) =>
      invoke("security:login", request) as Promise<LoginResult>,
    recoverSuperUser: (input: { recoveryCode: string; newPassword: string }) =>
      invoke("security:recoverSuperUser", input) as Promise<{ ok: boolean; reason?: string; errors?: string[] }>,
    validateSession: (sessionRef: string) =>
      invoke("security:validateSession", sessionRef) as Promise<SessionValidationResult>,
    logout: (sessionRef: string) => invoke("security:logout", sessionRef) as Promise<void>,
    changePassword: (input: { sessionRef: string; currentPassword: string; newPassword: string }) =>
      invoke("security:changePassword", input) as Promise<{ ok: boolean; reason?: string; errors?: string[] }>,
    reauth: (input: { sessionRef: string; password: string }) =>
      invoke("security:reauth", input) as Promise<{ ok: boolean; reason?: string }>,
    onIdleTimeoutChanged: (callback: (idleTimeoutMs: number) => void) => {
      const listener = (_event: unknown, idleTimeoutMs: number) => callback(idleTimeoutMs);
      ipcRenderer.on("security:idle-timeout-changed", listener);
      return () => {
        ipcRenderer.removeListener("security:idle-timeout-changed", listener);
      };
    },
    admin: {
      listUsers: (sessionRef: string) =>
        invoke("security:admin:listUsers", { sessionRef }) as Promise<AdminResponse<AdminUserView[]>>,
      createUser: (input: { sessionRef: string; username: string; password: string; displayName?: string; roles: string[] }) =>
        invoke("security:admin:createUser", input) as Promise<AdminResponse<AdminUserView>>,
      updateUser: (input: {
        sessionRef: string;
        userId: string;
        displayName?: string;
        roles?: string[];
        permissionGrants?: string[];
        permissionDenies?: string[];
      }) =>
        invoke("security:admin:updateUser", input) as Promise<AdminResponse<AdminUserView>>,
      setStatus: (input: { sessionRef: string; userId: string; status: "active" | "disabled" | "archived" }) =>
        invoke("security:admin:setStatus", input) as Promise<AdminResponse<AdminUserView>>,
      resetPassword: (input: { sessionRef: string; userId: string; newPassword: string }) =>
        invoke("security:admin:resetPassword", input) as Promise<AdminResponse<undefined>>,
      revokeSessions: (input: { sessionRef: string; userId: string }) =>
        invoke("security:admin:revokeSessions", input) as Promise<AdminResponse<undefined>>,
      listRoles: (sessionRef: string) =>
        invoke("security:admin:listRoles", { sessionRef }) as Promise<AdminResponse<AdminRoleView[]>>,
      createRole: (input: { sessionRef: string; name: string; description?: string; permissions: string[] }) =>
        invoke("security:admin:createRole", input) as Promise<AdminResponse<AdminRoleView>>,
      updateRole: (input: { sessionRef: string; roleId: string; name: string; description?: string; permissions: string[] }) =>
        invoke("security:admin:updateRole", input) as Promise<AdminResponse<AdminRoleView>>,
      deleteRole: (input: { sessionRef: string; roleId: string }) =>
        invoke("security:admin:deleteRole", input) as Promise<AdminResponse<undefined>>,
      listAudit: (input: { sessionRef: string; limit?: number; offset?: number }) =>
        invoke("security:admin:listAudit", input) as Promise<AdminResponse<AuditRecord[]>>
    }
  },
  licensing: {
    getStatus: (sessionRef: string) =>
      invoke("licensing:getStatus", sessionRef) as Promise<AdminResponse<LicenseStatusView>>,
    revalidate: (sessionRef: string) =>
      invoke("licensing:revalidate", sessionRef) as Promise<AdminResponse<LicenseStatusView>>,
    exportRequest: (sessionRef: string) =>
      invoke("licensing:exportRequest", sessionRef) as Promise<AdminResponse<ActivationRequest>>,
    import: (input: { sessionRef: string; license: LicenseDocument }) =>
      invoke("licensing:import", input) as Promise<AdminResponse<ImportOutcome>>,
    replace: (input: { sessionRef: string; license: LicenseDocument }) =>
      invoke("licensing:replace", input) as Promise<AdminResponse<ImportOutcome>>,
    revoke: (sessionRef: string) =>
      invoke("licensing:revoke", sessionRef) as Promise<AdminResponse<{ ok: boolean; status: LicenseStatusReport; reason?: string }>>,
    remove: (sessionRef: string) =>
      invoke("licensing:remove", sessionRef) as Promise<AdminResponse<{ ok: boolean; status: LicenseStatusReport }>>
  },
  issuer: {
    getReadiness: (sessionRef: string) =>
      invoke("issuer:getReadiness", sessionRef) as Promise<AdminResponse<IssuerReadiness>>,
    issue: (input: { sessionRef: string; request: IssueLicenseInput }) =>
      invoke("issuer:issue", input) as Promise<AdminResponse<IssuedLicenseResult>>,
    openOutputFolder: (sessionRef: string) =>
      invoke("issuer:openOutputFolder", sessionRef) as Promise<AdminResponse<string>>
  },
  settings: {
    get: () => invoke("settings:get") as Promise<UiSettings>,
    update: (patch: DeepPartial<UiSettings>) => invoke("settings:update", patch) as Promise<UiSettings>,
    reset: () => invoke("settings:reset") as Promise<UiSettings>,
    clearUiState: () => invoke("settings:clearUiState") as Promise<UiSettings>,
    export: () => invoke("settings:export") as Promise<UiSettings>,
    import: (incoming: unknown) => invoke("settings:import", incoming) as Promise<UiSettings>,
    validate: () => invoke("settings:validate") as Promise<string[]>,
    getDefaultPaths: () => invoke("settings:getDefaultPaths") as Promise<Record<string, string>>,
    validatePaths: () =>
      invoke("settings:validatePaths") as Promise<
        Record<string, { path: string; exists: boolean; writable: boolean }>
      >,
    openRuntimeFolder: () => invoke("settings:openRuntimeFolder") as Promise<string>,
    getStorageStats: () =>
      invoke("settings:getStorageStats") as Promise<{
        appVersion: string;
        runtimeDataRoot: string;
        productionOffline: boolean;
        flows: number;
        workflows: number;
        dataSources: number;
        reports: number;
      }>
  },
  debug: {
    list: (limit?: number) => invoke("debug:list", limit) as Promise<DebugLogEntry[]>
  },
  roadmap: {
    getSnapshot: () => invoke("roadmap:getSnapshot") as Promise<RoadmapSnapshot>
  },
  // Custom workspace logo (Settings → Appearance → Branding). `getState` is an open read (every role
  // renders the sidebar); the mutating calls are Super-User-only, enforced in the main process. The
  // upload payload is normalized PNG bytes (structured-clone `Uint8Array`, no base64 on the wire);
  // `getState` returns the active logo as a self-contained `data:` URL for direct `<img src>` use.
  branding: {
    getState: () => invoke("branding:getState") as Promise<BrandingStateView>,
    uploadLogo: (bytes: Uint8Array) =>
      invoke("branding:uploadLogo", bytes) as Promise<{ ok: boolean; reason?: string; state?: BrandingStateView }>,
    removeLogo: () =>
      invoke("branding:removeLogo") as Promise<{ ok: boolean; reason?: string; state?: BrandingStateView }>
  },
  flows: {
    list: () => invoke("flows:list") as Promise<FlowProfile[]>,
    get: (id: string) => invoke("flows:get", id) as Promise<FlowProfile | null>,
    create: (profile: FlowProfile) => invoke("flows:create", profile) as Promise<FlowProfile>,
    update: (id: string, profile: FlowProfile) => invoke("flows:update", id, profile) as Promise<FlowProfile>,
    delete: (id: string) => invoke("flows:delete", id) as Promise<void>,
    clone: (id: string, nextId?: string) => invoke("flows:clone", id, nextId) as Promise<FlowProfile>,
    export: (id: string) => invoke("flows:export", id) as Promise<FlowProfile>,
    // Stage 2b: import returns the stored profile plus a validation summary. A parseable invalid
    // flow imports as a Draft; `validation.runnable` is derived and never persisted.
    import: (profile: FlowProfile) =>
      invoke("flows:import", profile) as Promise<{
        profile: FlowProfile;
        validation: { issues: unknown[]; errorCount: number; warningCount: number; blockingCount: number; runnable: boolean };
      }>
  },
  /**
   * Flow validation + Legacy Compatibility (Stage 2c). Every status here is DERIVED on demand;
   * nothing is persisted onto a flow profile. `applySafeFixes`/`undoMigration` are the only
   * mutating calls and both require the Edit Flows permission in main.
   */
  validation: {
    statusAll: () => invoke("validation:statusAll") as Promise<FlowValidationStatus[]>,
    status: (flowId: string) => invoke("validation:status", flowId) as Promise<FlowValidationStatus | null>,
    meta: () => invoke("validation:meta") as Promise<{ validatorVersion: number; windowDays: number }>,
    grants: () => invoke("validation:grants") as Promise<unknown[]>,
    latestScan: () => invoke("validation:latestScan") as Promise<unknown | null>,
    runInventoryScan: () => invoke("validation:runInventoryScan") as Promise<unknown>,
    previewSafeFixes: (flowId: string) =>
      invoke("validation:previewSafeFixes", flowId) as Promise<{
        fixes: { code: string; field: string; from: string; to: string; description: string; edgeId?: string }[];
        beforeErrorCount: number;
        afterErrorCount: number;
      }>,
    applySafeFixes: (flowId: string) => invoke("validation:applySafeFixes", flowId) as Promise<{ record: { id: string; backupPath: string; fixes: unknown[] }; profile: FlowProfile }>,
    undoMigration: (flowId: string, migrationId: string) => invoke("validation:undoMigration", flowId, migrationId) as Promise<{ profile: FlowProfile }>,
    migrations: (flowId: string) =>
      invoke("validation:migrations", flowId) as Promise<
        // `backupPath` was omitted here while nothing read this channel; the handler has always
        // returned the full MigrationRecord, and the designer needs it to re-offer undo after a
        // restart.
        //
        // `undoable` is derived by main. Do NOT decide it here from `undoneAt` — that is exactly
        // what offered an undo for a record with no verifiable digest and a missing backup.
        {
          id: string;
          at: string;
          fixes: unknown[];
          backupPath: string;
          undoneAt?: string;
          undoable: boolean;
          undoBlockedReason?: string;
        }[]
      >
  },
  workflows: {
    list: () => invoke("workflows:list") as Promise<WorkflowProfile[]>,
    get: (id: string) => invoke("workflows:get", id) as Promise<WorkflowProfile | null>,
    create: (profile: WorkflowProfile) => invoke("workflows:create", profile) as Promise<WorkflowProfile>,
    update: (id: string, profile: WorkflowProfile) => invoke("workflows:update", id, profile) as Promise<WorkflowProfile>,
    delete: (id: string) => invoke("workflows:delete", id) as Promise<void>,
    clone: (id: string, nextId?: string) => invoke("workflows:clone", id, nextId) as Promise<WorkflowProfile>,
    export: (id: string) => invoke("workflows:export", id) as Promise<WorkflowProfile>,
    import: (profile: WorkflowProfile, options?: { allowOverwrite?: boolean }) =>
      invoke("workflows:import", profile, options) as Promise<WorkflowProfile>
  },
  scenarios: {
    list: () => invoke("scenario:list") as Promise<unknown[]>
  },
  /**
   * Optional semantic index (plan §11.1). Every method is authorized in the main process; the
   * renderer's own permission checks only decide what to render. `rebuild`, `clear` and
   * `updateSettings` additionally require a fresh re-authentication.
   *
   * `search` takes a structured request — there is deliberately no way to pass a query expression or
   * a filesystem path through this surface.
   */
  semantic: {
    getStatus: () => invoke("semantic:getStatus") as Promise<SemanticStatusView>,
    search: (request: SemanticSearchRequest) =>
      invoke("semantic:search", request) as Promise<SemanticSearchResponse>,
    similarFailures: (request: SimilarFailureRequest) =>
      invoke("semantic:similarFailures", request) as Promise<SemanticSearchResponse>,
    suggestLocators: (request: LocatorSuggestionRequest) =>
      invoke("semantic:suggestLocators", request) as Promise<SemanticSearchResponse>,
    rebuild: () => invoke("semantic:rebuild") as Promise<SemanticAdminResponse>,
    cancelRebuild: () => invoke("semantic:cancelRebuild") as Promise<SemanticAdminResponse>,
    clear: () => invoke("semantic:clear") as Promise<SemanticAdminResponse>,
    getSettings: () => invoke("semantic:getSettings") as Promise<SemanticSettingsView>,
    updateSettings: (patch: SemanticSettingsPatch) =>
      invoke("semantic:updateSettings", patch) as Promise<SemanticAdminResponse>
  },
  executions: {
    list: () => invoke("execution:list") as Promise<unknown[]>,
    validate: (workflowId: string) => invoke("execution:validate", workflowId) as Promise<unknown>,
    runWorkflow: (request: RunWorkflowRequest) => invoke("execution:runWorkflow", request) as Promise<unknown>,
    pauseInstance: (instanceId: string) => invoke("execution:pauseInstance", instanceId) as Promise<unknown>,
    resumeInstance: (instanceId: string) => invoke("execution:resumeInstance", instanceId) as Promise<unknown>,
    retryHandoff: (instanceId: string) => invoke("execution:retryHandoff", instanceId) as Promise<{ success: boolean; error?: string }>,
    stopInstance: (instanceId: string) => invoke("execution:stopInstance", instanceId) as Promise<unknown>,
    stopAll: () => invoke("execution:stopAll") as Promise<unknown>,
    removeInstance: (instanceId: string) => invoke("execution:removeInstance", instanceId) as Promise<{ success: boolean; error?: string }>,
    repeatInstance: (instanceId: string) => invoke("execution:repeatInstance", instanceId) as Promise<{ success: boolean; error?: string }>,
    runtimeStatus: () => invoke("execution:runtimeStatus") as Promise<RuntimeStatusSnapshot>,
    observationSnapshot: (instanceId: string) =>
      invoke("execution:observationSnapshot", instanceId) as Promise<CdpObservationSnapshot | undefined>,
    recoveryDetails: (instanceId: string) =>
      invoke("execution:recoveryDetails", instanceId) as Promise<{
        run?: DurableRunRecord;
        attempts: DurableAttemptRecord[];
        artifacts: DurableArtifactRecord[];
      }>,
    recoveryAction: (instanceId: string, action: "markReviewed" | "markAbandoned") =>
      invoke("execution:recoveryAction", instanceId, action) as Promise<{ success: boolean; error?: string }>
  },
  instances: {
    list: () => invoke("instances:list") as Promise<InstanceProfile[]>
  },
  dataSources: {
    list: () => invoke("dataSources:list") as Promise<JsonArrayDataSourceProfile[]>,
    get: (id: string) => invoke("dataSources:get", id) as Promise<JsonArrayDataSourceProfile | null>,
    create: (profile: JsonArrayDataSourceProfile) => invoke("dataSources:create", profile) as Promise<JsonArrayDataSourceProfile>,
    update: (id: string, profile: JsonArrayDataSourceProfile) => invoke("dataSources:update", id, profile) as Promise<JsonArrayDataSourceProfile>,
    delete: (id: string) => invoke("dataSources:delete", id) as Promise<void>,
    clone: (id: string, nextId?: string) => invoke("dataSources:clone", id, nextId) as Promise<JsonArrayDataSourceProfile>,
    export: (id: string) => invoke("dataSources:export", id) as Promise<JsonArrayDataSourceProfile>,
    import: (profile: JsonArrayDataSourceProfile) => invoke("dataSources:import", profile) as Promise<JsonArrayDataSourceProfile>,
    browseJson: (existingId?: string) => invoke("dataSources:browseJson", existingId) as Promise<unknown>,
    preview: (id: string, path?: string) => invoke("dataSources:preview", id, path) as Promise<unknown>,
    getJsonPaths: (id: string) => invoke("dataSources:getJsonPaths", id) as Promise<string[]>,
    readJson: (id: string) =>
      invoke("dataSources:readJson", id) as Promise<{
        profile: JsonArrayDataSourceProfile;
        rows: Record<string, unknown>[];
        editable: boolean;
        writable?: boolean;
        message?: string;
      }>,
    writeJson: (id: string, rows: Record<string, unknown>[]) =>
      invoke("dataSources:writeJson", id, rows) as Promise<JsonArrayDataSourceProfile>,
    createFromScratch: (payload: {
      id?: string;
      name: string;
      fileName: string;
      rows: Record<string, unknown>[];
      overwrite?: boolean;
    }) => invoke("dataSources:createFromScratch", payload) as Promise<JsonArrayDataSourceProfile>
  },
  runtimeInputs: {
    list: () => invoke("runtimeInputs:list") as Promise<RuntimeInputProfile[]>
  },
  reports: {
    list: () => invoke("report:list") as Promise<unknown[]>,
    get: (id: string) => invoke("reports:get", id) as Promise<unknown | null>,
    export: (id: string) => invoke("reports:export", id) as Promise<unknown>,
    openFolder: (id: string) => invoke("reports:openFolder", id) as Promise<string>
  },
  telemetry: {
    overview: (range?: TelemetryRangePreset) => invoke("telemetry:overview", range) as Promise<TelemetryOverview>,
    workflows: (range?: TelemetryRangePreset) => invoke("telemetry:workflows", range) as Promise<WorkflowReportRow[]>,
    workflowComparison: (range?: TelemetryRangePreset, machineFilter?: MachineFilter) =>
      invoke("telemetry:workflowComparison", range, machineFilter) as Promise<WorkflowComparisonRow[]>,
    workflowTrend: (scenarioId: string | undefined, range?: TelemetryRangePreset, machineFilter?: MachineFilter) =>
      invoke("telemetry:workflowTrend", scenarioId, range, machineFilter) as Promise<WorkflowTrend>,
    machines: (range?: TelemetryRangePreset) => invoke("telemetry:machines", range) as Promise<MachineSummary[]>,
    runHistory: (range?: TelemetryRangePreset, page?: TelemetryPage, filter?: RunHistoryFilter) =>
      invoke("telemetry:runHistory", range, page, filter) as Promise<RunHistoryPage>,
    runDetail: (instanceId: string) => invoke("telemetry:runDetail", instanceId) as Promise<RunDetail>,
    failures: (range?: TelemetryRangePreset) => invoke("telemetry:failures", range) as Promise<FailureBreakdown>,
    runtimeSeries: (range?: TelemetryRangePreset) => invoke("telemetry:runtimeSeries", range) as Promise<RuntimeSeriesPoint[]>,
    processHistory: (range?: TelemetryRangePreset, limit?: number) =>
      invoke("telemetry:processHistory", range, limit) as Promise<ProcessHistoryPoint[]>,
    server: () => invoke("telemetry:server") as Promise<ServerReport>,
    // Runtime Observability & Historical Analytics phase.
    capacityAnalytics: (range?: TelemetryRangePreset) => invoke("telemetry:capacityAnalytics", range) as Promise<CapacityAnalytics>,
    workflowHistoricalStats: (scenarioId: string | undefined, range?: TelemetryRangePreset, machineFilter?: MachineFilter) =>
      invoke("telemetry:workflowHistoricalStats", scenarioId, range, machineFilter) as Promise<WorkflowHistoricalStats>,
    workflowHistoricalTrend: (scenarioId: string | undefined, range?: TelemetryRangePreset, machineFilter?: MachineFilter) =>
      invoke("telemetry:workflowHistoricalTrend", scenarioId, range, machineFilter) as Promise<WorkflowHistoricalTrend>,
    runVsHistory: (instanceId: string, range?: TelemetryRangePreset) =>
      invoke("telemetry:runVsHistory", instanceId, range) as Promise<RunVsHistoryComparison | undefined>,
    workflowRankings: (range?: TelemetryRangePreset, metric?: WorkflowRankingMetric, limit?: number, machineFilter?: MachineFilter) =>
      invoke("telemetry:workflowRankings", range, metric, limit, machineFilter) as Promise<WorkflowRanking>,
    anomalies: (range?: TelemetryRangePreset, workflowId?: string, limit?: number) =>
      invoke("telemetry:anomalies", range, workflowId, limit) as Promise<AnomalyEvent[]>,
    observabilitySummary: () => invoke("telemetry:observabilitySummary") as Promise<RuntimeObservabilitySummary>
  },
  recorder: {
    // `ignoreHttpsErrors` is intentionally NOT a renderer-supplied option — the main process reads it
    // from the permission-gated Settings store at launch, so it cannot be forced from the renderer.
    start: (url: string, options?: { captureWaitTime?: boolean; captureSmartWaits?: boolean }) =>
      invoke("recorder:start", url, options) as Promise<RecorderStatus>,
    stop: () => invoke("recorder:stop") as Promise<import("@src/recorder/RecorderTypes").RecordedAction[]>,
    cancel: () => invoke("recorder:cancel") as Promise<{ success: boolean }>,
    getActions: () => invoke("recorder:getActions") as Promise<import("@src/recorder/RecorderTypes").RecordedAction[]>,
    clearActions: () => invoke("recorder:clearActions") as Promise<import("@src/recorder/RecorderTypes").RecordedAction[]>,
    deleteAction: (actionId: string) => invoke("recorder:deleteAction", actionId) as Promise<{
      actions: import("@src/recorder/RecorderTypes").RecordedAction[];
      removedIds: string[];
    }>,
    getStatus: () => invoke("recorder:getStatus") as Promise<RecorderStatus>,
    getUrls: () => invoke("recorder:getUrls") as Promise<import("@src/recorder/RecorderTypes").RecordedUrl[]>,
    saveUrl: (url: string) => invoke("recorder:saveUrl", url) as Promise<import("@src/recorder/RecorderTypes").RecordedUrl[]>,
    saveFlow: (name: string, actions: import("@src/recorder/RecorderTypes").RecordedAction[]) => invoke("recorder:saveFlow", name, actions) as Promise<FlowProfile>,
    // ── Protected login / popup manual handoff ───────────────────────────────
    getHandoff: () =>
      invoke("recorder:getHandoff") as Promise<import("@src/recorder/RecorderTypes").RecorderHandoffInfo | null>,
    continueWithNormalBrowser: () =>
      invoke("recorder:continueWithNormalBrowser") as Promise<import("@src/recorder/RecorderTypes").RecorderHandoffInfo>,
    captureSessionAndResume: (sessionName?: string) =>
      invoke("recorder:captureSessionAndResume", sessionName) as Promise<import("@src/recorder/RecorderTypes").RecorderHandoffInfo>,
    cancelHandoff: () => invoke("recorder:cancelHandoff") as Promise<{ success: boolean }>,
    // Session-level "Ignore and continue recording" for a false-positive protected detection.
    ignoreProtectedDetection: () =>
      invoke("recorder:ignoreProtectedDetection") as Promise<RecorderStatus>,
    // Ambiguity Resolution UX
    getAmbiguityState: () => 
      invoke("recorder:getAmbiguityState") as Promise<import("@src/recorder/RecorderTypes").AmbiguityState | null>,
    resolveAmbiguity: (choice: import("@src/recorder/RecorderTypes").AmbiguityResolutionChoice, payload?: import("@src/recorder/RecorderTypes").AmbiguityResolutionPayload) =>
      invoke("recorder:resolveAmbiguity", choice, payload) as Promise<{ success: boolean; error?: string }>,
    highlightCandidate: (candidateIndex?: number) =>
      invoke("recorder:highlightCandidate", candidateIndex) as Promise<{ success: boolean }>,
    clearHighlight: () =>
      invoke("recorder:clearHighlight") as Promise<{ success: boolean }>
  },
  secrets: {
    // Manage operator secrets by NAME only. `set` sends a plaintext value to be encrypted in the
    // main process; no channel ever returns a decrypted value (audit §15).
    isAvailable: () => invoke("secrets:isAvailable") as Promise<boolean>,
    list: () => invoke("secrets:list") as Promise<SecretSummary[]>,
    set: (name: string, value: string) => invoke("secrets:set", name, value) as Promise<SecretSummary[]>,
    delete: (name: string) => invoke("secrets:delete", name) as Promise<SecretSummary[]>
  },
  session: {
    list: () => invoke("session:list") as Promise<SessionProfile[]>,
    startCapture: (args: { name: string; targetUrl: string }) => invoke("session:startCapture", args) as Promise<SessionCaptureStatus>,
    getStatus: () => invoke("session:getStatus") as Promise<SessionCaptureStatus>,
    delete: (id: string) => invoke("session:delete", id) as Promise<void>,
    rename: (args: { id: string; newName: string }) => invoke("session:rename", args) as Promise<SessionProfile>,
    detectBrowser: () => invoke("session:detectBrowser") as Promise<DetectedBrowser>,
    stopCapture: () => invoke("session:stopCapture") as Promise<void>,
    getById: (id: string) => invoke("session:getById", id) as Promise<SessionProfile | null>,
    markUsed: (id: string) => invoke("session:markUsed", id) as Promise<void>
  },
  oracle: {
    // Oracle connection profiles. Renderer only ever receives credential-free views
    // (`hasPassword`/`hasTrustStoreSecret`) — passwords are stored by name in the encrypted secret
    // store and never returned.
    availability: () =>
      invoke("oracle:availability") as Promise<{ available: boolean; source: string; reason?: string; driverExpected: boolean }>,
    listProfiles: () => invoke("oracle:profiles:list") as Promise<OracleConnectionProfileView[]>,
    getProfile: (id: string) => invoke("oracle:profiles:get", id) as Promise<OracleConnectionProfileView | null>,
    saveProfile: (input: OracleProfileInput) => invoke("oracle:profiles:save", input) as Promise<OracleConnectionProfileView>,
    deleteProfile: (id: string) => invoke("oracle:profiles:delete", id) as Promise<void>,
    testProfile: (id: string) => invoke("oracle:profiles:test", id) as Promise<TestConnectionResult>,
    testDraft: (input: OracleProfileInput) => invoke("oracle:profiles:testDraft", input) as Promise<TestConnectionResult>,
    // Oracle Data Sources (runtime/snapshot). Profiles hold only a connection-profile reference, never
    // credentials; snapshot rows are normalized JSON stored for offline use.
    listDataSources: () => invoke("oracle:dataSources:list") as Promise<OracleDataSourceProfile[]>,
    getDataSource: (id: string) => invoke("oracle:dataSources:get", id) as Promise<OracleDataSourceProfile | null>,
    saveDataSource: (input: OracleDataSourceInput) => invoke("oracle:dataSources:save", input) as Promise<OracleDataSourceProfile>,
    deleteDataSource: (id: string) => invoke("oracle:dataSources:delete", id) as Promise<void>,
    refreshSnapshot: (id: string) => invoke("oracle:dataSources:refreshSnapshot", id) as Promise<OracleDataSourceProfile>,
    // Managed Oracle JDBC driver bundles (Settings). The renderer never receives JAR bytes — only
    // metadata/validation status. Import opens a native file dialog in the main process.
    drivers: {
      list: () => invoke("oracle:drivers:list") as Promise<OracleDriverBundleView[]>,
      get: (id: string) => invoke("oracle:drivers:get", id) as Promise<OracleDriverBundleView | null>,
      usage: (id: string) => invoke("oracle:drivers:usage", id) as Promise<number>,
      import: (input: { name: string }) => invoke("oracle:drivers:import", input) as Promise<OracleDriverBundleView | null>,
      validate: (id: string) => invoke("oracle:drivers:validate", id) as Promise<OracleDriverBundleView>,
      setDefault: (id: string) => invoke("oracle:drivers:setDefault", id) as Promise<void>,
      remove: (id: string) => invoke("oracle:drivers:remove", id) as Promise<void>,
      testLoad: (id: string) => invoke("oracle:drivers:testLoad", id) as Promise<DriverProbeResult>
    },
    // User-selected Java runtimes (Settings). Specter no longer bundles a JRE — the user selects an
    // installed java(.exe)/JRE/JDK. The renderer never receives executable bytes, only metadata; add
    // opens a native file/dir dialog in the main process.
    java: {
      list: () => invoke("oracle:java:list") as Promise<JavaRuntimeProfileView[]>,
      get: (id: string) => invoke("oracle:java:get", id) as Promise<JavaRuntimeProfileView | null>,
      usage: (id: string) => invoke("oracle:java:usage", id) as Promise<number>,
      addExecutable: (input: { name: string }) => invoke("oracle:java:addExe", input) as Promise<JavaRuntimeProfileView | null>,
      addDirectory: (input: { name: string }) => invoke("oracle:java:addDir", input) as Promise<JavaRuntimeProfileView | null>,
      validate: (id: string) => invoke("oracle:java:validate", id) as Promise<JavaRuntimeProfileView>,
      setDefault: (id: string) => invoke("oracle:java:setDefault", id) as Promise<void>,
      remove: (id: string) => invoke("oracle:java:remove", id) as Promise<void>,
      testBridge: (id: string, driverBundleId?: string) => invoke("oracle:java:testBridge", id, driverBundleId) as Promise<DriverProbeResult>
    }
  }
};

contextBridge.exposeInMainWorld("playwrightFlowStudio", api);

export type PlaywrightFlowStudioApi = typeof api;
