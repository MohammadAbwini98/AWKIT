/** Capability groups over the permission registry, shared by the Roles and Permissions pages. */
export const PERMISSION_GROUPS = [
  { label: "Application pages", prefixes: ["page."] },
  { label: "Workflows & execution", prefixes: ["workflow."] },
  { label: "Data & reports", prefixes: ["datasource.", "report."] },
  { label: "Configuration", prefixes: ["settings.", "debug.", "session.", "config."] },
  { label: "Administration", prefixes: ["user.", "role.", "audit."] },
  { label: "Licensing", prefixes: ["license."] },
  { label: "Semantic index", prefixes: ["semantic."] }
] as const;

const OTHER_GROUP = "Other capabilities";

export function permissionGroup(permission: string): string {
  return PERMISSION_GROUPS.find((group) => group.prefixes.some((prefix) => permission.startsWith(prefix)))?.label ?? OTHER_GROUP;
}

/** Permissions bucketed under the fixed group order (input order kept inside a group); empty groups drop. */
export function groupPermissions(permissions: readonly string[]): Array<[string, string[]]> {
  const groups = new Map<string, string[]>();
  for (const permission of permissions) {
    const label = permissionGroup(permission);
    groups.set(label, [...(groups.get(label) ?? []), permission]);
  }
  return [...PERMISSION_GROUPS.map((group) => group.label), OTHER_GROUP].flatMap((label): Array<[string, string[]]> => {
    const list = groups.get(label);
    return list ? [[label, list]] : [];
  });
}
