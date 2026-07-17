import { app, BrowserWindow, dialog } from "electron";
import { ensureRuntimeFolders, isProductionOffline } from "./appPaths";
import { getOfflineRuntimeStatus } from "./offlineRuntimeValidator";
import { registerIpcHandlers } from "./ipc";
import { createMainWindow, createSplashWindow, fadeOutAndClose } from "./windowManager";
import { updateUiSettings, flushSettingsWrites } from "./uiSettings";
import { disposeOracleServices } from "./oracleService";
import { evaluateOfflineStartupGate } from "@src/offline/ProductionStartupCheck";

let mainWindow: BrowserWindow | null = null;

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

  // Record this launch so the Settings screen can show the last-launched time.
  await updateUiSettings({ app: { lastLaunchedAt: new Date().toISOString() } }).catch(() => undefined);

  registerIpcHandlers();

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
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2000));
  // Also dispose the Oracle JDBC bridge so no Java child process is orphaned.
  void Promise.race([Promise.all([flushSettingsWrites(), disposeOracleServices()]), timeout]).finally(() => {
    settingsFlushed = true;
    app.quit();
  });
});
