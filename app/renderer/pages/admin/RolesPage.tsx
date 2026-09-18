import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, KeyRound, Pencil, Play, Plus, Settings, Shield, ShieldCheck, Trash2, type LucideIcon } from "lucide-react";
import { ALL_PERMISSIONS } from "@src/security/authz/Permissions";
import type { AdminRoleView } from "@src/security/admin/RoleAdminService";
import type { AdminUserView } from "@src/security/admin/UserAdminService";
import { useSession } from "../../security/SessionContext";
import { routes } from "../../routes";
import {
  SysAdminHead,
  SysBanner,
  SysButton,
  SysCheckPill,
  SysCheckRow,
  SysChecklist,
  SysField,
  SysFormError,
  SysModal,
  SysModalFields,
  SysModalRow,
  SysModalRows,
  SysPage,
  SysPanel,
  SysPanelEmpty,
  SysPanels,
  type SysTone
} from "../../components/system/SystemUI";
import { adminReasonMessage } from "./adminMessages";
import { ReauthDialog } from "./ReauthDialog";
import { groupPermissions } from "./permissionGroups";

type AdminResponse<T> = { ok: boolean; value?: T; reason?: string; errors?: string[] };
const security = () => window.playwrightFlowStudio.security;

const ROLE_LOOK: Record<string, { icon: LucideIcon; tone: SysTone }> = {
  SuperUser: { icon: ShieldCheck, tone: "success" },
  Administrator: { icon: Settings, tone: "running" },
  Operator: { icon: Play, tone: "running" },
  Viewer: { icon: Eye, tone: "running" },
  Issuer: { icon: KeyRound, tone: "warning" }
};

interface GroupCoverage {
  label: string;
  granted: string[];
  denied: string[];
  tone: SysTone;
  badge: string;
}

/** Per-capability-group coverage of one role: every group reads Granted, Partial or Denied. */
function roleCoverage(role: AdminRoleView): GroupCoverage[] {
  return groupPermissions(ALL_PERMISSIONS).map(([label, permissions]) => {
    const granted = permissions.filter((permission) => role.permissions.includes(permission));
    const denied = permissions.filter((permission) => !role.permissions.includes(permission));
    const tone: SysTone = granted.length === permissions.length ? "success" : granted.length === 0 ? "danger" : "warning";
    const badge = tone === "success" ? "Granted" : tone === "danger" ? "Denied" : `Partial · ${granted.length} of ${permissions.length}`;
    return { label, granted, denied, tone, badge };
  });
}

function preview(list: string[], limit = 3): string {
  return list.length <= limit ? list.join(", ") : `${list.slice(0, limit).join(", ")} +${list.length - limit} more`;
}

