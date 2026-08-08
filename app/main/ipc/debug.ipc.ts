import { ipcMain } from "electron";
import { Permission } from "@src/security/authz/Permissions";
import { getDebugLogService } from "../debugLogService";
import { assertSenderPermission } from "../security/sessionContext";

export function registerDebugIpc(): void {
  ipcMain.handle("debug:list", async (event, limit?: number) => {
    await assertSenderPermission(event, Permission.DEBUG_LOG_VIEW, {
      audit: { eventType: "DEBUG_LOG_READ_DENIED", channel: "debug:list" }
    });
    return getDebugLogService().readEntries(limit);
  });
}

