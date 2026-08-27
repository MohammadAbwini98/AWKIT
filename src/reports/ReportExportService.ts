import { Workbook } from "exceljs";
import type { ConcurrentRunReport, InstanceReport } from "./ExecutionReport";
import { SecretMasker } from "./SecretMasker";

export type ReportExportFormat = "json" | "csv" | "xlsx";

export interface ReportExportArtifact {
  filename: string;
  mimeType: string;
  dataBase64: string;
}

interface StepRow {
  runId: string;
  workflowId: string;
  workflowName: string;
  overallResult: string;
  runStartedAt: string;
  runEndedAt: string;
  runDurationMs: number;
  instanceId: string;
  instanceResult: string;
  dataSetIteration: number | "";
  flowId: string;
  stepOrder: number | "";
  stepId: string;
  stepName: string;
  actionType: string;
  stepStatus: string;
  errorSummary: string;
  attemptCount: number | "";
  retryCount: number | "";
  failurePolicy: string;
}

const STEP_COLUMNS: Array<{ header: string; key: keyof StepRow; width: number }> = [
  { header: "Run ID", key: "runId", width: 38 },
  { header: "Workflow ID", key: "workflowId", width: 28 },
  { header: "Workflow Name", key: "workflowName", width: 28 },
  { header: "Overall Result", key: "overallResult", width: 16 },
  { header: "Run Started", key: "runStartedAt", width: 24 },
  { header: "Run Ended", key: "runEndedAt", width: 24 },
  { header: "Run Duration (ms)", key: "runDurationMs", width: 18 },
  { header: "Instance ID", key: "instanceId", width: 38 },
  { header: "Instance Result", key: "instanceResult", width: 16 },
  { header: "Data Set / Iteration", key: "dataSetIteration", width: 20 },
  { header: "Flow ID", key: "flowId", width: 28 },
  { header: "Step Order", key: "stepOrder", width: 14 },
  { header: "Step ID", key: "stepId", width: 32 },
  { header: "Step / Node Name", key: "stepName", width: 30 },
  { header: "Action / Type", key: "actionType", width: 20 },
  { header: "Step Status", key: "stepStatus", width: 16 },
  { header: "Error Summary", key: "errorSummary", width: 60 },
  { header: "Attempts", key: "attemptCount", width: 12 },
  { header: "Retries", key: "retryCount", width: 12 },
  { header: "Failure Policy", key: "failurePolicy", width: 18 }
];

/** Safe, deterministic report exports. Runtime inputs, outputs, cookies and browser state are absent. */
export class ReportExportService {
  private readonly masker = new SecretMasker();

  async export(report: ConcurrentRunReport & { id?: string }, format: ReportExportFormat): Promise<ReportExportArtifact> {
    const stem = `report-${this.safeFilename(report.executionId)}`;
    if (format === "xlsx") {
      const bytes = await this.toWorkbook(report);
      return {
        filename: `${stem}.xlsx`,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        dataBase64: Buffer.from(bytes).toString("base64")
      };
    }
    const text = format === "csv" ? this.toCsv(report) : JSON.stringify(this.safeDocument(report), null, 2);
    return {
      filename: `${stem}.${format}`,
      mimeType: format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8",
      dataBase64: Buffer.from(text, "utf8").toString("base64")
    };
  }

  private safeDocument(report: ConcurrentRunReport): Record<string, unknown> {
    return {
      summary: {
        runId: report.executionId,
        workflowId: report.scenarioId,
        workflowName: this.mask(report.scenarioName),
        result: report.status,
        startedAt: report.startedAt,
        endedAt: report.endedAt,
        durationMs: report.durationMs,
        runMode: report.runMode,
        maxConcurrentInstances: report.maxConcurrentInstances,
        passedFlows: report.passedFlows,
        failedFlows: report.failedFlows,
        skippedFlows: report.skippedFlows,
        security: report.security,
        legacyCompatibility: report.legacyCompatibility
      },
      instances: report.instances.map((instance) => this.safeInstance(instance)),
      steps: this.stepRows(report)
    };
  }

  private safeInstance(instance: InstanceReport): Record<string, unknown> {
    return {
      instanceId: instance.instanceId,
      status: instance.status,
      durationMs: instance.durationMs,
      dataSetIteration: instance.currentDataRowIndex,
      errorSummary: this.mask(instance.error ?? "")
    };
  }

