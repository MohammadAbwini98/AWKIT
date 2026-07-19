import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { useSession } from "../../security/SessionContext";
import { adminReasonMessage } from "./adminMessages";

interface RoleView { id: string; name: string; description: string; permissions: string[] }

/** Read-only view of the built-in roles and the permissions each grants (roles are immutable in v1). */
export function RolesPage() {
  const sessionRef = useSession()?.principal.sessionRef ?? "";
  const [roles, setRoles] = useState<RoleView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    void window.playwrightFlowStudio.security.admin.listRoles(sessionRef).then((r) => {
      if (r.ok && r.value) setRoles(r.value); else setError(adminReasonMessage(r.reason));
      setLoading(false);
    });
  }, [sessionRef]);
  if (loading) return <div className="awkit-admin-page"><div className="awkit-login-loading"><Loader2 size={20} className="awkit-login-spin" /> Loading roles…</div></div>;
  return (
    <div className="awkit-admin-page">
      {error ? <p className="form-message error" role="alert">{error}</p> : null}
      <p className="awkit-admin-muted">Built-in roles are fixed in this version. Assign them to users in Users. Custom roles are planned for a later release.</p>
      {roles.map((role) => (
        <section className="settings-card" key={role.id}>
          <h2><ShieldCheck size={16} /> {role.name}</h2>
          <p className="awkit-admin-muted">{role.description}</p>
          <div className="awkit-admin-perm-list">
            {role.permissions.map((p) => <span key={p} className="awkit-admin-role-chip">{p}</span>)}
          </div>
        </section>
      ))}
    </div>
  );
}