/** Built-in role reference plus Super-User CRUD for persisted custom roles. */
export function RolesPage() {
  const sessionRef = useSession()?.principal.sessionRef ?? "";
  const [roles, setRoles] = useState<AdminRoleView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<{ role: AdminRoleView | null } | null>(null);
  const [detail, setDetail] = useState<AdminRoleView | null>(null);
  const [deleting, setDeleting] = useState<AdminRoleView | null>(null);
  const [pendingFn, setPendingFn] = useState<(() => Promise<AdminResponse<unknown>>) | null>(null);
  /** Assigned-user counts per role id; null when the caller can't read the user directory. */
  const [assignedUsers, setAssignedUsers] = useState<Map<string, number> | null>(null);

  const reload = useCallback(async () => {
    const result = await security().admin.listRoles(sessionRef);
    if (result.ok && result.value) setRoles(result.value);
    else setError(adminReasonMessage(result.reason));
    setLoading(false);
    // Best-effort assignment counts: the Users read is a separate privilege, so an unauthorized
    // caller simply gets no member counts rather than an error.
    const users = await security().admin.listUsers(sessionRef);
    if (users.ok && users.value) {
      const counts = new Map<string, number>();
      for (const user of users.value as AdminUserView[]) {
        for (const roleId of user.roles) counts.set(roleId, (counts.get(roleId) ?? 0) + 1);
      }
      setAssignedUsers(counts);
    }
  }, [sessionRef]);

  useEffect(() => { void reload(); }, [reload]);

  const sensitive = useCallback(async (fn: () => Promise<AdminResponse<unknown>>) => {
    setError(null);
    setNotice(null);
    const result = await fn();
    if (!result.ok && result.reason === "REAUTH_REQUIRED") {
      setPendingFn(() => fn);
      return false;
    }
    if (!result.ok) {
      setError(adminReasonMessage(result.reason, result.errors));
      return false;
    }
    setNotice("Role change applied.");
    await reload();
    return true;
  }, [reload]);

  const members = (role: AdminRoleView) => {
    if (!assignedUsers) return null;
    const count = assignedUsers.get(role.id) ?? 0;
    return `${count} member${count === 1 ? "" : "s"}`;
  };
  const roleMeta = (role: AdminRoleView) =>
    [role.builtIn ? "Built-in" : "Custom", role.id === "SuperUser" ? "protected" : null, members(role)].filter(Boolean).join(" · ");

  return (
    <SysPage className="roles-page">
      <SysAdminHead
        title="Roles"
        description={routes.find((route) => route.id === "roles")?.description}
        actions={
          <SysButton kind="primary" icon={Plus} disabled={loading} onClick={() => { setError(null); setEditor({ role: null }); }}>
            Create role
          </SysButton>
        }
      />
      <SysBanner tone="info" icon={ShieldCheck}>
        Built-in roles cannot be edited or deleted. Create a custom role to grant a different combination of permissions.
      </SysBanner>
      {error ? <SysBanner tone="danger">{error}</SysBanner> : null}
      {notice ? <SysBanner tone="success">{notice}</SysBanner> : null}

      {loading ? (
        <SysPanel icon={ShieldCheck} title="Loading roles…">
          <SysPanelEmpty icon={ShieldCheck} title="Loading roles…" />
        </SysPanel>
      ) : (
        <SysPanels min={400}>
          {roles.map((role) => {
            const look = ROLE_LOOK[role.id] ?? { icon: Shield, tone: "info" as SysTone };
            return (
              <SysPanel
                key={role.id}
                icon={look.icon}
                tone={look.tone}
                title={role.name}
                meta={roleMeta(role)}
                className="roles-panel"
                actions={
                  <>
                    <SysButton kind="small" icon={Eye} onClick={() => setDetail(role)}>View detail</SysButton>
                    {role.builtIn ? null : (
                      <>
                        <SysButton kind="small" icon={Pencil} onClick={() => { setError(null); setEditor({ role }); }}>Edit</SysButton>
                        <SysButton kind="smallDanger" icon={Trash2} onClick={() => setDeleting(role)}>Delete</SysButton>
                      </>
                    )}
                  </>
                }
              >
                <SysChecklist label={`${role.name} permissions`}>
                  {roleCoverage(role).map((group) => (
                    <SysCheckRow
                      key={group.label}
                      tone={group.tone}
                      title={group.label}
                      sub={
                        group.tone === "danger"
                          ? `Not held — ${preview(group.denied)}`
                          : preview(group.granted)
                      }
                      badge={group.badge}
                    />
                  ))}
                </SysChecklist>
              </SysPanel>
            );
          })}
        </SysPanels>
      )}

      {editor ? (
        <RoleEditorModal
          role={editor.role}
          error={error}
          onCancel={() => setEditor(null)}
          onSave={async (input) => {
            const role = editor.role;
            const ok = await sensitive(() =>
              role
                ? security().admin.updateRole({ sessionRef, roleId: role.id, ...input })
                : security().admin.createRole({ sessionRef, ...input })
            );
            if (ok) setEditor(null);
          }}
        />
      ) : null}

      {detail ? (
        <SysModal
          icon={ROLE_LOOK[detail.id]?.icon ?? Shield}
          tone={ROLE_LOOK[detail.id]?.tone ?? "info"}
          title={detail.name}
          message={`${detail.description || "No description."} ${detail.builtIn ? "Built-in roles cannot be edited." : "Custom role — editable by a Super User."}`}
          onClose={() => setDetail(null)}
          actions={<SysButton kind="secondary" onClick={() => setDetail(null)}>Close</SysButton>}
        >
          <SysModalRows>
            <SysModalRow label="Members" value={members(detail) ?? "Requires Users access"} />
            <SysModalRow label="Permissions" value={`${detail.permissions.length} of ${ALL_PERMISSIONS.length}`} />
            {roleCoverage(detail).map((group) => (
              <SysModalRow
                key={group.label}
                label={group.label}
                value={group.granted.length ? preview(group.granted, 4) : "None"}
                badge={group.tone === "success" ? "Granted" : group.tone === "danger" ? "Denied" : "Partial"}
                badgeTone={group.tone}
              />
            ))}
          </SysModalRows>
        </SysModal>
      ) : null}

      {deleting ? (
        <SysModal
          role="alertdialog"
          tone="danger"
          icon={Trash2}
          width={400}
          title={`Delete ${deleting.name}?`}
          message="The role is removed from assigned users and their active sessions are ended."
          onClose={() => setDeleting(null)}
          actions={
            <>
              <SysButton kind="secondary" onClick={() => setDeleting(null)}>Cancel</SysButton>
              <SysButton
                kind="danger"
                onClick={() => {
                  const roleId = deleting.id;
                  setDeleting(null);
                  void sensitive(() => security().admin.deleteRole({ sessionRef, roleId }));
                }}
              >
                Delete role
              </SysButton>
            </>
          }
        />
      ) : null}

      {pendingFn ? (
        <ReauthDialog
          sessionRef={sessionRef}
          onCancel={() => setPendingFn(null)}
          onConfirmed={() => {
            const fn = pendingFn;
            setPendingFn(null);
            // A held create/edit that now succeeds closes its editor, exactly like the no-reauth path.
            if (fn) void sensitive(fn).then((ok) => { if (ok) setEditor(null); });
          }}
        />
      ) : null}
    </SysPage>
  );
}

