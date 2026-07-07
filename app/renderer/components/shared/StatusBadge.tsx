import type { ReactNode } from "react";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral" | "running";

interface StatusBadgeProps {
  /** Visual tone. Pair with a clear label — color is never the only signal. */
  tone: StatusTone;
  label: string;
  icon?: ReactNode;
  /** Adds a soft pulse; use only for genuinely live/critical states. */
  pulse?: boolean;
}

/**
 * Small status pill used across instances, reports, and node cards. Namespaced `awkit-` so it does
 * not collide with the existing `.status-chip` / `.badge-*` classes already in global.css.
 */
export function StatusBadge({ tone, label, icon, pulse }: StatusBadgeProps) {
  const className = `awkit-status-badge tone-${tone}${pulse ? " is-pulse" : ""}`;
  return (
    <span className={className}>
      {icon ? <span className="awkit-status-badge-icon">{icon}</span> : null}
      <span>{label}</span>
    </span>
  );
}
