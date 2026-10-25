/**
 * The main process's runtime visual assertion services (Phase N, N6.4 / awkit-vra.15.4).
 *
 * The engine gets the build mode, the app version and a `VisualBaselineStore` for the CURRENT configured flows
 * folder, keyed by `getAppMode()` and protected by Electron `safeStorage` (`safeStorageVisualKeyProtector`). Nothing
 * here is reachable from the renderer: there is no IPC channel, and no key, digest or commitment leaves the store.
 */
import { app } from "electron";

import type { VisualAssertionServices } from "@src/runner/ExecutionEngine";
import { VisualBaselineStore } from "@src/runner/visualAssertion/VisualBaselineStore";
import { VisualBaselineLayout } from "@src/runner/visualAssertion/visualBaselineLayout";
import { getAppMode, getRuntimePaths } from "../appPaths";
import { createFlowProfileStore } from "../profileStores";
import { getConfiguredPaths } from "../storagePaths";
import { safeStorageVisualKeyProtector } from "./visualBaselineKeyProtector";

let cached: { flowsFolder: string; runtimeRoot: string; store: VisualBaselineStore } | undefined;

/** The store for the configured flows folder, rebuilt when Settings moved it. */
export function currentVisualBaselineStore(): VisualBaselineStore {
  const flowsFolder = getConfiguredPaths().flows;
  const runtimeRoot = getRuntimePaths().root;
  if (!cached || cached.flowsFolder !== flowsFolder || cached.runtimeRoot !== runtimeRoot) {
    const store = new VisualBaselineStore({
      layout: new VisualBaselineLayout({ flowsFolder, runtimeRoot }),
      appMode: getAppMode(),
      protector: safeStorageVisualKeyProtector,
      readFlow: (flowId) => createFlowProfileStore().get(flowId)
    });
    cached = { flowsFolder, runtimeRoot, store };
  }
  return cached.store;
}

/**
 * VA-5: at start-up every saved flow without an epoch token gets one, in one coordinated critical section, so flows
 * saved before N6 bind candidates exactly like flows written since (every write issues a token). Best effort: a
 * folder without cross-process coordination cannot hold baselines at all, and a capture still issues a missing token
 * inside the lane before any candidate binds it.
 */
export async function issueStartupEpochTokens(): Promise<number> {
  try {
    const flows = await createFlowProfileStore().list();
    return await currentVisualBaselineStore().layout.ensureTokensForFlows(flows.map((flow) => flow.id));
  } catch {
    return 0;
  }
}

export function visualAssertionServices(): VisualAssertionServices {
  return {
    appMode: getAppMode(),
    appVersion: app.getVersion(),
    store: () => {
      try {
        return currentVisualBaselineStore();
      } catch {
        return undefined;
      }
    }
  };
}
