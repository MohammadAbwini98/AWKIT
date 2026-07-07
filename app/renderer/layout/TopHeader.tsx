import { ArrowLeft } from "lucide-react";
import type { AppRoute } from "../routes";
import type { PageAction } from "../state/pageChrome";

interface TopHeaderProps {
  activeRoute: AppRoute;
  actions: PageAction[];
  canGoBack: boolean;
  dirty: boolean;
  onBack: () => void;
}

export function TopHeader({ activeRoute, actions, canGoBack, dirty, onBack }: TopHeaderProps) {
  return (
    <header className="top-header">
      <button
        className="icon-button"
        aria-label="Back"
        disabled={!canGoBack}
        onClick={onBack}
        title={canGoBack ? "Back to previous page" : "No previous page"}
        type="button"
      >
        <ArrowLeft size={18} />
      </button>
      <div className="header-title">
        <strong>{activeRoute.label}</strong>
        <span>{activeRoute.description}</span>
      </div>
      {/* Real page state only — the chip appears solely when the active editor has unsaved changes. */}
      {dirty ? <span className="header-status-chip">Unsaved changes</span> : null}
      <div className="header-actions">
        {actions.map((action) => (
          <button
            key={action.id}
            className={action.variant === "primary" ? "toolbar-button primary" : "toolbar-button"}
            disabled={action.disabled}
            onClick={action.onClick}
            title={action.title ?? action.label}
            type="button"
          >
            {action.label}
          </button>
        ))}
      </div>
    </header>
  );
}
