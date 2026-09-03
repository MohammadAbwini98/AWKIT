import { app, BrowserWindow, dialog } from "electron";
import { ensureRuntimeFolders, isProductionOffline } from "./appPaths";
import { getOfflineRuntimeStatus } from "./offlineRuntimeValidator";
import { registerIpcHandlers } from "./ipc";
import { createMainWindow, createSplashWindow, fadeOutAndClose } from "./windowManager";
import { updateUiSettings, flushSettingsWrites, getUiSettings } from "./uiSettings";
import { disposeOracleServices } from "./oracleService";
import { disposeSecurityKernel } from "./security/securityKernel";
import { disposeSemanticSubsystem, initializeSemanticSubsystem } from "./semantic/semanticService";
import { initializeLicensingRuntime } from "./licensing/licenseRuntime";
import { startLicenseEnforcementWatcher, stopLicenseEnforcementWatcher } from "./licensing/licenseEnforcementService";
import { evaluateOfflineStartupGate } from "@src/offline/ProductionStartupCheck";
import { executionEngine } from "@src/runner/ExecutionEngine";
import { getDebugLogService } from "./debugLogService";

let mainWindow: BrowserWindow | null = null;

process.on("uncaughtException", (error) => {
  void getDebugLogService().log("fatal", "main", "Uncaught main-process exception.", {
    errorType: error.name,
    errorMessage: error.message,
    stack: error.stack
  });
});
process.on("unhandledRejection", (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  void getDebugLogService().log("error", "main", "Unhandled main-process promise rejection.", {
    errorType: error.name,
    errorMessage: error.message,
    stack: error.stack
  });
});
app.on("render-process-gone", (_event, webContents, details) => {
  void getDebugLogService().log("error", "renderer", "Renderer process terminated.", {
    webContentsId: webContents.id,
    reason: details.reason,
    exitCode: details.exitCode
  });
});
app.on("child-process-gone", (_event, details) => {
  void getDebugLogService().log("error", "browser", "Electron child process terminated.", {
    processType: details.type,
    reason: details.reason,
    exitCode: details.exitCode,
    serviceName: details.serviceName
  });
});


// Cross-process guard (awkit-ekd.6): only one SpecterStudio instance may run per user-data profile.
// SecurityStore / uiSettings / the runtime SQLite stores have no cross-process writer lock, so two
// processes sharing a profile could lose writes to security.sqlite. Acquiring the single-instance lock
// makes a second launch hand focus to the running window and quit before it opens any window or store.
const gotSingleInstanceLock = app.requestSingleInstanceLock();

/**
 * In packaged/offline-production mode, verify the bundled runtime assets are
 * present before opening any window. Returns true when startup may proceed.
 * Development builds are never blocked.
 */
async function passesOfflineStartupGate(): Promise<boolean> {
  if (!isProductionOffline()) return true;

  const status = await getOfflineRuntimeStatus();
  const gate = evaluateOfflineStartupGate(status);
  if (gate.ok) return true;

  dialog.showMessageBoxSync({
    type: "error",
    title: "SpecterStudio",
    message: "SpecterStudio cannot start because required offline runtime assets are missing.",
    detail:
      `${gate.blockingFailures.map((failure) => `• ${failure}`).join("\n")}\n\n` +
      "Rebuild the offline bundle with:\n  npm run prepare:offline\n  npm run package:offline",
    buttons: ["Exit"]
  });

  return false;
}

