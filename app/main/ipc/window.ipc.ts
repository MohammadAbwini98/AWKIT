import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";

/**
 * Narrowly-scoped window-management IPC for the custom AWKIT application frame.
 *
 * The renderer never touches `BrowserWindow` directly; it can only ask the main process to perform
 * these four passive operations on the window that sent the request. Resolving the window from the
 * sender (rather than a captured reference) keeps the handlers correct if AWKIT ever owns more than
 * one window, and makes a missing/destroyed window a safe no-op instead of a renderer crash.
 */
function senderWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

export function registerWindowIpc(): void {
  ipcMain.handle("window:minimize", (event) => {
    senderWindow(event)?.minimize();
  });

  ipcMain.handle("window:toggleMaximize", (event) => {
    const window = senderWindow(event);
    if (!window) return false;
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
    return window.isMaximized();
  });

  ipcMain.handle("window:close", (event) => {
    senderWindow(event)?.close();
  });

  ipcMain.handle("window:isMaximized", (event) => {
    return senderWindow(event)?.isMaximized() ?? false;
  });
}
