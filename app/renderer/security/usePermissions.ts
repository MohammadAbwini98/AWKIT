import { useMemo } from "react";
import { useSession } from "./SessionContext";
import { Permission } from "@src/security/authz/Permissions";

/**
 * Renderer permission helper — reads the authenticated principal's effective permissions (a UI hint from
 * the trusted layer) and exposes `can(perm)`. This drives nav/route/button visibility ONLY; the real
 * authorization boundary is the main-process IPC (`requirePermission`). Hiding a control is never the
 * security check — every restricted action also passes a main-process permission check.
 */
export function usePermissions() {
  const session = useSession();
  const permissionList = session?.principal.permissions;
  const isProtectedSuperUser = session?.principal.isProtectedSuperUser ?? false;
  return useMemo(() => {
    const set = new Set<string>(permissionList ?? []);
    return {
      permissions: set,
      isSuperUser: isProtectedSuperUser || set.has(Permission.USER_MANAGE),
      can: (permission: Permission | string) => set.has(permission)
    };
  }, [permissionList, isProtectedSuperUser]);
}
