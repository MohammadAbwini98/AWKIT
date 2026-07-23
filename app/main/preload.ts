import { contextBridge, ipcRenderer } from "electron";
import type { JsonArrayDataSourceProfile } from "@src/data/DataSourceProfile";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import type { WorkflowProfile } from "@src/profiles/WorkflowProfile";
import type { OfflineRuntimeStatus } from "@src/offline/OfflineRuntimeValidator";
import type { RunWorkflowRequest } from "./ipc/execution.ipc";
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
import type { AuditRecord } from "@src/security/store/SecurityStoreSchema";
import type { ActivationRequest, LicenseDocument } from "@src/licensing/LicenseTypes";
import type { LicenseStatusReport, ImportOutcome } from "@src/licensing/LicenseService";
import type { RuntimeStatusSnapshot } from "@src/runner/concurrency/RuntimeStatus";

/** Uniform admin IPC response shape (success carries `value`; failure carries a safe `reason`). */
type AdminResponse<T> = { ok: boolean; value?: T; reason?: string; errors?: string[] };
/** A built-in role as projected to the renderer's Roles view. */
interface RoleView {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  permissions: string[];
}
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
};

const api = {
  // Custom application-frame window controls. Deliberately minimal: the renderer can only drive
  // these passive window operations and observe the maximized state — no BrowserWindow, no ipcRenderer.
  appWindow: {
    minimize: () => ipcRenderer.invoke("window:minimize") as Promise<void>,
    toggleMaximize: () => ipcRenderer.invoke("window:toggleMaximize") as Promise<boolean>,
    close: () => ipcRenderer.invoke("window:close") as Promise<void>,
    isMaximized: () => ipcRenderer.invoke("window:isMaximized") as Promise<boolean>,
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
    openPath: (path: string) => ipcRenderer.invoke("system:openPath", path) as Promise<string>,
    browseFolder: (defaultPath?: string) => ipcRenderer.invoke("system:browseFolder", defaultPath) as Promise<string | null>,
    capacityPreview: (workloadClass?: WorkloadClass) =>
      ipcRenderer.invoke("system:capacityPreview", workloadClass) as Promise<CapacityPreview>
  },
  auth: {
    getCapabilities: () =>
      ipcRenderer.invoke("auth:getCapabilities") as Promise<{
        oauthConfigured: boolean;
        loadSessionSupported: boolean;
        testSessionSupported: boolean;
        reasons: { oauth: string; savedSession: string; testSession: string };
      }>,
    openOAuth: (provider: string) => ipcRenderer.invoke("auth:openOAuth", provider) as Promise<{ success: boolean; error?: string }>,
    openExternal: (url: string) => ipcRenderer.invoke("auth:openExternal", url) as Promise<{ success: boolean; error?: string }>
  },
  offlineRuntime: {
    getStatus: () => ipcRenderer.invoke("offlineRuntime:getStatus") as Promise<OfflineRuntimeStatus>
  },
  // App identity: local virtual-user authentication (distinct from the automation `auth`/`session`
  // namespaces above, which are for browser-login handoff). The renderer only ever receives a
  // PrincipalSnapshot (UI hint) or a safe reason code — never password material or hashes. All
  // decisions happen in the main process; this bridge is invoke-only.
  security: {
    getBootState: () =>
      ipcRenderer.invoke("security:getBootState") as Promise<{
        provisioned: boolean;
        secureStorageAvailable: boolean;
        idleTimeoutMs?: number;
      }>,
    getLoginOptions: () => ipcRenderer.invoke("security:getLoginOptions") as Promise<LoginOption[]>,
    bootstrapSuperUser: (input: { username: string; password: string; displayName?: string }) =>
      ipcRenderer.invoke("security:bootstrapSuperUser", input) as Promise<{ ok: boolean; reason?: string; errors?: string[] }>,
    login: (request: { providerId: ProviderId; username: string; password: string }) =>
      ipcRenderer.invoke("security:login", request) as Promise<LoginResult>,
    validateSession: (sessionRef: string) =>
      ipcRenderer.invoke("security:validateSession", sessionRef) as Promise<SessionValidationResult>,
    logout: (sessionRef: string) => ipcRenderer.invoke("security:logout", sessionRef) as Promise<void>,
    changePassword: (input: { sessionRef: string; currentPassword: string; newPassword: string }) =>
      ipcRenderer.invoke("security:changePassword", input) as Promise<{ ok: boolean; reason?: string; errors?: string[] }>,
    reauth: (input: { sessionRef: string; password: string }) =>
      ipcRenderer.invoke("security:reauth", input) as Promise<{ ok: boolean; reason?: string }>,
    admin: {
      listUsers: (sessionRef: string) =>
        ipcRenderer.invoke("security:admin:listUsers", { sessionRef }) as Promise<AdminResponse<AdminUserView[]>>,
      createUser: (input: { sessionRef: string; username: string; password: string; displayName?: string; roles: string[] }) =>
        ipcRenderer.invoke("security:admin:createUser", input) as Promise<AdminResponse<AdminUserView>>,
      updateUser: (input: { sessionRef: string; userId: string; displayName?: string; roles?: string[] }) =>
        ipcRenderer.invoke("security:admin:updateUser", input) as Promise<AdminResponse<AdminUserView>>,
      setStatus: (input: { sessionRef: string; userId: string; status: "active" | "disabled" | "archived" }) =>
        ipcRenderer.invoke("security:admin:setStatus", input) as Promise<AdminResponse<AdminUserView>>,
      resetPassword: (input: { sessionRef: string; userId: string; newPassword: string }) =>
        ipcRenderer.invoke("security:admin:resetPassword", input) as Promise<AdminResponse<undefined>>,
      revokeSessions: (input: { sessionRef: string; userId: string }) =>
        ipcRenderer.invoke("security:admin:revokeSessions", input) as Promise<AdminResponse<undefined>>,
      listRoles: (sessionRef: string) =>
        ipcRenderer.invoke("security:admin:listRoles", { sessionRef }) as Promise<AdminResponse<RoleView[]>>,
      listAudit: (input: { sessionRef: string; limit?: number; offset?: number }) =>
        ipcRenderer.invoke("security:admin:listAudit", input) as Promise<AdminResponse<AuditRecord[]>>
    }
  },
  licensing: {
    getStatus: (sessionRef: string) =>
      ipcRenderer.invoke("licensing:getStatus", sessionRef) as Promise<AdminResponse<LicenseStatusReport>>,
    revalidate: (sessionRef: string) =>
      ipcRenderer.invoke("licensing:revalidate", sessionRef) as Promise<AdminResponse<LicenseStatusReport>>,
    exportRequest: (sessionRef: string) =>
      ipcRenderer.invoke("licensing:exportRequest", sessionRef) as Promise<AdminResponse<ActivationRequest>>,
    import: (input: { sessionRef: string; license: LicenseDocument }) =>
      ipcRenderer.invoke("licensing:import", input) as Promise<AdminResponse<ImportOutcome>>,
    replace: (input: { sessionRef: string; license: LicenseDocument }) =>
      ipcRenderer.invoke("licensing:replace", input) as Promise<AdminResponse<ImportOutcome>>,
    revoke: (sessionRef: string) =>
      ipcRenderer.invoke("licensing:revoke", sessionRef) as Promise<AdminResponse<{ ok: boolean; status: LicenseStatusReport; reason?: string }>>,
    remove: (sessionRef: string) =>
      ipcRenderer.invoke("licensing:remove", sessionRef) as Promise<AdminResponse<{ ok: boolean; status: LicenseStatusReport }>>
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get") as Promise<UiSettings>,
    update: (patch: DeepPartial<UiSettings>) => ipcRenderer.invoke("settings:update", patch) as Promise<UiSettings>,
    reset: () => ipcRenderer.invoke("settings:reset") as Promise<UiSettings>,
    clearUiState: () => ipcRenderer.invoke("settings:clearUiState") as Promise<UiSettings>,
    export: () => ipcRenderer.invoke("settings:export") as Promise<UiSettings>,
    import: (incoming: unknown) => ipcRenderer.invoke("settings:import", incoming) as Promise<UiSettings>,
    validate: () => ipcRenderer.invoke("settings:validate") as Promise<string[]>,
    getDefaultPaths: () => ipcRenderer.invoke("settings:getDefaultPaths") as Promise<Record<string, string>>,
    validatePaths: () =>
      ipcRenderer.invoke("settings:validatePaths") as Promise<
        Record<string, { path: string; exists: boolean; writable: boolean }>
      >,
    openRuntimeFolder: () => ipcRenderer.invoke("settings:openRuntimeFolder") as Promise<string>,
    getStorageStats: () =>
      ipcRenderer.invoke("settings:getStorageStats") as Promise<{
        appVersion: string;
        runtimeDataRoot: string;
        productionOffline: boolean;
        flows: number;
        workflows: number;
        dataSources: number;
        reports: number;
      }>
  },
  flows: {
    list: () => ipcRenderer.invoke("flows:list") as Promise<FlowProfile[]>,
    get: (id: string) => ipcRenderer.invoke("flows:get", id) as Promise<FlowProfile | null>,
    create: (profile: FlowProfile) => ipcRenderer.invoke("flows:create", profile) as Promise<FlowProfile>,
    update: (id: string, profile: FlowProfile) => ipcRenderer.invoke("flows:update", id, profile) as Promise<FlowProfile>,
    delete: (id: string) => ipcRenderer.invoke("flows:delete", id) as Promise<void>,
    clone: (id: string, nextId?: string) => ipcRenderer.invoke("flows:clone", id, nextId) as Promise<FlowProfile>,
    export: (id: string) => ipcRenderer.invoke("flows:export", id) as Promise<FlowProfile>,
    import: (profile: FlowProfile) => ipcRenderer.invoke("flows:import", profile) as Promise<FlowProfile>
  },
  workflows: {
    list: () => ipcRenderer.invoke("workflows:list") as Promise<WorkflowProfile[]>,
    get: (id: string) => ipcRenderer.invoke("workflows:get", id) as Promise<WorkflowProfile | null>,
    create: (profile: WorkflowProfile) => ipcRenderer.invoke("workflows:create", profile) as Promise<WorkflowProfile>,
    update: (id: string, profile: WorkflowProfile) => ipcRenderer.invoke("workflows:update", id, profile) as Promise<WorkflowProfile>,
    delete: (id: string) => ipcRenderer.invoke("workflows:delete", id) as Promise<void>,
    clone: (id: string, nextId?: string) => ipcRenderer.invoke("workflows:clone", id, nextId) as Promise<WorkflowProfile>,
    export: (id: string) => ipcRenderer.invoke("workflows:export", id) as Promise<WorkflowProfile>,
    import: (profile: WorkflowProfile) => ipcRenderer.invoke("workflows:import", profile) as Promise<WorkflowProfile>
  },
  scenarios: {
    list: () => ipcRenderer.invoke("scenario:list") as Promise<unknown[]>
  },
  executions: {
    list: () => ipcRenderer.invoke("execution:list") as Promise<unknown[]>,
    validate: (workflowId: string) => ipcRenderer.invoke("execution:validate", workflowId) as Promise<unknown>,
    runWorkflow: (request: RunWorkflowRequest) => ipcRenderer.invoke("execution:runWorkflow", request) as Promise<unknown>,
    pauseInstance: (instanceId: string) => ipcRenderer.invoke("execution:pauseInstance", instanceId) as Promise<unknown>,
    resumeInstance: (instanceId: string) => ipcRenderer.invoke("execution:resumeInstance", instanceId) as Promise<unknown>,
    retryHandoff: (instanceId: string) => ipcRenderer.invoke("execution:retryHandoff", instanceId) as Promise<{ success: boolean; error?: string }>,
    stopInstance: (instanceId: string) => ipcRenderer.invoke("execution:stopInstance", instanceId) as Promise<unknown>,
    stopAll: () => ipcRenderer.invoke("execution:stopAll") as Promise<unknown>,
    removeInstance: (instanceId: string) => ipcRenderer.invoke("execution:removeInstance", instanceId) as Promise<{ success: boolean; error?: string }>,
    repeatInstance: (instanceId: string) => ipcRenderer.invoke("execution:repeatInstance", instanceId) as Promise<{ success: boolean; error?: string }>,
    runtimeStatus: () => ipcRenderer.invoke("execution:runtimeStatus") as Promise<RuntimeStatusSnapshot>,
    recoveryDetails: (instanceId: string) =>
      ipcRenderer.invoke("execution:recoveryDetails", instanceId) as Promise<{
        run?: DurableRunRecord;
        attempts: DurableAttemptRecord[];
        artifacts: DurableArtifactRecord[];
      }>,
    recoveryAction: (instanceId: string, action: "markReviewed" | "markAbandoned") =>
      ipcRenderer.invoke("execution:recoveryAction", instanceId, action) as Promise<{ success: boolean; error?: string }>
  },
  instances: {
    list: () => ipcRenderer.invoke("instances:list") as Promise<InstanceProfile[]>
  },
  dataSources: {
    list: () => ipcRenderer.invoke("dataSources:list") as Promise<JsonArrayDataSourceProfile[]>,
    get: (id: string) => ipcRenderer.invoke("dataSources:get", id) as Promise<JsonArrayDataSourceProfile | null>,
    create: (profile: JsonArrayDataSourceProfile) => ipcRenderer.invoke("dataSources:create", profile) as Promise<JsonArrayDataSourceProfile>,
    update: (id: string, profile: JsonArrayDataSourceProfile) => ipcRenderer.invoke("dataSources:update", id, profile) as Promise<JsonArrayDataSourceProfile>,
    delete: (id: string) => ipcRenderer.invoke("dataSources:delete", id) as Promise<void>,
    clone: (id: string, nextId?: string) => ipcRenderer.invoke("dataSources:clone", id, nextId) as Promise<JsonArrayDataSourceProfile>,
    export: (id: string) => ipcRenderer.invoke("dataSources:export", id) as Promise<JsonArrayDataSourceProfile>,
    import: (profile: JsonArrayDataSourceProfile) => ipcRenderer.invoke("dataSources:import", profile) as Promise<JsonArrayDataSourceProfile>,
    browseJson: (existingId?: string) => ipcRenderer.invoke("dataSources:browseJson", existingId) as Promise<unknown>,
    preview: (id: string, path?: string) => ipcRenderer.invoke("dataSources:preview", id, path) as Promise<unknown>,
    getJsonPaths: (id: string) => ipcRenderer.invoke("dataSources:getJsonPaths", id) as Promise<string[]>,
    readJson: (id: string) =>
      ipcRenderer.invoke("dataSources:readJson", id) as Promise<{
        profile: JsonArrayDataSourceProfile;
        rows: Record<string, unknown>[];
        editable: boolean;
        writable?: boolean;
        message?: string;
      }>,
    writeJson: (id: string, rows: Record<string, unknown>[]) =>
      ipcRenderer.invoke("dataSources:writeJson", id, rows) as Promise<JsonArrayDataSourceProfile>,
    createFromScratch: (payload: {
      id?: string;
      name: string;
      fileName: string;
      rows: Record<string, unknown>[];
      overwrite?: boolean;
    }) => ipcRenderer.invoke("dataSources:createFromScratch", payload) as Promise<JsonArrayDataSourceProfile>
  },
  runtimeInputs: {
    list: () => ipcRenderer.invoke("runtimeInputs:list") as Promise<RuntimeInputProfile[]>
  },
  reports: {
    list: () => ipcRenderer.invoke("report:list") as Promise<unknown[]>,
    get: (id: string) => ipcRenderer.invoke("reports:get", id) as Promise<unknown | null>
  },
  telemetry: {
    overview: (range?: TelemetryRangePreset) => ipcRenderer.invoke("telemetry:overview", range) as Promise<TelemetryOverview>,
    workflows: (range?: TelemetryRangePreset) => ipcRenderer.invoke("telemetry:workflows", range) as Promise<WorkflowReportRow[]>,
    workflowComparison: (range?: TelemetryRangePreset, machineFilter?: MachineFilter) =>
      ipcRenderer.invoke("telemetry:workflowComparison", range, machineFilter) as Promise<WorkflowComparisonRow[]>,
    workflowTrend: (scenarioId: string | undefined, range?: TelemetryRangePreset, machineFilter?: MachineFilter) =>
      ipcRenderer.invoke("telemetry:workflowTrend", scenarioId, range, machineFilter) as Promise<WorkflowTrend>,
    machines: (range?: TelemetryRangePreset) => ipcRenderer.invoke("telemetry:machines", range) as Promise<MachineSummary[]>,
    runHistory: (range?: TelemetryRangePreset, page?: TelemetryPage, filter?: RunHistoryFilter) =>
      ipcRenderer.invoke("telemetry:runHistory", range, page, filter) as Promise<RunHistoryPage>,
    runDetail: (instanceId: string) => ipcRenderer.invoke("telemetry:runDetail", instanceId) as Promise<RunDetail>,
    failures: (range?: TelemetryRangePreset) => ipcRenderer.invoke("telemetry:failures", range) as Promise<FailureBreakdown>,
    runtimeSeries: (range?: TelemetryRangePreset) => ipcRenderer.invoke("telemetry:runtimeSeries", range) as Promise<RuntimeSeriesPoint[]>,
    processHistory: (range?: TelemetryRangePreset, limit?: number) =>
      ipcRenderer.invoke("telemetry:processHistory", range, limit) as Promise<ProcessHistoryPoint[]>,
    server: () => ipcRenderer.invoke("telemetry:server") as Promise<ServerReport>,
    // Runtime Observability & Historical Analytics phase.
    capacityAnalytics: (range?: TelemetryRangePreset) => ipcRenderer.invoke("telemetry:capacityAnalytics", range) as Promise<CapacityAnalytics>,
    workflowHistoricalStats: (scenarioId: string | undefined, range?: TelemetryRangePreset, machineFilter?: MachineFilter) =>
      ipcRenderer.invoke("telemetry:workflowHistoricalStats", scenarioId, range, machineFilter) as Promise<WorkflowHistoricalStats>,
    workflowHistoricalTrend: (scenarioId: string | undefined, range?: TelemetryRangePreset, machineFilter?: MachineFilter) =>
      ipcRenderer.invoke("telemetry:workflowHistoricalTrend", scenarioId, range, machineFilter) as Promise<WorkflowHistoricalTrend>,
    runVsHistory: (instanceId: string, range?: TelemetryRangePreset) =>
      ipcRenderer.invoke("telemetry:runVsHistory", instanceId, range) as Promise<RunVsHistoryComparison | undefined>,
    workflowRankings: (range?: TelemetryRangePreset, metric?: WorkflowRankingMetric, limit?: number, machineFilter?: MachineFilter) =>
      ipcRenderer.invoke("telemetry:workflowRankings", range, metric, limit, machineFilter) as Promise<WorkflowRanking>,
    anomalies: (range?: TelemetryRangePreset, workflowId?: string, limit?: number) =>
      ipcRenderer.invoke("telemetry:anomalies", range, workflowId, limit) as Promise<AnomalyEvent[]>,
    observabilitySummary: () => ipcRenderer.invoke("telemetry:observabilitySummary") as Promise<RuntimeObservabilitySummary>
  },
  recorder: {
    // `ignoreHttpsErrors` is intentionally NOT a renderer-supplied option — the main process reads it
    // from the permission-gated Settings store at launch, so it cannot be forced from the renderer.
    start: (url: string, options?: { captureWaitTime?: boolean; captureSmartWaits?: boolean }) =>
      ipcRenderer.invoke("recorder:start", url, options) as Promise<RecorderStatus>,
    stop: () => ipcRenderer.invoke("recorder:stop") as Promise<import("@src/recorder/RecorderTypes").RecordedAction[]>,
    cancel: () => ipcRenderer.invoke("recorder:cancel") as Promise<{ success: boolean }>,
    getActions: () => ipcRenderer.invoke("recorder:getActions") as Promise<import("@src/recorder/RecorderTypes").RecordedAction[]>,
    getStatus: () => ipcRenderer.invoke("recorder:getStatus") as Promise<RecorderStatus>,
    getUrls: () => ipcRenderer.invoke("recorder:getUrls") as Promise<import("@src/recorder/RecorderTypes").RecordedUrl[]>,
    saveUrl: (url: string) => ipcRenderer.invoke("recorder:saveUrl", url) as Promise<import("@src/recorder/RecorderTypes").RecordedUrl[]>,
    saveFlow: (name: string, actions: import("@src/recorder/RecorderTypes").RecordedAction[]) => ipcRenderer.invoke("recorder:saveFlow", name, actions) as Promise<FlowProfile>,
    // ── Protected login / popup manual handoff ───────────────────────────────
    getHandoff: () =>
      ipcRenderer.invoke("recorder:getHandoff") as Promise<import("@src/recorder/RecorderTypes").RecorderHandoffInfo | null>,
    continueWithNormalBrowser: () =>
      ipcRenderer.invoke("recorder:continueWithNormalBrowser") as Promise<import("@src/recorder/RecorderTypes").RecorderHandoffInfo>,
    captureSessionAndResume: (sessionName?: string) =>
      ipcRenderer.invoke("recorder:captureSessionAndResume", sessionName) as Promise<import("@src/recorder/RecorderTypes").RecorderHandoffInfo>,
    cancelHandoff: () => ipcRenderer.invoke("recorder:cancelHandoff") as Promise<{ success: boolean }>,
    // Session-level "Ignore and continue recording" for a false-positive protected detection.
    ignoreProtectedDetection: () =>
      ipcRenderer.invoke("recorder:ignoreProtectedDetection") as Promise<RecorderStatus>
  },
  secrets: {
    // Manage operator secrets by NAME only. `set` sends a plaintext value to be encrypted in the
    // main process; no channel ever returns a decrypted value (audit §15).
    isAvailable: () => ipcRenderer.invoke("secrets:isAvailable") as Promise<boolean>,
    list: () => ipcRenderer.invoke("secrets:list") as Promise<SecretSummary[]>,
    set: (name: string, value: string) => ipcRenderer.invoke("secrets:set", name, value) as Promise<SecretSummary[]>,
    delete: (name: string) => ipcRenderer.invoke("secrets:delete", name) as Promise<SecretSummary[]>
  },
  session: {
    list: () => ipcRenderer.invoke("session:list") as Promise<SessionProfile[]>,
    startCapture: (args: { name: string; targetUrl: string }) => ipcRenderer.invoke("session:startCapture", args) as Promise<SessionCaptureStatus>,
    getStatus: () => ipcRenderer.invoke("session:getStatus") as Promise<SessionCaptureStatus>,
    delete: (id: string) => ipcRenderer.invoke("session:delete", id) as Promise<void>,
    rename: (args: { id: string; newName: string }) => ipcRenderer.invoke("session:rename", args) as Promise<SessionProfile>,
    detectBrowser: () => ipcRenderer.invoke("session:detectBrowser") as Promise<DetectedBrowser>,
    stopCapture: () => ipcRenderer.invoke("session:stopCapture") as Promise<void>,
    getById: (id: string) => ipcRenderer.invoke("session:getById", id) as Promise<SessionProfile | null>,
    markUsed: (id: string) => ipcRenderer.invoke("session:markUsed", id) as Promise<void>
  },
  oracle: {
    // Oracle connection profiles. Renderer only ever receives credential-free views
    // (`hasPassword`/`hasTrustStoreSecret`) — passwords are stored by name in the encrypted secret
    // store and never returned.
    availability: () =>
      ipcRenderer.invoke("oracle:availability") as Promise<{ available: boolean; source: string; reason?: string; driverExpected: boolean }>,
    listProfiles: () => ipcRenderer.invoke("oracle:profiles:list") as Promise<OracleConnectionProfileView[]>,
    getProfile: (id: string) => ipcRenderer.invoke("oracle:profiles:get", id) as Promise<OracleConnectionProfileView | null>,
    saveProfile: (input: OracleProfileInput) => ipcRenderer.invoke("oracle:profiles:save", input) as Promise<OracleConnectionProfileView>,
    deleteProfile: (id: string) => ipcRenderer.invoke("oracle:profiles:delete", id) as Promise<void>,
    testProfile: (id: string) => ipcRenderer.invoke("oracle:profiles:test", id) as Promise<TestConnectionResult>,
    testDraft: (input: OracleProfileInput) => ipcRenderer.invoke("oracle:profiles:testDraft", input) as Promise<TestConnectionResult>,
    // Oracle Data Sources (runtime/snapshot). Profiles hold only a connection-profile reference, never
    // credentials; snapshot rows are normalized JSON stored for offline use.
    listDataSources: () => ipcRenderer.invoke("oracle:dataSources:list") as Promise<OracleDataSourceProfile[]>,
    getDataSource: (id: string) => ipcRenderer.invoke("oracle:dataSources:get", id) as Promise<OracleDataSourceProfile | null>,
    saveDataSource: (input: OracleDataSourceInput) => ipcRenderer.invoke("oracle:dataSources:save", input) as Promise<OracleDataSourceProfile>,
    deleteDataSource: (id: string) => ipcRenderer.invoke("oracle:dataSources:delete", id) as Promise<void>,
    refreshSnapshot: (id: string) => ipcRenderer.invoke("oracle:dataSources:refreshSnapshot", id) as Promise<OracleDataSourceProfile>,
    // Managed Oracle JDBC driver bundles (Settings). The renderer never receives JAR bytes — only
    // metadata/validation status. Import opens a native file dialog in the main process.
    drivers: {
      list: () => ipcRenderer.invoke("oracle:drivers:list") as Promise<OracleDriverBundleView[]>,
      get: (id: string) => ipcRenderer.invoke("oracle:drivers:get", id) as Promise<OracleDriverBundleView | null>,
      usage: (id: string) => ipcRenderer.invoke("oracle:drivers:usage", id) as Promise<number>,
      import: (input: { name: string }) => ipcRenderer.invoke("oracle:drivers:import", input) as Promise<OracleDriverBundleView | null>,
      validate: (id: string) => ipcRenderer.invoke("oracle:drivers:validate", id) as Promise<OracleDriverBundleView>,
      setDefault: (id: string) => ipcRenderer.invoke("oracle:drivers:setDefault", id) as Promise<void>,
      remove: (id: string) => ipcRenderer.invoke("oracle:drivers:remove", id) as Promise<void>,
      testLoad: (id: string) => ipcRenderer.invoke("oracle:drivers:testLoad", id) as Promise<DriverProbeResult>
    },
    // User-selected Java runtimes (Settings). Specter no longer bundles a JRE — the user selects an
    // installed java(.exe)/JRE/JDK. The renderer never receives executable bytes, only metadata; add
    // opens a native file/dir dialog in the main process.
    java: {
      list: () => ipcRenderer.invoke("oracle:java:list") as Promise<JavaRuntimeProfileView[]>,
      get: (id: string) => ipcRenderer.invoke("oracle:java:get", id) as Promise<JavaRuntimeProfileView | null>,
      usage: (id: string) => ipcRenderer.invoke("oracle:java:usage", id) as Promise<number>,
      addExecutable: (input: { name: string }) => ipcRenderer.invoke("oracle:java:addExe", input) as Promise<JavaRuntimeProfileView | null>,
      addDirectory: (input: { name: string }) => ipcRenderer.invoke("oracle:java:addDir", input) as Promise<JavaRuntimeProfileView | null>,
      validate: (id: string) => ipcRenderer.invoke("oracle:java:validate", id) as Promise<JavaRuntimeProfileView>,
      setDefault: (id: string) => ipcRenderer.invoke("oracle:java:setDefault", id) as Promise<void>,
      remove: (id: string) => ipcRenderer.invoke("oracle:java:remove", id) as Promise<void>,
      testBridge: (id: string, driverBundleId?: string) => ipcRenderer.invoke("oracle:java:testBridge", id, driverBundleId) as Promise<DriverProbeResult>
    }
  }
};

contextBridge.exposeInMainWorld("playwrightFlowStudio", api);

export type PlaywrightFlowStudioApi = typeof api;
