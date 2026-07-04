export interface InstanceResourcePolicy {
  exclusiveAccountKey?: string;
  storageStatePath?: string;
  userDataDir?: string;
  downloadsPath: string;
  screenshotsPath?: string;
  logsPath?: string;
  outputPaths?: string[];
}
