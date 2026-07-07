import type { ReactNode } from "react";

interface EmptyStateProps {
  title: ReactNode;
  /** Guidance on how to populate this surface. */
  hint?: ReactNode;
  icon?: ReactNode;
  /** Optional call-to-action (e.g. "Run a workflow"). */
  action?: ReactNode;
  /** Compact variant for inline/section empties. */
  compact?: boolean;
}

/**
 * Centered empty state for report/dashboard surfaces. Namespaced `awkit-` to avoid clashing with
 * the existing `.empty-state` class already used by the current pages.
 */
export function EmptyState({ title, hint, icon, action, compact }: EmptyStateProps) {
  return (
    <div className={compact ? "awkit-empty-state is-compact" : "awkit-empty-state"} role="status">
      {icon ? <span className="awkit-empty-state-icon">{icon}</span> : null}
      <strong>{title}</strong>
      {hint ? <span className="awkit-empty-state-hint">{hint}</span> : null}
      {action ? <div className="awkit-empty-state-action">{action}</div> : null}
    </div>
  );
}
