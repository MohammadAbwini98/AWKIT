import { Fragment, useEffect, useMemo, useState } from "react";
import { Ban, CheckCircle2, Download, ListChecks } from "lucide-react";
import { ALL_PERMISSIONS } from "@src/security/authz/Permissions";
import { useSession } from "../../security/SessionContext";
import { RoutePermissions } from "../../security/routePermissions";
import { routes } from "../../routes";
import {
  SysAdminHead,
  SysBadge,
  SysBanner,
  SysButton,
  SysCellText,
  SysPage,
  SysPagination,
  SysTable,
  SysTableCard,
  SysTableEmpty,
  SysTh,
  useSysPaging,
  useSysSort
} from "../../components/system/SystemUI";
import { adminReasonMessage } from "./adminMessages";
import { groupPermissions } from "./permissionGroups";

interface RoleView { id: string; name: string; description: string; builtIn: boolean; permissions: string[] }

/** Route ids gated by each permission (inverse of the renderer route → permission map). */
function routesByPermission(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [routeId, permission] of Object.entries(RoutePermissions)) {
    if (!permission) continue;
    map.set(permission, [...(map.get(permission) ?? []), routeId]);
  }
  return map;
}

/** Permission → role matrix across built-in and custom roles (deny-by-default reference). */
export function PermissionsPage() {
  const sessionRef = useSession()?.principal.sessionRef ?? "";
  const [roles, setRoles] = useState<RoleView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { sort, toggle: toggleSort } = useSysSort("permission");

  useEffect(() => {
    void window.playwrightFlowStudio.security.admin.listRoles(sessionRef).then((r) => {
      if (r.ok && r.value) setRoles(r.value);
      else setError(adminReasonMessage(r.reason));
      setLoading(false);
    });
  }, [sessionRef]);

  const routeMap = useMemo(routesByPermission, []);
  // Flattened, grouped rows. The sort orders permissions WITHIN their capability group so the group
  // structure survives any sort direction.
  const rows = useMemo(() => {
    const direction = sort.dir === "asc" ? 1 : -1;
    return groupPermissions(ALL_PERMISSIONS).flatMap(([group, permissions]) =>
      [...permissions].sort((a, b) => a.localeCompare(b) * direction).map((permission) => ({ group, permission }))
    );
  }, [sort.dir]);
  const paging = useSysPaging(rows.length);
  const pageRows = paging.slice(rows);

  const exportMatrix = () => {
    const matrix = {
      exportedAt: new Date().toISOString(),
      roles: roles.map((role) => ({ id: role.id, name: role.name, builtIn: role.builtIn })),
      permissions: rows.map(({ group, permission }) => ({
        permission,
        group,
        routes: routeMap.get(permission) ?? [],
        grantedTo: roles.filter((role) => role.permissions.includes(permission)).map((role) => role.id)
      }))
    };
    const href = URL.createObjectURL(new Blob([JSON.stringify(matrix, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = href;
    link.download = "specterstudio-permission-matrix.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 0);
  };

  return (
    <SysPage className="permissions-page">
      <SysAdminHead
        title="Permissions"
        description={routes.find((route) => route.id === "permissionsMatrix")?.description}
        actions={
          <SysButton kind="secondary" icon={Download} disabled={loading || roles.length === 0} onClick={exportMatrix}>
            Export matrix
          </SysButton>
        }
      />
      <SysBanner tone="info" icon={ListChecks}>
        Deny-by-default reference. A route absent from the permission map is treated as dashboard-visible; the real
        authorisation boundary is the main-process IPC check.
      </SysBanner>
      {error ? <SysBanner tone="danger">{error}</SysBanner> : null}

      <SysTableCard title="Permission to role matrix" className="permissions-matrix-card">
        {loading ? (
          <SysTableEmpty icon={ListChecks} title="Loading permissions…" />
        ) : roles.length === 0 ? (
          <SysTableEmpty icon={ListChecks} title="No roles found" hint="Roles could not be read for this session." />
        ) : (
          <SysTable minWidth={Math.max(1000, 530 + roles.length * 110)} caption="Permission grants by role">
            <thead>
              <tr>
                <SysTh label="Permission" sortKey="permission" sort={sort} onSort={toggleSort} width={230} />
                <SysTh label="Routes" width={300} />
                {roles.map((role) => (
                  <SysTh key={role.id} label={role.name} align="center" width={110} />
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map(({ group, permission }, index) => {
                const startsGroup = index === 0 || pageRows[index - 1].group !== group;
                const routeIds = routeMap.get(permission) ?? [];
                return (
                  <Fragment key={permission}>
                    {startsGroup ? (
                      <tr className="is-group">
                        <td colSpan={roles.length + 2}>{group}</td>
                      </tr>
                    ) : null}
                    <tr>
                      <td>
                        <SysCellText mono strong>
                          {permission}
                        </SysCellText>
                      </td>
                      <td>
                        <SysCellText muted wrap>
                          {routeIds.length ? routeIds.join(", ") : "—"}
                        </SysCellText>
                      </td>
                      {roles.map((role) => (
                        <td key={role.id} className="permissions-grant-cell">
                          {role.permissions.includes(permission) ? (
                            <SysBadge tone="success" icon={CheckCircle2}>Allow</SysBadge>
                          ) : (
                            <SysBadge tone="neutral" icon={Ban}>Deny</SysBadge>
                          )}
                        </td>
                      ))}
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </SysTable>
        )}
        <SysPagination
          total={rows.length}
          noun="permissions"
          page={paging.page}
          pageSize={paging.pageSize}
          totalPages={paging.totalPages}
          onPage={paging.setPage}
          onPageSize={paging.setPageSize}
        />
      </SysTableCard>
    </SysPage>
  );
}
