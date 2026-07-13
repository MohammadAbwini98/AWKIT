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
    webPreferences: {
      preload: join(__dirname, "../preload/preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    // Never open the renderer window itself; hand off to the OS browser — but only for http(s), so a
    // file:/other-scheme window.open can't be launched. Mirrors the guard in auth.ipc.ts openExternal.
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return window;
}
