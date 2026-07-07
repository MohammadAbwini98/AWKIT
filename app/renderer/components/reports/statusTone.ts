import type { StatusTone } from "../shared/StatusBadge";

/** Map a run/node status string to a StatusBadge tone. Shared by the report tables/drawers. */
export function statusToTone(status: string | undefined): StatusTone {
  switch ((status ?? "").toLowerCase()) {
    case "completed":
    case "passed":
    case "succeeded":
      return "success";
    case "failed":
    case "crashed":
    case "failedterminal":
      return "danger";
    case "cancelled":
    case "skipped":
      return "neutral";
    case "running":
    case "starting":
      return "running";
    case "waiting":
    case "waitingformanualaction":
    case "paused":
    case "orphaned":
      return "warning";
    default:
      return "neutral";
  }
}

/** Format a millisecond duration compactly (—, ms, s, m s). */
export function formatDurationMs(ms: number | undefined): string {
  if (ms === undefined || Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/** Local time-of-day + date for a run timestamp (or —). */
export function formatWhen(iso: string | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
