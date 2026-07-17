import { join } from "node:path";

export const runtimeFolderNames = [
  "flows",
  "workflows",
  "scenarios",
  "instances",
  "data",
  "oracle-profiles",
  "oracle-drivers",
  "runtime-inputs",
  "storage",
  "downloads",
  "screenshots",
  "logs",
  "reports",
  "temp"
] as const;

export type RuntimeFolderName = (typeof runtimeFolderNames)[number];

export interface RuntimePaths {
  root: string;
  folders: Record<RuntimeFolderName, string>;
}

export function createRuntimePaths(root: string): RuntimePaths {
  return {
    root,
    folders: runtimeFolderNames.reduce(
      (paths, folder) => ({
        ...paths,
        [folder]: join(root, folder)
      }),
      {} as Record<RuntimeFolderName, string>
    )
  };
}
