import { join } from "node:path";
import { ensureRuntimeFolders, getResourcesRoot, getRuntimePaths, isProductionOffline } from "./appPaths";
import { OfflineRuntimeValidator } from "@src/offline/OfflineRuntimeValidator";

export async function getOfflineRuntimeStatus() {
  const runtimePaths = await ensureRuntimeFolders();
  const resourcesRoot = getResourcesRoot();
  const productionOffline = isProductionOffline();
  const allowRuntimeDownloads = process.env.ALLOW_RUNTIME_DOWNLOADS === "true";

  return new OfflineRuntimeValidator().validate({
    productionOffline,
    allowRuntimeDownloads,
    resourcesRoot,
    runtimePaths,
    manifestPath: join(resourcesRoot, "dependency-manifest.json")
  });
}
