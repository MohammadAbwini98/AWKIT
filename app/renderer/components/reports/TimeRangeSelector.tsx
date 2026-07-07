import type { TelemetryRangePreset } from "@src/reports/TelemetryContracts";

const OPTIONS: Array<{ value: TelemetryRangePreset; label: string }> = [
  { value: "15m", label: "15m" },
  { value: "1h", label: "1h" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "all", label: "All" }
];

interface TimeRangeSelectorProps {
  value: TelemetryRangePreset;
  onChange: (value: TelemetryRangePreset) => void;
}

/** Segmented time-range control shared by the report pages. */
export function TimeRangeSelector({ value, onChange }: TimeRangeSelectorProps) {
  return (
    <div className="awkit-range-selector" role="group" aria-label="Time range">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? "is-active" : ""}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
