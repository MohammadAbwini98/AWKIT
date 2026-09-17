import { useCallback, useState, type ReactNode } from "react";
import { Download, RefreshCw } from "lucide-react";
import type { TelemetryRangePreset } from "@src/reports/TelemetryContracts";
import { Permission } from "@src/security/authz/Permissions";
import { SectionHeader } from "../shared/SectionHeader";
import { usePermissions } from "../../security/usePermissions";
import { usePageChrome } from "../../state/pageChrome";
import { TimeRangeSelector } from "./TimeRangeSelector";
import { exportReportSnapshot } from "./reportExport";

interface ReportPageProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  /** When provided, renders the shared time-range selector in the header. */
  range?: TelemetryRangePreset;
  onRangeChange?: (value: TelemetryRangePreset) => void;
  onRefresh?: () => void;
  /** Spins the refresh icon while a query is in flight. */
  refreshing?: boolean;
  /** Current production snapshot exported from the shared top-header action. */
  exportData?: unknown;
  exportName?: string;
  children: ReactNode;
}

/** Standard report-page layout: page-enter animation + header (range + refresh) + content. */
export function ReportPage({ title, description, icon, range, onRangeChange, onRefresh, refreshing, exportData, exportName = "specterstudio-report", children }: ReportPageProps) {
  const { can } = usePermissions();
  const [refreshedAt, setRefreshedAt] = useState(() => new Date());
  const canExport = can(Permission.REPORT_EXPORT) && exportData !== undefined;
  const exportSnapshot = useCallback(() => exportReportSnapshot(exportName, exportData), [exportData, exportName]);
  usePageChrome(
    {
      actions: canExport ? [{ id: "export", label: "Export", icon: <Download size={15} />, onClick: exportSnapshot }] : [],
      dirty: false
    },
    [canExport, exportSnapshot]
  );

  const refresh = () => {
    onRefresh?.();
    setRefreshedAt(new Date());
  };
  const rangeLabel: Partial<Record<TelemetryRangePreset, string>> = {
    "15m": "last 15 minutes",
    "1h": "last hour",
    "24h": "last 24 hours",
    "7d": "last 7 days",
    all: "all recorded history"
  };
  const reportDescription = range
    ? `Showing the ${rangeLabel[range]} · refreshed ${refreshedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : description;
  const actions = (
    <>
      {range && onRangeChange ? <TimeRangeSelector value={range} onChange={onRangeChange} /> : null}
      {onRefresh ? (
        <button
          type="button"
          className="awkit-icon-button awkit-report-refresh"
          onClick={refresh}
          aria-label="Refresh"
          aria-busy={refreshing || undefined}
          title="Refresh"
        >
          <RefreshCw size={16} className={refreshing ? "awkit-spin" : ""} />
        </button>
      ) : null}
    </>
  );

  return (
    <section className="page awkit-report-page">
      <SectionHeader title={title} description={reportDescription} icon={icon} actions={actions} />
      {children}
    </section>
  );
}
