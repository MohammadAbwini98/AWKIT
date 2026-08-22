import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Pencil, Plus, ShieldCheck, Trash2, UserSquare } from "lucide-react";
import { ALL_PERMISSIONS } from "@src/security/authz/Permissions";
import type { AdminRoleView } from "@src/security/admin/RoleAdminService";
import type { AdminUserView } from "@src/security/admin/UserAdminService";
import { useSession } from "../../security/SessionContext";
import { adminReasonMessage } from "./adminMessages";
import { ReauthDialog } from "./ReauthDialog";
import {
  AdminBanner,
  AdminLoading,
  AdminMetricCard,
  AdminMetrics,
  AdminPage,
  AdminSectionCard
} from "./components/AdminUi";
import { ConfirmDialog } from "../../components/shared/ConfirmDialog";

type AdminResponse<T> = { ok: boolean; value?: T; reason?: string; errors?: string[] };
const security = () => window.playwrightFlowStudio.security;

/** Built-in role reference plus Super-User CRUD for persisted custom roles. */
export function RolesPage() {
  const sessionRef = useSession()?.principal.sessionRef ?? "";
  const [roles, setRoles] = useState<AdminRoleView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AdminRoleView | null>(null);
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
    // caller simply gets no "assigned users" metric rather than an error.
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
      return;
    }
    if (!result.ok) {
      setError(adminReasonMessage(result.reason, result.errors));
      return;
    }
    setNotice("Role change applied.");
    await reload();
  }, [reload]);

  if (loading) return <AdminPage><AdminLoading label="Loading roles…" /></AdminPage>;
  const builtInCount = roles.filter((role) => role.builtIn).length;
  const usersWithRoles = assignedUsers ? [...assignedUsers.values()].reduce((sum, count) => sum + count, 0) : null;

  return (
    <AdminPage
      title="Roles"
      description="Define reusable permission sets while keeping protected built-in roles intact."
      banner={
        <>
          {error ? <AdminBanner tone="error">{error}</AdminBanner> : null}
          {notice ? <AdminBanner tone="success">{notice}</AdminBanner> : null}
        </>
      }
    >
      <AdminMetrics label="Role summary">
        <AdminMetricCard label="All roles" value={roles.length} icon={ShieldCheck} />
        <AdminMetricCard label="Built in" value={builtInCount} hint="protected from edits" />
        <AdminMetricCard label="Custom" value={roles.length - builtInCount} hint={roles.length - builtInCount > 0 ? "stored locally" : undefined} />
        <AdminMetricCard
          label="Assigned users"
          value={usersWithRoles ?? "—"}
          icon={UserSquare}
          hint={assignedUsers ? "across all roles" : "requires Users access"}
        />
      </AdminMetrics>
      <p className="awkit-admin-muted">
        Built-in roles are protected. Custom roles are stored locally and enforced by the trusted
        authorization boundary.
      </p>
      <div className="awkit-admin-split awkit-admin-roles-layout">
      <div className="awkit-admin-role-grid">
      {roles.map((role) => {
        const assigned = assignedUsers?.get(role.id);
        return (
        <AdminSectionCard
          key={role.id}
          title={role.name}
          icon={ShieldCheck}
          meta={
            <>
              {role.permissions.length} permission{role.permissions.length === 1 ? "" : "s"}
              {assigned != null ? <> · {assigned} user{assigned === 1 ? "" : "s"}</> : null}
            </>
          }
          actions={role.builtIn ? (
            <span className="awkit-admin-tag">Built in</span>
          ) : (
            <>
              <button className="toolbar-button" type="button" onClick={() => setEditing(role)}>
                <Pencil size={14} aria-hidden="true" /> Edit
              </button>
              <button className="toolbar-button" type="button" onClick={() => setDeleting(role)}>
                <Trash2 size={14} aria-hidden="true" /> Delete
              </button>
            </>
          )}
        >
          <p className="awkit-admin-muted">{role.description || "No description."}</p>
          <div className="awkit-admin-perm-list awkit-admin-perm-preview">
            {role.permissions.length
              ? <>
                  {role.permissions.slice(0, 5).map((permission) => <span key={permission} className="awkit-admin-role-chip">{permission}</span>)}
                  {role.permissions.length > 5 ? <span className="awkit-admin-more-count">+{role.permissions.length - 5} more</span> : null}
                </>
              : <span className="awkit-admin-muted">No permissions.</span>}
          </div>
        </AdminSectionCard>
        );
      })}
      </div>
      <CreateRoleCard
        onCreate={(input) => sensitive(() => security().admin.createRole({ sessionRef, ...input }))}
      />
      </div>

      {editing ? (
        <RoleEditorModal
          role={editing}
          onCancel={() => setEditing(null)}
          onSave={(input) => {
            const roleId = editing.id;
            setEditing(null);
            void sensitive(() => security().admin.updateRole({ sessionRef, roleId, ...input }));
          }}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          message="The role is removed from assigned users and their active sessions are ended."
          confirmLabel="Delete role"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const roleId = deleting.id;
            setDeleting(null);
            void sensitive(() => security().admin.deleteRole({ sessionRef, roleId }));
          }}
        />
      ) : null}

      {pendingFn ? (
        <ReauthDialog
          sessionRef={sessionRef}
          onCancel={() => setPendingFn(null)}
          onConfirmed={() => {
            const fn = pendingFn;
            setPendingFn(null);
            if (fn) void sensitive(fn);
          }}
        />
      ) : null}
    </AdminPage>
  );
}

