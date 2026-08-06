import { ipcMain } from "electron";
import { join } from "node:path";
import { recorderService } from "@src/recorder/RecorderService";
import { BundledBrowserResolver } from "@src/offline/BundledBrowserResolver";
import { createFlowProfileStore } from "../profileStores";
import { getResourcesRoot, getRuntimeDataRoot, getRuntimePaths, isProductionOffline } from "../appPaths";
import { buildRecordedFlow } from "@src/recorder/buildRecordedFlow";
import type { RecordedAction } from "@src/recorder/RecorderTypes";
import { FileLocatorBlueprintStore, type PageBlueprint } from "@src/runner/LocatorBlueprintStore";
import { getSessionService } from "./session.ipc";
import { getUiSettings } from "../uiSettings";
import { resolveIgnoreHttpsErrors } from "@src/security/browser/CertificateTrust";
import { assertSenderPermission } from "../security/sessionContext";
import { Permission } from "@src/security/authz/Permissions";

export function registerRecorderIpc(): void {
  // Persist an unsaved recording (actions) to a draft under the runtime data folder so it survives an
  // app close and reloads on the Recorder page. Restore any leftover draft on startup. The reusable
  // saved-URL history is stored separately so it survives saving/cancelling a recording.
  recorderService.configureDraftStorage(join(getRuntimeDataRoot(), "recorder-draft.json"));
  recorderService.configureUrlStorage(join(getRuntimeDataRoot(), "recorder-urls.json"));
  // Share the real-Chrome session-capture service so the recorder can hand off protected logins.
  recorderService.configureSessionCapture(getSessionService());
  void recorderService.ensureDraftLoaded();
  void recorderService.ensureUrlHistoryLoaded();

  // Every handler below is authorized against the CALLING renderer's bound session, not against a
  // renderer-supplied claim. Hiding the Recorder nav entry is a UI affordance, never the boundary:
  // before this, any sender — including one with no session at all — could start a browser, persist
  // URL history, and create flows. Same class of gap as AWKIT-REP-001 and AWKIT-SET-001.
  ipcMain.handle("recorder:start", async (event, url: string, options?: { captureWaitTime?: boolean; captureSmartWaits?: boolean }) => {
    await assertSenderPermission(event, Permission.PAGE_RECORDER);
    let executablePath: string | undefined;
    if (isProductionOffline()) {
      const bundled = new BundledBrowserResolver(getResourcesRoot()).resolveChromium();
      if (!bundled.exists) {
        throw new Error(`Bundled Chromium is required for offline recording: ${bundled.executablePath}`);
      }
      executablePath = bundled.executablePath;
      console.log(`[offline] Recorder using bundled Chromium: ${executablePath}`);
    }
    // The protected-login ignore flag is read from persisted Settings (single source of truth) so it
    // is always current regardless of when the Recorder page loaded it. Certificate trust is likewise
    // read from Settings at launch time (never from the renderer), so a Recorder session always reflects
    // the persisted, permission-gated value — including after a relaunch.
    const settings = await getUiSettings();
    await recorderService.startRecording(url, {
      executablePath,
      captureWaitTime: options?.captureWaitTime ?? false,
      captureSmartWaits: options?.captureSmartWaits ?? true,
      ignoreProtectedLoginDetection: settings.recorder.ignoreProtectedLoginDetection ?? false,
      asyncAwareness: settings.recorder.asyncAwareness,
      ignoreHttpsErrors: resolveIgnoreHttpsErrors({ app: settings.recorder.security })
    });
    return recorderService.getStatus();
  });

  ipcMain.handle("recorder:stop", async (event) => {
    await assertSenderPermission(event, Permission.PAGE_RECORDER);
    return await recorderService.stopRecording();
  });

  ipcMain.handle("recorder:cancel", async (event) => {
    await assertSenderPermission(event, Permission.PAGE_RECORDER);
    await recorderService.cancelRecording();
    return { success: true };
  });

  ipcMain.handle("recorder:getActions", async (event) => {
    await assertSenderPermission(event, Permission.PAGE_RECORDER);
    await recorderService.ensureDraftLoaded();
    return recorderService.getActions();
  });

  ipcMain.handle("recorder:getStatus", async (event) => {
    await assertSenderPermission(event, Permission.PAGE_RECORDER);
    return recorderService.getStatus();
  });

  ipcMain.handle("recorder:getUrls", async (event) => {
    await assertSenderPermission(event, Permission.PAGE_RECORDER);
    await recorderService.ensureUrlHistoryLoaded();
    return recorderService.getUrls();
  });

  ipcMain.handle("recorder:saveUrl", async (event, url: string) => {
    await assertSenderPermission(event, Permission.PAGE_RECORDER);
    return await recorderService.saveUrl(url);
  });

  // ── Protected login / popup manual handoff ─────────────────────────────────
  ipcMain.handle("recorder:getHandoff", async (event) => {
    await assertSenderPermission(event, Permission.PAGE_RECORDER);
    return recorderService.getHandoff();
  });

  ipcMain.handle("recorder:continueWithNormalBrowser", async (event) => {
    await assertSenderPermission(event, Permission.PAGE_RECORDER);
    return await recorderService.continueWithNormalBrowser();
  });

  ipcMain.handle("recorder:captureSessionAndResume", async (event, sessionName?: string) => {
    await assertSenderPermission(event, Permission.PAGE_RECORDER);
    return await recorderService.captureSessionAndResume(sessionName);
  });

  ipcMain.handle("recorder:cancelHandoff", async (event) => {
    await assertSenderPermission(event, Permission.PAGE_RECORDER);
    await recorderService.cancelSecureHandoff();
    return { success: true };
  });

  // Session-level "Ignore and continue recording": treat the active protected detection as a false
  // positive and resume the same recorder session (never bypasses authentication).
  ipcMain.handle("recorder:ignoreProtectedDetection", async (event) => {
    await assertSenderPermission(event, Permission.PAGE_RECORDER);
    return recorderService.ignoreCurrentProtectedDetection();
  });

  ipcMain.handle("recorder:saveFlow", async (event, name: string, actions: RecordedAction[]) => {
    // Saving CREATES a flow profile, so this needs the same permission `flows:create` demands —
    // otherwise the Recorder is a way to author flows without `workflow.create`.
    await assertSenderPermission(event, Permission.PAGE_RECORDER);
    await assertSenderPermission(event, Permission.WORKFLOW_CREATE);
    const store = createFlowProfileStore();
    // Recorded flows always open with default Start/End nodes and the actions between them,
    // replaying recorded waits/tab-switches. Logic lives in a pure, unit-tested helper.
    const blueprints: PageBlueprint[] = [];
    const flowProfile = buildRecordedFlow(name, actions, blueprints);
    await store.create(flowProfile);
    
    // Save any assembled blueprints for fallback recovery.
    if (blueprints.length > 0) {
      const blueprintStore = new FileLocatorBlueprintStore(join(getRuntimePaths().root, "locator-blueprints"));
      await Promise.allSettled(blueprints.map(b => blueprintStore.put(b)));
    }

    // The session is now persisted as a flow — clear the unsaved-recording draft.
    await recorderService.discardDraft();
    return flowProfile;
  });

  ipcMain.handle("recorder:getAmbiguityState", async (event) => {
    await assertSenderPermission(event, Permission.PAGE_RECORDER);
    return recorderService.getAmbiguityState();
  });

  ipcMain.handle(
    "recorder:resolveAmbiguity", 
    async (event, choice: import("@src/recorder/RecorderTypes").AmbiguityResolutionChoice, payload?: import("@src/recorder/RecorderTypes").AmbiguityResolutionPayload) => {
      await assertSenderPermission(event, Permission.PAGE_RECORDER);
      return await recorderService.resolveAmbiguity(choice, payload);
    }
  );

  ipcMain.handle("recorder:highlightCandidate", async (event, candidateIndex?: number) => {
    await assertSenderPermission(event, Permission.PAGE_RECORDER);
    return await recorderService.highlightAmbiguityCandidate(candidateIndex);
  });

  ipcMain.handle("recorder:clearHighlight", async (event) => {
    await assertSenderPermission(event, Permission.PAGE_RECORDER);
    return await recorderService.clearHighlight();
  });
}
