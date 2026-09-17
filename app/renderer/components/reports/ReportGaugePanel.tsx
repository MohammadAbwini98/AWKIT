import { RadialGauge } from "./RadialGauge";

export interface ReportGauge {
  label: string;
  value: number | undefined;
  display: string;
  unit: string;
  detail: string;
  color: string;
}

/** Reference-style consolidated pressure panel; every dial remains backed by a real metric. */
export function ReportGaugePanel({ gauges }: { gauges: ReportGauge[] }) {
  return (
    <section className="work-panel awkit-report-panel awkit-report-gauges awkit-report-span-12">
      <div className="awkit-report-panel-head">
        <div>
          <strong>Consumption pressure</strong>
          <span>Live Chrome and Playwright load — pressure gauges</span>
        </div>
        <span className="awkit-report-tag">Live</span>
      </div>
      <div className="awkit-report-gauge-row">
        {gauges.map((gauge) => (
          <div className="awkit-report-gauge" key={gauge.label}>
            <RadialGauge value={gauge.value} bands={[{ upTo: 100, color: gauge.color }]} />
            <strong>{gauge.display}</strong>
            <span>{gauge.unit}</span>
            <small>{gauge.detail}</small>
          </div>
        ))}
      </div>
    </section>
  );
}