function CreateRoleCard({
  onCreate
}: {
  onCreate: (input: { name: string; description?: string; permissions: string[] }) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim().length < 2) return;
    onCreate({ name: name.trim(), description: description.trim() || undefined, permissions });
    setName("");
    setDescription("");
    setPermissions([]);
  };
  return (
    <AdminSectionCard title="Add a custom role" icon={Plus} className="awkit-admin-create-card awkit-admin-quick-create awkit-admin-role-create">
      <form className="awkit-admin-create-form" onSubmit={submit}>
        <label className="awkit-login-field">
          <span className="awkit-login-field-label">Role name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={64} />
        </label>
        <label className="awkit-login-field">
          <span className="awkit-login-field-label">Description (optional)</span>
          <input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={256} />
        </label>
        <PermissionPicker selected={permissions} onChange={setPermissions} />
        <button className="toolbar-button primary" type="submit" disabled={name.trim().length < 2}>
          Create role
        </button>
      </form>
    </AdminSectionCard>
  );
}

function PermissionPicker({
  selected,
  onChange
}: {
  selected: string[];
  onChange: (permissions: string[]) => void;
}) {
  const toggle = (permission: string) => {
    onChange(selected.includes(permission)
      ? selected.filter((item) => item !== permission)
      : [...selected, permission]);
  };
  return (
    <fieldset className="awkit-admin-roles awkit-admin-permission-picker">
      <legend>Permissions</legend>
      {ALL_PERMISSIONS.map((permission) => (
        <label key={permission} className="awkit-admin-role-option">
          <input
            type="checkbox"
            checked={selected.includes(permission)}
            onChange={() => toggle(permission)}
          />
          <code>{permission}</code>
        </label>
      ))}
    </fieldset>
  );
}

function RoleEditorModal({
  role,
  onCancel,
  onSave
}: {
  role: AdminRoleView;
  onCancel: () => void;
  onSave: (input: { name: string; description?: string; permissions: string[] }) => void;
}) {
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description);
  const [permissions, setPermissions] = useState<string[]>(role.permissions);
  const dialogRef = useRef<HTMLFormElement>(null);
  const cancelRef = useRef(onCancel);
  const returnFocusRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null
  );
  useEffect(() => {
    cancelRef.current = onCancel;
  }, [onCancel]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    };
  }, []);
  return (
    <div className="awkit-admin-modal-backdrop" role="presentation" onClick={onCancel}>
      <form
        ref={dialogRef}
        className="awkit-admin-modal awkit-admin-role-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="awkit-role-editor-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim().length >= 2) {
            onSave({ name: name.trim(), description: description.trim() || undefined, permissions });
          }
        }}
      >
        <header className="awkit-admin-modal-head"><h2 id="awkit-role-editor-title">Edit custom role</h2></header>
        <label className="awkit-login-field">
          <span className="awkit-login-field-label">Role name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={64} autoFocus />
        </label>
        <label className="awkit-login-field">
          <span className="awkit-login-field-label">Description (optional)</span>
          <input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={256} />
        </label>
        <PermissionPicker selected={permissions} onChange={setPermissions} />
        <div className="awkit-admin-modal-actions">
          <button className="toolbar-button" type="button" onClick={onCancel}>Cancel</button>
          <button className="toolbar-button primary" type="submit" disabled={name.trim().length < 2}>Save role</button>
        </div>
      </form>
    </div>
  );
}