  private stepRows(report: ConcurrentRunReport): StepRow[] {
    const rows: StepRow[] = [];
    for (const instance of report.instances) {
      const flows = instance.scenarioResult?.flows ?? [];
      for (const flow of flows) {
        flow.steps.forEach((step, index) => rows.push({
          runId: report.executionId,
          workflowId: report.scenarioId,
          workflowName: this.mask(report.scenarioName),
          overallResult: report.status,
          runStartedAt: report.startedAt,
          runEndedAt: report.endedAt,
          runDurationMs: report.durationMs,
          instanceId: instance.instanceId,
          instanceResult: instance.status,
          dataSetIteration: instance.currentDataRowIndex ?? "",
          flowId: flow.flowId,
          stepOrder: index + 1,
          stepId: step.stepId,
          stepName: this.mask(step.stepName ?? step.stepId),
          actionType: step.actionType ?? "",
          stepStatus: step.status,
          errorSummary: this.mask(step.error ?? ""),
          attemptCount: step.attemptCount ?? 1,
          retryCount: Math.max(0, (step.attemptCount ?? 1) - 1),
          failurePolicy: step.failurePolicy ?? ""
        }));
      }
      if (flows.length === 0) rows.push(this.emptyInstanceRow(report, instance));
    }
    return rows;
  }

  private emptyInstanceRow(report: ConcurrentRunReport, instance: InstanceReport): StepRow {
    return {
      runId: report.executionId,
      workflowId: report.scenarioId,
      workflowName: this.mask(report.scenarioName),
      overallResult: report.status,
      runStartedAt: report.startedAt,
      runEndedAt: report.endedAt,
      runDurationMs: report.durationMs,
      instanceId: instance.instanceId,
      instanceResult: instance.status,
      dataSetIteration: instance.currentDataRowIndex ?? "",
      flowId: "", stepOrder: "", stepId: "", stepName: "", actionType: "", stepStatus: "",
      errorSummary: this.mask(instance.error ?? ""), attemptCount: "", retryCount: "", failurePolicy: ""
    };
  }

  private toCsv(report: ConcurrentRunReport): string {
    const headers = STEP_COLUMNS.map((column) => column.header);
    const lines = [headers, ...this.stepRows(report).map((row) => STEP_COLUMNS.map((column) => row[column.key]))];
    return `\uFEFF${lines.map((line) => line.map((value) => this.csvCell(value)).join(",")).join("\r\n")}`;
  }

  private csvCell(value: unknown): string {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  private async toWorkbook(report: ConcurrentRunReport): Promise<Uint8Array> {
    const workbook = new Workbook();
    workbook.creator = "SpecterStudio";
    workbook.created = new Date(report.startedAt);

    const summary = workbook.addWorksheet("Summary", { views: [{ state: "frozen", ySplit: 1 }] });
    summary.columns = [{ header: "Field", key: "field", width: 30 }, { header: "Value", key: "value", width: 70 }];
    Object.entries(this.safeDocument(report).summary as Record<string, unknown>).forEach(([field, value]) => {
      summary.addRow({ field, value: typeof value === "object" ? JSON.stringify(value) : value ?? "" });
    });

    const instances = workbook.addWorksheet("Instances", { views: [{ state: "frozen", ySplit: 1 }] });
    instances.columns = [
      { header: "Instance ID", key: "instanceId", width: 38 },
      { header: "Result", key: "status", width: 16 },
      { header: "Duration (ms)", key: "durationMs", width: 18 },
      { header: "Data Set / Iteration", key: "dataSetIteration", width: 20 },
      { header: "Error Summary", key: "errorSummary", width: 70 }
    ];
    report.instances.forEach((instance) => instances.addRow(this.safeInstance(instance)));

    const steps = workbook.addWorksheet("Steps", { views: [{ state: "frozen", ySplit: 1 }] });
    steps.columns = STEP_COLUMNS;
    this.stepRows(report).forEach((row) => steps.addRow(row));
    for (const sheet of [summary, instances, steps]) {
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
      sheet.getRow(1).font = { bold: true };
    }
    const buffer = await workbook.xlsx.writeBuffer();
    return new Uint8Array(buffer as unknown as ArrayBuffer);
  }

  private mask(value: string): string {
    return this.masker.maskText(value);
  }

  private safeFilename(value: string): string {
    return value.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80) || "run";
  }
}
