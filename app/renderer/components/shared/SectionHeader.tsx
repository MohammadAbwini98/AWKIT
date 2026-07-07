import type { ReactNode } from "react";

interface SectionHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned actions (buttons, filters, refresh). */
  actions?: ReactNode;
  /** Optional element rendered before the title (icon). */
  icon?: ReactNode;
}

/**
 * Consistent page/section header for the reports surfaces. Namespaced `awkit-` to avoid clashing
 * with the existing `.section-heading` class used by the current pages.
 */
export function SectionHeader({ title, description, actions, icon }: SectionHeaderProps) {
  return (
    <header className="awkit-section-header">
      <div className="awkit-section-header-main">
        {icon ? <span className="awkit-section-header-icon">{icon}</span> : null}
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="awkit-section-header-actions">{actions}</div> : null}
    </header>
  );
}
