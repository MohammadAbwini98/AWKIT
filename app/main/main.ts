import { app, BrowserWindow, dialog } from "electron";
import { ensureRuntimeFolders, isProductionOffline } from "./appPaths";
import { getOfflineRuntimeStatus } from "./offlineRuntimeValidator";
import { registerIpcHandlers } from "./ipc";
import { createMainWindow, createSplashWindow, fadeOutAndClose } from "./windowManager";
import { updateUiSettings, flushSettingsWrites } from "./uiSettings";
import { disposeOracleServices } from "./oracleService";
import { disposeSecurityKernel } from "./security/securityKernel";
import { evaluateOfflineStartupGate } from "@src/offline/ProductionStartupCheck";

let mainWindow: BrowserWindow | null = null;

// ─── PHASE 0B SPIKE-ONLY HOOK (scripts/zvec-spike/mainProcessSpikeHook.mjs) ──────────────────
// Never active unless AWKIT_ZVEC_SPIKE_HOST is explicitly set on the command line/env for a spike
// launch. Normal AWKIT startup below is completely skipped in that case; every other launch is
// completely unaffected by this block. Temporary — must be removed before this branch could ever
// be considered for Phase 1 or merged into main.
// Phase 0D: AWKIT_ZVEC_SPIKE_WITH_APP=1 runs the spike host *alongside* a normal AWKIT startup
// instead of replacing it, so crash-isolation and degraded-mode tests can prove the full
// application stays alive and usable — not merely that the utility host exited safely.
if (process.env.AWKIT_ZVEC_SPIKE_HOST && process.env.AWKIT_ZVEC_SPIKE_WITH_APP !== "1") {
  // Defensive, console-independent crash logging: a packaged GUI app has no attached console, so
  // console.log/uncaught exceptions are otherwise invisible. Every step here writes directly to a
  // fixed file so a failure at any point is still observable.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fsSpike = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pathSpike = require("node:path") as typeof import("node:path");
  const crashLogDir = pathSpike.join(process.env.LOCALAPPDATA ?? ".", "SpecterStudio", "zvec-phase-0", "reports");
  const crashLogFile = pathSpike.join(crashLogDir, `app-mode-crash-${Date.now()}.log`);
  const logSpike = (line: string): void => {
    try {
      fsSpike.mkdirSync(crashLogDir, { recursive: true });
      fsSpike.appendFileSync(crashLogFile, `${new Date().toISOString()} ${line}\n`);
    } catch {
      /* nothing more we can do without a console */
    }
  };
  logSpike(`module-loaded mode=${process.env.AWKIT_ZVEC_SPIKE_HOST}`);
  process.on("uncaughtException", (err) => logSpike(`uncaughtException: ${err?.stack ?? err}`));
  process.on("unhandledRejection", (err) => logSpike(`unhandledRejection: ${(err as Error)?.stack ?? err}`));
  void app
    .whenReady()
    .then(async () => {
      logSpike("app-ready");
      // Import the RAW, unbundled spike file from disk (app.asar.unpacked in a packaged build,
      // the repo path in dev) rather than letting the bundler inline it. This keeps app-mode
      // running byte-identical code to the ELECTRON_RUN_AS_NODE runs, so a difference in outcome
      // is attributable to process mode rather than to bundling.
      const spikeDir = app.isPackaged
        ? pathSpike.join(process.resourcesPath, "app.asar.unpacked", "scripts", "zvec-spike")
        : pathSpike.join(__dirname, "..", "..", "scripts", "zvec-spike");
      const hookUrl = `file:///${pathSpike.join(spikeDir, "mainProcessSpikeHook.mjs").replace(/\\/g, "/")}`;
      logSpike(`importing-hook ${hookUrl}`);
      const { runZvecSpikeHost } = await import(/* @vite-ignore */ hookUrl);
      logSpike("hook-imported");
      await runZvecSpikeHost(process.env.AWKIT_ZVEC_SPIKE_HOST as string);
      logSpike("hook-completed");
    })
    .catch((err) => {
      logSpike(`spike-hook-failed: ${err?.stack ?? err}`);
      app.exit(1);
    });
} else {

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

    // Phase 0D spike-only: run the host check after the window has had time to come up, and do NOT
    // exit afterwards — the harness inspects the still-running app. Inert without both env vars.
    if (process.env.AWKIT_ZVEC_SPIKE_HOST && process.env.AWKIT_ZVEC_SPIKE_WITH_APP === "1") {
      const spikeDelayMs = Number(process.env.AWKIT_ZVEC_SPIKE_DELAY_MS ?? 15_000);
      setTimeout(() => {
        const spikeDir = app.isPackaged
          ? require("node:path").join(process.resourcesPath, "app.asar.unpacked", "scripts", "zvec-spike")
          : require("node:path").join(__dirname, "..", "..", "scripts", "zvec-spike");
        const hookUrl = `file:///${require("node:path").join(spikeDir, "mainProcessSpikeHook.mjs").replace(/\\/g, "/")}`;
        void import(/* @vite-ignore */ hookUrl)
          .then(({ runZvecSpikeHost }) =>
            runZvecSpikeHost(process.env.AWKIT_ZVEC_SPIKE_HOST as string, { keepAlive: true })
          )
          .catch(() => undefined);
      }, spikeDelayMs);
    }

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
    void Promise.race([Promise.all([flushSettingsWrites(), disposeOracleServices(), disposeSecurityKernel()]), timeout]).finally(() => {
      settingsFlushed = true;
      app.quit();
    });
  });
}
} // end PHASE 0B SPIKE-ONLY HOOK else-branch