function RoleEditorModal({
  role,
  error,
  onCancel,
  onSave
}: {
  role: AdminRoleView | null;
  error: string | null;
  onCancel: () => void;
  onSave: (input: { name: string; description?: string; permissions: string[] }) => Promise<void>;
}) {
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [permissions, setPermissions] = useState<string[]>(role?.permissions ?? []);
  const [busy, setBusy] = useState(false);
  const groups = useMemo(() => groupPermissions(ALL_PERMISSIONS), []);
  const canSave = name.trim().length >= 2 && !busy;
  const toggle = (permission: string) =>
    setPermissions((current) => (current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission]));
  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      await onSave({ name: name.trim(), description: description.trim() || undefined, permissions });
    } finally {
      setBusy(false);
    }
  };
  return (
    <SysModal
      icon={role ? Pencil : Plus}
      title={role ? "Edit custom role" : "Create role"}
      message="Custom roles are stored locally and enforced by the trusted authorization boundary. Anything not granted is denied."
      width={640}
      className="roles-editor-modal"
      onClose={onCancel}
      onSubmit={() => void save()}
      actions={
        <>
          <SysButton kind="secondary" onClick={onCancel}>Cancel</SysButton>
          <SysButton kind="primary" type="submit" disabled={!canSave}>{role ? "Save role" : "Create role"}</SysButton>
        </>
      }
    >
      <SysModalFields>
        <SysField label="Role name">
          <input className="sys-control" value={name} onChange={(event) => setName(event.target.value)} maxLength={64} autoFocus />
        </SysField>
        <SysField label="Description">
          <input className="sys-control" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={256} placeholder="Optional" />
        </SysField>
        <div className="sys-field is-wide roles-permission-groups" role="group" aria-label="Permissions">
          <span className="sys-field-label">Permissions · {permissions.length} selected</span>
          {groups.map(([label, groupPermissionsList]) => (
            <div className="roles-permission-group" key={label}>
              <span className="roles-permission-group-label">{label}</span>
              <span className="sys-check-pills">
                {groupPermissionsList.map((permission) => (
                  <SysCheckPill key={permission} checked={permissions.includes(permission)} onChange={() => toggle(permission)}>
                    <code>{permission}</code>
                  </SysCheckPill>
                ))}
              </span>
            </div>
          ))}
        </div>
        {error ? (
          <div className="sys-field is-wide">
            <SysFormError>{error}</SysFormError>
          </div>
        ) : null}
      </SysModalFields>
    </SysModal>
  );
}
