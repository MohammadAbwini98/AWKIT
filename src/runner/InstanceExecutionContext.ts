/** A data source whose rows have been resolved for runtime value binding. */
export interface ResolvedDataSource {
  id: string;
  name: string;
  file: string;
  rootArrayPath: string;
  rows: unknown[];
}

export interface InstanceExecutionContext {
  executionId: string;
  instanceId: string;
  scenarioId: string;
  flowId?: string;
  stepId?: string;
  /** 1-based order of this instance within the run (instance #1 → 1). Stable for the whole run. */
  instanceOrderNumber: number;
  /** Total number of instances planned for this run. */
  totalInstances: number;
  runtimeInputs: Record<string, unknown>;
  instanceInputs: Record<string, unknown>;
  currentRow?: unknown;
  jsonData?: Record<string, unknown>;
  /** Data source bound to the workflow (used by dynamic value sources with scope = workflow). */
  workflowDataSource?: ResolvedDataSource;
  /** Specific data sources keyed by id (used by dynamic value sources with scope = specific). */
  dataSources?: Record<string, ResolvedDataSource>;
  flowOutputs: Record<string, unknown>;
  /**
   * Named secrets resolved from the encrypted local secret store (audit §15). Populated by the
   * main process at run start for the secret names a flow references; never persisted or logged.
   */
  secrets?: Record<string, string>;
  paths: {
    downloads: string;
    screenshots: string;
    logs: string;
    reports: string;
    /** Stable folder for saved browser sessions (Save Session node). */
    sessions?: string;
    /** Per-run trace output dir — presence of this path is what arms failure-trace capture. */
    traces?: string;
    /**
     * Extra roots that `uploadFile` must never read from (audit F-01) — e.g. the global runtime
     * data root that holds captured browser profiles (cookies/Login Data) and the durable store.
     * Blocked in addition to the sessions/logs/reports/screenshots/traces dirs above.
     */
    protectedUploadRoots?: string[];
  };
}
