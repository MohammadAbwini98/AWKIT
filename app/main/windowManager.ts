import { BrowserWindow, shell } from "electron";
import { join } from "node:path";
import { getResourcesRoot } from "./appPaths";

/**
 * Frameless launch splash. Shows the Specter Studio brand animation (a self-contained,
 * offline canvas loop in `renderer/splash.html`) while the main window boots, then fades out.
 * Deliberately has no preload/node access — it only draws to a canvas.
 */
export function createSplashWindow(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 760,
    height: 570, // 4:3, matching the reference composition
    resizable: false,
    frame: false,
    show: false,
    center: true,
    title: "SpecterStudio",
    icon: join(getResourcesRoot(), "icon.ico"),
    backgroundColor: "#0e1016",
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  splash.once("ready-to-show", () => {
    if (!splash.isDestroyed()) splash.show();
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    void splash.loadURL(new URL("splash.html", rendererUrl).href);
  } else {
    void splash.loadFile(join(__dirname, "../renderer/splash.html"));
  }

  return splash;
}

/**
 * Fade a window's opacity to zero over ~0.45s, then close it. Used to dissolve the splash
 * into the main window once it is ready, avoiding a hard cut.
 */
export function fadeOutAndClose(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  let opacity = 1;
  const step = (): void => {
    if (win.isDestroyed()) return;
    opacity -= 0.08;
    if (opacity <= 0) {
      win.close();
      return;
    }
    win.setOpacity(opacity);
    setTimeout(step, 16);
  };
  step();
}

export function createMainWindow(options: { show?: boolean } = {}): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: "SpecterStudio",
    icon: join(getResourcesRoot(), "icon.ico"),
    backgroundColor: "#f6f7fb",
    // Defer painting until the renderer is ready when a splash is coordinating the handoff.
    show: options.show ?? true,
    // The native OS/Electron title bar is removed; AWKIT draws its own application frame in the
    // renderer (see layout/AppFrame.tsx). The window stays resizable via the OS edge hit-testing.
    frame: false,
    webPreferences: {
      preload: join(__dirname, "../preload/preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // Keep the renderer's maximize/restore control in sync with the *real* window state, so it
  // reflects changes we didn't originate — OS snap, double-click, Win+Up, full-screen, etc.
  const emitMaximizedState = () => {
    if (window.isDestroyed()) return;
    window.webContents.send("window:maximizedChanged", window.isMaximized());
  };
  window.on("maximize", emitMaximizedState);
  window.on("unmaximize", emitMaximizedState);
  window.on("enter-full-screen", emitMaximizedState);
  window.on("leave-full-screen", emitMaximizedState);

  window.webContents.setWindowOpenHandler(({ url }) => {
    // Never open the renderer window itself; hand off to the OS browser — but only for http(s), so a
    // file:/other-scheme window.open can't be launched. Mirrors the guard in auth.ipc.ts openExternal.
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Lock the app window to its own bundle (audit F-06). The React UI navigates client-side
  // (history/hash) which does not fire these events, so any real navigation away from the dev
  // server or the packaged file:// bundle is unexpected — block it. http(s) targets are handed to
  // the OS browser instead so the powerful preload bridge is never exposed to remote content.
  const isOwnBundle = (target: string): boolean => {
    const rendererUrl = process.env.ELECTRON_RENDERER_URL;
    if (rendererUrl && target.startsWith(rendererUrl)) return true;
    return target.startsWith("file://");
  };
  const guardNavigation = (event: Electron.Event, target: string): void => {
    if (isOwnBundle(target)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(target)) void shell.openExternal(target);
  };
  window.webContents.on("will-navigate", (event, url) => guardNavigation(event, url));
  window.webContents.on("will-redirect", (event, url) => guardNavigation(event, url));

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return window;
}
