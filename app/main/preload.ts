import { contextBridge, ipcRenderer } from "electron";
import type { JsonArrayDataSourceProfile } from "@src/data/DataSourceProfile";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import type { WorkflowProfile } from "@src/profiles/WorkflowProfile";
import type { OfflineRuntimeStatus } from "@src/offline/OfflineRuntimeValidator";
import type { RunWorkflowRequest } from "./ipc/execution.ipc";
import type { InstanceProfile, RuntimeInputProfile } from "./profileStores";
import type { DeepPartial, UiSettings } from "./uiSettings";
import type { SessionProfile, SessionCaptureStatus, DetectedBrowser } from "@src/session/SessionProfile";
import type { RuntimeStatusSnapshot } from "@src/runner/concurrency/RuntimeStatus";
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

const api = {
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
    server: () => ipcRenderer.invoke("telemetry:server") as Promise<ServerReport>
  },
  recorder: {
    start: (url: string, options?: { captureWaitTime?: boolean; captureSmartWaits?: boolean }) =>
      ipcRenderer.invoke("recorder:start", url, options) as Promise<{ isRecording: boolean; actionCount: number }>,
    stop: () => ipcRenderer.invoke("recorder:stop") as Promise<import("@src/recorder/RecorderTypes").RecordedAction[]>,
    cancel: () => ipcRenderer.invoke("recorder:cancel") as Promise<{ success: boolean }>,
    getActions: () => ipcRenderer.invoke("recorder:getActions") as Promise<import("@src/recorder/RecorderTypes").RecordedAction[]>,
    getStatus: () => ipcRenderer.invoke("recorder:getStatus") as Promise<{ isRecording: boolean; actionCount: number }>,
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
    cancelHandoff: () => ipcRenderer.invoke("recorder:cancelHandoff") as Promise<{ success: boolean }>
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
  }
};

contextBridge.exposeInMainWorld("playwrightFlowStudio", api);

export type PlaywrightFlowStudioApi = typeof api;
