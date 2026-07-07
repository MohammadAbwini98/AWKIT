export interface TimelinePoint {
  x: number; // epoch ms
  y: number;
}

export interface TimelineSeries {
  label: string;
  color: string;
  points: TimelinePoint[];
}

interface ConsumptionTimelineProps {
  series: TimelineSeries[];
  /** Unit suffix for the y-axis max label (e.g. "%", " MB"). */
  unit?: string;
  height?: number;
}

const W = 700;
const PAD_L = 8;
const PAD_R = 8;
const PAD_T = 10;
const PAD_B = 22;

function formatTick(epoch: number): string {
  return new Date(epoch).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/**
 * Hand-rolled multi-series SVG timeline (no chart dependency). Shared x (time) domain, y auto-scaled
 * 0→max. Renders start/end time ticks + a legend with each series' latest value. Empty-safe.
 */
export function ConsumptionTimeline({ series, unit = "", height = 200 }: ConsumptionTimelineProps) {
  const allPoints = series.flatMap((s) => s.points);
  const summary = series.map((s) => `${s.label}: ${s.points.length} points`).join("; ");
  if (allPoints.length < 2) {
    return <p className="awkit-muted">Not enough history yet to draw a trend. Run some workflows and check back.</p>;
  }

  const xs = allPoints.map((p) => p.x);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const xSpan = xMax - xMin || 1;
  const yMax = Math.max(1, ...allPoints.map((p) => p.y));
  const plotW = W - PAD_L - PAD_R;
  const plotH = height - PAD_T - PAD_B;

  const mapX = (x: number) => PAD_L + ((x - xMin) / xSpan) * plotW;
  const mapY = (y: number) => PAD_T + (1 - y / yMax) * plotH;

  return (
    <div className="awkit-timeline">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={summary} className="awkit-timeline-svg">
        {/* baseline + top gridline */}
        <line x1={PAD_L} y1={PAD_T} x2={W - PAD_R} y2={PAD_T} stroke="var(--awkit-border)" strokeWidth="1" strokeDasharray="2 4" />
        <line x1={PAD_L} y1={PAD_T + plotH} x2={W - PAD_R} y2={PAD_T + plotH} stroke="var(--awkit-border)" strokeWidth="1" />
        <text x={PAD_L} y={PAD_T - 2} className="awkit-timeline-axis">
          {Math.round(yMax)}
          {unit}
        </text>
        {series.map((s) => {
          const path = s.points
            .slice()
            .sort((a, b) => a.x - b.x)
            .map((p, index) => `${index === 0 ? "M" : "L"}${mapX(p.x).toFixed(1)},${mapY(p.y).toFixed(1)}`)
            .join(" ");
          return <path key={s.label} d={path} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />;
        })}
        <text x={PAD_L} y={height - 6} className="awkit-timeline-axis">
          {formatTick(xMin)}
        </text>
        <text x={W - PAD_R} y={height - 6} textAnchor="end" className="awkit-timeline-axis">
          {formatTick(xMax)}
        </text>
      </svg>
      <div className="awkit-timeline-legend">
        {series.map((s) => {
          const last = s.points[s.points.length - 1];
          return (
            <span key={s.label}>
              <i style={{ background: s.color }} />
              {s.label}
              {last ? <strong>{Math.round(last.y)}{unit}</strong> : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}
