import { ipcMain } from "electron";
import { Permission } from "@src/security/authz/Permissions";
import { readRoadmapSnapshot } from "../roadmapSnapshotService";
import { assertSenderPermission } from "../security/sessionContext";

export function registerRoadmapIpc(): void {
  ipcMain.handle("roadmap:getSnapshot", async (event) => {
    await assertSenderPermission(event, Permission.PAGE_ROADMAP, {
      audit: { eventType: "ROADMAP_READ_DENIED", channel: "roadmap:getSnapshot" }
    });
    return readRoadmapSnapshot();
  });
}

