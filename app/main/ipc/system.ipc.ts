import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { previewCapacity } from "../capacityService";
import { getRuntimeDataRoot, getResourcesRoot } from "../appPaths";
import { getConfiguredPaths } from "../storagePaths";
import { isPathInside } from "@src/utils/pathSafety";
import { assertTrustedSender } from "./senderGuard";
import type { WorkloadClass } from "@src/runner/concurrency/CapacityPlanner";

const WORKLOAD_CLASSES: WorkloadClass[] = ["light", "medium", "heavy", "custom"];

/** Extensions we refuse to launch via the OS default handler (audit F-05). */
const BLOCKED_OPEN_EXTENSIONS = new Set([
  ".exe", ".com", ".bat", ".cmd", ".ps1", ".psm1", ".vbs", ".vbe", ".js", ".jse", ".wsf", ".wsh",
  ".msi", ".msp", ".scr", ".lnk", ".url", ".reg", ".hta", ".cpl", ".jar", ".pif", ".gadget"
]);

/** Only allow opening paths inside AWKIT's own data/artifact folders (audit F-05). */
function isOpenPathAllowed(target: string): boolean {
  const roots = [getRuntimeDataRoot(), getResourcesRoot(), ...Object.values(getConfiguredPaths())];
  return roots.some((root) => isPathInside(root, target));
}

export function registerSystemIpc(): void {
  // Read-only capacity preview for Settings: detects the current machine and returns its capacity
  // recommendation without mutating the persisted profile. Best-effort — never throws to the renderer.
  ipcMain.handle("system:capacityPreview", async (_, workloadClass?: unknown) => {
    const cls = typeof workloadClass === "string" && WORKLOAD_CLASSES.includes(workloadClass as WorkloadClass)
      ? (workloadClass as WorkloadClass)
      : undefined;
    return previewCapacity(cls);
  });

  ipcMain.handle("system:browseFolder", async (event, defaultPath?: string) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const options = {
      title: "Choose a folder",
      properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">,
      defaultPath: defaultPath && existsSync(defaultPath) ? defaultPath : undefined
    };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("system:openPath", async (event, path: string) => {
    assertTrustedSender(event);
    if (typeof path !== "string" || !path.trim()) {
      return "Invalid path.";
    }
    if (!existsSync(path)) {
      return "File or folder does not exist yet.";
    }
    if (!isOpenPathAllowed(path)) {
      return "This location is outside WebFlow Studio's data folders and cannot be opened from here.";
    }
    try {
      const pathStat = await stat(path);
      if (pathStat.isDirectory()) {
        const files = await readdir(path);
        const images = files.filter(f => f.endsWith(".png") || f.endsWith(".jpg") || f.endsWith(".jpeg"));
        if (images.length > 0) {
          return shell.openPath(join(path, images[0]));
        }
        return shell.openPath(path);
      }
      // Never launch an executable/script via the OS default handler.
      if (BLOCKED_OPEN_EXTENSIONS.has(extname(path).toLowerCase())) {
        return "This file type cannot be opened from WebFlow Studio for safety reasons.";
      }
      return shell.openPath(path);
    } catch (e: any) {
      return e.message;
    }
  });
}
