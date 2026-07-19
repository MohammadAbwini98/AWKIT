import { useEffect, useMemo, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { useSession } from "../../security/SessionContext";
import { adminReasonMessage } from "./adminMessages";

interface RoleView { id: string; name: string; description: string; permissions: string[] }

/** Permission → role matrix: which built-in roles grant each permission (deny-by-default reference). */
export function PermissionsPage() {
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

  const permissions = useMemo(() => {
    const all = new Set<string>();
    roles.forEach((r) => r.permissions.forEach((p) => all.add(p)));
    return [...all].sort();
  }, [roles]);

  if (loading) return <div className="awkit-admin-page"><div className="awkit-login-loading"><Loader2 size={20} className="awkit-login-spin" /> Loading permissions…</div></div>;
  return (
    <div className="awkit-admin-page">
      {error ? <p className="form-message error" role="alert">{error}</p> : null}
      <section className="settings-card">
        <h2>Permission matrix</h2>
        <p className="awkit-admin-muted">Every permission and the built-in roles that grant it. Enforced deny-by-default in the main process.</p>
        <div className="awkit-admin-table-scroll">
          <table className="awkit-admin-table awkit-admin-matrix">
            <thead><tr><th>Permission</th>{roles.map((r) => <th key={r.id}>{r.name}</th>)}</tr></thead>
            <tbody>
              {permissions.map((perm) => (
                <tr key={perm}>
                  <td><code>{perm}</code></td>
                  {roles.map((r) => (
                    <td key={r.id} className="awkit-admin-matrix-cell">{r.permissions.includes(perm) ? <Check size={15} aria-label="granted" /> : <span aria-hidden="true">·</span>}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
