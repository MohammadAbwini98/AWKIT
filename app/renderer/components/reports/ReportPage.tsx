import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import type { TelemetryRangePreset } from "@src/reports/TelemetryContracts";
import { SectionHeader } from "../shared/SectionHeader";
import { TimeRangeSelector } from "./TimeRangeSelector";

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
  children: ReactNode;
}

/** Standard report-page layout: page-enter animation + header (range + refresh) + content. */
export function ReportPage({ title, description, icon, range, onRangeChange, onRefresh, refreshing, children }: ReportPageProps) {
  const actions = (
    <>
      {range && onRangeChange ? <TimeRangeSelector value={range} onChange={onRangeChange} /> : null}
      {onRefresh ? (
        <button type="button" className="awkit-icon-button" onClick={onRefresh} aria-label="Refresh" title="Refresh">
          <RefreshCw size={16} className={refreshing ? "awkit-spin" : ""} />
        </button>
      ) : null}
    </>
  );

  return (
    <section className="page awkit-report-page">
      <SectionHeader title={title} description={description} icon={icon} actions={actions} />
      {children}
    </section>
  );
}
