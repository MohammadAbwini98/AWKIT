import type { InstanceIsolationMode } from "./InstanceIsolationMode";

export interface InstanceConfig {
  id: string;
  name: string;
  browser: "chromium";
  headless: boolean;
  isolationMode: InstanceIsolationMode;
  baseUrl?: string;
  envFile?: string;
  storageState?: string;
  userDataDir?: string;
  /** When set, the execution IPC resolves this to the profile's `userDataDir` and forces `persistentContext` isolation. */
  sessionProfileId?: string;
  downloadsPath?: string;
  screenshotsPath?: string;
  logsPath?: string;
  timeoutMs: number;
  viewport: {
    width: number;
    height: number;
  };
}
