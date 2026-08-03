import type { JsonArrayDataSourceProfile } from "@src/data/DataSourceProfile";
import type { InstanceConfig } from "./InstanceConfig";
import type { InstanceIsolationMode } from "./InstanceIsolationMode";

export type ConcurrentRunMode = "single" | "fixedConcurrent" | "dataDrivenConcurrent" | "multipleScenarios";

export type BrowserWindowMode = "tile" | "cascade" | "minimize" | "activeOnly" | "headless";

export interface ConcurrentRunProfile {
  id: string;
  scenarioId: string;
  runMode: ConcurrentRunMode;
  maxConcurrentInstances: number;
  browserWindowMode: BrowserWindowMode;
  dataSource?: JsonArrayDataSourceProfile;
  instanceTemplate: Partial<InstanceConfig> & {
    browser: "chromium";
    headless: boolean;
    isolationMode: InstanceIsolationMode;
  };
  /**
   * Legacy Compatibility grants that admitted this run, snapshotted by the run gate at admission
   * (awkit-vbj). Run-level rather than per-instance: the exemption applies to the workflow's flows,
   * not to a browser context. Carried so the execution report can attribute the run; absent when no
   * grant was involved.
   */
  legacyCompatibility?: {
    flows: Array<{ flowId: string; flowName?: string; expiresAt?: string }>;
  };
  resourceControls: {
    maxBrowserContextsPerProcess: number;
    delayBetweenInstanceStartsMs: number;
  };
  failurePolicy: {
    stopAllOnCriticalFailure: boolean;
    continueOtherInstancesOnFailure: boolean;
    retryFailedInstance: boolean;
    retryCount: number;
  };
}
