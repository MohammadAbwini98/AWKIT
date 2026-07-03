import { ArrowLeft } from "lucide-react";
import type { AppRoute } from "../routes";
import type { PageAction } from "../state/pageChrome";

interface TopHeaderProps {
  activeRoute: AppRoute;
  actions: PageAction[];
  canGoBack: boolean;
  onBack: () => void;
}

export function TopHeader({ activeRoute, actions, canGoBack, onBack }: TopHeaderProps) {
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
