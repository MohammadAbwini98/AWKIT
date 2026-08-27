import { app, ipcMain } from "electron";
import { arch, platform, release } from "node:os";
import { Permission } from "@src/security/authz/Permissions";
import { getDebugLogService, redactDebugValue } from "../debugLogService";
import { assertSenderPermission, assertSenderSuperUser } from "../security/sessionContext";
import { getUiSettings } from "../uiSettings";
import { createReportStore } from "../profileStores";
import { isProductionOffline } from "../appPaths";

export function registerDebugIpc(): void {
  ipcMain.on("debug:rendererIpcFailure", (_event, input: unknown) => {
    const record = input && typeof input === "object" ? input as Record<string, unknown> : {};
    void getDebugLogService().log("error", "ipc", "Renderer IPC request failed.", {
      channel: typeof record.channel === "string" ? record.channel.slice(0, 128) : "unknown",
      errorType: typeof record.name === "string" ? record.name.slice(0, 128) : "Error",
      errorMessage: typeof record.message === "string" ? record.message.slice(0, 2048) : "Request failed"
    });
  });
  ipcMain.on("debug:rendererError", (_event, input: unknown) => {
    const record = input && typeof input === "object" ? input as Record<string, unknown> : {};
    void getDebugLogService().log("error", "renderer", "Uncaught renderer failure.", {
      operation: typeof record.operation === "string" ? record.operation.slice(0, 64) : "window",
      errorType: typeof record.name === "string" ? record.name.slice(0, 128) : "Error",
      errorMessage: typeof record.message === "string" ? record.message.slice(0, 2048) : "Renderer failure",
      stack: typeof record.stack === "string" ? record.stack.slice(0, 8192) : undefined
    });
  });
  ipcMain.handle("debug:list", async (event, limit?: number) => {
    await assertSenderPermission(event, Permission.DEBUG_LOG_VIEW, {
      audit: { eventType: "DEBUG_LOG_READ_DENIED", channel: "debug:list" }
    });
    return getDebugLogService().readEntries(limit);
  });
  ipcMain.handle("debug:exportBundle", async (event) => {
    await assertSenderSuperUser(event, Permission.DEBUG_LOG_VIEW, {
      audit: { eventType: "DIAGNOSTIC_BUNDLE_EXPORT_DENIED", channel: "debug:exportBundle" }
    });
    const [settings, logs, reports] = await Promise.all([
      getUiSettings(),
      getDebugLogService().readEntries(),
      createReportStore().list().catch(() => [])
    ]);
    const bundle = redactDebugValue({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      application: { name: "SpecterStudio", version: app.getVersion(), productionOffline: isProductionOffline() },
      platform: { platform: platform(), release: release(), arch: arch() },
      configuration: {
        appearance: settings.appearance,
        chromeMode: settings.superUser.chrome.mode,
        chromeExecutableConfigured: Boolean(settings.superUser.chrome.executablePath),
        debugMode: settings.superUser.debugMode,
        runtimeCapacityMode: settings.runtime.capacityMode,
        semanticEnabled: settings.semantic.enabled,
        customPathsConfigured: Object.values(settings.paths).filter(Boolean).length
      },
      recentReports: reports.slice(0, 50).map((report) => ({
        runId: report.executionId,
        workflowId: report.scenarioId,
        status: report.status,
        startedAt: report.startedAt,
        endedAt: report.endedAt
      })),
      logs
    });
    const text = JSON.stringify(bundle, null, 2);
    return {
      filename: `specterstudio-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
      mimeType: "application/json;charset=utf-8",
      dataBase64: Buffer.from(text, "utf8").toString("base64")
    };
  });
}
