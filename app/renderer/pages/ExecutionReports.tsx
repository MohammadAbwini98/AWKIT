/**
 * ExecutionReports — Phase 05
 *
 * Shows REAL reports only. No dummy/sample data.
 *
 * On first launch (or when no runs have completed), shows an empty state.
 * Real reports will appear here once workflow executions complete and the
 * ReportService writes them to the reports directory.
 *
 * Demo reports are completely removed. If needed for development, gate them
 * behind the env variable VITE_ENABLE_DEMO_REPORTS=true (default: false).
 */
import { Download, FileText, FolderOpen, RefreshCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
const DEMO_REPORTS_ENABLED = (import.meta as any).env?.VITE_ENABLE_DEMO_REPORTS === "true";

/** Minimal type matching what the IPC layer will eventually return. */
interface ReportSummary {
  id: string;
  workflowName: string;
  scenarioName?: string;
  status: string;
  startedAt: string;
  durationMs?: number;
  instanceCount?: number;
  reportPath?: string;
  /** Marker used to detect and clean up demo/seed records. */
  source?: string;
}

export function ExecutionReports() {
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // Attempt to load real reports from the IPC channel.
      // If not yet wired, this will throw or return an empty array — both are safe.
      const list: ReportSummary[] = await (window.playwrightFlowStudio as Record<string, unknown> & {
        reports?: { list: () => Promise<ReportSummary[]> };
      }).reports?.list?.() ?? [];

      // Filter out any records clearly marked as demo/sample/seed (Phase 05 cleanup).
      const realReports = list.filter((r) => r.source !== "demo" && r.source !== "sample" && r.source !== "seed");
      setReports(realReports);
    } catch {
      // IPC channel may not be wired yet — start empty, do not crash.
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openReport = useCallback((report: ReportSummary) => {
    if (!report.reportPath) return;
    // Shell open the folder/file when IPC is available.
    (window.playwrightFlowStudio as Record<string, unknown> & {
      shell?: { openPath: (p: string) => void };
    }).shell?.openPath?.(report.reportPath);
  }, []);

  const exportReport = useCallback((report: ReportSummary) => {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `report-${report.id}.json`;
    link.click();
    URL.revokeObjectURL(href);
  }, []);

  return (
    <section className="page reports-page">
      <section className="work-panel">
        <div className="section-heading">
          <h1>Execution Reports</h1>
          <span>
            {loading
              ? "Loading…"
              : reports.length === 0
                ? "No reports yet"
                : `${reports.length} report${reports.length !== 1 ? "s" : ""}`}
          </span>
        </div>

        {/* Toolbar */}
        <div className="library-toolbar">
          <button className="toolbar-button" id="reports-refresh" onClick={() => void load()} title="Refresh reports list" type="button">
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>

        {/* Error banner */}
        {error ? (
          <div className="validation-list">
            <span>{error}</span>
          </div>
        ) : null}

        {/* Content area */}
        {loading ? (
          <div className="reports-empty-state">
            <strong>Loading reports…</strong>
          </div>
        ) : reports.length === 0 ? (
          <div className="reports-empty-state" id="reports-empty-state">
            <FileText size={36} style={{ color: "var(--awkit-text-muted)" }} />
            <strong>No reports yet.</strong>
            <span>Run a workflow to generate your first execution report. Reports appear here after a workflow completes.</span>
          </div>
        ) : (
          <div className="reports-list" id="reports-list">
            {reports.map((report) => (
              <div className="report-card" key={report.id}>
                <div className="report-card-meta">
                  <strong>{report.workflowName}</strong>
                  <small>
                    {report.scenarioName ? `${report.scenarioName} · ` : ""}
                    Status: <span className={`state-pill ${report.status.toLowerCase()}`}>{report.status}</span>
                    {" · "}
                    {new Date(report.startedAt).toLocaleString()}
                    {report.durationMs !== undefined ? ` · ${formatDuration(report.durationMs)}` : ""}
                    {report.instanceCount !== undefined ? ` · ${report.instanceCount} instance${report.instanceCount !== 1 ? "s" : ""}` : ""}
                  </small>
                </div>
                <div className="report-card-actions">
                  {report.reportPath ? (
                    <button
                      className="toolbar-button"
                      id={`report-open-${report.id}`}
                      title="Open report folder"
                      type="button"
                      onClick={() => openReport(report)}
                    >
                      <FolderOpen size={14} />
                      Open
                    </button>
                  ) : null}
                  <button
                    className="toolbar-button"
                    id={`report-export-${report.id}`}
                    title="Export report JSON"
                    type="button"
                    onClick={() => exportReport(report)}
                  >
                    <Download size={14} />
                    Export
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Dev-only demo reports notice */}
        {DEMO_REPORTS_ENABLED ? (
          <div className="validation-list" style={{ marginTop: "12px" }}>
            <span>⚠ Demo reports are enabled (VITE_ENABLE_DEMO_REPORTS=true). Remove this flag before shipping.</span>
          </div>
        ) : null}

        {/* Security note */}
        <section className="report-section security-note" style={{ marginTop: "24px" }}>
          <TriangleAlert size={18} />
          <div>
            <strong>Security policy</strong>
            <span>Reports and logs mask secrets. MFA and CAPTCHA must use manual handoff and never bypass controls.</span>
          </div>
        </section>
      </section>
    </section>
  );
}

function formatDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}
