import { ipcMain, shell } from "electron";
import type { ConcurrentRunReport } from "@src/reports/ExecutionReport";
import { createReportStore } from "../profileStores";
import { getConfiguredPaths } from "../storagePaths";
import { assertSenderPermission } from "../security/sessionContext";
import { Permission } from "@src/security/authz/Permissions";
import { ReportExportService, type ReportExportFormat } from "@src/reports/ReportExportService";

type StoredReport = ConcurrentRunReport & { id: string };

export function registerReportIpc(): void {
  const store = createReportStore();
  const exporter = new ReportExportService();

  ipcMain.handle("reports:list", async (event) => {
    await assertSenderPermission(event, Permission.PAGE_REPORTS, {
      audit: { eventType: "REPORT_READ_DENIED", channel: "reports:list" }
    });
    return store.list();
  });
  ipcMain.handle("reports:get", async (event, id: string) => {
    await assertSenderPermission(event, Permission.PAGE_REPORTS, {
      audit: { eventType: "REPORT_READ_DENIED", channel: "reports:get" }
    });
    return store.get(id);
  });
  ipcMain.handle("reports:create", async (event, report: ConcurrentRunReport) => {
    await assertSenderPermission(event, Permission.REPORT_EXPORT, {
      audit: { eventType: "REPORT_WRITE_DENIED", channel: "reports:create" }
    });
    return store.import(toStoredReport(report));
  });
  ipcMain.handle("reports:delete", async (event, id: string) => {
    await assertSenderPermission(event, Permission.REPORT_EXPORT, {
      audit: { eventType: "REPORT_WRITE_DENIED", channel: "reports:delete" }
    });
    return store.delete(id);
  });
  ipcMain.handle("reports:export", async (event, id: string, format: ReportExportFormat = "json") => {
    await assertSenderPermission(event, Permission.REPORT_EXPORT, {
      audit: { eventType: "REPORT_EXPORT_DENIED", channel: "reports:export" }
    });
    if (!["json", "csv", "xlsx"].includes(format)) throw new Error("Unsupported report export format.");
    const report = await store.get(id);
    if (!report) throw new Error("Report not found.");
    return exporter.export(report, format);
  });
  ipcMain.handle("reports:openFolder", async (event, id: string) => {
    await assertSenderPermission(event, Permission.REPORT_EXPORT, {
      audit: { eventType: "REPORT_OPEN_FOLDER_DENIED", channel: "reports:openFolder" }
    });
    // The renderer supplies only a report id. The trusted process resolves the configured report
    // folder after proving the record exists, so this action cannot be repurposed for traversal.
    const report = await store.get(id);
    if (!report) throw new Error("Report not found.");
    return shell.openPath(getConfiguredPaths().reports);
  });

  ipcMain.handle("report:list", async (event) => {
    await assertSenderPermission(event, Permission.PAGE_REPORTS, {
      audit: { eventType: "REPORT_READ_DENIED", channel: "report:list" }
    });
    return store.list();
  });
}

function toStoredReport(report: ConcurrentRunReport): StoredReport {
  return {
    ...report,
    id: report.executionId
  };
}
