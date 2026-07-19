import { KeyRound } from "lucide-react";

/**
 * Licensing placeholder. Machine licensing (signed per-machine licenses, create/revoke) is a later phase;
 * this page reserves the surface so it can be added without restructuring authentication or authorization.
 * Deliberately not bound to IP address and kept separate from user authorization.
 */
export function LicensingPage() {
  return (
    <div className="awkit-admin-page">
      <section className="settings-card">
        <h2><KeyRound size={16} /> Licensing</h2>
        <p className="awkit-admin-muted">Machine licensing is not yet implemented.</p>
        <p>
          Per-machine signed licensing (issue, import, and revoke licenses bound to a machine fingerprint)
          is planned for a later release. It will be independent of user authentication and role-based
          authorization, so license state can never corrupt user or permission data.
        </p>
        <div className="awkit-admin-placeholder-list">
          <div className="awkit-admin-placeholder-item">Machine request code</div>
          <div className="awkit-admin-placeholder-item">Import signed license</div>
          <div className="awkit-admin-placeholder-item">Edition &amp; seat details</div>
          <div className="awkit-admin-placeholder-item">Revoke / replace</div>
        </div>
      </section>
    </div>
  );
}
