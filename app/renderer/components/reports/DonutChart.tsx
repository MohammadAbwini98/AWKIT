export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  /** Big number rendered in the middle (e.g. total). */
  centerLabel?: string;
  centerSub?: string;
}

/**
 * Hand-rolled SVG donut (no chart dependency). Uses stroke-dasharray arcs. A legend with values
 * accompanies it (rendered by the caller or via `segments`) so color is never the only signal.
 */
export function DonutChart({ segments, size = 148, thickness = 18, centerLabel, centerSub }: DonutChartProps) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const summary = segments.map((s) => `${s.label}: ${s.value}`).join(", ");

  return (
    <div className="awkit-donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={summary || "No data"}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--awkit-surface-inset)" strokeWidth={thickness} />
          {total > 0 &&
            segments.map((segment) => {
              const fraction = segment.value / total;
              const dash = fraction * circumference;
              const circle = (
                <circle
                  key={segment.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={segment.color}
                  strokeWidth={thickness}
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += dash;
              return circle;
            })}
        </g>
        {centerLabel ? (
          <text x="50%" y="47%" textAnchor="middle" className="awkit-donut-center">
            {centerLabel}
          </text>
        ) : null}
        {centerSub ? (
          <text x="50%" y="62%" textAnchor="middle" className="awkit-donut-center-sub">
            {centerSub}
          </text>
        ) : null}
      </svg>
    </div>
  );
}
