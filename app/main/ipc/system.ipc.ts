import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { previewCapacity } from "../capacityService";
import type { WorkloadClass } from "@src/runner/concurrency/CapacityPlanner";

const WORKLOAD_CLASSES: WorkloadClass[] = ["light", "medium", "heavy", "custom"];

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

  ipcMain.handle("system:openPath", async (_, path: string) => {
    if (!existsSync(path)) {
      return "File or folder does not exist yet.";
    }
    try {
      const pathStat = await stat(path);
      if (pathStat.isDirectory()) {
        const files = await readdir(path);
        const images = files.filter(f => f.endsWith(".png") || f.endsWith(".jpg") || f.endsWith(".jpeg"));
        if (images.length > 0) {
          return shell.openPath(join(path, images[0]));
        }
      }
      return shell.openPath(path);
    } catch (e: any) {
      return e.message;
    }
  });
}
