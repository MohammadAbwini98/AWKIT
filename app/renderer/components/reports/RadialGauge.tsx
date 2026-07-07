const CX = 100;
const CY = 100;
const R = 80;

interface Band {
  upTo: number; // percent boundary (0-100)
  color: string;
}

const DEFAULT_BANDS: Band[] = [
  { upTo: 60, color: "var(--awkit-band-normal)" },
  { upTo: 85, color: "var(--awkit-band-warning)" },
  { upTo: 100, color: "var(--awkit-band-high)" }
];

interface RadialGaugeProps {
  /** 0–100. Values are clamped. `undefined` renders a neutral "unavailable" dial. */
  value: number | undefined;
  /** Center caption under the value (e.g. "% pool"). */
  unit?: string;
  bands?: Band[];
}

/** Top-semicircle (180°) gauge: value 0 → left, 100 → right. Needle sweeps via a CSS-rotated line. */
function polar(percent: number): { x: number; y: number } {
  const angle = (180 - (percent / 100) * 180) * (Math.PI / 180);
  return { x: CX + R * Math.cos(angle), y: CY - R * Math.sin(angle) };
}

function bandArc(fromPct: number, toPct: number): string {
  const a = polar(fromPct);
  const b = polar(toPct);
  // Top semicircle traversed left→right is the counter-clockwise (sweep-flag 0) direction.
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${R} ${R} 0 0 0 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

function bandColorFor(value: number, bands: Band[]): string {
  return bands.find((band) => value <= band.upTo)?.color ?? bands[bands.length - 1].color;
}

export function RadialGauge({ value, unit, bands = DEFAULT_BANDS }: RadialGaugeProps) {
  const available = value !== undefined && !Number.isNaN(value);
  const clamped = available ? Math.min(100, Math.max(0, value)) : 0;
  // Needle base points straight up (12 o'clock); rotate -90°..+90° across the dial.
  const rotation = (clamped / 100) * 180 - 90;
  let cursor = 0;

  return (
    <svg className="awkit-gauge" viewBox="0 0 200 128" role="img" aria-label={available ? `${Math.round(clamped)}%${unit ? ` ${unit}` : ""}` : "Metric unavailable"}>
      {/* colored zone bands (or a single neutral track when unavailable) */}
      {available ? (
        bands.map((band) => {
          const arc = bandArc(cursor, band.upTo);
          const el = <path key={band.upTo} d={arc} fill="none" stroke={band.color} strokeWidth="12" strokeLinecap="butt" opacity="0.85" />;
          cursor = band.upTo;
          return el;
        })
      ) : (
        <path d={bandArc(0, 100)} fill="none" stroke="var(--awkit-surface-inset)" strokeWidth="12" strokeLinecap="round" />
      )}

      {available ? (
        <line
          className="awkit-gauge-needle"
          x1={CX}
          y1={CY}
          x2={CX}
          y2={CY - R + 12}
          stroke="var(--awkit-text)"
          strokeWidth="3"
          strokeLinecap="round"
          style={{ transform: `rotate(${rotation}deg)`, transformOrigin: `${CX}px ${CY}px` }}
        />
      ) : null}
      <circle cx={CX} cy={CY} r="6" fill="var(--awkit-text)" />

      <text x={CX} y={CY - 18} textAnchor="middle" className="awkit-gauge-value" fill={available ? bandColorFor(clamped, bands) : "var(--awkit-text-muted)"}>
        {available ? `${Math.round(clamped)}%` : "—"}
      </text>
      {unit ? (
        <text x={CX} y={CY + 20} textAnchor="middle" className="awkit-gauge-unit">
          {unit}
        </text>
      ) : null}
    </svg>
  );
}
