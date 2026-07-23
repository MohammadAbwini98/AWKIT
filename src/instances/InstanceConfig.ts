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
  /**
   * Effective certificate-trust decision for this instance, already resolved through the precedence
   * chain (run override → workflow → application setting → false) by the execution IPC. Carried on the
   * config so every context this instance creates — initial launch, retry, mid-run browser restart,
   * Reuse Session swap, parallel isolated contexts — inherits the same value. Absent = validate (false).
   */
  ignoreHttpsErrors?: boolean;
  /** Diagnostics only: which precedence tier supplied `ignoreHttpsErrors`. */
  ignoreHttpsErrorsSource?: "run" | "workflow" | "app" | "default";
}
