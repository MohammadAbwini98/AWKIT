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
import type { ConcurrentRunReport } from "@src/reports/ExecutionReport";
import { Permission } from "@src/security/authz/Permissions";
import { usePermissions } from "../security/usePermissions";

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
const DEMO_REPORTS_ENABLED = (import.meta as any).env?.VITE_ENABLE_DEMO_REPORTS === "true";

/** Persisted report contract returned by the main-owned report store. */
type StoredReport = ConcurrentRunReport & {
  id: string;
  /** Marker used to detect and clean up demo/seed records. */
  source?: string;
};

export function ExecutionReports() {
  const [reports, setReports] = useState<StoredReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { can } = usePermissions();
  const canExport = can(Permission.REPORT_EXPORT);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // Attempt to load real reports from the IPC channel.
      // If not yet wired, this will throw or return an empty array — both are safe.
      const list = (await window.playwrightFlowStudio.reports.list()) as StoredReport[];

      // Filter out any records clearly marked as demo/sample/seed (Phase 05 cleanup).
      const realReports = list.filter((r) => r.source !== "demo" && r.source !== "sample" && r.source !== "seed");
      setReports(realReports);
    } catch (cause) {
      // IPC channel may not be wired yet — start empty, do not crash.
      setReports([]);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openReport = useCallback(async (report: StoredReport) => {
    setError("");
    try {
      const message = await window.playwrightFlowStudio.reports.openFolder(report.id);
      if (message) setError(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const exportReport = useCallback(async (report: StoredReport) => {
    setError("");
    try {
      // Export the permission-gated stored record, not the lossy card projection.
      const complete = await window.playwrightFlowStudio.reports.export(report.id);
      const blob = new Blob([JSON.stringify(complete, null, 2)], { type: "application/json" });
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `report-${report.id}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
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
                  <strong>{report.scenarioName || report.scenarioId || "Workflow"}</strong>
                  <small>
                    Status: <span className={`state-pill ${report.status.toLowerCase()}`}>{report.status}</span>
                    {" · "}
                    {new Date(report.startedAt).toLocaleString()}
                    {report.durationMs !== undefined ? ` · ${formatDuration(report.durationMs)}` : ""}
                    {` · ${report.instances.length} instance${report.instances.length !== 1 ? "s" : ""}`}
                  </small>
                </div>
                <div className="report-card-actions">
                  {canExport ? (
                    <button
                      className="toolbar-button"
                      id={`report-open-${report.id}`}
                      title="Open report folder"
                      type="button"
                      onClick={() => void openReport(report)}
                    >
                      <FolderOpen size={14} />
                      Open
                    </button>
                  ) : null}
                  {canExport ? (
                    <button
                      className="toolbar-button"
                      id={`report-export-${report.id}`}
                      title="Export report JSON"
                      type="button"
                      onClick={() => void exportReport(report)}
                    >
                      <Download size={14} />
                      Export
                    </button>
                  ) : null}
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
