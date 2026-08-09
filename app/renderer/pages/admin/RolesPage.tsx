import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { ALL_PERMISSIONS } from "@src/security/authz/Permissions";
import type { AdminRoleView } from "@src/security/admin/RoleAdminService";
import { useSession } from "../../security/SessionContext";
import { adminReasonMessage } from "./adminMessages";
import { ReauthDialog } from "./ReauthDialog";
import { AdminBanner, AdminLoading, AdminPage, AdminSummaryItem } from "./components/AdminUi";
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

  const reload = useCallback(async () => {
    const result = await security().admin.listRoles(sessionRef);
    if (result.ok && result.value) setRoles(result.value);
    else setError(adminReasonMessage(result.reason));
    setLoading(false);
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
  return (
    <AdminPage
      title="Roles"
      description="Define reusable permission sets while keeping protected built-in roles intact."
      summary={
        <>
          <AdminSummaryItem label="All roles" value={roles.length} />
          <AdminSummaryItem label="Built in" value={roles.filter((role) => role.builtIn).length} />
          <AdminSummaryItem label="Custom" value={roles.filter((role) => !role.builtIn).length} />
        </>
      }
      banner={
        <>
          {error ? <AdminBanner tone="error">{error}</AdminBanner> : null}
          {notice ? <AdminBanner tone="success">{notice}</AdminBanner> : null}
        </>
      }
    >
      <p className="awkit-admin-muted">
        Built-in roles are protected. Custom roles are stored locally and enforced by the trusted
        authorization boundary.
      </p>
      <div className="awkit-admin-split awkit-admin-roles-layout">
      <div className="awkit-admin-role-grid">
      {roles.map((role) => (
        <section className="settings-card" key={role.id}>
          <div className="awkit-admin-role-heading">
            <h2><ShieldCheck size={16} /> {role.name}</h2>
            <div className="awkit-admin-row-actions">
              <span className="awkit-admin-muted">{role.permissions.length} permission{role.permissions.length === 1 ? "" : "s"}</span>
              {role.builtIn ? <span className="awkit-admin-tag">Built in</span> : (
                <>
                  <button className="toolbar-button" type="button" onClick={() => setEditing(role)}>
                    <Pencil size={14} aria-hidden="true" /> Edit
                  </button>
                  <button className="toolbar-button" type="button" onClick={() => setDeleting(role)}>
                    <Trash2 size={14} aria-hidden="true" /> Delete
                  </button>
                </>
              )}
            </div>
          </div>
          <p className="awkit-admin-muted">{role.description || "No description."}</p>
          <div className="awkit-admin-perm-list">
            {role.permissions.length
              ? role.permissions.map((permission) => <span key={permission} className="awkit-admin-role-chip">{permission}</span>)
              : <span className="awkit-admin-muted">No permissions.</span>}
          </div>
        </section>
      ))}
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
    <section className="settings-card awkit-admin-create-card">
      <h2><Plus size={16} /> Add a custom role</h2>
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
    </section>
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
