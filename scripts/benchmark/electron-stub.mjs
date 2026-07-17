/**
 * Minimal `electron` stand-in for the real-ExecutionEngine benchmark harness.
 *
 * The benchmarks drive the COMPLETE production `ExecutionEngine` dispatch path under plain Node/tsx (no
 * Electron runtime). `ExecutionEngine` transitively imports Electron-main modules (`app/main/appPaths.ts`
 * → `app`, `app/main/ipc/session.ipc.ts` → `ipcMain`, …). Under plain Node those are `undefined`, so
 * `getResourcesRoot()` (unguarded `app.isPackaged`) throws when a run dispatches.
 *
 * This module provides ONLY the Electron path/mode provider surface those modules touch. Every downstream
 * piece — scheduler, admission controllers, browser pools, factory, shared pool, PlaywrightRunner with real
 * Playwright Chromium — is the unmodified production code. Nothing here changes runtime behaviour; it just
 * lets the engine resolve paths without a full Electron process. `appPaths.ts` already documents that the
 * engine is imported under tsx with `app` undefined, so this is aligned with existing practice.
 *
 * Redirected onto the bare specifier `electron` by `electron-hook.mjs` (a Node module-resolution hook).
 */
import os from "node:os";
import { join } from "node:path";

const APPDATA_ROOT = process.env.AWKIT_BENCH_APPDATA ?? join(os.tmpdir(), "awkit-bench-appdata");

/** electron.app — path/mode provider. isPackaged=false → dev paths (resources = cwd/resources). */
export const app = {
  isPackaged: false,
  name: "SpecterStudio",
  getPath: (name) => join(APPDATA_ROOT, String(name ?? "appData")),
  getAppPath: () => process.cwd(),
  getName: () => "SpecterStudio",
  getVersion: () => "0.0.0-bench",
  getLocale: () => "en-US",
  whenReady: () => Promise.resolve(),
  on: () => app,
  once: () => app,
  quit: () => undefined,
  exit: () => undefined,
  isReady: () => true,
  requestSingleInstanceLock: () => true
};

/** electron.ipcMain — no-op registry (the benchmark never uses IPC). */
export const ipcMain = {
  handle: () => undefined,
  handleOnce: () => undefined,
  on: () => ipcMain,
  once: () => ipcMain,
  removeHandler: () => undefined,
  removeAllListeners: () => ipcMain
};

/** electron.ipcRenderer — never exercised from the main-process engine path; present for link safety. */
export const ipcRenderer = {
  invoke: () => Promise.resolve(undefined),
  send: () => undefined,
  on: () => ipcRenderer,
  once: () => ipcRenderer,
  removeAllListeners: () => ipcRenderer
};

/** electron.safeStorage — DPAPI is unavailable outside Electron; report so and pass values through. */
export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (plain) => Buffer.from(String(plain), "utf8"),
  decryptString: (buf) => Buffer.from(buf).toString("utf8")
};

/** electron.BrowserWindow — constructed lazily by some main modules; a no-op shell is enough. */
export class BrowserWindow {
  static getAllWindows() {
    return [];
  }
  static fromWebContents() {
    return null;
  }
  constructor() {
    this.webContents = { send: () => undefined, on: () => undefined, session: {} };
  }
  on() {
    return this;
  }
  once() {
    return this;
  }
  loadURL() {
    return Promise.resolve();
  }
  loadFile() {
    return Promise.resolve();
  }
  show() {}
  close() {}
  destroy() {}
  isDestroyed() {
    return false;
  }
}

/** electron.contextBridge — renderer preload only; present for link safety. */
export const contextBridge = {
  exposeInMainWorld: () => undefined
};

/** electron.dialog — no interactive dialogs in a benchmark. */
export const dialog = {
  showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
  showSaveDialog: () => Promise.resolve({ canceled: true, filePath: undefined }),
  showMessageBox: () => Promise.resolve({ response: 0 }),
  showErrorBox: () => undefined
};

/** electron.shell — never opens anything under benchmark. */
export const shell = {
  openPath: () => Promise.resolve(""),
  openExternal: () => Promise.resolve(),
  showItemInFolder: () => undefined,
  trashItem: () => Promise.resolve()
};

export default { app, ipcMain, ipcRenderer, safeStorage, BrowserWindow, contextBridge, dialog, shell };
