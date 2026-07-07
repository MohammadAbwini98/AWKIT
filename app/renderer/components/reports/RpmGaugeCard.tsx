import { Info } from "lucide-react";
import { RadialGauge } from "./RadialGauge";

interface RpmGaugeCardProps {
  title: string;
  /** 0–100, or undefined for an unavailable/neutral dial. */
  value: number | undefined;
  unit?: string;
  /** Short caption under the gauge (e.g. "3 / 8 browsers"). */
  caption?: string;
  /** Tooltip documenting the metric source + formula (required for every gauge). */
  tooltip: string;
  /** Adds a subtle pulse when the value is in the high band. */
  pulseHigh?: boolean;
}

export function RpmGaugeCard({ title, value, unit, caption, tooltip, pulseHigh }: RpmGaugeCardProps) {
  const high = pulseHigh && value !== undefined && value >= 85;
  return (
    <article className={high ? "awkit-gauge-card is-high" : "awkit-gauge-card"}>
      <header>
        <span>{title}</span>
        <span className="awkit-gauge-info" title={tooltip} aria-label={tooltip}>
          <Info size={13} />
        </span>
      </header>
      <RadialGauge value={value} unit={unit} />
      <p className="awkit-gauge-caption">{caption ?? " "}</p>
    </article>
  );
}