async function bootstrap(): Promise<void> {
  await ensureRuntimeFolders();

  if (!(await passesOfflineStartupGate())) {
    app.exit(1);
    return;
  }

  // Establish the licensing migration-grace anchor BEFORE anything writes profile data. The anchor
  // classifies this profile as upgraded-or-fresh by observing whether user data already exists, and
  // the very next statement creates `ui-settings.json` — so running these in the other order would
  // make every fresh install look like an upgrade and hand it a free 14-day window.
  initializeLicensingRuntime();

  // Record this launch so the Settings screen can show the last-launched time.
  await updateUiSettings({ app: { lastLaunchedAt: new Date().toISOString() } }).catch(() => undefined);
  const currentSettings = await getUiSettings();
  getDebugLogService().setEnabled(currentSettings.superUser.debugMode);
  await getDebugLogService().log("info", "application", "SpecterStudio started.", {
    mode: isProductionOffline() ? "production-offline" : "development"
  });

  registerIpcHandlers();
  if (!executionEngine.dispatchGateRegistered || !executionEngine.executionPortsRegistered) {
    dialog.showMessageBoxSync({
      type: "error",
      title: "SpecterStudio",
      message: "SpecterStudio cannot start because execution composition is unavailable.",
      buttons: ["Exit"]
    });
    app.exit(1);
    return;
  }
  startLicenseEnforcementWatcher();

  // Optional semantic index: reclaim generations orphaned by an unclean shutdown and mark the
  // index open. Non-blocking and non-throwing — it never starts the native host (that stays lazy),
  // so AWKIT startup remains independent of Zvec availability.
  initializeSemanticSubsystem();

  // Show the branded launch splash, then boot the main window hidden behind it. The splash always
  // plays one full round and settles on the frame that shows the app brief. Then:
  //   • if the main window is already ready → dissolve the splash and reveal the app;
  //   • if the app still needs time → hold on that brief frame with a small spinner until ready.
  // The app is therefore never revealed before one full round has played.
  const splash = createSplashWindow();
  mainWindow = createMainWindow({ show: false });

  const ONE_ROUND_MS = 11_800; // matches the splash HOLD_T (~11.7s) + a small settle buffer
  const HARD_CAP_MS = 30_000;  // safety net: never hang on the splash if ready-to-show never fires

  let mainReady = false;
  let roundDone = false;
  let revealed = false;

  const revealApp = (): void => {
    if (revealed || !(mainReady && roundDone)) return;
    revealed = true;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
    if (!splash.isDestroyed()) fadeOutAndClose(splash);
  };

  // Ask the splash (sandboxed, no preload) to reveal its waiting spinner. Best-effort.
  const showSplashSpinner = (): void => {
    if (splash.isDestroyed()) return;
    splash.webContents
      .executeJavaScript("window.__splashHold && window.__splashHold()")
      .catch(() => undefined);
  };

  mainWindow.once("ready-to-show", () => {
    mainReady = true;
    revealApp();
  });

  // One full splash round has played: reveal now if the app is ready, else hold + spinner.
  setTimeout(() => {
    roundDone = true;
    if (mainReady) revealApp();
    else showSplashSpinner();
  }, ONE_ROUND_MS);

  // Force the app up even if `ready-to-show` never arrives.
  setTimeout(() => {
    mainReady = true;
    roundDone = true;
    revealApp();
  }, HARD_CAP_MS);
}

if (!gotSingleInstanceLock) {
  // A primary instance is already running for this profile — bounce this launch immediately. No
  // window, no store access, and none of the lifecycle handlers below are registered, so the quit is
  // clean (nothing to flush).
  app.quit();
} else {
  // A second launch attempt raises this on the primary — surface the existing window instead.
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    void bootstrap();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0 && mainWindow !== null) {
        mainWindow = createMainWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  // Flush any queued settings writes before the process exits, so a last-moment edit (the user
  // closes the window immediately after changing something) is not lost. Bounded by a 2s timeout
  // so a stuck write can never deadlock shutdown; the guard makes the re-entrant quit a no-op.
  let settingsFlushed = false;
  app.on("before-quit", (event) => {
    if (settingsFlushed) return;
    event.preventDefault();
    stopLicenseEnforcementWatcher();
    void getDebugLogService().log("info", "application", "SpecterStudio is shutting down.");

    // Staged shutdown (plan §12). Stage 1 closes the semantic host on its OWN bounded budget so a
    // native close can never eat into the existing 2s envelope that settings/Oracle/security
    // already share; stage 2 is that pre-existing stage, unchanged. Stage 1 never rejects and its
    // outcome cannot prevent stage 2 or the quit.
    const stage2 = (): Promise<unknown> => {
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2000));
      // Also dispose the Oracle JDBC bridge so no Java child process is orphaned.
      return Promise.race([
        Promise.all([flushSettingsWrites(), getDebugLogService().flush(), disposeOracleServices(), disposeSecurityKernel()]),
        timeout
      ]);
    };

    // Stage 1 is raced against its own ceiling rather than trusted to be bounded. It now drains the
    // mutation queue and any in-flight rebuild, and that budget belongs to whoever registered the
    // index runtime — so the ceiling lives HERE, where quitting is actually owned. Losing the race
    // leaves the semantic session marked unclean, which is exactly what makes the next startup
    // reconcile it; that is a better outcome than an application that will not exit.
    const stage1 = (): Promise<unknown> => {
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, 3000));
      return Promise.race([disposeSemanticSubsystem().catch(() => undefined), timeout]);
    };

    void stage1()
      .catch(() => undefined)
      .then(stage2)
      .finally(() => {
        settingsFlushed = true;
        app.quit();
      });
  });
}
