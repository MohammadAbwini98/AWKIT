import { getConfiguredPaths } from "./storagePaths";
import { DebugLogService } from "@src/logging/DebugLogService";

export * from "@src/logging/DebugLogService";

let singleton: DebugLogService | null = null;

export function getDebugLogService(): DebugLogService {
  singleton ??= new DebugLogService(() => getConfiguredPaths().logs);
  return singleton;
}

