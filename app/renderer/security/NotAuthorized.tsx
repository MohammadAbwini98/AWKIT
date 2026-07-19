import { ShieldX } from "lucide-react";

/** Shown when a signed-in user navigates (or restores) to a route their role does not permit. */
export function NotAuthorized({ onGoHome }: { onGoHome?: () => void }) {
  return (
    <div className="awkit-admin-page">
      <section className="settings-card awkit-not-authorized">
        <span className="awkit-admin-modal-icon" aria-hidden="true"><ShieldX size={22} /></span>
        <h2>You don't have access to this page</h2>
        <p className="awkit-admin-muted">Your role doesn't include permission for this area. Contact a Super User if you need access.</p>
        {onGoHome ? <button className="toolbar-button primary" onClick={onGoHome}>Go to Dashboard</button> : null}
      </section>
    </div>
  );
}
