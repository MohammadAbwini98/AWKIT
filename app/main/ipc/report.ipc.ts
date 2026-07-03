import { ipcMain } from "electron";
import type { ConcurrentRunReport } from "@src/reports/ExecutionReport";
import { createReportStore } from "../profileStores";

type StoredReport = ConcurrentRunReport & { id: string };

export function registerReportIpc(): void {
  const store = createReportStore();

  ipcMain.handle("reports:list", async () => store.list());
  ipcMain.handle("reports:get", async (_, id: string) => store.get(id));
  ipcMain.handle("reports:create", async (_, report: ConcurrentRunReport) => store.import(toStoredReport(report)));
  ipcMain.handle("reports:delete", async (_, id: string) => store.delete(id));
  ipcMain.handle("reports:export", async (_, id: string) => store.export(id));

  ipcMain.handle("report:list", async () => store.list());
}

function toStoredReport(report: ConcurrentRunReport): StoredReport {
  return {
    ...report,
    id: report.executionId
  };
}
