import { Fragment, useEffect, useMemo, useState } from "react";
import { Check, ListChecks } from "lucide-react";
import { useSession } from "../../security/SessionContext";
import { adminReasonMessage } from "./adminMessages";
import {
  AdminBanner,
  AdminLoading,
  AdminMetricCard,
  AdminMetrics,
  AdminPage,
  AdminSectionCard
} from "./components/AdminUi";

interface RoleView { id: string; name: string; description: string; builtIn: boolean; permissions: string[] }

const PERMISSION_GROUPS = [
  { label: "Application pages", prefixes: ["page."] },
  { label: "Workflows & execution", prefixes: ["workflow."] },
  { label: "Data & reports", prefixes: ["datasource.", "report."] },
  { label: "Configuration", prefixes: ["settings.", "debug.", "session.", "config."] },
  { label: "Administration", prefixes: ["user.", "role.", "audit."] },
  { label: "Licensing", prefixes: ["license."] },
  { label: "Semantic index", prefixes: ["semantic."] }
] as const;

function permissionGroup(permission: string): string {
  return PERMISSION_GROUPS.find((group) => group.prefixes.some((prefix) => permission.startsWith(prefix)))?.label ?? "Other capabilities";
}

/** Permission → role matrix across built-in and custom roles (deny-by-default reference). */
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
  const groupedPermissions = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const permission of permissions) {
      const label = permissionGroup(permission);
      groups.set(label, [...(groups.get(label) ?? []), permission]);
    }
    return [...PERMISSION_GROUPS.map((group) => group.label), "Other capabilities"]
      .flatMap((label) => groups.has(label) ? [[label, groups.get(label)!] as const] : []);
  }, [permissions]);

  if (loading) return <AdminPage><AdminLoading label="Loading permissions…" /></AdminPage>;
  const builtInRoles = roles.filter((role) => role.builtIn).length;
  return (
    <AdminPage
      title="Permissions"
      description="Review the deny-by-default capability model and the roles that grant each permission."
      banner={error ? <AdminBanner tone="error">{error}</AdminBanner> : undefined}
    >
      <AdminMetrics label="Permission summary">
        <AdminMetricCard label="Permissions" value={permissions.length} icon={ListChecks} />
        <AdminMetricCard label="Capability groups" value={groupedPermissions.length} hint="deny-by-default categories" />
        <AdminMetricCard label="Built-in roles" value={builtInRoles} hint="always present" />
        <AdminMetricCard label="Custom roles" value={roles.length - builtInRoles} hint={roles.length - builtInRoles > 0 ? "grant extra access" : undefined} />
      </AdminMetrics>

      <AdminSectionCard
        title="Permission matrix"
        icon={ListChecks}
        description="Every permission and the roles that grant it. Enforced deny-by-default in the main process."
        meta={<><Check size={13} aria-hidden="true" /> granted · · not granted</>}
      >
        <div className="awkit-admin-table-scroll">
          <table className="awkit-admin-table awkit-admin-matrix">
            <thead><tr><th>Permission</th>{roles.map((r) => <th key={r.id}>{r.name}</th>)}</tr></thead>
            <tbody>
              {groupedPermissions.map(([group, groupPermissions]) => (
                <Fragment key={group}>
                  <tr className="awkit-admin-matrix-group"><th colSpan={roles.length + 1} scope="rowgroup">{group}<span className="awkit-admin-matrix-count">{groupPermissions.length}</span></th></tr>
                  {groupPermissions.map((perm) => (
                    <tr key={perm}>
                      <td><code>{perm}</code></td>
                      {roles.map((r) => (
                        <td key={r.id} className="awkit-admin-matrix-cell">{r.permissions.includes(perm) ? <Check size={15} aria-label="granted" /> : <span aria-hidden="true">·</span>}</td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </AdminSectionCard>
    </AdminPage>
  );
}
