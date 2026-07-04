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
