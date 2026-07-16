import { BrowserWindow, shell } from "electron";
import { join } from "node:path";
import { getResourcesRoot } from "./appPaths";

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: "WebFlow Studio",
    icon: join(getResourcesRoot(), "icon.ico"),
    backgroundColor: "#f6f7fb",
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
