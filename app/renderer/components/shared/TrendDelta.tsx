import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

interface TrendDeltaProps {
  /** Signed percentage change (e.g. 12.5 or -8). */
  percent: number;
  /**
   * Whether an increase should read as good (green) or bad (red). Failure/duration metrics set
   * `higherIsBetter={false}`; success-rate/throughput leave the default.
   */
  higherIsBetter?: boolean;
  /** Suppresses tone color when the metric is neutral (informational only). */
  neutral?: boolean;
}

/** Directional delta chip with an accessible label; color is paired with an arrow icon. */
export function TrendDelta({ percent, higherIsBetter = true, neutral = false }: TrendDeltaProps) {
  const rounded = Math.round(percent * 10) / 10;
  const direction = rounded > 0 ? "up" : rounded < 0 ? "down" : "flat";
  const good = direction === "flat" ? true : (direction === "up") === higherIsBetter;
  const tone = neutral || direction === "flat" ? "neutral" : good ? "good" : "bad";
  const magnitude = Math.abs(rounded);
  const label =
    direction === "flat" ? "No change" : `${direction === "up" ? "Up" : "Down"} ${magnitude}%`;

  return (
    <span className={`awkit-trend-delta tone-${tone}`} aria-label={label}>
      {direction === "up" ? (
        <ArrowUpRight size={14} aria-hidden="true" />
      ) : direction === "down" ? (
        <ArrowDownRight size={14} aria-hidden="true" />
      ) : (
        <Minus size={14} aria-hidden="true" />
      )}
      <span aria-hidden="true">{magnitude}%</span>
    </span>
  );
}
