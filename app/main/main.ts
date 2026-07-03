import { app, BrowserWindow, dialog } from "electron";
import { ensureRuntimeFolders, isProductionOffline } from "./appPaths";
import { getOfflineRuntimeStatus } from "./offlineRuntimeValidator";
import { registerIpcHandlers } from "./ipc";
import { createMainWindow } from "./windowManager";
import { updateUiSettings } from "./uiSettings";
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
    title: "WebFlow Studio",
    message: "WebFlow Studio cannot start because required offline runtime assets are missing.",
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
  mainWindow = createMainWindow();
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
