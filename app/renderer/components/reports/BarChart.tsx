export interface BarDatum {
  label: string;
  value: number;
  /** Optional per-bar color; defaults to the accent. */
  color?: string;
}

interface BarChartProps {
  data: BarDatum[];
  /** Horizontal bars (label + value rows). Good for category breakdowns. */
  maxBars?: number;
}

/**
 * Hand-rolled horizontal bar chart (no chart dependency). Renders labels + proportional bars +
 * values as accessible DOM (not SVG) so it degrades to readable text and scales with the container.
 */
export function BarChart({ data, maxBars = 12 }: BarChartProps) {
  const rows = data.slice(0, maxBars);
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <div className="awkit-bar-chart">
      {rows.map((row) => (
        <div className="awkit-bar-row" key={row.label}>
          <span className="awkit-bar-label" title={row.label}>
            {row.label}
          </span>
          <span className="awkit-bar-track">
            <span
              className="awkit-bar-fill"
              style={{ width: `${Math.round((row.value / max) * 100)}%`, background: row.color ?? "var(--awkit-blue)" }}
            />
          </span>
          <span className="awkit-bar-value">{row.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}
