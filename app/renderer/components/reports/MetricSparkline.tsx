interface MetricSparklineProps {
  values: number[];
  width?: number;
  height?: number;
  /** Stroke color (defaults to the accent blue token). */
  stroke?: string;
  /** Accessible summary; falls back to a generic description. */
  ariaLabel?: string;
}

/**
 * Minimal inline SVG sparkline (≤120 points — callers aggregate upstream). Hand-rolled: no chart
 * dependency. Renders a flat baseline when there are 0–1 points.
 */
export function MetricSparkline({ values, width = 160, height = 40, stroke = "var(--awkit-blue)", ariaLabel }: MetricSparklineProps) {
  const points = values.slice(-120);
  const label = ariaLabel ?? `Trend of ${points.length} points`;
  if (points.length < 2) {
    return (
      <svg className="awkit-sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} preserveAspectRatio="none">
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="var(--awkit-border-strong)" strokeWidth="1.5" />
      </svg>
    );
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const stepX = width / (points.length - 1);
  const path = points
    .map((value, index) => {
      const x = index * stepX;
      const y = height - ((value - min) / span) * (height - 4) - 2;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg className="awkit-sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} preserveAspectRatio="none">
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
