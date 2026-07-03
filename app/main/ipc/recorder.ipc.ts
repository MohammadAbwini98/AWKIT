import { ipcMain } from "electron";
import { join } from "node:path";
import { recorderService } from "@src/recorder/RecorderService";
import { BundledBrowserResolver } from "@src/offline/BundledBrowserResolver";
import { createFlowProfileStore } from "../profileStores";
import { getResourcesRoot, getRuntimeDataRoot, isProductionOffline } from "../appPaths";
import { buildRecordedFlow } from "@src/recorder/buildRecordedFlow";
import type { RecordedAction } from "@src/recorder/RecorderTypes";

export function registerRecorderIpc(): void {
  // Persist an unsaved recording (actions) to a draft under the runtime data folder so it survives an
  // app close and reloads on the Recorder page. Restore any leftover draft on startup. The reusable
  // saved-URL history is stored separately so it survives saving/cancelling a recording.
  recorderService.configureDraftStorage(join(getRuntimeDataRoot(), "recorder-draft.json"));
  recorderService.configureUrlStorage(join(getRuntimeDataRoot(), "recorder-urls.json"));
  void recorderService.ensureDraftLoaded();
  void recorderService.ensureUrlHistoryLoaded();

  ipcMain.handle("recorder:start", async (_, url: string, options?: { captureWaitTime?: boolean }) => {
    let executablePath: string | undefined;
    if (isProductionOffline()) {
      const bundled = new BundledBrowserResolver(getResourcesRoot()).resolveChromium();
      if (!bundled.exists) {
        throw new Error(`Bundled Chromium is required for offline recording: ${bundled.executablePath}`);
      }
      executablePath = bundled.executablePath;
      console.log(`[offline] Recorder using bundled Chromium: ${executablePath}`);
    }
    await recorderService.startRecording(url, { executablePath, captureWaitTime: options?.captureWaitTime ?? false });
    return recorderService.getStatus();
  });

  ipcMain.handle("recorder:stop", async () => {
    return await recorderService.stopRecording();
  });

  ipcMain.handle("recorder:cancel", async () => {
    await recorderService.cancelRecording();
    return { success: true };
  });

  ipcMain.handle("recorder:getActions", async () => {
    await recorderService.ensureDraftLoaded();
    return recorderService.getActions();
  });

  ipcMain.handle("recorder:getStatus", async () => {
    return recorderService.getStatus();
  });

  ipcMain.handle("recorder:getUrls", async () => {
    await recorderService.ensureUrlHistoryLoaded();
    return recorderService.getUrls();
  });

  ipcMain.handle("recorder:saveUrl", async (_, url: string) => {
    return await recorderService.saveUrl(url);
  });

  ipcMain.handle("recorder:saveFlow", async (_, name: string, actions: RecordedAction[]) => {
    const store = createFlowProfileStore();
    // Recorded flows always open with default Start/End nodes and the actions between them,
    // replaying recorded waits/tab-switches. Logic lives in a pure, unit-tested helper.
    const flowProfile = buildRecordedFlow(name, actions);
    await store.create(flowProfile);
    // The session is now persisted as a flow — clear the unsaved-recording draft.
    await recorderService.discardDraft();
    return flowProfile;
  });
}
